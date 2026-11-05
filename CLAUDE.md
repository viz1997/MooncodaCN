# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mooncoda is a production-ready Next.js SaaS template. It provides a complete foundation for building SaaS products with authentication, payments, credits system, background job processing, i18n, admin panel, support tickets, and more. Clone, customize, and ship.

**Deployment:** Self-hosted or Vercel + Neon PostgreSQL + Cloudflare R2 (storage)

## 三方系统分工(2026-11-05 更新)

| 系统 | 职责 | 技术栈 |
|---|---|---|
| **NextDevTpl**(本仓库) | AI 生图 SaaS 后端:user / credits / photo / imageJob / AI 路由 / WeChat 小程序登录 **+ 商品目录(商品 / SKU 变体 / 价格)+ 定价 + 购物车 + 订单事实 + 收货地址 + 打印工单(`/quote` 报价 → `print_order`,按 `user_id` 归属,登录后下单;也可以从 `/tools/weight` 直接加进商城购物车,见「打印服务进商城购物车」)** | Next.js 16 + Drizzle + PostgreSQL |
| **微信支付 / 支付宝**(外部服务) | **自己直连的收款通道**:钱直接进我们自己的商户号 / 账户,没有中间层抽成,定价完全由本仓库说了算 | 微信支付 V3 Native(扫码)+ 支付宝电脑网站支付 |
| **Shopify**(外部服务) | **只做银行卡 / Shop Pay 的收银台**。本仓库算出来的价通过**草稿订单**原样传过去(逐分相等),不跟 Shopify 的商品目录 / 运费规则走 | Shopify Admin GraphQL API + 草稿订单 |
| **Sellbase**(独立服务)**过渡期保留** | 旧收款路:Sellbase 建单 + Stripe 付款页。**三个新通道没全部跑通之前一直留着**,跑通后整个 `src/features/sellbase/` 拆掉 | Supabase Edge Functions(**跟本仓库同一个 Supabase 项目**)+ Stripe(MIT) |
| **微信小程序 / 浏览器访客**(外部客户端) | 调 NextDevTpl AI 接口拿候选图 **+ 调 `/api/image-gen/products` 拿商品与 SKU**;调 NextDevTpl `/api/store/**` 加购 + 结算 | Taro 4 + React 18(小程序);Next.js(浏览器) |

**接入形态 = 「本仓库算价,收银台只负责收钱」**(2026-11-05 取代 Sellbase 单通道):
- 本仓库算的价 = `items[].unit_price_amount`;收银台那边只是**载体** + 一个能看懂的标题
- 商城结算:`购物车(DB) → 服务端重算每行价 → 落 storefront_order(_item) → 建支付会话 → 回写 provider_order_id + payment_url(+ 微信的 payment_qr_code_url)→ 前端跳转 / 画码`
- 打印工单:同一套结算 + 同一个 webhook 体系 —— 两条支付链合一
- **逐分相等**:`discountedUnitPriceCents × quantity` == 收银台实际收的金额(阶梯折扣必须「先折单价,再乘数量」)
- 三个新通道的细节见「三个支付通道(2026-11-05)」;旧路的细节见「Sellbase 集成(2026-11-04)」

**NextDevTpl 做的商品目录**(2026-10-21 变更):
- `product` 表 = 商品资料(名称/描述/封面/基础价/上下架),主键复用 `productTypeCode`(R/A/P/RM/LB/M)
- `product_variant` 表 = 真 SKU(`CODE-SIZE-ACCESSORY-VARIANT` + **绝对价** + 上下架)
- 管理后台 `/admin/products`(列表)+ `/admin/products/[code]`(SKU 明细)
- 对外接口 `GET /api/image-gen/products`,在 `ProductCapability` 上**新增** `variants[]` 字段;旧字段(`basePriceCents` / `sizes[].priceDeltaCents` / `accessories[].variants[]`)全部保留,小程序 SDK 运行时零改动
- 种子脚本 `pnpm tsx src/db/seed-products.ts`(幂等,不覆盖 admin 改过的价)
- **仍然不在 DB 里**:`PRODUCT_TYPES`(每个型号的尺寸 / 配件清单)—— 新增型号仍需改 `src/features/gpt-image/lib/product-catalog.ts`

**NextDevTpl 仍做**:`/marketing/*` 静态品牌页(博客 / 文档 / 法律页 / 价格页)+ `/marketing/products` 作品集 showcase(纯静态作品集,与商品目录无关)。

**集成架构详情**:见 `architecture-sellbase-integration.md`(旧路的权威文档)+ `architecture-miniprogram-as-client.md`(项目身份定位)。`architecture-medusa-integration.md` 是 **Medusa 时代的方案稿,结论已作废**。三个新通道的架构写在 CLAUDE.md 的「三个支付通道(2026-11-05)」一节 + 各通道 `providers/*/env.ts` 的文件头。

## Sellbase 集成(2026-11-04,**旧路,过渡期并行**)

> **状态(2026-11-05)**:工作室决定把收款换成「微信 / 支付宝 / Shopify」三个
> 直连通道(见「三个支付通道」)。这一节讲的是**旧路** —— 代码还活着,还跑
> 着,**三个新通道全部跑通之后**整个 `src/features/sellbase/` 连同
> `SELLBASE_*` 环境变量一起拆掉,届时 `stripe` 从 `PaymentChannel` 枚举里
> 删掉,`/api/store/payment-channels` 里那段 `legacyChannel()` 也一起删。

**为什么不是 Medusa**:Medusa v2 要另起一台 server(Node + PostgreSQL + Redis),跟本仓库「SaaS 模板,自托管或 Vercel」的部署形态不合。Sellbase 是 Supabase Edge Functions —— 没有服务器要运维。

**共用同一个 Supabase 项目(2026-11-04)**:Sellbase 装在**本仓库 `DATABASE_URL` 那个 Supabase 项目**里 —— 同一个 `postgres` 库,但**不撞表**:本仓库的表在 `public`,Sellbase 的表全在 `sellbase` schema(Sellbase 自己的迁移 `0000_foundation.sql` 建的)。本仓库连的是 pooler 事务模式(`:6543`),`src/db/index.ts` 的 `isSupabase` 分支负责自签证书的 SSL(URL 里的 `sslmode` 要先剥掉,否则会覆盖掉 `rejectUnauthorized: false`)。连上后身份是 `postgres` + `rolbypassrls = true` —— **能直读 `sellbase.orders`**,但**状态同步仍然只走 webhook**,直读只当对账兜底。

**环境变量**:`NEXT_PUBLIC_SUPABASE_URL` 一个地址覆盖两边(Sellbase 的 API base 自动拼 `/functions/v1/sellbase-api/v1`);`DATABASE_URL` 走 pooler;`SELLBASE_API_TOKEN` / `SELLBASE_WEBHOOK_SECRET` 仍要单独配。

**别在本仓库直接跑 `npx sellbase init`**:它会装 `@sellbase/react` + `@sellbase/admin`、写 `components/sellbase/*`、写 `src/app/admin/[[...path]]/page.tsx`(跟本仓库的 `src/app/[locale]/(admin)/` 打架)、**往 CLAUDE.md 追加托管块**、往 `supabase/migrations/` 塞迁移(跟 Drizzle 那套是两套体系,会抢表)。在空目录跑完,把迁移文件 / Edge Function / token 挑过来。详见 `architecture-sellbase-integration.md` §1.1~1.3。

**三条硬约束**(决定了「本仓库算价,Sellbase 只做收银台」不是权宜之计):
1. Sellbase 的购物车行是 `{variant_id, quantity, booking_slot?}` —— **没有 metadata 字段**,刻字文字 / AI 预览图没地方存
2. Sellbase 的**变体是价格单元**;本仓库的定价矩阵展开 ≈ 13000 个变体
3. 数量阶梯折扣(≥10 减 10%、≥50 减 20%)是**按行数量**算的;Sellbase 的折扣阈值是**购物车总额**级别的,表达不了

