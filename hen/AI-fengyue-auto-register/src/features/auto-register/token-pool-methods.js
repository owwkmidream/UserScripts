import { CONFIG } from '../../constants.js';
import { Sidebar } from '../../ui/sidebar.js';
import {
    getCurrentTabId,
    isCrossTabLockOwnedBy,
    readActiveCrossTabLock,
    releaseCrossTabLock,
    renewCrossTabLock,
    tryAcquireCrossTabLock,
} from '../../utils/cross-tab-lock.js';
import {
    createRunContext,
    logDebug,
    logInfo,
    logWarn,
} from '../../utils/logger.js';

const TOKEN_POOL_TARGET_FULL_COUNT = 2;
const TOKEN_POOL_MAX_COUNT = 5;
const TOKEN_POOL_FULL_POINTS = 5000;
const TOKEN_POOL_CHECK_DEFAULT_SECONDS = 300;
const TOKEN_POOL_CHECK_MAX_SECONDS = 3600;
const TOKEN_POOL_BACKOFF_MINUTES = [1, 2, 5, 10, 30];
const TOKEN_POOL_LOCK_TTL_MS = 120000;
const TOKEN_POOL_LOCK_HEARTBEAT_MS = 15000;

function toFiniteNumber(value, fallback = 0) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return numberValue;
}

function normalizeTimestampMs(value, fallback = 0) {
    const numberValue = Math.floor(toFiniteNumber(value, fallback));
    return numberValue > 0 ? numberValue : fallback;
}

