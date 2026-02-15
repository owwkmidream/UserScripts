import { URLS } from './constants.js';
import { STATE } from './state.js';
import {
    buildActivityHotUrl,
    buildTaskTotalUrl,
    buildMemberArchivesUrl,
    daysBetween,
    formatBJDate,
    getBJTodayRange,
    getCookie,
    gmFetch,
    gmRequest,
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

const WBI_MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

const stripWbiUnsafeChars = (value) => (
    typeof value === 'string' ? value.replace(/[!'()*]/g, '') : value
);

const extractWbiKey = (url) => {
    if (!url || typeof url !== 'string') return '';
    const fileName = url.slice(url.lastIndexOf('/') + 1);
    const dotIndex = fileName.indexOf('.');
    return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
};

const getMixinKey = (origin) => {
    const mixed = WBI_MIXIN_KEY_ENC_TAB.map((idx) => origin[idx] || '').join('');
    return mixed.slice(0, 32);
};

const getWbiKeysFromStorage = () => {
    try {
        const raw = localStorage.getItem('wbi_img_urls') || '';
        if (!raw) return null;
        const [imgUrl, subUrl] = raw.split('-');
        const imgKey = extractWbiKey(imgUrl);
        const subKey = extractWbiKey(subUrl);
        return imgKey && subKey ? { imgKey, subKey } : null;
    } catch (_) {
        return null;
    }
};

const fetchWbiKeysFromNav = async () => {
    const res = await gmFetch(URLS.WEB_NAV);
    if (res?.code !== 0) return null;
    const imgKey = extractWbiKey(res.data?.wbi_img?.img_url || '');
    const subKey = extractWbiKey(res.data?.wbi_img?.sub_url || '');
    if (!imgKey || !subKey) return null;
    return { imgKey, subKey };
};

const getWbiKeys = async () => {
    if (STATE.wbiKeys?.imgKey && STATE.wbiKeys?.subKey) return STATE.wbiKeys;
    const localKeys = getWbiKeysFromStorage();
    if (localKeys) {
        STATE.wbiKeys = localKeys;
        return localKeys;
    }
    const navKeys = await fetchWbiKeysFromNav();
    if (navKeys) {
        STATE.wbiKeys = navKeys;
        return navKeys;
    }
    return null;
};

const encodeWbiQuery = (params) => Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(stripWbiUnsafeChars(params[key]))}`)
    .join('&');

const buildMissionReceiveUrl = async () => {
    const keys = await getWbiKeys();
    if (!keys) throw new Error('未获取到 WBI 密钥');
    if (typeof md5 !== 'function') throw new Error('md5 依赖未加载');
    const wts = Math.round(Date.now() / 1000).toString();
    const query = encodeWbiQuery({ wts });
    const mixinKey = getMixinKey(`${keys.imgKey}${keys.subKey}`);
    const wRid = md5(query + mixinKey);
    return `${URLS.MISSION_RECEIVE}?w_rid=${wRid}&wts=${wts}`;
};

const resolveMissionReceiveError = (status, payload) => {
    if (status === 412) {
        return { message: 'IP访问异常（HTTP 412）', type: 'warning' };
    }
    const code = Number(payload?.code);
    if (code === 202032) return { message: '无资格领取该奖励', type: 'warning' };
    if (code === 202100) return { message: '触发风控验证，请在活动页完成验证后重试', type: 'warning' };
    if (code === 202101) return { message: '账号行为异常，无法领奖', type: 'error' };
    if (code === 202102) return { message: '风控系统异常，请稍后再试', type: 'warning' };
    if (code === -509 || code === -702) return { message: '请求过于频繁，请稍后再试', type: 'warning' };
    if (code === -504) return { message: '服务调用超时，请稍后重试', type: 'warning' };
    if (payload?.message) return { message: payload.message, type: 'warning' };
    return { message: `领取失败（${Number.isFinite(code) ? code : status}）`, type: 'warning' };
};

const claimMissionReward = async (task, taskContext = {}) => {
    const csrf = getCookie('bili_jct');
    const taskId = task?.claimMeta?.taskId || task?.id || '';
    const activityId = task?.claimMeta?.activityId || taskContext.activityId || '';
    if (!csrf) {
        return { ok: false, status: 0, code: -101, message: '缺少登录态 csrf（bili_jct）', type: 'error' };
    }
    if (!taskId || !activityId) {
        return { ok: false, status: 0, code: 400, message: '缺少 task_id 或 activity_id，无法领取', type: 'error' };
    }

    try {
        const reqUrl = await buildMissionReceiveUrl();
        const body = new URLSearchParams();
        body.append('task_id', String(taskId));
        body.append('activity_id', String(activityId));
        body.append('activity_name', task?.claimMeta?.activityName || taskContext.activityName || '');
        body.append('task_name', task?.claimMeta?.taskName || task?.name || '');
        body.append('reward_name', task?.claimMeta?.rewardName || task?.reward || '');
        body.append('gaia_vtoken', '');
        body.append('receive_from', 'missionPage');
        body.append('csrf', csrf);

        const resp = await gmRequest(reqUrl, {
            method: 'POST',
            headers: {
                accept: '*/*',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                referer: location.href,
            },
            data: body.toString(),
        });
        const payload = resp.data || {};
        const code = Number(payload.code);
        if (resp.status === 200 && code === 0) {
            return {
                ok: true,
                status: resp.status,
                code,
                message: payload.message || '领取成功',
                data: payload.data || null,
                type: 'success',
            };
        }
        const resolved = resolveMissionReceiveError(resp.status, payload);
        return {
            ok: false,
            status: resp.status,
            code: Number.isFinite(code) ? code : payload.code,
            message: resolved.message,
            type: resolved.type,
            data: payload.data || null,
        };
    } catch (e) {
        return {
            ok: false,
            status: 0,
            code: 0,
            message: `领取请求失败：${e?.message || e}`,
            type: 'error',
        };
    }
};

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
    claimMissionReward,
    fetchActivityArchivesByInfo,
    refreshActivityArchives,
    calcActivityStats,
    checkTodaySubmission,
};
