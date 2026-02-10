// ==UserScript==
// @name         Linux.do 兑换码快速领取
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  框选文本自动识别兑换码并快速领取
// @author       You
// @match        https://linux.do/t/topic/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      cdk.hybgzs.com
// ==/UserScript==

(function () {
    'use strict';

    const LOG_PREFIX = '[兑换码助手]';

    // 日志函数
    const log = {
        info: (...args) => console.log(LOG_PREFIX, ...args),
        warn: (...args) => console.warn(LOG_PREFIX, ...args),
        error: (...args) => console.error(LOG_PREFIX, ...args),
        debug: (...args) => console.debug(LOG_PREFIX, ...args),
    };

    // 已使用的兑换码记录（内存中，避免重复尝试已领取的码）
    const usedCodes = new Set();

    // 注入样式
    GM_addStyle(`
        /* 初始确认弹窗 - 轻量级，无背景遮罩 */
        .gift-confirm-popup {
            position: fixed;
            z-index: 99999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 12px;
            padding: 16px 20px;
            min-width: 280px;
            max-width: 400px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
            color: #fff;
            animation: fadeInPop 0.15s ease-out;
        }

        @keyframes fadeInPop {
            from {
                opacity: 0;
                transform: translateY(-8px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .gift-confirm-popup h4 {
            margin: 0 0 12px 0;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
            color: #aaa;
        }

        .gift-confirm-popup h4::before {
            content: '🎁';
        }

        .gift-confirm-popup .code-preview {
            background: rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 12px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            color: #4CAF50;
            border-left: 3px solid #4CAF50;
        }

        .gift-confirm-popup .btn-group {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }

        .gift-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s ease;
        }

        .gift-btn-primary {
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
            color: white;
        }

        .gift-btn-primary:hover {
            filter: brightness(1.1);
        }

        .gift-btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: #aaa;
        }

        .gift-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.15);
        }

        /* 兑换操作窗口 - 可拖动，不会自动关闭 */
        .gift-redeem-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 14px;
            padding: 0;
            min-width: 380px;
            max-width: 90vw;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
            color: #fff;
            z-index: 100000;
            animation: fadeInScale 0.2s ease-out;
        }

        @keyframes fadeInScale {
            from {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.95);
            }
            to {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }
        }

        .gift-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 14px 14px 0 0;
            cursor: move;
            user-select: none;
        }

        .gift-modal-header h3 {
            margin: 0;
            font-size: 15px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .gift-modal-header h3::before {
            content: '🎁';
        }

        .gift-modal-close {
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: #888;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            transition: all 0.15s;
        }

        .gift-modal-close:hover {
            background: rgba(244, 67, 54, 0.3);
            color: #f44336;
        }

        .gift-modal-body {
            padding: 16px 18px;
        }

        .gift-code-list {
            max-height: 350px;
            overflow-y: auto;
        }

        .gift-code-card {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 10px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            transition: all 0.2s;
        }

        .gift-code-card:last-child {
            margin-bottom: 0;
        }

        .gift-code-card.active {
            border-color: rgba(33, 150, 243, 0.5);
            background: rgba(33, 150, 243, 0.1);
        }

        .gift-code-card.success {
            border-color: rgba(76, 175, 80, 0.5);
            background: rgba(76, 175, 80, 0.15);
        }

        .gift-code-card.error {
            border-color: rgba(244, 67, 54, 0.5);
            background: rgba(244, 67, 54, 0.1);
        }

        .gift-code-card.rate-limited {
            border-color: rgba(255, 152, 0, 0.5);
            background: rgba(255, 152, 0, 0.1);
        }

        .gift-code-value {
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
            letter-spacing: 0.5px;
        }

        .gift-code-status {
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
            color: #888;
        }

        .gift-code-status.processing {
            color: #2196F3;
        }

        .gift-code-status.success {
            color: #4CAF50;
        }

        .gift-code-status.error {
            color: #f44336;
        }

        .gift-code-status.rate-limited {
            color: #ff9800;
        }

        .gift-redeem-btn {
            padding: 6px 14px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
            color: white;
            transition: all 0.15s;
            margin-top: 8px;
        }

        .gift-redeem-btn:hover:not(:disabled) {
            filter: brightness(1.1);
        }

        .gift-redeem-btn:disabled {
            background: #444;
            cursor: not-allowed;
            opacity: 0.6;
        }

        /* 限流进度条 */
        .gift-rate-limit-bar {
            margin-top: 10px;
        }

        .gift-rate-limit-bar .bar-label {
            font-size: 11px;
            color: #ff9800;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .gift-rate-limit-bar .bar-label::before {
            content: '⏳';
        }

        .gift-rate-limit-bar .bar-track {
            height: 4px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 2px;
            overflow: hidden;
        }

        .gift-rate-limit-bar .bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #ff9800, #ffc107);
            border-radius: 2px;
            transition: width 0.3s linear;
        }

        .gift-spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid rgba(33, 150, 243, 0.3);
            border-top-color: #2196F3;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }

        .gift-toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 16px;
            border-radius: 6px;
            color: white;
            font-size: 13px;
            z-index: 100001;
            animation: slideIn 0.25s ease-out;
            max-width: 300px;
        }

        .gift-toast.success {
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        }

        .gift-toast.error {
            background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
        }

        .gift-toast.warning {
            background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateX(50px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
    `);

    // 兑换码正则：匹配 GIFT-XXXX-XXXX-XXXX 或 XXXX-XXXX-XXXX
    const FULL_CODE_REGEX = /GIFT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/gi;
    const SHORT_CODE_REGEX = /(?<![A-Z0-9-])[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}(?![A-Z0-9-])/gi;

    // 提取兑换码
    function extractCodes(text) {
        log.debug('提取兑换码，原始文本:', text);

        const codes = new Set();

        // 先移除已匹配完整格式的部分，避免短格式重复匹配
        let processedText = text;

        // 匹配完整格式
        const fullMatches = text.match(FULL_CODE_REGEX) || [];
        log.debug('完整格式匹配:', fullMatches);
        fullMatches.forEach(code => {
            codes.add(code.toUpperCase());
            // 从处理文本中移除已匹配的完整码
            processedText = processedText.replace(code, '');
        });

        // 在剩余文本中匹配短格式
        const shortMatches = processedText.match(SHORT_CODE_REGEX) || [];
        log.debug('短格式匹配:', shortMatches);
        shortMatches.forEach(code => {
            const fullCode = 'GIFT-' + code.toUpperCase();
            codes.add(fullCode);
        });

        // 过滤掉已使用的兑换码
        const result = Array.from(codes).filter(code => {
            if (usedCodes.has(code)) {
                log.debug('跳过已使用的兑换码:', code);
                return false;
            }
            return true;
        });

        log.info('提取到兑换码:', result);
        if (usedCodes.size > 0) {
            log.debug('已使用的兑换码列表:', Array.from(usedCodes));
        }
        return result;
    }

    // 显示 Toast 提示
    function showToast(message, type = 'success') {
        log.info(`Toast [${type}]:`, message);

        const toast = document.createElement('div');
        toast.className = `gift-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(50px)';
            toast.style.transition = 'all 0.25s';
            setTimeout(() => toast.remove(), 250);
        }, 3000);
    }

    // 当前弹出的确认框
    let currentConfirmPopup = null;

    // 关闭确认弹窗
    function closeConfirmPopup() {
        if (currentConfirmPopup) {
            currentConfirmPopup.remove();
            currentConfirmPopup = null;
        }
    }

    // 创建初始确认弹窗（轻量级，无遮罩）
    function showConfirmPopup(codes, x, y) {
        return new Promise((resolve) => {
            // 先关闭之前的弹窗
            closeConfirmPopup();

            const popup = document.createElement('div');
            popup.className = 'gift-confirm-popup';
            currentConfirmPopup = popup;

            const codeList = codes.length <= 3
                ? codes.join('\n')
                : codes.slice(0, 3).join('\n') + `\n... 共 ${codes.length} 个`;

            popup.innerHTML = `
                <h4>检测到 ${codes.length} 个兑换码</h4>
                <div class="code-preview">${codeList}</div>
                <div class="btn-group">
                    <button class="gift-btn gift-btn-secondary" data-action="cancel">取消</button>
                    <button class="gift-btn gift-btn-primary" data-action="confirm">开始兑换</button>
                </div>
            `;

            document.body.appendChild(popup);

            // 定位弹窗
            const rect = popup.getBoundingClientRect();
            let left = x;
            let top = y + 10;

            // 防止超出屏幕
            if (left + rect.width > window.innerWidth - 10) {
                left = window.innerWidth - rect.width - 10;
            }
            if (top + rect.height > window.innerHeight - 10) {
                top = y - rect.height - 10;
            }

            popup.style.left = Math.max(10, left) + 'px';
            popup.style.top = Math.max(10, top) + 'px';

            // 按钮事件
            popup.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                if (action === 'cancel') {
                    closeConfirmPopup();
                    resolve(false);
                } else if (action === 'confirm') {
                    closeConfirmPopup();
                    resolve(true);
                }
            });

            // 点击外部关闭
            const handleOutsideClick = (e) => {
                if (!popup.contains(e.target)) {
                    closeConfirmPopup();
                    document.removeEventListener('mousedown', handleOutsideClick);
                    resolve(false);
                }
            };

            // 延迟绑定，避免立即触发
            setTimeout(() => {
                document.addEventListener('mousedown', handleOutsideClick);
            }, 100);
        });
    }

    // 创建兑换操作窗口
    function showRedeemModal(codes) {
        log.info('打开兑换窗口，兑换码列表:', codes);

        const modal = document.createElement('div');
        modal.className = 'gift-redeem-modal';

        modal.innerHTML = `
            <div class="gift-modal-header">
                <h3>兑换码领取 (${codes.length})</h3>
                <button class="gift-modal-close">✕</button>
            </div>
            <div class="gift-modal-body">
                <div class="gift-code-list">
                    ${codes.map((code, index) => `
                        <div class="gift-code-card" data-index="${index}" data-code="${code}">
                            <div class="gift-code-value">${code}</div>
                            <div class="gift-code-status">点击下方按钮领取</div>
                            <button class="gift-redeem-btn">领取</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 关闭按钮
        modal.querySelector('.gift-modal-close').addEventListener('click', () => {
            log.info('用户关闭兑换窗口');
            modal.remove();
        });

        // 拖动功能
        makeDraggable(modal);

        // 兑换按钮事件
        const cards = modal.querySelectorAll('.gift-code-card');
        cards.forEach(card => {
            const btn = card.querySelector('.gift-redeem-btn');
            btn.addEventListener('click', () => handleRedeem(card, modal));
        });
    }

    // 使元素可拖动
    function makeDraggable(element) {
        const header = element.querySelector('.gift-modal-header');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('gift-modal-close')) return;

            isDragging = true;
            const rect = element.getBoundingClientRect();

            // 移除 transform，使用绝对定位
            element.style.transform = 'none';
            element.style.left = rect.left + 'px';
            element.style.top = rect.top + 'px';

            startX = e.clientX;
            startY = e.clientY;
            initialLeft = rect.left;
            initialTop = rect.top;

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            element.style.left = (initialLeft + deltaX) + 'px';
            element.style.top = (initialTop + deltaY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // 发送兑换请求（使用 GM_xmlhttpRequest 解决跨域）
    function sendRedeemRequest(code) {
        log.info('发送兑换请求:', code);

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://cdk.hybgzs.com/api/cards/giftcode/claim',
                headers: {
                    'Accept': '*/*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,ru;q=0.8,en;q=0.7,ee;q=0.6',
                    'Cache-Control': 'no-cache',
                    'Content-Type': 'application/json',
                },
                data: JSON.stringify({ code }),
                onload: (response) => {
                    log.debug('请求响应:', {
                        status: response.status,
                        statusText: response.statusText,
                        responseText: response.responseText
                    });

                    let data = null;
                    try {
                        data = JSON.parse(response.responseText);
                    } catch (e) {
                        log.warn('响应解析失败:', e);
                    }

                    resolve({
                        status: response.status,
                        data: data,
                        raw: response.responseText
                    });
                },
                onerror: (error) => {
                    log.error('请求失败:', error);
                    reject(new Error('网络请求失败'));
                },
                ontimeout: () => {
                    log.error('请求超时');
                    reject(new Error('请求超时'));
                }
            });
        });
    }

    // 处理兑换请求
    async function handleRedeem(card, modal) {
        const code = card.dataset.code;
        const statusEl = card.querySelector('.gift-code-status');
        const btn = card.querySelector('.gift-redeem-btn');

        log.info('开始兑换:', code);

        // 禁用所有按钮
        const allBtns = modal.querySelectorAll('.gift-redeem-btn');
        allBtns.forEach(b => b.disabled = true);

        // 清除可能存在的限流定时器
        if (card._rateLimitTimer) {
            clearInterval(card._rateLimitTimer);
            card._rateLimitTimer = null;
        }
        // 移除可能存在的进度条
        const existingProgressBar = card.querySelector('.gift-rate-limit-bar');
        if (existingProgressBar) {
            existingProgressBar.remove();
        }

        // 更新状态为处理中
        card.classList.remove('success', 'error', 'rate-limited');
        card.classList.add('active');
        statusEl.className = 'gift-code-status processing';
        statusEl.innerHTML = '<span class="gift-spinner"></span> 兑换中...';
        btn.style.display = 'none';

        try {
            const response = await sendRedeemRequest(code);

            log.info('兑换响应:', response);

            if (response.status === 429) {
                // 限流 - 显示进度条提示，但保留按钮让用户可以随时重试
                log.warn('触发限流');
                card.classList.remove('active');
                card.classList.add('rate-limited');
                statusEl.className = 'gift-code-status rate-limited';
                statusEl.textContent = '触发限流';

                // 显示进度条，但保留按钮
                showRateLimitProgress(card, btn, allBtns, 30);
                btn.textContent = '重试';
                btn.style.display = 'inline-block';
                btn.disabled = false;
                showToast('触发限流，建议等待30秒后重试', 'warning');

                // 恢复其他按钮
                enableOtherButtons(allBtns);
                return;
            }

            if (response.status === 200 && response.data?.success) {
                // 成功
                log.info('兑换成功:', response.data);

                // 记录已使用的兑换码
                usedCodes.add(code);
                log.info('已将兑换码标记为已使用:', code);

                card.classList.remove('active');
                card.classList.add('success');
                statusEl.className = 'gift-code-status success';

                const cards = response.data.cards || [];
                const cardNames = cards.map(c => c.name).join(', ');
                statusEl.textContent = `✅ 领取成功！${cardNames ? '获得: ' + cardNames : ''}`;

                showToast(`${code} 兑换成功！`, 'success');

                // 恢复其他按钮
                enableOtherButtons(allBtns);
            } else {
                // 失败
                const errorMsg = response.data?.error || response.data?.message || '兑换失败';
                log.warn('兑换失败:', errorMsg);

                // 记录已使用的兑换码（包括已被领取的）
                usedCodes.add(code);
                log.info('已将兑换码标记为已使用:', code);

                card.classList.remove('active');
                card.classList.add('error');
                statusEl.className = 'gift-code-status error';
                statusEl.textContent = '❌ ' + errorMsg;

                showToast(errorMsg, 'error');

                // 恢复其他按钮
                enableOtherButtons(allBtns);
            }

        } catch (error) {
            log.error('兑换请求异常:', error);
            card.classList.remove('active');
            card.classList.add('error');
            statusEl.className = 'gift-code-status error';
            statusEl.textContent = '❌ ' + error.message;
            btn.textContent = '重试';
            btn.style.display = 'inline-block';
            btn.disabled = false;

            showToast('请求失败: ' + error.message, 'error');

            // 恢复其他按钮
            enableOtherButtons(allBtns);
        }
    }

    // 恢复其他按钮
    function enableOtherButtons(allBtns) {
        allBtns.forEach(b => {
            const card = b.closest('.gift-code-card');
            if (!card.classList.contains('success') && !card.classList.contains('error') && !card.classList.contains('rate-limited')) {
                b.disabled = false;
            }
        });
    }

    // 显示限流进度条
    function showRateLimitProgress(card, btn, allBtns, seconds) {
        const statusEl = card.querySelector('.gift-code-status');

        // 创建进度条容器
        let progressBar = card.querySelector('.gift-rate-limit-bar');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.className = 'gift-rate-limit-bar';
            progressBar.innerHTML = `
                <div class="bar-label">等待 <span class="countdown">${seconds}</span> 秒后可重试</div>
                <div class="bar-track"><div class="bar-fill" style="width: 100%"></div></div>
            `;
            card.appendChild(progressBar);
        }

        const countdownEl = progressBar.querySelector('.countdown');
        const fillEl = progressBar.querySelector('.bar-fill');

        let remaining = seconds;

        const updateProgress = () => {
            countdownEl.textContent = remaining;
            const percent = (remaining / seconds) * 100;
            fillEl.style.width = percent + '%';
        };

        updateProgress();

        // 保存定时器引用，以便在用户点击重试时清除
        card._rateLimitTimer = setInterval(() => {
            remaining--;

            if (remaining <= 0) {
                clearInterval(card._rateLimitTimer);
                card._rateLimitTimer = null;
                progressBar.remove();
                card.classList.remove('rate-limited');
                statusEl.className = 'gift-code-status';
                statusEl.textContent = '点击下方按钮领取';

                log.info('限流倒计时结束');
            } else {
                updateProgress();
            }
        }, 1000);
    }

    // 监听文本选择
    document.addEventListener('mouseup', async (e) => {
        // 如果点击的是弹窗内部，不处理
        if (e.target.closest('.gift-confirm-popup') || e.target.closest('.gift-redeem-modal')) {
            return;
        }

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (!selectedText) {
            return;
        }

        log.debug('用户选中文本:', selectedText);

        const codes = extractCodes(selectedText);

        if (codes.length === 0) {
            log.debug('未检测到兑换码');
            return;
        }

        log.info(`检测到 ${codes.length} 个兑换码:`, codes);

        // 获取鼠标位置
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // 显示确认弹窗
        const confirmed = await showConfirmPopup(codes, mouseX, mouseY);

        if (confirmed) {
            showRedeemModal(codes);
        }
    });

    log.info('脚本已加载，框选文本即可检测兑换码');
})();
