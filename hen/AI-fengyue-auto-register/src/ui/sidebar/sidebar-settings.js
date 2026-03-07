import { CONFIG } from '../../constants.js';
import { gmGetValue, gmSetValue } from '../../gm.js';
import { ApiService } from '../../services/api-service.js';
import {
    clearRuntimeLogEntries,
    isDebugEnabled,
    readRuntimeLogEntries,
} from '../../utils/logger.js';
import { getAutoRegister, getModelPopupSorter, getToast, VALID_TABS } from './sidebar-context.js';

export const sidebarSettingsMethods = {
    getLayoutMode() {
        const mode = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_LAYOUT_MODE, 'inline');
        return mode === 'floating' ? 'floating' : 'inline';
    },

    tabLabel(tab) {
        switch (tab) {
            case 'register': return '注册';
            case 'tools': return '工具';
            case 'conversation': return '会话';
            case 'settings': return '设置';
            default: return '注册';
        }
    },

    getDefaultTab() {
        const tab = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_TAB, 'register');
        return VALID_TABS.includes(tab) ? tab : 'register';
    },

    setDefaultTab(tab) {
        const normalized = VALID_TABS.includes(tab) ? tab : 'register';
        gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_TAB, normalized);
        const input = this.element?.querySelector?.('#aifengyue-default-tab');
        if (input) {
            input.value = normalized;
        }
    },

    getDefaultOpen() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_OPEN, false);
        return saved === true || saved === 'true' || saved === 1 || saved === '1';
    },

    setDefaultOpen(defaultOpen) {
        const normalized = !!defaultOpen;
        gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_OPEN, normalized);
        const input = this.element?.querySelector?.('#aifengyue-default-open');
        if (input) {
            input.value = normalized ? 'open' : 'closed';
        }
    },

    getAutoReloadEnabled() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.AUTO_RELOAD_ENABLED, true);
        return !(saved === false || saved === 'false' || saved === 0 || saved === '0');
    },

    normalizeChatMessagesTimeoutSeconds(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        const normalized = Math.floor(parsed);
        if (normalized <= 0) return 0;
        return Math.min(normalized, 300);
    },

    getChatMessagesTimeoutSeconds() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.CHAT_MESSAGES_TIMEOUT_SECONDS, 0);
        return this.normalizeChatMessagesTimeoutSeconds(saved);
    },

    setChatMessagesTimeoutSeconds(value) {
        const normalized = this.normalizeChatMessagesTimeoutSeconds(value);
        gmSetValue(CONFIG.STORAGE_KEYS.CHAT_MESSAGES_TIMEOUT_SECONDS, normalized);
        const input = this.element?.querySelector?.('#aifengyue-chat-timeout-seconds');
        if (input) {
            input.value = String(normalized);
        }
        return normalized;
    },

    normalizeAccountPointPollSeconds(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 15;
        const normalized = Math.floor(parsed);
        if (normalized < 2) return 2;
        return Math.min(normalized, 300);
    },

    getAccountPointPollSeconds() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.ACCOUNT_POINT_POLL_SECONDS, 15);
        return this.normalizeAccountPointPollSeconds(saved);
    },

    setAccountPointPollSeconds(value) {
        const normalized = this.normalizeAccountPointPollSeconds(value);
        gmSetValue(CONFIG.STORAGE_KEYS.ACCOUNT_POINT_POLL_SECONDS, normalized);
        const input = this.element?.querySelector?.('#aifengyue-account-point-poll-seconds');
        if (input) {
            input.value = String(normalized);
        }
        return normalized;
    },

    normalizeTokenPoolCheckSeconds(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 300;
        const normalized = Math.floor(parsed);
        if (normalized <= 0) return 0;
        return Math.min(normalized, 3600);
    },

    getTokenPoolCheckSeconds() {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS);
        const fallback = 300;
        return this.normalizeTokenPoolCheckSeconds(raw === null ? fallback : raw);
    },

    setTokenPoolCheckSeconds(value) {
        const normalized = this.normalizeTokenPoolCheckSeconds(value);
        localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS, String(normalized));
        const input = this.element?.querySelector?.('#aifengyue-token-pool-check-seconds');
        if (input) {
            input.value = String(normalized);
        }
        return normalized;
    },

    formatTokenPoolTime(value) {
        const timestamp = Number(value);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
        try {
            return new Date(timestamp).toLocaleString();
        } catch {
            return '-';
        }
    },

    getTokenPoolStatusText(summary = {}) {
        switch (summary?.status) {
            case 'maintaining':
                return '维护中';
            case 'ok':
                return '最近成功';
            case 'failed':
                return '最近失败';
            case 'backoff':
                return '退避等待';
            case 'stopped':
                return '已停止';
            case 'running':
                return '定时中';
            default:
                if (summary?.maintaining) return '维护中';
                return summary?.schedulerEnabled
                    ? (summary?.schedulerRunning ? '运行中' : '待启动')
                    : '已关闭';
        }
    },

    getTokenPoolStatusDetail(summary = {}, latestEntry = null) {
        const status = typeof summary?.status === 'string' ? summary.status.trim() : '';
        const latestMessage = typeof latestEntry?.message === 'string' ? latestEntry.message.trim() : '';
        const lastError = typeof summary?.lastError === 'string' ? summary.lastError.trim() : '';

        if (status === 'maintaining' || summary?.maintaining) {
            return latestMessage || '号池维护进行中，请稍候...';
        }

        switch (status) {
            case 'ok':
                return '号池已满足目标，无需补充';
            case 'failed':
                return lastError || latestMessage || '号池维护失败，请查看日志详情';
            case 'backoff':
                return '上次失败后进入退避，可点击“立即重试”跳过等待';
            case 'stopped':
                return latestMessage || '号池定时维护已停止，可手动触发一次维护';
            case 'running':
                return latestMessage || '号池定时维护已启动，将按设定间隔自动检查';
            default:
                return summary?.schedulerEnabled
                    ? (summary?.schedulerRunning ? '等待下次定时检测或手动触发' : '号池定时维护待启动')
                    : '号池定时维护已关闭，可手动触发一次维护';
        }
    },

    escapeLogHtml(value) {
        const text = typeof value === 'string' ? value : String(value ?? '');
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    isTokenPoolLogEntry(entry) {
        if (!entry || typeof entry !== 'object') return false;
        const runId = typeof entry?.runId === 'string' ? entry.runId : '';
        const step = typeof entry?.step === 'string' ? entry.step : '';
        const message = typeof entry?.message === 'string' ? entry.message : '';
        return runId.startsWith('POOL-')
            || step.includes('TOKEN_POOL')
            || step.includes('SWITCH_POOL')
            || message.includes('号池');
    },

    isTokenPoolProgressLogEntry(entry) {
        if (!this.isTokenPoolLogEntry(entry)) return false;
        const step = typeof entry?.step === 'string' ? entry.step.trim() : '';
        const message = typeof entry?.message === 'string' ? entry.message.trim() : '';
        if (!message) return false;
        return step !== 'TOKEN_POOL_SUMMARY';
    },

    getTokenPoolLogEntries(limit = 200, { runId = '', progressOnly = false } = {}) {
        const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 200));
        const resolvedRunId = typeof runId === 'string' ? runId.trim() : '';
        const entries = readRuntimeLogEntries({ limit: Math.max(normalizedLimit * 3, normalizedLimit) });
        const predicate = progressOnly
            ? this.isTokenPoolProgressLogEntry.bind(this)
            : this.isTokenPoolLogEntry.bind(this);
        return entries
            .filter((entry) => {
                if (!predicate(entry)) return false;
                if (!resolvedRunId) return true;
                const entryRunId = typeof entry?.runId === 'string' ? entry.runId.trim() : '';
                return entryRunId === resolvedRunId;
            })
            .slice(-normalizedLimit);
    },

    getTokenPoolLatestProgressEntry(summary = null) {
        const runId = typeof summary?.runId === 'string' ? summary.runId.trim() : '';
        if (!runId) return null;
        const entries = this.getTokenPoolLogEntries(24, {
            runId,
            progressOnly: true,
        });
        return entries[entries.length - 1] || null;
    },

    getTokenPoolMaintainButtonState(summary = {}) {
        const isMaintaining = summary?.status === 'maintaining' || !!summary?.maintaining;
        if (isMaintaining) {
            return {
                disabled: true,
                text: '维护中...',
            };
        }
        if (summary?.status === 'backoff') {
            return {
                disabled: false,
                text: '立即重试',
            };
        }
        return {
            disabled: false,
            text: '立即维护',
        };
    },

    renderTokenPoolLogModal() {
        if (!this.tokenPoolLogModal) return;

        const summaryEl = this.tokenPoolLogModal.querySelector('#aifengyue-token-pool-log-summary');
        const listEl = this.tokenPoolLogModal.querySelector('#aifengyue-token-pool-log-list');
        const entries = this.getTokenPoolLogEntries(180);
        const latestEntry = entries[entries.length - 1] || null;
        const poolSummary = getAutoRegister()?.getTokenPoolSummary?.() || null;
        const latestProgressEntry = this.getTokenPoolLatestProgressEntry(poolSummary);

        if (summaryEl) {
            const statusText = this.getTokenPoolStatusText(poolSummary || {});
            const detailText = this.getTokenPoolStatusDetail(poolSummary || {}, latestProgressEntry);
            const latestText = latestEntry
                ? `${this.formatTokenPoolTime(latestEntry.createdAt)} / ${latestEntry.runId || 'NO-RUN'}`
                : '暂无';
            const detailHint = isDebugEnabled()
                ? 'DEBUG 已开启，当前会记录更细的请求与响应细节。'
                : '如需更多请求明细，可先打开「启用调试日志（DEBUG）」。';
            summaryEl.textContent = `当前状态：${statusText}；当前说明：${detailText}；最近日志：${latestText}；日志条数：${entries.length}；${detailHint}`;
        }

        if (!listEl) return;
        if (!entries.length) {
            listEl.innerHTML = `
                <div class="aifengyue-log-empty">
                    暂无号池运行日志。可先点“立即维护”，再打开这里查看完整过程。
                </div>
            `;
            return;
        }

        listEl.innerHTML = entries
            .slice()
            .reverse()
            .map((entry) => {
                const level = typeof entry?.level === 'string' ? entry.level : 'INFO';
                const levelClass = `is-${level.toLowerCase()}`;
                const timeText = this.formatTokenPoolTime(entry?.createdAt);
                const stepText = typeof entry?.step === 'string' && entry.step.trim() ? entry.step.trim() : '-';
                const runIdText = typeof entry?.runId === 'string' && entry.runId.trim() ? entry.runId.trim() : 'NO-RUN';
                const messageText = typeof entry?.message === 'string' ? entry.message : '';
                const metaText = entry?.meta ? JSON.stringify(entry.meta, null, 2) : '';
                const metaHtml = metaText
                    ? `<pre class="aifengyue-log-meta">${this.escapeLogHtml(metaText)}</pre>`
                    : '';

                return `
                    <div class="aifengyue-log-entry ${levelClass}">
                        <div class="aifengyue-log-entry-head">
                            <span class="aifengyue-log-level">${this.escapeLogHtml(level)}</span>
                            <span class="aifengyue-log-time">${this.escapeLogHtml(timeText)}</span>
                            <span class="aifengyue-log-step">${this.escapeLogHtml(stepText)}</span>
                        </div>
                        <div class="aifengyue-log-message">${this.escapeLogHtml(messageText)}</div>
                        <div class="aifengyue-log-run">${this.escapeLogHtml(runIdText)}</div>
                        ${metaHtml}
                    </div>
                `;
            })
            .join('');
    },

    clearTokenPoolLogs() {
        clearRuntimeLogEntries();
        this.refreshTokenPoolSummary();
        this.renderTokenPoolLogModal();
        getToast()?.success('号池运行日志已清空');
    },

    refreshTokenPoolSummary(summary = null) {
        if (!this.element) return;
        const autoRegister = getAutoRegister();
        const resolvedSummary = (summary && typeof summary === 'object')
            ? summary
            : (autoRegister?.getTokenPoolSummary?.() || null);
        if (!resolvedSummary || typeof resolvedSummary !== 'object') return;

        const fullCount = Number(resolvedSummary.fullCount || 0);
        const totalCount = Number(resolvedSummary.totalCount || 0);
        const targetFullCount = Number(resolvedSummary.targetFullCount || 2);
        const maxCount = Number(resolvedSummary.maxCount || 5);
        const lastCheckAtText = this.formatTokenPoolTime(resolvedSummary.lastCheckAt);
        const nextAllowedAtText = resolvedSummary.status === 'backoff'
            ? this.formatTokenPoolTime(resolvedSummary.nextAllowedAt)
            : '-';
        const errorText = typeof resolvedSummary.lastError === 'string' && resolvedSummary.lastError.trim()
            ? resolvedSummary.lastError.trim()
            : '-';
        const statusText = this.getTokenPoolStatusText(resolvedSummary);
        const latestProgressEntry = this.getTokenPoolLatestProgressEntry(resolvedSummary);
        const detailText = this.getTokenPoolStatusDetail(resolvedSummary, latestProgressEntry);
        const maintainButtonState = this.getTokenPoolMaintainButtonState(resolvedSummary);

        const fullEl = this.element.querySelector('#aifengyue-token-pool-full');
        const totalEl = this.element.querySelector('#aifengyue-token-pool-total');
        const statusEl = this.element.querySelector('#aifengyue-token-pool-status');
        const detailEl = this.element.querySelector('#aifengyue-token-pool-detail');
        const lastCheckEl = this.element.querySelector('#aifengyue-token-pool-last-check');
        const nextAllowedEl = this.element.querySelector('#aifengyue-token-pool-next-allowed');
        const errorEl = this.element.querySelector('#aifengyue-token-pool-last-error');
        const maintainBtn = this.element.querySelector('#aifengyue-token-pool-maintain');

        if (fullEl) fullEl.textContent = `${fullCount} / ${targetFullCount}`;
        if (totalEl) totalEl.textContent = `${totalCount} / ${maxCount}`;
        if (statusEl) statusEl.textContent = statusText;
        if (detailEl) detailEl.textContent = detailText;
        if (lastCheckEl) lastCheckEl.textContent = lastCheckAtText;
        if (nextAllowedEl) nextAllowedEl.textContent = nextAllowedAtText;
        if (errorEl) errorEl.textContent = errorText;
        if (maintainBtn) {
            maintainBtn.disabled = maintainButtonState.disabled;
            maintainBtn.textContent = maintainButtonState.text;
        }
        if (this.tokenPoolLogModalOpen) {
            this.renderTokenPoolLogModal();
        }
    },

    setAutoReloadEnabled(enabled) {
        const normalized = !!enabled;
        gmSetValue(CONFIG.STORAGE_KEYS.AUTO_RELOAD_ENABLED, normalized);
        const input = this.element?.querySelector?.('#aifengyue-auto-reload-toggle');
        if (input) {
            input.checked = normalized;
        }
    },

    setLayoutMode(mode) {
        this.layoutMode = mode === 'floating' ? 'floating' : 'inline';
        gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_LAYOUT_MODE, this.layoutMode);
        this.applyLayoutModeClass();
    },

    getTheme() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_THEME, 'light');
        return saved === 'dark' ? 'dark' : 'light';
    },

    setTheme(theme) {
        this.theme = theme === 'dark' ? 'dark' : 'light';
        gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_THEME, this.theme);
        this.applyTheme();
    },

    applyTheme() {
        if (!this.element) return;
        this.element.dataset.theme = this.theme;
        if (this.tokenPoolLogModal) {
            this.tokenPoolLogModal.dataset.theme = this.theme;
        }
        const btn = this.element.querySelector('.aifengyue-theme-toggle');
        if (btn) btn.textContent = this.theme === 'dark' ? '☀' : '🌙';
    },

    toggleTheme() {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    },

    refreshMailProviderConfigDisplay() {
        if (!this.element) return;

        const providerMeta = ApiService.getCurrentProviderMeta();
        const providerSelect = this.element.querySelector('#aifengyue-mail-provider');
        const apiKeyGroup = this.element.querySelector('#aifengyue-api-key-group');
        const apiKeyLabel = this.element.querySelector('#aifengyue-api-key-label');
        const apiKeyInput = this.element.querySelector('#aifengyue-api-key');
        const providerKeyHint = this.element.querySelector('#aifengyue-mail-provider-key-hint');
        const providerName = this.element.querySelector('#aifengyue-mail-provider-name');
        const saveKeyButton = this.element.querySelector('#aifengyue-save-key');
        const usageSection = this.element.querySelector('#aifengyue-usage-section');

        if (providerSelect) {
            providerSelect.value = providerMeta.id;
        }

        if (apiKeyLabel) {
            apiKeyLabel.textContent = providerMeta.apiKeyLabel;
        }
        if (apiKeyInput) {
            apiKeyInput.placeholder = providerMeta.apiKeyPlaceholder;
            apiKeyInput.value = providerMeta.requiresApiKey ? ApiService.getApiKey() : '';
            apiKeyInput.disabled = !providerMeta.requiresApiKey;
        }
        if (apiKeyGroup) {
            apiKeyGroup.style.display = providerMeta.requiresApiKey ? '' : 'none';
        }
        if (providerKeyHint) {
            providerKeyHint.textContent = providerMeta.requiresApiKey
                ? ''
                : '当前邮件提供商无需 API Key';
            providerKeyHint.style.display = providerMeta.requiresApiKey ? 'none' : '';
        }
        if (providerName) {
            providerName.textContent = `当前邮件提供商：${providerMeta.name}`;
        }
        if (saveKeyButton) {
            saveKeyButton.disabled = !providerMeta.requiresApiKey;
            saveKeyButton.style.display = providerMeta.requiresApiKey ? '' : 'none';
        }
        if (usageSection) {
            usageSection.style.display = providerMeta.supportsUsage ? '' : 'none';
        }
    },

    resetMailProviderState(providerMeta = ApiService.getCurrentProviderMeta()) {
        gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, '');
        this.updateState({
            email: '',
            verificationCode: '',
            status: 'idle',
            statusMessage: `已切换到 ${providerMeta.name}，请重新生成邮箱`,
        });

        const autoRegister = getAutoRegister();
        if (!autoRegister?.getFormElements || !autoRegister?.simulateInput) {
            return;
        }

        const { emailInput, codeInput } = autoRegister.getFormElements();
        if (emailInput) {
            autoRegister.simulateInput(emailInput, '');
        }
        if (codeInput) {
            autoRegister.simulateInput(codeInput, '');
        }
    },

    formatUsageSummary(snapshot) {
        if (snapshot?.usageStatus === 'unsupported' || snapshot?.supportsUsage === false) {
            return '当前邮件提供商未提供 usage';
        }
        if (!snapshot?.hasUsage) {
            return '等待邮件接口返回 usage...';
        }

        const totalRemaining = Number(snapshot?.remaining || 0);
        const totalText = totalRemaining < 0
            ? `总剩余: 超限 ${Math.abs(totalRemaining)} 次`
            : `总剩余: ${totalRemaining} 次`;
        const dailyLimit = Number(snapshot?.dailyLimit || 0);
        const dailyUsed = Number(snapshot?.dailyUsed || 0);

        if (dailyLimit > 0) {
            return `${totalText} · 今日: ${dailyUsed} / ${dailyLimit}`;
        }
        if (dailyUsed > 0 || Number.isFinite(Number(snapshot?.dailyRemaining))) {
            return `${totalText} · 今日已用: ${dailyUsed} 次`;
        }
        return totalText;
    },

    updateUsageDisplay(snapshot = ApiService.getUsageSnapshot()) {
        if (!this.element) return;

        const usageText = this.element.querySelector('#aifengyue-usage-text');
        const usageBar = this.element.querySelector('#aifengyue-usage-bar');
        const usageRemaining = this.element.querySelector('#aifengyue-usage-remaining');

        if (!snapshot?.hasUsage) {
            if (usageText) usageText.textContent = '-- / --';
            if (usageBar) {
                usageBar.style.width = '0%';
                usageBar.style.background = 'linear-gradient(90deg, #64748b, #94a3b8)';
            }
            if (usageRemaining) usageRemaining.textContent = this.formatUsageSummary(snapshot);
            return;
        }

        const used = Number(snapshot?.used || 0);
        const limit = Number(snapshot?.limit || CONFIG.API_QUOTA_LIMIT || 0);
        const percentage = Number(snapshot?.percentage || 0);

        if (usageText) usageText.textContent = `${used} / ${limit}`;
        if (usageBar) {
            usageBar.style.width = `${percentage}%`;
            if (percentage >= 90) {
                usageBar.style.background = 'linear-gradient(90deg, #dc2626, #b91c1c)';
            } else if (percentage >= 70) {
                usageBar.style.background = 'linear-gradient(90deg, #d97706, #b45309)';
            } else {
                usageBar.style.background = 'linear-gradient(90deg, #0d9488, #14b8a6)';
            }
        }
        if (usageRemaining) usageRemaining.textContent = this.formatUsageSummary(snapshot);
    },

    refreshModelFamilyMappingEditor() {
        if (!this.element) return;
        const sorter = getModelPopupSorter();
        if (!sorter) return;

        const rulesInput = this.element.querySelector('#aifengyue-model-family-rules');
        const unknownInput = this.element.querySelector('#aifengyue-model-family-unknowns');
        if (rulesInput) {
            rulesInput.value = sorter.getModelFamilyRulesText();
        }
        if (unknownInput) {
            unknownInput.value = sorter.getUnknownModelFamilySuggestionText(80);
        }
    },
};
