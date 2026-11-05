/**
 * 交期档位 —— 打印服务的「多快发货」档位
 *
 * ## 加价按**比例**收,不是固定金额
 *
 * 固定金额(比如「加急一律 +¥15」)在两端都不成立:
 *
 *  - 便宜的活(¥19 的钥匙扣)加 ¥15 = 加价 79%,用户看一眼就划走
 *  - 贵的活(¥300 的手办)加 ¥15 = 加价 5%,工作室加班排产的成本没收回来
 *
 * 按比例收,加价跟活的大小走 —— 这也是「48 小时 +¥20.65 / 72 小时 +¥5.58 /
 * 96 小时 +¥0.00」那组数背后的口径:**同一组比例**,落在不同报价上就是不同
 * 的绝对金额。
 *
 * ## 比例是怎么定出来的
 *
 * 用那组数反推:两档的比例比 = 20.65 / 5.58 ≈ 3.70。落在 ¥55.81 的报价上
 * (克重费 ¥45.81 + 光油 ¥10 ≈ 10.18 g 的活)时:
 *
 * ```
 * 48 小时:¥55.81 × 37% = ¥20.65  ✓
 * 72 小时:¥55.81 × 10% = ¥5.58   ✓
 * 96 小时:¥55.81 ×  0% = ¥0.00   ✓
 * ```
 *
 * 三个数同时对上,所以比例取 **37% / 10%**。
 *
 * 比例**可调**(`PRINT_DELIVERY_EXPRESS_RATE` / `PRINT_DELIVERY_URGENT_RATE`,
 * 见 `quote-server.ts`)—— 工作室觉得贵就调低,不用改代码发版。
 *
 * ## 纯函数,零依赖
 *
 * 客户端(报价台的选择器)和服务端(算价)读的是**同一份**档位表 —— 两边各写
 * 一份迟早漂移(前端显示 37%、后端收 35%)。
 */

/* -------------------------------------------------------------------------- */
/*  档位                                                                      */
/* -------------------------------------------------------------------------- */

/** 档位 id —— `standard` 不额外收费,`express` / `urgent` 是加急档 */
export type DeliveryTierId = "standard" | "express" | "urgent";

export type DeliveryTier = {
  id: DeliveryTierId;
  /** 承诺交期(小时) */
  hours: number;
  /** 加价比例(0-1)—— 基数是报价小计 */
  rate: number;
};

/**
 * 档位表 —— 按「快 → 慢」排,UI 直接按这个顺序渲染
 *
 * `standard` 放最后是因为它不是「一个要选的档位」,而是**默认值** ——
 * 用户什么都不选就是它。
 */
export const DELIVERY_TIERS: readonly DeliveryTier[] = [
  { id: "urgent", hours: 48, rate: 0.37 },
  { id: "express", hours: 72, rate: 0.1 },
  { id: "standard", hours: 96, rate: 0 },
];

/** 默认档位 —— 没传 / 传了不认识的值都落到它 */
export const DEFAULT_DELIVERY_TIER: DeliveryTierId = "standard";

/** 各档比例 —— 服务端可以用环境变量覆盖(见 `quote-server.ts`) */
export type DeliveryRates = Record<DeliveryTierId, number>;

/** 默认比例 —— 37% / 10% / 0%,推导过程见文件头 */
export const DEFAULT_DELIVERY_RATES: DeliveryRates = {
  standard: 0,
  express: 0.1,
  urgent: 0.37,
};

/**
 * 把任意输入收敛成合法档位
 *
 * 客户端传来的值不可信 —— 认不出来的(缺省 / 拼错 / null)一律落到标准档,
 * 也就是「不额外收费」那一档。**绝不能**因为认不出来就报错或按最贵的算。
 */
export function normalizeDeliveryTier(value: unknown): DeliveryTierId {
  if (value === "express" || value === "urgent" || value === "standard") {
    return value;
  }
  return DEFAULT_DELIVERY_TIER;
}

/** 取档位 —— 认不出来就给标准档 */
export function getDeliveryTier(id: DeliveryTierId): DeliveryTier {
  return (
    DELIVERY_TIERS.find((tier) => tier.id === id) ??
    DELIVERY_TIERS.find((tier) => tier.id === DEFAULT_DELIVERY_TIER)!
  );
}

/* -------------------------------------------------------------------------- */
/*  加价                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 交期加价(分)
 *
 * ```
 * fee = round(小计 × 比例)
 * ```
 *
 * 基数是**报价小计**(克重费 + 后处理 + 支撑加价),不是总价 —— 加价不能自己
 * 把自己算进去(拿含加价的总价当基数,就成了「加价 = (小计 + 加价) × 比例」,
 * 解出来的加价比直觉高,而且用户看到的合计跟明细对不上)。
 *
 * 四舍五入到分 —— 明细加起来必须等于合计,差一分钱用户都会来问。
 */
export function computeDeliveryFeeCents(
  subtotalCents: number,
  tierId: DeliveryTierId,
  rates: DeliveryRates = DEFAULT_DELIVERY_RATES
): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  const rate = rates[tierId] ?? 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(subtotalCents * rate);
}
