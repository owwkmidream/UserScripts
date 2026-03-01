import { CONFIG, SIDEBAR_INITIAL_STATE } from '../constants.js';
import { APP_STATE } from '../state.js';
import { gmGetValue } from '../gm.js';
import { ApiService } from '../services/api-service.js';

function getToast() {
    return APP_STATE.refs.toast;
}

function getAutoRegister() {
    return APP_STATE.refs.autoRegister;
}

export const Sidebar = {
    element: null,
    isOpen: false,
    state: APP_STATE.sidebar.state,

    init() {
        if (this.element && document.body.contains(this.element) && document.getElementById('aifengyue-sidebar-toggle')) {
            return;
        }
        this.createSidebar();
        this.createToggleButton();
        this.loadSavedData();
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
                <h2>🤖 AI风月 注册助手</h2>
                <button class="aifengyue-sidebar-close">✕</button>
            </div>
            <div class="aifengyue-sidebar-content">
                <div class="aifengyue-section">
                    <div class="aifengyue-section-title">API 配置</div>
                    <div class="aifengyue-input-group">
                        <label>GPTMail API Key</label>
                        <input type="text" id="aifengyue-api-key" placeholder="输入你的 API Key (默认: gpt-test)">
                    </div>
                    <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-save-key">💾 保存 API Key</button>
                    <div class="aifengyue-usage-display" style="margin-top: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 12px; color: #8a8aaa;">API 配额使用情况</span>
                            <span id="aifengyue-usage-text" style="font-size: 12px; color: #a0a0c0;">0 / 1000</span>
                        </div>
                        <div style="height: 8px; background: #252540; border-radius: 4px; overflow: hidden;">
                            <div id="aifengyue-usage-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #10b981, #3b82f6); transition: width 0.3s ease;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-top: 6px;">
                            <span id="aifengyue-usage-remaining" style="font-size: 11px; color: #6a6a8a;">剩余: 1000 次</span>
                            <button id="aifengyue-reset-usage" style="font-size: 11px; color: #667eea; background: none; border: none; cursor: pointer; padding: 0;">重置统计</button>
                        </div>
                    </div>
                </div>

                <div class="aifengyue-divider"></div>

                <div class="aifengyue-section">
                    <div class="aifengyue-section-title">运行状态</div>
                    <div class="aifengyue-status-card">
                        <div class="aifengyue-status-indicator">
                            <div class="aifengyue-status-dot idle" id="aifengyue-status-dot"></div>
                            <span class="aifengyue-status-text" id="aifengyue-status-text">空闲</span>
                        </div>
                        <div class="aifengyue-status-message" id="aifengyue-status-message">等待操作...</div>
                    </div>
                </div>

                <div class="aifengyue-section">
                    <div class="aifengyue-section-title">生成信息</div>
                    <div class="aifengyue-status-card">
                        <div class="aifengyue-info-row">
                            <span class="aifengyue-info-label">📧 邮箱</span>
                            <span class="aifengyue-info-value" id="aifengyue-email">未生成</span>
                            <button class="aifengyue-copy-btn" data-copy="email">复制</button>
                        </div>
                        <div class="aifengyue-info-row">
                            <span class="aifengyue-info-label">👤 用户名</span>
                            <span class="aifengyue-info-value" id="aifengyue-username">未生成</span>
                            <button class="aifengyue-copy-btn" data-copy="username">复制</button>
                        </div>
                        <div class="aifengyue-info-row">
                            <span class="aifengyue-info-label">🔑 密码</span>
                            <span class="aifengyue-info-value" id="aifengyue-password">未生成</span>
                            <button class="aifengyue-copy-btn" data-copy="password">复制</button>
                        </div>
                        <div class="aifengyue-info-row">
                            <span class="aifengyue-info-label">🔢 验证码</span>
                            <span class="aifengyue-info-value code" id="aifengyue-code">等待中...</span>
                            <button class="aifengyue-copy-btn" data-copy="code">复制</button>
                        </div>
                    </div>
                </div>

                <div class="aifengyue-divider"></div>

                <div class="aifengyue-section">
                    <div class="aifengyue-section-title">操作</div>
                    <button class="aifengyue-btn aifengyue-btn-primary" id="aifengyue-start">
                        🚀 开始自动注册
                    </button>
                    <div class="aifengyue-btn-group">
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-refresh-email">
                            🔄 换邮箱
                        </button>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-fetch-code">
                            📩 获取验证码
                        </button>
                    </div>
                    <div class="aifengyue-hint" style="margin-top: 12px; font-size: 12px; color: #8a8aaa; line-height: 1.6;">
                        💡 提示：点击"开始自动注册"后，脚本会自动点击"发送验证码"按钮，并在 2 秒后自动获取验证码。您只需完成人机验证即可。如果自动获取失败，可手动点击"获取验证码"重试。
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
        btn.textContent = '注册助手';
        btn.addEventListener('click', () => this.toggle());
        document.body.appendChild(btn);
    },

    bindEvents() {
        this.element.querySelector('.aifengyue-sidebar-close').addEventListener('click', () => this.close());

        this.element.querySelector('#aifengyue-save-key').addEventListener('click', () => {
            const input = this.element.querySelector('#aifengyue-api-key');
            const key = input.value.trim() || CONFIG.DEFAULT_API_KEY;
            ApiService.setApiKey(key);
            getToast()?.success('API Key 已保存');
        });

        this.element.querySelector('#aifengyue-start').addEventListener('click', () => {
            getAutoRegister()?.start();
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
    },

    loadSavedData() {
        const apiKey = gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, '');
        if (apiKey) {
            this.element.querySelector('#aifengyue-api-key').value = apiKey;
        }
        this.updateUsageDisplay();
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
                usageBar.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
            } else if (percentage >= 70) {
                usageBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
            } else {
                usageBar.style.background = 'linear-gradient(90deg, #10b981, #3b82f6)';
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
        if (toggle) toggle.classList.add('hidden');
        this.isOpen = true;
    },

    close() {
        if (!this.element) return;
        this.element.classList.remove('open');
        const toggle = document.getElementById('aifengyue-sidebar-toggle');
        if (toggle) toggle.classList.remove('hidden');
        this.isOpen = false;
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
            fetching: { text: '获取验证码...', color: 'polling' },
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
    },
};
