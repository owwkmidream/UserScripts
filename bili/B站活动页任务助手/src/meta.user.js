// ==UserScript==
// @name         B站活动页任务助手
// @namespace    http://tampermonkey.net/
// @version      5.7
// @description  悬浮面板，Tabs标签切换，活动稿件投稿打卡与统计。
// @author       Gemini_Refactored
// @include      /^https:\/\/www\.bilibili\.com\/blackboard\/era\/[a-zA-Z0-9]+\.html$/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/blueimp-md5/2.19.0/js/md5.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
// @connect      api.bilibili.com
// @connect      member.bilibili.com
// @connect      api.live.bilibili.com
// @run-at       document-end
// ==/UserScript==
