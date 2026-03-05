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
pnpm run release
```

## 发布命令

```bash
# 默认 patch（会更新 src/meta.user.js 的 @version 并执行构建）
pnpm run release

# 指定递增类型
pnpm run release:patch
pnpm run release:minor
pnpm run release:major

# 直接指定版本号
pnpm run release -- --version 2.1.0
```

## 发布约束

- 不要手工编辑 `hen/AI fengyue auto register.user.js`
- 仅通过构建命令生成产物
