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
 * ## 退款通知走**同一个端点**
 *
 * 支付宝的退款异步通知跟付款通知**用同一个 `notify_url`** ⇒ 同一个端点,
 * 按**字段形状**分流:付款通知带 `trade_status`,退款通知带 `refund_status`。
 *
 * ⇒ 这个端点两条腿都接:付款走 `mark_paid`,退款走 `landRefundOutcome`。
 *
 * ## 幂等
 *
 * 通知会重投。靠 `settleByOrderNo()` 本身幂等处理(已是目标状态就 no-op),
 * 不另建去重表。
 */

import { landRefundOutcome } from "@/features/refund/lib/land-refund";
import {
  getRefundRequestById,
  recordRefundProviderOutcome,
  transitionRefundStatus,
} from "@/features/refund/lib/refund-store";
import { amountStringToCents } from "@/features/payments/lib/money";
import { settleByOrderNo } from "@/features/payments/lib/settle";
import { logger } from "@/lib/logger";

import { getAlipayConfigs } from "./config";
import type { AlipayConfig } from "./env";
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

/**
 * 这条通知是**退款**通知吗
 *
 * 按**字段形状**判,不看别的:付款通知带 `trade_status`,退款通知带
 * `refund_status`。两条通知用**同一个** `notify_url` ⇒ 必须自己分流。
 */
export function isAlipayRefundNotify(params: AlipayNotifyParams): boolean {
  return (params.refund_status ?? "").trim().length > 0;
}

/**
 * 支付宝退款异步通知的处理结果
 *
 * 跟付款那条腿的 `AlipayNotifyOutcome` **形状一样** —— 同一个端点、同一套
 * 状态码(401 / 500 / 200),路由那边不用改。
 */
