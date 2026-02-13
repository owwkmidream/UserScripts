import { TASK_STATUS, URLS } from './constants.js';

// ==========================================
// 2. 工具函数
// ==========================================
const getCookie = (n) => { const m = document.cookie.match(new RegExp('(^| )' + n + '=([^;]+)')); return m ? m[2] : null; };
const getById = (id) => document.getElementById(id);
const setElementDisplay = (el, display) => {
    if (el) el.style.display = display;
};
const showElement = (el) => setElementDisplay(el, 'block');
const hideElement = (el) => setElementDisplay(el, 'none');
const showById = (id) => showElement(getById(id));
const hideById = (id) => hideElement(getById(id));
const getStatusFlags = (status) => ({
    isClaim: status === TASK_STATUS.CLAIMABLE,
    isDone: status === TASK_STATUS.DONE,
});
const getStatusPriority = (status) => (
    status === TASK_STATUS.CLAIMABLE
        ? 0
        : (status === TASK_STATUS.PENDING ? 1 : (status === TASK_STATUS.DONE ? 2 : 1))
);
const getTaskCardHash = (task) => `${task.status}-${task.cur}`;
const buildAwardExchangeUrl = (taskId) => `${URLS.AWARD_EXCHANGE}?task_id=${taskId}`;
const buildActivityHotUrl = (pn, ps) => `${URLS.ACTIVITY_HOT_LIST}?pn=${pn}&ps=${ps}`;
const buildMemberArchivesUrl = (pn, ps) => `${URLS.MEMBER_ARCHIVES}?status=is_pubing%2Cpubed%2Cnot_pubed&pn=${pn}&ps=${ps}&coop=1&interactive=1`;
const buildTaskTotalUrl = (csrf, ids) => `${URLS.TASK_TOTAL_V2}?csrf=${csrf}&task_ids=${ids.join(',')}`;
const buildLiveRoomExtUrl = (roomId) => `${URLS.LIVE_ROOM_EXT}?room_id=${roomId}`;
const buildLiveFaceAuthUrl = (mid) => `${URLS.LIVE_FACE_AUTH}?source_event=400&mid=${mid}`;

const BJ_TZ_OFFSET_SECONDS = 8 * 3600;
const BJ_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const getBJDateParts = (timestamp) => {
    let date;
    if (timestamp === null || timestamp === undefined) {
        date = new Date();
    } else {
        const numericTs = Number(timestamp);
        if (!Number.isFinite(numericTs)) return null;
        date = new Date(numericTs * 1000);
    }
    const partsMap = {};
    BJ_DATE_PARTS_FORMATTER.formatToParts(date).forEach((part) => {
        if (part.type !== 'literal') partsMap[part.type] = part.value;
    });
    const year = Number(partsMap.year);
    const month = Number(partsMap.month);
    const day = Number(partsMap.day);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day };
};

const getBJDaySerial = (timestamp) => {
    const numericTs = Number(timestamp);
    if (!Number.isFinite(numericTs)) return null;
    return Math.floor((numericTs + BJ_TZ_OFFSET_SECONDS) / 86400);
};

/** 获取北京时间今天的 0:00 和 24:00 时间戳（秒） */
const getBJTodayRange = () => {
    const todayParts = getBJDateParts();
    if (!todayParts) return { start: 0, end: 0 };
    const start = Math.floor(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day, -8, 0, 0) / 1000);
    return { start, end: start + 86400 };
};

/** 格式化北京时间日期字符串 */
const formatBJDate = (ts) => {
    const parts = getBJDateParts(ts);
    if (!parts) return '--';
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

/** 计算两个时间戳之间的天数差（北京时间） */
const daysBetween = (ts1, ts2) => {
    const day1 = getBJDaySerial(ts1);
    const day2 = getBJDaySerial(ts2);
    if (day1 === null || day2 === null) return 0;
    return day2 - day1;
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

export {
    getCookie,
    getById,
    setElementDisplay,
    showElement,
    hideElement,
    showById,
    hideById,
    getStatusFlags,
    getStatusPriority,
    getTaskCardHash,
    buildAwardExchangeUrl,
    buildActivityHotUrl,
    buildMemberArchivesUrl,
    buildTaskTotalUrl,
    buildLiveRoomExtUrl,
    buildLiveFaceAuthUrl,
    BJ_TZ_OFFSET_SECONDS,
    BJ_DATE_PARTS_FORMATTER,
    getBJDateParts,
    getBJDaySerial,
    getBJTodayRange,
    formatBJDate,
    daysBetween,
    formatViews,
    gmFetch,
    LIVE_STATUS_POLL_MS,
    LIVE_DURATION_TICK_MS,
    LIVE_AREA_HISTORY_KEY,
    LIVE_AREA_HISTORY_LIMIT,
    LIVE_BUVID_KEY,
    LIVE_UA_FALLBACK,
    getArrayStore,
};
