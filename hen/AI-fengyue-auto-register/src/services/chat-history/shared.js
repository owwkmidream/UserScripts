import {
    decodeEscapedText,
    hasMeaningfulText as hasMeaningfulTextValue,
    normalizeTimestamp,
} from '../../utils/text-normalize.js';
import { marked } from '../../vendor/marked.esm.js';

export const INDEX_KEY = 'aifengyue_chat_index_v1';

const RAW_HTML_BLOCK_TAGS = new Set([
    'article',
    'aside',
    'blockquote',
    'button',
    'details',
    'div',
    'figure',
    'figcaption',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'section',
    'summary',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
]);

const VOID_HTML_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);

const SAFE_INLINE_HTML_TAGS = new Set([
    'b',
    'br',
    'code',
    'del',
    'em',
    'font',
    'i',
    'kbd',
    'mark',
    's',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'u',
]);

const BLOCKED_RENDER_TAGS = new Set([
    'base',
    'embed',
    'form',
    'iframe',
    'input',
    'link',
    'meta',
    'object',
    'script',
    'style',
    'textarea',
]);

const MARKDOWN_CODE_COPY_ICON_CLASS = 'style_copyIcon__euyNI';
const MARKDOWN_CODE_COPIED_CLASS = 'style_copied__SbkhO';

let markdownCodeBlockSerial = 0;

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

function sanitizeUrlLikeAttr(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (/^(?:javascript|vbscript|data:text\/html)/i.test(normalized)) {
        return '';
    }
    return normalized;
}

