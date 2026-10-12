# NextDevTpl × Medusa · 集成架构说明

> **Mooncoda · 小梦定制馆**
> 状态:方案稿 · 2026-09-17 初版
> 目标读者:技术负责人 / 后端 / 前端 / DevOps
> 前置阅读:[architecture-miniprogram-as-client.md](./architecture-miniprogram-as-client.md)（项目身份定位）

---

## 〇、本文档范围

[architecture-miniprogram-as-client.md](./architecture-miniprogram-as-client.md) 已确定 NextDevTpl = **AI 生图 API 后端**,Medusa = 未来的电商 storefront 后端,二者通过 user 表与 API 共享账号。**2026-09-17 用户拍板最终三方分工**:

| 系统 | 职责范围 |
|---|---|
| **NextDevTpl** | AI 生图 SaaS 后端。user / credits / photo / imageJob / AI 路由 / WeChat 小程序登录。BFF 单体,Next.js 16 + Drizzle + PostgreSQL。 |
| **Medusa** | **product/market** + **订单管理** + **支付管理**(商品 / 购物车 / 订单 / 支付 / 库存 / 客户地址)。独立 server(Medusa v2 + Node + PostgreSQL + Redis)。 |
| **微信小程序 / 浏览器访客** | 调用 NextDevTpl AI 接口拿候选图;调用 Medusa Store API 浏览商品 + 下单 + 支付。**商品 / 订单全部走 Medusa**。 |

**NextDevTpl 不再做**:商品列表 / SKU / 购物车 / 结算 / 库存 / 收货地址 / 订单实体。这些 100% 归 Medusa。

**NextDevTpl 仍做**:`/marketing/*` 静态品牌页(博客 / 文档 / 法律页 / 价格页)+ `/marketing/products` **作品集 showcase**(只展示真实客户案例,纯静态,**不是商品列表**,外链到 Medusa storefront)。

本文档回答**怎么接**:

1. 双方各自持有哪些数据?(数据归属边界)
2. 商品/规格怎么在两端对齐?(`productTypeCode` ↔ `Product.type.value`)
3. 用户怎么认成同一个人?(身份映射策略)
4. 候选图生成→下单的全链路时序如何走?(从选商品到 Medusa 完成支付)
5. 需要新加哪些 API?需要新加哪些 webhook?(具体接口清单)
6. 怎么分阶段落地?(从 V1 到 V3)

---

