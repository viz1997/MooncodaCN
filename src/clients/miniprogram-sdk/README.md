# 小程序 SDK(参考实现)

NextDevTpl 暴露给小程序的 TypeScript SDK 参考实现。把本目录(`src/clients/miniprogram-sdk/`)整体复制到小程序仓库 `src/api/sdk/` 即可使用。

> ⚠️ **本 SDK 只覆盖 NextDevTpl AI SaaS 后端的 API。Commerce(商品 / 购物车 / 订单 / 支付)走独立部署的 Medusa,详见 [`MEDUSA_INTEGRATION.md`](./MEDUSA_INTEGRATION.md)。**

## 当前版本

`VERSION` 文件 — `1.6.1`,详见文末 [Changelog](#changelog)。

## 文件清单

| 文件 | 职责 |
|---|---|
| `VERSION` | SDK 版本号(纯文本),发版时改 |
| `types.ts` | 全量请求/响应类型(零依赖) |
| `request.ts` | fetch 内核:Bearer + x-api-key 自动加 + 401 回调 + 超时 + multipart |
| `auth.ts` | WeChat 登录(走 mp 自己的微信云,BFF 不参与) |
| `upload.ts` | 公共桶 / 订单桶上传(formData + presigned PUT) |
| `image-gen.ts` | 提交生图 + 轮询 + 模板 + 风格类型 + 配额 + 我的资产 |
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
  listTemplates,
} from "@/api/sdk";

// 5.1 上传参考图(mp 直传 R2,v1.4.0 推荐)
//    sizeType:['compressed'] 让 iOS 微信内置 HEIC→JPG(走 system
//    imageIO,无需任何 SDK 内部归一化);任何白名单外格式由 server
//    端 proxyImageInputsToR2.normalizeToSupported 兜底。
const { tempFilePath } = await Taro.chooseImage({
  count: 1,
  sizeType: ["compressed"],   // ← v1.4.0 起强制:避开 iOS HEIC
});

// 业务侧读 tempFilePath → Blob;简单场景直接用 Taro FileSystemManager
// import { readTaroFileAsArrayBuffer } from "@/api/sdk";  // 也可
const fsm = Taro.getFileSystemManager();
const readRes = await new Promise<{ data: ArrayBuffer | Uint8Array }>(
  (resolve, reject) => {
    fsm.readFile({
      filePath: tempFilePath,
      success: resolve,
      fail: reject,
    });
  }
);
const blob = new Blob([readRes.data as BlobPart], { type: "image/jpeg" });

const { url } = await publicUploadDirect(blob, "image/jpeg");

// 5.2 拉产品线 + 模板 + 模板样式(进入生图页时一次)
//     v1.5.0 起 templates[i].styles 是每条模板自带的视觉样式数组 ——
//     用于生图页"风格 chip"渲染(Q版/动漫/水彩/线稿/原图)。
//     选完 chip 后把对应的 templates[i].styles[j].id 作为 aiStyleId 透传。
const { productLines, templates } = await listTemplates();
const myTemplate = templates.find((t) => t.id === "R-cute-001");
if (!myTemplate) throw new Error("没找到模板 R-cute-001");
// myTemplate.styles = [
//   { id: "ai_original",   name: "原图保留", surchargeCents: 0,    swatch: "#9CA3AF", ... },
//   { id: "ai_qversion",   name: "Q 版萌系", surchargeCents: 1500, swatch: "#7A5A8C", ... },
//   { id: "ai_anime",      name: "日漫风",   surchargeCents: 2000, swatch: "#E879F9", ... },
//   { id: "ai_watercolor", name: "水彩手绘", surchargeCents: 1500, swatch: "#60A5FA", ... },
//   { id: "ai_lineart",    name: "线稿简笔", surchargeCents: 1000, swatch: "#1F2937", ... },
// ]

