# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mooncoda is a production-ready Next.js SaaS template. It provides a complete foundation for building SaaS products with authentication, payments, credits system, background job processing, i18n, admin panel, support tickets, and more. Clone, customize, and ship.

**Deployment:** Self-hosted or Vercel + Neon PostgreSQL + Cloudflare R2 (storage)

## 三方系统分工(2026-11-05 更新)

| 系统 | 职责 | 技术栈 |
|---|---|---|
| **NextDevTpl**(本仓库) | AI 生图 SaaS 后端:user / credits / photo / imageJob / AI 路由 / WeChat 小程序登录 **+ 商品目录(商品 / SKU 变体 / 价格)+ 定价 + 购物车(`/cart`)+ 订单事实 + 收货地址 + 打印工单(打印前工作台 `/tools/workbench` 量 → 「加入打印单」→ 打印单 `/print-order` → `print_order`,按 `user_id` 归属,登录后下单;报价台 `/quote` 已删,只留重定向;打印服务**不走商城购物袋**,见「打印服务走「打印单」」)** | Next.js 16 + Drizzle + PostgreSQL |
| **微信支付 / 支付宝**(外部服务) | **自己直连的收款通道**:钱直接进我们自己的商户号 / 账户,没有中间层抽成,定价完全由本仓库说了算。**代码写好了,商户号 / 应用还没走完开通流程** —— 界面上摆出来但选不了(见「两个支付通道」的两道闸) | 微信支付 V3 Native(扫码)+ 支付宝电脑网站支付 |
| **Shopify**(外部服务)**已下线** | 曾经只做银行卡 / Shop Pay 的收银台(草稿订单,逐分相等)。2026-11-05 工作室决定只用微信 + 支付宝,**不再接新单** —— 代码留着给老单用,整目录待拆 | Shopify Admin GraphQL API + 草稿订单 |
| **Sellbase**(独立服务)**过渡期保留** | 旧收款路:Sellbase 建单 + Stripe 付款页。**不再接新单**(已建好的旧单还能重取支付入口)。两个新通道跑通后整个 `src/features/sellbase/` 拆掉 | Supabase Edge Functions(**跟本仓库同一个 Supabase 项目**)+ Stripe(MIT) |
| **微信小程序 / 浏览器访客**(外部客户端) | 调 NextDevTpl AI 接口拿候选图 **+ 调 `/api/image-gen/products` 拿商品与 SKU**;调 NextDevTpl `/api/store/**` 加购 + 结算 | Taro 4 + React 18(小程序);Next.js(浏览器) |

**接入形态 = 「本仓库算价,收银台只负责收钱」**(2026-11-05 取代 Sellbase 单通道):
- 本仓库算的价 = `items[].unit_price_amount`;收银台那边只是**载体** + 一个能看懂的标题
- 商城结算:`购物车(DB) → 服务端重算每行价 → 落 storefront_order(_item) → 建支付会话 → 回写 provider_order_id + payment_url(+ 微信的 payment_qr_code_url)→ 前端跳转 / 画码`
- 打印工单:同一套结算 + 同一个 webhook 体系 —— 两条支付链合一
- **逐分相等**:`discountedUnitPriceCents × quantity` == 收银台实际收的金额(阶梯折扣必须「先折单价,再乘数量」)
- 两个新通道的细节见「两个支付通道(2026-11-05)」;旧路的细节见「Sellbase 集成(2026-11-04)」

**NextDevTpl 做的商品目录**(2026-10-21 变更):
- `product` 表 = 商品资料(名称/描述/封面/基础价/上下架),主键复用 `productTypeCode`(R/A/P/RM/LB/M)
- `product_variant` 表 = 真 SKU(`CODE-SIZE-ACCESSORY-VARIANT` + **绝对价** + 上下架)
- 管理后台 `/admin/products`(列表)+ `/admin/products/[code]`(SKU 明细)
- 对外接口 `GET /api/image-gen/products`,在 `ProductCapability` 上**新增** `variants[]` 字段;旧字段(`basePriceCents` / `sizes[].priceDeltaCents` / `accessories[].variants[]`)全部保留,小程序 SDK 运行时零改动
- 种子脚本 `pnpm tsx src/db/seed-products.ts`(幂等,不覆盖 admin 改过的价)
- **仍然不在 DB 里**:`PRODUCT_TYPES`(每个型号的尺寸 / 配件清单)—— 新增型号仍需改 `src/features/gpt-image/lib/product-catalog.ts`

**NextDevTpl 仍做**:`/marketing/*` 静态品牌页(博客 / 文档 / 法律页 / 价格页)+ `/marketing/products` 作品集 showcase(纯静态作品集,与商品目录无关)。

**集成架构详情**:见 `architecture-sellbase-integration.md`(旧路的权威文档)+ `architecture-miniprogram-as-client.md`(项目身份定位)。`architecture-medusa-integration.md` 是 **Medusa 时代的方案稿,结论已作废**。两个新通道的架构写在 CLAUDE.md 的「两个支付通道(2026-11-05)」一节 + 各通道 `providers/*/env.ts` 的文件头。

## Sellbase 集成(2026-11-04,**旧路,过渡期并行**)

