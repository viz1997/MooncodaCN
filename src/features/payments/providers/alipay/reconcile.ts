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
 * - `app_id` 对不上 → 代码回 `success`(认不出来的单号不是错误)⇒ 支付宝
 *   **不再重投**
 *
 * ⇒ 结果都是**钱到了、订单永远是 `unpaid`**。用户盯着「正在确认支付…」转圈
 * 到超时,工作室那边看到的是一张没付的单。
 *
 * ⇒ 这一条路是**我们自己拿订单号去问支付宝**:查单请求用**应用私钥**签
 * (支付宝认),响应**支付宝公钥**验(这才可信)—— 跟同步回跳带回来的参数
 * 不能信是一个道理。
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
 * 另一套验不过就跳过,只是多试一次,**不放松任何校验**。
 *
 * ## 失败原因要挑「最该说给人听」的那条(2026-11-14)
 *
 * 原来全部试完都失败时,一律返回 `query_failed` + 最后一次的消息 ——
 * 工作室看到的永远是笼统的一句「支付宝查单没查成」,而真相可能是
 * 「支付宝公钥贴错了」或者「**我们拼错了待签字符串**」(线上真踩过:
 * `SO-20261114-137332` 查单永远 `signature_invalid` ⇒ 订单永远 `unpaid`
 * ⇒ 买家以为没付、再付一次 —— 那一单的真因是待签字符串**多了前缀**,
 * 见 `response-sign.ts` 的文件头)。
 *
 * ⇒ 每一套凭据的失败都**按严重度打分**,最后挑分最高的那条报出去。
 */

import { amountStringToCents } from "@/features/payments/lib/money";
import { settleByOrderNo } from "@/features/payments/lib/settle";

import { getAlipayConfigs } from "./config";
import { queryTradeByOrderNo } from "./query";
import {
  type AlipayReconcileCode,
  decideAlipayReconcile,
  rankAlipayReconcileFailure,
} from "./reconcile-rules";

/**
 * 一次查单尝试 —— **每一套凭据一条**
 *
 * ## 为什么要有它
 *
 * 判定层给的是**结论**(`code` / `message`),但工作室要修的时候需要的是
 * **原始事实**:支付宝到底回了什么?签名验过没有?我打的是哪个网关?
 *
 * 没有这些,工作室只能看到一句「支付宝查单没查成」—— 而真相往往是
 * 「公钥贴错了」「APPID 跟私钥不是一套」或者「我们拼错了待签字符串」
 * (线上真踩过:`SO-20261114-137332` 查单永远 `signature_invalid` ——
 * 那一单的真因是待签字符串多了前缀,见 `response-sign.ts`)。
 *
 * ⇒ 每一套凭据(沙箱 + 正式)都留一条,**原样**给工作室看。
 *
 * ⚠️ **不含任何密钥** —— 只有网关地址和支付宝回的那些字段。
 */
export interface AlipayQueryAttempt {
  /** 这一套凭据是**沙箱**还是**正式** */
  sandbox: boolean;
  /** 打的哪个网关(工作室对着它去支付宝后台对) */
  gateway: string;
  /** 查到了吗(`code === "10000"`) */
  ok: boolean;
  /**
   * 响应的签名验过了吗 —— **`false` = 签名没验过**
   *
   * ⚠️ **不等于「公钥贴错了」** —— 也可能是我们拼错了待签字符串
   * (线上真踩过:`SO-20261114-137332`,见 `response-sign.ts`)。
   */
  verified: boolean;
  /** 支付宝回的 `code`(`10000` = 成功) */
  code: string | null;
  /** 支付宝回的 `sub_code`(`ACQ.TRADE_NOT_EXIST` = 还没付) */
  subCode: string | null;
  /** 交易状态(`TRADE_SUCCESS` / `WAIT_BUYER_PAY` / …) */
  tradeStatus: string | null;
  /** 支付宝记的实付金额(**元**字符串) */
  totalAmount: string | null;
  /** 支付宝的订单号 */
  tradeNo: string | null;
  /** 支付宝自己给的话(`sub_msg` / `msg`) */
  message: string | null;
  /** 这一套凭据**整个挂了**(网络 / 上游)—— 有值就说明压根没拿到支付宝的回应 */
  error: string | null;
}

