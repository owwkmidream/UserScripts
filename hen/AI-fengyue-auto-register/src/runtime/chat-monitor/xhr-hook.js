import { ChatStreamCapsule } from '../../ui/chat-stream-capsule.js';
import { logInfo, logWarn } from './logger.js';
import { appendMonitorState } from './state-publisher.js';
import { getChatMessagesTimeoutSeconds } from './timeout-context.js';
import {
    formatElapsedMs,
    normalizeMethod,
    shouldTrack,
    showResultToast,
    toAbsoluteUrl,
} from './sse-parser.js';

export const chatMonitorXhrMethods = {
    hookXhr(targetWindow, baseOrigin) {
        if (!targetWindow || typeof targetWindow.XMLHttpRequest !== 'function') {
            logWarn('XMLHttpRequest 不可用，跳过 xhr hook');
            return;
        }
        if (this.xhrOpen || this.xhrSend) return;

        const monitor = this;
        monitor.xhrOpen = targetWindow.XMLHttpRequest.prototype.open;
        monitor.xhrSend = targetWindow.XMLHttpRequest.prototype.send;
        logInfo('xhr hook 已安装');

        targetWindow.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            const absoluteUrl = toAbsoluteUrl(url, baseOrigin);
            this.__afChatMonitorMeta = {
                method: normalizeMethod(method),
                url: absoluteUrl,
                startedAt: 0,
                tracked: shouldTrack(absoluteUrl, method),
                timeoutSeconds: 0,
                timeoutTimer: null,
                timeoutTriggered: false,
            };
            return monitor.xhrOpen.call(this, method, url, ...rest);
        };

        targetWindow.XMLHttpRequest.prototype.send = function(...args) {
            const meta = this.__afChatMonitorMeta;
            if (meta && meta.tracked) {
                meta.startedAt = Date.now();
                meta.timeoutSeconds = getChatMessagesTimeoutSeconds();
                meta.timeoutTriggered = false;
                ChatStreamCapsule.onRequestStart();
                appendMonitorState(monitor.targetWindow, {
                    timeoutSeconds: meta.timeoutSeconds,
                });
                logInfo('命中 xhr /chat-messages 请求', {
                    method: meta.method,
                    url: meta.url,
                    timeoutSeconds: meta.timeoutSeconds,
                });
                let reported = false;
                if (meta.timeoutSeconds > 0) {
                    meta.timeoutTimer = setTimeout(() => {
                        meta.timeoutTriggered = true;
                        logWarn('xhr /chat-messages 超时，已主动中止', {
                            method: meta.method,
                            url: meta.url,
                            timeoutSeconds: meta.timeoutSeconds,
                        });
                        appendMonitorState(monitor.targetWindow, {
                            lastTimeout: {
                                channel: 'xhr',
                                method: meta.method,
                                url: meta.url,
                                timeoutSeconds: meta.timeoutSeconds,
                                at: Date.now(),
                            },
                        });
                        ChatStreamCapsule.onSseError({
                            status: 408,
                            code: 'timeout',
                            message: `超过 ${meta.timeoutSeconds} 秒未完成`,
                        });
                        try {
                            this.abort();
                        } catch (abortError) {
                            logWarn('xhr /chat-messages 超时后 abort 失败', {
                                method: meta.method,
                                url: meta.url,
                                message: abortError?.message || String(abortError),
                            });
                        }
                    }, meta.timeoutSeconds * 1000);
                }
                const onLoadEnd = () => {
                    if (reported) return;
                    reported = true;
                    if (meta.timeoutTimer) {
                        clearTimeout(meta.timeoutTimer);
                        meta.timeoutTimer = null;
                    }
                    const elapsedText = formatElapsedMs(meta.startedAt);
                    const timedOut = !!meta.timeoutTriggered;
                    const status = timedOut ? 408 : Number(this.status || 0);
                    const ok = !timedOut && status >= 200 && status < 300;
                    logInfo('xhr /chat-messages 请求完成', {
                        method: meta.method,
                        url: meta.url,
                        status,
                        timedOut,
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
            return monitor.xhrSend.call(this, ...args);
        };
    },
};
