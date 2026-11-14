/**
 * 微信支付 V3 回调 —— 验签 + 解密 + 落库
 *
 * ## 微信怎么通知我们
 *
 * 付款成功后微信往 `notify_url` POST 一份 JSON:
 *
 * ```json
 * {
 *   "id": "…",
 *   "create_time": "…",
 *   "event_type": "TRANSACTION.SUCCESS",
 *   "resource_type": "encrypt-resource",
 *   "resource": {
 *     "algorithm": "AEAD_AES_256_GCM",
 *     "ciphertext": "…",
 *     "nonce": "…",
 *     "associated_data": "transaction"
 *   }
 * }
 * ```
 *
 * 头里有四个验签要用的东西:
 *
 * | 头 | 含义 |
 * |---|---|
 * | `Wechatpay-Timestamp` | 时间戳(秒)—— 超了 5 分钟就拒(防重放) |
 * | `Wechatpay-Nonce` | 随机串 |
 * | `Wechatpay-Signature` | base64 签名 |
 * | `Wechatpay-Serial` | 公钥 ID(公钥模式)或平台证书序列号(证书模式) |
 *
 * `resource` 里是**密文**,解出来才是交易详情:
 * `{ mchid, appid, out_trade_no, transaction_id, trade_state, … }`。
 *
 * ## 退款通知走**同一个端点**
 *
 * 微信的退款结果通知(`REFUND.SUCCESS` / `REFUND.ABNORMAL` / `REFUND.CLOSED`)
 * 跟付款通知**用同一个 `notify_url`** —— 退款那一份的 `associated_data` 是
 * `"refund"`(付款那一份是 `"transaction"`),`event_type` 也是 `REFUND.` 开头。
 *
 * ⇒ 这个端点**按 `event_type` 分流**:付款走 `mark_paid`,退款走
 * `landRefundOutcome`。两条腿共用一个 endpoint,不用再配第二个通知地址。
 *
 * ## 三条规矩
 *
 * 1. **验签失败 → 401,不处理**。伪造的「已付款」通知是最坏的情况。
 * 2. **认不出来的单号 → 照样回 SUCCESS**。微信只认 `{"code":"SUCCESS"}`,
 *    回别的它就一直重投。我们本地没有这张单(比如在商户后台手工建的),
 *    回 SUCCESS 让它别再来了。
 * 3. **只有 `trade_state === "SUCCESS"` 才算付款成功**。别的状态
 *    (`NOTPAY` / `CLOSED` / `USERPAYING`)什么都不做。
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
import { settleByOrderNo } from "@/features/payments/lib/settle";
import { logger } from "@/lib/logger";

import { getWechatPayConfigs } from "./config";
import { resolveVerifyPublicKey, type WechatPayConfig } from "./env";
import {
  decryptResource,
  isTimestampWithinTolerance,
  verifyNotifySignature,
  type WechatEncryptedResource,
} from "./signature";

/** 微信要求回的成功响应体 */
export const WECHAT_NOTIFY_SUCCESS = { code: "SUCCESS" } as const;

/** 微信要求回的失败响应体 */
export function wechatNotifyFailure(message: string): {
  code: "FAIL";
  message: string;
} {
  return { code: "FAIL", message };
}

/** 回调头 —— 验签要用的四个 */
export interface WechatNotifyHeaders {
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  serial: string | null;
}

/** 从 `Headers` 里读出验签要用的四个头 */
export function readNotifyHeaders(headers: Headers): WechatNotifyHeaders {
  return {
    timestamp: headers.get("wechatpay-timestamp"),
    nonce: headers.get("wechatpay-nonce"),
    signature: headers.get("wechatpay-signature"),
    serial: headers.get("wechatpay-serial"),
  };
}

/** 回调体 —— 只关心 `resource` */
export interface WechatNotifyPayload {
  id?: string;
  create_time?: string;
  event_type?: string;
  resource_type?: string;
  resource?: WechatEncryptedResource;
}

/** 解密出来的交易详情 —— 只取我们要用的字段 */
export interface WechatTransaction {
  mchid?: string;
  appid?: string;
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  trade_state_desc?: string;
  success_time?: string;
  amount?: {
    total?: number;
    payer_total?: number;
    currency?: string;
  };
}

