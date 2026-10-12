# NextDevTpl · AI 生图 API 后端定位说明

> **Mooncoda · 小梦定制馆**
> 状态:方案稿 · 2026-09-17 更新身份定位
> 目标读者:技术负责人 / 后端 / 前端 / DevOps

---

## 〇、项目身份（2026-09-17 收敛）

NextDevTpl **不做电商前端**。最终身份定位：

- **AI 生图 API 后端** —— 暴露生图 / 积分 / 用户 / 文件上传 / Webhook 等 API
- **Web 管理后台** —— `/dashboard/*` + `/admin/*` + `/marketing/{pricing,blog,legal,home}`（landing pages + 作品集 showcase + 博客 SEO）
- **三类调用方**：
  - **Web dashboard**（现有）—— ToC 客户 + 代理商 + 管理员
  - **微信小程序**（外部项目）—— `Authorization: Bearer` 调 API
  - **未来独立 Medusa 电商 storefront**（外部项目，不在本仓库）—— 商品 / 购物车 / 订单 / 收货地址全部走 Medusa Store API；本仓库仅提供 user / credits 共享层

**本仓库内不引入**：shopping cart / 商品 SKU / 收货地址 / 订单实体（Medusa 实体）。`/marketing/products/*` 仅作品牌 showcase 静态橱窗，引导用户到独立 storefront。

---

## 一、背景与目标

### 1.1 现状

| 端 | 技术栈 | 后端 |
|---|---|---|
| Web 端 | NextDevTpl(Next.js) | NextDevTpl 自身 |
| 小程序端 | Taro 4.0.9 + React 18 | 独立 NestJS BFF(`mooncoda/bff/`) |
| Medusa 电商 storefront(未来) | Next.js Medusa Storefront 模板 | Medusa Store API |
| **账号 / 积分** | NextDevTpl 持有 | NextDevTpl(单一权威) |
| **商品 / 订单** | Medusa 持有 | Medusa(单一权威) |

BFF 是 in-memory 实现,**生产不可用**,且与未来 storefront 形态不一致 —— 收回到 NextDevTpl 让所有客户端共享同一份 user / credits。

### 1.2 目标

**NextDevTpl 是唯一后端**,**小程序只是另一个前端客户端**。

```
┌─────────────────┐     ┌─────────────────┐
│   微信小程序      │     │   Web 前端       │
│  (另一个客户端)   │     │  (NextDevTpl)   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │  HTTPS + Bearer       │  Cookie/Session
         ▼                       ▼
┌─────────────────────────────────────────────┐
│           NextDevTpl 后端 (Next.js API)      │
│  ┌─────────────────────────────────────┐    │
│  │ 账号系统 (Postgres)                  │    │  ← NextDevTpl 独家持有
│  │  • 用户表 / 微信 openid 绑定         │    │
│  │  • BA session 签发 (verifyPhoneNumber 流) │  │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ 积分账本 (Postgres ledger)           │    │  ← NextDevTpl 独家持有
│  │  • grant / spend / refund / auth    │    │
│  │  • 幂等键 + dead-letter             │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ AI 生图任务队列 (异步 + 轮询)        │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ 支付回调 (Stripe + 微信支付)         │    │
│  └─────────────────────────────────────┘    │
└──────────────────────┬──────────────────────┘
                       │ 商品/订单查询
                       ▼
              ┌─────────────────┐
              │  Medusa (保留)   │
              │  商品/订单管理    │   ← Medusa **不参与**
              │                 │     账号与积分
              └─────────────────┘
```

### 1.3 核心原则

1. **后端统一**:NextDevTpl 唯一后端,BFF 退役
2. **前端薄**:小程序只负责展示 + 交互,不存业务状态
3. **账号走 NextDevTpl**:**用户表 / 微信 openid 绑定 / BA session 签发全部由 NextDevTpl 持有**,Medusa 不参与
4. **积分走 NextDevTpl**:**积分账本(账户表 + 流水表)全部由 NextDevTpl 持有**,Medusa 不参与
5. **Medusa 边界**:Medusa **只管商品 SKU / 订单流水**,不存账号、不存积分
6. **支付解耦**:Medusa 管商品,NextDevTpl 管支付(微信支付不走 Medusa)
7. **可观测**:所有积分流水、AI 任务状态走 Postgres,可审计可回放

### 1.4 业务归属矩阵

| 业务能力 | NextDevTpl | Medusa | 备注 |
|---|---|---|---|
| 用户账号 / 微信 openid 绑定 | ✅ | ❌ | 用户表只在 NextDevTpl |
| Session 签发 (BA 原生) | ✅ | ❌ | 通过 phoneNumber 插件 verifyOTP 流 |
| 积分账户余额 | ✅ | ❌ | Postgres ledger |
| 积分流水(grant/spend/refund) | ✅ | ❌ | append-only 流水表 |
| **新用户注册赠送积分** | ✅ | ❌ | NextDevTpl 在 `users` 创建时自动写一笔 `grant` |
| **每日手动领取积分** | ✅ | ❌ | NextDevTpl 暴露 `POST /api/credits/daily-claim` |
| **每日 00:00 自动清零** | ✅ | ❌ | NextDevTpl cron / lazy reset |
| AI 生图任务 | ✅ | ❌ | 异步任务 + 队列 |
| 微信支付下单/回调 | ✅ | ❌ | NextDevTpl 调微信支付 API |
| 商品 SKU / 分类 / 价格 | ❌ | ✅ | 商城浏览 |
| 订单流水 / 物流 | ❌ | ✅ | Medusa 订单模块 |
| 购物车(cart) | ❌ | ✅ | Medusa Store API |
| 收货地址 | ❌ | ✅ | 跟 Medusa Customer 走 |

