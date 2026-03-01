export const gmGetValue = (key, defaultValue) => GM_getValue(key, defaultValue);
export const gmSetValue = (key, value) => GM_setValue(key, value);
export const gmRegisterMenuCommand = (name, handler) => GM_registerMenuCommand(name, handler);
export const gmXmlHttpRequest = (options) => GM_xmlhttpRequest(options);
export const gmAddStyle = (styles) => GM_addStyle(styles);
