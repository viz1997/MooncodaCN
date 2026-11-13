/**
 * 微信支付 Native(扫码)下单 —— `POST /v3/pay/transactions/native`
 *
 * ## 沙箱模式下 path 变了 —— 而 path **要进签名**
 *
 * 微信沙箱跟正式**同一个 host**(`api.mch.weixin.qq.com`),区别只在路径
 * 前缀(`/sandboxnew/v3/pay/transactions/native`)。⚠️ **签名串里带的是
 * path** —— 沙箱前缀漏了就是 `SIGN_ERROR`。
 *
 * ⇒ 这个文件里**签名和 fetch 用的是同一个变量**(`params.nativePath`),
 * 结构上不可能不一致。
 *
 * ## 这条通道干什么
 *
 * 用户点「微信支付」→ 本仓库调微信下单接口拿到一个 `code_url`
 * (`weixin://wxpay/bizpayurl?pr=…`)→ 前端把它渲染成二维码 → 用户扫码付钱。
 *
 * **不跳任何页面** —— 这是微信 Native 跟支付宝「电脑网站支付」最大的区别。
 *
 * ## 请求签名
 *
 * 微信 V3 的签名跟支付宝完全不是一套(见 `signature.ts` 的文件头):
 *
 * ```
 * HTTP方法\nURL路径+query\n时间戳\n随机串\n请求体\n
 * ```
 *
 * 签名 = RSA-SHA256(上面这串, 商户私钥),base64,放进 `Authorization` 头。
 *
 * ## body 的字节必须跟签名对得上
 *
 * 请求体先 `JSON.stringify` 成**一个字符串**,签名用这个字符串,发送也用
 * 这个字符串。签名完再 `JSON.stringify` 一次的话,键序可能不一样,签名就
 * 对不上了(报错是 `SIGN_ERROR`,不报错就是下单一直失败)。
 *
 * ## 金额
 *
 * `amount.total` 是**分**(整数)。折后单价已经是最终价 —— 阶梯折扣在算价
 * 那一层就折过了,通道不参与定价(见 `payments/lib/types.ts`)。
 *
 * ## 失败怎么分类
 *
 * - **没配好**(缺环境变量 / 缺后台配的沙箱凭据)→ `PaymentNotConfiguredError`,
 *   重试没用
 * - **这次调用挂了**(网络 / 微信返回错误)→ `PaymentProviderError`,重试有意义
 *
 * 微信返回的错误体是 `{ code, message }`,比如 `PARAM_ERROR` /
 * `NO_AUTH` / `REQUEST_SIGNATURE_ERROR` / `ORDERPAID`(单号已被用)。
 * 这些都归到「这次调用挂了」—— 但 message 里要带上微信的 code,不然排查
 * 的时候只能猜。
 */

import { randomUUID } from "node:crypto";
import { PRICE_CURRENCY } from "@/config/currency";
import type { WechatPayConfig } from "./env";

import {
  buildAuthorizationHeader,
  buildSignMessage,
  signWithPrivateKey,
} from "./signature";

/** Native 下单的接口路径(正式模式;签名时用它,不带域名) */
export const WECHAT_NATIVE_PATH = "/v3/pay/transactions/native";

/**
 * 微信对 `description` 的长度上限
 *
 * 超了微信直接报 `PARAM_ERROR`。截断时留个尾巴的省略号,让人知道被砍过。
 */
export const WECHAT_DESCRIPTION_MAX_LENGTH = 127;

/** 下单请求的参数 */
export interface WechatNativeOrderParams {
  /** 商户号 —— 也可以从 config 里取,这里显式传是为了测试好写 */
  mchId: string;
  /** appid */
  appId: string;
  /** 商户 API 证书序列号 */
  serialNo: string;
  /** 商户私钥 PEM */
  privateKeyPem: string;
  /** 我们的订单号(`out_trade_no`)—— 微信侧 ≤32 字符 */
  outTradeNo: string;
  /** 商品描述(微信页面上显示的那行字) */
  description: string;
  /** 应付总额(分) */
  totalCents: number;
  /** 异步通知地址 */
  notifyUrl: string;
  /**
   * API 根地址(不带路径)
   *
   * 沙箱跟正式**同一个 host** —— 区别在 `nativePath`。
   */
  apiBase: string;
  /**
   * Native 下单路径
   *
   * ⚠️ **这个 path 会进签名串** —— 所以它必须跟发请求时用的那个**一模一样**。
   * 沙箱模式下它是 `/sandboxnew/v3/pay/transactions/native`(可配)。
   *
   * ⇒ 签名和 fetch **用的是同一个变量** —— 结构上不可能不一致
   * (改一处忘了另一处 = `SIGN_ERROR`)。
   */
  nativePath: string;
}

