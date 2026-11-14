import { describe, expect, it } from "vitest";

/**
 * 支付宝**主动查单兜底** + **通知地址诊断** 的纯逻辑。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * 工作室 2026-11-14 报的是:支付宝沙箱那一单**付款成功了**,订单却永远停在
 * `unpaid`,用户盯着「正在确认支付…」转圈到超时(单号
 * `SO-20261114-657E4A`)。
 *
 * 根因是**异步通知没落库**,而仓库里**没有任何主动查单兜底** ——
 * `alipay/trade/query.ts` 的 `queryTradeByOrderNo` 从未被调用过。
 * ⇒ 通知一丢,那一单**永远**收不到钱。
 *
 * 这里守的不变量,每一条都对应一个**真会收错钱**的方向:
 *
 * 1. **验签不过 ⇒ 绝不落库** —— 凭一条验不过的消息改订单状态 = 没收到钱却
 *    标成已付(资损)
 * 2. **金额对不上 ⇒ 绝不落库** —— 同上,而且更隐蔽
 * 3. **判定顺序短路** —— 「已经付过」排第一,不能被后面任何一条改回去
 * 4. **节流** —— 轮询 3 秒一轮,每一轮都查 = 一笔单打 40 次查单
 * 5. **通知地址配错要能一眼看出** —— 配错了之后**没有任何报错**
 */

import {
  NOTIFY_URL_PROBLEM_MESSAGES,
  resolveNotifyUrl,
} from "@/features/payments/lib/notify-url";
import {
  claimReconcileSlot,
  createReconcileThrottleState,
  RECONCILE_THROTTLE_MS,
  resetReconcileThrottle,
} from "@/features/payments/lib/reconcile-throttle";
import {
  ALIPAY_PAID_TRADE_STATUSES,
  decideAlipayReconcile,
  describeAlipayQueryError,
  isAlipayPaidTradeStatus,
  isAlipayTradeNotExist,
  rankAlipayReconcileFailure,
} from "@/features/payments/providers/alipay/reconcile-rules";

/* -------------------------------------------------------------------------- */
/*  交易状态                                                                    */
/* -------------------------------------------------------------------------- */

