"use server";

/**
 * /admin/coupons —— 优惠码后台 server actions(2026-11-08)
 *
 * 工作室要能自己发券:满减 / 百分比 / 免运费 / 新人首单。这一组 action 是
 * 那条路的唯一写入口:
 *
 * - `adminListCouponsAction` —— 读列表
 * - `adminSaveCouponAction` —— 新增 / 修改(有 id = 改)
 * - `adminDeactivateCouponAction` —— 停用(**不删**)
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(是码重复?是表还没建?)。所以这里把**能预见的**失败都变成一个
 * code,界面照着 code 给话。
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

import { normalizeCouponCode } from "@/features/coupon/lib/coupon-calc";
import {
  deactivateCoupon,
  listCoupons,
  saveCoupon,
} from "@/features/coupon/lib/coupon-store";
import { describeDbError } from "@/features/shared/lib/db-error";
import { adminAction } from "@/lib/safe-action";

import {
  type AdminCoupon,
  type AdminCouponWriteResult,
  toAdminCoupon,
} from "./types";

const withAdminCouponAction = (name: string) =>
  adminAction.metadata({ action: `admin.coupon.${name}` });

/** 每次写完都要刷的路径 */
const REVALIDATE_PATH = "/[locale]/admin/coupons";

/* -------------------------------------------------------------------------- */
/*  校验                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 码的校验
 *
 * **允许的字符**:字母 / 数字 / 连字符 / 下划线。
 *
 * 码会出现在 URL 之外的地方(用户手输、后台列表、订单行),但**不该出现
 * 空格和标点** —— 用户从聊天记录里复制一个带空格 / 全角括号的码过来,
 * 输进去认不出来,而「码不存在」这句话对用户毫无帮助。
 *
 * 归一化(大写 + 去空格)在 `normalizeCouponCode()` 里 —— 后台建码和用户
 * 输入走**同一份**口径,否则建了 `ABC123` 而用户输 `abc123` 就找不到。
 */
const codeSchema = z
  .string()
  .min(2, "码至少 2 个字符")
  .max(32, "码最多 32 个字符")
  .regex(/^[A-Za-z0-9_-]+$/, "码只能用字母、数字、连字符和下划线");

/** 保存一张券的入参 */
const couponSchema = z.object({
  /** 有 id = 改这一行;没 id = 新增 */
  id: z.string().min(1).max(64).nullish(),
  code: codeSchema,
  name: z.string().min(1, "名称必填").max(64),
  kind: z.enum(["amount", "percent", "free_shipping"]),
  /** 面额(分)—— `kind = "amount"` */
  amountCents: z.number().int().min(0).max(1_000_000).nullish(),
  /** 折扣率(0~1)—— `kind = "percent"` */
  discountRate: z.number().min(0).max(1).nullish(),
  /** 折扣封顶(分)—— `kind = "percent"` */
  maxDiscountCents: z.number().int().min(0).max(1_000_000).nullish(),
  /** 满多少(分)—— 跟折后小计比 */
  minAmountCents: z.number().int().min(0).max(100_000_000).nullish(),
  scope: z.enum(["mall", "print", "both"]),
  /** 新人首单券 —— 叠在任意 kind 上的修饰 */
  firstOrderOnly: z.boolean(),
  /** 总次数上限 —— null = 不限 */
  usageLimit: z.number().int().min(1).max(1_000_000).nullish(),
  /** 每人限用次数 —— null = 不限 */
  perUserLimit: z.number().int().min(1).max(1_000_000).nullish(),
  /** 生效时间 —— ISO 串;null = 立即生效 */
  startsAt: z.iso.datetime().nullish(),
  /** 失效时间 —— ISO 串;null = 永不过期 */
  endsAt: z.iso.datetime().nullish(),
  isActive: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/*  小工具                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 唯一索引撞了 —— Postgres 错误码 `23505`
 *
 * Drizzle 会把底层错误包一层(`DrizzleQueryError` → `cause`),所以这里
 * 顺着 `cause` 链找一层。找不到就当「不是重复」—— 宁可让操作报错,也不
 * 要把一次真失败说成成功。
 */
function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    if (record.cause) {
      current = record.cause;
      continue;
    }
    break;
  }
  return false;
}

/** ISO 串 → Date;空 = null */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读后台列表
 *
 * **停用的也返回** —— 停用不是删除,历史订单还引用着它,后台要能看见并
 * 重新启用。
 */
