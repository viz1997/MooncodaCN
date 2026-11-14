/**
 * 退款落地 —— **三条腿共用一份实现**
 *
 * ## 为什么单独一个文件
 *
 * 「钱退到了」这件事有**三条腿**会碰到它:
 *
 * | 腿 | 什么时候 |
 * |---|---|
 * | **同步腿** | 后台点「执行退款」,平台当场回 `succeeded` |
 * | **异步腿(微信)** | `POST /api/webhooks/wechat` 收到 `REFUND.SUCCESS` |
 * | **异步腿(支付宝)** | `POST /api/webhooks/alipay` 收到退款异步通知 |
 *
 * 还有一条**兜底腿**:工作室在商家后台手工退完钱,回后台点「标记已退款」。
 *
 * 四条腿如果各写一遍「改申请状态 + 改订单收款状态 + 取消打印工单」,
 * 迟早写出两个不同的结果(比如同步腿改了订单、异步腿只改了申请单 ⇒
 * 买家那边订单还显示「已支付」)。⇒ **这里只写一份,四条腿都调它。**
 *
 * ## ⚠️ 为什么这个文件**不是** `"use server"`
 *
 * `"use server"` 文件只能导出 async 函数,而且**不能被别的模块 import 它的
 * 内部工具**(Turbopack 会把每个导出注册成 server action)。而 webhook 那两条
 * 腿需要复用「取消打印工单」「收窄通道」这些工具 ⇒ 它们**必须**住在一个
 * 普通的服务器模块里。
 *
 * ⚠️ 这个模块 import 了 `@/db`(经 `refund-store`)⇒ **客户端组件不许 import
 * 它**。
 */

import { after } from "next/server";

import {
  notifyPrintOrderStatusChanged,
  toPrintOrderMailInfo,
} from "@/features/print-quote/lib/notifications";
import { transitionPrintOrderStatus } from "@/features/print-quote/lib/order-store";
import { PRINT_ORDER_REFUNDABLE_STATUSES } from "@/features/refund/lib/eligibility";
import {
  getRefundOrderSnapshot,
  recordRefundProviderOutcome,
  transitionRefundStatus,
} from "@/features/refund/lib/refund-store";
import type {
  RefundActor,
  RefundErrorCode,
  RefundOrderKind,
} from "@/features/refund/lib/types";
import { settleByOrderNo } from "@/features/payments/lib/settle";
import type { PaymentChannel } from "@/features/payments/lib/types";
import { logger } from "@/lib/logger";

/**
 * 只有微信 / 支付宝实现了 `refund()`
 *
 * Shopify / 旧路(Sellbase + Stripe)2026-11-05 就下线了 —— 那两条路**没有**
 * 退款实现。`offline`(线下转账)本来就没有平台可调。
 *
 * ⇒ 走那几个通道的单**只能走手工那条路**(工作室在商家后台退完,再回来点
 * 「标记已退款」)。
 */
export const REFUNDABLE_CHANNELS = ["wechat", "alipay"] as const;

export type RefundableChannel = (typeof REFUNDABLE_CHANNELS)[number];

/**
 * 把「这一单走哪个通道收的钱」收窄成**支持退款的通道**
 *
 * 认不出来一律当「不支持」⇒ 界面指到手工那条路。**不猜** —— 猜错的后果是
 * 拿错通道去退钱。
 */
export function narrowRefundableChannel(
  channel: string | null | undefined
): RefundableChannel | null {
  if (!channel) return null;
  return (REFUNDABLE_CHANNELS as readonly string[]).includes(channel)
    ? (channel as RefundableChannel)
    : null;
}

/**
 * `settleByOrderNo` 要一个 `PaymentChannel`
 *
 * 认不出来的通道(线下转账 / 旧通道)落成 `offline` —— 那只是一个**记账用的
 * 标签**,不会去调任何平台接口。
 */
export function resolveChannel(
  channel: string | null | undefined
): PaymentChannel {
  switch (channel) {
    case "wechat":
    case "alipay":
    case "shopify":
    case "stripe":
      return channel;
    default:
      return "offline";
  }
}

/**
 * 退款成功之后把打印工单取消掉
 *
 * ## 为什么
 *
 * 工作室可能还在印一个**已经退款的**单 —— 白干一场,还得多退一次料钱。
 *
 * ## 必须走 `transitionPrintOrderStatus`
 *
 * 它是仓库里**唯一**合法的工单状态写入口,会写时间线事件(买家看得见)。
 * 自己写一条 UPDATE 就是当年被删掉的那条「后门」。
 *
 * ## 只在工单还停在 `PENDING` / `CONFIRMED` 时才动
 *
 * `IN_PRODUCTION` 及以后的单**本来就不允许退款**(工作室原话:「开始打印或者
 * 生产开始后无法退款」)⇒ 走到这一步的一定是还没开印的。
 *
 * ## 失败**不抛**
 *
 * 钱已经退完了,工单状态是**派生信息**。记一条日志继续 —— 工作室照样能在
 * 后台把工单改掉。
 */