function sanitizeRenderedMarkdownHtml(html) {
    const source = String(html || '');
    if (!source.trim()) return '';

    if (typeof DOMParser !== 'function') {
        return source
            .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|textarea)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
            .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|textarea)\b[^>]*\/?\s*>/gi, '')
            .replace(/\s+on[a-z-]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
            .replace(/\s+(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${source}</body>`, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    const nodes = [];

    let current = walker.nextNode();
    while (current) {
        nodes.push(current);
        current = walker.nextNode();
    }

    for (const node of nodes) {
        const tagName = String(node.tagName || '').toLowerCase();
        if (!tagName) continue;

        if (BLOCKED_RENDER_TAGS.has(tagName)) {
            node.remove();
            continue;
        }

        for (const attr of [...node.attributes]) {
            const attrName = String(attr.name || '').toLowerCase();
            if (!attrName) continue;

            if (attrName.startsWith('on')) {
                node.removeAttribute(attr.name);
                continue;
            }

            if (attrName === 'href' || attrName === 'src' || attrName === 'xlink:href') {
                const sanitized = sanitizeUrlLikeAttr(attr.value);
                if (!sanitized) {
                    node.removeAttribute(attr.name);
                } else {
                    node.setAttribute(attr.name, sanitized);
                }
            }
        }
    }

    return doc.body.innerHTML;
}

function isSafeCssColor(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return /^(?:[a-z]+|#[0-9a-f]{3,8}|rgba?\([0-9\s,%.]+\)|hsla?\([0-9\s,%.]+\))$/i.test(normalized);
}

function isSafeFontSize(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return /^(?:[1-7]|[+-][1-7]|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i.test(normalized);
}

function isSafeFontFace(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return /^[\w\s,\-"']{1,80}$/i.test(normalized);
}

function sanitizeInlineHtmlTag(rawTag) {
    const source = String(rawTag || '');
    const matched = source.match(/^<\s*(\/?)\s*([a-z][\w-]*)\b([^>]*)>\s*$/i);
    if (!matched) return '';

    const isClosing = matched[1] === '/';
    const tagName = String(matched[2] || '').toLowerCase();
    const rawAttrs = String(matched[3] || '');
    const isSelfClosing = /\/\s*$/.test(rawAttrs) || VOID_HTML_TAGS.has(tagName);
    if (!SAFE_INLINE_HTML_TAGS.has(tagName)) return '';

    if (isClosing) {
        return `</${tagName}>`;
    }

    const attrs = [];
    if (tagName === 'font') {
        const colorMatched = rawAttrs.match(/\bcolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
        const sizeMatched = rawAttrs.match(/\bsize\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
        const faceMatched = rawAttrs.match(/\bface\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);

        const colorValue = colorMatched?.[2] ?? colorMatched?.[3] ?? colorMatched?.[4] ?? '';
        const sizeValue = sizeMatched?.[2] ?? sizeMatched?.[3] ?? sizeMatched?.[4] ?? '';
        const faceValue = faceMatched?.[2] ?? faceMatched?.[3] ?? faceMatched?.[4] ?? '';

        if (isSafeCssColor(colorValue)) {
            attrs.push(` color="${escapeHtml(colorValue.trim())}"`);
        }
        if (isSafeFontSize(sizeValue)) {
            attrs.push(` size="${escapeHtml(sizeValue.trim())}"`);
        }
        if (isSafeFontFace(faceValue)) {
            attrs.push(` face="${escapeHtml(faceValue.trim())}"`);
        }
    }

    return `<${tagName}${attrs.join('')}${isSelfClosing ? ' /' : ''}>`;
}

function preserveSafeInlineHtml(text) {
    const htmlTokens = [];
    const value = String(text ?? '').replace(/<\/?[a-z][^>\n]*>/gi, (rawTag) => {
        const sanitized = sanitizeInlineHtmlTag(rawTag);
        if (!sanitized) return rawTag;

        const placeholder = `@@AFHTML${htmlTokens.length}@@`;
        htmlTokens.push(sanitized);
        return placeholder;
    });

    return {
        value,
        htmlTokens,
    };
}

function renderInlineMarkdown(text) {
    const codeTokens = [];
    let value = String(text ?? '').replace(/(`+)([\s\S]*?)\1/g, (_, __, content) => {
        const placeholder = `__AF_CODE_${codeTokens.length}__`;
        codeTokens.push(`<code>${escapeHtml(content)}</code>`);
        return placeholder;
    });

    const preservedInlineHtml = preserveSafeInlineHtml(value);
    value = preservedInlineHtml.value;

    value = escapeHtml(value);

    value = value
        .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, alt, url) => (
            `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`
        ))
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label, url) => (
            `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        ))
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

    for (let i = 0; i < codeTokens.length; i++) {
        value = value.replace(`__AF_CODE_${i}__`, codeTokens[i]);
    }

    for (let i = 0; i < preservedInlineHtml.htmlTokens.length; i++) {
        value = value.replace(`@@AFHTML${i}@@`, preservedInlineHtml.htmlTokens[i]);
    }

    return value;
}

function isRawHtmlBlockStart(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('<')) return false;
    if (/^<!--/.test(trimmed)) return true;

    const matched = trimmed.match(/^<\/?([a-z][\w-]*)\b/i);
    if (!matched?.[1]) return false;
    return RAW_HTML_BLOCK_TAGS.has(matched[1].toLowerCase());
}

function updateHtmlTagStack(stack, line) {
    const tagMatcher = /<\/?([a-z][\w-]*)\b[^>]*>/gi;
    let matched = tagMatcher.exec(String(line || ''));
    while (matched) {
        const rawTag = matched[0];
        const tagName = String(matched[1] || '').toLowerCase();
        if (!tagName || VOID_HTML_TAGS.has(tagName) || /^<!--/.test(rawTag) || rawTag.endsWith('/>')) {
            matched = tagMatcher.exec(String(line || ''));
            continue;
        }

        if (rawTag.startsWith('</')) {
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i] !== tagName) continue;
                stack.length = i;
                break;
            }
        } else {
            stack.push(tagName);
        }

        matched = tagMatcher.exec(String(line || ''));
    }
}

function collectRawHtmlBlock(lines, startIndex) {
    const collected = [];
    const stack = [];
    let index = startIndex;
    while (index < lines.length) {
        const line = String(lines[index] ?? '');
        collected.push(line);

        if (!/^<!--/.test(line.trim())) {
            updateHtmlTagStack(stack, line);
        }

        index += 1;
        if (stack.length === 0) {
            break;
        }
    }

    return {
        html: collected.join('\n').trim(),
        nextIndex: index,
    };
}

function isMarkdownBlockStart(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return false;
    if (/^(```+|~~~+)/.test(trimmed)) return true;
    if (/^#{1,6}\s+/.test(trimmed)) return true;
    if (/^\s*>\s?/.test(trimmed)) return true;
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed)) return true;
    if (looksLikeMarkdownTableStart(trimmed)) return true;
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) return true;
    return isRawHtmlBlockStart(trimmed);
}

