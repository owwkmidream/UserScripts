import { APP_STATE } from './state.js';
import { AutoRegister } from './features/auto-register.js';
import { IframeExtractor } from './features/iframe-extractor.js';
import { ModelPopupSorter } from './features/model-popup-sorter.js';
import { registerMenuCommands } from './menu/menu-commands.js';
import { SPAWatcher } from './runtime/spa-watcher.js';
import { Sidebar } from './ui/sidebar.js';
import { Toast } from './ui/toast.js';

function init() {
    APP_STATE.refs.toast = Toast;
    APP_STATE.refs.sidebar = Sidebar;
    APP_STATE.refs.autoRegister = AutoRegister;
    APP_STATE.refs.iframeExtractor = IframeExtractor;
    APP_STATE.refs.modelPopupSorter = ModelPopupSorter;

    SPAWatcher.startObserver();
    registerMenuCommands();

    setTimeout(() => {
        if (SPAWatcher.isSignupPage()) {
            SPAWatcher.ensureDOM();
            if (Sidebar.element && !Sidebar.isOpen) {
                Sidebar.open();
                Toast.success('检测到注册页面,已自动打开助手', 3000);
            }
        }

        IframeExtractor.checkAndUpdate();
        ModelPopupSorter.scheduleSort();
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
