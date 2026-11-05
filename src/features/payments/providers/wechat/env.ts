/**
 * 微信支付 V3(Native 扫码)配置 —— 环境变量
 *
 * ## 需要的环境变量
 *
 * `.env.example` 被 gitignore 挡掉了(见 [[env-example-is-gitignored]]),
 * 所以变量说明写在这里 —— 改这份文档比改一个没人看的 .env.example 更容易
 * 被看到。
 *
 * | 变量 | 必填 | 说明 |
 *---|---|---|
 * | `WECHAT_PAY_MCH_ID` | 是 | 商户号(微信支付商户平台 → 产品中心 → 商户信息) |
 * | `WECHAT_PAY_APP_ID` | 是 | 绑定的公众号 / 小程序 / APP 的 appid |
 * | `WECHAT_PAY_API_V3_KEY` | 是 | APIv3 密钥(**32 字节**),用于解回调密文 |
 * | `WECHAT_PAY_SERIAL_NO` | 是 | 商户 API 证书序列号 —— 请求签名头里的 `serial_no` |
 * | `WECHAT_PAY_PRIVATE_KEY` | 是* | 商户 API 证书**私钥** PEM。允许把换行写成 `\n` 挤成一行 |
 * | `WECHAT_PAY_PRIVATE_KEY_PATH` | 是* | 商户私钥文件路径 —— `WECHAT_PAY_PRIVATE_KEY` 没配时用这个 |
 * | `WECHAT_PAY_PUBLIC_KEY` | 验回调要** | **微信支付公钥** PEM(公钥模式)—— 拿来验回调签名 |
 * | `WECHAT_PAY_PUBLIC_KEY_ID` | 验回调要** | 微信支付公钥 ID(公钥模式)—— 对应回调头里的 `Wechatpay-Serial` |
 * | `WECHAT_PAY_PLATFORM_CERT_DIR` | 验回调要** | 平台证书目录,里面 `<序列号>.pem` 一个证书一个文件 —— 公钥模式没配时的兜底 |
 * | `WECHAT_PAY_NOTIFY_URL` | 否 | 回调地址,不配就用站点地址拼 `/api/webhooks/wechat` |
 *
 * `*` 私钥两个来源二选一,**`WECHAT_PAY_PRIVATE_KEY` 优先**。
 *
 * ## 两套验签模式,别搞混
 *
 * 微信支付 V3 验回调签名有两种公钥来源:
 *
 * 1. **微信支付公钥模式**(2024 起的新模式)—— 微信支付直接给你一把固定的
 *    公钥,配 `WECHAT_PAY_PUBLIC_KEY` + `WECHAT_PAY_PUBLIC_KEY_ID`。
 *    回调头里的 `Wechatpay-Serial` 装的是**公钥 ID**,不是证书序列号。
 * 2. **平台证书模式**(老模式)—— 微信签发平台证书,会**定期轮换**。证书文件
 *    放在 `WECHAT_PAY_PLATFORM_CERT_DIR` 里,一个序列号一个 `<序列号>.pem`。
 *    回调头里的 `Wechatpay-Serial` 装的是**平台证书序列号**。
 *
 * 代码里两条都认:先按 `Wechatpay-Serial` 在证书目录里找,找不到再退到公钥
 * 模式。**公钥模式没配时,证书目录是唯一的验签来源** —— 只配了公钥但没配
 * 目录,或者只配了目录没配公钥,都算「验签材料不齐」。
 *
 * ## 金额单位
 *
 * 本仓库内部一律**分**,微信 Native 的 `amount.total` 也是**分**(整数)。
 * 不用浮点(见 `payments/lib/money.ts`)。
 *
 * ## 缺配置时的行为
 *
 * 抛 `PaymentNotConfiguredError` —— 这个错误跟「这次调用挂了」是两件不同的
 * 事:重试**没用**,得先把环境变量配上(见 `storefront/lib/payment-issue.ts`
 * 里那套分类)。所以「通道配好了没」用一个单独的 `isWechatPayConfigured()`
 * 回答,界面据此决定要不要把「微信支付」这个选项显示出来。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PaymentNotConfiguredError } from "@/features/payments/lib/types";

import { normalizePemKey } from "./signature";

/** 微信支付 API 根地址 */
export const WECHAT_PAY_API_BASE = "https://api.mch.weixin.qq.com";

/** 异步通知路由(挂在站点地址后面) */
export const WECHAT_PAY_NOTIFY_PATH = "/api/webhooks/wechat";

/**
 * 微信支付通道的完整配置
 *
 * `publicKeyPem` / `platformCertDir` 允许是 `null` —— 「显式配了没有」和
 * 「压根不知道」是两回事,调用方要能分辨(两套验签模式各管一套)。
 */
