/**
 * 支付宝退款(`alipay.trade.refund`)
 *
 * ## 为什么不自己造退款流程
 *
 * 支付宝这边**已经有**一整套退款机制:幂等键(`out_request_no`)、同步返回
 * 退款结果(`fund_change`)、异步通知(退款到账 / 失败)。
 *
 * ⇒ 本仓库这一层**很薄**:把订单号、金额、原因递过去,拿回一个状态。
 *
 * ## 三个必须记住的点
 *
 * 1. **金额单位是「元」** —— 支付宝跟微信不一样(微信要分)。⇒ 走仓库里那份
 *    `centsToAmountString()`(纯整数除法,不用浮点 —— 见 `payments/lib/money.ts`)。
 * 2. **`out_request_no` 是幂等键** —— 平台那边同一个号只会退一次。⇒ 重试
 *    **必须**用同一个号(我们用退款申请行的 id),换个号就是退两次钱。
 * 3. **响应必须验签** —— ⚠️ 这是 2026-11-14 线上踩过的坑的同一个道理:
 *    **验不过就不许写「已退款」**。⇒ 验不过时**抛错**,让工作室去支付宝后台
 *    自己看一眼,而不是把本地状态改成已退款。
 *
 * ## `fund_change` 才是「钱退没退」的判据
 *
 * | `code` | `fund_change` | 本仓库 | 钱动了没 |
 * |---|---|---|---|
 * | `10000` | `Y` | `succeeded` | 退了 ⇒ 可以写 `payment_status = "refunded"` |
 * | `10000` | `N` | `rejected` | **没退**(这单已退过 / 可退余额为 0) |
 * | `10000` | 缺 | `rejected` | 同上 —— 没有「Y」就不许当成退了 |
 * | 其它 | — | `rejected` | 支付宝拒了(带它自己的 `code` / `sub_msg`) |
 *
 * ⚠️ **`code === "10000"` 只说明「请求处理成功」,不代表「钱退了」** ——
 * `fund_change` 才是钱的判据。这是支付宝退款最容易看错的一个字段。
 */

import { centsToAmountString } from "@/features/payments/lib/money";
import {
  PaymentProviderError,
  type PaymentRefundOutcome,
} from "@/features/payments/lib/types";

import { getAlipayConfig } from "./config";
import type { AlipayConfig } from "./env";
import { formatAlipayTimestamp } from "./page-pay";
import { verifyAlipayResponseSignature } from "./response-sign";
import { buildSignContent, signContent } from "./sign";

/** 退款接口名 */
export const ALIPAY_REFUND_METHOD = "alipay.trade.refund";

/**
 * 退款响应的内层对象名
 *
 * 支付宝用 `api_name.replace(".", "_") + "_response"` 拼出来的 ——
 * `alipay.trade.refund` ⇒ `alipay_trade_refund_response`。
 */
export const ALIPAY_TRADE_REFUND_RESPONSE_KEY = "alipay_trade_refund_response";

/** 退款响应的内层对象 */
interface AlipayRefundResponseBody {
  code?: string;
  sub_code?: string;
  sub_msg?: string;
  msg?: string;
  /** 支付宝的订单号 */
  trade_no?: string;
  /** 我们的订单号 */
  out_trade_no?: string;
  /**
   * **「钱退没退」的判据**
   *
   * `Y` = 这次真的退了;`N` = 没发生资金变动(这单已退过 / 可退余额为 0)。
   */
  fund_change?: string;
  /** 实退金额(元) */
  refund_fee?: string;
  /** 支付宝侧的退款单号 —— `fund_change=Y` 才有 */
  out_biz_no?: string;
  /** 我们的退款请求号(原样回显) */
  out_request_no?: string;
}

/** 支付宝拒请求时的响应节点 */
interface AlipayErrorResponseBody {
  code?: string;
  sub_code?: string;
  sub_msg?: string;
  msg?: string;
}

/**
 * 拼退款请求的业务参数 —— **纯函数**(能进 unit project 跑单测)
 *
 * ⚠️ **金额是「元」**,不是分。
 */
export function buildAlipayRefundBizContent(params: {
  orderNo: string;
  outRefundNo: string;
  refundCents: number;
  reason: string;
}): Record<string, string> {
  return {
    out_trade_no: params.orderNo,
    // 支付宝的退款金额单位是**元**
    refund_amount: centsToAmountString(params.refundCents),
    refund_reason: params.reason,
    // 幂等键 —— 同一个号不会退两次
    out_request_no: params.outRefundNo,
  };
}

/**
 * 把支付宝的退款结果映射成本仓库的三档
 *
 * ⚠️ **只有 `code === "10000"` **且** `fund_change === "Y"` 才算钱退了。**
 */
export function mapAlipayRefundResponse(params: {
  code: string | null | undefined;
  fundChange: string | null | undefined;
  outBizNo: string | null;
  refundFee: string | null;
  subCode: string | null;
  subMsg: string | null;
  msg: string | null;
}): PaymentRefundOutcome {
  const code = (params.code ?? "").trim();

  if (code !== "10000") {
    // 支付宝拒了 —— 钱没动
    const parts = [
      `支付宝拒绝了这次退款(${code || "没有 code"})`,
      params.subCode ? `sub_code=${params.subCode}` : null,
      params.subMsg ?? params.msg ?? null,
    ].filter(Boolean);
    return {
      status: "rejected",
      providerRefundId: null,
      providerStatus: code || null,
      detail: parts.join(":"),
    };
  }

  const fundChange = (params.fundChange ?? "").trim();

  if (fundChange === "Y") {
    return {
      status: "succeeded",
      providerRefundId: params.outBizNo,
      providerStatus: "fund_change=Y",
    };
  }

  // `code === "10000"` 但 `fund_change !== "Y"` —— **钱没退**
  //
  // 支付宝回 `fund_change=N` 的典型场景:这单已经退过款 / 可退余额为 0。
  return {
    status: "rejected",
    providerRefundId: params.outBizNo,
    providerStatus: `fund_change=${fundChange || "(空)"}`,
    detail:
      "支付宝说本次没有发生资金变动(fund_change≠Y)—— 常见于该订单已被退过款 / 可退余额为 0;钱没有退",
  };
}

