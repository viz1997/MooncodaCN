"use server";

/**
 * /admin/refunds —— 后台退款管理 server actions(2026-11-14)
 *
 * 这一组 action 是**退款申请的写入口**,也是**退钱那一步的唯一入口**。
 *
 * - `adminListRefundRequestsAction` —— 读退款申请(商城订单 + 打印工单摆一张表)
 * - `adminApproveRefundAction` —— 同意(工作室受理,钱还没退)
 * - `adminRejectRefundAction` —— 拒绝(必须写备注)
 * - `adminMarkRefundedAction` —— **手工**退完钱之后回来记账
 * - `adminExecuteRefundAction` —— **调平台退款 API**(工作室拍板的那一步)
 *
 * ## 为什么「执行退款」是调平台 API,不是自己记账
 *
 * 工作室的原话:「所以才需要别人已经做好支付管理(付款、退款等),不要自己
 * 重新造轮子」。微信 / 支付宝**已经有**一整套退款机制:幂等键
 * (`out_refund_no` / `out_request_no`)+ 退款状态机 + 异步通知。自己造一套
 * 「记账 + 手工对账」就是重复实现别人已经做好的东西,而且**退两次钱**的风险
 * 全在自己身上。
 *
 * ⇒ 这一层很薄:递过去「订单号 + 金额 + 原因」,拿回一个状态。
 *
 * ## 幂等键 = 退款申请行的 id
 *
 * 微信 `out_refund_no` / 支付宝 `out_request_no` 都是它 ⇒ **重试用同一个号**,
 * 平台那边只会退一次钱。**换个号重试 = 退两次钱。**
 *
 * ⚠️ 所以这个号**绝不重新生成** —— 它就存库(`refund_request.id`)。
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(是申请不在?是这个状态不让改?是通道没配好?是平台拒了?)。所以这里把
 * **能预见的**失败都变成一个 code,界面照着 code 给话。
 *
 * ## 「use server」文件只导出 async 函数
 *
 * 类型**不能**在这里 re-export —— Turbopack 会把它注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。类型全在
 * `./types.ts`。
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PRICE_CURRENCY } from "@/config/currency";
import {
  landRefundOutcome,
  narrowRefundableChannel,
  resolveChannel,
} from "@/features/refund/lib/land-refund";
import {
  getRefundOrderSnapshot,
  getRefundRequestById,
  listAdminRefundRows,
  recordRefundProviderOutcome,
  transitionRefundStatus,
} from "@/features/refund/lib/refund-store";
import { REFUND_STATUSES } from "@/features/refund/lib/transitions";
import { getPaymentProvider } from "@/features/payments/lib/registry";
import type { PaymentRefundOutcome } from "@/features/payments/lib/types";
import {
  PaymentNotConfiguredError,
  PaymentProviderError,
} from "@/features/payments/lib/types";
import { logger } from "@/lib/logger";
import { adminAction } from "@/lib/safe-action";

import type {
  AdminRefundListResult,
  AdminRefundWriteResult,
} from "./types";

const withAdminRefundAction = (name: string) =>
  adminAction.metadata({ action: `admin.refund.${name}` });

/** 每次写完都要刷的路径 */
const REVALIDATE_PATH = "/[locale]/admin/refunds";

/**
 * ⚠️ 「钱退到了」那一步**不在这个文件里**
 *
 * 它住在 `../lib/land-refund.ts` —— 因为平台的**异步通知**(微信
 * `REFUND.SUCCESS` / 支付宝退款通知)也要走同一份落地逻辑,那两条腿在
 * webhook 里,不能 import 一个 `"use server"` 文件的工具函数。
 *
 * ⇒ 后台这一页、微信通知、支付宝通知,**四条腿共用一份落地实现** ⇒ 不会
 * 把状态写成两个不同的值。
 */

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读退款申请列表
 *
 * **商城订单 + 打印工单摆一张表** —— 工作室一天几十单,拆成两个页面等于来回切。
 *
 * 表还没建(迁移脚本没跑)时返 `{ok:false, code:"MIGRATION_MISSING"}` —— 界面
 * 显示「先跑 `pnpm migrate:apply-refund`」,不是 500。
 */
