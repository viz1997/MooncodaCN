/**
 * 支付宝「电脑网站支付」(`alipay.trade.page.pay`)—— 拼跳转地址
 *
 * ## 这条通道干什么
 *
 * 用户点「用支付宝付款」→ 浏览器整页跳到支付宝网关 → 付完跳回我们的
 * `return_url`,同时支付宝**异步**通知 `notify_url`。收钱这件事以异步通知
 * 为准(见 `webhook.ts`)。
 *
 * ## 金额怎么算
 *
 * ```
 * 合计(分) = Σ(折后单价分 × 数量) + 运费分
 * total_amount(元) = centsToAmountString(合计分)
 * ```
 *
 * 折后单价**已经是**最终价 —— 阶梯折扣在算价那一层就折过了,通道不参与
 * 定价(见 `payments/lib/types.ts` 的 `PaymentRequestItem.unitPriceCents`)。
 *
 * 金额全程整数,只有最后转成元字符串时才除 —— 浮点会把「逐分相等」打破。
 *
 * ## 签名
 *
 * 待签字符串里 **value 原样**(不 URL 编码),但**拼进 URL 时要编码** ——
 * 这两件事不一样,搞混了签名就对不上。
 */

import { centsToAmountString } from "@/features/payments/lib/money";
import type { PaymentRequest } from "@/features/payments/lib/types";

import { ALIPAY_RETURN_PATH, type AlipayConfig } from "./env";
import { buildSignContent, signContent } from "./sign";

/** 电脑网站支付的接口名 */
export const ALIPAY_PAGE_PAY_METHOD = "alipay.trade.page.pay";

/** 电脑网站支付对应的产品编码 */
export const ALIPAY_PRODUCT_CODE = "FAST_INSTANT_TRADE_PAY";

/** 付款超时 —— 30 分钟 */
export const ALIPAY_TIMEOUT_EXPRESS = "30m";

/** `biz_content` 的形状 */
export interface AlipayBizContent {
  /** 我们的订单号 */
  out_trade_no: string;
  /** 应付金额(元,两位小数字符串) */
  total_amount: string;
  /** 标题 */
  subject: string;
  /** 产品编码 */
  product_code: string;
  /** 付款超时 */
  timeout_express: string;
}

/**
 * 算应付总额(分)
 *
 * 每行的「折后单价 × 数量」再加起来,最后加上运费。运费也是分,先加总再
 * 转元 —— 分和元混着加会出那一分钱的差。
 */
export function computeTotalCents(request: PaymentRequest): number {
  const itemsTotal = request.items.reduce(
    (sum, item) => sum + Math.round(item.unitPriceCents * item.quantity),
    0
  );
  return itemsTotal + Math.round(request.shippingCents);
}

/**
 * 拼标题
 *
 * 支付宝的付款页上就显示这一行。第一行商品的标题 + 件数。
 */
export function buildSubject(request: PaymentRequest): string {
  const first = (request.items[0]?.title ?? "").trim();
  const base = first.length > 0 ? first : "订单付款";
  const extra =
    request.items.length > 1 ? ` 等 ${request.items.length} 件商品` : "";
  const subject = `${base}${extra}`;
  // 支付宝 title 上限 256 —— 砍到 200 留点余量
  return subject.length > 200 ? `${subject.slice(0, 200)}…` : subject;
}

/**
 * 拼 `biz_content`
 *
 * 是个 **JSON 字符串**,不是对象 —— 支付宝的参数值全是字符串。
 */
export function buildBizContent(request: PaymentRequest): AlipayBizContent {
  return {
    out_trade_no: request.orderNo,
    total_amount: centsToAmountString(computeTotalCents(request)),
    subject: buildSubject(request),
    product_code: ALIPAY_PRODUCT_CODE,
    timeout_express: ALIPAY_TIMEOUT_EXPRESS,
  };
}

/**
 * 同步回跳地址
 *
 * 优先级:显式配的 `ALIPAY_RETURN_URL` → 请求里的 `successUrl` → 站点地址
 * 拼 `/checkout/success`。
 */
export function resolveReturnUrl(
  config: AlipayConfig,
  request: PaymentRequest
): string {
  if (config.returnUrl) return config.returnUrl;

  const fromRequest = (request.successUrl ?? "").trim();
  if (fromRequest) return fromRequest;

  if (config.siteUrl) return `${config.siteUrl}${ALIPAY_RETURN_PATH}`;
  return ALIPAY_RETURN_PATH;
}

/**
 * 拼支付宝的时间戳
 *
 * 格式 `YYYY-MM-DD HH:mm:ss`,**本地时间**(不是 UTC —— 支付宝按本地时间
 * 校验,差 8 小时会被拒)。
 */
export function formatAlipayTimestamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
}

/**
 * 拼出「跳到支付宝」的地址
 *
 * 步骤:公共参数 + `biz_content` → 按 key 升序拼待签字符串 → 应用私钥签名 →
 * 拼进 URL 的查询参数。
 *
 * 注意:**签名用的是原值,URL 里用的是编码后的值**。
 */
export function buildPagePayRedirectUrl(
  config: AlipayConfig,
  request: PaymentRequest
): string {
  const params: Record<string, string> = {
    app_id: config.appId,
    method: ALIPAY_PAGE_PAY_METHOD,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(),
    version: "1.0",
    notify_url: config.notifyUrl,
    return_url: resolveReturnUrl(config, request),
    biz_content: JSON.stringify(buildBizContent(request)),
  };

  const content = buildSignContent(params, "request");
  const signature = signContent(content, config.appPrivateKey);

  const query = new URLSearchParams({ ...params, sign: signature });
  return `${config.gateway}?${query.toString()}`;
}
