"use server";

/**
 * /admin/showcases —— 案例展示的 server actions
 *
 * 这一组 action 是 `storefront_case` 表的**唯一写入口**:
 *
 * - `adminListShowcaseCasesAction` —— 读案例列表(后台要能看见停用的)
 * - `adminSaveShowcaseCaseAction` —— 新增 / 修改
 * - `adminSetShowcaseCaseActiveAction` —— 上架 / 下架
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(表还没建?图片引用不合法?)。所以**能预见的**失败都变成一个 code,
 * 界面照着 code 给话。
 *
 * ## 「use server」文件只导出 async 函数
 *
 * 类型**不能**在这里 re-export —— Turbopack 会把它注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。类型全在
 * `./types.ts`。
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { describeDbError } from "@/features/shared/lib/db-error";
import { normalizeImageRef } from "@/features/showcase/lib/case-apply";
import { resolveShowcaseImageSrc } from "@/features/showcase/lib/case-image";
import {
  getShowcaseCaseById,
  listShowcaseCases,
  saveShowcaseCase,
  setShowcaseCaseActive,
} from "@/features/showcase/lib/case-store";
import { adminAction } from "@/lib/safe-action";

import type {
  AdminShowcaseListResult,
  AdminShowcaseWriteResult,
} from "./types";
import { toAdminShowcase } from "./types";

const withAdminShowcaseAction = (name: string) =>
  adminAction.metadata({ action: `admin.showcase.${name}` });

/** 每次写完都要刷的路径(后台自己那一页) */
const REVALIDATE_ADMIN_PATH = "/[locale]/admin/showcases";

/**
 * 前台摆案例的那两页
 *
 * 首页和作品集页都摆案例 ⇒ 改完案例两处都要刷新。
 *
 * ⚠️ 那两页本来就是 `force-dynamic`(价来自 DB),`revalidatePath` 是为了把
 * **客户端 Router Cache** 和 RSC 载荷缓存一起清掉 —— 只刷 `page` 不刷
 * `layout` 时,挂在 layout 上的公告条那一层不受影响(那不是案例)。
 */
const REVALIDATE_STOREFRONT_PATHS = [
  "/[locale]",
  "/[locale]/products",
] as const;

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读案例列表(后台)
 *
 * **停用的也返回** —— 后台要能看见「这一条已经下架了」,不然工作室根本
 * 不知道之前发过什么。
 *
 * 表还没建(迁移脚本没跑)时返 `{ok:false, code:"MIGRATION_MISSING"}` ——
 * 界面显示「先跑 `pnpm migrate:apply-showcase`」,不是 500。
 */
export const adminListShowcaseCasesAction = withAdminShowcaseAction("list")
  .schema(z.object({}))
  .action(async (): Promise<AdminShowcaseListResult> => {
    try {
      const records = await listShowcaseCases({ includeInactive: true });
      // 图片地址在**服务端**解析 —— 解析那一层 import 了 R2,客户端组件自己算不了
      return {
        ok: true,
        cases: records.map((record) =>
          toAdminShowcase(record, {
            coverSrc: resolveShowcaseImageSrc(record.coverUrl),
            beforeSrc: resolveShowcaseImageSrc(record.beforeImageUrl),
          })
        ),
      };
    } catch (error) {
      const info = describeDbError(error);
      console.error("[showcase] 读案例列表失败:", info.message);
      return { ok: false, code: "MIGRATION_MISSING" };
    }
  });

/* -------------------------------------------------------------------------- */
/*  写:保存                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 保存的入参
 *
 * 图片引用**只接受两种形状**:完整外链(`https://…`)或者 R2 对象键
 * (`showcases/…`)—— 别的形状(相对路径、`javascript:`、`data:`)一律拒。
 * 校验用 `normalizeImageRef()`,那是**同一份**前台也在用的纯函数。
 */
