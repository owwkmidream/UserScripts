import {
    normalizeId,
    uniqueStringArray,
    escapeHtml,
    asDisplayContent,
    stripDuplicatedAnswerPrefix,
    renderMessageBody,
} from './shared.js';
import { PREVIEW_HOST_CSS } from './preview-host-css.js';

function pickText(source, keys, fallback = '') {
    if (!source || typeof source !== 'object') return fallback;
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    const lowerMap = {};
    for (const [key, value] of Object.entries(source)) {
        lowerMap[String(key).toLowerCase()] = value;
    }
    for (const key of keys) {
        const value = lowerMap[String(key).toLowerCase()];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return fallback;
}

function extractAssetUrlFromCss(styleText, kind) {
    if (typeof styleText !== 'string' || !styleText.trim()) return '';
    const matcher = /url\((['"]?)(.*?)\1\)/gi;
    const urls = [];
    let matched = matcher.exec(styleText);
    while (matched) {
        const raw = String(matched[2] || '').trim();
        if (raw && !raw.startsWith('data:')) {
            urls.push(raw);
        }
        matched = matcher.exec(styleText);
    }
    if (!urls.length) return '';
    return urls.find((item) => item.includes(`/${kind}`) || item.endsWith(kind)) || '';
}

function resolveAssetUrl({ appMeta, appId, kind }) {
    const keys = kind === 'bg'
        ? ['bg', 'bgUrl', 'backgroundUrl', 'background']
        : ['cover', 'coverUrl', 'avatar', 'avatarUrl', 'image', 'imageUrl'];

    const direct = pickText(appMeta, keys, '');
    if (direct) return direct;

    const fromCss = extractAssetUrlFromCss(appMeta?.builtInCss, kind);
    if (fromCss) return fromCss;

    if (/^[0-9a-f-]{16,}$/i.test(appId)) {
        return `https://catai.wiki/${appId}/${kind}`;
    }
    return '';
}

function sanitizeInlineStyleText(text) {
    return String(text || '').replace(/<\/style/gi, '<\\/style');
}

export const chatHistoryViewerMethods = {
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

        const builtInCss = sanitizeInlineStyleText(String(appMeta?.builtInCss || ''));
        const hostCss = sanitizeInlineStyleText(PREVIEW_HOST_CSS);
        const appNameRaw = typeof appMeta?.name === 'string' && appMeta.name.trim()
            ? appMeta.name.trim()
            : normalizedAppId;
        const appName = escapeHtml(appNameRaw);
        const conversationIds = uniqueStringArray(chain?.conversationIds || []);
        const bgUrl = escapeHtml(resolveAssetUrl({ appMeta, appId: normalizedAppId, kind: 'bg' }));
        const coverUrl = escapeHtml(resolveAssetUrl({ appMeta, appId: normalizedAppId, kind: 'cover' }));
        const userAvatar = escapeHtml((appNameRaw || 'C').slice(0, 1).toUpperCase() || 'C');
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
                const queryContentId = `af-query-content-${index + 1}`;
                const answerContentId = `af-answer-content-${index + 1}`;
                if (answerText) {
                    answerHistory.push(answerText);
                }

                return `
                    <div class="group flex mb-2 last:mb-0 af-row-user">
                        <div class="shrink-0 w-10 h-10 relative bg-white rounded-full block md:block af-avatar-user-wrap">
                            <div class="shrink-0 flex items-center rounded-full bg-primary-600 af-avatar-user">
                                <div class="text-center text-white scale-[0.4] af-avatar-user-char">${userAvatar}</div>
                            </div>
                        </div>
                        <div class="group relative ml-2 md:ml-4 mr-4 md:mr-0 af-user-wrap">
                            <div id="${queryContentId}" class="relative inline-block px-4 py-3 max-w-full text-gray-900 bg-gray-100/90 rounded-xl text-sm af-message-bubble af-user-bubble">
                                <div class="absolute top-0 left-1/2 transform -translate-x-1/2 w-[94%] h-0.5 bg-[#c9e1e9] rounded-xl af-top-line-user"></div>
                                ${renderedQuery}
                            </div>
                            <div class="af-copy-row">
                                <button class="af-copy-btn" type="button" data-af-copy-target="#${queryContentId}">复制 Query</button>
                            </div>
                        </div>
                    </div>
                    <div class="flex mb-2 last:mb-0 af-row-answer" id="ai-chat-answer">
                        <div class="chat-answer-container group grow w-0 mr-2 md:mr-4 af-answer-grow">
                            <div class="group relative ml-4 md:ml-0 af-answer-wrap">
                                <div id="${answerContentId}" class="relative inline-block px-4 py-3 w-full bg-gray-100/90 rounded-xl text-sm text-gray-900 af-message-bubble af-answer-bubble">
                                    <div class="absolute top-0 right-1/2 transform translate-x-1/2 w-[94%] h-0.5 bg-[#F1CBCB] rounded-xl af-top-line-answer"></div>
                                    ${renderedAnswer}
                                </div>
                                <div class="af-copy-row">
                                    <button class="af-copy-btn" type="button" data-af-copy-target="#${answerContentId}">复制 Answer</button>
                                </div>
                            </div>
                        </div>
                        <div class="shrink-0 relative w-10 h-10 bg-gray-100/90 rounded-full block md:block af-avatar-ai-wrap">
                            <img class="shrink-0 flex items-center rounded-full not-toggle af-avatar-ai" alt="${appName}" src="${coverUrl}" ${coverUrl ? '' : 'style="display:none;"'} onerror="this.style.display='none';if(this.nextElementSibling){this.nextElementSibling.style.display='flex';}">
                            <div class="af-avatar-ai-fallback" ${coverUrl ? 'style="display:none;"' : ''}>AI</div>
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
    <title>${appName} - 本地会话</title>
    <style>
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
        body {
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #f3f6fa;
            color: #111827;
        }
        .af-root-wrap, .af-root-inner, #installedBuiltInCss {
            width: 100%;
            height: 100%;
        }
        #installedBuiltInCss {
            position: relative;
            overflow: hidden;
            background: #eef2f7;
        }
        .af-bg-img {
            width: 100%;
            height: auto;
            min-height: 100%;
            position: absolute;
            top: 50%;
            left: 0;
            transform: translateY(-50%);
            object-fit: cover;
            transition: all .5s ease-in-out;
        }
        .af-mask {
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(255,255,255,.65) 0%, rgba(255,255,255,.82) 55%, rgba(255,255,255,.94) 100%);
            pointer-events: none;
        }
        .chat-container {
            overflow-y: auto;
            width: 100%;
            height: 100%;
        }
        .chat-container::-webkit-scrollbar { width: 6px; }
        .chat-container::-webkit-scrollbar-thumb {
            border-radius: 999px;
            background: rgba(148,163,184,.55);
        }
        .af-chat-main {
            max-width: 720px;
            width: 100%;
            margin: 0 auto;
            padding: 18px 4px 20px;
            position: relative;
        }
        .af-row-user, .af-row-answer {
            margin-bottom: 8px;
            align-items: flex-start;
        }
        .af-avatar-user-wrap, .af-avatar-ai-wrap {
            width: 40px;
            height: 40px;
            border-radius: 999px;
            overflow: hidden;
        }
        .af-avatar-user-wrap {
            border: 1px solid #e5e7eb;
            background: #fff;
        }
        .af-avatar-user {
            width: 40px;
            height: 40px;
            border-radius: 999px;
            background: #2563eb;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .af-avatar-user-char {
            width: 40px;
            height: 40px;
            line-height: 40px;
            text-align: center;
            font-size: 40px;
            font-weight: 700;
            transform: scale(.4);
            transform-origin: center;
            color: #fff;
        }
        .af-user-wrap {
            margin-left: 8px;
            margin-right: 16px;
            max-width: calc(100% - 56px);
        }
        .af-answer-grow { min-width: 0; }
        .af-answer-wrap { margin-left: 16px; }
        .af-message-bubble {
            border-radius: 12px;
            border: 1px solid rgba(229,231,235,.95);
            background: rgba(243,244,246,.9);
            box-shadow: 0 1px 2px rgba(15,23,42,.06);
            overflow-x: auto;
            position: relative;
        }
        .af-user-bubble { display: inline-block; max-width: 100%; }
        .af-answer-bubble { display: inline-block; width: 100%; }
        .af-top-line-user, .af-top-line-answer {
            position: absolute;
            top: 0;
            width: 94%;
            height: 2px;
            border-radius: 999px;
        }
        .af-top-line-user { left: 50%; transform: translateX(-50%); background: #c9e1e9; }
        .af-top-line-answer { right: 50%; transform: translateX(50%); background: #f1cbcb; }
        .af-message-bubble .af-plain {
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: #111827;
            font-size: 14px;
            line-height: 1.7;
            white-space: pre-wrap !important;
            word-break: break-word;
        }
        .af-message-bubble .markdown-body {
            font-size: 14px !important;
            line-height: 1.7;
            color: #111827;
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        .af-message-bubble .markdown-body pre {
            margin: 8px 0 0;
            border-radius: 10px;
            border: 1px solid rgba(0,0,0,.08);
            background: #fff;
            overflow: hidden;
        }
        .af-copy-row {
            margin-top: 4px;
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .af-copy-btn {
            border: 1px solid #d7dde8 !important;
            border-radius: 7px !important;
            background: rgba(255, 255, 255, 0.92) !important;
            color: #4b5563 !important;
            font-size: 11px !important;
            line-height: 1 !important;
            height: 24px !important;
            padding: 0 9px !important;
            cursor: pointer !important;
            transition: all 0.18s ease !important;
        }
        .af-copy-btn:hover {
            border-color: #60a5fa !important;
            color: #1d4ed8 !important;
            background: #eff6ff !important;
        }
        .af-copy-btn:active {
            transform: scale(0.97);
        }
        .af-avatar-ai-wrap {
            border: 1px solid #d1d5db;
            background: rgba(243,244,246,.9);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .af-avatar-ai {
            width: 40px;
            height: 40px;
            object-fit: cover;
            border-radius: 999px;
        }
        .af-avatar-ai-fallback {
            width: 40px;
            height: 40px;
            border-radius: 999px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #e2e8f0;
            color: #334155;
            font-size: 12px;
            font-weight: 700;
        }
        .af-empty {
            border: 1px dashed #cbd5e1;
            border-radius: 12px;
            padding: 18px 14px;
            text-align: center;
            font-size: 13px;
            color: #64748b;
            background: rgba(255,255,255,.92);
        }
    </style>
    <style id="aifengyue-host-css">
        ${hostCss}
    </style>
    <style id="aifengyue-built-in-css">
        ${builtInCss}
    </style>
</head>
<body>
    <div class="grow overflow-hidden af-root-wrap">
        <div class="relative h-full af-root-inner">
            <div id="installedBuiltInCss" class="relative w-full h-full overflow-hidden">
                ${bgUrl ? `<img src="${bgUrl}" alt="" class="w-full h-auto absolute top-1/2 left-0 transform -translate-y-1/2 object-cover transition-all duration-500 ease-in-out af-bg-img">` : ''}
                <div class="af-mask"></div>
                <div class="overflow-y-auto w-full h-full chat-container mx-auto">
                    <div class="mx-auto w-full max-w-[720px] px-1 md:px-4 relative af-chat-main">
                        ${messageHtml}
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
    },
};
