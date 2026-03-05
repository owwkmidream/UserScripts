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

export const FlowMethods = {
    async pollVerificationCode(email, startTime, maxAttempts = 10, intervalMs = 2000, runCtx) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: `正在轮询验证码邮件... (${attempt}/${maxAttempts})`,
            });
            logInfo(runCtx, 'POLL_CODE', `轮询验证码第 ${attempt}/${maxAttempts} 次`);

            const emails = await ApiService.getEmails(email);
            const sortedEmails = (emails || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            logDebug(runCtx, 'POLL_CODE', '邮件列表详情', {
                count: sortedEmails.length,
                emails: sortedEmails,
            });

            for (const mail of sortedEmails) {
                const mailTime = mail.timestamp || 0;

                if (startTime && mailTime < startTime - 60) {
                    continue;
                }

                const content = mail.content || mail.html_content || '';
                const subject = mail.subject || '';
                const code = extractVerificationCode(content) || extractVerificationCode(subject);
                if (code) {
                    logInfo(runCtx, 'POLL_CODE', `提取到验证码（第 ${attempt} 次轮询）`);
                    logDebug(runCtx, 'POLL_CODE', '验证码完整值', { code });
                    return code;
                }
            }

            if (attempt < maxAttempts) {
                logWarn(runCtx, 'POLL_CODE', `本轮未获取到验证码，${intervalMs}ms 后重试`);
                await delay(intervalMs);
            }
        }
        logError(runCtx, 'POLL_CODE', '轮询窗口结束，仍未获取验证码');
        return null;
    },


    async startLegacyRegisterAssist() {
        const runCtx = createRunContext('LEGACY');
        let currentStep = '初始化';
        logInfo(runCtx, 'START', '注册页模式：填表辅助 + 用户手动过验证码');
        try {
            if (!this.isRegisterPage()) {
                throw new Error('当前不在注册页，请使用一键注册（接口）');
            }

            currentStep = '生成临时邮箱';
            Sidebar.updateState({
                status: 'generating',
                statusMessage: '正在生成临时邮箱...',
            });

            this.registrationStartTime = Math.floor(Date.now() / 1000);
            gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

            const email = await ApiService.generateEmail();
            const username = generateUsername();
            const password = generatePassword();
            logInfo(runCtx, 'GENERATE', '生成注册信息完成', { email, username, password });

            Sidebar.updateState({ email, username, password, statusMessage: '正在填充表单...' });

            gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
            gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
            gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);

            this.fillForm(email, username, password);

            currentStep = '触发发送验证码';
            const sendResult = this.findAndClickSendCodeButton();
            if (sendResult.clicked) {
                sendResult.element?.click();
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '表单已填充并触发发送验证码，请完成人机验证后点击页面注册',
                    verificationCode: '',
                });
                Toast.info('已填表并尝试发送验证码，请你完成人机验证后提交注册', 5000);
                logInfo(runCtx, 'SEND_CODE', '已触发页面发送验证码按钮', { text: sendResult.text });
            } else {
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '表单已填充，请手动点击发送验证码并完成人机验证',
                    verificationCode: '',
                });
                Toast.warning('已填表，但未找到发送验证码按钮，请手动操作', 5000);
                logWarn(runCtx, 'SEND_CODE', '未找到发送验证码按钮');
            }
        } catch (error) {
            const message = `${currentStep}失败: ${error.message}`;
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message);
            logError(runCtx, 'FAIL', message, {
                errorName: error?.name,
                stack: error?.stack,
            });
        }
    },


    async registerByApi(runCtx, options = {}) {
        const flowName = options.flowName || '一键注册';
        const showStepToasts = options.showStepToasts !== false;
        const markSuccess = options.markSuccess !== false;

        let currentStep = '初始化';

        currentStep = '生成临时邮箱';
        Sidebar.updateState({
            status: 'generating',
            statusMessage: `${flowName}：正在生成临时邮箱...`,
        });
        if (showStepToasts) {
            Toast.info(`${flowName}：正在生成临时邮箱`, 2200);
        }

        this.registrationStartTime = Math.floor(Date.now() / 1000);
        gmSetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, this.registrationStartTime);

        const email = await ApiService.generateEmail();
        const username = generateUsername();
        const password = generatePassword();
        logInfo(runCtx, 'GENERATE', `${flowName} 生成注册信息完成`, { email, username, password });

        Sidebar.updateState({ email, username, password, statusMessage: `${flowName}：正在填充表单...` });

        gmSetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, email);
        gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_USERNAME, username);
        gmSetValue(CONFIG.STORAGE_KEYS.GENERATED_PASSWORD, password);

        this.fillForm(email, username, password);

        currentStep = '发送验证码';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：正在发送验证码...`,
            verificationCode: '',
        });
        await this.sendRegisterEmailCode(email, runCtx);
        if (showStepToasts) {
            Toast.info(`${flowName}：验证码已发送，正在轮询邮箱`, 2200);
        }

        currentStep = '轮询邮箱验证码';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：验证码已发送，正在自动轮询邮箱...`,
        });

        const code = await this.pollVerificationCode(email, this.registrationStartTime, 10, 2000, runCtx);
        if (!code) {
            throw new Error('未在轮询窗口内获取到验证码');
        }
        if (showStepToasts) {
            Toast.success(`${flowName}：已获取验证码`, 1800);
        }

        Sidebar.updateState({
            verificationCode: code,
            statusMessage: `${flowName}：验证码已获取: ${code}`,
        });

        const { codeInput } = this.getFormElements();
        if (codeInput) {
            this.simulateInput(codeInput, code);
            logInfo(runCtx, 'FORM', `${flowName} 验证码已自动填充到输入框`);
        } else {
            logWarn(runCtx, 'FORM', `${flowName} 未找到验证码输入框，跳过自动填充`);
        }

        currentStep = '获取注册令牌';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：正在获取注册令牌...`,
        });
        const regToken = await this.getRegToken(runCtx);

        currentStep = '提交注册';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：正在提交注册...`,
        });
        const token = await this.registerWithCode({
            username,
            email,
            password,
            code,
            regToken,
        }, runCtx);

        localStorage.setItem('console_token', token);
        logInfo(runCtx, 'AUTH', `${flowName} 已写入 localStorage.console_token`);
        logDebug(runCtx, 'AUTH', `${flowName} localStorage 写入 token 完整值`, { token });
        if (showStepToasts) {
            Toast.success(`${flowName}：注册成功，已写入 console_token`, 2400);
        }

        currentStep = '跳过首次引导';
        Sidebar.updateState({
            status: 'fetching',
            statusMessage: `${flowName}：注册成功，正在跳过首次引导...`,
        });
        if (showStepToasts) {
            Toast.info(`${flowName}：正在跳过首次引导（快速模式）`, 2600);
        }

        let guideSkipped = true;
        try {
            await this.skipFirstGuide(token, runCtx);
            if (showStepToasts) {
                Toast.success(`${flowName}：首次引导已跳过`, 1800);
            }
        } catch (guideError) {
            guideSkipped = false;
            logError(runCtx, 'SKIP_GUIDE', `${flowName} 首次引导跳过失败`, {
                errorName: guideError?.name,
                message: guideError?.message,
                stack: guideError?.stack,
            });
            Toast.warning(`${flowName}：注册成功，但跳过首次引导失败: ${guideError.message}`, 6000);
        }

        if (markSuccess) {
            Sidebar.updateState({
                status: 'success',
                statusMessage: guideSkipped
                    ? `${flowName}成功，已写入 console_token 并跳过首次引导`
                    : `${flowName}成功，已写入 console_token（首次引导跳过失败）`,
            });
            Toast.success(guideSkipped
                ? `${flowName}完成：已自动跳过首次引导并写入登录态`
                : `${flowName}完成：已写入登录态；首次引导跳过失败`, 5000);
        } else {
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: `${flowName}已完成注册，准备执行后续操作...`,
            });
        }

        return {
            token,
            guideSkipped,
            email,
            username,
            password,
            code,
        };
    },


    async startOneClickRegister() {
        const runCtx = createRunContext('REG');
        logInfo(runCtx, 'START', '开始一键注册流程', {
            href: window.location.href,
            debugEnabled: isDebugEnabled(),
        });
        try {
            const appId = this.extractInstalledAppId();
            const oldToken = (localStorage.getItem('console_token') || '').trim();
            let oldUserModelConfig = null;
            let modelConfigSynced = false;

            if (appId && oldToken) {
                Sidebar.updateState({
                    status: 'fetching',
                    statusMessage: '一键注册：正在读取旧账号模型配置...',
                });
                Toast.info('一键注册：正在读取旧账号模型配置', 2200);

                await this.syncAppMetaToLocalHistory({
                    appId,
                    token: oldToken,
                    runCtx,
                    step: 'REG_SYNC_APP_META_OLD',
                });
                oldUserModelConfig = await this.fetchUserAppModelConfig({
                    appId,
                    token: oldToken,
                    runCtx,
                });
                logInfo(runCtx, 'REG_SYNC_MODEL_CONFIG_OLD', '一键注册已读取旧账号模型配置', {
                    appId,
                });
            } else if (appId && !oldToken) {
                logWarn(runCtx, 'REG_SYNC_MODEL_CONFIG_OLD', '检测到应用详情页，但未找到旧账号 token，跳过旧配置读取');
            } else {
                logInfo(runCtx, 'REG_SYNC_MODEL_CONFIG_OLD', '当前不是应用详情页，跳过旧配置读取');
            }

            const registerResult = await this.registerByApi(runCtx, {
                flowName: '一键注册',
                showStepToasts: true,
                markSuccess: false,
            });

            if (appId && oldUserModelConfig) {
                Sidebar.updateState({
                    status: 'fetching',
                    statusMessage: '一键注册：正在同步模型配置到新账号...',
                });
                Toast.info('一键注册：正在同步旧模型配置到新账号', 2200);

                await this.syncAppMetaToLocalHistory({
                    appId,
                    token: registerResult.token,
                    runCtx,
                    step: 'REG_SYNC_APP_META_NEW',
                });
                await this.saveUserAppModelConfig({
                    appId,
                    token: registerResult.token,
                    config: oldUserModelConfig,
                    runCtx,
                });
                modelConfigSynced = true;
            }

            const autoReloadEnabled = this.isAutoReloadEnabled();
            Sidebar.updateState({
                status: 'success',
                statusMessage: registerResult.guideSkipped
                    ? `一键注册成功，已写入 console_token${modelConfigSynced ? '，并同步模型配置' : ''}${autoReloadEnabled ? '，0.8 秒后刷新' : '，自动刷新已关闭'}`
                    : `一键注册成功，已写入 console_token（首次引导跳过失败）${modelConfigSynced ? '，模型配置已同步' : ''}${autoReloadEnabled ? '，0.8 秒后刷新' : '，自动刷新已关闭'}`,
            });
            Toast.success(registerResult.guideSkipped
                ? `一键注册完成${modelConfigSynced ? '（已同步模型配置）' : ''}${autoReloadEnabled ? '，即将刷新' : '，自动刷新已关闭'}`
                : `一键注册完成：首次引导跳过失败${modelConfigSynced ? '，模型配置已同步' : ''}${autoReloadEnabled ? '，即将刷新' : '，自动刷新已关闭'}`, 5000);
            logInfo(runCtx, 'DONE', '一键注册流程完成', {
                autoReloadEnabled,
            });
            this.reloadPageIfEnabled({
                delayMs: 800,
                runCtx,
                step: 'DONE',
                reason: 'one-click-register-success',
            });
        } catch (error) {
            const message = `一键注册失败: ${error.message}`;
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message);
            logError(runCtx, 'FAIL', message, {
                errorName: error?.name,
                stack: error?.stack,
            });
        }
    },


    async switchAccount(extraText) {
        const runCtx = createRunContext('SWITCH');
        const appendText = typeof extraText === 'string' ? extraText.trim() : '';
        const switchBtn = document.getElementById('aifengyue-switch-account');

        if (this.switchingAccount) {
            Toast.warning('更换账号正在执行，请稍候');
            logWarn(runCtx, 'PRECHECK', '重复触发更换账号，已拦截');
            return;
        }

        if (!appendText) {
            const message = '请输入更换账号附加文本后再执行';
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message);
            logError(runCtx, 'PRECHECK', message);
            return;
        }

        this.switchingAccount = true;
        if (switchBtn) {
            switchBtn.disabled = true;
        }

        logInfo(runCtx, 'START', '开始更换账号流程', {
            href: window.location.href,
            appendTextLength: appendText.length,
            debugEnabled: isDebugEnabled(),
        });

        try {
            const appId = this.extractInstalledAppId();
            if (!appId) {
                throw new Error('当前页面不是 installed/test-installed 详情页，无法提取应用 ID');
            }

            const oldToken = (localStorage.getItem('console_token') || '').trim();
            if (!oldToken) {
                throw new Error('未找到旧账号 console_token，请先登录旧账号后再更换');
            }
            const oldTokenSignature = buildTokenSignature(oldToken);

            const conversationId = this.readConversationIdByAppId(appId);
            let activeChainId = '';

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：正在读取旧账号模型配置...',
            });
            Toast.info('更换账号：正在读取旧账号模型配置', 2200);

            await this.syncAppMetaToLocalHistory({
                appId,
                token: oldToken,
                runCtx,
                step: 'SWITCH_SYNC_APP_META_OLD',
            });

            const userModelConfig = await this.fetchUserAppModelConfig({
                appId,
                token: oldToken,
                runCtx,
            });

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：正在读取旧会话消息并本地归档...',
            });
            Toast.info('更换账号：正在拉取旧会话消息', 2400);

            const oldConversation = await this.fetchConversationMessages({
                appId,
                conversationId,
                token: oldToken,
                runCtx,
                step: 'SWITCH_FETCH_MESSAGES',
                limit: 100,
                type: 'recent',
            });
            if (!oldConversation.messages.length) {
                throw new Error('旧会话消息为空，无法继续更换账号');
            }

            const latest = this.extractLatestAnswerFromMessages(
                oldConversation.messages,
                runCtx,
                'SWITCH_FETCH_MESSAGES'
            );
            const decodedAnswer = decodeEscapedText(latest.answer);
            if (!decodedAnswer.trim()) {
                throw new Error('最新消息 answer 解码后为空');
            }

            const chainBinding = await ChatHistoryService.bindConversation({
                appId,
                conversationId,
                tokenSignature: oldTokenSignature,
            });
            activeChainId = chainBinding.chainId;
            const storeResult = await ChatHistoryService.saveConversationMessages({
                appId,
                conversationId,
                chainId: activeChainId,
                tokenSignature: oldTokenSignature,
                messages: oldConversation.messages,
            });
            ChatHistoryService.markChainSynced(activeChainId, Date.now());

            logInfo(runCtx, 'SWITCH_FETCH_MESSAGES', '已提取旧会话最新消息', {
                appId,
                conversationId,
                createdAt: latest.createdAt,
                answerLength: decodedAnswer.length,
                messageCount: oldConversation.messages.length,
                savedCount: storeResult.savedCount,
                chainId: activeChainId,
            });

            if (oldConversation.hasPastRecord || oldConversation.isEarliestDataPage === false) {
                Toast.warning('旧会话可能仍有更早消息未拉取，可在“会话”Tab手动同步', 4500);
            }

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：已提取旧回答，正在注册新账号...',
            });
            Toast.info('更换账号：开始注册新账号', 2200);

            const registerResult = await this.registerByApi(runCtx, {
                flowName: '更换账号',
                showStepToasts: true,
                markSuccess: false,
            });
            if (!registerResult.guideSkipped) {
                throw new Error('更换账号终止：首次引导未跳过成功，不发送 chat-messages');
            }

            await this.syncAppMetaToLocalHistory({
                appId,
                token: registerResult.token,
                runCtx,
                step: 'SWITCH_SYNC_APP_META_NEW',
            });

            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：正在写入 world_book 并同步模型配置...',
            });
            Toast.info('更换账号：正在写入 world_book 并同步模型配置', 2200);
            const appendTriggerWord = normalizeSwitchTriggerWord(appendText);
            const switchConfig = this.prepareWorldBookConfigForSwitch({
                baseConfig: userModelConfig,
                answer: decodedAnswer,
                runCtx,
                explicitTriggerWord: appendTriggerWord,
            });
            await this.saveUserAppModelConfig({
                appId,
                token: registerResult.token,
                config: switchConfig.config,
                runCtx,
                ensureWorldBookNotEmpty: true,
                maxWorldBookPostAttempts: 3,
                unicodeEscapeBody: true,
            });

            const query = this.buildSwitchQuery({
                triggerWord: switchConfig.triggerWord,
                appendText,
            });
            const conversationName = `新的对话-${randomConversationSuffix(3)}`;
            logInfo(runCtx, 'SWITCH_CHAT', 'chat-messages query 已按触发词+换行格式构建', {
                triggerWord: switchConfig.triggerWord,
                appendTextLength: appendText.length,
                queryLength: query.length,
            });
            Sidebar.updateState({
                status: 'fetching',
                statusMessage: '更换账号：新账号已就绪，正在发送 chat-messages...',
            });
            Toast.info('更换账号：正在发送 chat-messages', 2200);

            const chatResult = await this.sendChatMessagesAndReload({
                appId,
                token: registerResult.token,
                query,
                conversationName,
                runCtx,
            });
            const newTokenSignature = buildTokenSignature(registerResult.token);

            const newConversationId = typeof chatResult?.conversationId === 'string'
                ? chatResult.conversationId.trim()
                : '';
            if (newConversationId) {
                this.upsertConversationIdInfo(appId, newConversationId, runCtx);
                ChatHistoryService.setConversationTokenSignature(appId, newConversationId, newTokenSignature);
                ChatHistoryService.bindConversation({
                    appId,
                    conversationId: newConversationId,
                    previousConversationId: conversationId,
                    preferredChainId: activeChainId,
                    tokenSignature: newTokenSignature,
                }).then((newBinding) => {
                    activeChainId = newBinding.chainId;
                    ChatHistoryService.setActiveChainId(appId, activeChainId);
                }).catch((bindError) => {
                    logWarn(runCtx, 'SWITCH_CHAT', '刷新前写入会话链失败（不影响立即刷新）', {
                        message: bindError?.message || String(bindError),
                    });
                });
            }

            const sourceText = chatResult?.source ? `，来源 ${chatResult.source}` : '';
            const statusText = Number.isFinite(Number(chatResult?.status))
                ? `HTTP ${Number(chatResult.status)}`
                : '未知状态';
            const autoReloadEnabled = this.isAutoReloadEnabled();
            Sidebar.updateState({
                status: 'success',
                statusMessage: newConversationId
                    ? `更换账号成功：已获取 conversation_id（${statusText}${sourceText}）${autoReloadEnabled ? '，0.8 秒后刷新' : '，自动刷新已关闭'}`
                    : `更换账号已发送 chat-messages（${statusText}），未拿到 conversation_id${autoReloadEnabled ? '，0.8 秒后刷新' : '，自动刷新已关闭'}`,
            });
            if (newConversationId) {
                Toast.success(
                    `已获取新会话ID（${chatResult.source || 'sse'}）${autoReloadEnabled ? '，即将刷新' : '，自动刷新已关闭'}`,
                    2600
                );
            } else {
                Toast.warning(
                    autoReloadEnabled
                        ? '未获取到新会话ID，仍将刷新，可在“会话”Tab手动同步'
                        : '未获取到新会话ID，自动刷新已关闭，可在“会话”Tab手动同步',
                    3600
                );
            }

            this.reloadPageIfEnabled({
                delayMs: 120,
                runCtx,
                step: 'SWITCH_DONE',
                reason: 'switch-account-success',
            });
        } catch (error) {
            const message = `更换账号失败: ${error.message}`;
            Sidebar.updateState({ status: 'error', statusMessage: message });
            Toast.error(message, 6000);
            logError(runCtx, 'FAIL', message, {
                errorName: error?.name,
                stack: error?.stack,
            });
        } finally {
            this.switchingAccount = false;
            if (switchBtn) {
                switchBtn.disabled = false;
            }
        }
    },


    async start() {
        if (this.isRegisterPage()) {
            await this.startLegacyRegisterAssist();
        } else {
            await this.startOneClickRegister();
        }
    },


    async generateNewEmail() {
        const runCtx = createRunContext('MAIL');
        logInfo(runCtx, 'START', '开始生成新邮箱');
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
            logInfo(runCtx, 'DONE', '新邮箱生成成功', { email });
        } catch (error) {
            Sidebar.updateState({ status: 'error', statusMessage: `错误: ${error.message}` });
            Toast.error(`生成失败: ${error.message}`);
            logError(runCtx, 'FAIL', '新邮箱生成失败', {
                errorName: error?.name,
                message: error?.message,
                stack: error?.stack,
            });
        }
    },


    async fetchVerificationCode() {
        const runCtx = createRunContext('CODE');
        const email = gmGetValue(CONFIG.STORAGE_KEYS.CURRENT_EMAIL, '');
        if (!email) {
            Toast.error('请先生成临时邮箱');
            logWarn(runCtx, 'PRECHECK', '未找到当前邮箱，无法获取验证码');
            return;
        }

        const startTime = gmGetValue(CONFIG.STORAGE_KEYS.REGISTRATION_START_TIME, 0);

        try {
            Sidebar.updateState({ status: 'fetching', statusMessage: '正在获取验证码邮件...' });
            Toast.info('正在获取邮件...');
            logInfo(runCtx, 'START', '手动获取验证码开始', { email, startTime });

            const code = await this.pollVerificationCode(email, startTime, 1, 0, runCtx);
            if (!code) {
                Sidebar.updateState({
                    status: 'waiting',
                    statusMessage: '未找到验证码，请稍后重试',
                });
                Toast.warning('未找到验证码，请稍后再试');
                logWarn(runCtx, 'DONE', '手动获取验证码未命中');
                return;
            }

            Sidebar.updateState({
                status: 'success',
                statusMessage: `验证码: ${code}`,
                verificationCode: code,
            });

            const { codeInput } = this.getFormElements();
            if (codeInput) {
                this.simulateInput(codeInput, code);
                Toast.success(`验证码 ${code} 已填充！`, 5000);
                logInfo(runCtx, 'DONE', '验证码已填充');
            } else {
                Toast.success(`验证码: ${code}，请手动输入`, 5000);
                logWarn(runCtx, 'DONE', '找到验证码但未找到输入框');
            }
        } catch (error) {
            Sidebar.updateState({ status: 'error', statusMessage: `获取失败: ${error.message}` });
            Toast.error(`获取验证码失败: ${error.message}`);
            logError(runCtx, 'FAIL', '手动获取验证码失败', {
                errorName: error?.name,
                message: error?.message,
                stack: error?.stack,
            });
        }
    },
};
