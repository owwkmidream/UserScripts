import { CONFIG } from '../../../constants.js';

function toNumber(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clampPercentage(value) {
    const numericValue = toNumber(value, 0);
    return Math.max(0, Math.min(numericValue, 100));
}

export const GPTMailProvider = {
    id: 'gptmail',
    name: 'GPTMail',
    supportsUsage: true,
    baseUrl: CONFIG.API_BASE,
    defaultApiKey: CONFIG.DEFAULT_API_KEY,
    defaultQuotaLimit: CONFIG.API_QUOTA_LIMIT,
    apiKeyLabel: 'GPTMail API Key',
    apiKeyPlaceholder: `输入你的 API Key (默认: ${CONFIG.DEFAULT_API_KEY})`,

    buildHeaders({ apiKey, headers = {} }) {
        return {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            ...headers,
        };
    },

    parseResponsePayload(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('解析响应失败');
        }
        if (!payload.success) {
            throw new Error(payload.error || '请求失败');
        }
        return {
            data: payload.data ?? null,
            usage: payload.usage ?? null,
        };
    },

    normalizeUsage(usage) {
        if (!usage || typeof usage !== 'object') {
            return null;
        }

        const totalLimit = Math.max(0, toNumber(usage.total_limit, this.defaultQuotaLimit));
        const totalUsed = Math.max(0, toNumber(usage.total_usage, 0));
        const totalRemaining = Number.isFinite(Number(usage.remaining_total))
            ? Number(usage.remaining_total)
            : totalLimit - totalUsed;

        const dailyLimit = Math.max(0, toNumber(usage.daily_limit, 0));
        const dailyUsed = Math.max(0, toNumber(usage.used_today, 0));
        const dailyRemaining = Number.isFinite(Number(usage.remaining_today))
            ? Number(usage.remaining_today)
            : (dailyLimit > 0 ? dailyLimit - dailyUsed : -1);

        const limit = totalLimit > 0 ? totalLimit : this.defaultQuotaLimit;
        const percentage = limit > 0 ? clampPercentage((totalUsed / limit) * 100) : 0;

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
            usageStatus: 'available',
            raw: usage,
        };
    },

    createGenerateEmailRequest() {
        return {
            endpoint: '/generate-email',
            method: 'GET',
        };
    },

    createGetEmailsRequest(email) {
        return {
            endpoint: `/emails?email=${encodeURIComponent(email)}`,
            method: 'GET',
        };
    },

    extractGeneratedEmail(data) {
        const email = typeof data?.email === 'string' ? data.email.trim() : '';
        if (!email) {
            throw new Error('邮件接口未返回有效邮箱');
        }
        return email;
    },

    extractEmails(data) {
        return Array.isArray(data?.emails) ? data.emails : [];
    },
};