**模块布局**(`src/features/sellbase/`):
```
lib/
├── env.ts             # 环境变量 + 优雅降级(缺配置 → 503,不崩下单)
├── client.ts          # admin client 单例(@sellbase/sdk)
├── signature.ts       # webhook 验签(纯函数,可单测)
├── money.ts           # 分 ↔ 店铺币种最小单位
├── carrier.ts         # 本仓库商品 → Sellbase 载体变体
├── events.ts          # webhook 事件 → 本地动作
├── orders.ts          # 建订单 / 换支付链接
├── customer.ts        # sellbase_customer_id 回填
└── webhook-handler.ts # webhook 落库(状态转移已挪到 `features/payments/lib/transitions.ts`)
```

> **状态转移搬走了(2026-11-05)** —— 原来在 `sellbase/lib/storefront-transition.ts`
> 的那套判断现在是 `src/features/payments/lib/transitions.ts`:微信 / 支付宝 /
> Shopify / 旧路**四个通道共用**一份判断(退款只改支付状态、迟到的收款通知
> 不改退款单、幂等)。拆 Sellbase 的时候这个文件**不用搬回去**。

**必须守住的四条**:
- **服务端不信客户端带来的价** —— 结算时按 `metadata` 重算每一行
- **先落本地订单,再建 Sellbase 订单** —— Sellbase 挂了订单还在(状态 `unpaid`),用户能在「我的订单」重取支付链接
- **重建 Sellbase 订单不重算价** —— 用 `storefront_order_item` 里存下来的折后单价
- **地址归属校验在数据层** —— 结算只收 `addressId`,服务端解析,别人的地址查出来是 null

**webhook**:`POST /api/webhooks/sellbase`,验签 `Sellbase-Signature: t=<unix>,v1=<hex HMAC-SHA256("<t>.<raw body>")>`,容差 300 秒,**必须读 raw body**。认不出来的事件一律回 200 忽略(回 4xx 会让 Sellbase 一直重投)。

**订单状态和支付状态是**两列**(2026-11-04):

| 列 | 含义 | 取值 |
|---|---|---|
| `storefront_order.status` | 订单走到哪一步 | `unpaid` / `paid` / `fulfilled` / `cancelled` |
| `storefront_order.payment_status` | 钱到没到、退没退 | `unpaid` / `paid` / `refunded` / `failed` |

**退款只改 `payment_status`,不动 `status`** —— 早先只有一列的时候,退款把订单写成「已取消」,用户看着像没买过,工作室也没法把退款单跟取消单分开。**迟到的 `order.paid` 不能把退过款的单改回「已支付」** —— webhook 会重投,投递顺序不保证,靠 `payment_status === "refunded"` 挡住。判断逻辑在 `src/features/payments/lib/transitions.ts`(纯函数,四个通道共用),`print_order` 用的是同一个口径。

**鉴权口径**:商城路由(`/api/store/checkout`、`/api/store/orders/**`、`/api/store/addresses/**`)认**两种凭据** —— `Authorization: Bearer <token>`(微信小程序)或者 Better Auth 的签名 cookie(浏览器),统一走 `src/lib/auth/request-session.ts` 的 `getSessionFromRequest`。**带了 Bearer 但 token 无效 → 直接 401,不退回 cookie** —— 悄悄换个身份继续跑,等于把「token 过期」变成「换个身份照样能过」。这个 helper 单独一个文件,是因为 `src/lib/auth/bearer.ts` 被 Edge 中间件(`src/proxy.ts`)引用,`better-auth` 绝不能进那个 bundle。

**收货地址的 HTTP 路由**(2026-11-04,小程序侧要用):`GET/POST /api/store/addresses` + `PATCH/DELETE /api/store/addresses/{addressId}`。逻辑跟网页端的 server action 共用 `src/features/address/mutations.ts` ——「默认地址只有一个」那条约束只写了一遍。归属校验在数据层,别人的地址返 404 不是 403(id 能被枚举)。限流桶 `storeAddress` 30 次/分钟。

**环境变量**:`SELLBASE_URL` / `SELLBASE_API_TOKEN`(`mooncoda_live_…`)/ `SELLBASE_WEBHOOK_SECRET` / `SELLBASE_CURRENCY`(默认 `cny`)/ `SELLBASE_FX_RATE`(默认 1)。`.env.example` 被 gitignore,所以说明写在 `src/features/sellbase/lib/env.ts` 文件头。

**迁移脚本**(手写幂等,不走 `db:generate`):
`scripts/apply-sellbase-payment-schema.ts` / `apply-storefront-cart-schema.ts` / `apply-user-address-schema.ts` / `apply-product-catalog-schema.ts` / `sync-sellbase-catalog.ts` / `register-sellbase-webhook.ts` / `bootstrap-sellbase-store.ts`

**Sellbase 自己的迁移在 `supabase/`**(2026-11-04 已推到共享库):`supabase/migrations/0000~0009`(入库)+ 三个 Edge Function(`sellbase-api` / `sellbase-webhooks` / `sellbase-jobs`,**不入库** —— `supabase/functions/` 在 `.gitignore` 里,部署前跑 `pnpm tsx scripts/fetch-sellbase-assets.ts` 从 npm 取回来,版本跟 `@sellbase/sdk` 对齐)。**这个目录只放 Sellbase 的东西** —— 本仓库的表一律走 `scripts/apply-*.ts`,两套迁移体系会抢表。推迁移用 `supabase db push --remote="$DATABASE_URL" --include-all --skip-vault --yes`(`--remote=` 直接给连接串,**不需要** Supabase access token;只有 `functions deploy` 才需要)。`supabase/` 下已建好店铺(CNY / 税率 0)和 admin token(scope = `DEFAULT_AGENT_SCOPES` + `webhooks:write`,不含 `refunds:write`)。

**初始化 2026-11-05 已全部就位**:三个边函数已部署(ACTIVE / `verify_jwt: false`)、admin token 已验证(`GET /v1/store` → 200)、webhook 端点已注册(`https://aimake3d.com/api/webhooks/sellbase`,4 个事件)、目录已同步(Sellbase 7 商品 / 85 变体,`product_variant.sellbase_variant_id` 回填 85 条)、jobs 已接进 pg_cron(vault 里 `sellbase_jobs_url` / `sellbase_jobs_key`)。**还差两件不在本仓库的事**:① Stripe(人工激活 + 付验证费,live key 粘进 Admin → Settings → Payments);② 本仓库部署到 `aimake3d.com` 并在部署环境配好 `SELLBASE_API_TOKEN` / `SELLBASE_WEBHOOK_SECRET`(线上跑的还是旧构建,webhook 端点实测 404)。细节见 `architecture-sellbase-integration.md` §1.4~1.8。

**三个坑(都踩过)**:
- **token 前缀必须是 `mooncoda_live_`,不是 `sb_live_`** —— `sb_` 是 Supabase 自己的 API key 命名空间,Edge 网关在进函数之前就把 `Bearer sb_…` 当 Supabase key 查表,查不到直接 401(`{"message":"Invalid API key"}`,不是 Sellbase 的错误形状)。解法是 `fetch-sellbase-assets.ts` 每次取回 bundle 时把 `BRAND.tokenPrefix` 打一下补丁;前缀唯一定义在 `scripts/lib/sellbase-token.ts`。
- **`@sellbase/sdk` / `@sellbase/core` 是纯 ESM** —— 本仓库没有 `"type": "module"`,`pnpm tsx scripts/*.ts` 走 CJS 解析器,`require()` 直接 `ERR_PACKAGE_PATH_NOT_EXPORTED`。打了两个 pnpm patch(各加一条 `require` 条件,靠 Node 22+ 的 `require(esm)`),在 `patches/` 里,`pnpm-workspace.yaml` 的 `patchedDependencies` 登记。
- **scripts 里的 dotenv 必须先加载** —— `src/db/index.ts` 在模块顶层就查 `DATABASE_URL`,静态 import 比模块体先跑,所以 `import "./lib/load-env"` **必须排 import 列表第一个**,否则 `@/db` 先炸。

**写环境变量**统一走 `scripts/lib/env-file.ts` 的 `upsertEnvVar(path, key, value, {secret})` —— **替换**同名变量而不是追加(追加会出现两个同名变量,dotenv 取哪个取决于顺序,很容易踩「密钥明明配了却读不到」)。

