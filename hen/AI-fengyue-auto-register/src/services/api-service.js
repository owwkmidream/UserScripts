import { CONFIG } from '../constants.js';
import { gmGetValue, gmSetValue, gmXmlHttpRequest } from '../gm.js';
import { APP_STATE } from '../state.js';

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

    incrementUsageCount() {
        const count = this.getUsageCount() + 1;
        gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, count);
        APP_STATE.refs.sidebar?.updateUsageDisplay();
        return count;
    },

    resetUsageCount() {
        gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_COUNT, 0);
        gmSetValue(CONFIG.STORAGE_KEYS.API_USAGE_RESET_DATE, new Date().toISOString());
        APP_STATE.refs.sidebar?.updateUsageDisplay();
    },

    getRemainingQuota() {
        return CONFIG.API_QUOTA_LIMIT - this.getUsageCount();
    },

    isQuotaExceeded() {
        return this.getUsageCount() >= CONFIG.API_QUOTA_LIMIT;
    },

    request(endpoint, options = {}) {
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
                onerror: () => {
                    reject(new Error('网络请求失败'));
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
