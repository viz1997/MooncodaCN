"use client";

/**
 * 后台退款管理 —— 展开一行的内容(2026-11-14)
 *
 * ## 一律就地展开,不开弹窗
 *
 * 工作室的口味(跟发货台 / 优惠码后台 / 打印定价后台一个路子):配置界面在页面
 * 上直接处理,不要弹窗挡住别的内容 —— 弹窗一开,工作室就看不见这一行还缺什么。
 *
 * ## 四颗按钮,四种意思
 *
 * | 按钮 | 动钱吗 | 干什么 |
 * |---|---|---|
 * | 同意退款 | ❌ | `pending → approved`,工作室受理了,钱还没退 |
 * | **执行退款** | ✅ | **调平台退款 API**(工作室拍板的那一步) |
 * | 标记已退款 | ❌ | 工作室在商家后台**手工**退完钱之后回来记账 |
 * | 拒绝申请 | ❌ | `→ rejected`,**必须写备注** |
 *
 * ## 动钱的那颗按钮上**看得见数**
 *
 * 「执行退款 ¥249」—— 金额印在按钮上。点之前工作室就知道要退多少,不用回头
 * 去对一眼那个输入框。
 *
 * ## 金额输入框收「元」
 *
 * 工作室看的是钱。让人填「24900 分」等于让人自己心算换算,填错一个数量级就是
 * 退错钱。**提交时换算成整数分**(`yuanToCents`),服务端和 DB 的口径没动。
 *
 * ## 「执行退款」不会重复退两次钱
 *
 * 幂等键 = **退款申请行的 id**(不是新生成的号)⇒ 平台那边同一个号只会退一次。
 * 界面这一层不需要额外防重复点,点两次也是退一次。
 */

import { App, Button, Form, Input, InputNumber, Tag } from "antd";
import { CheckCircle2, CreditCard, Undo2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo } from "react";

import {
  adminApproveRefundAction,
  adminExecuteRefundAction,
  adminMarkRefundedAction,
  adminRejectRefundAction,
} from "@/features/refund/admin/actions";
import type { AdminRefundRow } from "@/features/refund/admin/types";
import { refundChannelLabel } from "@/features/refund/admin/channel-label";
import { refundErrorTextKey } from "@/features/refund/lib/error-text";
import {
  allowedNextRefundStatuses,
  isTerminalRefundStatus,
} from "@/features/refund/lib/transitions";
import { formatCents } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 退款表单的值 —— 金额是**元**
 *
 * 字段名带 `Yuan` 就是单位的名字 —— 仓库里踩过「差 100 倍」的坑,名字带单位
 * 是最省事的防呆。
 */
type RefundFormValues = {
  /** 元 */
  refundAmountYuan: number | null;
  /** 处理备注 —— 拒绝时必填 */
  note?: string;
};

/* -------------------------------------------------------------------------- */
/*  小工具                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 元 → 分(提交给服务端的值)
 *
 * 服务端口径是**整数分**。`+ Number.EPSILON` 挡浮点误差:1.005 × 100 在
 * IEEE754 下是 100.49999999999999,直接 round 会掉到 100。
 */
function yuanToCents(value: number | null | undefined): number {
  return Math.round(((value ?? 0) + Number.EPSILON) * 100);
}

/** 分 → 元(填进表单的值) */
function centsToYuan(cents: number): number {
  return cents / 100;
}

/* -------------------------------------------------------------------------- */
/*  组件                                                                        */
/* -------------------------------------------------------------------------- */

