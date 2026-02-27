import { DOM_IDS, TASK_STATUS, TASK_TYPE, URLS } from './constants.js';
import { STATE } from './state.js';
import {
    buildLiveFaceAuthUrl,
    buildLiveRoomExtUrl,
    getById,
    getCookie,
    hideById,
    hideElement,
    LIVE_AREA_HISTORY_KEY,
    LIVE_AREA_HISTORY_LIMIT,
    LIVE_BUVID_KEY,
    LIVE_UA_FALLBACK,
    showById,
    showElement,
} from './utils.js';

const LIVE_TASK_60_NAME_RE = /开播\s*60\s*分钟/;
const LIVE_TASK_60_LIMIT_SECONDS = 3600;
const LIVE_TASK_REFRESH_DEFAULT_SECONDS = 300;
const LIVE_TASK_REFRESH_MIN_SECONDS = 60;
const LIVE_TASK_REFRESH_MAX_SECONDS = 900;
const LIVE_TASK_REFRESH_SAMPLE_LIMIT = 8;

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
            url: URLS.LIVE_VERSION,
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
        url: URLS.LIVE_ROOM_INFO,
    });
    STATE.live.roomInfo = res.data || null;
    return STATE.live.roomInfo;
};

const fetchLiveRoomStartInfo = async (roomId) => {
    if (!roomId) return null;
    const res = await makeLiveApiRequest({
        method: 'GET',
        url: buildLiveRoomExtUrl(roomId),
    });
    STATE.live.roomExtInfo = res.data || null;
    return STATE.live.roomExtInfo;
};

const fetchLiveAreaList = async () => {
    if (STATE.live.areaList) return STATE.live.areaList;
    const res = await makeLiveApiRequest({
        method: 'GET',
        url: URLS.LIVE_AREA_LIST,
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

const createDefaultLiveTask60State = () => ({
    exists: false,
    name: '',
    cur: 0,
    total: LIVE_TASK_60_LIMIT_SECONDS,
    status: 0,
    lastSeenAt: 0,
    lastCurChangeAt: 0,
    refreshIntervals: [],
    completedAt: 0,
});

const getNowTs = () => Math.floor(Date.now() / 1000);

const normalizePositiveInt = (val, fallback = 0) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.floor(n));
};

const formatTimeByTs = (ts) => {
    if (!Number.isFinite(ts) || ts <= 0) return '--:--:--';
    return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false });
};

const isLiveTask60 = (task) => {
    const name = String(task?.name || '');
    const total = normalizePositiveInt(task?.total, 0);
    return LIVE_TASK_60_NAME_RE.test(name) && total === LIVE_TASK_60_LIMIT_SECONDS;
};

const getMedian = (nums = []) => {
    if (!nums.length) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
};

const estimateTaskRefreshIntervalSeconds = (task60) => {
    const samples = Array.isArray(task60?.refreshIntervals)
        ? task60.refreshIntervals.filter((n) => Number.isFinite(n) && n > 0)
        : [];
    if (!samples.length) return LIVE_TASK_REFRESH_DEFAULT_SECONDS;
    const median = getMedian(samples);
    if (!Number.isFinite(median)) return LIVE_TASK_REFRESH_DEFAULT_SECONDS;
    return Math.max(
        LIVE_TASK_REFRESH_MIN_SECONDS,
        Math.min(LIVE_TASK_REFRESH_MAX_SECONDS, Math.round(median))
    );
};

const alignToNextSlot = (targetTs, baseTs, intervalSec) => {
    if (!Number.isFinite(targetTs) || !Number.isFinite(baseTs) || !Number.isFinite(intervalSec)) return null;
    if (baseTs <= 0 || intervalSec <= 0) return null;
    if (targetTs <= baseTs) return baseTs;
    const step = Math.ceil((targetTs - baseTs) / intervalSec);
    return baseTs + step * intervalSec;
};

const resetLiveTask60State = () => {
    STATE.live.task60 = createDefaultLiveTask60State();
};

