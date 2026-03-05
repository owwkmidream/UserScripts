# 项目索引（INDEX）

## 1. 项目概览

本项目是一个 userscript 工程，采用“源码开发 + 单文件产物发布”模式：

- 源码目录：`src/`
- 构建产物：`../AI fengyue auto register.user.js`

核心目标是为 AI 风月相关页面提供注册辅助、验证码提取、侧边栏工具、会话链本地管理与监控能力。

## 2. 入口与构建链路

### 2.1 运行入口

- `src/meta.user.js`：userscript 元信息头（`@match`、`@grant`、版本等）。
- `src/index.js`：脚本运行入口，负责样式注入与 `startApp` 启动。
- `src/app.js`：应用初始化编排，挂载模块引用并启动主流程。

### 2.2 构建与产物

- `rolldown.config.mjs`：读取 `src/meta.user.js` 作为 banner，将 `src/index.js` 打包为 IIFE。
- 输出文件：`../AI fengyue auto register.user.js`（仓库上级目录的历史发布路径）。
- `scripts/open-userscript.mjs`：`postbuild` 阶段启动本地 bridge 并在默认浏览器打开 userscript URL。

## 3. 目录与关键文件索引

### 3.1 目录索引

| 路径 | 职责 | 关键依赖/被依赖 |
| --- | --- | --- |
| `scripts/` | 构建后辅助脚本（打开 userscript） | 被 `package.json` 的 `postbuild` 调用 |
| `src/` | 核心源码目录 | 被 `rolldown.config.mjs` 作为打包输入 |
| `src/features/` | 业务功能模块（注册、提取、排序） | 由 `src/app.js` 和 `src/ui/sidebar.js` 驱动 |
| `src/features/auto-register/` | 自动注册子模块目录（按职责拆分的流程/接口/会话/工具层） | 被 `src/features/auto-register.js` 聚合并对外导出 |
| `src/services/` | 数据与接口服务层（API、会话链存储） | 被 `features` 与 `ui` 依赖 |
| `src/services/chat-history/` | 会话链服务子模块（索引、链路、导入导出、渲染、预览样式快照） | 被 `src/services/chat-history-service.js` 聚合 |
| `src/runtime/` | 运行时监听（SPA 路由与聊天请求监控） | 由 `src/app.js` 启动 |
| `src/runtime/chat-monitor/` | chat-messages 监控子模块（hook、SSE、超时、状态发布） | 被 `src/runtime/chat-messages-monitor.js` 聚合 |
| `src/ui/` | 侧边栏、toast、状态胶囊与样式注入 | 由 `src/app.js`、`runtime`、`features` 调用 |
| `src/ui/sidebar/` | 侧边栏子模块（视图、事件、会话、设置、工具） | 被 `src/ui/sidebar.js` 聚合 |
| `src/utils/` | 公共工具（日志、随机、DOM 输入、验证码提取） | 被 `features`、`menu`、`ui` 复用 |
| `src/menu/` | 油猴菜单命令注册 | 由 `src/app.js` 调用 |

### 3.2 关键文件索引

