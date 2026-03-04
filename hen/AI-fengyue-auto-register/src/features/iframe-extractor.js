import { gmAddStyle, gmRequestJson } from '../gm.js';
import { Toast } from '../ui/toast.js';
import { decodeEscapedText } from '../utils/text-normalize.js';
import {
    isRetryableNetworkError,
    resolveRetryAttempts as resolveRetryAttemptsUtil,
} from '../utils/retry-policy.js';

const X_LANGUAGE = 'zh-Hans';
const DEFAULT_OBJECTIVE_RETRY_ATTEMPTS = 3;

function sanitizeFilename(value) {
    const normalized = String(value || '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || 'aifengyue-app';
}

export const IframeExtractor = {
    button: null,
    isDetailPage: false,

    checkDetailPage() {
        const urlPattern = /\/zh\/explore\/(?:test-)?installed\/[0-9a-f-]+$/i;
        return urlPattern.test(window.location.pathname);
    },

    extractInstalledAppId() {
        const matched = window.location.pathname.match(/\/(?:test-)?installed\/([0-9a-f-]+)$/i);
        return matched?.[1] || '';
    },

    isExtractAvailable() {
        return this.checkDetailPage() && !!this.extractInstalledAppId();
    },

    createStyles() {
        gmAddStyle(`
            #aifengyue-extract-btn {
                position: fixed;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 40px;
                height: 100px;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                border: none;
                border-radius: 8px 0 0 8px;
                cursor: pointer;
                z-index: 2147483644;
                display: flex;
                align-items: center;
                justify-content: center;
                writing-mode: vertical-rl;
                color: #fff;
                font-size: 14px;
                font-weight: bold;
                box-shadow: -2px 0 10px rgba(0, 0, 0, 0.2);
                transition: all 0.3s ease;
            }
            #aifengyue-extract-btn:hover {
                width: 50px;
                background: linear-gradient(135deg, #059669 0%, #10b981 100%);
                box-shadow: -4px 0 15px rgba(16, 185, 129, 0.4);
            }
            #aifengyue-extract-btn:active {
                transform: translateY(-50%) scale(0.95);
            }
        `);
    },

    createButton() {
        if (this.button) return;

        this.createStyles();

        this.button = document.createElement('button');
        this.button.id = 'aifengyue-extract-btn';
        this.button.textContent = '提取HTML';
        this.button.title = '从接口提取应用 HTML 并导出';
        this.button.addEventListener('click', () => this.extractAndSave());
        document.body.appendChild(this.button);
    },

    removeButton() {
        if (this.button) {
            this.button.remove();
            this.button = null;
        }
    },

    getCleanTitle() {
        const title = document.title;
        return title.replace(/\s*-\s*Powered by AI风月\s*$/i, '').trim();
    },

    resolveRetryAttempts(maxAttempts) {
        return resolveRetryAttemptsUtil(maxAttempts, DEFAULT_OBJECTIVE_RETRY_ATTEMPTS);
    },

    isObjectiveRetryError(error) {
        return isRetryableNetworkError(error, { includeHttpStatus: true });
    },

    async requestAppDetail({ appId, token, maxAttempts = DEFAULT_OBJECTIVE_RETRY_ATTEMPTS }) {
        const attempts = this.resolveRetryAttempts(maxAttempts);
        const url = `${window.location.origin}/go/api/apps/${appId}`;
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const response = await gmRequestJson({
                    method: 'GET',
                    url,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Language': X_LANGUAGE,
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    timeout: 25000,
                    anonymous: true,
                });

                if (response.status < 200 || response.status >= 300) {
                    const error = new Error(`获取应用详情失败: HTTP ${response.status}`);
                    error.httpStatus = response.status;
                    throw error;
                }
                if (!response.json || typeof response.json !== 'object') {
                    throw new Error('应用详情接口返回非 JSON 数据');
                }
                return response.json;
            } catch (error) {
                lastError = error;
                const hasNext = attempt < attempts;
                if (!hasNext || !this.isObjectiveRetryError(error)) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
            }
        }

        throw lastError || new Error('获取应用详情失败');
    },

    extractAppPayload(payload, fallbackTitle) {
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
        const appInfo = data?.apps && typeof data.apps === 'object'
            ? data.apps
            : (data?.app && typeof data.app === 'object' ? data.app : {});
        const modelConfig = data?.model_config && typeof data.model_config === 'object'
            ? data.model_config
            : (data?.modelConfig && typeof data.modelConfig === 'object' ? data.modelConfig : {});

        return {
            name: decodeEscapedText(typeof appInfo?.name === 'string' ? appInfo.name : '') || fallbackTitle,
            description: decodeEscapedText(typeof appInfo?.description === 'string' ? appInfo.description : ''),
            builtInCss: decodeEscapedText(typeof modelConfig?.built_in_css === 'string' ? modelConfig.built_in_css : ''),
        };
    },

    buildHtmlDocument({ name, description, builtInCss }) {
        return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${name}</title>
    <style>
        body {
            margin: 0;
            padding: 24px;
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: #f4f5f7;
            color: #1f2937;
            line-height: 1.7;
        }
        .af-root {
            max-width: 960px;
            margin: 0 auto;
            background: #fff;
            border: 1px solid #dce1eb;
            border-radius: 12px;
            padding: 20px;
        }
        .af-title {
            margin: 0 0 16px;
            font-size: 22px;
            font-weight: 700;
        }
        ${builtInCss || ''}
    </style>
</head>
<body>
    <main class="af-root">
        <h1 class="af-title">${name}</h1>
        ${description || '<p>应用描述为空。</p>'}
    </main>
</body>
</html>`;
    },

    downloadHtmlFile(filename, html) {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    async extractAndSave() {
        const appId = this.extractInstalledAppId();
        if (!appId) {
            Toast.error('当前页面不是应用详情页，无法提取 HTML');
            return;
        }

        const token = (localStorage.getItem('console_token') || '').trim();
        const fallbackTitle = this.getCleanTitle() || `app-${appId}`;

        try {
            Toast.info('正在请求应用详情并导出 HTML...', 2000);

            const payload = await this.requestAppDetail({
                appId,
                token,
                maxAttempts: DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
            });
            const data = this.extractAppPayload(payload, fallbackTitle);
            const html = this.buildHtmlDocument(data);
            const filename = `${sanitizeFilename(data.name || fallbackTitle)}.html`;

            this.downloadHtmlFile(filename, html);
            Toast.success(`已保存为: ${filename}`);
        } catch (error) {
            Toast.error(`提取失败: ${error.message}`);
            console.error('[HTML 提取器] 错误:', error);
        }
    },

    checkAndUpdate() {
        this.isDetailPage = this.checkDetailPage();
        if (this.button) {
            this.removeButton();
        }
    },
};
