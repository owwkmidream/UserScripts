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

    async bindConversation({ appId, conversationId, previousConversationId = '', preferredChainId = '' }) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        const normalizedPreviousConversationId = normalizeId(previousConversationId);
        const normalizedPreferredChainId = normalizeId(preferredChainId);

        if (!normalizedAppId || !normalizedConversationId) {
            throw new Error('appId 或 conversationId 为空，无法绑定链路');
        }

        const directChainId = this.getConversationChainId(normalizedAppId, normalizedConversationId);
        if (directChainId) {
            const directChain = await this.getChain(directChainId);
            if (directChain && directChain.appId === normalizedAppId) {
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
        this.setActiveChainId(normalizedAppId, chainId);

        return {
            chainId,
            chain: nextChain,
            created,
        };
    },

    async saveConversationMessages({ appId, conversationId, chainId = '', messages = [] }) {
        const normalizedAppId = normalizeId(appId);
        const normalizedConversationId = normalizeId(conversationId);
        if (!normalizedAppId || !normalizedConversationId) {
            throw new Error('appId 或 conversationId 为空，无法保存消息');
        }

        const binding = await this.bindConversation({
            appId: normalizedAppId,
            conversationId: normalizedConversationId,
            preferredChainId: chainId,
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
        const description = appMeta?.description || '';
        const style = appMeta?.builtInCss || '';
        const conversationIds = uniqueStringArray(chain?.conversationIds || []);

        const messageHtml = records.length > 0
            ? records.map((record, index) => {
                const rawMessage = record?.rawMessage && typeof record.rawMessage === 'object'
                    ? record.rawMessage
                    : {};
                const queryText = asDisplayContent(rawMessage.query ?? record?.query ?? '');
                const answerText = asDisplayContent(rawMessage.answer ?? record?.answer ?? '');
                const renderedAnswer = looksLikeHtml(answerText)
                    ? answerText
                    : `<pre class="af-plain">${escapeHtml(answerText || '(空)')}</pre>`;
                const renderedQuery = `<pre class="af-plain">${escapeHtml(queryText || '(空)')}</pre>`;
                const rawJson = escapeHtml(JSON.stringify(rawMessage, null, 2));

                return `
                    <article class="af-msg">
                        <header class="af-msg-head">
                            <span>#${index + 1}</span>
                            <span>${escapeHtml(formatTime(rawMessage.created_at ?? record?.createdAt))}</span>
                            <span>${escapeHtml(String(rawMessage.id || record?.messageId || '-'))}</span>
                        </header>
                        <section class="af-msg-block">
                            <h3>Query</h3>
                            ${renderedQuery}
                        </section>
                        <section class="af-msg-block">
                            <h3>Answer</h3>
                            <div class="af-answer-root">${renderedAnswer}</div>
                        </section>
                        <details class="af-raw">
                            <summary>Raw JSON</summary>
                            <pre>${rawJson}</pre>
                        </details>
                    </article>
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
            --af-bg: #f3f5f9;
            --af-card: #ffffff;
            --af-border: #d8dee9;
            --af-text: #1d2433;
            --af-muted: #5f6b82;
            --af-plain: #f7f9fc;
            --af-accent: #2563eb;
        }
        body {
            margin: 0;
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: var(--af-bg);
            color: var(--af-text);
            padding: 16px;
        }
        .af-head {
            border: 1px solid var(--af-border);
            background: var(--af-card);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 14px;
        }
        .af-title {
            font-size: 18px;
            font-weight: 700;
            margin: 0 0 8px;
        }
        .af-meta {
            color: var(--af-muted);
            font-size: 12px;
            line-height: 1.6;
        }
        .af-description {
            margin-top: 10px;
            border-top: 1px dashed var(--af-border);
            padding-top: 10px;
        }
        .af-msg {
            border: 1px solid var(--af-border);
            background: var(--af-card);
            border-radius: 12px;
            padding: 12px;
            margin-bottom: 12px;
        }
        .af-msg-head {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            font-size: 12px;
            color: var(--af-muted);
            margin-bottom: 10px;
        }
        .af-msg-block h3 {
            margin: 10px 0 8px;
            font-size: 13px;
            color: var(--af-accent);
        }
        .af-plain {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            border: 1px solid var(--af-border);
            border-radius: 8px;
            background: var(--af-plain);
            padding: 10px;
            font-size: 12px;
            line-height: 1.6;
        }
        .af-answer-root {
            border: 1px solid var(--af-border);
            border-radius: 8px;
            background: #fff;
            padding: 10px;
            overflow-x: auto;
        }
        .af-raw {
            margin-top: 10px;
        }
        .af-raw summary {
            cursor: pointer;
            color: var(--af-muted);
            font-size: 12px;
        }
        .af-raw pre {
            margin-top: 8px;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 11px;
            background: #101522;
            color: #d8e2ff;
            border-radius: 8px;
            padding: 10px;
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
    <section class="af-head">
        <h1 class="af-title">${name} - 本地会话链</h1>
        <div class="af-meta">
            <div>appId: ${escapeHtml(normalizedAppId)}</div>
            <div>chainId: ${escapeHtml(normalizedChainId)}</div>
            <div>conversationIds: ${escapeHtml(conversationIds.join(', ') || '-')}</div>
            <div>消息数: ${records.length}</div>
        </div>
        <div class="af-description">${description || ''}</div>
    </section>
    ${messageHtml}
</body>
</html>`;
    },
};

