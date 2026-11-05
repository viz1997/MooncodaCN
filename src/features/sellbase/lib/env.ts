/**
 * Sellbase 环境变量与配置
 *
 * Sellbase 是一套「Supabase Edge Functions + Stripe」的无服务器电商后端
 * (MIT),装在**你自己的**(也就是本仓库那个)Supabase 项目里 —— 没有单独的
 * 服务器要部署,这是选它而不是 Medusa 的主要原因。
 *
 * 本仓库是它的客户端:
 * - **商品目录**从本仓库同步过去(本仓库是真理源,见 `scripts/sync-sellbase-catalog.ts`)
 * - **算价**在本仓库(刻字 / 加急 / 配件 / 数量阶梯折扣)
 * - **订单与收款**走 Sellbase 的 `POST /orders` + Stripe 支付链接
 *
 * ## 共用同一个 Supabase 项目(2026-11-04)
 *
 * 本仓库的 `DATABASE_URL` 和 Sellbase 的 API base 指向**同一个** Supabase
 * 项目 —— 同一个 `postgres` 库,但不撞表:本仓库的表在 `public`,Sellbase 的
 * 表全在 `sellbase` schema(Sellbase 自己的迁移建的)。
 *
 * 所以 `NEXT_PUBLIC_SUPABASE_URL` 一个值就够:`readSellbaseUrl()` 会拿它
 * 自动拼 `/functions/v1/sellbase-api/v1`(第三优先级)。仍然必须单独配的是
 * `SELLBASE_API_TOKEN`(admin token)和 `SELLBASE_WEBHOOK_SECRET`。
 *
 * ## 需要的环境变量
 *
 * `.env.example` 被 gitignore 挡掉了(见 [[env-example-is-gitignored]]),
 * 所以变量说明写在这里 —— 改这份文档比改一个没人看的 .env.example 更容易被看到。
 *
 * | 变量 | 必填 | 说明 |
 * |---|---|---|
 * | `SELLBASE_URL` | 是* | API base,形如 `https://<ref>.supabase.co/functions/v1/sellbase-api/v1` —— `<ref>` 跟 `DATABASE_URL` 是**同一个** Supabase 项目 |
 * | `SELLBASE_API_TOKEN` | 是 | admin token(`mooncoda_live_…`),需要 `orders:write` / `catalog:write` / `webhooks:write` scope |
 * | `SELLBASE_WEBHOOK_SECRET` | 收 webhook 时必填 | webhook 端点的签名密钥 —— `POST /webhooks` **只返回一次**,丢了只能重建端点 |
 * | `SELLBASE_ANON_KEY` | 否 | Supabase anon key,只读公开接口用(本仓库暂时用不到) |
 * | `SELLBASE_CURRENCY` | 否 | 收款币种,默认 `cny`(跟现有商城的「分」口径一致) |
 * | `SELLBASE_FX_RATE` | 否 | 换币种时「1 CNY = 多少目标币种」,默认 1(= 不换算) |
 *
 * `*` API base 有三个来源,优先级从高到低:
 *
 * 1. `SELLBASE_URL` —— 服务端专用,不进客户端 bundle
 * 2. `NEXT_PUBLIC_SELLBASE_URL` —— `npx sellbase init` 写进 `.env.local` 的就是它
 * 3. `NEXT_PUBLIC_SUPABASE_URL` —— 只有 Supabase 项目地址,自动拼
 *    `/functions/v1/sellbase-api/v1` 后缀
 *
 * 2 和 3 是**公开**变量(客户端也能读),但本仓库的商城不走 Sellbase 原生
 * 购物车,所以只有服务端真正用得上;留着是为了跟 `npx sellbase init` 的产物
 * 对得上 —— 不用改 init 写出来的 `.env.local`。
 *
 * ## token 前缀为什么不是 `sb_live_`(2026-11-05)
 *
 * Sellbase 默认的 admin token 是 `sb_live_…`,但 **`sb_` 是 Supabase 自己的
 * API key 命名空间**(`sb_publishable_…` / `sb_secret_…`)。Supabase 的 Edge
 * 网关在**进函数之前**就会解析 `Authorization: Bearer <值>`:
 *
 * - 值长得像 JWT → 当 JWT 验签
 * - 值以 **`sb_` 开头** → 当 Supabase API key 查表,查不到直接 401
 *
 * 所以 `sb_live_…` 的 token 根本进不了函数,连 Sellbase 自己的错误形状都
 * 看不到(网关的 401 是 `{"message":"Invalid API key"}`,Sellbase 的是
 * `{error:{code,message,hint,details}}`)。
 *
 * 解法是把 Sellbase bundle 里的 `BRAND.tokenPrefix` 打成 `mooncoda_live_` ——
 * 不以 `sb_` 开头,网关当普通 Bearer 透传,函数里自己的前缀检查照常命中。
 * 补丁由 `scripts/fetch-sellbase-assets.ts` 在取回 bundle 时打上,细节和
 * 踩坑记录见 `scripts/lib/sellbase-token.ts`。
 *
 * 换句话说:**`SELLBASE_API_TOKEN` 必须是 `mooncoda_live_` 开头**,不是
 * `sb_live_`。用 `scripts/bootstrap-sellbase-store.ts` 铸出来的才是对的。
 *
 * ## 缺配置时的行为
 *
 * 跟 R2 一样是**优雅降级**:没配就把「在线支付」这条路整个关掉(接口返回 503),
 * 而不是让下单接口崩掉 —— 线下收款那条路还能走。
 */

