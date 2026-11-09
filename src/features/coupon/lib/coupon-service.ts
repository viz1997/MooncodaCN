/**
 * 优惠码的**服务端编排** —— 查库 + 判定 + 算钱
 *
 * 纯函数那一半在 `coupon-calc.ts`,查库那一半在 `coupon-store.ts`。
 * 这里把两头接起来,给三条下单路(购物袋 / 商城结算 / 打印工单)一个**统一
 * 的入口**:
 *
 * ```ts
 * const result = await evaluateCoupon({ code, orderKind, couponBaseCents, shippingCents, userId });
 * if (result.error) → 界面上说人话
 * result.coupon?.discountCents → 减掉的钱
 * ```
 *
 * ## 「查不到券」和「券不可用」是两件事
 *
 * - **查不到** → `COUPON_NOT_FOUND` —— 用户输错了
 * - **不可用** → 过期 / 停用 / 范围不对 / 没满门槛 / 超限 …… 每个一个码
 *
 * 界面上要说不同的话 —— 「优惠码不存在」和「这张券不能用于当前订单」,
 * 用户要做的动作不一样。
 *
 * ## 热路径不查会话
 *
 * 只有「新人首单券」和「每人限用」的券才需要知道用户是谁 —— 那两种券
 * 少见,别的券**一次会话查询都不做**(购物袋是热路径)。
 */

import {
  type CouponEffect,
  type CouponErrorCode,
  type CouponKind,
  type CouponOrderKind,
  type CouponView,
  checkCouponApplicable,
  computeCouponEffect,
  normalizeCouponCode,
} from "./coupon-calc";
import {
  countUserCouponRedemptions,
  getCouponByCode,
  userHasAnyOrder,
} from "./coupon-store";

/** 算出来的优惠效果 —— 服务端算好的,客户端直接用 */
export interface CouponApplication extends CouponView {
  /** 券 id —— 建单时要记一笔用量 */
  couponId: string;
  /** 总量上限 —— 建单时给「用量 +1」加守卫 */
  usageLimit: number | null;
}

/** 判定 + 算钱的结果 */
export interface CouponEvaluation {
  /** 生效的券 —— null = 没有券 / 券不可用 */
  coupon: CouponApplication | null;
  /** 不可用的原因 —— null = 没有码,或者券完全可用 */
  error: CouponErrorCode | null;
}

/**
 * 算一个优惠码在这张单上的效果
 *
 * @param code 用户输入的码 —— 内部归一化(大写 + 去空格)
 * @param orderKind 这张单是商城单还是打印工单
 * @param couponBaseCents 商品小计(分)—— 门槛跟它比,折扣也从它里面减
 * @param shippingCents **优惠前**的运费(分)—— 免运费券减免的是这个数
 * @param resolveUserId 取当前用户 id —— **只在需要判身份时才调**(热路径)
 */
export async function evaluateCoupon(params: {
  code: string | null | undefined;
  orderKind: CouponOrderKind;
  couponBaseCents: number;
  shippingCents: number;
  /** 取当前登录用户 id —— 游客拿不到就返回 null */
  resolveUserId?: () => Promise<string | null>;
  now?: Date;
}): Promise<CouponEvaluation> {
  const normalized = params.code ? normalizeCouponCode(params.code) : "";
  if (!normalized) return { coupon: null, error: null };

  const record = await getCouponByCode(normalized);
  if (!record) return { coupon: null, error: "COUPON_NOT_FOUND" };

  const rule = record.rule;
  const now = params.now ?? new Date();

  // 只有「判身份」的那两种券才需要查库 ——
  // 别的券一次会话查询 / 订单查询都不做(购物袋是热路径)。
  const needsUserState =
    rule.firstOrderOnly ||
    (rule.perUserLimit !== null && rule.perUserLimit !== undefined);

  let userId: string | null = null;
  if (needsUserState && params.resolveUserId) {
    userId = await params.resolveUserId();
  }
  const isLoggedIn = Boolean(userId);

  let userUsedCount = 0;
  let hasOrders = false;
  if (needsUserState && userId) {
    if (rule.perUserLimit !== null && rule.perUserLimit !== undefined) {
      userUsedCount = await countUserCouponRedemptions(record.id, userId);
    }
    if (rule.firstOrderOnly) {
      hasOrders = await userHasAnyOrder(userId);
    }
  }

  const check = checkCouponApplicable(rule, {
    orderKind: params.orderKind,
    now,
    couponBaseCents: params.couponBaseCents,
    isLoggedIn,
    hasOrders,
    userUsedCount,
  });
  if (!check.ok) return { coupon: null, error: check.code };

  const effect = computeCouponEffect(
    rule,
    params.couponBaseCents,
    params.shippingCents
  );

  return {
    coupon: {
      couponId: record.id,
      code: record.code,
      kind: rule.kind as CouponKind,
      discountCents: effect.discountCents,
      freeShipping: effect.freeShipping,
      freeShippingCents: effect.freeShippingCents,
      minAmountCents: Math.max(0, Math.floor(rule.minAmountCents ?? 0)),
      usageLimit: rule.usageLimit ?? null,
    },
    error: null,
  };
}

/**
 * 「这张券在这张单上能减多少」—— **不判资格**
 *
 * ## 什么时候用
 *
 * **复用上一张待付款单**那条路(`checkout.ts` 的第 4 步)。
 *
 * 那张单是券还有效的时候建的,折扣已经锁死在它的合计里了。后来券过期了 /
 * 额度被抢完了 —— 用户要付的还是**那张单上的价**。所以复用之前得先算出
 * 「这张券能减多少」,才能算出**同一个合计**去比那张单。
 *
 * ## 跟 `evaluateCoupon()` 的区别
 *
 * | | `evaluateCoupon` | `evaluateCouponEffect` |
 * |---|---|---|
 * | 查库 | 查券(+ 判身份时查用户) | 只查券 |
 * | 判资格 | ① ~ ⑩ 全判 | **不判** |
 * | 返回 | 券 + 错误码 | 效果(查不到就是 null) |
 *
 * **折扣金额两边一致** —— 都走 `computeCouponEffect()` 这一份纯函数。
 *
 * ## 查不到券 → null
 *
 * 券只停用不删,所以「查不到」= 这张券**从来没存在过**(或者库读挂了)。
 * 调用点自己决定怎么办 —— 商城那条路是「直接报优惠码不存在」。
 */
export async function evaluateCouponEffect(params: {
  code: string | null | undefined;
  couponBaseCents: number;
  shippingCents: number;
}): Promise<
  | (CouponEffect & {
      couponId: string;
      code: string;
      usageLimit: number | null;
    })
  | null
> {
  const normalized = params.code ? normalizeCouponCode(params.code) : "";
  if (!normalized) return null;

  const record = await getCouponByCode(normalized);
  if (!record) return null;

  const effect = computeCouponEffect(
    record.rule,
    params.couponBaseCents,
    params.shippingCents
  );

  return {
    couponId: record.id,
    code: record.code,
    usageLimit: record.rule.usageLimit ?? null,
    ...effect,
  };
}
