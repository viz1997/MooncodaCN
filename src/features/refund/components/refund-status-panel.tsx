"use client";

/**
 * 买家侧的退款状态面板 —— **两个详情页共用这一份**
 *
 * 商城订单和打印工单各有一个详情页,退款的显示内容**一模一样** ⇒ 只写一个
 * 组件,两处 import。
 *
 * ## 没有申请就**什么都不渲染**
 *
 * 大多数单子从来没退过款 —— 给每一张订单都摆一个空面板是噪音。
 *
 * ## 四种状态各自说清楚
 *
 * | 状态 | 买家看到 |
 * |---|---|
 * | `pending` | 申请已提交,工作室会尽快处理 |
 * | `approved` | 工作室已同意,款项退回中 |
 * | `refunded` | **已退款**(+ 工作室实际退了多少) |
 * | `rejected` | 申请被拒绝(+ 工作室的备注) |
 *
 * ⚠️ **`approved` 和 `refunded` 是两回事** —— `approved` 是「工作室同意了,
 * 正在调平台退款 API」,钱**可能还在路上**。这时候摆「已退款」是骗人。
 *
 * ## 面板自己带 `AtelierPanel`
 *
 * 跟物流面板一个路子 —— 组件自带外壳,调用方只管把它摆进页面。
 */

import { Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import {
  AtelierPanel,
  AtelierSectionTitle,
} from "@/features/shared/components/atelier-page";
import type { RefundStatus, RefundView } from "@/features/refund/lib/types";
import { formatCents } from "@/lib/money";

/** 状态徽章的配色 —— 中性 / 处理中 / 已退 / 被拒 */
const STATUS_CHIP: Record<RefundStatus, string> = {
  pending: "text-foreground ring-border",
  approved: "text-amber-700 ring-amber-600/30",
  refunded: "text-emerald-700 ring-emerald-600/30",
  rejected: "text-destructive ring-destructive/30",
};

export function RefundStatusPanel({
  refund,
}: {
  /** 当前这一单**最新**的退款申请 —— 没有就传 null */
  refund: RefundView | null;
}) {
  const t = useTranslations("Refund");
  const format = useFormatter();

  if (!refund) {
    return null;
  }

  return (
    <AtelierPanel>
      <AtelierSectionTitle icon={Undo2}>{t("statusTitle")}</AtelierSectionTitle>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
            STATUS_CHIP[refund.status]
          }`}
        >
          {t(`status.${refund.status}`)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("appliedAt")}:{" "}
          {format.dateTime(new Date(refund.createdAt), {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] text-muted-foreground">
            {t("amountLabel")}
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {formatCents(refund.amountCents)}
          </dd>
        </div>
        {refund.refundedCents !== null ? (
          <div>
            <dt className="text-[11px] text-muted-foreground">
              {t("refundedAmountLabel")}
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {formatCents(refund.refundedCents)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[11px] text-muted-foreground">
            {t("channelLabel")}
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {refund.paymentChannel || "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] text-muted-foreground">
            {t("reasonLabel")}
          </dt>
          <dd className="mt-1 text-sm whitespace-pre-line text-foreground">
            {refund.reason}
          </dd>
        </div>
        {refund.note ? (
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-muted-foreground">
              {t("noteLabel")}
            </dt>
            <dd className="mt-1 text-sm whitespace-pre-line text-foreground">
              {refund.note}
            </dd>
          </div>
        ) : null}
        {refund.refundError ? (
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-muted-foreground">
              {t("errorLabel")}
            </dt>
            <dd className="mt-1 text-sm whitespace-pre-line text-destructive">
              {refund.refundError}
            </dd>
          </div>
        ) : null}
      </dl>
    </AtelierPanel>
  );
}
