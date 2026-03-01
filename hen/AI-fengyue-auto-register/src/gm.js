export const gmGetValue = (key, defaultValue) => GM_getValue(key, defaultValue);
export const gmSetValue = (key, value) => GM_setValue(key, value);
export const gmRegisterMenuCommand = (name, handler) => GM_registerMenuCommand(name, handler);
export const gmXmlHttpRequest = (options) => GM_xmlhttpRequest(options);
export const gmAddStyle = (styles) => GM_addStyle(styles);

function parseHeaders(rawHeaders) {
    const headers = {};
    const lines = (rawHeaders || '').split(/\r?\n/);
    for (const line of lines) {
        if (!line) continue;
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (key) headers[key] = value;
    }
    return headers;
}

export function gmRequest(options) {
    return new Promise((resolve, reject) => {
        gmXmlHttpRequest({
            ...options,
            onload: (response) => resolve(response),
            onerror: (error) => reject(new Error(error?.error || 'GM 请求失败')),
            ontimeout: () => reject(new Error('GM 请求超时')),
            onabort: () => reject(new Error('GM 请求已中止')),
        });
    });
}

export async function gmRequestJson(options) {
    const method = options.method || 'GET';
    const response = await gmRequest({
        method,
        url: options.url,
        headers: options.headers || {},
        data: options.body ? JSON.stringify(options.body) : undefined,
        timeout: options.timeout ?? 30000,
        anonymous: options.anonymous ?? false,
    });

    const raw = response.responseText || '';
    let json = null;
    if (raw) {
        try {
            json = JSON.parse(raw);
        } catch {
            json = null;
        }
    }

    return {
        status: response.status || 0,
        statusText: response.statusText || '',
        headers: parseHeaders(response.responseHeaders || ''),
        raw,
        json,
    };
}
