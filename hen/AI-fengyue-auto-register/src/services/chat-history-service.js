import { ChatHistoryStore } from './chat-history-store.js';

const INDEX_KEY = 'aifengyue_chat_index_v1';

function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) return asNumber;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function decodeEscapedText(raw) {
    if (typeof raw !== 'string') return '';

    let value = raw;
    for (let i = 0; i < 3; i++) {
        if (!/\\u[0-9a-fA-F]{4}|\\[nrt"\\/]/.test(value)) {
            break;
        }
        try {
            const next = JSON.parse(`"${value
                .replace(/"/g, '\\"')
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n')
                .replace(/\t/g, '\\t')}"`);
            if (next === value) break;
            value = next;
        } catch {
            break;
        }
    }
    return value;
}

function makeConversationKey(appId, conversationId) {
    return `${appId}::${conversationId}`;
}

function createChainId(appId) {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `chain-${appId}-${suffix}`;
}

function uniqueStringArray(values) {
    const output = [];
    const seen = new Set();
    for (const value of values || []) {
        const normalized = normalizeId(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(normalized);
    }
    return output;
}

function readIndex() {
    const fallback = {
        activeChainByAppId: {},
        conversationToChain: {},
        conversationTokenByKey: {},
        lastSyncByChainId: {},
    };

    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return fallback;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return fallback;
        }
        return {
            activeChainByAppId: parsed.activeChainByAppId && typeof parsed.activeChainByAppId === 'object'
                ? { ...parsed.activeChainByAppId }
                : {},
            conversationToChain: parsed.conversationToChain && typeof parsed.conversationToChain === 'object'
                ? { ...parsed.conversationToChain }
                : {},
            conversationTokenByKey: parsed.conversationTokenByKey && typeof parsed.conversationTokenByKey === 'object'
                ? { ...parsed.conversationTokenByKey }
                : {},
            lastSyncByChainId: parsed.lastSyncByChainId && typeof parsed.lastSyncByChainId === 'object'
                ? { ...parsed.lastSyncByChainId }
                : {},
        };
    } catch {
        return fallback;
    }
}

function writeIndex(index) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTime(value) {
    const ts = normalizeTimestamp(value);
    if (!ts) return '-';
    try {
        return new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleString();
    } catch {
        return String(value);
    }
}

function asDisplayContent(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return decodeEscapedText(value);
    return String(value);
}

function looksLikeHtml(value) {
    return /<\/?[a-z][\s\S]*>/i.test(value);
}

function uniqueTextArray(values) {
    const output = [];
    const seen = new Set();
    for (const value of values || []) {
        if (typeof value !== 'string') continue;
        if (!value) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        output.push(value);
    }
    return output;
}

function isPrefixBoundary(rest) {
    if (!rest) return true;
    return /^[\s\r\n\u00a0:：,，.。!！?？;；、\-—]/.test(rest);
}

function trimPrefixConnectors(text) {
    return String(text || '')
        .replace(/^[\s\r\n\u00a0]+/, '')
        .replace(/^[：:，,。.!！？?；;、\-—]+/, '')
        .replace(/^[\s\r\n\u00a0]+/, '');
}

function stripDuplicatedAnswerPrefix(queryText, answerHistory) {
    const source = asDisplayContent(queryText);
    if (!source) {
        return {
            text: '',
            removedPrefix: '',
        };
    }

    const candidates = uniqueTextArray(answerHistory)
        .sort((a, b) => b.length - a.length);

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (!source.startsWith(candidate)) continue;

        const rest = source.slice(candidate.length);
        if (!isPrefixBoundary(rest)) continue;

        return {
            text: trimPrefixConnectors(rest),
            removedPrefix: candidate,
        };
    }

    return {
        text: source,
        removedPrefix: '',
    };
}

function renderMessageBody(text, emptyPlaceholder = '(空)') {
    const normalized = asDisplayContent(text);
    if (!normalized) {
        return `<pre class="af-plain" style="white-space: pre-wrap !important;">${escapeHtml(emptyPlaceholder)}</pre>`;
    }
    if (looksLikeHtml(normalized)) {
        const normalizedHtml = normalizeLineBreakTokens(normalized);
        return `<div class="markdown-body false" style="font-size:14px;white-space:pre-wrap;">${normalizedHtml}</div>`;
    }
    const plainText = normalizeLineBreakTokens(normalized);
    return `<pre class="af-plain" style="white-space: pre-wrap !important;">${escapeHtml(plainText)}</pre>`;
}

function normalizeLineBreakTokens(text) {
    let value = String(text ?? '');
    for (let i = 0; i < 4; i++) {
        const next = value
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\\+r\\+n/g, '\n')
            .replace(/\\+n/g, '\n')
            .replace(/\\+r/g, '\n');
        if (next === value) {
            break;
        }
        value = next;
    }
    return value;
}

