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

    removeAccountPointLowBanner() {
        const existing = document.getElementById('aifengyue-account-point-low-banner');
        if (existing) {
            existing.remove();
        }
        this.accountPointLowBannerEl = null;
    },

    ensureAccountPointLowBanner() {
        if (!this.isPointPollingPage()) {
            this.removeAccountPointLowBanner();
            return null;
        }

        const anchor = document.getElementById('ai-mod-button2');
        const parent = anchor?.parentElement;
        if (!anchor || !parent) {
            this.accountPointLowBannerEl = null;
            return null;
        }

        let banner = document.getElementById('aifengyue-account-point-low-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'aifengyue-account-point-low-banner';
            banner.style.cssText = [
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'padding:8px 12px',
                'margin:6px 4px 8px',
                'border:1px solid #ef4444',
                'border-radius:8px',
                'background:#fef2f2',
                'color:#991b1b',
                'font-size:12px',
                'font-weight:700',
                'line-height:1.4',
                'text-align:center',
                'box-shadow:0 1px 0 rgba(239,68,68,0.12)',
            ].join(';');
        }

        if (banner.parentElement !== parent || banner.previousElementSibling !== anchor) {
            parent.insertBefore(banner, anchor.nextSibling);
        }
        this.accountPointLowBannerEl = banner;
        return banner;
    },

    isAccountPointSubmitBlocked() {
        if (!this.isPointPollingPage()) return false;
        if (this.accountPointSubmitSwitchInFlight || this.switchingAccount) return true;
        const points = Number(this.accountPointLatestPoints);
        return Number.isFinite(points) && points <= 0;
    },

    refreshAccountPointLowBanner() {
        if (!this.isAccountPointSubmitBlocked()) {
            this.removeAccountPointLowBanner();
            return;
        }
        const banner = this.ensureAccountPointLowBanner();
        if (!banner) return;

        const points = Number(this.accountPointLatestPoints);
        const pointsText = Number.isFinite(points) ? `${points}` : '--';
        if (this.accountPointSubmitSwitchInFlight || this.switchingAccount) {
            banner.textContent = '积分不足：已拦截本次发送，正在执行完整换号流程，请稍候...';
            return;
        }
        banner.textContent = `积分不足（${pointsText}）：发送已被接管，按 Enter / 发送键将执行完整换号流程`;
    },

    ensureAccountPointSubmitInterceptors() {
        if (this.accountPointSubmitInterceptorsBound) {
            return;
        }

        this.accountPointSubmitKeydownHandler = (event) => {
            if (!event || event.defaultPrevented) return;
            if (event.key !== 'Enter') return;
            if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const inputEl = document.getElementById('ai-chat-input');
            if (!inputEl || target !== inputEl) return;
            this.tryInterceptAccountPointSubmit(event, 'enter');
        };

        this.accountPointSubmitClickHandler = (event) => {
            if (!event || event.defaultPrevented) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const sendBtn = target.closest('#ai-send-button');
            if (!sendBtn) return;
            this.tryInterceptAccountPointSubmit(event, 'send-button');
        };

        document.addEventListener('keydown', this.accountPointSubmitKeydownHandler, true);
        document.addEventListener('click', this.accountPointSubmitClickHandler, true);
        this.accountPointSubmitInterceptorsBound = true;
    },

    removeAccountPointSubmitInterceptors() {
        if (!this.accountPointSubmitInterceptorsBound) return;
        if (this.accountPointSubmitKeydownHandler) {
            document.removeEventListener('keydown', this.accountPointSubmitKeydownHandler, true);
        }
        if (this.accountPointSubmitClickHandler) {
            document.removeEventListener('click', this.accountPointSubmitClickHandler, true);
        }
        this.accountPointSubmitKeydownHandler = null;
        this.accountPointSubmitClickHandler = null;
        this.accountPointSubmitInterceptorsBound = false;
    },

    stopEventForSubmitGuard(event) {
        if (!event) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    },

    tryInterceptAccountPointSubmit(event, source = 'unknown') {
        if (!this.isAccountPointSubmitBlocked()) return false;
        this.stopEventForSubmitGuard(event);
        this.triggerSwitchAccountFromSubmit(source).catch((error) => {
            const runCtx = createRunContext('POINT_SUBMIT');
            logError(runCtx, 'POINT_SUBMIT', '发送拦截触发换号失败', {
                source,
                message: error?.message || String(error),
            });
            Toast.error(`拦截发送后换号失败: ${error?.message || String(error)}`, 5000);
        });
        return true;
    },

    async triggerSwitchAccountFromSubmit(source = 'unknown') {
        if (this.accountPointSubmitSwitchInFlight || this.switchingAccount) {
            Toast.info('更换账号流程执行中，请稍候');
            return false;
        }

        const inputEl = document.getElementById('ai-chat-input');
        const extraText = typeof inputEl?.value === 'string' ? inputEl.value.trim() : '';
        if (!extraText) {
            Toast.warning('输入框为空，请先输入内容再发送');
            return false;
        }

        this.accountPointSubmitSwitchInFlight = true;
        this.refreshAccountPointLowBanner();
        const runCtx = createRunContext('POINT_SUBMIT');
        logInfo(runCtx, 'POINT_SUBMIT', '积分不足，发送已拦截并改走完整换号流程', {
            source,
            points: Number.isFinite(Number(this.accountPointLatestPoints))
                ? Number(this.accountPointLatestPoints)
                : null,
            extraTextLength: extraText.length,
        });
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: '积分不足：已拦截发送，正在执行完整换号流程...',
        });
        Toast.warning('积分不足，已拦截发送并执行完整换号流程', 3200);

        try {
            await this.switchAccount(extraText);
            return true;
        } finally {
            this.accountPointSubmitSwitchInFlight = false;
            this.refreshAccountPointLowBanner();
        }
    },

    setAccountPointIndicatorInteractionState(indicator, {
        enabled = false,
        title = '',
    } = {}) {
        if (!indicator) return;
        indicator.dataset.switchEnabled = enabled ? '1' : '0';
        indicator.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        indicator.style.cursor = enabled ? 'pointer' : 'default';
        indicator.style.borderColor = enabled ? '#fecaca' : '#dbe5f2';
        indicator.style.background = enabled ? '#fff1f2' : '#f8fbff';
        indicator.title = title;
    },

    async handleAccountPointIndicatorClick() {
        const indicator = this.ensureAccountPointIndicator();
        if (!indicator) return;

        const switchEnabled = indicator.dataset.switchEnabled === '1';
        const points = Number(indicator.dataset.points);
        if (!switchEnabled) {
            if (Number.isFinite(points) && points > 0) {
                Toast.info(`当前积分 ${points}，仅在积分 <= 0 时可主动换号`, 2600);
            } else {
                Toast.info('请等待积分读取完成后再尝试主动换号', 2600);
            }
            return;
        }

        if (this.switchingAccount) {
            Toast.warning('更换账号正在执行，请稍候');
            return;
        }

        const inputEl = document.getElementById('ai-chat-input');
        const extraText = typeof inputEl?.value === 'string' ? inputEl.value.trim() : '';
        if (!extraText) {
            Toast.warning('输入框为空，请先输入附加文本后再点击积分');
            return;
        }

        const runCtx = createRunContext('POINT_CLICK');
        logInfo(runCtx, 'POINT_CLICK', '积分按钮触发主动换号', {
            points: Number.isFinite(points) ? points : null,
            extraTextLength: extraText.length,
        });
        await this.triggerSwitchAccountFromSubmit('point-indicator');
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
            indicator.setAttribute('role', 'button');
            indicator.tabIndex = 0;
            const triggerManualSwitch = () => {
                this.handleAccountPointIndicatorClick().catch((error) => {
                    const runCtx = createRunContext('POINT_CLICK');
                    logError(runCtx, 'POINT_CLICK', '积分按钮主动换号失败', {
                        message: error?.message || String(error),
                    });
                });
            };
            indicator.addEventListener('click', triggerManualSwitch);
            indicator.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                triggerManualSwitch();
            });
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
            this.accountPointLatestPoints = null;
            indicator.dataset.points = '';
            this.setAccountPointIndicatorInteractionState(indicator, {
                enabled: false,
                title: '正在轮询积分',
            });
            this.refreshAccountPointLowBanner();
            return;
        }

        if (failed) {
            valueEl.textContent = '--';
            valueEl.style.color = '#f59e0b';
            this.accountPointLatestPoints = null;
            indicator.dataset.points = '';
            this.setAccountPointIndicatorInteractionState(indicator, {
                enabled: false,
                title: '积分读取失败，等待下次轮询',
            });
            this.refreshAccountPointLowBanner();
            return;
        }

        if (Number.isFinite(Number(points))) {
            const normalized = Number(points);
            valueEl.textContent = `${normalized}`;
            this.accountPointLatestPoints = normalized;
            indicator.dataset.points = `${normalized}`;
            if (exhausted) {
                valueEl.style.color = '#dc2626';
                this.setAccountPointIndicatorInteractionState(indicator, {
                    enabled: true,
                    title: '积分 <= 0，发送将触发完整换号流程（也可点击积分手动触发）',
                });
            } else {
                valueEl.style.color = '#0f766e';
                this.setAccountPointIndicatorInteractionState(indicator, {
                    enabled: false,
                    title: '当前积分',
                });
            }
            this.refreshAccountPointLowBanner();
            return;
        }

        valueEl.textContent = '--';
        valueEl.style.color = '#64748b';
        this.accountPointLatestPoints = null;
        indicator.dataset.points = '';
        this.setAccountPointIndicatorInteractionState(indicator, {
            enabled: false,
            title: '积分暂不可用',
        });
        this.refreshAccountPointLowBanner();
    },


    stopAccountPointPolling({ runCtx, step = 'POINT_MONITOR', reason = '' } = {}) {
        const hadTimer = !!this.accountPointPollTimer;
        if (this.accountPointPollTimer) {
            clearInterval(this.accountPointPollTimer);
            this.accountPointPollTimer = null;
        }
        this.accountPointPollAppId = '';
        this.accountPointPollInFlight = false;
        this.accountPointLatestPoints = null;
        this.accountPointPollIntervalMs = 0;
        this.accountPointSubmitSwitchInFlight = false;
        this.removeAccountPointIndicator();
        this.removeAccountPointLowBanner();
        this.removeAccountPointSubmitInterceptors();

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
                logWarn(ctx, step, '积分耗尽，等待发送触发完整换号流程（也可点击积分）', {
                    appId: resolvedAppId,
                    points,
                });
            }

            return {
                appId: resolvedAppId,
                points,
                exhausted,
                skipped: false,
                reason: exhausted ? 'manual-switch-required' : 'ok',
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
        this.ensureAccountPointSubmitInterceptors();
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
