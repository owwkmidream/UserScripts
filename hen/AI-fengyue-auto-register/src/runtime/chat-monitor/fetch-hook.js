import { Toast } from '../../ui/toast.js';
import { ChatStreamCapsule } from '../../ui/chat-stream-capsule.js';
import { logInfo, logWarn } from './logger.js';
import { appendMonitorState } from './state-publisher.js';
import {
    buildTimeoutInfo,
    createTimeoutAbortContext,
    getChatMessagesTimeoutSeconds,
} from './timeout-context.js';
import {
    compactInlineText,
    formatClockTimestamp,
    formatElapsedMs,
    normalizeMethod,
    observeSseResponse,
    shouldTrack,
    showResultToast,
    toAbsoluteUrl,
    toSseError,
} from './sse-parser.js';

export const chatMonitorFetchMethods = {
    hookFetch(targetWindow, baseOrigin) {
        if (!targetWindow || typeof targetWindow.fetch !== 'function') {
            logWarn('fetch 不可用，跳过 fetch hook');
            return;
        }
        if (this.originalFetch) return;

        this.originalFetch = targetWindow.fetch;
        logInfo('fetch hook 已安装');
        targetWindow.fetch = (...args) => {
            const first = args[0];
            const secondRaw = args[1];
            const second = secondRaw || {};
            const url = toAbsoluteUrl(first, baseOrigin);
            const method = normalizeMethod(second.method || (first && typeof first === 'object' ? first.method : 'GET'));
            const startedAt = Date.now();
            const tracked = shouldTrack(url, method);
            if (!tracked) {
                return this.originalFetch.apply(targetWindow, args);
            }

            const timeoutSeconds = getChatMessagesTimeoutSeconds();
            const timeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;
            const requestState = {
                sseError: null,
                timeoutReported: false,
                firstMessageToastAt: 0,
            };
            const abortContext = createTimeoutAbortContext({
                first,
                second: secondRaw,
                timeoutMs,
            });
            const requestArgs = abortContext.args;

            const promise = this.originalFetch.apply(targetWindow, requestArgs);
            ChatStreamCapsule.onRequestStart();
            appendMonitorState(this.targetWindow, {
                timeoutSeconds,
                timeoutMode: abortContext.getTimeoutMode(),
            });
            logInfo('命中 fetch /chat-messages 请求', {
                method,
                url,
                timeoutSeconds,
            });

            let cleanedUp = false;
            const cleanupAbortContext = () => {
                if (cleanedUp) return;
                cleanedUp = true;
                abortContext.cleanup();
            };

            promise.then((response) => {
                let finalized = false;
                const done = () => {
                    if (finalized) return;
                    finalized = true;
                    cleanupAbortContext();
                    const timedOut = abortContext.isTimeoutTriggered();
                    const timeoutReason = abortContext.getTimeoutReason();
                    if (timedOut && !requestState.timeoutReported) {
                        requestState.timeoutReported = true;
                        const timeoutInfo = buildTimeoutInfo({
                            timeoutSeconds,
                            reason: timeoutReason,
                        });
                        logWarn('fetch /chat-messages 超时，已主动中止', {
                            method,
                            url,
                            timeoutSeconds,
                            timeoutReason,
                        });
                        appendMonitorState(this.targetWindow, {
                            lastTimeout: {
                                channel: 'fetch',
                                method,
                                url,
                                timeoutSeconds,
                                timeoutReason,
                                at: Date.now(),
                            },
                        });
                        ChatStreamCapsule.onSseError({
                            status: 408,
                            code: timeoutInfo.code,
                            message: timeoutInfo.message,
                        });
                    }
                    const finalStatus = Number(
                        requestState.sseError?.status
                        || (timedOut ? 408 : 0)
                        || response?.status
                        || 0
                    );
                    const finalOk = !!response?.ok && !requestState.sseError && !timedOut;
                    const elapsedText = formatElapsedMs(startedAt);
                    logInfo('fetch /chat-messages 请求完成', {
                        method,
                        url,
                        status: finalStatus,
                        sseErrorCode: requestState.sseError?.code || '',
                        timedOut,
                    });
                    showResultToast({
                        status: finalStatus,
                        ok: finalOk,
                        elapsedText,
                        channel: 'fetch',
                        sseError: requestState.sseError,
                    });
                    ChatStreamCapsule.onRequestDone({
                        status: finalStatus,
                        ok: finalOk,
                        elapsedText,
                    });
                };

                try {
                    const cloned = response?.clone?.();
                    if (!cloned) {
                        done();
                        return;
                    }
                    observeSseResponse(cloned, {
                        onEvent: (sseEvent) => {
                            const eventName = sseEvent.event || sseEvent.eventName || '';
                            ChatStreamCapsule.onSseEvent(eventName);
                            if (eventName === 'message' || eventName === 'msg') {
                                if (!requestState.firstMessageToastAt) {
                                    const firstAt = Date.now();
                                    requestState.firstMessageToastAt = firstAt;
                                    const clockText = formatClockTimestamp(firstAt);
                                    const elapsedText = formatElapsedMs(startedAt);
                                    Toast.info(`首个 ${eventName} 事件: ${clockText} (+${elapsedText})`, 3600);
                                    logInfo('已收到首个输出事件', {
                                        method,
                                        url,
                                        event: eventName,
                                        firstAt,
                                        elapsedText,
                                    });
                                    appendMonitorState(this.targetWindow, {
                                        firstMessageEvent: {
                                            event: eventName,
                                            at: firstAt,
                                            clockText,
                                            elapsedText,
                                        },
                                    });
                                }
                                abortContext.setOutputMode();
                            } else if (eventName === 'ping' || eventName === 'waiting') {
                                abortContext.setWaitingMode();
                            } else {
                                abortContext.notifyEvent();
                            }
                            appendMonitorState(this.targetWindow, {
                                timeoutMode: abortContext.getTimeoutMode(),
                                lastSseEvent: {
                                    event: sseEvent.event || '',
                                    eventName: sseEvent.eventName || '',
                                    at: Date.now(),
                                },
                            });
                            if (sseEvent.event && sseEvent.event !== 'message') {
                                logInfo('捕获 SSE 事件', {
                                    method,
                                    url,
                                    event: sseEvent.event,
                                });
                            }
                            const sseError = toSseError(sseEvent);
                            if (!sseError || requestState.sseError) return;
                            requestState.sseError = sseError;
                            const briefMessage = compactInlineText(sseError.message, 88);
                            const codeText = sseError.code || 'unknown_error';
                            logWarn('捕获 SSE error 事件', {
                                method,
                                url,
                                code: codeText,
                                status: sseError.status,
                                message: briefMessage,
                                conversationId: sseError.conversationId || '',
                                messageId: sseError.messageId || '',
                            });
                            appendMonitorState(this.targetWindow, {
                                lastSseError: {
                                    code: codeText,
                                    status: sseError.status,
                                    message: briefMessage,
                                    conversationId: sseError.conversationId || '',
                                    messageId: sseError.messageId || '',
                                },
                            });
                            ChatStreamCapsule.onSseError({
                                status: sseError.status,
                                code: codeText,
                                message: briefMessage,
                            });
                            Toast.error(
                                `SSE 错误: ${codeText}${briefMessage ? ` · ${briefMessage}` : ''}`,
                                5200,
                            );
                        },
                    })
                        .catch((streamError) => {
                            logWarn('SSE 解析失败', {
                                method,
                                url,
                                message: streamError?.message || String(streamError),
                            });
                        })
                        .finally(() => done());
                } catch {
                    done();
                }
            }).catch(() => {
                cleanupAbortContext();
                const elapsedText = formatElapsedMs(startedAt);
                const timedOut = abortContext.isTimeoutTriggered();
                const timeoutReason = abortContext.getTimeoutReason();
                const status = timedOut ? 408 : 0;
                if (timedOut && !requestState.timeoutReported) {
                    requestState.timeoutReported = true;
                    const timeoutInfo = buildTimeoutInfo({
                        timeoutSeconds,
                        reason: timeoutReason,
                    });
                    logWarn('fetch /chat-messages 超时，已主动中止', {
                        method,
                        url,
                        timeoutSeconds,
                        timeoutReason,
                    });
                    appendMonitorState(this.targetWindow, {
                        lastTimeout: {
                            channel: 'fetch',
                            method,
                            url,
                            timeoutSeconds,
                            timeoutReason,
                            at: Date.now(),
                        },
                    });
                    ChatStreamCapsule.onSseError({
                        status: 408,
                        code: timeoutInfo.code,
                        message: timeoutInfo.message,
                    });
                } else {
                    logWarn('fetch /chat-messages 请求失败', { method, url });
                }
                showResultToast({
                    status,
                    ok: false,
                    elapsedText,
                    channel: 'fetch',
                    sseError: requestState.sseError,
                });
                ChatStreamCapsule.onRequestDone({
                    status,
                    ok: false,
                    elapsedText,
                });
            });
            return promise;
        };
    },
};