**密钥纪律**:admin token 和 webhook secret **只进环境变量**,绝不进仓库文件、绝不进聊天。Stripe 的「激活账号」「支付验证费」两步是人工操作,live key 粘进 Admin → Settings → Payments 后由 Sellbase 加密存进 Supabase Vault。动钱的操作一律要 `confirm: true` 且会被审计日志记一笔。

## Commands

```bash
pnpm dev              # Dev server (Turbopack)
pnpm build            # Production build
pnpm lint             # Biome lint
pnpm format           # Biome format
pnpm check            # Biome check + autofix
pnpm typecheck        # tsc --noEmit
pnpm typecheck:canvas # tsc --noEmit -p tsconfig.canvas.json (画布模块放宽通道)
pnpm db:push          # Push Drizzle schema to database
pnpm db:generate      # Generate Drizzle migrations
pnpm db:studio        # Open Drizzle Studio GUI
pnpm test             # Vitest (watch mode)
pnpm test:run         # Vitest (single run)
pnpm test:run -- src/test/path/to/file.test.ts  # Run single test file
```

Tests live in `src/test/` (not colocated), run sequentially to avoid DB race conditions, with 30s timeout for integration tests. Test env vars loaded from `.env.test`.

## Tech Stack

- **Framework:** Next.js 16 (App Router only, no `pages/`), React 19, TypeScript (strict, no `any`)
- **Styling:** Tailwind CSS 4, Shadcn/UI, Radix UI, Framer Motion
- **Database:** PostgreSQL (Neon) via Drizzle ORM (edge compatible)
- **Auth:** Better Auth (email/password + Google + GitHub OAuth)
- **Validation:** Zod, React Hook Form, next-safe-action
- **Async Processing:** Inngest (solves Vercel 60s timeout)
- **AI:** OpenAI / DeepSeek / Xiaomi MiMo (switchable via `AI_PROVIDER` env var), optional Cloudflare AI Gateway proxy
- **Storage:** Cloudflare R2 / S3 via `@aws-sdk/client-s3`
- **Payment:** Creem (subscriptions + one-time purchases)
- **Rate Limiting:** Upstash Redis (gracefully disabled when not configured)
- **Logging:** Pino + optional Axiom cloud logging
- **Monitoring:** Optional Sentry integration
- **i18n:** next-intl (locales: `en`, `zh`)
- **Content:** Fumadocs MDX (docs, blog, legal pages)
- **Linting:** Biome (replaces ESLint + Prettier)
- **Package Manager:** pnpm
- **Testing:** Vitest

## Architecture

### Route Groups (`src/app/[locale]/`)

All routes are under `[locale]` for i18n:

- **`(marketing)/`** — Public pages (home, pricing, blog, legal). Layout: Header + Footer.
- **`(dashboard)/`** — Authenticated area (dashboard overview, credits, settings, support). Layout: Sidebar + Topbar. Requires session token in middleware.
- **`(auth)/`** — Sign-in, sign-up, forgot/reset password. Redirects to dashboard if already logged in.
- **`(admin)/`** — Admin panel (users, tickets, stats). Requires admin role.

### API Routes (`src/app/api/`)

- `inngest/route.ts` — Inngest webhook (GET/POST/PUT)
- `upload/presigned/route.ts` — Presigned S3/R2 upload URLs
- `webhooks/creem/route.ts` — Creem payment webhook
- `auth/[...all]/route.ts` — Better Auth catch-all
- `search/route.ts` — Search API
- `jobs/credits/expire/route.ts` — Credits expiration cron

### Feature Modules (`src/features/`)

Each feature is self-contained:
```
src/features/[name]/
├── components/   # UI components
├── actions/      # Server Actions ("use server")
├── hooks/        # Custom React hooks
├── types/        # TypeScript types
└── index.ts      # Public exports
```

Key modules: `credits/`, `payment/`, `subscription/`, `storage/`, `marketing/`, `dashboard/`, `admin/`, `auth/`, `support/`, `settings/`, `mail/`, `shared/`, `blog/`, `analytics/`

### Async Processing (Inngest)

Inngest handles background job processing. A hello-world example function is provided in `src/inngest/functions.ts` as a template for adding custom async workflows. The pattern is: server action sends event → Inngest function processes in background.

### Server Action Tiers (`src/lib/safe-action.ts`)

Three `next-safe-action` client levels:
- **`actionClient`** — Base with logging middleware
- **`protectedAction`** — Adds auth check, provides `ctx.user` and `ctx.userId`
- **`adminAction`** — Adds admin role check on top of protected

Pattern for defining actions:
```typescript
const withFeatureAction = (name: string) =>
  protectedAction.metadata({ action: `feature.${name}` });

export const myAction = withFeatureAction("myAction")
  .schema(zodSchema)
  .action(async ({ parsedInput, ctx }) => { /* ... */ });
```

### Credits System (`src/features/credits/core.ts`)

Double-entry bookkeeping with FIFO batch expiration:
- Every credit movement creates a transaction with debit/credit accounts
- `grantCredits()` — Creates batch + transaction + updates balance
- `consumeCredits()` — FIFO consumption (earliest-expiring batch first)

### Subscription Plans (`src/config/subscription-plan.ts`)

4 tiers (Free, Starter, Pro, Ultra) with per-plan limits on: file size, queue priority, monthly credits. `getUserPlan()` in `src/features/subscription/services/user-plan.ts` maps Creem `priceId` to plan.

### Database Schema (`src/db/schema.ts`)

Uses Drizzle ORM with typed enums. Key tables: `user`, `session`, `account`, `verification`, `subscription`, `creditsBalance`, `creditsBatch`, `creditsTransaction`, `ticket`, `ticketMessage`, `newsletterSubscriber`.

All tables use `text` primary keys with `nanoid()` defaults.

**商城 / 收款相关表**(2026-11-04):

| 表 | 干什么 |
|---|---|
| `product` / `product_variant` | 商品目录(本仓库是真理源);`product_variant.sellbase_variant_id` 是同步到 Sellbase 后的载体变体指针 |
| `cart` / `cart_item` | 购物车落库(cookie `wjp_cart_id`);`cart_item.spec_hash` + `(cart_id, spec_hash)` 唯一索引负责「同规格合并」 |
| `storefront_order` / `storefront_order_item` | 商城订单事实;`status`(订单状态)和 `payment_status`(支付状态)**分两列**;收款相关列:`payment_channel`(这单走哪个通道)、`provider_order_id`(平台侧单号,回调反查)、`payment_qr_code_url`(微信扫码的 `code_url`)、`payment_url`(支付宝 / Shopify 的跳转地址)、`sellbase_order_id`(旧路,唯一索引)、`paid_at` |
| `address` | 收货地址簿 —— **必须留在本仓库**,Sellbase 的 `customer.addresses` 只读,没有创建地址的路由 |
| `print_order` | 打印工单;收款相关列跟商城订单同一套:`payment_status` / `payment_channel` / `provider_order_id` / `payment_qr_code_url` / `payment_url` / `paid_at`(外加旧路的 `sellbase_order_id`);另有交期两列 `delivery_tier` / `delivery_fee_cents`(见「打印工单交期档位」);走商城购物车结算的工单挂 `storefront_order_id`(见「打印服务进商城购物车」) |

`user.sellbase_customer_id`(原 `medusa_customer_id`)只是**加速指针** —— Sellbase 的 customer 按 **email** upsert,真正的 join key 永远是 email。

### Middleware (`src/proxy.ts`)

> Next.js 16 把 `middleware.ts` 改名成了 `proxy.ts` —— 本仓库里是
> `src/proxy.ts`,**没有** `src/middleware.ts`。找不到 `middleware.ts` 不是你走错了
> 地方,是这个版本的框架改了名字。

Handles three concerns in order:
1. **API rate limiting** — Pattern-matched per-route (auth, upload)
2. **Auth protection** — `/dashboard/**`、`/admin/**`、`/quote` require session token cookie, auth routes redirect if logged in
3. **i18n routing** — next-intl locale prefix handling

