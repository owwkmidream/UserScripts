import { CONFIG } from '../../constants.js';
import { gmGetValue, gmSetValue } from '../../gm.js';
import { ApiService } from '../../services/api-service.js';
import { VALID_TABS } from './sidebar-context.js';

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
