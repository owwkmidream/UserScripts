// ==UserScript==
// @name         B站活动页任务助手
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  悬浮面板默认展开，字体统一，支持按钮点击切换开关，每日四宫格。
// @author       Gemini_Refactored
// @include      /^https:\/\/www\.bilibili\.com\/blackboard\/era\/[a-zA-Z0-9]+\.html$/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. 样式定义
    // ==========================================
    const STYLES = `
        :root {
            --era-bg: rgba(255, 255, 255, 0.95); /* 背景稍微不那么透，提升可读性 */
            --era-backdrop: blur(12px);
            --era-shadow: 0 8px 32px rgba(0,0,0,0.12);
            --era-radius: 12px;
            --era-primary: #00aeec;
            --era-pink: #fb7299;
            --era-text: #2c3e50;
            --era-sub: #9499a0;
            --era-border: rgba(255,255,255,0.8);
        }

        #era-drawer {
            position: fixed; top: 10%; right: 20px; width: 300px; max-height: 80vh;
            display: flex; flex-direction: column;
            background: var(--era-bg); backdrop-filter: var(--era-backdrop); -webkit-backdrop-filter: var(--era-backdrop);
            border-radius: var(--era-radius); box-shadow: var(--era-shadow); border: 1px solid var(--era-border);
            z-index: 999999; transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s;
            transform: translateX(0); opacity: 1;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; /* 统一字体 */
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
            min-height: 0; /* 必须有 */
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

        /* 修复：移除 monospace，使用默认字体，并增加一点间距 */
        .list-progress-text {
            color: var(--era-sub);
            margin-left: 2px;
            /* font-family: monospace;  <-- 已移除 */
        }

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
    // 2. 逻辑处理
    // ==========================================
    const STATE = { config: [], isPolling: false };
    const getCookie = (n) => { const m = document.cookie.match(new RegExp('(^| )' + n + '=([^;]+)')); return m ? m[2] : null; };

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
            item.percent = Math.min(100, (item.cur / item.total) * 100);
            if (isDaily) sections.DAILY.push(item); else sections.SUBMIT.push(item);
        });

        const getFilmVal = (str) => {
            if (!str) return 0;
            if (str.includes('菲林')) {
                const m = str.match(/菲林.*?(\d+)/); // 简单匹配数字
                return m ? parseInt(m[1]) : 1;
            }
            return 0;
        };

        const sort = (a, b) => {
            // 1. 按状态：待领 (2) > 进行中 (1) > 待触发/未开始 (0) > 已完成 (3)
            // 映射优先级：2->0(最高), 1->1, 3->2, 其他->1
            const pA = a.status === 2 ? 0 : (a.status === 1 ? 1 : (a.status === 3 ? 2 : 1));
            const pB = b.status === 2 ? 0 : (b.status === 1 ? 1 : (b.status === 3 ? 2 : 1));

            if (pA !== pB) return pA - pB;

            // 2. 如果都是待领取 (status=2)，优先菲林，且菲林数量从大到小
            if (a.status === 2) {
                const vA = getFilmVal(a.reward);
                const vB = getFilmVal(b.reward);
                if (vA !== vB) return vB - vA; // 大的在前
            }

            return 0;
        };
        Object.values(sections).forEach(list => list.sort(sort));
        return sections;
    };

    // ==========================================
    // 3. 渲染引擎
    // ==========================================
    const render = (sections) => {
        const container = document.getElementById('era-scroll-view');
        if (!container) return;

        // Grid (Daily)
        const renderGrid = (items) => {
            let el = document.getElementById('sec-daily');
            if (!items.length) { if (el) el.style.display = 'none'; return; }
            if (!el) {
                el = document.createElement('div'); el.id = 'sec-daily';
                el.innerHTML = `<div class="section-title">📅 每日必做</div><div class="era-grid"></div>`;
                container.appendChild(el);
            }
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
        };

        // List (Others)
        const renderList = (id, title, items) => {
            let el = document.getElementById(id);
            if (!items.length) { if (el) el.style.display = 'none'; return; }
            if (el) el.style.display = 'block';

            if (!el) {
                el = document.createElement('div'); el.id = id;
                el = document.createElement('div'); el.id = id;
                el.innerHTML = `
                    <div class="section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none">
                        <span>${title}</span>
                        <span class="arrow" style="font-size:12px; transition:transform 0.3s">▼</span>
                    </div>
                    <div class="list-container-wrapper">
                        <div class="list-container"></div>
                    </div>
                `;
                container.appendChild(el);

                el.querySelector('.section-title').onclick = () => {
                    const wrapper = el.querySelector('.list-container-wrapper');
                    const arrow = el.querySelector('.arrow');

                    if (wrapper.classList.contains('collapsed')) {
                        wrapper.classList.remove('collapsed');
                        arrow.style.transform = 'rotate(0deg)';
                    } else {
                        wrapper.classList.add('collapsed');
                        arrow.style.transform = 'rotate(-90deg)';
                    }
                };
            }
            const list = el.querySelector('.list-container');
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
                    ${(t.type === 'LIVE' || t.type === 'LOTTERY') ? `
                    <div class="full-progress"><div class="full-bar" style="width:${t.percent}%"></div></div>
                    ` : ''}
                `;
                const cls = `list-card ${isClaim ? 'status-claim' : ''} ${isDone ? 'status-done' : ''}`;
                const hash = `${t.status}-${t.cur}`;
                if (!card) {
                    card = document.createElement('a'); card.id = `list-${t.id}`; card.className = cls;
                    card.href = t.url; card.target = '_blank'; card.innerHTML = html; card.dataset.hash = hash;
                    list.appendChild(card);
                } else if (card.dataset.hash !== hash) {
                    card.className = `${cls} highlight-flash`; card.innerHTML = html; card.dataset.hash = hash;
                    setTimeout(() => card.classList.remove('highlight-flash'), 800);
                }
            });
        };

        renderGrid(sections.DAILY);
        renderList('sec-sub', '📹 投稿激励', sections.SUBMIT);
        renderList('sec-live', '📺 直播任务', sections.LIVE);
        renderList('sec-lot', '🎡 抽奖 & 累计', sections.LOTTERY);
    };

    // ==========================================
    // 4. Init
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

        // 修改：使用 toggle，支持再次点击关闭
        pill.onclick = () => {
            drawer.classList.toggle('hidden');
        };

        document.getElementById('era-close').onclick = () => drawer.classList.add('hidden');
    };

    const loop = async () => {
        if (STATE.isPolling) return;
        STATE.isPolling = true;
        try {
            if (!STATE.config.length) STATE.config = parseConfig();
            if (STATE.config.length) {
                const ids = STATE.config.map(t => t.taskId);
                const res = await new Promise(r => GM_xmlhttpRequest({
                    method: "GET", url: `https://api.bilibili.com/x/task/totalv2?csrf=${getCookie('bili_jct')}&task_ids=${ids.join(',')}`,
                    onload: x => r(JSON.parse(x.responseText)), onerror: () => r(null)
                }));
                if (res?.code === 0) {
                    render(processTasks(STATE.config, res.data.list));
                    document.getElementById('era-clock').innerText = new Date().toLocaleTimeString();
                }
            }
        } catch (e) { console.error(e); }
        finally { STATE.isPolling = false; }
    };

    init();
    setTimeout(() => { loop(); setInterval(loop, 1000); }, 1000);

})();