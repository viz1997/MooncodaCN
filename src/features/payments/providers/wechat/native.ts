/**
 * 微信支付 Native(扫码)下单 —— `POST /v3/pay/transactions/native`
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
 * - **没配好**(缺环境变量)→ `PaymentNotConfiguredError`,重试没用
 * - **这次调用挂了**(网络 / 微信返回错误)→ `PaymentProviderError`,重试有意义
 *
 * 微信返回的错误体是 `{ code, message }`,比如 `PARAM_ERROR` /
 * `NO_AUTH` / `REQUEST_SIGNATURE_ERROR` / `ORDERPAID`(单号已被用)。
 * 这些都归到「这次调用挂了」—— 但 message 里要带上微信的 code,不然排查
 * 的时候只能猜。
 */

import { randomUUID } from "node:crypto";
import { PRICE_CURRENCY } from "@/config/currency";
import { WECHAT_PAY_API_BASE, type WechatPayConfig } from "./env";

import {
  buildAuthorizationHeader,
  buildSignMessage,
  signWithPrivateKey,
} from "./signature";

/** Native 下单的接口路径(签名时用它,不带域名) */
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
 * 下单
 *
 * 成功返回 `code_url`;失败抛错(带上微信的 code/message)。
 *
 * 这里抛的是**普通** `Error` —— 分类(「没配好」还是「这次调用挂了」)由
 * 通道层 `index.ts` 做,因为只有它知道配置的事。
 */
export async function createNativeOrder(
  params: WechatNativeOrderParams
): Promise<WechatNativeOrderResult> {
  // body 先拼成字符串 —— 签名和发送用的是同一份字节
  const body = JSON.stringify({
    appid: params.appId,
    mchid: params.mchId,
    description: params.description,
    out_trade_no: params.outTradeNo,
    notify_url: params.notifyUrl,
    amount: {
      total: params.totalCents,
      // 币种跟本仓库的价走(美元)。**境内商户只能收人民币** —— 走微信这一路
      // 需要开通**跨境微信支付**(境外商户),否则微信会拒掉这笔单。
      // 不在这里换算 —— 本仓库的代码里没有汇率(见 CLAUDE.md)。
      currency: PRICE_CURRENCY,
    },
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomNonce();

  const signature = signWithPrivateKey(
    buildSignMessage({
      method: "POST",
      url: WECHAT_NATIVE_PATH,
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
    response = await fetch(`${WECHAT_PAY_API_BASE}${WECHAT_NATIVE_PATH}`, {
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
      `微信下单请求失败：${error instanceof Error ? error.message : String(error)}`
    );
  }

  const text = await response.text();

  if (!response.ok) {
    let errorBody: WechatErrorBody = {};
    try {
      errorBody = JSON.parse(text) as WechatErrorBody;
    } catch {
      // 微信偶尔返回非 JSON(网关错误页)—— 用原文凑合
    }
    const code = errorBody.code ?? `HTTP_${response.status}`;
    const message = errorBody.message ?? text.slice(0, 200);
    throw new Error(`微信下单失败(${code}):${message}`);
  }

  let parsed: { code_url?: string };
  try {
    parsed = JSON.parse(text) as { code_url?: string };
  } catch {
    throw new Error("微信下单失败:响应不是合法 JSON");
  }

  const codeUrl = parsed.code_url;
  if (!codeUrl) {
    throw new Error("微信下单失败:响应里没有 code_url");
  }

  return { codeUrl };
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
  });
}
