# AI fengyue auto register

多文件源码工程（开发形态）+ 单文件 userscript 产物（发布形态）。

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