function splitMarkdownTableRow(line) {
    const source = String(line ?? '')
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '');

    const cells = [];
    let current = '';
    let escaped = false;
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            current += char;
            continue;
        }
        if (char === '|') {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }
    cells.push(current.trim());
    return cells;
}

function parseMarkdownTableAlignments(line) {
    const cells = splitMarkdownTableRow(line);
    if (!cells.length) return null;

    const alignments = [];
    for (const cell of cells) {
        const normalized = cell.replace(/\s+/g, '');
        if (!/^:?-{3,}:?$/.test(normalized)) {
            return null;
        }
        if (normalized.startsWith(':') && normalized.endsWith(':')) {
            alignments.push('center');
        } else if (normalized.endsWith(':')) {
            alignments.push('right');
        } else {
            alignments.push('left');
        }
    }
    return alignments;
}

function looksLikeMarkdownTableStart(line, nextLine = '') {
    const headerCells = splitMarkdownTableRow(line);
    if (headerCells.length < 2) return false;
    return Array.isArray(parseMarkdownTableAlignments(nextLine));
}

function collectMarkdownTable(lines, startIndex) {
    const headerLine = String(lines[startIndex] ?? '');
    const alignLine = String(lines[startIndex + 1] ?? '');
    const alignments = parseMarkdownTableAlignments(alignLine);
    if (!alignments) {
        return null;
    }

    const headerCells = splitMarkdownTableRow(headerLine);
    if (headerCells.length < 2 || headerCells.length !== alignments.length) {
        return null;
    }

    const rows = [];
    let index = startIndex + 2;
    while (index < lines.length) {
        const currentLine = String(lines[index] ?? '');
        const trimmed = currentLine.trim();
        if (!trimmed) break;
        if (!trimmed.includes('|')) break;

        const cells = splitMarkdownTableRow(currentLine);
        if (cells.length !== headerCells.length) break;

        rows.push(cells);
        index += 1;
    }

    const renderCells = (cells, cellTag) => `
        <tr>${cells.map((cell, cellIndex) => {
        const align = alignments[cellIndex] || 'left';
        return `<${cellTag} data-align="${align}">${renderInlineMarkdown(cell)}</${cellTag}>`;
    }).join('')}</tr>
    `;

    const bodyHtml = rows.length
        ? `<tbody>${rows.map((cells) => renderCells(cells, 'td')).join('')}</tbody>`
        : '';

    return {
        html: `<table><thead>${renderCells(headerCells, 'th')}</thead>${bodyHtml}</table>`,
        nextIndex: index,
    };
}

function collectMarkdownList(lines, startIndex, ordered) {
    const matcher = ordered
        ? /^\s*\d+[.)]\s+(.*)$/
        : /^\s*[-*+]\s+(.*)$/;
    const tagName = ordered ? 'ol' : 'ul';
    const items = [];
    let index = startIndex;

    while (index < lines.length) {
        const currentLine = String(lines[index] ?? '');
        if (!currentLine.trim()) break;

        const matched = currentLine.match(matcher);
        if (matched) {
            items.push([matched[1]]);
            index += 1;
            continue;
        }

        if (!items.length || isMarkdownBlockStart(currentLine) || !/^\s{2,}\S/.test(currentLine)) {
            break;
        }

        items[items.length - 1].push(currentLine.trim());
        index += 1;
    }

    return {
        html: `<${tagName}>${items.map((itemLines) => `<li>${itemLines.map(renderInlineMarkdown).join('<br>')}</li>`).join('')}</${tagName}>`,
        nextIndex: index,
    };
}