function extractLatestQueryTail(records, tailLength = 28) {
    if (!Array.isArray(records) || records.length === 0) return '';
    for (let i = records.length - 1; i >= 0; i--) {
        const record = records[i];
        const rawMessage = record?.rawMessage && typeof record.rawMessage === 'object'
            ? record.rawMessage
            : {};
        const query = asDisplayContent(rawMessage.query ?? record?.query ?? '');
        if (!hasMeaningfulText(query)) continue;

        const singleLine = normalizeLineBreakTokens(query)
            .replace(/\s+/g, ' ')
            .trim();
        if (!singleLine) continue;

        return singleLine.length > tailLength
            ? `...${singleLine.slice(-tailLength)}`
            : singleLine;
    }
    return '';
}

function cloneJsonCompatible(value, fallback = null) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

function hasMeaningfulText(value) {
    const normalized = asDisplayContent(value).trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'null' || normalized === 'undefined' || normalized === '""' || normalized === "''") {
        return false;
    }
    return true;
}

function toChainRecord(base, extras = {}) {
    return {
        chainId: normalizeId(base.chainId),
        appId: normalizeId(base.appId),
        conversationIds: uniqueStringArray(base.conversationIds),
        createdAt: Number(base.createdAt || Date.now()),
        updatedAt: Number(base.updatedAt || Date.now()),
        ...extras,
    };
}

