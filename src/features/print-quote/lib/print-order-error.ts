/**
 * 「提交打印订单」失败 —— 服务端的 code 翻译成人话
 *
 * ## 为什么不再只摆一句「请稍后重试」
 *
 * 2026-11-08 线上真踩过一次:生产库的 `cart` 表少了 `kind` 那一列 →
 * Drizzle 每次查车都带 `kind` → PG 报 42703 → 加行接口 500 → 界面上只摆
 * 「加入打印单失败,请稍后重试」。**那句话把真原因盖住了** —— 唯一能看出
 * 线索的是 R2 里那个已经传上去的模型文件(上传在加购之前,所以文件进了桶,
 * 加行却炸了)。
 *
 * 现在服务端每次失败都带一个**稳定的 code**,前端按 code 摆具体的话:
 * 「模型文件没找到,请重新上传」比「请稍后重试」有用得多。
 *
 * ## 纯函数,不碰 React
 *
 * 这里只做「code → i18n key」的映射,翻译交给调用方的 `t()`。所以这个
 * 文件能进 `unit` project 跑单测 —— 映射表改错了会被测出来。
 */

import { RequestError } from "@/features/shared/lib/request-error";

/**
 * 服务端的 code → 文案表里的 key(相对 `PrintQuote` 命名空间)
 *
 * 摆出来的每一条都要**告诉用户下一步做什么** —— 「重试」「重新上传」
 * 「联系工作室」,不是「失败」。
 *
 * **没在表里的 code 一律退回笼统那句** —— 服务端以后加了新的 code,前端
 * 不会崩,只是话术不够具体。新的 code 记得往这儿补一条。
 */
export const PRINT_ORDER_ERROR_KEYS: Record<string, string> = {
  // 没登录 / 会话失效
  AUTH_REQUIRED: "printOrder.errors.codes.authRequired",
  UNAUTHORIZED: "printOrder.errors.codes.authRequired",
  // 存储没配好(重试没用,得工作室处理)
  R2_NOT_CONFIGURED: "printOrder.errors.codes.storageNotConfigured",
  // 模型文件那一份不见了 —— 重传就行
  MODEL_NOT_FOUND: "printOrder.errors.codes.modelNotFound",
  INVALID_MODEL_URL: "printOrder.errors.codes.modelUrlInvalid",
  // 请求本身不合法
  INVALID_INPUT: "printOrder.errors.codes.invalidInput",
  INVALID_TYPE: "printOrder.errors.codes.invalidType",
  INVALID_JSON: "printOrder.errors.codes.invalidInput",
  BAD_BODY: "printOrder.errors.codes.invalidInput",
  // 收货地址 —— 重新选一个就行
  ADDRESS_NOT_FOUND: "printOrder.errors.codes.addressNotFound",
  // 这组几何算不出报价 —— 重新量一遍
  QUOTE_UNAVAILABLE: "printOrder.errors.codes.quoteUnavailable",
  // 订单号撞车(极小概率)—— 重试
  ORDER_NO_CONFLICT: "printOrder.errors.codes.orderNoConflict",
  // 收款通道没配好 / 被关了
  PAYMENT_CHANNEL_UNAVAILABLE:
    "printOrder.errors.codes.paymentChannelUnavailable",
  // 这一单已经跟着商城订单结过账了 —— 去「我的订单」付那张
  PAY_VIA_STOREFRONT: "printOrder.errors.codes.storefrontUnavailable",
  // 服务端处理失败
  CREATE_ORDER_FAILED: "printOrder.errors.codes.createOrderFailed",
  PRESIGN_FAILED: "printOrder.errors.codes.presignFailed",

  /*
   * 优惠码(2026-11-08)
   *
   * 下单时券不可用 → 服务端回 400 + 精确原因码。这十个码**跟表单里那份
   * inline 提示共用同一套文案**(`coupon.errors.*`)—— 一张码只有一句话,
   * 两处各写一份迟早漂移。
   */
  COUPON_NOT_FOUND: "coupon.errors.COUPON_NOT_FOUND",
  COUPON_INACTIVE: "coupon.errors.COUPON_INACTIVE",
  COUPON_NOT_STARTED: "coupon.errors.COUPON_NOT_STARTED",
  COUPON_EXPIRED: "coupon.errors.COUPON_EXPIRED",
  COUPON_SCOPE_MISMATCH: "coupon.errors.COUPON_SCOPE_MISMATCH",
  COUPON_NOT_APPLICABLE: "coupon.errors.COUPON_NOT_APPLICABLE",
  COUPON_MIN_AMOUNT_NOT_MET: "coupon.errors.COUPON_MIN_AMOUNT_NOT_MET",
  COUPON_LIMIT_REACHED: "coupon.errors.COUPON_LIMIT_REACHED",
  COUPON_PER_USER_LIMIT_REACHED: "coupon.errors.COUPON_PER_USER_LIMIT_REACHED",
  COUPON_NOT_FIRST_ORDER: "coupon.errors.COUPON_NOT_FIRST_ORDER",
};

/**
 * 这次失败对应哪句文案?
 *
 * 返回 `null` = 认不出来(不是 `RequestError`、或者 code 没在表里)→ 调用方
 * 退回笼统那句。
 *
 * **真原因永远留在 console 里** —— 服务端的原始报错可能带着表结构这类
 * 内部信息,不该直接摆给访客。
 */
export function printOrderErrorMessageKey(error: unknown): string | null {
  if (!(error instanceof RequestError)) return null;
  if (!error.code) return null;
  return PRINT_ORDER_ERROR_KEYS[error.code] ?? null;
}