export const TokenPoolMethods = {
    normalizeTokenPoolCheckSeconds(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return TOKEN_POOL_CHECK_DEFAULT_SECONDS;
        const normalized = Math.floor(parsed);
        if (normalized <= 0) return 0;
        return Math.min(normalized, TOKEN_POOL_CHECK_MAX_SECONDS);
    },


    getTokenPoolCheckSeconds() {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS);
        const fallback = TOKEN_POOL_CHECK_DEFAULT_SECONDS;
        return this.normalizeTokenPoolCheckSeconds(raw === null ? fallback : raw);
    },


    setTokenPoolCheckSeconds(value) {
        const normalized = this.normalizeTokenPoolCheckSeconds(value);
        localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS, String(normalized));
        return normalized;
    },


    getTokenPoolTabId() {
        if (typeof this.tokenPoolTabId === 'string' && this.tokenPoolTabId.trim()) {
            return this.tokenPoolTabId.trim();
        }
        this.tokenPoolTabId = getCurrentTabId({
            sessionKey: 'aifengyue_token_pool_tab_id',
            prefix: 'POOLTAB',
        });
        return this.tokenPoolTabId;
    },


    ensureTokenPoolStorageSync() {
        if (this.tokenPoolStorageSyncBound) return;
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

        this.tokenPoolStorageHandler = (event) => {
            const key = typeof event?.key === 'string' ? event.key : '';
            if (!key) return;

            const relevantKeys = new Set([
                CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS,
                CONFIG.STORAGE_KEYS.TOKEN_POOL_ENTRIES,
                CONFIG.STORAGE_KEYS.TOKEN_POOL_LOCK,
                CONFIG.STORAGE_KEYS.TOKEN_POOL_SUMMARY,
                CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_CHECK_AT,
                CONFIG.STORAGE_KEYS.TOKEN_POOL_NEXT_ALLOWED_AT,
                CONFIG.STORAGE_KEYS.TOKEN_POOL_BACKOFF_LEVEL,
                CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_ERROR,
                CONFIG.STORAGE_KEYS.RUNTIME_LOG_BUFFER,
            ]);
            if (!relevantKeys.has(key)) return;

            if (key === CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS) {
                this.refreshTokenPoolScheduler({
                    reason: 'storage-sync',
                    runImmediate: false,
                    persistSummary: false,
                });
            }

            const summary = this.getTokenPoolSummary();
            Sidebar.refreshTokenPoolSummary?.(summary);
            if (Sidebar.tokenPoolLogModalOpen) {
                Sidebar.renderTokenPoolLogModal?.();
            }
        };

        window.addEventListener('storage', this.tokenPoolStorageHandler);
        this.tokenPoolStorageSyncBound = true;
    },


    normalizeStoredTokenPoolSummary(summary = {}) {
        if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;

        return {
            reason: typeof summary.reason === 'string' ? summary.reason.trim() : '',
            status: typeof summary.status === 'string' ? summary.status.trim() : 'idle',
            runId: typeof summary.runId === 'string' ? summary.runId.trim() : '',
            fullCount: Math.max(0, Math.floor(toFiniteNumber(summary.fullCount, 0))),
            totalCount: Math.max(0, Math.floor(toFiniteNumber(summary.totalCount, 0))),
            targetFullCount: Math.max(0, Math.floor(toFiniteNumber(summary.targetFullCount, TOKEN_POOL_TARGET_FULL_COUNT))),
            maxCount: Math.max(0, Math.floor(toFiniteNumber(summary.maxCount, TOKEN_POOL_MAX_COUNT))),
            fullPointThreshold: Math.max(0, Math.floor(toFiniteNumber(summary.fullPointThreshold, TOKEN_POOL_FULL_POINTS))),
            intervalSeconds: this.normalizeTokenPoolCheckSeconds(summary.intervalSeconds),
            schedulerEnabled: !!summary.schedulerEnabled,
            schedulerRunning: !!summary.schedulerRunning,
            maintaining: !!summary.maintaining,
            lastCheckAt: normalizeTimestampMs(summary.lastCheckAt, 0),
            nextAllowedAt: normalizeTimestampMs(summary.nextAllowedAt, 0),
            backoffLevel: Math.max(0, Math.floor(toFiniteNumber(summary.backoffLevel, 0))),
            lastError: typeof summary.lastError === 'string' ? summary.lastError.trim() : '',
            lockOwnerTabId: typeof summary.lockOwnerTabId === 'string' ? summary.lockOwnerTabId.trim() : '',
            lockOwnerRunId: typeof summary.lockOwnerRunId === 'string' ? summary.lockOwnerRunId.trim() : '',
            lockReason: typeof summary.lockReason === 'string' ? summary.lockReason.trim() : '',
            lockAcquiredAt: normalizeTimestampMs(summary.lockAcquiredAt, 0),
            lockHeartbeatAt: normalizeTimestampMs(summary.lockHeartbeatAt, 0),
            lockExpiresAt: normalizeTimestampMs(summary.lockExpiresAt, 0),
            lockHeldByCurrentTab: !!summary.lockHeldByCurrentTab,
            updatedAt: normalizeTimestampMs(summary.updatedAt, Date.now()),
        };
    },


    readSharedTokenPoolSummary() {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_SUMMARY);
            if (!raw) return null;
            return this.normalizeStoredTokenPoolSummary(JSON.parse(raw));
        } catch {
            return null;
        }
    },


    writeSharedTokenPoolSummary(summary) {
        const normalized = this.normalizeStoredTokenPoolSummary(summary);
        if (!normalized) return null;
        try {
            localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_SUMMARY, JSON.stringify(normalized));
        } catch {}
        return normalized;
    },


    readActiveTokenPoolLock() {
        return readActiveCrossTabLock(CONFIG.STORAGE_KEYS.TOKEN_POOL_LOCK);
    },


    isTokenPoolAcquireReason(reason = '') {
        const normalizedReason = typeof reason === 'string' ? reason.trim().toLowerCase() : '';
        return normalizedReason.includes('acquire');
    },


    getTokenPoolLockStatusFallback(reason = '') {
        return this.isTokenPoolAcquireReason(reason) ? 'locked' : 'maintaining';
    },


    buildTokenPoolLockMeta(lockRecord = null) {
        const currentTabId = this.getTokenPoolTabId();
        return {
            lockOwnerTabId: typeof lockRecord?.ownerTabId === 'string' ? lockRecord.ownerTabId.trim() : '',
            lockOwnerRunId: typeof lockRecord?.ownerRunId === 'string' ? lockRecord.ownerRunId.trim() : '',
            lockReason: typeof lockRecord?.reason === 'string' ? lockRecord.reason.trim() : '',
            lockAcquiredAt: normalizeTimestampMs(lockRecord?.acquiredAt, 0),
            lockHeartbeatAt: normalizeTimestampMs(lockRecord?.heartbeatAt, 0),
            lockExpiresAt: normalizeTimestampMs(lockRecord?.expiresAt, 0),
            lockHeldByCurrentTab: !!lockRecord && lockRecord.ownerTabId === currentTabId,
        };
    },


    reconcileTokenPoolSummary(summary = null) {
        const resolvedSummary = this.normalizeStoredTokenPoolSummary(summary || {}) || this.buildTokenPoolSummary({
            reason: 'initial',
            status: 'idle',
        });
        const activeLock = this.readActiveTokenPoolLock();
        const lockMeta = this.buildTokenPoolLockMeta(activeLock);
        const nextSummary = {
            ...resolvedSummary,
            ...lockMeta,
        };

        if (!activeLock) {
            nextSummary.maintaining = false;
            if (nextSummary.status === 'maintaining' || nextSummary.status === 'locked') {
                nextSummary.status = nextSummary.schedulerEnabled
                    ? (nextSummary.schedulerRunning ? 'running' : 'idle')
                    : 'idle';
            }
            return nextSummary;
        }

        if (nextSummary.status === 'idle' || nextSummary.status === 'running') {
            nextSummary.status = this.getTokenPoolLockStatusFallback(activeLock.reason);
        }

        nextSummary.maintaining = nextSummary.status === 'maintaining';
        return nextSummary;
    },


    getTokenPoolActiveLocalSummary() {
        return this.tokenPoolLastSummary && typeof this.tokenPoolLastSummary === 'object'
            ? this.tokenPoolLastSummary
            : null;
    },


    syncTokenPoolSummaryFromStorage() {
        const storedSummary = this.readSharedTokenPoolSummary();
        const localSummary = this.getTokenPoolActiveLocalSummary();
        const localUpdatedAt = normalizeTimestampMs(localSummary?.updatedAt, 0);
        const storedUpdatedAt = normalizeTimestampMs(storedSummary?.updatedAt, 0);

        if (storedSummary && (!localSummary || storedUpdatedAt >= localUpdatedAt)) {
            this.tokenPoolLastSummary = this.reconcileTokenPoolSummary(storedSummary);
        }
        return this.tokenPoolLastSummary;
    },


    tryAcquireTokenPoolLock({ runCtx, reason = 'maintain' } = {}) {
        const ctx = runCtx || createRunContext('POOL_LOCK');
        const currentTabId = this.getTokenPoolTabId();
        const result = tryAcquireCrossTabLock(CONFIG.STORAGE_KEYS.TOKEN_POOL_LOCK, {
            ownerTabId: currentTabId,
            ownerRunId: ctx.runId,
            reason,
            ttlMs: TOKEN_POOL_LOCK_TTL_MS,
            meta: {
                href: window.location.href,
            },
        });

        if (result.ok) {
            this.tokenPoolActiveLock = result.record;
        }
        return result;
    },


    renewTokenPoolActiveLock({ runCtx, reason = null } = {}) {
        const currentLock = this.tokenPoolActiveLock;
        if (!currentLock) {
            return {
                ok: false,
                record: this.readActiveTokenPoolLock(),
            };
        }

        const result = renewCrossTabLock(CONFIG.STORAGE_KEYS.TOKEN_POOL_LOCK, {
            ownerTabId: this.getTokenPoolTabId(),
            nonce: currentLock.nonce,
            ownerRunId: typeof runCtx?.runId === 'string' ? runCtx.runId.trim() : currentLock.ownerRunId,
            reason,
            ttlMs: TOKEN_POOL_LOCK_TTL_MS,
        });
        if (result.ok) {
            this.tokenPoolActiveLock = result.record;
        }
        return result;
    },


    assertTokenPoolLockOwned(lockRecord, runCtx, step = 'TOKEN_POOL_LOCK_ASSERT') {
        const currentLock = this.readActiveTokenPoolLock();
        if (!isCrossTabLockOwnedBy(currentLock, {
            ownerTabId: this.getTokenPoolTabId(),
            nonce: lockRecord?.nonce || '',
        })) {
            logWarn(runCtx, step, '号池跨标签页锁已丢失，中止当前操作', {
                expectedNonce: typeof lockRecord?.nonce === 'string' ? lockRecord.nonce : '',
                currentLock,
            });
            throw new Error('号池锁已失效，当前操作已中止');
        }
        this.tokenPoolActiveLock = currentLock;
        return currentLock;
    },


    startTokenPoolLockHeartbeat({ runCtx, reason = null } = {}) {
        this.stopTokenPoolLockHeartbeat();
        if (!this.tokenPoolActiveLock) return;

        this.tokenPoolLockHeartbeatTimer = setInterval(() => {
            const renewResult = this.renewTokenPoolActiveLock({
                runCtx,
                reason,
            });
            if (renewResult.ok) return;

            this.stopTokenPoolLockHeartbeat();
            logWarn(runCtx, 'TOKEN_POOL_LOCK', '号池锁续租失败，后续写操作将自动中止', {
                reason,
                currentLock: renewResult.record,
            });
            Sidebar.refreshTokenPoolSummary?.(this.getTokenPoolSummary());
        }, TOKEN_POOL_LOCK_HEARTBEAT_MS);
    },


    stopTokenPoolLockHeartbeat() {
        if (this.tokenPoolLockHeartbeatTimer) {
            clearInterval(this.tokenPoolLockHeartbeatTimer);
            this.tokenPoolLockHeartbeatTimer = null;
        }
    },


    releaseTokenPoolActiveLock({ runCtx } = {}) {
        const currentLock = this.tokenPoolActiveLock;
        this.stopTokenPoolLockHeartbeat();
        if (!currentLock) return false;

        const released = releaseCrossTabLock(CONFIG.STORAGE_KEYS.TOKEN_POOL_LOCK, {
            ownerTabId: this.getTokenPoolTabId(),
            nonce: currentLock.nonce,
        });
        if (!released) {
            logDebug(runCtx, 'TOKEN_POOL_LOCK', '号池锁释放跳过（可能已过期或被接管）', {
                nonce: currentLock.nonce,
            });
        }
        this.tokenPoolActiveLock = null;
        return released;
    },


    readTokenPoolBackoffState() {
        return {
            lastCheckAt: normalizeTimestampMs(localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_CHECK_AT), 0),
            nextAllowedAt: normalizeTimestampMs(localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_NEXT_ALLOWED_AT), 0),
            backoffLevel: Math.max(0, Math.floor(toFiniteNumber(localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_BACKOFF_LEVEL), 0))),
            lastError: (localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_ERROR) || '').trim(),
        };
    },


    writeTokenPoolBackoffState({
        lastCheckAt = null,
        nextAllowedAt = null,
        backoffLevel = null,
        lastError = null,
    } = {}) {
        if (lastCheckAt !== null) {
            localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_CHECK_AT, String(normalizeTimestampMs(lastCheckAt, 0)));
        }
        if (nextAllowedAt !== null) {
            localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_NEXT_ALLOWED_AT, String(normalizeTimestampMs(nextAllowedAt, 0)));
        }
        if (backoffLevel !== null) {
            const normalized = Math.max(0, Math.floor(toFiniteNumber(backoffLevel, 0)));
            localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_BACKOFF_LEVEL, String(normalized));
        }
        if (lastError !== null) {
            const text = typeof lastError === 'string' ? lastError.trim() : String(lastError ?? '').trim();
            localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_ERROR, text);
        }
    },


    clearTokenPoolBackoffState() {
        this.writeTokenPoolBackoffState({
            nextAllowedAt: 0,
            backoffLevel: 0,
            lastError: '',
        });
    },


    applyTokenPoolBackoff(error, runCtx) {
        const previous = this.readTokenPoolBackoffState();
        const nextLevel = Math.min(
            TOKEN_POOL_BACKOFF_MINUTES.length,
            Math.max(1, previous.backoffLevel + 1)
        );
        const waitMinutes = TOKEN_POOL_BACKOFF_MINUTES[nextLevel - 1] || TOKEN_POOL_BACKOFF_MINUTES[TOKEN_POOL_BACKOFF_MINUTES.length - 1];
        const waitMs = waitMinutes * 60 * 1000;
        const now = Date.now();
        const nextAllowedAt = now + waitMs;
        const errorMessage = error?.message || String(error);

        this.writeTokenPoolBackoffState({
            lastCheckAt: now,
            nextAllowedAt,
            backoffLevel: nextLevel,
            lastError: errorMessage,
        });
        logWarn(runCtx, 'TOKEN_POOL_BACKOFF', '号池维护失败，进入退避等待', {
            nextLevel,
            waitMinutes,
            nextAllowedAt,
            errorMessage,
        });
    },


    normalizeTokenPoolEntry(entry = {}, fallbackNow = Date.now()) {
        const token = typeof entry?.token === 'string' ? entry.token.trim() : '';
        if (!token) return null;

        const points = toFiniteNumber(entry?.points, -1);
        const isFull = points >= TOKEN_POOL_FULL_POINTS;
        const createdAt = normalizeTimestampMs(entry?.createdAt, fallbackNow);
        const lastCheckedAt = normalizeTimestampMs(entry?.lastCheckedAt, createdAt);
        const lastUsedAt = normalizeTimestampMs(entry?.lastUsedAt, 0);
        const source = 'auto-register';
        const status = isFull ? 'full' : 'partial';

        return {
            token,
            points,
            isFull,
            createdAt,
            lastCheckedAt,
            lastUsedAt,
            source,
            status,
        };
    },


    normalizeTokenPoolEntries(entries, { excludeCurrentToken = true, onlyFull = true } = {}) {
        const now = Date.now();
        const list = Array.isArray(entries) ? entries : [];
        const currentToken = excludeCurrentToken
            ? (localStorage.getItem('console_token') || '').trim()
            : '';
        const dedupMap = new Map();

        for (const item of list) {
            const normalized = this.normalizeTokenPoolEntry(item, now);
            if (!normalized) continue;
            if (excludeCurrentToken && currentToken && normalized.token === currentToken) continue;
            if (onlyFull && !normalized.isFull) continue;

            const existing = dedupMap.get(normalized.token);
            if (!existing || normalized.lastCheckedAt > existing.lastCheckedAt) {
                dedupMap.set(normalized.token, normalized);
            }
        }

        return Array.from(dedupMap.values())
            .sort((a, b) => b.lastCheckedAt - a.lastCheckedAt || b.createdAt - a.createdAt)
            .slice(0, TOKEN_POOL_MAX_COUNT);
    },


    readTokenPool({ repair = false } = {}) {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_ENTRIES);
        let parsed = [];
        if (raw) {
            try {
                parsed = JSON.parse(raw);
            } catch {
                parsed = [];
            }
        }
        const normalized = this.normalizeTokenPoolEntries(parsed, {
            excludeCurrentToken: true,
            onlyFull: true,
        });
        const normalizedRaw = JSON.stringify(normalized);
        if (repair && raw !== normalizedRaw) {
            localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_ENTRIES, normalizedRaw);
        }
        return normalized;
    },


    writeTokenPool(entries = []) {
        const normalized = this.normalizeTokenPoolEntries(entries, {
            excludeCurrentToken: true,
            onlyFull: true,
        });
        localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_ENTRIES, JSON.stringify(normalized));
        return normalized;
    },


    buildTokenPoolSummary({
        entries = null,
        reason = '',
        status = 'idle',
        runId = '',
        lockRecord = undefined,
    } = {}) {
        const resolvedEntries = Array.isArray(entries) ? entries : this.readTokenPool();
        const fullCount = resolvedEntries.length;
        const backoff = this.readTokenPoolBackoffState();
        const intervalSeconds = this.getTokenPoolCheckSeconds();
        const resolvedRunId = typeof runId === 'string' ? runId.trim() : '';
        const resolvedLock = lockRecord === undefined ? this.readActiveTokenPoolLock() : lockRecord;
        const lockMeta = this.buildTokenPoolLockMeta(resolvedLock);
        let resolvedStatus = typeof status === 'string' && status.trim() ? status.trim() : 'idle';
        if (resolvedLock && (resolvedStatus === 'idle' || resolvedStatus === 'running')) {
            resolvedStatus = this.getTokenPoolLockStatusFallback(resolvedLock.reason);
        }

        return {
            reason: reason || '',
            status: resolvedStatus,
            runId: resolvedRunId,
            fullCount,
            totalCount: resolvedEntries.length,
            targetFullCount: TOKEN_POOL_TARGET_FULL_COUNT,
            maxCount: TOKEN_POOL_MAX_COUNT,
            fullPointThreshold: TOKEN_POOL_FULL_POINTS,
            intervalSeconds,
            schedulerEnabled: intervalSeconds > 0,
            schedulerRunning: !!this.tokenPoolTimer,
            maintaining: resolvedStatus === 'maintaining',
            lastCheckAt: backoff.lastCheckAt,
            nextAllowedAt: backoff.nextAllowedAt,
            backoffLevel: backoff.backoffLevel,
            lastError: backoff.lastError,
            ...lockMeta,
            updatedAt: Date.now(),
        };
    },


    updateTokenPoolSummary(summary, runCtx, { persist = true } = {}) {
        const resolvedSummary = summary && typeof summary === 'object'
            ? summary
            : this.buildTokenPoolSummary();
        const resolvedRunId = typeof resolvedSummary?.runId === 'string' && resolvedSummary.runId.trim()
            ? resolvedSummary.runId.trim()
            : (typeof runCtx?.runId === 'string' ? runCtx.runId.trim() : '');
        const resolved = this.reconcileTokenPoolSummary({
            ...resolvedSummary,
            runId: resolvedRunId,
        });
        this.tokenPoolLastSummary = resolved;
        if (persist) {
            this.writeSharedTokenPoolSummary(resolved);
        }
        Sidebar.refreshTokenPoolSummary?.(resolved);
        logDebug(runCtx, 'TOKEN_POOL_SUMMARY', '号池摘要已更新', resolved);
        return resolved;
    },


    getTokenPoolSummary() {
        this.ensureTokenPoolStorageSync();
        const syncedSummary = this.syncTokenPoolSummaryFromStorage();
        if (syncedSummary && typeof syncedSummary === 'object') {
            return syncedSummary;
        }
        if (this.tokenPoolLastSummary && typeof this.tokenPoolLastSummary === 'object') {
            this.tokenPoolLastSummary = this.reconcileTokenPoolSummary(this.tokenPoolLastSummary);
            return this.tokenPoolLastSummary;
        }
        return this.updateTokenPoolSummary(this.buildTokenPoolSummary({ reason: 'initial' }), null, {
            persist: false,
        });
    },


    async validateTokenPoolToken({ token, runCtx, step = 'TOKEN_POOL_VALIDATE' }) {
        const normalizedToken = typeof token === 'string' ? token.trim() : '';
        if (!normalizedToken) {
            return {
                ok: false,
                points: null,
                isFull: false,
                message: 'token 为空',
            };
        }

        try {
            const pointResult = await this.fetchAccountPoint({
                token: normalizedToken,
                runCtx,
                step,
                maxAttempts: 1,
            });
            const points = toFiniteNumber(pointResult?.points, NaN);
            if (!Number.isFinite(points)) {
                return {
                    ok: false,
                    points: null,
                    isFull: false,
                    message: '积分返回非法',
                };
            }
            const isFull = points >= TOKEN_POOL_FULL_POINTS;
            return {
                ok: isFull,
                points,
                isFull,
                message: isFull ? 'ok' : `积分不足(${points})`,
            };
        } catch (error) {
            return {
                ok: false,
                points: null,
                isFull: false,
                message: error?.message || String(error),
            };
        }
    },


    async acquireBestTokenFromPool({ runCtx } = {}) {
        const ctx = runCtx || createRunContext('POOL_ACQUIRE');
        this.ensureTokenPoolStorageSync();

        if (this.tokenPoolMaintaining || this.tokenPoolAcquiring) {
            this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: 'acquire-local-busy',
                status: 'locked',
                runId: ctx.runId,
                lockRecord: this.tokenPoolActiveLock || this.readActiveTokenPoolLock(),
            }), ctx, {
                persist: false,
            });
            return {
                token: '',
                points: null,
                source: 'pool-busy',
            };
        }

        this.tokenPoolAcquiring = true;
        const lockResult = this.tryAcquireTokenPoolLock({
            runCtx: ctx,
            reason: 'acquire',
        });
        if (!lockResult.ok) {
            logInfo(ctx, 'TOKEN_POOL_ACQUIRE', '号池当前被其他标签页占用，跳过本次消费', {
                lock: lockResult.record,
            });
            this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: 'acquire-locked',
                status: 'locked',
                runId: ctx.runId,
                lockRecord: lockResult.record,
            }), ctx, {
                persist: false,
            });
            this.tokenPoolAcquiring = false;
            return {
                token: '',
                points: null,
                source: 'pool-locked',
            };
        }

        const acquiredLock = lockResult.record;
        let summaryToPersist = null;
        let result = {
            token: '',
            points: null,
            source: 'pool-depleted',
        };

        try {
            let entries = this.readTokenPool({ repair: true });
            if (!entries.length) {
                summaryToPersist = this.buildTokenPoolSummary({
                    entries,
                    reason: 'acquire-empty',
                    status: 'empty',
                    runId: ctx.runId,
                    lockRecord: acquiredLock,
                });
                result = {
                    token: '',
                    points: null,
                    source: 'pool-empty',
                };
                return result;
            }

            for (let index = 0; index < entries.length; index++) {
                const entry = entries[index];
                const checkResult = await this.validateTokenPoolToken({
                    token: entry.token,
                    runCtx: ctx,
                    step: `TOKEN_POOL_ACQUIRE_VALIDATE_${index + 1}`,
                });
                this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_ACQUIRE_LOCK');

                if (!checkResult.ok) {
                    logWarn(ctx, 'TOKEN_POOL_ACQUIRE', '池中 token 校验未通过，已剔除', {
                        points: checkResult.points,
                        message: checkResult.message,
                    });
                    entries = entries.filter((item) => item.token !== entry.token);
                    this.writeTokenPool(entries);
                    continue;
                }

                const selectedToken = entry.token;
                entries = entries.filter((item) => item.token !== selectedToken);
                this.writeTokenPool(entries);
                summaryToPersist = this.buildTokenPoolSummary({
                    entries,
                    reason: 'acquire-hit',
                    status: 'ready',
                    runId: ctx.runId,
                    lockRecord: acquiredLock,
                });

                logInfo(ctx, 'TOKEN_POOL_ACQUIRE', '号池命中可用 token，已消费', {
                    points: checkResult.points,
                    remainingCount: entries.length,
                });
                result = {
                    token: selectedToken,
                    points: checkResult.points,
                    source: 'pool',
                };
                return result;
            }

            summaryToPersist = this.buildTokenPoolSummary({
                entries,
                reason: 'acquire-depleted',
                status: 'empty',
                runId: ctx.runId,
                lockRecord: acquiredLock,
            });
            return result;
        } finally {
            this.tokenPoolAcquiring = false;
            this.releaseTokenPoolActiveLock({
                runCtx: ctx,
            });
            if (summaryToPersist) {
                this.updateTokenPoolSummary(summaryToPersist, ctx);
            }
        }
    },


    async maintainTokenPool({ reason = 'manual', force = false, runCtx } = {}) {
        const ctx = runCtx || createRunContext('POOL');
        const resolvedReason = reason || 'maintain';
        const currentSummary = this.tokenPoolLastSummary && typeof this.tokenPoolLastSummary === 'object'
            ? this.tokenPoolLastSummary
            : null;
        this.ensureTokenPoolStorageSync();

        if (this.tokenPoolMaintaining) {
            return this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: currentSummary?.reason || resolvedReason,
                status: 'maintaining',
                runId: currentSummary?.runId || '',
                lockRecord: this.tokenPoolActiveLock || this.readActiveTokenPoolLock(),
            }), ctx, {
                persist: false,
            });
        }

        if (this.tokenPoolAcquiring) {
            return this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: resolvedReason,
                status: 'locked',
                runId: ctx.runId,
                lockRecord: this.tokenPoolActiveLock || this.readActiveTokenPoolLock(),
            }), ctx, {
                persist: false,
            });
        }

        const backoff = this.readTokenPoolBackoffState();
        const now = Date.now();
        if (!force && backoff.nextAllowedAt > now) {
            logInfo(ctx, 'TOKEN_POOL', '号池维护命中退避窗口，等待到期后再试', {
                reason: resolvedReason,
                nextAllowedAt: backoff.nextAllowedAt,
                backoffLevel: backoff.backoffLevel,
            });
            return this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: resolvedReason,
                status: 'backoff',
                runId: ctx.runId,
            }), ctx);
        }

        const lockResult = this.tryAcquireTokenPoolLock({
            runCtx: ctx,
            reason: resolvedReason,
        });
        if (!lockResult.ok) {
            logInfo(ctx, 'TOKEN_POOL_LOCK', '号池维护发现其他标签页已持锁，跳过本次执行', {
                reason: resolvedReason,
                lock: lockResult.record,
            });
            return this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: resolvedReason,
                status: 'locked',
                runId: ctx.runId,
                lockRecord: lockResult.record,
            }), ctx, {
                persist: false,
            });
        }

        const acquiredLock = lockResult.record;
        this.tokenPoolMaintaining = true;
        let finalStatus = 'failed';
        let finalEntries = null;
        let persistFinalSummary = true;
        try {
            this.startTokenPoolLockHeartbeat({
                runCtx: ctx,
                reason: resolvedReason,
            });
            logInfo(ctx, 'TOKEN_POOL', '号池维护开始', {
                reason: resolvedReason,
                force: !!force,
            });
            this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: resolvedReason,
                status: 'maintaining',
                runId: ctx.runId,
                lockRecord: acquiredLock,
            }), ctx);

            let entries = this.readTokenPool({ repair: true });
            if (entries.length > 0) {
                logInfo(ctx, 'TOKEN_POOL', `正在校验池内 ${entries.length} 个 token`, {
                    existingCount: entries.length,
                });
            } else {
                logInfo(ctx, 'TOKEN_POOL', '池内暂无可用 token，准备补充新账号');
            }
            const checkedEntries = [];
            for (let index = 0; index < entries.length; index++) {
                const item = entries[index];
                const checkResult = await this.validateTokenPoolToken({
                    token: item.token,
                    runCtx: ctx,
                    step: `TOKEN_POOL_CHECK_EXISTING_${index + 1}`,
                });
                this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_CHECK_EXISTING_LOCK');
                if (!checkResult.ok) {
                    logWarn(ctx, 'TOKEN_POOL', '号池现有 token 校验失败，已剔除', {
                        message: checkResult.message,
                    });
                    continue;
                }

                checkedEntries.push({
                    ...item,
                    points: checkResult.points,
                    isFull: true,
                    status: 'full',
                    lastCheckedAt: Date.now(),
                });
            }
            this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_WRITE_EXISTING_LOCK');
            entries = this.writeTokenPool(checkedEntries);

            const maxRegisterAttempts = Math.max(2, TOKEN_POOL_TARGET_FULL_COUNT * 3);
            let registerAttempts = 0;
            while (
                entries.length < TOKEN_POOL_TARGET_FULL_COUNT
                && entries.length < TOKEN_POOL_MAX_COUNT
                && registerAttempts < maxRegisterAttempts
            ) {
                this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_REGISTER_LOOP_LOCK');
                registerAttempts += 1;
                logInfo(ctx, 'TOKEN_POOL', `正在补充第 ${registerAttempts} 个账号`, {
                    currentFullCount: entries.length,
                    target: TOKEN_POOL_TARGET_FULL_COUNT,
                });
                this.tokenPoolInFlightRegister = true;
                let registerResult = null;
                try {
                    registerResult = await this.registerByApi(ctx, {
                        flowName: '号池补充',
                        showStepToasts: false,
                        markSuccess: false,
                        persistConsoleToken: false,
                        silent: true,
                        requireGuideSkipped: true,
                    });
                } finally {
                    this.tokenPoolInFlightRegister = false;
                }
                this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_REGISTER_RESULT_LOCK');

                const token = typeof registerResult?.token === 'string'
                    ? registerResult.token.trim()
                    : '';
                if (!token) {
                    throw new Error('补池注册未返回 token');
                }

                const checkResult = await this.validateTokenPoolToken({
                    token,
                    runCtx: ctx,
                    step: `TOKEN_POOL_CHECK_NEW_${registerAttempts}`,
                });
                this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_CHECK_NEW_LOCK');
                if (!checkResult.ok) {
                    logWarn(ctx, 'TOKEN_POOL', '新注册账号积分不足，跳过入池', {
                        message: checkResult.message,
                    });
                    continue;
                }

                entries.push({
                    token,
                    points: checkResult.points,
                    isFull: true,
                    createdAt: Date.now(),
                    lastCheckedAt: Date.now(),
                    lastUsedAt: 0,
                    source: 'auto-register',
                    status: 'full',
                });
                this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_WRITE_NEW_LOCK');
                entries = this.writeTokenPool(entries);
            }

            this.assertTokenPoolLockOwned(acquiredLock, ctx, 'TOKEN_POOL_FINALIZE_LOCK');
            this.writeTokenPoolBackoffState({
                lastCheckAt: Date.now(),
            });

            if (entries.length < TOKEN_POOL_TARGET_FULL_COUNT) {
                throw new Error(`号池补充后仍不足 ${TOKEN_POOL_TARGET_FULL_COUNT} 个满积分 token`);
            }

            this.clearTokenPoolBackoffState();
            logInfo(ctx, 'TOKEN_POOL', '号池维护完成', {
                reason: resolvedReason,
                fullCount: entries.length,
                target: TOKEN_POOL_TARGET_FULL_COUNT,
            });
            finalStatus = 'ok';
            finalEntries = entries;
        } catch (error) {
            const errorMessage = error?.message || String(error);
            if (errorMessage.includes('号池锁已失效')) {
                persistFinalSummary = false;
                finalStatus = 'locked';
                logWarn(ctx, 'TOKEN_POOL_LOCK', '号池维护因锁丢失而中止，未继续写入共享状态', {
                    reason: resolvedReason,
                    message: errorMessage,
                });
            } else {
                this.applyTokenPoolBackoff(error, ctx);
                finalStatus = 'failed';
            }
        } finally {
            this.tokenPoolMaintaining = false;
            this.tokenPoolInFlightRegister = false;
            this.releaseTokenPoolActiveLock({
                runCtx: ctx,
            });
        }

        return this.updateTokenPoolSummary(this.buildTokenPoolSummary({
            entries: finalEntries,
            reason: resolvedReason,
            status: finalStatus,
            runId: ctx.runId,
        }), ctx, {
            persist: persistFinalSummary,
        });
    },


    startTokenPoolScheduler({ intervalSeconds = null, runCtx } = {}) {
        this.ensureTokenPoolStorageSync();
        return this.refreshTokenPoolScheduler({
            intervalSeconds,
            runCtx,
            reason: 'start',
        });
    },


    stopTokenPoolScheduler({ runCtx, reason = 'stop', persistSummary = true } = {}) {
        if (this.tokenPoolTimer) {
            clearInterval(this.tokenPoolTimer);
            this.tokenPoolTimer = null;
        }
        const summary = this.buildTokenPoolSummary({
            reason,
            status: 'stopped',
        });
        this.updateTokenPoolSummary(summary, runCtx, {
            persist: persistSummary,
        });
        logInfo(runCtx, 'TOKEN_POOL_TIMER', '号池定时维护已停止', {
            reason,
        });
        return summary;
    },


    refreshTokenPoolScheduler({
        intervalSeconds = null,
        runCtx,
        reason = 'refresh',
        runImmediate = true,
        persistSummary = true,
    } = {}) {
        this.ensureTokenPoolStorageSync();
        const resolvedSeconds = intervalSeconds === null || intervalSeconds === undefined
            ? this.getTokenPoolCheckSeconds()
            : this.normalizeTokenPoolCheckSeconds(intervalSeconds);

        if (this.tokenPoolTimer) {
            clearInterval(this.tokenPoolTimer);
            this.tokenPoolTimer = null;
        }

        if (resolvedSeconds <= 0) {
            return this.stopTokenPoolScheduler({
                runCtx,
                reason: 'disabled',
                persistSummary,
            });
        }

        const intervalMs = resolvedSeconds * 1000;
        this.tokenPoolTimer = setInterval(() => {
            this.maintainTokenPool({
                reason: 'timer',
                force: false,
            }).catch(() => {});
        }, intervalMs);

        const summary = this.buildTokenPoolSummary({
            reason,
            status: 'running',
        });
        this.updateTokenPoolSummary(summary, runCtx, {
            persist: persistSummary,
        });
        logInfo(runCtx, 'TOKEN_POOL_TIMER', '号池定时维护已启动', {
            intervalSeconds: resolvedSeconds,
            intervalMs,
        });

        if (runImmediate) {
            this.maintainTokenPool({
                reason: 'timer-initial',
                force: false,
                runCtx,
            }).catch(() => {});
        }
        return summary;
    },
};
