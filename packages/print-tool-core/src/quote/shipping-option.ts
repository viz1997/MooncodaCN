/**
 * 配送方式 —— 打印工单的「怎么寄、运费多少」档位(2026-11-17)
 *
 * ## 配送方式 ≠ 交期档位 —— 两个**正交**的轴
 *
 * | 轴 | 回答的问题 | 取值 |
 * |---|---|---|
 * | **交期档位**(`delivery-tier.ts`) | **多快发货** | 标准 96h / 加急 72h / 特急 48h |
 * | **配送方式**(本文件) | **怎么寄、运费多少** | 顺丰到付 / 顺丰标快 / 顺丰空运 |
 *
 * 两者**互不影响**:加急 + 空运 = 加急费(按小计的比例)+ 空运费 ¥22。
 *
 * ⚠️ **别把这两个字段混进同一个枚举** —— `print_order.delivery_tier`
 * (交期档位)和 `print_order.shipping_option`(配送方式)是**两列**。
 *
 * ## 三档(工作室 2026-11-17 的原话)
 *
 * > 配送方式 运费按单收取 顺丰到付…顺丰标快 ¥18…顺丰空运 ¥22
 *
 * - `cod`      —— 顺丰到付(收件人付运费)⇒ **¥0**
 * - `standard` —— 顺丰标快 ⇒ **¥18**
 * - `air`      —— 顺丰空运 ⇒ **¥22**
 *
 * ## 运费**按单收** —— 不乘件数
 *
 * 工作室的原话「运费按单收取」—— 一单寄一个包裹(多件装一个箱),运费跟
 * 几件没关系。⇒ `computeShippingFeeCents()` **不看件数**。
 *
 * ## 认不出来 ⇒ 落到「顺丰到付」
 *
 * 跟 `delivery-tier.ts`「认不出来落到标准档」同一个套路。
 *
 * ⚠️ **到付不是漏洞** —— 它是工作室真实提供的三档之一(¥0),用户自己选它
 * 就是 ¥0。**不能**因为认不出来就按最贵的那档收(那是凭空多收钱),也**不能**
 * 报错(那会让老客户端下不了单)。
 *
 * ## ⚠️ 费用永远由**服务端**按 `settings.shippingFees` 算
 *
 * 客户端只能传**档位 id**,传不了金额 —— 篡改不了。`settings.shippingFees`
 * 来自后台(`/admin/print-pricing`),落库的是**当时那一档的绝对金额**
 * (`print_order.shipping_fee_cents`),比例以后改了工单上的价不会跟着变。
 *
 * ## 引擎里不放中文 label
 *
 * 显示名走 i18n(跟 `delivery-tier.ts` 一个套路)—— 引擎是纯计算,不知道
 * 「顺丰标快」这四个字。
 *
 * ## 纯函数,零依赖
 *
 * 客户端(下单表单里的选择器)和服务端(算价)读的是**同一份**表 —— 两边各写
 * 一份迟早漂移(前端显示 ¥18、后端收 ¥0)。
 */

import { ceilCents } from "./rounding";

/* -------------------------------------------------------------------------- */
/*  档位                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 配送方式 id
 *
 * - `cod`      —— 顺丰到付(运费 ¥0,收件人付)
 * - `standard` —— 顺丰标快(¥18)
 * - `air`      —— 顺丰空运(¥22)
 */
export type ShippingOptionId = "cod" | "standard" | "air";

export type ShippingOption = {
  id: ShippingOptionId;
  /**
   * 承诺时效(天)—— 只给界面显示用
   *
   * ⚠️ **不是交期** —— 交期(生产要多久)是 `delivery-tier.ts` 的事。这里
   * 是「寄到哪要几天」。两个都摆在界面上时别让用户分不清。
   */
  days: number;
};

/**
 * 档位表 —— 按「快 → 慢」排,UI 直接按这个顺序渲染
 *
 * `cod` 放最后是因为它不是「一个要选的档位」,而是**默认值** ——
 * 用户什么都不选就是它(运费 ¥0)。
 */
export const SHIPPING_OPTIONS: readonly ShippingOption[] = [
  { id: "air", days: 2 },
  { id: "standard", days: 3 },
  { id: "cod", days: 3 },
];

/** 默认档位 —— 没传 / 传了不认识的值都落到它(顺丰到付,¥0) */
export const DEFAULT_SHIPPING_OPTION: ShippingOptionId = "cod";

/** 各档运费(分)—— 服务端可以用后台配置覆盖 */
export type ShippingFees = Record<ShippingOptionId, number>;

/** 默认运费 —— ¥0 / ¥18 / ¥22,推导过程见文件头 */
export const DEFAULT_SHIPPING_FEES: ShippingFees = {
  cod: 0,
  standard: 1800,
  air: 2200,
};

/**
 * 把任意输入收敛成合法档位
 *
 * 客户端传来的值不可信 —— 认不出来的(缺省 / 拼错 / null)一律落到**顺丰到付**,
 * 也就是「运费 ¥0」那一档。
 */
export function normalizeShippingOption(value: unknown): ShippingOptionId {
  if (value === "cod" || value === "standard" || value === "air") {
    return value;
  }
  return DEFAULT_SHIPPING_OPTION;
}

/** 取档位 —— 认不出来就给顺丰到付 */
export function getShippingOption(id: ShippingOptionId): ShippingOption {
  return (
    SHIPPING_OPTIONS.find((option) => option.id === id) ??
    SHIPPING_OPTIONS.find((option) => option.id === DEFAULT_SHIPPING_OPTION)!
  );
}

/* -------------------------------------------------------------------------- */
/*  运费                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 配送费(分)
 *
 * ```
 * fee = 该档的运费(后台配的绝对金额)
 * ```
 *
 * **不乘件数** —— 工作室的原话「运费按单收取」。
 *
 * ⚠️ **费用一律由服务端算** —— 这个函数**只吃档位 id + 服务端的费用表**,
 * 客户端没有任何途径把金额塞进来。
 */
export function computeShippingFeeCents(
  optionId: ShippingOptionId,
  fees: ShippingFees = DEFAULT_SHIPPING_FEES
): number {
  const fee = fees[optionId];
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  return ceilCents(fee);
}
