"use server";

/**
 * /admin/payment-settings —— 支付设置后台 server actions(2026-11-13)
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」**,外加一句
 * **「可以后台配置」**。
 *
 * 这一组 action 是沙箱那条路的唯一写入口:
 *
 * - `adminGetPaymentSettingsAction` —— 读现状(两个通道 × 两个模式)
 * - `adminSavePaymentSettingsAction` —— 保存(**一个事务**)
 * - `adminDeletePaymentSettingAction` —— 删掉后台**某一行**
 * - `adminTestPaymentChannelAction` —— 跑一笔 **¥0.01** 的测试单
 * - `adminReconcileStorefrontOrderAction` —— 拿订单号**查单**(诊断「钱到了、订单不动」)
 *
 * ## 为什么沙箱凭据在 DB 而不是环境变量
 *
 * `NEXT_PUBLIC_*` 是**构建期内联**的 —— 改一次地址要重新部署,工作室改不动。
 * 沙箱开关 / 端点 / 凭据都是「上线前要反复拨」的东西,必须能在后台直接改。
 *
 * ⇒ 真理源是 `payment_setting` 表(跟 2026-11-11 的 `site_setting` 一个路子)。
 * **正式模式的凭据一个字都不动** —— 继续走环境变量。
 *
 * ## 两套命名空间完全不相干
 *
 * | | 沙箱模式 | 正式模式 |
 * |---|---|---|
 * | 微信 | **只**读 `wechat_sandbox_*`(DB) | **只**读 `WECHAT_PAY_*`(env) |
 * | 支付宝 | **只**读 `alipay_sandbox_*`(DB) | **只**读 `ALIPAY_*`(env) |
 *
 * 半配置**不会**变成「一半沙箱一半正式」的混合签名。而且工作室**还没正式
 * 资质**这件事**完全不影响**沙箱自检。
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿错了
 * (表还没建?开关存的值认不出来?还是上游拒了?)。所以这里把**能预见的**失败
 * 都变成一个 code,界面照着 code 给话。
 *
 * ## 「use server」文件只导出 async 函数
 *
 * 类型**不能**在这里 re-export —— Turbopack 会把它注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。类型全在 `./types.ts`。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/features/shared/lib/db-error";
import { getStorefrontOrderByOrderNoForAdmin } from "@/features/storefront/lib/orders";
import { reconcileStorefrontOrderPayment } from "@/features/storefront/lib/payment-reconcile";
import { adminAction } from "@/lib/safe-action";
import { resolveNotifyUrl } from "../lib/notify-url";
import { getPaymentProvider } from "../lib/registry";
import {
  ALIPAY_REQUIREMENTS,
  ALL_PAYMENT_SETTING_KEYS,
  allChannelFields,
  type FieldGroup,
  PAYMENT_SETTING_KEYS,
  type PaymentSettingKey,
  type SandboxChannel,
  WECHAT_REQUIREMENTS,
} from "../lib/sandbox";
import {
  deletePaymentSetting,
  getPaymentSettingsOverview,
  PAYMENT_SETTINGS_TAG,
  type PaymentChannelRuntime,
  type PaymentModeStatus,
  savePaymentSettings,
} from "../lib/sandbox-store";
import { buildTestPaymentRequest } from "../lib/test-order";
import { PaymentNotConfiguredError } from "../lib/types";
import { ALIPAY_NOTIFY_PATH, readAlipaySiteUrl } from "../providers/alipay/env";
import { normalizePemKey as normalizeAlipayPem } from "../providers/alipay/sign";
import {
  readWechatSiteUrl,
  WECHAT_PAY_NOTIFY_PATH,
} from "../providers/wechat/env";
import { normalizePemKey as normalizeWechatPem } from "../providers/wechat/signature";

import type {
  AdminPaymentChannelView,
  AdminPaymentFieldView,
  AdminPaymentModeView,
  AdminPaymentReconcileResult,
  AdminPaymentSettingsView,
  AdminPaymentSettingWriteResult,
  AdminPaymentTestResult,
} from "./types";

const withPaymentAction = (name: string) =>
  adminAction.metadata({ action: `admin.paymentSetting.${name}` });

/* -------------------------------------------------------------------------- */
/*  字段清单                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 两个通道的**全部**字段 —— 一份清单
 *
 * 「要哪些字段」写在 `sandbox.ts` 的 `FieldGroup` 里(表单、缺字段诊断、
 * 写入全靠它)。这里把它拼成一张平表 —— **不再维护第二份清单**。
 */
