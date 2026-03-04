import { Toast } from '../../ui/toast.js';
import { CHAT_MESSAGES_PATH } from './constants.js';

export function toAbsoluteUrl(input, baseOrigin = window.location.origin) {
    if (input instanceof URL) {
        return input.href;
    }
    if (typeof input === 'string') {
        try {
            return new URL(input, baseOrigin).href;
        } catch {
            return '';
        }
    }
    if (input && typeof input.url === 'string') {
        try {
            return new URL(input.url, baseOrigin).href;
        } catch {
            return '';
        }
    }
    return '';
}

export function normalizeMethod(value) {
    const method = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return method || 'GET';
}

export function isChatMessagesUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.pathname.includes(CHAT_MESSAGES_PATH);
    } catch {
        return url.includes(CHAT_MESSAGES_PATH);
    }
}

export function shouldTrack(url, method) {
    if (!isChatMessagesUrl(url)) return false;
    return normalizeMethod(method) === 'POST';
}

export function formatElapsedMs(startedAt) {
    if (!Number.isFinite(Number(startedAt))) return '-';
    const elapsed = Math.max(0, Date.now() - Number(startedAt));
    return `${(elapsed / 1000).toFixed(1)}s`;
}

export function formatClockTimestamp(epochMs = Date.now()) {
    const date = new Date(epochMs);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

export function compactInlineText(value, maxLen = 100) {
    if (typeof value !== 'string') return '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen - 1)}…`;
}

export function showResultToast({ status = 0, ok = false, elapsedText = '-', channel = 'fetch', sseError = null }) {
    const statusText = Number.isFinite(Number(status)) && Number(status) > 0
        ? `HTTP ${Number(status)}`
        : '未知状态';
    const errorCode = sseError?.code ? `, ${sseError.code}` : '';
    const errorHint = sseError?.message ? `, ${compactInlineText(sseError.message, 40)}` : '';
    const text = `/chat-messages 已完成 (${statusText}, ${elapsedText}, ${channel}${errorCode}${errorHint})`;
    if (ok) {
        Toast.success(text, 2800);
    } else if (Number(status) >= 400) {
        Toast.error(text, 3600);
    } else {
        Toast.warning(text, 3200);
    }
}

export function findSseSeparator(buffer) {
    const idxCrLf = buffer.indexOf('\r\n\r\n');
    const idxLf = buffer.indexOf('\n\n');
    if (idxCrLf === -1 && idxLf === -1) return null;
    if (idxCrLf === -1) return { index: idxLf, length: 2 };
    if (idxLf === -1) return { index: idxCrLf, length: 4 };
    if (idxLf < idxCrLf) return { index: idxLf, length: 2 };
    return { index: idxCrLf, length: 4 };
}

export function parseSseBlock(rawBlock) {
    if (!rawBlock || !rawBlock.trim()) return null;
    const lines = rawBlock.split(/\r?\n/);
    let eventName = 'message';
    let hasEventLine = false;
    const dataLines = [];
    for (const line of lines) {
        if (!line || line.startsWith(':')) continue;
        const idx = line.indexOf(':');
        const key = idx >= 0 ? line.slice(0, idx).trim() : line.trim();
        let value = idx >= 0 ? line.slice(idx + 1) : '';
        if (value.startsWith(' ')) value = value.slice(1);
        if (key === 'event' && value) {
            eventName = value;
            hasEventLine = true;
            continue;
        }
        if (key === 'data') {
            dataLines.push(value);
        }
    }
    const dataText = dataLines.join('\n').trim();
    if (!dataText && !hasEventLine) return null;

    let json = null;
    if (dataText) {
        try {
            json = JSON.parse(dataText);
        } catch {
            json = null;
        }
    }
    const payloadEvent = json && typeof json.event === 'string' ? json.event : '';
    return {
        event: payloadEvent || eventName,
        eventName,
        dataText,
        json,
    };
}

export function toSseError(parsed) {
    if (!parsed) return null;
    const payload = parsed.json;
    if (!payload || typeof payload !== 'object') return null;
    const evt = typeof payload.event === 'string' ? payload.event : parsed.event;
    if (evt !== 'error') return null;
    return {
        event: 'error',
        code: typeof payload.code === 'string' ? payload.code : '',
        status: Number(payload.status || 0),
        message: typeof payload.message === 'string' ? payload.message : '',
        conversationId: typeof payload.conversation_id === 'string' ? payload.conversation_id : '',
        messageId: typeof payload.message_id === 'string' ? payload.message_id : '',
        raw: payload,
    };
}

export async function observeSseResponse(response, handlers = {}) {
    const onEvent = typeof handlers.onEvent === 'function' ? handlers.onEvent : null;
    const emitBlock = (rawBlock) => {
        const parsed = parseSseBlock(rawBlock);
        if (!parsed || !onEvent) return;
        onEvent(parsed);
    };

    const reader = response?.body?.getReader?.();
    if (!reader) {
        const text = await response?.text?.().catch(() => '');
        if (!text) return;
        const blocks = text.split(/\r?\n\r?\n/);
        for (const block of blocks) {
            emitBlock(block);
        }
        return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
            const separator = findSseSeparator(buffer);
            if (!separator) break;
            const rawBlock = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator.length);
            emitBlock(rawBlock);
        }
    }

    buffer += decoder.decode();
    while (true) {
        const separator = findSseSeparator(buffer);
        if (!separator) break;
        const rawBlock = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        emitBlock(rawBlock);
    }
    if (buffer.trim()) {
        emitBlock(buffer);
    }
}