describe("isAlipayPaidTradeStatus", () => {
  it("TRADE_SUCCESS 算付款成功", () => {
    expect(isAlipayPaidTradeStatus("TRADE_SUCCESS")).toBe(true);
  });

  it("TRADE_FINISHED 也算付款成功(钱一样到了)", () => {
    expect(isAlipayPaidTradeStatus("TRADE_FINISHED")).toBe(true);
  });

  it("等待付款 / 已关闭都不算", () => {
    expect(isAlipayPaidTradeStatus("WAIT_BUYER_PAY")).toBe(false);
    expect(isAlipayPaidTradeStatus("TRADE_CLOSED")).toBe(false);
  });

  it("空值不算", () => {
    expect(isAlipayPaidTradeStatus(null)).toBe(false);
    expect(isAlipayPaidTradeStatus(undefined)).toBe(false);
    expect(isAlipayPaidTradeStatus("")).toBe(false);
  });

  it("只认那两个状态(不多不少)", () => {
    expect([...ALIPAY_PAID_TRADE_STATUSES]).toEqual([
      "TRADE_SUCCESS",
      "TRADE_FINISHED",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*  查单判定                                                                    */
/* -------------------------------------------------------------------------- */

describe("decideAlipayReconcile", () => {
  const base = {
    queryOk: true,
    verified: true,
    tradeStatus: "TRADE_SUCCESS",
    paidAmountCents: 24700,
    expectedAmountCents: 24700,
    alreadyPaid: false,
  };

  it("付款成功 + 金额对得上 ⇒ 落库", () => {
    const decision = decideAlipayReconcile(base);
    expect(decision.paid).toBe(true);
    expect(decision.shouldSettle).toBe(true);
    expect(decision.code).toBe("settled");
  });

  it("已经付过了 ⇒ 不查也不改(短路排第一)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      alreadyPaid: true,
      // 就算后面全是坏条件,也不能改 already_paid
      queryOk: false,
      verified: false,
      tradeStatus: null,
      paidAmountCents: null,
    });
    expect(decision.code).toBe("already_paid");
    expect(decision.paid).toBe(true);
    expect(decision.shouldSettle).toBe(false);
  });

  it("查不到 ⇒ not_found(不是错误)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      queryOk: false,
    });
    expect(decision.code).toBe("not_found");
    expect(decision.paid).toBe(false);
    expect(decision.shouldSettle).toBe(false);
  });

  it("验签不过 ⇒ 绝不落库", () => {
    const decision = decideAlipayReconcile({
      ...base,
      verified: false,
    });
    expect(decision.code).toBe("signature_invalid");
    expect(decision.shouldSettle).toBe(false);
  });

  it("交易状态不是付款成功 ⇒ not_paid,人话里带上那个状态", () => {
    const decision = decideAlipayReconcile({
      ...base,
      tradeStatus: "WAIT_BUYER_PAY",
    });
    expect(decision.code).toBe("not_paid");
    expect(decision.shouldSettle).toBe(false);
    expect(decision.message).toContain("WAIT_BUYER_PAY");
  });

  it("交易状态是空 ⇒ not_paid,人话里写「(空)」", () => {
    const decision = decideAlipayReconcile({
      ...base,
      tradeStatus: null,
    });
    expect(decision.code).toBe("not_paid");
    expect(decision.message).toContain("(空)");
  });

  it("支付宝没给实付金额 ⇒ 核不了 ⇒ 不落库", () => {
    const decision = decideAlipayReconcile({
      ...base,
      paidAmountCents: null,
    });
    expect(decision.code).toBe("amount_mismatch");
    expect(decision.shouldSettle).toBe(false);
  });

  it("金额对不上 ⇒ 不落库,人话里带上两个数", () => {
    const decision = decideAlipayReconcile({
      ...base,
      paidAmountCents: 100,
    });
    expect(decision.code).toBe("amount_mismatch");
    expect(decision.shouldSettle).toBe(false);
    expect(decision.message).toContain("100");
    expect(decision.message).toContain("24700");
  });

  it("不知道应付多少 ⇒ 不核对金额(订单上的数正常都有)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      expectedAmountCents: null,
    });
    expect(decision.code).toBe("settled");
    expect(decision.shouldSettle).toBe(true);
  });

  it("一条都不许落库 —— 除了 settled 那一档", () => {
    const cases = [
      { ...base, alreadyPaid: true },
      { ...base, queryOk: false },
      { ...base, verified: false },
      { ...base, tradeStatus: "WAIT_BUYER_PAY" },
      { ...base, tradeStatus: null },
      { ...base, paidAmountCents: null },
      { ...base, paidAmountCents: 1 },
    ];
    for (const input of cases) {
      const decision = decideAlipayReconcile(input);
      expect(decision.shouldSettle).toBe(false);
      expect(decision.code).not.toBe("settled");
    }
  });

  it("判定顺序:already_paid → not_found → signature_invalid", () => {
    // 三条坏条件同时成立 ⇒ 报第一条
    expect(
      decideAlipayReconcile({
        ...base,
        alreadyPaid: true,
        queryOk: false,
        verified: false,
      }).code
    ).toBe("already_paid");

    expect(
      decideAlipayReconcile({
        ...base,
        queryOk: false,
        verified: false,
      }).code
    ).toBe("not_found");

    expect(
      decideAlipayReconcile({
        ...base,
        verified: false,
        tradeStatus: "WAIT_BUYER_PAY",
      }).code
    ).toBe("signature_invalid");
  });

  it("判定顺序:not_paid → amount_mismatch(状态先判)", () => {
    expect(
      decideAlipayReconcile({
        ...base,
        tradeStatus: "WAIT_BUYER_PAY",
        paidAmountCents: null,
      }).code
    ).toBe("not_paid");
  });

  /* ------------------------------------------------------------------ */
  /*  「查不到」与「请求被拒」要分开(2026-11-14)                          */
  /* ------------------------------------------------------------------ */

  it("支付宝说这笔交易不存在 ⇒ not_found(用户还没付,不是错误)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      queryOk: false,
      queryCode: "40004",
      querySubCode: "ACQ.TRADE_NOT_EXIST",
      queryMessage: "交易不存在",
    });
    expect(decision.code).toBe("not_found");
    expect(decision.reportedPaid).toBe(false);
    expect(decision.shouldSettle).toBe(false);
  });

  it("新沙箱的 RECORD_NOT_EXIST 也算「查不到」", () => {
    const decision = decideAlipayReconcile({
      ...base,
      queryOk: false,
      queryCode: "40004",
      querySubCode: "ACQ.RECORD_NOT_EXIST",
    });
    expect(decision.code).toBe("not_found");
  });

  it("支付宝把查单请求拒了 ⇒ query_rejected(**不是**「用户没付」)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      queryOk: false,
      queryCode: "40002",
      querySubCode: "ACQ.INVALID_PARAMETER",
      queryMessage: "无效的AppID参数",
    });
    expect(decision.code).toBe("query_rejected");
    expect(decision.reportedPaid).toBe(false);
    expect(decision.shouldSettle).toBe(false);
    // 人话里必须点出「配置不对」,不然工作室以为用户没付
    expect(decision.message).toContain("配置");
    // 支付宝自己给的码要带出来 —— 工作室照着它去支付宝后台搜
    expect(decision.message).toContain("40002");
    expect(decision.message).toContain("ACQ.INVALID_PARAMETER");
  });

  it("query_rejected 与 not_found 都不错报成「用户还没付」", () => {
    const rejected = decideAlipayReconcile({
      ...base,
      queryOk: false,
      queryCode: "40006",
    });
    const notFound = decideAlipayReconcile({
      ...base,
      queryOk: false,
      querySubCode: "ACQ.TRADE_NOT_EXIST",
    });
    expect(rejected.code).not.toBe(notFound.code);
    expect(rejected.message).not.toBe(notFound.message);
  });

  it("没带 code ⇒ 当成「查不到」(多数情况,也不吓人)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      queryOk: false,
    });
    expect(decision.code).toBe("not_found");
  });

  /* ------------------------------------------------------------------ */
  /*  `paid` 与 `reportedPaid` 是两件事(2026-11-14)                       */
  /* ------------------------------------------------------------------ */

  it("验签不过但支付宝说付了 ⇒ reportedPaid 为真(拦住第二次付款)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      verified: false,
    });
    expect(decision.code).toBe("signature_invalid");
    expect(decision.reportedPaid).toBe(true);
    // ⚠️ 但**不许**落库 —— 没验过签
    expect(decision.paid).toBe(false);
    expect(decision.shouldSettle).toBe(false);
    expect(decision.message).toContain("请不要重复付款");
  });

  it("验签不过且交易状态不是付款成功 ⇒ reportedPaid 为假", () => {
    const decision = decideAlipayReconcile({
      ...base,
      verified: false,
      tradeStatus: "WAIT_BUYER_PAY",
    });
    expect(decision.code).toBe("signature_invalid");
    expect(decision.reportedPaid).toBe(false);
    expect(decision.message).not.toContain("请不要重复付款");
  });

  it("支付宝没给实付金额 ⇒ reportedPaid 为真(不许落库,但要拦住重复付款)", () => {
    const decision = decideAlipayReconcile({
      ...base,
      paidAmountCents: null,
    });
    expect(decision.code).toBe("amount_mismatch");
    expect(decision.reportedPaid).toBe(true);
    expect(decision.shouldSettle).toBe(false);
    expect(decision.message).toContain("请不要重复付款");
  });

  it("金额对不上 ⇒ reportedPaid 为真 + 人话里带两个数", () => {
    const decision = decideAlipayReconcile({
      ...base,
      paidAmountCents: 100,
    });
    expect(decision.code).toBe("amount_mismatch");
    expect(decision.reportedPaid).toBe(true);
    expect(decision.shouldSettle).toBe(false);
    expect(decision.message).toContain("请不要重复付款");
    expect(decision.message).toContain("100");
    expect(decision.message).toContain("24700");
  });

  it("查不到 / 请求被拒 / 还没付 ⇒ reportedPaid 一律为假", () => {
    expect(
      decideAlipayReconcile({ ...base, queryOk: false }).reportedPaid
    ).toBe(false);
    expect(
      decideAlipayReconcile({
        ...base,
        queryOk: false,
        queryCode: "40002",
      }).reportedPaid
    ).toBe(false);
    expect(
      decideAlipayReconcile({
        ...base,
        tradeStatus: "WAIT_BUYER_PAY",
      }).reportedPaid
    ).toBe(false);
  });

  it("落库那一档两个信号都为真", () => {
    const decision = decideAlipayReconcile(base);
    expect(decision.paid).toBe(true);
    expect(decision.reportedPaid).toBe(true);
    expect(decision.shouldSettle).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  「支付宝说交易不存在」                                                     */
/* -------------------------------------------------------------------------- */

describe("isAlipayTradeNotExist", () => {
  it("ACQ.TRADE_NOT_EXIST 算", () => {
    expect(isAlipayTradeNotExist("ACQ.TRADE_NOT_EXIST")).toBe(true);
  });

  it("ACQ.RECORD_NOT_EXIST 也算(新沙箱)", () => {
    expect(isAlipayTradeNotExist("ACQ.RECORD_NOT_EXIST")).toBe(true);
  });

  it("别的子码不算", () => {
    expect(isAlipayTradeNotExist("ACQ.INVALID_PARAMETER")).toBe(false);
    expect(isAlipayTradeNotExist("ACQ.SYSTEM_ERROR")).toBe(false);
  });

  it("空值不算", () => {
    expect(isAlipayTradeNotExist(null)).toBe(false);
    expect(isAlipayTradeNotExist(undefined)).toBe(false);
    expect(isAlipayTradeNotExist("")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  把支付宝自己的错误拼成人话                                                  */
/* -------------------------------------------------------------------------- */

describe("describeAlipayQueryError", () => {
  it("code / sub_code / message 都带出来", () => {
    const text = describeAlipayQueryError({
      code: "40002",
      subCode: "ACQ.INVALID_PARAMETER",
      message: "无效的AppID参数",
    });
    expect(text).toContain("code=40002");
    expect(text).toContain("sub_code=ACQ.INVALID_PARAMETER");
    expect(text).toContain("无效的AppID参数");
  });

  it("空的那几项不摆出来", () => {
    const text = describeAlipayQueryError({
      code: "40004",
      subCode: null,
      message: undefined,
    });
    expect(text).toBe("code=40004");
  });

  it("什么都没给 ⇒ 空串(人话里就不加「支付宝说:」那一截)", () => {
    expect(describeAlipayQueryError({})).toBe("");
    expect(
      describeAlipayQueryError({ code: null, subCode: null, message: null })
    ).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/*  失败原因的严重度 —— 挑一个「最该说给人听」的                                */
/* -------------------------------------------------------------------------- */

describe("rankAlipayReconcileFailure", () => {
  it("「配置错了」那一档最严重(重试没用)", () => {
    expect(rankAlipayReconcileFailure("query_rejected")).toBeGreaterThan(
      rankAlipayReconcileFailure("signature_invalid")
    );
    expect(rankAlipayReconcileFailure("signature_invalid")).toBeGreaterThan(
      rankAlipayReconcileFailure("amount_mismatch")
    );
    expect(rankAlipayReconcileFailure("amount_mismatch")).toBeGreaterThan(
      rankAlipayReconcileFailure("query_failed")
    );
    expect(rankAlipayReconcileFailure("query_failed")).toBeGreaterThan(
      rankAlipayReconcileFailure("not_found")
    );
    expect(rankAlipayReconcileFailure("not_found")).toBeGreaterThan(
      rankAlipayReconcileFailure("not_paid")
    );
  });

  it("「还没付」那一档比「配置错了」低 —— 别把正常情况说成故障", () => {
    expect(rankAlipayReconcileFailure("not_found")).toBeLessThan(
      rankAlipayReconcileFailure("query_rejected")
    );
  });

  it("不是「失败」的那几档 = 0", () => {
    expect(rankAlipayReconcileFailure("settled")).toBe(0);
    expect(rankAlipayReconcileFailure("already_paid")).toBe(0);
    expect(rankAlipayReconcileFailure("not_configured")).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  节流                                                                        */
/* -------------------------------------------------------------------------- */

describe("claimReconcileSlot", () => {
  it("第一次放行", () => {
    const state = createReconcileThrottleState();
    expect(claimReconcileSlot("SO-1", 1000, 20000, state)).toBe(true);
  });

  it("冷却期内再查 ⇒ 跳过", () => {
    const state = createReconcileThrottleState();
    claimReconcileSlot("SO-1", 1000, 20000, state);
    expect(claimReconcileSlot("SO-1", 1999, 20000, state)).toBe(false);
  });

  it("过了间隔 ⇒ 放行", () => {
    const state = createReconcileThrottleState();
    claimReconcileSlot("SO-1", 1000, 20000, state);
    expect(claimReconcileSlot("SO-1", 21000, 20000, state)).toBe(true);
  });

  it("不同订单互不影响", () => {
    const state = createReconcileThrottleState();
    expect(claimReconcileSlot("SO-1", 1000, 20000, state)).toBe(true);
    expect(claimReconcileSlot("SO-2", 1000, 20000, state)).toBe(true);
  });

  it("默认间隔是 20 秒", () => {
    expect(RECONCILE_THROTTLE_MS).toBe(20_000);
  });

  it("自己造的状态不污染进程内那一份", () => {
    const state = createReconcileThrottleState();
    claimReconcileSlot("SO-x", 1000, 20000, state);
    expect(state.lastClaimAt.has("SO-x")).toBe(true);
    // 进程内那份是空的 ⇒ 同一个订单号在默认状态上仍然放行
    expect(claimReconcileSlot("SO-x", 1000)).toBe(true);
    resetReconcileThrottle();
  });
});

/* -------------------------------------------------------------------------- */
/*  通知地址诊断                                                                */
/* -------------------------------------------------------------------------- */

describe("resolveNotifyUrl", () => {
  const path = "/api/webhooks/alipay";

  it("显式配的地址优先", () => {
    const diagnosis = resolveNotifyUrl({
      explicitNotifyUrl: "https://aimake3d.com/api/webhooks/alipay",
      siteUrl: "https://other.example.com",
      notifyPath: path,
    });
    expect(diagnosis.source).toBe("explicit");
    expect(diagnosis.notifyUrl).toBe(
      "https://aimake3d.com/api/webhooks/alipay"
    );
    expect(diagnosis.problems).toEqual([]);
    expect(diagnosis.usable).toBe(true);
  });

  it("没显式配 ⇒ 用站点地址拼一个", () => {
    const diagnosis = resolveNotifyUrl({
      siteUrl: "https://aimake3d.com",
      notifyPath: path,
    });
    expect(diagnosis.source).toBe("site");
    expect(diagnosis.notifyUrl).toBe(
      "https://aimake3d.com/api/webhooks/alipay"
    );
    expect(diagnosis.usable).toBe(true);
  });

  it("站点地址的尾部斜杠被去掉(不然会拼出 //api/...)", () => {
    const diagnosis = resolveNotifyUrl({
      siteUrl: "https://aimake3d.com/",
      notifyPath: path,
    });
    expect(diagnosis.notifyUrl).toBe(
      "https://aimake3d.com/api/webhooks/alipay"
    );
  });

  it("显式配的是空白 ⇒ 当作没配,退回站点地址", () => {
    const diagnosis = resolveNotifyUrl({
      explicitNotifyUrl: "   ",
      siteUrl: "https://aimake3d.com",
      notifyPath: path,
    });
    expect(diagnosis.source).toBe("site");
  });

  it("两样都没有 ⇒ MISSING", () => {
    const diagnosis = resolveNotifyUrl({ notifyPath: path });
    expect(diagnosis.notifyUrl).toBeNull();
    expect(diagnosis.source).toBe("none");
    expect(diagnosis.problems).toContain("MISSING");
    expect(diagnosis.usable).toBe(false);
  });

  it("不是合法网址 ⇒ INVALID_URL", () => {
    const diagnosis = resolveNotifyUrl({
      explicitNotifyUrl: "这不是一个网址",
      notifyPath: path,
    });
    expect(diagnosis.problems).toContain("INVALID_URL");
    expect(diagnosis.usable).toBe(false);
  });

  it("不是 https ⇒ NOT_HTTPS", () => {
    const diagnosis = resolveNotifyUrl({
      explicitNotifyUrl: "http://aimake3d.com/api/webhooks/alipay",
      notifyPath: path,
    });
    expect(diagnosis.problems).toContain("NOT_HTTPS");
    expect(diagnosis.usable).toBe(false);
  });

  it("指向本机 ⇒ LOCAL_ADDRESS", () => {
    for (const url of [
      "https://localhost/api/webhooks/alipay",
      "https://127.0.0.1/api/webhooks/alipay",
      "https://0.0.0.0/api/webhooks/alipay",
      "https://my-box.local/api/webhooks/alipay",
    ]) {
      const diagnosis = resolveNotifyUrl({
        explicitNotifyUrl: url,
        notifyPath: path,
      });
      expect(diagnosis.problems).toContain("LOCAL_ADDRESS");
      expect(diagnosis.usable).toBe(false);
    }
  });

  it("本机 + http ⇒ 两个问题都摆出来", () => {
    const diagnosis = resolveNotifyUrl({
      explicitNotifyUrl: "http://localhost:3000/api/webhooks/alipay",
      notifyPath: path,
    });
    expect(diagnosis.problems).toContain("NOT_HTTPS");
    expect(diagnosis.problems).toContain("LOCAL_ADDRESS");
  });

  it("https 公网地址 ⇒ 没问题", () => {
    const diagnosis = resolveNotifyUrl({
      explicitNotifyUrl: "https://aimake3d.com/api/webhooks/alipay",
      notifyPath: path,
    });
    expect(diagnosis.problems).toEqual([]);
    expect(diagnosis.usable).toBe(true);
  });

  it("每个问题码都有一句人话", () => {
    for (const code of [
      "MISSING",
      "INVALID_URL",
      "NOT_HTTPS",
      "LOCAL_ADDRESS",
    ] as const) {
      expect(NOTIFY_URL_PROBLEM_MESSAGES[code]).toBeTruthy();
    }
  });
});
