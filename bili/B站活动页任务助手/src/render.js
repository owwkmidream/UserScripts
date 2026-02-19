import { DOM_IDS, TAB_DEFINITIONS, TASK_STATUS, TASK_TYPE, UI_TIMING, URLS } from './constants.js';
import { STATE } from './state.js';
import { formatViews, getById, getStatusFlags, getTaskCardHash } from './utils.js';
import {
    calcActivityStats,
    claimMissionReward,
    checkTodaySubmission,
    refreshActivityArchives,
} from './activity.js';
import { renderLiveStatusCard } from './live.js';

// ==========================================
// 9. 渲染引擎
// ==========================================
const ensureSubmitBanner = () => {
    const content = getById(`${DOM_IDS.TAB_CONTENT_PREFIX}${TASK_TYPE.SUBMIT}`);
    if (!content) return null;
    let banner = getById(DOM_IDS.SUBMIT_BANNER);
    if (!banner) {
        banner = document.createElement('div');
        banner.id = DOM_IDS.SUBMIT_BANNER;
        const reminder = getById(DOM_IDS.SUBMIT_REMINDER_BANNER);
        if (reminder && reminder.parentElement === content) {
            content.insertBefore(banner, reminder.nextSibling);
        } else {
            content.insertBefore(banner, content.firstChild);
        }
    }
    return banner;
};
const ensureTopReminderBanner = (tabKey, bannerId) => {
    const content = getById(`${DOM_IDS.TAB_CONTENT_PREFIX}${tabKey}`);
    if (!content) return null;
    let banner = getById(bannerId);
    if (!banner) {
        banner = document.createElement('div');
        banner.id = bannerId;
        content.insertBefore(banner, content.firstChild);
    } else if (banner.parentElement === content && content.firstChild !== banner) {
        content.insertBefore(banner, content.firstChild);
    }
    return banner;
};
const renderTopReminderBanner = (banner, model) => {
    if (!banner) return;
    if (!model) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        banner.className = 'task-reminder-banner';
        banner.dataset.hash = '';
        return;
    }
    const nextHash = `${model.type || 'warn'}|${model.title || ''}|${model.text || ''}`;
    if (banner.dataset.hash !== nextHash) {
        banner.className = `task-reminder-banner ${model.type || 'warn'}`;
        banner.innerHTML = `
            <span class="task-reminder-tag">${model.title || '提醒'}</span>
            <span class="task-reminder-text">${model.text || ''}</span>
        `;
        banner.dataset.hash = nextHash;
    }
    banner.style.display = 'flex';
};
const showTaskToast = (message, type = 'info', duration = 2800) => {
    let toast = getById(DOM_IDS.LIVE_TOAST);
    if (!toast) {
        toast = document.createElement('div');
        toast.id = DOM_IDS.LIVE_TOAST;
        document.body.appendChild(toast);
    }
    toast.className = type;
    toast.textContent = message;
    toast.style.display = 'block';
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
};
const DAILY_COMPLETION_TARGET_COUNT = 5;
const getDailyCompletionSummary = (items = []) => {
    const dailyDoneCount = items.filter((task) => task.status === TASK_STATUS.DONE).length;
    const { submitted } = checkTodaySubmission();
    const totalCount = items.length + 1;
    const doneCount = dailyDoneCount + (submitted ? 1 : 0);
    return {
        totalCount,
        doneCount,
        isAllDoneTarget: (
            totalCount === DAILY_COMPLETION_TARGET_COUNT
            && doneCount === DAILY_COMPLETION_TARGET_COUNT
            && dailyDoneCount === items.length
            && submitted
        ),
    };
};
const buildDailyCompleteMaskHtml = () => `
    <div id="${DOM_IDS.DAILY_COMPLETE_MODAL}" aria-hidden="true">
        <div id="${DOM_IDS.DAILY_COMPLETE_BADGE}" class="era-daily-complete-badge">
            <svg class="era-daily-complete-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 12.5L9.5 18L20 6"></path>
            </svg>
        </div>
    </div>
`;
const hideDailyCompleteMask = () => {
    const overlay = getById(DOM_IDS.DAILY_COMPLETE_OVERLAY);
    if (overlay) overlay.style.display = 'none';
};
const ensureDailyCompleteMask = (dailySectionEl) => {
    if (!dailySectionEl) return null;
    let overlay = getById(DOM_IDS.DAILY_COMPLETE_OVERLAY);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = DOM_IDS.DAILY_COMPLETE_OVERLAY;
        overlay.innerHTML = buildDailyCompleteMaskHtml();
        dailySectionEl.appendChild(overlay);
    } else if (overlay.parentElement !== dailySectionEl) {
        dailySectionEl.appendChild(overlay);
    }
    return overlay;
};
const showDailyCompleteMask = (summary, dailySectionEl) => {
    const overlay = ensureDailyCompleteMask(dailySectionEl);
    if (!overlay) return;
    const badge = getById(DOM_IDS.DAILY_COMPLETE_BADGE);
    if (badge) {
        badge.title = `每日任务进度 ${summary.doneCount}/${summary.totalCount}`;
    }
    overlay.style.display = 'flex';
};
const renderDailyCompleteMask = (items = [], dailySectionEl = null) => {
    const summary = getDailyCompletionSummary(items);
    if (!summary.isAllDoneTarget || !dailySectionEl) {
        hideDailyCompleteMask();
        return;
    }
    showDailyCompleteMask(summary, dailySectionEl);
};
const setSubmitBannerContent = (banner, html) => {
    banner.className = 'submit-stats-banner';
    banner.innerHTML = html;
};
const updateTaskCardByHash = (card, cls, html, hash) => {
    if (card.dataset.hash === hash) return;
    card.className = `${cls} highlight-flash`;
    card.innerHTML = html;
    card.dataset.hash = hash;
    setTimeout(() => card.classList.remove('highlight-flash'), UI_TIMING.FLASH_HIGHLIGHT_MS);
};
const upsertTaskAnchorCard = ({ id, container, cls, hash, html, href }) => {
    let card = getById(id);
    if (!card) {
        card = document.createElement('a');
        card.id = id;
        card.className = cls;
        card.href = href || '#';
        card.target = '_blank';
        card.innerHTML = html;
        card.dataset.hash = hash;
        container.appendChild(card);
        return card;
    }
    updateTaskCardByHash(card, cls, html, hash);
    card.href = href || '#';
    return card;
};
const SUBMISSION_CARD_ICONS = Object.freeze({
    REFRESH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
    CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><path d="M20 6 9 17l-5-5"/></svg>`,
    CROSS: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg>`,
    WARN: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
    LOADING: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon spinning"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
});
const collectSubmitDayTargets = () => {
    const targets = [];
    if (!Array.isArray(STATE.config)) return targets;
    STATE.config.forEach((t) => {
        const m = t?.taskName?.match(/投稿.*?(\d+)天/);
        if (!m) return;
        const day = Number.parseInt(m[1], 10);
        if (Number.isFinite(day) && day > 0 && !targets.includes(day)) {
            targets.push(day);
        }
    });
    return targets.sort((a, b) => a - b);
};
const buildSubmitHitReminderModel = (stats, submitted) => {
    if (!stats) return null;
    const settleDays = Math.max(0, stats.uniqueDays - (submitted ? 1 : 0));
    const targets = collectSubmitDayTargets();
    if (!targets.length) return null;
    if (targets.includes(settleDays)) {
        return {
            type: 'warn',
            title: `投稿 ${settleDays} 天`,
            text: `今天 18:00 可领取奖励`,
        };
    }
    return null;
};
const buildLiveHitReminderModel = (liveItems = []) => {
    const targets = [...new Set(
        liveItems
            .map((it) => Number(it?.total))
            .filter((n) => Number.isFinite(n) && n > 0)
    )].sort((a, b) => a - b);
    if (!targets.length) return null;
    const current = liveItems.reduce((max, it) => {
        const cur = Number(it?.cur);
        return Number.isFinite(cur) ? Math.max(max, cur) : max;
    }, 0);
    const tomorrow = current + 1;
    if (!targets.includes(tomorrow)) return null;
    return {
        type: 'warn',
        title: '直播 ${tomorrow} 天',
        text: `请在 23:00 做好开播准备`,
    };
};
const resolveSubmissionCardState = ({ noActivity, loading, submitted, dayNum, hasArchiveData }) => {
    if (noActivity) {
        return {
            statusClass: '', // 使用默认白色，避免歧义
            iconHtml: SUBMISSION_CARD_ICONS.WARN,
            subText: '未获取到活动',
        };
    }
    if (loading && !hasArchiveData) {
        return {
            statusClass: '', // 加载中使用默认白色背景
            iconHtml: SUBMISSION_CARD_ICONS.LOADING,
            subText: '数据加载中...',
        };
    }
    if (submitted) {
        return {
            statusClass: 'status-done',
            iconHtml: SUBMISSION_CARD_ICONS.CHECK,
            subText: `活动第 ${dayNum} 天`,
        };
    }
    return {
        statusClass: 'status-pending',
        iconHtml: SUBMISSION_CARD_ICONS.CROSS,
        subText: `活动第 ${dayNum} 天`,
    };
};
const buildSubmissionCardHtml = ({ iconHtml, subText }) => `
    <div class="wide-card-left">
        <div class="wide-card-title">📝 投稿打卡</div>
        <div class="wide-card-sub">${subText}</div>
    </div>
    <div class="wide-card-right">
        ${iconHtml ? `<div class="wide-card-icon">${iconHtml}</div>` : ''}
        <div class="wide-card-refresh" id="${DOM_IDS.REFRESH_SUBMISSION_BTN}" title="刷新投稿状态">${SUBMISSION_CARD_ICONS.REFRESH}</div>
    </div>
`;

