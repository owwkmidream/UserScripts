// ==UserScript==
// @name         AI风月 自动注册助手
// @namespace    https://github.com/owwkmidream/UserScripts
// @version      2.0.9
// @description  自动生成临时邮箱、账户名和密码，自动获取验证码，完成 AI风月 网站注册
// @author       owwkmidream
// @match        https://dearestie.xyz/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
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
			MODEL_SORT_ENABLED: "aifengyue_model_sort_enabled",
			SIDEBAR_LAYOUT_MODE: "aifengyue_sidebar_layout_mode",
			SIDEBAR_THEME: "aifengyue_sidebar_theme"
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
		const response = await gmRequest({
			method,
			url: options.url,
			headers: options.headers || {},
			data: options.body ? JSON.stringify(options.body) : undefined,
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
		request(endpoint, options = {}) {
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
					onerror: () => {
						reject(new Error("网络请求失败"));
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
//#region src/ui/sidebar.js
	const VALID_TABS = [
		"register",
		"tools",
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
		isOpen: false,
		layoutMode: "inline",
		activeTab: "register",
		theme: "light",
		state: APP_STATE.sidebar.state,
		init() {
			if (this.element && document.body.contains(this.element) && document.getElementById("aifengyue-sidebar-toggle")) {
				return;
			}
			this.layoutMode = this.getLayoutMode();
			this.theme = this.getTheme();
			this.createSidebar();
			this.createToggleButton();
			this.loadSavedData();
			this.applyLayoutModeClass();
			this.applyTheme();
			this.setActiveTab(this.activeTab);
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
                        <div class="aifengyue-input-group">
                            <label>更换账号附加文本</label>
                            <input type="text" id="aifengyue-switch-text" placeholder="输入拼接到 query 的附加文本">
                        </div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-switch-account">
                            🔀 更换账号
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
						navigator.clipboard.writeText(value).then(() => {
							getToast()?.success("已复制到剪贴板");
						}).catch(() => {
							getToast()?.error("复制失败");
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
					getToast()?.warning("当前页面没有可提取的 iframe srcdoc");
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
		},
		getLayoutMode() {
			const mode = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_LAYOUT_MODE, "inline");
			return mode === "floating" ? "floating" : "inline";
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
			document.documentElement.classList.toggle("aifengyue-sidebar-inline-mode", isInlineOpen);
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
				toggle.classList.add("hidden");
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
				toggle.classList.remove("hidden");
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
			const dot = this.element.querySelector("#aifengyue-status-dot");
			if (dot) {
				dot.className = `aifengyue-status-dot ${status.color}`;
			}
			const statusText = this.element.querySelector("#aifengyue-status-text");
			const statusMessage = this.element.querySelector("#aifengyue-status-message");
			const email = this.element.querySelector("#aifengyue-email");
			const username = this.element.querySelector("#aifengyue-username");
			const password = this.element.querySelector("#aifengyue-password");
			const code = this.element.querySelector("#aifengyue-code");
			if (statusText) statusText.textContent = status.text;
			if (statusMessage) statusMessage.textContent = this.state.statusMessage;
			if (email) email.textContent = this.state.email || "未生成";
			if (username) username.textContent = this.state.username || "未生成";
			if (password) password.textContent = this.state.password || "未生成";
			if (code) code.textContent = this.state.verificationCode || "等待中...";
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
	function logInfo(runCtx, step, message, meta) {
		baseLog("INFO", runCtx, step, message, meta);
	}
	function logWarn(runCtx, step, message, meta) {
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
//#region src/features/auto-register.js
	const X_LANGUAGE = "zh-Hans";
	const SITE_ENDPOINTS = {
		SEND_CODE: "/console/api/register/email",
		SLIDE_GET: "/go/api/slide/get",
		REGISTER: "/console/api/register",
		ACCOUNT_GENDER: "/console/api/account/gender",
		FAVORITE_TAGS: "/console/api/account_extend/favorite_tags",
		ACCOUNT_EXTEND_SET: "/console/api/account/extend_set",
		APPS: "/console/api/apps",
		INSTALLED_MESSAGES: "/console/api/installed-apps",
		CHAT_MESSAGES: "/console/api/installed-apps"
	};
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
	function randomConversationSuffix(length = 3) {
		const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
		let output = "";
		for (let i = 0; i < length; i++) {
			output += chars[Math.floor(Math.random() * chars.length)];
		}
		return output;
	}
	const AutoRegister = {
		registrationStartTime: null,
		switchingAccount: false,
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
			const strictCode = options.strictCode === true;
			const acceptableCodes = Array.isArray(options.acceptableCodes) ? options.acceptableCodes : [0, 200];
			const method = options.method || "GET";
			const url = `${window.location.origin}${path}`;
			logInfo(runCtx, step, `${method} ${path} 请求开始`);
			logDebug(runCtx, step, "请求详情", {
				url,
				headers: {
					"Content-Type": "application/json",
					"X-Language": X_LANGUAGE,
					...options.headers || {}
				},
				body: options.body ?? null,
				anonymous: true
			});
			const response = await gmRequestJson({
				method,
				url,
				headers: {
					"Content-Type": "application/json",
					"X-Language": X_LANGUAGE,
					...options.headers || {}
				},
				body: options.body,
				timeout: options.timeout ?? 3e4,
				anonymous: true
			});
			const payload = response.json;
			logInfo(runCtx, step, `${method} ${path} 响应`, {
				httpStatus: response.status,
				statusField: payload?.status,
				result: payload?.result,
				success: payload?.success,
				code: payload?.code,
				message: payload?.message
			});
			logDebug(runCtx, step, "原始响应内容", {
				raw: response.raw,
				json: payload
			});
			if (response.status < 200 || response.status >= 300) {
				throw new Error(readErrorMessage(payload, `接口 ${path} 请求失败: HTTP ${response.status}`));
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
					lang: X_LANGUAGE
				}
			}, runCtx, "SEND_CODE");
			if (typeof payload?.code === "number" && payload.code !== 0 && payload.code !== 200) {
				logWarn(runCtx, "SEND_CODE", "发送验证码接口返回非 0 code，继续执行", payload);
			}
			return payload;
		},
		async getRegToken(runCtx) {
			const payload = await this.requestSiteApi(SITE_ENDPOINTS.SLIDE_GET, { method: "GET" }, runCtx, "GET_REG_TOKEN");
			const regToken = payload?.data?.reg_token;
			if (!regToken) {
				throw new Error("未获取到 reg_token");
			}
			logInfo(runCtx, "GET_REG_TOKEN", "reg_token 获取成功");
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
					interface_language: X_LANGUAGE,
					client: "web_pc",
					is_web3_account: false,
					reg_token: regToken
				}
			}, runCtx, "REGISTER");
			const token = typeof payload?.data === "string" ? payload.data.trim() : typeof payload?.data?.token === "string" ? payload.data.token.trim() : "";
			if (!token) {
				throw new Error("注册成功但未返回 token（支持 data 或 data.token）");
			}
			logInfo(runCtx, "REGISTER", "注册接口返回 token");
			logDebug(runCtx, "REGISTER", "token 完整值", { token });
			return token;
		},
		async setAccountGender(token, runCtx) {
			await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_GENDER, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: { gender: 1 }
			}, runCtx, "SET_GENDER");
			logInfo(runCtx, "SET_GENDER", "首次引导-性别设置完成");
		},
		async submitFavoriteTags(token, runCtx) {
			await this.requestSiteApi(SITE_ENDPOINTS.FAVORITE_TAGS, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: { tag_names: [] }
			}, runCtx, "SET_FAVORITE_TAGS");
			logInfo(runCtx, "SET_FAVORITE_TAGS", "首次引导-标签提交完成");
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
			logInfo(runCtx, "SET_FIRST_VISIT", "首次引导-is_first_visit 设置完成");
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
			logInfo(runCtx, "SET_HIDE_REFRESH_CONFIRM", "首次引导-hide_refresh_confirm 设置完成");
		},
		async skipFirstGuide(token, runCtx) {
			logInfo(runCtx, "SKIP_GUIDE", "开始跳过首次引导");
			await this.setAccountGender(token, runCtx);
			await this.submitFavoriteTags(token, runCtx);
			await this.setFirstVisitFlag(token, runCtx);
			await this.setHideRefreshConfirmFlag(token, runCtx);
			logInfo(runCtx, "SKIP_GUIDE", "首次引导跳过完成");
		},
		async pollVerificationCode(email, startTime, maxAttempts = 10, intervalMs = 2e3, runCtx) {
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				Sidebar.updateState({
					status: "fetching",
					statusMessage: `正在轮询验证码邮件... (${attempt}/${maxAttempts})`
				});
				logInfo(runCtx, "POLL_CODE", `轮询验证码第 ${attempt}/${maxAttempts} 次`);
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
						logInfo(runCtx, "POLL_CODE", `提取到验证码（第 ${attempt} 次轮询）`);
						logDebug(runCtx, "POLL_CODE", "验证码完整值", { code });
						return code;
					}
				}
				if (attempt < maxAttempts) {
					logWarn(runCtx, "POLL_CODE", `本轮未获取到验证码，${intervalMs}ms 后重试`);
					await delay(intervalMs);
				}
			}
			logError(runCtx, "POLL_CODE", "轮询窗口结束，仍未获取验证码");
			return null;
		},
		async startLegacyRegisterAssist() {
			const runCtx = createRunContext("LEGACY");
			let currentStep = "初始化";
			logInfo(runCtx, "START", "注册页模式：填表辅助 + 用户手动过验证码");
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
				logInfo(runCtx, "GENERATE", "生成注册信息完成", {
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
					logInfo(runCtx, "SEND_CODE", "已触发页面发送验证码按钮", { text: sendResult.text });
				} else {
					Sidebar.updateState({
						status: "waiting",
						statusMessage: "表单已填充，请手动点击发送验证码并完成人机验证",
						verificationCode: ""
					});
					Toast.warning("已填表，但未找到发送验证码按钮，请手动操作", 5e3);
					logWarn(runCtx, "SEND_CODE", "未找到发送验证码按钮");
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
			logInfo(runCtx, "GENERATE", `${flowName} 生成注册信息完成`, {
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
				logInfo(runCtx, "FORM", `${flowName} 验证码已自动填充到输入框`);
			} else {
				logWarn(runCtx, "FORM", `${flowName} 未找到验证码输入框，跳过自动填充`);
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
			logInfo(runCtx, "AUTH", `${flowName} 已写入 localStorage.console_token`);
			logDebug(runCtx, "AUTH", `${flowName} localStorage 写入 token 完整值`, { token });
			if (showStepToasts) {
				Toast.success(`${flowName}：注册成功，已写入 console_token`, 2400);
			}
			currentStep = "跳过首次引导";
			Sidebar.updateState({
				status: "fetching",
				statusMessage: `${flowName}：注册成功，正在跳过首次引导...`
			});
			let guideSkipped = true;
			try {
				await this.skipFirstGuide(token, runCtx);
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
		async fetchLatestConversationAnswer({ appId, conversationId, token, runCtx }) {
			const path = `${SITE_ENDPOINTS.INSTALLED_MESSAGES}/${appId}/messages?conversation_id=${encodeURIComponent(conversationId)}&limit=20&type=recent`;
			const payload = await this.requestSiteApi(path, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` }
			}, runCtx, "SWITCH_FETCH_MESSAGES");
			const messages = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.data) ? payload.data.data : [];
			if (!messages.length) {
				throw new Error("messages 接口未返回可用 data");
			}
			const sorted = [...messages].sort((a, b) => normalizeTimestamp(b?.created_at) - normalizeTimestamp(a?.created_at));
			for (const item of sorted) {
				const answer = item?.answer;
				if (isAnswerEmpty(answer)) {
					logWarn(runCtx, "SWITCH_FETCH_MESSAGES", "检测到空 answer，继续向后查找", {
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
			logInfo(runCtx, "SWITCH_GET_MODEL_CONFIG", "已读取旧账号 user_app_model_config", {
				appId,
				configType: Array.isArray(config) ? "array" : typeof config
			});
			logDebug(runCtx, "SWITCH_GET_MODEL_CONFIG", "user_app_model_config 详情", config);
			return config;
		},
		async saveUserAppModelConfig({ appId, token, config, runCtx }) {
			const path = `${SITE_ENDPOINTS.APPS}/${appId}/user_app_model_config`;
			await this.requestSiteApi(path, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: config
			}, runCtx, "SWITCH_POST_MODEL_CONFIG");
			logInfo(runCtx, "SWITCH_POST_MODEL_CONFIG", "新账号 user_app_model_config 已同步", {
				appId,
				configType: Array.isArray(config) ? "array" : typeof config
			});
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
			logInfo(runCtx, "SWITCH_CHAT", "开始请求 chat-messages", {
				path,
				conversationName,
				queryLength: query.length
			});
			logDebug(runCtx, "SWITCH_CHAT", "chat-messages 请求体", body);
			return new Promise((resolve, reject) => {
				let settled = false;
				const finishAndReload = (trigger, responseMeta = {}) => {
					if (settled) return;
					settled = true;
					const status = Number(responseMeta?.status || 0);
					const hasStatus = Number.isFinite(status) && status > 0;
					const isSuccess = hasStatus && status >= 200 && status < 300;
					const statusText = hasStatus ? `HTTP ${status}` : "未知状态";
					logInfo(runCtx, "SWITCH_CHAT", `chat-messages 已收到 ${trigger} 响应（${statusText}），1秒后刷新`, responseMeta);
					Sidebar.updateState({
						status: "success",
						statusMessage: `更换账号：chat-messages 已返回（${statusText}），1秒后刷新页面...`
					});
					Toast.info(`chat-messages 已收到${isSuccess ? "成功" : "失败"}响应（${statusText}），1秒后刷新`, 3500);
					setTimeout(() => {
						window.location.reload();
					}, 1e3);
					resolve({
						status,
						isSuccess
					});
				};
				gmXmlHttpRequest({
					method: "POST",
					url,
					headers: {
						"Content-Type": "application/json",
						"X-Language": X_LANGUAGE,
						Authorization: `Bearer ${token}`
					},
					data: JSON.stringify(body),
					timeout: 2e4,
					anonymous: true,
					onprogress: (response) => {
						if (settled) return;
						const status = Number(response?.status || 0);
						const textLength = (response?.responseText || "").length;
						if (status > 0 || textLength > 0) {
							finishAndReload("onprogress", {
								status,
								textLength
							});
						}
					},
					onload: (response) => {
						if (settled) return;
						const status = Number(response?.status || 0);
						const textLength = (response?.responseText || "").length;
						finishAndReload("onload", {
							status,
							textLength
						});
					},
					onerror: (error) => {
						if (settled) return;
						reject(new Error(error?.error || "chat-messages 网络请求失败"));
					},
					ontimeout: () => {
						if (settled) return;
						reject(new Error("chat-messages 请求超时"));
					},
					onabort: () => {
						if (settled) return;
						reject(new Error("chat-messages 请求被中止"));
					}
				});
			});
		},
		async startOneClickRegister() {
			const runCtx = createRunContext("REG");
			logInfo(runCtx, "START", "开始一键注册流程", {
				href: window.location.href,
				debugEnabled: isDebugEnabled()
			});
			try {
				await this.registerByApi(runCtx, {
					flowName: "一键注册",
					showStepToasts: true,
					markSuccess: true
				});
				logInfo(runCtx, "DONE", "一键注册流程完成");
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
				logWarn(runCtx, "PRECHECK", "重复触发更换账号，已拦截");
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
			logInfo(runCtx, "START", "开始更换账号流程", {
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
				const conversationId = this.readConversationIdByAppId(appId);
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：正在读取旧账号模型配置..."
				});
				Toast.info("更换账号：正在读取旧账号模型配置", 2200);
				const userModelConfig = await this.fetchUserAppModelConfig({
					appId,
					token: oldToken,
					runCtx
				});
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：正在读取旧会话最新消息..."
				});
				Toast.info("更换账号：正在提取旧会话最新回答", 2400);
				const latest = await this.fetchLatestConversationAnswer({
					appId,
					conversationId,
					token: oldToken,
					runCtx
				});
				const decodedAnswer = decodeEscapedText(latest.answer);
				if (!decodedAnswer.trim()) {
					throw new Error("最新消息 answer 解码后为空");
				}
				logInfo(runCtx, "SWITCH_FETCH_MESSAGES", "已提取旧会话最新消息", {
					appId,
					conversationId,
					createdAt: latest.createdAt,
					answerLength: decodedAnswer.length
				});
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
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：正在同步模型配置到新账号..."
				});
				Toast.info("更换账号：正在同步模型配置", 2200);
				await this.saveUserAppModelConfig({
					appId,
					token: registerResult.token,
					config: userModelConfig,
					runCtx
				});
				const query = `${decodedAnswer}\n\n${appendText}`;
				const conversationName = `新的对话-${randomConversationSuffix(3)}`;
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "更换账号：新账号已就绪，正在发送 chat-messages..."
				});
				Toast.info("更换账号：正在发送 chat-messages", 2200);
				await this.sendChatMessagesAndReload({
					appId,
					token: registerResult.token,
					query,
					conversationName,
					runCtx
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
			logInfo(runCtx, "START", "开始生成新邮箱");
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
				logInfo(runCtx, "DONE", "新邮箱生成成功", { email });
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
				logWarn(runCtx, "PRECHECK", "未找到当前邮箱，无法获取验证码");
				return;
			}
			const startTime = gmGetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, 0);
			try {
				Sidebar.updateState({
					status: "fetching",
					statusMessage: "正在获取验证码邮件..."
				});
				Toast.info("正在获取邮件...");
				logInfo(runCtx, "START", "手动获取验证码开始", {
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
					logWarn(runCtx, "DONE", "手动获取验证码未命中");
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
					logInfo(runCtx, "DONE", "验证码已填充");
				} else {
					Toast.success(`验证码: ${code}，请手动输入`, 5e3);
					logWarn(runCtx, "DONE", "找到验证码但未找到输入框");
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
	const IframeExtractor = {
		button: null,
		isDetailPage: false,
		checkDetailPage() {
			const urlPattern = /\/zh\/explore\/(?:test-)?installed\/[0-9a-f-]+$/i;
			return urlPattern.test(window.location.pathname);
		},
		findSrcdocIframe() {
			const iframes = document.querySelectorAll("iframe[srcdoc]");
			return iframes.length > 0 ? iframes[0] : null;
		},
		isExtractAvailable() {
			return this.checkDetailPage() && this.findSrcdocIframe() !== null;
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
			this.button.title = "提取 iframe 内容为 HTML 文件";
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
		extractAndSave() {
			const iframe = this.findSrcdocIframe();
			if (!iframe) {
				Toast.error("未找到包含 srcdoc 的 iframe");
				return;
			}
			const srcdoc = iframe.getAttribute("srcdoc");
			if (!srcdoc) {
				Toast.error("iframe 的 srcdoc 属性为空");
				return;
			}
			try {
				const textarea = document.createElement("textarea");
				textarea.innerHTML = srcdoc;
				const decodedHtml = textarea.value;
				const cleanTitle = this.getCleanTitle();
				const filename = `${cleanTitle}.html`;
				const blob = new Blob([decodedHtml], { type: "text/html;charset=utf-8" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = filename;
				a.style.display = "none";
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				Toast.success(`已保存为: ${filename}`);
			} catch (error) {
				Toast.error(`提取失败: ${error.message}`);
				console.error("[Iframe 提取器] 错误:", error);
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
			if (!this.isEnabled() || this.sortScheduled) return;
			this.sortScheduled = true;
			requestAnimationFrame(() => {
				this.sortScheduled = false;
				this.sortPopup();
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
			if (!popup) return;
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
    html.aifengyue-sidebar-inline-mode,
    body.aifengyue-sidebar-inline-mode {
        margin-right: 372px !important;
        transition: margin-right 0.3s var(--af-ease, ease);
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
        transition: width 0.25s ease, box-shadow 0.25s ease;
    }
    #aifengyue-sidebar-toggle:hover {
        width: 46px;
        box-shadow: -4px 0 28px rgba(99, 102, 241, 0.5);
    }
    #aifengyue-sidebar-toggle.hidden {
        transform: translateY(-50%) translateX(100%);
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
        grid-template-columns: repeat(3, 1fr);
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
    .aifengyue-input-group select {
        width: 100%;
        height: 36px;
        box-sizing: border-box;
        border: 1px solid var(--af-input-border);
        border-radius: var(--af-radius-sm);
        padding: 0 10px;
        font-size: 13px;
        font-family: var(--af-font);
        color: var(--af-text);
        background: var(--af-input-bg);
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
    }
    .aifengyue-input-group input:focus,
    .aifengyue-input-group select:focus {
        border-color: var(--af-primary);
        box-shadow: 0 0 0 3px var(--af-primary-glow);
    }
    .aifengyue-input-group input::placeholder {
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