### 1.5 跨系统用户标识

- **NextDevTpl `user_id`**:NextDevTpl 自有 UUID,作为账号系统主键
- **Medusa `customer_id`**:Medusa 自有 UUID,作为订单/地址主键
- **关联方式**:NextDevTpl `users` 表增加 `medusa_customer_id` 字段,首次支付下单时按需创建 Medusa Customer
- **小程序使用 NextDevTpl 的 `user_id`** 作为业务身份标识(积分、AI 任务、个人中心);涉及订单/地址时由 NextDevTpl 内部 join Medusa customer_id

> **原则**:**对外暴露 NextDevTpl user_id**,Medusa customer_id 是 NextDevTpl 内部细节,小程序不感知。

---

## 二、四个关键改造点

### 2.1 认证:Cookie Session → BA 原生 Token + Bearer 透传

**问题**:小程序不支持 Cookie,NextDevTpl 的 Better Auth 默认走 Session。

**最终方案（2026-09-16 落地）**:不复用自签 JWT,直接复用 BA `phoneNumber` 插件的 `verifyOTP` 钩子 —— 把微信流程伪装成「OTP 验证一次成功」。BA 内部完成 createUser / createSession / setSessionCookie,小程序端拿 `{ token, user }` 后用 `Authorization: Bearer <token>` 调业务 API。

#### 2.1.1 NextDevTpl 新增 `app/api/auth/wechat-phone-login/route.ts`

```ts
// src/app/api/auth/wechat-phone-login/route.ts
import { auth } from '@/lib/auth'
import {
  code2Session,
  decryptWechatData,
  parseDecryptedPhoneNumber,
  putWechatOtp,
} from '@/features/wechat'

export async function POST(request: Request) {
  const { code, encryptedData, iv } = await request.json()

  // 1. code → { openid, unionid, session_key }
  const session = await code2Session(code)

  // 2. 解密手机号 (AES-128-CBC, 零依赖 Node crypto)
  const decrypted = decryptWechatData(session.session_key, encryptedData, iv)
  const { phoneNumber } = parseDecryptedPhoneNumber(decrypted)

  // 3. bridge: 把微信结果 put 到 otp-store (Redis / 进程内 Map)
  //  让 BA verifyOTP 钩子在不知道原始 HTTP 请求的情况下能查到
  await putWechatOtp(phoneNumber, { openid: session.openid, unionid: session.unionid })

  // 4. 调 BA verifyPhoneNumber —— 用 magic code "WECHAT_VERIFIED" 触发 verifyOTP 钩子
  //    钩子命中 → createUser (新用户) 或 findUser (老用户) + createSession + setSessionCookie
  //    callbackOnVerification 钩子把 wechat_openid 写回 user 行
  const result = await auth.api.verifyPhoneNumber({
    body: { phoneNumber, code: 'WECHAT_VERIFIED' },
  })

  return Response.json({ token: result.token, user: result.user })
}
```

#### 2.1.2 BA phoneNumber plugin 配置钩子 (`src/lib/auth/index.ts`)

```ts
import { consumeWechatOtp, hasWechatOtp } from '@/features/wechat'

phoneNumber({
  // ...既有 sendOTP / signUpOnVerification / requireVerification 等
  verifyOTP: async ({ phoneNumber, code }) => {
    // 只信任微信 magic code,其他 OTP 流走 sendOTP 真实 6 位数字路径
    if (code !== 'WECHAT_VERIFIED') return false
    return await hasWechatOtp(phoneNumber)
  },
  callbackOnVerification: async ({ phoneNumber, user }) => {
    // 验证成功后(无论 OTP 流还是微信流),把微信 payload 写回 user
    const payload = await consumeWechatOtp(phoneNumber)
    if (!payload?.openid) return
    await db.update(user).set({
      wechatOpenid: payload.openid,
      wechatUnionid: payload.unionid ?? null,
      lastLoginAt: new Date(),
    }).where(eq(user.id, user.id))
  },
})
```

#### 2.1.2 NextDevTpl 中间件 `src/proxy.ts`(双模式认证)

> Next.js 16 起取代 `middleware.ts`,文件名是 `proxy.ts`(但功能等价)。

```ts
// src/proxy.ts (关键片段,完整文件见源码)
import { getBearerSession } from '@/lib/auth/bearer'

async function hasAnySessionToken(request: NextRequest): Promise<boolean> {
  // 1. Web Cookie 路径(原有 BA 逻辑)
  const cookieToken =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value
  if (cookieToken) return true

  // 2. 微信小程序 Bearer 路径 —— 直查 Drizzle session 表 + 校验 expiresAt
  const auth = request.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const session = await getBearerSession(auth.slice(7).trim())
    return session !== null
  }

  return false
}
```

