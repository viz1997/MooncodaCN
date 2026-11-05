/**
 * 支付宝查单(`alipay.trade.query`)
 *
 * ## 为什么需要查单
 *
 * 用户付完钱会跳回我们的 `return_url`,但**浏览器带回来的参数不能信** ——
 * 那只是「用户跳回来了」,不是「钱到了」。谁都能自己拼一个
 * `?out_trade_no=SO-…&trade_status=TRADE_SUCCESS` 出来。
 *
 * 所以同步回跳之后要**反查支付宝**:拿我们自己的订单号去问支付宝「这单到底
 * 付了没」。查单请求是我们用应用私钥签的,支付宝认;响应是支付宝用支付宝
 * 公钥签的 —— 这才可信。
 *
 * ## 跟异步通知的关系
 *
 * 异步通知(`webhook.ts`)才是**收钱**的依据 —— 它是支付宝主动推过来的,
 * 不会因为用户关页面而丢。查单只是「同步回跳时给用户一个准信」的手段。
 * 两个都会跑到,`settleByOrderNo()` 本身幂等,重跑无害。
 *
 * ## 接口
 *
 * `POST https://openapi.alipay.com/gateway.do`,表单编码:
 * `app_id` / `method=alipay.trade.query` / `sign_type=RSA2` / `timestamp` /
 * `version` / `biz_content={"out_trade_no":"…"}` / `sign`。
 *
 * 响应(JSON)长这样:
 * ```json
 * {
 *   "alipay_trade_query_response": {
 *     "code": "10000",
 *     "msg": "Success",
 *     "trade_no": "2026110522001…",
 *     "out_trade_no": "SO-20261105-ABCDEF",
 *     "trade_status": "TRADE_SUCCESS",
 *     "total_amount": "24.30"
 *   },
 *   "sign": "…"
 * }
 * ```
 */

import { PaymentProviderError } from "@/features/payments/lib/types";

import { type AlipayConfig, getAlipayConfig } from "./env";
import { formatAlipayTimestamp } from "./page-pay";
import { buildSignContent, signContent, verifySign } from "./sign";

/** 查单接口名 */
export const ALIPAY_QUERY_METHOD = "alipay.trade.query";

/** 查单响应的内层对象 */
interface AlipayQueryResponseBody {
  alipay_trade_query_response?: {
    code?: string;
    msg?: string;
    out_trade_no?: string;
    trade_no?: string;
    trade_status?: string;
    total_amount?: string;
  };
  sign?: string;
}

/** 查单结果 */
export interface AlipayTradeQueryResult {
  /** 查到了吗(`code === "10000"`) */
  ok: boolean;
  /** 我们的订单号 */
  outTradeNo: string | null;
  /** 支付宝的订单号 */
  tradeNo: string | null;
  /** 交易状态(`TRADE_SUCCESS` / `TRADE_CLOSED` / …) */
  tradeStatus: string | null;
  /** 实付金额(元) */
  totalAmount: string | null;
  /** 响应签名验过了吗 */
  verified: boolean;
  /** 失败原因 / 提示 */
  message: string | null;
}

/**
 * 抠出原始响应体里某个顶层字段的**原文片段**
 *
 * 验响应签名要用**原文** —— 重新 `JSON.stringify` 一次的话,数字格式
 * (`1.0` vs `1`)、键顺序都可能跟支付宝签名时用的原文不一样,签名就废了。
 *
 * 只处理顶层对象值(`{…}`)—— 支付宝的响应里需要验签的就是那一个内层对象。
 */
function extractRawObject(raw: string, key: string): string | null {
  const marker = `"${key}"`;
  const markerIndex = raw.indexOf(marker);
  if (markerIndex === -1) return null;

  let cursor = markerIndex + marker.length;
  while (cursor < raw.length && raw[cursor] !== ":") cursor++;
  cursor++; // 跳过冒号
  while (cursor < raw.length && /\s/.test(raw[cursor] ?? "")) cursor++;

  if (raw[cursor] !== "{") return null;

  let depth = 0;
  let inString = false;
  for (let i = cursor; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") {
        i++; // 跳过被转义的字符
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(cursor, i + 1);
    }
  }
  return null;
}

/**
 * 查单
 *
 * @param outTradeNo 我们的订单号
 * @param config 配置 —— 不传就从环境变量读(没配好会抛
 *   `PaymentNotConfiguredError`)
 */
export async function queryTradeByOrderNo(
  outTradeNo: string,
  config?: AlipayConfig
): Promise<AlipayTradeQueryResult> {
  const effectiveConfig = config ?? getAlipayConfig();

  const params: Record<string, string> = {
    app_id: effectiveConfig.appId,
    method: ALIPAY_QUERY_METHOD,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify({ out_trade_no: outTradeNo }),
  };

  const content = buildSignContent(params, "request");
  const signature = signContent(content, effectiveConfig.appPrivateKey);
  const body = new URLSearchParams({ ...params, sign: signature });

  let raw: string;
  try {
    const response = await fetch(effectiveConfig.gateway, {
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
        `支付宝查单失败:HTTP ${response.status}`
      );
    }
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("alipay", "支付宝查单请求失败", {
      cause: error,
    });
  }

  let parsed: AlipayQueryResponseBody;
  try {
    parsed = JSON.parse(raw) as AlipayQueryResponseBody;
  } catch (error) {
    throw new PaymentProviderError("alipay", "支付宝查单响应不是合法 JSON", {
      cause: error,
    });
  }

  const inner = parsed.alipay_trade_query_response ?? {};

  // 验响应签名 —— 用原始片段重拼待签字符串
  const rawInner = extractRawObject(raw, "alipay_trade_query_response");
  const responseSign = parsed.sign;
  const verified =
    rawInner !== null &&
    typeof responseSign === "string" &&
    verifySign(
      `alipay_trade_query_response=${rawInner}`,
      responseSign,
      effectiveConfig.alipayPublicKey
    );

  const ok = inner.code === "10000";

  return {
    ok,
    outTradeNo: inner.out_trade_no ?? null,
    tradeNo: inner.trade_no ?? null,
    tradeStatus: inner.trade_status ?? null,
    totalAmount: inner.total_amount ?? null,
    verified,
    message: ok ? null : (inner.msg ?? `支付宝返回 code=${inner.code ?? "?"}`),
  };
}
