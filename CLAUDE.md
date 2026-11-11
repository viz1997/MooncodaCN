# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mooncoda is a production-ready Next.js SaaS template. It provides a complete foundation for building SaaS products with authentication, payments, credits system, background job processing, i18n, admin panel, support tickets, and more. Clone, customize, and ship.

**Deployment:** Self-hosted or Vercel + Neon PostgreSQL + Cloudflare R2 (storage)

## 三方系统分工(2026-11-05 更新)

| 系统 | 职责 | 技术栈 |
|---|---|---|
| **NextDevTpl**(本仓库) | AI 生图 SaaS 后端:user / credits / photo / imageJob / AI 路由 / WeChat 小程序登录 **+ 商品目录(商品 / SKU 变体 / 价格)+ 定价 + 购物车(`/cart`)+ 订单事实 + 收货地址 + 打印工单(打印前工作台 `/tools/workbench` 量 → 点「报价」→ 弹窗里下单 → `POST /api/print-orders` → `print_order`,按 `user_id` 归属,列表在 `/account/print-orders`,工单**自己收款**;打印服务**不进**商城购物袋,车里只有目录商品,见「打印服务直接建工单」)+ 磁吸孔切割工具(`/tools/magnet`,纯前端,**不进工单**,见「磁吸孔切割工具」)** | Next.js 16 + Drizzle + PostgreSQL |
| **微信支付 / 支付宝**(外部服务) | **自己直连的收款通道**:钱直接进我们自己的商户号 / 账户,没有中间层抽成,定价完全由本仓库说了算。**代码写好了,商户号 / 应用还没走完开通流程** —— 界面上摆出来但选不了(见「两个支付通道」的两道闸) | 微信支付 V3 Native(扫码)+ 支付宝电脑网站支付 |
| **Shopify**(外部服务)**已下线** | 曾经只做银行卡 / Shop Pay 的收银台(草稿订单,逐分相等)。2026-11-05 工作室决定只用微信 + 支付宝,**不再接新单** —— 代码留着给老单用,整目录待拆。⚠️ **这一行说的是「收款通道」** —— 工作室**境外那个独立站**(另一个 Shopify 店铺)跟它**不是一回事**,见「外国访客 → 海外独立站」 | Shopify Admin GraphQL API + 草稿订单 |
| **Sellbase**(独立服务)**过渡期保留** | 旧收款路:Sellbase 建单 + Stripe 付款页。**不再接新单**(已建好的旧单还能重取支付入口)。两个新通道跑通后整个 `src/features/sellbase/` 拆掉 | Supabase Edge Functions(**跟本仓库同一个 Supabase 项目**)+ Stripe(MIT) |
| **微信小程序 / 浏览器访客**(外部客户端) | 调 NextDevTpl AI 接口拿候选图 **+ 调 `/api/image-gen/products` 拿商品与 SKU**;调 NextDevTpl `/api/store/**` 加购 + 结算 | Taro 4 + React 18(小程序);Next.js(浏览器) |
| **海外独立站**(外部服务,工作室自营) | **境外 Shopify 店铺** —— 境外的买家在那儿下单。本仓库**只提供一个入口**:`/en` 页面的顶部公告条 + 导航按钮,地址走 `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL`。**不接单、不算价、不碰钱** | Shopify 店铺前端(独立部署) |

**接入形态 = 「本仓库算价,收银台只负责收钱」**(2026-11-05 取代 Sellbase 单通道):
- 本仓库算的价 = `items[].unit_price_amount`;收银台那边只是**载体** + 一个能看懂的标题
- 商城结算:`购物车(DB) → 服务端重算每行价 → 落 storefront_order(_item) → 建支付会话 → 回写 provider_order_id + payment_url(+ 微信的 payment_qr_code_url)→ 前端跳转 / 画码`
- 打印工单:**独立一条线** —— 工单自己建、自己收款(同一个 webhook 体系,同一个状态机),不跟商城订单合账
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

# 迁移脚本 —— 幂等,手写,不走 db:generate。**用户的生产库由用户自己跑**
pnpm migrate:apply-storefront-cart   # 建 cart + cart_item
pnpm migrate:apply-print-order       # 打印工单表
pnpm migrate:apply-print-pricing     # 打印定价配置 + 材料库
pnpm migrate:apply-currency          # 币种 / 默认值对齐到代码
pnpm migrate:apply-payment-channel   # 收款通道那几列

# 资产准备 —— 产物提交进仓库,新克隆的机器不用跑
pnpm magnet:wasm          # 把 manifold-3d 的 wasm 拷进 public/
pnpm magnet:addon         # 把 Blender 桥接打成可安装的插件 zip

# 磁吸孔的 MCP 服务器(stdio)—— 让 AI 客户端直接切磁吸孔
pnpm magnet:mcp
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
| `cart` / `cart_item` | 车落库(**只有一张车** —— 车里**只有目录商品**,打印服务不进车;cookie 是 `wjp_cart_id`);`cart_item.spec_hash` + `(cart_id, spec_hash)` 唯一索引负责「同规格合并」 |
| `storefront_order` / `storefront_order_item` | 商城订单事实;`status`(订单状态)和 `payment_status`(支付状态)**分两列**;收款相关列:`payment_channel`(这单走哪个通道)、`provider_order_id`(平台侧单号,回调反查)、`payment_qr_code_url`(微信扫码的 `code_url`)、`payment_url`(支付宝 / Shopify 的跳转地址)、`sellbase_order_id`(旧路,唯一索引)、`paid_at` |
| `address` | 收货地址簿 —— **必须留在本仓库**,Sellbase 的 `customer.addresses` 只读,没有创建地址的路由 |
| `print_order` | 打印工单;收款相关列跟商城订单同一套:`payment_status` / `payment_channel` / `provider_order_id` / `payment_qr_code_url` / `payment_url` / `paid_at`(外加旧路的 `sellbase_order_id`);另有交期两列 `delivery_tier` / `delivery_fee_cents`(见「打印工单交期档位」);**独立工单**(`storefront_order_id` = null,工单自己收款,见「打印服务直接建工单」);旧单(2026-11-08 之前跟着商城订单结的账)才挂 `storefront_order_id` |

`user.sellbase_customer_id`(原 `medusa_customer_id`)只是**加速指针** —— Sellbase 的 customer 按 **email** upsert,真正的 join key 永远是 email。

### Middleware (`src/proxy.ts`)

> Next.js 16 把 `middleware.ts` 改名成了 `proxy.ts` —— 本仓库里是
> `src/proxy.ts`,**没有** `src/middleware.ts`。找不到 `middleware.ts` 不是你走错了
> 地方,是这个版本的框架改了名字。

Handles three concerns in order:
1. **API rate limiting** — Pattern-matched per-route (auth, upload)
2. **Auth protection** — `/dashboard/**`、`/admin/**` require session token cookie, auth routes redirect if logged in(`/quote` 2026-11-06 和 `/print-order` 2026-11-08 都只剩重定向 —— 前者指到公开的 `/tools/workbench`,后者指到 `/account/print-orders`)
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

打印工单(`/tools/workbench` 量 → 点「报价」→ 弹窗里下单 → `print_order`)有三档
交期,**加价按比例收**,不是固定金额:

| 档位 | 时限 | 比例 | 默认 |
|---|---|---|---|
| `standard` 标准 | 96 小时 | 0 | 不加价 |
| `express` 加急 | 72 小时 | 10% | `PRINT_DELIVERY_EXPRESS_RATE` |
| `urgent` 特急 | 48 小时 | 37% | `PRINT_DELIVERY_URGENT_RATE` |

- **比例是反推出来的**:工作室那张表「48 小时 +¥20.65 / 72 小时 +¥5.59 /
  96 小时 +¥0.00」在**同一个基数(¥55.81)**上,20.65 / 5.59 ≈ 3.70 →
  37% 与 10%(0.37 × 55.81 = 20.6497 → **向上取整 20.65**、0.1 × 55.81 =
  5.581 → **向上取整 5.59**,两个数都精确复现)。
  工作室调价改环境变量,不改代码。**比例跟币种无关** —— 收的是「小计的
  百分之多少」,37% / 10% 这两个数在任何币种下都成立(换个币种时比例一个字
  都不用改,只要基数跟着换)。
  > 72 小时那档从 **¥5.58 变成 ¥5.59** —— 2026-11-08 改成向上取整之后
  > 的结果(见「计价取整:一律向上取整」)。
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

### 计价取整:一律向上取整(2026-11-08)

工作室的原话:**「计价需要向上取整」**。

- **四舍五入在期望上是零和的** —— 一批活里有的多收一分、有的少收一分,长期
  看是平的。但工作室要的是**每一单都不低于算出来的那个数**:少收的那一分钱
  是真金白银的亏损,活越碎越明显(十单各少一分 = 一毛)。
- **口径一句话说得清**:**「我们收的钱,一律向上取整到分」**。

#### 适用范围

**用户付的每一笔钱**:

| 钱 | 在哪儿取整 |
|---|---|
| 克重费 | `quote-server.ts` 的 `yuanToCentsCeil(result.weightFee)` |
| 后处理费(光油) | 同上,`result.varnishFee` |
| 支撑加价 | 同上,`result.supportFee` |
| 支撑加价的**分段明细** | 同上,`band.fee` / `band.price` |
| 交期加价 | `delivery-tier.ts` 的 `computeDeliveryFeeCents()` |

**不包括**后台配的那些单价(`pricing-settings.ts` 里的每克单价、后处理费)——
那些是工作室自己填的整数分,不是算出来的,没什么可「取整」的。

- **引擎内部仍然用「元」(浮点)** —— 取整只发生在**元 → 分那一个边界**上。
  中间不碰,所以 `pricing-engine.ts` 的公式不用改。
- **客户端和服务端读的是同一份实现** —— `print-quote/lib/rounding.ts`。
  客户端预览和服务端算价各写一遍,迟早漂移(前端显示 ¥5.58、后端收
  ¥5.59)。

#### 两个静默的坑

**① 浮点误差被向上取整吃掉** —— `Math.ceil(1.1 * 100)` = **111**,因为
`1.1 × 100` 在 IEEE754 下是 `110.00000000000001`。白多收一分。

```ts
Math.ceil(cents - 1e-9)   // epsilon = 1e-9 分
```

epsilon 比真实的最小零头(0.01 分)小七个数量级 —— **绝不会把「真有零头」
当成「没有零头」**。

**② `-0`** —— `Math.ceil(0 - 1e-9)` 是 **-0**。`-0 === 0` 为真,但
`Object.is(-0, 0)` 为假 —— 落库、序列化、单元断言都当它是另一个数。
`ceilCents()` 把 0 归一化成 **+0**。

#### 支撑分段明细的「差额由最后一档吸收」要反着来

**向上取整之后,各档加起来 ≥ 总额**(每一档都往上走了)。原来那套「最后一档
吸收差额」的逻辑方向反了 —— 现在多出来的一两分要**从最后一档往下扣**,而且
**扣到 0 就不扣了**(不会出现负数的一档)。

- 不变的是那条恒等式:**各档 `feeCents` 之和恒等于 `supportFeeCents`**。
- 界面上看不到这个差额 —— 工单只摆「支撑加价 ¥X(6.7 g × ¥0.50/g +
  6.7 g × ¥1.00/g)」,**不摆每一档的金额**。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/print-quote/pure/rounding.test.ts` | 有一丝零头就往上一分 / **浮点误差不能变成钱** / 真的零头不被 epsilon 吃掉 / **`-0` 归一化成 `+0`** |
| `src/test/print-quote/pure/delivery-tier.test.ts` | 交期加价向上取整(工作室那张表现在是 **+¥20.65 / +¥5.59**)/ 浮点不多收那一分 |
| `src/test/print-quote/pure/support-fee-bands.test.ts` | 各档之和恒等于支撑加价 / **没有负数的一档** / 支撑费向上取整 |

### 打印服务直接建工单(2026-11-08)

工作室的原话(2026-11-08):**「不要放入购物车,放在这里 account/print-orders」**。

**打印服务跟商城购物袋彻底分家** —— 商城购物袋只装**目录商品**(钥匙扣 /
冰箱贴 / 相框 …),打印服务是**另一条线**:工单自己建、自己收款。

```
工具页 /tools/workbench:选模型 → 量克重(几何全在浏览器里算)
  → 点「报价」→ 弹窗(服务端算的预估价 + 下单表单:称呼 / 电话 / 备注 / 收货地址 / 交期 / 支付方式)
  → 提交 → 算支撑 → 模型打包上传 R2(按用户分区)
  → POST /api/print-orders(只带几何 + 地址 id)
  → 服务端**重算**一遍价 → 落一张 print_order → 建支付会话
  → 跳 /account/print-orders/{orderNo} —— 钱在那儿付(微信扫码 / 支付宝跳转)
