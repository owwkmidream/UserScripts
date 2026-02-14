import { STATE } from './state.js';
import {
    buildActivityHotUrl,
    buildTaskTotalUrl,
    buildMemberArchivesUrl,
    daysBetween,
    formatBJDate,
    getBJTodayRange,
    gmFetch,
} from './utils.js';

// ==========================================
// 5. 活动 ID 获取
// ==========================================
const fetchActivityId = async () => {
    let pn = 1;
    const ps = 50;
    while (true) {
        try {
            const res = await gmFetch(
                buildActivityHotUrl(pn, ps)
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

const fetchTaskTotals = (csrfToken, taskIds) => gmFetch(
    buildTaskTotalUrl(csrfToken, taskIds)
);

// ==========================================
// 6. 稿件获取与匹配
// ==========================================
const isArchiveAbnormal = (arc) => {
    if (!arc) return true;
    const state = Number(arc.state);
    if (!Number.isFinite(state)) return true;
    return state < 0;
};

const isCountableArchive = (archive) => archive?.isAbnormal !== true;

const fetchActivityArchivesByInfo = async (activityInfo) => {
    if (!activityInfo) return [];
    const { id: actId, stime } = activityInfo;
    const matched = [];
    let pn = 1;
    const ps = 50;

    try {
        while (true) {
            const res = await gmFetch(
                buildMemberArchivesUrl(pn, ps)
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
                        isAbnormal: isArchiveAbnormal(arc),
                    });
                }
            }

            if (stopFetching || res.data.arc_audits.length < ps) break;
            pn++;
        }
    } catch (e) {
        console.error('[任务助手] 获取稿件失败:', e);
    }
    return matched;
};

const refreshActivityArchives = async () => {
    if (!STATE.activityInfo || STATE.isLoadingArchives) return null;
    STATE.isLoadingArchives = true;
    try {
        const matched = await fetchActivityArchivesByInfo(STATE.activityInfo);
        STATE.activityArchives = matched;
        return matched;
    } finally {
        STATE.isLoadingArchives = false;
    }
};

// ==========================================
// 7. 统计计算
// ==========================================
const calcActivityStats = () => {
    if (!STATE.activityInfo || !STATE.activityArchives) return null;
    const { stime, etime } = STATE.activityInfo;
    const archives = STATE.activityArchives;
    const validArchives = archives.filter(isCountableArchive);

    // 当前北京时间
    const nowTs = Math.floor(Date.now() / 1000);
    // 活动进行到第几天
    const activityDays = daysBetween(stime, Math.min(nowTs, etime)) + 1;
    // 总播放量
    const totalViews = validArchives.reduce((sum, a) => sum + a.view, 0);
    // 累计参加天数（独立日期数）
    const uniqueDays = new Set(validArchives.map(a => formatBJDate(a.ptime))).size;

    return { activityDays, totalViews, uniqueDays };
};

const checkTodaySubmission = () => {
    if (!STATE.activityArchives) return { submitted: false, dayNum: 0 };
    const { start, end } = getBJTodayRange();
    const submitted = STATE.activityArchives.some(
        (a) => isCountableArchive(a) && a.ptime >= start && a.ptime < end
    );
    const dayNum = STATE.activityInfo
        ? daysBetween(STATE.activityInfo.stime, Math.floor(Date.now() / 1000)) + 1
        : 0;
    return { submitted, dayNum };
};

export {
    fetchActivityId,
    fetchTaskTotals,
    fetchActivityArchivesByInfo,
    refreshActivityArchives,
    calcActivityStats,
    checkTodaySubmission,
};
