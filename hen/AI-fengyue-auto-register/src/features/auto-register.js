import { CONFIG } from '../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue, gmXmlHttpRequest } from '../gm.js';
import { ApiService } from '../services/api-service.js';
import { ChatHistoryService } from '../services/chat-history-service.js';
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
    ACCOUNT_PROFILE: '/go/api/account/profile',
    APP_DETAILS: '/go/api/apps',
    APPS: '/console/api/apps',
    INSTALLED_MESSAGES: '/console/api/installed-apps',
    CHAT_MESSAGES: '/console/api/installed-apps',
};
const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS = 3;

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

function buildTokenSignature(token) {
    const normalized = typeof token === 'string' ? token.trim() : '';
    if (!normalized) return '';

    // 用短哈希标识 token 归属，避免把明文 token 写入本地会话索引。
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
        hash ^= normalized.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `tk-${normalized.length}-${hex}`;
}

function withHttpStatusError(message, httpStatus) {
    const error = new Error(message);
    if (typeof httpStatus === 'number' && Number.isFinite(httpStatus)) {
        error.httpStatus = httpStatus;
    }
    return error;
}

export const AutoRegister = {
    registrationStartTime: null,
    switchingAccount: false,

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

        const message = String(error?.message || '').toLowerCase();
        if (!message) return false;

        return (
            message.includes('timeout') ||
            message.includes('超时') ||
            message.includes('network') ||
            message.includes('网络') ||
            message.includes('gm 请求失败') ||
            message.includes('failed') ||
            message.includes('中止') ||
            message.includes('abort')
        );
    },

    async runWithObjectiveRetries(task, {
        runCtx,
        step = 'RETRY',
        actionName = '请求',
        maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
        baseDelayMs = 800,
    } = {}) {
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
                logWarn(runCtx, step, `${actionName} 发生客观错误，${waitMs}ms 后重试 (${attempt + 1}/${attempts})`, {
                    message: error?.message || String(error),
                    httpStatus: Number(error?.httpStatus || 0) || null,
                });
                await delay(waitMs);
            }
        }

        throw lastError || new Error(`${actionName} 执行失败`);
    },

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
        const attempts = this.resolveRetryAttempts(options.maxAttempts);
        return this.runWithObjectiveRetries(
            () => this.requestSiteApiOnce(path, options, runCtx, step),
            {
                runCtx,
                step,
                actionName: `${options.method || 'GET'} ${path}`,
                maxAttempts: attempts,
            }
        );
    },

    async requestSiteApiOnce(path, options = {}, runCtx, step = 'SITE_API') {
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
            throw withHttpStatusError(
                readErrorMessage(payload, `接口 ${path} 请求失败: HTTP ${response.status}`),
                response.status
            );
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
                // 用户反馈该站点以 true 作为“已跳过引导”的实际生效值
                value: true,
            },
        }, runCtx, 'SET_FIRST_VISIT');
        logInfo(runCtx, 'SET_FIRST_VISIT', '首次引导-is_first_visit 设置完成');

        await this.verifyAccountExtendFlag({
            token,
            key: 'is_first_visit',
            expectedValue: true,
            runCtx,
            step: 'VERIFY_FIRST_VISIT',
        });
    },

    normalizeAccountExtendValue(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1') return true;
            if (normalized === 'false' || normalized === '0') return false;
        }
        return null;
    },

    async fetchAccountProfile({ token, runCtx, step = 'GET_ACCOUNT_PROFILE', maxAttempts = 1 }) {
        const payload = await this.requestSiteApi(SITE_ENDPOINTS.ACCOUNT_PROFILE, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            maxAttempts,
        }, runCtx, step);

        const profile = payload?.data;
        if (!profile || typeof profile !== 'object') {
            throw new Error('account/profile 返回 data 为空');
        }
        return profile;
    },

    async verifyAccountExtendFlag({ token, key, expectedValue, runCtx, step }) {
        try {
            // 校验为附加能力，失败不影响主流程
            const profile = await this.fetchAccountProfile({
                token,
                runCtx,
                step,
                maxAttempts: 1,
            });
            const extend = profile?.extend && typeof profile.extend === 'object' ? profile.extend : {};
            const resolvedValue = Object.prototype.hasOwnProperty.call(extend, key) ? extend[key] : null;
            const normalized = this.normalizeAccountExtendValue(resolvedValue);
            const expected = this.normalizeAccountExtendValue(expectedValue);

            if (resolvedValue === null) {
                logWarn(runCtx, step, `${key} 在 profile.extend 中不存在`, {
                    key,
                    expected: expectedValue,
                });
                return;
            }

            if (normalized === expected) {
                logInfo(runCtx, step, `${key} 校验通过`, {
                    key,
                    value: resolvedValue,
                });
            } else {
                logWarn(runCtx, step, `${key} 校验值与预期不一致`, {
                    key,
                    expected: expectedValue,
                    actual: resolvedValue,
                });
            }
        } catch (error) {
            logWarn(runCtx, step, `${key} 校验失败（不影响主流程）`, {
                key,
                message: error?.message || String(error),
            });
        }
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
        logInfo(runCtx, 'SET_HIDE_REFRESH_CONFIRM', '首次引导-hide_refresh_confirm 设置完成（已执行 extend_set）');

        await this.verifyAccountExtendFlag({
            token,
            key: 'hide_refresh_confirm',
            expectedValue: true,
            runCtx,
            step: 'VERIFY_HIDE_REFRESH_CONFIRM',
        });
    },

    async skipFirstGuideOnce(token, runCtx) {
        await this.setAccountGender(token, runCtx);
        await this.submitFavoriteTags(token, runCtx);
        await this.setFirstVisitFlag(token, runCtx);
        await this.setHideRefreshConfirmFlag(token, runCtx);
    },

    async verifyGuideByProfile({ token, runCtx, step = 'VERIFY_GUIDE_BY_PROFILE' }) {
        const profile = await this.fetchAccountProfile({
            token,
            runCtx,
            step,
            maxAttempts: 1,
        });
        const extend = profile?.extend && typeof profile.extend === 'object' ? profile.extend : {};
        const hideRefreshConfirm = this.normalizeAccountExtendValue(extend.hide_refresh_confirm);
        const isFirstVisit = this.normalizeAccountExtendValue(extend.is_first_visit);

        const checks = {
            hideRefreshConfirm: hideRefreshConfirm === true,
            isFirstVisit: isFirstVisit === true,
        };

        const ok = checks.hideRefreshConfirm && checks.isFirstVisit;
        logInfo(runCtx, step, ok ? 'profile 校验通过' : 'profile 校验未通过', {
            hide_refresh_confirm: extend.hide_refresh_confirm ?? null,
            is_first_visit: extend.is_first_visit ?? null,
            checks,
        });

        return { ok, checks, profile };
    },

    async skipFirstGuide(token, runCtx) {
        const maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS;
        logInfo(runCtx, 'SKIP_GUIDE', `开始跳过首次引导，最多尝试 ${maxAttempts} 次`);

        let lastVerify = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            logInfo(runCtx, 'SKIP_GUIDE', `执行第 ${attempt}/${maxAttempts} 轮首次引导设置`);
            if (attempt > 1) {
                Toast.info(`跳过首次引导重试中（${attempt}/${maxAttempts}）`, 1800);
            }
            await this.skipFirstGuideOnce(token, runCtx);

            lastVerify = await this.verifyGuideByProfile({
                token,
                runCtx,
                step: `VERIFY_GUIDE_BY_PROFILE_${attempt}`,
            });
            if (lastVerify.ok) {
                logInfo(runCtx, 'SKIP_GUIDE', `首次引导跳过完成（第 ${attempt} 轮校验通过）`);
                return;
            }

            if (attempt < maxAttempts) {
                const waitMs = 800 * attempt;
                logWarn(runCtx, 'SKIP_GUIDE', `第 ${attempt} 轮校验未通过，${waitMs}ms 后重试`);
                await delay(waitMs);
            }
        }

        const checks = lastVerify?.checks || {};
        throw new Error(`首次引导校验未通过（已重试 ${maxAttempts} 次）：hide_refresh_confirm=${checks.hideRefreshConfirm === true}，is_first_visit=${checks.isFirstVisit === true}`);
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
        if (showStepToasts) {
            Toast.info(`${flowName}：正在跳过首次引导（最多${DEFAULT_OBJECTIVE_RETRY_ATTEMPTS}次）`, 2600);
        }

        let guideSkipped = true;
        try {
            await this.skipFirstGuide(token, runCtx);
            if (showStepToasts) {
                Toast.success(`${flowName}：首次引导已跳过`, 1800);
            }
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

    readConversationIdByAppIdSafe(appId) {
        try {
            return this.readConversationIdByAppId(appId);
        } catch {
            return '';
        }
    },

    parseConversationIdFromEventStream(rawText) {
        if (typeof rawText !== 'string' || !rawText.trim()) return '';

        const lines = rawText.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line.startsWith('data:')) continue;

            const dataText = line.slice(5).trim();
            if (!dataText || dataText === '[DONE]') continue;

            try {
                const data = JSON.parse(dataText);
                const parsed = typeof data?.conversation_id === 'string'
                    ? data.conversation_id.trim()
                    : (typeof data?.conversationId === 'string' ? data.conversationId.trim() : '');
                if (parsed) return parsed;
            } catch {
                const fallback = dataText.match(/"conversation_id"\s*:\s*"([^"]+)"/i);
                if (fallback?.[1]) {
                    return fallback[1].trim();
                }
            }
        }

        const globalMatch = rawText.match(/"conversation_id"\s*:\s*"([^"]+)"/i);
        return globalMatch?.[1] ? globalMatch[1].trim() : '';
    },

    upsertConversationIdInfo(appId, conversationId, runCtx) {
        const normalizedAppId = typeof appId === 'string' ? appId.trim() : '';
        const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';
        if (!normalizedAppId || !normalizedConversationId) {
            return false;
        }

        let mapping = {};
        const raw = localStorage.getItem('conversationIdInfo');
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    mapping = { ...parsed };
                } else {
                    logWarn(runCtx, 'SWITCH_CHAT', 'conversationIdInfo 不是对象，已重建');
                }
            } catch {
                logWarn(runCtx, 'SWITCH_CHAT', 'conversationIdInfo 解析失败，已重建');
            }
        }

        const previousConversationId = typeof mapping[normalizedAppId] === 'string'
            ? mapping[normalizedAppId].trim()
            : '';

        mapping[normalizedAppId] = normalizedConversationId;
        localStorage.setItem('conversationIdInfo', JSON.stringify(mapping));

        logInfo(runCtx, 'SWITCH_CHAT', '已写入 localStorage.conversationIdInfo', {
            appId: normalizedAppId,
            conversationId: normalizedConversationId,
            previousConversationId: previousConversationId || null,
        });
        return true;
    },

    extractLatestAnswerFromMessages(messages, runCtx, step = 'SWITCH_FETCH_MESSAGES') {
        const sorted = [...messages].sort((a, b) => normalizeTimestamp(b?.created_at) - normalizeTimestamp(a?.created_at));
        for (const item of sorted) {
            const answer = item?.answer;
            if (isAnswerEmpty(answer)) {
                logWarn(runCtx, step, '检测到空 answer，继续向后查找', {
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

    async fetchConversationMessages({
        appId,
        conversationId,
        token,
        runCtx,
        step = 'SWITCH_FETCH_MESSAGES',
        limit = 100,
        type = 'recent',
        maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
    }) {
        const path = `${SITE_ENDPOINTS.INSTALLED_MESSAGES}/${appId}/messages?conversation_id=${encodeURIComponent(conversationId)}&limit=${encodeURIComponent(limit)}&type=${encodeURIComponent(type)}`;
        const payload = await this.requestSiteApi(path, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            maxAttempts,
        }, runCtx, step);

        const payloadData = payload?.data;
        const messages = Array.isArray(payloadData)
            ? payloadData
            : (Array.isArray(payloadData?.data) ? payloadData.data : []);

        return {
            messages,
            total: Number(payloadData?.total ?? payload?.total ?? messages.length),
            hasPastRecord: Boolean(payloadData?.has_past_record ?? payload?.has_past_record ?? false),
            isEarliestDataPage: payloadData?.is_earliest_data_page ?? payload?.is_earliest_data_page ?? null,
            raw: payload,
        };
    },

    async fetchInstalledConversations({
        appId,
        token,
        runCtx,
        step = 'SWITCH_LIST_CONVERSATIONS',
        limit = 500,
        pinned = false,
        maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
    }) {
        const path = `${SITE_ENDPOINTS.INSTALLED_MESSAGES}/${appId}/conversations?limit=${encodeURIComponent(limit)}&pinned=${pinned ? 'true' : 'false'}`;
        const payload = await this.requestSiteApi(path, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            maxAttempts,
        }, runCtx, step);

        const list = Array.isArray(payload?.data)
            ? payload.data
            : (Array.isArray(payload?.data?.data) ? payload.data.data : []);

        return [...list].sort((a, b) => normalizeTimestamp(b?.created_at) - normalizeTimestamp(a?.created_at));
    },

    async pollConversationIdFromConversations({
        appId,
        token,
        runCtx,
        baselineConversationIds = [],
        maxAttempts = 10,
        intervalMs = 700,
    }) {
        const baseline = new Set(
            (baselineConversationIds || [])
                .map((item) => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean)
        );

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const conversations = await this.fetchInstalledConversations({
                appId,
                token,
                runCtx,
                step: `SWITCH_LIST_CONVERSATIONS_${attempt}`,
                limit: 500,
                pinned: false,
                maxAttempts: 1,
            });

            const firstNew = conversations.find((item) => {
                const id = typeof item?.id === 'string' ? item.id.trim() : '';
                return !!id && !baseline.has(id);
            });
            if (firstNew?.id) {
                return {
                    conversationId: firstNew.id.trim(),
                    source: 'polling-new',
                    attempt,
                };
            }

            if (baseline.size === 0 && conversations[0]?.id) {
                return {
                    conversationId: String(conversations[0].id).trim(),
                    source: 'polling-latest',
                    attempt,
                };
            }

            if (attempt < maxAttempts) {
                await delay(intervalMs);
            }
        }

        return {
            conversationId: '',
            source: 'polling-none',
            attempt: maxAttempts,
        };
    },

    async fetchAppDetails({ appId, token, runCtx, step = 'SWITCH_GET_APP_DETAILS' }) {
        const path = `${SITE_ENDPOINTS.APP_DETAILS}/${appId}`;
        const payload = await this.requestSiteApi(path, {
            method: 'GET',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }, runCtx, step);

        const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
        const appInfo = data?.apps && typeof data.apps === 'object'
            ? data.apps
            : (data?.app && typeof data.app === 'object' ? data.app : {});
        const modelConfig = data?.model_config && typeof data.model_config === 'object'
            ? data.model_config
            : (data?.modelConfig && typeof data.modelConfig === 'object' ? data.modelConfig : {});

        return {
            appId,
            name: decodeEscapedText(typeof appInfo?.name === 'string' ? appInfo.name : ''),
            description: decodeEscapedText(typeof appInfo?.description === 'string' ? appInfo.description : ''),
            builtInCss: decodeEscapedText(typeof modelConfig?.built_in_css === 'string' ? modelConfig.built_in_css : ''),
            raw: payload,
        };
    },

    async syncAppMetaToLocalHistory({ appId, token, runCtx, step = 'SWITCH_SYNC_APP_META' }) {
        try {
            const details = await this.fetchAppDetails({
                appId,
                token,
                runCtx,
                step,
            });

            await ChatHistoryService.upsertAppMeta({
                appId,
                name: details.name,
                description: details.description,
                builtInCss: details.builtInCss,
            });
            return details;
        } catch (error) {
            logWarn(runCtx, step, '同步应用元数据到本地失败（不影响主流程）', {
                message: error?.message || String(error),
            });
            return null;
        }
    },

    async fetchLatestConversationAnswer({ appId, conversationId, token, runCtx }) {
        const result = await this.fetchConversationMessages({
            appId,
            conversationId,
            token,
            runCtx,
            step: 'SWITCH_FETCH_MESSAGES',
            limit: 100,
            type: 'recent',
        });
        const messages = result.messages;
        if (!messages.length) {
            throw new Error('messages 接口未返回可用 data');
        }

        return this.extractLatestAnswerFromMessages(messages, runCtx, 'SWITCH_FETCH_MESSAGES');
    },

    async fetchUserAppModelConfig({ appId, token, runCtx }) {
        const path = `${SITE_ENDPOINTS.APPS}/${appId}/user_app_model_config`;
        const payload = await this.requestSiteApi(path, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }, runCtx, 'SWITCH_GET_MODEL_CONFIG');

        const config = payload?.data ?? payload;
        if (config === null || config === undefined) {
            throw new Error('user_app_model_config 返回为空');
        }

        logInfo(runCtx, 'SWITCH_GET_MODEL_CONFIG', '已读取旧账号 user_app_model_config', {
            appId,
            configType: Array.isArray(config) ? 'array' : typeof config,
        });
        logDebug(runCtx, 'SWITCH_GET_MODEL_CONFIG', 'user_app_model_config 详情', config);
        return config;
    },

    async saveUserAppModelConfig({ appId, token, config, runCtx }) {
        const path = `${SITE_ENDPOINTS.APPS}/${appId}/user_app_model_config`;
        await this.requestSiteApi(path, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: config,
        }, runCtx, 'SWITCH_POST_MODEL_CONFIG');
        logInfo(runCtx, 'SWITCH_POST_MODEL_CONFIG', '新账号 user_app_model_config 已同步', {
            appId,
            configType: Array.isArray(config) ? 'array' : typeof config,
        });
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

        const responseMeta = await this.runWithObjectiveRetries(
            (attempt, attempts) => {
                if (attempt > 1) {
                    logInfo(runCtx, 'SWITCH_CHAT', `chat-messages 重试中 (${attempt}/${attempts})`);
                }
                return this.sendChatMessagesOnce({
                    token,
                    url,
                    body,
                    runCtx,
                });
            },
            {
                runCtx,
                step: 'SWITCH_CHAT',
                actionName: 'chat-messages',
                maxAttempts: DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
            }
        );

        const status = Number(responseMeta?.status || 0);
        const hasStatus = Number.isFinite(status) && status > 0;
        const isSuccess = hasStatus && status >= 200 && status < 300;
        const statusText = hasStatus ? `HTTP ${status}` : '未知状态';

        let conversationId = typeof responseMeta?.conversationId === 'string'
            ? responseMeta.conversationId.trim()
            : '';
        let source = conversationId ? 'sse-conversation-id' : 'sse-first-chunk';

        logInfo(runCtx, 'SWITCH_CHAT', `chat-messages 已收到响应（${statusText}）`, {
            ...responseMeta,
            conversationId: conversationId || null,
            source,
        });

        return { status, isSuccess, conversationId: conversationId || '', source };
    },

    sendChatMessagesOnce({ token, url, body, runCtx }) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const requestStartedAt = Date.now();
            let hardTimeoutTimer = null;
            let capturedConversationId = '';
            let requestController = null;
            let abortedByScript = false;

            const elapsedMs = () => Date.now() - requestStartedAt;

            const clearTimers = () => {
                if (hardTimeoutTimer) {
                    clearTimeout(hardTimeoutTimer);
                    hardTimeoutTimer = null;
                }
            };

            const abortRequest = (reason) => {
                if (!requestController || typeof requestController.abort !== 'function') {
                    return;
                }
                try {
                    abortedByScript = true;
                    requestController.abort();
                    logInfo(runCtx, 'SWITCH_CHAT', `已主动中止 chat-messages SSE: ${reason || 'no-reason'}`);
                } catch (error) {
                    logWarn(runCtx, 'SWITCH_CHAT', '主动中止 chat-messages SSE 失败', {
                        reason: reason || 'no-reason',
                        message: error?.message || String(error),
                    });
                } finally {
                    requestController = null;
                }
            };

            const callbackMeta = (response) => {
                const status = Number(response?.status || 0);
                const readyState = Number(response?.readyState || 0);
                const responseText = typeof response?.responseText === 'string' ? response.responseText : '';
                return {
                    status,
                    readyState,
                    textLength: responseText.length,
                    responseText,
                    elapsedMs: elapsedMs(),
                };
            };

            const tryCaptureConversationId = (rawText, trigger) => {
                if (capturedConversationId) return capturedConversationId;
                const conversationId = this.parseConversationIdFromEventStream(rawText);
                if (!conversationId) return '';

                capturedConversationId = conversationId;
                logInfo(runCtx, 'SWITCH_CHAT', `已从 ${trigger} 解析 conversation_id`, {
                    conversationId,
                });
                return capturedConversationId;
            };

            const finish = (trigger, responseMeta = {}) => {
                if (settled) return;
                settled = true;
                clearTimers();
                logInfo(runCtx, 'SWITCH_CHAT', `chat-messages 已结束: ${trigger}`, {
                    elapsedMs: elapsedMs(),
                    ...responseMeta,
                    conversationId: capturedConversationId || responseMeta?.conversationId || null,
                });
                resolve({
                    trigger,
                    ...responseMeta,
                    conversationId: capturedConversationId || responseMeta?.conversationId || '',
                });
            };

            hardTimeoutTimer = setTimeout(() => {
                if (settled) return;
                logWarn(runCtx, 'SWITCH_CHAT', 'chat-messages 8s 兜底超时，强制结束并刷新后续流程');
                finish('failsafe-timeout', {
                    status: 0,
                    readyState: 0,
                    textLength: 0,
                    elapsedMs: elapsedMs(),
                });
                abortRequest('failsafe-timeout');
            }, 8000);

            requestController = gmXmlHttpRequest({
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
                onreadystatechange: (response) => {
                    if (settled) return;
                    const meta = callbackMeta(response);
                    logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages onreadystatechange', {
                        status: meta.status,
                        readyState: meta.readyState,
                        textLength: meta.textLength,
                        elapsedMs: meta.elapsedMs,
                    });

                    if (meta.readyState >= 2) {
                        tryCaptureConversationId(meta.responseText, 'onreadystatechange');
                        finish(`onreadystatechange-${meta.readyState}`, {
                            status: meta.status,
                            readyState: meta.readyState,
                            textLength: meta.textLength,
                            elapsedMs: meta.elapsedMs,
                            conversationId: capturedConversationId,
                        });
                        abortRequest(capturedConversationId ? 'conversation-id-captured-readyState' : `readyState-${meta.readyState}`);
                    }
                },
                onprogress: (response) => {
                    if (settled) return;
                    const meta = callbackMeta(response);
                    logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages onprogress', {
                        status: meta.status,
                        readyState: meta.readyState,
                        textLength: meta.textLength,
                        elapsedMs: meta.elapsedMs,
                    });
                    tryCaptureConversationId(meta.responseText, 'onprogress');

                    // 一旦 SSE 有首个响应，立即结束并中断后台流，避免占用连接导致前端看不到流式内容。
                    finish('onprogress-first-chunk', {
                        status: meta.status,
                        readyState: meta.readyState,
                        textLength: meta.textLength,
                        elapsedMs: meta.elapsedMs,
                        conversationId: capturedConversationId,
                    });
                    abortRequest(capturedConversationId ? 'conversation-id-captured' : 'first-stream-chunk');
                },
                onload: (response) => {
                    if (settled) return;
                    const meta = callbackMeta(response);
                    logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages onload', {
                        status: meta.status,
                        readyState: meta.readyState,
                        textLength: meta.textLength,
                        elapsedMs: meta.elapsedMs,
                    });
                    tryCaptureConversationId(meta.responseText, 'onload');
                    finish('onload', {
                        status: meta.status,
                        readyState: meta.readyState,
                        textLength: meta.textLength,
                        elapsedMs: meta.elapsedMs,
                        conversationId: capturedConversationId,
                    });
                },
                onerror: (error) => {
                    if (settled) return;
                    clearTimers();
                    logWarn(runCtx, 'SWITCH_CHAT', 'chat-messages onerror', {
                        status: Number(error?.status || 0),
                        message: error?.error || 'network-error',
                        elapsedMs: elapsedMs(),
                    });
                    reject(withHttpStatusError(error?.error || 'chat-messages 网络请求失败', Number(error?.status || 0)));
                },
                ontimeout: () => {
                    if (settled) return;
                    clearTimers();
                    logWarn(runCtx, 'SWITCH_CHAT', 'chat-messages ontimeout', {
                        elapsedMs: elapsedMs(),
                    });
                    reject(new Error('chat-messages 请求超时'));
                },
                onabort: () => {
                    if (settled) return;
                    clearTimers();
                    logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages onabort', {
                        abortedByScript,
                        elapsedMs: elapsedMs(),
                        conversationId: capturedConversationId || null,
                    });
                    if (abortedByScript) {
                        finish('onabort-by-script', { conversationId: capturedConversationId });
                        return;
                    }
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
            const oldTokenSignature = buildTokenSignature(oldToken);

            const conversationId = this.readConversationIdByAppId(appId);
            let activeChainId = '';

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：正在读取旧账号模型配置...',
            });
            Toast.info('更换账号：正在读取旧账号模型配置', 2200);

            await this.syncAppMetaToLocalHistory({
                appId,
                token: oldToken,
                runCtx,
                step: 'SWITCH_SYNC_APP_META_OLD',
            });

            const userModelConfig = await this.fetchUserAppModelConfig({
                appId,
                token: oldToken,
                runCtx,
            });

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：正在读取旧会话消息并本地归档...',
            });
            Toast.info('更换账号：正在拉取旧会话消息', 2400);

            const oldConversation = await this.fetchConversationMessages({
                appId,
                conversationId,
                token: oldToken,
                runCtx,
                step: 'SWITCH_FETCH_MESSAGES',
                limit: 100,
                type: 'recent',
            });
            if (!oldConversation.messages.length) {
                throw new Error('旧会话消息为空，无法继续更换账号');
            }

            const latest = this.extractLatestAnswerFromMessages(
                oldConversation.messages,
                runCtx,
                'SWITCH_FETCH_MESSAGES'
            );
            const decodedAnswer = decodeEscapedText(latest.answer);
            if (!decodedAnswer.trim()) {
                throw new Error('最新消息 answer 解码后为空');
            }

            const chainBinding = await ChatHistoryService.bindConversation({
                appId,
                conversationId,
                tokenSignature: oldTokenSignature,
            });
            activeChainId = chainBinding.chainId;
            const storeResult = await ChatHistoryService.saveConversationMessages({
                appId,
                conversationId,
                chainId: activeChainId,
                tokenSignature: oldTokenSignature,
                messages: oldConversation.messages,
            });
            ChatHistoryService.markChainSynced(activeChainId, Date.now());

            logInfo(runCtx, 'SWITCH_FETCH_MESSAGES', '已提取旧会话最新消息', {
                appId,
                conversationId,
                createdAt: latest.createdAt,
                answerLength: decodedAnswer.length,
                messageCount: oldConversation.messages.length,
                savedCount: storeResult.savedCount,
                chainId: activeChainId,
            });

            if (oldConversation.hasPastRecord || oldConversation.isEarliestDataPage === false) {
                Toast.warning('旧会话可能仍有更早消息未拉取，可在“会话”Tab手动同步', 4500);
            }

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
            if (!registerResult.guideSkipped) {
                throw new Error('更换账号终止：首次引导未跳过成功，不发送 chat-messages');
            }

            await this.syncAppMetaToLocalHistory({
                appId,
                token: registerResult.token,
                runCtx,
                step: 'SWITCH_SYNC_APP_META_NEW',
            });

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：正在同步模型配置到新账号...',
            });
            Toast.info('更换账号：正在同步模型配置', 2200);
            await this.saveUserAppModelConfig({
                appId,
                token: registerResult.token,
                config: userModelConfig,
                runCtx,
            });

            const query = `${decodedAnswer}\n\n${appendText}`;
            const conversationName = `新的对话-${randomConversationSuffix(3)}`;
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：新账号已就绪，正在发送 chat-messages...',
            });
            Toast.info('更换账号：正在发送 chat-messages', 2200);

            const chatResult = await this.sendChatMessagesAndReload({
                appId,
                token: registerResult.token,
                query,
                conversationName,
                runCtx,
            });
            const newTokenSignature = buildTokenSignature(registerResult.token);

            const newConversationId = typeof chatResult?.conversationId === 'string'
                ? chatResult.conversationId.trim()
                : '';
            if (newConversationId) {
                this.upsertConversationIdInfo(appId, newConversationId, runCtx);
                ChatHistoryService.setConversationTokenSignature(appId, newConversationId, newTokenSignature);
                ChatHistoryService.bindConversation({
                    appId,
                    conversationId: newConversationId,
                    previousConversationId: conversationId,
                    preferredChainId: activeChainId,
                    tokenSignature: newTokenSignature,
                }).then((newBinding) => {
                    activeChainId = newBinding.chainId;
                    ChatHistoryService.setActiveChainId(appId, activeChainId);
                }).catch((bindError) => {
                    logWarn(runCtx, 'SWITCH_CHAT', '刷新前写入会话链失败（不影响立即刷新）', {
                        message: bindError?.message || String(bindError),
                    });
                });
            }

            const sourceText = chatResult?.source ? `，来源 ${chatResult.source}` : '';
            const statusText = Number.isFinite(Number(chatResult?.status))
                ? `HTTP ${Number(chatResult.status)}`
                : '未知状态';
            Sidebar.updateState({
                status: 'success',
                statusMessage: newConversationId
                    ? `更换账号成功：已获取 conversation_id（${statusText}${sourceText}），0.8 秒后刷新`
                    : `更换账号已发送 chat-messages（${statusText}），未拿到 conversation_id，0.8 秒后刷新`,
            });
            if (newConversationId) {
                Toast.success(`已获取新会话ID（${chatResult.source || 'sse'}），即将刷新`, 2600);
            } else {
                Toast.warning('未获取到新会话ID，仍将刷新，可在“会话”Tab手动同步', 3600);
            }

            setTimeout(() => {
                window.location.reload();
            }, 120);
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

    async loadConversationChainsForCurrentApp({ appId = '' } = {}) {
        const resolvedAppId = (typeof appId === 'string' ? appId.trim() : '') || this.extractInstalledAppId();
        if (!resolvedAppId) {
            return {
                appId: '',
                chains: [],
                activeChainId: '',
                currentConversationId: '',
            };
        }

        const currentConversationId = this.readConversationIdByAppIdSafe(resolvedAppId);
        const currentTokenSignature = buildTokenSignature(localStorage.getItem('console_token') || '');
        if (currentConversationId) {
            await ChatHistoryService.bindConversation({
                appId: resolvedAppId,
                conversationId: currentConversationId,
                tokenSignature: currentTokenSignature,
            });
        }

        const chains = await ChatHistoryService.listChainsForApp(resolvedAppId);
        const chainsWithStats = await Promise.all(
            chains.map(async (chain) => {
                const stats = await ChatHistoryService.getChainStats(chain.chainId);
                return {
                    ...chain,
                    ...stats,
                };
            })
        );
        let activeChainId = ChatHistoryService.getActiveChainId(resolvedAppId);
        if (!activeChainId && chainsWithStats[0]?.chainId) {
            activeChainId = chainsWithStats[0].chainId;
            ChatHistoryService.setActiveChainId(resolvedAppId, activeChainId);
        }

        return {
            appId: resolvedAppId,
            chains: chainsWithStats,
            activeChainId,
            currentConversationId,
        };
    },

    async getConversationViewerHtml({ appId, chainId }) {
        const resolvedAppId = typeof appId === 'string' ? appId.trim() : '';
        if (!resolvedAppId) {
            return '<html><body><p>当前页面未识别到 appId。</p></body></html>';
        }

        const resolvedChainId = (typeof chainId === 'string' ? chainId.trim() : '')
            || ChatHistoryService.getActiveChainId(resolvedAppId);
        if (!resolvedChainId) {
            return '<html><body><p>当前应用暂无本地会话链。</p></body></html>';
        }

        return ChatHistoryService.buildChainViewerHtml({
            appId: resolvedAppId,
            chainId: resolvedChainId,
        });
    },

    async manualSyncConversationChain({ appId = '', chainId = '' } = {}) {
        const runCtx = createRunContext('SYNC');
        const resolvedAppId = (typeof appId === 'string' ? appId.trim() : '') || this.extractInstalledAppId();
        if (!resolvedAppId) {
            throw new Error('当前页面不是 installed/test-installed 详情页');
        }

        const token = (localStorage.getItem('console_token') || '').trim();
        if (!token) {
            throw new Error('未找到 console_token，请先登录后再同步');
        }
        const tokenSignature = buildTokenSignature(token);

        await this.syncAppMetaToLocalHistory({
            appId: resolvedAppId,
            token,
            runCtx,
            step: 'SYNC_APP_META',
        });

        let resolvedChainId = typeof chainId === 'string' ? chainId.trim() : '';
        if (!resolvedChainId) {
            resolvedChainId = ChatHistoryService.getActiveChainId(resolvedAppId);
        }

        if (!resolvedChainId) {
            const currentConversationId = this.readConversationIdByAppIdSafe(resolvedAppId);
            if (currentConversationId) {
                const binding = await ChatHistoryService.bindConversation({
                    appId: resolvedAppId,
                    conversationId: currentConversationId,
                    tokenSignature,
                });
                resolvedChainId = binding.chainId;
            }
        }

        if (!resolvedChainId) {
            throw new Error('未找到可同步的会话链');
        }

        const currentConversationId = this.readConversationIdByAppIdSafe(resolvedAppId);
        if (currentConversationId) {
            await ChatHistoryService.bindConversation({
                appId: resolvedAppId,
                conversationId: currentConversationId,
                preferredChainId: resolvedChainId,
                tokenSignature,
            });
        }

        const chain = await ChatHistoryService.getChain(resolvedChainId);
        if (!chain) {
            throw new Error(`会话链不存在: ${resolvedChainId}`);
        }

        const conversationIds = Array.isArray(chain.conversationIds)
            ? chain.conversationIds.filter((item) => typeof item === 'string' && item.trim())
            : [];
        if (conversationIds.length === 0) {
            throw new Error('当前会话链无 conversation_id，无法同步');
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
        logInfo(runCtx, 'SYNC', '会话同步过滤结果（按 token 绑定）', {
            chainId: resolvedChainId,
            totalConversationCount: conversationIds.length,
            allowedConversationCount: allowedConversationIds.length,
            skippedNoPermissionCount: skippedNoPermissionConversationIds.length,
        });
        if (allowedConversationIds.length === 0) {
            throw new Error('当前链路会话均不属于当前账号 token，已跳过无权限同步');
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
                    type: 'recent',
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
                    messages: result.messages,
                });
                totalSaved += storeResult.savedCount;
                successCount++;
            } catch (error) {
                failedConversationIds.push(conversationId);
                logWarn(runCtx, 'SYNC', '单个会话同步失败，继续同步其他会话', {
                    conversationId,
                    message: error?.message || String(error),
                });
            }
        }

        if (successCount === 0) {
            throw new Error('会话同步失败：所有 conversation_id 均同步失败');
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
            hasIncomplete,
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