> **状态(2026-11-05)**:工作室决定把收款换成「微信 / 支付宝」两个直连通道
> (见「两个支付通道」)。这一节讲的是**旧路** —— 代码还活着,但
> **新单已经不走它了**(结算传 `stripe` 直接 503;`/api/store/payment-channels`
> 也不再返回那条旧通道,那段 `legacyChannel()` 已删)。留着它是为了让**已经
> 建好的旧单**还能重取支付入口。**两个新通道全部跑通之后**整个
> `src/features/sellbase/` 连同 `SELLBASE_*` 环境变量一起拆掉,届时
> `stripe` 从 `PaymentChannel` 枚举里删掉。

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
> Shopify / 旧路**这四条路共用**一份判断(退款只改支付状态、迟到的收款通知
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

**退款只改 `payment_status`,不动 `status`** —— 早先只有一列的时候,退款把订单写成「已取消」,用户看着像没买过,工作室也没法把退款单跟取消单分开。**迟到的 `order.paid` 不能把退过款的单改回「已支付」** —— webhook 会重投,投递顺序不保证,靠 `payment_status === "refunded"` 挡住。判断逻辑在 `src/features/payments/lib/transitions.ts`(纯函数,各通道共用),`print_order` 用的是同一个口径。

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
  - `scripts/` 里的脚本用 `import "./lib/load-env";`;**`src/db/` 里的两个 seed**
    (`seed-products.ts` / `seed-product-accessory-variants.ts`)用
    `import "../../scripts/lib/load-env";` —— 路径不同,道理一样
  - **只有真连库的脚本才需要**。`scripts/apply-currency-schema.ts` 自己
    在模块体里加载 dotenv + 用 `pg` 直连,不 import `@/db`,所以它不受这条约束

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
| `cart` / `cart_item` | 车落库(**两张车一张表**:商城购物袋 `kind = "storefront"` / 打印单 `kind = "print"`,cookie 分别是 `wjp_cart_id` / `wjp_print_cart_id`);`cart_item.spec_hash` + `(cart_id, spec_hash)` 唯一索引负责「同规格合并」 |
| `storefront_order` / `storefront_order_item` | 商城订单事实;`status`(订单状态)和 `payment_status`(支付状态)**分两列**;收款相关列:`payment_channel`(这单走哪个通道)、`provider_order_id`(平台侧单号,回调反查)、`payment_qr_code_url`(微信扫码的 `code_url`)、`payment_url`(支付宝 / Shopify 的跳转地址)、`sellbase_order_id`(旧路,唯一索引)、`paid_at` |
| `address` | 收货地址簿 —— **必须留在本仓库**,Sellbase 的 `customer.addresses` 只读,没有创建地址的路由 |
| `print_order` | 打印工单;收款相关列跟商城订单同一套:`payment_status` / `payment_channel` / `provider_order_id` / `payment_qr_code_url` / `payment_url` / `paid_at`(外加旧路的 `sellbase_order_id`);另有交期两列 `delivery_tier` / `delivery_fee_cents`(见「打印工单交期档位」);走打印单结算的工单挂 `storefront_order_id`(见「打印服务走「打印单」」) |

`user.sellbase_customer_id`(原 `medusa_customer_id`)只是**加速指针** —— Sellbase 的 customer 按 **email** upsert,真正的 join key 永远是 email。

### Middleware (`src/proxy.ts`)

> Next.js 16 把 `middleware.ts` 改名成了 `proxy.ts` —— 本仓库里是
> `src/proxy.ts`,**没有** `src/middleware.ts`。找不到 `middleware.ts` 不是你走错了
> 地方,是这个版本的框架改了名字。

Handles three concerns in order:
1. **API rate limiting** — Pattern-matched per-route (auth, upload)
2. **Auth protection** — `/dashboard/**`、`/admin/**` require session token cookie, auth routes redirect if logged in(`/quote` 2026-11-06 摘掉 —— 它现在只是个重定向到公开的 `/print-order`)
3. **i18n routing** — next-intl locale prefix handling

### AI Provider Abstraction (`src/lib/ai/openai.ts`)

Switchable between OpenAI, DeepSeek, and MiMo via `AI_PROVIDER` env var. Optional Cloudflare AI Gateway proxying. Provides a generic `chatCompletion()` function for LLM calls.

### 包裹支撑算法(检查视角 + 克重视角共用)

`src/features/tools/lib/mesh/support-shell.ts` —— **两个视角算/画的是同一块支撑**:
打印前工作台(`/tools/workbench`)的「检查」视角画它,「克重」视角按它算克重。

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
- **画出来的那圈跟算进去的那圈是同一圈(2026-11-07)**:检查视角画的「包裹
  支撑」原先只画模型轮廓(平台投影),**没画底板留边那一圈** —— 克重那边算
  进去了,画面上没有。两个视角并排看,这个差看得出来。修法:把
  `computeSupportVolume` 里那套栅格化抽成 `rasterizeFootprint()`,两边共用
  **同一份栅格**(原点 / 栅格尺寸 / 留边),`buildBasePlateRing()` 在同一张栅格
  上做欧氏距离外扩,把「外扩了但没被模型覆盖」的格子发出来 —— 画出来的
  那一圈跟算进克重的底板占地**逐格相同**。`includeBaseRing` **默认关**:
  摆盘搜索一次要建 625 个外壳,每个都做一遍外扩太贵,只在真要画的那两条路
  (检查视角 / 克重视角)打开。留边宽度两处都跟随后台
  (`/admin/print-pricing` 的 `supportBaseMarginMm`)。
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

**模型文件的单位:坐标不是毫米的时候(2026-11-06)**

> **这一段是踩过坑之后加的** —— 用户拿一个 Meshy 导出的模型来量,
> 屏幕上「支撑比例 686161%」,整个模型泡在一根比它还高的支撑柱里。

- **工具把模型坐标当成毫米**(`obj-parser.ts` 的 `// dimensions in mm
  (assuming OBJ is in mm)`)。但 AI 生成(Meshy)、Blender 默认导出的文件,
  坐标是**归一化的**(±1),不是毫米。
- **托底 5mm 是固定的毫米值**,不跟着模型缩放 → 平台被拉到模型下面 5 个
  **单位** → 支撑比模型本身还高 → 耗材克重 0.001 g、支撑比例几万倍
  (实测比雄小狗 56,868%、猫 51,929%)。**页面上看不出任何异常** ——
  数字都「有」,就是离谱。
- **判据在 `src/features/pricing/lib/model-units.ts` 的
  `detectModelUnitScale()`** —— 看**最大边**:≥ 10mm 就算毫米(不动它),
  < 10mm 判成「坐标不是毫米」。用最大边不用最小边,是为了让**扁平模型**
  (冰箱贴 40×40×2mm)留在「按毫米算」那一档。
- **归一化到最大边 100mm**(`ASSUMED_MAX_EXTENT_MM`)—— 只是一个**起点**,
  用户可以在尺寸面板里改成实际尺寸,改完支撑 / 克重 / 报价一起重算。
- **三个地方都要归一化,规则只有一份**:
  | 位置 | 怎么接 |
  |---|---|
  | 克重工具 `pricing-calculator.tsx` | 载入时判定 → 设 `dimMode="custom"` + 缩放因子 → 面板上挂横幅 + 「改回原始尺寸」 |
  | 批量模式 `batch-processor.ts` | 批量**没有尺寸调节**,用户没法自己纠 → 每个文件各自判定,缩放系数接到 `client.search/pose` 的 `scales` |
  | 检查视角 `model-check-panel.tsx` | **归一化的是顶点本身**,视口画的模型 / 分析器 / 支撑外壳在同一个坐标系 —— 否则两个视角画的支撑不是同一个 |
- **横幅不是可选项** —— 工具替人改了尺寸,就得告诉人。克重工具的横幅上带
  「改回原始尺寸」按钮(用户坚持把文件里的数字当毫米时用)。
- **退化输入不动它** —— 某一轴是 0 / NaN 的文件**不缩放**(缩了就是在给
  坏文件编数字)。
- 行为由 `src/test/pricing/pure/model-units.test.ts` 守住(判定 + 真几何:
  归一化后支撑比例回到个位数百分比)。

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
(省 X% 的算法),`src/test/pricing/pure/model-units.test.ts` 守住(单位判定 +
归一化之后支撑比例回到正常量级)。

### 币种:人民币,只有一处定义(2026-11-05)

本仓库的价**一律人民币**(CNY)。2026-11-05 短暂改成过美元,当天又改回来了
—— 收款通道(微信支付 / 支付宝)是**境内商户**,收人民币是它们的原生场景;
走美元就得先开跨境资质,还要多一道换算,平白多出汇率风险。

- **币种只有一处定义** —— `src/config/currency.ts` 的 `PRICE_CURRENCY`
  (零依赖的纯常量文件,客户端 bundle 也能 import)。别的地方**不许**再写
  一遍 `"USD"` / `"CNY"`。`PRICE_REGION_ID` 也是同一处("china")。
- **金额一律是整数分** —— 展示走全仓库唯一的入口 `src/lib/money.ts` 的
  `formatCents(分, { locale })`。以前商城那个收「元」的 `formatPriceCNY`
  已经删了(两套单位混用出来的「差 100 倍」在页面上看不出来,只在对账时炸)。
- **定价常量**在 `src/features/storefront/lib/pricing-constants.ts`
  (刻字 ¥3 / 加急 ¥15 / 运费 ¥8 / 免运费门槛 ¥99);**商品基础价**
  在 `src/features/gpt-image/lib/product-catalog.ts` 的 `BASE_PRICE_CENTS`
  (钥匙扣 ¥19 / 异性钥匙扣 ¥24 / 冰箱贴 ¥39 / 相框 ¥49 / 皮革徽章 ¥59 /
  手办 ¥199)。**尺寸阶梯 ¥5/档、配件加价、刻字费、加急费** 全在这两个
  文件里。
- **两个通道都收人民币** —— 微信 / 支付宝的请求里带的是 `PRICE_CURRENCY`。
  微信那边**境内商户本来就收人民币**,不用开跨境资质。
- **不换算** —— 代码里**没有汇率**。旧的 `SHOPIFY_FX_RATE` 写法已经被否掉
  了(Shopify 那条路也下线了,见「两个支付通道」)。
- **迁移脚本**(幂等,手写,不走 `db:generate`):
  `scripts/apply-currency-schema.ts` —— 改三张表的列默认值、按代码里的
  字典**重新定价**商品目录三张表、把在途购物车改成 CNY/china。
  **币种从 `@/config/currency` 读**,脚本里不写死 —— 改币种漏了这个脚本
  就会变成「代码是人民币、DB 默认值是美元」,那种错位不会报错,只在结账
  的时候炸。**历史订单一行不动**(旧单收的就是它当时收的币种,改了等于
  篡改账本);脚本会把还没付的旧单数量打出来,要不要取消是工作室的决定。
  跑完再补一遍 seed:`pnpm tsx src/db/seed-product-accessory-variants.ts` +
  `pnpm tsx src/db/seed-products.ts`。
- **不在这个范围内**:AI 生图的**积分 / 模型成本**那一套
  (`features/image-gen/lib/generation-service.ts` 的「1 积分 = 0.001 CNY」、
  admin 里的模型价格、`features/mooncoda/**`)—— 那是另一个钱的世界,跟着
  积分制走,不是商品价。别把它跟商品价混在一起改。同理,模板自带的
  **Creem 订阅**(`src/config/payment.ts` 的 `currency: "USD"`)也是另一个
  收款系统,跟着订阅套餐走。

### 打印工单交期档位(2026-11-05)

打印工单(`/tools/workbench` 量 → 打印单 `/print-order` → `print_order`)有三档
交期,**加价按比例收**,不是固定金额:

| 档位 | 时限 | 比例 | 默认 |
|---|---|---|---|
| `standard` 标准 | 96 小时 | 0 | 不加价 |
| `express` 加急 | 72 小时 | 10% | `PRINT_DELIVERY_EXPRESS_RATE` |
| `urgent` 特急 | 48 小时 | 37% | `PRINT_DELIVERY_URGENT_RATE` |

- **比例是反推出来的**:工作室那张表「48 小时 +¥20.65 / 72 小时 +¥5.58 /
  96 小时 +¥0.00」在**同一个基数(¥55.81)**上,20.65 / 5.58 ≈ 3.70 →
  37% 与 10%(0.37 × 55.81 = 20.65、0.1 × 55.81 = 5.58,两个数都精确复现)。
  工作室调价改环境变量,不改代码。**比例跟币种无关** —— 收的是「小计的
  百分之多少」,37% / 10% 这两个数在任何币种下都成立(换个币种时比例一个字
  都不用改,只要基数跟着换)。
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

### 打印服务走「打印单」(2026-11-06)

工作室的原话:**「模型打印是不走商城正常的购物车的,而是走打印下单,即展示
打印列表和下单金额」**。

所以打印服务有**另一张车**、**另一个页面** —— 商城购物袋(`/cart`)、购物袋
抽屉、`/checkout` 里**一行打印服务都不会出现**;打印单(`/print-order`)里
**一行目录商品都不会出现**。

```
工具页 /tools/workbench:选模型 → 量克重(几何全在浏览器里算)
  → 点「加入打印单」→ 模型打包上传 R2(按用户分区)
  → POST /api/store/print-carts/{id}/line-items(带 printSpec)
  → 服务端**重算**一遍价 → 落打印单
  → 打印单 /print-order:打印列表 + 交期档位 + 下单金额 + 收货地址
  → 提交 → 同一个事务里落 storefront_order + print_order → 一次付款
```

> **报价台(`/quote`)2026-11-06 整页删掉**,只留一个重定向到 `/print-order`。
> 以前是「报价台 → 加入打印单」,现在是**工具页 → 加入打印单**,少一跳。

#### 两张车,一张表

| | 商城购物袋 | 打印单 |
|---|---|---|
| 车的性质 | `cart.kind = "storefront"` | `cart.kind = "print"` |
| cookie | `wjp_cart_id` | `wjp_print_cart_id` |
| query key | `["store","cart"]` | `["store","print-cart"]` |
| 接口 | `/api/store/carts/**` | `/api/store/print-carts/**` |
| 装什么 | 目录商品 | 打印服务(自带模型) |
| 页面 | `/cart` / 抽屉 / `/checkout` | `/print-order` |
| 运费 | ¥8,小计到 ¥99 免 | **没有**(价就是报价本身) |

- **同一张 `cart` 表,靠 `kind` 列区分** —— 迁移脚本
  `scripts/apply-print-cart-schema.ts`(幂等;`kind` 默认 `'storefront'`,
  老的购物车**一行不动**)。
- **规则在数据层** —— `cart-store.ts` 的 `addLineItem()` 里
  `assertLineAllowedInCart()`:绕过界面的直接调 API 也进不去。纯函数版本在
  `storefront/lib/cart-kind.ts`(客户端 / 服务端共用一份判定,别再写第二遍)。
- **读车时按性质过滤** —— `toCart()` 里 `isLineAllowedInCart()`。老购物车里
  可能混着打印服务行(2026-11-05 那版留下的),那些行**还在库里**,只是不再
  出现在商城购物袋里。
- **`kind` 认不出来一律当商城购物袋** —— 反过来兜底(当成打印单)的话,老车
  里的目录商品行会**全部被滤掉**,用户的购物袋凭空消失。
- **两个 cookie 不能混** —— 结算按 `cartKind` 选车,车本身永远从 cookie 取
  (客户端指定 id 就能拿别人的车去结算)。

#### 打印单页摆三样东西

1. **打印列表** —— 每个模型一行:尺寸、耗材 / 支撑克重、交期档位、单价、删
   一行。交期档位用 `DeliveryTierPicker`(一份 UI、一套 i18n 文案,工具页
   加进来时是标准档,用户在打印单上改)。
2. **下单金额** —— Σ 每行的报价(**没有运费**)。
3. **提交打印单** —— 一次付款,钱到了才开工单。

- **付款那一块跟商城结算共用一份** —— `CheckoutPaymentPanel`
  (`storefront/components/checkout-payment-panel.tsx`),只是 `cartKind` 不同。
- **结算时仍然是「一张商城订单 + N 张工单 + 一次付款」** —— `checkout()`
  在**同一个事务**里落 `storefront_order` + `print_order`,工单靠
  `print_order.storefront_order_id` 关联。webhook 标商城订单 paid 时,挂在
  它下面的工单一起标 paid(`payments/lib/settle.ts` 的
  `syncLinkedPrintOrders()`)。那一列由迁移脚本
  `scripts/apply-print-order-storefront-link-schema.ts`(幂等)加。
- **打印单没有运费,规则只有一处** ——
  `pricing-constants.ts` 的 `shippingCentsForCart(kind, subtotal)`:打印单恒
  为 0。客户端(购物袋页 / 打印单页)和服务端(`checkout.ts`)**用同一份** ——
  两处各写一遍就会出现「页面没运费、结算收了一笔」。打印服务的价就是报价
  本身:打印单显示多少、工单上写多少、实际收多少,是同一个数(见
  `print-quote/lib/payment.ts`:工单的支付金额恒等于 `total_price_cents`)。
- **加价摆出来靠服务端回填** —— 服务端重算报价时把 `deliveryFeeCents` /
  `deliveryRates` 填进 `printSpec`(见 `cart-store.ts` 的
  `repriceLineItem()`),客户端据此反推「不含加价的小计」,于是三档的加价
  (「48 小时 +¥20.65」)在点加急之前就摆出来。只影响展示,不参与定价。
- **打印服务行恒为一件** —— 一活一模型,没有数量阶梯折扣。打印单不给 +/−
  按钮。
- **打印服务行没有封面图** —— 手上是模型文件(一个 zip),不是图片。metadata
  的 `productThumbnail` 是空串,打印单画一个包裹图标。
- **服务端重建 metadata** —— 客户端带来的标题 / 封面 / handle 一律不采信
  (`buildPrintServiceMetadata()`)。
- **模型归属校验在服务端** —— `isOwnModelUrl(url, objectKey, userId)` +
  `objectExists(objectKey)`:别人的模型、伪造的 URL、指向空对象的链接都不行。
- 判据是 `metadata.printSpec` 在不在,**不是** `productId`(`productId` 是个
  哨兵值 `service_print_3d`,拿去 `findProductById()` 查不到是**预期**的)。
  共享契约在 `src/features/storefront/lib/print-service.ts`(纯文件,客户端
  和服务端都 import —— 不能在里面 import 服务端模块)。
- **价格只在服务端一处算** —— 工具页(`/tools/workbench`)**不显示价格**;它只
  把几何数据(体积 / 表面积 / 尺寸 / 支撑克重)作为 `printSpec` 抛给服务端,
  价由服务端重算(`print-quote/lib/quote-server.ts`)。要改价格口径,只改
  服务端那一处。
- **模型只在用户点「加入打印单」那一刻才上传** —— 量重量的过程模型一个
  字节都不出浏览器。上传是加购动作的一部分,不是量重量的副产品。

#### 工具页的出口是「加入打印单」(2026-11-06)

- 工具页(`/tools/workbench`)下方那张「加入打印单」卡片就是出口 —— 点下去上传
  模型、落打印单,然后跳 `/print-order` 确认金额再提交。
- **卡片按登录态分两种**:未登录是「去登录」(跳登录页,带 `callbackUrl`
  回工具页);已登录是「加入打印单」。登录态由页面 RSC 查好传下去。
- **打开工具页不会建空打印单** —— `usePrintCart({ enabled: false })`。
  真的点了「加入打印单」才去要那张车(否则每个访客都留一行 DB + 一个
  cookie)。
- **必须先登录再量** —— 加购接口要 session(401 `AUTH_REQUIRED`),而登录完
  回来是**整页跳转**(`sign-in-form.tsx` 走 `window.location.href`),内存里
  那个模型选不回来。所以登录得放在量之前 —— 卡片上就是这么写的,别再搞
  「量完再登录,登录后把模型带回来」那套接力(接力模块
  `print-quote/lib/model-handoff.ts` 已经删掉)。
- **交期档位在打印单上选** —— 工具页加进来时一律标准档,用户在打印单那
  一行上改。
- **旧路(直接提交订单)留着但界面上不走** ——
  `order-form.tsx` / `order-created-card.tsx` / `POST /api/print-orders` 都
  还在树里。两个出口会让用户不知道钱付到哪儿去了,而且旧路**不收收货地址**
  (只有称呼 + 电话)—— 工作室照着单子寄不出去。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/storefront/pure/cart-kind.test.ts` | 两张车的判定 / 兜底方向 / 放错车的话术 |
| `src/test/storefront/pure/print-cart-totals.test.ts` | 打印单**没有运费**,合计 = 小计 |
| `src/test/storefront/pure/print-service-cart.test.ts` | 打印服务行的判据 / hash / 形状 + 工具页传出来的几何原样搬运 |
| `src/test/storefront/pure/cart-totals.test.ts` | 商城购物袋的金额口径(折扣落在单价上) |
| `src/test/sellbase/pure/linked-print-order.test.ts` | 工单跟着商城订单变 |

### 商城购物袋详情页 `/cart`(2026-11-06)

购物袋之前只有一个**抽屉**(滑进来、看看、改数量、关掉)。想看清「我到底买
了什么、每件多少钱、折扣省了多少、运费怎么算」得在抽屉里一行一行翻。

`/cart` 是抽屉的**摊开版**:同样的数据、同样的口径,一屏看完,改数量 / 删
行都在页面上直接做,底下是金额明细,右上角去结算。

- **金额不在页面里算** —— 每个数都是服务端算好传进来的
  (`discountedUnitPriceCents` 那一列),客户端只做加总。口径跟结算页共用
  `storefront/lib/cart-totals.ts` 的 `computeCartTotals()`,所以「购物袋里
  看到的合计」跟「结算页要收的合计」是同一个数。
- **缓存优先,服务端那份兜底** —— `useCart()` 是活的真相(改数量 / 删行走
  的是它,抽屉里改了这页也跟着变);`initialCart` 是首屏,缓存还没回来的那一
  瞬间用它,用户不会看到「空的购物袋」闪一下。
- **这一页只有目录商品** —— 打印服务走自己的打印单(`/print-order`)。
- 页面在 `(marketing-atelier)` 组(跟 `/checkout` 一条路)—— 商城这一套
  (`/cart` / `/checkout` / 购物袋抽屉)共用商城的头部 + 抽屉。**打印单
  (`/print-order`)不在这一组**(它在 `(marketing)`,打印服务自己的页面)。

### 模型从工具页直接进打印单(2026-11-06)

打印服务对外只有两页:**工具页**(`/tools/workbench`,量克重)和**打印单**
(`/print-order`,下单)。报价台(`/quote`)整页删掉,只留一个重定向到
`/print-order`。

```
/tools/workbench  →  「加入打印单」  →  /print-order  →  提交  →  一次付款
```

- **量完直接加,不再绕一圈** —— 工具页下方那张「加入打印单」卡片是唯一
  出口。点下去:模型打包上传 R2 → `POST /api/store/print-carts/{id}/line-items`
  (带 `printSpec`)→ 服务端重算价 → 落打印单 → 跳 `/print-order`。
- **几何数据走 `printSpec`,价格走服务端** —— 计算器把体积 / 表面积 / 尺寸 /
  支撑克重推给父组件(`PricingCalculator` 的 `onQuoteInput`),加购时一起
  发上去;**价不在这儿算**,服务端重算(见 `cart-store.ts` 的
  `repriceLineItem()`)。
- **计算器不再有「报价模式」** —— 早先 `quoteMode` 控制着「几何要不要抛给
  父组件」,报价台删掉之后这个开关没了,几何**一直**推给父组件。
- **工具有两个出口状态** —— 未登录:卡片显示「去登录」;已登录:显示
  「加入打印单」。
- **先登录再量** —— 加购接口要 session(401 `AUTH_REQUIRED`),而登录完回来
  是**整页跳转**(`sign-in-form.tsx` 的 `window.location.href`),内存里的
  模型选不回来。所以登录放在量之前,卡片文案里写明了这一条。
  早先那套「模型接力」(`print-quote/lib/model-handoff.ts`,靠模块级变量
  跨路由跳转)已经删掉 —— 接力只扛得住客户端路由跳转,扛不住登录往返。
- **摆盘结果不接力** —— 加进打印单的是**当前姿态**的支撑克重(智能摆盘
  跑过就是最优姿态的,没跑就是初始角度的)。

### 打印前工作台:检查 / 克重 / 摆盘(2026-11-07)

工作室的原话:**「不想分成两个工具页」**。

以前模型检查(`/tools/model-check`)和克重(`/tools/weight`)是**两个页面**,
同一个文件要拖两次、解压两次、量两遍,中间还要跳页。现在合成**一个**
工作台(`/tools/workbench`),模型**只载入一次**,里面用两个视角看同一个模型:

```
/tools/workbench  →  拖进来  →  检查(能不能印)→ 克重(要多少料)→ 摆盘(怎么摆)
```

**地址为什么叫 `/tools/workbench`** —— 两个视角里没有一个能代表全名:叫
`/tools/weight` 只说了克重,叫 `/tools/model-check` 只说了检查。
`/tools/workbench` 是唯一说得通的 —— 这是一个**工作台**,里面切视角。

三个老地址(`/pricing` / `/tools/weight` / `/tools/model-check`)都 **308 跳**
到 `/tools/workbench`(`permanentRedirect` —— 永久搬家,权重要转移;307 会被
当成临时跳转)。用 `next/navigation` 的 `permanentRedirect`,不是
`@/i18n/routing` 里那个(后者从 `next-intl/navigation` 导出,client 入口
没有 `permanentRedirect`,放进共享模块会在打包时炸)。locale 前缀手写 ——
`localePrefix` 是默认的 `always`,URL 一定带前缀。

- **两个视角** —— 视角切换条在**上传模式**里(手动尺寸 / 批量模式没有模型,
  摆不了)。`check` / `weight` / `pose` 三个 tab,`WorkspaceTab` 类型在
  `pricing/components/model-settings-panel.tsx`。
  - **检查** —— **右侧那个 3D 视口不动**(跟另外两个视角是同一个视口,
    见下面「共用一个展示区域」),只把**左侧的侧栏**换成深色的检查侧栏
    (`ModelCheckSidePanel`)。分析器只在切到这个 tab 时才启动 ⇒
    不在后台偷偷跑。
  - **克重** —— 侧栏三个数(耗材 / 支撑 / 总)+ 尺寸调节 + 下单出口。
  - **摆盘** —— 智能摆盘结果。没跑过摆盘就摆**当前姿态**(初始角度 0°,0°)
    的样子 + 一句提示(这一栏空着的话用户会以为坏了)。
- **模型只解析一遍** —— `extractModelZip()` 在 worker 里解析 OBJ 一次,
  结果带 `positions` / `uvs` / `materialNames` / `materialIndex` 回来
  (`ObjParseResult` 加了这几个字段)。**工作台框架**
  (`model-settings-panel.tsx`)吃的是父组件给的 `ModelFile` 的
  `parseResult.positions`,**不再自己解析一遍**;检查侧栏更不解析。
  (以前它要走 `tools/lib/model-loader.ts` 二次解析 —— 那个文件已删。)
- **尺寸跟着克重那一栏走** —— 工作台框架按 `scalePositionsXYZ(raw, scales)`
  缩放顶点,`scales` 是克重工具**生效的**缩放因子,缩完的结果**同一个**
  `Float32Array` 喂给视口和分析器。支撑外壳的平台平面是
  绝对毫米值(托底 5mm),不缩放顶点的话画出来的支撑跟克重那栏对不上。
- **一份口径(结构上保证)** —— 两个视角的数字来自同一个 `ModelFile`、
  同一套缩放、同一份后台参数(`ClientPrintConfig`),**不可能**对不上。
- **自检摘要白捡** —— 摆盘 Worker 焊接模型时本来就在建完整拓扑
  (`weldAndAnalyzeTopology`),以前把除了网格和内腔标记之外的东西全扔了。
  摘要吃的就是那份拓扑,**不多焊一次、不多花时间**。摘要和检查面板调的
  是**同一个函数**(`tools/lib/mesh/summary.ts` 的 `classifyShells()` /
  `buildCheckStats()` / `buildCheckWarnings()` / `evaluateWjp()`)——
  两个视角**不可能**对同一个模型给出相反的结论。
- **徽标只摆事实,不拦人** —— 有问题照样能加入打印单(工作室可能有特殊处理
  办法)。加一道「确认」就多一个决策,而工作室要的是「少操作」。
- **徽标只显示跟尺寸无关的结论** —— 状态 + 提示清单。带尺寸的 WJP 结论
  (外形尺寸那条)不摆 —— 摘要是在**原始文件单位**下算的,尺寸结论会跟
  页面上归一化后的尺寸对不上。
- **接力模块全删** —— `tools/lib/model-handoff.ts` 和
  `print-quote/lib/model-handoff.ts` 都已删。跨页接力只扛得住**客户端路由
  跳转**,扛不住**登录往返**(登录完是整页跳转,必然断)—— 现在根本不需要
  接力了:同一个页面里切 tab,模型一直在。
- **SEO 关键词两套都留** —— 合并之前这是两个页面,各自被收录过。工作台的
  `generateMetadata()` 带上了检查那一套(`3D模型检查` / `反转法向` /
  `非流形边` …)+ 克重那一套。
- **sitemap 里只有 `/tools/workbench`** —— 三个老地址现在都只是 308,留在
  sitemap 里等于告诉搜索引擎「这个页面也是正式页面」。
- **行为由单测守住** ——
  | 测试 | 守住什么 |
  |---|---|
  | `src/test/tools/pure/workbench-merge.test.ts` | 三个老地址只 308 跳到 `/tools/workbench` / 检查侧栏不自己解析 OBJ、不自己缩放 / 工作台框架只挂**一个** `<ModelViewport>` / 工具中心只剩一个入口 |
  | `src/test/tools/pure/mesh-summary.test.ts` | 摘要的 stats / warnings / WJP 报告跟检查面板**逐字相同**(6 个网格夹具) |

#### 拖文件进页面(2026-11-07)

工作台的「检查」视角曾经**拖不进模型** —— 指针一进视口,遮罩
**一闪一闪**,文件落下不来。

**根因不在浏览器,在遮罩自己身上**:

```
dragover → 遮罩出现 → 指针落在**它自己**身上
         → dragleave 从它冒到容器 → 容器把遮罩撤掉
         → 遮罩没了 → 又 dragover → 又出现 ……
```

遮罩是拖放区的**子元素**,它盖在指针下面就成了事件目标;`dragleave` 冒泡
到容器,容器把遮罩撤掉,撤掉之后 `dragover` 又来 —— 无限闪。**文件根本
进不来**,因为 `dragover` 的 `preventDefault` 被这一轮闪没了。

- **一份口径** —— `src/features/shared/hooks/use-drop-zone.ts` 的
  `useDropZone()`。三个拖放区都用它:**工作台那个共用的展示区**
  (`model-settings-panel.tsx`)、克重工具的上传卡、批量模式的空状态卡。
  **别再自己写一遍** `onDragOver` →
  true / `onDragLeave` → false —— 那个写法就是会闪的那份。
- **进出配对计数** —— `dragenter` +1 / `dragleave` −1,**归零才撤高亮**。
  指针在容器和子元素之间来回移动时深度始终 > 0,高亮不翻。
- **`dragover` 只 preventDefault** —— 不撤状态。不 `preventDefault` 的话
  浏览器不让放,文件根本进不来。
- **窗口级 `dragend` / `drop` 兜底** —— 拖拽被 Esc 取消、文件丢在容器外
  时清零,不然高亮会**粘**在屏幕上。
- **遮罩加 `pointer-events-none`** —— **必须**。它只是给人看的,永远不吃
  事件;不然浏览器会把它算成一次新的进入 / 离开,深度被算乱。
- **行为由单测守住** —— `src/test/shared/pure/use-drop-zone.test.tsx`
  (jsdom)模拟那一串事件,守住「高亮不闪」;同一个文件还扫源码,守住
  「tools / pricing 里不自己写拖放事件」「遮罩带 pointer-events-none」。

#### 底板留边那一圈:画面跟克重是同一圈(2026-11-07)

工作台合并之后,「检查」和「克重」两个视角并排看 —— **画出来的底板跟算
进去的底板必须一模一样**。原先检查视角画的「包裹支撑」只有模型轮廓(平
台投影),**少了底板留边那一圈**(轮廓四周外扩 5mm):克重那边把它算进支撑
克重了,画面上没画。

- **一份栅格** —— `computeSupportVolume` 里那套栅格化抽成了
  `rasterizeFootprint()`,`computeSupportVolume` 和 `buildBasePlateRing()`
  共用**同一份栅格**(原点 / 栅格尺寸 / 留边宽度)。外扩走欧氏距离(距离变换
  + 半格修正),不是八邻域。画出来的那一圈 = 「外扩了但没被模型覆盖」的
  格子,跟算进克重的底板占地**逐格相同**。
- **两个视角都画** —— 检查视角和克重视角**现在共用一份视口**
  (`shared/components/model-viewport/`),画法当然一样:绿 `#2f7255`,平在
  平台平面上、`depthWrite: false` + MAX 混合,不跟平台投影打架。
- **默认关** —— `buildSupportShell` 的 `includeBaseRing` 默认 **false**:
  摆盘搜索一次要建 625 个外壳,每个都做一遍外扩太贵。只在真要画的那两条路
  打开。
- **留边宽度跟随后台** —— 两边都读 `ClientPrintConfig.supportBaseMarginMm`
  (`/admin/print-pricing` 配的),不是写死的 5mm。
- **行为由单测守住** —— `src/test/tools/pure/support-shell.test.ts` 的
  「底板留边那一圈」那组:画出来的面积 == `supportAreaMM2 − footprintAreaMM2`
  (算出来的底板占地),环平铺在平台平面上,默认关,留边 0 时为空。

#### 共用一份 3D 视口(2026-11-07)

工作室的原话:**「克重也用检查的3d预览」** + **「需要支持角度调整」**。

以前有**两个**预览:模型检查那一套深色视口(`tools/components/model-check/
viewport.tsx`)和克重那一套浅色视口(`pricing/components/obj-viewer.tsx`)。
两套代码、两套相机、两套材质 —— 同一模型在两个视角里长得不一样,支撑的画法
也不一样(一个是「画出来的近似」,一个是「算出来的那块」)。

现在**只有一份**:`src/features/shared/components/model-viewport/`。
两个老文件都删了(别有人从老文件里抄回去)。

```
shared/components/model-viewport/
├── model-viewport.tsx   # 视口本体(两个视角共用)
├── pose.ts              # 姿态旋转的纯实现(不碰 three.js)
└── index.ts
```

- **支撑几何由外面传进来** —— `supportShell` 是摆盘 Worker 算完姿态时
  **同一块**几何(外壳 / 顶面 / 外壁 / 底板留边)。`computeSupportAtPose()`
  的 `opts.withShell` 开关让它**在算体积的同一次调用里**把渲染用的外壳
  一起建出来 —— 画出来的那圈支撑就是算克重的那块支撑,不是「照着算出来的
  样子再画一遍」。`includeCurtain` / `includeTopIndex` / `includeBaseRing`
  都跟着这个开关 —— 不画的时候不建(摆盘搜索一次 625 个姿态,每个都建一遍
  太贵)。
- **姿态是变换,不是重算** —— 模型和问题边线装在一个**姿态组**里,改角度
  只改组的旋转,几何不重建 —— 拖滑块时不会卡。three.js 的
  `rotation.order = "ZYX"`(Rz·Ry·Rx = 先 X 后 Y 后 Z),跟摆盘算法
  (`rotateSupportMesh`)、OBJ 导出(`obj-exporter.rotateVertex`)**同一个
  矩阵**。`pose.ts` 里的纯实现跟 `rotateSupportMesh` 对着算过(单元测试
  逐点比)。
- **支撑几何不进姿态组** —— 外面传进来的支撑已经是**转好姿态**的坐标,
  再转一次就转过了。模型 + 问题边线在姿态组里,支撑挂在模型组上。
- **平台高度有两个来源** —— 有外壳时用外壳自己的 `groundZ`(那是算支撑
  体积时用的平台平面,画面跟数字落在同一个平面上);没有外壳时(Worker 还没
  回话)用模型自己的最低点 + 托底高度,最低点按**旋转后**的包围盒算。
- **分析器只在「检查」那一栏跑** —— 克重视角传 `result = null`,
  问题着色那一层压根不画,分析器也不在后台偷偷跑。
- **克重视角变深色了** —— 视口统一用 `ObjPreview` 的 `mode="inspect"`
  (深底)。预览区底色、加载遮罩、浮层控制条都跟着改成深色那一套。
- **丢了的东西** —— 老 `ObjViewer` 里的包围盒标注、X/Y/Z 轴标注和浅色
  HTML 浮层没了;侧栏的 X/Y/Z 尺寸仍然有(`DimDisplay` / `DimEditor`)。
  补了一颗「重置视角」按钮(跟检查那一栏顶栏那颗同一个作用)。
- **行为由单测守住** ——
  | 测试 | 守住什么 |
  |---|---|
  | `src/test/tools/pure/shared-viewport.test.ts` | 两个视角 import 的是同一个 `ModelViewport` / 老的两份视口文件删了 / 支撑几何来自 Worker 的同一块(`withShell`)/ 姿态组跟模型组的成员划分 / 旋转顺序跟 `rotateSupportMesh` 逐点相同 |

#### 共用一个展示区域 + 模型角度(2026-11-07)

工作室的原话:**「共用一个展示区域，切换只是切换不同数据而已」** +
**「模型需要支持旋转角度而不是视角旋转」** +
**「克重区域应该像之前的检查区域那样，而不是反过来」**。

#### 共用一个展示区域

以前「检查」那一栏**整块替换**两栏布局,自己挂一个深色视口(`ModelCheckPanel`
带自己的侧栏和自己的视口)。切一次视角,视口就**卸载重挂**一遍 —— 相机归位、
模型重建、支撑重画,切过去看到的跟切回来看到的不是同一个场景。

现在**整页只有一个 `ModelViewport`**,永远挂在**右边**:

```
┌──────────────┬───────────────────────────────────┐
│  侧栏(左)     │  3D 视口(右)—— 顶栏 + 角度条 + 画布  │
│  按视角换内容  │  **永远挂载,切视角不卸载**          │
└──────────────┴───────────────────────────────────┘
```

| 视角 | 喂进去的数据 |
|---|---|
| `check` | 分析结果(问题着色 / 问题边线)+ 图层开关 + 聚焦请求 |
| `weight` | 支撑外壳(摆盘 Worker 算的那块)+ 当前姿态 |
| `pose` | 同上 |

切视角 = **换几行 prop**。视口不卸载,相机不动,模型不重建。

- **侧栏在左、视口在右** —— 跟以前那个模型检查工具**一个方向**(那边就是
  「侧栏左 + 视口右」)。工作室的原话:「克重区域应该像之前的检查区域那样,
  而不是反过来」—— 所以是**克重那一栏改成检查工具那个排布**,不是反过来
  把检查那一栏塞进右栏。实现上靠 flex 的 `order`:DOM 里视口在前(手机上
  视口在上),`md:order-2` 把它换到右边,侧栏 `md:order-1` 换到左边。
- **断点跟旧检查工具一样是 `md`(768px 就并排)** —— 以前那个工具在 768px
  上就是「侧栏左 + 视口右」,等 `lg`(1024px)的话,768~1023px 这段窗口里
  还摆着老克重工具的方向(视口在上、面板在下)。
- **整块工作台是一个深色应用** —— 顶栏(文件身份)、视角切换条、3D 视口那一
  列、**左边的信息栏**,四块都是深色,读起来是**一个 3D 应用**,跟以前检查
  工具那块是同一块地。两个视角换的是**左栏的内容**,整块外观不变
  (见下面「统一用检查工具的深色设计」)。
- **两个视角的侧栏同宽(`md:w-[400px]`)** —— 不然切一次视角视口宽度就变,
  相机的取景会跑偏(相机只在建模 / 重置时重新取景)。
- **检查侧栏只剩那一块** —— `ModelCheckPanel` 改成了
  `ModelCheckSidePanel`(`tools/components/model-check/model-check-panel.tsx`),
  **纯展示**:拿 `result` / `busy` / `error` 渲染问题列表、统计条、单位横幅,
  点一下图例 → `onFocusCluster` / `onFocusPoint`。
- **检查状态住在视口的上一层** —— `useCheckView()`
  (`tools/components/model-check/use-check-view.ts`):分析器、图层开关、
  聚焦请求、图例。**视口要吃的就是这几样**,所以它们必须在切视角的**上面**,
  不然切一下就没了。
- **分析器按需启动** —— `useCheckView({ active: tab === "check" })`。
  不切到「检查」那一栏就**不跑**(多秒的焊接 + 拓扑不该在后台偷偷烧 CPU);
  但**切回来不重跑** —— 内部按「顶点引用 + 文件名 + 托底 + 留边」记了一份
  身份,一样就跳过。改尺寸时身份变了,下次进「检查」那栏会重算。
- **拖放区跟着展示区走** —— 遮罩从检查面板搬到了工作台框架
  (`model-settings-panel.tsx`),拖文件进的是**那一个**展示区。
- **浮层控制条也是共用的** —— 问题图层开关(只有「检查」那栏有)+ 贴图 /
  包裹支撑 / 重置视角 + 支撑比例,两个视角共用一条。

#### 统一用检查工具的深色设计(2026-11-07)

工作室的原话:**「就是统一用检查那个设计，左边信息栏可以显示克重、检查、
摆盘」**。

合并之后有两处跟旧检查工具对不上:

1. **外观** —— 检查那一栏是深色,克重 / 摆盘是浅色,切一次视角整块换脸
2. **排布** —— 旧检查工具是「侧栏左 + 视口右」,`md`(768px)就并排;工作台
   当时是「视口上 + 面板下」,`lg`(1024px)才并排

现在**整块是一个深色应用**:头部(文件身份)→ 视角切换条 → **左边信息栏 +
右边 3D 视口**。两个视角换的是**左边那一栏的内容**,整块外观不变。

```
┌──────────────┬───────────────────────────────────┐
│  信息栏(左)   │  3D 视口(右)—— 顶栏 + 角度条 + 画布  │
│  检查/克重/摆盘 │  **永远挂载,切视角不卸载**          │
│  **同一套深色** │  **深色**                          │
└──────────────┴───────────────────────────────────┘
```

- **深色 token** —— 整块 `bg-zinc-950 text-zinc-100`;卡片 `bg-zinc-900`
  + `border-zinc-800`;次级文字 `text-zinc-400` / `text-zinc-500`;强调色
  各视角自己那套(克重 amber / 摆盘 violet / 通过 emerald)。
- **左栏三块共用同一个外壳** —— 标题(`ShieldCheck` / `Scale` / `Compass`
  + 视角名)+ 内容。检查那块是 `ModelCheckSidePanel`,克重/摆盘是
  `weight` / `pose` 插槽 —— 换的是**内容**,外壳统一。
- **跟着一块改的还有** —— 尺寸卡 / 单位横幅 / 解析中 / 解析失败 / 视角切换条
  / `DimDisplay` / `DimEditor`(`shared.tsx`)/ 克重读数 / 摆盘面板
  (`pricing-calculator.tsx`)/ 自检徽标(`mesh-check-badge.tsx`)/
  贴图诊断(`texture-diagnostic.tsx`)。
- **「加入打印单」那张卡在深色应用外面** —— 它是页面里的一张浅色卡
  (工作室的下单按钮),不是 3D 应用的一部分。两个视角都在,检查完就能下单。
- **行为由单测守住** —— `src/test/tools/pure/workbench-merge.test.ts`:
  整块是深色(`bg-zinc-950 text-zinc-100`)、两个 `<aside>` 都带
  `md:order-1` 且都不许再带 `border-stone-200`(以前克重那一栏是浅色的)。

#### 模型角度:转的是**模型**,不是**视角**

摆着看(转相机)跟摆着印(转模型)是两件事 —— **后者决定支撑克重**。这两件事
以前混在一颗「重置视角」按钮附近,用户分不清。

- **姿态组转的是模型** —— 模型 + 问题边线装在姿态组里,`rotation.order = "ZYX"`;
  相机归位是**另一件事**(浮层条上那颗「重置视角」按钮)。
- **角度条常驻** —— 展示区上方那条「模型角度」(`MaterialPricing.angle.modelAngle`)
  在**每个视角**都在,而且**不是「跑过智能摆盘才出现」** —— 模型刚进来就有,
  初始角度 0°,0°。
- **两个视角共用同一个姿态** —— 在「检查」那一栏把模型转了,切到「克重」
  还是这个姿态;反之亦然。
- **改角度 → 支撑**不**跟着重算** —— 工作室 2026-11-07 的口径:支撑不跟随
  角度实时变化。改角度只改 `viewerRotX/Y/Z` + `manualRotX/Y/Z`,
  **不发任何指令给 Worker**;支撑要用户点「包裹支撑」才按新角度算一次
  (见下面「支撑按需计算」)。

#### 旋转控制器 / 支撑按需计算 / 全屏(2026-11-07)

工作室的几条追加要求:「需要支持在预览时旋转、缩放、平移模型」+
「去掉摆盘tab,然后支持全屏」+「旋转、缩放模型需要刷新克重,但不需要实时
支撑,默认无支撑,显示支撑时才需要」+「模型旋转不是这样操作,按照业界主流
设计,带控制器」+「支撑不要跟随变化实时变化,用户确定角度后点击显示支撑才
计算支撑、总克重」+「全屏发现一半没显示」。

##### 转模型用**旋转控制器**(业界主流那套)

工作室的原话:**「模型旋转不是这样操作,按照业界主流设计,带控制器」**。

业界主流(BIM / 三维建模 / 在线建模工具)转模型用的都是**三轴旋转控制器**
—— 模型上套三个彩色圆环,拖着环转。three.js 里有现成的 `TransformControls`
(Blender / Sketchfab 那一套),不用自己搓一个。

| 操作 | 效果 |
|---|---|
| **拖彩色圆环** | 转**模型**(改打印姿态)—— 支撑克重按新角度重算 |
| 左键拖(空白处) | 转**相机** |
| 滚轮 | 缩放(相机) |
| 右键拖 | 平移(相机) |

- **控制器挂在**姿态组**上** —— 姿态组才是「打印姿态」那一份(模型 + 问题
  边线都在里面,`rotation.order = "ZYX"`)。挂到别的组上,画面转的是模型、
  算克重的却是另一个姿态。
- **只给「转」** —— `setMode("rotate")`;`setSpace("world")`(世界坐标轴 ——
  环上那三个轴跟角度条上的 rotX / rotY / rotZ 一一对应,绕局部轴转的话数
  对不上,用户会懵)。平移 / 缩放不该改打印姿态。
- **`getHelper()` 得进场景** —— three.js 0.187 起控制器本体不是 `Object3D`,
  渲染的是它的 helper。
- **控制器写的是 quaternion** —— 分解回仓库口径的欧拉角:
  `new THREE.Euler().setFromQuaternion(q, POSE_EULER_ORDER)`(`"ZYX"` =
  Rz·Ry·Rx = 先 X 后 Y 后 Z),不然角度条上的数跟画面对不上。
- **拖的时候相机让开** —— `mouseDown` 把 `ctx.controls.enabled` 设成
  `false`,`mouseUp` 设回 `true`。不这样的话拖环的同时相机也在转,画面抖。
  (`OrbitControls.onPointerUp` 不看 `enabled`,清理逻辑照跑 —— 不会出现
  「松手之后左键再也转不动相机」。)
- **左键不再从相机手里拿走** —— 以前是「左键拖 = 转模型」,现在模型由控制器
  转,相机的左键旋转得留着(不然空白处拖一点反应都没有)。`mouseButtons.LEFT`
  / `touches.ONE` 那套改动**删干净了**。
- **World 空间重转是从「按下那一下」的快照算的** —— `TransformControls` 内部
  记着 `_quaternionStart`,所以 React 中间写进去的欧拉角不会累积(拖一下
  转 30°,不是 60°)。
- 以前那套「拖动 → 绕 Z / 绕 X」的数学(`poseAfterDrag`)**删了** —— 控制器
  自带角度,不用自己换算。

##### 支撑按需计算 —— 支撑不跟随角度实时变化

工作室的原话:**「支撑不要跟随变化实时变化,用户确定角度后点击显示支撑才计算
支撑、总克重」**。

```
转模型(拖旋转控制器)→ 什么都不算(上一次的结果也作废)
  → 用户点「包裹支撑」→ 算一次 → 支撑克重 + 总克重 + 画出来那圈支撑
```

三样东西来自**同一次**计算,所以画面跟数字必然对得上。

- **算支撑的 effect 依赖里**没有角度** —— 依赖是
  `[showSupport, appliedScales, supportParams, model, supportModelReady]`。
  依赖里有角度的话,拖一下控制器就重算一遍:数字一直跳、Worker 队列一直满
  (工作室不要这个)。
- **转模型的回调不发任何指令给 Worker** —— 以前要节流 200ms,是因为每个
  pointermove 都发一条 `AngleOptimizerClient.pose()`(那个客户端**没有请求
  合并**,发满了页面反而更卡)。现在不发指令了,直接改 state 就完事,
  `poseCommitTimerRef` / `handlePoseDragEnd` 全删。
- **角度一变,上一次的结果作废** —— 支撑是「某个角度下的一次结果」,角度
  一变那个数就是**旧角度**的数了。不清掉的话:画面上那圈支撑摆在旧角度上,
  支撑克重也是旧角度的,用户看着模型在新角度、数字却在说旧角度 —— 画面跟
  数字一起骗人。所以角度一改:数字清空(回到「—」)、那圈支撑撤掉、按钮回到
  关的状态(`setPoseSupport(null)` + `setShowSupport(false)`)。
- **默认关** —— `showSupport` 默认 `false`。模型刚进来时**一个支撑都不算**
  (以前是模型一进来就有支撑克重)。支撑外壳(外壳 + 顶面 + 外壁 + 底板留边)
  是这一页最贵的一块几何,用户没主动点那颗按钮之前不替他算。
- **外壳跟着那颗开关走** —— `supportShell={showSupport ? (poseSupport?.shell ?? null) : null}`。
  算的时候 `withShell: true`(外壳在**算体积的同一次调用**里建出来)。

**但「加入打印单」必须带上支撑克重** —— 服务端按这组数重算报价
(`quote-server.ts` 的 `input.supportWeightG ?? 0`),少了它支撑费会算成 0,
**收少了钱**。所以计算器对外留了一个入口:

- `EnsureSupportFn`(`pricing-calculator-types.ts`)——
  `() => Promise<PrintQuoteInput | null>`,「按**当前姿态**把支撑算出来」。
- `pricing-calculator.tsx` 的 `ensureSupport`:算过了就返回现成的(不重算),
  没算过就现算一次(`withShell: false` —— 只要数,不要那块最贵的外壳)。
- 入口通过 `onEnsureSupport` 交给父组件(`print-service-weight-tool.tsx`),
  再通过 `ensureSupport`  prop 传到「加入打印单」那张卡
  (`print-service-add-to-order.tsx`),加购之前 `await ensureSupport()`。

**两道兜底 —— 别让「算不出支撑」变成「收少了钱」**:

- **模型还没焊完 → 等它** —— 用户刚拖进模型就点「加入打印单」是常事,而
  焊接大模型要好几秒。`ensureSupport` 这时候先 `await` 焊接那个 promise
  (`supportLoadRef`),再算支撑。
- **算不出来 → 不加** —— 加购那张卡拿 `ensureSupport()` 的结果,**拿不到就
  报错退出**,不许退回「只有几何、没有支撑克重」的 `input` 那样去加购:
  服务端按 `input.supportWeightG ?? 0` 算,支撑费会算成 0(收少了钱),
  而用户看着像「加成功了」。宁可让用户等模型处理完再试一次。

##### 去掉「摆盘」视角 —— 摆盘结果并进克重栏

- `WorkspaceTab` 从 `"check" | "weight" | "pose"` 变成 `"check" | "weight"`;
  `ModelSettingsPanel` 的 `pose` 插槽删掉,`weight` 插槽吃
  `weightColumn`(= 三个克重数 + 摆盘结果卡)。
- **理由**:摆盘结果(最优姿态 / 自支撑比例 / 省 X%)本来就是克重的一部分 ——
  支撑克重摆到哪个姿态最省,拆成两栏要用户自己把两个数对上。
- 「智能摆盘」那颗**按钮留着**,跑完的结果照样摆出来。

##### 全屏 = 整块工作台(「一半没显示」修掉了)

- 走浏览器的 **Fullscreen API**(`requestFullscreen` / `exitFullscreen` /
  `fullscreenchange`),不是 `position: fixed` 那种假全屏。
- **样式状态驱动**,不用 `[:fullscreen]:` 变体 —— 变体那套跟工具类名叠在
  一起时优先级说不清,全屏下有一半没显示。现在是
  `cn("…", fullscreen && "h-screen w-screen rounded-none border-0 flex flex-col overflow-hidden")`。
- **相机要重新取景** —— 视口的宽高比一换(进全屏 / 退全屏),原来那个相机
  距离就不对了:相机是按**旧比例**摆的,模型会被裁掉一半。`fullscreen` 一
  变就推一个 `fitSignal`,视口按新比例重摆一次。
- **取景距离要照顾两个方向** —— 只按竖直方向算的话,视口一变成窄高比例
  (进全屏、竖屏),水平方向就装不下了。`fitCamera` 按
  `min(vFov, hFov)` 算(包围球在两个方向上都装得下)。
  **宽高比从画布上量**(`canvas.clientWidth / clientHeight`),别读
  `camera.aspect` —— 那是渲染循环里更新的,刚切完全屏那一帧它还是旧比例。
- **不是只放大视口** —— 只放大视口的话,左栏那三个克重数还在屏幕外,
  盯着模型看也看不到要多少料。

- **行为由单测守住** ——
  | 测试 | 守住什么 |
  |---|---|
  | `src/test/tools/pure/workbench-merge.test.ts` | 整个工作台只挂**一个** `<ModelViewport>` / 检查侧栏不自己挂视口 / **侧栏在左、视口在右** / 分析器只在 `tab === "check"` 时启动 / **视角只有两个**(没有第三个「摆盘」)/ 全屏是整块(状态驱动 + `requestFullscreen`)/ 进全屏重新取景 / 控制器回调一路传到视口 |
  | `src/test/tools/pure/shared-viewport.test.ts` | 检查侧栏不 import 视口 / 姿态无条件传给视口 / 旋转顺序跟 `rotateSupportMesh` 逐点相同 / 支撑几何来自 Worker 的同一块 / **控制器是 `TransformControls`(只转 / 世界轴 / 挂姿态组 / helper 进场景)** / 拖的时候相机让开 / quaternion 按 `POSE_EULER_ORDER` 分解 / 左键不再从相机手里拿走 |
  | `src/test/tools/pure/support-on-demand.test.ts` | **支撑计算的依赖里没有角度** / 角度一变上一次的结果作废 / 外壳跟着那颗开关走 / 没算过的时候三个数是「—」 / **加购之前会现算一次支撑**(少了它服务端收少了钱) / **算不出来就不加** / **模型没焊完会等它** |

##### 显示支撑必须**自动置于平面**,模型**不能低过平面**(2026-11-07)

工作室的原话:**「显示支撑必须自动置于平面,模型不能低过平面」**。

- **根因:平台平面是从支撑外壳那里拿的**(`shell.groundZ`)。而支撑外壳是
  「**某个姿态下的一次结果**」:
  - 分析器算的那块(检查视角)是**未旋转**的模型 —— 记 (0,0,0);
  - 摆盘 Worker 算的那块带**真实**角度。
  - 姿态一变,手里那块外壳就成了**旧姿态**的。拿旧姿态的外壳摆平台平面,
  转过之后的模型自然**沉到平台下面**去了。
- **修法三条**(都在 `shared/components/model-viewport/`):
  1. **每块外壳都带姿态** —— `SupportShellData.pose`。`buildSupportShell()`
     默认写 (0,0,0)(分析器那条路就是未旋转的模型),`computeSupportAtPose()`
     写**真实角度**。
  2. **视口只认当前姿态的那块** —— `shellMatchesPose()`(容差 0.01°)。对不上
     的**不画,也不拿它摆平台**。姿态一变,手里那块外壳立刻作废 —— 跟
     「支撑不跟随角度实时变化」那条口径一致(要新的支撑,用户点「包裹支撑」
     重算一次)。
  3. **平台平面统一按包围盒最低点定** —— 有外壳时用外壳自己的 `groundZ`,
     没有时用 `rotatedBBoxMinZ(包围盒, 角度) − 托底`。两条路**同一个口径**
     (支撑体积算平台平面也是 `mesh.bboxMin[2] − 托底`),所以「显示支撑」
     开关前后模型**不会跳**(只差那 0.05~0.1mm 的安全余量),支撑的外壳底面
     也**不会沉到平台下面**。
- **为什么模型不会低过平面** —— 包围盒装着模型 ⇒ **包围盒最低点 ≤ 模型最低
  点**;平台平面取的就是包围盒最低点(或更低的 `groundZ`)⇒ **平台平面 ≤ 模型
  最低点** ⇒ 模型永远在平台上面。这是**结构性**保证,不是靠调参数凑出来的。
- **顺带**:转过模型之后,检查视角那块外壳(未旋转)就不认了 —— 支撑得按新
  姿态重算,否则画出来的那圈支撑摆在旧姿态上,跟模型对不上。

- **行为由单测守住** ——
  | 测试 | 守住什么 |
  |---|---|
  | `src/test/tools/pure/shared-viewport.test.ts` | 每块外壳都带算它时的姿态 / **姿态对不上就不认**(旧姿态的外壳会把模型摆到平台下面)/ **平台平面永远不高于模型的真实最低点**(模型不会低过平台)/ 模型离平台至少一个托底高度 / 视口摆平台用的是「当前姿态的那块外壳」 |

##### 「置于平面」:一颗按钮把落座 + 重算支撑串成一步(2026-11-07)

工作室的要求:**「增加置于平面功能」**。定下来的行为是**「按当前姿态落座 +
重算支撑」**。

- **它做什么** —— 按**当前姿态**把模型放到打印平台上,一步做三件事:
  1. **支撑按当前姿态重算一次** —— 走的就是「算支撑」那个 effect
     (`withShell: true` —— 画出来的那圈支撑跟算克重的是同一块几何);
  2. **平台平面按这个姿态重摆** —— 视口拿这块外壳自己的 `groundZ` 摆平台
     (`shellMatchesPose` 对得上才认)⇒ 模型坐在托底上,**不会低过平面**;
  3. **支撑克重 / 总克重同时刷新** —— 三样东西来自**同一次**计算。
- **在哪儿** —— 浮层控制条上,挨着「包裹支撑」(`MoveDown` 图标)。两个视角
  共用那一条控制条,所以两个视角都有这颗按钮。
- **跟「包裹支撑」的区别** —— 那颗是**开关**(按一下算、再按一下不画);这颗
  是**动作**(永远算一次、永远落在平台上)。用户转完模型点这颗就齐活了,
  不用先点「包裹支撑」。
- **令牌 `supportRecalcToken`** —— 光把 `showSupport` 打开**不一定**会重算:
  开关本来就开着(用户没转过模型)、或者上一次算失败(用户想重试)的时候,
  那个 effect 的依赖没变,不会跑。所以另备一个令牌:点一次 +1,effect 的依赖
  里带着它 ⇒ **一定会重算**。依赖里**仍然没有角度** —— 落座不许变成「实时
  重算」(工作室不要数字一直跳)。
- **落座不碰角度** —— `placeOnPlane` 里没有 `setManualRot*` / `setViewerRot*`:
  它是「落座 + 重算」,不是「改姿态」。
- **提示文案跟着改口** —— 「点「包裹支撑」按当前角度算」→「点「置于平面」按
  当前角度算并落座」(浮层条 + 克重栏两处,中英各一份)。
- **行为由单测守住** ——
  | 测试 | 守住什么 |
  |---|---|
  | `src/test/tools/pure/support-on-demand.test.ts` | 浮层条上有这颗按钮 / 按下去 = 打开支撑 + 令牌 +1 / 令牌在算支撑那个 effect 的依赖里 / 依赖里**仍然没有角度** / 落座**不碰角度** / 计算器把按钮接到面板上 |

### 打印定价后台(2026-11-06)

工作室的要求:「需要能够在 dashboard 后台设置**克重的计算和计价、材料、
计算逻辑**」。

- **位置**:`/admin/print-pricing`(管理员后台,不是 `/dashboard`)
- **材料组织**:**多档材料可选** —— 后台维护一份材料库,再指定哪一档当前生效
- **工具页口径**:**跟随后台,访客改不了** —— 密度 / 支撑几何都读后台
- **计算逻辑范围**:① 计价基础 ② 交期三档比例 ③ 支撑几何参数
  ④ 自支撑阈值规则(分段计价)

#### 两张新表

| 表 | 干什么 |
|---|---|
| `print_material` | 材料库(多档)。`code` 唯一;`kind` = `model` / `support`;`density` g/cm³;`unit_price_cents_per_gram` **分/g**;`is_active` 停用而不是删 |
| `print_pricing_config` | **单行**(`id = "default"`)。存「当前生效的是哪两档材料」+ 计价基础 + 分段规则 + 支撑几何 + 交期两档比例 |

- **单价不在配置行里** —— 单价跟密度是**同一个材料**的属性(密度 1.2 的树脂
  就是 450 分/g)。配置行只存「当前生效的是哪一档」,密度和单价从材料行读。
  改价 = 改材料行。
- **支撑的价在配置行上,不在材料行上** —— 支撑的加价是一条**规则**
  (阈值 + 两档上界 + 两档单价),不是材料的每克价。同一卷支撑,挂得越多
  单价越贵。所以支撑材料行的 `unit_price_cents_per_gram` 恒为 null。
- **停用而不是删** —— 工单留档要引得到材料。配置行正引用着的那一档**不许
  停用**(返回 `MATERIAL_IN_USE`)。

#### 生效值的回退链(逐字段)

```
DB 配置行 → PRINT_* 环境变量 → DEFAULT_CONFIG
```

- **逐字段**取第一个非空,不是「配置行优先,没有就整个回退」—— 后台只改
  了密度,单价仍然走环境变量那一档。
- **迁移脚本不写配置行** —— 只建表 + 播种两条出厂材料预设。所以**跑完迁移
  线上价格不会静默变掉**,直到工作室在后台第一次点「保存」,才把「当前生效
  值」固化进 DB(后台顶部会挂一条横幅提示「还在走环境变量兜底」)。
- **非法值退回兜底** —— 密度 ≤ 0、单价 < 0、比例 ∉ [0,1]、第一档上界 <
  阈值 → 退回 env / 默认值。报价链路不能因为后台手滑就收一个离谱的价。
- **DB 读失败 → 整份退回 env / 默认值**,并记一条 error 日志。**绝不把
  异常抛进报价链路** —— 收钱的链路崩了,工作室看到的是「下不了单」。

纯逻辑那一半在 `print-quote/lib/pricing-settings.ts`(**不碰 DB**,能进
`unit` project 跑单测),连库那一半在 `print-quote/lib/pricing-store.ts`
(`getPrintPricingSettings()` 用 React 的 `cache()` 包一层,同一请求内只查
一次库;**跨请求不缓存** —— 后台改完设置要立刻生效)。

#### 报价引擎吃 settings 入参

`computePrintQuote(settings, input)` / `computePrintServiceLinePrice(settings, input)`
—— **settings 是第一个、必填的入参**,漏了就是类型错误。「忘了传 settings,
悄悄按环境变量收钱」这种错不能留。

- `quote-server.ts` 里的 `PRINT_QUOTE_CONFIG` 模块级常量**删掉**了 ——
  它就是「配置只能来自 env」的固化。
- 引擎内部仍然是纯函数,只是多了一个入参;`calculatePrice()` 本身不动。
- **服务端不信客户端带来的价**这条不变 —— 变的只是「价从哪儿来」。

#### 支撑加价 = 分段计价(工作室 2026-11-06 补充)

工作室的规则原文:「模型支撑超过 1:1 的多的支撑按照 **0.5 元一克**,1:2 的
多的支撑按照 **1 元一克**」。

```
本体支撑比例 r = 支撑克重 ÷ 耗材克重     (1 = 1:1,2 = 1:2)

r ≤ 1        不收钱(1:1 以内的支撑是工艺必需)
1 < r ≤ b    超出部分 × 第一档单价(0.5 元/g)   ← b = support_tier1_ratio
r > b        再超出部分 × 第二档单价(1 元/g)
```

**分段的克重怎么切**:

```
第一档克重 = W × (min(r, b) − T) / r
第二档克重 = W × (r − b) / r          (r > b 时)
```

两档加起来 = `W × (r − T) / r` —— 跟原来单档公式的「超阈值克重」**完全
一致**,所以「阈值以下不收、超出部分收钱」这条不变,只是超出部分现在**分两
段定价**。

- **超阈值克重是按比例折出来的** —— `W × (r − T) / r`。阈值 `T = 1` 时它
  正好等于「支撑克重 − 耗材克重」(同一个式子两种写法),但**两档之间的切分
  只有比例能算**:20 g 支撑、耗材 6.67 g(比例 3)→ 超阈值 13.33 g,其中
  1:1~1:2 那段 6.67 g、第二档 6.67 g。减法只能给一个总数,分不出两段。
- **纯函数**在 `pricing-engine.ts` 的 `computeSupportFeeBands()`;报价层
  换算成「分」在 `quote-server.ts`。
- **各档 `feeCents` 之和恒等于 `supportFeeCents`** —— 逐档取整再相加跟总额
  取整可能差 1 分,差额由**最后一档**吸收。否则打印单上会出现「8.3 g ×
  ¥0.50/g + 4.2 g × ¥1.00/g」跟「支撑加价 ¥6.60」对不上。
- **默认关**(`support_enabled = false`)—— 默认开的话每一单都会悄悄多收
  一笔支撑费,而克重工具那边从不收这个钱,两边对不上。
- 打印单上摆出「支撑加价 ¥x(6.7 g × ¥0.50/g)」—— 服务端回填到 `printSpec`
  的 `supportFeeCents` / `supportFeeBands`,**纯展示用,不参与定价**。

#### 工具页跟随后台,访客改不了

- **密度 / 支撑密度 / 托底 / 留边走受控 prop** —— RSC 读
  `getPrintPricingSettings()`,把客户端需要的子集(`ClientPrintConfig`:
  两个密度 + 两个几何参数)当 prop 传下去。
- **单价 / 后处理 / 阈值 / 交期比例一律不发到浏览器** —— 工具页不显示价格,
  那些是服务端的事。
- **「材料参数」弹窗改成只读** —— 密度改了,支撑克重就是假的,而服务端报价按
  自己那份密度算,两边对不上。`/api/image-gen/pricing/materials-auth` 路由
  和 `PRICING_MATERIALS_PASSWORD` 一起退役。
- **支撑几何参数化** —— `SUPPORT_LIFT_MM` / `SUPPORT_BASE_MARGIN_MM` 原来
  是写死的常量(六个地方读),现在全部是**可选参数**,默认值不变(5mm)。
  Worker 不用改协议(`SupportParams` 加字段自动就带过去了)。**计算和画面
  必须用同一个 `liftMm`** —— 3D 预览画的托底高度跟算出来的支撑克重对不上,
  用户会来问。

#### 后台页面

| 文件 | 干什么 |
|---|---|
| `src/app/[locale]/(admin)/admin/print-pricing/page.tsx` | 路由(RBAC 由父 layout 的 `checkAdmin()` 守卫,页面不重复检查) |
| `src/features/print-quote/admin/components/print-pricing-admin-view.tsx` | 客户端视图(antd `Form` + `useAction`) |
| `src/features/print-quote/admin/pricing-actions.ts` | server actions(跟 `admin/actions.ts` 分开 —— 一个管定价配置,一个管工单状态机) |

- **三块**:① 当前生效值(只读卡 + 「还在走环境变量兜底」横幅)② 计价设置
  (表单)③ 材料库(表格 + **就地展开**的新增/编辑表单)。
- **配置界面在页面上直接处理,不开弹窗** —— 工作室的口味(配置 UI 不要
  弹窗挡住别的内容)。材料编辑表单就地展开在表格下面。
- **金额输入框收整数分**(450 = 4.5 元/g);**交期比例界面用百分比**(填 37),
  提交时换算成 0~1 的小数 —— `delivery-tier.ts` 的口径就是小数。
- **出错返回 `{ok:false, code}` 而不是 throw** —— throw 会被 next-safe-action
  糊成「服务器错误」。码:`TIER1_RATIO_BELOW_THRESHOLD` / `MATERIAL_NOT_FOUND`
  / `MATERIAL_IN_USE` / `CODE_DUPLICATE` / `SAVE_FAILED`。
- **「use server」文件不许 re-export 类型** —— Turbopack 会把它注册成
  server action,运行时引用一个不存在的类型绑定 → ReferenceError,整个页面
  500(见 `src/test/repo/pure/use-server-exports.test.ts`)。

#### 迁移脚本(用户自己跑)

`scripts/apply-print-pricing-schema.ts`(幂等,手写,不走 `db:generate`):
建 `print_material` + `print_pricing_config` + 索引,播种两条出厂材料预设
(`builtin-model` 出厂树脂 密度 1.2 / 450 分/g、`builtin-support` 水溶性支撑
密度 1.28 / 单价 null),**不写配置行**。`ON CONFLICT DO NOTHING` ——
工作室改过的预置不会被改回去。

```bash
pnpm migrate:apply-print-pricing   # = tsx scripts/apply-print-pricing-schema.ts
```

**不代跑** —— 用户的生产库由用户自己执行。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/print-quote/pure/pricing-settings.test.ts` | 回退链(逐字段)/ 材料库选哪一档 / 非法值退回默认 / env 那一档 |
| `src/test/print-quote/pure/support-fee-bands.test.ts` | 分段的克重怎么切 / 各档之和 = 合计 / 阈值以下不收 |
| `src/test/print-quote/pure/delivery-tier.test.ts` | 交期加价(比例 / 基数 / 恒等式) |

### 买家的三样东西搬出控制台(2026-11-06)

工作室的原话:**「打印订单、购物订单、地址管理不放在控制台里面,而是电商首页
的用户头像那里。」**

这三样是**买家的东西**(我的单、我的地址),不是**工具用户的东西**(积分、
画布、生图)。摆在控制台侧边栏里,买家得先知道「控制台」是什么、登录进去
才找得到自己的单。

```
电商首页  →  右上角头像下拉
                   ├─ 商城订单   → /account/orders
                   ├─ 打印订单   → /account/print-orders
                   ├─ 收货地址   → /account/addresses
                   ├─ 控制台     → /dashboard        (工具用户的地方,留着)
                   └─ 退出登录
```

- **URL 换成 `/account/*`** —— 旧地址(`/dashboard/store-orders` /
  `/dashboard/print-orders` / `/dashboard/addresses`)留着**重定向**,
  已经发出去的工单邮件里的链接不会断。重定向写法跟 `/quote` 一样:
  `@/i18n/routing` 的 `redirect({href, locale})`,自带 locale 前缀。
- **页面挂在 `(marketing-atelier)` 组** —— 因为**入口在那个头里**。这一组
  的 layout 挂的是 `<WjpStoreHeader />`(头像下拉就在那儿),页面从那儿点
  进来就得长成那个样子,跟 `/cart` / `/checkout` 同一组。
- **这一组是公开组,没有会话守卫** —— `(marketing-atelier)/layout.tsx` 不做
  鉴权(匿名访客要能逛首页),所以三个页面**各自** `getServerSession()` +
  `redirect("/sign-in?callbackUrl=…")`。`(dashboard)` 那边的兜底搬走时注释里
  就写着这一条。
- **控制台侧边栏少了三项** —— `src/config/nav.ts` 的 `dashboardNav` 里
  「My Print Orders / My Orders / Addresses」删掉;`sidebar.tsx` 的
  `getNavTitle` 映射和 `main-wrapper.tsx` 的页面标题映射同步删。
  `messages/*.json` 里对应的 `Dashboard.nav.myPrintOrders` /
  `Dashboard.pages.printOrders` / `printOrderDetail` 也一并删了
  (后台那个 `AdminSidebar.printOrders` 是**管理后台**的,留着)。
- **`PrintOrdersDashboardView` → `PrintOrdersView`** —— 组件跟着改名 +
  换文件名(`print-orders-dashboard-view.tsx` → `print-orders-view.tsx`),
  它现在挂在商城那套头底下,名字里带 "Dashboard" 会让人以为它还归控制台。
- **链接跟着改** —— 结算成功页、支付面板、工单列表 / 详情 / 下单成功卡片、
  工单邮件(`notifications.tsx`)、Sellbase 那条旧路的付款回跳地址
  (`sellbase/lib/orders.ts` 的 `buildPrintOrderSuccessUrl`)全指向
  `/account/*`。

### 两个支付通道(2026-11-05)

工作室决定把收款从「Sellbase + Stripe 一条路」换成**两个通道**:微信支付、
支付宝。**两个都自己直连** —— 钱直接进我们自己的商户号 / 账户,没有中间层
抽成,定价完全由本仓库说了算。旧的 Sellbase + Stripe 那条路**并行保留**,
等两个新通道跑通再拆。

> **2026-11-05 更新:Shopify 那条路下线了。** 工作室只用微信 + 支付宝 ——
> 两个都是**境内商户**,收人民币是它们的原生场景,不用开跨境资质、不用换算。
> Shopify 的 provider **代码还留在树里**(`src/features/payments/providers/shopify/`),
> 但**不在开放名单里** → 界面上不摆出来、清单接口不返回、结算不接新单。
> 留着它的唯一理由:「重新获取付款入口」那条路要能对已经建好的 Shopify 单说
> 清楚「这条路走不通、为什么」,而不是一个看不懂的 404。跟旧路 Sellbase 一个
> 待遇 —— 确认没有待付的老单了,整个目录一起拆掉。
>
> **「开放名单」**在 `src/features/payments/lib/channels.ts` 的
> `ENABLED_PAYMENT_CHANNELS` —— 现在是 `["wechat", "alipay"]`。
>
> **「摆出来」≠「能付」** —— 没配好的那个在界面上是**灰的、标着「暂未
> 开放」、选不了**(不是藏起来:工作室要让人看见支持哪几种付款方式)。要关
> 掉哪一个,把 id 从那份名单里拿掉就行(清单接口、结算默认通道、打印工单
> 全都跟着那份名单走)。
>
> **旧路(Sellbase + Stripe)不再接新单** —— 代码还留着(已建好的旧单还能重取
> 支付入口),但结算时传 `stripe` 会直接回 503 `PAYMENT_CHANNEL_UNAVAILABLE`。
> `/api/store/payment-channels` 也不再返回那条旧通道。

#### 两道闸:「开放了」+「配好了」

| 闸 | 在哪儿 | 管什么 |
|---|---|---|
| **开放了** | `ENABLED_PAYMENT_CHANNELS` | 这个通道**摆不摆出来**给用户看 |
| **配好了** | `provider.isConfigured()` | 环境变量齐了,技术上**收得到钱** |

两道闸**各管一件事**:开放的都摆出来,配好的才让选。**两道都过**才能付款 ——
指定的通道没配好 → **503 `PAYMENT_CHANNEL_UNAVAILABLE`**,**不静默退回别的
通道**(用户以为选了微信支付、结果跳去了别处)。

> **服务端会说话(2026-11-05 加的)** —— 「开放了但没配好」的通道会在服务端
> 日志里留一条 warn(每进程每通道一条,不刷屏),指明该去哪个 `env.ts` 看要
> 哪些变量。**没有这条日志的时候,这类故障在服务端是静默的** —— 界面上只
> 是灰了一个选项,日志里只有一行 `POST /api/store/checkout 503`,看不出
> 为什么(2026-11-05 线上真踩过:Shopify 换成了新的凭据模型,而代码只认旧的
> 永久 token,于是「配了但用不上」—— 详见下面「Shopify 已下线」)。

#### 通道清单

| 通道 | 收钱方式 | 付款页形态 | 钱去哪 |
|---|---|---|---|
| `wechat` | 微信支付 V3 **Native**(扫码) | 页面留在原地,画二维码 | 我们的微信商户号 |
| `alipay` | 支付宝**电脑网站支付** | 整页跳支付宝 | 我们的支付宝账户 |
| `shopify` | **已下线**(2026-11-05)—— 代码留着,不再接新单 | — | — |
| `stripe` | **旧路**:Sellbase + Stripe(过渡期保留,**不再接新单**) | 整页跳 Stripe | Stripe → 我们的账户 |
| `offline` | 线下转账 | 没有 —— 工作室后台手动标 | — |

`offline` 不是「线上通道」:它没有支付会话,走的是后台「标记已收款」。
**`offline` 的单不给线上付款入口** —— 那是工作室手动标的线下收款。

#### 购物车改成「付款成功才清空」(2026-11-05)

**原来是在建单那一刻就 `clearCartItems()`** —— 用户没付钱就走了,回来一看购物车
空了,东西「丢了」(线上真实踩到过,用户原话「没有支付返回购物车为什么清空了」)。

现在改成:**钱到了才摘**(见 `payments/lib/settle.ts` 的
`removeOrderedLinesFromCart`)。摘的是**买掉的那几行**,付款之后又加的别的行
留着;购物车里 3 件、订单里买了 2 件 → 剩 1 件,不是整行删掉。

- **按规格 hash 对上** —— 订单行和购物车行不是同一张表,也没有共同的行 id。
  能对上的是**规格 hash**(`storefront/lib/cart-spec.ts`),两边对同一份规格
  算出来是同一个值
- **「过户」提前到结算函数开头**(`stampCartOwner`)—— 付款那一刻要靠
  `cart.user_id` 找到「这个人的购物车」,晚了就摘不掉
- **摘失败不抛** —— 订单已经标成已付了(那才是钱的记录),购物车摘不掉顶多是
  购物袋里还留着已经买过的东西。抛出去的话 webhook 会重投,重投时状态机判
  「已经标记过收款」直接 skip —— 这一次反而永远摘不掉了
- **行为由 `src/test/storefront/pure/cart-snapshot.test.ts` 守住**(hash 对得上
  / 顺序无关 / 地址比较)

**所以要「复用」上一张待付款的订单**(`storefront/lib/pending-order.ts`):
购物车不清 → 用户再点一次「去支付」会攒出两张一样的单(工作室那边多一张
永远不付的僵尸单;支付入口有两份,用户可能付了旧的那张、系统标的是新的那张,
或者两张都付 = 收两次钱)。

复用判据(全都一样才算同一单):**同一批货**(规格 hash + 数量)+ **同一合计**
(分)+ **同一收货地址** + **同一留言** + 通道还在开放名单里。

**为什么是「复用」不是「取消旧的」**:取消旧单有个要命的副作用 —— 用户可能已经
扫了旧单的付款码,钱正准备到账;旧单一取消,回调按状态机判断就会跳过「标已付」
(见 `payments/lib/transitions.ts`),**钱收了但系统不认**。复用没这个问题。

#### 模块布局(`src/features/payments/`)

```
lib/
├── types.ts        # 通道契约(PaymentRequest / PaymentSession / PaymentProvider)+ 两类错误
├── channels.ts     # 开放名单 + 通道清单(零依赖纯文件,能进 unit project 跑单测)
├── registry.ts     # provider 注册表:getPaymentProvider() / listPaymentChannels()
├── money.ts        # 分 ↔ 元/分(微信要分,支付宝要元)—— 不用浮点
├── settle.ts       # 收款状态落库(各通道共用一份)
└── transitions.ts  # 状态转移判断(纯函数,零 DB 依赖)
providers/
├── wechat/         # env / native / signature / webhook
├── alipay/        # env / page-pay / sign / query / webhook
└── shopify/        # 已下线 —— env / client / draft-order / signature / webhook / order-reference
```

- **通道之间共通的那部分**只有三件:**本仓库算价**、**一次支付会话**、**一次
  收款确认**。通道**不参与定价** —— 折后单价在进通道之前就已经折好了。
- **`settle.ts` 是各通道共用的** —— 回调长得完全不一样(验签、报文、状态
  字段名都不同),但回调落地之后要做的事是同一件:「这笔钱到了 → 把订单标成
  已付」。只有一份实现,下面那两条规矩才站得住:
  1. **退款只改 `paymentStatus`**,不动 `status`(退款不是订单状态)
  2. **迟到的收款通知不能把退过款的单改回已付** —— 靠
     `paymentStatus === "refunded"` 挡住(webhook 会重投,投递顺序不保证)
- **幂等不靠去重表** —— 「已经是目标状态 → no-op」就够了。重投一次和重投
  十次,结果一样。

#### 逐分相等

本仓库算出来的每一行单价,必须跟收银台实际收的金额**一分不差**。

- **微信 / 支付宝**天然满足 —— 金额是我们在请求里给的(微信要**分**,支付宝要
  **元**,转换走 `payments/lib/money.ts`,不用浮点)。两个通道都是**人民币**,
  跟本仓库的价同一个币种,**不换算**。
- **Shopify 那条(已下线)**曾经要靠草稿订单 + 建完回读 `presentmentMoney`
  对账才能保证这一点 —— 细节见下面「Shopify 已下线」。

#### 两个通道的 webhook

| 通道 | 路由 | 验签 | 成功响应 |
|---|---|---|---|
| 微信 | `POST /api/webhooks/wechat` | 头 `Wechatpay-Signature`,签名串 = `timestamp\nnonce\nrawBody\n` | `200` + `{"code":"SUCCESS"}` |
| 支付宝 | `POST /api/webhooks/alipay` | RSA2(`rsaCheckV1`:**`sign` 和 `sign_type` 都排除**) | `200` + **纯文本** `success` |
| Shopify | `POST /api/webhooks/shopify`(**已下线** —— 路由还在,只服务老单) | 头 `X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(rawBody, API secret)) | `200` |

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

`GET /api/store/payment-channels` 返回**开放了**的通道,每个带一个
`available`(配好了没)。

- **只返回「开放了」的通道** —— `ENABLED_PAYMENT_CHANNELS` 之外的一个都不
  返回(现在是两个:微信 / 支付宝)。Shopify 和旧路(Sellbase + Stripe)
  **都不在清单里** —— 它们不再接新单。
- **没配好的通道也返回,但前端画成灰的、标「暂未开放」、选不了** ——
  `available: false`。让用户点一个注定失败的按钮比不给这个选项更糟,但把
  选项整个藏起来也不行:工作室要让人看见支持哪几种付款方式。
- 前端的选择器 `src/features/payments/components/payment-channel-picker.tsx`
  用 `Payment.channels.*` 的 i18n 文案,没有翻译就退回服务端给的中文兜底;
  「暂未开放」用 `Payment.unavailable`,一个都配不好时的提示用
  `Payment.noneAvailable`。

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
| Shopify(**已下线**) | 不用配 —— 这条路不再接新单。变量说明留在 `providers/shopify/env.ts` 的文件头(`SHOPIFY_STORE_DOMAIN` / `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` / `SHOPIFY_ADMIN_ACCESS_TOKEN` / `SHOPIFY_API_SECRET` / `SHOPIFY_API_VERSION` / `SHOPIFY_DEFAULT_COUNTRY`) |

##### Shopify 已下线(2026-11-05)

工作室只用**微信 + 支付宝**。Shopify 不在开放名单里 —— 界面上不摆出来、清单
接口不返回、结算不接新单。下面那些环境变量**配不配都无所谓**(配了也不会被
用到)。

**代码留着**,跟旧路 Sellbase 一个待遇:「重新获取付款入口」那条路要能对已经
建好的 Shopify 单说清楚「这条路走不通、为什么」,而不是一个看不懂的 404。
确认没有待付的老单了,整个 `providers/shopify/` 一起拆掉,这些变量也就一起
不用管了。

**哪天要重新开这条路,先看这三件事**(都是 2026-11-05 线上真踩过的):

1. **币种:我们不换算,让 Shopify 换** —— 本仓库的价原样搬进草稿订单,带
   `presentmentCurrencyCode`(展示币种 = 用户被收的那个币种)。**前提是店铺
   得能收人民币**:要么把店铺结算币种改成人民币,要么在 Settings → Markets
   里把人民币加成展示币种。两条都不满足 → **当场报错**,错误文案里写清楚怎么
   改,**绝不拿一个猜的汇率去收钱**。早先那个「后端乘一个写死的
   `SHOPIFY_FX_RATE`」的写法**已经被否掉了** —— 汇率是全局静态值,涨了跌了
   都没人知道。口径见 `providers/shopify/currency.ts`。
2. **API 版本的字段要挑「当前版本有的」** —— GraphQL 的验证是**全有全无**的:
   选了一个当前版本没有的字段,整条 mutation 直接不执行(报的是验证错误,
   不是 Shopify 的业务错误)。2026-11-05 栽过两处:
   - `draftOrderCreate { userErrors { code } }` —— `code` 只在
     `DraftOrderUserError` 上有,旧版本整条查询验证不过 → **只选 `field` +
     `message`**(这两个是 `UserError` **接口**上的字段,哪个版本都在)
   - `order { lineItems { node { properties } } }` —— `properties` 2024-10 起被
     `customAttributes` 取代 → **两个都留着**,先用 `customAttributes`,报
     「字段不存在」就换 `properties` 再来一次(`client.ts` 的
     `buildOrderQuery()` + `isUnknownFieldError()`)。**只有「字段不存在」才
     换写法**,别的错原样往上抛
3. **输入类型的字段名 / 类型也随版本变** —— 2026-11-05 线上栽过两轮:

   | 我们原来发的 | 实际应该是 |
   |---|---|
   | `lineItems[].price` | **`price` 压根不存在**。行价叫 `originalUnitPrice`(`Money` 标量,纯字符串 `"12.50"`)或 `priceOverride`(`MoneyInput` 对象) |
   | `shippingLine.price: {amount, currencyCode}` | **`Money` 标量** —— 纯字符串 `"6.99"`。传对象 → `invalid money` |
   | `shippingLine.handle: "shipping"` | **删掉**。`ShippingLineInput` 没这个字段;而且带了 handle 会被**店铺的运费费率**覆盖掉我们的价 |

   代码里留了一条**写法阶梯**(`draft-order.ts` 的 `DRAFT_ORDER_FLAVORS`,行价
   3 种 × 运费 3 种共 9 种组合):碰到「**字段形状对不上**」
   (`isFieldShapeError()`)就换一种写法重发,按**报错指向的那一处**换。**重发
   是安全的** —— 变量强制转换失败不会建出草稿单。只有形状问题才换写法,别的
   错(金额对不上、凭据不对)原样往上抛。

**凭据模型(2026-01-01 起变了)**:Shopify 不再给永久 token,新 app 给的是
Client ID + Client Secret,拿 Admin API token 改用 **client credentials
grant**(`POST /admin/oauth/access_token`,`grant_type=client_credentials`)——
token **只有 24 小时**,代码里缓存住、到期前 5 分钟自己换、并发单飞
(`providers/shopify/env.ts` 的 `getShopifyAdminToken()`)。**Client Secret 就是
webhook 的 HMAC 密钥**。app 要装在店铺上、且跟店铺同一个组织,scope 要含
`read_orders` + `write_orders`。**密钥纪律**:Client Secret **只进环境变量**,
绝不进仓库文件、绝不进聊天。

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
| `src/test/payments/pure/shopify-signature.test.ts` | HMAC 验签 / 草稿单(**已下线的通道,留着给老单**用) |
| `src/test/payments/pure/shopify-env.test.ts` | Shopify 凭据(Client ID / Secret、grant 换 token、缓存 / 单飞、4xx vs 5xx) |
| `src/test/payments/pure/shopify-currency.test.ts` | 展示币种判定(店铺结算币种 / Markets 两条路,判定失败时报错文案) |
| `src/test/payments/pure/shopify-draft-order.test.ts` | 建单那一整条链路(币种对不上就拒、对账比 presentmentMoney) |
| `src/test/payments/pure/payment-channels.test.ts` | 开放名单 = 清单(两个都摆出来、Shopify / 旧路 stripe 都不在) |
| `src/test/payments/pure/storefront-transition.test.ts` | 状态转移(退款 / 迟到通知) |
| `src/test/payments/pure/linked-print-order.test.ts` | 工单跟着商城订单变 |
| `src/test/storefront/pure/checkout-payment-issue.test.ts` | 「没配好」vs「这次挂了」 |
| `src/test/storefront/pure/cart-snapshot.test.ts` | 订单行的 hash = 购物车行的 hash(付款后摘行靠它) |

#### 上线清单(人工步骤,不在代码里)

按顺序做,少一步就有一条路收不到钱。**两个通道都在「开放名单」里**(界面上
都摆出来),但**能不能付各看各的配置** —— 没配好的那个是灰的、选不了。所以
下面第 2 步做完哪个通道,第 3、4 步就跑哪个通道;没配的那个不用管。

1. **跑迁移** —— `pnpm tsx scripts/apply-payment-channel-schema.ts`
   (给 `storefront_order` / `print_order` 加 5 列 + 2 个索引;幂等)
   + `pnpm tsx scripts/apply-currency-schema.ts`(把 DB 里的币种 / 默认值 /
   商品目录的价对齐到**代码里定义的**人民币;幂等)
   + `pnpm tsx scripts/apply-print-cart-schema.ts`(给 `cart` 加 `kind` 列 +
   `cart_kind_idx` 索引;幂等。**不加这一列,打印单那条路走不通** —— 商城
   购物袋和打印单分不开)
2. **配环境变量** —— 各通道自己的变量(见上面那张表)。**密钥只进环境变量**,
   不进仓库文件、不进聊天。Vercel 上加完变量**要确认新部署已经生效**再让
   用户下单(环境变量是按部署快照的,加变量那一刻的构建可能还没带上它)
3. **登记回调地址** —— 各通道的通知地址要在对应平台上填:
   - 微信:商户平台 → 产品中心 → 开发配置 → 支付通知地址 →
     `https://<站点>/api/webhooks/wechat`
   - 支付宝:开放平台 → 应用 → 开发设置 → 异步通知地址 →
     `https://<站点>/api/webhooks/alipay`
4. **各通道都要用小额真单试一遍** —— 微信扫一次码、支付宝跳一次,确认
   「钱到了 → 订单变 paid → 挂在下面的工单也跟着变 paid → **买掉的那几行
   没了**」。两个通道 webhook 的验签路径不一样,只有真单能验出来。
   商城购物袋(`/cart`)和打印单(`/print-order`)**各试一遍** —— 两张车是
   两条路,各走各的 cookie 和缓存
5. **小程序端的微信支付暂时别开** —— 微信 Native 是扫码,在小程序里扫不了
   自己屏幕上的码。小程序要收微信支付得走 JSAPI(`wx.requestPayment`),
   本仓库**还没实现**

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
  `SELLBASE_NOT_CONFIGURED` / `SELLBASE_FAILED`,现在各条通道都走同一套
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
