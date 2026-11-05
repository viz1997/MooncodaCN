/**
 * 支付宝「电脑网站支付」配置 —— 环境变量
 *
 * ## 需要的环境变量
 *
 * `.env.example` 被 gitignore 挡掉了(见 [[env-example-is-gitignored]]),
 * 所以变量说明写在这里 —— 改这份文档比改一个没人看的 .env.example 更容易
 * 被看到。
 *
 * | 变量 | 必填 | 说明 |
 * |---|---|---|
 * | `ALIPAY_APP_ID` | 是 | 应用 APPID(支付宝开放平台「开发设置」里拿) |
 * | `ALIPAY_APP_PRIVATE_KEY` | 是* | 应用**私钥** PEM(RSA2)。允许把换行写成 `\n` 挤成一行 |
 * | `ALIPAY_APP_PRIVATE_KEY_PATH` | 是* | 应用私钥文件路径 —— `ALIPAY_APP_PRIVATE_KEY` 没配时用这个 |
 * | `ALIPAY_PUBLIC_KEY` | 是 | **支付宝公钥**(验通知签名用,不是应用自己的公钥!) |
 * | `ALIPAY_GATEWAY` | 否 | 网关地址,默认正式环境;沙箱是 `https://openapi.alipaydev.com/gateway.do` |
 * | `ALIPAY_NOTIFY_URL` | 否 | 异步通知地址,不配就用站点地址拼 `/api/webhooks/alipay` |
 * | `ALIPAY_RETURN_URL` | 否 | 同步回跳地址,不配就用请求里的 `successUrl`,再没有就拼 `/checkout/success` |
 *
 * `*` 私钥两个来源二选一,**`ALIPAY_APP_PRIVATE_KEY` 优先**。
 *
 * ## 三件容易搞混的事
 *
 * 1. **`ALIPAY_PUBLIC_KEY` 是支付宝公钥**,不是应用公钥。应用公钥是给支付宝
 *    验我们的请求用的;支付宝公钥才是我们验支付宝的通知用的。填反了的话
 *    通知永远验不过 —— 而且报错是「验签失败」,不会提示你填错了。
 * 2. **金额单位**。本仓库内部一律**分**,支付宝接口要**元**。转换走
 *    `centsToAmountString()`,不用浮点(见 `payments/lib/money.ts`)。
 * 3. **应用私钥 vs 支付宝公钥 的方向**。签名用应用私钥,验签用支付宝公钥。
 *
 * ## 缺配置时的行为
 *
 * 抛 `PaymentNotConfiguredError` —— 这个错误跟「这次调用挂了」是两件不同的
 * 事:重试**没用**,得先把环境变量配上(见 `storefront/lib/payment-issue.ts`
 * 里那套分类)。所以「通道配好了没」用一个单独的 `isAlipayConfigured()`
 * 回答,界面据此决定要不要把「支付宝」这个选项显示出来。
 */

import { readFileSync } from "node:fs";

import { PaymentNotConfiguredError } from "@/features/payments/lib/types";

import { normalizePemKey } from "./sign";

/** 正式环境网关 */
export const ALIPAY_DEFAULT_GATEWAY = "https://openapi.alipay.com/gateway.do";

/** 沙箱网关 */
export const ALIPAY_SANDBOX_GATEWAY =
  "https://openapi.alipaydev.com/gateway.do";

/** 异步通知路由(挂在站点地址后面) */
export const ALIPAY_NOTIFY_PATH = "/api/webhooks/alipay";

/** 默认的同步回跳路径 */
export const ALIPAY_RETURN_PATH = "/checkout/success";

/**
 * 支付宝通道的完整配置
 *
 * `returnUrl` / `siteUrl` 允许是 `null` —— 「显式配了没有」和「压根不知道
 * 站点地址」是两回事,调用方要能分辨。
 */