/** 渲染投稿打卡大卡片（在每日必做区域） */
const renderSubmissionCard = () => {
    const grid = document.querySelector(`#${DOM_IDS.SEC_DAILY} .era-grid`);
    if (!grid) return;

    let card = getById(DOM_IDS.GRID_SUBMISSION_CARD);
    const { submitted, dayNum } = checkTodaySubmission();
    const loading = STATE.isLoadingArchives;
    const noActivity = !STATE.activityInfo;
    const hasArchiveData = Array.isArray(STATE.activityArchives);

    const submissionCardState = resolveSubmissionCardState({
        noActivity,
        loading,
        submitted,
        dayNum,
        hasArchiveData,
    });
    const html = buildSubmissionCardHtml(submissionCardState);

    if (!card) {
        card = document.createElement('div');
        card.id = DOM_IDS.GRID_SUBMISSION_CARD;
        grid.appendChild(card);
        card.addEventListener('click', (e) => {
            // 点击卡片任意位置
            e.preventDefault(); e.stopPropagation();

            // v5.3: 未完成时跳转投稿页
            if (!submitted) {
                window.open(URLS.CREATOR_UPLOAD, '_blank');
            } else {
                refreshArchives();
            }
        });
    }

    // 更新类名和内容
    card.className = `grid-card-wide ${submissionCardState.statusClass}`;
    card.innerHTML = html;

    // 绑定刷新按钮事件（虽然整体可点，但保留单独按钮逻辑以防万一）
    const btn = card.querySelector(`#${DOM_IDS.REFRESH_SUBMISSION_BTN}`);
    if (btn) btn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        refreshArchives();
    };
};

