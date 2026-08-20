# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mooncoda is a production-ready Next.js SaaS template. It provides a complete foundation for building SaaS products with authentication, payments, credits system, background job processing, i18n, admin panel, support tickets, and more. Clone, customize, and ship.

**Deployment:** Self-hosted or Vercel + Neon PostgreSQL + Cloudflare R2 (storage)

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

### Middleware (`src/middleware.ts`)

Handles three concerns in order:
1. **API rate limiting** — Pattern-matched per-route (auth, upload)
2. **Auth protection** — `/dashboard/**` requires session token cookie, auth routes redirect if logged in
3. **i18n routing** — next-intl locale prefix handling

### AI Provider Abstraction (`src/lib/ai/openai.ts`)

Switchable between OpenAI, DeepSeek, and MiMo via `AI_PROVIDER` env var. Optional Cloudflare AI Gateway proxying. Provides a generic `chatCompletion()` function for LLM calls.

## Coding Conventions

- **Language:** Chinese comments throughout the codebase (code itself in English)
- **Path alias:** `@/*` maps to `src/*`
- **Formatting:** Biome — double quotes, semicolons, trailing commas (ES5), 2-space indent, 80 char line width
- **Lint rules:** `noExplicitAny: error`, `noUnusedImports: error`, `noUnusedVariables: error`, `useImportType: error`
- **Server Components by default** — only add `'use client'` when interactivity is needed
- **Data fetching in RSC** — Server Components call Drizzle directly; mutations use Server Actions
- **i18n navigation** — Import `Link`, `redirect`, `usePathname`, `useRouter` from `@/i18n/routing` (not `next/link` or `next/navigation`)
- **API route wrapping** — Use `withApiLogging(handler)` from `@/lib/api-logger.ts`
- **Optional services degrade gracefully** — Rate limiting, Axiom logging, Sentry monitoring all check env vars and silently skip when unconfigured

## Environment Variables

See `.env.example` for the full list. Key pattern: only `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and at least one AI provider key are required. Everything else (OAuth, Creem, storage, Redis, Axiom, Sentry) is optional with graceful degradation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Canvas Module (infinite-canvas 融合)

画布编辑器是 infinite-canvas（Vite SPA）整体迁入的"客户端孤岛"，路由在 `src/app/[locale]/(dashboard)/dashboard/canvas/`，模块代码集中在 `src/features/canvas/`。融合细节按设计文件 `D:\下载\infinite-canvas-nextdevtpl-fusion-plan.md` 推进。

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
