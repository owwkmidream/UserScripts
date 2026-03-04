# AI fengyue auto register

多文件源码工程（开发形态）+ 单文件 userscript 产物（发布形态）。

## 文档入口

- 项目索引：[`INDEX.md`](./INDEX.md)
- 协作规范：[`AGENTS.md`](./AGENTS.md)
- 协作约束：开始任务前先读 `INDEX.md`，每次改动后按 `AGENTS.md` 检查并维护索引

## 目录说明

- `src/`: 可维护源码
- `../AI fengyue auto register.user.js`: 构建产物（保持历史发布路径）

## 开发命令

```bash
pnpm install
pnpm run build
pnpm run build:watch
```

## 发布约束

- 不要手工编辑 `hen/AI fengyue auto register.user.js`
- 仅通过构建命令生成产物
