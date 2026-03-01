import { gmAddStyle } from '../gm.js';

const SIDEBAR_STYLES = `
    #aifengyue-sidebar-toggle {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 40px;
        height: 100px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        border-radius: 8px 0 0 8px;
        cursor: pointer;
        z-index: 2147483645;
        display: flex;
        align-items: center;
        justify-content: center;
        writing-mode: vertical-rl;
        color: #fff;
        font-size: 14px;
        font-weight: bold;
        box-shadow: -2px 0 10px rgba(0, 0, 0, 0.2);
        transition: all 0.3s ease;
    }
    #aifengyue-sidebar-toggle:hover {
        width: 50px;
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
    }
    #aifengyue-sidebar-toggle.hidden {
        transform: translateY(-50%) translateX(100%);
    }

    #aifengyue-sidebar {
        position: fixed;
        right: -400px;
        top: 0;
        width: 380px;
        height: 100vh;
        background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
        z-index: 2147483646;
        transition: right 0.3s ease;
        box-shadow: -5px 0 30px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #e0e0e0;
        overflow-y: auto;
    }
    #aifengyue-sidebar.open {
        right: 0;
    }

    .aifengyue-sidebar-header {
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .aifengyue-sidebar-header h2 {
        margin: 0;
        font-size: 18px;
        color: #fff;
    }
    .aifengyue-sidebar-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
    }
    .aifengyue-sidebar-close:hover {
        background: rgba(255,255,255,0.3);
    }

    .aifengyue-sidebar-content {
        padding: 20px;
    }

    .aifengyue-section {
        margin-bottom: 24px;
    }
    .aifengyue-section-title {
        font-size: 14px;
        color: #a0a0a0;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .aifengyue-section-title::before {
        content: '';
        width: 4px;
        height: 16px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        border-radius: 2px;
    }

    .aifengyue-input-group {
        margin-bottom: 16px;
    }
    .aifengyue-input-group label {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
        color: #b0b0b0;
    }
    .aifengyue-input-group input {
        width: 100%;
        padding: 10px 14px;
        border: 1px solid #3a3a5a;
        border-radius: 8px;
        background: #252540;
        color: #e0e0e0;
        font-size: 14px;
        transition: border-color 0.2s, box-shadow 0.2s;
        box-sizing: border-box;
    }
    .aifengyue-input-group input:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
    }
    .aifengyue-input-group input::placeholder {
        color: #6a6a8a;
    }

    .aifengyue-btn {
        padding: 12px 20px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }
    .aifengyue-btn-primary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff;
        width: 100%;
    }
    .aifengyue-btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }
    .aifengyue-btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }
    .aifengyue-btn-secondary {
        background: #3a3a5a;
        color: #e0e0e0;
    }
    .aifengyue-btn-secondary:hover {
        background: #4a4a6a;
    }
    .aifengyue-btn-danger {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: #fff;
    }

    .aifengyue-btn-group {
        display: flex;
        gap: 10px;
        margin-top: 12px;
    }
    .aifengyue-btn-group .aifengyue-btn {
        flex: 1;
    }

    .aifengyue-status-card {
        background: #252540;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
    }
    .aifengyue-status-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
    }
    .aifengyue-status-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        animation: pulse 1.5s infinite;
    }
    .aifengyue-status-dot.idle { background: #6b7280; animation: none; }
    .aifengyue-status-dot.generating { background: #f59e0b; }
    .aifengyue-status-dot.polling { background: #3b82f6; }
    .aifengyue-status-dot.success { background: #10b981; animation: none; }
    .aifengyue-status-dot.error { background: #ef4444; animation: none; }

    @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.1); }
    }

    .aifengyue-status-text {
        font-size: 14px;
        font-weight: 500;
    }
    .aifengyue-status-message {
        font-size: 13px;
        color: #8a8aaa;
        margin-top: 8px;
        padding: 10px;
        background: #1a1a30;
        border-radius: 6px;
        word-break: break-all;
    }

    .aifengyue-info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #3a3a5a;
    }
    .aifengyue-info-row:last-child {
        border-bottom: none;
    }
    .aifengyue-info-label {
        font-size: 13px;
        color: #8a8aaa;
    }
    .aifengyue-info-value {
        font-size: 13px;
        color: #e0e0e0;
        font-family: 'Consolas', monospace;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .aifengyue-info-value.code {
        color: #10b981;
        font-weight: bold;
        font-size: 16px;
    }

    .aifengyue-copy-btn {
        background: transparent;
        border: 1px solid #4a4a6a;
        color: #a0a0c0;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        margin-left: 8px;
        transition: all 0.2s;
    }
    .aifengyue-copy-btn:hover {
        background: #4a4a6a;
        color: #fff;
    }

    .aifengyue-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, #4a4a6a, transparent);
        margin: 20px 0;
    }

    .aifengyue-footer {
        padding: 16px 20px;
        background: #151525;
        font-size: 12px;
        color: #6a6a8a;
        text-align: center;
    }
    .aifengyue-footer a {
        color: #667eea;
        text-decoration: none;
    }
    .aifengyue-footer a:hover {
        text-decoration: underline;
    }
`;

let injected = false;

export function injectSidebarStyles() {
    if (injected) return;
    gmAddStyle(SIDEBAR_STYLES);
    injected = true;
}
