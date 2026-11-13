/**
 * 支付宝「电脑网站支付」配置 —— **正式模式**读环境变量 + **纯组装函数**
 *
 * ## 需要的环境变量(正式模式)
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
 * | `ALIPAY_GATEWAY` | 否 | 网关地址,默认正式环境 |
 * | `ALIPAY_NOTIFY_URL` | 否 | 异步通知地址,不配就用站点地址拼 `/api/webhooks/alipay` |
 * | `ALIPAY_RETURN_URL` | 否 | 同步回跳地址,不配就用请求里的 `successUrl`,再没有就拼 `/checkout/success` |
 *
 * `*` 私钥两个来源二选一,**`ALIPAY_APP_PRIVATE_KEY` 优先**。
 *
 * ## 沙箱模式读的是**数据库**,不是环境变量
 *
 * 沙箱凭据在后台 `/admin/payment-settings` 配(存在 `payment_setting` 表)。
 * 读那一半在 **`config.ts`** —— 这个文件**保持零 DB import**,这样:
 *
 * - 纯函数 `buildAlipayConfig()` 能进 `unit` project 跑单测
 * - 正式模式的取值(`readAlipayProductionValues()`)不依赖数据库能不能连上
 *
 * ## 支付宝有**两套**沙箱
 *
 * | 沙箱 | 网关 | APPID |
 * |---|---|---|
 * | **新**(当前官方) | `openapi-sandbox.dl.alipaydev.com` | 新沙箱应用 |
 * | **旧**(legacy) | `openapi.alipaydev.com` | 旧沙箱应用 |
 *
 * **APPID 完全不通用** —— 用新沙箱的 APPID 打旧网关会返回 `40002
 * invalid-app-id`,反过来也一样。⇒ 沙箱网关**必须可配**(见 `sandbox.ts`)。
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
 * 事:重试**没用**,得先把配置配上(见 `storefront/lib/payment-issue.ts`
 * 里那套分类)。所以「通道配好了没」用一个单独的 `isAlipayConfigured()`
 * 回答,界面据此决定要不要把「支付宝」这个选项显示出来。
 */

import { readFileSync } from "node:fs";
import {
  ALIPAY_PRODUCTION_GATEWAY,
  ALIPAY_SANDBOX_GATEWAY,
  ALIPAY_SANDBOX_GATEWAY_LEGACY,
  PAYMENT_SETTING_KEYS,
  type PaymentRuntimeMode,
} from "@/features/payments/lib/sandbox";
import { PaymentNotConfiguredError } from "@/features/payments/lib/types";

import { normalizePemKey } from "./sign";

/** 正式环境网关 */
export const ALIPAY_DEFAULT_GATEWAY = ALIPAY_PRODUCTION_GATEWAY;

/**
 * 沙箱网关(当前官方那套)
 *
 * ⚠️ 支付宝有**两套**沙箱,**APPID 不通用** —— 旧的在这儿:
 * `ALIPAY_SANDBOX_GATEWAY_LEGACY`。两个常量都从 `sandbox.ts` 来
 * (那边是**唯一**的定义处)。
 */
export { ALIPAY_SANDBOX_GATEWAY, ALIPAY_SANDBOX_GATEWAY_LEGACY };

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
  /** 网关地址(沙箱 / 正式 —— 已经过冲突校验) */
  gateway: string;
  /** 异步通知地址(绝对 URL) */
  notifyUrl: string;
  /** 同步回跳地址 —— 显式配了就是它,没配是 `null` */
  returnUrl: string | null;
  /** 站点地址 —— 用来拼默认的 notify / return 地址 */
  siteUrl: string | null;
  /**
   * 现在跑在**沙箱**还是**正式**
   *
   * 界面上要挂「沙箱」徽章 —— 真收钱的那条路上必须一眼看得出来。
   */
  sandbox: boolean;
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
export function readAlipaySiteUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return null;
  return stripTrailingSlash(raw);
}

/**
 * 组装支付宝的完整配置 —— **纯函数**,缺什么就抛什么
 *
 * ## 为什么是纯函数
 *
 * 值从哪儿来(DB / 环境变量)是 `config.ts` 的事;这里只负责「拿到值之后,
 * 组装 + 校验」。⇒ 这段逻辑能进 `unit` project 跑单测,不用起数据库。
 *
 * ## 值用**沙箱那一套的键名**索引
 *
 * 两个模式的同一个字段用同一个 key ⇒ 沙箱和正式**共用这一段组装逻辑**,
 * 少一个能漂掉的地方(见 `sandbox.ts` 的键空间说明)。
 */