export const adminListRefundRequestsAction = withAdminRefundAction("list")
  .schema(
    z.object({
      status: z.enum([...REFUND_STATUSES, "all"]).nullable().optional(),
    })
  )
  .action(async ({ parsedInput }): Promise<AdminRefundListResult> => {
    try {
      const rows = await listAdminRefundRows({
        status:
          parsedInput.status && parsedInput.status !== "all"
            ? parsedInput.status
            : null,
      });
      return { ok: true, rows };
    } catch (error) {
      logger.error(
        { err: error },
        "[refund] 读退款申请列表失败 —— 迁移脚本跑过吗?"
      );
      return { ok: false, code: "MIGRATION_MISSING" };
    }
  });

/* -------------------------------------------------------------------------- */
/*  写:同意 / 拒绝 / 手工记账                                                  */
/* -------------------------------------------------------------------------- */

/** 「同意」/「拒绝」/「标记已退款」共用的入参 */
const changeStatusSchema = z.object({
  refundId: z.string().min(1).max(64),
  /** 处理备注 —— 拒绝时**必填**(服务端强校验) */
  note: z.string().max(500).nullish(),
  /**
   * 实际退款金额(分)—— 「标记已退款」时用
   *
   * 工作室可能少退一点(部分补偿)⇒ 默认 = 申请金额,填了就按填的记。
   */
  refundedCents: z.number().int().positive().nullish(),
});

/**
 * 同意退款 —— `pending → approved`
 *
 * 这一步**不动钱**。它表示「工作室受理了,钱退不退还在执行」。
 *
 * ## 为什么有这一档
 *
 * 平台退款 API 可能返回 `PROCESSING`(钱还在路上)—— 这时候本地**不能**急着写
 * `refunded`。`approved` 就是给「钱在路上」留的位置。
 */
