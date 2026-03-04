import { ChatHistoryStore } from '../chat-history-store.js';
import {
    INDEX_KEY,
    normalizeId,
    makeConversationKey,
    createChainId,
    uniqueStringArray,
    readIndex,
    writeIndex,
    escapeHtml,
    formatTime,
    asDisplayContent,
    stripDuplicatedAnswerPrefix,
    renderMessageBody,
    extractLatestQueryTail,
    cloneJsonCompatible,
    hasMeaningfulText,
    toChainRecord,
} from './shared.js';

export const chatHistoryBundleMethods = {
    async exportChainBundle({ appId, chainId }) {
        const normalizedAppId = normalizeId(appId);
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedAppId || !normalizedChainId) {
            throw new Error('缺少 appId 或 chainId，无法导出会话链');
        }

        const [appMeta, chain, records] = await Promise.all([
            this.getAppMeta(normalizedAppId),
            this.getChain(normalizedChainId),
            this.listMessagesByChain(normalizedChainId),
        ]);
        if (!chain) {
            throw new Error(`会话链不存在: ${normalizedChainId}`);
        }
        if (normalizeId(chain.appId) !== normalizedAppId) {
            throw new Error(`会话链 appId 不匹配: ${normalizedChainId}`);
        }

        const exportMessages = (records || []).map((record) => {
            const rawMessage = record?.rawMessage && typeof record.rawMessage === 'object'
                ? record.rawMessage
                : {};
            return {
                storeKey: String(record?.storeKey || ''),
                appId: normalizedAppId,
                chainId: normalizedChainId,
                conversationId: normalizeId(record?.conversationId),
                messageId: normalizeId(record?.messageId),
                createdAt: Number(record?.createdAt || 0),
                updatedAt: Number(record?.updatedAt || 0),
                query: typeof record?.query === 'string'
                    ? record.query
                    : (typeof rawMessage.query === 'string' ? rawMessage.query : ''),
                answer: typeof record?.answer === 'string'
                    ? record.answer
                    : (typeof rawMessage.answer === 'string' ? rawMessage.answer : ''),
                rawMessage: cloneJsonCompatible(rawMessage, {}),
            };
        });

        return {
            version: 1,
            type: 'aifengyue_chain_bundle',
            exportedAt: Date.now(),
            appId: normalizedAppId,
            appMeta: appMeta
                ? {
                    appId: normalizedAppId,
                    name: asDisplayContent(appMeta.name),
                    description: asDisplayContent(appMeta.description),
                    builtInCss: asDisplayContent(appMeta.builtInCss),
                    createdAt: Number(appMeta.createdAt || 0),
                    updatedAt: Number(appMeta.updatedAt || 0),
                }
                : null,
            chain: {
                chainId: normalizedChainId,
                appId: normalizedAppId,
                conversationIds: uniqueStringArray(chain.conversationIds || []),
                createdAt: Number(chain.createdAt || 0),
                updatedAt: Number(chain.updatedAt || 0),
                lastSyncAt: this.getChainLastSync(normalizedChainId),
            },
            messages: exportMessages,
            summary: {
                conversationCount: uniqueStringArray(chain.conversationIds || []).length,
                messageCount: exportMessages.length,
                latestQueryTail: extractLatestQueryTail(records),
            },
        };
    },

    async importChainBundle({ payload, preferAppId = '', preferChainId = '' } = {}) {
        const source = payload && typeof payload === 'object' ? payload : null;
        if (!source) {
            throw new Error('导入内容不是合法 JSON 对象');
        }

        const sourceChain = source?.chain && typeof source.chain === 'object' ? source.chain : {};
        const sourceAppMeta = source?.appMeta && typeof source.appMeta === 'object' ? source.appMeta : {};
        const sourceMessages = Array.isArray(source?.messages) ? source.messages : [];
        const normalizedAppId = normalizeId(preferAppId)
            || normalizeId(source?.appId)
            || normalizeId(sourceChain?.appId)
            || normalizeId(sourceAppMeta?.appId);
        if (!normalizedAppId) {
            throw new Error('导入失败：未识别 appId');
        }

        const sourceConversationIds = uniqueStringArray([
            ...(Array.isArray(sourceChain?.conversationIds) ? sourceChain.conversationIds : []),
            ...sourceMessages.map((item) => {
                const rawMessage = item?.rawMessage && typeof item.rawMessage === 'object'
                    ? item.rawMessage
                    : {};
                return normalizeId(item?.conversationId)
                    || normalizeId(item?.conversation_id)
                    || normalizeId(rawMessage?.conversationId)
                    || normalizeId(rawMessage?.conversation_id);
            }),
        ]);

        let targetChainId = normalizeId(preferChainId) || normalizeId(sourceChain?.chainId);
        if (!targetChainId) {
            targetChainId = createChainId(normalizedAppId);
        }

        let existingChain = await this.getChain(targetChainId);
        if (existingChain && normalizeId(existingChain.appId) !== normalizedAppId) {
            targetChainId = createChainId(normalizedAppId);
            existingChain = null;
        }

        const now = Date.now();
        const seenStoreKeys = new Set();
        const records = [];
        for (let i = 0; i < sourceMessages.length; i++) {
            const item = sourceMessages[i];
            if (!item || typeof item !== 'object') continue;

            const rawMessage = item?.rawMessage && typeof item.rawMessage === 'object'
                ? item.rawMessage
                : cloneJsonCompatible(item, {});
            const conversationId = normalizeId(item?.conversationId)
                || normalizeId(item?.conversation_id)
                || normalizeId(rawMessage?.conversationId)
                || normalizeId(rawMessage?.conversation_id)
                || sourceConversationIds[0]
                || `import-conv-${i + 1}`;
            const messageId = normalizeId(item?.messageId)
                || normalizeId(item?.id)
                || normalizeId(rawMessage?.id)
                || `${conversationId}-idx-${i}`;
            const createdAt = normalizeTimestamp(item?.createdAt ?? item?.created_at ?? rawMessage?.created_at) || (now + i);
            const storeKey = `${targetChainId}::${conversationId}::${messageId}`;
            if (seenStoreKeys.has(storeKey)) continue;
            seenStoreKeys.add(storeKey);

            const query = typeof item?.query === 'string'
                ? item.query
                : (typeof rawMessage?.query === 'string' ? rawMessage.query : '');
            const answer = typeof item?.answer === 'string'
                ? item.answer
                : (typeof rawMessage?.answer === 'string' ? rawMessage.answer : '');

            records.push({
                storeKey,
                appId: normalizedAppId,
                chainId: targetChainId,
                conversationId,
                messageId,
                createdAt,
                updatedAt: now,
                query,
                answer,
                rawMessage: cloneJsonCompatible(rawMessage, {}),
            });
        }

        const mergedConversationIds = uniqueStringArray([
            ...(existingChain?.conversationIds || []),
            ...sourceConversationIds,
            ...records.map((record) => record.conversationId),
        ]);
        if (mergedConversationIds.length === 0) {
            throw new Error('导入失败：未找到可用 conversation_id');
        }

        if (sourceAppMeta && Object.keys(sourceAppMeta).length > 0) {
            await this.upsertAppMeta({
                appId: normalizedAppId,
                name: sourceAppMeta?.name ?? '',
                description: sourceAppMeta?.description ?? '',
                builtInCss: sourceAppMeta?.builtInCss ?? '',
            });
        }

        const nextChain = toChainRecord(existingChain || {
            chainId: targetChainId,
            appId: normalizedAppId,
            conversationIds: [],
            createdAt: now,
            updatedAt: now,
        }, {
            chainId: targetChainId,
            appId: normalizedAppId,
            conversationIds: mergedConversationIds,
            updatedAt: now,
        });
        await ChatHistoryStore.upsertChain(nextChain);

        const savedCount = await ChatHistoryStore.putMessages(records);
        for (const conversationId of mergedConversationIds) {
            this.setConversationChainId(normalizedAppId, conversationId, targetChainId);
        }
        this.setActiveChainId(normalizedAppId, targetChainId);
        this.markChainSynced(targetChainId, Date.now());

        return {
            appId: normalizedAppId,
            chainId: targetChainId,
            conversationCount: mergedConversationIds.length,
            sourceMessageCount: sourceMessages.length,
            importedMessageCount: records.length,
            savedCount,
        };
    },
};
