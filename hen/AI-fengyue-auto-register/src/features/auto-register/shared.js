import {
    decodeEscapedText as decodeEscapedTextUtil,
    normalizeTimestamp as normalizeTimestampUtil,
} from '../../utils/text-normalize.js';

export const X_LANGUAGE = 'zh-Hans';
export const SITE_ENDPOINTS = {
    SEND_CODE: '/console/api/register/email',
    SLIDE_GET: '/go/api/slide/get',
    REGISTER: '/console/api/register',
    ACCOUNT_GENDER: '/console/api/account/gender',
    FAVORITE_TAGS: '/console/api/account_extend/favorite_tags',
    ACCOUNT_EXTEND_SET: '/console/api/account/extend_set',
    ACCOUNT_PROFILE: '/go/api/account/profile',
    ACCOUNT_POINT: '/go/api/account/point',
    APP_DETAILS: '/go/api/apps',
    APPS: '/console/api/apps',
    INSTALLED_MESSAGES: '/console/api/installed-apps',
    CHAT_MESSAGES: '/console/api/installed-apps',
};
export const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS = 3;
export const DEFAULT_SWITCH_WORLD_BOOK_TRIGGER = '-=';

export function readErrorMessage(payload, fallback) {
    if (!payload || typeof payload !== 'object') return fallback;
    const raw = payload.error ?? payload.message ?? payload.msg ?? payload.detail ?? payload.errmsg;
    if (typeof raw !== 'string') return fallback;
    const message = raw.trim();
    if (!message || /^(ok|success)$/i.test(message)) return fallback;
    return message;
}

export function normalizeTimestamp(value) {
    return normalizeTimestampUtil(value);
}

export function decodeEscapedText(raw) {
    return decodeEscapedTextUtil(raw);
}

export function isAnswerEmpty(raw) {
    if (raw === null || raw === undefined) return true;
    if (typeof raw !== 'string') return false;

    const source = raw.trim().toLowerCase();
    if (!source) return true;
    if (source === 'null' || source === 'undefined' || source === '""' || source === "''") {
        return true;
    }

    const decoded = decodeEscapedText(raw).trim().toLowerCase();
    if (!decoded) return true;
    if (decoded === 'null' || decoded === 'undefined' || decoded === '""' || decoded === "''") {
        return true;
    }

    return false;
}

export function normalizeSwitchTriggerWord(value) {
    const source = typeof value === 'string' ? value.trim() : '';
    if (!source) return '';

    const matched = source.match(/%%[^\s%]+(?:%%)?/);
    return matched?.[0] ? matched[0].trim() : '';
}

export function cloneJsonSafe(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

export function stringifyJsonWithUnicodeEscapes(value) {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return '';
    return json.replace(/[^\x20-\x7E]/g, (char) => {
        const code = char.charCodeAt(0);
        return `\\u${code.toString(16).padStart(4, '0')}`;
    });
}

export function randomConversationSuffix(length = 3) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let output = '';
    for (let i = 0; i < length; i++) {
        output += chars[Math.floor(Math.random() * chars.length)];
    }
    return output;
}

export function buildTokenSignature(token) {
    const normalized = typeof token === 'string' ? token.trim() : '';
    if (!normalized) return '';

    // 用短哈希标识 token 归属，避免把明文 token 写入本地会话索引。
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
        hash ^= normalized.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `tk-${normalized.length}-${hex}`;
}

export function withHttpStatusError(message, httpStatus) {
    const error = new Error(message);
    if (typeof httpStatus === 'number' && Number.isFinite(httpStatus)) {
        error.httpStatus = httpStatus;
    }
    return error;
}
