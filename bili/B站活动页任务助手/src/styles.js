// ==========================================
// 1. 样式定义
// ==========================================
const STYLES = `
    :root {
        --era-bg: rgba(255, 255, 255, 0.95);
        --era-backdrop: blur(12px);
        --era-shadow: 0 8px 32px rgba(0,0,0,0.12);
        --era-radius: 12px;
        /* --era-primary: #00aeec; */
        --era-primary: var(--era-pink);
        --era-pink: #fb7299;
        --era-text: #2c3e50;
        --era-sub: #9499a0;
        --era-border: rgba(255,255,255,0.8);
        --era-green: #45bd63;
    }

    #era-drawer {
        position: fixed; top: 10%; right: 20px; width: 300px; max-height: 80vh;
        display: flex; flex-direction: column;
        background: var(--era-bg); backdrop-filter: var(--era-backdrop); -webkit-backdrop-filter: var(--era-backdrop);
        border-radius: var(--era-radius); box-shadow: var(--era-shadow); border: 1px solid var(--era-border);
        z-index: 999999; transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s;
        transform: translateX(0); opacity: 1;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #era-drawer.hidden { transform: translateX(340px); opacity: 0; pointer-events: none; }

    #era-toggle-pill {
        position: fixed; top: 50%; right: 0; transform: translateY(-50%);
        background: var(--era-primary); color: #fff; padding: 12px 3px;
        border-radius: 6px 0 0 6px; cursor: pointer; z-index: 999998;
        box-shadow: -2px 0 8px rgba(0, 174, 236, 0.3); font-size: 12px;
        writing-mode: vertical-rl; letter-spacing: 2px; transition: right 0.3s;
        user-select: none;
    }
    #era-drawer:not(.hidden) ~ #era-toggle-pill { right: 310px; background: rgba(0,0,0,0.3); box-shadow: none; }

    .era-header {
        padding: 12px 16px; border-bottom: 1px solid rgba(0,0,0,0.05);
        display: flex; justify-content: space-between; align-items: center;
    }
    .era-title { font-weight: 800; font-size: 14px; color: var(--era-text); }

    .era-scroll { flex: 1; overflow-y: auto; padding: 10px 14px; scroll-behavior: smooth; }
    .era-scroll::-webkit-scrollbar { width: 4px; }
    .era-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 4px; }

    .section-title { font-size: 12px; font-weight: 700; color: var(--era-sub); margin: 16px 0 8px 0; padding: 6px 4px; }
    .section-title:first-child { margin-top: 0; }

    /* 列表折叠动画 */
    .list-container-wrapper {
        display: grid;
        grid-template-rows: 1fr;
        transition: grid-template-rows 0.3s ease-out;
    }
    .list-container-wrapper.collapsed {
        grid-template-rows: 0fr;
    }
    .list-container {
        overflow: hidden;
        min-height: 0;
    }

    /* 四宫格 (Daily) */
    .era-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .grid-card {
        background: rgba(255,255,255,0.7); border: 1px solid rgba(0,0,0,0.05); border-radius: 8px;
        padding: 8px 10px; display: flex; flex-direction: column; justify-content: space-between; height: 56px;
        text-decoration: none; color: inherit; position: relative; overflow: hidden; transition: all 0.2s;
    }
    .grid-card:hover { background: #fff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .grid-title { font-size: 12px; font-weight: 700; color: var(--era-text); margin-bottom: 2px; }
    .grid-status { font-size: 11px; color: var(--era-sub); display: flex; justify-content: space-between; align-items: center; }
    .mini-progress-bg { position: absolute; bottom: 0; left: 0; width: 100%; height: 3px; background: rgba(0,0,0,0.05); }
    .mini-progress-bar { height: 100%; background: var(--era-primary); transition: width 0.3s; }

    /* 大卡片 - 横跨两列 (样式重构 v5.2) */
    .grid-card-wide {
        grid-column: span 2;
        background: #fff; border: 1px solid rgba(0,0,0,0.05); border-radius: 8px;
        padding: 0 12px; display: flex; align-items: center; justify-content: space-between;
        text-decoration: none; color: inherit; position: relative; overflow: hidden; transition: all 0.2s;
        min-height: 52px;
    }
    .grid-card-wide.status-pending { background: #fff; border-color: rgba(0,0,0,0.05); }
    .grid-card-wide.status-done { background: #f4f5f7; border-color: rgba(0,0,0,0.05); opacity: 0.8; }
    .grid-card-wide:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }

    .wide-card-left { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
    .wide-card-title { font-size: 13px; font-weight: 700; color: #2c3e50; margin-bottom: 2px; }
    .wide-card-sub { font-size: 11px; color: #9499a0; }

    .wide-card-right { display: flex; align-items: center; gap: 8px; }
    .wide-card-icon { color: var(--era-sub); transition: color 0.2s; }
    .status-pending .wide-card-icon { color: #f05454; }
    .status-done .wide-card-icon { color: #45bd63; }
    
    .wide-card-refresh {
        width: 24px; height: 24px; border-radius: 50%;
        background: rgba(255,255,255,0.5); cursor: pointer; display: flex; align-items: center;
        justify-content: center; font-size: 12px; transition: all 0.2s; color: var(--era-sub);
    }
    .wide-card-refresh:hover { background: #fff; color: var(--era-primary); transform: rotate(180deg); }
    .wide-card-refresh.spinning { animation: spin 0.8s linear infinite; pointer-events: none; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* Tabs 标签栏 */
    .era-tabs {
        display: flex; gap: 0; margin: 12px 0 8px 0; border-bottom: 2px solid rgba(0,0,0,0.05);
    }
    .era-tab {
        flex: 1; text-align: center; padding: 8px 4px; font-size: 12px; font-weight: 600;
        color: var(--era-sub); cursor: pointer; position: relative; transition: color 0.2s;
        user-select: none; border: none; background: none; outline: none;
    }
    .era-tab:hover { color: var(--era-text); }
    .era-tab.active { color: var(--era-primary); }
    .era-tab.active::after {
        content: ''; position: absolute; bottom: -2px; left: 20%; right: 20%;
        height: 2px; background: var(--era-primary); border-radius: 1px;
    }
    .era-tab-content { display: none; }
    .era-tab-content.active { display: block; }

    /* 投稿统计 Banner (样式重构 v5.2 + v5.3) */
    .submit-stats-banner {
        background: #fff;
        border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;
        border: 1px solid rgba(0,0,0,0.03); box-shadow: 0 1px 2px rgba(0,0,0,0.03);
        display: flex; justify-content: space-between; align-items: center;
        min-height: 80px; /* v5.3 防止加载跳动 */
        box-sizing: border-box;
    }
    .task-reminder-banner {
        display: none;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.08);
        background: linear-gradient(135deg, #fff8e9, #fff3dc);
        color: #8d5200;
        line-height: 1.35;
        font-size: 11px;
    }
    .task-reminder-banner.warn {
        border-color: rgba(255, 196, 97, 0.68);
        background: linear-gradient(135deg, #fff8e9, #fff3dc);
        color: #8d5200;
    }
    .task-reminder-tag {
        flex-shrink: 0;
        font-weight: 700;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 10px;
        background: rgba(255, 170, 70, 0.2);
        border: 1px solid rgba(255, 170, 70, 0.35);
    }
    .task-reminder-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .stats-group { display: flex; flex-direction: column; }
    .stats-group.left { align-items: flex-start; }
    .stats-group.right { align-items: flex-end; text-align: right; }
    
    .stats-label { font-size: 11px; color: var(--era-sub); margin-bottom: 2px; }
    .stats-value-main { font-weight: 700; color: var(--era-text); font-family: "DingTalk Sans", "Roboto", sans-serif; font-size: 14px; }
    .stats-value-sub { font-size: 10px; color: var(--era-sub); margin-top: 2px; }
    
    .highlight-num { color: var(--era-primary); font-weight: 800; font-size: 16px; margin-right: 2px; font-family: "DingTalk Sans", sans-serif; }
    
    .era-icon { width: 18px; height: 18px; display: block; }


    /* 列表项 (List) */
    .list-card {
        background: #fff; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.03);
        text-decoration: none; color: inherit; display: block; transition: all 0.2s;
    }
    .list-card:hover { box-shadow: 0 4px 10px rgba(0,0,0,0.08); transform: scale(1.005); }

    .list-row-main { display: flex; justify-content: space-between; align-items: flex-start; }
    .list-content { flex: 1; min-width: 0; }

    .list-title { font-size: 13px; font-weight: 600; color: var(--era-text); margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;}

    .list-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; margin-top: 2px; }
    .list-reward { color: var(--era-pink); font-weight: 700; background: #fff0f6; padding: 1px 4px; border-radius: 3px; }
    .list-progress-text { color: var(--era-sub); margin-left: 2px; }

    .list-btn {
        font-size: 11px; padding: 3px 8px; border-radius: 12px; background: #f4f5f7; color: var(--era-sub);
        font-weight: 600; margin-left: 10px; flex-shrink: 0; white-space: nowrap;
    }

    .status-claim { background: #fffbe6; border-color: #ffe58f; }
    .btn-claim { background: var(--era-pink); color: #fff; }
    .status-done { opacity: 0.6; filter: grayscale(1); }

    .full-progress { margin-top: 8px; height: 4px; background: #f0f0f0; border-radius: 2px; overflow:hidden; }
    .full-bar { height: 100%; background: var(--era-primary); border-radius: 2px; transition: width 0.4s; }

    /* 直播状态卡片 */
    .tab-live-card {
        background: rgba(255,255,255,0.75);
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.05);
        box-shadow: 0 1px 2px rgba(0,0,0,0.02);
        padding: 10px 12px;
        margin-bottom: 10px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
            "head action"
            "area dur"
            "sync sync";
        align-items: center;
        row-gap: 4px;
        column-gap: 8px;
    }
    .tab-live-card.live-on {
        border-color: rgba(69, 189, 99, 0.32);
        background: rgba(69, 189, 99, 0.08);
    }
    .tab-live-card.live-off {
        border-color: rgba(0,0,0,0.05);
        background: #f4f5f7;
    }
    .live-card-head {
        grid-area: head;
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 6px;
    }
    .live-state-text {
        font-size: 12px;
        color: #7d8591;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #c9cdd4;
    }
    .live-dot.on {
        background: #45bd63;
        box-shadow: 0 0 0 4px rgba(69, 189, 99, 0.16);
    }
    .live-dot.off {
        background: #a9b0bb;
        box-shadow: 0 0 0 4px rgba(169, 176, 187, 0.18);
    }
    .live-card-area {
        grid-area: area;
        font-size: 11px;
        color: var(--era-sub);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
    }
    .live-card-sync {
        grid-area: sync;
        font-size: 10px;
        color: #8f96a0;
        line-height: 1.35;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        column-gap: 10px;
        row-gap: 2px;
    }
    .live-card-sync-item {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .live-duration-line {
        grid-area: dur;
        text-align: right;
        min-width: 92px;
        font-size: 11px;
        color: var(--era-sub);
        white-space: nowrap;
    }
    .live-duration-line .label {
        margin-right: 4px;
    }
    .live-duration-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--era-text);
        font-family: "DingTalk Sans", "Roboto", sans-serif;
    }
    .live-action-btn {
        grid-area: action;
        border: 1px solid transparent;
        border-radius: 12px;
        height: 26px;
        min-width: 52px;
        width: auto;
        justify-self: end;
        align-self: center;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.2s;
        color: #fff;
    }
    .live-action-btn:hover {
        transform: translateY(-1px);
    }
    .live-action-btn:disabled {
        cursor: not-allowed;
        opacity: 0.65;
        transform: none;
    }
    .live-action-btn.start {
        background: #f4f5f7;
        border-color: rgba(0,0,0,0.06);
        color: #7d8591;
    }
    .live-action-btn.stop {
        background: #3ead5f;
        border-color: rgba(48, 140, 78, 0.5);
        color: #fff;
    }
    .live-action-btn.start:hover {
        background: #eceef1;
    }
    .live-action-btn.stop:hover {
        background: #389f56;
    }

    /* 每日任务完成轻提醒（可点击穿透） */
    #sec-daily {
        position: relative;
    }
    #era-daily-complete-overlay {
        display: none;
        position: absolute;
        inset: 0;
        z-index: 12;
        pointer-events: none;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(120, 128, 138, 0.28), rgba(120, 128, 138, 0.18));
    }
    #era-daily-complete-modal {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px;
        box-sizing: border-box;
    }
    .era-daily-complete-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
    }
    .era-daily-complete-icon {
        width: 96px;
        height: 96px;
        color: rgba(243, 243, 243, 0.66);
        display: block;
        filter: none;
    }
    .era-daily-complete-icon path {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: square;
        stroke-linejoin: miter;
    }

    /* 直播分区选择弹窗 */
    #era-live-area-overlay,
    #era-live-auth-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 1000000;
    }
    #era-live-area-modal,
    #era-live-auth-modal {
        display: none;
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.22);
        z-index: 1000001;
        width: 360px;
        max-width: calc(100vw - 30px);
        box-sizing: border-box;
        padding: 16px;
    }
    #era-live-area-modal h3,
    #era-live-auth-modal h3 {
        margin: 2px 0 12px 0;
        font-size: 16px;
        color: var(--era-text);
    }
    .era-live-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
    }
    .era-live-row label {
        width: 58px;
        flex-shrink: 0;
        font-size: 12px;
        color: var(--era-sub);
        text-align: right;
    }
    .era-live-row select {
        flex: 1;
        border: 1px solid rgba(0,0,0,0.12);
        border-radius: 6px;
        height: 30px;
        padding: 0 8px;
        font-size: 12px;
        color: var(--era-text);
        background: #fff;
    }
    .era-live-history {
        margin-bottom: 12px;
    }
    .era-live-history-title {
        font-size: 12px;
        color: var(--era-sub);
        margin-bottom: 6px;
    }
    .era-live-history-list {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        min-height: 24px;
    }
    .era-live-history-btn {
        border: 1px solid rgba(251, 114, 153, 0.35);
        color: #d6467d;
        background: #fff;
        border-radius: 12px;
        font-size: 11px;
        line-height: 1;
        padding: 5px 8px;
        cursor: pointer;
    }
    .era-live-history-empty {
        font-size: 11px;
        color: #a7adb5;
    }
    .era-live-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
    }
    .era-live-modal-actions button {
        border: none;
        border-radius: 7px;
        height: 32px;
        min-width: 68px;
        padding: 0 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
    }
    #era-live-start-confirm {
        background: #fb7299;
        color: #fff;
    }
    #era-live-start-cancel,
    #era-live-auth-cancel {
        background: #edf0f4;
        color: #4f5d75;
    }
    #era-live-auth-retry {
        background: #fb7299;
        color: #fff;
    }

    #era-live-auth-modal p {
        margin: 0 0 10px 0;
        font-size: 12px;
        color: var(--era-sub);
    }
    #era-live-auth-qrcode {
        width: 200px;
        height: 200px;
        margin: 4px auto 12px auto;
        border: 1px solid rgba(0,0,0,0.1);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fafafa;
    }
    #era-live-auth-qrcode canvas,
    #era-live-auth-qrcode img {
        width: 180px !important;
        height: 180px !important;
    }
    /* 直播操作提示 */
    #era-live-toast {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 1000002;
        min-width: 240px;
        max-width: 340px;
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.08);
        background: #fff;
        color: var(--era-text);
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
    }
    #era-live-toast.info {
        border-color: rgba(45, 123, 229, 0.28);
    }
    #era-live-toast.success {
        border-color: rgba(69, 189, 99, 0.35);
    }
    #era-live-toast.warning {
        border-color: rgba(250, 173, 20, 0.42);
    }
    #era-live-toast.error {
        border-color: rgba(245, 84, 84, 0.42);
    }

    .era-footer { padding: 8px; text-align: center; font-size: 10px; color: var(--era-sub); border-top: 1px solid rgba(0,0,0,0.05); }
    .highlight-flash { animation: flash 0.6s ease-out; }
    @keyframes flash { 0% { background: rgba(250, 173, 20, 0.2); } 100% { background: inherit; } }
`;

export const injectStyles = () => {
    GM_addStyle(STYLES);
};
