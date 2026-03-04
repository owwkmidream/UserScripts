# services

## 模块结构

- `api-service.js`：API 调用与用量统计，提供用量订阅能力（不再直接依赖 UI）。
- `chat-history-service.js`：会话链兼容门面，聚合 `chat-history/` 子模块。
- `chat-history/`：按职责拆分为 `shared.js`、`index-store.js`、`chain-service.js`、`bundle-service.js`、`viewer-renderer.js`。
- `chat-history-store.js`：IndexedDB 持久化底层。

## 📥 CDN 下载导航

根据您的网络环境选择合适的 CDN 源：

- [🔗 **GitHub Raw**](#github-raw) - GitHub 官方原始链接，稳定可靠，但国内访问可能较慢
- [🚀 **jsDelivr**](#jsdelivr) - 全球 CDN 加速，速度快，但更新可能有延迟（最多 24 小时）
- [⚡ **Statically**](#statically) - 静态资源 CDN，全球节点，更新较快
- [🇨🇳 **GitMirror**](#gitmirror) - 国内镜像，大陆访问稳定快速，更新及时
- [🌐 **ghfast**](#ghfast) - 国内代理，实时同步 GitHub，大陆访问友好
- [🔥 **Raw.Githack**](#raw-githack) - 实时更新的 CDN，内容同步最快，适合需要最新版本的用户

---

## 🔗 GitHub Raw
<a id="github-raw"></a>

> GitHub 官方原始链接，稳定可靠，但国内访问可能较慢

| 脚本名称 | 下载链接 |
| :--- | :--- |
| api-service.js | [📥 安装](https://github.com/owwkmidream/UserScripts/raw/master/hen/AI-fengyue-auto-register/src/services/api-service.js) |
| chat-history-service.js | [📥 安装](https://github.com/owwkmidream/UserScripts/raw/master/hen/AI-fengyue-auto-register/src/services/chat-history-service.js) |
| chat-history-store.js | [📥 安装](https://github.com/owwkmidream/UserScripts/raw/master/hen/AI-fengyue-auto-register/src/services/chat-history-store.js) |

[⬆️ 返回导航](#-cdn-下载导航)

---

## 🚀 jsDelivr
<a id="jsdelivr"></a>

> 全球 CDN 加速，速度快，但更新可能有延迟（最多 24 小时）

| 脚本名称 | 下载链接 |
| :--- | :--- |
| api-service.js | [📥 安装](https://cdn.jsdelivr.net/gh/owwkmidream/UserScripts@master/hen/AI-fengyue-auto-register/src/services/api-service.js) |
| chat-history-service.js | [📥 安装](https://cdn.jsdelivr.net/gh/owwkmidream/UserScripts@master/hen/AI-fengyue-auto-register/src/services/chat-history-service.js) |
| chat-history-store.js | [📥 安装](https://cdn.jsdelivr.net/gh/owwkmidream/UserScripts@master/hen/AI-fengyue-auto-register/src/services/chat-history-store.js) |

[⬆️ 返回导航](#-cdn-下载导航)

---

## ⚡ Statically
<a id="statically"></a>

> 静态资源 CDN，全球节点，更新较快

| 脚本名称 | 下载链接 |
| :--- | :--- |
| api-service.js | [📥 安装](https://cdn.statically.io/gh/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/api-service.js) |
| chat-history-service.js | [📥 安装](https://cdn.statically.io/gh/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-service.js) |
| chat-history-store.js | [📥 安装](https://cdn.statically.io/gh/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-store.js) |

[⬆️ 返回导航](#-cdn-下载导航)

---

## 🇨🇳 GitMirror
<a id="gitmirror"></a>

> 国内镜像，大陆访问稳定快速，更新及时

| 脚本名称 | 下载链接 |
| :--- | :--- |
| api-service.js | [📥 安装](https://raw.gitmirror.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/api-service.js) |
| chat-history-service.js | [📥 安装](https://raw.gitmirror.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-service.js) |
| chat-history-store.js | [📥 安装](https://raw.gitmirror.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-store.js) |

[⬆️ 返回导航](#-cdn-下载导航)

---

## 🌐 ghfast
<a id="ghfast"></a>

> 国内代理，实时同步 GitHub，大陆访问友好

| 脚本名称 | 下载链接 |
| :--- | :--- |
| api-service.js | [📥 安装](https://ghfast.top/https://raw.githubusercontent.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/api-service.js) |
| chat-history-service.js | [📥 安装](https://ghfast.top/https://raw.githubusercontent.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-service.js) |
| chat-history-store.js | [📥 安装](https://ghfast.top/https://raw.githubusercontent.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-store.js) |

[⬆️ 返回导航](#-cdn-下载导航)

---

## 🔥 Raw.Githack
<a id="raw-githack"></a>

> 实时更新的 CDN，内容同步最快，适合需要最新版本的用户

| 脚本名称 | 下载链接 |
| :--- | :--- |
| api-service.js | [📥 安装](https://raw.githack.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/api-service.js) |
| chat-history-service.js | [📥 安装](https://raw.githack.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-service.js) |
| chat-history-store.js | [📥 安装](https://raw.githack.com/owwkmidream/UserScripts/master/hen/AI-fengyue-auto-register/src/services/chat-history-store.js) |

[⬆️ 返回导航](#-cdn-下载导航)

---