/** 处理结果 */
export interface WechatNotifyOutcome {
  /** 验签过了吗 —— false → 回 401 */
  verified: boolean;
  /** 我们的订单号 */
  orderNo: string | null;
  /** 微信的订单号(对账用) */
  transactionId: string | null;
  /** 交易状态 */
  tradeState: string | null;
  /** 订单状态真的变了吗 */
  settled: boolean;
  /** 给日志看的原因 */
  reason: string | null;
}

/**
 * 解密出来的**退款单**详情 —— 只取我们要用的字段
 *
 * 付款通知解出来是交易详情(`trade_state` / `transaction_id`),
 * 退款通知解出来是退款单详情(`refund_status` / `refund_id` / `out_refund_no`)。
 * 密文结构一样(AES-256-GCM),只是明文里的字段不同。
 */
export interface WechatRefund {
  mchid?: string;
  /** 我们的订单号 */
  out_trade_no?: string;
  /** 微信的支付单号 */
  transaction_id?: string;
  /** **退款申请行的 id** —— 也就是我们发给微信的幂等键 `out_refund_no` */
  out_refund_no?: string;
  /** 微信的退款单号 */
  refund_id?: string;
  /** `SUCCESS` / `ABNORMAL` / `CLOSED` */
  refund_status?: string;
  success_time?: string;
  user_received_account?: string;
  amount?: {
    total?: number;
    /** **实际退款金额(分)** */
    refund?: number;
    payer_total?: number;
    payer_refund?: number;
  };
}

/** 微信的退款事件类型 —— 都以 `REFUND.` 开头 */
export const WECHAT_REFUND_EVENT_PREFIX = "REFUND.";

/**
 * 这条通知是不是一条**退款**通知
 *
 * 两个判据(任一命中即是):
 *
 * 1. **`event_type` 以 `REFUND.` 开头**(主判据)—— 微信文档里明确的三种:
 *    `REFUND.SUCCESS` / `REFUND.ABNORMAL` / `REFUND.CLOSED`。
 * 2. **`resource.associated_data === "refund"`**(兜底)—— 退款那一份密文的
 *    附加数据是 `"refund"`,付款那一份是 `"transaction"`。
 *
 * ## 为什么两个判据都要
 *
 * 微信偶尔会**不带 `event_type`**(或者带了别的事件名)。只认 `event_type`
 * 的话,那种退款通知会被当成付款通知处理 ⇒ 走进 `trade_state` 那道关 ⇒
 * 「交易状态(空)还不是付款成功」⇒ **钱退了但我们不知道**。
 */
export function isWechatRefundNotify(payload: WechatNotifyPayload): boolean {
  const eventType = (payload.event_type ?? "").trim();
  if (eventType.startsWith(WECHAT_REFUND_EVENT_PREFIX)) return true;
  const associatedData = (payload.resource?.associated_data ?? "").trim();
  return associatedData === "refund";
}

/**
 * 解析回调体
 *
 * 不是合法 JSON → 抛错(调用方回 400 / 401,反正不能落库)。
 */
export function parseNotifyPayload(rawBody: string): WechatNotifyPayload {
  const parsed = JSON.parse(rawBody) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("回调体不是 JSON 对象");
  }
  return parsed as WechatNotifyPayload;
}

/**
 * 解密 `resource` —— **通用**
 *
 * 解出来是明文 JSON 字符串。解密失败(密钥不对 / 报文被改过)→ 抛错。
 *
 * 付款通知和退款通知的密文结构**完全一样**(AES-256-GCM),只是明文里的字段
 * 不同 ⇒ 解密这一步**只写一份**,字段的解读交给上面两个类型。
 */
