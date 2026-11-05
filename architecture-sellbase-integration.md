# NextDevTpl × Sellbase · 集成架构说明

> **Mooncoda · 小梦定制馆**
> 状态:**已落地**(2026-11-04 收尾)
> 目标读者:技术负责人 / 后端 / 前端 / DevOps
> 前置阅读:[architecture-miniprogram-as-client.md](./architecture-miniprogram-as-client.md)(项目身份定位)
> 取代:[architecture-medusa-integration.md](./architecture-medusa-integration.md)(Medusa 方案,已作废)

---

## 〇、一句话结论

> **本仓库算价,Sellbase 只做收银台。**

商品目录、定价规则、购物车、订单事实、收货地址**全在本仓库**;
Sellbase 只负责「收钱」—— 建一张 Stripe 支付链接,收完钱 webhook 通知本仓库。

这不是「先凑合,以后再迁」,而是**最终形态**:Sellbase 的变体是价格单元,
而本仓库的定价维度(基础价 × 材质 × 尺寸 × AI 风格 × 配件 × 刻字 × 加急)
展开后上万个组合 —— 硬要让 Sellbase 原生购物车跑起来,得造一万多个变体,
而且它的购物车行**没有 metadata 字段**,刻字文字和 AI 预览图无处安放。

---

## 一、三方分工

| 系统 | 职责 | 技术栈 |
|---|---|---|
| **NextDevTpl**(本仓库) | AI 生图 SaaS 后端 + **商品目录** + **定价** + **购物车** + **订单事实** + **收货地址** + **收款编排** | Next.js 16 + Drizzle + PostgreSQL |
| **Sellbase**(独立服务) | **只做收银台**:Stripe 支付链接 + 收款状态 + 收据。商品目录是同步过去的**镜像**,不是真理源 | Supabase Edge Functions(装在**跟本仓库同一个 Supabase 项目**里,见 §1.1)+ Stripe(MIT) |
| **微信小程序 / 浏览器访客** | 调本仓库的 AI 接口拿候选图、调本仓库的商城接口加购结算;支付时**全页跳转 Stripe** | Taro 4 / Next.js |

### 为什么不选 Medusa

Medusa v2 要**另起一台 server**(Node + PostgreSQL + Redis),跟本仓库
「SaaS 模板,自托管或 Vercel」的部署形态不合。Sellbase 是 Supabase Edge
Functions —— 没有服务器要运维,装在**本仓库自己那个 Supabase 项目**里
(同一个项目,不是另开一个 —— 见 §1.1)。

Medusa 时代的方案稿保留在
[architecture-medusa-integration.md](./architecture-medusa-integration.md),
**结论已作废**,别照着做。

### 1.1 共用同一个 Supabase 项目(2026-11-04)

Sellbase **不是**装在另一个 Supabase 项目里 —— 它跟本仓库的 Postgres
**是同一个 Supabase 项目、同一个 `postgres` 库**:

```
DATABASE_URL ──→ postgres.<ref> ── pooler:6543 ──┐
                                                 ├── 同一个 postgres 库
SELLBASE_URL ──→ <ref>.supabase.co/functions/v1/ │
                    sellbase-api/v1 ─────────────┘
```

**不撞表**,因为两边不在同一个 schema:

| | schema | 谁建 |
|---|---|---|
| 本仓库 | `public` | Drizzle(`src/db/schema.ts`) |
| Sellbase | `sellbase` | Sellbase 自己的迁移(`0000_foundation.sql`:`create schema if not exists sellbase;`) |

Sellbase 的表(`sellbase.orders` / `sellbase.products` / `sellbase.customers` …)
全在 `sellbase` schema,本仓库的表全在 `public` —— 同名也不会撞。Sellbase
迁移文件里还写着「Managed by Sellbase migrations: do not alter」。

**本仓库连的是 pooler 事务模式**(`…pooler.supabase.com:6543`)。
`src/db/index.ts` 里的 `isSupabase` 分支负责 SSL:pooler 用自签证书,
要 `rejectUnauthorized: false`,而且 URL 里的 `sslmode` 得先剥掉
(留着会让 pg 库强制校验证书,把配置覆盖掉)。实测 30 次参数化查询全过 ——
事务模式下命名 prepared statement 没炸。

**共用库解锁了一张底牌,但现在不用**:本仓库的连接身份是 `postgres`,
`rolbypassrls = true` —— 所以本仓库**能直接查 `sellbase.orders`**,绕过
Sellbase 的 RLS。webhook 丢事件时可以拿它对账。

**但状态同步仍然只走 webhook**(见 §六)。直读是兜底,不是主通道:

- webhook 事件带的是**业务语义**(`order.paid` / `refund.created`),
  直读表要自己把事件语义翻译一遍 —— 等于把 Sellbase 的状态机抄一份
- 直读绕过 Sellbase 的写入路径,「谁写谁负责」这条边界就破了
- 多一条通道就多一处会漂移的地方

### 1.2 环境变量:一个地址覆盖两边

共用项目 ⇒ **一个** Supabase 地址就够:

