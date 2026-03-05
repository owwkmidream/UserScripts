import { CONFIG } from '../constants.js';
import { gmGetValue, gmSetValue } from '../gm.js';

const FAMILY_QUALIFIERS = new Set([
    'low',
    'high',
    'preview',
    'thinking',
    'nothinking',
    'non',
    'reasoning',
    'nonreasoning',
    'latest',
    'exp',
]);

const DEFAULT_MODEL_FAMILY_RULES_TEXT = [
    'gemini-3.1-pro|Gemini 3.1 Pro|高智',
    'gemini-3-pro|Gemini 3 Pro|高智',
    'gemini-2.5-pro|Gemini 2.5 Pro|高智',
    'gemini-3-flash|Gemini 3 Flash|速度',
    'gemini-2.5-flash|Gemini 2.5 Flash|速度',
].join('\n');

function normalizeRulePrefix(prefix) {
    return String(prefix || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function normalizeFamilyKey(raw) {
    return normalizeRulePrefix(raw).replace(/\./g, '-');
}

function normalizeFamilyLabel(raw) {
    return String(raw || '')
        .trim()
        .replace(/\s+/g, ' ');
}

function parseRuleLine(line) {
    const raw = String(line || '').trim();
    if (!raw || raw.startsWith('#')) return null;

    let prefix = '';
    let label = '';
    let position = '';

    if (raw.includes('=>')) {
        const [left, right] = raw.split('=>', 2).map((part) => part.trim());
        prefix = left || '';
        const rightParts = (right || '').split('|').map((part) => part.trim());
        label = rightParts[0] || '';
        position = rightParts[1] || '';
    } else {
        const parts = raw.split('|').map((part) => part.trim());
        prefix = parts[0] || '';
        label = parts[1] || '';
        position = parts[2] || '';
    }

    const normalizedPrefix = normalizeRulePrefix(prefix);
    if (!normalizedPrefix) return null;

    return {
        prefix: normalizedPrefix,
        key: normalizeFamilyKey(normalizedPrefix),
        label: normalizeFamilyLabel(label || normalizedPrefix),
        position: normalizeFamilyLabel(position),
        source: 'custom',
    };
}

export const ModelPopupSorter = {
    sortScheduled: false,
    popupObserver: null,
    observedPopup: null,
    activeModelFamilyKey: '',
    familyTagRenderSignature: '',
    unknownPrefixStats: new Map(),

    normalizeSortMetric(metric) {
        const value = String(metric || '').trim();
        return value === 'price' ? 'price' : 'outputRate';
    },

    normalizeSortDirection(direction) {
        const value = String(direction || '').trim();
        return value === 'asc' ? 'asc' : 'desc';
    },

    getSortMetric() {
        return this.normalizeSortMetric(
            gmGetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_METRIC, 'price')
        );
    },

    setSortMetric(metric) {
        this.setSortState(metric, this.getSortDirection());
    },

    getSortDirection() {
        return this.normalizeSortDirection(
            gmGetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_DIRECTION, 'asc')
        );
    },

    setSortDirection(direction) {
        this.setSortState(this.getSortMetric(), direction);
    },

    setSortState(metric, direction) {
        const normalizedMetric = this.normalizeSortMetric(metric);
        const normalized = this.normalizeSortDirection(direction);
        gmSetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_METRIC, normalizedMetric);
        gmSetValue(CONFIG.STORAGE_KEYS.MODEL_POPUP_SORT_DIRECTION, normalized);
        this.familyTagRenderSignature = '';
        this.scheduleSort();
    },

    getSortState() {
        return {
            metric: this.getSortMetric(),
            direction: this.getSortDirection(),
        };
    },

    isSortEnabled() {
        return gmGetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, true);
    },

    setSortEnabled(enabled) {
        gmSetValue(CONFIG.STORAGE_KEYS.MODEL_SORT_ENABLED, !!enabled);
    },

    isEnabled() {
        return this.isSortEnabled();
    },

    getDefaultModelFamilyRulesText() {
        return DEFAULT_MODEL_FAMILY_RULES_TEXT;
    },

    getModelFamilyRulesText() {
        return String(
            gmGetValue(CONFIG.STORAGE_KEYS.MODEL_FAMILY_CUSTOM_RULES, this.getDefaultModelFamilyRulesText()) || ''
        );
    },

    setModelFamilyRulesText(text) {
        const normalized = String(text || '')
            .replace(/\r\n/g, '\n')
            .trim();
        gmSetValue(CONFIG.STORAGE_KEYS.MODEL_FAMILY_CUSTOM_RULES, normalized);
        this.activeModelFamilyKey = '';
        this.familyTagRenderSignature = '';
        this.scheduleSort();
    },

    resetModelFamilyRulesText() {
        this.setModelFamilyRulesText(this.getDefaultModelFamilyRulesText());
    },

    // backward compatibility for existing callers
    getCustomModelFamilyRulesText() {
        return this.getModelFamilyRulesText();
    },

    // backward compatibility for existing callers
    setCustomModelFamilyRulesText(text) {
        this.setModelFamilyRulesText(text);
    },

    resetPopupState() {
        if (this.popupObserver) {
            this.popupObserver.disconnect();
            this.popupObserver = null;
        }
        this.observedPopup = null;
        const existingTagBar = document.getElementById('aifengyue-model-family-tags');
        if (existingTagBar) existingTagBar.remove();
        this.activeModelFamilyKey = '';
        this.familyTagRenderSignature = '';
    },

    scheduleSort() {
        if (!this.isEnabled()) {
            this.resetPopupState();
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
        this.familyTagRenderSignature = '';
    },

    findPopup() {
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

    parseRulesText() {
        const text = this.getModelFamilyRulesText();
        if (!text.trim()) return [];
        const rules = [];
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            const parsed = parseRuleLine(line);
            if (!parsed) continue;
            rules.push(parsed);
        }
        return rules;
    },

    getActiveFamilyRules() {
        const combined = this.parseRulesText().filter((rule) => !!rule.prefix);
        combined.sort((a, b) => b.prefix.length - a.prefix.length);
        return combined;
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

    extractModelName(itemEl) {
        if (!itemEl) return '';

        const titleRow = itemEl.querySelector('.text-xs.font-medium');
        if (titleRow) {
            const spans = Array.from(titleRow.querySelectorAll('span'));
            for (const span of spans) {
                const text = (span.textContent || '').trim();
                if (!text) continue;
                if (text === '当前模型' || text === '推荐模型' || text === '作者设置') continue;
                return text;
            }
        }

        const text = (itemEl.textContent || '').replace(/\s+/g, ' ');
        const textMatch = text.match(/([A-Za-z0-9._-]+)\s+价格系数[：:]/);
        if (textMatch) return textMatch[1].trim();
        return '';
    },

    normalizeHeuristicFamily(modelName) {
        const raw = String(modelName || '').trim().toLowerCase();
        if (!raw) return { key: '', label: '' };

        const tokens = raw.split(/[\s_-]+/).map((token) => token.trim()).filter(Boolean);
        const filtered = tokens.filter((token) => !FAMILY_QUALIFIERS.has(token));
        const keyTokens = filtered.length ? filtered : tokens;
        const key = normalizeFamilyKey(keyTokens.join('-'));
        const label = keyTokens.join(' ').trim();
        return { key, label };
    },

    deriveUnknownPrefix(modelName) {
        const value = normalizeRulePrefix(String(modelName || ''));
        if (!value) return '';
        const gemini = value.match(/^gemini-\d+(?:\.\d+)?-(?:pro|flash)/);
        if (gemini) return gemini[0];
        const gpt = value.match(/^gpt-\d+(?:\.\d+)?(?:-(?:mini|nano|chat-latest))?/);
        if (gpt) return gpt[0];
        const claude = value.match(/^claude-(?:opus|sonnet|haiku)-\d+(?:-\d+)?/);
        if (claude) return claude[0];
        const grok = value.match(/^grok-\d+(?:\.\d+)?(?:-fast)?/);
        if (grok) return grok[0];
        const deepseek = value.match(/^deepseek-[a-z0-9.]+/);
        if (deepseek) return deepseek[0];
        const fallbackTokens = value.split('-').filter(Boolean);
        return fallbackTokens.slice(0, Math.min(3, fallbackTokens.length)).join('-');
    },

    prettifyPrefixLabel(prefix) {
        return String(prefix || '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    recordUnknownPrefix(prefix, sampleName = '') {
        const normalized = normalizeRulePrefix(prefix);
        if (!normalized) return;
        const current = this.unknownPrefixStats.get(normalized) || {
            count: 0,
            sample: '',
        };
        current.count += 1;
        if (!current.sample && sampleName) {
            current.sample = sampleName;
        }
        this.unknownPrefixStats.set(normalized, current);
    },

    buildUnknownMappingDraft(limit = 50) {
        const rows = [...this.unknownPrefixStats.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, Math.max(1, Number(limit) || 50))
            .map(([prefix]) => `${prefix}|${this.prettifyPrefixLabel(prefix)}|未分类`);
        return rows.join('\n');
    },

    getUnknownModelFamilySuggestionText(limit = 50) {
        return this.buildUnknownMappingDraft(limit);
    },

    resolveModelFamily(modelName, rules) {
        const normalized = normalizeRulePrefix(modelName);
        for (const rule of rules) {
            if (!rule.prefix || !normalized.startsWith(rule.prefix)) continue;
            const label = rule.position
                ? `${rule.label}（${rule.position}）`
                : rule.label;
            return {
                key: `rule:${rule.key}`,
                label,
                mapped: true,
            };
        }

        const unknownPrefix = this.deriveUnknownPrefix(modelName);
        this.recordUnknownPrefix(unknownPrefix, modelName);
        return {
            key: 'unknown:others',
            label: '未映射',
            mapped: false,
        };
    },

    findCategoryBlocks(popup) {
        const blocks = Array.from(popup.querySelectorAll('div.w-full.cursor-pointer.block'));
        return blocks.filter((block) => Boolean(
            block.querySelector('.MuiAccordionSummary-root') &&
            block.querySelector('.MuiAccordionDetails-root') &&
            (block.textContent || '').includes('价格系数')
        ));
    },

    buildCategoryMeta(block, blockIndex, rules) {
        const details = block.querySelector('.MuiAccordionDetails-root');
        if (!details) return null;

        const items = Array.from(details.children).filter((child) => {
            return child.nodeType === 1 && (child.textContent || '').includes('价格系数');
        });
        if (items.length === 0) return null;

        const itemMetas = items.map((item, index) => {
            const modelName = this.extractModelName(item);
            const family = this.resolveModelFamily(modelName, rules);
            return {
                item,
                index,
                modelName,
                price: this.extractPrice(item),
                outputRate: this.extractOutputRate(item),
                familyKey: family.key,
                familyLabel: family.label,
                mapped: family.mapped,
            };
        });

        return {
            block,
            blockIndex,
            details,
            itemMetas,
        };
    },

    compareItemMetas(a, b, sortState) {
        const metric = sortState?.metric === 'price' ? 'price' : 'outputRate';
        const direction = sortState?.direction === 'asc' ? 'asc' : 'desc';
        const primaryA = metric === 'price' ? a.price : a.outputRate;
        const primaryB = metric === 'price' ? b.price : b.outputRate;
        if (primaryA !== primaryB) {
            if (direction === 'asc') return primaryA - primaryB;
            return primaryB - primaryA;
        }

        // 次级指标保持“出字率高优先 + 价格低优先”，避免同值时顺序抖动
        if (a.outputRate !== b.outputRate) return b.outputRate - a.outputRate;
        if (a.price !== b.price) return a.price - b.price;
        return a.index - b.index;
    },

    sortItemsInCategory(meta, sortState) {
        const sorted = [...meta.itemMetas].sort((a, b) => this.compareItemMetas(a, b, sortState));

        const needReorder = sorted.some((entry, index) => entry.item !== meta.itemMetas[index].item);
        if (!needReorder) return;

        const frag = document.createDocumentFragment();
        sorted.forEach((entry) => frag.appendChild(entry.item));
        meta.details.appendChild(frag);
        meta.itemMetas = sorted;
    },

    buildFamilyTagGroups(metas) {
        const groupMap = new Map();
        metas.forEach((meta) => {
            meta.itemMetas.forEach((itemMeta) => {
                if (!itemMeta.familyKey) return;
                if (!groupMap.has(itemMeta.familyKey)) {
                    groupMap.set(itemMeta.familyKey, {
                        key: itemMeta.familyKey,
                        label: itemMeta.familyLabel || '未分类',
                        count: 0,
                    });
                }
                const group = groupMap.get(itemMeta.familyKey);
                group.count += 1;
            });
        });
        return [...groupMap.values()].sort((a, b) => {
            if (a.count !== b.count) return b.count - a.count;
            return a.label.localeCompare(b.label);
        });
    },

    ensureFamilyTagBar(popup, listContainer) {
        if (!popup || !listContainer) return null;
        let bar = popup.querySelector('#aifengyue-model-family-tags');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'aifengyue-model-family-tags';
            bar.style.cssText = [
                'margin:6px 0 10px',
                'padding:8px 10px',
                'border:1px solid #e2e8f0',
                'border-radius:10px',
                'background:#f8fafc',
                'display:flex',
                'flex-wrap:wrap',
                'gap:6px',
                'align-items:center',
                'position:relative',
                'z-index:2',
            ].join(';');
            bar.addEventListener('click', (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;

                const metricBtn = target.closest('button[data-sort-metric]');
                if (metricBtn) {
                    const nextMetric = metricBtn.getAttribute('data-sort-metric') || '';
                    if (!nextMetric) return;
                    const current = this.getSortState();
                    if (nextMetric === current.metric) {
                        const nextDirection = current.direction === 'asc' ? 'desc' : 'asc';
                        this.setSortState(nextMetric, nextDirection);
                    } else {
                        this.setSortState(nextMetric, 'asc');
                    }
                    return;
                }

                const btn = target.closest('button[data-family-key]');
                if (!btn) return;
                const nextKey = (btn.getAttribute('data-family-key') || '').trim();
                if (nextKey === this.activeModelFamilyKey) return;
                this.activeModelFamilyKey = nextKey;
                this.sortPopup();
            });
        }

        const parent = listContainer.parentElement;
        if (!parent) return bar;
        if (bar.parentElement !== parent || bar.nextElementSibling !== listContainer) {
            parent.insertBefore(bar, listContainer);
        }
        return bar;
    },

    renderFamilyTagBar(bar, groups, activeKey, sortState) {
        if (!bar) return;
        const normalizedActive = String(activeKey || '').trim();
        const currentSortMetric = sortState?.metric === 'price' ? 'price' : 'outputRate';
        const currentSortDirection = sortState?.direction === 'asc' ? 'asc' : 'desc';
        const signature = JSON.stringify({
            active: normalizedActive,
            metric: currentSortMetric,
            direction: currentSortDirection,
            groups: groups.map((group) => [group.key, group.count]),
        });
        if (signature === this.familyTagRenderSignature) return;
        this.familyTagRenderSignature = signature;

        const buildBtn = (key, label, count, active) => {
            const background = active ? '#0f766e' : '#f1f5f9';
            const color = active ? '#ffffff' : '#334155';
            const border = active ? '#0f766e' : '#cbd5e1';
            return [
                `<button type="button" data-family-key="${key}"`,
                ` style="border:1px solid ${border};background:${background};color:${color};`,
                'height:26px;padding:0 10px;border-radius:999px;font-size:12px;line-height:1;',
                'display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;">',
                `<span>${label}</span><span style="opacity:0.85;">${count}</span></button>`,
            ].join('');
        };

        const total = groups.reduce((sum, group) => sum + group.count, 0);
        const allBtn = buildBtn('', '全部', total, !normalizedActive);
        const groupBtns = groups.map((group) => buildBtn(group.key, group.label, group.count, normalizedActive === group.key)).join('');

        const buildSortBtn = (attrName, value, label, active) => {
            const background = active ? '#0369a1' : '#eef2ff';
            const color = active ? '#ffffff' : '#1e3a8a';
            const border = active ? '#0369a1' : '#c7d2fe';
            return [
                `<button type="button" ${attrName}="${value}"`,
                ` style="border:1px solid ${border};background:${background};color:${color};`,
                'height:26px;padding:0 10px;border-radius:999px;font-size:12px;line-height:1;',
                'display:inline-flex;align-items:center;cursor:pointer;white-space:nowrap;">',
                `<span>${label}</span></button>`,
            ].join('');
        };
        const priceLabel = currentSortMetric === 'price'
            ? `价格 ${currentSortDirection === 'asc' ? '↑' : '↓'}`
            : '价格';
        const outputRateLabel = currentSortMetric === 'outputRate'
            ? `出字率 ${currentSortDirection === 'asc' ? '↑' : '↓'}`
            : '出字率';
        const metricPriceBtn = buildSortBtn('data-sort-metric', 'price', priceLabel, currentSortMetric === 'price');
        const metricRateBtn = buildSortBtn('data-sort-metric', 'outputRate', outputRateLabel, currentSortMetric === 'outputRate');

        bar.innerHTML = [
            '<span style="font-size:12px;font-weight:700;color:#334155;margin-right:2px;">排序</span>',
            metricPriceBtn,
            metricRateBtn,
            '<span style="width:1px;height:16px;background:#cbd5e1;margin:0 2px;"></span>',
            '<span style="font-size:12px;font-weight:700;color:#334155;margin-right:2px;">模型类型</span>',
            allBtn,
            groupBtns,
        ].join('');
    },

    applyFamilyFilter(metas, familyKey) {
        const target = String(familyKey || '').trim();
        metas.forEach((meta) => {
            let visibleCount = 0;
            meta.itemMetas.forEach((itemMeta) => {
                const visible = !target || itemMeta.familyKey === target;
                itemMeta.item.style.display = visible ? '' : 'none';
                if (visible) visibleCount += 1;
            });
            meta.block.style.display = visibleCount > 0 ? '' : 'none';
        });
    },

    resolveCategorySortMetrics(meta, familyKey, sortState) {
        const target = String(familyKey || '').trim();
        const source = target
            ? meta.itemMetas.filter((itemMeta) => itemMeta.familyKey === target)
            : meta.itemMetas;
        if (source.length === 0) {
            return {
                hasVisible: false,
                best: null,
            };
        }

        let best = source[0];
        for (let index = 1; index < source.length; index += 1) {
            const current = source[index];
            if (this.compareItemMetas(current, best, sortState) < 0) {
                best = current;
            }
        }
        return {
            hasVisible: true,
            best,
        };
    },

    sortPopup() {
        const popup = this.findPopup();
        if (!popup) {
            this.resetPopupState();
            return;
        }
        this.observePopup(popup);

        const blocks = this.findCategoryBlocks(popup);
        if (blocks.length === 0) {
            const existingTagBar = popup.querySelector('#aifengyue-model-family-tags');
            if (existingTagBar) existingTagBar.remove();
            this.familyTagRenderSignature = '';
            return;
        }

        const parent = blocks[0].parentElement;
        if (!parent) return;

        this.unknownPrefixStats = new Map();
        const rules = this.getActiveFamilyRules();
        const sortState = this.getSortState();
        const metas = blocks
            .map((block, index) => this.buildCategoryMeta(block, index, rules))
            .filter(Boolean);
        if (metas.length === 0) return;

        metas.forEach((meta) => this.sortItemsInCategory(meta, sortState));

        const groups = this.buildFamilyTagGroups(metas);
        if (!groups.some((group) => group.key === this.activeModelFamilyKey)) {
            this.activeModelFamilyKey = '';
        }

        const tagBar = this.ensureFamilyTagBar(popup, parent);
        this.renderFamilyTagBar(tagBar, groups, this.activeModelFamilyKey, sortState);
        this.applyFamilyFilter(metas, this.activeModelFamilyKey);

        const metricsMap = new Map();
        metas.forEach((meta) => {
            metricsMap.set(meta, this.resolveCategorySortMetrics(meta, this.activeModelFamilyKey, sortState));
        });

        const sortedCategories = [...metas].sort((a, b) => {
            const aMetrics = metricsMap.get(a);
            const bMetrics = metricsMap.get(b);
            if (aMetrics.hasVisible !== bMetrics.hasVisible) {
                return aMetrics.hasVisible ? -1 : 1;
            }
            if (!aMetrics.best || !bMetrics.best) return a.blockIndex - b.blockIndex;
            const categoryCompare = this.compareItemMetas(aMetrics.best, bMetrics.best, sortState);
            if (categoryCompare !== 0) return categoryCompare;
            return a.blockIndex - b.blockIndex;
        });

        const needReorder = sortedCategories.some((meta, index) => meta.block !== metas[index].block);
        if (!needReorder) return;

        const frag = document.createDocumentFragment();
        sortedCategories.forEach((meta) => frag.appendChild(meta.block));
        parent.appendChild(frag);
    },
};
