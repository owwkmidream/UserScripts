import { gmAddStyle } from '../gm.js';

const SIDEBAR_STYLES = `
    :root {
        --af-sidebar-width: 372px;
        --af-safe-top: env(safe-area-inset-top, 0px);
        --af-safe-right: env(safe-area-inset-right, 0px);
        --af-safe-bottom: env(safe-area-inset-bottom, 0px);
        --af-safe-left: env(safe-area-inset-left, 0px);
    }

    /* ============================
       Light 主题 (默认)
       ============================ */
    #aifengyue-sidebar,
    #aifengyue-token-pool-log-modal {
        --af-bg:          #ffffff;
        --af-bg-soft:     #f0f2f7;
        --af-bg-card:     #e4e8f0;
        --af-border:      #c0c7d4;
        --af-text:        #1a1f2e;
        --af-text-soft:   #3d4a5c;
        --af-muted:       #6b7a8d;
        --af-primary:     #6366f1;
        --af-primary-hover: #4f46e5;
        --af-primary-text: #ffffff;
        --af-primary-glow: rgba(99, 102, 241, 0.25);
        --af-accent:      #0ea5e9;
        --af-accent-glow: rgba(14, 165, 233, 0.2);
        --af-input-bg:    #edf0f5;
        --af-input-border: #b5bcc9;
        --af-btn2-bg:     #dde2ed;
        --af-btn2-hover:  #cdd4e2;
        --af-btn2-border: #b5bcc9;
        --af-shadow:      rgba(30, 37, 51, 0.1);
        --af-shadow-lg:   rgba(30, 37, 51, 0.15);
        --af-header-bg:   linear-gradient(135deg, #f4f6fa 0%, #e8ecf5 100%);
        --af-footer-bg:   #eef0f5;
        --af-track-bg:    #d5dae5;
        --af-bar-gradient: linear-gradient(90deg, #6366f1, #0ea5e9);
        --af-success:     #10b981;
        --af-warning:     #f59e0b;
        --af-error:       #ef4444;
        --af-idle:        #94a3b8;
        --af-toggle-bg:   linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
        --af-toggle-shadow: rgba(99, 102, 241, 0.3);
        --af-code-color:  #4f46e5;
        --af-hint-bg:     #eaecf5;
        --af-hint-border: #c0c7d4;
        --af-radius:      12px;
        --af-radius-sm:   8px;
        --af-ease:        cubic-bezier(0.4, 0, 0.2, 1);
        --af-font:        'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
    }

    /* ============================
       Dark 主题
       ============================ */
    #aifengyue-sidebar[data-theme="dark"],
    #aifengyue-token-pool-log-modal[data-theme="dark"] {
        --af-bg:          #13151e;
        --af-bg-soft:     #1a1d2b;
        --af-bg-card:     #212435;
        --af-border:      #2d3150;
        --af-text:        #e4e7f0;
        --af-text-soft:   #b0b7c8;
        --af-muted:       #6b7590;
        --af-primary:     #818cf8;
        --af-primary-hover: #6366f1;
        --af-primary-text: #ffffff;
        --af-primary-glow: rgba(129, 140, 248, 0.25);
        --af-accent:      #38bdf8;
        --af-accent-glow: rgba(56, 189, 248, 0.2);
        --af-input-bg:    #1a1d2e;
        --af-input-border: #3d4268;
        --af-btn2-bg:     #2a2e45;
        --af-btn2-hover:  #353a55;
        --af-btn2-border: #4a5080;
        --af-shadow:      rgba(0, 0, 0, 0.2);
        --af-shadow-lg:   rgba(0, 0, 0, 0.35);
        --af-header-bg:   linear-gradient(135deg, #1a1d2b 0%, #13151e 100%);
        --af-footer-bg:   #111320;
        --af-track-bg:    #1e2133;
        --af-bar-gradient: linear-gradient(90deg, #818cf8, #38bdf8);
        --af-success:     #34d399;
        --af-warning:     #fbbf24;
        --af-error:       #f87171;
        --af-idle:        #4b5568;
        --af-toggle-bg:   linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
        --af-toggle-shadow: rgba(129, 140, 248, 0.3);
        --af-code-color:  #818cf8;
        --af-hint-bg:     #1a1d2b;
        --af-hint-border: #2d3150;
    }

    /* ============================
       Global / Layout
       ============================ */
    body.aifengyue-sidebar-inline-mode {
        padding-right: calc(var(--af-sidebar-width) + var(--af-safe-right)) !important;
        box-sizing: border-box;
        transition: padding-right 0.3s var(--af-ease, ease);
    }
    body.aifengyue-sidebar-inline-mode #header-setting-button {
        margin-right: 70px !important;
    }

    /* --- Toggle 按钮 --- */
    #aifengyue-sidebar-toggle {
        position: fixed;
        right: var(--af-safe-right);
        top: 50%;
        transform: translateY(-50%);
        width: 38px;
        height: 100px;
        border: none;
        border-radius: 10px 0 0 10px;
        background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
        color: #fff;
        cursor: pointer;
        z-index: 2147483645;
        writing-mode: vertical-rl;
        font-size: 13px;
        font-weight: 700;
        font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
        letter-spacing: 2px;
        box-shadow: -3px 0 20px rgba(99, 102, 241, 0.35);
        transition: right 0.25s ease, width 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
    }
    #aifengyue-sidebar-toggle:hover {
        width: 46px;
        box-shadow: -4px 0 28px rgba(99, 102, 241, 0.5);
    }
    #aifengyue-sidebar-toggle.is-open {
        right: calc(var(--af-sidebar-width) + var(--af-safe-right));
        background: linear-gradient(135deg, #4b5563 0%, #334155 100%);
        box-shadow: -3px 0 18px rgba(51, 65, 85, 0.45);
    }

    /* --- 侧边栏容器 --- */
    #aifengyue-sidebar {
        position: fixed;
        top: 0;
        right: calc(-1 * (var(--af-sidebar-width) + 20px));
        width: var(--af-sidebar-width);
        height: 100vh;
        height: 100dvh;
        background: var(--af-bg);
        color: var(--af-text);
        z-index: 2147483646;
        transition: right 0.3s var(--af-ease);
        box-shadow: -4px 0 32px var(--af-shadow-lg);
        font-family: var(--af-font);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--af-border);
        box-sizing: border-box;
        padding-top: var(--af-safe-top);
        padding-bottom: var(--af-safe-bottom);
        overscroll-behavior: contain;
    }
    #aifengyue-sidebar.open {
        right: 0;
    }

    /* --- 头部 --- */
    .aifengyue-sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        background: var(--af-header-bg);
        border-bottom: 1px solid var(--af-border);
        gap: 8px;
    }
    .aifengyue-sidebar-header h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        color: var(--af-text);
        flex: 1;
    }

    /* 主题切换按钮 */
    .aifengyue-theme-toggle {
        width: 32px;
        height: 32px;
        border: 1px solid var(--af-primary);
        border-radius: var(--af-radius-sm);
        background: transparent;
        color: var(--af-primary);
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.25s var(--af-ease);
        padding: 0;
        line-height: 1;
    }
    .aifengyue-theme-toggle:hover {
        background: var(--af-primary);
        color: #fff;
        transform: rotate(20deg) scale(1.05);
        box-shadow: 0 0 12px var(--af-primary-glow);
    }

    .aifengyue-sidebar-close {
        width: 32px;
        height: 32px;
        border: 1px solid var(--af-border);
        border-radius: var(--af-radius-sm);
        background: transparent;
        color: var(--af-text-soft);
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.25s var(--af-ease);
        padding: 0;
        line-height: 1;
    }
    .aifengyue-sidebar-close:hover {
        color: #fff;
        background: var(--af-error);
        border-color: var(--af-error);
    }

    /* --- Tab 导航 --- */
    .aifengyue-sidebar-tabs {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--af-border);
        background: var(--af-bg);
    }
    .aifengyue-tab-btn {
        position: relative;
        border: none;
        background: transparent;
        color: var(--af-muted);
        border-radius: var(--af-radius-sm);
        height: 34px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        font-family: var(--af-font);
        transition: all 0.2s var(--af-ease);
    }
    .aifengyue-tab-btn:hover {
        color: var(--af-text-soft);
        background: var(--af-bg-soft);
    }
    .aifengyue-tab-btn.active {
        color: var(--af-primary);
        background: var(--af-bg-card);
    }
    .aifengyue-tab-btn.active::after {
        content: '';
        position: absolute;
        bottom: 2px;
        left: 30%;
        right: 30%;
        height: 2px;
        border-radius: 2px;
        background: var(--af-primary);
    }

    /* --- 内容区 --- */
    .aifengyue-sidebar-content {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 12px;
        padding-bottom: 16px;
        scrollbar-width: thin;
        scrollbar-color: var(--af-border) transparent;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
    }
    .aifengyue-sidebar-content::-webkit-scrollbar {
        width: 4px;
    }
    .aifengyue-sidebar-content::-webkit-scrollbar-track {
        background: transparent;
    }
    .aifengyue-sidebar-content::-webkit-scrollbar-thumb {
        background: var(--af-border);
        border-radius: 4px;
    }

    /* --- 面板动画 --- */
    .aifengyue-panel {
        display: none;
        animation: af-slide-in 0.25s var(--af-ease);
    }
    .aifengyue-panel.active {
        display: block;
    }
    @keyframes af-slide-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* --- Section 区块 --- */
    .aifengyue-section {
        margin-bottom: 10px;
        padding: 14px;
        border: 1px solid var(--af-border);
        border-radius: var(--af-radius);
        background: var(--af-bg-soft);
        transition: border-color 0.2s var(--af-ease);
    }
    .aifengyue-section:hover {
        border-color: color-mix(in srgb, var(--af-primary) 30%, var(--af-border));
    }
    .aifengyue-section-title {
        font-size: 11px;
        color: var(--af-muted);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        margin-bottom: 10px;
    }

    /* --- 状态卡片 --- */
    .aifengyue-status-card {
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 12px;
    }
    .aifengyue-status-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .aifengyue-status-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .aifengyue-status-dot.idle {
        background: var(--af-idle);
    }
    .aifengyue-status-dot.generating {
        background: var(--af-warning);
        animation: af-pulse 1.6s ease-in-out infinite;
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
    }
    .aifengyue-status-dot.polling {
        background: var(--af-accent);
        animation: af-pulse 1.6s ease-in-out infinite;
        box-shadow: 0 0 8px var(--af-accent-glow);
    }
    .aifengyue-status-dot.success {
        background: var(--af-success);
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.35);
    }
    .aifengyue-status-dot.error {
        background: var(--af-error);
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.35);
    }
    @keyframes af-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.4; transform: scale(1.3); }
    }
    .aifengyue-status-text {
        font-size: 13px;
        color: var(--af-text);
        font-weight: 600;
    }
    .aifengyue-status-message {
        margin-top: 10px;
        border-radius: var(--af-radius-sm);
        padding: 8px 10px;
        background: var(--af-input-bg);
        border: 1px solid var(--af-border);
        color: var(--af-muted);
        font-size: 12px;
        line-height: 1.6;
        word-break: break-word;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    }

    /* --- 信息行 --- */
    .aifengyue-info-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid var(--af-border);
    }
    .aifengyue-info-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }
    .aifengyue-info-row:first-child {
        padding-top: 0;
    }
    .aifengyue-info-label {
        min-width: 52px;
        font-size: 12px;
        color: var(--af-muted);
        font-weight: 500;
    }
    .aifengyue-info-value {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        color: var(--af-text);
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .aifengyue-info-value.code {
        color: var(--af-code-color);
        font-weight: 700;
    }
    .aifengyue-copy-btn {
        border: 1px solid var(--af-border);
        background: var(--af-bg);
        color: var(--af-muted);
        border-radius: 6px;
        height: 24px;
        padding: 0 10px;
        cursor: pointer;
        font-size: 11px;
        font-family: var(--af-font);
        font-weight: 500;
        transition: all 0.2s var(--af-ease);
    }
    .aifengyue-copy-btn:hover {
        color: var(--af-primary);
        border-color: var(--af-primary);
    }
    .aifengyue-copy-btn:active {
        transform: scale(0.95);
    }

    /* --- 表单 --- */
    .aifengyue-input-group {
        margin-bottom: 10px;
    }
    .aifengyue-input-group label {
        display: block;
        margin-bottom: 5px;
        color: var(--af-text-soft);
        font-size: 12px;
        font-weight: 500;
    }
    .aifengyue-input-group input,
    .aifengyue-input-group select,
    .aifengyue-input-group textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--af-input-border);
        border-radius: var(--af-radius-sm);
        padding: 8px 10px;
        font-size: 13px;
        font-family: var(--af-font);
        color: var(--af-text);
        background: var(--af-input-bg);
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
    }
    .aifengyue-input-group input,
    .aifengyue-input-group select {
        height: 36px;
        padding: 0 10px;
    }
    .aifengyue-input-group textarea {
        min-height: 96px;
        max-height: 320px;
        line-height: 1.5;
        resize: vertical;
    }
    .aifengyue-switch-textarea {
        min-height: 150px !important;
        max-height: 420px !important;
    }
    .aifengyue-model-rules-textarea {
        min-height: 130px !important;
        max-height: 340px !important;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace !important;
        font-size: 12px !important;
        line-height: 1.5 !important;
    }
    .aifengyue-input-group input:focus,
    .aifengyue-input-group select:focus,
    .aifengyue-input-group textarea:focus {
        border-color: var(--af-primary);
        box-shadow: 0 0 0 3px var(--af-primary-glow);
    }
    .aifengyue-input-group input::placeholder {
        color: var(--af-muted);
        opacity: 0.6;
    }
    .aifengyue-input-group textarea::placeholder {
        color: var(--af-muted);
        opacity: 0.6;
    }
    .aifengyue-input-group select option {
        background: var(--af-bg);
        color: var(--af-text);
    }

    /* --- 按钮 --- */
    .aifengyue-btn {
        width: 100%;
        height: 36px;
        border: none;
        border-radius: var(--af-radius-sm);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        font-family: var(--af-font);
        transition: all 0.2s var(--af-ease);
    }
    .aifengyue-btn:hover {
        transform: translateY(-1px);
    }
    .aifengyue-btn:active {
        transform: translateY(0) scale(0.98);
    }
    .aifengyue-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        transform: none;
    }
    .aifengyue-btn-primary {
        background: linear-gradient(135deg, var(--af-primary) 0%, var(--af-primary-hover) 100%);
        color: var(--af-primary-text);
        box-shadow: 0 2px 12px var(--af-primary-glow);
    }
    .aifengyue-btn-primary:hover {
        box-shadow: 0 4px 20px var(--af-primary-glow);
    }
    .aifengyue-btn-secondary {
        background: var(--af-btn2-bg);
        color: var(--af-text);
        border: 1px solid var(--af-btn2-border);
    }
    .aifengyue-btn-secondary:hover {
        background: var(--af-btn2-hover);
        border-color: color-mix(in srgb, var(--af-primary) 40%, var(--af-btn2-border));
    }
    .aifengyue-btn-danger {
        margin-top: 8px;
        background: rgba(239, 68, 68, 0.12);
        color: #991b1b;
        border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .aifengyue-btn-danger:hover {
        background: rgba(239, 68, 68, 0.18);
        border-color: rgba(220, 38, 38, 0.56);
        color: #7f1d1d;
    }
    #aifengyue-sidebar[data-theme="dark"] .aifengyue-btn-danger {
        background: rgba(248, 113, 113, 0.16);
        color: #fecaca;
        border-color: rgba(248, 113, 113, 0.45);
    }
    #aifengyue-sidebar[data-theme="dark"] .aifengyue-btn-danger:hover {
        background: rgba(248, 113, 113, 0.24);
        border-color: rgba(248, 113, 113, 0.7);
        color: #fee2e2;
    }
    .aifengyue-btn-group {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 8px;
    }

    /* --- 提示 --- */
    .aifengyue-hint {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--af-muted);
        border: 1px solid var(--af-hint-border);
        border-radius: 10px;
        padding: 10px 12px 10px 14px;
        background: var(--af-hint-bg);
        border-left: 3px solid var(--af-primary);
    }

    /* --- 工具面板 --- */
    .aifengyue-tools-empty {
        border: 1px dashed var(--af-border);
        border-radius: var(--af-radius);
        padding: 20px 14px;
        text-align: center;
        color: var(--af-muted);
        background: var(--af-bg-card);
        font-size: 13px;
    }
    .aifengyue-tool-block {
        margin-bottom: 10px;
        padding: 14px;
        border-radius: var(--af-radius);
        border: 1px solid var(--af-border);
        background: var(--af-bg-soft);
        transition: border-color 0.2s var(--af-ease);
    }
    .aifengyue-tool-block:hover {
        border-color: color-mix(in srgb, var(--af-primary) 30%, var(--af-border));
    }
    .aifengyue-check-row {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--af-text);
        font-size: 13px;
        margin-bottom: 10px;
        user-select: none;
        cursor: pointer;
    }
    .aifengyue-check-row input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--af-primary);
        cursor: pointer;
    }

    /* --- 会话面板 --- */
    .aifengyue-conversation-viewer {
        width: 100%;
        min-height: 520px;
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: #fff;
    }
    #aifengyue-conversation-chain:disabled,
    #aifengyue-conversation-global-chain:disabled,
    #aifengyue-conversation-refresh:disabled,
    #aifengyue-conversation-global-refresh:disabled,
    #aifengyue-conversation-sync:disabled,
    #aifengyue-conversation-export:disabled,
    #aifengyue-conversation-import-trigger:disabled,
    #aifengyue-conversation-open-preview:disabled,
    #aifengyue-conversation-global-open-preview:disabled,
    #aifengyue-conversation-global-delete:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .aifengyue-conv-latest-card {
        margin-top: 10px;
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 10px;
    }
    .aifengyue-conv-latest-head {
        font-size: 11px;
        color: var(--af-muted);
        margin-bottom: 6px;
        letter-spacing: 0.4px;
    }
    .aifengyue-conv-latest-body {
        font-size: 12px;
        line-height: 1.6;
        color: var(--af-text);
        border: 1px solid var(--af-border);
        background: var(--af-input-bg);
        border-radius: 8px;
        padding: 8px 10px;
        word-break: break-word;
        white-space: pre-wrap;
    }

    /* --- 会话预览浮层 --- */
    #aifengyue-conversation-modal {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
    }
    #aifengyue-token-pool-log-modal {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
    }
    #aifengyue-conversation-modal.open {
        display: block;
    }
    #aifengyue-token-pool-log-modal.open {
        display: block;
    }
    .aifengyue-conv-modal-backdrop {
        width: 100%;
        height: 100%;
        background: rgba(15, 23, 42, 0.56);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: calc(10px + var(--af-safe-top)) calc(16px + var(--af-safe-right)) calc(10px + var(--af-safe-bottom)) calc(16px + var(--af-safe-left));
        box-sizing: border-box;
    }
    .aifengyue-conv-modal-content {
        width: min(1200px, calc(100vw - 40px));
        min-width: 700px;
        height: min(94vh, 1200px);
        height: min(94dvh, 1200px);
        border-radius: 12px;
        background: #f7f8fb;
        border: 1px solid rgba(148, 163, 184, 0.4);
        box-shadow: 0 18px 48px rgba(2, 6, 23, 0.42);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .aifengyue-log-modal-content {
        width: min(1280px, calc(100vw - 40px));
        min-width: 760px;
        height: min(92vh, 1080px);
        height: min(92dvh, 1080px);
        border-radius: 12px;
        background: var(--af-bg);
        border: 1px solid var(--af-border);
        box-shadow: 0 18px 48px rgba(2, 6, 23, 0.42);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .aifengyue-conv-modal-head {
        height: 46px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px 0 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(255, 255, 255, 0.92);
        flex-shrink: 0;
    }
    #aifengyue-sidebar[data-theme="dark"] .aifengyue-conv-modal-head,
    #aifengyue-token-pool-log-modal .aifengyue-conv-modal-head {
        background: color-mix(in srgb, var(--af-bg-card) 88%, #ffffff);
    }
    .aifengyue-conv-modal-title {
        font-size: 14px;
        font-weight: 700;
        color: #1f2937;
    }
    .aifengyue-log-modal-head-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .aifengyue-conv-modal-close {
        width: 30px;
        height: 30px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        color: #374151;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
    }
    .aifengyue-conv-modal-close:hover {
        border-color: #9ca3af;
        background: #f9fafb;
    }
    #aifengyue-conversation-modal .aifengyue-conversation-viewer {
        border: none;
        border-radius: 0;
        min-height: 0;
        height: 100%;
        width: 100%;
        background: #fff;
    }
    .aifengyue-log-modal-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
        height: 100%;
        padding: 12px;
        background: var(--af-bg-soft);
    }
    .aifengyue-log-list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 12px;
    }
    .aifengyue-log-empty {
        height: 100%;
        min-height: 240px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: var(--af-muted);
        font-size: 13px;
        line-height: 1.7;
    }
    .aifengyue-log-entry {
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg);
        padding: 12px;
        margin-bottom: 10px;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
    }
    .aifengyue-log-entry:last-child {
        margin-bottom: 0;
    }
    .aifengyue-log-entry.is-info {
        border-left: 3px solid #2563eb;
    }
    .aifengyue-log-entry.is-warn {
        border-left: 3px solid #d97706;
    }
    .aifengyue-log-entry.is-error {
        border-left: 3px solid #dc2626;
    }
    .aifengyue-log-entry.is-debug {
        border-left: 3px solid #7c3aed;
    }
    .aifengyue-log-entry-head {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
        font-size: 11px;
        color: var(--af-muted);
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    }
    .aifengyue-log-level,
    .aifengyue-log-step,
    .aifengyue-log-time {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--af-input-bg);
        border: 1px solid var(--af-border);
    }
    .aifengyue-log-message {
        color: var(--af-text);
        font-size: 13px;
        line-height: 1.7;
        font-weight: 600;
        word-break: break-word;
    }
    .aifengyue-log-run {
        margin-top: 8px;
        color: var(--af-muted);
        font-size: 11px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        word-break: break-all;
    }
    .aifengyue-log-meta {
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--af-border);
        background: var(--af-input-bg);
        color: var(--af-text);
        font-size: 11px;
        line-height: 1.6;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-x: auto;
    }
    @media (max-width: 760px) {
        .aifengyue-conv-modal-backdrop {
            align-items: stretch;
        }
        .aifengyue-conv-modal-content {
            min-width: 0;
            width: 100%;
            height: 100%;
            max-height: none;
        }
        .aifengyue-log-modal-content {
            min-width: 0;
            width: 100%;
            height: 100%;
            max-height: none;
        }
        .aifengyue-conv-modal-head {
            min-height: 52px;
            height: auto;
            padding: 8px 10px 8px 12px;
        }
        .aifengyue-log-modal-head-actions {
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 6px;
        }
        .aifengyue-conv-modal-backdrop {
            padding: calc(8px + var(--af-safe-top)) calc(8px + var(--af-safe-right)) calc(8px + var(--af-safe-bottom)) calc(8px + var(--af-safe-left));
        }
    }

    /* --- 配额统计 --- */
    .aifengyue-usage-display {
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 12px;
    }
    .aifengyue-usage-head,
    .aifengyue-usage-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
    }
    .aifengyue-muted {
        color: var(--af-muted);
    }
    .aifengyue-usage-track {
        margin: 8px 0;
        height: 6px;
        border-radius: 999px;
        background: var(--af-track-bg);
        overflow: hidden;
    }
    #aifengyue-usage-bar {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: var(--af-bar-gradient);
        transition: width 0.4s var(--af-ease);
    }

    /* --- 脚注 --- */
    .aifengyue-footer {
        border-top: 1px solid var(--af-border);
        background: var(--af-footer-bg);
        color: var(--af-muted);
        padding: 10px 14px;
        text-align: center;
        font-size: 12px;
    }
    .aifengyue-footer a {
        color: var(--af-primary);
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