export interface AlipayRefundNotifyOutcome {
  /** 验签过了吗 —— false → 回 401 */
  verified: boolean;
  /** 我们的订单号 */
  orderNo: string | null;
  /** 退款申请行的 id(平台那边叫 `out_request_no`) */
  refundRequestId: string | null;
  /** 退款状态原文(`REFUND_SUCCESS` / `REFUND_FAIL`) */
  refundStatus: string | null;
  /** 真的落库了吗 */
  settled: boolean;
  /** 给日志看的原因 */
  reason: string | null;
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
 *
 * ## 为什么**两个模式**的公钥都试一遍
 *
 * 拨沙箱开关的瞬间可能有**在途付款**:切到沙箱时,一笔**正式**订单的通知到了
 * ⇒ 用沙箱支付宝公钥验不过 ⇒ **真钱收了但订单不标已付**(钱收了、货没开工)。
 *
 * ⇒ 先用当前模式的公钥验,验不过再试另一个模式的。**另一套验不过就照旧
 * 拒绝** —— 只是多试一次,**不放松任何校验**。
 */
export async function handleAlipayNotify(
  params: AlipayNotifyParams
): Promise<AlipayNotifyOutcome> {
  // 当前模式那一份排在前面;另一档没配好就自动跳过。
  const configs = await getAlipayConfigs();

  // ---- 1. 验签:找出「哪几份配置的支付宝公钥能验过这条通知」 ----
  const verifying: AlipayConfig[] = [];
  for (const config of configs) {
    if (verifyNotifySignature(params, config.alipayPublicKey)) {
      verifying.push(config);
    }
  }

  if (verifying.length === 0) {
    return {
      verified: false,
      orderNo: params.out_trade_no ?? null,
      tradeNo: params.trade_no ?? null,
      tradeStatus: params.trade_status ?? null,
      settled: false,
      reason:
        configs.length === 0
          ? "两个模式都没配好,没有验签用的支付宝公钥"
          : "验签失败",
    };
  }

  // ---- 2. 拿验过了的那份配置比 APPID ----
  //
  // 跟**验过的那份**比,不是跟「当前模式」比:在途付款那一笔可能是另一个
  // 模式的凭据签发的。
  const config = verifying[0] as AlipayConfig;

  // ---- 2.5 退款通知走**另一个分支** ----
  //
  // 付款通知和退款通知**用同一个 `notify_url`** ⇒ 按字段形状分流:
  // 付款带 `trade_status`,退款带 `refund_status`。
  //
  // ⚠️ 这一步在**验签之后** —— 退款通知也一样要验签(不验签就是「谁都能说
  // 钱退了」)。验不过的那一份在上面已经返回 `verified: false` 了。
  if (isAlipayRefundNotify(params)) {
    const refundOutcome = await handleAlipayRefundNotify({
      params,
      config,
    });
    return {
      verified: refundOutcome.verified,
      orderNo: refundOutcome.orderNo,
      tradeNo: (params.trade_no ?? "").trim() || null,
      tradeStatus: refundOutcome.refundStatus,
      settled: refundOutcome.settled,
      reason: refundOutcome.reason,
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

/* -------------------------------------------------------------------------- */
/*  退款通知那一条腿                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 退款金额(元)→ 分 —— **解析不了就返回 null**
 *
 * 支付宝这边金额单位是**元**(微信是分)⇒ 走仓库那份 `amountStringToCents()`
 * (纯整数运算,不用浮点)。它**解析不了会抛** ⇒ 这里 catch 掉返回 null,
 * 让调用方退回「申请单上的金额」。
 */
function parseRefundFeeCents(
  raw: string | undefined | null
): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    return amountStringToCents(value);
  } catch {
    return null;
  }
}

/**
 * 处理一条**退款**异步通知
 *
 * ## 字段
 *
 * | 字段 | 含义 |
 * |---|---|
 * | `out_trade_no` | 我们的订单号 |
 * | `out_request_no` | **我们的退款请求号** = 退款申请行的 id(幂等键) |
 * | `out_biz_no` | 支付宝侧的退款流水号 |
 * | `refund_status` | `REFUND_SUCCESS` / `REFUND_FAIL` |
 * | `refund_fee` | 实际退款金额(**元**) |
 * | `app_id` | 应用 APPID |
 *
 * ## 为什么找不到申请单就**什么都不改**
 *
 * 工作室有可能在**支付宝商家后台**手工退了一笔款 —— 那笔通知里的
 * `out_request_no` 是他自己填的,本地没有对应的申请单。
 *
 * ⇒ **不自动把订单标成已退款** —— 自动改就是「没收到钱却标成退了」(资损)。
 * 只记一条 warn,工作室在后台看到「标记已退款」那颗按钮,人工点一下。
 */
async function handleAlipayRefundNotify(input: {
  params: AlipayNotifyParams;
  config: AlipayConfig;
}): Promise<AlipayRefundNotifyOutcome> {
  const { params, config } = input;

  const orderNo = (params.out_trade_no ?? "").trim();
  // 幂等键 —— 我们发给支付宝的就是退款申请行的 id
  const refundRequestId = (
    params.out_request_no ??
    params.out_biz_no ??
    ""
  ).trim();
  const refundStatus = (params.refund_status ?? "").trim();
  const outBizNo = (params.out_biz_no ?? "").trim();

  // ---- 1. APPID 对不上 → 别的应用的单 ----
  const notifiedAppId = (params.app_id ?? "").trim();
  if (notifiedAppId && notifiedAppId !== config.appId) {
    return {
      verified: true,
      orderNo: orderNo || null,
      refundRequestId: refundRequestId || null,
      refundStatus: refundStatus || null,
      settled: false,
      reason: "app_id 与当前配置不一致,忽略",
    };
  }

  // ---- 2. 认不出来 → 什么都不做 ----
  if (orderNo.length === 0 || refundRequestId.length === 0) {
    return {
      verified: true,
      orderNo: orderNo || null,
      refundRequestId: refundRequestId || null,
      refundStatus: refundStatus || null,
      settled: false,
      reason:
        orderNo.length === 0
          ? "退款通知里没有 out_trade_no"
          : "退款通知里没有 out_request_no",
    };
  }

  // ---- 3. 找退款申请单 ----
  const request = await getRefundRequestById(refundRequestId);
  if (!request) {
    logger.warn(
      { orderNo, refundRequestId, refundStatus },
      "[payments][alipay] 收到一条退款通知,但本地没有对应的退款申请 —— 没有自动改任何状态,请工作室在后台核对"
    );
    return {
      verified: true,
      orderNo,
      refundRequestId,
      refundStatus: refundStatus || null,
      settled: false,
      reason: "本地没有这笔退款申请 —— 没有自动改任何状态",
    };
  }

  // ---- 4. 金额(元 → 分);解析不了就退回申请单上的金额 ----
  const refundedCents =
    parseRefundFeeCents(params.refund_fee ?? params.refund_amount) ??
    request.amountCents;

  // ---- 5. `REFUND_SUCCESS` → 钱退到了 ----
  if (refundStatus === "REFUND_SUCCESS") {
    const result = await landRefundOutcome({
      refundRequestId,
      orderNo: request.orderNo,
      orderKind: request.orderKind,
      channel: "alipay",
      refundedCents,
      providerRefundId: outBizNo || null,
      providerStatus: refundStatus,
      note: "支付宝退款到账通知",
      actor: "admin",
    });
    return {
      verified: true,
      orderNo,
      refundRequestId,
      refundStatus: refundStatus || null,
      settled: result.ok,
      reason: result.ok
        ? "支付宝退款到账,已落库"
        : `落库失败(${result.code})`,
    };
  }

  // ---- 6. 别的状态 → 先把平台状态记下来 ----
  await recordRefundProviderOutcome({
    refundRequestId,
    providerRefundId: outBizNo || null,
    providerRefundStatus: refundStatus || null,
    refundError:
      refundStatus === "REFUND_FAIL"
        ? "支付宝退款失败(REFUND_FAIL),款项没有退回"
        : null,
  });

  // `REFUND_FAIL` ⇒ 钱**确定**没退 ⇒ 申请单转「已拒绝」(带备注,工作室可以重新发起)
  if (refundStatus === "REFUND_FAIL") {
    const transition = await transitionRefundStatus({
      refundRequestId,
      toStatus: "rejected",
      note: "支付宝退款失败(REFUND_FAIL),款项没有退回 —— 工作室可以重新发起退款",
      actor: "admin",
    });
    return {
      verified: true,
      orderNo,
      refundRequestId,
      refundStatus: refundStatus || null,
      settled: false,
      reason: transition.ok
        ? "支付宝退款失败,已转「已拒绝」"
        : `退款失败,申请单状态没改成(已是终态)${transition.code ? `(${transition.code})` : ""}`,
    };
  }

  // 其余状态(理论上不该有)—— 只记平台状态,不动本地状态
  return {
    verified: true,
    orderNo,
    refundRequestId,
    refundStatus: refundStatus || null,
    settled: false,
    reason: `退款状态 ${refundStatus || "(空)"} 不是退款成功,只记录了平台状态`,
  };
}
