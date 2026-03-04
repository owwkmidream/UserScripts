export function getUnsafeWindow() {
    const candidate = globalThis && globalThis.unsafeWindow;
    if (!candidate) return null;
    if (candidate === window) return null;
    return candidate;
}

export function getTargetWindow() {
    return getUnsafeWindow() || window;
}

export function publishMonitorState(targetWindow, state) {
    try {
        window.__AF_CHAT_MONITOR__ = state;
    } catch {}
    if (!targetWindow || targetWindow === window) return;
    try {
        targetWindow.__AF_CHAT_MONITOR__ = state;
    } catch {}
}

export function appendMonitorState(targetWindow, patch) {
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