/** 下单成功的结果 */
export interface WechatNativeOrderResult {
  /**
   * 二维码内容 —— `weixin://wxpay/bizpayurl?pr=…`
   *
   * 前端拿它渲染二维码。**不是图片 URL**,是一段字符串。
   */
  codeUrl: string;
}

/**
 * 拼商品描述
 *
 * 微信限制 127 字符,超了截断。空描述微信会拒,所以兜底给个「订单付款」。
 */
export function buildDescription(text: string): string {
  const trimmed = text.trim();
  const base = trimmed.length > 0 ? trimmed : "订单付款";
  if (base.length <= WECHAT_DESCRIPTION_MAX_LENGTH) return base;
  return `${base.slice(0, WECHAT_DESCRIPTION_MAX_LENGTH - 1)}…`;
}

/** 微信的错误体 */
interface WechatErrorBody {
  code?: string;
  message?: string;
}

/**
 * 下单请求的**原始**结果
 *
 * ## 为什么把 HTTP 状态单独拎出来
 *
 * 自检脚本(`scripts/payment-sandbox-check.ts`)要靠**返回码**判断「这个
 * 沙箱路径存不存在」:
 *
 * | 状态 | 意思 |
 * |---|---|
 * | `200` | 路径对了,单子建出来了 |
 * | `400` | 路径对了,卡在参数 |
 * | `401` / `403` | 路径大概对了,卡在验签 |
 * | `404` | **路径不存在** ⇒ 换下一个候选 |
 *
 * 微信返回的错误体里只有 `code` / `message`,**没有 HTTP 状态** ⇒ 光看
 * `code` 分不出「404 了」和「400 了」。
 *
 * ⇒ `createNativeOrder` 只管「成功 / 抛错」;**原始结果**由这个函数给。
 */
export interface WechatNativeOrderResponse {
  /**
   * HTTP 状态码
   *
   * **`0` = 网络层就挂了**(根本没拿到 HTTP 响应)。
   */
  status: number;
  /** 是不是 2xx */
  ok: boolean;
  /** 响应原文 */
  text: string;
  /** 响应是不是合法 JSON */
  parsed: boolean;
  /** 微信错误体里的 `code`(响应不是 JSON 时是 `null`) */
  code: string | null;
  /** 微信错误体里的 `message`(响应不是 JSON 时是 `null`) */
  message: string | null;
  /** 成功时的 `code_url` —— 失败时是 `null` */
  codeUrl: string | null;
}

/**
 * 发一次下单请求 —— **返回原始结果,不抛**
 *
 * 跟 `createNativeOrder` 的区别只有一个:**它不抛错**。
 *
 * - 网络失败 → `status: 0`,`message` 里是网络错误
 * - HTTP 非 2xx → `status` 是真实状态码,`code` / `message` 是微信给的那两个
 * - 2xx → `codeUrl` 是那个 `code_url`
 *
 * 签名和 URL **都跟 `createNativeOrder` 用的是同一段代码**(`params.nativePath`
 * 同一个变量)⇒ 探针打出去的请求跟生产链路**逐字节一致**,不会「探针通了但
 * 生产签名是错的」。
 */