## 一、整体架构图

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ 微信小程序       │    │ Web Dashboard   │    │ Medusa 电商     │
│ (Taro)         │    │ (NextDevTpl     │    │ Storefront     │
│                │    │  /dashboard/*)  │    │ (Next.js Medusa)│
└────────┬───────┘    └────────┬────────┘    └────────┬───────┘
         │                     │                      │
         │ Bearer             │ Cookie                │ x-publishable-key
         │ (BA session token) │ (BA session cookie)   │ + optional Medusa JWT
         ▼                     ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                     NextDevTpl · BFF (Next.js API)                │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 认证层 (Better Auth + phoneNumber + WeChat plugin)       │    │
│  │ • user.id = 唯一用户标识                                    │    │
│  │ • user.medusaCustomerId = Medusa Customer 反向指针           │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ AI 渲染域 (生图 / 候选 / 选图)                              │    │
│  │ • promptTemplate.productTypeCode ↔ Medusa Product.type    │    │
│  │ • promptTemplatePrice 按规格加价 (积分制,与 Medusa 价脱钩)   │    │
│  │ • photo / imageJob / canvasRemoteJob                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 业务订单域 (promptOrder — 仅代理商 ToB 留作内部审计)         │    │
│  │ • Medusa 模式下 Web ToC / 小程序 ToC 都走 Medusa 订单        │    │
│  │ • promptOrder 在 Medusa 集成后只服务于代理商 ToB demo 流      │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 积分账本                                                      │    │
│  │ • creditsBalance / creditsBatch (FIFO) / creditsTransaction│    │
│  │ • 跟 Medusa 价格无关 — 渲染积分是 SaaS 工具定价               │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────┬──────────────────────────────────┬─────────────────────┘
           │ HTTPS + Bearer (MEDUSA_ADMIN_TOKEN)
           │ 服务端调用 admin API              │
           ▼                                  │
┌──────────────────────────┐                   │
│ Medusa v2                │  ◀────────────────┘
│  • Product / Variant     │  POST /api/webhooks/medusa/order-placed
│  • PriceSet (CNY)        │  HMAC-SHA256 签名
│  • Cart / Order / Payment│  ──────────────────────────┐
│  • Customer (lazy)       │                            │
└──────────────────────────┘                            ▼
                                          ┌──────────────────────────┐
                                          │ promptOrder.medusaOrderId│
                                          │ (订单关联回写)             │
                                          └──────────────────────────┘
```

---

## 二、数据归属边界(单一权威原则)

| 数据 | 单一权威 | NextDevTpl 角色 | Medusa 角色 |
|---|---|---|---|
| **用户身份** (user / customer) | **NextDevTpl** | Better Auth 持有凭证(邮箱/手机/微信 openid)、`user.medusaCustomerId` 写 Medusa customer_id |
| **产品目录** (商品/规格/价格) | **Medusa** | `promptTemplate.productTypeCode` 字典对齐 Medusa `Product.type.value`;价格不复制 | 唯一来源 |
| **AI 渲染模板** | **NextDevTpl** | `promptTemplate` / `promptTemplatePrice` / `productLine` | 不持有 |
| **AI 渲染结果** (候选图 R2 URLs) | **NextDevTpl** | `imageJob.resultUrls` / `photo.fileUrl` / `promptOrder.candidates`;`order.metadata.candidates` 镜像到 Medusa line_item | 仅镜像引用 |
| **订单 / 支付 / 物流** | **Medusa** | `promptOrder.medusaOrderId` 字段记录关联;`/api/webhooks/medusa/order-placed` 接收入站事件 | 唯一来源 |
| **积分账本** | **NextDevTpl** | `creditsBalance` / `creditsTransaction` / `creditsBatch`;与 Medusa 价格脱钩 | 不持有 |
| **收货地址** | **Medusa** | 不持有 | `CustomerAddress` 表 |
| **作品集 / showcase** | NextDevTpl `/marketing/products/*` | 品牌橱窗静态页,外链到 Medusa storefront | 不持有 |

**关键边界**:Medusa 端的 `Product` 价格 ≠ NextDevTpl 端的「生图 SaaS 定价」。前者是成品零售价(¥19/件),后者是渲染服务费(积分制)。两者在订单上独立结算 —— 客户支付成品费给 Medusa,积分账本在 NextDevTpl 内部扣减。

---

## 三、productTypeCode ↔ Medusa Product.type 对齐矩阵

### 3.1 字段对齐

| NextDevTpl 字段 | 含义 | 对应 Medusa 字段 | Medusa 落地方式 |
|---|---|---|---|
| `promptTemplate.productTypeCode` | 6 个产品型号 code | `Product.type_id` → `ProductType.value` | Medusa 自动创建 ProductType 行(`POST /admin/products { "type": { "value": "R" } }`) |
| `promptTemplate.allowedSizes` | 模板允许尺寸子集 | `ProductOption.title = "Size"` + `ProductVariant.options.Size` | 通过 ProductOption 全局定义,每个 Product 只取子集 |
| `promptTemplate.allowedAccessories` | 模板允许配件子集 | `ProductOption.title = "Accessory"` + `ProductVariant.options.Accessory` | 同上,RM 用 `"n/a"` 占位 |
| 6 个 code 各自的 `sizes` / `accessories` 全集 | 字典默认 | Product 级 option values 全集 | 创建 Product 时一次性 POST options 数组 |
| SKU | 业务标识 | `ProductVariant.sku` | `CODE-SIZE-ACCESSORY` 格式(如 `R-6-LEATHER`) |
| 成品零售价 | 商品价格 | `PriceSet → Price { currency_code: "cny", amount }` | 单 region(中国)单币种 |

### 3.2 6 个 productTypeCode 全量字典

来自 `src/features/gpt-image/lib/product-catalog.ts`,Medusa 侧 `Product.type.value` 必须按这个字典定义:

| code | 名称 | 单位 | sizes(cm) | accessories | capabilities | Medusa variant 数 |
|---|---|---|---|---|---|---|
| **R** | CM 钥匙扣 | cm | 4/5/6/8 | leather / pvc | 刻字/颜色/外露/PVC/备注/平台 | 4×2 = **8** |
| **A** | CM 异形钥匙扣 | cm | 4/5/6/8 | leather / pvc / bracket | 刻字/颜色/外露/PVC/备注/平台 | 4×3 = **21** |
| **P** | CM 冰箱贴 | cm | 4/5/6/8 | magnet | 无任何定制能力 | 4×1 = **4** |
| **RM** | CM 相框 | cm | 6/8/11 | n/a | 仅刻字 | 3×1 = **3** |
| **LB** | CM 皮革徽章 | cm | 4/6 | leather / metal | 全能力(含平台) | 2×2 = **4** |
| **M** | CM 手办 | cm | 4/5/6/8/10/12/15/18 | stand | 仅平台 | 8×1 = **8** |
| **总计** | | | | | | **~48 个 variant** |

> 注:实际变体数 = Σ(sizes.length × accessories.length),其中 `accessories.length` 含 `"n/a"`(RM 自身一个值)。

### 3.3 promptTemplate.productTypeCode 是「软约束」,不是「硬 FK」

- NextDevTpl 端运行时校验 `productTypeCode` 必须在 `PRODUCT_TYPES` 字典里(`getProductType(code)`)。
- 不加数据库 FK(`text` 列),允许 admin 临时创建「未绑字典」的模板(老模板兼容)。
- Medusa 端 `Product.type.value` 自动创建 ProductType,**字典不一致时会留下孤儿 ProductType 行** —— admin 工具需定期对账。

### 3.4 RM(相框)配件 = `"n/a"` 的设计决策

- RM 字典 `accessories: []`,理论上没有配件选项。
- 但 Medusa variant 要求全局 `ProductOption("Accessory")` 在所有 Product 上存在(否则 storefront 渲染逻辑要分支)。
- **决策**:RM Product 的 `Accessory` option 只提供一个值 `"n/a"`,前端过滤掉显示。
- SKU 格式:`RM-6-NA`、`RM-8-NA`、`RM-11-NA`。
- 替代方案是省略 option(Medusa 允许 Product 间 option 稀疏),但保持统一 schema 更利于 storefront 渲染。

---

## 四、身份映射策略

### 4.1 三种候选模式(评估结论)

| 模式 | 描述 | 否决原因 |
|---|---|---|
| **A** Medusa 持凭证,NextDevTpl 转发 | Medusa 内置 emailpass 唯一,微信 OAuth Medusa 无 provider | 失去微信登录能力 |
| **B** 懒创建 (Guest cart + email match) | 客户浏览不注册,checkout 时按 email 匹配 BA user | 不需 webhook,但订单关联只能事后 email 回查;无法用 Medusa session 鉴权 |
| **C** Hybrid + Better Auth 桥接插件 | BA 是 IdP,Medusa 通过自定义 auth provider(`@nualt/medusa-plugin-better-auth`)接受 BA session token,自动 lazy 创建 Medusa Customer + 颁发 Medusa JWT | 需 Medusa 端装插件;跨域 cookie 需共享 eTLD+1 |

### 4.2 推荐路径(分阶段)

#### V1(立即可做) — 模式 B(纯 Guest Cart)

- **客户旅程**:浏览 Medusa 商品(无需登录)→ 加入购物车(guest cart)→ 结账填邮箱 → Medusa 收集 shipping address → 调支付 → 完成订单 → 触发 `order.placed` webhook → NextDevTpl 按 email 匹配 BA user(若存在),写 `promptOrder.medusaOrderId`
- **优点**:零 Medusa 端代码改动(除 webhook subscriber);Web / 小程序客户端零感知
- **缺点**:客户无法在 storefront 看到「我的订单」(因为没注册 Medusa customer)
- **使用场景**:**Web ToC 一次性购买 / 小程序客户一次性下单** —— 当前 NextDevTpl 主要场景

#### V2(中期) — 模式 C 桥接 + Guest Cart 兜底

- 在 Medusa 端装 `@nualt/medusa-plugin-better-auth`,注册 `id: "better-auth"` 的 auth provider。
- Storefront 在用户已登录(BA session)时调 `POST /auth/customer/better-auth { token: <BA session token> }` → Medusa lazy 创建 Customer + 颁发 Medusa JWT(设 `connect.sid` cookie)。
- **优点**:客户能在 storefront 看到「我的订单」「我的地址」;Medusa session 鉴权(批量管理 cart、address、order 所有权)
- **缺点**:跨域 cookie 配置(需 BA + Medusa 共享 eTLD+1,或 Next.js BFF 代理);WeChat 用户需合成占位 email(`{openid}@wechat.wjp.local`)
- **使用场景**:**Web ToC 复购客户 / 小程序长生命周期客户**

### 4.3 两端 customer/user 关联键(无论 V1/V2 都需要)

| 关联方向 | NextDevTpl 端字段 | Medusa 端字段 | 写入时机 |
|---|---|---|---|
| BA user → Medusa customer | `user.medusaCustomerId` (已落位,2026-09-16) | `customer.metadata.better_auth_user_id` | V2 桥接首登时 |
| Medusa order → NextDevTpl promptOrder | `promptOrder.medusaOrderId` (待加) | `order.metadata.ba_user_id` + `order.metadata.prompt_order_token` | `order.placed` webhook 入站 |
| 微信 openid 桥接 | `user.wechatOpenid` (已落位) | `customer.metadata.wechat_openid` | V2 桥接首登时 |

### 4.4 微信用户无 email 的处理

- WeChat 登录的 BA user `email` 是 `${digits}@noreply.mooncoda.com`(phone plugin 的占位策略)。
- V1 guest cart 模式无影响(email 不传给 Medusa)。
- V2 桥接模式下 Medusa Customer 要求 email —— 合成 `{wechat_openid}@wechat.wjp.local` 作为占位(`has_account: true`,`metadata.wechat_openid` 标记真实身份)。

---

## 五、调用时序图(从选商品到 Medusa 完成支付)

### 5.1 V1 流程(Guest Cart,零 Medusa 鉴权)

```
┌─────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐
│ 用户    │     │ Medusa   │     │ NextDevTpl  │     │ Medusa   │
│ (浏览器) │     │ Store    │     │  API         │     │ Admin    │
└────┬────┘     └────┬─────┘     └──────┬──────┘     └────┬─────┘
     │               │                 │                  │
     │ 1. 浏览商品    │                 │                  │
     │ GET /store/products             │                  │
     │ ─────────────►│                 │                  │
     │ ◄─────────────│                 │                  │
     │               │                 │                  │
     │ 2. 选 variant (R-6-LEATHER)      │                  │
     │               │                 │                  │
     │ 3. 上传参考图到 NextDevTpl R2     │                  │
     │ POST /api/public/upload         │                  │
     │ ───────────────────────────────►│                  │
     │ ◄───────────────────────────────│                  │
     │               │                 │                  │
     │ 4. 提交生成任务                  │                  │
     │ POST /api/public/generate       │                  │
     │ { maskId, imageUrls, size }     │                  │
     │ ───────────────────────────────►│                  │
     │ ◄───────────────────────────────│ taskId            │
     │               │                 │                  │
     │ 5. 轮询结果                      │                  │
     │ GET /api/image/task/[taskId]   │                  │
     │ ───────────────────────────────►│                  │
     │ ◄───────────────────────────────│ status=completed │
     │               │                 │ + candidates[]   │
     │               │                 │                  │
     │ 6. 选候选图                      │                  │
     │ (client-side, R2 URLs 已就位)    │                  │
     │               │                 │                  │
     │ 7. 加 Medusa cart line-item     │                  │
     │ POST /store/carts/{id}/line-items                  │
     │ { variant_id, qty: 1, metadata: {                │
     │     renderTaskId,                               │
     │     chosenCandidateUrl,                         │
     │     allCandidates: [...]                        │
     │   }                                            │
     │ ─────────────►│                 │                  │
     │               │                 │                  │
     │ 8. 填 shipping address + email                  │
     │ POST /store/carts/{id}         │                  │
     │ ─────────────►│                 │                  │
     │               │                 │                  │
     │ 9. 初始化支付 → 完成订单         │                  │
     │ POST /store/carts/{id}/payment-sessions          │
     │ ─────────────►│                 │                  │
     │ POST /store/carts/{id}/complete│                  │
     │ ─────────────►│                 │                  │
     │ ◄─────────────│ order = { id, ... }              │
     │               │                 │                  │
     │               │   10. fire order.placed           │
     │               │ ──────────────────────────────► │
     │               │   subscriber (in-process)        │
     │               │   POST /api/webhooks/medusa/      │
     │               │        order-placed              │
     │               │   {                              │
     │               │     orderId,                    │
     │               │     customerEmail,              │
     │               │     lineItems[metadata]         │
     │               │   }                             │
     │               │   HMAC-SHA256 signature         │
     │               │                 │                  │
     │               │                 │ 11. 校验签名     │
     │               │                 │ 12. 查 BA user  │
     │               │                 │     by email     │
     │               │                 │ 13. UPDATE      │
     │               │                 │     promptOrder │
     │               │                 │     SET         │
     │               │                 │     medusaOrderId│
     │               │                 │ ◄──────────────│
     │               │                 │                  │
     │ ◄─────────────│ 14. order detail page   │                  │
     │               │    (可选,展示生成预览) │                  │
```

**关键点**:
- 步骤 1-6 完全在 NextDevTpl 域内,**Medusa cart 还未存在**(与 Medusa 官方个性化商品 recipe 一致)
- 步骤 7-9 在 Medusa Store API 完成,**Storefront 直接调**(不需要 Medusa session,因为是 guest cart)
- 步骤 10-13 在 Medusa 服务端 subscriber → NextDevTpl webhook handler 完成

### 5.2 V2 流程(Better Auth 桥接,客户已登录)

```
(同 5.1 步骤 1-6,以下从步骤 6.5 开始差异)

     │ 6.5 选候选图后,客户确认下单                   │
     │     用户已登录 BA(微信/邮箱/手机)              │
     │               │                 │                  │
     │ 6.7 桥接到 Medusa session       │                  │
     │ POST /auth/customer/better-auth │                  │
     │ { token: <BA session token> }   │                  │
     │ ─────────────►│                 │                  │
     │               │ → custom auth provider            │
     │               │   1. validate BA session           │
     │               │   2. look up customer by           │
     │               │      metadata.better_auth_user_id  │
     │               │   3. create if missing             │
     │               │   4. issue Medusa JWT              │
     │               │ ◄──────────────                   │
     │ ◄─────────────│ Set-Cookie: connect.sid=xxx       │
     │               │                 │                  │
     │ 7. 创建 cart 时已带 customer_id  │                  │
     │ POST /store/carts               │                  │
     │ { region_id, sales_channel_id } │                  │
     │ Authorization: Bearer <medusa_jwt>               │
     │ ─────────────►│                 │                  │
     │ ◄─────────────│ cart { id, customer_id }          │
     │               │                 │                  │
     │ 8. 加 line-item + 后续步骤同 5.1 │                  │
```

**V2 增量**:客户端多一步桥接调用,但 Medusa session 鉴权让客户能在 storefront 看到「我的订单」「保存的地址」。

---

## 六、API 接口清单(全量对接)

### 6.1 NextDevTpl 暴露给 Medusa Storefront 的新 API

| 方法 | 路径 | 鉴权 | 用途 | 备注 |
|---|---|---|---|---|
| GET | `/api/products/by-code/:code` | 公开 (IP 限流) | 按 productTypeCode 拉商品列表(含 variant + 价格 + SKU + 渲染价) | 返回聚合 Medusa catalog + NextDevTpl metadata |
| POST | `/api/prompt-templates/resolve` | 公开 (IP 限流) | `{ sku }` 或 `{ productTypeCode, sizeCm, accessoryCode }` → `{ promptTemplateId, renderPriceCredits, renderPriceCny, candidateCount, outputMode }` | 反查模板 + 算 SaaS 价 |
| POST | `/api/webhooks/medusa/order-placed` | HMAC-SHA256(`X-Medusa-Signature`) | Medusa subscriber 入站 | 新增 |

> **复用现有 API**(Bearer 支持待 Phase R 落地):
> - `/api/auth/wechat-phone-login`(小程序登录返 token)
> - `/api/public/upload`(R2 presigned,无 Bearer 需求)
> - `/api/public/generate` POST/GET(模板 + 生图,无 Bearer 需求)
> - `/api/image/task/[id]`(轮询状态,无 Bearer 需求)
> - `/api/image-gen/thumbnail` + `/api/image-gen/download`(跨域代理,无 Bearer 需求)

### 6.2 NextDevTpl → Medusa Admin API 的调用(服务端)

| 用途 | 端点 | 调用时机 | Auth |
|---|---|---|---|
| 列商品 + variant | `GET /admin/products?type_id=ptyp_xxx` | Storefront 首次访问,缓存 5 min | `Bearer MEDUSA_ADMIN_TOKEN` |
| 查单个 variant | `GET /admin/products/{id}` | `/api/products/by-code/:code` 命中缓存未命中时 | 同上 |
| 同步 catalog | `GET /admin/products?limit=100&offset=...` | V2 增量:定时任务每 N 分钟拉一次 | 同上 |
| 反查 customer by metadata | `POST /admin/customers/filter { metadata: { better_auth_user_id } }` | V2 桥接首登,确认 customer 是否已创建 | 同上 |
| 创建 customer(桥接失败兜底) | `POST /admin/customers` | V2 桥接失败 fallback | 同上 |

> **不建议**的调用:`POST /admin/orders`、`POST /admin/draft-orders` —— NextDevTpl 不应替 Medusa 创单。订单由 Storefront 直接走 `POST /store/carts/{id}/complete`。

### 6.3 Medusa → NextDevTpl Webhook 清单

| 事件 | 用途 | NextDevTpl handler 动作 | 优先级 |
|---|---|---|---|
| `order.placed` | 订单已完成支付 | 按 `customer.email` 匹配 BA user → 写 `promptOrder.medusaOrderId` | **P0 必须** |
| `order.fulfillment_created` | 订单已发货 | 触发 WeChat push / 邮件通知;更新 `promptOrder.status = SHIPPED` | P1 |
| `order.canceled` | 订单已退款 | 退积分(若已扣);更新 `promptOrder.status = CANCELLED` | P1 |
| `customer.created` | Medusa customer 已建(桥接模式) | 写 `user.medusaCustomerId` 反向指针 | P2(V2 模式才需要) |

> Medusa v2 不内置 HMAC-signed 外部 webhook,需在 Medusa 端写 `src/subscribers/` 子目录处理 OR 装 `medusa-events-webhooks` 插件。

---

## 七、变更清单(分阶段)

### Phase A(地基,2026-09 中下旬)

**目标**:让 Medusa Storefront 能识别 NextDevTpl 模板,无认证无实际订单。

**新增**:
- `src/app/api/products/by-code/[code]/route.ts` —— 调 `GET /admin/products?type_id=...` 聚合返回
- `src/app/api/prompt-templates/resolve/route.ts` —— SKU 反查
- `src/features/medusa/` — Medusa admin client(封装 fetch + admin token)
  - `client.ts` —— `medusaAdminFetch(path, init)`
  - `catalog.ts` —— `getProductsByTypeCode(code)`,`getVariantBySku(sku)`
  - `pricing.ts` —— 价格格式化辅助

**修改**:
- `.env.example` —— 加 `MEDUSA_ADMIN_TOKEN` + `MEDUSA_BASE_URL` + `MEDUSA_WEBHOOK_SECRET` + `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`
- `src/proxy.ts` —— 放行 `/api/products/by-code/**` 与 `/api/prompt-templates/resolve` 为公开路径(已 IP 限流)

### Phase B(订单闭环,2026-09 下 ~ 2026-10 上)

**目标**:Medusa Storefront 能完成下单,NextDevTpl 能收到 `order.placed` 回调。

**新增**:
- `drizzle/0043_medusa_order_link.sql` —— 给 `prompt_order` 加列:
  ```sql
  ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "medusa_order_id" text;
  ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "medusa_order_no" text;
  CREATE INDEX IF NOT EXISTS "prompt_order_medusa_order_id_idx" ON "prompt_order" ("medusa_order_id");
  ```
- `src/db/schema.ts` —— promptOrder 表加 2 列
- `src/app/api/webhooks/medusa/order-placed/route.ts` —— HMAC 校验 + email → BA user 匹配 + UPDATE promptOrder
- `src/lib/medusa/hmac.ts` —— `verifyMedusaSignature(rawBody, headerSig, secret)` 用 `crypto.timingSafeEqual`
- `scripts/apply-all-missing-migrations.ts` —— statements 数组加 0043

**修改**:
- `src/features/gpt-image/orders/services/order-actions.ts` —— V2 Medusa 模式下不再创建 promptOrder(交给 Medusa cart line-item metadata);保留 ToB demo 流

### Phase C(Bearer 透明化 + V2 桥接预留,2026-10)

**目标**:Web + 小程序 + Medusa storefront 都能用 Bearer 调 NextDevTpl 鉴权 API。

**对应 Phase R**:
- 把 `getBearerSession` + `extractBearerToken` 接入所有 `auth.api.getSession({ headers })` 路由
- 加 `getSessionFromRequest(request)` helper 统一封装 Cookie-or-Bearer

**V2 桥接预留**:
- `src/features/medusa/bridge/` 目录预留,放桥接 client 草稿(不在 V1 落地)

### Phase D(桥接插件 V1,V2 完整期)

**目标**:Web ToC 复购客户能在 storefront 看「我的订单」。

**需新增**:
- Medusa 端装 `@nualt/medusa-plugin-better-auth`,注册 `id: "better-auth"` 的 auth provider
- Next.js BFF 新增 `/api/medusa/bridge-token` —— 把 BA session token 包成 Medusa 桥接请求
- Medusa 端 `src/subscribers/customer-created.ts` —— 写 BA user.medusaCustomerId
- 给 `customer` 表加 GIN index:`CREATE INDEX customer_metadata_gin ON customer USING gin (metadata jsonb_path_ops);`

---

## 八、风险点 + 边界

### 8.1 数据一致性

- **订单同步失败重试**:Medusa subscriber POST webhook 失败需 Next.js 端返 5xx 触发 Medusa 内部 retry;Next.js 端需幂等键(`processed_webhooks (event_id, order_id, event_type) PK`)
- **库存预扣 vs AI 渲染时延**:Storefront 在 step 7 才加 line-item,意味着渲染完成前库存未扣;若渲染耗时 30s+ 而高并发抢库存,可能出现超卖 —— **暂不处理**(WJP ToC 现货生产,小规模可控)
- **价格漂移**:`promptTemplatePrice` 是 NextDevTpl 内部 SaaS 价,与 Medusa 成品价独立;若 admin 改 Medusa variant 价不影响 NextDevTpl 积分账本(仅影响 Medusa cart 总额)

### 8.2 鉴权边界

- **MEDUSA_ADMIN_TOKEN 是高度机密**:严禁进前端代码 / browser;只放在 NextDevTpl 服务端 env
- **`x-publishable-api-key` 非机密**:可放 `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`(浏览器可见)
- **HMAC 共享 secret**:`MEDUSA_WEBHOOK_SECRET` 服务端 env,Medusa subscriber + NextDevTpl webhook handler 共用

### 8.3 catalog 对账

- Medusa 端若 admin 手工改 `Product.type.value`(从 R 改成 RB),会导致 NextDevTpl 字典查不到 → `/api/prompt-templates/resolve` 返 400
- 建议 Medusa 端给 `ProductType.value` 加数据库 CHECK 约束 `CHECK (value IN ('R','A','P','RM','LB','M'))`,或写脚本定期对账
- 对账脚本:`scripts/sync-medusa-product-types.ts` —— 拉 Medusa ProductType 列表,检查 value 是否在 `PRODUCT_TYPES` 字典里

### 8.4 WeChat 占位 email

- Medusa Customer.email 字段要求非空,WeChat 用户合成 `{openid}@wechat.wjp.local` 后 Medusa 不会主动发邮件(域不存在),但 dashboard 显示会很丑
- 替代方案:在 NextDevTpl 端弹窗让 WeChat 用户补真实邮箱(走现有 email 验证流),再 update Medusa customer.email
- **V1 不处理**,V2 桥接模式遇到真实下单客户时再补

---

## 九、Verification(端到端验证)

### 自动化
1. `pnpm typecheck` —— 全绿
2. `pnpm check` —— Biome 无新增报错
4. `pnpm tsx scripts/apply-all-missing-migrations.ts` —— 0043 增量幂等
5. 单元测试 `src/test/medusa/hmac.test.ts` —— HMAC 签名/校验正反案例
6. 单元测试 `src/test/medusa/catalog.test.ts` —— SKU 反查 / productTypeCode 字典校验

### 手工 dev 验证(V1 流程)
**前置**:`.env.local` 加 `MEDUSA_ADMIN_TOKEN` + `MEDUSA_BASE_URL=http://localhost:9000` + `MEDUSA_WEBHOOK_SECRET=test-secret`
1. 在 Medusa admin 创建 region(China / cny)+ publishable key + 6 个 Product(R/A/P/RM/LB/M) + ~48 个 variant
2. `pnpm dev`,浏览器 `http://localhost:3000/api/products/by-code/R` —— 验证返 Medusa variant + SKU + 价格
3. `curl -X POST http://localhost:3000/api/prompt-templates/resolve -d '{"sku":"R-6-LEATHER"}' -H 'Content-Type: application/json'` —— 验证返 `promptTemplateId` + 积分价
4. 用 Medusa Storefront(或临时 Medusa JS SDK 脚本)走完整 guest cart 流程 → 下单 → 触发 webhook → 查 DB `SELECT medusa_order_id FROM prompt_order ORDER BY created_at DESC LIMIT 1` 验证已回写
5. 用错的 HMAC 签名 POST `/api/webhooks/medusa/order-placed` —— 期望 401
6. 用对的 HMAC 签名 POST 同 order_id 两次 —— 期望第二次 200 但 DB 不重复写(去重表命中)

### 手工 dev 验证(V2 流程,Phase D)
1. 装 `@nualt/medusa-plugin-better-auth` 到 Medusa 端,配 medusa-config.ts
2. BA 用户登录 Web → 调 `/api/medusa/bridge-token` 拿 Medusa JWT
3. 用 Medusa JWT 调 `GET /store/customers/me` —— 期望返 customer(含 `metadata.better_auth_user_id`)
4. Web storefront 走完整登录用户下单流程 → 验证 cart 转移后 `customer_id` 正确

---

## 十、相关文件索引

**新增(预计)**:
- `src/features/medusa/client.ts`
- `src/features/medusa/catalog.ts`
- `src/features/medusa/pricing.ts`
- `src/features/medusa/hmac.ts`
- `src/features/medusa/types.ts`
- `src/features/medusa/bridge/` (V2 预留)
- `src/app/api/products/by-code/[code]/route.ts`
- `src/app/api/prompt-templates/resolve/route.ts`
- `src/app/api/webhooks/medusa/order-placed/route.ts`
- `src/app/api/medusa/bridge-token/route.ts` (V2)
- `src/test/medusa/hmac.test.ts`
- `src/test/medusa/catalog.test.ts`
- `drizzle/0043_medusa_order_link.sql`
- `scripts/sync-medusa-product-types.ts`
- `scripts/seed-medusa-products.ts`

**修改**:
- `src/db/schema.ts` —— promptOrder 加 2 列
- `scripts/apply-all-missing-migrations.ts` —— 0043 inline SQL
- `src/proxy.ts` —— 放行新公开路径
- `src/features/gpt-image/orders/services/order-actions.ts` —— V2 Medusa 模式分支
- `.env.example` —— 5 个新 env var
- `messages/{en,zh}.json` —— Medusa 集成相关 i18n 键(若 storefront 走 Web)

**外部依赖(Medusa 端,不在本仓库)**:
- `@nualt/medusa-plugin-better-auth` (V2)
- `medusa-events-webhooks` 或自写 subscriber (Phase B)

---

## 十一、未决问题(待用户拍板)

1. **V1 vs V2 启动时机**:V1 guest cart 已可独立上线;V2 桥接需要 Medusa 端搭插件 + 跨域 cookie 配置,工期更长。先上 V1 还是等 V2?
2. **catalog 同步方向**:Medusa 是单一权威(NextDevTpl 只读),还是双向同步(promptTemplate 创建后推送到 Medusa)?当前推荐单向(Medusa → NextDevTpl pull)。
3. **ToB 代理商 demo 流是否走 Medusa**:现有 `/image-gen` 工作台 + 代理商 demo 创建的 promptOrder 在 Medusa 集成后是否全部改走 Medusa cart,还是保留 promptOrder 作为「内部审计视图」+ Medusa order 作为「正式订单」双轨?
4. **storefront 形态**:Medusa 官方 Next.js Storefront 模板直接用,还是基于 Web Dashboard 的 `/marketing/products/*` 改造?后者工程量小但 UI 一致性差。

---

## 文档历史

| 日期 | 变更 |
|---|---|
| 2026-09-17 | 初版,基于 Phase S1 (endpoint audit) + Phase S2 (Medusa data model) + Phase S3 (auth patterns) 三方研究 |