const saveShowcaseCaseSchema = z.object({
  /** 有 id = 改这一行;null = 新增 */
  id: z.string().min(1).max(64).nullable(),
  title: z.string().min(1, "标题不能为空").max(120),
  titleEn: z.string().max(120).nullish(),
  description: z.string().max(500).nullish(),
  descriptionEn: z.string().max(500).nullish(),
  /** 成品图引用 —— 外链或 R2 对象键 */
  coverUrl: z.string().min(1, "成品图不能为空").max(2000),
  /** 原图引用 —— null = 没有 before/after 翻转 */
  beforeImageUrl: z.string().max(2000).nullish(),
  /** 作者名 —— 空串也合法(前台就不摆那一行) */
  authorName: z.string().max(80),
  productTypeCode: z.string().max(32).nullish(),
  productHandle: z.string().max(120).nullish(),
  likes: z.number().int().min(0).max(1_000_000),
  sortOrder: z.number().int().min(0).max(100_000),
  isActive: z.boolean(),
});

/**
 * 新增 / 修改一条案例
 *
 * ## 图片引用在这里**再验一次**
 *
 * zod 只管长度,不管形状 —— `javascript:alert(1)` 能过 zod(它是 20 个字符的
 * 字符串)。`normalizeImageRef()` 才是权威判断:非法就返回空串 ⇒ 这一条
 * 返 `INVALID_INPUT`,**一个字节都不写库**。
 *
 * ⚠️ 前台渲染时图片地址是拼进 `<img src>` 的 —— 放一个 `javascript:` 进去
 * 就是一个 XSS 口子。
 */
export const adminSaveShowcaseCaseAction = withAdminShowcaseAction("save")
  .schema(saveShowcaseCaseSchema)
  .action(async ({ parsedInput }): Promise<AdminShowcaseWriteResult> => {
    const coverUrl = normalizeImageRef(parsedInput.coverUrl);
    if (!coverUrl) {
      return { ok: false, code: "INVALID_INPUT" };
    }

    // 原图是**可选**的 —— 但填了就必须合法
    const rawBefore = parsedInput.beforeImageUrl?.trim() ?? "";
    const beforeImageUrl = rawBefore ? normalizeImageRef(rawBefore) : null;
    if (rawBefore && !beforeImageUrl) {
      return { ok: false, code: "INVALID_INPUT" };
    }

    // 改已有的一行时,先确认它还在(可能被别人下架 / 删了)
    if (parsedInput.id) {
      const existing = await getShowcaseCaseById(parsedInput.id).catch(
        (error: unknown) => {
          const info = describeDbError(error);
          console.error("[showcase] 读案例失败:", info.message);
          return null;
        }
      );
      if (existing === null) {
        // 读失败(表不存在)和「读到了但没这一行」要分开说
        try {
          await getShowcaseCaseById(parsedInput.id);
        } catch {
          return { ok: false, code: "MIGRATION_MISSING" };
        }
        return { ok: false, code: "CASE_NOT_FOUND" };
      }
    }

    try {
      await saveShowcaseCase({
        id: parsedInput.id,
        title: parsedInput.title,
        titleEn: parsedInput.titleEn ?? null,
        description: parsedInput.description ?? null,
        descriptionEn: parsedInput.descriptionEn ?? null,
        coverUrl,
        beforeImageUrl,
        authorName: parsedInput.authorName,
        productTypeCode: parsedInput.productTypeCode ?? null,
        productHandle: parsedInput.productHandle ?? null,
        likes: parsedInput.likes,
        sortOrder: parsedInput.sortOrder,
        isActive: parsedInput.isActive,
      });
    } catch (error) {
      const info = describeDbError(error);
      console.error("[showcase] 保存案例失败:", info.message);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_ADMIN_PATH, "page");
    for (const path of REVALIDATE_STOREFRONT_PATHS) {
      revalidatePath(path, "page");
    }

    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*  写:上架 / 下架                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 上架 / 下架
 *
 * **下架,不是删** —— R2 桶策略锁着对象(删不掉),案例也一样:停用一行,
 * 那一行还在库里,随时能重新上架。
 */
export const adminSetShowcaseCaseActiveAction = withAdminShowcaseAction(
  "setActive"
)
  .schema(
    z.object({
      id: z.string().min(1).max(64),
      isActive: z.boolean(),
    })
  )
  .action(async ({ parsedInput }): Promise<AdminShowcaseWriteResult> => {
    try {
      await setShowcaseCaseActive(parsedInput.id, parsedInput.isActive);
    } catch (error) {
      const info = describeDbError(error);
      console.error("[showcase] 改上下架失败:", info.message);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_ADMIN_PATH, "page");
    for (const path of REVALIDATE_STOREFRONT_PATHS) {
      revalidatePath(path, "page");
    }

    return { ok: true };
  });
