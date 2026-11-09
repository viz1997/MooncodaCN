/**
 * 优惠码的纯函数(2026-11-08)
 *
 * **零 import** —— 这个文件不引 `@/db`、不引 `server-only`、不引任何东西。
 * 客户端组件(购物袋抽屉、结算页、打印下单表单)也安全 import 它的类型和
 * 纯函数。**单测也靠这一点** —— `unit` project 跑的就是它。
 *
 * ## 三种类型 + 一个修饰
 *
 * | kind | 折扣 | 封顶 |
 * |---|---|---|
 * | `amount` | 减固定金额 | 天然封顶在小计里 |
 * | `percent` | 按比例减 | `maxDiscountCents` |
 * | `free_shipping` | 商品不打折,运费置 0 | — |
 *
 * 「**新人首单券**」不是第四种类型 —— 它是 `firstOrderOnly = true`
 * 这个**布尔修饰**,叠在任意一种 `kind` 上面。
 *
 * ## 钱一律整数分
 *
 * 全仓库的钱都是整数分(`src/config/currency.ts` 是人民币)。
 * 这个文件里**没有一个浮点的钱** —— 连百分比折扣都用整数运算算:
 * `discount = floor(base × rateUnits ÷ 10000)`,`rateUnits` 是整数。
 * 浮点在「差一点就少收一分钱」这件事上没有任何好处。
 */

/* -------------------------------------------------------------------------- */
/*  类型                                                                       */
/* -------------------------------------------------------------------------- */

/** 优惠类型 */
export type CouponKind = "amount" | "percent" | "free_shipping";

/**
 * 适用范围
 *
 * - `mall`  —— 只能用于商城订单
 * - `print` —— 只能用于打印工单
 * - `both`  —— 两个都行
 */
export type CouponScope = "mall" | "print" | "both";

/** 订单种类 —— 跟 `CouponScope` 不是一回事(范围有三种,单只有两种) */
export type CouponOrderKind = "mall" | "print";

/**
 * 优惠码错误码 —— **单一来源**
 *
 * 商城侧(`CheckoutErrorCode`)只加一个 `"COUPON_INVALID"`,精确原因靠
 * `CheckoutError.couponErrorCode` 带出来;打印侧(`print-order-error.ts`)
 * 追加这 10 个码。各处文案查同一张表。
 */
export type CouponErrorCode =
  /** 码不存在 */
  | "COUPON_NOT_FOUND"
  /** 码被停用了 */
  | "COUPON_INACTIVE"
  /** 还没到生效时间 */
  | "COUPON_NOT_STARTED"
  /** 已经过期 */
  | "COUPON_EXPIRED"
  /** 码的适用范围跟这张单对不上 */
  | "COUPON_SCOPE_MISMATCH"
  /** 这张单用不了这种券(免运费券用在打印工单上) */
  | "COUPON_NOT_APPLICABLE"
  /** 没到「满 X 元」的门槛 */
  | "COUPON_MIN_AMOUNT_NOT_MET"
  /** 总量用完了 */
  | "COUPON_LIMIT_REACHED"
  /** 这个人用超次数了(游客没法判身份,一律按超了处理) */
  | "COUPON_PER_USER_LIMIT_REACHED"
  /** 不是新人的首单(游客没法判身份,一律按不是处理) */
  | "COUPON_NOT_FIRST_ORDER";

/**
 * 优惠码规则 —— **从 DB 行里剥出来的「能算的部分」**
 *
 * 这个类型刻意**不含** id / code / name / createdAt —— 那些跟算钱无关。
 * `coupon-store.ts` 负责把 DB 行变成这个形状。
 */
export interface CouponRule {
  /** 优惠类型 */
  kind: CouponKind;
  /** 面额(分)—— `kind = "amount"` 时用 */
  amountCents?: number | null;
  /**
   * 折扣率 —— `kind = "percent"` 时用
   *
   * 0.15 = 减 15%。**接受 string**(PG 的 `numeric` 读出来是 string),
   * 内部会精确地换算成整数万分之一。
   */
  discountRate?: number | string | null;
  /** 折扣封顶(分)—— `kind = "percent"` 时用;null = 不封顶 */
  maxDiscountCents?: number | null;
  /** 满多少才用(分)—— 跟**折后小计**比(用户看得见的那个数);0 = 没门槛 */
  minAmountCents?: number | null;
  /** 适用范围 */
  scope: CouponScope;
  /** 新人首单券 —— 叠在任意 `kind` 上的修饰 */
  firstOrderOnly: boolean;
  /** 停用 */
  isActive?: boolean;
  /** 生效时间 —— null = 立即生效 */
  startsAt?: Date | null;
  /** 失效时间 —— null = 永不过期 */
  endsAt?: Date | null;
  /** 总次数上限 —— null = 不限 */
  usageLimit?: number | null;
  /** 已用次数 */
  usedCount?: number | null;
  /** 每人限用次数 —— null = 不限 */
  perUserLimit?: number | null;
}

