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

export const chatHistoryChainMethods = {
    async bindConversation({
        appId,
        conversationId,
        previousConversationId = '',
        preferredChainId = '',
        tokenSignature = '',
    }) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        const normalizedPreviousConversationId = normalizeId(previousConversationId);
        const normalizedPreferredChainId = normalizeId(preferredChainId);
        const normalizedTokenSignature = normalizeId(tokenSignature);

        if (!normalizedAppId || !normalizedConversationId) {
            throw new Error('appId 或 conversationId 为空，无法绑定链路');
        }

        const directChainId = this.getConversationChainId(normalizedAppId, normalizedConversationId);
        if (directChainId) {
            const directChain = await this.getChain(directChainId);
            if (directChain && directChain.appId === normalizedAppId) {
                if (normalizedTokenSignature) {
                    this.setConversationTokenSignature(normalizedAppId, normalizedConversationId, normalizedTokenSignature);
                }
                this.setActiveChainId(normalizedAppId, directChainId);
                return {
                    chainId: directChainId,
                    chain: directChain,
                    created: false,
                };
            }
        }

        let chainId = '';
        let chain = null;
        let created = false;

        const candidates = [];
        if (normalizedPreferredChainId) {
            candidates.push(normalizedPreferredChainId);
        }
        if (normalizedPreviousConversationId) {
            const previousChainId = this.getConversationChainId(normalizedAppId, normalizedPreviousConversationId);
            if (previousChainId) {
                candidates.push(previousChainId);
            }
        }
        const activeChainId = this.getActiveChainId(normalizedAppId);
        if (activeChainId) {
            candidates.push(activeChainId);
        }

        for (const candidate of candidates) {
            const candidateChain = await this.getChain(candidate);
            if (candidateChain && candidateChain.appId === normalizedAppId) {
                chainId = candidate;
                chain = candidateChain;
                break;
            }
        }

        if (!chainId) {
            chainId = createChainId(normalizedAppId);
            chain = toChainRecord({
                chainId,
                appId: normalizedAppId,
                conversationIds: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            created = true;
        }

        const conversationIds = uniqueStringArray([
            ...(chain?.conversationIds || []),
            normalizedPreviousConversationId,
            normalizedConversationId,
        ]);

        const nextChain = toChainRecord(chain, {
            conversationIds,
            updatedAt: Date.now(),
        });
        await ChatHistoryStore.upsertChain(nextChain);

        this.setConversationChainId(normalizedAppId, normalizedConversationId, chainId);
        if (normalizedPreviousConversationId) {
            this.setConversationChainId(normalizedAppId, normalizedPreviousConversationId, chainId);
        }
        if (normalizedTokenSignature) {
            this.setConversationTokenSignature(normalizedAppId, normalizedConversationId, normalizedTokenSignature);

            // 仅在旧会话尚未写入 token 标记时继承，避免新账号覆盖旧账号绑定关系。
            if (normalizedPreviousConversationId) {
                const previousToken = this.getConversationTokenSignature(normalizedAppId, normalizedPreviousConversationId);
                if (!previousToken) {
                    this.setConversationTokenSignature(
                        normalizedAppId,
                        normalizedPreviousConversationId,
                        normalizedTokenSignature
                    );
                }
            }
        }
        this.setActiveChainId(normalizedAppId, chainId);

        return {
            chainId,
            chain: nextChain,
            created,
        };
    },

    async saveConversationMessages({
        appId,
        conversationId,
        chainId = '',
        tokenSignature = '',
        messages = [],
    }) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        const normalizedTokenSignature = normalizeId(tokenSignature);
        if (!normalizedAppId || !normalizedConversationId) {
            throw new Error('appId 或 conversationId 为空，无法保存消息');
        }

        const binding = await this.bindConversation({
            appId: normalizedAppId,
            conversationId: normalizedConversationId,
            preferredChainId: chainId,
            tokenSignature: normalizedTokenSignature,
        });
        const normalizedChainId = binding.chainId;
        const now = Date.now();

        const seenStoreKeys = new Set();
        const records = [];
        for (let i = 0; i < messages.length; i++) {
            const rawMessage = messages[i];
            if (!rawMessage || typeof rawMessage !== 'object') continue;

            const messageId = normalizeId(rawMessage.id) || `${normalizedConversationId}-idx-${i}`;
            const createdAt = normalizeTimestamp(rawMessage.created_at) || now + i;
            const storeKey = `${normalizedChainId}::${normalizedConversationId}::${messageId}`;
            if (seenStoreKeys.has(storeKey)) continue;
            seenStoreKeys.add(storeKey);

            records.push({
                storeKey,
                appId: normalizedAppId,
                chainId: normalizedChainId,
                conversationId: normalizedConversationId,
                messageId,
                createdAt,
                updatedAt: now,
                query: typeof rawMessage.query === 'string' ? rawMessage.query : '',
                answer: typeof rawMessage.answer === 'string' ? rawMessage.answer : '',
                rawMessage,
            });
        }

        const savedCount = await ChatHistoryStore.putMessages(records);
        const chain = await this.getChain(normalizedChainId);
        if (chain) {
            await ChatHistoryStore.upsertChain(toChainRecord(chain, {
                conversationIds: uniqueStringArray([...(chain.conversationIds || []), normalizedConversationId]),
                updatedAt: Date.now(),
            }));
        }
        if (normalizedTokenSignature) {
            this.setConversationTokenSignature(normalizedAppId, normalizedConversationId, normalizedTokenSignature);
        }

        return {
            chainId: normalizedChainId,
            savedCount,
        };
    },

    async listMessagesByChain(chainId) {
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedChainId) return [];

        const records = await ChatHistoryStore.listMessagesByChain(normalizedChainId);
        return (records || []).sort((a, b) => {
            const createdDiff = Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
            if (createdDiff !== 0) return createdDiff;
            return String(a?.storeKey || '').localeCompare(String(b?.storeKey || ''));
        });
    },

    async getChainStats(chainId) {
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedChainId) {
            return {
                messageCount: 0,
                answerCount: 0,
                latestQueryTail: '',
            };
        }

        const records = await this.listMessagesByChain(normalizedChainId);
        let answerCount = 0;
        for (const record of records) {
            const rawMessage = record?.rawMessage && typeof record.rawMessage === 'object'
                ? record.rawMessage
                : {};
            const answer = rawMessage.answer ?? record?.answer ?? '';
            if (hasMeaningfulText(answer)) {
                answerCount += 1;
            }
        }

        return {
            messageCount: records.length,
            answerCount,
            latestQueryTail: extractLatestQueryTail(records),
        };
    },
};