const updateLiveTask60Progress = (dailyItems = []) => {
    const missionTask = Array.isArray(dailyItems) ? dailyItems.find(isLiveTask60) : null;
    if (!missionTask) {
        resetLiveTask60State();
        return;
    }

    const nowTs = getNowTs();
    const nextCur = normalizePositiveInt(missionTask.cur, 0);
    const nextTotal = normalizePositiveInt(missionTask.total, LIVE_TASK_60_LIMIT_SECONDS) || LIVE_TASK_60_LIMIT_SECONDS;
    const nextStatus = normalizePositiveInt(missionTask.status, 0);
    const prev = STATE.live.task60 && typeof STATE.live.task60 === 'object'
        ? STATE.live.task60
        : createDefaultLiveTask60State();
    const shouldReset = !prev.exists || nextTotal !== prev.total || nextCur < prev.cur;

    const nextState = shouldReset
        ? createDefaultLiveTask60State()
        : {
            ...prev,
            refreshIntervals: [...(prev.refreshIntervals || [])],
        };

    if (shouldReset) {
        nextState.lastCurChangeAt = nextCur > 0 ? nowTs : 0;
        nextState.completedAt = 0;
    } else if (nextCur > nextState.cur) {
        const gap = nowTs - normalizePositiveInt(nextState.lastCurChangeAt, 0);
        if (gap >= LIVE_TASK_REFRESH_MIN_SECONDS && gap <= LIVE_TASK_REFRESH_MAX_SECONDS) {
            nextState.refreshIntervals.push(gap);
            if (nextState.refreshIntervals.length > LIVE_TASK_REFRESH_SAMPLE_LIMIT) {
                nextState.refreshIntervals = nextState.refreshIntervals.slice(-LIVE_TASK_REFRESH_SAMPLE_LIMIT);
            }
        }
        nextState.lastCurChangeAt = nowTs;
    }

    if (nextStatus === TASK_STATUS.DONE || nextCur >= nextTotal) {
        if (!nextState.completedAt) nextState.completedAt = nowTs;
    } else if (nextStatus !== TASK_STATUS.DONE) {
        nextState.completedAt = 0;
    }

    nextState.exists = true;
    nextState.name = String(missionTask.name || '');
    nextState.cur = nextCur;
    nextState.total = nextTotal;
    nextState.status = nextStatus;
    nextState.lastSeenAt = nowTs;

    STATE.live.task60 = nextState;
};

const getOneHourEtaTs = (isLive, task60) => {
    if (!isLive) return null;
    if (Number.isFinite(STATE.live.liveStartTs) && STATE.live.liveStartTs > 0) {
        return STATE.live.liveStartTs + LIVE_TASK_60_LIMIT_SECONDS;
    }
    if (task60?.exists) {
        return getNowTs() + Math.max(0, LIVE_TASK_60_LIMIT_SECONDS - normalizePositiveInt(task60.cur, 0));
    }
    return null;
};

const estimateTask60DoneEtaTs = (task60, localOneHourTs) => {
    if (!task60?.exists || !Number.isFinite(localOneHourTs) || localOneHourTs <= 0) return null;
    if (task60.status === TASK_STATUS.DONE || task60.cur >= task60.total) {
        return task60.completedAt || task60.lastSeenAt || getNowTs();
    }
    const nowTs = getNowTs();
    const intervalSec = estimateTaskRefreshIntervalSeconds(task60);
    if (task60.lastCurChangeAt > 0) {
        let eta = alignToNextSlot(localOneHourTs, task60.lastCurChangeAt, intervalSec);
        if (eta !== null && eta < nowTs) {
            eta = alignToNextSlot(nowTs, task60.lastCurChangeAt, intervalSec);
        }
        return eta;
    }
    if (task60.lastSeenAt > 0) {
        const eta = alignToNextSlot(localOneHourTs, task60.lastSeenAt, intervalSec);
        if (eta !== null) return eta;
    }
    return localOneHourTs + intervalSec;
};

