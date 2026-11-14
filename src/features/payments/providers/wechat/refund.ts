/**
 * 微信支付 V3 退款 —— `POST {apiBase}{refundPath}`
 *
 * ## 为什么不自己造退款流程
 *
 * 微信这边**已经有**一整套退款机制:幂等键(`out_refund_no`)、退款状态机
 * (`SUCCESS` / `PROCESSING` / `CLOSED` / `ABNORMAL`)、退款结果异步通知。
 *
 * ⇒ 本仓库这一层**很薄**:把「订单号 + 金额 + 原因」递过去,拿回一个状态。
 * 自己造一套「记账 + 手工对账」等于重复实现别人已经做好的东西,而且**退两次
 * 钱**的风险全在自己身上。
 *
 * ## 三个必须记住的点
 *
 * 1. **金额是分**,而且**两个金额都要**:`amount.total`(原单总额)+ `amount.refund`
 *    (要退多少)。微信拿 `total` 校验「退的不能超过原单」。
 * 2. **`out_refund_no` 是幂等键** —— 平台那边同一个号只会退一次。⇒ 重试**必须**
 *    用同一个号(我们用退款申请行的 id),换个号就是退两次钱。
 * 3. **path 要进签名串** —— 沙箱模式下退款路径跟正式**不一样**(沙箱前缀)。
 *    ⚠️ 跟 `native.ts` 一个毛病:签名和 fetch **必须用同一个变量**。
 *
 * ## 状态怎么映射
 *
 * | 微信 | 本仓库 | 钱动了没 |
 * |---|---|---|
 * | `SUCCESS` | `succeeded` | 退了 ⇒ 可以写 `payment_status = "refunded"` |
 * | `PROCESSING` | `processing` | 在路上 ⇒ **不能**写已退款 |
 * | `CLOSED` | `rejected` | 没退(终态失败) |
 * | `ABNORMAL` | `processing` | 异常 ⇒ 人工看一眼,不许当成失败直接核销 |
 *
 * 认不出来的状态一律当 `processing` —— **宁可多等一次通知,也不要把「钱还没到」
 * 写成「已退款」**。
 */

import { randomUUID } from "node:crypto";
import { PRICE_CURRENCY } from "@/config/currency";
import type { PaymentRefundOutcome } from "@/features/payments/lib/types";

import type { WechatPayConfig } from "./env";

import {
  buildAuthorizationHeader,
  buildSignMessage,
  signWithPrivateKey,
} from "./signature";

/**
 * 微信的错误体
 *
 * 只有 `code` / `message` —— 没有别的。⇒ 失败原因只能靠这两个字段,
 * 界面**原样**摆给工作室(别翻译成「出错了」)。
 */
interface WechatErrorBody {
  code?: string;
  message?: string;
}

/** 退款请求的参数 */
export interface WechatRefundParams {
  /** 商户号 */
  mchId: string;
  /** appid */
  appId: string;
  /** 商户 API 证书序列号 */
  serialNo: string;
  /** 商户私钥 PEM */
  privateKeyPem: string;
  /** 我们的订单号(`out_trade_no`) */
  outTradeNo: string;
  /**
   * 退款单号(`out_refund_no`)—— **幂等键**
   *
   * ⚠️ **必须稳定** —— 重试要用同一个号,换个号就是退两次钱。
   */
  outRefundNo: string;
  /** 原单总额(分)—— 微信拿它校验「退的不能超过原单」 */
  totalCents: number;
  /** 要退多少(分) */
  refundCents: number;
  /** 退款原因 —— 微信会把它展示给买家 */
  reason: string;
  /** 退款结果通知地址 —— 留空就不带这个字段 */
  notifyUrl?: string | null;
  /** API 根地址(不带路径) */
  apiBase: string;
  /**
   * 退款路径
   *
   * ⚠️ **会进签名串** —— 必须跟发请求时用的那个**一模一样**。
   * 正式是 `/v3/refund/domestic/refunds`;沙箱带前缀(可配)。
   */
  refundPath: string;
}

/**
 * 拼退款请求体 —— **纯函数**(能进 unit project 跑单测)
 *
 * 金额全是**分**(整数)。币种跟本仓库的价走(人民币)—— 本仓库的代码里
 * 没有汇率,见 CLAUDE.md。
 */
export function buildWechatRefundBody(params: {
  outTradeNo: string;
  outRefundNo: string;
  totalCents: number;
  refundCents: number;
  reason: string;
  notifyUrl?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    out_trade_no: params.outTradeNo,
    out_refund_no: params.outRefundNo,
    reason: params.reason,
    amount: {
      refund: params.refundCents,
      total: params.totalCents,
      currency: PRICE_CURRENCY,
    },
  };
  // 没有通知地址就不带这个字段 —— 微信对空串会报参数错误
  const notifyUrl = params.notifyUrl?.trim();
  if (notifyUrl) body.notify_url = notifyUrl;
  return body;
}

/** 微信退款的响应体(成功时) */
interface WechatRefundResponseBody {
  refund_id?: string;
  create_time?: string;
  status?: string;
  amount?: {
    total?: number;
    refund?: number;
  };
}

/**
 * 把微信的退款状态映射成本仓库的三档
 *
 * ⚠️ **只有 `SUCCESS` 才算「钱退到了」** —— `PROCESSING` / `ABNORMAL` 都不许
 * 把本地状态写成「已退款」。
 */
