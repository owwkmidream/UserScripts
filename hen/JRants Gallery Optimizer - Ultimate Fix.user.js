// ==UserScript==
// @name         JRants Ultimate: Meta Info Restored (v6.7)
// @namespace    http://tampermonkey.net/
// @version      6.7
// @description  恢复首页发布时间/分类信息 + 详情页完美画廊 + 强力去广告
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
    // 1. CSS 重构
    // =================================================================
    const css = `
        /* ::::: 全局设定 ::::: */
        body { background-color: #1a1a1a !important; color: #ccc !important; overflow-x: hidden; }
        * { transition: none !important; animation: none !important; }
        
        /* ::::: 强力去广告 ::::: */
        .widget_custom_html, .widget_text, .code-block, .addtoany_content, 
        ins, iframe, div[id*="zone"], .wpp-widget-placeholder, 
        script + div[style*="z-index"], div[class*="ai-viewports"], .ai-insert-1 {
            display: none !important;
        }

        /* ::::: 首页 & 分类页布局 (Grid + Meta信息) ::::: */
        
        /* 容器 Grid 化 */
        .generate-columns-container, .masonry-container {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)) !important;
            gap: 20px !important; width: 100% !important; height: auto !important;
            position: static !important; margin: 0 !important; padding: 20px 0 !important; float: none !important;
        }
        
        /* 标题/按钮跨行 */
        .generate-columns-container > .page-header, .tm-page-divider, .tm-load-more-btn {
            grid-column: 1 / -1 !important; width: 100% !important; position: static !important;
            margin: 0 0 20px 0 !important; clear: both !important;
        }
        .page-header h1 {
            text-align: center; font-size: 28px !important; color: #fff !important;
            border-bottom: 2px solid #5dade2; padding-bottom: 10px; display: block !important;
        }

        /* 卡片重构 */
        .generate-columns-container .post {
            position: static !important; top: auto !important; left: auto !important; transform: none !important;
            width: auto !important; height: 100% !important; margin: 0 !important;
            display: flex !important; flex-direction: column !important;
            background: #252525 !important; border: 1px solid #333; border-radius: 6px; box-shadow: none !important;
        }
        
        /* 确保卡片内部内容也是 Flex 上下排列 */
        .generate-columns-container .inside-article {
            display: flex !important; flex-direction: column !important;
            height: 100% !important; padding: 0 !important;
        }

        /* 图片 */
        .post-image { margin: 0 !important; width: 100% !important; aspect-ratio: 2/3 !important; order: 1; }
        .post-image img { width: 100% !important; height: 100% !important; object-fit: cover !important; }

        /* 标题 */
        .entry-header { 
            padding: 10px 12px 5px 12px !important; 
            order: 2; 
        }
        .entry-title { 
            font-size: 14px !important; margin: 0 !important; 
            line-height: 1.4 !important; font-weight: bold !important; 
        }
        .entry-title a { color: #eee !important; }

        /* 恢复：发布日期 (Meta) */
        .entry-meta {
            display: block !important; /* 恢复显示 */
            order: 3;
            padding: 0 12px !important;
            font-size: 12px !important;
            color: #888 !important;
            margin-bottom: 5px !important;
        }
        
        /* 恢复：分类/标签 (Footer Meta) */
        footer.entry-meta {
            display: block !important; /* 恢复显示 */
            order: 4;
            padding: 8px 12px 12px 12px !important;
            font-size: 11px !important;
            color: #666 !important;
            border-top: 1px solid #333;
            margin-top: auto !important; /* 强制推到底部 */
        }
        footer.entry-meta a, .entry-meta a { color: #888 !important; }
        footer.entry-meta a:hover { color: #5dade2 !important; }

        /* 仅隐藏摘要 */
        .entry-summary, .paging-navigation { display: none !important; }


        /* ::::: 详情页布局 (Single Post) ::::: */
        .site-content { display: flex !important; flex-direction: column !important; }
        #primary { width: 100% !important; max-width: 1400px !important; margin: 0 auto !important; float: none !important; }
        .entry-content { display: block !important; padding: 0 !important; margin: 0 !important; }
        
        /* 画廊保护 */
        #MustUnique-Gallery {
            display: block !important; visibility: visible !important; opacity: 1 !important;
            background: #222; padding: 15px; border-radius: 8px; margin-bottom: 30px; border: 1px solid #333;
        }
        .tm-gallery-img { display: block !important; opacity: 1 !important; }

        /* 侧边栏下沉 */
        #right-sidebar, .is-right-sidebar {
            width: 100% !important; float: none !important;
            margin-top: 50px !important; border-top: 1px solid #333; padding-top: 30px !important;
        }
        .sidebar .widget { background: transparent !important; margin-bottom: 30px !important; }
        .sidebar .widget-title { color: #fff !important; font-size: 18px !important; border-left: 4px solid #5dade2; padding-left: 10px; margin-bottom: 15px; }

        /* 热门推荐 Grid */
        ul.wpp-list { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important; gap: 15px !important; }
        ul.wpp-list li { display: flex !important; flex-direction: column !important; background: #252525 !important; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
        ul.wpp-list li img { width: 100% !important; height: 240px !important; object-fit: cover !important; }
        ul.wpp-list li a.wpp-post-title { display: block !important; padding: 10px !important; font-size: 13px !important; color: #ccc !important; }
        .wpp-stats { display: none !important; }

        /* ::::: 画廊 UI ::::: */
        .tm-gallery-controls { display: flex; justify-content: space-between; margin-bottom: 15px; color: #888; font-size: 13px; }
        .tm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tm-col-width, 220px), 1fr)); gap: 10px; }
        .tm-item { position: relative; aspect-ratio: 2/3; background: #000; cursor: pointer; border-radius: 4px; overflow: hidden; border: 1px solid #333; }
        .tm-item img { width: 100%; height: 100%; object-fit: cover; opacity: 1; }
        .tm-page-tag { position: absolute; bottom: 0; right: 0; background: rgba(0,0,0,0.6); color: #fff; font-size: 11px; padding: 2px 6px; }
        
        /* 灯箱 */
        #tm-lightbox { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.98); z-index: 999999; display: none; }
        #tm-lightbox.active { display: flex; }
        .tm-lb-stage { width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
        .tm-lb-img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .tm-lb-close { position: absolute; top: 20px; right: 20px; font-size: 30px; color: #fff; cursor: pointer; z-index: 100; }
        .tm-lb-nav { position: absolute; top: 0; height: 100%; width: 100px; display: flex; align-items: center; justify-content: center; font-size: 50px; color: #555; cursor: pointer; }
        .tm-lb-nav:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .tm-lb-prev { left: 0; } .tm-lb-next { right: 0; }
        
        /* 首页加载按钮 */
        .tm-load-more-btn {
            display: block; margin: 30px auto !important; padding: 12px 30px;
            background: #333; color: #fff !important; text-align: center;
            border-radius: 4px; cursor: pointer; font-size: 16px; border: 1px solid #444;
        }
        .tm-load-more-btn:hover { background: #5dade2; border-color: #5dade2; }
        
        .tm-page-divider {
            grid-column: 1 / -1 !important; display: flex; align-items: center; justify-content: center;
            margin: 40px 0 20px 0 !important; color: #5dade2; font-size: 16px; font-weight: bold;
            text-transform: uppercase; letter-spacing: 1px; width: 100%;
        }
        .tm-page-divider::before, .tm-page-divider::after { content: ""; flex: 1; height: 1px; background: #333; margin: 0 20px; }
        
        @media (max-width: 768px) { .generate-columns-container, ul.wpp-list { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; } }
    `;
    GM_addStyle(css);


    // =================================================================
    // 2. 逻辑 (Logic)
    // =================================================================
    
    const STATE = {
        isInitialized: false,
        galleryMap: new Map(),
        totalImages: [],
        currentPage: 1,
        colWidth: parseInt(localStorage.getItem('tm_col_width')) || 240,
        lightbox: { active: false, index: 0 }
    };
    const DOM = { grid: null, lightboxImg: null };

    // --- DOM 清理 ---
    function cleanLayout() {
        const sidebar = document.getElementById('right-sidebar');
        const mainContainer = document.querySelector('.site-content');
        if (sidebar && mainContainer) mainContainer.appendChild(sidebar);

        const gridContainer = document.querySelector('.generate-columns-container');
        if (gridContainer) {
            gridContainer.removeAttribute('style');
            gridContainer.querySelectorAll('.post').forEach(post => post.removeAttribute('style'));
        }
        
        document.querySelectorAll('.widget_custom_html, .code-block, ins, iframe, .addtoany_content').forEach(el => el.remove());
    }

    // --- 详情页：删除原图 ---
    function purgeOriginalImages() {
        const content = document.querySelector('.entry-content');
        if (content) {
            content.querySelectorAll('img:not(.tm-gallery-img)').forEach(img => {
                const p = img.parentElement;
                if(p && p.tagName === 'A') p.remove();
                else img.remove();
            });
            content.querySelectorAll('p').forEach(p => {
                if (!p.innerText.trim() && p.querySelectorAll('img').length === 0) p.remove();
            });
            content.querySelectorAll('br').forEach(br => br.remove());
        }
    }

    // --- 首页功能 ---
    const HOME_STATE = { nextPageUrl: null, loading: false, container: null, pageNum: 1 };
    function initHome() {
        const container = document.querySelector('.generate-columns-container');
        if (!container) return;
        HOME_STATE.container = container;
        const findNext = (doc) => {
            const link = doc.querySelector('.nav-links .next, a.next.page-numbers');
            HOME_STATE.nextPageUrl = link ? link.href : null;
        };
        findNext(document);
        if (HOME_STATE.nextPageUrl) {
            const btn = document.createElement('div');
            btn.className = 'tm-load-more-btn';
            btn.textContent = 'Load More Images';
            container.appendChild(btn); 
            btn.onclick = async () => {
                if (HOME_STATE.loading || !HOME_STATE.nextPageUrl) return;
                btn.textContent = 'Loading...';
                HOME_STATE.loading = true;
                try {
                    const res = await fetch(HOME_STATE.nextPageUrl);
                    const html = await res.text();
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    HOME_STATE.pageNum++;
                    const divider = document.createElement('div');
                    divider.className = 'tm-page-divider';
                    divider.textContent = `Page ${HOME_STATE.pageNum}`;
                    container.insertBefore(divider, btn);
                    const posts = doc.querySelectorAll('.generate-columns-container .post');
                    posts.forEach(p => {
                        p.removeAttribute('style');
                        const img = p.querySelector('img');
                        if(img && img.dataset.src) img.src = img.dataset.src;
                        container.insertBefore(p, btn); 
                    });
                    findNext(doc);
                    if (HOME_STATE.nextPageUrl) btn.textContent = 'Load More Images';
                    else { btn.textContent = 'End of Content'; btn.style.display = 'none'; }
                } catch(e) { btn.textContent = 'Error'; }
                HOME_STATE.loading = false;
            };
        }
    }

    // --- 详情页画廊 ---
    function resolveUrl(url) {
        if (!url) return null;
        try { return new URL(url, location.href).href; } catch(e){ return null; }
    }

    function extractAndBuild() {
        const content = document.querySelector('.entry-content');
        if (!content) return false;
        
        const imgs = content.querySelectorAll('img');
        const list = [];
        const seen = new Set();

        imgs.forEach(img => {
            if (img.closest('.wpp-list')) return; 
            if (img.classList.contains('tm-gallery-img')) return;
            if (img.naturalWidth > 0 && img.naturalWidth < 150) return;
            
            let src = img.getAttribute('data-original') || img.getAttribute('data-src') || img.src;
            const parent = img.parentElement;
            if (parent && parent.tagName === 'A' && /\.(jpg|png|webp)/i.test(parent.href)) src = parent.href;
            src = resolveUrl(src);
            
            if (src && !seen.has(src)) { seen.add(src); list.push({ src, thumb: img.src || src, page: 1 }); }
        });

        if (list.length === 0) return false;

        STATE.totalImages = list;
        STATE.galleryMap.set(1, list);

        const gallery = document.createElement('div');
        gallery.id = 'MustUnique-Gallery';
        gallery.innerHTML = `<div class="tm-gallery-controls"><span>Gallery: ${list.length}</span><input type="range" min="150" max="500" step="10" value="${STATE.colWidth}" id="tm-size-slider"></div><div class="tm-grid" style="--tm-col-width: ${STATE.colWidth}px"></div>`;
        const frag = document.createDocumentFragment();
        list.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'tm-item';
            div.innerHTML = `<img src="${item.thumb}" class="tm-gallery-img" loading="lazy" referrerpolicy="no-referrer">`;
            div.onclick = () => openLightbox(i);
            frag.appendChild(div);
        });
        gallery.querySelector('.tm-grid').appendChild(frag);
        content.insertBefore(gallery, content.firstChild);
        gallery.querySelector('#tm-size-slider').addEventListener('input', (e) => {
            STATE.colWidth = e.target.value;
            gallery.querySelector('.tm-grid').style.setProperty('--tm-col-width', `${STATE.colWidth}px`);
            localStorage.setItem('tm_col_width', STATE.colWidth);
        });
        
        return true;
    }

    async function checkPagination() {
        const links = document.querySelectorAll('.page-numbers');
        let max = 1;
        links.forEach(a => { const m = a.href.match(/\/(\d+)\/?$/); if(m && parseInt(m[1]) > max) max = parseInt(m[1]); });
        if (max > 1) {
            let baseUrl = location.href.split('?')[0].replace(/\/(\d+)\/?$/, '');
            const queue = [];
            for(let i=2; i<=max; i++) queue.push({p: i, url: `${baseUrl}/${i}`});
            const tasks = queue.map(t => fetch(t.url).then(r=>r.text()).then(html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const newImgs = []; 
                doc.querySelectorAll('.entry-content img').forEach(img => {
                    let src = img.getAttribute('data-original') || img.src;
                    if(img.parentElement.tagName === 'A') src = img.parentElement.href;
                    if(src && src.match(/\.(jpg|png|webp)/)) newImgs.push({src, thumb: src, page: t.p});
                });
                STATE.galleryMap.set(t.p, newImgs);
                appendImages(newImgs);
            }).catch(e=>{}));
            await Promise.all(tasks);
        }
    }

    function appendImages(list) {
        const grid = document.querySelector('.tm-grid');
        if(!grid) return;
        const startIdx = STATE.totalImages.length;
        STATE.totalImages = STATE.totalImages.concat(list);
        const frag = document.createDocumentFragment();
        list.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'tm-item';
            div.innerHTML = `<img src="${item.thumb}" class="tm-gallery-img" loading="lazy" referrerpolicy="no-referrer"><span class="tm-page-tag">P${item.page}</span>`;
            div.onclick = () => openLightbox(startIdx + i);
            frag.appendChild(div);
        });
        grid.appendChild(frag);
    }

    function initLightbox() {
        const lb = document.createElement('div');
        lb.id = 'tm-lightbox';
        lb.innerHTML = `<div class="tm-lb-close">×</div><div class="tm-lb-nav tm-lb-prev">‹</div><div class="tm-lb-stage"><img class="tm-lb-img" src="" draggable="false"></div><div class="tm-lb-nav tm-lb-next">›</div>`;
        document.body.appendChild(lb);
        DOM.lightboxImg = lb.querySelector('img');
        const close = () => { lb.classList.remove('active'); };
        const nav = (d) => { let n = STATE.lightbox.index + d; if(n < 0) n = STATE.totalImages.length - 1; if(n >= STATE.totalImages.length) n = 0; openLightbox(n); };
        lb.querySelector('.tm-lb-close').onclick = close;
        lb.onclick = (e) => { if (e.target === lb || e.target.classList.contains('tm-lb-stage')) close(); };
        document.addEventListener('keydown', e => { if(!lb.classList.contains('active')) return; if(e.key === 'Escape') close(); if(e.key === 'ArrowLeft') nav(-1); if(e.key === 'ArrowRight') nav(1); });
        lb.querySelector('.tm-lb-prev').onclick = (e) => { e.stopPropagation(); nav(-1); };
        lb.querySelector('.tm-lb-next').onclick = (e) => { e.stopPropagation(); nav(1); };
    }

    function openLightbox(idx) {
        STATE.lightbox.index = idx;
        DOM.lightboxImg.src = STATE.totalImages[idx].src;
        document.getElementById('tm-lightbox').classList.add('active');
    }

    function init() {
        if (STATE.isInitialized) return;
        document.body.classList.remove('masonry-enabled');
        cleanLayout(); 

        if (document.querySelector('.generate-columns-container')) {
            initHome();
            STATE.isInitialized = true;
        } else {
            const content = document.querySelector('.entry-content');
            if (content && content.querySelector('img')) {
                STATE.isInitialized = true;
                const success = extractAndBuild();
                if (success) {
                    initLightbox();
                    checkPagination();
                    setTimeout(purgeOriginalImages, 100);
                }
            }
        }
    }
    
    setInterval(cleanLayout, 1000);

    if(document.readyState !== 'loading') setTimeout(init, 50);
    else document.addEventListener('DOMContentLoaded', () => setTimeout(init, 50));

})();