export const ChatHistoryService = {
    INDEX_KEY,

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

    async buildChainViewerHtml({ appId, chainId }) {
        const normalizedAppId = normalizeId(appId);
        const normalizedChainId = normalizeId(chainId);
        if (!normalizedAppId || !normalizedChainId) {
            return '<html><body><p>缺少 appId 或 chainId。</p></body></html>';
        }

        const [appMeta, chain, records] = await Promise.all([
            this.getAppMeta(normalizedAppId),
            this.getChain(normalizedChainId),
            this.listMessagesByChain(normalizedChainId),
        ]);

        const name = escapeHtml(appMeta?.name || normalizedAppId);
        const style = String(appMeta?.builtInCss || '');
        const conversationIds = uniqueStringArray(chain?.conversationIds || []);
        const answerHistory = [];

        const messageHtml = records.length > 0
            ? records.map((record, index) => {
                const rawMessage = record?.rawMessage && typeof record.rawMessage === 'object'
                    ? record.rawMessage
                    : {};
                const queryText = asDisplayContent(rawMessage.query ?? record?.query ?? '');
                const answerText = asDisplayContent(rawMessage.answer ?? record?.answer ?? '');
                const dedupResult = stripDuplicatedAnswerPrefix(queryText, answerHistory);
                const renderedQuery = renderMessageBody(dedupResult.text || '(去重后为空)', '(去重后为空)');
                const renderedAnswer = renderMessageBody(answerText, '(空回复)');
                const createdAtText = escapeHtml(formatTime(rawMessage.created_at ?? record?.createdAt));
                const messageIdText = escapeHtml(String(rawMessage.id || record?.messageId || '-'));
                const queryContentId = `af-query-content-${index + 1}`;
                const answerContentId = `af-answer-content-${index + 1}`;
                if (answerText) {
                    answerHistory.push(answerText);
                }
                const dedupHint = dedupResult.removedPrefix
                    ? '<div class="af-dedup-hint">已自动去重历史前缀 answer</div>'
                    : '';

                return `
                    <div class="group flex mb-2 last:mb-0 af-row-user">
                        <div class="group relative ml-2 md:ml-0 af-bubble-wrap af-user-wrap">
                            <div id="${queryContentId}" class="relative inline-block px-4 py-3 max-w-full text-gray-900 rounded-xl text-sm af-message-bubble af-user-bubble">
                                ${renderedQuery}
                            </div>
                            <div class="af-bubble-meta af-user-meta">
                                <span>#${index + 1}</span>
                                <span>${createdAtText}</span>
                                <span>${messageIdText}</span>
                            </div>
                            <div class="af-bubble-actions af-user-actions">
                                <button class="af-copy-btn" type="button" data-af-copy-target="#${queryContentId}">复制 Query</button>
                            </div>
                            ${dedupHint}
                        </div>
                    </div>
                    <div class="group flex mb-2 last:mb-0 af-row-answer" id="ai-chat-answer">
                        <div class="chat-answer-container group relative mr-2 md:mr-0 af-bubble-wrap af-answer-wrap">
                            <div id="${answerContentId}" class="relative inline-block px-4 py-3 max-w-full text-gray-900 rounded-xl text-sm af-message-bubble af-answer-bubble">
                                ${renderedAnswer}
                            </div>
                            <div class="af-bubble-meta af-answer-meta">
                                <span>${createdAtText}</span>
                                <span>${messageIdText}</span>
                            </div>
                            <div class="af-bubble-actions af-answer-actions">
                                <button class="af-copy-btn" type="button" data-af-copy-target="#${answerContentId}">复制 Answer</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('\n')
            : '<div class="af-empty">当前链路暂无消息，点击“手动同步”拉取历史。</div>';

        return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${name} - 本地会话</title>
    <style>
        :root {
            color-scheme: light;
            --af-bg: #eef2f7;
            --af-card: #ffffff;
            --af-border: #d7dde8;
            --af-muted: #6b7280;
            --af-bubble: #ffffff;
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: var(--af-bg);
            color: #1f2937;
        }
        #installedBuiltInCss.af-chat-root {
            position: relative;
            min-height: 100vh;
            overflow: hidden;
            background: var(--af-bg);
        }
        .af-chat-shell {
            max-width: 840px;
            margin: 0 auto;
            padding: 10px 12px 20px;
        }
        .af-chat-header {
            position: sticky;
            top: 0;
            z-index: 4;
            backdrop-filter: blur(8px);
            background: rgba(238, 242, 247, 0.86);
            border-bottom: 1px solid var(--af-border);
            padding: 10px 4px 12px;
            margin-bottom: 10px;
        }
        .af-chat-title {
            font-size: 15px;
            font-weight: 700;
            margin: 0;
            line-height: 1.3;
        }
        .af-chat-sub {
            margin-top: 6px;
            color: var(--af-muted);
            font-size: 12px;
            line-height: 1.5;
        }
        .chat-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .af-row-user {
            display: flex;
            justify-content: flex-end;
        }
        .af-row-answer {
            display: flex;
            justify-content: flex-start;
        }
        .af-bubble-wrap {
            max-width: min(86%, 900px);
            width: fit-content;
            min-width: min(66%, 360px);
        }
        .af-user-wrap {
            margin-right: 6%;
        }
        .af-answer-wrap {
            margin-left: 6%;
        }
        .af-message-bubble {
            background: var(--af-bubble) !important;
            border: 1px solid rgba(148, 163, 184, 0.32) !important;
            border-radius: 14px;
            box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06) !important;
            overflow-x: auto;
            width: 100%;
        }
        .af-user-bubble {
            margin-left: auto;
        }
        .af-answer-bubble {
            margin-right: auto;
        }
        .af-bubble-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 5px;
            color: var(--af-muted);
            font-size: 11px;
            line-height: 1.4;
        }
        .af-user-meta {
            justify-content: flex-end;
            text-align: right;
        }
        .af-answer-meta {
            justify-content: flex-start;
        }
        .af-bubble-actions {
            display: flex;
            margin-top: 4px;
        }
        .af-user-actions {
            justify-content: flex-end;
        }
        .af-answer-actions {
            justify-content: flex-start;
        }
        .af-copy-btn {
            border: 1px solid var(--af-border);
            border-radius: 7px;
            background: rgba(255, 255, 255, 0.92);
            color: #4b5563;
            font-size: 11px;
            line-height: 1;
            height: 24px;
            padding: 0 9px;
            cursor: pointer;
            transition: all 0.18s ease;
        }
        .af-copy-btn:hover {
            border-color: #60a5fa;
            color: #1d4ed8;
            background: #eff6ff;
        }
        .af-copy-btn:active {
            transform: scale(0.97);
        }
        .af-dedup-hint {
            margin-top: 2px;
            font-size: 11px;
            color: #0f766e;
            text-align: right;
        }
        .af-plain {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            border: 1px solid var(--af-border);
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
            line-height: 1.65;
            background: rgba(255, 255, 255, 0.72);
        }
        .markdown-body {
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        .af-empty {
            border: 1px dashed var(--af-border);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            color: var(--af-muted);
            background: var(--af-card);
        }
        ${style}
    </style>
</head>
<body>
    <div id="installedBuiltInCss" class="relative w-full h-full overflow-hidden af-chat-root">
        <div class="af-chat-shell">
            <div class="af-chat-header">
                <h1 class="af-chat-title">${name}</h1>
                <div class="af-chat-sub">
                    <div>appId: ${escapeHtml(normalizedAppId)}</div>
                    <div>chainId: ${escapeHtml(normalizedChainId)}</div>
                    <div>conversationIds: ${escapeHtml(conversationIds.join(', ') || '-')}</div>
                    <div>消息数: ${records.length}</div>
                </div>
            </div>
            <div class="overflow-y-auto w-full h-full chat-container mx-auto">
                ${messageHtml}
            </div>
        </div>
    </div>
</body>
</html>`;
    },
};

