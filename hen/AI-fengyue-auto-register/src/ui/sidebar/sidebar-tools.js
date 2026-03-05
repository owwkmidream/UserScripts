import { getAutoRegister, getIframeExtractor, getModelPopupSorter } from './sidebar-context.js';

export const sidebarToolMethods = {
    updateToolPanel() {
        if (!this.element) return;

        const autoRegister = getAutoRegister();
        const extractor = getIframeExtractor();
        const sorter = getModelPopupSorter();

        const startBtn = this.element.querySelector('#aifengyue-start');
        const manualGroup = this.element.querySelector('#aifengyue-manual-group');
        const registerHint = this.element.querySelector('#aifengyue-register-hint');

        const onRegisterPage = !!autoRegister?.isRegisterPage();
        if (startBtn) {
            startBtn.textContent = onRegisterPage ? '📝 开始辅助填表' : '🚀 开始注册（自动模式）';
        }
        if (manualGroup) {
            manualGroup.style.display = onRegisterPage ? '' : 'none';
        }
        if (registerHint) {
            registerHint.textContent = onRegisterPage
                ? '当前注册页：可辅助填表，验证码需手动完成。'
                : '非注册页：可用一键注册或更换账号。';
        }

        const isDetail = !!extractor?.checkDetailPage();
        const canExtract = !!extractor?.isExtractAvailable();

        const extractWrap = this.element.querySelector('#aifengyue-extract-html-wrap');
        const sortWrap = this.element.querySelector('#aifengyue-sort-wrap');
        const modelFamilyWrap = this.element.querySelector('#aifengyue-model-family-wrap');
        const toolsEmpty = this.element.querySelector('#aifengyue-tools-empty');
        const sortToggle = this.element.querySelector('#aifengyue-sort-toggle');

        if (extractWrap) {
            extractWrap.style.display = canExtract ? '' : 'none';
        }
        if (sortWrap) {
            sortWrap.style.display = isDetail ? '' : 'none';
        }
        if (modelFamilyWrap) {
            modelFamilyWrap.style.display = '';
        }
        if (toolsEmpty) {
            toolsEmpty.style.display = (!canExtract && !isDetail && !modelFamilyWrap) ? '' : 'none';
        }
        if (sortToggle) {
            sortToggle.checked = sorter?.isSortEnabled?.() ?? true;
        }

        if (this.activeTab === 'conversation' && !this.conversation.loading) {
            const currentAppId = autoRegister?.extractInstalledAppId?.() || '';
            if (currentAppId !== this.conversation.appId) {
                this.refreshConversationPanel({ showToast: false, keepSelection: false }).catch((error) => {
                    this.setConversationStatus(`会话面板刷新失败: ${error.message}`);
                });
            }
        }
    },
};
