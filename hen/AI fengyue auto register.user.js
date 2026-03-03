// ==UserScript==
// @name         AI风月 自动注册助手
// @namespace    https://github.com/owwkmidream/UserScripts
// @version      2.0.9
// @description  自动生成临时邮箱、账户名和密码，自动获取验证码，完成 AI风月 网站注册
// @author       owwkmidream
// @match        https://dearestie.xyz/*
// @match        https://acquainte.xyz/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      mail.chatgpt.org.uk
// @license      MIT
// @run-at       document-end
// ==/UserScript==

(function() {


//#region src/constants.js
	const CONFIG = {
		API_BASE: "https://mail.chatgpt.org.uk/api",
		DEFAULT_API_KEY: "gpt-test",
		STORAGE_KEYS: {
			API_KEY: "gptmail_api_key",
			CURRENT_EMAIL: "current_temp_email",
			GENERATED_PASSWORD: "generated_password",
			GENERATED_USERNAME: "generated_username",
			REGISTRATION_START_TIME: "registration_start_time",
			API_USAGE_COUNT: "api_usage_count",
			API_USAGE_RESET_DATE: "api_usage_reset_date",
			LOG_DEBUG_ENABLED: "aifengyue_log_debug_enabled",
			AUTO_RELOAD_ENABLED: "aifengyue_auto_reload_enabled",
			MODEL_SORT_ENABLED: "aifengyue_model_sort_enabled",
			SIDEBAR_LAYOUT_MODE: "aifengyue_sidebar_layout_mode",
			SIDEBAR_THEME: "aifengyue_sidebar_theme",
			SIDEBAR_DEFAULT_TAB: "aifengyue_sidebar_default_tab",
			SIDEBAR_DEFAULT_OPEN: "aifengyue_sidebar_default_open"
		},
		API_QUOTA_LIMIT: 1e3,
		VERIFICATION_CODE_PATTERNS: [
			/验证码[：:]\s*(\d{4,8})/,
			/code[：:]\s*(\d{4,8})/i,
			/(\d{4,8})\s*(?:是|为)?(?:您的)?验证码/,
			/Your (?:verification )?code is[：:\s]*(\d{4,8})/i,
			/完成注册[：:]\s*(\d{4,8})/,
			/registration[：:\s]*(\d{4,8})/i
		]
	};
	const SIDEBAR_INITIAL_STATE = {
		email: "",
		username: "",
		password: "",
		status: "idle",
		statusMessage: "等待操作...",
		pollCount: 0,
		verificationCode: ""
	};

//#endregion
//#region src/state.js
	const APP_STATE = {
		refs: {
			toast: null,
			sidebar: null,
			autoRegister: null,
			iframeExtractor: null,
			modelPopupSorter: null
		},
		sidebar: { state: { ...SIDEBAR_INITIAL_STATE } },
		spa: {
			observer: null,
			lastUrl: "",
			checkScheduled: false
		}
	};

//#endregion
//#region src/gm.js
	const gmGetValue = (key, defaultValue) => GM_getValue(key, defaultValue);
	const gmSetValue = (key, value) => GM_setValue(key, value);
	const gmRegisterMenuCommand = (name, handler) => GM_registerMenuCommand(name, handler);
	const gmXmlHttpRequest = (options) => GM_xmlhttpRequest(options);
	const gmAddStyle = (styles) => GM_addStyle(styles);
	function parseHeaders(rawHeaders) {
		const headers = {};
		const lines = (rawHeaders || "").split(/\r?\n/);
		for (const line of lines) {
			if (!line) continue;
			const idx = line.indexOf(":");
			if (idx <= 0) continue;
			const key = line.slice(0, idx).trim().toLowerCase();
			const value = line.slice(idx + 1).trim();
			if (key) headers[key] = value;
		}
		return headers;
	}
	function gmRequest(options) {
		return new Promise((resolve, reject) => {
			gmXmlHttpRequest({
				...options,
				anonymous: options.anonymous ?? true,
				onload: (response) => resolve(response),
				onerror: (error) => reject(new Error(error?.error || "GM 请求失败")),
				ontimeout: () => reject(new Error("GM 请求超时")),
				onabort: () => reject(new Error("GM 请求已中止"))
			});
		});
	}
	async function gmRequestJson(options) {
		const method = options.method || "GET";
		const hasRawBody = typeof options.rawBody === "string";
		const response = await gmRequest({
			method,
			url: options.url,
			headers: options.headers || {},
			data: hasRawBody ? options.rawBody : options.body === undefined ? undefined : JSON.stringify(options.body),
			timeout: options.timeout ?? 3e4,
			anonymous: options.anonymous ?? true
		});
		const raw = response.responseText || "";
		let json = null;
		if (raw) {
			try {
				json = JSON.parse(raw);
			} catch {
				json = null;
			}
		}
		return {
			status: response.status || 0,
			statusText: response.statusText || "",
			headers: parseHeaders(response.responseHeaders || ""),
			raw,
			json
		};
	}

//#endregion
//#region src/services/api-service.js
	const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$2 = 3;
	const ApiService = {
		getApiKey() {
			return gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, CONFIG.DEFAULT_API_KEY);
		},
		setApiKey(key) {
			gmSetValue(CONFIG.STORAGE_KEYS.API_KEY, key);
			this.resetUsageCount();
		},
		getUsageCount() {
			return gmGetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, 0);
		},
		incrementUsageCount() {
			const count = this.getUsageCount() + 1;
			gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, count);
			APP_STATE.refs.sidebar?.updateUsageDisplay();
			return count;
		},
		resetUsageCount() {
			gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, 0);
			gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_RESET_DATE, new Date().toISOString());
			APP_STATE.refs.sidebar?.updateUsageDisplay();
		},
		getRemainingQuota() {
			return CONFIG.API_QUOTA_LIMIT - this.getUsageCount();
		},
		isQuotaExceeded() {
			return this.getUsageCount() >= CONFIG.API_QUOTA_LIMIT;
		},
		resolveRetryAttempts(maxAttempts) {
			const parsed = Number(maxAttempts);
			if (Number.isInteger(parsed) && parsed >= 1) {
				return parsed;
			}
			return DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$2;
		},
		isObjectiveRetryError(error) {
			const message = String(error?.message || "").toLowerCase();
			if (!message) return false;
			return message.includes("timeout") || message.includes("超时") || message.includes("network") || message.includes("网络") || message.includes("failed") || message.includes("中止") || message.includes("abort");
		},
		async request(endpoint, options = {}) {
			const attempts = this.resolveRetryAttempts(options.maxAttempts);
			let lastError = null;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					return await this.requestOnce(endpoint, options);
				} catch (error) {
					lastError = error;
					const hasNext = attempt < attempts;
					if (!hasNext || !this.isObjectiveRetryError(error)) {
						throw error;
					}
					const waitMs = 700 * attempt;
					await new Promise((resolve) => setTimeout(resolve, waitMs));
				}
			}
			throw lastError || new Error("请求失败");
		},
		requestOnce(endpoint, options = {}) {
			return new Promise((resolve, reject) => {
				if (this.isQuotaExceeded()) {
					reject(new Error(`API 配额已用完 (${this.getUsageCount()}/${CONFIG.API_QUOTA_LIMIT})`));
					return;
				}
				const url = `${CONFIG.API_BASE}${endpoint}`;
				gmXmlHttpRequest({
					method: options.method || "GET",
					url,
					anonymous: true,
					headers: {
						"X-API-Key": this.getApiKey(),
						"Content-Type": "application/json",
						...options.headers
					},
					data: options.body ? JSON.stringify(options.body) : undefined,
					timeout: options.timeout ?? 3e4,
					onload: (response) => {
						try {
							const data = JSON.parse(response.responseText);
							if (data.success) {
								this.incrementUsageCount();
								resolve(data.data);
							} else {
								reject(new Error(data.error || "请求失败"));
							}
						} catch {
							reject(new Error("解析响应失败"));
						}
					},
					onerror: (error) => {
						reject(new Error(error?.error || "网络请求失败"));
					},
					ontimeout: () => {
						reject(new Error("网络请求超时"));
					},
					onabort: () => {
						reject(new Error("网络请求被中止"));
					}
				});
			});
		},
		async generateEmail() {
			const data = await this.request("/generate-email");
			return data.email;
		},
		async getEmails(email) {
			const data = await this.request(`/emails?email=${encodeURIComponent(email)}`);
			return data.emails || [];
		}
	};

//#endregion
//#region src/services/chat-history-store.js
	const DB_NAME = "aifengyue_chat_store_v1";
	const DB_VERSION = 1;
	const STORE_APPS = "apps";
	const STORE_CHAINS = "chains";
	const STORE_MESSAGES = "messages";
	let dbPromise = null;
	function requestToPromise(request) {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败"));
		});
	}
	function txDone(tx) {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error || new Error("IndexedDB 事务失败"));
			tx.onabort = () => reject(tx.error || new Error("IndexedDB 事务中止"));
		});
	}
	function ensureIndexedDbAvailable() {
		if (typeof indexedDB === "undefined") {
			throw new Error("当前环境不支持 IndexedDB");
		}
	}
	function openDb() {
		ensureIndexedDbAvailable();
		if (dbPromise) return dbPromise;
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_APPS)) {
					const appStore = db.createObjectStore(STORE_APPS, { keyPath: "appId" });
					appStore.createIndex("updatedAt", "updatedAt", { unique: false });
				}
				if (!db.objectStoreNames.contains(STORE_CHAINS)) {
					const chainStore = db.createObjectStore(STORE_CHAINS, { keyPath: "chainId" });
					chainStore.createIndex("appId", "appId", { unique: false });
					chainStore.createIndex("updatedAt", "updatedAt", { unique: false });
				}
				if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
					const messageStore = db.createObjectStore(STORE_MESSAGES, { keyPath: "storeKey" });
					messageStore.createIndex("appId", "appId", { unique: false });
					messageStore.createIndex("chainId", "chainId", { unique: false });
					messageStore.createIndex("conversationId", "conversationId", { unique: false });
					messageStore.createIndex("chainId_createdAt", ["chainId", "createdAt"], { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
		});
		return dbPromise;
	}
	async function withStore(storeName, mode, handler) {
		const db = await openDb();
		const tx = db.transaction(storeName, mode);
		const store = tx.objectStore(storeName);
		const result = await handler(store, tx);
		await txDone(tx);
		return result;
	}
	const ChatHistoryStore = {
		DB_NAME,
		DB_VERSION,
		STORE_APPS,
		STORE_CHAINS,
		STORE_MESSAGES,
		async upsertApp(appRecord) {
			return withStore(STORE_APPS, "readwrite", async (store) => {
				await requestToPromise(store.put(appRecord));
				return appRecord;
			});
		},
		async getApp(appId) {
			return withStore(STORE_APPS, "readonly", (store) => requestToPromise(store.get(appId)));
		},
		async upsertChain(chainRecord) {
			return withStore(STORE_CHAINS, "readwrite", async (store) => {
				await requestToPromise(store.put(chainRecord));
				return chainRecord;
			});
		},
		async getChain(chainId) {
			return withStore(STORE_CHAINS, "readonly", (store) => requestToPromise(store.get(chainId)));
		},
		async listChainsByApp(appId) {
			return withStore(STORE_CHAINS, "readonly", (store) => new Promise((resolve, reject) => {
				const list = [];
				const index = store.index("appId");
				const request = index.openCursor(IDBKeyRange.only(appId));
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) {
						resolve(list);
						return;
					}
					list.push(cursor.value);
					cursor.continue();
				};
				request.onerror = () => reject(request.error || new Error("读取链路失败"));
			}));
		},
		async listAllChains() {
			return withStore(STORE_CHAINS, "readonly", (store) => new Promise((resolve, reject) => {
				const list = [];
				const request = store.openCursor();
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) {
						resolve(list);
						return;
					}
					list.push(cursor.value);
					cursor.continue();
				};
				request.onerror = () => reject(request.error || new Error("读取全部链路失败"));
			}));
		},
		async putMessages(records) {
			if (!Array.isArray(records) || records.length === 0) return 0;
			return withStore(STORE_MESSAGES, "readwrite", async (store) => {
				for (const record of records) {
					await requestToPromise(store.put(record));
				}
				return records.length;
			});
		},
		async listMessagesByChain(chainId) {
			return withStore(STORE_MESSAGES, "readonly", (store) => new Promise((resolve, reject) => {
				const list = [];
				const index = store.index("chainId_createdAt");
				const range = IDBKeyRange.bound([chainId, Number.NEGATIVE_INFINITY], [chainId, Number.POSITIVE_INFINITY]);
				const request = index.openCursor(range);
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) {
						resolve(list);
						return;
					}
					list.push(cursor.value);
					cursor.continue();
				};
				request.onerror = () => reject(request.error || new Error("读取消息失败"));
			}));
		},
		async deleteChain(chainId) {
			return withStore(STORE_CHAINS, "readwrite", async (store) => {
				await requestToPromise(store.delete(chainId));
				return true;
			});
		},
		async deleteMessagesByChain(chainId) {
			return withStore(STORE_MESSAGES, "readwrite", (store) => new Promise((resolve, reject) => {
				let deletedCount = 0;
				const index = store.index("chainId");
				const request = index.openCursor(IDBKeyRange.only(chainId));
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) {
						resolve(deletedCount);
						return;
					}
					const deleteRequest = cursor.delete();
					deleteRequest.onsuccess = () => {
						deletedCount += 1;
						cursor.continue();
					};
					deleteRequest.onerror = () => reject(deleteRequest.error || new Error("删除会话消息失败"));
				};
				request.onerror = () => reject(request.error || new Error("读取待删除会话消息失败"));
			}));
		},
		async listMessagesByConversation(conversationId) {
			return withStore(STORE_MESSAGES, "readonly", (store) => new Promise((resolve, reject) => {
				const list = [];
				const index = store.index("conversationId");
				const request = index.openCursor(IDBKeyRange.only(conversationId));
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) {
						resolve(list);
						return;
					}
					list.push(cursor.value);
					cursor.continue();
				};
				request.onerror = () => reject(request.error || new Error("读取会话消息失败"));
			}));
		}
	};

