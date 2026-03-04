import { APP_STATE } from '../../state.js';

export const VALID_TABS = ['register', 'tools', 'conversation', 'settings'];

export function getToast() {
    return APP_STATE.refs.toast;
}

export function getAutoRegister() {
    return APP_STATE.refs.autoRegister;
}

export function getIframeExtractor() {
    return APP_STATE.refs.iframeExtractor;
}

export function getModelPopupSorter() {
    return APP_STATE.refs.modelPopupSorter;
}