### AI Provider Abstraction (`src/lib/ai/openai.ts`)

Switchable between OpenAI, DeepSeek, and MiMo via `AI_PROVIDER` env var. Optional Cloudflare AI Gateway proxying. Provides a generic `chatCompletion()` function for LLM calls.

### 包裹支撑算法(检测工具 + 克重工具共用)

`src/features/tools/lib/mesh/support-shell.ts` —— **两个工具算/画的是同一块支撑**:
模型检查工具(`/tools/model-check`)画它,克重工具(`/tools/weight`)按它算克重。

- `prepareSupportModel(positions)` → 焊接 + 拓扑(**姿态无关**,只做一次)
- `rotateSupportMesh(mesh, rotX, rotY, rotZ)` → 刚体旋转顶点与法线(拓扑不变)
- `scaleSupportModel(model, sx, sy, sz)` → 缩放到实际尺寸(只挪顶点,拓扑不变)
- `buildSupportShell(mesh, faceEnclosed, options?, gapScale?)` → 外壳 / 支撑顶面 / 外壁 / 平台投影
- `computeSupportVolume(shell, mesh, options?)` → 按 XY 列(height field)算支撑体积 + 全包裹体积

**旋转口径**:一律「先 X 后 Y 后 Z」(外旋,R = Rz·Ry·Rx)。three.js 里对应
`rotation.order = "ZYX"`(默认的 `"XYZ"` 是 Rx·Ry·Rz,对不上)。摆盘算法
(`angle-optimizer.ts`)、OBJ 导出(`obj-exporter.ts`)、3D 预览(`obj-viewer.tsx`)
三处必须一致,否则画面里的姿态跟算出来的克重对不上。

**支撑体积口径(2026-11-03 重写,跟模型克重对齐)**:

- **按列奇偶配对**:一列(垂直视线)穿过模型表面得到一串 z 交点,相邻两个
  交点之间是模型材料,空出来的那几段才是支撑。老算法假设「列内模型是从下
  边界一直实心到上边界」,宽底座 + 悬空身体会被整段抹掉(支撑少算 3~45 倍)。
- **走真几何**:交点取自 `mesh.vertices`,不是外壳(外壳沿法线外扩过)。
  外壳间隙(对角线 2%,0.8~5mm)只是可视化用的,算进体积会让支撑克重
  系统性高 10~30%。
- **平台在模型最低点下方 5mm**(`SUPPORT_LIFT_MM = 5`):有支撑的时候模型
  不直接贴平台,支撑先在平台上长一层 5mm 托底,模型悬在托底上(工作室的实际
  工艺:5mm 高的支撑块把模型托起来)。所以
  「平台平面」= `mesh.bboxMin[2] - SUPPORT_LIFT_MM`(不是 `shell.groundZ`
  —— 那个还低 0.05~0.1mm 的安全余量,平底模型会凭空多出支撑)。
  平底模型(立方体)的支撑就只剩这 5mm 托底(投影面积 × 5)。
- **底板比模型轮廓外扩 5mm**(`SUPPORT_BASE_MARGIN_MM = 5`):工作室的底板
  不是照着模型轮廓卡着裁,而是往外多留一圈 —— 那圈边也是实心支撑,算进支撑
  克重(冰箱贴留边 5mm 时 43 + 59 = 102g,跟工作室报的一致;留边 0 只有 90g)。
  外扩走**欧氏距离**(距离变换 + 半格修正),不是八邻域(那会切出方角,面积
  跟工作室对不上)。留边是固定 5mm,不跟着模型缩放 —— 缩放 k 倍时底板占地
  不是精确 k²(实测 2.82 倍)。
- **托底是固定的 5mm,不跟着模型缩放**:打印机在平台上长一层 5mm,不是
  模型的一部分。所以均匀缩放 k 倍时,空腔按 k³ 走、托底只按占地 k² 走
  (支撑体积比值 = (2000·k² + 空腔·k³) / 总量,不是精确的 k³)。
  3D 预览里画的托底也必须按实际尺寸 5mm 画(`obj-viewer.tsx` 的支撑壳
  用**缩放后**的几何算,否则画面跟报价对不上)。
- **缩放跑在真几何上**:用户改尺寸后,支撑计算跑在 `scaleSupportModel`
  缩放过的网格(不是原始网格乘系数)—— 非均匀缩放时高度 / 投影 / 悬垂面
  全变,乘系数会让 50mm 高度限制放行立不住的姿态。
- **封闭内腔按几何全包裹计,不区分可达性**(2026-11-04 业务口径):水溶性
  支撑会把内腔灌满(洗的时候一起溶掉),所以整腔体积算支撑材料。奇偶配对
  天然做到这点:内腔是「空出来的那几段」→ 算支撑。
- **掠射列(2026-11-04 修的采样 bug)**:格心正好落在面的边界上(栅格线跟面
  重合,比如内腔壁在 bbox 起点 +0.5mm、栅格 1mm)时,那一列的交点个数会
  多算一个,奇偶配对整体错位 → 这一格被当成空腔 → **支撑系统性地多算
  10~30%**(20mm 空心立方体:8000 vs 真值 7259 mm³,那是 1mm 托底时的数)。
  修法:这种列按两种解释(算 / 不算这个交点)各算一次取平均 —— 一条过格心的
  线把格子切成两半,两种解释各对应半格,平均才是这一格的真实体积。改完
  1mm 栅格下 8897(真值 8859,误差 0.4%),0.5 / 0.25mm 栅格是精确的 8859。
- **兜底是近似,只在封闭网格上严格成立**:交点个数是奇数(开口网格 / 交点
  落单)→ 退回「实心列」估算(按最高的下朝向面 − 平台 − 该列材料);竖直面
  (`|nz| < 1e-3`)不产生交点,只贡献 z 区间。说「逐列严格成立」时得带上
  这个前提。

**三个克重的关系(2026-11-04 改成双密度)**:

- `wrapVolumeMM3`(**全包裹体积**)= 平台到模型顶的整块(支撑 + 模型),
  逐列取「该列模型最高点 − 平台」求和。
- **耗材克重 = 模型体积 × 模型密度**(`materialDensity`)。
- **支撑克重 = 支撑体积 × 支撑密度**(`supportDensity`,默认 **1.28**)。
- **总克重 = 耗材克重 + 支撑克重** —— 这是唯一恒等式。
- **「总克重 = 全包裹体积 × 单一密度」不再成立**:工作室用的是**水溶性
  支撑**(PVA/BVOH,约 1.13~1.30 g/cm³),跟模型材料(光敏树脂等)不是一种
  密度。全包裹那一块里是两种材料,乘不出一个克重来。同理,「支撑克重 =
  全包裹克重 − 模型克重」那个减法也只在两个密度相同时才成立。
- **平台上那 5mm 托底属于支撑**(按支撑密度算),它也在全包裹体积里。
- `SupportParams` 是**双密度**的:`{ modelDensity, supportDensity? }`,
  省略 `supportDensity` = 跟模型同一种材料(老口径)。旧的「填充率」
  「支撑密度」「包裹间隙倍率」全删 —— 支撑是实心的,没有可调的旋钮。
- 页面上三个数是**取整后相加**的(耗材和支撑各自向上取整,总克重 = 两者
  之和),不是各自算好再取整 —— 否则会出现 43 + 53 ≠ 95 这种对不上的情况。
  这个取整是显示层的策略,显示的总克重可能比真实总克重高 1~2 g。

**智能摆盘跑在 Worker 里(2026-11-03)**:

- `src/features/pricing/workers/angle-optimizer.worker.ts` —— 焊接 + 625 个
  候选姿态的支撑搜索都在 Worker 里(单个中等模型主线程要卡 2 秒,大模型
  10 秒打底 —— 页面整块卡死,按钮都点不动)。
- `src/features/pricing/lib/angle-optimizer-client.ts` —— `AngleOptimizerClient`
  客户端(带主线程兜底:Worker 不可用时退回主线程跑,只是会卡)。
