// ==UserScript==
// @name         Discord LocalStorage 完整迁移工具
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  完整导出/导入 Discord LocalStorage 数据
// @author       Gemini
// @match        https://discord.com/*
// @grant        GM_download
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // 创建 UI 界面
    const container = document.createElement('div');
    container.style = "position:fixed;top:10px;left:10px;z-index:9999;background:#36393f;padding:10px;border-radius:8px;border:1px solid #5865f2;display:flex;flex-direction:column;gap:5px;";
    document.body.appendChild(container);

    const btnExport = document.createElement('button');
    btnExport.innerText = "📤 导出数据 (JSON)";
    btnExport.style = "cursor:pointer;background:#5865f2;color:white;border:none;padding:5px 10px;border-radius:4px;";

    const btnImport = document.createElement('button');
    btnImport.innerText = "📥 导入数据 (选择文件)";
    btnImport.style = "cursor:pointer;background:#43b581;color:white;border:none;padding:5px 10px;border-radius:4px;";

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style = "display:none;";

    container.appendChild(btnExport);
    container.appendChild(btnImport);
    container.appendChild(fileInput);

    // --- 导出逻辑 ---
    btnExport.onclick = () => {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            data[key] = localStorage.getItem(key);
        }

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `discord_backup_${new Date().getTime()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert("导出成功！请保存下载的 JSON 文件。");
    };

    // --- 导入逻辑 ---
    btnImport.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);

                // 清除当前存储（可选，建议先清理避免冲突）
                localStorage.clear();

                // 写入新数据
                Object.keys(data).forEach(key => {
                    localStorage.setItem(key, data[key]);
                });

                alert("✅ 导入成功！页面即将刷新。");
                location.reload();
            } catch (err) {
                alert("❌ 导入失败，文件格式不正确！");
                console.error(err);
            }
        };
        reader.readAsText(file);
    };
})();