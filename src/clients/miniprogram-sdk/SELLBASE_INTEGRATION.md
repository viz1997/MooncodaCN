# Sellbase 集成指南(小程序侧)

> **状态**:已落地(2026-11-04)
> **取代**:`MEDUSA_INTEGRATION.md`(Medusa 方案,已作废 —— 见 §〇)
> **前置阅读**:仓库根 [`architecture-sellbase-integration.md`](../../../architecture-sellbase-integration.md)(权威架构文档)
> **前置阅读**:仓库根 [`architecture-miniprogram-as-client.md`](../../../architecture-miniprogram-as-client.md)(项目身份定位)

---

## 〇、一句话结论

> **本仓库算价,Sellbase 只做收银台。**

商品目录 / 定价规则 / 购物车 / 订单事实 / 收货地址**全在本仓库**;
Sellbase 只负责「收钱」—— 建一张 Stripe 支付链接,再把收款状态回传回来。

**小程序侧不接 Sellbase 的任何 API,也不装 Medusa SDK。** 商城相关的每一个
请求都打**本仓库的 `/api/store/**`**。Sellbase 的 API base、admin token、
webhook secret,小程序一个都不需要。

Medusa 时代的方案稿保留在仓库根
[`architecture-medusa-integration.md`](../../../architecture-medusa-integration.md),
**结论已作废**,别照着做。

---

## 一、三方分工

| 系统 | 职责 | 给小程序暴露什么 |
|---|---|---|
| **NextDevTpl**(本仓库) | AI 生图 SaaS 后端 + **商品目录** + **定价** + **购物车** + **订单事实** + **收货地址** + 收款编排 | 本文档「接口速查表」里的那些 `/api/**` |
| **Sellbase**(独立服务) | **只做收银台**:Stripe 支付链接 + 收款状态 + 收据 | **不直接暴露给小程序** —— 本仓库代它建单,小程序只拿到一个 `paymentUrl` |
| **微信小程序**(本 SDK) | 调本仓库拿 AI 候选图、拿商品、加购、结算 | Taro 4 + React 18 |

---

## 二、数据归属(单一权威)

| 数据 | 权威在谁 | 小程序怎么读 |
|---|---|---|
| 商品资料 / SKU / 价格 | **本仓库** | `GET /api/image-gen/products` |
| 定价规则(材质 / 尺寸 / AI 风格 / 配件 / 刻字 / 加急 / 数量阶梯) | **本仓库** | `POST /api/store/pricing/calculate` |
| 购物车 | **本仓库**(cookie `wjp_cart_id`) | `/api/store/carts/**` |
| 订单事实 | **本仓库** | `POST /api/store/checkout` → `GET /api/store/orders/[orderNo]` |
| 收货地址 | **本仓库** | 地址簿 server actions(见 §六) |
| 收款状态 | Sellbase → webhook 回写本仓库 | 小程序只读本仓库的 `status` |
| Stripe 支付链接 | Sellbase 生成本仓库存副本 | 结算响应里的 `paymentUrl` |

### 2.1 金额单位一律是「分」

所有 `*Cents` 字段都是**人民币分**,不是元。`2400` = ¥24。展示时自己除以 100。

---

## 三、完整链路(小程序视角)

```
1. 拉商品目录      GET  /api/image-gen/products
2. 选规格(材质/尺寸/风格/配件/刻字/加急)
3. 算价(可跳)     POST /api/store/pricing/calculate      ← 只是给用户看
4. 建购物车        POST /api/store/carts                  ← 下发 cookie
5. 加购            POST /api/store/carts/{id}/line-items
6. 结算(必须登录) POST /api/store/checkout               ← 服务端重算每一行
7. 全页跳 Stripe   paymentUrl                            ← 不能用站内路由
8. 查状态          GET  /api/store/orders/{orderNo}      ← 轮询到 paid
```

第 3 步和第 5 步的关系:**第 3 步算的价只是给用户看的**,第 5 步服务端会按
metadata **重算一遍**,以第 5 步为准(见 §五.2)。

---

## 四、商品目录

### `GET /api/image-gen/products`

走本 SDK 现成的 `listProducts()` / `getProduct()`,**不用改代码**。