/** 刷新稿件数据 */
const refreshArchives = () => {
    if (STATE.isLoadingArchives) return;
    const btn = getById(DOM_IDS.REFRESH_SUBMISSION_BTN);
    if (btn) btn.classList.add('spinning');
    if (!Array.isArray(STATE.activityArchives)) {
        renderArchivesLoading();
    }
    refreshActivityArchives().finally(() => {
        renderSubmitTab();
        renderSubmissionCard();
        const btn2 = getById(DOM_IDS.REFRESH_SUBMISSION_BTN);
        if (btn2) btn2.classList.remove('spinning');
    });
};

/** 渲染投稿 Tab 加载状态 */
const renderArchivesLoading = () => {
    const banner = ensureSubmitBanner();
    if (!banner) return;
    // v5.3: 保持布局骨架，但这有点复杂，直接显示 Loading 即可
    // 由于设置了 min-height，高度不会跳动
    setSubmitBannerContent(banner, '<div class="stats-loading">⏳ 正在获取稿件数据...</div>');
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
    const banner = ensureSubmitBanner();
    const reminderBanner = ensureTopReminderBanner(TASK_TYPE.SUBMIT, DOM_IDS.SUBMIT_REMINDER_BANNER);
    if (!banner) return;

    if (!STATE.activityInfo) {
        renderTopReminderBanner(reminderBanner, null);
        setSubmitBannerContent(banner, '<div class="stats-error">⚠️ 未获取到活动信息</div>');
        return;
    }

    const stats = calcActivityStats();
    if (!stats) {
        renderTopReminderBanner(reminderBanner, null);
        setSubmitBannerContent(banner, '<div class="stats-loading">暂无数据</div>');
        return;
    }
    const { submitted } = checkTodaySubmission();
    renderTopReminderBanner(reminderBanner, buildSubmitHitReminderModel(stats, submitted));

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

    setSubmitBannerContent(banner, `
        <div class="stats-group left">
            <div class="stats-label">累计投稿</div>
            <div class="stats-value-main">${stats.uniqueDays} <span style="font-size:12px;font-weight:400">天</span></div>
        </div>
        <div class="stats-group right">
            <div class="stats-label">总播放量</div>
            <div class="stats-value-main">${viewsHtml}</div>
            <div class="stats-value-sub">${targetText}</div>
        </div>
    `);
};

