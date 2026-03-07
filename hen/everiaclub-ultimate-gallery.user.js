// ==UserScript==
// @name         Everia Club 极致画廊
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  重构 Everia Club 列表与详情页，提供现代 Grid、无限滚动、嵌入式画廊和手势灯箱
// @author       owwkmidream
// @match        https://www.everiaclub.com/*
// @icon         https://www.everiaclub.com/favicon.ico
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const WIDTH_KEY = 'everiaclub_gallery_col_width';
    const MIN_WIDTH = 180;
    const MAX_WIDTH = 420;
    const DEFAULT_WIDTH = clamp(Number(localStorage.getItem(WIDTH_KEY) || '260'), MIN_WIDTH, MAX_WIDTH);

    const CONFIG = {
        heartbeatMs: 900,
        adSelectors: [
            'ins',
            '.sk',
            '.sk-desktop',
            '.sk-mobile',
            '.ads',
            '.ad',
            '[data-zoneid]',
            '[id^="container-"]',
            '[id*="container-"]',
            'a[aria-hidden="true"][rel*="nofollow"]',
            'script[src*="magsrv"]',
            'script[src*="juicyads"]',
            'script[src*="ad-provider"]',
            'script[src*="worried-advantage"]',
            'script[src*="amung"]',
        ],
        adHosts: [
            'magsrv.com',
            'juicyads.com',
            'ad-provider.js',
            'worried-advantage.com',
            'cdn-cgi/content?id=',
        ],
    };

    const STATE = {
        stylesInjected: false,
        adGuardStarted: false,
        adObserver: null,
        feed: {
            root: null,
            loading: false,
            nextUrl: '',
            loadedUrls: new Set(),
            io: null,
        },
    };

    const Lightbox = {
        wrap: null,
        image: null,
        counter: null,
        prevButton: null,
        nextButton: null,
        closeButton: null,
        items: [],
        index: 0,
        scale: 1,
        translateX: 0,
        translateY: 0,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        dragOriginX: 0,
        dragOriginY: 0,
        pinchDistance: 0,
        pinchScale: 1,
        touchMode: '',
        bodyOverflow: '',
        ensure() {
            if (this.wrap) {
                return;
            }

            const wrap = document.createElement('div');
            wrap.id = 'ecg-lightbox';
            wrap.innerHTML = `
                <button type="button" class="ecg-close" aria-label="Close">×</button>
                <button type="button" class="ecg-nav ecg-prev" aria-label="Previous">‹</button>
                <img id="ecg-lightbox-image" alt="">
                <button type="button" class="ecg-nav ecg-next" aria-label="Next">›</button>
                <div class="ecg-counter">0 / 0</div>
            `;

            document.body.appendChild(wrap);

            this.wrap = wrap;
            this.image = wrap.querySelector('#ecg-lightbox-image');
            this.counter = wrap.querySelector('.ecg-counter');
            this.prevButton = wrap.querySelector('.ecg-prev');
            this.nextButton = wrap.querySelector('.ecg-next');
            this.closeButton = wrap.querySelector('.ecg-close');

            this.prevButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.step(-1);
            });

            this.nextButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.step(1);
            });

            this.closeButton.addEventListener('click', () => this.close());

            wrap.addEventListener('click', (event) => {
                if (event.target === wrap) {
                    this.close();
                }
            });

            this.image.addEventListener('dblclick', (event) => {
                event.preventDefault();
                if (this.scale > 1.05) {
                    this.resetTransform();
                    return;
                }
                this.zoomTo(2, event.clientX, event.clientY);
            });

            this.image.addEventListener('dragstart', (event) => event.preventDefault());

            this.image.addEventListener('wheel', (event) => {
                event.preventDefault();
                const delta = event.deltaY < 0 ? 1.14 : 0.88;
                this.zoomTo(clamp(this.scale * delta, 1, 5), event.clientX, event.clientY);
            }, { passive: false });

            this.image.addEventListener('mousedown', (event) => {
                if (event.button !== 0 || this.scale <= 1) {
                    return;
                }
                event.preventDefault();
                this.dragging = true;
                this.image.classList.add('ecg-dragging');
                this.dragStartX = event.clientX;
                this.dragStartY = event.clientY;
                this.dragOriginX = this.translateX;
                this.dragOriginY = this.translateY;
            });

            wrap.addEventListener('mousemove', (event) => {
                if (!this.dragging) {
                    return;
                }
                this.translateX = this.dragOriginX + (event.clientX - this.dragStartX);
                this.translateY = this.dragOriginY + (event.clientY - this.dragStartY);
                this.renderTransform();
            });

            const stopDrag = () => {
                if (!this.dragging) {
                    return;
                }
                this.dragging = false;
                this.image.classList.remove('ecg-dragging');
            };

            wrap.addEventListener('mouseup', stopDrag);
            wrap.addEventListener('mouseleave', stopDrag);

            wrap.addEventListener('touchstart', (event) => {
                if (event.touches.length === 2) {
                    this.touchMode = 'pinch';
                    this.pinchDistance = getTouchDistance(event.touches[0], event.touches[1]);
                    this.pinchScale = this.scale;
                    return;
                }

                if (event.touches.length === 1 && this.scale > 1) {
                    this.touchMode = 'pan';
                    this.dragging = true;
                    this.dragStartX = event.touches[0].clientX;
                    this.dragStartY = event.touches[0].clientY;
                    this.dragOriginX = this.translateX;
                    this.dragOriginY = this.translateY;
                }
            }, { passive: false });

            wrap.addEventListener('touchmove', (event) => {
                if (event.touches.length === 2) {
                    event.preventDefault();
                    const nextDistance = getTouchDistance(event.touches[0], event.touches[1]);
                    const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                    const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
                    const ratio = nextDistance / (this.pinchDistance || nextDistance || 1);
                    this.zoomTo(clamp(this.pinchScale * ratio, 1, 5), centerX, centerY);
                    return;
                }

                if (this.touchMode === 'pan' && this.dragging && event.touches.length === 1) {
                    event.preventDefault();
                    this.translateX = this.dragOriginX + (event.touches[0].clientX - this.dragStartX);
                    this.translateY = this.dragOriginY + (event.touches[0].clientY - this.dragStartY);
                    this.renderTransform();
                }
            }, { passive: false });

            wrap.addEventListener('touchend', () => {
                this.dragging = false;
                this.touchMode = '';
            });

            document.addEventListener('keydown', (event) => {
                if (!this.wrap || !this.wrap.classList.contains('ecg-open')) {
                    return;
                }
                if (event.key === 'Escape') {
                    this.close();
                } else if (event.key === 'ArrowLeft') {
                    this.step(-1);
                } else if (event.key === 'ArrowRight') {
                    this.step(1);
                }
            });
        },
        setItems(items) {
            this.items = items.slice();
        },
        open(index, items) {
            if (Array.isArray(items) && items.length) {
                this.setItems(items);
            }
            if (!this.items.length) {
                return;
            }
            this.ensure();
            this.index = normalizeIndex(index, this.items.length);
            this.bodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            this.wrap.classList.add('ecg-open');
            this.show();
        },
        close() {
            if (!this.wrap) {
                return;
            }
            this.wrap.classList.remove('ecg-open');
            document.body.style.overflow = this.bodyOverflow;
            this.resetTransform();
        },
        step(delta) {
            if (!this.items.length) {
                return;
            }
            this.index = normalizeIndex(this.index + delta, this.items.length);
            this.show();
        },
        show() {
            const item = this.items[this.index];
            this.resetTransform();
            this.image.src = item.url;
            this.image.alt = item.alt || '';
            this.image.referrerPolicy = 'no-referrer';
            this.counter.textContent = `${this.index + 1} / ${this.items.length}`;
        },
        resetTransform() {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.renderTransform();
        },
        renderTransform() {
            if (!this.image) {
                return;
            }
            this.image.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        },
        zoomTo(nextScale, clientX, clientY) {
            if (!this.wrap || !this.image) {
                return;
            }
            const previousScale = this.scale;
            const targetScale = clamp(nextScale, 1, 5);
            if (Math.abs(previousScale - targetScale) < 0.001) {
                return;
            }
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            const focusX = clientX - centerX;
            const focusY = clientY - centerY;
            const ratio = targetScale / previousScale;
            this.translateX = focusX - (focusX - this.translateX) * ratio;
            this.translateY = focusY - (focusY - this.translateY) * ratio;
            this.scale = targetScale;
            if (this.scale <= 1.01) {
                this.translateX = 0;
                this.translateY = 0;
            }
            this.renderTransform();
        },
    };

    applyCardWidth(getCardWidth());
    heartbeat();
    document.addEventListener('DOMContentLoaded', heartbeat, { once: true });
    setInterval(heartbeat, CONFIG.heartbeatMs);

    function heartbeat() {
        if (!document.body) {
            return;
        }
        injectStyles();
        startAdGuard();
        const mainLeft = document.querySelector('.mainleft');
        if (!mainLeft) {
            return;
        }
        if (isDetailScene(mainLeft)) {
            void initDetailScene(mainLeft);
            return;
        }
        if (isFeedScene(mainLeft)) {
            initFeedScene(mainLeft);
        }
    }

    function isFeedScene(root) {
        return Boolean(root.querySelector('.leftp'));
    }

    function isDetailScene(root) {
        return Boolean(root.querySelector('h1')) && !root.querySelector('.leftp');
    }

    function injectStyles() {
        if (STATE.stylesInjected) {
            return;
        }
        STATE.stylesInjected = true;
        GM_addStyle(`
            :root { --ecg-card-width: ${getCardWidth()}px; --ecg-accent: #ff8fad; --ecg-accent-strong: #ff7098; --ecg-surface: #131319; --ecg-border: rgba(255,143,173,.55); }
            html, body, .divone, .mainleft, .mainright { overflow: visible !important; }
            .ecg-hidden-original, .ecg-ad-hidden { display: none !important; }
            .mainleft[data-ecg-feed="true"] { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ecg-card-width)), 1fr)) !important; gap: 18px !important; align-items: start !important; padding: 6px 0 22px !important; }
            .mainleft[data-ecg-feed="true"] > .leftp { width: auto !important; float: none !important; margin: 0 !important; position: static !important; inset: auto !important; transform: none !important; background: rgba(24,24,31,.92) !important; border: 1px solid rgba(255,255,255,.08) !important; border-radius: 16px !important; overflow: hidden !important; box-shadow: 0 12px 30px rgba(0,0,0,.28) !important; transition: transform .2s ease, box-shadow .2s ease !important; }
            .mainleft[data-ecg-feed="true"] > .leftp:hover { transform: translateY(-4px) !important; box-shadow: 0 18px 36px rgba(0,0,0,.32) !important; }
            .mainleft[data-ecg-feed="true"] > .leftp > a:first-child { display: block !important; aspect-ratio: 3 / 4 !important; overflow: hidden !important; background: #0c0c10 !important; }
            .mainleft[data-ecg-feed="true"] > .leftp img, .ecg-card img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block !important; }
            .mainleft[data-ecg-feed="true"] > .leftp p { margin: 0 !important; padding: 12px 14px 14px !important; line-height: 1.55 !important; font-size: 14px !important; }
            .mainleft[data-ecg-feed="true"] > .leftp p a { color: #f8f8fb !important; text-decoration: none !important; display: block !important; }
            .mainleft[data-ecg-feed="true"] > .leftp p a:hover { color: var(--ecg-accent) !important; }
            .mainleft[data-ecg-feed="true"] > :not(.leftp):not(#ecg-feed-toolbar):not(.ecg-page-divider):not(.pagination):not(.ecg-feed-sentinel) { grid-column: 1 / -1 !important; }
            #ecg-feed-toolbar, #ecg-gallery-toolbar { display: flex !important; align-items: center !important; justify-content: flex-end !important; gap: 12px !important; width: fit-content !important; max-width: 100% !important; margin-left: auto !important; padding: 9px 14px !important; border: 1px solid var(--ecg-border) !important; border-radius: 999px !important; background: rgba(18,18,24,.88) !important; box-shadow: 0 10px 28px rgba(0,0,0,.22) !important; color: #fff !important; backdrop-filter: blur(12px) !important; position: sticky !important; top: 4px !important; z-index: 60 !important; }
            #ecg-feed-toolbar { grid-column: 1 / -1 !important; margin-bottom: 4px !important; }
            #ecg-gallery-toolbar { margin-bottom: 14px !important; }
            .ecg-toolbar-label, .ecg-toolbar-status, .ecg-width-value, .ecg-page-divider, .ecg-seq, #ecg-lightbox .ecg-counter { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace !important; }
            .ecg-toolbar-label { white-space: nowrap !important; font-size: 12px !important; color: rgba(255,255,255,.82) !important; }
            .ecg-width-range { accent-color: var(--ecg-accent) !important; width: 150px !important; cursor: pointer !important; }
            .ecg-width-value { min-width: 48px !important; text-align: right !important; font-size: 12px !important; color: #fff !important; }
            .ecg-toolbar-status { font-size: 12px !important; color: rgba(255,255,255,.72) !important; white-space: nowrap !important; }
            .mainleft[data-ecg-feed="true"] > .pagination { grid-column: 1 / -1 !important; display: flex !important; flex-wrap: wrap !important; align-items: center !important; gap: 8px !important; list-style: none !important; padding: 6px 0 0 !important; margin: 0 !important; }
            .mainleft[data-ecg-feed="true"] > .pagination li { margin: 0 !important; list-style: none !important; }
            .mainleft[data-ecg-feed="true"] > .pagination a, .mainleft[data-ecg-feed="true"] > .pagination span { display: inline-flex !important; align-items: center !important; justify-content: center !important; min-width: 38px !important; height: 38px !important; padding: 0 12px !important; border-radius: 999px !important; background: rgba(17,17,23,.88) !important; border: 1px solid rgba(255,255,255,.08) !important; color: #fff !important; text-decoration: none !important; }
            .mainleft[data-ecg-feed="true"] > .pagination .current { background: linear-gradient(135deg, var(--ecg-accent), var(--ecg-accent-strong)) !important; border-color: transparent !important; }
            .ecg-page-divider { grid-column: 1 / -1 !important; display: flex !important; align-items: center !important; gap: 10px !important; color: var(--ecg-accent) !important; font-size: 12px !important; letter-spacing: .1em !important; text-transform: uppercase !important; padding-top: 4px !important; }
            .ecg-page-divider::after { content: "" !important; flex: 1 !important; height: 1px !important; background: linear-gradient(90deg, rgba(255,143,173,.55), transparent) !important; }
            .ecg-feed-sentinel { grid-column: 1 / -1 !important; width: 100% !important; height: 1px !important; }
            #ecg-media-wrap { margin: 12px 0 18px !important; padding: 14px !important; border: 1px solid rgba(255,255,255,.08) !important; border-radius: 16px !important; background: rgba(18,18,25,.86) !important; box-shadow: 0 12px 30px rgba(0,0,0,.28) !important; color: #f4f4f8 !important; }
            #ecg-media-wrap a { color: var(--ecg-accent) !important; }
            #ecg-media-wrap video, #ecg-media-wrap audio, #ecg-media-wrap iframe { width: 100% !important; max-width: 100% !important; border: 0 !important; border-radius: 12px !important; overflow: hidden !important; background: #000 !important; }
            #ecg-gallery-wrap { margin: 12px 0 28px !important; padding: 16px !important; border: 2px solid var(--ecg-border) !important; border-radius: 20px !important; background: linear-gradient(180deg, rgba(23,23,31,.96), rgba(15,15,21,.96)) !important; box-shadow: 0 18px 42px rgba(0,0,0,.32) !important; overflow: visible !important; }
            #ecg-gallery-grid { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--ecg-card-width)), 1fr)) !important; gap: 12px !important; }
            .ecg-card { position: relative !important; aspect-ratio: 3 / 4 !important; overflow: hidden !important; border-radius: 14px !important; background: #09090d !important; cursor: zoom-in !important; box-shadow: 0 10px 24px rgba(0,0,0,.24) !important; transition: transform .2s ease, box-shadow .2s ease !important; }
            .ecg-card:hover { transform: translateY(-4px) !important; box-shadow: 0 16px 30px rgba(0,0,0,.28) !important; }
            .ecg-seq { position: absolute !important; top: 8px !important; left: 8px !important; z-index: 2 !important; padding: 3px 8px !important; border-radius: 999px !important; background: rgba(0,0,0,.62) !important; color: #fff !important; font-size: 12px !important; line-height: 1.3 !important; pointer-events: none !important; }
            #ecg-lightbox { position: fixed !important; inset: 0 !important; display: none !important; align-items: center !important; justify-content: center !important; background: rgba(0,0,0,.96) !important; z-index: 2147483646 !important; touch-action: none !important; user-select: none !important; }
            #ecg-lightbox.ecg-open { display: flex !important; }
            #ecg-lightbox-image { max-width: 95vw !important; max-height: 92vh !important; object-fit: contain !important; transform-origin: center center !important; cursor: grab !important; touch-action: none !important; will-change: transform !important; transition: transform .12s ease !important; }
            #ecg-lightbox-image.ecg-dragging { cursor: grabbing !important; transition: none !important; }
            #ecg-lightbox .ecg-nav, #ecg-lightbox .ecg-close { position: absolute !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; border: 0 !important; background: rgba(255,255,255,.08) !important; color: #fff !important; cursor: pointer !important; backdrop-filter: blur(10px) !important; }
            #ecg-lightbox .ecg-nav { top: 50% !important; width: 52px !important; height: 52px !important; margin-top: -26px !important; border-radius: 999px !important; font-size: 34px !important; line-height: 1 !important; }
            #ecg-lightbox .ecg-prev { left: 18px !important; }
            #ecg-lightbox .ecg-next { right: 18px !important; }
            #ecg-lightbox .ecg-close { top: 18px !important; right: 18px !important; width: 44px !important; height: 44px !important; border-radius: 999px !important; font-size: 28px !important; }
            #ecg-lightbox .ecg-counter { position: absolute !important; left: 50% !important; bottom: 18px !important; transform: translateX(-50%) !important; padding: 7px 12px !important; border-radius: 999px !important; background: rgba(255,255,255,.08) !important; color: #fff !important; font-size: 12px !important; backdrop-filter: blur(10px) !important; }
            @media (max-width: 900px) { #ecg-feed-toolbar, #ecg-gallery-toolbar { width: 100% !important; justify-content: space-between !important; border-radius: 16px !important; padding: 10px 12px !important; } .ecg-width-range { width: 110px !important; } #ecg-lightbox .ecg-nav { width: 44px !important; height: 44px !important; margin-top: -22px !important; } }
        `);
    }

    function startAdGuard() {
        hideAds(document);
        if (STATE.adGuardStarted) {
            return;
        }
        STATE.adGuardStarted = true;
        STATE.adObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLElement) {
                        hideAds(node);
                    }
                }
            }
        });
        STATE.adObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function hideAds(scope) {
        if (!scope) {
            return;
        }
        for (const selector of CONFIG.adSelectors) {
            if (scope instanceof HTMLElement && scope.matches(selector)) {
                scope.classList.add('ecg-ad-hidden');
            }
            if (typeof scope.querySelectorAll === 'function') {
                scope.querySelectorAll(selector).forEach((element) => element.classList.add('ecg-ad-hidden'));
            }
        }
        const nodes = scope instanceof HTMLElement ? [scope] : [];
        if (typeof scope.querySelectorAll === 'function') {
            scope.querySelectorAll('script, iframe, a, div, p').forEach((element) => nodes.push(element));
        }
        nodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) {
                return;
            }
            const source = [node.getAttribute('src'), node.getAttribute('href'), node.getAttribute('data-src')].filter(Boolean).join(' ');
            if (CONFIG.adHosts.some((host) => source.includes(host))) {
                node.classList.add('ecg-ad-hidden');
            }
        });
    }

    function initFeedScene(root) {
        if (STATE.feed.root !== root) {
            if (STATE.feed.io) {
                STATE.feed.io.disconnect();
            }
            STATE.feed.root = root;
            STATE.feed.loading = false;
            STATE.feed.nextUrl = '';
            STATE.feed.loadedUrls = new Set();
        }
        root.dataset.ecgFeed = 'true';
        sanitizeFeed(root);
        ensureFeedToolbar(root);
        ensureFeedListeners(root);
        ensureFeedSentinel(root);
        refreshFeedState(root);
        observeFeedRoot(root);
    }

    function sanitizeFeed(root) {
        Array.from(root.children).forEach((child) => {
            if (!(child instanceof HTMLElement)) {
                return;
            }
            if (child.id === 'ecg-feed-toolbar' || child.classList.contains('ecg-page-divider') || child.classList.contains('ecg-feed-sentinel')) {
                return;
            }
            if (child.classList.contains('leftp')) {
                sanitizeFeedCard(child);
                return;
            }
            if (child.classList.contains('pagination')) {
                sanitizePagination(child);
                return;
            }
            child.style.setProperty('grid-column', '1 / -1', 'important');
        });
    }

    function sanitizeFeedCard(card) {
        card.removeAttribute('style');
        card.style.setProperty('position', 'static', 'important');
        card.style.setProperty('inset', 'auto', 'important');
        card.style.setProperty('transform', 'none', 'important');
        card.querySelectorAll('[style]').forEach((element) => {
            element.style.removeProperty('top');
            element.style.removeProperty('left');
            element.style.removeProperty('right');
            element.style.removeProperty('bottom');
            element.style.removeProperty('transform');
            element.style.removeProperty('position');
            if (!element.getAttribute('style') || !element.getAttribute('style').trim()) {
                element.removeAttribute('style');
            }
        });
    }

    function sanitizePagination(pagination) {
        pagination.style.setProperty('grid-column', '1 / -1', 'important');
        pagination.querySelectorAll('li').forEach((item) => item.removeAttribute('style'));
    }

    function ensureFeedToolbar(root) {
        if (root.querySelector('#ecg-feed-toolbar')) {
            syncWidthControls(getCardWidth());
            return;
        }
        const toolbar = createToolbar('Feed Grid', '滚动到底自动续页');
        toolbar.id = 'ecg-feed-toolbar';
        root.prepend(toolbar);
    }

    function ensureFeedListeners(root) {
        if (root.dataset.ecgFeedBound === 'true') {
            return;
        }
        root.dataset.ecgFeedBound = 'true';
        root.addEventListener('click', (event) => {
            const anchor = event.target instanceof Element ? event.target.closest('.pagination a[href]') : null;
            if (!anchor) {
                return;
            }
            event.preventDefault();
            void loadFeedPage(root, anchor.href);
        });
    }

    function observeFeedRoot(root) {
        if (root.dataset.ecgFeedObserved === 'true') {
            return;
        }
        root.dataset.ecgFeedObserved = 'true';
        const observer = new MutationObserver(() => {
            sanitizeFeed(root);
            moveFeedSentinel(root);
            refreshFeedState(root);
        });
        observer.observe(root, { childList: true, subtree: true });
    }

    function ensureFeedSentinel(root) {
        let sentinel = root.querySelector('.ecg-feed-sentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.className = 'ecg-feed-sentinel';
            root.appendChild(sentinel);
        }
        moveFeedSentinel(root);
        if (STATE.feed.io) {
            STATE.feed.io.disconnect();
        }
        if (!('IntersectionObserver' in window)) {
            return;
        }
        STATE.feed.io = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadFeedPage(root, STATE.feed.nextUrl);
            }
        }, { rootMargin: '1200px 0px' });
        STATE.feed.io.observe(sentinel);
    }

    function moveFeedSentinel(root) {
        const sentinel = root.querySelector('.ecg-feed-sentinel');
        if (sentinel) {
            root.appendChild(sentinel);
        }
    }

    function refreshFeedState(root) {
        if (!STATE.feed.loadedUrls.size) {
            STATE.feed.loadedUrls.add(stripHash(location.href));
        }
        STATE.feed.nextUrl = findNextPageUrl(root, location.href);
    }

    async function loadFeedPage(root, url) {
        const targetUrl = stripHash(url || '');
        if (!targetUrl || STATE.feed.loading || STATE.feed.loadedUrls.has(targetUrl)) {
            return;
        }
        STATE.feed.loading = true;
        setToolbarStatus('#ecg-feed-toolbar', `加载 Page ${extractPageNumber(targetUrl)}...`);
        try {
            const doc = await fetchDocument(targetUrl);
            const incomingRoot = doc.querySelector('.mainleft');
            if (!incomingRoot) {
                throw new Error('Missing .mainleft in loaded page');
            }
            const cards = Array.from(incomingRoot.querySelectorAll('.leftp'));
            const existingUrls = collectFeedUrls(root);
            const fragment = document.createDocumentFragment();
            let appended = 0;
            const pageNumber = readCurrentPageNumber(incomingRoot, targetUrl);

            cards.forEach((card) => {
                const href = stripHash(toAbsoluteUrl(card.querySelector('a[href]')?.getAttribute('href') || '', targetUrl));
                if (!href || existingUrls.has(href)) {
                    return;
                }
                existingUrls.add(href);
                const clone = document.importNode(card, true);
                sanitizeFeedCard(clone);
                fragment.appendChild(clone);
                appended += 1;
            });

            if (appended > 0) {
                const divider = document.createElement('div');
                divider.className = 'ecg-page-divider';
                divider.textContent = `Page ${pageNumber}`;
                const anchor = root.querySelector('.pagination') || root.querySelector('.ecg-feed-sentinel') || null;
                root.insertBefore(divider, anchor);
                root.insertBefore(fragment, anchor);
            }

            const incomingPagination = incomingRoot.querySelector('.pagination');
            if (incomingPagination) {
                const replacement = document.importNode(incomingPagination, true);
                sanitizePagination(replacement);
                const currentPagination = root.querySelector('.pagination');
                if (currentPagination) {
                    currentPagination.replaceWith(replacement);
                } else {
                    root.appendChild(replacement);
                }
            }

            STATE.feed.loadedUrls.add(targetUrl);
            STATE.feed.nextUrl = findNextPageUrl(incomingRoot, targetUrl);
            moveFeedSentinel(root);
            sanitizeFeed(root);
            setToolbarStatus('#ecg-feed-toolbar', appended > 0 ? `已追加 Page ${pageNumber} · ${appended} 项` : '没有新的卡片');
        } catch (error) {
            console.error('[Everia Club] feed load failed:', error);
            setToolbarStatus('#ecg-feed-toolbar', '续页失败');
        } finally {
            STATE.feed.loading = false;
        }
    }

    async function initDetailScene(root) {
        if (root.dataset.ecgDetailProcessed === 'true' || root.dataset.ecgDetailRunning === 'true') {
            return;
        }
        root.dataset.ecgDetailRunning = 'true';
        try {
            const pageUrls = discoverDetailPages(root);
            const pages = new Array(pageUrls.length);
            pages[0] = {
                pageNumber: readCurrentPageNumber(root, pageUrls[0]),
                images: extractDetailImages(root),
            };

            await Promise.all(pageUrls.slice(1).map(async (pageUrl, index) => {
                try {
                    const doc = await fetchDocument(pageUrl);
                    const pageRoot = doc.querySelector('.mainleft');
                    pages[index + 1] = {
                        pageNumber: readCurrentPageNumber(pageRoot, pageUrl),
                        images: extractDetailImages(pageRoot),
                    };
                } catch (error) {
                    console.error('[Everia Club] detail page fetch failed:', pageUrl, error);
                    pages[index + 1] = { pageNumber: extractPageNumber(pageUrl), images: [] };
                }
            }));

            const orderedPages = pages.filter(Boolean).sort((left, right) => left.pageNumber - right.pageNumber);
            const images = mergeImages(orderedPages);
            if (!images.length) {
                return;
            }

            Lightbox.ensure();
            Lightbox.setItems(images);

            const mediaWrap = ensureMediaWrap(root);
            const galleryWrap = createGalleryWrap(images, orderedPages.length);
            if (mediaWrap) {
                mediaWrap.insertAdjacentElement('afterend', galleryWrap);
            } else {
                const heading = root.querySelector('h1');
                if (heading) {
                    heading.insertAdjacentElement('afterend', galleryWrap);
                } else {
                    root.prepend(galleryWrap);
                }
            }

            hideOriginalImages(root, images);
            const pagination = root.querySelector('.pagination');
            if (pagination) {
                pagination.classList.add('ecg-hidden-original');
            }
            root.dataset.ecgDetailProcessed = 'true';
        } catch (error) {
            console.error('[Everia Club] detail scene failed:', error);
        } finally {
            root.dataset.ecgDetailRunning = 'false';
        }
    }

    function discoverDetailPages(root) {
        const pages = new Map();
        pages.set(stripHash(location.href), readCurrentPageNumber(root, location.href));
        root.querySelectorAll('.pagination a[href], a[rel="next"], a[href*="?page="], a[href*="&page="]').forEach((anchor) => {
            const href = stripHash(toAbsoluteUrl(anchor.getAttribute('href') || '', location.href));
            if (href) {
                pages.set(href, extractPageNumber(href, anchor.textContent.trim()));
            }
        });
        return Array.from(pages.entries()).sort((left, right) => left[1] - right[1]).map(([href]) => href);
    }

    function extractDetailImages(root) {
        if (!root) {
            return [];
        }
        const seen = new Set();
        const items = [];
        const pageTitle = root.ownerDocument?.querySelector('h1')?.textContent?.trim() || root.ownerDocument?.title || document.title;
        root.querySelectorAll('img').forEach((image) => {
            if (!isPrimaryContentImage(image)) {
                return;
            }
            const url = getHighResUrl(image);
            if (!url || seen.has(url)) {
                return;
            }
            seen.add(url);
            items.push({
                url,
                alt: image.getAttribute('title') || image.getAttribute('alt') || pageTitle,
            });
        });
        return items;
    }

    function isPrimaryContentImage(image) {
        const src = getHighResUrl(image);
        if (!src || !isImageUrl(src) || /\/static\//i.test(src) || /loading\.jpg/i.test(src)) {
            return false;
        }
        if (image.closest('.mainright')) {
            return false;
        }
        if (image.closest('.sk, .sk-desktop, .sk-mobile, ins, [id^="container-"], [id*="container-"]')) {
            return false;
        }
        const widthAttr = parseInt(String(image.getAttribute('width') || '').replace(/[^\d]/g, ''), 10);
        return Number.isNaN(widthAttr) || widthAttr >= 320;
    }

    function mergeImages(pages) {
        const merged = [];
        const seen = new Set();
        pages.forEach((page) => {
            page.images.forEach((item) => {
                if (!item.url || seen.has(item.url)) {
                    return;
                }
                seen.add(item.url);
                merged.push(item);
            });
        });
        return merged;
    }

    function ensureMediaWrap(root) {
        const existing = root.querySelector('#ecg-media-wrap');
        if (existing) {
            return existing;
        }
        const fragments = collectMediaFragments(root);
        if (!fragments.length) {
            return null;
        }
        const wrap = document.createElement('div');
        wrap.id = 'ecg-media-wrap';
        fragments.forEach((fragment) => wrap.appendChild(fragment));
        const heading = root.querySelector('h1');
        if (heading) {
            heading.insertAdjacentElement('afterend', wrap);
        } else {
            root.prepend(wrap);
        }
        return wrap;
    }

    function collectMediaFragments(root) {
        const fragments = [];
        Array.from(root.children).forEach((child) => {
            if (!(child instanceof HTMLElement)) {
                return;
            }
            if (child.matches('h1, img, br, script, style, .pagination, #ecg-gallery-wrap, #ecg-media-wrap')) {
                return;
            }
            if (child.classList.contains('ecg-hidden-original') || child.classList.contains('ecg-ad-hidden') || isAdLikeElement(child)) {
                return;
            }
            if (child.querySelector('img') && !child.querySelector('video, audio, iframe, [class*="download"], [id*="download"]')) {
                if (!getMeaningfulText(child)) {
                    return;
                }
            }
            const clone = child.cloneNode(true);
            clone.querySelectorAll('script').forEach((node) => node.remove());
            clone.querySelectorAll('ins, .sk, .sk-desktop, .sk-mobile, [data-zoneid], [id^="container-"], [id*="container-"]').forEach((node) => node.remove());
            if (hasMeaningfulMedia(clone) || getMeaningfulText(clone).length >= 20) {
                fragments.push(clone);
            }
        });
        return fragments;
    }

    function hasMeaningfulMedia(node) {
        return Boolean(
            node.matches?.('video, audio, iframe, [class*="download"], [id*="download"]')
            || node.querySelector?.('video, audio, iframe, [class*="download"], [id*="download"]')
        );
    }

    function createGalleryWrap(images, pageCount) {
        const wrap = document.createElement('section');
        wrap.id = 'ecg-gallery-wrap';
        const toolbar = createToolbar('Gallery Grid', `${images.length} 张 · ${pageCount} 页`);
        toolbar.id = 'ecg-gallery-toolbar';
        const grid = document.createElement('div');
        grid.id = 'ecg-gallery-grid';
        images.forEach((item, index) => {
            const card = document.createElement('article');
            card.className = 'ecg-card';
            card.tabIndex = 0;
            const badge = document.createElement('div');
            badge.className = 'ecg-seq';
            badge.textContent = String(index + 1);
            const image = document.createElement('img');
            image.src = item.url;
            image.alt = item.alt || '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.referrerPolicy = 'no-referrer';
            image.title = item.alt || '';
            card.appendChild(badge);
            card.appendChild(image);
            card.addEventListener('click', () => Lightbox.open(index, images));
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    Lightbox.open(index, images);
                }
            });
            grid.appendChild(card);
        });
        wrap.appendChild(toolbar);
        wrap.appendChild(grid);
        return wrap;
    }

    function hideOriginalImages(root, images) {
        const galleryUrls = new Set(images.map((item) => item.url));
        root.querySelectorAll('img').forEach((image) => {
            const source = getHighResUrl(image);
            if (!source || !galleryUrls.has(source)) {
                return;
            }
            image.classList.add('ecg-hidden-original');
            const parent = image.parentElement;
            if (parent && /^(A|P)$/i.test(parent.tagName) && parent.querySelectorAll('img').length === 1 && !getMeaningfulText(parent)) {
                parent.classList.add('ecg-hidden-original');
            }
            hideDisposableSiblingChain(image.previousElementSibling, 'previousElementSibling');
            hideDisposableSiblingChain(image.nextElementSibling, 'nextElementSibling');
        });
        root.querySelectorAll('br').forEach((node) => {
            const previous = node.previousElementSibling;
            const next = node.nextElementSibling;
            if ((previous && previous.classList.contains('ecg-hidden-original')) || (next && next.classList.contains('ecg-hidden-original'))) {
                node.classList.add('ecg-hidden-original');
            }
        });
    }

    function hideDisposableSiblingChain(startNode, direction) {
        let current = startNode;
        while (current instanceof HTMLElement && isDisposableSibling(current)) {
            current.classList.add('ecg-hidden-original');
            current = current[direction];
        }
    }

    function isDisposableSibling(node) {
        if (!(node instanceof HTMLElement)) {
            return false;
        }
        if (node.matches('br, script, ins, .sk, .sk-desktop, .sk-mobile, [data-zoneid], [id^="container-"], [id*="container-"]')) {
            return true;
        }
        return (node.matches('p, div') && !getMeaningfulText(node)) || isAdLikeElement(node);
    }

    function isAdLikeElement(node) {
        if (!(node instanceof HTMLElement)) {
            return false;
        }
        if (CONFIG.adSelectors.some((selector) => {
            try {
                return node.matches(selector);
            } catch {
                return false;
            }
        })) {
            return true;
        }
        const source = [
            node.getAttribute('src'),
            node.getAttribute('href'),
            node.getAttribute('data-src'),
            node.innerHTML,
        ].filter(Boolean).join(' ');
        return CONFIG.adHosts.some((host) => source.includes(host));
    }

    function createToolbar(labelText, statusText) {
        const toolbar = document.createElement('div');
        toolbar.className = 'ecg-toolbar';
        const label = document.createElement('span');
        label.className = 'ecg-toolbar-label';
        label.textContent = labelText;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = String(MIN_WIDTH);
        range.max = String(MAX_WIDTH);
        range.step = '10';
        range.value = String(getCardWidth());
        range.className = 'ecg-width-range';
        range.addEventListener('input', (event) => setCardWidth(Number(event.target.value)));
        const value = document.createElement('span');
        value.className = 'ecg-width-value';
        value.textContent = `${getCardWidth()}px`;
        const status = document.createElement('span');
        status.className = 'ecg-toolbar-status';
        status.textContent = statusText;
        toolbar.appendChild(label);
        toolbar.appendChild(range);
        toolbar.appendChild(value);
        toolbar.appendChild(status);
        return toolbar;
    }

    function setToolbarStatus(selector, text) {
        const target = document.querySelector(`${selector} .ecg-toolbar-status`);
        if (target) {
            target.textContent = text;
        }
    }

    function syncWidthControls(width) {
        document.querySelectorAll('.ecg-width-range').forEach((input) => {
            input.value = String(width);
        });
        document.querySelectorAll('.ecg-width-value').forEach((label) => {
            label.textContent = `${width}px`;
        });
    }

    function applyCardWidth(width) {
        document.documentElement.style.setProperty('--ecg-card-width', `${width}px`);
        syncWidthControls(width);
    }

    function setCardWidth(width) {
        const safeWidth = clamp(Number(width), MIN_WIDTH, MAX_WIDTH);
        localStorage.setItem(WIDTH_KEY, String(safeWidth));
        applyCardWidth(safeWidth);
    }

    function getCardWidth() {
        return clamp(Number(localStorage.getItem(WIDTH_KEY) || DEFAULT_WIDTH), MIN_WIDTH, MAX_WIDTH);
    }

    async function fetchDocument(url) {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return new DOMParser().parseFromString(await response.text(), 'text/html');
    }

    function getHighResUrl(image) {
        if (!(image instanceof Element)) {
            return '';
        }
        const baseUrl = image.ownerDocument?.baseURI || location.href;
        const candidates = [
            image.getAttribute('zoomfile'),
            image.getAttribute('file'),
            image.getAttribute('data-src'),
            image.getAttribute('data-original'),
            image.getAttribute('data-lazy-src'),
            getParentImageHref(image),
            image.getAttribute('src'),
        ];
        for (const value of candidates) {
            const normalized = stripHash(toAbsoluteUrl(value || '', baseUrl));
            if (normalized && isImageUrl(normalized) && !/loading\.jpg/i.test(normalized)) {
                return normalized;
            }
        }
        return '';
    }

    function getParentImageHref(image) {
        const href = image.closest('a[href]')?.getAttribute('href') || '';
        return isImageUrl(href) ? href : '';
    }

    function collectFeedUrls(root) {
        const urls = new Set();
        root.querySelectorAll('.leftp a[href]').forEach((anchor) => {
            urls.add(stripHash(toAbsoluteUrl(anchor.getAttribute('href') || '', location.href)));
        });
        return urls;
    }

    function findNextPageUrl(scope, baseUrl) {
        const nextLink = Array.from(scope.querySelectorAll('.pagination a[href]')).find((anchor) => /next/i.test(anchor.textContent));
        return nextLink ? stripHash(toAbsoluteUrl(nextLink.getAttribute('href') || '', baseUrl)) : '';
    }

    function readCurrentPageNumber(scope, url) {
        const currentText = scope?.querySelector('.pagination .current')?.textContent?.trim();
        const parsedCurrent = Number(currentText);
        return Number.isFinite(parsedCurrent) && parsedCurrent > 0 ? parsedCurrent : extractPageNumber(url, currentText || '');
    }

    function extractPageNumber(url, fallbackText = '') {
        try {
            const parsed = new URL(url, location.href);
            const pageValue = parsed.searchParams.get('page');
            const pageNumber = Number(pageValue);
            if (Number.isFinite(pageNumber) && pageNumber > 0) {
                return pageNumber;
            }
        } catch {
        }
        const numberFromText = Number((fallbackText || '').replace(/[^\d]/g, ''));
        return Number.isFinite(numberFromText) && numberFromText > 0 ? numberFromText : 1;
    }

    function getMeaningfulText(node) {
        return (node?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isImageUrl(url) {
        return /\.(?:jpe?g|png|webp|gif|bmp)(?:$|[?#])/i.test(url) || /files\.everiaclub\.com/i.test(url);
    }

    function toAbsoluteUrl(rawUrl, baseUrl) {
        if (!rawUrl) {
            return '';
        }
        try {
            return new URL(rawUrl, baseUrl || location.href).href;
        } catch {
            return '';
        }
    }

    function stripHash(url) {
        return String(url || '').replace(/#.*$/, '');
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function getTouchDistance(first, second) {
        return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    }

    function normalizeIndex(value, size) {
        if (!size) {
            return 0;
        }
        return ((value % size) + size) % size;
    }
})();