- 几何不用来回搬:Worker 内部按 `modelId` 缓存焊接好的模型,主线程只发
  `load` / `pose` / `search` 三类指令。OBJ 的 `positions` 由解析阶段带出来
  (`parseResult.positions`),不用为了摆盘再解析一遍。
- **支撑克重永远跟「当前尺寸 + 当前姿态」走**:改尺寸 / 拖角度都只改这
  一个姿态。没跑智能摆盘时显示的就是**初始角度 (0°,0°)** 的支撑 ——
  模型一进来就有数,不用先摆一次盘。
- **批量模式同一口径**(`batch-processor.ts`):每个条目都算支撑克重 ——
  摆盘过用最优姿态的(支撑更少),没摆盘用**初始角度**的。汇总的「总克重」
  = 耗材克重 + 支撑克重(不再只认 `optimalAngle`)。
- **Worker 不可用时的兜底**:`AngleOptimizerClient.load()` 在 Worker 那边
  失败会自动退回主线程焊接(几何本来就在主线程,焊接才是贵的那个),
  `pose()` / `search()` 也跟着走主线程 —— 数值一样,只是会卡一下。
- **5mm 托底让摆盘偏好「小占地」的姿态**(2026-11-04):托底 = 占地 × 5mm,
  所以占地小的姿态(侧躺 / 立在边缘)比「躺平」更省支撑。测试里的桌子就是
  例子:原姿态 8912 mm³ → 翻过来 2000 → 侧躺 990 mm³,摆盘挑侧躺。
  这是口径的自然结果(占地小 = 支撑材料少),不是 bug;但如果工作室更在意
  表面质量(支撑别贴彩色面),得把 `coloredFaceMask` 传进 `findOptimalAngle`
  —— 目前搜索链路**没有**传,那个「彩色面没被包裹」的次级排序永远不生效。

**支撑克重的姿态标注(2026-11-04)**:

- 克重栏「支撑克重」下面标出这个数是**哪个姿态**的:没跑摆盘是
  「初始角度 0°,0°」,跑完 / 手动微调后是「当前姿态 X {x}° Y {y}°」。
- 智能摆盘结果面板多一行对比:「初始角度 0°,0° 支撑 X g → 当前姿态 Y g」。
  「省 X%」徽标只在真的省下(≥1%)时才出现,省得少就只摆两个数。
- 初始角度只跟尺寸 / 两个密度有关(跟当前角度无关),所以算一次缓存着。
- **支撑克重没有校准面板**(2026-11-04):填充率 / 一键校准全删 —— 支撑是
  实心的,没有可调的旋钮;唯一能调的是**支撑密度**(在「材料参数」弹窗里跟
  模型密度分开填)。
- 「省 X%」的算法在 `src/features/pricing/lib/pose-comparison.ts`
  (纯函数,不碰 React)。

行为由 `src/test/tools/pure/support-shell.test.ts` 守住(几何 + 双密度 +
空腔 + 掠射列),`src/test/pricing/pure/support-initial-angle.test.ts` 守住
(客户端 + 批量汇总),`src/test/pricing/pure/pose-comparison.test.ts` 守住
(省 X% 的算法)。

### 打印工单交期档位(2026-11-05)

打印工单(`/quote` 报价 → `print_order`)有三档交期,**加价按比例收**,不是固定
金额:

| 档位 | 时限 | 比例 | 默认 |
|---|---|---|---|
| `standard` 标准 | 96 小时 | 0 | 不加价 |
| `express` 加急 | 72 小时 | 10% | `PRINT_DELIVERY_EXPRESS_RATE` |
| `urgent` 特急 | 48 小时 | 37% | `PRINT_DELIVERY_URGENT_RATE` |

- **比例是反推出来的**:工作室那张表「48 小时 +¥20.65 / 72 小时 +¥5.58 /
  96 小时 +¥0.00」在**同一个基数(¥55.81)**上,20.65 / 5.58 ≈ 3.70 →
  37% 与 10%(0.37 × 55.81 = 20.65、0.1 × 55.81 = 5.58,两个数都精确复现)。
  工作室调价改环境变量,不改代码。
- **基数是「小计」不是「合计」** —— 小计 = 克重费 + 后处理费 + 支撑费。
  拿合计当基数就是「加价里套加价」,越算越高,而且「明细加起来 = 合计」
  这条恒等式会破。合计 = 小计 + 交期加价(四项)。
- **比例由服务端给,前端只负责预览** —— 报价接口把生效的 `deliveryRates`
  带回来,前端用**同一个** `computeDeliveryFeeCents()` 算三档的预览价,
  所以「页面显示的加价」一定等于「服务端收的加价」。前端不自己认一份比例。
- **档位认不出来一律按标准档**(不按最贵的那档兜底)—— 客户端传
  `"URGENT "`(带空格)不能按特急收费。
- 纯函数在 `src/features/print-quote/lib/delivery-tier.ts`,服务端在
  `quote-server.ts`(`PRINT_QUOTE_CONFIG.deliveryRates`),UI 在
  `components/delivery-tier-picker.tsx`。
- 落库两列:`print_order.delivery_tier`(档位)+ `delivery_fee_cents`(当时
  的绝对金额)—— 比例以后会改,工单上的价不能跟着变。迁移脚本
  `scripts/apply-print-order-delivery-tier-schema.ts`(幂等)。
- 行为由 `src/test/print-quote/pure/delivery-tier.test.ts` 守住。

### 打印服务进商城购物车(2026-11-05)

克重工具(`/tools/weight`)量完之后**可以直接加入购物车**,跟别的商品一起结算。
一次结算同时出 `SO-…`(商城订单)和 `PO-…`(打印工单),钱一次付清。

```
克重工具量出几何 → 服务端报价(同一套接口)
  → 点「加入购物车」→ 模型打包上传 R2(按用户分区)
  → POST /api/store/carts/{id}/line-items(带 printSpec)
  → 服务端**重算**一遍价 → 落购物车
  → 结算 → 同一个事务里落 storefront_order + print_order
```

- **打印服务不是目录商品** —— 它是「来料加工」:用户自带 3D 模型,按克重计价,
  目录里没有对应 SKU。判据是 `metadata.printSpec` 在不在,**不是** `productId`
  (`productId` 是个哨兵值 `service_print_3d`,拿去 `findProductById()` 查不到
  是**预期**的)。共享契约在 `src/features/storefront/lib/print-service.ts`
  (纯文件,客户端和服务端都 import —— 不能在里面 import 服务端模块)。
- **报价在两个页面必须是同一个数** —— `/quote` 和 `/tools/weight` 共用
  `usePrintQuote()`(`src/features/print-quote/hooks/use-print-quote.ts`):
  同样的防抖、同样的「旧响应盖掉新响应」防护、同样的 `quoteFresh` 判定。
  两处各写一遍的话,改了一处忘了另一处就会出现「报价台说 61.18、工具页说
  61.20」。
- **模型只在用户点「加入购物车」那一刻才上传** —— 量重量的过程模型一个字节
  都不出浏览器。上传是加购动作的一部分,不是量重量的副产品。
- **加购要登录** —— 模型要落到 R2,而且工单必须挂在账号名下。未登录时按钮
  变成登录链接(登录态由页面 RSC 查好传下去)。
- **打印服务行恒为一件** —— 一活一模型,没有数量阶梯折扣。购物袋 / 结算页
  不给 +/− 按钮。
- **打印服务行没有封面图** —— 手上是模型文件(一个 zip),不是图片。metadata
  的 `productThumbnail` 是空串,购物袋 / 结算页画一个包裹图标。
- **服务端重建 metadata** —— 客户端带来的标题 / 封面 / handle 一律不采信
  (`buildPrintServiceMetadata()`)。
- **模型归属校验在服务端** —— `isOwnModelUrl(url, objectKey, userId)` +
  `objectExists(objectKey)`:别人的模型、伪造的 URL、指向空对象的链接都不行。
- 落库:`print_order.storefront_order_id`(不是 `sellbase_order_id` —— 整张
  购物车共用**一张** Sellbase 订单,而 `print_order.sellbase_order_id` 是唯一
  索引,挂不上)。迁移脚本
  `scripts/apply-print-order-storefront-link-schema.ts`(幂等)。