/** 主渲染函数 */
const render = (sections) => {
    const container = getById(DOM_IDS.SCROLL_VIEW);
    if (!container) return;

    // ---- Daily Grid ----
    renderGrid(sections[TASK_TYPE.DAILY], container);

    // ---- Tabs ----
    renderTabs(sections, container);
};
const buildGridTaskCardHtml = (task, isClaim, isDone, progressColor, isClaiming = false) => `
    <div class="grid-title">${task.name.replace('当日', '').replace('直播间', '')}</div>
    <div class="grid-status">
        <span>${isDone ? 'Finished' : `${task.cur} / ${task.total}`}</span>
        <span style="font-weight:bold; color:${isClaim ? '#faad14' : (isDone ? '#aaa' : '#00aeec')}">
            ${isClaiming ? '领取中' : (isClaim ? '待领' : (isDone ? '✓' : '进行中'))}
        </span>
    </div>
    <div class="mini-progress-bg"><div class="mini-progress-bar" style="width:${task.percent}%; background:${progressColor}"></div></div>
`;
const buildListTaskCardHtml = (task, btnCls, btnText) => `
    <div class="list-row-main">
        <div class="list-content">
            <div class="list-title">${task.name}</div>
            <div class="list-meta">
                <span class="list-reward">${task.reward}</span>
                <span class="list-progress-text">${task.cur} / ${task.total}</span>
            </div>
        </div>
        <div class="list-btn ${btnCls}">${btnText}</div>
    </div>
    ${(task.type === TASK_TYPE.LIVE || task.type === TASK_TYPE.LOTTERY || task.type === TASK_TYPE.SUBMIT) ? `
    <div class="full-progress"><div class="full-bar" style="width:${task.percent}%"></div></div>
    ` : ''}
`;

const triggerTaskReload = () => {
    window.dispatchEvent(new CustomEvent('era:task-reload'));
};

const bindDailyTaskCardAction = (card, task, isClaim) => {
    const isClaimableDaily = task.type === TASK_TYPE.DAILY && isClaim;
    if (!isClaimableDaily) {
        card.target = '_blank';
        card.onclick = null;
        return;
    }

    card.target = '_self';
    card.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const taskKey = String(task.id || '');
        if (!taskKey) {
            showTaskToast('任务ID缺失，无法领取', 'error');
            return;
        }
        if (STATE.claimingTaskIds.has(taskKey)) {
            showTaskToast('正在领取中，请稍候...', 'info', 1600);
            return;
        }

        STATE.claimingTaskIds.add(taskKey);
        showTaskToast(`正在领取：${task.name}`, 'info', 1600);
        triggerTaskReload();

        try {
            const res = await claimMissionReward(task, STATE.taskContext);
            if (res.ok) {
                showTaskToast(`领取成功：${task.reward || task.name}`, 'success');
            } else {
                showTaskToast(`领取失败：${res.message}`, res.type || 'warning', 3800);
            }
        } finally {
            STATE.claimingTaskIds.delete(taskKey);
            triggerTaskReload();
        }
    };
};

/** 渲染每日必做四宫格 */
const renderGrid = (items, container) => {
    let el = getById(DOM_IDS.SEC_DAILY);
    if (!items.length && !STATE.activityInfo) { if (el) el.style.display = 'none'; return; }
    if (!el) {
        el = document.createElement('div'); el.id = DOM_IDS.SEC_DAILY;
        el.innerHTML = `<div class="section-title">📅 每日必做</div><div class="era-grid"></div>`;
        container.appendChild(el);
    }
    el.style.display = 'block';
    const grid = el.querySelector('.era-grid');

    items.forEach(t => {
        const { isClaim, isDone } = getStatusFlags(t.status);
        const isClaiming = STATE.claimingTaskIds.has(String(t.id || ''));
        const pColor = isClaim ? '#45bd63' : (isDone ? '#ddd' : '#00aeec');
        const html = buildGridTaskCardHtml(t, isClaim, isDone, pColor, isClaiming);
        const cls = `grid-card ${isClaim ? 'status-claim' : ''} ${isDone ? 'status-done' : ''}`;
        const hash = `${getTaskCardHash(t)}-${isClaiming ? 1 : 0}`;
        const card = upsertTaskAnchorCard({
            id: `${DOM_IDS.GRID_TASK_PREFIX}${t.id}`,
            container: grid,
            cls,
            hash,
            html,
            href: t.url,
        });
        bindDailyTaskCardAction(card, t, isClaim);
    });

    // 渲染投稿打卡大卡片
    renderSubmissionCard();
    renderDailyCompleteMask(items, el);
};