| 变量 | 给谁用 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 两边 | `https://<ref>.supabase.co` |
| `DATABASE_URL` | 本仓库 | pooler 连接串(`…pooler.supabase.com:6543/postgres`) |
| `SELLBASE_URL` | 本仓库 | **可以不配** —— `readSellbaseUrl()` 拿 `NEXT_PUBLIC_SUPABASE_URL` 自动拼 `/functions/v1/sellbase-api/v1`(见 §十) |
| `SELLBASE_API_TOKEN` | 本仓库 | 仍要单独配(`mooncoda_live_…` admin token —— 前缀为什么不是 `sb_live_` 见 §1.6) |
| `SELLBASE_WEBHOOK_SECRET` | 本仓库 | 仍要单独配(`POST /webhooks` 只返回一次) |

### 1.3 别在本仓库直接跑 `npx sellbase init`

`npx sellbase init` 是给「空项目」准备的一键脚本,直接在本仓库跑会带进来一堆
本仓库不需要的东西:

| 它会做的事 | 在本仓库的后果 |
|---|---|
| `npm i @sellbase/react @sellbase/admin` | 本仓库走自己的 SDK 层(`@sellbase/sdk`),用不到这两个包 |
| 写 `components/sellbase/*`(provider / product-card / cart-drawer / checkout …) | 跟本仓库的 `src/features/storefront/components/` 重复 |
| 写 `src/app/admin/[[...path]]/page.tsx` | **跟本仓库的 `src/app/[locale]/(admin)/` 打架** —— 两条 `/admin` 路由 |
| **往 CLAUDE.md 追加 `<!-- sellbase:start -->` 托管块** | 本仓库的 CLAUDE.md 是手写的权威文档,不能让托管块覆盖 |
| 写 `.claude/skills/sellbase/`、`.cursor/rules/`、`.mcp.json` | 跟本仓库的 agent 配置混在一起 |
| `supabase db push --include-all` | 把 `supabase/migrations/` 下**所有**迁移打进共享库 |

**推荐做法**:在**空目录**里跑 `npx sellbase init`(拿迁移文件、Edge Function、
store、admin token),再把要的东西挑出来贴进本仓库;或者跑完把上面那几样
副作用清掉再提交。

> `supabase db push` 跟本仓库的迁移体系是**两套**。本仓库的 schema 是 Drizzle
> 管的(`drizzle/` + `scripts/apply-*.ts` 一堆手写幂等脚本),**不要**把本仓库
> 自己的迁移放进 `supabase/migrations/` —— 否则以后 `supabase db push` 会跟
> Drizzle 抢同一张表。

**已经踩过 / 已经解决(2026-11-04)**:

- **不需要先 `supabase link`**:`supabase db push --remote=<连接串>` 直接接受
  一个 URL 当目标 —— 所以「迁移推上去」这一步**不需要** Supabase access token,
  只有 `functions deploy` 才需要。
- **扩展不用手动装**:共享项目本来就装了 `citext` / `btree_gist` /
  `pg_cron` / `pg_net`(前两个在 `extensions` schema),迁移里的
  `create extension if not exists` 全部是空操作。
- **常驻 cron**:Sellbase 的 `0003_jobs_schedule.sql` 挂了一个**每分钟**的
  pg_cron 任务,通过 pg_net 调 `sellbase-jobs` Edge Function。共用项目意味着
  这个项目从此有个常驻后台任务 —— 已确认两个 job 都挂上了:
  `sellbase-release-expired-checkouts` 和 `sellbase-run-jobs`。

### 1.4 共享库现状(2026-11-04 已推到共享库)

共享项目里 Sellbase 的东西现在的实际状态:

| 项 | 状态 |
|---|---|
| 迁移历史 | `supabase_migrations.schema_migrations` = `0000` … `0009`(由 `supabase db push` 写入) |
| 表 | `sellbase` schema 下 **45 张表 + 3 个视图**,`public` schema 下本仓库那 35 张**一张没动** |
| 扩展 | `citext@extensions` `btree_gist@extensions` `pg_net@extensions` `pg_cron@pg_catalog` `supabase_vault@vault` |
| storage bucket | `sellbase-media`(公开)/ `sellbase-digital`(私有) |
| cron | `sellbase-release-expired-checkouts` + `sellbase-run-jobs`,各每分钟一次 |
| 店铺 | 1 个:`Mooncoda 小梦定制馆` · `mooncoda` · CNY · zh-Hans · Asia/Shanghai · CN · `settings.tax = {mode:"inclusive", rate_bps:0}` |
| admin token | 1 个 `mooncoda_live_…`(库里只存 sha256),scope = `DEFAULT_AGENT_SCOPES` **+ `webhooks:write`**,**不含** `refunds:write` |

推迁移的命令(**不需要** access token —— `--remote=` 直接给连接串):

```bash
supabase db push --remote="$DATABASE_URL" --include-all --skip-vault --yes
```

`--include-all` 必须带:Sellbase 的迁移是「已发布」的,不在本仓库的
`supabase_migrations` 历史里,不带这个 flag CLI 会认为历史对不上。
`--skip-vault` 是因为本仓库的 `supabase/config.toml` 里没有 vault 段,
让 CLI 去同步 vault 会白跑一趟(而且可能要求额外的凭据)。

**Edge Function 产物不入库**:`supabase/functions/` 在 `.gitignore` 里 ——
那三个文件是 Sellbase 编译好的产物,一共 12 MB,既不是本仓库写的代码也不该
占仓库体积。要部署的时候跑:

```bash
pnpm tsx scripts/fetch-sellbase-assets.ts   # 从 npm 的 sellbase 包取回来
```