const buildLiveStatusLines = ({
    isLive,
    syncTimeText,
    startTs,
    oneHourEtaTs,
    task60,
    task60DoneEtaTs,
}) => {
    const lines = [
        { text: `更新 ${syncTimeText}`, title: '直播状态同步时间（自动轮询）' },
        {
            text: `开播 ${isLive ? formatTimeByTs(startTs) : '--:--:--'}`,
            title: isLive ? '本场直播开播时间' : '当前未开播',
        },
        {
            text: `满1h ${isLive ? formatTimeByTs(oneHourEtaTs) : '--:--:--'}`,
            title: isLive ? '本地估算：直播时长达到 60 分钟的时间' : '当前未开播',
        },
    ];
    if (task60?.exists) {
        const isTaskDone = task60.status === TASK_STATUS.DONE || task60.cur >= task60.total;
        lines.push({
            text: `${isTaskDone ? '任务' : '任务'} ${formatTimeByTs(task60DoneEtaTs)}`,
            title: isTaskDone
                ? '每日任务“开播 60 分钟”已完成'
                : '后台约 5 分钟刷新一次 CUR，按观测节奏估算任务完成时间',
        });
    }
    return lines;
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
// 8.5 直播管理
// ==========================================
const showLiveToast = (message, type = 'info', autoDismiss = true, duration = 3600) => {
    let toast = getById(DOM_IDS.LIVE_TOAST);
    if (!toast) {
        toast = document.createElement('div');
        toast.id = DOM_IDS.LIVE_TOAST;
        document.body.appendChild(toast);
    }
    toast.className = type;
    toast.innerHTML = message;
    showElement(toast);
    if (toast._timer) clearTimeout(toast._timer);
    if (autoDismiss) {
        toast._timer = setTimeout(() => {
            hideElement(toast);
        }, duration);
    }
};

const createLiveAreaModal = () => {
    if (getById(DOM_IDS.LIVE_AREA_MODAL)) return;
    const html = `
        <div id="${DOM_IDS.LIVE_AREA_OVERLAY}"></div>
        <div id="${DOM_IDS.LIVE_AREA_MODAL}">
            <h3>选择直播分区</h3>
            <div class="era-live-history">
                <div class="era-live-history-title">历史分区（优先）</div>
                <div class="era-live-history-list" id="${DOM_IDS.LIVE_HISTORY_LIST}"></div>
            </div>
            <div class="era-live-row">
                <label for="${DOM_IDS.LIVE_PARENT_SELECT}">父分区</label>
                <select id="${DOM_IDS.LIVE_PARENT_SELECT}"></select>
            </div>
            <div class="era-live-row">
                <label for="${DOM_IDS.LIVE_SUB_SELECT}">子分区</label>
                <select id="${DOM_IDS.LIVE_SUB_SELECT}"></select>
            </div>
            <div class="era-live-modal-actions">
                <button id="${DOM_IDS.LIVE_START_CANCEL}">取消</button>
                <button id="${DOM_IDS.LIVE_START_CONFIRM}">开播</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = getById(DOM_IDS.LIVE_AREA_OVERLAY);
    const parentSelect = getById(DOM_IDS.LIVE_PARENT_SELECT);
    const cancelBtn = getById(DOM_IDS.LIVE_START_CANCEL);
    const confirmBtn = getById(DOM_IDS.LIVE_START_CONFIRM);

    parentSelect.addEventListener('change', () => {
        populateLiveSubAreas(parentSelect.value);
    });
    overlay.addEventListener('click', hideLiveAreaModal);
    cancelBtn.addEventListener('click', hideLiveAreaModal);
    confirmBtn.addEventListener('click', async () => {
        const subSelect = getById(DOM_IDS.LIVE_SUB_SELECT);
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
    showById(DOM_IDS.LIVE_AREA_OVERLAY);
    showById(DOM_IDS.LIVE_AREA_MODAL);
};

const hideLiveAreaModal = () => {
    hideById(DOM_IDS.LIVE_AREA_OVERLAY);
    hideById(DOM_IDS.LIVE_AREA_MODAL);
};

const populateLiveParentAreas = (defaultParentId) => {
    const parentSelect = getById(DOM_IDS.LIVE_PARENT_SELECT);
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
    const subSelect = getById(DOM_IDS.LIVE_SUB_SELECT);
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
    const parentSelect = getById(DOM_IDS.LIVE_PARENT_SELECT);
    if (!parentSelect) return;
    parentSelect.value = String(found.parentId);
    populateLiveSubAreas(found.parentId, found.areaId);
};

const renderLiveAreaHistory = () => {
    const wrap = getById(DOM_IDS.LIVE_HISTORY_LIST);
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
    const confirmBtn = getById(DOM_IDS.LIVE_START_CONFIRM);
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
    if (getById(DOM_IDS.LIVE_AUTH_MODAL)) return;
    const html = `
        <div id="${DOM_IDS.LIVE_AUTH_OVERLAY}"></div>
        <div id="${DOM_IDS.LIVE_AUTH_MODAL}">
            <h3>身份验证</h3>
            <p>请使用 B 站 App 扫码完成身份验证，然后点击“我已验证”。</p>
            <div id="${DOM_IDS.LIVE_AUTH_QRCODE}"></div>
            <div class="era-live-modal-actions">
                <button id="${DOM_IDS.LIVE_AUTH_CANCEL}">取消</button>
                <button id="${DOM_IDS.LIVE_AUTH_RETRY}">我已验证</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    getById(DOM_IDS.LIVE_AUTH_OVERLAY).addEventListener('click', hideLiveAuthModal);
    getById(DOM_IDS.LIVE_AUTH_CANCEL).addEventListener('click', hideLiveAuthModal);
};

const showAuthQRCodeModal = (authUrl, roomId, areaV2) => {
    createLiveAuthModal();
    const overlay = getById(DOM_IDS.LIVE_AUTH_OVERLAY);
    const modal = getById(DOM_IDS.LIVE_AUTH_MODAL);
    const container = getById(DOM_IDS.LIVE_AUTH_QRCODE);
    const retryBtn = getById(DOM_IDS.LIVE_AUTH_RETRY);
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
    showElement(overlay);
    showElement(modal);
};

const hideLiveAuthModal = () => {
    hideById(DOM_IDS.LIVE_AUTH_OVERLAY);
    hideById(DOM_IDS.LIVE_AUTH_MODAL);
};

const startLiveStream = async (roomId, areaV2) => {
    const csrfToken = getCookie('bili_jct');
    const dedeUserID = getCookie('DedeUserID');
    if (!csrfToken || !dedeUserID) {
        showLiveToast('未登录或缺少 CSRF，无法开播。', 'error');
        return false;
    }

    STATE.live.isOperating = true;
    renderLiveStatusCard(TASK_TYPE.LIVE);

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
            url: URLS.LIVE_START,
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
            const faceAuthUrl = buildLiveFaceAuthUrl(dedeUserID);
            hideLiveAreaModal();
            showAuthQRCodeModal(faceAuthUrl, roomId, areaV2);
            showLiveToast('该分区要求身份验证，请先扫码。', 'warning', false);
        } else {
            showLiveToast(`开播失败：${e.message || e}`, 'error');
        }
        return false;
    } finally {
        STATE.live.isOperating = false;
        renderLiveStatusCard(TASK_TYPE.LIVE);
    }
};

