// ==UserScript==
// @name         B站活动页任务助手
// @namespace    http://tampermonkey.net/
// @version      5.6
// @description  悬浮面板，Tabs标签切换，活动稿件投稿打卡与统计。
// @author       Gemini_Refactored
// @include      /^https:\/\/www\.bilibili\.com\/blackboard\/era\/[a-zA-Z0-9]+\.html$/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/blueimp-md5/2.19.0/js/md5.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
// @connect      api.bilibili.com
// @connect      member.bilibili.com
// @connect      api.live.bilibili.com
// @run-at       document-end
// ==/UserScript==

(function() {


//#region src/constants.js
	const TASK_TYPE = Object.freeze({
		DAILY: "DAILY",
		SUBMIT: "SUBMIT",
		LIVE: "LIVE",
		LOTTERY: "LOTTERY"
	});
	const TASK_STATUS = Object.freeze({
		PENDING: 1,
		CLAIMABLE: 2,
		DONE: 3
	});
	const TAB_DEFINITIONS = Object.freeze([
		{
			key: TASK_TYPE.SUBMIT,
			label: "📹 投稿"
		},
		{
			key: TASK_TYPE.LIVE,
			label: "📺 直播"
		},
		{
			key: TASK_TYPE.LOTTERY,
			label: "🎡 抽奖"
		}
	]);
	const DOM_IDS = Object.freeze({
		DRAWER: "era-drawer",
		TOGGLE_PILL: "era-toggle-pill",
		CLOSE_BTN: "era-close",
		CLOCK: "era-clock",
		SCROLL_VIEW: "era-scroll-view",
		SEC_DAILY: "sec-daily",
		SEC_TABS: "sec-tabs",
		GRID_SUBMISSION_CARD: "grid-submission-card",
		SUBMIT_REMINDER_BANNER: "submit-reminder-banner",
		SUBMIT_BANNER: "submit-stats-banner",
		REFRESH_SUBMISSION_BTN: "btn-refresh-submission",
		LIVE_REMINDER_BANNER: "live-reminder-banner",
		LIVE_TOAST: "era-live-toast",
		LIVE_AREA_MODAL: "era-live-area-modal",
		LIVE_AREA_OVERLAY: "era-live-area-overlay",
		LIVE_PARENT_SELECT: "era-live-parent-select",
		LIVE_SUB_SELECT: "era-live-sub-select",
		LIVE_HISTORY_LIST: "era-live-history-list",
		LIVE_START_CANCEL: "era-live-start-cancel",
		LIVE_START_CONFIRM: "era-live-start-confirm",
		LIVE_AUTH_MODAL: "era-live-auth-modal",
		LIVE_AUTH_OVERLAY: "era-live-auth-overlay",
		LIVE_AUTH_CANCEL: "era-live-auth-cancel",
		LIVE_AUTH_RETRY: "era-live-auth-retry",
		LIVE_AUTH_QRCODE: "era-live-auth-qrcode",
		TAB_CONTENT_PREFIX: "tab-content-",
		TAB_LIVE_CARD_PREFIX: "tab-live-card-",
		LIVE_ACTION_BTN_PREFIX: "live-action-btn-",
		GRID_TASK_PREFIX: "grid-",
		LIST_TASK_PREFIX: "list-"
	});
	const URLS = Object.freeze({
		ACTIVITY_HOT_LIST: "https://api.bilibili.com/x/activity_components/video_activity/hot_activity",
		WEB_NAV: "https://api.bilibili.com/x/web-interface/nav",
		TASK_TOTAL_V2: "https://api.bilibili.com/x/task/totalv2",
		MISSION_RECEIVE: "https://api.bilibili.com/x/activity_components/mission/receive",
		MEMBER_ARCHIVES: "https://member.bilibili.com/x/web/archives",
		AWARD_EXCHANGE: "https://www.bilibili.com/blackboard/era/award-exchange.html",
		CREATOR_UPLOAD: "https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload",
		LIVE_VERSION: "https://api.live.bilibili.com/xlive/app-blink/v1/liveVersionInfo/getHomePageLiveVersion?system_version=2",
		LIVE_ROOM_INFO: "https://api.live.bilibili.com/xlive/app-blink/v1/room/GetInfo?platform=pc",
		LIVE_ROOM_EXT: "https://api.live.bilibili.com/room/v1/Room/get_info",
		LIVE_AREA_LIST: "https://api.live.bilibili.com/room/v1/Area/getList?show_pinyin=1",
		LIVE_START: "https://api.live.bilibili.com/room/v1/Room/startLive",
		LIVE_STOP: "https://api.live.bilibili.com/room/v1/Room/stopLive",
		LIVE_FACE_AUTH: "https://www.bilibili.com/blackboard/live/face-auth-middle.html"
	});
	const UI_TIMING = Object.freeze({
		FLASH_HIGHLIGHT_MS: 800,
		LIVE_BOOT_DELAY_MS: 50,
		TASK_BOOT_DELAY_MS: 10,
		TASK_LOOP_MS: 1e3,
		ARCHIVES_BOOT_DELAY_MS: 0
	});

//#endregion
//#region src/utils.js
	const getCookie = (n) => {
		const m = document.cookie.match(new RegExp("(^| )" + n + "=([^;]+)"));
		return m ? m[2] : null;
	};
	const getById = (id) => document.getElementById(id);
	const setElementDisplay = (el, display) => {
		if (el) el.style.display = display;
	};
	const showElement = (el) => setElementDisplay(el, "block");
	const hideElement = (el) => setElementDisplay(el, "none");
	const showById = (id) => showElement(getById(id));
	const hideById = (id) => hideElement(getById(id));
	const getStatusFlags = (status) => ({
		isClaim: status === TASK_STATUS.CLAIMABLE,
		isDone: status === TASK_STATUS.DONE
	});
	const getStatusPriority = (status) => status === TASK_STATUS.CLAIMABLE ? 0 : status === TASK_STATUS.PENDING ? 1 : status === TASK_STATUS.DONE ? 2 : 1;
	const getTaskCardHash = (task) => `${task.status}-${task.cur}`;
	const buildAwardExchangeUrl = (taskId) => `${URLS.AWARD_EXCHANGE}?task_id=${taskId}`;
	const buildActivityHotUrl = (pn, ps) => `${URLS.ACTIVITY_HOT_LIST}?pn=${pn}&ps=${ps}`;
	const buildMemberArchivesUrl = (pn, ps) => `${URLS.MEMBER_ARCHIVES}?status=is_pubing%2Cpubed%2Cnot_pubed&pn=${pn}&ps=${ps}&coop=1&interactive=1`;
	const buildTaskTotalUrl = (csrf, ids) => `${URLS.TASK_TOTAL_V2}?csrf=${csrf}&task_ids=${ids.join(",")}`;
	const buildLiveRoomExtUrl = (roomId) => `${URLS.LIVE_ROOM_EXT}?room_id=${roomId}`;
	const buildLiveFaceAuthUrl = (mid) => `${URLS.LIVE_FACE_AUTH}?source_event=400&mid=${mid}`;
	const BJ_TZ_OFFSET_SECONDS = 8 * 3600;
	const BJ_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	});
	const getBJDateParts = (timestamp) => {
		let date;
		if (timestamp === null || timestamp === undefined) {
			date = new Date();
		} else {
			const numericTs = Number(timestamp);
			if (!Number.isFinite(numericTs)) return null;
			date = new Date(numericTs * 1e3);
		}
		const partsMap = {};
		BJ_DATE_PARTS_FORMATTER.formatToParts(date).forEach((part) => {
			if (part.type !== "literal") partsMap[part.type] = part.value;
		});
		const year = Number(partsMap.year);
		const month = Number(partsMap.month);
		const day = Number(partsMap.day);
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
		return {
			year,
			month,
			day
		};
	};
	const getBJDaySerial = (timestamp) => {
		const numericTs = Number(timestamp);
		if (!Number.isFinite(numericTs)) return null;
		return Math.floor((numericTs + BJ_TZ_OFFSET_SECONDS) / 86400);
	};
	/** 获取北京时间今天的 0:00 和 24:00 时间戳（秒） */
	const getBJTodayRange = () => {
		const todayParts = getBJDateParts();
		if (!todayParts) return {
			start: 0,
			end: 0
		};
		const start = Math.floor(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day, -8, 0, 0) / 1e3);
		return {
			start,
			end: start + 86400
		};
	};
	/** 格式化北京时间日期字符串 */
	const formatBJDate = (ts) => {
		const parts = getBJDateParts(ts);
		if (!parts) return "--";
		return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
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
		if (!num) return "0";
		return num.toString().replace(/\B(?=(\d{4})+(?!\d))/g, ",");
	};
	/** 封装 GM_xmlhttpRequest 为 Promise */
	const gmRequest = (url, opts = {}) => new Promise((resolve, reject) => {
		GM_xmlhttpRequest({
			method: "GET",
			url,
			...opts,
			onload: (resp) => {
				let data = null;
				try {
					data = JSON.parse(resp.responseText);
				} catch (_) {
					data = null;
				}
				resolve({
					status: resp.status,
					data,
					raw: resp.responseText || "",
					headers: resp.responseHeaders || "",
					finalUrl: resp.finalUrl || url
				});
			},
			onerror: reject,
			ontimeout: reject
		});
	});
	/** 封装 GM_xmlhttpRequest 为 Promise 并返回 JSON */
	const gmFetch = (url, opts = {}) => new Promise((resolve, reject) => {
		GM_xmlhttpRequest({
			method: "GET",
			url,
			...opts,
			onload: (resp) => {
				try {
					resolve(JSON.parse(resp.responseText));
				} catch (e) {
					reject(e);
				}
			},
			onerror: reject
		});
	});
	const LIVE_STATUS_POLL_MS = 15e3;
	const LIVE_DURATION_TICK_MS = 1e3;
	const LIVE_AREA_HISTORY_KEY = "era_live_area_history_v1";
	const LIVE_AREA_HISTORY_LIMIT = 10;
	const LIVE_BUVID_KEY = "bilibili_live_buvid_header";
	const LIVE_UA_FALLBACK = "LiveHime/7.11.3.8931 os/Windows pc_app/livehime build/8931 osVer/10.0_x86_64";
	const getArrayStore = (key) => {
		const raw = GM_getValue(key, []);
		if (Array.isArray(raw)) return raw;
		if (typeof raw === "string") {
			try {
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed : [];
			} catch (_) {
				return [];
			}
		}
		return [];
	};

