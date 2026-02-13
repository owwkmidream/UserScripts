const TASK_TYPE = Object.freeze({
    DAILY: 'DAILY',
    SUBMIT: 'SUBMIT',
    LIVE: 'LIVE',
    LOTTERY: 'LOTTERY',
});
const TASK_STATUS = Object.freeze({
    PENDING: 1,
    CLAIMABLE: 2,
    DONE: 3,
});
const TAB_DEFINITIONS = Object.freeze([
    { key: TASK_TYPE.SUBMIT, label: '📹 投稿' },
    { key: TASK_TYPE.LIVE, label: '📺 直播' },
    { key: TASK_TYPE.LOTTERY, label: '🎡 抽奖' },
]);
const DOM_IDS = Object.freeze({
    DRAWER: 'era-drawer',
    TOGGLE_PILL: 'era-toggle-pill',
    CLOSE_BTN: 'era-close',
    CLOCK: 'era-clock',
    SCROLL_VIEW: 'era-scroll-view',
    SEC_DAILY: 'sec-daily',
    SEC_TABS: 'sec-tabs',
    GRID_SUBMISSION_CARD: 'grid-submission-card',
    SUBMIT_BANNER: 'submit-stats-banner',
    REFRESH_SUBMISSION_BTN: 'btn-refresh-submission',
    LIVE_TOAST: 'era-live-toast',
    LIVE_AREA_MODAL: 'era-live-area-modal',
    LIVE_AREA_OVERLAY: 'era-live-area-overlay',
    LIVE_PARENT_SELECT: 'era-live-parent-select',
    LIVE_SUB_SELECT: 'era-live-sub-select',
    LIVE_HISTORY_LIST: 'era-live-history-list',
    LIVE_START_CANCEL: 'era-live-start-cancel',
    LIVE_START_CONFIRM: 'era-live-start-confirm',
    LIVE_AUTH_MODAL: 'era-live-auth-modal',
    LIVE_AUTH_OVERLAY: 'era-live-auth-overlay',
    LIVE_AUTH_CANCEL: 'era-live-auth-cancel',
    LIVE_AUTH_RETRY: 'era-live-auth-retry',
    LIVE_AUTH_QRCODE: 'era-live-auth-qrcode',
    TAB_CONTENT_PREFIX: 'tab-content-',
    TAB_LIVE_CARD_PREFIX: 'tab-live-card-',
    LIVE_ACTION_BTN_PREFIX: 'live-action-btn-',
    GRID_TASK_PREFIX: 'grid-',
    LIST_TASK_PREFIX: 'list-',
});
const URLS = Object.freeze({
    ACTIVITY_HOT_LIST: 'https://api.bilibili.com/x/activity_components/video_activity/hot_activity',
    TASK_TOTAL_V2: 'https://api.bilibili.com/x/task/totalv2',
    MEMBER_ARCHIVES: 'https://member.bilibili.com/x/web/archives',
    AWARD_EXCHANGE: 'https://www.bilibili.com/blackboard/era/award-exchange.html',
    CREATOR_UPLOAD: 'https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload',
    LIVE_VERSION: 'https://api.live.bilibili.com/xlive/app-blink/v1/liveVersionInfo/getHomePageLiveVersion?system_version=2',
    LIVE_ROOM_INFO: 'https://api.live.bilibili.com/xlive/app-blink/v1/room/GetInfo?platform=pc',
    LIVE_ROOM_EXT: 'https://api.live.bilibili.com/room/v1/Room/get_info',
    LIVE_AREA_LIST: 'https://api.live.bilibili.com/room/v1/Area/getList?show_pinyin=1',
    LIVE_START: 'https://api.live.bilibili.com/room/v1/Room/startLive',
    LIVE_STOP: 'https://api.live.bilibili.com/room/v1/Room/stopLive',
    LIVE_FACE_AUTH: 'https://www.bilibili.com/blackboard/live/face-auth-middle.html',
});
const UI_TIMING = Object.freeze({
    FLASH_HIGHLIGHT_MS: 800,
    LIVE_BOOT_DELAY_MS: 50,
    TASK_BOOT_DELAY_MS: 10,
    TASK_LOOP_MS: 1000,
    ARCHIVES_BOOT_DELAY_MS: 0,
});

export {
    TASK_TYPE,
    TASK_STATUS,
    TAB_DEFINITIONS,
    DOM_IDS,
    URLS,
    UI_TIMING,
};
