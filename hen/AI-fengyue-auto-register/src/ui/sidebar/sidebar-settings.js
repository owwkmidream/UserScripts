import { CONFIG } from '../../constants.js';
import { gmGetValue, gmSetValue } from '../../gm.js';
import { ApiService } from '../../services/api-service.js';
import { getAutoRegister, VALID_TABS } from './sidebar-context.js';

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
        const nextAllowedAtText = this.formatTokenPoolTime(resolvedSummary.nextAllowedAt);
        const errorText = typeof resolvedSummary.lastError === 'string' && resolvedSummary.lastError.trim()
            ? resolvedSummary.lastError.trim()
            : '-';
        const statusText = resolvedSummary.schedulerEnabled
            ? (resolvedSummary.schedulerRunning ? '运行中' : '待启动')
            : '已关闭';

        const fullEl = this.element.querySelector('#aifengyue-token-pool-full');
        const totalEl = this.element.querySelector('#aifengyue-token-pool-total');
        const statusEl = this.element.querySelector('#aifengyue-token-pool-status');
        const lastCheckEl = this.element.querySelector('#aifengyue-token-pool-last-check');
        const nextAllowedEl = this.element.querySelector('#aifengyue-token-pool-next-allowed');
        const errorEl = this.element.querySelector('#aifengyue-token-pool-last-error');

        if (fullEl) fullEl.textContent = `${fullCount} / ${targetFullCount}`;
        if (totalEl) totalEl.textContent = `${totalCount} / ${maxCount}`;
        if (statusEl) statusEl.textContent = statusText;
        if (lastCheckEl) lastCheckEl.textContent = lastCheckAtText;
        if (nextAllowedEl) nextAllowedEl.textContent = nextAllowedAtText;
        if (errorEl) errorEl.textContent = errorText;
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
        const btn = this.element.querySelector('.aifengyue-theme-toggle');
        if (btn) btn.textContent = this.theme === 'dark' ? '☀' : '🌙';
    },

    toggleTheme() {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    },

    updateUsageDisplay(snapshot = ApiService.getUsageSnapshot()) {
        if (!this.element) return;

        const used = Number(snapshot?.used || 0);
        const limit = Number(snapshot?.limit || CONFIG.API_QUOTA_LIMIT || 0);
        const remaining = Number(snapshot?.remaining || 0);
        const percentage = Number(snapshot?.percentage || 0);

        const usageText = this.element.querySelector('#aifengyue-usage-text');
        const usageBar = this.element.querySelector('#aifengyue-usage-bar');
        const usageRemaining = this.element.querySelector('#aifengyue-usage-remaining');

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
        if (usageRemaining) usageRemaining.textContent = `剩余: ${remaining} 次`;
    },
};
