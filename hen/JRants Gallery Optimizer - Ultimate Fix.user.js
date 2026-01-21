// ==UserScript==
// @name         JRants Gallery Optimizer - Ultimate Fix
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  暴力提取所有分页图片：自动抓取分页链接、重构网格、无缝灯箱
// @author       You
// @match        https://jrants.com/*
// @match        https://*.jrants.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=jrants.com
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================
    // 配置与状态
    // =================================================================
    const CONFIG = {
        // 你的源码里图片在 .entry-content 下，分页也在其中
        // 我们需要精确找到图片，排除掉广告小图
        imgSelector: '.entry-content img',
        // 匹配所有可能的分页链接类名
        pageLinkSelector: 'a.post-page-numbers, a.page-numbers, .page-links a, .pgntn-page-pagination a'
    };

    const state = {
        images: [],
        currentIndex: 0,
        scale: 1,
        panning: false,
        pointX: 0,
        pointY: 0,
        startX: 0,
        startY: 0
    };

    const dom = {
        grid: null,
        lightbox: null,
        lightboxImg: null,
        loadingTip: null
    };

    // =================================================================
    // 1. 样式注入 (保持暗黑风格)
    // =================================================================
    function injectStyles() {
        const css = `
            /* 清理原页面干扰元素 */
            .entry-content > * { display: none !important; }
            .entry-content > #tm-gallery-grid { display: grid !important; }
            .page-links, .pgntn-page-pagination, .nav-links { display: none !important; }

            /* 网格容器 */
            #tm-gallery-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                gap: 12px;
                padding: 15px;
                background: #1a1a1a;
                margin: 20px 0;
                border-radius: 8px;
                min-height: 300px;
            }
            @media (max-width: 768px) {
                #tm-gallery-grid {
                    grid-template-columns: repeat(2, 1fr);
                    gap: 6px;
                    padding: 6px;
                }
            }

            /* 网格项 */
            .tm-grid-item {
                position: relative;
                aspect-ratio: 2/3;
                background: #000;
                border-radius: 4px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .tm-grid-item:hover {
                transform: scale(1.03);
                box-shadow: 0 5px 15px rgba(0,0,0,0.5);
                z-index: 5;
            }
            .tm-grid-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
                opacity: 0;
                animation: tmFadeIn 0.5s forwards;
            }
            @keyframes tmFadeIn { to { opacity: 1; } }

            /* 底部页码指示器 (显示在灯箱) */
            .tm-grid-index {
                position: absolute; bottom: 0; right: 0;
                background: rgba(0,0,0,0.6); color: #fff;
                font-size: 10px; padding: 2px 6px;
                pointer-events: none;
            }

            /* 悬浮进度条 */
            #tm-loading-tip {
                position: fixed; bottom: 20px; right: 20px;
                background: rgba(33, 150, 243, 0.9);
                color: #fff; padding: 8px 16px;
                border-radius: 4px; font-size: 13px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                z-index: 99999; pointer-events: none;
                transition: opacity 0.5s;
            }

            /* 灯箱 (Lightbox) */
            #tm-lightbox {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.95);
                z-index: 200000; display: flex;
                opacity: 0; pointer-events: none;
                transition: opacity 0.25s;
            }
            #tm-lightbox.active { opacity: 1; pointer-events: auto; }

            .tm-lb-container {
                width: 100%; height: 100%;
                display: flex; justify-content: center; align-items: center;
                overflow: hidden;
            }
            #tm-lb-img {
                max-width: 100%; max-height: 100%;
                object-fit: contain;
                user-select: none;
                transform-origin: center;
                will-change: transform;
                cursor: grab;
            }
            #tm-lb-img.grabbing { cursor: grabbing; }

            /* 按钮 */
            .tm-btn {
                position: absolute; width: 50px; height: 50px;
                background: rgba(255,255,255,0.1); border-radius: 50%;
                display: flex; justify-content: center; align-items: center;
                color: #fff; font-size: 24px; cursor: pointer;
                transition: background 0.2s; user-select: none;
                z-index: 200001;
            }
            .tm-btn:hover { background: rgba(255,255,255,0.3); }
            .tm-close { top: 20px; right: 20px; }
            .tm-prev { left: 20px; top: 50%; transform: translateY(-50%); }
            .tm-next { right: 20px; top: 50%; transform: translateY(-50%); }
            .tm-counter {
                position: absolute; bottom: 20px; left: 50%;
                transform: translateX(-50%);
                color: #ddd; font-size: 14px;
                background: rgba(0,0,0,0.5); padding: 4px 12px; border-radius: 12px;
            }
        `;
        GM_addStyle(css);
    }

    // =================================================================
    // 2. 核心逻辑：数据提取与网格渲染
    // =================================================================

    function createGridSystem() {
        // 找到文章内容容器
        const contentDiv = document.querySelector('.entry-content');
        if (!contentDiv) {
            console.error('[JRants] Content container not found!');
            return;
        }

        // 创建网格容器
        dom.grid = document.createElement('div');
        dom.grid.id = 'tm-gallery-grid';
        contentDiv.appendChild(dom.grid); // 追加到最后

        // 创建加载提示
        dom.loadingTip = document.createElement('div');
        dom.loadingTip.id = 'tm-loading-tip';
        dom.loadingTip.textContent = 'Scanner Ready...';
        document.body.appendChild(dom.loadingTip);
    }

    // 提取图片的核心函数
    function extractImagesFromDOM(doc, sourceUrl = '') {
        const rawImgs = doc.querySelectorAll(CONFIG.imgSelector);
        const newImages = [];

        rawImgs.forEach(img => {
            // 过滤：排除小图、广告图、GIF占位图
            if (img.src.includes('300x500.gif')) return;
            if (img.width > 0 && img.width < 150) return; // 忽略小图标

            let highRes = img.src;

            // 尝试找父级链接（通常父级链接是原图）
            const parentLink = img.closest('a');
            if (parentLink && /\.(jpg|jpeg|png|webp)$/i.test(parentLink.href)) {
                highRes = parentLink.href;
            }

            // 去重检查
            if (!state.images.find(i => i.src === highRes)) {
                const item = {
                    thumb: img.src,
                    src: highRes,
                    title: `Page data from ${sourceUrl}`
                };
                newImages.push(item);
                state.images.push(item);
            }
        });
        return newImages;
    }

    function renderImages(imgList) {
        if (!imgList || imgList.length === 0) return;

        const fragment = document.createDocumentFragment();
        // 计算起始索引，因为 imgList 是追加的
        const startIndex = state.images.length - imgList.length;

        imgList.forEach((img, i) => {
            const globalIndex = startIndex + i;
            const div = document.createElement('div');
            div.className = 'tm-grid-item';
            div.innerHTML = `
                <img src="${img.thumb}" loading="lazy" />
                <span class="tm-grid-index">${globalIndex + 1}</span>
            `;
            div.onclick = (e) => {
                e.stopPropagation();
                openLightbox(globalIndex);
            };
            fragment.appendChild(div);
        });
        dom.grid.appendChild(fragment);
    }

    // =================================================================
    // 3. 终极分页抓取逻辑
    // =================================================================
    async function startPaginationEngine() {
        console.log('[JRants] Starting Pagination Engine...');

        // 1. 先把当前页面的图片拿出来渲染
        const initialImages = extractImagesFromDOM(document, 'Current Page');
        renderImages(initialImages);

        // 2. 搜集所有需要抓取的 URL
        const urlsToFetch = new Set();

        // A. 抓取页面上现有的分页链接
        const links = document.querySelectorAll(CONFIG.pageLinkSelector);
        links.forEach(a => {
            if (a.href) urlsToFetch.add(a.href);
        });

        // B. 智能推导第1页链接 (如果你当前在第2页，页面上可能只有第1页的链接，没有第2页的链接)
        // 比如当前是 ...html/2，那 ...html 肯定是第1页
        const currentUrl = window.location.href.split('?')[0]; // 去除参数

        // 尝试解析 BaseURL
        let baseUrl = currentUrl;
        const pageMatch = currentUrl.match(/(.*?\.html)\/(\d+)$/);

        if (pageMatch) {
            // 当前是分页 (e.g. ...html/2)
            baseUrl = pageMatch[1]; // 获取 ...html
            // 把 BaseURL (第1页) 加入队列
            urlsToFetch.add(baseUrl);
        } else {
            // 当前是第1页 (...html)
            baseUrl = currentUrl;
        }

        // C. 如果页面上扫描到了数字最大的页码，确保中间的页码也被加入
        // 例如页面上只有 [1] ... [4]，我们需要补全 [2], [3]
        let maxPage = 1;
        urlsToFetch.forEach(u => {
            const m = u.match(/\/(\d+)\/?$/);
            if (m) {
                const p = parseInt(m[1]);
                if (p > maxPage) maxPage = p;
            }
        });

        // 如果我们发现了第4页，那就循环生成 2,3,4 的链接
        if (maxPage > 1) {
            for (let i = 2; i <= maxPage; i++) {
                urlsToFetch.add(`${baseUrl}/${i}`);
            }
        }

        // D. 移除当前页面的链接 (不用重复抓取)
        // 注意处理末尾斜杠
        const normalize = u => u.replace(/\/$/, '');
        const currentNorm = normalize(currentUrl);

        const finalQueue = Array.from(urlsToFetch).filter(u => normalize(u) !== currentNorm);

        console.log(`[JRants] Found ${finalQueue.length} other pages to load:`, finalQueue);
        dom.loadingTip.textContent = `Found ${finalQueue.length} extra pages...`;

        if (finalQueue.length === 0) {
            dom.loadingTip.textContent = `Loaded ${state.images.length} images (Single Page)`;
            setTimeout(() => dom.loadingTip.style.opacity = 0, 2000);
            return;
        }

        // 3. 并发抓取
        let loadedCount = 0;

        // 定义抓取函数
        const fetchPage = async (url) => {
            try {
                const response = await fetch(url);
                const text = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                const newImgs = extractImagesFromDOM(doc, url);
                if (newImgs.length > 0) {
                    renderImages(newImgs);
                    loadedCount += newImgs.length;
                    dom.loadingTip.textContent = `Loaded +${loadedCount} images...`;
                }
            } catch (err) {
                console.error(`[JRants] Failed to load ${url}`, err);
            }
        };

        // 执行所有请求
        await Promise.all(finalQueue.map(url => fetchPage(url)));

        dom.loadingTip.textContent = `Done! Total ${state.images.length} images.`;
        setTimeout(() => dom.loadingTip.style.opacity = 0, 3000);
    }

    // =================================================================
    // 4. 灯箱与全能手势 (Zoom/Pan)
    // =================================================================
    function buildLightbox() {
        dom.lightbox = document.createElement('div');
        dom.lightbox.id = 'tm-lightbox';
        dom.lightbox.innerHTML = `
            <div class="tm-lb-container">
                <img id="tm-lb-img" draggable="false" />
            </div>
            <div class="tm-btn tm-close">×</div>
            <div class="tm-btn tm-prev">‹</div>
            <div class="tm-btn tm-next">›</div>
            <div class="tm-counter"></div>
        `;
        document.body.appendChild(dom.lightbox);

        dom.lightboxImg = document.getElementById('tm-lb-img');

        // 绑定按钮事件
        dom.lightbox.querySelector('.tm-close').onclick = closeLightbox;
        dom.lightbox.querySelector('.tm-prev').onclick = e => { e.stopPropagation(); switchImage(-1); };
        dom.lightbox.querySelector('.tm-next').onclick = e => { e.stopPropagation(); switchImage(1); };

        // 点击背景关闭
        dom.lightbox.onclick = e => {
            if (e.target.id === 'tm-lightbox' || e.target.classList.contains('tm-lb-container')) {
                closeLightbox();
            }
        };

        // 键盘事件
        document.addEventListener('keydown', e => {
            if (!dom.lightbox.classList.contains('active')) return;
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') switchImage(-1);
            if (e.key === 'ArrowRight') switchImage(1);
        });

        initGestures();
    }

    function openLightbox(index) {
        state.currentIndex = index;
        updateImage();
        dom.lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        dom.lightbox.classList.remove('active');
        document.body.style.overflow = '';
        resetZoom();
    }

    function switchImage(dir) {
        const next = state.currentIndex + dir;
        if (next >= 0 && next < state.images.length) {
            state.currentIndex = next;
            updateImage();
        }
    }

    function updateImage() {
        resetZoom();
        const imgObj = state.images[state.currentIndex];
        dom.lightboxImg.src = imgObj.src;
        dom.lightbox.querySelector('.tm-counter').textContent = `${state.currentIndex + 1} / ${state.images.length}`;
    }

    // --- 手势核心逻辑 ---
    function updateTransform() {
        dom.lightboxImg.style.transform = `translate(${state.pointX}px, ${state.pointY}px) scale(${state.scale})`;
    }

    function resetZoom() {
        state.scale = 1; state.pointX = 0; state.pointY = 0;
        updateTransform();
        dom.lightboxImg.classList.remove('grabbing');
    }

    function initGestures() {
        const img = dom.lightboxImg;
        const container = dom.lightbox.querySelector('.tm-lb-container');

        // 1. 鼠标滚轮缩放
        container.addEventListener('wheel', e => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(1, Math.min(10, state.scale * delta)); // 限制 1x - 10x
            state.scale = newScale;
            if (state.scale === 1) { state.pointX = 0; state.pointY = 0; }
            updateTransform();
        }, { passive: false });

        // 2. 双击/双指 放大/还原
        let lastTap = 0;
        container.addEventListener('touchend', e => {
            const now = new Date().getTime();
            if (now - lastTap < 300 && e.changedTouches.length === 0) { // Double tap
                e.preventDefault();
                toggleZoom();
            }
            lastTap = now;
        });
        img.addEventListener('dblclick', e => {
            e.preventDefault();
            toggleZoom();
        });

        function toggleZoom() {
            state.scale = state.scale > 1 ? 1 : 2.5;
            if (state.scale === 1) { state.pointX = 0; state.pointY = 0; }
            updateTransform();
        }

        // 3. 拖拽 (鼠标 & 单指)
        let isDragging = false;

        const onStart = (x, y) => {
            if (state.scale <= 1) return;
            isDragging = true;
            state.startX = x - state.pointX;
            state.startY = y - state.pointY;
            img.classList.add('grabbing');
        };

        const onMove = (x, y) => {
            if (!isDragging) return;
            state.pointX = x - state.startX;
            state.pointY = y - state.startY;
            updateTransform();
        };

        const onEnd = () => {
            isDragging = false;
            img.classList.remove('grabbing');
        };

        // Mouse events
        img.addEventListener('mousedown', e => { e.preventDefault(); onStart(e.clientX, e.clientY); });
        window.addEventListener('mousemove', e => { if (isDragging) { e.preventDefault(); onMove(e.clientX, e.clientY); } });
        window.addEventListener('mouseup', onEnd);

        // Touch events (Pinch logic mixed in)
        let initialDist = 0;
        container.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                isDragging = false;
                initialDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            } else if (e.touches.length === 1) {
                onStart(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });

        container.addEventListener('touchmove', e => {
            e.preventDefault();
            if (e.touches.length === 2) {
                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                if (initialDist > 0) {
                    state.scale = Math.max(1, state.scale * (dist / initialDist));
                    updateTransform();
                }
                initialDist = dist;
            } else if (e.touches.length === 1) {
                onMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });

        container.addEventListener('touchend', onEnd);
    }

    // =================================================================
    // 启动
    // =================================================================
    function main() {
        injectStyles();
        createGridSystem();
        buildLightbox();
        startPaginationEngine();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();