/**
 * 判定「这个码能不能用在这种单子上」需要的上下文
 *
 * **所有跟「现在」有关的都从外面传进来** —— 传 `now` 进来,单测才不用
 * 去 mock 定时器。
 */
export interface CouponCheckContext {
  /** 这张单是商城单还是打印工单 */
  orderKind: CouponOrderKind;
  /** 判定用的「现在」 */
  now: Date;
  /** 商品小计(分)—— 门槛跟它比 */
  couponBaseCents: number;
  /** 登录了吗 —— 游客判不了「首单」和「每人限用」 */
  isLoggedIn: boolean;
  /**
   * 这个用户有没有下过单(商城单或打印工单都算)
   *
   * 游客传 `false` —— 反正游客用不了首单券。
   */
  hasOrders: boolean;
  /** 这个用户已经用这个码几次 */
  userUsedCount: number;
}

/** 判定结果 —— 失败时带**稳定的原因码**,界面按码查文案 */
export type CouponCheckResult =
  | { ok: true }
  | { ok: false; code: CouponErrorCode };

/**
 * 优惠码在**界面上**看到的样子
 *
 * **折扣金额是服务端算好的** —— 客户端一个加法都不做(仓库的规矩:钱只在
 * 服务端算一遍)。购物袋 / 结算页 / 打印下单表单拿到的都是这个快照。
 */
export interface CouponView {
  /** 大写归一化后的码 */
  code: string;
  /** 优惠类型 */
  kind: CouponKind;
  /** 商品折扣(分)—— 免运费券是 0 */
  discountCents: number;
  /** 是不是免运费券 */
  freeShipping: boolean;
  /** 减免的运费(分)—— 只有免运费券非零 */
  freeShippingCents: number;
  /** 门槛(分)—— 0 = 没门槛 */
  minAmountCents: number;
}

/* -------------------------------------------------------------------------- */
/*  小工具                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 码的归一化 —— **大写 + 去空格**
 *
 * 用户输入不区分大小写(输 `abc123` 和 `ABC123` 是同一个码),DB 里也只存
 * 大写的。后台建码时也走这个函数 —— 两边口径必须一样,否则建了 `ABC123`
 * 而用户输 `abc123` 就找不到。
 */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * 折扣率的精度 —— **万分之一**
 *
 * PG 的 `numeric(6,4)` 就是四位小数。存进去 0.15,读出来 0.1500。
 * 换算成整数(`1500`)之后,乘法和除法都落在整数上。
 */
const RATE_SCALE = 10_000;

/**
 * 把折扣率换算成**整数**万分之一
 *
 * **为什么不用浮点** —— `Math.floor(7700 * 0.15)` 在 IEEE754 下是
 * `Math.floor(1155.0000000000002)` = 1155,但换一种基数就可能变成
 * `114.99999999999999` → floor 成 114 —— **少减了一分**。
 * 整数运算没有这个问题。
 *
 * string 输入走**字符串解析**(PG 的 numeric 就是这么读出来的):
 * `"0.1500"` → 1500。数字输入走 `Math.round(rate × 10000)`。
 */
export function rateToUnits(rate: number | string | null | undefined): number {
  if (rate == null) return 0;
  if (typeof rate === "string") {
    const trimmed = rate.trim();
    if (!trimmed) return 0;
    const negative = trimmed.startsWith("-");
    const body = negative ? trimmed.slice(1) : trimmed;
    const [intPart = "0", fracPart = ""] = body.split(".");
    const frac = fracPart.slice(0, 4).padEnd(4, "0");
    const units =
      Number.parseInt(intPart || "0", 10) * RATE_SCALE +
      Number.parseInt(frac || "0", 10);
    return negative ? -units : units;
  }
  if (!Number.isFinite(rate)) return 0;
  return Math.round(rate * RATE_SCALE);
}

/**
 * 这个码的适用范围包不包含这种单子
 *
 * `both` 包两个;`mall` / `print` 各管一个。
 */
export function couponScopeAllows(
  scope: CouponScope,
  orderKind: CouponOrderKind
): boolean {
  if (scope === "both") return true;
  return scope === orderKind;
}

