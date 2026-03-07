// ==UserScript==
// @name         AI风月 自动注册助手
// @namespace    https://github.com/owwkmidream/UserScripts
// @version      2.0.14
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
// @connect      www.emailnator.com
// @connect      emailnator.com
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
			MAIL_PROVIDER_ID: "aifengyue_mail_provider_id",
			MAIL_PROVIDER_API_KEYS: "aifengyue_mail_provider_api_keys",
			MAIL_PROVIDER_USAGE_SNAPSHOTS: "aifengyue_mail_provider_usage_snapshots",
			CURRENT_EMAIL: "current_temp_email",
			GENERATED_PASSWORD: "generated_password",
			GENERATED_USERNAME: "generated_username",
			REGISTRATION_START_TIME: "registration_start_time",
			LOG_DEBUG_ENABLED: "aifengyue_log_debug_enabled",
			RUNTIME_LOG_BUFFER: "aifengyue_runtime_log_buffer",
			AUTO_RELOAD_ENABLED: "aifengyue_auto_reload_enabled",
			CHAT_MESSAGES_TIMEOUT_SECONDS: "aifengyue_chat_messages_timeout_seconds",
			ACCOUNT_POINT_POLL_SECONDS: "aifengyue_account_point_poll_seconds",
			TOKEN_POOL_ENTRIES: "aifengyue_token_pool_entries",
			TOKEN_POOL_CHECK_SECONDS: "aifengyue_token_pool_check_seconds",
			TOKEN_POOL_LAST_CHECK_AT: "aifengyue_token_pool_last_check_at",
			TOKEN_POOL_NEXT_ALLOWED_AT: "aifengyue_token_pool_next_allowed_at",
			TOKEN_POOL_BACKOFF_LEVEL: "aifengyue_token_pool_backoff_level",
			TOKEN_POOL_LAST_ERROR: "aifengyue_token_pool_last_error",
			MODEL_SORT_ENABLED: "aifengyue_model_sort_enabled",
			MODEL_FAMILY_CUSTOM_RULES: "aifengyue_model_family_custom_rules",
			MODEL_POPUP_SORT_METRIC: "aifengyue_model_popup_sort_metric",
			MODEL_POPUP_SORT_DIRECTION: "aifengyue_model_popup_sort_direction",
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
//#region src/services/mail/providers/gptmail-provider.js
	function toNumber$1(value, fallback = 0) {
		const numericValue = Number(value);
		return Number.isFinite(numericValue) ? numericValue : fallback;
	}
	function clampPercentage$1(value) {
		const numericValue = toNumber$1(value, 0);
		return Math.max(0, Math.min(numericValue, 100));
	}
	const GPTMailProvider = {
		id: "gptmail",
		name: "GPTMail",
		supportsUsage: true,
		requiresApiKey: true,
		baseUrl: CONFIG.API_BASE,
		defaultApiKey: CONFIG.DEFAULT_API_KEY,
		defaultQuotaLimit: CONFIG.API_QUOTA_LIMIT,
		apiKeyLabel: "GPTMail API Key",
		apiKeyPlaceholder: `输入你的 API Key (默认: ${CONFIG.DEFAULT_API_KEY})`,
		buildHeaders({ apiKey, headers = {} }) {
			return {
				"X-API-Key": apiKey,
				"Content-Type": "application/json",
				...headers
			};
		},
		parseResponsePayload(payload) {
			if (!payload || typeof payload !== "object") {
				throw new Error("解析响应失败");
			}
			if (!payload.success) {
				throw new Error(payload.error || "请求失败");
			}
			return {
				data: payload.data ?? null,
				usage: payload.usage ?? null
			};
		},
		normalizeUsage(usage) {
			if (!usage || typeof usage !== "object") {
				return null;
			}
			const totalLimit = Math.max(0, toNumber$1(usage.total_limit, this.defaultQuotaLimit));
			const totalUsed = Math.max(0, toNumber$1(usage.total_usage, 0));
			const totalRemaining = Number.isFinite(Number(usage.remaining_total)) ? Number(usage.remaining_total) : totalLimit - totalUsed;
			const dailyLimit = Math.max(0, toNumber$1(usage.daily_limit, 0));
			const dailyUsed = Math.max(0, toNumber$1(usage.used_today, 0));
			const dailyRemaining = Number.isFinite(Number(usage.remaining_today)) ? Number(usage.remaining_today) : dailyLimit > 0 ? dailyLimit - dailyUsed : -1;
			const limit = totalLimit > 0 ? totalLimit : this.defaultQuotaLimit;
			const percentage = limit > 0 ? clampPercentage$1(totalUsed / limit * 100) : 0;
			return {
				used: totalUsed,
				limit,
				remaining: totalRemaining,
				percentage,
				dailyLimit,
				dailyUsed,
				dailyRemaining,
				totalLimit: limit,
				totalUsed,
				totalRemaining,
				supportsUsage: true,
				hasUsage: true,
				usageStatus: "available",
				raw: usage
			};
		},
		createGenerateEmailRequest() {
			return {
				endpoint: "/generate-email",
				method: "GET"
			};
		},
		createGetEmailsRequest(email) {
			return {
				endpoint: `/emails?email=${encodeURIComponent(email)}`,
				method: "GET"
			};
		},
		extractGeneratedEmail(data) {
			const email = typeof data?.email === "string" ? data.email.trim() : "";
			if (!email) {
				throw new Error("邮件接口未返回有效邮箱");
			}
			return email;
		},
		extractEmails(data) {
			return Array.isArray(data?.emails) ? data.emails : [];
		}
	};

//#endregion
//#region src/services/mail/providers/emailnator-provider.js
	const EMAILNATOR_BASE_URL = "https://www.emailnator.com";
	const GENERATE_EMAIL_TYPES = ["dotGmail"];
	function normalizeText(value) {
		return typeof value === "string" ? value.trim() : "";
	}
	function buildCookieJar() {
		const store = new Map();
		return {
			applyResponseHeaders(rawHeaders = "") {
				const lines = String(rawHeaders || "").split(/\r?\n/);
				for (const line of lines) {
					const colonIndex = line.indexOf(":");
					if (colonIndex <= 0) continue;
					const key = line.slice(0, colonIndex).trim().toLowerCase();
					if (key !== "set-cookie") continue;
					const rawCookie = line.slice(colonIndex + 1).trim();
					if (!rawCookie) continue;
					const cookiePair = rawCookie.split(";", 1)[0];
					const equalIndex = cookiePair.indexOf("=");
					if (equalIndex <= 0) continue;
					const name = cookiePair.slice(0, equalIndex).trim();
					const value = cookiePair.slice(equalIndex + 1).trim();
					if (!name) continue;
					if (!value) {
						store.delete(name);
						continue;
					}
					store.set(name, value);
				}
			},
			get(name) {
				return store.get(name) || "";
			},
			toHeader() {
				return Array.from(store.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
			}
		};
	}
	function decodeXsrfToken(value) {
		if (!value) return "";
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}
	function buildBaseHeaders(jar, { includeJsonContentType = false } = {}) {
		const headers = {
			Accept: "application/json, text/plain, */*",
			Origin: EMAILNATOR_BASE_URL,
			Referer: `${EMAILNATOR_BASE_URL}/`,
			"X-Requested-With": "XMLHttpRequest"
		};
		const xsrfToken = decodeXsrfToken(jar.get("XSRF-TOKEN"));
		if (xsrfToken) {
			headers["X-XSRF-TOKEN"] = xsrfToken;
		}
		if (includeJsonContentType) {
			headers["Content-Type"] = "application/json";
		}
		return headers;
	}
	async function requestEmailnator(path, { method = "GET", body, jar, expectJson = true } = {}) {
		const cookieHeader = jar.toHeader();
		const response = await gmRequest({
			method,
			url: `${EMAILNATOR_BASE_URL}${path}`,
			headers: {
				...buildBaseHeaders(jar, { includeJsonContentType: body !== undefined }),
				...cookieHeader ? { Cookie: cookieHeader } : {}
			},
			cookie: cookieHeader || undefined,
			data: body === undefined ? undefined : JSON.stringify(body),
			timeout: 3e4,
			anonymous: true
		});
		jar.applyResponseHeaders(response.responseHeaders || "");
		const status = Number(response.status || 0);
		if (status < 200 || status >= 300) {
			throw new Error(`Emailnator 请求失败 (${status || "unknown"})`);
		}
		const raw = response.responseText || "";
		if (!expectJson) {
			return raw;
		}
		try {
			return JSON.parse(raw);
		} catch {
			throw new Error("Emailnator 返回了无法解析的 JSON");
		}
	}
	async function bootstrapSession() {
		const jar = buildCookieJar();
		await requestEmailnator("/", {
			method: "GET",
			jar,
			expectJson: false
		});
		if (!jar.get("XSRF-TOKEN") || !jar.get("gmailnator_session")) {
			throw new Error("Emailnator 会话初始化失败");
		}
		return jar;
	}
	function fallbackHtmlToText(html) {
		return String(html || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	}
	function resolveRelativeTimeSeconds(unit) {
		switch (unit) {
			case "second":
			case "sec": return 1;
			case "minute":
			case "min": return 60;
			case "hour": return 3600;
			case "day": return 86400;
			case "week": return 604800;
			case "month": return 2592e3;
			case "year": return 31536e3;
			default: return 0;
		}
	}
	function parseTimeTextToTimestamp(timeText) {
		const normalized = normalizeText(timeText);
		if (!normalized) {
			return 0;
		}
		const parsedDate = Date.parse(normalized);
		if (Number.isFinite(parsedDate)) {
			return Math.floor(parsedDate / 1e3);
		}
		const lowerText = normalized.toLowerCase();
		const now = Math.floor(Date.now() / 1e3);
		if (lowerText === "just now") {
			return now;
		}
		if (lowerText === "yesterday") {
			return now - 86400;
		}
		const match = lowerText.match(/(\d+)\s*(second|sec|minute|min|hour|day|week|month|year)s?\s*ago/);
		if (!match) {
			return 0;
		}
		const count = Number(match[1] || 0);
		const unitSeconds = resolveRelativeTimeSeconds(match[2]);
		if (!Number.isFinite(count) || !unitSeconds) {
			return 0;
		}
		return now - count * unitSeconds;
	}
	function htmlToText(html) {
		const rawHtml = normalizeText(html);
		if (!rawHtml) {
			return "";
		}
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(rawHtml, "text/html");
			doc.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());
			const body = doc.body;
			if (!body) {
				return fallbackHtmlToText(rawHtml);
			}
			body.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
			body.querySelectorAll("p, div, section, article, header, footer, aside, li, tr, td, th, h1, h2, h3, h4, h5, h6").forEach((node) => node.append("\n"));
			const text = body.innerText || body.textContent || "";
			return text.replace(/\u00a0/g, " ").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
		} catch {
			return fallbackHtmlToText(rawHtml);
		}
	}
	function normalizeMessage(message, htmlContent = "") {
		const html = normalizeText(htmlContent);
		const content = html ? htmlToText(html) : "";
		const timeText = normalizeText(message?.time);
		return {
			subject: normalizeText(message?.subject),
			from: normalizeText(message?.from),
			messageId: normalizeText(message?.messageID),
			time: timeText,
			timeText,
			timestamp: parseTimeTextToTimestamp(timeText),
			html_content: html,
			content
		};
	}
	async function fetchMessageDetail(jar, email, messageId) {
		if (!messageId) {
			return "";
		}
		return requestEmailnator("/message-list", {
			method: "POST",
			body: {
				email,
				messageID: messageId
			},
			jar,
			expectJson: false
		});
	}
	const EmailnatorProvider = {
		id: "emailnator",
		name: "Emailnator",
		supportsUsage: false,
		requiresApiKey: false,
		baseUrl: EMAILNATOR_BASE_URL,
		async generateEmail() {
			const jar = await bootstrapSession();
			const payload = await requestEmailnator("/generate-email", {
				method: "POST",
				body: { email: GENERATE_EMAIL_TYPES },
				jar
			});
			const email = Array.isArray(payload?.email) ? normalizeText(payload.email[0]) : "";
			if (!email) {
				throw new Error("Emailnator 未返回有效邮箱");
			}
			return email;
		},
		async getEmails(email) {
			const normalizedEmail = normalizeText(email);
			if (!normalizedEmail) {
				return [];
			}
			const jar = await bootstrapSession();
			const payload = await requestEmailnator("/message-list", {
				method: "POST",
				body: { email: normalizedEmail },
				jar
			});
			const messages = Array.isArray(payload?.messageData) ? payload.messageData : [];
			const normalizedMessages = await Promise.all(messages.map(async (message) => {
				const messageId = normalizeText(message?.messageID);
				if (!messageId) {
					return normalizeMessage(message);
				}
				try {
					const htmlContent = await fetchMessageDetail(jar, normalizedEmail, messageId);
					return normalizeMessage(message, htmlContent);
				} catch {
					return normalizeMessage(message);
				}
			}));
			return normalizedMessages;
		}
	};

//#endregion
//#region src/services/mail/provider-registry.js
	const MAIL_PROVIDERS = [GPTMailProvider, EmailnatorProvider];
	function getMailProviderById(providerId) {
		return MAIL_PROVIDERS.find((provider) => provider.id === providerId) || null;
	}

//#endregion
//#region src/utils/retry-policy.js
	function resolveRetryAttempts(maxAttempts, fallback = 3) {
		const parsed = Number(maxAttempts);
		if (Number.isInteger(parsed) && parsed >= 1) {
			return parsed;
		}
		return Number.isInteger(fallback) && fallback >= 1 ? fallback : 3;
	}
	function isRetryableNetworkError(error, { includeHttpStatus = true } = {}) {
		if (includeHttpStatus) {
			const status = Number(error?.httpStatus || error?.status || 0);
			if (status === 408 || status === 429 || status >= 500) {
				return true;
			}
		}
		const message = String(error?.message || "").toLowerCase();
		if (!message) return false;
		return message.includes("timeout") || message.includes("超时") || message.includes("network") || message.includes("网络") || message.includes("gm 请求失败") || message.includes("failed") || message.includes("中止") || message.includes("abort");
	}
	async function runWithRetries(task, { maxAttempts = 3, waitBaseMs = 700, isRetryable = isRetryableNetworkError, onRetry = null } = {}) {
		const attempts = resolveRetryAttempts(maxAttempts, 3);
		let lastError = null;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				return await task(attempt, attempts);
			} catch (error) {
				lastError = error;
				const hasNext = attempt < attempts;
				if (!hasNext || !isRetryable(error)) {
					throw error;
				}
				const waitMs = Math.max(0, Number(waitBaseMs) || 0) * attempt;
				if (typeof onRetry === "function") {
					await onRetry({
						attempt,
						attempts,
						waitMs,
						error
					});
				}
				if (waitMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, waitMs));
				}
			}
		}
		throw lastError || new Error("重试执行失败");
	}

//#endregion
//#region src/services/mail-service.js
	const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$2 = 3;
	const DEFAULT_PROVIDER_ID = MAIL_PROVIDERS[0]?.id || "gptmail";
	const usageListeners = new Set();
	function isPlainObject(value) {
		return !!value && typeof value === "object" && !Array.isArray(value);
	}
	function toNumber(value, fallback = 0) {
		const numericValue = Number(value);
		return Number.isFinite(numericValue) ? numericValue : fallback;
	}
	function clampPercentage(value) {
		return Math.max(0, Math.min(toNumber(value, 0), 100));
	}
	function getProviderDefaultApiKey(provider) {
		return typeof provider?.defaultApiKey === "string" ? provider.defaultApiKey : "";
	}
	function readProviderApiKeys() {
		const stored = gmGetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_API_KEYS, null);
		if (isPlainObject(stored)) {
			return { ...stored };
		}
		const legacyKey = gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, "");
		return legacyKey ? { [DEFAULT_PROVIDER_ID]: legacyKey } : {};
	}
	function writeProviderApiKeys(providerApiKeys) {
		gmSetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_API_KEYS, providerApiKeys);
		const defaultProviderKey = providerApiKeys?.[DEFAULT_PROVIDER_ID];
		if (typeof defaultProviderKey === "string") {
			gmSetValue(CONFIG.STORAGE_KEYS.API_KEY, defaultProviderKey);
		}
	}
	function readUsageSnapshots() {
		const stored = gmGetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_USAGE_SNAPSHOTS, null);
		if (isPlainObject(stored)) {
			return { ...stored };
		}
		return {};
	}
	function writeUsageSnapshots(usageSnapshots) {
		gmSetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_USAGE_SNAPSHOTS, usageSnapshots);
	}
	function createFallbackUsageSnapshot(provider) {
		const supportsUsage = provider?.supportsUsage !== false;
		const limit = supportsUsage ? Math.max(0, toNumber(provider?.defaultQuotaLimit, CONFIG.API_QUOTA_LIMIT)) : 0;
		return {
			providerId: provider?.id || DEFAULT_PROVIDER_ID,
			supportsUsage,
			used: 0,
			limit,
			remaining: limit,
			percentage: 0,
			dailyLimit: 0,
			dailyUsed: 0,
			dailyRemaining: -1,
			totalLimit: limit,
			totalUsed: 0,
			totalRemaining: limit,
			hasUsage: false,
			usageStatus: supportsUsage ? "pending" : "unsupported",
			raw: null
		};
	}
	function normalizeStoredUsageSnapshot(provider, snapshot) {
		const fallback = createFallbackUsageSnapshot(provider);
		if (!isPlainObject(snapshot)) {
			return fallback;
		}
		const limit = Math.max(0, toNumber(snapshot.limit ?? snapshot.totalLimit, fallback.limit));
		const used = Math.max(0, toNumber(snapshot.used ?? snapshot.totalUsed, 0));
		const remaining = Number.isFinite(Number(snapshot.remaining)) ? Number(snapshot.remaining) : limit - used;
		const percentage = limit > 0 ? clampPercentage(snapshot.percentage ?? used / limit * 100) : 0;
		const dailyLimit = Math.max(0, toNumber(snapshot.dailyLimit, 0));
		const dailyUsed = Math.max(0, toNumber(snapshot.dailyUsed, 0));
		const dailyRemaining = Number.isFinite(Number(snapshot.dailyRemaining)) ? Number(snapshot.dailyRemaining) : dailyLimit > 0 ? dailyLimit - dailyUsed : -1;
		const totalLimit = Math.max(0, toNumber(snapshot.totalLimit, limit));
		const totalUsed = Math.max(0, toNumber(snapshot.totalUsed, used));
		const totalRemaining = Number.isFinite(Number(snapshot.totalRemaining)) ? Number(snapshot.totalRemaining) : remaining;
		return {
			...fallback,
			...snapshot,
			providerId: provider.id,
			used,
			limit,
			remaining,
			percentage,
			dailyLimit,
			dailyUsed,
			dailyRemaining,
			totalLimit,
			totalUsed,
			totalRemaining,
			supportsUsage: snapshot.supportsUsage !== false,
			hasUsage: snapshot.hasUsage === true,
			usageStatus: snapshot.hasUsage === true ? "available" : snapshot.usageStatus || fallback.usageStatus,
			raw: isPlainObject(snapshot.raw) ? snapshot.raw : null
		};
	}
	const MailService = {
		listProviders() {
			return MAIL_PROVIDERS.map((provider) => ({
				id: provider.id,
				name: provider.name,
				supportsUsage: provider.supportsUsage !== false,
				requiresApiKey: provider.requiresApiKey !== false,
				apiKeyLabel: provider.apiKeyLabel,
				apiKeyPlaceholder: provider.apiKeyPlaceholder
			}));
		},
		resolveProvider(providerId = this.getCurrentProviderId()) {
			const provider = getMailProviderById(providerId);
			if (!provider) {
				throw new Error(`未找到邮件提供商: ${providerId}`);
			}
			return provider;
		},
		getCurrentProviderId() {
			const savedProviderId = gmGetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_ID, DEFAULT_PROVIDER_ID);
			return getMailProviderById(savedProviderId) ? savedProviderId : DEFAULT_PROVIDER_ID;
		},
		setCurrentProviderId(providerId) {
			const provider = this.resolveProvider(providerId);
			gmSetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_ID, provider.id);
			this.emitUsageChange(this.getUsageSnapshot(provider.id));
			return provider.id;
		},
		getCurrentProvider() {
			return this.resolveProvider();
		},
		getCurrentProviderMeta(providerId = this.getCurrentProviderId()) {
			const provider = this.resolveProvider(providerId);
			return {
				id: provider.id,
				name: provider.name,
				supportsUsage: provider.supportsUsage !== false,
				requiresApiKey: provider.requiresApiKey !== false,
				apiKeyLabel: provider.apiKeyLabel || "邮件 API Key",
				apiKeyPlaceholder: provider.apiKeyPlaceholder || "输入你的邮件 API Key",
				defaultApiKey: getProviderDefaultApiKey(provider)
			};
		},
		getDefaultApiKey(providerId = this.getCurrentProviderId()) {
			return this.getCurrentProviderMeta(providerId).defaultApiKey;
		},
		getApiKey(providerId = this.getCurrentProviderId()) {
			const provider = this.resolveProvider(providerId);
			const providerApiKeys = readProviderApiKeys();
			const savedKey = typeof providerApiKeys[provider.id] === "string" ? providerApiKeys[provider.id].trim() : "";
			return savedKey || this.getDefaultApiKey(provider.id);
		},
		setApiKey(key, providerId = this.getCurrentProviderId()) {
			const provider = this.resolveProvider(providerId);
			const normalizedKey = provider.requiresApiKey === false ? "" : typeof key === "string" && key.trim() ? key.trim() : this.getDefaultApiKey(provider.id);
			const providerApiKeys = readProviderApiKeys();
			if (normalizedKey) {
				providerApiKeys[provider.id] = normalizedKey;
			} else {
				delete providerApiKeys[provider.id];
			}
			writeProviderApiKeys(providerApiKeys);
			this.clearUsageSnapshot(provider.id, { emit: provider.id === this.getCurrentProviderId() });
			return normalizedKey;
		},
		getUsageCount(providerId = this.getCurrentProviderId()) {
			return this.getUsageSnapshot(providerId).used;
		},
		getRemainingQuota(providerId = this.getCurrentProviderId()) {
			return this.getUsageSnapshot(providerId).remaining;
		},
		getUsageSnapshot(providerId = this.getCurrentProviderId()) {
			const provider = this.resolveProvider(providerId);
			const usageSnapshots = readUsageSnapshots();
			return normalizeStoredUsageSnapshot(provider, usageSnapshots[provider.id]);
		},
		updateUsageSnapshot(snapshot, providerId = this.getCurrentProviderId()) {
			const provider = this.resolveProvider(providerId);
			if (!snapshot) {
				return this.getUsageSnapshot(provider.id);
			}
			const normalizedSnapshot = normalizeStoredUsageSnapshot(provider, {
				...snapshot,
				hasUsage: snapshot.hasUsage !== false
			});
			const usageSnapshots = readUsageSnapshots();
			usageSnapshots[provider.id] = normalizedSnapshot;
			writeUsageSnapshots(usageSnapshots);
			if (provider.id === this.getCurrentProviderId()) {
				this.emitUsageChange(normalizedSnapshot);
			}
			return normalizedSnapshot;
		},
		resetUsageCount(providerId = this.getCurrentProviderId()) {
			this.clearUsageSnapshot(providerId);
		},
		clearUsageSnapshot(providerId = this.getCurrentProviderId(), { emit = true } = {}) {
			const provider = this.resolveProvider(providerId);
			const usageSnapshots = readUsageSnapshots();
			if (provider.id in usageSnapshots) {
				delete usageSnapshots[provider.id];
				writeUsageSnapshots(usageSnapshots);
			}
			if (emit) {
				this.emitUsageChange(this.getUsageSnapshot(provider.id));
			}
		},
		subscribeUsageChange(listener) {
			if (typeof listener !== "function") {
				return () => {};
			}
			usageListeners.add(listener);
			return () => {
				usageListeners.delete(listener);
			};
		},
		emitUsageChange(snapshot = this.getUsageSnapshot()) {
			const normalizedSnapshot = normalizeStoredUsageSnapshot(this.getCurrentProvider(), snapshot);
			for (const listener of usageListeners) {
				try {
					listener(normalizedSnapshot);
				} catch {}
			}
		},
		resolveRetryAttempts(maxAttempts) {
			return resolveRetryAttempts(maxAttempts, DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$2);
		},
		isObjectiveRetryError(error) {
			return isRetryableNetworkError(error, { includeHttpStatus: false });
		},
		async request(endpoint, options = {}) {
			const provider = this.resolveProvider(options.providerId);
			const attempts = this.resolveRetryAttempts(options.maxAttempts);
			let lastError = null;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					return await this.requestOnce(provider, endpoint, options);
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
		async requestOnce(provider, endpoint, options = {}) {
			const response = await gmRequestJson({
				method: options.method || "GET",
				url: `${provider.baseUrl}${endpoint}`,
				headers: typeof provider.buildHeaders === "function" ? provider.buildHeaders({
					apiKey: this.getApiKey(provider.id),
					headers: options.headers
				}) : options.headers || {},
				body: options.body,
				rawBody: options.rawBody,
				timeout: options.timeout ?? 3e4,
				anonymous: options.anonymous ?? true
			});
			if (!response.json) {
				throw new Error("解析响应失败");
			}
			const parsedResponse = provider.parseResponsePayload(response.json, {
				endpoint,
				status: response.status,
				headers: response.headers
			});
			const usageSnapshot = typeof provider.normalizeUsage === "function" ? provider.normalizeUsage(parsedResponse.usage) : null;
			if (usageSnapshot) {
				this.updateUsageSnapshot(usageSnapshot, provider.id);
			}
			return parsedResponse.data;
		},
		async generateEmail() {
			const provider = this.getCurrentProvider();
			if (typeof provider.generateEmail === "function") {
				return provider.generateEmail({
					mailService: this,
					provider
				});
			}
			const requestConfig = provider.createGenerateEmailRequest();
			const data = await this.request(requestConfig.endpoint, {
				providerId: provider.id,
				method: requestConfig.method,
				headers: requestConfig.headers,
				body: requestConfig.body,
				rawBody: requestConfig.rawBody,
				timeout: requestConfig.timeout,
				anonymous: requestConfig.anonymous
			});
			return provider.extractGeneratedEmail(data);
		},
		async getEmails(email) {
			const provider = this.getCurrentProvider();
			if (typeof provider.getEmails === "function") {
				return provider.getEmails(email, {
					mailService: this,
					provider
				});
			}
			const requestConfig = provider.createGetEmailsRequest(email);
			const data = await this.request(requestConfig.endpoint, {
				providerId: provider.id,
				method: requestConfig.method,
				headers: requestConfig.headers,
				body: requestConfig.body,
				rawBody: requestConfig.rawBody,
				timeout: requestConfig.timeout,
				anonymous: requestConfig.anonymous
			});
			return provider.extractEmails(data);
		}
	};

//#endregion
//#region src/utils/text-normalize.js
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
	function hasMeaningfulText$1(value) {
		let normalized = "";
		if (value !== null && value !== undefined) {
			if (typeof value === "string") {
				normalized = decodeEscapedText$1(value);
			} else {
				normalized = String(value);
			}
		}
		const lowered = normalized.trim().toLowerCase();
		if (!lowered) return false;
		if (lowered === "null" || lowered === "undefined" || lowered === "\"\"" || lowered === "''") {
			return false;
		}
		return true;
	}

//#endregion
//#region src/vendor/marked.esm.js
/**
	* marked v17.0.4 - a markdown parser
	* Copyright (c) 2018-2026, MarkedJS. (MIT License)
	* Copyright (c) 2011-2018, Christopher Jeffrey. (MIT License)
	* https://github.com/markedjs/marked
	*/
	/**
	* DO NOT EDIT THIS FILE
	* The code in this file is generated from files in ./src/
	*/
	function M() {
		return {
			async: !1,
			breaks: !1,
			extensions: null,
			gfm: !0,
			hooks: null,
			pedantic: !1,
			renderer: null,
			silent: !1,
			tokenizer: null,
			walkTokens: null
		};
	}
	var T = M();
	function G(u) {
		T = u;
	}
	var _ = { exec: () => null };
	function k(u, e = "") {
		let t = typeof u == "string" ? u : u.source, n = {
			replace: (r, i) => {
				let s = typeof i == "string" ? i : i.source;
				return s = s.replace(m.caret, "$1"), t = t.replace(r, s), n;
			},
			getRegex: () => new RegExp(t, e)
		};
		return n;
	}
	var Re = (() => {
		try {
			return !!new RegExp("(?<=1)(?<!1)");
		} catch {
			return !1;
		}
	})(), m = {
		codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm,
		outputLinkReplace: /\\([\[\]])/g,
		indentCodeCompensation: /^(\s+)(?:```)/,
		beginningSpace: /^\s+/,
		endingHash: /#$/,
		startingSpaceChar: /^ /,
		endingSpaceChar: / $/,
		nonSpaceChar: /[^ ]/,
		newLineCharGlobal: /\n/g,
		tabCharGlobal: /\t/g,
		multipleSpaceGlobal: /\s+/g,
		blankLine: /^[ \t]*$/,
		doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
		blockquoteStart: /^ {0,3}>/,
		blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
		blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
		listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
		listIsTask: /^\[[ xX]\] +\S/,
		listReplaceTask: /^\[[ xX]\] +/,
		listTaskCheckbox: /\[[ xX]\]/,
		anyLine: /\n.*\n/,
		hrefBrackets: /^<(.*)>$/,
		tableDelimiter: /[:|]/,
		tableAlignChars: /^\||\| *$/g,
		tableRowBlankLine: /\n[ \t]*$/,
		tableAlignRight: /^ *-+: *$/,
		tableAlignCenter: /^ *:-+: *$/,
		tableAlignLeft: /^ *:-+ *$/,
		startATag: /^<a /i,
		endATag: /^<\/a>/i,
		startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
		endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
		startAngleBracket: /^</,
		endAngleBracket: />$/,
		pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
		unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
		escapeTest: /[&<>"']/,
		escapeReplace: /[&<>"']/g,
		escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
		escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
		caret: /(^|[^\[])\^/g,
		percentDecode: /%25/g,
		findPipe: /\|/g,
		splitPipe: / \|/,
		slashPipe: /\\\|/g,
		carriageReturn: /\r\n|\r/g,
		spaceLine: /^ +$/gm,
		notSpaceStart: /^\S*/,
		endingNewline: /\n$/,
		listItemRegex: (u) => new RegExp(`^( {0,3}${u})((?:[	 ][^\\n]*)?(?:\\n|$))`),
		nextBulletRegex: (u) => new RegExp(`^ {0,${Math.min(3, u - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),
		hrRegex: (u) => new RegExp(`^ {0,${Math.min(3, u - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),
		fencesBeginRegex: (u) => new RegExp(`^ {0,${Math.min(3, u - 1)}}(?:\`\`\`|~~~)`),
		headingBeginRegex: (u) => new RegExp(`^ {0,${Math.min(3, u - 1)}}#`),
		htmlBeginRegex: (u) => new RegExp(`^ {0,${Math.min(3, u - 1)}}<(?:[a-z].*>|!--)`, "i"),
		blockquoteBeginRegex: (u) => new RegExp(`^ {0,${Math.min(3, u - 1)}}>`)
	}, Te = /^(?:[ \t]*(?:\n|$))+/, Oe = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/, we = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/, A = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/, ye = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/, N = / {0,3}(?:[*+-]|\d{1,9}[.)])/, re = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/, se = k(re).replace(/bull/g, N).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex(), Pe = k(re).replace(/bull/g, N).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(), Q = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/, Se = /^[^\n]+/, j = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/, $e = k(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", j).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(), _e = k(/^(bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g, N).getRegex(), q = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul", F = /<!--(?:-?>|[\s\S]*?(?:-->|$))/, Le = k("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", F).replace("tag", q).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(), ie = k(Q).replace("hr", A).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", q).getRegex(), Me = k(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", ie).getRegex(), U = {
		blockquote: Me,
		code: Oe,
		def: $e,
		fences: we,
		heading: ye,
		hr: A,
		html: Le,
		lheading: se,
		list: _e,
		newline: Te,
		paragraph: ie,
		table: _,
		text: Se
	}, te = k("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", A).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", q).getRegex(), ze = {
		...U,
		lheading: Pe,
		table: te,
		paragraph: k(Q).replace("hr", A).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", te).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", q).getRegex()
	}, Ee = {
		...U,
		html: k(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", F).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
		def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
		heading: /^(#{1,6})(.*)(?:\n+|$)/,
		fences: _,
		lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
		paragraph: k(Q).replace("hr", A).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", se).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
	}, Ie = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/, Ae = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/, oe = /^( {2,}|\\)\n(?!\s*$)/, Ce = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/, v = /[\p{P}\p{S}]/u, K = /[\s\p{P}\p{S}]/u, ae = /[^\s\p{P}\p{S}]/u, Be = k(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, K).getRegex(), le = /(?!~)[\p{P}\p{S}]/u, De = /(?!~)[\s\p{P}\p{S}]/u, qe = /(?:[^\s\p{P}\p{S}]|~)/u, ue = /(?![*_])[\p{P}\p{S}]/u, ve = /(?![*_])[\s\p{P}\p{S}]/u, He = /(?:[^\s\p{P}\p{S}]|[*_])/u, Ge = k(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Re ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex(), pe = /^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/, Ze = k(pe, "u").replace(/punct/g, v).getRegex(), Ne = k(pe, "u").replace(/punct/g, le).getRegex(), ce = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)", Qe = k(ce, "gu").replace(/notPunctSpace/g, ae).replace(/punctSpace/g, K).replace(/punct/g, v).getRegex(), je = k(ce, "gu").replace(/notPunctSpace/g, qe).replace(/punctSpace/g, De).replace(/punct/g, le).getRegex(), Fe = k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, ae).replace(/punctSpace/g, K).replace(/punct/g, v).getRegex(), Ue = k(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, ue).getRegex(), Ke = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)", We = k(Ke, "gu").replace(/notPunctSpace/g, He).replace(/punctSpace/g, ve).replace(/punct/g, ue).getRegex(), Xe = k(/\\(punct)/, "gu").replace(/punct/g, v).getRegex(), Je = k(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(), Ve = k(F).replace("(?:-->|$)", "-->").getRegex(), Ye = k("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", Ve).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(), D = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/, et = k(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", D).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(), he = k(/^!?\[(label)\]\[(ref)\]/).replace("label", D).replace("ref", j).getRegex(), ke = k(/^!?\[(ref)\](?:\[\])?/).replace("ref", j).getRegex(), tt = k("reflink|nolink(?!\\()", "g").replace("reflink", he).replace("nolink", ke).getRegex(), ne = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/, W = {
		_backpedal: _,
		anyPunctuation: Xe,
		autolink: Je,
		blockSkip: Ge,
		br: oe,
		code: Ae,
		del: _,
		delLDelim: _,
		delRDelim: _,
		emStrongLDelim: Ze,
		emStrongRDelimAst: Qe,
		emStrongRDelimUnd: Fe,
		escape: Ie,
		link: et,
		nolink: ke,
		punctuation: Be,
		reflink: he,
		reflinkSearch: tt,
		tag: Ye,
		text: Ce,
		url: _
	}, nt = {
		...W,
		link: k(/^!?\[(label)\]\((.*?)\)/).replace("label", D).getRegex(),
		reflink: k(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", D).getRegex()
	}, Z = {
		...W,
		emStrongRDelimAst: je,
		emStrongLDelim: Ne,
		delLDelim: Ue,
		delRDelim: We,
		url: k(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ne).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),
		_backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
		del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,
		text: k(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ne).getRegex()
	}, rt = {
		...Z,
		br: k(oe).replace("{2,}", "*").getRegex(),
		text: k(Z.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
	}, C = {
		normal: U,
		gfm: ze,
		pedantic: Ee
	}, z = {
		normal: W,
		gfm: Z,
		breaks: rt,
		pedantic: nt
	};
	var st = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	}, de = (u) => st[u];
	function O(u, e) {
		if (e) {
			if (m.escapeTest.test(u)) return u.replace(m.escapeReplace, de);
		} else if (m.escapeTestNoEncode.test(u)) return u.replace(m.escapeReplaceNoEncode, de);
		return u;
	}
	function X(u) {
		try {
			u = encodeURI(u).replace(m.percentDecode, "%");
		} catch {
			return null;
		}
		return u;
	}
	function J(u, e) {
		let t = u.replace(m.findPipe, (i, s, a) => {
			let o = !1, l = s;
			for (; --l >= 0 && a[l] === "\\";) o = !o;
			return o ? "|" : " |";
		}), n = t.split(m.splitPipe), r = 0;
		if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
		else for (; n.length < e;) n.push("");
		for (; r < n.length; r++) n[r] = n[r].trim().replace(m.slashPipe, "|");
		return n;
	}
	function E(u, e, t) {
		let n = u.length;
		if (n === 0) return "";
		let r = 0;
		for (; r < n;) {
			let i = u.charAt(n - r - 1);
			if (i === e && !t) r++;
			else if (i !== e && t) r++;
			else break;
		}
		return u.slice(0, n - r);
	}
	function ge(u, e) {
		if (u.indexOf(e[1]) === -1) return -1;
		let t = 0;
		for (let n = 0; n < u.length; n++) if (u[n] === "\\") n++;
		else if (u[n] === e[0]) t++;
		else if (u[n] === e[1] && (t--, t < 0)) return n;
		return t > 0 ? -2 : -1;
	}
	function fe(u, e = 0) {
		let t = e, n = "";
		for (let r of u) if (r === "	") {
			let i = 4 - t % 4;
			n += " ".repeat(i), t += i;
		} else n += r, t++;
		return n;
	}
	function me(u, e, t, n, r) {
		let i = e.href, s = e.title || null, a = u[1].replace(r.other.outputLinkReplace, "$1");
		n.state.inLink = !0;
		let o = {
			type: u[0].charAt(0) === "!" ? "image" : "link",
			raw: t,
			href: i,
			title: s,
			text: a,
			tokens: n.inlineTokens(a)
		};
		return n.state.inLink = !1, o;
	}
	function it(u, e, t) {
		let n = u.match(t.other.indentCodeCompensation);
		if (n === null) return e;
		let r = n[1];
		return e.split(`
`).map((i) => {
			let s = i.match(t.other.beginningSpace);
			if (s === null) return i;
			let [a] = s;
			return a.length >= r.length ? i.slice(r.length) : i;
		}).join(`
`);
	}
	var w = class {
		options;
		rules;
		lexer;
		constructor(e) {
			this.options = e || T;
		}
		space(e) {
			let t = this.rules.block.newline.exec(e);
			if (t && t[0].length > 0) return {
				type: "space",
				raw: t[0]
			};
		}
		code(e) {
			let t = this.rules.block.code.exec(e);
			if (t) {
				let n = t[0].replace(this.rules.other.codeRemoveIndent, "");
				return {
					type: "code",
					raw: t[0],
					codeBlockStyle: "indented",
					text: this.options.pedantic ? n : E(n, `
`)
				};
			}
		}
		fences(e) {
			let t = this.rules.block.fences.exec(e);
			if (t) {
				let n = t[0], r = it(n, t[3] || "", this.rules);
				return {
					type: "code",
					raw: n,
					lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2],
					text: r
				};
			}
		}
		heading(e) {
			let t = this.rules.block.heading.exec(e);
			if (t) {
				let n = t[2].trim();
				if (this.rules.other.endingHash.test(n)) {
					let r = E(n, "#");
					(this.options.pedantic || !r || this.rules.other.endingSpaceChar.test(r)) && (n = r.trim());
				}
				return {
					type: "heading",
					raw: t[0],
					depth: t[1].length,
					text: n,
					tokens: this.lexer.inline(n)
				};
			}
		}
		hr(e) {
			let t = this.rules.block.hr.exec(e);
			if (t) return {
				type: "hr",
				raw: E(t[0], `
`)
			};
		}
		blockquote(e) {
			let t = this.rules.block.blockquote.exec(e);
			if (t) {
				let n = E(t[0], `
`).split(`
`), r = "", i = "", s = [];
				for (; n.length > 0;) {
					let a = !1, o = [], l;
					for (l = 0; l < n.length; l++) if (this.rules.other.blockquoteStart.test(n[l])) o.push(n[l]), a = !0;
					else if (!a) o.push(n[l]);
					else break;
					n = n.slice(l);
					let p = o.join(`
`), c = p.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
					r = r ? `${r}
${p}` : p, i = i ? `${i}
${c}` : c;
					let d = this.lexer.state.top;
					if (this.lexer.state.top = !0, this.lexer.blockTokens(c, s, !0), this.lexer.state.top = d, n.length === 0) break;
					let h = s.at(-1);
					if (h?.type === "code") break;
					if (h?.type === "blockquote") {
						let R = h, f = R.raw + `
` + n.join(`
`), S = this.blockquote(f);
						s[s.length - 1] = S, r = r.substring(0, r.length - R.raw.length) + S.raw, i = i.substring(0, i.length - R.text.length) + S.text;
						break;
					} else if (h?.type === "list") {
						let R = h, f = R.raw + `
` + n.join(`
`), S = this.list(f);
						s[s.length - 1] = S, r = r.substring(0, r.length - h.raw.length) + S.raw, i = i.substring(0, i.length - R.raw.length) + S.raw, n = f.substring(s.at(-1).raw.length).split(`
`);
						continue;
					}
				}
				return {
					type: "blockquote",
					raw: r,
					tokens: s,
					text: i
				};
			}
		}
		list(e) {
			let t = this.rules.block.list.exec(e);
			if (t) {
				let n = t[1].trim(), r = n.length > 1, i = {
					type: "list",
					raw: "",
					ordered: r,
					start: r ? +n.slice(0, -1) : "",
					loose: !1,
					items: []
				};
				n = r ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = r ? n : "[*+-]");
				let s = this.rules.other.listItemRegex(n), a = !1;
				for (; e;) {
					let l = !1, p = "", c = "";
					if (!(t = s.exec(e)) || this.rules.block.hr.test(e)) break;
					p = t[0], e = e.substring(p.length);
					let d = fe(t[2].split(`
`, 1)[0], t[1].length), h = e.split(`
`, 1)[0], R = !d.trim(), f = 0;
					if (this.options.pedantic ? (f = 2, c = d.trimStart()) : R ? f = t[1].length + 1 : (f = d.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, c = d.slice(f), f += t[1].length), R && this.rules.other.blankLine.test(h) && (p += h + `
`, e = e.substring(h.length + 1), l = !0), !l) {
						let S = this.rules.other.nextBulletRegex(f), V = this.rules.other.hrRegex(f), Y = this.rules.other.fencesBeginRegex(f), ee = this.rules.other.headingBeginRegex(f), xe = this.rules.other.htmlBeginRegex(f), be = this.rules.other.blockquoteBeginRegex(f);
						for (; e;) {
							let H = e.split(`
`, 1)[0], I;
							if (h = H, this.options.pedantic ? (h = h.replace(this.rules.other.listReplaceNesting, "  "), I = h) : I = h.replace(this.rules.other.tabCharGlobal, "    "), Y.test(h) || ee.test(h) || xe.test(h) || be.test(h) || S.test(h) || V.test(h)) break;
							if (I.search(this.rules.other.nonSpaceChar) >= f || !h.trim()) c += `
` + I.slice(f);
							else {
								if (R || d.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || Y.test(d) || ee.test(d) || V.test(d)) break;
								c += `
` + h;
							}
							R = !h.trim(), p += H + `
`, e = e.substring(H.length + 1), d = I.slice(f);
						}
					}
					i.loose || (a ? i.loose = !0 : this.rules.other.doubleBlankLine.test(p) && (a = !0)), i.items.push({
						type: "list_item",
						raw: p,
						task: !!this.options.gfm && this.rules.other.listIsTask.test(c),
						loose: !1,
						text: c,
						tokens: []
					}), i.raw += p;
				}
				let o = i.items.at(-1);
				if (o) o.raw = o.raw.trimEnd(), o.text = o.text.trimEnd();
				else return;
				i.raw = i.raw.trimEnd();
				for (let l of i.items) {
					if (this.lexer.state.top = !1, l.tokens = this.lexer.blockTokens(l.text, []), l.task) {
						if (l.text = l.text.replace(this.rules.other.listReplaceTask, ""), l.tokens[0]?.type === "text" || l.tokens[0]?.type === "paragraph") {
							l.tokens[0].raw = l.tokens[0].raw.replace(this.rules.other.listReplaceTask, ""), l.tokens[0].text = l.tokens[0].text.replace(this.rules.other.listReplaceTask, "");
							for (let c = this.lexer.inlineQueue.length - 1; c >= 0; c--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[c].src)) {
								this.lexer.inlineQueue[c].src = this.lexer.inlineQueue[c].src.replace(this.rules.other.listReplaceTask, "");
								break;
							}
						}
						let p = this.rules.other.listTaskCheckbox.exec(l.raw);
						if (p) {
							let c = {
								type: "checkbox",
								raw: p[0] + " ",
								checked: p[0] !== "[ ]"
							};
							l.checked = c.checked, i.loose ? l.tokens[0] && ["paragraph", "text"].includes(l.tokens[0].type) && "tokens" in l.tokens[0] && l.tokens[0].tokens ? (l.tokens[0].raw = c.raw + l.tokens[0].raw, l.tokens[0].text = c.raw + l.tokens[0].text, l.tokens[0].tokens.unshift(c)) : l.tokens.unshift({
								type: "paragraph",
								raw: c.raw,
								text: c.raw,
								tokens: [c]
							}) : l.tokens.unshift(c);
						}
					}
					if (!i.loose) {
						let p = l.tokens.filter((d) => d.type === "space"), c = p.length > 0 && p.some((d) => this.rules.other.anyLine.test(d.raw));
						i.loose = c;
					}
				}
				if (i.loose) for (let l of i.items) {
					l.loose = !0;
					for (let p of l.tokens) p.type === "text" && (p.type = "paragraph");
				}
				return i;
			}
		}
		html(e) {
			let t = this.rules.block.html.exec(e);
			if (t) return {
				type: "html",
				block: !0,
				raw: t[0],
				pre: t[1] === "pre" || t[1] === "script" || t[1] === "style",
				text: t[0]
			};
		}
		def(e) {
			let t = this.rules.block.def.exec(e);
			if (t) {
				let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), r = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", i = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
				return {
					type: "def",
					tag: n,
					raw: t[0],
					href: r,
					title: i
				};
			}
		}
		table(e) {
			let t = this.rules.block.table.exec(e);
			if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
			let n = J(t[1]), r = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), i = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], s = {
				type: "table",
				raw: t[0],
				header: [],
				align: [],
				rows: []
			};
			if (n.length === r.length) {
				for (let a of r) this.rules.other.tableAlignRight.test(a) ? s.align.push("right") : this.rules.other.tableAlignCenter.test(a) ? s.align.push("center") : this.rules.other.tableAlignLeft.test(a) ? s.align.push("left") : s.align.push(null);
				for (let a = 0; a < n.length; a++) s.header.push({
					text: n[a],
					tokens: this.lexer.inline(n[a]),
					header: !0,
					align: s.align[a]
				});
				for (let a of i) s.rows.push(J(a, s.header.length).map((o, l) => ({
					text: o,
					tokens: this.lexer.inline(o),
					header: !1,
					align: s.align[l]
				})));
				return s;
			}
		}
		lheading(e) {
			let t = this.rules.block.lheading.exec(e);
			if (t) return {
				type: "heading",
				raw: t[0],
				depth: t[2].charAt(0) === "=" ? 1 : 2,
				text: t[1],
				tokens: this.lexer.inline(t[1])
			};
		}
		paragraph(e) {
			let t = this.rules.block.paragraph.exec(e);
			if (t) {
				let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
				return {
					type: "paragraph",
					raw: t[0],
					text: n,
					tokens: this.lexer.inline(n)
				};
			}
		}
		text(e) {
			let t = this.rules.block.text.exec(e);
			if (t) return {
				type: "text",
				raw: t[0],
				text: t[0],
				tokens: this.lexer.inline(t[0])
			};
		}
		escape(e) {
			let t = this.rules.inline.escape.exec(e);
			if (t) return {
				type: "escape",
				raw: t[0],
				text: t[1]
			};
		}
		tag(e) {
			let t = this.rules.inline.tag.exec(e);
			if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = !0 : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = !1), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = !0 : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = !1), {
				type: "html",
				raw: t[0],
				inLink: this.lexer.state.inLink,
				inRawBlock: this.lexer.state.inRawBlock,
				block: !1,
				text: t[0]
			};
		}
		link(e) {
			let t = this.rules.inline.link.exec(e);
			if (t) {
				let n = t[2].trim();
				if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
					if (!this.rules.other.endAngleBracket.test(n)) return;
					let s = E(n.slice(0, -1), "\\");
					if ((n.length - s.length) % 2 === 0) return;
				} else {
					let s = ge(t[2], "()");
					if (s === -2) return;
					if (s > -1) {
						let o = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + s;
						t[2] = t[2].substring(0, s), t[0] = t[0].substring(0, o).trim(), t[3] = "";
					}
				}
				let r = t[2], i = "";
				if (this.options.pedantic) {
					let s = this.rules.other.pedanticHrefTitle.exec(r);
					s && (r = s[1], i = s[3]);
				} else i = t[3] ? t[3].slice(1, -1) : "";
				return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? r = r.slice(1) : r = r.slice(1, -1)), me(t, {
					href: r && r.replace(this.rules.inline.anyPunctuation, "$1"),
					title: i && i.replace(this.rules.inline.anyPunctuation, "$1")
				}, t[0], this.lexer, this.rules);
			}
		}
		reflink(e, t) {
			let n;
			if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
				let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), i = t[r.toLowerCase()];
				if (!i) {
					let s = n[0].charAt(0);
					return {
						type: "text",
						raw: s,
						text: s
					};
				}
				return me(n, i, n[0], this.lexer, this.rules);
			}
		}
		emStrong(e, t, n = "") {
			let r = this.rules.inline.emStrongLDelim.exec(e);
			if (!r || r[3] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
			if (!(r[1] || r[2] || "") || !n || this.rules.inline.punctuation.exec(n)) {
				let s = [...r[0]].length - 1, a, o, l = s, p = 0, c = r[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
				for (c.lastIndex = 0, t = t.slice(-1 * e.length + s); (r = c.exec(t)) != null;) {
					if (a = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !a) continue;
					if (o = [...a].length, r[3] || r[4]) {
						l += o;
						continue;
					} else if ((r[5] || r[6]) && s % 3 && !((s + o) % 3)) {
						p += o;
						continue;
					}
					if (l -= o, l > 0) continue;
					o = Math.min(o, o + l + p);
					let d = [...r[0]][0].length, h = e.slice(0, s + r.index + d + o);
					if (Math.min(s, o) % 2) {
						let f = h.slice(1, -1);
						return {
							type: "em",
							raw: h,
							text: f,
							tokens: this.lexer.inlineTokens(f)
						};
					}
					let R = h.slice(2, -2);
					return {
						type: "strong",
						raw: h,
						text: R,
						tokens: this.lexer.inlineTokens(R)
					};
				}
			}
		}
		codespan(e) {
			let t = this.rules.inline.code.exec(e);
			if (t) {
				let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), r = this.rules.other.nonSpaceChar.test(n), i = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
				return r && i && (n = n.substring(1, n.length - 1)), {
					type: "codespan",
					raw: t[0],
					text: n
				};
			}
		}
		br(e) {
			let t = this.rules.inline.br.exec(e);
			if (t) return {
				type: "br",
				raw: t[0]
			};
		}
		del(e, t, n = "") {
			let r = this.rules.inline.delLDelim.exec(e);
			if (!r) return;
			if (!(r[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
				let s = [...r[0]].length - 1, a, o, l = s, p = this.rules.inline.delRDelim;
				for (p.lastIndex = 0, t = t.slice(-1 * e.length + s); (r = p.exec(t)) != null;) {
					if (a = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !a || (o = [...a].length, o !== s)) continue;
					if (r[3] || r[4]) {
						l += o;
						continue;
					}
					if (l -= o, l > 0) continue;
					o = Math.min(o, o + l);
					let c = [...r[0]][0].length, d = e.slice(0, s + r.index + c + o), h = d.slice(s, -s);
					return {
						type: "del",
						raw: d,
						text: h,
						tokens: this.lexer.inlineTokens(h)
					};
				}
			}
		}
		autolink(e) {
			let t = this.rules.inline.autolink.exec(e);
			if (t) {
				let n, r;
				return t[2] === "@" ? (n = t[1], r = "mailto:" + n) : (n = t[1], r = n), {
					type: "link",
					raw: t[0],
					text: n,
					href: r,
					tokens: [{
						type: "text",
						raw: n,
						text: n
					}]
				};
			}
		}
		url(e) {
			let t;
			if (t = this.rules.inline.url.exec(e)) {
				let n, r;
				if (t[2] === "@") n = t[0], r = "mailto:" + n;
				else {
					let i;
					do
						i = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
					while (i !== t[0]);
					n = t[0], t[1] === "www." ? r = "http://" + t[0] : r = t[0];
				}
				return {
					type: "link",
					raw: t[0],
					text: n,
					href: r,
					tokens: [{
						type: "text",
						raw: n,
						text: n
					}]
				};
			}
		}
		inlineText(e) {
			let t = this.rules.inline.text.exec(e);
			if (t) {
				let n = this.lexer.state.inRawBlock;
				return {
					type: "text",
					raw: t[0],
					text: t[0],
					escaped: n
				};
			}
		}
	};
	var x = class u {
		tokens;
		options;
		state;
		inlineQueue;
		tokenizer;
		constructor(e) {
			this.tokens = [], this.tokens.links = Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new w(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = {
				inLink: !1,
				inRawBlock: !1,
				top: !0
			};
			let t = {
				other: m,
				block: C.normal,
				inline: z.normal
			};
			this.options.pedantic ? (t.block = C.pedantic, t.inline = z.pedantic) : this.options.gfm && (t.block = C.gfm, this.options.breaks ? t.inline = z.breaks : t.inline = z.gfm), this.tokenizer.rules = t;
		}
		static get rules() {
			return {
				block: C,
				inline: z
			};
		}
		static lex(e, t) {
			return new u(t).lex(e);
		}
		static lexInline(e, t) {
			return new u(t).inlineTokens(e);
		}
		lex(e) {
			e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
			for (let t = 0; t < this.inlineQueue.length; t++) {
				let n = this.inlineQueue[t];
				this.inlineTokens(n.src, n.tokens);
			}
			return this.inlineQueue = [], this.tokens;
		}
		blockTokens(e, t = [], n = !1) {
			for (this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, "")); e;) {
				let r;
				if (this.options.extensions?.block?.some((s) => (r = s.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), !0) : !1)) continue;
				if (r = this.tokenizer.space(e)) {
					e = e.substring(r.raw.length);
					let s = t.at(-1);
					r.raw.length === 1 && s !== void 0 ? s.raw += `
` : t.push(r);
					continue;
				}
				if (r = this.tokenizer.code(e)) {
					e = e.substring(r.raw.length);
					let s = t.at(-1);
					s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.at(-1).src = s.text) : t.push(r);
					continue;
				}
				if (r = this.tokenizer.fences(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				if (r = this.tokenizer.heading(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				if (r = this.tokenizer.hr(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				if (r = this.tokenizer.blockquote(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				if (r = this.tokenizer.list(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				if (r = this.tokenizer.html(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				if (r = this.tokenizer.def(e)) {
					e = e.substring(r.raw.length);
					let s = t.at(-1);
					s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.raw, this.inlineQueue.at(-1).src = s.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = {
						href: r.href,
						title: r.title
					}, t.push(r));
					continue;
				}
				if (r = this.tokenizer.table(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				if (r = this.tokenizer.lheading(e)) {
					e = e.substring(r.raw.length), t.push(r);
					continue;
				}
				let i = e;
				if (this.options.extensions?.startBlock) {
					let s = 1 / 0, a = e.slice(1), o;
					this.options.extensions.startBlock.forEach((l) => {
						o = l.call({ lexer: this }, a), typeof o == "number" && o >= 0 && (s = Math.min(s, o));
					}), s < 1 / 0 && s >= 0 && (i = e.substring(0, s + 1));
				}
				if (this.state.top && (r = this.tokenizer.paragraph(i))) {
					let s = t.at(-1);
					n && s?.type === "paragraph" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
					continue;
				}
				if (r = this.tokenizer.text(e)) {
					e = e.substring(r.raw.length);
					let s = t.at(-1);
					s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r);
					continue;
				}
				if (e) {
					let s = "Infinite loop on byte: " + e.charCodeAt(0);
					if (this.options.silent) {
						console.error(s);
						break;
					} else throw new Error(s);
				}
			}
			return this.state.top = !0, t;
		}
		inline(e, t = []) {
			return this.inlineQueue.push({
				src: e,
				tokens: t
			}), t;
		}
		inlineTokens(e, t = []) {
			let n = e, r = null;
			if (this.tokens.links) {
				let o = Object.keys(this.tokens.links);
				if (o.length > 0) for (; (r = this.tokenizer.rules.inline.reflinkSearch.exec(n)) != null;) o.includes(r[0].slice(r[0].lastIndexOf("[") + 1, -1)) && (n = n.slice(0, r.index) + "[" + "a".repeat(r[0].length - 2) + "]" + n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));
			}
			for (; (r = this.tokenizer.rules.inline.anyPunctuation.exec(n)) != null;) n = n.slice(0, r.index) + "++" + n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
			let i;
			for (; (r = this.tokenizer.rules.inline.blockSkip.exec(n)) != null;) i = r[2] ? r[2].length : 0, n = n.slice(0, r.index + i) + "[" + "a".repeat(r[0].length - i - 2) + "]" + n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
			n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
			let s = !1, a = "";
			for (; e;) {
				s || (a = ""), s = !1;
				let o;
				if (this.options.extensions?.inline?.some((p) => (o = p.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), !0) : !1)) continue;
				if (o = this.tokenizer.escape(e)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (o = this.tokenizer.tag(e)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (o = this.tokenizer.link(e)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (o = this.tokenizer.reflink(e, this.tokens.links)) {
					e = e.substring(o.raw.length);
					let p = t.at(-1);
					o.type === "text" && p?.type === "text" ? (p.raw += o.raw, p.text += o.text) : t.push(o);
					continue;
				}
				if (o = this.tokenizer.emStrong(e, n, a)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (o = this.tokenizer.codespan(e)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (o = this.tokenizer.br(e)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (o = this.tokenizer.del(e, n, a)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (o = this.tokenizer.autolink(e)) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				if (!this.state.inLink && (o = this.tokenizer.url(e))) {
					e = e.substring(o.raw.length), t.push(o);
					continue;
				}
				let l = e;
				if (this.options.extensions?.startInline) {
					let p = 1 / 0, c = e.slice(1), d;
					this.options.extensions.startInline.forEach((h) => {
						d = h.call({ lexer: this }, c), typeof d == "number" && d >= 0 && (p = Math.min(p, d));
					}), p < 1 / 0 && p >= 0 && (l = e.substring(0, p + 1));
				}
				if (o = this.tokenizer.inlineText(l)) {
					e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (a = o.raw.slice(-1)), s = !0;
					let p = t.at(-1);
					p?.type === "text" ? (p.raw += o.raw, p.text += o.text) : t.push(o);
					continue;
				}
				if (e) {
					let p = "Infinite loop on byte: " + e.charCodeAt(0);
					if (this.options.silent) {
						console.error(p);
						break;
					} else throw new Error(p);
				}
			}
			return t;
		}
	};
	var y = class {
		options;
		parser;
		constructor(e) {
			this.options = e || T;
		}
		space(e) {
			return "";
		}
		code({ text: e, lang: t, escaped: n }) {
			let r = (t || "").match(m.notSpaceStart)?.[0], i = e.replace(m.endingNewline, "") + `
`;
			return r ? "<pre><code class=\"language-" + O(r) + "\">" + (n ? i : O(i, !0)) + `</code></pre>
` : "<pre><code>" + (n ? i : O(i, !0)) + `</code></pre>
`;
		}
		blockquote({ tokens: e }) {
			return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
		}
		html({ text: e }) {
			return e;
		}
		def(e) {
			return "";
		}
		heading({ tokens: e, depth: t }) {
			return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
		}
		hr(e) {
			return `<hr>
`;
		}
		list(e) {
			let t = e.ordered, n = e.start, r = "";
			for (let a = 0; a < e.items.length; a++) {
				let o = e.items[a];
				r += this.listitem(o);
			}
			let i = t ? "ol" : "ul", s = t && n !== 1 ? " start=\"" + n + "\"" : "";
			return "<" + i + s + `>
` + r + "</" + i + `>
`;
		}
		listitem(e) {
			return `<li>${this.parser.parse(e.tokens)}</li>
`;
		}
		checkbox({ checked: e }) {
			return "<input " + (e ? "checked=\"\" " : "") + "disabled=\"\" type=\"checkbox\"> ";
		}
		paragraph({ tokens: e }) {
			return `<p>${this.parser.parseInline(e)}</p>
`;
		}
		table(e) {
			let t = "", n = "";
			for (let i = 0; i < e.header.length; i++) n += this.tablecell(e.header[i]);
			t += this.tablerow({ text: n });
			let r = "";
			for (let i = 0; i < e.rows.length; i++) {
				let s = e.rows[i];
				n = "";
				for (let a = 0; a < s.length; a++) n += this.tablecell(s[a]);
				r += this.tablerow({ text: n });
			}
			return r && (r = `<tbody>${r}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + r + `</table>
`;
		}
		tablerow({ text: e }) {
			return `<tr>
${e}</tr>
`;
		}
		tablecell(e) {
			let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
			return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
		}
		strong({ tokens: e }) {
			return `<strong>${this.parser.parseInline(e)}</strong>`;
		}
		em({ tokens: e }) {
			return `<em>${this.parser.parseInline(e)}</em>`;
		}
		codespan({ text: e }) {
			return `<code>${O(e, !0)}</code>`;
		}
		br(e) {
			return "<br>";
		}
		del({ tokens: e }) {
			return `<del>${this.parser.parseInline(e)}</del>`;
		}
		link({ href: e, title: t, tokens: n }) {
			let r = this.parser.parseInline(n), i = X(e);
			if (i === null) return r;
			e = i;
			let s = "<a href=\"" + e + "\"";
			return t && (s += " title=\"" + O(t) + "\""), s += ">" + r + "</a>", s;
		}
		image({ href: e, title: t, text: n, tokens: r }) {
			r && (n = this.parser.parseInline(r, this.parser.textRenderer));
			let i = X(e);
			if (i === null) return O(n);
			e = i;
			let s = `<img src="${e}" alt="${O(n)}"`;
			return t && (s += ` title="${O(t)}"`), s += ">", s;
		}
		text(e) {
			return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
		}
	};
	var $ = class {
		strong({ text: e }) {
			return e;
		}
		em({ text: e }) {
			return e;
		}
		codespan({ text: e }) {
			return e;
		}
		del({ text: e }) {
			return e;
		}
		html({ text: e }) {
			return e;
		}
		text({ text: e }) {
			return e;
		}
		link({ text: e }) {
			return "" + e;
		}
		image({ text: e }) {
			return "" + e;
		}
		br() {
			return "";
		}
		checkbox({ raw: e }) {
			return e;
		}
	};
	var b = class u {
		options;
		renderer;
		textRenderer;
		constructor(e) {
			this.options = e || T, this.options.renderer = this.options.renderer || new y(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new $();
		}
		static parse(e, t) {
			return new u(t).parse(e);
		}
		static parseInline(e, t) {
			return new u(t).parseInline(e);
		}
		parse(e) {
			let t = "";
			for (let n = 0; n < e.length; n++) {
				let r = e[n];
				if (this.options.extensions?.renderers?.[r.type]) {
					let s = r, a = this.options.extensions.renderers[s.type].call({ parser: this }, s);
					if (a !== !1 || ![
						"space",
						"hr",
						"heading",
						"code",
						"table",
						"blockquote",
						"list",
						"html",
						"def",
						"paragraph",
						"text"
					].includes(s.type)) {
						t += a || "";
						continue;
					}
				}
				let i = r;
				switch (i.type) {
					case "space": {
						t += this.renderer.space(i);
						break;
					}
					case "hr": {
						t += this.renderer.hr(i);
						break;
					}
					case "heading": {
						t += this.renderer.heading(i);
						break;
					}
					case "code": {
						t += this.renderer.code(i);
						break;
					}
					case "table": {
						t += this.renderer.table(i);
						break;
					}
					case "blockquote": {
						t += this.renderer.blockquote(i);
						break;
					}
					case "list": {
						t += this.renderer.list(i);
						break;
					}
					case "checkbox": {
						t += this.renderer.checkbox(i);
						break;
					}
					case "html": {
						t += this.renderer.html(i);
						break;
					}
					case "def": {
						t += this.renderer.def(i);
						break;
					}
					case "paragraph": {
						t += this.renderer.paragraph(i);
						break;
					}
					case "text": {
						t += this.renderer.text(i);
						break;
					}
					default: {
						let s = "Token with \"" + i.type + "\" type was not found.";
						if (this.options.silent) return console.error(s), "";
						throw new Error(s);
					}
				}
			}
			return t;
		}
		parseInline(e, t = this.renderer) {
			let n = "";
			for (let r = 0; r < e.length; r++) {
				let i = e[r];
				if (this.options.extensions?.renderers?.[i.type]) {
					let a = this.options.extensions.renderers[i.type].call({ parser: this }, i);
					if (a !== !1 || ![
						"escape",
						"html",
						"link",
						"image",
						"strong",
						"em",
						"codespan",
						"br",
						"del",
						"text"
					].includes(i.type)) {
						n += a || "";
						continue;
					}
				}
				let s = i;
				switch (s.type) {
					case "escape": {
						n += t.text(s);
						break;
					}
					case "html": {
						n += t.html(s);
						break;
					}
					case "link": {
						n += t.link(s);
						break;
					}
					case "image": {
						n += t.image(s);
						break;
					}
					case "checkbox": {
						n += t.checkbox(s);
						break;
					}
					case "strong": {
						n += t.strong(s);
						break;
					}
					case "em": {
						n += t.em(s);
						break;
					}
					case "codespan": {
						n += t.codespan(s);
						break;
					}
					case "br": {
						n += t.br(s);
						break;
					}
					case "del": {
						n += t.del(s);
						break;
					}
					case "text": {
						n += t.text(s);
						break;
					}
					default: {
						let a = "Token with \"" + s.type + "\" type was not found.";
						if (this.options.silent) return console.error(a), "";
						throw new Error(a);
					}
				}
			}
			return n;
		}
	};
	var P = class {
		options;
		block;
		constructor(e) {
			this.options = e || T;
		}
		static passThroughHooks = new Set([
			"preprocess",
			"postprocess",
			"processAllTokens",
			"emStrongMask"
		]);
		static passThroughHooksRespectAsync = new Set([
			"preprocess",
			"postprocess",
			"processAllTokens"
		]);
		preprocess(e) {
			return e;
		}
		postprocess(e) {
			return e;
		}
		processAllTokens(e) {
			return e;
		}
		emStrongMask(e) {
			return e;
		}
		provideLexer() {
			return this.block ? x.lex : x.lexInline;
		}
		provideParser() {
			return this.block ? b.parse : b.parseInline;
		}
	};
	var B = class {
		defaults = M();
		options = this.setOptions;
		parse = this.parseMarkdown(!0);
		parseInline = this.parseMarkdown(!1);
		Parser = b;
		Renderer = y;
		TextRenderer = $;
		Lexer = x;
		Tokenizer = w;
		Hooks = P;
		constructor(...e) {
			this.use(...e);
		}
		walkTokens(e, t) {
			let n = [];
			for (let r of e) switch (n = n.concat(t.call(this, r)), r.type) {
				case "table": {
					let i = r;
					for (let s of i.header) n = n.concat(this.walkTokens(s.tokens, t));
					for (let s of i.rows) for (let a of s) n = n.concat(this.walkTokens(a.tokens, t));
					break;
				}
				case "list": {
					let i = r;
					n = n.concat(this.walkTokens(i.items, t));
					break;
				}
				default: {
					let i = r;
					this.defaults.extensions?.childTokens?.[i.type] ? this.defaults.extensions.childTokens[i.type].forEach((s) => {
						let a = i[s].flat(1 / 0);
						n = n.concat(this.walkTokens(a, t));
					}) : i.tokens && (n = n.concat(this.walkTokens(i.tokens, t)));
				}
			}
			return n;
		}
		use(...e) {
			let t = this.defaults.extensions || {
				renderers: {},
				childTokens: {}
			};
			return e.forEach((n) => {
				let r = { ...n };
				if (r.async = this.defaults.async || r.async || !1, n.extensions && (n.extensions.forEach((i) => {
					if (!i.name) throw new Error("extension name required");
					if ("renderer" in i) {
						let s = t.renderers[i.name];
						s ? t.renderers[i.name] = function(...a) {
							let o = i.renderer.apply(this, a);
							return o === !1 && (o = s.apply(this, a)), o;
						} : t.renderers[i.name] = i.renderer;
					}
					if ("tokenizer" in i) {
						if (!i.level || i.level !== "block" && i.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
						let s = t[i.level];
						s ? s.unshift(i.tokenizer) : t[i.level] = [i.tokenizer], i.start && (i.level === "block" ? t.startBlock ? t.startBlock.push(i.start) : t.startBlock = [i.start] : i.level === "inline" && (t.startInline ? t.startInline.push(i.start) : t.startInline = [i.start]));
					}
					"childTokens" in i && i.childTokens && (t.childTokens[i.name] = i.childTokens);
				}), r.extensions = t), n.renderer) {
					let i = this.defaults.renderer || new y(this.defaults);
					for (let s in n.renderer) {
						if (!(s in i)) throw new Error(`renderer '${s}' does not exist`);
						if (["options", "parser"].includes(s)) continue;
						let a = s, o = n.renderer[a], l = i[a];
						i[a] = (...p) => {
							let c = o.apply(i, p);
							return c === !1 && (c = l.apply(i, p)), c || "";
						};
					}
					r.renderer = i;
				}
				if (n.tokenizer) {
					let i = this.defaults.tokenizer || new w(this.defaults);
					for (let s in n.tokenizer) {
						if (!(s in i)) throw new Error(`tokenizer '${s}' does not exist`);
						if ([
							"options",
							"rules",
							"lexer"
						].includes(s)) continue;
						let a = s, o = n.tokenizer[a], l = i[a];
						i[a] = (...p) => {
							let c = o.apply(i, p);
							return c === !1 && (c = l.apply(i, p)), c;
						};
					}
					r.tokenizer = i;
				}
				if (n.hooks) {
					let i = this.defaults.hooks || new P();
					for (let s in n.hooks) {
						if (!(s in i)) throw new Error(`hook '${s}' does not exist`);
						if (["options", "block"].includes(s)) continue;
						let a = s, o = n.hooks[a], l = i[a];
						P.passThroughHooks.has(s) ? i[a] = (p) => {
							if (this.defaults.async && P.passThroughHooksRespectAsync.has(s)) return (async () => {
								let d = await o.call(i, p);
								return l.call(i, d);
							})();
							let c = o.call(i, p);
							return l.call(i, c);
						} : i[a] = (...p) => {
							if (this.defaults.async) return (async () => {
								let d = await o.apply(i, p);
								return d === !1 && (d = await l.apply(i, p)), d;
							})();
							let c = o.apply(i, p);
							return c === !1 && (c = l.apply(i, p)), c;
						};
					}
					r.hooks = i;
				}
				if (n.walkTokens) {
					let i = this.defaults.walkTokens, s = n.walkTokens;
					r.walkTokens = function(a) {
						let o = [];
						return o.push(s.call(this, a)), i && (o = o.concat(i.call(this, a))), o;
					};
				}
				this.defaults = {
					...this.defaults,
					...r
				};
			}), this;
		}
		setOptions(e) {
			return this.defaults = {
				...this.defaults,
				...e
			}, this;
		}
		lexer(e, t) {
			return x.lex(e, t ?? this.defaults);
		}
		parser(e, t) {
			return b.parse(e, t ?? this.defaults);
		}
		parseMarkdown(e) {
			return (n, r) => {
				let i = { ...r }, s = {
					...this.defaults,
					...i
				}, a = this.onError(!!s.silent, !!s.async);
				if (this.defaults.async === !0 && i.async === !1) return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
				if (typeof n > "u" || n === null) return a(new Error("marked(): input parameter is undefined or null"));
				if (typeof n != "string") return a(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
				if (s.hooks && (s.hooks.options = s, s.hooks.block = e), s.async) return (async () => {
					let o = s.hooks ? await s.hooks.preprocess(n) : n, p = await (s.hooks ? await s.hooks.provideLexer() : e ? x.lex : x.lexInline)(o, s), c = s.hooks ? await s.hooks.processAllTokens(p) : p;
					s.walkTokens && await Promise.all(this.walkTokens(c, s.walkTokens));
					let h = await (s.hooks ? await s.hooks.provideParser() : e ? b.parse : b.parseInline)(c, s);
					return s.hooks ? await s.hooks.postprocess(h) : h;
				})().catch(a);
				try {
					s.hooks && (n = s.hooks.preprocess(n));
					let l = (s.hooks ? s.hooks.provideLexer() : e ? x.lex : x.lexInline)(n, s);
					s.hooks && (l = s.hooks.processAllTokens(l)), s.walkTokens && this.walkTokens(l, s.walkTokens);
					let c = (s.hooks ? s.hooks.provideParser() : e ? b.parse : b.parseInline)(l, s);
					return s.hooks && (c = s.hooks.postprocess(c)), c;
				} catch (o) {
					return a(o);
				}
			};
		}
		onError(e, t) {
			return (n) => {
				if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
					let r = "<p>An error occurred:</p><pre>" + O(n.message + "", !0) + "</pre>";
					return t ? Promise.resolve(r) : r;
				}
				if (t) return Promise.reject(n);
				throw n;
			};
		}
	};
	var L = new B();
	function g(u, e) {
		return L.parse(u, e);
	}
	g.options = g.setOptions = function(u) {
		return L.setOptions(u), g.defaults = L.defaults, G(g.defaults), g;
	};
	g.getDefaults = M;
	g.defaults = T;
	g.use = function(...u) {
		return L.use(...u), g.defaults = L.defaults, G(g.defaults), g;
	};
	g.walkTokens = function(u, e) {
		return L.walkTokens(u, e);
	};
	g.parseInline = L.parseInline;
	g.Parser = b;
	g.parser = b.parse;
	g.Renderer = y;
	g.TextRenderer = $;
	g.Lexer = x;
	g.lexer = x.lex;
	g.Tokenizer = w;
	g.Hooks = P;
	g.parse = g;
	var Ut = g.options, Kt = g.setOptions, Wt = g.use, Xt = g.walkTokens, Jt = g.parseInline, Vt = g, Yt = b.parse, en = x.lex;

//#endregion
//#region src/services/chat-history/shared.js
	const INDEX_KEY = "aifengyue_chat_index_v1";
	const RAW_HTML_BLOCK_TAGS = new Set([
		"article",
		"aside",
		"blockquote",
		"button",
		"details",
		"div",
		"figure",
		"figcaption",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"img",
		"li",
		"ol",
		"p",
		"pre",
		"section",
		"summary",
		"table",
		"tbody",
		"td",
		"tfoot",
		"th",
		"thead",
		"tr",
		"ul"
	]);
	const VOID_HTML_TAGS = new Set([
		"area",
		"base",
		"br",
		"col",
		"embed",
		"hr",
		"img",
		"input",
		"link",
		"meta",
		"param",
		"source",
		"track",
		"wbr"
	]);
	const SAFE_INLINE_HTML_TAGS = new Set([
		"b",
		"br",
		"code",
		"del",
		"em",
		"font",
		"i",
		"kbd",
		"mark",
		"s",
		"small",
		"span",
		"strong",
		"sub",
		"sup",
		"u"
	]);
	const BLOCKED_RENDER_TAGS = new Set([
		"base",
		"embed",
		"form",
		"iframe",
		"input",
		"link",
		"meta",
		"object",
		"script",
		"style",
		"textarea"
	]);
	const MARKDOWN_CODE_COPY_ICON_CLASS = "style_copyIcon__euyNI";
	const MARKDOWN_CODE_COPIED_CLASS = "style_copied__SbkhO";
	let markdownCodeBlockSerial = 0;
	function normalizeId(value) {
		return typeof value === "string" ? value.trim() : "";
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
		if (typeof value === "string") return decodeEscapedText$1(value);
		return String(value);
	}
	function looksLikeHtml(value) {
		return /<\/?[a-z][\s\S]*>/i.test(value);
	}
	function sanitizeUrlLikeAttr(value) {
		const normalized = String(value || "").trim();
		if (!normalized) return "";
		if (/^(?:javascript|vbscript|data:text\/html)/i.test(normalized)) {
			return "";
		}
		return normalized;
	}
	function sanitizeRenderedMarkdownHtml(html) {
		const source = String(html || "");
		if (!source.trim()) return "";
		if (typeof DOMParser !== "function") {
			return source.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|textarea)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "").replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|textarea)\b[^>]*\/?\s*>/gi, "").replace(/\s+on[a-z-]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "").replace(/\s+(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, "");
		}
		const parser = new DOMParser();
		const doc = parser.parseFromString(`<body>${source}</body>`, "text/html");
		const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
		const nodes = [];
		let current = walker.nextNode();
		while (current) {
			nodes.push(current);
			current = walker.nextNode();
		}
		for (const node of nodes) {
			const tagName = String(node.tagName || "").toLowerCase();
			if (!tagName) continue;
			if (BLOCKED_RENDER_TAGS.has(tagName)) {
				node.remove();
				continue;
			}
			for (const attr of [...node.attributes]) {
				const attrName = String(attr.name || "").toLowerCase();
				if (!attrName) continue;
				if (attrName.startsWith("on")) {
					node.removeAttribute(attr.name);
					continue;
				}
				if (attrName === "href" || attrName === "src" || attrName === "xlink:href") {
					const sanitized = sanitizeUrlLikeAttr(attr.value);
					if (!sanitized) {
						node.removeAttribute(attr.name);
					} else {
						node.setAttribute(attr.name, sanitized);
					}
				}
			}
		}
		return doc.body.innerHTML;
	}
	function isSafeCssColor(value) {
		const normalized = String(value || "").trim();
		if (!normalized) return false;
		return /^(?:[a-z]+|#[0-9a-f]{3,8}|rgba?\([0-9\s,%.]+\)|hsla?\([0-9\s,%.]+\))$/i.test(normalized);
	}
	function isSafeFontSize(value) {
		const normalized = String(value || "").trim();
		if (!normalized) return false;
		return /^(?:[1-7]|[+-][1-7]|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i.test(normalized);
	}
	function isSafeFontFace(value) {
		const normalized = String(value || "").trim();
		if (!normalized) return false;
		return /^[\w\s,\-"']{1,80}$/i.test(normalized);
	}
	function sanitizeInlineHtmlTag(rawTag) {
		const source = String(rawTag || "");
		const matched = source.match(/^<\s*(\/?)\s*([a-z][\w-]*)\b([^>]*)>\s*$/i);
		if (!matched) return "";
		const isClosing = matched[1] === "/";
		const tagName = String(matched[2] || "").toLowerCase();
		const rawAttrs = String(matched[3] || "");
		const isSelfClosing = /\/\s*$/.test(rawAttrs) || VOID_HTML_TAGS.has(tagName);
		if (!SAFE_INLINE_HTML_TAGS.has(tagName)) return "";
		if (isClosing) {
			return `</${tagName}>`;
		}
		const attrs = [];
		if (tagName === "font") {
			const colorMatched = rawAttrs.match(/\bcolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
			const sizeMatched = rawAttrs.match(/\bsize\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
			const faceMatched = rawAttrs.match(/\bface\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
			const colorValue = colorMatched?.[2] ?? colorMatched?.[3] ?? colorMatched?.[4] ?? "";
			const sizeValue = sizeMatched?.[2] ?? sizeMatched?.[3] ?? sizeMatched?.[4] ?? "";
			const faceValue = faceMatched?.[2] ?? faceMatched?.[3] ?? faceMatched?.[4] ?? "";
			if (isSafeCssColor(colorValue)) {
				attrs.push(` color="${escapeHtml(colorValue.trim())}"`);
			}
			if (isSafeFontSize(sizeValue)) {
				attrs.push(` size="${escapeHtml(sizeValue.trim())}"`);
			}
			if (isSafeFontFace(faceValue)) {
				attrs.push(` face="${escapeHtml(faceValue.trim())}"`);
			}
		}
		return `<${tagName}${attrs.join("")}${isSelfClosing ? " /" : ""}>`;
	}
	function preserveSafeInlineHtml(text) {
		const htmlTokens = [];
		const value = String(text ?? "").replace(/<\/?[a-z][^>\n]*>/gi, (rawTag) => {
			const sanitized = sanitizeInlineHtmlTag(rawTag);
			if (!sanitized) return rawTag;
			const placeholder = `@@AFHTML${htmlTokens.length}@@`;
			htmlTokens.push(sanitized);
			return placeholder;
		});
		return {
			value,
			htmlTokens
		};
	}
	function renderInlineMarkdown(text) {
		const codeTokens = [];
		let value = String(text ?? "").replace(/(`+)([\s\S]*?)\1/g, (_, __, content) => {
			const placeholder = `__AF_CODE_${codeTokens.length}__`;
			codeTokens.push(`<code>${escapeHtml(content)}</code>`);
			return placeholder;
		});
		const preservedInlineHtml = preserveSafeInlineHtml(value);
		value = preservedInlineHtml.value;
		value = escapeHtml(value);
		value = value.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, alt, url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label, url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>").replace(/~~([^~]+)~~/g, "<del>$1</del>").replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>").replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
		for (let i = 0; i < codeTokens.length; i++) {
			value = value.replace(`__AF_CODE_${i}__`, codeTokens[i]);
		}
		for (let i = 0; i < preservedInlineHtml.htmlTokens.length; i++) {
			value = value.replace(`@@AFHTML${i}@@`, preservedInlineHtml.htmlTokens[i]);
		}
		return value;
	}
	function isRawHtmlBlockStart(line) {
		const trimmed = String(line || "").trim();
		if (!trimmed.startsWith("<")) return false;
		if (/^<!--/.test(trimmed)) return true;
		const matched = trimmed.match(/^<\/?([a-z][\w-]*)\b/i);
		if (!matched?.[1]) return false;
		return RAW_HTML_BLOCK_TAGS.has(matched[1].toLowerCase());
	}
	function updateHtmlTagStack(stack, line) {
		const tagMatcher = /<\/?([a-z][\w-]*)\b[^>]*>/gi;
		let matched = tagMatcher.exec(String(line || ""));
		while (matched) {
			const rawTag = matched[0];
			const tagName = String(matched[1] || "").toLowerCase();
			if (!tagName || VOID_HTML_TAGS.has(tagName) || /^<!--/.test(rawTag) || rawTag.endsWith("/>")) {
				matched = tagMatcher.exec(String(line || ""));
				continue;
			}
			if (rawTag.startsWith("</")) {
				for (let i = stack.length - 1; i >= 0; i--) {
					if (stack[i] !== tagName) continue;
					stack.length = i;
					break;
				}
			} else {
				stack.push(tagName);
			}
			matched = tagMatcher.exec(String(line || ""));
		}
	}
	function collectRawHtmlBlock(lines, startIndex) {
		const collected = [];
		const stack = [];
		let index = startIndex;
		while (index < lines.length) {
			const line = String(lines[index] ?? "");
			collected.push(line);
			if (!/^<!--/.test(line.trim())) {
				updateHtmlTagStack(stack, line);
			}
			index += 1;
			if (stack.length === 0) {
				break;
			}
		}
		return {
			html: collected.join("\n").trim(),
			nextIndex: index
		};
	}
	function isMarkdownBlockStart(line) {
		const trimmed = String(line || "").trim();
		if (!trimmed) return false;
		if (/^(```+|~~~+)/.test(trimmed)) return true;
		if (/^#{1,6}\s+/.test(trimmed)) return true;
		if (/^\s*>\s?/.test(trimmed)) return true;
		if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed)) return true;
		if (looksLikeMarkdownTableStart(trimmed)) return true;
		if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) return true;
		return isRawHtmlBlockStart(trimmed);
	}
	function splitMarkdownTableRow(line) {
		const source = String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "");
		const cells = [];
		let current = "";
		let escaped = false;
		for (let i = 0; i < source.length; i++) {
			const char = source[i];
			if (escaped) {
				current += char;
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				current += char;
				continue;
			}
			if (char === "|") {
				cells.push(current.trim());
				current = "";
				continue;
			}
			current += char;
		}
		cells.push(current.trim());
		return cells;
	}
	function parseMarkdownTableAlignments(line) {
		const cells = splitMarkdownTableRow(line);
		if (!cells.length) return null;
		const alignments = [];
		for (const cell of cells) {
			const normalized = cell.replace(/\s+/g, "");
			if (!/^:?-{3,}:?$/.test(normalized)) {
				return null;
			}
			if (normalized.startsWith(":") && normalized.endsWith(":")) {
				alignments.push("center");
			} else if (normalized.endsWith(":")) {
				alignments.push("right");
			} else {
				alignments.push("left");
			}
		}
		return alignments;
	}
	function looksLikeMarkdownTableStart(line, nextLine = "") {
		const headerCells = splitMarkdownTableRow(line);
		if (headerCells.length < 2) return false;
		return Array.isArray(parseMarkdownTableAlignments(nextLine));
	}
	function collectMarkdownTable(lines, startIndex) {
		const headerLine = String(lines[startIndex] ?? "");
		const alignLine = String(lines[startIndex + 1] ?? "");
		const alignments = parseMarkdownTableAlignments(alignLine);
		if (!alignments) {
			return null;
		}
		const headerCells = splitMarkdownTableRow(headerLine);
		if (headerCells.length < 2 || headerCells.length !== alignments.length) {
			return null;
		}
		const rows = [];
		let index = startIndex + 2;
		while (index < lines.length) {
			const currentLine = String(lines[index] ?? "");
			const trimmed = currentLine.trim();
			if (!trimmed) break;
			if (!trimmed.includes("|")) break;
			const cells = splitMarkdownTableRow(currentLine);
			if (cells.length !== headerCells.length) break;
			rows.push(cells);
			index += 1;
		}
		const renderCells = (cells, cellTag) => `
        <tr>${cells.map((cell, cellIndex) => {
			const align = alignments[cellIndex] || "left";
			return `<${cellTag} data-align="${align}">${renderInlineMarkdown(cell)}</${cellTag}>`;
		}).join("")}</tr>
    `;
		const bodyHtml = rows.length ? `<tbody>${rows.map((cells) => renderCells(cells, "td")).join("")}</tbody>` : "";
		return {
			html: `<table><thead>${renderCells(headerCells, "th")}</thead>${bodyHtml}</table>`,
			nextIndex: index
		};
	}
	function collectMarkdownList(lines, startIndex, ordered) {
		const matcher = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
		const tagName = ordered ? "ol" : "ul";
		const items = [];
		let index = startIndex;
		while (index < lines.length) {
			const currentLine = String(lines[index] ?? "");
			if (!currentLine.trim()) break;
			const matched = currentLine.match(matcher);
			if (matched) {
				items.push([matched[1]]);
				index += 1;
				continue;
			}
			if (!items.length || isMarkdownBlockStart(currentLine) || !/^\s{2,}\S/.test(currentLine)) {
				break;
			}
			items[items.length - 1].push(currentLine.trim());
			index += 1;
		}
		return {
			html: `<${tagName}>${items.map((itemLines) => `<li>${itemLines.map(renderInlineMarkdown).join("<br>")}</li>`).join("")}</${tagName}>`,
			nextIndex: index
		};
	}
	function collectMarkdownBlockquote(lines, startIndex) {
		const quoteLines = [];
		let index = startIndex;
		while (index < lines.length) {
			const currentLine = String(lines[index] ?? "");
			if (!currentLine.trim()) {
				quoteLines.push("");
				index += 1;
				continue;
			}
			const matched = currentLine.match(/^\s*>\s?(.*)$/);
			if (!matched) break;
			quoteLines.push(matched[1]);
			index += 1;
		}
		return {
			html: `<blockquote>${renderMarkdownHtml(quoteLines.join("\n"))}</blockquote>`,
			nextIndex: index
		};
	}
	function pickCodeLanguageToken(value) {
		const source = String(value || "").trim();
		if (!source) return "";
		return source.split(/\s+/)[0]?.trim() || "";
	}
	function normalizeCodeLanguage(value) {
		return pickCodeLanguageToken(value).replace(/^[`'"]+|[`'"]+$/g, "").replace(/[^\w#+.-]/g, "").toLowerCase();
	}
	function getCodeLanguageLabel(rawLanguage, normalizedLanguage) {
		const displayValue = pickCodeLanguageToken(rawLanguage).replace(/[^\w#+.-]/g, "");
		if (displayValue) return displayValue;
		return normalizedLanguage ? normalizedLanguage.toUpperCase() : "";
	}
	function renderMarkdownCodeBlock(token) {
		const text = typeof token?.text === "string" ? token.text.replace(/\n$/, "") : "";
		const language = normalizeCodeLanguage(token?.lang);
		const codeId = `af-code-content-${++markdownCodeBlockSerial}`;
		const escapedCode = escapeHtml(text);
		if (!language) {
			return `<pre><code node id="${codeId}" class="hljs">${escapedCode}</code></pre>`;
		}
		const languageLabel = getCodeLanguageLabel(token?.lang, language);
		const tooltipId = `copy-tooltip-${markdownCodeBlockSerial}`;
		return [
			"<pre>",
			"<div class=\"af-code-block\">",
			"<div class=\"border-b flex justify-between items-center af-code-block-header\" data-af-copy-ignore=\"true\">",
			`<div class="af-code-block-language">${escapeHtml(languageLabel)}</div>`,
			`<div data-tooltip-id="${tooltipId}" class="af-code-copy-trigger" data-af-copy-target="#${codeId}" data-af-copy-mode="icon" data-af-copy-copied-class="${MARKDOWN_CODE_COPIED_CLASS}" role="button" tabindex="0" title="复制代码" aria-label="复制代码">`,
			`<div class="af-code-copy-icon ${MARKDOWN_CODE_COPY_ICON_CLASS}"></div>`,
			"</div>",
			"</div>",
			"<div node class=\"af-code-block-body\">",
			`<code node id="${codeId}" class="hljs language-${escapeHtml(language)}">${escapedCode}</code>`,
			"</div>",
			"</div>",
			"</pre>"
		].join("");
	}
	function renderMarkdownHtml(text) {
		const normalized = normalizeLineBreakTokens(text);
		const renderer = new g.Renderer();
		renderer.code = (token) => renderMarkdownCodeBlock(token);
		const rendered = g.parse(normalized, {
			async: false,
			breaks: true,
			gfm: true,
			renderer
		});
		return sanitizeRenderedMarkdownHtml(rendered);
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
	function renderMessageBody(text, emptyPlaceholder = "(空)", options = {}) {
		const { preferMarkdown = false } = options || {};
		const normalized = asDisplayContent(text);
		if (!normalized) {
			return `<pre class="af-plain" style="white-space: pre-wrap !important;">${escapeHtml(emptyPlaceholder)}</pre>`;
		}
		if (preferMarkdown) {
			return `<div class="markdown-body af-markdown-body">${renderMarkdownHtml(normalized)}</div>`;
		}
		if (looksLikeHtml(normalized)) {
			const normalizedHtml = sanitizeRenderedMarkdownHtml(normalizeLineBreakTokens(normalized));
			return `<div class="markdown-body af-markdown-body">${normalizedHtml}</div>`;
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
		return hasMeaningfulText$1(asDisplayContent(value));
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
//#region src/services/chat-history/index-store.js
	const chatHistoryIndexMethods = {
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
		}
	};

//#endregion
//#region src/services/chat-history/chain-service.js
	const chatHistoryChainMethods = {
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
		}
	};

//#endregion
//#region src/services/chat-history/bundle-service.js
	const chatHistoryBundleMethods = {
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
		}
	};

//#endregion
//#region src/services/chat-history/preview-host-css.js
	const PREVIEW_HOST_CSS = "/* af-style-snapshot_dearestie.xyz_20260305\n  _171033 */\n/* page: https://dearestie.xyz/zh/explore/installed/4ee3de85-5fe8-46b8-b672-35804012a058 */\n/* time: 2026-03-05T09:10:33.387Z */\n\n/* ===== INLINE STYLE #1 id=mmdjsipj.tee attrs=-\n  ===== */\n/* ============================\n       Light 主题 (默认)\n       ============================ */\n    #aifengyue-sidebar {\n        --af-bg:          #ffffff;\n        --af-bg-soft:     #f0f2f7;\n        --af-bg-card:     #e4e8f0;\n        --af-border:      #c0c7d4;\n        --af-text:        #1a1f2e;\n        --af-text-soft:   #3d4a5c;\n        --af-muted:       #6b7a8d;\n        --af-primary:     #6366f1;\n        --af-primary-hover: #4f46e5;\n        --af-primary-text: #ffffff;\n        --af-primary-glow: rgba(99, 102, 241, 0.25);\n        --af-accent:      #0ea5e9;\n        --af-accent-glow: rgba(14, 165, 233, 0.2);\n        --af-input-bg:    #edf0f5;\n        --af-input-border: #b5bcc9;\n        --af-btn2-bg:     #dde2ed;\n        --af-btn2-hover:  #cdd4e2;\n        --af-btn2-border: #b5bcc9;\n        --af-shadow:      rgba(30, 37, 51, 0.1);\n        --af-shadow-lg:   rgba(30, 37, 51, 0.15);\n        --af-header-bg:   linear-gradient(135deg, #f4f6fa 0%, #e8ecf5 100%);\n        --af-footer-bg:   #eef0f5;\n        --af-track-bg:    #d5dae5;\n        --af-bar-gradient: linear-gradient(90deg, #6366f1, #0ea5e9);\n        --af-success:     #10b981;\n        --af-warning:     #f59e0b;\n        --af-error:       #ef4444;\n        --af-idle:        #94a3b8;\n        --af-toggle-bg:   linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);\n        --af-toggle-shadow: rgba(99, 102, 241, 0.3);\n        --af-code-color:  #4f46e5;\n        --af-hint-bg:     #eaecf5;\n        --af-hint-border: #c0c7d4;\n        --af-radius:      12px;\n        --af-radius-sm:   8px;\n        --af-ease:        cubic-bezier(0.4, 0, 0.2, 1);\n        --af-font:        'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;\n    }\n\n    /* ============================\n       Dark 主题\n       ============================ */\n    #aifengyue-sidebar[data-theme=\"dark\"] {\n        --af-bg:          #13151e;\n        --af-bg-soft:     #1a1d2b;\n        --af-bg-card:     #212435;\n        --af-border:      #2d3150;\n        --af-text:        #e4e7f0;\n        --af-text-soft:   #b0b7c8;\n        --af-muted:       #6b7590;\n        --af-primary:     #818cf8;\n        --af-primary-hover: #6366f1;\n        --af-primary-text: #ffffff;\n        --af-primary-glow: rgba(129, 140, 248, 0.25);\n        --af-accent:      #38bdf8;\n        --af-accent-glow: rgba(56, 189, 248, 0.2);\n        --af-input-bg:    #1a1d2e;\n        --af-input-border: #3d4268;\n        --af-btn2-bg:     #2a2e45;\n        --af-btn2-hover:  #353a55;\n        --af-btn2-border: #4a5080;\n        --af-shadow:      rgba(0, 0, 0, 0.2);\n        --af-shadow-lg:   rgba(0, 0, 0, 0.35);\n        --af-header-bg:   linear-gradient(135deg, #1a1d2b 0%, #13151e 100%);\n        --af-footer-bg:   #111320;\n        --af-track-bg:    #1e2133;\n        --af-bar-gradient: linear-gradient(90deg, #818cf8, #38bdf8);\n        --af-success:     #34d399;\n        --af-warning:     #fbbf24;\n        --af-error:       #f87171;\n        --af-idle:        #4b5568;\n        --af-toggle-bg:   linear-gradient(135deg, #818cf8 0%, #6366f1 100%);\n        --af-toggle-shadow: rgba(129, 140, 248, 0.3);\n        --af-code-color:  #818cf8;\n        --af-hint-bg:     #1a1d2b;\n        --af-hint-border: #2d3150;\n    }\n\n    /* ============================\n       Global / Layout\n       ============================ */\n    body.aifengyue-sidebar-inline-mode {\n        padding-right: 372px !important;\n        box-sizing: border-box;\n        transition: padding-right 0.3s var(--af-ease, ease);\n    }\n    body.aifengyue-sidebar-inline-mode #header-setting-button {\n        margin-right: 70px !important;\n    }\n\n    /* --- Toggle 按钮 --- */\n    #aifengyue-sidebar-toggle {\n        position: fixed;\n        right: 0;\n        top: 50%;\n        transform: translateY(-50%);\n        width: 38px;\n        height: 100px;\n        border: none;\n        border-radius: 10px 0 0 10px;\n        background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);\n        color: #fff;\n        cursor: pointer;\n        z-index: 2147483645;\n        writing-mode: vertical-rl;\n        font-size: 13px;\n        font-weight: 700;\n        font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;\n        letter-spacing: 2px;\n        box-shadow: -3px 0 20px rgba(99, 102, 241, 0.35);\n        transition: right 0.25s ease, width 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;\n    }\n    #aifengyue-sidebar-toggle:hover {\n        width: 46px;\n        box-shadow: -4px 0 28px rgba(99, 102, 241, 0.5);\n    }\n    #aifengyue-sidebar-toggle.is-open {\n        right: 372px;\n        background: linear-gradient(135deg, #4b5563 0%, #334155 100%);\n        box-shadow: -3px 0 18px rgba(51, 65, 85, 0.45);\n    }\n\n    /* --- 侧边栏容器 --- */\n    #aifengyue-sidebar {\n        position: fixed;\n        top: 0;\n        right: -392px;\n        width: 372px;\n        height: 100vh;\n        background: var(--af-bg);\n        color: var(--af-text);\n        z-index: 2147483646;\n        transition: right 0.3s var(--af-ease);\n        box-shadow: -4px 0 32px var(--af-shadow-lg);\n        font-family: var(--af-font);\n        overflow: hidden;\n        display: flex;\n        flex-direction: column;\n        border-left: 1px solid var(--af-border);\n    }\n    #aifengyue-sidebar.open {\n        right: 0;\n    }\n\n    /* --- 头部 --- */\n    .aifengyue-sidebar-header {\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        padding: 14px 16px;\n        background: var(--af-header-bg);\n        border-bottom: 1px solid var(--af-border);\n        gap: 8px;\n    }\n    .aifengyue-sidebar-header h2 {\n        margin: 0;\n        font-size: 15px;\n        font-weight: 700;\n        color: var(--af-text);\n        flex: 1;\n    }\n\n    /* 主题切换按钮 */\n    .aifengyue-theme-toggle {\n        width: 32px;\n        height: 32px;\n        border: 1px solid var(--af-primary);\n        border-radius: var(--af-radius-sm);\n        background: transparent;\n        color: var(--af-primary);\n        cursor: pointer;\n        font-size: 16px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        transition: all 0.25s var(--af-ease);\n        padding: 0;\n        line-height: 1;\n    }\n    .aifengyue-theme-toggle:hover {\n        background: var(--af-primary);\n        color: #fff;\n        transform: rotate(20deg) scale(1.05);\n        box-shadow: 0 0 12px var(--af-primary-glow);\n    }\n\n    .aifengyue-sidebar-close {\n        width: 32px;\n        height: 32px;\n        border: 1px solid var(--af-border);\n        border-radius: var(--af-radius-sm);\n        background: transparent;\n        color: var(--af-text-soft);\n        cursor: pointer;\n        font-size: 14px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        transition: all 0.25s var(--af-ease);\n        padding: 0;\n        line-height: 1;\n    }\n    .aifengyue-sidebar-close:hover {\n        color: #fff;\n        background: var(--af-error);\n        border-color: var(--af-error);\n    }\n\n    /* --- Tab 导航 --- */\n    .aifengyue-sidebar-tabs {\n        display: grid;\n        grid-template-columns: repeat(4, 1fr);\n        gap: 4px;\n        padding: 8px 12px;\n        border-bottom: 1px solid var(--af-border);\n        background: var(--af-bg);\n    }\n    .aifengyue-tab-btn {\n        position: relative;\n        border: none;\n        background: transparent;\n        color: var(--af-muted);\n        border-radius: var(--af-radius-sm);\n        height: 34px;\n        cursor: pointer;\n        font-size: 13px;\n        font-weight: 600;\n        font-family: var(--af-font);\n        transition: all 0.2s var(--af-ease);\n    }\n    .aifengyue-tab-btn:hover {\n        color: var(--af-text-soft);\n        background: var(--af-bg-soft);\n    }\n    .aifengyue-tab-btn.active {\n        color: var(--af-primary);\n        background: var(--af-bg-card);\n    }\n    .aifengyue-tab-btn.active::after {\n        content: '';\n        position: absolute;\n        bottom: 2px;\n        left: 30%;\n        right: 30%;\n        height: 2px;\n        border-radius: 2px;\n        background: var(--af-primary);\n    }\n\n    /* --- 内容区 --- */\n    .aifengyue-sidebar-content {\n        flex: 1;\n        overflow-y: auto;\n        padding: 12px;\n        scrollbar-width: thin;\n        scrollbar-color: var(--af-border) transparent;\n    }\n    .aifengyue-sidebar-content::-webkit-scrollbar {\n        width: 4px;\n    }\n    .aifengyue-sidebar-content::-webkit-scrollbar-track {\n        background: transparent;\n    }\n    .aifengyue-sidebar-content::-webkit-scrollbar-thumb {\n        background: var(--af-border);\n        border-radius: 4px;\n    }\n\n    /* --- 面板动画 --- */\n    .aifengyue-panel {\n        display: none;\n        animation: af-slide-in 0.25s var(--af-ease);\n    }\n    .aifengyue-panel.active {\n        display: block;\n    }\n    @keyframes af-slide-in {\n        from { opacity: 0; transform: translateY(6px); }\n        to   { opacity: 1; transform: translateY(0); }\n    }\n\n    /* --- Section 区块 --- */\n    .aifengyue-section {\n        margin-bottom: 10px;\n        padding: 14px;\n        border: 1px solid var(--af-border);\n        border-radius: var(--af-radius);\n        background: var(--af-bg-soft);\n        transition: border-color 0.2s var(--af-ease);\n    }\n    .aifengyue-section:hover {\n        border-color: color-mix(in srgb, var(--af-primary) 30%, var(--af-border));\n    }\n    .aifengyue-section-title {\n        font-size: 11px;\n        color: var(--af-muted);\n        font-weight: 700;\n        text-transform: uppercase;\n        letter-spacing: 1.5px;\n        margin-bottom: 10px;\n    }\n\n    /* --- 状态卡片 --- */\n    .aifengyue-status-card {\n        border: 1px solid var(--af-border);\n        border-radius: 10px;\n        background: var(--af-bg-card);\n        padding: 12px;\n    }\n    .aifengyue-status-indicator {\n        display: flex;\n        align-items: center;\n        gap: 10px;\n    }\n    .aifengyue-status-dot {\n        width: 9px;\n        height: 9px;\n        border-radius: 50%;\n        flex-shrink: 0;\n    }\n    .aifengyue-status-dot.idle {\n        background: var(--af-idle);\n    }\n    .aifengyue-status-dot.generating {\n        background: var(--af-warning);\n        animation: af-pulse 1.6s ease-in-out infinite;\n        box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);\n    }\n    .aifengyue-status-dot.polling {\n        background: var(--af-accent);\n        animation: af-pulse 1.6s ease-in-out infinite;\n        box-shadow: 0 0 8px var(--af-accent-glow);\n    }\n    .aifengyue-status-dot.success {\n        background: var(--af-success);\n        box-shadow: 0 0 8px rgba(16, 185, 129, 0.35);\n    }\n    .aifengyue-status-dot.error {\n        background: var(--af-error);\n        box-shadow: 0 0 8px rgba(239, 68, 68, 0.35);\n    }\n    @keyframes af-pulse {\n        0%, 100% { opacity: 1; transform: scale(1); }\n        50%      { opacity: 0.4; transform: scale(1.3); }\n    }\n    .aifengyue-status-text {\n        font-size: 13px;\n        color: var(--af-text);\n        font-weight: 600;\n    }\n    .aifengyue-status-message {\n        margin-top: 10px;\n        border-radius: var(--af-radius-sm);\n        padding: 8px 10px;\n        background: var(--af-input-bg);\n        border: 1px solid var(--af-border);\n        color: var(--af-muted);\n        font-size: 12px;\n        line-height: 1.6;\n        word-break: break-word;\n        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;\n    }\n\n    /* --- 信息行 --- */\n    .aifengyue-info-row {\n        display: flex;\n        align-items: center;\n        gap: 8px;\n        padding: 8px 0;\n        border-bottom: 1px solid var(--af-border);\n    }\n    .aifengyue-info-row:last-child {\n        border-bottom: none;\n        padding-bottom: 0;\n    }\n    .aifengyue-info-row:first-child {\n        padding-top: 0;\n    }\n    .aifengyue-info-label {\n        min-width: 52px;\n        font-size: 12px;\n        color: var(--af-muted);\n        font-weight: 500;\n    }\n    .aifengyue-info-value {\n        flex: 1;\n        min-width: 0;\n        font-size: 12px;\n        color: var(--af-text);\n        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;\n        overflow: hidden;\n        text-overflow: ellipsis;\n        white-space: nowrap;\n    }\n    .aifengyue-info-value.code {\n        color: var(--af-code-color);\n        font-weight: 700;\n    }\n    .aifengyue-copy-btn {\n        border: 1px solid var(--af-border);\n        background: var(--af-bg);\n        color: var(--af-muted);\n        border-radius: 6px;\n        height: 24px;\n        padding: 0 10px;\n        cursor: pointer;\n        font-size: 11px;\n        font-family: var(--af-font);\n        font-weight: 500;\n        transition: all 0.2s var(--af-ease);\n    }\n    .aifengyue-copy-btn:hover {\n        color: var(--af-primary);\n        border-color: var(--af-primary);\n    }\n    .aifengyue-copy-btn:active {\n        transform: scale(0.95);\n    }\n\n    /* --- 表单 --- */\n    .aifengyue-input-group {\n        margin-bottom: 10px;\n    }\n    .aifengyue-input-group label {\n        display: block;\n        margin-bottom: 5px;\n        color: var(--af-text-soft);\n        font-size: 12px;\n        font-weight: 500;\n    }\n    .aifengyue-input-group input,\n    .aifengyue-input-group select,\n    .aifengyue-input-group textarea {\n        width: 100%;\n        box-sizing: border-box;\n        border: 1px solid var(--af-input-border);\n        border-radius: var(--af-radius-sm);\n        padding: 8px 10px;\n        font-size: 13px;\n        font-family: var(--af-font);\n        color: var(--af-text);\n        background: var(--af-input-bg);\n        outline: none;\n        transition: border-color 0.2s, box-shadow 0.2s;\n    }\n    .aifengyue-input-group input,\n    .aifengyue-input-group select {\n        height: 36px;\n        padding: 0 10px;\n    }\n    .aifengyue-input-group textarea {\n        min-height: 96px;\n        max-height: 320px;\n        line-height: 1.5;\n        resize: vertical;\n    }\n    .aifengyue-switch-textarea {\n        min-height: 150px !important;\n        max-height: 420px !important;\n    }\n    .aifengyue-input-group input:focus,\n    .aifengyue-input-group select:focus,\n    .aifengyue-input-group textarea:focus {\n        border-color: var(--af-primary);\n        box-shadow: 0 0 0 3px var(--af-primary-glow);\n    }\n    .aifengyue-input-group input::placeholder {\n        color: var(--af-muted);\n        opacity: 0.6;\n    }\n    .aifengyue-input-group textarea::placeholder {\n        color: var(--af-muted);\n        opacity: 0.6;\n    }\n    .aifengyue-input-group select option {\n        background: var(--af-bg);\n        color: var(--af-text);\n    }\n\n    /* --- 按钮 --- */\n    .aifengyue-btn {\n        width: 100%;\n        height: 36px;\n        border: none;\n        border-radius: var(--af-radius-sm);\n        cursor: pointer;\n        font-size: 13px;\n        font-weight: 600;\n        font-family: var(--af-font);\n        transition: all 0.2s var(--af-ease);\n    }\n    .aifengyue-btn:hover {\n        transform: translateY(-1px);\n    }\n    .aifengyue-btn:active {\n        transform: translateY(0) scale(0.98);\n    }\n    .aifengyue-btn:disabled {\n        opacity: 0.45;\n        cursor: not-allowed;\n        transform: none;\n    }\n    .aifengyue-btn-primary {\n        background: linear-gradient(135deg, var(--af-primary) 0%, var(--af-primary-hover) 100%);\n        color: var(--af-primary-text);\n        box-shadow: 0 2px 12px var(--af-primary-glow);\n    }\n    .aifengyue-btn-primary:hover {\n        box-shadow: 0 4px 20px var(--af-primary-glow);\n    }\n    .aifengyue-btn-secondary {\n        background: var(--af-btn2-bg);\n        color: var(--af-text);\n        border: 1px solid var(--af-btn2-border);\n    }\n    .aifengyue-btn-secondary:hover {\n        background: var(--af-btn2-hover);\n        border-color: color-mix(in srgb, var(--af-primary) 40%, var(--af-btn2-border));\n    }\n    .aifengyue-btn-danger {\n        margin-top: 8px;\n        background: rgba(239, 68, 68, 0.12);\n        color: #991b1b;\n        border: 1px solid rgba(239, 68, 68, 0.4);\n    }\n    .aifengyue-btn-danger:hover {\n        background: rgba(239, 68, 68, 0.18);\n        border-color: rgba(220, 38, 38, 0.56);\n        color: #7f1d1d;\n    }\n    #aifengyue-sidebar[data-theme=\"dark\"] .aifengyue-btn-danger {\n        background: rgba(248, 113, 113, 0.16);\n        color: #fecaca;\n        border-color: rgba(248, 113, 113, 0.45);\n    }\n    #aifengyue-sidebar[data-theme=\"dark\"] .aifengyue-btn-danger:hover {\n        background: rgba(248, 113, 113, 0.24);\n        border-color: rgba(248, 113, 113, 0.7);\n        color: #fee2e2;\n    }\n    .aifengyue-btn-group {\n        display: grid;\n        grid-template-columns: 1fr 1fr;\n        gap: 8px;\n        margin-top: 8px;\n    }\n\n    /* --- 提示 --- */\n    .aifengyue-hint {\n        margin-top: 8px;\n        font-size: 12px;\n        line-height: 1.6;\n        color: var(--af-muted);\n        border: 1px solid var(--af-hint-border);\n        border-radius: 10px;\n        padding: 10px 12px 10px 14px;\n        background: var(--af-hint-bg);\n        border-left: 3px solid var(--af-primary);\n    }\n\n    /* --- 工具面板 --- */\n    .aifengyue-tools-empty {\n        border: 1px dashed var(--af-border);\n        border-radius: var(--af-radius);\n        padding: 20px 14px;\n        text-align: center;\n        color: var(--af-muted);\n        background: var(--af-bg-card);\n        font-size: 13px;\n    }\n    .aifengyue-tool-block {\n        margin-bottom: 10px;\n        padding: 14px;\n        border-radius: var(--af-radius);\n        border: 1px solid var(--af-border);\n        background: var(--af-bg-soft);\n        transition: border-color 0.2s var(--af-ease);\n    }\n    .aifengyue-tool-block:hover {\n        border-color: color-mix(in srgb, var(--af-primary) 30%, var(--af-border));\n    }\n    .aifengyue-check-row {\n        display: flex;\n        align-items: center;\n        gap: 10px;\n        color: var(--af-text);\n        font-size: 13px;\n        margin-bottom: 10px;\n        user-select: none;\n        cursor: pointer;\n    }\n    .aifengyue-check-row input[type=\"checkbox\"] {\n        width: 16px;\n        height: 16px;\n        accent-color: var(--af-primary);\n        cursor: pointer;\n    }\n\n    /* --- 会话面板 --- */\n    .aifengyue-conversation-viewer {\n        width: 100%;\n        min-height: 520px;\n        border: 1px solid var(--af-border);\n        border-radius: 10px;\n        background: #fff;\n    }\n    #aifengyue-conversation-chain:disabled,\n    #aifengyue-conversation-global-chain:disabled,\n    #aifengyue-conversation-refresh:disabled,\n    #aifengyue-conversation-global-refresh:disabled,\n    #aifengyue-conversation-sync:disabled,\n    #aifengyue-conversation-export:disabled,\n    #aifengyue-conversation-import-trigger:disabled,\n    #aifengyue-conversation-open-preview:disabled,\n    #aifengyue-conversation-global-open-preview:disabled,\n    #aifengyue-conversation-global-delete:disabled {\n        opacity: 0.55;\n        cursor: not-allowed;\n    }\n    .aifengyue-conv-latest-card {\n        margin-top: 10px;\n        border: 1px solid var(--af-border);\n        border-radius: 10px;\n        background: var(--af-bg-card);\n        padding: 10px;\n    }\n    .aifengyue-conv-latest-head {\n        font-size: 11px;\n        color: var(--af-muted);\n        margin-bottom: 6px;\n        letter-spacing: 0.4px;\n    }\n    .aifengyue-conv-latest-body {\n        font-size: 12px;\n        line-height: 1.6;\n        color: var(--af-text);\n        border: 1px solid var(--af-border);\n        background: var(--af-input-bg);\n        border-radius: 8px;\n        padding: 8px 10px;\n        word-break: break-word;\n        white-space: pre-wrap;\n    }\n\n    /* --- 会话预览浮层 --- */\n    #aifengyue-conversation-modal {\n        position: fixed;\n        inset: 0;\n        z-index: 2147483647;\n        display: none;\n    }\n    #aifengyue-conversation-modal.open {\n        display: block;\n    }\n    .aifengyue-conv-modal-backdrop {\n        width: 100%;\n        height: 100%;\n        background: rgba(15, 23, 42, 0.56);\n        backdrop-filter: blur(2px);\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        padding: 10px 16px;\n    }\n    .aifengyue-conv-modal-content {\n        width: min(1200px, calc(100vw - 40px));\n        min-width: 700px;\n        height: min(94vh, 1200px);\n        border-radius: 12px;\n        background: #f7f8fb;\n        border: 1px solid rgba(148, 163, 184, 0.4);\n        box-shadow: 0 18px 48px rgba(2, 6, 23, 0.42);\n        display: flex;\n        flex-direction: column;\n        overflow: hidden;\n    }\n    .aifengyue-conv-modal-head {\n        height: 46px;\n        display: flex;\n        align-items: center;\n        justify-content: space-between;\n        padding: 0 12px 0 14px;\n        border-bottom: 1px solid rgba(148, 163, 184, 0.35);\n        background: rgba(255, 255, 255, 0.92);\n        flex-shrink: 0;\n    }\n    .aifengyue-conv-modal-title {\n        font-size: 14px;\n        font-weight: 700;\n        color: #1f2937;\n    }\n    .aifengyue-conv-modal-close {\n        width: 30px;\n        height: 30px;\n        border: 1px solid #d1d5db;\n        border-radius: 8px;\n        background: #fff;\n        color: #374151;\n        cursor: pointer;\n        font-size: 14px;\n        line-height: 1;\n    }\n    .aifengyue-conv-modal-close:hover {\n        border-color: #9ca3af;\n        background: #f9fafb;\n    }\n    #aifengyue-conversation-modal .aifengyue-conversation-viewer {\n        border: none;\n        border-radius: 0;\n        min-height: 0;\n        height: 100%;\n        width: 100%;\n        background: #fff;\n    }\n    @media (max-width: 760px) {\n        .aifengyue-conv-modal-content {\n            min-width: 0;\n            width: calc(100vw - 16px);\n            height: calc(100vh - 16px);\n        }\n        .aifengyue-conv-modal-backdrop {\n            padding: 8px;\n        }\n    }\n\n    /* --- 配额统计 --- */\n    .aifengyue-usage-display {\n        border: 1px solid var(--af-border);\n        border-radius: 10px;\n        background: var(--af-bg-card);\n        padding: 12px;\n    }\n    .aifengyue-usage-head,\n    .aifengyue-usage-foot {\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        font-size: 12px;\n    }\n    .aifengyue-muted {\n        color: var(--af-muted);\n    }\n    .aifengyue-usage-track {\n        margin: 8px 0;\n        height: 6px;\n        border-radius: 999px;\n        background: var(--af-track-bg);\n        overflow: hidden;\n    }\n    #aifengyue-usage-bar {\n        height: 100%;\n        width: 0%;\n        border-radius: 999px;\n        background: var(--af-bar-gradient);\n        transition: width 0.4s var(--af-ease);\n    }\n    #aifengyue-reset-usage {\n        border: none;\n        background: transparent;\n        color: var(--af-accent);\n        cursor: pointer;\n        font-size: 12px;\n        font-family: var(--af-font);\n        padding: 0;\n        transition: color 0.2s;\n    }\n    #aifengyue-reset-usage:hover {\n        color: var(--af-primary);\n        text-decoration: underline;\n    }\n\n    /* --- 脚注 --- */\n    .aifengyue-footer {\n        border-top: 1px solid var(--af-border);\n        background: var(--af-footer-bg);\n        color: var(--af-muted);\n        padding: 10px 14px;\n        text-align: center;\n        font-size: 12px;\n    }\n    .aifengyue-footer a {\n        color: var(--af-primary);\n        text-decoration: none;\n    }\n    .aifengyue-footer a:hover {\n        text-decoration: underline;\n    }\n\n/* ===== INLINE STYLE #2 id=mmdj64hw.2lo attrs=-\n  ===== */\n#aifengyue-chat-status-capsule {\n                position: fixed;\n                right: 20px;\n                bottom: 84px;\n                z-index: 2147483647;\n                display: inline-flex;\n                align-items: center;\n                gap: 8px;\n                padding: 8px 12px;\n                border-radius: 999px;\n                color: #ffffff;\n                font-size: 12px;\n                font-weight: 600;\n                line-height: 1;\n                pointer-events: none;\n                user-select: none;\n                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);\n                transition: transform 0.2s ease, opacity 0.2s ease, background 0.2s ease;\n                backdrop-filter: blur(8px);\n                -webkit-backdrop-filter: blur(8px);\n                opacity: 0.95;\n            }\n            #aifengyue-chat-status-capsule .aifengyue-chat-status-dot {\n                width: 8px;\n                height: 8px;\n                border-radius: 50%;\n                background: currentColor;\n                box-sizing: border-box;\n            }\n            #aifengyue-chat-status-capsule .aifengyue-chat-status-text {\n                max-width: 360px;\n                overflow: hidden;\n                text-overflow: ellipsis;\n                white-space: nowrap;\n            }\n            #aifengyue-chat-status-capsule.is-idle {\n                background: rgba(75, 85, 99, 0.92);\n                color: #d1d5db;\n            }\n            #aifengyue-chat-status-capsule.is-sending {\n                background: rgba(37, 99, 235, 0.95);\n                color: #bfdbfe;\n                transform: translateY(-1px);\n            }\n            #aifengyue-chat-status-capsule.is-waiting {\n                background: rgba(245, 158, 11, 0.95);\n                color: #fef3c7;\n            }\n            #aifengyue-chat-status-capsule.is-sending .aifengyue-chat-status-dot {\n                animation: aifengyue-chat-capsule-pulse 1s ease-in-out infinite;\n                border: 0;\n            }\n            #aifengyue-chat-status-capsule.is-waiting .aifengyue-chat-status-dot {\n                animation: aifengyue-chat-capsule-pulse 1.2s ease-in-out infinite;\n                background: transparent;\n                border: 2px solid currentColor;\n            }\n            #aifengyue-chat-status-capsule.is-done {\n                background: rgba(5, 150, 105, 0.95);\n                color: #bbf7d0;\n            }\n            #aifengyue-chat-status-capsule.is-error {\n                background: rgba(220, 38, 38, 0.95);\n                color: #fecaca;\n            }\n            @keyframes aifengyue-chat-capsule-pulse {\n                0% { transform: scale(1); opacity: 0.8; }\n                50% { transform: scale(1.35); opacity: 1; }\n                100% { transform: scale(1); opacity: 0.8; }\n            }\n\n/* ===== INLINE STYLE #3 id=- attrs=data-styled-jsx=\"\"\n  ===== */\n.icon{width:1em;height:1em;vertical-align:-.15em;fill:currentColor;overflow:hidden}\n\n/* ===== INLINE STYLE #4 id=_goober attrs=-\n  ===== */\n@keyframes go2264125279{from{transform:scale(0) rotate(45deg);opacity:0;}to{transform:scale(1) rotate(45deg);opacity:1;}}@keyframes go3020080000{from{transform:scale(0);opacity:0;}to{transform:scale(1);opacity:1;}}@keyframes go463499852{from{transform:scale(0) rotate(90deg);opacity:0;}to{transform:scale(1) rotate(90deg);opacity:1;}}@keyframes go1268368563{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}@keyframes go1310225428{from{transform:scale(0) rotate(45deg);opacity:0;}to{transform:scale(1) rotate(45deg);opacity:1;}}@keyframes go651618207{0%{height:0;width:0;opacity:0;}40%{height:0;width:6px;opacity:1;}100%{opacity:1;height:10px;}}@keyframes go901347462{from{transform:scale(0.6);opacity:0.4;}to{transform:scale(1);opacity:1;}}.go4109123758{z-index:9999;}.go4109123758 > *{pointer-events:auto;}\n\n/* ===== INLINE STYLE #5 id=- attrs=-\n  ===== */\n[data-sonner-toaster][dir=ltr],html[dir=ltr]{--toast-icon-margin-start:-3px;--toast-icon-margin-end:4px;--toast-svg-margin-start:-1px;--toast-svg-margin-end:0px;--toast-button-margin-start:auto;--toast-button-margin-end:0;--toast-close-button-start:0;--toast-close-button-end:unset;--toast-close-button-transform:translate(-35%, -35%)}[data-sonner-toaster][dir=rtl],html[dir=rtl]{--toast-icon-margin-start:4px;--toast-icon-margin-end:-3px;--toast-svg-margin-start:0px;--toast-svg-margin-end:-1px;--toast-button-margin-start:0;--toast-button-margin-end:auto;--toast-close-button-start:unset;--toast-close-button-end:0;--toast-close-button-transform:translate(35%, -35%)}[data-sonner-toaster]{position:fixed;width:var(--width);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;--gray1:hsl(0, 0%, 99%);--gray2:hsl(0, 0%, 97.3%);--gray3:hsl(0, 0%, 95.1%);--gray4:hsl(0, 0%, 93%);--gray5:hsl(0, 0%, 90.9%);--gray6:hsl(0, 0%, 88.7%);--gray7:hsl(0, 0%, 85.8%);--gray8:hsl(0, 0%, 78%);--gray9:hsl(0, 0%, 56.1%);--gray10:hsl(0, 0%, 52.3%);--gray11:hsl(0, 0%, 43.5%);--gray12:hsl(0, 0%, 9%);--border-radius:8px;box-sizing:border-box;padding:0;margin:0;list-style:none;outline:0;z-index:999999999;transition:transform .4s ease}@media (hover:none) and (pointer:coarse){[data-sonner-toaster][data-lifted=true]{transform:none}}[data-sonner-toaster][data-x-position=right]{right:var(--offset-right)}[data-sonner-toaster][data-x-position=left]{left:var(--offset-left)}[data-sonner-toaster][data-x-position=center]{left:50%;transform:translateX(-50%)}[data-sonner-toaster][data-y-position=top]{top:var(--offset-top)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--offset-bottom)}[data-sonner-toast]{--y:translateY(100%);--lift-amount:calc(var(--lift) * var(--gap));z-index:var(--z-index);position:absolute;opacity:0;transform:var(--y);touch-action:none;transition:transform .4s,opacity .4s,height .4s,box-shadow .2s;box-sizing:border-box;outline:0;overflow-wrap:anywhere}[data-sonner-toast][data-styled=true]{padding:16px;background:var(--normal-bg);border:1px solid var(--normal-border);color:var(--normal-text);border-radius:var(--border-radius);box-shadow:0 4px 12px rgba(0,0,0,.1);width:var(--width);font-size:13px;display:flex;align-items:center;gap:6px}[data-sonner-toast]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-y-position=top]{top:0;--y:translateY(-100%);--lift:1;--lift-amount:calc(1 * var(--gap))}[data-sonner-toast][data-y-position=bottom]{bottom:0;--y:translateY(100%);--lift:-1;--lift-amount:calc(var(--lift) * var(--gap))}[data-sonner-toast][data-styled=true] [data-description]{font-weight:400;line-height:1.4;color:#3f3f3f}[data-rich-colors=true][data-sonner-toast][data-styled=true] [data-description]{color:inherit}[data-sonner-toaster][data-sonner-theme=dark] [data-description]{color:#e8e8e8}[data-sonner-toast][data-styled=true] [data-title]{font-weight:500;line-height:1.5;color:inherit}[data-sonner-toast][data-styled=true] [data-icon]{display:flex;height:16px;width:16px;position:relative;justify-content:flex-start;align-items:center;flex-shrink:0;margin-left:var(--toast-icon-margin-start);margin-right:var(--toast-icon-margin-end)}[data-sonner-toast][data-promise=true] [data-icon]>svg{opacity:0;transform:scale(.8);transform-origin:center;animation:sonner-fade-in .3s ease forwards}[data-sonner-toast][data-styled=true] [data-icon]>*{flex-shrink:0}[data-sonner-toast][data-styled=true] [data-icon] svg{margin-left:var(--toast-svg-margin-start);margin-right:var(--toast-svg-margin-end)}[data-sonner-toast][data-styled=true] [data-content]{display:flex;flex-direction:column;gap:2px}[data-sonner-toast][data-styled=true] [data-button]{border-radius:4px;padding-left:8px;padding-right:8px;height:24px;font-size:12px;color:var(--normal-bg);background:var(--normal-text);margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end);border:none;font-weight:500;cursor:pointer;outline:0;display:flex;align-items:center;flex-shrink:0;transition:opacity .4s,box-shadow .2s}[data-sonner-toast][data-styled=true] [data-button]:focus-visible{box-shadow:0 0 0 2px rgba(0,0,0,.4)}[data-sonner-toast][data-styled=true] [data-button]:first-of-type{margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end)}[data-sonner-toast][data-styled=true] [data-cancel]{color:var(--normal-text);background:rgba(0,0,0,.08)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-styled=true] [data-cancel]{background:rgba(255,255,255,.3)}[data-sonner-toast][data-styled=true] [data-close-button]{position:absolute;left:var(--toast-close-button-start);right:var(--toast-close-button-end);top:0;height:20px;width:20px;display:flex;justify-content:center;align-items:center;padding:0;color:var(--gray12);background:var(--normal-bg);border:1px solid var(--gray4);transform:var(--toast-close-button-transform);border-radius:50%;cursor:pointer;z-index:1;transition:opacity .1s,background .2s,border-color .2s}[data-sonner-toast][data-styled=true] [data-close-button]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-styled=true] [data-disabled=true]{cursor:not-allowed}[data-sonner-toast][data-styled=true]:hover [data-close-button]:hover{background:var(--gray2);border-color:var(--gray5)}[data-sonner-toast][data-swiping=true]::before{content:'';position:absolute;left:-100%;right:-100%;height:100%;z-index:-1}[data-sonner-toast][data-y-position=top][data-swiping=true]::before{bottom:50%;transform:scaleY(3) translateY(50%)}[data-sonner-toast][data-y-position=bottom][data-swiping=true]::before{top:50%;transform:scaleY(3) translateY(-50%)}[data-sonner-toast][data-swiping=false][data-removed=true]::before{content:'';position:absolute;inset:0;transform:scaleY(2)}[data-sonner-toast][data-expanded=true]::after{content:'';position:absolute;left:0;height:calc(var(--gap) + 1px);bottom:100%;width:100%}[data-sonner-toast][data-mounted=true]{--y:translateY(0);opacity:1}[data-sonner-toast][data-expanded=false][data-front=false]{--scale:var(--toasts-before) * 0.05 + 1;--y:translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));height:var(--front-toast-height)}[data-sonner-toast]>*{transition:opacity .4s}[data-sonner-toast][data-x-position=right]{right:0}[data-sonner-toast][data-x-position=left]{left:0}[data-sonner-toast][data-expanded=false][data-front=false][data-styled=true]>*{opacity:0}[data-sonner-toast][data-visible=false]{opacity:0;pointer-events:none}[data-sonner-toast][data-mounted=true][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset)));height:var(--initial-height)}[data-sonner-toast][data-removed=true][data-front=true][data-swipe-out=false]{--y:translateY(calc(var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=false]{--y:translateY(40%);opacity:0;transition:transform .5s,opacity .2s}[data-sonner-toast][data-removed=true][data-front=false]::before{height:calc(var(--initial-height) + 20%)}[data-sonner-toast][data-swiping=true]{transform:var(--y) translateY(var(--swipe-amount-y,0)) translateX(var(--swipe-amount-x,0));transition:none}[data-sonner-toast][data-swiped=true]{user-select:none}[data-sonner-toast][data-swipe-out=true][data-y-position=bottom],[data-sonner-toast][data-swipe-out=true][data-y-position=top]{animation-duration:.2s;animation-timing-function:ease-out;animation-fill-mode:forwards}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=left]{animation-name:swipe-out-left}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=right]{animation-name:swipe-out-right}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=up]{animation-name:swipe-out-up}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=down]{animation-name:swipe-out-down}@keyframes swipe-out-left{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) - 100%));opacity:0}}@keyframes swipe-out-right{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) + 100%));opacity:0}}@keyframes swipe-out-up{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) - 100%));opacity:0}}@keyframes swipe-out-down{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) + 100%));opacity:0}}@media (max-width:600px){[data-sonner-toaster]{position:fixed;right:var(--mobile-offset-right);left:var(--mobile-offset-left);width:100%}[data-sonner-toaster][dir=rtl]{left:calc(var(--mobile-offset-left) * -1)}[data-sonner-toaster] [data-sonner-toast]{left:0;right:0;width:calc(100% - var(--mobile-offset-left) * 2)}[data-sonner-toaster][data-x-position=left]{left:var(--mobile-offset-left)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--mobile-offset-bottom)}[data-sonner-toaster][data-y-position=top]{top:var(--mobile-offset-top)}[data-sonner-toaster][data-x-position=center]{left:var(--mobile-offset-left);right:var(--mobile-offset-right);transform:none}}[data-sonner-toaster][data-sonner-theme=light]{--normal-bg:#fff;--normal-border:var(--gray4);--normal-text:var(--gray12);--success-bg:hsl(143, 85%, 96%);--success-border:hsl(145, 92%, 87%);--success-text:hsl(140, 100%, 27%);--info-bg:hsl(208, 100%, 97%);--info-border:hsl(221, 91%, 93%);--info-text:hsl(210, 92%, 45%);--warning-bg:hsl(49, 100%, 97%);--warning-border:hsl(49, 91%, 84%);--warning-text:hsl(31, 92%, 45%);--error-bg:hsl(359, 100%, 97%);--error-border:hsl(359, 100%, 94%);--error-text:hsl(360, 100%, 45%)}[data-sonner-toaster][data-sonner-theme=light] [data-sonner-toast][data-invert=true]{--normal-bg:#000;--normal-border:hsl(0, 0%, 20%);--normal-text:var(--gray1)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-invert=true]{--normal-bg:#fff;--normal-border:var(--gray3);--normal-text:var(--gray12)}[data-sonner-toaster][data-sonner-theme=dark]{--normal-bg:#000;--normal-bg-hover:hsl(0, 0%, 12%);--normal-border:hsl(0, 0%, 20%);--normal-border-hover:hsl(0, 0%, 25%);--normal-text:var(--gray1);--success-bg:hsl(150, 100%, 6%);--success-border:hsl(147, 100%, 12%);--success-text:hsl(150, 86%, 65%);--info-bg:hsl(215, 100%, 6%);--info-border:hsl(223, 43%, 17%);--info-text:hsl(216, 87%, 65%);--warning-bg:hsl(64, 100%, 6%);--warning-border:hsl(60, 100%, 9%);--warning-text:hsl(46, 87%, 65%);--error-bg:hsl(358, 76%, 10%);--error-border:hsl(357, 89%, 16%);--error-text:hsl(358, 100%, 81%)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]{background:var(--normal-bg);border-color:var(--normal-border);color:var(--normal-text)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]:hover{background:var(--normal-bg-hover);border-color:var(--normal-border-hover)}[data-rich-colors=true][data-sonner-toast][data-type=success]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=success] [data-close-button]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=info]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=info] [data-close-button]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning] [data-close-button]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=error]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}[data-rich-colors=true][data-sonner-toast][data-type=error] [data-close-button]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}.sonner-loading-wrapper{--size:16px;height:var(--size);width:var(--size);position:absolute;inset:0;z-index:10}.sonner-loading-wrapper[data-visible=false]{transform-origin:center;animation:sonner-fade-out .2s ease forwards}.sonner-spinner{position:relative;top:50%;left:50%;height:var(--size);width:var(--size)}.sonner-loading-bar{animation:sonner-spin 1.2s linear infinite;background:var(--gray11);border-radius:6px;height:8%;left:-10%;position:absolute;top:-3.9%;width:24%}.sonner-loading-bar:first-child{animation-delay:-1.2s;transform:rotate(.0001deg) translate(146%)}.sonner-loading-bar:nth-child(2){animation-delay:-1.1s;transform:rotate(30deg) translate(146%)}.sonner-loading-bar:nth-child(3){animation-delay:-1s;transform:rotate(60deg) translate(146%)}.sonner-loading-bar:nth-child(4){animation-delay:-.9s;transform:rotate(90deg) translate(146%)}.sonner-loading-bar:nth-child(5){animation-delay:-.8s;transform:rotate(120deg) translate(146%)}.sonner-loading-bar:nth-child(6){animation-delay:-.7s;transform:rotate(150deg) translate(146%)}.sonner-loading-bar:nth-child(7){animation-delay:-.6s;transform:rotate(180deg) translate(146%)}.sonner-loading-bar:nth-child(8){animation-delay:-.5s;transform:rotate(210deg) translate(146%)}.sonner-loading-bar:nth-child(9){animation-delay:-.4s;transform:rotate(240deg) translate(146%)}.sonner-loading-bar:nth-child(10){animation-delay:-.3s;transform:rotate(270deg) translate(146%)}.sonner-loading-bar:nth-child(11){animation-delay:-.2s;transform:rotate(300deg) translate(146%)}.sonner-loading-bar:nth-child(12){animation-delay:-.1s;transform:rotate(330deg) translate(146%)}@keyframes sonner-fade-in{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}@keyframes sonner-fade-out{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.8)}}@keyframes sonner-spin{0%{opacity:1}100%{opacity:.15}}@media (prefers-reduced-motion){.sonner-loading-bar,[data-sonner-toast],[data-sonner-toast]>*{transition:none!important;animation:none!important}}.sonner-loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);transform-origin:center;transition:opacity .2s,transform .2s}.sonner-loader[data-visible=false]{opacity:0;transform:scale(.8) translate(-50%,-50%)}\n\n/* ===== INLINE STYLE #6 id=- attrs=-\n  ===== */\n[data-sonner-toaster][dir=ltr],html[dir=ltr]{--toast-icon-margin-start:-3px;--toast-icon-margin-end:4px;--toast-svg-margin-start:-1px;--toast-svg-margin-end:0px;--toast-button-margin-start:auto;--toast-button-margin-end:0;--toast-close-button-start:0;--toast-close-button-end:unset;--toast-close-button-transform:translate(-35%, -35%)}[data-sonner-toaster][dir=rtl],html[dir=rtl]{--toast-icon-margin-start:4px;--toast-icon-margin-end:-3px;--toast-svg-margin-start:0px;--toast-svg-margin-end:-1px;--toast-button-margin-start:0;--toast-button-margin-end:auto;--toast-close-button-start:unset;--toast-close-button-end:0;--toast-close-button-transform:translate(35%, -35%)}[data-sonner-toaster]{position:fixed;width:var(--width);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;--gray1:hsl(0, 0%, 99%);--gray2:hsl(0, 0%, 97.3%);--gray3:hsl(0, 0%, 95.1%);--gray4:hsl(0, 0%, 93%);--gray5:hsl(0, 0%, 90.9%);--gray6:hsl(0, 0%, 88.7%);--gray7:hsl(0, 0%, 85.8%);--gray8:hsl(0, 0%, 78%);--gray9:hsl(0, 0%, 56.1%);--gray10:hsl(0, 0%, 52.3%);--gray11:hsl(0, 0%, 43.5%);--gray12:hsl(0, 0%, 9%);--border-radius:8px;box-sizing:border-box;padding:0;margin:0;list-style:none;outline:0;z-index:999999999;transition:transform .4s ease}@media (hover:none) and (pointer:coarse){[data-sonner-toaster][data-lifted=true]{transform:none}}[data-sonner-toaster][data-x-position=right]{right:var(--offset-right)}[data-sonner-toaster][data-x-position=left]{left:var(--offset-left)}[data-sonner-toaster][data-x-position=center]{left:50%;transform:translateX(-50%)}[data-sonner-toaster][data-y-position=top]{top:var(--offset-top)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--offset-bottom)}[data-sonner-toast]{--y:translateY(100%);--lift-amount:calc(var(--lift) * var(--gap));z-index:var(--z-index);position:absolute;opacity:0;transform:var(--y);touch-action:none;transition:transform .4s,opacity .4s,height .4s,box-shadow .2s;box-sizing:border-box;outline:0;overflow-wrap:anywhere}[data-sonner-toast][data-styled=true]{padding:16px;background:var(--normal-bg);border:1px solid var(--normal-border);color:var(--normal-text);border-radius:var(--border-radius);box-shadow:0 4px 12px rgba(0,0,0,.1);width:var(--width);font-size:13px;display:flex;align-items:center;gap:6px}[data-sonner-toast]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-y-position=top]{top:0;--y:translateY(-100%);--lift:1;--lift-amount:calc(1 * var(--gap))}[data-sonner-toast][data-y-position=bottom]{bottom:0;--y:translateY(100%);--lift:-1;--lift-amount:calc(var(--lift) * var(--gap))}[data-sonner-toast][data-styled=true] [data-description]{font-weight:400;line-height:1.4;color:#3f3f3f}[data-rich-colors=true][data-sonner-toast][data-styled=true] [data-description]{color:inherit}[data-sonner-toaster][data-sonner-theme=dark] [data-description]{color:#e8e8e8}[data-sonner-toast][data-styled=true] [data-title]{font-weight:500;line-height:1.5;color:inherit}[data-sonner-toast][data-styled=true] [data-icon]{display:flex;height:16px;width:16px;position:relative;justify-content:flex-start;align-items:center;flex-shrink:0;margin-left:var(--toast-icon-margin-start);margin-right:var(--toast-icon-margin-end)}[data-sonner-toast][data-promise=true] [data-icon]>svg{opacity:0;transform:scale(.8);transform-origin:center;animation:sonner-fade-in .3s ease forwards}[data-sonner-toast][data-styled=true] [data-icon]>*{flex-shrink:0}[data-sonner-toast][data-styled=true] [data-icon] svg{margin-left:var(--toast-svg-margin-start);margin-right:var(--toast-svg-margin-end)}[data-sonner-toast][data-styled=true] [data-content]{display:flex;flex-direction:column;gap:2px}[data-sonner-toast][data-styled=true] [data-button]{border-radius:4px;padding-left:8px;padding-right:8px;height:24px;font-size:12px;color:var(--normal-bg);background:var(--normal-text);margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end);border:none;font-weight:500;cursor:pointer;outline:0;display:flex;align-items:center;flex-shrink:0;transition:opacity .4s,box-shadow .2s}[data-sonner-toast][data-styled=true] [data-button]:focus-visible{box-shadow:0 0 0 2px rgba(0,0,0,.4)}[data-sonner-toast][data-styled=true] [data-button]:first-of-type{margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end)}[data-sonner-toast][data-styled=true] [data-cancel]{color:var(--normal-text);background:rgba(0,0,0,.08)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-styled=true] [data-cancel]{background:rgba(255,255,255,.3)}[data-sonner-toast][data-styled=true] [data-close-button]{position:absolute;left:var(--toast-close-button-start);right:var(--toast-close-button-end);top:0;height:20px;width:20px;display:flex;justify-content:center;align-items:center;padding:0;color:var(--gray12);background:var(--normal-bg);border:1px solid var(--gray4);transform:var(--toast-close-button-transform);border-radius:50%;cursor:pointer;z-index:1;transition:opacity .1s,background .2s,border-color .2s}[data-sonner-toast][data-styled=true] [data-close-button]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-styled=true] [data-disabled=true]{cursor:not-allowed}[data-sonner-toast][data-styled=true]:hover [data-close-button]:hover{background:var(--gray2);border-color:var(--gray5)}[data-sonner-toast][data-swiping=true]::before{content:'';position:absolute;left:-100%;right:-100%;height:100%;z-index:-1}[data-sonner-toast][data-y-position=top][data-swiping=true]::before{bottom:50%;transform:scaleY(3) translateY(50%)}[data-sonner-toast][data-y-position=bottom][data-swiping=true]::before{top:50%;transform:scaleY(3) translateY(-50%)}[data-sonner-toast][data-swiping=false][data-removed=true]::before{content:'';position:absolute;inset:0;transform:scaleY(2)}[data-sonner-toast][data-expanded=true]::after{content:'';position:absolute;left:0;height:calc(var(--gap) + 1px);bottom:100%;width:100%}[data-sonner-toast][data-mounted=true]{--y:translateY(0);opacity:1}[data-sonner-toast][data-expanded=false][data-front=false]{--scale:var(--toasts-before) * 0.05 + 1;--y:translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));height:var(--front-toast-height)}[data-sonner-toast]>*{transition:opacity .4s}[data-sonner-toast][data-x-position=right]{right:0}[data-sonner-toast][data-x-position=left]{left:0}[data-sonner-toast][data-expanded=false][data-front=false][data-styled=true]>*{opacity:0}[data-sonner-toast][data-visible=false]{opacity:0;pointer-events:none}[data-sonner-toast][data-mounted=true][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset)));height:var(--initial-height)}[data-sonner-toast][data-removed=true][data-front=true][data-swipe-out=false]{--y:translateY(calc(var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=false]{--y:translateY(40%);opacity:0;transition:transform .5s,opacity .2s}[data-sonner-toast][data-removed=true][data-front=false]::before{height:calc(var(--initial-height) + 20%)}[data-sonner-toast][data-swiping=true]{transform:var(--y) translateY(var(--swipe-amount-y,0)) translateX(var(--swipe-amount-x,0));transition:none}[data-sonner-toast][data-swiped=true]{user-select:none}[data-sonner-toast][data-swipe-out=true][data-y-position=bottom],[data-sonner-toast][data-swipe-out=true][data-y-position=top]{animation-duration:.2s;animation-timing-function:ease-out;animation-fill-mode:forwards}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=left]{animation-name:swipe-out-left}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=right]{animation-name:swipe-out-right}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=up]{animation-name:swipe-out-up}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=down]{animation-name:swipe-out-down}@keyframes swipe-out-left{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) - 100%));opacity:0}}@keyframes swipe-out-right{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) + 100%));opacity:0}}@keyframes swipe-out-up{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) - 100%));opacity:0}}@keyframes swipe-out-down{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) + 100%));opacity:0}}@media (max-width:600px){[data-sonner-toaster]{position:fixed;right:var(--mobile-offset-right);left:var(--mobile-offset-left);width:100%}[data-sonner-toaster][dir=rtl]{left:calc(var(--mobile-offset-left) * -1)}[data-sonner-toaster] [data-sonner-toast]{left:0;right:0;width:calc(100% - var(--mobile-offset-left) * 2)}[data-sonner-toaster][data-x-position=left]{left:var(--mobile-offset-left)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--mobile-offset-bottom)}[data-sonner-toaster][data-y-position=top]{top:var(--mobile-offset-top)}[data-sonner-toaster][data-x-position=center]{left:var(--mobile-offset-left);right:var(--mobile-offset-right);transform:none}}[data-sonner-toaster][data-sonner-theme=light]{--normal-bg:#fff;--normal-border:var(--gray4);--normal-text:var(--gray12);--success-bg:hsl(143, 85%, 96%);--success-border:hsl(145, 92%, 87%);--success-text:hsl(140, 100%, 27%);--info-bg:hsl(208, 100%, 97%);--info-border:hsl(221, 91%, 93%);--info-text:hsl(210, 92%, 45%);--warning-bg:hsl(49, 100%, 97%);--warning-border:hsl(49, 91%, 84%);--warning-text:hsl(31, 92%, 45%);--error-bg:hsl(359, 100%, 97%);--error-border:hsl(359, 100%, 94%);--error-text:hsl(360, 100%, 45%)}[data-sonner-toaster][data-sonner-theme=light] [data-sonner-toast][data-invert=true]{--normal-bg:#000;--normal-border:hsl(0, 0%, 20%);--normal-text:var(--gray1)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-invert=true]{--normal-bg:#fff;--normal-border:var(--gray3);--normal-text:var(--gray12)}[data-sonner-toaster][data-sonner-theme=dark]{--normal-bg:#000;--normal-bg-hover:hsl(0, 0%, 12%);--normal-border:hsl(0, 0%, 20%);--normal-border-hover:hsl(0, 0%, 25%);--normal-text:var(--gray1);--success-bg:hsl(150, 100%, 6%);--success-border:hsl(147, 100%, 12%);--success-text:hsl(150, 86%, 65%);--info-bg:hsl(215, 100%, 6%);--info-border:hsl(223, 43%, 17%);--info-text:hsl(216, 87%, 65%);--warning-bg:hsl(64, 100%, 6%);--warning-border:hsl(60, 100%, 9%);--warning-text:hsl(46, 87%, 65%);--error-bg:hsl(358, 76%, 10%);--error-border:hsl(357, 89%, 16%);--error-text:hsl(358, 100%, 81%)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]{background:var(--normal-bg);border-color:var(--normal-border);color:var(--normal-text)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]:hover{background:var(--normal-bg-hover);border-color:var(--normal-border-hover)}[data-rich-colors=true][data-sonner-toast][data-type=success]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=success] [data-close-button]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=info]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=info] [data-close-button]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning] [data-close-button]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=error]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}[data-rich-colors=true][data-sonner-toast][data-type=error] [data-close-button]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}.sonner-loading-wrapper{--size:16px;height:var(--size);width:var(--size);position:absolute;inset:0;z-index:10}.sonner-loading-wrapper[data-visible=false]{transform-origin:center;animation:sonner-fade-out .2s ease forwards}.sonner-spinner{position:relative;top:50%;left:50%;height:var(--size);width:var(--size)}.sonner-loading-bar{animation:sonner-spin 1.2s linear infinite;background:var(--gray11);border-radius:6px;height:8%;left:-10%;position:absolute;top:-3.9%;width:24%}.sonner-loading-bar:first-child{animation-delay:-1.2s;transform:rotate(.0001deg) translate(146%)}.sonner-loading-bar:nth-child(2){animation-delay:-1.1s;transform:rotate(30deg) translate(146%)}.sonner-loading-bar:nth-child(3){animation-delay:-1s;transform:rotate(60deg) translate(146%)}.sonner-loading-bar:nth-child(4){animation-delay:-.9s;transform:rotate(90deg) translate(146%)}.sonner-loading-bar:nth-child(5){animation-delay:-.8s;transform:rotate(120deg) translate(146%)}.sonner-loading-bar:nth-child(6){animation-delay:-.7s;transform:rotate(150deg) translate(146%)}.sonner-loading-bar:nth-child(7){animation-delay:-.6s;transform:rotate(180deg) translate(146%)}.sonner-loading-bar:nth-child(8){animation-delay:-.5s;transform:rotate(210deg) translate(146%)}.sonner-loading-bar:nth-child(9){animation-delay:-.4s;transform:rotate(240deg) translate(146%)}.sonner-loading-bar:nth-child(10){animation-delay:-.3s;transform:rotate(270deg) translate(146%)}.sonner-loading-bar:nth-child(11){animation-delay:-.2s;transform:rotate(300deg) translate(146%)}.sonner-loading-bar:nth-child(12){animation-delay:-.1s;transform:rotate(330deg) translate(146%)}@keyframes sonner-fade-in{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}@keyframes sonner-fade-out{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.8)}}@keyframes sonner-spin{0%{opacity:1}100%{opacity:.15}}@media (prefers-reduced-motion){.sonner-loading-bar,[data-sonner-toast],[data-sonner-toast]>*{transition:none!important;animation:none!important}}.sonner-loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);transform-origin:center;transition:opacity .2s,transform .2s}.sonner-loader[data-visible=false]{opacity:0;transform:scale(.8) translate(-50%,-50%)}\n\n/* ===== INLINE STYLE #7 id=- attrs=-\n  ===== */\n[data-sonner-toaster][dir=ltr],html[dir=ltr]{--toast-icon-margin-start:-3px;--toast-icon-margin-end:4px;--toast-svg-margin-start:-1px;--toast-svg-margin-end:0px;--toast-button-margin-start:auto;--toast-button-margin-end:0;--toast-close-button-start:0;--toast-close-button-end:unset;--toast-close-button-transform:translate(-35%, -35%)}[data-sonner-toaster][dir=rtl],html[dir=rtl]{--toast-icon-margin-start:4px;--toast-icon-margin-end:-3px;--toast-svg-margin-start:0px;--toast-svg-margin-end:-1px;--toast-button-margin-start:0;--toast-button-margin-end:auto;--toast-close-button-start:unset;--toast-close-button-end:0;--toast-close-button-transform:translate(35%, -35%)}[data-sonner-toaster]{position:fixed;width:var(--width);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;--gray1:hsl(0, 0%, 99%);--gray2:hsl(0, 0%, 97.3%);--gray3:hsl(0, 0%, 95.1%);--gray4:hsl(0, 0%, 93%);--gray5:hsl(0, 0%, 90.9%);--gray6:hsl(0, 0%, 88.7%);--gray7:hsl(0, 0%, 85.8%);--gray8:hsl(0, 0%, 78%);--gray9:hsl(0, 0%, 56.1%);--gray10:hsl(0, 0%, 52.3%);--gray11:hsl(0, 0%, 43.5%);--gray12:hsl(0, 0%, 9%);--border-radius:8px;box-sizing:border-box;padding:0;margin:0;list-style:none;outline:0;z-index:999999999;transition:transform .4s ease}@media (hover:none) and (pointer:coarse){[data-sonner-toaster][data-lifted=true]{transform:none}}[data-sonner-toaster][data-x-position=right]{right:var(--offset-right)}[data-sonner-toaster][data-x-position=left]{left:var(--offset-left)}[data-sonner-toaster][data-x-position=center]{left:50%;transform:translateX(-50%)}[data-sonner-toaster][data-y-position=top]{top:var(--offset-top)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--offset-bottom)}[data-sonner-toast]{--y:translateY(100%);--lift-amount:calc(var(--lift) * var(--gap));z-index:var(--z-index);position:absolute;opacity:0;transform:var(--y);touch-action:none;transition:transform .4s,opacity .4s,height .4s,box-shadow .2s;box-sizing:border-box;outline:0;overflow-wrap:anywhere}[data-sonner-toast][data-styled=true]{padding:16px;background:var(--normal-bg);border:1px solid var(--normal-border);color:var(--normal-text);border-radius:var(--border-radius);box-shadow:0 4px 12px rgba(0,0,0,.1);width:var(--width);font-size:13px;display:flex;align-items:center;gap:6px}[data-sonner-toast]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-y-position=top]{top:0;--y:translateY(-100%);--lift:1;--lift-amount:calc(1 * var(--gap))}[data-sonner-toast][data-y-position=bottom]{bottom:0;--y:translateY(100%);--lift:-1;--lift-amount:calc(var(--lift) * var(--gap))}[data-sonner-toast][data-styled=true] [data-description]{font-weight:400;line-height:1.4;color:#3f3f3f}[data-rich-colors=true][data-sonner-toast][data-styled=true] [data-description]{color:inherit}[data-sonner-toaster][data-sonner-theme=dark] [data-description]{color:#e8e8e8}[data-sonner-toast][data-styled=true] [data-title]{font-weight:500;line-height:1.5;color:inherit}[data-sonner-toast][data-styled=true] [data-icon]{display:flex;height:16px;width:16px;position:relative;justify-content:flex-start;align-items:center;flex-shrink:0;margin-left:var(--toast-icon-margin-start);margin-right:var(--toast-icon-margin-end)}[data-sonner-toast][data-promise=true] [data-icon]>svg{opacity:0;transform:scale(.8);transform-origin:center;animation:sonner-fade-in .3s ease forwards}[data-sonner-toast][data-styled=true] [data-icon]>*{flex-shrink:0}[data-sonner-toast][data-styled=true] [data-icon] svg{margin-left:var(--toast-svg-margin-start);margin-right:var(--toast-svg-margin-end)}[data-sonner-toast][data-styled=true] [data-content]{display:flex;flex-direction:column;gap:2px}[data-sonner-toast][data-styled=true] [data-button]{border-radius:4px;padding-left:8px;padding-right:8px;height:24px;font-size:12px;color:var(--normal-bg);background:var(--normal-text);margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end);border:none;font-weight:500;cursor:pointer;outline:0;display:flex;align-items:center;flex-shrink:0;transition:opacity .4s,box-shadow .2s}[data-sonner-toast][data-styled=true] [data-button]:focus-visible{box-shadow:0 0 0 2px rgba(0,0,0,.4)}[data-sonner-toast][data-styled=true] [data-button]:first-of-type{margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end)}[data-sonner-toast][data-styled=true] [data-cancel]{color:var(--normal-text);background:rgba(0,0,0,.08)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-styled=true] [data-cancel]{background:rgba(255,255,255,.3)}[data-sonner-toast][data-styled=true] [data-close-button]{position:absolute;left:var(--toast-close-button-start);right:var(--toast-close-button-end);top:0;height:20px;width:20px;display:flex;justify-content:center;align-items:center;padding:0;color:var(--gray12);background:var(--normal-bg);border:1px solid var(--gray4);transform:var(--toast-close-button-transform);border-radius:50%;cursor:pointer;z-index:1;transition:opacity .1s,background .2s,border-color .2s}[data-sonner-toast][data-styled=true] [data-close-button]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-styled=true] [data-disabled=true]{cursor:not-allowed}[data-sonner-toast][data-styled=true]:hover [data-close-button]:hover{background:var(--gray2);border-color:var(--gray5)}[data-sonner-toast][data-swiping=true]::before{content:'';position:absolute;left:-100%;right:-100%;height:100%;z-index:-1}[data-sonner-toast][data-y-position=top][data-swiping=true]::before{bottom:50%;transform:scaleY(3) translateY(50%)}[data-sonner-toast][data-y-position=bottom][data-swiping=true]::before{top:50%;transform:scaleY(3) translateY(-50%)}[data-sonner-toast][data-swiping=false][data-removed=true]::before{content:'';position:absolute;inset:0;transform:scaleY(2)}[data-sonner-toast][data-expanded=true]::after{content:'';position:absolute;left:0;height:calc(var(--gap) + 1px);bottom:100%;width:100%}[data-sonner-toast][data-mounted=true]{--y:translateY(0);opacity:1}[data-sonner-toast][data-expanded=false][data-front=false]{--scale:var(--toasts-before) * 0.05 + 1;--y:translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));height:var(--front-toast-height)}[data-sonner-toast]>*{transition:opacity .4s}[data-sonner-toast][data-x-position=right]{right:0}[data-sonner-toast][data-x-position=left]{left:0}[data-sonner-toast][data-expanded=false][data-front=false][data-styled=true]>*{opacity:0}[data-sonner-toast][data-visible=false]{opacity:0;pointer-events:none}[data-sonner-toast][data-mounted=true][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset)));height:var(--initial-height)}[data-sonner-toast][data-removed=true][data-front=true][data-swipe-out=false]{--y:translateY(calc(var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=false]{--y:translateY(40%);opacity:0;transition:transform .5s,opacity .2s}[data-sonner-toast][data-removed=true][data-front=false]::before{height:calc(var(--initial-height) + 20%)}[data-sonner-toast][data-swiping=true]{transform:var(--y) translateY(var(--swipe-amount-y,0)) translateX(var(--swipe-amount-x,0));transition:none}[data-sonner-toast][data-swiped=true]{user-select:none}[data-sonner-toast][data-swipe-out=true][data-y-position=bottom],[data-sonner-toast][data-swipe-out=true][data-y-position=top]{animation-duration:.2s;animation-timing-function:ease-out;animation-fill-mode:forwards}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=left]{animation-name:swipe-out-left}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=right]{animation-name:swipe-out-right}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=up]{animation-name:swipe-out-up}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=down]{animation-name:swipe-out-down}@keyframes swipe-out-left{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) - 100%));opacity:0}}@keyframes swipe-out-right{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) + 100%));opacity:0}}@keyframes swipe-out-up{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) - 100%));opacity:0}}@keyframes swipe-out-down{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) + 100%));opacity:0}}@media (max-width:600px){[data-sonner-toaster]{position:fixed;right:var(--mobile-offset-right);left:var(--mobile-offset-left);width:100%}[data-sonner-toaster][dir=rtl]{left:calc(var(--mobile-offset-left) * -1)}[data-sonner-toaster] [data-sonner-toast]{left:0;right:0;width:calc(100% - var(--mobile-offset-left) * 2)}[data-sonner-toaster][data-x-position=left]{left:var(--mobile-offset-left)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--mobile-offset-bottom)}[data-sonner-toaster][data-y-position=top]{top:var(--mobile-offset-top)}[data-sonner-toaster][data-x-position=center]{left:var(--mobile-offset-left);right:var(--mobile-offset-right);transform:none}}[data-sonner-toaster][data-sonner-theme=light]{--normal-bg:#fff;--normal-border:var(--gray4);--normal-text:var(--gray12);--success-bg:hsl(143, 85%, 96%);--success-border:hsl(145, 92%, 87%);--success-text:hsl(140, 100%, 27%);--info-bg:hsl(208, 100%, 97%);--info-border:hsl(221, 91%, 93%);--info-text:hsl(210, 92%, 45%);--warning-bg:hsl(49, 100%, 97%);--warning-border:hsl(49, 91%, 84%);--warning-text:hsl(31, 92%, 45%);--error-bg:hsl(359, 100%, 97%);--error-border:hsl(359, 100%, 94%);--error-text:hsl(360, 100%, 45%)}[data-sonner-toaster][data-sonner-theme=light] [data-sonner-toast][data-invert=true]{--normal-bg:#000;--normal-border:hsl(0, 0%, 20%);--normal-text:var(--gray1)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-invert=true]{--normal-bg:#fff;--normal-border:var(--gray3);--normal-text:var(--gray12)}[data-sonner-toaster][data-sonner-theme=dark]{--normal-bg:#000;--normal-bg-hover:hsl(0, 0%, 12%);--normal-border:hsl(0, 0%, 20%);--normal-border-hover:hsl(0, 0%, 25%);--normal-text:var(--gray1);--success-bg:hsl(150, 100%, 6%);--success-border:hsl(147, 100%, 12%);--success-text:hsl(150, 86%, 65%);--info-bg:hsl(215, 100%, 6%);--info-border:hsl(223, 43%, 17%);--info-text:hsl(216, 87%, 65%);--warning-bg:hsl(64, 100%, 6%);--warning-border:hsl(60, 100%, 9%);--warning-text:hsl(46, 87%, 65%);--error-bg:hsl(358, 76%, 10%);--error-border:hsl(357, 89%, 16%);--error-text:hsl(358, 100%, 81%)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]{background:var(--normal-bg);border-color:var(--normal-border);color:var(--normal-text)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]:hover{background:var(--normal-bg-hover);border-color:var(--normal-border-hover)}[data-rich-colors=true][data-sonner-toast][data-type=success]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=success] [data-close-button]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=info]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=info] [data-close-button]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning] [data-close-button]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=error]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}[data-rich-colors=true][data-sonner-toast][data-type=error] [data-close-button]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}.sonner-loading-wrapper{--size:16px;height:var(--size);width:var(--size);position:absolute;inset:0;z-index:10}.sonner-loading-wrapper[data-visible=false]{transform-origin:center;animation:sonner-fade-out .2s ease forwards}.sonner-spinner{position:relative;top:50%;left:50%;height:var(--size);width:var(--size)}.sonner-loading-bar{animation:sonner-spin 1.2s linear infinite;background:var(--gray11);border-radius:6px;height:8%;left:-10%;position:absolute;top:-3.9%;width:24%}.sonner-loading-bar:first-child{animation-delay:-1.2s;transform:rotate(.0001deg) translate(146%)}.sonner-loading-bar:nth-child(2){animation-delay:-1.1s;transform:rotate(30deg) translate(146%)}.sonner-loading-bar:nth-child(3){animation-delay:-1s;transform:rotate(60deg) translate(146%)}.sonner-loading-bar:nth-child(4){animation-delay:-.9s;transform:rotate(90deg) translate(146%)}.sonner-loading-bar:nth-child(5){animation-delay:-.8s;transform:rotate(120deg) translate(146%)}.sonner-loading-bar:nth-child(6){animation-delay:-.7s;transform:rotate(150deg) translate(146%)}.sonner-loading-bar:nth-child(7){animation-delay:-.6s;transform:rotate(180deg) translate(146%)}.sonner-loading-bar:nth-child(8){animation-delay:-.5s;transform:rotate(210deg) translate(146%)}.sonner-loading-bar:nth-child(9){animation-delay:-.4s;transform:rotate(240deg) translate(146%)}.sonner-loading-bar:nth-child(10){animation-delay:-.3s;transform:rotate(270deg) translate(146%)}.sonner-loading-bar:nth-child(11){animation-delay:-.2s;transform:rotate(300deg) translate(146%)}.sonner-loading-bar:nth-child(12){animation-delay:-.1s;transform:rotate(330deg) translate(146%)}@keyframes sonner-fade-in{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}@keyframes sonner-fade-out{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.8)}}@keyframes sonner-spin{0%{opacity:1}100%{opacity:.15}}@media (prefers-reduced-motion){.sonner-loading-bar,[data-sonner-toast],[data-sonner-toast]>*{transition:none!important;animation:none!important}}.sonner-loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);transform-origin:center;transition:opacity .2s,transform .2s}.sonner-loader[data-visible=false]{opacity:0;transform:scale(.8) translate(-50%,-50%)}\n\n/* ===== INLINE STYLE #8 id=- attrs=-\n  ===== */\n@property --rf-tw-animation-delay{syntax:\"*\";inherits:false;initial-value:0s}@property --rf-tw-animation-direction{syntax:\"*\";inherits:false;initial-value:normal}@property --rf-tw-animation-duration{syntax:\"*\";inherits:false}@property --rf-tw-animation-fill-mode{syntax:\"*\";inherits:false;initial-value:none}@property --rf-tw-animation-iteration-count{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-enter-blur{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-enter-opacity{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-enter-rotate{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-enter-scale{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-enter-translate-x{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-enter-translate-y{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-blur{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-opacity{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-exit-rotate{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-scale{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-exit-translate-x{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-translate-y{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-translate-x{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-translate-y{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-translate-z{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-scale-x{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-scale-y{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-scale-z{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-rotate-x{syntax:\"*\";inherits:false}@property --rf-tw-rotate-y{syntax:\"*\";inherits:false}@property --rf-tw-rotate-z{syntax:\"*\";inherits:false}@property --rf-tw-skew-x{syntax:\"*\";inherits:false}@property --rf-tw-skew-y{syntax:\"*\";inherits:false}@property --rf-tw-space-y-reverse{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-space-x-reverse{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-border-style{syntax:\"*\";inherits:false;initial-value:solid}@property --rf-tw-gradient-position{syntax:\"*\";inherits:false}@property --rf-tw-gradient-from{syntax:\"<color>\";inherits:false;initial-value:#0000}@property --rf-tw-gradient-via{syntax:\"<color>\";inherits:false;initial-value:#0000}@property --rf-tw-gradient-to{syntax:\"<color>\";inherits:false;initial-value:#0000}@property --rf-tw-gradient-stops{syntax:\"*\";inherits:false}@property --rf-tw-gradient-via-stops{syntax:\"*\";inherits:false}@property --rf-tw-gradient-from-position{syntax:\"<length-percentage>\";inherits:false;initial-value:0%}@property --rf-tw-gradient-via-position{syntax:\"<length-percentage>\";inherits:false;initial-value:50%}@property --rf-tw-gradient-to-position{syntax:\"<length-percentage>\";inherits:false;initial-value:100%}@property --rf-tw-leading{syntax:\"*\";inherits:false}@property --rf-tw-font-weight{syntax:\"*\";inherits:false}@property --rf-tw-tracking{syntax:\"*\";inherits:false}@property --rf-tw-ordinal{syntax:\"*\";inherits:false}@property --rf-tw-slashed-zero{syntax:\"*\";inherits:false}@property --rf-tw-numeric-figure{syntax:\"*\";inherits:false}@property --rf-tw-numeric-spacing{syntax:\"*\";inherits:false}@property --rf-tw-numeric-fraction{syntax:\"*\";inherits:false}@property --rf-tw-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-shadow-color{syntax:\"*\";inherits:false}@property --rf-tw-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --rf-tw-inset-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-inset-shadow-color{syntax:\"*\";inherits:false}@property --rf-tw-inset-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --rf-tw-ring-color{syntax:\"*\";inherits:false}@property --rf-tw-ring-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-inset-ring-color{syntax:\"*\";inherits:false}@property --rf-tw-inset-ring-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-ring-inset{syntax:\"*\";inherits:false}@property --rf-tw-ring-offset-width{syntax:\"<length>\";inherits:false;initial-value:0}@property --rf-tw-ring-offset-color{syntax:\"*\";inherits:false;initial-value:#fff}@property --rf-tw-ring-offset-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-outline-style{syntax:\"*\";inherits:false;initial-value:solid}@property --rf-tw-blur{syntax:\"*\";inherits:false}@property --rf-tw-brightness{syntax:\"*\";inherits:false}@property --rf-tw-contrast{syntax:\"*\";inherits:false}@property --rf-tw-grayscale{syntax:\"*\";inherits:false}@property --rf-tw-hue-rotate{syntax:\"*\";inherits:false}@property --rf-tw-invert{syntax:\"*\";inherits:false}@property --rf-tw-opacity{syntax:\"*\";inherits:false}@property --rf-tw-saturate{syntax:\"*\";inherits:false}@property --rf-tw-sepia{syntax:\"*\";inherits:false}@property --rf-tw-drop-shadow{syntax:\"*\";inherits:false}@property --rf-tw-drop-shadow-color{syntax:\"*\";inherits:false}@property --rf-tw-drop-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --rf-tw-drop-shadow-size{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-blur{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-brightness{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-contrast{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-grayscale{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-hue-rotate{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-invert{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-opacity{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-saturate{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-sepia{syntax:\"*\";inherits:false}@property --rf-tw-duration{syntax:\"*\";inherits:false}@property --rf-tw-ease{syntax:\"*\";inherits:false}@property --rf-tw-content{syntax:\"*\";inherits:false;initial-value:\"\"}\n\n/* ===== INLINE STYLE #9 id=- attrs=-\n  ===== */\n@property --rf-tw-animation-delay{syntax:\"*\";inherits:false;initial-value:0s}@property --rf-tw-animation-direction{syntax:\"*\";inherits:false;initial-value:normal}@property --rf-tw-animation-duration{syntax:\"*\";inherits:false}@property --rf-tw-animation-fill-mode{syntax:\"*\";inherits:false;initial-value:none}@property --rf-tw-animation-iteration-count{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-enter-blur{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-enter-opacity{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-enter-rotate{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-enter-scale{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-enter-translate-x{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-enter-translate-y{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-blur{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-opacity{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-exit-rotate{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-scale{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-exit-translate-x{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-exit-translate-y{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-translate-x{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-translate-y{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-translate-z{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-scale-x{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-scale-y{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-scale-z{syntax:\"*\";inherits:false;initial-value:1}@property --rf-tw-rotate-x{syntax:\"*\";inherits:false}@property --rf-tw-rotate-y{syntax:\"*\";inherits:false}@property --rf-tw-rotate-z{syntax:\"*\";inherits:false}@property --rf-tw-skew-x{syntax:\"*\";inherits:false}@property --rf-tw-skew-y{syntax:\"*\";inherits:false}@property --rf-tw-space-y-reverse{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-space-x-reverse{syntax:\"*\";inherits:false;initial-value:0}@property --rf-tw-border-style{syntax:\"*\";inherits:false;initial-value:solid}@property --rf-tw-gradient-position{syntax:\"*\";inherits:false}@property --rf-tw-gradient-from{syntax:\"<color>\";inherits:false;initial-value:#0000}@property --rf-tw-gradient-via{syntax:\"<color>\";inherits:false;initial-value:#0000}@property --rf-tw-gradient-to{syntax:\"<color>\";inherits:false;initial-value:#0000}@property --rf-tw-gradient-stops{syntax:\"*\";inherits:false}@property --rf-tw-gradient-via-stops{syntax:\"*\";inherits:false}@property --rf-tw-gradient-from-position{syntax:\"<length-percentage>\";inherits:false;initial-value:0%}@property --rf-tw-gradient-via-position{syntax:\"<length-percentage>\";inherits:false;initial-value:50%}@property --rf-tw-gradient-to-position{syntax:\"<length-percentage>\";inherits:false;initial-value:100%}@property --rf-tw-leading{syntax:\"*\";inherits:false}@property --rf-tw-font-weight{syntax:\"*\";inherits:false}@property --rf-tw-tracking{syntax:\"*\";inherits:false}@property --rf-tw-ordinal{syntax:\"*\";inherits:false}@property --rf-tw-slashed-zero{syntax:\"*\";inherits:false}@property --rf-tw-numeric-figure{syntax:\"*\";inherits:false}@property --rf-tw-numeric-spacing{syntax:\"*\";inherits:false}@property --rf-tw-numeric-fraction{syntax:\"*\";inherits:false}@property --rf-tw-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-shadow-color{syntax:\"*\";inherits:false}@property --rf-tw-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --rf-tw-inset-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-inset-shadow-color{syntax:\"*\";inherits:false}@property --rf-tw-inset-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --rf-tw-ring-color{syntax:\"*\";inherits:false}@property --rf-tw-ring-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-inset-ring-color{syntax:\"*\";inherits:false}@property --rf-tw-inset-ring-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-ring-inset{syntax:\"*\";inherits:false}@property --rf-tw-ring-offset-width{syntax:\"<length>\";inherits:false;initial-value:0}@property --rf-tw-ring-offset-color{syntax:\"*\";inherits:false;initial-value:#fff}@property --rf-tw-ring-offset-shadow{syntax:\"*\";inherits:false;initial-value:0 0 #0000}@property --rf-tw-outline-style{syntax:\"*\";inherits:false;initial-value:solid}@property --rf-tw-blur{syntax:\"*\";inherits:false}@property --rf-tw-brightness{syntax:\"*\";inherits:false}@property --rf-tw-contrast{syntax:\"*\";inherits:false}@property --rf-tw-grayscale{syntax:\"*\";inherits:false}@property --rf-tw-hue-rotate{syntax:\"*\";inherits:false}@property --rf-tw-invert{syntax:\"*\";inherits:false}@property --rf-tw-opacity{syntax:\"*\";inherits:false}@property --rf-tw-saturate{syntax:\"*\";inherits:false}@property --rf-tw-sepia{syntax:\"*\";inherits:false}@property --rf-tw-drop-shadow{syntax:\"*\";inherits:false}@property --rf-tw-drop-shadow-color{syntax:\"*\";inherits:false}@property --rf-tw-drop-shadow-alpha{syntax:\"<percentage>\";inherits:false;initial-value:100%}@property --rf-tw-drop-shadow-size{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-blur{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-brightness{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-contrast{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-grayscale{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-hue-rotate{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-invert{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-opacity{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-saturate{syntax:\"*\";inherits:false}@property --rf-tw-backdrop-sepia{syntax:\"*\";inherits:false}@property --rf-tw-duration{syntax:\"*\";inherits:false}@property --rf-tw-ease{syntax:\"*\";inherits:false}@property --rf-tw-content{syntax:\"*\";inherits:false;initial-value:\"\"}\n\n/* ===== INLINE STYLE #12 id=- attrs=-\n  ===== */\nbody{\n  color: rgba(0, 0, 0, 0.85);\n  background-color: #fff;\n}\n\n.react-switch .react-switch-icon{\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  height: 100%;\n}\n\n.react-switch-docusaurus .react-switch-icon{\n  font-size: 14px;\n}\n\n.react-switch > .react-switch-bg{\n  box-sizing: border-box;\n}\n\n.react-switch-github__light > .react-switch-bg{\n  border: 3px solid #d1d5da;\n}\n\n.react-switch-github__dark > .react-switch-bg{\n  border: 3px solid #3c1e70;\n}\n\n.react-switch-fluent__light > .react-switch-bg{\n  border: 1px solid #605e5c;\n}\n\n.react-switch-fluent__dark > .react-switch-bg{\n  border: 1px solid #0078d4;\n}\n\n/* ===== INLINE STYLE #13 id=mmd9fvv9.j4i attrs=-\n  ===== */\n#pv-float-bar-container {                    position: absolute;                    background-image: initial;                    top: 0px;                    left: 0px;                    z-index:2147483640;                    padding: 5px;                    margin: 0;                    border: none;                    opacity: 0.35;                    line-height: 0;                    -webkit-transition: opacity 0.2s ease-in-out;                    transition: opacity 0.2s ease-in-out;                    display:none;                    }                    #pv-float-bar-container:hover {                    opacity: 1;                    }                    #pv-float-bar-container .pv-float-bar-button {                    vertical-align:middle;                    cursor: pointer;                    width: 18px;                    height: 18px;                    padding: 0;                    margin:0;                    border: none;                    display: inline-block;                    position: relative;                    box-shadow: 1px 0 3px 0px rgba(0,0,0,0.9);                    background: transparent center no-repeat;                    background-size:100% 100%;                    background-origin: content-box;                    -webkit-transition: margin-right 0.15s ease-in-out ,  width 0.15s ease-in-out ,  height 0.15s ease-in-out ;                    transition: margin-right 0.15s ease-in-out ,  width 0.15s ease-in-out ,  height 0.15s ease-in-out ;                    }                    #pv-float-bar-container .pv-float-bar-button:not(:last-child){                    margin-right: -14px;                    }                    #pv-float-bar-container .pv-float-bar-button:first-child {                    z-index: 4;                    }                    #pv-float-bar-container .pv-float-bar-button:nth-child(2) {                    z-index: 3;                    }                    #pv-float-bar-container .pv-float-bar-button:nth-child(3) {                    z-index: 2;                    }                    #pv-float-bar-container .pv-float-bar-button:last-child {                    z-index: 1;                    }                    #pv-float-bar-container:hover > .pv-float-bar-button {                    width: 24px;                    height: 24px;                    }                    #pv-float-bar-container:hover > .pv-float-bar-button:not(:last-child) {                    margin-right: 4px;                    }                    #pv-float-bar-container .pv-float-bar-button-actual {                    background-image:url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAV1BMVEUAAAD////29vbKysoqKioiIiKysrKhoaGTk5N9fX3z8/Pv7+/r6+vk5OTb29vOzs6Ojo5UVFQzMzMZGRkREREMDAy4uLisrKylpaV4eHhkZGRPT08/Pz/IfxjQAAAAgklEQVQoz53RRw7DIBBAUb5pxr2m3/+ckfDImwyJlL9DDzQgDIUMRu1vWOxTBdeM+onApENF0qHjpkOk2VTwLVEF40Kbfj1wK8AVu2pQA1aBBYDHJ1wy9Cf4cXD5chzNAvsAnc8TjoLAhIzsBao9w1rlVTIvkOYMd9nm6xPi168t9AYkbANdajpjcwAAAABJRU5ErkJggg==\");                    }                    #pv-float-bar-container .pv-float-bar-button-search {                    background-image:url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAXVBMVEUAAAD///+MjIwmJibNzc2UlJTd3d2lpaUKCgrT09O/v78YGBjj4+MvLy8PDw/IyMh5eXn5+fn29vby8vLo6OjDw8O7u7u3t7ewsLCcnJx1dXVubm4+Pj43NzdkZGStc/JSAAAA4ElEQVQoz52RWW7DMAxE9bR635fYcXr/Y5aW7TYIGqDI/EjUAzRDUvFGCvWn/gHMOnmfNeYFJLonqnPVM8hrIA3B7of5BXkK47bXWwbe/ACp3OWqwSYnaI73+zStSST6AKYjE/sbQCZkpi0j0HSlUl/gPdwleM8SgSfIRzd8laRkcl0oIihYIkiVqhnl6hgicPRGrMHW0Ej4gXCYt8xiPoIw6TtANL8CVtpanSu1xvARJHYnpxpIq6tzU8D8UKIywHCNZCcpUDuXteDL57HngVMhf1nUQ9uisG47y492/kbfyJQHZ5yu1AMAAAAASUVORK5CYII=\");                    }                    #pv-float-bar-container .pv-float-bar-button-gallery {                    background-image:url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAP1BMVEUAAAD///94eHgZGRn39/fz8/POzs6xsbGSkpJ9fX1UVFQpKSnb29vJycmmpqafn5+UlJSNjY0/Pz8hISENDQ2fWpEMAAAAcUlEQVQoz43SWQrEIBRE0Xe7M8/T/tcaNSKCKUh95nCDiIaYYa9zUDQRiiaCalANqkE0n6BuBLArWBTUAsa2/3yqfwYdzAl+GeCWAN9YM7nvo4chgoXmgjP8CdoEvqmA/oCQRHgat2p7YM2gvHb9GMRu7acCGLmlyNoAAAAASUVORK5CYII=\");                    }                    #pv-float-bar-container .pv-float-bar-button-current {                    background-image:url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAQlBMVEUAAAD///+Tk5P39/fz8/POzs5UVFQpKSnb29vJycmxsbGwsLCmpqafn5+NjY1+fn58fHx4eHg/Pz8hISEZGRkNDQ1kumAIAAAAY0lEQVQoz63RWwqAIBBAUW+l9n63/62WVGDiREX3x4+DIjMKIYWK9hUIOiG89QwyLQCtBLUEmQC27N796iiBIgoAAeh8Oy2AucACk3sJqHyYU6AfwWU8GADSZIeGu7H/u1qhFbaeAcJXcp5yAAAAAElFTkSuQmCC\");                    }                    #pv-float-bar-container .pv-float-bar-button-magnifier {                    background-image:url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAUVBMVEUAAAD///86OjohISGcnJxYWFinp6djY2Pc3NywsLBPT09DQ0MVFRW8vLz8/PyoqKh5eXm2trb39/fw8PDZ2dnV1dXKysqTk5MLCwvl5eUpKSkk6YqhAAAAsElEQVQoz4XQ1w7DIAxAUZsZVvZq//9DCyTIpG3a+xApPkIMwJsA4WsneK2atlHav4EzQnLgUhh3ARfs+WuDq8Aby0r9MmHsAC2AQUno+DlByQxdBqkIGp6ADRl4Q9BChC4MXV7T/llBe7BAe1xOtT85nYruAWfWeAJwoS/zdcaVANxS3mpO1yaASatHel2GMVkBwo7IAbYEpgY/xknPMGcr6NNg3A4QFVwr8NlvuOkFpbsFbrIaILIAAAAASUVORK5CYII=\");                    }                    #pv-float-bar-container .pv-float-bar-button-download {                    background-image:url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAASFBMVEUAAAD///86Ojq8vLxXV1ciIiKcnJympqZjY2MxMTHc3NywsLBDQ0NPT08VFRV5eXn39/fw8PDZ2dnV1dXKysqUlJTl5eUNDQ1EnTQhAAAAtUlEQVQoz33QWRKDIBAE0Gl2AXFP7n/TDKIEk5j+wKp+ZQ0D4SYE+pkDkrMe3rr0ATEYpUkrE+IFouyppJexgRR6IQQAPodlAqeAMyRoByIyjo8DrGpA2Td43YD2FfJHokR2hOsf8uy1v87oZOnrjHorFu7rreoexKLzhiFlqJsPxJL7dcZagWU532oG0ABNzj7y6wpwVAOgJ8AztgyhhTRyM0TsUQ0MuRi3AqaBayp85T/c5AVMKwUv6mnXTQAAAABJRU5ErkJggg==\");                    }\n\n/* ===== INLINE STYLE #14 id=mmdfnnqm.17o attrs=-\n  ===== */\n#aifengyue-toast-container {\n                position: fixed;\n                bottom: 20px;\n                right: 20px;\n                z-index: 2147483647;\n                display: flex;\n                flex-direction: column-reverse;\n                gap: 10px;\n                pointer-events: none;\n            }\n            .aifengyue-toast {\n                padding: 12px 20px;\n                border-radius: 8px;\n                color: #fff;\n                font-size: 14px;\n                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n                animation: aifengyue-toast-in 0.3s ease-out;\n                pointer-events: auto;\n                max-width: 350px;\n                word-break: break-word;\n            }\n            .aifengyue-toast.success { background: linear-gradient(135deg, #10b981, #059669); }\n            .aifengyue-toast.error { background: linear-gradient(135deg, #ef4444, #dc2626); }\n            .aifengyue-toast.info { background: linear-gradient(135deg, #3b82f6, #2563eb); }\n            .aifengyue-toast.warning { background: linear-gradient(135deg, #f59e0b, #d97706); }\n            .aifengyue-toast.out { animation: aifengyue-toast-out 0.3s ease-in forwards; }\n            @keyframes aifengyue-toast-in {\n                from { opacity: 0; transform: translateX(100%); }\n                to { opacity: 1; transform: translateX(0); }\n            }\n            @keyframes aifengyue-toast-out {\n                from { opacity: 1; transform: translateX(0); }\n                to { opacity: 0; transform: translateX(100%); }\n            }\n\n/* ===== INLINE STYLE #15 id=- attrs=-\n  ===== */\n#nprogress {\n  pointer-events: none;\n}\n\n#nprogress .bar {\n  background: #1C64F2FF;\n\n  position: fixed;\n  z-index: 99999;\n  top: 0;\n  left: 0;\n\n  width: 100%;\n  height: 2px;\n}\n\n/* Fancy blur effect */\n#nprogress .peg {\n  display: block;\n  position: absolute;\n  right: 0px;\n  width: 100px;\n  height: 100%;\n  box-shadow: 0 0 10px #1C64F2FF, 0 0 5px #1C64F2FF;\n  opacity: 1.0;\n\n  -webkit-transform: rotate(3deg) translate(0px, -4px);\n      -ms-transform: rotate(3deg) translate(0px, -4px);\n          transform: rotate(3deg) translate(0px, -4px);\n}\n\n/* Remove these to get rid of the spinner */\n#nprogress .spinner {\n  display: block;\n  position: fixed;\n  z-index: 1031;\n  top: 15px;\n  bottom: auto;\n  right: 15px;\n  left: auto;\n}\n\n#nprogress .spinner-icon {\n  width: 18px;\n  height: 18px;\n  box-sizing: border-box;\n\n  border: solid 2px transparent;\n  border-top-color: #1C64F2FF;\n  border-left-color: #1C64F2FF;\n  border-radius: 50%;\n\n  -webkit-animation: nprogress-spinner 400ms linear infinite;\n          animation: nprogress-spinner 400ms linear infinite;\n}\n\n.nprogress-custom-parent {\n  overflow: hidden;\n  position: relative;\n}\n\n.nprogress-custom-parent #nprogress .spinner,\n.nprogress-custom-parent #nprogress .bar {\n  position: absolute;\n}\n\n@-webkit-keyframes nprogress-spinner {\n  0%   { -webkit-transform: rotate(0deg); }\n  100% { -webkit-transform: rotate(360deg); }\n}\n@keyframes nprogress-spinner {\n  0%   { transform: rotate(0deg); }\n  100% { transform: rotate(360deg); }\n}\n\n/* ===== INLINE STYLE #16 id=mmdi37s7.obt attrs=-\n  ===== */\n.search-jumper-shadow {display: block !important;width: 0px !important;height: 0px !important;margin: 0px !important;padding: 0px !important;border-width: initial !important;border-style: none !important;border-color: initial !important;border-image: initial !important;outline: none !important;position: unset !important;}\n\n/* ===== EXTERNAL STYLE #1 ===== */\n/* href: https://dearestie.xyz/_next/static/css/fc2d8f38e0696f38.css */\n/* method: cssRules */\n.download_download_page__iO3EP { background-image: url(\"https://static.catai.wiki/download/download-bg.png\"); background-size: cover; background-repeat: repeat; background-position: 0px 100%; }\n.spin-animation path { animation: 2s linear 0s infinite normal none running custom; }\n@keyframes custom { \n  0% { opacity: 0; }\n  25% { opacity: 0.1; }\n  50% { opacity: 0.2; }\n  75% { opacity: 0.5; }\n  100% { opacity: 1; }\n}\n.spin-animation path:first-child { animation-delay: 0s; }\n.spin-animation path:nth-child(2) { animation-delay: 0.5s; }\n.spin-animation path:nth-child(3) { animation-delay: 1s; }\n.spin-animation path:nth-child(4) { animation-delay: 2s; }\n.style_input__6i1wR { display: inline-flex; height: 1.75rem; width: 100%; border-radius: var(--radius); padding: 0.25rem 0.5rem; font-size: 0.75rem; line-height: 1.5; border-width: 1px; --tw-border-opacity: 1; border-color: rgb(229 231 235/var(--tw-border-opacity,1)); --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); caret-color: rgb(27, 124, 208); --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.06),0px 1px 3px 0px rgba(16,24,40,.1); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color),0px 1px 3px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.style_input__6i1wR::placeholder { --tw-text-opacity: 1; color: rgb(156 163 175/var(--tw-text-opacity,1)); }\n.style_input__6i1wR:hover { --tw-border-opacity: 1; border-color: rgb(209 213 219/var(--tw-border-opacity,1)); --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); }\n.style_input__6i1wR:focus { --tw-border-opacity: 1; border-color: rgb(104 175 239/var(--tw-border-opacity,1)); --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000); --tw-ring-inset: inset; --tw-ring-opacity: 1; --tw-ring-color: rgb(153 140 143/var(--tw-ring-opacity,1)); }\n.style_input__6i1wR:focus-visible { outline: transparent solid 2px; outline-offset: 2px; }\n.style_prefix__LtLcK { position: absolute; left: 0.5rem; align-self: center; white-space: nowrap; }\n.style_pagination__44bbT li { list-style: none; }\n.style_pagination__44bbT li button:hover { transform: translateY(-1px); box-shadow: rgba(0, 0, 0, 0.1) 0px 4px 8px; }\n.style_pagination__44bbT li button:active { transform: translateY(0px); }\n.style_pagination__44bbT li button[aria-current=\"page\"] { background: linear-gradient(135deg, rgb(59, 130, 246), rgb(29, 78, 216)); transform: translateY(-1px); box-shadow: rgba(59, 130, 246, 0.3) 0px 4px 12px; }\n.common_wrapper-danger__mqmAI { background: linear-gradient(rgba(217, 45, 32, 0.05), rgba(217, 45, 32, 0) 24.02%), rgb(249, 250, 251); }\n.common_wrapper-success__h8SUi { background: linear-gradient(rgba(3, 152, 85, 0.05), rgba(3, 152, 85, 0) 22.44%), rgb(249, 250, 251); }\n.account-page_modal__ZPNsr { padding: 24px 16px !important; width: 470px !important; }\n.style_container__lNfya { padding: 4px; border-radius: 4px; }\n.style_label__kx9qu { position: relative; margin-right: 3px; }\n.style_label__kx9qu:last-child { margin-right: 0px; }\n.mobile_mobileContainer__cBTBa { height: 100vh; }\n@supports (height:100dvh) {\n  .mobile_mobileContainer__cBTBa { height: 100dvh; }\n}\n.mobile_mobileScrollArea__4K9kb { padding-bottom: env(safe-area-inset-bottom,0); }\n.mobile_mobilePagination__Tkttf { padding-bottom: max(20px,env(safe-area-inset-bottom)); background: linear-gradient(0deg, rgb(243, 244, 246) 70%, rgba(243, 244, 246, 0)); margin-top: 16px; }\n@media (max-width: 768px) {\n  .mobile_mobilePagination__Tkttf { padding-bottom: max(24px,env(safe-area-inset-bottom)); background: linear-gradient(0deg, rgba(243, 244, 246, 0.95) 80%, rgba(243, 244, 246, 0)); }\n  .mobile_mobileScrollArea__4K9kb { padding-bottom: max(8px,env(safe-area-inset-bottom)); }\n}\n@media (max-width: 768px) and (orientation: portrait) {\n  .mobile_mobilePagination__Tkttf { padding-bottom: max(34px,env(safe-area-inset-bottom)); }\n}\n@media (max-width: 1024px) and (orientation: landscape) {\n  .mobile_mobileContainer__cBTBa { height: 100dvh; }\n  .mobile_mobilePagination__Tkttf { padding-bottom: max(16px,env(safe-area-inset-bottom)); }\n}\n.style_delModal__diGFr { background: linear-gradient(rgba(217, 45, 32, 0.05), rgba(217, 45, 32, 0) 24.02%), rgb(249, 250, 251); border-radius: 1rem; padding: 2rem; }\n.style_delModal__diGFr, .style_warningWrapper__PktGM { box-shadow: rgba(16, 24, 40, 0.08) 0px 20px 24px -4px, rgba(16, 24, 40, 0.03) 0px 8px 8px -4px; }\n.style_warningWrapper__PktGM { background: rgba(255, 255, 255, 0.9); margin-bottom: 0.75rem; display: flex; height: 3rem; width: 3rem; align-items: center; justify-content: center; border-radius: 0.75rem; border-width: 0.5px; --tw-border-opacity: 1; border-color: rgb(243 244 246/var(--tw-border-opacity,1)); }\n\n/* ===== EXTERNAL STYLE #2 ===== */\n/* href: https://dearestie.xyz/_next/static/css/f8b26c8b95fbf74c.css */\n/* method: cssRules */\n.container { width: 100%; }\n@media (min-width: 100px) {\n  .container { max-width: 100px; }\n}\n@media (min-width: 640px) {\n  .container { max-width: 640px; }\n}\n@media (min-width: 768px) {\n  .container { max-width: 768px; }\n}\n@media (min-width: 769px) {\n  .container { max-width: 769px; }\n}\n@media (min-width: 1024px) {\n  .container { max-width: 1024px; }\n}\n@media (min-width: 1280px) {\n  .container { max-width: 1280px; }\n}\n@media (min-width: 1536px) {\n  .container { max-width: 1536px; }\n}\n.btn { display: inline-flex; height: 2.25rem; cursor: pointer; place-content: center; align-items: center; white-space: nowrap; border-radius: var(--radius); padding: 0.5rem 1rem; font-size: 1rem; line-height: 1.25rem; }\n.btn-default { cursor: pointer; border-width: 1px; border-style: solid; --tw-border-opacity: 1; border-color: rgb(229 231 235/var(--tw-border-opacity,1)); --tw-text-opacity: 1; color: rgb(107 114 128/var(--tw-text-opacity,1)); }\n.btn-default:hover { --tw-border-opacity: 1; border-color: rgb(209 213 219/var(--tw-border-opacity,1)); --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.06),0px 1px 3px 0px rgba(16,24,40,.1); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color),0px 1px 3px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.btn-default-disabled { cursor: not-allowed; border-width: 1px; border-style: solid; --tw-border-opacity: 1; border-color: rgb(229 231 235/var(--tw-border-opacity,1)); background-color: rgb(229 231 235/var(--tw-bg-opacity,1)); color: rgb(31 42 55/var(--tw-text-opacity,1)); }\n.btn-default-disabled, .btn-primary { --tw-bg-opacity: 1; --tw-text-opacity: 1; }\n.btn-primary { cursor: pointer; background-color: rgb(27 124 208/var(--tw-bg-opacity,1)); color: rgb(255 255 255/var(--tw-text-opacity,1)); }\n.btn-primary:hover { background-color: rgba(27, 124, 208, 0.75); --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.06),0px 1px 3px 0px rgba(16,24,40,.1); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color),0px 1px 3px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.btn-primary-disabled { cursor: not-allowed; background-color: rgb(153 140 143/var(--tw-bg-opacity,1)); }\n.btn-primary-disabled, .btn-warning { --tw-bg-opacity: 1; --tw-text-opacity: 1; color: rgb(255 255 255/var(--tw-text-opacity,1)); }\n.btn-warning { cursor: pointer; background-color: rgb(217 62 62/var(--tw-bg-opacity,1)); }\n.btn-warning:hover { background-color: rgba(217, 62, 62, 0.75); --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.06),0px 1px 3px 0px rgba(16,24,40,.1); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color),0px 1px 3px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.btn-warning-disabled { cursor: not-allowed; background-color: rgba(217, 62, 62, 0.75); --tw-text-opacity: 1; color: rgb(255 255 255/var(--tw-text-opacity,1)); }\n\n/* ===== EXTERNAL STYLE #3 ===== */\n/* href: https://dearestie.xyz/_next/static/css/a54f270867205682.css */\n/* method: cssRules */\n*, ::after, ::before { --tw-border-spacing-x: 0; --tw-border-spacing-y: 0; --tw-translate-x: 0; --tw-translate-y: 0; --tw-rotate: 0; --tw-skew-x: 0; --tw-skew-y: 0; --tw-scale-x: 1; --tw-scale-y: 1; --tw-pan-x: ; --tw-pan-y: ; --tw-pinch-zoom: ; --tw-scroll-snap-strictness: proximity; --tw-gradient-from-position: ; --tw-gradient-via-position: ; --tw-gradient-to-position: ; --tw-ordinal: ; --tw-slashed-zero: ; --tw-numeric-figure: ; --tw-numeric-spacing: ; --tw-numeric-fraction: ; --tw-ring-inset: ; --tw-ring-offset-width: 0px; --tw-ring-offset-color: #fff; --tw-ring-color: rgba(30,136,229,.5); --tw-ring-offset-shadow: 0 0 #0000; --tw-ring-shadow: 0 0 #0000; --tw-shadow: 0 0 #0000; --tw-shadow-colored: 0 0 #0000; --tw-blur: ; --tw-brightness: ; --tw-contrast: ; --tw-grayscale: ; --tw-hue-rotate: ; --tw-invert: ; --tw-saturate: ; --tw-sepia: ; --tw-drop-shadow: ; --tw-backdrop-blur: ; --tw-backdrop-brightness: ; --tw-backdrop-contrast: ; --tw-backdrop-grayscale: ; --tw-backdrop-hue-rotate: ; --tw-backdrop-invert: ; --tw-backdrop-opacity: ; --tw-backdrop-saturate: ; --tw-backdrop-sepia: ; --tw-contain-size: ; --tw-contain-layout: ; --tw-contain-paint: ; --tw-contain-style: ; }\n::backdrop { --tw-border-spacing-x: 0; --tw-border-spacing-y: 0; --tw-translate-x: 0; --tw-translate-y: 0; --tw-rotate: 0; --tw-skew-x: 0; --tw-skew-y: 0; --tw-scale-x: 1; --tw-scale-y: 1; --tw-pan-x: ; --tw-pan-y: ; --tw-pinch-zoom: ; --tw-scroll-snap-strictness: proximity; --tw-gradient-from-position: ; --tw-gradient-via-position: ; --tw-gradient-to-position: ; --tw-ordinal: ; --tw-slashed-zero: ; --tw-numeric-figure: ; --tw-numeric-spacing: ; --tw-numeric-fraction: ; --tw-ring-inset: ; --tw-ring-offset-width: 0px; --tw-ring-offset-color: #fff; --tw-ring-color: rgba(30,136,229,.5); --tw-ring-offset-shadow: 0 0 #0000; --tw-ring-shadow: 0 0 #0000; --tw-shadow: 0 0 #0000; --tw-shadow-colored: 0 0 #0000; --tw-blur: ; --tw-brightness: ; --tw-contrast: ; --tw-grayscale: ; --tw-hue-rotate: ; --tw-invert: ; --tw-saturate: ; --tw-sepia: ; --tw-drop-shadow: ; --tw-backdrop-blur: ; --tw-backdrop-brightness: ; --tw-backdrop-contrast: ; --tw-backdrop-grayscale: ; --tw-backdrop-hue-rotate: ; --tw-backdrop-invert: ; --tw-backdrop-opacity: ; --tw-backdrop-saturate: ; --tw-backdrop-sepia: ; --tw-contain-size: ; --tw-contain-layout: ; --tw-contain-paint: ; --tw-contain-style: ; }\n*, ::after, ::before { box-sizing: border-box; border: 0px solid rgb(229, 231, 235); }\n::after, ::before { --tw-content: \"\"; }\n:host, html { line-height: 1.5; text-size-adjust: 100%; tab-size: 4; font-family: ui-sans-serif, system-ui, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\"; font-feature-settings: normal; font-variation-settings: normal; -webkit-tap-highlight-color: transparent; }\nbody { margin: 0px; line-height: inherit; }\nhr { height: 0px; color: inherit; border-top-width: 1px; }\nabbr:where([title]) { text-decoration: underline dotted; }\nh1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }\na { text-decoration: inherit; }\nb, strong { font-weight: bolder; }\ncode, kbd, pre, samp { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-feature-settings: normal; font-variation-settings: normal; font-size: 1em; }\nsmall { font-size: 80%; }\nsub, sup { font-size: 75%; line-height: 0; position: relative; vertical-align: baseline; }\nsub { bottom: -0.25em; }\nsup { top: -0.5em; }\ntable { text-indent: 0px; border-color: inherit; border-collapse: collapse; }\nbutton, input, optgroup, select, textarea { font-family: inherit; font-feature-settings: inherit; font-variation-settings: inherit; font-size: 100%; font-weight: inherit; line-height: inherit; letter-spacing: inherit; color: inherit; margin: 0px; padding: 0px; }\nbutton, select { text-transform: none; }\nbutton, input:where([type=\"button\"]), input:where([type=\"reset\"]), input:where([type=\"submit\"]) { appearance: button; background-color: transparent; background-image: none; }\nprogress { vertical-align: baseline; }\n::-webkit-inner-spin-button, ::-webkit-outer-spin-button { height: auto; }\n[type=\"search\"] { appearance: textfield; outline-offset: -2px; }\n::-webkit-search-decoration { appearance: none; }\n::-webkit-file-upload-button { appearance: button; font: inherit; }\nsummary { display: list-item; }\nblockquote, dd, dl, figure, h1, h2, h3, h4, h5, h6, hr, p, pre { margin: 0px; }\nfieldset { margin: 0px; }\nfieldset, legend { padding: 0px; }\nmenu, ol, ul { list-style: none; margin: 0px; padding: 0px; }\ndialog { padding: 0px; }\ntextarea { resize: vertical; }\ninput::placeholder, textarea::placeholder { opacity: 1; color: rgb(156, 163, 175); }\n[role=\"button\"], button { cursor: pointer; }\n:disabled { cursor: default; }\naudio, canvas, embed, iframe, img, object, svg, video { display: block; vertical-align: middle; }\nimg, video { max-width: 100%; height: auto; }\n[hidden]:where(:not([hidden=\"until-found\"])) { display: none; }\n:root { --background: 0 0% 100%; --foreground: 0 0% 3.9%; --card: 0 0% 100%; --card-foreground: 0 0% 3.9%; --popover: 0 0% 100%; --popover-foreground: 0 0% 3.9%; --primary: 0 0% 9%; --primary-foreground: 0 0% 98%; --secondary: 0 0% 96.1%; --secondary-foreground: 0 0% 9%; --muted: 0 0% 96.1%; --muted-foreground: 0 0% 45.1%; --accent: 0 0% 96.1%; --accent-foreground: 0 0% 9%; --destructive: 0 84.2% 60.2%; --destructive-foreground: 0 0% 98%; --border: 0 0% 89.8%; --input: 0 0% 89.8%; --ring: 0 0% 3.9%; --chart-1: 12 76% 61%; --chart-2: 173 58% 39%; --chart-3: 197 37% 24%; --chart-4: 43 74% 66%; --chart-5: 27 87% 67%; --radius: 0.5rem; }\n.dark { --background: 0 0% 3.9%; --foreground: 0 0% 98%; --card: 0 0% 3.9%; --card-foreground: 0 0% 98%; --popover: 0 0% 3.9%; --popover-foreground: 0 0% 98%; --primary: 0 0% 98%; --primary-foreground: 0 0% 9%; --secondary: 0 0% 14.9%; --secondary-foreground: 0 0% 98%; --muted: 0 0% 14.9%; --muted-foreground: 0 0% 63.9%; --accent: 0 0% 14.9%; --accent-foreground: 0 0% 98%; --destructive: 0 62.8% 30.6%; --destructive-foreground: 0 0% 98%; --border: 0 0% 14.9%; --input: 0 0% 14.9%; --ring: 0 0% 83.1%; --chart-1: 220 70% 50%; --chart-2: 160 60% 45%; --chart-3: 30 80% 55%; --chart-4: 280 65% 60%; --chart-5: 340 75% 55%; }\n* { border-color: hsl(var(--border)); }\nbody { background-color: hsl(var(--background)); color: hsl(var(--foreground)); }\n.container { width: 100%; }\n@media (min-width: 100px) {\n  .container { max-width: 100px; }\n}\n@media (min-width: 640px) {\n  .container { max-width: 640px; }\n}\n@media (min-width: 768px) {\n  .container { max-width: 768px; }\n}\n@media (min-width: 769px) {\n  .container { max-width: 769px; }\n}\n@media (min-width: 1024px) {\n  .container { max-width: 1024px; }\n}\n@media (min-width: 1280px) {\n  .container { max-width: 1280px; }\n}\n@media (min-width: 1536px) {\n  .container { max-width: 1536px; }\n}\n.pointer-events-none { pointer-events: none; }\n.\\!visible { visibility: visible !important; }\n.visible { visibility: visible; }\n.invisible { visibility: hidden; }\n.collapse { visibility: collapse; }\n.static { position: static; }\n.fixed { position: fixed; }\n.\\!absolute { position: absolute !important; }\n.absolute { position: absolute; }\n.relative { position: relative; }\n.sticky { position: sticky; }\n.inset-0 { inset: 0px; }\n.inset-\\[1\\.5px\\] { inset: 1.5px; }\n.inset-x-0 { left: 0px; right: 0px; }\n.inset-y-0 { top: 0px; bottom: 0px; }\n.\\!left-3\\.5 { left: 0.875rem !important; }\n.\\!right-2 { right: 0.5rem !important; }\n.\\!right-3\\.5 { right: 0.875rem !important; }\n.\\!top-\\[11px\\] { top: 11px !important; }\n.\\!top-\\[9px\\] { top: 9px !important; }\n.-bottom-0\\.5 { bottom: -0.125rem; }\n.-bottom-2 { bottom: -0.5rem; }\n.-bottom-3 { bottom: -0.75rem; }\n.-left-11 { left: -2.75rem; }\n.-left-2 { left: -0.5rem; }\n.-left-3 { left: -0.75rem; }\n.-left-6 { left: -1.5rem; }\n.-left-\\[3px\\] { left: -3px; }\n.-right-0\\.5 { right: -0.125rem; }\n.-right-1 { right: -0.25rem; }\n.-right-2 { right: -0.5rem; }\n.-right-2\\.5 { right: -0.625rem; }\n.-right-3 { right: -0.75rem; }\n.-right-3\\.5 { right: -0.875rem; }\n.-right-6 { right: -1.5rem; }\n.-right-9 { right: -2.25rem; }\n.-right-\\[5px\\] { right: -5px; }\n.-right-\\[9px\\] { right: -9px; }\n.-top-1 { top: -0.25rem; }\n.-top-10 { top: -2.5rem; }\n.-top-2 { top: -0.5rem; }\n.-top-2\\.5 { top: -0.625rem; }\n.-top-3 { top: -0.75rem; }\n.-top-3\\.5 { top: -0.875rem; }\n.-top-5 { top: -1.25rem; }\n.-top-\\[3px\\] { top: -3px; }\n.-top-\\[5px\\] { top: -5px; }\n.-top-\\[9px\\] { top: -9px; }\n.bottom-0 { bottom: 0px; }\n.bottom-1 { bottom: 0.25rem; }\n.bottom-1\\.5 { bottom: 0.375rem; }\n.bottom-2 { bottom: 0.5rem; }\n.bottom-24 { bottom: 6rem; }\n.bottom-3 { bottom: 0.75rem; }\n.bottom-4 { bottom: 1rem; }\n.bottom-\\[-3px\\] { bottom: -3px; }\n.bottom-\\[5px\\] { bottom: 5px; }\n.bottom-\\[7px\\] { bottom: 7px; }\n.bottom-full { bottom: 100%; }\n.left-0 { left: 0px; }\n.left-0\\.5 { left: 0.125rem; }\n.left-1 { left: 0.25rem; }\n.left-1\\/2 { left: 50%; }\n.left-2 { left: 0.5rem; }\n.left-3 { left: 0.75rem; }\n.left-4 { left: 1rem; }\n.left-6 { left: 1.5rem; }\n.left-\\[-8px\\] { left: -8px; }\n.left-\\[10px\\] { left: 10px; }\n.left-\\[18px\\] { left: 18px; }\n.left-\\[224px\\] { left: 224px; }\n.left-\\[275px\\] { left: 275px; }\n.left-\\[324px\\] { left: 324px; }\n.left-\\[327px\\] { left: 327px; }\n.left-\\[50\\%\\] { left: 50%; }\n.left-full { left: 100%; }\n.right-0 { right: 0px; }\n.right-1 { right: 0.25rem; }\n.right-1\\.5 { right: 0.375rem; }\n.right-1\\/2 { right: 50%; }\n.right-2 { right: 0.5rem; }\n.right-2\\.5 { right: 0.625rem; }\n.right-4 { right: 1rem; }\n.right-6 { right: 1.5rem; }\n.right-\\[-3px\\] { right: -3px; }\n.right-\\[26px\\] { right: 26px; }\n.right-\\[30px\\] { right: 30px; }\n.right-\\[8px\\] { right: 8px; }\n.top-0 { top: 0px; }\n.top-1 { top: 0.25rem; }\n.top-1\\/2 { top: 50%; }\n.top-16 { top: 4rem; }\n.top-2 { top: 0.5rem; }\n.top-2\\.5 { top: 0.625rem; }\n.top-4 { top: 1rem; }\n.top-6 { top: 1.5rem; }\n.top-7 { top: 1.75rem; }\n.top-9 { top: 2.25rem; }\n.top-\\[-158px\\] { top: -158px; }\n.top-\\[-16px\\] { top: -16px; }\n.top-\\[-2px\\] { top: -2px; }\n.top-\\[-3px\\] { top: -3px; }\n.top-\\[-7px\\] { top: -7px; }\n.top-\\[10px\\] { top: 10px; }\n.top-\\[127px\\] { top: 127px; }\n.top-\\[1px\\] { top: 1px; }\n.top-\\[254px\\] { top: 254px; }\n.top-\\[2px\\] { top: 2px; }\n.top-\\[30px\\] { top: 30px; }\n.top-\\[50\\%\\] { top: 50%; }\n.top-\\[52px\\] { top: 52px; }\n.top-\\[9px\\] { top: 9px; }\n.top-full { top: 100%; }\n.\\!z-20 { z-index: 20 !important; }\n.\\!z-30 { z-index: 30 !important; }\n.\\!z-40 { z-index: 40 !important; }\n.\\!z-50 { z-index: 50 !important; }\n.\\!z-\\[101\\] { z-index: 101 !important; }\n.\\!z-\\[1020\\] { z-index: 1020 !important; }\n.\\!z-\\[102\\] { z-index: 102 !important; }\n.\\!z-\\[103\\] { z-index: 103 !important; }\n.\\!z-\\[999\\] { z-index: 999 !important; }\n.-z-10 { z-index: -10; }\n.z-0 { z-index: 0; }\n.z-10 { z-index: 10; }\n.z-20 { z-index: 20; }\n.z-30 { z-index: 30; }\n.z-40 { z-index: 40; }\n.z-50 { z-index: 50; }\n.z-\\[1000\\] { z-index: 1000; }\n.z-\\[1002\\] { z-index: 1002; }\n.z-\\[1003\\] { z-index: 1003; }\n.z-\\[100\\] { z-index: 100; }\n.z-\\[101\\] { z-index: 101; }\n.z-\\[102\\] { z-index: 102; }\n.z-\\[10\\] { z-index: 10; }\n.z-\\[1500\\] { z-index: 1500; }\n.z-\\[1\\] { z-index: 1; }\n.z-\\[21\\] { z-index: 21; }\n.z-\\[2\\] { z-index: 2; }\n.z-\\[500\\] { z-index: 500; }\n.z-\\[5\\] { z-index: 5; }\n.z-\\[60\\] { z-index: 60; }\n.z-\\[70\\] { z-index: 70; }\n.z-\\[9998\\] { z-index: 9998; }\n.z-\\[9999\\] { z-index: 9999; }\n.z-\\[9\\] { z-index: 9; }\n.order-1 { order: 1; }\n.order-2 { order: 2; }\n.col-span-1 { grid-column: span 1 / span 1; }\n.col-span-12 { grid-column: span 12 / span 12; }\n.col-span-2 { grid-column: span 2 / span 2; }\n.col-span-full { grid-column: 1 / -1; }\n.float-right { float: right; }\n.\\!-m-px { margin: -1px !important; }\n.m-0 { margin: 0px; }\n.m-auto { margin: auto; }\n.\\!my-0 { margin-top: 0px !important; margin-bottom: 0px !important; }\n.\\!my-1 { margin-top: 0.25rem !important; margin-bottom: 0.25rem !important; }\n.\\!my-2 { margin-top: 0.5rem !important; margin-bottom: 0.5rem !important; }\n.\\!my-4 { margin-top: 1rem !important; margin-bottom: 1rem !important; }\n.-my-1 { margin-top: -0.25rem; margin-bottom: -0.25rem; }\n.mx-0\\.5 { margin-left: 0.125rem; margin-right: 0.125rem; }\n.mx-1 { margin-left: 0.25rem; margin-right: 0.25rem; }\n.mx-2 { margin-left: 0.5rem; margin-right: 0.5rem; }\n.mx-2\\.5 { margin-left: 0.625rem; margin-right: 0.625rem; }\n.mx-3 { margin-left: 0.75rem; margin-right: 0.75rem; }\n.mx-4 { margin-left: 1rem; margin-right: 1rem; }\n.mx-8 { margin-left: 2rem; margin-right: 2rem; }\n.mx-auto { margin-left: auto; margin-right: auto; }\n.my-0 { margin-top: 0px; margin-bottom: 0px; }\n.my-1 { margin-top: 0.25rem; margin-bottom: 0.25rem; }\n.my-2 { margin-top: 0.5rem; margin-bottom: 0.5rem; }\n.my-3 { margin-top: 0.75rem; margin-bottom: 0.75rem; }\n.my-4 { margin-top: 1rem; margin-bottom: 1rem; }\n.my-5 { margin-top: 1.25rem; margin-bottom: 1.25rem; }\n.my-6 { margin-top: 1.5rem; margin-bottom: 1.5rem; }\n.my-8 { margin-top: 2rem; margin-bottom: 2rem; }\n.\\!mb-4 { margin-bottom: 1rem !important; }\n.\\!ml-1 { margin-left: 0.25rem !important; }\n.\\!ml-\\[3px\\] { margin-left: 3px !important; }\n.\\!mr-0 { margin-right: 0px !important; }\n.\\!mr-1 { margin-right: 0.25rem !important; }\n.\\!mt-14 { margin-top: 3.5rem !important; }\n.-mb-1 { margin-bottom: -0.25rem; }\n.-ml-0\\.5 { margin-left: -0.125rem; }\n.-mr-4 { margin-right: -1rem; }\n.-mt-2 { margin-top: -0.5rem; }\n.-mt-4 { margin-top: -1rem; }\n.-mt-6 { margin-top: -1.5rem; }\n.mb-0 { margin-bottom: 0px; }\n.mb-0\\.5 { margin-bottom: 0.125rem; }\n.mb-1 { margin-bottom: 0.25rem; }\n.mb-10 { margin-bottom: 2.5rem; }\n.mb-2 { margin-bottom: 0.5rem; }\n.mb-2\\.5 { margin-bottom: 0.625rem; }\n.mb-3 { margin-bottom: 0.75rem; }\n.mb-4 { margin-bottom: 1rem; }\n.mb-5 { margin-bottom: 1.25rem; }\n.mb-6 { margin-bottom: 1.5rem; }\n.mb-7 { margin-bottom: 1.75rem; }\n.mb-8 { margin-bottom: 2rem; }\n.mb-9 { margin-bottom: 2.25rem; }\n.mb-\\[10px\\] { margin-bottom: 10px; }\n.mb-\\[2px\\] { margin-bottom: 2px; }\n.mb-\\[70px\\] { margin-bottom: 70px; }\n.ml-0 { margin-left: 0px; }\n.ml-0\\.5 { margin-left: 0.125rem; }\n.ml-1 { margin-left: 0.25rem; }\n.ml-12 { margin-left: 3rem; }\n.ml-2 { margin-left: 0.5rem; }\n.ml-2\\.5 { margin-left: 0.625rem; }\n.ml-3 { margin-left: 0.75rem; }\n.ml-4 { margin-left: 1rem; }\n.ml-6 { margin-left: 1.5rem; }\n.ml-8 { margin-left: 2rem; }\n.ml-9 { margin-left: 2.25rem; }\n.ml-\\[136px\\] { margin-left: 136px; }\n.ml-\\[2px\\] { margin-left: 2px; }\n.ml-\\[50\\%\\] { margin-left: 50%; }\n.ml-auto { margin-left: auto; }\n.mr-0 { margin-right: 0px; }\n.mr-0\\.5 { margin-right: 0.125rem; }\n.mr-1 { margin-right: 0.25rem; }\n.mr-1\\.5 { margin-right: 0.375rem; }\n.mr-14 { margin-right: 3.5rem; }\n.mr-2 { margin-right: 0.5rem; }\n.mr-3 { margin-right: 0.75rem; }\n.mr-4 { margin-right: 1rem; }\n.mr-5 { margin-right: 1.25rem; }\n.mr-6 { margin-right: 1.5rem; }\n.mr-\\[1px\\] { margin-right: 1px; }\n.mr-\\[3px\\] { margin-right: 3px; }\n.mr-\\[5px\\] { margin-right: 5px; }\n.mr-\\[6px\\] { margin-right: 6px; }\n.mt-0 { margin-top: 0px; }\n.mt-0\\.5 { margin-top: 0.125rem; }\n.mt-1 { margin-top: 0.25rem; }\n.mt-1\\.5 { margin-top: 0.375rem; }\n.mt-10 { margin-top: 2.5rem; }\n.mt-12 { margin-top: 3rem; }\n.mt-16 { margin-top: 4rem; }\n.mt-2 { margin-top: 0.5rem; }\n.mt-3 { margin-top: 0.75rem; }\n.mt-3\\.5 { margin-top: 0.875rem; }\n.mt-4 { margin-top: 1rem; }\n.mt-5 { margin-top: 1.25rem; }\n.mt-6 { margin-top: 1.5rem; }\n.mt-7 { margin-top: 1.75rem; }\n.mt-8 { margin-top: 2rem; }\n.mt-\\[10px\\] { margin-top: 10px; }\n.mt-\\[14px\\] { margin-top: 14px; }\n.mt-\\[15px\\] { margin-top: 15px; }\n.mt-\\[181px\\] { margin-top: 181px; }\n.mt-\\[1px\\] { margin-top: 1px; }\n.mt-\\[280px\\] { margin-top: 280px; }\n.mt-\\[2px\\] { margin-top: 2px; }\n.mt-\\[4px\\] { margin-top: 4px; }\n.mt-\\[5px\\] { margin-top: 5px; }\n.mt-auto { margin-top: auto; }\n.box-border { box-sizing: border-box; }\n.line-clamp-1 { -webkit-line-clamp: 1; }\n.line-clamp-1, .line-clamp-2 { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; }\n.line-clamp-2 { -webkit-line-clamp: 2; }\n.line-clamp-4 { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }\n.\\!block { display: block !important; }\n.block { display: block; }\n.inline-block { display: inline-block; }\n.\\!inline { display: inline !important; }\n.inline { display: inline; }\n.flex { display: flex; }\n.inline-flex { display: inline-flex; }\n.table { display: table; }\n.grid { display: grid; }\n.contents { display: contents; }\n.hidden { display: none; }\n.aspect-\\[16\\/10\\] { aspect-ratio: 16 / 10; }\n.aspect-\\[4\\/3\\] { aspect-ratio: 4 / 3; }\n.aspect-\\[4\\/5\\] { aspect-ratio: 4 / 5; }\n.aspect-square { aspect-ratio: 1 / 1; }\n.size-4 { width: 1rem; height: 1rem; }\n.size-5 { width: 1.25rem; height: 1.25rem; }\n.\\!h-10 { height: 2.5rem !important; }\n.\\!h-3 { height: 0.75rem !important; }\n.\\!h-4 { height: 1rem !important; }\n.\\!h-5 { height: 1.25rem !important; }\n.\\!h-6 { height: 1.5rem !important; }\n.\\!h-7 { height: 1.75rem !important; }\n.\\!h-8 { height: 2rem !important; }\n.\\!h-9 { height: 2.25rem !important; }\n.\\!h-\\[14px\\] { height: 14px !important; }\n.\\!h-\\[1px\\] { height: 1px !important; }\n.\\!h-auto { height: auto !important; }\n.\\!h-px { height: 1px !important; }\n.h-0 { height: 0px; }\n.h-0\\.5 { height: 0.125rem; }\n.h-1 { height: 0.25rem; }\n.h-1\\.5 { height: 0.375rem; }\n.h-10 { height: 2.5rem; }\n.h-11 { height: 2.75rem; }\n.h-12 { height: 3rem; }\n.h-14 { height: 3.5rem; }\n.h-16 { height: 4rem; }\n.h-2 { height: 0.5rem; }\n.h-2\\.5 { height: 0.625rem; }\n.h-20 { height: 5rem; }\n.h-24 { height: 6rem; }\n.h-28 { height: 7rem; }\n.h-3 { height: 0.75rem; }\n.h-3\\.5 { height: 0.875rem; }\n.h-32 { height: 8rem; }\n.h-36 { height: 9rem; }\n.h-4 { height: 1rem; }\n.h-40 { height: 10rem; }\n.h-48 { height: 12rem; }\n.h-5 { height: 1.25rem; }\n.h-6 { height: 1.5rem; }\n.h-60 { height: 15rem; }\n.h-64 { height: 16rem; }\n.h-7 { height: 1.75rem; }\n.h-8 { height: 2rem; }\n.h-9 { height: 2.25rem; }\n.h-96 { height: 24rem; }\n.h-\\[100px\\] { height: 100px; }\n.h-\\[100vh\\] { height: 100vh; }\n.h-\\[104px\\] { height: 104px; }\n.h-\\[11px\\] { height: 11px; }\n.h-\\[120px\\] { height: 120px; }\n.h-\\[133px\\] { height: 133px; }\n.h-\\[134px\\] { height: 134px; }\n.h-\\[148px\\] { height: 148px; }\n.h-\\[14px\\] { height: 14px; }\n.h-\\[150px\\] { height: 150px; }\n.h-\\[160px\\] { height: 160px; }\n.h-\\[180px\\] { height: 180px; }\n.h-\\[18px\\] { height: 18px; }\n.h-\\[190px\\] { height: 190px; }\n.h-\\[1em\\] { height: 1em; }\n.h-\\[1px\\] { height: 1px; }\n.h-\\[200px\\] { height: 200px; }\n.h-\\[220px\\] { height: 220px; }\n.h-\\[22px\\] { height: 22px; }\n.h-\\[231px\\] { height: 231px; }\n.h-\\[240px\\] { height: 240px; }\n.h-\\[256px\\] { height: 256px; }\n.h-\\[25px\\] { height: 25px; }\n.h-\\[28px\\] { height: 28px; }\n.h-\\[300px\\] { height: 300px; }\n.h-\\[30px\\] { height: 30px; }\n.h-\\[32px\\] { height: 32px; }\n.h-\\[33px\\] { height: 33px; }\n.h-\\[34px\\] { height: 34px; }\n.h-\\[37px\\] { height: 37px; }\n.h-\\[38px\\] { height: 38px; }\n.h-\\[3px\\] { height: 3px; }\n.h-\\[400px\\] { height: 400px; }\n.h-\\[42px\\] { height: 42px; }\n.h-\\[44px\\] { height: 44px; }\n.h-\\[450px\\] { height: 450px; }\n.h-\\[452px\\] { height: 452px; }\n.h-\\[500px\\] { height: 500px; }\n.h-\\[50px\\] { height: 50px; }\n.h-\\[52px\\] { height: 52px; }\n.h-\\[55px\\] { height: 55px; }\n.h-\\[58px\\] { height: 58px; }\n.h-\\[600px\\] { height: 600px; }\n.h-\\[60px\\] { height: 60px; }\n.h-\\[630px\\] { height: 630px; }\n.h-\\[64px\\] { height: 64px; }\n.h-\\[650px\\] { height: 650px; }\n.h-\\[65px\\] { height: 65px; }\n.h-\\[65vh\\] { height: 65vh; }\n.h-\\[66px\\] { height: 66px; }\n.h-\\[680px\\] { height: 680px; }\n.h-\\[68px\\] { height: 68px; }\n.h-\\[70px\\] { height: 70px; }\n.h-\\[720px\\] { height: 720px; }\n.h-\\[80px\\] { height: 80px; }\n.h-\\[85vh\\] { height: 85vh; }\n.h-\\[86px\\] { height: 86px; }\n.h-\\[88px\\] { height: 88px; }\n.h-\\[96px\\] { height: 96px; }\n.h-\\[calc\\(100\\%-56px\\)\\] { height: calc(100% - 56px); }\n.h-\\[calc\\(100vh-56px\\)\\] { height: calc(-56px + 100vh); }\n.h-\\[calc\\(85vh-140px\\)\\] { height: calc(-140px + 85vh); }\n.h-auto { height: auto; }\n.h-fit { height: fit-content; }\n.h-full { height: 100%; }\n.h-px { height: 1px; }\n.h-screen { height: 100vh; }\n.max-h-32 { max-height: 8rem; }\n.max-h-40 { max-height: 10rem; }\n.max-h-60 { max-height: 15rem; }\n.max-h-\\[150px\\] { max-height: 150px; }\n.max-h-\\[172px\\] { max-height: 172px; }\n.max-h-\\[180px\\] { max-height: 180px; }\n.max-h-\\[200px\\] { max-height: 200px; }\n.max-h-\\[250px\\] { max-height: 250px; }\n.max-h-\\[270px\\] { max-height: 270px; }\n.max-h-\\[450px\\] { max-height: 450px; }\n.max-h-\\[480px\\] { max-height: 480px; }\n.max-h-\\[500px\\] { max-height: 500px; }\n.max-h-\\[580px\\] { max-height: 580px; }\n.max-h-\\[60vh\\] { max-height: 60vh; }\n.max-h-\\[65vh\\] { max-height: 65vh; }\n.max-h-\\[66px\\] { max-height: 66px; }\n.max-h-\\[70vh\\] { max-height: 70vh; }\n.max-h-\\[720px\\] { max-height: 720px; }\n.max-h-\\[80\\%\\] { max-height: 80%; }\n.max-h-\\[80vh\\] { max-height: 80vh; }\n.max-h-\\[85vh\\] { max-height: 85vh; }\n.max-h-\\[calc\\(100vh-120px\\)\\] { max-height: calc(-120px + 100vh); }\n.max-h-full { max-height: 100%; }\n.max-h-none { max-height: none; }\n.min-h-0 { min-height: 0px; }\n.min-h-12 { min-height: 3rem; }\n.min-h-40 { min-height: 10rem; }\n.min-h-7 { min-height: 1.75rem; }\n.min-h-\\[102px\\] { min-height: 102px; }\n.min-h-\\[160px\\] { min-height: 160px; }\n.min-h-\\[180px\\] { min-height: 180px; }\n.min-h-\\[200px\\] { min-height: 200px; }\n.min-h-\\[210px\\] { min-height: 210px; }\n.min-h-\\[228px\\] { min-height: 228px; }\n.min-h-\\[282px\\] { min-height: 282px; }\n.min-h-\\[2rem\\] { min-height: 2rem; }\n.min-h-\\[380px\\] { min-height: 380px; }\n.min-h-\\[40px\\] { min-height: 40px; }\n.min-h-\\[42px\\] { min-height: 42px; }\n.min-h-\\[450px\\] { min-height: 450px; }\n.min-h-\\[48px\\] { min-height: 48px; }\n.min-h-\\[500px\\] { min-height: 500px; }\n.min-h-\\[50vh\\] { min-height: 50vh; }\n.min-h-\\[56px\\] { min-height: 56px; }\n.min-h-\\[84px\\] { min-height: 84px; }\n.min-h-dvh { min-height: 100dvh; }\n.min-h-full { min-height: 100%; }\n.min-h-screen { min-height: 100vh; }\n.\\!w-10 { width: 2.5rem !important; }\n.\\!w-12 { width: 3rem !important; }\n.\\!w-3 { width: 0.75rem !important; }\n.\\!w-4 { width: 1rem !important; }\n.\\!w-\\[14px\\] { width: 14px !important; }\n.\\!w-\\[1px\\] { width: 1px !important; }\n.\\!w-\\[200px\\] { width: 200px !important; }\n.\\!w-\\[362px\\] { width: 362px !important; }\n.\\!w-\\[450px\\] { width: 450px !important; }\n.\\!w-\\[480px\\] { width: 480px !important; }\n.\\!w-\\[640px\\] { width: 640px !important; }\n.\\!w-\\[720px\\] { width: 720px !important; }\n.\\!w-\\[800px\\] { width: 800px !important; }\n.\\!w-\\[96px\\] { width: 96px !important; }\n.\\!w-full { width: 100% !important; }\n.\\!w-px { width: 1px !important; }\n.w-0 { width: 0px; }\n.w-1 { width: 0.25rem; }\n.w-1\\/2 { width: 50%; }\n.w-1\\/3 { width: 33.3333%; }\n.w-10 { width: 2.5rem; }\n.w-11 { width: 2.75rem; }\n.w-11\\/12 { width: 91.6667%; }\n.w-12 { width: 3rem; }\n.w-14 { width: 3.5rem; }\n.w-16 { width: 4rem; }\n.w-2 { width: 0.5rem; }\n.w-2\\.5 { width: 0.625rem; }\n.w-20 { width: 5rem; }\n.w-24 { width: 6rem; }\n.w-3 { width: 0.75rem; }\n.w-3\\.5 { width: 0.875rem; }\n.w-4 { width: 1rem; }\n.w-4\\/5 { width: 80%; }\n.w-40 { width: 10rem; }\n.w-48 { width: 12rem; }\n.w-5 { width: 1.25rem; }\n.w-56 { width: 14rem; }\n.w-6 { width: 1.5rem; }\n.w-60 { width: 15rem; }\n.w-64 { width: 16rem; }\n.w-7 { width: 1.75rem; }\n.w-8 { width: 2rem; }\n.w-80 { width: 20rem; }\n.w-9 { width: 2.25rem; }\n.w-96 { width: 24rem; }\n.w-\\[100px\\] { width: 100px; }\n.w-\\[104px\\] { width: 104px; }\n.w-\\[112px\\] { width: 112px; }\n.w-\\[11px\\] { width: 11px; }\n.w-\\[1200px\\] { width: 1200px; }\n.w-\\[120px\\] { width: 120px; }\n.w-\\[128px\\] { width: 128px; }\n.w-\\[130px\\] { width: 130px; }\n.w-\\[140px\\] { width: 140px; }\n.w-\\[144px\\] { width: 144px; }\n.w-\\[14px\\] { width: 14px; }\n.w-\\[150px\\] { width: 150px; }\n.w-\\[158px\\] { width: 158px; }\n.w-\\[164px\\] { width: 164px; }\n.w-\\[180px\\] { width: 180px; }\n.w-\\[18px\\] { width: 18px; }\n.w-\\[1em\\] { width: 1em; }\n.w-\\[1px\\] { width: 1px; }\n.w-\\[200px\\] { width: 200px; }\n.w-\\[210px\\] { width: 210px; }\n.w-\\[216px\\] { width: 216px; }\n.w-\\[22px\\] { width: 22px; }\n.w-\\[236px\\] { width: 236px; }\n.w-\\[240px\\] { width: 240px; }\n.w-\\[260px\\] { width: 260px; }\n.w-\\[261px\\] { width: 261px; }\n.w-\\[270px\\] { width: 270px; }\n.w-\\[280px\\] { width: 280px; }\n.w-\\[288px\\] { width: 288px; }\n.w-\\[300px\\] { width: 300px; }\n.w-\\[30px\\] { width: 30px; }\n.w-\\[320px\\] { width: 320px; }\n.w-\\[335px\\] { width: 335px; }\n.w-\\[350px\\] { width: 350px; }\n.w-\\[360px\\] { width: 360px; }\n.w-\\[376px\\] { width: 376px; }\n.w-\\[38px\\] { width: 38px; }\n.w-\\[400px\\] { width: 400px; }\n.w-\\[42\\%\\] { width: 42%; }\n.w-\\[420px\\] { width: 420px; }\n.w-\\[42px\\] { width: 42px; }\n.w-\\[44px\\] { width: 44px; }\n.w-\\[45px\\] { width: 45px; }\n.w-\\[472px\\] { width: 472px; }\n.w-\\[480px\\] { width: 480px; }\n.w-\\[488px\\] { width: 488px; }\n.w-\\[48px\\] { width: 48px; }\n.w-\\[500px\\] { width: 500px; }\n.w-\\[519px\\] { width: 519px; }\n.w-\\[576px\\] { width: 576px; }\n.w-\\[600px\\] { width: 600px; }\n.w-\\[616px\\] { width: 616px; }\n.w-\\[640px\\] { width: 640px; }\n.w-\\[68px\\] { width: 68px; }\n.w-\\[70px\\] { width: 70px; }\n.w-\\[800px\\] { width: 800px; }\n.w-\\[824px\\] { width: 824px; }\n.w-\\[840px\\] { width: 840px; }\n.w-\\[88px\\] { width: 88px; }\n.w-\\[920px\\] { width: 920px; }\n.w-\\[93px\\] { width: 93px; }\n.w-\\[94\\%\\] { width: 94%; }\n.w-\\[94px\\] { width: 94px; }\n.w-\\[96px\\] { width: 96px; }\n.w-\\[calc\\(100\\%-32px\\)\\] { width: calc(100% - 32px); }\n.w-auto { width: auto; }\n.w-fit { width: fit-content; }\n.w-full { width: 100%; }\n.w-max { width: max-content; }\n.w-screen { width: 100vw; }\n.min-w-0 { min-width: 0px; }\n.min-w-20 { min-width: 5rem; }\n.min-w-24 { min-width: 6rem; }\n.min-w-60 { min-width: 15rem; }\n.min-w-\\[112px\\] { min-width: 112px; }\n.min-w-\\[120px\\] { min-width: 120px; }\n.min-w-\\[130px\\] { min-width: 130px; }\n.min-w-\\[16px\\] { min-width: 16px; }\n.min-w-\\[18px\\] { min-width: 18px; }\n.min-w-\\[200px\\] { min-width: 200px; }\n.min-w-\\[20px\\] { min-width: 20px; }\n.min-w-\\[220px\\] { min-width: 220px; }\n.min-w-\\[228px\\] { min-width: 228px; }\n.min-w-\\[240px\\] { min-width: 240px; }\n.min-w-\\[280px\\] { min-width: 280px; }\n.min-w-\\[2rem\\] { min-width: 2rem; }\n.min-w-\\[300px\\] { min-width: 300px; }\n.min-w-\\[320px\\] { min-width: 320px; }\n.min-w-\\[44px\\] { min-width: 44px; }\n.min-w-\\[480px\\] { min-width: 480px; }\n.min-w-\\[500px\\] { min-width: 500px; }\n.min-w-\\[70px\\] { min-width: 70px; }\n.min-w-\\[8px\\] { min-width: 8px; }\n.min-w-fit { min-width: fit-content; }\n.min-w-full { min-width: 100%; }\n.min-w-max { min-width: max-content; }\n.min-w-min { min-width: min-content; }\n.\\!max-w-\\[480px\\] { max-width: 480px !important; }\n.\\!max-w-\\[640px\\] { max-width: 640px !important; }\n.\\!max-w-\\[720px\\] { max-width: 720px !important; }\n.\\!max-w-\\[800px\\] { max-width: 800px !important; }\n.\\!max-w-none { max-width: none !important; }\n.max-w-2xl { max-width: 42rem; }\n.max-w-4xl { max-width: 56rem; }\n.max-w-5xl { max-width: 64rem; }\n.max-w-6xl { max-width: 72rem; }\n.max-w-7xl { max-width: 80rem; }\n.max-w-80 { max-width: 20rem; }\n.max-w-\\[100\\%\\] { max-width: 100%; }\n.max-w-\\[120px\\] { max-width: 120px; }\n.max-w-\\[1440px\\] { max-width: 1440px; }\n.max-w-\\[146px\\] { max-width: 146px; }\n.max-w-\\[150px\\] { max-width: 150px; }\n.max-w-\\[160px\\] { max-width: 160px; }\n.max-w-\\[180px\\] { max-width: 180px; }\n.max-w-\\[200px\\] { max-width: 200px; }\n.max-w-\\[210px\\] { max-width: 210px; }\n.max-w-\\[220px\\] { max-width: 220px; }\n.max-w-\\[240px\\] { max-width: 240px; }\n.max-w-\\[280px\\] { max-width: 280px; }\n.max-w-\\[295px\\] { max-width: 295px; }\n.max-w-\\[300px\\] { max-width: 300px; }\n.max-w-\\[320px\\] { max-width: 320px; }\n.max-w-\\[33\\.3\\%\\] { max-width: 33.3%; }\n.max-w-\\[335px\\] { max-width: 335px; }\n.max-w-\\[360px\\] { max-width: 360px; }\n.max-w-\\[480px\\] { max-width: 480px; }\n.max-w-\\[50\\%\\] { max-width: 50%; }\n.max-w-\\[500px\\] { max-width: 500px; }\n.max-w-\\[520px\\] { max-width: 520px; }\n.max-w-\\[560px\\] { max-width: 560px; }\n.max-w-\\[576px\\] { max-width: 576px; }\n.max-w-\\[600px\\] { max-width: 600px; }\n.max-w-\\[64px\\] { max-width: 64px; }\n.max-w-\\[680px\\] { max-width: 680px; }\n.max-w-\\[70\\%\\] { max-width: 70%; }\n.max-w-\\[720px\\] { max-width: 720px; }\n.max-w-\\[80\\%\\] { max-width: 80%; }\n.max-w-\\[800px\\] { max-width: 800px; }\n.max-w-\\[85\\%\\] { max-width: 85%; }\n.max-w-\\[900px\\] { max-width: 900px; }\n.max-w-\\[90vw\\] { max-width: 90vw; }\n.max-w-\\[calc\\(100vw-200px\\)\\] { max-width: calc(-200px + 100vw); }\n.max-w-full { max-width: 100%; }\n.max-w-lg { max-width: 32rem; }\n.max-w-max { max-width: max-content; }\n.max-w-md { max-width: 28rem; }\n.max-w-none { max-width: none; }\n.max-w-sm { max-width: 24rem; }\n.max-w-xs { max-width: 20rem; }\n.flex-1 { flex: 1 1 0%; }\n.flex-\\[50\\%\\] { flex: 1 1 50%; }\n.flex-none { flex: 0 0 auto; }\n.flex-shrink { flex-shrink: 1; }\n.flex-shrink-0 { flex-shrink: 0; }\n.shrink { flex-shrink: 1; }\n.shrink-0 { flex-shrink: 0; }\n.flex-grow, .grow { flex-grow: 1; }\n.grow-0 { flex-grow: 0; }\n.basis-0 { flex-basis: 0px; }\n.basis-auto { flex-basis: auto; }\n.origin-top-right { transform-origin: right top; }\n.-translate-x-1\\/2 { --tw-translate-x: -50%; }\n.-translate-x-1\\/2, .-translate-x-2\\/3 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.-translate-x-2\\/3 { --tw-translate-x: -66.666667%; }\n.-translate-y-1\\/2 { --tw-translate-y: -50%; }\n.-translate-y-1\\/2, .-translate-y-full { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.-translate-y-full { --tw-translate-y: -100%; }\n.translate-x-0 { --tw-translate-x: 0px; }\n.translate-x-0, .translate-x-1\\/2 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.translate-x-1\\/2 { --tw-translate-x: 50%; }\n.translate-x-2 { --tw-translate-x: 0.5rem; }\n.translate-x-2, .translate-x-3 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.translate-x-3 { --tw-translate-x: 0.75rem; }\n.translate-x-4 { --tw-translate-x: 1rem; }\n.translate-x-4, .translate-x-5 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.translate-x-5 { --tw-translate-x: 1.25rem; }\n.translate-x-\\[-50\\%\\] { --tw-translate-x: -50%; }\n.translate-x-\\[-50\\%\\], .translate-x-\\[50\\%\\] { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.translate-x-\\[50\\%\\] { --tw-translate-x: 50%; }\n.translate-y-0 { --tw-translate-y: 0px; }\n.translate-y-0, .translate-y-\\[-50\\%\\] { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.translate-y-\\[-50\\%\\] { --tw-translate-y: -50%; }\n.translate-y-\\[3px\\] { --tw-translate-y: 3px; }\n.translate-y-\\[3px\\], .translate-y-full { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.translate-y-full { --tw-translate-y: 100%; }\n.-rotate-12 { --tw-rotate: -12deg; }\n.-rotate-12, .-rotate-45 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.-rotate-45 { --tw-rotate: -45deg; }\n.rotate-0 { --tw-rotate: 0deg; }\n.rotate-0, .rotate-12 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.rotate-12 { --tw-rotate: 12deg; }\n.rotate-180 { --tw-rotate: 180deg; }\n.rotate-180, .rotate-45 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.rotate-45 { --tw-rotate: 45deg; }\n.scale-100 { --tw-scale-x: 1; --tw-scale-y: 1; }\n.scale-100, .scale-95 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.scale-95 { --tw-scale-x: .95; --tw-scale-y: .95; }\n.scale-\\[0\\.4\\] { --tw-scale-x: 0.4; --tw-scale-y: 0.4; }\n.scale-\\[0\\.4\\], .transform { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n@keyframes pulse { \n  50% { opacity: 0.5; }\n}\n.animate-pulse { animation: 2s cubic-bezier(0.4, 0, 0.6, 1) 0s infinite normal none running pulse; }\n@keyframes spin { \n  100% { transform: rotate(1turn); }\n}\n.animate-spin { animation: 1s linear 0s infinite normal none running spin; }\n.\\!cursor-default { cursor: default !important; }\n.\\!cursor-not-allowed { cursor: not-allowed !important; }\n.cursor-default { cursor: default; }\n.cursor-grab { cursor: grab; }\n.cursor-not-allowed { cursor: not-allowed; }\n.cursor-pointer { cursor: pointer; }\n.cursor-row-resize { cursor: row-resize; }\n.select-none { user-select: none; }\n.select-auto { user-select: auto; }\n.resize-none { resize: none; }\n.resize { resize: both; }\n.appearance-none { appearance: none; }\n.grid-cols-1 { grid-template-columns: repeat(1, minmax(0px, 1fr)); }\n.grid-cols-12 { grid-template-columns: repeat(12, minmax(0px, 1fr)); }\n.grid-cols-2 { grid-template-columns: repeat(2, minmax(0px, 1fr)); }\n.grid-cols-3 { grid-template-columns: repeat(3, minmax(0px, 1fr)); }\n.grid-cols-8 { grid-template-columns: repeat(8, minmax(0px, 1fr)); }\n.flex-row { flex-direction: row; }\n.flex-row-reverse { flex-direction: row-reverse; }\n.flex-col { flex-direction: column; }\n.flex-col-reverse { flex-direction: column-reverse; }\n.\\!flex-wrap { flex-wrap: wrap !important; }\n.flex-wrap { flex-wrap: wrap; }\n.flex-nowrap { flex-wrap: nowrap; }\n.content-start { align-content: flex-start; }\n.items-start { align-items: flex-start; }\n.items-end { align-items: flex-end; }\n.items-center { align-items: center; }\n.items-baseline { align-items: baseline; }\n.items-stretch { align-items: stretch; }\n.justify-start { justify-content: flex-start; }\n.justify-end { justify-content: flex-end; }\n.\\!justify-center { justify-content: center !important; }\n.justify-center { justify-content: center; }\n.justify-between { justify-content: space-between; }\n.gap-0 { gap: 0px; }\n.gap-0\\.5 { gap: 0.125rem; }\n.gap-1 { gap: 0.25rem; }\n.gap-1\\.5 { gap: 0.375rem; }\n.gap-2 { gap: 0.5rem; }\n.gap-2\\.5 { gap: 0.625rem; }\n.gap-3 { gap: 0.75rem; }\n.gap-4 { gap: 1rem; }\n.gap-5 { gap: 1.25rem; }\n.gap-6 { gap: 1.5rem; }\n.gap-8 { gap: 2rem; }\n.gap-\\[10px\\] { gap: 10px; }\n.gap-\\[2px\\] { gap: 2px; }\n.gap-\\[50px\\] { gap: 50px; }\n.gap-\\[5px\\] { gap: 5px; }\n.gap-\\[6px\\] { gap: 6px; }\n.gap-x-1 { column-gap: 0.25rem; }\n.gap-x-2 { column-gap: 0.5rem; }\n.gap-y-1 { row-gap: 0.25rem; }\n.gap-y-2 { row-gap: 0.5rem; }\n.gap-y-4 { row-gap: 1rem; }\n.space-x-0\\.5 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(.125rem * var(--tw-space-x-reverse)); margin-left: calc(.125rem * calc(1 - var(--tw-space-x-reverse))); }\n.space-x-1 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(.25rem * var(--tw-space-x-reverse)); margin-left: calc(.25rem * calc(1 - var(--tw-space-x-reverse))); }\n.space-x-2 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(.5rem * var(--tw-space-x-reverse)); margin-left: calc(.5rem * calc(1 - var(--tw-space-x-reverse))); }\n.space-x-3 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(.75rem * var(--tw-space-x-reverse)); margin-left: calc(.75rem * calc(1 - var(--tw-space-x-reverse))); }\n.space-x-4 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(1rem * var(--tw-space-x-reverse)); margin-left: calc(1rem * calc(1 - var(--tw-space-x-reverse))); }\n.space-x-6 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(1.5rem * var(--tw-space-x-reverse)); margin-left: calc(1.5rem * calc(1 - var(--tw-space-x-reverse))); }\n.space-x-8 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(2rem * var(--tw-space-x-reverse)); margin-left: calc(2rem * calc(1 - var(--tw-space-x-reverse))); }\n.space-y-1 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(.25rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(.25rem * var(--tw-space-y-reverse)); }\n.space-y-2 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(.5rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(.5rem * var(--tw-space-y-reverse)); }\n.space-y-3 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(.75rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(.75rem * var(--tw-space-y-reverse)); }\n.space-y-4 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(1rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(1rem * var(--tw-space-y-reverse)); }\n.space-y-5 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(1.25rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(1.25rem * var(--tw-space-y-reverse)); }\n.space-y-6 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(1.5rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(1.5rem * var(--tw-space-y-reverse)); }\n.space-y-8 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(2rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(2rem * var(--tw-space-y-reverse)); }\n.space-y-\\[30px\\] > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(30px * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(30px * var(--tw-space-y-reverse)); }\n.divide-y > :not([hidden]) ~ :not([hidden]) { --tw-divide-y-reverse: 0; border-top-width: calc(1px * calc(1 - var(--tw-divide-y-reverse))); border-bottom-width: calc(1px * var(--tw-divide-y-reverse)); }\n.divide-gray-100 > :not([hidden]) ~ :not([hidden]) { --tw-divide-opacity: 1; border-color: rgb(243 244 246/var(--tw-divide-opacity,1)); }\n.self-start { align-self: flex-start; }\n.self-end { align-self: flex-end; }\n.overflow-auto { overflow: auto; }\n.\\!overflow-hidden { overflow: hidden !important; }\n.overflow-hidden { overflow: hidden; }\n.overflow-visible { overflow: visible; }\n.overflow-x-auto { overflow-x: auto; }\n.overflow-y-auto { overflow-y: auto; }\n.overflow-x-hidden { overflow-x: hidden; }\n.overflow-y-hidden { overflow-y: hidden; }\n.overflow-y-scroll { overflow-y: scroll; }\n.truncate { overflow: hidden; white-space: nowrap; }\n.overflow-ellipsis, .text-ellipsis, .truncate { text-overflow: ellipsis; }\n.whitespace-normal { white-space: normal; }\n.\\!whitespace-nowrap { white-space: nowrap !important; }\n.whitespace-nowrap { white-space: nowrap; }\n.whitespace-pre-line { white-space: pre-line; }\n.whitespace-pre-wrap { white-space: pre-wrap; }\n.break-words { overflow-wrap: break-word; }\n.break-all { word-break: break-all; }\n.\\!rounded-2xl { border-radius: 1rem !important; }\n.rounded { border-radius: 0.25rem; }\n.rounded-2xl { border-radius: 1rem; }\n.rounded-\\[0\\.25rem\\] { border-radius: 0.25rem; }\n.rounded-\\[10\\.5px\\] { border-radius: 10.5px; }\n.rounded-\\[10px\\] { border-radius: 10px; }\n.rounded-\\[12px\\] { border-radius: 12px; }\n.rounded-\\[20px\\] { border-radius: 20px; }\n.rounded-\\[32px\\] { border-radius: 32px; }\n.rounded-\\[36px\\] { border-radius: 36px; }\n.rounded-\\[3px\\] { border-radius: 3px; }\n.rounded-\\[5px\\] { border-radius: 5px; }\n.rounded-\\[6px\\] { border-radius: 6px; }\n.rounded-\\[7px\\] { border-radius: 7px; }\n.rounded-full { border-radius: 9999px; }\n.rounded-lg { border-radius: var(--radius); }\n.rounded-md { border-radius: calc(var(--radius) - 2px); }\n.rounded-none { border-radius: 0px; }\n.rounded-sm { border-radius: calc(var(--radius) - 4px); }\n.rounded-xl { border-radius: 0.75rem; }\n.rounded-b-2xl { border-bottom-right-radius: 1rem; border-bottom-left-radius: 1rem; }\n.rounded-b-lg { border-bottom-right-radius: var(--radius); border-bottom-left-radius: var(--radius); }\n.rounded-b-xl { border-bottom-right-radius: 0.75rem; border-bottom-left-radius: 0.75rem; }\n.rounded-l-none { border-top-left-radius: 0px; border-bottom-left-radius: 0px; }\n.rounded-r-md { border-top-right-radius: calc(var(--radius) - 2px); border-bottom-right-radius: calc(var(--radius) - 2px); }\n.rounded-r-none { border-top-right-radius: 0px; border-bottom-right-radius: 0px; }\n.rounded-t-2xl { border-top-left-radius: 1rem; border-top-right-radius: 1rem; }\n.rounded-t-lg { border-top-left-radius: var(--radius); border-top-right-radius: var(--radius); }\n.rounded-t-xl { border-top-left-radius: 0.75rem; border-top-right-radius: 0.75rem; }\n.rounded-bl-lg { border-bottom-left-radius: var(--radius); }\n.rounded-bl-md { border-bottom-left-radius: calc(var(--radius) - 2px); }\n.rounded-bl-xl { border-bottom-left-radius: 0.75rem; }\n.rounded-br-lg { border-bottom-right-radius: var(--radius); }\n.rounded-se-xl { border-start-end-radius: 0.75rem; }\n.rounded-tl-2xl { border-top-left-radius: 1rem; }\n.rounded-tl-lg { border-top-left-radius: var(--radius); }\n.rounded-tl-xl { border-top-left-radius: 0.75rem; }\n.rounded-tr-2xl { border-top-right-radius: 1rem; }\n.rounded-tr-lg { border-top-right-radius: var(--radius); }\n.rounded-tr-md { border-top-right-radius: calc(var(--radius) - 2px); }\n.rounded-tr-xl { border-top-right-radius: 0.75rem; }\n.\\!border-0 { border-width: 0px !important; }\n.\\!border-2 { border-width: 2px !important; }\n.\\!border-\\[0\\.5px\\] { border-width: 0.5px !important; }\n.border { border-width: 1px; }\n.border-0 { border-width: 0px; }\n.border-2 { border-width: 2px; }\n.border-4 { border-width: 4px; }\n.border-\\[0\\.5px\\] { border-width: 0.5px; }\n.border-\\[1\\.5px\\] { border-width: 1.5px; }\n.border-\\[1px\\] { border-width: 1px; }\n.border-\\[2px\\] { border-width: 2px; }\n.border-\\[3px\\] { border-width: 3px; }\n.border-\\[5px\\] { border-width: 5px; }\n.border-b { border-bottom-width: 1px; }\n.border-b-0 { border-bottom-width: 0px; }\n.border-b-2 { border-bottom-width: 2px; }\n.border-b-\\[0\\.5px\\] { border-bottom-width: 0.5px; }\n.border-b-\\[4px\\] { border-bottom-width: 4px; }\n.border-l { border-left-width: 1px; }\n.border-l-2 { border-left-width: 2px; }\n.border-l-\\[3px\\] { border-left-width: 3px; }\n.border-r { border-right-width: 1px; }\n.border-r-\\[3px\\] { border-right-width: 3px; }\n.border-t { border-top-width: 1px; }\n.border-t-\\[0\\.5px\\] { border-top-width: 0.5px; }\n.border-solid { border-style: solid; }\n.\\!border-dashed { border-style: dashed !important; }\n.border-dashed { border-style: dashed; }\n.border-none { border-style: none; }\n.\\!border-\\[\\#9B8AFB\\] { --tw-border-opacity: 1 !important; border-color: rgb(155 138 251/var(--tw-border-opacity,1)) !important; }\n.\\!border-\\[\\#F670C7\\] { --tw-border-opacity: 1 !important; border-color: rgb(246 112 199/var(--tw-border-opacity,1)) !important; }\n.\\!border-\\[\\#FD853A\\] { --tw-border-opacity: 1 !important; border-color: rgb(253 133 58/var(--tw-border-opacity,1)) !important; }\n.\\!border-\\[rgba\\(0\\,0\\,0\\,0\\.05\\)\\], .\\!border-black\\/5 { border-color: rgba(0, 0, 0, 0.05) !important; }\n.\\!border-gray-200 { --tw-border-opacity: 1 !important; border-color: rgb(229 231 235/var(--tw-border-opacity,1)) !important; }\n.\\!border-gray-300 { --tw-border-opacity: 1 !important; border-color: rgb(209 213 219/var(--tw-border-opacity,1)) !important; }\n.\\!border-indigo-100 { --tw-border-opacity: 1 !important; border-color: rgb(224 234 255/var(--tw-border-opacity,1)) !important; }\n.\\!border-primary-200 { --tw-border-opacity: 1 !important; border-color: rgb(153 140 143/var(--tw-border-opacity,1)) !important; }\n.\\!border-purple-200 { --tw-border-opacity: 1 !important; border-color: rgb(220 215 254/var(--tw-border-opacity,1)) !important; }\n.border-\\[\\#0BA5EC\\] { --tw-border-opacity: 1; border-color: rgb(11 165 236/var(--tw-border-opacity,1)); }\n.border-\\[\\#0E9F6E\\] { --tw-border-opacity: 1; border-color: rgb(14 159 110/var(--tw-border-opacity,1)); }\n.border-\\[\\#155eef\\] { --tw-border-opacity: 1; border-color: rgb(21 94 239/var(--tw-border-opacity,1)); }\n.border-\\[\\#1E88E5\\] { --tw-border-opacity: 1; border-color: rgb(30 136 229/var(--tw-border-opacity,1)); }\n.border-\\[\\#2D0DEE\\] { --tw-border-opacity: 1; border-color: rgb(45 13 238/var(--tw-border-opacity,1)); }\n.border-\\[\\#98A2B3\\] { --tw-border-opacity: 1; border-color: rgb(152 162 179/var(--tw-border-opacity,1)); }\n.border-\\[\\#C05041\\] { --tw-border-opacity: 1; border-color: rgb(192 80 65/var(--tw-border-opacity,1)); }\n.border-\\[\\#D03801\\] { --tw-border-opacity: 1; border-color: rgb(208 56 1/var(--tw-border-opacity,1)); }\n.border-\\[\\#D1D1D1\\] { --tw-border-opacity: 1; border-color: rgb(209 209 209/var(--tw-border-opacity,1)); }\n.border-\\[\\#D7D7D7\\] { --tw-border-opacity: 1; border-color: rgb(215 215 215/var(--tw-border-opacity,1)); }\n.border-\\[\\#D92D20\\] { --tw-border-opacity: 1; border-color: rgb(217 45 32/var(--tw-border-opacity,1)); }\n.border-\\[\\#DC6803\\] { --tw-border-opacity: 1; border-color: rgb(220 104 3/var(--tw-border-opacity,1)); }\n.border-\\[\\#DFDFDF\\] { --tw-border-opacity: 1; border-color: rgb(223 223 223/var(--tw-border-opacity,1)); }\n.border-\\[\\#E0F2FE\\] { --tw-border-opacity: 1; border-color: rgb(224 242 254/var(--tw-border-opacity,1)); }\n.border-\\[\\#EAECF0\\] { --tw-border-opacity: 1; border-color: rgb(234 236 240/var(--tw-border-opacity,1)); }\n.border-\\[\\#EAECF5\\] { --tw-border-opacity: 1; border-color: rgb(234 236 245/var(--tw-border-opacity,1)); }\n.border-\\[\\#F2F2F2\\] { --tw-border-opacity: 1; border-color: rgb(242 242 242/var(--tw-border-opacity,1)); }\n.border-\\[\\#F79009\\] { --tw-border-opacity: 1; border-color: rgb(247 144 9/var(--tw-border-opacity,1)); }\n.border-\\[\\#FEF0C7\\] { --tw-border-opacity: 1; border-color: rgb(254 240 199/var(--tw-border-opacity,1)); }\n.border-\\[\\#d1d1d1\\] { --tw-border-opacity: 1; border-color: rgb(209 209 209/var(--tw-border-opacity,1)); }\n.border-\\[\\#fefefe\\] { --tw-border-opacity: 1; border-color: rgb(254 254 254/var(--tw-border-opacity,1)); }\n.border-\\[rgba\\(0\\,0\\,0\\,0\\.02\\)\\] { border-color: rgba(0, 0, 0, 0.02); }\n.border-\\[rgba\\(0\\,0\\,0\\,0\\.05\\)\\] { border-color: rgba(0, 0, 0, 0.05); }\n.border-\\[var\\(--primary-color\\)\\] { border-color: var(--primary-color); }\n.border-black\\/5 { border-color: rgba(0, 0, 0, 0.05); }\n.border-black\\/\\[0\\.02\\] { border-color: rgba(0, 0, 0, 0.02); }\n.border-black\\/\\[0\\.08\\] { border-color: rgba(0, 0, 0, 0.08); }\n.border-blue-100 { --tw-border-opacity: 1; border-color: rgb(185 218 247/var(--tw-border-opacity,1)); }\n.border-blue-200 { --tw-border-opacity: 1; border-color: rgb(153 140 143/var(--tw-border-opacity,1)); }\n.border-blue-500 { --tw-border-opacity: 1; border-color: rgb(30 136 229/var(--tw-border-opacity,1)); }\n.border-current { border-color: currentcolor; }\n.border-gray-100 { --tw-border-opacity: 1; border-color: rgb(243 244 246/var(--tw-border-opacity,1)); }\n.border-gray-200 { --tw-border-opacity: 1; border-color: rgb(229 231 235/var(--tw-border-opacity,1)); }\n.border-gray-300 { --tw-border-opacity: 1; border-color: rgb(209 213 219/var(--tw-border-opacity,1)); }\n.border-gray-400 { --tw-border-opacity: 1; border-color: rgb(156 163 175/var(--tw-border-opacity,1)); }\n.border-gray-50 { --tw-border-opacity: 1; border-color: rgb(249 250 251/var(--tw-border-opacity,1)); }\n.border-gray-500 { --tw-border-opacity: 1; border-color: rgb(107 114 128/var(--tw-border-opacity,1)); }\n.border-green-200 { --tw-border-opacity: 1; border-color: rgb(219 245 232/var(--tw-border-opacity,1)); }\n.border-green-400 { --tw-border-opacity: 1; border-color: rgb(13 186 102/var(--tw-border-opacity,1)); }\n.border-green-500 { --tw-border-opacity: 1; border-color: rgb(12 167 92/var(--tw-border-opacity,1)); }\n.border-grey-200 { --tw-border-opacity: 1; border-color: rgb(246 246 247/var(--tw-border-opacity,1)); }\n.border-grey-300 { --tw-border-opacity: 1; border-color: rgb(242 242 242/var(--tw-border-opacity,1)); }\n.border-grey-400 { --tw-border-opacity: 1; border-color: rgb(223 223 223/var(--tw-border-opacity,1)); }\n.border-indigo-100 { --tw-border-opacity: 1; border-color: rgb(224 234 255/var(--tw-border-opacity,1)); }\n.border-indigo-600 { --tw-border-opacity: 1; border-color: rgb(68 76 231/var(--tw-border-opacity,1)); }\n.border-orange-300 { --tw-border-opacity: 1; border-color: rgb(253 186 116/var(--tw-border-opacity,1)); }\n.border-orange-500 { --tw-border-opacity: 1; border-color: rgb(255 127 63/var(--tw-border-opacity,1)); }\n.border-pink-300 { --tw-border-opacity: 1; border-color: rgb(249 168 212/var(--tw-border-opacity,1)); }\n.border-primary-100 { --tw-border-opacity: 1; border-color: rgb(185 218 247/var(--tw-border-opacity,1)); }\n.border-primary-400 { --tw-border-opacity: 1; border-color: rgb(75 160 234/var(--tw-border-opacity,1)); }\n.border-primary-500 { --tw-border-opacity: 1; border-color: rgb(30 136 229/var(--tw-border-opacity,1)); }\n.border-primary-600 { --tw-border-opacity: 1; border-color: rgb(27 124 208/var(--tw-border-opacity,1)); }\n.border-primary-700 { --tw-border-opacity: 1; border-color: rgb(21 97 163/var(--tw-border-opacity,1)); }\n.border-red-200 { --tw-border-opacity: 1; border-color: rgb(248 169 169/var(--tw-border-opacity,1)); }\n.border-red-300 { --tw-border-opacity: 1; border-color: rgb(244 130 130/var(--tw-border-opacity,1)); }\n.border-red-500 { --tw-border-opacity: 1; border-color: rgb(239 68 68/var(--tw-border-opacity,1)); }\n.border-red-700 { --tw-border-opacity: 1; border-color: rgb(170 48 48/var(--tw-border-opacity,1)); }\n.border-slate-200 { --tw-border-opacity: 1; border-color: rgb(226 232 240/var(--tw-border-opacity,1)); }\n.border-slate-300 { --tw-border-opacity: 1; border-color: rgb(203 213 225/var(--tw-border-opacity,1)); }\n.border-transparent { border-color: transparent; }\n.border-white { --tw-border-opacity: 1; border-color: rgb(255 255 255/var(--tw-border-opacity,1)); }\n.border-yellow-200 { --tw-border-opacity: 1; border-color: rgb(251 239 213/var(--tw-border-opacity,1)); }\n.border-yellow-600 { --tw-border-opacity: 1; border-color: rgb(240 188 82/var(--tw-border-opacity,1)); }\n.border-yellow-700 { --tw-border-opacity: 1; border-color: rgb(204 160 70/var(--tw-border-opacity,1)); }\n.border-b-\\[\\#FEF0C7\\] { --tw-border-opacity: 1; border-bottom-color: rgb(254 240 199/var(--tw-border-opacity,1)); }\n.border-b-black\\/5 { border-bottom-color: rgba(0, 0, 0, 0.05); }\n.border-b-gray-100 { --tw-border-opacity: 1; border-bottom-color: rgb(243 244 246/var(--tw-border-opacity,1)); }\n.border-b-gray-200 { --tw-border-opacity: 1; border-bottom-color: rgb(229 231 235/var(--tw-border-opacity,1)); }\n.border-b-grey-300 { --tw-border-opacity: 1; border-bottom-color: rgb(242 242 242/var(--tw-border-opacity,1)); }\n.border-b-primary-500 { --tw-border-opacity: 1; border-bottom-color: rgb(30 136 229/var(--tw-border-opacity,1)); }\n.border-l-transparent { border-left-color: transparent; }\n.border-r-transparent { border-right-color: transparent; }\n.border-t-black\\/5 { border-top-color: rgba(0, 0, 0, 0.05); }\n.border-t-gray-100 { --tw-border-opacity: 1; border-top-color: rgb(243 244 246/var(--tw-border-opacity,1)); }\n.\\!bg-\\[\\#D92D20\\] { --tw-bg-opacity: 1 !important; background-color: rgb(217 45 32/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-\\[\\#FFFAEB\\] { --tw-bg-opacity: 1 !important; background-color: rgb(255 250 235/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-gray-100 { --tw-bg-opacity: 1 !important; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-gray-200 { --tw-bg-opacity: 1 !important; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-gray-25 { --tw-bg-opacity: 1 !important; background-color: rgb(252 252 253/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-gray-300 { --tw-bg-opacity: 1 !important; background-color: rgb(209 213 219/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-gray-400 { --tw-bg-opacity: 1 !important; background-color: rgb(156 163 175/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-gray-50 { --tw-bg-opacity: 1 !important; background-color: rgb(249 250 251/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-indigo-25 { --tw-bg-opacity: 1 !important; background-color: rgb(245 248 255/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-primary-100 { --tw-bg-opacity: 1 !important; background-color: rgb(185 218 247/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-purple-50 { --tw-bg-opacity: 1 !important; background-color: rgb(246 245 255/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-transparent { background-color: transparent !important; }\n.\\!bg-white { --tw-bg-opacity: 1 !important; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)) !important; }\n.\\!bg-white\\/80 { background-color: rgba(255, 255, 255, 0.8) !important; }\n.bg-\\[\\#155EEF\\] { --tw-bg-opacity: 1; background-color: rgb(21 94 239/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#1E88E5\\] { --tw-bg-opacity: 1; background-color: rgb(30 136 229/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#1E88E5\\]\\/10 { background-color: rgba(30, 136, 229, 0.1); }\n.bg-\\[\\#232426\\] { --tw-bg-opacity: 1; background-color: rgb(35 36 38/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#2970FF\\] { --tw-bg-opacity: 1; background-color: rgb(41 112 255/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#31C48D\\] { --tw-bg-opacity: 1; background-color: rgb(49 196 141/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#36BFFA\\] { --tw-bg-opacity: 1; background-color: rgb(54 191 250/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#6938EF\\] { --tw-bg-opacity: 1; background-color: rgb(105 56 239/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#D0D5DD\\] { --tw-bg-opacity: 1; background-color: rgb(208 213 221/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#D1E9FF80\\] { background-color: rgba(209, 233, 255, 0.5); }\n.bg-\\[\\#D5F5F6\\] { --tw-bg-opacity: 1; background-color: rgb(213 245 246/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#DD2590\\] { --tw-bg-opacity: 1; background-color: rgb(221 37 144/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#E0F2FE\\] { --tw-bg-opacity: 1; background-color: rgb(224 242 254/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#E9F3FC\\] { --tw-bg-opacity: 1; background-color: rgb(233 243 252/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#EBE9FE\\] { --tw-bg-opacity: 1; background-color: rgb(235 233 254/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#EEF4FF\\] { --tw-bg-opacity: 1; background-color: rgb(238 244 255/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#EFF4FF\\] { --tw-bg-opacity: 1; background-color: rgb(239 244 255/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F04438\\] { --tw-bg-opacity: 1; background-color: rgb(240 68 56/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F1CBCB\\] { --tw-bg-opacity: 1; background-color: rgb(241 203 203/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F2F2F2\\] { --tw-bg-opacity: 1; background-color: rgb(242 242 242/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F2F2F2\\]\\/80 { background-color: rgba(242, 242, 242, 0.8); }\n.bg-\\[\\#F3F4F6\\] { --tw-bg-opacity: 1; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F4F3FF\\] { --tw-bg-opacity: 1; background-color: rgb(244 243 255/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F5F3FF\\] { --tw-bg-opacity: 1; background-color: rgb(245 243 255/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F5F8FF\\] { --tw-bg-opacity: 1; background-color: rgb(245 248 255/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F6F6F7\\] { --tw-bg-opacity: 1; background-color: rgb(246 246 247/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F79009\\] { --tw-bg-opacity: 1; background-color: rgb(247 144 9/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#F8F8F8\\] { --tw-bg-opacity: 1; background-color: rgb(248 248 248/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FCE7F6\\] { --tw-bg-opacity: 1; background-color: rgb(252 231 246/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FDB022\\] { --tw-bg-opacity: 1; background-color: rgb(253 176 34/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FDF2FA\\] { --tw-bg-opacity: 1; background-color: rgb(253 242 250/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FDFDFD\\] { --tw-bg-opacity: 1; background-color: rgb(253 253 253/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FEE4E2\\] { --tw-bg-opacity: 1; background-color: rgb(254 228 226/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FEF0C7\\] { --tw-bg-opacity: 1; background-color: rgb(254 240 199/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FEF3EE\\] { --tw-bg-opacity: 1; background-color: rgb(254 243 238/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FEF3F2\\] { --tw-bg-opacity: 1; background-color: rgb(254 243 242/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FF00000D\\] { background-color: rgba(255, 0, 0, 0.05); }\n.bg-\\[\\#FF5A1F\\] { --tw-bg-opacity: 1; background-color: rgb(255 90 31/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FF7F3F\\] { --tw-bg-opacity: 1; background-color: rgb(255 127 63/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FFF6ED\\] { --tw-bg-opacity: 1; background-color: rgb(255 246 237/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FFFAEB\\] { --tw-bg-opacity: 1; background-color: rgb(255 250 235/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#FFFFFF66\\] { background-color: rgba(255, 255, 255, 0.4); }\n.bg-\\[\\#c9e1e9\\] { --tw-bg-opacity: 1; background-color: rgb(201 225 233/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#d5f5f6\\] { --tw-bg-opacity: 1; background-color: rgb(213 245 246/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#eeeeeecc\\] { background-color: rgba(238, 238, 238, 0.8); }\n.bg-\\[\\#f9b8a7\\] { --tw-bg-opacity: 1; background-color: rgb(249 184 167/var(--tw-bg-opacity,1)); }\n.bg-\\[\\#fff\\] { --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); }\n.bg-\\[rgba\\(119\\,119\\,119\\,0\\.7\\)\\] { background-color: rgba(120, 120, 120, 0.7); }\n.bg-\\[rgba\\(250\\,250\\,252\\,0\\.3\\)\\] { background-color: rgba(250, 250, 252, 0.3); }\n.bg-\\[var\\(--background-Main-Normal\\)\\] { background-color: var(--background-Main-Normal); }\n.bg-\\[var\\(--background-main\\)\\] { background-color: var(--background-main); }\n.bg-\\[var\\(--error-color\\)\\] { background-color: var(--error-color); }\n.bg-\\[var\\(--primary-color\\)\\] { background-color: var(--primary-color); }\n.bg-\\[var\\(--primary-color-light\\)\\] { background-color: var(--primary-color-light); }\n.bg-black { --tw-bg-opacity: 1; background-color: rgb(0 0 0/var(--tw-bg-opacity,1)); }\n.bg-black\\/20 { background-color: rgba(0, 0, 0, 0.2); }\n.bg-black\\/30 { background-color: rgba(0, 0, 0, 0.3); }\n.bg-black\\/5 { background-color: rgba(0, 0, 0, 0.05); }\n.bg-black\\/50 { background-color: rgba(0, 0, 0, 0.5); }\n.bg-black\\/60 { background-color: rgba(0, 0, 0, 0.6); }\n.bg-black\\/70 { background-color: rgba(0, 0, 0, 0.7); }\n.bg-black\\/80 { background-color: rgba(0, 0, 0, 0.8); }\n.bg-black\\/\\[\\.25\\] { background-color: rgba(0, 0, 0, 0.25); }\n.bg-black\\/\\[0\\.16\\] { background-color: rgba(0, 0, 0, 0.16); }\n.bg-blue-100 { --tw-bg-opacity: 1; background-color: rgb(185 218 247/var(--tw-bg-opacity,1)); }\n.bg-blue-50 { --tw-bg-opacity: 1; background-color: rgb(233 243 252/var(--tw-bg-opacity,1)); }\n.bg-blue-500 { --tw-bg-opacity: 1; background-color: rgb(30 136 229/var(--tw-bg-opacity,1)); }\n.bg-blue-600 { --tw-bg-opacity: 1; background-color: rgb(27 124 208/var(--tw-bg-opacity,1)); }\n.bg-gray-100 { --tw-bg-opacity: 1; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)); }\n.bg-gray-100\\/90 { background-color: rgba(243, 244, 246, 0.9); }\n.bg-gray-200 { --tw-bg-opacity: 1; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)); }\n.bg-gray-25 { --tw-bg-opacity: 1; background-color: rgb(252 252 253/var(--tw-bg-opacity,1)); }\n.bg-gray-300 { --tw-bg-opacity: 1; background-color: rgb(209 213 219/var(--tw-bg-opacity,1)); }\n.bg-gray-400 { --tw-bg-opacity: 1; background-color: rgb(156 163 175/var(--tw-bg-opacity,1)); }\n.bg-gray-50 { --tw-bg-opacity: 1; background-color: rgb(249 250 251/var(--tw-bg-opacity,1)); }\n.bg-gray-500 { --tw-bg-opacity: 1; background-color: rgb(107 114 128/var(--tw-bg-opacity,1)); }\n.bg-gray-600 { --tw-bg-opacity: 1; background-color: rgb(75 85 99/var(--tw-bg-opacity,1)); }\n.bg-green-100 { --tw-bg-opacity: 1; background-color: rgb(231 248 240/var(--tw-bg-opacity,1)); }\n.bg-green-50 { --tw-bg-opacity: 1; background-color: rgb(240 253 244/var(--tw-bg-opacity,1)); }\n.bg-grey-100 { --tw-bg-opacity: 1; background-color: rgb(253 253 253/var(--tw-bg-opacity,1)); }\n.bg-grey-200 { --tw-bg-opacity: 1; background-color: rgb(246 246 247/var(--tw-bg-opacity,1)); }\n.bg-grey-300 { --tw-bg-opacity: 1; background-color: rgb(242 242 242/var(--tw-bg-opacity,1)); }\n.bg-grey-500 { --tw-bg-opacity: 1; background-color: rgb(202 202 202/var(--tw-bg-opacity,1)); }\n.bg-indigo-100 { --tw-bg-opacity: 1; background-color: rgb(224 234 255/var(--tw-bg-opacity,1)); }\n.bg-indigo-25 { --tw-bg-opacity: 1; background-color: rgb(245 248 255/var(--tw-bg-opacity,1)); }\n.bg-indigo-50 { --tw-bg-opacity: 1; background-color: rgb(238 244 255/var(--tw-bg-opacity,1)); }\n.bg-neutral-800\\/60 { background-color: rgba(38, 38, 38, 0.6); }\n.bg-orange-50 { --tw-bg-opacity: 1; background-color: rgb(255 247 237/var(--tw-bg-opacity,1)); }\n.bg-orange-500 { --tw-bg-opacity: 1; background-color: rgb(255 127 63/var(--tw-bg-opacity,1)); }\n.bg-pink-500 { --tw-bg-opacity: 1; background-color: rgb(236 72 153/var(--tw-bg-opacity,1)); }\n.bg-primary-100 { --tw-bg-opacity: 1; background-color: rgb(185 218 247/var(--tw-bg-opacity,1)); }\n.bg-primary-300\\/50 { background-color: rgba(104, 175, 239, 0.5); }\n.bg-primary-50 { --tw-bg-opacity: 1; background-color: rgb(233 243 252/var(--tw-bg-opacity,1)); }\n.bg-primary-500 { --tw-bg-opacity: 1; background-color: rgb(30 136 229/var(--tw-bg-opacity,1)); }\n.bg-primary-600 { --tw-bg-opacity: 1; background-color: rgb(27 124 208/var(--tw-bg-opacity,1)); }\n.bg-primary-700 { --tw-bg-opacity: 1; background-color: rgb(21 97 163/var(--tw-bg-opacity,1)); }\n.bg-purple-50 { --tw-bg-opacity: 1; background-color: rgb(246 245 255/var(--tw-bg-opacity,1)); }\n.bg-red-100 { --tw-bg-opacity: 1; background-color: rgb(250 197 197/var(--tw-bg-opacity,1)); }\n.bg-red-50 { --tw-bg-opacity: 1; background-color: rgb(253 236 236/var(--tw-bg-opacity,1)); }\n.bg-red-500 { --tw-bg-opacity: 1; background-color: rgb(239 68 68/var(--tw-bg-opacity,1)); }\n.bg-red-600 { --tw-bg-opacity: 1; background-color: rgb(217 62 62/var(--tw-bg-opacity,1)); }\n.bg-slate-100 { --tw-bg-opacity: 1; background-color: rgb(241 245 249/var(--tw-bg-opacity,1)); }\n.bg-transparent { background-color: transparent; }\n.bg-white { --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); }\n.bg-white\\/30 { background-color: rgba(255, 255, 255, 0.3); }\n.bg-white\\/50 { background-color: rgba(255, 255, 255, 0.5); }\n.bg-white\\/60 { background-color: rgba(255, 255, 255, 0.6); }\n.bg-white\\/80 { background-color: rgba(255, 255, 255, 0.8); }\n.bg-white\\/90 { background-color: rgba(255, 255, 255, 0.9); }\n.bg-white\\/\\[\\.98\\] { background-color: rgba(255, 255, 255, 0.98); }\n.bg-white\\/\\[0\\.08\\] { background-color: rgba(255, 255, 255, 0.08); }\n.bg-white\\/\\[0\\.3\\] { background-color: rgba(255, 255, 255, 0.3); }\n.bg-white\\/\\[0\\.48\\] { background-color: rgba(255, 255, 255, 0.48); }\n.bg-yellow-100 { --tw-bg-opacity: 1; background-color: rgb(254 248 238/var(--tw-bg-opacity,1)); }\n.bg-yellow-400 { --tw-bg-opacity: 1; background-color: rgb(246 213 146/var(--tw-bg-opacity,1)); }\n.bg-yellow-50 { --tw-bg-opacity: 1; background-color: rgb(254 252 232/var(--tw-bg-opacity,1)); }\n.bg-yellow-500 { --tw-bg-opacity: 1; background-color: rgb(243 200 113/var(--tw-bg-opacity,1)); }\n.bg-opacity-0 { --tw-bg-opacity: 0; }\n.bg-opacity-25 { --tw-bg-opacity: 0.25; }\n.bg-opacity-30 { --tw-bg-opacity: 0.3; }\n.bg-opacity-50 { --tw-bg-opacity: 0.5; }\n.bg-opacity-70 { --tw-bg-opacity: 0.7; }\n.bg-\\[linear-gradient\\(268\\.74deg\\,\\#FFE7DA_37\\.21\\%\\,\\#C64D10_57\\.26\\%\\)\\] { background-image: linear-gradient(268.74deg, rgb(255, 231, 218) 37.21%, rgb(198, 77, 16) 57.26%); }\n.bg-gradient-to-b { background-image: linear-gradient(to bottom,var(--tw-gradient-stops)); }\n.bg-gradient-to-l { background-image: linear-gradient(to left,var(--tw-gradient-stops)); }\n.bg-gradient-to-r { background-image: linear-gradient(to right,var(--tw-gradient-stops)); }\n.bg-gradient-to-t { background-image: linear-gradient(to top,var(--tw-gradient-stops)); }\n.from-\\[\\#F3F4F6\\], .from-\\[\\#f3f4f6\\] { --tw-gradient-from: #f3f4f6 var(--tw-gradient-from-position); --tw-gradient-to: rgba(243,244,246,0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),var(--tw-gradient-to); }\n.from-black\\/35 { --tw-gradient-from: rgba(0,0,0,.35) var(--tw-gradient-from-position); --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),var(--tw-gradient-to); }\n.from-white { --tw-gradient-from: #fff var(--tw-gradient-from-position); --tw-gradient-to: hsla(0,0%,100%,0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),var(--tw-gradient-to); }\n.from-white\\/80 { --tw-gradient-from: hsla(0,0%,100%,.8) var(--tw-gradient-from-position); --tw-gradient-to: hsla(0,0%,100%,0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),var(--tw-gradient-to); }\n.from-yellow-300 { --tw-gradient-from: #f9e2b5 var(--tw-gradient-from-position); --tw-gradient-to: hsla(40,85%,84%,0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),var(--tw-gradient-to); }\n.via-black\\/5 { --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),rgba(0,0,0,.05) var(--tw-gradient-via-position),var(--tw-gradient-to); }\n.via-white { --tw-gradient-to: hsla(0,0%,100%,0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),#fff var(--tw-gradient-via-position),var(--tw-gradient-to); }\n.via-yellow-400 { --tw-gradient-to: hsla(40,85%,77%,0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from),#f6d592 var(--tw-gradient-via-position),var(--tw-gradient-to); }\n.to-transparent { --tw-gradient-to: transparent var(--tw-gradient-to-position); }\n.to-white { --tw-gradient-to: #fff var(--tw-gradient-to-position); }\n.to-yellow-500 { --tw-gradient-to: #f3c871 var(--tw-gradient-to-position); }\n.bg-contain { background-size: contain; }\n.bg-cover { background-size: cover; }\n.bg-clip-text { background-clip: text; }\n.bg-center { background-position: 50% center; }\n.bg-repeat { background-repeat: repeat; }\n.bg-no-repeat { background-repeat: no-repeat; }\n.fill-current { fill: currentcolor; }\n.fill-grey-600 { fill: rgb(159, 159, 160); }\n.stroke-current { stroke: currentcolor; }\n.stroke-0 { stroke-width: 0; }\n.stroke-2 { stroke-width: 2; }\n.object-contain { object-fit: contain; }\n.object-cover { object-fit: cover; }\n.\\!p-0 { padding: 0px !important; }\n.\\!p-8 { padding: 2rem !important; }\n.p-0 { padding: 0px; }\n.p-0\\.5 { padding: 0.125rem; }\n.p-1 { padding: 0.25rem; }\n.p-1\\.5 { padding: 0.375rem; }\n.p-12 { padding: 3rem; }\n.p-2 { padding: 0.5rem; }\n.p-2\\.5 { padding: 0.625rem; }\n.p-3 { padding: 0.75rem; }\n.p-4 { padding: 1rem; }\n.p-5 { padding: 1.25rem; }\n.p-6 { padding: 1.5rem; }\n.p-7 { padding: 1.75rem; }\n.p-8 { padding: 2rem; }\n.p-\\[1px\\] { padding: 1px; }\n.p-\\[5\\.5px\\] { padding: 5.5px; }\n.p-\\[6px\\] { padding: 6px; }\n.\\!px-0 { padding-left: 0px !important; padding-right: 0px !important; }\n.\\!px-2 { padding-left: 0.5rem !important; padding-right: 0.5rem !important; }\n.\\!px-3 { padding-left: 0.75rem !important; padding-right: 0.75rem !important; }\n.\\!px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }\n.\\!px-6 { padding-left: 1.5rem !important; padding-right: 1.5rem !important; }\n.\\!py-0 { padding-top: 0px !important; padding-bottom: 0px !important; }\n.\\!py-3 { padding-top: 0.75rem !important; padding-bottom: 0.75rem !important; }\n.\\!py-\\[7px\\] { padding-top: 7px !important; padding-bottom: 7px !important; }\n.px-0 { padding-left: 0px; padding-right: 0px; }\n.px-0\\.5 { padding-left: 0.125rem; padding-right: 0.125rem; }\n.px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }\n.px-1\\.5 { padding-left: 0.375rem; padding-right: 0.375rem; }\n.px-10 { padding-left: 2.5rem; padding-right: 2.5rem; }\n.px-12 { padding-left: 3rem; padding-right: 3rem; }\n.px-14 { padding-left: 3.5rem; padding-right: 3.5rem; }\n.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }\n.px-2\\.5 { padding-left: 0.625rem; padding-right: 0.625rem; }\n.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }\n.px-3\\.5 { padding-left: 0.875rem; padding-right: 0.875rem; }\n.px-4 { padding-left: 1rem; padding-right: 1rem; }\n.px-5 { padding-left: 1.25rem; padding-right: 1.25rem; }\n.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }\n.px-7 { padding-left: 1.75rem; padding-right: 1.75rem; }\n.px-8 { padding-left: 2rem; padding-right: 2rem; }\n.px-\\[10px\\] { padding-left: 10px; padding-right: 10px; }\n.px-\\[14px\\] { padding-left: 14px; padding-right: 14px; }\n.px-\\[1px\\] { padding-left: 1px; padding-right: 1px; }\n.px-\\[20px\\] { padding-left: 20px; padding-right: 20px; }\n.px-\\[5px\\] { padding-left: 5px; padding-right: 5px; }\n.px-\\[6px\\] { padding-left: 6px; padding-right: 6px; }\n.px-\\[7px\\] { padding-left: 7px; padding-right: 7px; }\n.py-0 { padding-top: 0px; padding-bottom: 0px; }\n.py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; }\n.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }\n.py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }\n.py-10 { padding-top: 2.5rem; padding-bottom: 2.5rem; }\n.py-12 { padding-top: 3rem; padding-bottom: 3rem; }\n.py-16 { padding-top: 4rem; padding-bottom: 4rem; }\n.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }\n.py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }\n.py-24 { padding-top: 6rem; padding-bottom: 6rem; }\n.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }\n.py-4 { padding-top: 1rem; padding-bottom: 1rem; }\n.py-5 { padding-top: 1.25rem; padding-bottom: 1.25rem; }\n.py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; }\n.py-8 { padding-top: 2rem; padding-bottom: 2rem; }\n.py-\\[10px\\] { padding-top: 10px; padding-bottom: 10px; }\n.py-\\[14px\\] { padding-top: 14px; padding-bottom: 14px; }\n.py-\\[1px\\] { padding-top: 1px; padding-bottom: 1px; }\n.py-\\[2px\\] { padding-top: 2px; padding-bottom: 2px; }\n.py-\\[3px\\] { padding-top: 3px; padding-bottom: 3px; }\n.py-\\[5px\\] { padding-top: 5px; padding-bottom: 5px; }\n.py-\\[6px\\] { padding-top: 6px; padding-bottom: 6px; }\n.py-\\[7px\\] { padding-top: 7px; padding-bottom: 7px; }\n.py-\\[9px\\] { padding-top: 9px; padding-bottom: 9px; }\n.py-px { padding-top: 1px; padding-bottom: 1px; }\n.\\!pb-0 { padding-bottom: 0px !important; }\n.\\!pb-6 { padding-bottom: 1.5rem !important; }\n.\\!pl-0 { padding-left: 0px !important; }\n.\\!pl-7 { padding-left: 1.75rem !important; }\n.pb-0 { padding-bottom: 0px; }\n.pb-0\\.5 { padding-bottom: 0.125rem; }\n.pb-1 { padding-bottom: 0.25rem; }\n.pb-1\\.5 { padding-bottom: 0.375rem; }\n.pb-10 { padding-bottom: 2.5rem; }\n.pb-16 { padding-bottom: 4rem; }\n.pb-2 { padding-bottom: 0.5rem; }\n.pb-2\\.5 { padding-bottom: 0.625rem; }\n.pb-20 { padding-bottom: 5rem; }\n.pb-24 { padding-bottom: 6rem; }\n.pb-3 { padding-bottom: 0.75rem; }\n.pb-4 { padding-bottom: 1rem; }\n.pb-5 { padding-bottom: 1.25rem; }\n.pb-6 { padding-bottom: 1.5rem; }\n.pb-7 { padding-bottom: 1.75rem; }\n.pb-8 { padding-bottom: 2rem; }\n.pb-\\[10px\\] { padding-bottom: 10px; }\n.pb-\\[3px\\] { padding-bottom: 3px; }\n.pb-\\[50px\\] { padding-bottom: 50px; }\n.pb-\\[72px\\] { padding-bottom: 72px; }\n.pl-1 { padding-left: 0.25rem; }\n.pl-1\\.5 { padding-left: 0.375rem; }\n.pl-10 { padding-left: 2.5rem; }\n.pl-12 { padding-left: 3rem; }\n.pl-2 { padding-left: 0.5rem; }\n.pl-2\\.5 { padding-left: 0.625rem; }\n.pl-3 { padding-left: 0.75rem; }\n.pl-4 { padding-left: 1rem; }\n.pl-6 { padding-left: 1.5rem; }\n.pl-7 { padding-left: 1.75rem; }\n.pl-8 { padding-left: 2rem; }\n.pl-\\[10px\\] { padding-left: 10px; }\n.pl-\\[136px\\] { padding-left: 136px; }\n.pl-\\[14\\.5px\\] { padding-left: 14.5px; }\n.pl-\\[14px\\] { padding-left: 14px; }\n.pl-\\[21px\\] { padding-left: 21px; }\n.pl-\\[3\\%\\] { padding-left: 3%; }\n.pl-\\[52px\\] { padding-left: 52px; }\n.pl-\\[6px\\] { padding-left: 6px; }\n.pr-0\\.5 { padding-right: 0.125rem; }\n.pr-1 { padding-right: 0.25rem; }\n.pr-1\\.5 { padding-right: 0.375rem; }\n.pr-10 { padding-right: 2.5rem; }\n.pr-2 { padding-right: 0.5rem; }\n.pr-2\\.5 { padding-right: 0.625rem; }\n.pr-3 { padding-right: 0.75rem; }\n.pr-4 { padding-right: 1rem; }\n.pr-5 { padding-right: 1.25rem; }\n.pr-6 { padding-right: 1.5rem; }\n.pr-8 { padding-right: 2rem; }\n.pr-9 { padding-right: 2.25rem; }\n.pr-\\[100px\\] { padding-right: 100px; }\n.pr-\\[10px\\] { padding-right: 10px; }\n.pr-\\[118px\\] { padding-right: 118px; }\n.pr-\\[11px\\] { padding-right: 11px; }\n.pr-\\[30px\\] { padding-right: 30px; }\n.pr-\\[3px\\] { padding-right: 3px; }\n.pr-\\[6\\.5px\\] { padding-right: 6.5px; }\n.pr-\\[6px\\] { padding-right: 6px; }\n.pr-\\[70px\\] { padding-right: 70px; }\n.pr-\\[7px\\] { padding-right: 7px; }\n.pt-0 { padding-top: 0px; }\n.pt-1 { padding-top: 0.25rem; }\n.pt-1\\.5 { padding-top: 0.375rem; }\n.pt-10 { padding-top: 2.5rem; }\n.pt-14 { padding-top: 3.5rem; }\n.pt-16 { padding-top: 4rem; }\n.pt-2 { padding-top: 0.5rem; }\n.pt-2\\.5 { padding-top: 0.625rem; }\n.pt-24 { padding-top: 6rem; }\n.pt-3 { padding-top: 0.75rem; }\n.pt-4 { padding-top: 1rem; }\n.pt-48 { padding-top: 12rem; }\n.pt-5 { padding-top: 1.25rem; }\n.pt-6 { padding-top: 1.5rem; }\n.pt-8 { padding-top: 2rem; }\n.pt-9 { padding-top: 2.25rem; }\n.pt-\\[14px\\] { padding-top: 14px; }\n.pt-\\[56px\\] { padding-top: 56px; }\n.pt-\\[5px\\] { padding-top: 5px; }\n.pt-\\[60px\\] { padding-top: 60px; }\n.text-left { text-align: left; }\n.text-center { text-align: center; }\n.text-right { text-align: right; }\n.text-start { text-align: start; }\n.align-middle { vertical-align: middle; }\n.align-text-bottom { vertical-align: text-bottom; }\n.align-\\[-0\\.125em\\] { vertical-align: -0.125em; }\n.font-\\[\\'PingFang_SC\\'\\] { font-family: \"PingFang SC\"; }\n.font-sans { font-family: ui-sans-serif, system-ui, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\"; }\n.\\!text-\\[13px\\] { font-size: 13px !important; }\n.\\!text-sm { font-size: 0.875rem !important; line-height: 1.25rem !important; }\n.\\!text-xs { font-size: 0.75rem !important; line-height: 1rem !important; }\n.text-2xl { font-size: 1.5rem; line-height: 2rem; }\n.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }\n.text-4xl { font-size: 2.25rem; line-height: 2.5rem; }\n.text-5xl { font-size: 3rem; line-height: 1; }\n.text-\\[0\\] { font-size: 0px; }\n.text-\\[10px\\] { font-size: 10px; }\n.text-\\[11px\\] { font-size: 11px; }\n.text-\\[12px\\] { font-size: 12px; }\n.text-\\[13px\\] { font-size: 13px; }\n.text-\\[14px\\] { font-size: 14px; }\n.text-\\[15px\\] { font-size: 15px; }\n.text-\\[16px\\] { font-size: 16px; }\n.text-\\[19px\\] { font-size: 19px; }\n.text-\\[21px\\] { font-size: 21px; }\n.text-\\[22px\\] { font-size: 22px; }\n.text-\\[24px\\] { font-size: 24px; }\n.text-\\[30px\\] { font-size: 30px; }\n.text-\\[32px\\] { font-size: 32px; }\n.text-\\[36px\\] { font-size: 36px; }\n.text-\\[39px\\] { font-size: 39px; }\n.text-\\[56px\\] { font-size: 56px; }\n.text-\\[8px\\] { font-size: 8px; }\n.text-\\[9px\\] { font-size: 9px; }\n.text-base { font-size: 1rem; line-height: 1.5rem; }\n.text-lg { font-size: 1.125rem; line-height: 1.75rem; }\n.text-sm { font-size: 0.875rem; line-height: 1.25rem; }\n.text-xl { font-size: 1.25rem; line-height: 1.75rem; }\n.text-xs { font-size: 0.75rem; line-height: 1rem; }\n.\\!font-normal { font-weight: 400 !important; }\n.font-black { font-weight: 900; }\n.font-bold { font-weight: 700; }\n.font-extrabold { font-weight: 800; }\n.font-light { font-weight: 300; }\n.font-medium { font-weight: 500; }\n.font-normal { font-weight: 400; }\n.font-semibold { font-weight: 600; }\n.uppercase { text-transform: uppercase; }\n.capitalize { text-transform: capitalize; }\n.italic { font-style: italic; }\n.leading-10 { line-height: 2.5rem; }\n.leading-3 { line-height: 0.75rem; }\n.leading-4 { line-height: 1rem; }\n.leading-5 { line-height: 1.25rem; }\n.leading-6 { line-height: 1.5rem; }\n.leading-7 { line-height: 1.75rem; }\n.leading-8 { line-height: 2rem; }\n.leading-9 { line-height: 2.25rem; }\n.leading-\\[1\\.1rem\\] { line-height: 1.1rem; }\n.leading-\\[1\\.4em\\] { line-height: 1.4em; }\n.leading-\\[14px\\] { line-height: 14px; }\n.leading-\\[18px\\] { line-height: 18px; }\n.leading-\\[20px\\] { line-height: 20px; }\n.leading-\\[21px\\] { line-height: 21px; }\n.leading-\\[30px\\] { line-height: 30px; }\n.leading-\\[50px\\] { line-height: 50px; }\n.leading-none { line-height: 1; }\n.leading-normal { line-height: 1.5; }\n.leading-relaxed { line-height: 1.625; }\n.leading-snug { line-height: 1.375; }\n.tracking-wide { letter-spacing: 0.025em; }\n.tracking-wider { letter-spacing: 0.05em; }\n.tracking-widest { letter-spacing: 0.1em; }\n.\\!text-\\[\\#F04438\\] { --tw-text-opacity: 1 !important; color: rgb(240 68 56/var(--tw-text-opacity,1)) !important; }\n.\\!text-gray-400 { --tw-text-opacity: 1 !important; color: rgb(156 163 175/var(--tw-text-opacity,1)) !important; }\n.\\!text-gray-500 { --tw-text-opacity: 1 !important; color: rgb(107 114 128/var(--tw-text-opacity,1)) !important; }\n.\\!text-gray-700 { --tw-text-opacity: 1 !important; color: rgb(55 65 81/var(--tw-text-opacity,1)) !important; }\n.\\!text-red-700 { --tw-text-opacity: 1 !important; color: rgb(170 48 48/var(--tw-text-opacity,1)) !important; }\n.\\!text-white { --tw-text-opacity: 1 !important; color: rgb(255 255 255/var(--tw-text-opacity,1)) !important; }\n.text-\\[\\#0057D8\\] { --tw-text-opacity: 1; color: rgb(0 87 216/var(--tw-text-opacity,1)); }\n.text-\\[\\#00A286\\] { --tw-text-opacity: 1; color: rgb(0 162 134/var(--tw-text-opacity,1)); }\n.text-\\[\\#026AA2\\] { --tw-text-opacity: 1; color: rgb(2 106 162/var(--tw-text-opacity,1)); }\n.text-\\[\\#039855\\] { --tw-text-opacity: 1; color: rgb(3 152 85/var(--tw-text-opacity,1)); }\n.text-\\[\\#06AED4\\] { --tw-text-opacity: 1; color: rgb(6 174 212/var(--tw-text-opacity,1)); }\n.text-\\[\\#0E9384\\] { --tw-text-opacity: 1; color: rgb(14 147 132/var(--tw-text-opacity,1)); }\n.text-\\[\\#101828\\] { --tw-text-opacity: 1; color: rgb(16 24 40/var(--tw-text-opacity,1)); }\n.text-\\[\\#107569\\] { --tw-text-opacity: 1; color: rgb(16 117 105/var(--tw-text-opacity,1)); }\n.text-\\[\\#12B76A\\] { --tw-text-opacity: 1; color: rgb(18 183 106/var(--tw-text-opacity,1)); }\n.text-\\[\\#155EEF\\] { --tw-text-opacity: 1; color: rgb(21 94 239/var(--tw-text-opacity,1)); }\n.text-\\[\\#1570EF\\] { --tw-text-opacity: 1; color: rgb(21 112 239/var(--tw-text-opacity,1)); }\n.text-\\[\\#1C64F2\\] { --tw-text-opacity: 1; color: rgb(28 100 242/var(--tw-text-opacity,1)); }\n.text-\\[\\#1D2939\\] { --tw-text-opacity: 1; color: rgb(29 41 57/var(--tw-text-opacity,1)); }\n.text-\\[\\#1E88E5\\], .text-\\[\\#1e88e5\\] { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.text-\\[\\#292A2B\\] { --tw-text-opacity: 1; color: rgb(41 42 43/var(--tw-text-opacity,1)); }\n.text-\\[\\#2970FF\\] { --tw-text-opacity: 1; color: rgb(41 112 255/var(--tw-text-opacity,1)); }\n.text-\\[\\#2D31A6\\] { --tw-text-opacity: 1; color: rgb(45 49 166/var(--tw-text-opacity,1)); }\n.text-\\[\\#444CE7\\] { --tw-text-opacity: 1; color: rgb(68 76 231/var(--tw-text-opacity,1)); }\n.text-\\[\\#666\\] { --tw-text-opacity: 1; color: rgb(102 102 102/var(--tw-text-opacity,1)); }\n.text-\\[\\#667085\\] { --tw-text-opacity: 1; color: rgb(102 112 133/var(--tw-text-opacity,1)); }\n.text-\\[\\#6938EF\\] { --tw-text-opacity: 1; color: rgb(105 56 239/var(--tw-text-opacity,1)); }\n.text-\\[\\#6B7280\\], .text-\\[\\#6b7280\\] { --tw-text-opacity: 1; color: rgb(107 114 128/var(--tw-text-opacity,1)); }\n.text-\\[\\#7839EE\\] { --tw-text-opacity: 1; color: rgb(120 57 238/var(--tw-text-opacity,1)); }\n.text-\\[\\#98A2B3\\] { --tw-text-opacity: 1; color: rgb(152 162 179/var(--tw-text-opacity,1)); }\n.text-\\[\\#9F9FA0\\] { --tw-text-opacity: 1; color: rgb(159 159 160/var(--tw-text-opacity,1)); }\n.text-\\[\\#AA3030\\] { --tw-text-opacity: 1; color: rgb(170 48 48/var(--tw-text-opacity,1)); }\n.text-\\[\\#C05041\\] { --tw-text-opacity: 1; color: rgb(192 80 65/var(--tw-text-opacity,1)); }\n.text-\\[\\#D92D20\\] { --tw-text-opacity: 1; color: rgb(217 45 32/var(--tw-text-opacity,1)); }\n.text-\\[\\#DC6803\\] { --tw-text-opacity: 1; color: rgb(220 104 3/var(--tw-text-opacity,1)); }\n.text-\\[\\#DD2590\\] { --tw-text-opacity: 1; color: rgb(221 37 144/var(--tw-text-opacity,1)); }\n.text-\\[\\#EBF5FF\\] { --tw-text-opacity: 1; color: rgb(235 245 255/var(--tw-text-opacity,1)); }\n.text-\\[\\#EC4A0A\\] { --tw-text-opacity: 1; color: rgb(236 74 10/var(--tw-text-opacity,1)); }\n.text-\\[\\#F04438\\] { --tw-text-opacity: 1; color: rgb(240 68 56/var(--tw-text-opacity,1)); }\n.text-\\[\\#F79009\\] { --tw-text-opacity: 1; color: rgb(247 144 9/var(--tw-text-opacity,1)); }\n.text-\\[\\#FD4377\\] { --tw-text-opacity: 1; color: rgb(253 67 119/var(--tw-text-opacity,1)); }\n.text-\\[\\#FD853A\\] { --tw-text-opacity: 1; color: rgb(253 133 58/var(--tw-text-opacity,1)); }\n.text-\\[\\#FDFDFD\\] { --tw-text-opacity: 1; color: rgb(253 253 253/var(--tw-text-opacity,1)); }\n.text-\\[\\#FF7F3F\\] { --tw-text-opacity: 1; color: rgb(255 127 63/var(--tw-text-opacity,1)); }\n.text-\\[\\#f79009\\] { --tw-text-opacity: 1; color: rgb(247 144 9/var(--tw-text-opacity,1)); }\n.text-\\[\\#ff8a00\\] { --tw-text-opacity: 1; color: rgb(255 138 0/var(--tw-text-opacity,1)); }\n.text-\\[rgb\\(247\\,144\\,9\\)\\] { --tw-text-opacity: 1; color: rgb(247 144 9/var(--tw-text-opacity,1)); }\n.text-\\[var\\(--error-color\\)\\] { color: var(--error-color); }\n.text-\\[var\\(--info-color\\)\\] { color: var(--info-color); }\n.text-\\[var\\(--primary-color\\)\\] { color: var(--primary-color); }\n.text-\\[var\\(--text-Secondary\\)\\] { color: var(--text-Secondary); }\n.text-\\[var\\(--text-disabled\\)\\] { color: var(--text-disabled); }\n.text-\\[var\\(--text-primary\\)\\] { color: var(--text-primary); }\n.text-\\[var\\(--text-secondary\\)\\] { color: var(--text-secondary); }\n.text-amber-500 { --tw-text-opacity: 1; color: rgb(245 158 11/var(--tw-text-opacity,1)); }\n.text-amber-600 { --tw-text-opacity: 1; color: rgb(217 119 6/var(--tw-text-opacity,1)); }\n.text-black { --tw-text-opacity: 1; color: rgb(0 0 0/var(--tw-text-opacity,1)); }\n.text-black\\/\\[48\\] { color: rgb(0, 0, 0); }\n.text-blue-400 { --tw-text-opacity: 1; color: rgb(75 160 234/var(--tw-text-opacity,1)); }\n.text-blue-500 { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.text-blue-600 { --tw-text-opacity: 1; color: rgb(27 124 208/var(--tw-text-opacity,1)); }\n.text-blue-700 { --tw-text-opacity: 1; color: rgb(21 97 163/var(--tw-text-opacity,1)); }\n.text-blue-800 { --tw-text-opacity: 1; color: rgb(17 75 126/var(--tw-text-opacity,1)); }\n.text-gray-100\\/90 { color: rgba(243, 244, 246, 0.9); }\n.text-gray-200 { --tw-text-opacity: 1; color: rgb(229 231 235/var(--tw-text-opacity,1)); }\n.text-gray-300 { --tw-text-opacity: 1; color: rgb(209 213 219/var(--tw-text-opacity,1)); }\n.text-gray-400 { --tw-text-opacity: 1; color: rgb(156 163 175/var(--tw-text-opacity,1)); }\n.text-gray-500 { --tw-text-opacity: 1; color: rgb(107 114 128/var(--tw-text-opacity,1)); }\n.text-gray-600 { --tw-text-opacity: 1; color: rgb(75 85 99/var(--tw-text-opacity,1)); }\n.text-gray-700 { --tw-text-opacity: 1; color: rgb(55 65 81/var(--tw-text-opacity,1)); }\n.text-gray-800 { --tw-text-opacity: 1; color: rgb(31 42 55/var(--tw-text-opacity,1)); }\n.text-gray-900 { --tw-text-opacity: 1; color: rgb(17 25 40/var(--tw-text-opacity,1)); }\n.text-green-400 { --tw-text-opacity: 1; color: rgb(13 186 102/var(--tw-text-opacity,1)); }\n.text-green-500 { --tw-text-opacity: 1; color: rgb(12 167 92/var(--tw-text-opacity,1)); }\n.text-green-600 { --tw-text-opacity: 1; color: rgb(10 149 82/var(--tw-text-opacity,1)); }\n.text-green-700 { --tw-text-opacity: 1; color: rgb(10 140 77/var(--tw-text-opacity,1)); }\n.text-green-800 { --tw-text-opacity: 1; color: rgb(8 112 61/var(--tw-text-opacity,1)); }\n.text-grey-1200 { --tw-text-opacity: 1; color: rgb(41 42 43/var(--tw-text-opacity,1)); }\n.text-grey-200 { --tw-text-opacity: 1; color: rgb(246 246 247/var(--tw-text-opacity,1)); }\n.text-grey-400 { --tw-text-opacity: 1; color: rgb(223 223 223/var(--tw-text-opacity,1)); }\n.text-grey-500 { --tw-text-opacity: 1; color: rgb(202 202 202/var(--tw-text-opacity,1)); }\n.text-grey-600 { --tw-text-opacity: 1; color: rgb(159 159 160/var(--tw-text-opacity,1)); }\n.text-grey-900 { --tw-text-opacity: 1; color: rgb(73 74 75/var(--tw-text-opacity,1)); }\n.text-indigo-400 { --tw-text-opacity: 1; color: rgb(128 152 249/var(--tw-text-opacity,1)); }\n.text-indigo-600 { --tw-text-opacity: 1; color: rgb(68 76 231/var(--tw-text-opacity,1)); }\n.text-indigo-800 { --tw-text-opacity: 1; color: rgb(45 49 166/var(--tw-text-opacity,1)); }\n.text-input { color: hsl(var(--input)); }\n.text-neutral-400 { --tw-text-opacity: 1; color: rgb(163 163 163/var(--tw-text-opacity,1)); }\n.text-orange-500 { --tw-text-opacity: 1; color: rgb(255 127 63/var(--tw-text-opacity,1)); }\n.text-primary-500 { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.text-primary-600 { --tw-text-opacity: 1; color: rgb(27 124 208/var(--tw-text-opacity,1)); }\n.text-primary-700 { --tw-text-opacity: 1; color: rgb(21 97 163/var(--tw-text-opacity,1)); }\n.text-purple-500 { --tw-text-opacity: 1; color: rgb(168 85 247/var(--tw-text-opacity,1)); }\n.text-purple-600 { --tw-text-opacity: 1; color: rgb(147 51 234/var(--tw-text-opacity,1)); }\n.text-purple-700 { --tw-text-opacity: 1; color: rgb(126 34 206/var(--tw-text-opacity,1)); }\n.text-red-300 { --tw-text-opacity: 1; color: rgb(244 130 130/var(--tw-text-opacity,1)); }\n.text-red-400 { --tw-text-opacity: 1; color: rgb(242 105 105/var(--tw-text-opacity,1)); }\n.text-red-500 { --tw-text-opacity: 1; color: rgb(239 68 68/var(--tw-text-opacity,1)); }\n.text-red-600 { --tw-text-opacity: 1; color: rgb(217 62 62/var(--tw-text-opacity,1)); }\n.text-red-800 { --tw-text-opacity: 1; color: rgb(131 37 37/var(--tw-text-opacity,1)); }\n.text-sky-500 { --tw-text-opacity: 1; color: rgb(14 165 233/var(--tw-text-opacity,1)); }\n.text-sky-600 { --tw-text-opacity: 1; color: rgb(2 132 199/var(--tw-text-opacity,1)); }\n.text-slate-500 { --tw-text-opacity: 1; color: rgb(100 116 139/var(--tw-text-opacity,1)); }\n.text-slate-600 { --tw-text-opacity: 1; color: rgb(71 85 105/var(--tw-text-opacity,1)); }\n.text-slate-700 { --tw-text-opacity: 1; color: rgb(51 65 85/var(--tw-text-opacity,1)); }\n.text-slate-800 { --tw-text-opacity: 1; color: rgb(30 41 59/var(--tw-text-opacity,1)); }\n.text-slate-900 { --tw-text-opacity: 1; color: rgb(15 23 42/var(--tw-text-opacity,1)); }\n.text-transparent { color: transparent; }\n.text-white { --tw-text-opacity: 1; color: rgb(255 255 255/var(--tw-text-opacity,1)); }\n.text-white\\/70 { color: rgba(255, 255, 255, 0.7); }\n.text-white\\/90 { color: rgba(255, 255, 255, 0.9); }\n.text-yellow-200 { --tw-text-opacity: 1; color: rgb(251 239 213/var(--tw-text-opacity,1)); }\n.text-yellow-400 { --tw-text-opacity: 1; color: rgb(246 213 146/var(--tw-text-opacity,1)); }\n.text-yellow-500 { --tw-text-opacity: 1; color: rgb(243 200 113/var(--tw-text-opacity,1)); }\n.text-yellow-600 { --tw-text-opacity: 1; color: rgb(240 188 82/var(--tw-text-opacity,1)); }\n.text-yellow-800 { --tw-text-opacity: 1; color: rgb(170 133 58/var(--tw-text-opacity,1)); }\n.text-zinc-800 { --tw-text-opacity: 1; color: rgb(39 39 42/var(--tw-text-opacity,1)); }\n.underline { text-decoration-line: underline; }\n.line-through { text-decoration-line: line-through; }\n.antialiased { -webkit-font-smoothing: antialiased; }\n.placeholder-gray-400::placeholder { --tw-placeholder-opacity: 1; color: rgb(156 163 175/var(--tw-placeholder-opacity,1)); }\n.caret-blue-600, .caret-primary-600 { caret-color: rgb(27, 124, 208); }\n.\\!opacity-100 { opacity: 1 !important; }\n.\\!opacity-50 { opacity: 0.5 !important; }\n.opacity-0 { opacity: 0; }\n.opacity-10 { opacity: 0.1; }\n.opacity-100 { opacity: 1; }\n.opacity-25 { opacity: 0.25; }\n.opacity-30 { opacity: 0.3; }\n.opacity-5 { opacity: 0.05; }\n.opacity-50 { opacity: 0.5; }\n.opacity-60 { opacity: 0.6; }\n.opacity-80 { opacity: 0.8; }\n.opacity-90 { opacity: 0.9; }\n.mix-blend-lighten { mix-blend-mode: lighten; }\n.\\!shadow-lg { --tw-shadow: 0px 4px 6px -2px rgba(16,24,40,.03),0px 12px 16px -4px rgba(16,24,40,.08) !important; --tw-shadow-colored: 0px 4px 6px -2px var(--tw-shadow-color),0px 12px 16px -4px var(--tw-shadow-color) !important; box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow) !important; }\n.shadow { --tw-shadow: 0 1px 3px 0 rgba(0,0,0,.1),0 1px 2px -1px rgba(0,0,0,.1); --tw-shadow-colored: 0 1px 3px 0 var(--tw-shadow-color),0 1px 2px -1px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.shadow-\\[0_0_5px_-3px_rgba\\(14\\,159\\,110\\,0\\.1\\)\\,0\\.5px_0\\.5px_3px_rgba\\(14\\,159\\,110\\,0\\.3\\)\\,inset_1\\.5px_1\\.5px_0px_rgba\\(255\\,255\\,255\\,0\\.2\\)\\] { --tw-shadow: 0 0 5px -3px rgba(14,159,110,.1),0.5px 0.5px 3px rgba(14,159,110,.3),inset 1.5px 1.5px 0px hsla(0,0%,100%,.2); --tw-shadow-colored: 0 0 5px -3px var(--tw-shadow-color),0.5px 0.5px 3px var(--tw-shadow-color),inset 1.5px 1.5px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.shadow-\\[0_12px_20px_0_rgba\\(0\\,0\\,0\\,0\\.1\\)\\] { --tw-shadow: 0 12px 20px 0 rgba(0,0,0,.1); --tw-shadow-colored: 0 12px 20px 0 var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.shadow-\\[0px_12px_20px_0px_rgba\\(0\\,0\\,0\\,0\\.1\\)\\] { --tw-shadow: 0px 12px 20px 0px rgba(0,0,0,.1); --tw-shadow-colored: 0px 12px 20px 0px var(--tw-shadow-color); }\n.shadow-\\[0px_12px_20px_0px_rgba\\(0\\,0\\,0\\,0\\.1\\)\\], .shadow-lg { box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.shadow-lg { --tw-shadow: 0px 4px 6px -2px rgba(16,24,40,.03),0px 12px 16px -4px rgba(16,24,40,.08); --tw-shadow-colored: 0px 4px 6px -2px var(--tw-shadow-color),0px 12px 16px -4px var(--tw-shadow-color); }\n.shadow-md { --tw-shadow: 0px 2px 4px -2px rgba(16,24,40,.06),0px 4px 8px -2px rgba(16,24,40,.1); --tw-shadow-colored: 0px 2px 4px -2px var(--tw-shadow-color),0px 4px 8px -2px var(--tw-shadow-color); }\n.shadow-md, .shadow-none { box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.shadow-none { --tw-shadow: 0 0 #0000; --tw-shadow-colored: 0 0 #0000; }\n.shadow-sm { --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.06),0px 1px 3px 0px rgba(16,24,40,.1); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color),0px 1px 3px 0px var(--tw-shadow-color); }\n.shadow-sm, .shadow-xl { box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.shadow-xl { --tw-shadow: 0px 8px 8px -4px rgba(16,24,40,.03),0px 20px 24px -4px rgba(16,24,40,.08); --tw-shadow-colored: 0px 8px 8px -4px var(--tw-shadow-color),0px 20px 24px -4px var(--tw-shadow-color); }\n.shadow-xs { --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.05); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.outline-none { outline: transparent solid 2px; outline-offset: 2px; }\n.outline { outline-style: solid; }\n.outline-0 { outline-width: 0px; }\n.outline-1 { outline-width: 1px; }\n.outline-\\[1\\.50px\\] { outline-width: 1.5px; }\n.-outline-offset-1 { outline-offset: -1px; }\n.outline-offset-\\[-0\\.75px\\] { outline-offset: -0.75px; }\n.outline-offset-\\[-1px\\] { outline-offset: -1px; }\n.outline-grey-300 { outline-color: rgb(242, 242, 242); }\n.outline-grey-400 { outline-color: rgb(223, 223, 223); }\n.outline-grey-600 { outline-color: rgb(159, 159, 160); }\n.outline-primary-500 { outline-color: rgb(30, 136, 229); }\n.\\!ring-0 { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color) !important; --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color) !important; box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000) !important; }\n.ring-0 { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color); }\n.ring-0, .ring-1 { box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000); }\n.ring-1 { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color); }\n.ring-2 { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000); }\n.ring-black { --tw-ring-opacity: 1; --tw-ring-color: rgb(0 0 0/var(--tw-ring-opacity,1)); }\n.ring-blue-500 { --tw-ring-opacity: 1; --tw-ring-color: rgb(30 136 229/var(--tw-ring-opacity,1)); }\n.ring-gray-300 { --tw-ring-opacity: 1; --tw-ring-color: rgb(209 213 219/var(--tw-ring-opacity,1)); }\n.ring-primary-200 { --tw-ring-opacity: 1; --tw-ring-color: rgb(153 140 143/var(--tw-ring-opacity,1)); }\n.ring-opacity-5 { --tw-ring-opacity: 0.05; }\n.ring-offset-1 { --tw-ring-offset-width: 1px; }\n.blur { --tw-blur: blur(8px); }\n.blur, .brightness-75 { filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow); }\n.brightness-75 { --tw-brightness: brightness(.75); }\n.drop-shadow { --tw-drop-shadow: drop-shadow(0 1px 2px rgba(0,0,0,.1)) drop-shadow(0 1px 1px rgba(0,0,0,.06)); }\n.drop-shadow, .drop-shadow-\\[0_2px_4px_rgba\\(0\\,0\\,0\\,0\\.8\\)\\] { filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow); }\n.drop-shadow-\\[0_2px_4px_rgba\\(0\\,0\\,0\\,0\\.8\\)\\] { --tw-drop-shadow: drop-shadow(0 2px 4px rgba(0,0,0,.8)); }\n.drop-shadow-md { --tw-drop-shadow: drop-shadow(0 4px 3px rgba(0,0,0,.07)) drop-shadow(0 2px 2px rgba(0,0,0,.06)); }\n.drop-shadow-md, .grayscale { filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow); }\n.grayscale { --tw-grayscale: grayscale(100%); }\n.sepia { --tw-sepia: sepia(100%); }\n.filter, .sepia { filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow); }\n.backdrop-blur-\\[2px\\] { --tw-backdrop-blur: blur(2px); }\n.backdrop-blur-\\[2px\\], .backdrop-blur-md { backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia); }\n.backdrop-blur-md { --tw-backdrop-blur: blur(12px); }\n.backdrop-blur-sm { --tw-backdrop-blur: blur(4px); }\n.backdrop-blur-sm, .backdrop-blur-xl { backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia); }\n.backdrop-blur-xl { --tw-backdrop-blur: blur(24px); }\n.backdrop-filter { backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia); }\n.transition { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, -webkit-backdrop-filter; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 0.15s; }\n.transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 0.15s; }\n.transition-colors { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 0.15s; }\n.transition-opacity { transition-property: opacity; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 0.15s; }\n.transition-shadow { transition-property: box-shadow; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 0.15s; }\n.transition-transform { transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 0.15s; }\n.delay-200 { transition-delay: 0.2s; }\n.duration-100 { transition-duration: 0.1s; }\n.duration-150 { transition-duration: 0.15s; }\n.duration-200 { transition-duration: 0.2s; }\n.duration-300 { transition-duration: 0.3s; }\n.duration-500 { transition-duration: 0.5s; }\n.duration-75 { transition-duration: 75ms; }\n.ease-in { transition-timing-function: cubic-bezier(0.4, 0, 1, 1); }\n.ease-in-out { transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }\n.ease-out { transition-timing-function: cubic-bezier(0, 0, 0.2, 1); }\n@keyframes enter { \n  0% { opacity: var(--tw-enter-opacity,1); transform: translate3d(var(--tw-enter-translate-x,0),var(--tw-enter-translate-y,0),0) scale3d(var(--tw-enter-scale,1),var(--tw-enter-scale,1),var(--tw-enter-scale,1)) rotate(var(--tw-enter-rotate,0)); }\n}\n@keyframes exit { \n  100% { opacity: var(--tw-exit-opacity,1); transform: translate3d(var(--tw-exit-translate-x,0),var(--tw-exit-translate-y,0),0) scale3d(var(--tw-exit-scale,1),var(--tw-exit-scale,1),var(--tw-exit-scale,1)) rotate(var(--tw-exit-rotate,0)); }\n}\n.fade-in { --tw-enter-opacity: 0; }\n.duration-100 { animation-duration: 0.1s; }\n.duration-150 { animation-duration: 0.15s; }\n.duration-200 { animation-duration: 0.2s; }\n.duration-300 { animation-duration: 0.3s; }\n.duration-500 { animation-duration: 0.5s; }\n.duration-75 { animation-duration: 75ms; }\n.delay-200 { animation-delay: 0.2s; }\n.ease-in { animation-timing-function: cubic-bezier(0.4, 0, 1, 1); }\n.ease-in-out { animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }\n.ease-out { animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }\n.running { animation-play-state: running; }\n.paused { animation-play-state: paused; }\n.\\[-webkit-text-stroke\\:transparent\\] { -webkit-text-stroke: transparent; }\n.\\!\\[clip\\:rect\\(0\\,0\\,0\\,0\\)\\] { clip: rect(0px, 0px, 0px, 0px) !important; }\n.\\[text-shadow\\:_0_0_2px_\\#FD4377\\,_0_0_2px_\\#FD4377\\,_0_0_2px_\\#FD4377\\,_0_0_2px_\\#FD4377\\] { text-shadow: rgb(253, 67, 119) 0px 0px 2px, rgb(253, 67, 119) 0px 0px 2px, rgb(253, 67, 119) 0px 0px 2px, rgb(253, 67, 119) 0px 0px 2px; }\n.\\[text-shadow\\:_1px_1px_0_white\\,_-1px_1px_0_white\\,_1px_-1px_0_white\\,_-1px_-1px_0_white\\] { text-shadow: rgb(255, 255, 255) 1px 1px 0px, rgb(255, 255, 255) -1px 1px 0px, rgb(255, 255, 255) 1px -1px 0px, rgb(255, 255, 255) -1px -1px 0px; }\n:root { --custom-dark-bg: #292a2b; --custom-dark-text: #e8e8e8; --custom-dark-border: #404142; --max-width: 1100px; --border-radius: 12px; --font-system: Gantari,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Microsoft YaHei\",\"微软雅黑\",Helvetica,Arial,sans-serif; --font-mono: Gantari,ui-monospace,\"Microsoft YaHei\",Arial,sans-serif,Menlo,Monaco,\"Cascadia Mono\",\"Segoe UI Mono\",\"Roboto Mono\",\"Oxygen Mono\",\"Ubuntu Monospace\",\"Source Code Pro\",\"Fira Mono\",\"Droid Sans Mono\",\"Courier New\",monospace; --foreground-rgb: 0,0,0; --background-start-rgb: 214,219,220; --background-end-rgb: 255,255,255; --primary-glow: conic-gradient(from 180deg at 50% 50%,#16abff33 0deg,#0885ff33 55deg,#54d6ff33 120deg,#0071ff33 160deg,transparent 360deg); --secondary-glow: radial-gradient(#fff,hsla(0,0%,100%,0)); --tile-start-rgb: 239,245,249; --tile-end-rgb: 228,232,233; --tile-border: conic-gradient(#00000080,#00000040,#00000030,#00000020,#00000010,#00000010,#00000080); --callout-rgb: 238,240,241; --callout-border-rgb: 172,175,176; --card-rgb: 180,185,188; --card-border-rgb: 131,134,135; --primary-color-light: rgba(28,100,242,.1); --primary-color: #1e88e5; --success-color: #0dba66; --error-color: #f63d43; --warning-color: #ff7f3f; --info-color: #9f9fa0; --text-black: #000; --text-Main: #292a2b; --text-Main-Hover: #1e88e5; --text-Main-Active: #1e88e5; --text-Secondary: #9f9fa0; --text-Secondary-Hover: #fdfdfd; --text-Tertiary: #fdfdfd; --background-Main-Normal: #fdfdfd; --background-Main-Hover: #f2f2f2; --background-Secondary: #f6f6f7; --background-Tertiary: #e9f3fc; --background-Tertiary-01: #1e88e5; --background-Tertiary-02: #292a2b; --stroke-Main: #f2f2f2; --stroke-Secondary: #dfdfdf; --stroke-Tertiary: #1e88e5; --waring-Main-Text: #ff7f3f; --waring-Main-BG-Normal: #ff7f3f; --waring-Main-BG-Hover: #fef3ee; --danger-Main-Text: #f63d43; --danger-Main-BG-Normal: #f63d43; --danger-Main-BG-Active: #d93e3e; --success-Main-Text: #0dba66; --success-Main-Text-Hover: #0a9552; --price-factor-color: #e96c6c; }\n:lang(zh-CN), :lang(zh-TW) { --font-system: Gantari,\"Hiragino Sans GB\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Microsoft YaHei\",\"微软雅黑\",Helvetica,Arial,sans-serif; --font-mono: Gantari,\"Hiragino Sans GB\",ui-monospace,\"Microsoft YaHei\",Arial,sans-serif,Menlo,Monaco,\"Cascadia Mono\",\"Segoe UI Mono\",\"Roboto Mono\",\"Oxygen Mono\",\"Ubuntu Monospace\",\"Source Code Pro\",\"Fira Mono\",\"Droid Sans Mono\",\"Courier New\",monospace; }\n:lang(ja), :lang(ko) { --font-system: Gantari,\"Hiragino Sans\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Microsoft YaHei\",\"微软雅黑\",Helvetica,Arial,sans-serif; --font-mono: Gantari,\"Hiragino Sans\",ui-monospace,\"Microsoft YaHei\",Arial,sans-serif,Menlo,Monaco,\"Cascadia Mono\",\"Segoe UI Mono\",\"Roboto Mono\",\"Oxygen Mono\",\"Ubuntu Monospace\",\"Source Code Pro\",\"Fira Mono\",\"Droid Sans Mono\",\"Courier New\",monospace; }\n* { box-sizing: border-box; padding: 0px; margin: 0px; }\n.disable-drag { -webkit-user-drag: none; }\nbody, html { max-width: 100vw; overflow: auto; }\nbody { color: rgb(var(--foreground-rgb)); user-select: none; font-family: var(--font-system); }\n:focus-visible { outline: none; }\na { color: inherit; text-decoration: none; outline: none; }\nbutton:focus-within { outline: none; }\n.h1 { padding-bottom: 1.5rem; line-height: 1.5; font-size: 1.125rem; color: rgb(17, 25, 40); }\n.no-image-mode img:not(.not-toggle) { visibility: hidden; }\n.no-image-mode :not(.not-toggle) { background-image: none !important; }\n.img-mode { visibility: visible !important; }\n.h2 { font-size: 14px; font-weight: 500; color: rgb(17, 25, 40); line-height: 1.5; }\n.link { cursor: pointer; --tw-text-opacity: 1; color: rgb(27 124 208/var(--tw-text-opacity,1)); transition-property: opacity; transition-duration: 0.2s; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); animation-duration: 0.2s; animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }\n.link:hover { opacity: 0.8; }\n.text-gradient { background: linear-gradient(91.58deg, rgb(34, 80, 242) -29.55%, rgb(14, 188, 243) 75.22%) text; -webkit-text-fill-color: transparent; }\n[class*=\"style_paginatio\"] li .text-primary-600 { color: rgb(28, 100, 242); background-color: rgb(235, 245, 255); }\n.inset-0 { inset: 0px; }\n.line-clamp { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }\n.price-factor { color: var(--price-factor-color); }\n.hide-scrollbar { scrollbar-width: none; }\n.scrollbar-gutter-stable { scrollbar-gutter: stable; }\n::-webkit-scrollbar { width: 6px; height: 6px; }\n::-webkit-scrollbar-track { background: transparent; }\n::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.3); border-radius: 3px; border: none; }\n::-webkit-scrollbar-thumb:hover { background: rgba(156, 163, 175, 0.5); }\n::-webkit-scrollbar-corner { background: transparent; }\n* { scrollbar-width: thin; scrollbar-color: rgba(156, 163, 175, 0.3) transparent; }\n.rc-md-editor { padding-top: 12px; border-radius: 4px; border: none !important; background-color: rgb(246, 246, 247) !important; }\n.rc-md-editor .rc-md-navigation, .rc-md-editor .section { border: none !important; }\n.rc-md-editor .section-container { background-color: rgb(246, 246, 247) !important; }\n.MuiPaper-root .MuiAlert-message { white-space: pre-line; word-break: break-word; }\n.placeholder\\:text-sm::placeholder { font-size: 0.875rem; line-height: 1.25rem; }\n.placeholder\\:\\!text-gray-400::placeholder { --tw-text-opacity: 1 !important; color: rgb(156 163 175/var(--tw-text-opacity,1)) !important; }\n.placeholder\\:text-\\[\\#9F9FA0\\]::placeholder { --tw-text-opacity: 1; color: rgb(159 159 160/var(--tw-text-opacity,1)); }\n.placeholder\\:text-\\[\\#B4B8C0\\]::placeholder { --tw-text-opacity: 1; color: rgb(180 184 192/var(--tw-text-opacity,1)); }\n.placeholder\\:text-gray-300::placeholder { --tw-text-opacity: 1; color: rgb(209 213 219/var(--tw-text-opacity,1)); }\n.placeholder\\:text-gray-400::placeholder { --tw-text-opacity: 1; color: rgb(156 163 175/var(--tw-text-opacity,1)); }\n.placeholder\\:text-gray-500::placeholder { --tw-text-opacity: 1; color: rgb(107 114 128/var(--tw-text-opacity,1)); }\n.after\\:absolute::after { content: var(--tw-content); position: absolute; }\n.after\\:-left-2\\.5::after { content: var(--tw-content); left: -0.625rem; }\n.after\\:top-2\\.5::after { content: var(--tw-content); top: 0.625rem; }\n.after\\:top-3\\.5::after { content: var(--tw-content); top: 0.875rem; }\n.after\\:h-1\\.5::after { content: var(--tw-content); height: 0.375rem; }\n.after\\:w-1\\.5::after { content: var(--tw-content); width: 0.375rem; }\n.after\\:rounded-full::after { content: var(--tw-content); border-radius: 9999px; }\n.after\\:bg-green-400::after { content: var(--tw-content); --tw-bg-opacity: 1; background-color: rgb(13 186 102/var(--tw-bg-opacity,1)); }\n.after\\:bg-green-500::after { content: var(--tw-content); --tw-bg-opacity: 1; background-color: rgb(12 167 92/var(--tw-bg-opacity,1)); }\n.after\\:bg-orange-500::after { content: var(--tw-content); --tw-bg-opacity: 1; background-color: rgb(255 127 63/var(--tw-bg-opacity,1)); }\n.after\\:bg-red-500::after { content: var(--tw-content); --tw-bg-opacity: 1; background-color: rgb(239 68 68/var(--tw-bg-opacity,1)); }\n.after\\:content-\\[\\'\\'\\]::after { --tw-content: \"\"; content: var(--tw-content); }\n.last\\:mb-0:last-child { margin-bottom: 0px; }\n.last\\:mr-0:last-child { margin-right: 0px; }\n.first-of-type\\:pt-\\[14px\\]:first-of-type { padding-top: 14px; }\n.last-of-type\\:mb-0:last-of-type { margin-bottom: 0px; }\n.hover\\:z-10:hover { z-index: 10; }\n.hover\\:scale-105:hover { --tw-scale-x: 1.05; --tw-scale-y: 1.05; }\n.hover\\:scale-105:hover, .hover\\:scale-110:hover { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.hover\\:scale-110:hover { --tw-scale-x: 1.1; --tw-scale-y: 1.1; }\n.hover\\:cursor-pointer:hover { cursor: pointer; }\n.hover\\:rounded-lg:hover { border-radius: var(--radius); }\n.hover\\:border:hover { border-width: 1px; }\n.hover\\:border-\\[1\\.5px\\]:hover { border-width: 1.5px; }\n.hover\\:\\!border-black\\/5:hover { border-color: rgba(0, 0, 0, 0.05) !important; }\n.hover\\:\\!border-gray-300:hover { --tw-border-opacity: 1 !important; border-color: rgb(209 213 219/var(--tw-border-opacity,1)) !important; }\n.hover\\:border-\\[\\#B9E6FE\\]:hover { --tw-border-opacity: 1; border-color: rgb(185 230 254/var(--tw-border-opacity,1)); }\n.hover\\:border-\\[\\#D1D1D1\\]:hover { --tw-border-opacity: 1; border-color: rgb(209 209 209/var(--tw-border-opacity,1)); }\n.hover\\:border-\\[rgba\\(0\\,0\\,0\\,0\\.08\\)\\]:hover { border-color: rgba(0, 0, 0, 0.08); }\n.hover\\:border-gray-200:hover { --tw-border-opacity: 1; border-color: rgb(229 231 235/var(--tw-border-opacity,1)); }\n.hover\\:border-gray-300:hover { --tw-border-opacity: 1; border-color: rgb(209 213 219/var(--tw-border-opacity,1)); }\n.hover\\:border-gray-400:hover { --tw-border-opacity: 1; border-color: rgb(156 163 175/var(--tw-border-opacity,1)); }\n.hover\\:border-primary-400:hover { --tw-border-opacity: 1; border-color: rgb(75 160 234/var(--tw-border-opacity,1)); }\n.hover\\:\\!bg-gray-100:hover { --tw-bg-opacity: 1 !important; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)) !important; }\n.hover\\:\\!bg-gray-200:hover { --tw-bg-opacity: 1 !important; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)) !important; }\n.hover\\:\\!bg-white:hover { --tw-bg-opacity: 1 !important; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)) !important; }\n.hover\\:bg-\\[\\#EBE9FE\\]:hover { --tw-bg-opacity: 1; background-color: rgb(235 233 254/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#EBEBEC\\]:hover { --tw-bg-opacity: 1; background-color: rgb(235 235 236/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#EBF5FF\\]:hover { --tw-bg-opacity: 1; background-color: rgb(235 245 255/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#F2F2F2\\]:hover { --tw-bg-opacity: 1; background-color: rgb(242 242 242/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#F6F6F7\\]:hover { --tw-bg-opacity: 1; background-color: rgb(246 246 247/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#F9FAFB\\]:hover { --tw-bg-opacity: 1; background-color: rgb(249 250 251/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#FCE7F6\\]:hover { --tw-bg-opacity: 1; background-color: rgb(252 231 246/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#FEE4E2\\]:hover { --tw-bg-opacity: 1; background-color: rgb(254 228 226/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[\\#FFEAD5\\]:hover { --tw-bg-opacity: 1; background-color: rgb(255 234 213/var(--tw-bg-opacity,1)); }\n.hover\\:bg-\\[rgba\\(250\\,250\\,252\\,0\\.3\\)\\]:hover { background-color: rgba(250, 250, 252, 0.3); }\n.hover\\:bg-black\\/5:hover { background-color: rgba(0, 0, 0, 0.05); }\n.hover\\:bg-black\\/60:hover { background-color: rgba(0, 0, 0, 0.6); }\n.hover\\:bg-blue-50:hover { --tw-bg-opacity: 1; background-color: rgb(233 243 252/var(--tw-bg-opacity,1)); }\n.hover\\:bg-blue-600:hover { --tw-bg-opacity: 1; background-color: rgb(27 124 208/var(--tw-bg-opacity,1)); }\n.hover\\:bg-blue-700:hover { --tw-bg-opacity: 1; background-color: rgb(21 97 163/var(--tw-bg-opacity,1)); }\n.hover\\:bg-gray-100:hover { --tw-bg-opacity: 1; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)); }\n.hover\\:bg-gray-200:hover { --tw-bg-opacity: 1; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)); }\n.hover\\:bg-gray-300:hover { --tw-bg-opacity: 1; background-color: rgb(209 213 219/var(--tw-bg-opacity,1)); }\n.hover\\:bg-gray-50:hover { --tw-bg-opacity: 1; background-color: rgb(249 250 251/var(--tw-bg-opacity,1)); }\n.hover\\:bg-grey-200:hover { --tw-bg-opacity: 1; background-color: rgb(246 246 247/var(--tw-bg-opacity,1)); }\n.hover\\:bg-grey-300:hover { --tw-bg-opacity: 1; background-color: rgb(242 242 242/var(--tw-bg-opacity,1)); }\n.hover\\:bg-orange-50:hover { --tw-bg-opacity: 1; background-color: rgb(255 247 237/var(--tw-bg-opacity,1)); }\n.hover\\:bg-primary-100:hover { --tw-bg-opacity: 1; background-color: rgb(185 218 247/var(--tw-bg-opacity,1)); }\n.hover\\:bg-primary-200:hover { --tw-bg-opacity: 1; background-color: rgb(153 140 143/var(--tw-bg-opacity,1)); }\n.hover\\:bg-primary-50:hover { --tw-bg-opacity: 1; background-color: rgb(233 243 252/var(--tw-bg-opacity,1)); }\n.hover\\:bg-primary-500:hover { --tw-bg-opacity: 1; background-color: rgb(30 136 229/var(--tw-bg-opacity,1)); }\n.hover\\:bg-primary-700:hover { --tw-bg-opacity: 1; background-color: rgb(21 97 163/var(--tw-bg-opacity,1)); }\n.hover\\:bg-red-200:hover { --tw-bg-opacity: 1; background-color: rgb(248 169 169/var(--tw-bg-opacity,1)); }\n.hover\\:bg-red-50:hover { --tw-bg-opacity: 1; background-color: rgb(253 236 236/var(--tw-bg-opacity,1)); }\n.hover\\:bg-red-600:hover { --tw-bg-opacity: 1; background-color: rgb(217 62 62/var(--tw-bg-opacity,1)); }\n.hover\\:bg-sky-50:hover { --tw-bg-opacity: 1; background-color: rgb(240 249 255/var(--tw-bg-opacity,1)); }\n.hover\\:bg-white:hover { --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); }\n.hover\\:text-base:hover { font-size: 1rem; line-height: 1.5rem; }\n.hover\\:font-bold:hover { font-weight: 700; }\n.hover\\:\\!text-gray-700:hover { --tw-text-opacity: 1 !important; color: rgb(55 65 81/var(--tw-text-opacity,1)) !important; }\n.hover\\:text-\\[\\#1E88E5\\]:hover { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.hover\\:text-\\[\\#292A2B\\]:hover { --tw-text-opacity: 1; color: rgb(41 42 43/var(--tw-text-opacity,1)); }\n.hover\\:text-\\[\\#D92D20\\]:hover { --tw-text-opacity: 1; color: rgb(217 45 32/var(--tw-text-opacity,1)); }\n.hover\\:text-\\[\\#EBF5FF\\]\\/80:hover { color: rgba(235, 245, 255, 0.8); }\n.hover\\:text-\\[var\\(--text-primary\\)\\]:hover { color: var(--text-primary); }\n.hover\\:text-blue-500:hover { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.hover\\:text-blue-600:hover { --tw-text-opacity: 1; color: rgb(27 124 208/var(--tw-text-opacity,1)); }\n.hover\\:text-blue-700:hover { --tw-text-opacity: 1; color: rgb(21 97 163/var(--tw-text-opacity,1)); }\n.hover\\:text-blue-800:hover { --tw-text-opacity: 1; color: rgb(17 75 126/var(--tw-text-opacity,1)); }\n.hover\\:text-gray-500:hover { --tw-text-opacity: 1; color: rgb(107 114 128/var(--tw-text-opacity,1)); }\n.hover\\:text-gray-600:hover { --tw-text-opacity: 1; color: rgb(75 85 99/var(--tw-text-opacity,1)); }\n.hover\\:text-gray-700:hover { --tw-text-opacity: 1; color: rgb(55 65 81/var(--tw-text-opacity,1)); }\n.hover\\:text-gray-800:hover { --tw-text-opacity: 1; color: rgb(31 42 55/var(--tw-text-opacity,1)); }\n.hover\\:text-gray-900:hover { --tw-text-opacity: 1; color: rgb(17 25 40/var(--tw-text-opacity,1)); }\n.hover\\:text-primary-500:hover { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.hover\\:text-primary-600:hover { --tw-text-opacity: 1; color: rgb(27 124 208/var(--tw-text-opacity,1)); }\n.hover\\:text-red-400:hover { --tw-text-opacity: 1; color: rgb(242 105 105/var(--tw-text-opacity,1)); }\n.hover\\:text-red-500:hover { --tw-text-opacity: 1; color: rgb(239 68 68/var(--tw-text-opacity,1)); }\n.hover\\:text-red-700:hover { --tw-text-opacity: 1; color: rgb(170 48 48/var(--tw-text-opacity,1)); }\n.hover\\:text-yellow-400:hover { --tw-text-opacity: 1; color: rgb(246 213 146/var(--tw-text-opacity,1)); }\n.hover\\:underline:hover { text-decoration-line: underline; }\n.hover\\:opacity-60:hover { opacity: 0.6; }\n.hover\\:opacity-70:hover { opacity: 0.7; }\n.hover\\:opacity-80:hover { opacity: 0.8; }\n.hover\\:opacity-90:hover { opacity: 0.9; }\n.hover\\:\\!shadow-xs:hover { --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.05) !important; --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color) !important; box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow) !important; }\n.hover\\:shadow:hover { --tw-shadow: 0 1px 3px 0 rgba(0,0,0,.1),0 1px 2px -1px rgba(0,0,0,.1); --tw-shadow-colored: 0 1px 3px 0 var(--tw-shadow-color),0 1px 2px -1px var(--tw-shadow-color); }\n.hover\\:shadow-\\[0_12px_20px_0_rgba\\(0\\,0\\,0\\,0\\.1\\)\\]:hover, .hover\\:shadow:hover { box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.hover\\:shadow-\\[0_12px_20px_0_rgba\\(0\\,0\\,0\\,0\\.1\\)\\]:hover { --tw-shadow: 0 12px 20px 0 rgba(0,0,0,.1); --tw-shadow-colored: 0 12px 20px 0 var(--tw-shadow-color); }\n.hover\\:shadow-\\[0_4px_12px_rgba\\(0\\,0\\,0\\,0\\.08\\)\\]:hover { --tw-shadow: 0 4px 12px rgba(0,0,0,.08); --tw-shadow-colored: 0 4px 12px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.hover\\:shadow-\\[0_6px_20px_rgba\\(0\\,0\\,0\\,0\\.06\\)\\]:hover { --tw-shadow: 0 6px 20px rgba(0,0,0,.06); --tw-shadow-colored: 0 6px 20px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.hover\\:shadow-\\[0_6px_20px_rgba\\(0\\,0\\,0\\,0\\.08\\)\\]:hover { --tw-shadow: 0 6px 20px rgba(0,0,0,.08); --tw-shadow-colored: 0 6px 20px var(--tw-shadow-color); }\n.hover\\:shadow-\\[0_6px_20px_rgba\\(0\\,0\\,0\\,0\\.08\\)\\]:hover, .hover\\:shadow-lg:hover { box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.hover\\:shadow-lg:hover { --tw-shadow: 0px 4px 6px -2px rgba(16,24,40,.03),0px 12px 16px -4px rgba(16,24,40,.08); --tw-shadow-colored: 0px 4px 6px -2px var(--tw-shadow-color),0px 12px 16px -4px var(--tw-shadow-color); }\n.hover\\:shadow-md:hover { --tw-shadow: 0px 2px 4px -2px rgba(16,24,40,.06),0px 4px 8px -2px rgba(16,24,40,.1); --tw-shadow-colored: 0px 2px 4px -2px var(--tw-shadow-color),0px 4px 8px -2px var(--tw-shadow-color); }\n.hover\\:shadow-md:hover, .hover\\:shadow-none:hover { box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.hover\\:shadow-none:hover { --tw-shadow: 0 0 #0000; --tw-shadow-colored: 0 0 #0000; }\n.hover\\:shadow-sm:hover { --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.06),0px 1px 3px 0px rgba(16,24,40,.1); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color),0px 1px 3px 0px var(--tw-shadow-color); }\n.hover\\:shadow-sm:hover, .hover\\:shadow-xl:hover { box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.hover\\:shadow-xl:hover { --tw-shadow: 0px 8px 8px -4px rgba(16,24,40,.03),0px 20px 24px -4px rgba(16,24,40,.08); --tw-shadow-colored: 0px 8px 8px -4px var(--tw-shadow-color),0px 20px 24px -4px var(--tw-shadow-color); }\n.hover\\:shadow-xs:hover { --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.05); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.hover\\:ring-1:hover { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000); }\n.hover\\:placeholder\\:text-gray-400:hover::placeholder { --tw-text-opacity: 1; color: rgb(156 163 175/var(--tw-text-opacity,1)); }\n.focus\\:border:focus { border-width: 1px; }\n.focus\\:border-solid:focus { border-style: solid; }\n.focus\\:border-gray-300:focus { --tw-border-opacity: 1; border-color: rgb(209 213 219/var(--tw-border-opacity,1)); }\n.focus\\:border-primary-500:focus { --tw-border-opacity: 1; border-color: rgb(30 136 229/var(--tw-border-opacity,1)); }\n.focus\\:border-transparent:focus { border-color: transparent; }\n.focus\\:bg-gray-50:focus { --tw-bg-opacity: 1; background-color: rgb(249 250 251/var(--tw-bg-opacity,1)); }\n.focus\\:bg-white:focus { --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); }\n.focus\\:text-gray-500:focus { --tw-text-opacity: 1; color: rgb(107 114 128/var(--tw-text-opacity,1)); }\n.focus\\:shadow-xs:focus { --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.05); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.focus\\:outline-none:focus { outline: transparent solid 2px; outline-offset: 2px; }\n.focus\\:ring-0:focus { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color); }\n.focus\\:ring-0:focus, .focus\\:ring-1:focus { box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000); }\n.focus\\:ring-1:focus { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color); }\n.focus\\:ring-2:focus { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000); }\n.focus\\:ring-inset:focus { --tw-ring-inset: inset; }\n.focus\\:ring-blue-500:focus { --tw-ring-opacity: 1; --tw-ring-color: rgb(30 136 229/var(--tw-ring-opacity,1)); }\n.focus\\:ring-blue-700:focus { --tw-ring-opacity: 1; --tw-ring-color: rgb(21 97 163/var(--tw-ring-opacity,1)); }\n.focus\\:ring-gray-200:focus { --tw-ring-opacity: 1; --tw-ring-color: rgb(229 231 235/var(--tw-ring-opacity,1)); }\n.focus\\:ring-primary-500:focus { --tw-ring-opacity: 1; --tw-ring-color: rgb(30 136 229/var(--tw-ring-opacity,1)); }\n.focus\\:ring-primary-600:focus { --tw-ring-opacity: 1; --tw-ring-color: rgb(27 124 208/var(--tw-ring-opacity,1)); }\n.focus\\:ring-offset-1:focus { --tw-ring-offset-width: 1px; }\n.focus-visible\\:bg-gray-200:focus-visible { --tw-bg-opacity: 1; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)); }\n.focus-visible\\:outline-none:focus-visible { outline: transparent solid 2px; outline-offset: 2px; }\n.active\\:scale-95:active { --tw-scale-x: .95; --tw-scale-y: .95; transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.active\\:bg-\\[\\#E0E0E1\\]:active { --tw-bg-opacity: 1; background-color: rgb(224 224 225/var(--tw-bg-opacity,1)); }\n.active\\:bg-blue-800:active { --tw-bg-opacity: 1; background-color: rgb(17 75 126/var(--tw-bg-opacity,1)); }\n.active\\:bg-gray-100:active { --tw-bg-opacity: 1; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)); }\n.active\\:opacity-80:active { opacity: 0.8; }\n.active\\:opacity-95:active { opacity: 0.95; }\n.enabled\\:hover\\:bg-gray-100:hover:enabled { --tw-bg-opacity: 1; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)); }\n.disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }\n.disabled\\:bg-transparent:disabled { background-color: transparent; }\n.disabled\\:opacity-50:disabled { opacity: 0.5; }\n.disabled\\:opacity-60:disabled { opacity: 0.6; }\n.group:hover .group-hover\\:visible { visibility: visible; }\n.group:hover .group-hover\\:static { position: static; }\n.group:hover .group-hover\\:absolute { position: absolute; }\n.group:hover .group-hover\\:line-clamp-2 { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }\n.group:hover .group-hover\\:block, .group\\/card:hover .group-hover\\/card\\:block { display: block; }\n.group:hover .group-hover\\:flex { display: flex; }\n.group:hover .group-hover\\:inline-flex { display: inline-flex; }\n.group:hover .group-hover\\:grid { display: grid; }\n.group:hover .group-hover\\:hidden { display: none; }\n.group:hover .group-hover\\:aspect-auto { aspect-ratio: auto; }\n.group:hover .group-hover\\:h-9 { height: 2.25rem; }\n.group:hover .group-hover\\:h-full { height: 100%; }\n.group:hover .group-hover\\:w-full { width: 100%; }\n.group:hover .group-hover\\:scale-100 { --tw-scale-x: 1; --tw-scale-y: 1; }\n.group:hover .group-hover\\:scale-100, .group:hover .group-hover\\:scale-105 { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.group:hover .group-hover\\:scale-105 { --tw-scale-x: 1.05; --tw-scale-y: 1.05; }\n.group:hover .group-hover\\:scale-110 { --tw-scale-x: 1.1; --tw-scale-y: 1.1; }\n.group:hover .group-hover\\:scale-110, .group:hover .group-hover\\:scale-\\[1\\.02\\] { transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n.group:hover .group-hover\\:scale-\\[1\\.02\\] { --tw-scale-x: 1.02; --tw-scale-y: 1.02; }\n.group:hover .group-hover\\:gap-0 { gap: 0px; }\n.group:hover .group-hover\\:rounded-lg { border-radius: var(--radius); }\n.group:hover .group-hover\\:rounded-sm { border-radius: calc(var(--radius) - 4px); }\n.group:hover .group-hover\\:\\!bg-gray-200 { --tw-bg-opacity: 1 !important; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)) !important; }\n.group:hover .group-hover\\:\\!bg-white { --tw-bg-opacity: 1 !important; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)) !important; }\n.group:hover .group-hover\\:bg-\\[var\\(--primary-color\\)\\] { background-color: var(--primary-color); }\n.group:hover .group-hover\\:bg-\\[var\\(--text-primary\\)\\] { background-color: var(--text-primary); }\n.group:hover .group-hover\\:bg-gray-200 { --tw-bg-opacity: 1; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)); }\n.group:hover .group-hover\\:bg-gray-300 { --tw-bg-opacity: 1; background-color: rgb(209 213 219/var(--tw-bg-opacity,1)); }\n.group:hover .group-hover\\:bg-white { --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); }\n.group:hover .group-hover\\:px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }\n.group:hover .group-hover\\:px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }\n.group:hover .group-hover\\:text-center { text-align: center; }\n.group\\/action:hover .group-hover\\/action\\:text-\\[\\#D92D20\\] { --tw-text-opacity: 1; color: rgb(217 45 32/var(--tw-text-opacity,1)); }\n.group\\/clear:hover .group-hover\\/clear\\:text-gray-600 { --tw-text-opacity: 1; color: rgb(75 85 99/var(--tw-text-opacity,1)); }\n.group\\/edit:hover .group-hover\\/edit\\:text-gray-800, .group\\/remove:hover .group-hover\\/remove\\:text-gray-800 { --tw-text-opacity: 1; color: rgb(31 42 55/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-\\[\\#155EEF\\] { --tw-text-opacity: 1; color: rgb(21 94 239/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-\\[\\#1E88E5\\] { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-\\[\\#FF7F3F\\] { --tw-text-opacity: 1; color: rgb(255 127 63/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-gray-700 { --tw-text-opacity: 1; color: rgb(55 65 81/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-gray-900 { --tw-text-opacity: 1; color: rgb(17 25 40/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-primary-500 { --tw-text-opacity: 1; color: rgb(30 136 229/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-primary-600 { --tw-text-opacity: 1; color: rgb(27 124 208/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-red-500 { --tw-text-opacity: 1; color: rgb(239 68 68/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:text-white { --tw-text-opacity: 1; color: rgb(255 255 255/var(--tw-text-opacity,1)); }\n.group:hover .group-hover\\:opacity-100 { opacity: 1; }\n.group:hover .group-hover\\:shadow-xs { --tw-shadow: 0px 1px 2px 0px rgba(16,24,40,.05); --tw-shadow-colored: 0px 1px 2px 0px var(--tw-shadow-color); box-shadow: var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow); }\n.group:hover .group-hover\\:brightness-40 { --tw-brightness: brightness(.4); filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow); }\n.group:hover .group-hover\\:transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 0.15s; }\n@media (prefers-reduced-motion: reduce) {\n  @keyframes spin { \n  100% { transform: rotate(1turn); }\n}\n  .motion-reduce\\:animate-\\[spin_1\\.5s_linear_infinite\\] { animation: 1.5s linear 0s infinite normal none running spin; }\n}\n.dark\\:border-gray-700:is(.dark *) { --tw-border-opacity: 1; border-color: rgb(55 65 81/var(--tw-border-opacity,1)); }\n.dark\\:bg-gray-700:is(.dark *) { --tw-bg-opacity: 1; background-color: rgb(55 65 81/var(--tw-bg-opacity,1)); }\n.dark\\:text-gray-100:is(.dark *) { --tw-text-opacity: 1; color: rgb(243 244 246/var(--tw-text-opacity,1)); }\n.dark\\:hover\\:bg-gray-800:hover:is(.dark *) { --tw-bg-opacity: 1; background-color: rgb(31 42 55/var(--tw-bg-opacity,1)); }\n@media (min-width: 100px) {\n  .mobile\\:px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }\n}\n@media (min-width: 640px) {\n  .sm\\:absolute { position: absolute; }\n  .sm\\:relative { position: relative; }\n  .sm\\:right-6 { right: 1.5rem; }\n  .sm\\:top-6 { top: 1.5rem; }\n  .sm\\:mb-0 { margin-bottom: 0px; }\n  .sm\\:mb-1 { margin-bottom: 0.25rem; }\n  .sm\\:mb-4 { margin-bottom: 1rem; }\n  .sm\\:mr-2 { margin-right: 0.5rem; }\n  .sm\\:mr-3 { margin-right: 0.75rem; }\n  .sm\\:block { display: block; }\n  .sm\\:flex { display: flex; }\n  .sm\\:hidden { display: none; }\n  .sm\\:h-64 { height: 16rem; }\n  .sm\\:h-\\[100px\\] { height: 100px; }\n  .sm\\:h-\\[120px\\] { height: 120px; }\n  .sm\\:w-1\\/2 { width: 50%; }\n  .sm\\:w-\\[100px\\] { width: 100px; }\n  .sm\\:w-\\[164px\\] { width: 164px; }\n  .sm\\:w-\\[200px\\] { width: 200px; }\n  .sm\\:w-\\[280px\\] { width: 280px; }\n  .sm\\:w-\\[300px\\] { width: 300px; }\n  .sm\\:w-\\[360px\\] { width: 360px; }\n  .sm\\:w-\\[412px\\] { width: 412px; }\n  .sm\\:w-\\[496px\\] { width: 496px; }\n  .sm\\:w-\\[500px\\] { width: 500px; }\n  .sm\\:w-auto { width: auto; }\n  .sm\\:min-w-\\[768px\\] { min-width: 768px; }\n  .sm\\:max-w-\\[503px\\] { max-width: 503px; }\n  .sm\\:max-w-\\[580px\\] { max-width: 580px; }\n  .sm\\:cursor-pointer { cursor: pointer; }\n  .sm\\:\\!grid-cols-2 { grid-template-columns: repeat(2, minmax(0px, 1fr)) !important; }\n  .sm\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0px, 1fr)); }\n  .sm\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0px, 1fr)); }\n  .sm\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0px, 1fr)); }\n  .sm\\:grid-cols-5 { grid-template-columns: repeat(5, minmax(0px, 1fr)); }\n  .sm\\:flex-row { flex-direction: row; }\n  .sm\\:items-start { align-items: flex-start; }\n  .sm\\:items-center { align-items: center; }\n  .sm\\:justify-end { justify-content: flex-end; }\n  .sm\\:justify-between { justify-content: space-between; }\n  .sm\\:gap-3 { gap: 0.75rem; }\n  .sm\\:gap-4 { gap: 1rem; }\n  .sm\\:space-x-4 > :not([hidden]) ~ :not([hidden]) { --tw-space-x-reverse: 0; margin-right: calc(1rem * var(--tw-space-x-reverse)); margin-left: calc(1rem * calc(1 - var(--tw-space-x-reverse))); }\n  .sm\\:space-y-0 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(0px * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(0px * var(--tw-space-y-reverse)); }\n  .sm\\:p-4 { padding: 1rem; }\n  .sm\\:p-6 { padding: 1.5rem; }\n  .sm\\:px-10 { padding-left: 2.5rem; padding-right: 2.5rem; }\n  .sm\\:px-12 { padding-left: 3rem; padding-right: 3rem; }\n  .sm\\:px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }\n  .sm\\:pb-8 { padding-bottom: 2rem; }\n  .sm\\:text-2xl { font-size: 1.5rem; line-height: 2rem; }\n  .sm\\:text-base { font-size: 1rem; line-height: 1.5rem; }\n  .sm\\:text-lg { font-size: 1.125rem; line-height: 1.75rem; }\n  .sm\\:text-sm { font-size: 0.875rem; line-height: 1.25rem; }\n  .sm\\:leading-6 { line-height: 1.5rem; }\n}\n@media (min-width: 768px) {\n  .md\\:invisible { visibility: hidden; }\n  .md\\:static { position: static; }\n  .md\\:sticky { position: sticky; }\n  .md\\:left-auto { left: auto; }\n  .md\\:top-\\[68px\\] { top: 68px; }\n  .md\\:order-1 { order: 1; }\n  .md\\:order-2 { order: 2; }\n  .md\\:col-span-3 { grid-column: span 3 / span 3; }\n  .md\\:col-span-5 { grid-column: span 5 / span 5; }\n  .md\\:col-span-9 { grid-column: span 9 / span 9; }\n  .md\\:mb-3 { margin-bottom: 0.75rem; }\n  .md\\:mb-6 { margin-bottom: 1.5rem; }\n  .md\\:ml-0 { margin-left: 0px; }\n  .md\\:ml-4 { margin-left: 1rem; }\n  .md\\:mr-0 { margin-right: 0px; }\n  .md\\:mr-4 { margin-right: 1rem; }\n  .md\\:mt-0 { margin-top: 0px; }\n  .md\\:mt-4 { margin-top: 1rem; }\n  .md\\:mt-5 { margin-top: 1.25rem; }\n  .md\\:mt-6 { margin-top: 1.5rem; }\n  .md\\:block { display: block; }\n  .md\\:flex { display: flex; }\n  .md\\:hidden { display: none; }\n  .md\\:h-16 { height: 4rem; }\n  .md\\:h-4 { height: 1rem; }\n  .md\\:h-\\[120px\\] { height: 120px; }\n  .md\\:h-\\[500px\\] { height: 500px; }\n  .md\\:h-\\[560px\\] { height: 560px; }\n  .md\\:h-\\[calc\\(100vh-400px\\)\\] { height: calc(-400px + 100vh); }\n  .md\\:max-h-\\[680px\\] { max-height: 680px; }\n  .md\\:max-h-\\[75vh\\] { max-height: 75vh; }\n  .md\\:min-h-96 { min-height: 24rem; }\n  .md\\:min-h-full { min-height: 100%; }\n  .md\\:w-1\\/3 { width: 33.3333%; }\n  .md\\:w-16 { width: 4rem; }\n  .md\\:w-4 { width: 1rem; }\n  .md\\:w-4\\/6 { width: 66.6667%; }\n  .md\\:w-\\[240px\\] { width: 240px; }\n  .md\\:w-\\[300px\\] { width: 300px; }\n  .md\\:w-\\[400px\\] { width: 400px; }\n  .md\\:w-\\[48\\%\\] { width: 48%; }\n  .md\\:w-\\[508px\\] { width: 508px; }\n  .md\\:w-\\[800px\\] { width: 800px; }\n  .md\\:w-\\[920px\\] { width: 920px; }\n  .md\\:max-w-\\[200px\\] { max-width: 200px; }\n  .md\\:max-w-\\[504px\\] { max-width: 504px; }\n  .md\\:translate-x-0 { --tw-translate-x: 0px; transform: translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }\n  .md\\:\\!grid-cols-3 { grid-template-columns: repeat(3, minmax(0px, 1fr)) !important; }\n  .md\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0px, 1fr)); }\n  .md\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0px, 1fr)); }\n  .md\\:grid-cols-auto-fit-240 { grid-template-columns: repeat(auto-fit, minmax(240px, 240px)); }\n  .md\\:flex-row { flex-direction: row; }\n  .md\\:items-center { align-items: center; }\n  .md\\:justify-start { justify-content: flex-start; }\n  .md\\:justify-center { justify-content: center; }\n  .md\\:justify-between { justify-content: space-between; }\n  .md\\:justify-around { justify-content: space-around; }\n  .md\\:gap-0 { gap: 0px; }\n  .md\\:gap-2 { gap: 0.5rem; }\n  .md\\:gap-3 { gap: 0.75rem; }\n  .md\\:gap-4 { gap: 1rem; }\n  .md\\:gap-5 { gap: 1.25rem; }\n  .md\\:gap-6 { gap: 1.5rem; }\n  .md\\:whitespace-nowrap { white-space: nowrap; }\n  .md\\:rounded-xl { border-radius: 0.75rem; }\n  .md\\:bg-white { --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); }\n  .md\\:p-3 { padding: 0.75rem; }\n  .md\\:p-4 { padding: 1rem; }\n  .md\\:px-4 { padding-left: 1rem; padding-right: 1rem; }\n  .md\\:px-\\[108px\\] { padding-left: 108px; padding-right: 108px; }\n  .md\\:px-\\[34px\\] { padding-left: 34px; padding-right: 34px; }\n  .md\\:py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }\n  .md\\:py-4 { padding-top: 1rem; padding-bottom: 1rem; }\n  .md\\:pb-0 { padding-bottom: 0px; }\n  .md\\:pb-4 { padding-bottom: 1rem; }\n  .md\\:pb-6 { padding-bottom: 1.5rem; }\n  .md\\:pb-8 { padding-bottom: 2rem; }\n  .md\\:pl-6 { padding-left: 1.5rem; }\n  .md\\:pl-\\[21px\\] { padding-left: 21px; }\n  .md\\:pr-\\[11px\\] { padding-right: 11px; }\n  .md\\:pt-12 { padding-top: 3rem; }\n  .md\\:pt-2 { padding-top: 0.5rem; }\n  .md\\:pt-4 { padding-top: 1rem; }\n  .md\\:pt-5 { padding-top: 1.25rem; }\n  .md\\:text-base { font-size: 1rem; line-height: 1.5rem; }\n  .md\\:text-xl { font-size: 1.25rem; line-height: 1.75rem; }\n  .md\\:text-xs { font-size: 0.75rem; line-height: 1rem; }\n  .md\\:hover\\:text-orange-500:hover { --tw-text-opacity: 1; color: rgb(255 127 63/var(--tw-text-opacity,1)); }\n  .group:hover .group-hover\\:md\\:w-\\[280px\\] { width: 280px; }\n}\n@media (min-width: 1024px) {\n  .lg\\:absolute { position: absolute; }\n  .lg\\:mt-8 { margin-top: 2rem; }\n  .lg\\:mt-\\[94px\\] { margin-top: 94px; }\n  .lg\\:inline { display: inline; }\n  .lg\\:flex { display: flex; }\n  .lg\\:hidden { display: none; }\n  .lg\\:h-16 { height: 4rem; }\n  .lg\\:h-80 { height: 20rem; }\n  .lg\\:h-\\[calc\\(100vh-440px\\)\\] { height: calc(-440px + 100vh); }\n  .lg\\:w-3\\/5 { width: 60%; }\n  .lg\\:w-\\[260px\\] { width: 260px; }\n  .lg\\:w-\\[480px\\] { width: 480px; }\n  .lg\\:w-\\[500px\\] { width: 500px; }\n  .lg\\:w-\\[600px\\] { width: 600px; }\n  .lg\\:w-\\[712px\\] { width: 712px; }\n  .lg\\:max-w-5xl { max-width: 64rem; }\n  .lg\\:max-w-\\[780px\\] { max-width: 780px; }\n  .lg\\:\\!grid-cols-4 { grid-template-columns: repeat(4, minmax(0px, 1fr)) !important; }\n  .lg\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0px, 1fr)); }\n  .lg\\:grid-cols-5 { grid-template-columns: repeat(5, minmax(0px, 1fr)); }\n  .lg\\:flex-row { flex-direction: row; }\n  .lg\\:overflow-visible { overflow: visible; }\n  .lg\\:p-8 { padding: 2rem; }\n  .lg\\:px-44 { padding-left: 11rem; padding-right: 11rem; }\n  .lg\\:px-5 { padding-left: 1.25rem; padding-right: 1.25rem; }\n  .lg\\:px-8 { padding-left: 2rem; padding-right: 2rem; }\n  .lg\\:pt-8 { padding-top: 2rem; }\n  .lg\\:pt-\\[60px\\] { padding-top: 60px; }\n  .lg\\:text-base { font-size: 1rem; line-height: 1.5rem; }\n  .lg\\:text-xl { font-size: 1.25rem; line-height: 1.75rem; }\n}\n@media (min-width: 1280px) {\n  .xl\\:w-\\[480px\\] { width: 480px; }\n  .xl\\:min-w-\\[1120px\\] { min-width: 1120px; }\n}\n@media (min-width: 1536px) {\n  .\\32 xl\\:min-w-\\[40\\%\\] { min-width: 40%; }\n  .\\32 xl\\:max-w-\\[1024px\\] { max-width: 1024px; }\n}\n.\\[\\&\\:not\\(\\:first-child\\)\\]\\:mt-1:not(:first-child) { margin-top: 0.25rem; }\n.\\[\\&_\\[stroke-dasharray\\=\\'1px_1px\\'\\]\\]\\:\\!\\[stroke-dasharray\\:1px_0px\\] [stroke-dasharray=\"1px 1px\"] { stroke-dasharray: 1px, 0 !important; }\n\n/* ===== EXTERNAL STYLE #4 ===== */\n/* href: https://dearestie.xyz/_next/static/css/4692c01cf6edd1b4.css */\n/* method: cssRules */\n@font-face { font-family: rmel-iconfont; src: url(\"data:font/ttf;base64,AAEAAAALAIAAAwAwR1NVQrD+s+0AAAE4AAAAQk9TLzI940+UAAABfAAAAFZjbWFwQOSPXQAAAjwAAAMIZ2x5ZjCJoW0AAAV8AAAPYGhlYWQbUPpPAAAA4AAAADZoaGVhB94DmwAAALwAAAAkaG10eGgAAAAAAAHUAAAAaGxvY2E1+jIAAAAFRAAAADZtYXhwATAAewAAARgAAAAgbmFtZXPc7cIAABTcAAACqXBvc3QnKb+uAAAXiAAAATUAAQAAA4D/gABcBAAAAAAABAAAAQAAAAAAAAAAAAAAAAAAABoAAQAAAAEAAOLjgrdfDzz1AAsEAAAAAADcGNspAAAAANwY2ykAAP//BAADAQAAAAgAAgAAAAAAAAABAAAAGgBvAAwAAAAAAAIAAAAKAAoAAAD/AAAAAAAAAAEAAAAKAB4ALAABREZMVAAIAAQAAAAAAAAAAQAAAAFsaWdhAAgAAAABAAAAAQAEAAQAAAABAAgAAQAGAAAAAQAAAAAAAQQAAZAABQAIAokCzAAAAI8CiQLMAAAB6wAyAQgAAAIABQMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUGZFZABA523togOA/4AAXAOAAIAAAAABAAAAAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAAAAAFAAAAAwAAACwAAAAEAAABzAABAAAAAADGAAMAAQAAACwAAwAKAAABzAAEAJoAAAAWABAAAwAG523pQe087UXtYe117XjtgO2N7aL//wAA523pQe077UTtX+1v7XftgO2M7Z///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAFgAWABYAGAAaAB4AKgAsACwALgAAAAEABAAFAAMABgAHAAgACQAKAAsADAANAA4ADwAQABEAEgATAAIAFAAVABYAFwAYABkAAAEGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAATwAAAAAAAAAGQAA520AAOdtAAAAAQAA6UEAAOlBAAAABAAA7TsAAO07AAAABQAA7TwAAO08AAAAAwAA7UQAAO1EAAAABgAA7UUAAO1FAAAABwAA7V8AAO1fAAAACAAA7WAAAO1gAAAACQAA7WEAAO1hAAAACgAA7W8AAO1vAAAACwAA7XAAAO1wAAAADAAA7XEAAO1xAAAADQAA7XIAAO1yAAAADgAA7XMAAO1zAAAADwAA7XQAAO10AAAAEAAA7XUAAO11AAAAEQAA7XcAAO13AAAAEgAA7XgAAO14AAAAEwAA7YAAAO2AAAAAAgAA7YwAAO2MAAAAFAAA7Y0AAO2NAAAAFQAA7Z8AAO2fAAAAFgAA7aAAAO2gAAAAFwAA7aEAAO2hAAAAGAAA7aIAAO2iAAAAGQAAAAAAZgDMAR4BhAG8Af4CZgLIAv4DNANyA6IEQASoBO4FLgVwBcoGCgZqBqQGxAboB0YHsAAAAAUAAAAAA1YC1gALABgAJQA0AEAAABMhMhYUBgchLgE0Nhc+ATchHgEUBiMhIiYDNDY3IR4BFAYjISImNz4BMyEyHgEUDgEjISImJxYUDwEGJjURNDYX1gJUEhkZEv2sEhkZ2gEYEwFgEhkZEv6gEhn0GRICVBIZGRL9rBIZ8wEYEwFgDBQLCxQM/qASGTkICJILHh4LAtUZJRgBARglGfITGAEBGCUZGf6FExgBARglGRnZEhkLFRcUDBqGBhYGlQwMEQEqEQwMAAAAAAwAAAAAA6sCqwAPABMAFwAbAB8AIwAnADMANwA7AD8AQwAAASEOAQcDHgEXIT4BNxEuAQUzFSMVMxUjJzMVIxUzFSsCNTM1IzUzASEiJjQ2MyEyFhQGNyM1MzUjNTMXIzUzNSM1MwNV/VYkMAEBATEkAqokMQEBMf5cVlZWVoBWVlZWKlZWVlYBVf8AEhgYEgEAEhgYGVZWVlaAVlZWVgKrATEk/lYkMQEBMSQBqiQxf1YqVtZWKlZWKlb+gBgkGRkkGKpWKlbWVipWAAMAAAAAAysDAAAPAB8AMwAAJR4BFyE+ATcRLgEnIQ4BBzMhMhYXEQ4BByEuAScRPgElJyYrASIPASMiBhQWMyEyNjQmIwEAATAkAVYkMAEBMCT+qiQwAYABABMXAQEXE/8AExcBARcBKB4LErQSCx5rExcXEwIAERkZEVUkMAEBMCQBqyQwAQEwJBcU/qsRGQEBGREBVRQX1R4NDR4XJxcXJxcAAwAAAAADqwLZABYALQA+AAABFQYPAQYiLwEmND8BJyY0PwE2Mh8BFgU3NjQvASYiDwEGBxUWHwEWMj8BNjQnAScmBgcDBhYfARY2NxM2JicDqwEJsAcRBx4GBpOTBgYeBxEHsAn9D5MGBh8GEgawCQEBCbAHEQceBgYBQikJDwTjAgcIKAkPBOIDBwkBiBANCrAGBh4HEQaTkwYSBh4GBrAKFZMGEQceBgawCg0QDQqwBgYeBhIGAdkPAwcI/YwIEAMOAwcIAnMIDwQAAgAAAAADmgJvABAAIQAAJSc3NjQmIg8BBhQfARYyNjQlNycmNDYyHwEWFA8BBiImNAFzpqYNGSQMxA0NxA4hGgENpqYNGiEOxA0NxA4hGtqmpg4hGg3EDSINxA0aIQ6mpgwkGQ3EDSINxA0ZJAAAAAMAAAAAA7gCrAALABcAIwAAAQ4BBx4BFz4BNy4BAy4BJz4BNx4BFw4BAw4BBx4BFz4BNy4BAgCY6zU165iY6zU165hWcAICcFZWcAICcFY0QwEBQzQ0QwEBQwKsAqSGhqQCAqSGhqT+DgJwVlZwAgJwVlZwAT4BQzQ0QwEBQzQ0QwAAAAUAAAAAA4ACqwALABcAIwAwAEAAABMhMjY0JiMhIgYUFhchPgE0JichDgEUFhMhMjY0JiMhIgYUFiceARchPgE0JichDgElIR4BFxEOAQchLgE1ETQ2qwEAExcXE/8AERkZEQEAExcXE/8AERkZEQEAExcXE/8AERkZGgEZEQEAExcXE/8AERkB1AEAERkBARkR/wATFxcBABcnFxcnF6sBGSIZAQEZIhkBVRcnFxcnF9UTFwEBFyYXAQEXGAEXE/4AERkBARkRAgATFwAAAAADAAAAAAOrAlYAGQAmAEAAAAEjIgYUFjsBHgEXDgEHIyIGFBY7AT4BNy4BBR4BFyE+ATQmJyEOARcjLgEnPgE3MzI2NCYrAQ4BBx4BFzMyNjQmAtWAEhgYEoA3SAEBSDeAEhgYEoBbeAMDeP4lARgSAQASGBgS/wASGFWAN0gBAUg3gBIYGBKAW3gDA3hbgBIYGAJVGCQZAUk2NkkBGSQYAnhbW3jTEhgBARgkGAEBGJIBSTY2SQEZJBgCeFtbeAIYJBkAAQAAAAADrAIrAB4AAAEuAScOAQcGFhcWNjc+ATcyFhcHBhYXMz4BNzUuAQcDEjuWVYfUOAoTFxQjCSuhZz9vLFETEx7uEhgBAjEWAbw0OgECiXIXKggGDxJWaQErJVIWMQIBGBLvHRQTAAAAAQAAAAADsgIrAB4AAAEOAQcnJgYHFR4BFzM+AS8BPgEzHgEXHgE3PgEnLgECFFWWO1EWMQIBGBLuHhQTUi1vPmehKwkkExcTCjnTAisBOjRQFBQd7xIYAQIxFlIlKwFpVhIPBggqF3KJAAAAAwAAAAAC9QK/ABQAHAAkAAABPgE3LgEnIw4BBxEeARchPgE3NCYlMx4BFAYHIxMjNTMeARQGApMhKQECZk7vFBkBARkUAQdJaQI0/tSIHScnHYifn58dJycBihdEJE5mAgEaE/3eExoBAmFJNVLZASY7JgH+74kBJjsmAAEAAAAAAxICvwAcAAABHgEXMwMjDgEUFhczPgE0JicjEzM+ATQmJyMOAQGlASYdIZw7HSYmHeQdJiYdIZw7HSYmHeQdJgJ6HSYB/pQBJjonAQEnOiYBAWwBJjonAQEnAAYAAAAAA5YC1gALABcAIwBBAFIAbgAAASE+ATQmJyEOARQWASEOARQWFyE+ATQmAyEOARQWFyE+ATQmBSMiBhQWOwEVIyIGFBY7ARUjIgYUFjsBMjY3NS4BAzMVHgEyNj0BNCYrASIGFBYXIyIGFBY7AQcGHQEUFjsBMjY0JisBNzY9AS4BAWsCABIYGBL+ABIZGQIS/gASGRkSAgASGBgS/gASGRkSAgASGBj9WFUJDAwJQBUKCwsKFUAJDAwJVQoLAQELXxUBCxMMDAkrCQwMXlUJDAwJN0cFDAlVCgsLCjdIBQELAlUBGCQYAQEYJBj+VQEYJBgBARgkGAEBARgkGAEBGCQY1QwSDBYMEgwWDBIMDAmACQwB1msJDAwJgAkMDBIM1gwSDFQGCAkJDAwSDFQGCAkJDAAAAAAGAAAAAAOLAsAACAARABoAJgAyAD8AABMOARQWMjY0JgMOARQWMjY0JgMOARQWMjY0JhchPgE0JichDgEUFjchPgE0JichDgEUFgMeARchPgE0JichDgG1GyQkNyQkHBskJDckJBwbJCQ2JSSPAgASGBgS/gASGBgSAgASGBgS/gASGBgZARgSAgASGBgS/gASGAHAASQ2JCQ2JAEBASQ2JCQ2JP4BASQ2JCQ2JGoBGCQYAQEYJBj/ARgkGAEBGCQYASoSGAEBGCQYAQEYAAAAAgAAAAADVgJWABYALQAAJTI2PwE2PQEuASsBIgYdARQWFzMHBhYFMjY/ATY9ATQmKwEiBgcVHgEXMwcGFgEyERsHPQkBGBKrEhgYElYsDiABzBAbCDwJGBKrEhgBARgSVSwNIKsRDnkSFMISGBgSqxIYAVgeMwERDnkSFMISGBgSqxIYAVgeMwAAAAADAAAAAAOAAsAACAAZACUAACU+ATc1IxUeAQEeARczFTM1Mz4BNCYnIQ4BAyE+ATQmJyEOARQWAgAkMAGqATD++QEkG5aqlhskJBv+KhskKwKqEhkZEv1WEhkZQAEwJCsrJDACPxskAYCAASQ2JAEBJP56ARgkGAEBGCQYAAAAAAIAAP//AysDAQAbACgAACU+ATcRLgEiBgcRFAYHBi4CNREuASIGBxEeAQceATMhMjY0JiMhIgYCImJ6AgEeLR4BQTUhQTUdAR4tHgEDptQBGBICABIYGBL+ABIYrQ+TZQEXFh4eFv7kN1MMBw8rPCMBIBYeHhb+4HaUdhIZGSQYGAAAAAMAAAAAA3ACxwALAC0AOQAAEyE+ATQmIyEiBhQWBSEiBhQWFyEyFhcWBgcjNS4BDwEGFB8BFjY3NTM+AScuAQUjIgYUFhczPgE0JsACVRIZGRL9qxIYGAIL/gcSGBgSAgYgMwYFMShgARkLTAYGTAwYAVVNYgUIZP5tqxIYGBKrEhgYAnEBGCQYGCQYrBgkGAEnICk5AiIPCgpMBxEHTAoKDyICa05EVf8YJBgBARgkGAAAAAIAAAAAA5YCwAAUACgAAAEUFhczER4BMjY3ETM+ATQmJyEOAQMzFRQWMjY3NTMyNjQmJyEOARQWAWskHJUBJDYkAZUcJCQc/lYcJMBAJDckAUAbJCQb/wAcJCQCgBskAf5AGyQkGwHAASQ2JAEBJP7Q6xskJBvrJDckAQEkNyQACgAAAAADeAL4AA8AFgAaACEAJQApAC0ANAA4AD8AAAEhDgEHER4BFyE+ATcRLgEBIyImPQEzNSM1MzUjNTQ2OwETIzUzNSM1MzUjNTMTIzUzFRQGNyM1MzUjNTMyFhUDLP2oICoBASogAlggKgEBKv4ecQ8WlpaWlhYPceGWlpaWlpa8cZYWFpaWlnEPFgL3ASog/aggKgEBKiACWCAq/V4WD3FLlktxDxb9qJZLlkuW/aiWcQ8W4ZZLlhYPAAAAAgAA//8DgAMAAA8AIAAAJREuASchDgEHER4BFyE+ASUXNzYyHwEWBiMhIiY/AT4BA4ABMCT9qiQwAQEwJAJWJDD9/VmFBxQHlQgMDf4BDgsIagcUVQJWJDABATAk/aokMAEBMPtsqggJxwsXFwuJCAEAAAABAAAAAAM1AjYAEAAAAQcGFBYyPwEXFjI2NC8BJiIB2f4QISwR19cRLCEQ/hAuAib+ESwhENfXECEsEf4QAAAAAQAAAAADNQI2ABIAAAEHJyYnIg4BFh8BFjI/ATY0LgEC1tbXEBcRGw0GDP4RLBH+ECEtAibX1w8BEiAgDP4QEP4QLSABAAAABAAAAAADawLrABAAIQAzAEQAADczFRQWMjY9ATQmKwEiBhQWEyMiBhQWOwEyNj0BNCYiBhUBMjY9ATMyNjQmKwEiBh0BFBYTNTQmIgYdARQWOwEyNjQmI8loHiwdHRacFh0dfmgWHR0WnBYdHSweAWoWHmgWHR0WnBYdHUoeLB0dFpwWHR0WsWgWHR0WnBYdHSweAZ4eLB0dFpwWHR0W/V8dFmgeLB0dFpwWHQI5aBYdHRacFh0dLB4AAAAEAAAAAANUAtQAEQAjADQARgAAEw4BBxUeARczPgE0JisBNTQmJz4BPQEzMjY0JicjDgEHFR4BASMiBhQWFzM+ATc1LgEiBhUDHgE7ARUUFjI2NzUuAScjDgHdFRsBARsVkRUbGxVhHBQUHGEVGxsVkRUbAQEbAithFRsbFZEVGwEBGykckgEbFWEcKRsBARsVkRUbAR8BGxWRFRsBARspHGEVG8MBGxVhHCkbAQEbFZEVG/6rHCkbAQEbFZEVGxsVAbUUHGEVGxsVkRUbAQEbAAAAAAAAEgDeAAEAAAAAAAAAFQAAAAEAAAAAAAEADQAVAAEAAAAAAAIABwAiAAEAAAAAAAMADQApAAEAAAAAAAQADQA2AAEAAAAAAAUACwBDAAEAAAAAAAYADQBOAAEAAAAAAAoAKwBbAAEAAAAAAAsAEwCGAAMAAQQJAAAAKgCZAAMAAQQJAAEAGgDDAAMAAQQJAAIADgDdAAMAAQQJAAMAGgDrAAMAAQQJAAQAGgEFAAMAAQQJAAUAFgEfAAMAAQQJAAYAGgE1AAMAAQQJAAoAVgFPAAMAAQQJAAsAJgGlCkNyZWF0ZWQgYnkgaWNvbmZvbnQKcm1lbC1pY29uZm9udFJlZ3VsYXJybWVsLWljb25mb250cm1lbC1pY29uZm9udFZlcnNpb24gMS4wcm1lbC1pY29uZm9udEdlbmVyYXRlZCBieSBzdmcydHRmIGZyb20gRm9udGVsbG8gcHJvamVjdC5odHRwOi8vZm9udGVsbG8uY29tAAoAQwByAGUAYQB0AGUAZAAgAGIAeQAgAGkAYwBvAG4AZgBvAG4AdAAKAHIAbQBlAGwALQBpAGMAbwBuAGYAbwBuAHQAUgBlAGcAdQBsAGEAcgByAG0AZQBsAC0AaQBjAG8AbgBmAG8AbgB0AHIAbQBlAGwALQBpAGMAbwBuAGYAbwBuAHQAVgBlAHIAcwBpAG8AbgAgADEALgAwAHIAbQBlAGwALQBpAGMAbwBuAGYAbwBuAHQARwBlAG4AZQByAGEAdABlAGQAIABiAHkAIABzAHYAZwAyAHQAdABmACAAZgByAG8AbQAgAEYAbwBuAHQAZQBsAGwAbwAgAHAAcgBvAGoAZQBjAHQALgBoAHQAdABwADoALwAvAGYAbwBuAHQAZQBsAGwAbwAuAGMAbwBtAAAAAAIAAAAAAAAACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGgECAQMBBAEFAQYBBwEIAQkBCgELAQwBDQEOAQ8BEAERARIBEwEUARUBFgEXARgBGQEaARsAA3RhYghrZXlib2FyZAZkZWxldGUKY29kZS1ibG9jawRjb2RlCnZpc2liaWxpdHkKdmlldy1zcGxpdARsaW5rBHJlZG8EdW5kbwRib2xkBml0YWxpYwxsaXN0LW9yZGVyZWQObGlzdC11bm9yZGVyZWQFcXVvdGUNc3RyaWtldGhyb3VnaAl1bmRlcmxpbmUEd3JhcAlmb250LXNpemUEZ3JpZAVpbWFnZQtleHBhbmQtbGVzcwtleHBhbmQtbW9yZQ9mdWxsc2NyZWVuLWV4aXQKZnVsbHNjcmVlbgAAAAAA\") format(\"truetype\"); }\n.rmel-iconfont { font-size: 16px; font-style: normal; -webkit-font-smoothing: antialiased; font-family: rmel-iconfont !important; }\n.rmel-icon-tab::before { content: \"\"; }\n.rmel-icon-keyboard::before { content: \"\"; }\n.rmel-icon-delete::before { content: \"\"; }\n.rmel-icon-code-block::before { content: \"\"; }\n.rmel-icon-code::before { content: \"\"; }\n.rmel-icon-visibility::before { content: \"\"; }\n.rmel-icon-view-split::before { content: \"\"; }\n.rmel-icon-link::before { content: \"\"; }\n.rmel-icon-redo::before { content: \"\"; }\n.rmel-icon-undo::before { content: \"\"; }\n.rmel-icon-bold::before { content: \"\"; }\n.rmel-icon-italic::before { content: \"\"; }\n.rmel-icon-list-ordered::before { content: \"\"; }\n.rmel-icon-list-unordered::before { content: \"\"; }\n.rmel-icon-quote::before { content: \"\"; }\n.rmel-icon-strikethrough::before { content: \"\"; }\n.rmel-icon-underline::before { content: \"\"; }\n.rmel-icon-wrap::before { content: \"\"; }\n.rmel-icon-font-size::before { content: \"\"; }\n.rmel-icon-grid::before { content: \"\"; }\n.rmel-icon-image::before { content: \"\"; }\n.rmel-icon-expand-less::before { content: \"\"; }\n.rmel-icon-expand-more::before { content: \"\"; }\n.rmel-icon-fullscreen-exit::before { content: \"\"; }\n.rmel-icon-fullscreen::before { content: \"\"; }\n.rc-md-editor { padding-bottom: 1px; position: relative; border: 1px solid rgb(224, 224, 224); background: rgb(255, 255, 255); box-sizing: border-box; display: flex; flex-direction: column; }\n.rc-md-editor.full { width: 100%; position: fixed; left: 0px; top: 0px; z-index: 1000; height: 100% !important; }\n.rc-md-editor .editor-container { flex: 1 1 0%; display: flex; width: 100%; min-height: 0px; position: relative; }\n.rc-md-editor .editor-container > .section { flex: 1 1 1px; border-right: 1px solid rgb(224, 224, 224); }\n.rc-md-editor .editor-container > .section.in-visible { display: none; }\n.rc-md-editor .editor-container > .section > .section-container { padding: 10px 15px 15px; }\n.rc-md-editor .editor-container > .section:last-child { }\n.rc-md-editor .editor-container .sec-md { min-height: 0px; min-width: 0px; }\n.rc-md-editor .editor-container .sec-md .input { display: block; box-sizing: border-box; width: 100%; height: 100%; overflow-y: scroll; border: none; resize: none; outline: none; min-height: 0px; background: rgb(255, 255, 255); color: rgb(51, 51, 51); font-size: 14px; line-height: 1.7; }\n.rc-md-editor .editor-container .sec-html { min-height: 0px; min-width: 0px; }\n.rc-md-editor .editor-container .sec-html .html-wrap { height: 100%; box-sizing: border-box; overflow: auto; }\n.custom-html-style { color: rgb(51, 51, 51); }\n.custom-html-style h1 { font-size: 32px; padding: 0px; border: none; font-weight: 700; margin: 32px 0px; line-height: 1.2; }\n.custom-html-style h2 { font-size: 24px; padding: 0px; border: none; font-weight: 700; margin: 24px 0px; line-height: 1.7; }\n.custom-html-style h3 { font-size: 18px; margin: 18px 0px; padding: 0px; line-height: 1.7; border: none; }\n.custom-html-style p { font-size: 14px; line-height: 1.7; margin: 8px 0px; }\n.custom-html-style a { color: rgb(0, 82, 217); }\n.custom-html-style a:hover { text-decoration: none; }\n.custom-html-style strong { font-weight: 700; }\n.custom-html-style ol, .custom-html-style ul { font-size: 14px; line-height: 28px; padding-left: 36px; }\n.custom-html-style li { margin-bottom: 8px; line-height: 1.7; }\n.custom-html-style hr { margin-top: 20px; margin-bottom: 20px; border-width: 1px 0px 0px; border-right-style: initial; border-bottom-style: initial; border-left-style: initial; border-right-color: initial; border-bottom-color: initial; border-left-color: initial; border-image: initial; border-top-style: solid; border-top-color: rgb(238, 238, 238); }\n.custom-html-style pre { display: block; padding: 20px; line-height: 28px; word-break: break-word; }\n.custom-html-style code, .custom-html-style pre { background-color: rgb(245, 245, 245); font-size: 14px; border-radius: 0px; overflow-x: auto; }\n.custom-html-style code { padding: 3px 0px; margin: 0px; word-break: normal; }\n.custom-html-style code::after, .custom-html-style code::before { letter-spacing: 0px; }\n.custom-html-style blockquote { position: relative; margin: 16px 0px; padding: 5px 8px 5px 30px; background: none 0px 0px repeat scroll rgba(102, 128, 153, 0.05); color: rgb(51, 51, 51); border-top: none; border-right: none; border-bottom: none; border-image: initial; border-left: 10px solid rgb(214, 219, 223); }\n.custom-html-style img, .custom-html-style video { max-width: 100%; }\n.custom-html-style table { font-size: 14px; line-height: 1.7; max-width: 100%; overflow: auto; border: 1px solid rgb(246, 246, 246); border-collapse: collapse; border-spacing: 0px; box-sizing: border-box; }\n.custom-html-style table td, .custom-html-style table th { word-break: break-all; overflow-wrap: break-word; white-space: normal; }\n.custom-html-style table tr { border: 1px solid rgb(239, 239, 239); }\n.custom-html-style table tr:nth-child(2n) { background-color: transparent; }\n.custom-html-style table th { text-align: center; font-weight: 700; border: 1px solid rgb(239, 239, 239); padding: 10px 6px; background-color: rgb(245, 247, 250); word-break: break-word; }\n.custom-html-style table td { border: 1px solid rgb(239, 239, 239); text-align: left; padding: 10px 15px; word-break: break-word; min-width: 60px; }\n.rc-md-editor .drop-wrap { display: block; position: absolute; left: 0px; top: 28px; z-index: 2; min-width: 20px; padding: 10px 0px; text-align: center; background-color: rgb(255, 255, 255); border-color: rgb(241, 241, 241) rgb(221, 221, 221) rgb(221, 221, 221) rgb(241, 241, 241); border-style: solid; border-width: 1px; }\n.rc-md-editor .drop-wrap.hidden { display: none !important; }\n.rc-md-editor .rc-md-navigation { min-height: 38px; padding: 0px 8px; box-sizing: border-box; border-bottom: 1px solid rgb(224, 224, 224); font-size: 16px; background: rgb(245, 245, 245); user-select: none; display: flex; flex-direction: row; justify-content: space-between; }\n.rc-md-editor .rc-md-navigation.in-visible { display: none; }\n.rc-md-editor .rc-md-navigation .navigation-nav { align-items: center; justify-content: center; font-size: 14px; color: rgb(117, 117, 117); }\n.rc-md-editor .rc-md-navigation .button-wrap, .rc-md-editor .rc-md-navigation .navigation-nav { display: flex; flex-direction: row; }\n.rc-md-editor .rc-md-navigation .button-wrap { flex-wrap: wrap; }\n.rc-md-editor .rc-md-navigation .button-wrap .button { position: relative; min-width: 24px; height: 28px; margin-left: 3px; margin-right: 3px; display: inline-block; cursor: pointer; line-height: 28px; text-align: center; color: rgb(117, 117, 117); }\n.rc-md-editor .rc-md-navigation .button-wrap .button:hover { color: rgb(33, 33, 33); }\n.rc-md-editor .rc-md-navigation .button-wrap .button.disabled { color: rgb(189, 189, 189); cursor: not-allowed; }\n.rc-md-editor .rc-md-navigation .button-wrap .button:first-child { margin-left: 0px; }\n.rc-md-editor .rc-md-navigation .button-wrap .button:last-child { margin-right: 0px; }\n.rc-md-editor .rc-md-navigation .button-wrap .rmel-iconfont { font-size: 18px; }\n.rc-md-editor .rc-md-navigation li, .rc-md-editor .rc-md-navigation ul { list-style: none; margin: 0px; padding: 0px; }\n.rc-md-editor .rc-md-navigation .h1, .rc-md-editor .rc-md-navigation .h2, .rc-md-editor .rc-md-navigation .h3, .rc-md-editor .rc-md-navigation .h4, .rc-md-editor .rc-md-navigation .h5, .rc-md-editor .rc-md-navigation .h6, .rc-md-editor .rc-md-navigation h1, .rc-md-editor .rc-md-navigation h2, .rc-md-editor .rc-md-navigation h3, .rc-md-editor .rc-md-navigation h4, .rc-md-editor .rc-md-navigation h5, .rc-md-editor .rc-md-navigation h6 { font-family: inherit; font-weight: 500; color: inherit; padding: 0px; margin: 0px; line-height: 1.1; }\n.rc-md-editor .rc-md-navigation h1 { font-size: 34px; }\n.rc-md-editor .rc-md-navigation h2 { font-size: 30px; }\n.rc-md-editor .rc-md-navigation h3 { font-size: 24px; }\n.rc-md-editor .rc-md-navigation h4 { font-size: 18px; }\n.rc-md-editor .rc-md-navigation h5 { font-size: 14px; }\n.rc-md-editor .rc-md-navigation h6 { font-size: 12px; }\n.rc-md-editor .tool-bar { position: absolute; z-index: 1; right: 8px; top: 8px; }\n.rc-md-editor .tool-bar .button { min-width: 24px; height: 28px; margin-right: 5px; display: inline-block; cursor: pointer; font-size: 14px; line-height: 28px; text-align: center; color: rgb(153, 153, 153); }\n.rc-md-editor .tool-bar .button:hover { color: rgb(51, 51, 51); }\n.rc-md-editor .rc-md-divider { display: block; width: 1px; background-color: rgb(224, 224, 224); }\n.rc-md-editor .table-list.wrap { position: relative; margin: 0px 10px; box-sizing: border-box; }\n.rc-md-editor .table-list.wrap .list-item { position: absolute; top: 0px; left: 0px; display: inline-block; width: 20px; height: 20px; background-color: rgb(224, 224, 224); border-radius: 3px; }\n.rc-md-editor .table-list.wrap .list-item.active { background: rgb(158, 158, 158); }\n.rc-md-editor .tab-map-list .list-item { width: 120px; box-sizing: border-box; }\n.rc-md-editor .tab-map-list .list-item:hover { background: rgb(245, 245, 245); }\n.rc-md-editor .tab-map-list .list-item.active { font-weight: 700; }\n.rc-md-editor .header-list .list-item { width: 100px; box-sizing: border-box; padding: 8px 0px; }\n.rc-md-editor .header-list .list-item:hover { background: rgb(245, 245, 245); }\n.rc-pagination { display: flex; margin: 0px; padding: 0px; font-size: 14px; }\n.rc-pagination ol, .rc-pagination ul { margin: 0px; padding: 0px; list-style: none; }\n.rc-pagination-start { justify-content: start; }\n.rc-pagination-center { justify-content: center; }\n.rc-pagination-end { justify-content: end; }\n.rc-pagination::after { display: block; clear: both; height: 0px; overflow: hidden; visibility: hidden; content: \" \"; }\n.rc-pagination-item, .rc-pagination-total-text { display: inline-block; height: 28px; margin-right: 8px; line-height: 26px; vertical-align: middle; }\n.rc-pagination-item { min-width: 28px; font-family: Arial; text-align: center; list-style: none; background-color: rgb(255, 255, 255); border: 1px solid rgb(217, 217, 217); border-radius: 2px; outline: 0px; cursor: pointer; user-select: none; }\n.rc-pagination-item a { display: block; padding: 0px 6px; color: rgba(0, 0, 0, 0.85); transition: none; }\n.rc-pagination-item a:hover { text-decoration: none; }\n.rc-pagination-item:focus, .rc-pagination-item:hover { border-color: rgb(24, 144, 255); transition: 0.3s; }\n.rc-pagination-item:focus a, .rc-pagination-item:hover a { color: rgb(24, 144, 255); }\n.rc-pagination-item-active { font-weight: 500; background: rgb(255, 255, 255); border-color: rgb(24, 144, 255); }\n.rc-pagination-item-active a { color: rgb(24, 144, 255); }\n.rc-pagination-item-active:focus, .rc-pagination-item-active:hover { border-color: rgb(64, 169, 255); }\n.rc-pagination-item-active:focus a, .rc-pagination-item-active:hover a { color: rgb(64, 169, 255); }\n.rc-pagination-jump-next, .rc-pagination-jump-prev { outline: 0px; }\n.rc-pagination-jump-next button, .rc-pagination-jump-prev button { background: transparent; border: none; cursor: pointer; color: rgb(102, 102, 102); }\n.rc-pagination-jump-next button::after, .rc-pagination-jump-prev button::after { display: block; content: \"•••\"; }\n.rc-pagination-jump-next, .rc-pagination-jump-prev, .rc-pagination-prev { margin-right: 8px; }\n.rc-pagination-jump-next, .rc-pagination-jump-prev, .rc-pagination-next, .rc-pagination-prev { display: inline-block; min-width: 28px; height: 28px; color: rgba(0, 0, 0, 0.85); font-family: Arial; line-height: 28px; text-align: center; vertical-align: middle; list-style: none; border-radius: 2px; cursor: pointer; transition: 0.3s; }\n.rc-pagination-next, .rc-pagination-prev { outline: 0px; }\n.rc-pagination-next button, .rc-pagination-prev button { color: rgba(0, 0, 0, 0.85); cursor: pointer; user-select: none; }\n.rc-pagination-next:hover button, .rc-pagination-prev:hover button { border-color: rgb(64, 169, 255); }\n.rc-pagination-next .rc-pagination-item-link, .rc-pagination-prev .rc-pagination-item-link { display: block; width: 100%; height: 100%; font-size: 12px; text-align: center; background-color: rgb(255, 255, 255); border: 1px solid rgb(217, 217, 217); border-radius: 2px; outline: none; transition: 0.3s; }\n.rc-pagination-next:focus .rc-pagination-item-link, .rc-pagination-next:hover .rc-pagination-item-link, .rc-pagination-prev:focus .rc-pagination-item-link, .rc-pagination-prev:hover .rc-pagination-item-link { color: rgb(24, 144, 255); border-color: rgb(24, 144, 255); }\n.rc-pagination-prev button::after { content: \"‹\"; display: block; }\n.rc-pagination-next button::after { content: \"›\"; display: block; }\n.rc-pagination-disabled, .rc-pagination-disabled:focus, .rc-pagination-disabled:hover { cursor: not-allowed; }\n.rc-pagination-disabled .rc-pagination-item-link, .rc-pagination-disabled:focus .rc-pagination-item-link, .rc-pagination-disabled:hover .rc-pagination-item-link { color: rgba(0, 0, 0, 0.25); border-color: rgb(217, 217, 217); cursor: not-allowed; }\n.rc-pagination-slash { margin: 0px 10px 0px 12px; }\n.rc-pagination-options { display: inline-block; margin-left: 16px; vertical-align: middle; }\n@media (-ms-high-contrast:none) {\n}\n.rc-pagination-options-size-changer.rc-select { display: inline-block; width: auto; margin-right: 8px; }\n.rc-pagination-options-quick-jumper { display: inline-block; height: 28px; line-height: 28px; vertical-align: top; }\n.rc-pagination-options-quick-jumper input { width: 50px; margin: 0px 8px; }\n.rc-pagination-simple .rc-pagination-next, .rc-pagination-simple .rc-pagination-prev { height: 24px; line-height: 24px; vertical-align: top; }\n.rc-pagination-simple .rc-pagination-next .rc-pagination-item-link, .rc-pagination-simple .rc-pagination-prev .rc-pagination-item-link { height: 24px; background-color: transparent; border: 0px; }\n.rc-pagination-simple .rc-pagination-next .rc-pagination-item-link::after, .rc-pagination-simple .rc-pagination-prev .rc-pagination-item-link::after { height: 24px; line-height: 24px; }\n.rc-pagination-simple .rc-pagination-simple-pager { display: flex; align-items: center; height: 24px; margin-right: 8px; }\n.rc-pagination-simple .rc-pagination-simple-pager input { box-sizing: border-box; height: 100%; padding: 0px 6px; text-align: center; background-color: rgb(255, 255, 255); border: 1px solid rgb(217, 217, 217); border-radius: 2px; outline: none; transition: border-color 0.3s; }\n.rc-pagination-simple .rc-pagination-simple-pager input:hover { border-color: rgb(24, 144, 255); }\n.rc-pagination.rc-pagination-disabled { cursor: not-allowed; }\n.rc-pagination.rc-pagination-disabled .rc-pagination-item { background: rgb(245, 245, 245); border-color: rgb(217, 217, 217); cursor: not-allowed; }\n.rc-pagination.rc-pagination-disabled .rc-pagination-item a { color: rgba(0, 0, 0, 0.25); background: transparent; border: none; cursor: not-allowed; }\n.rc-pagination.rc-pagination-disabled .rc-pagination-item-active { background: rgb(219, 219, 219); border-color: transparent; }\n.rc-pagination.rc-pagination-disabled .rc-pagination-item-active a { color: rgb(255, 255, 255); }\n.rc-pagination.rc-pagination-disabled .rc-pagination-item-link { color: rgba(0, 0, 0, 0.25); background: rgb(245, 245, 245); border-color: rgb(217, 217, 217); cursor: not-allowed; }\n.rc-pagination.rc-pagination-disabled .rc-pagination-item-link-icon { opacity: 0; }\n.rc-pagination.rc-pagination-disabled .rc-pagination-item-ellipsis { opacity: 1; }\n@media only screen and (max-width: 992px) {\n  .rc-pagination-item-after-jump-prev, .rc-pagination-item-before-jump-next { display: none; }\n}\n@media only screen and (max-width: 576px) {\n  .rc-pagination-options { display: none; }\n}\n.react-rater { line-height: normal; }\n.react-rater, .react-rater > * { display: inline-block; }\n.react-rater-star { cursor: pointer; color: rgb(204, 204, 204); position: relative; }\n.react-rater-star.will-be-active { color: rgb(102, 102, 102); }\n.react-rater-star.is-active { color: rgb(0, 0, 0); }\n.react-rater-star.is-active-half::before { color: rgb(0, 0, 0); content: \"★\"; position: absolute; left: 0px; width: 50%; overflow: hidden; }\n.react-rater-star.is-disabled { cursor: default; }\n\n/* ===== EXTERNAL STYLE #5 ===== */\n/* href: https://dearestie.xyz/_next/static/css/1eeebdacc3df5779.css */\n/* method: cssRules */\n.markdown-body { text-size-adjust: 100%; margin: 0px; color: rgb(16, 24, 40); background-color: var(--color-canvas-default); font-weight: 400; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; user-select: text; }\n.light, :root { color-scheme: light; --color-prettylights-syntax-comment: #6e7781; --color-prettylights-syntax-constant: #0550ae; --color-prettylights-syntax-entity: #8250df; --color-prettylights-syntax-storage-modifier-import: #24292f; --color-prettylights-syntax-entity-tag: #116329; --color-prettylights-syntax-keyword: #cf222e; --color-prettylights-syntax-string: #0a3069; --color-prettylights-syntax-variable: #953800; --color-prettylights-syntax-brackethighlighter-unmatched: #82071e; --color-prettylights-syntax-invalid-illegal-text: #f6f8fa; --color-prettylights-syntax-invalid-illegal-bg: #82071e; --color-prettylights-syntax-carriage-return-text: #f6f8fa; --color-prettylights-syntax-carriage-return-bg: #cf222e; --color-prettylights-syntax-string-regexp: #116329; --color-prettylights-syntax-markup-list: #3b2300; --color-prettylights-syntax-markup-heading: #0550ae; --color-prettylights-syntax-markup-italic: #24292f; --color-prettylights-syntax-markup-bold: #24292f; --color-prettylights-syntax-markup-deleted-text: #82071e; --color-prettylights-syntax-markup-deleted-bg: #ffebe9; --color-prettylights-syntax-markup-inserted-text: #116329; --color-prettylights-syntax-markup-inserted-bg: #dafbe1; --color-prettylights-syntax-markup-changed-text: #953800; --color-prettylights-syntax-markup-changed-bg: #ffd8b5; --color-prettylights-syntax-markup-ignored-text: #eaeef2; --color-prettylights-syntax-markup-ignored-bg: #0550ae; --color-prettylights-syntax-meta-diff-range: #8250df; --color-prettylights-syntax-brackethighlighter-angle: #57606a; --color-prettylights-syntax-sublimelinter-gutter-mark: #8c959f; --color-prettylights-syntax-constant-other-reference-link: #0a3069; --color-fg-default: #24292f; --color-fg-muted: #57606a; --color-fg-subtle: #6e7781; --color-canvas-default: transparent; --color-canvas-subtle: #f6f8fa; --color-border-default: #d0d7de; --color-border-muted: #d8dee4; --color-neutral-muted: rgba(175,184,193,.2); --color-accent-fg: #0969da; --color-accent-emphasis: #0969da; --color-attention-subtle: #fff8c5; --color-danger-fg: #cf222e; }\n@media (prefers-color-scheme: light) {\n  :root { color-scheme: light; --color-prettylights-syntax-comment: #6e7781; --color-prettylights-syntax-constant: #0550ae; --color-prettylights-syntax-entity: #8250df; --color-prettylights-syntax-storage-modifier-import: #24292f; --color-prettylights-syntax-entity-tag: #116329; --color-prettylights-syntax-keyword: #cf222e; --color-prettylights-syntax-string: #0a3069; --color-prettylights-syntax-variable: #953800; --color-prettylights-syntax-brackethighlighter-unmatched: #82071e; --color-prettylights-syntax-invalid-illegal-text: #f6f8fa; --color-prettylights-syntax-invalid-illegal-bg: #82071e; --color-prettylights-syntax-carriage-return-text: #f6f8fa; --color-prettylights-syntax-carriage-return-bg: #cf222e; --color-prettylights-syntax-string-regexp: #116329; --color-prettylights-syntax-markup-list: #3b2300; --color-prettylights-syntax-markup-heading: #0550ae; --color-prettylights-syntax-markup-italic: #24292f; --color-prettylights-syntax-markup-bold: #24292f; --color-prettylights-syntax-markup-deleted-text: #82071e; --color-prettylights-syntax-markup-deleted-bg: #ffebe9; --color-prettylights-syntax-markup-inserted-text: #116329; --color-prettylights-syntax-markup-inserted-bg: #dafbe1; --color-prettylights-syntax-markup-changed-text: #953800; --color-prettylights-syntax-markup-changed-bg: #ffd8b5; --color-prettylights-syntax-markup-ignored-text: #eaeef2; --color-prettylights-syntax-markup-ignored-bg: #0550ae; --color-prettylights-syntax-meta-diff-range: #8250df; --color-prettylights-syntax-brackethighlighter-angle: #57606a; --color-prettylights-syntax-sublimelinter-gutter-mark: #8c959f; --color-prettylights-syntax-constant-other-reference-link: #0a3069; --color-fg-default: #24292f; --color-fg-muted: #57606a; --color-fg-subtle: #6e7781; --color-canvas-default: transparent; --color-canvas-subtle: #f6f8fa; --color-border-default: #d0d7de; --color-border-muted: #d8dee4; --color-neutral-muted: rgba(175,184,193,.2); --color-accent-fg: #0969da; --color-accent-emphasis: #0969da; --color-attention-subtle: #fff8c5; --color-danger-fg: #cf222e; }\n}\n.markdown-body h1:hover .anchor .octicon-link::before, .markdown-body h2:hover .anchor .octicon-link::before, .markdown-body h3:hover .anchor .octicon-link::before, .markdown-body h4:hover .anchor .octicon-link::before, .markdown-body h5:hover .anchor .octicon-link::before, .markdown-body h6:hover .anchor .octicon-link::before { width: 16px; height: 16px; content: \" \"; display: inline-block; background-color: currentcolor; mask-image: url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' version='1.1' aria-hidden='true'><path fill-rule='evenodd' d='M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 010-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 01-2.83 0z'></path></svg>\"); }\n.markdown-body details, .markdown-body figcaption, .markdown-body figure { display: block; }\n.markdown-body summary { display: list-item; }\n.markdown-body [hidden] { display: none !important; }\n.markdown-body a { background-color: transparent; color: rgb(21, 94, 239); text-decoration: none; }\n.markdown-body abbr[title] { border-bottom: none; text-decoration: underline dotted; }\n.markdown-body b, .markdown-body strong { font-weight: var(--base-text-weight-semibold,600); }\n.markdown-body dfn { font-style: italic; }\n.markdown-body mark { background-color: var(--color-attention-subtle); color: var(--color-fg-default); }\n.markdown-body small { font-size: 90%; }\n.markdown-body sub, .markdown-body sup { font-size: 75%; line-height: 0; position: relative; vertical-align: baseline; }\n.markdown-body sub { bottom: -0.25em; }\n.markdown-body sup { top: -0.5em; }\n.markdown-body img { border-style: none; max-width: 100%; box-sizing: content-box; background-color: var(--color-canvas-default); }\n.markdown-body code, .markdown-body kbd, .markdown-body pre, .markdown-body samp { font-family: monospace; font-size: 1em; }\n.markdown-body figure { margin: 1em 40px; }\n.markdown-body hr { box-sizing: content-box; overflow: hidden; background-image: initial; background-position: initial; background-size: initial; background-repeat: initial; background-attachment: initial; background-origin: initial; background-clip: initial; height: 0.25em; padding: 0px; margin: 24px 0px; background-color: var(--color-border-default); border: 0px; }\n.markdown-body input { font: inherit; margin: 0px; overflow: visible; }\n.markdown-body [type=\"button\"], .markdown-body [type=\"reset\"], .markdown-body [type=\"submit\"] { appearance: button; }\n.markdown-body [type=\"checkbox\"], .markdown-body [type=\"radio\"] { box-sizing: border-box; padding: 0px; }\n.markdown-body [type=\"number\"]::-webkit-inner-spin-button, .markdown-body [type=\"number\"]::-webkit-outer-spin-button { height: auto; }\n.markdown-body [type=\"search\"]::-webkit-search-cancel-button, .markdown-body [type=\"search\"]::-webkit-search-decoration { appearance: none; }\n.markdown-body ::-webkit-input-placeholder { color: inherit; opacity: 0.54; }\n.markdown-body ::-webkit-file-upload-button { appearance: button; font: inherit; }\n.markdown-body a:hover { text-decoration: underline; }\n.markdown-body ::placeholder { color: var(--color-fg-subtle); opacity: 1; }\n.markdown-body hr::after, .markdown-body hr::before { display: table; content: \"\"; }\n.markdown-body hr::after { clear: both; }\n.markdown-body table { border-spacing: 0px; border-collapse: collapse; display: block; width: auto; max-width: 100%; overflow: auto; }\n.markdown-body td, .markdown-body th { padding: 0px; }\n.markdown-body details summary { cursor: pointer; }\n.markdown-body details:not([open]) > :not(summary) { display: none !important; }\n.markdown-body [role=\"button\"]:focus, .markdown-body a:focus, .markdown-body input[type=\"checkbox\"]:focus, .markdown-body input[type=\"radio\"]:focus { outline: 2px solid var(--color-accent-fg); outline-offset: -2px; box-shadow: none; }\n.markdown-body [role=\"button\"]:focus:not(:focus-visible), .markdown-body a:focus:not(:focus-visible), .markdown-body input[type=\"checkbox\"]:focus:not(:focus-visible), .markdown-body input[type=\"radio\"]:focus:not(:focus-visible) { outline: transparent solid 1px; }\n.markdown-body [role=\"button\"]:focus-visible, .markdown-body a:focus-visible, .markdown-body input[type=\"checkbox\"]:focus-visible, .markdown-body input[type=\"radio\"]:focus-visible { outline: 2px solid var(--color-accent-fg); outline-offset: -2px; box-shadow: none; }\n.markdown-body a:not([class]):focus, .markdown-body a:not([class]):focus-visible, .markdown-body input[type=\"checkbox\"]:focus, .markdown-body input[type=\"checkbox\"]:focus-visible, .markdown-body input[type=\"radio\"]:focus, .markdown-body input[type=\"radio\"]:focus-visible { outline-offset: 0px; }\n.markdown-body kbd { display: inline-block; padding: 3px 5px; font: 11px / 10px ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace; color: var(--color-fg-default); vertical-align: middle; background-color: var(--color-canvas-subtle); border: 1px solid var(--color-neutral-muted); border-radius: 6px; box-shadow: inset 0 -1px 0 var(--color-neutral-muted); }\n.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin-top: 24px; margin-bottom: 16px; font-weight: var(--base-text-weight-semibold,600); line-height: 1.25; }\n.markdown-body p { margin-top: 0px; margin-bottom: 10px; }\n.markdown-body blockquote { margin: 0px; padding: 0px 8px; border-left: 2px solid rgb(41, 112, 255); }\n.markdown-body ol, .markdown-body ul { margin-top: 0px; margin-bottom: 0px; padding-left: 2em; }\n.markdown-body ol { list-style: decimal; }\n.markdown-body ul { list-style: disc; }\n.markdown-body ol ol, .markdown-body ul ol { list-style-type: lower-roman; }\n.markdown-body ol ol ol, .markdown-body ol ul ol, .markdown-body ul ol ol, .markdown-body ul ul ol { list-style-type: lower-alpha; }\n.markdown-body dd { margin-left: 0px; }\n.markdown-body code, .markdown-body pre, .markdown-body samp, .markdown-body tt { font-family: ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace; font-size: 12px; }\n.markdown-body pre { margin-top: 0px; margin-bottom: 0px; overflow-wrap: normal; }\n.markdown-body .octicon { display: inline-block; vertical-align: text-bottom; fill: currentcolor; overflow: visible !important; }\n.markdown-body input::-webkit-inner-spin-button, .markdown-body input::-webkit-outer-spin-button { margin: 0px; appearance: none; }\n.markdown-body::after, .markdown-body::before { display: table; content: \"\"; }\n.markdown-body::after { clear: both; }\n.markdown-body > :first-child { margin-top: 0px !important; }\n.markdown-body > :last-child { margin-bottom: 0px !important; }\n.markdown-body a:not([href]) { color: inherit; text-decoration: none; }\n.markdown-body .absent { color: var(--color-danger-fg); }\n.markdown-body .anchor { float: left; padding-right: 4px; margin-left: -20px; line-height: 1; }\n.markdown-body .anchor:focus { outline: none; }\n.markdown-body blockquote, .markdown-body details, .markdown-body dl, .markdown-body ol, .markdown-body p, .markdown-body pre, .markdown-body table, .markdown-body ul { margin-top: 0px; margin-bottom: 16px; }\n.markdown-body blockquote > :first-child { margin-top: 0px; }\n.markdown-body blockquote > :last-child { margin-bottom: 0px; }\n.markdown-body h1 .octicon-link, .markdown-body h2 .octicon-link, .markdown-body h3 .octicon-link, .markdown-body h4 .octicon-link, .markdown-body h5 .octicon-link, .markdown-body h6 .octicon-link { color: var(--color-fg-default); vertical-align: middle; visibility: hidden; }\n.markdown-body h1:hover .anchor, .markdown-body h2:hover .anchor, .markdown-body h3:hover .anchor, .markdown-body h4:hover .anchor, .markdown-body h5:hover .anchor, .markdown-body h6:hover .anchor { text-decoration: none; }\n.markdown-body h1:hover .anchor .octicon-link, .markdown-body h2:hover .anchor .octicon-link, .markdown-body h3:hover .anchor .octicon-link, .markdown-body h4:hover .anchor .octicon-link, .markdown-body h5:hover .anchor .octicon-link, .markdown-body h6:hover .anchor .octicon-link { visibility: visible; }\n.markdown-body h1 code, .markdown-body h1 tt, .markdown-body h2 code, .markdown-body h2 tt, .markdown-body h3 code, .markdown-body h3 tt, .markdown-body h4 code, .markdown-body h4 tt, .markdown-body h5 code, .markdown-body h5 tt, .markdown-body h6 code, .markdown-body h6 tt { padding: 0px 0.2em; font-size: inherit; }\n.markdown-body summary h1, .markdown-body summary h2, .markdown-body summary h3, .markdown-body summary h4, .markdown-body summary h5, .markdown-body summary h6 { display: inline-block; }\n.markdown-body summary h1 .anchor, .markdown-body summary h2 .anchor, .markdown-body summary h3 .anchor, .markdown-body summary h4 .anchor, .markdown-body summary h5 .anchor, .markdown-body summary h6 .anchor { margin-left: -40px; }\n.markdown-body summary h1, .markdown-body summary h2 { padding-bottom: 0px; border-bottom: 0px; }\n.markdown-body ol.no-list, .markdown-body ul.no-list { padding: 0px; list-style-type: none; }\n.markdown-body ol[type=\"a\"] { list-style-type: lower-alpha; }\n.markdown-body ol[type=\"A\"] { list-style-type: upper-alpha; }\n.markdown-body ol[type=\"i\"] { list-style-type: lower-roman; }\n.markdown-body ol[type=\"I\"] { list-style-type: upper-roman; }\n.markdown-body div > ol:not([type]), .markdown-body ol[type=\"1\"] { list-style-type: decimal; }\n.markdown-body ol ol, .markdown-body ol ul, .markdown-body ul ol, .markdown-body ul ul { margin-top: 0px; margin-bottom: 0px; }\n.markdown-body li > p { margin-top: 16px; }\n.markdown-body li + li { margin-top: 0.25em; }\n.markdown-body dl { padding: 0px; }\n.markdown-body dl dt { padding: 0px; margin-top: 16px; font-size: 1em; font-style: italic; font-weight: var(--base-text-weight-semibold,600); }\n.markdown-body dl dd { padding: 0px 16px; margin-bottom: 16px; }\n.markdown-body table th { font-weight: var(--base-text-weight-semibold,600); white-space: nowrap; }\n.markdown-body table td, .markdown-body table th { padding: 6px 13px; border: 1px solid var(--color-border-default); }\n.markdown-body table tr { background-color: var(--color-canvas-default); border-top: 1px solid var(--color-border-muted); }\n.markdown-body table tr:nth-child(2n) { background-color: var(--color-canvas-subtle); }\n.markdown-body table img { background-color: transparent; }\n.markdown-body img[align=\"right\"] { padding-left: 20px; }\n.markdown-body img[align=\"left\"] { padding-right: 20px; }\n.markdown-body .emoji { max-width: none; vertical-align: text-top; background-color: transparent; }\n.markdown-body span.frame { display: block; overflow: hidden; }\n.markdown-body span.frame > span { display: block; float: left; width: auto; padding: 7px; margin: 13px 0px 0px; overflow: hidden; border: 1px solid var(--color-border-default); }\n.markdown-body span.frame span img { display: block; float: left; }\n.markdown-body span.frame span span { display: block; padding: 5px 0px 0px; clear: both; color: var(--color-fg-default); }\n.markdown-body span.align-center { display: block; overflow: hidden; clear: both; }\n.markdown-body span.align-center > span { display: block; margin: 13px auto 0px; overflow: hidden; text-align: center; }\n.markdown-body span.align-center span img { margin: 0px auto; text-align: center; }\n.markdown-body span.align-right { display: block; overflow: hidden; clear: both; }\n.markdown-body span.align-right > span { display: block; margin: 13px 0px 0px; overflow: hidden; text-align: right; }\n.markdown-body span.align-right span img { margin: 0px; text-align: right; }\n.markdown-body span.float-left { display: block; float: left; margin-right: 13px; overflow: hidden; }\n.markdown-body span.float-left span { margin: 13px 0px 0px; }\n.markdown-body span.float-right { display: block; float: right; margin-left: 13px; overflow: hidden; }\n.markdown-body span.float-right > span { display: block; margin: 13px auto 0px; overflow: hidden; text-align: right; }\n.markdown-body code, .markdown-body tt { padding: 0.2em 0.4em; margin: 0px; font-size: 85%; white-space: break-spaces; background-color: var(--color-neutral-muted); border-radius: 6px; }\n.markdown-body code br, .markdown-body tt br { display: none; }\n.markdown-body del code { text-decoration: inherit; }\n.markdown-body samp { font-size: 85%; }\n.markdown-body pre code { font-size: 100%; white-space: pre-wrap !important; }\n.markdown-body pre > code { padding: 0px; margin: 0px; word-break: normal; white-space: pre-wrap; background: transparent; border: 0px; }\n.markdown-body .highlight { margin-bottom: 16px; }\n.markdown-body .highlight pre { margin-bottom: 0px; word-break: normal; }\n.markdown-body .highlight pre, .markdown-body pre { padding: 16px; background: rgb(255, 255, 255); overflow: auto; font-size: 85%; line-height: 1.45; border-radius: 6px; }\n.markdown-body pre { padding: 0px; }\n.markdown-body pre code, .markdown-body pre tt { display: inline-block; max-width: 100%; padding: 0px; margin: 0px; overflow-x: auto; line-height: inherit; overflow-wrap: normal; background-color: transparent; border: 0px; }\n.markdown-body .csv-data td, .markdown-body .csv-data th { padding: 5px; overflow: hidden; font-size: 12px; line-height: 1; text-align: left; white-space: nowrap; }\n.markdown-body .csv-data .blob-num { padding: 10px 8px 9px; text-align: right; background: var(--color-canvas-default); border: 0px; }\n.markdown-body .csv-data tr { border-top: 0px; }\n.markdown-body .csv-data th { font-weight: var(--base-text-weight-semibold,600); background: var(--color-canvas-subtle); border-top: 0px; }\n.markdown-body [data-footnote-ref]::before { content: \"[\"; }\n.markdown-body [data-footnote-ref]::after { content: \"]\"; }\n.markdown-body .footnotes { font-size: 12px; color: var(--color-fg-muted); border-top: 1px solid var(--color-border-default); }\n.markdown-body .footnotes ol { padding-left: 16px; }\n.markdown-body .footnotes ol ul { display: inline-block; padding-left: 16px; margin-top: 16px; }\n.markdown-body .footnotes li { position: relative; }\n.markdown-body .footnotes li:target::before { position: absolute; inset: -8px -8px -8px -24px; pointer-events: none; content: \"\"; border: 2px solid var(--color-accent-emphasis); border-radius: 6px; }\n.markdown-body .footnotes li:target { color: var(--color-fg-default); }\n.markdown-body .footnotes .data-footnote-backref g-emoji { font-family: monospace; }\n.markdown-body .pl-c { color: var(--color-prettylights-syntax-comment); }\n.markdown-body .pl-c1, .markdown-body .pl-s .pl-v { color: var(--color-prettylights-syntax-constant); }\n.markdown-body .pl-e, .markdown-body .pl-en { color: var(--color-prettylights-syntax-entity); }\n.markdown-body .pl-s .pl-s1, .markdown-body .pl-smi { color: var(--color-prettylights-syntax-storage-modifier-import); }\n.markdown-body .pl-ent { color: var(--color-prettylights-syntax-entity-tag); }\n.markdown-body .pl-k { color: var(--color-prettylights-syntax-keyword); }\n.markdown-body .pl-pds, .markdown-body .pl-s, .markdown-body .pl-s .pl-pse .pl-s1, .markdown-body .pl-sr, .markdown-body .pl-sr .pl-cce, .markdown-body .pl-sr .pl-sra, .markdown-body .pl-sr .pl-sre { color: var(--color-prettylights-syntax-string); }\n.markdown-body .pl-smw, .markdown-body .pl-v { color: var(--color-prettylights-syntax-variable); }\n.markdown-body .pl-bu { color: var(--color-prettylights-syntax-brackethighlighter-unmatched); }\n.markdown-body .pl-ii { color: var(--color-prettylights-syntax-invalid-illegal-text); background-color: var(--color-prettylights-syntax-invalid-illegal-bg); }\n.markdown-body .pl-c2 { color: var(--color-prettylights-syntax-carriage-return-text); background-color: var(--color-prettylights-syntax-carriage-return-bg); }\n.markdown-body .pl-sr .pl-cce { font-weight: 700; color: var(--color-prettylights-syntax-string-regexp); }\n.markdown-body .pl-ml { color: var(--color-prettylights-syntax-markup-list); }\n.markdown-body .pl-mh, .markdown-body .pl-mh .pl-en, .markdown-body .pl-ms { font-weight: 700; color: var(--color-prettylights-syntax-markup-heading); }\n.markdown-body .pl-mi { font-style: italic; color: var(--color-prettylights-syntax-markup-italic); }\n.markdown-body .pl-mb { font-weight: 700; color: var(--color-prettylights-syntax-markup-bold); }\n.markdown-body .pl-md { color: var(--color-prettylights-syntax-markup-deleted-text); background-color: var(--color-prettylights-syntax-markup-deleted-bg); }\n.markdown-body .pl-mi1 { color: var(--color-prettylights-syntax-markup-inserted-text); background-color: var(--color-prettylights-syntax-markup-inserted-bg); }\n.markdown-body .pl-mc { color: var(--color-prettylights-syntax-markup-changed-text); background-color: var(--color-prettylights-syntax-markup-changed-bg); }\n.markdown-body .pl-mi2 { color: var(--color-prettylights-syntax-markup-ignored-text); background-color: var(--color-prettylights-syntax-markup-ignored-bg); }\n.markdown-body .pl-mdr { font-weight: 700; color: var(--color-prettylights-syntax-meta-diff-range); }\n.markdown-body .pl-ba { color: var(--color-prettylights-syntax-brackethighlighter-angle); }\n.markdown-body .pl-sg { color: var(--color-prettylights-syntax-sublimelinter-gutter-mark); }\n.markdown-body .pl-corl { text-decoration: underline; color: var(--color-prettylights-syntax-constant-other-reference-link); }\n.markdown-body g-emoji { display: inline-block; min-width: 1ch; font-family: \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\"; font-size: 1em; font-weight: var(--base-text-weight-normal,400); line-height: 1; vertical-align: -0.075em; font-style: normal !important; }\n.markdown-body g-emoji img { width: 1em; height: 1em; }\n.markdown-body .task-list-item { list-style-type: none; }\n.markdown-body .task-list-item label { font-weight: var(--base-text-weight-normal,400); }\n.markdown-body .task-list-item.enabled label { cursor: pointer; }\n.markdown-body .task-list-item + .task-list-item { margin-top: 4px; }\n.markdown-body .task-list-item .handle { display: none; }\n.markdown-body .task-list-item-checkbox { margin: 0px 0.2em 0.25em -1.4em; vertical-align: middle; }\n.markdown-body .contains-task-list:dir(rtl) .task-list-item-checkbox { margin: 0px -1.6em 0.25em 0.2em; }\n.markdown-body .contains-task-list { position: relative; }\n.markdown-body .contains-task-list:focus-within .task-list-item-convert-container, .markdown-body .contains-task-list:hover .task-list-item-convert-container { display: block; width: auto; height: 24px; overflow: visible; clip: auto; }\n.markdown-body ::-webkit-calendar-picker-indicator { filter: invert(50%); }\n.markdown-body .react-syntax-highlighter-line-number { color: rgb(208, 213, 221); }\n\n/* ===== EXTERNAL STYLE #6 ===== */\n/* href: https://dearestie.xyz/_next/static/css/67e27251f9995d24.css */\n/* method: cssRules */\n.account-setting_modal__OGW5J { overflow-y: auto; max-width: 1024px !important; border-radius: 12px !important; padding: 0px !important; }\n.style_notion-icon__NnoSC { background: url(\"https://dearestie.xyz/_next/static/media/notion.e316d36c.svg\") 50% center / 20px 20px no-repeat rgb(255, 255, 255); }\n.style_workspace-item__F3AI_ { box-shadow: rgba(16, 24, 40, 0.05) 0px 1px 2px; }\n.style_workspace-item__F3AI_:last-of-type { margin-bottom: 0px; }\n.notion-icon_default-page-icon__02ZcQ { width: 20px; height: 20px; background: url(\"https://dearestie.xyz/_next/static/media/notion-page.0d06639b.svg\") 50% center / cover no-repeat; }\n.style_copyIcon__GJL9e { background-image: url(\"https://dearestie.xyz/_next/static/media/copy.89d68c8b.svg\"); background-position: 50% center; background-repeat: no-repeat; }\n.style_copyIcon__GJL9e:hover { background-image: url(\"https://dearestie.xyz/_next/static/media/copy-hover.2cc86992.svg\"); background-position: 50% center; background-repeat: no-repeat; }\n.style_copyIcon__GJL9e.style_copied__qGMIw { background-image: url(\"https://dearestie.xyz/_next/static/media/copied.350b63f0.svg\"); }\n:root { --rt-color-white: #fff; --rt-color-dark: #222; --rt-color-success: #8dc572; --rt-color-error: #be6464; --rt-color-warning: #f0ad4e; --rt-color-info: #337ab7; --rt-opacity: 0.9; }\n.styles-module_tooltip__mnnfp { visibility: hidden; width: max-content; position: absolute; top: 0px; left: 0px; padding: 8px 16px; border-radius: 3px; font-size: 90%; pointer-events: none; opacity: 0; transition: opacity 0.3s ease-out; will-change: opacity, visibility; }\n.styles-module_fixed__7ciUi { position: fixed; }\n.styles-module_arrow__K0L3T { position: absolute; background: inherit; width: 8px; height: 8px; transform: rotate(45deg); }\n.styles-module_no-arrow__KcFZN { display: none; }\n.styles-module_clickable__Bv9o7 { pointer-events: auto; }\n.styles-module_show__2NboJ { visibility: visible; opacity: var(--rt-opacity); }\n.styles-module_dark__xNqje { background: var(--rt-color-dark); color: var(--rt-color-white); }\n.styles-module_light__Z6W-X { background-color: var(--rt-color-white); color: var(--rt-color-dark); }\n.styles-module_success__A2AKt { background-color: var(--rt-color-success); color: var(--rt-color-white); }\n.styles-module_warning__SCK0X { background-color: var(--rt-color-warning); color: var(--rt-color-white); }\n.styles-module_error__JvumD { background-color: var(--rt-color-error); color: var(--rt-color-white); }\n.styles-module_info__BWdHW { background-color: var(--rt-color-info); color: var(--rt-color-white); }\n@font-face { font-family: KaTeX_AMS; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_AMS-Regular.a79f1c31.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_AMS-Regular.1608a09b.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_AMS-Regular.4aafdb68.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Caligraphic; font-style: normal; font-weight: 700; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Caligraphic-Bold.ec17d132.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Caligraphic-Bold.b6770918.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Caligraphic-Bold.cce5b8ec.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Caligraphic; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Caligraphic-Regular.55fac258.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Caligraphic-Regular.dad44a7f.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Caligraphic-Regular.07ef19e7.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Fraktur; font-style: normal; font-weight: 700; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Fraktur-Bold.d42a5579.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Fraktur-Bold.9f256b85.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Fraktur-Bold.b18f59e1.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Fraktur; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Fraktur-Regular.d3c882a6.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Fraktur-Regular.7c187121.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Fraktur-Regular.ed38e79f.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Main; font-style: normal; font-weight: 700; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Bold.c3fb5ac2.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Bold.d181c465.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Bold.b74a1a8b.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Main; font-style: italic; font-weight: 700; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-BoldItalic.6f2bb1df.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-BoldItalic.e3f82f9d.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-BoldItalic.70d8b0a5.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Main; font-style: italic; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Italic.8916142b.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Italic.9024d815.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Italic.47373d1e.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Main; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Regular.0462f03b.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Regular.7f51fe03.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Main-Regular.b7f8fe9b.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Math; font-style: italic; font-weight: 700; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Math-BoldItalic.572d331f.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Math-BoldItalic.f1035d8d.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Math-BoldItalic.a879cf83.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Math; font-style: italic; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Math-Italic.f28c23ac.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Math-Italic.5295ba48.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Math-Italic.939bc644.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_SansSerif; font-style: normal; font-weight: 700; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Bold.8c5b5494.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Bold.bf59d231.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Bold.94e1e8dc.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_SansSerif; font-style: italic; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Italic.3b1e59b3.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Italic.7c9bc82b.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Italic.b4c20c84.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_SansSerif; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Regular.ba21ed5f.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Regular.74048478.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_SansSerif-Regular.d4d7ba48.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Script; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Script-Regular.03e9641d.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Script-Regular.07505710.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Script-Regular.fe9cbbe1.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Size1; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size1-Regular.eae34984.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size1-Regular.e1e279cb.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size1-Regular.fabc004a.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Size2; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size2-Regular.5916a24f.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size2-Regular.57727022.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size2-Regular.d6b476ec.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Size3; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size3-Regular.b4230e7e.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size3-Regular.9acaf01c.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size3-Regular.a144ef58.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Size4; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size4-Regular.10d95fd3.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size4-Regular.7a996c9d.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Size4-Regular.fbccdabe.ttf\") format(\"truetype\"); }\n@font-face { font-family: KaTeX_Typewriter; font-style: normal; font-weight: 400; src: url(\"https://dearestie.xyz/_next/static/media/KaTeX_Typewriter-Regular.a8709e36.woff2\") format(\"woff2\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Typewriter-Regular.6258592b.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/KaTeX_Typewriter-Regular.d97aaf4a.ttf\") format(\"truetype\"); }\n.katex { font: 1.21em / 1.2 KaTeX_Main, \"Times New Roman\", serif; text-indent: 0px; text-rendering: auto; }\n.katex * { border-color: currentcolor; }\n.katex .katex-version::after { content: \"0.16.22\"; }\n.katex .katex-mathml { clip: rect(1px, 1px, 1px, 1px); border: 0px; height: 1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; }\n.katex .katex-html > .newline { display: block; }\n.katex .base { position: relative; white-space: nowrap; width: min-content; }\n.katex .base, .katex .strut { display: inline-block; }\n.katex .textbf { font-weight: 700; }\n.katex .textit { font-style: italic; }\n.katex .textrm { font-family: KaTeX_Main; }\n.katex .textsf { font-family: KaTeX_SansSerif; }\n.katex .texttt { font-family: KaTeX_Typewriter; }\n.katex .mathnormal { font-family: KaTeX_Math; font-style: italic; }\n.katex .mathit { font-family: KaTeX_Main; font-style: italic; }\n.katex .mathrm { font-style: normal; }\n.katex .mathbf { font-family: KaTeX_Main; font-weight: 700; }\n.katex .boldsymbol { font-family: KaTeX_Math; font-style: italic; font-weight: 700; }\n.katex .amsrm, .katex .mathbb, .katex .textbb { font-family: KaTeX_AMS; }\n.katex .mathcal { font-family: KaTeX_Caligraphic; }\n.katex .mathfrak, .katex .textfrak { font-family: KaTeX_Fraktur; }\n.katex .mathboldfrak, .katex .textboldfrak { font-family: KaTeX_Fraktur; font-weight: 700; }\n.katex .mathtt { font-family: KaTeX_Typewriter; }\n.katex .mathscr, .katex .textscr { font-family: KaTeX_Script; }\n.katex .mathsf, .katex .textsf { font-family: KaTeX_SansSerif; }\n.katex .mathboldsf, .katex .textboldsf { font-family: KaTeX_SansSerif; font-weight: 700; }\n.katex .mathitsf, .katex .mathsfit, .katex .textitsf { font-family: KaTeX_SansSerif; font-style: italic; }\n.katex .mainrm { font-family: KaTeX_Main; font-style: normal; }\n.katex .vlist-t { border-collapse: collapse; display: inline-table; table-layout: fixed; }\n.katex .vlist-r { display: table-row; }\n.katex .vlist { display: table-cell; position: relative; vertical-align: bottom; }\n.katex .vlist > span { display: block; height: 0px; position: relative; }\n.katex .vlist > span > span { display: inline-block; }\n.katex .vlist > span > .pstrut { overflow: hidden; width: 0px; }\n.katex .vlist-t2 { margin-right: -2px; }\n.katex .vlist-s { display: table-cell; font-size: 1px; min-width: 2px; vertical-align: bottom; width: 2px; }\n.katex .vbox { align-items: baseline; display: inline-flex; flex-direction: column; }\n.katex .hbox { width: 100%; }\n.katex .hbox, .katex .thinbox { display: inline-flex; flex-direction: row; }\n.katex .thinbox { max-width: 0px; width: 0px; }\n.katex .msupsub { text-align: left; }\n.katex .mfrac > span > span { text-align: center; }\n.katex .mfrac .frac-line { border-bottom-style: solid; display: inline-block; width: 100%; }\n.katex .hdashline, .katex .hline, .katex .mfrac .frac-line, .katex .overline .overline-line, .katex .rule, .katex .underline .underline-line { min-height: 1px; }\n.katex .mspace { display: inline-block; }\n.katex .clap, .katex .llap, .katex .rlap { position: relative; width: 0px; }\n.katex .clap > .inner, .katex .llap > .inner, .katex .rlap > .inner { position: absolute; }\n.katex .clap > .fix, .katex .llap > .fix, .katex .rlap > .fix { display: inline-block; }\n.katex .llap > .inner { right: 0px; }\n.katex .clap > .inner, .katex .rlap > .inner { left: 0px; }\n.katex .clap > .inner > span { margin-left: -50%; margin-right: 50%; }\n.katex .rule { border: 0px solid; display: inline-block; position: relative; }\n.katex .hline, .katex .overline .overline-line, .katex .underline .underline-line { border-bottom-style: solid; display: inline-block; width: 100%; }\n.katex .hdashline { border-bottom-style: dashed; display: inline-block; width: 100%; }\n.katex .sqrt > .root { margin-left: 0.277778em; margin-right: -0.555556em; }\n.katex .fontsize-ensurer.reset-size1.size1, .katex .sizing.reset-size1.size1 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size1.size2, .katex .sizing.reset-size1.size2 { font-size: 1.2em; }\n.katex .fontsize-ensurer.reset-size1.size3, .katex .sizing.reset-size1.size3 { font-size: 1.4em; }\n.katex .fontsize-ensurer.reset-size1.size4, .katex .sizing.reset-size1.size4 { font-size: 1.6em; }\n.katex .fontsize-ensurer.reset-size1.size5, .katex .sizing.reset-size1.size5 { font-size: 1.8em; }\n.katex .fontsize-ensurer.reset-size1.size6, .katex .sizing.reset-size1.size6 { font-size: 2em; }\n.katex .fontsize-ensurer.reset-size1.size7, .katex .sizing.reset-size1.size7 { font-size: 2.4em; }\n.katex .fontsize-ensurer.reset-size1.size8, .katex .sizing.reset-size1.size8 { font-size: 2.88em; }\n.katex .fontsize-ensurer.reset-size1.size9, .katex .sizing.reset-size1.size9 { font-size: 3.456em; }\n.katex .fontsize-ensurer.reset-size1.size10, .katex .sizing.reset-size1.size10 { font-size: 4.148em; }\n.katex .fontsize-ensurer.reset-size1.size11, .katex .sizing.reset-size1.size11 { font-size: 4.976em; }\n.katex .fontsize-ensurer.reset-size2.size1, .katex .sizing.reset-size2.size1 { font-size: 0.833333em; }\n.katex .fontsize-ensurer.reset-size2.size2, .katex .sizing.reset-size2.size2 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size2.size3, .katex .sizing.reset-size2.size3 { font-size: 1.16667em; }\n.katex .fontsize-ensurer.reset-size2.size4, .katex .sizing.reset-size2.size4 { font-size: 1.33333em; }\n.katex .fontsize-ensurer.reset-size2.size5, .katex .sizing.reset-size2.size5 { font-size: 1.5em; }\n.katex .fontsize-ensurer.reset-size2.size6, .katex .sizing.reset-size2.size6 { font-size: 1.66667em; }\n.katex .fontsize-ensurer.reset-size2.size7, .katex .sizing.reset-size2.size7 { font-size: 2em; }\n.katex .fontsize-ensurer.reset-size2.size8, .katex .sizing.reset-size2.size8 { font-size: 2.4em; }\n.katex .fontsize-ensurer.reset-size2.size9, .katex .sizing.reset-size2.size9 { font-size: 2.88em; }\n.katex .fontsize-ensurer.reset-size2.size10, .katex .sizing.reset-size2.size10 { font-size: 3.45667em; }\n.katex .fontsize-ensurer.reset-size2.size11, .katex .sizing.reset-size2.size11 { font-size: 4.14667em; }\n.katex .fontsize-ensurer.reset-size3.size1, .katex .sizing.reset-size3.size1 { font-size: 0.714286em; }\n.katex .fontsize-ensurer.reset-size3.size2, .katex .sizing.reset-size3.size2 { font-size: 0.857143em; }\n.katex .fontsize-ensurer.reset-size3.size3, .katex .sizing.reset-size3.size3 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size3.size4, .katex .sizing.reset-size3.size4 { font-size: 1.14286em; }\n.katex .fontsize-ensurer.reset-size3.size5, .katex .sizing.reset-size3.size5 { font-size: 1.28571em; }\n.katex .fontsize-ensurer.reset-size3.size6, .katex .sizing.reset-size3.size6 { font-size: 1.42857em; }\n.katex .fontsize-ensurer.reset-size3.size7, .katex .sizing.reset-size3.size7 { font-size: 1.71429em; }\n.katex .fontsize-ensurer.reset-size3.size8, .katex .sizing.reset-size3.size8 { font-size: 2.05714em; }\n.katex .fontsize-ensurer.reset-size3.size9, .katex .sizing.reset-size3.size9 { font-size: 2.46857em; }\n.katex .fontsize-ensurer.reset-size3.size10, .katex .sizing.reset-size3.size10 { font-size: 2.96286em; }\n.katex .fontsize-ensurer.reset-size3.size11, .katex .sizing.reset-size3.size11 { font-size: 3.55429em; }\n.katex .fontsize-ensurer.reset-size4.size1, .katex .sizing.reset-size4.size1 { font-size: 0.625em; }\n.katex .fontsize-ensurer.reset-size4.size2, .katex .sizing.reset-size4.size2 { font-size: 0.75em; }\n.katex .fontsize-ensurer.reset-size4.size3, .katex .sizing.reset-size4.size3 { font-size: 0.875em; }\n.katex .fontsize-ensurer.reset-size4.size4, .katex .sizing.reset-size4.size4 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size4.size5, .katex .sizing.reset-size4.size5 { font-size: 1.125em; }\n.katex .fontsize-ensurer.reset-size4.size6, .katex .sizing.reset-size4.size6 { font-size: 1.25em; }\n.katex .fontsize-ensurer.reset-size4.size7, .katex .sizing.reset-size4.size7 { font-size: 1.5em; }\n.katex .fontsize-ensurer.reset-size4.size8, .katex .sizing.reset-size4.size8 { font-size: 1.8em; }\n.katex .fontsize-ensurer.reset-size4.size9, .katex .sizing.reset-size4.size9 { font-size: 2.16em; }\n.katex .fontsize-ensurer.reset-size4.size10, .katex .sizing.reset-size4.size10 { font-size: 2.5925em; }\n.katex .fontsize-ensurer.reset-size4.size11, .katex .sizing.reset-size4.size11 { font-size: 3.11em; }\n.katex .fontsize-ensurer.reset-size5.size1, .katex .sizing.reset-size5.size1 { font-size: 0.555556em; }\n.katex .fontsize-ensurer.reset-size5.size2, .katex .sizing.reset-size5.size2 { font-size: 0.666667em; }\n.katex .fontsize-ensurer.reset-size5.size3, .katex .sizing.reset-size5.size3 { font-size: 0.777778em; }\n.katex .fontsize-ensurer.reset-size5.size4, .katex .sizing.reset-size5.size4 { font-size: 0.888889em; }\n.katex .fontsize-ensurer.reset-size5.size5, .katex .sizing.reset-size5.size5 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size5.size6, .katex .sizing.reset-size5.size6 { font-size: 1.11111em; }\n.katex .fontsize-ensurer.reset-size5.size7, .katex .sizing.reset-size5.size7 { font-size: 1.33333em; }\n.katex .fontsize-ensurer.reset-size5.size8, .katex .sizing.reset-size5.size8 { font-size: 1.6em; }\n.katex .fontsize-ensurer.reset-size5.size9, .katex .sizing.reset-size5.size9 { font-size: 1.92em; }\n.katex .fontsize-ensurer.reset-size5.size10, .katex .sizing.reset-size5.size10 { font-size: 2.30444em; }\n.katex .fontsize-ensurer.reset-size5.size11, .katex .sizing.reset-size5.size11 { font-size: 2.76444em; }\n.katex .fontsize-ensurer.reset-size6.size1, .katex .sizing.reset-size6.size1 { font-size: 0.5em; }\n.katex .fontsize-ensurer.reset-size6.size2, .katex .sizing.reset-size6.size2 { font-size: 0.6em; }\n.katex .fontsize-ensurer.reset-size6.size3, .katex .sizing.reset-size6.size3 { font-size: 0.7em; }\n.katex .fontsize-ensurer.reset-size6.size4, .katex .sizing.reset-size6.size4 { font-size: 0.8em; }\n.katex .fontsize-ensurer.reset-size6.size5, .katex .sizing.reset-size6.size5 { font-size: 0.9em; }\n.katex .fontsize-ensurer.reset-size6.size6, .katex .sizing.reset-size6.size6 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size6.size7, .katex .sizing.reset-size6.size7 { font-size: 1.2em; }\n.katex .fontsize-ensurer.reset-size6.size8, .katex .sizing.reset-size6.size8 { font-size: 1.44em; }\n.katex .fontsize-ensurer.reset-size6.size9, .katex .sizing.reset-size6.size9 { font-size: 1.728em; }\n.katex .fontsize-ensurer.reset-size6.size10, .katex .sizing.reset-size6.size10 { font-size: 2.074em; }\n.katex .fontsize-ensurer.reset-size6.size11, .katex .sizing.reset-size6.size11 { font-size: 2.488em; }\n.katex .fontsize-ensurer.reset-size7.size1, .katex .sizing.reset-size7.size1 { font-size: 0.416667em; }\n.katex .fontsize-ensurer.reset-size7.size2, .katex .sizing.reset-size7.size2 { font-size: 0.5em; }\n.katex .fontsize-ensurer.reset-size7.size3, .katex .sizing.reset-size7.size3 { font-size: 0.583333em; }\n.katex .fontsize-ensurer.reset-size7.size4, .katex .sizing.reset-size7.size4 { font-size: 0.666667em; }\n.katex .fontsize-ensurer.reset-size7.size5, .katex .sizing.reset-size7.size5 { font-size: 0.75em; }\n.katex .fontsize-ensurer.reset-size7.size6, .katex .sizing.reset-size7.size6 { font-size: 0.833333em; }\n.katex .fontsize-ensurer.reset-size7.size7, .katex .sizing.reset-size7.size7 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size7.size8, .katex .sizing.reset-size7.size8 { font-size: 1.2em; }\n.katex .fontsize-ensurer.reset-size7.size9, .katex .sizing.reset-size7.size9 { font-size: 1.44em; }\n.katex .fontsize-ensurer.reset-size7.size10, .katex .sizing.reset-size7.size10 { font-size: 1.72833em; }\n.katex .fontsize-ensurer.reset-size7.size11, .katex .sizing.reset-size7.size11 { font-size: 2.07333em; }\n.katex .fontsize-ensurer.reset-size8.size1, .katex .sizing.reset-size8.size1 { font-size: 0.347222em; }\n.katex .fontsize-ensurer.reset-size8.size2, .katex .sizing.reset-size8.size2 { font-size: 0.416667em; }\n.katex .fontsize-ensurer.reset-size8.size3, .katex .sizing.reset-size8.size3 { font-size: 0.486111em; }\n.katex .fontsize-ensurer.reset-size8.size4, .katex .sizing.reset-size8.size4 { font-size: 0.555556em; }\n.katex .fontsize-ensurer.reset-size8.size5, .katex .sizing.reset-size8.size5 { font-size: 0.625em; }\n.katex .fontsize-ensurer.reset-size8.size6, .katex .sizing.reset-size8.size6 { font-size: 0.694444em; }\n.katex .fontsize-ensurer.reset-size8.size7, .katex .sizing.reset-size8.size7 { font-size: 0.833333em; }\n.katex .fontsize-ensurer.reset-size8.size8, .katex .sizing.reset-size8.size8 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size8.size9, .katex .sizing.reset-size8.size9 { font-size: 1.2em; }\n.katex .fontsize-ensurer.reset-size8.size10, .katex .sizing.reset-size8.size10 { font-size: 1.44028em; }\n.katex .fontsize-ensurer.reset-size8.size11, .katex .sizing.reset-size8.size11 { font-size: 1.72778em; }\n.katex .fontsize-ensurer.reset-size9.size1, .katex .sizing.reset-size9.size1 { font-size: 0.289352em; }\n.katex .fontsize-ensurer.reset-size9.size2, .katex .sizing.reset-size9.size2 { font-size: 0.347222em; }\n.katex .fontsize-ensurer.reset-size9.size3, .katex .sizing.reset-size9.size3 { font-size: 0.405093em; }\n.katex .fontsize-ensurer.reset-size9.size4, .katex .sizing.reset-size9.size4 { font-size: 0.462963em; }\n.katex .fontsize-ensurer.reset-size9.size5, .katex .sizing.reset-size9.size5 { font-size: 0.520833em; }\n.katex .fontsize-ensurer.reset-size9.size6, .katex .sizing.reset-size9.size6 { font-size: 0.578704em; }\n.katex .fontsize-ensurer.reset-size9.size7, .katex .sizing.reset-size9.size7 { font-size: 0.694444em; }\n.katex .fontsize-ensurer.reset-size9.size8, .katex .sizing.reset-size9.size8 { font-size: 0.833333em; }\n.katex .fontsize-ensurer.reset-size9.size9, .katex .sizing.reset-size9.size9 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size9.size10, .katex .sizing.reset-size9.size10 { font-size: 1.20023em; }\n.katex .fontsize-ensurer.reset-size9.size11, .katex .sizing.reset-size9.size11 { font-size: 1.43981em; }\n.katex .fontsize-ensurer.reset-size10.size1, .katex .sizing.reset-size10.size1 { font-size: 0.24108em; }\n.katex .fontsize-ensurer.reset-size10.size2, .katex .sizing.reset-size10.size2 { font-size: 0.289296em; }\n.katex .fontsize-ensurer.reset-size10.size3, .katex .sizing.reset-size10.size3 { font-size: 0.337512em; }\n.katex .fontsize-ensurer.reset-size10.size4, .katex .sizing.reset-size10.size4 { font-size: 0.385728em; }\n.katex .fontsize-ensurer.reset-size10.size5, .katex .sizing.reset-size10.size5 { font-size: 0.433944em; }\n.katex .fontsize-ensurer.reset-size10.size6, .katex .sizing.reset-size10.size6 { font-size: 0.48216em; }\n.katex .fontsize-ensurer.reset-size10.size7, .katex .sizing.reset-size10.size7 { font-size: 0.578592em; }\n.katex .fontsize-ensurer.reset-size10.size8, .katex .sizing.reset-size10.size8 { font-size: 0.694311em; }\n.katex .fontsize-ensurer.reset-size10.size9, .katex .sizing.reset-size10.size9 { font-size: 0.833173em; }\n.katex .fontsize-ensurer.reset-size10.size10, .katex .sizing.reset-size10.size10 { font-size: 1em; }\n.katex .fontsize-ensurer.reset-size10.size11, .katex .sizing.reset-size10.size11 { font-size: 1.19961em; }\n.katex .fontsize-ensurer.reset-size11.size1, .katex .sizing.reset-size11.size1 { font-size: 0.200965em; }\n.katex .fontsize-ensurer.reset-size11.size2, .katex .sizing.reset-size11.size2 { font-size: 0.241158em; }\n.katex .fontsize-ensurer.reset-size11.size3, .katex .sizing.reset-size11.size3 { font-size: 0.28135em; }\n.katex .fontsize-ensurer.reset-size11.size4, .katex .sizing.reset-size11.size4 { font-size: 0.321543em; }\n.katex .fontsize-ensurer.reset-size11.size5, .katex .sizing.reset-size11.size5 { font-size: 0.361736em; }\n.katex .fontsize-ensurer.reset-size11.size6, .katex .sizing.reset-size11.size6 { font-size: 0.401929em; }\n.katex .fontsize-ensurer.reset-size11.size7, .katex .sizing.reset-size11.size7 { font-size: 0.482315em; }\n.katex .fontsize-ensurer.reset-size11.size8, .katex .sizing.reset-size11.size8 { font-size: 0.578778em; }\n.katex .fontsize-ensurer.reset-size11.size9, .katex .sizing.reset-size11.size9 { font-size: 0.694534em; }\n.katex .fontsize-ensurer.reset-size11.size10, .katex .sizing.reset-size11.size10 { font-size: 0.833601em; }\n.katex .fontsize-ensurer.reset-size11.size11, .katex .sizing.reset-size11.size11 { font-size: 1em; }\n.katex .delimsizing.size1 { font-family: KaTeX_Size1; }\n.katex .delimsizing.size2 { font-family: KaTeX_Size2; }\n.katex .delimsizing.size3 { font-family: KaTeX_Size3; }\n.katex .delimsizing.size4 { font-family: KaTeX_Size4; }\n.katex .delimsizing.mult .delim-size1 > span { font-family: KaTeX_Size1; }\n.katex .delimsizing.mult .delim-size4 > span { font-family: KaTeX_Size4; }\n.katex .nulldelimiter { display: inline-block; width: 0.12em; }\n.katex .delimcenter, .katex .op-symbol { position: relative; }\n.katex .op-symbol.small-op { font-family: KaTeX_Size1; }\n.katex .op-symbol.large-op { font-family: KaTeX_Size2; }\n.katex .accent > .vlist-t, .katex .op-limits > .vlist-t { text-align: center; }\n.katex .accent .accent-body { position: relative; }\n.katex .accent .accent-body:not(.accent-full) { width: 0px; }\n.katex .overlay { display: block; }\n.katex .mtable .vertical-separator { display: inline-block; min-width: 1px; }\n.katex .mtable .arraycolsep { display: inline-block; }\n.katex .mtable .col-align-c > .vlist-t { text-align: center; }\n.katex .mtable .col-align-l > .vlist-t { text-align: left; }\n.katex .mtable .col-align-r > .vlist-t { text-align: right; }\n.katex .svg-align { text-align: left; }\n.katex svg { fill: currentcolor; stroke: currentcolor; fill-rule: nonzero; fill-opacity: 1; stroke-width: 1; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 4; stroke-dasharray: none; stroke-dashoffset: 0; stroke-opacity: 1; display: block; height: inherit; position: absolute; width: 100%; }\n.katex svg path { stroke: none; }\n.katex img { border-style: none; max-height: none; max-width: none; min-height: 0px; min-width: 0px; }\n.katex .stretchy { display: block; overflow: hidden; position: relative; width: 100%; }\n.katex .stretchy::after, .katex .stretchy::before { content: \"\"; }\n.katex .hide-tail { overflow: hidden; position: relative; width: 100%; }\n.katex .halfarrow-left { left: 0px; overflow: hidden; position: absolute; width: 50.2%; }\n.katex .halfarrow-right { overflow: hidden; position: absolute; right: 0px; width: 50.2%; }\n.katex .brace-left { left: 0px; overflow: hidden; position: absolute; width: 25.1%; }\n.katex .brace-center { left: 25%; overflow: hidden; position: absolute; width: 50%; }\n.katex .brace-right { overflow: hidden; position: absolute; right: 0px; width: 25.1%; }\n.katex .x-arrow-pad { padding: 0px 0.5em; }\n.katex .cd-arrow-pad { padding: 0px 0.55556em 0px 0.27778em; }\n.katex .mover, .katex .munder, .katex .x-arrow { text-align: center; }\n.katex .boxpad { padding: 0px 0.3em; }\n.katex .fbox, .katex .fcolorbox { border: 0.04em solid; box-sizing: border-box; }\n.katex .cancel-pad { padding: 0px 0.2em; }\n.katex .cancel-lap { margin-left: -0.2em; margin-right: -0.2em; }\n.katex .sout { border-bottom-style: solid; border-bottom-width: 0.08em; }\n.katex .angl { border-right: 0.049em solid; border-top: 0.049em solid; box-sizing: border-box; margin-right: 0.03889em; }\n.katex .anglpad { padding: 0px 0.03889em; }\n.katex .eqn-num::before { content: \"(\" counter(katexEqnNo) \")\"; counter-increment: katexEqnNo 1; }\n.katex .mml-eqn-num::before { content: \"(\" counter(mmlEqnNo) \")\"; counter-increment: mmlEqnNo 1; }\n.katex .mtr-glue { width: 50%; }\n.katex .cd-vert-arrow { display: inline-block; position: relative; }\n.katex .cd-label-left { display: inline-block; position: absolute; right: calc(50% + 0.3em); text-align: left; }\n.katex .cd-label-right { display: inline-block; left: calc(50% + 0.3em); position: absolute; text-align: right; }\n.katex-display { display: block; margin: 1em 0px; text-align: center; }\n.katex-display > .katex { display: block; text-align: center; white-space: nowrap; }\n.katex-display > .katex > .katex-html { display: block; position: relative; }\n.katex-display > .katex > .katex-html > .tag { position: absolute; right: 0px; }\n.katex-display.leqno > .katex > .katex-html > .tag { left: 0px; right: auto; }\n.katex-display.fleqn > .katex { padding-left: 2em; text-align: left; }\nbody { counter-reset: katexEqnNo 0 mmlEqnNo 0; }\n.slick-slider { box-sizing: border-box; user-select: none; touch-action: pan-y; -webkit-tap-highlight-color: transparent; }\n.slick-list, .slick-slider { position: relative; display: block; }\n.slick-list { overflow: hidden; margin: 0px; padding: 0px; }\n.slick-list:focus { outline: none; }\n.slick-list.dragging { cursor: pointer; }\n.slick-slider .slick-list, .slick-slider .slick-track { transform: translateZ(0px); }\n.slick-track { position: relative; top: 0px; left: 0px; display: block; margin-left: auto; margin-right: auto; }\n.slick-track::after, .slick-track::before { display: table; content: \"\"; }\n.slick-track::after { clear: both; }\n.slick-loading .slick-track { visibility: hidden; }\n.slick-slide { display: none; float: left; height: 100%; min-height: 1px; }\n[dir=\"rtl\"] .slick-slide { float: right; }\n.slick-slide img { display: block; }\n.slick-slide.slick-loading img { display: none; }\n.slick-slide.dragging img { pointer-events: none; }\n.slick-initialized .slick-slide { display: block; }\n.slick-loading .slick-slide { visibility: hidden; }\n.slick-vertical .slick-slide { display: block; height: auto; border: 1px solid transparent; }\n.slick-arrow.slick-hidden { display: none; }\n.style_divider__mW0YX { --tw-bg-opacity: 1; background-color: rgb(229 231 235/var(--tw-bg-opacity,1)); }\n.style_horizontal__UvaHt { margin-top: 0.5rem; margin-bottom: 0.5rem; height: 0.5px; width: 100%; }\n.style_vertical__DA7qf { margin-left: 0.5rem; margin-right: 0.5rem; height: 100%; width: 1px; }\n.style_svgIcon__KFfCm { background-image: url(\"https://dearestie.xyz/_next/static/media/svg.85d3fb3b.svg\"); }\n.style_svgIcon__KFfCm, .style_svgIconed__3YlRE { background-position: 50% center; background-repeat: no-repeat; }\n.style_svgIconed__3YlRE { background-image: url(\"https://dearestie.xyz/_next/static/media/svged.195f7ae0.svg\"); }\n.slick-loading .slick-list { background: url(\"https://dearestie.xyz/_next/static/media/ajax-loader.0b80f665.gif\") 50% center no-repeat rgb(255, 255, 255); }\n@font-face { font-family: slick; font-weight: 400; font-style: normal; src: url(\"https://dearestie.xyz/_next/static/media/slick.653a4cbb.woff\") format(\"woff\"), url(\"https://dearestie.xyz/_next/static/media/slick.6aa1ee46.ttf\") format(\"truetype\"); }\n.slick-next, .slick-prev { font-size: 0px; line-height: 0; position: absolute; top: 50%; display: block; width: 20px; height: 20px; padding: 0px; transform: translateY(-50%); cursor: pointer; border: none; }\n.slick-next, .slick-next:focus, .slick-next:hover, .slick-prev, .slick-prev:focus, .slick-prev:hover { color: transparent; outline: none; background: transparent; }\n.slick-next:focus::before, .slick-next:hover::before, .slick-prev:focus::before, .slick-prev:hover::before { opacity: 1; }\n.slick-next.slick-disabled::before, .slick-prev.slick-disabled::before { opacity: 0.25; }\n.slick-next::before, .slick-prev::before { font-family: slick; font-size: 20px; line-height: 1; opacity: 0.75; color: rgb(255, 255, 255); -webkit-font-smoothing: antialiased; }\n.slick-prev { left: -25px; }\n[dir=\"rtl\"] .slick-prev { right: -25px; left: auto; }\n.slick-prev::before { content: \"←\"; }\n[dir=\"rtl\"] .slick-prev::before { content: \"→\"; }\n.slick-next { right: -25px; }\n[dir=\"rtl\"] .slick-next { right: auto; left: -25px; }\n.slick-next::before { content: \"→\"; }\n[dir=\"rtl\"] .slick-next::before { content: \"←\"; }\n.slick-dotted.slick-slider { margin-bottom: 30px; }\n.slick-dots { position: absolute; bottom: -25px; display: block; width: 100%; padding: 0px; margin: 0px; list-style: none; text-align: center; }\n.slick-dots li { position: relative; display: inline-block; margin: 0px 5px; padding: 0px; }\n.slick-dots li, .slick-dots li button { width: 20px; height: 20px; cursor: pointer; }\n.slick-dots li button { font-size: 0px; line-height: 0; display: block; padding: 5px; color: transparent; border: 0px; outline: none; background: transparent; }\n.slick-dots li button:focus, .slick-dots li button:hover { outline: none; }\n.slick-dots li button:focus::before, .slick-dots li button:hover::before { opacity: 1; }\n.slick-dots li button::before { font-family: slick; font-size: 6px; line-height: 20px; position: absolute; top: 0px; left: 0px; width: 20px; height: 20px; content: \"•\"; text-align: center; opacity: 0.25; color: rgb(0, 0, 0); -webkit-font-smoothing: antialiased; }\n.slick-dots li.slick-active button::before { opacity: 0.75; color: rgb(0, 0, 0); }\n.style_item__mwjpN { height: 200px; margin-right: 8px; margin-bottom: 8px; object-fit: cover; object-position: center center; border-radius: 8px; cursor: pointer; }\n.style_img-2__gAgmw .style_item__mwjpN:nth-child(2n), .style_img-4__Gs5Jw .style_item__mwjpN:nth-child(2n), .style_item__mwjpN:nth-child(3n) { margin-right: 0px; }\n.style_img-4__Gs5Jw .style_item__mwjpN:nth-child(3n) { margin-right: 8px; }\n\n/* ===== EXTERNAL STYLE #7 ===== */\n/* href: https://dearestie.xyz/_next/static/css/f9784db52263240f.css */\n/* method: cssRules */\n.provider-card_vender__QuU8S { background: linear-gradient(131deg, rgb(34, 80, 242), rgb(14, 188, 243)) text; }\n.style_gradientBorder__M0TLy { background: radial-gradient(circle at 100% 100%, rgb(252, 252, 253) 0px, rgb(252, 252, 253) 10px, transparent 0px) 0px 0px / 12px 12px no-repeat, radial-gradient(circle at 0px 100%, rgb(252, 252, 253) 0px, rgb(252, 252, 253) 10px, transparent 0px) 100% 0px / 12px 12px no-repeat, radial-gradient(circle at 100% 0px, rgb(252, 252, 253) 0px, rgb(252, 252, 253) 10px, transparent 0px) 0px 100% / 12px 12px no-repeat, radial-gradient(circle at 0px 0px, rgb(252, 252, 253) 0px, rgb(252, 252, 253) 10px, transparent 0px) 100% 100% / 12px 12px no-repeat, linear-gradient(rgb(252, 252, 253), rgb(252, 252, 253)) 50% 50% / calc(100% - 4px) calc(100% - 24px) no-repeat, linear-gradient(rgb(252, 252, 253), rgb(252, 252, 253)) 50% 50% / calc(100% - 24px) calc(100% - 4px) no-repeat, radial-gradient(at 100% 100%, rgba(45, 13, 238, 0.8) 0px, transparent 70%), radial-gradient(at 100% 0px, rgba(45, 13, 238, 0.8) 0px, transparent 70%), radial-gradient(at 0px 0px, rgba(42, 135, 245, 0.8) 0px, transparent 70%), radial-gradient(at 0px 100%, rgba(42, 135, 245, 0.8) 0px, transparent 70%); border-radius: 12px; padding: 2px; box-sizing: border-box; }\n.style_warningBorder__pnpS3 { border: 2px solid rgb(247, 144, 9); border-radius: 12px; }\n.style_optionWrap__lxkTN { display: none; }\n.style_boxHeader__9pefO:hover .style_optionWrap__lxkTN { display: flex; }\n.style_popupBtn__nc4lA { display: inline-flex; align-items: center; border-radius: var(--radius); border-width: 1px; --tw-border-opacity: 1; border-color: rgb(229 231 235/var(--tw-border-opacity,1)); --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); padding: 0.5rem 0.75rem; font-size: 1rem; line-height: 1.5rem; font-weight: 500; }\n.style_popupBtn__nc4lA:hover { --tw-bg-opacity: 1; background-color: rgb(243 244 246/var(--tw-bg-opacity,1)); }\n.style_popupBtn__nc4lA:focus { outline: transparent solid 2px; outline-offset: 2px; }\n.style_popupPanel__yqAhL { position: absolute; z-index: 10; margin-top: 0.25rem; width: 100%; max-width: 24rem; padding-left: 1rem; padding-right: 1rem; }\n@media (min-width: 640px) {\n  .style_popupPanel__yqAhL { padding-left: 0px; padding-right: 0px; }\n}\n@media (min-width: 1024px) {\n  .style_popupPanel__yqAhL { max-width: 48rem; }\n}\n.style_panelContainer__gvw8X { width: fit-content; min-width: 130px; overflow: hidden; border-radius: var(--radius); --tw-bg-opacity: 1; background-color: rgb(255 255 255/var(--tw-bg-opacity,1)); --tw-shadow: 0px 4px 6px -2px rgba(16,24,40,.03),0px 12px 16px -4px rgba(16,24,40,.08); --tw-shadow-colored: 0px 4px 6px -2px var(--tw-shadow-color),0px 12px 16px -4px var(--tw-shadow-color); --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow,0 0 #0000); --tw-ring-color: rgb(0 0 0/var(--tw-ring-opacity,1)); --tw-ring-opacity: 0.05; }\n.checkbox_wrapper__02MCf { border-color: rgb(208, 213, 221); }\n.checkbox_checked__MbT89 { background-image: ; background-position-x: ; background-position-y: ; background-repeat: ; background-attachment: ; background-origin: ; background-clip: ; background-color: ; background-size: 12px 12px; border-color: var(--primary-color); }\n\n/* ===== EXTERNAL STYLE #8 ===== */\n/* href: https://dearestie.xyz/_next/static/css/487699e825bbbaeb.css */\n/* method: cssRules */\n.emoji-picker-content { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }\n.emoji-item { width: 72px; height: 72px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; }\n.emoji-item:hover { transform: scale(1.1); background: transparent; }\n.emoji-item img { width: 48px; height: 48px; object-fit: contain; background: transparent; }\n\n/* ===== EXTERNAL STYLE #9 ===== */\n/* href: https://dearestie.xyz/_next/static/css/9cbd3f72a478284d.css */\n/* method: cssRules */\n.style_appIcon__qLtEt { position: relative; display: flex; height: 2.25rem; width: 2.25rem; flex-shrink: 0; flex-grow: 0; align-items: center; justify-content: center; border-radius: var(--radius); --tw-bg-opacity: 1; background-color: rgb(204 251 241/var(--tw-bg-opacity,1)); font-size: 1.125rem; line-height: 1.75rem; }\n.style_appIcon__qLtEt.style_large__CrEss { height: 2.5rem; width: 2.5rem; }\n.style_appIcon__qLtEt.style_small__SH1g5 { height: 2rem; width: 2rem; }\n.style_appIcon__qLtEt.style_tiny__wg0Is { height: 1.5rem; width: 1.5rem; font-size: 1rem; line-height: 1.5rem; }\n.style_appIcon__qLtEt.style_xs__a0R4X { height: 0.75rem; width: 0.75rem; font-size: 1rem; line-height: 1.5rem; }\n.style_appIcon__qLtEt.style_rounded__SeDq3 { border-radius: 9999px; }\n.style_dot-flashing__8L91Q { position: relative; animation: 1s linear 0.5s infinite alternate none running none; }\n.style_dot-flashing__8L91Q::after, .style_dot-flashing__8L91Q::before { content: \"\"; display: inline-block; position: absolute; top: 0px; animation: 1s linear 0s infinite alternate none running none; }\n.style_dot-flashing__8L91Q::before { animation-delay: 0s; }\n.style_dot-flashing__8L91Q::after { animation-delay: 1s; }\n@keyframes style_dot-flashing__8L91Q { \n  0% { background-color: rgb(102, 112, 133); }\n  50%, 100% { background-color: rgba(102, 112, 133, 0.3); }\n}\n@keyframes style_dot-flashing-avatar__l2N9h { \n  0% { background-color: rgb(21, 94, 239); }\n  50%, 100% { background-color: rgba(21, 94, 239, 0.3); }\n}\n.style_text__zGhNq, .style_text__zGhNq::after, .style_text__zGhNq::before { width: 4px; height: 4px; border-radius: 50%; background-color: rgb(102, 112, 133); color: rgb(102, 112, 133); animation-name: style_dot-flashing__8L91Q; }\n.style_text__zGhNq::before { left: -7px; }\n.style_text__zGhNq::after { left: 7px; }\n.style_avatar__DpZCA, .style_avatar__DpZCA::after, .style_avatar__DpZCA::before { width: 2px; height: 2px; border-radius: 50%; background-color: rgb(21, 94, 239); color: rgb(21, 94, 239); animation-name: style_dot-flashing-avatar__l2N9h; }\n.style_avatar__DpZCA::before { left: -5px; }\n.style_avatar__DpZCA::after { left: 5px; }\n.voice-input_wrapper__0dYSP { background: linear-gradient(131deg, rgb(34, 80, 242), rgb(14, 188, 243)); box-shadow: rgba(16, 24, 40, 0.03) 0px 4px 6px -2px, rgba(16, 24, 40, 0.08) 0px 12px 16px -4px; }\n.voice-input_convert__UTKVW { background: linear-gradient(91.92deg, rgb(16, 74, 225) -1.74%, rgb(0, 152, 238) 75.74%) text; color: transparent; }\n.style_copyIcon__euyNI { background-image: url(\"https://dearestie.xyz/_next/static/media/copy.89d68c8b.svg\"); background-position: 50% center; background-repeat: no-repeat; }\n.style_copyIcon__euyNI:hover { background-image: url(\"https://dearestie.xyz/_next/static/media/copy-hover.2cc86992.svg\"); background-position: 50% center; background-repeat: no-repeat; }\n.style_copyIcon__euyNI.style_copied__SbkhO { background-image: url(\"https://dearestie.xyz/_next/static/media/copied.350b63f0.svg\"); }\n\n";

//#endregion
//#region src/services/chat-history/viewer-renderer.js
	function pickText(source, keys, fallback = "") {
		if (!source || typeof source !== "object") return fallback;
		for (const key of keys) {
			const value = source[key];
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
		const lowerMap = {};
		for (const [key, value] of Object.entries(source)) {
			lowerMap[String(key).toLowerCase()] = value;
		}
		for (const key of keys) {
			const value = lowerMap[String(key).toLowerCase()];
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
		return fallback;
	}
	function extractAssetUrlFromCss(styleText, kind) {
		if (typeof styleText !== "string" || !styleText.trim()) return "";
		const matcher = /url\((['"]?)(.*?)\1\)/gi;
		const urls = [];
		let matched = matcher.exec(styleText);
		while (matched) {
			const raw = String(matched[2] || "").trim();
			if (raw && !raw.startsWith("data:")) {
				urls.push(raw);
			}
			matched = matcher.exec(styleText);
		}
		if (!urls.length) return "";
		return urls.find((item) => item.includes(`/${kind}`) || item.endsWith(kind)) || "";
	}
	function resolveAssetUrl({ appMeta, appId, kind }) {
		const keys = kind === "bg" ? [
			"bg",
			"bgUrl",
			"backgroundUrl",
			"background"
		] : [
			"cover",
			"coverUrl",
			"avatar",
			"avatarUrl",
			"image",
			"imageUrl"
		];
		const direct = pickText(appMeta, keys, "");
		if (direct) return direct;
		const fromCss = extractAssetUrlFromCss(appMeta?.builtInCss, kind);
		if (fromCss) return fromCss;
		if (/^[0-9a-f-]{16,}$/i.test(appId)) {
			return `https://catai.wiki/${appId}/${kind}`;
		}
		return "";
	}
	function sanitizeInlineStyleText(text) {
		return String(text || "").replace(/<\/style/gi, "<\\/style");
	}
	function encodeCopyTextPayload(text) {
		return escapeHtml(encodeURIComponent(String(text ?? "")));
	}
	const chatHistoryViewerMethods = { async buildChainViewerHtml({ appId, chainId }) {
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
		const builtInCss = sanitizeInlineStyleText(String(appMeta?.builtInCss || ""));
		const hostCss = sanitizeInlineStyleText(PREVIEW_HOST_CSS);
		const appNameRaw = typeof appMeta?.name === "string" && appMeta.name.trim() ? appMeta.name.trim() : normalizedAppId;
		const appName = escapeHtml(appNameRaw);
		const conversationIds = uniqueStringArray(chain?.conversationIds || []);
		const bgUrl = escapeHtml(resolveAssetUrl({
			appMeta,
			appId: normalizedAppId,
			kind: "bg"
		}));
		const coverUrl = escapeHtml(resolveAssetUrl({
			appMeta,
			appId: normalizedAppId,
			kind: "cover"
		}));
		const userAvatar = "我";
		const answerHistory = [];
		const messageHtml = records.length > 0 ? records.map((record, index) => {
			const rawMessage = record?.rawMessage && typeof record.rawMessage === "object" ? record.rawMessage : {};
			const queryText = asDisplayContent(rawMessage.query ?? record?.query ?? "");
			const answerText = asDisplayContent(rawMessage.answer ?? record?.answer ?? "");
			const dedupResult = stripDuplicatedAnswerPrefix(queryText, answerHistory);
			const renderedQuery = renderMessageBody(dedupResult.text || "(去重后为空)", "(去重后为空)", { preferMarkdown: false });
			const renderedAnswer = renderMessageBody(answerText, "(空回复)", { preferMarkdown: true });
			const queryContentId = `af-query-content-${index + 1}`;
			const answerContentId = `af-answer-content-${index + 1}`;
			const rawAnswerCopyPayload = encodeCopyTextPayload(answerText);
			if (answerText) {
				answerHistory.push(answerText);
			}
			return `
                    <div class="group flex mb-2 last:mb-0 af-row-user">
                        <div class="shrink-0 w-10 h-10 relative bg-white rounded-full block md:block af-avatar-user-wrap">
                            <div class="shrink-0 flex items-center rounded-full bg-primary-600 af-avatar-user">
                                <div class="text-center text-white scale-[0.4] af-avatar-user-char">${userAvatar}</div>
                            </div>
                        </div>
                        <div class="group relative ml-2 md:ml-4 mr-4 md:mr-0 af-user-wrap">
                            <div id="${queryContentId}" class="relative inline-block px-4 py-3 max-w-full text-gray-900 bg-gray-100/90 rounded-xl text-sm af-message-bubble af-user-bubble">
                                <div class="absolute top-0 left-1/2 transform -translate-x-1/2 w-[94%] h-0.5 bg-[#c9e1e9] rounded-xl af-top-line-user"></div>
                                ${renderedQuery}
                            </div>
                            <div class="af-copy-row">
                                <button class="af-copy-btn" type="button" data-af-copy-target="#${queryContentId}">复制 Query</button>
                            </div>
                        </div>
                    </div>
                    <div class="flex mb-2 last:mb-0 af-row-answer" id="ai-chat-answer">
                        <div class="chat-answer-container group grow w-0 mr-2 md:mr-4 af-answer-grow">
                            <div class="group relative ml-4 md:ml-0 af-answer-wrap">
                                <div id="${answerContentId}" class="relative inline-block px-4 py-3 w-full bg-gray-100/90 rounded-xl text-sm text-gray-900 af-message-bubble af-answer-bubble">
                                    <div class="absolute top-0 right-1/2 transform translate-x-1/2 w-[94%] h-0.5 bg-[#F1CBCB] rounded-xl af-top-line-answer"></div>
                                    ${renderedAnswer}
                                </div>
                                <div class="af-copy-row">
                                    <button class="af-copy-btn" type="button" data-af-copy-text="${rawAnswerCopyPayload}">复制 Answer</button>
                                </div>
                            </div>
                        </div>
                        <div class="shrink-0 relative w-10 h-10 bg-gray-100/90 rounded-full block md:block af-avatar-ai-wrap">
                            <img class="shrink-0 flex items-center rounded-full not-toggle af-avatar-ai" alt="${appName}" src="${coverUrl}" ${coverUrl ? "" : "style=\"display:none;\""} onerror="this.style.display='none';if(this.nextElementSibling){this.nextElementSibling.style.display='flex';}">
                            <div class="af-avatar-ai-fallback" ${coverUrl ? "style=\"display:none;\"" : ""}>AI</div>
                        </div>
                    </div>
                `;
		}).join("\n") : "<div class=\"af-empty\">当前链路暂无消息，点击“手动同步”拉取历史。</div>";
		return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${appName} - 本地会话</title>
    <style>
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
        body {
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            font-size: 14px;
            background: #f3f6fa;
            color: #111827;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        .af-root-wrap, .af-root-inner, #installedBuiltInCss {
            width: 100%;
            height: 100%;
        }
        #installedBuiltInCss {
            position: relative;
            overflow: hidden;
            background: #eef2f7;
        }
        .af-bg-img {
            width: 100%;
            height: auto;
            min-height: 100%;
            position: absolute;
            top: 50%;
            left: 0;
            transform: translateY(-50%);
            object-fit: cover;
            transition: all .5s ease-in-out;
        }
        .af-mask {
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(255,255,255,.65) 0%, rgba(255,255,255,.82) 55%, rgba(255,255,255,.94) 100%);
            pointer-events: none;
        }
        .chat-container {
            overflow-y: auto;
            width: 100%;
            height: 100%;
        }
        .chat-container::-webkit-scrollbar { width: 6px; }
        .chat-container::-webkit-scrollbar-thumb {
            border-radius: 999px;
            background: rgba(148,163,184,.55);
        }
        .af-chat-main {
            max-width: 720px;
            width: 100%;
            margin: 0 auto;
            padding: 18px 4px 20px;
            position: relative;
        }
        .af-row-user, .af-row-answer {
            margin-bottom: 8px;
            align-items: flex-start;
        }
        .af-avatar-user-wrap, .af-avatar-ai-wrap {
            width: 40px;
            height: 40px;
            border-radius: 999px;
            overflow: hidden;
        }
        .af-avatar-user-wrap {
            border: 1px solid #e5e7eb;
            background: #fff;
        }
        .af-avatar-user {
            width: 40px;
            height: 40px;
            border-radius: 999px;
            background: #2563eb;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .af-avatar-user-char {
            width: 40px;
            height: 40px;
            line-height: 40px;
            text-align: center;
            font-size: 40px;
            font-weight: 700;
            transform: scale(.4);
            transform-origin: center;
            color: #fff;
        }
        .af-user-wrap {
            margin-left: 8px;
            margin-right: 16px;
            max-width: calc(100% - 56px);
        }
        .af-answer-grow { min-width: 0; }
        .af-answer-wrap { margin-left: 16px; }
        .af-message-bubble {
            border-radius: 12px;
            border: 1px solid rgba(229,231,235,.95);
            background: rgba(243,244,246,.9);
            box-shadow: 0 1px 2px rgba(15,23,42,.06);
            overflow-x: auto;
            position: relative;
        }
        .af-user-bubble { display: inline-block; max-width: 100%; }
        .af-answer-bubble { display: inline-block; width: 100%; }
        .af-top-line-user, .af-top-line-answer {
            position: absolute;
            top: 0;
            width: 94%;
            height: 2px;
            border-radius: 999px;
        }
        .af-top-line-user { left: 50%; transform: translateX(-50%); background: #c9e1e9; }
        .af-top-line-answer { right: 50%; transform: translateX(50%); background: #f1cbcb; }
        .af-message-bubble .af-plain {
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: #111827;
            font-size: 14px;
            line-height: 1.7;
            white-space: pre-wrap !important;
            word-break: break-word;
        }
        .af-message-bubble .markdown-body {
            font-size: 14px !important;
            line-height: 1.7;
            color: #111827;
            overflow-wrap: anywhere;
            word-break: break-word;
            white-space: normal !important;
        }
        .af-copy-row {
            margin-top: 4px;
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .af-copy-btn {
            border: 1px solid #d7dde8 !important;
            border-radius: 7px !important;
            background: rgba(255, 255, 255, 0.92) !important;
            color: #4b5563 !important;
            font-size: 11px !important;
            line-height: 1 !important;
            height: 24px !important;
            padding: 0 9px !important;
            cursor: pointer !important;
            transition: all 0.18s ease !important;
        }
        .af-copy-btn:hover {
            border-color: #60a5fa !important;
            color: #1d4ed8 !important;
            background: #eff6ff !important;
        }
        .af-copy-btn:active {
            transform: scale(0.97);
        }
        .af-avatar-ai-wrap {
            border: 1px solid #d1d5db;
            background: rgba(243,244,246,.9);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .af-avatar-ai {
            width: 40px;
            height: 40px;
            object-fit: cover;
            border-radius: 999px;
        }
        .af-avatar-ai-fallback {
            width: 40px;
            height: 40px;
            border-radius: 999px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #e2e8f0;
            color: #334155;
            font-size: 12px;
            font-weight: 700;
        }
        .af-empty {
            border: 1px dashed #cbd5e1;
            border-radius: 12px;
            padding: 18px 14px;
            text-align: center;
            font-size: 13px;
            color: #64748b;
            background: rgba(255,255,255,.92);
        }
    </style>
    <style id="aifengyue-host-css">
        ${hostCss}
    </style>
    <style id="aifengyue-built-in-css">
        ${builtInCss}
    </style>
    <style id="aifengyue-preview-overrides">
        .af-message-bubble .markdown-body > :first-child { margin-top: 0 !important; }
        .af-message-bubble .markdown-body > :last-child { margin-bottom: 0 !important; }
        .af-message-bubble .markdown-body > * + * { margin-top: 10px !important; }
        .af-message-bubble .markdown-body p,
        .af-message-bubble .markdown-body ul,
        .af-message-bubble .markdown-body ol,
        .af-message-bubble .markdown-body blockquote,
        .af-message-bubble .markdown-body pre,
        .af-message-bubble .markdown-body details,
        .af-message-bubble .markdown-body table,
        .af-message-bubble .markdown-body h1,
        .af-message-bubble .markdown-body h2,
        .af-message-bubble .markdown-body h3,
        .af-message-bubble .markdown-body h4,
        .af-message-bubble .markdown-body h5,
        .af-message-bubble .markdown-body h6 {
            margin-bottom: 0 !important;
        }
        .af-message-bubble .markdown-body details {
            display: block !important;
        }
        .af-message-bubble .markdown-body summary {
            margin: 0 !important;
        }
        :where(.af-markdown-body) pre {
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            overflow: auto !important;
        }
        :where(.af-markdown-body) pre > div,
        :where(.af-markdown-body) pre > code[node] {
            display: block;
            border-radius: 10px;
            border: 1px solid rgba(0,0,0,.08);
            background: #fff;
        }
        :where(.af-markdown-body) pre > div {
            overflow: hidden;
        }
        :where(.af-markdown-body) pre > div > div.border-b {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid rgba(0,0,0,.08);
            background: rgba(248,250,252,.92);
        }
        :where(.af-markdown-body) pre > div > div.flex.justify-between > div:first-child {
            min-width: 0;
            font-size: 12px;
            line-height: 1.2;
            font-weight: 600;
            color: #64748b;
        }
        :where(.af-markdown-body) pre > div > div[node] {
            background: transparent;
            overflow: auto;
        }
        :where(.af-markdown-body) pre > div > div[node] > code[node],
        :where(.af-markdown-body) pre > code[node] {
            display: block;
            padding: 10px 12px;
            font-size: 13px;
            line-height: 1.6;
            white-space: pre;
            word-break: normal;
            overflow-wrap: normal;
            background: transparent;
            tab-size: 4;
        }
        :where(.af-markdown-body) pre div[data-tooltip-id^="copy-tooltip"] {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            padding: 4px;
            border-radius: 6px;
            cursor: pointer;
            user-select: none;
            outline: none;
        }
        :where(.af-markdown-body) pre div[data-tooltip-id^="copy-tooltip"]:focus-visible {
            box-shadow: 0 0 0 2px rgba(59,130,246,.24);
        }
        :where(.af-markdown-body) pre div[data-tooltip-id^="copy-tooltip"] > div {
            width: 16px;
            height: 16px;
            background-size: 16px 16px;
        }
        .af-message-bubble .markdown-body :not(pre) > code {
            display: inline !important;
            padding: 0.15em 0.38em !important;
            border-radius: 6px !important;
            background: rgba(15, 23, 42, 0.06) !important;
            font-size: 0.92em !important;
        }
        .af-message-bubble .markdown-body img {
            max-width: 100% !important;
            height: auto !important;
            border-radius: 10px !important;
        }
    </style>
</head>
<body>
    <div class="grow overflow-hidden af-root-wrap">
        <div class="relative h-full af-root-inner">
            <div id="installedBuiltInCss" class="relative w-full h-full overflow-hidden">
                ${bgUrl ? `<img src="${bgUrl}" alt="" class="w-full h-auto absolute top-1/2 left-0 transform -translate-y-1/2 object-cover transition-all duration-500 ease-in-out af-bg-img">` : ""}
                <div class="af-mask"></div>
                <div class="overflow-y-auto w-full h-full chat-container mx-auto">
                    <div class="mx-auto w-full max-w-[720px] px-1 md:px-4 relative af-chat-main">
                        ${messageHtml}
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
	} };

//#endregion
//#region src/services/chat-history-service.js
	const ChatHistoryService = {
		INDEX_KEY,
		...chatHistoryIndexMethods,
		...chatHistoryChainMethods,
		...chatHistoryBundleMethods,
		...chatHistoryViewerMethods
	};

//#endregion
//#region src/utils/logger.js
	const PREFIX = "AI风月注册助手";
	const LOG_STORAGE_KEY = CONFIG.STORAGE_KEYS.RUNTIME_LOG_BUFFER;
	const LOG_ENTRY_LIMIT = 240;
	const LOG_STRING_LIMIT = 400;
	const LOG_MAX_DEPTH = 3;
	const LOG_MAX_KEYS = 12;
	const LOG_MAX_ARRAY = 12;
	const runtimeLogSubscribers = new Set();
	let runtimeLogMemoryFallback = [];
	function trimText(value, maxLength = LOG_STRING_LIMIT) {
		const text = typeof value === "string" ? value : String(value ?? "");
		if (text.length <= maxLength) return text;
		return `${text.slice(0, maxLength)}…`;
	}
	function sanitizeLogMeta(value, depth = 0, seen = new WeakSet()) {
		if (value === null || value === undefined) return value;
		if (typeof value === "string") return trimText(value);
		if (typeof value === "number" || typeof value === "boolean") return value;
		if (typeof value === "bigint") return `${value}n`;
		if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
		if (value instanceof Date) return value.toISOString();
		if (value instanceof Error) {
			return {
				name: value.name || "Error",
				message: trimText(value.message || ""),
				stack: trimText(value.stack || "", 1200)
			};
		}
		if (typeof Element !== "undefined" && value instanceof Element) {
			const id = value.id ? `#${value.id}` : "";
			const className = typeof value.className === "string" && value.className.trim() ? `.${value.className.trim().replace(/\s+/g, ".")}` : "";
			return `[Element ${value.tagName?.toLowerCase?.() || "unknown"}${id}${className}]`;
		}
		if (depth >= LOG_MAX_DEPTH) {
			if (Array.isArray(value)) return `[Array(${value.length})]`;
			return "[Object]";
		}
		if (typeof value === "object") {
			if (seen.has(value)) return "[Circular]";
			seen.add(value);
			if (Array.isArray(value)) {
				const normalized = value.slice(0, LOG_MAX_ARRAY).map((item) => sanitizeLogMeta(item, depth + 1, seen));
				if (value.length > LOG_MAX_ARRAY) {
					normalized.push(`…(${value.length - LOG_MAX_ARRAY} more)`);
				}
				return normalized;
			}
			const normalized = {};
			const entries = Object.entries(value).slice(0, LOG_MAX_KEYS);
			entries.forEach(([key, item]) => {
				normalized[key] = sanitizeLogMeta(item, depth + 1, seen);
			});
			if (Object.keys(value).length > LOG_MAX_KEYS) {
				normalized.__truncated__ = `${Object.keys(value).length - LOG_MAX_KEYS} more keys`;
			}
			return normalized;
		}
		return trimText(value);
	}
	function normalizeLogEntries(entries) {
		if (!Array.isArray(entries)) return [];
		return entries.filter((entry) => entry && typeof entry === "object").slice(-LOG_ENTRY_LIMIT);
	}
	function readStoredRuntimeLogs() {
		try {
			const raw = localStorage.getItem(LOG_STORAGE_KEY);
			if (!raw) return runtimeLogMemoryFallback.slice();
			const parsed = JSON.parse(raw);
			const normalized = normalizeLogEntries(parsed);
			runtimeLogMemoryFallback = normalized;
			return normalized.slice();
		} catch {
			return runtimeLogMemoryFallback.slice();
		}
	}
	function persistRuntimeLogs(entries) {
		const normalized = normalizeLogEntries(entries);
		runtimeLogMemoryFallback = normalized;
		try {
			localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(normalized));
			return normalized.slice();
		} catch {
			const compact = normalized.slice(-Math.max(80, Math.floor(LOG_ENTRY_LIMIT / 2)));
			runtimeLogMemoryFallback = compact;
			try {
				localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(compact));
			} catch {}
			return compact.slice();
		}
	}
	function emitRuntimeLogChange(entry = null) {
		runtimeLogSubscribers.forEach((listener) => {
			try {
				listener(entry);
			} catch {}
		});
	}
	function appendRuntimeLog(entry) {
		const entries = readStoredRuntimeLogs();
		entries.push(entry);
		persistRuntimeLogs(entries);
		emitRuntimeLogChange(entry);
	}
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
		const createdAt = Date.now();
		const runId = runCtx?.runId || "NO-RUN";
		const tag = `[${PREFIX}][${runId}][${level}][${step}] ${message}`;
		output(level, tag, meta);
		appendRuntimeLog({
			id: `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			createdAt,
			level,
			runId,
			step: typeof step === "string" ? step : String(step ?? ""),
			message: trimText(message, 800),
			text: trimText(tag, 1200),
			meta: meta === undefined ? null : sanitizeLogMeta(meta)
		});
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
	function readRuntimeLogEntries({ limit = LOG_ENTRY_LIMIT } = {}) {
		const normalizedLimit = Number(limit);
		const entries = readStoredRuntimeLogs();
		if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
			return entries;
		}
		return entries.slice(-Math.floor(normalizedLimit));
	}
	function clearRuntimeLogEntries() {
		runtimeLogMemoryFallback = [];
		try {
			localStorage.removeItem(LOG_STORAGE_KEY);
		} catch {}
		emitRuntimeLogChange(null);
	}
	function subscribeRuntimeLogChange(listener) {
		if (typeof listener !== "function") {
			return () => {};
		}
		runtimeLogSubscribers.add(listener);
		return () => {
			runtimeLogSubscribers.delete(listener);
		};
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
//#region src/ui/sidebar/sidebar-context.js
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

//#endregion
//#region src/ui/sidebar/sidebar-view.js
	const sidebarViewMethods = {
		createSidebar() {
			const providerMeta = MailService.getCurrentProviderMeta();
			const providerOptions = MailService.listProviders().map((provider) => `
                                <option value="${provider.id}"${provider.id === providerMeta.id ? " selected" : ""}>${provider.name}</option>
                            `).join("");
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

                    <div class="aifengyue-tool-block" id="aifengyue-model-family-wrap">
                        <div class="aifengyue-section-title">模型映射规则</div>
                        <div class="aifengyue-input-group">
                            <label>自定义规则（每行一条）</label>
                            <textarea
                                id="aifengyue-model-family-rules"
                                class="aifengyue-model-rules-textarea"
                                placeholder="格式：prefix|标签|定位&#10;示例：gemini-2.5-pro|Gemini 2.5 Pro|高智"
                            ></textarea>
                        </div>
                        <div class="aifengyue-btn-group">
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-model-family-save">
                                💾 保存规则
                            </button>
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-model-family-reset">
                                ♻ 重置自定义
                            </button>
                        </div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-model-family-fill-unknown" style="margin-top:8px;">
                            ✨ 追加未映射前缀
                        </button>
                        <div class="aifengyue-input-group" style="margin-top:10px;">
                            <label>当前未映射前缀（只读）</label>
                            <textarea
                                id="aifengyue-model-family-unknowns"
                                class="aifengyue-model-rules-textarea"
                                readonly
                                placeholder="先打开模型弹窗触发一次扫描，这里会显示可补录的前缀建议"
                            ></textarea>
                        </div>
                        <div class="aifengyue-hint">
                            默认规则会直接显示在输入框里，可按需修改并保存。建议先点一次“立即排序”再补录未映射前缀。
                        </div>
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
                            <textarea id="aifengyue-switch-text" class="aifengyue-textarea aifengyue-switch-textarea" placeholder="输入附加文本（query 会自动组装为：触发词 + 换行 + 文本）"></textarea>
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
                            <label>邮件提供商</label>
                            <select id="aifengyue-mail-provider">
${providerOptions}
                            </select>
                            <div class="aifengyue-hint">切换后会立即清空当前邮箱与验证码，请重新生成邮箱。</div>
                        </div>
                        <div class="aifengyue-input-group" id="aifengyue-api-key-group">
                            <label id="aifengyue-api-key-label">${providerMeta.apiKeyLabel}</label>
                            <input type="text" id="aifengyue-api-key" placeholder="${providerMeta.apiKeyPlaceholder}">
                        </div>
                        <div class="aifengyue-hint" id="aifengyue-mail-provider-key-hint"></div>
                        <div class="aifengyue-input-group">
                            <div class="aifengyue-hint" id="aifengyue-mail-provider-name">当前邮件提供商：${providerMeta.name}</div>
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-save-key">💾 保存 API Key</button>
                        </div>
                    </div>

                    <div class="aifengyue-section" id="aifengyue-usage-section">
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
                                <span id="aifengyue-usage-remaining">等待邮件接口返回 usage...</span>
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
                        <div class="aifengyue-input-group">
                            <label>/chat-messages 超时秒数</label>
                            <input
                                type="number"
                                id="aifengyue-chat-timeout-seconds"
                                min="0"
                                max="300"
                                step="1"
                                placeholder="0 表示关闭主动失败"
                            >
                            <div class="aifengyue-hint">
                                等待中/发送中超过该秒数将主动中止请求并判定失败（0 关闭）。
                            </div>
                        </div>
                        <div class="aifengyue-input-group">
                            <label>积分轮询秒数</label>
                            <input
                                type="number"
                                id="aifengyue-account-point-poll-seconds"
                                min="2"
                                max="300"
                                step="1"
                                placeholder="默认 15 秒"
                            >
                            <div class="aifengyue-hint">
                                仅在应用详情页生效；到达间隔后会请求 account/point 并更新页面积分徽章。
                            </div>
                        </div>
                        <div class="aifengyue-input-group">
                            <label>号池定时检测秒数</label>
                            <input
                                type="number"
                                id="aifengyue-token-pool-check-seconds"
                                min="0"
                                max="3600"
                                step="1"
                                placeholder="默认 300 秒（0=关闭）"
                            >
                            <div class="aifengyue-hint">
                                全站后台维护号池，目标保留 2 个满积分备用 token（不含当前账号）。
                            </div>
                        </div>
                        <div class="aifengyue-status-card">
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">备用满积分</span>
                                <span class="aifengyue-info-value" id="aifengyue-token-pool-full">-</span>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">池总量</span>
                                <span class="aifengyue-info-value" id="aifengyue-token-pool-total">-</span>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">维护状态</span>
                                <span class="aifengyue-info-value" id="aifengyue-token-pool-status">-</span>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">最近检测</span>
                                <span class="aifengyue-info-value" id="aifengyue-token-pool-last-check">-</span>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">退避到期</span>
                                <span class="aifengyue-info-value" id="aifengyue-token-pool-next-allowed">-</span>
                            </div>
                            <div class="aifengyue-info-row">
                                <span class="aifengyue-info-label">最近错误</span>
                                <span class="aifengyue-info-value" id="aifengyue-token-pool-last-error">-</span>
                            </div>
                        </div>
                        <div class="aifengyue-btn-group">
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-token-pool-maintain">
                                立即维护
                            </button>
                            <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-token-pool-view-log">
                                查看日志
                            </button>
                        </div>
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
		createTokenPoolLogModal() {
			const existing = document.getElementById("aifengyue-token-pool-log-modal");
			if (existing) {
				existing.remove();
			}
			const modal = document.createElement("div");
			modal.id = "aifengyue-token-pool-log-modal";
			modal.innerHTML = `
            <div class="aifengyue-conv-modal-backdrop">
                <div class="aifengyue-log-modal-content" role="dialog" aria-modal="true" aria-label="号池运行日志">
                    <div class="aifengyue-conv-modal-head">
                        <div class="aifengyue-conv-modal-title">号池运行日志</div>
                        <div class="aifengyue-log-modal-head-actions">
                            <button id="aifengyue-token-pool-log-refresh" class="aifengyue-copy-btn" title="刷新日志">刷新</button>
                            <button id="aifengyue-token-pool-log-clear" class="aifengyue-copy-btn" title="清空日志">清空</button>
                            <button id="aifengyue-token-pool-log-modal-close" class="aifengyue-conv-modal-close" title="关闭">✕</button>
                        </div>
                    </div>
                    <div class="aifengyue-log-modal-body">
                        <div id="aifengyue-token-pool-log-summary" class="aifengyue-hint"></div>
                        <div id="aifengyue-token-pool-log-list" class="aifengyue-log-list"></div>
                    </div>
                </div>
            </div>
        `;
			document.body.appendChild(modal);
			modal.dataset.theme = this.theme;
			this.tokenPoolLogModal = modal;
			this.tokenPoolLogModalOpen = false;
			modal.querySelector("#aifengyue-token-pool-log-modal-close")?.addEventListener("click", () => this.closeTokenPoolLogModal());
			modal.querySelector("#aifengyue-token-pool-log-refresh")?.addEventListener("click", () => this.renderTokenPoolLogModal());
			modal.querySelector("#aifengyue-token-pool-log-clear")?.addEventListener("click", () => this.clearTokenPoolLogs());
			if (typeof this.tokenPoolLogUnsubscribe === "function") {
				this.tokenPoolLogUnsubscribe();
				this.tokenPoolLogUnsubscribe = null;
			}
			this.tokenPoolLogUnsubscribe = subscribeRuntimeLogChange(() => {
				if (this.tokenPoolLogModalOpen) {
					this.renderTokenPoolLogModal();
				}
			});
			if (this.tokenPoolLogModalEscHandler) {
				document.removeEventListener("keydown", this.tokenPoolLogModalEscHandler);
			}
			this.tokenPoolLogModalEscHandler = (event) => {
				if (event.key === "Escape" && this.tokenPoolLogModalOpen) {
					this.closeTokenPoolLogModal();
				}
			};
			document.addEventListener("keydown", this.tokenPoolLogModalEscHandler);
		},
		openTokenPoolLogModal() {
			if (!this.tokenPoolLogModal) {
				this.createTokenPoolLogModal();
			}
			if (!this.tokenPoolLogModal) return;
			this.tokenPoolLogModal.classList.add("open");
			this.tokenPoolLogModalOpen = true;
			this.renderTokenPoolLogModal();
		},
		closeTokenPoolLogModal() {
			if (!this.tokenPoolLogModal) return;
			this.tokenPoolLogModal.classList.remove("open");
			this.tokenPoolLogModalOpen = false;
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
		}
	};

//#endregion
//#region src/ui/sidebar/sidebar-events.js
	const sidebarEventsMethods = {
		bindEvents() {
			this.element.querySelector(".aifengyue-sidebar-close").addEventListener("click", () => this.close());
			this.element.querySelector(".aifengyue-theme-toggle").addEventListener("click", () => this.toggleTheme());
			this.element.querySelectorAll(".aifengyue-tab-btn").forEach((btn) => {
				btn.addEventListener("click", () => {
					this.setActiveTab(btn.dataset.tab);
					if (btn.dataset.tab === "tools") {
						this.refreshModelFamilyMappingEditor();
					}
				});
			});
			this.element.querySelector("#aifengyue-save-key").addEventListener("click", () => {
				const input = this.element.querySelector("#aifengyue-api-key");
				const providerMeta = MailService.getCurrentProviderMeta();
				if (!providerMeta.requiresApiKey) {
					this.refreshMailProviderConfigDisplay();
					getToast()?.info(`${providerMeta.name} 无需 API Key`);
					return;
				}
				const key = input.value.trim() || MailService.getDefaultApiKey();
				MailService.setApiKey(key);
				this.refreshMailProviderConfigDisplay();
				getToast()?.success(`${providerMeta.name} API Key 已保存`);
			});
			this.element.querySelector("#aifengyue-mail-provider").addEventListener("change", (e) => {
				const providerId = typeof e?.target?.value === "string" ? e.target.value : "";
				if (!providerId || providerId === MailService.getCurrentProviderId()) {
					this.refreshMailProviderConfigDisplay();
					return;
				}
				MailService.setCurrentProviderId(providerId);
				const providerMeta = MailService.getCurrentProviderMeta();
				this.refreshMailProviderConfigDisplay();
				this.updateUsageDisplay(MailService.getUsageSnapshot(providerMeta.id));
				this.resetMailProviderState(providerMeta);
				getToast()?.success(`已切换到 ${providerMeta.name}，请重新生成邮箱`);
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
			this.element.querySelector("#aifengyue-chat-timeout-seconds").addEventListener("change", (e) => {
				const seconds = this.setChatMessagesTimeoutSeconds(e?.target?.value);
				if (seconds > 0) {
					getToast()?.info(`/chat-messages 超时已设置为 ${seconds} 秒`);
				} else {
					getToast()?.info("/chat-messages 超时主动失败已关闭");
				}
			});
			const pointPollInput = this.element.querySelector("#aifengyue-account-point-poll-seconds");
			const applyPointPollingSeconds = (value, { showToast = false } = {}) => {
				const seconds = this.setAccountPointPollSeconds(value);
				getAutoRegister()?.refreshAccountPointPolling({ intervalMs: seconds * 1e3 });
				if (showToast) {
					getToast()?.info(`积分轮询间隔已设置为 ${seconds} 秒`);
				}
				return seconds;
			};
			pointPollInput.addEventListener("input", (e) => {
				if (this.accountPointPollApplyTimer) {
					clearTimeout(this.accountPointPollApplyTimer);
				}
				this.accountPointPollApplyTimer = setTimeout(() => {
					applyPointPollingSeconds(e?.target?.value, { showToast: false });
					this.accountPointPollApplyTimer = null;
				}, 420);
			});
			pointPollInput.addEventListener("change", (e) => {
				if (this.accountPointPollApplyTimer) {
					clearTimeout(this.accountPointPollApplyTimer);
					this.accountPointPollApplyTimer = null;
				}
				applyPointPollingSeconds(e?.target?.value, { showToast: true });
			});
			const tokenPoolCheckInput = this.element.querySelector("#aifengyue-token-pool-check-seconds");
			const applyTokenPoolCheckSeconds = (value, { showToast = false } = {}) => {
				const seconds = this.setTokenPoolCheckSeconds(value);
				const autoRegister = getAutoRegister();
				autoRegister?.refreshTokenPoolScheduler?.({
					intervalSeconds: seconds,
					reason: "settings-change"
				});
				this.refreshTokenPoolSummary(autoRegister?.getTokenPoolSummary?.() || null);
				if (showToast) {
					if (seconds > 0) {
						getToast()?.info(`号池定时检测已设置为 ${seconds} 秒`);
					} else {
						getToast()?.info("号池定时检测已关闭");
					}
				}
				return seconds;
			};
			tokenPoolCheckInput.addEventListener("input", (e) => {
				if (this.tokenPoolCheckApplyTimer) {
					clearTimeout(this.tokenPoolCheckApplyTimer);
				}
				this.tokenPoolCheckApplyTimer = setTimeout(() => {
					applyTokenPoolCheckSeconds(e?.target?.value, { showToast: false });
					this.tokenPoolCheckApplyTimer = null;
				}, 420);
			});
			tokenPoolCheckInput.addEventListener("change", (e) => {
				if (this.tokenPoolCheckApplyTimer) {
					clearTimeout(this.tokenPoolCheckApplyTimer);
					this.tokenPoolCheckApplyTimer = null;
				}
				applyTokenPoolCheckSeconds(e?.target?.value, { showToast: true });
			});
			this.element.querySelector("#aifengyue-token-pool-maintain").addEventListener("click", async () => {
				const autoRegister = getAutoRegister();
				if (!autoRegister?.maintainTokenPool) {
					getToast()?.warning("号池维护能力未就绪");
					return;
				}
				this.openTokenPoolLogModal();
				const summary = await autoRegister.maintainTokenPool({
					reason: "manual-button",
					force: true
				});
				this.refreshTokenPoolSummary(summary);
				this.renderTokenPoolLogModal();
				if (summary?.maintaining) {
					getToast()?.info("号池已在维护中，可在日志弹窗查看实时进度");
					return;
				}
				if (summary?.status === "ok") {
					getToast()?.success("号池手动维护完成");
					return;
				}
				if (summary?.status === "failed") {
					getToast()?.warning("号池维护失败，请查看日志详情");
					return;
				}
				getToast()?.info("号池维护已触发，可在日志弹窗查看详情");
			});
			this.element.querySelector("#aifengyue-token-pool-view-log").addEventListener("click", () => {
				this.openTokenPoolLogModal();
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
				this.refreshModelFamilyMappingEditor();
				getToast()?.info("已触发一次模型排序");
			});
			this.element.querySelector("#aifengyue-sort-toggle").addEventListener("change", (e) => {
				const sorter = getModelPopupSorter();
				if (!sorter) return;
				sorter.setSortEnabled(!!e.target.checked);
				getToast()?.info(`自动排序已${e.target.checked ? "开启" : "关闭"}`);
			});
			this.element.querySelector("#aifengyue-model-family-save").addEventListener("click", () => {
				const sorter = getModelPopupSorter();
				if (!sorter) return;
				const input = this.element.querySelector("#aifengyue-model-family-rules");
				const text = typeof input?.value === "string" ? input.value : "";
				sorter.setModelFamilyRulesText(text);
				this.refreshModelFamilyMappingEditor();
				getToast()?.success("模型映射规则已保存并生效");
			});
			this.element.querySelector("#aifengyue-model-family-reset").addEventListener("click", () => {
				const sorter = getModelPopupSorter();
				if (!sorter) return;
				sorter.resetModelFamilyRulesText();
				this.refreshModelFamilyMappingEditor();
				getToast()?.info("已恢复默认映射规则");
			});
			this.element.querySelector("#aifengyue-model-family-fill-unknown").addEventListener("click", () => {
				const sorter = getModelPopupSorter();
				if (!sorter) return;
				const draft = sorter.getUnknownModelFamilySuggestionText(80);
				if (!draft) {
					getToast()?.warning("暂无未映射前缀，请先打开模型弹窗触发扫描");
					return;
				}
				const input = this.element.querySelector("#aifengyue-model-family-rules");
				if (!input) return;
				const current = String(input.value || "").trim();
				const lines = new Set(current ? current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []);
				draft.split(/\r?\n/).forEach((line) => {
					const normalized = line.trim();
					if (normalized) lines.add(normalized);
				});
				input.value = [...lines].join("\n");
				getToast()?.info("已追加未映射前缀草案，请检查后点击“保存规则”");
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
			const triggers = doc.querySelectorAll("[data-af-copy-target], [data-af-copy-text]");
			const handleCopy = async (trigger) => {
				const mode = trigger.getAttribute("data-af-copy-mode") || "text";
				const encodedText = trigger.getAttribute("data-af-copy-text");
				let rawText = "";
				if (encodedText !== null) {
					try {
						rawText = decodeURIComponent(encodedText);
					} catch {
						rawText = encodedText;
					}
				} else {
					const selector = trigger.getAttribute("data-af-copy-target") || "";
					if (!selector) return;
					const target = doc.querySelector(selector);
					if (mode === "icon") {
						rawText = typeof target?.textContent === "string" ? target.textContent.replace(/\u00a0/g, " ").replace(/\u200b/g, "") : "";
					} else if (target) {
						const copyRoot = target.cloneNode(true);
						copyRoot.querySelectorAll("[data-af-copy-ignore]").forEach((node) => node.remove());
						rawText = typeof copyRoot.textContent === "string" ? copyRoot.textContent.replace(/\u00a0/g, " ").replace(/\u200b/g, "") : "";
					}
				}
				const text = encodedText !== null ? rawText : mode === "icon" ? rawText : rawText.trim();
				if (!text) {
					getToast()?.warning(mode === "icon" ? "当前代码块为空，无法复制" : "当前消息为空，无法复制");
					return;
				}
				const copied = await this.copyTextToClipboard(text, {
					successMessage: mode === "icon" ? "代码已复制到剪贴板" : "消息已复制到剪贴板",
					errorMessage: mode === "icon" ? "代码复制失败" : "消息复制失败"
				});
				if (!copied) return;
				if (mode === "icon") {
					const icon = trigger.querySelector(".af-code-copy-icon");
					const copiedClass = trigger.getAttribute("data-af-copy-copied-class") || "style_copied__SbkhO";
					if (!icon) return;
					if (trigger.__afCopyResetTimer) {
						clearTimeout(trigger.__afCopyResetTimer);
					}
					icon.classList.add(copiedClass, "af-code-copy-icon-copied");
					trigger.__afCopyResetTimer = setTimeout(() => {
						icon.classList.remove(copiedClass, "af-code-copy-icon-copied");
						trigger.__afCopyResetTimer = null;
					}, 900);
					return;
				}
				const prev = trigger.textContent;
				trigger.textContent = "已复制";
				setTimeout(() => {
					trigger.textContent = prev || "复制";
				}, 900);
			};
			triggers.forEach((trigger) => {
				if (trigger.dataset.afCopyBound === "1") return;
				trigger.dataset.afCopyBound = "1";
				trigger.addEventListener("click", async (event) => {
					event.preventDefault();
					await handleCopy(trigger);
				});
				if (trigger.getAttribute("data-af-copy-mode") === "icon") {
					trigger.addEventListener("keydown", async (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						await handleCopy(trigger);
					});
				}
			});
		}
	};

//#endregion
//#region src/ui/sidebar/sidebar-conversation.js
	const sidebarConversationMethods = {
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
		}
	};

//#endregion
//#region src/ui/sidebar/sidebar-settings.js
	const sidebarSettingsMethods = {
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
		normalizeChatMessagesTimeoutSeconds(value) {
			const parsed = Number(value);
			if (!Number.isFinite(parsed)) return 0;
			const normalized = Math.floor(parsed);
			if (normalized <= 0) return 0;
			return Math.min(normalized, 300);
		},
		getChatMessagesTimeoutSeconds() {
			const saved = gmGetValue(CONFIG.STORAGE_KEYS.CHAT_MESSAGES_TIMEOUT_SECONDS, 0);
			return this.normalizeChatMessagesTimeoutSeconds(saved);
		},
		setChatMessagesTimeoutSeconds(value) {
			const normalized = this.normalizeChatMessagesTimeoutSeconds(value);
			gmSetValue(CONFIG.STORAGE_KEYS.CHAT_MESSAGES_TIMEOUT_SECONDS, normalized);
			const input = this.element?.querySelector?.("#aifengyue-chat-timeout-seconds");
			if (input) {
				input.value = String(normalized);
			}
			return normalized;
		},
		normalizeAccountPointPollSeconds(value) {
			const parsed = Number(value);
			if (!Number.isFinite(parsed)) return 15;
			const normalized = Math.floor(parsed);
			if (normalized < 2) return 2;
			return Math.min(normalized, 300);
		},
		getAccountPointPollSeconds() {
			const saved = gmGetValue(CONFIG.STORAGE_KEYS.ACCOUNT_POINT_POLL_SECONDS, 15);
			return this.normalizeAccountPointPollSeconds(saved);
		},
		setAccountPointPollSeconds(value) {
			const normalized = this.normalizeAccountPointPollSeconds(value);
			gmSetValue(CONFIG.STORAGE_KEYS.ACCOUNT_POINT_POLL_SECONDS, normalized);
			const input = this.element?.querySelector?.("#aifengyue-account-point-poll-seconds");
			if (input) {
				input.value = String(normalized);
			}
			return normalized;
		},
		normalizeTokenPoolCheckSeconds(value) {
			const parsed = Number(value);
			if (!Number.isFinite(parsed)) return 300;
			const normalized = Math.floor(parsed);
			if (normalized <= 0) return 0;
			return Math.min(normalized, 3600);
		},
		getTokenPoolCheckSeconds() {
			const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS);
			const fallback = 300;
			return this.normalizeTokenPoolCheckSeconds(raw === null ? fallback : raw);
		},
		setTokenPoolCheckSeconds(value) {
			const normalized = this.normalizeTokenPoolCheckSeconds(value);
			localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS, String(normalized));
			const input = this.element?.querySelector?.("#aifengyue-token-pool-check-seconds");
			if (input) {
				input.value = String(normalized);
			}
			return normalized;
		},
		formatTokenPoolTime(value) {
			const timestamp = Number(value);
			if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
			try {
				return new Date(timestamp).toLocaleString();
			} catch {
				return "-";
			}
		},
		getTokenPoolStatusText(summary = {}) {
			if (summary?.maintaining) return "维护中";
			switch (summary?.status) {
				case "ok": return "最近成功";
				case "failed": return "最近失败";
				case "backoff": return "退避等待";
				case "stopped": return "已停止";
				case "running": return "定时中";
				default: return summary?.schedulerEnabled ? summary?.schedulerRunning ? "运行中" : "待启动" : "已关闭";
			}
		},
		escapeLogHtml(value) {
			const text = typeof value === "string" ? value : String(value ?? "");
			return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
		},
		getTokenPoolLogEntries(limit = 200) {
			const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 200));
			const entries = readRuntimeLogEntries({ limit: Math.max(normalizedLimit * 3, normalizedLimit) });
			return entries.filter((entry) => {
				const runId = typeof entry?.runId === "string" ? entry.runId : "";
				const step = typeof entry?.step === "string" ? entry.step : "";
				const message = typeof entry?.message === "string" ? entry.message : "";
				return runId.startsWith("POOL-") || step.includes("TOKEN_POOL") || step.includes("SWITCH_POOL") || message.includes("号池");
			}).slice(-normalizedLimit);
		},
		renderTokenPoolLogModal() {
			if (!this.tokenPoolLogModal) return;
			const summaryEl = this.tokenPoolLogModal.querySelector("#aifengyue-token-pool-log-summary");
			const listEl = this.tokenPoolLogModal.querySelector("#aifengyue-token-pool-log-list");
			const entries = this.getTokenPoolLogEntries(180);
			const latestEntry = entries[entries.length - 1] || null;
			const poolSummary = getAutoRegister()?.getTokenPoolSummary?.() || null;
			if (summaryEl) {
				const statusText = this.getTokenPoolStatusText(poolSummary || {});
				const latestText = latestEntry ? `${this.formatTokenPoolTime(latestEntry.createdAt)} / ${latestEntry.runId || "NO-RUN"}` : "暂无";
				const detailHint = isDebugEnabled() ? "DEBUG 已开启，当前会记录更细的请求与响应细节。" : "如需更多请求明细，可先打开「启用调试日志（DEBUG）」。";
				summaryEl.textContent = `当前状态：${statusText}；最近日志：${latestText}；日志条数：${entries.length}；${detailHint}`;
			}
			if (!listEl) return;
			if (!entries.length) {
				listEl.innerHTML = `
                <div class="aifengyue-log-empty">
                    暂无号池运行日志。可先点“立即维护”，再打开这里查看完整过程。
                </div>
            `;
				return;
			}
			listEl.innerHTML = entries.slice().reverse().map((entry) => {
				const level = typeof entry?.level === "string" ? entry.level : "INFO";
				const levelClass = `is-${level.toLowerCase()}`;
				const timeText = this.formatTokenPoolTime(entry?.createdAt);
				const stepText = typeof entry?.step === "string" && entry.step.trim() ? entry.step.trim() : "-";
				const runIdText = typeof entry?.runId === "string" && entry.runId.trim() ? entry.runId.trim() : "NO-RUN";
				const messageText = typeof entry?.message === "string" ? entry.message : "";
				const metaText = entry?.meta ? JSON.stringify(entry.meta, null, 2) : "";
				const metaHtml = metaText ? `<pre class="aifengyue-log-meta">${this.escapeLogHtml(metaText)}</pre>` : "";
				return `
                    <div class="aifengyue-log-entry ${levelClass}">
                        <div class="aifengyue-log-entry-head">
                            <span class="aifengyue-log-level">${this.escapeLogHtml(level)}</span>
                            <span class="aifengyue-log-time">${this.escapeLogHtml(timeText)}</span>
                            <span class="aifengyue-log-step">${this.escapeLogHtml(stepText)}</span>
                        </div>
                        <div class="aifengyue-log-message">${this.escapeLogHtml(messageText)}</div>
                        <div class="aifengyue-log-run">${this.escapeLogHtml(runIdText)}</div>
                        ${metaHtml}
                    </div>
                `;
			}).join("");
		},
		clearTokenPoolLogs() {
			clearRuntimeLogEntries();
			this.renderTokenPoolLogModal();
			getToast()?.success("号池运行日志已清空");
		},
		refreshTokenPoolSummary(summary = null) {
			if (!this.element) return;
			const autoRegister = getAutoRegister();
			const resolvedSummary = summary && typeof summary === "object" ? summary : autoRegister?.getTokenPoolSummary?.() || null;
			if (!resolvedSummary || typeof resolvedSummary !== "object") return;
			const fullCount = Number(resolvedSummary.fullCount || 0);
			const totalCount = Number(resolvedSummary.totalCount || 0);
			const targetFullCount = Number(resolvedSummary.targetFullCount || 2);
			const maxCount = Number(resolvedSummary.maxCount || 5);
			const lastCheckAtText = this.formatTokenPoolTime(resolvedSummary.lastCheckAt);
			const nextAllowedAtText = this.formatTokenPoolTime(resolvedSummary.nextAllowedAt);
			const errorText = typeof resolvedSummary.lastError === "string" && resolvedSummary.lastError.trim() ? resolvedSummary.lastError.trim() : "-";
			const statusText = this.getTokenPoolStatusText(resolvedSummary);
			const fullEl = this.element.querySelector("#aifengyue-token-pool-full");
			const totalEl = this.element.querySelector("#aifengyue-token-pool-total");
			const statusEl = this.element.querySelector("#aifengyue-token-pool-status");
			const lastCheckEl = this.element.querySelector("#aifengyue-token-pool-last-check");
			const nextAllowedEl = this.element.querySelector("#aifengyue-token-pool-next-allowed");
			const errorEl = this.element.querySelector("#aifengyue-token-pool-last-error");
			const maintainBtn = this.element.querySelector("#aifengyue-token-pool-maintain");
			if (fullEl) fullEl.textContent = `${fullCount} / ${targetFullCount}`;
			if (totalEl) totalEl.textContent = `${totalCount} / ${maxCount}`;
			if (statusEl) statusEl.textContent = statusText;
			if (lastCheckEl) lastCheckEl.textContent = lastCheckAtText;
			if (nextAllowedEl) nextAllowedEl.textContent = nextAllowedAtText;
			if (errorEl) errorEl.textContent = errorText;
			if (maintainBtn) {
				maintainBtn.disabled = !!resolvedSummary.maintaining;
				maintainBtn.textContent = resolvedSummary.maintaining ? "维护中..." : "立即维护";
			}
			if (this.tokenPoolLogModalOpen) {
				this.renderTokenPoolLogModal();
			}
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
			if (this.tokenPoolLogModal) {
				this.tokenPoolLogModal.dataset.theme = this.theme;
			}
			const btn = this.element.querySelector(".aifengyue-theme-toggle");
			if (btn) btn.textContent = this.theme === "dark" ? "☀" : "🌙";
		},
		toggleTheme() {
			this.setTheme(this.theme === "dark" ? "light" : "dark");
		},
		refreshMailProviderConfigDisplay() {
			if (!this.element) return;
			const providerMeta = MailService.getCurrentProviderMeta();
			const providerSelect = this.element.querySelector("#aifengyue-mail-provider");
			const apiKeyGroup = this.element.querySelector("#aifengyue-api-key-group");
			const apiKeyLabel = this.element.querySelector("#aifengyue-api-key-label");
			const apiKeyInput = this.element.querySelector("#aifengyue-api-key");
			const providerKeyHint = this.element.querySelector("#aifengyue-mail-provider-key-hint");
			const providerName = this.element.querySelector("#aifengyue-mail-provider-name");
			const saveKeyButton = this.element.querySelector("#aifengyue-save-key");
			const usageSection = this.element.querySelector("#aifengyue-usage-section");
			if (providerSelect) {
				providerSelect.value = providerMeta.id;
			}
			if (apiKeyLabel) {
				apiKeyLabel.textContent = providerMeta.apiKeyLabel;
			}
			if (apiKeyInput) {
				apiKeyInput.placeholder = providerMeta.apiKeyPlaceholder;
				apiKeyInput.value = providerMeta.requiresApiKey ? MailService.getApiKey() : "";
				apiKeyInput.disabled = !providerMeta.requiresApiKey;
			}
			if (apiKeyGroup) {
				apiKeyGroup.style.display = providerMeta.requiresApiKey ? "" : "none";
			}
			if (providerKeyHint) {
				providerKeyHint.textContent = providerMeta.requiresApiKey ? "" : "当前邮件提供商无需 API Key";
				providerKeyHint.style.display = providerMeta.requiresApiKey ? "none" : "";
			}
			if (providerName) {
				providerName.textContent = `当前邮件提供商：${providerMeta.name}`;
			}
			if (saveKeyButton) {
				saveKeyButton.disabled = !providerMeta.requiresApiKey;
				saveKeyButton.style.display = providerMeta.requiresApiKey ? "" : "none";
			}
			if (usageSection) {
				usageSection.style.display = providerMeta.supportsUsage ? "" : "none";
			}
		},
		resetMailProviderState(providerMeta = MailService.getCurrentProviderMeta()) {
			gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, "");
			this.updateState({
				email: "",
				verificationCode: "",
				status: "idle",
				statusMessage: `已切换到 ${providerMeta.name}，请重新生成邮箱`
			});
			const autoRegister = getAutoRegister();
			if (!autoRegister?.getFormElements || !autoRegister?.simulateInput) {
				return;
			}
			const { emailInput, codeInput } = autoRegister.getFormElements();
			if (emailInput) {
				autoRegister.simulateInput(emailInput, "");
			}
			if (codeInput) {
				autoRegister.simulateInput(codeInput, "");
			}
		},
		formatUsageSummary(snapshot) {
			if (snapshot?.usageStatus === "unsupported" || snapshot?.supportsUsage === false) {
				return "当前邮件提供商未提供 usage";
			}
			if (!snapshot?.hasUsage) {
				return "等待邮件接口返回 usage...";
			}
			const totalRemaining = Number(snapshot?.remaining || 0);
			const totalText = totalRemaining < 0 ? `总剩余: 超限 ${Math.abs(totalRemaining)} 次` : `总剩余: ${totalRemaining} 次`;
			const dailyLimit = Number(snapshot?.dailyLimit || 0);
			const dailyUsed = Number(snapshot?.dailyUsed || 0);
			if (dailyLimit > 0) {
				return `${totalText} · 今日: ${dailyUsed} / ${dailyLimit}`;
			}
			if (dailyUsed > 0 || Number.isFinite(Number(snapshot?.dailyRemaining))) {
				return `${totalText} · 今日已用: ${dailyUsed} 次`;
			}
			return totalText;
		},
		updateUsageDisplay(snapshot = MailService.getUsageSnapshot()) {
			if (!this.element) return;
			const usageText = this.element.querySelector("#aifengyue-usage-text");
			const usageBar = this.element.querySelector("#aifengyue-usage-bar");
			const usageRemaining = this.element.querySelector("#aifengyue-usage-remaining");
			if (!snapshot?.hasUsage) {
				if (usageText) usageText.textContent = "-- / --";
				if (usageBar) {
					usageBar.style.width = "0%";
					usageBar.style.background = "linear-gradient(90deg, #64748b, #94a3b8)";
				}
				if (usageRemaining) usageRemaining.textContent = this.formatUsageSummary(snapshot);
				return;
			}
			const used = Number(snapshot?.used || 0);
			const limit = Number(snapshot?.limit || CONFIG.API_QUOTA_LIMIT || 0);
			const percentage = Number(snapshot?.percentage || 0);
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
			if (usageRemaining) usageRemaining.textContent = this.formatUsageSummary(snapshot);
		},
		refreshModelFamilyMappingEditor() {
			if (!this.element) return;
			const sorter = getModelPopupSorter();
			if (!sorter) return;
			const rulesInput = this.element.querySelector("#aifengyue-model-family-rules");
			const unknownInput = this.element.querySelector("#aifengyue-model-family-unknowns");
			if (rulesInput) {
				rulesInput.value = sorter.getModelFamilyRulesText();
			}
			if (unknownInput) {
				unknownInput.value = sorter.getUnknownModelFamilySuggestionText(80);
			}
		}
	};

//#endregion
//#region src/ui/sidebar/sidebar-state.js
	const sidebarStateMethods = {
		loadSavedData() {
			this.refreshMailProviderConfigDisplay();
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
			const chatTimeoutInput = this.element.querySelector("#aifengyue-chat-timeout-seconds");
			if (chatTimeoutInput) {
				chatTimeoutInput.value = String(this.getChatMessagesTimeoutSeconds());
			}
			const accountPointPollInput = this.element.querySelector("#aifengyue-account-point-poll-seconds");
			if (accountPointPollInput) {
				accountPointPollInput.value = String(this.getAccountPointPollSeconds());
			}
			const tokenPoolCheckInput = this.element.querySelector("#aifengyue-token-pool-check-seconds");
			if (tokenPoolCheckInput) {
				tokenPoolCheckInput.value = String(this.getTokenPoolCheckSeconds());
			}
			this.updateUsageDisplay(MailService.getUsageSnapshot());
			this.refreshTokenPoolSummary();
			this.refreshModelFamilyMappingEditor();
			this.render();
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
			const chatTimeoutInput = this.element.querySelector("#aifengyue-chat-timeout-seconds");
			const accountPointPollInput = this.element.querySelector("#aifengyue-account-point-poll-seconds");
			const tokenPoolCheckInput = this.element.querySelector("#aifengyue-token-pool-check-seconds");
			if (email) email.textContent = this.state.email || "未生成";
			if (username) username.textContent = this.state.username || "未生成";
			if (password) password.textContent = this.state.password || "未生成";
			if (code) code.textContent = this.state.verificationCode || "等待中...";
			if (debugToggle) debugToggle.checked = isDebugEnabled();
			if (autoReloadToggle) autoReloadToggle.checked = this.getAutoReloadEnabled();
			if (chatTimeoutInput) chatTimeoutInput.value = String(this.getChatMessagesTimeoutSeconds());
			if (accountPointPollInput) accountPointPollInput.value = String(this.getAccountPointPollSeconds());
			if (tokenPoolCheckInput) tokenPoolCheckInput.value = String(this.getTokenPoolCheckSeconds());
			this.refreshTokenPoolSummary();
			this.updateToolPanel();
		}
	};

//#endregion
//#region src/ui/sidebar/sidebar-tools.js
	const sidebarToolMethods = { updateToolPanel() {
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
		const modelFamilyWrap = this.element.querySelector("#aifengyue-model-family-wrap");
		const toolsEmpty = this.element.querySelector("#aifengyue-tools-empty");
		const sortToggle = this.element.querySelector("#aifengyue-sort-toggle");
		if (extractWrap) {
			extractWrap.style.display = canExtract ? "" : "none";
		}
		if (sortWrap) {
			sortWrap.style.display = isDetail ? "" : "none";
		}
		if (modelFamilyWrap) {
			modelFamilyWrap.style.display = "";
		}
		if (toolsEmpty) {
			toolsEmpty.style.display = !canExtract && !isDetail && !modelFamilyWrap ? "" : "none";
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
	} };

//#endregion
//#region src/ui/sidebar.js
	const Sidebar = {
		element: null,
		conversationModal: null,
		conversationModalOpen: false,
		conversationModalEscHandler: null,
		tokenPoolLogModal: null,
		tokenPoolLogModalOpen: false,
		tokenPoolLogModalEscHandler: null,
		tokenPoolLogUnsubscribe: null,
		usageUnsubscribe: null,
		isOpen: false,
		layoutMode: "inline",
		activeTab: "register",
		theme: "light",
		accountPointPollApplyTimer: null,
		tokenPoolCheckApplyTimer: null,
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
				this.bindUsageSubscription();
				return;
			}
			this.activeTab = this.getDefaultTab();
			this.layoutMode = this.getLayoutMode();
			this.theme = this.getTheme();
			this.createSidebar();
			this.createConversationModal();
			this.createTokenPoolLogModal();
			this.createToggleButton();
			this.loadSavedData();
			this.bindUsageSubscription();
			this.applyLayoutModeClass();
			this.applyTheme();
			this.setActiveTab(this.activeTab);
			if (this.getDefaultOpen()) {
				this.open();
			} else {
				this.close();
			}
		},
		bindUsageSubscription() {
			if (typeof this.usageUnsubscribe === "function") {
				this.usageUnsubscribe();
				this.usageUnsubscribe = null;
			}
			this.usageUnsubscribe = MailService.subscribeUsageChange((snapshot) => {
				this.updateUsageDisplay(snapshot);
			});
		},
		...sidebarViewMethods,
		...sidebarEventsMethods,
		...sidebarConversationMethods,
		...sidebarSettingsMethods,
		...sidebarStateMethods,
		...sidebarToolMethods
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
//#region src/features/auto-register/shared.js
	const X_LANGUAGE$1 = "zh-Hans";
	const SITE_ENDPOINTS = {
		SEND_CODE: "/console/api/register/email",
		SLIDE_GET: "/go/api/slide/get",
		REGISTER: "/console/api/register",
		ACCOUNT_GENDER: "/console/api/account/gender",
		FAVORITE_TAGS: "/console/api/account_extend/favorite_tags",
		ACCOUNT_EXTEND_SET: "/console/api/account/extend_set",
		ACCOUNT_PROFILE: "/go/api/account/profile",
		ACCOUNT_POINT: "/go/api/account/point",
		APP_DETAILS: "/go/api/apps",
		APPS: "/console/api/apps",
		INSTALLED_MESSAGES: "/console/api/installed-apps",
		CHAT_MESSAGES: "/console/api/installed-apps"
	};
	const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1 = 3;
	const DEFAULT_SWITCH_WORLD_BOOK_TRIGGER = "-=";
	function readErrorMessage(payload, fallback) {
		if (!payload || typeof payload !== "object") return fallback;
		const raw = payload.error ?? payload.message ?? payload.msg ?? payload.detail ?? payload.errmsg;
		if (typeof raw !== "string") return fallback;
		const message = raw.trim();
		if (!message || /^(ok|success)$/i.test(message)) return fallback;
		return message;
	}
	function normalizeTimestamp(value) {
		return normalizeTimestamp$1(value);
	}
	function decodeEscapedText(raw) {
		return decodeEscapedText$1(raw);
	}
	function isAnswerEmpty(raw) {
		if (raw === null || raw === undefined) return true;
		if (typeof raw !== "string") return false;
		const source = raw.trim().toLowerCase();
		if (!source) return true;
		if (source === "null" || source === "undefined" || source === "\"\"" || source === "''") {
			return true;
		}
		const decoded = decodeEscapedText(raw).trim().toLowerCase();
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

//#endregion
//#region src/features/auto-register/runtime-methods.js
	const ACCOUNT_POINT_POLL_DEFAULT_SECONDS = 15;
	const ACCOUNT_POINT_POLL_MIN_SECONDS = 2;
	const ACCOUNT_POINT_POLL_MAX_SECONDS = 300;
	const RuntimeMethods = {
		resolveRetryAttempts(maxAttempts) {
			return resolveRetryAttempts(maxAttempts, DEFAULT_OBJECTIVE_RETRY_ATTEMPTS$1);
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
			return isRetryableNetworkError(error, { includeHttpStatus: true });
		},
		normalizeAccountPointPollSeconds(value) {
			const parsed = Number(value);
			if (!Number.isFinite(parsed)) return ACCOUNT_POINT_POLL_DEFAULT_SECONDS;
			const normalized = Math.floor(parsed);
			if (normalized < ACCOUNT_POINT_POLL_MIN_SECONDS) return ACCOUNT_POINT_POLL_MIN_SECONDS;
			return Math.min(normalized, ACCOUNT_POINT_POLL_MAX_SECONDS);
		},
		getAccountPointPollIntervalMs() {
			const saved = gmGetValue(CONFIG.STORAGE_KEYS.ACCOUNT_POINT_POLL_SECONDS, ACCOUNT_POINT_POLL_DEFAULT_SECONDS);
			const seconds = this.normalizeAccountPointPollSeconds(saved);
			return seconds * 1e3;
		},
		resolveAccountPointPollIntervalMs(intervalMs) {
			if (Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0) {
				return Math.max(ACCOUNT_POINT_POLL_MIN_SECONDS * 1e3, Number(intervalMs));
			}
			return this.getAccountPointPollIntervalMs();
		},
		isPointPollingPage() {
			const pathname = typeof window.location?.pathname === "string" ? window.location.pathname : "";
			return /\/zh\/explore\/(?:test-)?installed\/[0-9a-f-]+\/?$/i.test(pathname);
		},
		removeAccountPointIndicator() {
			const existing = document.getElementById("aifengyue-account-point-indicator");
			if (existing) {
				existing.remove();
			}
			this.accountPointIndicatorEl = null;
		},
		removeAccountPointLowBanner() {
			const existing = document.getElementById("aifengyue-account-point-low-banner");
			if (existing) {
				existing.remove();
			}
			this.accountPointLowBannerEl = null;
		},
		ensureAccountPointLowBanner() {
			if (!this.isPointPollingPage()) {
				this.removeAccountPointLowBanner();
				return null;
			}
			const anchor = document.getElementById("ai-mod-button2");
			const parent = anchor?.parentElement;
			if (!anchor || !parent) {
				this.accountPointLowBannerEl = null;
				return null;
			}
			let banner = document.getElementById("aifengyue-account-point-low-banner");
			if (!banner) {
				banner = document.createElement("div");
				banner.id = "aifengyue-account-point-low-banner";
				banner.style.cssText = [
					"display:flex",
					"align-items:center",
					"justify-content:center",
					"padding:8px 12px",
					"margin:6px 4px 8px",
					"border:1px solid #ef4444",
					"border-radius:8px",
					"background:#fef2f2",
					"color:#991b1b",
					"font-size:12px",
					"font-weight:700",
					"line-height:1.4",
					"text-align:center",
					"box-shadow:0 1px 0 rgba(239,68,68,0.12)"
				].join(";");
			}
			if (banner.parentElement !== parent || banner.previousElementSibling !== anchor) {
				parent.insertBefore(banner, anchor.nextSibling);
			}
			this.accountPointLowBannerEl = banner;
			return banner;
		},
		isAccountPointSubmitBlocked() {
			if (!this.isPointPollingPage()) return false;
			if (this.accountPointSubmitSwitchInFlight || this.switchingAccount) return true;
			const currentAppId = this.extractInstalledAppId();
			const pollingAppId = typeof this.accountPointPollAppId === "string" ? this.accountPointPollAppId.trim() : "";
			if (!currentAppId || !pollingAppId || currentAppId !== pollingAppId) return false;
			if (this.accountPointPollInFlight || !this.accountPointHasFreshReading) return false;
			const points = Number(this.accountPointLatestPoints);
			return Number.isFinite(points) && points <= 0;
		},
		refreshAccountPointLowBanner() {
			if (!this.isAccountPointSubmitBlocked()) {
				this.removeAccountPointLowBanner();
				return;
			}
			const banner = this.ensureAccountPointLowBanner();
			if (!banner) return;
			const points = Number(this.accountPointLatestPoints);
			const pointsText = Number.isFinite(points) ? `${points}` : "--";
			if (this.accountPointSubmitSwitchInFlight || this.switchingAccount) {
				banner.textContent = "积分不足：已拦截本次发送，正在执行完整换号流程，请稍候...";
				return;
			}
			banner.textContent = `积分不足（${pointsText}）：发送已被接管，按 Enter / 发送键将执行完整换号流程`;
		},
		ensureAccountPointSubmitInterceptors() {
			if (this.accountPointSubmitInterceptorsBound) {
				return;
			}
			this.accountPointSubmitKeydownHandler = (event) => {
				if (!event || event.defaultPrevented) return;
				if (event.key !== "Enter") return;
				if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				const inputEl = document.getElementById("ai-chat-input");
				if (!inputEl || target !== inputEl) return;
				this.tryInterceptAccountPointSubmit(event, "enter");
			};
			this.accountPointSubmitClickHandler = (event) => {
				if (!event || event.defaultPrevented) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				const sendBtn = target.closest("#ai-send-button");
				if (!sendBtn) return;
				this.tryInterceptAccountPointSubmit(event, "send-button");
			};
			document.addEventListener("keydown", this.accountPointSubmitKeydownHandler, true);
			document.addEventListener("click", this.accountPointSubmitClickHandler, true);
			this.accountPointSubmitInterceptorsBound = true;
		},
		removeAccountPointSubmitInterceptors() {
			if (!this.accountPointSubmitInterceptorsBound) return;
			if (this.accountPointSubmitKeydownHandler) {
				document.removeEventListener("keydown", this.accountPointSubmitKeydownHandler, true);
			}
			if (this.accountPointSubmitClickHandler) {
				document.removeEventListener("click", this.accountPointSubmitClickHandler, true);
			}
			this.accountPointSubmitKeydownHandler = null;
			this.accountPointSubmitClickHandler = null;
			this.accountPointSubmitInterceptorsBound = false;
		},
		stopEventForSubmitGuard(event) {
			if (!event) return;
			event.preventDefault();
			event.stopPropagation();
			if (typeof event.stopImmediatePropagation === "function") {
				event.stopImmediatePropagation();
			}
		},
		tryInterceptAccountPointSubmit(event, source = "unknown") {
			if (!this.isAccountPointSubmitBlocked()) return false;
			this.stopEventForSubmitGuard(event);
			this.triggerSwitchAccountFromSubmit(source).catch((error) => {
				const runCtx = createRunContext("POINT_SUBMIT");
				logError(runCtx, "POINT_SUBMIT", "发送拦截触发换号失败", {
					source,
					message: error?.message || String(error)
				});
				Toast.error(`拦截发送后换号失败: ${error?.message || String(error)}`, 5e3);
			});
			return true;
		},
		async triggerSwitchAccountFromSubmit(source = "unknown") {
			if (this.accountPointSubmitSwitchInFlight || this.switchingAccount) {
				Toast.info("更换账号流程执行中，请稍候");
				return false;
			}
			const inputEl = document.getElementById("ai-chat-input");
			const extraText = typeof inputEl?.value === "string" ? inputEl.value.trim() : "";
			if (!extraText) {
				Toast.warning("输入框为空，请先输入内容再发送");
				return false;
			}
			this.accountPointSubmitSwitchInFlight = true;
			this.refreshAccountPointLowBanner();
			const runCtx = createRunContext("POINT_SUBMIT");
			logInfo$1(runCtx, "POINT_SUBMIT", "积分不足，发送已拦截并改走完整换号流程", {
				source,
				points: Number.isFinite(Number(this.accountPointLatestPoints)) ? Number(this.accountPointLatestPoints) : null,
				extraTextLength: extraText.length
			});
			Sidebar.updateState({
				status: "fetching",
				statusMessage: "积分不足：已拦截发送，正在执行完整换号流程..."
			});
			Toast.warning("积分不足，已拦截发送并执行完整换号流程", 3200);
			try {
				await this.switchAccount(extraText);
				return true;
			} finally {
				this.accountPointSubmitSwitchInFlight = false;
				this.refreshAccountPointLowBanner();
			}
		},
		setAccountPointIndicatorInteractionState(indicator, { enabled = false, title = "" } = {}) {
			if (!indicator) return;
			indicator.dataset.switchEnabled = enabled ? "1" : "0";
			indicator.setAttribute("aria-disabled", enabled ? "false" : "true");
			indicator.style.cursor = enabled ? "pointer" : "default";
			indicator.style.borderColor = enabled ? "#fecaca" : "#dbe5f2";
			indicator.style.background = enabled ? "#fff1f2" : "#f8fbff";
			indicator.title = title;
		},
		async handleAccountPointIndicatorClick() {
			const indicator = this.ensureAccountPointIndicator();
			if (!indicator) return;
			const switchEnabled = indicator.dataset.switchEnabled === "1";
			const points = Number(indicator.dataset.points);
			if (!switchEnabled) {
				if (Number.isFinite(points) && points > 0) {
					Toast.info(`当前积分 ${points}，仅在积分 <= 0 时可主动换号`, 2600);
				} else {
					Toast.info("请等待积分读取完成后再尝试主动换号", 2600);
				}
				return;
			}
			if (this.switchingAccount) {
				Toast.warning("更换账号正在执行，请稍候");
				return;
			}
			const inputEl = document.getElementById("ai-chat-input");
			const extraText = typeof inputEl?.value === "string" ? inputEl.value.trim() : "";
			if (!extraText) {
				Toast.warning("输入框为空，请先输入附加文本后再点击积分");
				return;
			}
			const runCtx = createRunContext("POINT_CLICK");
			logInfo$1(runCtx, "POINT_CLICK", "积分按钮触发主动换号", {
				points: Number.isFinite(points) ? points : null,
				extraTextLength: extraText.length
			});
			await this.triggerSwitchAccountFromSubmit("point-indicator");
		},
		ensureAccountPointIndicator() {
			if (!this.isPointPollingPage()) {
				this.removeAccountPointIndicator();
				return null;
			}
			const anchor = document.getElementById("ai-mod-button2");
			if (!anchor) {
				this.accountPointIndicatorEl = null;
				return null;
			}
			let indicator = document.getElementById("aifengyue-account-point-indicator");
			if (!indicator) {
				indicator = document.createElement("div");
				indicator.id = "aifengyue-account-point-indicator";
				indicator.style.cssText = [
					"display:inline-flex",
					"align-items:center",
					"gap:6px",
					"height:32px",
					"padding:0 10px",
					"margin-left:4px",
					"border:1px solid #dbe5f2",
					"border-radius:6px",
					"background:#f8fbff",
					"font-size:12px",
					"line-height:1",
					"white-space:nowrap",
					"flex-shrink:0",
					"color:#334155"
				].join(";");
				indicator.innerHTML = "<span data-role=\"label\" style=\"font-weight:600;color:#475569;\">积分</span><span data-role=\"value\" style=\"font-weight:700;color:#0f766e;\">--</span>";
				indicator.setAttribute("role", "button");
				indicator.tabIndex = 0;
				const triggerManualSwitch = () => {
					this.handleAccountPointIndicatorClick().catch((error) => {
						const runCtx = createRunContext("POINT_CLICK");
						logError(runCtx, "POINT_CLICK", "积分按钮主动换号失败", { message: error?.message || String(error) });
					});
				};
				indicator.addEventListener("click", triggerManualSwitch);
				indicator.addEventListener("keydown", (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					triggerManualSwitch();
				});
			}
			const firstChild = anchor.firstElementChild;
			if (indicator.parentElement !== anchor) {
				anchor.insertBefore(indicator, firstChild || null);
			} else if (firstChild !== indicator) {
				anchor.insertBefore(indicator, firstChild || null);
			}
			this.accountPointIndicatorEl = indicator;
			return indicator;
		},
		updateAccountPointIndicator({ points = null, loading = false, exhausted = false, failed = false } = {}) {
			const indicator = this.ensureAccountPointIndicator();
			const valueEl = indicator?.querySelector?.("[data-role=\"value\"]") || null;
			if (loading) {
				this.accountPointLatestPoints = null;
				this.accountPointHasFreshReading = false;
				if (valueEl) {
					valueEl.textContent = "读取中...";
					valueEl.style.color = "#64748b";
				}
				if (indicator) {
					indicator.dataset.points = "";
					this.setAccountPointIndicatorInteractionState(indicator, {
						enabled: false,
						title: "正在轮询积分"
					});
				}
				this.refreshAccountPointLowBanner();
				return;
			}
			if (failed) {
				this.accountPointLatestPoints = null;
				this.accountPointHasFreshReading = false;
				if (valueEl) {
					valueEl.textContent = "--";
					valueEl.style.color = "#f59e0b";
				}
				if (indicator) {
					indicator.dataset.points = "";
					this.setAccountPointIndicatorInteractionState(indicator, {
						enabled: false,
						title: "积分读取失败，等待下次轮询"
					});
				}
				this.refreshAccountPointLowBanner();
				return;
			}
			if (Number.isFinite(Number(points))) {
				const normalized = Number(points);
				this.accountPointLatestPoints = normalized;
				this.accountPointHasFreshReading = true;
				if (valueEl) {
					valueEl.textContent = `${normalized}`;
				}
				if (indicator) {
					indicator.dataset.points = `${normalized}`;
				}
				if (exhausted) {
					if (valueEl) valueEl.style.color = "#dc2626";
					if (indicator) {
						this.setAccountPointIndicatorInteractionState(indicator, {
							enabled: true,
							title: "积分 <= 0，发送将触发完整换号流程（也可点击积分手动触发）"
						});
					}
				} else {
					if (valueEl) valueEl.style.color = "#0f766e";
					if (indicator) {
						this.setAccountPointIndicatorInteractionState(indicator, {
							enabled: false,
							title: "当前积分"
						});
					}
				}
				this.refreshAccountPointLowBanner();
				return;
			}
			this.accountPointLatestPoints = null;
			this.accountPointHasFreshReading = false;
			if (valueEl) {
				valueEl.textContent = "--";
				valueEl.style.color = "#64748b";
			}
			if (indicator) {
				indicator.dataset.points = "";
				this.setAccountPointIndicatorInteractionState(indicator, {
					enabled: false,
					title: "积分暂不可用"
				});
			}
			this.refreshAccountPointLowBanner();
		},
		stopAccountPointPolling({ runCtx, step = "POINT_MONITOR", reason = "" } = {}) {
			const hadTimer = !!this.accountPointPollTimer;
			if (this.accountPointPollTimer) {
				clearInterval(this.accountPointPollTimer);
				this.accountPointPollTimer = null;
			}
			this.accountPointPollAppId = "";
			this.accountPointPollInFlight = false;
			this.accountPointLatestPoints = null;
			this.accountPointHasFreshReading = false;
			this.accountPointPollIntervalMs = 0;
			this.accountPointSubmitSwitchInFlight = false;
			this.removeAccountPointIndicator();
			this.removeAccountPointLowBanner();
			this.removeAccountPointSubmitInterceptors();
			if (hadTimer) {
				logInfo$1(runCtx, step, "积分轮询已停止", { reason: reason || null });
			}
		},
		async checkAccountPointOnce({ appId = "", runCtx, step = "POINT_MONITOR", reason = "manual" } = {}) {
			const resolvedAppId = (typeof appId === "string" ? appId.trim() : "") || this.extractInstalledAppId();
			if (!resolvedAppId) {
				this.updateAccountPointIndicator({
					points: null,
					failed: true
				});
				return {
					appId: "",
					points: null,
					exhausted: false,
					skipped: true,
					reason: "missing-app-id"
				};
			}
			if (this.switchingAccount) {
				this.updateAccountPointIndicator({
					points: null,
					loading: true
				});
				logDebug(runCtx, step, "更换账号进行中，跳过本轮积分检查", {
					appId: resolvedAppId,
					reason
				});
				return {
					appId: resolvedAppId,
					points: null,
					exhausted: false,
					skipped: true,
					reason: "switching-account"
				};
			}
			if (this.accountPointPollInFlight) {
				return {
					appId: resolvedAppId,
					points: null,
					exhausted: false,
					skipped: true,
					reason: "in-flight"
				};
			}
			this.accountPointPollInFlight = true;
			const ctx = runCtx || createRunContext("POINT");
			const token = (localStorage.getItem("console_token") || "").trim();
			try {
				const pointResult = await this.fetchAccountPoint({
					appId: resolvedAppId,
					token,
					runCtx: ctx,
					step,
					maxAttempts: 1
				});
				const points = Number(pointResult.points);
				const exhausted = points <= 0;
				this.updateAccountPointIndicator({
					points,
					exhausted
				});
				logInfo$1(ctx, step, "积分检查完成", {
					appId: resolvedAppId,
					points,
					exhausted,
					reason
				});
				if (exhausted) {
					logWarn$1(ctx, step, "积分耗尽，等待发送触发完整换号流程（也可点击积分）", {
						appId: resolvedAppId,
						points
					});
				}
				return {
					appId: resolvedAppId,
					points,
					exhausted,
					skipped: false,
					reason: exhausted ? "manual-switch-required" : "ok"
				};
			} catch (error) {
				logWarn$1(ctx, step, "积分检查失败，本轮跳过", {
					appId: resolvedAppId,
					reason,
					message: error?.message || String(error)
				});
				this.updateAccountPointIndicator({
					points: null,
					failed: true
				});
				return {
					appId: resolvedAppId,
					points: null,
					exhausted: false,
					skipped: true,
					reason: "request-failed",
					error
				};
			} finally {
				this.accountPointPollInFlight = false;
			}
		},
		startAccountPointPolling({ intervalMs = 0, runCtx } = {}) {
			if (!this.isPointPollingPage()) {
				this.stopAccountPointPolling({
					runCtx,
					reason: "not-installed-explore-page"
				});
				return false;
			}
			const appId = this.extractInstalledAppId();
			if (!appId) {
				this.stopAccountPointPolling({
					runCtx,
					reason: "not-installed-page"
				});
				return false;
			}
			const pollMs = this.resolveAccountPointPollIntervalMs(intervalMs);
			if (this.accountPointPollTimer && this.accountPointPollAppId === appId && this.accountPointPollIntervalMs === pollMs) {
				if (!this.accountPointHasFreshReading && !this.accountPointPollInFlight) {
					this.checkAccountPointOnce({
						appId,
						runCtx,
						step: "POINT_MONITOR_RETRY",
						reason: "missing-fresh-reading"
					}).catch(() => {});
				}
				return true;
			}
			this.stopAccountPointPolling({
				runCtx,
				reason: this.accountPointPollAppId ? "app-changed" : "restart"
			});
			this.accountPointPollAppId = appId;
			this.accountPointPollIntervalMs = pollMs;
			this.ensureAccountPointSubmitInterceptors();
			this.ensureAccountPointIndicator();
			this.updateAccountPointIndicator({
				points: null,
				loading: true
			});
			this.accountPointPollTimer = setInterval(() => {
				const currentAppId = typeof this.accountPointPollAppId === "string" ? this.accountPointPollAppId.trim() : "";
				if (!currentAppId) {
					return;
				}
				this.checkAccountPointOnce({
					appId: currentAppId,
					step: "POINT_MONITOR_TICK",
					reason: "interval"
				}).catch(() => {});
			}, pollMs);
			logInfo$1(runCtx, "POINT_MONITOR", "积分轮询已启动", {
				appId,
				intervalMs: pollMs
			});
			this.checkAccountPointOnce({
				appId,
				runCtx,
				step: "POINT_MONITOR_INIT",
				reason: "start"
			}).catch(() => {});
			return true;
		},
		refreshAccountPointPolling({ intervalMs = 0, runCtx } = {}) {
			if (!this.isPointPollingPage()) {
				this.stopAccountPointPolling({
					runCtx,
					reason: "route-not-installed-explore-page"
				});
				return false;
			}
			const appId = this.extractInstalledAppId();
			if (!appId) {
				this.stopAccountPointPolling({
					runCtx,
					reason: "route-not-installed-page"
				});
				return false;
			}
			return this.startAccountPointPolling({
				intervalMs,
				runCtx
			});
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
		}
	};

//#endregion
//#region src/features/auto-register/form-methods.js
	const FormMethods = {
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
		fillForm(email, username, password) {
			const { usernameInput, emailInput, passwordInput } = this.getFormElements();
			if (usernameInput) this.simulateInput(usernameInput, username);
			if (emailInput) this.simulateInput(emailInput, email);
			if (passwordInput) this.simulateInput(passwordInput, password);
		}
	};

//#endregion
//#region src/features/auto-register/site-api-methods.js
	const SiteApiMethods = {
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
		async fetchAccountPoint({ appId = "", token = "", runCtx, step = "GET_ACCOUNT_POINT", maxAttempts = 1 }) {
			const normalizedAppId = typeof appId === "string" ? appId.trim() : "";
			const headers = token ? { Authorization: `Bearer ${token}` } : {};
			const path = SITE_ENDPOINTS.ACCOUNT_POINT;
			const payload = await this.requestSiteApi(path, {
				method: "GET",
				headers,
				maxAttempts,
				strictCode: true,
				acceptableCodes: [
					0,
					200,
					1e5
				]
			}, runCtx, step);
			const rawPoints = payload?.data?.points ?? payload?.points;
			const points = Number(rawPoints);
			if (!Number.isFinite(points)) {
				throw new Error(`account/point 返回积分无效: ${rawPoints ?? "null"}`);
			}
			logInfo$1(runCtx, step, "account/point 获取成功", {
				appId: normalizedAppId || null,
				points
			});
			return {
				appId: normalizedAppId,
				points,
				rawPoints,
				payload
			};
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
		}
	};

//#endregion
//#region src/features/auto-register/conversation-methods.js
	const ConversationMethods = {
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
				name: decodeEscapedText(typeof appInfo?.name === "string" ? appInfo.name : ""),
				description: decodeEscapedText(typeof appInfo?.description === "string" ? appInfo.description : ""),
				builtInCss: decodeEscapedText(typeof modelConfig?.built_in_css === "string" ? modelConfig.built_in_css : ""),
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
		}
	};

//#endregion
//#region src/features/auto-register/model-config-methods.js
	const ModelConfigMethods = {
		buildWorldBookValueWithUserSeparator(answerText) {
			const baseText = typeof answerText === "string" ? answerText.replace(/\s+$/g, "") : String(answerText ?? "").replace(/\s+$/g, "");
			const separator = "\n---continue with\nuser:\n";
			if (!baseText) return separator;
			if (baseText.endsWith(separator.trimEnd())) {
				return `${baseText.replace(/\s*$/g, "")}\n`;
			}
			return `${baseText}${separator}`;
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
			const normalizedAnswer = decodeEscapedText(typeof answer === "string" ? answer : String(answer ?? "")).trim();
			if (!normalizedAnswer) {
				throw new Error("旧会话 answer 为空，无法写入 world_book");
			}
			const worldBookValue = this.buildWorldBookValueWithUserSeparator(normalizedAnswer);
			const clonedConfig = cloneJsonSafe(baseConfig);
			if (!clonedConfig || typeof clonedConfig !== "object" || Array.isArray(clonedConfig)) {
				throw new Error("user_app_model_config 结构异常，无法写入 world_book");
			}
			const existingWorldBook = Array.isArray(clonedConfig.world_book) ? [...clonedConfig.world_book] : [];
			const triggerWord = normalizeSwitchTriggerWord(explicitTriggerWord) || this.resolveSwitchTriggerWordFromWorldBook(existingWorldBook) || DEFAULT_SWITCH_WORLD_BOOK_TRIGGER;
			const scriptEntryKey = `_or_${triggerWord}`;
			const matchedIndexes = [];
			existingWorldBook.forEach((entry, index) => {
				const key = typeof entry?.key === "string" ? entry.key.trim() : "";
				if (key === scriptEntryKey) {
					matchedIndexes.push(index);
				}
			});
			const matchedIndex = matchedIndexes.length ? matchedIndexes[0] : -1;
			const entryBase = matchedIndex >= 0 && existingWorldBook[matchedIndex] && typeof existingWorldBook[matchedIndex] === "object" ? { ...existingWorldBook[matchedIndex] } : {};
			const entryKey = scriptEntryKey;
			const worldBookEntry = {
				...entryBase,
				key: entryKey,
				value: worldBookValue,
				group: typeof entryBase.group === "string" ? entryBase.group : "",
				key_region: Number.isFinite(Number(entryBase.key_region)) ? Number(entryBase.key_region) : 2,
				value_region: Number.isFinite(Number(entryBase.value_region)) ? Number(entryBase.value_region) : 1
			};
			const nextWorldBook = existingWorldBook.filter((_, index) => !matchedIndexes.includes(index));
			if (matchedIndex >= 0) {
				const insertIndex = Math.min(matchedIndex, nextWorldBook.length);
				nextWorldBook.splice(insertIndex, 0, worldBookEntry);
			} else {
				nextWorldBook.unshift(worldBookEntry);
			}
			clonedConfig.world_book = nextWorldBook;
			const removedDuplicateCount = Math.max(0, matchedIndexes.length - 1);
			logInfo$1(runCtx, "SWITCH_WORLD_BOOK", matchedIndex >= 0 ? "已归并并替换脚本 world_book 触发词条目" : "已新增脚本 world_book 触发词条目", {
				triggerWord,
				worldBookCount: nextWorldBook.length,
				entryKey: worldBookEntry.key,
				answerLength: normalizedAnswer.length,
				valueLength: worldBookValue.length,
				removedDuplicateCount
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
				return `${normalizedTrigger}\n`;
			}
			let bodyText = normalizedAppendText;
			if (bodyText.startsWith(normalizedTrigger)) {
				bodyText = bodyText.slice(normalizedTrigger.length).trimStart();
			}
			if (!bodyText) {
				return `${normalizedTrigger}\n`;
			}
			return `${normalizedTrigger}\n${bodyText}`;
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
		}
	};

//#endregion
//#region src/features/auto-register/chat-messages-methods.js
	const ChatMessagesMethods = {
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
		}
	};

//#endregion
//#region src/features/auto-register/token-pool-methods.js
	const TOKEN_POOL_TARGET_FULL_COUNT = 2;
	const TOKEN_POOL_MAX_COUNT = 5;
	const TOKEN_POOL_FULL_POINTS = 5e3;
	const TOKEN_POOL_CHECK_DEFAULT_SECONDS = 300;
	const TOKEN_POOL_CHECK_MAX_SECONDS = 3600;
	const TOKEN_POOL_BACKOFF_MINUTES = [
		1,
		2,
		5,
		10,
		30
	];
	function toFiniteNumber(value, fallback = 0) {
		const numberValue = Number(value);
		if (!Number.isFinite(numberValue)) return fallback;
		return numberValue;
	}
	function normalizeTimestampMs(value, fallback = 0) {
		const numberValue = Math.floor(toFiniteNumber(value, fallback));
		return numberValue > 0 ? numberValue : fallback;
	}
	const TokenPoolMethods = {
		normalizeTokenPoolCheckSeconds(value) {
			const parsed = Number(value);
			if (!Number.isFinite(parsed)) return TOKEN_POOL_CHECK_DEFAULT_SECONDS;
			const normalized = Math.floor(parsed);
			if (normalized <= 0) return 0;
			return Math.min(normalized, TOKEN_POOL_CHECK_MAX_SECONDS);
		},
		getTokenPoolCheckSeconds() {
			const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS);
			const fallback = TOKEN_POOL_CHECK_DEFAULT_SECONDS;
			return this.normalizeTokenPoolCheckSeconds(raw === null ? fallback : raw);
		},
		setTokenPoolCheckSeconds(value) {
			const normalized = this.normalizeTokenPoolCheckSeconds(value);
			localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_CHECK_SECONDS, String(normalized));
			return normalized;
		},
		readTokenPoolBackoffState() {
			return {
				lastCheckAt: normalizeTimestampMs(localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_CHECK_AT), 0),
				nextAllowedAt: normalizeTimestampMs(localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_NEXT_ALLOWED_AT), 0),
				backoffLevel: Math.max(0, Math.floor(toFiniteNumber(localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_BACKOFF_LEVEL), 0))),
				lastError: (localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_ERROR) || "").trim()
			};
		},
		writeTokenPoolBackoffState({ lastCheckAt = null, nextAllowedAt = null, backoffLevel = null, lastError = null } = {}) {
			if (lastCheckAt !== null) {
				localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_CHECK_AT, String(normalizeTimestampMs(lastCheckAt, 0)));
			}
			if (nextAllowedAt !== null) {
				localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_NEXT_ALLOWED_AT, String(normalizeTimestampMs(nextAllowedAt, 0)));
			}
			if (backoffLevel !== null) {
				const normalized = Math.max(0, Math.floor(toFiniteNumber(backoffLevel, 0)));
				localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_BACKOFF_LEVEL, String(normalized));
			}
			if (lastError !== null) {
				const text = typeof lastError === "string" ? lastError.trim() : String(lastError ?? "").trim();
				localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_LAST_ERROR, text);
			}
		},
		clearTokenPoolBackoffState() {
			this.writeTokenPoolBackoffState({
				nextAllowedAt: 0,
				backoffLevel: 0,
				lastError: ""
			});
		},
		applyTokenPoolBackoff(error, runCtx) {
			const previous = this.readTokenPoolBackoffState();
			const nextLevel = Math.min(TOKEN_POOL_BACKOFF_MINUTES.length, Math.max(1, previous.backoffLevel + 1));
			const waitMinutes = TOKEN_POOL_BACKOFF_MINUTES[nextLevel - 1] || TOKEN_POOL_BACKOFF_MINUTES[TOKEN_POOL_BACKOFF_MINUTES.length - 1];
			const waitMs = waitMinutes * 60 * 1e3;
			const now = Date.now();
			const nextAllowedAt = now + waitMs;
			const errorMessage = error?.message || String(error);
			this.writeTokenPoolBackoffState({
				lastCheckAt: now,
				nextAllowedAt,
				backoffLevel: nextLevel,
				lastError: errorMessage
			});
			logWarn$1(runCtx, "TOKEN_POOL_BACKOFF", "号池维护失败，进入退避等待", {
				nextLevel,
				waitMinutes,
				nextAllowedAt,
				errorMessage
			});
		},
		normalizeTokenPoolEntry(entry = {}, fallbackNow = Date.now()) {
			const token = typeof entry?.token === "string" ? entry.token.trim() : "";
			if (!token) return null;
			const points = toFiniteNumber(entry?.points, -1);
			const isFull = points >= TOKEN_POOL_FULL_POINTS;
			const createdAt = normalizeTimestampMs(entry?.createdAt, fallbackNow);
			const lastCheckedAt = normalizeTimestampMs(entry?.lastCheckedAt, createdAt);
			const lastUsedAt = normalizeTimestampMs(entry?.lastUsedAt, 0);
			const source = "auto-register";
			const status = isFull ? "full" : "partial";
			return {
				token,
				points,
				isFull,
				createdAt,
				lastCheckedAt,
				lastUsedAt,
				source,
				status
			};
		},
		normalizeTokenPoolEntries(entries, { excludeCurrentToken = true, onlyFull = true } = {}) {
			const now = Date.now();
			const list = Array.isArray(entries) ? entries : [];
			const currentToken = excludeCurrentToken ? (localStorage.getItem("console_token") || "").trim() : "";
			const dedupMap = new Map();
			for (const item of list) {
				const normalized = this.normalizeTokenPoolEntry(item, now);
				if (!normalized) continue;
				if (excludeCurrentToken && currentToken && normalized.token === currentToken) continue;
				if (onlyFull && !normalized.isFull) continue;
				const existing = dedupMap.get(normalized.token);
				if (!existing || normalized.lastCheckedAt > existing.lastCheckedAt) {
					dedupMap.set(normalized.token, normalized);
				}
			}
			return Array.from(dedupMap.values()).sort((a, b) => b.lastCheckedAt - a.lastCheckedAt || b.createdAt - a.createdAt).slice(0, TOKEN_POOL_MAX_COUNT);
		},
		readTokenPool() {
			const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_ENTRIES);
			let parsed = [];
			if (raw) {
				try {
					parsed = JSON.parse(raw);
				} catch {
					parsed = [];
				}
			}
			const normalized = this.normalizeTokenPoolEntries(parsed, {
				excludeCurrentToken: true,
				onlyFull: true
			});
			const normalizedRaw = JSON.stringify(normalized);
			if (raw !== normalizedRaw) {
				localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_ENTRIES, normalizedRaw);
			}
			return normalized;
		},
		writeTokenPool(entries = []) {
			const normalized = this.normalizeTokenPoolEntries(entries, {
				excludeCurrentToken: true,
				onlyFull: true
			});
			localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_POOL_ENTRIES, JSON.stringify(normalized));
			return normalized;
		},
		buildTokenPoolSummary({ entries = null, reason = "", status = "idle" } = {}) {
			const resolvedEntries = Array.isArray(entries) ? entries : this.readTokenPool();
			const fullCount = resolvedEntries.length;
			const backoff = this.readTokenPoolBackoffState();
			const intervalSeconds = this.getTokenPoolCheckSeconds();
			return {
				reason: reason || "",
				status,
				fullCount,
				totalCount: resolvedEntries.length,
				targetFullCount: TOKEN_POOL_TARGET_FULL_COUNT,
				maxCount: TOKEN_POOL_MAX_COUNT,
				fullPointThreshold: TOKEN_POOL_FULL_POINTS,
				intervalSeconds,
				schedulerEnabled: intervalSeconds > 0,
				schedulerRunning: !!this.tokenPoolTimer,
				maintaining: !!this.tokenPoolMaintaining,
				lastCheckAt: backoff.lastCheckAt,
				nextAllowedAt: backoff.nextAllowedAt,
				backoffLevel: backoff.backoffLevel,
				lastError: backoff.lastError,
				updatedAt: Date.now()
			};
		},
		updateTokenPoolSummary(summary, runCtx) {
			const resolved = summary && typeof summary === "object" ? summary : this.buildTokenPoolSummary();
			this.tokenPoolLastSummary = resolved;
			Sidebar.refreshTokenPoolSummary?.(resolved);
			logDebug(runCtx, "TOKEN_POOL_SUMMARY", "号池摘要已更新", resolved);
			return resolved;
		},
		getTokenPoolSummary() {
			if (this.tokenPoolLastSummary && typeof this.tokenPoolLastSummary === "object") {
				return this.tokenPoolLastSummary;
			}
			return this.updateTokenPoolSummary(this.buildTokenPoolSummary({ reason: "initial" }));
		},
		async validateTokenPoolToken({ token, runCtx, step = "TOKEN_POOL_VALIDATE" }) {
			const normalizedToken = typeof token === "string" ? token.trim() : "";
			if (!normalizedToken) {
				return {
					ok: false,
					points: null,
					isFull: false,
					message: "token 为空"
				};
			}
			try {
				const pointResult = await this.fetchAccountPoint({
					token: normalizedToken,
					runCtx,
					step,
					maxAttempts: 1
				});
				const points = toFiniteNumber(pointResult?.points, NaN);
				if (!Number.isFinite(points)) {
					return {
						ok: false,
						points: null,
						isFull: false,
						message: "积分返回非法"
					};
				}
				const isFull = points >= TOKEN_POOL_FULL_POINTS;
				return {
					ok: isFull,
					points,
					isFull,
					message: isFull ? "ok" : `积分不足(${points})`
				};
			} catch (error) {
				return {
					ok: false,
					points: null,
					isFull: false,
					message: error?.message || String(error)
				};
			}
		},
		async acquireBestTokenFromPool({ runCtx } = {}) {
			const ctx = runCtx || createRunContext("POOL_ACQUIRE");
			let entries = this.readTokenPool();
			if (!entries.length) {
				this.updateTokenPoolSummary(this.buildTokenPoolSummary({
					entries,
					reason: "acquire-empty",
					status: "empty"
				}), ctx);
				return {
					token: "",
					points: null,
					source: "pool-empty"
				};
			}
			for (let index = 0; index < entries.length; index++) {
				const entry = entries[index];
				const checkResult = await this.validateTokenPoolToken({
					token: entry.token,
					runCtx: ctx,
					step: `TOKEN_POOL_ACQUIRE_VALIDATE_${index + 1}`
				});
				if (!checkResult.ok) {
					logWarn$1(ctx, "TOKEN_POOL_ACQUIRE", "池中 token 校验未通过，已剔除", {
						points: checkResult.points,
						message: checkResult.message
					});
					entries = entries.filter((item) => item.token !== entry.token);
					this.writeTokenPool(entries);
					continue;
				}
				const selectedToken = entry.token;
				entries = entries.filter((item) => item.token !== selectedToken);
				this.writeTokenPool(entries);
				this.updateTokenPoolSummary(this.buildTokenPoolSummary({
					entries,
					reason: "acquire-hit",
					status: "ready"
				}), ctx);
				logInfo$1(ctx, "TOKEN_POOL_ACQUIRE", "号池命中可用 token，已消费", {
					points: checkResult.points,
					remainingCount: entries.length
				});
				return {
					token: selectedToken,
					points: checkResult.points,
					source: "pool"
				};
			}
			this.updateTokenPoolSummary(this.buildTokenPoolSummary({
				entries,
				reason: "acquire-depleted",
				status: "empty"
			}), ctx);
			return {
				token: "",
				points: null,
				source: "pool-depleted"
			};
		},
		async maintainTokenPool({ reason = "manual", force = false, runCtx } = {}) {
			if (this.tokenPoolMaintaining) {
				return this.getTokenPoolSummary();
			}
			const ctx = runCtx || createRunContext("POOL");
			this.tokenPoolMaintaining = true;
			try {
				logInfo$1(ctx, "TOKEN_POOL", "号池维护开始", {
					reason,
					force: !!force
				});
				this.updateTokenPoolSummary(this.buildTokenPoolSummary({
					reason: reason || "maintain",
					status: "maintaining"
				}), ctx);
				const backoff = this.readTokenPoolBackoffState();
				const now = Date.now();
				if (!force && backoff.nextAllowedAt > now) {
					const summary = this.buildTokenPoolSummary({
						reason: reason || "backoff-skip",
						status: "backoff"
					});
					this.updateTokenPoolSummary(summary, ctx);
					return summary;
				}
				let entries = this.readTokenPool();
				const checkedEntries = [];
				for (let index = 0; index < entries.length; index++) {
					const item = entries[index];
					const checkResult = await this.validateTokenPoolToken({
						token: item.token,
						runCtx: ctx,
						step: `TOKEN_POOL_CHECK_EXISTING_${index + 1}`
					});
					if (!checkResult.ok) {
						logWarn$1(ctx, "TOKEN_POOL", "号池现有 token 校验失败，已剔除", { message: checkResult.message });
						continue;
					}
					checkedEntries.push({
						...item,
						points: checkResult.points,
						isFull: true,
						status: "full",
						lastCheckedAt: Date.now()
					});
				}
				entries = this.writeTokenPool(checkedEntries);
				const maxRegisterAttempts = Math.max(2, TOKEN_POOL_TARGET_FULL_COUNT * 3);
				let registerAttempts = 0;
				while (entries.length < TOKEN_POOL_TARGET_FULL_COUNT && entries.length < TOKEN_POOL_MAX_COUNT && registerAttempts < maxRegisterAttempts) {
					registerAttempts += 1;
					this.tokenPoolInFlightRegister = true;
					let registerResult = null;
					try {
						registerResult = await this.registerByApi(ctx, {
							flowName: "号池补充",
							showStepToasts: false,
							markSuccess: false,
							persistConsoleToken: false,
							silent: true,
							requireGuideSkipped: true
						});
					} finally {
						this.tokenPoolInFlightRegister = false;
					}
					const token = typeof registerResult?.token === "string" ? registerResult.token.trim() : "";
					if (!token) {
						throw new Error("补池注册未返回 token");
					}
					const checkResult = await this.validateTokenPoolToken({
						token,
						runCtx: ctx,
						step: `TOKEN_POOL_CHECK_NEW_${registerAttempts}`
					});
					if (!checkResult.ok) {
						logWarn$1(ctx, "TOKEN_POOL", "新注册账号积分不足，跳过入池", { message: checkResult.message });
						continue;
					}
					entries.push({
						token,
						points: checkResult.points,
						isFull: true,
						createdAt: Date.now(),
						lastCheckedAt: Date.now(),
						lastUsedAt: 0,
						source: "auto-register",
						status: "full"
					});
					entries = this.writeTokenPool(entries);
				}
				this.writeTokenPoolBackoffState({ lastCheckAt: Date.now() });
				if (entries.length < TOKEN_POOL_TARGET_FULL_COUNT) {
					throw new Error(`号池补充后仍不足 ${TOKEN_POOL_TARGET_FULL_COUNT} 个满积分 token`);
				}
				this.clearTokenPoolBackoffState();
				const summary = this.buildTokenPoolSummary({
					entries,
					reason: reason || "maintain",
					status: "ok"
				});
				this.updateTokenPoolSummary(summary, ctx);
				logInfo$1(ctx, "TOKEN_POOL", "号池维护完成", {
					reason,
					fullCount: entries.length,
					target: TOKEN_POOL_TARGET_FULL_COUNT
				});
				return summary;
			} catch (error) {
				this.applyTokenPoolBackoff(error, ctx);
				const failedSummary = this.buildTokenPoolSummary({
					reason: reason || "maintain",
					status: "failed"
				});
				this.updateTokenPoolSummary(failedSummary, ctx);
				return failedSummary;
			} finally {
				this.tokenPoolMaintaining = false;
				this.tokenPoolInFlightRegister = false;
			}
		},
		startTokenPoolScheduler({ intervalSeconds = null, runCtx } = {}) {
			return this.refreshTokenPoolScheduler({
				intervalSeconds,
				runCtx,
				reason: "start"
			});
		},
		stopTokenPoolScheduler({ runCtx, reason = "stop" } = {}) {
			if (this.tokenPoolTimer) {
				clearInterval(this.tokenPoolTimer);
				this.tokenPoolTimer = null;
			}
			const summary = this.buildTokenPoolSummary({
				reason,
				status: "stopped"
			});
			this.updateTokenPoolSummary(summary, runCtx);
			logInfo$1(runCtx, "TOKEN_POOL_TIMER", "号池定时维护已停止", { reason });
			return summary;
		},
		refreshTokenPoolScheduler({ intervalSeconds = null, runCtx, reason = "refresh" } = {}) {
			const resolvedSeconds = intervalSeconds === null || intervalSeconds === undefined ? this.getTokenPoolCheckSeconds() : this.normalizeTokenPoolCheckSeconds(intervalSeconds);
			if (this.tokenPoolTimer) {
				clearInterval(this.tokenPoolTimer);
				this.tokenPoolTimer = null;
			}
			if (resolvedSeconds <= 0) {
				return this.stopTokenPoolScheduler({
					runCtx,
					reason: "disabled"
				});
			}
			const intervalMs = resolvedSeconds * 1e3;
			this.tokenPoolTimer = setInterval(() => {
				this.maintainTokenPool({
					reason: "timer",
					force: false
				}).catch(() => {});
			}, intervalMs);
			const summary = this.buildTokenPoolSummary({
				reason,
				status: "running"
			});
			this.updateTokenPoolSummary(summary, runCtx);
			logInfo$1(runCtx, "TOKEN_POOL_TIMER", "号池定时维护已启动", {
				intervalSeconds: resolvedSeconds,
				intervalMs
			});
			this.maintainTokenPool({
				reason: "timer-initial",
				force: false,
				runCtx
			}).catch(() => {});
			return summary;
		}
	};

//#endregion
//#region src/features/auto-register/flow-methods.js
	const FlowMethods = {
		async pollVerificationCode(email, startTime, maxAttempts = 10, intervalMs = 2e3, runCtx, options = {}) {
			const silent = options?.silent === true;
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				if (!silent) {
					Sidebar.updateState({
						status: "fetching",
						statusMessage: `正在轮询验证码邮件... (${attempt}/${maxAttempts})`
					});
				}
				logInfo$1(runCtx, "POLL_CODE", `轮询验证码第 ${attempt}/${maxAttempts} 次`);
				const emails = await MailService.getEmails(email);
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
				const email = await MailService.generateEmail();
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
			const persistConsoleToken = options.persistConsoleToken !== false;
			const silent = options.silent === true;
			const requireGuideSkipped = options.requireGuideSkipped !== false;
			const showToasts = showStepToasts && !silent;
			const updateSidebarState = (payload) => {
				if (!silent) {
					Sidebar.updateState(payload);
				}
			};
			let currentStep = "初始化";
			currentStep = "生成临时邮箱";
			updateSidebarState({
				status: "generating",
				statusMessage: `${flowName}：正在生成临时邮箱...`
			});
			if (showToasts) {
				Toast.info(`${flowName}：正在生成临时邮箱`, 2200);
			}
			this.registrationStartTime = Math.floor(Date.now() / 1e3);
			gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);
			const email = await MailService.generateEmail();
			const username = generateUsername();
			const password = generatePassword();
			logInfo$1(runCtx, "GENERATE", `${flowName} 生成注册信息完成`, {
				email,
				username,
				password
			});
			updateSidebarState({
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
			updateSidebarState({
				status: "fetching",
				statusMessage: `${flowName}：正在发送验证码...`,
				verificationCode: ""
			});
			await this.sendRegisterEmailCode(email, runCtx);
			if (showToasts) {
				Toast.info(`${flowName}：验证码已发送，正在轮询邮箱`, 2200);
			}
			currentStep = "轮询邮箱验证码";
			updateSidebarState({
				status: "fetching",
				statusMessage: `${flowName}：验证码已发送，正在自动轮询邮箱...`
			});
			const code = await this.pollVerificationCode(email, this.registrationStartTime, 10, 2e3, runCtx, { silent });
			if (!code) {
				throw new Error("未在轮询窗口内获取到验证码");
			}
			if (showToasts) {
				Toast.success(`${flowName}：已获取验证码`, 1800);
			}
			updateSidebarState({
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
			updateSidebarState({
				status: "fetching",
				statusMessage: `${flowName}：正在获取注册令牌...`
			});
			const regToken = await this.getRegToken(runCtx);
			currentStep = "提交注册";
			updateSidebarState({
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
			if (persistConsoleToken) {
				localStorage.setItem("console_token", token);
				logInfo$1(runCtx, "AUTH", `${flowName} 已写入 localStorage.console_token`);
				logDebug(runCtx, "AUTH", `${flowName} localStorage 写入 token 完整值`, { token });
				if (showToasts) {
					Toast.success(`${flowName}：注册成功，已写入 console_token`, 2400);
				}
			} else {
				logInfo$1(runCtx, "AUTH", `${flowName} 已获取 token（补池模式，不写入 console_token）`);
				logDebug(runCtx, "AUTH", `${flowName} token 完整值（补池模式）`, { token });
			}
			currentStep = "跳过首次引导";
			updateSidebarState({
				status: "fetching",
				statusMessage: `${flowName}：注册成功，正在跳过首次引导...`
			});
			if (showToasts) {
				Toast.info(`${flowName}：正在跳过首次引导（快速模式）`, 2600);
			}
			let guideSkipped = true;
			try {
				await this.skipFirstGuide(token, runCtx);
				if (showToasts) {
					Toast.success(`${flowName}：首次引导已跳过`, 1800);
				}
			} catch (guideError) {
				guideSkipped = false;
				logError(runCtx, "SKIP_GUIDE", `${flowName} 首次引导跳过失败`, {
					errorName: guideError?.name,
					message: guideError?.message,
					stack: guideError?.stack
				});
				if (!silent) {
					Toast.warning(`${flowName}：注册成功，但跳过首次引导失败: ${guideError.message}`, 6e3);
				}
			}
			if (requireGuideSkipped && !guideSkipped) {
				throw new Error(`${flowName}终止：首次引导未跳过成功`);
			}
			if (markSuccess && !silent) {
				Sidebar.updateState({
					status: "success",
					statusMessage: guideSkipped ? `${flowName}成功，已写入 console_token 并跳过首次引导` : `${flowName}成功，已写入 console_token（首次引导跳过失败）`
				});
				Toast.success(guideSkipped ? `${flowName}完成：已自动跳过首次引导并写入登录态` : `${flowName}完成：已写入登录态；首次引导跳过失败`, 5e3);
			} else if (!silent) {
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
					markSuccess: false,
					requireGuideSkipped: false
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
				const decodedAnswer = decodeEscapedText(latest.answer);
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
				let nextToken = "";
				let tokenSource = "pool";
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：已提取旧回答，正在从号池选择账号..."
				});
				Toast.info("更换账号：优先从号池选择新账号", 2200);
				const poolTokenResult = await this.acquireBestTokenFromPool({ runCtx });
				nextToken = typeof poolTokenResult?.token === "string" ? poolTokenResult.token.trim() : "";
				if (nextToken) {
					tokenSource = poolTokenResult?.source || "pool";
					logInfo$1(runCtx, "SWITCH_POOL", "已从号池获取可用 token", {
						tokenSource,
						points: Number(poolTokenResult?.points || 0) || null
					});
					Toast.success("更换账号：已从号池获取账号 token", 1800);
				} else {
					tokenSource = poolTokenResult?.source || "register-fallback";
					Sidebar.updateState({
						status: "fetching",
						statusMessage: "更换账号：号池暂无可用 token，回退注册新账号..."
					});
					Toast.warning("号池暂无可用 token，回退注册新账号", 2600);
					const registerResult = await this.registerByApi(runCtx, {
						flowName: "更换账号（回退注册）",
						showStepToasts: true,
						markSuccess: false,
						persistConsoleToken: false,
						requireGuideSkipped: true
					});
					nextToken = typeof registerResult?.token === "string" ? registerResult.token.trim() : "";
					tokenSource = "register-fallback";
				}
				if (!nextToken) {
					throw new Error("更换账号终止：未获取到可用新账号 token");
				}
				localStorage.setItem("console_token", nextToken);
				logInfo$1(runCtx, "SWITCH_POOL", "更换账号已写入新 console_token", { tokenSource });
				await this.syncAppMetaToLocalHistory({
					appId,
					token: nextToken,
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
					token: nextToken,
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
				logInfo$1(runCtx, "SWITCH_CHAT", "chat-messages query 已按触发词+换行格式构建", {
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
					token: nextToken,
					query,
					conversationName,
					runCtx
				});
				const newTokenSignature = buildTokenSignature(nextToken);
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
				this.maintainTokenPool({
					reason: "post-switch",
					force: false
				}).catch((poolError) => {
					logWarn$1(runCtx, "SWITCH_POOL", "切号后号池补充失败（不影响主流程）", { message: poolError?.message || String(poolError) });
				});
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
				const email = await MailService.generateEmail();
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
//#region src/features/auto-register.js
	const AutoRegister = {
		registrationStartTime: null,
		switchingAccount: false,
		accountPointPollTimer: null,
		accountPointPollAppId: "",
		accountPointPollIntervalMs: 0,
		accountPointPollInFlight: false,
		accountPointLatestPoints: null,
		accountPointHasFreshReading: false,
		accountPointIndicatorEl: null,
		accountPointLowBannerEl: null,
		accountPointSubmitInterceptorsBound: false,
		accountPointSubmitKeydownHandler: null,
		accountPointSubmitClickHandler: null,
		accountPointSubmitSwitchInFlight: false,
		tokenPoolTimer: null,
		tokenPoolMaintaining: false,
		tokenPoolLastSummary: null,
		tokenPoolInFlightRegister: false,
		...RuntimeMethods,
		...FormMethods,
		...SiteApiMethods,
		...ConversationMethods,
		...ModelConfigMethods,
		...ChatMessagesMethods,
		...TokenPoolMethods,
		...FlowMethods
	};

//#endregion
//#region src/features/iframe-extractor.js
	const X_LANGUAGE = "zh-Hans";
	const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS = 3;
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
			return resolveRetryAttempts(maxAttempts, DEFAULT_OBJECTIVE_RETRY_ATTEMPTS);
		},
		isObjectiveRetryError(error) {
			return isRetryableNetworkError(error, { includeHttpStatus: true });
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
				name: decodeEscapedText$1(typeof appInfo?.name === "string" ? appInfo.name : "") || fallbackTitle,
				description: decodeEscapedText$1(typeof appInfo?.description === "string" ? appInfo.description : ""),
				builtInCss: decodeEscapedText$1(typeof modelConfig?.built_in_css === "string" ? modelConfig.built_in_css : "")
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
	const FAMILY_QUALIFIERS = new Set([
		"low",
		"high",
		"preview",
		"thinking",
		"nothinking",
		"non",
		"reasoning",
		"nonreasoning",
		"latest",
		"exp"
	]);
	const DEFAULT_MODEL_FAMILY_RULES_TEXT = [
		"gemini-3.1-pro|Gemini 3.1 Pro|高智",
		"gemini-3-pro|Gemini 3 Pro|高智",
		"gemini-2.5-pro|Gemini 2.5 Pro|高智",
		"gemini-3-flash|Gemini 3 Flash|速度",
		"gemini-2.5-flash|Gemini 2.5 Flash|速度"
	].join("\n");
	function normalizeRulePrefix(prefix) {
		return String(prefix || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	}
	function normalizeFamilyKey(raw) {
		return normalizeRulePrefix(raw).replace(/\./g, "-");
	}
	function normalizeFamilyLabel(raw) {
		return String(raw || "").trim().replace(/\s+/g, " ");
	}
	function parseRuleLine(line) {
		const raw = String(line || "").trim();
		if (!raw || raw.startsWith("#")) return null;
		let prefix = "";
		let label = "";
		let position = "";
		if (raw.includes("=>")) {
			const [left, right] = raw.split("=>", 2).map((part) => part.trim());
			prefix = left || "";
			const rightParts = (right || "").split("|").map((part) => part.trim());
			label = rightParts[0] || "";
			position = rightParts[1] || "";
		} else {
			const parts = raw.split("|").map((part) => part.trim());
			prefix = parts[0] || "";
			label = parts[1] || "";
			position = parts[2] || "";
		}
		const normalizedPrefix = normalizeRulePrefix(prefix);
		if (!normalizedPrefix) return null;
		return {
			prefix: normalizedPrefix,
			key: normalizeFamilyKey(normalizedPrefix),
			label: normalizeFamilyLabel(label || normalizedPrefix),
			position: normalizeFamilyLabel(position),
			source: "custom"
		};
	}
	const ModelPopupSorter = {
		sortScheduled: false,
		popupObserver: null,
		observedPopup: null,
		activeModelFamilyKey: "",
		familyTagRenderSignature: "",
		unknownPrefixStats: new Map(),
		normalizeSortMetric(metric) {
			const value = String(metric || "").trim();
			return value === "price" ? "price" : "outputRate";
		},
		normalizeSortDirection(direction) {
			const value = String(direction || "").trim();
			return value === "asc" ? "asc" : "desc";
		},
		getSortMetric() {
			return this.normalizeSortMetric(gmGetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_METRIC, "price"));
		},
		setSortMetric(metric) {
			this.setSortState(metric, this.getSortDirection());
		},
		getSortDirection() {
			return this.normalizeSortDirection(gmGetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_DIRECTION, "asc"));
		},
		setSortDirection(direction) {
			this.setSortState(this.getSortMetric(), direction);
		},
		setSortState(metric, direction) {
			const normalizedMetric = this.normalizeSortMetric(metric);
			const normalized = this.normalizeSortDirection(direction);
			gmSetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_METRIC, normalizedMetric);
			gmSetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_DIRECTION, normalized);
			this.familyTagRenderSignature = "";
			this.scheduleSort();
		},
		getSortState() {
			return {
				metric: this.getSortMetric(),
				direction: this.getSortDirection()
			};
		},
		isSortEnabled() {
			return gmGetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, true);
		},
		setSortEnabled(enabled) {
			gmSetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, !!enabled);
		},
		isEnabled() {
			return this.isSortEnabled();
		},
		getDefaultModelFamilyRulesText() {
			return DEFAULT_MODEL_FAMILY_RULES_TEXT;
		},
		getModelFamilyRulesText() {
			return String(gmGetValue(CONFIG.STORAGE_KEYS.MODEL_FAMILY_CUSTOM_RULES, this.getDefaultModelFamilyRulesText()) || "");
		},
		setModelFamilyRulesText(text) {
			const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
			gmSetValue(CONFIG.STORAGE_KEYS.MODEL_FAMILY_CUSTOM_RULES, normalized);
			this.activeModelFamilyKey = "";
			this.familyTagRenderSignature = "";
			this.scheduleSort();
		},
		resetModelFamilyRulesText() {
			this.setModelFamilyRulesText(this.getDefaultModelFamilyRulesText());
		},
		getCustomModelFamilyRulesText() {
			return this.getModelFamilyRulesText();
		},
		setCustomModelFamilyRulesText(text) {
			this.setModelFamilyRulesText(text);
		},
		resetPopupState() {
			if (this.popupObserver) {
				this.popupObserver.disconnect();
				this.popupObserver = null;
			}
			this.observedPopup = null;
			const existingTagBar = document.getElementById("aifengyue-model-family-tags");
			if (existingTagBar) existingTagBar.remove();
			this.activeModelFamilyKey = "";
			this.familyTagRenderSignature = "";
		},
		scheduleSort() {
			if (!this.isEnabled()) {
				this.resetPopupState();
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
			this.familyTagRenderSignature = "";
		},
		findPopup() {
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
		parseRulesText() {
			const text = this.getModelFamilyRulesText();
			if (!text.trim()) return [];
			const rules = [];
			const lines = text.split(/\r?\n/);
			for (const line of lines) {
				const parsed = parseRuleLine(line);
				if (!parsed) continue;
				rules.push(parsed);
			}
			return rules;
		},
		getActiveFamilyRules() {
			const combined = this.parseRulesText().filter((rule) => !!rule.prefix);
			combined.sort((a, b) => b.prefix.length - a.prefix.length);
			return combined;
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
		extractOutputRate(itemEl) {
			if (!itemEl) return -1;
			const text = (itemEl.textContent || "").replace(/\s+/g, " ");
			const textMatch = text.match(/近期出字率[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
			if (textMatch) {
				const value = parseFloat(textMatch[1]);
				if (Number.isFinite(value)) return value;
			}
			return -1;
		},
		extractModelName(itemEl) {
			if (!itemEl) return "";
			const titleRow = itemEl.querySelector(".text-xs.font-medium");
			if (titleRow) {
				const spans = Array.from(titleRow.querySelectorAll("span"));
				for (const span of spans) {
					const text = (span.textContent || "").trim();
					if (!text) continue;
					if (text === "当前模型" || text === "推荐模型" || text === "作者设置") continue;
					return text;
				}
			}
			const text = (itemEl.textContent || "").replace(/\s+/g, " ");
			const textMatch = text.match(/([A-Za-z0-9._-]+)\s+价格系数[：:]/);
			if (textMatch) return textMatch[1].trim();
			return "";
		},
		normalizeHeuristicFamily(modelName) {
			const raw = String(modelName || "").trim().toLowerCase();
			if (!raw) return {
				key: "",
				label: ""
			};
			const tokens = raw.split(/[\s_-]+/).map((token) => token.trim()).filter(Boolean);
			const filtered = tokens.filter((token) => !FAMILY_QUALIFIERS.has(token));
			const keyTokens = filtered.length ? filtered : tokens;
			const key = normalizeFamilyKey(keyTokens.join("-"));
			const label = keyTokens.join(" ").trim();
			return {
				key,
				label
			};
		},
		deriveUnknownPrefix(modelName) {
			const value = normalizeRulePrefix(String(modelName || ""));
			if (!value) return "";
			const gemini = value.match(/^gemini-\d+(?:\.\d+)?-(?:pro|flash)/);
			if (gemini) return gemini[0];
			const gpt = value.match(/^gpt-\d+(?:\.\d+)?(?:-(?:mini|nano|chat-latest))?/);
			if (gpt) return gpt[0];
			const claude = value.match(/^claude-(?:opus|sonnet|haiku)-\d+(?:-\d+)?/);
			if (claude) return claude[0];
			const grok = value.match(/^grok-\d+(?:\.\d+)?(?:-fast)?/);
			if (grok) return grok[0];
			const deepseek = value.match(/^deepseek-[a-z0-9.]+/);
			if (deepseek) return deepseek[0];
			const fallbackTokens = value.split("-").filter(Boolean);
			return fallbackTokens.slice(0, Math.min(3, fallbackTokens.length)).join("-");
		},
		prettifyPrefixLabel(prefix) {
			return String(prefix || "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
		},
		recordUnknownPrefix(prefix, sampleName = "") {
			const normalized = normalizeRulePrefix(prefix);
			if (!normalized) return;
			const current = this.unknownPrefixStats.get(normalized) || {
				count: 0,
				sample: ""
			};
			current.count += 1;
			if (!current.sample && sampleName) {
				current.sample = sampleName;
			}
			this.unknownPrefixStats.set(normalized, current);
		},
		buildUnknownMappingDraft(limit = 50) {
			const rows = [...this.unknownPrefixStats.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, Math.max(1, Number(limit) || 50)).map(([prefix]) => `${prefix}|${this.prettifyPrefixLabel(prefix)}|未分类`);
			return rows.join("\n");
		},
		getUnknownModelFamilySuggestionText(limit = 50) {
			return this.buildUnknownMappingDraft(limit);
		},
		resolveModelFamily(modelName, rules) {
			const normalized = normalizeRulePrefix(modelName);
			for (const rule of rules) {
				if (!rule.prefix || !normalized.startsWith(rule.prefix)) continue;
				const label = rule.position ? `${rule.label}（${rule.position}）` : rule.label;
				return {
					key: `rule:${rule.key}`,
					label,
					mapped: true
				};
			}
			const unknownPrefix = this.deriveUnknownPrefix(modelName);
			this.recordUnknownPrefix(unknownPrefix, modelName);
			return {
				key: "unknown:others",
				label: "未映射",
				mapped: false
			};
		},
		findCategoryBlocks(popup) {
			const blocks = Array.from(popup.querySelectorAll("div.w-full.cursor-pointer.block"));
			return blocks.filter((block) => Boolean(block.querySelector(".MuiAccordionSummary-root") && block.querySelector(".MuiAccordionDetails-root") && (block.textContent || "").includes("价格系数")));
		},
		buildCategoryMeta(block, blockIndex, rules) {
			const details = block.querySelector(".MuiAccordionDetails-root");
			if (!details) return null;
			const items = Array.from(details.children).filter((child) => {
				return child.nodeType === 1 && (child.textContent || "").includes("价格系数");
			});
			if (items.length === 0) return null;
			const itemMetas = items.map((item, index) => {
				const modelName = this.extractModelName(item);
				const family = this.resolveModelFamily(modelName, rules);
				return {
					item,
					index,
					modelName,
					price: this.extractPrice(item),
					outputRate: this.extractOutputRate(item),
					familyKey: family.key,
					familyLabel: family.label,
					mapped: family.mapped
				};
			});
			return {
				block,
				blockIndex,
				details,
				itemMetas
			};
		},
		compareItemMetas(a, b, sortState) {
			const metric = sortState?.metric === "price" ? "price" : "outputRate";
			const direction = sortState?.direction === "asc" ? "asc" : "desc";
			const primaryA = metric === "price" ? a.price : a.outputRate;
			const primaryB = metric === "price" ? b.price : b.outputRate;
			if (primaryA !== primaryB) {
				if (direction === "asc") return primaryA - primaryB;
				return primaryB - primaryA;
			}
			if (a.outputRate !== b.outputRate) return b.outputRate - a.outputRate;
			if (a.price !== b.price) return a.price - b.price;
			return a.index - b.index;
		},
		sortItemsInCategory(meta, sortState) {
			const sorted = [...meta.itemMetas].sort((a, b) => this.compareItemMetas(a, b, sortState));
			const needReorder = sorted.some((entry, index) => entry.item !== meta.itemMetas[index].item);
			if (!needReorder) return;
			const frag = document.createDocumentFragment();
			sorted.forEach((entry) => frag.appendChild(entry.item));
			meta.details.appendChild(frag);
			meta.itemMetas = sorted;
		},
		buildFamilyTagGroups(metas) {
			const groupMap = new Map();
			metas.forEach((meta) => {
				meta.itemMetas.forEach((itemMeta) => {
					if (!itemMeta.familyKey) return;
					if (!groupMap.has(itemMeta.familyKey)) {
						groupMap.set(itemMeta.familyKey, {
							key: itemMeta.familyKey,
							label: itemMeta.familyLabel || "未分类",
							count: 0
						});
					}
					const group = groupMap.get(itemMeta.familyKey);
					group.count += 1;
				});
			});
			return [...groupMap.values()].sort((a, b) => {
				if (a.count !== b.count) return b.count - a.count;
				return a.label.localeCompare(b.label);
			});
		},
		ensureFamilyTagBar(popup, listContainer) {
			if (!popup || !listContainer) return null;
			let bar = popup.querySelector("#aifengyue-model-family-tags");
			if (!bar) {
				bar = document.createElement("div");
				bar.id = "aifengyue-model-family-tags";
				bar.style.cssText = [
					"margin:6px 0 10px",
					"padding:8px 10px",
					"border:1px solid #e2e8f0",
					"border-radius:10px",
					"background:#f8fafc",
					"display:flex",
					"flex-wrap:wrap",
					"gap:6px",
					"align-items:center",
					"position:relative",
					"z-index:2"
				].join(";");
				bar.addEventListener("click", (event) => {
					const target = event.target;
					if (!(target instanceof Element)) return;
					const metricBtn = target.closest("button[data-sort-metric]");
					if (metricBtn) {
						const nextMetric = metricBtn.getAttribute("data-sort-metric") || "";
						if (!nextMetric) return;
						const current = this.getSortState();
						if (nextMetric === current.metric) {
							const nextDirection = current.direction === "asc" ? "desc" : "asc";
							this.setSortState(nextMetric, nextDirection);
						} else {
							this.setSortState(nextMetric, "asc");
						}
						return;
					}
					const btn = target.closest("button[data-family-key]");
					if (!btn) return;
					const nextKey = (btn.getAttribute("data-family-key") || "").trim();
					if (nextKey === this.activeModelFamilyKey) return;
					this.activeModelFamilyKey = nextKey;
					this.sortPopup();
				});
			}
			const parent = listContainer.parentElement;
			if (!parent) return bar;
			if (bar.parentElement !== parent || bar.nextElementSibling !== listContainer) {
				parent.insertBefore(bar, listContainer);
			}
			return bar;
		},
		renderFamilyTagBar(bar, groups, activeKey, sortState) {
			if (!bar) return;
			const normalizedActive = String(activeKey || "").trim();
			const currentSortMetric = sortState?.metric === "price" ? "price" : "outputRate";
			const currentSortDirection = sortState?.direction === "asc" ? "asc" : "desc";
			const signature = JSON.stringify({
				active: normalizedActive,
				metric: currentSortMetric,
				direction: currentSortDirection,
				groups: groups.map((group) => [group.key, group.count])
			});
			if (signature === this.familyTagRenderSignature) return;
			this.familyTagRenderSignature = signature;
			const buildBtn = (key, label, count, active) => {
				const background = active ? "#0f766e" : "#f1f5f9";
				const color = active ? "#ffffff" : "#334155";
				const border = active ? "#0f766e" : "#cbd5e1";
				return [
					`<button type="button" data-family-key="${key}"`,
					` style="border:1px solid ${border};background:${background};color:${color};`,
					"height:26px;padding:0 10px;border-radius:999px;font-size:12px;line-height:1;",
					"display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;\">",
					`<span>${label}</span><span style="opacity:0.85;">${count}</span></button>`
				].join("");
			};
			const total = groups.reduce((sum, group) => sum + group.count, 0);
			const allBtn = buildBtn("", "全部", total, !normalizedActive);
			const groupBtns = groups.map((group) => buildBtn(group.key, group.label, group.count, normalizedActive === group.key)).join("");
			const buildSortBtn = (attrName, value, label, active) => {
				const background = active ? "#0369a1" : "#eef2ff";
				const color = active ? "#ffffff" : "#1e3a8a";
				const border = active ? "#0369a1" : "#c7d2fe";
				return [
					`<button type="button" ${attrName}="${value}"`,
					` style="border:1px solid ${border};background:${background};color:${color};`,
					"height:26px;padding:0 10px;border-radius:999px;font-size:12px;line-height:1;",
					"display:inline-flex;align-items:center;cursor:pointer;white-space:nowrap;\">",
					`<span>${label}</span></button>`
				].join("");
			};
			const priceLabel = currentSortMetric === "price" ? `价格 ${currentSortDirection === "asc" ? "↑" : "↓"}` : "价格";
			const outputRateLabel = currentSortMetric === "outputRate" ? `出字率 ${currentSortDirection === "asc" ? "↑" : "↓"}` : "出字率";
			const metricPriceBtn = buildSortBtn("data-sort-metric", "price", priceLabel, currentSortMetric === "price");
			const metricRateBtn = buildSortBtn("data-sort-metric", "outputRate", outputRateLabel, currentSortMetric === "outputRate");
			bar.innerHTML = [
				"<span style=\"font-size:12px;font-weight:700;color:#334155;margin-right:2px;\">排序</span>",
				metricPriceBtn,
				metricRateBtn,
				"<span style=\"width:1px;height:16px;background:#cbd5e1;margin:0 2px;\"></span>",
				"<span style=\"font-size:12px;font-weight:700;color:#334155;margin-right:2px;\">模型类型</span>",
				allBtn,
				groupBtns
			].join("");
		},
		applyFamilyFilter(metas, familyKey) {
			const target = String(familyKey || "").trim();
			metas.forEach((meta) => {
				let visibleCount = 0;
				meta.itemMetas.forEach((itemMeta) => {
					const visible = !target || itemMeta.familyKey === target;
					itemMeta.item.style.display = visible ? "" : "none";
					if (visible) visibleCount += 1;
				});
				meta.block.style.display = visibleCount > 0 ? "" : "none";
			});
		},
		resolveCategorySortMetrics(meta, familyKey, sortState) {
			const target = String(familyKey || "").trim();
			const source = target ? meta.itemMetas.filter((itemMeta) => itemMeta.familyKey === target) : meta.itemMetas;
			if (source.length === 0) {
				return {
					hasVisible: false,
					best: null
				};
			}
			let best = source[0];
			for (let index = 1; index < source.length; index += 1) {
				const current = source[index];
				if (this.compareItemMetas(current, best, sortState) < 0) {
					best = current;
				}
			}
			return {
				hasVisible: true,
				best
			};
		},
		sortPopup() {
			const popup = this.findPopup();
			if (!popup) {
				this.resetPopupState();
				return;
			}
			this.observePopup(popup);
			const blocks = this.findCategoryBlocks(popup);
			if (blocks.length === 0) {
				const existingTagBar = popup.querySelector("#aifengyue-model-family-tags");
				if (existingTagBar) existingTagBar.remove();
				this.familyTagRenderSignature = "";
				return;
			}
			const parent = blocks[0].parentElement;
			if (!parent) return;
			this.unknownPrefixStats = new Map();
			const rules = this.getActiveFamilyRules();
			const sortState = this.getSortState();
			const metas = blocks.map((block, index) => this.buildCategoryMeta(block, index, rules)).filter(Boolean);
			if (metas.length === 0) return;
			metas.forEach((meta) => this.sortItemsInCategory(meta, sortState));
			const groups = this.buildFamilyTagGroups(metas);
			if (!groups.some((group) => group.key === this.activeModelFamilyKey)) {
				this.activeModelFamilyKey = "";
			}
			const tagBar = this.ensureFamilyTagBar(popup, parent);
			this.renderFamilyTagBar(tagBar, groups, this.activeModelFamilyKey, sortState);
			this.applyFamilyFilter(metas, this.activeModelFamilyKey);
			const metricsMap = new Map();
			metas.forEach((meta) => {
				metricsMap.set(meta, this.resolveCategorySortMetrics(meta, this.activeModelFamilyKey, sortState));
			});
			const sortedCategories = [...metas].sort((a, b) => {
				const aMetrics = metricsMap.get(a);
				const bMetrics = metricsMap.get(b);
				if (aMetrics.hasVisible !== bMetrics.hasVisible) {
					return aMetrics.hasVisible ? -1 : 1;
				}
				if (!aMetrics.best || !bMetrics.best) return a.blockIndex - b.blockIndex;
				const categoryCompare = this.compareItemMetas(aMetrics.best, bMetrics.best, sortState);
				if (categoryCompare !== 0) return categoryCompare;
				return a.blockIndex - b.blockIndex;
			});
			const needReorder = sortedCategories.some((meta, index) => meta.block !== metas[index].block);
			if (!needReorder) return;
			const frag = document.createDocumentFragment();
			sortedCategories.forEach((meta) => frag.appendChild(meta.block));
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
		gmRegisterMenuCommand("⚙️ 设置邮件 API Key", () => {
			const providerMeta = MailService.getCurrentProviderMeta();
			if (!providerMeta.requiresApiKey) {
				Toast.info(`${providerMeta.name} 无需 API Key`);
				Sidebar.refreshMailProviderConfigDisplay?.();
				return;
			}
			const currentKey = MailService.getApiKey();
			const newKey = prompt(`请输入 ${providerMeta.apiKeyLabel}:`, currentKey);
			if (newKey !== null) {
				MailService.setApiKey(newKey.trim() || MailService.getDefaultApiKey());
				Toast.success(`${providerMeta.name} API Key 已更新`);
				Sidebar.refreshMailProviderConfigDisplay?.();
				Sidebar.updateUsageDisplay?.(MailService.getUsageSnapshot());
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
	const WAITING_TICK_MS = 100;
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
		waitingTimer: null,
		waitingStartedAt: 0,
		waitingElapsedActive: false,
		waitingAccumulatedMs: 0,
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
                box-sizing: border-box;
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
                border: 0;
            }
            #${CAPSULE_ID}.is-waiting .aifengyue-chat-status-dot {
                animation: aifengyue-chat-capsule-pulse 1.2s ease-in-out infinite;
                background: transparent;
                border: 2px solid currentColor;
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
		clearWaitingTimer() {
			if (this.waitingTimer) {
				clearInterval(this.waitingTimer);
				this.waitingTimer = null;
			}
		},
		formatElapsedMs(elapsedMs = 0) {
			const ms = Number.isFinite(Number(elapsedMs)) ? Math.max(0, Number(elapsedMs)) : 0;
			return `${(ms / 1e3).toFixed(1)}s`;
		},
		getCurrentWaitingElapsedMs() {
			if (!Number.isFinite(Number(this.waitingStartedAt)) || Number(this.waitingStartedAt) <= 0) {
				return 0;
			}
			return Math.max(0, Date.now() - Number(this.waitingStartedAt));
		},
		getWaitingElapsedText() {
			return this.formatElapsedMs(this.getCurrentWaitingElapsedMs());
		},
		getWaitingTotalElapsedText() {
			const accumulated = Number.isFinite(Number(this.waitingAccumulatedMs)) ? Math.max(0, Number(this.waitingAccumulatedMs)) : 0;
			const current = this.waitingElapsedActive ? this.getCurrentWaitingElapsedMs() : 0;
			return this.formatElapsedMs(accumulated + current);
		},
		buildInFlightSuffix() {
			return this.inFlight > 1 ? ` (${this.inFlight})` : "";
		},
		applyWaitingView() {
			const elapsedText = this.waitingElapsedActive ? this.getWaitingElapsedText() : "0.0s";
			const totalText = this.getWaitingTotalElapsedText();
			this.applyView("waiting", `SSE 等待中 ${elapsedText} · 累计 ${totalText}${this.buildInFlightSuffix()}`);
		},
		startWaitingElapsed({ refreshElapsed = false, resetAccumulated = false } = {}) {
			if (resetAccumulated) {
				this.waitingAccumulatedMs = 0;
			}
			if (this.waitingElapsedActive && refreshElapsed) {
				this.waitingAccumulatedMs += this.getCurrentWaitingElapsedMs();
			}
			this.waitingStartedAt = Date.now();
			this.waitingElapsedActive = true;
			this.clearWaitingTimer();
			this.waitingTimer = setInterval(() => {
				if (!this.waitingElapsedActive) return;
				if (this.element?.dataset?.state !== "waiting") return;
				this.applyWaitingView();
			}, WAITING_TICK_MS);
		},
		stopWaitingElapsed({ resetAccumulated = false } = {}) {
			if (this.waitingElapsedActive) {
				this.waitingAccumulatedMs += this.getCurrentWaitingElapsedMs();
			}
			this.waitingElapsedActive = false;
			this.waitingStartedAt = 0;
			this.clearWaitingTimer();
			if (resetAccumulated) {
				this.waitingAccumulatedMs = 0;
			}
		},
		init() {
			this.inFlight = 0;
			this.stopWaitingElapsed({ resetAccumulated: true });
			this.applyView("idle", "SSE 待命");
		},
		onRequestStart() {
			this.inFlight += 1;
			this.startWaitingElapsed({
				resetAccumulated: this.inFlight === 1,
				refreshElapsed: this.waitingElapsedActive
			});
			this.applyWaitingView();
		},
		onRequestDone({ ok = false, status = 0, elapsedText = "-" } = {}) {
			this.inFlight = Math.max(0, this.inFlight - 1);
			if (this.inFlight > 0) {
				if (this.waitingElapsedActive) {
					this.applyWaitingView();
				} else {
					this.applyView("sending", `SSE 发送中${this.buildInFlightSuffix()}`);
				}
				return;
			}
			this.stopWaitingElapsed({ resetAccumulated: true });
			const statusText = formatStatus(status);
			const prefix = ok ? "SSE 已完成" : "SSE 失败";
			this.applyView(ok ? "done" : "error", `${prefix} · ${statusText} · ${elapsedText}`);
		},
		onSseError({ status = 0, code = "", message = "" } = {}) {
			this.stopWaitingElapsed();
			const statusText = formatStatus(status);
			const codeText = code ? ` ${code}` : "";
			const messageText = message ? ` · ${message}` : "";
			this.applyView("error", `SSE 错误${codeText} · ${statusText}${messageText}`);
		},
		onSseEvent(eventName = "") {
			const event = String(eventName || "").trim();
			if (!event) return;
			if (event === "ping" || event === "waiting") {
				this.startWaitingElapsed({ refreshElapsed: this.waitingElapsedActive });
				this.applyWaitingView();
				return;
			}
			if (event === "message" || event === "msg") {
				this.stopWaitingElapsed();
				this.applyView("sending", `SSE 发送中${this.buildInFlightSuffix()}`);
				return;
			}
			if (event === "message_end") {
				this.stopWaitingElapsed();
				this.applyView("done", "SSE 已完成");
			}
		}
	};

//#endregion
//#region src/runtime/chat-monitor/constants.js
	const CHAT_MESSAGES_PATH = "/chat-messages";
	const DEFAULT_TIMEOUT_SECONDS = 0;
	const MAX_TIMEOUT_SECONDS = 300;

//#endregion
//#region src/runtime/chat-monitor/logger.js
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

//#endregion
//#region src/runtime/chat-monitor/state-publisher.js
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
	function appendMonitorState(targetWindow, patch) {
		const prev = targetWindow && targetWindow.__AF_CHAT_MONITOR__ || window.__AF_CHAT_MONITOR__ || {};
		const next = {
			...prev,
			...patch,
			updatedAt: new Date().toISOString()
		};
		publishMonitorState(targetWindow, next);
	}

//#endregion
//#region src/runtime/chat-monitor/timeout-context.js
	function normalizeTimeoutSeconds(value) {
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return 0;
		const normalized = Math.floor(parsed);
		if (normalized <= 0) return 0;
		return Math.min(normalized, MAX_TIMEOUT_SECONDS);
	}
	function getChatMessagesTimeoutSeconds() {
		const saved = gmGetValue(CONFIG.STORAGE_KEYS.CHAT_MESSAGES_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS);
		return normalizeTimeoutSeconds(saved);
	}
	function isAbortSignalLike(signal) {
		return !!signal && typeof signal === "object" && typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function";
	}
	function getFetchSignal(first, second) {
		if (isAbortSignalLike(second?.signal)) {
			return second.signal;
		}
		if (first && typeof first === "object" && isAbortSignalLike(first.signal)) {
			return first.signal;
		}
		return null;
	}
	function buildFetchArgsWithSignal(first, second, signal) {
		if (!signal) return [first, second];
		if (first instanceof Request) {
			if (second && typeof second === "object") {
				return [first, {
					...second,
					signal
				}];
			}
			return [new Request(first, { signal })];
		}
		return [first, {
			...second || {},
			signal
		}];
	}
	function createTimeoutAbortContext({ first, second, timeoutMs }) {
		if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) {
			return {
				args: [first, second],
				cleanup: () => {},
				isTimeoutTriggered: () => false,
				getTimeoutReason: () => "",
				setWaitingMode: () => {},
				setOutputMode: () => {},
				notifyEvent: () => {},
				getTimeoutMode: () => "disabled"
			};
		}
		const baseSignal = getFetchSignal(first, second);
		const controller = new AbortController();
		let timeoutTriggered = false;
		let timeoutReason = "";
		let timeoutMode = "waiting";
		let waitingTimer = null;
		let inactivityTimer = null;
		let onBaseAbort = null;
		if (isAbortSignalLike(baseSignal)) {
			if (baseSignal.aborted) {
				controller.abort(baseSignal.reason || "upstream-aborted");
			} else {
				onBaseAbort = () => {
					controller.abort(baseSignal.reason || "upstream-aborted");
				};
				baseSignal.addEventListener("abort", onBaseAbort, { once: true });
			}
		}
		const clearWaitingTimer = () => {
			if (!waitingTimer) return;
			clearTimeout(waitingTimer);
			waitingTimer = null;
		};
		const clearInactivityTimer = () => {
			if (!inactivityTimer) return;
			clearTimeout(inactivityTimer);
			inactivityTimer = null;
		};
		const triggerTimeout = (reason) => {
			if (timeoutTriggered) return;
			timeoutTriggered = true;
			timeoutReason = reason || "chat-messages-timeout";
			controller.abort(timeoutReason);
		};
		const armWaitingTimer = () => {
			if (timeoutMode !== "waiting" || timeoutTriggered) return;
			clearWaitingTimer();
			waitingTimer = setTimeout(() => {
				triggerTimeout("chat-messages-waiting-timeout");
			}, Number(timeoutMs));
		};
		const armInactivityTimer = () => {
			if (timeoutTriggered) return;
			clearInactivityTimer();
			inactivityTimer = setTimeout(() => {
				triggerTimeout("chat-messages-inactive-timeout");
			}, Number(timeoutMs));
		};
		const notifyEvent = () => {
			armInactivityTimer();
		};
		const setWaitingMode = () => {
			if (timeoutTriggered) return;
			timeoutMode = "waiting";
			armWaitingTimer();
			notifyEvent();
		};
		const setOutputMode = () => {
			if (timeoutTriggered) return;
			timeoutMode = "output";
			clearWaitingTimer();
			notifyEvent();
		};
		const cleanup = () => {
			clearWaitingTimer();
			clearInactivityTimer();
			if (onBaseAbort && isAbortSignalLike(baseSignal)) {
				baseSignal.removeEventListener("abort", onBaseAbort);
				onBaseAbort = null;
			}
		};
		armWaitingTimer();
		armInactivityTimer();
		return {
			args: buildFetchArgsWithSignal(first, second, controller.signal),
			cleanup,
			isTimeoutTriggered: () => timeoutTriggered,
			getTimeoutReason: () => timeoutReason,
			setWaitingMode,
			setOutputMode,
			notifyEvent,
			getTimeoutMode: () => timeoutMode
		};
	}
	function buildTimeoutInfo({ timeoutSeconds = 0, reason = "" } = {}) {
		if (reason === "chat-messages-waiting-timeout") {
			return {
				code: "waiting_timeout",
				message: `等待中超过 ${timeoutSeconds} 秒`
			};
		}
		if (reason === "chat-messages-inactive-timeout") {
			return {
				code: "inactive_timeout",
				message: `超过 ${timeoutSeconds} 秒未收到事件`
			};
		}
		return {
			code: "timeout",
			message: `超过 ${timeoutSeconds} 秒未完成`
		};
	}

//#endregion
//#region src/runtime/chat-monitor/sse-parser.js
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
	function formatClockTimestamp(epochMs = Date.now()) {
		const date = new Date(epochMs);
		const hh = String(date.getHours()).padStart(2, "0");
		const mm = String(date.getMinutes()).padStart(2, "0");
		const ss = String(date.getSeconds()).padStart(2, "0");
		const ms = String(date.getMilliseconds()).padStart(3, "0");
		return `${hh}:${mm}:${ss}.${ms}`;
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

//#endregion
//#region src/runtime/chat-monitor/fetch-hook.js
	const chatMonitorFetchMethods = { hookFetch(targetWindow, baseOrigin) {
		if (!targetWindow || typeof targetWindow.fetch !== "function") {
			logWarn("fetch 不可用，跳过 fetch hook");
			return;
		}
		if (this.originalFetch) return;
		this.originalFetch = targetWindow.fetch;
		logInfo("fetch hook 已安装");
		targetWindow.fetch = (...args) => {
			const first = args[0];
			const secondRaw = args[1];
			const second = secondRaw || {};
			const url = toAbsoluteUrl(first, baseOrigin);
			const method = normalizeMethod(second.method || (first && typeof first === "object" ? first.method : "GET"));
			const startedAt = Date.now();
			const tracked = shouldTrack(url, method);
			if (!tracked) {
				return this.originalFetch.apply(targetWindow, args);
			}
			const timeoutSeconds = getChatMessagesTimeoutSeconds();
			const timeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1e3 : 0;
			const requestState = {
				sseError: null,
				timeoutReported: false,
				firstMessageToastAt: 0
			};
			const abortContext = createTimeoutAbortContext({
				first,
				second: secondRaw,
				timeoutMs
			});
			const requestArgs = abortContext.args;
			const promise = this.originalFetch.apply(targetWindow, requestArgs);
			ChatStreamCapsule.onRequestStart();
			appendMonitorState(this.targetWindow, {
				timeoutSeconds,
				timeoutMode: abortContext.getTimeoutMode()
			});
			logInfo("命中 fetch /chat-messages 请求", {
				method,
				url,
				timeoutSeconds
			});
			let cleanedUp = false;
			const cleanupAbortContext = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				abortContext.cleanup();
			};
			promise.then((response) => {
				let finalized = false;
				const done = () => {
					if (finalized) return;
					finalized = true;
					cleanupAbortContext();
					const timedOut = abortContext.isTimeoutTriggered();
					const timeoutReason = abortContext.getTimeoutReason();
					if (timedOut && !requestState.timeoutReported) {
						requestState.timeoutReported = true;
						const timeoutInfo = buildTimeoutInfo({
							timeoutSeconds,
							reason: timeoutReason
						});
						logWarn("fetch /chat-messages 超时，已主动中止", {
							method,
							url,
							timeoutSeconds,
							timeoutReason
						});
						appendMonitorState(this.targetWindow, { lastTimeout: {
							channel: "fetch",
							method,
							url,
							timeoutSeconds,
							timeoutReason,
							at: Date.now()
						} });
						ChatStreamCapsule.onSseError({
							status: 408,
							code: timeoutInfo.code,
							message: timeoutInfo.message
						});
					}
					const finalStatus = Number(requestState.sseError?.status || (timedOut ? 408 : 0) || response?.status || 0);
					const finalOk = !!response?.ok && !requestState.sseError && !timedOut;
					const elapsedText = formatElapsedMs(startedAt);
					logInfo("fetch /chat-messages 请求完成", {
						method,
						url,
						status: finalStatus,
						sseErrorCode: requestState.sseError?.code || "",
						timedOut
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
						const eventName = sseEvent.event || sseEvent.eventName || "";
						ChatStreamCapsule.onSseEvent(eventName);
						if (eventName === "message" || eventName === "msg") {
							if (!requestState.firstMessageToastAt) {
								const firstAt = Date.now();
								requestState.firstMessageToastAt = firstAt;
								const clockText = formatClockTimestamp(firstAt);
								const elapsedText = formatElapsedMs(startedAt);
								Toast.info(`首个 ${eventName} 事件: ${clockText} (+${elapsedText})`, 3600);
								logInfo("已收到首个输出事件", {
									method,
									url,
									event: eventName,
									firstAt,
									elapsedText
								});
								appendMonitorState(this.targetWindow, { firstMessageEvent: {
									event: eventName,
									at: firstAt,
									clockText,
									elapsedText
								} });
							}
							abortContext.setOutputMode();
						} else if (eventName === "ping" || eventName === "waiting") {
							abortContext.setWaitingMode();
						} else {
							abortContext.notifyEvent();
						}
						appendMonitorState(this.targetWindow, {
							timeoutMode: abortContext.getTimeoutMode(),
							lastSseEvent: {
								event: sseEvent.event || "",
								eventName: sseEvent.eventName || "",
								at: Date.now()
							}
						});
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
				cleanupAbortContext();
				const elapsedText = formatElapsedMs(startedAt);
				const timedOut = abortContext.isTimeoutTriggered();
				const timeoutReason = abortContext.getTimeoutReason();
				const status = timedOut ? 408 : 0;
				if (timedOut && !requestState.timeoutReported) {
					requestState.timeoutReported = true;
					const timeoutInfo = buildTimeoutInfo({
						timeoutSeconds,
						reason: timeoutReason
					});
					logWarn("fetch /chat-messages 超时，已主动中止", {
						method,
						url,
						timeoutSeconds,
						timeoutReason
					});
					appendMonitorState(this.targetWindow, { lastTimeout: {
						channel: "fetch",
						method,
						url,
						timeoutSeconds,
						timeoutReason,
						at: Date.now()
					} });
					ChatStreamCapsule.onSseError({
						status: 408,
						code: timeoutInfo.code,
						message: timeoutInfo.message
					});
				} else {
					logWarn("fetch /chat-messages 请求失败", {
						method,
						url
					});
				}
				showResultToast({
					status,
					ok: false,
					elapsedText,
					channel: "fetch",
					sseError: requestState.sseError
				});
				ChatStreamCapsule.onRequestDone({
					status,
					ok: false,
					elapsedText
				});
			});
			return promise;
		};
	} };

//#endregion
//#region src/runtime/chat-monitor/xhr-hook.js
	const chatMonitorXhrMethods = { hookXhr(targetWindow, baseOrigin) {
		if (!targetWindow || typeof targetWindow.XMLHttpRequest !== "function") {
			logWarn("XMLHttpRequest 不可用，跳过 xhr hook");
			return;
		}
		if (this.xhrOpen || this.xhrSend) return;
		const monitor = this;
		monitor.xhrOpen = targetWindow.XMLHttpRequest.prototype.open;
		monitor.xhrSend = targetWindow.XMLHttpRequest.prototype.send;
		logInfo("xhr hook 已安装");
		targetWindow.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
			const absoluteUrl = toAbsoluteUrl(url, baseOrigin);
			this.__afChatMonitorMeta = {
				method: normalizeMethod(method),
				url: absoluteUrl,
				startedAt: 0,
				tracked: shouldTrack(absoluteUrl, method),
				timeoutSeconds: 0,
				timeoutTimer: null,
				timeoutTriggered: false
			};
			return monitor.xhrOpen.call(this, method, url, ...rest);
		};
		targetWindow.XMLHttpRequest.prototype.send = function(...args) {
			const meta = this.__afChatMonitorMeta;
			if (meta && meta.tracked) {
				meta.startedAt = Date.now();
				meta.timeoutSeconds = getChatMessagesTimeoutSeconds();
				meta.timeoutTriggered = false;
				ChatStreamCapsule.onRequestStart();
				appendMonitorState(monitor.targetWindow, { timeoutSeconds: meta.timeoutSeconds });
				logInfo("命中 xhr /chat-messages 请求", {
					method: meta.method,
					url: meta.url,
					timeoutSeconds: meta.timeoutSeconds
				});
				let reported = false;
				if (meta.timeoutSeconds > 0) {
					meta.timeoutTimer = setTimeout(() => {
						meta.timeoutTriggered = true;
						logWarn("xhr /chat-messages 超时，已主动中止", {
							method: meta.method,
							url: meta.url,
							timeoutSeconds: meta.timeoutSeconds
						});
						appendMonitorState(monitor.targetWindow, { lastTimeout: {
							channel: "xhr",
							method: meta.method,
							url: meta.url,
							timeoutSeconds: meta.timeoutSeconds,
							at: Date.now()
						} });
						ChatStreamCapsule.onSseError({
							status: 408,
							code: "timeout",
							message: `超过 ${meta.timeoutSeconds} 秒未完成`
						});
						try {
							this.abort();
						} catch (abortError) {
							logWarn("xhr /chat-messages 超时后 abort 失败", {
								method: meta.method,
								url: meta.url,
								message: abortError?.message || String(abortError)
							});
						}
					}, meta.timeoutSeconds * 1e3);
				}
				const onLoadEnd = () => {
					if (reported) return;
					reported = true;
					if (meta.timeoutTimer) {
						clearTimeout(meta.timeoutTimer);
						meta.timeoutTimer = null;
					}
					const elapsedText = formatElapsedMs(meta.startedAt);
					const timedOut = !!meta.timeoutTriggered;
					const status = timedOut ? 408 : Number(this.status || 0);
					const ok = !timedOut && status >= 200 && status < 300;
					logInfo("xhr /chat-messages 请求完成", {
						method: meta.method,
						url: meta.url,
						status,
						timedOut
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
			return monitor.xhrSend.call(this, ...args);
		};
	} };

//#endregion
//#region src/runtime/chat-messages-monitor.js
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
				timeoutSeconds: getChatMessagesTimeoutSeconds(),
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
		stop() {
			if (!this.started && !this.originalFetch && !this.xhrOpen && !this.xhrSend) return;
			const targetWindow = this.targetWindow || getTargetWindow();
			if (targetWindow) {
				if (this.originalFetch && typeof targetWindow.fetch === "function") {
					targetWindow.fetch = this.originalFetch;
				}
				if (this.xhrOpen && targetWindow.XMLHttpRequest?.prototype) {
					targetWindow.XMLHttpRequest.prototype.open = this.xhrOpen;
				}
				if (this.xhrSend && targetWindow.XMLHttpRequest?.prototype) {
					targetWindow.XMLHttpRequest.prototype.send = this.xhrSend;
				}
			}
			this.started = false;
			this.targetWindow = null;
			this.originalFetch = null;
			this.xhrOpen = null;
			this.xhrSend = null;
			publishMonitorState(targetWindow, {
				started: false,
				path: CHAT_MESSAGES_PATH,
				fetchHooked: false,
				xhrHooked: false,
				timeoutSeconds: getChatMessagesTimeoutSeconds(),
				stoppedAt: new Date().toISOString()
			});
			logInfo("网络监听已停止");
		},
		...chatMonitorFetchMethods,
		...chatMonitorXhrMethods
	};

//#endregion
//#region src/runtime/spa-watcher.js
	const SPAWatcher = {
		originalPushState: null,
		originalReplaceState: null,
		popstateHandler: null,
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
					AutoRegister.refreshAccountPointPolling();
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
						AutoRegister.ensureAccountPointIndicator();
					});
				}
			});
			APP_STATE.spa.observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			this.hookHistoryAPI();
			AutoRegister.refreshAccountPointPolling();
			console.log("[AI风月注册助手] SPA 监听器已启动");
		},
		hookHistoryAPI() {
			if (this.originalPushState || this.originalReplaceState) {
				return;
			}
			this.originalPushState = history.pushState;
			this.originalReplaceState = history.replaceState;
			history.pushState = (...args) => {
				this.originalPushState.apply(history, args);
				this.handlePageChange();
			};
			history.replaceState = (...args) => {
				this.originalReplaceState.apply(history, args);
				this.handlePageChange();
			};
			this.popstateHandler = () => {
				this.handlePageChange();
			};
			window.addEventListener("popstate", this.popstateHandler);
		},
		stopObserver() {
			if (APP_STATE.spa.observer) {
				APP_STATE.spa.observer.disconnect();
				APP_STATE.spa.observer = null;
			}
			APP_STATE.spa.checkScheduled = false;
			if (this.originalPushState) {
				history.pushState = this.originalPushState;
				this.originalPushState = null;
			}
			if (this.originalReplaceState) {
				history.replaceState = this.originalReplaceState;
				this.originalReplaceState = null;
			}
			if (this.popstateHandler) {
				window.removeEventListener("popstate", this.popstateHandler);
				this.popstateHandler = null;
			}
			AutoRegister.stopAccountPointPolling({ reason: "spa-observer-stopped" });
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
		AutoRegister.startTokenPoolScheduler();
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
    #aifengyue-sidebar,
    #aifengyue-token-pool-log-modal {
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
    #aifengyue-sidebar[data-theme="dark"],
    #aifengyue-token-pool-log-modal[data-theme="dark"] {
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
    body.aifengyue-sidebar-inline-mode #header-setting-button {
        margin-right: 70px !important;
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
    .aifengyue-model-rules-textarea {
        min-height: 130px !important;
        max-height: 340px !important;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace !important;
        font-size: 12px !important;
        line-height: 1.5 !important;
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
    #aifengyue-token-pool-log-modal {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
    }
    #aifengyue-conversation-modal.open {
        display: block;
    }
    #aifengyue-token-pool-log-modal.open {
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
    .aifengyue-log-modal-content {
        width: min(1280px, calc(100vw - 40px));
        min-width: 760px;
        height: min(92vh, 1080px);
        border-radius: 12px;
        background: var(--af-bg);
        border: 1px solid var(--af-border);
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
    #aifengyue-sidebar[data-theme="dark"] .aifengyue-conv-modal-head,
    #aifengyue-token-pool-log-modal .aifengyue-conv-modal-head {
        background: color-mix(in srgb, var(--af-bg-card) 88%, #ffffff);
    }
    .aifengyue-conv-modal-title {
        font-size: 14px;
        font-weight: 700;
        color: #1f2937;
    }
    .aifengyue-log-modal-head-actions {
        display: flex;
        align-items: center;
        gap: 8px;
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
    .aifengyue-log-modal-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
        height: 100%;
        padding: 12px;
        background: var(--af-bg-soft);
    }
    .aifengyue-log-list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg-card);
        padding: 12px;
    }
    .aifengyue-log-empty {
        height: 100%;
        min-height: 240px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: var(--af-muted);
        font-size: 13px;
        line-height: 1.7;
    }
    .aifengyue-log-entry {
        border: 1px solid var(--af-border);
        border-radius: 10px;
        background: var(--af-bg);
        padding: 12px;
        margin-bottom: 10px;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
    }
    .aifengyue-log-entry:last-child {
        margin-bottom: 0;
    }
    .aifengyue-log-entry.is-info {
        border-left: 3px solid #2563eb;
    }
    .aifengyue-log-entry.is-warn {
        border-left: 3px solid #d97706;
    }
    .aifengyue-log-entry.is-error {
        border-left: 3px solid #dc2626;
    }
    .aifengyue-log-entry.is-debug {
        border-left: 3px solid #7c3aed;
    }
    .aifengyue-log-entry-head {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
        font-size: 11px;
        color: var(--af-muted);
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    }
    .aifengyue-log-level,
    .aifengyue-log-step,
    .aifengyue-log-time {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--af-input-bg);
        border: 1px solid var(--af-border);
    }
    .aifengyue-log-message {
        color: var(--af-text);
        font-size: 13px;
        line-height: 1.7;
        font-weight: 600;
        word-break: break-word;
    }
    .aifengyue-log-run {
        margin-top: 8px;
        color: var(--af-muted);
        font-size: 11px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        word-break: break-all;
    }
    .aifengyue-log-meta {
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--af-border);
        background: var(--af-input-bg);
        color: var(--af-text);
        font-size: 11px;
        line-height: 1.6;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-x: auto;
    }
    @media (max-width: 760px) {
        .aifengyue-conv-modal-content {
            min-width: 0;
            width: calc(100vw - 16px);
            height: calc(100vh - 16px);
        }
        .aifengyue-log-modal-content {
            min-width: 0;
            width: calc(100vw - 16px);
            height: calc(100vh - 16px);
        }
        .aifengyue-log-modal-head-actions {
            gap: 6px;
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