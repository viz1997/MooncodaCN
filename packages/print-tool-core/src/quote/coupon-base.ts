/**
 * 打印工单的优惠基数(2026-11-08)
 *
 * ## 为什么扣掉交期加价
 *
 * 交期加价是**加急费**,不是货款 —— 跟运费一个待遇。优惠码不碰它:
 *
 * ```
 * couponBase = 报价合计 − 交期加价 = 克重费 + 后处理费 + 支撑费
 * ```
 *
 * 跟商城那条路一个道理:商城的「运费」也不参与满减 / 百分比折扣,只有
 * 「免运费」券动它。打印工单**没有运费行**,所以**免运费券在这儿没有意义**
 * —— `checkCouponApplicable` 会直接把它拒掉(`COUPON_NOT_APPLICABLE`)。
 *
 * ## 这个函数是**纯的**
 *
 * 报价接口和下单接口都要用它 —— 门槛判定和折扣计算必须用**同一个基数**,
 * 两处各算一遍迟早对不上(用户会看到「预览说减 ¥20、提交说减 ¥18」)。
 */

/** 报价里跟优惠基数有关的那两个数 */
export type CouponBaseSource = {
  /** 报价合计(分)—— 四项费用之和 */
  totalPriceCents: number;
  /** 交期加价(分)—— 加急费,不参与优惠 */
  deliveryFeeCents: number;
};

/**
 * 优惠基数(分)
 *
 * **不会算出负数** —— 交期加价是按小计的比例收的,理论上不会超过合计,
 * 但万一配置被手滑改成大于 1 的比例,这里兜住(负基数会让门槛判定和折扣
 * 计算全部乱掉)。
 */
export function printCouponBaseCents(quote: CouponBaseSource): number {
  return Math.max(0, quote.totalPriceCents - quote.deliveryFeeCents);
}