export interface AlipayConfig {
  /** 应用 APPID */
  appId: string;
  /** 应用私钥(PEM,已规范化换行) */
  appPrivateKey: string;
  /** 支付宝公钥(PEM,已规范化换行)—— 验通知签名用 */
  alipayPublicKey: string;
  /** 网关地址 */
  gateway: string;
  /** 异步通知地址(绝对 URL) */
  notifyUrl: string;
  /** 同步回跳地址 —— 显式配了就是它,没配是 `null` */
  returnUrl: string | null;
  /** 站点地址 —— 用来拼默认的 notify / return 地址 */
  siteUrl: string | null;
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

/** 应用 APPID */
function readAppId(): string {
  const raw = process.env.ALIPAY_APP_ID?.trim();
  if (!raw) {
    throw new PaymentNotConfiguredError(
      "alipay",
      "支付宝未配置：请在环境变量中设置 ALIPAY_APP_ID"
    );
  }
  return raw;
}

/**
 * 应用私钥
 *
 * 两个来源:`ALIPAY_APP_PRIVATE_KEY`(内联,允许 `\n` 转义)优先,
 * 没有再用 `ALIPAY_APP_PRIVATE_KEY_PATH` 指向的文件。
 */
function readAppPrivateKey(): string {
  const inline = process.env.ALIPAY_APP_PRIVATE_KEY?.trim();
  if (inline) return normalizePemKey(inline);

  const filePath = process.env.ALIPAY_APP_PRIVATE_KEY_PATH?.trim();
  if (filePath) {
    try {
      return normalizePemKey(readFileSync(filePath, "utf8"));
    } catch {
      throw new PaymentNotConfiguredError(
        "alipay",
        `支付宝未配置：读取应用私钥文件失败(${filePath})`
      );
    }
  }

  throw new PaymentNotConfiguredError(
    "alipay",
    "支付宝未配置：请设置 ALIPAY_APP_PRIVATE_KEY(或 ALIPAY_APP_PRIVATE_KEY_PATH)"
  );
}

/**
 * 支付宝公钥
 *
 * 注意:是**支付宝公钥**,不是应用公钥 —— 拿来验支付宝的通知签名。
 */
function readAlipayPublicKey(): string {
  const raw = process.env.ALIPAY_PUBLIC_KEY?.trim();
  if (!raw) {
    throw new PaymentNotConfiguredError(
      "alipay",
      "支付宝未配置：请在环境变量中设置 ALIPAY_PUBLIC_KEY（支付宝公钥，不是应用公钥）"
    );
  }
  return normalizePemKey(raw);
}

/** 网关地址 —— 默认正式环境 */
function readGateway(): string {
  const raw = process.env.ALIPAY_GATEWAY?.trim();
  return raw ? raw : ALIPAY_DEFAULT_GATEWAY;
}

/**
 * 异步通知地址
 *
 * 显式配了就是它;没配就拿站点地址拼 `/api/webhooks/alipay`。
 *
 * 两者都没有 → 抛「没配好」—— 通知地址是绝对的,拼不出来就等于这个通道
 * 收不到钱,不能算「配好了」。
 */
function readNotifyUrl(siteUrl: string | null): string {
  const explicit = process.env.ALIPAY_NOTIFY_URL?.trim();
  if (explicit) return explicit;

  if (!siteUrl) {
    throw new PaymentNotConfiguredError(
      "alipay",
      `支付宝未配置：请设置 ALIPAY_NOTIFY_URL,或者 NEXT_PUBLIC_APP_URL / BETTER_AUTH_URL(用来拼${ALIPAY_NOTIFY_PATH})`
    );
  }
  return `${siteUrl}${ALIPAY_NOTIFY_PATH}`;
}

/** 显式配的回跳地址 —— 没配就是 `null` */
function readReturnUrl(): string | null {
  const raw = process.env.ALIPAY_RETURN_URL?.trim();
  return raw ? raw : null;
}

/**
 * 通道配好了没
 *
 * 「配好了」的判据 = **建得出支付会话 + 收得到通知**:
 * APPID、应用私钥、支付宝公钥、通知地址都得有。
 *
 * 界面据此决定要不要显示「支付宝」这个选项 —— 让用户点一个注定失败的按钮,
 * 比不给他这个选项更糟。
 */
export function isAlipayConfigured(): boolean {
  try {
    getAlipayConfig();
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
export function getAlipayConfig(): AlipayConfig {
  const siteUrl = readSiteUrl();

  return {
    appId: readAppId(),
    appPrivateKey: readAppPrivateKey(),
    alipayPublicKey: readAlipayPublicKey(),
    gateway: readGateway(),
    notifyUrl: readNotifyUrl(siteUrl),
    returnUrl: readReturnUrl(),
    siteUrl,
  };
}
