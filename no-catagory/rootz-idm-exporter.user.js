// ==UserScript==
// @name         Rootz IDM Exporter
// @namespace    https://www.rootz.so/
// @version      1.0.0
// @description  批量获取 Rootz 文件直链并导出为 IDM ef2 格式
// @author       You
// @match        https://www.rootz.so/folder/*
// @grant        GM_download
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============ 配置 ============
    const CONFIG = {
        API_BASE: 'https://www.rootz.so/api',
        DELAY_BETWEEN_REQUESTS: 100, // 请求间隔(ms)，避免被限流
        DEFAULT_CONCURRENCY: 5, // 默认并发数
    };

    // ============ 状态管理 ============
    const state = {
        files: [],
        linkCache: new Map(), // shortId -> { url, fileName, size, fetchedAt }
        selectedIds: new Set(),
        isProcessing: false,
        isPreloading: false,
        preloadProgress: { current: 0, total: 0 },
        concurrency: CONFIG.DEFAULT_CONCURRENCY, // 并发数：1=串行, 3/5/10=并发
        progress: { current: 0, total: 0 },
        directLinks: [], // { fileName, url, size }
    };

    // ============ 工具函数 ============
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return '今天';
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        if (days < 30) return `${Math.floor(days / 7)}周前`;
        if (days < 365) return `${Math.floor(days / 30)}个月前`;
        return `${Math.floor(days / 365)}年前`;
    };

    const getTotalSize = () => {
        return state.files
            .filter(f => state.selectedIds.has(f.short_id))
            .reduce((sum, f) => sum + f.size, 0);
    };

    const log = (message, type = 'info') => {
        const styles = {
            info: 'color: #3b82f6; font-weight: bold;',
            success: 'color: #22c55e; font-weight: bold;',
            error: 'color: #ef4444; font-weight: bold;',
            warn: 'color: #f59e0b; font-weight: bold;',
        };
        console.log(`%c[Rootz Exporter] ${message}`, styles[type] || styles.info);
    };

    // ============ API 请求 ============
    const getFolderInfo = async (folderId) => {
        log(`正在获取文件夹信息: ${folderId}`);
        const response = await fetch(`${CONFIG.API_BASE}/folders/share/${folderId}`);
        if (!response.ok) throw new Error(`获取文件夹信息失败: ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error('API返回失败');
        return data.data;
    };

    const getDirectLink = async (shortId) => {
        // 先检查缓存
        if (state.linkCache.has(shortId)) {
            const cached = state.linkCache.get(shortId);
            log(`使用缓存: ${shortId}`, 'info');
            return cached;
        }

        const response = await fetch(`${CONFIG.API_BASE}/files/download-by-short/${shortId}`);
        if (!response.ok) throw new Error(`获取直链失败: ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error('获取直链API返回失败');

        // 缓存结果
        state.linkCache.set(shortId, data.data);
        return data.data;
    };

    // 并发控制函数
    const fetchWithConcurrency = async (tasks, concurrency, onProgress) => {
        const results = [];
        const errors = [];
        let completed = 0;

        const executeTask = async (task, index) => {
            try {
                const result = await task();
                results[index] = result;
                completed++;
                onProgress && onProgress(completed, tasks.length, null);
                return result;
            } catch (err) {
                errors.push({ index, error: err });
                completed++;
                onProgress && onProgress(completed, tasks.length, err);
                return null;
            }
        };

        if (concurrency === 1) {
            // 串行执行
            for (let i = 0; i < tasks.length; i++) {
                await executeTask(tasks[i], i);
                if (i < tasks.length - 1) {
                    await sleep(CONFIG.DELAY_BETWEEN_REQUESTS);
                }
            }
        } else {
            // 并发执行
            const queue = [...tasks];
            const executing = [];

            for (let i = 0; i < tasks.length; i++) {
                const task = queue[i];
                const promise = executeTask(task, i).then(() => {
                    executing.splice(executing.indexOf(promise), 1);
                });
                executing.push(promise);

                if (executing.length >= concurrency) {
                    await Promise.race(executing);
                    await sleep(CONFIG.DELAY_BETWEEN_REQUESTS);
                }
            }

            await Promise.all(executing);
        }

        return { results, errors };
    };

    // 预加载所有文件的直链
    const preloadAllLinks = async () => {
        if (state.isPreloading || state.files.length === 0) return;

        state.isPreloading = true;
        log(`开始预加载 ${state.files.length} 个文件的直链...`, 'info');

        const tasks = state.files.map(file => async () => {
            try {
                await getDirectLink(file.short_id);
                return { shortId: file.short_id, success: true };
            } catch (err) {
                log(`预加载失败: ${file.name} - ${err.message}`, 'warn');
                return { shortId: file.short_id, success: false, error: err };
            }
        });

        const { results, errors } = await fetchWithConcurrency(
            tasks,
            state.concurrency,
            (current, total) => {
                updateProgress(current, total, `预加载直链: ${current}/${total}`);
            }
        );

        state.isPreloading = false;
        hideProgress();

        const successCount = results.filter(r => r && r.success).length;
        log(`预加载完成! 成功: ${successCount}, 失败: ${errors.length}`, successCount > 0 ? 'success' : 'warn');

        if (successCount > 0) {
            showStatus(`已预加载 ${successCount} 个文件的直链`, 'success');
        }
    };

    // ============ EF2 格式生成 ============
    const generateEF2 = (links) => {
        // IDM ef2 格式: 每个文件一行
        // <url>
        // cookie: xxx
        // User-Agent: xxx
        // referer: xxx
        // 空行分隔
        return links.map(link => {
            return `<\r\n${link.url}\r\ncookie: \r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36\r\nreferer: https://www.rootz.so/\r\n>`;
        }).join('\r\n');
    };

    const downloadEF2 = (content, folderName) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName || 'rootz_download'}.ef2`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // ============ UI 组件 ============
    const createStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
            #rootz-exporter-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 450px;
                min-height: 800px;
                max-height: calc(100vh - 100px);
                background: linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%);
                border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(139, 92, 246, 0.15);
                z-index: 99999;
                font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
                color: #e2e8f0;
                overflow: hidden;
                backdrop-filter: blur(20px);
                display: flex;
                flex-direction: column;
            }

            #rootz-exporter-panel * {
                box-sizing: border-box;
            }

            .rex-header {
                padding: 16px 20px;
                background: linear-gradient(90deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
                border-bottom: 1px solid rgba(139, 92, 246, 0.2);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .rex-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                background: linear-gradient(90deg, #a78bfa, #60a5fa);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .rex-header h3::before {
                content: '📦';
                -webkit-text-fill-color: initial;
            }

            .rex-close {
                background: rgba(239, 68, 68, 0.2);
                border: none;
                color: #f87171;
                width: 28px;
                height: 28px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 18px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }

            .rex-close:hover {
                background: rgba(239, 68, 68, 0.4);
                transform: scale(1.1);
            }

            .rex-content {
                padding: 16px 20px;
                max-height: calc(100vh - 280px);
                overflow-y: auto;
            }

            .rex-content::-webkit-scrollbar {
                width: 6px;
            }

            .rex-content::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
                border-radius: 3px;
            }

            .rex-content::-webkit-scrollbar-thumb {
                background: rgba(139, 92, 246, 0.5);
                border-radius: 3px;
            }

            .rex-folder-name {
                font-size: 14px;
                color: #94a3b8;
                margin-bottom: 12px;
                padding: 10px 12px;
                background: rgba(0, 0, 0, 0.2);
                border-radius: 8px;
                border-left: 3px solid #8b5cf6;
            }

            .rex-select-all {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: rgba(59, 130, 246, 0.1);
                border-radius: 8px;
                margin-bottom: 12px;
                cursor: pointer;
                transition: background 0.2s ease;
            }

            .rex-select-all:hover {
                background: rgba(59, 130, 246, 0.2);
            }

            .rex-select-all input {
                width: 18px;
                height: 18px;
                accent-color: #8b5cf6;
                cursor: pointer;
                flex-shrink: 0;
            }

            .rex-select-all label {
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                flex: 1;
            }

            .rex-select-all .count {
                font-size: 12px;
                color: #8b5cf6;
                background: rgba(139, 92, 246, 0.2);
                padding: 4px 10px;
                border-radius: 10px;
                font-weight: 600;
            }

            .rex-select-all .total-size {
                font-size: 11px;
                color: #64748b;
                margin-left: 6px;
            }

            .rex-file-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .rex-file-item {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 12px;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 1px solid transparent;
            }

            .rex-file-item:hover {
                background: rgba(255, 255, 255, 0.08);
                border-color: rgba(139, 92, 246, 0.3);
            }

            .rex-file-item.selected {
                background: rgba(139, 92, 246, 0.15);
                border-color: rgba(139, 92, 246, 0.5);
            }

            .rex-file-item input {
                width: 18px;
                height: 18px;
                accent-color: #8b5cf6;
                cursor: pointer;
                flex-shrink: 0;
                margin-top: 2px;
            }

            .rex-file-info {
                flex: 1;
                min-width: 0;
            }

            .rex-file-name {
                font-size: 13px;
                color: #e2e8f0;
                line-height: 1.4;
                word-wrap: break-word;
                word-break: break-word;
                margin-bottom: 6px;
            }

            .rex-file-meta {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
                margin-top: 4px;
            }

            .rex-file-size {
                font-size: 12px;
                color: #8b5cf6;
                background: rgba(139, 92, 246, 0.15);
                padding: 2px 8px;
                border-radius: 4px;
                font-weight: 600;
            }

            .rex-file-downloads {
                font-size: 11px;
                color: #64748b;
                display: flex;
                align-items: center;
                gap: 3px;
            }

            .rex-file-downloads::before {
                content: '⬇';
                font-size: 10px;
            }

            .rex-file-date {
                font-size: 11px;
                color: #64748b;
                display: flex;
                align-items: center;
                gap: 3px;
            }

            .rex-file-date::before {
                content: '🕐';
                font-size: 10px;
            }

            .rex-footer {
                padding: 16px 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(0, 0, 0, 0.2);
            }

            .rex-progress-container {
                margin-bottom: 12px;
                display: none;
            }

            .rex-progress-container.active {
                display: block;
            }

            .rex-progress-text {
                font-size: 12px;
                color: #94a3b8;
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
            }

            .rex-progress-bar {
                height: 8px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                overflow: hidden;
            }

            .rex-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #8b5cf6, #3b82f6);
                border-radius: 4px;
                transition: width 0.3s ease;
                width: 0%;
            }

            .rex-btn {
                width: 100%;
                padding: 12px 20px;
                border: none;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            .rex-btn-primary {
                background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
                color: white;
                box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);
            }

            .rex-btn-primary:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
            }

            .rex-btn-primary:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }

            .rex-btn-secondary {
                background: rgba(255, 255, 255, 0.1);
                color: #e2e8f0;
                margin-top: 8px;
            }

            .rex-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.15);
            }

            .rex-loading {
                display: inline-block;
                width: 16px;
                height: 16px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: rex-spin 0.8s linear infinite;
            }

            @keyframes rex-spin {
                to { transform: rotate(360deg); }
            }

            .rex-toggle-btn {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 50px;
                height: 50px;
                background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
                border: none;
                border-radius: 50%;
                color: white;
                font-size: 24px;
                cursor: pointer;
                z-index: 99998;
                box-shadow: 0 4px 20px rgba(139, 92, 246, 0.5);
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .rex-toggle-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 25px rgba(139, 92, 246, 0.6);
            }

            .rex-toggle-btn.hidden {
                display: none;
            }

            .rex-status {
                font-size: 12px;
                padding: 8px 12px;
                border-radius: 6px;
                margin-top: 8px;
                display: none;
            }

            .rex-status.success {
                display: block;
                background: rgba(34, 197, 94, 0.2);
                color: #4ade80;
                border: 1px solid rgba(34, 197, 94, 0.3);
            }

            .rex-status.error {
                display: block;
                background: rgba(239, 68, 68, 0.2);
                color: #f87171;
                border: 1px solid rgba(239, 68, 68, 0.3);
            }

            .rex-concurrency-control {
                margin-bottom: 12px;
                padding: 10px 12px;
                background: rgba(0, 0, 0, 0.2);
                border-radius: 8px;
                border: 1px solid rgba(139, 92, 246, 0.2);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .rex-concurrency-label {
                font-size: 13px;
                color: #94a3b8;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .rex-concurrency-label .value {
                color: #8b5cf6;
                font-weight: 600;
            }

            .rex-concurrency-input-wrapper {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .rex-concurrency-input {
                width: 60px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 6px;
                color: #a78bfa;
                padding: 4px 8px;
                font-size: 13px;
                font-weight: 600;
                text-align: center;
                outline: none;
                transition: all 0.2s ease;
            }

            .rex-concurrency-input:focus {
                border-color: #8b5cf6;
                background: rgba(139, 92, 246, 0.1);
                box-shadow: 0 0 10px rgba(139, 92, 246, 0.2);
            }

            .rex-preload-btn {
                width: 100%;
                padding: 8px 16px;
                background: rgba(59, 130, 246, 0.1);
                border: 1px solid rgba(59, 130, 246, 0.2);
                border-radius: 8px;
                color: #60a5fa;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                margin-bottom: 12px;
                opacity: 0.7;
            }

            .rex-preload-btn:hover:not(:disabled) {
                opacity: 1;
                background: rgba(59, 130, 246, 0.2);
            }

            .rex-preload-btn:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    };

    const createPanel = () => {
        // 创建切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'rootz-exporter-toggle';
        toggleBtn.className = 'rex-toggle-btn hidden';
        toggleBtn.innerHTML = '📦';
        toggleBtn.title = '打开 IDM 导出面板';
        document.body.appendChild(toggleBtn);

        // 创建主面板
        const panel = document.createElement('div');
        panel.id = 'rootz-exporter-panel';
        panel.innerHTML = `
            <div class="rex-header">
                <h3>IDM 导出器</h3>
                <button class="rex-close" title="关闭面板">×</button>
            </div>
            <div class="rex-content">
                <div class="rex-folder-name" id="rex-folder-name">加载中...</div>
                <div class="rex-select-all" id="rex-select-all">
                    <input type="checkbox" id="rex-select-all-cb">
                    <label for="rex-select-all-cb">全选</label>
                    <span class="count" id="rex-selected-count">0 / 0</span>
                    <span class="total-size" id="rex-total-size"></span>
                </div>
                <div class="rex-file-list" id="rex-file-list">
                    <!-- 文件列表 -->
                </div>
            </div>
            <div class="rex-footer">
                <div class="rex-concurrency-control">
                    <div class="rex-concurrency-label">
                        <span>⚡ 并发数</span>
                    </div>
                    <div class="rex-concurrency-input-wrapper">
                        <input type="number" id="rex-concurrency-input" class="rex-concurrency-input" min="1" max="50" value="${state.concurrency}">
                    </div>
                </div>
                <button class="rex-preload-btn" id="rex-preload-btn">
                    <span>🚀 自动预加载中...</span>
                </button>
                <div class="rex-progress-container" id="rex-progress">
                    <div class="rex-progress-text">
                        <span id="rex-progress-label">正在获取直链...</span>
                        <span id="rex-progress-percent">0%</span>
                    </div>
                    <div class="rex-progress-bar">
                        <div class="rex-progress-fill" id="rex-progress-fill"></div>
                    </div>
                </div>
                <button class="rex-btn rex-btn-primary" id="rex-export-btn" disabled>
                    <span>📥</span>
                    <span>导出 EF2 文件</span>
                </button>
                <button class="rex-btn rex-btn-secondary" id="rex-copy-btn" style="display:none;">
                    <span>📋</span>
                    <span>复制直链解析结果</span>
                </button>
                <div class="rex-status" id="rex-status"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定事件
        bindEvents(panel, toggleBtn);
    };

    const bindEvents = (panel, toggleBtn) => {
        // 关闭按钮
        panel.querySelector('.rex-close').addEventListener('click', () => {
            panel.style.display = 'none';
            toggleBtn.classList.remove('hidden');
        });

        // 切换按钮
        toggleBtn.addEventListener('click', () => {
            panel.style.display = 'block';
            toggleBtn.classList.add('hidden');
        });

        // 全选
        const selectAllCb = panel.querySelector('#rex-select-all-cb');
        selectAllCb.addEventListener('change', (e) => {
            const checked = e.target.checked;
            state.files.forEach(file => {
                if (checked) {
                    state.selectedIds.add(file.short_id);
                } else {
                    state.selectedIds.delete(file.short_id);
                }
            });
            updateFileList();
            updateSelectedCount();
            updateExportButton();
        });

        // 导出按钮
        panel.querySelector('#rex-export-btn').addEventListener('click', handleExport);

        // 复制按钮
        panel.querySelector('#rex-copy-btn').addEventListener('click', handleCopyLinks);

        // 并发数输入框
        const concurrencyInput = panel.querySelector('#rex-concurrency-input');
        concurrencyInput.addEventListener('change', (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 1) value = 1;
            if (value > 50) value = 50;
            e.target.value = value;
            state.concurrency = value;
            log(`并发数已设置为: ${value}`, 'info');
        });

        // 预加载按钮 (现在主要作为状态显示和重试)
        panel.querySelector('#rex-preload-btn').addEventListener('click', async () => {
            if (state.isPreloading) return;
            await preloadAllLinks();
        });
    };

    const updateFileList = () => {
        const listEl = document.querySelector('#rex-file-list');
        listEl.innerHTML = state.files.map(file => `
            <div class="rex-file-item ${state.selectedIds.has(file.short_id) ? 'selected' : ''}" data-id="${file.short_id}">
                <input type="checkbox" ${state.selectedIds.has(file.short_id) ? 'checked' : ''}>
                <div class="rex-file-info">
                    <div class="rex-file-name">${file.name}</div>
                    <div class="rex-file-meta">
                        <span class="rex-file-size">${formatSize(file.size)}</span>
                        <span class="rex-file-downloads">${file.download_count || 0}</span>
                        <span class="rex-file-date">${formatDate(file.created_at)}</span>
                    </div>
                </div>
            </div>
        `).join('');

        // 绑定点击事件
        listEl.querySelectorAll('.rex-file-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const id = item.dataset.id;
                const checkbox = item.querySelector('input');
                checkbox.checked = !checkbox.checked;
                if (checkbox.checked) {
                    state.selectedIds.add(id);
                    item.classList.add('selected');
                } else {
                    state.selectedIds.delete(id);
                    item.classList.remove('selected');
                }
                updateSelectedCount();
                updateExportButton();
                updateSelectAllCheckbox();
            });

            item.querySelector('input').addEventListener('change', (e) => {
                const id = item.dataset.id;
                if (e.target.checked) {
                    state.selectedIds.add(id);
                    item.classList.add('selected');
                } else {
                    state.selectedIds.delete(id);
                    item.classList.remove('selected');
                }
                updateSelectedCount();
                updateExportButton();
                updateSelectAllCheckbox();
            });
        });
    };

    const updateSelectedCount = () => {
        const countEl = document.querySelector('#rex-selected-count');
        const totalSizeEl = document.querySelector('#rex-total-size');
        countEl.textContent = `${state.selectedIds.size} / ${state.files.length}`;

        if (state.selectedIds.size > 0) {
            const totalSize = getTotalSize();
            totalSizeEl.textContent = `(${formatSize(totalSize)})`;
        } else {
            totalSizeEl.textContent = '';
        }
    };

    const updateSelectAllCheckbox = () => {
        const cb = document.querySelector('#rex-select-all-cb');
        cb.checked = state.selectedIds.size === state.files.length && state.files.length > 0;
        cb.indeterminate = state.selectedIds.size > 0 && state.selectedIds.size < state.files.length;
    };

    const updateExportButton = () => {
        const btn = document.querySelector('#rex-export-btn');
        btn.disabled = state.selectedIds.size === 0 || state.isProcessing;
    };

    const updateProgress = (current, total, label = '正在获取直链...') => {
        const container = document.querySelector('#rex-progress');
        const fill = document.querySelector('#rex-progress-fill');
        const percent = document.querySelector('#rex-progress-percent');
        const labelEl = document.querySelector('#rex-progress-label');

        container.classList.add('active');
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        fill.style.width = `${pct}%`;
        percent.textContent = `${pct}%`;
        labelEl.textContent = label;
    };

    const hideProgress = () => {
        document.querySelector('#rex-progress').classList.remove('active');
    };

    const showStatus = (message, type = 'success') => {
        const statusEl = document.querySelector('#rex-status');
        statusEl.textContent = message;
        statusEl.className = `rex-status ${type}`;
        setTimeout(() => {
            statusEl.className = 'rex-status';
        }, 5000);
    };

    // ============ 核心逻辑 ============
    const handleExport = async () => {
        if (state.isProcessing || state.selectedIds.size === 0) return;

        state.isProcessing = true;
        state.directLinks = [];
        const exportBtn = document.querySelector('#rex-export-btn');
        const copyBtn = document.querySelector('#rex-copy-btn');
        exportBtn.disabled = true;
        exportBtn.innerHTML = '<span class="rex-loading"></span><span>正在获取直链...</span>';
        copyBtn.style.display = 'none';

        const selectedFiles = state.files.filter(f => state.selectedIds.has(f.short_id));
        const total = selectedFiles.length;

        log(`开始获取 ${total} 个文件的直链 (${state.concurrency === 1 ? '串行' : `并发 ${state.concurrency}`})...`, 'info');

        const tasks = selectedFiles.map(file => async () => {
            try {
                const linkData = await getDirectLink(file.short_id);
                log(`✓ 成功: ${file.name}`, 'success');
                return {
                    fileName: linkData.fileName,
                    url: linkData.url,
                    size: linkData.size,
                };
            } catch (err) {
                log(`✗ 失败: ${file.name} - ${err.message}`, 'error');
                return null;
            }
        });

        const { results, errors } = await fetchWithConcurrency(
            tasks,
            state.concurrency,
            (current, total) => {
                updateProgress(current, total, `正在获取直链: ${current}/${total}`);
            }
        );

        // 过滤掉失败的结果
        state.directLinks = results.filter(r => r !== null);

        state.isProcessing = false;
        hideProgress();

        if (state.directLinks.length > 0) {
            // 获取文件夹名称
            const folderName = document.querySelector('#rex-folder-name').textContent || 'rootz_download';

            // 生成并下载 EF2
            const ef2Content = generateEF2(state.directLinks);
            downloadEF2(ef2Content, folderName);

            log(`✓ 完成! 成功: ${state.directLinks.length}, 失败: ${errors.length}`, 'success');
            showStatus(`已导出 ${state.directLinks.length} 个文件的直链!`, 'success');

            // 显示复制按钮
            copyBtn.style.display = 'flex';
        } else {
            log('所有文件获取失败', 'error');
            showStatus('所有文件获取失败，请重试', 'error');
        }

        exportBtn.innerHTML = '<span>📥</span><span>导出 EF2 文件</span>';
        updateExportButton();
    };

    const handleCopyLinks = () => {
        if (state.directLinks.length === 0) return;

        const links = state.directLinks.map(l => l.url).join('\n');
        navigator.clipboard.writeText(links).then(() => {
            showStatus('直链已复制到剪贴板!', 'success');
            log('直链已复制到剪贴板', 'success');
        }).catch(() => {
            showStatus('复制失败，请手动复制', 'error');
        });
    };

    // ============ 初始化 ============
    const init = async () => {
        log('初始化油猴脚本...', 'info');

        // 注入样式
        createStyles();

        // 创建面板
        createPanel();

        // 获取文件夹ID
        const pathMatch = window.location.pathname.match(/\/folder\/([^\/]+)/);
        if (!pathMatch) {
            log('无法解析文件夹ID', 'error');
            document.querySelector('#rex-folder-name').textContent = '❌ 无法解析文件夹ID';
            return;
        }

        const folderId = pathMatch[1];
        log(`文件夹ID: ${folderId}`, 'info');

        try {
            const folderData = await getFolderInfo(folderId);
            state.files = folderData.files || [];

            // 更新UI
            document.querySelector('#rex-folder-name').textContent = `📁 ${folderData.folder.name}`;
            log(`文件夹: ${folderData.folder.name}, 共 ${state.files.length} 个文件`, 'success');

            updateFileList();
            updateSelectedCount();

            // 自动开始预加载
            setTimeout(() => {
                log('自动开始预加载直链...', 'info');
                preloadAllLinks();
            }, 500);
        } catch (err) {
            log(`获取文件夹信息失败: ${err.message}`, 'error');
            document.querySelector('#rex-folder-name').textContent = `❌ 加载失败: ${err.message}`;
        }
    };

    // 等待页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