`getBearerSession(token)` 在 `src/lib/auth/bearer.ts` 实现 —— 等价于 BA 内部
`internalAdapter.findSession(token)`(node_modules/better-auth/dist/db/internal-adapter.mjs:182),
但**不**走签名 cookie 校验,直接查 Drizzle 拿到 user + session 行。

#### 2.1.3 小程序端 `miniprogram/src/api/authStore.ts`

```ts
import Taro from '@tarojs/taro'
import { request } from './request'

export async function loginWithWechat() {
  // 1. wx.login() 拿 code
  const { code } = await Taro.login()

  // 2. 用户授权拿手机号(必须用户主动点)
  const { encryptedData, iv } = await Taro.getPhoneNumber({})

  // 3. POST /api/auth/wechat-phone-login —— 服务端 code2Session + 解密 + 走 BA 流程
  const { token, user } = await request.post('/api/auth/wechat-phone-login', {
    code,
    encryptedData,
    iv,
  })

  setToken(token) // 存到本地 + 后续 request 拦截器自动加 Authorization: Bearer
  setUser(user)
}
```

#### 2.1.4 NextDevTpl 用户表 schema(账号由 NextDevTpl 独家持有)

```sql
-- 实际表名 / 列名 (2026-09-16 落地后) —— 见 drizzle/0042_user_wechat_medusa.sql
-- user 是 Better Auth 的用户表,单数;本节展示新增列的最终形态

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "wechat_openid" text;          -- 微信小程序 openid(主索引),UNIQUE
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "wechat_unionid" text;         -- 同一微信开放平台下多端打通(预留)
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "medusa_customer_id" text;     -- 首次下单时按需创建 Medusa Customer
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;     -- 最近一次成功登录(任意渠道)

CREATE UNIQUE INDEX IF NOT EXISTS "user_wechat_openid_key" ON "user" ("wechat_openid");
CREATE INDEX IF NOT EXISTS "user_wechat_unionid_idx" ON "user" ("wechat_unionid");
CREATE INDEX IF NOT EXISTS "user_medusa_customer_id_idx" ON "user" ("medusa_customer_id");
```

**关键约束**:
- `user` 表在 NextDevTpl 的 Postgres 里(Better Auth 持有),**Medusa 不持有 user 概念**
- Medusa Customer 通过 `user.medusa_customer_id` 关联,NextDevTpl 内部 join
- 小程序 token = BA session.token(由 verifyPhoneNumber 流程签发,7 天有效),**不是自签 JWT**
- 多端登录(Web 邮箱 / 手机号 / 微信小程序)共享同一 `user.id`,phoneNumber / wechatOpenid 任意一个已 verified 即可登录

### 2.2 支付:Stripe → 微信支付

**问题**:Stripe 在小程序里用不了。

#### 2.2.1 NextDevTpl 新增 `app/api/pay/wechat/create/route.ts`

```ts
// app/api/pay/wechat/create/route.ts
export async function POST(req: NextRequest) {
  const { productId, quantity = 1 } = await req.json()
  const userId = req.headers.get('x-user-id')!
  const openid = req.headers.get('x-openid')!

  // 1. 查商品
  const product = await medusa.store.product.retrieve(productId)
  const totalFen = product.variants[0].prices[0].amount * quantity

  // 2. 创建 Medusa 订单
  const cart = await medusa.store.cart.create({
    region_id: process.env.MEDUSA_REGION!,
    items: [{ variant_id: product.variants[0].id, quantity }],
  })
  const order = await medusa.store.cart.complete(cart.id)

  // 3. 微信支付下单(JSAPI)
  const wxPayParams = await wechatPay.createJSAPI({
    description: product.title,
    out_trade_no: order.id,
    total: totalFen,
    openid,
    notify_url: `${process.env.NEXT_PUBLIC_API}/api/webhooks/wechat-pay`,
  })

  // 4. 积分预授权(pending 态,等回调入账)
  await creditLedger.authorize({
    userId,
    reference: order.id,
    amount: totalFen,
    type: 'payment_pending',
  })

  return Response.json({ orderId: order.id, payParams: wxPayParams })
}
```

#### 2.2.2 NextDevTpl 新增 `app/api/webhooks/wechat-pay/route.ts`

```ts
// app/api/webhooks/wechat-pay/route.ts
export async function POST(req: NextRequest) {
  // 1. 验签
  const body = await req.text()
  if (!wechatPay.verifyNotify(body)) {
    return new Response('FAIL', { status: 400 })
  }

  const xml = parseXml(body)
  const { out_trade_no, transaction_id, result_code } = xml

  // 2. 幂等(同一 transaction_id 只处理一次)
  const existing = await db.wechatPayWebhook.findUnique({
    where: { transactionId: transaction_id },
  })
  if (existing) return new Response('SUCCESS')

  await db.wechatPayWebhook.create({
    data: { transactionId: transaction_id, outTradeNo: out_trade_no },
  })

  // 3. 支付成功 → 发放积分
  if (result_code === 'SUCCESS') {
    const order = await db.order.findUnique({ where: { id: out_trade_no } })
    await creditLedger.grant({
      userId: order.customerId,
      reference: transaction_id,
      amount: order.metadata.creditAmount,
      reason: 'wechat_pay',
      idempotencyKey: transaction_id,
    })
  }

  return new Response('SUCCESS')  // 微信只认这个字符串
}
```

