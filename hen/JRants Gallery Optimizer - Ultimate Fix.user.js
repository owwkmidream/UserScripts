// ==UserScript==
// @name         JRants Ultimate: Gallery Fix & Clean (v7.3 Stable)
// @namespace    http://tampermonkey.net/
// @version      7.3
// @description  修复画廊消失问题 + 彻底隐藏分页器 + 智能清理空白
// @author       Optimizer
// @match        https://jrants.com/*
// @match        https://*.jrants.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=jrants.com
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================
    // 1. CSS 样式层
    // =================================================================
    const css = `
        /* ::::: 全局设定 ::::: */
        body { background-color: #1a1a1a !important; color: #ccc !important; overflow-x: hidden; }
        * { transition: none !important; animation: none !important; }

        /* ::::: 核心：强力去广告 & 隐藏分页器 & 隐藏原图 ::::: */
        .widget_custom_html, .widget_text, .code-block, .addtoany_content,
        ins, iframe, div[id*="zone"], .wpp-widget-placeholder,
        script + div[style*="z-index"], div[class*="ai-viewports"], .ai-insert-1,
        /* 隐藏分页器 */
        .page-links, .post-page-numbers, .pgntn-page-pagination, .pagination, .nav-links,
        /* 隐藏原图容器（由JS辅助控制，这里做兜底） */
        .entry-content img:not(.tm-gallery-img) {
            display: none !important;
        }

        /* ::::: 首页布局 ::::: */
        .generate-columns-container {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)) !important;
            gap: 20px !important; width: 100% !important; margin: 0 !important; padding: 20px 0 !important;
        }
        .generate-columns-container > .page-header, .tm-page-divider, .tm-load-more-btn {
            grid-column: 1 / -1 !important; width: 100% !important; margin: 20px 0 !important;
        }
        .generate-columns-container .post {
            background: #252525 !important; border: 1px solid #333; border-radius: 6px;
            display: flex !important; flex-direction: column !important; height: auto !important; margin: 0 !important;
        }
        .post-image img { width: 100% !important; aspect-ratio: 2/3 !important; object-fit: cover !important; }
        .entry-header { padding: 10px !important; order: 2; }
        .entry-meta, footer.entry-meta { padding: 0 10px 10px 10px !important; font-size: 12px !important; color: #888 !important; }
        .entry-title { font-size: 14px !important; line-height: 1.4 !important; margin: 0 !important; }
        .entry-title a { color: #eee !important; }

        /* ::::: 详情页布局 ::::: */
        .site-content { display: flex !important; flex-direction: column !important; }
        #primary { width: 100% !important; max-width: 1400px !important; margin: 0 auto !important; }
        #right-sidebar { width: 100% !important; margin-top: 50px !important; border-top: 1px solid #333; padding-top: 30px !important; }

        /* ::::: 画廊 UI ::::: */
        #MustUnique-Gallery {
            background: #222; padding: 15px; border-radius: 8px; margin-bottom: 30px; border: 1px solid #333;
            min-height: 300px; /* 防止高度塌陷 */
        }
        .tm-gallery-controls { display: flex; justify-content: space-between; margin-bottom: 15px; color: #888; font-size: 13px; align-items: center; }
        .tm-status-text { color: #5dade2; font-weight: bold; }
        .tm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tm-col-width, 240px), 1fr)); gap: 10px; }
        .tm-item { position: relative; aspect-ratio: auto; background: #000; cursor: pointer; border-radius: 4px; overflow: hidden; border: 1px solid #333; }
        .tm-item img { width: 100%; height: auto; display: block; opacity: 1; min-height: 200px; object-fit: cover; }
        .tm-page-tag { position: absolute; bottom: 0; right: 0; background: rgba(0,0,0,0.7); color: #fff; font-size: 10px; padding: 2px 6px; z-index: 2; }

        /* 灯箱 */
        #tm-lightbox { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.98); z-index: 999999; display: none; }
        #tm-lightbox.active { display: flex; }
        .tm-lb-stage { width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
        .tm-lb-img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .tm-lb-close { position: absolute; top: 20px; right: 20px; font-size: 30px; color: #fff; cursor: pointer; z-index: 100; }
        .tm-lb-nav { position: absolute; top: 0; height: 100%; width: 100px; display: flex; align-items: center; justify-content: center; font-size: 50px; color: #555; cursor: pointer; user-select: none; }
        .tm-lb-nav:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .tm-lb-prev { left: 0; } .tm-lb-next { right: 0; }

        /* 首页加载按钮 */
        .tm-load-more-btn { display: block; margin: 30px auto !important; padding: 12px 30px; background: #333; color: #fff !important; text-align: center; border-radius: 4px; cursor: pointer; }
        .tm-load-more-btn:hover { background: #5dade2; }
        .tm-page-divider { grid-column: 1 / -1 !important; display: flex; align-items: center; justify-content: center; margin: 40px 0 20px 0 !important; color: #5dade2; font-weight: bold; }
        .tm-page-divider::before, .tm-page-divider::after { content: ""; flex: 1; height: 1px; background: #333; margin: 0 20px; }
    `;
    GM_addStyle(css);

    // =================================================================
    // 2. 逻辑控制 (Logic)
    // =================================================================

    const STATE = {
        isInitialized: false,
        totalImages: [],
        colWidth: parseInt(localStorage.getItem('tm_col_width')) || 240,
        lightbox: { active: false, index: 0 }
    };
    const DOM = { galleryGrid: null, status: null, lightboxImg: null };

    // --- 工具：清理布局 ---
    function cleanLayout() {
        const sidebar = document.getElementById('right-sidebar');
        const mainContainer = document.querySelector('.site-content');
        if (sidebar && mainContainer && sidebar.parentNode !== mainContainer) {
            mainContainer.appendChild(sidebar);
        }
        document.querySelectorAll('.widget_custom_html, .code-block, ins, iframe, .addtoany_content').forEach(el => el.remove());
    }

    // --- 工具：获取高清图链接 ---
    function getHighResSrc(img) {
        let src = '';
        const parent = img.parentElement;
        if (parent && parent.tagName === 'A' && /\.(jpg|jpeg|png|webp)/i.test(parent.href)) {
            src = parent.href;
        } else {
            src = img.getAttribute('data-original') ||
                  img.getAttribute('data-src') ||
                  img.getAttribute('data-lazy-src') ||
                  img.src;
        }
        try { return new URL(src, location.href).href; } catch(e){ return null; }
    }

    // --- 详情页：安全清理原图 (修复重点) ---
    function purgeOriginalImages() {
        const content = document.querySelector('.entry-content');
        if (content) {
            content.querySelectorAll('img:not(.tm-gallery-img)').forEach(img => {
                // 1. 隐藏图片本身
                img.style.display = 'none';

                // 2. 隐藏包裹图片的 P, A, FIGURE 标签
                // 千万不要隐藏 DIV，因为这可能选中 entry-content 导致全文消失
                const wrapper = img.closest('p, figure, a');
                if (wrapper) wrapper.style.display = 'none';

                // 3. 处理 br
                const br = img.nextElementSibling;
                if(br && br.tagName === 'BR') br.style.display = 'none';
            });

            // 4. 清理残留的空 P 标签
            content.querySelectorAll('p').forEach(p => {
                if (!p.innerText.trim() && p.children.length === 0) p.style.display = 'none';
            });
        }
    }

    // --- 首页：无限翻页 ---
    const HOME = { url: null, loading: false };
    function initHome() {
        const container = document.querySelector('.generate-columns-container');
        if (!container) return;

        const updateNextUrl = (doc) => {
            const link = doc.querySelector('a.next.page-numbers, .nav-links .next');
            HOME.url = link ? link.href : null;
        };
        updateNextUrl(document);

        if (HOME.url) {
            const btn = document.createElement('div');
            btn.className = 'tm-load-more-btn';
            btn.textContent = 'Load Next Page';
            container.parentNode.appendChild(btn);

            btn.onclick = async () => {
                if (HOME.loading || !HOME.url) return;
                btn.textContent = 'Loading...';
                HOME.loading = true;
                try {
                    const res = await fetch(HOME.url);
                    const html = await res.text();
                    const doc = new DOMParser().parseFromString(html, 'text/html');

                    const pageNum = HOME.url.match(/page\/(\d+)/) ? HOME.url.match(/page\/(\d+)/)[1] : 'Next';
                    const divider = document.createElement('div');
                    divider.className = 'tm-page-divider';
                    divider.textContent = `Page ${pageNum}`;
                    container.appendChild(divider);

                    const posts = doc.querySelectorAll('.generate-columns-container .post');
                    posts.forEach(p => {
                        const img = p.querySelector('img');
                        if(img && (img.dataset.src || img.dataset.original)) {
                            img.src = img.dataset.src || img.dataset.original;
                        }
                        container.appendChild(p);
                    });

                    updateNextUrl(doc);
                    if (HOME.url) btn.textContent = 'Load Next Page';
                    else btn.style.display = 'none';
                } catch(e) { console.error(e); btn.textContent = 'Load Failed'; }
                HOME.loading = false;
            };
        }
    }

    // --- 详情页：画廊引擎 ---
    async function initGallery() {
        const content = document.querySelector('.entry-content');
        if (!content) return;

        // 1. 建立画廊容器
        const gallery = document.createElement('div');
        gallery.id = 'MustUnique-Gallery';
        gallery.innerHTML = `
            <div class="tm-gallery-controls">
                <div>Images: <span id="tm-count" class="tm-status-text">0</span> <span id="tm-status" style="font-size:11px; margin-left:10px;">Init...</span></div>
                <input type="range" min="150" max="600" step="10" value="${STATE.colWidth}" id="tm-size-slider">
            </div>
            <div class="tm-grid" style="--tm-col-width: ${STATE.colWidth}px"></div>
        `;
        // 插入到 content 的最前面
        content.prepend(gallery);

        DOM.galleryGrid = gallery.querySelector('.tm-grid');
        DOM.status = gallery.querySelector('#tm-status');

        // 滑块控制
        gallery.querySelector('#tm-size-slider').addEventListener('input', (e) => {
            STATE.colWidth = e.target.value;
            DOM.galleryGrid.style.setProperty('--tm-col-width', `${STATE.colWidth}px`);
            localStorage.setItem('tm_col_width', STATE.colWidth);
        });

        // 2. 提取第一页
        extractFromDoc(document, 1);
        DOM.status.innerText = "Page 1 Loaded";

        // 3. 检测多页
        const pageLinks = document.querySelectorAll('a.post-page-numbers');
        let maxPage = 1;
        let baseUrl = location.href.split('?')[0].replace(/\/(\d+)\/?$/, ''); // 移除结尾页码
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

        pageLinks.forEach(link => {
            const num = parseInt(link.innerText);
            if (!isNaN(num) && num > maxPage) maxPage = num;
        });

        // 4. 后台抓取
        if (maxPage > 1) {
            DOM.status.innerText = `Fetching ${maxPage - 1} pages...`;
            const urls = [];
            for (let i = 2; i <= maxPage; i++) {
                urls.push({ page: i, url: `${baseUrl}/${i}` });
            }

            await Promise.all(urls.map(item =>
                fetch(item.url)
                .then(r => r.text())
                .then(html => {
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    extractFromDoc(doc, item.page);
                })
                .catch(e => console.log('Fetch error', e))
            ));

            DOM.status.innerText = "All Pages Merged";
            sortAndRebuildGrid();
        } else {
            DOM.status.innerText = "";
        }

        // 5. 初始化灯箱并清理
        initLightbox();
        // 延迟执行清理，确保原图被画廊替换后再隐藏，防止页面跳动太厉害
        setTimeout(purgeOriginalImages, 100);
        // 定时器再次清理，防止动态加载的内容复活
        setTimeout(purgeOriginalImages, 2000);
    }

    function extractFromDoc(doc, pageNum) {
        const images = doc.querySelectorAll('.entry-content img');
        const newItems = [];

        images.forEach(img => {
            if (img.classList.contains('tm-gallery-img')) return;
            if (img.closest('.wpp-list')) return; // 排除侧边栏

            const src = getHighResSrc(img);
            if (src) {
                // 简单去重
                const exists = STATE.totalImages.find(x => x.src === src);
                if (!exists) {
                    const item = { src: src, thumb: src, page: pageNum };
                    STATE.totalImages.push(item);
                    newItems.push(item);
                }
            }
        });

        if (pageNum === 1) {
            appendImagesToGrid(newItems);
            updateCount();
        }
    }

    function appendImagesToGrid(list) {
        const frag = document.createDocumentFragment();
        list.forEach(item => {
            const div = document.createElement('div');
            div.className = 'tm-item';
            div.innerHTML = `
                <img src="${item.thumb}" class="tm-gallery-img" loading="lazy" referrerpolicy="no-referrer">
                <span class="tm-page-tag">P${item.page}</span>
            `;
            div.onclick = () => {
                // 实时查找索引，因为 totalImages 可能会重新排序
                const realIndex = STATE.totalImages.findIndex(x => x.src === item.src);
                openLightbox(realIndex);
            };
            frag.appendChild(div);
        });
        DOM.galleryGrid.appendChild(frag);
    }

    function sortAndRebuildGrid() {
        STATE.totalImages.sort((a, b) => a.page - b.page);
        DOM.galleryGrid.innerHTML = ''; // 这里最关键，清空旧的乱序 DOM
        appendImagesToGrid(STATE.totalImages);
        updateCount();
    }

    function updateCount() {
        const countSpan = document.getElementById('tm-count');
        if (countSpan) countSpan.innerText = STATE.totalImages.length;
    }

    // --- 灯箱逻辑 ---
    function initLightbox() {
        if(document.getElementById('tm-lightbox')) return;
        const lb = document.createElement('div');
        lb.id = 'tm-lightbox';
        lb.innerHTML = `<div class="tm-lb-close">×</div><div class="tm-lb-nav tm-lb-prev">‹</div><div class="tm-lb-stage"><img class="tm-lb-img" src="" draggable="false"></div><div class="tm-lb-nav tm-lb-next">›</div>`;
        document.body.appendChild(lb);
        DOM.lightboxImg = lb.querySelector('img');

        const close = () => lb.classList.remove('active');
        const nav = (dir) => {
            let nextIdx = STATE.lightbox.index + dir;
            if (nextIdx < 0) nextIdx = STATE.totalImages.length - 1;
            if (nextIdx >= STATE.totalImages.length) nextIdx = 0;
            openLightbox(nextIdx);
        };

        lb.querySelector('.tm-lb-close').onclick = close;
        lb.onclick = (e) => { if (e.target === lb || e.target.classList.contains('tm-lb-stage')) close(); };

        document.addEventListener('keydown', e => {
            if (!lb.classList.contains('active')) return;
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowLeft' || e.key === 'a') nav(-1);
            if (e.key === 'ArrowRight' || e.key === 'd') nav(1);
        });

        lb.querySelector('.tm-lb-prev').onclick = (e) => { e.stopPropagation(); nav(-1); };
        lb.querySelector('.tm-lb-next').onclick = (e) => { e.stopPropagation(); nav(1); };
    }

    function openLightbox(idx) {
        if (idx < 0 || idx >= STATE.totalImages.length) return;
        STATE.lightbox.index = idx;
        const imgObj = STATE.totalImages[idx];
        DOM.lightboxImg.src = imgObj.src;
        document.getElementById('tm-lightbox').classList.add('active');
    }

    // =================================================================
    // 3. 入口函数
    // =================================================================
    function init() {
        if (STATE.isInitialized) return;

        cleanLayout();
        setInterval(cleanLayout, 3000); // 低频清理

        if (document.querySelector('.generate-columns-container')) {
            initHome();
            STATE.isInitialized = true;
        } else if (document.querySelector('.entry-content')) {
            STATE.isInitialized = true;
            initGallery();
        }
    }

    if(document.readyState !== 'loading') setTimeout(init, 50);
    else document.addEventListener('DOMContentLoaded', () => setTimeout(init, 50));

})();