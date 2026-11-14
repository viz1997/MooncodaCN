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
 * ## `paid` 与 `reportedPaid` 是**两件事**(2026-11-14)
 *
 * 线上真踩过(`SO-20261114-137332`):支付宝那边**已经付款成功**,我们这边
 * 因为**验签那一步没过**(`signature_invalid` —— 那一单的真因是待签字符串
 * 多了前缀,见 `response-sign.ts`)**核不上** ⇒ 订单永远是 `unpaid`
 * ⇒ 买家以为没付、**再付一次**;
 * 工作室看到的是一张没付的单。用户那边看到的则是「正在确认支付…」转圈到
 * 超时,然后「重新支付」按钮**再跳一次同一个 `out_trade_no`** ⇒ 支付宝回
 * 「该订单已付款(TRADE_HAS_SUCCESS)」⇒ 死循环。
 *
 * ⇒ 两个信号必须**分开**摆:
 *
 * | 字段 | 意思 | 能不能落库 |
 * |---|---|---|
 * | `paid` | **我们核对过**了(验签过了 + 金额对得上) | ✅ 能 |
 * | `reportedPaid` | **支付宝那么说**(交易状态是付款成功) | ❌ **不能** |
 *
 * `reportedPaid` 为真时,人话里**必须**写明「请不要重复付款」—— 它唯一的作用
 * 就是**拦住第二次付款**。
 *
 * ## 「查不到」与「请求被拒」要分开(2026-11-14)
 *
 * 原来只有一档 `not_found`,把两种完全不同的情况混在一起:
 *
 * - **查不到这笔交易**(`ACQ.TRADE_NOT_EXIST`)—— 用户还没付,正常
 * - **支付宝把查单请求拒了**(`40002 invalid-app-id` / `40001` / `40006` …)
 *   —— 是**我们这边的配置不对**,重试一万次也一样
 *
 * 混在一起的后果:工作室永远只看到「支付宝那边还没有这笔交易」,而真相是
 * APPID 跟私钥不是一套。⇒ 分成 `not_found` / `query_rejected` 两档。
 *
 * ## 判定顺序(短路,**顺序不能改**)
 *
 * ```
 * 已经付过 → 查不到 / 请求被拒 → 验签不过 → 不是付款成功 → 金额对不上 → 落库
 * ```
 *
 * 「已经付过」排第一 —— 已经落库的单**不该**再去查支付宝(浪费一次调用),
 * 也不该被后面的任何一条改回去。
 *
 * **验签检查必须排在交易状态检查前面** —— 验不过的响应里那个
 * `trade_status` 是**不可信的**(可能是伪造的),先信它就等于把验签的意义
 * 架空了。
 */

/** 支付宝那边算「付款成功」的交易状态 */
export const ALIPAY_PAID_TRADE_STATUSES = [
  "TRADE_SUCCESS",
  "TRADE_FINISHED",
] as const;

/**
 * 支付宝说「这笔交易不存在」的子错误码
 *
 * `alipay.trade.query` 查一笔还不存在的单,支付宝回的是
 * `code=40004` + `sub_code=ACQ.TRADE_NOT_EXIST`(新沙箱有时是
 * `ACQ.RECORD_NOT_EXIST`)。
 */
export const ALIPAY_TRADE_NOT_EXIST_SUB_CODES = [
  "ACQ.TRADE_NOT_EXIST",
  "ACQ.RECORD_NOT_EXIST",
] as const;

/** 对账结果的码 —— 每一码都有对应的人话 */
export type AlipayReconcileCode =
  /** 本地已经付过了 —— 不用查,也不该改 */
  | "already_paid"
  /** 支付宝那边查不到这笔交易(用户可能还没付) */
  | "not_found"
  /** 支付宝把查单**请求**拒了 —— 是我们这边的配置/签名不对 */
  | "query_rejected"
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
  /**
   * 「我们核对过这笔已经付成功了」(验签过了 + 金额对得上)
   *
   * 只有这个为真才**可以**落库。
   */
  paid: boolean;
  /**
   * 「支付宝那边**说**这笔已经付款成功了」
   *
   * 跟 `paid` **正交** —— 它只说明交易状态那一栏写着付款成功,**不代表我们
   * 验证过**。为真时人话里会写「请不要重复付款」—— 它唯一的作用就是拦住
   * 第二次付款。
   */
  reportedPaid: boolean;
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
 * 支付宝说的是「这笔交易不存在」吗
 *
 * ⇒ 那是「用户还没付」,不是错误。
 */
