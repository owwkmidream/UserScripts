import { Toast } from '../ui/toast.js';
import { ChatStreamCapsule } from '../ui/chat-stream-capsule.js';

const CHAT_MESSAGES_PATH = '/chat-messages';
const LOG_PREFIX = '[AI风月注册助手][CHAT_MONITOR]';

function logInfo(message, meta) {
    if (meta === undefined) {
        console.log(`${LOG_PREFIX} ${message}`);
        return;
    }
    console.log(`${LOG_PREFIX} ${message}`, meta);
}

function logWarn(message, meta) {
    if (meta === undefined) {
        console.warn(`${LOG_PREFIX} ${message}`);
        return;
    }
    console.warn(`${LOG_PREFIX} ${message}`, meta);
}

function getUnsafeWindow() {
    const candidate = globalThis && globalThis.unsafeWindow;
    if (!candidate) return null;
    if (candidate === window) return null;
    return candidate;
}

function getTargetWindow() {
    return getUnsafeWindow() || window;
}

function publishMonitorState(targetWindow, state) {
    try {
        window.__AF_CHAT_MONITOR__ = state;
    } catch {}
    if (!targetWindow || targetWindow === window) return;
    try {
        targetWindow.__AF_CHAT_MONITOR__ = state;
    } catch {}
}

function toAbsoluteUrl(input, baseOrigin = window.location.origin) {
    if (input instanceof URL) {
        return input.href;
    }
    if (typeof input === 'string') {
        try {
            return new URL(input, baseOrigin).href;
        } catch {
            return '';
        }
    }
    if (input && typeof input.url === 'string') {
        try {
            return new URL(input.url, baseOrigin).href;
        } catch {
            return '';
        }
    }
    return '';
}

function normalizeMethod(value) {
    const method = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return method || 'GET';
}

function isChatMessagesUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.pathname.includes(CHAT_MESSAGES_PATH);
    } catch {
        return url.includes(CHAT_MESSAGES_PATH);
    }
}

function shouldTrack(url, method) {
    if (!isChatMessagesUrl(url)) return false;
    return normalizeMethod(method) === 'POST';
}

function formatElapsedMs(startedAt) {
    if (!Number.isFinite(Number(startedAt))) return '-';
    const elapsed = Math.max(0, Date.now() - Number(startedAt));
    return `${(elapsed / 1000).toFixed(1)}s`;
}

function compactInlineText(value, maxLen = 100) {
    if (typeof value !== 'string') return '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen - 1)}…`;
}

function showResultToast({ status = 0, ok = false, elapsedText = '-', channel = 'fetch', sseError = null }) {
    const statusText = Number.isFinite(Number(status)) && Number(status) > 0
        ? `HTTP ${Number(status)}`
        : '未知状态';
    const errorCode = sseError?.code ? `, ${sseError.code}` : '';
    const errorHint = sseError?.message ? `, ${compactInlineText(sseError.message, 40)}` : '';
    const text = `/chat-messages 已完成 (${statusText}, ${elapsedText}, ${channel}${errorCode}${errorHint})`;
    if (ok) {
        Toast.success(text, 2800);
    } else if (Number(status) >= 400) {
        Toast.error(text, 3600);
    } else {
        Toast.warning(text, 3200);
    }
}

