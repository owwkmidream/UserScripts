// ==UserScript==
// @name         B站活动页任务助手
// @namespace    http://tampermonkey.net/
// @version      5.5
// @description  悬浮面板，Tabs标签切换，活动稿件投稿打卡与统计。
// @author       Gemini_Refactored
// @include      /^https:\/\/www\.bilibili\.com\/blackboard\/era\/[a-zA-Z0-9]+\.html$/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/blueimp-md5/2.19.0/js/md5.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
// @connect      api.bilibili.com
// @connect      member.bilibili.com
// @connect      api.live.bilibili.com
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

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
            row-gap: 2px;
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

    GM_addStyle(STYLES);

    // ==========================================
    // 2. 工具函数
    // ==========================================
    const getCookie = (n) => { const m = document.cookie.match(new RegExp('(^| )' + n + '=([^;]+)')); return m ? m[2] : null; };

    /** 统一使用北京时间 (GMT+8) */
    const getBJDate = (timestamp) => {
        // timestamp 为秒级时间戳，转为 Date 后提取北京时间日期
        const d = timestamp ? new Date(timestamp * 1000) : new Date();
        // 用 UTC + 8 小时
        const utc = d.getTime() + d.getTimezoneOffset() * 60000;
        return new Date(utc + 8 * 3600000);
    };

    /** 获取北京时间今天的 0:00 和 24:00 时间戳（秒） */
    const getBJTodayRange = () => {
        const now = getBJDate();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startTs = start.getTime() / 1000 - 8 * 3600; // 转回 UTC 秒级时间戳
        return { start: startTs, end: startTs + 86400 };
    };

    /** 格式化北京时间日期字符串 */
    const formatBJDate = (ts) => {
        const d = getBJDate(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    /** 计算两个时间戳之间的天数差（北京时间） */
    const daysBetween = (ts1, ts2) => {
        const d1 = getBJDate(ts1);
        const d2 = getBJDate(ts2);
        const date1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
        const date2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
        return Math.floor((date2 - date1) / 86400000);
    };

    /** 格式化数字：每4位加逗号 */
    const formatViews = (num) => {
        if (!num) return '0';
        return num.toString().replace(/\B(?=(\d{4})+(?!\d))/g, ',');
    };

    /** 封装 GM_xmlhttpRequest 为 Promise */
    const gmFetch = (url, opts = {}) => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            ...opts,
            onload: (resp) => {
                try { resolve(JSON.parse(resp.responseText)); }
                catch (e) { reject(e); }
            },
            onerror: reject
        });
    });

    const LIVE_STATUS_POLL_MS = 15000;
    const LIVE_DURATION_TICK_MS = 1000;
    const LIVE_AREA_HISTORY_KEY = 'era_live_area_history_v1';
    const LIVE_AREA_HISTORY_LIMIT = 10;
    const LIVE_BUVID_KEY = 'bilibili_live_buvid_header';
    const LIVE_UA_FALLBACK = 'LiveHime/7.11.3.8931 os/Windows pc_app/livehime build/8931 osVer/10.0_x86_64';

    const getArrayStore = (key) => {
        const raw = GM_getValue(key, []);
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        }
        return [];
    };

    // ==========================================
    // 3. 状态
    // ==========================================
    const STATE = {
        config: [],
        isPolling: false,
        activeTab: 'SUBMIT',
        activityInfo: null,       // { id, name, stime, etime, actUrl }
        activityArchives: null,   // [{ bvid, title, ptime, view }]
        isLoadingArchives: false,
        live: {
            roomInfo: null,
            roomExtInfo: null,
            areaList: null,
            roomId: null,
            liveStatus: 0,
            liveStartTs: null,
            isRefreshing: false,
            isOperating: false,
            versionCache: null,
            lastError: '',
            lastSyncAt: 0,
            areaHistory: getArrayStore(LIVE_AREA_HISTORY_KEY),
        }
    };

    const getFixedBuvid = () => {
        let cachedBuvid = GM_getValue(LIVE_BUVID_KEY, null);
        if (cachedBuvid) return cachedBuvid;
        const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        }).toUpperCase();
        const padding = Math.floor(Math.random() * 90000) + 10000;
        cachedBuvid = `${uuid}${padding}user`;
        GM_setValue(LIVE_BUVID_KEY, cachedBuvid);
        return cachedBuvid;
    };

    const generateLivehimeUA = (version, build) => `LiveHime/${version} os/Windows pc_app/livehime build/${build} osVer/10.0_x86_64`;

    const makeLiveApiRequest = (options = {}) => new Promise((resolve, reject) => {
        const method = (options.method || 'GET').toUpperCase();
        const ua = STATE.live.versionCache
            ? generateLivehimeUA(STATE.live.versionCache.version, STATE.live.versionCache.build)
            : LIVE_UA_FALLBACK;
        const headers = {
            'User-Agent': ua,
            buvid: GM_getValue(LIVE_BUVID_KEY, getFixedBuvid()),
            Referer: '',
            ...(options.headers || {})
        };
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        }

        GM_xmlhttpRequest({
            method,
            url: options.url,
            data: options.data,
            timeout: options.timeout || 15000,
            headers,
            onload: (response) => {
                try {
                    const data = JSON.parse(response.responseText || '{}');
                    const isStopLiveRepeat = options.url && options.url.includes('stopLive')
                        && (data.code === 160000 || data.msg === '重复关播');
                    if (data.code === 0 || isStopLiveRepeat) {
                        resolve(data);
                        return;
                    }
                    if (data.code === 60024) {
                        reject(new Error(`API Error: ${data.code} - 需要进行身份验证`));
                        return;
                    }
                    reject(new Error(`API Error: ${data.code} - ${data.message || data.msg || '未知错误'}`));
                } catch (e) {
                    reject(new Error(`JSON解析失败: ${e.message}`));
                }
            },
            onerror: () => reject(new Error('请求失败')),
            ontimeout: () => reject(new Error('请求超时')),
        });
    });

    const fetchLatestLivehimeVersion = async () => {
        if (STATE.live.versionCache) return STATE.live.versionCache;
        try {
            const response = await makeLiveApiRequest({
                method: 'GET',
                url: 'https://api.live.bilibili.com/xlive/app-blink/v1/liveVersionInfo/getHomePageLiveVersion?system_version=2',
            });
            if (response?.data?.curr_version && response?.data?.build) {
                STATE.live.versionCache = {
                    version: response.data.curr_version,
                    build: String(response.data.build),
                };
                return STATE.live.versionCache;
            }
        } catch (_) {
            // 失败则走兜底版本，不阻断开播链路
        }
        STATE.live.versionCache = { version: '7.11.3.8931', build: '8931' };
        return STATE.live.versionCache;
    };

    const fetchLiveRoomInfo = async (forceRefresh = false) => {
        if (STATE.live.roomInfo && !forceRefresh) return STATE.live.roomInfo;
        const res = await makeLiveApiRequest({
            method: 'GET',
            url: 'https://api.live.bilibili.com/xlive/app-blink/v1/room/GetInfo?platform=pc',
        });
        STATE.live.roomInfo = res.data || null;
        return STATE.live.roomInfo;
    };

    const fetchLiveRoomStartInfo = async (roomId) => {
        if (!roomId) return null;
        const res = await makeLiveApiRequest({
            method: 'GET',
            url: `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
        });
        STATE.live.roomExtInfo = res.data || null;
        return STATE.live.roomExtInfo;
    };

    const fetchLiveAreaList = async () => {
        if (STATE.live.areaList) return STATE.live.areaList;
        const res = await makeLiveApiRequest({
            method: 'GET',
            url: 'https://api.live.bilibili.com/room/v1/Area/getList?show_pinyin=1',
        });
        STATE.live.areaList = res.data || [];
        return STATE.live.areaList;
    };

    const parseLiveTimeToTs = (val) => {
        if (val === null || val === undefined) return null;
        if (typeof val === 'number' && Number.isFinite(val) && val > 0) return Math.floor(val);
        const str = String(val).trim();
        if (!str || str === '0' || str === '0000-00-00 00:00:00') return null;
        if (/^\d+$/.test(str)) {
            const n = Number(str);
            if (Number.isFinite(n) && n > 0) return Math.floor(n > 1e12 ? n / 1000 : n);
            return null;
        }
        const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
        if (m) {
            const y = Number(m[1]);
            const mo = Number(m[2]);
            const d = Number(m[3]);
            const h = Number(m[4]);
            const mi = Number(m[5]);
            const s = Number(m[6]);
            const utcMs = Date.UTC(y, mo - 1, d, h - 8, mi, s);
            return Math.floor(utcMs / 1000);
        }
        const parsed = Date.parse(str);
        if (Number.isNaN(parsed)) return null;
        return Math.floor(parsed / 1000);
    };

    const getLiveDurationSeconds = () => {
        if (STATE.live.liveStatus !== 1 || !STATE.live.liveStartTs) return null;
        return Math.max(0, Math.floor(Date.now() / 1000) - STATE.live.liveStartTs);
    };

    const formatDuration = (sec) => {
        if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--:--';
        const total = Math.max(0, Math.floor(sec));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const findAreaBySubId = (subAreaId, areas = STATE.live.areaList) => {
        if (!subAreaId || !Array.isArray(areas)) return null;
        for (const parent of areas) {
            if (!Array.isArray(parent.list)) continue;
            const sub = parent.list.find((it) => Number(it.id) === Number(subAreaId));
            if (sub) {
                return {
                    parentId: Number(parent.id),
                    parentName: parent.name,
                    areaId: Number(sub.id),
                    areaName: sub.name,
                };
            }
        }
        return null;
    };

    const saveAreaHistory = () => {
        GM_setValue(LIVE_AREA_HISTORY_KEY, STATE.live.areaHistory);
    };

    const rememberAreaHistory = (entry) => {
        if (!entry || !entry.areaId) return;
        const filtered = (STATE.live.areaHistory || []).filter((it) => Number(it.areaId) !== Number(entry.areaId));
        const next = [{
            areaId: Number(entry.areaId),
            areaName: entry.areaName || '',
            parentId: Number(entry.parentId || 0),
            parentName: entry.parentName || '',
            ts: Math.floor(Date.now() / 1000),
        }, ...filtered].slice(0, LIVE_AREA_HISTORY_LIMIT);
        STATE.live.areaHistory = next;
        saveAreaHistory();
    };




    // ==========================================
    // 5. 活动 ID 获取
    // ==========================================
    const fetchActivityId = async () => {
        let pn = 1;
        const ps = 50;
        while (true) {
            try {
                const res = await gmFetch(
                    `https://api.bilibili.com/x/activity_components/video_activity/hot_activity?pn=${pn}&ps=${ps}`
                );
                if (res?.code !== 0 || !res.data?.list?.length) break;

                for (const act of res.data.list) {
                    // 提取 act_url 的路径部分进行精确比较
                    try {
                        const actPath = new URL(act.act_url).pathname;
                        if (actPath === location.pathname) {
                            return { id: act.id, name: act.name, stime: act.stime, etime: act.etime, actUrl: act.act_url };
                        }
                    } catch (_) { /* act_url 格式异常，跳过 */ }
                }

                // 如果当前页已经是最后一页
                if (res.data.list.length < ps) break;
                pn++;
                // 限制最大翻页数，防止死循环
                if (pn > 20) break;
            } catch (e) {
                console.error('[任务助手] 获取活动列表失败:', e);
                break;
            }
        }
        return null;
    };

    // ==========================================
    // 6. 稿件获取与匹配
    // ==========================================
    const fetchActivityArchives = async () => {
        if (!STATE.activityInfo || STATE.isLoadingArchives) return;
        STATE.isLoadingArchives = true;
        renderArchivesLoading();

        const { id: actId, stime } = STATE.activityInfo;
        const matched = [];
        let pn = 1;
        const ps = 50;

        try {
            while (true) {
                const res = await gmFetch(
                    `https://member.bilibili.com/x/web/archives?status=is_pubing%2Cpubed%2Cnot_pubed&pn=${pn}&ps=${ps}&coop=1&interactive=1`
                );
                if (res?.code !== 0 || !res.data?.arc_audits?.length) break;

                let stopFetching = false;
                for (const item of res.data.arc_audits) {
                    const arc = item.Archive;
                    const stat = item.stat;
                    // 如果稿件发布时间早于活动开始时间，后面的更早，停止
                    if (arc.ptime < stime) {
                        stopFetching = true;
                        break;
                    }
                    // 匹配 mission_id
                    if (arc.mission_id === actId) {
                        matched.push({
                            bvid: arc.bvid,
                            title: arc.title,
                            ptime: arc.ptime,
                            view: stat?.view || 0,
                        });
                    }
                }

                if (stopFetching || res.data.arc_audits.length < ps) break;
                pn++;
            }
        } catch (e) {
            console.error('[任务助手] 获取稿件失败:', e);
        }

        STATE.activityArchives = matched;
        STATE.isLoadingArchives = false;
        renderSubmitTab();
        renderSubmissionCard();
    };

    // ==========================================
    // 7. 统计计算
    // ==========================================
    const calcActivityStats = () => {
        if (!STATE.activityInfo || !STATE.activityArchives) return null;
        const { stime, etime } = STATE.activityInfo;
        const archives = STATE.activityArchives;

        // 当前北京时间
        const nowTs = Math.floor(Date.now() / 1000);
        // 活动进行到第几天
        const activityDays = daysBetween(stime, Math.min(nowTs, etime)) + 1;
        // 总播放量
        const totalViews = archives.reduce((sum, a) => sum + a.view, 0);
        // 累计参加天数（独立日期数）
        const uniqueDays = new Set(archives.map(a => formatBJDate(a.ptime))).size;

        return { activityDays, totalViews, uniqueDays };
    };

    const checkTodaySubmission = () => {
        if (!STATE.activityArchives) return { submitted: false, dayNum: 0 };
        const { start, end } = getBJTodayRange();
        const submitted = STATE.activityArchives.some(a => a.ptime >= start && a.ptime < end);
        const dayNum = STATE.activityInfo
            ? daysBetween(STATE.activityInfo.stime, Math.floor(Date.now() / 1000)) + 1
            : 0;
        return { submitted, dayNum };
    };

    // ==========================================
    // 8. 任务处理（原有逻辑）
    // ==========================================
    const parseConfig = () => {
        const s = unsafeWindow.__initialState;
        if (!s) return [];
        const t = [];
        const p = (i) => i && i.taskId && t.push(i);
        if (s.EvaTaskButton) s.EvaTaskButton.forEach(i => p(i.taskItem));
        if (s.EraTasklistPc) s.EraTasklistPc.forEach(c => c.tasklist && c.tasklist.forEach(p));
        return t;
    };

    const processTasks = (configList, apiList) => {
        const apiMap = {};
        apiList.forEach(i => apiMap[i.task_id] = i);
        const sections = { DAILY: [], SUBMIT: [], LIVE: [], LOTTERY: [] };

        configList.forEach(conf => {
            const api = apiMap[conf.taskId];
            if (!api) return;

            if (conf.taskAwardType === 3 || api.award_type === 3) {
                const cps = api.check_points || [];
                const ind = api.indicators?.[0] || { cur_value: 0, limit: 1 };
                const max = cps.length ? cps[cps.length - 1].list[0].limit : ind.limit;
                const nextRw = cps.find(c => c.status !== 3)?.award_name || '已完成';
                const done = cps.every(c => c.status === 3);
                sections.LOTTERY.push({
                    id: conf.taskId, name: conf.taskName,
                    status: done ? 3 : (cps.some(c => c.status === 2) ? 2 : 1),
                    cur: ind.cur_value, total: max, reward: nextRw,
                    percent: Math.min(100, (ind.cur_value / max) * 100),
                    url: '#', type: 'LOTTERY'
                });
                return;
            }

            if (conf.statisticType === 2 || api.accumulative_check_points?.length) {
                (api.accumulative_check_points || []).forEach(sub => {
                    sections.LIVE.push({
                        id: sub.sid, name: `累计直播 ${sub.list[0].limit} 天`,
                        status: sub.status, cur: api.accumulative_count, total: sub.list[0].limit,
                        reward: sub.award_name, percent: Math.min(100, (api.accumulative_count / sub.list[0].limit) * 100),
                        url: `https://www.bilibili.com/blackboard/era/award-exchange.html?task_id=${sub.sid}`,
                        type: 'LIVE'
                    });
                });
                return;
            }

            const isDaily = conf.periodType === 1 && conf.taskAwardType === 1;
            const cp = api.check_points?.[0];
            const item = {
                id: conf.taskId, name: conf.taskName, status: api.task_status,
                cur: cp ? cp.list[0].cur_value : 0, total: cp ? cp.list[0].limit : 1,
                reward: conf.awardName,
                url: `https://www.bilibili.com/blackboard/era/award-exchange.html?task_id=${conf.taskId}`,
                type: isDaily ? 'DAILY' : 'SUBMIT'
            };

            // 投稿类型：从 taskName 解析投稿天数 limit，用累计投稿天数作 cur
            if (!isDaily) {
                const limitMatch = conf.taskName?.match(/投稿.*?(\d+)天/);
                if (limitMatch) {
                    item.total = parseInt(limitMatch[1], 10);
                    const stats = calcActivityStats();
                    item.cur = stats ? stats.uniqueDays : 0;
                }
            }

            item.percent = Math.min(100, (item.cur / item.total) * 100);
            if (isDaily) sections.DAILY.push(item); else sections.SUBMIT.push(item);
        });

        const getFilmVal = (str) => {
            if (!str) return 0;
            if (str.includes('菲林')) {
                const m = str.match(/菲林.*?(\d+)/);
                return m ? parseInt(m[1]) : 1;
            }
            return 0;
        };

        const sort = (a, b) => {
            const pA = a.status === 2 ? 0 : (a.status === 1 ? 1 : (a.status === 3 ? 2 : 1));
            const pB = b.status === 2 ? 0 : (b.status === 1 ? 1 : (b.status === 3 ? 2 : 1));
            if (pA !== pB) return pA - pB;
            if (a.status === 2) {
                const vA = getFilmVal(a.reward);
                const vB = getFilmVal(b.reward);
                if (vA !== vB) return vB - vA;
            }
            return 0;
        };
        Object.values(sections).forEach(list => list.sort(sort));
        return sections;
    };

    // ==========================================
    // 8.5 直播管理
    // ==========================================
    const showLiveToast = (message, type = 'info', autoDismiss = true, duration = 3600) => {
        let toast = document.getElementById('era-live-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'era-live-toast';
            document.body.appendChild(toast);
        }
        toast.className = type;
        toast.innerHTML = message;
        toast.style.display = 'block';
        if (toast._timer) clearTimeout(toast._timer);
        if (autoDismiss) {
            toast._timer = setTimeout(() => {
                toast.style.display = 'none';
            }, duration);
        }
    };

    const createLiveAreaModal = () => {
        if (document.getElementById('era-live-area-modal')) return;
        const html = `
            <div id="era-live-area-overlay"></div>
            <div id="era-live-area-modal">
                <h3>选择直播分区</h3>
                <div class="era-live-history">
                    <div class="era-live-history-title">历史分区（优先）</div>
                    <div class="era-live-history-list" id="era-live-history-list"></div>
                </div>
                <div class="era-live-row">
                    <label for="era-live-parent-select">父分区</label>
                    <select id="era-live-parent-select"></select>
                </div>
                <div class="era-live-row">
                    <label for="era-live-sub-select">子分区</label>
                    <select id="era-live-sub-select"></select>
                </div>
                <div class="era-live-modal-actions">
                    <button id="era-live-start-cancel">取消</button>
                    <button id="era-live-start-confirm">开播</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        const overlay = document.getElementById('era-live-area-overlay');
        const parentSelect = document.getElementById('era-live-parent-select');
        const cancelBtn = document.getElementById('era-live-start-cancel');
        const confirmBtn = document.getElementById('era-live-start-confirm');

        parentSelect.addEventListener('change', () => {
            populateLiveSubAreas(parentSelect.value);
        });
        overlay.addEventListener('click', hideLiveAreaModal);
        cancelBtn.addEventListener('click', hideLiveAreaModal);
        confirmBtn.addEventListener('click', async () => {
            const subSelect = document.getElementById('era-live-sub-select');
            const selectedSubAreaId = Number(subSelect.value || 0);
            if (!selectedSubAreaId) {
                showLiveToast('请选择子分区后再开播。', 'warning');
                return;
            }
            const roomData = await fetchLiveRoomInfo();
            if (!roomData?.room_id) {
                showLiveToast('未获取到直播间 ID，无法开播。', 'error');
                return;
            }
            confirmBtn.disabled = true;
            confirmBtn.textContent = '处理中...';
            await startLiveStream(roomData.room_id, selectedSubAreaId);
            confirmBtn.disabled = false;
            confirmBtn.textContent = '开播';
        });
    };

    const showLiveAreaModal = () => {
        createLiveAreaModal();
        document.getElementById('era-live-area-overlay').style.display = 'block';
        document.getElementById('era-live-area-modal').style.display = 'block';
    };

    const hideLiveAreaModal = () => {
        const overlay = document.getElementById('era-live-area-overlay');
        const modal = document.getElementById('era-live-area-modal');
        if (overlay) overlay.style.display = 'none';
        if (modal) modal.style.display = 'none';
    };

    const populateLiveParentAreas = (defaultParentId) => {
        const parentSelect = document.getElementById('era-live-parent-select');
        if (!parentSelect) return;
        const areas = STATE.live.areaList || [];
        parentSelect.innerHTML = '<option value="">-- 请选择 --</option>';
        areas.forEach((parent) => {
            const option = document.createElement('option');
            option.value = parent.id;
            option.textContent = parent.name;
            parentSelect.appendChild(option);
        });
        if (defaultParentId) {
            parentSelect.value = String(defaultParentId);
        }
    };

    const populateLiveSubAreas = (parentId, defaultSubId) => {
        const subSelect = document.getElementById('era-live-sub-select');
        if (!subSelect) return;
        subSelect.innerHTML = '<option value="">-- 请选择 --</option>';
        if (!parentId) return;
        const parent = (STATE.live.areaList || []).find((p) => Number(p.id) === Number(parentId));
        if (!parent || !Array.isArray(parent.list)) return;
        parent.list.forEach((sub) => {
            const option = document.createElement('option');
            option.value = sub.id;
            option.textContent = sub.name;
            subSelect.appendChild(option);
        });
        if (defaultSubId) {
            subSelect.value = String(defaultSubId);
        }
    };

    const applyHistoryAreaSelection = (entry) => {
        if (!entry) return;
        const found = findAreaBySubId(entry.areaId);
        if (!found) {
            showLiveToast('历史分区不可用，可能已下线。', 'warning');
            return;
        }
        const parentSelect = document.getElementById('era-live-parent-select');
        if (!parentSelect) return;
        parentSelect.value = String(found.parentId);
        populateLiveSubAreas(found.parentId, found.areaId);
    };

    const renderLiveAreaHistory = () => {
        const wrap = document.getElementById('era-live-history-list');
        if (!wrap) return;
        const history = STATE.live.areaHistory || [];
        if (!history.length) {
            wrap.innerHTML = '<span class="era-live-history-empty">暂无历史分区</span>';
            return;
        }
        wrap.innerHTML = '';
        history.forEach((entry, idx) => {
            const btn = document.createElement('button');
            btn.className = 'era-live-history-btn';
            btn.textContent = `${entry.parentName || '未知'} / ${entry.areaName || `分区#${entry.areaId}`}`;
            btn.title = idx === 0 ? '最近使用' : '历史分区';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                applyHistoryAreaSelection(entry);
            };
            wrap.appendChild(btn);
        });
    };

    const showAreaSelectionModal = async () => {
        showLiveAreaModal();
        const confirmBtn = document.getElementById('era-live-start-confirm');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '加载中...';
        }
        try {
            const [roomData, areaList] = await Promise.all([
                fetchLiveRoomInfo(),
                fetchLiveAreaList(),
            ]);
            const historyFirst = (STATE.live.areaHistory || []).find((entry) => findAreaBySubId(entry.areaId, areaList));
            const defaultParentId = historyFirst?.parentId || roomData?.parent_id;
            const defaultSubId = historyFirst?.areaId || roomData?.area_v2_id;
            populateLiveParentAreas(defaultParentId);
            populateLiveSubAreas(defaultParentId, defaultSubId);
            renderLiveAreaHistory();
        } catch (e) {
            console.error('[任务助手] 打开分区选择失败:', e);
            showLiveToast(`分区加载失败：${e.message || e}`, 'error');
            hideLiveAreaModal();
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = '开播';
            }
        }
    };

    const createLiveAuthModal = () => {
        if (document.getElementById('era-live-auth-modal')) return;
        const html = `
            <div id="era-live-auth-overlay"></div>
            <div id="era-live-auth-modal">
                <h3>身份验证</h3>
                <p>请使用 B 站 App 扫码完成身份验证，然后点击“我已验证”。</p>
                <div id="era-live-auth-qrcode"></div>
                <div class="era-live-modal-actions">
                    <button id="era-live-auth-cancel">取消</button>
                    <button id="era-live-auth-retry">我已验证</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('era-live-auth-overlay').addEventListener('click', hideLiveAuthModal);
        document.getElementById('era-live-auth-cancel').addEventListener('click', hideLiveAuthModal);
    };

    const showAuthQRCodeModal = (authUrl, roomId, areaV2) => {
        createLiveAuthModal();
        const overlay = document.getElementById('era-live-auth-overlay');
        const modal = document.getElementById('era-live-auth-modal');
        const container = document.getElementById('era-live-auth-qrcode');
        const retryBtn = document.getElementById('era-live-auth-retry');
        container.innerHTML = '';
        new QRCode(container, {
            text: authUrl,
            width: 180,
            height: 180,
            correctLevel: QRCode.CorrectLevel.H,
        });
        retryBtn.onclick = async () => {
            hideLiveAuthModal();
            showLiveToast('正在重新尝试开播...', 'info');
            await startLiveStream(roomId, areaV2);
        };
        overlay.style.display = 'block';
        modal.style.display = 'block';
    };

    const hideLiveAuthModal = () => {
        const overlay = document.getElementById('era-live-auth-overlay');
        const modal = document.getElementById('era-live-auth-modal');
        if (overlay) overlay.style.display = 'none';
        if (modal) modal.style.display = 'none';
    };

    const startLiveStream = async (roomId, areaV2) => {
        const csrfToken = getCookie('bili_jct');
        const dedeUserID = getCookie('DedeUserID');
        if (!csrfToken || !dedeUserID) {
            showLiveToast('未登录或缺少 CSRF，无法开播。', 'error');
            return false;
        }

        STATE.live.isOperating = true;
        renderLiveStatusCard('LIVE');

        const APP_KEY = 'aae92bc66f3edfab';
        const APP_SECRET = 'af125a0d5279fd576c1b4418a3e8276d';

        try {
            const vInfo = await fetchLatestLivehimeVersion();
            const params = new URLSearchParams();
            params.append('appkey', APP_KEY);
            params.append('area_v2', String(areaV2));
            params.append('build', String(vInfo.build));
            params.append('version', String(vInfo.version));
            params.append('csrf', csrfToken);
            params.append('csrf_token', csrfToken);
            params.append('platform', 'pc_link');
            params.append('room_id', String(roomId));
            params.append('ts', String(Math.floor(Date.now() / 1000)));
            params.append('type', '2');
            params.sort();

            const sign = md5(params.toString() + APP_SECRET);
            const formData = new URLSearchParams(params);
            formData.append('sign', sign);

            await makeLiveApiRequest({
                method: 'POST',
                url: 'https://api.live.bilibili.com/room/v1/Room/startLive',
                data: formData.toString(),
            });

            const areaMeta = findAreaBySubId(areaV2);
            if (areaMeta) rememberAreaHistory(areaMeta);
            showLiveToast('开播成功。', 'success');
            hideLiveAreaModal();
            await refreshLiveState(true);
            return true;
        } catch (e) {
            console.error('[任务助手] 开播失败:', e);
            if (String(e.message || '').includes('60024')) {
                const faceAuthUrl = `https://www.bilibili.com/blackboard/live/face-auth-middle.html?source_event=400&mid=${dedeUserID}`;
                hideLiveAreaModal();
                showAuthQRCodeModal(faceAuthUrl, roomId, areaV2);
                showLiveToast('该分区要求身份验证，请先扫码。', 'warning', false);
            } else {
                showLiveToast(`开播失败：${e.message || e}`, 'error');
            }
            return false;
        } finally {
            STATE.live.isOperating = false;
            renderLiveStatusCard('LIVE');
        }
    };

    const stopLiveStream = async () => {
        const csrfToken = getCookie('bili_jct');
        if (!csrfToken) {
            showLiveToast('缺少 CSRF，无法关播。', 'error');
            return;
        }
        STATE.live.isOperating = true;
        renderLiveStatusCard('LIVE');
        try {
            const roomData = await fetchLiveRoomInfo(true);
            if (!roomData?.room_id) {
                showLiveToast('未获取到直播间 ID，无法关播。', 'error');
                return;
            }
            const formData = new URLSearchParams();
            formData.append('room_id', String(roomData.room_id));
            formData.append('platform', 'pc_link');
            formData.append('csrf', csrfToken);
            formData.append('csrf_token', csrfToken);

            const data = await makeLiveApiRequest({
                method: 'POST',
                url: 'https://api.live.bilibili.com/room/v1/Room/stopLive',
                data: formData.toString(),
            });
            if (data.code === 160000 || data.msg === '重复关播') {
                showLiveToast('当前未在直播，或已成功关播。', 'info');
            } else {
                showLiveToast('关播成功。', 'success');
            }
            await refreshLiveState(true);
        } catch (e) {
            console.error('[任务助手] 关播失败:', e);
            showLiveToast(`关播失败：${e.message || e}`, 'error');
        } finally {
            STATE.live.isOperating = false;
            renderLiveStatusCard('LIVE');
        }
    };

    const refreshLiveState = async (forceRefresh = false) => {
        if (STATE.live.isRefreshing) return;
        STATE.live.isRefreshing = true;
        try {
            const roomInfo = await fetchLiveRoomInfo(forceRefresh);
            STATE.live.roomId = roomInfo?.room_id || null;
            STATE.live.liveStatus = Number(roomInfo?.live_status || 0);
            if (STATE.live.roomId) {
                const ext = await fetchLiveRoomStartInfo(STATE.live.roomId);
                const startTs = parseLiveTimeToTs(ext?.live_time);
                STATE.live.liveStartTs = STATE.live.liveStatus === 1 ? startTs : null;
            } else {
                STATE.live.liveStartTs = null;
            }
            if (STATE.live.liveStatus !== 1) {
                STATE.live.liveStartTs = null;
            }
            STATE.live.lastError = '';
            STATE.live.lastSyncAt = Date.now();
        } catch (e) {
            console.error('[任务助手] 刷新直播状态失败:', e);
            STATE.live.lastError = e.message || '刷新直播状态失败';
        } finally {
            STATE.live.isRefreshing = false;
            renderLiveStatusCard('LIVE');
            updateLiveDurationTexts();
        }
    };

    const updateLiveDurationTexts = () => {
        const isLive = STATE.live.liveStatus === 1;
        const text = isLive ? formatDuration(getLiveDurationSeconds()) : '--:--:--';
        document.querySelectorAll('.live-duration-value').forEach((el) => {
            el.textContent = text;
        });
    };

    const renderLiveStatusCard = (tabKey) => {
        const content = document.getElementById(`tab-content-${tabKey}`);
        if (!content) return;

        const cardId = `tab-live-card-${tabKey}`;
        let card = document.getElementById(cardId);
        if (!card) {
            card = document.createElement('div');
            card.id = cardId;
            content.prepend(card);
        }

        const isLive = STATE.live.liveStatus === 1;
        const duration = isLive ? formatDuration(getLiveDurationSeconds()) : '--:--:--';
        const roomInfo = STATE.live.roomInfo;
        const areaText = roomInfo?.parent_name && roomInfo?.area_v2_name
            ? `${roomInfo.parent_name} / ${roomInfo.area_v2_name}`
            : '分区信息待获取';
        const syncTimeText = STATE.live.lastSyncAt
            ? new Date(STATE.live.lastSyncAt).toLocaleTimeString()
            : '--:--:--';

        let subText = isLive ? '直播中' : '未开播';
        if (STATE.live.lastError) {
            subText = `状态拉取失败：${STATE.live.lastError}`;
        } else if (STATE.live.isRefreshing && !STATE.live.lastSyncAt) {
            subText = '正在同步直播状态...';
        }

        const renderHash = [
            isLive ? 1 : 0,
            subText,
            areaText,
            syncTimeText,
            STATE.live.isOperating ? 1 : 0,
        ].join('|');

        if (card.dataset.renderHash !== renderHash) {
            card.className = `tab-live-card ${isLive ? 'live-on' : 'live-off'}`;
            card.innerHTML = `
                <div class="live-card-head">
                    <span class="live-dot ${isLive ? 'on' : 'off'}"></span>
                    <div class="wide-card-title">📡 直播状态</div>
                    <span class="live-state-text">${subText}</span>
                </div>
                <button class="live-action-btn ${isLive ? 'stop' : 'start'}" id="live-action-btn-${tabKey}" ${STATE.live.isOperating ? 'disabled' : ''}>
                    ${STATE.live.isOperating ? '处理中' : (isLive ? '关播' : '开播')}
                </button>
                <div class="live-card-area" title="${areaText}">分区 ${areaText}</div>
                <div class="live-duration-line">
                    <span class="label">本场时长</span><span class="live-duration-value">${duration}</span>
                </div>
                <div class="live-card-sync" title="15秒自动轮询更新">更新于 ${syncTimeText}</div>
            `;
            card.dataset.renderHash = renderHash;
        }

        if (content.firstChild !== card) {
            content.prepend(card);
        }

        const btn = document.getElementById(`live-action-btn-${tabKey}`);
        if (btn) {
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (STATE.live.isOperating) return;
                if (isLive) {
                    await stopLiveStream();
                } else {
                    await showAreaSelectionModal();
                }
            };
        }
    };

    // ==========================================
    // 9. 渲染引擎
    // ==========================================

    /** 渲染投稿打卡大卡片（在每日必做区域） */
    const renderSubmissionCard = () => {
        const grid = document.querySelector('#sec-daily .era-grid');
        if (!grid) return;

        let card = document.getElementById('grid-submission-card');
        const { submitted, dayNum } = checkTodaySubmission();
        const loading = STATE.isLoadingArchives;
        const noActivity = !STATE.activityInfo;

        const ICONS = {
            REFRESH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
            CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><path d="M20 6 9 17l-5-5"/></svg>`,
            CROSS: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg>`,
            WARN: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
            LOADING: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon spinning"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
        };

        // 状态判断
        let statusClass = '', iconHtml = '', subText = '';

        if (noActivity) {
            statusClass = ''; // 使用默认白色，避免歧义
            iconHtml = ICONS.WARN;
            subText = '未获取到活动';
        } else if (loading) {
            statusClass = ''; // 加载中使用默认白色背景
            iconHtml = ICONS.LOADING;
            subText = '数据加载中...';
        } else if (submitted) {
            statusClass = 'status-done';
            iconHtml = ICONS.CHECK;
            subText = `活动第 ${dayNum} 天`;
        } else {
            statusClass = 'status-pending';
            iconHtml = ICONS.CROSS;
            subText = `活动第 ${dayNum} 天`;
        }

        const html = `
            <div class="wide-card-left">
                <div class="wide-card-title">📝 投稿打卡</div>
                <div class="wide-card-sub">${subText}</div>
            </div>
            <div class="wide-card-right">
                ${iconHtml ? `<div class="wide-card-icon">${iconHtml}</div>` : ''}
                <div class="wide-card-refresh" id="btn-refresh-submission" title="刷新投稿状态">${ICONS.REFRESH}</div>
            </div>
        `;

        if (!card) {
            card = document.createElement('div');
            card.id = 'grid-submission-card';
            grid.appendChild(card);
            card.addEventListener('click', (e) => {
                // 点击卡片任意位置
                e.preventDefault(); e.stopPropagation();

                // v5.3: 未完成时跳转投稿页
                if (!submitted) {
                    window.open('https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload', '_blank');
                } else {
                    refreshArchives();
                }
            });
        }

        // 更新类名和内容
        card.className = `grid-card-wide ${statusClass}`;
        card.innerHTML = html;

        // 绑定刷新按钮事件（虽然整体可点，但保留单独按钮逻辑以防万一）
        const btn = card.querySelector('#btn-refresh-submission');
        if (btn) btn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            refreshArchives();
        };
    };

    /** 刷新稿件数据 */
    const refreshArchives = () => {
        if (STATE.isLoadingArchives) return;
        const btn = document.getElementById('btn-refresh-submission');
        if (btn) btn.classList.add('spinning');
        fetchActivityArchives().finally(() => {
            const btn2 = document.getElementById('btn-refresh-submission');
            if (btn2) btn2.classList.remove('spinning');
        });
    };

    /** 渲染投稿 Tab 加载状态 */
    const renderArchivesLoading = () => {
        const content = document.getElementById('tab-content-SUBMIT');
        if (!content) return;
        let banner = document.getElementById('submit-stats-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'submit-stats-banner';
            content.insertBefore(banner, content.firstChild);
        }
        banner.className = 'submit-stats-banner';
        // v5.3: 保持布局骨架，但这有点复杂，直接显示 Loading 即可
        // 由于设置了 min-height，高度不会跳动
        banner.innerHTML = '<div class="stats-loading">⏳ 正在获取稿件数据...</div>';
    };

    /** v5.3: 计算下一个动态目标 */
    const calcNextTarget = (currentViews) => {
        const targets = [];
        if (STATE.config && Array.isArray(STATE.config)) {
            STATE.config.forEach(t => {
                if (!t || !t.taskName) return;
                const match = t.taskName.match(/播放.*?(\d+)(万)?/);
                if (match) {
                    let num = parseInt(match[1], 10);
                    if (match[2] === '万') num *= 10000;
                    if (!targets.includes(num)) targets.push(num);
                }
            });
        }
        targets.sort((a, b) => a - b);

        // 默认目标（防止没有匹配到）
        if (targets.length === 0) {
            targets.push(150000, 700000);
        }

        const next = targets.find(t => t > currentViews);
        return next || null; // null 表示全部达成
    };

    /** 渲染投稿 Tab 统计 Banner */
    const renderSubmitTab = () => {
        const content = document.getElementById('tab-content-SUBMIT');
        if (!content) return;

        let banner = document.getElementById('submit-stats-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'submit-stats-banner';
            content.insertBefore(banner, content.firstChild);
        }

        if (!STATE.activityInfo) {
            banner.className = 'submit-stats-banner';
            banner.innerHTML = '<div class="stats-error">⚠️ 未获取到活动信息</div>';
            return;
        }

        const stats = calcActivityStats();
        if (!stats) {
            banner.className = 'submit-stats-banner';
            banner.innerHTML = '<div class="stats-loading">暂无数据</div>';
            return;
        }

        // 格式化播放量：只醒目万位
        const wan = Math.floor(stats.totalViews / 10000);
        const rest = stats.totalViews % 10000;
        const viewsHtml = `<span class="highlight-num">${wan}</span><span style="color:var(--era-text);font-size:12px;font-weight:700">万</span><span style="font-weight:400;color:var(--era-sub);margin-left:2px">${rest.toString().padStart(4, '0')}</span>`;

        // 目标差额计算
        const nextTarget = calcNextTarget(stats.totalViews);
        let targetText = '';

        if (nextTarget) {
            const diff = nextTarget - stats.totalViews;
            // 目标显示：如果目标是万级别，显示 "XX万"
            const targetDisplay = (nextTarget >= 10000 && nextTarget % 10000 === 0)
                ? `${nextTarget / 10000}万`
                : formatViews(nextTarget);

            targetText = `(距 ${targetDisplay} 差 ${formatViews(diff)})`;
        } else {
            targetText = '(已达成所有目标)';
        }

        banner.className = 'submit-stats-banner';
        banner.innerHTML = `
            <div class="stats-group left">
                <div class="stats-label">累计投稿</div>
                <div class="stats-value-main">${stats.uniqueDays} <span style="font-size:12px;font-weight:400">天</span></div>
            </div>
            <div class="stats-group right">
                <div class="stats-label">总播放量</div>
                <div class="stats-value-main">${viewsHtml}</div>
                <div class="stats-value-sub">${targetText}</div>
            </div>
        `;
    };

    /** 主渲染函数 */
    const render = (sections) => {
        const container = document.getElementById('era-scroll-view');
        if (!container) return;

        // ---- Daily Grid ----
        renderGrid(sections.DAILY, container);

        // ---- Tabs ----
        renderTabs(sections, container);
    };

    /** 渲染每日必做四宫格 */
    const renderGrid = (items, container) => {
        let el = document.getElementById('sec-daily');
        if (!items.length && !STATE.activityInfo) { if (el) el.style.display = 'none'; return; }
        if (!el) {
            el = document.createElement('div'); el.id = 'sec-daily';
            el.innerHTML = `<div class="section-title">📅 每日必做</div><div class="era-grid"></div>`;
            container.appendChild(el);
        }
        el.style.display = 'block';
        const grid = el.querySelector('.era-grid');

        items.forEach(t => {
            let card = document.getElementById(`grid-${t.id}`);
            const isClaim = t.status === 2, isDone = t.status === 3;
            const pColor = isClaim ? '#45bd63' : (isDone ? '#ddd' : '#00aeec');

            const html = `
                <div class="grid-title">${t.name.replace('当日', '').replace('直播间', '')}</div>
                <div class="grid-status">
                    <span>${isDone ? 'Finished' : `${t.cur} / ${t.total}`}</span>
                    <span style="font-weight:bold; color:${isClaim ? '#faad14' : (isDone ? '#aaa' : '#00aeec')}">
                        ${isClaim ? '待领' : (isDone ? '✓' : '进行中')}
                    </span>
                </div>
                <div class="mini-progress-bg"><div class="mini-progress-bar" style="width:${t.percent}%; background:${pColor}"></div></div>
            `;
            const cls = `grid-card ${isClaim ? 'status-claim' : ''} ${isDone ? 'status-done' : ''}`;
            const hash = `${t.status}-${t.cur}`;
            if (!card) {
                card = document.createElement('a'); card.id = `grid-${t.id}`; card.className = cls;
                card.href = t.url; card.target = '_blank'; card.innerHTML = html; card.dataset.hash = hash;
                grid.appendChild(card);
            } else if (card.dataset.hash !== hash) {
                card.className = `${cls} highlight-flash`; card.innerHTML = html; card.dataset.hash = hash;
                setTimeout(() => card.classList.remove('highlight-flash'), 800);
            }
        });

        // 渲染投稿打卡大卡片
        renderSubmissionCard();
    };

    /** 渲染 Tabs 标签系统 */
    const renderTabs = (sections, container) => {
        let tabsWrapper = document.getElementById('sec-tabs');
        if (!tabsWrapper) {
            tabsWrapper = document.createElement('div');
            tabsWrapper.id = 'sec-tabs';

            const tabsDef = [
                { key: 'SUBMIT', label: '📹 投稿' },
                { key: 'LIVE', label: '📺 直播' },
                { key: 'LOTTERY', label: '🎡 抽奖' },
            ];

            // 标签栏
            const tabBar = document.createElement('div');
            tabBar.className = 'era-tabs';
            tabsDef.forEach(td => {
                const btn = document.createElement('button');
                btn.className = `era-tab ${STATE.activeTab === td.key ? 'active' : ''}`;
                btn.dataset.tab = td.key;
                btn.textContent = td.label;
                btn.onclick = () => switchTab(td.key);
                tabBar.appendChild(btn);
            });
            tabsWrapper.appendChild(tabBar);

            // 标签内容区
            tabsDef.forEach(td => {
                const content = document.createElement('div');
                content.id = `tab-content-${td.key}`;
                content.className = `era-tab-content ${STATE.activeTab === td.key ? 'active' : ''}`;
                tabsWrapper.appendChild(content);
            });

            container.appendChild(tabsWrapper);
        }
        // 渲染各 Tab 内容
        renderTabList('SUBMIT', sections.SUBMIT);
        renderSubmitTab(); // 渲染投稿Card
        renderTabList('LIVE', sections.LIVE);
        renderTabList('LOTTERY', sections.LOTTERY);
        const submitLiveCard = document.getElementById('tab-live-card-SUBMIT');
        if (submitLiveCard) submitLiveCard.remove();
        if (!document.getElementById('tab-live-card-LIVE')) {
            renderLiveStatusCard('LIVE');
        }
    };

    /** 切换标签 */
    const switchTab = (key) => {
        STATE.activeTab = key;

        // 更新标签样式
        document.querySelectorAll('.era-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === key);
        });
        document.querySelectorAll('.era-tab-content').forEach(el => {
            el.classList.toggle('active', el.id === `tab-content-${key}`);
        });

        // 切换到投稿 Tab 时刷新数据
        if (key === 'SUBMIT') {
            refreshArchives();
        }
    };

    /** 渲染单个 Tab 内的列表 */
    const renderTabList = (tabKey, items) => {
        const content = document.getElementById(`tab-content-${tabKey}`);
        if (!content) return;

        items.forEach(t => {
            let card = document.getElementById(`list-${t.id}`);
            const isClaim = t.status === 2, isDone = t.status === 3;
            const btnText = isClaim ? '领取' : (isDone ? '已完成' : '去完成');
            const btnCls = isClaim ? 'btn-claim' : '';

            const html = `
                <div class="list-row-main">
                    <div class="list-content">
                        <div class="list-title">${t.name}</div>
                        <div class="list-meta">
                            <span class="list-reward">${t.reward}</span>
                            <span class="list-progress-text">${t.cur} / ${t.total}</span>
                        </div>
                    </div>
                    <div class="list-btn ${btnCls}">${btnText}</div>
                </div>
                ${(t.type === 'LIVE' || t.type === 'LOTTERY' || t.type === 'SUBMIT') ? `
                <div class="full-progress"><div class="full-bar" style="width:${t.percent}%"></div></div>
                ` : ''}
            `;
            const cls = `list-card ${isClaim ? 'status-claim' : ''} ${isDone ? 'status-done' : ''}`;
            const hash = `${t.status}-${t.cur}`;
            if (!card) {
                card = document.createElement('a'); card.id = `list-${t.id}`; card.className = cls;
                card.href = t.url; card.target = '_blank'; card.innerHTML = html; card.dataset.hash = hash;
                content.appendChild(card);
            } else if (card.dataset.hash !== hash) {
                card.className = `${cls} highlight-flash`; card.innerHTML = html; card.dataset.hash = hash;
                setTimeout(() => card.classList.remove('highlight-flash'), 800);
            }
        });
    };

    // ==========================================
    // 10. 初始化
    // ==========================================
    const init = () => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="era-drawer">
                <div class="era-header">
                    <div class="era-title">任务助手</div>
                    <div id="era-close" style="cursor:pointer; opacity:0.5; font-size:18px">×</div>
                </div>
                <div class="era-scroll" id="era-scroll-view"></div>
                <div class="era-footer">刷新时间：<span id="era-clock">--:--:--</span></div>
            </div>
            <div id="era-toggle-pill">◀ 面板</div>
        `;
        document.body.appendChild(div);

        const drawer = document.getElementById('era-drawer');
        const pill = document.getElementById('era-toggle-pill');

        pill.onclick = () => drawer.classList.toggle('hidden');
        document.getElementById('era-close').onclick = () => drawer.classList.add('hidden');
    };

    const loop = async () => {
        if (STATE.isPolling) return;
        STATE.isPolling = true;
        try {
            if (!STATE.config.length) STATE.config = parseConfig();
            if (STATE.config.length) {
                // 去重 task IDs
                const ids = [...new Set(STATE.config.map(t => t.taskId))];
                const res = await gmFetch(
                    `https://api.bilibili.com/x/task/totalv2?csrf=${getCookie('bili_jct')}&task_ids=${ids.join(',')}`
                );
                if (res?.code === 0) {
                    render(processTasks(STATE.config, res.data.list));
                    document.getElementById('era-clock').innerText = new Date().toLocaleTimeString();
                }
            }
        } catch (e) { console.error(e); }
        finally { STATE.isPolling = false; }
    };

    const start = async () => {
        init();

        // 启动直播状态轮询与时长本地计时
        setTimeout(() => {
            refreshLiveState(true);
            setInterval(() => refreshLiveState(true), LIVE_STATUS_POLL_MS);
            setInterval(updateLiveDurationTexts, LIVE_DURATION_TICK_MS);
        }, 50);

        // 获取活动信息
        try {
            STATE.activityInfo = await fetchActivityId();
            if (STATE.activityInfo) {
                console.log('[任务助手] 匹配到活动:', STATE.activityInfo.name);
            } else {
                console.warn('[任务助手] 未匹配到当前页面的活动');
            }
        } catch (e) {
            console.error('[任务助手] 获取活动信息失败:', e);
        }

        // 启动任务轮询
        setTimeout(() => {
            loop();
            setInterval(loop, 1000);
        }, 10);

        // 初始获取一次稿件数据
        if (STATE.activityInfo) {
            setTimeout(() => fetchActivityArchives(), 0);
        }
    };

    start();

})();
