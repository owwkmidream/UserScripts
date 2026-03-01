import { CONFIG } from '../constants.js';

export function extractVerificationCode(content) {
    if (!content) return null;

    const plainText = extractPlainText(content);

    for (const pattern of CONFIG.VERIFICATION_CODE_PATTERNS) {
        const match = plainText.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }

    const codeFromHtml = extractCodeFromHtml(content);
    if (codeFromHtml) {
        return codeFromHtml;
    }

    const standaloneCode = findStandaloneCode(plainText);
    if (standaloneCode) {
        return standaloneCode;
    }

    return null;
}

export function extractPlainText(html) {
    let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

export function extractCodeFromHtml(html) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const candidates = [];
        const elements = doc.querySelectorAll('td, span, div, p, strong, b');

        for (const el of elements) {
            const text = (el.textContent || '').trim();
            if (/^\d{4,8}$/.test(text)) {
                const style = el.getAttribute('style') || '';
                const fontSize = style.match(/font-size:\s*(\d+)/i);
                const fontWeight = style.match(/font-weight:\s*(bold|\d+)/i);

                let score = 0;
                if (fontSize) {
                    const size = parseInt(fontSize[1], 10);
                    if (size >= 28) score += 10;
                    else if (size >= 20) score += 5;
                    else if (size >= 16) score += 2;
                }
                if (fontWeight) {
                    score += 3;
                }
                if (text.length === 6) {
                    score += 2;
                }

                if (score > 0) {
                    candidates.push({ code: text, score });
                }
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0].code;
        }
    } catch (e) {
        console.error('[验证码提取] HTML 解析失败:', e);
    }
    return null;
}

export function findStandaloneCode(text) {
    const matches = text.match(/\b(\d{4,8})\b/g);
    if (!matches) return null;

    const validCodes = matches.filter((code) => {
        if (matches.length === 1) return true;
        if (code.length === 6) return true;
        return false;
    });

    const sixDigit = validCodes.find((code) => code.length === 6);
    if (sixDigit) return sixDigit;

    return validCodes[0] || null;
}