- **webhook 标商城订单 paid 时,挂在它下面的工单一起标 paid** —— 钱是整单
  收的,工单还停在「未付款」的话,工作室点「开始生产」会被 `PAYMENT_REQUIRED`
  挡住。判断在 `storefront-transition.ts` 的
  `decideLinkedPrintOrderTransition()`(纯函数),落库在
  `webhook-handler.ts` 的 `syncLinkedPrintOrders()`。
- 行为由 `src/test/storefront/pure/print-service-cart.test.ts`(购物车行的
  判据 / hash / 形状)和 `src/test/sellbase/pure/linked-print-order.test.ts`
  (工单跟着商城订单变)守住。

### 三个支付通道(2026-11-05)

工作室决定把收款从「Sellbase + Stripe 一条路」换成**三个通道**:微信支付、
支付宝、Shopify(银行卡 / Shop Pay)。**微信和支付宝自己直连**(钱直接进我们
自己的商户号 / 账户,没有中间层抽成,定价完全由本仓库说了算),**Shopify 只
承接卡**。旧的 Sellbase + Stripe 那条路**并行保留**,等三个新通道跑通再拆。

#### 通道清单

| 通道 | 收钱方式 | 付款页形态 | 钱去哪 |
|---|---|---|---|
| `wechat` | 微信支付 V3 **Native**(扫码) | 页面留在原地,画二维码 | 我们的微信商户号 |
| `alipay` | 支付宝**电脑网站支付** | 整页跳支付宝 | 我们的支付宝账户 |
| `shopify` | Shopify **草稿订单** | 整页跳 Shopify 收银台 | Shopify 店铺结算账户 |
| `stripe` | **旧路**:Sellbase + Stripe(**过渡期并行**) | 整页跳 Stripe | Stripe → 我们的账户 |
| `offline` | 线下转账 | 没有 —— 工作室后台手动标 | — |

`offline` 不是「线上通道」:它没有支付会话,走的是后台「标记已收款」。

#### 模块布局(`src/features/payments/`)

```
lib/
├── types.ts        # 通道契约(PaymentRequest / PaymentSession / PaymentProvider)+ 两类错误
├── registry.ts     # 通道注册表:getPaymentProvider() / listPaymentChannels()
├── money.ts        # 分 ↔ 元/分(微信要分,支付宝要元)—— 不用浮点
├── settle.ts       # 收款状态落库(四个通道共用一份)
└── transitions.ts  # 状态转移判断(纯函数,零 DB 依赖)
providers/
├── wechat/         # env / native / signature / webhook
├── alipay/        # env / page-pay / sign / query / webhook
└── shopify/        # env / client / draft-order / signature / webhook / order-reference
```

- **通道之间共通的那部分**只有三件:**本仓库算价**、**一次支付会话**、**一次
  收款确认**。通道**不参与定价** —— 折后单价在进通道之前就已经折好了。
- **`settle.ts` 是四个通道共用的** —— 回调长得完全不一样(验签、报文、状态
  字段名都不同),但回调落地之后要做的事是同一件:「这笔钱到了 → 把订单标成
  已付」。只有一份实现,下面那两条规矩才站得住:
  1. **退款只改 `paymentStatus`**,不动 `status`(退款不是订单状态)
  2. **迟到的收款通知不能把退过款的单改回已付** —— 靠
     `paymentStatus === "refunded"` 挡住(webhook 会重投,投递顺序不保证)
- **幂等不靠去重表** —— 「已经是目标状态 → no-op」就够了。重投一次和重投
  十次,结果一样。

#### 逐分相等(Shopify 尤其要紧)

本仓库算出来的每一行单价,必须跟收银台实际收的金额**一分不差**。

- **微信 / 支付宝**天然满足 —— 金额是我们在请求里给的(微信要**分**,支付宝要
  **元**,转换走 `payments/lib/money.ts`,不用浮点)。
- **Shopify 的普通购物车做不到**:Storefront API 的 `CartLineInput`
  **没有价格字段**;改价要 Cart Transform(Plus 套餐);Shopify Scripts 已
  在 2026-06-30 下线。所以走**草稿订单**(`draftOrderCreate`):
  - 行是**自定义行**(`title` + `price` + `quantity`),价格**由我们给**
  - `taxExempt: true` —— 不在我们的总价上再叠一层税
  - 运费也是我们自己给的一行(`shippingLine`),不跟 Shopify 的运费规则走
  - 付完钱 Shopify 把它转成正式订单并发 `orders/paid` webhook
  - **建完立刻回读总额对账** —— 对不上就**大声失败**,不能带着错的价去收钱
  - 也就是说:**不用把商品目录同步过去,也能保证一分钱不差**

#### 三个通道的 webhook

| 通道 | 路由 | 验签 | 成功响应 |
|---|---|---|---|
| 微信 | `POST /api/webhooks/wechat` | 头 `Wechatpay-Signature`,签名串 = `timestamp\nnonce\nrawBody\n` | `200` + `{"code":"SUCCESS"}` |
| 支付宝 | `POST /api/webhooks/alipay` | RSA2(`rsaCheckV1`:**`sign` 和 `sign_type` 都排除**) | `200` + **纯文本** `success` |
| Shopify | `POST /api/webhooks/shopify` | 头 `X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(rawBody, API secret)) | `200` |

- **必须读原始 body** —— 验签对的是字节,不是 `JSON.parse` 之后再序列化回来
  的结果(键序、空格、转义都可能不一样)。微信/支付宝用 `await request.text()`,
  Shopify 用 `await request.arrayBuffer()`。
- **微信回调的 `resource` 是 AES-256-GCM** —— key = APIv3 密钥(32 字节),iv =
  `resource.nonce`,AAD = `associated_data`,密文**最后 16 字节**是 authTag。
- **支付宝只认纯文本 `success`** —— 带引号、多个空格、包成 JSON 一律算失败,
  然后按计划重投(25 小时内最多 8 次)。
- **认不出来的单号一律回 200 忽略** —— 回 4xx 平台会一直重投,把这个端点
  打成噪音源,还会把真正重要的支付事件挤掉。
- **同步回跳不可信** —— 支付宝 `return_url` 上的参数谁都能拼一个出来。「钱
  到了」只认平台主动推过来的通知,而且必须验签。

#### 微信是**扫码**,不是跳转

- 微信 Native 下单拿到的是 `weixin://wxpay/bizpayurl?pr=…`,**不是图片 URL**,
  得自己画成码。
- **画码绝不能交给外部二维码服务** —— 把 `code_url` 传给 `api.qrserver.com`
  之类,等于把这一笔付款的入口交给别人看。用 `qrcode` 包在**浏览器本地**生成
  data URL(`src/features/payments/components/payment-qr.tsx`)。`qrcode` 这个
  包本仓库早就在用了(`features/gpt-image/user/components/share-card.tsx`),
  不新增依赖。
- 结算页 / 支付成功页 / 我的订单 / 打印工单那几处都画码,都**轮询**订单状态,
  钱到了才显示「已支付」。
- **二维码存进 `payment_qr_code_url` 列** —— 用户从「我的订单」里还能再看到码,
  不用重新下单。
- **码只能复用,没有「刷新」这条路** —— `out_trade_no` 在微信侧唯一,同一张单
  再建第二个 Native 会话会被拒(OUT_TRADE_NO_USED)。所以「重新获取付款入口」
  对微信这一支是**把存下来的码再给一次**,不是重建。

#### 通道清单接口

`GET /api/store/payment-channels` 返回现在能用的通道。

- **没配好的通道不显示** —— `available: false` 的前端不渲染。让用户点一个
  注定失败的按钮,比不给这个选项更糟。
- **过渡期多一条旧通道** —— 只要**三个新通道没全部就绪**,就额外返回旧的
  Sellbase + Stripe 那条路;三个都就绪之后它自动消失(界面上就只剩三个支付
  方式)。
- 前端的选择器 `src/features/payments/components/payment-channel-picker.tsx`
  用 `Payment.channels.*` 的 i18n 文案,没有翻译就退回服务端给的中文兜底。

