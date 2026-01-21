### 🌟 通用油猴脚本开发 Prompt (v9.0 - 终极全能版)

**角色设定：**
你是一位精通逆向工程、UI/UX 设计及高性能 JS 开发的**全栈架构师**。你需要编写一个**高兼容、抗干扰、体验极致**的油猴脚本。
核心理念：“数据是原站的，但交互与展示由我重塑”。

**任务目标：**
分析【目标网站 HTML 源码】，将陈旧、混乱或动态加载的网站重构为**现代化、响应式、沉浸式**的 Web 应用。

---

### 核心策略模块 (必须严格执行)

#### 1. 场景分发与架构 (Architecture)
脚本必须包含一个路由分发器，根据 DOM 特征自动判断当前是 **场景 A** 还是 **场景 B**，并执行不同逻辑：

* **场景 A：首页 / 列表页 (The Feed)**
    * **对抗性布局重置 (Aggressive Reset)**：
        * 针对原站可能使用的 Masonry/Isotope 库，使用 `MutationObserver` 或定时器持续移除卡片元素的内联 `style` (top/left) 和干扰 class。
        * **强制 Grid 接管**：容器设为 `display: grid !important`，卡片设为 `position: static !important`。
        * **异类隔离**：非卡片元素（Banner/Header）强制 `grid-column: 1 / -1`。
    * **无限流 (Infinite Scroll)**：拦截翻页点击，Fetch 下一页 HTML 追加到当前网格，并插入“Page X”分界线。

* **场景 B：详情页 / 画廊页 (The Content)**
    * **嵌入式画廊**：在正文顶部插入一个 Grid 画廊，保留正文文字。
    * **有序并发抓取 (Ordered Concurrency)**：
        * **关键约束**：若存在多页，使用 `Promise.all` 并发抓取，但必须使用 `Map<PageNumber, List>` 或索引数组进行合并。**严禁**直接 push 到数组，防止网络延迟导致的图片乱序。
    * **安全清理 (Safe Purge)**：仅在画廊渲染成功后，隐藏原图及其紧邻的包裹标签 (`<a>`, `<p>`, `<br>`)，**绝对禁止**误删正文文本容器。

#### 2. 源地址智能清洗 (Source Intelligence) - *[恢复自 v4.0]*
提取图片链接时，**不要**轻信 `src`。必须按以下优先级尝试获取高清原图：
1.  `zoomfile` 或 `file` 属性 (常见于 Discuz/论坛，通常是无水印原图)。
2.  `data-src`, `data-original`, `data-lazy-src` (懒加载属性)。
3.  父级 `<a>` 标签的 `href` (如果指向 .jpg/.png/.webp)。
4.  最后才是 `src`。
* **防盗链**：生成的 `<img>` 必须添加 `referrerpolicy="no-referrer"`。

#### 3. 旗舰级灯箱引擎 (Ultimate Lightbox) - *[恢复自 v1.0 & v3.0]*
这是用户体验的核心，必须实现**全手势操作**，不能仅是简单的图片展示：
* **UI 规范**：黑色半透明背景，包含关闭按钮、左右翻页箭头、底部页码指示器 (current/total)。
* **PC 端交互**：
    * **滚轮缩放 (Wheel Zoom)**：监听 `wheel` 事件，以鼠标指针为中心进行 `transform: scale()` 缩放。
    * **拖拽平移 (Drag Pan)**：当 `scale > 1` 时，按住左键可拖拽图片查看细节。
    * **双击复位**：在 100% 和 200% 之间切换。
    * **键盘支持**：`ArrowLeft/Right` 翻页，`Esc` 关闭。
* **移动端交互**：
    * **双指捏合 (Pinch Zoom)**：计算 `touches` 距离变化实现缩放。
    * **单指拖拽**：放大状态下移动视口。
    * **防冲突**：灯箱容器必须设置 `touch-action: none` 以禁用浏览器默认滚动与缩放。

#### 4. SPA 与动态网页对抗 (SPA Handling)
* **动态监听**：不要依赖 `window.onload`。使用 `setInterval` (如每 500ms) 或 `MutationObserver` 监测关键内容容器。
* **状态锁**：一旦处理过某个容器，标记 `data-script-processed="true"` 防止重复执行。

---

### 通用工程标准
1.  **Style Isolation**：所有注入 CSS 必须带 `!important` 且有特定前缀（如 `#my-gallery-container`），防止污染全局。
2.  **User Preferences**：在画廊顶部添加 `input[type=range]` 滑块，允许用户实时调节 Grid 列宽，并保存至 `localStorage`。
3.  **强力去广**：建立黑名单（如 `iframe`, `.ads`, `ins`），发现即隐藏 (display: none)。

### 代码结构模板

```javascript
(function() {
    'use strict';

    // === 1. 配置与状态管理 ===
    const CONFIG = {
        colWidth: localStorage.getItem('user_col_width') || 250,
        isMobile: /Android|iPhone/i.test(navigator.userAgent)
    };
    
    // === 2. 核心样式 (包含灯箱动画与 Grid 布局) ===
    const STYLES = `
        /* 必须包含 touch-action: none 用于灯箱 */
        #light-box-img { touch-action: none; transition: transform 0.1s; }
        /* ...其他样式... */
    `;

    // === 3. 工具库 (防抖、提取器、SPA 轮询) ===
    const Utils = {
        getHighResUrl: (imgNode) => { /* 实现 v9.0 的源地址智能清洗逻辑 */ },
        waitElement: (selector) => { /* 轮询等待 */ }
    };

    // === 4. 业务模块 ===
    const Lightbox = {
        init: () => { /* 绑定 Wheel, Touch, Drag 事件 */ },
        open: (index) => { /* 打开逻辑 */ }
    };

    const GalleryBuilder = {
        run: async () => {
            /* 1. 提取 (Extract) - 使用 Utils.getHighResUrl
               2. 并发获取多页 (Fetch All) - 使用 Promise.all + Map 排序
               3. 渲染 (Render)
               4. 清理 (Safe Purge)
            */
        }
    };

    // === 5. 入口 ===
    function main() {
        GM_addStyle(STYLES);
        // 场景路由
        if (document.querySelector('.feed-list')) {
            // 场景 A 逻辑
        } else if (document.querySelector('.post-content')) {
            GalleryBuilder.run();
        }
    }

    // 启动心跳检测 (SPA 适配)
    setInterval(() => {
        if (!document.getElementById('my-gallery-injected')) main();
    }, 1000);

})();