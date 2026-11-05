/**
 * 支付宝异步通知 —— 验签 + 落库
 *
 * ## 支付宝怎么通知我们
 *
 * 付款成功后支付宝往 `notify_url` POST 一份
 * `application/x-www-form-urlencoded` 的表单,里面有:
 *
 * | 字段 | 含义 |
 * |---|---|
 * | `out_trade_no` | **我们的订单号** —— 唯一可信的关联键 |
 * | `trade_no` | 支付宝的订单号(对账用) |
 * | `trade_status` | 交易状态,`TRADE_SUCCESS` = 付款成功 |
 * | `total_amount` | 实付金额(元) |
 * | `app_id` | 应用 APPID |
 * | `sign` / `sign_type` | 签名 / 签名算法 |
 *
 * ## 三条规矩
 *
 * 1. **验签失败 → 401,不处理**。伪造的「已付款」通知是最坏的情况。
 *    验签用**支付宝公钥**,待签字符串里要**排除 `sign` 和 `sign_type`**
 *    (跟发请求时不一样,见 `sign.ts` 的文件头)。
 * 2. **认不出来的单号 → 照样回 `success`**。支付宝只认 `success` 这个纯文本
 *    响应,回别的它就一直重投(默认会重投一整天)。我们本地没有这张单(比如
 *    是在支付宝后台手工建的单),回 `success` 让它别再来了。
 * 3. **成功的响应必须是纯文本 `success`** —— 带引号、带 JSON、前面多个空格,
 *    支付宝都当成失败。
 *
 * ## 幂等
 *
 * 通知会重投。靠 `settleByOrderNo()` 本身幂等处理(已是目标状态就 no-op),
 * 不另建去重表。
 */

import { settleByOrderNo } from "@/features/payments/lib/settle";

import { getAlipayConfig } from "./env";
import { buildSignContent, verifySign } from "./sign";

/** 一批通知参数 */
export type AlipayNotifyParams = Record<string, string>;

/**
 * 解析通知表单
 *
 * 支付宝 POST 的是 `application/x-www-form-urlencoded`,用 `URLSearchParams`
 * 解。
 */
export function parseNotifyParams(body: string): AlipayNotifyParams {
  const params: AlipayNotifyParams = {};
  for (const [key, value] of new URLSearchParams(body).entries()) {
    params[key] = value;
  }
  return params;
}

/**
 * 验通知签名
 *
 * 待签字符串:按 key 升序拼 `k=v&k=v`,**排除 `sign` 和 `sign_type`**,
 * value 原样(不 URL 编码)。
 */
export function verifyNotifySignature(
  params: AlipayNotifyParams,
  alipayPublicKey: string
): boolean {
  const signature = params.sign;
  if (!signature) return false;
  const content = buildSignContent(params, "notify");
  return verifySign(content, signature, alipayPublicKey);
}

/**
 * 这个交易状态算「付款成功」吗
 *
 * `TRADE_SUCCESS` = 付款成功;`TRADE_FINISHED` = 交易完结(不可退款),
 * 钱一样到了 —— 两种都算。
 */
export function isPaidTradeStatus(tradeStatus: string): boolean {
  return tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED";
}

/** 处理结果 */
export interface AlipayNotifyOutcome {
  /** 验签过了吗 —— false → 回 401 */
  verified: boolean;
  /** 我们的订单号 */
  orderNo: string | null;
  /** 支付宝的订单号 */
  tradeNo: string | null;
  /** 交易状态 */
  tradeStatus: string | null;
  /** 订单状态真的变了吗 */
  settled: boolean;
  /** 给日志看的原因 */
  reason: string | null;
}

/**
 * 处理一条通知
 *
 * 验签 → 判断状态 → 落库。**验签不过绝不落库**。
 *
 * 抛错 = 「这次处理挂了」(比如 DB 写失败)—— 调用方应该回 5xx 让支付宝重投。
 * 不抛错但 `verified: false` = 「签名不对」—— 调用方回 401。
 */
export async function handleAlipayNotify(
  params: AlipayNotifyParams
): Promise<AlipayNotifyOutcome> {
  const config = getAlipayConfig();

  const verified = verifyNotifySignature(params, config.alipayPublicKey);
  if (!verified) {
    return {
      verified: false,
      orderNo: params.out_trade_no ?? null,
      tradeNo: params.trade_no ?? null,
      tradeStatus: params.trade_status ?? null,
      settled: false,
      reason: "验签失败",
    };
  }

  const orderNo = (params.out_trade_no ?? "").trim();
  const tradeNo = (params.trade_no ?? "").trim();
  const tradeStatus = (params.trade_status ?? "").trim();

  if (orderNo.length === 0) {
    // 验签过了但没有订单号 —— 不是我们能处理的单,回 success 让它别再来了
    return {
      verified: true,
      orderNo: null,
      tradeNo: tradeNo || null,
      tradeStatus: tradeStatus || null,
      settled: false,
      reason: "通知里没有 out_trade_no",
    };
  }

  // APPID 对不上 → 这是别的应用的单,不是我们的订单
  const notifiedAppId = (params.app_id ?? "").trim();
  if (notifiedAppId && notifiedAppId !== config.appId) {
    return {
      verified: true,
      orderNo,
      tradeNo: tradeNo || null,
      tradeStatus: tradeStatus || null,
      settled: false,
      reason: "app_id 与当前配置不一致,忽略",
    };
  }

  if (!isPaidTradeStatus(tradeStatus)) {
    // 不是「付款成功」(比如 `WAIT_BUYER_PAY` / `TRADE_CLOSED`)—— 什么都不做
    return {
      verified: true,
      orderNo,
      tradeNo: tradeNo || null,
      tradeStatus: tradeStatus || null,
      settled: false,
      reason: `交易状态 ${tradeStatus || "(空)"} 还不是付款成功`,
    };
  }

  const result = await settleByOrderNo({
    orderNo,
    action: "mark_paid",
    channel: "alipay",
    providerOrderId: tradeNo || null,
  });

  return {
    verified: true,
    orderNo,
    tradeNo: tradeNo || null,
    tradeStatus: tradeStatus || null,
    settled: result.changed,
    reason: result.reason ?? null,
  };
}