export interface WechatPayConfig {
  /** 商户号 */
  mchId: string;
  /** 绑定的 appid */
  appId: string;
  /** APIv3 密钥(32 字节)—— 解回调密文用 */
  apiV3Key: string;
  /** 商户 API 证书序列号 —— 请求签名头里的 `serial_no` */
  serialNo: string;
  /** 商户 API 证书私钥(PEM,已规范化换行) */
  privateKeyPem: string;
  /** 微信支付公钥(PEM,已规范化换行)—— 公钥模式验回调用 */
  publicKeyPem: string | null;
  /** 微信支付公钥 ID —— 公钥模式下回调头 `Wechatpay-Serial` 装的是它 */
  publicKeyId: string | null;
  /** 平台证书目录 —— 公钥模式没配时的验签来源 */
  platformCertDir: string | null;
  /** 异步通知地址(绝对 URL) */
  notifyUrl: string;
}

/** 去掉尾部斜杠 —— 拼路径时 `//api/...` 会 404 */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * 站点地址
 *
 * 优先 `NEXT_PUBLIC_APP_URL`,其次 `BETTER_AUTH_URL`。两个通常一样。
 * 都没有就返 `null`(不是抛错 —— 调用方决定这算不算「配好了」)。
 */
function readSiteUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return null;
  return stripTrailingSlash(raw);
}

/** 商户号 */
function readMchId(): string {
  const raw = process.env.WECHAT_PAY_MCH_ID?.trim();
  if (!raw) {
    throw new PaymentNotConfiguredError(
      "wechat",
      "微信支付未配置：请在环境变量中设置 WECHAT_PAY_MCH_ID"
    );
  }
  return raw;
}

/** appid */
function readAppId(): string {
  const raw = process.env.WECHAT_PAY_APP_ID?.trim();
  if (!raw) {
    throw new PaymentNotConfiguredError(
      "wechat",
      "微信支付未配置：请在环境变量中设置 WECHAT_PAY_APP_ID"
    );
  }
  return raw;
}

/**
 * APIv3 密钥
 *
 * 长度必须正好 32 字节 —— 不对的话解回调一定失败,而报错是「解密失败」,
 * 不会提示你密钥填错了。所以这里就把它拦住。
 */
function readApiV3Key(): string {
  const raw = process.env.WECHAT_PAY_API_V3_KEY?.trim();
  if (!raw) {
    throw new PaymentNotConfiguredError(
      "wechat",
      "微信支付未配置：请在环境变量中设置 WECHAT_PAY_API_V3_KEY（APIv3 密钥，32 字节）"
    );
  }
  if (Buffer.byteLength(raw, "utf8") !== 32) {
    throw new PaymentNotConfiguredError(
      "wechat",
      `微信支付未配置：WECHAT_PAY_API_V3_KEY 必须是 32 字节，现在是 ${Buffer.byteLength(raw, "utf8")} 字节`
    );
  }
  return raw;
}

/** 商户 API 证书序列号 */
function readSerialNo(): string {
  const raw = process.env.WECHAT_PAY_SERIAL_NO?.trim();
  if (!raw) {
    throw new PaymentNotConfiguredError(
      "wechat",
      "微信支付未配置：请在环境变量中设置 WECHAT_PAY_SERIAL_NO（商户 API 证书序列号）"
    );
  }
  return raw;
}

/**
 * 商户 API 证书私钥
 *
 * 两个来源:`WECHAT_PAY_PRIVATE_KEY`(内联,允许 `\n` 转义)优先,
 * 没有再用 `WECHAT_PAY_PRIVATE_KEY_PATH` 指向的文件。
 */
function readPrivateKey(): string {
  const inline = process.env.WECHAT_PAY_PRIVATE_KEY?.trim();
  if (inline) return normalizePemKey(inline);

  const filePath = process.env.WECHAT_PAY_PRIVATE_KEY_PATH?.trim();
  if (filePath) {
    try {
      return normalizePemKey(readFileSync(filePath, "utf8"));
    } catch {
      throw new PaymentNotConfiguredError(
        "wechat",
        `微信支付未配置：读取商户私钥文件失败(${filePath})`
      );
    }
  }

  throw new PaymentNotConfiguredError(
    "wechat",
    "微信支付未配置：请设置 WECHAT_PAY_PRIVATE_KEY(或 WECHAT_PAY_PRIVATE_KEY_PATH)"
  );
}

/** 微信支付公钥(公钥模式)—— 没配就是 `null` */
function readPublicKey(): string | null {
  const raw = process.env.WECHAT_PAY_PUBLIC_KEY?.trim();
  return raw ? normalizePemKey(raw) : null;
}

/** 微信支付公钥 ID(公钥模式)—— 没配就是 `null` */
function readPublicKeyId(): string | null {
  const raw = process.env.WECHAT_PAY_PUBLIC_KEY_ID?.trim();
  return raw ? raw : null;
}

/** 平台证书目录 —— 没配就是 `null` */
function readPlatformCertDir(): string | null {
  const raw = process.env.WECHAT_PAY_PLATFORM_CERT_DIR?.trim();
  return raw ? raw : null;
}

/**
 * 异步通知地址
 *
 * 显式配了就是它;没配就拿站点地址拼 `/api/webhooks/wechat`。
 *
 * 两者都没有 → 抛「没配好」—— 通知地址是绝对的,拼不出来就等于这个通道
 * 收不到钱,不能算「配好了」。
 */