export const adminListCouponsAction = withAdminCouponAction("list").action(
  async (): Promise<AdminCoupon[]> => {
    const records = await listCoupons();
    return records.map(toAdminCoupon);
  }
);

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 新增 / 修改一张券
 *
 * ## 类型的字段跟类型**对齐**
 *
 * - `amount` 券:面额必填,折扣率 / 封顶清成 null
 * - `percent` 券:折扣率必填(且 > 0),面额清成 null
 * - `free_shipping` 券:面额 / 折扣率 / 封顶**全清成 null**
 *
 * 不清的话,后台改一张券的类型,上一张券的残留数字会跟着进 DB ——
 * 比如把「满减」改成「免运费」,面额还留在那儿,界面看着别扭,判定的
 * 时候也可能走错分支。
 */
export const adminSaveCouponAction = withAdminCouponAction("save")
  .schema(couponSchema)
  .action(async ({ parsedInput }): Promise<AdminCouponWriteResult> => {
    const kind = parsedInput.kind;

    // 类型相关的字段**按类型对齐** —— 不留上一个类型的残留
    //
    // `?? null` 是必须的:`exactOptionalPropertyTypes` 下可选属性**一旦
    // 出现**就不能是 `undefined`,而 zod 的 `.nullish()` 出来的类型是
    // `T | null | undefined`。
    const amountCents =
      kind === "amount" ? (parsedInput.amountCents ?? null) : null;
    const discountRate =
      kind === "percent" ? (parsedInput.discountRate ?? null) : null;
    const maxDiscountCents =
      kind === "percent" ? (parsedInput.maxDiscountCents ?? null) : null;

    // 满减券没有面额 → 等于一张减 0 的券,界面上看不出问题但用户会问
    if (kind === "amount" && !amountCents) {
      return { ok: false, code: "INVALID_RULE" };
    }
    // 百分比券没有折扣率 → 减 0%
    if (kind === "percent" && !discountRate) {
      return { ok: false, code: "INVALID_RULE" };
    }

    const startsAt = toDate(parsedInput.startsAt);
    const endsAt = toDate(parsedInput.endsAt);

    // 失效时间不能早于生效时间 —— 否则券建出来就是「已过期」
    if (startsAt && endsAt && endsAt < startsAt) {
      return { ok: false, code: "INVALID_RULE" };
    }

    try {
      await saveCoupon({
        id: parsedInput.id ?? null,
        code: normalizeCouponCode(parsedInput.code),
        name: parsedInput.name.trim(),
        kind,
        amountCents,
        discountRate,
        maxDiscountCents,
        minAmountCents: parsedInput.minAmountCents ?? 0,
        scope: parsedInput.scope,
        firstOrderOnly: parsedInput.firstOrderOnly,
        usageLimit: parsedInput.usageLimit ?? null,
        perUserLimit: parsedInput.perUserLimit ?? null,
        startsAt,
        endsAt,
        isActive: parsedInput.isActive,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, code: "CODE_DUPLICATE" };
      }
      const info = describeDbError(error);
      console.error("[coupon] 保存优惠码失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/**
 * 停用(**不删**)
 *
 * 真删的话,历史订单还引用着它 —— 那些订单就查不出「当时用了什么码」,
 * 对账时没有线索。所以这里只停用(`is_active = false`),行留着。
 *
 * 停用之后,正在用这张码的用户在购物袋里会看到「这张券已停用」——
 * 券不可用是**说人话**的,不是静默按原价收。
 */
export const adminDeactivateCouponAction = withAdminCouponAction("deactivate")
  .schema(z.object({ id: z.string().min(1).max(64) }))
  .action(async ({ parsedInput }): Promise<AdminCouponWriteResult> => {
    try {
      await deactivateCoupon(parsedInput.id);
    } catch (error) {
      const info = describeDbError(error);
      console.error("[coupon] 停用优惠码失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/*
 * `AdminCoupon` / `AdminCouponWriteResult` / `AdminCouponErrorCode` **不在
 * 这里 re-export** —— 「use server」文件只能导出 async 函数,类型
 * re-export 会被 Turbopack 注册成 server action,运行时引用一个不存在的
 * 类型绑定 → ReferenceError,整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 界面从 `@/features/coupon/admin/types` 直接 import 那些类型。
 */
