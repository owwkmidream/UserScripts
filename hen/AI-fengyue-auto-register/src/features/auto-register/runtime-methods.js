import { CONFIG } from '../../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue } from '../../gm.js';
import { ApiService } from '../../services/api-service.js';
import { ChatHistoryService } from '../../services/chat-history-service.js';
import { Sidebar } from '../../ui/sidebar.js';
import { Toast } from '../../ui/toast.js';
import { generateUsername, generatePassword, delay } from '../../utils/random.js';
import { extractVerificationCode } from '../../utils/code-extractor.js';
import { simulateInput } from '../../utils/dom.js';
import {
    isRetryableNetworkError,
    resolveRetryAttempts as resolveRetryAttemptsUtil,
} from '../../utils/retry-policy.js';
import {
    createRunContext,
    isDebugEnabled,
    logDebug,
    logError,
    logInfo,
    logWarn,
} from '../../utils/logger.js';
import {
    X_LANGUAGE,
    SITE_ENDPOINTS,
    DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
    DEFAULT_SWITCH_WORLD_BOOK_TRIGGER,
    readErrorMessage,
    normalizeTimestamp,
    decodeEscapedText,
    isAnswerEmpty,
    normalizeSwitchTriggerWord,
    cloneJsonSafe,
    stringifyJsonWithUnicodeEscapes,
    randomConversationSuffix,
    buildTokenSignature,
    withHttpStatusError,
} from './shared.js';

const ACCOUNT_POINT_POLL_DEFAULT_SECONDS = 15;
const ACCOUNT_POINT_POLL_MIN_SECONDS = 2;
const ACCOUNT_POINT_POLL_MAX_SECONDS = 300;

