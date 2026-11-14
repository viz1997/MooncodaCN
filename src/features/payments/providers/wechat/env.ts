/**
 * 微信支付 V3(Native 扫码)配置 —— **正式模式**读环境变量 + **纯组装函数**
 *
 * ## 需要的环境变量(正式模式)
 *
 * `.env.example` 被 gitignore 挡掉了(见 [[env-example-is-gitignored]]),
 * 所以变量说明写在这里 —— 改这份文档比改一个没人看的 .env.example 更容易
 * 被看到。
 *
 * | 变量 | 必填 | 说明 |
 * |---|---|---|
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
 * ## 沙箱模式读的是**数据库**,不是环境变量
 *
 * 沙箱凭据在后台 `/admin/payment-settings` 配(存在 `payment_setting` 表)。
 * 读那一半在 **`config.ts`** —— 这个文件**保持零 DB import**,这样:
 *
 * - 纯函数 `buildWechatPayConfig()` 能进 `unit` project 跑单测
 * - 正式模式的取值(`readWechatProductionValues()`)不依赖数据库能不能连上
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
 * 事:重试**没用**,得先把配置配上(见 `storefront/lib/payment-issue.ts`
 * 里那套分类)。所以「通道配好了没」用一个单独的 `isWechatPayConfigured()`
 * 回答,界面据此决定要不要把「微信支付」这个选项显示出来 —— 让用户点一个
 * 注定失败的按钮,比不给他这个选项更糟。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAYMENT_SETTING_KEYS,
  type PaymentRuntimeMode,
  type PaymentSettingKey,
  WECHAT_PRODUCTION_API_BASE,
  WECHAT_PRODUCTION_NATIVE_PATH,
  WECHAT_PRODUCTION_REFUND_PATH,
} from "@/features/payments/lib/sandbox";
import { PaymentNotConfiguredError } from "@/features/payments/lib/types";

import { normalizePemKey } from "./signature";

/**
 * 微信支付 API 根地址 —— **正式端点,写死**
 *
 * 沙箱跟正式**同一个 host**,区别只在 path 前缀(见 `sandbox.ts` 的
 * `WECHAT_SANDBOX_NATIVE_PATH`)。
 */
export const WECHAT_PAY_API_BASE = WECHAT_PRODUCTION_API_BASE;

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
  /**
   * 现在跑在**沙箱**还是**正式**
   *
   * 界面上要挂「沙箱」徽章 —— 真收钱的那条路上必须一眼看得出来。
   */
  sandbox: boolean;
  /**
   * API 根地址
   *
   * 沙箱跟正式**同一个 host** —— 区别在 `nativePath`。
   */
  apiBase: string;
  /**
   * Native 下单路径
   *
   * ⚠️ **这个 path 要进签名串** —— 所以它必须跟发请求时用的那个**一模一样**
   * (见 `native.ts`:签名和 fetch 用的是同一个变量)。
   */
  nativePath: string;
  /**
   * **退款**路径
   *
   * ⚠️ **同样要进签名串** —— 跟 `nativePath` 一个道理(见 `refund.ts`:
   * 签名和 fetch 用的是同一个变量)。
   *
   * 正式 = 写死(`/v3/refund/domestic/refunds`);沙箱 = DB 里那个,留空就从
   * 下单路径推(见 `sandbox.ts` 的 `resolveWechatRefundPath`)。
   */
  refundPath: string;
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
export function readWechatSiteUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return null;
  return stripTrailingSlash(raw);
}

/**
 * 一条「缺了就说这句话」的字段
 *
 * 「缺了说哪句话」跟「值从哪个键取」**写在同一处** ⇒ 全量组装和下单组装
 * 报的是**同一套话**,改一边忘了另一边就会看到两套不一样的报错。
 */
interface WechatRequiredField {
  /** 值在 `values` 里的键 */
  key: PaymentSettingKey;
  /** 缺了的时候抛的那句话(整个) */
  message: (label: string, source: string) => string;
}

/**
 * 微信**下单**要的字段 —— 一份清单
 *
 * 「下单」只要这四项:商户号 / AppID / 证书序列号 / 商户私钥。
 *
 * ⚠️ **APIv3 密钥和验签材料不在这一份里** —— 它们是**回调**用的
 * (解密 + 验签),下单根本用不到。自检脚本的「路径探针」要打的正是下单
 * 请求 ⇒ 它不该被「还没配验签材料」挡住(见 `buildWechatNativeParams`)。
 */
