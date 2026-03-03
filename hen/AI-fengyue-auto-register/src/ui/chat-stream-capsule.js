import { gmAddStyle } from '../gm.js';

const CAPSULE_ID = 'aifengyue-chat-status-capsule';

function formatStatus(status) {
    const parsed = Number(status);
    if (Number.isFinite(parsed) && parsed > 0) {
        return `HTTP ${parsed}`;
    }
    return '未知状态';
}

export const ChatStreamCapsule = {
    styleInjected: false,
    element: null,
    textElement: null,
    inFlight: 0,

    injectStyle() {
        if (this.styleInjected) return;
        this.styleInjected = true;
        gmAddStyle(`
            #${CAPSULE_ID} {
                position: fixed;
                right: 20px;
                bottom: 84px;
                z-index: 2147483647;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border-radius: 999px;
                color: #ffffff;
                font-size: 12px;
                font-weight: 600;
                line-height: 1;
                pointer-events: none;
                user-select: none;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
                transition: transform 0.2s ease, opacity 0.2s ease, background 0.2s ease;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                opacity: 0.95;
            }
            #${CAPSULE_ID} .aifengyue-chat-status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: currentColor;
            }
            #${CAPSULE_ID} .aifengyue-chat-status-text {
                max-width: 360px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${CAPSULE_ID}.is-idle {
                background: rgba(75, 85, 99, 0.92);
                color: #d1d5db;
            }
            #${CAPSULE_ID}.is-sending {
                background: rgba(37, 99, 235, 0.95);
                color: #bfdbfe;
                transform: translateY(-1px);
            }
            #${CAPSULE_ID}.is-waiting {
                background: rgba(245, 158, 11, 0.95);
                color: #fef3c7;
            }
            #${CAPSULE_ID}.is-sending .aifengyue-chat-status-dot {
                animation: aifengyue-chat-capsule-pulse 1s ease-in-out infinite;
            }
            #${CAPSULE_ID}.is-waiting .aifengyue-chat-status-dot {
                animation: aifengyue-chat-capsule-pulse 1.2s ease-in-out infinite;
            }
            #${CAPSULE_ID}.is-done {
                background: rgba(5, 150, 105, 0.95);
                color: #bbf7d0;
            }
            #${CAPSULE_ID}.is-error {
                background: rgba(220, 38, 38, 0.95);
                color: #fecaca;
            }
            @keyframes aifengyue-chat-capsule-pulse {
                0% { transform: scale(1); opacity: 0.8; }
                50% { transform: scale(1.35); opacity: 1; }
                100% { transform: scale(1); opacity: 0.8; }
            }
        `);
    },

    ensureElements() {
        this.injectStyle();
        let element = document.getElementById(CAPSULE_ID);
        if (!element) {
            element = document.createElement('div');
            element.id = CAPSULE_ID;
            element.innerHTML = `
                <span class="aifengyue-chat-status-dot"></span>
                <span class="aifengyue-chat-status-text"></span>
            `;
            document.body.appendChild(element);
        }
        this.element = element;
        this.textElement = element.querySelector('.aifengyue-chat-status-text');
        if (!this.textElement) {
            this.textElement = document.createElement('span');
            this.textElement.className = 'aifengyue-chat-status-text';
            this.element.appendChild(this.textElement);
        }
        return true;
    },

    applyView(state, text) {
        if (!this.ensureElements()) return;
        this.element.classList.remove('is-idle', 'is-sending', 'is-waiting', 'is-done', 'is-error');
        this.element.classList.add(`is-${state}`);
        this.element.dataset.state = state;
        this.textElement.textContent = text;
    },

    init() {
        this.inFlight = 0;
        this.applyView('idle', 'SSE 待命');
    },

    onRequestStart() {
        this.inFlight += 1;
        const suffix = this.inFlight > 1 ? ` (${this.inFlight})` : '';
        this.applyView('sending', `SSE 发送中${suffix}`);
    },

    onRequestDone({ ok = false, status = 0, elapsedText = '-' } = {}) {
        this.inFlight = Math.max(0, this.inFlight - 1);
        if (this.inFlight > 0) {
            this.applyView('sending', `SSE 发送中 (${this.inFlight})`);
            return;
        }
        const statusText = formatStatus(status);
        const prefix = ok ? 'SSE 已完成' : 'SSE 失败';
        this.applyView(ok ? 'done' : 'error', `${prefix} · ${statusText} · ${elapsedText}`);
    },

    onSseError({ status = 0, code = '', message = '' } = {}) {
        const statusText = formatStatus(status);
        const codeText = code ? ` ${code}` : '';
        const messageText = message ? ` · ${message}` : '';
        this.applyView('error', `SSE 错误${codeText} · ${statusText}${messageText}`);
    },

    onSseEvent(eventName = '') {
        const event = String(eventName || '').trim();
        if (!event) return;
        if (event === 'ping') {
            this.applyView('waiting', 'SSE 等待中');
            return;
        }
        if (event === 'message') {
            this.applyView('sending', 'SSE 输出中');
            return;
        }
        if (event === 'message_end') {
            this.applyView('done', 'SSE 已完成');
        }
    },
};