export function isAlipayTradeNotExist(
  subCode: string | null | undefined
): boolean {
  if (!subCode) return false;
  return (ALIPAY_TRADE_NOT_EXIST_SUB_CODES as readonly string[]).includes(
    subCode
  );
}

/**
 * 把支付宝自己给的错误拼成一句能看懂的
 *
 * `code` / `sub_code` / `msg` 三样都带出来 —— 工作室对着支付宝后台查的时候,
 * 只需要照着这句话里的码去搜。
 */
export function describeAlipayQueryError(input: {
  // ⚠️ **显式带 `undefined`** —— 本仓库开了 `exactOptionalPropertyTypes`:
  // `code?: string | null` **不许**显式传 `undefined` 进来(只读得到 `null`)，
  // 而调用方的值是 `string | null | undefined`。
  code?: string | null | undefined;
  subCode?: string | null | undefined;
  message?: string | null | undefined;
}): string {
  const parts: string[] = [];
  if (input.code) parts.push(`code=${input.code}`);
  if (input.subCode) parts.push(`sub_code=${input.subCode}`);
  if (input.message) parts.push(input.message);
  return parts.join(" ");
}

/**
 * 失败原因的**严重度** —— 数字越大越该被工作室看见
 *
 * 查单会**试好几套凭据**(沙箱 + 正式),每一套都可能失败 ⇒ 最后要挑一个
 * 「最该说给人听」的原因。挑错了 ⇒ 工作室只看到一句笼统的「查单没查成」,
 * 而真相是「公钥贴错了」或者「我们拼错了待签字符串」—— 后者正是
 * 2026-11-14 线上踩的那个坑(见 `response-sign.ts` 的文件头)。
 *
 * 排序:
 *
 * | 码 | 严重度 | 为什么 |
 * |---|---|---|
 * | `query_rejected` | 6 | 支付宝拒了请求 ⇒ **配置错了**,重试没用 |
 * | `signature_invalid` | 5 | 签名没验过 ⇒ 公钥错的话通知那一条腿也一起废了 |
 * | `amount_mismatch` | 4 | 钱到了但对不上 ⇒ 要人工看 |
 * | `query_failed` | 3 | 网络 / 上游挂了 |
 * | `not_found` | 2 | 用户还没付 —— 正常 |
 * | `not_paid` | 1 | 交易状态还没到付款成功 —— 正常 |
 */