版本**跟 `@sellbase/sdk` 对齐**(脚本默认从 `node_modules/@sellbase/sdk/package.json`
读版本号):SDK 是本仓库真正 import 的东西,边函数是它调的那一端,版本对不上
会出现「SDK 发的新字段边函数不认」。

**入库的是 `supabase/migrations/*.sql`** —— 迁移是数据库状态的唯一真相,必须
跟着仓库走(这 10 个文件跟 npm 上发布的逐字节一致,校验过)。

**店铺和 token 不走 `npx sellbase init`** —— 用
`pnpm tsx scripts/bootstrap-sellbase-store.ts --write-env`:
它只做两件事(建 store / 建 token),不装包、不写路由、不碰 CLAUDE.md。
加 `--write-env` 直接把 token 落进 `.env.local`;不加就只在终端打印一次。

### 1.5 初始化记录(2026-11-05 全部就位)

数据库侧全部就位(迁移 / 店铺 / token / cron),**Management API 那三步也做完了**
—— 它们都要 **Supabase access token**(Personal Access Token),跟 service role
key 是两回事,数据库里拿不到。

| 步骤 | 命令 | 为什么必须 |
|---|---|---|
| 1. 登录 | `npx supabase login` | 浏览器授权一次,token 落在 `~/.supabase/access-token`,**不进聊天** |
| 2. 部署边函数 | `pnpm tsx scripts/fetch-sellbase-assets.ts` → `npx supabase functions deploy sellbase-api sellbase-webhooks sellbase-jobs --no-verify-jwt --use-api --yes` | 边函数是 Sellbase 的「收银台」本体,不部署就没有 API |
| 3. 接 cron | `npx supabase projects api-keys --remote=<ref> --reveal` → `pnpm tsx scripts/configure-sellbase-jobs.ts --write-env` | **webhook 投递全靠 jobs 函数**(见下) |

> **第 3 步为什么不是可有可无**:Sellbase 的所有 webhook 投递都发生在
> `sellbase-jobs` 里(`runJobs()` → `deliverWebhooks()`)。订单付款后 API 只往
> `sellbase.webhook_deliveries` 写一行「待投递」,真正把事件 POST 到本仓库
> `/api/webhooks/sellbase` 的是 jobs 函数,而 jobs 函数平时靠 pg_cron 每分钟
> 调一次。**不接 cron,cron 每次都直接 return —— 本仓库永远收不到付款
> webhook,商城订单会一直卡在「未付款」。**
>
> URL 和 key 存在 Supabase Vault(`sellbase_jobs_url` / `sellbase_jobs_key`),
> 由 `sellbase.configure_jobs(url, key)` 写入。key 就是这个项目的
> **service role key** —— jobs 函数比对的是它自己环境变量里的
> `SUPABASE_SERVICE_ROLE_KEY`,所以两个值必须**一模一样**。
>
> ⚠️ 新版 Supabase 的 service role key 是 **`sb_secret_…`**(不是老的 JWT
> `eyJ…`)。实测:老的 `eyJ…` 打 jobs 函数是 401,`sb_secret_…` 才是
> `SUPABASE_SERVICE_ROLE_KEY` 的值。`projects api-keys --reveal` 会两个都给,
> 拿 `type == "secret"` 的那个。

API 起来之后的两步也做完了:

```bash
pnpm tsx scripts/register-sellbase-webhook.ts --write-env   # 拿 SELLBASE_WEBHOOK_SECRET
pnpm tsx scripts/sync-sellbase-catalog.ts --apply            # 85 个 SKU 推进 Sellbase
```

**当前状态**(2026-11-05):

| 项 | 状态 |
|---|---|
| 三个边函数 | 已部署,ACTIVE,`verify_jwt: false` |
| admin token | `mooncoda_live_…`,已验证 `GET /v1/store` → 200 |
| webhook 端点 | 1 个,`https://aimake3d.com/api/webhooks/sellbase`,4 个事件 |
| 目录 | Sellbase 7 个商品 / 85 个变体;`product_variant.sellbase_variant_id` 回填 85 条、0 条空 |
| `sellbase doctor` | schema ok · RLS ok · catalog ok · **jobs ok**;payments **fail**(Stripe 没连,人工步骤);email warn(没连邮件商);store warn(没填 contact_email) |

**还差的两件事**(都不在本仓库里):

1. **Stripe** —— 人工激活账号 + 付验证费,live key 粘进 Admin → Settings →
   Payments。没连之前 `POST /orders` 建不出支付链接。
2. **本仓库部署** —— `aimake3d.com` 上跑的还是旧构建(实测 webhook 端点
   返回 404)。新代码部署上去、并且部署环境里配好 `SELLBASE_API_TOKEN` /
   `SELLBASE_WEBHOOK_SECRET`,webhook 链才真正闭环。

### 1.6 token 前缀为什么是 `mooncoda_live_`(不是 `sb_live_`)

Sellbase 默认的 admin token 是 `sb_live_…`,但 **`sb_` 是 Supabase 自己的
API key 命名空间**(`sb_publishable_…` / `sb_secret_…`)。Supabase 的 Edge 网关
在**进函数之前**就会解析 `Authorization: Bearer <值>`:

- 值长得像 JWT(`xxx.yyy.zzz`)→ 当 JWT 验签
- 值以 **`sb_` 开头** → 当 **Supabase API key** 查表,查不到直接 401

于是 `sb_live_…` 的 token 根本进不了函数:

```
GET /functions/v1/sellbase-api/v1/store
Authorization: Bearer sb_live_xxxx
→ 401 {"message":"Invalid API key","hint":"Double check your API key."}
```

这个 401 **不是** Sellbase 的错误(Sellbase 的是 `{error:{code,message,hint,details}}`),
是网关的 —— 所以它连 `resolveActor()` 都进不去。

解法是把 Sellbase bundle 里的 `BRAND.tokenPrefix`(一个字面量,三处用途都读它)
打成 `mooncoda_live_`,**不以 `sb_` 开头**,网关就当普通 Bearer 透传。补丁由
`scripts/fetch-sellbase-assets.ts` 在取回 bundle 时打上,**每次取回都重打一遍**,
所以升级 Sellbase 版本不会漏。

前缀的唯一定义处是 `scripts/lib/sellbase-token.ts`;铸 token 的脚本和打补丁的
脚本都从那儿读。**换前缀之后旧的 `sb_live_` token 一律作废**(网关根本不让它
过去)—— `bootstrap-sellbase-store.ts` 会自动把前缀对不上的旧 token 标成
`revoked_at`。

### 1.7 `@sellbase/sdk` 是纯 ESM —— 打了两个 pnpm patch

`@sellbase/sdk` 和 `@sellbase/core` 的 `package.json` 只有 `import` 条件、
没有 `require` 条件。本仓库 `package.json` **没有** `"type": "module"`,所以
`pnpm tsx scripts/*.ts` 走的是 CJS 解析器 —— `require("@sellbase/sdk")` 直接
报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

Next.js 那边没事(打包器走 `import` 条件),**只有 scripts 会炸**。

解法是 `pnpm patch` 给两个包各加一条 `require` 条件:

| 补丁 | 改了什么 |
|---|---|
| `patches/@sellbase__sdk@0.3.3.patch` | `exports["."].require = "./dist/index.js"` |
| `patches/@sellbase__core@0.3.3.patch` | 同上 |

Node 22+ 的 `require(esm)` 能直接吃这个 ESM 文件,所以指向同一个 `dist/index.js`
就行,不用另造 CJS 构建。补丁在 `pnpm-workspace.yaml` 的 `patchedDependencies`
里登记,`pnpm install` 自动生效。

### 1.8 scripts 里的 dotenv 必须先加载

`src/db/index.ts` 在**模块顶层**就检查 `process.env.DATABASE_URL`,拿不到就抛错。
而静态 import 会在模块体执行**之前**求值 —— 所以脚本顶上的
`dotenvConfig({ path: ".env.local" })` 跑得太晚,`import { db } from "@/db"`
先炸。

解法:`scripts/lib/load-env.ts` 只做 dotenv 这件事,**必须排在 import 列表的
第一个**(`import "./lib/load-env";`)。求值顺序按 import 声明的先后,深度优先。
顺序反了照样炸 —— 别把这个 import 往中间挪。

---

## 二、数据归属边界(单一权威原则)

| 数据 | 单一权威 | 说明 |
|---|---|---|
| **商品资料 / SKU / 基础价** | **本仓库** | `product` + `product_variant` 表,`/admin/products` 管理 |
| **定价规则**(材质 / 尺寸 / AI 风格 / 配件 / 刻字 / 加急 / 数量阶梯折扣) | **本仓库** | `src/features/storefront/lib/pricing.ts` |
| **购物车** | **本仓库** | `cart` / `cart_item` 表,cookie `wjp_cart_id` |
| **订单事实** | **本仓库** | `storefront_order` / `storefront_order_item`(商城)+ `print_order`(打印工单) |
| **收货地址** | **本仓库** | `address` 表 —— Sellbase **没有创建地址的路由**,`customer.addresses` 只读 |
| **收款状态** | **Sellbase** | 本仓库只镜像 `payment_status` 字段 + `sellbase_order_id` 指针 |
| **Stripe 支付链接** | **Sellbase** | 本仓库存 `payment_url` 副本 |
| **用户身份** | **本仓库** | Better Auth;Sellbase 侧按 **email** upsert customer |
| **积分账本** | **本仓库** | 跟成品价完全脱钩 —— 积分是渲染 SaaS 定价,成品是实物定价 |

### 2.1 目录同步是**单向**的

`scripts/sync-sellbase-catalog.ts` 把本仓库的 `product` / `product_variant`
推到 Sellbase,并回写 `product_variant.sellbase_variant_id`。**Sellbase 那边
手工改了价,不会回流本仓库** —— 本仓库的定价才是收多少钱的依据。

同步脚本会**断言** Sellbase store 的 `default_currency === "cny"` 且税率为 0:
Sellbase 的税会加到 `total_amount` 上,税不为 0 就跟本仓库报价对不上。

### 2.2 账号映射靠 email

Sellbase 的 `customer` 按 **email upsert**,`auth_user_id` 字段**没有任何
API 能写**。所以:

- `user.sellbaseCustomerId` 只是一个**加速指针**(建单时从响应里回填),真正的
  join key 永远是 email
- `user.email` 是账号邮箱,下单时**服务端取,绝不采信客户端传来的**

---

## 三、两条支付链

两条链共用**同一套** Sellbase 收银台和**同一个** webhook 端点:

```
商城结算                                    打印工单
──────────────────────────────────────     ──────────────────────────────────────
购物车(DB)                                  报价(服务端重算)
  ↓                                           ↓
服务端重算每一行价                            落 print_order(payment_status=unpaid)
  ↓                                           ↓
落 storefront_order + _item                   建 Sellbase 订单(unit_price_amount=总价)
  ↓                                           ↓
建 Sellbase 订单                              回写 sellbase_order_id + payment_url
(unit_price_amount = 折后单价)                 ↓
  ↓                                           ↓
回写 sellbase_order_id + payment_url         前端跳 Stripe
  ↓                                           ↓
前端跳 Stripe                     ┌──────────────────────────┐
  ↓                              │  /api/webhooks/sellbase   │
  └──────────────────────────────┤  验签 → 按 sellbase_order_id
                                 │  反查 → 改本地订单状态     │
                                 └──────────────────────────┘
```

webhook 反查时**先查工单表,再查商城表** —— 两张表的 `sellbase_order_id`
都有唯一索引,不会命中两张。

---

## 四、金额口径(**逐分相等**)

这是整个集成里最容易出错、也最该守住的一条。

### 4.1 恒等式

```
Sellbase 行合计 = items[].unit_price_amount × quantity
本仓库行合计   = discountedUnitPriceCents  × quantity
```

`unit_price_amount` 直接填 `discountedUnitPriceCents`,两边**逐分相等**。

### 4.2 阶梯折扣必须「先折单价,再乘数量」

```
discountedUnitPriceCents = round(unitPriceCents × (1 - tierRate))
totalPriceCents          = discountedUnitPriceCents × quantity
quantityTierDiscountCents = unitPriceCents × quantity - totalPriceCents
```

反过来(先乘数量再折总价)两边最多差 ⌊qty/2⌋ 分 —— 「页面显示的价」和
「实际收的价」不是同一个数,而用户投诉的是后者。

这个纯函数在 `pricing.ts` 的 `computeQuantityDiscount()`,单测见
`src/test/storefront/pure/pricing-tier.test.ts`。

### 4.3 单位换算

本仓库用**人民币分**,Sellbase 用**店铺币种的最小单位**。CNY 时两者 1:1
(所以换算函数在 CNY 下是恒等);换币种时走 `src/features/sellbase/lib/money.ts`:

```
分 → 目标最小单位:  round(cents × rate)
目标最小单位 → 分:  round(amount ÷ rate)
```

**币种是 CNY 而汇率不是 1 → 直接报错** —— 配置自相矛盾时收的钱一定是错的。

---

## 五、载体变体:给 Sellbase 一个「合法的空壳」

每一行 Sellbase 订单都要指向一个 `variant_id`。本仓库不需要为每个定价组合
造变体 —— 用**载体变体**就行:

- **商城行** → `product_variant` 里 `(productCode, sizeCode)` 匹配到的 active 行
  (`size_R_6` → sizeCode `6`);匹配不到就退到该 productCode 的任意一个已同步
  变体;再匹配不到就报 `CarrierNotFoundError`(提示先跑同步脚本)
- **打印工单行** → 专用载体 `SERVICE` / `SB-PRINT-SERVICE`(不是真实商品)

载体变体只负责给 Sellbase 一个合法的 `variant_id` 和一个工作室看得懂的标题。
**真正的价格永远是 `unit_price_amount`。**

实现:`src/features/sellbase/lib/carrier.ts`。

---

## 六、Webhook

端点:`POST /api/webhooks/sellbase`

### 6.1 验签

```
Sellbase-Signature: t=<unix 秒>,v1=<hex HMAC-SHA256("<t>.<raw body>")>
```

- 签的是**原始 body 字节** —— 不能 `req.json()` 之后重新序列化(字节对不上)
- 一个 header 里可以有多个 `v1=`,**任一匹配即通过**(密钥轮换期会这样)
- 时间戳容差 **300 秒**,超了拒(防重放)
- 实现见 `src/features/sellbase/lib/signature.ts`,是纯函数,不碰 env

### 6.2 事件 → 本地动作

| 事件 | 商城订单 | 打印工单 |
|---|---|---|
| `order.paid` / `payment.succeeded` | `status = paid` + `payment_status = paid` + `paid_at` | `payment_status = paid` + `paid_at` |
| `order.cancelled` | `status = cancelled` | 走状态机 → `CANCELLED` |
| `refund.created` | `payment_status = refunded`(**不动 `status`**) | `payment_status = refunded` |

**认不出来的事件一律回 200 忽略** —— 回 4xx 会让 Sellbase 一直重投,把这个
端点打成噪音源,还会把真正重要的支付事件挤掉。

### 6.2.1 退款**不改** `status`

商城订单的两个状态是**正交**的两件事:

| 列 | 含义 | 取值 |
|---|---|---|
| `status` | 订单走到哪一步 | `unpaid` / `paid` / `fulfilled` / `cancelled` |
| `payment_status` | 钱到没到、退没退 | `unpaid` / `paid` / `refunded` / `failed` |

所以合法的组合有 `status=paid` + `payment_status=refunded`(退过款的单)、
`status=cancelled` + `payment_status=paid`(先付后取消)。

**退款只写 `payment_status`** —— 早先只有一列 `status` 的时候,退款把订单
写成了「已取消」,用户看到的是「已取消」而不是「已退款」,工作室也没法把
退款单跟取消单区分开。两列分开之后,`print_order` 和 `storefront_order`
用的是**同一个口径**,webhook 一套逻辑写两处。