| 路径 | 职责 | 关键依赖/被依赖 |
| --- | --- | --- |
| `README.md` | 项目说明、构建命令与发布约束 | 面向维护者入口文档 |
| `AGENTS.md` | 协作规范，定义读取与维护索引规则 | 约束所有后续改动流程 |
| `package.json` | 构建命令、postbuild 命令定义 | 调用 `rolldown` 与 `scripts/open-userscript.mjs` |
| `rolldown.config.mjs` | 打包配置与输出路径声明 | 读取 `src/meta.user.js` 与 `src/index.js` |
| `scripts/open-userscript.mjs` | postbuild 启动浏览器 bridge | 依赖 Node `http/fs/child_process` |
| `src/meta.user.js` | userscript 元数据头部 | 被 `rolldown.config.mjs` 注入 banner |
| `src/index.js` | 入口：注入 sidebar 样式并启动 app | 依赖 `src/app.js`、`src/ui/sidebar.css.js` |
| `src/app.js` | 统一初始化：绑定 refs、启动监听、号池维护与菜单 | 依赖 `features`、`runtime`、`ui`、`menu` |
| `src/constants.js` | 全局配置常量与存储键 | 被全项目多数模块依赖 |
| `src/state.js` | 全局运行时状态容器 `APP_STATE` | 被 `app`、`ui`、`runtime`、`services` 读写 |
| `src/gm.js` | GM API 封装与 GM 请求 Promise 化 | 被 `services`、`menu`、`ui`、`features` 依赖 |
| `src/features/auto-register.js` | 自动注册兼容门面（聚合子模块并导出 `AutoRegister`） | 被 `app`、`menu`、`runtime`、`ui` 依赖 |
| `src/features/auto-register/shared.js` | 自动注册共享常量与纯工具函数 | 被 `auto-register/*-methods.js` 复用 |
| `src/features/auto-register/runtime-methods.js` | 自动注册通用运行时能力（重试、自动刷新） | 聚合进 `src/features/auto-register.js` |
| `src/features/auto-register/token-pool-methods.js` | 号池维护能力（本地 token 池、定时补池、退避、消费策略） | 聚合进 `src/features/auto-register.js`，被 `flow-methods` 调用 |
| `src/features/auto-register/form-methods.js` | 注册页表单能力（页面识别、输入、按钮触发） | 聚合进 `src/features/auto-register.js` |
| `src/features/auto-register/site-api-methods.js` | 站点接口调用与首次引导处理 | 聚合进 `src/features/auto-register.js` |
| `src/features/auto-register/conversation-methods.js` | 会话链路读取/同步/预览入口封装 | 依赖 `chat-history-service`，聚合进 `auto-register` |
| `src/features/auto-register/model-config-methods.js` | world_book 与模型配置读写逻辑 | 聚合进 `src/features/auto-register.js` |
| `src/features/auto-register/chat-messages-methods.js` | `/chat-messages` 请求与 SSE 解析流程 | 聚合进 `src/features/auto-register.js` |
| `src/features/auto-register/flow-methods.js` | 注册与换号高层流程编排 | 聚合进 `src/features/auto-register.js` |
| `src/features/iframe-extractor.js` | 详情页 HTML 提取与导出 | 依赖 `gmRequestJson` 与 `Toast` |
| `src/features/model-popup-sorter.js` | 模型弹窗排序与模型类型 Tag 筛选（内置映射 + 自定义前缀映射） | 依赖 `gm`、`constants` |
| `src/services/api-service.js` | GPTMail API 调用与配额统计（含用量订阅发布） | 依赖 `gm`、`constants` |
| `src/services/chat-history-store.js` | IndexedDB 会话链存储基础层 | 被 `chat-history-service` 依赖 |
| `src/services/chat-history-service.js` | 会话链兼容门面（聚合 `chat-history/*` 子模块） | 被 `features`、`ui` 调用 |
| `src/services/chat-history/shared.js` | 会话链共享纯工具与索引读写 helper | 被 `chat-history/*` 子模块复用 |
| `src/services/chat-history/index-store.js` | 会话链索引与存储元数据方法集合 | 聚合进 `chat-history-service` |
| `src/services/chat-history/chain-service.js` | 会话链绑定、消息写入、统计方法集合 | 聚合进 `chat-history-service` |
| `src/services/chat-history/bundle-service.js` | 会话链导入/导出方法集合 | 聚合进 `chat-history-service` |
| `src/services/chat-history/viewer-renderer.js` | 会话链 HTML 预览渲染方法集合 | 聚合进 `chat-history-service` |
| `src/services/chat-history/preview-host-css.js` | 主站样式快照固化文件（用于预览页离线样式注入） | 被 `viewer-renderer` 注入到预览 HTML |
| `src/runtime/spa-watcher.js` | SPA URL/DOM 变化监听与重注入 | 依赖 `APP_STATE`、`Sidebar`、`features` |
| `src/runtime/chat-messages-monitor.js` | chat-messages 监控门面（支持 `start/stop` 生命周期） | 聚合 `runtime/chat-monitor/*` 子模块 |
| `src/runtime/chat-monitor/fetch-hook.js` | fetch hook 安装与 SSE 监听流程 | 聚合进 `chat-messages-monitor` |
| `src/runtime/chat-monitor/xhr-hook.js` | xhr hook 安装与超时处理流程 | 聚合进 `chat-messages-monitor` |
| `src/runtime/chat-monitor/sse-parser.js` | SSE 解析、事件归一化与提示格式化 | 被 fetch/xhr hook 复用 |
| `src/runtime/chat-monitor/timeout-context.js` | chat-messages 超时策略与 AbortContext | 被 fetch/xhr hook 与门面复用 |
| `src/ui/sidebar.js` | 侧边栏兼容门面（聚合 `ui/sidebar/*` 子模块） | 被 `app`、`runtime`、`features` 调用 |
| `src/ui/sidebar/sidebar-view.js` | 侧边栏视图创建与开关、Tab 切换 | 聚合进 `sidebar` |
| `src/ui/sidebar/sidebar-events.js` | 侧边栏事件绑定与剪贴板交互 | 聚合进 `sidebar` |
| `src/ui/sidebar/sidebar-conversation.js` | 会话面板交互、预览、导入导出 | 聚合进 `sidebar` |
| `src/ui/sidebar/sidebar-settings.js` | 侧边栏设置读写、主题布局、配额/号池摘要显示、模型映射编辑器刷新 | 聚合进 `sidebar` |
| `src/ui/sidebar/sidebar-state.js` | 侧边栏状态加载与渲染 | 聚合进 `sidebar` |
| `src/ui/sidebar/sidebar-tools.js` | 侧边栏工具面板可用性刷新 | 聚合进 `sidebar` |
| `src/ui/sidebar.css.js` | 侧边栏样式注入 | 由 `src/index.js` 调用 |
| `src/ui/toast.js` | 轻提示组件 | 被全局多个模块调用 |
| `src/ui/chat-stream-capsule.js` | SSE 状态胶囊提示组件 | 被 `chat-messages-monitor` 调用 |
| `src/menu/menu-commands.js` | 油猴菜单命令注册 | 依赖 `gmRegisterMenuCommand` 与业务模块 |
| `src/utils/logger.js` | 带 runId 的日志工具与调试开关 | 被 `auto-register`、`menu`、`ui` 使用 |
| `src/utils/random.js` | 用户名/密码随机生成与延时工具 | 被 `auto-register` 调用 |
| `src/utils/code-extractor.js` | 邮件验证码提取工具 | 被 `auto-register` 调用 |
| `src/utils/dom.js` | 表单输入模拟工具 | 被 `auto-register` 调用 |

