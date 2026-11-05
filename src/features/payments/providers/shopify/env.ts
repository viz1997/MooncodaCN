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
 * **认不了我们算出来的价** —— 详见下面「为什么用草稿订单」那一节。
 *
 * ## 为什么用**草稿订单**而不是普通购物车
 *
 * 「本仓库算价,Sellbase 只做收银台」这条架构的核心是**逐分相等**:
 * 我们算出来的每一行单价,必须跟收银台实际收的金额**一分不差**。
 *
 * Shopify 的普通购物车做不到:
 *
 * - Storefront API 的 `CartLineInput` **没有价格字段** —— 行价只能来自
 *   商品变体,想把我们算出来的价塞进去只能去改变体价格,那会污染目录。
 * - 想改价得用 Cart Transform(`lineUpdate`),而 **Cart Transform 是 Plus
 *   套餐才有的**(开发店豁免)。付费店没有 Plus 就用不了。
 * - Shopify Scripts 已经下线(2026-06-30),那条路也不通。
 *
 * 草稿订单(Admin API 的 `draftOrderCreate`)则是另一回事:
 *
 * - 行项目可以是**自定义行**(`title` + `price` + `quantity`),价格**由我们
 *   给**,不是从商品目录来的。
 * - `taxExempt: true` —— 不会在我们的总价上再叠一层税。
 * - 运费也是我们自己给的一行(`shippingLine`),不跟 Shopify 的运费规则走。
 * - 付完钱 Shopify 会把它转成正式订单并发 `orders/paid` webhook。
 *
 * 也就是说:**用草稿订单,我们既不用把目录同步过去,又能保证一分钱不差。**
 *
 * ## 需要的环境变量
 *
 * `.env.example` 被 gitignore 挡掉了(见 [[env-example-is-gitignored]]),
 * 所以变量说明写在这里。
 *
 * | 变量 | 必填 | 说明 |
 * |---|---|---|
 * | `SHOPIFY_STORE_DOMAIN` | 是 | 店铺域名,形如 `your-shop.myshopify.com`(带不带 `https://` 都行) |
 * | `SHOPIFY_ADMIN_ACCESS_TOKEN` | 是 | Admin API 的 access token(`shpat_…`)。需要 `write_orders` scope |
 * | `SHOPIFY_API_SECRET` | 收 webhook 时必填 | 应用的 API secret —— webhook 的 HMAC 密钥。在应用后台「设置 → 应用设置 → API 密钥」里看 |
 * | `SHOPIFY_API_VERSION` | 否 | GraphQL API 版本,默认 `2025-10` |
 *
 * **密钥纪律**:token 和 secret **只进环境变量**,绝不进仓库文件、绝不进
 * 聊天记录。见 CLAUDE.md 的「密钥纪律」。
 *
 * ## 缺配置时的行为
 *
 * 跟 R2 / Sellbase 一样是**优雅降级**:`isShopifyConfigured()` 返回 false,
 * 「选择支付方式」里就不显示这一条(让用户点一个注定失败的按钮,比不给这个
 * 选项更糟)。真的去调 Shopify 而配置不齐 → 抛 `PaymentNotConfiguredError`
 * —— 跟「这次调用挂了」分得开,见 `@/features/storefront/lib/payment-issue.ts`。
 */

import { PaymentNotConfiguredError } from "@/features/payments/lib/types";

/** GraphQL API 版本 —— 2025-10 支持草稿订单的 `price` / `priceOverride` */
export const DEFAULT_SHOPIFY_API_VERSION = "2025-10";

/** 读取配置时抛的错误 —— 跟 `PaymentNotConfiguredError` 分开是为了给一句更准的话 */
export class ShopifyNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyNotConfiguredError";
  }
}

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

/** Admin API access token —— 只在服务端读,绝不进客户端 bundle */
export function getShopifyAdminToken(): string {
  const raw = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  if (!raw) {
    throw new ShopifyNotConfiguredError(
      "Shopify 未配置：请在环境变量中设置 SHOPIFY_ADMIN_ACCESS_TOKEN"
    );
  }
  return raw;
}

/**
 * webhook 验签密钥
 *
 * 跟 admin token 分开 —— 前者建单要用,后者只有收 webhook 时才要。
 * 还没配 webhook 的部署不该被这个拦住。
 */
export function getShopifyApiSecret(): string {
  const raw = process.env.SHOPIFY_API_SECRET?.trim();
  if (!raw) {
    throw new ShopifyNotConfiguredError(
      "Shopify 未配置：请在环境变量中设置 SHOPIFY_API_SECRET（应用后台 → 设置 → 应用设置 → API 密钥）"
    );
  }
  return raw;
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

/** 配齐了「能建草稿单」所需的最小配置没 */
export function isShopifyConfigured(): boolean {
  try {
    getShopifyStoreDomain();
    getShopifyAdminToken();
    return true;
  } catch {
    return false;
  }
}

/** 缺配置时给上层用的统一错误 */
export function toPaymentNotConfiguredError(
  error: unknown
): PaymentNotConfiguredError | null {
  if (error instanceof ShopifyNotConfiguredError) {
    return new PaymentNotConfiguredError("shopify", error.message);
  }
  return null;
}
