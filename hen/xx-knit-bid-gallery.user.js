// ==UserScript==
// @name         xx.knit.bid 极致画廊 (全页加载 + Grid + 灯箱)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  一键加载所有分页图片，Grid画廊展示，旗舰灯箱浏览，屏蔽广告与无用轮询
// @author       owwkmidream
// @match        https://xx.knit.bid/article/*
// @icon         https://xx.knit.bid/static/favicon.ico
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ===========================================
    // 1. 配置与状态
    // ===========================================
    const CONFIG = {
        colCount: parseInt(localStorage.getItem('xxknit_col_count') || '4', 10),
        isMobile: /Android|iPhone/i.test(navigator.userAgent),
        blockedHosts: ['fiora.attr.bid'],
        adSelectors: [
            '.clickadu-container',
            '#disclaimer-dialog',
            '#disclaimer-background',
            '.st-sticky-share-buttons',
            '#site-notices-top',
            '#site-notices-bottom',
            '.site-notice',
            '#chat-container',
            '#chat-button',
            '[data-zone-id]',
            'script[src*="clickadu"]',
            'script[src*="diagramjawlineunhappy"]',
            'script[src*="chaseherbalpasty"]',
            'script[src*="pemsrv"]',
            'script[src*="hideousnumber"]',
            'script[src*="termsfeed"]',
        ],
    };

    // ===========================================
    // 2. 网络拦截层 - 屏蔽 socket.io 轮询
    // ===========================================
    const _origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        if (typeof url === 'string' && CONFIG.blockedHosts.some(h => url.includes(h))) {
            this._blocked = true;
            return;
        }
        return _origXHROpen.call(this, method, url, ...args);
    };
    const _origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
        if (this._blocked) return;
        return _origXHRSend.apply(this, args);
    };

    const _origFetch = window.fetch;
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (CONFIG.blockedHosts.some(h => url.includes(h))) {
            return Promise.reject(new Error('[UserScript] Blocked: ' + url));
        }
        return _origFetch.call(this, input, init);
    };

    // 拦截 WebSocket (针对 socket.io)
    const _origWS = window.WebSocket;
    window.WebSocket = function (url, ...args) {
        if (typeof url === 'string' && CONFIG.blockedHosts.some(h => url.includes(h))) {
            console.log('[UserScript] Blocked WebSocket:', url);
            return { close() { }, send() { }, addEventListener() { }, removeEventListener() { } };
        }
        return new _origWS(url, ...args);
    };
    window.WebSocket.prototype = _origWS.prototype;

    // ===========================================
    // 3. 等待 DOM 就绪后执行
    // ===========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // 防重入
        if (document.body?.dataset.xxknitProcessed === 'true') return;
        document.body.dataset.xxknitProcessed = 'true';

        injectStyles();
        cleanAds();
        const pageInfo = parsePageInfo();
        if (pageInfo) {
            buildGallery(pageInfo);
        }
    }

    // ===========================================
    // 4. 核心样式
    // ===========================================
    function injectStyles() {
        const css = `
        /* 强制祖先 overflow:visible 让 sticky 生效 */
        .article-content, #main, #main.container,
        section#main, section.container {
            overflow: visible !important;
        }
        #xxk-gallery-wrap {
            max-width: 1400px; margin: 10px auto;
            border: 2px solid #e8839b;
            border-top: none;
            border-radius: 0 0 10px 10px;
            overflow: visible !important;
            padding: 8px;
        }
        #xxk-gallery-toolbar {
            position: sticky; top: 6px; z-index: 100;
            display: flex; align-items: center; gap: 10px;
            padding: 8px 16px;
            border-radius: 8px;
            background: linear-gradient(135deg, #e8839b, #d4697f);
            backdrop-filter: blur(10px);
            color: #fff; font-size: 13px;
            box-shadow: 0 2px 8px rgba(232,131,155,0.4);
            margin: -8px -8px 8px -8px;
            border-bottom: 2px solid #e8839b;
            border-radius: 0;
        }
        #xxk-gallery-toolbar label { white-space: nowrap; }
        #xxk-gallery-toolbar input[type=range] {
            width: 140px; accent-color: #fff; cursor: pointer;
        }
        #xxk-col-val { color: #fff; font-weight: bold; min-width: 20px; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.3); }
        #xxk-progress {
            margin-left: 8px; color: #8f8; font-family: monospace;
        }

        #xxk-grid {
            display: grid !important;
            grid-template-columns: repeat(var(--xxk-cols, 4), 1fr);
            gap: 8px;
        }
        #xxk-grid .xxk-item {
            overflow: hidden; border-radius: 6px; cursor: pointer;
            position: relative; background: #1a1a1a;
            aspect-ratio: 3 / 4;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        #xxk-grid .xxk-item:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        #xxk-grid .xxk-item img {
            width: 100%; height: 100%; display: block;
            object-fit: cover;
        }
        #xxk-grid .xxk-item .xxk-seq {
            position: absolute; top: 6px; left: 6px;
            background: rgba(0,0,0,0.65); color: #fff;
            font-size: 11px; font-family: monospace;
            padding: 2px 7px; border-radius: 4px;
            pointer-events: none; z-index: 1;
            line-height: 1.4;
        }

        /* === 原始内容隐藏 === */
        .article-content .image-container,
        .article-content .pagination-nav,
        .article-content .progress-bar,
        .article-content .loading-indicator,
        .article-content .clickadu-container {
            display: none !important;
        }
        /* 原始 .wrapper 在视频提取后隐藏 */
        .article-content .wrapper.xxk-extracted {
            display: none !important;
        }

        /* === 视频/媒体容器 === */
        #xxk-media-wrap {
            max-width: 900px; margin: 0 auto 16px;
        }
        #xxk-media-wrap .video-js {
            width: 100% !important;
            border-radius: 8px; overflow: hidden;
        }
        #xxk-media-wrap .vip-mp4-download-panel {
            margin-top: 8px;
        }

        /* === 灯箱 === */
        #xxk-lightbox {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.97);
            z-index: 100000; user-select: none; overflow: hidden;
            touch-action: none;
        }
        #xxk-lightbox.active { display: flex; align-items: center; justify-content: center; }

        #xxk-lb-img {
            max-width: 95vw; max-height: 92vh;
            object-fit: contain; cursor: grab;
            transition: transform 0.15s ease-out;
            touch-action: none; will-change: transform;
        }
        #xxk-lb-img.dragging { cursor: grabbing; transition: none; }

        .xxk-lb-nav {
            position: absolute; top: 0; width: 60px; height: 100%;
            display: flex; align-items: center; justify-content: center;
            color: rgba(255,255,255,0.5); font-size: 48px;
            cursor: pointer; z-index: 100010;
            transition: color 0.2s, background 0.2s;
        }
        .xxk-lb-nav:hover { color: #fff; background: rgba(255,255,255,0.05); }
        .xxk-lb-prev { left: 0; }
        .xxk-lb-next { right: 0; }

        .xxk-lb-close {
            position: absolute; top: 16px; right: 24px;
            color: #aaa; font-size: 36px; cursor: pointer;
            z-index: 100020; transition: color 0.2s;
            line-height: 1;
        }
        .xxk-lb-close:hover { color: #fff; }

        #xxk-lb-counter {
            position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
            color: #999; font-size: 14px; z-index: 100010;
            background: rgba(0,0,0,0.6); padding: 5px 14px; border-radius: 20px;
            pointer-events: none; font-family: monospace;
        }

        #xxk-lb-loading {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
            color: #666; font-size: 14px; z-index: 100005;
        }
        `;
        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(css);
        } else {
            const el = document.createElement('style');
            el.textContent = css;
            document.head.appendChild(el);
        }
    }

    // ===========================================
    // 5. 广告清理
    // ===========================================
    function cleanAds() {
        CONFIG.adSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.style.setProperty('display', 'none', 'important');
            });
        });
        // 持续清理 (SPA 对抗)
        const observer = new MutationObserver(() => {
            CONFIG.adSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    if (el.style.display !== 'none') {
                        el.style.setProperty('display', 'none', 'important');
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ===========================================
    // 6. 解析页面信息
    // ===========================================
    function parsePageInfo() {
        // 从页面 script 中提取 paginationData
        const scripts = document.querySelectorAll('script:not([src])');
        let totalPages = 1, currentPage = 1, articleId = null;

        // 从 URL 中提取 article ID
        const urlMatch = location.pathname.match(/\/article\/(\d+)/);
        if (urlMatch) articleId = urlMatch[1];
        if (!articleId) return null;

        for (const s of scripts) {
            const text = s.textContent;
            // 查找 paginationData
            const totalMatch = text.match(/["']?total_pages["']?\s*:\s*(\d+)/);
            const currentMatch = text.match(/["']?current_page["']?\s*:\s*(\d+)/);
            if (totalMatch) totalPages = parseInt(totalMatch[1], 10);
            if (currentMatch) currentPage = parseInt(currentMatch[1], 10);
        }

        // 也可以从分页 DOM 获取
        if (totalPages === 1) {
            const pageLinks = document.querySelectorAll('.pagination a[data-page]');
            pageLinks.forEach(a => {
                const p = parseInt(a.dataset.page, 10);
                if (p > totalPages) totalPages = p;
            });
        }

        return { articleId, currentPage, totalPages };
    }

    // ===========================================
    // 7. 源地址智能清洗
    // ===========================================
    function getHighResUrl(img) {
        // 优先级: data-src > data-original > src (排除占位图)
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc && !dataSrc.includes('timg.gif')) return dataSrc;

        const dataOrig = img.getAttribute('data-original');
        if (dataOrig && !dataOrig.includes('timg.gif')) return dataOrig;

        const src = img.getAttribute('src');
        if (src && !src.includes('timg.gif')) return src;

        return null;
    }

    // ===========================================
    // 8. 构建画廊
    // ===========================================
    async function buildGallery({ articleId, currentPage, totalPages }) {
        const articleContent = document.querySelector('.article-content') || document.querySelector('#main');
        if (!articleContent) return;

        // --------- 提取视频/媒体内容放到画廊之前 ---------
        const mediaWrap = document.createElement('div');
        mediaWrap.id = 'xxk-media-wrap';
        const wrappers = articleContent.querySelectorAll('.wrapper');
        wrappers.forEach(wrapper => {
            const videos = wrapper.querySelectorAll('.video-js, video, .vip-mp4-download-panel');
            if (videos.length > 0) {
                videos.forEach(v => mediaWrap.appendChild(v.cloneNode(true)));
            }
            wrapper.classList.add('xxk-extracted');
        });
        if (mediaWrap.children.length > 0) {
            articleContent.insertBefore(mediaWrap, articleContent.firstChild);
        }

        // 创建画廊容器
        const wrap = document.createElement('div');
        wrap.id = 'xxk-gallery-wrap';

        // 工具栏 (画廊右上角)
        const toolbar = document.createElement('div');
        toolbar.id = 'xxk-gallery-toolbar';
        toolbar.innerHTML = `
            <label>🖼️ 每行:</label>
            <input type="range" id="xxk-col-slider" min="1" max="8" value="${CONFIG.colCount}" step="1">
            <span id="xxk-col-val">${CONFIG.colCount}</span>
            <span id="xxk-progress">加载中... 0/${totalPages}</span>
        `;
        wrap.appendChild(toolbar);

        // Grid 容器
        const grid = document.createElement('div');
        grid.id = 'xxk-grid';
        grid.style.setProperty('--xxk-cols', String(CONFIG.colCount));
        wrap.appendChild(grid);

        articleContent.insertBefore(wrap, articleContent.firstChild);

        // 滑块交互
        const slider = document.getElementById('xxk-col-slider');
        const colVal = document.getElementById('xxk-col-val');
        slider.addEventListener('input', () => {
            const v = slider.value;
            grid.style.setProperty('--xxk-cols', v);
            colVal.textContent = v;
            localStorage.setItem('xxknit_col_count', v);
        });

        const progressEl = document.getElementById('xxk-progress');

        // --------- 并发抓取所有页面 ---------
        /** @type {Map<number, string[]>} */
        const pageMap = new Map();
        let loaded = 0;

        // 提取当前页面的图片
        const currentImgs = extractImagesFromDOM(document);
        pageMap.set(currentPage, currentImgs);
        loaded++;
        progressEl.textContent = `加载中... ${loaded}/${totalPages}`;

        // 并发获取其余页面
        if (totalPages > 1) {
            const fetchPromises = [];
            for (let p = 1; p <= totalPages; p++) {
                if (p === currentPage) continue;
                fetchPromises.push(
                    fetchPage(articleId, p).then(imgs => {
                        pageMap.set(p, imgs);
                        loaded++;
                        progressEl.textContent = `加载中... ${loaded}/${totalPages}`;
                    }).catch(err => {
                        console.warn(`[xxknit] Page ${p} failed:`, err);
                        pageMap.set(p, []);
                        loaded++;
                        progressEl.textContent = `加载中... ${loaded}/${totalPages}`;
                    })
                );
            }
            await Promise.all(fetchPromises);
        }

        progressEl.textContent = `✅ 共 ${totalPages} 页`;

        // --------- 按顺序渲染（无分页分割线） ---------
        const allUrls = [];
        for (let p = 1; p <= totalPages; p++) {
            const imgs = pageMap.get(p) || [];
            imgs.forEach(url => allUrls.push(url));
        }

        allUrls.forEach((url, i) => {
            const item = document.createElement('div');
            item.className = 'xxk-item';
            item.dataset.index = String(i);

            const seq = document.createElement('span');
            seq.className = 'xxk-seq';
            seq.textContent = String(i + 1);
            item.appendChild(seq);

            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            item.appendChild(img);
            grid.appendChild(item);
        });

        // --------- 初始化灯箱 ---------
        const lightbox = createLightbox(allUrls);

        grid.addEventListener('click', (e) => {
            const item = e.target.closest('.xxk-item');
            if (!item) return;
            const idx = parseInt(item.dataset.index, 10);
            lightbox.open(idx);
        });
    }

    // ===========================================
    // 9. 从 DOM 提取图片
    // ===========================================
    function extractImagesFromDOM(doc) {
        const imgs = doc.querySelectorAll('.item-image img, .image-container img');
        const urls = [];
        imgs.forEach(img => {
            const url = getHighResUrl(img);
            if (url) urls.push(resolveUrl(url));
        });
        return urls;
    }

    function resolveUrl(url) {
        if (url.startsWith('//')) return 'https:' + url;
        if (url.startsWith('/')) return location.origin + url;
        return url;
    }

    // ===========================================
    // 10. AJAX 分页抓取
    // ===========================================
    async function fetchPage(articleId, page) {
        // 检测当前语言前缀
        const langMatch = location.pathname.match(/^\/(en|vi|th|ko|ja|zh-hant)\//);
        const langPrefix = langMatch ? `/${langMatch[1]}` : '';

        const url = `${langPrefix}/article/${articleId}/page/${page}/?ajax=1`;
        const resp = await fetch(url, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': '*/*',
            },
            credentials: 'include',
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // 从返回的 HTML 中提取图片
        const parser = new DOMParser();
        const doc = parser.parseFromString(data.html, 'text/html');
        const imgs = doc.querySelectorAll('img');
        const urls = [];
        imgs.forEach(img => {
            const url = getHighResUrl(img);
            if (url) urls.push(resolveUrl(url));
        });
        return urls;
    }

    // ===========================================
    // 11. 旗舰灯箱引擎
    // ===========================================
    function createLightbox(allUrls) {
        const container = document.createElement('div');
        container.id = 'xxk-lightbox';
        container.innerHTML = `
            <div class="xxk-lb-close">✕</div>
            <div class="xxk-lb-nav xxk-lb-prev">‹</div>
            <div class="xxk-lb-nav xxk-lb-next">›</div>
            <img id="xxk-lb-img" src="" alt="">
            <div id="xxk-lb-loading">加载中...</div>
            <div id="xxk-lb-counter"></div>
        `;
        document.body.appendChild(container);

        const imgEl = document.getElementById('xxk-lb-img');
        const counterEl = document.getElementById('xxk-lb-counter');
        const loadingEl = document.getElementById('xxk-lb-loading');
        const closeBtn = container.querySelector('.xxk-lb-close');
        const prevBtn = container.querySelector('.xxk-lb-prev');
        const nextBtn = container.querySelector('.xxk-lb-next');

        let currentIdx = 0;
        let scale = 1, translateX = 0, translateY = 0;
        let isDragging = false, dragStartX = 0, dragStartY = 0, lastTX = 0, lastTY = 0;
        let pinchStartDist = 0, pinchStartScale = 1;

        function updateTransform() {
            imgEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        }

        function resetTransform() {
            scale = 1; translateX = 0; translateY = 0;
            updateTransform();
        }

        function showImage(idx) {
            if (idx < 0 || idx >= allUrls.length) return;
            currentIdx = idx;
            imgEl.style.opacity = '0';
            loadingEl.style.display = 'block';
            resetTransform();

            const img = new Image();
            img.onload = () => {
                imgEl.src = allUrls[currentIdx];
                imgEl.style.opacity = '1';
                loadingEl.style.display = 'none';
            };
            img.onerror = () => {
                imgEl.src = allUrls[currentIdx]; // 仍然尝试显示
                imgEl.style.opacity = '1';
                loadingEl.style.display = 'none';
            };
            img.src = allUrls[currentIdx];

            counterEl.textContent = `${currentIdx + 1} / ${allUrls.length}`;
        }

        function navigate(dir) {
            const next = currentIdx + dir;
            if (next >= 0 && next < allUrls.length) {
                showImage(next);
            }
        }

        function closeLightbox() {
            container.classList.remove('active');
            document.body.style.overflow = '';
        }

        function openLightbox(idx) {
            container.classList.add('active');
            document.body.style.overflow = 'hidden';
            showImage(idx);
        }

        // --- 事件绑定 ---

        closeBtn.addEventListener('click', closeLightbox);
        prevBtn.addEventListener('click', () => navigate(-1));
        nextBtn.addEventListener('click', () => navigate(1));

        // 点击灯箱背景关闭
        container.addEventListener('click', (e) => {
            if (e.target === container) closeLightbox();
        });

        // 键盘
        document.addEventListener('keydown', (e) => {
            if (!container.classList.contains('active')) return;
            if (e.key === 'Escape') closeLightbox();
            else if (e.key === 'ArrowLeft') navigate(-1);
            else if (e.key === 'ArrowRight') navigate(1);
        });

        // 滚轮缩放 (以鼠标为中心)
        imgEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = imgEl.getBoundingClientRect();
            const cx = e.clientX - rect.left - rect.width / 2;
            const cy = e.clientY - rect.top - rect.height / 2;

            const oldScale = scale;
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            scale = Math.max(0.5, Math.min(10, scale * delta));

            // 调整平移使缩放中心不变
            const ratio = scale / oldScale;
            translateX = cx - ratio * (cx - translateX);
            translateY = cy - ratio * (cy - translateY);

            updateTransform();
        }, { passive: false });

        // 阻止原生图片拖拽
        imgEl.addEventListener('dragstart', (e) => e.preventDefault());

        // 拖拽平移 (PC)
        imgEl.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 始终阻止默认行为，防止浏览器原生图片拖拽
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            lastTX = translateX;
            lastTY = translateY;
            imgEl.classList.add('dragging');
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            translateX = lastTX + (e.clientX - dragStartX);
            translateY = lastTY + (e.clientY - dragStartY);
            updateTransform();
        });
        document.addEventListener('mouseup', () => {
            isDragging = false;
            imgEl.classList.remove('dragging');
        });

        // 双击切换 100%/200%
        imgEl.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (scale > 1.5) {
                resetTransform();
            } else {
                scale = 2;
                translateX = 0;
                translateY = 0;
                updateTransform();
            }
        });

        // 触摸手势 (移动端)
        let touchStartX = 0, touchStartY = 0;

        imgEl.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                // 双指捏合开始
                pinchStartDist = getTouchDist(e.touches);
                pinchStartScale = scale;
            } else if (e.touches.length === 1 && scale > 1) {
                // 单指拖拽
                isDragging = true;
                dragStartX = e.touches[0].clientX;
                dragStartY = e.touches[0].clientY;
                lastTX = translateX;
                lastTY = translateY;
            } else if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }
        }, { passive: true });

        imgEl.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 2) {
                const dist = getTouchDist(e.touches);
                scale = Math.max(0.5, Math.min(10, pinchStartScale * (dist / pinchStartDist)));
                updateTransform();
            } else if (e.touches.length === 1 && isDragging) {
                translateX = lastTX + (e.touches[0].clientX - dragStartX);
                translateY = lastTY + (e.touches[0].clientY - dragStartY);
                updateTransform();
            }
        }, { passive: false });

        imgEl.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                isDragging = false;
                // 轻扫翻页 (仅在 scale <= 1 时)
                if (scale <= 1 && touchStartX) {
                    const diffX = (e.changedTouches[0]?.clientX || 0) - touchStartX;
                    if (Math.abs(diffX) > 60) {
                        navigate(diffX > 0 ? -1 : 1);
                    }
                }
                touchStartX = 0;
                touchStartY = 0;
            }
        });

        function getTouchDist(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        return { open: openLightbox, close: closeLightbox };
    }
})();