const WECHAT_ORDER_FIELDS = {
  mchId: {
    key: PAYMENT_SETTING_KEYS.wechatSandboxMchId,
    message: (label: string, source: string) =>
      `${label}未配置：缺商户号(${source})`,
  },
  appId: {
    key: PAYMENT_SETTING_KEYS.wechatSandboxAppId,
    message: (label: string, source: string) =>
      `${label}未配置：缺 AppID(${source})`,
  },
  serialNo: {
    key: PAYMENT_SETTING_KEYS.wechatSandboxSerialNo,
    message: (label: string, source: string) =>
      `${label}未配置：缺商户 API 证书序列号(${source})`,
  },
  privateKey: {
    key: PAYMENT_SETTING_KEYS.wechatSandboxPrivateKey,
    message: (label: string, source: string) =>
      `${label}未配置：缺商户 API 证书私钥(PEM,${source})`,
  },
} satisfies Record<string, WechatRequiredField>;

/**
 * 报错文案里的两个变量 —— 模式决定
 *
 * 沙箱的凭据在后台配,正式的凭据在环境变量 ⇒ **说错了工作室就找错地方**。
 */
function wechatLabelAndSource(mode: PaymentRuntimeMode): {
  label: string;
  source: string;
} {
  return {
    label: mode === "sandbox" ? "微信沙箱" : "微信支付",
    source:
      mode === "sandbox" ? "后台「微信支付」那一页" : "环境变量 WECHAT_PAY_*",
  };
}

/** 取一个必填字段 —— 缺了就抛(文案由字段自己带) */
function requireField(
  field: WechatRequiredField,
  values: Record<string, string>,
  label: string,
  source: string
): string {
  const value = (values[field.key] ?? "").trim();
  if (!value) {
    throw new PaymentNotConfiguredError("wechat", field.message(label, source));
  }
  return value;
}

/**
 * 组装微信的完整配置 —— **纯函数**,缺什么就抛什么
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
 *
 * 抛 `PaymentNotConfiguredError`,调用方能把它跟「这次调用挂了」分开
 * (见 `storefront/lib/payment-issue.ts`)。
 */
