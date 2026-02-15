import { TASK_TYPE } from './constants.js';
import { getArrayStore, LIVE_AREA_HISTORY_KEY } from './utils.js';

// ==========================================
// 3. 状态
// ==========================================
const STATE = {
    config: [],
    taskContext: {
        activityId: '',
        activityName: '',
    },
    isPolling: false,
    claimingTaskIds: new Set(),
    activeTab: TASK_TYPE.SUBMIT,
    activityInfo: null,       // { id, name, stime, etime, actUrl }
    activityArchives: null,   // [{ bvid, title, ptime, view }]
    isLoadingArchives: false,
    wbiKeys: null,            // { imgKey, subKey }
    live: {
        roomInfo: null,
        roomExtInfo: null,
        areaList: null,
        roomId: null,
        liveStatus: 0,
        liveStartTs: null,
        isRefreshing: false,
        isOperating: false,
        versionCache: null,
        lastError: '',
        lastSyncAt: 0,
        areaHistory: getArrayStore(LIVE_AREA_HISTORY_KEY),
    }
};

export { STATE };
