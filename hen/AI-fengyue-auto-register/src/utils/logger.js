import { CONFIG } from '../constants.js';
import { gmGetValue, gmSetValue } from '../gm.js';

const PREFIX = 'AI风月注册助手';
const LOG_STORAGE_KEY = CONFIG.STORAGE_KEYS.RUNTIME_LOG_BUFFER;
const LOG_ENTRY_LIMIT = 240;
const LOG_STRING_LIMIT = 400;
const LOG_MAX_DEPTH = 3;
const LOG_MAX_KEYS = 12;
const LOG_MAX_ARRAY = 12;
const runtimeLogSubscribers = new Set();
let runtimeLogMemoryFallback = [];

function trimText(value, maxLength = LOG_STRING_LIMIT) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…`;
}

function sanitizeLogMeta(value, depth = 0, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return trimText(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
        return {
            name: value.name || 'Error',
            message: trimText(value.message || ''),
            stack: trimText(value.stack || '', 1200),
        };
    }

    if (typeof Element !== 'undefined' && value instanceof Element) {
        const id = value.id ? `#${value.id}` : '';
        const className = typeof value.className === 'string' && value.className.trim()
            ? `.${value.className.trim().replace(/\s+/g, '.')}`
            : '';
        return `[Element ${value.tagName?.toLowerCase?.() || 'unknown'}${id}${className}]`;
    }

    if (depth >= LOG_MAX_DEPTH) {
        if (Array.isArray(value)) return `[Array(${value.length})]`;
        return '[Object]';
    }

    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);

        if (Array.isArray(value)) {
            const normalized = value.slice(0, LOG_MAX_ARRAY).map((item) => sanitizeLogMeta(item, depth + 1, seen));
            if (value.length > LOG_MAX_ARRAY) {
                normalized.push(`…(${value.length - LOG_MAX_ARRAY} more)`);
            }
            return normalized;
        }

        const normalized = {};
        const entries = Object.entries(value).slice(0, LOG_MAX_KEYS);
        entries.forEach(([key, item]) => {
            normalized[key] = sanitizeLogMeta(item, depth + 1, seen);
        });
        if (Object.keys(value).length > LOG_MAX_KEYS) {
            normalized.__truncated__ = `${Object.keys(value).length - LOG_MAX_KEYS} more keys`;
        }
        return normalized;
    }

    return trimText(value);
}

function normalizeLogEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter((entry) => entry && typeof entry === 'object')
        .slice(-LOG_ENTRY_LIMIT);
}

function readStoredRuntimeLogs() {
    try {
        const raw = localStorage.getItem(LOG_STORAGE_KEY);
        if (!raw) return runtimeLogMemoryFallback.slice();
        const parsed = JSON.parse(raw);
        const normalized = normalizeLogEntries(parsed);
        runtimeLogMemoryFallback = normalized;
        return normalized.slice();
    } catch {
        return runtimeLogMemoryFallback.slice();
    }
}

function persistRuntimeLogs(entries) {
    const normalized = normalizeLogEntries(entries);
    runtimeLogMemoryFallback = normalized;

    try {
        localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(normalized));
        return normalized.slice();
    } catch {
        const compact = normalized.slice(-Math.max(80, Math.floor(LOG_ENTRY_LIMIT / 2)));
        runtimeLogMemoryFallback = compact;
        try {
            localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(compact));
        } catch {}
        return compact.slice();
    }
}

function emitRuntimeLogChange(entry = null) {
    runtimeLogSubscribers.forEach((listener) => {
        try {
            listener(entry);
        } catch {}
    });
}

function appendRuntimeLog(entry) {
    const entries = readStoredRuntimeLogs();
    entries.push(entry);
    persistRuntimeLogs(entries);
    emitRuntimeLogChange(entry);
}

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
    const createdAt = Date.now();
    const runId = runCtx?.runId || 'NO-RUN';
    const tag = `[${PREFIX}][${runId}][${level}][${step}] ${message}`;
    output(level, tag, meta);
    appendRuntimeLog({
        id: `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt,
        level,
        runId,
        step: typeof step === 'string' ? step : String(step ?? ''),
        message: trimText(message, 800),
        text: trimText(tag, 1200),
        meta: meta === undefined ? null : sanitizeLogMeta(meta),
    });
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

export function readRuntimeLogEntries({ limit = LOG_ENTRY_LIMIT } = {}) {
    const normalizedLimit = Number(limit);
    const entries = readStoredRuntimeLogs();
    if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
        return entries;
    }
    return entries.slice(-Math.floor(normalizedLimit));
}

export function clearRuntimeLogEntries() {
    runtimeLogMemoryFallback = [];
    try {
        localStorage.removeItem(LOG_STORAGE_KEY);
    } catch {}
    emitRuntimeLogChange(null);
}

export function subscribeRuntimeLogChange(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    runtimeLogSubscribers.add(listener);
    return () => {
        runtimeLogSubscribers.delete(listener);
    };
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
