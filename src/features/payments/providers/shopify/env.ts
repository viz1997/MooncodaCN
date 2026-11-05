/**
 * Shopify 环境变量与配置
 *
 * ## Shopify 在这套架构里干什么
 *
 * 只干一件事:**当银行卡的收银台**。
 *
 * - **微信支付 / 支付宝** —— 我们自己直连(钱直接进我们自己的商户号,没有
 *   聚合层抽成,定价也完全由我们说了算)。
 * - **Shopify** —— 只承接**银行卡 / Shop Pay**。用户点「Shopify 支付」之后
 *   跳到 Shopify 的收银台页,在那边刷卡。
 *
 * 为什么不反过来(Sellbase 当收银台、Sellbase 变 Shopify)?Shopify 的收银台
 * **认不了我们算出来的价** —— 详见下面「为什么用**草稿订单**」那一节。
 *
 * ## 2026-01-01 起:Shopify **不再给永久 token**
 *
 * 早先在店铺后台「Develop apps」里能直接复制一个永久 token(`shpat_…`),
 * 配一个 `SHOPIFY_ADMIN_ACCESS_TOKEN` 就完事。**2026-01-01 起这条路没了** ——
 * 新 app 一律在 **Dev Dashboard** 里建,给的是 **Client ID + Client Secret**,
 * 没有可以复制的 token 了。
 *
 * 新的拿 token 的办法是 **client credentials grant**(OAuth 2.0 RFC 6749 §4.4):
 *
 * ```
 * POST https://{shop}.myshopify.com/admin/oauth/access_token
 * Content-Type: application/x-www-form-urlencoded
 *
 * grant_type=client_credentials&client_id=…&client_secret=…
 * ```
 *
 * 回来的是:
 *
 * ```json
 * { "access_token": "shpat_…", "token_type": "Bearer", "scope": "…", "expires_in": 86400 }
 * ```
 *
 * **token 只有 24 小时** —— 所以要缓存,到期前自己换(见下面的
 * `getShopifyAdminToken()`)。
 *
 * ## Client Secret 同时是 **webhook 的 HMAC 密钥**
 *
 * 验签那个头 `X-Shopify-Hmac-Sha256` 用的 key 就是 Client Secret
 * (`base64(HMAC-SHA256(原始 body, client secret))`)。所以新模型下**不用**
 * 再单独配一个 webhook 密钥。
 *
 * ## 需要的环境变量
 *
 * `.env.example` 被 gitignore 挡掉了(见 [[env-example-is-gitignored]]),
 * 所以变量说明写在这里。
 *
 * | 变量 | 必填 | 说明 |
 * |---|---|---|
 * | `SHOPIFY_STORE_DOMAIN` | 是 | 店铺域名,形如 `your-shop.myshopify.com`(带不带 `https://` 都行) |
 * | `SHOPIFY_CLIENT_ID` | 是* | Dev Dashboard 的 Client ID |
 * | `SHOPIFY_CLIENT_SECRET` | 是* | Dev Dashboard 的 Client Secret —— **也是 webhook 的 HMAC 密钥** |
 * | `SHOPIFY_ADMIN_ACCESS_TOKEN` | 否 | **旧路**:永久 token(`shpat_…`)。配了就优先用它,不再走 grant |
 * | `SHOPIFY_API_SECRET` | 否 | **旧路**:webhook 的 HMAC 密钥。不配就用 `SHOPIFY_CLIENT_SECRET` |
 * | `SHOPIFY_API_VERSION` | 否 | GraphQL API 版本,默认 `2026-07`(**每个版本只保一年**) |
 *
 * (*) 只要配了 `SHOPIFY_ADMIN_ACCESS_TOKEN`,那两个就不用配 —— 反过来只配
 * Client ID / Secret 也行(grant 那条路)。
 *
 * **没有汇率变量** —— 本仓库的价是美元,原样送过去,换算交给 Shopify。
 * 见 `currency.ts`(同目录)。
 *
 * **app 要装在店铺上** —— client credentials grant 只对「跟店铺同一个组织、
 * 由我们自己开发」的 app 生效。没装的话 Shopify 会回 `app_not_installed`。
 *
 * **scope 要够**:建草稿单要 `write_orders`,退款回调里回查订单要
 * `read_orders`。
 *
 * **密钥纪律**:token 和 secret **只进环境变量**,绝不进仓库文件、绝不进
 * 聊天记录。见 CLAUDE.md 的「密钥纪律」。
 *
 * ## 币种:不换算,让 Shopify 换
 *
 * 本仓库的价**一律是美元分**,原样送进草稿订单。Shopify 那边把美元的
 * 展示币种锁在草稿单创建那一刻,结算成店铺的结算币种是它的事。
 *
 * **前提**:店铺得能收美元 —— 结算币种是美元,或者 Markets 里启用了
 * 美元。两条都不满足时建单会**当场报错**并说清楚怎么改(不猜汇率)。
 * 口径见 `currency.ts`。
 *
 * ## 缺配置时的行为
 *
 * 跟 R2 / Sellbase 一样是**优雅降级**:`isShopifyConfigured()` 返回 false,
 * 「选择支付方式」里就显示成灰的、标「暂未开放」(选不了 —— 点了只会 503)。
 * 真的去调 Shopify 而配置不齐 → 抛 `PaymentNotConfiguredError`
 * —— 跟「这次调用挂了」分得开,见 `@/features/storefront/lib/payment-issue.ts`。
 */

