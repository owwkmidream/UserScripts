import { APP_STATE } from '../state.js';
import { ApiService } from '../services/api-service.js';
import { sidebarViewMethods } from './sidebar/sidebar-view.js';
import { sidebarEventsMethods } from './sidebar/sidebar-events.js';
import { sidebarConversationMethods } from './sidebar/sidebar-conversation.js';
import { sidebarSettingsMethods } from './sidebar/sidebar-settings.js';
import { sidebarStateMethods } from './sidebar/sidebar-state.js';
import { sidebarToolMethods } from './sidebar/sidebar-tools.js';

export const Sidebar = {
    element: null,
    conversationModal: null,
    conversationModalOpen: false,
    conversationModalEscHandler: null,
    usageUnsubscribe: null,
    isOpen: false,
    layoutMode: 'inline',
    activeTab: 'register',
    theme: 'light',
    state: APP_STATE.sidebar.state,
    conversation: {
        appId: '',
        chains: [],
        activeChainId: '',
        globalChains: [],
        activeGlobalChainId: '',
        loading: false,
    },

    init() {
        if (this.element && document.body.contains(this.element) && document.getElementById('aifengyue-sidebar-toggle')) {
            this.bindUsageSubscription();
            return;
        }
        this.activeTab = this.getDefaultTab();
        this.layoutMode = this.getLayoutMode();
        this.theme = this.getTheme();
        this.createSidebar();
        this.createConversationModal();
        this.createToggleButton();
        this.loadSavedData();
        this.bindUsageSubscription();
        this.applyLayoutModeClass();
        this.applyTheme();
        this.setActiveTab(this.activeTab);
        if (this.getDefaultOpen()) {
            this.open();
        } else {
            this.close();
        }
    },

    bindUsageSubscription() {
        if (typeof this.usageUnsubscribe === 'function') {
            this.usageUnsubscribe();
            this.usageUnsubscribe = null;
        }
        this.usageUnsubscribe = ApiService.subscribeUsageChange((snapshot) => {
            this.updateUsageDisplay(snapshot);
        });
    },

    ...sidebarViewMethods,
    ...sidebarEventsMethods,
    ...sidebarConversationMethods,
    ...sidebarSettingsMethods,
    ...sidebarStateMethods,
    ...sidebarToolMethods,
};
