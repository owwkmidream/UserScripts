import { TASK_TYPE, TASK_STATUS } from './constants.js';
import { buildAwardExchangeUrl, getStatusPriority } from './utils.js';
import { calcActivityStats } from './activity.js';

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

const pickString = (...vals) => vals.find(v => typeof v === 'string' && v.trim());

const parseTaskContext = () => {
    const s = unsafeWindow.__initialState || {};
    const pageInfo = unsafeWindow.__BILIACT_PAGEINFO || {};
    const activityId = pickString(
        pageInfo.activity_id,
        s.activity_id,
        s.EraLotteryPc?.[0]?.config?.activity_id
    ) || '';
    const activityName = pickString(
        pageInfo.title,
        pageInfo.shareTitle,
        s.BaseInfo?.title
    ) || '';
    return { activityId, activityName };
};

const createTaskSections = () => ({
    [TASK_TYPE.DAILY]: [],
    [TASK_TYPE.SUBMIT]: [],
    [TASK_TYPE.LIVE]: [],
    [TASK_TYPE.LOTTERY]: [],
});
const buildLotteryTaskItem = (conf, api) => {
    const cps = api.check_points || [];
    const ind = api.indicators?.[0] || { cur_value: 0, limit: 1 };
    const max = cps.length ? cps[cps.length - 1].list[0].limit : ind.limit;
    const nextRw = cps.find(c => c.status !== TASK_STATUS.DONE)?.award_name || '已完成';
    const done = cps.every(c => c.status === TASK_STATUS.DONE);
    return {
        id: conf.taskId,
        name: conf.taskName,
        status: done ? TASK_STATUS.DONE : (cps.some(c => c.status === TASK_STATUS.CLAIMABLE) ? TASK_STATUS.CLAIMABLE : TASK_STATUS.PENDING),
        cur: ind.cur_value,
        total: max,
        reward: nextRw,
        percent: Math.min(100, (ind.cur_value / max) * 100),
        url: '#',
        type: TASK_TYPE.LOTTERY,
    };
};
const buildLiveAccumulativeTaskItems = (api) => (api.accumulative_check_points || []).map((sub) => ({
    id: sub.sid,
    name: `累计直播 ${sub.list[0].limit} 天`,
    status: sub.status,
    cur: api.accumulative_count,
    total: sub.list[0].limit,
    reward: sub.award_name,
    percent: Math.min(100, (api.accumulative_count / sub.list[0].limit) * 100),
    url: buildAwardExchangeUrl(sub.sid),
    type: TASK_TYPE.LIVE,
}));
const buildBaseTaskItem = (conf, api) => {
    const isDaily = conf.periodType === 1 && conf.taskAwardType === 1;
    const cp = api.check_points?.[0];
    return {
        isDaily,
        item: {
            id: conf.taskId,
            name: conf.taskName,
            status: api.task_status,
            cur: cp ? cp.list[0].cur_value : 0,
            total: cp ? cp.list[0].limit : 1,
            reward: conf.awardName,
            url: buildAwardExchangeUrl(conf.taskId),
            type: isDaily ? TASK_TYPE.DAILY : TASK_TYPE.SUBMIT,
            claimMeta: {
                taskId: conf.taskId || '',
                taskName: conf.taskName || '',
                rewardName: conf.awardName || '',
            },
        },
    };
};
const applySubmitProgressFromTaskName = (item, taskName) => {
    const limitMatch = taskName?.match(/投稿.*?(\d+)天/);
    if (!limitMatch) return item;
    item.total = parseInt(limitMatch[1], 10);
    const stats = calcActivityStats();
    item.cur = stats ? stats.uniqueDays : 0;
    return item;
};
const getFilmRewardValue = (str) => {
    if (!str) return 0;
    if (str.includes('菲林')) {
        const m = str.match(/菲林.*?(\d+)/);
        return m ? parseInt(m[1], 10) : 1;
    }
    return 0;
};
const sortTaskSectionList = (list) => {
    list.sort((a, b) => {
        const pA = getStatusPriority(a.status);
        const pB = getStatusPriority(b.status);
        if (pA !== pB) return pA - pB;
        if (a.status === TASK_STATUS.CLAIMABLE) {
            const vA = getFilmRewardValue(a.reward);
            const vB = getFilmRewardValue(b.reward);
            if (vA !== vB) return vB - vA;
        }
        return 0;
    });
};
const processTasks = (configList, apiList, taskContext = {}) => {
    const apiMap = {};
    apiList.forEach((i) => {
        apiMap[i.task_id] = i;
    });
    const sections = createTaskSections();

    configList.forEach((conf) => {
        const api = apiMap[conf.taskId];
        if (!api) return;

        if (conf.taskAwardType === 3 || api.award_type === 3) {
            sections[TASK_TYPE.LOTTERY].push(buildLotteryTaskItem(conf, api));
            return;
        }

        if (conf.statisticType === 2 || api.accumulative_check_points?.length) {
            sections[TASK_TYPE.LIVE].push(...buildLiveAccumulativeTaskItems(api));
            return;
        }

        const { item, isDaily } = buildBaseTaskItem(conf, api);
        if (item.claimMeta) {
            item.claimMeta.activityId = conf.activityId || taskContext.activityId || '';
            item.claimMeta.activityName = conf.activityName || taskContext.activityName || '';
        }
        if (!isDaily) {
            applySubmitProgressFromTaskName(item, conf.taskName);
        }
        item.percent = Math.min(100, (item.cur / item.total) * 100);
        if (isDaily) sections[TASK_TYPE.DAILY].push(item); else sections[TASK_TYPE.SUBMIT].push(item);
    });

    Object.values(sections).forEach(sortTaskSectionList);
    return sections;
};

export {
    parseConfig,
    parseTaskContext,
    processTasks,
};
