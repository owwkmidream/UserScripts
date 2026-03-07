// ==UserScript==
// @name         MissKon Ultimate Gallery (Universal v9)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Rebuild MissKon feed/detail with grid, ordered autoload, and full-gesture lightbox.
// @author       owwkmidream
// @match        https://misskon.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_FLAG = 'mkUniversalProcessed';
    const KEY_COLS = 'mk_gallery_cols';
    const DEFAULT_COLS = Math.max(2, Math.min(6, Number(localStorage.getItem(KEY_COLS) || 4)));
    const STATE = {
        galleryCols: DEFAULT_COLS,
        lightboxItems: [],
    };

    GM_addStyle(`
        #mk-feed-grid {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)) !important;
            gap: 16px !important;
            width: 100% !important;
        }
        #mk-feed-grid article.item-list {
            width: auto !important;
            margin: 0 !important;
            position: static !important;
            float: none !important;
            clear: none !important;
            border-radius: 10px !important;
            overflow: hidden !important;
            background: rgba(255, 255, 255, 0.03) !important;
        }
        #mk-feed-grid .mk-feed-divider {
            grid-column: 1 / -1 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 12px !important;
            margin: 8px 0 !important;
            color: #7d8796 !important;
            font-weight: 700 !important;
        }
        #mk-feed-grid .mk-feed-divider::before,
        #mk-feed-grid .mk-feed-divider::after {
            content: "" !important;
            height: 1px !important;
            flex: 1 !important;
            background: #2a2e36 !important;
        }
        #mk-gallery-wrap {
            border: 2px solid #f08ca3 !important;
            border-radius: 12px !important;
            padding: 8px !important;
            margin: 12px 0 !important;
            background: rgba(20, 21, 25, 0.72) !important;
            backdrop-filter: blur(2px) !important;
        }
        #mk-gallery-toolbar {
            position: sticky !important;
            top: 4px !important;
            z-index: 30 !important;
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            margin-bottom: 8px !important;
            padding: 8px 10px !important;
            border-radius: 9px !important;
            background: linear-gradient(135deg, #d85e7f, #f29ab7) !important;
            color: #fff !important;
            font: 600 13px/1.3 "Consolas", "SF Mono", monospace !important;
        }
        #mk-gallery-toolbar input[type="range"] {
            width: 160px !important;
            accent-color: #fff !important;
        }
        #mk-media-wrap {
            margin: 8px 0 12px 0 !important;
        }
        #mk-gallery-grid {
            display: grid !important;
            grid-template-columns: repeat(var(--mk-cols, 4), minmax(0, 1fr)) !important;
            gap: 8px !important;
        }
        .mk-gallery-card {
            position: relative !important;
            aspect-ratio: 3 / 4 !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            background: #111 !important;
            cursor: zoom-in !important;
        }
        .mk-gallery-card img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            display: block !important;
        }
        .mk-seq {
            position: absolute !important;
            top: 6px !important;
            left: 6px !important;
            background: rgba(0, 0, 0, 0.55) !important;
            color: #fff !important;
            padding: 1px 7px !important;
            border-radius: 999px !important;
            font: 700 11px/1.5 "Consolas", "SF Mono", monospace !important;
            pointer-events: none !important;
        }
        #mk-lightbox {
            position: fixed !important;
            inset: 0 !important;
            z-index: 999999 !important;
            background: rgba(0, 0, 0, 0.92) !important;
            display: none !important;
            touch-action: none !important;
            user-select: none !important;
        }
        #mk-lightbox.mk-open {
            display: block !important;
        }
        #mk-lb-stage {
            width: 100% !important;
            height: 100% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            overflow: hidden !important;
        }
        #mk-lb-img {
            max-width: 100% !important;
            max-height: 100% !important;
            object-fit: contain !important;
            transform-origin: center center !important;
            will-change: transform !important;
            cursor: grab !important;
        }
        #mk-lb-img.mk-dragging {
            cursor: grabbing !important;
        }
        .mk-lb-btn {
            position: absolute !important;
            top: 16px !important;
            width: 42px !important;
            height: 42px !important;
            border: 0 !important;
            border-radius: 999px !important;
            background: rgba(255, 255, 255, 0.18) !important;
            color: #fff !important;
            font-size: 26px !important;
            line-height: 1 !important;
            cursor: pointer !important;
        }
        #mk-lb-close { right: 16px !important; }
        #mk-lb-prev, #mk-lb-next {
            top: 50% !important;
            transform: translateY(-50%) !important;
            width: 56px !important;
            height: 56px !important;
            font-size: 36px !important;
            background: rgba(255, 255, 255, 0.12) !important;
        }
        #mk-lb-prev { left: 14px !important; }
        #mk-lb-next { right: 14px !important; }
        #mk-lb-counter {
            position: absolute !important;
            left: 50% !important;
            bottom: 14px !important;
            transform: translateX(-50%) !important;
            color: #fff !important;
            background: rgba(0, 0, 0, 0.55) !important;
            padding: 4px 10px !important;
            border-radius: 999px !important;
            font: 600 12px/1.4 "Consolas", monospace !important;
        }
        @media (max-width: 980px) {
            #mk-gallery-grid {
                grid-template-columns: repeat(var(--mk-cols-mobile, 2), minmax(0, 1fr)) !important;
            }
        }
    `);

    const bootTimer = setInterval(() => {
        if (!document.body) return;
        if (document.body.dataset[SCRIPT_FLAG] === 'true') return;
        document.body.dataset[SCRIPT_FLAG] = 'true';
        routeScene();
    }, 500);

    function routeScene() {
        const detailEntry = document.querySelector('.post-inner .entry, article .entry');
        const feedContainer = document.querySelector('.post-listing.archive-box');
        if (detailEntry && detailEntry.querySelector('.page-link .post-page-numbers')) {
            initDetailScene(detailEntry).catch(console.error);
            return;
        }
        if (feedContainer && feedContainer.querySelector('article.item-list')) {
            initFeedScene(feedContainer);
            return;
        }
        if (!document.querySelector('.post-inner .entry, .post-listing.archive-box')) {
            document.body.dataset[SCRIPT_FLAG] = 'false';
        }
    }

    function initFeedScene(feedContainer) {
        if (feedContainer.dataset.mkFeedReady === 'true') return;
        feedContainer.dataset.mkFeedReady = 'true';
        feedContainer.id = 'mk-feed-grid';

        const layoutFix = () => {
            feedContainer.querySelectorAll('article.item-list').forEach((card) => {
                card.style.removeProperty('top');
                card.style.removeProperty('left');
                card.style.removeProperty('position');
                card.classList.remove('isotope-item', 'post-grid-item');
            });
            Array.from(feedContainer.children).forEach((child) => {
                if (!child.matches('article.item-list, .mk-feed-divider')) {
                    child.style.gridColumn = '1 / -1';
                }
            });
        };

        layoutFix();
        new MutationObserver(layoutFix).observe(feedContainer, { childList: true, subtree: true });

        const pageState = { loading: false, nextUrl: null, page: 1 };
        const setNextFromPagination = (root = document) => {
            const current = root.querySelector('.pagination .current');
            const nextLink = current ? current.nextElementSibling : root.querySelector('.pagination a.page');
            pageState.nextUrl = nextLink && nextLink.matches('a.page') ? nextLink.href : null;
        };
        setNextFromPagination();

        const fetchAndAppend = async (url) => {
            if (!url || pageState.loading) return;
            pageState.loading = true;
            try {
                const res = await fetch(url, { credentials: 'same-origin' });
                const html = await res.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const nextContainer = doc.querySelector('.post-listing.archive-box');
                if (!nextContainer) return;

                const nextPage = Number((doc.querySelector('.pagination .current') || { textContent: '' }).textContent.trim()) || (pageState.page + 1);
                const divider = document.createElement('div');
                divider.className = 'mk-feed-divider';
                divider.textContent = `Page ${nextPage}`;
                feedContainer.appendChild(divider);

                nextContainer.querySelectorAll('article.item-list').forEach((item) => {
                    item.style.removeProperty('top');
                    item.style.removeProperty('left');
                    item.style.removeProperty('position');
                    feedContainer.appendChild(item);
                });
                pageState.page = nextPage;
                setNextFromPagination(doc);
            } catch (err) {
                console.error('[MissKon Feed] fetch failed', err);
            } finally {
                pageState.loading = false;
            }
        };

        document.addEventListener('click', (evt) => {
            const link = evt.target.closest('.pagination a.page');
            if (!link) return;
            evt.preventDefault();
            fetchAndAppend(link.href);
        }, true);

        const onScroll = () => {
            if (!pageState.nextUrl || pageState.loading) return;
            const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 900;
            if (nearBottom) fetchAndAppend(pageState.nextUrl);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
    }

    async function initDetailScene(entry) {
        if (entry.dataset.mkDetailReady === 'true') return;
        entry.dataset.mkDetailReady = 'true';

        const pageMap = collectPaginationMap();
        const pagePairs = Array.from(pageMap.entries()).sort((a, b) => a[0] - b[0]);
        const orderedResults = await Promise.all(pagePairs.map(([pageNum, url]) => fetchPageImages(pageNum, url)));
        const orderedByPage = new Map();
        orderedResults.forEach((r) => orderedByPage.set(r.pageNum, r.images));
        const allImages = Array.from(orderedByPage.keys()).sort((a, b) => a - b).flatMap((pageNum) => orderedByPage.get(pageNum) || []);
        if (!allImages.length) return;

        const mediaWrap = preserveMedia(entry);
        const galleryWrap = document.createElement('section');
        galleryWrap.id = 'mk-gallery-wrap';
        const toolbar = buildToolbar(galleryWrap);
        const grid = document.createElement('div');
        grid.id = 'mk-gallery-grid';
        galleryWrap.append(toolbar, grid);
        if (mediaWrap && mediaWrap.parentNode === entry) {
            mediaWrap.insertAdjacentElement('afterend', galleryWrap);
        } else {
            entry.prepend(galleryWrap);
        }

        STATE.lightboxItems = allImages;
        const lb = ensureLightbox();
        allImages.forEach((src, idx) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'mk-gallery-card';
            card.dataset.src = src;
            card.innerHTML = `<span class="mk-seq">${idx + 1}</span><img loading="lazy" src="${escapeAttr(src)}" referrerpolicy="no-referrer" alt="Image ${idx + 1}">`;
            card.addEventListener('click', () => lb.open(idx));
            grid.appendChild(card);
        });

        safelyPurgeOriginalImages(entry, new Set(allImages));
        hideNoiseAroundDetail();
    }

    function collectPaginationMap() {
        const map = new Map();
        const links = document.querySelectorAll('.entry .page-link .post-page-numbers');
        const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
        const baseUrl = canonical.replace(/\/\d+\/?$/, '/').replace(/[?#].*$/, '');
        const currentPage = getPageNumFromUrl(location.href) || 1;
        map.set(currentPage, location.href);

        links.forEach((node) => {
            const pageNum = Number(node.textContent.trim());
            if (!Number.isFinite(pageNum) || pageNum < 1) return;
            const url = node.tagName === 'A' ? node.href : (pageNum === 1 ? baseUrl : `${baseUrl}${pageNum}/`);
            map.set(pageNum, url);
        });
        if (!map.has(1)) map.set(1, baseUrl);
        return map;
    }

    async function fetchPageImages(pageNum, url) {
        try {
            const html = pageNum === (getPageNumFromUrl(location.href) || 1)
                ? document.documentElement.outerHTML
                : await (await fetch(url, { credentials: 'same-origin' })).text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const entry = doc.querySelector('.post-inner .entry, article .entry');
            if (!entry) return { pageNum, images: [] };
            const images = [];
            entry.querySelectorAll('img').forEach((img) => {
                const src = getBestImageSrc(img);
                if (!src) return;
                if (!isLikelyGalleryImage(src)) return;
                images.push(src);
            });
            return { pageNum, images: dedupe(images) };
        } catch (err) {
            console.error('[MissKon Detail] fetch page failed', pageNum, url, err);
            return { pageNum, images: [] };
        }
    }

    function preserveMedia(entry) {
        const existing = entry.querySelector('#mk-media-wrap');
        if (existing) return existing;

        const mediaWrap = document.createElement('section');
        mediaWrap.id = 'mk-media-wrap';
        const firstImageBlock = findFirstImageBlock(entry);
        if (firstImageBlock) entry.insertBefore(mediaWrap, firstImageBlock);
        else entry.prepend(mediaWrap);

        const children = Array.from(entry.children);
        children.forEach((child) => {
            if (child === mediaWrap) return;
            if (child.matches('#mk-gallery-wrap, .page-link, .e3lan, script, style')) return;
            if (isImageOnlyBlock(child)) return;
            mediaWrap.appendChild(child);
        });

        if (!mediaWrap.children.length) {
            mediaWrap.remove();
            return null;
        }
        return mediaWrap;
    }

    function buildToolbar(galleryWrap) {
        const toolbar = document.createElement('div');
        toolbar.id = 'mk-gallery-toolbar';
        const isMobile = window.matchMedia('(max-width: 980px)').matches;
        const cols = isMobile ? Math.min(3, STATE.galleryCols) : STATE.galleryCols;
        const colsLabel = document.createElement('span');
        colsLabel.textContent = `Cols: ${cols}`;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '2';
        slider.max = isMobile ? '3' : '6';
        slider.step = '1';
        slider.value = String(cols);
        const count = document.createElement('span');
        count.textContent = '';

        const applyCols = (v) => {
            const n = Math.max(2, Math.min(isMobile ? 3 : 6, Number(v) || cols));
            galleryWrap.style.setProperty('--mk-cols', String(n));
            galleryWrap.style.setProperty('--mk-cols-mobile', String(Math.min(3, n)));
            colsLabel.textContent = `Cols: ${n}`;
            STATE.galleryCols = n;
            localStorage.setItem(KEY_COLS, String(n));
        };
        slider.addEventListener('input', () => applyCols(slider.value));
        applyCols(cols);

        const current = document.querySelectorAll('.entry img').length;
        count.textContent = `Current: ${current}`;
        toolbar.append(colsLabel, slider, count);
        return toolbar;
    }

    function ensureLightbox() {
        const existing = document.getElementById('mk-lightbox');
        if (existing && existing._api) return existing._api;

        const lb = document.createElement('div');
        lb.id = 'mk-lightbox';
        lb.innerHTML = `
            <div id="mk-lb-stage"><img id="mk-lb-img" src="" alt="preview"></div>
            <button id="mk-lb-close" class="mk-lb-btn" type="button">×</button>
            <button id="mk-lb-prev" class="mk-lb-btn" type="button">‹</button>
            <button id="mk-lb-next" class="mk-lb-btn" type="button">›</button>
            <div id="mk-lb-counter">0 / 0</div>
        `;
        document.body.appendChild(lb);

        const img = lb.querySelector('#mk-lb-img');
        const counter = lb.querySelector('#mk-lb-counter');
        const state = {
            idx: 0,
            open: false,
            scale: 1,
            tx: 0,
            ty: 0,
            dragging: false,
            dragX: 0,
            dragY: 0,
            pinchDist: 0,
            pinchScale: 1,
        };

        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const applyTransform = () => {
            img.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
        };
        const resetTransform = () => {
            state.scale = 1;
            state.tx = 0;
            state.ty = 0;
            applyTransform();
        };
        const render = () => {
            const src = STATE.lightboxItems[state.idx];
            if (!src) return;
            img.src = src;
            img.setAttribute('referrerpolicy', 'no-referrer');
            counter.textContent = `${state.idx + 1} / ${STATE.lightboxItems.length}`;
            resetTransform();
        };
        const change = (delta) => {
            if (!STATE.lightboxItems.length) return;
            state.idx = (state.idx + delta + STATE.lightboxItems.length) % STATE.lightboxItems.length;
            render();
        };
        const close = () => {
            state.open = false;
            lb.classList.remove('mk-open');
            img.src = '';
            document.body.style.overflow = '';
        };
        const open = (idx) => {
            state.idx = clamp(idx, 0, Math.max(0, STATE.lightboxItems.length - 1));
            state.open = true;
            lb.classList.add('mk-open');
            document.body.style.overflow = 'hidden';
            render();
        };

        lb.querySelector('#mk-lb-close').addEventListener('click', close);
        lb.querySelector('#mk-lb-prev').addEventListener('click', () => change(-1));
        lb.querySelector('#mk-lb-next').addEventListener('click', () => change(1));

        lb.addEventListener('click', (evt) => {
            if (evt.target === lb || evt.target.id === 'mk-lb-stage') close();
        });

        window.addEventListener('keydown', (evt) => {
            if (!state.open) return;
            if (evt.key === 'Escape') close();
            if (evt.key === 'ArrowLeft') change(-1);
            if (evt.key === 'ArrowRight') change(1);
        });

        lb.addEventListener('wheel', (evt) => {
            if (!state.open) return;
            evt.preventDefault();
            const direction = evt.deltaY > 0 ? -1 : 1;
            const factor = direction > 0 ? 1.14 : 0.88;
            state.scale = clamp(state.scale * factor, 1, 8);
            applyTransform();
        }, { passive: false });

        img.addEventListener('dblclick', () => {
            state.scale = state.scale > 1.1 ? 1 : 2;
            state.tx = 0;
            state.ty = 0;
            applyTransform();
        });

        img.addEventListener('dragstart', (evt) => evt.preventDefault());
        img.addEventListener('mousedown', (evt) => {
            if (!state.open || state.scale <= 1) return;
            state.dragging = true;
            state.dragX = evt.clientX - state.tx;
            state.dragY = evt.clientY - state.ty;
            img.classList.add('mk-dragging');
        });
        window.addEventListener('mousemove', (evt) => {
            if (!state.dragging) return;
            state.tx = evt.clientX - state.dragX;
            state.ty = evt.clientY - state.dragY;
            applyTransform();
        });
        window.addEventListener('mouseup', () => {
            state.dragging = false;
            img.classList.remove('mk-dragging');
        });

        lb.addEventListener('touchstart', (evt) => {
            if (!state.open) return;
            if (evt.touches.length === 2) {
                const [a, b] = evt.touches;
                state.pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                state.pinchScale = state.scale;
            }
            if (evt.touches.length === 1 && state.scale > 1) {
                const t = evt.touches[0];
                state.dragging = true;
                state.dragX = t.clientX - state.tx;
                state.dragY = t.clientY - state.ty;
            }
        }, { passive: false });

        lb.addEventListener('touchmove', (evt) => {
            if (!state.open) return;
            if (evt.touches.length === 2) {
                evt.preventDefault();
                const [a, b] = evt.touches;
                const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                if (state.pinchDist > 0) {
                    state.scale = clamp(state.pinchScale * (dist / state.pinchDist), 1, 8);
                    applyTransform();
                }
                return;
            }
            if (evt.touches.length === 1 && state.dragging && state.scale > 1) {
                evt.preventDefault();
                const t = evt.touches[0];
                state.tx = t.clientX - state.dragX;
                state.ty = t.clientY - state.dragY;
                applyTransform();
            }
        }, { passive: false });

        lb.addEventListener('touchend', () => {
            state.dragging = false;
        });

        const api = { open, close };
        lb._api = api;
        return api;
    }

    function safelyPurgeOriginalImages(entry, gallerySrcSet) {
        if (!gallerySrcSet.size) return;
        entry.querySelectorAll('img').forEach((img) => {
            if (img.closest('#mk-gallery-wrap')) return;
            const src = getBestImageSrc(img);
            if (!src || !gallerySrcSet.has(src)) return;
            img.style.display = 'none';
            const wrapper = img.closest('a, p, figure');
            if (wrapper && !wrapper.closest('#mk-media-wrap')) {
                wrapper.style.display = 'none';
            }
            let next = img.nextElementSibling;
            while (next && next.tagName === 'BR') {
                next.style.display = 'none';
                next = next.nextElementSibling;
            }
        });
    }

    function hideNoiseAroundDetail() {
        document.querySelectorAll('.entry .page-link, .entry .e3lan, .entry script, .entry ins').forEach((el) => {
            el.style.display = 'none';
        });
    }

    function getBestImageSrc(img) {
        if (!img) return null;
        const attrs = ['zoomfile', 'file', 'data-src', 'data-original', 'data-lazy-src', 'src'];
        for (const attr of attrs) {
            const val = img.getAttribute(attr);
            if (val && !val.startsWith('data:image')) return normalizeUrl(val);
        }
        const parentA = img.closest('a[href]');
        if (parentA && /\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(parentA.href)) {
            return normalizeUrl(parentA.href);
        }
        return null;
    }

    function isLikelyGalleryImage(src) {
        if (!src) return false;
        if (!/\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(src)) return false;
        if (/logo|icon|avatar|gif$/i.test(src) && !/images\/\d{4}\//i.test(src)) return false;
        if (/\/media\/\d{4}\//i.test(src) && /-\d+x\d+\./.test(src)) return false;
        return true;
    }

    function findFirstImageBlock(entry) {
        return Array.from(entry.children).find((child) => child.querySelector && child.querySelector('img')) || null;
    }

    function isImageOnlyBlock(node) {
        if (!(node instanceof HTMLElement)) return false;
        if (!node.querySelector('img')) return false;
        if (node.querySelector('a.shortc-button, input, video, audio, iframe')) return false;
        const clone = node.cloneNode(true);
        clone.querySelectorAll('img, br').forEach((el) => el.remove());
        const text = clone.textContent.replace(/\s+/g, '');
        return text.length === 0;
    }

    function normalizeUrl(raw) {
        try {
            return new URL(raw, location.href).href;
        } catch {
            return null;
        }
    }

    function getPageNumFromUrl(url) {
        const match = String(url).match(/\/(\d+)\/?(?:[?#].*)?$/);
        return match ? Number(match[1]) : 1;
    }

    function dedupe(arr) {
        const seen = new Set();
        const out = [];
        for (const item of arr) {
            if (!item || seen.has(item)) continue;
            seen.add(item);
            out.push(item);
        }
        return out;
    }

    function escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;');
    }

    window.addEventListener('popstate', () => {
        document.body.dataset[SCRIPT_FLAG] = 'false';
        routeScene();
    });

    window.addEventListener('beforeunload', () => clearInterval(bootTimer));
})();