```ts
import { listProducts } from "@/api/sdk";

const { products } = await listProducts({ locale: "zh" });
```

**鉴权**:三档 —— dev 模式 / BA session / `x-api-key`,跟 `/api/image-gen/templates`
一致。小程序侧照旧用 `x-api-key`。

**限流**:ai 档 20/min。**缓存**:CDN-friendly(60s max-age),admin 改完价最长
10 分钟对外生效。

**查询参数**:`productTypeCode`(逗号分隔,如 `R,M`)、`locale`(`zh` / `en`)。

**响应**(`ProductListResponse`):

```ts
{
  success: true,
  locale: "zh",
  products: ProductCapability[]   // productTypeCode: R / A / P / RM / LB / M
}
```

`ProductCapability` 里跟价格相关的两块:

| 字段 | 说明 |
|---|---|
| `basePriceCents` | 产品基价。**已 deprecated** —— 别再拿它自己拼价差 |
| `sizes[]` / `accessories[]` / `visualStyles[]` | 规格项,`priceDeltaCents` / `surchargeCents` 是**价差**,不是绝对价 |
| `variants[]` | **真 SKU**:`{ sku, sizeCode, accessoryCode, variantCode, priceCents, isActive }`,`priceCents` 是**绝对价**,可以直接当单价 |

新代码一律走 `variants[]` 匹配 `(sizeCode, accessoryCode, variantCode)` 拿绝对价。
`variants[]` 为空数组(商品没 seed 或全部下架)时,才退回旧的拼价差逻辑。

> 小程序 SDK 1.6.1 的统一出口(`index.ts`)已经导出 `ProductCapability` /
> `ProductListResponse` 等类型,直接 `import type` 就行。`ProductVariantSummary`
> 定义在 `types.ts` 里(统一出口暂未 re-export),要单独用类型就
> `import type { ProductVariantSummary } from "@/api/sdk/types"`。

> ⚠️ **别调 `GET /api/store/products`** —— 那条路由返的是站内硬编码的
> mock 目录(`mock-catalog.ts` 的 `MOCK_PRODUCTS`),给网页端用的,不是商品
> 目录的真理源。真 SKU 只在 `/api/image-gen/products` 的 `variants[]` 里。

---

## 五、商城接口(全部在本仓库)

### 5.1 购物车

购物车**已经落库**(`cart` / `cart_item` 表),靠 cookie **`wjp_cart_id`** 关联。

> ⚠️ **小程序端必须让请求带上这个 cookie。** 服务端下发的是 httpOnly +
> SameSite=Lax + 7 天有效。走 `Taro.request` / `wx.request` 时确认 `enableCookie`
> 是开的(微信基础库 2.10.0+ 默认开,同域 cookie 自动带);走 SDK 的 `sdkRequest`
> (fetch)时,Taro 的 fetch 底层是 `wx.request` 适配层,行为一致 —— 但**要在真机上
> 验一次**:加购之后 `GET /api/store/carts/{id}` 返 404,就是 cookie 没带上。
> 兜底做法:从 `POST /api/store/carts` 的响应头读 `Set-Cookie`,存进 storage,
> 后续请求手工带 `Cookie: wjp_cart_id=…`。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/store/carts` | 创建或取当前购物车(游客也能有车),**顺手把 cookie 下发**。201 |
| `GET` | `/api/store/carts/{id}` | 取购物车(含行)。单价是服务端**重算**过的 |
| `POST` | `/api/store/carts/{id}/line-items` | 加一行。201 |
| `PUT` | `/api/store/carts/{id}/line-items/{lineId}` | 改数量(`quantity` 改成 0 等同删除) |
| `DELETE` | `/api/store/carts/{id}/line-items/{lineId}` | 删一行 |

**加购 body**:

```ts
{
  productId: "R",                       // productTypeCode
  quantity: 1,
  spec: {
    productId: "R",
    productHandle: "…",
    productTitle: "…",
    productThumbnail: "https://…",      // 必须是合法 URL
    materialId: "…",
    sizeId: "…",
    sizeCm: 6,                          // 正整数
    aiStyleId: "ai_original",
    engravingText: "",                  // 最长 30
    rushOrder: false,
    accessoryVariantIds: [],            // 选中的配件变体 id
    previewImage: "https://…",          // 渲染后图(R2 URL)
    originalImage: "https://…",         // 渲染前原图(R2 URL)
  },
}
```

**同规格合并**:完全一样的 spec 加两次**不会**多出一行 —— 数据库上
`(cart_id, spec_hash)` 有唯一索引,数量原子累加(并发也安全)。配件顺序不影响
合并判定。

### 5.1.1 AI 候选图怎么带到购物车

跟旧的 Medusa 方案里「`metadata` 桥接」是同一件事,只是载体换了 —— 现在
**没有 Medusa 的 line item metadata**,改成 `spec` 里的两个字段:

| 字段 | 放什么 |
|---|---|
| `spec.previewImage` | 用户选中的那张**候选图** URL(R2) |
| `spec.originalImage` | 用户上传的**原图** URL(R2) |

```ts
import { listProducts, publicUpload, submitGenerate, pollImageTask } from "@/api/sdk";

