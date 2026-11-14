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

import { getAlipayConfig } from "./config";
import type { AlipayConfig } from "./env";
import { formatAlipayTimestamp } from "./page-pay";
import {
  ALIPAY_TRADE_QUERY_RESPONSE_KEY,
  verifyAlipayResponseSignature,
} from "./response-sign";
import { buildSignContent, signContent } from "./sign";

/** 查单接口名 */
export const ALIPAY_QUERY_METHOD = "alipay.trade.query";

/** 支付宝把**请求**拒了时的响应节点 —— 跟查单结果那个不是一个形状 */
interface AlipayErrorResponseBody {
  code?: string;
  sub_code?: string;
  sub_msg?: string;
  msg?: string;
}

/** 查单响应的内层对象 */
interface AlipayQueryResponseBody {
  alipay_trade_query_response?: {
    code?: string;
    /** 支付宝的子错误码 —— 「查不到这笔交易」就是 `ACQ.TRADE_NOT_EXIST` */
    sub_code?: string;
    sub_msg?: string;
    msg?: string;
    out_trade_no?: string;
    trade_no?: string;
    trade_status?: string;
    total_amount?: string;
  };
  /**
   * **请求被拒**时的响应节点(APPID 不对 / 签名不对 / 参数不合法 …)
   *
   * 支付宝拒请求时**不回** `alipay_trade_query_response`,而是回这个。
   * 以前代码只认前一个 ⇒ 拒请求的时候 `code` 是空的 ⇒ 判定层把它归成
   * 「查不到这笔交易(用户没付)」—— **指错了方向**(工作室会去查用户有没有付,
   * 而真相是「我们这边的 APPID / 私钥不是一套」)。
   */
  error_response?: AlipayErrorResponseBody;
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
  /** 支付宝回的 `code`(`10000` = 成功)—— 失败时工作室照着它去查支付宝文档 */
  code: string | null;
  /** 支付宝回的 `sub_code` —— `ACQ.TRADE_NOT_EXIST` = 「还没付」 */
  subCode: string | null;
  /** 失败原因 / 提示 */
  message: string | null;
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
  const effectiveConfig = config ?? (await getAlipayConfig());

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

  const queryNode = parsed.alipay_trade_query_response;
  const errorNode = parsed.error_response;
  // 请求被拒的时候支付宝回的是 `error_response` —— 跟查单结果不是一个形状。
  // 两个节点的**错误字段**(`code` / `sub_code` / `sub_msg` / `msg`)是同名的,
  // 所以错误信息从哪个节点来都行 ⇒ 统一取 `inner`。
  const inner = queryNode ?? errorNode;

  // 验响应签名 —— **待签字符串就是内层那段 JSON 原文**
  //
  // ⚠️ **不许**在前面拼 `alipay_trade_query_response=` —— 支付宝签的是
  // 内层对象本身(官方《同步接口验签》:`open.alipay.com/200/106120`;
  // 口径见 `response-sign.ts` 的文件头)。
  //
  // 拼了那个前缀 ⇒ 每一笔查单响应都验不过 ⇒ 判定层永远落在
  // `signature_invalid` ⇒ 订单永远 `unpaid` —— 2026-11-14 线上踩过
  // (`SO-20261114-657E4A` / `SO-20261114-137332` / `SO-20261114-E58728`)。
  const verified = verifyAlipayResponseSignature({
    raw,
    key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
    signature: parsed.sign,
    alipayPublicKeyPem: effectiveConfig.alipayPublicKey,
  });

  // 查到了吗 —— **只有查单节点里 `code === "10000"` 才算查到了**
  //
  // `error_response` 节点里的 `code` 是 4 位错误码(`40002` 之类),
  // 拿它当「查到了」就是误判。
  const ok = queryNode?.code === "10000";

  // 失败时**把支付宝自己给的话原样带上**(2026-11-14)
  //
  // 原来只留 `inner.msg` —— 支付宝的 `msg` 大多是一句
  // 「Business Failed」,真正有用的是 `sub_msg`
  // (比如 `Invalid App ID`)。
  // 丢了它 ⇒ 工作室永远只知道「查不成」,不知道去改哪一项。
  //
  // `code` / `sub_code` **单独两个字段** —— 判定层要靠 `sub_code` 分
  // 「查不到」和「请求被拒」,拼进一句话就没法判了。
  const failureMessage = ok ? null : (inner?.sub_msg ?? inner?.msg ?? null);

  return {
    ok,
    // 交易那几个字段**只从查单节点取** —— `error_response` 节点里没有它们
    outTradeNo: queryNode?.out_trade_no ?? null,
    tradeNo: queryNode?.trade_no ?? null,
    tradeStatus: queryNode?.trade_status ?? null,
    totalAmount: queryNode?.total_amount ?? null,
    verified,
    code: inner?.code ?? null,
    subCode: inner?.sub_code ?? null,
    message: failureMessage,
  };
}
