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
                if (btn.dataset.tab === 'tools') {
                    this.refreshModelFamilyMappingEditor();
                }
            });
        });

        this.element.querySelector('#aifengyue-save-key').addEventListener('click', () => {
            const input = this.element.querySelector('#aifengyue-api-key');
            const providerMeta = ApiService.getCurrentProviderMeta();
            if (!providerMeta.requiresApiKey) {
                this.refreshMailProviderConfigDisplay();
                getToast()?.info(`${providerMeta.name} 无需 API Key`);
                return;
            }
            const key = input.value.trim() || ApiService.getDefaultApiKey();
            ApiService.setApiKey(key);
            this.refreshMailProviderConfigDisplay();
            getToast()?.success(`${providerMeta.name} API Key 已保存`);
        });

        this.element.querySelector('#aifengyue-mail-provider').addEventListener('change', (e) => {
            const providerId = typeof e?.target?.value === 'string' ? e.target.value : '';
            if (!providerId || providerId === ApiService.getCurrentProviderId()) {
                this.refreshMailProviderConfigDisplay();
                return;
            }

            ApiService.setCurrentProviderId(providerId);
            const providerMeta = ApiService.getCurrentProviderMeta();
            this.refreshMailProviderConfigDisplay();
            this.updateUsageDisplay(ApiService.getUsageSnapshot(providerMeta.id));
            this.resetMailProviderState(providerMeta);
            getToast()?.success(`已切换到 ${providerMeta.name}，请重新生成邮箱`);
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

        const pointPollInput = this.element.querySelector('#aifengyue-account-point-poll-seconds');
        const applyPointPollingSeconds = (value, { showToast = false } = {}) => {
            const seconds = this.setAccountPointPollSeconds(value);
            getAutoRegister()?.refreshAccountPointPolling({
                intervalMs: seconds * 1000,
            });
            if (showToast) {
                getToast()?.info(`积分轮询间隔已设置为 ${seconds} 秒`);
            }
            return seconds;
        };
        pointPollInput.addEventListener('input', (e) => {
            if (this.accountPointPollApplyTimer) {
                clearTimeout(this.accountPointPollApplyTimer);
            }
            this.accountPointPollApplyTimer = setTimeout(() => {
                applyPointPollingSeconds(e?.target?.value, { showToast: false });
                this.accountPointPollApplyTimer = null;
            }, 420);
        });
        pointPollInput.addEventListener('change', (e) => {
            if (this.accountPointPollApplyTimer) {
                clearTimeout(this.accountPointPollApplyTimer);
                this.accountPointPollApplyTimer = null;
            }
            applyPointPollingSeconds(e?.target?.value, { showToast: true });
        });

        const tokenPoolCheckInput = this.element.querySelector('#aifengyue-token-pool-check-seconds');
        const applyTokenPoolCheckSeconds = (value, { showToast = false } = {}) => {
            const seconds = this.setTokenPoolCheckSeconds(value);
            const autoRegister = getAutoRegister();
            autoRegister?.refreshTokenPoolScheduler?.({
                intervalSeconds: seconds,
                reason: 'settings-change',
            });
            this.refreshTokenPoolSummary(autoRegister?.getTokenPoolSummary?.() || null);
            if (showToast) {
                if (seconds > 0) {
                    getToast()?.info(`号池定时检测已设置为 ${seconds} 秒`);
                } else {
                    getToast()?.info('号池定时检测已关闭');
                }
            }
            return seconds;
        };
        tokenPoolCheckInput.addEventListener('input', (e) => {
            if (this.tokenPoolCheckApplyTimer) {
                clearTimeout(this.tokenPoolCheckApplyTimer);
            }
            this.tokenPoolCheckApplyTimer = setTimeout(() => {
                applyTokenPoolCheckSeconds(e?.target?.value, { showToast: false });
                this.tokenPoolCheckApplyTimer = null;
            }, 420);
        });
        tokenPoolCheckInput.addEventListener('change', (e) => {
            if (this.tokenPoolCheckApplyTimer) {
                clearTimeout(this.tokenPoolCheckApplyTimer);
                this.tokenPoolCheckApplyTimer = null;
            }
            applyTokenPoolCheckSeconds(e?.target?.value, { showToast: true });
        });

        this.element.querySelector('#aifengyue-token-pool-maintain').addEventListener('click', async () => {
            const autoRegister = getAutoRegister();
            if (!autoRegister?.maintainTokenPool) {
                getToast()?.warning('号池维护能力未就绪');
                return;
            }

            this.openTokenPoolLogModal();
            const summary = await autoRegister.maintainTokenPool({
                reason: 'manual-button',
                force: true,
            });
            this.refreshTokenPoolSummary(summary);
            this.renderTokenPoolLogModal();

            if (summary?.maintaining) {
                getToast()?.info('号池已在维护中，可在日志弹窗查看实时进度');
                return;
            }
            if (summary?.status === 'locked') {
                getToast()?.info(summary?.lockHeldByCurrentTab
                    ? '当前标签页已有号池任务在执行'
                    : '其他标签页正在操作号池，请稍后再试');
                return;
            }
            if (summary?.status === 'ok') {
                getToast()?.success('号池手动维护完成');
                return;
            }
            if (summary?.status === 'failed') {
                getToast()?.warning('号池维护失败，请查看日志详情');
                return;
            }
            getToast()?.info('号池维护已触发，可在日志弹窗查看详情');
        });

        this.element.querySelector('#aifengyue-token-pool-view-log').addEventListener('click', () => {
            this.openTokenPoolLogModal();
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
            this.refreshModelFamilyMappingEditor();
            getToast()?.info('已触发一次模型排序');
        });

        this.element.querySelector('#aifengyue-sort-toggle').addEventListener('change', (e) => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            sorter.setSortEnabled(!!e.target.checked);
            getToast()?.info(`自动排序已${e.target.checked ? '开启' : '关闭'}`);
        });

        this.element.querySelector('#aifengyue-model-family-save').addEventListener('click', () => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            const input = this.element.querySelector('#aifengyue-model-family-rules');
            const text = typeof input?.value === 'string' ? input.value : '';
            sorter.setModelFamilyRulesText(text);
            this.refreshModelFamilyMappingEditor();
            getToast()?.success('模型映射规则已保存并生效');
        });

        this.element.querySelector('#aifengyue-model-family-reset').addEventListener('click', () => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            sorter.resetModelFamilyRulesText();
            this.refreshModelFamilyMappingEditor();
            getToast()?.info('已恢复默认映射规则');
        });

        this.element.querySelector('#aifengyue-model-family-fill-unknown').addEventListener('click', () => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            const draft = sorter.getUnknownModelFamilySuggestionText(80);
            if (!draft) {
                getToast()?.warning('暂无未映射前缀，请先打开模型弹窗触发扫描');
                return;
            }
            const input = this.element.querySelector('#aifengyue-model-family-rules');
            if (!input) return;
            const current = String(input.value || '').trim();
            const lines = new Set(current ? current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []);
            draft.split(/\r?\n/).forEach((line) => {
                const normalized = line.trim();
                if (normalized) lines.add(normalized);
            });
            input.value = [...lines].join('\n');
            getToast()?.info('已追加未映射前缀草案，请检查后点击“保存规则”');
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
        const triggers = doc.querySelectorAll('[data-af-copy-target], [data-af-copy-text]');
        const handleCopy = async (trigger) => {
            const mode = trigger.getAttribute('data-af-copy-mode') || 'text';
            const encodedText = trigger.getAttribute('data-af-copy-text');
            let rawText = '';

            if (encodedText !== null) {
                try {
                    rawText = decodeURIComponent(encodedText);
                } catch {
                    rawText = encodedText;
                }
            } else {
                const selector = trigger.getAttribute('data-af-copy-target') || '';
                if (!selector) return;
                const target = doc.querySelector(selector);
                if (mode === 'icon') {
                    rawText = typeof target?.textContent === 'string'
                        ? target.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '')
                        : '';
                } else if (target) {
                    const copyRoot = target.cloneNode(true);
                    copyRoot.querySelectorAll('[data-af-copy-ignore]').forEach((node) => node.remove());
                    rawText = typeof copyRoot.textContent === 'string'
                        ? copyRoot.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '')
                        : '';
                }
            }

            const text = encodedText !== null
                ? rawText
                : mode === 'icon'
                    ? rawText
                    : rawText.trim();
            if (!text) {
                getToast()?.warning(mode === 'icon' ? '当前代码块为空，无法复制' : '当前消息为空，无法复制');
                return;
            }

            const copied = await this.copyTextToClipboard(text, {
                successMessage: mode === 'icon' ? '代码已复制到剪贴板' : '消息已复制到剪贴板',
                errorMessage: mode === 'icon' ? '代码复制失败' : '消息复制失败',
            });
            if (!copied) return;

            if (mode === 'icon') {
                const icon = trigger.querySelector('.af-code-copy-icon');
                const copiedClass = trigger.getAttribute('data-af-copy-copied-class') || 'style_copied__SbkhO';
                if (!icon) return;
                if (trigger.__afCopyResetTimer) {
                    clearTimeout(trigger.__afCopyResetTimer);
                }
                icon.classList.add(copiedClass, 'af-code-copy-icon-copied');
                trigger.__afCopyResetTimer = setTimeout(() => {
                    icon.classList.remove(copiedClass, 'af-code-copy-icon-copied');
                    trigger.__afCopyResetTimer = null;
                }, 900);
                return;
            }

            const prev = trigger.textContent;
            trigger.textContent = '已复制';
            setTimeout(() => {
                trigger.textContent = prev || '复制';
            }, 900);
        };

        triggers.forEach((trigger) => {
            if (trigger.dataset.afCopyBound === '1') return;
            trigger.dataset.afCopyBound = '1';

            trigger.addEventListener('click', async (event) => {
                event.preventDefault();
                await handleCopy(trigger);
            });

            if (trigger.getAttribute('data-af-copy-mode') === 'icon') {
                trigger.addEventListener('keydown', async (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    await handleCopy(trigger);
                });
            }
        });
    },
};