export const adminApproveRefundAction = withAdminRefundAction("approve")
  .schema(changeStatusSchema)
  .action(async ({ parsedInput, ctx }): Promise<AdminRefundWriteResult> => {
    const result = await transitionRefundStatus({
      refundRequestId: parsedInput.refundId,
      toStatus: "approved",
      note: parsedInput.note ?? null,
      actor: "admin",
      reviewedBy: ctx.userId,
    });

    if (!result.ok) {
      return { ok: false, code: result.code };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    revalidateBuyerPaths(result.refund.orderKind);

    return {
      ok: true,
      refundId: result.refund.id,
      changed: result.changed,
    };
  });

/**
 * 拒绝退款申请 —— `pending|approved → rejected`
 *
 * **必须写备注** —— 「为什么不退」工作室和买家都得知道。服务端强校验
 * (`refundTransitionRequiresNote`),界面也会拦一道(便利,不是权威)。
 */
export const adminRejectRefundAction = withAdminRefundAction("reject")
  .schema(changeStatusSchema)
  .action(async ({ parsedInput, ctx }): Promise<AdminRefundWriteResult> => {
    const result = await transitionRefundStatus({
      refundRequestId: parsedInput.refundId,
      toStatus: "rejected",
      note: parsedInput.note ?? null,
      actor: "admin",
      reviewedBy: ctx.userId,
    });

    if (!result.ok) {
      return { ok: false, code: result.code };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    revalidateBuyerPaths(result.refund.orderKind);

    return {
      ok: true,
      refundId: result.refund.id,
      changed: result.changed,
    };
  });

/**
 * 标记已退款 —— **工作室在商家后台手工退完钱之后**回来记账
 *
 * ## 这条路保留着,因为它是**兜底**
 *
 * 通道没配好 / 平台拒了 / 走的本来就是线下转账 —— 那几种情况只有它能用。
 * 走这条路时**平台侧那几列是空的**(我们没调过平台),所以界面上要能一眼看出
 * 「这一笔是手工退的」。
 *
 * ## 本地状态仍然是唯一写入口
 *
 * 写的是 `payment_status = "refunded"`(走 `settleByOrderNo` 的
 * `mark_refunded`),**绝不改订单的 `status`** —— 退款不是订单状态。
 */
export const adminMarkRefundedAction = withAdminRefundAction("markRefunded")
  .schema(changeStatusSchema)
  .action(async ({ parsedInput, ctx }): Promise<AdminRefundWriteResult> => {
    const refundRow = await getRefundRequestById(parsedInput.refundId);
    if (!refundRow) {
      return { ok: false, code: "REFUND_NOT_FOUND" };
    }

    // 「钱退到了」那一步 —— 跟平台异步通知**共用一份实现**
    const landed = await landRefundOutcome({
      refundRequestId: refundRow.id,
      orderNo: refundRow.orderNo,
      orderKind: refundRow.orderKind,
      channel: resolveChannel(refundRow.paymentChannel),
      refundedCents: parsedInput.refundedCents ?? refundRow.amountCents,
      note: parsedInput.note ?? null,
      actor: "admin",
      reviewedBy: ctx.userId,
    });

    if (!landed.ok) {
      return { ok: false, code: landed.code, detail: landed.detail ?? null };
    }

    // 动钱的操作 —— 记一条结构化日志(仓库里**没有**审计表,
    // `/admin/system-logs` 还是 mock ⇒ 退款申请表 + 这条日志就是审计线索)
    logger.info(
      {
        adminId: ctx.userId,
        refundId: refundRow.id,
        orderNo: refundRow.orderNo,
        orderKind: refundRow.orderKind,
        amountCents: parsedInput.refundedCents ?? refundRow.amountCents,
        channel: refundRow.paymentChannel,
        manual: true,
      },
      "[refund] 工作室手工标记已退款"
    );

    revalidatePath(REVALIDATE_PATH, "page");
    revalidateBuyerPaths(refundRow.orderKind);

    return {
      ok: true,
      refundId: refundRow.id,
      changed: landed.changed,
    };
  });

/* -------------------------------------------------------------------------- */
/*  写:执行退款(调平台退款 API)                                               */
/* -------------------------------------------------------------------------- */

/** 「执行退款」的入参 */
const executeRefundSchema = z.object({
  refundId: z.string().min(1).max(64),
  /**
   * 要退多少(分)—— 默认 = 申请金额(= 整单总额)
   *
   * 工作室可能少退一点 ⇒ 允许改。**但不许超过订单总额**。
   */
  refundCents: z.number().int().positive().nullish(),
  /** 处理备注 —— 平台那边会展示给买家 */
  note: z.string().max(500).nullish(),
});

/**
 * 执行退款 —— **后台点一下,系统自动调平台退款 API**(工作室拍板的那一步)
 *
 * ```
 * 「执行退款」
 *    ↓
 * 服务端:按订单的 payment_channel 取 provider
 *    ↓
 * provider.refund({
 *   orderNo,                       // out_trade_no —— 我们自己的订单号
 *   outRefundNo: refundRequest.id, // 幂等键 —— 重试也用同一个号
 *   totalCents, refundCents, reason, currency,
 * })
 *    ↓
 * succeeded → settleByOrderNo({ action: "mark_refunded" })  ← 钱退了,改本地状态
 * processing → 只记 providerRefundStatus,本地状态留在 approved
 *             (等平台的异步通知,或工作室再点一次)
 * rejected  → 只记 refundError(平台原文),本地状态留在 approved
 * ```
 *
 * ## 三档结果里只有一档能动本地状态
 *
 * - `succeeded` —— 钱退到了 ⇒ `payment_status = "refunded"`
 * - `processing` —— 钱**还在路上** ⇒ **不许**写已退款(那是资损)
 * - `rejected` —— 平台拒了,钱没动 ⇒ 只把平台的原文记下来给工作室看
 *
 * ## 通道不支持 ⇒ 指到手工那条路
 *
 * 通道没配好 / 走的不是微信支付宝 / 平台那边拒了 —— 这几种情况只有「在商家
 * 后台手工退,再回来点『标记已退款』」能用。错误文案里**要把这条路指出来**,
 * 别只说一句「失败」。
 */
export const adminExecuteRefundAction = withAdminRefundAction("execute")
  .schema(executeRefundSchema)
  .action(async ({ parsedInput, ctx }): Promise<AdminRefundWriteResult> => {
    /* ---- 1. 申请本身 ------------------------------------------------- */
    const refundRow = await getRefundRequestById(parsedInput.refundId);
    if (!refundRow) {
      return { ok: false, code: "REFUND_NOT_FOUND" };
    }
    if (refundRow.status === "refunded" || refundRow.status === "rejected") {
      // 终态 —— 再点一次没有意义(钱早就退过 / 已经写掉了)
      return { ok: false, code: "INVALID_TRANSITION" };
    }

    /* ---- 2. 订单快照 ------------------------------------------------- */
    const snapshot = await getRefundOrderSnapshot({
      orderKind: refundRow.orderKind,
      orderNo: refundRow.orderNo,
      // 后台不传 userId ⇒ 不限归属(后台看的是全部单)
    });
    if (!snapshot) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }
    if (snapshot.paymentStatus !== "paid") {
      return {
        ok: false,
        code: "NOT_REFUNDABLE",
        detail: `这笔订单现在的收款状态是「${snapshot.paymentStatus}」—— 不是已支付,不能退`,
      };
    }

    /* ---- 3. 通道 ----------------------------------------------------- */
    const rawChannel = snapshot.paymentChannel ?? refundRow.paymentChannel;
    const channel = narrowRefundableChannel(rawChannel);
    if (!channel) {
      return {
        ok: false,
        code: "REFUND_NOT_SUPPORTED",
        detail: rawChannel
          ? `通道「${rawChannel}」没有退款接口 —— 请在商家后台手工退款,再回来点「标记已退款」`
          : "这一单没有收款通道 —— 请在商家后台手工退款,再回来点「标记已退款」",
      };
    }

    const provider = getPaymentProvider(channel);
    if (!provider || typeof provider.refund !== "function") {
      return {
        ok: false,
        code: "REFUND_NOT_SUPPORTED",
        detail:
          "这个通道没有实现退款接口 —— 请在商家后台手工退款,再回来点「标记已退款」",
      };
    }

    /* ---- 4. 金额 ----------------------------------------------------- */
    const refundCents = parsedInput.refundCents ?? refundRow.amountCents;
    if (!Number.isInteger(refundCents) || refundCents <= 0) {
      return { ok: false, code: "INVALID_INPUT" };
    }
    if (refundCents > snapshot.totalCents) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        detail: "退款金额不能超过订单金额",
      };
    }

    /* ---- 5. 调平台 --------------------------------------------------- */
    let outcome: PaymentRefundOutcome;
    try {
      outcome = await provider.refund({
        orderNo: refundRow.orderNo,
        // ⚠️ **幂等键 = 退款申请行的 id** —— 不是新生成的号。
        //    重试用同一个号,平台那边只会退一次钱;换个号就是退两次钱。
        outRefundNo: refundRow.id,
        totalCents: snapshot.totalCents,
        refundCents,
        reason: parsedInput.note?.trim() || refundRow.reason,
        currency: PRICE_CURRENCY,
      });
    } catch (error) {
      if (error instanceof PaymentNotConfiguredError) {
        // 通道没配好 —— **重试没用**,得先配。⇒ 指到手工那条路
        logger.warn(
          { err: error, channel },
          "[refund] 退款通道没配好 —— 退不了"
        );
        return {
          ok: false,
          code: "REFUND_NOT_SUPPORTED",
          detail:
            "退款通道没配好(缺环境变量)—— 请在商家后台手工退款,再回来点「标记已退款」",
        };
      }
      if (error instanceof PaymentProviderError) {
        // 这次调用挂了 —— 钱的状态**未知**。重试是安全的(幂等键不变)。
        logger.error(
          { err: error, channel, refundId: refundRow.id },
          "[refund] 调平台退款失败 —— 钱的状态未知,别换个号重试"
        );
        return {
          ok: false,
          code: "PROVIDER_REJECTED",
          detail: error.message,
        };
      }
      logger.error(
        { err: error, channel, refundId: refundRow.id },
        "[refund] 调平台退款出了预料之外的错"
      );
      return { ok: false, code: "PROVIDER_REJECTED" };
    }

    /* ---- 6. 按结果落库 ----------------------------------------------- */
    if (outcome.status === "succeeded") {
      // 钱退到了 —— 写本地状态。
      //
      // ⚠️ 这一步跟平台的**异步通知**共用同一份实现
      // (`../lib/land-refund.ts`)⇒ 同步腿和异步腿不会把状态写成两个不同的值。
      const landed = await landRefundOutcome({
        refundRequestId: refundRow.id,
        orderNo: refundRow.orderNo,
        orderKind: refundRow.orderKind,
        channel,
        refundedCents: refundCents,
        providerRefundId: outcome.providerRefundId,
        providerStatus: outcome.providerStatus,
        note: parsedInput.note ?? null,
        actor: "admin",
        reviewedBy: ctx.userId,
      });
      if (!landed.ok) {
        // 平台那边已经退了,本地写不进去 —— **这是最糟的一种情况**:
        // 钱退了但系统记不上。记一条 error 日志,界面也得看得见。
        logger.error(
          { refundId: refundRow.id, orderNo: refundRow.orderNo, code: landed.code },
          "[refund] ⚠️ 平台已退款,但本地状态写不进去 —— 工作室请人工核对"
        );
        return {
          ok: false,
          code: landed.code,
          detail:
            outcome.providerRefundId ??
            "平台那边已经退了,但本地状态写不进去 —— 请人工核对",
        };
      }

      logger.info(
        {
          adminId: ctx.userId,
          refundId: refundRow.id,
          orderNo: refundRow.orderNo,
          orderKind: refundRow.orderKind,
          amountCents: refundCents,
          channel,
          providerRefundId: outcome.providerRefundId,
          providerStatus: outcome.providerStatus,
        },
        "[refund] 平台退款成功"
      );

      revalidatePath(REVALIDATE_PATH, "page");
      revalidateBuyerPaths(refundRow.orderKind);

      return {
        ok: true,
        refundId: refundRow.id,
        changed: landed.changed,
        providerStatus: "succeeded",
        providerRefundId: outcome.providerRefundId,
      };
    }

    if (outcome.status === "processing") {
      // 钱**还在路上** —— 只记平台侧那几列,本地状态留在 approved
      //
      // ⚠️ 不能写 `refunded` —— 那就是「钱还没到却记成退了」(资损)。
      const transition = await transitionRefundStatus({
        refundRequestId: refundRow.id,
        toStatus: "approved",
        note: parsedInput.note ?? null,
        actor: "admin",
        reviewedBy: ctx.userId,
        providerRefundId: outcome.providerRefundId,
        providerRefundStatus: outcome.providerStatus,
      });
      if (!transition.ok) {
        await recordRefundProviderOutcome({
          refundRequestId: refundRow.id,
          providerRefundId: outcome.providerRefundId,
          providerRefundStatus: outcome.providerStatus,
          note: parsedInput.note ?? null,
        });
      }

      logger.info(
        {
          adminId: ctx.userId,
          refundId: refundRow.id,
          orderNo: refundRow.orderNo,
          amountCents: refundCents,
          channel,
          providerStatus: outcome.providerStatus,
        },
        "[refund] 平台退款处理中 —— 等异步通知"
      );

      revalidatePath(REVALIDATE_PATH, "page");
      revalidateBuyerPaths(refundRow.orderKind);

      return {
        ok: true,
        refundId: refundRow.id,
        changed: transition.ok ? transition.changed : true,
        providerStatus: "processing",
        providerRefundId: outcome.providerRefundId,
        detail: outcome.detail ?? null,
      };
    }

    // `rejected` —— 平台拒了,钱**没动**
    const recorded = await recordRefundProviderOutcome({
      refundRequestId: refundRow.id,
      providerRefundId: outcome.providerRefundId,
      providerRefundStatus: outcome.providerStatus,
      refundError: outcome.detail,
      note: parsedInput.note ?? null,
    });
    if (!recorded.ok) {
      return { ok: false, code: recorded.code };
    }

    logger.warn(
      {
        adminId: ctx.userId,
        refundId: refundRow.id,
        orderNo: refundRow.orderNo,
        providerStatus: outcome.providerStatus,
        detail: outcome.detail,
      },
      "[refund] 平台拒绝了这次退款 —— 钱没动"
    );

    revalidatePath(REVALIDATE_PATH, "page");
    revalidateBuyerPaths(refundRow.orderKind);

    return {
      ok: false,
      code: "PROVIDER_REJECTED",
      detail: outcome.detail,
    };
  });

/* -------------------------------------------------------------------------- */
/*  内部工具                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 写完顺手刷买家侧的页面
 *
 * 买家侧详情页是 RSC 首屏 + 客户端轮询;这里刷一下首屏的缓存,轮询那边
 * 自己会跟上。
 */
function revalidateBuyerPaths(orderKind: "storefront" | "print"): void {
  if (orderKind === "print") {
    revalidatePath("/[locale]/account/print-orders", "page");
    return;
  }
  revalidatePath("/[locale]/account/orders", "page");
}