function collectMarkdownBlockquote(lines, startIndex) {
    const quoteLines = [];
    let index = startIndex;
    while (index < lines.length) {
        const currentLine = String(lines[index] ?? '');
        if (!currentLine.trim()) {
            quoteLines.push('');
            index += 1;
            continue;
        }

        const matched = currentLine.match(/^\s*>\s?(.*)$/);
        if (!matched) break;

        quoteLines.push(matched[1]);
        index += 1;
    }

    return {
        html: `<blockquote>${renderMarkdownHtml(quoteLines.join('\n'))}</blockquote>`,
        nextIndex: index,
    };
}

function pickCodeLanguageToken(value) {
    const source = String(value || '').trim();
    if (!source) return '';
    return source.split(/\s+/)[0]?.trim() || '';
}

function normalizeCodeLanguage(value) {
    return pickCodeLanguageToken(value)
        .replace(/^[`'"]+|[`'"]+$/g, '')
        .replace(/[^\w#+.-]/g, '')
        .toLowerCase();
}

function getCodeLanguageLabel(rawLanguage, normalizedLanguage) {
    const displayValue = pickCodeLanguageToken(rawLanguage)
        .replace(/[^\w#+.-]/g, '');
    if (displayValue) return displayValue;
    return normalizedLanguage ? normalizedLanguage.toUpperCase() : '';
}

function renderMarkdownCodeBlock(token) {
    const text = typeof token?.text === 'string'
        ? token.text.replace(/\n$/, '')
        : '';
    const language = normalizeCodeLanguage(token?.lang);
    const codeId = `af-code-content-${++markdownCodeBlockSerial}`;
    const escapedCode = escapeHtml(text);

    if (!language) {
        return `<pre><code node id="${codeId}" class="hljs">${escapedCode}</code></pre>`;
    }

    const languageLabel = getCodeLanguageLabel(token?.lang, language);
    const tooltipId = `copy-tooltip-${markdownCodeBlockSerial}`;

    return [
        '<pre>',
        '<div class="af-code-block">',
        '<div class="border-b flex justify-between items-center af-code-block-header" data-af-copy-ignore="true">',
        `<div class="af-code-block-language">${escapeHtml(languageLabel)}</div>`,
        `<div data-tooltip-id="${tooltipId}" class="af-code-copy-trigger" data-af-copy-target="#${codeId}" data-af-copy-mode="icon" data-af-copy-copied-class="${MARKDOWN_CODE_COPIED_CLASS}" role="button" tabindex="0" title="复制代码" aria-label="复制代码">`,
        `<div class="af-code-copy-icon ${MARKDOWN_CODE_COPY_ICON_CLASS}"></div>`,
        '</div>',
        '</div>',
        '<div node class="af-code-block-body">',
        `<code node id="${codeId}" class="hljs language-${escapeHtml(language)}">${escapedCode}</code>`,
        '</div>',
        '</div>',
        '</pre>',
    ].join('');
}

function renderMarkdownHtml(text) {
    const normalized = normalizeLineBreakTokens(text);
    const renderer = new marked.Renderer();
    renderer.code = (token) => renderMarkdownCodeBlock(token);
    const rendered = marked.parse(normalized, {
        async: false,
        breaks: true,
        gfm: true,
        renderer,
    });
    return sanitizeRenderedMarkdownHtml(rendered);
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

export function renderMessageBody(text, emptyPlaceholder = '(空)', options = {}) {
    const {
        preferMarkdown = false,
    } = options || {};
    const normalized = asDisplayContent(text);
    if (!normalized) {
        return `<pre class="af-plain" style="white-space: pre-wrap !important;">${escapeHtml(emptyPlaceholder)}</pre>`;
    }
    if (preferMarkdown) {
        return `<div class="markdown-body af-markdown-body">${renderMarkdownHtml(normalized)}</div>`;
    }
    if (looksLikeHtml(normalized)) {
        const normalizedHtml = sanitizeRenderedMarkdownHtml(normalizeLineBreakTokens(normalized));
        return `<div class="markdown-body af-markdown-body">${normalizedHtml}</div>`;
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
