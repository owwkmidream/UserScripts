import { CONFIG } from '../constants.js';
import { gmGetValue, gmSetValue } from '../gm.js';
import { ApiService } from '../services/api-service.js';
import { Sidebar } from '../ui/sidebar.js';
import { Toast } from '../ui/toast.js';
import { generateUsername, generatePassword, delay } from '../utils/random.js';
import { extractVerificationCode } from '../utils/code-extractor.js';
import { simulateInput } from '../utils/dom.js';

export const AutoRegister = {
    registrationStartTime: null,

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
                ariaLabel.includes('验证码') || ariaLabel.includes('code')) {
                if (!btn.disabled && !btn.classList.contains('disabled')) {
                    console.log('[自动注册] 找到发送验证码按钮:', text);
                    btn.click();
                    return true;
                }
            }
        }
        console.log('[自动注册] 未找到发送验证码按钮');
        return false;
    },

    async start() {
        if (!this.isRegisterPage()) {
            Toast.error('请在注册页面使用此功能');
            return;
        }

        try {
            Sidebar.updateState({
                status: 'generating',
                statusMessage: '正在生成临时邮箱...',
            });

            this.registrationStartTime = Math.floor(Date.now() / 1000);
            gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

            const email = await ApiService.generateEmail();
            const username = generateUsername();
            const password = generatePassword();

            Sidebar.updateState({ email, username, password, statusMessage: '正在填充表单...' });

            gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
            gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
            gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);

            this.fillForm(email, username, password);

            await delay(500);

            Sidebar.updateState({
                status: 'waiting',
                statusMessage: '表单已填充，正在尝试点击发送验证码按钮...',
                verificationCode: '',
            });

            const clicked = this.findAndClickSendCodeButton();

            if (clicked) {
                Toast.success('已自动点击发送验证码！请完成人机验证，2秒后自动获取验证码...', 3000);

                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '已点击发送验证码，等待 2 秒后自动获取...',
                });

                await delay(2000);

                Sidebar.updateState({
                    statusMessage: '正在自动获取验证码...',
                });

                await this.fetchVerificationCode();
            } else {
                Toast.warning('未找到发送验证码按钮，请手动点击后再点击"获取验证码"', 5000);

                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '表单已填充。请手动点击页面上的"发送验证码"，然后点击侧边栏的"获取验证码"',
                });
            }
        } catch (error) {
            Sidebar.updateState({ status: 'error', statusMessage: `错误: ${error.message}` });
            Toast.error(`生成失败: ${error.message}`);
        }
    },

    async generateNewEmail() {
        try {
            Sidebar.updateState({ status: 'generating', statusMessage: '正在生成新邮箱...' });

            this.registrationStartTime = Math.floor(Date.now() / 1000);
            gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

            const email = await ApiService.generateEmail();

            Sidebar.updateState({
                email,
                status: 'waiting',
                statusMessage: '新邮箱已生成',
                verificationCode: '',
            });

            gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);

            const { emailInput } = this.getFormElements();
            if (emailInput) this.simulateInput(emailInput, email);

            Toast.success('新邮箱已生成并填充');
        } catch (error) {
            Sidebar.updateState({ status: 'error', statusMessage: `错误: ${error.message}` });
            Toast.error(`生成失败: ${error.message}`);
        }
    },

    fillForm(email, username, password) {
        const { usernameInput, emailInput, passwordInput } = this.getFormElements();
        if (usernameInput) this.simulateInput(usernameInput, username);
        if (emailInput) this.simulateInput(emailInput, email);
        if (passwordInput) this.simulateInput(passwordInput, password);
    },

    async fetchVerificationCode() {
        const email = gmGetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, '');
        if (!email) {
            Toast.error('请先生成临时邮箱');
            return;
        }

        const startTime = gmGetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, 0);

        try {
            Sidebar.updateState({ status: 'fetching', statusMessage: '正在获取验证码邮件...' });
            Toast.info('正在获取邮件...');

            const emails = await ApiService.getEmails(email);

            if (!emails || emails.length === 0) {
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '未收到邮件，请确认已点击"发送验证码"，稍后再试',
                });
                Toast.warning('未收到邮件，请稍后再试');
                return;
            }

            const sortedEmails = emails.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            for (const mail of sortedEmails) {
                const mailTime = mail.timestamp || 0;

                if (startTime && mailTime < startTime - 60) {
                    console.log(`[验证码] 跳过旧邮件 ${mailTime} < ${startTime}`);
                    continue;
                }

                const content = mail.content || mail.html_content || '';
                const subject = mail.subject || '';
                const code = extractVerificationCode(content) || extractVerificationCode(subject);

                if (code) {
                    Sidebar.updateState({
                        status: 'success',
                        statusMessage: `验证码: ${code}`,
                        verificationCode: code,
                    });

                    const { codeInput } = this.getFormElements();
                    if (codeInput) {
                        this.simulateInput(codeInput, code);
                        Toast.success(`验证码 ${code} 已填充！可以注册了`, 5000);
                    } else {
                        Toast.success(`验证码: ${code}，请手动输入`, 5000);
                    }
                    return;
                }
            }

            Sidebar.updateState({ status: 'waiting', statusMessage: '未找到验证码，请稍后重试' });
            Toast.warning('未找到验证码，请稍后再试');
        } catch (error) {
            Sidebar.updateState({ status: 'error', statusMessage: `获取失败: ${error.message}` });
            Toast.error(`获取验证码失败: ${error.message}`);
        }
    },
};