/**
 * 这个码是不是「免运费券」
 *
 * 只有 `free_shipping` 才是。**新人首单**是叠加的修饰,不能把它变成免运费券。
 */
export function isFreeShippingCoupon(rule: CouponRule): boolean {
  return rule.kind === "free_shipping";
}

/* -------------------------------------------------------------------------- */
/*  判定                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 这个码能不能用在这种单子上
 *
 * ## 判定顺序**不能改**
 *
 * ```
 * NOT_FOUND → INACTIVE → NOT_STARTED → EXPIRED → SCOPE_MISMATCH
 * → NOT_APPLICABLE → MIN_AMOUNT_NOT_MET → LIMIT_REACHED
 * → PER_USER_LIMIT_REACHED → NOT_FIRST_ORDER
 * ```
 *
 * **短路** —— 第一个不满足就返回,后面的不看了。
 *
 * 顺序是「**从最外圈往里圈**」:码在不在 → 码活着吗 → 现在能用吗 →
 * 用得上这张单吗 → 这张单够不够格 → 还有额度吗 → 这个人还有额度吗 →
 * 这个人是不是新人。
 *
 * - `SCOPE_MISMATCH` 排在 `MIN_AMOUNT_NOT_MET` **前面** —— 券不适用于这张单,
 *   提示应该是「这张券不能用于当前订单」,而不是「没满 99 减 10」。
 * - `NOT_APPLICABLE`(免运费券用在打印工单上)排在 `MIN_AMOUNT_NOT_MET` 前面
 *   —— 同一个道理:它在这种单子上**根本没有意义**,先说这个。
 * - 游客用「每人限用」/「首单」的券 → **直接拒**。这两种券要判身份,
 *   游客没法判 ⇒ 拒掉,而不是「当作不限」。
 */
