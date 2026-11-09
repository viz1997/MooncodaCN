/**
 * 优惠码错误码 → 商城侧的人话(2026-11-08)
 *
 * ## 为什么单独一个文件
 *
 * 商城这一整套交易界面(购物袋抽屉 / 购物袋页 / 结算页)是**中文硬编码**的
 * —— 见 `cart-drawer.tsx` / `cart-page-view.tsx` / `checkout-view.tsx` 的文件头。
 * 这里跟着走,不开一套 i18n。
 *
 * **打印工单那侧不一样** —— 它走 i18n(`messages/*.json` 的
 * `PrintQuote.errors.codes.*`),见 `print-quote/lib/print-order-error.ts`。
 *
 * ## 一份码表,两个方向
 *
 * 码本身定义在 `features/coupon/lib/coupon-calc.ts`(单一来源)。这个文件
 * 只负责**把码翻成人话**,不新增码、不改码。
 *
 * **纯函数、零 import**(除了类型)—— 能进 `unit` project 跑单测。
 */

import type { CouponErrorCode } from "@/features/coupon/lib/coupon-calc";

/**
 * 一个码对应一句人话
 *
 * 写给**用户**看的,所以:
 *
 * - 说清楚**为什么**不能用(不是「优惠码无效」)
 * - 能说出下一步做什么的,把下一步也说了
 */
const COUPON_ERROR_TEXT: Record<CouponErrorCode, string> = {
  COUPON_NOT_FOUND: "优惠码不存在,检查一下有没有输错",
  COUPON_INACTIVE: "这个优惠码已经停用了",
  COUPON_NOT_STARTED: "这个优惠码还没开始生效",
  COUPON_EXPIRED: "这个优惠码已经过期了",
  COUPON_SCOPE_MISMATCH: "这个优惠码不适用于当前订单",
  COUPON_NOT_APPLICABLE: "这个优惠码不适用于当前订单",
  COUPON_MIN_AMOUNT_NOT_MET: "还没达到这个优惠码的使用门槛",
  COUPON_LIMIT_REACHED: "这个优惠码已经被用完了",
  COUPON_PER_USER_LIMIT_REACHED: "这个优惠码你用过了,每人限用次数已到",
  COUPON_NOT_FIRST_ORDER: "这个优惠码只限新用户的第一单使用",
};

/**
 * 把错误码翻成人话
 *
 * 认不出来的码(理论上不会有)退回一句笼统的 —— **不返回 null**:
 * 界面上的位置就是「给用户看一句解释」,返回 null 会让那行空白,用户以为
 * 页面坏了。
 */
export function couponErrorText(
  code: CouponErrorCode | null | undefined
): string {
  if (!code) return "这个优惠码现在用不了";
  return COUPON_ERROR_TEXT[code] ?? "这个优惠码现在用不了";
}
