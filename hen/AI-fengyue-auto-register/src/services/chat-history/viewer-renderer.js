import { ChatHistoryStore } from '../chat-history-store.js';
import {
    INDEX_KEY,
    normalizeId,
    makeConversationKey,
    createChainId,
    uniqueStringArray,
    readIndex,
    writeIndex,
    escapeHtml,
    formatTime,
    asDisplayContent,
    stripDuplicatedAnswerPrefix,
    renderMessageBody,
    extractLatestQueryTail,
    cloneJsonCompatible,
    hasMeaningfulText,
    toChainRecord,
} from './shared.js';

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
