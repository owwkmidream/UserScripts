import { CONFIG } from '../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue } from '../gm.js';
import { getMailProviderById, MAIL_PROVIDERS } from './mail/provider-registry.js';
import {
    isRetryableNetworkError,
    resolveRetryAttempts as resolveRetryAttemptsUtil,
} from '../utils/retry-policy.js';

const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS = 3;
const DEFAULT_PROVIDER_ID = MAIL_PROVIDERS[0]?.id || 'gptmail';
const usageListeners = new Set();

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clampPercentage(value) {
    return Math.max(0, Math.min(toNumber(value, 0), 100));
}

function readProviderApiKeys() {
    const stored = gmGetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_API_KEYS, null);
    if (isPlainObject(stored)) {
        return { ...stored };
    }

    const legacyKey = gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, '');
    return legacyKey ? { [DEFAULT_PROVIDER_ID]: legacyKey } : {};
}

function writeProviderApiKeys(providerApiKeys) {
    gmSetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_API_KEYS, providerApiKeys);
    const defaultProviderKey = providerApiKeys?.[DEFAULT_PROVIDER_ID];
    if (typeof defaultProviderKey === 'string') {
        gmSetValue(CONFIG.STORAGE_KEYS.API_KEY, defaultProviderKey);
    }
}

function readUsageSnapshots() {
    const stored = gmGetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_USAGE_SNAPSHOTS, null);
    if (isPlainObject(stored)) {
        return { ...stored };
    }
    return {};
}

function writeUsageSnapshots(usageSnapshots) {
    gmSetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_USAGE_SNAPSHOTS, usageSnapshots);
}

function createFallbackUsageSnapshot(provider) {
    const supportsUsage = provider?.supportsUsage !== false;
    const limit = supportsUsage
        ? Math.max(0, toNumber(provider?.defaultQuotaLimit, CONFIG.API_QUOTA_LIMIT))
        : 0;
    return {
        providerId: provider?.id || DEFAULT_PROVIDER_ID,
        supportsUsage,
        used: 0,
        limit,
        remaining: limit,
        percentage: 0,
        dailyLimit: 0,
        dailyUsed: 0,
        dailyRemaining: -1,
        totalLimit: limit,
        totalUsed: 0,
        totalRemaining: limit,
        hasUsage: false,
        usageStatus: supportsUsage ? 'pending' : 'unsupported',
        raw: null,
    };
}

function normalizeStoredUsageSnapshot(provider, snapshot) {
    const fallback = createFallbackUsageSnapshot(provider);
    if (!isPlainObject(snapshot)) {
        return fallback;
    }

    const limit = Math.max(0, toNumber(snapshot.limit ?? snapshot.totalLimit, fallback.limit));
    const used = Math.max(0, toNumber(snapshot.used ?? snapshot.totalUsed, 0));
    const remaining = Number.isFinite(Number(snapshot.remaining))
        ? Number(snapshot.remaining)
        : limit - used;
    const percentage = limit > 0
        ? clampPercentage(snapshot.percentage ?? ((used / limit) * 100))
        : 0;
    const dailyLimit = Math.max(0, toNumber(snapshot.dailyLimit, 0));
    const dailyUsed = Math.max(0, toNumber(snapshot.dailyUsed, 0));
    const dailyRemaining = Number.isFinite(Number(snapshot.dailyRemaining))
        ? Number(snapshot.dailyRemaining)
        : (dailyLimit > 0 ? dailyLimit - dailyUsed : -1);
    const totalLimit = Math.max(0, toNumber(snapshot.totalLimit, limit));
    const totalUsed = Math.max(0, toNumber(snapshot.totalUsed, used));
    const totalRemaining = Number.isFinite(Number(snapshot.totalRemaining))
        ? Number(snapshot.totalRemaining)
        : remaining;

    return {
        ...fallback,
        ...snapshot,
        providerId: provider.id,
        used,
        limit,
        remaining,
        percentage,
        dailyLimit,
        dailyUsed,
        dailyRemaining,
        totalLimit,
        totalUsed,
        totalRemaining,
        supportsUsage: snapshot.supportsUsage !== false,
        hasUsage: snapshot.hasUsage === true,
        usageStatus: snapshot.hasUsage === true
            ? 'available'
            : (snapshot.usageStatus || fallback.usageStatus),
        raw: isPlainObject(snapshot.raw) ? snapshot.raw : null,
    };
}

