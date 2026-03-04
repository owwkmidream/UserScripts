import { CONFIG } from '../../constants.js';
import { ApiService } from '../../services/api-service.js';
import { ChatHistoryService } from '../../services/chat-history-service.js';
import { setDebugEnabled } from '../../utils/logger.js';
import { getAutoRegister, getIframeExtractor, getModelPopupSorter, getToast } from './sidebar-context.js';

export const sidebarEventsMethods = {
    bindEvents() {
        this.element.querySelector('.aifengyue-sidebar-close').addEventListener('click', () => this.close());
        this.element.querySelector('.aifengyue-theme-toggle').addEventListener('click', () => this.toggleTheme());

        this.element.querySelectorAll('.aifengyue-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.setActiveTab(btn.dataset.tab);
            });
        });

        this.element.querySelector('#aifengyue-save-key').addEventListener('click', () => {
            const input = this.element.querySelector('#aifengyue-api-key');
            const key = input.value.trim() || CONFIG.DEFAULT_API_KEY;
            ApiService.setApiKey(key);
            getToast()?.success('API Key 已保存');
        });

        this.element.querySelector('#aifengyue-layout-mode').addEventListener('change', (e) => {
            const mode = e.target.value;
            this.setLayoutMode(mode);
            getToast()?.info(`侧边栏已切换为${mode === 'inline' ? '插入模式' : '悬浮模式'}`);
        });

        this.element.querySelector('#aifengyue-default-tab').addEventListener('change', (e) => {
            const tab = typeof e?.target?.value === 'string' ? e.target.value : 'register';
            this.setDefaultTab(tab);
            getToast()?.success(`默认 Tab 已设置为「${this.tabLabel(this.getDefaultTab())}」`);
        });

        this.element.querySelector('#aifengyue-default-open').addEventListener('change', (e) => {
            const value = typeof e?.target?.value === 'string' ? e.target.value : 'closed';
            const shouldOpen = value === 'open';
            this.setDefaultOpen(shouldOpen);
            if (shouldOpen) {
                this.open();
            } else {
                this.close();
            }
            getToast()?.success(`侧边栏默认已设置为「${shouldOpen ? '打开' : '关闭'}」`);
        });

        this.element.querySelector('#aifengyue-debug-toggle').addEventListener('change', (e) => {
            const enabled = !!e?.target?.checked;
            setDebugEnabled(enabled);
            getToast()?.info(`调试日志已${enabled ? '开启' : '关闭'}`);
        });

        this.element.querySelector('#aifengyue-auto-reload-toggle').addEventListener('change', (e) => {
            const enabled = !!e?.target?.checked;
            this.setAutoReloadEnabled(enabled);
            getToast()?.info(`自动刷新已${enabled ? '开启' : '关闭'}`);
        });

        this.element.querySelector('#aifengyue-chat-timeout-seconds').addEventListener('change', (e) => {
            const seconds = this.setChatMessagesTimeoutSeconds(e?.target?.value);
            if (seconds > 0) {
                getToast()?.info(`/chat-messages 超时已设置为 ${seconds} 秒`);
            } else {
                getToast()?.info('/chat-messages 超时主动失败已关闭');
            }
        });

        this.element.querySelector('#aifengyue-start').addEventListener('click', () => {
            getAutoRegister()?.start();
        });

        this.element.querySelector('#aifengyue-start-oneclick').addEventListener('click', () => {
            getAutoRegister()?.startOneClickRegister();
        });

        this.element.querySelector('#aifengyue-switch-account').addEventListener('click', () => {
            const input = this.element.querySelector('#aifengyue-switch-text');
            const extraText = input?.value?.trim() || '';
            getAutoRegister()?.switchAccount(extraText);
        });

        this.element.querySelector('#aifengyue-refresh-email').addEventListener('click', () => {
            getAutoRegister()?.generateNewEmail();
        });

        this.element.querySelector('#aifengyue-fetch-code').addEventListener('click', () => {
            getAutoRegister()?.fetchVerificationCode();
        });

        this.element.querySelectorAll('.aifengyue-copy-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const type = e.target.dataset.copy;
                let value = '';
                switch (type) {
                    case 'email': value = this.state.email; break;
                    case 'username': value = this.state.username; break;
                    case 'password': value = this.state.password; break;
                    case 'code': value = this.state.verificationCode; break;
                }
                if (value) {
                    this.copyTextToClipboard(value, {
                        successMessage: '已复制到剪贴板',
                        errorMessage: '复制失败',
                    });
                }
            });
        });

        this.element.querySelector('#aifengyue-reset-usage').addEventListener('click', () => {
            if (confirm('确定要重置 API 使用统计吗？')) {
                ApiService.resetUsageCount();
                getToast()?.success('统计已重置');
            }
        });

        this.element.querySelector('#aifengyue-extract-html').addEventListener('click', () => {
            const extractor = getIframeExtractor();
            if (!extractor) return;
            if (!extractor.isExtractAvailable()) {
                getToast()?.warning('当前页面不是可提取的应用详情页');
                this.updateToolPanel();
                return;
            }
            extractor.extractAndSave();
            this.updateToolPanel();
        });

        this.element.querySelector('#aifengyue-sort-now').addEventListener('click', () => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            sorter.sortPopup();
            getToast()?.info('已触发一次模型排序');
        });

        this.element.querySelector('#aifengyue-sort-toggle').addEventListener('change', (e) => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            sorter.setSortEnabled(!!e.target.checked);
            getToast()?.info(`自动排序已${e.target.checked ? '开启' : '关闭'}`);
        });

        this.element.querySelector('#aifengyue-conversation-chain').addEventListener('change', async (e) => {
            const chainId = e.target.value || '';
            if (!chainId || !this.conversation.appId) return;
            this.conversation.activeChainId = chainId;
            ChatHistoryService.setActiveChainId(this.conversation.appId, chainId);
            this.renderConversationLatestQueryTail();
            await this.renderConversationViewer();
        });

        this.element.querySelector('#aifengyue-conversation-global-chain').addEventListener('change', (e) => {
            const chainId = typeof e?.target?.value === 'string' ? e.target.value : '';
            this.conversation.activeGlobalChainId = chainId;
            this.renderGlobalConversationLatestQueryTail();
        });

        this.element.querySelector('#aifengyue-conversation-refresh').addEventListener('click', async () => {
            await this.refreshConversationPanel({ showToast: true, keepSelection: true });
        });

        this.element.querySelector('#aifengyue-conversation-global-refresh').addEventListener('click', async () => {
            await this.refreshGlobalConversationPanel({ showToast: true, keepSelection: true });
        });

        this.element.querySelector('#aifengyue-conversation-sync').addEventListener('click', async () => {
            await this.syncConversationPanel();
        });

        this.element.querySelector('#aifengyue-conversation-export').addEventListener('click', async () => {
            await this.exportConversationChainJson();
        });

        this.element.querySelector('#aifengyue-conversation-import-trigger').addEventListener('click', () => {
            const fileInput = this.element.querySelector('#aifengyue-conversation-import-file');
            if (!fileInput) return;
            fileInput.value = '';
            fileInput.click();
        });

        this.element.querySelector('#aifengyue-conversation-import-file').addEventListener('change', async (e) => {
            const file = e?.target?.files?.[0];
            if (!file) return;
            await this.importConversationChainJson(file);
        });

        this.element.querySelector('#aifengyue-conversation-open-preview').addEventListener('click', async () => {
            this.openConversationModal();
            await this.renderConversationViewer();
        });

        this.element.querySelector('#aifengyue-conversation-global-open-preview').addEventListener('click', async () => {
            await this.openGlobalConversationPreview();
        });

        this.element.querySelector('#aifengyue-conversation-global-delete').addEventListener('click', async () => {
            await this.deleteSelectedGlobalConversationChain();
        });
    },

    async copyTextToClipboard(text, { successMessage = '已复制到剪贴板', errorMessage = '复制失败' } = {}) {
        const value = typeof text === 'string' ? text : String(text ?? '');
        if (!value) return false;

        const fallbackCopy = () => {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', 'readonly');
            textarea.style.position = 'fixed';
            textarea.style.top = '-1000px';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);

            let copied = false;
            try {
                copied = document.execCommand('copy');
            } finally {
                textarea.remove();
            }
            return copied;
        };

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else if (!fallbackCopy()) {
                throw new Error('fallback-copy-failed');
            }
            getToast()?.success(successMessage);
            return true;
        } catch {
            try {
                const copied = fallbackCopy();
                if (!copied) {
                    throw new Error('fallback-copy-failed');
                }
                getToast()?.success(successMessage);
                return true;
            } catch {
                getToast()?.error(errorMessage);
                return false;
            }
        }
    },

    bindConversationPreviewCopyButtons(doc) {
        if (!doc) return;
        const buttons = doc.querySelectorAll('.af-copy-btn[data-af-copy-target]');
        buttons.forEach((button) => {
            button.addEventListener('click', async () => {
                const selector = button.getAttribute('data-af-copy-target') || '';
                if (!selector) return;

                const target = doc.querySelector(selector);
                const text = typeof target?.textContent === 'string'
                    ? target.textContent.replace(/\u00a0/g, ' ').trim()
                    : '';
                if (!text) {
                    getToast()?.warning('当前消息为空，无法复制');
                    return;
                }

                const copied = await this.copyTextToClipboard(text, {
                    successMessage: '消息已复制到剪贴板',
                    errorMessage: '消息复制失败',
                });
                if (copied) {
                    const prev = button.textContent;
                    button.textContent = '已复制';
                    setTimeout(() => {
                        button.textContent = prev || '复制';
                    }, 900);
                }
            });
        });
    },
};
