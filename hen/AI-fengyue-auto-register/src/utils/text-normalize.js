export function normalizeTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) return asNumber;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

export function decodeEscapedText(raw) {
    if (typeof raw !== 'string') return '';

    let value = raw;
    for (let i = 0; i < 3; i++) {
        if (!/\\u[0-9a-fA-F]{4}|\\[nrt"\\/]/.test(value)) {
            break;
        }
        try {
            const next = JSON.parse(`"${value
                .replace(/"/g, '\\"')
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n')
                .replace(/\t/g, '\\t')}"`);
            if (next === value) break;
            value = next;
        } catch {
            break;
        }
    }
    return value;
}

export function hasMeaningfulText(value) {
    let normalized = '';
    if (value !== null && value !== undefined) {
        if (typeof value === 'string') {
            normalized = decodeEscapedText(value);
        } else {
            normalized = String(value);
        }
    }
    const lowered = normalized.trim().toLowerCase();
    if (!lowered) return false;
    if (lowered === 'null' || lowered === 'undefined' || lowered === '""' || lowered === "''") {
        return false;
    }
    return true;
}