/** 收款币种(小写 iso) */
export type SellbaseCurrency = "cny" | "usd" | (string & {});

/** 收款币种 —— 商城展示用 CNY,跟现有定价常量一致 */
export const SELLBASE_CURRENCY: SellbaseCurrency = (
  process.env.SELLBASE_CURRENCY ?? "cny"
).toLowerCase();

/** 1 CNY = 多少目标币种。cny 时恒等于 1 */
export const SELLBASE_FX_RATE = Number(process.env.SELLBASE_FX_RATE ?? "1");

/** Sellbase API 的固定后缀 —— 从裸 Supabase 地址拼基址时用 */
const SELLBASE_API_SUFFIX = "/functions/v1/sellbase-api/v1";

/**
 * 没配 Sellbase 时的专用错误
 *
 * 单独一个类型,是为了让 Route Handler 能把它翻译成 503 + 一个可识别的
 * error code(跟 `/api/print-orders` 现有的 `R2_NOT_CONFIGURED` 一个路子),
 * 而不是 500。
 */
export class SellbaseNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellbaseNotConfiguredError";
  }
}

/**
 * 读 API 基址
 *
 * 三个来源见文件头的说明。返回的地址**不带**尾部斜杠 —— 拼路径时
 * `//v1` 会 404。
 */
export function readSellbaseUrl(): string {
  const direct = process.env.SELLBASE_URL?.trim();
  if (direct) return stripTrailingSlash(direct);

  const publicUrl = process.env.NEXT_PUBLIC_SELLBASE_URL?.trim();
  if (publicUrl) return stripTrailingSlash(publicUrl);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    return stripTrailingSlash(supabaseUrl) + SELLBASE_API_SUFFIX;
  }

  throw new SellbaseNotConfiguredError(
    "Sellbase 未配置：请设置 SELLBASE_URL(或 NEXT_PUBLIC_SELLBASE_URL / NEXT_PUBLIC_SUPABASE_URL)"
  );
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** admin token —— 只在服务端读,绝不进客户端 bundle */
function readApiToken(): string {
  const raw = process.env.SELLBASE_API_TOKEN?.trim();
  if (!raw) {
    throw new SellbaseNotConfiguredError(
      "Sellbase 未配置：请在环境变量中设置 SELLBASE_API_TOKEN"
    );
  }
  return raw;
}

/** 是否配齐了「能下单收款」所需的最小配置 */
export function isSellbaseConfigured(): boolean {
  try {
    readSellbaseUrl();
    readApiToken();
    return true;
  } catch {
    return false;
  }
}

/** 完整配置 —— 缺什么就抛什么 */
export interface SellbaseConfig {
  url: string;
  apiToken: string;
  anonKey: string | null;
  currency: SellbaseCurrency;
  fxRate: number;
}

export function getSellbaseConfig(): SellbaseConfig {
  return {
    url: readSellbaseUrl(),
    apiToken: readApiToken(),
    anonKey: process.env.SELLBASE_ANON_KEY?.trim() || null,
    currency: SELLBASE_CURRENCY,
    fxRate: SELLBASE_FX_RATE,
  };
}

/**
 * webhook 签名密钥
 *
 * 只在 `/api/webhooks/sellbase` 里用 —— 收不到 webhook 的部署(比如还没
 * 配域名)不该被这个拦住,所以单独一个函数,不在 `getSellbaseConfig()` 里。
 */
export function getSellbaseWebhookSecret(): string {
  const raw = process.env.SELLBASE_WEBHOOK_SECRET?.trim();
  if (!raw) {
    throw new SellbaseNotConfiguredError(
      "Sellbase 未配置：请在环境变量中设置 SELLBASE_WEBHOOK_SECRET（POST /webhooks 只返回一次，丢了要重建端点）"
    );
  }
  return raw;
}

/**
 * 站点自己的地址 —— 用作 Stripe 支付完成后回跳的 success_url
 *
 * 跟 `BETTER_AUTH_URL` 是同一个东西(同一个站),但名字不同:一个是「鉴权
 * 系统的可信来源」,一个是「Sellbase 收款回跳地址」。两个都配的话以
 * `BETTER_AUTH_URL` 为准 —— 它是仓库里更早就存在、也更常被引用的那个。
 */
export function getSiteUrl(): string {
  const raw =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    throw new SellbaseNotConfiguredError(
      "缺少站点地址：请在环境变量中设置 BETTER_AUTH_URL"
    );
  }
  return stripTrailingSlash(raw);
}
