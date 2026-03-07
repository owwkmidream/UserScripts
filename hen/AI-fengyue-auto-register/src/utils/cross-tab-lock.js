const DEFAULT_TAB_ID_SESSION_KEY = 'aifengyue_tab_id';
let memoryTabId = '';

function trimText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function toPositiveTimestamp(value, fallback = 0) {
    const numberValue = Math.floor(Number(value));
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function normalizeLockRecord(record = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const ownerTabId = trimText(record.ownerTabId);
    const nonce = trimText(record.nonce);
    if (!ownerTabId || !nonce) return null;

    return {
        ownerTabId,
        ownerRunId: trimText(record.ownerRunId),
        reason: trimText(record.reason),
        meta: record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta)
            ? { ...record.meta }
            : null,
        acquiredAt: toPositiveTimestamp(record.acquiredAt, 0),
        heartbeatAt: toPositiveTimestamp(record.heartbeatAt, 0),
        expiresAt: toPositiveTimestamp(record.expiresAt, 0),
        nonce,
    };
}

function createTabId(prefix = 'TAB') {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${stamp}-${rand}`;
}

function readLockRecord(lockKey) {
    const normalizedKey = trimText(lockKey);
    if (!normalizedKey) return null;

    try {
        const raw = localStorage.getItem(normalizedKey);
        if (!raw) return null;
        return normalizeLockRecord(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function getCurrentTabId({
    sessionKey = DEFAULT_TAB_ID_SESSION_KEY,
    prefix = 'TAB',
} = {}) {
    if (memoryTabId) return memoryTabId;

    const normalizedKey = trimText(sessionKey) || DEFAULT_TAB_ID_SESSION_KEY;
    try {
        const existing = trimText(sessionStorage.getItem(normalizedKey));
        if (existing) {
            memoryTabId = existing;
            return memoryTabId;
        }

        memoryTabId = createTabId(prefix);
        sessionStorage.setItem(normalizedKey, memoryTabId);
        return memoryTabId;
    } catch {
        if (!memoryTabId) {
            memoryTabId = createTabId(prefix);
        }
        return memoryTabId;
    }
}

export function readActiveCrossTabLock(lockKey, { now = Date.now() } = {}) {
    const record = readLockRecord(lockKey);
    if (!record) return null;
    return record.expiresAt > now ? record : null;
}

export function isCrossTabLockOwnedBy(lockRecord, { ownerTabId = '', nonce = '' } = {}) {
    const resolvedOwnerTabId = trimText(ownerTabId);
    const resolvedNonce = trimText(nonce);
    if (!lockRecord || !resolvedOwnerTabId) return false;
    if (trimText(lockRecord.ownerTabId) !== resolvedOwnerTabId) return false;
    if (resolvedNonce && trimText(lockRecord.nonce) !== resolvedNonce) return false;
    return toPositiveTimestamp(lockRecord.expiresAt, 0) > Date.now();
}

export function tryAcquireCrossTabLock(lockKey, {
    ownerTabId = '',
    ownerRunId = '',
    reason = '',
    ttlMs = 30000,
    meta = null,
} = {}) {
    const resolvedOwnerTabId = trimText(ownerTabId);
    if (!resolvedOwnerTabId) {
        return {
            ok: false,
            record: null,
        };
    }

    const now = Date.now();
    const current = readActiveCrossTabLock(lockKey, { now });
    if (current && current.ownerTabId !== resolvedOwnerTabId) {
        return {
            ok: false,
            record: current,
        };
    }

    const nextRecord = {
        ownerTabId: resolvedOwnerTabId,
        ownerRunId: trimText(ownerRunId),
        reason: trimText(reason),
        meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : null,
        acquiredAt: current?.ownerTabId === resolvedOwnerTabId
            ? toPositiveTimestamp(current.acquiredAt, now)
            : now,
        heartbeatAt: now,
        expiresAt: now + Math.max(1000, Math.floor(Number(ttlMs) || 0)),
        nonce: `${resolvedOwnerTabId}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    };

    try {
        localStorage.setItem(lockKey, JSON.stringify(nextRecord));
    } catch {
        return {
            ok: false,
            record: current,
        };
    }

    const confirmed = readActiveCrossTabLock(lockKey);
    return {
        ok: !!confirmed
            && confirmed.ownerTabId === resolvedOwnerTabId
            && confirmed.nonce === nextRecord.nonce,
        record: confirmed,
    };
}

export function renewCrossTabLock(lockKey, {
    ownerTabId = '',
    nonce = '',
    ownerRunId = '',
    reason = null,
    ttlMs = 30000,
    meta = undefined,
} = {}) {
    const resolvedOwnerTabId = trimText(ownerTabId);
    const resolvedNonce = trimText(nonce);
    const current = readActiveCrossTabLock(lockKey);
    if (!current || current.ownerTabId !== resolvedOwnerTabId || (resolvedNonce && current.nonce !== resolvedNonce)) {
        return {
            ok: false,
            record: current,
        };
    }

    const now = Date.now();
    const nextRecord = {
        ...current,
        ownerRunId: trimText(ownerRunId) || current.ownerRunId,
        reason: reason === null ? current.reason : trimText(reason),
        heartbeatAt: now,
        expiresAt: now + Math.max(1000, Math.floor(Number(ttlMs) || 0)),
    };
    if (meta !== undefined) {
        nextRecord.meta = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : null;
    }

    try {
        localStorage.setItem(lockKey, JSON.stringify(nextRecord));
    } catch {
        return {
            ok: false,
            record: current,
        };
    }

    const confirmed = readActiveCrossTabLock(lockKey);
    return {
        ok: !!confirmed
            && confirmed.ownerTabId === resolvedOwnerTabId
            && confirmed.nonce === current.nonce,
        record: confirmed,
    };
}

export function releaseCrossTabLock(lockKey, {
    ownerTabId = '',
    nonce = '',
} = {}) {
    const resolvedOwnerTabId = trimText(ownerTabId);
    const resolvedNonce = trimText(nonce);
    const current = readActiveCrossTabLock(lockKey);
    if (!current || current.ownerTabId !== resolvedOwnerTabId || (resolvedNonce && current.nonce !== resolvedNonce)) {
        return false;
    }

    if (current.expiresAt <= Date.now()) {
        return false;
    }

    try {
        localStorage.removeItem(lockKey);
    } catch {
        return false;
    }

    const confirmed = readActiveCrossTabLock(lockKey);
    return !(confirmed && confirmed.ownerTabId === resolvedOwnerTabId && (!resolvedNonce || confirmed.nonce === resolvedNonce));
}