#### 2.2.3 小程序端 `miniprogram/src/api/payment.ts`

```ts
import Taro from '@tarojs/taro'
import { request } from './request'

export async function payWithWechat(productId: string, quantity = 1) {
  const { payParams } = await request.post('/api/pay/wechat/create', {
    productId, quantity,
  })

  await Taro.requestPayment({
    timeStamp: payParams.timeStamp,
    nonceStr: payParams.nonceStr,
    package: payParams.package,
    signType: payParams.signType,
    paySign: payParams.paySign,
  })
}
```

### 2.3 域名:必须备案 + 白名单

**问题**:Vercel 默认域名 `*.vercel.app` 无法备案。

#### 2.3.1 部署清单

```bash
# 1. 域名 ICP 备案(走阿里云 / 腾讯云)
#    api.mooncoda.com → NextDevTpl

# 2. Vercel 绑域名
vercel domains add api.mooncoda.com

# 3. 微信公众平台 → 开发管理 → 服务器域名
#    request 合法域名:  https://api.mooncoda.com
#    uploadFile 合法域名: https://api.mooncoda.com
#    downloadFile 合法域名: https://api.mooncoda.com

# 4. Vercel 环境变量
vercel env add DATABASE_URL            # Postgres ledger
vercel env add WECHAT_MCH_ID
vercel env add WECHAT_API_KEY
vercel env add WECHAT_APP_ID
vercel env add WECHAT_APP_SECRET
vercel env add MESHY_API_KEY
vercel env add MEDUSA_API_KEY
```

#### 2.3.2 小程序 `.env`

```bash
# 旧
TARO_APP_API_BASE_URL=http://localhost:3000
TARO_APP_USE_MOCK=true

# 新
TARO_APP_API_BASE_URL=https://api.mooncoda.com
TARO_APP_USE_MOCK=false
```

### 2.4 AI 生图:同步 → 异步任务

**问题**:小程序 `wx.request` 默认超时 60 秒,AI 生图可能超过。

#### 2.4.1 NextDevTpl 新增 `app/api/ai/generate-image/route.ts`

```ts
// POST /api/ai/generate-image
export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')!
  const { prompt, sourceImageUrl, kind = 'keychain' } = await req.json()

  // 1. 原子扣积分(预授权)
  const cost = MESHY_COSTS[kind]  // { keychain: 6, keycap: 12, 'fridge-magnet': 6 }
  const txId = `meshy_${Date.now()}_${userId}`

  try {
    await creditLedger.spend({
      userId, amount: cost,
      reference: txId, reason: 'ai_image_generate',
      idempotencyKey: txId,
    })
  } catch {
    return Response.json({ error: 'INSUFFICIENT_CREDITS' }, { status: 402 })
  }

  // 2. 写任务记录
  const task = await db.aiTask.create({
    data: {
      id: txId, userId, kind, sourceImageUrl, prompt,
      status: 'pending', creditTxId: txId,
    },
  })

  // 3. 丢后台队列
  await queue.add('ai-generate', {
    taskId: task.id, kind, sourceImageUrl, prompt, creditCost: cost,
  }, { removeOnComplete: true })

  // 4. 立即返回 taskId
  return Response.json({ taskId: task.id, costCredits: cost })
}
```

#### 2.4.2 NextDevTpl 新增 worker `workers/ai-generate.ts`

```ts
import { MeshyClient } from '@/lib/meshy'
import { creditLedger } from '@/lib/credit'

export async function processAIGenerate({
  taskId, kind, sourceImageUrl, prompt, creditCost,
}) {
  const task = await db.aiTask.findUnique({ where: { id: taskId } })

  try {
    await db.aiTask.update({
      where: { id: taskId }, data: { status: 'in_progress' },
    })

    // 1. 调 Meshy
    const meshyTaskId = await MeshyClient.createPrototype(kind, {
      image_url: sourceImageUrl, prompt,
    })

    // 2. 轮询(后台,最多 60s)
    const result = await MeshyClient.pollPrototype(kind, meshyTaskId, {
      timeout: 60_000, interval: 5_000,
    })

    // 3. 写结果
    await db.aiTask.update({
      where: { id: taskId },
      data: {
        status: 'succeeded',
        imageUrl: result.image_urls[0],
        finishedAt: new Date(),
      },
    })
  } catch (e: any) {
    // 失败 → 自动 refund
    await creditLedger.refund({
      userId: task.userId,
      amount: creditCost,
      reference: taskId,
      reason: 'ai_generate_failed',
    })
    await db.aiTask.update({
      where: { id: taskId },
      data: { status: 'failed', error: e.message },
    })
  }
}
```

