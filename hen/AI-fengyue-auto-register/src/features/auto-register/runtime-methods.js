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

export const RuntimeMethods = {
    resolveRetryAttempts(maxAttempts) {
        const parsed = Number(maxAttempts);
        if (Number.isInteger(parsed) && parsed >= 1) {
            return parsed;
        }
        return DEFAULT_OBJECTIVE_RETRY_ATTEMPTS;
    },


    isAutoReloadEnabled() {
        const saved = gmGetValue(CONFIG.STORAGE_KEYS.AUTO_RELOAD_ENABLED, true);
        return !(saved === false || saved === 'false' || saved === 0 || saved === '0');
    },


    reloadPageIfEnabled({ delayMs = 0, runCtx, step = 'RELOAD', reason = '' } = {}) {
        if (!this.isAutoReloadEnabled()) {
            logInfo(runCtx, step, '自动刷新开关已关闭，跳过 window.location.reload', {
                reason: reason || null,
            });
            Toast.info('自动刷新已关闭，请手动刷新页面', 3200);
            return false;
        }

        const normalizedDelay = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 0;
        if (normalizedDelay > 0) {
            setTimeout(() => {
                window.location.reload();
            }, normalizedDelay);
        } else {
            window.location.reload();
        }
        logInfo(runCtx, step, '已触发 window.location.reload', {
            reason: reason || null,
            delayMs: normalizedDelay,
        });
        return true;
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

};