export function RefundExpandPanel(props: {
  row: AdminRefundRow;
  /** 写完通知外层刷新列表 */
  onChanged: () => void;
}) {
  const { row, onChanged } = props;
  const t = useTranslations("AdminRefund");
  const tRefund = useTranslations("Refund");
  const { message } = App.useApp();

  const [form] = Form.useForm<RefundFormValues>();

  /** 表单里当前填的金额(元)—— 按钮上的金额跟着它走 */
  const watchedAmountYuan = Form.useWatch("refundAmountYuan", form) as
    | number
    | null
    | undefined;
  const watchedNote = Form.useWatch("note", form) as string | undefined;

  /** 这一条现在允许去哪些状态 —— 状态机的唯一来源 */
  const nextStatuses = useMemo(
    () => allowedNextRefundStatuses(row.status),
    [row.status]
  );
  const canApprove = nextStatuses.includes("approved");
  const canRefund = nextStatuses.includes("refunded");
  const canReject = nextStatuses.includes("rejected");
  /** 终态(已退款 / 已拒绝)—— 什么都不给做 */
  const isTerminal = isTerminalRefundStatus(row.status);

  /** 要退多少(分)—— 没填就用申请的金额 */
  const refundCents = useMemo(() => {
    if (watchedAmountYuan === null || watchedAmountYuan === undefined) {
      return row.amountCents;
    }
    return yuanToCents(watchedAmountYuan);
  }, [row.amountCents, watchedAmountYuan]);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: approve, isPending: isApproving } = useAction(
    adminApproveRefundAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(tRefund(refundErrorTextKey(data.code)));
          return;
        }
        message.success(t("messages.approved"));
        onChanged();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: executeRefund, isPending: isExecuting } = useAction(
    adminExecuteRefundAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(tRefund(refundErrorTextKey(data.code)));
          if (data.detail) {
            message.warning(data.detail);
          }
          return;
        }
        if (data.providerStatus === "processing") {
          // 钱还在路上 —— 别让工作室以为退完了
          message.info(t("messages.processing"));
        } else {
          message.success(t("messages.executed"));
        }
        onChanged();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: markRefunded, isPending: isMarking } = useAction(
    adminMarkRefundedAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(tRefund(refundErrorTextKey(data.code)));
          return;
        }
        message.success(t("messages.markedRefunded"));
        onChanged();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: reject, isPending: isRejecting } = useAction(
    adminRejectRefundAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(tRefund(refundErrorTextKey(data.code)));
          return;
        }
        message.success(t("messages.rejected"));
        onChanged();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  /* ------------------------------------------------------------ 表单动作 -- */

  const readNote = useCallback((): string => {
    const value = form.getFieldValue("note");
    return typeof value === "string" ? value.trim() : "";
  }, [form]);

  const submitApprove = useCallback(() => {
    approve({
      refundId: row.id,
      note: readNote() || null,
    });
  }, [approve, readNote, row.id]);

  const submitExecute = useCallback(() => {
    executeRefund({
      refundId: row.id,
      refundCents,
      note: readNote() || null,
    });
  }, [executeRefund, readNote, refundCents, row.id]);

  const submitMarkRefunded = useCallback(() => {
    markRefunded({
      refundId: row.id,
      refundedCents: refundCents,
      note: readNote() || null,
    });
  }, [markRefunded, readNote, refundCents, row.id]);

  const submitReject = useCallback(() => {
    const note = readNote();
    if (!note) return; // 服务端也会拒 —— 这里先拦一道
    reject({
      refundId: row.id,
      note,
    });
  }, [readNote, reject, row.id]);

  /* ------------------------------------------------------------ 派生数据 -- */

  /** 收款通道的显示名 —— 认不出来的原样摆出来,不猜 */
  const channelLabel = useMemo(
    () => refundChannelLabel(t, row.paymentChannel),
    [row.paymentChannel, t]
  );

  /** 订单状态的显示文案 —— 商城和工单的枚举不一样,各查各的 */
  const orderStatusLabel = useMemo(
    () =>
      row.orderKind === "storefront"
        ? t(`orderStatus.storefront.${row.orderStatus}`)
        : t(`orderStatus.print.${row.orderStatus}`),
    [row.orderKind, row.orderStatus, t]
  );

  const paymentStatusLabel = useMemo(
    () => t(`payment.${row.paymentStatus}`),
    [row.paymentStatus, t]
  );

  /* ------------------------------------------------------------ 渲染 ------ */

  return (
    <div className="space-y-4">
      {/* 订单摘要 */}
      <section className="rounded-md border bg-muted/30 p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <CreditCard className="h-3.5 w-3.5" />
          {t("summary.title")}
        </h4>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-3">
          <SummaryItem label={t("summary.kind")}>
            {t(`table.kind.${row.orderKind}`)}
          </SummaryItem>
          <SummaryItem label={t("summary.orderNo")}>
            <span className="font-mono">{row.orderNo}</span>
          </SummaryItem>
          <SummaryItem label={t("summary.buyer")}>{row.buyerLabel}</SummaryItem>
          <SummaryItem label={t("summary.item")}>{row.summary}</SummaryItem>
          <SummaryItem label={t("summary.channel")}>
            {channelLabel}
          </SummaryItem>
          <SummaryItem label={t("summary.amount")}>
            <span className="font-mono">{formatCents(row.amountCents)}</span>
          </SummaryItem>
          <SummaryItem label={t("summary.orderStatus")}>
            {orderStatusLabel}
          </SummaryItem>
          <SummaryItem label={t("summary.paymentStatus")}>
            {paymentStatusLabel}
          </SummaryItem>
          <SummaryItem label={t("summary.appliedAt")}>
            {new Date(row.createdAt).toLocaleString("zh-CN")}
          </SummaryItem>
          {row.providerRefundId ? (
            <SummaryItem label={t("summary.providerRefundId")}>
              <span className="font-mono">{row.providerRefundId}</span>
            </SummaryItem>
          ) : null}
          {row.providerRefundStatus ? (
            <SummaryItem label={t("summary.providerRefundStatus")}>
              <Tag bordered={false}>{row.providerRefundStatus}</Tag>
            </SummaryItem>
          ) : null}
          {row.refundedCents !== null ? (
            <SummaryItem label={t("summary.refundedAmount")}>
              <span className="font-mono">
                {formatCents(row.refundedCents)}
              </span>
            </SummaryItem>
          ) : null}
        </dl>

        <p className="mt-2 text-xs leading-relaxed">
          <span className="text-muted-foreground">
            {t("summary.reason")}:{" "}
          </span>
          {row.reason}
        </p>
        {row.refundError ? (
          <p className="mt-1 text-xs leading-relaxed text-destructive">
            <span className="text-muted-foreground">
              {t("summary.refundError")}:{" "}
            </span>
            {row.refundError}
          </p>
        ) : null}
        {row.note ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("summary.note")}: {row.note}
          </p>
        ) : null}
      </section>

      {/* 表单 */}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          refundAmountYuan: centsToYuan(row.amountCents),
          note: row.note ?? "",
        }}
      >
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
          <Form.Item
            name="refundAmountYuan"
            label={t("form.refundAmount")}
            extra={t("form.refundAmountHint")}
          >
            <InputNumber
              min={0.01}
              precision={2}
              step={1}
              className="w-full"
              addonBefore="¥"
            />
          </Form.Item>

          <Form.Item name="note" label={t("form.note")}>
            <Input.TextArea
              rows={2}
              placeholder={t("form.notePlaceholder")}
              maxLength={500}
            />
          </Form.Item>
        </div>

        {/* 按钮 —— 动钱的那两颗把金额印在按钮上 */}
        <div className="flex flex-wrap items-center gap-2">
          {canApprove ? (
            <Button
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              loading={isApproving}
              onClick={submitApprove}
            >
              {t("actions.approve")}
            </Button>
          ) : null}

          {!isTerminal ? (
            <Button
              type="primary"
              danger
              icon={<Undo2 className="h-3.5 w-3.5" />}
              loading={isExecuting}
              onClick={submitExecute}
            >
              {t("actions.executeWithAmount", { amount: formatCents(refundCents) })}
            </Button>
          ) : null}

          {canRefund ? (
            <Button
              icon={<Undo2 className="h-3.5 w-3.5" />}
              loading={isMarking}
              onClick={submitMarkRefunded}
            >
              {t("actions.markRefundedWithAmount", {
                amount: formatCents(refundCents),
              })}
            </Button>
          ) : null}

          {canReject ? (
            <Button
              danger
              type="text"
              icon={<XCircle className="h-3.5 w-3.5" />}
              loading={isRejecting}
              disabled={!watchedNote || watchedNote.trim().length === 0}
              onClick={submitReject}
            >
              {t("actions.reject")}
            </Button>
          ) : null}

          {isTerminal ? (
            <span className="text-[11px] text-muted-foreground">
              {t("actions.terminal")}
            </span>
          ) : null}

          {canReject && (!watchedNote || watchedNote.trim().length === 0) ? (
            <span className="text-[11px] text-amber-600">
              {t("form.noteRequiredHint")}
            </span>
          ) : null}
        </div>
      </Form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  摘要里的一格                                                                */
/* -------------------------------------------------------------------------- */

function SummaryItem(props: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{props.label}</dt>
      <dd className="mt-0.5 truncate text-xs font-medium">{props.children}</dd>
    </div>
  );
}
