import { gmAddStyle } from '../gm.js';

const SIDEBAR_STYLES = `
    :root {
        --aifengyue-sidebar-width: 372px;
        --aifengyue-bg: #0f1720;
        --aifengyue-bg-soft: #18232f;
        --aifengyue-bg-card: #1d2a38;
        --aifengyue-border: #2d3b4a;
        --aifengyue-text: #e7edf3;
        --aifengyue-muted: #9aabbd;
        --aifengyue-primary: #0d9488;
        --aifengyue-primary-deep: #0f766e;
        --aifengyue-accent: #f59e0b;
    }

    html.aifengyue-sidebar-inline-mode,
    body.aifengyue-sidebar-inline-mode {
        margin-right: var(--aifengyue-sidebar-width) !important;
        transition: margin-right 0.25s ease;
    }

    #aifengyue-sidebar-toggle {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 40px;
        height: 108px;
        border: none;
        border-radius: 10px 0 0 10px;
        background: linear-gradient(160deg, #0f766e 0%, #115e59 100%);
        color: #f3f8fb;
        cursor: pointer;
        z-index: 2147483645;
        writing-mode: vertical-rl;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 1px;
        box-shadow: -2px 0 10px rgba(0, 0, 0, 0.28);
        transition: width 0.2s ease, background 0.2s ease, transform 0.2s ease;
    }
    #aifengyue-sidebar-toggle:hover {
        width: 48px;
        background: linear-gradient(160deg, #0d9488 0%, #0f766e 100%);
    }
    #aifengyue-sidebar-toggle.hidden {
        transform: translateY(-50%) translateX(100%);
    }

    #aifengyue-sidebar {
        position: fixed;
        top: 0;
        right: calc(-1 * var(--aifengyue-sidebar-width) - 20px);
        width: var(--aifengyue-sidebar-width);
        height: 100vh;
        background: linear-gradient(180deg, var(--aifengyue-bg) 0%, #0d141c 100%);
        color: var(--aifengyue-text);
        z-index: 2147483646;
        transition: right 0.25s ease;
        box-shadow: -6px 0 28px rgba(0, 0, 0, 0.42);
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--aifengyue-border);
    }
    #aifengyue-sidebar.open {
        right: 0;
    }
    #aifengyue-sidebar.mode-inline {
        box-shadow: -3px 0 16px rgba(0, 0, 0, 0.25);
    }

    .aifengyue-sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        background: linear-gradient(160deg, #153242 0%, #0f2a39 100%);
        border-bottom: 1px solid var(--aifengyue-border);
    }
    .aifengyue-sidebar-header h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: #f4fbff;
    }
    .aifengyue-sidebar-close {
        width: 30px;
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: #e8f2f7;
        cursor: pointer;
        font-size: 16px;
        transition: background 0.2s ease;
    }
    .aifengyue-sidebar-close:hover {
        background: rgba(255, 255, 255, 0.16);
    }

    .aifengyue-sidebar-tabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--aifengyue-border);
        background: rgba(13, 23, 32, 0.95);
    }
    .aifengyue-tab-btn {
        border: 1px solid #2b3a49;
        background: #1a2734;
        color: var(--aifengyue-muted);
        border-radius: 8px;
        height: 34px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s ease;
    }
    .aifengyue-tab-btn:hover {
        color: #d8e7f2;
        border-color: #365064;
    }
    .aifengyue-tab-btn.active {
        background: linear-gradient(160deg, #0d9488 0%, #0f766e 100%);
        color: #f2fffe;
        border-color: #0d9488;
        box-shadow: 0 0 0 1px rgba(13, 148, 136, 0.45) inset;
    }

    .aifengyue-sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 14px 14px 16px;
    }

    .aifengyue-panel {
        display: none;
        animation: aifengyue-panel-in 0.18s ease-out;
    }
    .aifengyue-panel.active {
        display: block;
    }
    @keyframes aifengyue-panel-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .aifengyue-section {
        margin-bottom: 14px;
        padding: 14px;
        border: 1px solid var(--aifengyue-border);
        border-radius: 12px;
        background: var(--aifengyue-bg-soft);
    }
    .aifengyue-section-title {
        font-size: 13px;
        color: #d6e5ef;
        font-weight: 700;
        margin-bottom: 10px;
    }

    .aifengyue-status-card {
        border: 1px solid #2b3c4d;
        border-radius: 10px;
        background: var(--aifengyue-bg-card);
        padding: 12px;
    }
    .aifengyue-status-indicator {
        display: flex;
        align-items: center;
        gap: 9px;
    }
    .aifengyue-status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        animation: aifengyue-pulse 1.5s infinite;
    }
    .aifengyue-status-dot.idle { background: #74879a; animation: none; }
    .aifengyue-status-dot.generating { background: #f59e0b; }
    .aifengyue-status-dot.polling { background: #0ea5a0; }
    .aifengyue-status-dot.success { background: #16a34a; animation: none; }
    .aifengyue-status-dot.error { background: #dc2626; animation: none; }
    @keyframes aifengyue-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.45; transform: scale(1.15); }
    }
    .aifengyue-status-text {
        font-size: 13px;
        color: #f0f7ff;
        font-weight: 600;
    }
    .aifengyue-status-message {
        margin-top: 10px;
        border-radius: 8px;
        padding: 8px 9px;
        background: #121d28;
        color: var(--aifengyue-muted);
        font-size: 12px;
        line-height: 1.5;
        word-break: break-word;
    }

    .aifengyue-info-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid #304151;
    }
    .aifengyue-info-row:last-child {
        border-bottom: none;
    }
    .aifengyue-info-label {
        min-width: 58px;
        font-size: 12px;
        color: var(--aifengyue-muted);
    }
    .aifengyue-info-value {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        color: #e7eff7;
        font-family: Consolas, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .aifengyue-info-value.code {
        color: var(--aifengyue-accent);
        font-weight: 700;
    }
    .aifengyue-copy-btn {
        border: 1px solid #3a4d60;
        background: transparent;
        color: #b8c8d7;
        border-radius: 6px;
        height: 24px;
        padding: 0 8px;
        cursor: pointer;
        font-size: 12px;
    }
    .aifengyue-copy-btn:hover {
        background: #2a3b4b;
    }

    .aifengyue-input-group {
        margin-bottom: 10px;
    }
    .aifengyue-input-group label {
        display: block;
        margin-bottom: 6px;
        color: #bfd0de;
        font-size: 12px;
    }
    .aifengyue-input-group input,
    .aifengyue-input-group select {
        width: 100%;
        height: 36px;
        box-sizing: border-box;
        border: 1px solid #365064;
        border-radius: 8px;
        padding: 0 10px;
        font-size: 13px;
        color: #edf6fc;
        background: #152331;
        outline: none;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .aifengyue-input-group input:focus,
    .aifengyue-input-group select:focus {
        border-color: #0d9488;
        box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.22);
    }
    .aifengyue-input-group input::placeholder {
        color: #7f96aa;
    }

    .aifengyue-btn {
        width: 100%;
        height: 36px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        transition: transform 0.15s ease, filter 0.15s ease;
    }
    .aifengyue-btn:hover {
        transform: translateY(-1px);
        filter: brightness(1.05);
    }
    .aifengyue-btn:disabled {
        opacity: 0.58;
        cursor: not-allowed;
        transform: none;
        filter: none;
    }
    .aifengyue-btn-primary {
        background: linear-gradient(160deg, #0d9488 0%, #0f766e 100%);
        color: #f0ffff;
    }
    .aifengyue-btn-secondary {
        background: #2b3b4a;
        color: #e2edf5;
        border: 1px solid #3b4f60;
    }
    .aifengyue-btn-group {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 8px;
    }

    .aifengyue-hint {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--aifengyue-muted);
        border: 1px dashed #355066;
        border-radius: 10px;
        padding: 9px 10px;
        background: rgba(21, 35, 49, 0.55);
    }

    .aifengyue-tools-empty {
        border: 1px dashed #335063;
        border-radius: 10px;
        padding: 16px 12px;
        text-align: center;
        color: var(--aifengyue-muted);
        background: rgba(23, 34, 45, 0.64);
        font-size: 13px;
    }
    .aifengyue-tool-block {
        margin-bottom: 12px;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid var(--aifengyue-border);
        background: var(--aifengyue-bg-soft);
    }
    .aifengyue-check-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #d2dfeb;
        font-size: 13px;
        margin-bottom: 10px;
        user-select: none;
    }
    .aifengyue-check-row input {
        accent-color: #0d9488;
    }

    .aifengyue-usage-display {
        border: 1px solid #2f4353;
        border-radius: 10px;
        background: var(--aifengyue-bg-card);
        padding: 11px;
    }
    .aifengyue-usage-head,
    .aifengyue-usage-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
    }
    .aifengyue-muted {
        color: var(--aifengyue-muted);
    }
    .aifengyue-usage-track {
        margin: 8px 0;
        height: 8px;
        border-radius: 999px;
        background: #243645;
        overflow: hidden;
    }
    #aifengyue-usage-bar {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #0d9488, #14b8a6);
        transition: width 0.2s ease;
    }
    #aifengyue-reset-usage {
        border: none;
        background: transparent;
        color: #22d3ee;
        cursor: pointer;
        font-size: 12px;
        padding: 0;
    }
    #aifengyue-reset-usage:hover {
        text-decoration: underline;
    }

    .aifengyue-footer {
        border-top: 1px solid var(--aifengyue-border);
        background: #0c141c;
        color: #7f95a8;
        padding: 10px 14px;
        text-align: center;
        font-size: 12px;
    }
    .aifengyue-footer a {
        color: #2dd4bf;
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