//#endregion
//#region src/state.js
	const STATE = {
		config: [],
		taskContext: {
			activityId: "",
			activityName: ""
		},
		isPolling: false,
		claimingTaskIds: new Set(),
		activeTab: TASK_TYPE.SUBMIT,
		activityInfo: null,
		activityArchives: null,
		isLoadingArchives: false,
		wbiKeys: null,
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
			lastError: "",
			lastSyncAt: 0,
			areaHistory: getArrayStore(LIVE_AREA_HISTORY_KEY)
		}
	};

//#endregion
//#region src/activity.js
	const fetchActivityId = async () => {
		let pn = 1;
		const ps = 50;
		while (true) {
			try {
				const res = await gmFetch(buildActivityHotUrl(pn, ps));
				if (res?.code !== 0 || !res.data?.list?.length) break;
				for (const act of res.data.list) {
					try {
						const actPath = new URL(act.act_url).pathname;
						if (actPath === location.pathname) {
							return {
								id: act.id,
								name: act.name,
								stime: act.stime,
								etime: act.etime,
								actUrl: act.act_url
							};
						}
					} catch (_) {}
				}
				if (res.data.list.length < ps) break;
				pn++;
				if (pn > 20) break;
			} catch (e) {
				console.error("[任务助手] 获取活动列表失败:", e);
				break;
			}
		}
		return null;
	};
	const fetchTaskTotals = (csrfToken, taskIds) => gmFetch(buildTaskTotalUrl(csrfToken, taskIds));
	const WBI_MIXIN_KEY_ENC_TAB = [
		46,
		47,
		18,
		2,
		53,
		8,
		23,
		32,
		15,
		50,
		10,
		31,
		58,
		3,
		45,
		35,
		27,
		43,
		5,
		49,
		33,
		9,
		42,
		19,
		29,
		28,
		14,
		39,
		12,
		38,
		41,
		13,
		37,
		48,
		7,
		16,
		24,
		55,
		40,
		61,
		26,
		17,
		0,
		1,
		60,
		51,
		30,
		4,
		22,
		25,
		54,
		21,
		56,
		59,
		6,
		63,
		57,
		62,
		11,
		36,
		20,
		34,
		44,
		52
	];
	const stripWbiUnsafeChars = (value) => typeof value === "string" ? value.replace(/[!'()*]/g, "") : value;
	const extractWbiKey = (url) => {
		if (!url || typeof url !== "string") return "";
		const fileName = url.slice(url.lastIndexOf("/") + 1);
		const dotIndex = fileName.indexOf(".");
		return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
	};
	const getMixinKey = (origin) => {
		const mixed = WBI_MIXIN_KEY_ENC_TAB.map((idx) => origin[idx] || "").join("");
		return mixed.slice(0, 32);
	};
	const getWbiKeysFromStorage = () => {
		try {
			const raw = localStorage.getItem("wbi_img_urls") || "";
			if (!raw) return null;
			const [imgUrl, subUrl] = raw.split("-");
			const imgKey = extractWbiKey(imgUrl);
			const subKey = extractWbiKey(subUrl);
			return imgKey && subKey ? {
				imgKey,
				subKey
			} : null;
		} catch (_) {
			return null;
		}
	};
	const fetchWbiKeysFromNav = async () => {
		const res = await gmFetch(URLS.WEB_NAV);
		if (res?.code !== 0) return null;
		const imgKey = extractWbiKey(res.data?.wbi_img?.img_url || "");
		const subKey = extractWbiKey(res.data?.wbi_img?.sub_url || "");
		if (!imgKey || !subKey) return null;
		return {
			imgKey,
			subKey
		};
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
	const encodeWbiQuery = (params) => Object.keys(params).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(stripWbiUnsafeChars(params[key]))}`).join("&");
	const buildMissionReceiveUrl = async () => {
		const keys = await getWbiKeys();
		if (!keys) throw new Error("未获取到 WBI 密钥");
		if (typeof md5 !== "function") throw new Error("md5 依赖未加载");
		const wts = Math.round(Date.now() / 1e3).toString();
		const query = encodeWbiQuery({ wts });
		const mixinKey = getMixinKey(`${keys.imgKey}${keys.subKey}`);
		const wRid = md5(query + mixinKey);
		return `${URLS.MISSION_RECEIVE}?w_rid=${wRid}&wts=${wts}`;
	};
	const resolveMissionReceiveError = (status, payload) => {
		if (status === 412) {
			return {
				message: "IP访问异常（HTTP 412）",
				type: "warning"
			};
		}
		const code = Number(payload?.code);
		if (code === 202032) return {
			message: "无资格领取该奖励",
			type: "warning"
		};
		if (code === 202100) return {
			message: "触发风控验证，请在活动页完成验证后重试",
			type: "warning"
		};
		if (code === 202101) return {
			message: "账号行为异常，无法领奖",
			type: "error"
		};
		if (code === 202102) return {
			message: "风控系统异常，请稍后再试",
			type: "warning"
		};
		if (code === -509 || code === -702) return {
			message: "请求过于频繁，请稍后再试",
			type: "warning"
		};
		if (code === -504) return {
			message: "服务调用超时，请稍后重试",
			type: "warning"
		};
		if (payload?.message) return {
			message: payload.message,
			type: "warning"
		};
		return {
			message: `领取失败（${Number.isFinite(code) ? code : status}）`,
			type: "warning"
		};
	};
	const claimMissionReward = async (task, taskContext = {}) => {
		const csrf = getCookie("bili_jct");
		const taskId = task?.claimMeta?.taskId || task?.id || "";
		const activityId = task?.claimMeta?.activityId || taskContext.activityId || "";
		if (!csrf) {
			return {
				ok: false,
				status: 0,
				code: -101,
				message: "缺少登录态 csrf（bili_jct）",
				type: "error"
			};
		}
		if (!taskId || !activityId) {
			return {
				ok: false,
				status: 0,
				code: 400,
				message: "缺少 task_id 或 activity_id，无法领取",
				type: "error"
			};
		}
		try {
			const reqUrl = await buildMissionReceiveUrl();
			const body = new URLSearchParams();
			body.append("task_id", String(taskId));
			body.append("activity_id", String(activityId));
			body.append("activity_name", task?.claimMeta?.activityName || taskContext.activityName || "");
			body.append("task_name", task?.claimMeta?.taskName || task?.name || "");
			body.append("reward_name", task?.claimMeta?.rewardName || task?.reward || "");
			body.append("gaia_vtoken", "");
			body.append("receive_from", "missionPage");
			body.append("csrf", csrf);
			const resp = await gmRequest(reqUrl, {
				method: "POST",
				headers: {
					accept: "*/*",
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
					referer: location.href
				},
				data: body.toString()
			});
			const payload = resp.data || {};
			const code = Number(payload.code);
			if (resp.status === 200 && code === 0) {
				return {
					ok: true,
					status: resp.status,
					code,
					message: payload.message || "领取成功",
					data: payload.data || null,
					type: "success"
				};
			}
			const resolved = resolveMissionReceiveError(resp.status, payload);
			return {
				ok: false,
				status: resp.status,
				code: Number.isFinite(code) ? code : payload.code,
				message: resolved.message,
				type: resolved.type,
				data: payload.data || null
			};
		} catch (e) {
			return {
				ok: false,
				status: 0,
				code: 0,
				message: `领取请求失败：${e?.message || e}`,
				type: "error"
			};
		}
	};
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
				const res = await gmFetch(buildMemberArchivesUrl(pn, ps));
				if (res?.code !== 0 || !res.data?.arc_audits?.length) break;
				let stopFetching = false;
				for (const item of res.data.arc_audits) {
					const arc = item.Archive;
					const stat = item.stat;
					if (arc.ptime < stime) {
						stopFetching = true;
						break;
					}
					if (arc.mission_id === actId) {
						matched.push({
							bvid: arc.bvid,
							title: arc.title,
							ptime: arc.ptime,
							view: stat?.view || 0,
							isAbnormal: isArchiveAbnormal(arc)
						});
					}
				}
				if (stopFetching || res.data.arc_audits.length < ps) break;
				pn++;
			}
		} catch (e) {
			console.error("[任务助手] 获取稿件失败:", e);
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
	const calcActivityStats = () => {
		if (!STATE.activityInfo || !STATE.activityArchives) return null;
		const { stime, etime } = STATE.activityInfo;
		const archives = STATE.activityArchives;
		const validArchives = archives.filter(isCountableArchive);
		const nowTs = Math.floor(Date.now() / 1e3);
		const activityDays = daysBetween(stime, Math.min(nowTs, etime)) + 1;
		const totalViews = validArchives.reduce((sum, a) => sum + a.view, 0);
		const uniqueDays = new Set(validArchives.map((a) => formatBJDate(a.ptime))).size;
		return {
			activityDays,
			totalViews,
			uniqueDays
		};
	};
	const checkTodaySubmission = () => {
		if (!STATE.activityArchives) return {
			submitted: false,
			dayNum: 0
		};
		const { start, end } = getBJTodayRange();
		const submitted = STATE.activityArchives.some((a) => isCountableArchive(a) && a.ptime >= start && a.ptime < end);
		const dayNum = STATE.activityInfo ? daysBetween(STATE.activityInfo.stime, Math.floor(Date.now() / 1e3)) + 1 : 0;
		return {
			submitted,
			dayNum
		};
	};

//#endregion
//#region src/live.js
	const getFixedBuvid = () => {
		let cachedBuvid = GM_getValue(LIVE_BUVID_KEY, null);
		if (cachedBuvid) return cachedBuvid;
		const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
			const r = Math.random() * 16 | 0;
			const v = c === "x" ? r : r & 3 | 8;
			return v.toString(16);
		}).toUpperCase();
		const padding = Math.floor(Math.random() * 9e4) + 1e4;
		cachedBuvid = `${uuid}${padding}user`;
		GM_setValue(LIVE_BUVID_KEY, cachedBuvid);
		return cachedBuvid;
	};
	const generateLivehimeUA = (version, build) => `LiveHime/${version} os/Windows pc_app/livehime build/${build} osVer/10.0_x86_64`;
	const makeLiveApiRequest = (options = {}) => new Promise((resolve, reject) => {
		const method = (options.method || "GET").toUpperCase();
		const ua = STATE.live.versionCache ? generateLivehimeUA(STATE.live.versionCache.version, STATE.live.versionCache.build) : LIVE_UA_FALLBACK;
		const headers = {
			"User-Agent": ua,
			buvid: GM_getValue(LIVE_BUVID_KEY, getFixedBuvid()),
			Referer: "",
			...options.headers || {}
		};
		if (method === "POST") {
			headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
		}
		GM_xmlhttpRequest({
			method,
			url: options.url,
			data: options.data,
			timeout: options.timeout || 15e3,
			headers,
			onload: (response) => {
				try {
					const data = JSON.parse(response.responseText || "{}");
					const isStopLiveRepeat = options.url && options.url.includes("stopLive") && (data.code === 16e4 || data.msg === "重复关播");
					if (data.code === 0 || isStopLiveRepeat) {
						resolve(data);
						return;
					}
					if (data.code === 60024) {
						reject(new Error(`API Error: ${data.code} - 需要进行身份验证`));
						return;
					}
					reject(new Error(`API Error: ${data.code} - ${data.message || data.msg || "未知错误"}`));
				} catch (e) {
					reject(new Error(`JSON解析失败: ${e.message}`));
				}
			},
			onerror: () => reject(new Error("请求失败")),
			ontimeout: () => reject(new Error("请求超时"))
		});
	});
	const fetchLatestLivehimeVersion = async () => {
		if (STATE.live.versionCache) return STATE.live.versionCache;
		try {
			const response = await makeLiveApiRequest({
				method: "GET",
				url: URLS.LIVE_VERSION
			});
			if (response?.data?.curr_version && response?.data?.build) {
				STATE.live.versionCache = {
					version: response.data.curr_version,
					build: String(response.data.build)
				};
				return STATE.live.versionCache;
			}
		} catch (_) {}
		STATE.live.versionCache = {
			version: "7.11.3.8931",
			build: "8931"
		};
		return STATE.live.versionCache;
	};
	const fetchLiveRoomInfo = async (forceRefresh = false) => {
		if (STATE.live.roomInfo && !forceRefresh) return STATE.live.roomInfo;
		const res = await makeLiveApiRequest({
			method: "GET",
			url: URLS.LIVE_ROOM_INFO
		});
		STATE.live.roomInfo = res.data || null;
		return STATE.live.roomInfo;
	};
	const fetchLiveRoomStartInfo = async (roomId) => {
		if (!roomId) return null;
		const res = await makeLiveApiRequest({
			method: "GET",
			url: buildLiveRoomExtUrl(roomId)
		});
		STATE.live.roomExtInfo = res.data || null;
		return STATE.live.roomExtInfo;
	};
	const fetchLiveAreaList = async () => {
		if (STATE.live.areaList) return STATE.live.areaList;
		const res = await makeLiveApiRequest({
			method: "GET",
			url: URLS.LIVE_AREA_LIST
		});
		STATE.live.areaList = res.data || [];
		return STATE.live.areaList;
	};
	const parseLiveTimeToTs = (val) => {
		if (val === null || val === undefined) return null;
		if (typeof val === "number" && Number.isFinite(val) && val > 0) return Math.floor(val);
		const str = String(val).trim();
		if (!str || str === "0" || str === "0000-00-00 00:00:00") return null;
		if (/^\d+$/.test(str)) {
			const n = Number(str);
			if (Number.isFinite(n) && n > 0) return Math.floor(n > 0xe8d4a51000 ? n / 1e3 : n);
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
			return Math.floor(utcMs / 1e3);
		}
		const parsed = Date.parse(str);
		if (Number.isNaN(parsed)) return null;
		return Math.floor(parsed / 1e3);
	};
	const getLiveDurationSeconds = () => {
		if (STATE.live.liveStatus !== 1 || !STATE.live.liveStartTs) return null;
		return Math.max(0, Math.floor(Date.now() / 1e3) - STATE.live.liveStartTs);
	};
	const formatDuration = (sec) => {
		if (sec === null || sec === undefined || !Number.isFinite(sec)) return "--:--:--";
		const total = Math.max(0, Math.floor(sec));
		const h = Math.floor(total / 3600);
		const m = Math.floor(total % 3600 / 60);
		const s = total % 60;
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
					areaName: sub.name
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
			areaName: entry.areaName || "",
			parentId: Number(entry.parentId || 0),
			parentName: entry.parentName || "",
			ts: Math.floor(Date.now() / 1e3)
		}, ...filtered].slice(0, LIVE_AREA_HISTORY_LIMIT);
		STATE.live.areaHistory = next;
		saveAreaHistory();
	};
	const showLiveToast = (message, type = "info", autoDismiss = true, duration = 3600) => {
		let toast = getById(DOM_IDS.LIVE_TOAST);
		if (!toast) {
			toast = document.createElement("div");
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
		document.body.insertAdjacentHTML("beforeend", html);
		const overlay = getById(DOM_IDS.LIVE_AREA_OVERLAY);
		const parentSelect = getById(DOM_IDS.LIVE_PARENT_SELECT);
		const cancelBtn = getById(DOM_IDS.LIVE_START_CANCEL);
		const confirmBtn = getById(DOM_IDS.LIVE_START_CONFIRM);
		parentSelect.addEventListener("change", () => {
			populateLiveSubAreas(parentSelect.value);
		});
		overlay.addEventListener("click", hideLiveAreaModal);
		cancelBtn.addEventListener("click", hideLiveAreaModal);
		confirmBtn.addEventListener("click", async () => {
			const subSelect = getById(DOM_IDS.LIVE_SUB_SELECT);
			const selectedSubAreaId = Number(subSelect.value || 0);
			if (!selectedSubAreaId) {
				showLiveToast("请选择子分区后再开播。", "warning");
				return;
			}
			const roomData = await fetchLiveRoomInfo();
			if (!roomData?.room_id) {
				showLiveToast("未获取到直播间 ID，无法开播。", "error");
				return;
			}
			confirmBtn.disabled = true;
			confirmBtn.textContent = "处理中...";
			await startLiveStream(roomData.room_id, selectedSubAreaId);
			confirmBtn.disabled = false;
			confirmBtn.textContent = "开播";
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
		parentSelect.innerHTML = "<option value=\"\">-- 请选择 --</option>";
		areas.forEach((parent) => {
			const option = document.createElement("option");
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
		subSelect.innerHTML = "<option value=\"\">-- 请选择 --</option>";
		if (!parentId) return;
		const parent = (STATE.live.areaList || []).find((p) => Number(p.id) === Number(parentId));
		if (!parent || !Array.isArray(parent.list)) return;
		parent.list.forEach((sub) => {
			const option = document.createElement("option");
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
			showLiveToast("历史分区不可用，可能已下线。", "warning");
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
			wrap.innerHTML = "<span class=\"era-live-history-empty\">暂无历史分区</span>";
			return;
		}
		wrap.innerHTML = "";
		history.forEach((entry, idx) => {
			const btn = document.createElement("button");
			btn.className = "era-live-history-btn";
			btn.textContent = `${entry.parentName || "未知"} / ${entry.areaName || `分区#${entry.areaId}`}`;
			btn.title = idx === 0 ? "最近使用" : "历史分区";
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
			confirmBtn.textContent = "加载中...";
		}
		try {
			const [roomData, areaList] = await Promise.all([fetchLiveRoomInfo(), fetchLiveAreaList()]);
			const historyFirst = (STATE.live.areaHistory || []).find((entry) => findAreaBySubId(entry.areaId, areaList));
			const defaultParentId = historyFirst?.parentId || roomData?.parent_id;
			const defaultSubId = historyFirst?.areaId || roomData?.area_v2_id;
			populateLiveParentAreas(defaultParentId);
			populateLiveSubAreas(defaultParentId, defaultSubId);
			renderLiveAreaHistory();
		} catch (e) {
			console.error("[任务助手] 打开分区选择失败:", e);
			showLiveToast(`分区加载失败：${e.message || e}`, "error");
			hideLiveAreaModal();
		} finally {
			if (confirmBtn) {
				confirmBtn.disabled = false;
				confirmBtn.textContent = "开播";
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
		document.body.insertAdjacentHTML("beforeend", html);
		getById(DOM_IDS.LIVE_AUTH_OVERLAY).addEventListener("click", hideLiveAuthModal);
		getById(DOM_IDS.LIVE_AUTH_CANCEL).addEventListener("click", hideLiveAuthModal);
	};
	const showAuthQRCodeModal = (authUrl, roomId, areaV2) => {
		createLiveAuthModal();
		const overlay = getById(DOM_IDS.LIVE_AUTH_OVERLAY);
		const modal = getById(DOM_IDS.LIVE_AUTH_MODAL);
		const container = getById(DOM_IDS.LIVE_AUTH_QRCODE);
		const retryBtn = getById(DOM_IDS.LIVE_AUTH_RETRY);
		container.innerHTML = "";
		new QRCode(container, {
			text: authUrl,
			width: 180,
			height: 180,
			correctLevel: QRCode.CorrectLevel.H
		});
		retryBtn.onclick = async () => {
			hideLiveAuthModal();
			showLiveToast("正在重新尝试开播...", "info");
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
		const csrfToken = getCookie("bili_jct");
		const dedeUserID = getCookie("DedeUserID");
		if (!csrfToken || !dedeUserID) {
			showLiveToast("未登录或缺少 CSRF，无法开播。", "error");
			return false;
		}
		STATE.live.isOperating = true;
		renderLiveStatusCard(TASK_TYPE.LIVE);
		const APP_KEY = "aae92bc66f3edfab";
		const APP_SECRET = "af125a0d5279fd576c1b4418a3e8276d";
		try {
			const vInfo = await fetchLatestLivehimeVersion();
			const params = new URLSearchParams();
			params.append("appkey", APP_KEY);
			params.append("area_v2", String(areaV2));
			params.append("build", String(vInfo.build));
			params.append("version", String(vInfo.version));
			params.append("csrf", csrfToken);
			params.append("csrf_token", csrfToken);
			params.append("platform", "pc_link");
			params.append("room_id", String(roomId));
			params.append("ts", String(Math.floor(Date.now() / 1e3)));
			params.append("type", "2");
			params.sort();
			const sign = md5(params.toString() + APP_SECRET);
			const formData = new URLSearchParams(params);
			formData.append("sign", sign);
			await makeLiveApiRequest({
				method: "POST",
				url: URLS.LIVE_START,
				data: formData.toString()
			});
			const areaMeta = findAreaBySubId(areaV2);
			if (areaMeta) rememberAreaHistory(areaMeta);
			showLiveToast("开播成功。", "success");
			hideLiveAreaModal();
			await refreshLiveState(true);
			return true;
		} catch (e) {
			console.error("[任务助手] 开播失败:", e);
			if (String(e.message || "").includes("60024")) {
				const faceAuthUrl = buildLiveFaceAuthUrl(dedeUserID);
				hideLiveAreaModal();
				showAuthQRCodeModal(faceAuthUrl, roomId, areaV2);
				showLiveToast("该分区要求身份验证，请先扫码。", "warning", false);
			} else {
				showLiveToast(`开播失败：${e.message || e}`, "error");
			}
			return false;
		} finally {
			STATE.live.isOperating = false;
			renderLiveStatusCard(TASK_TYPE.LIVE);
		}
	};
	const stopLiveStream = async () => {
		const csrfToken = getCookie("bili_jct");
		if (!csrfToken) {
			showLiveToast("缺少 CSRF，无法关播。", "error");
			return;
		}
		STATE.live.isOperating = true;
		renderLiveStatusCard(TASK_TYPE.LIVE);
		try {
			const roomData = await fetchLiveRoomInfo(true);
			if (!roomData?.room_id) {
				showLiveToast("未获取到直播间 ID，无法关播。", "error");
				return;
			}
			const formData = new URLSearchParams();
			formData.append("room_id", String(roomData.room_id));
			formData.append("platform", "pc_link");
			formData.append("csrf", csrfToken);
			formData.append("csrf_token", csrfToken);
			const data = await makeLiveApiRequest({
				method: "POST",
				url: URLS.LIVE_STOP,
				data: formData.toString()
			});
			if (data.code === 16e4 || data.msg === "重复关播") {
				showLiveToast("当前未在直播，或已成功关播。", "info");
			} else {
				showLiveToast("关播成功。", "success");
			}
			await refreshLiveState(true);
		} catch (e) {
			console.error("[任务助手] 关播失败:", e);
			showLiveToast(`关播失败：${e.message || e}`, "error");
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
			STATE.live.lastError = "";
			STATE.live.lastSyncAt = Date.now();
		} catch (e) {
			console.error("[任务助手] 刷新直播状态失败:", e);
			STATE.live.lastError = e.message || "刷新直播状态失败";
		} finally {
			STATE.live.isRefreshing = false;
			renderLiveStatusCard(TASK_TYPE.LIVE);
			updateLiveDurationTexts();
		}
	};
	const updateLiveDurationTexts = () => {
		const isLive = STATE.live.liveStatus === 1;
		const text = isLive ? formatDuration(getLiveDurationSeconds()) : "--:--:--";
		document.querySelectorAll(".live-duration-value").forEach((el) => {
			el.textContent = text;
		});
	};
	const getLiveStatusSubText = (isLive) => {
		if (STATE.live.lastError) {
			return `状态拉取失败：${STATE.live.lastError}`;
		}
		if (STATE.live.isRefreshing && !STATE.live.lastSyncAt) {
			return "正在同步直播状态...";
		}
		return isLive ? "直播中" : "未开播";
	};
	const getLiveStatusViewModel = () => {
		const isLive = STATE.live.liveStatus === 1;
		const roomInfo = STATE.live.roomInfo;
		const areaText = roomInfo?.parent_name && roomInfo?.area_v2_name ? `${roomInfo.parent_name} / ${roomInfo.area_v2_name}` : "分区信息待获取";
		const syncTimeText = STATE.live.lastSyncAt ? new Date(STATE.live.lastSyncAt).toLocaleTimeString() : "--:--:--";
		return {
			isLive,
			duration: isLive ? formatDuration(getLiveDurationSeconds()) : "--:--:--",
			areaText,
			syncTimeText,
			subText: getLiveStatusSubText(isLive),
			isOperating: STATE.live.isOperating
		};
	};
	const getLiveStatusRenderHash = (viewModel) => [
		viewModel.isLive ? 1 : 0,
		viewModel.subText,
		viewModel.areaText,
		viewModel.syncTimeText,
		viewModel.isOperating ? 1 : 0
	].join("|");
	const buildLiveStatusCardHtml = (tabKey, viewModel) => `
    <div class="live-card-head">
        <span class="live-dot ${viewModel.isLive ? "on" : "off"}"></span>
        <div class="wide-card-title">📡 直播状态</div>
        <span class="live-state-text">${viewModel.subText}</span>
    </div>
    <button class="live-action-btn ${viewModel.isLive ? "stop" : "start"}" id="${DOM_IDS.LIVE_ACTION_BTN_PREFIX}${tabKey}" ${viewModel.isOperating ? "disabled" : ""}>
        ${viewModel.isOperating ? "处理中" : viewModel.isLive ? "关播" : "开播"}
    </button>
    <div class="live-card-area" title="${viewModel.areaText}">分区 ${viewModel.areaText}</div>
    <div class="live-duration-line">
        <span class="label">本场时长</span><span class="live-duration-value">${viewModel.duration}</span>
    </div>
    <div class="live-card-sync" title="15秒自动轮询更新">更新于 ${viewModel.syncTimeText}</div>
`;
	const renderLiveStatusCard = (tabKey) => {
		const content = getById(`${DOM_IDS.TAB_CONTENT_PREFIX}${tabKey}`);
		if (!content) return;
		const cardId = `${DOM_IDS.TAB_LIVE_CARD_PREFIX}${tabKey}`;
		let card = getById(cardId);
		if (!card) {
			card = document.createElement("div");
			card.id = cardId;
			content.prepend(card);
		}
		const viewModel = getLiveStatusViewModel();
		const renderHash = getLiveStatusRenderHash(viewModel);
		if (card.dataset.renderHash !== renderHash) {
			card.className = `tab-live-card ${viewModel.isLive ? "live-on" : "live-off"}`;
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

//#endregion
//#region src/render.js
	const ensureSubmitBanner = () => {
		const content = getById(`${DOM_IDS.TAB_CONTENT_PREFIX}${TASK_TYPE.SUBMIT}`);
		if (!content) return null;
		let banner = getById(DOM_IDS.SUBMIT_BANNER);
		if (!banner) {
			banner = document.createElement("div");
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
			banner = document.createElement("div");
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
			banner.style.display = "none";
			banner.innerHTML = "";
			banner.className = "task-reminder-banner";
			banner.dataset.hash = "";
			return;
		}
		const nextHash = `${model.type || "warn"}|${model.title || ""}|${model.text || ""}`;
		if (banner.dataset.hash !== nextHash) {
			banner.className = `task-reminder-banner ${model.type || "warn"}`;
			banner.innerHTML = `
            <span class="task-reminder-tag">${model.title || "提醒"}</span>
            <span class="task-reminder-text">${model.text || ""}</span>
        `;
			banner.dataset.hash = nextHash;
		}
		banner.style.display = "flex";
	};
	const showTaskToast = (message, type = "info", duration = 2800) => {
		let toast = getById(DOM_IDS.LIVE_TOAST);
		if (!toast) {
			toast = document.createElement("div");
			toast.id = DOM_IDS.LIVE_TOAST;
			document.body.appendChild(toast);
		}
		toast.className = type;
		toast.textContent = message;
		toast.style.display = "block";
		if (toast._timer) clearTimeout(toast._timer);
		toast._timer = setTimeout(() => {
			toast.style.display = "none";
		}, duration);
	};
	const setSubmitBannerContent = (banner, html) => {
		banner.className = "submit-stats-banner";
		banner.innerHTML = html;
	};
	const updateTaskCardByHash = (card, cls, html, hash) => {
		if (card.dataset.hash === hash) return;
		card.className = `${cls} highlight-flash`;
		card.innerHTML = html;
		card.dataset.hash = hash;
		setTimeout(() => card.classList.remove("highlight-flash"), UI_TIMING.FLASH_HIGHLIGHT_MS);
	};
	const upsertTaskAnchorCard = ({ id, container, cls, hash, html, href }) => {
		let card = getById(id);
		if (!card) {
			card = document.createElement("a");
			card.id = id;
			card.className = cls;
			card.href = href || "#";
			card.target = "_blank";
			card.innerHTML = html;
			card.dataset.hash = hash;
			container.appendChild(card);
			return card;
		}
		updateTaskCardByHash(card, cls, html, hash);
		card.href = href || "#";
		return card;
	};
	const SUBMISSION_CARD_ICONS = Object.freeze({
		REFRESH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
		CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><path d="M20 6 9 17l-5-5"/></svg>`,
		CROSS: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg>`,
		WARN: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
		LOADING: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="era-icon spinning"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
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
				type: "warn",
				title: `投稿 ${settleDays} 天`,
				text: `今天 18:00 可领取奖励`
			};
		}
		return null;
	};
	const buildLiveHitReminderModel = (liveItems = []) => {
		const targets = [...new Set(liveItems.map((it) => Number(it?.total)).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
		if (!targets.length) return null;
		const current = liveItems.reduce((max, it) => {
			const cur = Number(it?.cur);
			return Number.isFinite(cur) ? Math.max(max, cur) : max;
		}, 0);
		const tomorrow = current + 1;
		if (!targets.includes(tomorrow)) return null;
		return {
			type: "warn",
			title: "直播 ${tomorrow} 天",
			text: `请在 23:00 做好开播准备`
		};
	};
	const resolveSubmissionCardState = ({ noActivity, loading, submitted, dayNum }) => {
		if (noActivity) {
			return {
				statusClass: "",
				iconHtml: SUBMISSION_CARD_ICONS.WARN,
				subText: "未获取到活动"
			};
		}
		if (loading) {
			return {
				statusClass: "",
				iconHtml: SUBMISSION_CARD_ICONS.LOADING,
				subText: "数据加载中..."
			};
		}
		if (submitted) {
			return {
				statusClass: "status-done",
				iconHtml: SUBMISSION_CARD_ICONS.CHECK,
				subText: `活动第 ${dayNum} 天`
			};
		}
		return {
			statusClass: "status-pending",
			iconHtml: SUBMISSION_CARD_ICONS.CROSS,
			subText: `活动第 ${dayNum} 天`
		};
	};
	const buildSubmissionCardHtml = ({ iconHtml, subText }) => `
    <div class="wide-card-left">
        <div class="wide-card-title">📝 投稿打卡</div>
        <div class="wide-card-sub">${subText}</div>
    </div>
    <div class="wide-card-right">
        ${iconHtml ? `<div class="wide-card-icon">${iconHtml}</div>` : ""}
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
		const submissionCardState = resolveSubmissionCardState({
			noActivity,
			loading,
			submitted,
			dayNum
		});
		const html = buildSubmissionCardHtml(submissionCardState);
		if (!card) {
			card = document.createElement("div");
			card.id = DOM_IDS.GRID_SUBMISSION_CARD;
			grid.appendChild(card);
			card.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (!submitted) {
					window.open(URLS.CREATOR_UPLOAD, "_blank");
				} else {
					refreshArchives();
				}
			});
		}
		card.className = `grid-card-wide ${submissionCardState.statusClass}`;
		card.innerHTML = html;
		const btn = card.querySelector(`#${DOM_IDS.REFRESH_SUBMISSION_BTN}`);
		if (btn) btn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			refreshArchives();
		};
	};
	/** 刷新稿件数据 */
	const refreshArchives = () => {
		if (STATE.isLoadingArchives) return;
		const btn = getById(DOM_IDS.REFRESH_SUBMISSION_BTN);
		if (btn) btn.classList.add("spinning");
		renderArchivesLoading();
		refreshActivityArchives().finally(() => {
			renderSubmitTab();
			renderSubmissionCard();
			const btn2 = getById(DOM_IDS.REFRESH_SUBMISSION_BTN);
			if (btn2) btn2.classList.remove("spinning");
		});
	};
	/** 渲染投稿 Tab 加载状态 */
	const renderArchivesLoading = () => {
		const banner = ensureSubmitBanner();
		if (!banner) return;
		setSubmitBannerContent(banner, "<div class=\"stats-loading\">⏳ 正在获取稿件数据...</div>");
	};
	/** v5.3: 计算下一个动态目标 */
	const calcNextTarget = (currentViews) => {
		const targets = [];
		if (STATE.config && Array.isArray(STATE.config)) {
			STATE.config.forEach((t) => {
				if (!t || !t.taskName) return;
				const match = t.taskName.match(/播放.*?(\d+)(万)?/);
				if (match) {
					let num = parseInt(match[1], 10);
					if (match[2] === "万") num *= 1e4;
					if (!targets.includes(num)) targets.push(num);
				}
			});
		}
		targets.sort((a, b) => a - b);
		if (targets.length === 0) {
			targets.push(15e4, 7e5);
		}
		const next = targets.find((t) => t > currentViews);
		return next || null;
	};
	/** 渲染投稿 Tab 统计 Banner */
	const renderSubmitTab = () => {
		const banner = ensureSubmitBanner();
		const reminderBanner = ensureTopReminderBanner(TASK_TYPE.SUBMIT, DOM_IDS.SUBMIT_REMINDER_BANNER);
		if (!banner) return;
		if (!STATE.activityInfo) {
			renderTopReminderBanner(reminderBanner, null);
			setSubmitBannerContent(banner, "<div class=\"stats-error\">⚠️ 未获取到活动信息</div>");
			return;
		}
		const stats = calcActivityStats();
		if (!stats) {
			renderTopReminderBanner(reminderBanner, null);
			setSubmitBannerContent(banner, "<div class=\"stats-loading\">暂无数据</div>");
			return;
		}
		const { submitted } = checkTodaySubmission();
		renderTopReminderBanner(reminderBanner, buildSubmitHitReminderModel(stats, submitted));
		const wan = Math.floor(stats.totalViews / 1e4);
		const rest = stats.totalViews % 1e4;
		const viewsHtml = `<span class="highlight-num">${wan}</span><span style="color:var(--era-text);font-size:12px;font-weight:700">万</span><span style="font-weight:400;color:var(--era-sub);margin-left:2px">${rest.toString().padStart(4, "0")}</span>`;
		const nextTarget = calcNextTarget(stats.totalViews);
		let targetText = "";
		if (nextTarget) {
			const diff = nextTarget - stats.totalViews;
			const targetDisplay = nextTarget >= 1e4 && nextTarget % 1e4 === 0 ? `${nextTarget / 1e4}万` : formatViews(nextTarget);
			targetText = `(距 ${targetDisplay} 差 ${formatViews(diff)})`;
		} else {
			targetText = "(已达成所有目标)";
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
		renderGrid(sections[TASK_TYPE.DAILY], container);
		renderTabs(sections, container);
	};
	const buildGridTaskCardHtml = (task, isClaim, isDone, progressColor, isClaiming = false) => `
    <div class="grid-title">${task.name.replace("当日", "").replace("直播间", "")}</div>
    <div class="grid-status">
        <span>${isDone ? "Finished" : `${task.cur} / ${task.total}`}</span>
        <span style="font-weight:bold; color:${isClaim ? "#faad14" : isDone ? "#aaa" : "#00aeec"}">
            ${isClaiming ? "领取中" : isClaim ? "待领" : isDone ? "✓" : "进行中"}
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
    ${task.type === TASK_TYPE.LIVE || task.type === TASK_TYPE.LOTTERY || task.type === TASK_TYPE.SUBMIT ? `
    <div class="full-progress"><div class="full-bar" style="width:${task.percent}%"></div></div>
    ` : ""}
`;
	const triggerTaskReload = () => {
		window.dispatchEvent(new CustomEvent("era:task-reload"));
	};
	const bindDailyTaskCardAction = (card, task, isClaim) => {
		const isClaimableDaily = task.type === TASK_TYPE.DAILY && isClaim;
		if (!isClaimableDaily) {
			card.target = "_blank";
			card.onclick = null;
			return;
		}
		card.target = "_self";
		card.onclick = async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const taskKey = String(task.id || "");
			if (!taskKey) {
				showTaskToast("任务ID缺失，无法领取", "error");
				return;
			}
			if (STATE.claimingTaskIds.has(taskKey)) {
				showTaskToast("正在领取中，请稍候...", "info", 1600);
				return;
			}
			STATE.claimingTaskIds.add(taskKey);
			showTaskToast(`正在领取：${task.name}`, "info", 1600);
			triggerTaskReload();
			try {
				const res = await claimMissionReward(task, STATE.taskContext);
				if (res.ok) {
					showTaskToast(`领取成功：${task.reward || task.name}`, "success");
				} else {
					showTaskToast(`领取失败：${res.message}`, res.type || "warning", 3800);
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
		if (!items.length && !STATE.activityInfo) {
			if (el) el.style.display = "none";
			return;
		}
		if (!el) {
			el = document.createElement("div");
			el.id = DOM_IDS.SEC_DAILY;
			el.innerHTML = `<div class="section-title">📅 每日必做</div><div class="era-grid"></div>`;
			container.appendChild(el);
		}
		el.style.display = "block";
		const grid = el.querySelector(".era-grid");
		items.forEach((t) => {
			const { isClaim, isDone } = getStatusFlags(t.status);
			const isClaiming = STATE.claimingTaskIds.has(String(t.id || ""));
			const pColor = isClaim ? "#45bd63" : isDone ? "#ddd" : "#00aeec";
			const html = buildGridTaskCardHtml(t, isClaim, isDone, pColor, isClaiming);
			const cls = `grid-card ${isClaim ? "status-claim" : ""} ${isDone ? "status-done" : ""}`;
			const hash = `${getTaskCardHash(t)}-${isClaiming ? 1 : 0}`;
			const card = upsertTaskAnchorCard({
				id: `${DOM_IDS.GRID_TASK_PREFIX}${t.id}`,
				container: grid,
				cls,
				hash,
				html,
				href: t.url
			});
			bindDailyTaskCardAction(card, t, isClaim);
		});
		renderSubmissionCard();
	};
	/** 渲染 Tabs 标签系统 */
	const renderTabs = (sections, container) => {
		let tabsWrapper = getById(DOM_IDS.SEC_TABS);
		if (!tabsWrapper) {
			tabsWrapper = document.createElement("div");
			tabsWrapper.id = DOM_IDS.SEC_TABS;
			const tabBar = document.createElement("div");
			tabBar.className = "era-tabs";
			TAB_DEFINITIONS.forEach((td) => {
				const btn = document.createElement("button");
				btn.className = `era-tab ${STATE.activeTab === td.key ? "active" : ""}`;
				btn.dataset.tab = td.key;
				btn.textContent = td.label;
				btn.onclick = () => switchTab(td.key);
				tabBar.appendChild(btn);
			});
			tabsWrapper.appendChild(tabBar);
			TAB_DEFINITIONS.forEach((td) => {
				const content = document.createElement("div");
				content.id = `${DOM_IDS.TAB_CONTENT_PREFIX}${td.key}`;
				content.className = `era-tab-content ${STATE.activeTab === td.key ? "active" : ""}`;
				tabsWrapper.appendChild(content);
			});
			container.appendChild(tabsWrapper);
		}
		renderTabList(TASK_TYPE.SUBMIT, sections[TASK_TYPE.SUBMIT]);
		renderSubmitTab();
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
		document.querySelectorAll(".era-tab").forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.tab === key);
		});
		document.querySelectorAll(".era-tab-content").forEach((el) => {
			el.classList.toggle("active", el.id === `${DOM_IDS.TAB_CONTENT_PREFIX}${key}`);
		});
		if (key === TASK_TYPE.SUBMIT) {
			refreshArchives();
		}
	};
	/** 渲染单个 Tab 内的列表 */
	const renderTabList = (tabKey, items) => {
		const content = getById(`${DOM_IDS.TAB_CONTENT_PREFIX}${tabKey}`);
		if (!content) return;
		items.forEach((t) => {
			const { isClaim, isDone } = getStatusFlags(t.status);
			const btnText = isClaim ? "领取" : isDone ? "已完成" : "去完成";
			const btnCls = isClaim ? "btn-claim" : "";
			const html = buildListTaskCardHtml(t, btnCls, btnText);
			const cls = `list-card ${isClaim ? "status-claim" : ""} ${isDone ? "status-done" : ""}`;
			const hash = getTaskCardHash(t);
			upsertTaskAnchorCard({
				id: `${DOM_IDS.LIST_TASK_PREFIX}${t.id}`,
				container: content,
				cls,
				hash,
				html,
				href: t.url
			});
		});
	};

