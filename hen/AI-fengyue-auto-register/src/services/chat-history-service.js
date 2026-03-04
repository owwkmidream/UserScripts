import { INDEX_KEY } from './chat-history/shared.js';
import { chatHistoryIndexMethods } from './chat-history/index-store.js';
import { chatHistoryChainMethods } from './chat-history/chain-service.js';
import { chatHistoryBundleMethods } from './chat-history/bundle-service.js';
import { chatHistoryViewerMethods } from './chat-history/viewer-renderer.js';

export const ChatHistoryService = {
    INDEX_KEY,
    ...chatHistoryIndexMethods,
    ...chatHistoryChainMethods,
    ...chatHistoryBundleMethods,
    ...chatHistoryViewerMethods,
};
