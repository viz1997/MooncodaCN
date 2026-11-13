/**
 * 支付设置(沙箱)的**数据库读写** + 通道运行时组装 —— 服务端专用
 *
 * 纯逻辑那一半在 `sandbox.ts`(零依赖,能进 `unit` project 跑单测)。
 * 这里只干四件事:
 *
 * 1. 读:`payment_setting` 表里那几行 → 一个 `Record<键, 值>`
 * 2. 组装:把「沙箱(DB)/ 正式(环境变量)」两套凭据按**同一个键空间**拼起来,
 *    得出每个通道「现在跑在哪个环境、端点是哪个、缺哪几个、配好了没」
 * 3. 写:后台保存时 upsert(一个事务),或删掉某一行
 * 4. 兜底:DB 读挂了 → **按「模式不明」处理**(见下面「为什么读挂了要禁用通道」)
 *
 * ## 键空间:两个模式用**同一套键名**
 *
 * | | 沙箱模式 | 正式模式 |
 * |---|---|---|
 * | 微信 | `payment_setting` 里的 `wechat_sandbox_*` | 环境变量 `WECHAT_PAY_*` |
 * | 支付宝 | `payment_setting` 里的 `alipay_sandbox_*` | 环境变量 `ALIPAY_*` |
 *
 * 两套**完全不相干**(半配置不会变成「一半沙箱一半正式」的混合签名),但同一个
 * 字段在两种模式下的值被映射到**同一个 `FieldGroup.key`** ⇒ 缺字段诊断只写
 * 一遍(`sandbox.ts` 的 `describeMissingFields`)。
 *
 * ## 读为什么要用 `unstable_cache`
 *
 * 通道清单在结算页上,打印工单页上,后台页上 —— 一个请求里可能问好几次。
 * `unstable_cache` + tag:
 *
 * - 读一次,一分钟之内复用
 * - 后台保存时 `revalidateTag(PAYMENT_SETTINGS_TAG, { expire: 0 })` ⇒ 立刻作废
 *
 * ⚠️ **缓存期只有 60 秒,不是一小时** —— 这张表里存的是**「现在跑在沙箱还是
 * 正式」**。上线忘了关沙箱开关的话,缓存期就是「真客户的钱付到沙箱」的窗口。
 * 60 秒 + 后台保存时立刻作废 ⇒ 窗口小到可以忽略。
 *
 * ⚠️ **报错的那一层在缓存外面** —— 异常从缓存函数里抛出来时,这一层 catch
 * 住。**失败不会被缓存**(抛异常的调用不会被 `unstable_cache` 写进缓存)。
 *
 * ## 为什么读挂了要**禁用通道**(而不是退回正式模式)
 *
 * 两种读挂:
 *
 * - **表不存在**(`42P01`)⇒ 沙箱功能从来没开过 ⇒ **按正式模式处理**,行为跟
 *   现在一模一样(这个改动**不能**让线上多出一个故障点)。
 * - **其它错误**(连接断了之类)⇒ **模式不明** ⇒ 通道**禁用**。
 *
 * 为什么不退回正式模式:开关是「沙箱」而读挂了,退回正式 = **一笔沙箱测试单
 * 变成一笔真单**,用户真付钱。而禁用通道只是「用户暂时付不了」—— 后者能
 * 恢复,前者是**收错钱**。
 *
 * ## 命令行自检脚本(没有请求作用域)
 *
 * `unstable_cache` 在请求作用域之外会抛
 * `Invariant: incrementalCache missing` ⇒ 那一条路**自动退回直读**。
 */

import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { cache } from "react";

import { db } from "@/db";
import { paymentSetting } from "@/db/schema";
import { describeDbError } from "@/features/shared/lib/db-error";

import { readAlipayProductionValues } from "../providers/alipay/env";
import { readWechatProductionValues } from "../providers/wechat/env";

import {
  ALIPAY_REQUIREMENTS,
  allChannelFields,
  type ChannelRequirements,
  describeMissingFields,
  detectSameCredential,
  type FieldGroup,
  maskSecret,
  PAYMENT_SETTING_KEYS,
  type PaymentRuntimeMode,
  type PaymentSettingKey,
  pickChannelValues,
  type ResolvedEndpoint,
  resolveAlipayEndpoint,
  resolveSandboxMode,
  resolveWechatEndpoint,
  type SandboxChannel,
  WECHAT_REQUIREMENTS,
} from "./sandbox";

