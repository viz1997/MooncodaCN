# Medusa Commerce 集成指南(小程序侧)

> ⚠️ **本文档优先级高于其他任何 commerce 相关代码/文档**。

## TL;DR

- **本仓库 NextDevTpl 不做 commerce**(商品 / SKU / 购物车 / 订单 / 支付 / 库存 / 收货地址 —— 100% 归 Medusa)
- **真 commerce 后端是独立部署的 Medusa v2**(`MEDUSA_BASE_URL`,与 NextDevTpl 域名不同)
- **小程序不要调用 NextDevTpl 的 `/api/store/**` 路由**(那是给根 `/` 站点用的临时 mock,只在 mock 阶段有意义)
- **小程序 commerce 集成 = 直接用 Medusa 官方 SDK** `@medusajs/medusa-js`

## 三方分工(2026-09-17 拍板)

| 系统 | 职责 | 给小程序暴露什么 |
|---|---|---|
| **NextDevTpl**(本仓库) | AI 生图 SaaS 后端:user / credits / photo / imageJob / AI 路由 / WeChat 登录 | 本 SDK 覆盖的 7 类 endpoint |
| **Medusa**(独立 server) | product/market + 订单管理 + 支付管理 | Medusa Store API(`/store/*`) + 官方 `medusa-js` SDK |
| **微信小程序**(本 SDK) | 调用 NextDevTpl 拿 AI 候选图;调用 Medusa 浏览商品 + 下单 + 支付 | Taro 4 + React 18 |

## Medusa 集成步骤

### 1. 装官方 SDK

```bash
pnpm add @medusajs/medusa-js
```

### 2. 初始化(在小程序入口)

```ts
// src/api/medusa.ts
import Medusa from "@medusajs/medusa-js";

export const medusa = new Medusa({
  baseUrl: process.env.TARO_APP_MEDUSA_BASE_URL ?? "https://medusa.mooncoda.com",
  publishableApiKey: process.env.TARO_APP_MEDUSA_PUBLISHABLE_KEY!,
  // maxRetries: 3,
  // customHeaders: { "x-source": "miniprogram" },
});
```

`publishableApiKey` 由 NextDevTpl 运维在 Medusa admin 控制台创建,**只读、非机密、可放前端**。
`baseUrl` 与 NextDevTpl 的 `api.mooncoda.com` 是不同子域。

### 3. 关键端点(参考)

| 小程序需求 | Medusa Store API | medusa-js 调用 |
|---|---|---|
| 列出商品 | `GET /store/products` | `medusa.products.list({ type_id })` |
| 单个商品 + variant | `GET /store/products/{id}` | `medusa.products.retrieve(id)` |
| 列出 variant(SKU / 价格) | `GET /store/products/{id}` | `product.variants` |
| 创建购物车 | `POST /store/carts` | `medusa.carts.create({ region_id })` |
| 加 line item | `POST /store/carts/{id}/line-items` | `medusa.carts.lineItems.create(cartId, { variant_id, quantity, metadata })` |
| 更新数量 | `POST /store/carts/{id}/line-items/{line_id}` | `medusa.carts.lineItems.update(cartId, lineId, { quantity })` |
| 删除 line | `DELETE /store/carts/{id}/line-items/{line_id}` | `medusa.carts.lineItems.delete(cartId, lineId)` |
| 收件地址 | `POST /store/carts/{id}` + `address` | `medusa.carts.update(cartId, { shipping_address })` |
| 选择支付方式 | `POST /store/payment-collections/{id}/payment-sessions` | `medusa.carts.createPaymentSessions(cartId)` |
| 完成下单 | `POST /store/carts/{id}/complete` | `medusa.carts.complete(cartId)` |
| 查询订单 | `GET /store/orders/{id}` | `medusa.orders.retrieve(id)` |

### 4. line item metadata 桥接 AI 候选图

小程序调用 `medusa.carts.lineItems.create()` 时,需要在 `metadata` 里把 NextDevTpl 生图结果带过去,这样 Medusa 订单详情页就能显示候选图。

