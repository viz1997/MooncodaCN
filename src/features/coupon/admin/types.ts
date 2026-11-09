/**
 * 优惠码后台的**视图模型**
 *
 * ## 为什么单独一个文件
 *
 * 类型**不能**放在 `"use server"` 文件里 —— Turbopack 会把那个文件里的
 * 每一个 export 都注册成 server action,类型 re-export 会注册出一个不存在
 * 的 action,运行时 `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 所以 `actions.ts` 只导出 async 函数,类型全在这个纯文件里。
 *
 * ## 折扣率是**小数**
 *
 * `discountRate` 在 DB 里是 `numeric(6,4)`(0.15 = 减 15%),在界面上也用
 * 小数 —— 换算成百分比是**显示层**的事(后台表单填 15,提交转 0.15)。
 */

import type {
  CouponKind,
  CouponRule,
  CouponScope,
} from "@/features/coupon/lib/coupon-calc";
import { rateToUnits } from "@/features/coupon/lib/coupon-calc";

/** 后台列表的一行 */
export type AdminCoupon = {
  id: string;
  /** 大写归一化后的码 */
  code: string;
  /** 后台显示的名字(「双十一满减」) */
  name: string;
  kind: CouponKind;
  /** 面额(分)—— `kind = "amount"` */
  amountCents: number | null;
  /** 折扣率(0~1)—— `kind = "percent"`;0.15 = 减 15% */
  discountRate: number | null;
  /** 折扣封顶(分)—— `kind = "percent"`;null = 不封顶 */
  maxDiscountCents: number | null;
  /** 满多少才用(分)—— 跟折后小计比;0 = 没门槛 */
  minAmountCents: number;
  scope: CouponScope;
  /** 新人首单券 —— 叠在任意 kind 上的修饰 */
  firstOrderOnly: boolean;
  /** 总次数上限 —— null = 不限 */
  usageLimit: number | null;
  /** 每人限用次数 —— null = 不限 */
  perUserLimit: number | null;
  /** 已用次数 */
  usedCount: number;
  /** 生效时间 —— ISO 串;null = 立即生效 */
  startsAt: string | null;
  /** 失效时间 —— ISO 串;null = 永不过期 */
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * 后台写操作的错误码
 *
 * **不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,工作室
 * 根本不知道是哪儿错了(码重复?类型不合法?)。
 */
export type AdminCouponErrorCode =
  /** 码重复 —— 撞了唯一索引 */
  | "CODE_DUPLICATE"
  /** 改的这一行找不到了(可能被别人删了) */
  | "COUPON_NOT_FOUND"
  /** 规则不自洽 —— 满减没有面额 / 百分比没有折扣率 / 失效早于生效 */
  | "INVALID_RULE"
  /** 表还不存在 —— 迁移脚本没跑 */
  | "MIGRATION_MISSING"
  /** 其它失败 */
  | "SAVE_FAILED";

/** 写操作的统一返回 */
export type AdminCouponWriteResult =
  | { ok: true }
  | { ok: false; code: AdminCouponErrorCode };

/**
 * DB 行 → 后台列表的一行
 *
 * **入参是结构化的,不是 `CouponRecord`** —— 那个类型住在
 * `coupon-store.ts`(它 import `@/db`),把这个文件拖进 DB 就进不了
 * `unit` project 了。`CouponRecord` 本身**结构上兼容**这个入参。
 */
export interface AdminCouponSource {
  id: string;
  code: string;
  name: string;
  rule: CouponRule;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DB 行 → 后台列表的一行
 *
 * **折扣率要转成小数** —— DB 里是 `numeric`,Drizzle 读出来是**字符串**
 * ("0.1500")。这里用 `rateToUnits()` 做精确的字符串解析,再除回 10000,
 * 界面上拿到的就是 0.15。
 */
export function toAdminCoupon(source: AdminCouponSource): AdminCoupon {
  const rule = source.rule;
  const units = rateToUnits(rule.discountRate ?? null);

  return {
    id: source.id,
    code: source.code,
    name: source.name,
    kind: rule.kind,
    amountCents: rule.amountCents ?? null,
    discountRate: rule.discountRate == null ? null : units / 10_000,
    maxDiscountCents: rule.maxDiscountCents ?? null,
    minAmountCents: Math.max(0, Math.floor(rule.minAmountCents ?? 0)),
    scope: rule.scope,
    firstOrderOnly: rule.firstOrderOnly,
    usageLimit: rule.usageLimit ?? null,
    perUserLimit: rule.perUserLimit ?? null,
    usedCount: Math.max(0, Math.floor(rule.usedCount ?? 0)),
    startsAt: rule.startsAt ? rule.startsAt.toISOString() : null,
    endsAt: rule.endsAt ? rule.endsAt.toISOString() : null,
    isActive: rule.isActive !== false,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
