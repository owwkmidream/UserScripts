# Bilibili 任务领奖接口文档

> 接口：`POST /x/activity_components/mission/receive`  
> 目标：整理必选/可选参数，并补充 `wbi` 签名说明（基于页面源码静态分析 + API 文档）。

## 1. 接口概览

- URL：`https://api.bilibili.com/x/activity_components/mission/receive`
- Method：`POST`
- Content-Type：`application/x-www-form-urlencoded`
- 鉴权要求：
  - 登录态 Cookie（核心是 `SESSDATA`）
  - CSRF（`bili_jct` -> `csrf`）
  - `wbi` 签名（查询参数 `wts` + `w_rid`）

## 2. 参数清单（必选/可选）

### 2.1 Query 参数

| 参数 | 是否必选 | 说明 |
|---|---|---|
| `wts` | 是 | `wbi` 签名时间戳（秒级 Unix 时间） |
| `w_rid` | 是 | `wbi` 签名值，`md5(query + mixin_key)` |

### 2.2 Body 参数（`application/x-www-form-urlencoded`）

| 参数 | 是否必选 | 说明 | 备注 |
|---|---|---|---|
| `task_id` | 是 | 任务 ID | 例如 `6ERAxwloghvznj00` |
| `activity_id` | 是 | 活动 ID | 例如 `1ERA5wloghvh0d00` |
| `csrf` | 是 | CSRF Token | 值来自 Cookie `bili_jct` |
| `gaia_vtoken` | 条件必选 | 风控验证 Token | 首次通常可空；若返回 `202100`，完成验证后再次请求时必填 |
| `activity_name` | 否（建议传） | 活动名称 | 页面请求会携带，主要用于展示/日志/上下文 |
| `task_name` | 否（建议传） | 任务名称 | 页面请求会携带 |
| `reward_name` | 否（建议传） | 奖励名称 | 页面请求会携带 |
| `receive_from` | 否（建议传） | 领奖来源 | 页面固定传 `missionPage` |

## 3. Header 建议

| Header | 是否必选 | 说明 |
|---|---|---|
| `Cookie` | 是 | 必须包含登录态；至少应有 `SESSDATA`，并包含 `bili_jct`（用于 `csrf`） |
| `Content-Type: application/x-www-form-urlencoded` | 是 | 与页面请求一致 |
| `Referer` | 建议 | 建议设为对应活动页，降低风控概率 |
| `User-Agent` | 建议 | 与正常浏览器保持一致 |

## 4. `wbi` 签名算法（来自 bilibili-API-collect）

### 4.1 步骤

1. 获取 `img_key` 与 `sub_key`（通常来自 `wbi_img_url`、`wbi_sub_url` 文件名）。
2. 拼接 `raw = img_key + sub_key`。
3. 通过固定重排表生成 `mixin_key`，并截取前 32 位。
4. 在原参数中加入 `wts = 当前秒级时间戳`。
5. 按参数名升序排序，拼接 query 字符串。
6. 对字符串值移除字符 `!'()*`。
7. 计算 `w_rid = md5(query + mixin_key)`。
8. 将 `wts`、`w_rid` 追加到 URL Query。

### 4.2 重排表（mixinKeyEncTab）

```text
[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
```

## 5. 请求示例（脱敏）

```bash
curl "https://api.bilibili.com/x/activity_components/mission/receive?wts=1771159292&w_rid=<W_RID>" ^
  -X POST ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -H "Cookie: SESSDATA=<SESSDATA>; bili_jct=<BILI_JCT>" ^
  --data-raw "task_id=6ERAxwloghvznj00&activity_id=1ERA5wloghvh0d00&activity_name=<activity_name>&task_name=<task_name>&reward_name=<reward_name>&gaia_vtoken=&receive_from=missionPage&csrf=<BILI_JCT>"
```

## 6. 响应与错误码（补全版）

> 说明：以下按“领取接口显式处理”与“页面通用兜底”分层整理。  
> B 站后端可能新增/调整错误码，文档不能保证永久穷举。

### 6.1 HTTP 状态码

| 状态码 | 含义 | 说明 |
|---|---|---|
| `200` | 请求到达业务层 | 需继续看 JSON `code` |
| `412` | IP 访问异常 | 页面领取逻辑对 `response.status === 412` 显式提示“IP访问异常” |
| 其他 `4xx/5xx` | 网关/网络/服务异常 | 页面会走通用错误提示（`message` 或 `code`） |

### 6.2 `mission/receive` 已确认业务码（领取流程显式处理）

| code | 含义 | 处理建议 |
|---|---|---|
| `0` | 成功 | 正常结束 |
| `202032` | 无资格领取奖励 | 终止，检查任务资格/活动条件（来自实测样本） |
| `202100` | 风控校验挑战 | 拉起 Gaia 验证，拿到 `gaia_vtoken` 后重试 |
| `202101` | 当前账号行为异常，无法领奖 | 停止重试，降低频率并观察账号状态 |
| `202102` | 风控系统异常 | 延迟重试 |
| `-509` | 当前领取用户过多 / 请求过于频繁 | 退避重试（指数退避） |

### 6.3 页面通用码（同页面接口可能出现）

| code | 含义 | 备注 |
|---|---|---|
| `-101` | 未登录或登录态失效 | 页面 `mission/info` 分支有显式判断 |
| `202001` | 活动不存在 | 页面通用文案映射 |
| `-702` | 请求频率过高，请稍后再试 | 页面通用文案映射 |
| `-504` | 服务调用超时 | 页面通用文案映射 |

### 6.4 兜底行为

- 若返回码未被上述分支命中，页面会优先展示服务端 `message`，其次展示 `code`。
- 因此线上可能看到未收录的新 `code`，属于预期现象。

## 7. 结论（参数判定）

- **明确必选**：`task_id`、`activity_id`、`csrf`、`wts`、`w_rid`
- **条件必选**：`gaia_vtoken`（仅在风控挑战后）
- **可选但建议传**：`activity_name`、`task_name`、`reward_name`、`receive_from`

## 8. 参考来源

- WBI 算法文档：`https://owwkmidream.github.io/bilibili-API-collect/docs/misc/sign/wbi.html`
- 奖励页主脚本（含 `mission/receive` 调用）：`https://activity.hdslb.com/blackboard/activity3ERA4wloghvc9700/js/index.e47f9db9.js`
- 奖励页依赖脚本（含 `HttpSvcWbiEncode` / csrf 中间件逻辑）：`https://activity.hdslb.com/blackboard/activity3ERA4wloghvc9700/js/chunk-vendors.f90405c4.js`
- 本地实测响应样本：`temp.md`
