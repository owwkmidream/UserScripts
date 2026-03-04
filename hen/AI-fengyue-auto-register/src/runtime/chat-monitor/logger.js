const LOG_PREFIX = '[AI风月注册助手][CHAT_MONITOR]';

export function logInfo(message, meta) {
    if (meta === undefined) {
        console.log(`${LOG_PREFIX} ${message}`);
        return;
    }
    console.log(`${LOG_PREFIX} ${message}`, meta);
}

export function logWarn(message, meta) {
    if (meta === undefined) {
        console.warn(`${LOG_PREFIX} ${message}`);
        return;
    }
    console.warn(`${LOG_PREFIX} ${message}`, meta);
}