// 5.3 提交生图(<1s 返 taskId,不阻塞等模型)
const { taskId } = await submitGenerate({
  maskId: "R-cute-001",  // 与 listTemplates() 拉出的模板 id 对齐
  imageUrls: [url],
  size: 6,
  count: 1,
  // aiStyleId? v1.5.0 起可选,从 templates[i].styles[j].id 选,例:
  //   "ai_original"   → 直通,不注入样式 prompt(默认行为)
  //   "ai_qversion"   → Q 版萌系
  //   "ai_anime"      → 日漫风
  //   "ai_watercolor" → 水彩手绘
  //   "ai_lineart"    → 线稿简笔
  // 服务端会用此 id 对应的 styles[j].prompt 替换模板 prompt 里
  // 的 `{{style}}` 占位符(替换关键提示词);模板 prompt 不含
  // {{style}} 时 fallback 到 prepend。
  // 不传或传 "ai_original" → 等价于无样式,行为与 v1.4.0 一致
  aiStyleId: "ai_qversion",
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

### 9. 模板视觉样式(Q版/动漫/水彩/线稿 —— v1.5.0 起)

```ts
import { listTemplates, submitGenerate } from "@/api/sdk";

// 9.1 进入生图页时,先拉 mask 列表(listTemplates 一次到位):
//     - productLines[i] 做产品线 Tab
//     - templates[i]    做 mask 下拉 —— 同时每条模板自带 styles[]
//                       用作"风格 chip"渲染
const { productLines, templates } = await listTemplates();

// 9.2 用户选 maskId 之后,从其 styles[] 数组里挑 id 当 aiStyleId
const myMask = templates.find((t) => t.id === "R-cute-001");
if (!myMask) throw new Error("没找到模板 R-cute-001");
// myMask.steps 看 Section 5.2 注,这里继续。
// 用户在 chip 上点 "Q 版萌系" → 拿其 id "ai_qversion":

// 9.3 提交生图
const { taskId } = await submitGenerate({
  maskId: "R-cute-001",
  imageUrls: [refUrl],
  aiStyleId: "ai_qversion",      // ← 来自 myMask.styles[].id
  size: 6,
  count: 1,
});
```

**样式如何应用到 prompt(服务端做的事,客户端不用关心)**

每个 promptTemplate 自带 `styles: TemplateStyle[]`(后端存在
`promptTemplate.styles` JSON 列)。提交生图时:

1. 服务端校验 aiStyleId ∈ mask.styles(不在即 400 INVALID_STYLE)
2. 取 mask.styles[i].prompt,替换模板 prompt 里的 `{{style}}` 占位符
3. 模板 prompt 不含 `{{style}}` 占位符 → 服务端 fallback 把样式 prompt
   prepend 到模板 prompt 之前(行为类似旧版,业务方写模板时建议显式加
   `{{style}}` 占位符以更精确控制拼接位置)
4. 不传 aiStyleId / 选了 `ai_original`(直通,prompt 空)→ 不注入样式,
   行为与 v1.4.0 完全一致(零回归)

**为什么做这个(背景)**

产品模板 = 产品(mp 端选 mask 的语义就是选产品)。模板内分 N 种样式
(Q版 / 写实 / 动漫 / 水彩 / 线稿),用户点哪个就把对应关键提示词替换
到模板 prompt 里去 —— "替换关键提示词"语义,直接对齐。

`productEffect.config.style`(工艺风格,relief/engraving/3d-figurine)
和这些"视觉样式"是两回事,不要混淆。前者是生产工艺标注,后者是用户
可见的视觉风格 chip。

**兼容性**

v1.4.0 不传 `aiStyleId` 行为零变化。v1.5.0 给已有 mp 升级是加性变更,
业务代码不传 `aiStyleId` / 不读 `templates[i].styles` 都能继续工作;
不返 `styles` 的老版本 SDK(≤ v1.4.0)拉到的响应会被忽略多余字段,不
出错。

---

## 产品能力接口(`/api/image-gen/products` —— v1.6.0)

v1.5.0 的 `listTemplates()` 以 maskId 维度组织,适合工作台视角。
v1.6.0 新增 `listProducts()` 以 **产品** 维度组织 —— 更贴近小程序
新品 UI 的心智模型:

```
产品 (R 钥匙扣)
  ├─ sizes:        ["4", "5", "6"] cm
  ├─ accessories:
  │   ├─ leather        (5 色:棕/黑/红/白/原色)
  │   ├─ metal          (无变体)
  │   └─ braided_rope   (8 色:红/黑/蓝/绿/黄/紫/白/棕)
  ├─ capabilities:  canEngrave / canLeatherExposed / canPvcProtection / ...
  └─ templates:
      ├─ templateId: "R-cute-001"
      │   visualStyles: ["ai_original", "ai_qversion", "ai_anime", ...]
      │   allowedAccessories: [...]
      └─ templateId: "R-pixar-002"
          ...
```

**典型流程**(v1.6.0 起推荐):

```ts
import { listProducts, submitGenerate, publicUploadDirect } from "@/api/sdk";

// 1. 启动时拉一次(进入生图页前)
const { products } = await listProducts();
// products[0].productTypeCode === "R"
// products[0].accessories  // [{ code: "leather", variants: [{code: "leather_brown", ...}, ...] }, ...]

// 2. 用户在 UI 上选:产品 R + 尺寸 6cm + 配件 leather + 变体 leather_brown
//    + 模板 templateId="R-cute-001" + 风格 aiStyleId="ai_qversion"
const myProduct = products.find(p => p.productTypeCode === "R");
const myTemplate = myProduct.templates.find(t => t.templateId === "R-cute-001");
const myLeather = myProduct.accessories.find(a => a.code === "leather");
const myColor = myLeather.variants.find(v => v.code === "leather_brown");

// 3. 上传参考图 + 提交(同 v1.5.0)
const { url } = await publicUploadDirect(blob, "image/jpeg");
const { taskId } = await submitGenerate({
  maskId: myTemplate.templateId,
  imageUrls: [url],
  aiStyleId: "ai_qversion",     // ← 来自 myTemplate.visualStyles[].id
  size: 6,
  count: 1,
});
```

**字段语义**

| 字段 | 类型 | 说明 |
|---|---|---|
| `productTypeCode` | `"R"\|"A"\|"P"\|"RM"\|"LB"\|"M"` | 产品码 |
| `category` | `ProductCategory` | 分类(UI 分组用) |
| `displayName` | `{zh, en}` | i18n 名称 |
| `description` | `{zh, en}` | i18n 描述 |
| `sizes[]` | `ProductSizeDef[]` | 尺寸档;每个含 priceDeltaCents |
| `visualStyles[]` | `TemplateStyle[]` | 该产品聚合自所有模板的视觉风格(去重) |
| `accessories[]` | `AccessoryDef[]` | 配件清单;每个含 `variants[]`(空数组=无变体) |
| `capabilities` | `ProductCapabilities` | 6 个能力位(刻字/皮革色/PVC/外露/备注/平台) |
| `templates[]` | `ProductTemplateSummary[]` | 该产品可用的 AI 模板 |
| `accessories[i].code` | `string` | 配件 code(leather/metal/braided_rope/glass_cover/...) |
| `accessories[i].category` | `material\|protection\|mount\|decor` | 维度分类 |
| `accessories[i].variants[].code` | `string` | 变体 code,如 `leather_brown` / `rope_red` / `glass_4` |
| `accessories[i].variants[].swatch` | `string\|null` | 颜色 hex(尺寸类变体为 null) |
| `accessories[i].variants[].priceDeltaCents` | `number` | 加价(分) |

**新配件**(v1.6.0):

- `braided_rope`(编织绳)—— 挂在 R 钥匙扣上,8 色变体(`rope_red/black/blue/green/yellow/purple/white/brown`)
- `glass_cover`(玻璃罩)—— 挂在 M 手办上,3 种尺寸变体(`glass_4/6/8`)

**价格计算**(前端做)

```ts
const total =
  product.sizes.find(s => s.code === selectedSize)?.priceDeltaCents +
  (selectedAccessoryVariant?.priceDeltaCents ?? 0) +
  (selectedStyle?.surchargeCents ?? 0) +
  template.costCredits;
// UI 展示时 /100 显示「¥XX」
```

**缓存**:服务端 `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`。
产品字典变更后最长 10 分钟生效;若需立即生效,前端 query 加 `?cacheBust=<ts>` 兜底。

**鉴权**:与 `listTemplates()` 一致 —— x-api-key > Bearer<key>,dev 模式关;已登录 BA session 也可走。

**SDK 函数**

- `listProducts({ productTypeCodes?, locale? })` —— 返回 `ProductListResponse`
- `getProduct(code, locale?)` —— 单产品便利函数;不存在时返 `null`

**类型导出**(`from "@/api/sdk"`):

- `ProductListResponse`
- `ProductCapability` / `ProductCategory` / `ProductCapabilities`
- `ProductSizeDef` / `ProductTemplateSummary`
- `AccessoryCategory` / `AccessoryDef` / `AccessoryVariantDef`

---

## 鉴权矩阵(2026-10-15 v1.3.0)

| 端点 | 鉴权 | SDK 函数 |
|---|---|---|
| `POST /api/image-gen/submit` | **x-api-key** | `submitGenerate()` |
| `POST /api/image-gen/jobs/[jobId]/poll` | **x-api-key**(taskId 不可枚举) | `pollImageTask()` |
| `GET /api/image-gen/quota` | **x-api-key** | `getQuota()` |
| `GET /api/image-gen/templates` | **x-api-key** | `listTemplates()`(也携带每个模板的 `styles: TemplateStyle[]`)|
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
| `INVALID_STYLE` | 400 | aiStyleId 不存在(非 5 项有效 ID 之一) | 重新拉 listStyles() |
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
- [ ] (可选)v1.5.0 起:`listTemplates()` 响应里 `templates[i].styles` 即"风格 chip"数据,无需单独拉
- [ ] 用户进生图页时:
  1. `Taro.chooseImage({ sizeType: ['compressed'] })` → `tempFilePath`(iOS 微信内置 HEIC→JPG)
  2. `getFileSystemManager().readFile()` → `ArrayBuffer` → `Blob` → `publicUploadDirect(blob, 'image/jpeg')` 拿 R2 URL
  3. `submitGenerate({ maskId, imageUrls: [url] })` → 拿 taskId
  4. 立刻显示 loading,按 schedule 调 `pollImageTask(taskId)`
  5. completed:展示候选;failed:toast 错误信息
- [ ] 错误处理:catch `SdkRequestError`,按 code 分支
- [ ] 用户切后台:abort 轮询 controller

---

## Changelog

### v1.6.1 — 2026-10-18

**新增(产品基价字段)**

- 🆕 `ProductCapability.basePriceCents: number` —— 产品基价(分)。
  来自 server 端 `BASE_PRICE_CENTS` 字典,与 `mock-catalog.ts` 对齐。
  前端拼 totalPrice = base + size.delta + variant.delta + style.surcharge。

**Server 端配套**

- 后端:`src/features/gpt-image/lib/product-catalog.ts` 新增
  `BASE_PRICE_CENTS` + `getBasePriceCents(code)` helper
- 后端:`src/db/image-gen-types.ts` `ProductCapability` 接口加
  `basePriceCents: number` 字段
- 后端:`src/features/image-gen/lib/product-capability.ts` `assemble`
  阶段填充 `basePriceCents: BASE_PRICE_CENTS[code] ?? 0`
- 后端:`src/features/storefront/lib/mock-catalog.ts` 改 import 真理
  源(消除本地副本,避免漂移)

> 兼容性:纯加法变更,旧业务代码忽略 `basePriceCents` 字段无影响。

### v1.6.0 — 2026-10-18

**新增(产品能力接口)**

面向小程序 / 网页端的「产品 + 配件 + 视觉风格 + 模板」一站式元数据接口。
v1.5.0 的 `listTemplates()` 以 maskId 维度组织,适合工作台;v1.6.0 新增
`listProducts()` 以 **产品** 维度组织,贴近小程序新品 UI 心智模型。

**背景**:
- 用户原话「3D手办里面设置了Q版、写实,3D手办配件可选底座、玻璃罩等,
  钥匙扣配件可选编织绳颜色等」—— 产品要按「类型」分组展示,配件含
  颜色变体
- 硬编码字典 PRODUCT_TYPES / ACCESSORIES 已有产品 × 配件数据,但只
  在 server 内部使用,小程序拿不到

**变更**

- 🆕 `GET /api/image-gen/products` 路由 —— 鉴权与 `listTemplates()`
  一致(3-tier: dev / BA session / x-api-key);限流 ai tier(20/min);
  缓存 60s 客户端 + 300s CDN + 600s SWR
- 🆕 SDK 函数 `listProducts({ productTypeCodes?, locale? })` 返
  `ProductListResponse`;`getProduct(code, locale?)` 单产品便利函数
- 🆕 SDK 类型(全部从 `@/api/sdk` re-export):`ProductListResponse` /
  `ProductCapability` / `ProductCategory` / `ProductCapabilities` /
  `ProductSizeDef` / `ProductTemplateSummary` / `AccessoryCategory` /
  `AccessoryDef` / `AccessoryVariantDef`
- 🆕 `ai_realistic` 视觉风格 seed —— 写实摄影风格(`surchargeCents=2500`)
- 🆕 新配件 code:`braided_rope`(编织绳,R 用)/ `glass_cover`(玻璃罩,M 用)
- 🆕 DB 表 `product_accessory_variant` —— 配件变体持久化(颜色 / 尺寸)
  - 复合 unique index `(product_type_code, accessory_code, variant_code)`
  - seed 脚本 `src/db/seed-product-accessory-variants.ts`(19 行变体数据:
    R leather 5 色 / R braided_rope 8 色 / M stand 3 种 / M glass_cover 3 种)
- 🆕 mock-catalog.ts 新增 `BRAIDED_ROPE_COLORS` / `STAND_TYPES` /
  `GLASS_COVER_SIZES` mock 常量(与 DB seed 对齐,storefront mock 流兜底)

**Server 端配套**

- 后端:`src/db/schema.ts` 加 `productAccessoryVariant` 表
- 后端:`src/db/image-gen-types.ts` 加 9 个新接口(`ProductCapability`
  / `AccessoryDef` 等)
- 后端:`src/features/image-gen/lib/ai-styles.ts` 加 `ai_realistic` seed
- 后端:`src/features/gpt-image/lib/product-catalog.ts`:
  - `AccessoryCode` union 加 `glass_cover` / `braided_rope`
  - `ACCESSORIES` 数组追加 2 项
  - R 钥匙扣 `accessories[]` 加 `braided_rope`;M 手办加 `glass_cover`
  - 新增 `PRODUCT_META` / `ACCESSORY_META` 字典(category + i18n 名称)
  - 新增 `getProductMeta` / `getAccessoryMeta` helpers
- 后端:`src/features/image-gen/lib/product-capability.ts` 新模块
  - `loadProductCapabilities` / `assembleProductCapabilities` /
    `parseProductTypeCodes` / `resolveLocale`
- 后端:`src/app/api/image-gen/products/route.ts` 新路由

**兼容性**

- 加性变更 —— v1.5.0 的 `listTemplates()` 行为零变化,继续可用
- 老 SDK(≤ v1.5.0)拿到 `/api/image-gen/products` 响应会忽略多余字段,
  无破坏
- 不传新参数(query 全部不传)行为零变化
- DB 迁移:`pnpm db:push`(新增 product_accessory_variant 表)
- DB seed:`pnpm tsx src/db/seed-product-accessory-variants.ts`(幂等)

**迁移指南**(从 v1.5.0 升级)

```diff
- import { listTemplates, submitGenerate } from "@/api/sdk";
+ import { listProducts, submitGenerate } from "@/api/sdk";

  // 老 SDK:从 listTemplates 推 productTypeCode,自己算 accessories
- const { templates } = await listTemplates();
- const myTemplate = templates.find(t => t.productTypeCode === "R");
+ // v1.6.0:listProducts() 直接按 productTypeCode 组织,带完整配件 + 变体
+ const { products } = await listProducts();
+ const myProduct = products.find(p => p.productTypeCode === "R");
+ const myTemplate = myProduct?.templates.find(t => t.templateId === "R-cute-001");
+
+ // 新增:配件颜色变体(v1.5.0 之前没有)
+ const myLeather = myProduct?.accessories.find(a => a.code === "leather");
+ const myColor = myLeather?.variants.find(v => v.code === "leather_brown");
+
  // submitGenerate 行为零变化 —— 仍传 maskId / aiStyleId / imageUrls
- const { taskId } = await submitGenerate({
-   maskId: "R-cute-001", imageUrls: [url], aiStyleId: "ai_qversion",
- });
+ const { taskId } = await submitGenerate({
+   maskId: myTemplate!.templateId,
+   imageUrls: [url],
+   aiStyleId: "ai_qversion",  // 来自 myTemplate.visualStyles[].id
+ });
```

### v1.5.0 — 2026-10-16

**新增(additive only —— 不传 aiStyleId 行为零变化)**

模板视觉样式(Q版 / 动漫 / 水彩 / 线稿 / 原图):每条 mask 自带一组
样式选项,提交生图时把对应样式的关键 prompt 替换到模板 prompt 的
`{{style}}` 占位符里 ——「替换关键提示词」语义,直接对齐「产品模板 =
产品,里面再分风格」的业务语义。

**新增**
- 🆕 `PromptTemplatesResponse.templates[i].styles: TemplateStyle[]` —
  每条 mask 自带的视觉样式数组。后端数据源:`promptTemplate.styles`
  JSON 列(无 Drizzle 迁移 —— 已有行 default `[]`)。
- 🆕 SDK 类型 `TemplateStyle`(id / name / nameEn / prompt /
  surchargeCents / outputSize / swatch / estimatedLatencySec)—— SDK
  把 prompt 也暴露,是为了支持后端的占位符替换语义,SDK 端可显式
  看到自己选的是哪个关键提示词
- 🆕 `submitGenerate.aiStyleId?: string` —— 选 mask 后从
  `mask.styles[j].id` 选 id 透传;服务端校验 aiStyleId ∈ mask.styles
  后,用 `styles[j].prompt` **替换**模板 prompt 里的 `{{style}}` 占位符
  (替换关键提示词)
- 🆕 业务错误码 `INVALID_STYLE` —— aiStyleId 不在该 mask.styles 内
  时 400 拒绝,不兜底

**变更**
- 🔨 不再有独立的 `GET /api/image-gen/style-types` 端点 —— 样式跟着
  mask 走,listTemplates() 一次到位,少一个端点开销、少一轮拉取。SDK
  端去掉 `listStyles()` 函数与 `StyleTypesResponse` 类型(mp 仓库里
  老引用编译报"no exported member"是预期的破坏性变化,提醒升级)
- 🔨 不再有全局样式字典(早先设计过)—— 真理源是每个模板自带的
  `promptTemplate.styles`,默认 5 项种子放在
  `src/features/image-gen/lib/ai-styles.ts`(`DEFAULT_TEMPLATE_STYLES`)
  供新建模板时一键填入

**不变 —— 兼容性**
- 计费:`costCredits` 不变,样式仅 prompt 替换,未动 credits 数学。
  加价信息位于 `mask.styles[i].surchargeCents`,mp UI 自己展示「+¥15」
- 行为:不传 aiStyleId / 传 `ai_original`(直通)= 等价于 v1.4.0 行为,
  现有 mp 业务 0 回归
- 不传 aiStyleId 时 prompt 拼接与今日完全一致;模板不含 `{{style}}` 占位
  符时,服务端会把样式 prompt prepend 到模板 prompt 之前(兜底)
- 工作台路径(`generateImageJob` action)未动 —— 本次只改外部 SDK 链路

**SDK 迁移指南**(从 v1.4.0 升级)
```diff
- import { listStyles } from "@/api/sdk";
+ // v1.5.0 起 listStyles() 移除,样式跟随 templates[i].styles 走

  // 启动时拉一次,styles 自动跟着 listTemplates() 一起到
- const { styles } = await listStyles();
  const { templates } = await listTemplates();

  // 提交生图时可选 aiStyleId(不传 = 今日行为)
  const { taskId } = await submitGenerate({
    maskId: "R-cute-001",
    imageUrls: [url],
+   aiStyleId: templates.find((t) => t.id === "R-cute-001")
+                ?.styles.find((s) => s.id === "ai_qversion")
+                ?.id,  // ← 选 Q 版,可选字段
  });
```

**Server 端配套**
- 后端:`src/db/schema.ts` 给 `promptTemplate` 加 `styles: json`
  (默认 `[]`,无数据迁移)
- 新类型:`src/db/image-gen-types.ts` 加 `TemplateStyle`
- 新模块:`src/features/image-gen/lib/ai-styles.ts` 改 exports 为
  `DEFAULT_TEMPLATE_STYLES` + `findStyleInList(styles, id)`
- `templates/route.ts` 每条 mask 拼上 `styles: TemplateStyle[]`
- `submit/route.ts` prompt 拼接改为「替换 `{{style}}` 占位符优先,
  缺失则 prepend 兜底」
- 删除旧端点:`src/app/api/image-gen/style-types/route.ts`
- storefront:`src/features/storefront/lib/mock-catalog.ts` 改 import
  新模块,`AI_STYLES` 与 `findAiStyle` helper 内部重映射,storefront 旧
  消费方(`/api/store/ai/transform`、`pricing.ts`、`customization-spec.ts`)
  签名不破

### v1.4.0 — 2026-10-15

**Breaking(归一化责任后移 server 端)**

v1.3.1 时代的 `publicUploadDirectFromMp(filePath)` 在 Taro base lib
3.17.3+ 上 100% 失败(`taroReadFileAsArrayBuffer` 卡 `instanceof
ArrayBuffer`,Taro 改返 `Uint8Array`);即使绕过 SDK 自己在 mp 端
做压缩,`proxyImageInputsToR2` 看到 R2 URL 直接 skip,server 端永远
碰不到字节,apimart 拿 HEIC 报错 —— **mp 端 SDK 内部做格式归一化
这条路整体走不通**。

v1.4.0 重新设计:归一化责任完整后移到 server 端,mp 端零依赖
Taro.compressImage。

**变更**
- 🗑️ 删除 `publicUploadDirectFromMp(filePath, options?)` —— mp 端
  不要再做格式归一化;调用方代码用 `publicUploadDirect(blob, mime)` 替代
- 🗑️ 删除 `image-utils.ts` 内 `prepareMpFileForUpload()` 和
  `taroCompressImage()` —— SDK 内部不再需要 client-side 压缩
- 🆕 导出 `readTaroFileAsArrayBuffer(filePath)` —— mp 业务可自取
  Taro tempFilePath → ArrayBuffer;内部修了 Taro 3.17.3+ Uint8Array
  返回的兼容(`ArrayBuffer.isView` 分支,`.buffer.slice()` 出独立副本)
- 📝 Section 5 用法从 `publicUploadDirectFromMp` 换到
  `publicUploadDirect(blob) + sizeType:['compressed']`(iOS 微信内置
  HEIC→JPG,链路 0 风险)
- 🔢 集成 checklist 同步:Step 1 强制 `sizeType:['compressed']`

**Server 端配套**
- `/api/public/upload-url` MIME 白名单从 `{png, jpeg, webp}` 放宽到
  `image/*` —— mp 可以传任何 image 类 mime,server 端 sniff 兜底
- `proxyImageInputsToR2` R2 URL skip 规则改为 HeadObject 查
  `x-moon-normalized` metadata 标记 fast-path;未标记走 fetch + sniff
  + 必要时归一化(SVG resvg-js / BMP / TIFF / GIF jimp 转 PNG)
- HEIC 仍由 mp 端处理(server 端 jimp 不支持、装 sharp 违反 CLAUDE.md
  约束;iOS 微信 `sizeType:['compressed']` 已内置 HEIC→JPG)

**迁移指南**(从 v1.3.1 升级)
```diff
- import { publicUploadDirectFromMp } from "@/api/sdk";
+ import { publicUploadDirect } from "@/api/sdk";

  const { tempFilePath } = await Taro.chooseImage({
    count: 1,
-   sizeType: ["original"],
+   sizeType: ["compressed"],   // ← v1.4.0 起强制
  });
- const { url } = await publicUploadDirectFromMp(tempFilePath);
+ // 业务侧自取 tempFilePath → Blob
+ const fsm = Taro.getFileSystemManager();
+ const { data } = await new Promise<{ data: ArrayBuffer | Uint8Array }>(
+   (resolve, reject) => fsm.readFile({ filePath: tempFilePath, success: resolve, fail: reject })
+ );
+ const blob = new Blob([data as BlobPart], { type: "image/jpeg" });
+ const { url } = await publicUploadDirect(blob, "image/jpeg");
```

**兼容性**
- `publicUploadDirect(file, mime)` 不变,旧业务代码无需改 upload 逻辑
- `publicUpload(file)` 不变,继续作为 wx.request 不支持 PUT 的环境 fallback
- `readTaroFileAsArrayBuffer` 是新增 public API,旧 SDK 升级后可用
- 业务方如果还在用 `publicUploadDirectFromMp`,会得到 "no exported member"
  编译错 —— 这是预期的破坏性变更提醒升级

### v1.3.1 — 2026-10-15

**修复(mp 端格式归一化)**

v1.3.0 上线后被用户当场发现的问题:mp 端 iOS 微信选原图
(`Taro.chooseImage({ sizeType: ['original'] })`)拿到的 filePath
是 HEIC,直传 R2 落的是 HEIC;后续 `submitGenerate.proxyImageInputsToR2`
看到 R2 URL 直接跳过(已有 R2 跳过是幂等设计),server 端
`normalizeToSupported` 根本不会跑,apimart 拿 HEIC 报错。

**修复**:新增 `publicUploadDirectFromMp(filePath, options?)` —
内部走 `Taro.compressImage(src, 90, 'jpg')` 把 HEIC/BMP/TIFF/PNG
/任何 format 压成标准 JPG,再 `getFileSystemManager().readFile` 读
为 ArrayBuffer,包 Blob 走 `publicUploadDirect` 直传 R2。链路 0
风险,mp 开发者**一行调用即可**,不用关心 iOS HEIC。

**新增**
- `publicUploadDirectFromMp(filePath, options?)` —— mp 一键:HEIC→JPG + 直传 R2
- `image-utils.ts` 内部模块:
  - `prepareMpFileForUpload(filePath, options?)` —— Taro 适配层,
    暴露 `compressImage` + `readFile` 给 SDK 内部复用
  - `TaroGlobal` 类型(运行时探测,无编译期 Taro 依赖)

**变更**
- `publicUploadDirect` JSDoc 加 HEIC 警告 + 推荐改用 `publicUploadDirectFromMp`
  - 本函数仍然有效(适用于已知是 PNG/JPG/WebP 的场景 / 浏览器 / RN)
  - 不自动归一化,因为浏览器环境无 Taro 探测,跨平台兜底复杂
- README Section 5 用法从 `publicUploadDirect` 换到 `publicUploadDirectFromMp`
- 鉴权表 / 集成 checklist 同步

**兼容性**
- `publicUploadDirectFromMp` 仅 Taro 编译环境有效(WeChat mp / H5 / RN)
- 非 Taro 环境(纯浏览器测试 / Node 调试)调它会 throw,
  fallback 到 `publicUpload(file)` 走 BFF multipart 即可

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