export function mapWechatRefundStatus(params: {
  status: string | null | undefined;
  refundId: string | null;
}): PaymentRefundOutcome {
  const status = (params.status ?? "").trim();

  if (status === "SUCCESS") {
    return {
      status: "succeeded",
      providerRefundId: params.refundId,
      providerStatus: status,
    };
  }

  if (status === "CLOSED") {
    // 退款关闭 —— 终态失败,钱没退
    return {
      status: "rejected",
      providerRefundId: params.refundId,
      providerStatus: status,
      detail: "微信说这笔退款已经关闭(CLOSED)—— 钱没有退,需要重新发起或人工处理",
    };
  }

  // `PROCESSING` / `ABNORMAL` / 认不出来的状态 —— 一律当「还在路上」
  return {
    status: "processing",
    providerRefundId: params.refundId,
    providerStatus: status || "(空)",
  };
}

/**
 * 微信**明确拒绝**的错误码 → 什么档
 *
 * | 码 | 意思 | 本仓库 |
 * |---|---|---|
 * | `RESOURCE_ALREADY_EXISTS` | 这个 `out_refund_no` 已经用过 | `processing` —— 退单已存在,可能已经在处理 |
 * | `INVALID_REQUEST` / `PARAM_ERROR` / `ORDER_NOT_EXIST` / `REFUND_FEE_EXCEED` / `MCH_NOT_EXISTS` … | 参数 / 状态不对 | `rejected` —— 钱没动 |
 */
function mapWechatRefundErrorCode(code: string): PaymentRefundOutcome {
  if (code === "RESOURCE_ALREADY_EXISTS") {
    return {
      status: "processing",
      providerRefundId: null,
      providerStatus: code,
      detail:
        "微信说这笔退款单已经存在了(out_refund_no 用过了)—— 之前那一次可能已经在处理,别再换个号重试(那就是退两次钱)",
    };
  }
  return {
    status: "rejected",
    providerRefundId: null,
    providerStatus: code,
    detail: `微信拒绝了这次退款(${code})`,
  };
}

/**
 * 发起一次退款 —— **返回结果,不抛**
 *
 * - 网络失败 → 抛 `PaymentProviderError`(钱的状态未知,但**重试安全** ——
 *   `out_refund_no` 不变,平台那边只会退一次)
 * - 微信回错误 → 返回 `rejected` / `processing`(钱没动)
 * - 微信回 2xx → 按 `status` 映射
 */
export async function requestWechatRefund(
  params: WechatRefundParams
): Promise<PaymentRefundOutcome> {
  // body 先拼成字符串 —— 签名和发送用的是同一份字节
  const body = JSON.stringify(
    buildWechatRefundBody({
      outTradeNo: params.outTradeNo,
      outRefundNo: params.outRefundNo,
      totalCents: params.totalCents,
      refundCents: params.refundCents,
      reason: params.reason,
      notifyUrl: params.notifyUrl ?? null,
    })
  );

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replace(/-/g, "").slice(0, 32);

  const signature = signWithPrivateKey(
    buildSignMessage({
      method: "POST",
      // ⚠️ 签名用的是**请求要发的那个 path** —— 沙箱前缀必须带上,
      // 否则微信验签必挂(`SIGN_ERROR`)。跟下面的 fetch 用的是同一个变量。
      url: params.refundPath,
      timestamp,
      nonce,
      body,
    }),
    params.privateKeyPem
  );

  const authorization = buildAuthorizationHeader({
    mchId: params.mchId,
    nonce,
    signature,
    timestamp,
    serialNo: params.serialNo,
  });

  let response: Response;
  try {
    // 同一个 `params.refundPath` —— 签名串里的 path 跟发请求的 path 不可能
    // 不一致。
    response = await fetch(`${params.apiBase}${params.refundPath}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authorization,
        "User-Agent": "mooncoda-wechatpay/1.0",
      },
      body,
    });
  } catch (error) {
    throw new Error(
      `微信退款请求失败：${error instanceof Error ? error.message : "网络错误"}`
    );
  }

  const text = await response.text();

  let payload: unknown = null;
  let parsed = false;
  try {
    payload = JSON.parse(text);
    parsed = true;
  } catch {
    // 微信偶尔返回非 JSON(网关错误页)—— 下面按原文凑合
  }

  if (!response.ok) {
    const errorBody =
      parsed && typeof payload === "object" && payload !== null
        ? (payload as WechatErrorBody)
        : {};
    const code = errorBody.code ?? `HTTP_${response.status}`;
    const outcome = mapWechatRefundErrorCode(code);
    return {
      ...outcome,
      detail: `${outcome.detail}:${errorBody.message ?? text.slice(0, 200)}`,
    };
  }

  if (!parsed) {
    throw new Error("微信退款响应不是合法 JSON");
  }

  const body2 = payload as WechatRefundResponseBody;
  const refundId = (body2.refund_id ?? "").trim() || null;

  return mapWechatRefundStatus({
    status: body2.status ?? null,
    refundId,
  });
}

/**
 * 按配置发起退款 —— 通道实现(`index.ts`)用这个
 */
export async function refundWithWechatConfig(
  config: WechatPayConfig,
  request: {
    orderNo: string;
    outRefundNo: string;
    totalCents: number;
    refundCents: number;
    reason: string;
  }
): Promise<PaymentRefundOutcome> {
  return requestWechatRefund({
    mchId: config.mchId,
    appId: config.appId,
    serialNo: config.serialNo,
    privateKeyPem: config.privateKeyPem,
    outTradeNo: request.orderNo,
    outRefundNo: request.outRefundNo,
    totalCents: request.totalCents,
    refundCents: request.refundCents,
    reason: request.reason,
    // 退款结果通知跟付款通知走同一个端点 —— webhook 那边按 `event_type` 分流
    notifyUrl: config.notifyUrl,
    apiBase: config.apiBase,
    // 端点跟签名**同源** —— 配置里那一份,原样传下去
    refundPath: config.refundPath,
  });
}
