import { gmRequest } from '../../../gm.js';

const EMAILNATOR_BASE_URL = 'https://www.emailnator.com';
const GENERATE_EMAIL_TYPES = ['dotGmail'];

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function buildCookieJar() {
    const store = new Map();

    return {
        applyResponseHeaders(rawHeaders = '') {
            const lines = String(rawHeaders || '').split(/\r?\n/);
            for (const line of lines) {
                const colonIndex = line.indexOf(':');
                if (colonIndex <= 0) continue;

                const key = line.slice(0, colonIndex).trim().toLowerCase();
                if (key !== 'set-cookie') continue;

                const rawCookie = line.slice(colonIndex + 1).trim();
                if (!rawCookie) continue;

                const cookiePair = rawCookie.split(';', 1)[0];
                const equalIndex = cookiePair.indexOf('=');
                if (equalIndex <= 0) continue;

                const name = cookiePair.slice(0, equalIndex).trim();
                const value = cookiePair.slice(equalIndex + 1).trim();
                if (!name) continue;

                if (!value) {
                    store.delete(name);
                    continue;
                }

                store.set(name, value);
            }
        },

        get(name) {
            return store.get(name) || '';
        },

        toHeader() {
            return Array.from(store.entries())
                .map(([name, value]) => `${name}=${value}`)
                .join('; ');
        },
    };
}

function decodeXsrfToken(value) {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function buildBaseHeaders(jar, { includeJsonContentType = false } = {}) {
    const headers = {
        Accept: 'application/json, text/plain, */*',
        Origin: EMAILNATOR_BASE_URL,
        Referer: `${EMAILNATOR_BASE_URL}/`,
        'X-Requested-With': 'XMLHttpRequest',
    };
    const xsrfToken = decodeXsrfToken(jar.get('XSRF-TOKEN'));
    if (xsrfToken) {
        headers['X-XSRF-TOKEN'] = xsrfToken;
    }
    if (includeJsonContentType) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

async function requestEmailnator(path, {
    method = 'GET',
    body,
    jar,
    expectJson = true,
} = {}) {
    const cookieHeader = jar.toHeader();
    const response = await gmRequest({
        method,
        url: `${EMAILNATOR_BASE_URL}${path}`,
        headers: {
            ...buildBaseHeaders(jar, {
                includeJsonContentType: body !== undefined,
            }),
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        cookie: cookieHeader || undefined,
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout: 30000,
        anonymous: true,
    });

    jar.applyResponseHeaders(response.responseHeaders || '');

    const status = Number(response.status || 0);
    if (status < 200 || status >= 300) {
        throw new Error(`Emailnator 请求失败 (${status || 'unknown'})`);
    }

    const raw = response.responseText || '';
    if (!expectJson) {
        return raw;
    }

    try {
        return JSON.parse(raw);
    } catch {
        throw new Error('Emailnator 返回了无法解析的 JSON');
    }
}

async function bootstrapSession() {
    const jar = buildCookieJar();
    await requestEmailnator('/', {
        method: 'GET',
        jar,
        expectJson: false,
    });

    if (!jar.get('XSRF-TOKEN') || !jar.get('gmailnator_session')) {
        throw new Error('Emailnator 会话初始化失败');
    }

    return jar;
}

function fallbackHtmlToText(html) {
    return String(html || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveRelativeTimeSeconds(unit) {
    switch (unit) {
        case 'second':
        case 'sec':
            return 1;
        case 'minute':
        case 'min':
            return 60;
        case 'hour':
            return 3600;
        case 'day':
            return 86400;
        case 'week':
            return 604800;
        case 'month':
            return 2592000;
        case 'year':
            return 31536000;
        default:
            return 0;
    }
}

function parseTimeTextToTimestamp(timeText) {
    const normalized = normalizeText(timeText);
    if (!normalized) {
        return 0;
    }

    const parsedDate = Date.parse(normalized);
    if (Number.isFinite(parsedDate)) {
        return Math.floor(parsedDate / 1000);
    }

    const lowerText = normalized.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    if (lowerText === 'just now') {
        return now;
    }
    if (lowerText === 'yesterday') {
        return now - 86400;
    }

    const match = lowerText.match(/(\d+)\s*(second|sec|minute|min|hour|day|week|month|year)s?\s*ago/);
    if (!match) {
        return 0;
    }

    const count = Number(match[1] || 0);
    const unitSeconds = resolveRelativeTimeSeconds(match[2]);
    if (!Number.isFinite(count) || !unitSeconds) {
        return 0;
    }

    return now - (count * unitSeconds);
}

function htmlToText(html) {
    const rawHtml = normalizeText(html);
    if (!rawHtml) {
        return '';
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, 'text/html');
        doc.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
        const body = doc.body;
        if (!body) {
            return fallbackHtmlToText(rawHtml);
        }

        body.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
        body.querySelectorAll('p, div, section, article, header, footer, aside, li, tr, td, th, h1, h2, h3, h4, h5, h6')
            .forEach((node) => node.append('\n'));

        const text = body.innerText || body.textContent || '';
        return text
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    } catch {
        return fallbackHtmlToText(rawHtml);
    }
}

function normalizeMessage(message, htmlContent = '') {
    const html = normalizeText(htmlContent);
    const content = html ? htmlToText(html) : '';
    const timeText = normalizeText(message?.time);

    return {
        subject: normalizeText(message?.subject),
        from: normalizeText(message?.from),
        messageId: normalizeText(message?.messageID),
        time: timeText,
        timeText,
        timestamp: parseTimeTextToTimestamp(timeText),
        html_content: html,
        content,
    };
}

async function fetchMessageDetail(jar, email, messageId) {
    if (!messageId) {
        return '';
    }

    return requestEmailnator('/message-list', {
        method: 'POST',
        body: {
            email,
            messageID: messageId,
        },
        jar,
        expectJson: false,
    });
}

export const EmailnatorProvider = {
    id: 'emailnator',
    name: 'Emailnator',
    supportsUsage: false,
    requiresApiKey: false,
    baseUrl: EMAILNATOR_BASE_URL,

    async generateEmail() {
        const jar = await bootstrapSession();
        const payload = await requestEmailnator('/generate-email', {
            method: 'POST',
            body: {
                email: GENERATE_EMAIL_TYPES,
            },
            jar,
        });

        const email = Array.isArray(payload?.email)
            ? normalizeText(payload.email[0])
            : '';

        if (!email) {
            throw new Error('Emailnator 未返回有效邮箱');
        }

        return email;
    },

    async getEmails(email) {
        const normalizedEmail = normalizeText(email);
        if (!normalizedEmail) {
            return [];
        }

        const jar = await bootstrapSession();
        const payload = await requestEmailnator('/message-list', {
            method: 'POST',
            body: { email: normalizedEmail },
            jar,
        });

        const messages = Array.isArray(payload?.messageData) ? payload.messageData : [];
        const normalizedMessages = await Promise.all(messages.map(async (message) => {
            const messageId = normalizeText(message?.messageID);
            if (!messageId) {
                return normalizeMessage(message);
            }

            try {
                const htmlContent = await fetchMessageDetail(jar, normalizedEmail, messageId);
                return normalizeMessage(message, htmlContent);
            } catch {
                return normalizeMessage(message);
            }
        }));

        return normalizedMessages;
    },
};
