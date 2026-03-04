import { CONFIG } from '../../constants.js';
import { gmGetValue, gmRequestJson, gmSetValue } from '../../gm.js';
import { ApiService } from '../../services/api-service.js';
import { ChatHistoryService } from '../../services/chat-history-service.js';
import { Sidebar } from '../../ui/sidebar.js';
import { Toast } from '../../ui/toast.js';
import { generateUsername, generatePassword, delay } from '../../utils/random.js';
import { extractVerificationCode } from '../../utils/code-extractor.js';
import { simulateInput } from '../../utils/dom.js';
import {
    createRunContext,
    isDebugEnabled,
    logDebug,
    logError,
    logInfo,
    logWarn,
} from '../../utils/logger.js';
import {
    X_LANGUAGE,
    SITE_ENDPOINTS,
    DEFAULT_OBJECTIVE_RETRY_ATTEMPTS,
    DEFAULT_SWITCH_WORLD_BOOK_TRIGGER,
    readErrorMessage,
    normalizeTimestamp,
    decodeEscapedText,
    isAnswerEmpty,
    normalizeSwitchTriggerWord,
    cloneJsonSafe,
    stringifyJsonWithUnicodeEscapes,
    randomConversationSuffix,
    buildTokenSignature,
    withHttpStatusError,
} from './shared.js';

export const FormMethods = {
    isRegisterPage() {
        return !!document.querySelector('input#name') &&
            !!document.querySelector('input#email') &&
            !!document.querySelector('input#password');
    },


    getFormElements() {
        return {
            usernameInput: document.querySelector('input#name'),
            emailInput: document.querySelector('input#email'),
            passwordInput: document.querySelector('input#password'),
            codeInput: document.querySelector('input[placeholder*="验证码"]') ||
                document.querySelector('input[name="code"]') ||
                document.querySelector('input[id="code"]'),
        };
    },


    simulateInput(element, value) {
        simulateInput(element, value);
    },


    findAndClickSendCodeButton() {
        const buttons = document.querySelectorAll('button, a, span[role="button"]');
        for (const btn of buttons) {
            const text = (btn.textContent || btn.innerText || '').trim();
            const ariaLabel = btn.getAttribute('aria-label') || '';

            if (text.includes('发送') || text.includes('获取') || text.includes('验证码') ||
                text.includes('Send') || text.includes('Code') || text.includes('Get') ||
                ariaLabel.includes('验证码') || ariaLabel.toLowerCase().includes('code')) {
                if (!btn.disabled && !btn.classList.contains('disabled')) {
                    return { clicked: true, text, element: btn };
                }
            }
        }
        return { clicked: false, text: '', element: null };
    },


    fillForm(email, username, password) {
        const { usernameInput, emailInput, passwordInput } = this.getFormElements();
        if (usernameInput) this.simulateInput(usernameInput, username);
        if (emailInput) this.simulateInput(emailInput, email);
        if (passwordInput) this.simulateInput(passwordInput, password);
    },

};
