/**
 * 站点设置的**数据库读写** —— 服务端专用
 *
 * 纯逻辑那一半在 `site-setting.ts`(零依赖,能进 `unit` project 跑单测)。
 * 这里只干三件事:
 *
 * 1. 读:DB 那一行 → 解析成一份生效设置(DB → env → 空)
 * 2. 写:后台保存时 upsert / 删掉那一行(删掉 = 退回环境变量)
 * 3. 兜底:DB 读挂了 → 退回环境变量,**绝不把异常抛进渲染链路**
 *
 * ## 为什么读失败要兜底而不是抛
 *
 * 这个地址挂在**每一个页面**的头部。一条公告条渲染不出来,整站就塌了 ——
 * 而兜底到环境变量,顶多是「地址跟后台配的不一样」,那是「可以立刻发现的
 * 错」,不是「整站打不开」。
 *
 * 但**兜底不是静默的**:每次兜底都记一条 error 日志,运维能看见。
 *
 * ## 为什么读要用 `unstable_cache`
 *
 * 公告条和导航按钮在**每一个**营销页的 layout 里。直接读库 ⇒ 整个营销站
 * 永远动态渲染(CLAUDE.md 里明确不想要这个:「动静太大」)。
 *
 * `unstable_cache` + tag 的组合:
 *
 * - 读一次,一小时之内复用(缓存键**含参数** —— Next 把实参 JSON 化进键)
 * - 后台保存时 `revalidateTag(SITE_SETTINGS_TAG, { expire: 0 })` ⇒ 立刻作废
 * - 再配 `revalidatePath` 把 layout 的静态产物一起刷掉
 *
 * ⚠️ **报错的那一层在缓存外面** —— 异常从缓存函数里抛出来时,这一层 catch
 * 住退回环境变量。**失败不会被缓存**(抛异常的调用不会被 `unstable_cache`
 * 写进缓存),所以迁移脚本一跑,下一次请求就自动切到 DB 那一档。
 *
 * ## 同一个请求内只查一次
 *
 * layout 里公告条 + 导航按钮各要一次。用 React 的 `cache()` 包一层,同一个
 * 请求内只打一次库。
 */

import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { cache } from "react";

import { db } from "@/db";
import { siteSetting } from "@/db/schema";
import { describeDbError } from "@/features/shared/lib/db-error";

import {
  type ResolvedSiteSetting,
  resolveInternationalStoreUrl,
  resolveServiceWechatQrUrl,
  SITE_SETTING_KEYS,
  type SiteSettingKey,
} from "./site-setting";

/**
 * 缓存 tag —— 后台保存时用它作废缓存
 *
 * 一个 tag 管**所有**站点设置:以后加第二个键,不用再改这一层。
 */
export const SITE_SETTINGS_TAG = "site-settings";

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 环境变量兜底 —— 海外独立站的顾客访问地址
 *
 * `NEXT_PUBLIC_*` 是**构建期内联**的 ⇒ 改完要**重新部署**才生效。工作室
 * 2026-11-11 的要求是「**不需要环境变量,在后台设置**」⇒ 这条退成兜底。
 */
function readEnvInternationalStoreUrl(): string {
  return process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL?.trim() ?? "";
}

/**
 * 环境变量兜底 —— 客服微信二维码的图片地址(2026-11-13)
 *
 * 跟上面那条一个道理:后台那一行是真理源,环境变量退成兜底。
 *
 * ⚠️ `.env.example` 被 gitignore ⇒ 这条变量的说明只写在这儿(文件头就是
 * 活文档)。
 */
function readEnvServiceWechatQrUrl(): string {
  return process.env.NEXT_PUBLIC_SERVICE_WECHAT_QR_URL?.trim() ?? "";
}

/**
 * 读一行 —— **没缓存**(后台要看到最新的那一份)
 *
 * 查不到 = `null`(**不是空串**)—— 这两者的区别是回退链的关键:
 * `null` = 「没存过」⇒ 看环境变量;空串 = 「存了空的」⇒ **明确关掉**。
 */