export function checkCouponApplicable(
  rule: CouponRule | null | undefined,
  ctx: CouponCheckContext
): CouponCheckResult {
  // ① 码在不在
  if (!rule) return { ok: false, code: "COUPON_NOT_FOUND" };

  // ② 码活着吗
  if (rule.isActive === false) {
    return { ok: false, code: "COUPON_INACTIVE" };
  }

  // ③ 生效时间
  if (rule.startsAt && ctx.now < rule.startsAt) {
    return { ok: false, code: "COUPON_NOT_STARTED" };
  }

  // ④ 失效时间
  if (rule.endsAt && ctx.now > rule.endsAt) {
    return { ok: false, code: "COUPON_EXPIRED" };
  }

  // ⑤ 适用范围
  if (!couponScopeAllows(rule.scope, ctx.orderKind)) {
    return { ok: false, code: "COUPON_SCOPE_MISMATCH" };
  }

  // ⑥ 这张单用不了这种券
  //    打印工单没有运费行 —— 它的 `delivery_fee_cents` 是**交期加价**
  //    (加急费),不是运费。免运费券在这儿没有意义。
  if (isFreeShippingCoupon(rule) && ctx.orderKind === "print") {
    return { ok: false, code: "COUPON_NOT_APPLICABLE" };
  }

  // ⑦ 门槛 —— 跟**折后小计**比(用户看得见的那个数)
  const minAmount = Math.max(0, Math.floor(rule.minAmountCents ?? 0));
  if (ctx.couponBaseCents < minAmount) {
    return { ok: false, code: "COUPON_MIN_AMOUNT_NOT_MET" };
  }

  // ⑧ 总量
  const usageLimit = rule.usageLimit ?? null;
  const usedCount = rule.usedCount ?? 0;
  if (usageLimit != null && usedCount >= usageLimit) {
    return { ok: false, code: "COUPON_LIMIT_REACHED" };
  }

  // ⑨ 每人限用 —— 游客判不了身份,直接拒
  const perUserLimit = rule.perUserLimit ?? null;
  if (perUserLimit != null) {
    if (!ctx.isLoggedIn) {
      return { ok: false, code: "COUPON_PER_USER_LIMIT_REACHED" };
    }
    if (ctx.userUsedCount >= perUserLimit) {
      return { ok: false, code: "COUPON_PER_USER_LIMIT_REACHED" };
    }
  }

  // ⑩ 新人首单 —— 游客判不了身份,直接拒
  if (rule.firstOrderOnly) {
    if (!ctx.isLoggedIn) {
      return { ok: false, code: "COUPON_NOT_FIRST_ORDER" };
    }
    if (ctx.hasOrders) {
      return { ok: false, code: "COUPON_NOT_FIRST_ORDER" };
    }
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  算钱                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 这个码能减多少钱(分)
 *
 * ## 取整方向
 *
 * | kind | 算式 |
 * |---|---|
 * | `amount` | `min(amountCents, couponBase)` |
 * | `percent` | `floor(couponBase × rate)` 再 `min(…, maxDiscountCents)` |
 * | `free_shipping` | `0`(动的是运费,不是商品) |
 *
 * **百分比为什么向下取整** —— 仓库那条铁律是「**我们收的钱,一律向上取整
 * 到分**」。优惠额向下取整 ⇒ 收上去的合计等于 `ceil(base × (1 − rate))`
 * ⇒ **合计向上取整**。两个方向必须配套,不能各取各的。
 *
 * ```
 * base = 7700, rate = 0.15
 *   discount = floor(7700 × 1500 ÷ 10000) = 1155
 *   goods    = 7700 − 1155 = 6545
 *   ceil(7700 × 0.85) = 6545      ← 合计确实向上取整了,一致 ✅
 * ```
 *
 * **返回的数永远 ≤ `couponBaseCents`** —— 折扣不会把商品小计算成负数。
 */
export function computeCouponDiscount(
  rule: CouponRule,
  couponBaseCents: number
): number {
  const base = Math.max(0, Math.floor(couponBaseCents));

  switch (rule.kind) {
    case "amount": {
      const amount = Math.max(0, Math.floor(rule.amountCents ?? 0));
      return Math.min(amount, base);
    }
    case "percent": {
      const units = rateToUnits(rule.discountRate);
      if (units <= 0) return 0;
      let discount = Math.floor((base * units) / RATE_SCALE);
      const cap = rule.maxDiscountCents;
      if (cap != null && cap >= 0) {
        discount = Math.min(discount, Math.floor(cap));
      }
      return Math.min(discount, base);
    }
    case "free_shipping":
      // 免运费券不动商品 —— 运费那一行在 `cart-totals.ts` 里置 0
      return 0;
    default:
      return 0;
  }
}

/**
 * 这个码减免的**运费**(分)
 *
 * **只有免运费券非零。** 打印工单没有运费行(它的交期加价是加急费),
 * 所以免运费券用在打印工单上会被 `checkCouponApplicable` 拒掉。
 */
export function computeCouponShippingDiscount(
  rule: CouponRule,
  shippingCents: number
): number {
  if (!isFreeShippingCoupon(rule)) return 0;
  return Math.max(0, Math.floor(shippingCents));
}

/* -------------------------------------------------------------------------- */
/*  效果                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 这张券在**这张单**上的效果(减多少 + 免不免运费)
 *
 * ## 只算效果,**不判资格**
 *
 * 资格在 `checkCouponApplicable` 里判(过期 / 没满门槛 / 超限 / 不是新人 …)。
 * 这里**不看**那些 —— 只回答「如果这张券能用,它能减多少」。
 *
 * ## 为什么要有这个「不算资格」的版本
 *
 * 复用上一张待付款单那条路(`pending-order.ts`)要用它。
 *
 * 那张单是**券还有效的时候**建的,折扣已经算进它的合计里了。后来券过期了 /
 * 额度被别人抢完了 —— 但**用户要付的还是那张单上的价**(那是他们下单时
 * 同意的价)。这时候:
 *
 * 1. 先用本函数算出「这张券能减多少」→ 算出这次的合计
 * 2. 拿合计去比上一张待付款单 → 命中就**复用**(那张单的价已经锁死)
 * 3. 复用成功之后,券现在还能不能用**不重要** —— 那笔优惠早就在单上了
 *
 * 顺序反过来(先判资格再找复用)会怎样:首单券建的那张单已经算作「下过单」
 * ⇒ 再来一次判定 `NOT_FIRST_ORDER` ⇒ **用户连自己那张单都付不了**。
 *
 * ## 折扣跟判定用**同一份**纯函数
 *
 * `evaluateCoupon()` 和「复用那条路」都调它 —— 两处各算一遍,迟早对不上。
 */
export interface CouponEffect {
  /** 商品折扣(分)—— 免运费券是 0 */
  discountCents: number;
  /** 是不是免运费券 */
  freeShipping: boolean;
  /** 减免的运费(分)—— 只有免运费券非零 */
  freeShippingCents: number;
}

/**
 * 算一张券的效果 —— 见 `CouponEffect` 的说明
 */
export function computeCouponEffect(
  rule: CouponRule,
  couponBaseCents: number,
  shippingCents: number
): CouponEffect {
  return {
    discountCents: computeCouponDiscount(rule, couponBaseCents),
    freeShipping: isFreeShippingCoupon(rule),
    freeShippingCents: computeCouponShippingDiscount(rule, shippingCents),
  };
}
