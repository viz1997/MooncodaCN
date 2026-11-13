"use server";

/**
 * /admin/site-settings —— 站点设置后台 server actions(2026-11-11)
 *
 * 工作室 2026-11-11 的要求:**「不需要环境变量,在后台设置」** —— 海外独立站
 * 的顾客访问地址改成后台可配,改完不用重新部署。
 *
 * 这一组 action 是那条路的唯一写入口:
 *
 * - `adminGetSiteSettingsAction` —— 读现状(生效值 + 它从哪儿来)
 * - `adminSaveSiteSettingsAction` —— 保存(**两个字段一个事务**)
 * - `adminResetSiteSettingsAction` —— 删掉后台**某一行**,退回环境变量那一档
 *
 * ## 2026-11-13 加了第二项设置:客服微信二维码
 *
 * 页脚「客服」那一栏(点开弹二维码)⇒ 后台多一栏「客服微信二维码地址」。
 * 它跟海外独立站那一项是**两个独立的键**,但**共用这一组 action** ——
 * 后台那一页就是一张表单两个字段。
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(地址写错了?表还没建?)。所以这里把**能预见的**失败都变成一个
 * code,界面照着 code 给话。
 *
 * ## 「use server」文件只导出 async 函数
 *
 * 类型**不能**在这里 re-export —— Turbopack 会把它注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。类型全在
 * `./types.ts`。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { describeDbError } from "@/features/shared/lib/db-error";
import {
  normalizeStorefrontUrl,
  SITE_SETTING_KEYS,
  validateServiceQrUrl,
  validateStorefrontUrl,
} from "@/features/site-settings/lib/site-setting";
import {
  deleteSiteSetting,
  getSiteSettingsOverview,
  SITE_SETTINGS_TAG,
  saveSiteSettings,
} from "@/features/site-settings/lib/site-setting-store";
import { adminAction } from "@/lib/safe-action";

import type {
  AdminSiteSettingsView,
  AdminSiteSettingWriteResult,
} from "./types";

const withSiteSettingAction = (name: string) =>
  adminAction.metadata({ action: `admin.siteSetting.${name}` });

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读现状
 *
 * **不走缓存** —— 后台要看到真话:刚保存完刷新一下,看到的必须是刚存的
 * 那个值。
 */
export const adminGetSiteSettingsAction = withSiteSettingAction("get").action(
  async (): Promise<AdminSiteSettingsView> => {
    const overview = await getSiteSettingsOverview();
    return {
      effectiveUrl: overview.resolved.url,
      source: overview.resolved.source,
      invalid: overview.resolved.invalid,
      dbValue: overview.dbValue,
      envValue: overview.envValue,
      readError: overview.readError,
      missingRelation: overview.missingRelation,
      serviceQrUrl: overview.serviceQr.url,
      serviceQrSource: overview.serviceQr.source,
      serviceQrInvalid: overview.serviceQr.invalid,
      serviceQrDbValue: overview.serviceQrDbValue,
      serviceQrEnvValue: overview.serviceQrEnvValue,
    };
  }
);

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 保存的入参 —— 每项设置一个字段
 *
 * ⚠️ **两个字段各自独立** —— 客服二维码那一项存不存,跟海外独立站那一项
 * 没关系(2026-11-13 加的)。两项**分别校验、分别保存**:一项不合法,另一项
 * 照样能存。
 */
const settingsSchema = z.object({
  /**
   * 海外独立站(Shopify)的顾客访问地址
   *
   * **空串是合法的** —— 那表示「**明确关掉**这个入口」(哪怕环境变量还
   * 配着)。删掉这一行是另一回事(退回环境变量)。
   */
  internationalStoreUrl: z.string().max(2000),
  /**
   * 客服微信二维码的图片地址(2026-11-13)
   *
   * 跟上面那条一个口径:
   *
   * - **空串合法** = 明确关掉(页脚不摆二维码)
   * - **站内路径也合法**(`/service/wechat-qr.png`)—— 二维码图往往是放进
   *   仓库里的一张静态图,不是一个公网地址
   * - **不合法**(比如 `javascript:`)⇒ 拒绝保存,渲染时也会 fail closed
   */
  serviceWechatQrUrl: z.string().max(2000),
});