const ALL_FIELD_GROUPS: FieldGroup[] = [
  ...allChannelFields(WECHAT_REQUIREMENTS),
  ...allChannelFields(ALIPAY_REQUIREMENTS),
];

/**
 * PEM 字段用**各自通道**的规范化函数
 *
 * 两个通道的 `normalizePemKey` 实现**一模一样**(还原 `\n` 转义 + 补末尾换行),
 * 但各自通道的模块是**真理源** —— 改了一边另一边跟着改,别只改一个。
 */
const PEM_NORMALIZERS = new Map<PaymentSettingKey, (raw: string) => string>([
  [PAYMENT_SETTING_KEYS.wechatSandboxPrivateKey, normalizeWechatPem],
  [PAYMENT_SETTING_KEYS.wechatSandboxPublicKey, normalizeWechatPem],
  [PAYMENT_SETTING_KEYS.alipaySandboxAppPrivateKey, normalizeAlipayPem],
  [PAYMENT_SETTING_KEYS.alipaySandboxPublicKey, normalizeAlipayPem],
]);

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 一个字段的展示信息
 *
 * `masked` 永远给;`value` **只有非密钥字段才有** —— 密钥的原文永远不进
 * 浏览器。
 */
function toFieldView(
  field: FieldGroup,
  masked: Record<string, string | null>,
  values: Record<string, string>
): AdminPaymentFieldView {
  return {
    key: field.key,
    label: field.label,
    envVar: field.envVar,
    secret: field.secret === true,
    multiline: field.multiline === true,
    pem: field.pem === true,
    optional: field.optional === true,
    masked: masked[field.key] ?? null,
    value: field.secret ? "" : (values[field.key] ?? ""),
  };
}

/**
 * 两个通道的**通知地址**怎么算 —— 一份清单
 *
 * 通知路径住在各通道自己的 `env.ts` 里(真理源),这里只把三样拼起来:
 * **显式配的值** / **站点地址** / **通知路径**。
 *
 * 沙箱和正式**共用同一个键**(`*_sandbox_notify_url`)—— 跟凭据那套键空间
 * 一个路子(见 `env.ts` 的「值用沙箱那一套的键名索引」)。
 */
interface ChannelNotifySpec {
  /** 通知路径 —— 各通道 `env.ts` 里的那一份 */
  path: string;
  /** 显式配的通知地址在 `values` 里的键(沙箱 / 正式同一个键) */
  key: PaymentSettingKey;
  /** 站点地址怎么读 */
  siteUrl: () => string | null;
}

const CHANNEL_NOTIFY: Record<SandboxChannel, ChannelNotifySpec> = {
  wechat: {
    path: WECHAT_PAY_NOTIFY_PATH,
    key: PAYMENT_SETTING_KEYS.wechatSandboxNotifyUrl,
    siteUrl: readWechatSiteUrl,
  },
  alipay: {
    path: ALIPAY_NOTIFY_PATH,
    key: PAYMENT_SETTING_KEYS.alipaySandboxNotifyUrl,
    siteUrl: readAlipaySiteUrl,
  },
};

/**
 * 一个通道在某个模式下的状态
 *
 * @param exposeValues **要不要把字段的原文带出去**
 *
 * 沙箱那一档 = `true`(后台要拿它**预填表单**);正式那一档 = `false` ——
 * 生产环境变量的原文**不发到浏览器**,那一档只需要「配好了没 / 缺哪几个 /
 * 掩码」这些信息。
 *
 * @param notify 这个通道的通知地址怎么算
 *
 * ⚠️ **通知地址的诊断是服务端算完再带出去的** —— 正式那一档的
 * `values` 是空的(生产环境变量原文不发到浏览器),但**通知地址本身不是
 * 密钥**(平台公开回调的地址),工作室要能看见它对不对。
 */
function toModeView(
  status: PaymentModeStatus,
  exposeValues: boolean,
  notify: ChannelNotifySpec
): AdminPaymentModeView {
  const values = exposeValues ? status.values : {};
  const diagnosis = resolveNotifyUrl({
    explicitNotifyUrl: status.values[notify.key] ?? "",
    siteUrl: notify.siteUrl(),
    notifyPath: notify.path,
  });
  return {
    mode: status.mode,
    endpoint: status.endpoint.ok ? status.endpoint.endpoint : null,
    endpointError: status.endpoint.ok ? null : status.endpoint.code,
    endpointMessage: status.endpoint.ok ? null : status.endpoint.message,
    missing: status.missing.map((field) =>
      toFieldView(field, status.masked, values)
    ),
    missingVerify: status.missingVerify.map((field) =>
      toFieldView(field, status.masked, values)
    ),
    canTransact: status.canTransact,
    configured: status.configured,
    masked: status.masked,
    values,
    keyIssues: status.keyIssues,
    notifyUrl: diagnosis.notifyUrl,
    notifyUrlSource: diagnosis.source,
    notifyUrlProblems: diagnosis.problems,
  };
}

