import { ChatStreamCapsule } from '../ui/chat-stream-capsule.js';
import { CHAT_MESSAGES_PATH } from './chat-monitor/constants.js';
import { chatMonitorFetchMethods } from './chat-monitor/fetch-hook.js';
import { chatMonitorXhrMethods } from './chat-monitor/xhr-hook.js';
import { logInfo } from './chat-monitor/logger.js';
import { getTargetWindow, publishMonitorState } from './chat-monitor/state-publisher.js';
import { getChatMessagesTimeoutSeconds } from './chat-monitor/timeout-context.js';

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
            timeoutSeconds: getChatMessagesTimeoutSeconds(),
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

    stop() {
        if (!this.started && !this.originalFetch && !this.xhrOpen && !this.xhrSend) return;

        const targetWindow = this.targetWindow || getTargetWindow();
        if (targetWindow) {
            if (this.originalFetch && typeof targetWindow.fetch === 'function') {
                targetWindow.fetch = this.originalFetch;
            }
            if (this.xhrOpen && targetWindow.XMLHttpRequest?.prototype) {
                targetWindow.XMLHttpRequest.prototype.open = this.xhrOpen;
            }
            if (this.xhrSend && targetWindow.XMLHttpRequest?.prototype) {
                targetWindow.XMLHttpRequest.prototype.send = this.xhrSend;
            }
        }

        this.started = false;
        this.targetWindow = null;
        this.originalFetch = null;
        this.xhrOpen = null;
        this.xhrSend = null;

        publishMonitorState(targetWindow, {
            started: false,
            path: CHAT_MESSAGES_PATH,
            fetchHooked: false,
            xhrHooked: false,
            timeoutSeconds: getChatMessagesTimeoutSeconds(),
            stoppedAt: new Date().toISOString(),
        });
        logInfo('网络监听已停止');
    },

    ...chatMonitorFetchMethods,
    ...chatMonitorXhrMethods,
};