async function readSiteSettingRow(key: string): Promise<string | null> {
  const rows = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

/**
 * 带缓存的读
 *
 * `unstable_cache` 的缓存键**含实参**(Next 把实参 JSON 化拼进 invocation
 * key)⇒ 一个带 key 参数的函数就够用,不用一个键写一个函数。
 */
const cachedReadSiteSetting = unstable_cache(
  async (key: string): Promise<string | null> => readSiteSettingRow(key),
  ["site-setting"],
  { revalidate: 3600, tags: [SITE_SETTINGS_TAG] }
);

/**
 * 海外独立站入口的**生效地址** —— 渲染链路上的唯一入口
 *
 * 回退链:DB 那一行 → `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL` → 空(不显示入口)。
 *
 * **不抛错** —— DB 读挂了就退回环境变量,并记一条 error 日志。
 */
export const getInternationalStoreUrl = cache(
  async (): Promise<ResolvedSiteSetting> => {
    const envValue = readEnvInternationalStoreUrl();
    try {
      const dbValue = await cachedReadSiteSetting(
        SITE_SETTING_KEYS.internationalStoreUrl
      );
      return resolveInternationalStoreUrl({ dbValue, envValue });
    } catch (error) {
      const info = describeDbError(error);
      console.error(
        "[site-settings] 读站点设置失败,退回环境变量兜底:",
        info.message || error
      );
      return resolveInternationalStoreUrl({ dbValue: null, envValue });
    }
  }
);

/**
 * 客服微信二维码的**生效图片地址** —— 渲染链路上的唯一入口(2026-11-13)
 *
 * 回退链:DB 那一行 → `NEXT_PUBLIC_SERVICE_WECHAT_QR_URL` →
 * `DEFAULT_SERVICE_WECHAT_QR_PATH`(`/service/wechat-qr.png`)。
 *
 * **不抛错** —— 跟上面那条一个口径:读挂了就退回环境变量 / 默认路径,并记
 * 一条 error 日志。页脚的客服入口不能因为一次数据库抖动就整个没了。
 */
export const getServiceWechatQrUrl = cache(
  async (): Promise<ResolvedSiteSetting> => {
    const envValue = readEnvServiceWechatQrUrl();
    try {
      const dbValue = await cachedReadSiteSetting(
        SITE_SETTING_KEYS.serviceWechatQrUrl
      );
      return resolveServiceWechatQrUrl({ dbValue, envValue });
    } catch (error) {
      const info = describeDbError(error);
      console.error(
        "[site-settings] 读客服二维码设置失败,退回默认路径:",
        info.message || error
      );
      return resolveServiceWechatQrUrl({ dbValue: null, envValue });
    }
  }
);

/* -------------------------------------------------------------------------- */
/*  后台要的那一份                                                             */
/* -------------------------------------------------------------------------- */

/** 后台概览 —— 生效值 + 它从哪儿来 + 有没有读错 */
export interface SiteSettingsOverview {
  /** 生效值(能拿去渲染的那个) */
  resolved: ResolvedSiteSetting;
  /** DB 里那一行的原始值 —— `null` = 没存过 */
  dbValue: string | null;
  /** 环境变量里的那个值(空 = 没配) */
  envValue: string;
  /** 读挂了 —— 人话(表还没建 / 连不上) */
  readError: string | null;
  /** 表还没建(迁移脚本没跑) */
  missingRelation: boolean;
  /**
   * 客服微信二维码 —— 生效值(2026-11-13)
   *
   * 跟上面那套是**两个独立的设置**:一个挂了不影响另一个。
   */
  serviceQr: ResolvedSiteSetting;
  /** 二维码那一行在 DB 里的原始值 —— `null` = 没存过 */
  serviceQrDbValue: string | null;
  /** 二维码的环境变量值(空 = 没配) */
  serviceQrEnvValue: string;
}

/**
 * 后台要的一整套 —— **不走缓存**
 *
 * 后台要看到**真话**:刚保存完刷新一下,看到的必须是刚存的那个值,不是
 * 缓存里的旧值。
 *
 * ⚠️ **两项各自 try/catch** —— 读海外独立站那一行挂了,不该把客服二维码
 * 那一项也拖下水(反之亦然)。后台少显示一项,比整页报错好。
 */
export async function getSiteSettingsOverview(): Promise<SiteSettingsOverview> {
  const envValue = readEnvInternationalStoreUrl();
  const serviceQrEnvValue = readEnvServiceWechatQrUrl();

  let resolved: ResolvedSiteSetting;
  let dbValue: string | null = null;
  let readError: string | null = null;
  let missingRelation = false;

  try {
    dbValue = await readSiteSettingRow(SITE_SETTING_KEYS.internationalStoreUrl);
    resolved = resolveInternationalStoreUrl({ dbValue, envValue });
  } catch (error) {
    const info = describeDbError(error);
    console.error(
      "[site-settings] 读后台概览失败,退回环境变量兜底:",
      info.message || error
    );
    resolved = resolveInternationalStoreUrl({ dbValue: null, envValue });
    dbValue = null;
    readError = info.missingRelation
      ? "站点设置的表还不存在(迁移脚本没跑)"
      : `读站点设置失败:${info.message}`;
    missingRelation = info.missingRelation;
  }

  let serviceQr: ResolvedSiteSetting;
  let serviceQrDbValue: string | null = null;

  try {
    serviceQrDbValue = await readSiteSettingRow(
      SITE_SETTING_KEYS.serviceWechatQrUrl
    );
    serviceQr = resolveServiceWechatQrUrl({
      dbValue: serviceQrDbValue,
      envValue: serviceQrEnvValue,
    });
  } catch (error) {
    const info = describeDbError(error);
    console.error(
      "[site-settings] 读客服二维码设置失败,退回默认路径:",
      info.message || error
    );
    serviceQr = resolveServiceWechatQrUrl({
      dbValue: null,
      envValue: serviceQrEnvValue,
    });
  }

  return {
    resolved,
    dbValue,
    envValue,
    readError,
    missingRelation,
    serviceQr,
    serviceQrDbValue,
    serviceQrEnvValue,
  };
}

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 写**一行**(upsert)
 *
 * 存**归一化之后**的值 —— 后台的「当前生效值」跟页面上的链接要一模一样,
 * 否则工作室会看到「我存的是 https://x.com/,页面上是 https://x.com」而
 * 以为出了两个地址。
 */
export async function saveSiteSetting(
  key: SiteSettingKey,
  value: string
): Promise<void> {
  const payload = { key, value, updatedAt: new Date() };
  await db
    .insert(siteSetting)
    .values(payload)
    .onConflictDoUpdate({
      target: siteSetting.key,
      set: { value: payload.value, updatedAt: payload.updatedAt },
    });
}

/**
 * 写**多项**设置 —— **一个事务**里全写完(2026-11-13)
 *
 * 后台现在是**一张表单两个字段**(海外独立站地址 + 客服二维码地址),点一次
 * 「保存」两个都写。
 *
 * ## 为什么要一个事务
 *
 * 分两次写 ⇒ 可能出现「独立站存进去了、二维码没存进去」的**半截状态** ——
 * 工作室刷新一下看到的是两个不同版本的设置,会以为出了鬼(而且说不清是哪
 * 一半生效了)。
 *
 * 一个事务 ⇒ 要么两个都在,要么两个都不在。
 */
export async function saveSiteSettings(
  entries: Array<{ key: SiteSettingKey; value: string }>
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const payload = {
        key: entry.key,
        value: entry.value,
        updatedAt: new Date(),
      };
      await tx
        .insert(siteSetting)
        .values(payload)
        .onConflictDoUpdate({
          target: siteSetting.key,
          set: { value: payload.value, updatedAt: payload.updatedAt },
        });
    }
  });
}

/**
 * 删掉一行 —— **退回环境变量那一档**
 *
 * 「删掉」不是「关掉」:关掉是**存一个空串**(那样入口不出现,但后台还
 * 看得见「这一项被工作室关掉了」)。删掉 = 「我没配过这一项」⇒ 退回
 * 环境变量。
 */
export async function deleteSiteSetting(key: SiteSettingKey): Promise<void> {
  await db.delete(siteSetting).where(eq(siteSetting.key, key));
}