```

- **工单列表在 `/account/print-orders`** —— 跟商城的「我的订单」(`/account/orders`)
  并排,都在电商首页头像下拉里(见「买家的三样东西搬出控制台」)。
- **`/print-order` → 跳 `/account/print-orders`**,**`/quote` → 跳
  `/tools/workbench`**(`(marketing)` 组下的两个 `page.tsx`,
  `redirect({href, locale})`)。**以前发出去的链接不会 404**,只是落到了现在
  唯一正确的那个页面。
- **商城购物袋回到「只装目录商品」** —— `cart` 表的 `kind` 列在两张车合一的
  时候就删了,现在**车里的每一行都是目录商品**。运费规则回到**一条**:
  目录商品小计不到 ¥99 收 ¥8,到了免(`pricing-constants.ts` 的
  `calculateShippingCents()`);`computeCartTotals()` 也回到**没有**
  `catalogSubtotalCents` / `printSubtotalCents` 那两个字段。
- **打印服务那套购物袋代码整个删掉** ——
  `storefront/lib/print-service.ts`、`storefront/components/print-line-row.tsx`、
  `print-quote/components/print-service-add-to-order.tsx` 都不在了;
  `/api/store/carts/**` 只收目录商品(`catalogLineSchema`),**不认 `printSpec`**。

#### 工单自己收款(2026-11-08)

钱由**工单自己**收 —— 建单时建支付会话(微信 Native 扫码 / 支付宝电脑网站
支付),工单详情页给付款入口。

- **服务端** —— `print-quote/lib/payment.ts` 的
  `ensurePrintOrderPaymentLink()` 先问纯函数
  `print-quote/lib/payment-entry.ts` 的 `decidePrintOrderPaymentEntry()`:
  `paymentStatus === "paid"` → `ALREADY_PAID`;**挂着商城订单** → 返
  `PAY_VIA_STOREFRONT`(不给入口);**独立工单** → 给入口。
- **接口** —— `POST /api/print-orders/[orderNo]/payment-link` 对「挂着商城
  订单」那种单回 **409 `PAY_VIA_STOREFRONT`**,附一句指路的话。
- **界面** —— 工单详情页(`/account/print-orders/[orderNo]`)摆
  `<OrderPaymentButton>`(独立工单)或者一个「去我的订单付款」的链接(旧单)。
  用户侧视图上多一个布尔值 `viaStorefrontOrder`(`quote-types.ts` 的
  `UserPrintOrder`),摆的是**布尔**不是内部 id。
- **`PAY_VIA_STOREFRONT` 还留着** —— 2026-11-08 之前「打印服务并进商城购物袋」
  那一版建出来的工单**跟着商城订单走**,那些单子还在库里,用户还能点开详情页。
  那种单子**不能再开一个入口** —— 开了就是让用户付两次(工单一次、商城订单
  一次)。**收两次钱。**

#### 收货地址(2026-11-08)

- **必填** —— 工作室照着单子寄出去,没有收货地址的单子没法开工。
- **客户端只给 `addressId`**,地址内容由服务端从地址簿取
  (`address/queries.ts` 的 `getUserAddress(userId, addressId)`)——
  **归属校验在数据层**,别人的地址查出来是 null(返 404 `ADDRESS_NOT_FOUND`)。
- **地址快照存进订单** —— `print_order.shipping_address`
  (`ShippingAddressSnapshot`)—— 用户后来改地址簿不改写历史工单。
- **联系邮箱不采信客户端** —— 取账号邮箱(`contactEmail: user.email`)。

#### 交期档位

- **工具页加进来时一律标准档**,用户在**下单表单里**改(表单里摆着三档的
  加价)。
- **加价比例由服务端给** —— 服务端重算报价时把 `deliveryFeeCents` /
  `deliveryRates` 带回来,前端用**同一个** `computeDeliveryFeeCents()` 算三档
  的预览价,所以「页面显示的加价」一定等于「服务端收的加价」。

#### 打印服务下单的几条硬规矩

- **价格只在服务端一处算** —— 工具页(`/tools/workbench`)**不自己算价**;它
  只把几何数据(体积 / 表面积 / 尺寸 / 支撑克重)抛给服务端,价由服务端重算
  (`print-quote/lib/quote-server.ts`)。要改价格口径,只改服务端那一处。
- **模型只在用户点「报价」弹窗里提交那一刻才上传** —— 量重量的过程模型一个
  字节都不出浏览器。上传是下单动作的一部分,不是量重量的副产品。
- **模型归属校验在服务端** —— `isOwnModelUrl(url, objectKey, userId)` +
  `objectExists(objectKey)`:别人的模型、伪造的 URL、指向空对象的链接都不行。
- **收款通道由服务端挑** —— 客户端可以选 `channel`,不传就让服务端挑第一个
  「开放了而且配好了」的(`isPaymentChannelEnabled`)。
- **建单失败不许只摆「请稍后重试」** —— 服务端每个失败都带一个稳定的
  `code`,客户端按 code 查文案表(`print-quote/lib/print-order-error.ts`)。
  购物袋那套 code(`CART_NOT_FOUND` / `ADD_LINE_ITEM_FAILED` /
  `CART_KIND_MISMATCH`)已经**死了** —— 打印服务不碰购物袋。

#### 工具页的出口是「报价」按钮(2026-11-09 改,**2026-11-10 搬到左栏底部固定条**)

工作室的原话(2026-11-09):**「报价不放在右侧了,直接在区域内用一个报价按钮,
点击后显示报价弹窗,弹窗里面去下单」**。

- **出口在工作台区域内** —— 「报价」那颗按钮挂在**左栏底部那条固定条**上
  (`model-settings-panel.tsx` 的 `primaryAction` 插槽;2026-11-10 从浮层
  控制条搬下来的 —— 浮层那条现在**只管「看图」**)。点一下弹**报价弹窗**,
  弹窗里是服务端算的预估价**和**下单表单(称呼 / 电话 / 备注 / 收货地址 /
  交期 / 优惠码 / 支付方式)+ 提交。
- **右栏那一列整个撤掉了** —— 以前工作台右边有 288px 的「提交打印订单」卡片
  (`print-service-submit-card.tsx`,2026-11-09 **删了**)。那一列把 3D 视口挤到
  只剩 ~500px(工作室的原话:「把预览区挤到了左边」)。现在工作台是**一整块**,
  视口拿回整块宽度。
- **这一条推翻了 2026-11-08 的「表单不弹窗」** —— 当时是因为右栏只有 288px
  塞不下那些字段,才把表单展开在工作台下面。现在整块搬进弹窗,字段一个不少。
  (工作室在**后台配置页**那边还是「不要弹窗」的口味 —— 那是另一件事。)
- **弹窗的配色挂在 `.atelier-root` 上** —— atelier 路由组把颜色 token 重定义在
  `.atelier-root` 子树上,Radix 的 Dialog 默认 portal 到 `document.body` ——
  落在子树外面就是全站默认主题。所以 `DialogContent` 传
  `portalContainer={useAtelierContainer()}`。
- **报价状态住在弹窗里** —— 报价 / 交期比例 / 优惠码的结果都在弹窗那一层,
  **外面不留一份旧的**。重算期间报价是 `null`(表单里不摆总额、提交按钮置灰);
  **交期比例不跟着清空**(清空了整块交期选择器会闪一下)。
- **按登录态分两种**:未登录弹窗里**不摆表单**(工单要挂在账号名下),只给一个
  「去登录」(跳登录页,带 `callbackUrl` 回工具页);已登录才摆表单。登录态由
  页面 RSC 查好传下去。
- **必须先登录再量** —— 下单接口要 session(401 `AUTH_REQUIRED`),而登录完
  回来是**整页跳转**(`sign-in-form.tsx` 走 `window.location.href`),内存里
  那个模型选不回来。所以登录得放在量之前 —— 别再搞「量完再登录,登录后把模型
  带回来」那套接力(接力模块 `print-quote/lib/model-handoff.ts` 已经删掉)。
- **提交前会现算一次支撑** —— 支撑**自动算**(模型焊好就算一次,改尺寸 / 转姿态
  之后防抖 400ms 再算一次,见「支撑自动计算」一节),但用户可能**在算完之前**
  就点了提交。提交时 `await ensureSupport()` **拿当前尺寸 + 当前姿态**的支撑
  —— 缓存对得上就复用,对不上就现算一次。少了它,服务端的
  `input.supportWeightG ?? 0` 会把支撑费算成 0(**收少了钱**)。
  **算不出来就不提交** —— 宁可让用户重试。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/print-quote/pure/print-service-order.test.ts` | 工具页发给 `/api/print-orders` / **不碰**商城购物袋 / 建完跳工单详情页 / 商城购物袋接口**只收目录商品** / 服务端重算报价 / 请求体里**没有总价** / 工单**不挂**商城订单 / 地址必填 + 归属校验在数据层 / 模型归属 + 存在性校验 / 邮箱不采信客户端 / **工作台区域内一颗「报价」按钮** / **弹窗里下单** / 没登录给的是「去登录」 |
| `src/test/tools/pure/workbench-merge.test.ts` | **右栏那一列(288px)撤掉了** / 「报价」按钮挂在**左栏底部固定条**上(`primaryAction`)/ 计算器把 `quoteActionSlot` 接到 `primaryAction` / 浮层药丸**只管「看图」** |
| `src/test/print-quote/pure/payment-entry.test.ts` | **独立工单 → 给付款入口**;**旧单(挂着商城订单)→ 不给入口**(不收两次钱) |
| `src/test/print-quote/pure/print-order-error.test.ts` | code → 文案 key 的映射 / 购物袋那套 code **已经死了** / 认不出来的 code 退回 `null` |
| `src/test/storefront/pure/cart-totals.test.ts` | 商城购物袋的金额口径(折扣落在单价上 / 运费只有一条规则) |
| `src/test/sellbase/pure/linked-print-order.test.ts` | 旧单:工单跟着商城订单变 |

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
- **车里的每一行都是目录商品** —— 打印服务 2026-11-08 起**不进**购物袋(它
  自己建工单,见「打印服务直接建工单」)。
- 页面在 `(marketing-atelier)` 组(跟 `/checkout` 一条路)—— 商城这一套
  (`/cart` / `/checkout` / 购物袋抽屉)共用商城的头部 + 抽屉。**工具页
  (`/tools/workbench`)也在这一组**(量完点「报价」,弹窗里下单)。

### 模型从工具页直接建工单(2026-11-08,**2026-11-09 改了出口**)

打印服务对外只有**一个出口**:工具页(`/tools/workbench`,量克重)→ 提交打印
订单 → `/account/print-orders/{orderNo}`(工单详情页付款)。

```
/tools/workbench  →  「报价」按钮  →  报价弹窗里下单  →  /account/print-orders/{orderNo}  →  付款
```

- **量完直接下单,不再绕一圈** —— 工具页**视口底下那条控制条上的「报价」按钮**
  是唯一出口(2026-11-09 之前是右栏那张「提交打印订单」卡片,那一版整个撤了 ——
  详见「工具页的出口是「报价」按钮」)。点「报价」→ 弹窗(预估价 + 下单表单)→
  提交:算支撑 → 模型打包上传 R2 → `POST /api/print-orders`(只带几何 + 地址 id)
  → 服务端重算价 → 落一张 `print_order` → 建支付会话 → 跳工单详情页。
- **几何数据走请求体,价格走服务端** —— 计算器把体积 / 表面积 / 尺寸 /
  支撑克重推给父组件(`PricingCalculator` 的 `onQuoteInput`),提交时一起发
  上去;**价不在这儿算**,服务端重算(见 `print-quote/lib/quote-server.ts` 的
  `computePrintQuote(settings, input)`)。
- **计算器不再有「报价模式」** —— 早先 `quoteMode` 控制着「几何要不要抛给
  父组件」,报价台删掉之后这个开关没了,几何**一直**推给父组件。
- **工具有两个出口状态** —— 未登录:弹窗里给「去登录」;已登录:弹窗里摆
  下单表单。
- **先登录再量** —— 下单接口要 session(401 `AUTH_REQUIRED`),而登录完回来
  是**整页跳转**(`sign-in-form.tsx` 走 `window.location.href`),内存里的
  模型选不回来。所以登录放在量之前,弹窗里写明了这一条。
  早先那套「模型接力」(`print-quote/lib/model-handoff.ts`,靠模块级变量
  跨路由跳转)已经删掉 —— 接力只扛得住客户端路由跳转,扛不住登录往返。
- **摆盘结果不接力** —— 提交上去的是**当前姿态**的支撑克重(智能摆盘
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
- **徽标只摆事实,不拦人** —— 有问题照样能提交打印订单(工作室可能有特殊处理
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
- **两个视角的侧栏同宽(`md:w-[360px]`)** —— 不然切一次视角视口宽度就变,
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
- **下单出口在视口底下那条控制条上** —— 2026-11-09 起,「报价」那颗按钮就
  挂在**深色应用里面**(浮层控制条)。以前那张「提交打印订单」卡在深色应用
  **外面**(页面里的一张浅色卡),2026-11-09 整个撤了 —— 见「工具页的出口是
  「报价」按钮」。
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
- **改角度 → 支撑**不**实时重算** —— 改角度只改 `viewerRotX/Y/Z` +
  `manualRotX/Y/Z`,**不发任何指令给 Worker**(拖一下就重算一遍,数字一直跳、
  Worker 队列一直满)。支撑**自动算**,但**防抖 400ms**(见下面「支撑自动计算」)。

#### 旋转控制器 / 支撑自动计算 / 全屏(2026-11-07,**支撑那条 2026-11-10 改了**)

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

##### 支撑自动计算 —— 跟着尺寸和姿态走(2026-11-10 改)

工作室 2026-11-07 的口径是**「支撑不要跟随变化实时变化,用户确定角度后点击
显示支撑才计算支撑、总克重」**。**2026-11-10 推翻了它** —— 工作室点名的那条:
模型刚进来,三个克重数里有两个是「—」,用户以为工具坏了。

```
模型焊好            → 立刻算一次 → 三个数立刻齐全(第一次不等 400ms)
改尺寸              → 400ms 防抖后算一次
转姿态(拖控制器)   → 400ms 防抖后算一次(拖的过程中不算)
点「置于平面」      → 立刻重算一次
点「包裹支撑」      → **只管画不画**,不再触发计算
```

- **「改尺寸要重算」≠「实时重算」** —— 尺寸变了,支撑克重就是**另一个数**,
  不重算就是把**旧尺寸**的支撑费按新尺寸的单子收 —— **少收钱**。但实时重算
  意味着拖一下滑块就重算一遍:数字一直跳、Worker 队列一直满(工作室不要
  这个)。所以**防抖 400ms**(`SUPPORT_RECALC_DEBOUNCE_MS`):改完停下来安静
  一会儿再算。
- **两级键** —— `currentSupportKey`(活的)→ 防抖 → `supportRequestKey`
  (算支撑那个 effect 的**唯一**触发条件)。计算 effect 的依赖里有
  `supportRequestKey` **没有角度**:拖一下控制器只会重跑防抖那个 effect,
  不重跑计算。
- **缓存键就是钱的守卫** —— 纯函数在 `pricing/lib/support-cache-key.ts`:
  键 = **姿态**(打印姿态 `manualRot*`,**不是**相机 `viewerRot*` —— 转相机
  不该重算支撑)+ **缩放**(`appliedScales`),各取三位小数。0.0001° 的抖动
  算同一个键,0.01° 算另一个。
- **写回时对照键** —— 算的过程中用户又动了(改了尺寸 / 转了姿态)⇒ 算出来的
  是**过期参数**的结果,**丢掉**(`if (usedKey !== currentSupportKeyRef.current)
  return;`),等 400ms 后新那一次。数字跟画面因此永远说的是同一组参数。
- **「包裹支撑」那颗开关只管画不画** —— 外壳本来就在**同一次**计算里带回来
  (`withShell: true`),数字跟画出来的那圈必须是同一块几何(硬口径)。
  `showSupport` 仍默认 `false`(外壳是这一页最贵的一块几何),但**克重数
  不再等它**。
- **四态读数** —— `supportState`:`computing`(还没算出来)/ `updating`(手上
  的是旧参数的结果,正在更新)/ `ready`(新鲜)/ `error`(算失败)。
- **报价输入里的支撑克重跟着走** —— 不是新鲜的(`supportFresh` 为假)就摆
  `null`(界面摆「未计入」),**不许**拿旧数当新的用。

**但「提交打印订单」必须带上支撑克重** —— 服务端按这组数重算报价
(`quote-server.ts` 的 `input.supportWeightG ?? 0`),少了它支撑费会算成 0,
**收少了钱**。(2026-11-09 起提交动作发生在**报价弹窗**里,这条不变。)所以计算器
对外留了一个入口:

- `EnsureSupportFn`(`pricing-calculator-types.ts`)——
  `() => Promise<PrintQuoteInput | null>`,「按**当前尺寸 + 当前姿态**把支撑算出来」。
- `pricing-calculator.tsx` 的 `ensureSupport`:**三个条件都成立**才算缓存命中 ——
  ①有算过的结果 ②那份输入里**真的带上了**支撑克重 ③**缓存键对得上当前的
  尺寸与姿态**。第 ③ 条是**钱的守卫**:改完尺寸直接提交,发上去的必须是
  **新尺寸**的支撑克重 —— 旧尺寸那个数会让服务端**少收支撑费**。
  缓存没命中就现算一次(`withShell: false` —— 只要数,不要那块最贵的外壳;
  **不写 `poseSupport`**,免得把用户正在看的那圈支撑擦掉)。
- 入口通过 `onEnsureSupport` 交给父组件(`print-service-weight-tool.tsx`),
  提交之前在那儿 `await ensureSupport()` —— 提交那条路自己会算,不用用户点
  「包裹支撑」那颗按钮。

**两道兜底 —— 别让「算不出支撑」变成「收少了钱」**:

- **模型还没焊完 → 等它** —— 用户刚拖进模型就点「报价」然后提交是常事,而
  焊接大模型要好几秒。`ensureSupport` 这时候先 `await` 焊接那个 promise
  (`supportLoadRef`),再算支撑。
- **算不出来 → 不提交** —— 提交那条路拿 `ensureSupport()` 的结果,**拿不到就
  报错退出**,不许退回「只有几何、没有支撑克重」的 `input` 那样去提交:
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
  | `src/test/tools/pure/support-auto.test.ts` | **支撑是自动算的**(焊好就算一次)/ **防抖 400ms** / 写回时对照缓存键 / 「包裹支撑」只管画不画 / 四态读数 / **提交之前会现算一次支撑**(少了它服务端收少了钱)/ **算不出来就不提交** / **模型没焊完会等它** |

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
- **在哪儿** —— **克重栏**那一格里,挨着「包裹支撑」(`MoveDown` 图标)。
  2026-11-10 起浮层控制条**只管「看图」**(显示贴图 / 重置视角),两颗支撑
  相关的按钮都留在克重栏 —— 支撑是**克重**的事,不该摆在看图的药丸上。
- **跟「包裹支撑」的区别** —— 那颗现在**只管画不画**(算支撑已经自动了,
  见「支撑自动计算」一节);这颗是**动作**(永远落在平台上 + 立刻按当前
  参数重算一次)。
- **令牌 `supportRecalcToken`** —— 光把 `showSupport` 打开**不一定**会重算:
  开关本来就开着(用户没转过模型)、或者上一次算失败(用户想重试)的时候,
  那个 effect 的依赖没变,不会跑。所以另备一个令牌:点一次 +1,effect 的依赖
  里带着它 ⇒ **一定会重算**。
- **键要是最新的那把** —— `placeOnPlane` 里除了令牌,还直接把
  `supportRequestKey` 设成 `currentSupportKeyRef.current` —— 用户可能刚改完
  尺寸,防抖还没到,那把键是旧的。不直接写就等于「按旧尺寸落座」。
- **落座不碰角度** —— `placeOnPlane` 里没有 `setManualRot*` / `setViewerRot*`:
  它是「落座 + 重算」,不是「改姿态」。
- **提示文案跟着改口** —— 「点「包裹支撑」按当前角度算」→「点「置于平面」按
  当前角度算并落座」(浮层条 + 克重栏两处,中英各一份)。
- **行为由单测守住** ——
  | 测试 | 守住什么 |
  |---|---|
  | `src/test/tools/pure/support-auto.test.ts` | 这颗按钮在克重栏里 / 按下去 = 打开支撑 + 令牌 +1 + 键设成最新的 / 令牌在算支撑那个 effect 的依赖里 / 落座**不碰角度** |

### 工作台改版:支撑自动算 / 主出口上浮 / 一张脸(2026-11-10)

工作室 2026-11-10 重新提了一遍设计,点名的是这几条:

| 工作室的原话 | 改成了什么 |
|---|---|
| **「克重默认两个『—』」** | 支撑**自动算** —— 模型一焊好就算一次,改尺寸 / 转姿态之后防抖 400ms 再算一次(见「支撑自动计算」一节) |
| **「主出口提到左栏底部固定条」** | 「报价」从浮层药丸搬到**左栏底部的固定条**(`primaryAction` 插槽) |
| **「药丸只留看图的工具」** | 浮层药丸只留「显示贴图」「重置视角」;问题图层开关搬进检查侧栏;支撑那两颗按钮搬进克重栏 |
| **「页面两张脸」** | 整页统一成 `bg-zinc-950 text-zinc-100`,**介绍段删了** |
| 「实际不是空的」(模型读不出来) | OBJ 改成**按字节读 + 编码嗅探**,空文件说人话 |

#### 主出口上浮:左栏底部的固定条

- **插槽改名** —— `ModelSettingsPanel` 的 `toolbarExtra` 变成 **`primaryAction`**。
  以前那颗按钮挂在浮层药丸的尾巴上,还是一个不起眼的小白按钮 —— 一眼看过去
  不知道那是个**出口**。底部固定条是**每一个视角都在**的位置(切一下 tab 它
  不会消失),而且那一格**只放它一个东西**,想找不到都难。
- **两个 `<aside>` 都有这条固定条** —— 检查侧栏和克重侧栏各一条,固定条
  `shrink-0 border-t`,内容区自己 `flex-1 min-h-0 overflow-y-auto` 滚。
  固定条**不参与滚动** —— 报价按钮永远在眼皮底下。
- **固定条是深色的** —— 挂进来的东西要自己按深色配色写(那颗按钮是琥珀色
  的整宽 CTA,不是浅色按钮)。
- **报价弹窗本身没动** —— 还是「服务端算的预估价 + 下单表单 + 提交」那套。

#### 浮层药丸只管「看图」

药丸以前挤着七样东西:问题图层开关、显示贴图、包裹支撑、置于平面、重置视角、
支撑状态文字、报价按钮。现在:

| 去处 | 东西 |
|---|---|
| **留在药丸** | 显示贴图、重置视角(两个都是**看**的工具) |
| **搬进检查侧栏** | 问题图层开关 + 图例(`ModelCheckSidePanel` 的 `legend` / `visibility` / `onToggleVisibility`) |
| **搬进克重栏** | 包裹支撑 / 置于平面 / 支撑状态文字(支撑是**克重**的事) |
| **搬到底部固定条** | 报价 |

药丸本身改成 `flex-nowrap` —— 以前挤不下会换行,换行后的药丸一半压在模型上。

#### 整页一张脸(深色)

- 外壳统一 `bg-zinc-950 text-zinc-100`,深色工作台落在一块**同色**的底上,
  只剩一条边框。
- **介绍段删了** —— 那一大段 h2 + p 是「克重计算器」独立首页的自我介绍,挂在
  打印工作台上是噪音,而且它是**浅色**的,正是「两张脸」的来源。算法细节本来
  就在「克重算法」弹窗里(`info.algorithm.*`),不丢信息。
- 页脚被 `showChrome={false}` 挡着,所以 `footer.tagline` 那句「计算在本地
  浏览器完成」在介绍段的位置**单独摆一次** —— 打印服务最需要让用户知道的
  就是「模型不上传」。

#### 打印工作台只开「上传」这一个模式

- 新增 `modes?: Mode[]` prop(默认三个全开)。打印工作台传 `modes={["upload"]}`。
- **「手动尺寸」是死路** —— 手动模式**没有模型文件**,而打印工单必须上传模型
  文件到 R2 —— 它永远走不到下单。
- **「批量克重」是另一个工具**(批量量重),没有下单出口。
- **只剩一个模式时整段模式切换不渲染** —— 一颗只有一个选项的切换器是噪音。
  代码不删(`batch-mode-section.tsx` / `batch-processor.ts` 原样留在树里),
  想恢复只要把模式放回这个数组。

#### OBJ 按字节读 + 编码嗅探(`pricing/lib/obj-text.ts`)

- **为什么不用 `file.text()`** —— 两个问题:
  1. **它不告诉你文件有多大** —— 读出来是空的时候,界面只摆一句「空 OBJ 文本」,
     用户看着像**自己的模型坏了**。其实浏览器拿到的就是个 0 字节的文件(从压缩
     包里直接拖、云盘占位符没下载完、拖的是快捷方式)。工作室报的那条
     「实际不是空的」就是这个:**文件不是空的,是浏览器读了个空壳。**
  2. **`File.text()` 永远按 UTF-8 解** —— Windows 上很多工具导出的 OBJ 是
     **UTF-16**,按 UTF-8 解出来是一堆带 NUL 的乱码 —— worker 一个顶点都认不出来。
- **现在** —— 先拿**字节**,自己判编码,再解码:
  - **先看 BOM** —— `FF FE` → UTF-16LE,`FE FF` → UTF-16BE,`EF BB BF` → UTF-8
    (UTF-8 的 BOM 要**自己摘掉**,worker 的切词逻辑不认 BOM)。
  - **没 BOM 就看 NUL 的密度** —— 前 512 字节里 NUL 超过 1/8 ⇒ UTF-16。
    字节序看 NUL 落在**奇数位**(LE,低字节在前)还是**偶数位**(BE,高字节在前)。
- ⚠️ **`TextDecoder` 的标签中间有连字符** —— `"utf-16le"` / `"utf-16be"`。
  直接把 `"utf16le"` 丢给 `new TextDecoder()` 会抛
  `RangeError: The "utf16le" encoding is not supported`。我们自己的标签
  (`ObjEncoding`)跟 `TextDecoder` 的标签**不是一回事**,中间隔一张
  `DECODER_LABEL` 映射表。
- **MTL 也走同一套解码** —— 材质表和 OBJ 可能是同一个编码,只解 OBJ 会出现
  「OBJ 解出来了、材质表是乱码」。
- **空文件说人话** —— `describeEmptyObjFile(size)` 分两种:
  `size === 0` 说「你的文件多半是好的,是传输环节丢了内容,先复制到本地再拖」;
  `size > 0` 说「编码既不是 UTF-8 也不是 UTF-16(可能是 UTF-32),另存一份 UTF-8 再试」。

#### Worker 挂了就主线程兜底

- worker 源码是一段**自包含**的脚本(只用 `self.onmessage` / `self.postMessage`,
  没有任何 worker 专属 API),所以可以在主线程里用 `new Function` 原样跑一遍 ——
  跟 Node 单测里那套 harness 一个路子。
- **代价** —— 大模型会**卡主线程**好几秒(Worker 那条路不卡)。所以**只在 Worker
  真出错时才走它** —— 宁可卡一下,也不能让工作室的模型传不进来。
- **超时不做兜底** —— 那说明模型大到 Worker 跑 30 秒都跑不完,主线程只会更久
  (而且会把整个页面冻住)。这种模型本来也不该走浏览器这条路。
- **CSP 禁了 `unsafe-eval` 的话 `new Function` 会抛** —— 捕获住,返回 `null`,
  让调用方报**原来那条**错误(别把真原因换成「兜底也失败了」)。

#### 改尺寸后画面里出现两个模型 —— 先摘再 dispose

- **症状** —— 用户改完尺寸,视口里出现**两个大小不同的模型**(一个是旧的)。
- **根因** —— 重建网格时直接 `disposeMesh(oldMesh)` 了,但**没先把旧网格从场景
  里摘掉**。`dispose` 只释放 GPU 资源,`Object3D` 还在场景图上 —— 于是那个
  「已经没有 GPU 资源」的旧网格还挂在姿态组里等着被渲染。
- **修法** —— **先摘,再 dispose**:
  ```ts
  const oldMesh = meshRef.current;
  if (oldMesh) {
    poseGroup.remove(oldMesh);
    disposeMesh(oldMesh);
  }
  ```
- `disposeMesh` 处理材质数组(多材质的网格一个都不漏),所以这条对多材质模型
  一样成立。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/tools/pure/support-auto.test.ts` | 支撑**自动算** / **防抖 400ms** / 第一次立刻算 / 写回时对照缓存键 / 「包裹支撑」只管画不画 / 四态读数 / 提交前的两道兜底 |
| `src/test/pricing/pure/support-cache-key.test.ts` | 同一组参数 ⇒ 同一个键 / 改尺寸 ⇒ 换键 / 转姿态 ⇒ 换键 / **0.0001° 抖动算同一个键、0.01° 算另一个** / 姿态和尺寸都参与 / 键里存的是取整后的值 / 缺省缩放当 1 |
| `src/test/pricing/pure/obj-text.test.ts` | BOM 嗅探 / NUL 密度嗅探(**LE ⇒ 奇数位、BE ⇒ 偶数位**)/ UTF-16LE·BE 解码 / UTF-8 BOM 摘掉 / 空文件的两种说法 |
| `src/test/tools/pure/workbench-merge.test.ts` | 一个视口 / 侧栏在左 / **主出口在左栏底部固定条**(`primaryAction`)/ **浮层药丸只管「看图」** |

### 磁吸孔切割工具 `/tools/magnet`(2026-11-10,**2026-11-11 加了三条 + 两条引擎 + 四条**)

工作室给了一段 Blender Python 脚本:把模型**最平的那个面**上挖一个**盲孔**
(圆柱沉孔),挖完导出 `relief_final.obj` 给打印用。以前这段脚本**只能在工作室
本地的 Blender 里跑** —— 客户拿不到这个能力,工作室每单也要手工过一道。

网页端复刻这条链路,核心是**布尔运算**。脚本自己已经暴露了「为什么要好引擎」:
它用 EXACT 求解器、还带 FAST 兜底,切完还要专门清法线 —— 说明 BSP 那种布尔在
这个模型上不够干净。而 **Manifold3D 正是 Blender EXACT 求解器背后的那个引擎**
(elalish/manifold,Apache-2.0),它保证输出是流形,并能修复非流形输入。

#### 跟 Blender 脚本**不一样**的那一处(重要)

脚本里有这么一段:

```python
ratio = max_dim_mm / EXPECTED_WIDTH_MM   # EXPECTED_WIDTH_MM = 60.0
radius = ((HOLE_DIA_MM + TOLERANCE) / 2000.0) * ratio
```

孔径**跟着模型最大边一起缩放**。那是当年为了绕开「Meshy 导出来的 7000mm」问题
临时加的假设。**网页端知道最终打印尺寸,不需要这个假设** —— 照搬会让一个 40mm
宽的模型只得到 Ø13.8mm 的孔。

⇒ **孔径按实物毫米**:默认 Ø20.7mm / 深 1.3mm(磁铁是固定尺寸的实体),
2026-11-11 起**用户可以调**,但**调完仍然是绝对毫米**(孔是实物的尺寸,不是模型
的比例)。`magnet-params.ts` 里**没有** `EXPECTED_WIDTH_MM`(单测守着这条)。

#### 五条口径(跟工作室确认过)

| 决定 | 口径 |
|---|---|
| 工具位置 | **独立页面 `/tools/magnet`** —— 不塞进打印工作台 |
| 孔径 | **绝对毫米**(默认 Ø20.7 / 深 1.3,**可调**)—— 不跟模型缩放 |
| 与工单的关系 | **不进工单** —— 只本地下载,下单时仍传原始模型,工作室自己在 Blender 里切 |
| 独立站入口 | **只在 `/en` 页面**:顶部公告条 + 导航按钮 |
| **用户的模型** | **不因切割而改变几何** —— 破口只是**临时**封上,切完原样还给你(工作室 2026-11-11:「不需要修复用户的模型,只需要完成磁铁孔」) |

「不进工单」这一条把风险面砍掉了一大半:**钱的那条链路一行都不动**(报价、工单、
R2 上传、支撑克重全部原样)。工具是纯前端的、独立的、可下载的。

#### 两条引擎(2026-11-11 加,工作室拍板「让用户自己选」)

工作室 2026-11-11 的三条追加要求之外,又定了「**让用户选择是否开启使用便携版
Blender**」。工作室后面又补了三句,把这条路彻底定死了:

| 工作室的原话 | 落成了什么 |
|---|---|
| **「不需要服务器,所有都在本地处理」** | 走 `http://127.0.0.1:<端口>`,**没有 API 路由、没有上传、没有登录** |
| **「是运行用户自己本地的 Blender」** | 切孔在**用户自己那台电脑**的 Blender 里跑(不是我们的服务器) |
| **「可以指引用户下载便携版 Blender」** | 侧栏摆**官方便携版下载链接** + **插件下载链接** + 装法说明 |

**两条引擎,用户自己选**(侧栏顶部那颗开关):

| 引擎 | 干什么 | 适合谁 |
|---|---|---|
| **浏览器**(默认) | Manifold3D(WASM)在 Worker 里跑,**模型破了自己清 + 临时封上** | 大多数模型(**不用装任何东西**) |
| **本地 Blender** | 装一个插件,切孔在用户自己电脑上跑 | **自相交**那种修不好的模型 |

**为什么要有第二条路** —— 浏览器那条路**会自己清 + 临时封**(剔重复面 / 拆蝴蝶结
顶点 / 翻绕序 / 临时盖面,见下面「三道闸」第 ② 条),**不因为「不是封闭实体」就拒收**
(工作室 2026-11-11 的原话:**「不要因为这个问题切不了」**)。但**自相交**
修不了 —— 那种模型 manifold 的 EXACT 布尔算不出来。Blender 那边有
EXACT → FAST 兜底 + 一堆修复 pass,正好治这个。**所以这条是兜底,不是必经之路。**

#### 「为什么需要插件」—— 页面自己得回答这个问题(工作室 2026-11-11 问的)

工作室的原话:**「为什么需要插件」**。答案有三层,**页面上必须说清楚**,不然
用户看到「本地 Blender 切」就以为要装插件,直接走了:

| 问题 | 答案 |
|---|---|
| **必须装吗?** | **不用** —— 默认那条「浏览器内切」**什么都不用装**(wasm 引擎在浏览器里跑) |
| **那这条是干嘛的?** | 兜底 —— 只给**自相交**那种浏览器引擎算不出来的模型 |
| **「插件」是什么?** | **不是装进 Blender 的扩展** —— 就是那份 `blender_bridge.py`,**双击启动脚本**就跑起来了(Blender 以 `--background` 在后台跑,不开界面) |

- **它只做一件事** —— 在你电脑的**回环地址**上开一个端口,让网页把模型递进去、
  把切好的模型拿回来(Blender 自己没有 HTTP 服务,网页也没法直接跟桌面程序说话)。
- **侧栏有一句 `engine.blenderWhy`** —— 上面那三条都写在里面(切到「本地 Blender
  切」那一栏才出现)。
- **`BLENDER_NOT_RUNNING` 的文案说**两个**可能的原因** —— ① 桥接没在跑(双击启动
  脚本)② 浏览器拦了「公网页面访问本机」(Chrome 新版的本地网络权限)。以前只说
  「确认插件已经跑起来」,把②那条路堵死了 —— 用户桥接明明起着,还是看到同一句。
  **文案里同时指着零安装那条路**(「不想折腾就用默认的「浏览器内切」」)。
- **浏览器引擎布尔失败时 ⇒ 指到本地那条路** —— `errors.codes.booleanFailed` 里
  补了一句「常见原因是几何自相交 —— 浏览器里的引擎算不了这种模型,可以切到
  「本地 Blender」那条路」。**兜底路径要在用户需要的时候被指出来**,不是摆在
  侧栏里等人自己发现。

**本地 Blender 那条路不跑浏览器的分析** —— 浏览器的分析(以及修复)管的是
**封闭实体**那一套,插件自己挑面(按面积找最大的平面,跟工作室脚本一个口径)。
所以那条路**必须能在浏览器分析失败时照样切**。侧栏的候选面表格在 Blender
模式下**隐藏**(那一块换成了 `engine.faceNote`)。

**三条硬规矩**(都在 `blender-local.ts` 的文件头里写着):

1. **模型不出这台电脑** —— 走回环地址,不是我们的服务器。
2. **只跟 `127.0.0.1` 说话** —— `blenderBaseUrl()` **写死**回环,端口以外的
   一概不接受(别让它变成一个能往公网发数据的代理)。
3. **每个失败都有稳定的 code** —— 四个新码见下。

**协议(网页端 ↔ 插件)**,协议版本 `1`,两边必须对得上:

| 方向 | 请求 | 响应 |
|---|---|---|
| 探活 | `GET /ping` + 头 `x-magnet-protocol` | JSON `{ protocol, blender, addOn }` |
| 切割 | `POST /cut`,body = zip(OBJ+MTL+纹理),头 `x-magnet-params`(孔径/深度)+ `x-magnet-protocol` | zip(切好的模型)+ 头 `x-magnet-stats`(统计 JSON) |

- **插件在仓库里** —— `public/magnet/blender_bridge.py`,页面直接给下载链接。
  它**只绑 `127.0.0.1`**、带 `Access-Control-Allow-Private-Network: true`
  (Chrome 的私有网络访问 —— 不带这个头,公网页面**连不上**本机插件)、
  **不用 `bpy.ops`**(算子要上下文,timer 里调不稳)、布尔运算 EXACT 失败退 FAST。
- **混合内容不是问题** —— 浏览器把 `http://127.0.0.1` 当「可信来源」,所以
  https 页面 fetch 它**不会被拦**。Safari 早期版本会拦 ⇒ 界面要能说清楚
  「换 Chrome / Edge」。
- **发过去的是「浏览器缩放好」的几何** —— 「看到的」跟「切的」是同一份,两个
  引擎对尺寸和朝向的判断才不会打架。
- **超时给得足** —— ping 2.5s,切割 **10 分钟**(大模型在 Blender 里切要好几分钟)。
- **下载语义** —— Blender 模式下,切好的 zip **原样下载**(材质/纹理是 Blender
  那边导出来的,不经我们重新导出);浏览器模式下还是走原来那条 OBJ/ZIP 导出。

#### 「为什么没有调用便携版 Blender」(2026-11-11 工作室问的)

工作室原话:**「为什么没有调用便携版blender」**。答案分两半,一半是**浏览器的
硬限制**,一半是**真的缺陷**(已修)。

**① 网页**起不了**本机程序** —— 没有这种 API。浏览器沙箱里没有 `fork` /
`exec`,页面**唯一**能做的就是跟一个**已经在跑**的进程说话。所以:

- 「一键启动便携版 Blender」**只能是给用户一个可执行的启动脚本**(下载下来
  双击)—— 网页**不可能**替用户把程序拉起来。
- 页面侧栏现在摆三样东西:**启动脚本**(`.cmd` / `.sh`)+ **便携版 Blender
  下载链接** + **插件下载链接**,外加一句「双击启动脚本 → 回到网页点检测」。
- `MAGNET_BLENDER_LAUNCHER_URL` / `MAGNET_BLENDER_LAUNCHER_SH_URL`
  (`blender-local.ts` 里唯一定义的地方)。**页面不许出现任何
  `child_process` / `spawn` / `execFile`** —— 那在浏览器里根本不存在。
- 启动脚本做的事:找 `blender.exe`(便携版解压出来的 / 装好的那几处常见路径)
  → 找 `blender_bridge.py` → **清掉旁边的 `__pycache__`** → `blender --background
  --factory-startup --python blender_bridge.py`。找不到就**说清楚缺什么、去哪下**
  (`blender.org/download/`)。**命令执行,不打开 GUI** —— 便携版是当命令跑的,
  不该弹一个 Blender 窗口出来。

**② Blender 那条路以前会「修」用户的模型** —— 现在**跟浏览器那条一样**:
破口**临时封上**再切,切完把封面**摘掉**,用户的模型上**不多出任何几何**。

| | 浏览器那条路 | Blender 那条路 |
|---|---|---|
| 怎么认封口的面 | **manifold 的 run id**(预留 id) | **临时材质槽** `__magnet_lid__` |
| 怎么保证不落在 0 号槽 | 预留 id 从 1 起 | 另加一个 `__magnet_placeholder__` 占位 |
| 切完怎么摘 | 按 run id 摘掉那一组三角形 | 按材质槽摘掉那几张面 |
| 布尔用不用 `use_hole_tolerant` | 不用(它会**悄悄修**模型) | **盖上了就关掉**(`hole_tolerant=not lid["closed"]`) |
| 摘完之后 | 破口**还在**(拿到的确实是「你的模型 + 一个孔」) | 同左 |

- 插件里的对应实现:`_find_boundary_loops` / `_cap_boundary_loops` /
  `_drop_material_slots` / `_strip_lid_faces`,材质槽前缀 `__magnet_`。
- 统计里多三个数:`lidCapped`(封了几处破口)/ `lidFaces`(封了几张面)/
  `lidStripped`(摘掉了几张面)⇒ 界面摆一条**中性**的告知(灰色,不是琥珀色):
  「破口临时封上再切,切完原样还给你」。

#### 「为什么还要端口?为什么还要探活?」(2026-11-11 工作室问的)

工作室的第二句:**「便携版是命令执行的不会打开GUI,为什么需要端口检查本地
blender」**。两件事要分开看:

**① 端口 = 传输通道,跟有没有界面无关。**

模型在**浏览器的内存里**,切孔在**另一个操作系统进程**里。网页能跟本机另一个
进程说话的方式只有一条:**回环上的 socket**。另一条路(网页往某个文件夹里
写文件、Blender 去盯着那个文件夹)浏览器给不了 —— File System Access API
要用户逐个授权目录,而且只有 Chromium 系支持。所以端口**不是**「因为要开个
GUI」,是**因为模型得从浏览器搬到另一个进程里**。

**「命令执行」≠「一次性跑完」** —— 如果桥接真是一次性命令(跑一次、吐一个
文件),用户就得**手动**把模型拷进去、再把结果拷回来,而且网页**不知道**它
什么时候跑完。端口让它变成「网页点一下 → 那个进程干完 → 网页拿到结果」。

**② 探活 = 握手 + 故障分诊,不是「检查 Blender 还在不在」。**

`GET /ping` 干三件具体的事:

| 干什么 | 不探活会怎样 |
|---|---|
| **协议版本对一下**(页面要 v1) | 插件版本对不上时,切割请求会以一种没法解释的方式失败 |
| **拿 Blender 版本号**摆给用户看(「连上了 —— Blender 5.2.0 LTS」) | 用户不知道自己连上的是哪个 Blender |
| **把失败分诊**:`BLENDER_NOT_RUNNING`(没起)/ `BLENDER_FAILED`(切失败)/ `BLENDER_TIMEOUT`(切太久) | 对着一个没开的端口 fetch,浏览器只抛一个 `TypeError: Failed to fetch` —— 用户看到的是「切割失败」,真因其实是「你还没启动桥接」 |

**③ 顺手修的:桥接真的改成无 GUI 了**

`--background` 有个坑:**跑完 `--python` 脚本 Blender 就退出**,GUI 的事件循环
压根不存在 ⇒ `bpy.app.timers` **永远不会触发** ⇒ 作业堆在队列里,HTTP 线程
干等到 900 秒超时,网页端只看到一个没头没尾的 `BLENDER_TIMEOUT`。

⇒ 后台模式下**脚本自己不返回** —— `_pump_forever()` 在**主线程**里轮询队列
(跑活必须在主线程:bpy 的上下文只能主线程碰)。图形界面模式(粘到 Scripting
里跑 / 装成插件)照旧用定时器,两条路**由 `bpy.app.background` 自己分**。

- 另加 `sys.stdout.reconfigure(line_buffering=True)` —— 输出重定向到文件时
  Python 默认块缓冲,「桥接已启动」那行会等很久才出来,用户会以为没起来。

**本机 Blender 5.2 两条路都实测过**(真的走 HTTP):

| 模式 | 闭合立方体 | 破口立方体 |
|---|---|---|
| `--background`(命令执行,无 GUI) | 去掉 436.79mm³ / 三角 268 / 开放边 0 / 非流形 0 | 去掉 **436.79mm³(一模一样)** / 三角 266 / **开放边 4(破口还在)** / 非流形 0 |
| 图形界面(定时器那条路) | 同上,数一模一样 | 同上,数一模一样 |

#### ⚠️ Python 字节码缓存那个坑(2026-11-11 实测踩过)

现象:**新代码跑出旧报错** —— 报错里的行号指向旧文件,打印出来的源码行却是新的。

- **根因** —— Python 校验 `.pyc` **只看「秒级 mtime + 字节数」**。脚本改到
  **同一秒**、字节数**又一样**时,它认为缓存**有效** ⇒ 拿**旧代码**跑。
- **生产路径不受影响** —— `blender --python script.py` 跑的是 `__main__`,
  **不写也不读**字节码缓存。只有**模块 import**(装成插件 / 测试夹具)才踩。
- **两处修法** —— ① `.gitignore` 加 `__pycache__/` + `*.pyc`(仓库里那份脚本
  旁边绝不能有缓存);② **启动脚本启动前先 `rmdir` / `rm -rf` 一次**
  (用户自己改过插件就会遇到)。

#### 统计里的 `triangleCount` 是**三角形数**(2026-11-11 修)

布尔出来的面里混着 n-gon(带洞的底面就是),**导出的文件里全成了三角形**
⇒ 摆多边形数会跟用户看到的文件对不上(77 vs 268)。现在统计走
`_triangle_count(mesh)`(`mesh.calc_loop_triangles()`,兜底是
`Σ(len(poly.vertices) − 2)`)⇒ **跟导出的文件逐个对得上**。

#### 切割失败要说人话(2026-11-11 改的四个码)

工作室报的那句「切割过程出了意外(不是模型的问题)」是**一句套话** —— 所有失败
都归成 `UNEXPECTED`,什么线索都没有。现在**分开放**:

| 码 | 什么时候 | 界面能说什么 |
|---|---|---|
| `WORKER_TIMEOUT` | 切割超时(**跟模型有关**) | 模型太重,浏览器算不完 |
| `WORKER_CRASHED` | 引擎算到一半炸了 | 几何太复杂,引擎崩了 |
| `WORKER_UNAVAILABLE` | Worker 压根起不来(退回主线程也没成) | 浏览器 / 打包问题 |
| `ENGINE_FAILED` | 引擎某一步抛了预料之外的错 | **带原始信息**,一眼看出哪一步炸的 |
| `ENGINE_LOAD_FAILED` | **引擎(wasm)压根没加载出来** | 不是模型的问题,是引擎文件没拿到 |
| `BLENDER_NOT_RUNNING` | 连不上 `127.0.0.1`(插件没起) | **不是模型的问题** |
| `BLENDER_FAILED` | 本地 Blender 自己报的错 | 原因在详情里(面太薄 / 切到边上 …) |
| `BLENDER_TIMEOUT` | 本地 Blender 没在规定时间内回话 | 大模型切太久,别重复点 |
| `BLENDER_BAD_RESPONSE` | 回的不是 zip / 协议版本对不上 | 重新下载插件 |

- **超时时间给足** —— 切割 **300 秒**(原来 60 秒太紧,会把一个能算出来的模型
  判成死的),分析 60 秒。
- **退回主线程的规则** —— Worker **回过话**之后超时/崩了 ⇒ **不退回**(主线程
  会把页面冻住,而且算出来还是同一个结果);**从没回过话** ⇒ 退回主线程(老路,
  能用)。`magnet-cutter-client.test.ts` 守着这条。
- **界面上是「标题 + 原始信息」两行** —— 标题是人话,原始信息是引擎的原文。

#### 引擎(wasm)加载不出来:两个叠在一起的原因(2026-11-11 线上事故)

工作室线上报的原文:

```
切割过程中出了意外 —— 具体原因见下面那行原始信息。
Aborted(SyntaxError: Failed to execute 'open' on 'XMLHttpRequest': Invalid URL). Build with -sASSERTIONS for more info.
```

那是 Emscripten 胶水的 `abort()`。**两个独立的原因叠在一起**,只修一个还是拿不到
wasm:

| # | 原因 | 修法 |
|---|---|---|
| ① | **URL 解不出来**(报出来的那条)—— 胶水在 **Worker** 里读 wasm 走的是**同步 XHR**(`xhr.open("GET", url, false)`)。我们给的 `locateFile` 返回根相对路径 `"/manifold.wasm"`,而 Worker 里的相对 URL 是跟**worker 脚本自己的地址**解的 —— 打包器把 worker 装进 `blob:` URL 之后,blob 的路径是**不透明**的,`new URL("/manifold.wasm", "blob:…")` 直接抛 `Invalid URL` | `locateFile` 给**绝对地址** —— `resolveWasmUrl()`(候选:`self.location.origin` → `self.location.href` → `import.meta.url`,第一个解得出 http(s) 的胜出) |
| ② | **那个文件压根取不到**(潜伏的那条)—— `public/` 下的静态文件默认会走进 `intlMiddleware`,next-intl 的 `localePrefix: "always"` 把 `/manifold.wasm` **307 重定向到 `/zh/manifold.wasm`** —— 那是 404。实测线上:`/manifold.wasm` → 307 → 404;`/magnet/blender_bridge.py`(插件下载链接)同样 404 | `src/proxy.ts` 的 matcher 把 **`wasm` / `py`**(以及 `/magnet/*`)排除掉,跟 `/plugins/*` 一个道理 |

- **改完的实测**(本地 dev):`/manifold.wasm` → **200 `application/wasm` 541470 字节**;
  `/magnet/blender_bridge.py` → 200;`/zh/tools/magnet` → 200(页面照常走 locale)。
  ⚠️ **线上要重新部署才生效**(matcher 是构建产物的一部分)。
- **新增一个码 `ENGINE_LOAD_FAILED`** —— 「引擎没加载出来,**不是模型的问题**,
  是引擎文件没拿到」。以前这种错会掉进 `UNEXPECTED`(笼统那句「切割过程出了意外」)。
- **行为由单测守住** —— `src/test/magnet/pure/magnet-engine-load.test.ts`:
  绝对 URL(普通页面 / blob Worker / 普通 Worker / opaque origin 不炸)/
  `locateFile` 走 `resolveWasmUrl()` / **matcher 锚定整条路径**后
  `/manifold.wasm` 与 `/magnet/blender_bridge.py` 不走 intl、页面路由照常走 /
  新码有中英文文案且中文那条不带 `**`。

#### 2026-11-11 工作室追加的三条 + 四条

| 原话 | 改成了什么 |
|---|---|
| **①「磁吸沉孔需要可调」** | 孔径 / 深度两个输入,**默认仍是实物尺寸**;输入走 `normalizeHoleParams()` 收敛到合法范围(孔径 2~60mm / 深度 0.3~10mm,NaN 退回默认) |
| **②「为什么没有按照原来脚本那样智能识别背面」** | 原脚本只在**六个轴向**里找 —— 那个模型在 Blender 里是轴对齐的,所以背面正好平行于某个轴,看起来像「智能」。模型一歪,六面里就**没有背面了**。现在按**面积找最大的平面区域,跟模型朝向无关** |
| **③「导出模型需要保留原来的材质贴图」** | 布尔运算**保得住** UV / 材质分组(Manifold3D 的属性通道)⇒ 导出写 `vt` / `usemtl` / `mtllib`,带材质时导 ZIP(OBJ + MTL + 纹理) |
| **④「不用装任何东西 —— 但模型不是封闭实体(有开放边 / 非流形边)时会切不了 / 不要因为这个问题切不了」** | 浏览器那条路**先自己清再切** —— `magnet-repair.ts` 剔重复面 / 解非流形边 / 翻绕序 / 拆蝴蝶结顶点;破口交给「**临时盖面**」那一层(`magnet-lid.ts`,见下面「临时盖面:切得出来,但模型不动」);**盖不上的才拒收**(而且说清楚还剩几条)。详见下面「三道闸」第 ② 条 |
| **⑤「不需要修复」** | 真实模型报了「还剩 **461 条开放边** / 15 条非流形边」⇒ 根因**不是模型破,是我们的焊接太严**(见下面「先焊接、再清理」)。现在**先焊后清**:同一个点先认出来(不改几何),多数模型到这一步已经封闭 ⇒ **一丁点几何都不用改** |
| **⑥「不需要修复用户的模型,只需要完成磁铁孔」** | 盖面变成**临时的** —— 只喂给布尔运算,**切完从结果里摘掉**(见下面「临时盖面:切得出来,但模型不动」)。用户的模型上**不会多出任何面**,破口还在那儿;但孔照样切得出来。**④和⑥同时成立** |
| **⑦「支持xyz调整模型尺寸,像bench工具那样」** | 尺寸面板加**统一缩放 / X·Y·Z 分别调**两档(跟 `/tools/workbench` 的尺寸编辑器一个口径),走仓库那份 `scalePositionsXYZ()`;**孔径仍然是绝对毫米**(见下面「XYZ 分别调尺寸」) |

##### ① 孔参数可调 —— 但**仍然是绝对毫米**

- `normalizeHoleParams()` 是**唯一的入口** —— 页面、handler 都调它,自己不
  夹范围。夹的范围:`MAGNET_HOLE_DIA_MIN_MM(2)` ~ `MAX(60)`、
  `MAGNET_HOLE_DEPTH_MIN_MM(0.3)` ~ `MAX(10)`。
- **「可调」不等于「跟模型缩放」** —— 同一个孔参数放在 20mm 和 2000mm 的面上,
  切掉的体积**一模一样**。单测守着这条(模型放大一倍 ⇒ 去掉量不变)。
- **改孔参数要重算分析** —— 页面上的厚度 / 净空是**旧参数**的话,用户照着它切,
  切出来的孔跟界面上写的对不上。防抖 400ms(`RECALC_DEBOUNCE_MS`)。
- 切刀摆放 / 「太薄」判定**都跟着孔参数走** —— 深 2mm 的孔在 1mm 板上会捅穿,
  判定必须用同一个深度。

##### ② 智能识别背面 —— 按面积,不按轴向

`src/features/magnet/lib/magnet-backface.ts`(纯函数,不碰 manifold):

- `detectFlatPatches(mesh, { angleTolDeg, minAreaMm2 })` —— **区域生长**:
  邻居要同时满足「跟种子法线夹角在容差内」**和**「跟当前区域的面积加权
  平均法线夹角在容差内」才并进来。结果**按面积从大到小排**,面积一样时
  挑更平的。
- `pickBackFace(patches)` —— 挑最大的那块。
- **模型歪了照样找得到** —— 绕 X 轴转 37° 的长方体照样找出 1600mm² 那块
  (法线跟着转,不再是 `[0,0,1]`)。这是「智能」跟「六面探测」的分界线。
- **用户能自己换** —— 页面上摆一张平面区域的表格(面积 / 平整度 / 厚度 / 能不能切),
  选中的目标是 `patch:<下标>`;`"auto"` = 智能识别出来的那块。
  目标 id 的编解码在 `magnet-params.ts` 的 `parsePatchTarget()` / `patchTargetId()`。
- 旧的**六面表格还在**(轴向那六个面,各有各的射线厚度测量)—— 两套并存:
  六面表回答「沿某个轴看过去是哪一面」,平面区域表回答「哪块平面最大」。

##### ③ 导出保留材质贴图

- **贴图信息在切的时候就传进布尔运算** —— `client.cut(positions, target, holeParams, sourceTexture)`。
  不传的话布尔出来的件没有 UV,后面补不回来。
- **Manifold3D 的属性通道** —— `numProp = 5` ⇒ `[x,y,z,u,v]` **逐角点**。
  输入三角形要**按材质重排成连续的 run**,再配 `runIndex`(单位是**顶点**,
  是 3 的倍数)+ `runOriginalID`(`Manifold.reserveIDs(n)` 返回的那个 base
  **必须**用返回值,不能自己算)。`mergeFromVert` / `mergeToVert` 把重复角点
  映到同一个标准角点。
- ⚠️ **`runOriginalID` 里装的是「预留 id」,不是「材质下标」** —— 建
  「预留 id → 材质下标」那张表时**键是 id、值是下标**。写反了会让**整个材质
  分组悄悄丢光**(每个三角形都掉进 fallback),而且**不报错** —— 只有对着
  有材质的模型跑一遍才看得出来。
- **导出**:`writeObjFromSoup()` 写 `vt` / `usemtl` / `mtllib`(面按材质分组
  —— `usemtl` 是状态指令,面不分组会把后面别的材质的面也改了);带材质时走
  `downloadModelZip()`(OBJ + MTL + 纹理,MTL 沿用原模型那份,纹理按 basename
  平铺到 zip 根目录并改写引用)。
- **没材质的模型** —— 照旧导纯 OBJ(没有 `vt` / `usemtl` / `mtllib`)。
- **新切出来的孔壁 / 孔底**继承被切那个面的材质(靠 `findMaterialAtPoint` 找
  最近的面,找不到才落 fallback)。

#### 先焊接、再清理 —— 「不需要修复」(2026-11-11 加)

工作室拿真实模型试的时候,报的是:

```
自动修复之后这个模型还是不封闭(还剩 461 条开放边 / 15 条非流形边)
```

看着像「模型太破」,其实**不是模型的问题,是我们的焊接太严**。

- 仓库那份 `weldAndAnalyzeTopology()` 的容差是 `Math.max(1e-9, diag * 1e-7)`
  —— 40mm 的模型 = **0.000004mm**。
- 而 **Blender 的 `remove_doubles` 默认是 0.1mm** —— 粗了**两万五千倍**。
  工作室自己那段 Blender 脚本第一件事就是它。
- 后果:AI 生成的模型(Meshy / Tripo 导出)里,同一个逻辑顶点被不同公式算出来
  差个 1e-4mm 是**常事**(float32 舍入 / UV 接缝 / 法线重算)。我们那份严到
  4e-6mm 的焊接**焊不上** ⇒ 每个这样的点都在网格上留下一条「开放边」⇒ 一个
  本来完好的模型被我们看成「几百条破边」。

实测(诊断脚本):

| 模型 | 我们焊接前的开放边 |
|---|---|
| 完好的立方体 | 0 |
| 立方体,每个面的顶点各复制一份并扰动 **1e-4mm** | **36** |
| 立方体,扰动 **1e-3mm** | **36** |

—— 差了 1e-4mm 就被当成「破模型」,这就是 461 的来源。

**⇒ `magnet-weld.ts`:先焊,后清。** 焊接是**不改几何**的那一层 —— 只把
「同一个点」认出来(保留第一个点的坐标),模型该封闭就封闭,布尔运算直接能用。

- **阶梯容差**(`magnetWeldLadder()`)—— 从严到宽,**焊到封闭就停**:
  `diag × 1e-5`(封顶 0.001mm)→ `diag × 1e-4`(0.01mm)→ `diag × 1e-3`(0.05mm)
  → `diag × 2.5e-3`(**封顶 0.1mm = Blender `remove_doubles` 的默认值**)。
  相对值跟着模型大小走,绝对上限兜着 ⇒ 小模型不会被焊变形,大模型不会被焊太粗。
- **键的编码换了** —— 仓库那份把三个轴各占 19 位(共 57 位),**超过 double 的
  53 位尾数**,值一大就丢低位、顶点会被错误合并。这里用**线性键**
  (`(cx * cellsY + cy) * cellsZ + cz`),并带一条「格子太多就把容差放大」的兜底。
- **不动仓库那份 `weld.ts`** —— 那个函数整个仓库都在用(工作台的检查 / 支撑体积
  / 包围盒),`weldVertices` 又是模块私有的。**这里另写一份只给磁吸孔用的。**
- **面序不变** —— 三角汤的三角形顺序保持不变,调用方靠面序把 UV / 材质对回去。
- **报告里分两个计数** —— `weldedVertices`(合并掉多少个,**三角汤天生就有重复
  ⇒ 这个数对每个模型都很大,没信息量**)和 `weldedNearDuplicates`(其中**坐标
  不完全相同**的那些 —— **界面上的那个数**)。`repair.changed` **不**把焊接算进去
  —— 焊接不改形状,它有自己那条中性的告知(灰色,跟「改了模型」的琥珀色分开)。
- **顺序** —— `prepareTopology()` 现在是:**焊接 → 阶段 A(清理)→ 再焊一次
  (拿干净拓扑)→ 阶段 B(拆蝴蝶结顶点)→ 临时盖面**。**拆完不能再焊** —— 再焊会
  把刚拆开的重合顶点又并回去。

**「不需要修复」这条口径的落点** —— 真实模型走到焊接这一步就封闭了 ⇒
**删面 0、翻绕序 0、几何一动不动**(`repair.changed === false`),
布尔运算直接就切得出来。清理那一层只留给**真的破了**的模型。

##### 临时盖面:切得出来,但模型不动(2026-11-11 加)

工作室后来又追加了一条:**「不需要修复用户的模型,只需要完成磁铁孔」**。

这条跟「不要因为这个问题切不了」是**同时成立**的两件事:

> ① 模型是破的 → **不能因此拒绝**
> ② **不能往用户的模型里加东西**

⇒ **既要把孔切出来,又不能改用户的模型。**

早先的做法是**把洞补上**(给每条边界环生成一张盖面,留在模型里)—— 那等于
**往用户的模型里塞了几张本来不存在的面**:导出来的模型上多了一块几何,工作室
一看就知道「你们动过我的模型」。

**现在的做法:盖面是临时的。**

```
1. 找出模型上的边界环(洞 / 裂缝)      —— scanMagnetBoundary()
2. 给每条环生成一张**临时盖面**(法线朝外) —— buildMagnetLid()
3. 拿「模型 + 临时盖面」去参与布尔运算
4. **切完把盖面从结果里摘掉**
```

用户拿到的还是他自己的模型 —— 只是多了一个磁吸孔,破口**还在那儿**。

- **`magnet-lid.ts` 是纯函数、零依赖** —— 只跟「顶点 / 面」打交道,布尔运算在
  下一层(manifold)做 ⇒ 能进 `unit` project 跑单测,不用起 wasm。
- **盖面在网格输入里是单独一个 run**(单独一个预留 id)⇒ 布尔之后靠
  **run id** 精确地把它认出来摘掉 —— 不靠「位置对不对得上」那种猜法
  (布尔会把面拆开、挪顶点,位置对不上)。
- **盖面的方向是反的** —— 边界环**顺着相邻面的走向**走一圈,右手定则算出来的
  法线指向**实体内部**(立方体缺 −X 面时,环是 0→3→7→4→0,算出来 +X = 朝着
  实体)⇒ **盖面必须用反过来那个环**(0→4→7→3→0,法线 −X = 朝外)。
  实测:立方体缺 −X 面 + 反向盖面 ⇒ `volume = 8`(正好是立方体)✓;
  用正着的环盖 ⇒ manifold 抛 `Not manifold`。
- **盖面用模型自己的顶点**(不新建顶点)⇒ 盖面跟模型的边界严丝合缝,布尔那
  一步才认得出它是同一条边。耳切失败退回扇形(几何可能不准,但一定是流形)。
- **`magnet-repair.ts` 那一层不再补洞** —— 它现在只做**清理**(剔废面 /
  翻绕序 / 拆蝴蝶结顶点),**破口原样留着**。补洞是「临时盖面」那一层的事。
- **界面上分两条告知** —— **灰色**那条说「破口临时封上再切,切完原样还给你」
  (`repair.lidTitle` / `repair.lidDetail`);**琥珀色**那条只说**真的改了几何**
  的地方(`repair.title` / `repair.detail`)。**不能悄悄改用户的模型**。
- **切完仍然开放** —— 破模型切完之后**开放边还在**(单测守着)⇒ 拿到的确实是
  「用户自己的模型 + 一个孔」,不是「被我们补过的模型」。

##### XYZ 分别调尺寸 —— 跟 bench 工具一个口径(2026-11-11 加)

工作室的要求:**「支持xyz调整模型尺寸,像bench工具那样」**。

- **两档模式** —— 尺寸面板上一个开关:`统一缩放`(单值「目标最大边」,老口径)
  / `X·Y·Z 分别调`(三个输入框)。切模式时**用当前尺寸填进去**,模型不跳。
- **走仓库那份 `scalePositionsXYZ()`**(`src/features/pricing/lib/model-units.ts`)
  —— 跟 `/tools/workbench` 的尺寸编辑器**同一个函数**,不另写一份。
- **孔径仍然是绝对毫米** —— 切刀是在**缩放后的空间**里摆的,所以「Ø20.7mm」
  在 20mm 和 2000mm 的模型上是**同样大小**的孔(孔是实物的尺寸,不是模型的比例)。
  这跟「孔径可调」那条口径**不冲突**:可调的是毫米数,不是比例。
- **分析会自动重算** —— 分析那个 effect 本来就跟着 `scaledPositions` 走
  (400ms 防抖),分别调尺寸 ⇒ 自动重新分析(厚度 / 净空 / 候选面)。
- **单位判定还是那一套** —— `detectModelUnitScale()`(AI 导出的模型坐标是
  归一化的,不是毫米);尺寸面板在载入时判定过一次。


#### 模块布局(`src/features/magnet/`)

```
lib/
├── magnet-params.ts          # 纯常量 + 切刀摆放数学 + 孔参数归一化 + 目标 id 编解码
├── magnet-backface.ts        # 智能识别背面(平面区域生长)—— 零依赖,能进 unit project
├── magnet-weld.ts            # **容差阶梯焊接**(把「同一个点」认出来)—— 零依赖
├── magnet-lid.ts             # **临时盖面**(找边界环 → 生成盖面 → 切完摘掉)—— 零依赖
├── magnet-repair.ts          # **网格清理**(剔重复面 / 拆蝴蝶结顶点 / 翻绕序)—— 零依赖
├── magnet-cutter-protocol.ts # worker 收/发消息类型 + 错误码联合
├── magnet-cutter-handler.ts  # 真正干活的那一段(**焊接 → 清理 → 临时盖面** → 挑面 → 布尔 → 出料)
├── magnet-cutter-client.ts   # promise 客户端(Worker + 主线程兜底)
├── blender-local.ts          # 本地 Blender 那条路(端口 / 协议 / 错误映射)—— fetch 可注入
├── magnet-error.ts           # 错误码 → 文案 key
└── write-obj.ts              # 三角汤 → OBJ 文本(+ UV / 材质分组)+ Blob
workers/
└── magnet-cutter.worker.ts   # worker 壳(跟 angle-optimizer.worker.ts 一个形状)
components/
└── magnet-cutter-tool.tsx    # 客户端 UI(引擎开关 / 拖放 / 尺寸 / 孔参数 / 选面 / 切 / 下载)
public/magnet/
├── blender_bridge.py         # Blender 插件(桥接)—— 页面直接给下载链接
├── start_blender.cmd         # Windows 一键启动(找 blender.exe → 起桥接)
└── start_blender.sh          # macOS / Linux 一键启动(同上)
```

- **`blender-local.ts` 里 `fetchImpl` 是注入的** —— 单测塞一个假 fetch 就能验
  协议和错误映射,不用起浏览器、不用装 Blender、不用联网。
- **插件那份脚本提交进仓库** —— 跟 `public/manifold.wasm` 一个道理(新克隆的
  机器不用跑脚本就能用)。
- **启动脚本也提交进仓库** —— 页面给的就是这两个文件的下载链接(网页**起不了**
  本机程序,见上面「为什么没有调用便携版 Blender」)。

#### 切刀摆放的数学(照搬脚本,去掉 ratio)

```
半径 r      = 10.35mm(= MAGNET_HOLE_DIA_MM / 2)   ← 可调时 = 用户填的孔径 / 2
沉孔深 d    = 1.3mm                                   ← 可调时 = 用户填的深度
切刀外伸 p  = 0.5mm
切刀总高 h  = d + 2p = 2.3mm
切刀中心    = facePoint + inward * (d/2 - p)   ← facePoint + inward * 0.15
切刀轴      = inward(切刀的 +Z 对齐 inward)
切刀近端    = facePoint + inward * (-2p)  ← 在面**外面** 1.0mm
切刀远端    = facePoint + inward * ( d )  ← 在面**里面** 1.3mm
```

外伸那 1mm 是**必须的**:切刀跟面完全共面时布尔会出退化结果(脚本里 `penetration`
就是干这个的)。**别以后有人「优化」掉它。**

- **矩阵而不是欧拉角** —— `transform(Mat4)` 对齐切刀的 +Z 到面法线。矩阵没有
  「旋转顺序」的歧义(仓库自己的 `POSE_EULER_ORDER = "ZYX"` 那个坑不必再踩一遍)。
- **`Manifold.cylinder` 是静态方法** —— **不加 `new`**。加了 TS 直接报 TS7009。

#### 三道闸(脚本没有,网页端必须有)

**① 焊接走仓库唯一公开入口** —— `weldAndAnalyzeTopology(positions)`
(`src/features/tools/lib/mesh/weld.ts`)。`weldVertices` 是模块私有的,拿不到。
它返回的 `WeldedMesh` 字段**正好就是 manifold 要的形状**(`vertices` →
`vertProperties`、`faceVertex` → `triVerts`),不用再转一次。

> ⚠️ **但那份焊接的容差对磁吸孔来说太严了** —— `diag × 1e-7`(40mm 的模型 =
> 0.000004mm),比 Blender 的 `remove_doubles`(0.1mm)细两万五千倍 ⇒ 真实模型
> 「461 条开放边」的来源。**磁吸孔在它前面加一层容差阶梯焊接**
> (`magnet-weld.ts`,见上面「先焊接、再清理」)。**仓库那份一个字没改** ——
> 它整个仓库都在用。

**② 先焊、再清、再临时盖上、再切 —— 模型不是封闭实体**不拒收**(工作室 2026-11-11)**

工作室的原话:**「不用装任何东西 —— 但模型不是封闭实体(有开放边 / 非流形边)
时会切不了 / 不要因为这个问题切不了」**。

所以浏览器那条路**不因为「不是封闭实体」就拒收** —— 它**先焊、再清、再临时
盖上破口**然后才切。
`Manifold.ofMesh()` 底下就是 `new Manifold(mesh)`,**manifold 自己没有任何
补洞 / 修复的 API** ⇒ 盖面只能**在仓库里自己实现**(`magnet-lid.ts`,
纯函数、零依赖、不碰 manifold)。

> **焊接在清理前面** —— 真实模型(461 条开放边)在焊接那一步就封闭了 ⇒
> **一丁点几何都不用改**(删面 0、翻绕序 0)。清理那一层只留给**真的破了**的模型。

**清理流水线(阶段 A —— `repairMagnetGeometry()`)**

| 步 | 干什么 | 为什么 |
|---|---|---|
| 1 | 剔掉退化面 / 重复面 | 零面积三角形 manifold 直接拒;重复面让边被走两次 |
| 2 | 解掉非流形边 | 一条边被 3 个以上的面共用 ⇒ manifold 判非流形。**保留最大的那个壳里方向相反的那两个面**,其余的删掉 |
| 3 | 翻绕序(XOR 约束) | 局部翻乱的面会让布尔算出烂件。约束:一条边被两个面共用时 `x_f1 ⊕ x_f2 = 1 ⊕ d1 ⊕ d2`(`d` = 两个面各自的遍历方向)⇒ BFS 解,解在「整体取反」的意义下唯一 ⇒ **翻少数派那一类**;**50/50 平局也得翻一类**(不翻就是非流形) |
| — | ~~补边界洞~~ | **这一层不补洞** —— 补洞是**临时盖面**那一层的事(`magnet-lid.ts`),盖面只喂给布尔运算,切完就摘掉 ⇒ **用户的模型上不会多出任何几何**(工作室 2026-11-11:「不需要修复用户的模型,只需要完成磁铁孔」) |

**阶段 B —— `splitMagnetVertices()`**:拆**蝴蝶结顶点**(一个顶点上挂着几
个互不相连的面扇)。**拆完不能再焊** —— 再焊会把刚拆开的重合顶点又并回去。
⇒ 顺序是**焊接 → 阶段 A → 再焊一次(拿干净的拓扑)→ 阶段 B → 临时盖面**。

**临时盖面(`magnet-lid.ts`)** —— 找边界环 → 给每条环生成一张盖面 → 跟模型
**一起**喂给布尔 → **切完从结果里摘掉**。细节见上面「临时盖面:切得出来,但
模型不动」。

**盖不上的才拒收** —— 而且要说清楚还剩几条:

| 判据 | 动作 |
|---|---|
| 临时盖面**封不上**(还有开放边 / 非流形边) | **拒绝**(`NOT_MANIFOLD`)+ 说清楚「还剩 N 条开放边 / M 条非流形边」+ 指到 `/tools/workbench` |
| 盖上之后还是**没有厚度**(体积 0) | **拒绝**(`NOT_MANIFOLD`)—— 一张孤零零的三角形补上盖面之后「封闭」了,但布尔那一步照样会拒。自己先拦下来,说人话 |
| 整体法线朝内 | **自己翻过来**(`INVERTED_WINDING` —— manifold 对整体反向宽容,对局部反向不宽容) |
| `manifold.status() !== "NoError"` | 拒绝(`BOOLEAN_FAILED`),把 status 原文带出来 |

- **拓扑缓存的键要把贴图算进去** —— 分析那条路没有贴图、切割那条路有,
  而盖面会**借用 UV**(不然盖面没贴图,导出的模型上那块是花的)。
  键里少了贴图 ⇒ 两轮共用一份缓存 ⇒ **贴图悄悄丢光**。
- **清理不动好的模型** —— 干净模型的 `report.changed === false`(单测守着)。
- **改了用户的模型就得告诉用户** —— `MagnetAnalyzeOutcome.repair` 带着
  「改了什么」(剔了几张面 / 翻了几个面 / 拆了几个顶点)⇒ 页面在侧栏摆一条
  **琥珀色**的告知。**不能悄悄改用户的模型。**
  **临时盖面是另一条(灰色)** —— 它**不改模型**,切完就摘掉了,所以只摆一句
  「破口临时封上再切,切完原样还给你」(`repair.lidTitle` / `repair.lidDetail`)。

- ⚠️ **测试夹具的一个坑(别再写回那个样子)** —— `magnet-cut.test.ts` 里那个
  「整体法线朝内」的夹具(`invertedCubeSoup`)早先是**只对调了顶点 2 的 x/z 两个
  分量**(相当于沿 x=z 平面镜像)—— 那**改的是网格的连接关系,不是绕序**:
  出来的模型有 8 条开放边 + 3 条非流形边,**是破的,不是翻的**。它当年能过,
  是因为那套「补洞」把它补好了。**现在补洞没了(改成临时盖面),它就露馅了。**
  ⇒ 正确的做法是**对调整个顶点 2 和 3**(真正的绕序翻转,还是同样那 8 个角)。

**③ 切完的收尾检查** —— 失败时**保留原模型**,界面显示具体原因,不给一个坏件:

| 检查 | 错误码 |
|---|---|
| `result.isEmpty()` | `EMPTY_MODEL` |
| 面数锐减(切坏了) | `FACE_COUNT_COLLAPSED` |
| 面数没变(没切进去) | `NOTHING_CUT` |
| 体积没减少(切了个寂寞) | `VOLUME_UNCHANGED` |
| 去掉量比理论值少太多(孔切到边上去了) | `HOLE_SPILLED` |
| **预料之外的错**(以前一律报成 `BOOLEAN_FAILED`) | **`UNEXPECTED`** |

#### 六个面:表格给用户挑

一次建流形 + 12 次射线(6 个方向各两条:一条找外表面,一条量局部厚度),
一次算出 **6 行表格**(面 / 平整度 / 局部厚度 / 能不能切)。用 **manifold 自带的
`rayCast(origin, endpoint)`** —— 比自己写 Möller–Trumbore 稳,还能直接拿到法线。

- 默认选「平整度最高且能切」的那一个(脚本的自动挑面偶尔会挑到一个很小的边面,
  **用户能自己换是必须的**)。
- `thickness < depth + MAGNET_MIN_WALL_MM(0.3mm)` ⇒ 太薄,切下去会捅穿。
  **depth 是用户填的那个** —— 判定跟切刀用同一个深度。
- 孔圆在面内放不下 ⇒ ⚠ 会切到边上。

#### 复用仓库里已有的东西(别重写)

| 要的 | 用哪个 |
|---|---|
| 拖放 | `src/features/shared/hooks/use-drop-zone.ts` 的 `useDropZone()` —— 仓库**强制**用它,自己写 `onDragOver` 那个写法就是会闪的那份 |
| 解析 OBJ | `src/features/pricing/lib/zip-extractor.ts` 的 `extractModelZip()` |
| 单位判定 | `src/features/pricing/lib/model-units.ts` 的 `detectModelUnitScale()` —— 7000mm 那个问题仓库已经解了 |
| **XYZ 分别缩放** | `src/features/pricing/lib/model-units.ts` 的 `scalePositionsXYZ()` —— 跟 `/tools/workbench` 的尺寸编辑器**同一个函数** |
| 视口 | `src/features/shared/components/model-viewport/` 的 `ModelViewport` —— **整个仓库只有这一份视口**,别再写第二个 |
| 焊接 / 拓扑 | `src/features/tools/lib/mesh/weld.ts` 的 `weldAndAnalyzeTopology()` |
| **导 ZIP** | `src/features/pricing/lib/obj-exporter.ts` 的 `downloadModelZip()` —— 别自己再写一套打包 |
| **打包给本地 Blender** | `src/features/pricing/lib/obj-exporter.ts` 的 `buildModelZipBlob()` —— 同一个包,别再写一套 |

- **尺寸有两档** —— 「统一缩放」(单值「目标最大边(mm)」+ 均匀缩放)/「X·Y·Z
  分别调」(三个输入框)。两档都走 `scalePositionsXYZ()`(见上面「XYZ 分别调
  尺寸」)。**孔径跟尺寸无关** —— 孔是实物尺寸,在 20mm 和 2000mm 的模型上
  一样大。
- **那个数字输入框能直接改** —— 输入框存的是**字符串**,失焦时才归一化
  (不然用户敲到一半就被格式化掉,数字根本改不了)。

#### Manifold3D 的 API 表面(踩过的坑,别再踩)

| 事实 | 后果 |
|---|---|
| `export default Module`,`Module` 是个 **async 工厂** | `await Module({locateFile})` 才拿得到运行时 |
| **`ManifoldToplevel.setup()` 必须调** | 不调的话整个 JS API 层都不存在 |
| **`Manifold.cylinder` 是静态方法** | 加 `new` ⇒ TS7009 |
| `intersection` / `difference` **只有静态版** | 实例上没有 |
| `Mat4` = 16 元组 **列主序**;`Vec3 = [x,y,z]` | 传错顺序 ⇒ 变换整个错位 |
| **属性通道 `numProp = 5`** | `[x,y,z,u,v]` **逐角点** —— UV 在这儿,不在 `Mesh` 上 |
| **`runIndex` 的单位是顶点**(3 的倍数) | 拿三角形下标当它用 ⇒ run 全乱 |
| **`runOriginalID` 要用 `reserveIDs()` 返回的 base** | 自己算 base ⇒ 材质对不上(而且**不报错**) |
| **输入三角形要按材质重排成连续 run** | 不重排 ⇒ `usemtl` 分组对不上 |
| **`Mesh.faceID` 会被 manifold 覆写** | 它**不是**输入三角形下标 |
| wasm 放 `public/manifold.wasm`(541KB) | **产物提交进仓库** —— 免得新克隆的机器没跑脚本就白屏;`pnpm magnet:wasm` 重新拷 |

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/magnet/pure/magnet-params.test.ts` | 切刀摆放数学(近端在面外 1mm、远端在面内 1.3mm)/ 半径 10.35 / 六个面的方向映射 / 太薄判定 / **孔参数可调**(默认值、夹范围、NaN 退回默认、同一组参数在 20mm 和 2000mm 的面上切掉一样多)/ **目标 id 编解码**(`auto` / `patch:3` / 非法值) |
| `src/test/magnet/pure/magnet-cut.test.ts` | **真跑 manifold**:立方体切顶面 → 体积减少 ≈ π·r²·d / 结果是流形(能再切一次不炸) / 太薄的板子被拒 / **不是封闭实体的模型 ⇒ 临时盖面再切**(去掉量跟封闭立方体**一模一样**)/ **不需要修复用户的模型**(切完的面数 = 封闭件 − 1 ⇒ 盖面被摘掉了;切完开放边**还在** ⇒ 拿到的确实是「用户自己的模型 + 一个孔」)/ **盖不上的才拒收**(而且说清楚还剩几条)/ **近重合顶点的模型照样切**(工作室 2026-11-11 的「不需要修复」—— 切掉的量分毫不差,**删面 0、翻绕序 0、`changed === false`**)/ 六个面里挑出平整度最高的 / **可调孔参数**(Ø10 深 2 → 去掉 156.83mm³,误差 <0.01%)/ **智能识别背面**(立方体 6 块、歪 37° 照样找得到、`auto` 与 `patch:N` 都切得动)/ **导出保留材质**(36 组 UV 全在、两个材质都在、孔壁继承被切面的材质) |
| `src/test/magnet/pure/magnet-lid.test.ts` | **边界环找得对** / **盖面的绕序是反的**(法线朝外 —— 盖上之后体积 = +8,不是 −8)/ **耳切 + 扇形兜底** / 空网格不炸 |
| `src/test/magnet/pure/magnet-backface.test.ts` | 平面区域生长(立方体 6 块 × 1600mm²、面积下限过滤、退化面剔除、空网格不炸)/ **歪了也找得到**/ `pickBackFace` 的面积 + 平整度排序 |
| `src/test/magnet/pure/magnet-repair.test.ts` | **这一层不补洞**(缺一个面 ⇒ 洞**还在**,体积是缺的那一半 `8 − 2/3`,没被补成完好的立方体)/ **翻绕序**(一个面翻乱 ⇒ 翻回来,体积 8)/ **剔重复面** / **剔退化面** / **解非流形边**(多余的面删掉)/ **拆蝴蝶结顶点** / **好模型一动不动**(`changed === false`)/ UV 与材质**逐面对齐** |
| `src/test/magnet/pure/magnet-weld.test.ts` | **仓库那份焊接太严**(差 1e-4mm 就被当成两个点 —— 461 的来源)/ 近重合顶点 ⇒ **焊上就封闭**(不用删面不用修)/ 1e-3mm 的扰动也焊得上 / 完好的模型**几何一动不动**(但三角汤天生的 28 个重复顶点该焊)/ 阶梯**停在刚好够的那一档** / 焊接不动几何(包围盒差 ≤ 扰动)/ **面序不变**(UV 靠它对回去)/ 两个分开的点不会被焊到一起 / 空输入不炸 |
| `src/test/magnet/pure/write-obj.test.ts` | 三角汤 → OBJ 文本 / 顶点去重 / 1-based 索引 / `-0` 归一化 / **UV 写出(`vt` + `f v/vt`)** / **材质分组(`usemtl` + `mtllib`,面按材质连续)** |
| `src/test/magnet/pure/magnet-page.test.ts` | 路由在 / 工具中心登记了 / **视口是复用的那一份** / **不进工单**(不碰报价、工单、R2)/ 拖放用 `useDropZone` / 焊接走 `weldAndAnalyzeTopology` / **焊接在清理之前**(磁吸孔自己那份容差阶梯)/ `Manifold.cylinder` 不加 `new` / **孔径是绝对毫米**(可调,但 `EXPECTED_WIDTH_MM` 不许进代码)/ **① 可调** / **② 智能识别背面** / **③ 导出保留材质** / **④ 不是封闭实体 ⇒ 临时盖面再切**(拒绝发生在盖面**之后**)/ **⑤ 先焊接、再清理(「不需要修复」)**/ **⑥ 临时盖面切完要摘掉**(模型上不多出几何)/ **⑦ XYZ 分别调尺寸**(`scalePositionsXYZ`)/ `UNEXPECTED` 码在位 / wasm 提交进仓库 / **中英文 key 递归一致** |
| `src/test/magnet/pure/magnet-cutter-client.test.ts` | **Worker 回过话**之后超时 ⇒ 报 `WORKER_TIMEOUT`、**不退回主线程** / 崩了 ⇒ `WORKER_CRASHED`、**不退回主线程** / **从没回过话** ⇒ 退回主线程照样切得出来 / Worker 压根没有 ⇒ 退回主线程 / 引擎报的模型错**原样带上来** / 切割超时是 **300 秒**、分析 **60 秒** |
| `src/test/magnet/pure/magnet-blender-local.test.ts` | 端口归一化(非法 ⇒ 默认)/ **base URL 写死回环** / 探活带协议头 / 协议对不上 ⇒ `BLENDER_BAD_RESPONSE` / 连不上 ⇒ `BLENDER_NOT_RUNNING` / 没回话 ⇒ `BLENDER_TIMEOUT` / 切割的**包 + 头**都对 / 插件报错 ⇒ `BLENDER_FAILED` 且 detail 带着它自己的 code / 回的不是 zip ⇒ `BLENDER_BAD_RESPONSE` / **插件只绑 `127.0.0.1`** / 带 `Access-Control-Allow-Private-Network` / **EXACT → FAST** / **不调 `bpy.ops`** / 切刀摆放跟网页端同一套数学 / **页面有引擎开关** / **不碰工单链路** / **不往我们的服务器发模型** / **指引下便携版 Blender + 插件** / **Blender 模式不跑浏览器的分析** / **插件那条路也不修用户的模型**(临时盖面 + 切完摘掉)/ 统计里带 `lidCapped` / `lidFaces` / `lidStripped` / **一键启动脚本在仓库里**(`.cmd` / `.sh`)/ **页面不许 `child_process` / `spawn` / `execFile`** / **启动脚本走 `--background`(命令执行,不打开 GUI)** / **后台模式自己阻塞跑活**(`_pump_forever`,定时器在后台模式永远不触发)/ 输出不被缓冲 |
| `src/test/magnet/pure/magnet-engine-load.test.ts` | **wasm 地址必须是绝对地址**(普通页面 / blob Worker / 普通 Worker / opaque origin 不炸)/ `locateFile` 走 `resolveWasmUrl()` / **proxy 的 matcher 把 `wasm` / `py` / `/magnet/*` 排除掉**(静态文件别被 locale 前缀劫持)/ 页面路由与 API 路由照常走 / `ENGINE_LOAD_FAILED` 有中英文文案 |

