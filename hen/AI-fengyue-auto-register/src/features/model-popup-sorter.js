import { IframeExtractor } from './iframe-extractor.js';
import { CONFIG } from '../constants.js';
import { gmGetValue, gmSetValue } from '../gm.js';

export const ModelPopupSorter = {
    sortScheduled: false,
    popupObserver: null,
    observedPopup: null,

    isSortEnabled() {
        return gmGetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, true);
    },

    setSortEnabled(enabled) {
        gmSetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, !!enabled);
    },

    isEnabled() {
        return this.isSortEnabled() && IframeExtractor.checkDetailPage();
    },

    scheduleSort() {
        if (!this.isEnabled()) {
            if (this.popupObserver) {
                this.popupObserver.disconnect();
                this.popupObserver = null;
            }
            this.observedPopup = null;
            return;
        }
        if (this.sortScheduled) return;
        this.sortScheduled = true;

        requestAnimationFrame(() => {
            this.sortScheduled = false;
            this.sortPopup();
        });
    },

    observePopup(popup) {
        if (!popup) return;
        if (this.observedPopup === popup && this.popupObserver) return;

        if (this.popupObserver) {
            this.popupObserver.disconnect();
            this.popupObserver = null;
        }

        this.observedPopup = popup;
        this.popupObserver = new MutationObserver(() => {
            this.scheduleSort();
        });
        this.popupObserver.observe(popup, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'aria-selected', 'aria-expanded'],
        });
    },

    findPopup() {
        let popup = document.querySelector('div[id=":rb0:"][data-floating-ui-portal]');
        if (popup) return popup;

        const portals = document.querySelectorAll('div[data-floating-ui-portal]');
        for (const portal of portals) {
            const hasTabs = portal.querySelector('[role="tablist"]');
            if (!hasTabs) continue;
            if ((portal.textContent || '').includes('价格系数')) {
                return portal;
            }
        }
        return null;
    },

    extractPrice(itemEl) {
        if (!itemEl) return Number.POSITIVE_INFINITY;

        const text = (itemEl.textContent || '').replace(/\s+/g, ' ');
        const textMatch = text.match(/价格系数[：:]\s*([0-9]+(?:\.[0-9]+)?)/);
        if (textMatch) {
            const value = parseFloat(textMatch[1]);
            if (Number.isFinite(value)) return value;
        }

        const titleNode = itemEl.querySelector('span[title]');
        if (titleNode) {
            const titleValue = parseFloat(titleNode.getAttribute('title') || '');
            if (Number.isFinite(titleValue)) return titleValue;
        }

        return Number.POSITIVE_INFINITY;
    },

    extractOutputRate(itemEl) {
        if (!itemEl) return -1;

        const text = (itemEl.textContent || '').replace(/\s+/g, ' ');
        const textMatch = text.match(/近期出字率[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
        if (textMatch) {
            const value = parseFloat(textMatch[1]);
            if (Number.isFinite(value)) return value;
        }

        return -1;
    },

    findCategoryBlocks(popup) {
        const blocks = Array.from(popup.querySelectorAll('div.w-full.cursor-pointer.block'));
        return blocks.filter((block) => Boolean(
            block.querySelector('.MuiAccordionSummary-root') &&
            block.querySelector('.MuiAccordionDetails-root') &&
            (block.textContent || '').includes('价格系数')
        ));
    },

    buildCategoryMeta(block, blockIndex) {
        const details = block.querySelector('.MuiAccordionDetails-root');
        if (!details) return null;

        const items = Array.from(details.children).filter((child) => {
            return child.nodeType === 1 && (child.textContent || '').includes('价格系数');
        });
        if (items.length === 0) return null;

        const itemMetas = items.map((item, index) => ({
            item,
            index,
            price: this.extractPrice(item),
            outputRate: this.extractOutputRate(item),
        }));

        const minPrice = itemMetas.reduce((min, meta) => Math.min(min, meta.price), Number.POSITIVE_INFINITY);
        const maxOutputRate = itemMetas.reduce((max, meta) => Math.max(max, meta.outputRate), -1);

        return {
            block,
            blockIndex,
            details,
            itemMetas,
            minPrice,
            maxOutputRate,
        };
    },

    sortItemsInCategory(meta) {
        const sorted = [...meta.itemMetas].sort((a, b) => {
            if (a.outputRate !== b.outputRate) return b.outputRate - a.outputRate;
            if (a.price !== b.price) return a.price - b.price;
            return a.index - b.index;
        });

        const needReorder = sorted.some((entry, index) => entry.item !== meta.itemMetas[index].item);
        if (!needReorder) return;

        const frag = document.createDocumentFragment();
        sorted.forEach((entry) => frag.appendChild(entry.item));
        meta.details.appendChild(frag);
    },

    sortPopup() {
        const popup = this.findPopup();
        if (!popup) {
            if (this.popupObserver) {
                this.popupObserver.disconnect();
                this.popupObserver = null;
            }
            this.observedPopup = null;
            return;
        }
        this.observePopup(popup);

        const blocks = this.findCategoryBlocks(popup);
        if (blocks.length === 0) return;

        const parent = blocks[0].parentElement;
        if (!parent) return;

        const metas = blocks
            .map((block, index) => this.buildCategoryMeta(block, index))
            .filter(Boolean);

        if (metas.length === 0) return;

        metas.forEach((meta) => this.sortItemsInCategory(meta));

        const sortedCategories = [...metas].sort((a, b) => {
            if (a.maxOutputRate !== b.maxOutputRate) return b.maxOutputRate - a.maxOutputRate;
            if (a.minPrice !== b.minPrice) return a.minPrice - b.minPrice;
            return a.blockIndex - b.blockIndex;
        });

        const needReorderCategory = sortedCategories.some((entry, index) => entry.block !== metas[index].block);
        if (!needReorderCategory) return;

        const frag = document.createDocumentFragment();
        sortedCategories.forEach((entry) => frag.appendChild(entry.block));
        parent.appendChild(frag);
    },
};