/**
 * 发起一次退款 —— **返回结果,不抛**(平台明确拒绝时)
 *
 * - 网络失败 / 响应验不过 ⇒ **抛 `PaymentProviderError`**(钱的状态未知)
 * - 支付宝回错误码 ⇒ 返回 `rejected`(带它自己的原文)
 * - 支付宝回 `10000` + `fund_change=Y` ⇒ `succeeded`
 */
export async function requestAlipayRefund(params: {
  appId: string;
  appPrivateKey: string;
  alipayPublicKey: string;
  gateway: string;
  orderNo: string;
  outRefundNo: string;
  refundCents: number;
  reason: string;
}): Promise<PaymentRefundOutcome> {
  const requestParams: Record<string, string> = {
    app_id: params.appId,
    method: ALIPAY_REFUND_METHOD,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(
      buildAlipayRefundBizContent({
        orderNo: params.orderNo,
        outRefundNo: params.outRefundNo,
        refundCents: params.refundCents,
        reason: params.reason,
      })
    ),
  };

  // 签名 —— `request` 口径:排除 `sign`,**保留** `sign_type`
  const content = buildSignContent(requestParams, "request");
  const signature = signContent(content, params.appPrivateKey);
  const body = new URLSearchParams({ ...requestParams, sign: signature });

  let raw: string;
  try {
    const response = await fetch(params.gateway, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: body.toString(),
    });
    raw = await response.text();
    if (!response.ok) {
      throw new PaymentProviderError(
        "alipay",
        `支付宝退款失败:HTTP ${response.status}`
      );
    }
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("alipay", "支付宝退款请求失败", {
      cause: error,
    });
  }

  let parsed: {
    alipay_trade_refund_response?: AlipayRefundResponseBody;
    error_response?: AlipayErrorResponseBody;
    sign?: string;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PaymentProviderError("alipay", "支付宝退款响应不是合法 JSON", {
      cause: error,
    });
  }

  const refundNode = parsed.alipay_trade_refund_response;
  const errorNode = parsed.error_response;
  // 错误字段两个节点里同名 ⇒ 统一从哪个节点来都行
  const inner = refundNode ?? errorNode;

  // 验响应签名 —— **待签字符串就是内层那段 JSON 原文**(不带键名前缀)
  //
  // ⚠️ 口径见 `response-sign.ts` 的文件头 —— 2026-11-14 线上踩过:拼上
  // `alipay_trade_query_response=` 前缀 ⇒ 每一笔都验不过。
  const verified = verifyAlipayResponseSignature({
    raw,
    key: ALIPAY_TRADE_REFUND_RESPONSE_KEY,
    signature: parsed.sign,
    alipayPublicKeyPem: params.alipayPublicKey,
  });

  // ⚠️ **验不过就不许写「已退款」**
  //
  // 「响应说成功」但**验不过签** ⇒ 那句话可能不是支付宝说的 ⇒ 抛错,让
  // 工作室去支付宝后台自己看一眼。
  //
  // **重试是安全的** —— `out_request_no` 不变,平台那边只会退一次钱。
  if (!verified) {
    throw new PaymentProviderError(
      "alipay",
      "支付宝退款的响应签名验不过 —— 请不要重复发起,去支付宝后台确认这笔退款的状态(重试是安全的:同一个退款请求号不会退两次钱)"
    );
  }

  return mapAlipayRefundResponse({
    code: inner?.code,
    fundChange: refundNode?.fund_change,
    outBizNo: refundNode?.out_biz_no ?? null,
    refundFee: refundNode?.refund_fee ?? null,
    subCode: inner?.sub_code ?? null,
    subMsg: inner?.sub_msg ?? null,
    msg: inner?.msg ?? null,
  });
}

/**
 * 按配置发起退款 —— 通道实现(`index.ts`)用这个
 */
export async function refundWithAlipayConfig(
  config: AlipayConfig,
  request: {
    orderNo: string;
    outRefundNo: string;
    refundCents: number;
    reason: string;
  }
): Promise<PaymentRefundOutcome> {
  return requestAlipayRefund({
    appId: config.appId,
    appPrivateKey: config.appPrivateKey,
    alipayPublicKey: config.alipayPublicKey,
    gateway: config.gateway,
    orderNo: request.orderNo,
    outRefundNo: request.outRefundNo,
    refundCents: request.refundCents,
    reason: request.reason,
  });
}

/**
 * 用当前生效的配置发起退款(通道实现直接用这个)
 */
export async function refundWithAlipay(
  request: {
    orderNo: string;
    outRefundNo: string;
    refundCents: number;
    reason: string;
  }
): Promise<PaymentRefundOutcome> {
  return refundWithAlipayConfig(await getAlipayConfig(), request);
}