export async function postNativeOrderRequest(
  params: WechatNativeOrderParams
): Promise<WechatNativeOrderResponse> {
  // body 先拼成字符串 —— 签名和发送用的是同一份字节
  const body = JSON.stringify({
    appid: params.appId,
    mchid: params.mchId,
    description: params.description,
    out_trade_no: params.outTradeNo,
    notify_url: params.notifyUrl,
    amount: {
      total: params.totalCents,
      // 币种跟本仓库的价走(人民币)。微信支付 V3 Native 的境内商户就是收
      // 人民币的 —— 不用开跨境资质,也不用换算(本仓库的代码里没有汇率,
      // 见 CLAUDE.md)。
      currency: PRICE_CURRENCY,
    },
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomNonce();

  const signature = signWithPrivateKey(
    buildSignMessage({
      method: "POST",
      // ⚠️ 签名用的是**请求要发的那个 path** —— 沙箱前缀必须带上,
      // 否则微信验签必挂(`SIGN_ERROR`)。跟下面的 fetch 用的是同一个变量。
      url: params.nativePath,
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
    // 同一个 `params.nativePath` —— 签名串里的 path 跟发请求的 path 不可能
    // 不一致。
    response = await fetch(`${params.apiBase}${params.nativePath}`, {
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
    // 网络层就挂了 —— 不是 HTTP 错误(status = 0)
    return {
      status: 0,
      ok: false,
      text: "",
      parsed: false,
      code: null,
      message: error instanceof Error ? error.message : String(error),
      codeUrl: null,
    };
  }

  const text = await response.text();

  // 响应是不是合法 JSON —— 两处都要用(错误体 + 成功体)
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
    return {
      status: response.status,
      ok: false,
      text,
      parsed,
      code: errorBody.code ?? null,
      message: errorBody.message ?? null,
      codeUrl: null,
    };
  }

  const codeUrl =
    parsed && typeof payload === "object" && payload !== null
      ? ((payload as { code_url?: string }).code_url ?? null)
      : null;

  return {
    status: response.status,
    ok: true,
    text,
    parsed,
    code: null,
    message: null,
    codeUrl,
  };
}

/**
 * 下单
 *
 * 成功返回 `code_url`;失败抛错(带上微信的 code/message)。
 *
 * 这里抛的是**普通** `Error` —— 分类(「没配好」还是「这次调用挂了」)由
 * 通道层 `index.ts` 做,因为只有它知道配置的事。
 *
 * ## 报错文案一个字都没改
 *
 * 这四条消息(网络失败 / 非 2xx / 不是 JSON / 没有 `code_url`)是**生产链路**
 * 的报错 —— 工作室排障时看到的就是它们。⇒ 抽出来的 `postNativeOrderRequest`
 * 只负责「拿到原始结果」,判断仍然留在这儿。
 */
export async function createNativeOrder(
  params: WechatNativeOrderParams
): Promise<WechatNativeOrderResult> {
  const res = await postNativeOrderRequest(params);

  // 网络层就挂了(压根没拿到 HTTP 响应)
  if (res.status === 0) {
    throw new Error(`微信下单请求失败：${res.message ?? "网络错误"}`);
  }

  if (!res.ok) {
    const code = res.code ?? `HTTP_${res.status}`;
    const message = res.message ?? res.text.slice(0, 200);
    throw new Error(`微信下单失败(${code}):${message}`);
  }

  if (!res.parsed) {
    throw new Error("微信下单失败:响应不是合法 JSON");
  }

  if (!res.codeUrl) {
    throw new Error("微信下单失败:响应里没有 code_url");
  }

  return { codeUrl: res.codeUrl };
}

/**
 * 随机串
 *
 * 微信要求 32 位以内的随机字符串。用 `randomUUID()`(36 位)超了一点,
 * 所以去掉分隔符再截到 32 位。
 */
function randomNonce(): string {
  return randomUUID().replace(/-/g, "").slice(0, 32);
}

/**
 * 按配置下单
 *
 * `native.ts` 里那个函数是纯参数化的;这个是「从配置里取」的版本,
 * 通道实现(`index.ts`)用这个。
 */
export async function createNativeOrderWithConfig(
  config: WechatPayConfig,
  params: {
    outTradeNo: string;
    description: string;
    totalCents: number;
  }
): Promise<WechatNativeOrderResult> {
  return createNativeOrder({
    mchId: config.mchId,
    appId: config.appId,
    serialNo: config.serialNo,
    privateKeyPem: config.privateKeyPem,
    outTradeNo: params.outTradeNo,
    description: params.description,
    totalCents: params.totalCents,
    notifyUrl: config.notifyUrl,
    // 端点跟签名**同源** —— 配置里那一份,原样传下去
    apiBase: config.apiBase,
    nativePath: config.nativePath,
  });
}
