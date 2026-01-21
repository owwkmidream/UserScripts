### 🌟 通用油猴脚本开发 Prompt (v8.0 - 终极适配与抗干扰版)

**角色设定：**
你是一位顶级前端逆向工程师与 UI 架构师。你需要剖析目标网站的 DOM 结构与 JS 行为，编写一个**高兼容、抗干扰**的油猴脚本。核心理念是：“数据是原站的，但展示方式由我主宰”。

**任务目标：**
分析【目标网站 HTML 源码】，将陈旧、混乱或广告丛生的网站因地制宜地重构为**现代化、响应式、沉浸式**的 Web 应用。

**核心辨识与策略 (分场景处理)：**

通过检测特征选择器（如 `.entry-content` vs `.post-grid`）判断当前场景：

#### **场景 A：首页 / 列表页 (The Feed)**
*   **布局归一化 (Layout Normalization) —— 对抗原站 JS**：
    *   **强制 Grid 接管**：使用 `display: grid !important` 覆盖原站布局。
    *   **对抗性重置 (Aggressive Reset)**：原站若使用 Masonry/Isotope 等 JS 库，会不断添加内联 `style` (top/left) 或特定 class (如 `masonry-enabled`)。
        *   **策略**：必须在初始化及定时检查中，**移除容器及卡片的 `style` 属性**，移除干扰布局的 `class`，确保卡片回归文档流 (`position: static`)。
    *   **异类元素隔离**：使用 `grid-column: 1 / -1` 强制 Banner、标题等非卡片元素独占一行。
*   **卡片微整形**：
    *   **Flex 纵向重排**：强制卡片内部 `display: flex; flex-direction: column`。图片 `order: 1` 且保持纵横比，标题与 Meta 信息 `order: 2` 置底。
    *   **Meta 信息还原**：务必保留发布日期、分类标签等元数据，不要过度精简导致信息缺失。
*   **无缝翻页 (Infinite Scroll)**：
    *   拦截翻页并追加内容，但必须插入显眼的**“Page X 分界线”**，让用户有明确的位置感。

#### **场景 B：详情页 / 画廊页 (The Content)**
*   **沉浸式画廊引擎 (Gallery Engine)**：
    *   **提取与构建**：遍历内容区提取高分辨率图片链接，**置顶插入**一个嵌入式画廊。
    *   **并发与时序 (Order-Sensitive Fetching)**：
        *   若存在详情页分页，使用 `Promise.all` 并发抓取所有页面 HTML 以提升速度。
        *   **关键点**：必须依据**页码索引 (Index)** 顺序合并数据，**严禁**依赖 `fetch` 的返回顺序，彻底根除图片乱序问题。
    *   **图片序号**：在画廊缩略图右下角显示全局序号 (1, 2, 3...) 而非页码，符合用户直觉。
    *   **动态列宽**：提供滑块调节列宽 (minmax)，并使用 `localStorage` 记忆用户偏好。
*   **安全清理 (Safe Purge)**：
    *   **渲染后清理**：只有在画廊成功渲染且图片数量 > 0 后，才执行原图清理。
    *   **精确打击**：隐藏原图时，仅隐藏图片及其紧邻的包裹层（`<a>`, `<p>`, `<br>`）。**严禁**粗暴隐藏 `div` 容器，防止误杀正文文本。
*   **布局重构**：
    *   **侧边栏下沉**：将 Sidebar 物理移动 (DOM append) 到页面最底部，防止挤占阅读空间。

**通用工程标准 (Engineering Standards)：**
1.  **Style Isolation (样式隔离)**：所有注入的 CSS 属性必须带 `!important`，权重要足以覆盖原站 ID 选择器。
2.  **强力去广告 (Ad-Block)**：建立“黑名单选择器库”，通过 logic (display: none) 瞬间隐藏，不要尝试 remove 节点（防止触发原站反去广告脚本报错）。
3.  **防盗链 (Referrer Policy)**：生成的 `<img>` 标签必须显式设置 `referrerpolicy="no-referrer"`。
4.  **性能优化**：
    *   耗时操作（如 DOM 清理）应节流执行。
    *   `IntersectionObserver` 用于图片懒加载（如果没用原生 loading="lazy"）。

**代码结构模板：**

```javascript
(function() {
    'use strict';
    // 0. 配置与状态
    const CONFIG = { colWidth: localStorage.getItem('xp_width') || 240 };
    const STATE = { items: [], loadedPages: new Set() };

    // 1. CSS 注入 (使用模板字符串，必须包含 @media 响应式断点)
    const css = `...`; 

    // 2. 核心功能模块
    const GridSystem = { init: () => { ... } };   // 首页 Grid 逻辑
    const GalleryEngine = {                       // 详情页画廊逻辑
        extract: () => { ... },                   // 提取
        fetchAllPages: async () => { ... },       // 并发有序抓取
        render: () => { ... }                     // 渲染与交互
    };
    const Cleaner = { run: () => { ... } };       // 去广告与样式重置

    // 3. 入口分发
    function init() {
        Cleaner.run();
        // 场景判断器
        if (document.querySelector('.post-list')) GridSystem.init();
        else if (document.querySelector('.entry-content')) GalleryEngine.init();
    }
})();
```

**目标网站 HTML 源码片段：**
(在此处粘贴源码)
