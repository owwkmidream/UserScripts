import { gmAddStyle } from '../gm.js';
import { Toast } from '../ui/toast.js';

export const IframeExtractor = {
    button: null,
    isDetailPage: false,

    checkDetailPage() {
        const urlPattern = /\/zh\/explore\/(?:test-)?installed\/[0-9a-f-]+$/i;
        return urlPattern.test(window.location.pathname);
    },

    findSrcdocIframe() {
        const iframes = document.querySelectorAll('iframe[srcdoc]');
        return iframes.length > 0 ? iframes[0] : null;
    },

    isExtractAvailable() {
        return this.checkDetailPage() && this.findSrcdocIframe() !== null;
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
        this.button.title = '提取 iframe 内容为 HTML 文件';
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

    extractAndSave() {
        const iframe = this.findSrcdocIframe();
        if (!iframe) {
            Toast.error('未找到包含 srcdoc 的 iframe');
            return;
        }

        const srcdoc = iframe.getAttribute('srcdoc');
        if (!srcdoc) {
            Toast.error('iframe 的 srcdoc 属性为空');
            return;
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = srcdoc;
            const decodedHtml = textarea.value;

            const cleanTitle = this.getCleanTitle();
            const filename = `${cleanTitle}.html`;

            const blob = new Blob([decodedHtml], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            Toast.success(`已保存为: ${filename}`);
        } catch (error) {
            Toast.error(`提取失败: ${error.message}`);
            console.error('[Iframe 提取器] 错误:', error);
        }
    },

    checkAndUpdate() {
        this.isDetailPage = this.checkDetailPage();
        if (this.button) {
            this.removeButton();
        }
    },
};
