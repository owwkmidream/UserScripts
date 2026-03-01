import { CONFIG } from '../constants.js';
import { gmGetValue, gmSetValue } from '../gm.js';

const PREFIX = 'AI风月注册助手';

function output(level, text, meta) {
    if (level === 'ERROR') {
        if (meta === undefined) console.error(text);
        else console.error(text, meta);
        return;
    }
    if (level === 'WARN') {
        if (meta === undefined) console.warn(text);
        else console.warn(text, meta);
        return;
    }
    if (level === 'DEBUG') {
        if (meta === undefined) console.debug(text);
        else console.debug(text, meta);
        return;
    }

    if (meta === undefined) console.log(text);
    else console.log(text, meta);
}

function baseLog(level, runCtx, step, message, meta) {
    const runId = runCtx?.runId || 'NO-RUN';
    const tag = `[${PREFIX}][${runId}][${level}][${step}] ${message}`;
    output(level, tag, meta);
}

export function createRunContext(prefix = 'AR') {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return {
        runId: `${prefix}-${stamp}-${rand}`,
        startedAt: Date.now(),
    };
}

export function isDebugEnabled() {
    return !!gmGetValue(CONFIG.STORAGE_KEYS.LOG_DEBUG_ENABLED, false);
}

export function setDebugEnabled(enabled) {
    gmSetValue(CONFIG.STORAGE_KEYS.LOG_DEBUG_ENABLED, !!enabled);
}

export function toggleDebugEnabled() {
    const next = !isDebugEnabled();
    setDebugEnabled(next);
    return next;
}

export function logInfo(runCtx, step, message, meta) {
    baseLog('INFO', runCtx, step, message, meta);
}

export function logWarn(runCtx, step, message, meta) {
    baseLog('WARN', runCtx, step, message, meta);
}

export function logError(runCtx, step, message, meta) {
    baseLog('ERROR', runCtx, step, message, meta);
}

export function logDebug(runCtx, step, message, meta) {
    if (!isDebugEnabled()) return;
    baseLog('DEBUG', runCtx, step, message, meta);
}
