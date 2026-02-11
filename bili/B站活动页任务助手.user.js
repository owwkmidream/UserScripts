// ==UserScript==
// @name         B站活动页任务助手
// @namespace    http://tampermonkey.net/
// @version      5.4
// @description  悬浮面板，Tabs标签切换，活动稿件投稿打卡与统计。
// @author       Gemini_Refactored
// @include      /^https:\/\/www\.bilibili\.com\/blackboard\/era\/[a-zA-Z0-9]+\.html$/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @connect      member.bilibili.com
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
        .grid-card-wide.status-pending { background: #fffbe6; border-color: #ffe58f; }
        .grid-card-wide.status-done { background: #f4f5f7; border-color: rgba(0,0,0,0.05); opacity: 0.8; }
        .grid-card-wide:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }

        .wide-card-left { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .wide-card-title { font-size: 13px; font-weight: 700; color: #2c3e50; margin-bottom: 2px; }
        .wide-card-sub { font-size: 11px; color: #9499a0; }

        .wide-card-right { display: flex; align-items: center; gap: 8px; }
        .wide-card-icon { color: var(--era-sub); transition: color 0.2s; }
        .status-pending .wide-card-icon { color: #faad14; }
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
            statusClass = ''; // 未打卡也使用白色背景（同普通未完成任务）
            iconHtml = '';
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