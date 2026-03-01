import { SIDEBAR_INITIAL_STATE } from './constants.js';

export const APP_STATE = {
    refs: {
        toast: null,
        sidebar: null,
        autoRegister: null,
        iframeExtractor: null,
        modelPopupSorter: null,
    },
    sidebar: {
        state: { ...SIDEBAR_INITIAL_STATE },
    },
    spa: {
        observer: null,
        lastUrl: '',
        checkScheduled: false,
    },
};
