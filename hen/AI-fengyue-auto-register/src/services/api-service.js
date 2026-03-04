import { CONFIG } from '../constants.js';
import { gmGetValue, gmSetValue, gmXmlHttpRequest } from '../gm.js';
import {
    isRetryableNetworkError,
    resolveRetryAttempts as resolveRetryAttemptsUtil,
} from '../utils/retry-policy.js';

const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS = 3;
const usageListeners = new Set();

export const ApiService = {
    getApiKey() {
        return gmGetValue(CONFIG.STORAGE_KEYS.API_KEY, CONFIG.DEFAULT_API_KEY);
    },

    setApiKey(key) {
        gmSetValue(CONFIG.STORAGE_KEYS.API_KEY, key);
        this.resetUsageCount();
    },

    getUsageCount() {
        return gmGetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, 0);
    },

    getUsageSnapshot() {
        const used = this.getUsageCount();
        const limit = CONFIG.API_QUOTA_LIMIT;
        const remaining = this.getRemainingQuota();
        const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
        return {
            used,
            limit,
            remaining,
            percentage,
        };
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
        for (const listener of usageListeners) {
            try {
                listener(snapshot);
            } catch {
                // 忽略订阅方异常，避免影响主流程。
            }
        }
    },

    incrementUsageCount() {
        const count = this.getUsageCount() + 1;
        gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, count);
        this.emitUsageChange(this.getUsageSnapshot());
        return count;
    },

    resetUsageCount() {
        gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, 0);
        gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_RESET_DATE, new Date().toISOString());
        this.emitUsageChange(this.getUsageSnapshot());
    },

    getRemainingQuota() {
        return CONFIG.API_QUOTA_LIMIT - this.getUsageCount();
    },

    isQuotaExceeded() {
        return this.getUsageCount() >= CONFIG.API_QUOTA_LIMIT;
    },

    resolveRetryAttempts(maxAttempts) {
        return resolveRetryAttemptsUtil(maxAttempts, DEFAULT_OBJECTIVE_RETRY_ATTEMPTS);
    },

    isObjectiveRetryError(error) {
        return isRetryableNetworkError(error, { includeHttpStatus: false });
    },

    async request(endpoint, options = {}) {
        const attempts = this.resolveRetryAttempts(options.maxAttempts);
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await this.requestOnce(endpoint, options);
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

    requestOnce(endpoint, options = {}) {
        return new Promise((resolve, reject) => {
            if (this.isQuotaExceeded()) {
                reject(new Error(`API 配额已用完 (${this.getUsageCount()}/${CONFIG.API_QUOTA_LIMIT})`));
                return;
            }

            const url = `${CONFIG.API_BASE}${endpoint}`;
            gmXmlHttpRequest({
                method: options.method || 'GET',
                url,
                anonymous: true,
                headers: {
                    'X-API-Key': this.getApiKey(),
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                data: options.body ? JSON.stringify(options.body) : undefined,
                timeout: options.timeout ?? 30000,
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.success) {
                            this.incrementUsageCount();
                            resolve(data.data);
                        } else {
                            reject(new Error(data.error || '请求失败'));
                        }
                    } catch {
                        reject(new Error('解析响应失败'));
                    }
                },
                onerror: (error) => {
                    reject(new Error(error?.error || '网络请求失败'));
                },
                ontimeout: () => {
                    reject(new Error('网络请求超时'));
                },
                onabort: () => {
                    reject(new Error('网络请求被中止'));
                },
            });
        });
    },

    async generateEmail() {
        const data = await this.request('/generate-email');
        return data.email;
    },

    async getEmails(email) {
        const data = await this.request(`/emails?email=${encodeURIComponent(email)}`);
        return data.emails || [];
    },
};
