/**
 * 支付宝**主动查单** —— 异步通知丢了之后的兜底
 *
 * ## 为什么要主动查单
 *
 * 收钱以**支付宝主动推过来的异步通知**为准(见 `webhook.ts`)。但通知会丢:
 *
 * - `notify_url` 配错 / 指向本地地址 / 域名换过 → 支付宝推不到
 * - 通知验签失败(支付宝公钥贴错 / 不是同一个沙箱应用)→ 回 401,支付宝
 *   重投 8 次之后放弃
 * - `app_id` 对不上 → 代码回 `success`(认不出来的单号不算错误)⇒ 支付宝
 *   **不再重投**
 *
 * ⇒ 结果都是**钱到了、订单永远是 `unpaid`**。用户盯着「正在确认支付…」转圈
 * 到超时,工作室那边看到的是一张没付的单。
 *
 * ⇒ 这一条路是**我们自己拿订单号去问支付宝**:查单请求用**应用私钥**签
 * (支付宝认),响应���**支付宝公钥**验(这才可信)—— 跟同步回跳带回来的参数
 * 不能信是同一个道理。
 *
 * ## 幂等
 *
 * 落库走 `settleByOrderNo()`,而它的状态判断在
 * `payments/lib/transitions.ts` —— `mark_paid` 遇到 `paymentStatus === "paid"`
 * 直接 skip ⇒ **重复查、重复落库无害**。
 *
 * ## 试几套凭据
 *
 * `getAlipayConfigs()` 给**两个模式**的配置(当前模式那一份排在前面)——
 * 拨开关的瞬间可能有**在途付款**:切到沙箱时,一笔**正式**订单的通知到了。
 * 另一套验不过就跳过,���只是多试一次,**不放松任何校验**。
 */

import { amountStringToCents } from "@/features/payments/lib/money";
import { settleByOrderNo } from "@/features/payments/lib/settle";

import { getAlipayConfigs } from "./config";
import { queryTradeByOrderNo } from "./query";
import {
  type AlipayReconcileCode,
  decideAlipayReconcile,
} from "./reconcile-rules";

/** 一次对账的结果 */
export interface AlipayReconcileOutcome {
  /** 支付宝说这笔已经付成功了(验签 + 金额都对得上) */
  paid: boolean;
  /** 有没有真的落库 */
  settled: boolean;
  /** 原因码 */
  code: AlipayReconcileCode;
  /** 人话 */
  message: string;
  /** 支付宝的订单号(查到了才有) */
  tradeNo: string | null;
}

/**
 * 主动查一次支付宝,该不该付就落库
 *
 * @param orderNo 我们的订单号(支付宝那边的 `out_trade_no`)
 * @param expectedAmountCents 订单应付金额(分)—— 用来核对支付宝记的实付
 * @param alreadyPaid 本地订单已经付过了吗 —— 已经付过就**不查**
 */
export async function reconcileAlipayPayment(params: {
  orderNo: string;
  expectedAmountCents: number | null;
  alreadyPaid: boolean;
}): Promise<AlipayReconcileOutcome> {
  const { orderNo, expectedAmountCents, alreadyPaid } = params;

  // ---- 已经付过了 —— 不查 ----
  //
  // 排在最前面:已经落库的单**不该**再去查支付宝(浪费一次网络调用),
  // 也不该被后面任何一条改回去(退款之后更不能)。
  if (alreadyPaid) {
    const decision = decideAlipayReconcile({
      queryOk: false,
      verified: false,
      tradeStatus: null,
      paidAmountCents: null,
      expectedAmountCents,
      alreadyPaid: true,
    });
    return {
      paid: true,
      settled: false,
      code: decision.code,
      message: decision.message,
      tradeNo: null,
    };
  }

  // ---- 拿配置 ----
  const configs = await getAlipayConfigs();
  if (configs.length === 0) {
    return {
      paid: false,
      settled: false,
      code: "not_configured",
      message: "支付宝通道没配好 —— 查不了单",
      tradeNo: null,
    };
  }

  // ---- 逐套凭据试 ----
  let lastFailure = "";
  for (const config of configs) {
    let result: Awaited<ReturnType<typeof queryTradeByOrderNo>>;
    try {
      result = await queryTradeByOrderNo(orderNo, config);
    } catch (error) {
      // 这一次调用挂了(网络 / 上游)—— 换下一套凭据再试
      lastFailure = error instanceof Error ? error.message : String(error);
      continue;
    }

    // 支付宝给的实付金额是**元字符串** —— 转成分,跟订单应付同一口径
    let paidAmountCents: number | null = null;
    if (result.totalAmount) {
      try {
        paidAmountCents = amountStringToCents(result.totalAmount);
      } catch {
        // 金额解析不了 ⇒ 当作「核不了」⇒ 下面的判定会拦住落库
        paidAmountCents = null;
      }
    }

    const decision = decideAlipayReconcile({
      queryOk: result.ok,
      verified: result.verified,
      tradeStatus: result.tradeStatus,
      paidAmountCents,
      expectedAmountCents,
      alreadyPaid: false,
    });

    // 查得到但不是付款成功 / 验签不过 —— 换下一套凭据再试
    // (可能是另一套沙箱应用收的钱)
    if (!decision.shouldSettle && result.ok && decision.code !== "not_paid") {
      lastFailure = decision.message;
      continue;
    }

    // ---- 该落库了 ----
    if (decision.shouldSettle) {
      const settled = await settleByOrderNo({
        orderNo,
        action: "mark_paid",
        channel: "alipay",
        providerOrderId: result.tradeNo,
      });
      return {
        paid: true,
        settled: settled.changed,
        code: decision.code,
        message: settled.changed
          ? "主动查单确认已付款,订单已标为已支付"
          : "主动查单确认已付款(订单已经是已支付状态)",
        tradeNo: result.tradeNo,
      };
    }

    // ---- 「还没付」是最常见的正常结果 ----
    //
    // 查得到、验签过了、但交易状态还不是付款成功 —— **这就是用户还没付完**,
    // 不是错误。返回,别再试下一套凭据了(查得到就说明这一套是对的)。
    if (result.ok && result.verified) {
      return {
        paid: false,
        settled: false,
        code: decision.code,
        message: decision.message,
        tradeNo: result.tradeNo,
      };
    }

    lastFailure = decision.message;
  }

  // ---- 全部都没查成 ----
  return {
    paid: false,
    settled: false,
    code: "query_failed",
    message: lastFailure || "支付宝查单没查成",
    tradeNo: null,
  };
}
