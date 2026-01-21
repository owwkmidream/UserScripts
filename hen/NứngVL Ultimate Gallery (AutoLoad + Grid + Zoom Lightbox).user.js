// ==UserScript==
// @name         NứngVL Ultimate Gallery (AutoLoad + Grid + Zoom Lightbox)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  自动加载所有分页，Grid并排布局，内置支持“滚轮缩放/双指缩放/拖拽平移”的高级灯箱。
// @author       YourName
// @match        https://nungvl.net/gallerys/*
// @match        https://www.kaizty.com/photos/*
// @icon         https://nungvl.net/favicon.ico
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. CSS 样式 (增加了手势相关的样式)
    // ==========================================
    const css = `
        /* --- Grid 布局 --- */
        .contentme {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 10px; padding: 10px 0; text-align: left !important;
        }
        @media (max-width: 768px) {
            .contentme { grid-template-columns: repeat(2, 1fr); gap: 5px; }
        }
        .contentme a {
            display: block; position: relative; overflow: hidden;
            border-radius: 4px; background: #1a1a1a;
            aspect-ratio: 2 / 3; cursor: zoom-in;
        }
        .contentme img {
            width: 100%; height: 100%; object-fit: cover; display: block;
            transition: transform 0.3s ease;
        }
        .contentme a:hover img { transform: scale(1.05); }
        .contentme br, .contentme text { display: none !important; }

        /* --- 状态条 --- */
        #loading-status-bar {
            position: fixed; bottom: 20px; right: 20px;
            background: rgba(0, 94, 135, 0.9); color: #fff;
            padding: 8px 16px; border-radius: 20px; font-size: 12px;
            z-index: 9990; pointer-events: none; transition: opacity 0.5s;
        }

        /* --- 高级 Lightbox --- */
        #gm-lightbox {
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.98); z-index: 10000;
            user-select: none; overflow: hidden; /* 禁止溢出 */
            touch-action: none; /* 关键：禁止移动端浏览器默认滚动 */
        }
        #gm-lightbox.active { display: flex; justify-content: center; align-items: center; }

        /* 图片容器 */
        .gm-img-wrap {
            position: relative;
            width: 100%; height: 100%;
            display: flex; justify-content: center; align-items: center;
        }

        #gm-lb-img {
            max-width: 95vw; max-height: 95vh;
            object-fit: contain;
            transform-origin: center center;
            will-change: transform; /* 硬件加速 */
            cursor: grab;
        }
        #gm-lb-img:active { cursor: grabbing; }

        /* UI 控件 */
        .gm-lb-nav {
            position: absolute; top: 50%; transform: translateY(-50%);
            color: rgba(255,255,255,0.3); font-size: 60px;
            padding: 30px; cursor: pointer; z-index: 10010;
            transition: color 0.2s;
        }
        .gm-lb-nav:hover { color: #fff; background: rgba(0,0,0,0.2); }
        .gm-lb-prev { left: 0; }
        .gm-lb-next { right: 0; }

        .gm-lb-close {
            position: absolute; top: 20px; right: 30px;
            color: #ddd; font-size: 40px; cursor: pointer;
            z-index: 10020; text-shadow: 0 0 5px #000;
        }

        .gm-lb-counter {
            position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
            color: #aaa; font-size: 14px; z-index: 10010; pointer-events: none;
            background: rgba(0,0,0,0.5); padding: 5px 10px; border-radius: 10px;
        }
    `;

    if (typeof GM_addStyle !== "undefined") {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.innerText = css;
        document.head.appendChild(style);
    }

    // ==========================================
    // 2. Lightbox 核心逻辑 (含手势系统)
    // ==========================================
    const createLightbox = () => {
        const html = `
            <div id="gm-lightbox">
                <div class="gm-lb-close">&times;</div>
                <div class="gm-lb-nav gm-lb-prev">&#10094;</div>
                <div class="gm-lb-nav gm-lb-next">&#10095;</div>
                <div class="gm-img-wrap">
                    <img id="gm-lb-img" src="" draggable="false" />
                </div>
                <div class="gm-lb-counter">0 / 0</div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        const lb = document.getElementById('gm-lightbox');
        const img = document.getElementById('gm-lb-img');
        const counter = document.querySelector('.gm-lb-counter');

        let currentIndex = 0;
        let allLinks = [];

        // --- 变换状态 ---
        let transformState = {
            scale: 1,
            pX: 0, // Pan X
            pY: 0, // Pan Y
            isDragging: false,
            startX: 0,
            startY: 0
        };

        // --- 辅助函数 ---
        const getHighResUrl = (linkEl) => {
            const href = linkEl.getAttribute('href');
            try {
                const urlObj = new URL(href, window.location.origin);
                const realUrl = urlObj.searchParams.get('url');
                if (realUrl) return realUrl;
            } catch (e) {}
            return linkEl.querySelector('img') ? linkEl.querySelector('img').src : href;
        };

        const updateTransform = () => {
            img.style.transform = `translate(${transformState.pX}px, ${transformState.pY}px) scale(${transformState.scale})`;
        };

        const resetTransform = () => {
            transformState = { scale: 1, pX: 0, pY: 0, isDragging: false, startX: 0, startY: 0 };
            updateTransform();
        };

        const changeImage = (dir) => {
            currentIndex += dir;
            if (currentIndex < 0) currentIndex = allLinks.length - 1;
            if (currentIndex >= allLinks.length) currentIndex = 0;

            // 切换图片前重置缩放
            resetTransform();

            const link = allLinks[currentIndex];
            img.style.opacity = 0.5;
            img.src = getHighResUrl(link);
            img.onload = () => { img.style.opacity = 1; };
            counter.innerText = `${currentIndex + 1} / ${allLinks.length}`;
        };

        // --- 核心操作函数 ---
        window.openLightbox = (index, linksNodeList) => {
            allLinks = Array.from(linksNodeList);
            currentIndex = index;
            lb.classList.add('active');
            changeImage(0); // 加载当前索引
            document.body.style.overflow = 'hidden';
        };

        const closeLb = () => {
            lb.classList.remove('active');
            document.body.style.overflow = '';
            img.src = '';
            resetTransform();
        };

        // --- 事件绑定: 导航 ---
        lb.querySelector('.gm-lb-close').onclick = closeLb;
        lb.querySelector('.gm-lb-prev').onclick = (e) => { e.stopPropagation(); changeImage(-1); };
        lb.querySelector('.gm-lb-next').onclick = (e) => { e.stopPropagation(); changeImage(1); };

        // --- 事件绑定: 缩放与拖拽 ---

        // 1. 鼠标滚轮缩放
        lb.addEventListener('wheel', (e) => {
            if (!lb.classList.contains('active')) return;
            e.preventDefault();

            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            let newScale = transformState.scale * delta;

            // 限制缩放范围 (0.5x ~ 5x)
            newScale = Math.min(Math.max(newScale, 0.5), 5);

            transformState.scale = newScale;
            updateTransform();
        }, { passive: false });

        // 2. 鼠标拖拽平移
        img.addEventListener('mousedown', (e) => {
            if (transformState.scale <= 1) return; // 只有放大时才能拖
            e.preventDefault();
            transformState.isDragging = true;
            transformState.startX = e.clientX - transformState.pX;
            transformState.startY = e.clientY - transformState.pY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!transformState.isDragging) return;
            e.preventDefault();
            transformState.pX = e.clientX - transformState.startX;
            transformState.pY = e.clientY - transformState.startY;
            updateTransform();
        });

        window.addEventListener('mouseup', () => {
            transformState.isDragging = false;
        });

        // 3. 鼠标双击重置/放大
        img.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (transformState.scale !== 1) {
                resetTransform();
            } else {
                transformState.scale = 2; // 双击放大2倍
                updateTransform();
            }
        });

        // 4. 移动端触摸手势 (捏合 + 拖拽)
        let initialDist = 0;
        let initialScale = 1;

        lb.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                // 单指：准备拖拽
                if (transformState.scale > 1) {
                    transformState.isDragging = true;
                    transformState.startX = e.touches[0].clientX - transformState.pX;
                    transformState.startY = e.touches[0].clientY - transformState.pY;
                }
            } else if (e.touches.length === 2) {
                // 双指：准备缩放
                transformState.isDragging = false;
                initialDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                initialScale = transformState.scale;
            }
        }, { passive: false });

        lb.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && transformState.isDragging) {
                // 单指拖动
                e.preventDefault(); // 防止滚动页面
                transformState.pX = e.touches[0].clientX - transformState.startX;
                transformState.pY = e.touches[0].clientY - transformState.startY;
                updateTransform();
            } else if (e.touches.length === 2) {
                // 双指缩放
                e.preventDefault();
                const currentDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                const ratio = currentDist / initialDist;
                let newScale = initialScale * ratio;
                newScale = Math.min(Math.max(newScale, 0.5), 5); // 限制缩放
                transformState.scale = newScale;
                updateTransform();
            }
        }, { passive: false });

        lb.addEventListener('touchend', (e) => {
            transformState.isDragging = false;
            if (e.touches.length < 2) {
                initialDist = 0;
            }
        });

        // 5. 键盘事件
        document.addEventListener('keydown', (e) => {
            if (!lb.classList.contains('active')) return;
            if (e.key === 'Escape') closeLb();
            if (e.key === 'ArrowLeft') changeImage(-1);
            if (e.key === 'ArrowRight') changeImage(1);
        });

        // 点击背景关闭 (如果不在拖拽状态下)
        lb.onclick = (e) => {
            if (e.target === lb || e.target.classList.contains('gm-img-wrap')) {
                closeLb();
            }
        };
    };

    // ==========================================
    // 3. 主程序入口 (Grid + AutoLoad + Click Intercept)
    // ==========================================

    createLightbox();
    const contentContainer = document.querySelector('.contentme');
    if (!contentContainer) return;

    // 清理无用节点
    const cleanDOM = () => {
        let node = contentContainer.firstChild;
        while (node) {
            const next = node.nextSibling;
            if (node.nodeType === 3 || node.tagName === 'BR') {
                node.remove();
            }
            node = next;
        }
    };
    cleanDOM();

    // 拦截点击
    contentContainer.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && contentContainer.contains(link)) {
            e.preventDefault();
            const currentAllLinks = contentContainer.querySelectorAll('a');
            const index = Array.from(currentAllLinks).indexOf(link);
            window.openLightbox(index, currentAllLinks);
        }
    });

    // 自动加载逻辑
    const titleText = document.title;
    const pageMatch = titleText.match(/Page\s+(\d+)\/(\d+)/i);

    if (pageMatch) {
        const currentPage = parseInt(pageMatch[1], 10);
        const totalPages = parseInt(pageMatch[2], 10);

        if (currentPage < totalPages) {
            const statusLabel = document.createElement('div');
            statusLabel.id = 'loading-status-bar';
            statusLabel.innerText = `加载进度: ${currentPage}/${totalPages}`;
            document.body.appendChild(statusLabel);

            (async function autoLoad() {
                const baseUrl = window.location.pathname;
                const urlsToFetch = [];
                for (let i = currentPage + 1; i <= totalPages; i++) {
                    urlsToFetch.push(`${baseUrl}?page=${i}`);
                }

                try {
                    // 并发加载
                    const promises = urlsToFetch.map(url => fetch(url).then(r => r.text()));
                    const pagesHtml = await Promise.all(promises);
                    const parser = new DOMParser();

                    pagesHtml.forEach(html => {
                        const doc = parser.parseFromString(html, "text/html");
                        const newContainer = doc.querySelector('.contentme');
                        if (newContainer) {
                            const links = newContainer.querySelectorAll('a');
                            links.forEach(link => {
                                if (link.querySelector('img')) contentContainer.appendChild(link);
                            });
                        }
                    });

                    statusLabel.innerText = "全部图片加载完毕";
                    setTimeout(() => statusLabel.remove(), 2000);

                    // 隐藏原分页控件
                    const pagination = document.querySelector('.pagination-site');
                    if(pagination) pagination.style.display = 'none';
                    const pagContainer = document.querySelector('.pag');
                    if(pagContainer) pagContainer.style.display = 'none';

                } catch (e) {
                    statusLabel.innerText = "自动加载出错，请刷新";
                    statusLabel.style.background = "#a00";
                }
            })();
        }
    }
})();