**迟到的 `order.paid` 不能把退过款的单翻回「已支付」** —— webhook 重投是
常态(Stripe 的事件不保证只投一次),所以「标记已收款」这一步先看
`payment_status`:**已经是 `refunded` 就直接忽略**。这跟
「订单已取消就忽略收款事件」是同一道防线。

### 6.3 幂等

不另建去重表:「**已经是目标状态 → 直接 no-op**」就够了。重投一次和重投
十次,结果一样。

---

## 七、「先收钱,后开工」的状态门槛

打印工单是「来料加工」—— 用户付了钱,工作室才开始切料/打印。没收款就开工,
后面追款的难度会陡增。

门槛卡在**状态流转**这一层(`transitionPrintOrderStatus()`),而不是靠后台
界面把「生产中」这个选项藏起来:藏选项是 UI 便利,服务端这层才是授权边界。

```ts
if (input.to === "IN_PRODUCTION" && current.paymentStatus !== "paid") {
  throw new PrintOrderTransitionError("PAYMENT_REQUIRED", ...);
}
```

卡的是**目标状态**:落进 `IN_PRODUCTION` 就得先收到钱(往回退到生产中意味着
要重新切料重打,那也是开工)。退回去对齐(`PENDING` / `CONFIRMED`)或者推到
发货都不拦。

**线下收款是通的**:工作室线下转账后,后台「标记已收款」→ 本地
`payment_status = "paid"` + `payment_channel = "offline"` + `paid_at = now`。
**不建 Sellbase 订单** —— 线下单在 Sellbase 里没有对应实体,写进去会让两边
的订单数对不上。

---

## 八、Sellbase 挂了怎么办

**Sellbase 调失败不丢单。**

结算的顺序是:**先落本地订单,再建 Sellbase 订单**。顺序不能反:本地订单是
「订单事实」,Sellbase 订单是「收款载体」。Sellbase 那边挂了(网络 / 配置 /
Stripe 没连上),订单已经在了,状态停在 `unpaid`,用户还能在「我的订单」里
重取支付链接。

反过来就变成「收了钱但没有订单」。

重取支付链接有两条路:
- 有 `sellbase_order_id` → `POST /orders/:id/payment-link` 换一张新链接
- 什么都没有(建单就失败了) → 用**存下来的**订单行重建一张 Sellbase 订单

重建时**不重新定价**:`storefront_order_item` 里存着下单那一刻的折后单价,
直接拿来当 `unit_price_amount`。用户下单时看到并同意的是那个价,后来改了
定价规则也不该让他的订单变贵(或者变便宜)。

### 8.1 「孤儿单」:订单建了但链接没生成

Sellbase 的 `POST /orders` **先**把订单写进库(事务提交),**然后**才去 Stripe
建支付链接。Stripe 没连上时接口报错,但订单已经建好了 —— 而且失败时服务端会
**删掉幂等键**,所以直接重试会再建一单,在 Sellbase 后台留一张孤儿单。

所以失败路径要**找回**那张单:`findSellbaseOrderByNote()` 先按邮箱列出该用户
`pending_payment` 状态的订单,再逐个取详情看备注里有没有本仓库的订单号 ——
备注里带订单号,那是两边唯一的关联标记(失败时 `sellbase_order_id` 那列还没写)。
找到就把 `sellbase_order_id` 补写上,再补一个支付链接。

支付链接会过期(Stripe 那边 23 小时),所以「重新获取支付链接」这个入口是常备的,
不是异常兜底。

---

## 九、API 清单

### 9.1 本仓库新增 / 改造

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST | `/api/store/checkout` | 登录 + 限流 | 结算:重算 → 落本地订单 → 建 Sellbase 订单 → 返 `{orderNo, paymentUrl}` |
| GET | `/api/store/orders/[orderNo]` | 登录 | 订单状态(支付成功页轮询用);返 `status` + `paymentStatus` |
| POST | `/api/store/orders/[orderNo]/payment-link` | 登录 + 限流 | 重取支付链接 |
| GET/POST | `/api/store/addresses` | 登录 + 限流 | 收货地址簿(小程序侧) |
| PATCH/DELETE | `/api/store/addresses/[addressId]` | 登录 + 限流 | 改 / 删一条地址 |
| POST | `/api/print-orders` | 登录 | 打印工单提交(已改造:建完 Sellbase 订单返 `paymentUrl`) |
| POST | `/api/print-orders/[orderNo]/payment-link` | 登录 | 重取支付链接 |
| POST | `/api/webhooks/sellbase` | **HMAC 签名** | Sellbase 收款事件入口 |
| GET/POST/PATCH/DELETE | `/api/store/carts/**` | cookie | 购物车(已落库) |
| GET | `/api/store/products` | 公开 | 商品目录(**本仓库是真理源**) |

**「登录」这一列有两种凭据**:`Authorization: Bearer <token>`(微信小程序)
或者 Better Auth 的签名 cookie(浏览器)。统一走
`src/lib/auth/request-session.ts` 的 `getSessionFromRequest`:

- 带 Bearer → 用 Bearer 查会话
- 没带 → 退回 cookie
- **带了 Bearer 但无效 → 直接 401,不退回 cookie** —— 悄悄换个身份继续跑,
  等于把「token 过期」变成「换个身份照样能过」,授权边界就宽了

