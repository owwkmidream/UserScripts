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

export const ConversationMethods = {
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

};