function appendMonitorState(targetWindow, patch) {
    const prev = (targetWindow && targetWindow.__AF_CHAT_MONITOR__)
        || window.__AF_CHAT_MONITOR__
        || {};
    const next = {
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    publishMonitorState(targetWindow, next);
}

function findSseSeparator(buffer) {
    const idxCrLf = buffer.indexOf('\r\n\r\n');
    const idxLf = buffer.indexOf('\n\n');
    if (idxCrLf === -1 && idxLf === -1) return null;
    if (idxCrLf === -1) return { index: idxLf, length: 2 };
    if (idxLf === -1) return { index: idxCrLf, length: 4 };
    if (idxLf < idxCrLf) return { index: idxLf, length: 2 };
    return { index: idxCrLf, length: 4 };
}

function parseSseBlock(rawBlock) {
    if (!rawBlock || !rawBlock.trim()) return null;
    const lines = rawBlock.split(/\r?\n/);
    let eventName = 'message';
    let hasEventLine = false;
    const dataLines = [];
    for (const line of lines) {
        if (!line || line.startsWith(':')) continue;
        const idx = line.indexOf(':');
        const key = idx >= 0 ? line.slice(0, idx).trim() : line.trim();
        let value = idx >= 0 ? line.slice(idx + 1) : '';
        if (value.startsWith(' ')) value = value.slice(1);
        if (key === 'event' && value) {
            eventName = value;
            hasEventLine = true;
            continue;
        }
        if (key === 'data') {
            dataLines.push(value);
        }
    }
    const dataText = dataLines.join('\n').trim();
    if (!dataText && !hasEventLine) return null;

    let json = null;
    if (dataText) {
        try {
            json = JSON.parse(dataText);
        } catch {
            json = null;
        }
    }
    const payloadEvent = json && typeof json.event === 'string' ? json.event : '';
    return {
        event: payloadEvent || eventName,
        eventName,
        dataText,
        json,
    };
}

function toSseError(parsed) {
    if (!parsed) return null;
    const payload = parsed.json;
    if (!payload || typeof payload !== 'object') return null;
    const evt = typeof payload.event === 'string' ? payload.event : parsed.event;
    if (evt !== 'error') return null;
    return {
        event: 'error',
        code: typeof payload.code === 'string' ? payload.code : '',
        status: Number(payload.status || 0),
        message: typeof payload.message === 'string' ? payload.message : '',
        conversationId: typeof payload.conversation_id === 'string' ? payload.conversation_id : '',
        messageId: typeof payload.message_id === 'string' ? payload.message_id : '',
        raw: payload,
    };
}

async function observeSseResponse(response, handlers = {}) {
    const onEvent = typeof handlers.onEvent === 'function' ? handlers.onEvent : null;
    const emitBlock = (rawBlock) => {
        const parsed = parseSseBlock(rawBlock);
        if (!parsed || !onEvent) return;
        onEvent(parsed);
    };

    const reader = response?.body?.getReader?.();
    if (!reader) {
        const text = await response?.text?.().catch(() => '');
        if (!text) return;
        const blocks = text.split(/\r?\n\r?\n/);
        for (const block of blocks) {
            emitBlock(block);
        }
        return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
            const separator = findSseSeparator(buffer);
            if (!separator) break;
            const rawBlock = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator.length);
            emitBlock(rawBlock);
        }
    }

    buffer += decoder.decode();
    while (true) {
        const separator = findSseSeparator(buffer);
        if (!separator) break;
        const rawBlock = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        emitBlock(rawBlock);
    }
    if (buffer.trim()) {
        emitBlock(buffer);
    }
}

