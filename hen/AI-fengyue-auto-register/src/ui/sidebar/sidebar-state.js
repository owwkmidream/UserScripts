import { CONFIG, SIDEBAR_INITIAL_STATE } from '../../constants.js';
import { gmGetValue } from '../../gm.js';
import { isDebugEnabled } from '../../utils/logger.js';

export const sidebarStateMethods = {
    loadSavedData() {
        const apiKey = gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, '');
        if (apiKey) {
            this.element.querySelector('#aifengyue-api-key').value = apiKey;
        }

        const layoutModeInput = this.element.querySelector('#aifengyue-layout-mode');
        if (layoutModeInput) {
            layoutModeInput.value = this.layoutMode;
        }
        const defaultTabInput = this.element.querySelector('#aifengyue-default-tab');
        if (defaultTabInput) {
            defaultTabInput.value = this.getDefaultTab();
        }
        const defaultOpenInput = this.element.querySelector('#aifengyue-default-open');
        if (defaultOpenInput) {
            defaultOpenInput.value = this.getDefaultOpen() ? 'open' : 'closed';
        }
        const debugToggle = this.element.querySelector('#aifengyue-debug-toggle');
        if (debugToggle) {
            debugToggle.checked = isDebugEnabled();
        }
        const autoReloadToggle = this.element.querySelector('#aifengyue-auto-reload-toggle');
        if (autoReloadToggle) {
            autoReloadToggle.checked = this.getAutoReloadEnabled();
        }
        const chatTimeoutInput = this.element.querySelector('#aifengyue-chat-timeout-seconds');
        if (chatTimeoutInput) {
            chatTimeoutInput.value = String(this.getChatMessagesTimeoutSeconds());
        }

        this.updateUsageDisplay();
        this.render();
    },

    resetState() {
        Object.assign(this.state, SIDEBAR_INITIAL_STATE);
        this.render();
    },

    updateState(updates) {
        Object.assign(this.state, updates);
        this.render();
    },

    render() {
        if (!this.element) return;

        const statusMap = {
            idle: { text: '空闲', color: 'idle' },
            generating: { text: '生成中...', color: 'generating' },
            waiting: { text: '等待操作', color: 'polling' },
            fetching: { text: '执行中...', color: 'polling' },
            success: { text: '成功', color: 'success' },
            error: { text: '错误', color: 'error' },
        };

        const status = statusMap[this.state.status] || statusMap.idle;

        this.element.querySelectorAll('#aifengyue-status-dot, #aifengyue-conv-flow-status-dot').forEach((dot) => {
            dot.className = `aifengyue-status-dot ${status.color}`;
        });

        this.element.querySelectorAll('#aifengyue-status-text, #aifengyue-conv-flow-status-text').forEach((el) => {
            el.textContent = status.text;
        });

        this.element.querySelectorAll('#aifengyue-status-message, #aifengyue-conv-flow-status-message').forEach((el) => {
            el.textContent = this.state.statusMessage;
        });

        const email = this.element.querySelector('#aifengyue-email');
        const username = this.element.querySelector('#aifengyue-username');
        const password = this.element.querySelector('#aifengyue-password');
        const code = this.element.querySelector('#aifengyue-code');
        const debugToggle = this.element.querySelector('#aifengyue-debug-toggle');
        const autoReloadToggle = this.element.querySelector('#aifengyue-auto-reload-toggle');
        const chatTimeoutInput = this.element.querySelector('#aifengyue-chat-timeout-seconds');

        if (email) email.textContent = this.state.email || '未生成';
        if (username) username.textContent = this.state.username || '未生成';
        if (password) password.textContent = this.state.password || '未生成';
        if (code) code.textContent = this.state.verificationCode || '等待中...';
        if (debugToggle) debugToggle.checked = isDebugEnabled();
        if (autoReloadToggle) autoReloadToggle.checked = this.getAutoReloadEnabled();
        if (chatTimeoutInput) chatTimeoutInput.value = String(this.getChatMessagesTimeoutSeconds());

        this.updateToolPanel();
    },
};
