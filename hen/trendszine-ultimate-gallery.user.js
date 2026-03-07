// ==UserScript==
// @name         TrendsZine Ultimate Gallery
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Feed grid takeover + infinite load, detail gallery merge + lightbox for trendszine.com
// @match        https://trendszine.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=trendszine.com
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const KEY_COL = 'tz_col_width';
    const STATE = {
        booted: false,
        scene: '',
        feedBusy: false,
        feedNextUrl: '',
        feedObserver: null,
        seenPosts: new Set(),
        galleryImages: [],
    };

    const CONFIG = {
        adSelectors: [
            '.ai-viewports', '.addtoany_content', '.code-block', '.wpp-widget-placeholder',
            '.wpp-list', '.wp-show-posts', '.sharedaddy', '.jp-relatedposts',
            'script[src*="magsrv"]', 'script[src*="jads"]', 'script[src*="clickadu"]',
            'iframe[src*="magsrv"]', 'iframe[src*="jads"]', 'iframe[src*="doubleclick"]', 'ins',
        ],
        adHostHints: ['magsrv', 'jads', 'clickadu', 'doubleclick', 'googlesyndication', 'addtoany'],
        minCol: 180,
        maxCol: 460,
    };

    const css = `
#tz-gallery-root, #tz-feed-footer, #tz-lightbox, #tz-media-wrap { all: initial; }
html[data-tz-ready="1"] .ai-viewports,
html[data-tz-ready="1"] .addtoany_content,
html[data-tz-ready="1"] .code-block,
html[data-tz-ready="1"] .wpp-widget-placeholder,
html[data-tz-ready="1"] .wpp-list,
html[data-tz-ready="1"] .wp-show-posts,
html[data-tz-ready="1"] .sharedaddy,
html[data-tz-ready="1"] .jp-relatedposts,
html[data-tz-ready="1"] .page-links,
html[data-tz-ready="1"] .post-page-numbers,
html[data-tz-ready="1"] .pgntn-page-pagination,
html[data-tz-ready="1"] .pagination,
html[data-tz-ready="1"] .nav-links { display: none !important; }

html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid {
  display: grid !important; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)) !important;
  gap: 16px !important; height: auto !important; width: 100% !important;
}
html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid > article.post {
  position: static !important; top: auto !important; left: auto !important; transform: none !important;
  width: auto !important; margin: 0 !important; display: flex !important; flex-direction: column !important;
  border: 1px solid rgba(255,255,255,.12) !important; border-radius: 12px !important; overflow: hidden !important;
  background: #141923 !important;
}
html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid > :not(article.post) { grid-column: 1 / -1 !important; }
html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid .inside-article { display: flex !important; flex-direction: column !important; height: 100% !important; }
html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid .post-image,
html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid .featured-image { aspect-ratio: 3/4 !important; margin: 0 !important; }
html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid .post-image img,
html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid .featured-image img { width: 100% !important; height: 100% !important; object-fit: cover !important; }
html[data-tz-ready="1"] #tz-feed-footer {
  display: flex !important; gap: 10px !important; align-items: center !important; justify-content: space-between !important;
  padding: 12px 14px !important; border: 1px dashed rgba(255,138,172,.6) !important; border-radius: 12px !important;
  background: rgba(255,255,255,.03) !important; color: #f6d4df !important; font: 13px/1.4 ui-sans-serif !important;
}
html[data-tz-ready="1"] #tz-feed-load {
  border: 0 !important; border-radius: 999px !important; padding: 8px 14px !important; cursor: pointer !important;
  background: linear-gradient(135deg,#ff8aac,#ff6f91) !important; color: #fff !important; font: 700 13px/1 ui-sans-serif !important;
}
html[data-tz-ready="1"] .tz-page-divider {
  grid-column: 1 / -1 !important; border-left: 4px solid #ff8aac !important; border-radius: 10px !important;
  background: rgba(255,138,172,.1) !important; color: #ffd8e6 !important; padding: 8px 12px !important;
  font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
}

html[data-tz-ready="1"] body.single-post .site,
html[data-tz-ready="1"] body.single-post .site-content,
html[data-tz-ready="1"] body.single-post .content-area,
html[data-tz-ready="1"] body.single-post .site-main,
html[data-tz-ready="1"] body.single-post .inside-article,
html[data-tz-ready="1"] body.single-post .entry-content { overflow: visible !important; }

html[data-tz-ready="1"] #tz-media-wrap {
  display: block !important; margin: 0 0 12px !important; padding: 12px !important;
  border-radius: 12px !important; background: rgba(255,255,255,.04) !important; color: #d8e1f3 !important;
}
html[data-tz-ready="1"] #tz-gallery-root {
  --tz-col-width: 260px; display: block !important; margin: 12px 0 0 !important;
  border: 2px solid #ff8aac !important; border-radius: 16px !important;
  background: linear-gradient(180deg, rgba(24,17,30,.95), rgba(12,11,18,.98)) !important;
}
html[data-tz-ready="1"] #tz-gallery-toolbar {
  display: flex !important; align-items: center !important; flex-wrap: wrap !important; gap: 10px !important;
  position: sticky !important; top: 4px !important; z-index: 50 !important;
  padding: 10px 12px !important; border-radius: 14px 14px 0 0 !important;
  background: linear-gradient(135deg, rgba(255,138,172,.94), rgba(197,68,118,.92)) !important; color: #fff !important;
  font: 13px/1.2 ui-sans-serif !important;
}
html[data-tz-ready="1"] #tz-gallery-grid {
  display: grid !important; grid-template-columns: repeat(auto-fill, minmax(var(--tz-col-width),1fr)) !important;
  gap: 12px !important; padding: 12px !important;
}
html[data-tz-ready="1"] .tz-card {
  position: relative !important; display: block !important; aspect-ratio: 3/4 !important;
  border-radius: 12px !important; overflow: hidden !important; cursor: zoom-in !important; background: #090b10 !important;
}
html[data-tz-ready="1"] .tz-card img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block !important; }
html[data-tz-ready="1"] .tz-badge {
  position: absolute !important; left: 8px !important; top: 8px !important;
  color: #fff !important; background: rgba(0,0,0,.55) !important; border-radius: 999px !important;
  padding: 3px 7px !important; font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
}

html[data-tz-ready="1"] #tz-lightbox {
  position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; display: none !important;
  background: rgba(0,0,0,.96) !important; touch-action: none !important;
}
html[data-tz-ready="1"] #tz-lightbox.tz-open { display: block !important; }
html[data-tz-ready="1"] .tz-lb-stage {
  position: absolute !important; inset: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important;
  padding: 52px 64px !important;
}
html[data-tz-ready="1"] .tz-lb-img {
  max-width: calc(100vw - 120px) !important; max-height: calc(100vh - 120px) !important;
  transform-origin: center center !important; touch-action: none !important; user-select: none !important;
}
html[data-tz-ready="1"] .tz-lb-btn, html[data-tz-ready="1"] .tz-lb-nav {
  position: absolute !important; z-index: 3 !important; border: 0 !important; color: #fff !important;
  background: rgba(255,255,255,.12) !important; border-radius: 999px !important; cursor: pointer !important;
}
html[data-tz-ready="1"] .tz-lb-btn { top: 14px !important; right: 14px !important; width: 40px !important; height: 40px !important; font-size: 25px !important; }
html[data-tz-ready="1"] .tz-lb-nav { top: 50% !important; margin-top: -22px !important; width: 44px !important; height: 44px !important; font-size: 28px !important; }
html[data-tz-ready="1"] .tz-lb-prev { left: 14px !important; }
html[data-tz-ready="1"] .tz-lb-next { right: 14px !important; }
html[data-tz-ready="1"] .tz-lb-counter {
  position: absolute !important; left: 50% !important; bottom: 14px !important; transform: translateX(-50%) !important;
  color: #fff !important; background: rgba(0,0,0,.5) !important; border-radius: 999px !important; padding: 7px 12px !important;
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
}
@media (max-width: 768px) {
  html[data-tz-ready="1"] .generate-columns-container.tz-feed-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
  html[data-tz-ready="1"] .tz-lb-stage { padding: 54px 10px 72px !important; }
  html[data-tz-ready="1"] .tz-lb-img { max-width: calc(100vw - 20px) !important; max-height: calc(100vh - 132px) !important; }
  html[data-tz-ready="1"] .tz-lb-nav { display: none !important; }
}
`;

    const addStyle = typeof GM_addStyle === 'function' ? GM_addStyle : (s) => {
        const el = document.createElement('style');
        el.textContent = s;
        (document.head || document.documentElement).appendChild(el);
    };

    document.documentElement.setAttribute('data-tz-ready', '1');
    addStyle(css);

    setInterval(() => main(), 1000);
    const mo = new MutationObserver(() => {
        purgeAds(document);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }

    function main() {
        purgeAds(document);
        if (isDetail()) initDetail();
        else initFeed();
    }

    function isDetail() {
        return !!(document.body?.classList.contains('single-post') && document.querySelector('article.post .entry-content'));
    }

    function initFeed() {
        const container = document.querySelector('.generate-columns-container');
        if (!(container instanceof HTMLElement)) return;
        if (container.dataset.tzFeedProcessed === '1') return;

        container.dataset.tzFeedProcessed = '1';
        STATE.scene = 'feed';
        container.classList.add('tz-feed-grid');
        normalizeFeedCards(container);
        collectSeen(container);
        STATE.feedNextUrl = getFeedNextUrl(document);
        injectFeedFooter(container);
    }

    function normalizeFeedCards(container) {
        removeInlineLayout(container);
        container.querySelectorAll('article.post, article.post *').forEach((el) => {
            if (el instanceof HTMLElement) removeInlineLayout(el);
        });
        container.querySelectorAll('article.post img').forEach((img) => {
            img.referrerPolicy = 'no-referrer';
            img.loading = 'lazy';
            img.decoding = 'async';
        });
    }

    function injectFeedFooter(container) {
        let footer = container.querySelector('#tz-feed-footer');
        if (!(footer instanceof HTMLElement)) {
            footer = document.createElement('div');
            footer.id = 'tz-feed-footer';
            footer.innerHTML = `<span id="tz-feed-status">Scroll to auto load</span>`;
            container.appendChild(footer);
        }

        if (STATE.feedObserver) {
            STATE.feedObserver.disconnect();
        }
        STATE.feedObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                loadNextFeedPage(container);
            }
        }, { root: null, rootMargin: '1200px 0px', threshold: 0 });
        STATE.feedObserver.observe(footer);

        updateFeedFooter(footer, STATE.feedNextUrl ? 'Auto load ready' : 'No next page');
    }

    async function loadNextFeedPage(container) {
        if (STATE.feedBusy || !STATE.feedNextUrl) return;
        STATE.feedBusy = true;
        const footer = container.querySelector('#tz-feed-footer');
        updateFeedFooter(footer, 'Loading...');
        try {
            const html = await fetch(STATE.feedNextUrl).then((r) => r.text());
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const next = doc.querySelector('.generate-columns-container');
            if (next instanceof HTMLElement) {
                const pageNo = getFeedPageNo(STATE.feedNextUrl);
                const frag = document.createDocumentFragment();
                const divider = document.createElement('div');
                divider.className = 'tz-page-divider';
                divider.textContent = `Page ${pageNo}`;
                frag.appendChild(divider);
                next.querySelectorAll('article.post').forEach((post) => {
                    const link = post.querySelector('h2.entry-title a, .entry-title a, .post-image a, .featured-image a');
                    const href = link instanceof HTMLAnchorElement ? norm(link.href) : '';
                    if (!href || STATE.seenPosts.has(href)) return;
                    STATE.seenPosts.add(href);
                    const clone = post.cloneNode(true);
                    if (clone instanceof HTMLElement) {
                        removeInlineLayout(clone);
                        clone.querySelectorAll('*').forEach((el) => { if (el instanceof HTMLElement) removeInlineLayout(el); });
                        clone.querySelectorAll('img').forEach((img) => {
                            img.referrerPolicy = 'no-referrer';
                            img.loading = 'lazy';
                        });
                        frag.appendChild(clone);
                    }
                });
                const oldFooter = container.querySelector('#tz-feed-footer');
                if (oldFooter) container.insertBefore(frag, oldFooter);
            }
            STATE.feedNextUrl = getFeedNextUrl(doc);
            updateFeedFooter(footer, STATE.feedNextUrl ? 'Merged' : 'Reached last page');
        } catch {
            updateFeedFooter(footer, 'Load failed');
        } finally {
            STATE.feedBusy = false;
        }
    }

    function collectSeen(container) {
        container.querySelectorAll('article.post').forEach((post) => {
            const link = post.querySelector('h2.entry-title a, .entry-title a, .post-image a, .featured-image a');
            if (link instanceof HTMLAnchorElement) STATE.seenPosts.add(norm(link.href));
        });
    }

    function getFeedNextUrl(scope) {
        const a = scope.querySelector('.nav-links .next.page-numbers, a.next.page-numbers, .paging-navigation a.next');
        return a instanceof HTMLAnchorElement ? norm(a.href) : '';
    }

    function getFeedPageNo(url) {
        const m = norm(url).match(/\/page\/(\d+)$/);
        return m ? parseInt(m[1], 10) : 2;
    }

    function updateFeedFooter(footer, msg) {
        if (!(footer instanceof HTMLElement)) return;
        const status = footer.querySelector('#tz-feed-status');
        if (status) status.textContent = msg;
    }

    async function initDetail() {
        const entry = document.querySelector('article.post .entry-content');
        if (!(entry instanceof HTMLElement)) return;
        if (entry.dataset.tzProcessed === '1' || entry.dataset.tzProcessed === 'pending') return;
        entry.dataset.tzProcessed = 'pending';
        STATE.scene = 'detail';

        try {
            const pageMap = getDetailPages(document);
            const ordered = new Map();
            const currentNo = detailPageNo(location.href);
            ordered.set(currentNo, extractImages(document));

            const tasks = [];
            for (const [no, url] of pageMap.entries()) {
                if (no === currentNo) continue;
                tasks.push(fetch(url).then((r) => r.text()).then((html) => [no, extractImages(new DOMParser().parseFromString(html, 'text/html'))]).catch(() => [no, []]));
            }
            const results = await Promise.all(tasks);
            results.forEach(([no, imgs]) => ordered.set(no, imgs));

            const merged = mergeOrdered(ordered);
            if (!merged.length) {
                entry.dataset.tzProcessed = '';
                return;
            }

            const mediaWrap = moveMedia(entry);
            renderGallery(entry, mediaWrap, merged, pageMap.size);
            safePurge(entry);
            entry.dataset.tzProcessed = '1';
        } catch {
            entry.dataset.tzProcessed = '';
        }
    }

    function getDetailPages(scope) {
        const base = detailBase(location.href);
        const map = new Map([[1, base]]);
        scope.querySelectorAll('a.post-page-numbers, .page-links a').forEach((a) => {
            if (!(a instanceof HTMLAnchorElement)) return;
            const url = norm(a.href);
            const n = detailPageNo(url, base);
            map.set(n, n === 1 ? base : `${base}/${n}`);
        });
        const maxN = Math.max(...Array.from(map.keys()));
        for (let i = 1; i <= maxN; i += 1) if (!map.has(i)) map.set(i, i === 1 ? base : `${base}/${i}`);
        return new Map([...map.entries()].sort((x, y) => x[0] - y[0]));
    }

    function extractImages(scope) {
        const entry = scope.querySelector('article.post .entry-content, .entry-content');
        if (!(entry instanceof HTMLElement)) return [];
        const seen = new Set();
        const list = [];
        entry.querySelectorAll('img').forEach((img, idx) => {
            if (img.closest('#tz-gallery-root, #tz-media-wrap')) return;
            if (img.closest('.ai-viewports, .addtoany_content, .code-block, .wpp-list, .wp-show-posts, .sharedaddy')) return;
            const src = highRes(img);
            if (!src || seen.has(src) || /\.gif($|[?#])/i.test(src)) return;
            seen.add(src);
            list.push({ src, alt: img.alt || '', order: idx + 1 });
        });
        return list;
    }

    function moveMedia(entry) {
        let wrap = entry.querySelector('#tz-media-wrap');
        if (!(wrap instanceof HTMLElement)) {
            wrap = document.createElement('section');
            wrap.id = 'tz-media-wrap';
            entry.insertBefore(wrap, entry.firstChild);
        }
        const nodes = Array.from(entry.children);
        nodes.forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            if (el.id === 'tz-media-wrap' || el.id === 'tz-gallery-root') return;
            if (isAd(el) || isPagination(el) || imageOnly(el)) return;
            if (el.querySelector('video,audio,iframe,table,pre,blockquote') || (el.textContent || '').trim()) wrap.appendChild(el);
        });
        return wrap;
    }

    function renderGallery(entry, mediaWrap, images, pageCount) {
        let root = entry.querySelector('#tz-gallery-root');
        if (!(root instanceof HTMLElement)) {
            root = document.createElement('section');
            root.id = 'tz-gallery-root';
            if (mediaWrap && mediaWrap.nextSibling) entry.insertBefore(root, mediaWrap.nextSibling);
            else entry.appendChild(root);
        }

        const col = clamp(parseInt(localStorage.getItem(KEY_COL) || '260', 10), CONFIG.minCol, CONFIG.maxCol);
        root.style.setProperty('--tz-col-width', `${col}px`);
        root.innerHTML = '';
        root.innerHTML = `<div id="tz-gallery-toolbar"><strong>Gallery</strong><span>${images.length} images · ${pageCount} pages</span><label style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">Width<input id="tz-col-slider" type="range" min="${CONFIG.minCol}" max="${CONFIG.maxCol}" step="10" value="${col}"><span id="tz-col-value">${col}px</span></label></div><div id="tz-gallery-grid"></div>`;

        const grid = root.querySelector('#tz-gallery-grid');
        if (!(grid instanceof HTMLElement)) return;

        const frag = document.createDocumentFragment();
        images.forEach((item, idx) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'tz-card';
            card.innerHTML = `<span class="tz-badge">${idx + 1}</span><img src="${item.src}" alt="${escapeHtml(item.alt || `Image ${idx + 1}`)}" loading="lazy" referrerpolicy="no-referrer">`;
            card.onclick = () => ensureLightbox().open(idx);
            frag.appendChild(card);
        });
        grid.appendChild(frag);

        const slider = root.querySelector('#tz-col-slider');
        const valueEl = root.querySelector('#tz-col-value');
        if (slider instanceof HTMLInputElement && valueEl) {
            slider.oninput = () => {
                const v = clamp(parseInt(slider.value, 10), CONFIG.minCol, CONFIG.maxCol);
                root.style.setProperty('--tz-col-width', `${v}px`);
                valueEl.textContent = `${v}px`;
                localStorage.setItem(KEY_COL, String(v));
            };
        }

        STATE.galleryImages = images;
        ensureLightbox().setItems(images);
    }

    function safePurge(entry) {
        entry.querySelectorAll('.ai-viewports,.addtoany_content,.code-block,.page-links,.post-page-numbers,.pgntn-page-pagination,.pagination,.nav-links').forEach((el) => hide(el));
        entry.querySelectorAll('img').forEach((img) => {
            if (img.closest('#tz-gallery-root,#tz-media-wrap')) return;
            const p = img.parentElement;
            if (p && /^(A|P|SPAN|FIGURE|DIV)$/i.test(p.tagName) && imageOnly(p)) hide(p);
            else hide(img);
            let s = img.nextElementSibling;
            while (s && s.tagName === 'BR') {
                hide(s);
                s = s.nextElementSibling;
            }
        });
    }

    function ensureLightbox() {
        let lb = document.getElementById('tz-lightbox');
        if (!lb) {
            lb = document.createElement('div');
            lb.id = 'tz-lightbox';
            lb.innerHTML = `<div class="tz-lb-stage"><img class="tz-lb-img" src="" alt="" draggable="false"></div><button class="tz-lb-btn" type="button" aria-label="Close">×</button><button class="tz-lb-nav tz-lb-prev" type="button" aria-label="Prev">‹</button><button class="tz-lb-nav tz-lb-next" type="button" aria-label="Next">›</button><div class="tz-lb-counter">0 / 0</div>`;
            document.body.appendChild(lb);
        }

        const img = lb.querySelector('.tz-lb-img');
        const counter = lb.querySelector('.tz-lb-counter');
        let items = [];
        let idx = 0;
        let scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0, ltx = 0, lty = 0, pinchDist = 0, pinchScale = 1, swipeX = 0, swipeY = 0;

        const apply = () => {
            if (img instanceof HTMLImageElement) img.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${scale})`;
        };
        const reset = () => { scale = 1; tx = 0; ty = 0; dragging = false; apply(); };
        const upd = () => {
            if (!(img instanceof HTMLImageElement)) return;
            if (!items.length) return;
            idx = ((idx % items.length) + items.length) % items.length;
            img.src = items[idx].src;
            img.alt = items[idx].alt || '';
            img.referrerPolicy = 'no-referrer';
            if (counter) counter.textContent = `${idx + 1} / ${items.length}`;
            reset();
        };

        const api = {
            setItems(next) { items = Array.isArray(next) ? next : []; if (counter) counter.textContent = items.length ? `1 / ${items.length}` : '0 / 0'; },
            open(i = 0) { if (!items.length) return; idx = i; lb.classList.add('tz-open'); document.body.style.overflow = 'hidden'; upd(); },
            close() { lb.classList.remove('tz-open'); document.body.style.overflow = ''; reset(); },
        };

        lb.querySelector('.tz-lb-btn')?.addEventListener('click', api.close);
        lb.querySelector('.tz-lb-prev')?.addEventListener('click', () => { idx -= 1; upd(); });
        lb.querySelector('.tz-lb-next')?.addEventListener('click', () => { idx += 1; upd(); });
        lb.addEventListener('click', (e) => { if (e.target === lb || (e.target instanceof HTMLElement && e.target.classList.contains('tz-lb-stage'))) api.close(); });
        document.addEventListener('keydown', (e) => {
            if (!lb.classList.contains('tz-open')) return;
            if (e.key === 'Escape') api.close();
            else if (e.key === 'ArrowLeft') { idx -= 1; upd(); }
            else if (e.key === 'ArrowRight') { idx += 1; upd(); }
        });

        if (img instanceof HTMLImageElement) {
            img.addEventListener('dragstart', (e) => e.preventDefault());
            img.addEventListener('wheel', (e) => {
                e.preventDefault();
                const rect = img.getBoundingClientRect();
                const ox = e.clientX - rect.left - rect.width / 2;
                const oy = e.clientY - rect.top - rect.height / 2;
                const ns = Math.max(1, Math.min(8, scale * (e.deltaY > 0 ? 0.9 : 1.1)));
                const ratio = ns / scale;
                tx = ox - ratio * (ox - tx);
                ty = oy - ratio * (oy - ty);
                scale = ns;
                if (scale <= 1.01) reset();
                else apply();
            }, { passive: false });
            img.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || scale <= 1) return;
                dragging = true; sx = e.clientX; sy = e.clientY; ltx = tx; lty = ty;
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                tx = ltx + (e.clientX - sx); ty = lty + (e.clientY - sy); apply();
            });
            document.addEventListener('mouseup', () => { dragging = false; });
            img.addEventListener('dblclick', () => { if (scale > 1.5) reset(); else { scale = 2; tx = 0; ty = 0; apply(); } });
            img.addEventListener('touchstart', (e) => {
                if (e.touches.length === 2) { pinchDist = dist(e.touches); pinchScale = scale; }
                if (e.touches.length === 1) { swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; if (scale > 1) { dragging = true; sx = swipeX; sy = swipeY; ltx = tx; lty = ty; } }
            }, { passive: true });
            img.addEventListener('touchmove', (e) => {
                if (e.touches.length === 2) { e.preventDefault(); scale = Math.max(1, Math.min(8, pinchScale * (dist(e.touches) / (pinchDist || 1)))); if (scale <= 1.01) reset(); else apply(); }
                else if (e.touches.length === 1 && dragging && scale > 1) { e.preventDefault(); tx = ltx + (e.touches[0].clientX - sx); ty = lty + (e.touches[0].clientY - sy); apply(); }
            }, { passive: false });
            img.addEventListener('touchend', (e) => {
                if (e.touches.length) return;
                if (dragging) dragging = false;
                if (scale <= 1.01 && e.changedTouches.length) {
                    const dx = e.changedTouches[0].clientX - swipeX;
                    const dy = e.changedTouches[0].clientY - swipeY;
                    if (Math.abs(dx) > 60 && Math.abs(dy) < 90) { idx += dx > 0 ? -1 : 1; upd(); }
                }
            });
        }

        ensureLightbox = () => api;
        return api;
    }

    function highRes(img) {
        const picks = [
            img.getAttribute('zoomfile'),
            img.getAttribute('file'),
            img.getAttribute('data-src'),
            img.getAttribute('data-original'),
            img.getAttribute('data-lazy-src'),
            img.closest('a[href]')?.getAttribute('href'),
            largestSrcset(img.getAttribute('srcset')),
            img.getAttribute('src'),
        ];
        for (const p of picks) {
            const u = cleanUrl(p);
            if (!u) continue;
            if (/\.(jpg|jpeg|png|webp|avif|bmp|gif)($|[?#])/i.test(u) || /\/uploads\//i.test(u)) return u;
        }
        return '';
    }

    function mergeOrdered(map) {
        const out = [];
        const seen = new Set();
        [...map.entries()].sort((a, b) => a[0] - b[0]).forEach(([, arr]) => {
            arr.slice().sort((x, y) => x.order - y.order).forEach((it) => {
                if (!it.src || seen.has(it.src)) return;
                seen.add(it.src);
                out.push(it);
            });
        });
        return out;
    }

    function detailBase(url) {
        const u = norm(url);
        const m = u.match(/^(https:\/\/trendszine\.com\/.+?\.html)(?:\/\d+)?$/);
        return m ? m[1] : u;
    }

    function detailPageNo(url, base = detailBase(url)) {
        const u = norm(url);
        if (u === base) return 1;
        const m = u.match(new RegExp(`^${esc(base)}/(\\d+)$`));
        return m ? parseInt(m[1], 10) : 1;
    }

    function norm(url) {
        try {
            return new URL(url, location.origin).href.replace(/[?#].*$/, '').replace(/\/$/, '');
        } catch {
            return '';
        }
    }

    function cleanUrl(url) {
        if (!url || /^data:/i.test(url)) return '';
        try {
            return new URL(url, location.origin).href.replace(/#.*$/, '').replace(/-\d{2,4}x\d{2,4}(?=\.(jpg|jpeg|png|webp|avif|bmp|gif)($|[?#]))/i, '');
        } catch {
            return '';
        }
    }

    function largestSrcset(srcset) {
        if (!srcset) return '';
        return srcset.split(',').map((p) => p.trim()).map((p) => {
            const [u, s] = p.split(/\s+/);
            return { u, w: parseInt(s, 10) || 0 };
        }).sort((a, b) => a.w - b.w).at(-1)?.u || '';
    }

    function purgeAds(scope) {
        CONFIG.adSelectors.forEach((sel) => scope.querySelectorAll(sel).forEach((el) => hide(el)));
        scope.querySelectorAll('iframe,script,ins,[class],[id]').forEach((el) => { if (isAd(el)) hide(el); });
    }

    function isAd(el) {
        if (!(el instanceof HTMLElement)) return false;
        const sig = `${el.id} ${el.className} ${el.getAttribute('src') || ''} ${el.getAttribute('href') || ''}`.toLowerCase();
        return CONFIG.adHostHints.some((k) => sig.includes(k)) || el.tagName === 'INS';
    }

    function isPagination(el) {
        return el.matches('.page-links,.pgntn-page-pagination,.pagination,.nav-links,.post-page-numbers') || !!el.querySelector('a.post-page-numbers');
    }

    function imageOnly(el) {
        if (!(el instanceof HTMLElement)) return false;
        if (el.matches('img')) return true;
        if (!el.querySelector('img')) return false;
        if (el.querySelector('video,audio,iframe,table,pre,blockquote,figcaption')) return false;
        const c = el.cloneNode(true);
        c.querySelectorAll('img,br').forEach((n) => n.remove());
        return !((c.textContent || '').replace(/\s+/g, '').trim());
    }

    function hide(el) {
        if (!(el instanceof HTMLElement)) return;
        el.style.setProperty('display', 'none', 'important');
    }

    function removeInlineLayout(el) {
        if (el instanceof HTMLElement && el.hasAttribute('style')) el.removeAttribute('style');
    }

    function esc(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function dist(t) {
        const x = t[0].clientX - t[1].clientX;
        const y = t[0].clientY - t[1].clientY;
        return Math.sqrt(x * x + y * y);
    }

    function clamp(n, min, max) {
        if (Number.isNaN(n)) return min;
        return Math.min(Math.max(n, min), max);
    }
})();