### 磁吸孔的两条新路:可安装的 Blender 插件 + MCP 服务器(2026-11-11)

工作室的原话:**「在 Blender 里 Scripting → 新建文本 → 把插件粘进去 → Run
Script,桥接就起了。做出插件,或者 mcp 协议」**。

那一句是在转述用户**装插件**的别扭姿势(工作室在问「能不能做成个插件」)。
两条路都做了:

| 路 | 是什么 | 谁用 |
|---|---|---|
| **可安装的插件** | `public/magnet/mooncoda_magnet_bridge.zip` —— Edit → Preferences → Add-ons → Install from Disk… | 工作室自己 / 拿 Blender 切孔的人 |
| **MCP 服务器** | `pnpm magnet:mcp` —— 一个 stdio 的 MCP server,三个工具 | 能驱动 MCP 的 AI 客户端(Claude Code / Claude Desktop) |

#### 一、可安装的 Blender 插件

- **产物提交进仓库** —— `public/magnet/mooncoda_magnet_bridge.zip`(跟
  `public/manifold.wasm` 一个道理)。构建:`pnpm magnet:addon`
  (`scripts/build-blender-addon.ts`)。
- **zip 的形状** —— Blender 装 zip 插件要求:**压缩包里只有一个顶层目录**,
  目录名 = 模块名(这里 `mooncoda_magnet_bridge/`)。包里两个文件:
  - `__init__.py` —— 把 `bl_info` / `register` / `unregister` 从 `bridge.py`
    **再导出一次**。**不许在入口里再抄一份 `bl_info`** —— 抄了就会跟实现
    漂移(改了实现忘了抄,插件装上还是旧行为)。
  - `bridge.py` —— 跟 `public/magnet/blender_bridge.py` **一个字节都不差**
    (单测守着 ⇒ 插件跟网页那份**永远是一个东西**)。