// 1. 走本 SDK 生图
const { url } = await publicUpload(file);           // 原图 → R2
const { taskId } = await submitGenerate({ maskId, imageUrls: [url] });

// 2. 轮询到完成
let candidates: string[] = [];
for (let i = 0; i < 10; i++) {
  const status = await pollImageTask(taskId);
  if (status.status === "completed") { candidates = status.candidates; break; }
  await new Promise((r) => setTimeout(r, 3000));
}

// 3. 选一张 → 它的 URL 直接进 spec
const chosen = candidates[0];

await sdkRequest(`/api/store/carts/${cartId}/line-items`, {
  method: "POST",
  json: {
    productId: "R",
    quantity: 1,
    spec: {
      /* …其它规格… */
      previewImage: chosen,        // ← 候选图
      originalImage: url,          // ← 原图
    },
  },
});
```

这两个 URL 会被**固化**到购物车行上,结算时原样落进 `storefront_order_item`
(订单详情页 / 工作室后台看得到的就是这张图)。

「同规格」判断(`spec_hash`)参与的是:`productId` / `materialId` / `sizeId` /
`aiStyleId` / `engravingText` / `rushOrder` / 配件 id(顺序无关)/ **`previewImage`**。
所以换尺寸、换风格、**换候选图**都会算出不同的 hash → 加购出来是**新的一行**,
不是覆盖原来那行。`originalImage` 不参与判断,只影响订单详情页展示。

**购物车行**(`CartLineItem`)上两个价:

- `unitPriceCents` —— 折**前**单价
- `discountedUnitPriceCents` —— 折**后**单价(数量阶梯折扣后的),**这个才是要收的钱**

---

### 5.2 结算

#### `POST /api/store/checkout`

body 只有两个字段 —— **没有 `cartId`,没有金额,没有地址**:

```ts
{
  addressId: "addr_xxx",   // 地址簿里的地址 id
  note: "刻字:小梦",        // 可选,最长 500
}
```

响应:

```ts
{
  orderNo: "SO-20261104-3F7K2A",  // 业务订单号,用户可见
  paymentUrl: "https://…",  // 付款入口(Shopify 收银台);可能是 null,见 §5.4b
  subtotalCents: 4800,   // 折前小计
  discountCents: 200,    // 数量阶梯折扣
  shippingCents: 800,    // 运费(折后满 ¥99 免运费,否则 ¥8)
  totalCents: 5400,      // 合计 = 折后小计 + 运费
  currency: "CNY",
}
```

**⚠️ 关键约束**

**① 结算必须登录。** 未登录直接 401 `AUTH_REQUIRED`。先跳登录页,
`callbackUrl` 带回结算页,登录完再回来结算(购物车还在,cookie 不变)。

> **鉴权口径**:这三条商城路由(结算 / 查订单 / 重取支付链接)**两种凭据都认** ——
> `Authorization: Bearer <token>`(小程序)或者 Better Auth 的**签名 cookie**
> (`better-auth.session_token`,浏览器)。实现见
> `src/lib/auth/request-session.ts` 的 `getSessionFromRequest`。
>
> 带了 Bearer 但 token 无效 → 直接 401,**不**退回 cookie(不然「token 过期」
> 就变成了「换个身份照样能过」)。

**② 金额服务端算,小程序传来的价一律不信。** 购物车里存的单价只是缓存;
结算这一步服务端按每一行的 metadata **重新算一遍**(定价规则改了以后,存量
购物车带着旧价,直接收就是收错了)。小程序算出来的价只配用来显示。

**③ 地址是服务端查的。** body 只传 `addressId`,服务端按当前用户查地址簿,
归属校验写死在数据层 —— 别人的地址查出来就是 404。

**④ 结算的购物车靠 cookie 认。** 服务端从 `wjp_cart_id` 里取 cartId,
不接受客户端指定。没带 cookie → 404 `CART_NOT_FOUND`。

**⑤ 结算**不会**清空购物车**(2026-11-05 改的)。**钱到了才清** —— 没付款
就走的用户,购物车还是原样(早先是在建单那一刻就清掉了,用户反馈「没支付
返回购物车为什么清空了」)。所以小程序侧:

- 结算返回之后,购物车里**还有**那些行 —— **别急着把本地的购物车清掉**
- 同一批货再点一次「去支付」→ 服务端**复用**上一张还没付的订单(同一批货 +
  同一地址 + 同一留言),返回**同一个** `orderNo` 和**同一个**付款入口。
  不会多出一张单,也不会给你两个付款入口
- 钱到了(webhook 回调)之后,买掉的那几行才从购物车里摘掉 —— 付款之后又
  加的别的行**留着**

**结算的错误码**:

| HTTP | `error` | 含义 |
|---|---|---|
| 401 | `AUTH_REQUIRED` | 没登录 → 跳登录页 |
| 400 | `CART_EMPTY` | 购物车是空的 |
| 400 | `INVALID_JSON` / `INVALID_INPUT` | body 不合法 |
| 404 | `CART_NOT_FOUND` | cookie 没带上 / 购物车过期 |
| 503 | `PAYMENT_CHANNEL_UNAVAILABLE` | 指定的支付方式现在不可用(见 §5.4b) |
| 404 | `ADDRESS_NOT_FOUND` | 地址不存在或不属于当前用户 |
| 422 | `PRICING_FAILED` | 某一行的价算不出来(商品下架了之类)→ 让用户删掉那行重下 |
| 503 | `CARRIER_NOT_FOUND` | 工作室没跑目录同步 → 提示联系工作室 |
| 500 | `CHECKOUT_FAILED` | 服务端异常 |

**限流**:10 次/分钟(结算和「重取支付链接」共用这一档)。撞了会返 429,
小程序侧要退避重试,别连续点「去支付」。

---

### 5.3 算价(可选)

#### `POST /api/store/pricing/calculate`

给用户看实时价用。**最终收多少钱以结算为准**,见 §五.2 的 ②。

```ts
{
  productId, productHandle,
  productTypeCode,          // R / A / P / RM / LB / M
  materialId, sizeId, aiStyleId,
  engravingText,            // 最长 30
  rushOrder,
  accessoryVariantIds: [],
  quantity,                 // 1-100
  previewImageUrl,          // 合法 URL
  originalImageUrl,         // 合法 URL
}
```

响应 `{ pricing: PricingResult }`:

```ts
{
  unitPriceCents,            // 折前单价
  discountedUnitPriceCents,  // 折后单价
  totalPriceCents,           // discountedUnitPriceCents × quantity
  breakdown: {
    baseCents, materialCents, sizeCents, aiStyleCents,
    accessoryCents, engravingFeeCents, rushOrderCents,
    quantityTierDiscountCents,
  },
  estimatedShipDays,
  calculatedAt,
}
```

---

### 5.4 支付:全页跳 Stripe

`paymentUrl` 是 **Stripe 的支付链接**(HTTPS 外链)。小程序端要做的是
**全页跳转**,**不能用** `wx.navigateTo` / `Taro.navigateTo` 之类的站内路由
API —— 那是打开小程序内页面的,打不开外链。

落地方式:用小程序 `web-view` 组件加载该 URL(需要在微信公众平台把 Stripe 的
域名配成**业务域名**)。支付完成后 Stripe 会回跳本仓库的
`/checkout/success?order=<orderNo>`,那个页面自己轮询订单状态。

> 小程序侧如果自己接管回跳逻辑,拿到 `orderNo` 后轮询
> `GET /api/store/orders/{orderNo}`,`status` 变成 `paid` 就算付完了 ——
> **别在跳转前就假定支付成功**(Stripe 确认 → Sellbase 发事件 → webhook 到
> 本仓库,中间有几秒延迟)。

#### ⚠️ `paymentUrl` 可能是 `null`

Sellbase 那边挂了(网络 / 配置 / Stripe 没连上)时,**订单照样建好了**,状态停在
`unpaid`,只是 `paymentUrl` 是 `null`。

**这不是下单失败。** 小程序侧要提示:

> 「订单已创建,支付链接生成失败。请到「我的订单」里重新获取支付链接。」

同时把 `orderNo` 显示出来让用户留着。**不要**弹「下单失败,请重试」——
订单真的建好了,再点一次结算会多建一单。

#### 重取支付链接:`POST /api/store/orders/{orderNo}/payment-link`

```ts
// 响应
{ orderNo: "SO-…", paymentUrl: "https://checkout.stripe.com/…" }
```

三种情况服务端都包了:

- 还没链接 → 用订单行**重建**一张 Sellbase 订单(不重新定价,用的是下单那一刻的折后单价)
- 有 Sellbase 订单但链接失效 → 换一张新的
- 已经付了 → 拒绝

错误码:409 `ALREADY_PAID`、502 `CARRIER_MISSING` / `SELLBASE_NOT_CONFIGURED` /
其他(生成失败)。

---

### 5.4b 三个支付通道(2026-11-05)

> 本节是**新增**的。上面 §5.4 讲的是**旧路**(Sellbase + Stripe),过渡期
> 并行保留;三个新通道跑通后旧路会拆掉。
>
> **2026-11-05 更新:三个通道都开放。** `ENABLED_PAYMENT_CHANNELS` 现在是
> `["wechat", "alipay", "shopify"]`。但**开放 ≠ 能付** —— 微信 / 支付宝的
> 商户号 / 应用还没走完开通流程,那种情况下「配好了」是 false,用户**看得见
> 但选不了**(界面上是灰的、标「暂未开放」)。小程序侧同理:拿
> `GET /api/store/payment-channels` 的清单,只把 `available: true` 的渲染成
> 可选的。

结算时多传一个 `channel`:

```ts
// POST /api/store/checkout
{
  addressId: "addr_…",
  note: "…",
  channel: "wechat" | "alipay" | "shopify" | "stripe", // 不传 = 服务端挑
}
```

- **不传** → 服务端挑第一个「**开放了而且配好了**」的通道。小程序侧
  **建议显式传** —— 界面上的默认选中项和服务端的默认永远是同一个,显式传
  就不用猜
- **传了但现在不可用**(没开放 / 没配好 / 是旧路 `stripe`)→ **503
  `PAYMENT_CHANNEL_UNAVAILABLE`**。**不会**静默退回别的通道 —— 用户以为
  选了微信支付、结果跳去了别处,那比直接报错糟得多
- **一个通道都没配好** → 不传 `channel` 也是 503(同样的 code,消息是「暂时
  没有可用的在线支付方式,请联系工作室」)
- `stripe`(旧路)现在**不再接新单** —— 代码还留着(已建好的旧单还能重取
  支付入口),但新单传 `stripe` 也是 503

响应多两个字段:

```ts
{
  orderNo: "SO-…",
  paymentUrl: "https://…" | null,        // alipay / shopify:跳转地址
  paymentQrCodeUrl: "weixin://wxpay/bizpayurl?pr=…" | null, // wechat:扫码内容
  paymentChannel: "shopify",
  paymentIssue: null, // 没生成付款入口时是 "PAYMENT_NOT_CONFIGURED" / "PAYMENT_FAILED"
}
```

**先问服务端哪些通道能用**:`GET /api/store/payment-channels`

```ts
{
  channels: [
    { channel: "shopify", label: "银行卡 / Shop Pay", description: "…", available: true },
  ],
}
```

返回的**只有开放了的通道**。`available: false` 的通道**不要显示** ——
那条路没配好,点了必然失败。

#### 三个通道在小程序里怎么走

| 通道 | 拿到的东西 | 小程序侧 |
|---|---|---|
| `alipay` | `paymentUrl` | 全页跳(`web-view`),跟旧路一样 |
| `shopify` | `paymentUrl` | 全页跳(`web-view`),Shopify 收银台 |
| `wechat` | `paymentQrCodeUrl` | **⚠️ 见下** |

#### ⚠️ 微信 Native 扫码在**小程序里用不了**

本仓库的微信通道走的是 **Native(扫码)**:页面留在原地画一个二维码,用户用
微信扫。这个形态适合**浏览器**(H5)。

**微信小程序里扫自己屏幕上的二维码是死循环** —— 微信 Native 的二维码要
「用微信扫」,而用户正在微信里。小程序要收微信支付得走 **JSAPI 支付**
(`wx.requestPayment`),那是另一套接口(要 `openid`、要调
`/v3/pay/transactions/jsapi`),本仓库目前**没有实现**。

所以小程序侧现在能用的只有一条路:

- `shopify` —— 全页跳(`web-view`),Shopify 收银台

(`alipay` 的代码也在,但小程序里跳支付宝的落地页还没验过;两个通道都受
`ENABLED_PAYMENT_CHANNELS` + 「配好了没」两道闸管着 —— 见 §5.4b。)

**微信小程序端的微信支付要单独接 JSAPI**,那是下一件事。在那之前,小程序
的支付方式列表里**不要出现「微信支付」** —— 收了钱收不回来。

> **拿到清单的姿势**:`GET /api/store/payment-channels` 返回三个通道,每个带
> `available`(配好了没)。**只把 `available: true` 的渲染成可选的**,其余
> 灰掉标「暂未开放」—— 跟网页端的选择器一个口径。

---

### 5.5 查订单状态

#### `GET /api/store/orders/{orderNo}`

```ts
{
  orderNo: "SO-20261104-3F7K2A",
  status: "unpaid",        // unpaid | paid | fulfilled | cancelled —— 订单状态
  paymentStatus: "unpaid", // unpaid | paid | refunded | failed —— 支付状态
  totalCents: 5400,
  currency: "CNY",
  paymentUrl: "https://checkout.stripe.com/…" | null,
  paidAt: "2026-11-04T12:34:56.000Z" | null,
  createdAt: "2026-11-04T12:30:00.000Z",
}
```

**`status` 和 `paymentStatus` 是两件事**,别混:

- `status` = 订单走到哪一步(待付 / 已付 / 已发货 / 已取消)
- `paymentStatus` = 钱到没到 / 退没退

所以会出现 `status: "paid"` + `paymentStatus: "refunded"`(退过款的单),
或者 `status: "cancelled"` + `paymentStatus: "paid"`(先付后取消)。
**退款只改 `paymentStatus`,不动 `status`** —— 小程序端展示请以
`paymentStatus` 为准(退款了别还显示「已支付」)。

登录才能查(401 `AUTH_REQUIRED`);别人的订单号是 **404** 不是 403
(403 等于告诉别人「这个订单号存在」,订单号是可以被枚举的)。

---

## 六、收货地址

**地址簿留在本仓库** —— Sellbase 没有创建地址的路由(`customer.addresses`
只读),而且订单要存**地址快照**(用户后来改地址簿,不该改写历史订单的收货地址)。

地址数据在 `address` 表,字段:`recipientName` / `phone` / `province` / `city` /
`district` / `detail` / `isDefault`。

**HTTP 路由已经补上了** —— 小程序可以直接调,不用绕 server action。

| 能力 | 方法 | 路径 | 鉴权 |
|---|---|---|---|
| 列表 | `GET` | `/api/store/addresses` | Bearer 或 cookie |
| 新建 | `POST` | `/api/store/addresses` | Bearer 或 cookie |
| 改 | `PATCH` | `/api/store/addresses/{addressId}` | Bearer 或 cookie |
| 删 | `DELETE` | `/api/store/addresses/{addressId}` | Bearer 或 cookie |

请求体就是地址字段本身(`recipientName` / `phone` / `province` / `city` /
`district` / `detail` / `isDefault?`),**不含 userId** —— 归属由后端按会话
判定,客户端说了不算。`PATCH` 的 `addressId` 从 URL 拿,不在 body 里。

返回 `{ addressId }`(写)或 `{ addresses: [...] }`(列表)。

**约束**:

- 一个人**最多 20 个地址** —— 超了返 429 `TOO_MANY_ADDRESSES`。
- **只有一条默认地址** —— 建 / 改的时候带 `isDefault: true`,后端会先把
  该用户其它地址的默认置掉。第一条地址自动成默认。
- **别人的地址当「不存在」** —— 返 404 `ADDRESS_NOT_FOUND`,不是 403
  (跟订单号一个道理:403 等于告诉别人「这个 id 存在」)。
- 限流桶 `storeAddress`,**30 次/分钟**。

> 网页端仍然走 `/dashboard/addresses` 的 server action
> (`src/features/address/actions.ts`)。两边调的是同一份业务逻辑
> (`src/features/address/mutations.ts`),校验规则和「默认地址只有一个」
> 那条约束只写了一遍。

---

## 七、鉴权速查

| 来源 | Header | 小程序侧怎么来 |
|---|---|---|
| **商品目录** `/api/image-gen/products` | `x-api-key`(或 BA session / dev 模式) | SDK 的 `setSdkApiKey()` 已经自动带 |
| **购物车** `/api/store/carts/**` | 无(靠 cookie `wjp_cart_id`) | 游客也能有车 |
| **算价** `/api/store/pricing/calculate` | 无 | 公开 |
| **结算 / 查订单 / 重取支付链接** | `Authorization: Bearer <token>` 或 BA 会话 cookie | 小程序用 Bearer;浏览器用 cookie |
| **收货地址** `/api/store/addresses/**` | `Authorization: Bearer <token>` 或 BA 会话 cookie | 同上 |

**Sellbase 的任何凭据小程序都不需要** —— API base、admin token、webhook
secret 全在服务端。

### 7.1 Bearer 和 cookie 怎么选

同一个接口两种凭据都认,后端按这个顺序判断:

1. 带了 `Authorization: Bearer <token>` → 用 Bearer 查会话
2. 没带 → 退回 Better Auth 的签名 cookie(`better-auth.session_token`)

**带了 Bearer 但 token 无效 → 直接 401,不退回 cookie。** 这是故意的 ——
悄悄换个身份继续跑,等于把「token 过期」变成「换个身份照样能过」,授权边界
就宽了。小程序侧 token 过期了就重新登录,别指望后端兜底。

实现:`src/lib/auth/request-session.ts` 的 `getSessionFromRequest`。

---

## 八、错误处理约定

本仓库的 API 统一返回 `{ error: "<机器码>", message: "<给人看的文案>" }`。

**⚠️ SDK 的 `sdkRequest` 把这两个字段反过来了**:

```ts
// sdkRequest 抛错时
err.message  // = body.error  → "AUTH_REQUIRED" 这种机器码,不是人话
err.code     // = body.code   → 商城路由**没有** code 字段,所以是 undefined
err.raw      // = 完整响应体,{ error, message } —— 人话在这里
```

所以小程序侧:

- **按 `err.raw?.message` 展示文案**,别直接 toast `err.message`(会弹
  "AUTH_REQUIRED")
- 需要按业务码分支时,判 `err.raw?.error`(或 `err.message`,两者在这批路由上相等)
- 401 会被 SDK 拦下来:触发 `setupSdk({ onUnauthorized })` 回调,然后抛
  `SdkRequestError`(code `UNAUTHORIZED`,商城返回的 body 被丢掉)。**结算前
  先判登录态**,别等 401 才知道要跳登录页

---

## 九、在小程序代码中的边界

```ts
// ✅ 正确:商城全部走本仓库
import { listProducts } from "@/api/sdk";
const { products } = await listProducts();

await sdkRequest("/api/store/checkout", {
  method: "POST",
  json: { addressId, note },
});

// ❌ 错误:小程序不直连 Sellbase / Medusa
// (Sellbase 的 base URL / token 根本不该出现在小程序包里)
```

```ts
// ❌ 错误:用小程序站内路由打开 Stripe
wx.navigateTo({ url: body.paymentUrl });   // 打不开,那是外链
```

---

## 十、什么会变

- 小程序侧**没有待办的后端依赖**了 —— Bearer 鉴权和地址簿 HTTP 路由都已
  经就位,`addressId` 拿得到,结算这条链是通的。
- Sellbase 换成别的收银台时,**小程序侧的契约不变** —— 本仓库始终只给一个
  `paymentUrl` 和一个 `status`

---

## 十一、接口速查表

| 能力 | 方法 | 路径 | 鉴权 | 要点 |
|---|---|---|---|---|
| 商品目录 | `GET` | `/api/image-gen/products` | x-api-key / BA session / dev | `ProductCapability[]`,真 SKU 在 `variants[].priceCents`(绝对价) |
| 单商品 | `GET` | `/api/image-gen/products?productTypeCode=R` | 同上 | SDK `getProduct(code)` |
| 建/取购物车 | `POST` | `/api/store/carts` | 无(cookie) | 201;下发 cookie `wjp_cart_id` |
| 取购物车 | `GET` | `/api/store/carts/{id}` | 无(cookie) | 单价服务端重算 |
| 加一行 | `POST` | `/api/store/carts/{id}/line-items` | 无(cookie) | 201;同规格合并数量 |
| 改数量 | `PUT` | `/api/store/carts/{id}/line-items/{lineId}` | 无(cookie) | `quantity` 0 = 删除 |
| 删一行 | `DELETE` | `/api/store/carts/{id}/line-items/{lineId}` | 无(cookie) | — |
| 算价 | `POST` | `/api/store/pricing/calculate` | 无 | 只给用户看,收钱以结算为准 |
| **结算** | `POST` | `/api/store/checkout` | **登录**(Bearer / cookie) | body `{ addressId, note? }`;返 `{ orderNo, paymentUrl, subtotalCents, discountCents, shippingCents, totalCents, currency }` |
| 查订单 | `GET` | `/api/store/orders/{orderNo}` | 登录(Bearer / cookie) | `status`: `unpaid` / `paid` / `fulfilled` / `cancelled`;`paymentStatus`: `unpaid` / `paid` / `refunded` / `failed` |
| 重取支付链接 | `POST` | `/api/store/orders/{orderNo}/payment-link` | 登录(Bearer / cookie) | 返 `{ orderNo, paymentUrl }`;已付 / 已退款返 409 |
| 地址列表 | `GET` | `/api/store/addresses` | 登录(Bearer / cookie) | 返 `{ addresses: [...] }` |
| 新建地址 | `POST` | `/api/store/addresses` | 登录(Bearer / cookie) | body = 地址字段;返 `{ addressId }` |
| 改地址 | `PATCH` | `/api/store/addresses/{addressId}` | 登录(Bearer / cookie) | body = 地址字段(id 在 URL 里);返 `{ addressId }` |
| 删地址 | `DELETE` | `/api/store/addresses/{addressId}` | 登录(Bearer / cookie) | 返 `{ addressId }` |

**金额单位**:全部 `*Cents` = 人民币**分**(`2400` = ¥24)。

**Sellbase 侧接口小程序一律不碰** —— 建单 / 换链接 / 目录同步 / webhook
全在服务端。

---

## 十二、相关链接

- Sellbase 集成架构(权威):仓库根 `architecture-sellbase-integration.md`
- 小程序身份定位:仓库根 `architecture-miniprogram-as-client.md`
- 商城核心实现:`src/features/storefront/lib/checkout.ts`、`cart-store.ts`、
  `pricing.ts`
- 地址簿:`src/features/address/mutations.ts`(业务逻辑)、
  `src/features/address/actions.ts`(Web server action)、
  `src/app/api/store/addresses/`(小程序 HTTP 路由)
- 鉴权:`src/lib/auth/request-session.ts` 的 `getSessionFromRequest`
- SDK 用法总览:[`README.md`](./README.md)

---

## 文档历史

| 日期 | 变更 |
|---|---|
| 2026-09-17 | 初版(Medusa 方案,`MEDUSA_INTEGRATION.md`) |
| 2026-10-21 | 商品目录收回本仓库 |
| 2026-11-04 | **改用 Sellbase**;「本仓库算价,Sellbase 只做收银台」落地;本文档取代 Medusa 文档 |
| 2026-11-04 | 商城路由接上 Bearer 鉴权;地址簿补 HTTP 路由(`/api/store/addresses`);订单接口加 `paymentStatus` |
