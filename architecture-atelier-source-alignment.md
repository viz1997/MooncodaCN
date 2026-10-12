# NextDevTpl × atelier-source · 模板对齐架构说明

> **⚠️ 2026-09-17 此文档已废弃**
>
> 本文档基于对 `D:\下载\atelier-source` 的**误读**编写。原以为该目录是 Medusa 项目,实际它是 **Next.js 16 + NextAuth + Prisma + Tailwind + Shadcn + z-ai-web-dev-sdk 的纯电商模板**,没有 Medusa server,没有 PostgreSQL,Prisma schema 只有 stock 的 User / Post 两张表。
>
> **正确方向仍由 [architecture-medusa-integration.md](./architecture-medusa-integration.md) 描述**:Medusa 100% 承担 product/market + 订单管理 + 支付管理;NextDevTpl 只做 AI SaaS 后端。
>
> 本文档归档保留,仅作历史决策日志;**不要按本文档做任何代码改动**。

---

> **Mooncoda · 小梦定制馆**
> 状态:方案稿 · 2026-09-17 初版
> 目标读者:技术负责人 / 后端 / 前端 / DevOps
> 前置阅读:
> - [architecture-miniprogram-as-client.md](./architecture-miniprogram-as-client.md)——项目身份定位(已定)
> - [architecture-medusa-integration.md](./architecture-medusa-integration.md)——**已被本文档取代**
>
> 参考实现:`D:\下载\atelier-source`(Next.js 16 + NextAuth + Prisma + Tailwind 4 + Shadcn + NextIntl + z-ai-web-dev-sdk 的纯电商模板)

---

## 〇、为什么放弃 Medusa 路线

### 0.1 三个参考方案的对比

| 维度 | Medusa 路线(已弃) | atelier-source 路线(本次) |
|---|---|---|
| 部署形态 | NextDevTpl + 独立 Medusa server + 独立 storefront | **NextDevTpl 单体**(Next.js + NextAuth + Prisma) |
| 商品/规格/价格权威 | Medusa server(独立 PG / Redis / Meilisearch)| **NextDevTpl Prisma + TS config**(`pricing.config.ts`) |
| AI 风格 | `promptTemplate` DB 表(支持变量 + 加价)| **5 个 aiStyles 硬编码**(`pricing.config.ts:203-258`) |
| AI 模型 | Lingting wellapi.ai(异步 + Inngest)| **`z-ai-web-dev-sdk` image-edit**(同步 + 服务端 retry) |
| 购物车 | Medusa Store API(cart 表)| **Zustand + localStorage** |
| 订单 | Medusa Order(支付/物流/库存)| **暂无**(atelier-source 仍是模板阶段) |
| 产品类型数 | 6 个(R/A/P/RM/LB/M)| **3 个**(keychain/figure/magnet)|
| 客户旅程 | guest cart + email match(V1)| **不登录 / 不下单**(atelier 仍是橱窗) |
| 工程量 | 大(Medusa server + subscriber + HMAC webhook)| **小**(Next.js 单体 + Prisma) |

### 0.2 决策动机

atelier-source 是**已写好的 80% 商业参考实现**(纯 Next.js + Stripe-Ready + NextAuth),把它「移植升级」成 NextDevTpl 比从零搭 Medusa server **省 ~3 个月工作量**。核心思路:

- ✅ **复用** atelier-source 的 storefront UI / pricing 算法 / z-ai 直调模式 / CustomizationSpec 协议
- ✅ **保留** NextDevTpl 已落地的 BA 鉴权 / credits 账本 / photo + imageJob 数据 / R2 上传 / WeChat 小程序登录
- ❌ **砍掉** Medusa server + 独立 storefront + Medusa Store/Admin API + 17 个 `/api/orders/[token]/*` 中的 Medusa-only 字段
- 🔄 **重构** `promptTemplate` + `promptTemplatePrice` + `productLine` + `productEffect` 为 atelier 风格的 TS config + Prisma