export const MailService = {
    listProviders() {
        return MAIL_PROVIDERS.map((provider) => ({
            id: provider.id,
            name: provider.name,
            supportsUsage: provider.supportsUsage !== false,
            apiKeyLabel: provider.apiKeyLabel,
            apiKeyPlaceholder: provider.apiKeyPlaceholder,
        }));
    },

    resolveProvider(providerId = this.getCurrentProviderId()) {
        const provider = getMailProviderById(providerId);
        if (!provider) {
            throw new Error(`未找到邮件提供商: ${providerId}`);
        }
        return provider;
    },

    getCurrentProviderId() {
        const savedProviderId = gmGetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_ID, DEFAULT_PROVIDER_ID);
        return getMailProviderById(savedProviderId) ? savedProviderId : DEFAULT_PROVIDER_ID;
    },

    setCurrentProviderId(providerId) {
        const provider = this.resolveProvider(providerId);
        gmSetValue(CONFIG.STORAGE_KEYS.MAIL_PROVIDER_ID, provider.id);
        this.emitUsageChange(this.getUsageSnapshot(provider.id));
        return provider.id;
    },

    getCurrentProvider() {
        return this.resolveProvider();
    },

    getCurrentProviderMeta(providerId = this.getCurrentProviderId()) {
        const provider = this.resolveProvider(providerId);
        return {
            id: provider.id,
            name: provider.name,
            supportsUsage: provider.supportsUsage !== false,
            apiKeyLabel: provider.apiKeyLabel || '邮件 API Key',
            apiKeyPlaceholder: provider.apiKeyPlaceholder || '输入你的邮件 API Key',
            defaultApiKey: provider.defaultApiKey || CONFIG.DEFAULT_API_KEY,
        };
    },

    getDefaultApiKey(providerId = this.getCurrentProviderId()) {
        return this.getCurrentProviderMeta(providerId).defaultApiKey;
    },

    getApiKey(providerId = this.getCurrentProviderId()) {
        const provider = this.resolveProvider(providerId);
        const providerApiKeys = readProviderApiKeys();
        const savedKey = typeof providerApiKeys[provider.id] === 'string'
            ? providerApiKeys[provider.id].trim()
            : '';
        return savedKey || this.getDefaultApiKey(provider.id);
    },

    setApiKey(key, providerId = this.getCurrentProviderId()) {
        const provider = this.resolveProvider(providerId);
        const normalizedKey = typeof key === 'string' && key.trim()
            ? key.trim()
            : this.getDefaultApiKey(provider.id);
        const providerApiKeys = readProviderApiKeys();
        providerApiKeys[provider.id] = normalizedKey;
        writeProviderApiKeys(providerApiKeys);
        this.clearUsageSnapshot(provider.id, {
            emit: provider.id === this.getCurrentProviderId(),
        });
        return normalizedKey;
    },

    getUsageCount(providerId = this.getCurrentProviderId()) {
        return this.getUsageSnapshot(providerId).used;
    },

    getRemainingQuota(providerId = this.getCurrentProviderId()) {
        return this.getUsageSnapshot(providerId).remaining;
    },

    getUsageSnapshot(providerId = this.getCurrentProviderId()) {
        const provider = this.resolveProvider(providerId);
        const usageSnapshots = readUsageSnapshots();
        return normalizeStoredUsageSnapshot(provider, usageSnapshots[provider.id]);
    },

    updateUsageSnapshot(snapshot, providerId = this.getCurrentProviderId()) {
        const provider = this.resolveProvider(providerId);
        if (!snapshot) {
            return this.getUsageSnapshot(provider.id);
        }

        const normalizedSnapshot = normalizeStoredUsageSnapshot(provider, {
            ...snapshot,
            hasUsage: snapshot.hasUsage !== false,
        });
        const usageSnapshots = readUsageSnapshots();
        usageSnapshots[provider.id] = normalizedSnapshot;
        writeUsageSnapshots(usageSnapshots);

        if (provider.id === this.getCurrentProviderId()) {
            this.emitUsageChange(normalizedSnapshot);
        }
        return normalizedSnapshot;
    },

    resetUsageCount(providerId = this.getCurrentProviderId()) {
        this.clearUsageSnapshot(providerId);
    },

    clearUsageSnapshot(providerId = this.getCurrentProviderId(), { emit = true } = {}) {
        const provider = this.resolveProvider(providerId);
        const usageSnapshots = readUsageSnapshots();
        if (provider.id in usageSnapshots) {
            delete usageSnapshots[provider.id];
            writeUsageSnapshots(usageSnapshots);
        }
        if (emit) {
            this.emitUsageChange(this.getUsageSnapshot(provider.id));
        }
    },

    subscribeUsageChange(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        usageListeners.add(listener);
        return () => {
            usageListeners.delete(listener);
        };
    },

    emitUsageChange(snapshot = this.getUsageSnapshot()) {
        const normalizedSnapshot = normalizeStoredUsageSnapshot(this.getCurrentProvider(), snapshot);
        for (const listener of usageListeners) {
            try {
                listener(normalizedSnapshot);
            } catch {
                // 忽略订阅方异常，避免影响主流程。
            }
        }
    },

    resolveRetryAttempts(maxAttempts) {
        return resolveRetryAttemptsUtil(maxAttempts, DEFAULT_OBJECTIVE_RETRY_ATTEMPTS);
    },

    isObjectiveRetryError(error) {
        return isRetryableNetworkError(error, { includeHttpStatus: false });
    },

    async request(endpoint, options = {}) {
        const provider = this.resolveProvider(options.providerId);
        const attempts = this.resolveRetryAttempts(options.maxAttempts);
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await this.requestOnce(provider, endpoint, options);
            } catch (error) {
                lastError = error;
                const hasNext = attempt < attempts;
                if (!hasNext || !this.isObjectiveRetryError(error)) {
                    throw error;
                }
                const waitMs = 700 * attempt;
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        }

        throw lastError || new Error('请求失败');
    },

    async requestOnce(provider, endpoint, options = {}) {
        const response = await gmRequestJson({
            method: options.method || 'GET',
            url: `${provider.baseUrl}${endpoint}`,
            headers: provider.buildHeaders({
                apiKey: this.getApiKey(provider.id),
                headers: options.headers,
            }),
            body: options.body,
            timeout: options.timeout ?? 30000,
            anonymous: true,
        });

        if (!response.json) {
            throw new Error('解析响应失败');
        }

        const parsedResponse = provider.parseResponsePayload(response.json, {
            endpoint,
            status: response.status,
            headers: response.headers,
        });
        const usageSnapshot = provider.normalizeUsage(parsedResponse.usage);
        if (usageSnapshot) {
            this.updateUsageSnapshot(usageSnapshot, provider.id);
        }

        return parsedResponse.data;
    },

    async generateEmail() {
        const provider = this.getCurrentProvider();
        const requestConfig = provider.createGenerateEmailRequest();
        const data = await this.request(requestConfig.endpoint, {
            providerId: provider.id,
            method: requestConfig.method,
            headers: requestConfig.headers,
            body: requestConfig.body,
            timeout: requestConfig.timeout,
        });
        return provider.extractGeneratedEmail(data);
    },

    async getEmails(email) {
        const provider = this.getCurrentProvider();
        const requestConfig = provider.createGetEmailsRequest(email);
        const data = await this.request(requestConfig.endpoint, {
            providerId: provider.id,
            method: requestConfig.method,
            headers: requestConfig.headers,
            body: requestConfig.body,
            timeout: requestConfig.timeout,
        });
        return provider.extractEmails(data);
    },
};