function decryptPayload(
  resource: WechatEncryptedResource,
  apiV3Key: string
): Record<string, unknown> {
  const plaintext = decryptResource({
    ciphertext: resource.ciphertext,
    nonce: resource.nonce,
    associatedData: resource.associated_data ?? "",
    apiV3Key,
  });
  const parsed = JSON.parse(plaintext) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("解密出来的内容不是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

/**
 * 解密 `resource` —— 付款通知(交易详情)
 */
export function decryptTransaction(
  resource: WechatEncryptedResource,
  apiV3Key: string
): WechatTransaction {
  return decryptPayload(resource, apiV3Key) as WechatTransaction;
}

/**
 * 解密 `resource` —— 退款通知(退款单详情)
 */
export function decryptRefund(
  resource: WechatEncryptedResource,
  apiV3Key: string
): WechatRefund {
  return decryptPayload(resource, apiV3Key) as WechatRefund;
}

/**
 * 处理一条回调
 *
 * 验签 → 解密 → 判断状态 → 落库。**验签不过绝不落库**。
 *
 * 抛错 = 「这次处理挂了」(比如 DB 写失败)—— 调用方应该回 5xx 让微信重投。
 * 不抛错但 `verified: false` = 「签名不对 / 解不开」—— 调用方回 401。
 *
 * ## 为什么**两个模式**的凭据都试一遍
 *
 * 拨沙箱开关的瞬间可能有**在途付款**:切到沙箱时,一笔**正式**订单的通知到了
 * ⇒ 用沙箱公钥验不过 ⇒ **真钱收了但订单不标已付**(钱收了、货没开工)。
 *
 * ⇒ 先用当前模式的凭据验,验不过再试另一个模式的。**另一套验不过就照旧
 * 拒绝** —— 只是多试一次,**不放松任何校验**。
 */
export async function handleWechatNotify(params: {
  rawBody: string;
  headers: Headers;
  /** 当前时间(秒)—— 传进来是为了可测 */
  nowSeconds: number;
}): Promise<WechatNotifyOutcome> {
  // 当前模式那一份排在前面;另一档没配好就自动跳过。
  const configs = await getWechatPayConfigs();
  const headers = readNotifyHeaders(params.headers);

  const { timestamp, nonce, signature, serial } = headers;

  // ---- 1. 四个头缺一个都不行 ----
  if (!timestamp || !nonce || !signature) {
    return {
      verified: false,
      orderNo: null,
      transactionId: null,
      tradeState: null,
      settled: false,
      reason: "缺少验签需要的请求头",
    };
  }

  // ---- 2. 时间戳容差(防重放) ----
  if (!isTimestampWithinTolerance(timestamp, params.nowSeconds)) {
    return {
      verified: false,
      orderNo: null,
      transactionId: null,
      tradeState: null,
      settled: false,
      reason: "时间戳超出容差,可能是重放",
    };
  }

  // ---- 3. 解析回调体 ----
  //
  // 解析**不涉及信任** —— 真正拿来落库的字段要到验签过了才动。
  let payload: WechatNotifyPayload;
  try {
    payload = parseNotifyPayload(params.rawBody);
  } catch {
    return {
      verified: false,
      orderNo: null,
      transactionId: null,
      tradeState: null,
      settled: false,
      reason: "回调体不是合法 JSON",
    };
  }

  const resource = payload.resource;
  if (!resource) {
    return {
      verified: false,
      orderNo: null,
      transactionId: null,
      tradeState: null,
      settled: false,
      reason: "回调体里没有 resource",
    };
  }

  // ---- 4. 验签:找出「哪几份配置的公钥能验过这张通知」 ----
  //
  // 两个模式都试 —— 当前模式那一份排在前面。
  const verifying: WechatPayConfig[] = [];
  for (const config of configs) {
    const publicKeyPem = resolveVerifyPublicKey(config, serial);
    if (!publicKeyPem) continue;
    const verified = verifyNotifySignature({
      timestamp,
      nonce,
      rawBody: params.rawBody,
      signature,
      publicKeyPem,
    });
    if (verified) verifying.push(config);
  }

  if (verifying.length === 0) {
    return {
      verified: false,
      orderNo: null,
      transactionId: null,
      tradeState: null,
      settled: false,
      reason:
        configs.length === 0 ? "两个模式都没配好,没有验签用的公钥" : "验签失败",
    };
  }

  // ---- 5. 解密:用「验过了的那几份配置」的 APIv3 密钥 ----
  //
  // APIv3 密钥跟公钥是**配套**的(同一套商户凭据)⇒ 哪把公钥验过了,就用
  // 那份配置的密钥解。解不开就换下一把。
  //
  // 解密这一步**不分付款 / 退款** —— 密文结构一样,分流放在解密之后。
  let plaintext: Record<string, unknown> | null = null;
  let usedConfig: WechatPayConfig | null = null;
  for (const config of verifying) {
    try {
      plaintext = decryptPayload(resource, config.apiV3Key);
      usedConfig = config;
      break;
    } catch {
      // 换下一把密钥再试
    }
  }

  if (!plaintext || !usedConfig) {
    return {
      verified: false,
      orderNo: null,
      transactionId: null,
      tradeState: null,
      settled: false,
      reason: "解密失败",
    };
  }

  // ---- 5.5 退款通知走**另一个分支** ----
  //
  // 微信的退款结果通知跟付款通知**用同一个 `notify_url`** ⇒ 同一个端点,
  // 按 `event_type` 分流。
  if (isWechatRefundNotify(payload)) {
    return handleWechatRefundNotify({
      refund: plaintext as WechatRefund,
      config: usedConfig,
    });
  }

  const transaction = plaintext as WechatTransaction;
  const orderNo = (transaction.out_trade_no ?? "").trim();
  const transactionId = (transaction.transaction_id ?? "").trim();
  const tradeState = (transaction.trade_state ?? "").trim();

  // ---- 6. 商户号 / appid 对不上 → 不是我们这一笔 ----
  //
  // 跟**解密用的那份配置**比 —— 不是跟「当前模式」比:在途付款那一笔可能是
  // 另一个模式的凭据签发的。
  if (transaction.mchid && transaction.mchid !== usedConfig.mchId) {
    return {
      verified: true,
      orderNo: orderNo || null,
      transactionId: transactionId || null,
      tradeState: tradeState || null,
      settled: false,
      reason: "mchid 与当前配置不一致,忽略",
    };
  }
  if (transaction.appid && transaction.appid !== usedConfig.appId) {
    return {
      verified: true,
      orderNo: orderNo || null,
      transactionId: transactionId || null,
      tradeState: tradeState || null,
      settled: false,
      reason: "appid 与当前配置不一致,忽略",
    };
  }

  // ---- 7. 没有订单号 → 认不出来,当无事发生 ----
  if (!orderNo) {
    return {
      verified: true,
      orderNo: null,
      transactionId: transactionId || null,
      tradeState: tradeState || null,
      settled: false,
      reason: "通知里没有 out_trade_no",
    };
  }

  // ---- 8. 只有 SUCCESS 才算付款成功 ----
  if (tradeState !== "SUCCESS") {
    return {
      verified: true,
      orderNo,
      transactionId: transactionId || null,
      tradeState: tradeState || null,
      settled: false,
      reason: `交易状态 ${tradeState || "(空)"} 还不是付款成功`,
    };
  }

  // ---- 9. 落库 ----
  const result = await settleByOrderNo({
    orderNo,
    action: "mark_paid",
    channel: "wechat",
    providerOrderId: transactionId || null,
  });

  return {
    verified: true,
    orderNo,
    transactionId: transactionId || null,
    tradeState,
    settled: result.changed,
    reason: result.reason ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/*  退款通知                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 处理一条**退款结果**通知
 *
 * ## 微信的三个退款事件
 *
 * | `event_type` | 意思 | 我们怎么办 |
 * |---|---|---|
 * | `REFUND.SUCCESS` | 钱退到了 | **落库**(申请单 → `refunded`,订单 → `payment_status = refunded`) |
 * | `REFUND.ABNORMAL` | 退不了,需要人工处理 | 只记平台状态,申请单**留在 `approved`** 等工作室处理 |
 * | `REFUND.CLOSED` | 退款单关掉了,钱**没退** | 申请单 → `rejected`(带备注),买家能重新申请 |
 *
 * ## 怎么找到对应的退款申请
 *
 * **`out_refund_no` 就是退款申请行的 `id`** —— 后台点「执行退款」时我们把它
 * 当**幂等键**发给微信(支付宝那边叫 `out_request_no`)。⇒ 拿它直接查
 * `refund_request`。
 *
 * ## 找不到申请单 ⇒ **什么都不改**
 *
 * 工作室在微信商户后台**手工**退款时,`out_refund_no` 是他自己填的 ⇒ 我们
 * 没有对应的申请行。
 *
 * ⇒ 这种通知**只记一条日志**,不动本地状态。那条钱走工作室自己在后台点
 * 「标记已退款」的路子 —— **不在这里自动改订单的收款状态**:
 * 一条认不出出处的通知就改「已退款」,那是资损。
 */
async function handleWechatRefundNotify(params: {
  refund: WechatRefund;
  config: WechatPayConfig;
}): Promise<WechatNotifyOutcome> {
  const { refund, config } = params;

  const orderNo = (refund.out_trade_no ?? "").trim();
  const outRefundNo = (refund.out_refund_no ?? "").trim();
  const refundId = (refund.refund_id ?? "").trim();
  const refundStatus = (refund.refund_status ?? "").trim();

  // ---- 1. 商户号对不上 → 不是我们这一笔 ----
  if (refund.mchid && refund.mchid !== config.mchId) {
    return {
      verified: true,
      orderNo: orderNo || null,
      transactionId: (refund.transaction_id ?? "").trim() || null,
      tradeState: refundStatus || null,
      settled: false,
      reason: "mchid 与当前配置不一致,忽略",
    };
  }

  // ---- 2. 没有订单号 → 认不出来 ----
  if (!orderNo) {
    return {
      verified: true,
      orderNo: null,
      transactionId: (refund.transaction_id ?? "").trim() || null,
      tradeState: refundStatus || null,
      settled: false,
      reason: "退款通知里没有 out_trade_no",
    };
  }

  // ---- 3. 没有幂等键 → 认不出是哪一笔退款 ----
  if (!outRefundNo) {
    return {
      verified: true,
      orderNo,
      transactionId: (refund.transaction_id ?? "").trim() || null,
      tradeState: refundStatus || null,
      settled: false,
      reason: "退款通知里没有 out_refund_no",
    };
  }

  // ---- 4. 找申请单 ----
  const request = await getRefundRequestById(outRefundNo);
  if (!request) {
    logger.warn(
      { orderNo, outRefundNo, refundId, refundStatus },
      "[wechat] 收到一条认不出出处的退款通知 —— 本地不动,让工作室自己在后台处理"
    );
    return {
      verified: true,
      orderNo,
      transactionId: (refund.transaction_id ?? "").trim() || null,
      tradeState: refundStatus || null,
      settled: false,
      reason: "找不到对应的退款申请单(可能是工作室在商户后台手工退的款)",
    };
  }

  // 实际退款金额(分)—— 微信给的是分
  const refundedCents =
    typeof refund.amount?.refund === "number"
      ? refund.amount.refund
      : request.amountCents;

  // ---- 5. 钱退到了 → 落库 ----
  if (refundStatus === "SUCCESS") {
    const landed = await landRefundOutcome({
      refundRequestId: request.id,
      orderNo: request.orderNo,
      orderKind: request.orderKind,
      channel: "wechat",
      refundedCents,
      providerRefundId: refundId || null,
      providerStatus: refundStatus,
      note: "微信退款结果通知",
      actor: "admin",
    });

    return {
      verified: true,
      orderNo: request.orderNo,
      transactionId: (refund.transaction_id ?? "").trim() || null,
      tradeState: refundStatus,
      settled: landed.ok,
      reason: landed.ok
        ? landed.changed
          ? "退款已落库"
          : "退款已经是这个状态了(重复通知)"
        : `退款落库失败:${landed.code}`,
    };
  }

  // ---- 6. 钱没退 —— 只记平台状态,申请单**留在原地** ----
  //
  // `ABNORMAL` 是「退不了、需要人工处理」⇒ 不能当成「退掉了」,也不能当成
  // 「明确退不了」—— 工作室可能重试。申请单留在 `approved`,后台能看到平台
  // 的原文。
  //
  // `CLOSED` 是「退款单关掉了」⇒ 钱**确定**没退 ⇒ 申请单写掉成 `rejected`
  // (带备注),买家才能重新申请一条。
  await recordRefundProviderOutcome({
    refundRequestId: request.id,
    providerRefundId: refundId || null,
    providerRefundStatus: refundStatus,
    refundError:
      refundStatus === "CLOSED"
        ? "微信退款单已关闭,款项没有退回"
        : `微信退款状态:${refundStatus || "(空)"}`,
  });

  if (refundStatus === "CLOSED") {
    const transition = await transitionRefundStatus({
      refundRequestId: request.id,
      toStatus: "rejected",
      note: "微信退款单已关闭(CLOSED),款项没有退回 —— 工作室可以重新发起退款",
      actor: "admin",
      providerRefundId: refundId || null,
      providerRefundStatus: refundStatus,
    });
    if (!transition.ok) {
      logger.warn(
        { err: transition.code, refundRequestId: request.id },
        "[wechat] 退款单关了,但申请单写不掉"
      );
    }
  }

  return {
    verified: true,
    orderNo: request.orderNo,
    transactionId: (refund.transaction_id ?? "").trim() || null,
    tradeState: refundStatus,
    settled: false,
    reason: `退款状态 ${refundStatus || "(空)"} —— 钱还没退到`,
  };
}