这个 helper 单独一个文件,是因为 `src/lib/auth/bearer.ts` 被 Edge 中间件
(`src/proxy.ts`)引用 —— `better-auth` 绝不能进那个 bundle。

**限流档位**:`storeCheckout` 10 次/分钟(结算 + 重取支付链接),
`storeAddress` 30 次/分钟(地址簿 —— 读写便宜,但里面是 PII)。

### 9.2 本仓库 → Sellbase(服务端)

| 用途 | 端点 | 何时 |
|---|---|---|
| 建订单(收银台) | `POST /orders`(`payment.mode = "link"`) | 结算 / 工单提交 |
| 换支付链接 | `POST /orders/:id/payment-link` | 用户重取链接 |
| 同步商品 | `POST /products` / `POST /variants` | 跑 `scripts/sync-sellbase-catalog.ts` |
| 注册 webhook | `POST /webhooks` | 跑 `scripts/register-sellbase-webhook.ts` |

`POST /orders` 的 body 关键字段:

```jsonc
{
  "email": "user@example.com",
  "items": [{ "variant_id": "<载体变体 id>", "quantity": 1, "unit_price_amount": 2400 }],
  "shipping_amount": 800,
  "shipping_address": { "...": "地址快照" },
  "note": "SO-20261104-3F7K2A · 宠物钥匙扣 ×1",
  "payment": { "mode": "link", "success_url": "https://…/checkout/success?order=SO-…" },
  "notify_customer": true
}
```

`payment.mode = "paid"` 需要 `confirm: true`;`"link"` 不需要,订单进
`pending_payment`,返回 Stripe 支付链接。

---

## 十、环境变量

> `.env.example` 被 gitignore 挡掉了,所以说明写在
> `src/features/sellbase/lib/env.ts` 的文件头里。

| 变量 | 必填 | 说明 |
|---|---|---|
| `SELLBASE_URL` | 是* | API base,形如 `https://<ref>.supabase.co/functions/v1/sellbase-api/v1` —— `<ref>` 跟 `DATABASE_URL` 是**同一个** Supabase 项目(见 §1.1) |
| `SELLBASE_API_TOKEN` | 是 | admin token(`mooncoda_live_…`),需要 `orders:write` / `catalog:write` / `webhooks:write` |
| `SELLBASE_WEBHOOK_SECRET` | 收 webhook 时必填 | `POST /webhooks` **只返回一次**,丢了只能重建端点 |
| `SELLBASE_ANON_KEY` | 否 | Supabase anon key(只读公开接口用) |
| `SELLBASE_CURRENCY` | 否 | 收款币种,默认 `cny` |
| `SELLBASE_FX_RATE` | 否 | 「1 CNY = 多少目标币种」,默认 1 |

\* API base 有三个来源,优先级从高到低:`SELLBASE_URL` →
`NEXT_PUBLIC_SELLBASE_URL` → `NEXT_PUBLIC_SUPABASE_URL`(自动拼后缀)。
共用 Supabase 项目时,光配 `NEXT_PUBLIC_SUPABASE_URL` 就够(见 §1.2)。

### 10.1 密钥纪律

- **admin token 和 webhook secret 只进环境变量**,绝不进仓库文件、绝不进聊天
- Stripe 的两个「必须人工做」的动作:**激活 Stripe 账号**、**支付验证费** ——
  做完把 live key 粘进 **Admin → Settings → Payments**,Sellbase 会把它加密
  存进 Supabase Vault
- 动钱或者破坏性的操作一律要 `confirm: true`,而且会被审计日志记一笔

---

## 十一、脚本

| 脚本 | 干什么 |
|---|---|
| `pnpm tsx scripts/apply-sellbase-payment-schema.ts` | `print_order` 加五列 + `storefront_order`(含 `payment_status`)/ `storefront_order_item` + `user.sellbaseCustomerId` 改名 |
| `pnpm tsx scripts/apply-storefront-cart-schema.ts` | `cart` / `cart_item` |
| `pnpm tsx scripts/apply-user-address-schema.ts` | `address` |
| `pnpm tsx scripts/apply-product-catalog-schema.ts` | `product` / `product_variant`(**必须排在 `apply-sellbase-payment-schema.ts` 前面** —— 后者要先 ALTER `product_variant`) |
| `pnpm tsx scripts/bootstrap-sellbase-store.ts` | 建 Sellbase 店铺 + `mooncoda_live_` admin token(`--write-env` 直接落盘;旧前缀的 token 会被自动作废) |
| `pnpm tsx scripts/fetch-sellbase-assets.ts` | 从 npm 的 `sellbase` 包取回三个 Edge Function(不入库,部署前跑) |
| `pnpm tsx scripts/configure-sellbase-jobs.ts` | 把 jobs 函数接进 pg_cron(vault 里写 url + service role key)—— **不做这步就收不到 webhook** |
| `pnpm tsx scripts/sync-sellbase-catalog.ts` | 目录同步(默认 `--dry-run`;`--apply` 才真写) |
| `pnpm tsx scripts/register-sellbase-webhook.ts` | 注册 webhook 端点(secret 只打印一次) |

写环境变量统一走 `scripts/lib/env-file.ts` 的 `upsertEnvVar(path, key, value, {secret})`
—— **替换**同名变量而不是追加(追加会出现两个同名变量,dotenv 取哪个取决于顺序,
很容易踩「密钥明明配了却读不到」)。`register-sellbase-webhook.ts` 原来自己抄了
一份,已经改成用这个 helper。