export function buildWechatPayConfig(input: {
  /** 生效的模式 —— 决定 `sandbox` 标志 + 报错文案 */
  mode: PaymentRuntimeMode;
  /** 各字段的值(按 `PAYMENT_SETTING_KEYS.wechatSandbox*` 索引) */
  values: Record<string, string>;
  /** API 根地址(沙箱 = DB 里那个 / 正式 = 写死的) */
  apiBase: string;
  /** Native 下单路径(沙箱 = DB 里那个 / 正式 = 写死的) */
  nativePath: string;
  /**
   * 退款路径(沙箱 = DB 里那个 / 留空从下单路径推 / 正式 = 写死的)
   *
   * ⚠️ **留空是可以的** —— 调用方(`config.ts`)会用
   * `resolveWechatRefundPath()` 把空值补成推导出来的那个。
   */
  refundPath: string;
  /** 站点地址 —— 用来拼默认的通知地址 */
  siteUrl: string | null;
}): WechatPayConfig {
  const { mode, values } = input;
  const { label, source } = wechatLabelAndSource(mode);

  const mchId = requireField(WECHAT_ORDER_FIELDS.mchId, values, label, source);

  const appId = requireField(WECHAT_ORDER_FIELDS.appId, values, label, source);

  const apiV3Key = (
    values[PAYMENT_SETTING_KEYS.wechatSandboxApiV3Key] ?? ""
  ).trim();
  if (!apiV3Key) {
    throw new PaymentNotConfiguredError(
      "wechat",
      `${label}未配置：缺 APIv3 密钥(32 字节,${source})`
    );
  }
  // 长度必须正好 32 字节 —— 不对的话解回调一定失败,而报错是「解密失败」,
  // 不会提示你密钥填错了。所以这里就把它拦住。
  if (Buffer.byteLength(apiV3Key, "utf8") !== 32) {
    throw new PaymentNotConfiguredError(
      "wechat",
      `${label}未配置：APIv3 密钥必须是 32 字节，现在是 ${Buffer.byteLength(apiV3Key, "utf8")} 字节`
    );
  }

  const serialNo = requireField(
    WECHAT_ORDER_FIELDS.serialNo,
    values,
    label,
    source
  );

  const privateKeyRaw = requireField(
    WECHAT_ORDER_FIELDS.privateKey,
    values,
    label,
    source
  );

  const publicKeyRaw = (
    values[PAYMENT_SETTING_KEYS.wechatSandboxPublicKey] ?? ""
  ).trim();
  const publicKeyPem = publicKeyRaw ? normalizePemKey(publicKeyRaw) : null;
  const publicKeyId = (
    values[PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId] ?? ""
  ).trim();
  const platformCertDir = (
    values[PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir] ?? ""
  ).trim();

  // 验签材料:公钥模式(公钥 + 公钥 ID)或者平台证书目录,至少有一套。
  //
  // 两套都要的话回调验签时按 `Wechatpay-Serial` 先找证书、找不到再退公钥。
  const hasPublicKeyMode = publicKeyPem !== null && publicKeyId !== "";
  const hasCertMode = platformCertDir !== "";
  if (!hasPublicKeyMode && !hasCertMode) {
    throw new PaymentNotConfiguredError(
      "wechat",
      `${label}未配置：缺验签材料 —— 微信支付公钥 + 公钥 ID(公钥模式)或者平台证书目录,至少要有一套(${source})`
    );
  }

  // 通知地址:显式配了就是它,没配就拿站点地址拼。
  //
  // 两者都没有 → 抛「没配好」—— 通知地址是绝对的,拼不出来就等于这个通道
  // 收不到钱,不能算「配好了」。
  const notifyUrlRaw = (
    values[PAYMENT_SETTING_KEYS.wechatSandboxNotifyUrl] ?? ""
  ).trim();
  let notifyUrl = notifyUrlRaw;
  if (!notifyUrl) {
    if (!input.siteUrl) {
      throw new PaymentNotConfiguredError(
        "wechat",
        `${label}未配置：请设置通知地址,或者 NEXT_PUBLIC_APP_URL / BETTER_AUTH_URL(用来拼${WECHAT_PAY_NOTIFY_PATH})`
      );
    }
    notifyUrl = `${input.siteUrl}${WECHAT_PAY_NOTIFY_PATH}`;
  }

  return {
    mchId,
    appId,
    apiV3Key,
    serialNo,
    privateKeyPem: normalizePemKey(privateKeyRaw),
    publicKeyPem,
    publicKeyId: publicKeyId || null,
    platformCertDir: platformCertDir || null,
    notifyUrl,
    sandbox: mode === "sandbox",
    apiBase: input.apiBase,
    nativePath: input.nativePath,
    refundPath: input.refundPath,
  };
}

/**
 * 只组装**下单**要的那几项 —— **纯函数**
 *
 * ## 为什么要有这个(而不是直接用 `buildWechatPayConfig`)
 *
 * 全量配置额外要两样东西,而它们**下单时用不到**:
 *
 * - **APIv3 密钥** —— 解回调密文用的
 * - **验签材料**(微信支付公钥 / 平台证书目录)—— 验回调签名用的
 *
 * 沙箱环境里这两样**不一定拿得到**(尤其验签材料)。⇒ 自检脚本的「微信路径
 * 探针」要打的正是**下单请求** —— 拿全量配置去组参数,就会「还没配验签材料」
 * ⇒ 探针压根跑不起来 ⇒ **恰恰最需要探针的时候用不了**。
 *
 * ⇒ 这里只组下单那几项。**报错文案跟全量配置一模一样**(同一份清单,
 * `WECHAT_ORDER_FIELDS`)。
 *
 * ## 通知地址不在这里
 *
 * `notifyUrl` 由调用方给 —— 探针可以给一个占位地址(它只探路径,不会有人
 * 去付那笔单);生产链路那边由 `buildWechatPayConfig` 按站点地址拼。
 */
export interface WechatNativeParams {
  /** 商户号 */
  mchId: string;
  /** appid */
  appId: string;
  /** 商户 API 证书序列号 */
  serialNo: string;
  /** 商户私钥 PEM(已规范化换行) */
  privateKeyPem: string;
  /** API 根地址(不带路径) */
  apiBase: string;
  /** Native 下单路径 —— ⚠️ **要进签名串**,必须跟发请求时用的那个一模一样 */
  nativePath: string;
}

