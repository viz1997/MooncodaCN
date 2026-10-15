# 小程序 SDK(参考实现)

NextDevTpl 暴露给小程序的 TypeScript SDK 参考实现。把本目录(`src/clients/miniprogram-sdk/`)整体复制到小程序仓库 `src/api/sdk/` 即可使用。

> ⚠️ **本 SDK 只覆盖 NextDevTpl AI SaaS 后端的 API。Commerce(商品 / 购物车 / 订单 / 支付)走独立部署的 Medusa,详见 [`MEDUSA_INTEGRATION.md`](./MEDUSA_INTEGRATION.md)。**

## 当前版本

`VERSION` 文件 — `1.3.0`,详见文末 [Changelog](#changelog)。

## 文件清单

| 文件 | 职责 |
|---|---|
| `VERSION` | SDK 版本号(纯文本),发版时改 |
| `types.ts` | 全量请求/响应类型(零依赖) |
| `request.ts` | fetch 内核:Bearer + x-api-key 自动加 + 401 回调 + 超时 + multipart |
| `auth.ts` | WeChat 登录(走 mp 自己的微信云,BFF 不参与) |
| `upload.ts` | 公共桶 / 订单桶上传(formData + presigned PUT) |
| `image-gen.ts` | 提交生图 + 轮询 + 模板 + 配额 + 我的资产 |
| `orders.ts` | `/orders/[token]/**` 公共预览流(12 端点) |
| `index.ts` | 统一出口 |
| `MEDUSA_INTEGRATION.md` | **小程序 commerce 走真 Medusa 的接入指南** |

## ⚠️ 鉴权模型澄清(2026-10-13 v1.2.0 必读)

**本 SDK 的所有 BFF 调用只走 `x-api-key`,不走 BA session。**

| 维度 | 处理方 |
|---|---|
| 小程序用户身份登录 | **mp 自己的微信云**(不在本 SDK 范围) |
| 调用 BFF 接口 | **x-api-key**(`mk_pub_*` 前缀,admin 给合作伙伴发) |
| Bearer session | 不使用(本 SDK 不调任何要登录的端点) |

后果:
- `/api/credits/balance` 等 credits 端点要 BA session → **本 SDK 不调**,要走自己查积分
- `/api/image-gen/photos/list` 要 BA session → **本 SDK 不调**(本 SDK 只暴露 `listPhotos`,那是要登录的「我的资产」,mp 端可以走 mp 自己的用户中心 API)
- `/api/image-gen/jobs/[jobId]/poll` 服务端支持双鉴权,mp 端走 x-api-key 分支(自动,SDK 内部处理)

---

## 集成步骤

### 1. 复制 SDK 到小程序

```bash
cp -r src/clients/miniprogram-sdk/ <miniprogram>/src/api/sdk/
```

### 2. App 入口初始化

```ts
// src/app.ts
import { setupSdk, setSdkApiKey } from "@/api/sdk";

setupSdk({
  baseUrl: process.env.TARO_APP_API_BASE_URL ?? "https://api.mooncoda.com",
  timeoutMs: 30_000,
  // onUnauthorized 永远不会被触发(本 SDK 不走 BA session)
  // 留这个回调仅为未来万一扩展时兜底
  onUnauthorized: () => {
    Taro.navigateTo({ url: "/pages/login/index" });
  },
});

// 必须:外部 API Key(mk_pub_* 前缀,admin 给合作伙伴发的那种)
// 启动时若已存到 wx.storage,setupSdk 会自动恢复;若需要主动 set:
const apiKey = process.env.TARO_APP_EXTERNAL_API_KEY;
if (apiKey) setSdkApiKey(apiKey);
```

### 3. (可选) 拉配额显示「本月剩余 N 次」

```ts
import { getQuota } from "@/api/sdk";

const quota = await getQuota();
// quota = { keyName, used, limit, remaining, unlimited, resetAt }
// - limit=0 → unlimited=true, remaining=-1(无限配额,UI 隐藏剩余数)
// - limit>0 → unlimited=false, remaining=Math.max(0, limit-used)
// - resetAt:下月 1 号 0:00 UTC(ISO 8601),UI 可算"距离恢复还剩多久"
Taro.setStorageSync("mp_quota_cache", { quota, cachedAt: Date.now() });
```

配额语义:**「外部 API Key 的月调用上限」**,不是登录用户的 credits 余额。两个不同的概念:
- 配额 = apiKey 维度,admin 在后台给合作伙伴发 key 时配
- credits = 用户维度,要 BA session 才查,本 SDK 不查

### 4. 拉产品线 + 模板(mp 启动时拉一次)

```ts
import { listTemplates } from "@/api/sdk";

const { productLines, templates, keyScope } = await listTemplates();
// productLines / templates 用作 maskId 下拉 / 产品线 Tab
// keyScope.allowedMasks 是当前 key 的白名单(空数组 = 不限),UI 可据此
// 灰掉白名单外的 mask
```

### 5. 提交生图 + 轮询(核心流程)

```ts
import {
  publicUploadDirect,
  submitGenerate,
  pollImageTask,
  proxyImageUrl,
} from "@/api/sdk";

// 5.1 上传参考图(直传 R2,跳 BFF —— v1.3.0 推荐)
const file = await chooseImageFile(); // Taro.chooseImage + file
const { url } = await publicUploadDirect(file);

// 5.2 提交生图(<1s 返 taskId,不阻塞等模型)
const { taskId } = await submitGenerate({
  maskId: "R-cute-001",  // 从 listTemplates 拿
  imageUrls: [url],
  size: 6,
  count: 1,
  // model 选填:不传按 mask 推荐(默认 apimart_gpt_image)
  // - "apimart_gpt_image"            → 上游 gpt-image-2.5-flare(速度/成本优先)
  // - "apimart_gpt_image_sunburst"  → 上游 gpt-image-2.5-sunburst(质量优先,贵一档)
  // - 其他:qwen / gpt_image_2 / nano_banana2(详见 types.ts:PublicGenerateRequest.model)
});

// 5.3 轮询(递减间隔;taskId 是 UUID,不可枚举,免登录安全)
const schedule = [15, 12, 10, 8, 6, 5, 4, 3];
for (const s of schedule) {
  await new Promise((r) => setTimeout(r, s * 1000));
  const status = await pollImageTask(taskId);
  if (status.status === "completed") {
    status.candidates.forEach((c) => console.log("候选:", proxyImageUrl(c)));
    break;
  }
  if (status.status === "failed") throw new Error(status.errorMessage);
  // pending / processing:继续轮询
}
```

**为什么 submit 不阻塞等模型**:BFF 写 imageJob(pending)+ Inngest send 后立刻 <1s 返 taskId,模型在 Inngest cloud 后台跑(30-90s)。mp 30s timeout 永远不会被撞。

### 6. 6 步工作台(代理商 demo / 客户预览)

```ts
import {
  createOrder,
  configureOrder,
  orderUpload,
  pollOrder,
  selectCandidate,
  guestConfirmOrder,
} from "@/api/sdk";

// 6.1 建订单
const { token } = await createOrder({
  productTypeCode: "R",
  channel: "miniprogram",
  spec: { sizeCm: 6, accessoryCode: "leather", quantity: 1 },
});

// 6.2 上传参考图
const { url: refUrl } = await orderUpload(token, file);

// 6.3 调生图(submitGenerate 同流程,taskId 服务端关联到订单 generationTask)
const { taskId } = await submitGenerate({
  maskId: "R-default",
  imageUrls: [refUrl],
});

// 6.4 轮询订单状态(订单层轮询,不是 imageJob 轮询)
while (true) {
  const { status } = await pollOrder(token);
  if (status === "COMPLETED") break;
  if (status === "FAILED") throw new Error("生成失败");
  await new Promise((r) => setTimeout(r, 3000));
}

// 6.5 选候选
await selectCandidate(token, 0, 0);

// 6.6 客户确认(代理商 demo)
await guestConfirmOrder(token);
```

### 7. 错误处理

```ts
import { SdkRequestError } from "@/api/sdk";

try {
  await submitGenerate({ imageUrls: [url] });
} catch (err) {
  if (err instanceof SdkRequestError) {
    // err.status / err.code / err.message 可用
    if (err.code === "API_KEY_QUOTA_EXCEEDED") {
      // 月配额用尽,引导用户联系 admin 重置
      Taro.showToast({ title: "本月生成次数已用完", icon: "none" });
    } else if (err.code === "API_KEY_DISABLED") {
      // key 被 admin 停用
      Taro.showToast({ title: "API Key 已停用", icon: "none" });
    } else if (err.code === "API_KEY_MISSING") {
      // 没设 x-api-key(setupSdk 漏了)
      Taro.showToast({ title: "API Key 未配置", icon: "none" });
    } else if (err.status === 429) {
      // 限流(可能是 IP 维度,可能是 key 维度,看 code)
      Taro.showToast({ title: "请求过于频繁,请稍后重试", icon: "none" });
    } else {
      Taro.showToast({ title: err.message, icon: "none" });
    }
  } else {
    throw err;
  }
}
```

### 8. 取消轮询(进入后台 / 切换页面)

```ts
const controller = new AbortController();
pollImageTask(taskId, { signal: controller.signal }).catch(() => {
  /* 取消时 SDK 自动 throw SdkRequestError("TIMEOUT"|"ABORTED") */
});

// 用户切后台时调:
controller.abort();
```

---

## 鉴权矩阵(2026-10-15 v1.3.0)

| 端点 | 鉴权 | SDK 函数 |
|---|---|---|
| `POST /api/image-gen/submit` | **x-api-key** | `submitGenerate()` |
| `POST /api/image-gen/jobs/[jobId]/poll` | **x-api-key**(taskId 不可枚举) | `pollImageTask()` |
| `GET /api/image-gen/quota` | **x-api-key** | `getQuota()` |
| `GET /api/image-gen/templates` | **x-api-key** | `listTemplates()` |
| `POST /api/public/upload-url` | IP 限流(免登录,R2 直传签名) | `publicUploadUrl()` + 自己 PUT,或 `publicUploadDirect()` 一键 |
| `POST /api/public/upload` | IP 限流(免登录,BFF multipart 中转) | `publicUpload()`(历史路径,小图仍可用) |
| `GET /api/image/task/[id]` | 免登录(taskId 不可枚举) | (兜底层,mp 一般用不到) |
| `GET /api/image-gen/thumbnail` `/api/image-gen/download` | 免登录(代理不分子) | `proxyImageUrl()` |

**已废弃(返 410 Gone + movedTo 提示)**:
- ~~`/api/public/generate`~~ → `POST /api/image-gen/submit`
- ~~`/api/public/prompt-templates`~~ → `GET /api/image-gen/templates`
- ~~`/api/public/quota`~~ → `GET /api/image-gen/quota`

**不在本 SDK 范围**(要走 BA session 或 commerce API):
- `/api/image-gen/photos/list` — 「我的资产」,要 BA session
- `/api/credits/*` — 积分余额,mp 走自己的用户中心
- `/api/store/**` — commerce,走真 Medusa(见 `MEDUSA_INTEGRATION.md`)

---

## 错误码速查

| code | HTTP | 含义 | 处理建议 |
|---|---|---|---|
| `API_KEY_MISSING` | 401 | 没传 x-api-key(SDK 未 set) | 检查 `setSdkApiKey()` 是否调用 |
| `API_KEY_MALFORMED` | 401 | key 格式错(无 `mk_pub_` 前缀) | 重新拿 key |
| `API_KEY_NOT_FOUND` | 401 | hash 没命中 | key 已删,联系 admin |
| `API_KEY_DISABLED` | 403 | key 被 admin 停用 | 联系 admin |
| `API_KEY_QUOTA_EXCEEDED` | 429 | 月配额用尽 | 等下月 1 号重置,或联系 admin 提额 |
| `MASK_NOT_ALLOWED` | 403 | 当前 key 不在白名单内 | UI 灰掉该 mask,提示「无权限」 |
| `INVALID_MASK` | 400 | maskId 不存在或已下架 | 重新拉 listTemplates |
| `MISSING_PARAM` | 400 | 模板必填参数未传 | 检查 mask.variables |
| `MODEL_NOT_ALLOWED` | 403 | 显式指定的 model 不在白名单 | 删 model 字段或换 BFF 支持的 model |
| `MODEL_MAINTENANCE` | 503 | 模型维护中 | 提示稍后重试 |
| `INTERNAL_ERROR` | 500 | 服务端异常 | 重试,持续失败联系 admin |
| (no code) | 429 | IP 维度限流撞了 | 等几秒重试,无需特殊处理 |

---

## 集成 checklist

- [ ] `setSdkApiKey("mk_pub_...")` 在 App 启动时调用
- [ ] (可选)App 启动时调 `getQuota()` 缓存到 wx.storage,UI 显示配额
- [ ] (可选)App 启动时调 `listTemplates()` 缓存到 wx.storage,UI 显示 mask 下拉
- [ ] 用户进生图页时:
  1. `publicUploadDirect(file)` → 拿 R2 URL(直传,跳 BFF;老版本 mp 仍可走 `publicUpload()`)
  2. `submitGenerate({ maskId, imageUrls: [url] })` → 拿 taskId
  3. 立刻显示 loading,按 schedule 调 `pollImageTask(taskId)`
  4. completed:展示候选;failed:toast 错误信息
- [ ] 错误处理:catch `SdkRequestError`,按 code 分支
- [ ] 用户切后台:abort 轮询 controller

---

## Changelog

### v1.3.0 — 2026-10-15

**新增(直传 R2,跳 BFF)**

线上事故复盘后加的关键能力。2026-10-15 凌晨生产环境出现"用户传 JPG
却被报格式不支持"的诡异错误,根因链是:
1. mp 端 `wx.uploadFile` → BFF `/api/public/upload`(multipart)
2. BFF 拿 buffer 上传 R2,Content-Type 走 multer 解析(可能错)
3. mp 拿 R2 URL → `submitGenerate.imageUrls`
4. BFF `proxyImageInputsToR2` fetch 这个 R2 URL
5. fetch 拿到的 Content-Type 是 R2 自己存的 mime(R2 会保留上传时的
   Content-Type,这里是 multer 解析出来的那个),如果中途被人改过 /
   上游 CDN 误标,白名单校验就会拒

**新方案**:`publicUploadDirect(file)` 一步完成
- mp → BFF `/api/public/upload-url`(只拿 presigned URL,**不传字节**)
- mp → R2 用 PUT 直传,Content-Type 由 presign 阶段锁定,R2 拿到的
  就是 mp 端真实声明的 mime
- mp → BFF `submitGenerate.imageUrls` 拿到的 URL,R2 metadata Content-Type
  就是原始声明的 mime,**不再依赖任何代理 / CDN 的重写**

**SDK 变更**
- `publicUploadDirect(file, contentType?)` —— 直传 R2 一键(推荐,2026-10-15 起)
- `publicUploadUrl(payload)` —— 单独拿 presigned URL,业务自己 PUT
- `PublicUploadUrlRequest` / `PublicUploadUrlResponse` 类型
- `request.ts` 新增 `rawBody` + `customHeaders` 选项,支持 PUT 直传场景

**BFF 变更**
- 新端点 `POST /api/public/upload-url` —— 返回 R2 presigned PUT URL,
  鉴权与 `/api/public/upload` 一致(IP 限流,无 x-api-key 校验,与
  sibling 端点保持对称;后续要加 API Key 校验两条一起改)
- 旧 `/api/public/upload` 仍保留,小图 / 老版本 mp 仍可用

**兼容性**
- `publicUpload()` 保留为旧路径,继续工作。新代码用 `publicUploadDirect()`
- 依赖 `globalThis.fetch` 支持 `method: 'PUT'` + `body: Blob`。现代
  浏览器、Taro H5、React Native 都 OK;老版本 WeChat 原生 `wx.request`
  不支持 PUT,这种环境继续用 `publicUpload()`(走 BFF multipart)
- 鉴权表加新端点,SDK 函数表加 `publicUploadDirect` / `publicUploadUrl`
- Section 5 用法示例从 `publicUpload` 换到 `publicUploadDirect`

### v1.2.0 — 2026-10-13

**Breaking(端点路径迁移)**
- 全部 mp 端点从 `/api/public/**` 迁到 `/api/image-gen/**`:
  - `POST /api/public/generate` → `POST /api/image-gen/submit`
  - `GET /api/public/prompt-templates` → `GET /api/image-gen/templates`
  - `GET /api/public/quota` → `GET /api/image-gen/quota`
- 轮询从 `GET /api/image/task/[id]` → `POST /api/image-gen/jobs/[jobId]/poll`
- 旧路径返 410 Gone + movedTo 文案(SDK 调用方无感,内部已切)

**新增**
- `getQuota()` —— 拉外部 API Key 月配额(`keyName / used / limit / remaining / unlimited / resetAt`)
- `QuotaResponse` 类型 —— 配额响应契约
- 异步 submit 模式(POST 立刻返 taskId,模型在 Inngest 后台跑;mp 30s timeout 永远不会被撞)

**变更**
- `pollImageTask` 端点从 `GET /api/image/task/[id]` 改 `POST /api/image-gen/jobs/[jobId]/poll`
- `pollImageTask` 内部把 `{success, data: {job: <imageJob>}}` 响应映射到 `ImageTaskStatusResponse` 契约(`status / candidates / errorMessage / durationMs / finishedAt`),mp 端无感

**修复**
- 之前 owner 错指 `/api/credits/balance`(404),正确路径是 `getQuota()` —— 见上面「鉴权模型澄清」,两个概念不同

### v1.1.0 — 2026-10-13

**新增**
- `request.ts`:`setSdkApiKey(key)` / `getSdkApiKey()` —— 外部 API Key(`mk_pub_*` 前缀)接入,与 Bearer token 并存。持久化到 `wx.storage`(`miniprogram-sdk:v1:apiKey`),冷启动自动恢复。注入 `x-api-key` header,服务端优先 x-api-key(配额走 key)。
- 新端点 `GET /api/public/prompt-templates` —— 小程序拉产品线 + 模板不再需要登录(原 `/api/image-gen/prompt-templates` 要 Bearer)。响应 shape 对齐 `PromptTemplatesResponse` 契约(字段重命名 `maskId→id`、`previewUrl→cover`、`price→costCredits`)。
- `VERSION` 文件 —— 显式版本号 `1.1.0`,替代 README 文字描述。

**变更**
- `image-gen.ts:listTemplates()` URL 从 `/api/image-gen/prompt-templates` 切到 `/api/public/prompt-templates`。
- `types.ts:PublicGenerateRequest.model` union 新增 `"apimart_gpt_image" | "apimart_gpt_image_sunburst"` —— 小程序可显式指定走 sunburst 高质档。**这两个 SDK 端 model 字段对应 apimart 上游 `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` 两个子型号**(apimart 2026-10 弃用 -ext,只列 flare + sunburst)。
- `types.ts:PromptTemplatesResponse` 重塑:加 `sortOrder` / `maskCount` 到 productLines,`productLineIds` 改数组(原单数),`status` 改 `"active" | "inactive"`(原 draft/archived 不在数据源中),`allowedSizes` 改 `string[]`(cm,原 `number[]` 不匹配)。**`tags` 字段删除**(数据源无 tags 列)。
- `request.ts`:`x-api-key` header 注入,Bearer + x-api-key 可同时设置。
- README 鉴权表 + 复制路径 typo 修正(`miniprogramgram-sdk` → `miniprogram-sdk`)。

**修复**
- Apimart 任务轮询:服务端 `/api/image/task/[id]` 加 apimart ULID(`task_01K...`)兜底,小程序 `pollImageTask()` 0 改动即可工作。

### v1.0.x —— 历史

初版:auth / upload / image-gen / orders 四大模块全量上线。

---

## 已知限制 / TODO

- **Token 刷新**:本 SDK 不走 BA session,`onUnauthorized` 永远不触发。mp 端如需查积分/我的资产,走 mp 自己的用户中心 API
- **微信支付(`/api/pay/wechat/*`)**:Phase P2。会增补 `payment.ts` 模块。

## 版本同步

- NextDevTpl 端:`src/clients/miniprogram-sdk/`
- 变更后发 PR 到小程序仓库,README.md 顶部加 Changelog 段落。
- 类型不同步 = 运行时崩,优先 lint 校验。
