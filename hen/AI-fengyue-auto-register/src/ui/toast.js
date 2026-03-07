import { gmAddStyle } from '../gm.js';

export const Toast = {
    container: null,

    init() {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.id = 'aifengyue-toast-container';
        document.body.appendChild(this.container);

        gmAddStyle(`
            #aifengyue-toast-container {
                position: fixed;
                bottom: calc(20px + env(safe-area-inset-bottom, 0px));
                right: calc(20px + env(safe-area-inset-right, 0px));
                z-index: 2147483647;
                display: flex;
                flex-direction: column-reverse;
                gap: 10px;
                pointer-events: none;
            }
            .aifengyue-toast {
                padding: 12px 20px;
                border-radius: 8px;
                color: #fff;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                animation: aifengyue-toast-in 0.3s ease-out;
                pointer-events: auto;
                max-width: 350px;
                word-break: break-word;
            }
            .aifengyue-toast.success { background: linear-gradient(135deg, #10b981, #059669); }
            .aifengyue-toast.error { background: linear-gradient(135deg, #ef4444, #dc2626); }
            .aifengyue-toast.info { background: linear-gradient(135deg, #3b82f6, #2563eb); }
            .aifengyue-toast.warning { background: linear-gradient(135deg, #f59e0b, #d97706); }
            .aifengyue-toast.out { animation: aifengyue-toast-out 0.3s ease-in forwards; }
            @keyframes aifengyue-toast-in {
                from { opacity: 0; transform: translateX(100%); }
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes aifengyue-toast-out {
                from { opacity: 1; transform: translateX(0); }
                to { opacity: 0; transform: translateX(100%); }
            }
        `);
    },

    show(message, type = 'info', duration = 3000) {
        this.init();

        const toast = document.createElement('div');
        toast.className = `aifengyue-toast ${type}`;
        toast.textContent = message;
        this.container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    success(msg, duration) { this.show(msg, 'success', duration); },
    error(msg, duration) { this.show(msg, 'error', duration); },
    info(msg, duration) { this.show(msg, 'info', duration); },
    warning(msg, duration) { this.show(msg, 'warning', duration); },
};