import { PaymentProviderError } from "@/features/payments/lib/types";

import { ShopifyNotConfiguredError } from "./errors";

/** 错误类搬到了 `errors.ts`(跟 `currency.ts` 循环依赖会出问题)—— 这里转出去一份 */
export { ShopifyNotConfiguredError } from "./errors";

/**
 * GraphQL API 版本
 *
 * **Shopify 每个季度发一个版本,每个版本只保一年** —— 过了保质期 Shopify 会
 * 直接拒掉那个版本的请求(404 / "API version not supported")。
 *
 * 原先写的是 `2025-10`,那个版本 2026-10-01 就到期了(今天是 2026-11-05)——
 * **每一条 Shopify 调用都会挂**。现在用 `2026-07`(保质期到 2027-07)。
 *
 * 草稿订单的 `price` / `priceOverride` 在这些版本里形状没变,升级版本不用改
 * 代码。以后这个版本也过期了,改这里或者配 `SHOPIFY_API_VERSION`。
 */
export const DEFAULT_SHOPIFY_API_VERSION = "2026-07";

/** 去掉协议前缀和尾部斜杠 —— 两种写法都要能用 */
function normalizeDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/** 店铺域名 —— `xxx.myshopify.com` */
export function getShopifyStoreDomain(): string {
  const raw = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  if (!raw) {
    throw new ShopifyNotConfiguredError(
      "Shopify 未配置：请在环境变量中设置 SHOPIFY_STORE_DOMAIN"
    );
  }
  const domain = normalizeDomain(raw);
  if (!domain.includes(".")) {
    throw new ShopifyNotConfiguredError(
      `SHOPIFY_STORE_DOMAIN 不像域名：${raw}`
    );
  }
  return domain;
}

/** Dev Dashboard 的 Client ID */
export function getShopifyClientId(): string {
  const raw = process.env.SHOPIFY_CLIENT_ID?.trim();
  if (!raw) {
    throw new ShopifyNotConfiguredError(
      "Shopify 未配置：请在环境变量中设置 SHOPIFY_CLIENT_ID" +
        "（Dev Dashboard → 你的 app → Settings → Credentials）"
    );
  }
  return raw;
}

/**
 * Dev Dashboard 的 Client Secret
 *
 * **同时是 webhook 的 HMAC 密钥** —— 见文件头。
 */
export function getShopifyClientSecret(): string {
  const raw = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!raw) {
    throw new ShopifyNotConfiguredError(
      "Shopify 未配置：请在环境变量中设置 SHOPIFY_CLIENT_SECRET" +
        "（Dev Dashboard → 你的 app → Settings → Credentials）"
    );
  }
  return raw;
}

/**
 * Admin API 的 access token
 *
 * ## 两条路
 *
 * 1. **旧路**:配了 `SHOPIFY_ADMIN_ACCESS_TOKEN`(永久 token)→ 直接用
 * 2. **新路**(2026-01-01 之后的标准做法):client credentials grant 换一个
 *    临时 token(24 小时有效)
 *
 * ## 为什么要缓存
 *
 * grant 出来的 token **24 小时就过期**。每次建单都换一次不但慢,还平白
 * 多打 Shopify 一次。所以缓存住,到期前 5 分钟自己换。
 *
 * ## 为什么要单飞(只换一次)
 *
 * 并发请求(比如一单里多行、加上同时来了两个用户的下单)不能各换各的 ——
 * 缓存是空的大家都会去换。`inflightToken` 保证同一时刻只有一次 grant 在
 * 跑,后来的一起等它。
 *
 * ## 换 token 失败算什么错
 *
 * - **4xx**(凭据不对 / app 没装在店铺上)→ `ShopifyNotConfiguredError` ——
 *   「没配好」,重试没用,得改配置
 * - **网络不通 / 5xx** → `PaymentProviderError` —— 「这次挂了」,重试就能好
 *
 * 这两类对用户是两件完全不同的事,见 `@/features/storefront/lib/payment-issue.ts`。
 */