/** 一个通道的完整状态 */
function toChannelView(
  runtime: PaymentChannelRuntime
): AdminPaymentChannelView {
  const requirements =
    runtime.channel === "wechat" ? WECHAT_REQUIREMENTS : ALIPAY_REQUIREMENTS;
  const notify = CHANNEL_NOTIFY[runtime.channel];

  // 当前生效的那一档 —— `missing` / `missingVerify` 说的是**当前模式**缺什么
  const current =
    runtime.mode === "sandbox" ? runtime.sandbox : runtime.production;
  const currentValues =
    runtime.mode === "sandbox"
      ? current.values
      : ({} as Record<string, string>);

  // 表单照着**沙箱那一套**渲染 —— 后台这一页配的就是沙箱凭据
  const fields = allChannelFields(requirements).map((field) =>
    toFieldView(field, runtime.sandbox.masked, runtime.sandbox.values)
  );

  const sandbox = toModeView(runtime.sandbox, true, notify);
  const production = toModeView(runtime.production, false, notify);

  // 通知地址 —— 跟着**当前模式**走(工作室要一眼看出平台推不推得到)
  //
  // ⚠️ 通知地址的诊断是**视图**那一层算的(`toModeView()` 里)——
  // `PaymentModeStatus` 那份原始状态里**没有**这三个字段。
  const currentView = runtime.mode === "sandbox" ? sandbox : production;

  return {
    channel: runtime.channel,
    mode: runtime.mode,
    modeInvalid: runtime.modeInvalid,
    modeRaw: runtime.modeRaw,
    canTransact: runtime.canTransact,
    configured: runtime.configured,
    endpoint: runtime.endpoint.ok ? runtime.endpoint.endpoint : null,
    endpointError: runtime.endpoint.ok ? null : runtime.endpoint.code,
    endpointMessage: runtime.endpoint.ok ? null : runtime.endpoint.message,
    missing: current.missing.map((field) =>
      toFieldView(field, current.masked, currentValues)
    ),
    missingVerify: current.missingVerify.map((field) =>
      toFieldView(field, current.masked, currentValues)
    ),
    keyIssues: current.keyIssues,
    // 通知地址 —— 跟着**当前模式**走(工作室要一眼看出平台推不推得到)
    notifyUrl: currentView.notifyUrl,
    notifyUrlSource: currentView.notifyUrlSource,
    notifyUrlProblems: currentView.notifyUrlProblems,
    siteUrl: notify.siteUrl(),
    sandbox,
    production,
    sameCredential: runtime.sameCredential.map((field) =>
      toFieldView(field, runtime.sandbox.masked, runtime.sandbox.values)
    ),
    fields,
  };
}

/**
 * 读现状 —— **不走缓存**
 *
 * 后台要看到真话:刚保存完刷新一下,看到的必须是刚存的那个值。
 */
export const adminGetPaymentSettingsAction = withPaymentAction("get").action(
  async (): Promise<AdminPaymentSettingsView> => {
    const overview = await getPaymentSettingsOverview();
    return {
      wechat: toChannelView(overview.wechat),
      alipay: toChannelView(overview.alipay),
      readError: overview.readError,
      missingRelation: overview.missingRelation,
    };
  }
);

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 保存的入参
 *
 * ## 为什么文本字段用 `z.record` 而不是逐个列出来
 *
 * 字段清单住在 `sandbox.ts` 的 `FieldGroup` 里(表单、缺字段诊断、写入全靠
 * 那一份)。这里再列一遍 15 个字段就是**第二份清单** —— 迟早漂(加了一个
 * 字段忘了改 schema,工作室填了但存不进去,而且**不报错**)。
 *
 * ⇒ 收一张 map,**写进去的键再按白名单过滤** —— 白名单在**代码**里
 * (`ALL_FIELD_GROUPS`),不在 schema 里。
 */
