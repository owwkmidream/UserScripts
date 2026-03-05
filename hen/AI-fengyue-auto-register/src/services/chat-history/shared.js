import {
    decodeEscapedText,
    hasMeaningfulText as hasMeaningfulTextValue,
    normalizeTimestamp,
} from '../../utils/text-normalize.js';

export const INDEX_KEY = 'aifengyue_chat_index_v1';

export function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function makeConversationKey(appId, conversationId) {
    return `${appId}::${conversationId}`;
}

export function createChainId(appId) {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `chain-${appId}-${suffix}`;
}

export function uniqueStringArray(values) {
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

export function readIndex() {
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

export function writeIndex(index) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatTime(value) {
    const ts = normalizeTimestamp(value);
    if (!ts) return '-';
    try {
        return new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleString();
    } catch {
        return String(value);
    }
}

export function asDisplayContent(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return decodeEscapedText(value);
    return String(value);
}

export function looksLikeHtml(value) {
    return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function uniqueTextArray(values) {
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

export function isPrefixBoundary(rest) {
    if (!rest) return true;
    return /^[\s\r\n\u00a0:：,，.。!！?？;；、\-—]/.test(rest);
}

export function trimPrefixConnectors(text) {
    return String(text || '')
        .replace(/^[\s\r\n\u00a0]+/, '')
        .replace(/^[：:，,。.!！？?；;、\-—]+/, '')
        .replace(/^[\s\r\n\u00a0]+/, '');
}

export function stripDuplicatedAnswerPrefix(queryText, answerHistory) {
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

export function renderMessageBody(text, emptyPlaceholder = '(空)') {
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

export function normalizeLineBreakTokens(text) {
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

export function extractLatestQueryTail(records, tailLength = 28) {
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

export function cloneJsonCompatible(value, fallback = null) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

export function hasMeaningfulText(value) {
    return hasMeaningfulTextValue(asDisplayContent(value));
}

export function toChainRecord(base, extras = {}) {
    return {
        chainId: normalizeId(base.chainId),
        appId: normalizeId(base.appId),
        conversationIds: uniqueStringArray(base.conversationIds),
        createdAt: Number(base.createdAt || Date.now()),
        updatedAt: Number(base.updatedAt || Date.now()),
        ...extras,
    };
}

export { normalizeTimestamp };
