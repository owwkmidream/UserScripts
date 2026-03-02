const DB_NAME = 'aifengyue_chat_store_v1';
const DB_VERSION = 1;

const STORE_APPS = 'apps';
const STORE_CHAINS = 'chains';
const STORE_MESSAGES = 'messages';

let dbPromise = null;

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
    });
}

function ensureIndexedDbAvailable() {
    if (typeof indexedDB === 'undefined') {
        throw new Error('当前环境不支持 IndexedDB');
    }
}

function openDb() {
    ensureIndexedDbAvailable();
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            if (!db.objectStoreNames.contains(STORE_APPS)) {
                const appStore = db.createObjectStore(STORE_APPS, { keyPath: 'appId' });
                appStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORE_CHAINS)) {
                const chainStore = db.createObjectStore(STORE_CHAINS, { keyPath: 'chainId' });
                chainStore.createIndex('appId', 'appId', { unique: false });
                chainStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
                const messageStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'storeKey' });
                messageStore.createIndex('appId', 'appId', { unique: false });
                messageStore.createIndex('chainId', 'chainId', { unique: false });
                messageStore.createIndex('conversationId', 'conversationId', { unique: false });
                messageStore.createIndex('chainId_createdAt', ['chainId', 'createdAt'], { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
    });

    return dbPromise;
}

async function withStore(storeName, mode, handler) {
    const db = await openDb();
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = await handler(store, tx);
    await txDone(tx);
    return result;
}

export const ChatHistoryStore = {
    DB_NAME,
    DB_VERSION,
    STORE_APPS,
    STORE_CHAINS,
    STORE_MESSAGES,

    async upsertApp(appRecord) {
        return withStore(STORE_APPS, 'readwrite', async (store) => {
            await requestToPromise(store.put(appRecord));
            return appRecord;
        });
    },

    async getApp(appId) {
        return withStore(STORE_APPS, 'readonly', (store) => requestToPromise(store.get(appId)));
    },

    async upsertChain(chainRecord) {
        return withStore(STORE_CHAINS, 'readwrite', async (store) => {
            await requestToPromise(store.put(chainRecord));
            return chainRecord;
        });
    },

    async getChain(chainId) {
        return withStore(STORE_CHAINS, 'readonly', (store) => requestToPromise(store.get(chainId)));
    },

    async listChainsByApp(appId) {
        return withStore(STORE_CHAINS, 'readonly', (store) => new Promise((resolve, reject) => {
            const list = [];
            const index = store.index('appId');
            const request = index.openCursor(IDBKeyRange.only(appId));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve(list);
                    return;
                }
                list.push(cursor.value);
                cursor.continue();
            };
            request.onerror = () => reject(request.error || new Error('读取链路失败'));
        }));
    },

    async putMessages(records) {
        if (!Array.isArray(records) || records.length === 0) return 0;
        return withStore(STORE_MESSAGES, 'readwrite', async (store) => {
            for (const record of records) {
                await requestToPromise(store.put(record));
            }
            return records.length;
        });
    },

    async listMessagesByChain(chainId) {
        return withStore(STORE_MESSAGES, 'readonly', (store) => new Promise((resolve, reject) => {
            const list = [];
            const index = store.index('chainId_createdAt');
            const range = IDBKeyRange.bound([chainId, Number.NEGATIVE_INFINITY], [chainId, Number.POSITIVE_INFINITY]);
            const request = index.openCursor(range);
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve(list);
                    return;
                }
                list.push(cursor.value);
                cursor.continue();
            };
            request.onerror = () => reject(request.error || new Error('读取消息失败'));
        }));
    },

    async listMessagesByConversation(conversationId) {
        return withStore(STORE_MESSAGES, 'readonly', (store) => new Promise((resolve, reject) => {
            const list = [];
            const index = store.index('conversationId');
            const request = index.openCursor(IDBKeyRange.only(conversationId));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve(list);
                    return;
                }
                list.push(cursor.value);
                cursor.continue();
            };
            request.onerror = () => reject(request.error || new Error('读取会话消息失败'));
        }));
    },
};