const settingsSchema = z.object({
  /**
   * 微信沙箱开关 —— **必填**
   *
   * 不给默认值:漏传就当「正式」= **真收钱**。宁可表单报错也不能默默切正式。
   */
  wechatSandboxEnabled: z.boolean(),
  /** 支付宝沙箱开关 —— **必填**(同上) */
  alipaySandboxEnabled: z.boolean(),
  /** 文本字段 —— 键 = DB 键 */
  values: z.record(z.string(), z.string().max(20000)),
});

/**
 * 保存之后要刷的东西
 *
 * - `revalidateTag(..., { expire: 0 })` ⇒ **立刻作废**缓存里那一份
 *   (`"max"` 那一档是 stale-while-revalidate —— 第一个访问者还会拿到旧值)
 * - `revalidatePath` ⇒ 结算页 / 通道清单接口跟着刷新
 */
function revalidatePaymentSettings(): void {
  revalidateTag(PAYMENT_SETTINGS_TAG, { expire: 0 });
  revalidatePath("/[locale]", "layout");
  revalidatePath("/[locale]/checkout", "page");
}

/**
 * 保存支付设置 —— **一个事务**
 *
 * ## 密钥输入框留空 = **保持原值**(不是清空)
 *
 * 后台那一页的密钥字段只显示「已配置(…abcd)」,**不回显原文** ⇒ 表单提交时
 * 那个输入框**本来就是空的**。
 *
 * 如果空串 = 清空,工作室点一次「保存」就把私钥擦了 —— 而下一次支付就以
 * 「签名错误」的形式炸出来,极难联想到「我刚才点了个保存」。
 *
 * ⇒ **空 = 不动这一行**。要清空一个密钥 ⇒ 用「删掉这一行」那颗按钮。
 *
 * ## 非密钥字段留空 = **清空**(退回默认值)
 *
 * 端点 / 通知地址这类字段留空是有意义的(「留空 = 用默认」)⇒ 空串要**写进去**。
 */
