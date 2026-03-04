import { CONFIG } from '../../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue } from '../../gm.js';
import { ApiService } from '../../services/api-service.js';
import { ChatHistoryService } from '../../services/chat-history-service.js';
import { Sidebar } from '../../ui/sidebar.js';
import { Toast } from '../../ui/toast.js';
import { generateUsername, generatePassword, delay } from '../../utils/random.js';
import { extractVerificationCode } from '../../utils/code-extractor.js';
import { simulateInput } from '../../utils/dom.js';
import {
    createRunContext,
    isDebugEnabled,
    logDebug,
    logError,
    logInfo,
    logWarn,
} from '../../utils/logger.js';
import {
    X_LANGUAGE,
    SITE_ENDPOINTS,
    DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
    DEFAULT_SWITCH_WORLD_BOOK_TRIGGER,
    readErrorMessage,
    normalizeTimestamp,
    decodeEscapedText,
    isAnswerEmpty,
    normalizeSwitchTriggerWord,
    cloneJsonSafe,
    stringifyJsonWithUnicodeEscapes,
    randomConversationSuffix,
    buildTokenSignature,
    withHttpStatusError,
} from './shared.js';

export const ChatMessagesMethods = {
    async sendChatMessagesAndReload({ appId, token, query, conversationName, runCtx }) {
        const path = `${SITE_ENDPOINTS.CHAT_MESSAGES}/${appId}/chat-messages`;
        const url = `${window.location.origin}${path}`;
        const body = {
            response_mode: 'streaming',
            conversation_name: conversationName,
            history_start_at: null,
            inputs: {},
            query,
        };

        logInfo(runCtx, 'SWITCH_CHAT', '开始请求 chat-messages', {
            path,
            conversationName,
            queryLength: query.length,
        });
        logDebug(runCtx, 'SWITCH_CHAT', 'chat-messages 请求体', body);

        let baselineConversationIds = [];
        try {
            const baselineConversations = await this.fetchInstalledConversations({
                appId,
                token,
                runCtx,
                step: 'SWITCH_LIST_CONVERSATIONS_BASELINE',
                limit: 500,
                pinned: false,
                maxAttempts: 1,
            });
            baselineConversationIds = baselineConversations
                .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
                .filter(Boolean);
            logInfo(runCtx, 'SWITCH_LIST_CONVERSATIONS_BASELINE', '已读取会话基线', {
                baselineCount: baselineConversationIds.length,
            });
        } catch (error) {
            baselineConversationIds = [];
            logWarn(runCtx, 'SWITCH_LIST_CONVERSATIONS_BASELINE', '读取会话基线失败，将继续执行并依赖轮询兜底', {
                message: error?.message || String(error),
            });
        }

        const responseMeta = await this.runWithObjectiveRetries(
            (attempt, attempts) => {
                if (attempt > 1) {
                    logInfo(runCtx, 'SWITCH_CHAT', `chat-messages 重试中 (${attempt}/${attempts})`);
                }
                let externalAbort = null;
                const ssePromise = this.sendChatMessagesOnce({
                    token,
                    url,
                    body,
                    runCtx,
                    onAbortReady: (abortFn) => {
                        externalAbort = typeof abortFn === 'function' ? abortFn : null;
                    },
                });
                const pollPromise = this.pollConversationIdFromConversations({
                    appId,
                    token,
                    runCtx,
                    baselineConversationIds,
                    maxAttempts: 18,
                    intervalMs: 450,
                });

                return new Promise((resolve, reject) => {
                    let settled = false;
                    const complete = (meta) => {
                        if (settled) return;
                        settled = true;
                        resolve(meta);
                    };
                    const fail = (error) => {
                        if (settled) return;
                        settled = true;
                        reject(error);
                    };

                    ssePromise.then((meta) => {
                        if (settled) return;
                        const cid = typeof meta?.conversationId === 'string' ? meta.conversationId.trim() : '';
                        logInfo(runCtx, 'SWITCH_CHAT', 'SSE 通道返回', {
                            trigger: meta?.trigger || null,
                            status: Number(meta?.status || 0) || null,
                            readyState: Number(meta?.readyState || 0) || null,
                            textLength: Number(meta?.textLength || 0) || 0,
                            conversationId: cid || null,
                        });

                        if (cid) {
                            complete({
                                ...meta,
                                source: 'sse-conversation-id',
                                conversationId: cid,
                            });
                            return;
                        }

                        // SSE 没拿到 conversation_id 时，给轮询短窗口补救，避免立刻丢失链路。
                        Promise.race([
                            pollPromise,
                            delay(2200).then(() => ({
                                conversationId: '',
                                source: 'polling-timebox',
                                attempt: 0,
                            })),
                        ]).then((pollMeta) => {
                            if (settled) return;
                            const pollConversationId = typeof pollMeta?.conversationId === 'string'
                                ? pollMeta.conversationId.trim()
                                : '';
                            if (pollConversationId) {
                                if (externalAbort) {
                                    externalAbort('polling-captured-after-sse');
                                }
                                complete({
                                    ...meta,
                                    conversationId: pollConversationId,
                                    source: pollMeta?.source || 'polling-after-sse',
                                    pollAttempt: Number(pollMeta?.attempt || 0) || 0,
                                });
                                return;
                            }
                            complete({
                                ...meta,
                                source: meta?.source || 'sse-no-conversation-id',
                            });
                        }).catch((pollError) => {
                            logWarn(runCtx, 'SWITCH_CHAT', 'SSE 后轮询补救失败，按 SSE 结果继续', {
                                message: pollError?.message || String(pollError),
                            });
                            complete({
                                ...meta,
                                source: meta?.source || 'sse-no-conversation-id',
                            });
                        });
                    }).catch((sseError) => {
                        if (settled) return;
                        logWarn(runCtx, 'SWITCH_CHAT', 'SSE 通道失败，等待轮询通道兜底', {
                            message: sseError?.message || String(sseError),
                        });
                        pollPromise.then((pollMeta) => {
                            if (settled) return;
                            const pollConversationId = typeof pollMeta?.conversationId === 'string'
                                ? pollMeta.conversationId.trim()
                                : '';
                            if (pollConversationId) {
                                complete({
                                    trigger: 'polling-fallback',
                                    status: 0,
                                    readyState: 0,
                                    textLength: 0,
                                    elapsedMs: 0,
                                    conversationId: pollConversationId,
                                    source: pollMeta?.source || 'polling-fallback',
                                    pollAttempt: Number(pollMeta?.attempt || 0) || 0,
                                });
                                return;
                            }
                            fail(sseError);
                        }).catch(() => fail(sseError));
                    });

                    pollPromise.then((pollMeta) => {
                        if (settled) return;
                        const pollConversationId = typeof pollMeta?.conversationId === 'string'
                            ? pollMeta.conversationId.trim()
                            : '';
                        if (!pollConversationId) return;

                        logInfo(runCtx, 'SWITCH_CHAT', '轮询通道已获取 conversation_id', {
                            conversationId: pollConversationId,
                            source: pollMeta?.source || 'polling',
                            attempt: Number(pollMeta?.attempt || 0) || 0,
                        });
                        if (externalAbort) {
                            externalAbort('polling-conversation-id-captured');
                        }
                        complete({
                            trigger: 'polling-conversation-id-captured',
                            status: 0,
                            readyState: 0,
                            textLength: 0,
                            elapsedMs: 0,
                            conversationId: pollConversationId,
                            source: pollMeta?.source || 'polling',
                            pollAttempt: Number(pollMeta?.attempt || 0) || 0,
                        });
                    }).catch((pollError) => {
                        logWarn(runCtx, 'SWITCH_CHAT', '轮询通道执行异常', {
                            message: pollError?.message || String(pollError),
                        });
                    });
                });
            },
            {
                runCtx,
                step: 'SWITCH_CHAT',
                actionName: 'chat-messages',
                maxAttempts: DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
            }
        );

        const status = Number(responseMeta?.status || 0);
        const hasStatus = Number.isFinite(status) && status > 0;
        const isSuccess = hasStatus && status >= 200 && status < 300;
        const statusText = hasStatus ? `HTTP ${status}` : '未知状态';

        let conversationId = typeof responseMeta?.conversationId === 'string'
            ? responseMeta.conversationId.trim()
            : '';
        let source = typeof responseMeta?.source === 'string' && responseMeta.source.trim()
            ? responseMeta.source.trim()
            : (conversationId ? 'sse-conversation-id' : 'sse-first-chunk');

        logInfo(runCtx, 'SWITCH_CHAT', `chat-messages 已收到响应（${statusText}）`, {
            ...responseMeta,
            conversationId: conversationId || null,
            source,
        });

        return { status, isSuccess, conversationId: conversationId || '', source };
    },


    sendChatMessagesOnce({ token, url, body, runCtx, onAbortReady = null }) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const requestStartedAt = Date.now();
            let hardTimeoutTimer = null;
            let capturedConversationId = '';
            let statusCode = 0;
            let streamText = '';
            const requestController = new AbortController();
            let abortedByScript = false;

            const elapsedMs = () => Date.now() - requestStartedAt;

            const clearTimers = () => {
                if (hardTimeoutTimer) {
                    clearTimeout(hardTimeoutTimer);
                    hardTimeoutTimer = null;
                }
            };

            const abortRequest = (reason) => {
                try {
                    abortedByScript = true;
                    requestController.abort(reason || 'abort');
                    logInfo(runCtx, 'SWITCH_CHAT', `已主动中止 chat-messages SSE: ${reason || 'no-reason'}`);
                } catch (error) {
                    logWarn(runCtx, 'SWITCH_CHAT', '主动中止 chat-messages SSE 失败', {
                        reason: reason || 'no-reason',
                        message: error?.message || String(error),
                    });
                }
            };
            if (typeof onAbortReady === 'function') {
                try {
                    onAbortReady((reason = 'external-abort') => {
                        abortRequest(reason);
                    });
                } catch {
                    // ignore
                }
            }

            const tryCaptureConversationId = (rawText, trigger) => {
                if (capturedConversationId) return capturedConversationId;
                const conversationId = this.parseConversationIdFromEventStream(rawText);
                if (!conversationId) return '';

                capturedConversationId = conversationId;
                logInfo(runCtx, 'SWITCH_CHAT', `已从 ${trigger} 解析 conversation_id`, {
                    conversationId,
                });
                return capturedConversationId;
            };

            const finish = (trigger, responseMeta = {}) => {
                if (settled) return;
                settled = true;
                clearTimers();
                logInfo(runCtx, 'SWITCH_CHAT', `chat-messages 已结束: ${trigger}`, {
                    elapsedMs: elapsedMs(),
                    ...responseMeta,
                    conversationId: capturedConversationId || responseMeta?.conversationId || null,
                });
                resolve({
                    trigger,
                    ...responseMeta,
                    conversationId: capturedConversationId || responseMeta?.conversationId || '',
                });
            };

            hardTimeoutTimer = setTimeout(() => {
                if (settled) return;
                logWarn(runCtx, 'SWITCH_CHAT', 'chat-messages 8s 兜底超时，强制结束并刷新后续流程');
                finish('failsafe-timeout', {
                    status: statusCode || 0,
                    readyState: 0,
                    textLength: streamText.length,
                    elapsedMs: elapsedMs(),
                });
                abortRequest('failsafe-timeout');
            }, 8000);

            (async () => {
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Language': X_LANGUAGE,
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify(body),
                        credentials: 'include',
                        cache: 'no-store',
                        signal: requestController.signal,
                    });

                    statusCode = Number(response.status || 0);
                    logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages fetch 已建立连接', {
                        status: statusCode,
                        ok: response.ok,
                        elapsedMs: elapsedMs(),
                    });
                    if (!response.ok) {
                        throw withHttpStatusError(`chat-messages 请求失败: HTTP ${statusCode}`, statusCode);
                    }

                    const reader = response.body?.getReader?.();
                    if (!reader) {
                        streamText = await response.text();
                        tryCaptureConversationId(streamText, 'fetch-no-stream');
                        finish('fetch-no-stream', {
                            status: statusCode,
                            readyState: 4,
                            textLength: streamText.length,
                            elapsedMs: elapsedMs(),
                            conversationId: capturedConversationId,
                        });
                        return;
                    }

                    const decoder = new TextDecoder();
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) {
                            break;
                        }

                        const chunkText = decoder.decode(value, { stream: true });
                        if (!chunkText) {
                            continue;
                        }
                        streamText += chunkText;
                        tryCaptureConversationId(streamText, 'fetch-stream');
                        logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages fetch stream chunk', {
                            status: statusCode,
                            chunkLength: chunkText.length,
                            textLength: streamText.length,
                            elapsedMs: elapsedMs(),
                            conversationId: capturedConversationId || null,
                        });

                        if (!capturedConversationId) {
                            continue;
                        }

                        finish('fetch-stream-conversation-id', {
                            status: statusCode,
                            readyState: 3,
                            textLength: streamText.length,
                            elapsedMs: elapsedMs(),
                            conversationId: capturedConversationId,
                        });
                        abortRequest('conversation-id-captured-fetch-stream');
                        return;
                    }

                    tryCaptureConversationId(streamText, 'fetch-stream-end');
                    finish('fetch-stream-end', {
                        status: statusCode,
                        readyState: 4,
                        textLength: streamText.length,
                        elapsedMs: elapsedMs(),
                        conversationId: capturedConversationId,
                    });
                } catch (error) {
                    if (settled) return;
                    clearTimers();
                    if (error?.name === 'AbortError') {
                        logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages fetch onabort', {
                            abortedByScript,
                            elapsedMs: elapsedMs(),
                            textLength: streamText.length,
                            conversationId: capturedConversationId || null,
                        });
                        if (abortedByScript) {
                            finish('fetch-onabort-by-script', {
                                status: statusCode || 0,
                                readyState: 0,
                                textLength: streamText.length,
                                elapsedMs: elapsedMs(),
                                conversationId: capturedConversationId,
                            });
                            return;
                        }
                        reject(new Error('chat-messages 请求被中止'));
                        return;
                    }

                    logWarn(runCtx, 'SWITCH_CHAT', 'chat-messages fetch 失败', {
                        status: statusCode || 0,
                        message: error?.message || String(error),
                        elapsedMs: elapsedMs(),
                    });
                    reject(withHttpStatusError(error?.message || 'chat-messages fetch 请求失败', statusCode || 0));
                }
            })();
        });
    },

};
