import { DOM_IDS, UI_TIMING } from './constants.js';
import { fetchActivityId, fetchTaskTotals } from './activity.js';
import { refreshLiveState, updateLiveDurationTexts } from './live.js';
import { render, refreshArchives } from './render.js';
import { STATE } from './state.js';
import { parseConfig, parseTaskContext, processTasks } from './tasks.js';
import { getById, getCookie, LIVE_DURATION_TICK_MS, LIVE_STATUS_POLL_MS } from './utils.js';

const init = () => {
    const div = document.createElement('div');
    div.innerHTML = `
        <div id="${DOM_IDS.DRAWER}">
            <div class="era-header">
                <div class="era-title">任务助手</div>
                <div id="${DOM_IDS.CLOSE_BTN}" style="cursor:pointer; opacity:0.5; font-size:18px">×</div>
            </div>
            <div class="era-scroll" id="${DOM_IDS.SCROLL_VIEW}"></div>
            <div class="era-footer">刷新时间：<span id="${DOM_IDS.CLOCK}">--:--:--</span></div>
        </div>
        <div id="${DOM_IDS.TOGGLE_PILL}">◀ 面板</div>
    `;
    document.body.appendChild(div);

    const drawer = getById(DOM_IDS.DRAWER);
    const pill = getById(DOM_IDS.TOGGLE_PILL);

    pill.onclick = () => drawer.classList.toggle('hidden');
    getById(DOM_IDS.CLOSE_BTN).onclick = () => drawer.classList.add('hidden');
};

const loop = async () => {
    if (STATE.isPolling) return;
    STATE.isPolling = true;
    try {
        if (!STATE.taskContext.activityId || !STATE.taskContext.activityName) {
            STATE.taskContext = parseTaskContext();
        }
        if (!STATE.config.length) {
            STATE.config = parseConfig();
        }
        if (STATE.config.length) {
            const ids = [...new Set(STATE.config.map((t) => t.taskId))];
            const res = await fetchTaskTotals(getCookie('bili_jct'), ids);
            if (res?.code === 0) {
                render(processTasks(STATE.config, res.data.list, STATE.taskContext));
                getById(DOM_IDS.CLOCK).innerText = new Date().toLocaleTimeString();
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        STATE.isPolling = false;
    }
};

export const start = async () => {
    init();
    window.addEventListener('era:task-reload', loop);

    setTimeout(() => {
        refreshLiveState(true);
        setInterval(() => refreshLiveState(true), LIVE_STATUS_POLL_MS);
        setInterval(updateLiveDurationTexts, LIVE_DURATION_TICK_MS);
    }, UI_TIMING.LIVE_BOOT_DELAY_MS);

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

    setTimeout(() => {
        loop();
        setInterval(loop, UI_TIMING.TASK_LOOP_MS);
    }, UI_TIMING.TASK_BOOT_DELAY_MS);

    if (STATE.activityInfo) {
        setTimeout(() => refreshArchives(), UI_TIMING.ARCHIVES_BOOT_DELAY_MS);
        setInterval(() => refreshArchives(), UI_TIMING.ARCHIVES_POLL_MS);
    }
};