export const adminSavePaymentSettingsAction = withPaymentAction("save")
  .schema(settingsSchema)
  .action(async ({ parsedInput }): Promise<AdminPaymentSettingWriteResult> => {
    const writes: Array<{ key: PaymentSettingKey; value: string }> = [];

    // 两个开关永远写 —— 开关是「有 / 没有」,不是「填了 / 没填」
    writes.push({
      key: PAYMENT_SETTING_KEYS.wechatSandboxEnabled,
      value: parsedInput.wechatSandboxEnabled ? "true" : "false",
    });
    writes.push({
      key: PAYMENT_SETTING_KEYS.alipaySandboxEnabled,
      value: parsedInput.alipaySandboxEnabled ? "true" : "false",
    });

    for (const field of ALL_FIELD_GROUPS) {
      const raw = parsedInput.values[field.key];
      // 表单没带这一项 ⇒ **不动它**(不是「清空」)
      if (raw === undefined) continue;

      const trimmed = raw.trim();

      if (field.secret) {
        // 密钥:留空 = 保持原值
        if (trimmed === "") continue;
        const normalize = PEM_NORMALIZERS.get(field.key);
        writes.push({
          key: field.key,
          value: normalize ? normalize(trimmed) : trimmed,
        });
        continue;
      }

      // 非密钥:留空 = 清空(退回默认值)
      writes.push({ key: field.key, value: trimmed });
    }

    try {
      await savePaymentSettings(writes);
    } catch (error) {
      const info = describeDbError(error);
      console.error(
        "[payment-settings] 保存支付设置失败:",
        info.message || error
      );
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePaymentSettings();
    return { ok: true };
  });

/**
 * 删掉后台的**某一行**
 *
 * 「删掉」不是「关掉」:关掉沙箱开关 = **存一个 `false`**;删掉 = 「我没配过
 * 这一项」⇒ 退回默认(正式模式)。
 *
 * ⇒ 想清空一个密钥,走这条路(输入框留空是「保持原值」)。
 */
const deleteSchema = z.object({
  key: z.enum(
    ALL_PAYMENT_SETTING_KEYS as [PaymentSettingKey, ...PaymentSettingKey[]]
  ),
});

export const adminDeletePaymentSettingAction = withPaymentAction("delete")
  .schema(deleteSchema)
  .action(async ({ parsedInput }): Promise<AdminPaymentSettingWriteResult> => {
    try {
      await deletePaymentSetting(parsedInput.key);
    } catch (error) {
      const info = describeDbError(error);
      console.error(
        "[payment-settings] 删掉支付设置失败:",
        info.message || error
      );
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "DELETE_FAILED" };
    }

    revalidatePaymentSettings();
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*  跑一笔测试单                                                               */
/* -------------------------------------------------------------------------- */

const testSchema = z.object({
  /** 哪个通道 */
  channel: z.enum(["wechat", "alipay"]),
  /**
   * 正式模式下要**再点一次**才真跑
   *
   * 默认 `false` —— 一颗写着「跑一笔 ¥0.01 测试单」的按钮,在**正式模式**下
   * 会**真的扣 1 分钱**。这不是能顺手点一下的东西 ⇒ 必须显式确认。
   */
  allowProduction: z.boolean().default(false),
});

/**
 * 测试单的订单号 + 请求体 —— **跟命令行自检共用一份**
 *
 * `../lib/test-order.ts` 里那一份。后台按钮跟 `scripts/payment-sandbox-check.ts`
 * 建出来的**必须要是同一笔单子**(订单号规则 / 金额 / 币种一样)—— 各写一份的
 * 话,两边表现不一致时根本分不清是凭据的问题还是单子本身的问题。
 */

/** 把上游的报错截断一下 —— 免得一张 HTML 错误页塞进消息框 */
function truncateMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

/**
 * 跑一笔 **¥0.01** 的测试单
 *
 * ## 走**生产的同一条代码路径**(`provider.createSession()`)
 *
 * 另写一份「测试实现」等于什么都没验 —— 签名拼错了、端点拼错了、金额算错了,
 * 那份「测试实现」照样能跑通。⇒ 这里调的就是**结算页调的那个函数**。
 *
 * ## 这一笔**不落本地订单**
 *
 * 只在平台上建一个 1 分钱的单子,验的是「凭据对不对 / 端点对不对 / 签名对不对」。
 * 本地**不写** `storefront_order` —— 写进去就是一张永远不发货的僵尸单。
 *
 * ## 正式模式要**再点一次**
 *
 * 通道跑在正式模式 ⇒ 这一笔**会真的扣 1 分钱**。⇒ 先回
 * `TEST_NEEDS_PRODUCTION_CONFIRM`,界面再问一次。
 */
export const adminTestPaymentChannelAction = withPaymentAction("test")
  .schema(testSchema)
  .action(async ({ parsedInput }): Promise<AdminPaymentTestResult> => {
    const channel = parsedInput.channel;
    const overview = await getPaymentSettingsOverview();
    const runtime = channel === "wechat" ? overview.wechat : overview.alipay;

    const fail = (
      code: AdminPaymentTestResult["code"],
      message: string
    ): AdminPaymentTestResult => ({
      ok: false,
      channel,
      mode: runtime.mode,
      qrCodeUrl: null,
      redirectUrl: null,
      code,
      message,
    });

    // 开关存的值认不出来 ⇒ **不猜**(默默当正式 = 真收钱)
    if (runtime.modeInvalid) {
      return fail(
        "TEST_MODE_INVALID",
        `沙箱开关存的值认不出来(${
          runtime.modeRaw ?? "空"
        })—— 只认 true / false,先把开关拨对`
      );
    }

    // 缺字段 ⇒ 重试没用,得先把凭据配上
    if (!runtime.canTransact) {
      const missing = runtime.missing.map((field) => field.label).join("、");
      return fail(
        "TEST_NOT_CONFIGURED",
        missing
          ? `这个通道还缺:${missing} —— 先在下面把凭据填齐`
          : "这个通道还没配好 —— 先在下面把凭据填齐"
      );
    }

    // 正式模式 ⇒ 这一笔**真的扣钱** ⇒ 要显式确认
    if (runtime.mode === "production" && !parsedInput.allowProduction) {
      return fail(
        "TEST_NEEDS_PRODUCTION_CONFIRM",
        "这个通道现在跑在**正式模式** —— 这一笔会真的扣 1 分钱。再点一次确认。"
      );
    }

    const provider = getPaymentProvider(channel);
    if (!provider) {
      return fail("TEST_CHANNEL_UNSUPPORTED", "这个通道没有实现");
    }

    const siteUrl =
      channel === "wechat" ? readWechatSiteUrl() : readAlipaySiteUrl();

    const request = buildTestPaymentRequest({
      siteUrl,
      note: "支付设置后台的沙盒自检单",
    });

    try {
      const session = await provider.createSession(request);
      return {
        ok: true,
        channel,
        mode: runtime.mode,
        qrCodeUrl: session.qrCodeUrl,
        redirectUrl: session.redirectUrl,
        code: null,
        message: null,
      };
    } catch (error) {
      if (error instanceof PaymentNotConfiguredError) {
        return fail("TEST_NOT_CONFIGURED", truncateMessage(error.message));
      }
      const message = error instanceof Error ? error.message : "通道调用失败";
      console.error("[payment-settings] 测试单失败:", message);
      return fail("TEST_PROVIDER_FAILED", truncateMessage(message));
    }
  });

/* -------------------------------------------------------------------------- */
/*  查单自检                                                                    */
/* -------------------------------------------------------------------------- */

const reconcileSchema = z.object({
  /** 商城的订单号(比如 `SO-20261114-137332`) */
  orderNo: z.string().trim().min(1).max(64),
});

/**
 * 拿订单号去问支付宝「这单到底付了没」 —— **查单自检**
 *
 * ## 为什么后台要有一颗这个
 *
 * 线上真踩过的两单(`SO-20261114-657E4A` / `SO-20261114-137332`):
 * **钱到了、订单永远是 `unpaid`**,买家盯着「正在确认支付…」转圈到超时。
 *
 * 排查这件事需要三样东西,而**界面上一样都没有**:
 *
 * 1. 支付宝到底回了什么(`code` / `sub_code` / `trade_status` / `total_amount`)
 * 2. 响应的签名验过没有 —— **`false` 就是支付宝公钥贴错了**
 * 3. 我打的是哪个网关、沙箱还是正式
 *
 * ⇒ 这个 action 把**原始事实**原样带给工作室(`attempts`),外加判定层的
 * **结论**(`code` / `paid` / `reportedPaid` / `settled`)。
 *
 * ## 它**会**把订单标成已支付
 *
 * 走的就是买家侧那条兜底路(`reconcileStorefrontOrderPayment`)—— 验签过了 +
 * 金额对得上 ⇒ 落库标成已支付。**这是这条兜底路本来该做的事**,后台只是
 * 手动触发它。
 *
 * ## 「查出来不是这一档」**也算成功**
 *
 * 「签名验不过」「还没付」是**结论**(重试没用),不是「这次调用挂了」。
 * ⇒ 那些走 `ok: true`,只有「订单号查不到」「调用整个挂了」才走 `ok: false`。
 *
 * ## 归属校验
 *
 * 后台**不带** `user_id` 过滤(工作室查的是自己家的单)——
 * 用的是 `getStorefrontOrderByOrderNoForAdmin`,**不是**用户侧那个。
 */
export const adminReconcileStorefrontOrderAction = withPaymentAction(
  "reconcile"
)
  .schema(reconcileSchema)
  .action(async ({ parsedInput }): Promise<AdminPaymentReconcileResult> => {
    const found = await getStorefrontOrderByOrderNoForAdmin(
      parsedInput.orderNo
    );
    if (!found) {
      return { ok: false, code: "RECONCILE_ORDER_NOT_FOUND" };
    }

    try {
      const outcome = await reconcileStorefrontOrderPayment({
        order: found.order,
        items: found.items,
      });

      // 查单有可能**把订单标成已支付** ⇒ 买家侧那一页要重新算
      if (outcome.settled) {
        revalidatePath("/[locale]/account/orders", "page");
      }

      return {
        ok: true,
        orderNo: found.order.orderNo,
        localStatus: found.order.status,
        localPaymentStatus: found.order.paymentStatus,
        localPaymentChannel: found.order.paymentChannel,
        totalCents: found.order.totalCents,
        code: outcome.code,
        message: outcome.message,
        paid: outcome.paid,
        reportedPaid: outcome.reportedPaid,
        settled: outcome.settled,
        tradeNo: outcome.tradeNo,
        attempts: outcome.attempts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[payment-settings] 查单 ${parsedInput.orderNo} 失败:`,
        message
      );
      return { ok: false, code: "RECONCILE_FAILED" };
    }
  });

/*
 * `AdminPaymentSettingsView` / `AdminPaymentSettingWriteResult` /
 * `AdminPaymentSettingErrorCode` / `AdminPaymentTestResult` /
 * `AdminPaymentReconcileResult`
 * **不在这里 re-export** —— 「use server」文件只能导出 async 函数,类型
 * re-export 会被 Turbopack 注册成 server action,运行时引用一个不存在的类型
 * 绑定 → ReferenceError,整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 界面从 `@/features/payments/admin/types` 直接 import 那些类型。
 */
