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

export const chatHistoryIndexMethods = {
    readIndexSnapshot() {
        return readIndex();
    },

    getConversationChainId(appId, conversationId) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        if (!normalizedAppId || !normalizedConversationId) return '';

        const index = readIndex();
        const key = makeConversationKey(normalizedAppId, normalizedConversationId);
        return normalizeId(index.conversationToChain[key]);
    },

    setConversationChainId(appId, conversationId, chainId) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedAppId || !normalizedConversationId || !normalizedChainId) return '';

        const index = readIndex();
        index.conversationToChain[makeConversationKey(normalizedAppId, normalizedConversationId)] = normalizedChainId;
        writeIndex(index);
        return normalizedChainId;
    },

    getConversationTokenSignature(appId, conversationId) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        if (!normalizedAppId || !normalizedConversationId) return '';

        const index = readIndex();
        const key = makeConversationKey(normalizedAppId, normalizedConversationId);
        return normalizeId(index.conversationTokenByKey[key]);
    },

    setConversationTokenSignature(appId, conversationId, tokenSignature) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        if (!normalizedAppId || !normalizedConversationId) return '';

        const normalizedTokenSignature = normalizeId(tokenSignature);
        const index = readIndex();
        const key = makeConversationKey(normalizedAppId, normalizedConversationId);
        if (normalizedTokenSignature) {
            index.conversationTokenByKey[key] = normalizedTokenSignature;
        } else {
            delete index.conversationTokenByKey[key];
        }
        writeIndex(index);
        return normalizedTokenSignature;
    },

    getActiveChainId(appId) {
        const normalizedAppId = normalizeId(appId);
        if (!normalizedAppId) return '';

        const index = readIndex();
        return normalizeId(index.activeChainByAppId[normalizedAppId]);
    },

    setActiveChainId(appId, chainId) {
        const normalizedAppId = normalizeId(appId);
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedAppId || !normalizedChainId) return '';

        const index = readIndex();
        index.activeChainByAppId[normalizedAppId] = normalizedChainId;
        writeIndex(index);
        return normalizedChainId;
    },

    markChainSynced(chainId, syncedAt = Date.now()) {
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedChainId) return 0;

        const index = readIndex();
        index.lastSyncByChainId[normalizedChainId] = Number(syncedAt) || Date.now();
        writeIndex(index);
        return index.lastSyncByChainId[normalizedChainId];
    },

    getChainLastSync(chainId) {
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedChainId) return 0;
        const index = readIndex();
        return Number(index.lastSyncByChainId[normalizedChainId] || 0);
    },

    async upsertAppMeta({ appId, name, description, builtInCss }) {
        const normalizedAppId = normalizeId(appId);
        if (!normalizedAppId) {
            throw new Error('appId 为空，无法保存应用元数据');
        }

        const existing = await ChatHistoryStore.getApp(normalizedAppId);
        const now = Date.now();
        const record = {
            appId: normalizedAppId,
            name: asDisplayContent(name),
            description: asDisplayContent(description),
            builtInCss: asDisplayContent(builtInCss),
            createdAt: Number(existing?.createdAt || now),
            updatedAt: now,
        };
        await ChatHistoryStore.upsertApp(record);
        return record;
    },

    async getAppMeta(appId) {
        const normalizedAppId = normalizeId(appId);
        if (!normalizedAppId) return null;
        return ChatHistoryStore.getApp(normalizedAppId);
    },

    async getChain(chainId) {
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedChainId) return null;
        const chain = await ChatHistoryStore.getChain(normalizedChainId);
        if (!chain) return null;
        return toChainRecord(chain);
    },

    async listChainsForApp(appId) {
        const normalizedAppId = normalizeId(appId);
        if (!normalizedAppId) return [];

        const chains = await ChatHistoryStore.listChainsByApp(normalizedAppId);
        return (chains || [])
            .map((chain) => toChainRecord(chain))
            .sort((a, b) => {
                const updatedDiff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
                if (updatedDiff !== 0) return updatedDiff;
                return Number(b.createdAt || 0) - Number(a.createdAt || 0);
            });
    },

    async listAllChains() {
        const chains = await ChatHistoryStore.listAllChains();
        return (chains || [])
            .map((chain) => toChainRecord(chain))
            .sort((a, b) => {
                const updatedDiff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
                if (updatedDiff !== 0) return updatedDiff;
                return Number(b.createdAt || 0) - Number(a.createdAt || 0);
            });
    },

    async deleteChain(chainId) {
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedChainId) {
            throw new Error('chainId 为空，无法删除链路');
        }

        const chain = await this.getChain(normalizedChainId);
        if (!chain) {
            return {
                deleted: false,
                chainId: normalizedChainId,
                appId: '',
                deletedMessageCount: 0,
                removedConversationMappingCount: 0,
            };
        }

        const deletedMessageCount = await ChatHistoryStore.deleteMessagesByChain(normalizedChainId);
        await ChatHistoryStore.deleteChain(normalizedChainId);

        const index = readIndex();
        let removedConversationMappingCount = 0;
        for (const [key, mappedChainId] of Object.entries(index.conversationToChain || {})) {
            if (normalizeId(mappedChainId) !== normalizedChainId) continue;
            delete index.conversationToChain[key];
            if (index.conversationTokenByKey && Object.prototype.hasOwnProperty.call(index.conversationTokenByKey, key)) {
                delete index.conversationTokenByKey[key];
            }
            removedConversationMappingCount += 1;
        }

        for (const [appId, activeChainId] of Object.entries(index.activeChainByAppId || {})) {
            if (normalizeId(activeChainId) === normalizedChainId) {
                delete index.activeChainByAppId[appId];
            }
        }

        if (index.lastSyncByChainId && Object.prototype.hasOwnProperty.call(index.lastSyncByChainId, normalizedChainId)) {
            delete index.lastSyncByChainId[normalizedChainId];
        }
        writeIndex(index);

        return {
            deleted: true,
            chainId: normalizedChainId,
            appId: normalizeId(chain.appId),
            deletedMessageCount,
            removedConversationMappingCount,
            deletedConversationCount: uniqueStringArray(chain.conversationIds || []).length,
        };
    },
};