/**
 * 缓存 tag —— 后台保存时用它作废缓存
 *
 * 一个 tag 管**所有**支付设置:以后加第二个通道的字段,不用再改这一层。
 */
export const PAYMENT_SETTINGS_TAG = "payment-settings";

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 直读所有行 —— **没缓存**
 *
 * 后台要看到**真话**:刚保存完刷新一下,看到的必须是刚存的那个值,不是缓存里
 * 的旧值。命令行自检脚本也走这一条(它没有请求作用域,缓存用不了)。
 */
export async function readPaymentSettingRows(): Promise<
  Record<string, string>
> {
  const rows = await db
    .select({ key: paymentSetting.key, value: paymentSetting.value })
    .from(paymentSetting);

  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/**
 * 带缓存的读
 *
 * 缓存键固定(`unstable_cache` 的缓存键**含实参**,这里没有实参 ⇒ 一份缓存
 * 管全部键)。后台保存时 `revalidateTag` ⇒ 立刻作废。
 */
const cachedReadRows = unstable_cache(
  async (): Promise<Record<string, string>> => readPaymentSettingRows(),
  ["payment-setting-rows"],
  { revalidate: 60, tags: [PAYMENT_SETTINGS_TAG] }
);

/**
 * `unstable_cache` 在**请求作用域之外**不可用
 *
 * 命令行自检脚本(`scripts/payment-sandbox-check.ts`)就是这种情况 ⇒ 抛
 * `Invariant: incrementalCache missing`。那种情况**自动退回直读**,不是错误。
 */
function isCacheUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("incrementalCache missing");
}

/**
 * 带缓存的读(渲染 / 支付链路)
 *
 * 缓存不可用(命令行)⇒ 退回直读。DB 读挂了 ⇒ **抛出去**(由调用方决定怎么办,
 * 见 `getPaymentChannelRuntime`)。
 */
