/**
 * 收款金额核对 —— **纯函数,零 import**
 *
 * ## 为什么要有这一层
 *
 * 平台推过来的「这笔钱到了」通知里**带着金额**:
 *
 * | 通道 | 字段 | 单位 |
 * |---|---|---|
 * | 微信 | `amount.total` | **分** |
 * | 支付宝 | `total_amount` | **元**(要先转成分) |
 *
 * 我们手里也有**订单应付**(`storefront_order.total_cents` /
 * `print_order.total_price_cents`)。
 *
 * ⇒ 两者**必须一分不差**。差一分就意味着:平台记的那笔款跟我们要收的那笔
 * 款**不是同一笔**(金额被改过 / 订单串了 / 通知是旧的)。
 *
 * ## 验签过了 ≠ 金额对
 *
 * 一条**验签通过但金额不对**的通知,照样能把订单标成「已付」⇒
 * **收了不该收的钱、发了不该发的货**。签名的作用是「这条通知确实是平台
 * 发的」,它管不了「平台记的这笔钱是不是我们收的那笔钱」。
 *
 * ⇒ 金额对不上 ⇒ **一格都不改**(`payment_status` 也不改),只记一条醒目的
 * 日志,让工作室人工确认。
 *
 * ## 三种「通知里的金额」
 *
 * | 值 | 意思 | 判定 |
 * |---|---|---|
 * | `undefined` | **这个通道不核对** —— 调用方压根没传 | 放行 |
 * | `null` | 读了,但**解析不出来**(平台没带这个字段 / 格式不认识) | **拦住** |
 * | 数字 | 平台报了这个数 | 一分不差才算过 |
 *
 * 「解析不出来 ⇒ 拦住」是 **fail closed** —— **核不了**就不能当作**核过了**。
 * 跟 `providers/alipay/reconcile-rules.ts` 是同一个口径(那儿那一档叫
 * `amount_mismatch`)。
 *
 * ## 只在「标已付」那一腿核对
 *
 * 退款通知带的是**退款金额**,不是订单总额 —— 拿订单总额去比,每一笔退款
 * 都会被拒掉。⇒ 这一层只由 `settleByOrderNo()` 在 `action === "mark_paid"`
 * 那一档调用。
 */

/** 核对没过时的原因码 */
export type PaidAmountCheckCode =
  /** 金额**核不了** —— 平台没给这个字段,或者给的不是一个正常的数 */
  | "AMOUNT_MISSING"
  /** 金额**对不上** —— 平台记的那笔跟订单应付不是同一笔 */
  | "AMOUNT_MISMATCH";

/**
 * 一次核对的结果
 *
 * 「核对过了」那一档**不带**多余字段 —— 调用方只需要知道 `ok`。
 */
export type PaidAmountCheck =
  | { ok: true }
  | {
      ok: false;
      /** 原因码 */
      code: PaidAmountCheckCode;
      /** 订单应付(分) */
      expectedCents: number;
      /** 通知里的金额(分)—— `null` = 读不出来 */
      notifiedCents: number | null;
      /** 人话(给日志看) */
      message: string;
    };

/**
 * 核对「平台记的实收金额」跟「订单应付」是不是同一笔
 *
 * @param expectedCents 订单应付金额(分)—— 真理源是订单上存下来的那一列
 * @param notifiedCents 平台通知里的金额(分)
 *   - `undefined` ⇒ **这个通道不核对**(调用方没传)⇒ 放行
 *   - `null` ⇒ **读不出来** ⇒ 拦住(fail closed)
 *   - 数字 ⇒ 一分不差才算过
 */
export function verifyPaidAmount(input: {
  expectedCents: number;
  notifiedCents?: number | null | undefined;
}): PaidAmountCheck {
  const { expectedCents, notifiedCents } = input;

  // ---- 1. 这个通道不核对 ----
  //
  // 旧路(Shopify 草稿单)的回调压根不带金额 —— 那一支**维持原样**,
  // 不因为加了这一层就把它也拦住。
  if (notifiedCents === undefined) {
    return { ok: true };
  }

  // ---- 2. 我们自己的应付金额不是一个正常的数 ⇒ 核不了 ⇒ 拦住 ----
  //
  // 正常不会发生(应付金额是订单上的整数列)。真发生了说明数据有问题 ——
  // 核不了就不能当作核过了。
  if (!Number.isInteger(expectedCents) || expectedCents < 0) {
    return {
      ok: false,
      code: "AMOUNT_MISSING",
      expectedCents,
      notifiedCents: notifiedCents ?? null,
      message: `订单应付金额不是一个正常的数(${expectedCents} 分)—— 核不了,不敢改订单状态`,
    };
  }

  // ---- 3. 通知里的金额读不出来 ⇒ 核不了 ⇒ 拦住 ----
  //
  // ⚠️ **fail closed** —— 「平台没报金额」不等于「金额是对的」。
  // 「付款成功但没有金额」是查不到的事实,不是可以放过的细节
  // (跟 `reconcile-rules.ts` 那一档同一个口径)。
  if (notifiedCents === null || !Number.isInteger(notifiedCents)) {
    return {
      ok: false,
      code: "AMOUNT_MISSING",
      expectedCents,
      notifiedCents: null,
      message: `平台那边没有报实付金额 —— 核不了,不敢改订单状态(订单应付 ${expectedCents} 分)`,
    };
  }

  // 负数不是一笔付款
  if (notifiedCents < 0) {
    return {
      ok: false,
      code: "AMOUNT_MISSING",
      expectedCents,
      notifiedCents: null,
      message: `平台那边报的实付金额是负数(${notifiedCents} 分)—— 核不了,不敢改订单状态`,
    };
  }

  // ---- 4. 一分不差才算过 ----
  if (notifiedCents !== expectedCents) {
    return {
      ok: false,
      code: "AMOUNT_MISMATCH",
      expectedCents,
      notifiedCents,
      message:
        `金额对不上:平台记 ${notifiedCents} 分,订单应付 ${expectedCents} 分 —— ` +
        `不敢改订单状态,请工作室人工核对`,
    };
  }

  // ---- 5. 对上了 ----
  return { ok: true };
}
