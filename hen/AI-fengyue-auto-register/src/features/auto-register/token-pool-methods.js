import { CONFIG } from '../../constants.js';
import { Sidebar } from '../../ui/sidebar.js';
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


    readTokenPool() {
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
        if (raw !== normalizedRaw) {
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


    buildTokenPoolSummary({ entries = null, reason = '', status = 'idle' } = {}) {
        const resolvedEntries = Array.isArray(entries) ? entries : this.readTokenPool();
        const fullCount = resolvedEntries.length;
        const backoff = this.readTokenPoolBackoffState();
        const intervalSeconds = this.getTokenPoolCheckSeconds();

        return {
            reason: reason || '',
            status,
            fullCount,
            totalCount: resolvedEntries.length,
            targetFullCount: TOKEN_POOL_TARGET_FULL_COUNT,
            maxCount: TOKEN_POOL_MAX_COUNT,
            fullPointThreshold: TOKEN_POOL_FULL_POINTS,
            intervalSeconds,
            schedulerEnabled: intervalSeconds > 0,
            schedulerRunning: !!this.tokenPoolTimer,
            maintaining: !!this.tokenPoolMaintaining,
            lastCheckAt: backoff.lastCheckAt,
            nextAllowedAt: backoff.nextAllowedAt,
            backoffLevel: backoff.backoffLevel,
            lastError: backoff.lastError,
            updatedAt: Date.now(),
        };
    },


    updateTokenPoolSummary(summary, runCtx) {
        const resolved = summary && typeof summary === 'object'
            ? summary
            : this.buildTokenPoolSummary();
        this.tokenPoolLastSummary = resolved;
        Sidebar.refreshTokenPoolSummary?.(resolved);
        logDebug(runCtx, 'TOKEN_POOL_SUMMARY', '号池摘要已更新', resolved);
        return resolved;
    },


    getTokenPoolSummary() {
        if (this.tokenPoolLastSummary && typeof this.tokenPoolLastSummary === 'object') {
            return this.tokenPoolLastSummary;
        }
        return this.updateTokenPoolSummary(this.buildTokenPoolSummary({ reason: 'initial' }));
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
        let entries = this.readTokenPool();
        if (!entries.length) {
            this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                entries,
                reason: 'acquire-empty',
                status: 'empty',
            }), ctx);
            return {
                token: '',
                points: null,
                source: 'pool-empty',
            };
        }

        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const checkResult = await this.validateTokenPoolToken({
                token: entry.token,
                runCtx: ctx,
                step: `TOKEN_POOL_ACQUIRE_VALIDATE_${index + 1}`,
            });
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
            this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                entries,
                reason: 'acquire-hit',
                status: 'ready',
            }), ctx);

            logInfo(ctx, 'TOKEN_POOL_ACQUIRE', '号池命中可用 token，已消费', {
                points: checkResult.points,
                remainingCount: entries.length,
            });
            return {
                token: selectedToken,
                points: checkResult.points,
                source: 'pool',
            };
        }

        this.updateTokenPoolSummary(this.buildTokenPoolSummary({
            entries,
            reason: 'acquire-depleted',
            status: 'empty',
        }), ctx);
        return {
            token: '',
            points: null,
            source: 'pool-depleted',
        };
    },


    async maintainTokenPool({ reason = 'manual', force = false, runCtx } = {}) {
        if (this.tokenPoolMaintaining) {
            return this.getTokenPoolSummary();
        }

        const ctx = runCtx || createRunContext('POOL');
        this.tokenPoolMaintaining = true;
        try {
            logInfo(ctx, 'TOKEN_POOL', '号池维护开始', {
                reason,
                force: !!force,
            });
            this.updateTokenPoolSummary(this.buildTokenPoolSummary({
                reason: reason || 'maintain',
                status: 'maintaining',
            }), ctx);
            const backoff = this.readTokenPoolBackoffState();
            const now = Date.now();
            if (!force && backoff.nextAllowedAt > now) {
                const summary = this.buildTokenPoolSummary({
                    reason: reason || 'backoff-skip',
                    status: 'backoff',
                });
                this.updateTokenPoolSummary(summary, ctx);
                return summary;
            }

            let entries = this.readTokenPool();
            const checkedEntries = [];
            for (let index = 0; index < entries.length; index++) {
                const item = entries[index];
                const checkResult = await this.validateTokenPoolToken({
                    token: item.token,
                    runCtx: ctx,
                    step: `TOKEN_POOL_CHECK_EXISTING_${index + 1}`,
                });
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
            entries = this.writeTokenPool(checkedEntries);

            const maxRegisterAttempts = Math.max(2, TOKEN_POOL_TARGET_FULL_COUNT * 3);
            let registerAttempts = 0;
            while (
                entries.length < TOKEN_POOL_TARGET_FULL_COUNT
                && entries.length < TOKEN_POOL_MAX_COUNT
                && registerAttempts < maxRegisterAttempts
            ) {
                registerAttempts += 1;
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
                entries = this.writeTokenPool(entries);
            }

            this.writeTokenPoolBackoffState({
                lastCheckAt: Date.now(),
            });

            if (entries.length < TOKEN_POOL_TARGET_FULL_COUNT) {
                throw new Error(`号池补充后仍不足 ${TOKEN_POOL_TARGET_FULL_COUNT} 个满积分 token`);
            }

            this.clearTokenPoolBackoffState();
            const summary = this.buildTokenPoolSummary({
                entries,
                reason: reason || 'maintain',
                status: 'ok',
            });
            this.updateTokenPoolSummary(summary, ctx);
            logInfo(ctx, 'TOKEN_POOL', '号池维护完成', {
                reason,
                fullCount: entries.length,
                target: TOKEN_POOL_TARGET_FULL_COUNT,
            });
            return summary;
        } catch (error) {
            this.applyTokenPoolBackoff(error, ctx);
            const failedSummary = this.buildTokenPoolSummary({
                reason: reason || 'maintain',
                status: 'failed',
            });
            this.updateTokenPoolSummary(failedSummary, ctx);
            return failedSummary;
        } finally {
            this.tokenPoolMaintaining = false;
            this.tokenPoolInFlightRegister = false;
        }
    },


    startTokenPoolScheduler({ intervalSeconds = null, runCtx } = {}) {
        return this.refreshTokenPoolScheduler({
            intervalSeconds,
            runCtx,
            reason: 'start',
        });
    },


    stopTokenPoolScheduler({ runCtx, reason = 'stop' } = {}) {
        if (this.tokenPoolTimer) {
            clearInterval(this.tokenPoolTimer);
            this.tokenPoolTimer = null;
        }
        const summary = this.buildTokenPoolSummary({
            reason,
            status: 'stopped',
        });
        this.updateTokenPoolSummary(summary, runCtx);
        logInfo(runCtx, 'TOKEN_POOL_TIMER', '号池定时维护已停止', {
            reason,
        });
        return summary;
    },


    refreshTokenPoolScheduler({ intervalSeconds = null, runCtx, reason = 'refresh' } = {}) {
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
        this.updateTokenPoolSummary(summary, runCtx);
        logInfo(runCtx, 'TOKEN_POOL_TIMER', '号池定时维护已启动', {
            intervalSeconds: resolvedSeconds,
            intervalMs,
        });

        this.maintainTokenPool({
            reason: 'timer-initial',
            force: false,
            runCtx,
        }).catch(() => {});
        return summary;
    },
};
