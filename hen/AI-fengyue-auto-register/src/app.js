import { APP_STATE } from './state.js';
import { AutoRegister } from './features/auto-register.js';
import { IframeExtractor } from './features/iframe-extractor.js';
import { ModelPopupSorter } from './features/model-popup-sorter.js';
import { registerMenuCommands } from './menu/menu-commands.js';
import { ChatMessagesMonitor } from './runtime/chat-messages-monitor.js';
import { SPAWatcher } from './runtime/spa-watcher.js';
import { Sidebar } from './ui/sidebar.js';
import { Toast } from './ui/toast.js';

function init() {
    APP_STATE.refs.toast = Toast;
    APP_STATE.refs.sidebar = Sidebar;
    APP_STATE.refs.autoRegister = AutoRegister;
    APP_STATE.refs.iframeExtractor = IframeExtractor;
    APP_STATE.refs.modelPopupSorter = ModelPopupSorter;

    Sidebar.init();
    ChatMessagesMonitor.start();

    SPAWatcher.startObserver();
    registerMenuCommands();

    setTimeout(() => {
        if (SPAWatcher.isSignupPage()) {
            SPAWatcher.ensureDOM();
        }

        IframeExtractor.checkAndUpdate();
        ModelPopupSorter.scheduleSort();
        Sidebar.updateToolPanel();
    }, 800);

    console.log('[AI风月注册助手] 已加载 (SPA 模式)');
}

export function startApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}