## 4. 核心运行流程（启动到功能触发）

1. `src/index.js` 执行：`injectSidebarStyles()` 注入样式后调用 `startApp()`。
2. `src/app.js` 初始化：将 `Toast`、`Sidebar`、`AutoRegister`、`IframeExtractor`、`ModelPopupSorter` 绑定到 `APP_STATE.refs`。
3. 启动运行时与菜单：`Sidebar.init()`、`ChatMessagesMonitor.start()`、`AutoRegister.startTokenPoolScheduler()`、`SPAWatcher.startObserver()`、`registerMenuCommands()`。
4. 首次延时检查（约 800ms）：
- 若在注册页，`SPAWatcher.ensureDOM()` 保证 UI 仍存在。
- `IframeExtractor.checkAndUpdate()` 检查详情页工具按钮状态。
- `ModelPopupSorter.scheduleSort()` 尝试模型排序。
- `Sidebar.updateToolPanel()` 刷新工具面板可用状态。
5. 后续由 `SPAWatcher` 和 `ChatMessagesMonitor` 持续响应路由变化与聊天请求状态。

## 5. 外部依赖与边界

- GM 依赖边界：
  - 统一封装入口在 `src/gm.js`。
  - 使用到 `GM_getValue`、`GM_setValue`、`GM_registerMenuCommand`、`GM_xmlhttpRequest`、`GM_addStyle`。
- 外部 API 边界：
  - `CONFIG.API_BASE` 当前为 `https://mail.chatgpt.org.uk/api`。
  - 业务请求主要通过 `src/services/api-service.js` 发起。
- 本地持久化边界：
  - `CONFIG.STORAGE_KEYS` 定义 localStorage/GM 存储键名。
  - 会话链主数据存于 IndexedDB（`src/services/chat-history-store.js`）。

## 6. 索引维护规则

每次改动都必须执行索引一致性检查：

1. 必须更新 `INDEX.md` 的场景
- 新增、删除、重命名文件或目录。
- 入口链路、初始化流程、构建链路发生变化。
- 模块职责发生变化（例如文件用途从“工具函数”变成“业务流程”）。
- 外部依赖边界变更（如 API 域名、GM 权限、核心存储边界）。

2. 可使用 `N/A` 的场景
- 改动不影响索引语义（例如纯注释微调、文案调整、样式细节调整）。
- 即使 `N/A`，提交说明也必须明确写：`索引无变更（N/A）`。

## 7. 索引更新记录（可选）

- `2026-03-04`：创建初版 `INDEX.md`，建立目录与关键文件索引，并补充维护规则。
- `2026-03-04`：`auto-register.js` 拆分为 `src/features/auto-register/` 子模块，入口改为兼容聚合门面。
- `2026-03-05`：`sidebar`、`chat-history-service`、`chat-messages-monitor` 进一步拆分为子模块，`ApiService` 与 UI 解耦，`SPAWatcher` 历史 hook 支持可逆卸载。
- `2026-03-05`：新增 `token-pool-methods` 号池模块，更换账号流程改为“优先号池 token，池空回退注册”，并加入全站定时补池与设置摘要。
- `2026-03-05`：新增 `preview-host-css.js` 固化主站样式快照，预览页改为“兜底样式 + 固化主站 CSS + builtInCss”，并精简为仅保留会话内容与复制操作。
- `2026-03-05`：`model-popup-sorter.js` 排序策略由“价格优先”调整为“近期出字率优先，价格兜底”。
- `2026-03-05`：`model-popup-sorter.js` 新增模型类型 Tag 筛选，支持同类型模型一键聚合查看（`Low/High/Preview` 归并）。
- `2026-03-05`：模型类型改为“内置映射规则 + 侧边栏可编辑自定义前缀映射”，并新增未映射前缀补录入口。
