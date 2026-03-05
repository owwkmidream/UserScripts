import { CONFIG } from '../../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue } from '../../gm.js';
import { ApiService } from '../../services/api-service.js';
import { ChatHistoryService } from '../../services/chat-history-service.js';
import { Sidebar } from '../../ui/sidebar.js';
import { Toast } from '../../ui/toast.js';
import { generateUsername, generatePassword, delay } from '../../utils/random.js';
import { extractVerificationCode } from '../../utils/code-extractor.js';
import { simulateInput } from '../../utils/dom.js';
import {
    createRunContext,
    isDebugEnabled,
    logDebug,
    logError,
    logInfo,
    logWarn,
} from '../../utils/logger.js';
import {
    X_LANGUAGE,
    SITE_ENDPOINTS,
    DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
    DEFAULT_SWITCH_WORLD_BOOK_TRIGGER,
    readErrorMessage,
    normalizeTimestamp,
    decodeEscapedText,
    isAnswerEmpty,
    normalizeSwitchTriggerWord,
    cloneJsonSafe,
    stringifyJsonWithUnicodeEscapes,
    randomConversationSuffix,
    buildTokenSignature,
    withHttpStatusError,
} from './shared.js';

export const SiteApiMethods = {
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
        const timeoutMs = options.timeout ?? 30000;
        const hasRawBody = typeof options.rawBody === 'string';
        const serializedBody = hasRawBody
            ? options.rawBody
            : (options.body === undefined
                ? undefined
                : (options.unicodeEscapeBody === true
                    ? stringifyJsonWithUnicodeEscapes(options.body)
                    : JSON.stringify(options.body)));
        const headers = {
            'Content-Type': 'application/json',
            'X-Language': X_LANGUAGE,
            ...(options.headers || {}),
        };

        logInfo(runCtx, step, `${method} ${path} 请求开始`);
        logDebug(runCtx, step, '请求详情', {
            url,
            headers,
            body: options.body ?? null,
            bodyMode: hasRawBody
                ? 'raw-body'
                : (options.unicodeEscapeBody ? 'json-with-unicode-escape' : 'json'),
            serializedBodyLength: typeof serializedBody === 'string' ? serializedBody.length : 0,
            requestMode: 'page-fetch-first',
        });

        let httpStatus = 0;
        let raw = '';
        let payload = null;

        const runPageFetch = async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, {
                    method,
                    headers,
                    body: serializedBody,
                    credentials: 'include',
                    signal: controller.signal,
                    cache: 'no-store',
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
            logWarn(runCtx, step, '页面 fetch 请求失败，回退 GM 请求', {
                message: fetchError?.message || String(fetchError),
            });

            const fallbackResponse = await gmRequestJson({
                method,
                url,
                headers,
                ...((hasRawBody || (options.unicodeEscapeBody && serializedBody !== undefined))
                    ? { rawBody: serializedBody || '' }
                    : { body: options.body }),
                timeout: timeoutMs,
                anonymous: true,
            });
            httpStatus = Number(fallbackResponse.status || 0);
            raw = fallbackResponse.raw || '';
            payload = fallbackResponse.json;
        }

        logInfo(runCtx, step, `${method} ${path} 响应`, {
            httpStatus,
            statusField: payload?.status,
            result: payload?.result,
            success: payload?.success,
            code: payload?.code,
            message: payload?.message,
        });
        logDebug(runCtx, step, '原始响应内容', {
            raw,
            json: payload,
        });

        if (httpStatus < 200 || httpStatus >= 300) {
            throw withHttpStatusError(
                readErrorMessage(payload, `接口 ${path} 请求失败: HTTP ${httpStatus}`),
                httpStatus
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


    async fetchAccountPoint({ appId = '', token = '', runCtx, step = 'GET_ACCOUNT_POINT', maxAttempts = 1 }) {
        const normalizedAppId = typeof appId === 'string' ? appId.trim() : '';
        const headers = token
            ? { Authorization: `Bearer ${token}` }
            : {};
        const path = SITE_ENDPOINTS.ACCOUNT_POINT;
        const payload = await this.requestSiteApi(path, {
            method: 'GET',
            headers,
            maxAttempts,
            strictCode: true,
            acceptableCodes: [0, 200, 100000],
        }, runCtx, step);

        const rawPoints = payload?.data?.points ?? payload?.points;
        const points = Number(rawPoints);
        if (!Number.isFinite(points)) {
            throw new Error(`account/point 返回积分无效: ${rawPoints ?? 'null'}`);
        }

        logInfo(runCtx, step, 'account/point 获取成功', {
            appId: normalizedAppId || null,
            points,
        });
        return {
            appId: normalizedAppId,
            points,
            rawPoints,
            payload,
        };
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
        logInfo(runCtx, 'SKIP_GUIDE', '开始跳过首次引导（快速模式：不请求 /profile 校验）');
        await this.skipFirstGuideOnce(token, runCtx);
        logInfo(runCtx, 'SKIP_GUIDE', '首次引导跳过请求已提交（快速模式）');
    },

};