- **装完自动起** —— `AddonPreferences`(端口在偏好里改)+ 面板
  `MOONCODA_PT_bridge` + 操作器 `mooncoda.start_bridge` /
  `mooncoda.stop_bridge` / `mooncoda.open_web`。
- **老路没删** —— 「Scripting → 粘进去 → Run Script」那条路照旧能用
  (`blender_bridge.py` 还是**真理源**)。插件只是把它包起来。
- **页面给得到那个 zip** —— `MAGNET_BLENDER_ADDON_ZIP_URL`;`src/proxy.ts`
  的 matcher 把 `/magnet/*` 排除掉(不然 `/magnet/xxx.zip` 会被 307 到
  `/zh/magnet/xxx.zip` → 404)。

#### 二、MCP 服务器

- **位置** —— `scripts/magnet-mcp-server.ts`(stdio 传输)。跑起来:`pnpm
  magnet:mcp`。
- **协议** —— MCP 的 stdio 传输 = **一行一个 JSON-RPC**(不是 LSP 那种
  `Content-Length` 分帧)。`initialize` 协商版本(支持 `2025-06-18` /
  `2025-03-26` / `2024-11-05`)/ `tools/list` / `tools/call`;**通知(没有
  `id`)一律不回**(回了客户端也不认);工具不存在回 `-32602`。