```ts
import { medusa } from "@/api/medusa";
import { submitGenerate, pollImageTask } from "@/api/sdk";

// 1. 走 NextDevTpl 生图(本 SDK)
const { url } = await publicUpload(file);
const { taskId } = await submitGenerate({ maskId, imageUrls: [url] });

// 2. 轮询直到完成
let candidates: string[] = [];
for (let i = 0; i < 10; i++) {
  const status = await pollImageTask(taskId);
  if (status.status === "completed") {
    candidates = status.candidates;
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}

// 3. 选一张
const chosenCandidate = candidates[0];

// 4. 加到 Medusa cart,metadata 把 AI 链路信息带过去
const { cart } = await medusa.carts.create({ region_id: "reg_cn" });
await medusa.carts.lineItems.create(cart.id, {
  variant_id: "variant_R_6_leather", // 来自 medusa.products.retrieve()
  quantity: 1,
  metadata: {
    // NextDevTpl 链路元数据 —— Medusa admin / 订单详情页可见
    nextdevtpl_task_id: taskId,
    nextdevtpl_render_task_id: taskId,
    nextdevtpl_candidate_url: chosenCandidate,
    nextdevtpl_all_candidates: candidates,
    nextdevtpl_user_id: user.id, // 关联回 BA user
  },
});
```

### 5. 跨系统用户标识(V1 Guest Cart 模式)

V1 阶段(文档 `architecture-medusa-integration.md` § 4.2):

- 小程序用户登录 NextDevTpl 拿到 `user.id`
- 浏览 Medusa 商品 + 加购物车 = **匿名 guest cart**(无需登录 Medusa)
- Medusa 订单的 `customer.email` = 用户在 checkout 填的邮箱
- `order.placed` webhook 入站 NextDevTpl → 按 email 匹配 BA user → 写 `promptOrder.medusaOrderId`
- 小程序凭 `medusa_order_id` 反查订单详情

V2 阶段(Better Auth 桥接):

- 装 `@nualt/medusa-plugin-better-auth` 到 Medusa 端
- 小程序已登录状态调 `POST /auth/customer/better-auth { token: BA session token }`
- Medusa lazy 创建 Customer + 颁发 Medusa JWT
- 后续 `medusa.customers.me()` 拿订单列表

## 在小程序代码中的边界

```ts
// ✅ 正确:commerce 走 medusa-js
import { medusa } from "@/api/medusa";
await medusa.products.list();

// ❌ 错误:commerce 不应调 NextDevTpl 的 /api/store/**
import { listProducts } from "@/api/sdk"; // 已从 SDK 删除
```

## 鉴权速查

| 来源 | Header |
|---|---|
| **NextDevTpl**(本 SDK) | `Authorization: Bearer <ba_session_token>` 或免登录 |
| **Medusa Store API**(medusa-js) | `x-publishable-api-key: pk_xxx`(medusa-js 自动加) |
| **Medusa Customer 私有 API**(V2) | `Authorization: Bearer <medusa_jwt>`(medusa-js 自动加) |

## 数据归属边界(单一权威原则)

| 数据 | 谁是单一权威 | 小程序读 |
|---|---|---|
| 用户身份 / openid / BA session | **NextDevTpl** | SDK `loginWithWechat` |
| 积分余额 / 流水 | **NextDevTpl** | SDK 未来 `credits.ts` |
| AI 候选图 / 生成任务 | **NextDevTpl** | SDK `image-gen.ts` |
| 商品 SKU / variant / 价格 | **Medusa** | `medusa.products.retrieve()` |
| 购物车 / 订单 / 支付 | **Medusa** | `medusa.carts.*` + `medusa.orders.*` |
| 收货地址 | **Medusa Customer** | `medusa.customers.me()` (V2) 或 cart-level |

## 关键边界 —— 不要混

| 业务能力 | 走 NextDevTpl | 走 Medusa |
|---|---|---|
| 用户登录 | ✅ BA session | ❌ Medusa auth provider 单独登录 |
| 积分 | ✅ | ❌ Medusa 不参与积分 |
| 商品列表 / 详情 / SKU | ❌(只渲染 maskId 对应产品线) | ✅ |
| 加购物车 | ❌ | ✅ |
| 完成支付 | ❌ | ✅ Medusa payment provider |
| AI 生图 | ✅ | ❌ |
| 6 步订单预览流(`/p/[token]`) | ✅ 内部 promptOrder + previewShare | ❌ |
| 订单详情(下单后) | ❌ | ✅ Medusa order |
| 订单追溯回 NextDevTpl | webhook 入站匹配 email | ❌ Medusa 不感知 NextDevTpl |

## 何时本指南会更新

- Medusa 接入真生产(不再 mock)后,本指南顶部「TL;DR」会标版本日期
- V2 Better Auth 桥接插件落地后,新增「桥接 token」章节
- WeChat 支付在 Medusa 端落地后,新增「JSAPI 接入」章节

## 相关链接

- Medusa Store API 文档:https://docs.medusajs.com/api/store
- `@medusajs/medusa-js`:https://docs.medusajs.com/resources/js-sdk
- NextDevTpl 三方分工:仓库根 `architecture-medusa-integration.md` § 〇
- 小程序身份定位:仓库根 `architecture-miniprogram-as-client.md`