迁移脚本都是**手写幂等**的 —— 跟仓库现有的 `scripts/apply-*.ts` 一个路子。

---

## 十二、测试

纯函数测试都归 `unit` project,零 DB 依赖:

```bash
pnpm test:run --project=unit
```

| 文件 | 覆盖 |
|---|---|
| `src/test/sellbase/pure/signature.test.ts` | 验签:签名对 / 错 / 时间戳过期 / 多签名任一匹配 / 畸形头 |
| `src/test/sellbase/pure/money.test.ts` | 分 ↔ 最小货币单位;CNY 恒等;换币种换算 |
| `src/test/sellbase/pure/carrier.test.ts` | 载体解析:`size_R_6` → `6`;精确匹配 / 退让 / 找不到的报错文案 |
| `src/test/storefront/pure/cart-spec.test.ts` | `computeSpecHash` / `isSameSpec`:配件顺序无关、hash 稳定、字段边界不含糊 |
| `src/test/storefront/pure/pricing-tier.test.ts` | 阶梯口径 + **两边一致性**(`discountedUnitPriceCents × quantity` == `totalPriceCents`) |
| `src/test/print-quote/pure/payment-gate.test.ts` | 没付款不许进生产的状态门槛 |
| `src/test/sellbase/pure/storefront-transition.test.ts` | 商城订单的 webhook 状态转移:退款只改支付状态、迟到的 `paid` 不改退款单、幂等 |
| `src/test/address/pure/address-schema.test.ts` | 地址入参校验(手机号 / 必填 / `district` 可选 / 20 条上限) |

---

## 十三、这一轮**不做**的事

- **真实 Stripe 收款**:只跑测试模式。CNY 不是 Stripe 普遍开放的结算币种,
  开通前得先在 Stripe 后台确认账号能选 `cny`;选不了就在 `SELLBASE_CURRENCY`
  上切 USD(定价常量不用动,换算层统一走 `lib/money.ts`)
- **弃单挽回 / 运费表 / 税**:Sellbase 自带,本轮没用(算价在本仓库)
- **退款 / 部分退款**:Sellbase 侧有 `POST /orders/:id/refunds`,本仓库只处理
  `refund.created` 回写状态,没有发起退款的 UI
- **Sellbase 原生购物车 / 结算**:明确不用(见 §〇 的三条硬约束)
- **多币种**:全链路 CNY
- **Creem 侧**:积分包那套还在跑,不动

---

## 十四、相关文件索引

**Sellbase 客户端层**:
- `src/features/sellbase/lib/env.ts` —— 环境变量 + 优雅降级
- `src/features/sellbase/lib/client.ts` —— admin client 单例
- `src/features/sellbase/lib/signature.ts` —— webhook 验签(纯函数)
- `src/features/sellbase/lib/money.ts` —— 分 ↔ 最小货币单位
- `src/features/sellbase/lib/carrier.ts` —— 载体变体解析
- `src/features/sellbase/lib/events.ts` —— webhook 事件 → 本地动作
- `src/features/sellbase/lib/storefront-transition.ts` —— 商城订单的 webhook 状态转移(纯函数)
- `src/features/sellbase/lib/orders.ts` —— 建订单 / 换支付链接
- `src/features/sellbase/lib/customer.ts` —— customer id 回填
- `src/features/sellbase/lib/webhook-handler.ts` —— webhook 落库

**商城**:
- `src/features/storefront/lib/cart-store.ts` —— 购物车(DB)
- `src/features/storefront/lib/cart-spec.ts` —— 同规格判定(纯函数)
- `src/features/storefront/lib/pricing.ts` —— 定价(阶梯折扣口径在这)
- `src/features/storefront/lib/checkout.ts` —— 结算核心
- `src/features/storefront/lib/order-payment.ts` —— 支付链接

**地址**:
- `src/features/address/mutations.ts` —— 地址簿业务逻辑(Web 和小程序共用)
- `src/features/address/actions.ts` —— 地址簿 server actions(Web)
- `src/app/api/store/addresses/` —— 地址簿 HTTP 路由(小程序)

**鉴权**:
- `src/lib/auth/request-session.ts` —— `getSessionFromRequest`(Bearer 或 cookie)

**工单**:
- `src/features/print-quote/lib/order-store.ts` —— 状态流转 + 付款门槛

---

## 文档历史

| 日期 | 变更 |
|---|---|
| 2026-09-17 | 初版(Medusa 方案,见 `architecture-medusa-integration.md`) |
| 2026-10-21 | 商品目录收回本仓库(Medusa 方案内) |
| 2026-11-04 | **改用 Sellbase**;「本仓库算价,Sellbase 只做收银台」落地;本文档取代 Medusa 文档 |
| 2026-11-04 | 商城订单补 `payment_status`(退款不再写成「已取消」);商城路由接 Bearer;地址簿补 HTTP 路由 |
| 2026-11-04 | 补 §1.1~1.3:**Sellbase 与本仓库共用同一个 Supabase 项目**(schema 隔离 / 一套环境变量 / 别在本仓库跑 `npx sellbase init`) |
| 2026-11-04 | 补 §1.4:Sellbase 的 10 个迁移**已推到共享库**,店铺 + admin token 已建(46 张 `sellbase` 表 / cron / 扩展全部就位) |