- **三个工具**:

  | 工具 | 干什么 | 主要入参 |
  |---|---|---|
  | `magnet_analyze` | 分析模型(体积 / 六个面 / 智能识别的平面 / 候选面 / 模型状态) | `path` / `holeDiaMm` / `holeDepthMm` |
  | `magnet_cut` | **浏览器那条路**(Manifold3D wasm)切孔,写回磁盘 | 同上 + `outPath` / `target` |
  | `magnet_cut_blender` | **本地 Blender 那条路**切孔(自相交那种模型) | 同上 + `outPath` / `port` |

- **引擎是**同一份代码** —— 服务器调的就是网页那条路调的那两个函数
  (`magnet-cutter-handler.ts` 的 `analyzeModel()` / `cutMagnetPocket()`)
  ⇒ **网页上算出来的数,这边算出来是同一个数**。不是「另写一套 MCP 版算法」。
- **分层** —— 协议层(`src/features/magnet/lib/mcp-protocol.ts`)与排版层
  (`src/features/magnet/lib/mcp-report.ts`)**零 import 的纯函数**,放在
  `src/features/` 里能进 `unit` project 跑单测;文件 IO + 引擎调用 +
  stdio 循环在 `scripts/`(那目录**不在 `tsconfig.json` 里** ⇒ 不进
  typecheck;tsx 走 CJS ⇒ **不许顶层 await**)。