export async function getShopifyAdminToken(): Promise<string> {
  // 旧路:永久 token,配了就优先用它
  const permanent = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  if (permanent) return permanent;

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken.token;
  }
  // 已经在换了 —— 等它,别再换一次
  if (inflightToken) return inflightToken;

  const pending = requestAdminToken().finally(() => {
    inflightToken = null;
  });
  inflightToken = pending;
  return pending;
}

/** token 提前多久换 —— 别拿一个正要过期的 token 去建单 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** 换来的 token 缓存(进程内) */
let cachedToken: { token: string; expiresAt: number } | null = null;

/** 正在换 token 的那个 Promise —— 单飞,别并发换好几次 */
let inflightToken: Promise<string> | null = null;

/**
 * 真的去换一次 token
 *
 * `POST https://{shop}.myshopify.com/admin/oauth/access_token`
 */
async function requestAdminToken(): Promise<string> {
  const domain = getShopifyStoreDomain();
  const clientId = getShopifyClientId();
  const clientSecret = getShopifyClientSecret();

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response: Response;
  try {
    response = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
    });
  } catch (error) {
    // 网络没通 —— 「这次挂了」,重试有用
    throw new PaymentProviderError("shopify", "Shopify 换 token 时网络没通", {
      cause: error,
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = text.slice(0, 300);

    // 4xx = 凭据不对(client_id / client_secret 写错、app 没装在店铺上、
    // scope 不够)—— 重试没用,得改配置
    if (response.status >= 400 && response.status < 500) {
      throw new ShopifyNotConfiguredError(
        `Shopify 拒绝了这对 client_id / client_secret(HTTP ${response.status})：${detail}` +
          "—— app 要装在店铺上,scope 要含 read_orders / write_orders"
      );
    }
    // 5xx = Shopify 那边的问题 —— 重试有用
    throw new PaymentProviderError(
      "shopify",
      `Shopify 换 token 失败(HTTP ${response.status})`,
      { cause: detail }
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  const token = payload.access_token?.trim();
  if (!token) {
    throw new ShopifyNotConfiguredError(
      "Shopify 没给 access_token —— client_id / client_secret 不对?"
    );
  }

  // 有效期:Shopify 给 24 小时(86400)。没给就按 1 小时算 —— 保守,宁可早换
  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : 3600;
  cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };

  return token;
}

/**
 * webhook 验签用的密钥
 *
 * **新模型下就是 Client Secret** —— 验签那个头
 * `X-Shopify-Hmac-Sha256` 的 key 就是它。
 *
 * 旧路(`SHOPIFY_API_SECRET`)还留着:2026-01-01 之前建的 app 可能有独立的
 * API secret,那种情况显式配的那个优先。
 */
export function getShopifyApiSecret(): string {
  const explicit = process.env.SHOPIFY_API_SECRET?.trim();
  if (explicit) return explicit;

  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    throw new ShopifyNotConfiguredError(
      "Shopify 未配置：请在环境变量中设置 SHOPIFY_CLIENT_SECRET" +
        "（新模型下它就是 webhook 的验签密钥）或旧路的 SHOPIFY_API_SECRET"
    );
  }
  return clientSecret;
}

/** GraphQL API 版本 */
export function getShopifyApiVersion(): string {
  const raw = process.env.SHOPIFY_API_VERSION?.trim();
  return raw || DEFAULT_SHOPIFY_API_VERSION;
}

/** Admin GraphQL 端点 */
export function getShopifyGraphqlUrl(): string {
  const domain = getShopifyStoreDomain();
  const version = getShopifyApiVersion();
  return `https://${domain}/admin/api/${version}/graphql.json`;
}

/**
 * 配齐了「这条通道能走通」所需的最小配置没
 *
 * **两样都要齐**:
 *
 * 1. **能拿到 Admin API token** —— 旧路有永久 token(`SHOPIFY_ADMIN_ACCESS_TOKEN`),
 *    新路有 Client ID + Client Secret(grant 那条路)
 * 2. **有 webhook 验签密钥** —— 不然回调验不过签,用户付了钱订单永远不
 *    变「已付」(新模型下就是 Client Secret;旧路是 `SHOPIFY_API_SECRET`)
 *
 * 少一样都不算配好 —— 「配好了」意味着**整条路走得通**,不是「建单那一步
 * 能过」。
 *
 * **注意**:这里**查不了**「店铺能不能收美元」—— 那要问 Shopify,而
 * `isConfigured()` 是同步的(界面上要立刻知道这个通道能不能选)。
 * 币种对不上会在**建单那一步**报错,并且报得很清楚(见 `currency.ts`)。
 */
export function isShopifyConfigured(): boolean {
  try {
    getShopifyStoreDomain();
    // 验签密钥 —— 没有它回调就是死的
    getShopifyApiSecret();
    if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim()) return true;
    getShopifyClientId();
    getShopifyClientSecret();
    return true;
  } catch {
    return false;
  }
}