/** 一次对账的结果 */
export interface AlipayReconcileOutcome {
  /** 「我们核对过这笔已经付成功了」(验签过了 + 金额对得上) */
  paid: boolean;
  /**
   * 「支付宝那边**说**这笔已经付款成功了」
   *
   * 跟 `paid` **正交** —— 为真但 `paid` 为假,意思是「支付宝说付了,但我们
   * 核对不上(公钥不对 / 金额对不上)」。⇒ **用户不许再付一次**。
   */
  reportedPaid: boolean;
  /** 有没有真的落库 */
  settled: boolean;
  /** 原因码 */
  code: AlipayReconcileCode;
  /** 人话 */
  message: string;
  /** 支付宝的订单号(查到了才有) */
  tradeNo: string | null;
  /**
   * 每一套凭据的**原始事实** —— 给工作室看的
   *
   * 空数组 = 一套凭据都没试成(通道压根没配好)。
   */
  attempts: AlipayQueryAttempt[];
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
      reportedPaid: true,
      settled: false,
      code: decision.code,
      message: decision.message,
      tradeNo: null,
      attempts: [],
    };
  }

  // ---- 拿配置 ----
  const configs = await getAlipayConfigs();
  if (configs.length === 0) {
    return {
      paid: false,
      reportedPaid: false,
      settled: false,
      code: "not_configured",
      message: "支付宝通道没配好 —— 查不了单",
      tradeNo: null,
      attempts: [],
    };
  }

  // ---- 逐套凭据试 ----
  let lastFailure = "";
  let lastFailureCode: AlipayReconcileCode = "query_failed";
  /** 目前记下的那条失败的严重度 */
  let bestRank = -1;
  /** 有没有哪一套凭据说「这笔已经付过了」 */
  let reportedPaid = false;
  /** 「已付但核不上」那一档的人话 */
  let reportedPaidMessage: string | null = null;
  /** 每一套凭据的原始事实 —— 给工作室看的 */
  const attempts: AlipayQueryAttempt[] = [];

  /** 记一条失败 —— **只留更严重的**那条 */
  const rememberFailure = (
    code: AlipayReconcileCode,
    message: string
  ): void => {
    const rank = rankAlipayReconcileFailure(code);
    if (rank <= bestRank) return;
    bestRank = rank;
    lastFailureCode = code;
    lastFailure = message;
  };

  for (const config of configs) {
    let result: Awaited<ReturnType<typeof queryTradeByOrderNo>>;
    try {
      result = await queryTradeByOrderNo(orderNo, config);
    } catch (error) {
      // 这一次调用挂了(网络 / 上游)—— 换下一套凭据再试
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      attempts.push({
        sandbox: config.sandbox,
        gateway: config.gateway,
        ok: false,
        verified: false,
        code: null,
        subCode: null,
        tradeStatus: null,
        totalAmount: null,
        tradeNo: null,
        message: null,
        error: errorMessage,
      });
      rememberFailure("query_failed", errorMessage);
      continue;
    }

    // 这一套凭据的原始事实 —— 原样记下来
    attempts.push({
      sandbox: config.sandbox,
      gateway: config.gateway,
      ok: result.ok,
      verified: result.verified,
      code: result.code,
      subCode: result.subCode,
      tradeStatus: result.tradeStatus,
      totalAmount: result.totalAmount,
      tradeNo: result.tradeNo,
      message: result.message,
      error: null,
    });

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
      // 支付宝自己的话**原样带下去** —— 判定层要靠 `sub_code` 分
      // 「查不到」和「请求被拒」
      queryCode: result.code,
      querySubCode: result.subCode,
      queryMessage: result.message,
    });

    // 「支付宝说付过了」—— 记下来,哪怕这套凭据没验过
    if (decision.reportedPaid) {
      reportedPaid = true;
      reportedPaidMessage = decision.message;
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
        reportedPaid: true,
        settled: settled.changed,
        code: decision.code,
        message: settled.changed
          ? "主动查单确认已付款,订单已标为已支付"
          : "主动查单确认已付款(订单已经是已支付状态)",
        tradeNo: result.tradeNo,
        attempts,
      };
    }

    // ---- 「还没付」是最常见的正常结果 ----
    //
    // 查得到、验签过了、但交易状态还不是付款成功 —— **这就是用户还没付完**,
    // 不是错误。返回,别再试下一套凭据了(查得到就说明这一套是对的)。
    if (result.ok && result.verified) {
      return {
        paid: false,
        reportedPaid: decision.reportedPaid,
        settled: false,
        code: decision.code,
        message: decision.message,
        tradeNo: result.tradeNo,
        attempts,
      };
    }

    // ---- 这一套没成 ----
    //
    // 记下来 —— 但**只留最严重的那条**(见 `rankAlipayReconcileFailure`)。
    // 换下一套凭据再试。
    rememberFailure(decision.code, decision.message);
  }

  // ---- 全部都没查成 ----
  //
  // 报**最严重的那条**,不是笼统的「查单没查成」——
  // 工作室要能一眼看出「是签名没验过」还是「是用户还没付」。
  return {
    paid: false,
    reportedPaid,
    settled: false,
    code: lastFailureCode,
    message: reportedPaid
      ? (reportedPaidMessage ??
        lastFailure ??
        "支付宝那边说付过了,但我们核对不上")
      : lastFailure || "支付宝查单没查成",
    tradeNo: null,
    attempts,
  };
}