- **stdout 是协议通道** —— 服务器往 stdout 写的**只有** JSON-RPC 响应;
  所有日志走 **stderr**。往 stdout 写一行日志就把协议搅乱了。
- **三条硬规矩跟网页那条路一样** —— ① **模型不出这台电脑**(文件从磁盘读、
  结果写回磁盘)② **不进工单**(不碰报价 / 工单 / R2 上传 / 支撑克重)③
  **不悄悄改用户的模型**(破口临时封上、切完摘掉)。
- **不会悄悄缩放模型** —— AI 导出的模型坐标常常是归一化的(±1),不是毫米。
  `magnet_analyze` 的输出里有一行 ⚠️ 提醒(`looksLikeNotMillimeters`),**但
  工具不自己改尺寸** —— 缩放多少是人的决定。尺寸不对会表现为「孔比模型还大
  / `FACE_NOT_CUTTABLE`」。
- **Blender 那条路也只跟 `127.0.0.1` 说话** —— 端口默认 8765,只绑回环
  (测试守着:脚本里不许出现 `http://localhost:` 或任何别的 `http(s)://`)。

**MCP 客户端那边这样配**(Claude Code):

```json
{
  "mcpServers": {
    "mooncoda-magnet": {
      "command": "pnpm",
      "args": ["magnet:mcp"],
      "cwd": "/path/to/MooncodaCN"
    }
  }
}
```

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/magnet/pure/magnet-addon.test.ts` | 插件包在仓库里 / zip **只有一个顶层目录**、目录名 = 模块名 / 包里的 `bridge.py` 跟源码**一个字节都不差**(不会漂)/ 入口 re-export `bl_info` / `register` / `unregister` 且**不抄第二份 `bl_info`** / 源码里有 `AddonPreferences` / 面板 / 操作器 / 协议版本对得上 / **只绑 `127.0.0.1`**(不许 `0.0.0.0`)/ **proxy 的 matcher 放 `/magnet/*` 过**(页面路由照常走 locale)/ 构建脚本在仓库里 + `package.json` 登记了 `magnet:addon` |
| `src/test/magnet/pure/magnet-mcp.test.ts` | 协议合规(版本协商 / **通知不回** / 工具不存在回 `-32602` / 不认识的方法回 `-32601` / 不是 2.0 回 `-32600` / 解不了 JSON 回 `-32700`)/ 工具炸了也给一份看得懂的内容(标 `isError`)/ 排版说人话(「可以切」/「太薄 —— 切下去会捅穿」/「一个字节都没改」/「临时封上了 … 不会多出几何」)/ **坐标不像毫米时要提醒**(不悄悄缩放)/ **引擎是同一份代码**/ **只跟 `127.0.0.1` 说话**/ **stdout 只写一次**(协议通道)/ **不进工单**(不碰报价 / 工单 / R2)/ 协议层与排版层住在 `src/features/magnet/lib/`(能进 unit project) |

### 外国访客 → 海外独立站(2026-11-10,**2026-11-11 改了口径**)

工作室的独立站是**另一个 Shopify 店铺**(境外的那个)。境外访客落到本仓库之后,
看到的是人民币价格、境内物流、境内客服 —— 看着就不是给他准备的。要给他一个
**明确的出口**。

> ⚠️ **这跟 `src/features/payments/providers/shopify/` 那个支付通道不是一回事**
> —— 那个 2026-11-05 就退出 `ENABLED_PAYMENT_CHANNELS` 了(`SHOPIFY_STORE_DOMAIN`
> 那套是 Admin API,给收款用的)。这里是**顾客访问地址**。两个变量名也刻意不一样:
> `SHOPIFY_STORE_DOMAIN` vs `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL`。

#### 「外国访客」**不等于**「会看英文」——**所有语言站都出现**

> 2026-11-11 工作室改的口径:**「不是 en 才是,所有都要」**。

原来这条入口**只在英文站**出现 —— 当时的假设是「外国访客 = 会看英文」。工作室
否掉了这个假设:**中文站上也有境外买家**(中文是他们的母语),境内价格 / 境内
物流 / 境内客服对他们不合适 ⇒ 入口该给。

- **境内买家看到会不会困惑?** 靠**文案**解决,不靠**藏起来** —— 公告条写的是
  「中国大陆以外下单?请前往我们的海外独立站」,境内的人看完知道跟自己没关系,
  不会误点。**藏起来(只给英文站)那份才是错的** —— 那些真正需要出口的人反而
  看不到。
- **本仓库仍然没有 geo / IP / `navigator.language` 判断** —— 现在一个都没有,
  也不该为了这个加。**所有语言站一律显示**是最简单也最不会错的判定。
- **判定不看 locale** ⇒ 两端渲染出来的是同一个导航(不靠 `typeof window`
  分支,见 MEMORY 那条「不许用 `typeof window` 分支」)。公告条是
  **server component**,locale 只用来**取文案**(bar / barCta / nav 三条),
  两端渲染出来的是同一份 HTML。

#### 四条口径

| 什么 | 口径 |
|---|---|
| 出现的位置 | **所有语言站都出现** —— `/en` 和 `/zh` 都有(2026-11-11 改的,原来只在 `/en`) |
| 公告条 | 顶部一条细条,**挂在头上面**(头是 sticky 的,条在头下面会被盖住) |
| 导航按钮 | 商城那个头(`WjpStoreHeader`)里的一项,桌面端 + 移动端 Sheet **两处** |
| 没配地址 | **不显示入口** —— 宁可没有,也不要一条指向空地址的死链 |

- **可见性判定只有一份** —— `shouldShowInternationalStore(url)`
  (`international-store.ts`,纯函数,**只有一个入参:地址**)。公告条(server)和
  导航按钮(client)共用它,**两处不可能漂** —— 而且它能进 `unit` project 跑单测,
  不用起浏览器。
- **公告条挂在两个 layout 上** —— `(marketing-atelier)`(商城 + 工具页 + 账户页)
  和 `(marketing)`(博客 / 作品集 / 法律页)。两个 layout 现在都读
  `params: Promise<{ locale: string }>` —— **读 params 不会把页面变成动态渲染**
  (`[locale]/layout.tsx` 已经有 `generateStaticParams`,locale 在构建期就是确定的)。
  别顺手加 `await connection()`。
- **导航项是站外链接** —— 直接 `<a href target="_blank" rel="noopener noreferrer">`,
  **不用 next-intl 的 `<Link>`**(那个是给站内路由加 locale 前缀的)。
- **文案走 i18n** —— `InternationalStore.{bar,barCta,nav}`,en / zh 两份键完全一致。
  导航项的标题**不在** `occasion-data.ts` 里写死 —— 那一支 `kind: "external"`
  刻意**不带** `label` / `labelEn`,标题从 `InternationalStore.nav` 来,
  两份文案不会重复。

#### 环境变量

`NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL` —— 独立站的顾客访问地址。

- **没配就是空字符串**(`src/config/site.ts` 的 `siteConfig.internationalStoreUrl`),
  空 ⇒ 两边都不显示入口。
- **`NEXT_PUBLIC_*` 是构建期内联的** ⇒ 改完环境变量要**重新部署**才生效,
  不是改完刷新页面就行。
- `.env.example` 被 gitignore ⇒ 变量说明写在 `src/config/site.ts` 的**文件头注释**里。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/marketing/pure/international-store.test.ts` | 可见性判定(**配了地址就出现 —— 所有语言站都出现**;空地址不出现)/ **判定里没有 locale 那一层**(函数只有一个入参;两个渲染处都不传 locale)/ 地址读 `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL` / **`SHOPIFY_STORE_DOMAIN` 不许进新代码**(别跟已下线的支付通道混)/ 公告条挂在两个 layout 上且在 header **上面** / 布局读了 `params` / `STORE_NAV` 有 `external` 这一支 / 渲染成 `<a target=_blank>` / 桌面端 + 移动端两处都处理了 / 中英文 key 一致 |

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
  取整可能差 1 分,差额由**最后一档**吸收。否则工单上会出现「8.3 g ×
  ¥0.50/g + 4.2 g × ¥1.00/g」跟「支撑加价 ¥6.60」对不上。
- **默认关**(`support_enabled = false`)—— 默认开的话每一单都会悄悄多收
  一笔支撑费,而克重工具那边从不收这个钱,两边对不上。
- 工单上摆出「支撑加价 ¥x(6.7 g × ¥0.50/g)」—— 服务端重算报价时把
  `supportFeeCents` / `supportFeeBands` 带回来,**纯展示用,不参与定价**。

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

### 访客可见计价(2026-11-07)

工作室的原话:**「现在不登录也允许计价显示,后台需要做一个开关」**。

- **工具页是公开的** —— `/tools/workbench` 谁都能进。以前克重能看、**价看不见**
  (价要登录之后加进购物袋才摆出来),工作室现在要访客也能先看到大概要多少钱。
- **开关在后台** —— `/admin/print-pricing` 的「计价设置」里多了一颗
  **「访客可见计价」**(`Switch`)。关掉之后:没登录的人在工具页看不到金额,
  **登录后照常看得到** —— 开关只管访客,不管已登录的人。
- **默认开** —— 工作室现在就要这个行为。

#### 回退链(跟其余字段一样,逐字段)

```
DB 配置行 → PRINT_ALLOW_GUEST_PRICING 环境变量 → 默认(开)
```

- **默认开** = `process.env.PRINT_ALLOW_GUEST_PRICING !== "false"` ——
  只有**显式**写 `"false"` 才关。不配环境变量时访客能看价。
- 存进 `print_pricing_config.allow_guest_pricing`(新列,`NOT NULL DEFAULT true`)。
- 后台第一次点「保存」之前,这一栏走的是 env / 默认值那一档。

#### 两道闸在报价接口上

`POST /api/print-quote`(以前那行「未登录直接 401 请先登录」**删掉了**):

| 登录了吗 | 开关 | 结果 |
|---|---|---|
| 是 | 随便 | **200** —— 能下单就能看价 |
| 否 | 开 | **200** |
| 否 | 关 | **403 `GUEST_PRICING_DISABLED`** |

- **不许偷偷回 200 然后在前端藏起来** —— 那等于没关。403 才是真的关。
- 界面拿到 403 就摆「登录后可见报价」(`preview.signInRequired`),不是摆一个
  空白的框。

#### 工具页那个数是**服务端算的**

- 工具页**不自己算价** —— 客户端一个加法都不做(单价 / 阈值 / 比例一律不发到
  浏览器,`ClientPrintConfig` 只有两个密度 + 两个几何参数)。它把几何 POST 到
  `/api/print-quote`,拿回服务端 `computePrintQuote(settings, input)` 的结果。
  **服务端算的价才是要收的钱**,客户端算的那个只是预览。
- **摆在哪** —— **报价弹窗**里(`print-service-quote-dialog.tsx`,2026-11-09
  之前在右栏那张「提交打印订单」卡里)。**总额 + 一行明细**
  (克重费 · 后处理费 · 支撑费)。**访客也看得到** —— 弹窗里报价预览在
  「有没有登录」那个分支**外面**,没登录的人照样看得见那个数(开关关着时
  接口回 403,界面摆「登录后可见报价」)。
- **支撑没算的时候明说「未计入」** —— 支撑要用户点「包裹支撑」/「置于平面」
  才算出来,没算之前 `supportWeightG` 是 null,支撑费算成 0 ⇒ **那个预估是
  偏低的**。所以那一格写「未计入」,旁边挂一句「支撑还没算 —— 点「包裹支撑」
  或「置于平面」算一次,金额会更准」。几何一变就自动重新报价(400ms 防抖)。
- **一句话免责** —— 「预估 —— 最终金额以工单为准」。工单上的价才是
  收的价(那边服务端还会**再算一遍**)。

#### 迁移脚本要再跑一遍

`print_pricing_config` 那张表是 2026-11-06 建的,**少 `allow_guest_pricing`
这一列**。少一列的话 `SELECT *` 会整条报错 → 读不到配置 → **整份退回环境变量
兜底**(后台看到的是「读不到定价配置」)。所以迁移脚本里加了一句幂等的
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`:

```bash
pnpm migrate:apply-print-pricing   # = tsx scripts/apply-print-pricing-schema.ts
```