export function buildAlipayConfig(input: {
  /** 生效的模式 —— 决定 `sandbox` 标志 + 报错文案 */
  mode: PaymentRuntimeMode;
  /** 各字段的值(按 `PAYMENT_SETTING_KEYS.alipaySandbox*` 索引) */
  values: Record<string, string>;
  /** 网关地址 —— **已经过**沙箱/正式冲突校验(见 `resolveAlipayEndpoint`) */
  gateway: string;
  /** 站点地址 —— 用来拼默认的通知地址 */
  siteUrl: string | null;
  /** 显式配的回跳地址 —— 没配就是 `null` */
  returnUrl: string | null;
}): AlipayConfig {
  const { mode, values } = input;
  const label = mode === "sandbox" ? "支付宝沙箱" : "支付宝";
  const source =
    mode === "sandbox" ? "后台「支付宝」那一页" : "环境变量 ALIPAY_*";

  const appId = (values[PAYMENT_SETTING_KEYS.alipaySandboxAppId] ?? "").trim();
  if (!appId) {
    throw new PaymentNotConfiguredError(
      "alipay",
      `${label}未配置：缺 APPID(${source})`
    );
  }

  const privateKeyRaw = (
    values[PAYMENT_SETTING_KEYS.alipaySandboxAppPrivateKey] ?? ""
  ).trim();
  if (!privateKeyRaw) {
    throw new PaymentNotConfiguredError(
      "alipay",
      `${label}未配置：缺应用私钥(PEM,${source})`
    );
  }

  // 注意:是**支付宝公钥**,不是应用公钥 —— 拿来验支付宝的通知签名。
  const publicKeyRaw = (
    values[PAYMENT_SETTING_KEYS.alipaySandboxPublicKey] ?? ""
  ).trim();
  if (!publicKeyRaw) {
    throw new PaymentNotConfiguredError(
      "alipay",
      `${label}未配置：缺支付宝公钥(PEM,不是应用公钥,${source})`
    );
  }

  // 通知地址:显式配了就是它,没配就拿站点地址拼。
  //
  // 两者都没有 → 抛「没配好」—— 通知地址是绝对的,拼不出来就等于这个通道
  // 收不到钱,不能算「配好了」。
  const notifyUrlRaw = (
    values[PAYMENT_SETTING_KEYS.alipaySandboxNotifyUrl] ?? ""
  ).trim();
  let notifyUrl = notifyUrlRaw;
  if (!notifyUrl) {
    if (!input.siteUrl) {
      throw new PaymentNotConfiguredError(
        "alipay",
        `${label}未配置：请设置通知地址,或者 NEXT_PUBLIC_APP_URL / BETTER_AUTH_URL(用来拼${ALIPAY_NOTIFY_PATH})`
      );
    }
    notifyUrl = `${input.siteUrl}${ALIPAY_NOTIFY_PATH}`;
  }

  return {
    appId,
    appPrivateKey: normalizePemKey(privateKeyRaw),
    alipayPublicKey: normalizePemKey(publicKeyRaw),
    gateway: input.gateway,
    notifyUrl,
    returnUrl: input.returnUrl,
    siteUrl: input.siteUrl,
    sandbox: mode === "sandbox",
  };
}

/* -------------------------------------------------------------------------- */
/*  正式模式取值(不抛错)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 应用私钥 —— **不抛错**的那一版
 *
 * 跟正式的读取一个路子(内联优先、`_PATH` 兜底),读不到就返空串。
 */
function readAppPrivateKeySafe(): string {
  const inline = process.env.ALIPAY_APP_PRIVATE_KEY?.trim();
  if (inline) return inline;

  const filePath = process.env.ALIPAY_APP_PRIVATE_KEY_PATH?.trim();
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * **正式模式**的环境变量取值 —— **不抛错**,缺就是空串
 *
 * ## 为什么要在 `env.ts` 里读这一份
 *
 * 后台那一页要并排显示「沙箱模式缺什么 / 正式模式缺什么」,还要检测
 * 「沙箱凭据跟正式凭据**同值**」(大概率是贴错了)。⇒ 需要一份**不抛错**的
 * 正式模式取值 —— `buildAlipayConfig()` 抛的是「配错了」,那两个用途都
 * 用不上。
 *
 * ## 键空间:用**沙箱那一套的键名**
 *
 * 两个模式的同一个字段用**同一个 key** ⇒ 缺字段诊断只写一遍
 * (见 `sandbox.ts` 的 `describeMissingFields`)。
 *
 * ⚠️ **这里只判断「有没有值」,不做校验** —— 「支付宝公钥是不是合法 PEM」
 * 这种校验在 `buildAlipayConfig()` 里(那是收钱的链路,该拦就拦)。
 */
export function readAlipayProductionValues(): Record<string, string> {
  return {
    [PAYMENT_SETTING_KEYS.alipaySandboxGateway]:
      process.env.ALIPAY_GATEWAY?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.alipaySandboxNotifyUrl]:
      process.env.ALIPAY_NOTIFY_URL?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.alipaySandboxAppId]:
      process.env.ALIPAY_APP_ID?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.alipaySandboxAppPrivateKey]: readAppPrivateKeySafe(),
    [PAYMENT_SETTING_KEYS.alipaySandboxPublicKey]:
      process.env.ALIPAY_PUBLIC_KEY?.trim() ?? "",
  };
}
