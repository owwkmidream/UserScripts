import { CONFIG } from '../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue } from '../gm.js';
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
};

function readErrorMessage(payload, fallback) {
    if (!payload || typeof payload !== 'object') return fallback;
    const raw = payload.error ?? payload.message ?? payload.msg ?? payload.detail ?? payload.errmsg;
    if (typeof raw !== 'string') return fallback;
    const message = raw.trim();
    if (!message || /^(ok|success)$/i.test(message)) return fallback;
    return message;
}

export const AutoRegister = {
    registrationStartTime: null,

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

    async skipFirstGuide(token, runCtx) {
        logInfo(runCtx, 'SKIP_GUIDE', '开始跳过首次引导');
        await this.setAccountGender(token, runCtx);
        await this.submitFavoriteTags(token, runCtx);
        await this.setFirstVisitFlag(token, runCtx);
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

    async start() {
        const runCtx = createRunContext('REG');
        let currentStep = '初始化';
        logInfo(runCtx, 'START', '开始自动注册流程', {
            href: window.location.href,
            debugEnabled: isDebugEnabled(),
        });
        try {
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

            currentStep = '发送验证码';
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '正在发送验证码...',
                verificationCode: '',
            });
            await this.sendRegisterEmailCode(email, runCtx);

            currentStep = '轮询邮箱验证码';
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '验证码已发送，正在自动轮询邮箱...',
            });

            const code = await this.pollVerificationCode(email, this.registrationStartTime, 10, 2000, runCtx);
            if (!code) {
                throw new Error('未在轮询窗口内获取到验证码');
            }

            Sidebar.updateState({
                verificationCode: code,
                statusMessage: `验证码已获取: ${code}`,
            });

            const { codeInput } = this.getFormElements();
            if (codeInput) {
                this.simulateInput(codeInput, code);
                logInfo(runCtx, 'FORM', '验证码已自动填充到输入框');
            } else {
                logWarn(runCtx, 'FORM', '未找到验证码输入框，跳过自动填充');
            }

            currentStep = '获取注册令牌';
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '正在获取注册令牌...',
            });
            const regToken = await this.getRegToken(runCtx);

            currentStep = '提交注册';
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '正在提交注册...',
            });
            const token = await this.registerWithCode({
                username,
                email,
                password,
                code,
                regToken,
            }, runCtx);

            localStorage.setItem('console_token', token);
            logInfo(runCtx, 'AUTH', '已写入 localStorage.console_token');
            logDebug(runCtx, 'AUTH', 'localStorage 写入 token 完整值', { token });

            currentStep = '跳过首次引导';
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '注册成功，正在跳过首次引导...',
            });

            let guideSkipped = true;
            try {
                await this.skipFirstGuide(token, runCtx);
            } catch (guideError) {
                guideSkipped = false;
                logError(runCtx, 'SKIP_GUIDE', '首次引导跳过失败', {
                    errorName: guideError?.name,
                    message: guideError?.message,
                    stack: guideError?.stack,
                });
                Toast.warning(`注册成功，但跳过首次引导失败: ${guideError.message}`, 6000);
            }

            Sidebar.updateState({
                status: 'success',
                statusMessage: guideSkipped
                    ? '注册成功，已写入 console_token 并跳过首次引导'
                    : '注册成功，已写入 console_token（首次引导跳过失败）',
            });
            Toast.success(guideSkipped
                ? '注册成功，已自动跳过首次引导并写入登录态'
                : '注册成功，已写入登录态；首次引导跳过失败', 5000);
            logInfo(runCtx, 'DONE', '自动注册流程完成');
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