const stopLiveStream = async () => {
    const csrfToken = getCookie('bili_jct');
    if (!csrfToken) {
        showLiveToast('缺少 CSRF，无法关播。', 'error');
        return;
    }
    STATE.live.isOperating = true;
    renderLiveStatusCard(TASK_TYPE.LIVE);
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
            url: URLS.LIVE_STOP,
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
        renderLiveStatusCard(TASK_TYPE.LIVE);
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
        renderLiveStatusCard(TASK_TYPE.LIVE);
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

const getLiveStatusSubText = (isLive) => {
    if (STATE.live.lastError) {
        return `状态拉取失败：${STATE.live.lastError}`;
    }
    if (STATE.live.isRefreshing && !STATE.live.lastSyncAt) {
        return '正在同步直播状态...';
    }
    return isLive ? '直播中' : '未开播';
};
const getLiveStatusViewModel = () => {
    const isLive = STATE.live.liveStatus === 1;
    const roomInfo = STATE.live.roomInfo;
    const task60 = STATE.live.task60 && typeof STATE.live.task60 === 'object'
        ? STATE.live.task60
        : createDefaultLiveTask60State();
    const areaText = roomInfo?.parent_name && roomInfo?.area_v2_name
        ? `${roomInfo.parent_name} / ${roomInfo.area_v2_name}`
        : '分区信息待获取';
    const syncTimeText = STATE.live.lastSyncAt
        ? formatTimeByTs(Math.floor(STATE.live.lastSyncAt / 1000))
        : '--:--:--';
    const oneHourEtaTs = getOneHourEtaTs(isLive, task60);
    const task60DoneEtaTs = estimateTask60DoneEtaTs(task60, oneHourEtaTs);
    const statusLines = buildLiveStatusLines({
        isLive,
        syncTimeText,
        startTs: STATE.live.liveStartTs,
        oneHourEtaTs,
        task60,
        task60DoneEtaTs,
    });

    return {
        isLive,
        duration: isLive ? formatDuration(getLiveDurationSeconds()) : '--:--:--',
        areaText,
        statusLines,
        subText: getLiveStatusSubText(isLive),
        isOperating: STATE.live.isOperating,
    };
};
const getLiveStatusRenderHash = (viewModel) => ([
    viewModel.isLive ? 1 : 0,
    viewModel.subText,
    viewModel.areaText,
    (viewModel.statusLines || []).map((line) => line.text).join(','),
    viewModel.isOperating ? 1 : 0,
].join('|'));
const buildLiveStatusCardHtml = (tabKey, viewModel) => `
    <div class="live-card-head">
        <span class="live-dot ${viewModel.isLive ? 'on' : 'off'}"></span>
        <div class="wide-card-title">📡 直播状态</div>
        <span class="live-state-text">${viewModel.subText}</span>
    </div>
    <button class="live-action-btn ${viewModel.isLive ? 'stop' : 'start'}" id="${DOM_IDS.LIVE_ACTION_BTN_PREFIX}${tabKey}" ${viewModel.isOperating ? 'disabled' : ''}>
        ${viewModel.isOperating ? '处理中' : (viewModel.isLive ? '关播' : '开播')}
    </button>
    <div class="live-card-area" title="${viewModel.areaText}">分区 ${viewModel.areaText}</div>
    <div class="live-duration-line">
        <span class="label">本场时长</span><span class="live-duration-value">${viewModel.duration}</span>
    </div>
    <div class="live-card-sync">
        ${(viewModel.statusLines || [])
            .map((line) => `<span class="live-card-sync-item" title="${line.title || line.text}">${line.text}</span>`)
            .join('')}
    </div>
`;

const renderLiveStatusCard = (tabKey) => {
    const content = getById(`${DOM_IDS.TAB_CONTENT_PREFIX}${tabKey}`);
    if (!content) return;

    const cardId = `${DOM_IDS.TAB_LIVE_CARD_PREFIX}${tabKey}`;
    let card = getById(cardId);
    if (!card) {
        card = document.createElement('div');
        card.id = cardId;
        content.prepend(card);
    }

    const viewModel = getLiveStatusViewModel();
    const renderHash = getLiveStatusRenderHash(viewModel);

    if (card.dataset.renderHash !== renderHash) {
        card.className = `tab-live-card ${viewModel.isLive ? 'live-on' : 'live-off'}`;
        card.innerHTML = buildLiveStatusCardHtml(tabKey, viewModel);
        card.dataset.renderHash = renderHash;
    }

    if (content.firstChild !== card) {
        const topBanner = getById(DOM_IDS.LIVE_REMINDER_BANNER);
        if (topBanner && topBanner.parentElement === content) {
            content.insertBefore(card, topBanner.nextSibling);
        } else {
            content.prepend(card);
        }
    }

    const btn = getById(`${DOM_IDS.LIVE_ACTION_BTN_PREFIX}${tabKey}`);
    if (btn) {
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (STATE.live.isOperating) return;
            if (viewModel.isLive) {
                await stopLiveStream();
            } else {
                await showAreaSelectionModal();
            }
        };
    }
};

export {
    refreshLiveState,
    updateLiveDurationTexts,
    renderLiveStatusCard,
    updateLiveTask60Progress,
};