**不代跑** —— 用户的生产库由用户自己执行。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/print-quote/pure/guest-pricing.test.ts` | 后台那颗开关在不在 / 回退链(逐字段)/ 迁移脚本补那一列 / **未登录不再一律 401** / 403 `GUEST_PRICING_DISABLED` / **已登录的人不受开关管** / 工具页那个数是**问服务端要的**(不许本地算价) / 支撑没算时说「未计入」 |

### 后台改价能生效:价从 DB 来(2026-11-08)

工作室的反馈:**「我在后台改了价,商城还是老价」**。

- **根因** —— 商城网页那条链路从头到尾读的是**代码里的常量**
  (`mock-catalog.ts` 的 `BASE_PRICE_CENTS`),不是 DB。小程序那一侧
  **早就是 DB 优先** ⇒ 后台改基础价 → **小程序变了、商城网页没变**。
- **配件加价**也是同一处漂移:商城读代码常量 `PRODUCT_ACCESSORY_VARIANTS`,
  小程序读 DB `product_accessory_variant.price_delta_cents`。

#### 真理源搬到 DB

| 项 | 真理源 | 兜底 |
|---|---|---|
| 基础价 | **DB `product.base_price_cents`** | 代码常量 `BASE_PRICE_CENTS` |
| 配件加价 | **DB `product_accessory_variant.price_delta_cents`** | 代码常量 `PRODUCT_ACCESSORY_VARIANTS` |
| 尺寸加价 | 代码 `idx × 500` | 三处口径本来就一致,**不动** |
| 材料 / 风格 / 刻字 / 加急 | 代码常量 | 后台没有旋钮,**不动** |
| SKU 绝对价 | **由基础价自动算** | 没有独立旋钮了 |

工作室拍板的口径是**「基础价说了算」** —— 基础价是**唯一**的价源,
SKU 绝对价由它**自动算出来**,后台 SKU 页的价格字段改成**只读**。

#### 两个新文件(拆开是因为一个要能进 unit project)

- `src/features/storefront/lib/price-source-types.ts` —— **纯类型**
  (`PriceSource`)。单独一个文件的原因:`pricing.ts` 是纯函数,一旦它 import
  了 `@/db` 就既进不了 `unit` project 也进不了客户端组件。
- `src/features/storefront/lib/price-source.ts` —— **只准服务端 import**。
  `getPriceSource()` 用 React 的 `cache()` 包一层(跟 `print-quote/lib/pricing-store.ts`
  一个套路)—— **一个请求只查一次库**,不是每行一次。

#### ⚠️ 必须 `await connection()` —— 否则「改了不生效」原地复发

商城页现在是**构建期静态预渲染**的(`(marketing)` / `(marketing-atelier)` 两个组里
**一个** `export const dynamic` 都没有)。价从 DB 读、而不告诉 Next「这一页不能静态」⇒
**构建时把当时的价烤进 HTML**,改完价刷新页面**还是旧价** —— 症状一模一样,只是换了个原因。

- `getPriceSource()` 里调一次 **`await connection()`** 就够 —— 凡是显示价格的页面
  因此都变成动态渲染,不用给每个页面加 `force-dynamic`(那会让整个营销站永远动态,动静太大)。
- `connection()` 放在 `cache()` **外面** —— React 的 `cache()` 会把结果按请求缓存,
  放在里面的话第一次调用就被冻住了。
- `connection()` 在**没有请求作用域**时(脚本 / 单测直接调)抛 `E251` ⇒ **只吞这一种**,
  别的错照常抛。
- 后台改完价还要 `revalidatePath` 商城路径(清 RSC 载荷缓存 / 客户端 Router Cache):
  `revalidatePath("/[locale]", "page")` / `revalidatePath("/[locale]/marketing/products", "page")`
  / `revalidatePath("/[locale]/product/[handle]", "page")`。

#### 价怎么进 `calculatePricing`

`calculatePricing(spec, priceSource?)` —— 加一个**可选第二参**,DB 的价塞在参数里,
纯函数自己不碰 DB:

- 基础价:`priceSource?.basePriceCentsByTypeCode.get(spec.productTypeCode) ?? product.basePriceCents`
- 配件加价:`priceSource?.accessoryDeltaCentsByVariantId.get(variantId) ?? variant.surchargeCents`
- `priceSource` 缺省 → **退回代码常量**(纯函数调用、单测、客户端预览都不受影响)。

#### DB 读失败怎么办 —— **两个地方不一样**

| 地方 | DB 读失败时 | 为什么 |
|---|---|---|
| **购物袋 / 商品页**(给人看的) | **降级到代码常量**,页面照常显示 + 一条日志 | 展示价低了一档还能接受 |
| **结算 / 下单**(要收钱的) | **直接抛 `CheckoutError("PRICING_FAILED")`** | **绝不允许按旧价收款** |

⇒ `getPriceSource()` **不抛错**,把「查没查到」放进 `degraded` 标志;**抛不抛由调用点决定**。
购物袋显示 ¥19 而结算报「价格暂时无法确认,请稍后重试」—— 这是**故意的**:
宁可下不了单,也不能按一个**已经作废的价**收钱。

#### 配件的键 = `acc_${variantCode}`

跟 `spec.accessoryVariantIds` 里那个字符串**一模一样**。DB 的行 id 是
`pav_<型号>_<配件>_<变体>`,**跟商城的键不是一回事** ⇒ 价格表查出来之后**自己拼键**。

- 不变式:**`variantCode` 全局唯一**(19 条配件变体零重复,只出现在 R / M 两个型号上)。
  哪天同一个 `variantCode` 出现在两个型号下,加价就变成「取到哪个算哪个」⇒
  有单测守着(`accessory-variant-unique.test.ts`)。
- DB 里查到**歧义**的行直接**丢掉并记日志** —— 宁可少一条配件加价,也不能算错。

#### 客户端组件里一份价都不许算

`shop-grid` / `featured-products` / `store-hero` / `category-strip` 原来直接 import
静态目录,现在**价从 props 来**,服务端父组件取价传下去。`customize-entry`、
商品详情页、`/api/store/products` 那几个 server 入口改用
`getStorefrontProducts()` / `getStorefrontProduct(handle)`。

> `/api/store/products` 的**响应体结构不变**(只是数据源从静态常量换成 DB)
> ⇒ **小程序 SDK 零改动**。

#### 改基础价 → SKU 绝对价自动重算

- `recomputeVariantPrices()`(`product-variant-sku.ts`)—— 按新基础价重算**已经在库里的那些行**,
  **只改价**,**不动** `sellbase_variant_id` / `is_active` / `sort_order`。
- **不能重新播种** —— 会丢 `sellbase_variant_id`、丢软下架状态。
- 尺寸码在字典里找不到 → **跳过那一行**,别当成 0(那样会静默把价改错);
  配件变体查不到 → 同样跳过。
- `generateVariantsForProductInDb` 走 `buildAllVariantSeeds()`,**必须把 DB 的
  `base_price_cents` 传进去** —— 否则改完基础价,「生成变体」出来的新 SKU 又是老价,
  跟重算过的旧 SKU 打架。
- ⚠️ **SKU 价和商城价不是一个东西** —— SKU 价 = 基础价 + 尺寸 + 配件(**裸价**);
  商城单价 = 基础价 + 材料 + 尺寸 + 风格 + 配件 + 刻字 + 加急(**配齐后的价**)。
  两者不是同一个数,这次只让 SKU 价跟着基础价走。

#### 后台 SKU 页的价格字段改成只读

- 删掉整条草稿 / 保存价格的路径,改成「由基础价自动算」的只读展示。
- **`bulkUpdateProductVariantsAction` 的 zod schema 里删掉 `priceCents`** ——
  留着就等于留了个后门:管理员能再把 SKU 价改成跟基础价不一致,直接破坏上面那条不变式。
- `bulkUpdateVariantsInDb` 按 `(priceCents, isActive)` 分组的逻辑改成**只按 `isActive`** ——
  否则传同一个 `priceCents` 会误改一批行的价。
- `isActive` 的开关留着(那个还是能改的)。

#### `apply-currency-schema.ts` 不再覆盖 DB 里的价

价源搬到 DB 之后,那个脚本会把工作室改的价**悄悄改回去**。现在**默认只读校验 +
醒目警告**(列出 DB 里跟代码字典不一致的行),**要重刷必须显式加 `--force-reprice`**。
其余职责(币种对齐)不动。

```bash
pnpm tsx scripts/apply-currency-schema.ts                 # 只读校验,不改价
pnpm tsx scripts/apply-currency-schema.ts --force-reprice # 真要按代码字典重刷才加
```

#### ⚠️ 还有**第二份目录**(不在订单链路里)

`src/features/products/lib/data.ts` 是**另一份目录**(7 件作品集,¥49 / ¥89 / ¥299 /
¥199 / ¥159,**不在 DB 里、不可下单**),给 `/marketing/products/[slug]` 和
`wjp-store-header.tsx` 用。**本次不动它** —— 但**必须跟工作室说清楚**:那几件的价格
仍然是写死的,后台改不了,别让他们改完发现「那几件没变」以为功能坏了。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/storefront/pure/db-price.test.ts` | `pricing.ts` 接受 `priceSource` 第二参 / `price-source.ts` 存在且含 `connection()` / 基础价取自 `priceSource` / `mock-catalog.ts` **不** import `@/db` / `price-source.ts` **不**被 client 组件 import / `checkout.ts` 在 `degraded` 时抛 `PRICING_FAILED` / `apply-currency-schema.ts` 含 `--force-reprice` / `bulkUpdateProductVariantsAction` 的 schema **不含** `priceCents` / `generateVariantsForProductInDb` 传了 DB 基础价 |
| `src/test/storefront/pure/accessory-variant-unique.test.ts` | `variantCode` 全局唯一(配件加价能按它查到唯一一行) |

### 优惠码(订单级)(2026-11-08)

仓库里以前**一个优惠码都没有** —— 现有的「折扣」只有**数量阶梯折扣**,而且是
**折在单价上**的(先折单价,再乘数量),**不是订单级**。

工作室要的是**订单级**的优惠码,而且**商城 + 打印工单两个口子都要能用**
(拍板的口径)。

#### 两种折扣,两码事 —— 落两个列

| | 数量阶梯折扣 | 订单级优惠码 |
|---|---|---|
| 怎么算 | 按**行数量**,**折在单价上** | 整单减,落在**总额**上 |
| 落哪一列 | `storefront_order.discount_cents` | `storefront_order.coupon_discount_cents` |

**两个列,不混在一起** —— 数量阶梯折扣的口径一个字不动,优惠码叠在它后面。

#### 三种类型 + 一个修饰

| kind | 折扣 | 封顶 |
|---|---|---|
| `amount` 满减 | 减固定金额 | 天然封顶在基数里 |
| `percent` 百分比 | `floor(基数 × 费率)` | `max_discount_cents` |
| `free_shipping` 免运费 | 商品不打折,运费置 0 | — |

「**新人首单券**」不是第四种类型 —— 它是 `firstOrderOnly = true` 这个**布尔修饰**,
叠在任意一种 `kind` 上面。**适用范围** `scope` = `mall` / `print` / `both`。

**免运费券在打印工单上没有意义** —— 打印单的 `delivery_fee_cents` 是**交期加价**
(加急费),不是运费 ⇒ 后台 `free_shipping` 券的 scope 只能选 mall;万一有 print / both 的,
打印侧回 `COUPON_NOT_APPLICABLE` 并说人话。

#### 钱一律整数分

`coupon-calc.ts` **零 import**(不引 `@/db`、不引 `server-only` ⇒ 客户端组件也能安全
import 它的类型)—— 连百分比折扣都用整数运算:`discount = floor(base × rateUnits ÷ 10000)`。

**百分比为什么向下取整** —— 仓库的铁律是「**我们收的钱,一律向上取整到分**」。
优惠额向下取整 ⇒ 收上去的合计 = `ceil(基数 × (1 − 费率))` ⇒ **合计向上取整**。
两个方向必须配套,不能各取各的。

#### 商城那条路的代数

```
rawSubtotal        = Σ(原价单价 × 数量)
discountedSubtotal = Σ(折后单价 × 数量)          ← 用户看到的小计
tierDiscount       = rawSubtotal − discountedSubtotal
shipping           = calculateShippingCents(discountedSubtotal)  ← 门槛按**折后小计**算
couponBase         = discountedSubtotal
couponDiscount     = 按类型算(整数分)
shippingAfter      = kind === "free_shipping" ? 0 : shipping
total              = discountedSubtotal − couponDiscount + shippingAfter
```

- **为什么运费门槛在优惠之前算** —— 优惠把金额压到 ¥99 以下反而**多收**运费,那是坑用户。
- **满减 / 百分比不碰运费**(运费不是商品),只有「免运费」券动它。
- `storefront_order.total_cents = subtotal − discount − coupon_discount + shipping`
  (schema 里那条注释也跟着改了 —— 少一项的注释会骗人)。

#### 打印工单那条路的代数

```
quote.totalPriceCents = 克重费 + 后处理费 + 支撑费 + 交期加价
couponBase            = totalPriceCents − deliveryFeeCents   ← **不含交期加价**
payable               = totalPriceCents − couponDiscount
```

- **交期加价是加急费,不是货款** —— 跟运费一个待遇,优惠不碰它。
- **打印工单没有运费行** —— 它的 `delivery_fee_cents` 是加急费,所以免运费券在这儿没有意义。
- **`print_order.total_price_cents` 存的是应付净额**(优惠后),**四个费用列存的是折前的**。

> **为什么不另加一列「应付」** —— 代码里有一堆地方读 `totalPriceCents` 当成
> 「用户要付多少」来显示(工单邮件 / 工单列表 / 详情页 / 后台工单页)。任何一个读成
> 折前总额,用户就会看到「邮件里写 ¥74.82、实际收 ¥69.82」—— **正是「逐分相等」
> 要防的那种不一致**。所以:**要收多少钱,就只有那一列**。

- **`PrintQuote` 本身不动** —— 它的 `totalPriceCents ≡ 四项之和` 那条恒等式不能破
  (客户端的交期档位选择器靠 `total − deliveryFee` 算小计,报价台的加价档位预览也靠它)。
  **优惠是订单级的,不属于「报价」** —— 报价是「这活要多少料多少钱」,优惠是「这一单便宜多少」。
- 优惠基数是**纯函数**(`print-quote/lib/coupon-base.ts`)—— 报价接口和下单接口都用它,
  两处各算一遍迟早对不上(用户会看到「预览说减 ¥20、提交说减 ¥18」)。

#### 优惠码住在车上,不在结算的 body 里

`POST /api/store/checkout` 的 body **不加** `couponCode` 字段 —— 车是服务端从 DB 读的,
码就在 `cart.coupon_code` 那一行上。**少一个入口,少一处能传错的地方。**

- `cart.coupon_code` **只存码,不存折扣金额** —— 折扣每次读车时**现算**
  (车里的行数会变,存的金额会过期)。
- 新接口 **`POST /api/store/carts/[id]/coupon`**,body `{ code }`,**空串 = 摘掉**。
  失败 → **一个字节都不写库**,返 400 + 精确原因码,车上的码原样保留
  (写坏了的后果:购物袋里摆着「省了 ¥20」的标签,结算时却没有那 20 块的优惠)。
  归属校验在**数据层**(cookie 里那张车 / 已过户给这个账号的车),查不到返 **404**
  (不是 403 —— id 能被枚举)。
- `Cart` 类型多三个字段:`couponCode`(车上存的码)/ `coupon`(服务端算好的效果快照)/
  `couponError`(上次失败的原因)。**折扣金额是服务端算的**,客户端一个加法都不做。
- **结算时重新校验、重新算** —— 不信车上的旧结果。码无效 → 400 + 具体 code +
  一个「去掉优惠码」按钮(**不能悄悄按原价收** —— 用户会问「我的码呢」)。
- `computeCartTotals(items, coupon?)` 加一个**可选第二参**(纯函数,不碰 DB):
  优惠额**夹在 0 和小计之间**(不夹会出现负数合计);免运费券下
  `remainingForFreeShippingCents` 也是 0(不然进度条还在催「再买 ¥X 免运费」,而运费已经是 0)。
- **购物袋抽屉不自己算合计** —— 合计从 `useCart()` 的 `totalCents` 来,hook 用的是
  **同一份** `computeCartTotals(items, coupon)`。抽屉自己加一遍 ⇒ 用了券的购物袋跟
  结算页必然显示两个数。
- **结算后摘行时清 `coupon_code`** —— 车空了还留着上一张券,下一单就带着用户没选过的券
  (而且是上一单用掉的那张,可能已超限)。
- **`mergeUserCarts`** 合并游客车和用户车时:用户车有券 → **用户的赢**;用户车没券、
  游客车有券 → 采纳但**必须重新校验**(可能已过期 / 已超限),过不了就丢;
  合并后**重新算 totals**(合并会改小计 ⇒ 门槛可能不再满足)。

#### 「新人首单」怎么判

`user` 表**没有**订单数字段 ⇒ 两个来源都查:`storefront_order`(`status != 'cancelled'`)
和 `print_order`(`status != 'CANCELLED'`)。**两边都查,任一有记录就不是新人。**

- **待付款的单也算下过单** —— 不然用户可以用同一张卡无限次占券。
- **游客(没登录)用「首单券」/「每人限用」的券 → 直接拒** —— 这两种券要判身份,游客没法判。

#### 十个错误码,判定顺序短路(第一个失败即返回,**顺序不能改**)

```
NOT_FOUND → INACTIVE → NOT_STARTED → EXPIRED → SCOPE_MISMATCH
→ NOT_APPLICABLE → MIN_AMOUNT_NOT_MET → LIMIT_REACHED → PER_USER_LIMIT_REACHED → NOT_FIRST_ORDER
```

- `SCOPE_MISMATCH` 要排在 `MIN_AMOUNT_NOT_MET` **前面** —— 券不适用于这张单,
  提示应该是「这张券不能用于当前订单」,而不是「没满 99 减 10」。
- **单一来源**在 `coupon-calc.ts`。商城侧 `CheckoutErrorCode` 只加一个
  `"COUPON_INVALID"`(它决定 HTTP 状态码,不该膨胀成十个),精确原因靠
  `CheckoutError.couponErrorCode` 带出来;打印侧 `print-quote/lib/print-order-error.ts`
  追加这 10 个码。各处文案查同一张表。

#### 「复用上一张待付款单」排在「判券」之前(2026-11-08 复查)

结算的顺序是**先算效果 → 再找复用 → 最后判资格**:

```
2b. evaluateCouponEffect()    ← 只算「这张券能减多少」,不判资格
3.  定通道
4.  findReusablePendingOrder() ← 拿合计去比上一张待付款单
4b. evaluateCoupon()           ← 判资格(过期 / 没满门槛 / 超限 / 不是新人)
```

**为什么不能反** —— 上一张待付款单是**券还有效的时候**建的,折扣已经锁死在
它的合计里了。后来券过期了 / 额度被别人抢完了 —— 用户要付的还是**那张单上的价**
(下单时同意的价)。

顺序反过来会出事:首单券建的那张单已经算作「下过单」⇒ 再判一次就是
`NOT_FIRST_ORDER` ⇒ **用户连自己那张单都付不了**(购物袋还在,但结不了账)。

- **两个口径** ——「能减多少」(`coupon-calc.ts` 的 `computeCouponEffect`,纯函数)
  和「还能不能用」(`checkCouponApplicable`)。**折扣金额两边必须一致** ⇒
  两处都调 `computeCouponEffect()` 这一份。
- **车里有码但查不到这张券 → 直接报 `COUPON_NOT_FOUND`** —— 券只停用不删,
  所以「查不到」= 这张券从来没存在过。别悄悄按原价收(用户会问「我的码呢」)。

#### 券的总量上限是**硬闸**(2026-11-08 复查)

`used_count` 的自增带 `used_count < usage_limit` 的守卫。**守卫不通过 = 这张券
被超发了一次** —— 超发一次 = 工作室的预算多让出去一次 ⇒ **不能让这一单成立**。

- **记账跟建单在同一个事务里** —— 商城那条路在 `checkout.ts` 的
  `db.transaction`(订单 + 订单行 + 记用券),打印那条路在
  `src/app/api/print-orders/route.ts` 的 `db.transaction`(工单 + 记用券)。
  守卫不通过 → 抛 `CouponUsageLimitError` → 事务回滚 → 订单不成立。
- **`redeemCoupon()` 收 `tx`** —— 不传就自己开一个事务(插入 + 自增同生共死,
  不会出现「记了用券、额度没加」那种半截状态)。
- **额度满了给用户一句人话** —— 商城侧 `CheckoutError("COUPON_INVALID", …,
  "COUPON_LIMIT_REACHED")` → 400;打印侧 400 + `error: "COUPON_LIMIT_REACHED"`。
- **折扣 0 的券也记** —— 免运费券在商品上减 0,但它**用了这张券**。不记,额度就
  少算一次,同一张券会被用出去比上限多一次。**两个口子口径必须一样**
  (打印那条路原来写的是 `couponDiscountCents > 0`,已去掉)。

#### 两张新表

- `coupon` —— 码(唯一,**大写归一化**后存 —— 用户输入不区分大小写)/ 名称 / 类型 /
  面额或费率 / 折扣封顶 / 满多少 / 适用范围 / 新人首单开关 / 有效期 /
  总次数上限 / 每人限用次数 / 已用次数 / 启用停用。**停用而不是删**。
- `coupon_redemption` —— 谁在哪个单上用了哪个码。**唯一索引 `(order_kind, order_id)`** ——
  幂等性要的是「**一单只记一次**」,重投的建单请求不能把 `used_count` 加两遍。
  `coupon_id` **不进**唯一键(一单只可能用一个码)。

#### 收银台的总额公式**只有一份**

优惠是**订单级**的 —— 优惠不会落到任何一行的单价上,而收银台的总额是**从各行算出来的**。
微信 Native 只发 `amount.total`,支付宝 `buildBizContent` 只有 `total_amount` + `subject`,
**都没有 goods_detail** ⇒ 给 `PaymentRequest` 加一个**可选**字段 `discountCents?: number`。

**总额公式提到 `src/features/payments/lib/total.ts`** —— 微信和支付宝**都 import 它**
(原来两边各写一份一模一样 —— 改了一份忘了另一份,逐分相等就只在一条通道上破了,
而那种 bug 要等到真收钱那天才看得出来)。`computeTotalCents()` 带两道闸:
折扣不能为负、不能超过总额。

```
computeTotalCents = Σ(折后单价 × 数量) + 运费 − 优惠
                   = discountedSubtotal + shipping − couponDiscount
                   = storefront_order.total_cents     ✅ 一分不差
```

**折扣不摊到各行单价上** —— 摊完要除回单价,**除不尽**(100 分摊到 3 件 = 33.33),
单价必须是整数 ⇒ 摊不平。摊分会引入 `round` 误差(`Σ round(xᵢ)` ≠ `round(Σ xᵢ)`),
逐分相等直接被破坏。

#### 三个必须堵的口子

1. **`order-payment.ts` 的「重新获取付款入口」** 用 order 行 + item 行**重建**
   `PaymentRequest`,原来不带任何优惠信息 ⇒ 用户点一下,重建出来的总额**比订单应付
   多出优惠那一份** ⇒ **多收钱**。**必须补 `discountCents: order.couponDiscountCents`。**
2. **旧 Sellbase 通道**逐项换算,**没有折扣概念**,也支持不了「免运费」⇒ 带券的订单
   走这条路必然对不上账。legacy 分支入口加硬闸:带优惠码就抛错。这条路新订单永远
   走不到(`ENABLED_PAYMENT_CHANNELS = ["wechat","alipay"]`),是防御性的。