function readNotifyUrl(siteUrl: string | null): string {
  const explicit = process.env.WECHAT_PAY_NOTIFY_URL?.trim();
  if (explicit) return explicit;

  if (!siteUrl) {
    throw new PaymentNotConfiguredError(
      "wechat",
      `微信支付未配置：请设置 WECHAT_PAY_NOTIFY_URL，或者 NEXT_PUBLIC_APP_URL / BETTER_AUTH_URL(用来拼${WECHAT_PAY_NOTIFY_PATH})`
    );
  }
  return `${siteUrl}${WECHAT_PAY_NOTIFY_PATH}`;
}

/**
 * 通道配好了没
 *
 * 「配好了」的判据 = **建得出支付会话 + 收得到通知 + 验得了签**:
 * 商户号、appid、APIv3 密钥、证书序列号、私钥、通知地址、验签材料都得有。
 *
 * 界面据此决定要不要显示「微信支付」这个选项 —— 让用户点一个注定失败的
 * 按钮,比不给他这个选项更糟。
 */
export function isWechatPayConfigured(): boolean {
  try {
    getWechatPayConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * 完整配置 —— 缺什么就抛什么
 *
 * 抛 `PaymentNotConfiguredError`,调用方能把它跟「这次调用挂了」分开
 * (见 `storefront/lib/payment-issue.ts`)。
 */
export function getWechatPayConfig(): WechatPayConfig {
  const siteUrl = readSiteUrl();

  const publicKeyPem = readPublicKey();
  const publicKeyId = readPublicKeyId();
  const platformCertDir = readPlatformCertDir();

  // 验签材料:公钥模式(公钥 + 公钥 ID)或者平台证书目录,至少有一套。
  //
  // 两套都要的话回调验签时按 `Wechatpay-Serial` 先找证书、找不到再退公钥。
  const hasPublicKeyMode = publicKeyPem !== null && publicKeyId !== null;
  const hasCertMode = platformCertDir !== null;
  if (!hasPublicKeyMode && !hasCertMode) {
    throw new PaymentNotConfiguredError(
      "wechat",
      "微信支付未配置：请设置 WECHAT_PAY_PUBLIC_KEY + WECHAT_PAY_PUBLIC_KEY_ID（公钥模式），或者 WECHAT_PAY_PLATFORM_CERT_DIR（平台证书目录）—— 没有验签材料就验不了回调"
    );
  }

  return {
    mchId: readMchId(),
    appId: readAppId(),
    apiV3Key: readApiV3Key(),
    serialNo: readSerialNo(),
    privateKeyPem: readPrivateKey(),
    publicKeyPem,
    publicKeyId,
    platformCertDir,
    notifyUrl: readNotifyUrl(siteUrl),
  };
}

/**
 * 按回调头里的 `Wechatpay-Serial` 找验签用的公钥
 *
 * 两种模式,按优先级:
 *
 * 1. **微信支付公钥模式** —— 公钥模式下 `Wechatpay-Serial` 装的是**公钥 ID**
 *    (不是证书序列号)。跟 `WECHAT_PAY_PUBLIC_KEY_ID` 对得上就用这把公钥。
 * 2. **平台证书目录** —— `Wechatpay-Serial` 是平台证书序列号,去
 *    `WECHAT_PAY_PLATFORM_CERT_DIR` 里找 `<序列号>.pem`。证书是 X.509,
 *    `createPublicKey` 能直接抽出里面的公钥。
 *
 * 公钥模式**没配**时,平台证书目录是唯一的验签来源(反过来也一样:
 * 目录没配就只有公钥能用)。两个都没命中 → 返回 `null`(验不过,路由回 401)。
 */
export function resolveVerifyPublicKey(
  config: WechatPayConfig,
  serial: string | null
): string | null {
  const wanted = (serial ?? "").trim();

  // 1. 微信支付公钥模式 —— 序列号对得上(或者回调压根没带序列号)就用它
  if (config.publicKeyPem && config.publicKeyId) {
    if (!wanted || wanted === config.publicKeyId) {
      return config.publicKeyPem;
    }
  }

  // 2. 平台证书目录 —— 按序列号找 `<序列号>.pem`
  if (config.platformCertDir && wanted) {
    const certPath = join(config.platformCertDir, `${wanted}.pem`);
    try {
      if (existsSync(certPath)) {
        return normalizePemKey(readFileSync(certPath, "utf8"));
      }
    } catch {
      // 读不到就当没有
    }
  }

  // 3. 只配了公钥、序列号又对不上 —— 也就这一把钥匙可用,用它
  //
  // 公钥模式下微信支付给的是**一把固定的公钥**,没有轮换问题,所以序列号
  // 对不上不代表这把钥匙是错的 —— 真正的把关在验签那一步(签不过就是
  // 签不过),不在这里。
  if (config.publicKeyPem) {
    return config.publicKeyPem;
  }

  return null;
}
