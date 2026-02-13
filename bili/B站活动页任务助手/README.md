# B站活动页任务助手（源码目录）

本目录保存可维护的模块化源码，最终产物仍然输出到：

- `../B站活动页任务助手.user.js`

## 目录结构

- `src/meta.user.js`: Userscript 元数据头
- `src/styles.js`: 面板样式与注入
- `src/constants.js`: 常量定义
- `src/utils.js`: 通用工具函数
- `src/state.js`: 全局状态
- `src/activity.js`: 活动与稿件 API、统计逻辑
- `src/tasks.js`: 任务配置解析与任务列表处理
- `src/live.js`: 直播状态/开播/关播/分区逻辑
- `src/render.js`: UI 渲染层
- `src/app.js`: 启动与轮询调度
- `src/index.js`: 入口

## 构建

```bash
npm install
npm run build
```

构建输出固定为：

- `../B站活动页任务助手.user.js`

> 注意：请优先修改 `src/*`，不要直接编辑 `../B站活动页任务助手.user.js`。