#### 2.4.3 NextDevTpl 新增 `app/api/ai/tasks/[taskId]/route.ts`

```ts
// GET /api/ai/tasks/:taskId
export async function GET(req: NextRequest, { params }: { params: { taskId: string } }) {
  const userId = req.headers.get('x-user-id')!
  const task = await db.aiTask.findFirst({
    where: { id: params.taskId, userId },
  })
  if (!task) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })

  return Response.json({
    taskId: task.id,
    status: task.status,
    imageUrl: task.imageUrl,
    progress: task.progress,
    errorMessage: task.error,
    expiresAt: task.finishedAt
      ? new Date(task.finishedAt.getTime() + 3 * 24 * 3600 * 1000).toISOString()
      : null,
  })
}
```

#### 2.4.4 小程序端 改造 `meshyCreative.ts`

```ts
// baseURL 改 .env,逻辑不变 —— NextDevTpl API 形状保持和原 BFF 一致
const BASE = process.env.TARO_APP_API_BASE_URL

export async function createPrototypeTask(payload: {...}) {
  return request.post(`${BASE}/api/ai/generate-image`, payload)
}

export async function getPrototypeTask(taskId: string) {
  return request.get(`${BASE}/api/ai/tasks/${taskId}`)
}
```

### 2.5 文件上传 + 内容安全

**问题**:微信强制要求接内容安全 API。

#### 2.5.1 NextDevTpl `lib/security.ts`

```ts
export async function checkImageSafe(imageUrl: string, openid: string) {
  const accessToken = await getWechatAccessToken()
  const res = await fetch(
    `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media: { type: 1, url: imageUrl }, openid }),
    }
  )
  const data = await res.json()
  if (data.errcode !== 0) throw new Error('IMAGE_UNSAFE')
}
```

#### 2.5.2 NextDevTpl `app/api/upload/route.ts`

```ts
// POST /api/upload —— 接收小程序 wx.uploadFile
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const openid = req.headers.get('x-openid')!

  // 1. 上传到云存储
  const url = await uploadToCOS(file)

  // 2. 内容安全检测(微信强制)
  await checkImageSafe(url, openid)

  return Response.json({ url })
}
```

---

## 三、积分账本设计(核心)

> **所有权**:**积分账本完全由 NextDevTpl 持有**,存在 NextDevTpl 自己的 Postgres 里。Medusa **不参与**任何积分概念 —— Medusa 既不知道积分存在,也不存积分余额。
>
> 跨系统对齐:**积分账户 1:1 绑定 NextDevTpl `users.id`**(账号主键),**不绑定** Medusa `customer_id`。即便用户尚未在 Medusa 创建 Customer(还没下过单),积分账户已经存在;积分先于订单。

### 3.0 积分发放策略(NextDevTpl 独家负责)

| 场景 | NextDevTpl 行为 | API |
|---|---|---|
| **新用户注册** | `users` 创建时自动写一笔 `credit_transactions(type='grant', amount=10, reason='signup_bonus')` | 无(创建用户时同步) |
| **每日手动领取** | 用户在积分中心点「领取今日积分」,NextDevTpl 校验当日是否已领,未领则写 `grant +10` | `POST /api/credits/daily-claim` |
| **每日 00:00 自动清零** | cron(或 lazy reset)按 `Asia/Shanghai` 时区,把上一日未用积分作废,余额回到 10(或上次领取后已用) | `GET /api/credits/balance`(响应里返回 `next_reset_at`) |
| **AI 生图扣分** | 调 `/api/ai/generate-image` 时原子扣减,失败 refund | `POST /api/ai/generate-image` |
| **退款** | AI 失败 / 支付退款 / 运营补偿 | 内部 `creditLedger.refund(...)` |
| **运营手动调整** | Admin 后台加扣 | `POST /api/admin/credits/adjust` |

**关键约束**:
- 小程序**不写积分规则**,只展示 + 调用
- 「新用户 +10」「每日领取 +10」「每日清零」**全部由 NextDevTpl 决定时机**,小程序只能 `POST /api/credits/daily-claim`
- 余额显示 `remaining / daily_quota`,由 NextDevTpl 在 `CreditBalance` 响应里直接给出
- `daily_quota` 默认 10(由 NextDevTpl env `CREDIT_DAILY_QUOTA` 配置)

### 3.1 表结构

```sql
-- 积分账户表(每 NextDevTpl user 一行,lazy 创建)
CREATE TABLE credit_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- ↑ 注意:这是 NextDevTpl users.id,不是 Medusa customer_id
  daily_quota     INT NOT NULL DEFAULT 10,
  reset_at        TIMESTAMPTZ,                          -- 下次跨日重置时间
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 流水表(append-only,永不 UPDATE/DELETE)
CREATE TABLE credit_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES credit_accounts(id),
  type            TEXT NOT NULL CHECK (type IN ('grant','spend','refund','authorize')),
  amount          INT NOT NULL,                          -- 正加负减
  balance_after   INT NOT NULL,                          -- 冗余,方便审计 / 前端展示
  reference       TEXT,                                  -- 幂等键
  reason          TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 幂等键唯一约束(同一账户 + 同一 reference + 同一 type → 只允许一行)