#### 通道没配好 ≠ 这次调用挂了

| 情况 | 重试有用吗 | 用户该做什么 |
|---|---|---|
| `PAYMENT_NOT_CONFIGURED` | ❌ 没用,每次都一样 | 等部署补上配置 / 联系工作室 |
| `PAYMENT_FAILED` | ✅ 有用 | 点「重新获取支付链接」 |

- 分类在 `src/features/storefront/lib/payment-issue.ts` 的
  `classifyPaymentIssue()` —— **纯函数**,能进 `unit` project 跑测试。
- 码是**通道无关**的:早先叫 `SELLBASE_NOT_CONFIGURED` / `SELLBASE_FAILED`,
  现在统一成 `PAYMENT_NOT_CONFIGURED` / `PAYMENT_FAILED`。旧码**不再产出**。
- **重取链接的两个入口**(`ensureStorefrontOrderPaymentLink()` 商城 /
  `ensurePrintOrderPaymentLink()` 工单)都先查通道配好没,通不过就直接回
  `PAYMENT_NOT_CONFIGURED`,不白跑一趟网络。

#### 环境变量

`.env.example` 被 gitignore 挡掉了,所以变量说明写在各自通道的 `env.ts`
文件头里(那几份就是活文档)。**密钥纪律**:所有私钥 / token / secret
**只进环境变量**,绝不进仓库文件、绝不进聊天。

| 通道 | 变量 |
|---|---|
| 微信 | `WECHAT_PAY_MCH_ID` / `WECHAT_PAY_APP_ID` / `WECHAT_PAY_API_V3_KEY`(32 字节)/ `WECHAT_PAY_SERIAL_NO` / `WECHAT_PAY_PRIVATE_KEY`(或 `_PATH`)/ 验签材料 `WECHAT_PAY_PUBLIC_KEY` + `WECHAT_PAY_PUBLIC_KEY_ID` **或** `WECHAT_PAY_PLATFORM_CERT_DIR` / `WECHAT_PAY_NOTIFY_URL`(可省) |
| 支付宝 | `ALIPAY_APP_ID` / `ALIPAY_APP_PRIVATE_KEY`(或 `_PATH`)/ `ALIPAY_PUBLIC_KEY`(**支付宝公钥**,不是应用公钥)/ `ALIPAY_GATEWAY`(可省)/ `ALIPAY_NOTIFY_URL` / `ALIPAY_RETURN_URL`(可省) |
| Shopify | `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ADMIN_ACCESS_TOKEN`(`shpat_…`,要 `write_orders`)/ `SHOPIFY_API_SECRET`(收 webhook 要)/ `SHOPIFY_API_VERSION`(可省) |

#### 迁移脚本

`scripts/apply-payment-channel-schema.ts`(幂等,手写,不走 `db:generate`):

| 表 | 列 |
|---|---|
| `storefront_order` | `payment_channel` / `provider_order_id` / `payment_qr_code_url` |
| `print_order` | `provider_order_id` / `payment_qr_code_url` |

`print_order.payment_channel` 早就有(旧路用的)。`payment_channel` 是 **text**
不是 PG enum(Drizzle 的 `text({enum})` 落到 PG 上就是普通 text 列,加值不用
改列类型)。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/payments/pure/wechat-signature.test.ts` | 签名 / 解密 / 验签 |
| `src/test/payments/pure/alipay-signature.test.ts` | RSA2 签名 / 验签 |
| `src/test/payments/pure/shopify-signature.test.ts` | HMAC 验签 / 草稿单 |
| `src/test/payments/pure/storefront-transition.test.ts` | 状态转移(退款 / 迟到通知) |
| `src/test/payments/pure/linked-print-order.test.ts` | 工单跟着商城订单变 |
| `src/test/storefront/pure/checkout-payment-issue.test.ts` | 「没配好」vs「这次挂了」 |

### Stripe 微信支付 / 支付宝(2026-11-05,**旧路,过渡期保留**)

Sellbase 的 `createCheckout()` 把 `payment_method_types: ["card"]` **写死**
在边函数 bundle 里 —— 没有 store 级配置项,`supportedMethods(country)` 也是
硬编码。想在收银台里出「微信支付 / 支付宝」,只能改 bundle。

- **补丁在 `scripts/fetch-sellbase-assets.ts` 里**(`patchStripePaymentMethods()`),
  每次取回 bundle 都重打一遍 —— 升级 Sellbase 版本不会漏。`--patch-only` 可以
  只重打补丁不重新下载。
- 改两处:`payment_method_types` 扩成 `["card","alipay","wechat_pay"]`,并给
  微信补 `payment_method_options: { wechat_pay: { client: "web" } }`
  (微信在 Checkout Session 里必须显式指定客户端类型,网页跳转是 `web`,
  `mobile` 是给小程序 / App 原生 SDK 的)。
- **支付方式清单可配** —— `SELLBASE_STRIPE_PAYMENT_METHODS` 环境变量,默认
  `alipay,wechat_pay`,设成空串就只留银行卡。**这个变量是「打补丁时」读的**
  (本地跑 `fetch-sellbase-assets.ts` 的时候),不是边函数运行时读的 ——
  清单会被**写死**进 bundle。想改就得改完变量重新取 + 重新部署。
- **Stripe 会拒收账号没开通的支付方式** —— 而且是整个 Checkout Session 建
  不出来(连银行卡也一起挂)。所以**开通 Stripe 账号的支付方式要先于**上线
  带微信/支付宝的 bundle:没开通就等于把银行卡也一起打挂。
- **账号要支持** —— 实测这个香港账号(test key)在 test mode 下 `card` /
  `alipay` / `wechat_pay` 三种都建得出 Session。但**线上还要在 Stripe
  Dashboard 里开通**(Settings → Payment methods)—— 测试模式能用 ≠ 线上能用。
- **`paymentMethodFrom()` 不改** —— bundle 里那个函数把
  `payment_method_types[0]` 映射成 Sellbase 的支付方式名,改了会吐出
  `"alipay"` / `"wechat_pay"` 这种 Sellbase 自己的表可能没有的值(枚举 / CHECK
  约束),webhook 落库会失败 —— **收了钱但没记账**。让它继续报 `"card"`:
  钱走得对,只是 Sellbase 后台看到的支付方式名是「card」。

### 支付链接失败:分清「没配好」和「这次挂了」(2026-11-05)

**线上踩过一次的故障**:`SO-20261105-942D88` 提示「订单已创建,但支付链接生成
失败」,订单落库了但 `sellbase_order_id` / `payment_url` 都是 NULL,Sellbase 那边
**连订单都没有**。

**根因(Vercel 环境变量的快照语义)**:那次请求打到的部署是
`bjb3vvvl2`(构建于 04:51:55Z)—— 正好是 Vercel 触发「新增 Sellbase 环境变量」
后重建的那一次。**环境变量是按部署快照的**:加变量的那一刻触发的构建,快照
里可能还没有那个变量。那次构建里 `SELLBASE_API_TOKEN` / `SELLBASE_URL` 都读
不到 → `getSellbaseConfig()` 抛 `SellbaseNotConfiguredError`。

- **`getSellbaseAdmin()` 在 `createSellbaseOrder()` 的 try **外面** **
  —— 配置错误原样抛上来,没被包成 `SellbaseOrderCreationError`,于是
  「找回孤儿单」那段逻辑(`findSellbaseOrderByNote()`)根本没跑到。表现就是
  Sellbase 里查无此单。
- **结算是「先落本地订单,再建 Sellbase 订单」** —— 所以这次故障的形态是
  「本地订单在、支付链接没有」,订单**没有**丢,钱也**没有**被收走(用户没
  付)。这条设计救了这次事故。
- **修法**:部署环境变量之后**要确认新部署已经生效**再让用户下单。Vercel 上
  加环境变量会触发一次重建,那次构建的产物才是带新变量的。

**代码层面的加固**:光说「生成支付链接失败」不够 —— 「收款通道没配好」和
「这次调用挂了」对用户是两件完全不同的事,前者重试**没用**。

| 情况 | 重试有用吗 | 用户该做什么 |
|---|---|---|
| `PAYMENT_NOT_CONFIGURED` | ❌ 没用,每次都一样 | 等部署补上配置 / 联系工作室 |
| `PAYMENT_FAILED` | ✅ 有用 | 点「重新获取支付链接」 |

- 分类在 `src/features/storefront/lib/payment-issue.ts` 的
  `classifyPaymentIssue()` —— **纯函数**(不碰 DB、不碰网络),才能进 `unit`
  project 跑测试。放在 `checkout.ts` 里的话 import 它就会把 `@/db` 拖进来。
- 码**现在是通道无关的**:早先只有 Sellbase 一条路时叫
  `SELLBASE_NOT_CONFIGURED` / `SELLBASE_FAILED`,现在三个新通道也走同一套
  分类,统一成 `PAYMENT_NOT_CONFIGURED` / `PAYMENT_FAILED`。旧码**不再产出**。
- 结算接口返回体多一个 `paymentIssue` 字段(`null` = 没失败)。前端按它分两种
  话术。
- **重取链接的两个入口都返回这个码** —— `ensureStorefrontOrderPaymentLink()`
  (商城)和 `ensurePrintOrderPaymentLink()`(工单)开头都先查**通道配好没**,
  通不过就直接返回 `PAYMENT_NOT_CONFIGURED`,不再白跑一趟网络。之前这两个
  函数里都有一段**永远返回不到**的 `SELLBASE_NOT_CONFIGURED` 代码 ——
  声明了但没接上,现在接上了。
- 行为由 `src/test/storefront/pure/checkout-payment-issue.test.ts` 守住。

**用户那单怎么救**:线上已经部署了 `POST /api/store/orders/{orderNo}/payment-link`,
`ensureStorefrontOrderPaymentLink()` 会用 `storefront_order_item` 里**存下来的**
折后单价重建一张 Sellbase 订单(**不重算价** —— 用户下单时同意的是那个价),
然后拿到 Stripe 链接。用户去「我的订单」点「重新获取支付链接」就行。

## Coding Conventions

- **Language:** Chinese comments throughout the codebase (code itself in English)
- **Path alias:** `@/*` maps to `src/*`
- **Formatting:** Biome — double quotes, semicolons, trailing commas (ES5), 2-space indent, 80 char line width
- **Lint rules:** `noExplicitAny: error`, `noUnusedImports: error`, `noUnusedVariables: error`, `useImportType: error`
- **Server Components by default** — only add `'use client'` when interactivity is needed
- **Data fetching in RSC** — Server Components call Drizzle directly; mutations use Server Actions
- **i18n navigation** — Import `Link`, `redirect`, `usePathname`, `useRouter` from `@/i18n/routing` (not `next/link` or `next/navigation`)
- **API route wrapping** — Use `withApiLogging(handler)` from `@/lib/api-logger.ts`
- **API route runtime + maxDuration** — Every new route handler in `src/app/api/**/route.ts` MUST explicitly export `runtime` and `maxDuration` (e.g. `export const runtime = "nodejs"; export const maxDuration = 60;`). Vercel default is `10s` (Hobby) / `60s` (Pro) when unset, but the cold-start budget is silently hidden — a route that chains DB + upstream fetch + BA verifyOTP can easily exceed 10s on first invocation. Pick `maxDuration` by IO cost: short CRUD `30`, polling `60-90`, AI generation `120-300`. See `src/app/api/canvas/poll/[jobId]/route.ts:29` for `10s` polling case.
- **Optional services degrade gracefully** — Rate limiting, Axiom logging, Sentry monitoring all check env vars and silently skip when unconfigured

## Environment Variables

See `.env.example` for the full list. Key pattern: only `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and at least one AI provider key are required. Everything else (OAuth, Creem, storage, Redis, Axiom, Sentry) is optional with graceful degradation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Canvas Module (infinite-canvas 融合)

