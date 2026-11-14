/**
 * 微信支付 V3 签名与回调解密 —— **纯函数**
 *
 * (不碰网络、不碰 DB、不读 env —— 能进 `unit` project 跑测试)
 *
 * ## 请求签名怎么算
 *
 * 微信 V3 的请求签名跟支付宝那套完全不同 —— 不是「参数排序 + 拼 kv」,
 * 而是把**整个请求**拼成一个字符串再签一次:
 *
 * ```
 * HTTP方法\n
 * URL路径与查询字符串\n
 * 时间戳\n
 * 随机串\n
 * 请求报文主体\n
 * ```
 *
 * 五个部分之间用 `\n` 分隔,**末尾还有一个 `\n`**(body 为空时就是连续两个
 * 换行 —— 少一个微信就报 `SIGN_ERROR`)。
 *
 * 签名 = `RSA-SHA256(上面这个字符串, 商户私钥)`,再 base64,放进
 * `Authorization` 头:
 *
 * ```
 * WECHATPAY2-SHA256-RSA2048 mchid="…",nonce_str="…",signature="…",timestamp="…",serial_no="…"
 * ```
 *
 * ## 三个容易踩的坑
 *
 * 1. **签名用的 body 必须跟发出去的字节完全一致**。所以请求体先
 *    `JSON.stringify` 成一个字符串,签名用这个字符串,发送也用这个字符串 ——
 *    不能签完再 `JSON.stringify` 一次(键序可能不一样)。
 * 2. **URL 只取路径 + 查询串**,不带域名(`/v3/pay/transactions/native`)。
 * 3. **时间戳是秒**,不是毫秒。
 *
 * ## 回调解密怎么算
 *
 * 回调体里的是**密文**,不是明文:
 *
 * ```json
 * { "resource": { "algorithm": "AEAD_AES_256_GCM", "ciphertext": "…", "nonce": "…", "associated_data": "…" } }
 * ```
 *
 * - key = APIv3 密钥(32 字节)
 * - iv/nonce = `resource.nonce`
 * - 附加认证数据 = `resource.associated_data`
 * - `ciphertext` base64 解码后,**最后 16 字节是 GCM 的认证标签**,
 *   前面那些才是真正的密文
 *
 * 解出来是明文 JSON:`{ mchid, appid, out_trade_no, transaction_id, trade_state, … }`。
 *
 * ## 为什么单独一个文件
 *
 * 签名和解密是这一条通道里最容易出错、又最难肉眼 review 出来的地方
 * (换行、末尾换行、body 字节、authTag 切分)。拆成纯函数,能进 `unit`
 * project 跑测试 —— 钉住「改一个字节就验不过」「authTag 切错就解不出来」
 * 这些不变量。
 */

import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

import {
  inspectPrivateKeyPem,
  inspectPublicKeyPem,
  normalizePemText,
} from "../../lib/pem";
import { PaymentNotConfiguredError } from "../../lib/types";

/** 微信 V3 只有这一种签名算法 */
export const WECHAT_SIGN_TYPE = "WECHATPAY2-SHA256-RSA2048";

/** AES-GCM 的认证标签长度(字节) —— 密文最后这么多字节是 tag */
export const WECHAT_GCM_AUTH_TAG_LENGTH = 16;

/** APIv3 密钥长度(字节) */
export const WECHAT_API_V3_KEY_LENGTH = 32;

/**
 * 回调时间戳容差(秒)
 *
 * 超过这个时间差的回调一律拒 —— 防重放(攻击者截获一条旧通知重放)。
 */
export const WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * 规范化 PEM
 *
 * 环境变量里一行写不下完整私钥,惯例是把换行写成 `\n`。这里还原成真换行。
 *
 * 顺带补上结尾换行 —— PEM 规范要求最后一行带换行,缺了有些解析器会挑食。
 *
 * **实现搬到 `lib/pem.ts`** —— 支付宝那一套以前也有一份一模一样的。
 */
export function normalizePemKey(raw: string): string {
  return normalizePemText(raw);
}

/* -------------------------------------------------------------------------- */
/*  请求签名                                                                   */
/* -------------------------------------------------------------------------- */

/** 拼请求签名用的参数 */
export interface WechatSignMessageParams {
  /** HTTP 方法,大写(POST) */
  method: string;
  /** URL 路径 + 查询串,**不带域名** */
  url: string;
  /** 时间戳(秒) */
  timestamp: string;
  /** 随机串 */
  nonce: string;
  /** 请求报文主体(原始字符串)—— GET 时是空串 */
  body: string;
}

/**
 * 拼待签字符串
 *
 * `HTTP方法\nURL\n时间戳\n随机串\n请求体\n` —— **末尾的换行别丢**。
 */
export function buildSignMessage(params: WechatSignMessageParams): string {
  return [
    params.method,
    params.url,
    params.timestamp,
    params.nonce,
    params.body,
    "",
  ].join("\n");
}

/**
 * 用**商户私钥**签名(RSA-SHA256),返回 base64
 *
 * ## 私钥不对 ⇒ 抛 `PaymentNotConfiguredError`(不是 `PaymentProviderError`)
 *
 * 跟支付宝那一套**同一个口径**(见 `providers/alipay/sign.ts` 的说明):
 * 先体检(`lib/pem.ts`)→ 能修的当场修 → 修不了 ⇒ 「配错了」
 * (`PAYMENT_NOT_CONFIGURED`,重试没用)。
 */
