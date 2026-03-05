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

export const ModelConfigMethods = {
    buildWorldBookValueWithUserSeparator(answerText) {
        const baseText = typeof answerText === 'string'
            ? answerText.replace(/\s+$/g, '')
            : String(answerText ?? '').replace(/\s+$/g, '');
        const separator = '\n---continue with\nuser:\n';

        if (!baseText) return separator;
        if (baseText.endsWith(separator.trimEnd())) {
            return `${baseText.replace(/\s*$/g, '')}\n`;
        }
        return `${baseText}${separator}`;
    },


    resolveSwitchTriggerWordFromWorldBook(worldBook) {
        if (!Array.isArray(worldBook)) return '';

        for (const entry of worldBook) {
            const key = typeof entry?.key === 'string' ? entry.key : '';
            const triggerWord = normalizeSwitchTriggerWord(key);
            if (triggerWord) {
                return triggerWord;
            }
        }
        return '';
    },


    prepareWorldBookConfigForSwitch({
        baseConfig,
        answer,
        runCtx,
        explicitTriggerWord = '',
    }) {
        const normalizedAnswer = decodeEscapedText(
            typeof answer === 'string' ? answer : String(answer ?? '')
        ).trim();
        if (!normalizedAnswer) {
            throw new Error('旧会话 answer 为空，无法写入 world_book');
        }
        const worldBookValue = this.buildWorldBookValueWithUserSeparator(normalizedAnswer);

        const clonedConfig = cloneJsonSafe(baseConfig);
        if (!clonedConfig || typeof clonedConfig !== 'object' || Array.isArray(clonedConfig)) {
            throw new Error('user_app_model_config 结构异常，无法写入 world_book');
        }

        const existingWorldBook = Array.isArray(clonedConfig.world_book)
            ? [...clonedConfig.world_book]
            : [];
        const triggerWord = normalizeSwitchTriggerWord(explicitTriggerWord)
            || this.resolveSwitchTriggerWordFromWorldBook(existingWorldBook)
            || DEFAULT_SWITCH_WORLD_BOOK_TRIGGER;
        const scriptEntryKey = `_or_${triggerWord}`;

        const matchedIndexes = [];
        existingWorldBook.forEach((entry, index) => {
            const key = typeof entry?.key === 'string' ? entry.key.trim() : '';
            if (key === scriptEntryKey) {
                matchedIndexes.push(index);
            }
        });
        const matchedIndex = matchedIndexes.length ? matchedIndexes[0] : -1;

        const entryBase = matchedIndex >= 0 && existingWorldBook[matchedIndex] && typeof existingWorldBook[matchedIndex] === 'object'
            ? { ...existingWorldBook[matchedIndex] }
            : {};
        const entryKey = scriptEntryKey;
        const worldBookEntry = {
            ...entryBase,
            key: entryKey,
            value: worldBookValue,
            group: typeof entryBase.group === 'string' ? entryBase.group : '',
            key_region: Number.isFinite(Number(entryBase.key_region))
                ? Number(entryBase.key_region)
                : 2,
            value_region: Number.isFinite(Number(entryBase.value_region))
                ? Number(entryBase.value_region)
                : 1,
        };

        const nextWorldBook = existingWorldBook.filter((_, index) => !matchedIndexes.includes(index));
        if (matchedIndex >= 0) {
            const insertIndex = Math.min(matchedIndex, nextWorldBook.length);
            nextWorldBook.splice(insertIndex, 0, worldBookEntry);
        } else {
            nextWorldBook.unshift(worldBookEntry);
        }
        clonedConfig.world_book = nextWorldBook;
        const removedDuplicateCount = Math.max(0, matchedIndexes.length - 1);

        logInfo(
            runCtx,
            'SWITCH_WORLD_BOOK',
            matchedIndex >= 0
                ? '已归并并替换脚本 world_book 触发词条目'
                : '已新增脚本 world_book 触发词条目',
            {
                triggerWord,
                worldBookCount: nextWorldBook.length,
                entryKey: worldBookEntry.key,
                answerLength: normalizedAnswer.length,
                valueLength: worldBookValue.length,
                removedDuplicateCount,
            }
        );
        logDebug(runCtx, 'SWITCH_WORLD_BOOK', 'world_book 写入后的配置', {
            worldBook: nextWorldBook,
        });

        return {
            config: clonedConfig,
            triggerWord,
            worldBookEntry,
            replaced: matchedIndex >= 0,
        };
    },


    buildSwitchQuery({ triggerWord, appendText }) {
        const normalizedTrigger = normalizeSwitchTriggerWord(triggerWord) || DEFAULT_SWITCH_WORLD_BOOK_TRIGGER;
        const normalizedAppendText = typeof appendText === 'string' ? appendText.trim() : '';
        if (!normalizedAppendText) {
            return `${normalizedTrigger}\n`;
        }

        let bodyText = normalizedAppendText;
        if (bodyText.startsWith(normalizedTrigger)) {
            bodyText = bodyText.slice(normalizedTrigger.length).trimStart();
        }

        if (!bodyText) {
            return `${normalizedTrigger}\n`;
        }

        return `${normalizedTrigger}\n${bodyText}`;
    },


    extractWorldBookFromModelConfigPayload(payload) {
        const candidates = [];
        const data = payload?.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            candidates.push(data);
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            candidates.push(payload);
        }
        for (const item of candidates) {
            if (Array.isArray(item.world_book)) {
                return item.world_book;
            }
        }
        return null;
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


    async saveUserAppModelConfig({
        appId,
        token,
        config,
        runCtx,
        ensureWorldBookNotEmpty = false,
        maxWorldBookPostAttempts = 1,
        unicodeEscapeBody = false,
    }) {
        const path = `${SITE_ENDPOINTS.APPS}/${appId}/user_app_model_config`;
        const attempts = this.resolveRetryAttempts(maxWorldBookPostAttempts);
        let lastPayload = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            lastPayload = await this.requestSiteApi(path, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: config,
                unicodeEscapeBody,
            }, runCtx, 'SWITCH_POST_MODEL_CONFIG');

            const responseWorldBook = this.extractWorldBookFromModelConfigPayload(lastPayload);
            const hasValidWorldBook = Array.isArray(responseWorldBook) && responseWorldBook.length > 0;

            if (ensureWorldBookNotEmpty && !hasValidWorldBook) {
                const hasNext = attempt < attempts;
                logWarn(runCtx, 'SWITCH_POST_MODEL_CONFIG', 'POST 返回 world_book 无效（为空或缺失），准备重试', {
                    appId,
                    attempt,
                    attempts,
                    worldBookType: Array.isArray(responseWorldBook) ? 'array' : typeof responseWorldBook,
                    worldBookCount: Array.isArray(responseWorldBook) ? responseWorldBook.length : null,
                });
                if (hasNext) {
                    await delay(220 * attempt);
                    continue;
                }
                throw new Error('保存模型配置失败：返回 world_book 为空或缺失，已重试仍未恢复');
            }

            logInfo(runCtx, 'SWITCH_POST_MODEL_CONFIG', '新账号 user_app_model_config 已同步', {
                appId,
                configType: Array.isArray(config) ? 'array' : typeof config,
                attempt,
                attempts,
                ensureWorldBookNotEmpty,
                worldBookCount: Array.isArray(responseWorldBook) ? responseWorldBook.length : null,
                unicodeEscapeBody,
            });
            return lastPayload;
        }

        return lastPayload;
    },

};
