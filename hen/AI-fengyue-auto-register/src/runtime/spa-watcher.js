import { APP_STATE } from '../state.js';
import { Sidebar } from '../ui/sidebar.js';
import { Toast } from '../ui/toast.js';
import { AutoRegister } from '../features/auto-register.js';
import { IframeExtractor } from '../features/iframe-extractor.js';
import { ModelPopupSorter } from '../features/model-popup-sorter.js';

export const SPAWatcher = {
    isSignupPage() {
        if (window.location.pathname.includes('/signup') ||
            window.location.pathname.includes('/register')) {
            return true;
        }
        return AutoRegister.isRegisterPage();
    },

    ensureDOM() {
        const sidebar = document.getElementById('aifengyue-sidebar');
        const toggle = document.getElementById('aifengyue-sidebar-toggle');
        const toastContainer = document.getElementById('aifengyue-toast-container');

        if (!sidebar || !toggle) {
            console.log('[AI风月注册助手] 检测到 DOM 被移除，重新注入...');
            Sidebar.element = null;
            Sidebar.isOpen = false;
            Sidebar.init();
            Toast.info('侧边栏已重新注入', 2000);
        }

        if (!toastContainer) {
            Toast.container = null;
            Toast.init();
        }
    },

    handlePageChange() {
        const currentUrl = window.location.href;

        if (currentUrl !== APP_STATE.spa.lastUrl) {
            console.log('[AI风月注册助手] URL 变化:', APP_STATE.spa.lastUrl, '->', currentUrl);
            APP_STATE.spa.lastUrl = currentUrl;

            setTimeout(() => {
                if (this.isSignupPage()) {
                    console.log('[AI风月注册助手] 检测到注册页面');
                    this.ensureDOM();
                    if (Sidebar.element && !Sidebar.isOpen) {
                        Sidebar.open();
                        Toast.success('检测到注册页面,已自动打开助手', 3000);
                    }
                } else {
                    console.log('[AI风月注册助手] 离开注册页面');
                    if (Sidebar.element && Sidebar.isOpen) {
                        Sidebar.close();
                    }
                }

                IframeExtractor.checkAndUpdate();
                ModelPopupSorter.scheduleSort();
            }, 500);
        }
    },

    startObserver() {
        if (APP_STATE.spa.observer) return;

        APP_STATE.spa.lastUrl = window.location.href;

        APP_STATE.spa.observer = new MutationObserver(() => {
            this.handlePageChange();

            if (!APP_STATE.spa.checkScheduled) {
                APP_STATE.spa.checkScheduled = true;
                requestAnimationFrame(() => {
                    APP_STATE.spa.checkScheduled = false;
                    if (this.isSignupPage()) {
                        this.ensureDOM();
                    }
                    IframeExtractor.checkAndUpdate();
                    ModelPopupSorter.scheduleSort();
                });
            }
        });

        APP_STATE.spa.observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        this.hookHistoryAPI();
        console.log('[AI风月注册助手] SPA 监听器已启动');
    },

    hookHistoryAPI() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            this.handlePageChange();
        };

        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            this.handlePageChange();
        };

        window.addEventListener('popstate', () => {
            this.handlePageChange();
        });
    },

    stopObserver() {
        if (APP_STATE.spa.observer) {
            APP_STATE.spa.observer.disconnect();
            APP_STATE.spa.observer = null;
        }
    },
};