/** 渲染 Tabs 标签系统 */
const renderTabs = (sections, container) => {
    let tabsWrapper = getById(DOM_IDS.SEC_TABS);
    if (!tabsWrapper) {
        tabsWrapper = document.createElement('div');
        tabsWrapper.id = DOM_IDS.SEC_TABS;

        // 标签栏
        const tabBar = document.createElement('div');
        tabBar.className = 'era-tabs';
        TAB_DEFINITIONS.forEach(td => {
            const btn = document.createElement('button');
            btn.className = `era-tab ${STATE.activeTab === td.key ? 'active' : ''}`;
            btn.dataset.tab = td.key;
            btn.textContent = td.label;
            btn.onclick = () => switchTab(td.key);
            tabBar.appendChild(btn);
        });
        tabsWrapper.appendChild(tabBar);

        // 标签内容区
        TAB_DEFINITIONS.forEach(td => {
            const content = document.createElement('div');
            content.id = `${DOM_IDS.TAB_CONTENT_PREFIX}${td.key}`;
            content.className = `era-tab-content ${STATE.activeTab === td.key ? 'active' : ''}`;
            tabsWrapper.appendChild(content);
        });

        container.appendChild(tabsWrapper);
    }
    // 渲染各 Tab 内容
    renderTabList(TASK_TYPE.SUBMIT, sections[TASK_TYPE.SUBMIT]);
    renderSubmitTab(); // 渲染投稿Card
    renderTabList(TASK_TYPE.LIVE, sections[TASK_TYPE.LIVE]);
    renderTabList(TASK_TYPE.LOTTERY, sections[TASK_TYPE.LOTTERY]);
    const submitLiveCard = getById(`${DOM_IDS.TAB_LIVE_CARD_PREFIX}${TASK_TYPE.SUBMIT}`);
    if (submitLiveCard) submitLiveCard.remove();
    renderLiveStatusCard(TASK_TYPE.LIVE);
    const liveReminderBanner = ensureTopReminderBanner(TASK_TYPE.LIVE, DOM_IDS.LIVE_REMINDER_BANNER);
    renderTopReminderBanner(liveReminderBanner, buildLiveHitReminderModel(sections[TASK_TYPE.LIVE]));
};

/** 切换标签 */
const switchTab = (key) => {
    STATE.activeTab = key;

    // 更新标签样式
    document.querySelectorAll('.era-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === key);
    });
    document.querySelectorAll('.era-tab-content').forEach(el => {
        el.classList.toggle('active', el.id === `${DOM_IDS.TAB_CONTENT_PREFIX}${key}`);
    });

    // 切换到投稿 Tab 时刷新数据
    if (key === TASK_TYPE.SUBMIT && !Array.isArray(STATE.activityArchives)) {
        refreshArchives();
    }
};

/** 渲染单个 Tab 内的列表 */
const renderTabList = (tabKey, items) => {
    const content = getById(`${DOM_IDS.TAB_CONTENT_PREFIX}${tabKey}`);
    if (!content) return;

    items.forEach(t => {
        const { isClaim, isDone } = getStatusFlags(t.status);
        const btnText = isClaim ? '领取' : (isDone ? '已完成' : '去完成');
        const btnCls = isClaim ? 'btn-claim' : '';
        const html = buildListTaskCardHtml(t, btnCls, btnText);
        const cls = `list-card ${isClaim ? 'status-claim' : ''} ${isDone ? 'status-done' : ''}`;
        const hash = getTaskCardHash(t);
        upsertTaskAnchorCard({
            id: `${DOM_IDS.LIST_TASK_PREFIX}${t.id}`,
            container: content,
            cls,
            hash,
            html,
            href: t.url,
        });
    });
};


export {
    render,
    renderSubmitTab,
    renderSubmissionCard,
    renderArchivesLoading,
    refreshArchives,
};