/**
 * 保存之后要刷的东西
 *
 * - `revalidateTag(..., { expire: 0 })` ⇒ **立刻作废**缓存里那一份
 *   (`"max"` 那一档是 stale-while-revalidate —— 第一个访问者还会拿到旧值,
 *   第二次才拿到新的。工作室改完刷新一下看到旧地址会以为功能坏了。)
 * - `revalidatePath("/[locale]", "layout")` ⇒ 两个 layout(公告条 + 导航
 *   按钮都挂在里面)连同它们底下的页面一起刷
 *
 * ⚠️ **缓存那一层在 layout 之外** —— 只刷 layout 不刷数据缓存,新页面上
 * 还是旧地址;两个都要。
 */
function revalidateSiteSettings(): void {
  revalidateTag(SITE_SETTINGS_TAG, { expire: 0 });
  revalidatePath("/[locale]", "layout");
  revalidatePath("/[locale]", "page");
}

/**
 * 保存站点设置 —— **两个字段一个事务**
 *
 * ## 空串 = 明确关掉
 *
 * 存空串 ⇒ 那个入口**不出现**(哪怕环境变量还配着)。这是「在后台设置」的
 * 意义 —— 工作室能自己把入口关掉,不用去动部署环境。
 *
 * ## 两项**一起**校验、**一起**写
 *
 * 一项不合法 ⇒ **两个都不写**,并报出是哪一项不合法(错误码带项的区别)。
 * 写了一半的话,工作室刷新一下看到的是两个不同版本的设置,说不清哪一半
 * 生效了。
 */
export const adminSaveSiteSettingsAction = withSiteSettingAction("save")
  .schema(settingsSchema)
  .action(async ({ parsedInput }): Promise<AdminSiteSettingWriteResult> => {
    const normalizedStore = normalizeStorefrontUrl(
      parsedInput.internationalStoreUrl
    );
    const normalizedQr = normalizeStorefrontUrl(parsedInput.serviceWechatQrUrl);

    // 非空 ⇒ 必须是一个能渲染的地址
    //
    // 校验在这儿做一次,渲染路径上**再做一次**(纯函数那一层)—— 两处用的是
    // 同一份校验函数,不是两份逻辑。
    if (normalizedStore) {
      const check = validateStorefrontUrl(normalizedStore);
      if (!check.ok) {
        return {
          ok: false,
          code: check.code === "NOT_HTTP" ? "NOT_HTTP" : "INVALID_URL",
        };
      }
    }

    if (normalizedQr) {
      const check = validateServiceQrUrl(normalizedQr);
      if (!check.ok) {
        // 二维码那一项的码**单列一个** —— 工作室要能一眼看出是哪个输入框
        // 填错了(两个字段长得一模一样,只报一个「地址不合法」没法修)
        return { ok: false, code: "INVALID_QR_URL" };
      }
    }

    try {
      await saveSiteSettings([
        {
          key: SITE_SETTING_KEYS.internationalStoreUrl,
          value: normalizedStore,
        },
        { key: SITE_SETTING_KEYS.serviceWechatQrUrl, value: normalizedQr },
      ]);
    } catch (error) {
      const info = describeDbError(error);
      console.error("[site-settings] 保存站点设置失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidateSiteSettings();
    return { ok: true };
  });

/**
 * 删掉后台的**某一行** —— **退回环境变量那一档**
 *
 * 「删掉」不是「关掉」:关掉是**存一个空串**(入口不出现,但后台还看得见
 * 「这一项被工作室关掉了」)。删掉 = 「我没配过这一项」⇒ 退回环境变量。
 *
 * ## 按键删(2026-11-13)
 *
 * 以前只有一项设置,「重置」就删那一行。现在有两项 ⇒ 必须**指定删哪一项**
 * —— 「把独立站退回环境变量」不该顺手把二维码也退回去。
 */
const resetSchema = z.object({
  key: z.enum([
    SITE_SETTING_KEYS.internationalStoreUrl,
    SITE_SETTING_KEYS.serviceWechatQrUrl,
  ]),
});

export const adminResetSiteSettingsAction = withSiteSettingAction("reset")
  .schema(resetSchema)
  .action(async ({ parsedInput }): Promise<AdminSiteSettingWriteResult> => {
    try {
      await deleteSiteSetting(parsedInput.key);
    } catch (error) {
      const info = describeDbError(error);
      console.error("[site-settings] 重置站点设置失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidateSiteSettings();
    return { ok: true };
  });

/*
 * `AdminSiteSettingsView` / `AdminSiteSettingWriteResult` /
 * `AdminSiteSettingErrorCode` **不在这里 re-export** —— 「use server」文件
 * 只能导出 async 函数,类型 re-export 会被 Turbopack 注册成 server action,
 * 运行时引用一个不存在的类型绑定 → ReferenceError,整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 界面从 `@/features/site-settings/admin/types` 直接 import 那些类型。
 */
