export function resolveRetryAttempts(maxAttempts, fallback = 3) {
    const parsed = Number(maxAttempts);
    if (Number.isInteger(parsed) && parsed >= 1) {
        return parsed;
    }
    return Number.isInteger(fallback) && fallback >= 1 ? fallback : 3;
}

export function isRetryableNetworkError(error, { includeHttpStatus = true } = {}) {
    if (includeHttpStatus) {
        const status = Number(error?.httpStatus || error?.status || 0);
        if (status === 408 || status === 429 || status >= 500) {
            return true;
        }
    }

    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;
    return (
        message.includes('timeout')
        || message.includes('超时')
        || message.includes('network')
        || message.includes('网络')
        || message.includes('gm 请求失败')
        || message.includes('failed')
        || message.includes('中止')
        || message.includes('abort')
    );
}

export async function runWithRetries(task, {
    maxAttempts = 3,
    waitBaseMs = 700,
    isRetryable = isRetryableNetworkError,
    onRetry = null,
} = {}) {
    const attempts = resolveRetryAttempts(maxAttempts, 3);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await task(attempt, attempts);
        } catch (error) {
            lastError = error;
            const hasNext = attempt < attempts;
            if (!hasNext || !isRetryable(error)) {
                throw error;
            }
            const waitMs = Math.max(0, Number(waitBaseMs) || 0) * attempt;
            if (typeof onRetry === 'function') {
                await onRetry({ attempt, attempts, waitMs, error });
            }
            if (waitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        }
    }

    throw lastError || new Error('重试执行失败');
}