3. **Shopify provider 显式炸** —— 草稿单只能设一个总价,`acceptAutomaticDiscounts: false`。
   带着 `discountCents` 跑 ⇒ 我们减了折扣、Shopify 按原价建单 ⇒ 对不上账。
   `discountCents > 0` 时抛 `PaymentProviderError`。

#### 后台 `/admin/coupons`

照 `/admin/print-pricing` 的样子:**就地展开编辑,不开弹窗**(工作室的口味)。

| 文件 | 干什么 |
|---|---|
| `src/app/[locale]/(admin)/admin/coupons/page.tsx` | RSC **只**渲染 `<CouponsAdminView />`(RBAC 由父 layout 守) |
| `src/features/coupon/admin/types.ts` | 视图模型 + 错误码联合类型(**类型放这儿,不在 `"use server"` 文件里**) |
| `src/features/coupon/admin/actions.ts` | `"use server"` + `adminAction`;写操作返 `{ok:true}` / `{ok:false,code}`,**不 throw** |
| `src/features/coupon/admin/components/coupons-admin-view.tsx` | antd `Form` + `Table`,`editingId` 状态机 |
| `src/features/coupon/lib/coupon-store.ts` | Drizzle 读写 |
| `src/features/coupon/lib/coupon-calc.ts` | 纯函数(**零 import**) |

界面给 4 个预设按钮(满减 / 百分比 / 免运费 / 新人首单)—— 底层 `kind` 只有 3 个值。
金额输入框**收整数分**,折扣率用百分比(填 15 → 提交转 0.15)。

#### 迁移脚本(**只写,不跑**)

`scripts/apply-coupon-schema.ts` —— 建两张表 + 给 `cart` / `storefront_order` /
`print_order` 加列,幂等,支持 `--dry-run` 只打印 SQL。

```bash
pnpm migrate:apply-coupon   # = tsx scripts/apply-coupon-schema.ts
```

**不代跑** —— 用户的生产库由用户自己执行。**老订单的金额一个都不能变** ——
迁移只加列,不重算历史应付。

#### 不做 / 另开一次改动

- 不做按商品 / 分类限定的券(订单级,整单减)。
- 不把优惠码发给小程序(小程序调 `/api/store/**`,加券要改 SDK)—— 但
  `/api/store/products` 的**响应结构不变**,所以改价那部分小程序零改动。
- **支付回调的金额校验**(`settle.ts` 现在**不比对**渠道通知的金额)—— **独立的风控问题**,
  跟这两个功能无关,**另开一次改动**,别把「优惠码上线」和「支付风控」混在一个提交里。
- **打印工单建单**不是幂等的 —— 现在只有两道软闸:客户端 `phase === "submitting"`
  把按钮禁掉 + 服务端 `strict` 限流 3 次/分钟。**重复提交会建出两张工单**
  (用户看到两条待付款,可能付两次)。要做真正的幂等得加一个**幂等键**
  (客户端生成 + 一列 + 唯一索引 + 建单时按键查),那是**一次单独的改动**
  (要迁移脚本、要改 SDK)。**先记着,别当成已经解决了。**

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/coupon/pure/coupon-calc.test.ts` | 满减封顶 / 百分比**向下取整**(⇒ 合计向上取整)/ 免运费 / 门槛判定 / 零小计 / 三种 scope / 首单判定 / 限额 / 时窗 / **效果**(`computeCouponEffect`:只算能减多少,**不判资格** —— 过期的券、额度用完的券也**算得出效果**) |
| `src/test/storefront/pure/coupon-in-cart.test.ts` | 购物袋合计口径(优惠行 / 免运费 / 合计 = 小计 − 优惠 + 运费) |
| `src/test/coupon/pure/coupon-flow.test.ts` | 两个 provider **共用一份**总额实现 / `PaymentRequest` 有 `discountCents` / **`order-payment.ts` 传了 `order.couponDiscountCents`** / `checkout.ts` 读 `cart.coupon_code` / `cart-totals.ts` **不** import `@/db` / `coupon-calc.ts` **零 import** / `print-order-error.ts` 含 10 个码 / `pending-order.ts` 比较 `couponCode` / 摘行时清 `coupon_code` / `shopify/draft-order.ts` 对 `discountCents > 0` 抛错 / **抽屉不自己算合计** / **⑫ 复用排在判资格之前** / **⑬ 记用券在建单事务里** / **⑭ 额度是硬闸(超发就抛)** / **⑮ 打印工单同事务 + 额度满了回 400** / **⑯ `evaluateCouponEffect` 不判资格** / **⑰ 购物袋兜底价保留阶梯折扣** |
| `src/test/coupon/pure/coupon-admin.test.ts` | 后台页在不在 / 迁移脚本补没补那几列 / `"use server"` 文件**没** re-export 类型 / 中英文 `AdminCoupons` 键一样 / 每个错误码两种语言都摆得上话 |
| `src/test/payments/pure/payment-discount.test.ts` | **逐分相等**:带优惠的请求,总额 = 订单应付 / 负折扣抛错 / 折扣超过总额抛错 / 两个 provider 是不是同一个函数 |

### 「提交打印订单」失败:失败的话要说人话(2026-11-08)

> **这一节的前半段(「缺一列就全线 500」)已经作废。**
>
> 2026-11-08 打印服务「并进商城购物袋」那一版把 `cart` 表的 **`kind` 那一列
> 删了** —— 两张车合成一张,那个维度没用了。Drizzle 查车时不再把 `kind` 列进
> SELECT,**42703 那个坑跟着一起没了**。
>
> `scripts/apply-print-cart-schema.ts` 一并删掉,**不用跑那条迁移**。
> 生产的 `cart` 表上那个 `kind` 列**留着无害**(Drizzle 不再引用它),
> 要不要 `DROP` 由工作室自己决定 —— 留着更稳(万一要回滚)。
>
> 当年那条教训仍然成立:**两张车共用一张表时,多出来的那个维度容易被漏掉**
> —— 漏了不是「那一条路不通」,是**所有查车的接口一起 500**。现在少了一个
> 维度,这个坑也就没了。

#### 失败的话要说人话

那一次排查之所以费劲,是因为界面只有一句「请稍后重试」。现在:

- **服务端每个失败都带一个稳定的 `code`**(`AUTH_REQUIRED` /
  `R2_NOT_CONFIGURED` / `MODEL_NOT_FOUND` / `INVALID_MODEL_URL` /
  `CART_NOT_FOUND` / `INVALID_INPUT` / `INVALID_TYPE` /
  `ADD_LINE_ITEM_FAILED` / `PRESIGN_FAILED`)。
  (`CART_KIND_MISMATCH` 2026-11-08 删掉了 —— 只有一张车,不存在「放错车」。)
- **客户端按 code 查文案表** —— `print-quote/lib/print-order-error.ts`
  (纯文件,能进 unit project)。查得到就摆具体的(「模型文件没找到 —— 重新拖
  一次模型」),查不到才退回笼统那句。
- **原始报错留在 console** —— 服务端的原始 message 可能带着表结构这类内部
  信息,不该直接摆给访客。
- **两个 fetch 助手共用一份解析** —— `shared/lib/request-error.ts` 的
  `toRequestError()`。上传那条(`print-quote/lib/upload-model.ts`)和加行那条
  (`storefront/hooks/use-cart.ts`)各写一遍解析,迟早漂移。
- **两种服务端约定都认** —— `/api/print-orders/upload-url` 返回
  `{error: "R2 未配置", code: "R2_NOT_CONFIGURED"}`(`error` 是人话),
  加行那个返回 `{error: "MODEL_NOT_FOUND", message: "…"}`(`error` 本身就是
  码)。`extractErrorCode()` 两个都看,**只认 code 形状的字符串**。
- **响应体里不再回原始 SQL** —— 加行那步 catch 里用
  `print-quote/lib/db-error.ts` 的 `describeDbError()` 摘出真原因写进
  **服务端日志**(「数据库缺表 / 缺列(迁移脚本没跑?)」),响应体只给一句
  人话。原始 SQL 不往外发。

#### 「提交打印订单」那张卡搬到右侧(2026-11-08,**2026-11-09 撤了**)

工作室的要求(2026-11-08):**「加入购物袋放在右侧」** —— 那时候它还叫「加入
购物袋」,后来改叫「提交打印订单」。

> **2026-11-09 整段撤掉了。** 工作室的原话:**「报价不放在右侧了,直接在区域
> 内用一个报价按钮,点击后显示报价弹窗,弹窗里面去下单」**。右栏那一列
> (288px)把 3D 视口挤成了一条窄带 —— 见下面「视口被挤扁了」两条。
> 现在工作台是**一整块**,出口是视口底下那条控制条上的「报价」按钮。
> 下面这段只作**历史**记录 —— **别再照着它实现**。

- 以前那张卡在**工作台下面**(整页宽度);后来它是工作台**右边那一栏**
  (`xl` 断点以上并排,窄屏还是在下面)。
- 实现:`pricing/components/model-settings-panel.tsx` 的根容器加
  `xl:flex xl:items-start xl:gap-4`,深色应用那块加 `xl:min-w-0 xl:flex-1`,
  卡片那个 `div` 加 `xl:w-[288px] xl:shrink-0`。
  → **2026-11-09 这三样全撤了**:`xl:flex` / `xl:min-w-0` / `xl:w-[288px]`
  都不在了,卡片那个文件(`print-service-submit-card.tsx`)**删了**。

#### 视口被挤扁了(2026-11-09)

工作室的原话:**「现在工具多了右边的报价后把预览区挤到了左边」**。

- **根因** —— 页面主容器封顶 **1280px**,右边这一栏 320px + 间距 16px
  之后,工作台那块只剩 `1280 − 48 − 336 = 896px`;再减去 400px 的侧栏,
  **3D 视口只剩 ~496px** —— 一个竖着的窄条,没法看模型。
- **第一步:三个数一起改**(2026-11-09):

  | 什么 | 以前 | 改完 |
  |---|---|---|
  | 页面主容器(`pricing-calculator.tsx` 的 `<main>`) | `max-w-[1280px]` | **`max-w-[1600px]`** |
  | 左侧信息栏(`md:w-[*]`) | 400px | **360px** |
  | 右边「提交打印订单」那一栏(`xl:w-[*]`) | 320px | **288px** |

- **第二步:那一列整个撤掉**(2026-11-09,**这一版才是现在的样子**)——
  报价改成**区域内一颗按钮 + 弹窗**,右栏没有存在理由了。
  - `model-settings-panel.tsx` 的根容器回到**单列**(不再 `xl:flex`),
    深色应用那块不再是 `xl:flex-1` 的一列 —— 整块拿回全部宽度。
  - 「报价」按钮挂在**左栏底部的固定条**上(`primaryAction` 插槽;2026-11-10
    从浮层控制条搬下来的)。
  - `print-service-submit-card.tsx`(右栏那张卡)**删了**;预估价 + 下单表单
    都搬进 `print-service-quote-dialog.tsx`。
  - **主容器 `max-w-[1600px]` 保留** —— 视口宽一点总没坏处。
- **介绍 / 模式切换那两段仍然是 1280px**(`max-w-[1280px] mx-auto`)——
  它们跟页面头部对齐;只有下面那块 3D 工作台用满 1600px。
- **1440px 宽的屏上**:视口从 ~496px 涨到 ~730px(撤掉右栏之后还更多)。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/print-quote/pure/print-order-error.test.ts` | code → 文案 key 的映射 / **认不出来的 code 退回 `null`** / 两种服务端错误约定都认 / 原始 SQL 不进响应体 / **`CART_KIND_MISMATCH` 没有了** |

### 后台文件管理(2026-11-08)

工作室的要求:**「后台需要增加文件管理」**。范围 = **整个 R2 桶**,落地页默认停在
`print-orders/`(工作室日常看的是打印模型那一支),**做删除按钮**(桶策略真拒了
就把真原因摆出来),**要显示归属**(用户名 + 邮箱)。

- **路由** —— `/admin/files`(侧边栏「文件管理」)。RSC 只渲染
  `<FilesAdminView />`,RBAC 由父 layout 的 `checkAdmin()` 守。
- **模块** —— `src/features/storage/admin/`

  | 文件 | 干什么 |
  |---|---|
  | `types.ts` | 视图模型(`AdminFileObject` / `AdminFileFolder` / `AdminFilesListing` / 错误码)。**不在 `"use server"` 文件里** —— 那种文件 re-export 类型会让 Turbopack 注册出一个不存在的 action,运行时 `ReferenceError` → 整页 500 |
  | `lib/paths.ts` | 纯函数:前缀 / 对象键的校验、`folderName()` / `parentPrefix()` / `buildBreadcrumb()` / `fileExt()` / `fileKind()` / `printOrderScopeFromKey()` / `rawUserIdFromKey()` |
  | `lib/owner-map.ts` | 纯函数:`buildOwnerIndex(users)` → `{byId, byScope}`;`resolveFileOwner(key, index)` |
  | `lib/owner-store.ts` | 服务端:读 `user` 表(id/name/email)→ 喂给 `buildOwnerIndex`。**读库失败不抛** —— 归属显示不出来而已,不该让整个文件列表打不开 |
  | `lib/errors.ts` | 纯函数:R2 抛回来的东西 → 稳定的码 |
  | `actions.ts` | `"use server"` + `adminAction` |
  | `components/files-admin-view.tsx` | 客户端视图 |

- **这一页管的是 R2 桶(`R2_*`),不是头像桶** —— `features/storage/providers/s3.ts`
  那个桶走 `STORAGE_*` 环境变量,跟这一页没关系。走错桶 = 页面空着。

#### 键的形状

```
print-orders/<scope>/<YYYY-MM-DD>/<时间戳>-<nanoid>.<ext>   打印模型(按用户分区)
gpt-image/…  image-gen/…  canvas/results/<userId>/…  user-uploads/<userId>/…
public-uploads/…  orders/…
```

- `<scope>` = `sha256(userId)` 的前 16 位(`print-quote/lib/upload-key.ts` 的
  `printOrderScope()`)—— **必须 import 同一个函数**,自己另写一份 sha256 两边
  对不上,谁也认不出谁。
- 2026-11-01 之前的老键是 `print-orders/<日期>/…`,**没有分区** —— 那一支
  认不出归属,显示「—」是对的。
- 桶里现存的 1089 个对象,每一段都长成 `[\w.-]+`(已核对,零例外),也没有一个
  键含 `..`。校验规则就是照这个定的:前缀 = `""` 或 `段(/段)*` + 结尾斜杠;
  对象键 = `段(/段)*`,不能以斜杠结尾。**服务端校验**,不收客户端的路径。

#### 归属是**反查**出来的

sha256 不可逆,但**用户表是有限的** —— 把表里每个 userId 都算一遍哈希,建一张
「哈希 → 用户」的表就能反查。这是**枚举**,不是破解。

- `print-orders/<scope>/…` → 查 `byScope`
- `user-uploads/<userId>/…` 和 `canvas/results/<userId>/…` → 直接是裸 userId,
  查 `byId`
- 其它(`gpt-image/` / `orders/` / `public-uploads/`)→ 认不出来,摆「—」,**不猜**

用户表只有几百到几千行,只取三列,同一个请求内只查一次(`cache()`)—— 成本很低。

#### 「文件夹 + 文件」两层视图 = `Delimiter: "/"`

`ListObjectsV2` 传 `Delimiter: "/"` → R2 在「这一层」停下,返回
`CommonPrefixes`(子目录)+ `Contents`(本层文件)。不传 delimiter 的话一次会把这个
前缀下**所有**子目录的文件全倒出来。翻页用不透明的 `NextContinuationToken`,
原样传回去。

#### 公开链接 ≠ 下载链接

- `getPublicUrl()` 在**没配** `R2_PUBLIC_BASE_URL` 时会退化成 S3 API 地址
  (`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`)—— 那个地址在
  浏览器里**打不开**(要签名)。所以 `hasPublicBase()` 为假的时候:不摆缩略图、
  「复制链接」只摆一句提示。
- 「下载 / 预览」走 **15 分钟的签名 URL**(`presignDownload`)。强制下载靠
  `GetObjectCommand` 的 `ResponseContentDisposition`(`attachment; filename*=…`)
  —— 这个参数是**签进签名里**的,不是事后往 URL 上挂 query(挂了签名就对不上)。

#### 删除大概率会失败 —— 而且失败是**预期内**的

这个桶的桶策略锁着对象(`ObjectLockedByBucketPolicy`,HTTP 409,2026-11-01 实测
过一次)。桶策略在 Cloudflare 后台配,**代码改不了**。

- `ObjectLockedByBucketPolicy` / 409 → `R2_DELETE_BLOCKED` → 界面摆
  **「桶策略锁着这个对象,删不掉 —— 要删得去 Cloudflare 后台改桶策略」**
- 404 / `NoSuchKey` → `NOT_FOUND`
- 其它 → `DELETE_FAILED`

**重试对 `R2_DELETE_BLOCKED` 没用** —— 所以那句提示必须说清楚要去找谁改。哪天
桶策略解锁了,这个按钮**不用改**就能删。

#### 行为由单测守住

| 测试 | 守住什么 |
|---|---|
| `src/test/storage/pure/files-admin.test.ts` | 列的是 **R2 桶**不是头像桶 / 前缀和对象键在**服务端**校验 / 删除把 `ObjectLockedByBucketPolicy` 映射成 `R2_DELETE_BLOCKED` / 归属用 `printOrderScope`(同一个 sha256)/ 认三种归属形状 / **「use server」文件不 re-export 类型** / 中英文 `AdminFiles` 键一样 / 侧边栏有这一项 |

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
- **「我的打印订单」装的是** `print_order` 里 `user_id` = 当前用户的那些单 ——
  打印服务现在**直接建工单**(`POST /api/print-orders`),工单带 `user_id` ——
  这个列表装的就是它们。**旧单**(从商城购物袋结算出来的那种)也在这个列表里,
  那种的钱在商城订单那边付。**「我的订单」(`/account/orders`)是商城订单那一张** —— 钱在
  那边付;「我的打印订单」是**工单那一张** —— 做活到哪一步了。
  两张页面各管一件事,别把它们混成一个。

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
  > 工单那个入口**还多一道**:跟着商城订单结的账一律不给入口(返
  > `PAY_VIA_STOREFRONT`),见「打印服务直接建工单」一节 —— 给了就是
  > 让用户付两次。

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

1. **跑迁移** —— 全是幂等的,重复跑没事:
   - `pnpm migrate:apply-payment-channel`(= `apply-payment-channel-schema.ts`)
     —— 给 `storefront_order` / `print_order` 加 5 列 + 2 个索引
   - `pnpm migrate:apply-currency`(= `apply-currency-schema.ts`)
     —— 把 DB 里的币种 / 默认值 / 商品目录的价对齐到**代码里定义的**人民币
   - `pnpm migrate:apply-storefront-cart`(= `apply-storefront-cart-schema.ts`)
     —— 建 `cart` + `cart_item`
     > **`apply-print-cart` 那条 2026-11-08 删掉了** —— 打印服务并进商城
     > 购物袋之后,`cart` 表不再有 `kind` 列,那条迁移不用跑(见
     > 「打印服务直接建工单」一节)。
   - `pnpm migrate:apply-print-order` / `migrate:apply-print-order-event` /
     `migrate:apply-print-order-storefront-link` / `migrate:apply-print-pricing`
     —— 打印工单那套表和定价配置
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
   **打印服务也试一遍** —— 工具页量一个模型 → 点「报价」→ 弹窗里提交打印订单,确认「工单建出来了
   → 工单详情页**给**付款入口 → 钱到了 → 工单变 paid → 订单号跟工作室那边
   对得上」。**旧单**(跟着商城订单结的账那种)也点开看一眼:工单详情页
   **不给**「去支付」,只指到「我的订单」(见「打印服务直接建工单」一节)。
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
  > 工单那个入口在查通道**之前**先判「是不是跟着商城订单结的账」——
  > 是的话返 `PAY_VIA_STOREFRONT`(不给入口),不是 `PAYMENT_NOT_CONFIGURED`。
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