CREATE UNIQUE INDEX credit_tx_idempotency
  ON credit_transactions(account_id, reference, type)
  WHERE reference IS NOT NULL;

CREATE INDEX credit_tx_account_time
  ON credit_transactions(account_id, created_at DESC);
```

**为什么 `user_id` 指向 NextDevTpl users 而不是 Medusa customers**:
- 用户可以**只注册账号、只领积分、还没下过单**——此时 Medusa 还没有 Customer
- 用户可以**下过单、有 Medusa Customer,但从没领过积分**——此时积分账户还没创建
- 两者生命周期完全独立,**以积分账户的存在与否来推断积分可用性**

### 3.2 余额查询

```sql
SELECT COALESCE(SUM(amount), 0) AS balance
FROM credit_transactions
WHERE account_id = $1
  AND created_at >= COALESCE(
    (SELECT reset_at FROM credit_accounts WHERE id = $1),
    '1970-01-01'::timestamptz
  );
```

### 3.3 原子扣减(事务)

```sql
BEGIN;
  -- 1. 余额检查 + 行锁
  SELECT SUM(amount) FROM credit_transactions
    WHERE account_id = $1 AND created_at >= $2
    FOR UPDATE;
  -- 检查 ≥ cost

  -- 2. 插流水
  INSERT INTO credit_transactions(account_id, type, amount, reference)
    VALUES ($1, 'spend', -$3, $4);

  -- 3. lazy reset(若需要)
  UPDATE credit_accounts SET reset_at = ... WHERE id = $1;
COMMIT;
```

### 3.4 TypeScript service 接口

```ts
// lib/credit.ts
interface CreditLedger {
  spend(opts: {
    userId: string
    amount: number
    reference: string         // 幂等键
    reason: string
    metadata?: Record<string, any>
  }): Promise<{ txId: string; balanceAfter: number }>

  refund(opts: {
    userId: string
    amount: number
    reference: string
    reason: string
  }): Promise<{ txId: string }>