export async function getPaymentSettingRows(): Promise<Record<string, string>> {
  try {
    return await cachedReadRows();
  } catch (error) {
    if (isCacheUnavailable(error)) return readPaymentSettingRows();
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  组装                                                                       */
/* -------------------------------------------------------------------------- */

/** 一个通道在**某个模式**下的状态 */
export interface PaymentModeStatus {
  /** 这个状态说的是哪个模式 */
  mode: PaymentRuntimeMode;
  /** 端点解析的结果 —— `ok: false` 时这个模式用不了 */
  endpoint: ResolvedEndpoint;
  /** 缺的下单字段 */
  missing: FieldGroup[];
  /** 缺的验签字段(不影响下单,但收不到通知) */
  missingVerify: FieldGroup[];
  /** 能不能收钱 */
  canTransact: boolean;
  /** 是不是完全配好了 */
  configured: boolean;
  /**
   * 每个字段**掩码后**的值 —— 后台显示「已配置(…abcd)」
   *
   * 密钥的原文**不在这里**。
   */
  masked: Record<string, string | null>;
  /**
   * **不是密钥**的字段的原始值 —— 后台表单要拿它预填
   *
   * 密钥(`FieldGroup.secret`)的原文**永远不会出现在这里** ⇒ 这一份可以
   * 直接发给客户端组件。
   */
  values: Record<string, string>;
}

/** 一个通道的完整运行时 */
export interface PaymentChannelRuntime {
  /** 哪个通道 */
  channel: SandboxChannel;
  /** 生效的模式 */
  mode: PaymentRuntimeMode;
  /**
   * 模式**认不出来** ⇒ 这个通道选不了
   *
   * 两种来源:① 开关存的值是垃圾(`resolveSandboxMode` 的 `invalid`)
   * ② DB 读挂了,**模式不明**。
   */
  modeInvalid: boolean;
  /** 开关存着的原始值(后台要显示「你存的是这个,认不出来」) */
  modeRaw: string | null;
  /** 当前模式的端点 */
  endpoint: ResolvedEndpoint;
  /** 当前模式能不能收钱 */
  canTransact: boolean;
  /** 当前模式是不是完全配好了 */
  configured: boolean;
  /** 当前模式缺的下单字段 */
  missing: FieldGroup[];
  /** 当前模式缺的验签字段 */
  missingVerify: FieldGroup[];
  /** 沙箱那一档的状态 */
  sandbox: PaymentModeStatus;
  /** 正式那一档的状态 */
  production: PaymentModeStatus;
  /**
   * 「沙箱凭据跟正式凭据**同值**」的字段 —— 大概率贴错了
   *
   * 只是**提醒**,不是硬闸(极少数情况下两边真的一样)。
   */
  sameCredential: FieldGroup[];
}

/** 一个通道要的全部字段(required + 验签材料 + 设置) */
function allFields(requirements: ChannelRequirements): FieldGroup[] {
  return allChannelFields(requirements);
}

/** 从一行行值里挑出这个通道要的字段 */
function pickValues(
  rows: Record<string, string>,
  requirements: ChannelRequirements
): Record<string, string> {
  return pickChannelValues(requirements, rows);
}

/** 算一个模式的状态 */
function buildModeStatus(input: {
  mode: PaymentRuntimeMode;
  requirements: ChannelRequirements;
  values: Record<string, string>;
  endpoint: ResolvedEndpoint;
}): PaymentModeStatus {
  const { missing, missingVerify } = describeMissingFields(
    input.requirements,
    input.values
  );

  const canTransact = input.endpoint.ok && missing.length === 0;
  const configured = canTransact && missingVerify.length === 0;

  const masked: Record<string, string | null> = {};
  const plain: Record<string, string> = {};
  for (const field of allFields(input.requirements)) {
    const value = input.values[field.key] ?? "";
    masked[field.key] = maskSecret(value);
    // 密钥的原文**不往外传** —— 后台那一页是客户端组件
    if (!field.secret) plain[field.key] = value;
  }

  return {
    mode: input.mode,
    endpoint: input.endpoint,
    missing,
    missingVerify,
    canTransact,
    configured,
    masked,
    values: plain,
  };
}

/** 组装微信的运行时 */
function buildWechatRuntime(
  rows: Record<string, string>,
  modeUnknown: boolean
): PaymentChannelRuntime {
  const sandboxValues = pickValues(rows, WECHAT_REQUIREMENTS);
  const productionValues = readWechatProductionValues();

  const resolved = resolveSandboxMode(
    rows[PAYMENT_SETTING_KEYS.wechatSandboxEnabled] ?? null
  );

  const sandboxEndpoint = resolveWechatEndpoint({
    mode: "sandbox",
    sandboxApiBase: rows[PAYMENT_SETTING_KEYS.wechatSandboxApiBase] ?? null,
    sandboxNativePath:
      rows[PAYMENT_SETTING_KEYS.wechatSandboxNativePath] ?? null,
  });
  const productionEndpoint = resolveWechatEndpoint({ mode: "production" });

  const sandbox = buildModeStatus({
    mode: "sandbox",
    requirements: WECHAT_REQUIREMENTS,
    values: sandboxValues,
    endpoint: sandboxEndpoint,
  });
  const production = buildModeStatus({
    mode: "production",
    requirements: WECHAT_REQUIREMENTS,
    values: productionValues,
    endpoint: productionEndpoint,
  });

  const current = resolved.mode === "sandbox" ? sandbox : production;
  const invalid = resolved.invalid || modeUnknown;

  return {
    channel: "wechat",
    mode: resolved.mode,
    modeInvalid: invalid,
    modeRaw: resolved.raw,
    endpoint: current.endpoint,
    canTransact: !invalid && current.canTransact,
    configured: !invalid && current.configured,
    missing: current.missing,
    missingVerify: current.missingVerify,
    sandbox,
    production,
    sameCredential: detectSameCredential({
      sandbox: sandboxValues,
      production: productionValues,
      fields: WECHAT_REQUIREMENTS.required,
    }),
  };
}

/** 组装支付宝的运行时 */
function buildAlipayRuntime(
  rows: Record<string, string>,
  modeUnknown: boolean
): PaymentChannelRuntime {
  const sandboxValues = pickValues(rows, ALIPAY_REQUIREMENTS);
  const productionValues = readAlipayProductionValues();

  const resolved = resolveSandboxMode(
    rows[PAYMENT_SETTING_KEYS.alipaySandboxEnabled] ?? null
  );

  const sandboxEndpoint = resolveAlipayEndpoint({
    mode: "sandbox",
    sandboxGateway: rows[PAYMENT_SETTING_KEYS.alipaySandboxGateway] ?? null,
  });
  const productionEndpoint = resolveAlipayEndpoint({
    mode: "production",
    productionGateway: process.env.ALIPAY_GATEWAY ?? null,
  });

  const sandbox = buildModeStatus({
    mode: "sandbox",
    requirements: ALIPAY_REQUIREMENTS,
    values: sandboxValues,
    endpoint: sandboxEndpoint,
  });
  const production = buildModeStatus({
    mode: "production",
    requirements: ALIPAY_REQUIREMENTS,
    values: productionValues,
    endpoint: productionEndpoint,
  });

  const current = resolved.mode === "sandbox" ? sandbox : production;
  const invalid = resolved.invalid || modeUnknown;

  return {
    channel: "alipay",
    mode: resolved.mode,
    modeInvalid: invalid,
    modeRaw: resolved.raw,
    endpoint: current.endpoint,
    canTransact: !invalid && current.canTransact,
    configured: !invalid && current.configured,
    missing: current.missing,
    missingVerify: current.missingVerify,
    sandbox,
    production,
    sameCredential: detectSameCredential({
      sandbox: sandboxValues,
      production: productionValues,
      fields: ALIPAY_REQUIREMENTS.required,
    }),
  };
}

/** 组装一个通道的运行时 */
function buildChannelRuntime(
  channel: SandboxChannel,
  rows: Record<string, string>,
  modeUnknown: boolean
): PaymentChannelRuntime {
  return channel === "wechat"
    ? buildWechatRuntime(rows, modeUnknown)
    : buildAlipayRuntime(rows, modeUnknown);
}

/* -------------------------------------------------------------------------- */
/*  给支付链路用                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 读一次支付设置 —— **把「读挂了怎么办」收在一处**
 *
 * ## 读挂了怎么办
 *
 * - **表不存在** ⇒ 按**正式模式**处理(行为跟现在一模一样,这个改动不该让线上
 *   多出一个故障点)
 * - **其它错误** ⇒ **模式不明** ⇒ 通道禁用(见文件头「为什么读挂了要禁用通道」)
 */
async function loadPaymentSettings(): Promise<{
  rows: Record<string, string>;
  modeUnknown: boolean;
}> {
  try {
    return { rows: await getPaymentSettingRows(), modeUnknown: false };
  } catch (error) {
    const info = describeDbError(error);
    if (info.missingRelation) {
      // 表还没建 ⇒ 沙箱功能从来没开过 ⇒ 走默认的正式模式
      console.warn(
        "[payment-settings] 支付设置的表还不存在,按正式模式处理(迁移脚本没跑)"
      );
      return { rows: {}, modeUnknown: false };
    }
    console.error(
      "[payment-settings] 读支付设置失败,通道按「没配好」处理:",
      info.message || error
    );
    return { rows: {}, modeUnknown: true };
  }
}

/**
 * 一个通道**当前**的运行时 —— 支付链路用这一条
 *
 * **同一个请求内只查一次** —— React 的 `cache()` 包一层。
 */
export const getPaymentChannelRuntime = cache(
  async (channel: SandboxChannel): Promise<PaymentChannelRuntime> => {
    const { rows, modeUnknown } = await loadPaymentSettings();
    return buildChannelRuntime(channel, rows, modeUnknown);
  }
);

/* -------------------------------------------------------------------------- */
/*  原始值(含密钥)—— 只给服务端                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 一个通道**两个模式**的原始值 —— **含密钥**
 *
 * ## ⚠️ 这一份**绝不能**进 RSC payload
 *
 * `PaymentModeStatus.values` 刻意**不含密钥**的原文(后台那一页是客户端
 * 组件)。但 provider 的配置**需要**真的私钥、APIv3 密钥才能签名/解密 ⇒
 * 这里单独开一条**服务端专用**的路。
 *
 * ⇒ 谁 import 它,谁就负责**不把它交给客户端**。
 */
export interface PaymentChannelRawValues {
  /** 生效的模式 */
  mode: PaymentRuntimeMode;
  /** 模式开关存的值认不出来 ⇒ 这个通道选不了 */
  modeInvalid: boolean;
  /** 沙箱那一套的原始值(DB)—— 含密钥 */
  sandbox: Record<string, string>;
  /** 正式那一套的原始值(环境变量)—— 含密钥 */
  production: Record<string, string>;
}

/**
 * 读一个通道**两个模式**的原始值 —— 服务端专用
 *
 * **为什么两个模式都要给** —— webhook 需要「先试当前模式的凭据,再试另一个
 * 模式的」(拨开关的瞬间可能有在途付款,见计划 §7)。
 *
 * **同一个请求内只查一次** —— React 的 `cache()` 包一层。
 */
export const getPaymentChannelRawValues = cache(
  async (channel: SandboxChannel): Promise<PaymentChannelRawValues> => {
    const { rows, modeUnknown } = await loadPaymentSettings();
    const requirements =
      channel === "wechat" ? WECHAT_REQUIREMENTS : ALIPAY_REQUIREMENTS;

    const enabledKey =
      channel === "wechat"
        ? PAYMENT_SETTING_KEYS.wechatSandboxEnabled
        : PAYMENT_SETTING_KEYS.alipaySandboxEnabled;
    const resolved = resolveSandboxMode(rows[enabledKey] ?? null);

    const productionValues =
      channel === "wechat"
        ? readWechatProductionValues()
        : readAlipayProductionValues();

    return {
      mode: resolved.mode,
      modeInvalid: resolved.invalid || modeUnknown,
      sandbox: pickChannelValues(requirements, rows),
      production: pickChannelValues(requirements, productionValues),
    };
  }
);

/* -------------------------------------------------------------------------- */
/*  后台要的那一份                                                             */
/* -------------------------------------------------------------------------- */

/** 后台概览 —— 两个通道的完整运行时 + 读错信息 */
export interface PaymentSettingsOverview {
  wechat: PaymentChannelRuntime;
  alipay: PaymentChannelRuntime;
  /** 读挂了 —— 人话(表还没建 / 连不上) */
  readError: string | null;
  /** 表还没建(迁移脚本没跑) */
  missingRelation: boolean;
}

/**
 * 后台要的一整套 —— **不走缓存**
 *
 * 后台要看到**真话**:刚保存完刷新一下,看到的必须是刚存的那个值,不是缓存里
 * 的旧值。
 */
export async function getPaymentSettingsOverview(): Promise<PaymentSettingsOverview> {
  let rows: Record<string, string> = {};
  let readError: string | null = null;
  let missingRelation = false;

  try {
    rows = await readPaymentSettingRows();
  } catch (error) {
    const info = describeDbError(error);
    console.error("[payment-settings] 读后台概览失败:", info.message || error);
    readError = info.missingRelation
      ? "支付设置的表还不存在(迁移脚本没跑)"
      : `读支付设置失败:${info.message}`;
    missingRelation = info.missingRelation;
  }

  return {
    wechat: buildWechatRuntime(rows, false),
    alipay: buildAlipayRuntime(rows, false),
    readError,
    missingRelation,
  };
}

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 写**多项**设置 —— **一个事务**里全写完
 *
 * 后台点一次「保存」是同时写好几项(开关 + 端点 + 几个凭据)。分几次写 ⇒
 * 可能出现「开关存进去了、凭据没存进去」的**半截状态** —— 工作室刷新一下看到
 * 的是两个不同版本,会以为出了鬼。
 *
 * 一个事务 ⇒ 要么都在,要么都不在。
 */
export async function savePaymentSettings(
  entries: Array<{ key: PaymentSettingKey; value: string }>
): Promise<void> {
  if (entries.length === 0) return;

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const payload = {
        key: entry.key,
        value: entry.value,
        updatedAt: new Date(),
      };
      await tx
        .insert(paymentSetting)
        .values(payload)
        .onConflictDoUpdate({
          target: paymentSetting.key,
          set: { value: payload.value, updatedAt: payload.updatedAt },
        });
    }
  });
}

/**
 * 删掉一行 —— **回到「没存过」**
 *
 * 跟 `site_setting` 一个口径:删掉 = 「我没配过这一项」;「关掉」是**存一个
 * 具体的值**(比如把沙箱开关存成 `false`),不是删行。
 */
export async function deletePaymentSetting(
  key: PaymentSettingKey
): Promise<void> {
  await db.delete(paymentSetting).where(eq(paymentSetting.key, key));
}