---

## 一、整体架构图

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ 微信小程序       │    │ Web Dashboard   │    │ 浏览器访客     │
│ (Taro)         │    │ /dashboard/*    │    │ /marketing/*   │
│                │    │ /admin/*        │    │ (atelier-style)│
└────────┬───────┘    └────────┬────────┘    └────────┬───────┘
         │                     │                      │
         │ Bearer             │ BA Cookie             │ (no auth)    │
         │ (wechat-login)     │                      │              │
         ▼                     ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  NextDevTpl · 单体 Next.js 16 BFF                        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────┐         │
│  │ 鉴权层                                                       │         │
│  │ • Better Auth(cookie + Bearer session token)                  │         │
│  │ • WeChat phoneNumber plugin(/api/auth/wechat-phone-login)     │         │
│  │ • phone + email + OAuth 三种登录方式共存                       │         │
│  └────────────────────────────────────────────────────────────┘         │
│  ┌────────────────────────────────────────────────────────────┐         │
│  │ 商业数据(Prisma + TS config 单一权威)                         │         │
│  │ • Product / ProductVariant(3 个 productType × 字典项)           │         │
│  │ • pricing.config.ts(materials/sizes/aiStyles/quantityTiers)   │         │
│  │ • CustomizationSpec(spec ↔ line_item.metadata 协议)           │         │
│  │ • /api/pricing/calculate 服务端权威定价                        │         │
│  │ • /api/ai/transform z-ai 直调 + R2 落盘                       │         │
│  └────────────────────────────────────────────────────────────┘         │
│  ┌────────────────────────────────────────────────────────────┐         │
│  │ 创作资产(photo + imageJob + promptOrder)                       │         │
│  │ • 复用现有 photo/imageJob(persistCandidateToR2 仍生效)          │         │
│  │ • promptOrder 退化为「ToB 代理商 demo 内部审计视图」             │         │
│  │ • Medusa 模式的 promptOrder.medusaOrderId 字段丢弃              │         │
│  └────────────────────────────────────────────────────────────┘         │
│  ┌────────────────────────────────────────────────────────────┐         │
│  │ 积分账本(creditsBalance/creditsBatch/creditsTransaction)       │         │
│  │ • /api/ai/transform 按 aiStyle.costCents + 数量 扣 credit     │         │
│  │ • 与定价并行:成品价(USD cents,atelier) ↔ 渲染价(积分,NextDevTpl) │         │
│  └────────────────────────────────────────────────────────────┘         │
│  ┌────────────────────────────────────────────────────────────┐         │
│  │ 文件存储                                                       │         │
│  │ • R2(Cloudflare):public bucket mooncada-public                 │         │
│  │ • /api/public/upload 走 presigned URL                           │         │
│  │ • /api/image-gen/{thumbnail,download} 服务端代理                │         │
│  └────────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
         │
         │ 服务端 fetch + 服务端 env API Key
         ▼
┌────────────────────────┐
│ z-ai-web-dev-sdk      │
│ (z-ai image-edit API) │
└────────────────────────┘
```

---

## 二、atelier-source 核心模式迁移到 NextDevTpl

### 2.1 productType 字典对齐(6 → 3)

**atelier-source 字典**(`pricing.config.ts:73-94`,只 3 个 type):
```ts
type ProductType = "keychain" | "figure" | "magnet"
// 每个 type 有独立 basePriceCents / leadTimeDays / rushAvailable / rushMultiplier
```

**NextDevTpl 现字典**(`src/features/gpt-image/lib/product-catalog.ts`,6 个 type R/A/P/RM/LB/M):
- R(钥匙扣) ≈ atelier keychain
- A(异形钥匙扣) ≈ 合并到 atelier keychain 的 sizes 维度
- RM(相框)→ **删除**(atelier 不做相框)
- P(冰箱贴) ≈ atelier magnet
- LB(皮革徽章)→ **删除**(atelier 不做皮革)
- M(手办) ≈ atelier figure

**对齐矩阵**:

| NextDevTpl 现 type | atelier type | sizes | accessories → atelier materials | capabilities → atelier fields |
|---|---|---|---|---|
| **R** 钥匙扣 | `keychain` | 4/5/6/8 cm | leather/pvc → acrylic / acrylic-bone | 刻字 → engravingText;颜色 → 不支持;外露 → 不支持;PVC → 不支持;备注 → 不支持 |
| **A** 异形钥匙扣 | `keychain`(同一 type) | 4/5/6/8 cm | 同上 | 同上 |
| **P** 冰箱贴 | `magnet` | 4/5/6/8 cm | magnet → acrylic / acrylic-bone / tinplate | 无定制能力 |
| **RM** 相框 | **删除** | — | — | — |
| **LB** 皮革徽章 | **删除** | — | — | — |
| **M** 手办 | `figure` | 4/5/6/8/10/12/15/18 cm → 选 5/8/12 cm | stand → resin | 无表面定制能力 |
| **总计** | **3 个 type** | **8 个 size** | **4 个 material** | — |

**变体数量对比**:
- NextDevTpl 现状:~48 个 variant(R/A/P/RM/LB/M 全尺寸配件组合)
- atelier 对齐后:**~16 个 variant**(3 type × 平均 5 size × 平均 2 material)

### 2.2 promptTemplate → aiStyles(数据库→硬编码 TS)

**atelier-source aiStyles**(`pricing.config.ts:203-258`,5 个):
```ts
aiStyles = [
  { id: "ai_original", prompt: "Keep as-is", costCents: 0 },
  { id: "ai_qversion", prompt: "Q-Version chibi", costCents: 8 },
  { id: "ai_anime", prompt: "Anime style", costCents: 8 },
  { id: "ai_watercolor", prompt: "Watercolor wash", costCents: 8 },
  { id: "ai_lineart", prompt: "Minimal line art", costCents: 8 },
]
```

**NextDevTpl 现 promptTemplate 表**:
- `promptTemplate` (核心模板表)
- `promptTemplatePrice` (按规格加价)
- `productLine` (产品线)
- `productEffect` (legacy 兼容)

**迁移策略**:

| NextDevTpl 现字段 | 迁移目标 | 备注 |
|---|---|---|
| `promptTemplate.id` | `aiStyles[].id` | 改成 `"ai_qversion"` 而非 `"tmpl_xxx"` |
| `promptTemplate.name` | `aiStyles[].name` | "Q-Version" / "Anime" / ... |
| `promptTemplate.description` | `aiStyles[].description` | UI 短描述 |
| `promptTemplate.prompt` | `aiStyles[].prompt` | 直传给 z-ai image-edit |
| `promptTemplate.size` | `aiStyles[].outputSize` | 1024x1024 单一尺寸 |
| `promptTemplate.candidateCount` | **丢弃** | atelier 模式 1 张候选 |
| `promptTemplate.price` | **丢弃** | 价格走 pricing.config.ts 加价规则 |
| `promptTemplate.coverUrl` | `aiStyles[].swatch` | CSS gradient 而非 R2 URL |
| `promptTemplate.productTypeCode` | **丢弃** | aiStyles 不绑定 productType,任意 type 可选任意 style |
| `promptTemplate.allowedSizes` | **丢弃** | sizes 由 productType.pricing.spec 决定 |
| `promptTemplate.allowedAccessories` | **丢弃** | materials 走 pricing.config.ts |
| `promptTemplate.outputMode` | **丢弃** | atelier 单图直接返 |
| `promptTemplate.variables` | **丢弃** | aiStyles 无变量 |
| `promptTemplatePrice` | **丢弃** | 加价走 productTypePricing.basePriceCents + deltaCents |

**关键简化**:aiStyles 是全局 5 个,所有 productType 共用。**用户选完 productType + size + material 后,在 aiStyles 里挑一个风格**。

### 2.3 AI 模型替换:Lingting wellapi.ai → z-ai-web-dev-sdk

**atelier-source 调用模式**(`/api/ai/transform/route.ts`):
```ts
import ZAI from "z-ai-web-dev-sdk"

const zai = await ZAI.create()
const response = await zai.images.generations.edit({
  prompt: style.prompt,
  images: [{ url: image }],  // base64 data URL 也可
  size: style.outputSize,
})
const editedDataUrl = `data:image/png;base64,${response.data[0].base64}`
const previewUrl = await saveImage(editedDataUrl, style.id)
```

**NextDevTpl 现调用模式**:
- `src/lib/ai/openai.ts`(OpenAI/DeepSeek/MiMo 三家)
- Lingting wellapi.ai(`src/features/gpt-image/`)
- `persistCandidateToR2`(`src/features/gpt-image/lib/generation-service.ts`)
- Inngest 异步 + `imageJob` 表

**迁移策略**:

| NextDevTpl 现 | 替换为 | 备注 |
|---|---|---|
| `submitLingtingTask` + Inngest | **z-ai 直调**(同步) | atelier 同步返,3 次 retry |
| `imageJob` 表 + `advanceImageGenJob` | **保留**(作为审计日志) | 仍写入但 status 流改简单 |
| `promptOrder.candidates` 嵌套数组 | **保留**(但只 1 张) | 与 atelier preview URL 单图一致 |
| `persistCandidateToR2` | **保留** + 复用 `/api/ai/transform` | R2 落盘不依赖异步 |
| `photo` 表 | **保留** | 用户上传图库继续用 |
| `migrateResultUrlToR2`(wellapi URL 迁移) | **删除** | z-ai 不存在上游 URL 过期问题 |
| Lingting 8MB multipart 上限 | **删除** | z-ai 不需要客户端预先上传 server-side(直接传 base64) |
| Lingting 4x3 grid 拼接 | **删除** | atelier 单图直返 |

**新增路由**:`src/app/api/ai/transform/route.ts`
- POST `{ image: dataURL, styleId: string }` → `{ previewUrl, styleId, latencyMs, aiCall: boolean }`
- GET → 返 5 个 aiStyles 列表
- 鉴权:**Bearer**(用于小程序)或**BA Cookie**(用于 Web)
- 扣 credit:按 `aiStyle.costCents × quantity` 在 creditsTransaction 写一条
- 错误响应:400 输入校验;500 AI 失败 + `canRetry: true`

### 2.4 CustomizationSpec 协议替换 promptOrder 字段集

**atelier CustomizationSpec**(`customization-spec.ts:12-34`):
```ts
{
  productId: string,        // → NextDevTpl product.id
  handle: string,           // → URL 路由
  materialId: string,       // → pricing.config.materials.id
  sizeId: string,           // → pricing.config.sizes.id (kc-small-4cm 等)
  aiStyleId: string,        // → pricing.config.aiStyles.id (ai_qversion 等)
  engravingText: string,    // → 替代 promptOrder.engravingText
  rushOrder: boolean,       // → 替代 promptOrder.urgency (atelier 用 rushMultiplier 1.3)
  quantity: number,         // 1-100
  previewImageUrl: string,  // → /api/ai/transform 返的 R2 URL
}
```

**NextDevTpl 现 promptOrder 字段集**(对比):
| promptOrder 字段 | 迁移目标 | 备注 |
|---|---|---|
| `templateId` (FK promptTemplate) | **删** | 用 aiStyleId 取代 |
| `productTypeCode` | `productId` (FK product) | Prisma 真实外键 |
| `productSize` | `sizeId` | pricing.config 标准 ID |
| `accessoryCode` | `materialId` | pricing.config 标准 ID |
| `engravingText` | `engravingText` | 同语义 |
| `engravingExposed` | **删** | atelier 不支持 |
| `leatherColor` / `leatherExposed` / `pvcProtection` / `remarks` | **全删** | atelier 不做 LB 皮革徽章 |
| `platform` / `platformOrderNo` | **保留**(admin 内部归因) | 移到 imageJob.metadata |
| `candidates` (嵌套数组) | `previewImageUrl`(单 URL) | atelier 单图直返 |
| `selections` / `selectedIndex` | **删** | 单图无选择 |
| `uploadedImages` (dataUrl[]) | **保留**(imageJob.metadata.referenceImageUrls) | z-ai 单参考图可走 dataUrl,不强制 R2 上传 |
| `regenerateLimit` | **删** | atelier 失败 retry 由 client 重调 /api/ai/transform |
| `uploadCount` / `imagesPerUpload` | **删** | 单参考图即可 |
| `creditsCharged` / `creditsBreakdown` | `price.costCents`(迁移自 aiStyle) | credits 仍走账本 |
| `token` (32-char hex) | **保留**(若继续 ToB demo 流) | 内部审计用 |
| `status` | **简化** | PENDING → COMPLETED 两态 |
| `medusaOrderId` / `medusaOrderNo` | **删** | 砍掉 Medusa |

**CustomizationSpec 落地方式**:
- TS 类型定义在 `src/lib/store/customization-spec.ts`
- Prisma 表 `promptOrder` 改名为 `customOrder`,字段按上述裁剪
- 服务端 `/api/pricing/calculate` + `/api/ai/transform` 严格按 spec 校验

---

## 三、API 接口改造映射

### 3.1 新增(atelier 模式)

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| POST | `/api/pricing/calculate` | `{ productId, materialId, sizeId, aiStyleId, engravingText, rushOrder, quantity, previewImageUrl }` → `{ spec, unitPriceCents, totalPriceCents, breakdown, estimatedShipDays, calculatedAt }` | 公开(用于前端预览) |
| POST | `/api/ai/transform` | `{ image: dataURL, styleId }` → `{ previewUrl, styleId, latencyMs, aiCall, attempts }` 或 500 `{ error, canRetry }` | Bearer/BA Cookie + 扣 credit |
| GET | `/api/ai/transform` | 返回 5 个 aiStyles 列表 | 公开 |

### 3.2 保留(微调)

| 现有路径 | 调整 |
|---|---|
| `/api/public/upload` | **保留**,小程序上传原图走它(给 z-ai 也可用 R2 URL) |
| `/api/image-gen/thumbnail` | **保留**(`/api/ai/transform` 返的 R2 URL 走它做代理) |
| `/api/image-gen/download` | **保留** |
| `/api/auth/wechat-phone-login` | **保留**(小程序登录) |
| `/api/orders` | **简化**:仅保留 ToB 代理商 demo 流的 GET 列表 + GET/POST `/api/orders/[token]/*` |
| `/api/orders/[token]/*` | **简化**:删除 Medusa 关联字段(metadata.candidates / candidates URL 不再是嵌套数组,改为单 previewImageUrl) |

### 3.3 删除(Medusa 模式专属)

| 路径 | 删除原因 |
|---|---|
| `/api/products/by-code/[code]` | atelier 不按 productTypeCode 拉商品,改用 Prisma 直接 query |
| `/api/prompt-templates/resolve` | promptTemplate 表被砍 |
| `/api/webhooks/medusa/order-placed` | 无 Medusa server |
| `/api/medusa/bridge-token` | 无 Medusa 桥接 |
| 17 个 `/api/orders/[token]/*` 中的 Medusa 字段 | order 不再写 medusa_order_id/no |

### 3.4 全部路由鉴权改造(Phase R 残留)

- `/api/ai/transform` 用 `getSessionFromRequest`(Cookie-or-Bearer)
- `/api/pricing/calculate` 公开,但扣 credit 时需鉴权(可选)

---

## 四、数据表改造(Prisma 优先 + Drizzle 兼容)

### 4.1 Prisma 接入

atelier-source 用 Prisma + SQLite,**NextDevTpl 当前用 Drizzle + PostgreSQL**。两种选择:

| 方案 | 取舍 |
|---|---|
| **A** 沿用 Drizzle + PostgreSQL | 不引入新栈,改造小 |
| **B** 切到 Prisma + PostgreSQL | 与 atelier 同构,代码移植简单,但迁移成本大 |

**推荐方案 A**(沿用 Drizzle)。Drizzle 的优势(schema 在 TS + type-safe)在 WJP 已落地;Prisma 工具链(fixtures / introspection)价值不大。**数据表名不变,字段裁剪即可**。

### 4.2 表改造

**product / productType(Prisma)**:

如果保留 Prisma 接入,新增 `product` + `productVariant` 两张表(`prisma/schema.prisma` 现有 User/Post 不动):
```prisma
model Product {
  id        String   @id @default(cuid())
  handle    String   @unique
  title     String
  type      String   // "keychain" | "figure" | "magnet"
  basePrice Float    // USD
  // ... 字段参考 atelier Product.interface
}

model ProductVariant {
  id        String  @id @default(cuid())
  productId String
  sizeId    String  // 引用 pricing.config.sizes.id
  materialId String?  // null 表示该 size 无 material 选项
  // pricing 自动从 pricing.config 计算
}
```

**如果沿用 Drizzle**(推荐):
- 保留现有 `productLine` 表但**字段裁剪**:只保留 `id` / `type` / `handle` / `title` / `basePrice`
- 新增 `productVariant` 表:`(productLineId, sizeId, materialId)` 三元组 + Prisma 生成的 cuid PK
- **删除** `productEffect` / `promptTemplate` / `promptTemplatePrice` 三张表(老数据走 `scripts/archive-medusa-templates.ts` 备份)

**imageJob 表**:
- 保留(`status` / `resultUrls` / `taskId` 等基础字段)
- 加 `aiStyleId` (string,匹配 aiStyles.id 而非 promptTemplate.id)
- 加 `productVariantId` (string,FK → productVariant.id)
- 加 `materialId` / `sizeId` / `engravingText` / `rushOrder` / `quantity`(CustomizationSpec 落库)

**promptOrder 表**:
- 重命名为 `customOrder`
- 删除:`templateId` / `candidates` (嵌套数组) / `selections` / `selectedIndex` / `engravingExposed` / `leatherColor` / `leatherExposed` / `pvcProtection` / `medusaOrderId` / `medusaOrderNo`
- 保留:`id` / `orderNo` / `token` / `createdBy` / `createdAt` / `recipientName` / `imageJobId`
- 新加:`customOrderItems` 子表(支持多 item 一单,如批量钥匙扣 5 个)

**user 表**:
- **删除** `medusaCustomerId` 字段(无 Medusa 集成)
- **保留** `wechatOpenid` / `wechatUnionid` / `lastLoginAt` / `phoneNumber` / `phoneNumberVerified`

---

## 五、定价/积分双轨

atelier-source **只一套定价**(成品价 USD cents)。NextDevTpl 引入积分账本后,**双轨并存**:

### 5.1 渲染价(积分,NextDevTpl 内部)
- 5 个 aiStyle.costCents 已知(0/8 cents 各),按 `quantity × costCents` 扣 credit
- `/api/ai/transform` 入口先 grant-then-consume credits(防止透支)
- creditsTransaction 写一条 `type: 'ai_transform', metadata: { aiStyleId, quantity, costCredits }`

### 5.2 成品价(USD cents,atelier 风格)
- `/api/pricing/calculate` 服务端权威,客户端永远不直读 pricing.config
- 价格公式:`basePriceCents + materialDeltaCents + sizeDeltaCents + engravingFeeCents`
- 应用 rushMultiplier + quantity tier discount
- 落库到 `customOrder.unitPriceCents` + `customOrder.totalPriceCents`

### 5.3 支付/订单

atelier 仍无订单表。**NextDevTpl 走 Creem 订阅模式**(现有 `/api/webhooks/creem`),**单笔零售支付后续接**(暂不在 V1 范围)。**用户下单触发**:前端 → `customOrder` 表写入 + Creem 一次性付款链接 + webhook 确认 → `customOrder.status = PAID`。

---

## 六、微信小程序对接新路由

小程序现在调 `/api/auth/wechat-phone-login` 拿 BA token,后续:

```ts
// 1. 选商品 + 选规格(前端本地,数据从 Prisma 拉)
const product = await fetch('/api/products?type=keychain')
const pricingPreview = await fetch('/api/pricing/calculate', {
  method: 'POST',
  body: JSON.stringify({ productId, materialId, sizeId, aiStyleId, quantity })
})

// 2. 上传原图到 R2
const { uploadUrl, publicUrl } = await fetch('/api/public/upload', {
  method: 'POST', body: JSON.stringify({ contentType, size: fileSize, ext: 'jpg' })
}).then(r => r.json())
await fetch(uploadUrl, { method: 'PUT', body: fileBlob })

// 3. 调 AI transform
const { previewUrl } = await fetch('/api/ai/transform', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${baToken}` },
  body: JSON.stringify({ image: publicUrl, styleId: 'ai_qversion' })
}).then(r => r.json())

// 4. (可选)再次 pricing 确认带 previewImageUrl 的总价
const finalPricing = await fetch('/api/pricing/calculate', {
  method: 'POST', body: JSON.stringify({ ..., previewImageUrl: previewUrl })
})

// 5. 调 Creem 一次性支付(暂跳过)
```

**无 Medusa JWT,无 cart API,无 order API**。简化 ~80%。

---

## 七、迁移阶段计划

#### Phase U-A(地基,1 周)
- [ ] 新增 `src/lib/store/pricing.config.ts`(从 atelier-source 1:1 拷贝 + 字段微调)
- [ ] 新增 `src/lib/store/customization-spec.ts`(从 atelier-source 1:1 拷贝)
- [ ] 新增 `src/app/api/pricing/calculate/route.ts`(从 atelier 1:1 拷贝)
- [ ] 新增 `src/app/api/ai/transform/route.ts`(从 atelier 1:1 拷贝,扣 credit 适配)
- [ ] 加 `z-ai-web-dev-sdk` 依赖:`pnpm add z-ai-web-dev-sdk`
- [ ] 加 env `ZAI_API_KEY`(从 z-ai 控制台拿)

#### Phase U-B(数据裁剪,1 周)
- [ ] 备份老 promptTemplate / promptTemplatePrice / productLine / productEffect:`scripts/archive-medusa-templates.ts`
- [ ] 裁剪 productLine 表字段(drizzle migration)
- [ ] 新增 productVariant 表 + drizzle migration
- [ ] 裁剪 promptOrder → customOrder(migration)
- [ ] 删 user.medusaCustomerId
- [ ] imageJob 加 aiStyleId / productVariantId / spec.ts 字段

#### Phase U-C(Web storefront 改造,1-2 周)
- [ ] 移植 atelier-source `src/components/storefront/*` 到 NextDevTpl(适配 Shadcn + Tailwind 4)
- [ ] 适配 auth:guest 模式浏览 + 已登录用户调 AI 路由
- [ ] 适配 credits 展示(余额 + 即将扣减预览)

#### Phase U-D(微信小程序接入,1 周)
- [ ] 小程序端商品列表 + 规格选择器 UI
- [ ] 小程序端调 `/api/ai/transform`(用 BA token)
- [ ] 小程序端 `/p/[token]`(preview 分享)改造为 previewImageUrl 单图

#### Phase U-E(清理 + 文档,0.5 周)
- [ ] 删除 11 个 cookie-only 路由的 cookie 硬依赖(全部走 getSessionFromRequest)
- [ ] 删除 Medusa 相关代码(`architecture-medusa-integration.md` 标注 DEPRECATED)
- [ ] 更新 CLAUDE.md 指向 atelier 模板

---

## 八、风险点

### 8.1 数据迁移

- 老 `promptOrder` 数据(几千条)裁剪后会丢 `templateId` / `candidates` 等字段 —— **必须先 archive 备份**(archive-medusa-templates.ts)
- 老 `imageJob.maskId` 引用 `productEffect.id`,迁移后 `aiStyleId` 引用 `aiStyles.id`(映射 `ai_qversion → ai_original` 等价转换)
- 老 `user.medusaCustomerId` 字段删除:零下游消费,纯字段删除

### 8.2 aiStyle 模式硬编码

atelier 的 5 个 aiStyles 是 TS config,**admin 不能运行时改**。如果业务需要「新增 AI 风格」,要么:
- (A) 改 TS 文件重新部署
- (B) 把 aiStyles 提到 Prisma 表(失去 atelier 的简洁性)

**V1 选 A**,5 个风格已覆盖 80% 业务场景。

### 8.3 z-ai-web-dev-sdk 不成熟

`z-ai-web-dev-sdk@0.0.18` 是 pre-release 版本,**API 可能不稳定**。如果未来不可用,fallback 路径:
- 走 OpenAI image-edit(`src/lib/ai/openai.ts` 已有)
- 走 Lingting wellapi.ai(现有路径,加 enable flag)

### 8.4 atelier 模式无 cart/order

atelier 的 cart 是 Zustand + localStorage,**无服务端订单**。ToB 代理商 demo 流还可能用 customOrder 表(内部审计),但 ToC 客户下单通道需后续补支付。

### 8.5 文档一致性

- `architecture-medusa-integration.md` 标记 DEPRECATED,顶部加 warning banner
- CLAUDE.md 「画布模块」段不变(画布是 infinite-canvas 迁移,与电商集成无关)
- `architecture-miniprogram-as-client.md` 主体保留(项目身份定位不变)

---

## 九、Verification

### 自动化
1. `pnpm typecheck` 全绿
2. `pnpm check` Biome 无新增报错
3. `pnpm tsx scripts/archive-medusa-templates.ts` 成功归档
4. drizzle migration 幂等:apply-all-missing-migrations.ts 加 0044 ~ 0048
5. 单测:`src/test/ai-transform.test.ts` + `src/test/pricing-calculate.test.ts`(从 atelier 测试移植)

### 端到端(dev)
1. `pnpm dev`,浏览器 `http://localhost:3000/api/pricing/calculate`(POST 一个合法 spec)→ 期望返正确价格分解
2. 上传一张 jpg 到 `/api/public/upload` 拿 R2 URL,调 `/api/ai/transform { image: <R2 url>, styleId: "ai_qversion" }`(BA Cookie)→ 期望返 R2 previewUrl + credit 被扣
3. 调 5 次同请求 → 期望 creditsBalance 减少 5×8 cents 对应积分
4. z-ai key 故意设错 → 期望 500 `{ canRetry: true, latencyMs }`
5. 输入 13MB+ jpg → 期望 400 `Image too large`
6. 已知 promptTemplate ID 调 GET `/api/prompt-templates` → 期望返 NotFound(已删除)
7. 调 `/api/webhooks/medusa/order-placed` → 期望 404(已删除)

---

## 十、文档历史

| 日期 | 变更 |
|---|---|
| 2026-09-17 | 初版,基于 `D:\下载\atelier-source` 模板全面重构,废弃 Medusa 路线 |

**替代文档**:`architecture-medusa-integration.md`(2026-09-17 草稿,未实施)