import { ChatHistoryService } from '../../services/chat-history-service.js';
import { getAutoRegister, getToast } from './sidebar-context.js';

export const sidebarConversationMethods = {
    setConversationStatus(message) {
        const statusEl = this.element?.querySelector('#aifengyue-conversation-status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    },

    setGlobalConversationStatus(message) {
        const statusEl = this.element?.querySelector('#aifengyue-conversation-global-status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    },

    setConversationBusy(busy) {
        this.conversation.loading = !!busy;
        const chainSelect = this.element?.querySelector('#aifengyue-conversation-chain');
        const globalChainSelect = this.element?.querySelector('#aifengyue-conversation-global-chain');
        const refreshBtn = this.element?.querySelector('#aifengyue-conversation-refresh');
        const globalRefreshBtn = this.element?.querySelector('#aifengyue-conversation-global-refresh');
        const syncBtn = this.element?.querySelector('#aifengyue-conversation-sync');
        const exportBtn = this.element?.querySelector('#aifengyue-conversation-export');
        const importTriggerBtn = this.element?.querySelector('#aifengyue-conversation-import-trigger');
        const importFileInput = this.element?.querySelector('#aifengyue-conversation-import-file');
        const openPreviewBtn = this.element?.querySelector('#aifengyue-conversation-open-preview');
        const globalOpenPreviewBtn = this.element?.querySelector('#aifengyue-conversation-global-open-preview');
        const globalDeleteBtn = this.element?.querySelector('#aifengyue-conversation-global-delete');
        const switchBtn = this.element?.querySelector('#aifengyue-switch-account');
        if (chainSelect) chainSelect.disabled = !!busy;
        if (globalChainSelect) globalChainSelect.disabled = !!busy;
        if (refreshBtn) refreshBtn.disabled = !!busy;
        if (globalRefreshBtn) globalRefreshBtn.disabled = !!busy;
        if (syncBtn) syncBtn.disabled = !!busy;
        if (exportBtn) exportBtn.disabled = !!busy;
        if (importTriggerBtn) importTriggerBtn.disabled = !!busy;
        if (importFileInput) importFileInput.disabled = !!busy;
        if (openPreviewBtn) openPreviewBtn.disabled = !!busy;
        if (globalOpenPreviewBtn) globalOpenPreviewBtn.disabled = !!busy;
        if (globalDeleteBtn) globalDeleteBtn.disabled = !!busy;
        if (switchBtn) switchBtn.disabled = !!busy;
    },

    renderConversationSelectOptions() {
        const select = this.element?.querySelector('#aifengyue-conversation-chain');
        const openPreviewBtn = this.element?.querySelector('#aifengyue-conversation-open-preview');
        const exportBtn = this.element?.querySelector('#aifengyue-conversation-export');
        if (!select) return;

        select.innerHTML = '';
        if (!this.conversation.chains.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '暂无链路';
            select.appendChild(option);
            select.value = '';
            if (openPreviewBtn) openPreviewBtn.disabled = true;
            if (exportBtn) exportBtn.disabled = true;
            this.renderConversationLatestQueryTail();
            return;
        }

        this.conversation.chains.forEach((chain, index) => {
            const option = document.createElement('option');
            option.value = chain.chainId;
            const conversationCount = Array.isArray(chain.conversationIds) ? chain.conversationIds.length : 0;
            const messageCount = Number(chain.messageCount || 0);
            const answerCount = Number(chain.answerCount || 0);
            const updatedAt = chain.updatedAt ? new Date(chain.updatedAt).toLocaleString() : '-';
            option.textContent = `链路${index + 1} | ${conversationCount}会话 | ${answerCount}答复 | ${messageCount}消息 | ${updatedAt}`;
            select.appendChild(option);
        });

        if (this.conversation.activeChainId) {
            select.value = this.conversation.activeChainId;
        }
        if (openPreviewBtn) {
            openPreviewBtn.disabled = false;
        }
        if (exportBtn && !this.conversation.loading) {
            exportBtn.disabled = false;
        }

        this.renderConversationLatestQueryTail();
    },

    renderConversationLatestQueryTail() {
        const tailEl = this.element?.querySelector('#aifengyue-conversation-latest-query');
        if (!tailEl) return;
        if (!Array.isArray(this.conversation.chains) || this.conversation.chains.length === 0) {
            tailEl.textContent = '-';
            return;
        }

        const activeChain = this.conversation.chains.find((chain) => chain.chainId === this.conversation.activeChainId)
            || this.conversation.chains[0];
        const latestQueryTail = typeof activeChain?.latestQueryTail === 'string'
            ? activeChain.latestQueryTail.trim()
            : '';
        tailEl.textContent = latestQueryTail || '-';
    },

    renderGlobalConversationSelectOptions() {
        const select = this.element?.querySelector('#aifengyue-conversation-global-chain');
        const openPreviewBtn = this.element?.querySelector('#aifengyue-conversation-global-open-preview');
        const deleteBtn = this.element?.querySelector('#aifengyue-conversation-global-delete');
        if (!select) return;

        select.innerHTML = '';
        if (!Array.isArray(this.conversation.globalChains) || this.conversation.globalChains.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '暂无链路';
            select.appendChild(option);
            select.value = '';
            this.conversation.activeGlobalChainId = '';
            if (openPreviewBtn) openPreviewBtn.disabled = true;
            if (deleteBtn) deleteBtn.disabled = true;
            this.renderGlobalConversationLatestQueryTail();
            return;
        }

        this.conversation.globalChains.forEach((chain, index) => {
            const option = document.createElement('option');
            option.value = chain.chainId;
            const conversationCount = Array.isArray(chain.conversationIds) ? chain.conversationIds.length : 0;
            const messageCount = Number(chain.messageCount || 0);
            const answerCount = Number(chain.answerCount || 0);
            const updatedAt = chain.updatedAt ? new Date(chain.updatedAt).toLocaleString() : '-';
            const appLabel = (typeof chain.appName === 'string' && chain.appName.trim())
                ? chain.appName.trim()
                : chain.appId;
            option.textContent = `${index + 1}. ${appLabel} | ${conversationCount}会话 | ${answerCount}答复 | ${messageCount}消息 | ${updatedAt}`;
            select.appendChild(option);
        });

        if (this.conversation.activeGlobalChainId
            && this.conversation.globalChains.some((chain) => chain.chainId === this.conversation.activeGlobalChainId)) {
            select.value = this.conversation.activeGlobalChainId;
        } else {
            this.conversation.activeGlobalChainId = this.conversation.globalChains[0]?.chainId || '';
            select.value = this.conversation.activeGlobalChainId;
        }
        if (openPreviewBtn) {
            openPreviewBtn.disabled = false;
        }
        if (deleteBtn && !this.conversation.loading) {
            deleteBtn.disabled = false;
        }

        this.renderGlobalConversationLatestQueryTail();
    },

    getActiveGlobalConversationChain() {
        if (!Array.isArray(this.conversation.globalChains) || this.conversation.globalChains.length === 0) {
            return null;
        }
        return this.conversation.globalChains.find((chain) => chain.chainId === this.conversation.activeGlobalChainId)
            || this.conversation.globalChains[0];
    },

    renderGlobalConversationLatestQueryTail() {
        const tailEl = this.element?.querySelector('#aifengyue-conversation-global-latest-query');
        if (!tailEl) return;

        const activeChain = this.getActiveGlobalConversationChain();
        if (!activeChain) {
            tailEl.textContent = '-';
            return;
        }
        const latestQueryTail = typeof activeChain.latestQueryTail === 'string'
            ? activeChain.latestQueryTail.trim()
            : '';
        tailEl.textContent = latestQueryTail || '-';
    },

    async renderConversationViewer({ appId = '', chainId = '' } = {}) {
        const viewer = document.getElementById('aifengyue-conversation-viewer');
        if (!viewer) {
            console.warn('[AI风月注册助手][CONV] 未找到会话预览 iframe');
            return;
        }

        const resolvedAppId = (typeof appId === 'string' ? appId.trim() : '') || this.conversation.appId;
        const resolvedChainId = (typeof chainId === 'string' ? chainId.trim() : '') || this.conversation.activeChainId;
        if (!resolvedAppId || !resolvedChainId) {
            viewer.srcdoc = '<html><body><p style="font-family:Segoe UI;padding:16px;">暂无可展示会话。</p></body></html>';
            return;
        }

        const html = await ChatHistoryService.buildChainViewerHtml({
            appId: resolvedAppId,
            chainId: resolvedChainId,
        });
        viewer.onload = () => {
            try {
                const doc = viewer.contentDocument;
                if (!doc) return;
                this.bindConversationPreviewCopyButtons(doc);
                const scrollToBottom = () => {
                    const scrolling = doc.scrollingElement || doc.documentElement || doc.body;
                    if (scrolling) {
                        scrolling.scrollTop = scrolling.scrollHeight;
                    }
                    const container = doc.querySelector('.chat-container');
                    if (container && container.parentElement) {
                        container.parentElement.scrollTop = container.parentElement.scrollHeight;
                    }
                };
                scrollToBottom();
                setTimeout(scrollToBottom, 60);
                setTimeout(scrollToBottom, 220);
            } catch (error) {
                console.warn('[AI风月注册助手][CONV] 预览滚动到底部失败', error);
            }
        };
        viewer.srcdoc = html;
    },

    async refreshConversationPanel({ showToast = false, keepSelection = true } = {}) {
        if (!this.element) return;

        const autoRegister = getAutoRegister();
        if (!autoRegister) {
            this.setConversationStatus('AutoRegister 未初始化');
            await this.refreshGlobalConversationPanel({
                showToast: false,
                keepSelection: true,
                useBusy: false,
            });
            return;
        }

        this.setConversationBusy(true);
        try {
            const previousChainId = keepSelection ? this.conversation.activeChainId : '';
            const result = await autoRegister.loadConversationChainsForCurrentApp();

            this.conversation.appId = result.appId || '';
            this.conversation.chains = Array.isArray(result.chains) ? result.chains : [];
            this.conversation.activeChainId = '';

            if (previousChainId && this.conversation.chains.some((chain) => chain.chainId === previousChainId)) {
                this.conversation.activeChainId = previousChainId;
            } else if (result.activeChainId) {
                this.conversation.activeChainId = result.activeChainId;
            } else if (this.conversation.chains[0]?.chainId) {
                this.conversation.activeChainId = this.conversation.chains[0].chainId;
            }

            if (this.conversation.appId && this.conversation.activeChainId) {
                ChatHistoryService.setActiveChainId(this.conversation.appId, this.conversation.activeChainId);
            }

            this.renderConversationSelectOptions();
            await this.renderConversationViewer();
            await this.refreshGlobalConversationPanel({
                showToast: false,
                keepSelection: true,
                useBusy: false,
            });

            if (!this.conversation.appId) {
                this.setConversationStatus('当前页面不是应用详情页，无法读取会话链。');
            } else if (!this.conversation.chains.length) {
                this.setConversationStatus('本地暂无会话链，可先执行“更换账号”或手动同步。');
            } else {
                const lastSync = this.conversation.activeChainId
                    ? ChatHistoryService.getChainLastSync(this.conversation.activeChainId)
                    : 0;
                const lastSyncText = lastSync ? new Date(lastSync).toLocaleString() : '未同步';
                this.setConversationStatus(`已加载 ${this.conversation.chains.length} 条链路，最近同步: ${lastSyncText}`);
            }

            if (showToast) {
                getToast()?.success('会话链路已刷新');
            }
        } catch (error) {
            this.setConversationStatus(`刷新失败: ${error.message}`);
            getToast()?.error(`会话刷新失败: ${error.message}`);
        } finally {
            this.setConversationBusy(false);
        }
    },

    async refreshGlobalConversationPanel({ showToast = false, keepSelection = true, useBusy = true } = {}) {
        if (!this.element) return;

        if (useBusy) {
            this.setConversationBusy(true);
        }
        try {
            const previousChainId = keepSelection ? this.conversation.activeGlobalChainId : '';
            const chains = await ChatHistoryService.listAllChains();
            const chainsWithDetails = await Promise.all(
                chains.map(async (chain) => {
                    const [stats, appMeta] = await Promise.all([
                        ChatHistoryService.getChainStats(chain.chainId),
                        ChatHistoryService.getAppMeta(chain.appId),
                    ]);
                    return {
                        ...chain,
                        ...stats,
                        appName: typeof appMeta?.name === 'string' ? appMeta.name : '',
                    };
                })
            );

            this.conversation.globalChains = chainsWithDetails;
            this.conversation.activeGlobalChainId = '';
            if (previousChainId && chainsWithDetails.some((chain) => chain.chainId === previousChainId)) {
                this.conversation.activeGlobalChainId = previousChainId;
            } else if (chainsWithDetails[0]?.chainId) {
                this.conversation.activeGlobalChainId = chainsWithDetails[0].chainId;
            }

            this.renderGlobalConversationSelectOptions();
            if (!chainsWithDetails.length) {
                this.setGlobalConversationStatus('本地暂无链路，可先执行更换账号或导入 JSON。');
            } else {
                const appCount = new Set(chainsWithDetails.map((item) => item.appId).filter(Boolean)).size;
                this.setGlobalConversationStatus(`已加载 ${chainsWithDetails.length} 条链路，覆盖 ${appCount} 个 App。`);
            }

            if (showToast) {
                getToast()?.success('全局链路已刷新');
            }
        } catch (error) {
            this.setGlobalConversationStatus(`全局链路刷新失败: ${error.message}`);
            getToast()?.error(`全局链路刷新失败: ${error.message}`);
        } finally {
            if (useBusy) {
                this.setConversationBusy(false);
            }
        }
    },

    async openGlobalConversationPreview() {
        const chain = this.getActiveGlobalConversationChain();
        if (!chain?.appId || !chain?.chainId) {
            getToast()?.warning('当前没有可预览的全局链路');
            return;
        }

        this.openConversationModal();
        await this.renderConversationViewer({
            appId: chain.appId,
            chainId: chain.chainId,
        });
    },

    async deleteSelectedGlobalConversationChain() {
        const chain = this.getActiveGlobalConversationChain();
        if (!chain?.chainId) {
            getToast()?.warning('当前没有可删除的链路');
            return;
        }

        const appLabel = (typeof chain.appName === 'string' && chain.appName.trim())
            ? `${chain.appName.trim()} (${chain.appId})`
            : chain.appId;
        const confirmed = confirm(
            `确认删除该链路？\nApp: ${appLabel || '-'}\nChain: ${chain.chainId}\n\n删除后将移除该链路下全部本地消息，且不可恢复。`
        );
        if (!confirmed) return;

        this.setConversationBusy(true);
        try {
            const summary = await ChatHistoryService.deleteChain(chain.chainId);
            if (!summary.deleted) {
                this.setGlobalConversationStatus(`链路不存在或已删除：${chain.chainId}`);
                getToast()?.warning('目标链路不存在或已删除');
                await this.refreshGlobalConversationPanel({ showToast: false, keepSelection: false, useBusy: false });
                return;
            }

            if (this.conversation.activeChainId === chain.chainId) {
                this.conversation.activeChainId = '';
            }
            if (this.conversation.activeGlobalChainId === chain.chainId) {
                this.conversation.activeGlobalChainId = '';
            }

            await this.refreshConversationPanel({ showToast: false, keepSelection: false });

            const statusText = `已删除链路：${chain.chainId}（删除 ${summary.deletedMessageCount} 条消息）`;
            this.setGlobalConversationStatus(statusText);
            this.setConversationStatus(statusText);
            getToast()?.success(statusText);
        } catch (error) {
            this.setGlobalConversationStatus(`删除失败: ${error.message}`);
            getToast()?.error(`删除链路失败: ${error.message}`);
        } finally {
            this.setConversationBusy(false);
        }
    },

    async syncConversationPanel() {
        const autoRegister = getAutoRegister();
        if (!autoRegister) {
            this.setConversationStatus('AutoRegister 未初始化');
            return;
        }

        this.setConversationBusy(true);
        try {
            const summary = await autoRegister.manualSyncConversationChain({
                appId: this.conversation.appId,
                chainId: this.conversation.activeChainId,
            });

            const message = `同步完成: 成功 ${summary.successCount}/${summary.conversationIds.length}，抓取 ${summary.totalFetched} 条，写入 ${summary.totalSaved} 条`;
            this.setConversationStatus(message);
            getToast()?.success(message);
            if (summary.hasIncomplete) {
                getToast()?.warning('检测到 has_past_record/is_earliest_data_page 异常，历史可能仍不完整');
            }
            if (summary.failedCount > 0) {
                getToast()?.warning(`有 ${summary.failedCount} 个会话同步失败`);
            }
            if (Number(summary.skippedNoPermissionCount || 0) > 0) {
                getToast()?.info(`已跳过 ${summary.skippedNoPermissionCount} 个无权限旧会话`);
            }

            await this.refreshConversationPanel({ showToast: false, keepSelection: true });
        } catch (error) {
            this.setConversationStatus(`手动同步失败: ${error.message}`);
            getToast()?.error(`手动同步失败: ${error.message}`);
        } finally {
            this.setConversationBusy(false);
        }
    },

    async exportConversationChainJson() {
        if (!this.conversation.appId || !this.conversation.activeChainId) {
            getToast()?.warning('当前没有可导出的会话链');
            return;
        }

        this.setConversationBusy(true);
        try {
            const bundle = await ChatHistoryService.exportChainBundle({
                appId: this.conversation.appId,
                chainId: this.conversation.activeChainId,
            });
            const content = JSON.stringify(bundle, null, 2);
            const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const safeAppId = String(this.conversation.appId).replace(/[^a-zA-Z0-9_-]/g, '_');
            const safeChainId = String(this.conversation.activeChainId).replace(/[^a-zA-Z0-9_-]/g, '_');
            link.href = url;
            link.download = `aifengyue-chain-${safeAppId}-${safeChainId}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            this.setConversationStatus(`导出完成：${bundle.summary?.messageCount ?? 0} 条消息`);
            getToast()?.success('会话链导出成功');
        } catch (error) {
            this.setConversationStatus(`导出失败: ${error.message}`);
            getToast()?.error(`导出失败: ${error.message}`);
        } finally {
            this.setConversationBusy(false);
        }
    },

    readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
            reader.readAsText(file, 'utf-8');
        });
    },

    async importConversationChainJson(file) {
        if (!file) return;

        this.setConversationBusy(true);
        try {
            const text = await this.readTextFile(file);
            if (!text.trim()) {
                throw new Error('导入文件内容为空');
            }
            let payload;
            try {
                payload = JSON.parse(text);
            } catch {
                throw new Error('导入文件不是合法 JSON');
            }

            const summary = await ChatHistoryService.importChainBundle({
                payload,
                preferAppId: this.conversation.appId || '',
            });

            this.setConversationStatus(
                `导入完成: ${summary.conversationCount} 会话，保存 ${summary.savedCount}/${summary.importedMessageCount} 条消息`
            );
            getToast()?.success('会话链导入成功');

            await this.refreshConversationPanel({ showToast: false, keepSelection: true });
        } catch (error) {
            this.setConversationStatus(`导入失败: ${error.message}`);
            getToast()?.error(`导入失败: ${error.message}`);
        } finally {
            this.setConversationBusy(false);
        }
    },
};
