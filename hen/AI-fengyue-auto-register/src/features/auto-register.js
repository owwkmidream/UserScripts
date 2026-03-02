import { CONFIG } from '../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue, gmXmlHttpRequest } from '../gm.js';
import { ApiService } from '../services/api-service.js';
import { Sidebar } from '../ui/sidebar.js';
import { Toast } from '../ui/toast.js';
import { generateUsername, generatePassword, delay } from '../utils/random.js';
import { extractVerificationCode } from '../utils/code-extractor.js';
import { simulateInput } from '../utils/dom.js';
import {
    createRunContext,
    isDebugEnabled,
    logDebug,
    logError,
    logInfo,
    logWarn,
} from '../utils/logger.js';

const X_LANGUAGE = 'zh-Hans';
const SITE_ENDPOINTS = {
    SEND_CODE: '/console/api/register/email',
    SLIDE_GET: '/go/api/slide/get',
    REGISTER: '/console/api/register',
    ACCOUNT_GENDER: '/console/api/account/gender',
    FAVORITE_TAGS: '/console/api/account_extend/favorite_tags',
    ACCOUNT_EXTEND_SET: '/console/api/account/extend_set',
    INSTALLED_MESSAGES: '/console/api/installed-apps',
    CHAT_MESSAGES: '/console/api/installed-apps',
};

function readErrorMessage(payload, fallback) {
    if (!payload || typeof payload !== 'object') return fallback;
    const raw = payload.error ?? payload.message ?? payload.msg ?? payload.detail ?? payload.errmsg;
    if (typeof raw !== 'string') return fallback;
    const message = raw.trim();
    if (!message || /^(ok|success)$/i.test(message)) return fallback;
    return message;
}

function normalizeTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
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
    if (typeof raw !== 'string') return '';

    let value = raw;
    for (let i = 0; i < 3; i++) {
        if (!/\\u[0-9a-fA-F]{4}|\\[nrt"\\/]/.test(value)) {
            break;
        }
        try {
            const next = JSON.parse(`"${value
                .replace(/"/g, '\\"')
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n')
                .replace(/\t/g, '\\t')}"`);
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
    if (typeof raw !== 'string') return false;

    const source = raw.trim().toLowerCase();
    if (!source) return true;
    if (source === 'null' || source === 'undefined' || source === '""' || source === "''") {
        return true;
    }

    const decoded = decodeEscapedText(raw).trim().toLowerCase();
    if (!decoded) return true;
    if (decoded === 'null' || decoded === 'undefined' || decoded === '""' || decoded === "''") {
        return true;
    }

    return false;
}

function randomConversationSuffix(length = 3) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let output = '';
    for (let i = 0; i < length; i++) {
        output += chars[Math.floor(Math.random() * chars.length)];
    }
    return output;
}

export const AutoRegister = {
    registrationStartTime: null,
    switchingAccount: false,

    isRegisterPage() {
        return !!document.querySelector('input#name') &&
            !!document.querySelector('input#email') &&
            !!document.querySelector('input#password');
    },

    getFormElements() {
        return {
            usernameInput: document.querySelector('input#name'),
            emailInput: document.querySelector('input#email'),
            passwordInput: document.querySelector('input#password'),
            codeInput: document.querySelector('input[placeholder*="验证码"]') ||
                document.querySelector('input[name="code"]') ||
                document.querySelector('input[id="code"]'),
        };
    },

    simulateInput(element, value) {
        simulateInput(element, value);
    },

    findAndClickSendCodeButton() {
        const buttons = document.querySelectorAll('button, a, span[role="button"]');
        for (const btn of buttons) {
            const text = (btn.textContent || btn.innerText || '').trim();
            const ariaLabel = btn.getAttribute('aria-label') || '';

            if (text.includes('发送') || text.includes('获取') || text.includes('验证码') ||
                text.includes('Send') || text.includes('Code') || text.includes('Get') ||
                ariaLabel.includes('验证码') || ariaLabel.toLowerCase().includes('code')) {
                if (!btn.disabled && !btn.classList.contains('disabled')) {
                    return { clicked: true, text, element: btn };
                }
            }
        }
        return { clicked: false, text: '', element: null };
    },

    async requestSiteApi(path, options = {}, runCtx, step = 'SITE_API') {
        const strictCode = options.strictCode === true;
        const acceptableCodes = Array.isArray(options.acceptableCodes) ? options.acceptableCodes : [0, 200];
        const method = options.method || 'GET';
        const url = `${window.location.origin}${path}`;

        logInfo(runCtx, step, `${method} ${path} 请求开始`);
        logDebug(runCtx, step, '请求详情', {
            url,
            headers: {
                'Content-Type': 'application/json',
                'X-Language': X_LANGUAGE,
                ...(options.headers || {}),
            },
            body: options.body ?? null,
            anonymous: true,
        });

        const response = await gmRequestJson({
            method,
            url,
            headers: {
                'Content-Type': 'application/json',
                'X-Language': X_LANGUAGE,
                ...(options.headers || {}),
            },
            body: options.body,
            timeout: options.timeout ?? 30000,
            anonymous: true,
        });
        const payload = response.json;

        logInfo(runCtx, step, `${method} ${path} 响应`, {
            httpStatus: response.status,
            statusField: payload?.status,
            result: payload?.result,
            success: payload?.success,
            code: payload?.code,
            message: payload?.message,
        });
        logDebug(runCtx, step, '原始响应内容', {
            raw: response.raw,
            json: payload,
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

        if (typeof payload?.result === 'string' && !/^(success|ok)$/i.test(payload.result.trim())) {
            throw new Error(readErrorMessage(payload, `接口 ${path} 返回 result=${payload.result}`));
        }

        if (typeof payload?.status === 'number' && payload.status >= 400) {
            throw new Error(readErrorMessage(payload, `接口 ${path} 返回 status=${payload.status}`));
        }

        if (strictCode && typeof payload?.code === 'number' && !acceptableCodes.includes(payload.code)) {
            throw new Error(readErrorMessage(payload, `接口 ${path} 返回 code=${payload.code}`));
        }

        return payload;
    },

    async sendRegisterEmailCode(email, runCtx) {
        const payload = await this.requestSiteApi(SITE_ENDPOINTS.SEND_CODE, {
            method: 'POST',
            body: {
                email,
                lang: X_LANGUAGE,
            },
        }, runCtx, 'SEND_CODE');
        if (typeof payload?.code === 'number' && payload.code !== 0 && payload.code !== 200) {
            logWarn(runCtx, 'SEND_CODE', '发送验证码接口返回非 0 code，继续执行', payload);
        }
        return payload;
    },

    async getRegToken(runCtx) {
        const payload = await this.requestSiteApi(SITE_ENDPOINTS.SLIDE_GET, {
            method: 'GET',
        }, runCtx, 'GET_REG_TOKEN');

        const regToken = payload?.data?.reg_token;
        if (!regToken) {
            throw new Error('未获取到 reg_token');
        }
        logInfo(runCtx, 'GET_REG_TOKEN', 'reg_token 获取成功');
        logDebug(runCtx, 'GET_REG_TOKEN', 'reg_token 完整值', { regToken });
        return regToken;
    },

    async registerWithCode({ username, email, password, code, regToken }, runCtx) {
        const payload = await this.requestSiteApi(SITE_ENDPOINTS.REGISTER, {
            method: 'POST',
            body: {
                name: username,
                email,
                password,
                code,
                remember_me: true,
                interface_language: X_LANGUAGE,
                client: 'web_pc',
                is_web3_account: false,
                reg_token: regToken,
            },
        }, runCtx, 'REGISTER');

        const token = typeof payload?.data === 'string'
            ? payload.data.trim()
            : (typeof payload?.data?.token === 'string' ? payload.data.token.trim() : '');
        if (!token) {
            throw new Error('注册成功但未返回 token（支持 data 或 data.token）');
        }
        logInfo(runCtx, 'REGISTER', '注册接口返回 token');
        logDebug(runCtx, 'REGISTER', 'token 完整值', { token });
        return token;
    },

    async setAccountGender(token, runCtx) {
        await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_GENDER, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: {
                gender: 1,
            },
        }, runCtx, 'SET_GENDER');
        logInfo(runCtx, 'SET_GENDER', '首次引导-性别设置完成');
    },

    async submitFavoriteTags(token, runCtx) {
        await this.requestSiteApi(SITE_ENDPOINTS.FAVORITE_TAGS, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: {
                tag_names: [],
            },
        }, runCtx, 'SET_FAVORITE_TAGS');
        logInfo(runCtx, 'SET_FAVORITE_TAGS', '首次引导-标签提交完成');
    },

    async setFirstVisitFlag(token, runCtx) {
        await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_EXTEND_SET, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: {
                key: 'is_first_visit',
                value: true,
            },
        }, runCtx, 'SET_FIRST_VISIT');
        logInfo(runCtx, 'SET_FIRST_VISIT', '首次引导-is_first_visit 设置完成');
    },

    async setHideRefreshConfirmFlag(token, runCtx) {
        await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_EXTEND_SET, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: {
                key: 'hide_refresh_confirm',
                value: true,
            },
        }, runCtx, 'SET_HIDE_REFRESH_CONFIRM');
        logInfo(runCtx, 'SET_HIDE_REFRESH_CONFIRM', '首次引导-hide_refresh_confirm 设置完成');
    },

    async skipFirstGuide(token, runCtx) {
        logInfo(runCtx, 'SKIP_GUIDE', '开始跳过首次引导');
        await this.setAccountGender(token, runCtx);
        await this.submitFavoriteTags(token, runCtx);
        await this.setFirstVisitFlag(token, runCtx);
        await this.setHideRefreshConfirmFlag(token, runCtx);
        logInfo(runCtx, 'SKIP_GUIDE', '首次引导跳过完成');
    },

    async pollVerificationCode(email, startTime, maxAttempts = 10, intervalMs = 2000, runCtx) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: `正在轮询验证码邮件... (${attempt}/${maxAttempts})`,
            });
            logInfo(runCtx, 'POLL_CODE', `轮询验证码第 ${attempt}/${maxAttempts} 次`);

            const emails = await ApiService.getEmails(email);
            const sortedEmails = (emails || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            logDebug(runCtx, 'POLL_CODE', '邮件列表详情', {
                count: sortedEmails.length,
                emails: sortedEmails,
            });

            for (const mail of sortedEmails) {
                const mailTime = mail.timestamp || 0;

                if (startTime && mailTime < startTime - 60) {
                    continue;
                }

                const content = mail.content || mail.html_content || '';
                const subject = mail.subject || '';
                const code = extractVerificationCode(content) || extractVerificationCode(subject);
                if (code) {
                    logInfo(runCtx, 'POLL_CODE', `提取到验证码（第 ${attempt} 次轮询）`);
                    logDebug(runCtx, 'POLL_CODE', '验证码完整值', { code });
                    return code;
                }
            }

            if (attempt < maxAttempts) {
                logWarn(runCtx, 'POLL_CODE', `本轮未获取到验证码，${intervalMs}ms 后重试`);
                await delay(intervalMs);
            }
        }
        logError(runCtx, 'POLL_CODE', '轮询窗口结束，仍未获取验证码');
        return null;
    },

    async startLegacyRegisterAssist() {
        const runCtx = createRunContext('LEGACY');
        let currentStep = '初始化';
        logInfo(runCtx, 'START', '注册页模式：填表辅助 + 用户手动过验证码');
        try {
            if (!this.isRegisterPage()) {
                throw new Error('当前不在注册页，请使用一键注册（接口）');
            }

            currentStep = '生成临时邮箱';
            Sidebar.updateState({
                status: 'generating',
                statusMessage: '正在生成临时邮箱...',
            });

            this.registrationStartTime = Math.floor(Date.now() / 1000);
            gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

            const email = await ApiService.generateEmail();
            const username = generateUsername();
            const password = generatePassword();
            logInfo(runCtx, 'GENERATE', '生成注册信息完成', { email, username, password });

            Sidebar.updateState({ email, username, password, statusMessage: '正在填充表单...' });

            gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
            gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
            gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);

            this.fillForm(email, username, password);

            currentStep = '触发发送验证码';
            const sendResult = this.findAndClickSendCodeButton();
            if (sendResult.clicked) {
                sendResult.element?.click();
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '表单已填充并触发发送验证码，请完成人机验证后点击页面注册',
                    verificationCode: '',
                });
                Toast.info('已填表并尝试发送验证码，请你完成人机验证后提交注册', 5000);
                logInfo(runCtx, 'SEND_CODE', '已触发页面发送验证码按钮', { text: sendResult.text });
            } else {
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '表单已填充，请手动点击发送验证码并完成人机验证',
                    verificationCode: '',
                });
                Toast.warning('已填表，但未找到发送验证码按钮，请手动操作', 5000);
                logWarn(runCtx, 'SEND_CODE', '未找到发送验证码按钮');
            }
        } catch (error) {
            const message = `${currentStep}失败: ${error.message}`;
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message);
            logError(runCtx, 'FAIL', message, {
                errorName: error?.name,
                stack: error?.stack,
            });
        }
    },

    async registerByApi(runCtx, options = {}) {
        const flowName = options.flowName || '一键注册';
        const showStepToasts = options.showStepToasts !== false;
        const markSuccess = options.markSuccess !== false;

        let currentStep = '初始化';

        currentStep = '生成临时邮箱';
        Sidebar.updateState({
            status: 'generating',
            statusMessage: `${flowName}：正在生成临时邮箱...`,
        });
        if (showStepToasts) {
            Toast.info(`${flowName}：正在生成临时邮箱`, 2200);
        }

        this.registrationStartTime = Math.floor(Date.now() / 1000);
        gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

        const email = await ApiService.generateEmail();
        const username = generateUsername();
        const password = generatePassword();
        logInfo(runCtx, 'GENERATE', `${flowName} 生成注册信息完成`, { email, username, password });

        Sidebar.updateState({ email, username, password, statusMessage: `${flowName}：正在填充表单...` });

        gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
        gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
        gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);

        this.fillForm(email, username, password);

        currentStep = '发送验证码';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：正在发送验证码...`,
            verificationCode: '',
        });
        await this.sendRegisterEmailCode(email, runCtx);
        if (showStepToasts) {
            Toast.info(`${flowName}：验证码已发送，正在轮询邮箱`, 2200);
        }

        currentStep = '轮询邮箱验证码';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：验证码已发送，正在自动轮询邮箱...`,
        });

        const code = await this.pollVerificationCode(email, this.registrationStartTime, 10, 2000, runCtx);
        if (!code) {
            throw new Error('未在轮询窗口内获取到验证码');
        }
        if (showStepToasts) {
            Toast.success(`${flowName}：已获取验证码`, 1800);
        }

        Sidebar.updateState({
            verificationCode: code,
            statusMessage: `${flowName}：验证码已获取: ${code}`,
        });

        const { codeInput } = this.getFormElements();
        if (codeInput) {
            this.simulateInput(codeInput, code);
            logInfo(runCtx, 'FORM', `${flowName} 验证码已自动填充到输入框`);
        } else {
            logWarn(runCtx, 'FORM', `${flowName} 未找到验证码输入框，跳过自动填充`);
        }

        currentStep = '获取注册令牌';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：正在获取注册令牌...`,
        });
        const regToken = await this.getRegToken(runCtx);

        currentStep = '提交注册';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：正在提交注册...`,
        });
        const token = await this.registerWithCode({
            username,
            email,
            password,
            code,
            regToken,
        }, runCtx);

        localStorage.setItem('console_token', token);
        logInfo(runCtx, 'AUTH', `${flowName} 已写入 localStorage.console_token`);
        logDebug(runCtx, 'AUTH', `${flowName} localStorage 写入 token 完整值`, { token });
        if (showStepToasts) {
            Toast.success(`${flowName}：注册成功，已写入 console_token`, 2400);
        }

        currentStep = '跳过首次引导';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：注册成功，正在跳过首次引导...`,
        });

        let guideSkipped = true;
        try {
            await this.skipFirstGuide(token, runCtx);
        } catch (guideError) {
            guideSkipped = false;
            logError(runCtx, 'SKIP_GUIDE', `${flowName} 首次引导跳过失败`, {
                errorName: guideError?.name,
                message: guideError?.message,
                stack: guideError?.stack,
            });
            Toast.warning(`${flowName}：注册成功，但跳过首次引导失败: ${guideError.message}`, 6000);
        }

        if (markSuccess) {
            Sidebar.updateState({
                status: 'success',
                statusMessage: guideSkipped
                    ? `${flowName}成功，已写入 console_token 并跳过首次引导`
                    : `${flowName}成功，已写入 console_token（首次引导跳过失败）`,
            });
            Toast.success(guideSkipped
                ? `${flowName}完成：已自动跳过首次引导并写入登录态`
                : `${flowName}完成：已写入登录态；首次引导跳过失败`, 5000);
        } else {
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: `${flowName}已完成注册，准备执行后续操作...`,
            });
        }

        return {
            token,
            guideSkipped,
            email,
            username,
            password,
            code,
        };
    },

    extractInstalledAppId() {
        const matched = window.location.pathname.match(/\/(?:test-)?installed\/([0-9a-f-]+)/i);
        return matched?.[1] || '';
    },

    readConversationIdByAppId(appId) {
        const raw = localStorage.getItem('conversationIdInfo');
        if (!raw) {
            throw new Error('未找到 localStorage.conversationIdInfo');
        }

        let mapping;
        try {
            mapping = JSON.parse(raw);
        } catch {
            throw new Error('conversationIdInfo 不是合法 JSON');
        }

        if (!mapping || typeof mapping !== 'object') {
            throw new Error('conversationIdInfo 结构无效');
        }

        const conversationId = typeof mapping[appId] === 'string' ? mapping[appId].trim() : '';
        if (!conversationId) {
            throw new Error(`conversationIdInfo 中未找到 appId=${appId} 对应的 conversation_id`);
        }

        return conversationId;
    },

    async fetchLatestConversationAnswer({ appId, conversationId, token, runCtx }) {
        const path = `${SITE_ENDPOINTS.INSTALLED_MESSAGES}/${appId}/messages?conversation_id=${encodeURIComponent(conversationId)}&limit=20&type=recent`;
        const payload = await this.requestSiteApi(path, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }, runCtx, 'SWITCH_FETCH_MESSAGES');

        const messages = Array.isArray(payload?.data)
            ? payload.data
            : (Array.isArray(payload?.data?.data) ? payload.data.data : []);
        if (!messages.length) {
            throw new Error('messages 接口未返回可用 data');
        }

        const sorted = [...messages].sort((a, b) => normalizeTimestamp(b?.created_at) - normalizeTimestamp(a?.created_at));
        for (const item of sorted) {
            const answer = item?.answer;
            if (isAnswerEmpty(answer)) {
                logWarn(runCtx, 'SWITCH_FETCH_MESSAGES', '检测到空 answer，继续向后查找', {
                    createdAt: item?.created_at ?? null,
                    answerType: typeof answer,
                    answerPreview: typeof answer === 'string' ? answer.slice(0, 60) : answer,
                });
                continue;
            }

            const answerText = typeof answer === 'string' ? answer : String(answer);
            return {
                answer: answerText,
                createdAt: item?.created_at ?? null,
            };
        }

        throw new Error('messages 中所有 answer 均为空，已停止更换账号流程');
    },

    async sendChatMessagesAndReload({ appId, token, query, conversationName, runCtx }) {
        const path = `${SITE_ENDPOINTS.CHAT_MESSAGES}/${appId}/chat-messages`;
        const url = `${window.location.origin}${path}`;
        const body = {
            response_mode: 'streaming',
            conversation_name: conversationName,
            history_start_at: null,
            inputs: {},
            query,
        };

        logInfo(runCtx, 'SWITCH_CHAT', '开始请求 chat-messages', {
            path,
            conversationName,
            queryLength: query.length,
        });
        logDebug(runCtx, 'SWITCH_CHAT', 'chat-messages 请求体', body);

        return new Promise((resolve, reject) => {
            let settled = false;

            const finishAndReload = (trigger, responseMeta = {}) => {
                if (settled) return;
                settled = true;
                const status = Number(responseMeta?.status || 0);
                const hasStatus = Number.isFinite(status) && status > 0;
                const isSuccess = hasStatus && status >= 200 && status < 300;
                const statusText = hasStatus ? `HTTP ${status}` : '未知状态';
                logInfo(runCtx, 'SWITCH_CHAT', `chat-messages 已收到 ${trigger} 响应（${statusText}），1秒后刷新`, responseMeta);
                Sidebar.updateState({
                    status: 'success',
                    statusMessage: `更换账号：chat-messages 已返回（${statusText}），1秒后刷新页面...`,
                });
                Toast.info(
                    `chat-messages 已收到${isSuccess ? '成功' : '失败'}响应（${statusText}），1秒后刷新`,
                    3500
                );
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
                resolve({ status, isSuccess });
            };

            gmXmlHttpRequest({
                method: 'POST',
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Language': X_LANGUAGE,
                    Authorization: `Bearer ${token}`,
                },
                data: JSON.stringify(body),
                timeout: 20000,
                anonymous: true,
                onprogress: (response) => {
                    if (settled) return;
                    const status = Number(response?.status || 0);
                    const textLength = (response?.responseText || '').length;
                    if (status > 0 || textLength > 0) {
                        finishAndReload('onprogress', { status, textLength });
                    }
                },
                onload: (response) => {
                    if (settled) return;
                    const status = Number(response?.status || 0);
                    const textLength = (response?.responseText || '').length;
                    finishAndReload('onload', { status, textLength });
                },
                onerror: (error) => {
                    if (settled) return;
                    reject(new Error(error?.error || 'chat-messages 网络请求失败'));
                },
                ontimeout: () => {
                    if (settled) return;
                    reject(new Error('chat-messages 请求超时'));
                },
                onabort: () => {
                    if (settled) return;
                    reject(new Error('chat-messages 请求被中止'));
                },
            });
        });
    },

    async startOneClickRegister() {
        const runCtx = createRunContext('REG');
        logInfo(runCtx, 'START', '开始一键注册流程', {
            href: window.location.href,
            debugEnabled: isDebugEnabled(),
        });
        try {
            await this.registerByApi(runCtx, {
                flowName: '一键注册',
                showStepToasts: true,
                markSuccess: true,
            });
            logInfo(runCtx, 'DONE', '一键注册流程完成');
        } catch (error) {
            const message = `一键注册失败: ${error.message}`;
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message);
            logError(runCtx, 'FAIL', message, {
                errorName: error?.name,
                stack: error?.stack,
            });
        }
    },

    async switchAccount(extraText) {
        const runCtx = createRunContext('SWITCH');
        const appendText = typeof extraText === 'string' ? extraText.trim() : '';
        const switchBtn = document.getElementById('aifengyue-switch-account');

        if (this.switchingAccount) {
            Toast.warning('更换账号正在执行，请稍候');
            logWarn(runCtx, 'PRECHECK', '重复触发更换账号，已拦截');
            return;
        }

        if (!appendText) {
            const message = '请输入更换账号附加文本后再执行';
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message);
            logError(runCtx, 'PRECHECK', message);
            return;
        }

        this.switchingAccount = true;
        if (switchBtn) {
            switchBtn.disabled = true;
        }

        logInfo(runCtx, 'START', '开始更换账号流程', {
            href: window.location.href,
            appendTextLength: appendText.length,
            debugEnabled: isDebugEnabled(),
        });

        try {
            const appId = this.extractInstalledAppId();
            if (!appId) {
                throw new Error('当前页面不是 installed/test-installed 详情页，无法提取应用 ID');
            }

            const oldToken = (localStorage.getItem('console_token') || '').trim();
            if (!oldToken) {
                throw new Error('未找到旧账号 console_token，请先登录旧账号后再更换');
            }

            const conversationId = this.readConversationIdByAppId(appId);
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：正在读取旧会话最新消息...',
            });
            Toast.info('更换账号：正在提取旧会话最新回答', 2400);

            const latest = await this.fetchLatestConversationAnswer({
                appId,
                conversationId,
                token: oldToken,
                runCtx,
            });
            const decodedAnswer = decodeEscapedText(latest.answer);
            if (!decodedAnswer.trim()) {
                throw new Error('最新消息 answer 解码后为空');
            }

            logInfo(runCtx, 'SWITCH_FETCH_MESSAGES', '已提取旧会话最新消息', {
                appId,
                conversationId,
                createdAt: latest.createdAt,
                answerLength: decodedAnswer.length,
            });

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：已提取旧回答，正在注册新账号...',
            });
            Toast.info('更换账号：开始注册新账号', 2200);

            const registerResult = await this.registerByApi(runCtx, {
                flowName: '更换账号',
                showStepToasts: true,
                markSuccess: false,
            });

            const query = `${decodedAnswer}\n\n${appendText}`;
            const conversationName = `新的对话-${randomConversationSuffix(3)}`;
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：新账号已就绪，正在发送 chat-messages...',
            });
            Toast.info('更换账号：正在发送 chat-messages', 2200);

            await this.sendChatMessagesAndReload({
                appId,
                token: registerResult.token,
                query,
                conversationName,
                runCtx,
            });
        } catch (error) {
            const message = `更换账号失败: ${error.message}`;
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message, 6000);
            logError(runCtx, 'FAIL', message, {
                errorName: error?.name,
                stack: error?.stack,
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
        const runCtx = createRunContext('MAIL');
        logInfo(runCtx, 'START', '开始生成新邮箱');
        try {
            Sidebar.updateState({ status: 'generating', statusMessage: '正在生成新邮箱...' });

            this.registrationStartTime = Math.floor(Date.now() / 1000);
            gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

            const email = await ApiService.generateEmail();

            Sidebar.updateState({
                email,
                status: 'waiting',
                statusMessage: '新邮箱已生成',
                verificationCode: '',
            });

            gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);

            const { emailInput } = this.getFormElements();
            if (emailInput) this.simulateInput(emailInput, email);

            Toast.success('新邮箱已生成并填充');
            logInfo(runCtx, 'DONE', '新邮箱生成成功', { email });
        } catch (error) {
            Sidebar.updateState({ status: 'error', statusMessage: `错误: ${error.message}` });
            Toast.error(`生成失败: ${error.message}`);
            logError(runCtx, 'FAIL', '新邮箱生成失败', {
                errorName: error?.name,
                message: error?.message,
                stack: error?.stack,
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
        const runCtx = createRunContext('CODE');
        const email = gmGetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, '');
        if (!email) {
            Toast.error('请先生成临时邮箱');
            logWarn(runCtx, 'PRECHECK', '未找到当前邮箱，无法获取验证码');
            return;
        }

        const startTime = gmGetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, 0);

        try {
            Sidebar.updateState({ status: 'fetching', statusMessage: '正在获取验证码邮件...' });
            Toast.info('正在获取邮件...');
            logInfo(runCtx, 'START', '手动获取验证码开始', { email, startTime });

            const code = await this.pollVerificationCode(email, startTime, 1, 0, runCtx);
            if (!code) {
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '未找到验证码，请稍后重试',
                });
                Toast.warning('未找到验证码，请稍后再试');
                logWarn(runCtx, 'DONE', '手动获取验证码未命中');
                return;
            }

            Sidebar.updateState({
                status: 'success',
                statusMessage: `验证码: ${code}`,
                verificationCode: code,
            });

            const { codeInput } = this.getFormElements();
            if (codeInput) {
                this.simulateInput(codeInput, code);
                Toast.success(`验证码 ${code} 已填充！`, 5000);
                logInfo(runCtx, 'DONE', '验证码已填充');
            } else {
                Toast.success(`验证码: ${code}，请手动输入`, 5000);
                logWarn(runCtx, 'DONE', '找到验证码但未找到输入框');
            }
        } catch (error) {
            Sidebar.updateState({ status: 'error', statusMessage: `获取失败: ${error.message}` });
            Toast.error(`获取验证码失败: ${error.message}`);
            logError(runCtx, 'FAIL', '手动获取验证码失败', {
                errorName: error?.name,
                message: error?.message,
                stack: error?.stack,
            });
        }
    },
};
