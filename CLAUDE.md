# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mooncoda is a production-ready Next.js SaaS template. It provides a complete foundation for building SaaS products with authentication, payments, credits system, background job processing, i18n, admin panel, support tickets, and more. Clone, customize, and ship.

**Deployment:** Self-hosted or Vercel + Neon PostgreSQL + Cloudflare R2 (storage)

## 三方系统分工(2026-10-21 更新)

| 系统 | 职责 | 技术栈 |
|---|---|---|
| **NextDevTpl**(本仓库) | AI 生图 SaaS 后端:user / credits / photo / imageJob / AI 路由 / WeChat 小程序登录 **+ 商品目录(商品 / SKU 变体 / 价格)** **+ 打印工单(`/quote` 报价 → `print_order`,按 `user_id` 归属,登录后下单)** | Next.js 16 + Drizzle + PostgreSQL |
| **Medusa**(独立 server) | **购物车 + 订单管理 + 支付管理**(购物车 / 订单 / 支付 / 库存 / 客户地址) | Medusa v2 + Node + PostgreSQL + Redis |
| **微信小程序 / 浏览器访客**(外部客户端) | 调 NextDevTpl AI 接口拿候选图 **+ 调 `/api/image-gen/products` 拿商品与 SKU**;调 Medusa Store API 加购 + 下单 + 支付 | Taro 4 + React 18(小程序);Next.js Medusa Storefront(浏览器) |

**NextDevTpl 不再做**:**购物车 / 结算 / 库存 / 收货地址 / 订单实体** —— 归 Medusa。

**NextDevTpl 现在做商品目录**(2026-10-21 变更,推翻了原「商品 100% 归 Medusa」的决定):
- `product` 表 = 商品资料(名称/描述/封面/基础价/上下架),主键复用 `productTypeCode`(R/A/P/RM/LB/M)
- `product_variant` 表 = 真 SKU(`CODE-SIZE-ACCESSORY-VARIANT` + **绝对价** + 上下架)
- 管理后台 `/admin/products`(列表)+ `/admin/products/[code]`(SKU 明细)
- 对外接口 `GET /api/image-gen/products`,在 `ProductCapability` 上**新增** `variants[]` 字段;旧字段(`basePriceCents` / `sizes[].priceDeltaCents` / `accessories[].variants[]`)全部保留,小程序 SDK 运行时零改动
- 种子脚本 `pnpm tsx src/db/seed-products.ts`(幂等,不覆盖 admin 改过的价)
- **仍然不在 DB 里**:`PRODUCT_TYPES`(每个型号的尺寸 / 配件清单)—— 新增型号仍需改 `src/features/gpt-image/lib/product-catalog.ts`

**NextDevTpl 仍做**:`/marketing/*` 静态品牌页(博客 / 文档 / 法律页 / 价格页)+ `/marketing/products` 作品集 showcase(纯静态作品集,与商品目录无关)。

**集成架构详情**:见 `architecture-medusa-integration.md`(**§〇/§二 的商品归属结论已被 2026-10-21 变更覆盖**)+ `architecture-miniprogram-as-client.md`(项目身份定位)。

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
- **平台在模型最低点下方 1mm**(`SUPPORT_LIFT_MM = 1`):有支撑的时候模型
  不直接贴平台,支撑先在平台上长一层 1mm 托底,模型悬在托底上。所以
  「平台平面」= `mesh.bboxMin[2] - SUPPORT_LIFT_MM`(不是 `shell.groundZ`
  —— 那个还低 0.05~0.1mm 的安全余量,平底模型会凭空多出支撑)。
  平底模型(立方体)的支撑就只剩这 1mm 托底(投影面积 × 1)。
- **托底是固定的 1mm,不跟着模型缩放**:打印机在平台上长一层 1mm,不是
  模型的一部分。所以均匀缩放 k 倍时,空腔按 k³ 走、托底只按占地 k² 走
  (支撑体积比值 = (400·k² + 空腔·k³) / 总量,不是精确的 k³)。
  3D 预览里画的托底也必须按实际尺寸 1mm 画(`obj-viewer.tsx` 的支撑壳
  用**缩放后**的几何算,否则画面跟报价对不上)。
- **缩放跑在真几何上**:用户改尺寸后,支撑计算跑在 `scaleSupportModel`
  缩放过的网格(不是原始网格乘系数)—— 非均匀缩放时高度 / 投影 / 悬垂面
  全变,乘系数会让 50mm 高度限制放行立不住的姿态。
- **支撑克重 = 支撑体积 × 材料密度**(2026-11-04)。`SupportParams` 只剩
  `materialDensity` 一个旋钮(旧的「填充率」「支撑密度」「包裹间隙倍率」全删)。
  **支撑跟模型是同一种材料**:密度一样,填充率也一样(支撑是实心的 = 100%,
  跟模型一样)。以前支撑密度另算 1.9,导致「总克重」既不是包裹后整块的
  重量,也不等于耗材克重 + 支撑克重。

**三个克重的关系(2026-11-03,2026-11-04 改口径)**:

- `wrapVolumeMM3`(**全包裹体积**)= 平台到模型顶的整块(支撑 + 模型),
  逐列取「该列模型最高点 − 平台」求和。
- **支撑克重 = 包裹支撑体积 × 材料密度**(跟模型同一种材料)。
- **总克重 = 全包裹体积 × 材料密度 = 耗材克重 + 支撑克重** —— 包裹后的
  模型就是一个完整模型,整块都是同一种材料,所以总克重**不随支撑材料
  变化**。克重页三个数字(耗材 / 支撑 / 总)就是这个关系;批量汇总的
  「总克重」同口径(耗材 + 支撑)。
- 页面上三个数是**取整后相加**的(耗材和支撑各自向上取整,总克重 = 两者
  之和),不是各自算好再取整 —— 否则会出现 43 + 53 ≠ 95 这种对不上的情况。

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

**支撑克重的姿态标注(2026-11-04)**:

- 克重栏「支撑克重」下面标出这个数是**哪个姿态**的:没跑摆盘是
  「初始角度 0°,0°」,跑完 / 手动微调后是「当前姿态 X {x}° Y {y}°」。
- 智能摆盘结果面板多一行对比:「初始角度 0°,0° 支撑 X g → 当前姿态 Y g」。
  「省 X%」徽标只在真的省下(≥1%)时才出现,省得少就只摆两个数。
- 初始角度只跟尺寸 / 材料密度有关(跟当前角度无关),所以算一次缓存着。
- **支撑克重没有校准面板了**(2026-11-04):填充率 / 支撑密度 / 一键校准
  全删 —— 支撑跟模型同一种材料、同样是实心,没有可调的旋钮。
- 「省 X%」的算法在 `src/features/pricing/lib/pose-comparison.ts`
  (纯函数,不碰 React)。

行为由 `src/test/tools/pure/support-shell.test.ts` 守住(几何),
`src/test/pricing/pure/support-initial-angle.test.ts` 守住(客户端 + 批量汇总),
`src/test/pricing/pure/pose-comparison.test.ts` 守住(省 X% 的算法)。

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