/**
 * 组装「下单」参数 —— 纯函数,缺什么就抛什么
 *
 * 跟 `buildWechatPayConfig` 的区别只有两个:
 *
 * 1. **不要 APIv3 密钥、不要验签材料**(见上面那段说明)
 * 2. **不要通知地址**(调用方自己给)
 */
export function buildWechatNativeParams(input: {
  /** 生效的模式 —— 只影响报错文案 */
  mode: PaymentRuntimeMode;
  /** 各字段的值(按 `PAYMENT_SETTING_KEYS.wechatSandbox*` 索引) */
  values: Record<string, string>;
  /** API 根地址(沙箱 = DB 里那个 / 正式 = 写死的) */
  apiBase: string;
  /** Native 下单路径(沙箱 = DB 里那个 / 正式 = 写死的) */
  nativePath: string;
}): WechatNativeParams {
  const { label, source } = wechatLabelAndSource(input.mode);

  const mchId = requireField(
    WECHAT_ORDER_FIELDS.mchId,
    input.values,
    label,
    source
  );
  const appId = requireField(
    WECHAT_ORDER_FIELDS.appId,
    input.values,
    label,
    source
  );
  const serialNo = requireField(
    WECHAT_ORDER_FIELDS.serialNo,
    input.values,
    label,
    source
  );
  const privateKeyPem = requireField(
    WECHAT_ORDER_FIELDS.privateKey,
    input.values,
    label,
    source
  );

  return {
    mchId,
    appId,
    serialNo,
    privateKeyPem: normalizePemKey(privateKeyPem),
    apiBase: input.apiBase,
    nativePath: input.nativePath,
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

/* -------------------------------------------------------------------------- */
/*  正式模式取值(不抛错)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 商户私钥 —— **不抛错**的那一版
 *
 * 跟正式的读取一个路子(内联优先、`_PATH` 兜底),但读不到就返空串
 * 而不是抛 —— 这一份是给「后台现状面板」用的,那儿要的是「配没配」,不是
 * 「配错了就炸」。
 */
function readPrivateKeySafe(): string {
  const inline = process.env.WECHAT_PAY_PRIVATE_KEY?.trim();
  if (inline) return inline;

  const filePath = process.env.WECHAT_PAY_PRIVATE_KEY_PATH?.trim();
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
 * 正式模式取值 —— `buildWechatPayConfig()` 抛的是「配错了」,那两个用途都
 * 用不上。
 *
 * ## 键空间:用**沙箱那一套的键名**
 *
 * 两个模式的同一个字段用**同一个 key** ⇒ 缺字段诊断只写一遍
 * (见 `sandbox.ts` 的 `describeMissingFields`)。
 *
 * ⚠️ **这里只判断「有没有值」,不做校验** —— 「APIv3 密钥是不是 32 字节」
 * 这种校验在 `buildWechatPayConfig()` 里(那是收钱的链路,该拦就拦)。
 */
export function readWechatProductionValues(): Record<string, string> {
  return {
    // 正式端点**写死** —— 这里摆出来只是让后台显示「正式模式打到的是哪儿」
    [PAYMENT_SETTING_KEYS.wechatSandboxApiBase]: WECHAT_PRODUCTION_API_BASE,
    [PAYMENT_SETTING_KEYS.wechatSandboxNativePath]:
      WECHAT_PRODUCTION_NATIVE_PATH,
    [PAYMENT_SETTING_KEYS.wechatSandboxRefundPath]:
      WECHAT_PRODUCTION_REFUND_PATH,
    [PAYMENT_SETTING_KEYS.wechatSandboxNotifyUrl]:
      process.env.WECHAT_PAY_NOTIFY_URL?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.wechatSandboxMchId]:
      process.env.WECHAT_PAY_MCH_ID?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.wechatSandboxAppId]:
      process.env.WECHAT_PAY_APP_ID?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.wechatSandboxApiV3Key]:
      process.env.WECHAT_PAY_API_V3_KEY?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.wechatSandboxSerialNo]:
      process.env.WECHAT_PAY_SERIAL_NO?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.wechatSandboxPrivateKey]: readPrivateKeySafe(),
    [PAYMENT_SETTING_KEYS.wechatSandboxPublicKey]:
      process.env.WECHAT_PAY_PUBLIC_KEY?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId]:
      process.env.WECHAT_PAY_PUBLIC_KEY_ID?.trim() ?? "",
    [PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir]:
      process.env.WECHAT_PAY_PLATFORM_CERT_DIR?.trim() ?? "",
  };
}
