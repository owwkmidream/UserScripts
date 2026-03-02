import { CONFIG, SIDEBAR_INITIAL_STATE } from '../constants.js';
import { APP_STATE } from '../state.js';
import { gmGetValue, gmSetValue } from '../gm.js';
import { ApiService } from '../services/api-service.js';

const VALID_TABS = ['register', 'tools', 'settings'];

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

export const Sidebar = {
    element: null,
    isOpen: false,
    layoutMode: 'inline',
    activeTab: 'register',
    theme: 'light',
    state: APP_STATE.sidebar.state,

    init() {
        if (this.element && document.body.contains(this.element) && document.getElementById('aifengyue-sidebar-toggle')) {
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
        const existing = document.getElementById('aifengyue-sidebar');
        if (existing) {
            existing.remove();
        }

        this.element = document.createElement('div');
        this.element.id = 'aifengyue-sidebar';
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
        const existing = document.getElementById('aifengyue-sidebar-toggle');
        if (existing) {
            existing.remove();
        }
        const btn = document.createElement('button');
        btn.id = 'aifengyue-sidebar-toggle';
        btn.textContent = '打开助手';
        btn.addEventListener('click', () => this.toggle());
        document.body.appendChild(btn);
    },

    bindEvents() {
        this.element.querySelector('.aifengyue-sidebar-close').addEventListener('click', () => this.close());
        this.element.querySelector('.aifengyue-theme-toggle').addEventListener('click', () => this.toggleTheme());

        this.element.querySelectorAll('.aifengyue-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.setActiveTab(btn.dataset.tab);
            });
        });

        this.element.querySelector('#aifengyue-save-key').addEventListener('click', () => {
            const input = this.element.querySelector('#aifengyue-api-key');
            const key = input.value.trim() || CONFIG.DEFAULT_API_KEY;
            ApiService.setApiKey(key);
            getToast()?.success('API Key 已保存');
        });

        this.element.querySelector('#aifengyue-layout-mode').addEventListener('change', (e) => {
            const mode = e.target.value;
            this.setLayoutMode(mode);
            getToast()?.info(`侧边栏已切换为${mode === 'inline' ? '插入模式' : '悬浮模式'}`);
        });

        this.element.querySelector('#aifengyue-start').addEventListener('click', () => {
            getAutoRegister()?.start();
        });

        this.element.querySelector('#aifengyue-start-oneclick').addEventListener('click', () => {
            getAutoRegister()?.startOneClickRegister();
        });

        this.element.querySelector('#aifengyue-switch-account').addEventListener('click', () => {
            const input = this.element.querySelector('#aifengyue-switch-text');
            const extraText = input?.value?.trim() || '';
            getAutoRegister()?.switchAccount(extraText);
        });

        this.element.querySelector('#aifengyue-refresh-email').addEventListener('click', () => {
            getAutoRegister()?.generateNewEmail();
        });

        this.element.querySelector('#aifengyue-fetch-code').addEventListener('click', () => {
            getAutoRegister()?.fetchVerificationCode();
        });

        this.element.querySelectorAll('.aifengyue-copy-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const type = e.target.dataset.copy;
                let value = '';
                switch (type) {
                    case 'email': value = this.state.email; break;
                    case 'username': value = this.state.username; break;
                    case 'password': value = this.state.password; break;
                    case 'code': value = this.state.verificationCode; break;
                }
                if (value) {
                    navigator.clipboard.writeText(value).then(() => {
                        getToast()?.success('已复制到剪贴板');
                    }).catch(() => {
                        getToast()?.error('复制失败');
                    });
                }
            });
        });

        this.element.querySelector('#aifengyue-reset-usage').addEventListener('click', () => {
            if (confirm('确定要重置 API 使用统计吗？')) {
                ApiService.resetUsageCount();
                getToast()?.success('统计已重置');
            }
        });

        this.element.querySelector('#aifengyue-extract-html').addEventListener('click', () => {
            const extractor = getIframeExtractor();
            if (!extractor) return;
            if (!extractor.isExtractAvailable()) {
                getToast()?.warning('当前页面没有可提取的 iframe srcdoc');
                this.updateToolPanel();
                return;
            }
            extractor.extractAndSave();
            this.updateToolPanel();
        });

        this.element.querySelector('#aifengyue-sort-now').addEventListener('click', () => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            sorter.sortPopup();
            getToast()?.info('已触发一次模型排序');
        });

        this.element.querySelector('#aifengyue-sort-toggle').addEventListener('change', (e) => {
            const sorter = getModelPopupSorter();
            if (!sorter) return;
            sorter.setSortEnabled(!!e.target.checked);
            getToast()?.info(`自动排序已${e.target.checked ? '开启' : '关闭'}`);
        });
    },

    loadSavedData() {
        const apiKey = gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, '');
        if (apiKey) {
            this.element.querySelector('#aifengyue-api-key').value = apiKey;
        }

        const layoutModeInput = this.element.querySelector('#aifengyue-layout-mode');
        if (layoutModeInput) {
            layoutModeInput.value = this.layoutMode;
        }

        this.updateUsageDisplay();
        this.render();
    },

    setActiveTab(tab) {
        if (!VALID_TABS.includes(tab)) return;
        this.activeTab = tab;

        this.element.querySelectorAll('.aifengyue-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === this.activeTab);
        });

        this.element.querySelectorAll('.aifengyue-panel').forEach((panel) => {
            panel.classList.toggle('active', panel.dataset.panel === this.activeTab);
        });
    },

    getLayoutMode() {
        const mode = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_LAYOUT_MODE, 'inline');
        return mode === 'floating' ? 'floating' : 'inline';
    },

    setLayoutMode(mode) {
        this.layoutMode = mode === 'floating' ? 'floating' : 'inline';
        gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_LAYOUT_MODE, this.layoutMode);
        this.applyLayoutModeClass();
    },

    getTheme() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.SIDEBAR_THEME, 'light');
        return saved === 'dark' ? 'dark' : 'light';
    },

    setTheme(theme) {
        this.theme = theme === 'dark' ? 'dark' : 'light';
        gmSetValue(CONFIG.STORAGE_KEYS.SIDEBAR_THEME, this.theme);
        this.applyTheme();
    },

    applyTheme() {
        if (!this.element) return;
        this.element.dataset.theme = this.theme;
        const btn = this.element.querySelector('.aifengyue-theme-toggle');
        if (btn) btn.textContent = this.theme === 'dark' ? '☀' : '🌙';
    },

    toggleTheme() {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    },

    applyLayoutModeClass() {
        if (!this.element) return;

        const isInline = this.layoutMode === 'inline';
        this.element.classList.toggle('mode-inline', isInline);
        this.element.classList.toggle('mode-floating', !isInline);

        const modeInput = this.element.querySelector('#aifengyue-layout-mode');
        if (modeInput) {
            modeInput.value = this.layoutMode;
        }

        this.syncInlineSpaceClass();
    },

    syncInlineSpaceClass() {
        const isInlineOpen = this.layoutMode === 'inline' && this.isOpen;
        document.documentElement.classList.remove('aifengyue-sidebar-inline-mode');
        document.body.classList.toggle('aifengyue-sidebar-inline-mode', isInlineOpen);
    },

    updateUsageDisplay() {
        if (!this.element) return;

        const used = ApiService.getUsageCount();
        const limit = CONFIG.API_QUOTA_LIMIT;
        const remaining = ApiService.getRemainingQuota();
        const percentage = Math.min((used / limit) * 100, 100);

        const usageText = this.element.querySelector('#aifengyue-usage-text');
        const usageBar = this.element.querySelector('#aifengyue-usage-bar');
        const usageRemaining = this.element.querySelector('#aifengyue-usage-remaining');

        if (usageText) usageText.textContent = `${used} / ${limit}`;
        if (usageBar) {
            usageBar.style.width = `${percentage}%`;
            if (percentage >= 90) {
                usageBar.style.background = 'linear-gradient(90deg, #dc2626, #b91c1c)';
            } else if (percentage >= 70) {
                usageBar.style.background = 'linear-gradient(90deg, #d97706, #b45309)';
            } else {
                usageBar.style.background = 'linear-gradient(90deg, #0d9488, #14b8a6)';
            }
        }
        if (usageRemaining) usageRemaining.textContent = `剩余: ${remaining} 次`;
    },

    toggle() {
        this.isOpen ? this.close() : this.open();
    },

    open() {
        if (!this.element) return;
        this.element.classList.add('open');
        const toggle = document.getElementById('aifengyue-sidebar-toggle');
        if (toggle) {
            toggle.classList.add('hidden');
            toggle.textContent = '收起助手';
        }
        this.isOpen = true;
        this.syncInlineSpaceClass();
    },

    close() {
        if (!this.element) return;
        this.element.classList.remove('open');
        const toggle = document.getElementById('aifengyue-sidebar-toggle');
        if (toggle) {
            toggle.classList.remove('hidden');
            toggle.textContent = '打开助手';
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
            idle: { text: '空闲', color: 'idle' },
            generating: { text: '生成中...', color: 'generating' },
            waiting: { text: '等待操作', color: 'polling' },
            fetching: { text: '执行中...', color: 'polling' },
            success: { text: '成功', color: 'success' },
            error: { text: '错误', color: 'error' },
        };

        const status = statusMap[this.state.status] || statusMap.idle;

        const dot = this.element.querySelector('#aifengyue-status-dot');
        if (dot) {
            dot.className = `aifengyue-status-dot ${status.color}`;
        }

        const statusText = this.element.querySelector('#aifengyue-status-text');
        const statusMessage = this.element.querySelector('#aifengyue-status-message');
        const email = this.element.querySelector('#aifengyue-email');
        const username = this.element.querySelector('#aifengyue-username');
        const password = this.element.querySelector('#aifengyue-password');
        const code = this.element.querySelector('#aifengyue-code');

        if (statusText) statusText.textContent = status.text;
        if (statusMessage) statusMessage.textContent = this.state.statusMessage;
        if (email) email.textContent = this.state.email || '未生成';
        if (username) username.textContent = this.state.username || '未生成';
        if (password) password.textContent = this.state.password || '未生成';
        if (code) code.textContent = this.state.verificationCode || '等待中...';

        this.updateToolPanel();
    },

    updateToolPanel() {
        if (!this.element) return;

        const autoRegister = getAutoRegister();
        const extractor = getIframeExtractor();
        const sorter = getModelPopupSorter();

        const startBtn = this.element.querySelector('#aifengyue-start');
        const manualGroup = this.element.querySelector('#aifengyue-manual-group');
        const registerHint = this.element.querySelector('#aifengyue-register-hint');

        const onRegisterPage = !!autoRegister?.isRegisterPage();
        if (startBtn) {
            startBtn.textContent = onRegisterPage ? '📝 开始辅助填表' : '🚀 开始注册（自动模式）';
        }
        if (manualGroup) {
            manualGroup.style.display = onRegisterPage ? '' : 'none';
        }
        if (registerHint) {
            registerHint.textContent = onRegisterPage
                ? '当前注册页：可辅助填表，验证码需手动完成。'
                : '非注册页：可用一键注册或更换账号。';
        }

        const isDetail = !!extractor?.checkDetailPage();
        const canExtract = !!extractor?.isExtractAvailable();

        const extractWrap = this.element.querySelector('#aifengyue-extract-html-wrap');
        const sortWrap = this.element.querySelector('#aifengyue-sort-wrap');
        const toolsEmpty = this.element.querySelector('#aifengyue-tools-empty');
        const sortToggle = this.element.querySelector('#aifengyue-sort-toggle');

        if (extractWrap) {
            extractWrap.style.display = canExtract ? '' : 'none';
        }
        if (sortWrap) {
            sortWrap.style.display = isDetail ? '' : 'none';
        }
        if (toolsEmpty) {
            toolsEmpty.style.display = (!canExtract && !isDetail) ? '' : 'none';
        }
        if (sortToggle) {
            sortToggle.checked = sorter?.isSortEnabled?.() ?? true;
        }
    },
};