  grant(opts: {...}): Promise<...>
  getBalance(userId: string): Promise<{ balance: number; resetAt: Date }>
}
```

**关键**: `refund()` 内部用 try/catch 包,失败写 dead-letter,**永远不让业务感知到退款失败**(否则前端一直看到「积分被扣」)。

### 3.5 小程序端契约(NextDevTpl 提供哪些 API,小程序怎么调)

```ts
// lib/credit.ts —— NextDevTpl 暴露给小程序的 3 个端点
//
// ① GET /api/credits/balance
//    响应:{
//      daily_quota: number          // 每日额度(默认 10)
//      remaining: number            // 当前可用
//      today_used: number           // 今日已用
//      next_reset_at: string        // 下次清零时间 ISO
//      cost_per_generation: number  // 每次生图扣的积分(按产品)
//      claimed_today: boolean       // 今日是否已手动领取
//      signup_granted: boolean      // 是否已领取新用户奖励
//    }
//
// ② POST /api/credits/daily-claim
//    请求:{ }
//    响应:{
//      success: boolean
//      granted: number              // 实际到账积分(10)
//      remaining: number            // 领取后余额
//      message: string              // '今日已领取' / '领取成功'
//    }
//    失败 400 ALREADY_CLAIMED       // 当日已领,不能重复
//    失败 400 NOT_SIGNUP            // 新用户奖励未发放(异常)
//
// ③ GET /api/credits/ledger?date=today
//    响应:CreditLedgerEntry[]
```

**小程序**:
- **不写**积分规则(不发 +10、不清零、不扣 1)
- **只展示**:`daily_quota / remaining / today_used / next_reset_at / claimed_today`
- **只触发**:`POST /api/credits/daily-claim`(用户点「领取」按钮时)
- 失败处理:`ALREADY_CLAIMED` → toast「今日已领取」,按钮置灰

### 3.6 积分中心页面(小程序端)

```
┌─────────────────────────────────┐
│  💎 每日 10 积分 · 用完明天再来   │
│                                  │
│      [剩余:7] / 10              │
│      ▓▓▓▓▓▓▓░░░  70% 剩余      │
│                                  │
│  [已用 3] | [每次扣 1] | [重置:明日 00:00] │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  🎁 每日领取                       │
│                                  │
│  [今日已领取 ✓]  or  [立即领取 +10] │
│                                  │
│  说明:每天可手动领取 10 积分,    │
│  未领取的部分随 00:00 自动清零    │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  📒 今日流水                        │
│   🎁 +10  注册赠送     10:32      │
│   🎁 +10  每日领取     11:05      │
│   ✨ -6   AI 生图(钥匙扣) 11:08  │
└─────────────────────────────────┘
```

**关键差异(对比旧的"每天自动发 10")**:
- 旧策略:每日 00:00 自动 grant 10(被动)
- **新策略(NextDevTpl)**:用户**主动点按钮**领取,NextDevTpl 防重复 + lazy 清零
- 小程序 UI 要新增「每日领取」按钮 + `claimed_today` 状态

### 3.7 小程序端代码契约(已落地)

| 文件 | 类型 | 关键改动 |
|---|---|---|
| `src/types/index.ts` | 类型 | `CreditBalance` 加 `claimed_today` / `signup_granted`;`CreditLedgerEntry.type` 扩展 `'grant' \| 'spend' \| 'refund' \| 'expire'`;新增 `CreditClaimResponse` |
| `src/api/credit.ts` | API | 新增 `claimDailyCredits()` → `POST /api/credits/daily-claim` |
| `src/store/creditStore.ts` | Store | 新增 `claimed_today` / `signup_granted` / `isClaiming`;新增 `claimDaily()` action(乐观更新 + 失败回滚 + `ALREADY_CLAIMED` 自动同步本地) |
| `src/pages/credit-center/index.tsx` | 页面 | 新增「每日领取」卡(hero 后),根据 `claimed_today` 切换两态;流水按 4 种 type 分别渲染图标 + 文案;FAQ 改写说明新策略 |
| `src/pages/credit-center/index.scss` | 样式 | 新增 `.credit-claim`(渐变 + 按钮 + 已领取态);`.credit-ledger__row-amount` 改成 BEM 修饰符 `--grant / --spend / --refund / --expire` |

**`claimDaily()` 行为约定**:
1. 防重复点击:`isClaiming` 闸控
2. 客户端预检:`claimed_today === true` 直接返回 `{ ok: false, reason: 'ALREADY_CLAIMED' }`(减少服务端压力)
3. **乐观更新**:请求发出前先 set 按钮变 "领取中…",成功后立即更新 `remaining` / `today_used` / `claimed_today`
4. **失败回滚**:catch 时把快照(`remaining / today_used / claimed_today`)写回
5. **服务端二次校验**:服务端返回 `400 ALREADY_CLAIMED`(可能是另一台设备领过)→ 自动同步 `claimed_today = true`,toast 「今日已领取」

**`isClaiming` 闸控 vs `claimed_today` 预检的差异**:
- `isClaiming`:防止用户连点(请求 in-flight),立即返回 `ALREADY_CLAIMING`
- `claimed_today`:防重复领取(已成功),立即返回 `ALREADY_CLAIMED`

**响应码约定**(NextDevTpl 必须遵守):
- `200` → `{ success: true, granted, remaining, message }`
- `400 ALREADY_CLAIMED` → `{ code: 'ALREADY_CLAIMED', message: '今日已领取' }`
- `401 UNAUTHORIZED` → token 过期,小程序跳登录
- `500` → 系统错误,toast "领取失败,稍后再试"

### 3.8 验收清单(积分中心)

- [ ] **新用户注册**:首次登录积分中心,看到「注册赠送 10 积分」流水
- [ ] **首次手动领取**:点「立即领取 +10」→ 余额 +10 → 按钮变为「✓ 今日已领取」(蓝色态)
- [ ] **重复点击**:已领取态下点按钮 → 无反应(disabled)
- [ ] **跨设备同步**:A 设备领取后,B 设备打开看到 `claimed_today = true`(自动同步)
- [ ] **跨日 00:00**:次日打开积分中心 → `claimed_today = false`,按钮恢复可点;流水出现 `expire -3`(昨日未用部分清零)
- [ ] **AI 生图扣分**:生图成功后 → 流水出现 `spend -1`,`remaining` 减少
- [ ] **AI 失败退款**:Meshy 失败 → 流水出现 `refund +1`,`remaining` 恢复
- [ ] **build 通过**:`npm run build:weapp` exit 0
- [ ] **dist 校验**:`dist/pages/credit-center/index.wxss` 含 `.credit-claim` 类;`index.js` 含 `claimDaily` 调用

---

## 四、迁移路径(分 4 阶段)

| 阶段 | 工作 | 时间 | 风险 |
|---|---|---|---|
| **P0** 域名 + HTTPS + baseURL | Vercel 部署 → `api.mooncoda.com`,微信后台配合法域名,改 `.env` | 1 天 | 低 |
| **P0** 认证迁移 | NextDevTpl 加 `/api/auth/miniprogram`,中间件支持 Session + Token | 2 天 | 中 |
| **P1** 积分 ledger 迁 Postgres | NextDevTpl 写 `credit_ledger.ts`,加幂等键 + dead-letter | 3 天 | 中 |
| **P1** AI 生图迁 NextDevTpl | `bff/src/modules/meshy-creative/*` 翻译成 route handler + BullMQ | 2 天 | 低 |
| **P2** 微信支付 | `/api/pay/wechat/*` + `/api/webhooks/wechat-pay`,小程序 `Taro.requestPayment` | 3 天 | 中 |
| **P2** 内容安全 | `/api/upload` 调微信 `img_sec_check` | 0.5 天 | 低 |
| **P3** BFF 退役 | 标 deprecated → 切流量 → 3 个月后删 | - | 低 |

**总计**: ~12 天 ≈ 2.5 周

---

## 五、文件改造清单

### 5.1 NextDevTpl 新增

```
app/
  api/
    auth/miniprogram/route.ts          # 小程序登录
    pay/wechat/create/route.ts         # 微信支付下单
    webhooks/wechat-pay/route.ts       # 微信支付回调
    ai/generate-image/route.ts         # AI 异步创建
    ai/tasks/[taskId]/route.ts         # AI 任务轮询
    upload/route.ts                    # 文件上传(含内容安全)
  middleware.ts                         # Session + Token 双认证
lib/
  credit.ts                             # 积分 ledger
  auth.ts                               # Better Auth 配置(取代 JWT 签发/验签)
  wechat.ts                             # code2Session / access_token
  security.ts                           # img_sec_check
  meshy.ts                              # Meshy HTTP 客户端
workers/
  ai-generate.ts                        # 后台任务处理
prisma/migrations/
  001_credit_ledger.sql
```

### 5.2 小程序端改造

| 文件 | 改动 |
|---|---|
| `.env` | `TARO_APP_API_BASE_URL=https://api.mooncoda.com` |
| `src/api/request.ts` | baseURL 从 `.env` 读取 |
| `src/api/authStore.ts` | loginWithWechat 调 `/api/auth/miniprogram` |
| `src/api/payment.ts` | 新增 `payWithWechat` |
| `src/api/meshyCreative.ts` | URL 改 `/api/ai/generate-image`、`/api/ai/tasks/:id` |

### 5.3 BFF 退役(`mooncoda/bff/`)

| 文件 | 处置 |
|---|---|
| `src/modules/auth/*` | 删除(并入 NextDevTpl) |
| `src/modules/credit/*` | 删除(逻辑迁 NextDevTpl) |
| `src/modules/meshy-creative/*` | 删除(并入 NextDevTpl) |
| 整个 `bff/` 目录 | 标 deprecated → 删 |

---

## 六、验收清单

### 6.1 域名 / HTTPS

- [ ] `api.mooncoda.com` 已 ICP 备案
- [ ] Vercel 绑域名成功,HTTPS 证书自动续期
- [ ] 微信公众平台 `request / uploadFile / downloadFile` 三个合法域名已配
- [ ] 微信开发者工具「不校验合法域名」关闭后,小程序仍能正常请求

### 6.2 认证

- [ ] 小程序 `wx.login` 拿 code → 调 `/api/auth/miniprogram` 拿 token
- [ ] token 持久化到 Taro storage,关闭重开仍在
- [ ] token 过期(7 天)后,自动重新 `wx.login`
- [ ] Web 端 Cookie 登录未受影响
- [ ] `middleware.ts` 同时支持 Session 和 Token,互不串扰

### 6.3 积分账本

- [ ] 用户首次访问 lazy 创建 account
- [ ] 跨日 00:00 自动重置(Asia/Shanghai)
- [ ] 同一 task_id 重试不重复扣(幂等键生效)
- [ ] AI 失败自动 refund,前后端余额一致
- [ ] refund 失败写 dead-letter,不抛业务错误

### 6.4 AI 生图

- [ ] 同步扣分 → 异步任务 → 轮询返回图 URL,全链路 60s 内完成
- [ ] 失败时积分自动回滚
- [ ] task 状态机:`pending → in_progress → succeeded / failed`

### 6.5 微信支付

- [ ] JSAPI 下单 → 小程序唤起支付 → 回调入账
- [ ] 同一 transaction_id 回调多次,只入账一次
- [ ] 支付失败/取消,积分预授权正确撤销
- [ ] Medusa 订单状态与微信支付单号关联可查

### 6.6 内容安全

- [ ] 上传的图片全部过 `img_sec_check`
- [ ] 违规图片返回 400,不入库,提示用户重新上传

### 6.7 BFF 退役

- [ ] 小程序 `.env` 切到 `https://api.mooncoda.com` 后所有功能正常
- [ ] `bff/` 目录 0 流量 30 天后删除

---

## 七、风险与回滚

| 风险 | 概率 | 影响 | 回滚 |
|---|---|---|---|
| Vercel 部署失败 | 低 | 高 | 暂用 BFF,问题修复后重试 |
| 微信回调漏接 | 中 | 高 | 微信后台「补单」接口手动补发 |
| 积分账本数据丢失 | 极低 | 极高 | 每日 Postgres 自动备份 + 异地 |
| Token 泄漏 | 中 | 中 | BA session 7 天有效 + cookieCache 5 分钟窗口 + Bearer 128-bit 熵 |
| Meshy API 限流 | 中 | 中 | 任务队列削峰 + 指数退避重试 |

---

## 八、参考资料

- [Medusa Credit Ledger(实验性)](https://docs.medusajs.com/resources/commerce-modules/credit-ledger)
- [微信小程序登录 code2Session](https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/login/auth.code2Session.html)
- [微信支付 JSAPI 文档](https://pay.weixin.qq.com/wiki/doc/api/jsapi.php)
- [微信内容安全 img_sec_check](https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/sec.checkImg.html)
- [Better Auth 文档](https://better-auth.com)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [BullMQ 任务队列](https://docs.bullmq.io)

---

**文档结束 · 版本 v1.0 · 2026-09-16**
