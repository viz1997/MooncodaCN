/**
 * 支付宝**查单对账**的判断 —— **纯函数,零 import**
 *
 * ## 为什么要有「主动查单」
 *
 * 收钱以**支付宝主动推过来的异步通知**为准(见 `webhook.ts`)。但通知会丢:
 *
 * - `notify_url` 配错 / 指向本地地址 / 域名换过 → 支付宝推不到
 * - 通知验签失败(支付宝公钥贴错 / 不是同一个沙箱应用)→ 回 401,支付宝
 *   重投 8 次之后放弃
 * - `app_id` 对不上 → 代码回 `success`(认不出来的单号不是错误)⇒ 支付宝
 *   **不再重投**
 *
 * ⇒ 任何一种情况,结果都是**钱到了、订单永远是 `unpaid`**。用户盯着
 * 「正在确认支付…」转圈到超时,工作室那边看到的是一张没付的单。
 *
 * ⇒ 补一条**主动查单**的路:我们自己拿订单号去问支付宝「这单付了没」。
 * 查单请求用**应用私钥**签(支付宝认),响应用**支付宝公钥**验(这才可信)——
 * 跟同步回跳带回来的参数不能信是一个道理。
 *
 * ## 什么时候**不许**落库
 *
 * 查单结果只有三条**同时**成立才落库:
 *
 * 1. **验签过了**(响应确实是支付宝发的)
 * 2. **交易状态是付款成功**(`TRADE_SUCCESS` / `TRADE_FINISHED`)
 * 3. **金额对得上**(实付 == 订单应付)
 *
 * 少任何一条都**不落库** —— 落错了就是「没收到钱却标成已付」,那是资损。
 *
 * ## 判定顺序(短路,**顺序不能改**)
 *
 * ```
 * 已经付过 → 查不到 → 验签不过 → 不是付款成功 → 金额对不上 → 落库
 * ```
 *
 * 「已经付过」排第一 —— 已经落库的单**不该**再去查支付宝(浪费一次调用),
 * 也不该被后面的任何一条改回去。
 */

/** 支付宝那边算「付款成功」的交易状态 */
export const ALIPAY_PAID_TRADE_STATUSES = [
  "TRADE_SUCCESS",
  "TRADE_FINISHED",
] as const;

/** 对账结果的码 —— 每一码都有对应的人话 */
export type AlipayReconcileCode =
  /** 本地已经付过了 —— 不用查,也不该改 */
  | "already_paid"
  /** 支付宝那边查不到这笔交易(用户可能还没付) */
  | "not_found"
  /** 查单响应的签名验不过 —— 不敢凭它改订单状态 */
  | "signature_invalid"
  /** 交易状态还不是付款成功 */
  | "not_paid"
  /** 金额对不上 —— 绝不按这个数改订单状态 */
  | "amount_mismatch"
  /** 付款成功、金额对得上 —— 落库 */
  | "settled"
  /** 通道压根没配好 */
  | "not_configured"
  /** 查单这一次调用挂了(网络 / 上游) */
  | "query_failed";

/** 一次对账的判定结果 */
export interface AlipayReconcileDecision {
  /** 支付宝说这笔已经付成功了 */
  paid: boolean;
  /** 该不该把本地订单标成已付 */
  shouldSettle: boolean;
  /** 原因码 */
  code: AlipayReconcileCode;
  /** 人话(给日志 / 接口用) */
  message: string;
}

/**
 * 这个交易状态算「付款成功」吗
 *
 * `TRADE_SUCCESS` = 付款成功;`TRADE_FINISHED` = 交易完结(不可退款),
 * 钱一样到了 —— 两种都算。
 */
export function isAlipayPaidTradeStatus(
  tradeStatus: string | null | undefined
): boolean {
  if (!tradeStatus) return false;
  return (ALIPAY_PAID_TRADE_STATUSES as readonly string[]).includes(
    tradeStatus
  );
}

/**
 * 判定一次查单结果
 *
 * @param queryOk 查到了吗(`code === "10000"`)
 * @param verified 响应的签名验过了吗
 * @param tradeStatus 交易状态
 * @param paidAmountCents 支付宝那边记的实付金额(分);`null` = 没给
 * @param expectedAmountCents 订单应付金额(分);`null` = 不知道(不核对)
 * @param alreadyPaid 本地订单已经付过了吗
 */
export function decideAlipayReconcile(input: {
  queryOk: boolean;
  verified: boolean;
  tradeStatus: string | null;
  paidAmountCents: number | null;
  expectedAmountCents: number | null;
  alreadyPaid: boolean;
}): AlipayReconcileDecision {
  // ---- 1. 已经付过了 ----
  //
  // 排在最前面:已经落库的单**不该**再去查支付宝(浪费一次网络调用),
  // 也不该被后面任何一条改回去(退款之后更不能)。
  if (input.alreadyPaid) {
    return {
      paid: true,
      shouldSettle: false,
      code: "already_paid",
      message: "这笔订单已经是已付款",
    };
  }

  // ---- 2. 查不到 ----
  //
  // 支付宝那边压根不认这个订单号 —— 用户多半还没付。**不是错误**。
  if (!input.queryOk) {
    return {
      paid: false,
      shouldSettle: false,
      code: "not_found",
      message: "支付宝那边还没有这笔交易(用户可能还没付款)",
    };
  }

  // ---- 3. 验签不过 ----
  //
  // 查得到但签名不对 —— **不敢凭它改订单状态**。
  // (多半是沙箱公钥跟收钱那个沙箱应用不是一套。)
  if (!input.verified) {
    return {
      paid: false,
      shouldSettle: false,
      code: "signature_invalid",
      message:
        "支付宝查单响应的签名验不过 —— 不敢凭它改订单状态(公钥跟收钱那个应用不是一套?)",
    };
  }

  // ---- 4. 还不是付款成功 ----
  if (!isAlipayPaidTradeStatus(input.tradeStatus)) {
    return {
      paid: false,
      shouldSettle: false,
      code: "not_paid",
      message: `支付宝那边的交易状态还是 ${input.tradeStatus || "(空)"} —— 不是付款成功`,
    };
  }

  // ---- 5. 金额对不上 ----
  //
  // **两条都要查**:
  //
  // - 支付宝没给金额(`paidAmountCents === null`)⇒ 核不了 ⇒ 不落库。
  //   「付款成功但没有金额」是查不到的事实,不是可以放过的细节。
  // - 我们不知道应付多少(`expectedAmountCents === null`)⇒ 不核对。
  //   (正常不会发生 —— 应付金额是订单上的数。)
  if (input.expectedAmountCents !== null) {
    if (input.paidAmountCents === null) {
      return {
        paid: false,
        shouldSettle: false,
        code: "amount_mismatch",
        message: "支付宝没给实付金额 —— 核不了,不敢改订单状态",
      };
    }
    if (input.paidAmountCents !== input.expectedAmountCents) {
      return {
        paid: false,
        shouldSettle: false,
        code: "amount_mismatch",
        message:
          `金额对不上:支付宝记 ${input.paidAmountCents} 分,订单应付 ` +
          `${input.expectedAmountCents} 分 —— 不敢改订单状态`,
      };
    }
  }

  // ---- 6. 三条都成立 —— 落库 ----
  return {
    paid: true,
    shouldSettle: true,
    code: "settled",
    message: "支付宝那边已经付款成功,金额也对得上",
  };
}