export function rankAlipayReconcileFailure(code: AlipayReconcileCode): number {
  switch (code) {
    case "query_rejected":
      return 6;
    case "signature_invalid":
      return 5;
    case "amount_mismatch":
      return 4;
    case "query_failed":
      return 3;
    case "not_found":
      return 2;
    case "not_paid":
      return 1;
    default:
      // settled / already_paid / not_configured —— 不是「失败」
      return 0;
  }
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
 * @param queryCode 支付宝回的 `code`(没给 = 不区分「查不到」与「被拒」)
 * @param querySubCode 支付宝回的 `sub_code`
 * @param queryMessage 支付宝回的 `msg`
 */
export function decideAlipayReconcile(input: {
  queryOk: boolean;
  verified: boolean;
  tradeStatus: string | null;
  paidAmountCents: number | null;
  expectedAmountCents: number | null;
  alreadyPaid: boolean;
  queryCode?: string | null | undefined;
  querySubCode?: string | null | undefined;
  queryMessage?: string | null | undefined;
}): AlipayReconcileDecision {
  // 「支付宝那边说这笔已经付款成功」—— **先算出来**,后面每一条都要带着它
  //
  // 验签不过时这个信号**不可信**(响应可能是伪造的),所以它**只用来提醒人
  // 别再付一次**,绝不用来落库。
  const reportedPaid = isAlipayPaidTradeStatus(input.tradeStatus);
  const detail = describeAlipayQueryError({
    code: input.queryCode,
    subCode: input.querySubCode,
    message: input.queryMessage,
  });
  const withDetail = (base: string): string =>
    detail ? `${base} —— 支付宝说:${detail}` : base;

  // ---- 1. 已经付过了 ----
  //
  // 排在最前面:已经落库的单**不该**再去查支付宝(浪费一次网络调用),
  // 也不该被后面任何一条改回去(退款之后更不能)。
  if (input.alreadyPaid) {
    return {
      paid: true,
      reportedPaid: true,
      shouldSettle: false,
      code: "already_paid",
      message: "这笔订单已经是已付款",
    };
  }

  // ---- 2. 没查到 ----
  //
  // 分两档:
  //
  // - **查不到这笔交易**(`ACQ.TRADE_NOT_EXIST`)⇒ 用户多半还没付。**不是错误**。
  // - **支付宝把请求拒了**(`40002 invalid-app-id` / `40001` / `40006` …)⇒
  //   是**我们这边的配置不对**,重试没用 ⇒ 必须跟工作室说清楚。
  //
  // 没带 `code` / `sub_code` 时(老的调用方 / 网络异常)一律当「查不到」——
  // 那是**多数情况**,也最不吓人。
  if (!input.queryOk) {
    const tradeNotExist = isAlipayTradeNotExist(input.querySubCode);
    if (tradeNotExist || !input.queryCode) {
      return {
        paid: false,
        reportedPaid: false,
        shouldSettle: false,
        code: "not_found",
        message: withDetail("支付宝那边还没有这笔交易(用户可能还没付款)"),
      };
    }
    return {
      paid: false,
      reportedPaid: false,
      shouldSettle: false,
      code: "query_rejected",
      message: withDetail(
        "支付宝把查单请求拒了 —— 这不是「用户没付」,是我们这边的配置/签名不对(APPID 跟私钥不是一套?公钥贴错了?)"
      ),
    };
  }

  // ---- 3. 验签不过 ----
  //
  // 查得到但签名不对 —— **不敢凭它改订单状态**。
  // (多半是沙箱公钥跟收钱那个沙箱应用不是一套。)
  //
  // ⚠️ 这一档排在交易状态检查**前面** —— 验不过的响应里那个
  // `trade_status` 不可信,先信它就等于把验签架空了。
  if (!input.verified) {
    return {
      paid: false,
      reportedPaid,
      shouldSettle: false,
      code: "signature_invalid",
      message: reportedPaid
        ? withDetail(
            "⚠️ 支付宝那边显示这笔已经付款成功,但我们核对不上(签名验不过)—— 请不要重复付款,工作室会人工确认"
          )
        : withDetail(
            "支付宝查单响应的签名验不过 —— 不敢凭它改订单状态(公钥跟收钱那个应用不是一套?)"
          ),
    };
  }

  // ---- 4. 还不是付款成功 ----
  if (!isAlipayPaidTradeStatus(input.tradeStatus)) {
    return {
      paid: false,
      reportedPaid: false,
      shouldSettle: false,
      code: "not_paid",
      message: withDetail(
        `支付宝那边的交易状态还是 ${input.tradeStatus || "(空)"} —— 不是付款成功`
      ),
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
        reportedPaid: true,
        shouldSettle: false,
        code: "amount_mismatch",
        message:
          "⚠️ 支付宝那边显示这笔已经付款成功,但没给实付金额 —— 核不了,不敢改订单状态。请不要重复付款,工作室会人工确认",
      };
    }
    if (input.paidAmountCents !== input.expectedAmountCents) {
      return {
        paid: false,
        reportedPaid: true,
        shouldSettle: false,
        code: "amount_mismatch",
        message:
          `⚠️ 支付宝那边显示这笔已经付款成功,但金额对不上:支付宝记 ${input.paidAmountCents} 分,` +
          `订单应付 ${input.expectedAmountCents} 分 —— 不敢改订单状态。请不要重复付款,工作室会人工确认`,
      };
    }
  }

  // ---- 6. 三条都成立 —— 落库 ----
  return {
    paid: true,
    reportedPaid: true,
    shouldSettle: true,
    code: "settled",
    message: "支付宝那边已经付款成功,金额也对得上",
  };
}