画布编辑器是 infinite-canvas（Vite SPA）整体迁入的"客户端孤岛"，路由在 `src/app/[locale]/(dashboard)/dashboard/canvas/`，模块代码集中在 `src/features/canvas/`。融合细节按设计文件 `D:\下载\infinite-canvas-Mooncoda-fusion-plan.md` 推进。

### 路由 & 边界
- `/dashboard/canvas` —— 项目列表页（`<CanvasProjectList />`）
- `/dashboard/canvas/[projectId]` —— 画布编辑器（`<CanvasEditorClient />`）
- `/dashboard/generate-v2` —— 生图工作台 V2（`<ImageWorkbenchClient />`，来自 infinite-canvas image page）
- `[projectId]/layout.tsx` 用 `fixed inset-0 z-50` 跳出父 layout 的 sidebar，避免被遮
- feature flag：`NEXT_PUBLIC_CANVAS_ENABLED !== "false"` / `NEXT_PUBLIC_GENERATE_V2_ENABLED !== "false"` 才挂载（默认开启）

### Provider 三层套娃
- `CanvasEditorClient`（`src/features/canvas/pages/canvas-editor-client.tsx`）用 `next/dynamic({ ssr: false })` 屏障 SSR（localforage / window 必需）
- 三层 Provider：CanvasI18nProvider（独立 i18next 实例）→ AntdProvider（`@ant-design/cssinjs` 的 `StyleProvider hashPriority="high"`）→ ProjectEditor
- **不要把 AntdProvider 挂到根 layout 或 `[locale]/layout.tsx`** —— antd 6 用 CSS-in-JS，会污染 marketing/auth/admin 页面

### TypeScript 双通道
- `tsconfig.json`（主通道，strict 全开）：`src/app/[locale]/(dashboard)/dashboard/canvas/**` 必须通过主 typecheck
- `tsconfig.canvas.json`（画布通道，关闭 strict / exactOptionalPropertyTypes）：用于检查 `src/features/canvas/**`；命令 `pnpm typecheck:canvas`
- 画布模块源码几乎都是 `// @ts-nocheck`（来自 Vite SPA 原貌），保证主通道通过即可，不必逐个打开

### Webpack 别名与 DefinePlugin
- `motion/react` → `src/features/canvas/components/ui/motion-shim`（motion 12 与 framer-motion 12 是同库不同发布线）
- `radix-ui` → `src/features/canvas/components/ui/radix-ui-shim`（radix-ui umbrella 不在依赖里，原项目用的是 scoped 包）
- `@ant-design/pro-components` → `src/features/canvas/components/layout/pro-components-shim`
- 三个别名同时在 `tsconfig.json` 的 `paths` 注册，避免 IDE 标红
- `next.config.mjs` 加 `DefinePlugin` 把 `import.meta.env.VITE_*` 翻译成 `process.env.NEXT_PUBLIC_*`，未配置返回 `undefined`
- `transpilePackages` 必须包含 antd 6 全家桶（antd/cssinjs/icons + rc-* 系列），否则 CJS 互操作炸

### API 调用方式（Phase 3 待改造）
- 当前 `src/features/canvas/services/api/{image,video,audio,model-plugin}.ts` 用 axios 直接打上游（feishu/lingting/seedance 等），baseUrl 由用户在 UI 配置
- 融合方案第四章要求的 `/api/canvas/generate` 后端代理 + 积分预扣/回滚尚未接入
- 上游产物必须 fetch → R2 → 存 R2 URL（参考 [[gpt-image-feature-build]] 的 persistCandidateToR2 教训，URL-only ≠ 上游 URL）

### Feature flag & env
- `NEXT_PUBLIC_CANVAS_ENABLED` — 默认 `true`，设 `"false"` 整个 `/dashboard/canvas/**` 不可访问
- `NEXT_PUBLIC_DOCS_URL` / `NEXT_PUBLIC_PLUGIN_REGISTRY_URL` — 文档链接与插件注册表（默认走 jsDelivr CDN）
- `NEXT_PUBLIC_ANALYTICS_GA4_ID` / `NEXT_PUBLIC_ANALYTICS_BAIDU_ID` — 分析追踪
- `NEXT_PUBLIC_DEV_PLUGINS` — 本地开发用插件 URL 列表（`env-shim.ts` 的 `VITE_DEV_PLUGINS` 读取）