//#endregion
//#region src/services/chat-history-service.js
	const INDEX_KEY = "aifengyue_chat_index_v1";
	function normalizeId(value) {
		return typeof value === "string" ? value.trim() : "";
	}
	function normalizeTimestamp$1(value) {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string" && value.trim()) {
			const asNumber = Number(value);
			if (Number.isFinite(asNumber)) return asNumber;
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 0;
	}
	function decodeEscapedText$2(raw) {
		if (typeof raw !== "string") return "";
		let value = raw;
		for (let i = 0; i < 3; i++) {
			if (!/\\u[0-9a-fA-F]{4}|\\[nrt"\\/]/.test(value)) {
				break;
			}
			try {
				const next = JSON.parse(`"${value.replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`);
				if (next === value) break;
				value = next;
			} catch {
				break;
			}
		}
		return value;
	}
	function makeConversationKey(appId, conversationId) {
		return `${appId}::${conversationId}`;
	}
	function createChainId(appId) {
		const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return `chain-${appId}-${suffix}`;
	}
	function uniqueStringArray(values) {
		const output = [];
		const seen = new Set();
		for (const value of values || []) {
			const normalized = normalizeId(value);
			if (!normalized || seen.has(normalized)) continue;
			seen.add(normalized);
			output.push(normalized);
		}
		return output;
	}
	function readIndex() {
		const fallback = {
			activeChainByAppId: {},
			conversationToChain: {},
			conversationTokenByKey: {},
			lastSyncByChainId: {}
		};
		const raw = localStorage.getItem(INDEX_KEY);
		if (!raw) return fallback;
		try {
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return fallback;
			}
			return {
				activeChainByAppId: parsed.activeChainByAppId && typeof parsed.activeChainByAppId === "object" ? { ...parsed.activeChainByAppId } : {},
				conversationToChain: parsed.conversationToChain && typeof parsed.conversationToChain === "object" ? { ...parsed.conversationToChain } : {},
				conversationTokenByKey: parsed.conversationTokenByKey && typeof parsed.conversationTokenByKey === "object" ? { ...parsed.conversationTokenByKey } : {},
				lastSyncByChainId: parsed.lastSyncByChainId && typeof parsed.lastSyncByChainId === "object" ? { ...parsed.lastSyncByChainId } : {}
			};
		} catch {
			return fallback;
		}
	}
	function writeIndex(index) {
		localStorage.setItem(INDEX_KEY, JSON.stringify(index));
	}
	function escapeHtml(text) {
		return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}
	function formatTime(value) {
		const ts = normalizeTimestamp$1(value);
		if (!ts) return "-";
		try {
			return new Date(ts * (ts > 0xe8d4a51000 ? 1 : 1e3)).toLocaleString();
		} catch {
			return String(value);
		}
	}
	function asDisplayContent(value) {
		if (value === null || value === undefined) return "";
		if (typeof value === "string") return decodeEscapedText$2(value);
		return String(value);
	}
	function looksLikeHtml(value) {
		return /<\/?[a-z][\s\S]*>/i.test(value);
	}
	function uniqueTextArray(values) {
		const output = [];
		const seen = new Set();
		for (const value of values || []) {
			if (typeof value !== "string") continue;
			if (!value) continue;
			if (seen.has(value)) continue;
			seen.add(value);
			output.push(value);
		}
		return output;
	}
	function isPrefixBoundary(rest) {
		if (!rest) return true;
		return /^[\s\r\n\u00a0:：,，.。!！?？;；、\-—]/.test(rest);
	}
	function trimPrefixConnectors(text) {
		return String(text || "").replace(/^[\s\r\n\u00a0]+/, "").replace(/^[：:，,。.!！？?；;、\-—]+/, "").replace(/^[\s\r\n\u00a0]+/, "");
	}
	function stripDuplicatedAnswerPrefix(queryText, answerHistory) {
		const source = asDisplayContent(queryText);
		if (!source) {
			return {
				text: "",
				removedPrefix: ""
			};
		}
		const candidates = uniqueTextArray(answerHistory).sort((a, b) => b.length - a.length);
		for (const candidate of candidates) {
			if (!candidate) continue;
			if (!source.startsWith(candidate)) continue;
			const rest = source.slice(candidate.length);
			if (!isPrefixBoundary(rest)) continue;
			return {
				text: trimPrefixConnectors(rest),
				removedPrefix: candidate
			};
		}
		return {
			text: source,
			removedPrefix: ""
		};
	}
	function renderMessageBody(text, emptyPlaceholder = "(空)") {
		const normalized = asDisplayContent(text);
		if (!normalized) {
			return `<pre class="af-plain" style="white-space: pre-wrap !important;">${escapeHtml(emptyPlaceholder)}</pre>`;
		}
		if (looksLikeHtml(normalized)) {
			const normalizedHtml = normalizeLineBreakTokens(normalized);
			return `<div class="markdown-body false" style="font-size:14px;white-space:pre-wrap;">${normalizedHtml}</div>`;
		}
		const plainText = normalizeLineBreakTokens(normalized);
		return `<pre class="af-plain" style="white-space: pre-wrap !important;">${escapeHtml(plainText)}</pre>`;
	}
	function normalizeLineBreakTokens(text) {
		let value = String(text ?? "");
		for (let i = 0; i < 4; i++) {
			const next = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\\+r\\+n/g, "\n").replace(/\\+n/g, "\n").replace(/\\+r/g, "\n");
			if (next === value) {
				break;
			}
			value = next;
		}
		return value;
	}
	function extractLatestQueryTail(records, tailLength = 28) {
		if (!Array.isArray(records) || records.length === 0) return "";
		for (let i = records.length - 1; i >= 0; i--) {
			const record = records[i];
			const rawMessage = record?.rawMessage && typeof record.rawMessage === "object" ? record.rawMessage : {};
			const query = asDisplayContent(rawMessage.query ?? record?.query ?? "");
			if (!hasMeaningfulText(query)) continue;
			const singleLine = normalizeLineBreakTokens(query).replace(/\s+/g, " ").trim();
			if (!singleLine) continue;
			return singleLine.length > tailLength ? `...${singleLine.slice(-tailLength)}` : singleLine;
		}
		return "";
	}
	function cloneJsonCompatible(value, fallback = null) {
		try {
			return JSON.parse(JSON.stringify(value));
		} catch {
			return fallback;
		}
	}
	function hasMeaningfulText(value) {
		const normalized = asDisplayContent(value).trim().toLowerCase();
		if (!normalized) return false;
		if (normalized === "null" || normalized === "undefined" || normalized === "\"\"" || normalized === "''") {
			return false;
		}
		return true;
	}
	function toChainRecord(base, extras = {}) {
		return {
			chainId: normalizeId(base.chainId),
			appId: normalizeId(base.appId),
			conversationIds: uniqueStringArray(base.conversationIds),
			createdAt: Number(base.createdAt || Date.now()),
			updatedAt: Number(base.updatedAt || Date.now()),
			...extras
		};
	}
	const ChatHistoryService = {
		INDEX_KEY,
		readIndexSnapshot() {
			return readIndex();
		},
		getConversationChainId(appId, conversationId) {
			const normalizedAppId = normalizeId(appId);
			const normalizedConversationId = normalizeId(conversationId);
			if (!normalizedAppId || !normalizedConversationId) return "";
			const index = readIndex();
			const key = makeConversationKey(normalizedAppId, normalizedConversationId);
			return normalizeId(index.conversationToChain[key]);
		},
		setConversationChainId(appId, conversationId, chainId) {
			const normalizedAppId = normalizeId(appId);
			const normalizedConversationId = normalizeId(conversationId);
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedAppId || !normalizedConversationId || !normalizedChainId) return "";
			const index = readIndex();
			index.conversationToChain[makeConversationKey(normalizedAppId, normalizedConversationId)] = normalizedChainId;
			writeIndex(index);
			return normalizedChainId;
		},
		getConversationTokenSignature(appId, conversationId) {
			const normalizedAppId = normalizeId(appId);
			const normalizedConversationId = normalizeId(conversationId);
			if (!normalizedAppId || !normalizedConversationId) return "";
			const index = readIndex();
			const key = makeConversationKey(normalizedAppId, normalizedConversationId);
			return normalizeId(index.conversationTokenByKey[key]);
		},
		setConversationTokenSignature(appId, conversationId, tokenSignature) {
			const normalizedAppId = normalizeId(appId);
			const normalizedConversationId = normalizeId(conversationId);
			if (!normalizedAppId || !normalizedConversationId) return "";
			const normalizedTokenSignature = normalizeId(tokenSignature);
			const index = readIndex();
			const key = makeConversationKey(normalizedAppId, normalizedConversationId);
			if (normalizedTokenSignature) {
				index.conversationTokenByKey[key] = normalizedTokenSignature;
			} else {
				delete index.conversationTokenByKey[key];
			}
			writeIndex(index);
			return normalizedTokenSignature;
		},
		getActiveChainId(appId) {
			const normalizedAppId = normalizeId(appId);
			if (!normalizedAppId) return "";
			const index = readIndex();
			return normalizeId(index.activeChainByAppId[normalizedAppId]);
		},
		setActiveChainId(appId, chainId) {
			const normalizedAppId = normalizeId(appId);
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedAppId || !normalizedChainId) return "";
			const index = readIndex();
			index.activeChainByAppId[normalizedAppId] = normalizedChainId;
			writeIndex(index);
			return normalizedChainId;
		},
		markChainSynced(chainId, syncedAt = Date.now()) {
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedChainId) return 0;
			const index = readIndex();
			index.lastSyncByChainId[normalizedChainId] = Number(syncedAt) || Date.now();
			writeIndex(index);
			return index.lastSyncByChainId[normalizedChainId];
		},
		getChainLastSync(chainId) {
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedChainId) return 0;
			const index = readIndex();
			return Number(index.lastSyncByChainId[normalizedChainId] || 0);
		},
		async upsertAppMeta({ appId, name, description, builtInCss }) {
			const normalizedAppId = normalizeId(appId);
			if (!normalizedAppId) {
				throw new Error("appId 为空，无法保存应用元数据");
			}
			const existing = await ChatHistoryStore.getApp(normalizedAppId);
			const now = Date.now();
			const record = {
				appId: normalizedAppId,
				name: asDisplayContent(name),
				description: asDisplayContent(description),
				builtInCss: asDisplayContent(builtInCss),
				createdAt: Number(existing?.createdAt || now),
				updatedAt: now
			};
			await ChatHistoryStore.upsertApp(record);
			return record;
		},
		async getAppMeta(appId) {
			const normalizedAppId = normalizeId(appId);
			if (!normalizedAppId) return null;
			return ChatHistoryStore.getApp(normalizedAppId);
		},
		async getChain(chainId) {
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedChainId) return null;
			const chain = await ChatHistoryStore.getChain(normalizedChainId);
			if (!chain) return null;
			return toChainRecord(chain);
		},
		async listChainsForApp(appId) {
			const normalizedAppId = normalizeId(appId);
			if (!normalizedAppId) return [];
			const chains = await ChatHistoryStore.listChainsByApp(normalizedAppId);
			return (chains || []).map((chain) => toChainRecord(chain)).sort((a, b) => {
				const updatedDiff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
				if (updatedDiff !== 0) return updatedDiff;
				return Number(b.createdAt || 0) - Number(a.createdAt || 0);
			});
		},
		async listAllChains() {
			const chains = await ChatHistoryStore.listAllChains();
			return (chains || []).map((chain) => toChainRecord(chain)).sort((a, b) => {
				const updatedDiff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
				if (updatedDiff !== 0) return updatedDiff;
				return Number(b.createdAt || 0) - Number(a.createdAt || 0);
			});
		},
		async deleteChain(chainId) {
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedChainId) {
				throw new Error("chainId 为空，无法删除链路");
			}
			const chain = await this.getChain(normalizedChainId);
			if (!chain) {
				return {
					deleted: false,
					chainId: normalizedChainId,
					appId: "",
					deletedMessageCount: 0,
					removedConversationMappingCount: 0
				};
			}
			const deletedMessageCount = await ChatHistoryStore.deleteMessagesByChain(normalizedChainId);
			await ChatHistoryStore.deleteChain(normalizedChainId);
			const index = readIndex();
			let removedConversationMappingCount = 0;
			for (const [key, mappedChainId] of Object.entries(index.conversationToChain || {})) {
				if (normalizeId(mappedChainId) !== normalizedChainId) continue;
				delete index.conversationToChain[key];
				if (index.conversationTokenByKey && Object.prototype.hasOwnProperty.call(index.conversationTokenByKey, key)) {
					delete index.conversationTokenByKey[key];
				}
				removedConversationMappingCount += 1;
			}
			for (const [appId, activeChainId] of Object.entries(index.activeChainByAppId || {})) {
				if (normalizeId(activeChainId) === normalizedChainId) {
					delete index.activeChainByAppId[appId];
				}
			}
			if (index.lastSyncByChainId && Object.prototype.hasOwnProperty.call(index.lastSyncByChainId, normalizedChainId)) {
				delete index.lastSyncByChainId[normalizedChainId];
			}
			writeIndex(index);
			return {
				deleted: true,
				chainId: normalizedChainId,
				appId: normalizeId(chain.appId),
				deletedMessageCount,
				removedConversationMappingCount,
				deletedConversationCount: uniqueStringArray(chain.conversationIds || []).length
			};
		},
		async bindConversation({ appId, conversationId, previousConversationId = "", preferredChainId = "", tokenSignature = "" }) {
			const normalizedAppId = normalizeId(appId);
			const normalizedConversationId = normalizeId(conversationId);
			const normalizedPreviousConversationId = normalizeId(previousConversationId);
			const normalizedPreferredChainId = normalizeId(preferredChainId);
			const normalizedTokenSignature = normalizeId(tokenSignature);
			if (!normalizedAppId || !normalizedConversationId) {
				throw new Error("appId 或 conversationId 为空，无法绑定链路");
			}
			const directChainId = this.getConversationChainId(normalizedAppId, normalizedConversationId);
			if (directChainId) {
				const directChain = await this.getChain(directChainId);
				if (directChain && directChain.appId === normalizedAppId) {
					if (normalizedTokenSignature) {
						this.setConversationTokenSignature(normalizedAppId, normalizedConversationId, normalizedTokenSignature);
					}
					this.setActiveChainId(normalizedAppId, directChainId);
					return {
						chainId: directChainId,
						chain: directChain,
						created: false
					};
				}
			}
			let chainId = "";
			let chain = null;
			let created = false;
			const candidates = [];
			if (normalizedPreferredChainId) {
				candidates.push(normalizedPreferredChainId);
			}
			if (normalizedPreviousConversationId) {
				const previousChainId = this.getConversationChainId(normalizedAppId, normalizedPreviousConversationId);
				if (previousChainId) {
					candidates.push(previousChainId);
				}
			}
			const activeChainId = this.getActiveChainId(normalizedAppId);
			if (activeChainId) {
				candidates.push(activeChainId);
			}
			for (const candidate of candidates) {
				const candidateChain = await this.getChain(candidate);
				if (candidateChain && candidateChain.appId === normalizedAppId) {
					chainId = candidate;
					chain = candidateChain;
					break;
				}
			}
			if (!chainId) {
				chainId = createChainId(normalizedAppId);
				chain = toChainRecord({
					chainId,
					appId: normalizedAppId,
					conversationIds: [],
					createdAt: Date.now(),
					updatedAt: Date.now()
				});
				created = true;
			}
			const conversationIds = uniqueStringArray([
				...chain?.conversationIds || [],
				normalizedPreviousConversationId,
				normalizedConversationId
			]);
			const nextChain = toChainRecord(chain, {
				conversationIds,
				updatedAt: Date.now()
			});
			await ChatHistoryStore.upsertChain(nextChain);
			this.setConversationChainId(normalizedAppId, normalizedConversationId, chainId);
			if (normalizedPreviousConversationId) {
				this.setConversationChainId(normalizedAppId, normalizedPreviousConversationId, chainId);
			}
			if (normalizedTokenSignature) {
				this.setConversationTokenSignature(normalizedAppId, normalizedConversationId, normalizedTokenSignature);
				if (normalizedPreviousConversationId) {
					const previousToken = this.getConversationTokenSignature(normalizedAppId, normalizedPreviousConversationId);
					if (!previousToken) {
						this.setConversationTokenSignature(normalizedAppId, normalizedPreviousConversationId, normalizedTokenSignature);
					}
				}
			}
			this.setActiveChainId(normalizedAppId, chainId);
			return {
				chainId,
				chain: nextChain,
				created
			};
		},
		async saveConversationMessages({ appId, conversationId, chainId = "", tokenSignature = "", messages = [] }) {
			const normalizedAppId = normalizeId(appId);
			const normalizedConversationId = normalizeId(conversationId);
			const normalizedTokenSignature = normalizeId(tokenSignature);
			if (!normalizedAppId || !normalizedConversationId) {
				throw new Error("appId 或 conversationId 为空，无法保存消息");
			}
			const binding = await this.bindConversation({
				appId: normalizedAppId,
				conversationId: normalizedConversationId,
				preferredChainId: chainId,
				tokenSignature: normalizedTokenSignature
			});
			const normalizedChainId = binding.chainId;
			const now = Date.now();
			const seenStoreKeys = new Set();
			const records = [];
			for (let i = 0; i < messages.length; i++) {
				const rawMessage = messages[i];
				if (!rawMessage || typeof rawMessage !== "object") continue;
				const messageId = normalizeId(rawMessage.id) || `${normalizedConversationId}-idx-${i}`;
				const createdAt = normalizeTimestamp$1(rawMessage.created_at) || now + i;
				const storeKey = `${normalizedChainId}::${normalizedConversationId}::${messageId}`;
				if (seenStoreKeys.has(storeKey)) continue;
				seenStoreKeys.add(storeKey);
				records.push({
					storeKey,
					appId: normalizedAppId,
					chainId: normalizedChainId,
					conversationId: normalizedConversationId,
					messageId,
					createdAt,
					updatedAt: now,
					query: typeof rawMessage.query === "string" ? rawMessage.query : "",
					answer: typeof rawMessage.answer === "string" ? rawMessage.answer : "",
					rawMessage
				});
			}
			const savedCount = await ChatHistoryStore.putMessages(records);
			const chain = await this.getChain(normalizedChainId);
			if (chain) {
				await ChatHistoryStore.upsertChain(toChainRecord(chain, {
					conversationIds: uniqueStringArray([...chain.conversationIds || [], normalizedConversationId]),
					updatedAt: Date.now()
				}));
			}
			if (normalizedTokenSignature) {
				this.setConversationTokenSignature(normalizedAppId, normalizedConversationId, normalizedTokenSignature);
			}
			return {
				chainId: normalizedChainId,
				savedCount
			};
		},
		async listMessagesByChain(chainId) {
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedChainId) return [];
			const records = await ChatHistoryStore.listMessagesByChain(normalizedChainId);
			return (records || []).sort((a, b) => {
				const createdDiff = Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
				if (createdDiff !== 0) return createdDiff;
				return String(a?.storeKey || "").localeCompare(String(b?.storeKey || ""));
			});
		},
		async getChainStats(chainId) {
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedChainId) {
				return {
					messageCount: 0,
					answerCount: 0,
					latestQueryTail: ""
				};
			}
			const records = await this.listMessagesByChain(normalizedChainId);
			let answerCount = 0;
			for (const record of records) {
				const rawMessage = record?.rawMessage && typeof record.rawMessage === "object" ? record.rawMessage : {};
				const answer = rawMessage.answer ?? record?.answer ?? "";
				if (hasMeaningfulText(answer)) {
					answerCount += 1;
				}
			}
			return {
				messageCount: records.length,
				answerCount,
				latestQueryTail: extractLatestQueryTail(records)
			};
		},
		async exportChainBundle({ appId, chainId }) {
			const normalizedAppId = normalizeId(appId);
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedAppId || !normalizedChainId) {
				throw new Error("缺少 appId 或 chainId，无法导出会话链");
			}
			const [appMeta, chain, records] = await Promise.all([
				this.getAppMeta(normalizedAppId),
				this.getChain(normalizedChainId),
				this.listMessagesByChain(normalizedChainId)
			]);
			if (!chain) {
				throw new Error(`会话链不存在: ${normalizedChainId}`);
			}
			if (normalizeId(chain.appId) !== normalizedAppId) {
				throw new Error(`会话链 appId 不匹配: ${normalizedChainId}`);
			}
			const exportMessages = (records || []).map((record) => {
				const rawMessage = record?.rawMessage && typeof record.rawMessage === "object" ? record.rawMessage : {};
				return {
					storeKey: String(record?.storeKey || ""),
					appId: normalizedAppId,
					chainId: normalizedChainId,
					conversationId: normalizeId(record?.conversationId),
					messageId: normalizeId(record?.messageId),
					createdAt: Number(record?.createdAt || 0),
					updatedAt: Number(record?.updatedAt || 0),
					query: typeof record?.query === "string" ? record.query : typeof rawMessage.query === "string" ? rawMessage.query : "",
					answer: typeof record?.answer === "string" ? record.answer : typeof rawMessage.answer === "string" ? rawMessage.answer : "",
					rawMessage: cloneJsonCompatible(rawMessage, {})
				};
			});
			return {
				version: 1,
				type: "aifengyue_chain_bundle",
				exportedAt: Date.now(),
				appId: normalizedAppId,
				appMeta: appMeta ? {
					appId: normalizedAppId,
					name: asDisplayContent(appMeta.name),
					description: asDisplayContent(appMeta.description),
					builtInCss: asDisplayContent(appMeta.builtInCss),
					createdAt: Number(appMeta.createdAt || 0),
					updatedAt: Number(appMeta.updatedAt || 0)
				} : null,
				chain: {
					chainId: normalizedChainId,
					appId: normalizedAppId,
					conversationIds: uniqueStringArray(chain.conversationIds || []),
					createdAt: Number(chain.createdAt || 0),
					updatedAt: Number(chain.updatedAt || 0),
					lastSyncAt: this.getChainLastSync(normalizedChainId)
				},
				messages: exportMessages,
				summary: {
					conversationCount: uniqueStringArray(chain.conversationIds || []).length,
					messageCount: exportMessages.length,
					latestQueryTail: extractLatestQueryTail(records)
				}
			};
		},
		async importChainBundle({ payload, preferAppId = "", preferChainId = "" } = {}) {
			const source = payload && typeof payload === "object" ? payload : null;
			if (!source) {
				throw new Error("导入内容不是合法 JSON 对象");
			}
			const sourceChain = source?.chain && typeof source.chain === "object" ? source.chain : {};
			const sourceAppMeta = source?.appMeta && typeof source.appMeta === "object" ? source.appMeta : {};
			const sourceMessages = Array.isArray(source?.messages) ? source.messages : [];
			const normalizedAppId = normalizeId(preferAppId) || normalizeId(source?.appId) || normalizeId(sourceChain?.appId) || normalizeId(sourceAppMeta?.appId);
			if (!normalizedAppId) {
				throw new Error("导入失败：未识别 appId");
			}
			const sourceConversationIds = uniqueStringArray([...Array.isArray(sourceChain?.conversationIds) ? sourceChain.conversationIds : [], ...sourceMessages.map((item) => {
				const rawMessage = item?.rawMessage && typeof item.rawMessage === "object" ? item.rawMessage : {};
				return normalizeId(item?.conversationId) || normalizeId(item?.conversation_id) || normalizeId(rawMessage?.conversationId) || normalizeId(rawMessage?.conversation_id);
			})]);
			let targetChainId = normalizeId(preferChainId) || normalizeId(sourceChain?.chainId);
			if (!targetChainId) {
				targetChainId = createChainId(normalizedAppId);
			}
			let existingChain = await this.getChain(targetChainId);
			if (existingChain && normalizeId(existingChain.appId) !== normalizedAppId) {
				targetChainId = createChainId(normalizedAppId);
				existingChain = null;
			}
			const now = Date.now();
			const seenStoreKeys = new Set();
			const records = [];
			for (let i = 0; i < sourceMessages.length; i++) {
				const item = sourceMessages[i];
				if (!item || typeof item !== "object") continue;
				const rawMessage = item?.rawMessage && typeof item.rawMessage === "object" ? item.rawMessage : cloneJsonCompatible(item, {});
				const conversationId = normalizeId(item?.conversationId) || normalizeId(item?.conversation_id) || normalizeId(rawMessage?.conversationId) || normalizeId(rawMessage?.conversation_id) || sourceConversationIds[0] || `import-conv-${i + 1}`;
				const messageId = normalizeId(item?.messageId) || normalizeId(item?.id) || normalizeId(rawMessage?.id) || `${conversationId}-idx-${i}`;
				const createdAt = normalizeTimestamp$1(item?.createdAt ?? item?.created_at ?? rawMessage?.created_at) || now + i;
				const storeKey = `${targetChainId}::${conversationId}::${messageId}`;
				if (seenStoreKeys.has(storeKey)) continue;
				seenStoreKeys.add(storeKey);
				const query = typeof item?.query === "string" ? item.query : typeof rawMessage?.query === "string" ? rawMessage.query : "";
				const answer = typeof item?.answer === "string" ? item.answer : typeof rawMessage?.answer === "string" ? rawMessage.answer : "";
				records.push({
					storeKey,
					appId: normalizedAppId,
					chainId: targetChainId,
					conversationId,
					messageId,
					createdAt,
					updatedAt: now,
					query,
					answer,
					rawMessage: cloneJsonCompatible(rawMessage, {})
				});
			}
			const mergedConversationIds = uniqueStringArray([
				...existingChain?.conversationIds || [],
				...sourceConversationIds,
				...records.map((record) => record.conversationId)
			]);
			if (mergedConversationIds.length === 0) {
				throw new Error("导入失败：未找到可用 conversation_id");
			}
			if (sourceAppMeta && Object.keys(sourceAppMeta).length > 0) {
				await this.upsertAppMeta({
					appId: normalizedAppId,
					name: sourceAppMeta?.name ?? "",
					description: sourceAppMeta?.description ?? "",
					builtInCss: sourceAppMeta?.builtInCss ?? ""
				});
			}
			const nextChain = toChainRecord(existingChain || {
				chainId: targetChainId,
				appId: normalizedAppId,
				conversationIds: [],
				createdAt: now,
				updatedAt: now
			}, {
				chainId: targetChainId,
				appId: normalizedAppId,
				conversationIds: mergedConversationIds,
				updatedAt: now
			});
			await ChatHistoryStore.upsertChain(nextChain);
			const savedCount = await ChatHistoryStore.putMessages(records);
			for (const conversationId of mergedConversationIds) {
				this.setConversationChainId(normalizedAppId, conversationId, targetChainId);
			}
			this.setActiveChainId(normalizedAppId, targetChainId);
			this.markChainSynced(targetChainId, Date.now());
			return {
				appId: normalizedAppId,
				chainId: targetChainId,
				conversationCount: mergedConversationIds.length,
				sourceMessageCount: sourceMessages.length,
				importedMessageCount: records.length,
				savedCount
			};
		},
		async buildChainViewerHtml({ appId, chainId }) {
			const normalizedAppId = normalizeId(appId);
			const normalizedChainId = normalizeId(chainId);
			if (!normalizedAppId || !normalizedChainId) {
				return "<html><body><p>缺少 appId 或 chainId。</p></body></html>";
			}
			const [appMeta, chain, records] = await Promise.all([
				this.getAppMeta(normalizedAppId),
				this.getChain(normalizedChainId),
				this.listMessagesByChain(normalizedChainId)
			]);
			const name = escapeHtml(appMeta?.name || normalizedAppId);
			const style = String(appMeta?.builtInCss || "");
			const conversationIds = uniqueStringArray(chain?.conversationIds || []);
			const answerHistory = [];
			const messageHtml = records.length > 0 ? records.map((record, index) => {
				const rawMessage = record?.rawMessage && typeof record.rawMessage === "object" ? record.rawMessage : {};
				const queryText = asDisplayContent(rawMessage.query ?? record?.query ?? "");
				const answerText = asDisplayContent(rawMessage.answer ?? record?.answer ?? "");
				const dedupResult = stripDuplicatedAnswerPrefix(queryText, answerHistory);
				const renderedQuery = renderMessageBody(dedupResult.text || "(去重后为空)", "(去重后为空)");
				const renderedAnswer = renderMessageBody(answerText, "(空回复)");
				const createdAtText = escapeHtml(formatTime(rawMessage.created_at ?? record?.createdAt));
				const messageIdText = escapeHtml(String(rawMessage.id || record?.messageId || "-"));
				const queryContentId = `af-query-content-${index + 1}`;
				const answerContentId = `af-answer-content-${index + 1}`;
				if (answerText) {
					answerHistory.push(answerText);
				}
				const dedupHint = dedupResult.removedPrefix ? "<div class=\"af-dedup-hint\">已自动去重历史前缀 answer</div>" : "";
				return `
                    <div class="group flex mb-2 last:mb-0 af-row-user">
                        <div class="group relative ml-2 md:ml-0 af-bubble-wrap af-user-wrap">
                            <div id="${queryContentId}" class="relative inline-block px-4 py-3 max-w-full text-gray-900 rounded-xl text-sm af-message-bubble af-user-bubble">
                                ${renderedQuery}
                            </div>
                            <div class="af-bubble-meta af-user-meta">
                                <span>#${index + 1}</span>
                                <span>${createdAtText}</span>
                                <span>${messageIdText}</span>
                            </div>
                            <div class="af-bubble-actions af-user-actions">
                                <button class="af-copy-btn" type="button" data-af-copy-target="#${queryContentId}">复制 Query</button>
                            </div>
                            ${dedupHint}
                        </div>
                    </div>
                    <div class="group flex mb-2 last:mb-0 af-row-answer" id="ai-chat-answer">
                        <div class="chat-answer-container group relative mr-2 md:mr-0 af-bubble-wrap af-answer-wrap">
                            <div id="${answerContentId}" class="relative inline-block px-4 py-3 max-w-full text-gray-900 rounded-xl text-sm af-message-bubble af-answer-bubble">
                                ${renderedAnswer}
                            </div>
                            <div class="af-bubble-meta af-answer-meta">
                                <span>${createdAtText}</span>
                                <span>${messageIdText}</span>
                            </div>
                            <div class="af-bubble-actions af-answer-actions">
                                <button class="af-copy-btn" type="button" data-af-copy-target="#${answerContentId}">复制 Answer</button>
                            </div>
                        </div>
                    </div>
                `;
			}).join("\n") : "<div class=\"af-empty\">当前链路暂无消息，点击“手动同步”拉取历史。</div>";
			return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${name} - 本地会话</title>
    <style>
        :root {
            color-scheme: light;
            --af-bg: #eef2f7;
            --af-card: #ffffff;
            --af-border: #d7dde8;
            --af-muted: #6b7280;
            --af-bubble: #ffffff;
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: var(--af-bg);
            color: #1f2937;
        }
        #installedBuiltInCss.af-chat-root {
            position: relative;
            min-height: 100vh;
            overflow: hidden;
            background: var(--af-bg);
        }
        .af-chat-shell {
            max-width: 840px;
            margin: 0 auto;
            padding: 10px 12px 20px;
        }
        .af-chat-header {
            position: sticky;
            top: 0;
            z-index: 4;
            backdrop-filter: blur(8px);
            background: rgba(238, 242, 247, 0.86);
            border-bottom: 1px solid var(--af-border);
            padding: 10px 4px 12px;
            margin-bottom: 10px;
        }
        .af-chat-title {
            font-size: 15px;
            font-weight: 700;
            margin: 0;
            line-height: 1.3;
        }
        .af-chat-sub {
            margin-top: 6px;
            color: var(--af-muted);
            font-size: 12px;
            line-height: 1.5;
        }
        .chat-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .af-row-user {
            display: flex;
            justify-content: flex-end;
        }
        .af-row-answer {
            display: flex;
            justify-content: flex-start;
        }
        .af-bubble-wrap {
            max-width: min(86%, 900px);
            width: fit-content;
            min-width: min(66%, 360px);
        }
        .af-user-wrap {
            margin-right: 6%;
        }
        .af-answer-wrap {
            margin-left: 6%;
        }
        .af-message-bubble {
            background: var(--af-bubble) !important;
            border: 1px solid rgba(148, 163, 184, 0.32) !important;
            border-radius: 14px;
            box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06) !important;
            overflow-x: auto;
            width: 100%;
        }
        .af-user-bubble {
            margin-left: auto;
        }
        .af-answer-bubble {
            margin-right: auto;
        }
        .af-bubble-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 5px;
            color: var(--af-muted);
            font-size: 11px;
            line-height: 1.4;
        }
        .af-user-meta {
            justify-content: flex-end;
            text-align: right;
        }
        .af-answer-meta {
            justify-content: flex-start;
        }
        .af-bubble-actions {
            display: flex;
            margin-top: 4px;
        }
        .af-user-actions {
            justify-content: flex-end;
        }
        .af-answer-actions {
            justify-content: flex-start;
        }
        .af-copy-btn {
            border: 1px solid var(--af-border);
            border-radius: 7px;
            background: rgba(255, 255, 255, 0.92);
            color: #4b5563;
            font-size: 11px;
            line-height: 1;
            height: 24px;
            padding: 0 9px;
            cursor: pointer;
            transition: all 0.18s ease;
        }
        .af-copy-btn:hover {
            border-color: #60a5fa;
            color: #1d4ed8;
            background: #eff6ff;
        }
        .af-copy-btn:active {
            transform: scale(0.97);
        }
        .af-dedup-hint {
            margin-top: 2px;
            font-size: 11px;
            color: #0f766e;
            text-align: right;
        }
        .af-plain {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            border: 1px solid var(--af-border);
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
            line-height: 1.65;
            background: rgba(255, 255, 255, 0.72);
        }
        .markdown-body {
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        .af-empty {
            border: 1px dashed var(--af-border);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            color: var(--af-muted);
            background: var(--af-card);
        }
        ${style}
    </style>
</head>
<body>
    <div id="installedBuiltInCss" class="relative w-full h-full overflow-hidden af-chat-root">
        <div class="af-chat-shell">
            <div class="af-chat-header">
                <h1 class="af-chat-title">${name}</h1>
                <div class="af-chat-sub">
                    <div>appId: ${escapeHtml(normalizedAppId)}</div>
                    <div>chainId: ${escapeHtml(normalizedChainId)}</div>
                    <div>conversationIds: ${escapeHtml(conversationIds.join(", ") || "-")}</div>
                    <div>消息数: ${records.length}</div>
                </div>
            </div>
            <div class="overflow-y-auto w-full h-full chat-container mx-auto">
                ${messageHtml}
            </div>
        </div>
    </div>
</body>
</html>`;
		}
	};

//#endregion
//#region src/utils/logger.js
	const PREFIX = "AI风月注册助手";
	function output(level, text, meta) {
		if (level === "ERROR") {
			if (meta === undefined) console.error(text);
			else console.error(text, meta);
			return;
		}
		if (level === "WARN") {
			if (meta === undefined) console.warn(text);
			else console.warn(text, meta);
			return;
		}
		if (level === "DEBUG") {
			if (meta === undefined) console.debug(text);
			else console.debug(text, meta);
			return;
		}
		if (meta === undefined) console.log(text);
		else console.log(text, meta);
	}
	function baseLog(level, runCtx, step, message, meta) {
		const runId = runCtx?.runId || "NO-RUN";
		const tag = `[${PREFIX}][${runId}][${level}][${step}] ${message}`;
		output(level, tag, meta);
	}
	function createRunContext(prefix = "AR") {
		const stamp = Date.now().toString(36);
		const rand = Math.random().toString(36).slice(2, 6);
		return {
			runId: `${prefix}-${stamp}-${rand}`,
			startedAt: Date.now()
		};
	}
	function isDebugEnabled() {
		return !!gmGetValue(CONFIG.STORAGE_KEYS.LOG_DEBUG_ENABLED, false);
	}
	function setDebugEnabled(enabled) {
		gmSetValue(CONFIG.STORAGE_KEYS.LOG_DEBUG_ENABLED, !!enabled);
	}
	function toggleDebugEnabled() {
		const next = !isDebugEnabled();
		setDebugEnabled(next);
		return next;
	}
	function logInfo$1(runCtx, step, message, meta) {
		baseLog("INFO", runCtx, step, message, meta);
	}
	function logWarn$1(runCtx, step, message, meta) {
		baseLog("WARN", runCtx, step, message, meta);
	}
	function logError(runCtx, step, message, meta) {
		baseLog("ERROR", runCtx, step, message, meta);
	}
	function logDebug(runCtx, step, message, meta) {
		if (!isDebugEnabled()) return;
		baseLog("DEBUG", runCtx, step, message, meta);
	}

//#endregion
//#region src/ui/sidebar.js
	const VALID_TABS = [
		"register",
		"tools",
		"conversation",
		"settings"
	];
	function getToast() {
		return APP_STATE.refs.toast;
	}
	function getAutoRegister() {
		return APP_STATE.refs.autoRegister;
	}
	function getIframeExtractor() {
		return APP_STATE.refs.iframeExtractor;
	}
	function getModelPopupSorter() {
		return APP_STATE.refs.modelPopupSorter;
	}
	const Sidebar = {
		element: null,
		conversationModal: null,
		conversationModalOpen: false,
		conversationModalEscHandler: null,
		isOpen: false,
		layoutMode: "inline",
		activeTab: "register",
		theme: "light",
		state: APP_STATE.sidebar.state,
		conversation: {
			appId: "",
			chains: [],
			activeChainId: "",
			globalChains: [],
			activeGlobalChainId: "",
			loading: false
		},
		init() {
			if (this.element && document.body.contains(this.element) && document.getElementById("aifengyue-sidebar-toggle")) {
				return;
			}
			this.activeTab = this.getDefaultTab();
			this.layoutMode = this.getLayoutMode();
			this.theme = this.getTheme();
			this.createSidebar();
			this.createConversationModal();
			this.createToggleButton();
			this.loadSavedData();
			this.applyLayoutModeClass();
			this.applyTheme();
			this.setActiveTab(this.activeTab);
			if (this.getDefaultOpen()) {
				this.open();
			} else {
				this.close();
			}
		},
		createSidebar() {
			const existing = document.getElementById("aifengyue-sidebar");
			if (existing) {
				existing.remove();
			}
			this.element = document.createElement("div");
			this.element.id = "aifengyue-sidebar";
			this.element.innerHTML = `
            <div class="aifengyue-sidebar-header">
                <h2>AI风月 助手</h2>
                <button class="aifengyue-theme-toggle" title="切换主题">☀</button>
                <button class="aifengyue-sidebar-close" title="关闭">✕</button>
            </div>

            <div class="aifengyue-sidebar-tabs">
                <button class="aifengyue-tab-btn active" data-tab="register">注册</button>
                <button class="aifengyue-tab-btn" data-tab="tools">工具</button>
                <button class="aifengyue-tab-btn" data-tab="conversation">会话</button>
                <button class="aifengyue-tab-btn" data-tab="settings">设置</button>
            </div>

            <div class="aifengyue-sidebar-content">
                <div class="aifengyue-panel active" data-panel="register">
                    <div class="aifengyue-section">
                        <div class="aifengyue-status-card">
                            <div class="aifengyue-status-indicator">
                                <div class="aifengyue-status-dot idle" id="aifengyue-status-dot"></div>
                                <span class="aifengyue-status-text" id="aifengyue-status-text">空闲</span>
                            </div>
                            <div class="aifengyue-status-message" id="aifengyue-status-message">等待操作...</div>
                        </div>
                    </div>

                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">账号信息</div>
                        <div class="aifengyue-status-card">
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">邮箱</span>
                                <span class="aifengyue-info-value" id="aifengyue-email">未生成</span>
                                <button class="aifengyue-copy-btn" data-copy="email">复制</button>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">用户名</span>
                                <span class="aifengyue-info-value" id="aifengyue-username">未生成</span>
                                <button class="aifengyue-copy-btn" data-copy="username">复制</button>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">密码</span>
                                <span class="aifengyue-info-value" id="aifengyue-password">未生成</span>
                                <button class="aifengyue-copy-btn" data-copy="password">复制</button>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">验证码</span>
                                <span class="aifengyue-info-value code" id="aifengyue-code">等待中...</span>
                                <button class="aifengyue-copy-btn" data-copy="code">复制</button>
                            </div>
                        </div>
                    </div>

                    <div class="aifengyue-section" id="aifengyue-manual-group">
                        <div class="aifengyue-section-title">注册页手动辅助</div>
                        <button class="aifengyue-btn aifengyue-btn-primary" id="aifengyue-start">
                            📝 开始辅助填表
                        </button>
                        <div class="aifengyue-btn-group">
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-refresh-email">
                                🔄 换邮箱
                            </button>
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-fetch-code">
                                📩 获取验证码
                            </button>
                        </div>
                    </div>

                    <div class="aifengyue-section" id="aifengyue-auto-group">
                        <div class="aifengyue-section-title">接口自动流程</div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-start-oneclick">
                            🚀 一键注册
                        </button>
                    </div>

                    <div class="aifengyue-hint" id="aifengyue-register-hint">
                        当前注册页：可辅助填表，验证码需手动完成。
                    </div>
                </div>

                <div class="aifengyue-panel" data-panel="tools">
                    <div class="aifengyue-tools-empty" id="aifengyue-tools-empty">
                        当前页面暂无可用工具
                    </div>

                    <div class="aifengyue-tool-block" id="aifengyue-extract-html-wrap">
                        <div class="aifengyue-section-title">HTML 提取</div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-extract-html">
                            📄 提取 HTML
                        </button>
                    </div>

                    <div class="aifengyue-tool-block" id="aifengyue-sort-wrap">
                        <div class="aifengyue-section-title">模型排序</div>
                        <label class="aifengyue-check-row">
                            <input type="checkbox" id="aifengyue-sort-toggle">
                            <span>启用自动排序</span>
                        </label>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-sort-now">
                            📊 立即排序
                        </button>
                    </div>
                </div>

                <div class="aifengyue-panel" data-panel="conversation">
                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">流程状态</div>
                        <div class="aifengyue-status-card">
                            <div class="aifengyue-status-indicator">
                                <div class="aifengyue-status-dot idle" id="aifengyue-conv-flow-status-dot"></div>
                                <span class="aifengyue-status-text" id="aifengyue-conv-flow-status-text">空闲</span>
                            </div>
                            <div class="aifengyue-status-message" id="aifengyue-conv-flow-status-message">等待操作...</div>
                        </div>
                    </div>
                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">更换账号</div>
                        <div class="aifengyue-input-group">
                            <label>更换账号附加文本</label>
                            <textarea id="aifengyue-switch-text" class="aifengyue-textarea aifengyue-switch-textarea" placeholder="输入附加文本（query 会自动以前缀触发词开头）"></textarea>
                        </div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-switch-account">
                            🔀 更换账号
                        </button>
                    </div>
                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">本地会话链</div>
                        <div class="aifengyue-input-group">
                            <label>选择链路</label>
                            <select id="aifengyue-conversation-chain">
                                <option value="">暂无链路</option>
                            </select>
                        </div>
                        <div class="aifengyue-btn-group">
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-conversation-refresh">
                                🔄 刷新链路
                            </button>
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-conversation-sync">
                                ⬇ 手动同步
                            </button>
                        </div>
                        <div class="aifengyue-btn-group">
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-conversation-export">
                                📤 导出JSON
                            </button>
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-conversation-import-trigger">
                                📥 导入JSON
                            </button>
                        </div>
                        <input type="file" id="aifengyue-conversation-import-file" accept=".json,application/json" style="display:none;">
                        <div class="aifengyue-conv-latest-card">
                            <div class="aifengyue-conv-latest-head">当前链路最新 Query 尾部</div>
                            <div class="aifengyue-conv-latest-body" id="aifengyue-conversation-latest-query">-</div>
                        </div>
                        <div class="aifengyue-hint" id="aifengyue-conversation-status">
                            仅在应用详情页可用，会显示本地保存的链式会话。
                        </div>
                    </div>
                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">全局链路查看器</div>
                        <div class="aifengyue-input-group">
                            <label>全部本地链路（跨 App）</label>
                            <select id="aifengyue-conversation-global-chain">
                                <option value="">暂无链路</option>
                            </select>
                        </div>
                        <div class="aifengyue-btn-group">
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-conversation-global-refresh">
                                🔄 刷新全部
                            </button>
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-conversation-global-open-preview">
                                🔍 预览选中
                            </button>
                        </div>
                        <button class="aifengyue-btn aifengyue-btn-danger" id="aifengyue-conversation-global-delete">
                            🗑 删除选中链路
                        </button>
                        <div class="aifengyue-conv-latest-card">
                            <div class="aifengyue-conv-latest-head">全局选中链路最新 Query 尾部</div>
                            <div class="aifengyue-conv-latest-body" id="aifengyue-conversation-global-latest-query">-</div>
                        </div>
                        <div class="aifengyue-hint" id="aifengyue-conversation-global-status">
                            可查看本地全部会话链，支持跨 App 预览和删除。
                        </div>
                    </div>
                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">会话预览</div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-conversation-open-preview">
                            🔍 打开悬浮预览
                        </button>
                        <div class="aifengyue-hint">
                            预览将以悬浮窗口打开，按 ESC 可关闭。
                        </div>
                    </div>
                </div>

                <div class="aifengyue-panel" data-panel="settings">
                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">API 配置</div>
                        <div class="aifengyue-input-group">
                            <label>GPTMail API Key</label>
                            <input type="text" id="aifengyue-api-key" placeholder="输入你的 API Key (默认: gpt-test)">
                        </div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-save-key">💾 保存 API Key</button>
                    </div>

                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">配额统计</div>
                        <div class="aifengyue-usage-display">
                            <div class="aifengyue-usage-head">
                                <span class="aifengyue-muted">API 配额使用</span>
                                <span id="aifengyue-usage-text">0 / 1000</span>
                            </div>
                            <div class="aifengyue-usage-track">
                                <div id="aifengyue-usage-bar"></div>
                            </div>
                            <div class="aifengyue-usage-foot">
                                <span id="aifengyue-usage-remaining">剩余: 1000 次</span>
                                <button id="aifengyue-reset-usage">重置统计</button>
                            </div>
                        </div>
                    </div>

                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">界面设置</div>
                        <div class="aifengyue-input-group">
                            <label>侧边栏布局</label>
                            <select id="aifengyue-layout-mode">
                                <option value="inline">插入右侧（占空间）</option>
                                <option value="floating">悬浮右侧（不占空间）</option>
                            </select>
                        </div>
                        <div class="aifengyue-input-group">
                            <label>默认打开 Tab</label>
                            <select id="aifengyue-default-tab">
                                <option value="register">注册</option>
                                <option value="tools">工具</option>
                                <option value="conversation">会话</option>
                                <option value="settings">设置</option>
                            </select>
                        </div>
                        <div class="aifengyue-input-group">
                            <label>侧边栏默认打开</label>
                            <select id="aifengyue-default-open">
                                <option value="closed">关闭</option>
                                <option value="open">打开</option>
                            </select>
                        </div>
                    </div>

                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">运行设置</div>
                        <label class="aifengyue-check-row">
                            <input type="checkbox" id="aifengyue-debug-toggle">
                            <span>启用调试日志（DEBUG）</span>
                        </label>
                        <label class="aifengyue-check-row">
                            <input type="checkbox" id="aifengyue-auto-reload-toggle">
                            <span>启用自动刷新（window.location.reload）</span>
                        </label>
                    </div>
                </div>
            </div>

            <div class="aifengyue-footer">
                Powered by <a href="https://mail.chatgpt.org.uk" target="_blank">GPTMail</a> |
                <a href="https://github.com/owwkmidream/UserScripts" target="_blank">GitHub</a>
            </div>
        `;
			document.body.appendChild(this.element);
			this.bindEvents();
		},
		createConversationModal() {
			const existing = document.getElementById("aifengyue-conversation-modal");
			if (existing) {
				existing.remove();
			}
			const modal = document.createElement("div");
			modal.id = "aifengyue-conversation-modal";
			modal.innerHTML = `
            <div class="aifengyue-conv-modal-backdrop">
                <div class="aifengyue-conv-modal-content" role="dialog" aria-modal="true" aria-label="会话预览">
                    <div class="aifengyue-conv-modal-head">
                        <div class="aifengyue-conv-modal-title">本地会话预览</div>
                        <button id="aifengyue-conversation-modal-close" class="aifengyue-conv-modal-close" title="关闭">✕</button>
                    </div>
                    <iframe id="aifengyue-conversation-viewer" class="aifengyue-conversation-viewer" sandbox="allow-same-origin"></iframe>
                </div>
            </div>
        `;
			document.body.appendChild(modal);
			this.conversationModal = modal;
			this.conversationModalOpen = false;
			const closeBtn = modal.querySelector("#aifengyue-conversation-modal-close");
			closeBtn?.addEventListener("click", () => this.closeConversationModal());
			if (this.conversationModalEscHandler) {
				document.removeEventListener("keydown", this.conversationModalEscHandler);
			}
			this.conversationModalEscHandler = (event) => {
				if (event.key === "Escape" && this.conversationModalOpen) {
					this.closeConversationModal();
				}
			};
			document.addEventListener("keydown", this.conversationModalEscHandler);
		},
		openConversationModal() {
			if (!this.conversationModal) {
				this.createConversationModal();
			}
			if (!this.conversationModal) return;
			this.conversationModal.classList.add("open");
			this.conversationModalOpen = true;
		},
		closeConversationModal() {
			if (!this.conversationModal) return;
			this.conversationModal.classList.remove("open");
			this.conversationModalOpen = false;
		},
		createToggleButton() {
			const existing = document.getElementById("aifengyue-sidebar-toggle");
			if (existing) {
				existing.remove();
			}
			const btn = document.createElement("button");
			btn.id = "aifengyue-sidebar-toggle";
			btn.textContent = "打开助手";
			btn.addEventListener("click", () => this.toggle());
			document.body.appendChild(btn);
		},
		bindEvents() {
			this.element.querySelector(".aifengyue-sidebar-close").addEventListener("click", () => this.close());
			this.element.querySelector(".aifengyue-theme-toggle").addEventListener("click", () => this.toggleTheme());
			this.element.querySelectorAll(".aifengyue-tab-btn").forEach((btn) => {
				btn.addEventListener("click", () => {
					this.setActiveTab(btn.dataset.tab);
				});
			});
			this.element.querySelector("#aifengyue-save-key").addEventListener("click", () => {
				const input = this.element.querySelector("#aifengyue-api-key");
				const key = input.value.trim() || CONFIG.DEFAULT_API_KEY;
				ApiService.setApiKey(key);
				getToast()?.success("API Key 已保存");
			});
			this.element.querySelector("#aifengyue-layout-mode").addEventListener("change", (e) => {
				const mode = e.target.value;
				this.setLayoutMode(mode);
				getToast()?.info(`侧边栏已切换为${mode === "inline" ? "插入模式" : "悬浮模式"}`);
			});
			this.element.querySelector("#aifengyue-default-tab").addEventListener("change", (e) => {
				const tab = typeof e?.target?.value === "string" ? e.target.value : "register";
				this.setDefaultTab(tab);
				getToast()?.success(`默认 Tab 已设置为「${this.tabLabel(this.getDefaultTab())}」`);
			});
			this.element.querySelector("#aifengyue-default-open").addEventListener("change", (e) => {
				const value = typeof e?.target?.value === "string" ? e.target.value : "closed";
				const shouldOpen = value === "open";
				this.setDefaultOpen(shouldOpen);
				if (shouldOpen) {
					this.open();
				} else {
					this.close();
				}
				getToast()?.success(`侧边栏默认已设置为「${shouldOpen ? "打开" : "关闭"}」`);
			});
			this.element.querySelector("#aifengyue-debug-toggle").addEventListener("change", (e) => {
				const enabled = !!e?.target?.checked;
				setDebugEnabled(enabled);
				getToast()?.info(`调试日志已${enabled ? "开启" : "关闭"}`);
			});
			this.element.querySelector("#aifengyue-auto-reload-toggle").addEventListener("change", (e) => {
				const enabled = !!e?.target?.checked;
				this.setAutoReloadEnabled(enabled);
				getToast()?.info(`自动刷新已${enabled ? "开启" : "关闭"}`);
			});
			this.element.querySelector("#aifengyue-start").addEventListener("click", () => {
				getAutoRegister()?.start();
			});
			this.element.querySelector("#aifengyue-start-oneclick").addEventListener("click", () => {
				getAutoRegister()?.startOneClickRegister();
			});
			this.element.querySelector("#aifengyue-switch-account").addEventListener("click", () => {
				const input = this.element.querySelector("#aifengyue-switch-text");
				const extraText = input?.value?.trim() || "";
				getAutoRegister()?.switchAccount(extraText);
			});
			this.element.querySelector("#aifengyue-refresh-email").addEventListener("click", () => {
				getAutoRegister()?.generateNewEmail();
			});
			this.element.querySelector("#aifengyue-fetch-code").addEventListener("click", () => {
				getAutoRegister()?.fetchVerificationCode();
			});
			this.element.querySelectorAll(".aifengyue-copy-btn").forEach((btn) => {
				btn.addEventListener("click", (e) => {
					const type = e.target.dataset.copy;
					let value = "";
					switch (type) {
						case "email":
							value = this.state.email;
							break;
						case "username":
							value = this.state.username;
							break;
						case "password":
							value = this.state.password;
							break;
						case "code":
							value = this.state.verificationCode;
							break;
					}
					if (value) {
						this.copyTextToClipboard(value, {
							successMessage: "已复制到剪贴板",
							errorMessage: "复制失败"
						});
					}
				});
			});
			this.element.querySelector("#aifengyue-reset-usage").addEventListener("click", () => {
				if (confirm("确定要重置 API 使用统计吗？")) {
					ApiService.resetUsageCount();
					getToast()?.success("统计已重置");
				}
			});
			this.element.querySelector("#aifengyue-extract-html").addEventListener("click", () => {
				const extractor = getIframeExtractor();
				if (!extractor) return;
				if (!extractor.isExtractAvailable()) {
					getToast()?.warning("当前页面不是可提取的应用详情页");
					this.updateToolPanel();
					return;
				}
				extractor.extractAndSave();
				this.updateToolPanel();
			});
			this.element.querySelector("#aifengyue-sort-now").addEventListener("click", () => {
				const sorter = getModelPopupSorter();
				if (!sorter) return;
				sorter.sortPopup();
				getToast()?.info("已触发一次模型排序");
			});
			this.element.querySelector("#aifengyue-sort-toggle").addEventListener("change", (e) => {
				const sorter = getModelPopupSorter();
				if (!sorter) return;
				sorter.setSortEnabled(!!e.target.checked);
				getToast()?.info(`自动排序已${e.target.checked ? "开启" : "关闭"}`);
			});
			this.element.querySelector("#aifengyue-conversation-chain").addEventListener("change", async (e) => {
				const chainId = e.target.value || "";
				if (!chainId || !this.conversation.appId) return;
				this.conversation.activeChainId = chainId;
				ChatHistoryService.setActiveChainId(this.conversation.appId, chainId);
				this.renderConversationLatestQueryTail();
				await this.renderConversationViewer();
			});
			this.element.querySelector("#aifengyue-conversation-global-chain").addEventListener("change", (e) => {
				const chainId = typeof e?.target?.value === "string" ? e.target.value : "";
				this.conversation.activeGlobalChainId = chainId;
				this.renderGlobalConversationLatestQueryTail();
			});
			this.element.querySelector("#aifengyue-conversation-refresh").addEventListener("click", async () => {
				await this.refreshConversationPanel({
					showToast: true,
					keepSelection: true
				});
			});
			this.element.querySelector("#aifengyue-conversation-global-refresh").addEventListener("click", async () => {
				await this.refreshGlobalConversationPanel({
					showToast: true,
					keepSelection: true
				});
			});
			this.element.querySelector("#aifengyue-conversation-sync").addEventListener("click", async () => {
				await this.syncConversationPanel();
			});
			this.element.querySelector("#aifengyue-conversation-export").addEventListener("click", async () => {
				await this.exportConversationChainJson();
			});
			this.element.querySelector("#aifengyue-conversation-import-trigger").addEventListener("click", () => {
				const fileInput = this.element.querySelector("#aifengyue-conversation-import-file");
				if (!fileInput) return;
				fileInput.value = "";
				fileInput.click();
			});
			this.element.querySelector("#aifengyue-conversation-import-file").addEventListener("change", async (e) => {
				const file = e?.target?.files?.[0];
				if (!file) return;
				await this.importConversationChainJson(file);
			});
			this.element.querySelector("#aifengyue-conversation-open-preview").addEventListener("click", async () => {
				this.openConversationModal();
				await this.renderConversationViewer();
			});
			this.element.querySelector("#aifengyue-conversation-global-open-preview").addEventListener("click", async () => {
				await this.openGlobalConversationPreview();
			});
			this.element.querySelector("#aifengyue-conversation-global-delete").addEventListener("click", async () => {
				await this.deleteSelectedGlobalConversationChain();
			});
		},
		loadSavedData() {
			const apiKey = gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, "");
			if (apiKey) {
				this.element.querySelector("#aifengyue-api-key").value = apiKey;
			}
			const layoutModeInput = this.element.querySelector("#aifengyue-layout-mode");
			if (layoutModeInput) {
				layoutModeInput.value = this.layoutMode;
			}
			const defaultTabInput = this.element.querySelector("#aifengyue-default-tab");
			if (defaultTabInput) {
				defaultTabInput.value = this.getDefaultTab();
			}
			const defaultOpenInput = this.element.querySelector("#aifengyue-default-open");
			if (defaultOpenInput) {
				defaultOpenInput.value = this.getDefaultOpen() ? "open" : "closed";
			}
			const debugToggle = this.element.querySelector("#aifengyue-debug-toggle");
			if (debugToggle) {
				debugToggle.checked = isDebugEnabled();
			}
			const autoReloadToggle = this.element.querySelector("#aifengyue-auto-reload-toggle");
			if (autoReloadToggle) {
				autoReloadToggle.checked = this.getAutoReloadEnabled();
			}
			this.updateUsageDisplay();
			this.render();
		},
		setActiveTab(tab) {
			if (!VALID_TABS.includes(tab)) return;
			this.activeTab = tab;
			this.element.querySelectorAll(".aifengyue-tab-btn").forEach((btn) => {
				btn.classList.toggle("active", btn.dataset.tab === this.activeTab);
			});
			this.element.querySelectorAll(".aifengyue-panel").forEach((panel) => {
				panel.classList.toggle("active", panel.dataset.panel === this.activeTab);
			});
			if (this.activeTab === "conversation") {
				this.refreshConversationPanel({
					showToast: false,
					keepSelection: true
				}).catch((error) => {
					this.setConversationStatus(`会话面板刷新失败: ${error.message}`);
				});
			}
		},
		async copyTextToClipboard(text, { successMessage = "已复制到剪贴板", errorMessage = "复制失败" } = {}) {
			const value = typeof text === "string" ? text : String(text ?? "");
			if (!value) return false;
			const fallbackCopy = () => {
				const textarea = document.createElement("textarea");
				textarea.value = value;
				textarea.setAttribute("readonly", "readonly");
				textarea.style.position = "fixed";
				textarea.style.top = "-1000px";
				textarea.style.opacity = "0";
				document.body.appendChild(textarea);
				textarea.focus();
				textarea.select();
				textarea.setSelectionRange(0, textarea.value.length);
				let copied = false;
				try {
					copied = document.execCommand("copy");
				} finally {
					textarea.remove();
				}
				return copied;
			};
			try {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(value);
				} else if (!fallbackCopy()) {
					throw new Error("fallback-copy-failed");
				}
				getToast()?.success(successMessage);
				return true;
			} catch {
				try {
					const copied = fallbackCopy();
					if (!copied) {
						throw new Error("fallback-copy-failed");
					}
					getToast()?.success(successMessage);
					return true;
				} catch {
					getToast()?.error(errorMessage);
					return false;
				}
			}
		},
		bindConversationPreviewCopyButtons(doc) {
			if (!doc) return;
			const buttons = doc.querySelectorAll(".af-copy-btn[data-af-copy-target]");
			buttons.forEach((button) => {
				button.addEventListener("click", async () => {
					const selector = button.getAttribute("data-af-copy-target") || "";
					if (!selector) return;
					const target = doc.querySelector(selector);
					const text = typeof target?.textContent === "string" ? target.textContent.replace(/\u00a0/g, " ").trim() : "";
					if (!text) {
						getToast()?.warning("当前消息为空，无法复制");
						return;
					}
					const copied = await this.copyTextToClipboard(text, {
						successMessage: "消息已复制到剪贴板",
						errorMessage: "消息复制失败"
					});
					if (copied) {
						const prev = button.textContent;
						button.textContent = "已复制";
						setTimeout(() => {
							button.textContent = prev || "复制";
						}, 900);
					}
				});
			});
		},
		setConversationStatus(message) {
			const statusEl = this.element?.querySelector("#aifengyue-conversation-status");
			if (statusEl) {
				statusEl.textContent = message;
			}
		},
		setGlobalConversationStatus(message) {
			const statusEl = this.element?.querySelector("#aifengyue-conversation-global-status");
			if (statusEl) {
				statusEl.textContent = message;
			}
		},
		setConversationBusy(busy) {
			this.conversation.loading = !!busy;
			const chainSelect = this.element?.querySelector("#aifengyue-conversation-chain");
			const globalChainSelect = this.element?.querySelector("#aifengyue-conversation-global-chain");
			const refreshBtn = this.element?.querySelector("#aifengyue-conversation-refresh");
			const globalRefreshBtn = this.element?.querySelector("#aifengyue-conversation-global-refresh");
			const syncBtn = this.element?.querySelector("#aifengyue-conversation-sync");
			const exportBtn = this.element?.querySelector("#aifengyue-conversation-export");
			const importTriggerBtn = this.element?.querySelector("#aifengyue-conversation-import-trigger");
			const importFileInput = this.element?.querySelector("#aifengyue-conversation-import-file");
			const openPreviewBtn = this.element?.querySelector("#aifengyue-conversation-open-preview");
			const globalOpenPreviewBtn = this.element?.querySelector("#aifengyue-conversation-global-open-preview");
			const globalDeleteBtn = this.element?.querySelector("#aifengyue-conversation-global-delete");
			const switchBtn = this.element?.querySelector("#aifengyue-switch-account");
			if (chainSelect) chainSelect.disabled = !!busy;
			if (globalChainSelect) globalChainSelect.disabled = !!busy;
			if (refreshBtn) refreshBtn.disabled = !!busy;
			if (globalRefreshBtn) globalRefreshBtn.disabled = !!busy;
			if (syncBtn) syncBtn.disabled = !!busy;
			if (exportBtn) exportBtn.disabled = !!busy;
			if (importTriggerBtn) importTriggerBtn.disabled = !!busy;
			if (importFileInput) importFileInput.disabled = !!busy;
			if (openPreviewBtn) openPreviewBtn.disabled = !!busy;
			if (globalOpenPreviewBtn) globalOpenPreviewBtn.disabled = !!busy;
			if (globalDeleteBtn) globalDeleteBtn.disabled = !!busy;
			if (switchBtn) switchBtn.disabled = !!busy;
		},
		renderConversationSelectOptions() {
			const select = this.element?.querySelector("#aifengyue-conversation-chain");
			const openPreviewBtn = this.element?.querySelector("#aifengyue-conversation-open-preview");
			const exportBtn = this.element?.querySelector("#aifengyue-conversation-export");
			if (!select) return;
			select.innerHTML = "";
			if (!this.conversation.chains.length) {
				const option = document.createElement("option");
				option.value = "";
				option.textContent = "暂无链路";
				select.appendChild(option);
				select.value = "";
				if (openPreviewBtn) openPreviewBtn.disabled = true;
				if (exportBtn) exportBtn.disabled = true;
				this.renderConversationLatestQueryTail();
				return;
			}
			this.conversation.chains.forEach((chain, index) => {
				const option = document.createElement("option");
				option.value = chain.chainId;
				const conversationCount = Array.isArray(chain.conversationIds) ? chain.conversationIds.length : 0;
				const messageCount = Number(chain.messageCount || 0);
				const answerCount = Number(chain.answerCount || 0);
				const updatedAt = chain.updatedAt ? new Date(chain.updatedAt).toLocaleString() : "-";
				option.textContent = `链路${index + 1} | ${conversationCount}会话 | ${answerCount}答复 | ${messageCount}消息 | ${updatedAt}`;
				select.appendChild(option);
			});
			if (this.conversation.activeChainId) {
				select.value = this.conversation.activeChainId;
			}
			if (openPreviewBtn) {
				openPreviewBtn.disabled = false;
			}
			if (exportBtn && !this.conversation.loading) {
				exportBtn.disabled = false;
			}
			this.renderConversationLatestQueryTail();
		},
		renderConversationLatestQueryTail() {
			const tailEl = this.element?.querySelector("#aifengyue-conversation-latest-query");
			if (!tailEl) return;
			if (!Array.isArray(this.conversation.chains) || this.conversation.chains.length === 0) {
				tailEl.textContent = "-";
				return;
			}
			const activeChain = this.conversation.chains.find((chain) => chain.chainId === this.conversation.activeChainId) || this.conversation.chains[0];
			const latestQueryTail = typeof activeChain?.latestQueryTail === "string" ? activeChain.latestQueryTail.trim() : "";
			tailEl.textContent = latestQueryTail || "-";
		},
		renderGlobalConversationSelectOptions() {
			const select = this.element?.querySelector("#aifengyue-conversation-global-chain");
			const openPreviewBtn = this.element?.querySelector("#aifengyue-conversation-global-open-preview");
			const deleteBtn = this.element?.querySelector("#aifengyue-conversation-global-delete");
			if (!select) return;
			select.innerHTML = "";
			if (!Array.isArray(this.conversation.globalChains) || this.conversation.globalChains.length === 0) {
				const option = document.createElement("option");
				option.value = "";
				option.textContent = "暂无链路";
				select.appendChild(option);
				select.value = "";
				this.conversation.activeGlobalChainId = "";
				if (openPreviewBtn) openPreviewBtn.disabled = true;
				if (deleteBtn) deleteBtn.disabled = true;
				this.renderGlobalConversationLatestQueryTail();
				return;
			}
			this.conversation.globalChains.forEach((chain, index) => {
				const option = document.createElement("option");
				option.value = chain.chainId;
				const conversationCount = Array.isArray(chain.conversationIds) ? chain.conversationIds.length : 0;
				const messageCount = Number(chain.messageCount || 0);
				const answerCount = Number(chain.answerCount || 0);
				const updatedAt = chain.updatedAt ? new Date(chain.updatedAt).toLocaleString() : "-";
				const appLabel = typeof chain.appName === "string" && chain.appName.trim() ? chain.appName.trim() : chain.appId;
				option.textContent = `${index + 1}. ${appLabel} | ${conversationCount}会话 | ${answerCount}答复 | ${messageCount}消息 | ${updatedAt}`;
				select.appendChild(option);
			});
			if (this.conversation.activeGlobalChainId && this.conversation.globalChains.some((chain) => chain.chainId === this.conversation.activeGlobalChainId)) {
				select.value = this.conversation.activeGlobalChainId;
			} else {
				this.conversation.activeGlobalChainId = this.conversation.globalChains[0]?.chainId || "";
				select.value = this.conversation.activeGlobalChainId;
			}
			if (openPreviewBtn) {
				openPreviewBtn.disabled = false;
			}
			if (deleteBtn && !this.conversation.loading) {
				deleteBtn.disabled = false;
			}
			this.renderGlobalConversationLatestQueryTail();
		},
		getActiveGlobalConversationChain() {
			if (!Array.isArray(this.conversation.globalChains) || this.conversation.globalChains.length === 0) {
				return null;
			}
			return this.conversation.globalChains.find((chain) => chain.chainId === this.conversation.activeGlobalChainId) || this.conversation.globalChains[0];
		},
		renderGlobalConversationLatestQueryTail() {
			const tailEl = this.element?.querySelector("#aifengyue-conversation-global-latest-query");
			if (!tailEl) return;
			const activeChain = this.getActiveGlobalConversationChain();
			if (!activeChain) {
				tailEl.textContent = "-";
				return;
			}
			const latestQueryTail = typeof activeChain.latestQueryTail === "string" ? activeChain.latestQueryTail.trim() : "";
			tailEl.textContent = latestQueryTail || "-";
		},
		async renderConversationViewer({ appId = "", chainId = "" } = {}) {
			const viewer = document.getElementById("aifengyue-conversation-viewer");
			if (!viewer) {
				console.warn("[AI风月注册助手][CONV] 未找到会话预览 iframe");
				return;
			}
			const resolvedAppId = (typeof appId === "string" ? appId.trim() : "") || this.conversation.appId;
			const resolvedChainId = (typeof chainId === "string" ? chainId.trim() : "") || this.conversation.activeChainId;
			if (!resolvedAppId || !resolvedChainId) {
				viewer.srcdoc = "<html><body><p style=\"font-family:Segoe UI;padding:16px;\">暂无可展示会话。</p></body></html>";
				return;
			}
			const html = await ChatHistoryService.buildChainViewerHtml({
				appId: resolvedAppId,
				chainId: resolvedChainId
			});
			viewer.onload = () => {
				try {
					const doc = viewer.contentDocument;
					if (!doc) return;
					this.bindConversationPreviewCopyButtons(doc);
					const scrollToBottom = () => {
						const scrolling = doc.scrollingElement || doc.documentElement || doc.body;
						if (scrolling) {
							scrolling.scrollTop = scrolling.scrollHeight;
						}
						const container = doc.querySelector(".chat-container");
						if (container && container.parentElement) {
							container.parentElement.scrollTop = container.parentElement.scrollHeight;
						}
					};
					scrollToBottom();
					setTimeout(scrollToBottom, 60);
					setTimeout(scrollToBottom, 220);
				} catch (error) {
					console.warn("[AI风月注册助手][CONV] 预览滚动到底部失败", error);
				}
			};
			viewer.srcdoc = html;
		},
		async refreshConversationPanel({ showToast = false, keepSelection = true } = {}) {
			if (!this.element) return;
			const autoRegister = getAutoRegister();
			if (!autoRegister) {
				this.setConversationStatus("AutoRegister 未初始化");
				await this.refreshGlobalConversationPanel({
					showToast: false,
					keepSelection: true,
					useBusy: false
				});
				return;
			}
			this.setConversationBusy(true);
			try {
				const previousChainId = keepSelection ? this.conversation.activeChainId : "";
				const result = await autoRegister.loadConversationChainsForCurrentApp();
				this.conversation.appId = result.appId || "";
				this.conversation.chains = Array.isArray(result.chains) ? result.chains : [];
				this.conversation.activeChainId = "";
				if (previousChainId && this.conversation.chains.some((chain) => chain.chainId === previousChainId)) {
					this.conversation.activeChainId = previousChainId;
				} else if (result.activeChainId) {
					this.conversation.activeChainId = result.activeChainId;
				} else if (this.conversation.chains[0]?.chainId) {
					this.conversation.activeChainId = this.conversation.chains[0].chainId;
				}
				if (this.conversation.appId && this.conversation.activeChainId) {
					ChatHistoryService.setActiveChainId(this.conversation.appId, this.conversation.activeChainId);
				}
				this.renderConversationSelectOptions();
				await this.renderConversationViewer();
				await this.refreshGlobalConversationPanel({
					showToast: false,
					keepSelection: true,
					useBusy: false
				});
				if (!this.conversation.appId) {
					this.setConversationStatus("当前页面不是应用详情页，无法读取会话链。");
				} else if (!this.conversation.chains.length) {
					this.setConversationStatus("本地暂无会话链，可先执行“更换账号”或手动同步。");
				} else {
					const lastSync = this.conversation.activeChainId ? ChatHistoryService.getChainLastSync(this.conversation.activeChainId) : 0;
					const lastSyncText = lastSync ? new Date(lastSync).toLocaleString() : "未同步";
					this.setConversationStatus(`已加载 ${this.conversation.chains.length} 条链路，最近同步: ${lastSyncText}`);
				}
				if (showToast) {
					getToast()?.success("会话链路已刷新");
				}
			} catch (error) {
				this.setConversationStatus(`刷新失败: ${error.message}`);
				getToast()?.error(`会话刷新失败: ${error.message}`);
			} finally {
				this.setConversationBusy(false);
			}
		},
		async refreshGlobalConversationPanel({ showToast = false, keepSelection = true, useBusy = true } = {}) {
			if (!this.element) return;
			if (useBusy) {
				this.setConversationBusy(true);
			}
			try {
				const previousChainId = keepSelection ? this.conversation.activeGlobalChainId : "";
				const chains = await ChatHistoryService.listAllChains();
				const chainsWithDetails = await Promise.all(chains.map(async (chain) => {
					const [stats, appMeta] = await Promise.all([ChatHistoryService.getChainStats(chain.chainId), ChatHistoryService.getAppMeta(chain.appId)]);
					return {
						...chain,
						...stats,
						appName: typeof appMeta?.name === "string" ? appMeta.name : ""
					};
				}));
				this.conversation.globalChains = chainsWithDetails;
				this.conversation.activeGlobalChainId = "";
				if (previousChainId && chainsWithDetails.some((chain) => chain.chainId === previousChainId)) {
					this.conversation.activeGlobalChainId = previousChainId;
				} else if (chainsWithDetails[0]?.chainId) {
					this.conversation.activeGlobalChainId = chainsWithDetails[0].chainId;
				}
				this.renderGlobalConversationSelectOptions();
				if (!chainsWithDetails.length) {
					this.setGlobalConversationStatus("本地暂无链路，可先执行更换账号或导入 JSON。");
				} else {
					const appCount = new Set(chainsWithDetails.map((item) => item.appId).filter(Boolean)).size;
					this.setGlobalConversationStatus(`已加载 ${chainsWithDetails.length} 条链路，覆盖 ${appCount} 个 App。`);
				}
				if (showToast) {
					getToast()?.success("全局链路已刷新");
				}
			} catch (error) {
				this.setGlobalConversationStatus(`全局链路刷新失败: ${error.message}`);
				getToast()?.error(`全局链路刷新失败: ${error.message}`);
			} finally {
				if (useBusy) {
					this.setConversationBusy(false);
				}
			}
		},
		async openGlobalConversationPreview() {
			const chain = this.getActiveGlobalConversationChain();
			if (!chain?.appId || !chain?.chainId) {
				getToast()?.warning("当前没有可预览的全局链路");
				return;
			}
			this.openConversationModal();
			await this.renderConversationViewer({
				appId: chain.appId,
				chainId: chain.chainId
			});
		},
		async deleteSelectedGlobalConversationChain() {
			const chain = this.getActiveGlobalConversationChain();
			if (!chain?.chainId) {
				getToast()?.warning("当前没有可删除的链路");
				return;
			}
			const appLabel = typeof chain.appName === "string" && chain.appName.trim() ? `${chain.appName.trim()} (${chain.appId})` : chain.appId;
			const confirmed = confirm(`确认删除该链路？\nApp: ${appLabel || "-"}\nChain: ${chain.chainId}\n\n删除后将移除该链路下全部本地消息，且不可恢复。`);
			if (!confirmed) return;
			this.setConversationBusy(true);
			try {
				const summary = await ChatHistoryService.deleteChain(chain.chainId);
				if (!summary.deleted) {
					this.setGlobalConversationStatus(`链路不存在或已删除：${chain.chainId}`);
					getToast()?.warning("目标链路不存在或已删除");
					await this.refreshGlobalConversationPanel({
						showToast: false,
						keepSelection: false,
						useBusy: false
					});
					return;
				}
				if (this.conversation.activeChainId === chain.chainId) {
					this.conversation.activeChainId = "";
				}
				if (this.conversation.activeGlobalChainId === chain.chainId) {
					this.conversation.activeGlobalChainId = "";
				}
				await this.refreshConversationPanel({
					showToast: false,
					keepSelection: false
				});
				const statusText = `已删除链路：${chain.chainId}（删除 ${summary.deletedMessageCount} 条消息）`;
				this.setGlobalConversationStatus(statusText);
				this.setConversationStatus(statusText);
				getToast()?.success(statusText);
			} catch (error) {
				this.setGlobalConversationStatus(`删除失败: ${error.message}`);
				getToast()?.error(`删除链路失败: ${error.message}`);
			} finally {
				this.setConversationBusy(false);
			}
		},
		async syncConversationPanel() {
			const autoRegister = getAutoRegister();
			if (!autoRegister) {
				this.setConversationStatus("AutoRegister 未初始化");
				return;
			}
			this.setConversationBusy(true);
			try {
				const summary = await autoRegister.manualSyncConversationChain({
					appId: this.conversation.appId,
					chainId: this.conversation.activeChainId
				});
				const message = `同步完成: 成功 ${summary.successCount}/${summary.conversationIds.length}，抓取 ${summary.totalFetched} 条，写入 ${summary.totalSaved} 条`;
				this.setConversationStatus(message);
				getToast()?.success(message);
				if (summary.hasIncomplete) {
					getToast()?.warning("检测到 has_past_record/is_earliest_data_page 异常，历史可能仍不完整");
				}
				if (summary.failedCount > 0) {
					getToast()?.warning(`有 ${summary.failedCount} 个会话同步失败`);
				}
				if (Number(summary.skippedNoPermissionCount || 0) > 0) {
					getToast()?.info(`已跳过 ${summary.skippedNoPermissionCount} 个无权限旧会话`);
				}
				await this.refreshConversationPanel({
					showToast: false,
					keepSelection: true
				});
			} catch (error) {
				this.setConversationStatus(`手动同步失败: ${error.message}`);
				getToast()?.error(`手动同步失败: ${error.message}`);
			} finally {
				this.setConversationBusy(false);
			}
		},
		async exportConversationChainJson() {
			if (!this.conversation.appId || !this.conversation.activeChainId) {
				getToast()?.warning("当前没有可导出的会话链");
				return;
			}
			this.setConversationBusy(true);
			try {
				const bundle = await ChatHistoryService.exportChainBundle({
					appId: this.conversation.appId,
					chainId: this.conversation.activeChainId
				});
				const content = JSON.stringify(bundle, null, 2);
				const blob = new Blob([content], { type: "application/json;charset=utf-8" });
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				const safeAppId = String(this.conversation.appId).replace(/[^a-zA-Z0-9_-]/g, "_");
				const safeChainId = String(this.conversation.activeChainId).replace(/[^a-zA-Z0-9_-]/g, "_");
				link.href = url;
				link.download = `aifengyue-chain-${safeAppId}-${safeChainId}.json`;
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(url);
				this.setConversationStatus(`导出完成：${bundle.summary?.messageCount ?? 0} 条消息`);
				getToast()?.success("会话链导出成功");
			} catch (error) {
				this.setConversationStatus(`导出失败: ${error.message}`);
				getToast()?.error(`导出失败: ${error.message}`);
			} finally {
				this.setConversationBusy(false);
			}
		},
		readTextFile(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
				reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
				reader.readAsText(file, "utf-8");
			});
		},
		async importConversationChainJson(file) {
			if (!file) return;
			this.setConversationBusy(true);
			try {
				const text = await this.readTextFile(file);
				if (!text.trim()) {
					throw new Error("导入文件内容为空");
				}
				let payload;
				try {
					payload = JSON.parse(text);
				} catch {
					throw new Error("导入文件不是合法 JSON");
				}
				const summary = await ChatHistoryService.importChainBundle({
					payload,
					preferAppId: this.conversation.appId || ""
				});
				this.setConversationStatus(`导入完成: ${summary.conversationCount} 会话，保存 ${summary.savedCount}/${summary.importedMessageCount} 条消息`);
				getToast()?.success("会话链导入成功");
				await this.refreshConversationPanel({
					showToast: false,
					keepSelection: true
				});
			} catch (error) {
				this.setConversationStatus(`导入失败: ${error.message}`);
				getToast()?.error(`导入失败: ${error.message}`);
			} finally {
				this.setConversationBusy(false);
			}
		},
		getLayoutMode() {
			const mode = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_LAYOUT_MODE, "inline");
			return mode === "floating" ? "floating" : "inline";
		},
		tabLabel(tab) {
			switch (tab) {
				case "register": return "注册";
				case "tools": return "工具";
				case "conversation": return "会话";
				case "settings": return "设置";
				default: return "注册";
			}
		},
		getDefaultTab() {
			const tab = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_TAB, "register");
			return VALID_TABS.includes(tab) ? tab : "register";
		},
		setDefaultTab(tab) {
			const normalized = VALID_TABS.includes(tab) ? tab : "register";
			gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_TAB, normalized);
			const input = this.element?.querySelector?.("#aifengyue-default-tab");
			if (input) {
				input.value = normalized;
			}
		},
		getDefaultOpen() {
			const saved = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_OPEN, false);
			return saved === true || saved === "true" || saved === 1 || saved === "1";
		},
		setDefaultOpen(defaultOpen) {
			const normalized = !!defaultOpen;
			gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_DEFAULT_OPEN, normalized);
			const input = this.element?.querySelector?.("#aifengyue-default-open");
			if (input) {
				input.value = normalized ? "open" : "closed";
			}
		},
		getAutoReloadEnabled() {
			const saved = gmGetValue(CONFIG.STORAGE_KEYS.AUTO_RELOAD_ENABLED, true);
			return !(saved === false || saved === "false" || saved === 0 || saved === "0");
		},
		setAutoReloadEnabled(enabled) {
			const normalized = !!enabled;
			gmSetValue(CONFIG.STORAGE_KEYS.AUTO_RELOAD_ENABLED, normalized);
			const input = this.element?.querySelector?.("#aifengyue-auto-reload-toggle");
			if (input) {
				input.checked = normalized;
			}
		},
		setLayoutMode(mode) {
			this.layoutMode = mode === "floating" ? "floating" : "inline";
			gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_LAYOUT_MODE, this.layoutMode);
			this.applyLayoutModeClass();
		},
		getTheme() {
			const saved = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_THEME, "light");
			return saved === "dark" ? "dark" : "light";
		},
		setTheme(theme) {
			this.theme = theme === "dark" ? "dark" : "light";
			gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_THEME, this.theme);
			this.applyTheme();
		},
		applyTheme() {
			if (!this.element) return;
			this.element.dataset.theme = this.theme;
			const btn = this.element.querySelector(".aifengyue-theme-toggle");
			if (btn) btn.textContent = this.theme === "dark" ? "☀" : "🌙";
		},
		toggleTheme() {
			this.setTheme(this.theme === "dark" ? "light" : "dark");
		},
		applyLayoutModeClass() {
			if (!this.element) return;
			const isInline = this.layoutMode === "inline";
			this.element.classList.toggle("mode-inline", isInline);
			this.element.classList.toggle("mode-floating", !isInline);
			const modeInput = this.element.querySelector("#aifengyue-layout-mode");
			if (modeInput) {
				modeInput.value = this.layoutMode;
			}
			this.syncInlineSpaceClass();
		},
		syncInlineSpaceClass() {
			const isInlineOpen = this.layoutMode === "inline" && this.isOpen;
			document.documentElement.classList.remove("aifengyue-sidebar-inline-mode");
			document.body.classList.toggle("aifengyue-sidebar-inline-mode", isInlineOpen);
		},
		updateUsageDisplay() {
			if (!this.element) return;
			const used = ApiService.getUsageCount();
			const limit = CONFIG.API_QUOTA_LIMIT;
			const remaining = ApiService.getRemainingQuota();
			const percentage = Math.min(used / limit * 100, 100);
			const usageText = this.element.querySelector("#aifengyue-usage-text");
			const usageBar = this.element.querySelector("#aifengyue-usage-bar");
			const usageRemaining = this.element.querySelector("#aifengyue-usage-remaining");
			if (usageText) usageText.textContent = `${used} / ${limit}`;
			if (usageBar) {
				usageBar.style.width = `${percentage}%`;
				if (percentage >= 90) {
					usageBar.style.background = "linear-gradient(90deg, #dc2626, #b91c1c)";
				} else if (percentage >= 70) {
					usageBar.style.background = "linear-gradient(90deg, #d97706, #b45309)";
				} else {
					usageBar.style.background = "linear-gradient(90deg, #0d9488, #14b8a6)";
				}
			}
			if (usageRemaining) usageRemaining.textContent = `剩余: ${remaining} 次`;
		},
		toggle() {
			this.isOpen ? this.close() : this.open();
		},
		open() {
			if (!this.element) return;
			this.element.classList.add("open");
			const toggle = document.getElementById("aifengyue-sidebar-toggle");
			if (toggle) {
				toggle.classList.add("is-open");
				toggle.textContent = "收起助手";
			}
			this.isOpen = true;
			this.syncInlineSpaceClass();
		},
		close() {
			if (!this.element) return;
			this.element.classList.remove("open");
			const toggle = document.getElementById("aifengyue-sidebar-toggle");
			if (toggle) {
				toggle.classList.remove("is-open");
				toggle.textContent = "打开助手";
			}
			this.isOpen = false;
			this.syncInlineSpaceClass();
		},
		resetState() {
			Object.assign(this.state, SIDEBAR_INITIAL_STATE);
			this.render();
		},
		updateState(updates) {
			Object.assign(this.state, updates);
			this.render();
		},
		render() {
			if (!this.element) return;
			const statusMap = {
				idle: {
					text: "空闲",
					color: "idle"
				},
				generating: {
					text: "生成中...",
					color: "generating"
				},
				waiting: {
					text: "等待操作",
					color: "polling"
				},
				fetching: {
					text: "执行中...",
					color: "polling"
				},
				success: {
					text: "成功",
					color: "success"
				},
				error: {
					text: "错误",
					color: "error"
				}
			};
			const status = statusMap[this.state.status] || statusMap.idle;
			this.element.querySelectorAll("#aifengyue-status-dot, #aifengyue-conv-flow-status-dot").forEach((dot) => {
				dot.className = `aifengyue-status-dot ${status.color}`;
			});
			this.element.querySelectorAll("#aifengyue-status-text, #aifengyue-conv-flow-status-text").forEach((el) => {
				el.textContent = status.text;
			});
			this.element.querySelectorAll("#aifengyue-status-message, #aifengyue-conv-flow-status-message").forEach((el) => {
				el.textContent = this.state.statusMessage;
			});
			const email = this.element.querySelector("#aifengyue-email");
			const username = this.element.querySelector("#aifengyue-username");
			const password = this.element.querySelector("#aifengyue-password");
			const code = this.element.querySelector("#aifengyue-code");
			const debugToggle = this.element.querySelector("#aifengyue-debug-toggle");
			const autoReloadToggle = this.element.querySelector("#aifengyue-auto-reload-toggle");
			if (email) email.textContent = this.state.email || "未生成";
			if (username) username.textContent = this.state.username || "未生成";
			if (password) password.textContent = this.state.password || "未生成";
			if (code) code.textContent = this.state.verificationCode || "等待中...";
			if (debugToggle) debugToggle.checked = isDebugEnabled();
			if (autoReloadToggle) autoReloadToggle.checked = this.getAutoReloadEnabled();
			this.updateToolPanel();
		},
		updateToolPanel() {
			if (!this.element) return;
			const autoRegister = getAutoRegister();
			const extractor = getIframeExtractor();
			const sorter = getModelPopupSorter();
			const startBtn = this.element.querySelector("#aifengyue-start");
			const manualGroup = this.element.querySelector("#aifengyue-manual-group");
			const registerHint = this.element.querySelector("#aifengyue-register-hint");
			const onRegisterPage = !!autoRegister?.isRegisterPage();
			if (startBtn) {
				startBtn.textContent = onRegisterPage ? "📝 开始辅助填表" : "🚀 开始注册（自动模式）";
			}
			if (manualGroup) {
				manualGroup.style.display = onRegisterPage ? "" : "none";
			}
			if (registerHint) {
				registerHint.textContent = onRegisterPage ? "当前注册页：可辅助填表，验证码需手动完成。" : "非注册页：可用一键注册或更换账号。";
			}
			const isDetail = !!extractor?.checkDetailPage();
			const canExtract = !!extractor?.isExtractAvailable();
			const extractWrap = this.element.querySelector("#aifengyue-extract-html-wrap");
			const sortWrap = this.element.querySelector("#aifengyue-sort-wrap");
			const toolsEmpty = this.element.querySelector("#aifengyue-tools-empty");
			const sortToggle = this.element.querySelector("#aifengyue-sort-toggle");
			if (extractWrap) {
				extractWrap.style.display = canExtract ? "" : "none";
			}
			if (sortWrap) {
				sortWrap.style.display = isDetail ? "" : "none";
			}
			if (toolsEmpty) {
				toolsEmpty.style.display = !canExtract && !isDetail ? "" : "none";
			}
			if (sortToggle) {
				sortToggle.checked = sorter?.isSortEnabled?.() ?? true;
			}
			if (this.activeTab === "conversation" && !this.conversation.loading) {
				const currentAppId = autoRegister?.extractInstalledAppId?.() || "";
				if (currentAppId !== this.conversation.appId) {
					this.refreshConversationPanel({
						showToast: false,
						keepSelection: false
					}).catch((error) => {
						this.setConversationStatus(`会话面板刷新失败: ${error.message}`);
					});
				}
			}
		}
	};

//#endregion
//#region src/ui/toast.js
	const Toast = {
		container: null,
		init() {
			if (this.container) return;
			this.container = document.createElement("div");
			this.container.id = "aifengyue-toast-container";
			document.body.appendChild(this.container);
			gmAddStyle(`
            #aifengyue-toast-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 2147483647;
                display: flex;
                flex-direction: column-reverse;
                gap: 10px;
                pointer-events: none;
            }
            .aifengyue-toast {
                padding: 12px 20px;
                border-radius: 8px;
                color: #fff;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                animation: aifengyue-toast-in 0.3s ease-out;
                pointer-events: auto;
                max-width: 350px;
                word-break: break-word;
            }
            .aifengyue-toast.success { background: linear-gradient(135deg, #10b981, #059669); }
            .aifengyue-toast.error { background: linear-gradient(135deg, #ef4444, #dc2626); }
            .aifengyue-toast.info { background: linear-gradient(135deg, #3b82f6, #2563eb); }
            .aifengyue-toast.warning { background: linear-gradient(135deg, #f59e0b, #d97706); }
            .aifengyue-toast.out { animation: aifengyue-toast-out 0.3s ease-in forwards; }
            @keyframes aifengyue-toast-in {
                from { opacity: 0; transform: translateX(100%); }
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes aifengyue-toast-out {
                from { opacity: 1; transform: translateX(0); }
                to { opacity: 0; transform: translateX(100%); }
            }
        `);
		},
		show(message, type = "info", duration = 3e3) {
			this.init();
			const toast = document.createElement("div");
			toast.className = `aifengyue-toast ${type}`;
			toast.textContent = message;
			this.container.appendChild(toast);
			setTimeout(() => {
				toast.classList.add("out");
				setTimeout(() => toast.remove(), 300);
			}, duration);
		},
		success(msg, duration) {
			this.show(msg, "success", duration);
		},
		error(msg, duration) {
			this.show(msg, "error", duration);
		},
		info(msg, duration) {
			this.show(msg, "info", duration);
		},
		warning(msg, duration) {
			this.show(msg, "warning", duration);
		}
	};

//#endregion
//#region src/utils/random.js
	function randomString(length, charset = "abcdefghijklmnopqrstuvwxyz0123456789") {
		let result = "";
		for (let i = 0; i < length; i++) {
			result += charset.charAt(Math.floor(Math.random() * charset.length));
		}
		return result;
	}
	function generateUsername() {
		const prefixes = [
			"user",
			"ai",
			"cat",
			"test",
			"demo",
			"new",
			"cool",
			"pro",
			"dev",
			"fan"
		];
		const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
		return prefix + randomString(6, "abcdefghijklmnopqrstuvwxyz0123456789");
	}
	function generatePassword() {
		const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
		const digits = "0123456789";
		let password = randomString(4, letters) + randomString(4, digits);
		password = password.split("").sort(() => Math.random() - .5).join("");
		return password;
	}
	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

//#endregion
//#region src/utils/code-extractor.js
	function extractVerificationCode(content) {
		if (!content) return null;
		const plainText = extractPlainText(content);
		for (const pattern of CONFIG.VERIFICATION_CODE_PATTERNS) {
			const match = plainText.match(pattern);
			if (match && match[1]) {
				return match[1];
			}
		}
		const codeFromHtml = extractCodeFromHtml(content);
		if (codeFromHtml) {
			return codeFromHtml;
		}
		const standaloneCode = findStandaloneCode(plainText);
		if (standaloneCode) {
			return standaloneCode;
		}
		return null;
	}
	function extractPlainText(html) {
		let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
		text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
		text = text.replace(/<[^>]+>/g, " ");
		text = text.replace(/&nbsp;/g, " ").replace(/&[a-z]+;/gi, " ");
		text = text.replace(/\s+/g, " ").trim();
		return text;
	}
	function extractCodeFromHtml(html) {
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, "text/html");
			const candidates = [];
			const elements = doc.querySelectorAll("td, span, div, p, strong, b");
			for (const el of elements) {
				const text = (el.textContent || "").trim();
				if (/^\d{4,8}$/.test(text)) {
					const style = el.getAttribute("style") || "";
					const fontSize = style.match(/font-size:\s*(\d+)/i);
					const fontWeight = style.match(/font-weight:\s*(bold|\d+)/i);
					let score = 0;
					if (fontSize) {
						const size = parseInt(fontSize[1], 10);
						if (size >= 28) score += 10;
						else if (size >= 20) score += 5;
						else if (size >= 16) score += 2;
					}
					if (fontWeight) {
						score += 3;
					}
					if (text.length === 6) {
						score += 2;
					}
					if (score > 0) {
						candidates.push({
							code: text,
							score
						});
					}
				}
			}
			if (candidates.length > 0) {
				candidates.sort((a, b) => b.score - a.score);
				return candidates[0].code;
			}
		} catch (e) {
			console.error("[验证码提取] HTML 解析失败:", e);
		}
		return null;
	}
	function findStandaloneCode(text) {
		const matches = text.match(/\b(\d{4,8})\b/g);
		if (!matches) return null;
		const validCodes = matches.filter((code) => {
			if (matches.length === 1) return true;
			if (code.length === 6) return true;
			return false;
		});
		const sixDigit = validCodes.find((code) => code.length === 6);
		if (sixDigit) return sixDigit;
		return validCodes[0] || null;
	}

//#endregion
//#region src/utils/dom.js
	function simulateInput(element, value) {
		if (!element) return;
		element.focus();
		const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		nativeInputValueSetter.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
		element.dispatchEvent(new Event("change", { bubbles: true }));
	}

//#endregion
//#region src/features/auto-register.js
	const X_LANGUAGE$1 = "zh-Hans";
	const SITE_ENDPOINTS = {
		SEND_CODE: "/console/api/register/email",
		SLIDE_GET: "/go/api/slide/get",
		REGISTER: "/console/api/register",
		ACCOUNT_GENDER: "/console/api/account/gender",
		FAVORITE_TAGS: "/console/api/account_extend/favorite_tags",
		ACCOUNT_EXTEND_SET: "/console/api/account/extend_set",
		ACCOUNT_PROFILE: "/go/api/account/profile",
		APP_DETAILS: "/go/api/apps",
		APPS: "/console/api/apps",
		INSTALLED_MESSAGES: "/console/api/installed-apps",
		CHAT_MESSAGES: "/console/api/installed-apps"
	};
	const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1 = 3;
	const DEFAULT_SWITCH_WORLD_BOOK_TRIGGER = "%%test";
	function readErrorMessage(payload, fallback) {
		if (!payload || typeof payload !== "object") return fallback;
		const raw = payload.error ?? payload.message ?? payload.msg ?? payload.detail ?? payload.errmsg;
		if (typeof raw !== "string") return fallback;
		const message = raw.trim();
		if (!message || /^(ok|success)$/i.test(message)) return fallback;
		return message;
	}
	function normalizeTimestamp(value) {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string" && value.trim()) {
			const parsedNumber = Number(value);
			if (Number.isFinite(parsedNumber)) {
				return parsedNumber;
			}
			const parsedDate = Date.parse(value);
			if (Number.isFinite(parsedDate)) {
				return parsedDate;
			}
		}
		return 0;
	}
	function decodeEscapedText$1(raw) {
		if (typeof raw !== "string") return "";
		let value = raw;
		for (let i = 0; i < 3; i++) {
			if (!/\\u[0-9a-fA-F]{4}|\\[nrt"\\/]/.test(value)) {
				break;
			}
			try {
				const next = JSON.parse(`"${value.replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`);
				if (next === value) break;
				value = next;
			} catch {
				break;
			}
		}
		return value;
	}
	function isAnswerEmpty(raw) {
		if (raw === null || raw === undefined) return true;
		if (typeof raw !== "string") return false;
		const source = raw.trim().toLowerCase();
		if (!source) return true;
		if (source === "null" || source === "undefined" || source === "\"\"" || source === "''") {
			return true;
		}
		const decoded = decodeEscapedText$1(raw).trim().toLowerCase();
		if (!decoded) return true;
		if (decoded === "null" || decoded === "undefined" || decoded === "\"\"" || decoded === "''") {
			return true;
		}
		return false;
	}
	function normalizeSwitchTriggerWord(value) {
		const source = typeof value === "string" ? value.trim() : "";
		if (!source) return "";
		const matched = source.match(/%%[^\s%]+(?:%%)?/);
		return matched?.[0] ? matched[0].trim() : "";
	}
	function cloneJsonSafe(value) {
		try {
			return JSON.parse(JSON.stringify(value));
		} catch {
			return null;
		}
	}
	function stringifyJsonWithUnicodeEscapes(value) {
		const json = JSON.stringify(value);
		if (typeof json !== "string") return "";
		return json.replace(/[^\x20-\x7E]/g, (char) => {
			const code = char.charCodeAt(0);
			return `\\u${code.toString(16).padStart(4, "0")}`;
		});
	}
	function randomConversationSuffix(length = 3) {
		const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
		let output = "";
		for (let i = 0; i < length; i++) {
			output += chars[Math.floor(Math.random() * chars.length)];
		}
		return output;
	}
	function buildTokenSignature(token) {
		const normalized = typeof token === "string" ? token.trim() : "";
		if (!normalized) return "";
		let hash = 2166136261;
		for (let i = 0; i < normalized.length; i++) {
			hash ^= normalized.charCodeAt(i);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		const hex = (hash >>> 0).toString(16).padStart(8, "0");
		return `tk-${normalized.length}-${hex}`;
	}
	function withHttpStatusError(message, httpStatus) {
		const error = new Error(message);
		if (typeof httpStatus === "number" && Number.isFinite(httpStatus)) {
			error.httpStatus = httpStatus;
		}
		return error;
	}
	const AutoRegister = {
		registrationStartTime: null,
		switchingAccount: false,
		resolveRetryAttempts(maxAttempts) {
			const parsed = Number(maxAttempts);
			if (Number.isInteger(parsed) && parsed >= 1) {
				return parsed;
			}
			return DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1;
		},
		isAutoReloadEnabled() {
			const saved = gmGetValue(CONFIG.STORAGE_KEYS.AUTO_RELOAD_ENABLED, true);
			return !(saved === false || saved === "false" || saved === 0 || saved === "0");
		},
		reloadPageIfEnabled({ delayMs = 0, runCtx, step = "RELOAD", reason = "" } = {}) {
			if (!this.isAutoReloadEnabled()) {
				logInfo$1(runCtx, step, "自动刷新开关已关闭，跳过 window.location.reload", { reason: reason || null });
				Toast.info("自动刷新已关闭，请手动刷新页面", 3200);
				return false;
			}
			const normalizedDelay = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 0;
			if (normalizedDelay > 0) {
				setTimeout(() => {
					window.location.reload();
				}, normalizedDelay);
			} else {
				window.location.reload();
			}
			logInfo$1(runCtx, step, "已触发 window.location.reload", {
				reason: reason || null,
				delayMs: normalizedDelay
			});
			return true;
		},
		isObjectiveRetryError(error) {
			const status = Number(error?.httpStatus || 0);
			if (status === 408 || status === 429 || status >= 500) {
				return true;
			}
			const message = String(error?.message || "").toLowerCase();
			if (!message) return false;
			return message.includes("timeout") || message.includes("超时") || message.includes("network") || message.includes("网络") || message.includes("gm 请求失败") || message.includes("failed") || message.includes("中止") || message.includes("abort");
		},
		async runWithObjectiveRetries(task, { runCtx, step = "RETRY", actionName = "请求", maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1, baseDelayMs = 800 } = {}) {
			const attempts = this.resolveRetryAttempts(maxAttempts);
			let lastError = null;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					return await task(attempt, attempts);
				} catch (error) {
					lastError = error;
					const retriable = this.isObjectiveRetryError(error);
					const hasNext = attempt < attempts;
					if (!retriable || !hasNext) {
						throw error;
					}
					const waitMs = baseDelayMs * attempt;
					logWarn$1(runCtx, step, `${actionName} 发生客观错误，${waitMs}ms 后重试 (${attempt + 1}/${attempts})`, {
						message: error?.message || String(error),
						httpStatus: Number(error?.httpStatus || 0) || null
					});
					await delay(waitMs);
				}
			}
			throw lastError || new Error(`${actionName} 执行失败`);
		},
		isRegisterPage() {
			return !!document.querySelector("input#name") && !!document.querySelector("input#email") && !!document.querySelector("input#password");
		},
		getFormElements() {
			return {
				usernameInput: document.querySelector("input#name"),
				emailInput: document.querySelector("input#email"),
				passwordInput: document.querySelector("input#password"),
				codeInput: document.querySelector("input[placeholder*=\"验证码\"]") || document.querySelector("input[name=\"code\"]") || document.querySelector("input[id=\"code\"]")
			};
		},
		simulateInput(element, value) {
			simulateInput(element, value);
		},
		findAndClickSendCodeButton() {
			const buttons = document.querySelectorAll("button, a, span[role=\"button\"]");
			for (const btn of buttons) {
				const text = (btn.textContent || btn.innerText || "").trim();
				const ariaLabel = btn.getAttribute("aria-label") || "";
				if (text.includes("发送") || text.includes("获取") || text.includes("验证码") || text.includes("Send") || text.includes("Code") || text.includes("Get") || ariaLabel.includes("验证码") || ariaLabel.toLowerCase().includes("code")) {
					if (!btn.disabled && !btn.classList.contains("disabled")) {
						return {
							clicked: true,
							text,
							element: btn
						};
					}
				}
			}
			return {
				clicked: false,
				text: "",
				element: null
			};
		},
		async requestSiteApi(path, options = {}, runCtx, step = "SITE_API") {
			const attempts = this.resolveRetryAttempts(options.maxAttempts);
			return this.runWithObjectiveRetries(() => this.requestSiteApiOnce(path, options, runCtx, step), {
				runCtx,
				step,
				actionName: `${options.method || "GET"} ${path}`,
				maxAttempts: attempts
			});
		},
		async requestSiteApiOnce(path, options = {}, runCtx, step = "SITE_API") {
			const strictCode = options.strictCode === true;
			const acceptableCodes = Array.isArray(options.acceptableCodes) ? options.acceptableCodes : [0, 200];
			const method = options.method || "GET";
			const url = `${window.location.origin}${path}`;
			const timeoutMs = options.timeout ?? 3e4;
			const hasRawBody = typeof options.rawBody === "string";
			const serializedBody = hasRawBody ? options.rawBody : options.body === undefined ? undefined : options.unicodeEscapeBody === true ? stringifyJsonWithUnicodeEscapes(options.body) : JSON.stringify(options.body);
			const headers = {
				"Content-Type": "application/json",
				"X-Language": X_LANGUAGE$1,
				...options.headers || {}
			};
			logInfo$1(runCtx, step, `${method} ${path} 请求开始`);
			logDebug(runCtx, step, "请求详情", {
				url,
				headers,
				body: options.body ?? null,
				bodyMode: hasRawBody ? "raw-body" : options.unicodeEscapeBody ? "json-with-unicode-escape" : "json",
				serializedBodyLength: typeof serializedBody === "string" ? serializedBody.length : 0,
				requestMode: "page-fetch-first"
			});
			let httpStatus = 0;
			let raw = "";
			let payload = null;
			const runPageFetch = async () => {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), timeoutMs);
				try {
					const response = await fetch(url, {
						method,
						headers,
						body: serializedBody,
						credentials: "include",
						signal: controller.signal,
						cache: "no-store"
					});
					httpStatus = Number(response.status || 0);
					raw = await response.text();
					try {
						payload = raw ? JSON.parse(raw) : null;
					} catch {
						payload = null;
					}
				} finally {
					clearTimeout(timer);
				}
			};
			try {
				await runPageFetch();
			} catch (fetchError) {
				logWarn$1(runCtx, step, "页面 fetch 请求失败，回退 GM 请求", { message: fetchError?.message || String(fetchError) });
				const fallbackResponse = await gmRequestJson({
					method,
					url,
					headers,
					...hasRawBody || options.unicodeEscapeBody && serializedBody !== undefined ? { rawBody: serializedBody || "" } : { body: options.body },
					timeout: timeoutMs,
					anonymous: true
				});
				httpStatus = Number(fallbackResponse.status || 0);
				raw = fallbackResponse.raw || "";
				payload = fallbackResponse.json;
			}
			logInfo$1(runCtx, step, `${method} ${path} 响应`, {
				httpStatus,
				statusField: payload?.status,
				result: payload?.result,
				success: payload?.success,
				code: payload?.code,
				message: payload?.message
			});
			logDebug(runCtx, step, "原始响应内容", {
				raw,
				json: payload
			});
			if (httpStatus < 200 || httpStatus >= 300) {
				throw withHttpStatusError(readErrorMessage(payload, `接口 ${path} 请求失败: HTTP ${httpStatus}`), httpStatus);
			}
			if (payload === null) {
				throw new Error(`接口 ${path} 返回非 JSON 响应`);
			}
			if (payload?.success === false) {
				throw new Error(readErrorMessage(payload, `接口 ${path} 返回失败`));
			}
			if (typeof payload?.result === "string" && !/^(success|ok)$/i.test(payload.result.trim())) {
				throw new Error(readErrorMessage(payload, `接口 ${path} 返回 result=${payload.result}`));
			}
			if (typeof payload?.status === "number" && payload.status >= 400) {
				throw new Error(readErrorMessage(payload, `接口 ${path} 返回 status=${payload.status}`));
			}
			if (strictCode && typeof payload?.code === "number" && !acceptableCodes.includes(payload.code)) {
				throw new Error(readErrorMessage(payload, `接口 ${path} 返回 code=${payload.code}`));
			}
			return payload;
		},
		async sendRegisterEmailCode(email, runCtx) {
			const payload = await this.requestSiteApi(SITE_ENDPOINTS.SEND_CODE, {
				method: "POST",
				body: {
					email,
					lang: X_LANGUAGE$1
				}
			}, runCtx, "SEND_CODE");
			if (typeof payload?.code === "number" && payload.code !== 0 && payload.code !== 200) {
				logWarn$1(runCtx, "SEND_CODE", "发送验证码接口返回非 0 code，继续执行", payload);
			}
			return payload;
		},
		async getRegToken(runCtx) {
			const payload = await this.requestSiteApi(SITE_ENDPOINTS.SLIDE_GET, { method: "GET" }, runCtx, "GET_REG_TOKEN");
			const regToken = payload?.data?.reg_token;
			if (!regToken) {
				throw new Error("未获取到 reg_token");
			}
			logInfo$1(runCtx, "GET_REG_TOKEN", "reg_token 获取成功");
			logDebug(runCtx, "GET_REG_TOKEN", "reg_token 完整值", { regToken });
			return regToken;
		},
		async registerWithCode({ username, email, password, code, regToken }, runCtx) {
			const payload = await this.requestSiteApi(SITE_ENDPOINTS.REGISTER, {
				method: "POST",
				body: {
					name: username,
					email,
					password,
					code,
					remember_me: true,
					interface_language: X_LANGUAGE$1,
					client: "web_pc",
					is_web3_account: false,
					reg_token: regToken
				}
			}, runCtx, "REGISTER");
			const token = typeof payload?.data === "string" ? payload.data.trim() : typeof payload?.data?.token === "string" ? payload.data.token.trim() : "";
			if (!token) {
				throw new Error("注册成功但未返回 token（支持 data 或 data.token）");
			}
			logInfo$1(runCtx, "REGISTER", "注册接口返回 token");
			logDebug(runCtx, "REGISTER", "token 完整值", { token });
			return token;
		},
		async setAccountGender(token, runCtx) {
			await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_GENDER, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: { gender: 1 }
			}, runCtx, "SET_GENDER");
			logInfo$1(runCtx, "SET_GENDER", "首次引导-性别设置完成");
		},
		async submitFavoriteTags(token, runCtx) {
			await this.requestSiteApi(SITE_ENDPOINTS.FAVORITE_TAGS, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: { tag_names: [] }
			}, runCtx, "SET_FAVORITE_TAGS");
			logInfo$1(runCtx, "SET_FAVORITE_TAGS", "首次引导-标签提交完成");
		},
		async setFirstVisitFlag(token, runCtx) {
			await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_EXTEND_SET, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: {
					key: "is_first_visit",
					value: true
				}
			}, runCtx, "SET_FIRST_VISIT");
			logInfo$1(runCtx, "SET_FIRST_VISIT", "首次引导-is_first_visit 设置完成");
		},
		normalizeAccountExtendValue(value) {
			if (typeof value === "boolean") return value;
			if (typeof value === "number") {
				if (value === 1) return true;
				if (value === 0) return false;
			}
			if (typeof value === "string") {
				const normalized = value.trim().toLowerCase();
				if (normalized === "true" || normalized === "1") return true;
				if (normalized === "false" || normalized === "0") return false;
			}
			return null;
		},
		async fetchAccountProfile({ token, runCtx, step = "GET_ACCOUNT_PROFILE", maxAttempts = 1 }) {
			const payload = await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_PROFILE, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				maxAttempts
			}, runCtx, step);
			const profile = payload?.data;
			if (!profile || typeof profile !== "object") {
				throw new Error("account/profile 返回 data 为空");
			}
			return profile;
		},
		async verifyAccountExtendFlag({ token, key, expectedValue, runCtx, step }) {
			try {
				const profile = await this.fetchAccountProfile({
					token,
					runCtx,
					step,
					maxAttempts: 1
				});
				const extend = profile?.extend && typeof profile.extend === "object" ? profile.extend : {};
				const resolvedValue = Object.prototype.hasOwnProperty.call(extend, key) ? extend[key] : null;
				const normalized = this.normalizeAccountExtendValue(resolvedValue);
				const expected = this.normalizeAccountExtendValue(expectedValue);
				if (resolvedValue === null) {
					logWarn$1(runCtx, step, `${key} 在 profile.extend 中不存在`, {
						key,
						expected: expectedValue
					});
					return;
				}
				if (normalized === expected) {
					logInfo$1(runCtx, step, `${key} 校验通过`, {
						key,
						value: resolvedValue
					});
				} else {
					logWarn$1(runCtx, step, `${key} 校验值与预期不一致`, {
						key,
						expected: expectedValue,
						actual: resolvedValue
					});
				}
			} catch (error) {
				logWarn$1(runCtx, step, `${key} 校验失败（不影响主流程）`, {
					key,
					message: error?.message || String(error)
				});
			}
		},
		async setHideRefreshConfirmFlag(token, runCtx) {
			await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_EXTEND_SET, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: {
					key: "hide_refresh_confirm",
					value: true
				}
			}, runCtx, "SET_HIDE_REFRESH_CONFIRM");
			logInfo$1(runCtx, "SET_HIDE_REFRESH_CONFIRM", "首次引导-hide_refresh_confirm 设置完成（已执行 extend_set）");
		},
		async skipFirstGuideOnce(token, runCtx) {
			await this.setAccountGender(token, runCtx);
			await this.submitFavoriteTags(token, runCtx);
			await this.setFirstVisitFlag(token, runCtx);
			await this.setHideRefreshConfirmFlag(token, runCtx);
		},
		async verifyGuideByProfile({ token, runCtx, step = "VERIFY_GUIDE_BY_PROFILE" }) {
			const profile = await this.fetchAccountProfile({
				token,
				runCtx,
				step,
				maxAttempts: 1
			});
			const extend = profile?.extend && typeof profile.extend === "object" ? profile.extend : {};
			const hideRefreshConfirm = this.normalizeAccountExtendValue(extend.hide_refresh_confirm);
			const isFirstVisit = this.normalizeAccountExtendValue(extend.is_first_visit);
			const checks = {
				hideRefreshConfirm: hideRefreshConfirm === true,
				isFirstVisit: isFirstVisit === true
			};
			const ok = checks.hideRefreshConfirm && checks.isFirstVisit;
			logInfo$1(runCtx, step, ok ? "profile 校验通过" : "profile 校验未通过", {
				hide_refresh_confirm: extend.hide_refresh_confirm ?? null,
				is_first_visit: extend.is_first_visit ?? null,
				checks
			});
			return {
				ok,
				checks,
				profile
			};
		},
		async skipFirstGuide(token, runCtx) {
			logInfo$1(runCtx, "SKIP_GUIDE", "开始跳过首次引导（快速模式：不请求 /profile 校验）");
			await this.skipFirstGuideOnce(token, runCtx);
			logInfo$1(runCtx, "SKIP_GUIDE", "首次引导跳过请求已提交（快速模式）");
		},
		async pollVerificationCode(email, startTime, maxAttempts = 10, intervalMs = 2e3, runCtx) {
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				Sidebar.updateState({
					status: "fetching",
					statusMessage: `正在轮询验证码邮件... (${attempt}/${maxAttempts})`
				});
				logInfo$1(runCtx, "POLL_CODE", `轮询验证码第 ${attempt}/${maxAttempts} 次`);
				const emails = await ApiService.getEmails(email);
				const sortedEmails = (emails || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
				logDebug(runCtx, "POLL_CODE", "邮件列表详情", {
					count: sortedEmails.length,
					emails: sortedEmails
				});
				for (const mail of sortedEmails) {
					const mailTime = mail.timestamp || 0;
					if (startTime && mailTime < startTime - 60) {
						continue;
					}
					const content = mail.content || mail.html_content || "";
					const subject = mail.subject || "";
					const code = extractVerificationCode(content) || extractVerificationCode(subject);
					if (code) {
						logInfo$1(runCtx, "POLL_CODE", `提取到验证码（第 ${attempt} 次轮询）`);
						logDebug(runCtx, "POLL_CODE", "验证码完整值", { code });
						return code;
					}
				}
				if (attempt < maxAttempts) {
					logWarn$1(runCtx, "POLL_CODE", `本轮未获取到验证码，${intervalMs}ms 后重试`);
					await delay(intervalMs);
				}
			}
			logError(runCtx, "POLL_CODE", "轮询窗口结束，仍未获取验证码");
			return null;
		},
		async startLegacyRegisterAssist() {
			const runCtx = createRunContext("LEGACY");
			let currentStep = "初始化";
			logInfo$1(runCtx, "START", "注册页模式：填表辅助 + 用户手动过验证码");
			try {
				if (!this.isRegisterPage()) {
					throw new Error("当前不在注册页，请使用一键注册（接口）");
				}
				currentStep = "生成临时邮箱";
				Sidebar.updateState({
					status: "generating",
					statusMessage: "正在生成临时邮箱..."
				});
				this.registrationStartTime = Math.floor(Date.now() / 1e3);
				gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);
				const email = await ApiService.generateEmail();
				const username = generateUsername();
				const password = generatePassword();
				logInfo$1(runCtx, "GENERATE", "生成注册信息完成", {
					email,
					username,
					password
				});
				Sidebar.updateState({
					email,
					username,
					password,
					statusMessage: "正在填充表单..."
				});
				gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
				gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
				gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);
				this.fillForm(email, username, password);
				currentStep = "触发发送验证码";
				const sendResult = this.findAndClickSendCodeButton();
				if (sendResult.clicked) {
					sendResult.element?.click();
					Sidebar.updateState({
						status: "waiting",
						statusMessage: "表单已填充并触发发送验证码，请完成人机验证后点击页面注册",
						verificationCode: ""
					});
					Toast.info("已填表并尝试发送验证码，请你完成人机验证后提交注册", 5e3);
					logInfo$1(runCtx, "SEND_CODE", "已触发页面发送验证码按钮", { text: sendResult.text });
				} else {
					Sidebar.updateState({
						status: "waiting",
						statusMessage: "表单已填充，请手动点击发送验证码并完成人机验证",
						verificationCode: ""
					});
					Toast.warning("已填表，但未找到发送验证码按钮，请手动操作", 5e3);
					logWarn$1(runCtx, "SEND_CODE", "未找到发送验证码按钮");
				}
			} catch (error) {
				const message = `${currentStep}失败: ${error.message}`;
				Sidebar.updateState({
					status: "error",
					statusMessage: message
				});
				Toast.error(message);
				logError(runCtx, "FAIL", message, {
					errorName: error?.name,
					stack: error?.stack
				});
			}
		},
		async registerByApi(runCtx, options = {}) {
			const flowName = options.flowName || "一键注册";
			const showStepToasts = options.showStepToasts !== false;
			const markSuccess = options.markSuccess !== false;
			let currentStep = "初始化";
			currentStep = "生成临时邮箱";
			Sidebar.updateState({
				status: "generating",
				statusMessage: `${flowName}：正在生成临时邮箱...`
			});
			if (showStepToasts) {
				Toast.info(`${flowName}：正在生成临时邮箱`, 2200);
			}
			this.registrationStartTime = Math.floor(Date.now() / 1e3);
			gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);
			const email = await ApiService.generateEmail();
			const username = generateUsername();
			const password = generatePassword();
			logInfo$1(runCtx, "GENERATE", `${flowName} 生成注册信息完成`, {
				email,
				username,
				password
			});
			Sidebar.updateState({
				email,
				username,
				password,
				statusMessage: `${flowName}：正在填充表单...`
			});
			gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
			gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
			gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);
			this.fillForm(email, username, password);
			currentStep = "发送验证码";
			Sidebar.updateState({
				status: "fetching",
				statusMessage: `${flowName}：正在发送验证码...`,
				verificationCode: ""
			});
			await this.sendRegisterEmailCode(email, runCtx);
			if (showStepToasts) {
				Toast.info(`${flowName}：验证码已发送，正在轮询邮箱`, 2200);
			}
			currentStep = "轮询邮箱验证码";
			Sidebar.updateState({
				status: "fetching",
				statusMessage: `${flowName}：验证码已发送，正在自动轮询邮箱...`
			});
			const code = await this.pollVerificationCode(email, this.registrationStartTime, 10, 2e3, runCtx);
			if (!code) {
				throw new Error("未在轮询窗口内获取到验证码");
			}
			if (showStepToasts) {
				Toast.success(`${flowName}：已获取验证码`, 1800);
			}
			Sidebar.updateState({
				verificationCode: code,
				statusMessage: `${flowName}：验证码已获取: ${code}`
			});
			const { codeInput } = this.getFormElements();
			if (codeInput) {
				this.simulateInput(codeInput, code);
				logInfo$1(runCtx, "FORM", `${flowName} 验证码已自动填充到输入框`);
			} else {
				logWarn$1(runCtx, "FORM", `${flowName} 未找到验证码输入框，跳过自动填充`);
			}
			currentStep = "获取注册令牌";
			Sidebar.updateState({
				status: "fetching",
				statusMessage: `${flowName}：正在获取注册令牌...`
			});
			const regToken = await this.getRegToken(runCtx);
			currentStep = "提交注册";
			Sidebar.updateState({
				status: "fetching",
				statusMessage: `${flowName}：正在提交注册...`
			});
			const token = await this.registerWithCode({
				username,
				email,
				password,
				code,
				regToken
			}, runCtx);
			localStorage.setItem("console_token", token);
			logInfo$1(runCtx, "AUTH", `${flowName} 已写入 localStorage.console_token`);
			logDebug(runCtx, "AUTH", `${flowName} localStorage 写入 token 完整值`, { token });
			if (showStepToasts) {
				Toast.success(`${flowName}：注册成功，已写入 console_token`, 2400);
			}
			currentStep = "跳过首次引导";
			Sidebar.updateState({
				status: "fetching",
				statusMessage: `${flowName}：注册成功，正在跳过首次引导...`
			});
			if (showStepToasts) {
				Toast.info(`${flowName}：正在跳过首次引导（快速模式）`, 2600);
			}
			let guideSkipped = true;
			try {
				await this.skipFirstGuide(token, runCtx);
				if (showStepToasts) {
					Toast.success(`${flowName}：首次引导已跳过`, 1800);
				}
			} catch (guideError) {
				guideSkipped = false;
				logError(runCtx, "SKIP_GUIDE", `${flowName} 首次引导跳过失败`, {
					errorName: guideError?.name,
					message: guideError?.message,
					stack: guideError?.stack
				});
				Toast.warning(`${flowName}：注册成功，但跳过首次引导失败: ${guideError.message}`, 6e3);
			}
			if (markSuccess) {
				Sidebar.updateState({
					status: "success",
					statusMessage: guideSkipped ? `${flowName}成功，已写入 console_token 并跳过首次引导` : `${flowName}成功，已写入 console_token（首次引导跳过失败）`
				});
				Toast.success(guideSkipped ? `${flowName}完成：已自动跳过首次引导并写入登录态` : `${flowName}完成：已写入登录态；首次引导跳过失败`, 5e3);
			} else {
				Sidebar.updateState({
					status: "fetching",
					statusMessage: `${flowName}已完成注册，准备执行后续操作...`
				});
			}
			return {
				token,
				guideSkipped,
				email,
				username,
				password,
				code
			};
		},
		extractInstalledAppId() {
			const matched = window.location.pathname.match(/\/(?:test-)?installed\/([0-9a-f-]+)/i);
			return matched?.[1] || "";
		},
		readConversationIdByAppId(appId) {
			const raw = localStorage.getItem("conversationIdInfo");
			if (!raw) {
				throw new Error("未找到 localStorage.conversationIdInfo");
			}
			let mapping;
			try {
				mapping = JSON.parse(raw);
			} catch {
				throw new Error("conversationIdInfo 不是合法 JSON");
			}
			if (!mapping || typeof mapping !== "object") {
				throw new Error("conversationIdInfo 结构无效");
			}
			const conversationId = typeof mapping[appId] === "string" ? mapping[appId].trim() : "";
			if (!conversationId) {
				throw new Error(`conversationIdInfo 中未找到 appId=${appId} 对应的 conversation_id`);
			}
			return conversationId;
		},
		readConversationIdByAppIdSafe(appId) {
			try {
				return this.readConversationIdByAppId(appId);
			} catch {
				return "";
			}
		},
		parseConversationIdFromEventStream(rawText) {
			if (typeof rawText !== "string" || !rawText.trim()) return "";
			const lines = rawText.split(/\r?\n/);
			for (let i = lines.length - 1; i >= 0; i--) {
				const line = lines[i].trim();
				if (!line.startsWith("data:")) continue;
				const dataText = line.slice(5).trim();
				if (!dataText || dataText === "[DONE]") continue;
				try {
					const data = JSON.parse(dataText);
					const parsed = typeof data?.conversation_id === "string" ? data.conversation_id.trim() : typeof data?.conversationId === "string" ? data.conversationId.trim() : "";
					if (parsed) return parsed;
				} catch {
					const fallback = dataText.match(/"conversation_id"\s*:\s*"([^"]+)"/i);
					if (fallback?.[1]) {
						return fallback[1].trim();
					}
				}
			}
			const globalMatch = rawText.match(/"conversation_id"\s*:\s*"([^"]+)"/i);
			return globalMatch?.[1] ? globalMatch[1].trim() : "";
		},
		upsertConversationIdInfo(appId, conversationId, runCtx) {
			const normalizedAppId = typeof appId === "string" ? appId.trim() : "";
			const normalizedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
			if (!normalizedAppId || !normalizedConversationId) {
				return false;
			}
			let mapping = {};
			const raw = localStorage.getItem("conversationIdInfo");
			if (raw) {
				try {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						mapping = { ...parsed };
					} else {
						logWarn$1(runCtx, "SWITCH_CHAT", "conversationIdInfo 不是对象，已重建");
					}
				} catch {
					logWarn$1(runCtx, "SWITCH_CHAT", "conversationIdInfo 解析失败，已重建");
				}
			}
			const previousConversationId = typeof mapping[normalizedAppId] === "string" ? mapping[normalizedAppId].trim() : "";
			mapping[normalizedAppId] = normalizedConversationId;
			localStorage.setItem("conversationIdInfo", JSON.stringify(mapping));
			logInfo$1(runCtx, "SWITCH_CHAT", "已写入 localStorage.conversationIdInfo", {
				appId: normalizedAppId,
				conversationId: normalizedConversationId,
				previousConversationId: previousConversationId || null
			});
			return true;
		},
		extractLatestAnswerFromMessages(messages, runCtx, step = "SWITCH_FETCH_MESSAGES") {
			const sorted = [...messages].sort((a, b) => normalizeTimestamp(b?.created_at) - normalizeTimestamp(a?.created_at));
			for (const item of sorted) {
				const answer = item?.answer;
				if (isAnswerEmpty(answer)) {
					logWarn$1(runCtx, step, "检测到空 answer，继续向后查找", {
						createdAt: item?.created_at ?? null,
						answerType: typeof answer,
						answerPreview: typeof answer === "string" ? answer.slice(0, 60) : answer
					});
					continue;
				}
				const answerText = typeof answer === "string" ? answer : String(answer);
				return {
					answer: answerText,
					createdAt: item?.created_at ?? null
				};
			}
			throw new Error("messages 中所有 answer 均为空，已停止更换账号流程");
		},
		resolveSwitchTriggerWordFromWorldBook(worldBook) {
			if (!Array.isArray(worldBook)) return "";
			for (const entry of worldBook) {
				const key = typeof entry?.key === "string" ? entry.key : "";
				const triggerWord = normalizeSwitchTriggerWord(key);
				if (triggerWord) {
					return triggerWord;
				}
			}
			return "";
		},
		prepareWorldBookConfigForSwitch({ baseConfig, answer, runCtx, explicitTriggerWord = "" }) {
			const normalizedAnswer = decodeEscapedText$1(typeof answer === "string" ? answer : String(answer ?? "")).trim();
			if (!normalizedAnswer) {
				throw new Error("旧会话 answer 为空，无法写入 world_book");
			}
			const clonedConfig = cloneJsonSafe(baseConfig);
			if (!clonedConfig || typeof clonedConfig !== "object" || Array.isArray(clonedConfig)) {
				throw new Error("user_app_model_config 结构异常，无法写入 world_book");
			}
			const existingWorldBook = Array.isArray(clonedConfig.world_book) ? [...clonedConfig.world_book] : [];
			const triggerWord = normalizeSwitchTriggerWord(explicitTriggerWord) || DEFAULT_SWITCH_WORLD_BOOK_TRIGGER || this.resolveSwitchTriggerWordFromWorldBook(existingWorldBook);
			const matchedIndex = existingWorldBook.findIndex((entry) => {
				if (!entry || typeof entry !== "object") return false;
				const key = typeof entry?.key === "string" ? entry.key : "";
				return normalizeSwitchTriggerWord(key) === triggerWord;
			});
			const entryBase = matchedIndex >= 0 && existingWorldBook[matchedIndex] && typeof existingWorldBook[matchedIndex] === "object" ? { ...existingWorldBook[matchedIndex] } : {};
			const entryKey = normalizeSwitchTriggerWord(entryBase.key) ? String(entryBase.key).trim() : `_or_${triggerWord}`;
			const worldBookEntry = {
				...entryBase,
				key: entryKey,
				value: normalizedAnswer,
				group: typeof entryBase.group === "string" ? entryBase.group : "",
				key_region: Number.isFinite(Number(entryBase.key_region)) ? Number(entryBase.key_region) : 7,
				value_region: Number.isFinite(Number(entryBase.value_region)) ? Number(entryBase.value_region) : 2
			};
			const nextWorldBook = [...existingWorldBook];
			if (matchedIndex >= 0) {
				nextWorldBook[matchedIndex] = worldBookEntry;
			} else {
				nextWorldBook.unshift(worldBookEntry);
			}
			clonedConfig.world_book = nextWorldBook;
			logInfo$1(runCtx, "SWITCH_WORLD_BOOK", matchedIndex >= 0 ? "已替换 world_book 触发词条目" : "已新增 world_book 触发词条目", {
				triggerWord,
				worldBookCount: nextWorldBook.length,
				entryKey: worldBookEntry.key,
				answerLength: normalizedAnswer.length
			});
			logDebug(runCtx, "SWITCH_WORLD_BOOK", "world_book 写入后的配置", { worldBook: nextWorldBook });
			return {
				config: clonedConfig,
				triggerWord,
				worldBookEntry,
				replaced: matchedIndex >= 0
			};
		},
		buildSwitchQuery({ triggerWord, appendText }) {
			const normalizedTrigger = normalizeSwitchTriggerWord(triggerWord) || DEFAULT_SWITCH_WORLD_BOOK_TRIGGER;
			const normalizedAppendText = typeof appendText === "string" ? appendText.trim() : "";
			if (!normalizedAppendText) {
				return normalizedTrigger;
			}
			if (normalizedAppendText.startsWith(normalizedTrigger)) {
				return normalizedAppendText;
			}
			return `${normalizedTrigger}${normalizedAppendText}`;
		},
		extractWorldBookFromModelConfigPayload(payload) {
			const candidates = [];
			const data = payload?.data;
			if (data && typeof data === "object" && !Array.isArray(data)) {
				candidates.push(data);
			}
			if (payload && typeof payload === "object" && !Array.isArray(payload)) {
				candidates.push(payload);
			}
			for (const item of candidates) {
				if (Array.isArray(item.world_book)) {
					return item.world_book;
				}
			}
			return null;
		},
		async fetchConversationMessages({ appId, conversationId, token, runCtx, step = "SWITCH_FETCH_MESSAGES", limit = 100, type = "recent", maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1 }) {
			const path = `${SITE_ENDPOINTS.INSTALLED_MESSAGES}/${appId}/messages?conversation_id=${encodeURIComponent(conversationId)}&limit=${encodeURIComponent(limit)}&type=${encodeURIComponent(type)}`;
			const payload = await this.requestSiteApi(path, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				maxAttempts
			}, runCtx, step);
			const payloadData = payload?.data;
			const messages = Array.isArray(payloadData) ? payloadData : Array.isArray(payloadData?.data) ? payloadData.data : [];
			return {
				messages,
				total: Number(payloadData?.total ?? payload?.total ?? messages.length),
				hasPastRecord: Boolean(payloadData?.has_past_record ?? payload?.has_past_record ?? false),
				isEarliestDataPage: payloadData?.is_earliest_data_page ?? payload?.is_earliest_data_page ?? null,
				raw: payload
			};
		},
		async fetchInstalledConversations({ appId, token, runCtx, step = "SWITCH_LIST_CONVERSATIONS", limit = 500, pinned = false, maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1 }) {
			const path = `${SITE_ENDPOINTS.INSTALLED_MESSAGES}/${appId}/conversations?limit=${encodeURIComponent(limit)}&pinned=${pinned ? "true" : "false"}`;
			const payload = await this.requestSiteApi(path, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				maxAttempts
			}, runCtx, step);
			const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.data) ? payload.data.data : [];
			return [...list].sort((a, b) => normalizeTimestamp(b?.created_at) - normalizeTimestamp(a?.created_at));
		},
		async pollConversationIdFromConversations({ appId, token, runCtx, baselineConversationIds = [], maxAttempts = 10, intervalMs = 700 }) {
			const baseline = new Set((baselineConversationIds || []).map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean));
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				const conversations = await this.fetchInstalledConversations({
					appId,
					token,
					runCtx,
					step: `SWITCH_LIST_CONVERSATIONS_${attempt}`,
					limit: 500,
					pinned: false,
					maxAttempts: 1
				});
				const firstNew = conversations.find((item) => {
					const id = typeof item?.id === "string" ? item.id.trim() : "";
					return !!id && !baseline.has(id);
				});
				if (firstNew?.id) {
					return {
						conversationId: firstNew.id.trim(),
						source: "polling-new",
						attempt
					};
				}
				if (baseline.size === 0 && conversations[0]?.id) {
					return {
						conversationId: String(conversations[0].id).trim(),
						source: "polling-latest",
						attempt
					};
				}
				if (attempt < maxAttempts) {
					await delay(intervalMs);
				}
			}
			return {
				conversationId: "",
				source: "polling-none",
				attempt: maxAttempts
			};
		},
		async fetchAppDetails({ appId, token, runCtx, step = "SWITCH_GET_APP_DETAILS" }) {
			const path = `${SITE_ENDPOINTS.APP_DETAILS}/${appId}`;
			const payload = await this.requestSiteApi(path, {
				method: "GET",
				headers: token ? { Authorization: `Bearer ${token}` } : {}
			}, runCtx, step);
			const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
			const appInfo = data?.apps && typeof data.apps === "object" ? data.apps : data?.app && typeof data.app === "object" ? data.app : {};
			const modelConfig = data?.model_config && typeof data.model_config === "object" ? data.model_config : data?.modelConfig && typeof data.modelConfig === "object" ? data.modelConfig : {};
			return {
				appId,
				name: decodeEscapedText$1(typeof appInfo?.name === "string" ? appInfo.name : ""),
				description: decodeEscapedText$1(typeof appInfo?.description === "string" ? appInfo.description : ""),
				builtInCss: decodeEscapedText$1(typeof modelConfig?.built_in_css === "string" ? modelConfig.built_in_css : ""),
				raw: payload
			};
		},
		async syncAppMetaToLocalHistory({ appId, token, runCtx, step = "SWITCH_SYNC_APP_META" }) {
			try {
				const details = await this.fetchAppDetails({
					appId,
					token,
					runCtx,
					step
				});
				await ChatHistoryService.upsertAppMeta({
					appId,
					name: details.name,
					description: details.description,
					builtInCss: details.builtInCss
				});
				return details;
			} catch (error) {
				logWarn$1(runCtx, step, "同步应用元数据到本地失败（不影响主流程）", { message: error?.message || String(error) });
				return null;
			}
		},
		async fetchLatestConversationAnswer({ appId, conversationId, token, runCtx }) {
			const result = await this.fetchConversationMessages({
				appId,
				conversationId,
				token,
				runCtx,
				step: "SWITCH_FETCH_MESSAGES",
				limit: 100,
				type: "recent"
			});
			const messages = result.messages;
			if (!messages.length) {
				throw new Error("messages 接口未返回可用 data");
			}
			return this.extractLatestAnswerFromMessages(messages, runCtx, "SWITCH_FETCH_MESSAGES");
		},
		async fetchUserAppModelConfig({ appId, token, runCtx }) {
			const path = `${SITE_ENDPOINTS.APPS}/${appId}/user_app_model_config`;
			const payload = await this.requestSiteApi(path, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` }
			}, runCtx, "SWITCH_GET_MODEL_CONFIG");
			const config = payload?.data ?? payload;
			if (config === null || config === undefined) {
				throw new Error("user_app_model_config 返回为空");
			}
			logInfo$1(runCtx, "SWITCH_GET_MODEL_CONFIG", "已读取旧账号 user_app_model_config", {
				appId,
				configType: Array.isArray(config) ? "array" : typeof config
			});
			logDebug(runCtx, "SWITCH_GET_MODEL_CONFIG", "user_app_model_config 详情", config);
			return config;
		},
		async saveUserAppModelConfig({ appId, token, config, runCtx, ensureWorldBookNotEmpty = false, maxWorldBookPostAttempts = 1, unicodeEscapeBody = false }) {
			const path = `${SITE_ENDPOINTS.APPS}/${appId}/user_app_model_config`;
			const attempts = this.resolveRetryAttempts(maxWorldBookPostAttempts);
			let lastPayload = null;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				lastPayload = await this.requestSiteApi(path, {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: config,
					unicodeEscapeBody
				}, runCtx, "SWITCH_POST_MODEL_CONFIG");
				const responseWorldBook = this.extractWorldBookFromModelConfigPayload(lastPayload);
				const hasValidWorldBook = Array.isArray(responseWorldBook) && responseWorldBook.length > 0;
				if (ensureWorldBookNotEmpty && !hasValidWorldBook) {
					const hasNext = attempt < attempts;
					logWarn$1(runCtx, "SWITCH_POST_MODEL_CONFIG", "POST 返回 world_book 无效（为空或缺失），准备重试", {
						appId,
						attempt,
						attempts,
						worldBookType: Array.isArray(responseWorldBook) ? "array" : typeof responseWorldBook,
						worldBookCount: Array.isArray(responseWorldBook) ? responseWorldBook.length : null
					});
					if (hasNext) {
						await delay(220 * attempt);
						continue;
					}
					throw new Error("保存模型配置失败：返回 world_book 为空或缺失，已重试仍未恢复");
				}
				logInfo$1(runCtx, "SWITCH_POST_MODEL_CONFIG", "新账号 user_app_model_config 已同步", {
					appId,
					configType: Array.isArray(config) ? "array" : typeof config,
					attempt,
					attempts,
					ensureWorldBookNotEmpty,
					worldBookCount: Array.isArray(responseWorldBook) ? responseWorldBook.length : null,
					unicodeEscapeBody
				});
				return lastPayload;
			}
			return lastPayload;
		},
		async sendChatMessagesAndReload({ appId, token, query, conversationName, runCtx }) {
			const path = `${SITE_ENDPOINTS.CHAT_MESSAGES}/${appId}/chat-messages`;
			const url = `${window.location.origin}${path}`;
			const body = {
				response_mode: "streaming",
				conversation_name: conversationName,
				history_start_at: null,
				inputs: {},
				query
			};
			logInfo$1(runCtx, "SWITCH_CHAT", "开始请求 chat-messages", {
				path,
				conversationName,
				queryLength: query.length
			});
			logDebug(runCtx, "SWITCH_CHAT", "chat-messages 请求体", body);
			let baselineConversationIds = [];
			try {
				const baselineConversations = await this.fetchInstalledConversations({
					appId,
					token,
					runCtx,
					step: "SWITCH_LIST_CONVERSATIONS_BASELINE",
					limit: 500,
					pinned: false,
					maxAttempts: 1
				});
				baselineConversationIds = baselineConversations.map((item) => typeof item?.id === "string" ? item.id.trim() : "").filter(Boolean);
				logInfo$1(runCtx, "SWITCH_LIST_CONVERSATIONS_BASELINE", "已读取会话基线", { baselineCount: baselineConversationIds.length });
			} catch (error) {
				baselineConversationIds = [];
				logWarn$1(runCtx, "SWITCH_LIST_CONVERSATIONS_BASELINE", "读取会话基线失败，将继续执行并依赖轮询兜底", { message: error?.message || String(error) });
			}
			const responseMeta = await this.runWithObjectiveRetries((attempt, attempts) => {
				if (attempt > 1) {
					logInfo$1(runCtx, "SWITCH_CHAT", `chat-messages 重试中 (${attempt}/${attempts})`);
				}
				let externalAbort = null;
				const ssePromise = this.sendChatMessagesOnce({
					token,
					url,
					body,
					runCtx,
					onAbortReady: (abortFn) => {
						externalAbort = typeof abortFn === "function" ? abortFn : null;
					}
				});
				const pollPromise = this.pollConversationIdFromConversations({
					appId,
					token,
					runCtx,
					baselineConversationIds,
					maxAttempts: 18,
					intervalMs: 450
				});
				return new Promise((resolve, reject) => {
					let settled = false;
					const complete = (meta) => {
						if (settled) return;
						settled = true;
						resolve(meta);
					};
					const fail = (error) => {
						if (settled) return;
						settled = true;
						reject(error);
					};
					ssePromise.then((meta) => {
						if (settled) return;
						const cid = typeof meta?.conversationId === "string" ? meta.conversationId.trim() : "";
						logInfo$1(runCtx, "SWITCH_CHAT", "SSE 通道返回", {
							trigger: meta?.trigger || null,
							status: Number(meta?.status || 0) || null,
							readyState: Number(meta?.readyState || 0) || null,
							textLength: Number(meta?.textLength || 0) || 0,
							conversationId: cid || null
						});
						if (cid) {
							complete({
								...meta,
								source: "sse-conversation-id",
								conversationId: cid
							});
							return;
						}
						Promise.race([pollPromise, delay(2200).then(() => ({
							conversationId: "",
							source: "polling-timebox",
							attempt: 0
						}))]).then((pollMeta) => {
							if (settled) return;
							const pollConversationId = typeof pollMeta?.conversationId === "string" ? pollMeta.conversationId.trim() : "";
							if (pollConversationId) {
								if (externalAbort) {
									externalAbort("polling-captured-after-sse");
								}
								complete({
									...meta,
									conversationId: pollConversationId,
									source: pollMeta?.source || "polling-after-sse",
									pollAttempt: Number(pollMeta?.attempt || 0) || 0
								});
								return;
							}
							complete({
								...meta,
								source: meta?.source || "sse-no-conversation-id"
							});
						}).catch((pollError) => {
							logWarn$1(runCtx, "SWITCH_CHAT", "SSE 后轮询补救失败，按 SSE 结果继续", { message: pollError?.message || String(pollError) });
							complete({
								...meta,
								source: meta?.source || "sse-no-conversation-id"
							});
						});
					}).catch((sseError) => {
						if (settled) return;
						logWarn$1(runCtx, "SWITCH_CHAT", "SSE 通道失败，等待轮询通道兜底", { message: sseError?.message || String(sseError) });
						pollPromise.then((pollMeta) => {
							if (settled) return;
							const pollConversationId = typeof pollMeta?.conversationId === "string" ? pollMeta.conversationId.trim() : "";
							if (pollConversationId) {
								complete({
									trigger: "polling-fallback",
									status: 0,
									readyState: 0,
									textLength: 0,
									elapsedMs: 0,
									conversationId: pollConversationId,
									source: pollMeta?.source || "polling-fallback",
									pollAttempt: Number(pollMeta?.attempt || 0) || 0
								});
								return;
							}
							fail(sseError);
						}).catch(() => fail(sseError));
					});
					pollPromise.then((pollMeta) => {
						if (settled) return;
						const pollConversationId = typeof pollMeta?.conversationId === "string" ? pollMeta.conversationId.trim() : "";
						if (!pollConversationId) return;
						logInfo$1(runCtx, "SWITCH_CHAT", "轮询通道已获取 conversation_id", {
							conversationId: pollConversationId,
							source: pollMeta?.source || "polling",
							attempt: Number(pollMeta?.attempt || 0) || 0
						});
						if (externalAbort) {
							externalAbort("polling-conversation-id-captured");
						}
						complete({
							trigger: "polling-conversation-id-captured",
							status: 0,
							readyState: 0,
							textLength: 0,
							elapsedMs: 0,
							conversationId: pollConversationId,
							source: pollMeta?.source || "polling",
							pollAttempt: Number(pollMeta?.attempt || 0) || 0
						});
					}).catch((pollError) => {
						logWarn$1(runCtx, "SWITCH_CHAT", "轮询通道执行异常", { message: pollError?.message || String(pollError) });
					});
				});
			}, {
				runCtx,
				step: "SWITCH_CHAT",
				actionName: "chat-messages",
				maxAttempts: DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1
			});
			const status = Number(responseMeta?.status || 0);
			const hasStatus = Number.isFinite(status) && status > 0;
			const isSuccess = hasStatus && status >= 200 && status < 300;
			const statusText = hasStatus ? `HTTP ${status}` : "未知状态";
			let conversationId = typeof responseMeta?.conversationId === "string" ? responseMeta.conversationId.trim() : "";
			let source = typeof responseMeta?.source === "string" && responseMeta.source.trim() ? responseMeta.source.trim() : conversationId ? "sse-conversation-id" : "sse-first-chunk";
			logInfo$1(runCtx, "SWITCH_CHAT", `chat-messages 已收到响应（${statusText}）`, {
				...responseMeta,
				conversationId: conversationId || null,
				source
			});
			return {
				status,
				isSuccess,
				conversationId: conversationId || "",
				source
			};
		},
		sendChatMessagesOnce({ token, url, body, runCtx, onAbortReady = null }) {
			return new Promise((resolve, reject) => {
				let settled = false;
				const requestStartedAt = Date.now();
				let hardTimeoutTimer = null;
				let capturedConversationId = "";
				let statusCode = 0;
				let streamText = "";
				const requestController = new AbortController();
				let abortedByScript = false;
				const elapsedMs = () => Date.now() - requestStartedAt;
				const clearTimers = () => {
					if (hardTimeoutTimer) {
						clearTimeout(hardTimeoutTimer);
						hardTimeoutTimer = null;
					}
				};
				const abortRequest = (reason) => {
					try {
						abortedByScript = true;
						requestController.abort(reason || "abort");
						logInfo$1(runCtx, "SWITCH_CHAT", `已主动中止 chat-messages SSE: ${reason || "no-reason"}`);
					} catch (error) {
						logWarn$1(runCtx, "SWITCH_CHAT", "主动中止 chat-messages SSE 失败", {
							reason: reason || "no-reason",
							message: error?.message || String(error)
						});
					}
				};
				if (typeof onAbortReady === "function") {
					try {
						onAbortReady((reason = "external-abort") => {
							abortRequest(reason);
						});
					} catch {}
				}
				const tryCaptureConversationId = (rawText, trigger) => {
					if (capturedConversationId) return capturedConversationId;
					const conversationId = this.parseConversationIdFromEventStream(rawText);
					if (!conversationId) return "";
					capturedConversationId = conversationId;
					logInfo$1(runCtx, "SWITCH_CHAT", `已从 ${trigger} 解析 conversation_id`, { conversationId });
					return capturedConversationId;
				};
				const finish = (trigger, responseMeta = {}) => {
					if (settled) return;
					settled = true;
					clearTimers();
					logInfo$1(runCtx, "SWITCH_CHAT", `chat-messages 已结束: ${trigger}`, {
						elapsedMs: elapsedMs(),
						...responseMeta,
						conversationId: capturedConversationId || responseMeta?.conversationId || null
					});
					resolve({
						trigger,
						...responseMeta,
						conversationId: capturedConversationId || responseMeta?.conversationId || ""
					});
				};
				hardTimeoutTimer = setTimeout(() => {
					if (settled) return;
					logWarn$1(runCtx, "SWITCH_CHAT", "chat-messages 8s 兜底超时，强制结束并刷新后续流程");
					finish("failsafe-timeout", {
						status: statusCode || 0,
						readyState: 0,
						textLength: streamText.length,
						elapsedMs: elapsedMs()
					});
					abortRequest("failsafe-timeout");
				}, 8e3);
				(async () => {
					try {
						const response = await fetch(url, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"X-Language": X_LANGUAGE$1,
								Authorization: `Bearer ${token}`
							},
							body: JSON.stringify(body),
							credentials: "include",
							cache: "no-store",
							signal: requestController.signal
						});
						statusCode = Number(response.status || 0);
						logInfo$1(runCtx, "SWITCH_CHAT", "chat-messages fetch 已建立连接", {
							status: statusCode,
							ok: response.ok,
							elapsedMs: elapsedMs()
						});
						if (!response.ok) {
							throw withHttpStatusError(`chat-messages 请求失败: HTTP ${statusCode}`, statusCode);
						}
						const reader = response.body?.getReader?.();
						if (!reader) {
							streamText = await response.text();
							tryCaptureConversationId(streamText, "fetch-no-stream");
							finish("fetch-no-stream", {
								status: statusCode,
								readyState: 4,
								textLength: streamText.length,
								elapsedMs: elapsedMs(),
								conversationId: capturedConversationId
							});
							return;
						}
						const decoder = new TextDecoder();
						while (true) {
							const { value, done } = await reader.read();
							if (done) {
								break;
							}
							const chunkText = decoder.decode(value, { stream: true });
							if (!chunkText) {
								continue;
							}
							streamText += chunkText;
							tryCaptureConversationId(streamText, "fetch-stream");
							logInfo$1(runCtx, "SWITCH_CHAT", "chat-messages fetch stream chunk", {
								status: statusCode,
								chunkLength: chunkText.length,
								textLength: streamText.length,
								elapsedMs: elapsedMs(),
								conversationId: capturedConversationId || null
							});
							if (!capturedConversationId) {
								continue;
							}
							finish("fetch-stream-conversation-id", {
								status: statusCode,
								readyState: 3,
								textLength: streamText.length,
								elapsedMs: elapsedMs(),
								conversationId: capturedConversationId
							});
							abortRequest("conversation-id-captured-fetch-stream");
							return;
						}
						tryCaptureConversationId(streamText, "fetch-stream-end");
						finish("fetch-stream-end", {
							status: statusCode,
							readyState: 4,
							textLength: streamText.length,
							elapsedMs: elapsedMs(),
							conversationId: capturedConversationId
						});
					} catch (error) {
						if (settled) return;
						clearTimers();
						if (error?.name === "AbortError") {
							logInfo$1(runCtx, "SWITCH_CHAT", "chat-messages fetch onabort", {
								abortedByScript,
								elapsedMs: elapsedMs(),
								textLength: streamText.length,
								conversationId: capturedConversationId || null
							});
							if (abortedByScript) {
								finish("fetch-onabort-by-script", {
									status: statusCode || 0,
									readyState: 0,
									textLength: streamText.length,
									elapsedMs: elapsedMs(),
									conversationId: capturedConversationId
								});
								return;
							}
							reject(new Error("chat-messages 请求被中止"));
							return;
						}
						logWarn$1(runCtx, "SWITCH_CHAT", "chat-messages fetch 失败", {
							status: statusCode || 0,
							message: error?.message || String(error),
							elapsedMs: elapsedMs()
						});
						reject(withHttpStatusError(error?.message || "chat-messages fetch 请求失败", statusCode || 0));
					}
				})();
			});
		},
		async startOneClickRegister() {
			const runCtx = createRunContext("REG");
			logInfo$1(runCtx, "START", "开始一键注册流程", {
				href: window.location.href,
				debugEnabled: isDebugEnabled()
			});
			try {
				const appId = this.extractInstalledAppId();
				const oldToken = (localStorage.getItem("console_token") || "").trim();
				let oldUserModelConfig = null;
				let modelConfigSynced = false;
				if (appId && oldToken) {
					Sidebar.updateState({
						status: "fetching",
						statusMessage: "一键注册：正在读取旧账号模型配置..."
					});
					Toast.info("一键注册：正在读取旧账号模型配置", 2200);
					await this.syncAppMetaToLocalHistory({
						appId,
						token: oldToken,
						runCtx,
						step: "REG_SYNC_APP_META_OLD"
					});
					oldUserModelConfig = await this.fetchUserAppModelConfig({
						appId,
						token: oldToken,
						runCtx
					});
					logInfo$1(runCtx, "REG_SYNC_MODEL_CONFIG_OLD", "一键注册已读取旧账号模型配置", { appId });
				} else if (appId && !oldToken) {
					logWarn$1(runCtx, "REG_SYNC_MODEL_CONFIG_OLD", "检测到应用详情页，但未找到旧账号 token，跳过旧配置读取");
				} else {
					logInfo$1(runCtx, "REG_SYNC_MODEL_CONFIG_OLD", "当前不是应用详情页，跳过旧配置读取");
				}
				const registerResult = await this.registerByApi(runCtx, {
					flowName: "一键注册",
					showStepToasts: true,
					markSuccess: false
				});
				if (appId && oldUserModelConfig) {
					Sidebar.updateState({
						status: "fetching",
						statusMessage: "一键注册：正在同步模型配置到新账号..."
					});
					Toast.info("一键注册：正在同步旧模型配置到新账号", 2200);
					await this.syncAppMetaToLocalHistory({
						appId,
						token: registerResult.token,
						runCtx,
						step: "REG_SYNC_APP_META_NEW"
					});
					await this.saveUserAppModelConfig({
						appId,
						token: registerResult.token,
						config: oldUserModelConfig,
						runCtx
					});
					modelConfigSynced = true;
				}
				const autoReloadEnabled = this.isAutoReloadEnabled();
				Sidebar.updateState({
					status: "success",
					statusMessage: registerResult.guideSkipped ? `一键注册成功，已写入 console_token${modelConfigSynced ? "，并同步模型配置" : ""}${autoReloadEnabled ? "，0.8 秒后刷新" : "，自动刷新已关闭"}` : `一键注册成功，已写入 console_token（首次引导跳过失败）${modelConfigSynced ? "，模型配置已同步" : ""}${autoReloadEnabled ? "，0.8 秒后刷新" : "，自动刷新已关闭"}`
				});
				Toast.success(registerResult.guideSkipped ? `一键注册完成${modelConfigSynced ? "（已同步模型配置）" : ""}${autoReloadEnabled ? "，即将刷新" : "，自动刷新已关闭"}` : `一键注册完成：首次引导跳过失败${modelConfigSynced ? "，模型配置已同步" : ""}${autoReloadEnabled ? "，即将刷新" : "，自动刷新已关闭"}`, 5e3);
				logInfo$1(runCtx, "DONE", "一键注册流程完成", { autoReloadEnabled });
				this.reloadPageIfEnabled({
					delayMs: 800,
					runCtx,
					step: "DONE",
					reason: "one-click-register-success"
				});
			} catch (error) {
				const message = `一键注册失败: ${error.message}`;
				Sidebar.updateState({
					status: "error",
					statusMessage: message
				});
				Toast.error(message);
				logError(runCtx, "FAIL", message, {
					errorName: error?.name,
					stack: error?.stack
				});
			}
		},
		async switchAccount(extraText) {
			const runCtx = createRunContext("SWITCH");
			const appendText = typeof extraText === "string" ? extraText.trim() : "";
			const switchBtn = document.getElementById("aifengyue-switch-account");
			if (this.switchingAccount) {
				Toast.warning("更换账号正在执行，请稍候");
				logWarn$1(runCtx, "PRECHECK", "重复触发更换账号，已拦截");
				return;
			}
			if (!appendText) {
				const message = "请输入更换账号附加文本后再执行";
				Sidebar.updateState({
					status: "error",
					statusMessage: message
				});
				Toast.error(message);
				logError(runCtx, "PRECHECK", message);
				return;
			}
			this.switchingAccount = true;
			if (switchBtn) {
				switchBtn.disabled = true;
			}
			logInfo$1(runCtx, "START", "开始更换账号流程", {
				href: window.location.href,
				appendTextLength: appendText.length,
				debugEnabled: isDebugEnabled()
			});
			try {
				const appId = this.extractInstalledAppId();
				if (!appId) {
					throw new Error("当前页面不是 installed/test-installed 详情页，无法提取应用 ID");
				}
				const oldToken = (localStorage.getItem("console_token") || "").trim();
				if (!oldToken) {
					throw new Error("未找到旧账号 console_token，请先登录旧账号后再更换");
				}
				const oldTokenSignature = buildTokenSignature(oldToken);
				const conversationId = this.readConversationIdByAppId(appId);
				let activeChainId = "";
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：正在读取旧账号模型配置..."
				});
				Toast.info("更换账号：正在读取旧账号模型配置", 2200);
				await this.syncAppMetaToLocalHistory({
					appId,
					token: oldToken,
					runCtx,
					step: "SWITCH_SYNC_APP_META_OLD"
				});
				const userModelConfig = await this.fetchUserAppModelConfig({
					appId,
					token: oldToken,
					runCtx
				});
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：正在读取旧会话消息并本地归档..."
				});
				Toast.info("更换账号：正在拉取旧会话消息", 2400);
				const oldConversation = await this.fetchConversationMessages({
					appId,
					conversationId,
					token: oldToken,
					runCtx,
					step: "SWITCH_FETCH_MESSAGES",
					limit: 100,
					type: "recent"
				});
				if (!oldConversation.messages.length) {
					throw new Error("旧会话消息为空，无法继续更换账号");
				}
				const latest = this.extractLatestAnswerFromMessages(oldConversation.messages, runCtx, "SWITCH_FETCH_MESSAGES");
				const decodedAnswer = decodeEscapedText$1(latest.answer);
				if (!decodedAnswer.trim()) {
					throw new Error("最新消息 answer 解码后为空");
				}
				const chainBinding = await ChatHistoryService.bindConversation({
					appId,
					conversationId,
					tokenSignature: oldTokenSignature
				});
				activeChainId = chainBinding.chainId;
				const storeResult = await ChatHistoryService.saveConversationMessages({
					appId,
					conversationId,
					chainId: activeChainId,
					tokenSignature: oldTokenSignature,
					messages: oldConversation.messages
				});
				ChatHistoryService.markChainSynced(activeChainId, Date.now());
				logInfo$1(runCtx, "SWITCH_FETCH_MESSAGES", "已提取旧会话最新消息", {
					appId,
					conversationId,
					createdAt: latest.createdAt,
					answerLength: decodedAnswer.length,
					messageCount: oldConversation.messages.length,
					savedCount: storeResult.savedCount,
					chainId: activeChainId
				});
				if (oldConversation.hasPastRecord || oldConversation.isEarliestDataPage === false) {
					Toast.warning("旧会话可能仍有更早消息未拉取，可在“会话”Tab手动同步", 4500);
				}
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：已提取旧回答，正在注册新账号..."
				});
				Toast.info("更换账号：开始注册新账号", 2200);
				const registerResult = await this.registerByApi(runCtx, {
					flowName: "更换账号",
					showStepToasts: true,
					markSuccess: false
				});
				if (!registerResult.guideSkipped) {
					throw new Error("更换账号终止：首次引导未跳过成功，不发送 chat-messages");
				}
				await this.syncAppMetaToLocalHistory({
					appId,
					token: registerResult.token,
					runCtx,
					step: "SWITCH_SYNC_APP_META_NEW"
				});
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：正在写入 world_book 并同步模型配置..."
				});
				Toast.info("更换账号：正在写入 world_book 并同步模型配置", 2200);
				const appendTriggerWord = normalizeSwitchTriggerWord(appendText);
				const switchConfig = this.prepareWorldBookConfigForSwitch({
					baseConfig: userModelConfig,
					answer: decodedAnswer,
					runCtx,
					explicitTriggerWord: appendTriggerWord
				});
				await this.saveUserAppModelConfig({
					appId,
					token: registerResult.token,
					config: switchConfig.config,
					runCtx,
					ensureWorldBookNotEmpty: true,
					maxWorldBookPostAttempts: 3,
					unicodeEscapeBody: true
				});
				const query = this.buildSwitchQuery({
					triggerWord: switchConfig.triggerWord,
					appendText
				});
				const conversationName = `新的对话-${randomConversationSuffix(3)}`;
				logInfo$1(runCtx, "SWITCH_CHAT", "chat-messages query 已改为触发词前缀模式", {
					triggerWord: switchConfig.triggerWord,
					appendTextLength: appendText.length,
					queryLength: query.length
				});
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：新账号已就绪，正在发送 chat-messages..."
				});
				Toast.info("更换账号：正在发送 chat-messages", 2200);
				const chatResult = await this.sendChatMessagesAndReload({
					appId,
					token: registerResult.token,
					query,
					conversationName,
					runCtx
				});
				const newTokenSignature = buildTokenSignature(registerResult.token);
				const newConversationId = typeof chatResult?.conversationId === "string" ? chatResult.conversationId.trim() : "";
				if (newConversationId) {
					this.upsertConversationIdInfo(appId, newConversationId, runCtx);
					ChatHistoryService.setConversationTokenSignature(appId, newConversationId, newTokenSignature);
					ChatHistoryService.bindConversation({
						appId,
						conversationId: newConversationId,
						previousConversationId: conversationId,
						preferredChainId: activeChainId,
						tokenSignature: newTokenSignature
					}).then((newBinding) => {
						activeChainId = newBinding.chainId;
						ChatHistoryService.setActiveChainId(appId, activeChainId);
					}).catch((bindError) => {
						logWarn$1(runCtx, "SWITCH_CHAT", "刷新前写入会话链失败（不影响立即刷新）", { message: bindError?.message || String(bindError) });
					});
				}
				const sourceText = chatResult?.source ? `，来源 ${chatResult.source}` : "";
				const statusText = Number.isFinite(Number(chatResult?.status)) ? `HTTP ${Number(chatResult.status)}` : "未知状态";
				const autoReloadEnabled = this.isAutoReloadEnabled();
				Sidebar.updateState({
					status: "success",
					statusMessage: newConversationId ? `更换账号成功：已获取 conversation_id（${statusText}${sourceText}）${autoReloadEnabled ? "，0.8 秒后刷新" : "，自动刷新已关闭"}` : `更换账号已发送 chat-messages（${statusText}），未拿到 conversation_id${autoReloadEnabled ? "，0.8 秒后刷新" : "，自动刷新已关闭"}`
				});
				if (newConversationId) {
					Toast.success(`已获取新会话ID（${chatResult.source || "sse"}）${autoReloadEnabled ? "，即将刷新" : "，自动刷新已关闭"}`, 2600);
				} else {
					Toast.warning(autoReloadEnabled ? "未获取到新会话ID，仍将刷新，可在“会话”Tab手动同步" : "未获取到新会话ID，自动刷新已关闭，可在“会话”Tab手动同步", 3600);
				}
				this.reloadPageIfEnabled({
					delayMs: 120,
					runCtx,
					step: "SWITCH_DONE",
					reason: "switch-account-success"
				});
			} catch (error) {
				const message = `更换账号失败: ${error.message}`;
				Sidebar.updateState({
					status: "error",
					statusMessage: message
				});
				Toast.error(message, 6e3);
				logError(runCtx, "FAIL", message, {
					errorName: error?.name,
					stack: error?.stack
				});
			} finally {
				this.switchingAccount = false;
				if (switchBtn) {
					switchBtn.disabled = false;
				}
			}
		},
		async loadConversationChainsForCurrentApp({ appId = "" } = {}) {
			const resolvedAppId = (typeof appId === "string" ? appId.trim() : "") || this.extractInstalledAppId();
			if (!resolvedAppId) {
				return {
					appId: "",
					chains: [],
					activeChainId: "",
					currentConversationId: ""
				};
			}
			const currentConversationId = this.readConversationIdByAppIdSafe(resolvedAppId);
			const currentTokenSignature = buildTokenSignature(localStorage.getItem("console_token") || "");
			if (currentConversationId) {
				await ChatHistoryService.bindConversation({
					appId: resolvedAppId,
					conversationId: currentConversationId,
					tokenSignature: currentTokenSignature
				});
			}
			const chains = await ChatHistoryService.listChainsForApp(resolvedAppId);
			const chainsWithStats = await Promise.all(chains.map(async (chain) => {
				const stats = await ChatHistoryService.getChainStats(chain.chainId);
				return {
					...chain,
					...stats
				};
			}));
			let activeChainId = ChatHistoryService.getActiveChainId(resolvedAppId);
			if (!activeChainId && chainsWithStats[0]?.chainId) {
				activeChainId = chainsWithStats[0].chainId;
				ChatHistoryService.setActiveChainId(resolvedAppId, activeChainId);
			}
			return {
				appId: resolvedAppId,
				chains: chainsWithStats,
				activeChainId,
				currentConversationId
			};
		},
		async getConversationViewerHtml({ appId, chainId }) {
			const resolvedAppId = typeof appId === "string" ? appId.trim() : "";
			if (!resolvedAppId) {
				return "<html><body><p>当前页面未识别到 appId。</p></body></html>";
			}
			const resolvedChainId = (typeof chainId === "string" ? chainId.trim() : "") || ChatHistoryService.getActiveChainId(resolvedAppId);
			if (!resolvedChainId) {
				return "<html><body><p>当前应用暂无本地会话链。</p></body></html>";
			}
			return ChatHistoryService.buildChainViewerHtml({
				appId: resolvedAppId,
				chainId: resolvedChainId
			});
		},
		async manualSyncConversationChain({ appId = "", chainId = "" } = {}) {
			const runCtx = createRunContext("SYNC");
			const resolvedAppId = (typeof appId === "string" ? appId.trim() : "") || this.extractInstalledAppId();
			if (!resolvedAppId) {
				throw new Error("当前页面不是 installed/test-installed 详情页");
			}
			const token = (localStorage.getItem("console_token") || "").trim();
			if (!token) {
				throw new Error("未找到 console_token，请先登录后再同步");
			}
			const tokenSignature = buildTokenSignature(token);
			await this.syncAppMetaToLocalHistory({
				appId: resolvedAppId,
				token,
				runCtx,
				step: "SYNC_APP_META"
			});
			let resolvedChainId = typeof chainId === "string" ? chainId.trim() : "";
			if (!resolvedChainId) {
				resolvedChainId = ChatHistoryService.getActiveChainId(resolvedAppId);
			}
			if (!resolvedChainId) {
				const currentConversationId = this.readConversationIdByAppIdSafe(resolvedAppId);
				if (currentConversationId) {
					const binding = await ChatHistoryService.bindConversation({
						appId: resolvedAppId,
						conversationId: currentConversationId,
						tokenSignature
					});
					resolvedChainId = binding.chainId;
				}
			}
			if (!resolvedChainId) {
				throw new Error("未找到可同步的会话链");
			}
			const currentConversationId = this.readConversationIdByAppIdSafe(resolvedAppId);
			if (currentConversationId) {
				await ChatHistoryService.bindConversation({
					appId: resolvedAppId,
					conversationId: currentConversationId,
					preferredChainId: resolvedChainId,
					tokenSignature
				});
			}
			const chain = await ChatHistoryService.getChain(resolvedChainId);
			if (!chain) {
				throw new Error(`会话链不存在: ${resolvedChainId}`);
			}
			const conversationIds = Array.isArray(chain.conversationIds) ? chain.conversationIds.filter((item) => typeof item === "string" && item.trim()) : [];
			if (conversationIds.length === 0) {
				throw new Error("当前会话链无 conversation_id，无法同步");
			}
			const allowedConversationIds = [];
			const skippedNoPermissionConversationIds = [];
			for (const conversationId of conversationIds) {
				const bindingToken = ChatHistoryService.getConversationTokenSignature(resolvedAppId, conversationId);
				if (!bindingToken || bindingToken !== tokenSignature) {
					skippedNoPermissionConversationIds.push(conversationId);
					continue;
				}
				allowedConversationIds.push(conversationId);
			}
			logInfo$1(runCtx, "SYNC", "会话同步过滤结果（按 token 绑定）", {
				chainId: resolvedChainId,
				totalConversationCount: conversationIds.length,
				allowedConversationCount: allowedConversationIds.length,
				skippedNoPermissionCount: skippedNoPermissionConversationIds.length
			});
			if (allowedConversationIds.length === 0) {
				throw new Error("当前链路会话均不属于当前账号 token，已跳过无权限同步");
			}
			let totalFetched = 0;
			let totalSaved = 0;
			let hasIncomplete = false;
			let successCount = 0;
			const failedConversationIds = [];
			for (const conversationId of allowedConversationIds) {
				try {
					const result = await this.fetchConversationMessages({
						appId: resolvedAppId,
						conversationId,
						token,
						runCtx,
						step: `SYNC_MESSAGES_${successCount + failedConversationIds.length + 1}`,
						limit: 100,
						type: "recent"
					});
					totalFetched += result.messages.length;
					if (result.hasPastRecord || result.isEarliestDataPage === false) {
						hasIncomplete = true;
					}
					const storeResult = await ChatHistoryService.saveConversationMessages({
						appId: resolvedAppId,
						conversationId,
						chainId: resolvedChainId,
						tokenSignature,
						messages: result.messages
					});
					totalSaved += storeResult.savedCount;
					successCount++;
				} catch (error) {
					failedConversationIds.push(conversationId);
					logWarn$1(runCtx, "SYNC", "单个会话同步失败，继续同步其他会话", {
						conversationId,
						message: error?.message || String(error)
					});
				}
			}
			if (successCount === 0) {
				throw new Error("会话同步失败：所有 conversation_id 均同步失败");
			}
			ChatHistoryService.markChainSynced(resolvedChainId, Date.now());
			ChatHistoryService.setActiveChainId(resolvedAppId, resolvedChainId);
			return {
				appId: resolvedAppId,
				chainId: resolvedChainId,
				conversationIds: allowedConversationIds,
				skippedNoPermissionConversationIds,
				skippedNoPermissionCount: skippedNoPermissionConversationIds.length,
				successCount,
				failedCount: failedConversationIds.length,
				failedConversationIds,
				totalFetched,
				totalSaved,
				hasIncomplete
			};
		},
		async start() {
			if (this.isRegisterPage()) {
				await this.startLegacyRegisterAssist();
			} else {
				await this.startOneClickRegister();
			}
		},
		async generateNewEmail() {
			const runCtx = createRunContext("MAIL");
			logInfo$1(runCtx, "START", "开始生成新邮箱");
			try {
				Sidebar.updateState({
					status: "generating",
					statusMessage: "正在生成新邮箱..."
				});
				this.registrationStartTime = Math.floor(Date.now() / 1e3);
				gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);
				const email = await ApiService.generateEmail();
				Sidebar.updateState({
					email,
					status: "waiting",
					statusMessage: "新邮箱已生成",
					verificationCode: ""
				});
				gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
				const { emailInput } = this.getFormElements();
				if (emailInput) this.simulateInput(emailInput, email);
				Toast.success("新邮箱已生成并填充");
				logInfo$1(runCtx, "DONE", "新邮箱生成成功", { email });
			} catch (error) {
				Sidebar.updateState({
					status: "error",
					statusMessage: `错误: ${error.message}`
				});
				Toast.error(`生成失败: ${error.message}`);
				logError(runCtx, "FAIL", "新邮箱生成失败", {
					errorName: error?.name,
					message: error?.message,
					stack: error?.stack
				});
			}
		},
		fillForm(email, username, password) {
			const { usernameInput, emailInput, passwordInput } = this.getFormElements();
			if (usernameInput) this.simulateInput(usernameInput, username);
			if (emailInput) this.simulateInput(emailInput, email);
			if (passwordInput) this.simulateInput(passwordInput, password);
		},
		async fetchVerificationCode() {
			const runCtx = createRunContext("CODE");
			const email = gmGetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, "");
			if (!email) {
				Toast.error("请先生成临时邮箱");
				logWarn$1(runCtx, "PRECHECK", "未找到当前邮箱，无法获取验证码");
				return;
			}
			const startTime = gmGetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, 0);
			try {
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "正在获取验证码邮件..."
				});
				Toast.info("正在获取邮件...");
				logInfo$1(runCtx, "START", "手动获取验证码开始", {
					email,
					startTime
				});
				const code = await this.pollVerificationCode(email, startTime, 1, 0, runCtx);
				if (!code) {
					Sidebar.updateState({
						status: "waiting",
						statusMessage: "未找到验证码，请稍后重试"
					});
					Toast.warning("未找到验证码，请稍后再试");
					logWarn$1(runCtx, "DONE", "手动获取验证码未命中");
					return;
				}
				Sidebar.updateState({
					status: "success",
					statusMessage: `验证码: ${code}`,
					verificationCode: code
				});
				const { codeInput } = this.getFormElements();
				if (codeInput) {
					this.simulateInput(codeInput, code);
					Toast.success(`验证码 ${code} 已填充！`, 5e3);
					logInfo$1(runCtx, "DONE", "验证码已填充");
				} else {
					Toast.success(`验证码: ${code}，请手动输入`, 5e3);
					logWarn$1(runCtx, "DONE", "找到验证码但未找到输入框");
				}
			} catch (error) {
				Sidebar.updateState({
					status: "error",
					statusMessage: `获取失败: ${error.message}`
				});
				Toast.error(`获取验证码失败: ${error.message}`);
				logError(runCtx, "FAIL", "手动获取验证码失败", {
					errorName: error?.name,
					message: error?.message,
					stack: error?.stack
				});
			}
		}
	};

//#endregion
//#region src/features/iframe-extractor.js
	const X_LANGUAGE = "zh-Hans";
	const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS = 3;
	function decodeEscapedText(raw) {
		if (typeof raw !== "string") return "";
		let value = raw;
		for (let i = 0; i < 3; i++) {
			if (!/\\u[0-9a-fA-F]{4}|\\[nrt"\\/]/.test(value)) {
				break;
			}
			try {
				const next = JSON.parse(`"${value.replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`);
				if (next === value) break;
				value = next;
			} catch {
				break;
			}
		}
		return value;
	}
	function sanitizeFilename(value) {
		const normalized = String(value || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
		return normalized || "aifengyue-app";
	}
	const IframeExtractor = {
		button: null,
		isDetailPage: false,
		checkDetailPage() {
			const urlPattern = /\/zh\/explore\/(?:test-)?installed\/[0-9a-f-]+$/i;
			return urlPattern.test(window.location.pathname);
		},
		extractInstalledAppId() {
			const matched = window.location.pathname.match(/\/(?:test-)?installed\/([0-9a-f-]+)$/i);
			return matched?.[1] || "";
		},
		isExtractAvailable() {
			return this.checkDetailPage() && !!this.extractInstalledAppId();
		},
		createStyles() {
			gmAddStyle(`
            #aifengyue-extract-btn {
                position: fixed;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 40px;
                height: 100px;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                border: none;
                border-radius: 8px 0 0 8px;
                cursor: pointer;
                z-index: 2147483644;
                display: flex;
                align-items: center;
                justify-content: center;
                writing-mode: vertical-rl;
                color: #fff;
                font-size: 14px;
                font-weight: bold;
                box-shadow: -2px 0 10px rgba(0, 0, 0, 0.2);
                transition: all 0.3s ease;
            }
            #aifengyue-extract-btn:hover {
                width: 50px;
                background: linear-gradient(135deg, #059669 0%, #10b981 100%);
                box-shadow: -4px 0 15px rgba(16, 185, 129, 0.4);
            }
            #aifengyue-extract-btn:active {
                transform: translateY(-50%) scale(0.95);
            }
        `);
		},
		createButton() {
			if (this.button) return;
			this.createStyles();
			this.button = document.createElement("button");
			this.button.id = "aifengyue-extract-btn";
			this.button.textContent = "提取HTML";
			this.button.title = "从接口提取应用 HTML 并导出";
			this.button.addEventListener("click", () => this.extractAndSave());
			document.body.appendChild(this.button);
		},
		removeButton() {
			if (this.button) {
				this.button.remove();
				this.button = null;
			}
		},
		getCleanTitle() {
			const title = document.title;
			return title.replace(/\s*-\s*Powered by AI风月\s*$/i, "").trim();
		},
		resolveRetryAttempts(maxAttempts) {
			const parsed = Number(maxAttempts);
			if (Number.isInteger(parsed) && parsed >= 1) {
				return parsed;
			}
			return DEFAULT_OBJECTIVE_RETRY_ATTEMPTS;
		},
		isObjectiveRetryError(error) {
			const status = Number(error?.httpStatus || 0);
			if (status === 408 || status === 429 || status >= 500) {
				return true;
			}
			const message = String(error?.message || "").toLowerCase();
			if (!message) return false;
			return message.includes("timeout") || message.includes("超时") || message.includes("network") || message.includes("网络") || message.includes("failed") || message.includes("中止") || message.includes("abort");
		},
		async requestAppDetail({ appId, token, maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS }) {
			const attempts = this.resolveRetryAttempts(maxAttempts);
			const url = `${window.location.origin}/go/api/apps/${appId}`;
			let lastError = null;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					const response = await gmRequestJson({
						method: "GET",
						url,
						headers: {
							"Content-Type": "application/json",
							"X-Language": X_LANGUAGE,
							...token ? { Authorization: `Bearer ${token}` } : {}
						},
						timeout: 25e3,
						anonymous: true
					});
					if (response.status < 200 || response.status >= 300) {
						const error = new Error(`获取应用详情失败: HTTP ${response.status}`);
						error.httpStatus = response.status;
						throw error;
					}
					if (!response.json || typeof response.json !== "object") {
						throw new Error("应用详情接口返回非 JSON 数据");
					}
					return response.json;
				} catch (error) {
					lastError = error;
					const hasNext = attempt < attempts;
					if (!hasNext || !this.isObjectiveRetryError(error)) {
						throw error;
					}
					await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
				}
			}
			throw lastError || new Error("获取应用详情失败");
		},
		extractAppPayload(payload, fallbackTitle) {
			const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
			const appInfo = data?.apps && typeof data.apps === "object" ? data.apps : data?.app && typeof data.app === "object" ? data.app : {};
			const modelConfig = data?.model_config && typeof data.model_config === "object" ? data.model_config : data?.modelConfig && typeof data.modelConfig === "object" ? data.modelConfig : {};
			return {
				name: decodeEscapedText(typeof appInfo?.name === "string" ? appInfo.name : "") || fallbackTitle,
				description: decodeEscapedText(typeof appInfo?.description === "string" ? appInfo.description : ""),
				builtInCss: decodeEscapedText(typeof modelConfig?.built_in_css === "string" ? modelConfig.built_in_css : "")
			};
		},
		buildHtmlDocument({ name, description, builtInCss }) {
			return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${name}</title>
    <style>
        body {
            margin: 0;
            padding: 24px;
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #f4f5f7;
            color: #1f2937;
            line-height: 1.7;
        }
        .af-root {
            max-width: 960px;
            margin: 0 auto;
            background: #fff;
            border: 1px solid #dce1eb;
            border-radius: 12px;
            padding: 20px;
        }
        .af-title {
            margin: 0 0 16px;
            font-size: 22px;
            font-weight: 700;
        }
        ${builtInCss || ""}
    </style>
</head>
<body>
    <main class="af-root">
        <h1 class="af-title">${name}</h1>
        ${description || "<p>应用描述为空。</p>"}
    </main>
</body>
</html>`;
		},
		downloadHtmlFile(filename, html) {
			const blob = new Blob([html], { type: "text/html;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = filename;
			a.style.display = "none";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		},
		async extractAndSave() {
			const appId = this.extractInstalledAppId();
			if (!appId) {
				Toast.error("当前页面不是应用详情页，无法提取 HTML");
				return;
			}
			const token = (localStorage.getItem("console_token") || "").trim();
			const fallbackTitle = this.getCleanTitle() || `app-${appId}`;
			try {
				Toast.info("正在请求应用详情并导出 HTML...", 2e3);
				const payload = await this.requestAppDetail({
					appId,
					token,
					maxAttempts: DEFAULT_OBJECTIVE_RETRY_ATTEMPTS
				});
				const data = this.extractAppPayload(payload, fallbackTitle);
				const html = this.buildHtmlDocument(data);
				const filename = `${sanitizeFilename(data.name || fallbackTitle)}.html`;
				this.downloadHtmlFile(filename, html);
				Toast.success(`已保存为: ${filename}`);
			} catch (error) {
				Toast.error(`提取失败: ${error.message}`);
				console.error("[HTML 提取器] 错误:", error);
			}
		},
		checkAndUpdate() {
			this.isDetailPage = this.checkDetailPage();
			if (this.button) {
				this.removeButton();
			}
		}
	};

//#endregion
//#region src/features/model-popup-sorter.js
	const ModelPopupSorter = {
		sortScheduled: false,
		popupObserver: null,
		observedPopup: null,
		isSortEnabled() {
			return gmGetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, true);
		},
		setSortEnabled(enabled) {
			gmSetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, !!enabled);
		},
		isEnabled() {
			return this.isSortEnabled() && IframeExtractor.checkDetailPage();
		},
		scheduleSort() {
			if (!this.isEnabled()) {
				if (this.popupObserver) {
					this.popupObserver.disconnect();
					this.popupObserver = null;
				}
				this.observedPopup = null;
				return;
			}
			if (this.sortScheduled) return;
			this.sortScheduled = true;
			requestAnimationFrame(() => {
				this.sortScheduled = false;
				this.sortPopup();
			});
		},
		observePopup(popup) {
			if (!popup) return;
			if (this.observedPopup === popup && this.popupObserver) return;
			if (this.popupObserver) {
				this.popupObserver.disconnect();
				this.popupObserver = null;
			}
			this.observedPopup = popup;
			this.popupObserver = new MutationObserver(() => {
				this.scheduleSort();
			});
			this.popupObserver.observe(popup, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: [
					"class",
					"aria-selected",
					"aria-expanded"
				]
			});
		},
		findPopup() {
			let popup = document.querySelector("div[id=\":rb0:\"][data-floating-ui-portal]");
			if (popup) return popup;
			const portals = document.querySelectorAll("div[data-floating-ui-portal]");
			for (const portal of portals) {
				const hasTabs = portal.querySelector("[role=\"tablist\"]");
				if (!hasTabs) continue;
				if ((portal.textContent || "").includes("价格系数")) {
					return portal;
				}
			}
			return null;
		},
		extractPrice(itemEl) {
			if (!itemEl) return Number.POSITIVE_INFINITY;
			const text = (itemEl.textContent || "").replace(/\s+/g, " ");
			const textMatch = text.match(/价格系数[：:]\s*([0-9]+(?:\.[0-9]+)?)/);
			if (textMatch) {
				const value = parseFloat(textMatch[1]);
				if (Number.isFinite(value)) return value;
			}
			const titleNode = itemEl.querySelector("span[title]");
			if (titleNode) {
				const titleValue = parseFloat(titleNode.getAttribute("title") || "");
				if (Number.isFinite(titleValue)) return titleValue;
			}
			return Number.POSITIVE_INFINITY;
		},
		findCategoryBlocks(popup) {
			const blocks = Array.from(popup.querySelectorAll("div.w-full.cursor-pointer.block"));
			return blocks.filter((block) => Boolean(block.querySelector(".MuiAccordionSummary-root") && block.querySelector(".MuiAccordionDetails-root") && (block.textContent || "").includes("价格系数")));
		},
		buildCategoryMeta(block, blockIndex) {
			const details = block.querySelector(".MuiAccordionDetails-root");
			if (!details) return null;
			const items = Array.from(details.children).filter((child) => {
				return child.nodeType === 1 && (child.textContent || "").includes("价格系数");
			});
			if (items.length === 0) return null;
			const itemMetas = items.map((item, index) => ({
				item,
				index,
				price: this.extractPrice(item)
			}));
			const minPrice = itemMetas.reduce((min, meta) => Math.min(min, meta.price), Number.POSITIVE_INFINITY);
			return {
				block,
				blockIndex,
				details,
				itemMetas,
				minPrice
			};
		},
		sortItemsInCategory(meta) {
			const sorted = [...meta.itemMetas].sort((a, b) => {
				if (a.price !== b.price) return a.price - b.price;
				return a.index - b.index;
			});
			const needReorder = sorted.some((entry, index) => entry.item !== meta.itemMetas[index].item);
			if (!needReorder) return;
			const frag = document.createDocumentFragment();
			sorted.forEach((entry) => frag.appendChild(entry.item));
			meta.details.appendChild(frag);
		},
		sortPopup() {
			const popup = this.findPopup();
			if (!popup) {
				if (this.popupObserver) {
					this.popupObserver.disconnect();
					this.popupObserver = null;
				}
				this.observedPopup = null;
				return;
			}
			this.observePopup(popup);
			const blocks = this.findCategoryBlocks(popup);
			if (blocks.length === 0) return;
			const parent = blocks[0].parentElement;
			if (!parent) return;
			const metas = blocks.map((block, index) => this.buildCategoryMeta(block, index)).filter(Boolean);
			if (metas.length === 0) return;
			metas.forEach((meta) => this.sortItemsInCategory(meta));
			const sortedCategories = [...metas].sort((a, b) => {
				if (a.minPrice !== b.minPrice) return a.minPrice - b.minPrice;
				return a.blockIndex - b.blockIndex;
			});
			const needReorderCategory = sortedCategories.some((entry, index) => entry.block !== metas[index].block);
			if (!needReorderCategory) return;
			const frag = document.createDocumentFragment();
			sortedCategories.forEach((entry) => frag.appendChild(entry.block));
			parent.appendChild(frag);
		}
	};

//#endregion
//#region src/menu/menu-commands.js
	function registerMenuCommands() {
		gmRegisterMenuCommand("🛠 切换调试日志", () => {
			const enabled = toggleDebugEnabled();
			Toast.info(`调试日志已${enabled ? "开启" : "关闭"}`);
		});
		gmRegisterMenuCommand(`🔍 调试日志状态: ${isDebugEnabled() ? "ON" : "OFF"}`, () => {
			Toast.info(`当前调试日志: ${isDebugEnabled() ? "ON" : "OFF"}`);
		});
		gmRegisterMenuCommand("⚙️ 设置 API Key", () => {
			const currentKey = ApiService.getApiKey();
			const newKey = prompt("请输入 GPTMail API Key:", currentKey);
			if (newKey !== null) {
				ApiService.setApiKey(newKey.trim() || CONFIG.DEFAULT_API_KEY);
				Toast.success("API Key 已更新");
				const input = document.querySelector("#aifengyue-api-key");
				if (input) input.value = newKey.trim() || CONFIG.DEFAULT_API_KEY;
			}
		});
		gmRegisterMenuCommand("📧 生成新邮箱", () => {
			AutoRegister.generateNewEmail();
		});
		gmRegisterMenuCommand("🚀 开始自动注册", () => {
			AutoRegister.start();
		});
		gmRegisterMenuCommand(" 获取验证码", () => {
			AutoRegister.fetchVerificationCode();
		});
		gmRegisterMenuCommand("📝 打开侧边栏", () => {
			Sidebar.open();
		});
	}

//#endregion
//#region src/ui/chat-stream-capsule.js
	const CAPSULE_ID = "aifengyue-chat-status-capsule";
	function formatStatus(status) {
		const parsed = Number(status);
		if (Number.isFinite(parsed) && parsed > 0) {
			return `HTTP ${parsed}`;
		}
		return "未知状态";
	}
	const ChatStreamCapsule = {
		styleInjected: false,
		element: null,
		textElement: null,
		inFlight: 0,
		injectStyle() {
			if (this.styleInjected) return;
			this.styleInjected = true;
			gmAddStyle(`
            #${CAPSULE_ID} {
                position: fixed;
                right: 20px;
                bottom: 84px;
                z-index: 2147483647;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border-radius: 999px;
                color: #ffffff;
                font-size: 12px;
                font-weight: 600;
                line-height: 1;
                pointer-events: none;
                user-select: none;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
                transition: transform 0.2s ease, opacity 0.2s ease, background 0.2s ease;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                opacity: 0.95;
            }
            #${CAPSULE_ID} .aifengyue-chat-status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: currentColor;
            }
            #${CAPSULE_ID} .aifengyue-chat-status-text {
                max-width: 360px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${CAPSULE_ID}.is-idle {
                background: rgba(75, 85, 99, 0.92);
                color: #d1d5db;
            }
            #${CAPSULE_ID}.is-sending {
                background: rgba(37, 99, 235, 0.95);
                color: #bfdbfe;
                transform: translateY(-1px);
            }
            #${CAPSULE_ID}.is-waiting {
                background: rgba(245, 158, 11, 0.95);
                color: #fef3c7;
            }
            #${CAPSULE_ID}.is-sending .aifengyue-chat-status-dot {
                animation: aifengyue-chat-capsule-pulse 1s ease-in-out infinite;
            }
            #${CAPSULE_ID}.is-waiting .aifengyue-chat-status-dot {
                animation: aifengyue-chat-capsule-pulse 1.2s ease-in-out infinite;
            }
            #${CAPSULE_ID}.is-done {
                background: rgba(5, 150, 105, 0.95);
                color: #bbf7d0;
            }
            #${CAPSULE_ID}.is-error {
                background: rgba(220, 38, 38, 0.95);
                color: #fecaca;
            }
            @keyframes aifengyue-chat-capsule-pulse {
                0% { transform: scale(1); opacity: 0.8; }
                50% { transform: scale(1.35); opacity: 1; }
                100% { transform: scale(1); opacity: 0.8; }
            }
        `);
		},
		ensureElements() {
			this.injectStyle();
			let element = document.getElementById(CAPSULE_ID);
			if (!element) {
				element = document.createElement("div");
				element.id = CAPSULE_ID;
				element.innerHTML = `
                <span class="aifengyue-chat-status-dot"></span>
                <span class="aifengyue-chat-status-text"></span>
            `;
				document.body.appendChild(element);
			}
			this.element = element;
			this.textElement = element.querySelector(".aifengyue-chat-status-text");
			if (!this.textElement) {
				this.textElement = document.createElement("span");
				this.textElement.className = "aifengyue-chat-status-text";
				this.element.appendChild(this.textElement);
			}
			return true;
		},
		applyView(state, text) {
			if (!this.ensureElements()) return;
			this.element.classList.remove("is-idle", "is-sending", "is-waiting", "is-done", "is-error");
			this.element.classList.add(`is-${state}`);
			this.element.dataset.state = state;
			this.textElement.textContent = text;
		},
		init() {
			this.inFlight = 0;
			this.applyView("idle", "SSE 待命");
		},
		onRequestStart() {
			this.inFlight += 1;
			const suffix = this.inFlight > 1 ? ` (${this.inFlight})` : "";
			this.applyView("sending", `SSE waiting${suffix}`);
		},
		onRequestDone({ ok = false, status = 0, elapsedText = "-" } = {}) {
			this.inFlight = Math.max(0, this.inFlight - 1);
			if (this.inFlight > 0) {
				this.applyView("sending", `SSE waiting (${this.inFlight})`);
				return;
			}
			const statusText = formatStatus(status);
			const prefix = ok ? "SSE 已完成" : "SSE 失败";
			this.applyView(ok ? "done" : "error", `${prefix} · ${statusText} · ${elapsedText}`);
		},
		onSseError({ status = 0, code = "", message = "" } = {}) {
			const statusText = formatStatus(status);
			const codeText = code ? ` ${code}` : "";
			const messageText = message ? ` · ${message}` : "";
			this.applyView("error", `SSE 错误${codeText} · ${statusText}${messageText}`);
		},
		onSseEvent(eventName = "") {
			const event = String(eventName || "").trim();
			if (!event) return;
			if (event === "ping") {
				this.applyView("waiting", "SSE 等待中");
				return;
			}
			if (event === "message") {
				this.applyView("sending", "SSE 输出中");
				return;
			}
			if (event === "message_end") {
				this.applyView("done", "SSE 已完成");
			}
		}
	};

//#endregion
//#region src/runtime/chat-messages-monitor.js
	const CHAT_MESSAGES_PATH = "/chat-messages";
	const LOG_PREFIX = "[AI风月注册助手][CHAT_MONITOR]";
	function logInfo(message, meta) {
		if (meta === undefined) {
			console.log(`${LOG_PREFIX} ${message}`);
			return;
		}
		console.log(`${LOG_PREFIX} ${message}`, meta);
	}
	function logWarn(message, meta) {
		if (meta === undefined) {
			console.warn(`${LOG_PREFIX} ${message}`);
			return;
		}
		console.warn(`${LOG_PREFIX} ${message}`, meta);
	}
	function getUnsafeWindow() {
		const candidate = globalThis && globalThis.unsafeWindow;
		if (!candidate) return null;
		if (candidate === window) return null;
		return candidate;
	}
	function getTargetWindow() {
		return getUnsafeWindow() || window;
	}
	function publishMonitorState(targetWindow, state) {
		try {
			window.__AF_CHAT_MONITOR__ = state;
		} catch {}
		if (!targetWindow || targetWindow === window) return;
		try {
			targetWindow.__AF_CHAT_MONITOR__ = state;
		} catch {}
	}
	function toAbsoluteUrl(input, baseOrigin = window.location.origin) {
		if (input instanceof URL) {
			return input.href;
		}
		if (typeof input === "string") {
			try {
				return new URL(input, baseOrigin).href;
			} catch {
				return "";
			}
		}
		if (input && typeof input.url === "string") {
			try {
				return new URL(input.url, baseOrigin).href;
			} catch {
				return "";
			}
		}
		return "";
	}
	function normalizeMethod(value) {
		const method = typeof value === "string" ? value.trim().toUpperCase() : "";
		return method || "GET";
	}
	function isChatMessagesUrl(url) {
		if (!url) return false;
		try {
			const parsed = new URL(url, window.location.origin);
			return parsed.pathname.includes(CHAT_MESSAGES_PATH);
		} catch {
			return url.includes(CHAT_MESSAGES_PATH);
		}
	}
	function shouldTrack(url, method) {
		if (!isChatMessagesUrl(url)) return false;
		return normalizeMethod(method) === "POST";
	}
	function formatElapsedMs(startedAt) {
		if (!Number.isFinite(Number(startedAt))) return "-";
		const elapsed = Math.max(0, Date.now() - Number(startedAt));
		return `${(elapsed / 1e3).toFixed(1)}s`;
	}
	function compactInlineText(value, maxLen = 100) {
		if (typeof value !== "string") return "";
		const normalized = value.replace(/\s+/g, " ").trim();
		if (!normalized) return "";
		if (normalized.length <= maxLen) return normalized;
		return `${normalized.slice(0, maxLen - 1)}…`;
	}
	function showResultToast({ status = 0, ok = false, elapsedText = "-", channel = "fetch", sseError = null }) {
		const statusText = Number.isFinite(Number(status)) && Number(status) > 0 ? `HTTP ${Number(status)}` : "未知状态";
		const errorCode = sseError?.code ? `, ${sseError.code}` : "";
		const errorHint = sseError?.message ? `, ${compactInlineText(sseError.message, 40)}` : "";
		const text = `/chat-messages 已完成 (${statusText}, ${elapsedText}, ${channel}${errorCode}${errorHint})`;
		if (ok) {
			Toast.success(text, 2800);
		} else if (Number(status) >= 400) {
			Toast.error(text, 3600);
		} else {
			Toast.warning(text, 3200);
		}
	}
	function appendMonitorState(targetWindow, patch) {
		const prev = targetWindow && targetWindow.__AF_CHAT_MONITOR__ || window.__AF_CHAT_MONITOR__ || {};
		const next = {
			...prev,
			...patch,
			updatedAt: new Date().toISOString()
		};
		publishMonitorState(targetWindow, next);
	}
	function findSseSeparator(buffer) {
		const idxCrLf = buffer.indexOf("\r\n\r\n");
		const idxLf = buffer.indexOf("\n\n");
		if (idxCrLf === -1 && idxLf === -1) return null;
		if (idxCrLf === -1) return {
			index: idxLf,
			length: 2
		};
		if (idxLf === -1) return {
			index: idxCrLf,
			length: 4
		};
		if (idxLf < idxCrLf) return {
			index: idxLf,
			length: 2
		};
		return {
			index: idxCrLf,
			length: 4
		};
	}
	function parseSseBlock(rawBlock) {
		if (!rawBlock || !rawBlock.trim()) return null;
		const lines = rawBlock.split(/\r?\n/);
		let eventName = "message";
		let hasEventLine = false;
		const dataLines = [];
		for (const line of lines) {
			if (!line || line.startsWith(":")) continue;
			const idx = line.indexOf(":");
			const key = idx >= 0 ? line.slice(0, idx).trim() : line.trim();
			let value = idx >= 0 ? line.slice(idx + 1) : "";
			if (value.startsWith(" ")) value = value.slice(1);
			if (key === "event" && value) {
				eventName = value;
				hasEventLine = true;
				continue;
			}
			if (key === "data") {
				dataLines.push(value);
			}
		}
		const dataText = dataLines.join("\n").trim();
		if (!dataText && !hasEventLine) return null;
		let json = null;
		if (dataText) {
			try {
				json = JSON.parse(dataText);
			} catch {
				json = null;
			}
		}
		const payloadEvent = json && typeof json.event === "string" ? json.event : "";
		return {
			event: payloadEvent || eventName,
			eventName,
			dataText,
			json
		};
	}
	function toSseError(parsed) {
		if (!parsed) return null;
		const payload = parsed.json;
		if (!payload || typeof payload !== "object") return null;
		const evt = typeof payload.event === "string" ? payload.event : parsed.event;
		if (evt !== "error") return null;
		return {
			event: "error",
			code: typeof payload.code === "string" ? payload.code : "",
			status: Number(payload.status || 0),
			message: typeof payload.message === "string" ? payload.message : "",
			conversationId: typeof payload.conversation_id === "string" ? payload.conversation_id : "",
			messageId: typeof payload.message_id === "string" ? payload.message_id : "",
			raw: payload
		};
	}
	async function observeSseResponse(response, handlers = {}) {
		const onEvent = typeof handlers.onEvent === "function" ? handlers.onEvent : null;
		const emitBlock = (rawBlock) => {
			const parsed = parseSseBlock(rawBlock);
			if (!parsed || !onEvent) return;
			onEvent(parsed);
		};
		const reader = response?.body?.getReader?.();
		if (!reader) {
			const text = await response?.text?.().catch(() => "");
			if (!text) return;
			const blocks = text.split(/\r?\n\r?\n/);
			for (const block of blocks) {
				emitBlock(block);
			}
			return;
		}
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			while (true) {
				const separator = findSseSeparator(buffer);
				if (!separator) break;
				const rawBlock = buffer.slice(0, separator.index);
				buffer = buffer.slice(separator.index + separator.length);
				emitBlock(rawBlock);
			}
		}
		buffer += decoder.decode();
		while (true) {
			const separator = findSseSeparator(buffer);
			if (!separator) break;
			const rawBlock = buffer.slice(0, separator.index);
			buffer = buffer.slice(separator.index + separator.length);
			emitBlock(rawBlock);
		}
		if (buffer.trim()) {
			emitBlock(buffer);
		}
	}
	const ChatMessagesMonitor = {
		started: false,
		targetWindow: null,
		originalFetch: null,
		xhrOpen: null,
		xhrSend: null,
		start() {
			if (this.started) return;
			this.started = true;
			this.targetWindow = getTargetWindow();
			const usingUnsafeWindow = this.targetWindow !== window;
			const baseOrigin = this.targetWindow?.location?.origin || window.location.origin;
			logInfo("开始安装网络监听（/chat-messages）");
			ChatStreamCapsule.init();
			this.hookFetch(this.targetWindow, baseOrigin);
			this.hookXhr(this.targetWindow, baseOrigin);
			const state = {
				started: true,
				path: CHAT_MESSAGES_PATH,
				context: usingUnsafeWindow ? "unsafeWindow" : "window",
				fetchHooked: !!this.originalFetch,
				xhrHooked: !!this.xhrOpen && !!this.xhrSend,
				lastSseEvent: null,
				lastSseError: null,
				updatedAt: new Date().toISOString()
			};
			publishMonitorState(this.targetWindow, state);
			logInfo("网络监听安装完成", {
				context: state.context,
				fetchHooked: !!this.originalFetch,
				xhrHooked: !!this.xhrOpen && !!this.xhrSend
			});
		},
		hookFetch(targetWindow, baseOrigin) {
			if (!targetWindow || typeof targetWindow.fetch !== "function") {
				logWarn("fetch 不可用，跳过 fetch hook");
				return;
			}
			if (this.originalFetch) return;
			this.originalFetch = targetWindow.fetch;
			logInfo("fetch hook 已安装");
			targetWindow.fetch = (...args) => {
				const first = args[0];
				const second = args[1] || {};
				const url = toAbsoluteUrl(first, baseOrigin);
				const method = normalizeMethod(second.method || (first && typeof first === "object" ? first.method : "GET"));
				const startedAt = Date.now();
				const tracked = shouldTrack(url, method);
				const requestState = { sseError: null };
				const promise = this.originalFetch.apply(targetWindow, args);
				if (!tracked) {
					return promise;
				}
				ChatStreamCapsule.onRequestStart();
				logInfo("命中 fetch /chat-messages 请求", {
					method,
					url
				});
				promise.then((response) => {
					let finalized = false;
					const done = () => {
						if (finalized) return;
						finalized = true;
						const finalStatus = Number(requestState.sseError?.status || response?.status || 0);
						const finalOk = !!response?.ok && !requestState.sseError;
						const elapsedText = formatElapsedMs(startedAt);
						logInfo("fetch /chat-messages 请求完成", {
							method,
							url,
							status: finalStatus,
							sseErrorCode: requestState.sseError?.code || ""
						});
						showResultToast({
							status: finalStatus,
							ok: finalOk,
							elapsedText,
							channel: "fetch",
							sseError: requestState.sseError
						});
						ChatStreamCapsule.onRequestDone({
							status: finalStatus,
							ok: finalOk,
							elapsedText
						});
					};
					try {
						const cloned = response?.clone?.();
						if (!cloned) {
							done();
							return;
						}
						observeSseResponse(cloned, { onEvent: (sseEvent) => {
							ChatStreamCapsule.onSseEvent(sseEvent.event || sseEvent.eventName || "");
							appendMonitorState(this.targetWindow, { lastSseEvent: {
								event: sseEvent.event || "",
								eventName: sseEvent.eventName || "",
								at: Date.now()
							} });
							if (sseEvent.event && sseEvent.event !== "message") {
								logInfo("捕获 SSE 事件", {
									method,
									url,
									event: sseEvent.event
								});
							}
							const sseError = toSseError(sseEvent);
							if (!sseError || requestState.sseError) return;
							requestState.sseError = sseError;
							const briefMessage = compactInlineText(sseError.message, 88);
							const codeText = sseError.code || "unknown_error";
							logWarn("捕获 SSE error 事件", {
								method,
								url,
								code: codeText,
								status: sseError.status,
								message: briefMessage,
								conversationId: sseError.conversationId || "",
								messageId: sseError.messageId || ""
							});
							appendMonitorState(this.targetWindow, { lastSseError: {
								code: codeText,
								status: sseError.status,
								message: briefMessage,
								conversationId: sseError.conversationId || "",
								messageId: sseError.messageId || ""
							} });
							ChatStreamCapsule.onSseError({
								status: sseError.status,
								code: codeText,
								message: briefMessage
							});
							Toast.error(`SSE 错误: ${codeText}${briefMessage ? ` · ${briefMessage}` : ""}`, 5200);
						} }).catch((streamError) => {
							logWarn("SSE 解析失败", {
								method,
								url,
								message: streamError?.message || String(streamError)
							});
						}).finally(() => done());
					} catch {
						done();
					}
				}).catch(() => {
					const elapsedText = formatElapsedMs(startedAt);
					logWarn("fetch /chat-messages 请求失败", {
						method,
						url
					});
					showResultToast({
						status: 0,
						ok: false,
						elapsedText,
						channel: "fetch",
						sseError: requestState.sseError
					});
					ChatStreamCapsule.onRequestDone({
						status: 0,
						ok: false,
						elapsedText
					});
				});
				return promise;
			};
		},
		hookXhr(targetWindow, baseOrigin) {
			if (!targetWindow || typeof targetWindow.XMLHttpRequest !== "function") {
				logWarn("XMLHttpRequest 不可用，跳过 xhr hook");
				return;
			}
			if (this.xhrOpen || this.xhrSend) return;
			this.xhrOpen = targetWindow.XMLHttpRequest.prototype.open;
			this.xhrSend = targetWindow.XMLHttpRequest.prototype.send;
			logInfo("xhr hook 已安装");
			targetWindow.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
				const absoluteUrl = toAbsoluteUrl(url, baseOrigin);
				this.__afChatMonitorMeta = {
					method: normalizeMethod(method),
					url: absoluteUrl,
					startedAt: 0,
					tracked: shouldTrack(absoluteUrl, method)
				};
				return ChatMessagesMonitor.xhrOpen.call(this, method, url, ...rest);
			};
			targetWindow.XMLHttpRequest.prototype.send = function(...args) {
				const meta = this.__afChatMonitorMeta;
				if (meta && meta.tracked) {
					meta.startedAt = Date.now();
					ChatStreamCapsule.onRequestStart();
					logInfo("命中 xhr /chat-messages 请求", {
						method: meta.method,
						url: meta.url
					});
					let reported = false;
					const onLoadEnd = () => {
						if (reported) return;
						reported = true;
						const elapsedText = formatElapsedMs(meta.startedAt);
						const status = Number(this.status || 0);
						const ok = status >= 200 && status < 300;
						logInfo("xhr /chat-messages 请求完成", {
							method: meta.method,
							url: meta.url,
							status
						});
						showResultToast({
							status,
							ok,
							elapsedText,
							channel: "xhr"
						});
						ChatStreamCapsule.onRequestDone({
							status,
							ok,
							elapsedText
						});
					};
					this.addEventListener("loadend", onLoadEnd, { once: true });
				}
				return ChatMessagesMonitor.xhrSend.call(this, ...args);
			};
		}
	};

//#endregion
//#region src/runtime/spa-watcher.js
	const SPAWatcher = {
		isSignupPage() {
			if (window.location.pathname.includes("/signup") || window.location.pathname.includes("/register")) {
				return true;
			}
			return AutoRegister.isRegisterPage();
		},
		ensureDOM() {
			const sidebar = document.getElementById("aifengyue-sidebar");
			const toggle = document.getElementById("aifengyue-sidebar-toggle");
			const toastContainer = document.getElementById("aifengyue-toast-container");
			if (!sidebar || !toggle) {
				console.log("[AI风月注册助手] 检测到 DOM 被移除，重新注入...");
				Sidebar.element = null;
				Sidebar.isOpen = false;
				Sidebar.init();
				Toast.info("侧边栏已重新注入", 2e3);
			}
			if (!toastContainer) {
				Toast.container = null;
				Toast.init();
			}
		},
		handlePageChange() {
			const currentUrl = window.location.href;
			if (currentUrl !== APP_STATE.spa.lastUrl) {
				console.log("[AI风月注册助手] URL 变化:", APP_STATE.spa.lastUrl, "->", currentUrl);
				APP_STATE.spa.lastUrl = currentUrl;
				setTimeout(() => {
					if (this.isSignupPage()) {
						console.log("[AI风月注册助手] 检测到注册页面");
						this.ensureDOM();
					} else {
						console.log("[AI风月注册助手] 离开注册页面");
					}
					IframeExtractor.checkAndUpdate();
					ModelPopupSorter.scheduleSort();
					Sidebar.updateToolPanel();
				}, 500);
			}
		},
		startObserver() {
			if (APP_STATE.spa.observer) return;
			APP_STATE.spa.lastUrl = window.location.href;
			APP_STATE.spa.observer = new MutationObserver(() => {
				this.handlePageChange();
				if (!APP_STATE.spa.checkScheduled) {
					APP_STATE.spa.checkScheduled = true;
					requestAnimationFrame(() => {
						APP_STATE.spa.checkScheduled = false;
						if (this.isSignupPage()) {
							this.ensureDOM();
						}
						IframeExtractor.checkAndUpdate();
						ModelPopupSorter.scheduleSort();
						Sidebar.updateToolPanel();
					});
				}
			});
			APP_STATE.spa.observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			this.hookHistoryAPI();
			console.log("[AI风月注册助手] SPA 监听器已启动");
		},
		hookHistoryAPI() {
			const originalPushState = history.pushState;
			const originalReplaceState = history.replaceState;
			history.pushState = (...args) => {
				originalPushState.apply(history, args);
				this.handlePageChange();
			};
			history.replaceState = (...args) => {
				originalReplaceState.apply(history, args);
				this.handlePageChange();
			};
			window.addEventListener("popstate", () => {
				this.handlePageChange();
			});
		},
		stopObserver() {
			if (APP_STATE.spa.observer) {
				APP_STATE.spa.observer.disconnect();
				APP_STATE.spa.observer = null;
			}
		}
	};

//#endregion
//#region src/app.js
	function init() {
		APP_STATE.refs.toast = Toast;
		APP_STATE.refs.sidebar = Sidebar;
		APP_STATE.refs.autoRegister = AutoRegister;
		APP_STATE.refs.iframeExtractor = IframeExtractor;
		APP_STATE.refs.modelPopupSorter = ModelPopupSorter;
		Sidebar.init();
		ChatMessagesMonitor.start();
		SPAWatcher.startObserver();
		registerMenuCommands();
		setTimeout(() => {
			if (SPAWatcher.isSignupPage()) {
				SPAWatcher.ensureDOM();
			}
			IframeExtractor.checkAndUpdate();
			ModelPopupSorter.scheduleSort();
			Sidebar.updateToolPanel();
		}, 800);
		console.log("[AI风月注册助手] 已加载 (SPA 模式)");
	}
	function startApp() {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", init, { once: true });
		} else {
			init();
		}
	}

//#endregion
//#region src/ui/sidebar.css.js
	const SIDEBAR_STYLES = `
    /* ============================
       Light 主题 (默认)
       ============================ */
    #aifengyue-sidebar {
        --af-bg:          #ffffff;
        --af-bg-soft:     #f0f2f7;
        --af-bg-card:     #e4e8f0;
        --af-border:      #c0c7d4;
        --af-text:        #1a1f2e;
        --af-text-soft:   #3d4a5c;
        --af-muted:       #6b7a8d;
        --af-primary:     #6366f1;
        --af-primary-hover: #4f46e5;
        --af-primary-text: #ffffff;
        --af-primary-glow: rgba(99, 102, 241, 0.25);
        --af-accent:      #0ea5e9;
        --af-accent-glow: rgba(14, 165, 233, 0.2);
        --af-input-bg:    #edf0f5;
        --af-input-border: #b5bcc9;
        --af-btn2-bg:     #dde2ed;
        --af-btn2-hover:  #cdd4e2;
        --af-btn2-border: #b5bcc9;
        --af-shadow:      rgba(30, 37, 51, 0.1);
        --af-shadow-lg:   rgba(30, 37, 51, 0.15);
        --af-header-bg:   linear-gradient(135deg, #f4f6fa 0%, #e8ecf5 100%);
        --af-footer-bg:   #eef0f5;
        --af-track-bg:    #d5dae5;
        --af-bar-gradient: linear-gradient(90deg, #6366f1, #0ea5e9);
        --af-success:     #10b981;
        --af-warning:     #f59e0b;
        --af-error:       #ef4444;
        --af-idle:        #94a3b8;
        --af-toggle-bg:   linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
        --af-toggle-shadow: rgba(99, 102, 241, 0.3);
        --af-code-color:  #4f46e5;
        --af-hint-bg:     #eaecf5;
        --af-hint-border: #c0c7d4;
        --af-radius:      12px;
        --af-radius-sm:   8px;
        --af-ease:        cubic-bezier(0.4, 0, 0.2, 1);
        --af-font:        'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
    }

    /* ============================
       Dark 主题
       ============================ */
    #aifengyue-sidebar[data-theme="dark"] {
        --af-bg:          #13151e;
        --af-bg-soft:     #1a1d2b;
        --af-bg-card:     #212435;
        --af-border:      #2d3150;
        --af-text:        #e4e7f0;
        --af-text-soft:   #b0b7c8;
        --af-muted:       #6b7590;
        --af-primary:     #818cf8;
        --af-primary-hover: #6366f1;
        --af-primary-text: #ffffff;
        --af-primary-glow: rgba(129, 140, 248, 0.25);
        --af-accent:      #38bdf8;
        --af-accent-glow: rgba(56, 189, 248, 0.2);
        --af-input-bg:    #1a1d2e;
        --af-input-border: #3d4268;
        --af-btn2-bg:     #2a2e45;
        --af-btn2-hover:  #353a55;
        --af-btn2-border: #4a5080;
        --af-shadow:      rgba(0, 0, 0, 0.2);
        --af-shadow-lg:   rgba(0, 0, 0, 0.35);
        --af-header-bg:   linear-gradient(135deg, #1a1d2b 0%, #13151e 100%);
        --af-footer-bg:   #111320;
        --af-track-bg:    #1e2133;
        --af-bar-gradient: linear-gradient(90deg, #818cf8, #38bdf8);
        --af-success:     #34d399;
        --af-warning:     #fbbf24;
        --af-error:       #f87171;
        --af-idle:        #4b5568;
        --af-toggle-bg:   linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
        --af-toggle-shadow: rgba(129, 140, 248, 0.3);
        --af-code-color:  #818cf8;
        --af-hint-bg:     #1a1d2b;
        --af-hint-border: #2d3150;
    }

    /* ============================
       Global / Layout
       ============================ */
    body.aifengyue-sidebar-inline-mode {
        padding-right: 372px !important;
        box-sizing: border-box;
        transition: padding-right 0.3s var(--af-ease, ease);
    }

    /* --- Toggle 按钮 --- */
    #aifengyue-sidebar-toggle {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 38px;
        height: 100px;
        border: none;
        border-radius: 10px 0 0 10px;
        background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
        color: #fff;
        cursor: pointer;
        z-index: 2147483645;
        writing-mode: vertical-rl;
        font-size: 13px;
        font-weight: 700;
        font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
        letter-spacing: 2px;
        box-shadow: -3px 0 20px rgba(99, 102, 241, 0.35);
        transition: right 0.25s ease, width 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
    }
    #aifengyue-sidebar-toggle:hover {
        width: 46px;
        box-shadow: -4px 0 28px rgba(99, 102, 241, 0.5);
    }
    #aifengyue-sidebar-toggle.is-open {
        right: 372px;
        background: linear-gradient(135deg, #4b5563 0%, #334155 100%);
        box-shadow: -3px 0 18px rgba(51, 65, 85, 0.45);
    }

    /* --- 侧边栏容器 --- */
    #aifengyue-sidebar {
        position: fixed;
        top: 0;
        right: -392px;
        width: 372px;
        height: 100vh;
        background: var(--af-bg);
        color: var(--af-text);
        z-index: 2147483646;
        transition: right 0.3s var(--af-ease);
        box-shadow: -4px 0 32px var(--af-shadow-lg);
        font-family: var(--af-font);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--af-border);
    }
    #aifengyue-sidebar.open {
        right: 0;
    }

    /* --- 头部 --- */
    .aifengyue-sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        background: var(--af-header-bg);
        border-bottom: 1px solid var(--af-border);
        gap: 8px;
    }
    .aifengyue-sidebar-header h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        color: var(--af-text);
        flex: 1;
    }

    /* 主题切换按钮 */
    .aifengyue-theme-toggle {
        width: 32px;
        height: 32px;
        border: 1px solid var(--af-primary);
        border-radius: var(--af-radius-sm);
        background: transparent;
        color: var(--af-primary);
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.25s var(--af-ease);
        padding: 0;
        line-height: 1;
    }
    .aifengyue-theme-toggle:hover {
        background: var(--af-primary);
        color: #fff;
        transform: rotate(20deg) scale(1.05);
        box-shadow: 0 0 12px var(--af-primary-glow);
    }

    .aifengyue-sidebar-close {
        width: 32px;
        height: 32px;
        border: 1px solid var(--af-border);
        border-radius: var(--af-radius-sm);
        background: transparent;
        color: var(--af-text-soft);
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.25s var(--af-ease);
        padding: 0;
        line-height: 1;
    }
    .aifengyue-sidebar-close:hover {
        color: #fff;
        background: var(--af-error);
        border-color: var(--af-error);
    }

    /* --- Tab 导航 --- */
    .aifengyue-sidebar-tabs {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--af-border);
        background: var(--af-bg);
    }
    .aifengyue-tab-btn {
        position: relative;
        border: none;
        background: transparent;
        color: var(--af-muted);
        border-radius: var(--af-radius-sm);
        height: 34px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        font-family: var(--af-font);
        transition: all 0.2s var(--af-ease);
    }
    .aifengyue-tab-btn:hover {
        color: var(--af-text-soft);
        background: var(--af-bg-soft);
    }
    .aifengyue-tab-btn.active {
        color: var(--af-primary);
        background: var(--af-bg-card);
    }
    .aifengyue-tab-btn.active::after {
        content: '';
        position: absolute;
        bottom: 2px;
        left: 30%;
        right: 30%;
        height: 2px;
        border-radius: 2px;
        background: var(--af-primary);
    }

    /* --- 内容区 --- */
    .aifengyue-sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        scrollbar-width: thin;
        scrollbar-color: var(--af-border) transparent;
    }
    .aifengyue-sidebar-content::-webkit-scrollbar {
        width: 4px;
    }
    .aifengyue-sidebar-content::-webkit-scrollbar-track {
        background: transparent;
    }
    .aifengyue-sidebar-content::-webkit-scrollbar-thumb {
        background: var(--af-border);
        border-radius: 4px;
    }

    /* --- 面板动画 --- */
    .aifengyue-panel {
        display: none;
        animation: af-slide-in 0.25s var(--af-ease);
    }
    .aifengyue-panel.active {
        display: block;
    }
    @keyframes af-slide-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* --- Section 区块 --- */
    .aifengyue-section {
        margin-bottom: 10px;
        padding: 14px;
        border: 1px solid var(--af-border);
        border-radius: var(--af-radius);
        background: var(--af-bg-soft);
        transition: border-color 0.2s var(--af-ease);
    }
    .aifengyue-section:hover {
        border-color: color-mix(in srgb, var(--af-primary) 30%, var(--af-border));
    }
    .aifengyue-section-title {
        font-size: 11px;
        color: var(--af-muted);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        margin-bottom: 10px;
    }

    /* --- 状态卡片 --- */
    .aifengyue-status-card {
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 12px;
    }
    .aifengyue-status-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .aifengyue-status-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .aifengyue-status-dot.idle {
        background: var(--af-idle);
    }
    .aifengyue-status-dot.generating {
        background: var(--af-warning);
        animation: af-pulse 1.6s ease-in-out infinite;
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
    }
    .aifengyue-status-dot.polling {
        background: var(--af-accent);
        animation: af-pulse 1.6s ease-in-out infinite;
        box-shadow: 0 0 8px var(--af-accent-glow);
    }
    .aifengyue-status-dot.success {
        background: var(--af-success);
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.35);
    }
    .aifengyue-status-dot.error {
        background: var(--af-error);
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.35);
    }
    @keyframes af-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.4; transform: scale(1.3); }
    }
    .aifengyue-status-text {
        font-size: 13px;
        color: var(--af-text);
        font-weight: 600;
    }
    .aifengyue-status-message {
        margin-top: 10px;
        border-radius: var(--af-radius-sm);
        padding: 8px 10px;
        background: var(--af-input-bg);
        border: 1px solid var(--af-border);
        color: var(--af-muted);
        font-size: 12px;
        line-height: 1.6;
        word-break: break-word;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    }

    /* --- 信息行 --- */
    .aifengyue-info-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid var(--af-border);
    }
    .aifengyue-info-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }
    .aifengyue-info-row:first-child {
        padding-top: 0;
    }
    .aifengyue-info-label {
        min-width: 52px;
        font-size: 12px;
        color: var(--af-muted);
        font-weight: 500;
    }
    .aifengyue-info-value {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        color: var(--af-text);
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .aifengyue-info-value.code {
        color: var(--af-code-color);
        font-weight: 700;
    }
    .aifengyue-copy-btn {
        border: 1px solid var(--af-border);
        background: var(--af-bg);
        color: var(--af-muted);
        border-radius: 6px;
        height: 24px;
        padding: 0 10px;
        cursor: pointer;
        font-size: 11px;
        font-family: var(--af-font);
        font-weight: 500;
        transition: all 0.2s var(--af-ease);
    }
    .aifengyue-copy-btn:hover {
        color: var(--af-primary);
        border-color: var(--af-primary);
    }
    .aifengyue-copy-btn:active {
        transform: scale(0.95);
    }

    /* --- 表单 --- */
    .aifengyue-input-group {
        margin-bottom: 10px;
    }
    .aifengyue-input-group label {
        display: block;
        margin-bottom: 5px;
        color: var(--af-text-soft);
        font-size: 12px;
        font-weight: 500;
    }
    .aifengyue-input-group input,
    .aifengyue-input-group select,
    .aifengyue-input-group textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--af-input-border);
        border-radius: var(--af-radius-sm);
        padding: 8px 10px;
        font-size: 13px;
        font-family: var(--af-font);
        color: var(--af-text);
        background: var(--af-input-bg);
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
    }
    .aifengyue-input-group input,
    .aifengyue-input-group select {
        height: 36px;
        padding: 0 10px;
    }
    .aifengyue-input-group textarea {
        min-height: 96px;
        max-height: 320px;
        line-height: 1.5;
        resize: vertical;
    }
    .aifengyue-switch-textarea {
        min-height: 150px !important;
        max-height: 420px !important;
    }
    .aifengyue-input-group input:focus,
    .aifengyue-input-group select:focus,
    .aifengyue-input-group textarea:focus {
        border-color: var(--af-primary);
        box-shadow: 0 0 0 3px var(--af-primary-glow);
    }
    .aifengyue-input-group input::placeholder {
        color: var(--af-muted);
        opacity: 0.6;
    }
    .aifengyue-input-group textarea::placeholder {
        color: var(--af-muted);
        opacity: 0.6;
    }
    .aifengyue-input-group select option {
        background: var(--af-bg);
        color: var(--af-text);
    }

    /* --- 按钮 --- */
    .aifengyue-btn {
        width: 100%;
        height: 36px;
        border: none;
        border-radius: var(--af-radius-sm);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        font-family: var(--af-font);
        transition: all 0.2s var(--af-ease);
    }
    .aifengyue-btn:hover {
        transform: translateY(-1px);
    }
    .aifengyue-btn:active {
        transform: translateY(0) scale(0.98);
    }
    .aifengyue-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        transform: none;
    }
    .aifengyue-btn-primary {
        background: linear-gradient(135deg, var(--af-primary) 0%, var(--af-primary-hover) 100%);
        color: var(--af-primary-text);
        box-shadow: 0 2px 12px var(--af-primary-glow);
    }
    .aifengyue-btn-primary:hover {
        box-shadow: 0 4px 20px var(--af-primary-glow);
    }
    .aifengyue-btn-secondary {
        background: var(--af-btn2-bg);
        color: var(--af-text);
        border: 1px solid var(--af-btn2-border);
    }
    .aifengyue-btn-secondary:hover {
        background: var(--af-btn2-hover);
        border-color: color-mix(in srgb, var(--af-primary) 40%, var(--af-btn2-border));
    }
    .aifengyue-btn-danger {
        margin-top: 8px;
        background: rgba(239, 68, 68, 0.12);
        color: #991b1b;
        border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .aifengyue-btn-danger:hover {
        background: rgba(239, 68, 68, 0.18);
        border-color: rgba(220, 38, 38, 0.56);
        color: #7f1d1d;
    }
    #aifengyue-sidebar[data-theme="dark"] .aifengyue-btn-danger {
        background: rgba(248, 113, 113, 0.16);
        color: #fecaca;
        border-color: rgba(248, 113, 113, 0.45);
    }
    #aifengyue-sidebar[data-theme="dark"] .aifengyue-btn-danger:hover {
        background: rgba(248, 113, 113, 0.24);
        border-color: rgba(248, 113, 113, 0.7);
        color: #fee2e2;
    }
    .aifengyue-btn-group {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 8px;
    }

    /* --- 提示 --- */
    .aifengyue-hint {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--af-muted);
        border: 1px solid var(--af-hint-border);
        border-radius: 10px;
        padding: 10px 12px 10px 14px;
        background: var(--af-hint-bg);
        border-left: 3px solid var(--af-primary);
    }

    /* --- 工具面板 --- */
    .aifengyue-tools-empty {
        border: 1px dashed var(--af-border);
        border-radius: var(--af-radius);
        padding: 20px 14px;
        text-align: center;
        color: var(--af-muted);
        background: var(--af-bg-card);
        font-size: 13px;
    }
    .aifengyue-tool-block {
        margin-bottom: 10px;
        padding: 14px;
        border-radius: var(--af-radius);
        border: 1px solid var(--af-border);
        background: var(--af-bg-soft);
        transition: border-color 0.2s var(--af-ease);
    }
    .aifengyue-tool-block:hover {
        border-color: color-mix(in srgb, var(--af-primary) 30%, var(--af-border));
    }
    .aifengyue-check-row {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--af-text);
        font-size: 13px;
        margin-bottom: 10px;
        user-select: none;
        cursor: pointer;
    }
    .aifengyue-check-row input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--af-primary);
        cursor: pointer;
    }

    /* --- 会话面板 --- */
    .aifengyue-conversation-viewer {
        width: 100%;
        min-height: 520px;
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: #fff;
    }
    #aifengyue-conversation-chain:disabled,
    #aifengyue-conversation-global-chain:disabled,
    #aifengyue-conversation-refresh:disabled,
    #aifengyue-conversation-global-refresh:disabled,
    #aifengyue-conversation-sync:disabled,
    #aifengyue-conversation-export:disabled,
    #aifengyue-conversation-import-trigger:disabled,
    #aifengyue-conversation-open-preview:disabled,
    #aifengyue-conversation-global-open-preview:disabled,
    #aifengyue-conversation-global-delete:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .aifengyue-conv-latest-card {
        margin-top: 10px;
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 10px;
    }
    .aifengyue-conv-latest-head {
        font-size: 11px;
        color: var(--af-muted);
        margin-bottom: 6px;
        letter-spacing: 0.4px;
    }
    .aifengyue-conv-latest-body {
        font-size: 12px;
        line-height: 1.6;
        color: var(--af-text);
        border: 1px solid var(--af-border);
        background: var(--af-input-bg);
        border-radius: 8px;
        padding: 8px 10px;
        word-break: break-word;
        white-space: pre-wrap;
    }

    /* --- 会话预览浮层 --- */
    #aifengyue-conversation-modal {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
    }
    #aifengyue-conversation-modal.open {
        display: block;
    }
    .aifengyue-conv-modal-backdrop {
        width: 100%;
        height: 100%;
        background: rgba(15, 23, 42, 0.56);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
    }
    .aifengyue-conv-modal-content {
        width: min(1200px, calc(100vw - 40px));
        min-width: 700px;
        height: min(94vh, 1200px);
        border-radius: 12px;
        background: #f7f8fb;
        border: 1px solid rgba(148, 163, 184, 0.4);
        box-shadow: 0 18px 48px rgba(2, 6, 23, 0.42);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .aifengyue-conv-modal-head {
        height: 46px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px 0 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(255, 255, 255, 0.92);
        flex-shrink: 0;
    }
    .aifengyue-conv-modal-title {
        font-size: 14px;
        font-weight: 700;
        color: #1f2937;
    }
    .aifengyue-conv-modal-close {
        width: 30px;
        height: 30px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        color: #374151;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
    }
    .aifengyue-conv-modal-close:hover {
        border-color: #9ca3af;
        background: #f9fafb;
    }
    #aifengyue-conversation-modal .aifengyue-conversation-viewer {
        border: none;
        border-radius: 0;
        min-height: 0;
        height: 100%;
        width: 100%;
        background: #fff;
    }
    @media (max-width: 760px) {
        .aifengyue-conv-modal-content {
            min-width: 0;
            width: calc(100vw - 16px);
            height: calc(100vh - 16px);
        }
        .aifengyue-conv-modal-backdrop {
            padding: 8px;
        }
    }

    /* --- 配额统计 --- */
    .aifengyue-usage-display {
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 12px;
    }
    .aifengyue-usage-head,
    .aifengyue-usage-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
    }
    .aifengyue-muted {
        color: var(--af-muted);
    }
    .aifengyue-usage-track {
        margin: 8px 0;
        height: 6px;
        border-radius: 999px;
        background: var(--af-track-bg);
        overflow: hidden;
    }
    #aifengyue-usage-bar {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: var(--af-bar-gradient);
        transition: width 0.4s var(--af-ease);
    }
    #aifengyue-reset-usage {
        border: none;
        background: transparent;
        color: var(--af-accent);
        cursor: pointer;
        font-size: 12px;
        font-family: var(--af-font);
        padding: 0;
        transition: color 0.2s;
    }
    #aifengyue-reset-usage:hover {
        color: var(--af-primary);
        text-decoration: underline;
    }

    /* --- 脚注 --- */
    .aifengyue-footer {
        border-top: 1px solid var(--af-border);
        background: var(--af-footer-bg);
        color: var(--af-muted);
        padding: 10px 14px;
        text-align: center;
        font-size: 12px;
    }
    .aifengyue-footer a {
        color: var(--af-primary);
        text-decoration: none;
    }
    .aifengyue-footer a:hover {
        text-decoration: underline;
    }
`;
	let injected = false;
	function injectSidebarStyles() {
		if (injected) return;
		gmAddStyle(SIDEBAR_STYLES);
		injected = true;
	}

//#endregion
//#region src/index.js
	injectSidebarStyles();
	startApp();

//#endregion
})();