//#endregion
//#region src/tasks.js
	const parseConfig = () => {
		const s = unsafeWindow.__initialState;
		if (!s) return [];
		const t = [];
		const p = (i) => i && i.taskId && t.push(i);
		if (s.EvaTaskButton) s.EvaTaskButton.forEach((i) => p(i.taskItem));
		if (s.EraTasklistPc) s.EraTasklistPc.forEach((c) => c.tasklist && c.tasklist.forEach(p));
		return t;
	};
	const pickString = (...vals) => vals.find((v) => typeof v === "string" && v.trim());
	const parseTaskContext = () => {
		const s = unsafeWindow.__initialState || {};
		const pageInfo = unsafeWindow.__BILIACT_PAGEINFO || {};
		const activityId = pickString(pageInfo.activity_id, s.activity_id, s.EraLotteryPc?.[0]?.config?.activity_id) || "";
		const activityName = pickString(pageInfo.title, pageInfo.shareTitle, s.BaseInfo?.title) || "";
		return {
			activityId,
			activityName
		};
	};
	const createTaskSections = () => ({
		[TASK_TYPE.DAILY]: [],
		[TASK_TYPE.SUBMIT]: [],
		[TASK_TYPE.LIVE]: [],
		[TASK_TYPE.LOTTERY]: []
	});
	const buildLotteryTaskItem = (conf, api) => {
		const cps = api.check_points || [];
		const ind = api.indicators?.[0] || {
			cur_value: 0,
			limit: 1
		};
		const max = cps.length ? cps[cps.length - 1].list[0].limit : ind.limit;
		const nextRw = cps.find((c) => c.status !== TASK_STATUS.DONE)?.award_name || "已完成";
		const done = cps.every((c) => c.status === TASK_STATUS.DONE);
		return {
			id: conf.taskId,
			name: conf.taskName,
			status: done ? TASK_STATUS.DONE : cps.some((c) => c.status === TASK_STATUS.CLAIMABLE) ? TASK_STATUS.CLAIMABLE : TASK_STATUS.PENDING,
			cur: ind.cur_value,
			total: max,
			reward: nextRw,
			percent: Math.min(100, ind.cur_value / max * 100),
			url: "#",
			type: TASK_TYPE.LOTTERY
		};
	};
	const buildLiveAccumulativeTaskItems = (api) => (api.accumulative_check_points || []).map((sub) => ({
		id: sub.sid,
		name: `累计直播 ${sub.list[0].limit} 天`,
		status: sub.status,
		cur: api.accumulative_count,
		total: sub.list[0].limit,
		reward: sub.award_name,
		percent: Math.min(100, api.accumulative_count / sub.list[0].limit * 100),
		url: buildAwardExchangeUrl(sub.sid),
		type: TASK_TYPE.LIVE
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
					taskId: conf.taskId || "",
					taskName: conf.taskName || "",
					rewardName: conf.awardName || ""
				}
			}
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
		if (str.includes("菲林")) {
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
				item.claimMeta.activityId = conf.activityId || taskContext.activityId || "";
				item.claimMeta.activityName = conf.activityName || taskContext.activityName || "";
			}
			if (!isDaily) {
				applySubmitProgressFromTaskName(item, conf.taskName);
			}
			item.percent = Math.min(100, item.cur / item.total * 100);
			if (isDaily) sections[TASK_TYPE.DAILY].push(item);
			else sections[TASK_TYPE.SUBMIT].push(item);
		});
		Object.values(sections).forEach(sortTaskSectionList);
		return sections;
	};