export const RuntimeMethods = {
    resolveRetryAttempts(maxAttempts) {
        return resolveRetryAttemptsUtil(maxAttempts, DEFAULT_OBJECTIVE_RETRY_ATTEMPTS);
    },


    isAutoReloadEnabled() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.AUTO_RELOAD_ENABLED, true);
        return !(saved === false || saved === 'false' || saved === 0 || saved === '0');
    },


    reloadPageIfEnabled({ delayMs = 0, runCtx, step = 'RELOAD', reason = '' } = {}) {
        if (!this.isAutoReloadEnabled()) {
            logInfo(runCtx, step, '自动刷新开关已关闭，跳过 window.location.reload', {
                reason: reason || null,
            });
            Toast.info('自动刷新已关闭，请手动刷新页面', 3200);
            return false;
        }

        const normalizedDelay = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 0;
        if (normalizedDelay > 0) {
            setTimeout(() => {
                window.location.reload();
            }, normalizedDelay);
        } else {
            window.location.reload();
        }
        logInfo(runCtx, step, '已触发 window.location.reload', {
            reason: reason || null,
            delayMs: normalizedDelay,
        });
        return true;
    },


    isObjectiveRetryError(error) {
        return isRetryableNetworkError(error, { includeHttpStatus: true });
    },

    normalizeAccountPointPollSeconds(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return ACCOUNT_POINT_POLL_DEFAULT_SECONDS;
        const normalized = Math.floor(parsed);
        if (normalized < ACCOUNT_POINT_POLL_MIN_SECONDS) return ACCOUNT_POINT_POLL_MIN_SECONDS;
        return Math.min(normalized, ACCOUNT_POINT_POLL_MAX_SECONDS);
    },

    getAccountPointPollIntervalMs() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.ACCOUNT_POINT_POLL_SECONDS, ACCOUNT_POINT_POLL_DEFAULT_SECONDS);
        const seconds = this.normalizeAccountPointPollSeconds(saved);
        return seconds * 1000;
    },

    resolveAccountPointPollIntervalMs(intervalMs) {
        if (Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0) {
            return Math.max(ACCOUNT_POINT_POLL_MIN_SECONDS * 1000, Number(intervalMs));
        }
        return this.getAccountPointPollIntervalMs();
    },


    isPointPollingPage() {
        const pathname = typeof window.location?.pathname === 'string' ? window.location.pathname : '';
        return /\/zh\/explore\/(?:test-)?installed\/[0-9a-f-]+\/?$/i.test(pathname);
    },


    removeAccountPointIndicator() {
        const existing = document.getElementById('aifengyue-account-point-indicator');
        if (existing) {
            existing.remove();
        }
        this.accountPointIndicatorEl = null;
    },


    ensureAccountPointIndicator() {
        if (!this.isPointPollingPage()) {
            this.removeAccountPointIndicator();
            return null;
        }

        const anchor = document.getElementById('ai-mod-button2');
        if (!anchor) {
            this.accountPointIndicatorEl = null;
            return null;
        }

        let indicator = document.getElementById('aifengyue-account-point-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'aifengyue-account-point-indicator';
            indicator.style.cssText = [
                'display:inline-flex',
                'align-items:center',
                'gap:6px',
                'height:32px',
                'padding:0 10px',
                'margin-left:4px',
                'border:1px solid #dbe5f2',
                'border-radius:6px',
                'background:#f8fbff',
                'font-size:12px',
                'line-height:1',
                'white-space:nowrap',
                'flex-shrink:0',
                'color:#334155',
            ].join(';');
            indicator.innerHTML = '<span data-role="label" style="font-weight:600;color:#475569;">积分</span><span data-role="value" style="font-weight:700;color:#0f766e;">--</span>';
        }

        const firstChild = anchor.firstElementChild;
        if (indicator.parentElement !== anchor) {
            anchor.insertBefore(indicator, firstChild || null);
        } else if (firstChild !== indicator) {
            anchor.insertBefore(indicator, firstChild || null);
        }
        this.accountPointIndicatorEl = indicator;
        return indicator;
    },


    updateAccountPointIndicator({
        points = null,
        loading = false,
        exhausted = false,
        failed = false,
    } = {}) {
        const indicator = this.ensureAccountPointIndicator();
        if (!indicator) return;

        const valueEl = indicator.querySelector('[data-role="value"]');
        if (!valueEl) return;

        if (loading) {
            valueEl.textContent = '读取中...';
            valueEl.style.color = '#64748b';
            indicator.title = '正在轮询积分';
            return;
        }

        if (failed) {
            valueEl.textContent = '--';
            valueEl.style.color = '#f59e0b';
            indicator.title = '积分读取失败，等待下次轮询';
            return;
        }

        if (Number.isFinite(Number(points))) {
            const normalized = Number(points);
            valueEl.textContent = `${normalized}`;
            if (exhausted) {
                valueEl.style.color = '#dc2626';
                indicator.title = '积分已耗尽，已触发自动更换账号';
            } else {
                valueEl.style.color = '#0f766e';
                indicator.title = '当前积分';
            }
            return;
        }

        valueEl.textContent = '--';
        valueEl.style.color = '#64748b';
        indicator.title = '积分暂不可用';
    },


    stopAccountPointPolling({ runCtx, step = 'POINT_MONITOR', reason = '' } = {}) {
        const hadTimer = !!this.accountPointPollTimer;
        if (this.accountPointPollTimer) {
            clearInterval(this.accountPointPollTimer);
            this.accountPointPollTimer = null;
        }
        this.accountPointPollAppId = '';
        this.accountPointPollInFlight = false;
        this.accountPointExhaustedTriggered = false;
        this.accountPointPollIntervalMs = 0;
        this.removeAccountPointIndicator();

        if (hadTimer) {
            logInfo(runCtx, step, '积分轮询已停止', {
                reason: reason || null,
            });
        }
    },


    async checkAccountPointOnce({
        appId = '',
        runCtx,
        step = 'POINT_MONITOR',
        reason = 'manual',
    } = {}) {
        const resolvedAppId = (typeof appId === 'string' ? appId.trim() : '') || this.extractInstalledAppId();
        if (!resolvedAppId) {
            this.updateAccountPointIndicator({
                points: null,
                failed: true,
            });
            return {
                appId: '',
                points: null,
                exhausted: false,
                skipped: true,
                reason: 'missing-app-id',
            };
        }

        if (this.switchingAccount) {
            this.updateAccountPointIndicator({
                points: null,
                loading: true,
            });
            logDebug(runCtx, step, '更换账号进行中，跳过本轮积分检查', {
                appId: resolvedAppId,
                reason,
            });
            return {
                appId: resolvedAppId,
                points: null,
                exhausted: false,
                skipped: true,
                reason: 'switching-account',
            };
        }

        if (this.accountPointPollInFlight) {
            return {
                appId: resolvedAppId,
                points: null,
                exhausted: false,
                skipped: true,
                reason: 'in-flight',
            };
        }

        this.accountPointPollInFlight = true;
        const ctx = runCtx || createRunContext('POINT');
        const token = (localStorage.getItem('console_token') || '').trim();
        try {
            const pointResult = await this.fetchAccountPoint({
                appId: resolvedAppId,
                token,
                runCtx: ctx,
                step,
                maxAttempts: 1,
            });
            const points = Number(pointResult.points);
            const exhausted = points <= 0;
            this.updateAccountPointIndicator({
                points,
                exhausted,
            });

            logInfo(ctx, step, '积分检查完成', {
                appId: resolvedAppId,
                points,
                exhausted,
                reason,
            });

            if (exhausted) {
                if (this.accountPointExhaustedTriggered) {
                    return {
                        appId: resolvedAppId,
                        points,
                        exhausted: true,
                        skipped: true,
                        reason: 'already-triggered',
                    };
                }

                this.accountPointExhaustedTriggered = true;
                Sidebar.updateState({
                    status: 'fetching',
                    statusMessage: '检测到积分不足，正在启动更换账号流程...',
                });
                Toast.warning('积分 <= 0，正在自动启动更换账号流程', 3200);
                logWarn(ctx, step, '积分耗尽，触发自动更换账号', {
                    appId: resolvedAppId,
                    points,
                });
                await this.switchAccount(DEFAULT_SWITCH_WORLD_BOOK_TRIGGER);
                return {
                    appId: resolvedAppId,
                    points,
                    exhausted: true,
                    skipped: false,
                    reason: 'triggered-switch',
                };
            }

            if (this.accountPointExhaustedTriggered) {
                this.accountPointExhaustedTriggered = false;
                logInfo(ctx, step, '积分已恢复为正数，重置耗尽触发标记', {
                    appId: resolvedAppId,
                    points,
                });
            }

            return {
                appId: resolvedAppId,
                points,
                exhausted: false,
                skipped: false,
            };
        } catch (error) {
            logWarn(ctx, step, '积分检查失败，本轮跳过', {
                appId: resolvedAppId,
                reason,
                message: error?.message || String(error),
            });
            this.updateAccountPointIndicator({
                points: null,
                failed: true,
            });
            return {
                appId: resolvedAppId,
                points: null,
                exhausted: false,
                skipped: true,
                reason: 'request-failed',
                error,
            };
        } finally {
            this.accountPointPollInFlight = false;
        }
    },


    startAccountPointPolling({ intervalMs = 0, runCtx } = {}) {
        if (!this.isPointPollingPage()) {
            this.stopAccountPointPolling({
                runCtx,
                reason: 'not-installed-explore-page',
            });
            return false;
        }

        const appId = this.extractInstalledAppId();
        if (!appId) {
            this.stopAccountPointPolling({
                runCtx,
                reason: 'not-installed-page',
            });
            return false;
        }

        const pollMs = this.resolveAccountPointPollIntervalMs(intervalMs);
        if (
            this.accountPointPollTimer
            && this.accountPointPollAppId === appId
            && this.accountPointPollIntervalMs === pollMs
        ) {
            return true;
        }

        this.stopAccountPointPolling({
            runCtx,
            reason: this.accountPointPollAppId ? 'app-changed' : 'restart',
        });

        this.accountPointPollAppId = appId;
        this.accountPointPollIntervalMs = pollMs;
        this.accountPointExhaustedTriggered = false;
        this.ensureAccountPointIndicator();
        this.updateAccountPointIndicator({
            points: null,
            loading: true,
        });

        this.accountPointPollTimer = setInterval(() => {
            const currentAppId = typeof this.accountPointPollAppId === 'string'
                ? this.accountPointPollAppId.trim()
                : '';
            if (!currentAppId) {
                return;
            }
            this.checkAccountPointOnce({
                appId: currentAppId,
                step: 'POINT_MONITOR_TICK',
                reason: 'interval',
            }).catch(() => {});
        }, pollMs);

        logInfo(runCtx, 'POINT_MONITOR', '积分轮询已启动', {
            appId,
            intervalMs: pollMs,
        });

        this.checkAccountPointOnce({
            appId,
            runCtx,
            step: 'POINT_MONITOR_INIT',
            reason: 'start',
        }).catch(() => {});
        return true;
    },


    refreshAccountPointPolling({ intervalMs = 0, runCtx } = {}) {
        if (!this.isPointPollingPage()) {
            this.stopAccountPointPolling({
                runCtx,
                reason: 'route-not-installed-explore-page',
            });
            return false;
        }

        const appId = this.extractInstalledAppId();
        if (!appId) {
            this.stopAccountPointPolling({
                runCtx,
                reason: 'route-not-installed-page',
            });
            return false;
        }
        return this.startAccountPointPolling({
            intervalMs,
            runCtx,
        });
    },


    async runWithObjectiveRetries(task, {
        runCtx,
        step = 'RETRY',
        actionName = '请求',
        maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
        baseDelayMs = 800,
    } = {}) {
        const attempts = this.resolveRetryAttempts(maxAttempts);
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await task(attempt, attempts);
            } catch (error) {
                lastError = error;
                const retriable = this.isObjectiveRetryError(error);
                const hasNext = attempt < attempts;
                if (!retriable || !hasNext) {
                    throw error;
                }

                const waitMs = baseDelayMs * attempt;
                logWarn(runCtx, step, `${actionName} 发生客观错误，${waitMs}ms 后重试 (${attempt + 1}/${attempts})`, {
                    message: error?.message || String(error),
                    httpStatus: Number(error?.httpStatus || 0) || null,
                });
                await delay(waitMs);
            }
        }

        throw lastError || new Error(`${actionName} 执行失败`);
    },

};