export function signWithPrivateKey(
  message: string,
  privateKeyPem: string
): string {
  const inspection = inspectPrivateKeyPem(privateKeyPem);
  if (!inspection.usable || !inspection.pem) {
    throw new PaymentNotConfiguredError(
      "wechat",
      `微信商户私钥不可用:${inspection.detail}`
    );
  }
  const key = createPrivateKey(inspection.pem);
  return sign("RSA-SHA256", Buffer.from(message, "utf8"), key).toString(
    "base64"
  );
}

/**
 * 用**微信支付公钥**验签(RSA-SHA256)
 *
 * 公钥可以有两种形态,`createPublicKey` 都认:
 *
 * - 微信支付公钥模式 —— `-----BEGIN PUBLIC KEY-----`
 * - 平台证书模式 —— `-----BEGIN CERTIFICATE-----`(X.509,节点能直接抽出公钥)
 *
 * 任何异常(公钥不合法 / signature 不是合法 base64)都当「验不过」,不往外抛 ——
 * 验签失败只是一个布尔结果,不该变成 500。
 */
export function verifyWithPublicKey(
  message: string,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    const inspection = inspectPublicKeyPem(publicKeyPem);
    if (!inspection.usable || !inspection.pem) return false;
    const key = createPublicKey(inspection.pem);
    return verify(
      "RSA-SHA256",
      Buffer.from(message, "utf8"),
      key,
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

/** 拼 `Authorization` 头的参数 */
export interface WechatAuthorizationParams {
  /** 商户号 */
  mchId: string;
  /** 随机串 */
  nonce: string;
  /** base64 签名 */
  signature: string;
  /** 时间戳(秒) */
  timestamp: string;
  /** 商户 API 证书序列号 */
  serialNo: string;
}

/**
 * 拼 `Authorization` 头
 *
 * 头名跟参数之间是**空格**,参数之间是**逗号** —— 写成逗号微信会报
 * `SIGN_ERROR`(头解析不出来)。
 */
export function buildAuthorizationHeader(
  params: WechatAuthorizationParams
): string {
  const fields = [
    `mchid="${params.mchId}"`,
    `nonce_str="${params.nonce}"`,
    `signature="${params.signature}"`,
    `timestamp="${params.timestamp}"`,
    `serial_no="${params.serialNo}"`,
  ].join(",");
  return `${WECHAT_SIGN_TYPE} ${fields}`;
}

/* -------------------------------------------------------------------------- */
/*  回调                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 拼回调验签的待签字符串
 *
 * `时间戳\n随机串\n原始报文主体\n` —— 报文主体是**原始字节**,
 * 不是 `JSON.parse` 之后再序列化回去的(键序、空格都可能不一样)。
 */
export function buildNotifyVerifyMessage(
  timestamp: string,
  nonce: string,
  rawBody: string
): string {
  return `${timestamp}\n${nonce}\n${rawBody}\n`;
}

/**
 * 验回调签名
 *
 * 一步到位:拼待签字符串 + 验签。公钥不合法 / 签名不是 base64 → false。
 */
export function verifyNotifySignature(params: {
  timestamp: string;
  nonce: string;
  rawBody: string;
  signature: string;
  publicKeyPem: string;
}): boolean {
  const message = buildNotifyVerifyMessage(
    params.timestamp,
    params.nonce,
    params.rawBody
  );
  return verifyWithPublicKey(message, params.signature, params.publicKeyPem);
}

/**
 * 时间戳在容差内吗
 *
 * 超过容差(默认 5 分钟)一律拒 —— 防重放。
 *
 * 时间戳不是数字 → false。
 */
export function isTimestampWithinTolerance(
  timestamp: string,
  nowSeconds: number,
  toleranceSeconds: number = WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS
): boolean {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(nowSeconds - parsed) <= toleranceSeconds;
}

/** 回调里加密的那块资源 */
export interface WechatEncryptedResource {
  /** 加密算法 —— 微信 V3 只有 `AEAD_AES_256_GCM` */
  algorithm: string;
  /** base64 密文(末尾 16 字节是 GCM 认证标签) */
  ciphertext: string;
  /** 随机串 —— 用作 GCM 的 iv */
  nonce: string;
  /**
   * 附加认证数据
   *
   * 微信大多数场景是 `"transaction"`,但**可能整个字段都不带** —— 所以是可选的。
   * 没带就当空 AAD(跟「带一个空的 AAD」在 GCM 里等价)。
   */
  associated_data?: string;
}

/**
 * 解密回调里的资源
 *
 * AES-256-GCM:
 *
 * - key = APIv3 密钥(32 字节)
 * - iv = `resource.nonce`
 * - AAD = `resource.associated_data`
 * - `ciphertext` base64 解码后,**最后 16 字节是认证标签**,前面是密文
 *
 * 返回解出来的明文 JSON 字符串。
 *
 * 密钥长度不对 / 密文太短 / 认证标签对不上(报文被改过)→ 抛错。
 */
export function decryptResource(params: {
  ciphertext: string;
  nonce: string;
  associatedData: string;
  apiV3Key: string;
}): string {
  const key = Buffer.from(params.apiV3Key, "utf8");
  if (key.length !== WECHAT_API_V3_KEY_LENGTH) {
    throw new Error(
      `APIv3 密钥必须是 ${WECHAT_API_V3_KEY_LENGTH} 字节,现在是 ${key.length} 字节`
    );
  }

  const raw = Buffer.from(params.ciphertext, "base64");
  if (raw.length <= WECHAT_GCM_AUTH_TAG_LENGTH) {
    throw new Error("密文长度不对:比认证标签还短");
  }

  const authTag = raw.subarray(raw.length - WECHAT_GCM_AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(0, raw.length - WECHAT_GCM_AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(params.nonce, "utf8")
  );
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(params.associatedData, "utf8"));

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}
