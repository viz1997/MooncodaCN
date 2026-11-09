/**
 * 优惠码的**数据库读写** —— 服务端专用
 *
 * 纯逻辑那一半在 `coupon-calc.ts`(零 import,能进 unit project 跑单测)。
 * 这里只干三件事:
 *
 * 1. 读:码 → 规则 / 后台列表
 * 2. 写:后台增删改 + 建单时记账(`redeemCoupon`)
 * 3. 兜底:DB 读挂了 → **不抛**,返回 null,让调用点决定怎么办
 *
 * ## 为什么读失败不抛
 *
 * 下单链路是收钱的。DB 抖一下就把整条下单链路炸掉,工作室会看到
 * 「下单失败」;而券读不到 → 当作「没有券」→ 按原价收,顶多是用户少用了一张
 * 券 —— 那是「可以立刻发现的错」,不是「用户下不了单」。
 *
 * 但**兜底不是静默的**:每次兜底都记一条 error 日志。
 *
 * ## 同一个请求内只查一次
 *
 * 用 React 的 `cache()` 包一层。跨请求不缓存 —— 后台改完券要**立刻**生效。
 */

import { and, asc, desc, eq, lt, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cache } from "react";

import { db } from "@/db";
import {
  coupon,
  couponRedemption,
  printOrder,
  storefrontOrder,
} from "@/db/schema";
import type { DbOrTx } from "@/features/gpt-image/lib/order-history";
import {
  type CouponKind,
  type CouponRule,
  type CouponScope,
  normalizeCouponCode,
} from "./coupon-calc";

/* -------------------------------------------------------------------------- */
/*  形状                                                                       */
/* -------------------------------------------------------------------------- */