//#endregion
//#region src/app.js
	const init = () => {
		const div = document.createElement("div");
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
		pill.onclick = () => drawer.classList.toggle("hidden");
		getById(DOM_IDS.CLOSE_BTN).onclick = () => drawer.classList.add("hidden");
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
				const res = await fetchTaskTotals(getCookie("bili_jct"), ids);
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
	const start = async () => {
		init();
		window.addEventListener("era:task-reload", loop);
		setTimeout(() => {
			refreshLiveState(true);
			setInterval(() => refreshLiveState(true), LIVE_STATUS_POLL_MS);
			setInterval(updateLiveDurationTexts, LIVE_DURATION_TICK_MS);
		}, UI_TIMING.LIVE_BOOT_DELAY_MS);
		try {
			STATE.activityInfo = await fetchActivityId();
			if (STATE.activityInfo) {
				console.log("[任务助手] 匹配到活动:", STATE.activityInfo.name);
			} else {
				console.warn("[任务助手] 未匹配到当前页面的活动");
			}
		} catch (e) {
			console.error("[任务助手] 获取活动信息失败:", e);
		}
		setTimeout(() => {
			loop();
			setInterval(loop, UI_TIMING.TASK_LOOP_MS);
		}, UI_TIMING.TASK_BOOT_DELAY_MS);
		if (STATE.activityInfo) {
			setTimeout(() => refreshArchives(), UI_TIMING.ARCHIVES_BOOT_DELAY_MS);
		}
	};

//#endregion
//#region src/styles.js
	const STYLES = `
    :root {
        --era-bg: rgba(255, 255, 255, 0.95);
        --era-backdrop: blur(12px);
        --era-shadow: 0 8px 32px rgba(0,0,0,0.12);
        --era-radius: 12px;
        /* --era-primary: #00aeec; */
        --era-primary: var(--era-pink);
        --era-pink: #fb7299;
        --era-text: #2c3e50;
        --era-sub: #9499a0;
        --era-border: rgba(255,255,255,0.8);
        --era-green: #45bd63;
    }

    #era-drawer {
        position: fixed; top: 10%; right: 20px; width: 300px; max-height: 80vh;
        display: flex; flex-direction: column;
        background: var(--era-bg); backdrop-filter: var(--era-backdrop); -webkit-backdrop-filter: var(--era-backdrop);
        border-radius: var(--era-radius); box-shadow: var(--era-shadow); border: 1px solid var(--era-border);
        z-index: 999999; transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s;
        transform: translateX(0); opacity: 1;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
        min-height: 0;
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

    /* 大卡片 - 横跨两列 (样式重构 v5.2) */
    .grid-card-wide {
        grid-column: span 2;
        background: #fff; border: 1px solid rgba(0,0,0,0.05); border-radius: 8px;
        padding: 0 12px; display: flex; align-items: center; justify-content: space-between;
        text-decoration: none; color: inherit; position: relative; overflow: hidden; transition: all 0.2s;
        min-height: 52px;
    }
    .grid-card-wide.status-pending { background: #fff; border-color: rgba(0,0,0,0.05); }
    .grid-card-wide.status-done { background: #f4f5f7; border-color: rgba(0,0,0,0.05); opacity: 0.8; }
    .grid-card-wide:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }

    .wide-card-left { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
    .wide-card-title { font-size: 13px; font-weight: 700; color: #2c3e50; margin-bottom: 2px; }
    .wide-card-sub { font-size: 11px; color: #9499a0; }

    .wide-card-right { display: flex; align-items: center; gap: 8px; }
    .wide-card-icon { color: var(--era-sub); transition: color 0.2s; }
    .status-pending .wide-card-icon { color: #f05454; }
    .status-done .wide-card-icon { color: #45bd63; }
    
    .wide-card-refresh {
        width: 24px; height: 24px; border-radius: 50%;
        background: rgba(255,255,255,0.5); cursor: pointer; display: flex; align-items: center;
        justify-content: center; font-size: 12px; transition: all 0.2s; color: var(--era-sub);
    }
    .wide-card-refresh:hover { background: #fff; color: var(--era-primary); transform: rotate(180deg); }
    .wide-card-refresh.spinning { animation: spin 0.8s linear infinite; pointer-events: none; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* Tabs 标签栏 */
    .era-tabs {
        display: flex; gap: 0; margin: 12px 0 8px 0; border-bottom: 2px solid rgba(0,0,0,0.05);
    }
    .era-tab {
        flex: 1; text-align: center; padding: 8px 4px; font-size: 12px; font-weight: 600;
        color: var(--era-sub); cursor: pointer; position: relative; transition: color 0.2s;
        user-select: none; border: none; background: none; outline: none;
    }
    .era-tab:hover { color: var(--era-text); }
    .era-tab.active { color: var(--era-primary); }
    .era-tab.active::after {
        content: ''; position: absolute; bottom: -2px; left: 20%; right: 20%;
        height: 2px; background: var(--era-primary); border-radius: 1px;
    }
    .era-tab-content { display: none; }
    .era-tab-content.active { display: block; }

    /* 投稿统计 Banner (样式重构 v5.2 + v5.3) */
    .submit-stats-banner {
        background: #fff;
        border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;
        border: 1px solid rgba(0,0,0,0.03); box-shadow: 0 1px 2px rgba(0,0,0,0.03);
        display: flex; justify-content: space-between; align-items: center;
        min-height: 80px; /* v5.3 防止加载跳动 */
        box-sizing: border-box;
    }
    .task-reminder-banner {
        display: none;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.08);
        background: linear-gradient(135deg, #fff8e9, #fff3dc);
        color: #8d5200;
        line-height: 1.35;
        font-size: 11px;
    }
    .task-reminder-banner.warn {
        border-color: rgba(255, 196, 97, 0.68);
        background: linear-gradient(135deg, #fff8e9, #fff3dc);
        color: #8d5200;
    }
    .task-reminder-tag {
        flex-shrink: 0;
        font-weight: 700;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 10px;
        background: rgba(255, 170, 70, 0.2);
        border: 1px solid rgba(255, 170, 70, 0.35);
    }
    .task-reminder-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .stats-group { display: flex; flex-direction: column; }
    .stats-group.left { align-items: flex-start; }
    .stats-group.right { align-items: flex-end; text-align: right; }
    
    .stats-label { font-size: 11px; color: var(--era-sub); margin-bottom: 2px; }
    .stats-value-main { font-weight: 700; color: var(--era-text); font-family: "DingTalk Sans", "Roboto", sans-serif; font-size: 14px; }
    .stats-value-sub { font-size: 10px; color: var(--era-sub); margin-top: 2px; }
    
    .highlight-num { color: var(--era-primary); font-weight: 800; font-size: 16px; margin-right: 2px; font-family: "DingTalk Sans", sans-serif; }
    
    .era-icon { width: 18px; height: 18px; display: block; }


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
    .list-progress-text { color: var(--era-sub); margin-left: 2px; }

    .list-btn {
        font-size: 11px; padding: 3px 8px; border-radius: 12px; background: #f4f5f7; color: var(--era-sub);
        font-weight: 600; margin-left: 10px; flex-shrink: 0; white-space: nowrap;
    }

    .status-claim { background: #fffbe6; border-color: #ffe58f; }
    .btn-claim { background: var(--era-pink); color: #fff; }
    .status-done { opacity: 0.6; filter: grayscale(1); }

    .full-progress { margin-top: 8px; height: 4px; background: #f0f0f0; border-radius: 2px; overflow:hidden; }
    .full-bar { height: 100%; background: var(--era-primary); border-radius: 2px; transition: width 0.4s; }

    /* 直播状态卡片 */
    .tab-live-card {
        background: rgba(255,255,255,0.75);
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.05);
        box-shadow: 0 1px 2px rgba(0,0,0,0.02);
        padding: 10px 12px;
        margin-bottom: 10px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
            "head action"
            "area dur"
            "sync sync";
        align-items: center;
        row-gap: 2px;
        column-gap: 8px;
    }
    .tab-live-card.live-on {
        border-color: rgba(69, 189, 99, 0.32);
        background: rgba(69, 189, 99, 0.08);
    }
    .tab-live-card.live-off {
        border-color: rgba(0,0,0,0.05);
        background: #f4f5f7;
    }
    .live-card-head {
        grid-area: head;
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 6px;
    }
    .live-state-text {
        font-size: 12px;
        color: #7d8591;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #c9cdd4;
    }
    .live-dot.on {
        background: #45bd63;
        box-shadow: 0 0 0 4px rgba(69, 189, 99, 0.16);
    }
    .live-dot.off {
        background: #a9b0bb;
        box-shadow: 0 0 0 4px rgba(169, 176, 187, 0.18);
    }
    .live-card-area {
        grid-area: area;
        font-size: 11px;
        color: var(--era-sub);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
    }
    .live-card-sync {
        grid-area: sync;
        font-size: 10px;
        color: #8f96a0;
        line-height: 1.35;
    }
    .live-duration-line {
        grid-area: dur;
        text-align: right;
        min-width: 92px;
        font-size: 11px;
        color: var(--era-sub);
        white-space: nowrap;
    }
    .live-duration-line .label {
        margin-right: 4px;
    }
    .live-duration-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--era-text);
        font-family: "DingTalk Sans", "Roboto", sans-serif;
    }
    .live-action-btn {
        grid-area: action;
        border: 1px solid transparent;
        border-radius: 12px;
        height: 26px;
        min-width: 52px;
        width: auto;
        justify-self: end;
        align-self: center;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.2s;
        color: #fff;
    }
    .live-action-btn:hover {
        transform: translateY(-1px);
    }
    .live-action-btn:disabled {
        cursor: not-allowed;
        opacity: 0.65;
        transform: none;
    }
    .live-action-btn.start {
        background: #f4f5f7;
        border-color: rgba(0,0,0,0.06);
        color: #7d8591;
    }
    .live-action-btn.stop {
        background: #3ead5f;
        border-color: rgba(48, 140, 78, 0.5);
        color: #fff;
    }
    .live-action-btn.start:hover {
        background: #eceef1;
    }
    .live-action-btn.stop:hover {
        background: #389f56;
    }

    /* 直播分区选择弹窗 */
    #era-live-area-overlay,
    #era-live-auth-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 1000000;
    }
    #era-live-area-modal,
    #era-live-auth-modal {
        display: none;
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.22);
        z-index: 1000001;
        width: 360px;
        max-width: calc(100vw - 30px);
        box-sizing: border-box;
        padding: 16px;
    }
    #era-live-area-modal h3,
    #era-live-auth-modal h3 {
        margin: 2px 0 12px 0;
        font-size: 16px;
        color: var(--era-text);
    }
    .era-live-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
    }
    .era-live-row label {
        width: 58px;
        flex-shrink: 0;
        font-size: 12px;
        color: var(--era-sub);
        text-align: right;
    }
    .era-live-row select {
        flex: 1;
        border: 1px solid rgba(0,0,0,0.12);
        border-radius: 6px;
        height: 30px;
        padding: 0 8px;
        font-size: 12px;
        color: var(--era-text);
        background: #fff;
    }
    .era-live-history {
        margin-bottom: 12px;
    }
    .era-live-history-title {
        font-size: 12px;
        color: var(--era-sub);
        margin-bottom: 6px;
    }
    .era-live-history-list {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        min-height: 24px;
    }
    .era-live-history-btn {
        border: 1px solid rgba(251, 114, 153, 0.35);
        color: #d6467d;
        background: #fff;
        border-radius: 12px;
        font-size: 11px;
        line-height: 1;
        padding: 5px 8px;
        cursor: pointer;
    }
    .era-live-history-empty {
        font-size: 11px;
        color: #a7adb5;
    }
    .era-live-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
    }
    .era-live-modal-actions button {
        border: none;
        border-radius: 7px;
        height: 32px;
        min-width: 68px;
        padding: 0 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
    }
    #era-live-start-confirm {
        background: #fb7299;
        color: #fff;
    }
    #era-live-start-cancel,
    #era-live-auth-cancel {
        background: #edf0f4;
        color: #4f5d75;
    }
    #era-live-auth-retry {
        background: #fb7299;
        color: #fff;
    }

    #era-live-auth-modal p {
        margin: 0 0 10px 0;
        font-size: 12px;
        color: var(--era-sub);
    }
    #era-live-auth-qrcode {
        width: 200px;
        height: 200px;
        margin: 4px auto 12px auto;
        border: 1px solid rgba(0,0,0,0.1);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fafafa;
    }
    #era-live-auth-qrcode canvas,
    #era-live-auth-qrcode img {
        width: 180px !important;
        height: 180px !important;
    }
    /* 直播操作提示 */
    #era-live-toast {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 1000002;
        min-width: 240px;
        max-width: 340px;
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.08);
        background: #fff;
        color: var(--era-text);
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
    }
    #era-live-toast.info {
        border-color: rgba(45, 123, 229, 0.28);
    }
    #era-live-toast.success {
        border-color: rgba(69, 189, 99, 0.35);
    }
    #era-live-toast.warning {
        border-color: rgba(250, 173, 20, 0.42);
    }
    #era-live-toast.error {
        border-color: rgba(245, 84, 84, 0.42);
    }

    .era-footer { padding: 8px; text-align: center; font-size: 10px; color: var(--era-sub); border-top: 1px solid rgba(0,0,0,0.05); }
    .highlight-flash { animation: flash 0.6s ease-out; }
    @keyframes flash { 0% { background: rgba(250, 173, 20, 0.2); } 100% { background: inherit; } }
`;
	const injectStyles = () => {
		GM_addStyle(STYLES);
	};

//#endregion
//#region src/index.js
	injectStyles();
	start();

//#endregion
})();