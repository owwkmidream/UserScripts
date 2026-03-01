// ==UserScript==
// @name         AI风月 自动注册助手
// @namespace    https://github.com/owwkmidream/UserScripts
// @version      1.4.0
// @description  自动生成临时邮箱、账户名和密码，自动获取验证码，完成 AI风月 网站注册
// @author       owwkmidream
// @match        https://dearestie.xyz/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=dearestie.xyz
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      mail.chatgpt.org.uk
// @license      MIT
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置常量 ====================
    const CONFIG = {
        API_BASE: 'https://mail.chatgpt.org.uk/api',
        DEFAULT_API_KEY: 'gpt-test',
        STORAGE_KEYS: {
            API_KEY: 'gptmail_api_key',
            CURRENT_EMAIL: 'current_temp_email',
            GENERATED_PASSWORD: 'generated_password',
            GENERATED_USERNAME: 'generated_username',
            REGISTRATION_START_TIME: 'registration_start_time',
            API_USAGE_COUNT: 'api_usage_count', // API 调用次数
            API_USAGE_RESET_DATE: 'api_usage_reset_date' // 重置日期
        },
        API_QUOTA_LIMIT: 1000, // API 配额上限
        // 验证码提取正则（按优先级排列）
        VERIFICATION_CODE_PATTERNS: [
            /验证码[：:]\s*(\d{4,8})/,
            /code[：:]\s*(\d{4,8})/i,
            /(\d{4,8})\s*(?:是|为)?(?:您的)?验证码/,
            /Your (?:verification )?code is[：:\s]*(\d{4,8})/i,
            /完成注册[：:]\s*(\d{4,8})/,
            /registration[：:\s]*(\d{4,8})/i
        ]
    };

    // ==================== 工具函数 ====================
    const Utils = {
        // 生成随机字符串
        randomString(length, charset = 'abcdefghijklmnopqrstuvwxyz0123456789') {
            let result = '';
            for (let i = 0; i < length; i++) {
                result += charset.charAt(Math.floor(Math.random() * charset.length));
            }
            return result;
        },

        // 生成随机用户名
        generateUsername() {
            const prefixes = ['user', 'ai', 'cat', 'test', 'demo', 'new', 'cool', 'pro', 'dev', 'fan'];
            const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            return prefix + this.randomString(6, 'abcdefghijklmnopqrstuvwxyz0123456789');
        },

        // 生成随机密码 (字母+数字，长度>=8)
        generatePassword() {
            const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const digits = '0123456789';
            // 确保至少有字母和数字
            let password = this.randomString(4, letters) + this.randomString(4, digits);
            // 打乱顺序
            password = password.split('').sort(() => Math.random() - 0.5).join('');
            return password;
        },

        // 延迟函数
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        /**
         * 从邮件内容中提取验证码
         * 使用多种策略避免误匹配 CSS 颜色值等
         */
        extractVerificationCode(content) {
            if (!content) return null;

            // 策略1：先尝试用正则模式匹配纯文本中的验证码
            // 提取纯文本（去除 HTML 但保留文本内容）
            const plainText = this.extractPlainText(content);

            for (const pattern of CONFIG.VERIFICATION_CODE_PATTERNS) {
                const match = plainText.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            // 策略2：解析 HTML，查找特定样式的元素（通常验证码会用大字体显示）
            const codeFromHtml = this.extractCodeFromHtml(content);
            if (codeFromHtml) {
                return codeFromHtml;
            }

            // 策略3：从纯文本中查找独立的 6 位数字（排除已识别的颜色值等）
            const standaloneCode = this.findStandaloneCode(plainText);
            if (standaloneCode) {
                return standaloneCode;
            }

            return null;
        },

        /**
         * 从 HTML 中提取纯文本
         */
        extractPlainText(html) {
            // 移除 style 标签及其内容
            let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
            // 移除 script 标签及其内容
            text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            // 移除所有 HTML 标签但保留内容
            text = text.replace(/<[^>]+>/g, ' ');
            // 移除 HTML 实体
            text = text.replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ');
            // 规范化空白字符
            text = text.replace(/\s+/g, ' ').trim();
            return text;
        },

        /**
         * 从 HTML 结构中提取验证码
         * 通常验证码会以大字体、特殊样式显示
         */
        extractCodeFromHtml(html) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // 查找可能包含验证码的元素（字体大小 >= 24px 的纯数字内容）
                const candidates = [];

                // 查找所有 td, span, div, p 元素
                const elements = doc.querySelectorAll('td, span, div, p, strong, b');
                for (const el of elements) {
                    const text = el.textContent.trim();
                    // 只包含 4-8 位数字
                    if (/^\d{4,8}$/.test(text)) {
                        // 检查样式
                        const style = el.getAttribute('style') || '';
                        const fontSize = style.match(/font-size:\s*(\d+)/i);
                        const fontWeight = style.match(/font-weight:\s*(bold|\d+)/i);

                        let score = 0;
                        // 字体大小越大，得分越高
                        if (fontSize) {
                            const size = parseInt(fontSize[1]);
                            if (size >= 28) score += 10;
                            else if (size >= 20) score += 5;
                            else if (size >= 16) score += 2;
                        }
                        // 粗体加分
                        if (fontWeight) {
                            score += 3;
                        }
                        // 6位数字验证码最常见
                        if (text.length === 6) {
                            score += 2;
                        }

                        if (score > 0) {
                            candidates.push({ code: text, score });
                        }
                    }
                }

                // 按得分排序，返回最高分的
                if (candidates.length > 0) {
                    candidates.sort((a, b) => b.score - a.score);
                    return candidates[0].code;
                }
            } catch (e) {
                console.error('[验证码提取] HTML 解析失败:', e);
            }
            return null;
        },

        /**
         * 从纯文本中查找独立的验证码数字
         * 排除可能是颜色值、尺寸值等的数字
         */
        findStandaloneCode(text) {
            // 匹配所有 4-8 位数字
            const matches = text.match(/\b(\d{4,8})\b/g);
            if (!matches) return null;

            // 过滤掉可能是其他用途的数字
            const validCodes = matches.filter(code => {
                // 排除看起来像颜色值的（通常围绕 # 出现，但纯文本已移除 #）
                // 排除常见的非验证码数字模式
                // 验证码通常是 4-8 位，最常见是 6 位

                // 如果只有一个匹配，直接返回
                if (matches.length === 1) return true;

                // 优先返回 6 位数字
                if (code.length === 6) return true;

                return false;
            });

            // 优先返回 6 位的
            const sixDigit = validCodes.find(c => c.length === 6);
            if (sixDigit) return sixDigit;

            // 否则返回第一个
            return validCodes[0] || null;
        }
    };

    // ==================== API 服务 ====================
    const ApiService = {
        getApiKey() {
            return GM_getValue(CONFIG.STORAGE_KEYS.API_KEY, CONFIG.DEFAULT_API_KEY);
        },

        setApiKey(key) {
            GM_setValue(CONFIG.STORAGE_KEYS.API_KEY, key);
            // 切换 Key 时重置统计
            this.resetUsageCount();
        },

        // 获取 API 使用次数
        getUsageCount() {
            return GM_getValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, 0);
        },

        // 增加 API 使用次数
        incrementUsageCount() {
            const count = this.getUsageCount() + 1;
            GM_setValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, count);

            // 更新侧边栏显示
            if (Sidebar.element) {
                Sidebar.updateUsageDisplay();
            }

            return count;
        },

        // 重置 API 使用次数
        resetUsageCount() {
            GM_setValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, 0);
            GM_setValue(CONFIG.STORAGE_KEYS.API_USAGE_RESET_DATE, new Date().toISOString());

            if (Sidebar.element) {
                Sidebar.updateUsageDisplay();
            }
        },

        // 获取剩余配额
        getRemainingQuota() {
            return CONFIG.API_QUOTA_LIMIT - this.getUsageCount();
        },

        // 检查是否超出配额
        isQuotaExceeded() {
            return this.getUsageCount() >= CONFIG.API_QUOTA_LIMIT;
        },

        // 发起 API 请求
        request(endpoint, options = {}) {
            return new Promise((resolve, reject) => {
                // 检查配额
                if (this.isQuotaExceeded()) {
                    reject(new Error(`API 配额已用完 (${this.getUsageCount()}/${CONFIG.API_QUOTA_LIMIT})`));
                    return;
                }

                const url = `${CONFIG.API_BASE}${endpoint}`;
                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    headers: {
                        'X-API-Key': this.getApiKey(),
                        'Content-Type': 'application/json',
                        ...options.headers
                    },
                    data: options.body ? JSON.stringify(options.body) : undefined,
                    onload: (response) => {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.success) {
                                // 请求成功，增加计数
                                this.incrementUsageCount();
                                resolve(data.data);
                            } else {
                                reject(new Error(data.error || '请求失败'));
                            }
                        } catch (e) {
                            reject(new Error('解析响应失败'));
                        }
                    },
                    onerror: (error) => {
                        reject(new Error('网络请求失败'));
                    }
                });
            });
        },

        // 生成临时邮箱
        async generateEmail() {
            const data = await this.request('/generate-email');
            return data.email;
        },

        // 获取邮件列表
        async getEmails(email) {
            const data = await this.request(`/emails?email=${encodeURIComponent(email)}`);
            return data.emails || [];
        }
    };

    // ==================== Toast 通知系统 ====================
    const Toast = {
        container: null,

        init() {
            if (this.container) return;

            this.container = document.createElement('div');
            this.container.id = 'aifengyue-toast-container';
            document.body.appendChild(this.container);

            GM_addStyle(`
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

        show(message, type = 'info', duration = 3000) {
            this.init();

            const toast = document.createElement('div');
            toast.className = `aifengyue-toast ${type}`;
            toast.textContent = message;
            this.container.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('out');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        },

        success(msg, duration) { this.show(msg, 'success', duration); },
        error(msg, duration) { this.show(msg, 'error', duration); },
        info(msg, duration) { this.show(msg, 'info', duration); },
        warning(msg, duration) { this.show(msg, 'warning', duration); }
    };

    // ==================== 侧边栏 UI ====================
    const Sidebar = {
        element: null,
        isOpen: false,
        state: {
            email: '',
            username: '',
            password: '',
            status: 'idle', // idle, generating, polling, success, error
            statusMessage: '等待操作...',
            pollCount: 0,
            verificationCode: ''
        },

        init() {
            this.createStyles();
            this.createSidebar();
            this.createToggleButton();
            this.loadSavedData();
        },

        createStyles() {
            GM_addStyle(`
                #aifengyue-sidebar-toggle {
                    position: fixed;
                    right: 0;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 40px;
                    height: 100px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border: none;
                    border-radius: 8px 0 0 8px;
                    cursor: pointer;
                    z-index: 2147483645;
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
                #aifengyue-sidebar-toggle:hover {
                    width: 50px;
                    background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
                }
                #aifengyue-sidebar-toggle.hidden {
                    transform: translateY(-50%) translateX(100%);
                }

                #aifengyue-sidebar {
                    position: fixed;
                    right: -400px;
                    top: 0;
                    width: 380px;
                    height: 100vh;
                    background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
                    z-index: 2147483646;
                    transition: right 0.3s ease;
                    box-shadow: -5px 0 30px rgba(0, 0, 0, 0.5);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #e0e0e0;
                    overflow-y: auto;
                }
                #aifengyue-sidebar.open {
                    right: 0;
                }

                .aifengyue-sidebar-header {
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .aifengyue-sidebar-header h2 {
                    margin: 0;
                    font-size: 18px;
                    color: #fff;
                }
                .aifengyue-sidebar-close {
                    background: rgba(255,255,255,0.2);
                    border: none;
                    color: #fff;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    cursor: pointer;
                    font-size: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s;
                }
                .aifengyue-sidebar-close:hover {
                    background: rgba(255,255,255,0.3);
                }

                .aifengyue-sidebar-content {
                    padding: 20px;
                }

                .aifengyue-section {
                    margin-bottom: 24px;
                }
                .aifengyue-section-title {
                    font-size: 14px;
                    color: #a0a0a0;
                    margin-bottom: 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .aifengyue-section-title::before {
                    content: '';
                    width: 4px;
                    height: 16px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    border-radius: 2px;
                }

                .aifengyue-input-group {
                    margin-bottom: 16px;
                }
                .aifengyue-input-group label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 13px;
                    color: #b0b0b0;
                }
                .aifengyue-input-group input {
                    width: 100%;
                    padding: 10px 14px;
                    border: 1px solid #3a3a5a;
                    border-radius: 8px;
                    background: #252540;
                    color: #e0e0e0;
                    font-size: 14px;
                    transition: border-color 0.2s, box-shadow 0.2s;
                    box-sizing: border-box;
                }
                .aifengyue-input-group input:focus {
                    outline: none;
                    border-color: #667eea;
                    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
                }
                .aifengyue-input-group input::placeholder {
                    color: #6a6a8a;
                }

                .aifengyue-btn {
                    padding: 12px 20px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                    transition: all 0.2s;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }
                .aifengyue-btn-primary {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: #fff;
                    width: 100%;
                }
                .aifengyue-btn-primary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                }
                .aifengyue-btn-primary:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none;
                }
                .aifengyue-btn-secondary {
                    background: #3a3a5a;
                    color: #e0e0e0;
                }
                .aifengyue-btn-secondary:hover {
                    background: #4a4a6a;
                }
                .aifengyue-btn-danger {
                    background: linear-gradient(135deg, #ef4444, #dc2626);
                    color: #fff;
                }

                .aifengyue-btn-group {
                    display: flex;
                    gap: 10px;
                    margin-top: 12px;
                }
                .aifengyue-btn-group .aifengyue-btn {
                    flex: 1;
                }

                .aifengyue-status-card {
                    background: #252540;
                    border-radius: 12px;
                    padding: 16px;
                    margin-bottom: 16px;
                }
                .aifengyue-status-indicator {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 10px;
                }
                .aifengyue-status-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    animation: pulse 1.5s infinite;
                }
                .aifengyue-status-dot.idle { background: #6b7280; animation: none; }
                .aifengyue-status-dot.generating { background: #f59e0b; }
                .aifengyue-status-dot.polling { background: #3b82f6; }
                .aifengyue-status-dot.success { background: #10b981; animation: none; }
                .aifengyue-status-dot.error { background: #ef4444; animation: none; }

                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.1); }
                }

                .aifengyue-status-text {
                    font-size: 14px;
                    font-weight: 500;
                }
                .aifengyue-status-message {
                    font-size: 13px;
                    color: #8a8aaa;
                    margin-top: 8px;
                    padding: 10px;
                    background: #1a1a30;
                    border-radius: 6px;
                    word-break: break-all;
                }

                .aifengyue-info-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 0;
                    border-bottom: 1px solid #3a3a5a;
                }
                .aifengyue-info-row:last-child {
                    border-bottom: none;
                }
                .aifengyue-info-label {
                    font-size: 13px;
                    color: #8a8aaa;
                }
                .aifengyue-info-value {
                    font-size: 13px;
                    color: #e0e0e0;
                    font-family: 'Consolas', monospace;
                    max-width: 200px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .aifengyue-info-value.code {
                    color: #10b981;
                    font-weight: bold;
                    font-size: 16px;
                }

                .aifengyue-copy-btn {
                    background: transparent;
                    border: 1px solid #4a4a6a;
                    color: #a0a0c0;
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    margin-left: 8px;
                    transition: all 0.2s;
                }
                .aifengyue-copy-btn:hover {
                    background: #4a4a6a;
                    color: #fff;
                }

                .aifengyue-divider {
                    height: 1px;
                    background: linear-gradient(90deg, transparent, #4a4a6a, transparent);
                    margin: 20px 0;
                }

                .aifengyue-footer {
                    padding: 16px 20px;
                    background: #151525;
                    font-size: 12px;
                    color: #6a6a8a;
                    text-align: center;
                }
                .aifengyue-footer a {
                    color: #667eea;
                    text-decoration: none;
                }
                .aifengyue-footer a:hover {
                    text-decoration: underline;
                }
            `);
        },

        createSidebar() {
            this.element = document.createElement('div');
            this.element.id = 'aifengyue-sidebar';
            this.element.innerHTML = `
                <div class="aifengyue-sidebar-header">
                    <h2>🤖 AI风月 注册助手</h2>
                    <button class="aifengyue-sidebar-close">✕</button>
                </div>
                <div class="aifengyue-sidebar-content">
                    <!-- API Key 配置 -->
                    <div class="aifengyue-section">
                        <div class="aifengyue-section-title">API 配置</div>
                        <div class="aifengyue-input-group">
                            <label>GPTMail API Key</label>
                            <input type="text" id="aifengyue-api-key" placeholder="输入你的 API Key (默认: gpt-test)">
                        </div>
                        <button class="aifengyue-btn aifengyue-btn-secondary" id="aifengyue-save-key">💾 保存 API Key</button>
                        <!-- API 配额可视化 -->
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

                    <!-- 运行状态 -->
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

                    <!-- 生成的信息 -->
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

                    <!-- 操作按钮 -->
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

            // 绑定事件
            this.bindEvents();
        },

        createToggleButton() {
            const btn = document.createElement('button');
            btn.id = 'aifengyue-sidebar-toggle';
            btn.textContent = '注册助手';
            btn.addEventListener('click', () => this.toggle());
            document.body.appendChild(btn);
        },

        bindEvents() {
            // 关闭按钮
            this.element.querySelector('.aifengyue-sidebar-close').addEventListener('click', () => this.close());

            // 保存 API Key
            this.element.querySelector('#aifengyue-save-key').addEventListener('click', () => {
                const input = this.element.querySelector('#aifengyue-api-key');
                const key = input.value.trim() || CONFIG.DEFAULT_API_KEY;
                ApiService.setApiKey(key);
                Toast.success('API Key 已保存');
            });

            // 开始自动注册
            this.element.querySelector('#aifengyue-start').addEventListener('click', () => {
                AutoRegister.start();
            });

            // 刷新邮箱
            this.element.querySelector('#aifengyue-refresh-email').addEventListener('click', () => {
                AutoRegister.generateNewEmail();
            });

            // 仅填充表单 -> 改为获取验证码
            this.element.querySelector('#aifengyue-fetch-code').addEventListener('click', () => {
                AutoRegister.fetchVerificationCode();
            });

            // 复制按钮
            this.element.querySelectorAll('.aifengyue-copy-btn').forEach(btn => {
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
                            Toast.success('已复制到剪贴板');
                        }).catch(() => {
                            Toast.error('复制失败');
                        });
                    }
                });
            });

            // 重置统计按钮
            this.element.querySelector('#aifengyue-reset-usage').addEventListener('click', () => {
                if (confirm('确定要重置 API 使用统计吗？')) {
                    ApiService.resetUsageCount();
                    Toast.success('统计已重置');
                }
            });
        },

        loadSavedData() {
            const apiKey = GM_getValue(CONFIG.STORAGE_KEYS.API_KEY, '');
            if (apiKey) {
                this.element.querySelector('#aifengyue-api-key').value = apiKey;
            }
            // 加载时更新使用统计显示
            this.updateUsageDisplay();
        },

        // 更新 API 配额使用显示
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
                // 根据使用量改变颜色
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
            this.element.classList.add('open');
            document.getElementById('aifengyue-sidebar-toggle').classList.add('hidden');
            this.isOpen = true;
        },

        close() {
            this.element.classList.remove('open');
            document.getElementById('aifengyue-sidebar-toggle').classList.remove('hidden');
            this.isOpen = false;
        },

        updateState(updates) {
            Object.assign(this.state, updates);
            this.render();
        },

        render() {
            const statusMap = {
                idle: { text: '空闲', color: 'idle' },
                generating: { text: '生成中...', color: 'generating' },
                waiting: { text: '等待操作', color: 'polling' },
                fetching: { text: '获取验证码...', color: 'polling' },
                success: { text: '成功', color: 'success' },
                error: { text: '错误', color: 'error' }
            };

            const status = statusMap[this.state.status] || statusMap.idle;

            const dot = this.element.querySelector('#aifengyue-status-dot');
            dot.className = `aifengyue-status-dot ${status.color}`;

            this.element.querySelector('#aifengyue-status-text').textContent = status.text;
            this.element.querySelector('#aifengyue-status-message').textContent = this.state.statusMessage;

            this.element.querySelector('#aifengyue-email').textContent = this.state.email || '未生成';
            this.element.querySelector('#aifengyue-username').textContent = this.state.username || '未生成';
            this.element.querySelector('#aifengyue-password').textContent = this.state.password || '未生成';
            this.element.querySelector('#aifengyue-code').textContent = this.state.verificationCode || '等待中...';
        }
    };

    // ==================== 自动注册核心逻辑 ====================
    const AutoRegister = {
        // 记录开始注册的时间戳（用于过滤旧邮件）
        registrationStartTime: null,

        // 检测是否在注册页面
        isRegisterPage() {
            return !!document.querySelector('input#name') &&
                !!document.querySelector('input#email') &&
                !!document.querySelector('input#password');
        },

        // 获取表单元素
        getFormElements() {
            return {
                usernameInput: document.querySelector('input#name'),
                emailInput: document.querySelector('input#email'),
                passwordInput: document.querySelector('input#password'),
                codeInput: document.querySelector('input[placeholder*="验证码"]') ||
                    document.querySelector('input[name="code"]') ||
                    document.querySelector('input[id="code"]')
            };
        },

        // 模拟输入
        simulateInput(element, value) {
            if (!element) return;
            element.focus();
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        },

        // 查找并点击发送验证码按钮
        findAndClickSendCodeButton() {
            // 尝试多种方式找到发送验证码按钮
            const buttons = document.querySelectorAll('button, a, span[role="button"]');
            for (const btn of buttons) {
                const text = (btn.textContent || btn.innerText || '').trim();
                const ariaLabel = btn.getAttribute('aria-label') || '';

                // 匹配常见的发送验证码按钮文本
                if (text.includes('发送') || text.includes('获取') || text.includes('验证码') ||
                    text.includes('Send') || text.includes('Code') || text.includes('Get') ||
                    ariaLabel.includes('验证码') || ariaLabel.includes('code')) {

                    // 检查按钮是否可点击
                    if (!btn.disabled && !btn.classList.contains('disabled')) {
                        console.log('[自动注册] 找到发送验证码按钮:', text);
                        btn.click();
                        return true;
                    }
                }
            }
            console.log('[自动注册] 未找到发送验证码按钮');
            return false;
        },

        // 开始自动注册流程
        async start() {
            if (!this.isRegisterPage()) {
                Toast.error('请在注册页面使用此功能');
                return;
            }

            try {
                Sidebar.updateState({
                    status: 'generating',
                    statusMessage: '正在生成临时邮箱...'
                });

                // 记录开始时间
                this.registrationStartTime = Math.floor(Date.now() / 1000);
                GM_setValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

                // 生成邮箱（1 次 API 调用）
                const email = await ApiService.generateEmail();
                const username = Utils.generateUsername();
                const password = Utils.generatePassword();

                Sidebar.updateState({ email, username, password, statusMessage: '正在填充表单...' });

                GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
                GM_setValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
                GM_setValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);

                this.fillForm(email, username, password);

                // 等待表单填充完成
                await Utils.delay(500);

                // 尝试自动点击发送验证码按钮
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '表单已填充，正在尝试点击发送验证码按钮...',
                    verificationCode: ''
                });

                const clicked = this.findAndClickSendCodeButton();

                if (clicked) {
                    Toast.success('已自动点击发送验证码！请完成人机验证，2秒后自动获取验证码...', 3000);

                    Sidebar.updateState({
                        status: 'waiting',
                        statusMessage: '已点击发送验证码，等待 2 秒后自动获取...'
                    });

                    // 等待 2 秒后自动获取验证码
                    await Utils.delay(2000);

                    Sidebar.updateState({
                        statusMessage: '正在自动获取验证码...'
                    });

                    // 自动获取验证码（1 次 API 调用）
                    await this.fetchVerificationCode();

                } else {
                    Toast.warning('未找到发送验证码按钮，请手动点击后再点击"获取验证码"', 5000);

                    Sidebar.updateState({
                        status: 'waiting',
                        statusMessage: '表单已填充。请手动点击页面上的"发送验证码"，然后点击侧边栏的"获取验证码"'
                    });
                }

            } catch (error) {
                Sidebar.updateState({ status: 'error', statusMessage: `错误: ${error.message}` });
                Toast.error(`生成失败: ${error.message}`);
            }
        },

        // 仅生成新邮箱
        async generateNewEmail() {
            try {
                Sidebar.updateState({ status: 'generating', statusMessage: '正在生成新邮箱...' });

                this.registrationStartTime = Math.floor(Date.now() / 1000);
                GM_setValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

                const email = await ApiService.generateEmail();

                Sidebar.updateState({
                    email,
                    status: 'waiting',
                    statusMessage: '新邮箱已生成',
                    verificationCode: ''
                });

                GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);

                const { emailInput } = this.getFormElements();
                if (emailInput) this.simulateInput(emailInput, email);

                Toast.success('新邮箱已生成并填充');

            } catch (error) {
                Sidebar.updateState({ status: 'error', statusMessage: `错误: ${error.message}` });
                Toast.error(`生成失败: ${error.message}`);
            }
        },

        // 填充表单
        fillForm(email, username, password) {
            const { usernameInput, emailInput, passwordInput } = this.getFormElements();
            if (usernameInput) this.simulateInput(usernameInput, username);
            if (emailInput) this.simulateInput(emailInput, email);
            if (passwordInput) this.simulateInput(passwordInput, password);
        },

        // 手动获取验证码（1 次 API 调用）
        async fetchVerificationCode() {
            const email = GM_getValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, '');
            if (!email) {
                Toast.error('请先生成临时邮箱');
                return;
            }

            const startTime = GM_getValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, 0);

            try {
                Sidebar.updateState({ status: 'fetching', statusMessage: '正在获取验证码邮件...' });
                Toast.info('正在获取邮件...');

                const emails = await ApiService.getEmails(email);

                if (!emails || emails.length === 0) {
                    Sidebar.updateState({
                        status: 'waiting',
                        statusMessage: '未收到邮件，请确认已点击"发送验证码"，稍后再试'
                    });
                    Toast.warning('未收到邮件，请稍后再试');
                    return;
                }

                // 按时间排序，最新的在前
                const sortedEmails = emails.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                for (const mail of sortedEmails) {
                    const mailTime = mail.timestamp || 0;

                    // 只接受注册开始后的邮件（允许 60 秒误差）
                    if (startTime && mailTime < startTime - 60) {
                        console.log(`[验证码] 跳过旧邮件 ${mailTime} < ${startTime}`);
                        continue;
                    }

                    const content = mail.content || mail.html_content || '';
                    const subject = mail.subject || '';
                    const code = Utils.extractVerificationCode(content) || Utils.extractVerificationCode(subject);

                    if (code) {
                        Sidebar.updateState({
                            status: 'success',
                            statusMessage: `验证码: ${code}`,
                            verificationCode: code
                        });

                        const { codeInput } = this.getFormElements();
                        if (codeInput) {
                            this.simulateInput(codeInput, code);
                            Toast.success(`验证码 ${code} 已填充！可以注册了`, 5000);
                        } else {
                            Toast.success(`验证码: ${code}，请手动输入`, 5000);
                        }
                        return;
                    }
                }

                Sidebar.updateState({ status: 'waiting', statusMessage: '未找到验证码，请稍后重试' });
                Toast.warning('未找到验证码，请稍后再试');

            } catch (error) {
                Sidebar.updateState({ status: 'error', statusMessage: `获取失败: ${error.message}` });
                Toast.error(`获取验证码失败: ${error.message}`);
            }
        }
    };

    // ==================== Iframe Srcdoc 提取器 ====================
    const IframeExtractor = {
        button: null,
        isDetailPage: false,

        // 检测是否是详情页
        checkDetailPage() {
            const urlPattern = /\/zh\/explore\/installed\/[0-9a-f-]+$/i;
            return urlPattern.test(window.location.pathname);
        },

        // 查找包含 srcdoc 的 iframe
        findSrcdocIframe() {
            const iframes = document.querySelectorAll('iframe[srcdoc]');
            return iframes.length > 0 ? iframes[0] : null;
        },

        // 创建提取按钮样式
        createStyles() {
            GM_addStyle(`
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

        // 创建提取按钮
        createButton() {
            if (this.button) return;

            this.createStyles();

            this.button = document.createElement('button');
            this.button.id = 'aifengyue-extract-btn';
            this.button.textContent = '提取HTML';
            this.button.title = '提取 iframe 内容为 HTML 文件';
            this.button.addEventListener('click', () => this.extractAndSave());
            document.body.appendChild(this.button);
        },

        // 移除按钮
        removeButton() {
            if (this.button) {
                this.button.remove();
                this.button = null;
            }
        },

        // 获取页面标题并处理
        getCleanTitle() {
            const title = document.title;
            // 去掉 " - Powered by AI风月" 部分
            return title.replace(/\s*-\s*Powered by AI风月\s*$/i, '').trim();
        },

        // 提取并保存 srcdoc 内容
        extractAndSave() {
            const iframe = this.findSrcdocIframe();
            if (!iframe) {
                Toast.error('未找到包含 srcdoc 的 iframe');
                return;
            }

            const srcdoc = iframe.getAttribute('srcdoc');
            if (!srcdoc) {
                Toast.error('iframe 的 srcdoc 属性为空');
                return;
            }

            try {
                // 解码 HTML 实体
                const textarea = document.createElement('textarea');
                textarea.innerHTML = srcdoc;
                const decodedHtml = textarea.value;

                // 获取清理后的标题
                const cleanTitle = this.getCleanTitle();
                const filename = `${cleanTitle}.html`;

                // 创建 Blob 并下载
                const blob = new Blob([decodedHtml], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                Toast.success(`已保存为: ${filename}`);
            } catch (error) {
                Toast.error(`提取失败: ${error.message}`);
                console.error('[Iframe 提取器] 错误:', error);
            }
        },

        // 检查并更新按钮状态
        checkAndUpdate() {
            const isDetailPage = this.checkDetailPage();
            const hasIframe = this.findSrcdocIframe() !== null;

            if (isDetailPage && hasIframe) {
                if (!this.button) {
                    this.createButton();
                    console.log('[Iframe 提取器] 检测到详情页,已显示提取按钮');
                }
            } else {
                if (this.button) {
                    this.removeButton();
                    console.log('[Iframe 提取器] 离开详情页,已隐藏提取按钮');
                }
            }
        }
    };

    // ==================== 详情页模型悬浮窗排序器 ====================
    const ModelPopupSorter = {
        _sortScheduled: false,

        // 仅在详情页启用
        isEnabled() {
            return IframeExtractor.checkDetailPage();
        },

        // 调度排序，避免高频 mutation 触发重复计算
        scheduleSort() {
            if (!this.isEnabled() || this._sortScheduled) return;
            this._sortScheduled = true;

            requestAnimationFrame(() => {
                this._sortScheduled = false;
                this.sortPopup();
            });
        },

        // 定位模型悬浮窗（优先命中用户提供的 id）
        findPopup() {
            let popup = document.querySelector('div[id=":rb0:"][data-floating-ui-portal]');
            if (popup) return popup;

            const portals = document.querySelectorAll('div[data-floating-ui-portal]');
            for (const portal of portals) {
                const hasTabs = portal.querySelector('[role="tablist"]');
                if (!hasTabs) continue;
                if ((portal.textContent || '').includes('价格系数')) {
                    return portal;
                }
            }
            return null;
        },

        // 提取模型项的价格系数，找不到时返回 Infinity
        extractPrice(itemEl) {
            if (!itemEl) return Number.POSITIVE_INFINITY;

            const text = (itemEl.textContent || '').replace(/\s+/g, ' ');
            const textMatch = text.match(/价格系数[：:]\s*([0-9]+(?:\.[0-9]+)?)/);
            if (textMatch) {
                const value = parseFloat(textMatch[1]);
                if (Number.isFinite(value)) return value;
            }

            const titleNode = itemEl.querySelector('span[title]');
            if (titleNode) {
                const titleValue = parseFloat(titleNode.getAttribute('title') || '');
                if (Number.isFinite(titleValue)) return titleValue;
            }

            return Number.POSITIVE_INFINITY;
        },

        // 识别分类块（Accordion 外层）
        findCategoryBlocks(popup) {
            const blocks = Array.from(popup.querySelectorAll('div.w-full.cursor-pointer.block'));
            return blocks.filter((block) => {
                return Boolean(
                    block.querySelector('.MuiAccordionSummary-root') &&
                    block.querySelector('.MuiAccordionDetails-root') &&
                    (block.textContent || '').includes('价格系数')
                );
            });
        },

        // 获取某个分类的信息与条目
        buildCategoryMeta(block, blockIndex) {
            const details = block.querySelector('.MuiAccordionDetails-root');
            if (!details) return null;

            const items = Array.from(details.children).filter((child) => {
                return child.nodeType === 1 && (child.textContent || '').includes('价格系数');
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

        // 分类内部按价格系数升序
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

        // 先做分类内排序，再按分类最低价排序分类
        sortPopup() {
            const popup = this.findPopup();
            if (!popup) return;

            const blocks = this.findCategoryBlocks(popup);
            if (blocks.length === 0) return;

            const parent = blocks[0].parentElement;
            if (!parent) return;

            const metas = blocks
                .map((block, index) => this.buildCategoryMeta(block, index))
                .filter(Boolean);

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

    // ==================== SPA 监听与 DOM 保护 ====================
    const SPAWatcher = {
        observer: null,
        lastUrl: '',
        _checkScheduled: false,

        // 检测是否是注册页面（通过 URL 或 DOM）
        isSignupPage() {
            if (window.location.pathname.includes('/signup') ||
                window.location.pathname.includes('/register')) {
                return true;
            }
            return AutoRegister.isRegisterPage();
        },

        // 确保我们的 DOM 元素存在
        ensureDOM() {
            const sidebar = document.getElementById('aifengyue-sidebar');
            const toggle = document.getElementById('aifengyue-sidebar-toggle');
            const toastContainer = document.getElementById('aifengyue-toast-container');

            if (!sidebar || !toggle) {
                console.log('[AI风月注册助手] 检测到 DOM 被移除，重新注入...');
                Sidebar.element = null;
                Sidebar.isOpen = false;
                Sidebar.init();
                Toast.info('侧边栏已重新注入', 2000);
            }

            if (!toastContainer) {
                Toast.container = null;
                Toast.init();
            }
        },

        // 处理页面变化
        handlePageChange() {
            const currentUrl = window.location.href;

            if (currentUrl !== this.lastUrl) {
                console.log('[AI风月注册助手] URL 变化:', this.lastUrl, '->', currentUrl);
                this.lastUrl = currentUrl;

                setTimeout(() => {
                    if (this.isSignupPage()) {
                        console.log('[AI风月注册助手] 检测到注册页面');
                        this.ensureDOM();
                        // 自动打开侧边栏
                        if (Sidebar.element && !Sidebar.isOpen) {
                            Sidebar.open();
                            Toast.success('检测到注册页面,已自动打开助手', 3000);
                        }
                    } else {
                        console.log('[AI风月注册助手] 离开注册页面');
                        // 自动关闭侧边栏
                        if (Sidebar.element && Sidebar.isOpen) {
                            Sidebar.close();
                        }
                    }

                    // 检查 iframe 提取器
                    IframeExtractor.checkAndUpdate();
                    // 检查并排序详情页模型悬浮窗
                    ModelPopupSorter.scheduleSort();
                }, 500);
            }
        },

        // 启动 MutationObserver
        startObserver() {
            if (this.observer) return;

            this.lastUrl = window.location.href;
            const self = this;

            this.observer = new MutationObserver((mutations) => {
                self.handlePageChange();

                if (!self._checkScheduled) {
                    self._checkScheduled = true;
                    requestAnimationFrame(() => {
                        self._checkScheduled = false;
                        if (self.isSignupPage()) {
                            self.ensureDOM();
                        }
                        // 检查 iframe 提取器
                        IframeExtractor.checkAndUpdate();
                        // 检查并排序详情页模型悬浮窗
                        ModelPopupSorter.scheduleSort();
                    });
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            this.hookHistoryAPI();
            console.log('[AI风月注册助手] SPA 监听器已启动');
        },

        // Hook History API
        hookHistoryAPI() {
            const self = this;
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;

            history.pushState = function (...args) {
                originalPushState.apply(this, args);
                self.handlePageChange();
            };

            history.replaceState = function (...args) {
                originalReplaceState.apply(this, args);
                self.handlePageChange();
            };

            window.addEventListener('popstate', () => {
                self.handlePageChange();
            });
        },

        stopObserver() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }
        }
    };

    // ==================== 初始化 ====================
    function init() {
        // 初始化 Toast
        // Toast.init();

        // 初始化侧边栏
        // Sidebar.init();

        // 启动 SPA 监听器
        SPAWatcher.startObserver();

        // 注册菜单命令
        GM_registerMenuCommand('⚙️ 设置 API Key', () => {
            const currentKey = ApiService.getApiKey();
            const newKey = prompt('请输入 GPTMail API Key:', currentKey);
            if (newKey !== null) {
                ApiService.setApiKey(newKey.trim() || CONFIG.DEFAULT_API_KEY);
                Toast.success('API Key 已更新');
                // 更新侧边栏中的显示
                const input = document.querySelector('#aifengyue-api-key');
                if (input) input.value = newKey.trim() || CONFIG.DEFAULT_API_KEY;
            }
        });

        GM_registerMenuCommand('📧 生成新邮箱', () => {
            AutoRegister.generateNewEmail();
        });

        GM_registerMenuCommand('🚀 开始自动注册', () => {
            AutoRegister.start();
        });

        GM_registerMenuCommand(' 获取验证码', () => {
            AutoRegister.fetchVerificationCode();
        });

        GM_registerMenuCommand('📝 打开侧边栏', () => {
            Sidebar.open();
        });

        // 初始化时检测是否在注册页面
        setTimeout(() => {
            if (SPAWatcher.isSignupPage()) {
                // 确保 DOM 元素存在
                SPAWatcher.ensureDOM();
                // 自动打开侧边栏
                if (Sidebar.element && !Sidebar.isOpen) {
                    Sidebar.open();
                    Toast.success('检测到注册页面,已自动打开助手', 3000);
                }
            }

            // 检查 iframe 提取器
            IframeExtractor.checkAndUpdate();
            // 检查并排序详情页模型悬浮窗
            ModelPopupSorter.scheduleSort();
        }, 800);

        console.log('[AI风月注册助手] 已加载 (SPA 模式)');
    }

    // DOM Ready 后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
