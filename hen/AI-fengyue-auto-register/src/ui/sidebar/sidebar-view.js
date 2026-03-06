import { subscribeRuntimeLogChange } from '../../utils/logger.js';
import { VALID_TABS } from './sidebar-context.js';

export const sidebarViewMethods = {
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
        const existing = document.getElementById('aifengyue-conversation-modal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'aifengyue-conversation-modal';
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

        const closeBtn = modal.querySelector('#aifengyue-conversation-modal-close');
        closeBtn?.addEventListener('click', () => this.closeConversationModal());

        if (this.conversationModalEscHandler) {
            document.removeEventListener('keydown', this.conversationModalEscHandler);
        }
        this.conversationModalEscHandler = (event) => {
            if (event.key === 'Escape' && this.conversationModalOpen) {
                this.closeConversationModal();
            }
        };
        document.addEventListener('keydown', this.conversationModalEscHandler);
    },

    openConversationModal() {
        if (!this.conversationModal) {
            this.createConversationModal();
        }
        if (!this.conversationModal) return;
        this.conversationModal.classList.add('open');
        this.conversationModalOpen = true;
    },

    closeConversationModal() {
        if (!this.conversationModal) return;
        this.conversationModal.classList.remove('open');
        this.conversationModalOpen = false;
    },

    createTokenPoolLogModal() {
        const existing = document.getElementById('aifengyue-token-pool-log-modal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'aifengyue-token-pool-log-modal';
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

        modal.querySelector('#aifengyue-token-pool-log-modal-close')
            ?.addEventListener('click', () => this.closeTokenPoolLogModal());
        modal.querySelector('#aifengyue-token-pool-log-refresh')
            ?.addEventListener('click', () => this.renderTokenPoolLogModal());
        modal.querySelector('#aifengyue-token-pool-log-clear')
            ?.addEventListener('click', () => this.clearTokenPoolLogs());

        if (typeof this.tokenPoolLogUnsubscribe === 'function') {
            this.tokenPoolLogUnsubscribe();
            this.tokenPoolLogUnsubscribe = null;
        }
        this.tokenPoolLogUnsubscribe = subscribeRuntimeLogChange(() => {
            if (this.tokenPoolLogModalOpen) {
                this.renderTokenPoolLogModal();
            }
        });

        if (this.tokenPoolLogModalEscHandler) {
            document.removeEventListener('keydown', this.tokenPoolLogModalEscHandler);
        }
        this.tokenPoolLogModalEscHandler = (event) => {
            if (event.key === 'Escape' && this.tokenPoolLogModalOpen) {
                this.closeTokenPoolLogModal();
            }
        };
        document.addEventListener('keydown', this.tokenPoolLogModalEscHandler);
    },

    openTokenPoolLogModal() {
        if (!this.tokenPoolLogModal) {
            this.createTokenPoolLogModal();
        }
        if (!this.tokenPoolLogModal) return;
        this.tokenPoolLogModal.classList.add('open');
        this.tokenPoolLogModalOpen = true;
        this.renderTokenPoolLogModal();
    },

    closeTokenPoolLogModal() {
        if (!this.tokenPoolLogModal) return;
        this.tokenPoolLogModal.classList.remove('open');
        this.tokenPoolLogModalOpen = false;
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

    setActiveTab(tab) {
        if (!VALID_TABS.includes(tab)) return;
        this.activeTab = tab;

        this.element.querySelectorAll('.aifengyue-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === this.activeTab);
        });

        this.element.querySelectorAll('.aifengyue-panel').forEach((panel) => {
            panel.classList.toggle('active', panel.dataset.panel === this.activeTab);
        });

        if (this.activeTab === 'conversation') {
            this.refreshConversationPanel({ showToast: false, keepSelection: true }).catch((error) => {
                this.setConversationStatus(`会话面板刷新失败: ${error.message}`);
            });
        }
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

    toggle() {
        this.isOpen ? this.close() : this.open();
    },

    open() {
        if (!this.element) return;
        this.element.classList.add('open');
        const toggle = document.getElementById('aifengyue-sidebar-toggle');
        if (toggle) {
            toggle.classList.add('is-open');
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
            toggle.classList.remove('is-open');
            toggle.textContent = '打开助手';
        }
        this.isOpen = false;
        this.syncInlineSpaceClass();
    },
};