export const ChatMessagesMonitor = {
    started: false,
    targetWindow: null,
    originalFetch: null,
    xhrOpen: null,
    xhrSend: null,

    start() {
        if (this.started) return;
        this.started = true;
        this.targetWindow = getTargetWindow();
        const usingUnsafeWindow = this.targetWindow !== window;
        const baseOrigin = this.targetWindow?.location?.origin || window.location.origin;
        logInfo('开始安装网络监听（/chat-messages）');
        ChatStreamCapsule.init();
        this.hookFetch(this.targetWindow, baseOrigin);
        this.hookXhr(this.targetWindow, baseOrigin);
        const state = {
            started: true,
            path: CHAT_MESSAGES_PATH,
            context: usingUnsafeWindow ? 'unsafeWindow' : 'window',
            fetchHooked: !!this.originalFetch,
            xhrHooked: !!this.xhrOpen && !!this.xhrSend,
            lastSseEvent: null,
            lastSseError: null,
            updatedAt: new Date().toISOString(),
        };
        publishMonitorState(this.targetWindow, state);
        logInfo('网络监听安装完成', {
            context: state.context,
            fetchHooked: !!this.originalFetch,
            xhrHooked: !!this.xhrOpen && !!this.xhrSend,
        });
    },

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
            const second = args[1] || {};
            const url = toAbsoluteUrl(first, baseOrigin);
            const method = normalizeMethod(second.method || (first && typeof first === 'object' ? first.method : 'GET'));
            const startedAt = Date.now();
            const tracked = shouldTrack(url, method);
            const requestState = {
                sseError: null,
            };

            const promise = this.originalFetch.apply(targetWindow, args);
            if (!tracked) {
                return promise;
            }
            ChatStreamCapsule.onRequestStart();
            logInfo('命中 fetch /chat-messages 请求', { method, url });

            promise.then((response) => {
                let finalized = false;
                const done = () => {
                    if (finalized) return;
                    finalized = true;
                    const finalStatus = Number(
                        requestState.sseError?.status
                        || response?.status
                        || 0
                    );
                    const finalOk = !!response?.ok && !requestState.sseError;
                    const elapsedText = formatElapsedMs(startedAt);
                    logInfo('fetch /chat-messages 请求完成', {
                        method,
                        url,
                        status: finalStatus,
                        sseErrorCode: requestState.sseError?.code || '',
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
                            ChatStreamCapsule.onSseEvent(sseEvent.event || sseEvent.eventName || '');
                            appendMonitorState(this.targetWindow, {
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
                const elapsedText = formatElapsedMs(startedAt);
                logWarn('fetch /chat-messages 请求失败', { method, url });
                showResultToast({
                    status: 0,
                    ok: false,
                    elapsedText,
                    channel: 'fetch',
                    sseError: requestState.sseError,
                });
                ChatStreamCapsule.onRequestDone({
                    status: 0,
                    ok: false,
                    elapsedText,
                });
            });
            return promise;
        };
    },

    hookXhr(targetWindow, baseOrigin) {
        if (!targetWindow || typeof targetWindow.XMLHttpRequest !== 'function') {
            logWarn('XMLHttpRequest 不可用，跳过 xhr hook');
            return;
        }
        if (this.xhrOpen || this.xhrSend) return;

        this.xhrOpen = targetWindow.XMLHttpRequest.prototype.open;
        this.xhrSend = targetWindow.XMLHttpRequest.prototype.send;
        logInfo('xhr hook 已安装');

        targetWindow.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            const absoluteUrl = toAbsoluteUrl(url, baseOrigin);
            this.__afChatMonitorMeta = {
                method: normalizeMethod(method),
                url: absoluteUrl,
                startedAt: 0,
                tracked: shouldTrack(absoluteUrl, method),
            };
            return ChatMessagesMonitor.xhrOpen.call(this, method, url, ...rest);
        };

        targetWindow.XMLHttpRequest.prototype.send = function(...args) {
            const meta = this.__afChatMonitorMeta;
            if (meta && meta.tracked) {
                meta.startedAt = Date.now();
                ChatStreamCapsule.onRequestStart();
                logInfo('命中 xhr /chat-messages 请求', {
                    method: meta.method,
                    url: meta.url,
                });
                let reported = false;
                const onLoadEnd = () => {
                    if (reported) return;
                    reported = true;
                    const elapsedText = formatElapsedMs(meta.startedAt);
                    const status = Number(this.status || 0);
                    const ok = status >= 200 && status < 300;
                    logInfo('xhr /chat-messages 请求完成', {
                        method: meta.method,
                        url: meta.url,
                        status,
                    });
                    showResultToast({
                        status,
                        ok,
                        elapsedText,
                        channel: 'xhr',
                    });
                    ChatStreamCapsule.onRequestDone({
                        status,
                        ok,
                        elapsedText,
                    });
                };
                this.addEventListener('loadend', onLoadEnd, { once: true });
            }
            return ChatMessagesMonitor.xhrSend.call(this, ...args);
        };
    },
};