export async function cancelPrintOrderAfterRefund(
  orderKind: RefundOrderKind,
  orderNo: string,
  note: string | null
): Promise<void> {
  if (orderKind !== "print") return;

  const snapshot = await getRefundOrderSnapshot({
    orderKind: "print",
    orderNo,
  });
  if (!snapshot) return;
  if (
    !(PRINT_ORDER_REFUNDABLE_STATUSES as readonly string[]).includes(
      snapshot.status
    )
  ) {
    return;
  }

  try {
    const result = await transitionPrintOrderStatus({
      orderNo,
      to: "CANCELLED",
      actor: "admin",
      note: note?.trim()
        ? `退款完成,工单取消:${note.trim()}`
        : "退款完成,工单取消",
      // 后台操作 —— 不限归属
      userId: null,
    });

    after(async () => {
      try {
        await notifyPrintOrderStatusChanged({
          order: toPrintOrderMailInfo(result.order),
          toStatus: "CANCELLED",
          note: null,
        });
      } catch (error) {
        logger.warn(
          { err: error, orderNo },
          "[refund] 退款后取消工单的邮件发不出去"
        );
      }
    });
  } catch (error) {
    // 推不动不影响退款本身 —— 钱已经退完了
    logger.error(
      { err: error, orderNo },
      "[refund] 退款后没能自动取消工单 —— 工作室请手工改一下工单状态"
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  落地                                                                       */
/* -------------------------------------------------------------------------- */

/** 「钱退到了」这件事的入参 */
export type LandRefundInput = {
  /** 退款申请行的 id —— **幂等键**,平台那边就是用它认这笔退款 */
  refundRequestId: string;
  /** 订单号(我们自己的) */
  orderNo: string;
  /** 订单类型 */
  orderKind: RefundOrderKind;
  /** 收款通道 */
  channel: PaymentChannel;
  /** 实际退款金额(分) */
  refundedCents: number;
  /** 平台侧退款单号 */
  providerRefundId?: string | null;
  /** 平台侧退款状态原文(`SUCCESS` / `PROCESSING` / `TRADE_SUCCESS` …) */
  providerStatus?: string | null;
  /** 备注 */
  note?: string | null;
  /** 谁触发的这一步 */
  actor?: RefundActor;
  /** 处理人(admin 用户 id) */
  reviewedBy?: string | null;
};

/** 落地的结果 */
export type LandRefundResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: RefundErrorCode; detail?: string };

/**
 * 「钱退到了」= **三件事**,顺序固定
 *
 * 1. **申请单** → `refunded`(走 `transitionRefundStatus`,唯一的状态写入口)
 * 2. **订单收款状态** → `payment_status = "refunded"`
 *    (走 `settleByOrderNo` 的 `mark_refunded` —— **只改 `payment_status`,
 *    绝不动订单的 `status`**。退款不是订单状态。)
 * 3. **打印工单** → 顺手取消(工作室不该还在印一个退款的单)
 *
 * ## 为什么第 2 步用 `settleByOrderNo` 而不是自己 UPDATE
 *
 * `settleByOrderNo` 是**全仓唯一**能写 `payment_status` 的地方 —— 它里面还有
 * 「迟到的付款通知不能把退过款的单改回已支付」那条守卫。自己写一条 UPDATE
 * 就会绕过它 ⇒ 一个退过款的单可能被 webhook 写成 `paid`。
 *
 * ## 第 1 步失败 ⇒ **整个落地都失败**
 *
 * 申请单写不进去(表不存在 / 状态非法)⇒ **不写订单状态** —— 否则会出现
 * 「订单说退了、申请单说没退」的两个真相来源。
 *
 * ## 已经退过了(幂等)
 *
 * 平台会**重投**通知,工作室也会**重复点**。`transitionRefundStatus` 碰到同状态
 * 返 `{ok:true, changed:false}` —— 不刷时间线、不报错。平台侧那几列这时
 * 补写一次(保证它们跟平台一致),然后照常把订单标成已退款。
 */
export async function landRefundOutcome(
  input: LandRefundInput
): Promise<LandRefundResult> {
  const transition = await transitionRefundStatus({
    refundRequestId: input.refundRequestId,
    toStatus: "refunded",
    note: input.note ?? null,
    actor: input.actor ?? "admin",
    reviewedBy: input.reviewedBy ?? null,
    refundedCents: input.refundedCents,
    providerRefundId: input.providerRefundId ?? null,
    providerRefundStatus: input.providerStatus ?? null,
  });

  if (!transition.ok) {
    return { ok: false, code: transition.code };
  }

  // 状态已经是 refunded(重复通知 / 重复点击)⇒ `transitionRefundStatus`
  // 短路了,**平台侧那几列没写** —— 这时补写一次,保证跟平台一致。
  if (!transition.changed && (input.providerRefundId || input.providerStatus)) {
    await recordRefundProviderOutcome({
      refundRequestId: input.refundRequestId,
      providerRefundId: input.providerRefundId ?? null,
      providerRefundStatus: input.providerStatus ?? null,
    });
  }

  // 只改 `payment_status`,绝不动订单的 `status`
  await settleByOrderNo({
    orderNo: input.orderNo,
    action: "mark_refunded",
    channel: input.channel,
  });

  // 打印工单:退完款顺手把工单取消
  await cancelPrintOrderAfterRefund(
    input.orderKind,
    input.orderNo,
    input.note ?? null
  );

  return { ok: true, changed: transition.changed };
}
