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

import { settleByOrderNo } from "@/features/payments/lib/settle";

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
 * 解密 `resource`
 *
 * 解出来是明文 JSON 字符串。解密失败(密钥不对 / 报文被改过)→ 抛错。
 */
export function decryptTransaction(
  resource: WechatEncryptedResource,
  apiV3Key: string
): WechatTransaction {
  const plaintext = decryptResource({
    ciphertext: resource.ciphertext,
    nonce: resource.nonce,
    associatedData: resource.associated_data ?? "",
    apiV3Key,
  });
  const parsed = JSON.parse(plaintext) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("解密出来的交易详情不是 JSON 对象");
  }
  return parsed as WechatTransaction;
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
  let transaction: WechatTransaction | null = null;
  let usedConfig: WechatPayConfig | null = null;
  for (const config of verifying) {
    try {
      transaction = decryptTransaction(resource, config.apiV3Key);
      usedConfig = config;
      break;
    } catch {
      // 换下一把密钥再试
    }
  }

  if (!transaction || !usedConfig) {
    return {
      verified: false,
      orderNo: null,
      transactionId: null,
      tradeState: null,
      settled: false,
      reason: "解密失败",
    };
  }

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