/** 一张券(读出来的样子) */
export interface CouponRecord {
  id: string;
  /** 大写归一化后的码 */
  code: string;
  /** 后台列表显示的名字 */
  name: string;
  /** 算钱 + 判定要用的全部字段 */
  rule: CouponRule;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 用券记录里的「订单种类」
 *
 * **跟 `CouponOrderKind` 不是一回事** —— 那两个是「这张单是商城单还是打印
 * 工单」(`mall` / `print`),这两个是「这条记录挂在哪张表上」
 * (`storefront` / `print`)。表名是 `storefront_order` / `print_order`,
 * 照着表名走。
 */
export type CouponRedemptionKind = "storefront" | "print";

/** 后台保存时要传的字段 */
export interface SaveCouponInput {
  /** 有 id = 改,没 id = 新增 */
  id?: string | null;
  code: string;
  name: string;
  kind: CouponKind;
  /** 面额(分)—— `kind = "amount"` */
  amountCents?: number | null;
  /** 折扣率(0~1)—— `kind = "percent"` */
  discountRate?: number | null;
  /** 折扣封顶(分)—— `kind = "percent"` */
  maxDiscountCents?: number | null;
  /** 满多少(分)—— 跟折后小计比 */
  minAmountCents?: number | null;
  scope: CouponScope;
  firstOrderOnly: boolean;
  usageLimit?: number | null;
  perUserLimit?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive: boolean;
}

/* -------------------------------------------------------------------------- */
/*  行 → 规则                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * DB 行 → `CouponRule`
 *
 * `discount_rate` 是 `numeric` —— Drizzle 读出来是**字符串**。
 * 原样带出去(`coupon-calc.ts` 里有精确的字符串解析),别在这儿转成浮点。
 */
function toRule(row: typeof coupon.$inferSelect): CouponRule {
  return {
    kind: row.kind as CouponKind,
    amountCents: row.amountCents,
    discountRate: row.discountRate,
    maxDiscountCents: row.maxDiscountCents,
    minAmountCents: row.minAmountCents,
    scope: row.scope as CouponScope,
    firstOrderOnly: row.firstOrderOnly,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    perUserLimit: row.perUserLimit,
  };
}

function toRecord(row: typeof coupon.$inferSelect): CouponRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    rule: toRule(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 按码查券 —— **找不到就是 null**
 *
 * 码在查之前**归一化**(大写 + 去空格)—— 用户输 `abc123` 和 `ABC123`
 * 是同一个码。
 *
 * **读失败也返回 null** —— 调用点(购物袋 / 结算)会把 null 当成「没有券」。
 */
export const getCouponByCode = cache(
  async (code: string): Promise<CouponRecord | null> => {
    const normalized = normalizeCouponCode(code);
    if (!normalized) return null;
    try {
      const rows = await db
        .select()
        .from(coupon)
        .where(eq(coupon.code, normalized))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    } catch (error) {
      console.error("[coupon] 按码查券失败:", error);
      return null;
    }
  }
);

/** 按 id 查券 */
export const getCouponById = cache(
  async (id: string): Promise<CouponRecord | null> => {
    try {
      const rows = await db
        .select()
        .from(coupon)
        .where(eq(coupon.id, id))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    } catch (error) {
      console.error("[coupon] 按 id 查券失败:", error);
      return null;
    }
  }
);

/**
 * 后台列表 —— 停用的**也返回**
 *
 * 停用不是删除 —— 历史订单还引用着它,后台要能看见并重新启用。
 */
export async function listCoupons(): Promise<CouponRecord[]> {
  const rows = await db
    .select()
    .from(coupon)
    .orderBy(desc(coupon.createdAt), asc(coupon.code));
  return rows.map(toRecord);
}

/**
 * 这个人用过这个码几次
 *
 * 「每人限用次数」的判定靠它。游客不查(游客压根不能用限次券)。
 */
export async function countUserCouponRedemptions(
  couponId: string,
  userId: string
): Promise<number> {
  try {
    const rows = await db
      .select({ id: couponRedemption.id })
      .from(couponRedemption)
      .where(
        and(
          eq(couponRedemption.couponId, couponId),
          eq(couponRedemption.userId, userId)
        )
      );
    return rows.length;
  } catch (error) {
    console.error("[coupon] 查用户用券次数失败:", error);
    // 查不到就当「用了很多次」—— 宁可少给券,也不能多给
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * 这个用户下过单没有 —— 「新人首单券」的判定
 *
 * **商城订单和打印工单两边都查**,任一有记录就不是新人。
 *
 * - 商城:`status != 'cancelled'`
 * - 打印:`status != 'CANCELLED'`
 *
 * **待付款的单也算**(`unpaid` / `PENDING`)—— 不然用户可以用同一张卡
 * 无限次占券(下单 → 不付 → 再下一单)。
 */
export async function userHasAnyOrder(userId: string): Promise<boolean> {
  try {
    const [mallRows, printRows] = await Promise.all([
      db
        .select({ id: storefrontOrder.id })
        .from(storefrontOrder)
        .where(
          and(
            eq(storefrontOrder.userId, userId),
            ne(storefrontOrder.status, "cancelled")
          )
        )
        .limit(1),
      db
        .select({ id: printOrder.id })
        .from(printOrder)
        .where(
          and(eq(printOrder.userId, userId), ne(printOrder.status, "CANCELLED"))
        )
        .limit(1),
    ]);
    return mallRows.length > 0 || printRows.length > 0;
  } catch (error) {
    console.error("[coupon] 查用户订单失败:", error);
    // 查不到 → 当成「下过单」—— 宁可不给新人券
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 后台保存(新增 / 修改)
 *
 * `code` 唯一 —— 重复会撞唯一索引,由上层翻译成 `{ok:false, code}`。
 */
export async function saveCoupon(
  input: SaveCouponInput
): Promise<CouponRecord> {
  const payload = {
    code: normalizeCouponCode(input.code),
    name: input.name.trim(),
    kind: input.kind,
    amountCents:
      input.amountCents === undefined || input.amountCents === null
        ? null
        : Math.round(input.amountCents),
    // `numeric` 列存字符串
    discountRate:
      input.discountRate === undefined || input.discountRate === null
        ? null
        : String(input.discountRate),
    maxDiscountCents:
      input.maxDiscountCents === undefined || input.maxDiscountCents === null
        ? null
        : Math.round(input.maxDiscountCents),
    minAmountCents:
      input.minAmountCents === undefined || input.minAmountCents === null
        ? 0
        : Math.round(input.minAmountCents),
    scope: input.scope,
    firstOrderOnly: input.firstOrderOnly,
    usageLimit: input.usageLimit ?? null,
    perUserLimit: input.perUserLimit ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    isActive: input.isActive,
    updatedAt: new Date(),
  };

  if (input.id) {
    const rows = await db
      .update(coupon)
      .set(payload)
      .where(eq(coupon.id, input.id))
      .returning();
    const row = rows[0];
    if (!row) throw new Error("更新优惠码失败:找不到这一行");
    return toRecord(row);
  }

  const rows = await db
    .insert(coupon)
    .values({ id: nanoid(), ...payload })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("新增优惠码失败:没有返回行");
  return toRecord(row);
}

/**
 * 停用(不删)
 *
 * 历史订单还引用着它 —— 删了那些订单就查不出「当时用了什么码」。
 */
export async function deactivateCoupon(id: string): Promise<void> {
  await db
    .update(coupon)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(coupon.id, id));
}

/**
 * 券的**总量上限**在建单那一刻用完了
 *
 * 调用点把它翻译成用户能看懂的话(商城侧是 `COUPON_LIMIT_REACHED`)。
 */
export class CouponUsageLimitError extends Error {
  constructor() {
    super("优惠码的可用次数已经用完");
    this.name = "CouponUsageLimitError";
  }
}

/**
 * 记一次用券 —— **幂等**
 *
 * ## 幂等靠唯一索引 `(order_kind, order_id)`
 *
 * 建单请求重投不能把 `used_count` 加两遍。所以插入用
 * `onConflictDoNothing`:**插不进去就说明这一单已经记过了**,直接返回。
 *
 * ## 用量上限是**硬闸**(2026-11-08)
 *
 * `used_count` 的自增带一个 `used_count < usage_limit` 的 WHERE 守卫 ——
 * 并发下单把额度抢完了的话,自增会**停在上限**,不会冲过去。
 *
 * 停在上限意味着「这一单已经记下用券了,但额度没加上」⇒ 这张券被**超发**
 * 了一次。超发一次 = 工作室的预算多让出去一次 ⇒ **不能让这一单成立**:
 *
 * - 记下用券 + 自增,在**调用方的事务**里做(`tx` 参数)——
 *   守卫不通过就抛 `CouponUsageLimitError`,调用方那个事务**回滚**
 *   (订单不成立),用户拿到一句「这个优惠码已经用完了」。
 * - 不传 `tx` 时自己开一个事务 —— 插入和自增**同生共死**,
 *   不会出现「记了用券、额度没加」那种半截状态。
 *
 * ## 守卫通过但额度不限(`usageLimit == null`)
 *
 * 自增一定会成功(除非券那一行没了)⇒ 不会抛。
 */
export async function redeemCoupon(params: {
  couponId: string;
  userId: string;
  orderKind: CouponRedemptionKind;
  orderId: string;
  /** 这一单优惠了多少(分) */
  discountCents: number;
  /** 判定期拿到的总量上限 —— 传进来是为了给自增加守卫 */
  usageLimit?: number | null;
  /**
   * 调用方的事务 —— 传了就跟建单在同一个事务里
   *
   * **额度闸要能回滚订单** —— 两件事必须同生共死。
   */
  tx?: DbOrTx;
}): Promise<{ recorded: boolean; usageIncremented: boolean }> {
  const run = async (executor: DbOrTx) => {
    const inserted = await executor
      .insert(couponRedemption)
      .values({
        id: nanoid(),
        couponId: params.couponId,
        userId: params.userId,
        orderKind: params.orderKind,
        orderId: params.orderId,
        discountCents: Math.round(params.discountCents),
      })
      .onConflictDoNothing({
        target: [couponRedemption.orderKind, couponRedemption.orderId],
      })
      .returning();

    if (inserted.length === 0) {
      // 已经记过了 —— 重投的建单请求,不再加用量
      return { recorded: false, usageIncremented: false };
    }

    const guard =
      params.usageLimit === null || params.usageLimit === undefined
        ? eq(coupon.id, params.couponId)
        : and(
            eq(coupon.id, params.couponId),
            lt(coupon.usedCount, params.usageLimit)
          );

    const updated = await executor
      .update(coupon)
      .set({ usedCount: sql`${coupon.usedCount} + 1`, updatedAt: new Date() })
      .where(guard)
      .returning();

    const usageIncremented = updated.length > 0;

    // 额度满了 → 这张券被超发 → 这一单**不成立**
    if (!usageIncremented && params.usageLimit != null) {
      throw new CouponUsageLimitError();
    }

    return { recorded: true, usageIncremented };
  };

  return params.tx ? run(params.tx) : db.transaction(run);
}
