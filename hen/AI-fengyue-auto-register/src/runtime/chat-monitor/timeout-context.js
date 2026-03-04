import { CONFIG } from '../../constants.js';
import { gmGetValue } from '../../gm.js';
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } from './constants.js';

export function normalizeTimeoutSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const normalized = Math.floor(parsed);
    if (normalized <= 0) return 0;
    return Math.min(normalized, MAX_TIMEOUT_SECONDS);
}

export function getChatMessagesTimeoutSeconds() {
    const saved = gmGetValue(CONFIG.STORAGE_KEYS.CHAT_MESSAGES_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS);
    return normalizeTimeoutSeconds(saved);
}

export function isAbortSignalLike(signal) {
    return !!signal
        && typeof signal === 'object'
        && typeof signal.aborted === 'boolean'
        && typeof signal.addEventListener === 'function'
        && typeof signal.removeEventListener === 'function';
}

export function getFetchSignal(first, second) {
    if (isAbortSignalLike(second?.signal)) {
        return second.signal;
    }
    if (first && typeof first === 'object' && isAbortSignalLike(first.signal)) {
        return first.signal;
    }
    return null;
}

export function buildFetchArgsWithSignal(first, second, signal) {
    if (!signal) return [first, second];
    if (first instanceof Request) {
        if (second && typeof second === 'object') {
            return [first, { ...second, signal }];
        }
        return [new Request(first, { signal })];
    }
    return [first, { ...(second || {}), signal }];
}

export function createTimeoutAbortContext({ first, second, timeoutMs }) {
    if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) {
        return {
            args: [first, second],
            cleanup: () => {},
            isTimeoutTriggered: () => false,
            getTimeoutReason: () => '',
            setWaitingMode: () => {},
            setOutputMode: () => {},
            notifyEvent: () => {},
            getTimeoutMode: () => 'disabled',
        };
    }

    const baseSignal = getFetchSignal(first, second);
    const controller = new AbortController();
    let timeoutTriggered = false;
    let timeoutReason = '';
    let timeoutMode = 'waiting';
    let waitingTimer = null;
    let inactivityTimer = null;
    let onBaseAbort = null;

    if (isAbortSignalLike(baseSignal)) {
        if (baseSignal.aborted) {
            controller.abort(baseSignal.reason || 'upstream-aborted');
        } else {
            onBaseAbort = () => {
                controller.abort(baseSignal.reason || 'upstream-aborted');
            };
            baseSignal.addEventListener('abort', onBaseAbort, { once: true });
        }
    }

    const clearWaitingTimer = () => {
        if (!waitingTimer) return;
        clearTimeout(waitingTimer);
        waitingTimer = null;
    };

    const clearInactivityTimer = () => {
        if (!inactivityTimer) return;
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    };

    const triggerTimeout = (reason) => {
        if (timeoutTriggered) return;
        timeoutTriggered = true;
        timeoutReason = reason || 'chat-messages-timeout';
        controller.abort(timeoutReason);
    };

    const armWaitingTimer = () => {
        if (timeoutMode !== 'waiting' || timeoutTriggered) return;
        clearWaitingTimer();
        waitingTimer = setTimeout(() => {
            triggerTimeout('chat-messages-waiting-timeout');
        }, Number(timeoutMs));
    };

    const armInactivityTimer = () => {
        if (timeoutTriggered) return;
        clearInactivityTimer();
        inactivityTimer = setTimeout(() => {
            triggerTimeout('chat-messages-inactive-timeout');
        }, Number(timeoutMs));
    };

    const notifyEvent = () => {
        armInactivityTimer();
    };

    const setWaitingMode = () => {
        if (timeoutTriggered) return;
        timeoutMode = 'waiting';
        armWaitingTimer();
        notifyEvent();
    };

    const setOutputMode = () => {
        if (timeoutTriggered) return;
        timeoutMode = 'output';
        clearWaitingTimer();
        notifyEvent();
    };

    const cleanup = () => {
        clearWaitingTimer();
        clearInactivityTimer();
        if (onBaseAbort && isAbortSignalLike(baseSignal)) {
            baseSignal.removeEventListener('abort', onBaseAbort);
            onBaseAbort = null;
        }
    };

    armWaitingTimer();
    armInactivityTimer();

    return {
        args: buildFetchArgsWithSignal(first, second, controller.signal),
        cleanup,
        isTimeoutTriggered: () => timeoutTriggered,
        getTimeoutReason: () => timeoutReason,
        setWaitingMode,
        setOutputMode,
        notifyEvent,
        getTimeoutMode: () => timeoutMode,
    };
}

export function buildTimeoutInfo({ timeoutSeconds = 0, reason = '' } = {}) {
    if (reason === 'chat-messages-waiting-timeout') {
        return {
            code: 'waiting_timeout',
            message: `等待中超过 ${timeoutSeconds} 秒`,
        };
    }
    if (reason === 'chat-messages-inactive-timeout') {
        return {
            code: 'inactive_timeout',
            message: `超过 ${timeoutSeconds} 秒未收到事件`,
        };
    }
    return {
        code: 'timeout',
        message: `超过 ${timeoutSeconds} 秒未完成`,
    };
}
