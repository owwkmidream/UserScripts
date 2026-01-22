// ==UserScript==
// @name         JKF 极致画廊 (V5.8 UI可调版)
// @namespace    http://tampermonkey.net/
// @version      5.8
// @description  修复 CSS 误杀问题，新增列数调节滑块，支持自动记忆布局偏好。
// @author       FrontendArchitect
// @match        *://jkforum.net/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=jkforum.net
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 0. 启动检查
    if (!/thread-\d+-\d+/.test(location.href)) return;
    console.log('✨ JKF Gallery V5.7: UI Adjustable + SPA Support');

    const debugDot = document.createElement('div');
    debugDot.style.cssText = 'position:fixed; bottom:5px; left:5px; width:6px; height:6px; background:red; border-radius:50%; z-index:999999; pointer-events:none; opacity:0.5;';
    document.body.appendChild(debugDot);

    // ==========================================
    // 1. 配置
    // ==========================================
    const CONFIG = {
        containerSel: '.jkf-editor-viewer, .content-dom, #thread-main .content',
        checkSel: 'img:not(.avatar)',
        minImageSize: 100,
        defaultSize: 180 // 默认图片宽度
    };

    const STYLES = `
        /* 嵌入容器 */
        #jkf-embedded-gallery {
            width: 100%; box-sizing: border-box;
            background: #fff; border: 2px solid #ea4c89; border-radius: 8px;
            padding: 15px; margin: 20px 0;
            box-shadow: 0 4px 15px rgba(234, 76, 137, 0.1);
            position: relative; z-index: 10;
        }
        html.dark #jkf-embedded-gallery { background: #222; border-color: #555; }

        .g-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 15px; padding-bottom: 10px;
            border-bottom: 1px solid #eee;
            font-size: 14px; color: #ea4c89; font-weight: bold;
        }

        /* 控制区样式 */
        .g-controls { display: flex; align-items: center; gap: 10px; font-weight: normal; color: #666; font-size: 12px; }
        .g-slider { cursor: pointer; accent-color: #ea4c89; width: 100px; }

        /* 网格系统 - 使用 CSS 变量控制宽度 */
        .g-grid {
            display: grid;
            /* 核心：列宽由变量控制 */
            grid-template-columns: repeat(auto-fill, minmax(var(--g-col-width, 180px), 1fr));
            gap: 8px;
        }

        .g-card {
            position: relative; aspect-ratio: 1/1; background: #eee;
            border-radius: 4px; overflow: hidden; cursor: zoom-in;
            transition: 0.2s;
        }
        .g-card:hover { transform: scale(1.02); z-index: 2; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }

        .g-card img {
            width: 100%; height: 100%; object-fit: cover;
            opacity: 1 !important; display: block !important; background: #f0f0f0;
        }

        .g-idx { position: absolute; bottom: 0; right: 0; background: rgba(0,0,0,0.7); color: #fff; font-size: 10px; padding: 2px 5px; }

        img.jkf-origin-hidden { display: none !important; }
        ${CONFIG.containerSel} iframe, ${CONFIG.containerSel} .adsbygoogle { display: none !important; }

        /* 灯箱 */
        #jkf-lb { position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 999999; display: flex; opacity: 0; pointer-events: none; transition: 0.2s; touch-action: none; }
        #jkf-lb.active { opacity: 1; pointer-events: auto; }
        .lb-img { max-width: 100%; max-height: 100%; margin: auto; user-select: none; transform-origin: center; will-change: transform; }
        .lb-nav { position: absolute; top: 50%; transform: translateY(-50%); padding: 20px; font-size: 40px; color: #fff; cursor: pointer; background: transparent; border: none; z-index: 10; }
        .lb-prev { left: 10px; } .lb-next { right: 10px; }
        .lb-close { position: absolute; top: 20px; right: 20px; font-size: 30px; color: #fff; cursor: pointer; background: none; border: none; z-index: 10; }
    `;

    let globalImages = [];
    let isRunning = false;
    let checkTimer = null;
    let mutationObserver = null;
    let currentUrl = location.href;

    // ==========================================
    // 2. 清理函数
    // ==========================================
    function cleanup() {
        if (checkTimer) {
            clearInterval(checkTimer);
            checkTimer = null;
        }
        const oldGallery = document.getElementById('jkf-embedded-gallery');
        if (oldGallery) {
            oldGallery.remove();
        }
        const oldLightbox = document.getElementById('jkf-lb');
        if (oldLightbox) {
            oldLightbox.remove();
        }
        globalImages = [];
        isRunning = false;
        debugDot.style.background = 'red';
    }

    // ==========================================
    // 3. 暴力轮询
    // ==========================================
    function startHeartbeat() {
        let attempts = 0;
        checkTimer = setInterval(() => {
            attempts++;
            const container = document.querySelector(CONFIG.containerSel);
            if (container && container.querySelectorAll(CONFIG.checkSel).length > 0) {
                console.log('✅ Content Detected');
                clearInterval(checkTimer);
                debugDot.style.background = '#bada55';
                init(container);
            }
            if (attempts > 60) { clearInterval(checkTimer); debugDot.style.background = 'gray'; }
        }, 500);
    }

    // ==========================================
    // 4. MutationObserver - 监听 SPA 页面变化
    // ==========================================
    function startMutationObserver() {
        mutationObserver = new MutationObserver((mutations) => {
            // 检查 URL 是否变化
            if (location.href !== currentUrl) {
                console.log('🔄 URL Changed:', currentUrl, '->', location.href);
                currentUrl = location.href;

                // 清理旧实例
                cleanup();

                // 如果新页面是帖子页,重新初始化
                if (/thread-\d+-\d+/.test(location.href)) {
                    console.log('✨ Reinitializing Gallery for new thread...');
                    setTimeout(() => startHeartbeat(), 300);
                }
            }
        });

        // 监听 body 的子树变化
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log('👀 MutationObserver started');
    }

    // ==========================================
    // 3. 主程序
    // ==========================================
    function init(targetNode) {
        if (isRunning) return;
        isRunning = true;
        GM_addStyle(STYLES);

        // 读取历史设置
        const savedSize = localStorage.getItem('jkf-gallery-size') || CONFIG.defaultSize;

        const gallery = document.createElement('div');
        gallery.id = 'jkf-embedded-gallery';
        gallery.innerHTML = `
            <div class="g-header">
                <div>
                    <span id="g-status">加载中...</span>
                    <span id="g-count" style="margin-left:10px; background:#ea4c89; color:white; padding:2px 6px; border-radius:4px; font-size:12px;">0 P</span>
                </div>
                <div class="g-controls">
                    <span title="向左更密，向右更大">🔍 布局调节</span>
                    <input type="range" class="g-slider" min="100" max="400" step="10" value="${savedSize}">
                </div>
            </div>
            <div class="g-grid" id="g-grid" style="--g-col-width: ${savedSize}px"></div>
        `;
        targetNode.insertBefore(gallery, targetNode.firstChild);

        // 绑定滑块事件
        const slider = gallery.querySelector('.g-slider');
        const grid = gallery.querySelector('#g-grid');
        slider.oninput = (e) => {
            const val = e.target.value;
            grid.style.setProperty('--g-col-width', val + 'px');
            localStorage.setItem('jkf-gallery-size', val);
        };

        const { tid, totalPages } = parsePageInfo();
        processImages(tid, totalPages, targetNode);
        initLightbox();
    }

    function parsePageInfo() {
        const match = location.href.match(/thread-(\d+)-(\d+)-/);
        const tid = match ? match[1] : '0';
        let maxPage = 1;
        document.querySelectorAll('a, button').forEach(el => {
            const txt = el.innerText.trim();
            if (/^\d+$/.test(txt)) {
                const n = parseInt(txt);
                if (n > maxPage && n < 500) maxPage = n;
            }
        });
        return { tid, totalPages: maxPage };
    }

    async function processImages(tid, totalPages, currentDom) {
        const statusEl = document.getElementById('g-status');
        const countEl = document.getElementById('g-count');
        const pageMap = new Map();
        const currPageMatch = location.href.match(/thread-\d+-(\d+)-/);
        const currPageNum = currPageMatch ? parseInt(currPageMatch[1]) : 1;
        const promises = [];

        for (let i = 1; i <= totalPages; i++) {
            if (i === currPageNum) {
                promises.push(new Promise(resolve => {
                    pageMap.set(i, extractFromDom(currentDom, true));
                    statusEl.innerText = `读取第 ${i} 页...`;
                    resolve();
                }));
            } else {
                const url = `https://jkforum.net/thread-${tid}-${i}-1.html`;
                promises.push(
                    fetch(url).then(r => r.text()).then(html => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');
                        const container = doc.querySelector(CONFIG.containerSel);
                        pageMap.set(i, container ? extractFromDom(container, false) : []);
                        statusEl.innerText = `已获取第 ${i} 页...`;
                    }).catch(() => pageMap.set(i, []))
                );
            }
        }

        await Promise.all(promises);

        globalImages = [];
        let idx = 1;
        for (let i = 1; i <= totalPages; i++) {
            const list = pageMap.get(i) || [];
            list.forEach(img => {
                img.index = idx++;
                globalImages.push(img);
            });
        }

        statusEl.innerText = `画廊模式 (${totalPages} 页)`;
        countEl.innerText = `${globalImages.length} P`;
        render(globalImages);
    }

    function extractFromDom(root, shouldHideOriginals) {
        const arr = [];
        const imgs = root.querySelectorAll('img:not([src*="avatar"]):not([src*="smiley"])');

        imgs.forEach(img => {
            if (img.width > 0 && img.width < CONFIG.minImageSize) return;

            let src = img.getAttribute('zoomfile') || img.getAttribute('file') || img.getAttribute('data-src') || img.src;
            if (src && src.startsWith('/')) src = location.origin + src;

            const link = img.closest('a');
            let big = src;
            if (link && /\.(jpg|png|jpeg|webp)$/i.test(link.href)) big = link.href;

            if (src) {
                arr.push({ thumb: src, src: big });
                if (shouldHideOriginals) img.classList.add('jkf-origin-hidden');
            }
        });
        return arr;
    }

    function render(images) {
        const grid = document.getElementById('g-grid');
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();

        images.forEach((img, i) => {
            const d = document.createElement('div');
            d.className = 'g-card';
            d.innerHTML = `<img src="${img.thumb}" loading="lazy" referrerpolicy="no-referrer"><span class="g-idx">${img.index}</span>`;
            d.onclick = () => openLb(i);
            frag.appendChild(d);
        });
        grid.appendChild(frag);
    }

    // ==========================================
    // 4. 旗舰级灯箱引擎 (Ultimate Lightbox)
    // ==========================================
    let lbIdx = 0;
    const lbState = {
        scale: 1,
        translateX: 0,
        translateY: 0,
        isDragging: false,
        startX: 0,
        startY: 0
    };

    function initLightbox() {
        const lb = document.createElement('div');
        lb.id = 'jkf-lb';
        lb.innerHTML = `
            <button class="lb-close">×</button>
            <button class="lb-nav lb-prev">❮</button>
            <img class="lb-img" draggable="false">
            <button class="lb-nav lb-next">❯</button>
        `;
        document.body.appendChild(lb);

        const img = lb.querySelector('.lb-img');

        // 更新变换
        const updateTransform = () => {
            img.style.transform = `translate(${lbState.translateX}px, ${lbState.translateY}px) scale(${lbState.scale})`;
        };

        // 重置变换
        const resetTransform = () => {
            lbState.scale = 1;
            lbState.translateX = 0;
            lbState.translateY = 0;
            updateTransform();
        };

        lb.querySelector('.lb-close').onclick = closeLb;
        lb.querySelector('.lb-prev').onclick = (e) => { e.stopPropagation(); changeLb(-1); };
        lb.querySelector('.lb-next').onclick = (e) => { e.stopPropagation(); changeLb(1); };
        lb.onclick = (e) => { if (e.target === lb) closeLb(); };

        document.addEventListener('keydown', e => {
            if (!lb.classList.contains('active')) return;
            if (e.key === 'Escape') closeLb();
            if (e.key === 'ArrowLeft') changeLb(-1);
            if (e.key === 'ArrowRight') changeLb(1);
        });

        // 滚轮缩放 - 以鼠标指针为中心
        lb.addEventListener('wheel', e => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newScale = Math.max(1, Math.min(5, lbState.scale + delta));

            // 以鼠标位置为中心缩放
            const rect = img.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const scaleRatio = newScale / lbState.scale;

            lbState.translateX = e.clientX - (e.clientX - lbState.translateX - centerX) * scaleRatio - centerX;
            lbState.translateY = e.clientY - (e.clientY - lbState.translateY - centerY) * scaleRatio - centerY;
            lbState.scale = newScale;
            updateTransform();
        }, { passive: false });

        // 鼠标拖拽平移
        img.addEventListener('mousedown', (e) => {
            if (lbState.scale <= 1) return;
            e.preventDefault();
            lbState.isDragging = true;
            lbState.startX = e.clientX - lbState.translateX;
            lbState.startY = e.clientY - lbState.translateY;
            img.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!lbState.isDragging) return;
            e.preventDefault();
            lbState.translateX = e.clientX - lbState.startX;
            lbState.translateY = e.clientY - lbState.startY;
            updateTransform();
        });

        document.addEventListener('mouseup', () => {
            if (lbState.isDragging) {
                lbState.isDragging = false;
                img.style.cursor = 'grab';
            }
        });

        // 双击复位/放大toggle
        img.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (lbState.scale > 1) {
                resetTransform();
            } else {
                lbState.scale = 2;
                updateTransform();
            }
        });

        // 移动端双指捏合缩放
        let touchStartDist = 0;
        let touchStartScale = 1;
        let touch1StartX = 0, touch1StartY = 0;
        let isTouchZooming = false;

        lb.addEventListener('touchstart', (e) => {
            if (!lb.classList.contains('active')) return;
            if (e.touches.length === 2) {
                e.preventDefault();
                isTouchZooming = true;
                const t1 = e.touches[0], t2 = e.touches[1];
                touchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                touchStartScale = lbState.scale;
            } else if (e.touches.length === 1 && lbState.scale > 1) {
                e.preventDefault();
                const t = e.touches[0];
                touch1StartX = t.clientX - lbState.translateX;
                touch1StartY = t.clientY - lbState.translateY;
            }
        }, { passive: false });

        lb.addEventListener('touchmove', (e) => {
            if (!lb.classList.contains('active')) return;
            if (e.touches.length === 2 && isTouchZooming) {
                e.preventDefault();
                const t1 = e.touches[0], t2 = e.touches[1];
                const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                lbState.scale = Math.max(0.5, Math.min(5, touchStartScale * (currentDist / touchStartDist)));
                updateTransform();
            } else if (e.touches.length === 1 && lbState.scale > 1) {
                e.preventDefault();
                const t = e.touches[0];
                lbState.translateX = t.clientX - touch1StartX;
                lbState.translateY = t.clientY - touch1StartY;
                updateTransform();
            }
        }, { passive: false });

        lb.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) isTouchZooming = false;
        });

        // 移动端双击检测
        let lastTapTime = 0;
        img.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTapTime < 300) {
                e.preventDefault();
                if (lbState.scale > 1) resetTransform();
                else { lbState.scale = 2; updateTransform(); }
            }
            lastTapTime = now;
        });
    }

    function openLb(i) {
        lbIdx = i;
        const lb = document.getElementById('jkf-lb');
        // 重置缩放和位置
        lbState.scale = 1;
        lbState.translateX = 0;
        lbState.translateY = 0;
        document.querySelector('.lb-img').style.transform = 'scale(1)';
        updateLb();
        lb.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLb() {
        document.getElementById('jkf-lb').classList.remove('active');
        document.body.style.overflow = '';
    }

    function changeLb(dir) {
        lbIdx = (lbIdx + dir + globalImages.length) % globalImages.length;
        // 切换图片时重置缩放
        lbState.scale = 1;
        lbState.translateX = 0;
        lbState.translateY = 0;
        document.querySelector('.lb-img').style.transform = 'scale(1)';
        updateLb();
    }

    function updateLb() {
        const item = globalImages[lbIdx];
        const img = document.querySelector('.lb-img');
        img.src = item.src;
    }

    // ==========================================
    // 启动
    // ==========================================
    // 首次加载时启动心跳检测
    startHeartbeat();
    // 启动 MutationObserver 监听 SPA 页面变化
    startMutationObserver();

})();