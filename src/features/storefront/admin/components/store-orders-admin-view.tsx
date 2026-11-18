"use client";

/**
 * 商城订单后台 —— `/admin/store-orders`
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 淘宝,在淘宝付款(享受平台担保)。钱进的是**淘宝那个账户**,不在本仓库的收钱
 * 链路里 ⇒ 工作室在淘宝后台看到钱到了,回这一页把那笔单**手工标成已收款**。
 *
 * ## 这一页只干一件事
 *
 * **把「淘宝上那笔钱」和「本站这一单」对上** —— 填淘宝订单号 + 填淘宝那边的
 * 实收金额,然后把本站这一单推成「已支付」。
 *
 * ## 为什么这一页是**新开**的
 *
 * 仓库里**没有**商城订单的后台页 —— `/admin/orders` 是 gpt-image 的生图订单
 * (`promptOrder` 表),跟商城订单(`storefront_order` 表)是两套数据。商城订单
 * 以前只出现在退款页和发货台里,工作室要「手工标已收款」没有地方下手。
 *
 * ## 就地展开,不开弹窗
 *
 * 工作室的口味(跟优惠码后台 / 发货台 / 淘宝链接后台一个路子):配置界面在页面
 * 上直接处理,不要弹窗挡住别的内容 —— 弹窗一开,工作室就看不见这一行还缺什么。
 *
 * ## ⚠️ 金额是**参考价**
 *
 * 本站这一单算出来的 `totalCents` 对淘宝那一路**只是参考** —— 淘宝那边有它
 * 自己的运费模板和优惠券,实收可能不一样。所以:
 *
 * - **淘宝那一档**允许实收跟本站应付对不上(差额摆在界面上,给工作室对账用)
 * - **线下转账那一档**必须一分不差(那笔钱确实是收的这个数)—— 服务端会拒
 */

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { BadgeCheck, RotateCcw, ShoppingCart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminListStoreOrdersAction,
  adminMarkStoreOrderPaidAction,
} from "@/features/storefront/admin/actions";
import {
  type AdminStoreOrderMarkChannel,
  type AdminStoreOrderRow,
  externalPaidDifferenceCents,
  STORE_ORDER_CHANNEL_TEXT_KEYS,
  STORE_ORDER_ERROR_TEXT_KEYS,
} from "@/features/storefront/admin/types";
import { formatCents } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

/** 一行展开区里的表单值 */
type MarkPaidValues = {
  /** 走哪条路收的钱 */
  channel: AdminStoreOrderMarkChannel;
  /** 平台侧单号(淘宝订单号) */
  externalOrderNo?: string;
  /**
   * 实收金额(**元**)
   *
   * ⚠️ **界面收元、线上传分** —— 见 `yuanToCents()`。字段名带 `Yuan` 后缀
   * 就是为了让「这一栏是元」在代码里一眼看得见(单位搞混就是差 100 倍)。
   */
  paidYuan?: number | null;
};

/**
 * 元 → 分
 *
 * `Number.EPSILON` 那一下是**浮点补偿** —— `19.99 * 100` 在 IEEE754 下是
 * `1998.9999999999998` ⇒ 不补偿就少收一分。
 */
function yuanToCents(yuan: number | null | undefined): number | undefined {
  if (yuan === null || yuan === undefined) return undefined;
  return Math.round((yuan + Number.EPSILON) * 100);
}

/** 分 → 元(填表单用) */
function centsToYuan(cents: number | null): number | undefined {
  if (cents === null) return undefined;
  return cents / 100;
}

/* -------------------------------------------------------------------------- */
/*  主组件                                                                      */
/* -------------------------------------------------------------------------- */

export function StoreOrdersAdminView() {
  const t = useTranslations("AdminStoreOrders");
  const tOrder = useTranslations("StorefrontOrder");
  const locale = useLocale();
  // ⚠️ **这一层不用 `message`** —— 提示都在展开面板那个子组件里发(它自己
  // 有一份 `App.useApp()`)。这里只管列表。

  const [rows, setRows] = useState<AdminStoreOrderRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 展开着的那一行(订单号)—— null = 都没展开 */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminListStoreOrdersAction();
      const data = res?.data;
      if (data?.ok === true) {
        setRows(data.rows);
        setLoadError(null);
        return;
      }
      if (data?.ok === false) {
        setLoadError(t(STORE_ORDER_ERROR_TEXT_KEYS[data.code]));
        return;
      }
    } catch {
      setLoadError(t("messages.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------------ 派生数据 -- */

  /** 还欠着「已收款」的笔数 —— 页头那句话用 */
  const pendingCount = useMemo(
    () =>
      (rows ?? []).filter(
        (row) => row.paymentStatus === "unpaid" && row.status !== "cancelled"
      ).length,
    [rows]
  );

  const columns: ColumnsType<AdminStoreOrderRow> = useMemo(
    () => [
      {
        title: t("table.order"),
        key: "order",
        render: (_, row) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-medium">
              {row.orderNo}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {new Date(row.createdAt).toLocaleString(locale)}
            </p>
          </div>
        ),
      },
      {
        title: t("table.buyer"),
        key: "buyer",
        render: (_, row) => (
          <div className="min-w-0">
            <p className="truncate text-xs">{row.buyerName ?? "—"}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {row.buyerEmail ?? "—"}
            </p>
          </div>
        ),
      },
      {
        title: t("table.items"),
        key: "items",
        render: (_, row) => (
          <div className="min-w-0">
            <p className="truncate text-xs">{row.itemSummary || "—"}</p>
            <p className="text-[11px] text-muted-foreground">
              {t("table.itemCount", { count: row.itemCount })}
            </p>
          </div>
        ),
      },
      {
        title: t("table.amount"),
        key: "amount",
        render: (_, row) => (
          <div className="min-w-0">
            <p className="text-xs font-medium">
              {formatCents(row.totalCents, { locale })}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t("table.shipping", {
                amount: formatCents(row.shippingCents, { locale }),
              })}
            </p>
          </div>
        ),
      },
      {
        title: t("table.payment"),
        key: "payment",
        width: 150,
        render: (_, row) => (
          <div className="space-y-1">
            <Tag
              color={
                row.paymentStatus === "paid"
                  ? "green"
                  : row.paymentStatus === "refunded"
                    ? "red"
                    : row.paymentStatus === "failed"
                      ? "orange"
                      : "default"
              }
              bordered={false}
            >
              {tOrder(`paymentStatus.${row.paymentStatus}`)}
            </Tag>
            <p className="text-[11px] text-muted-foreground">
              {row.paymentChannel
                ? t(STORE_ORDER_CHANNEL_TEXT_KEYS[row.paymentChannel])
                : "—"}
            </p>
          </div>
        ),
      },
      {
        title: t("table.external"),
        key: "external",
        width: 190,
        render: (_, row) => {
          const difference = externalPaidDifferenceCents(row);
          return (
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px]">
                {row.providerOrderId ?? "—"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {row.externalPaidCents === null
                  ? t("table.externalEmpty")
                  : t("table.externalPaid", {
                      amount: formatCents(row.externalPaidCents, { locale }),
                    })}
              </p>
              {difference !== null && difference !== 0 ? (
                <p className="text-[11px] text-amber-700">
                  {t("table.externalDiff", {
                    amount: formatCents(Math.abs(difference), { locale }),
                  })}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        title: t("table.actions"),
        key: "actions",
        width: 130,
        render: (_, row) => (
          <Button
            size="small"
            type="text"
            icon={<BadgeCheck className="h-3.5 w-3.5" />}
            disabled={!row.canMarkPaid}
            onClick={() =>
              setExpandedKey((current) =>
                current === row.orderNo ? null : row.orderNo
              )
            }
          >
            {row.paymentStatus === "paid"
              ? t("actions.edit")
              : t("actions.markPaid")}
          </Button>
        ),
      },
    ],
    // ⚠️ **`expandedKey` 不在依赖里** —— 展开状态由 antd 的 `expandedRowKeys`
    // 管,这一列只负责「点一下把哪一行展开」(用的是稳定的 `setExpandedKey`)。
    [locale, t, tOrder]
  );

  /* ------------------------------------------------------------ 渲染 ------ */

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        {loadError}
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <RotateCcw className="h-4 w-4 animate-spin" />
        {t("messages.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingCart className="h-5 w-5 text-orange-600" />
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 淘宝那一路的钱怎么走 —— 摆在前头 */}
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <h3 className="mb-1 text-sm font-semibold text-amber-800">
          {t("notice.title")}
        </h3>
        <p className="text-xs leading-relaxed text-amber-800/90">
          {t("notice.detail")}
        </p>
      </section>

      {/* 列表 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("list.title")}</h3>
          <p className="text-[11px] text-muted-foreground">
            {t("list.summary", { count: pendingCount, total: rows.length })}
          </p>
        </div>

        <Table<AdminStoreOrderRow>
          size="small"
          rowKey="orderNo"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: t("messages.empty") }}
          expandable={{
            expandedRowKeys: expandedKey ? [expandedKey] : [],
            onExpand: (expanded) => {
              setExpandedKey(expanded ? String(expanded) : null);
            },
            expandedRowRender: (row) => (
              <StoreOrderMarkPaidPanel
                key={row.orderNo}
                row={row}
                onSaved={() => {
                  setExpandedKey(null);
                  void load();
                }}
                onCancel={() => setExpandedKey(null)}
              />
            ),
          }}
        />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  一行的「标记已收款」表单(展开区里)                                          */
/* -------------------------------------------------------------------------- */

function StoreOrderMarkPaidPanel(props: {
  row: AdminStoreOrderRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { row, onSaved, onCancel } = props;
  const t = useTranslations("AdminStoreOrders");
  const locale = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<MarkPaidValues>();

  /**
   * 这一单走的是哪条路收的钱
   *
   * 默认按订单上**已经记着的**通道来 —— 工作室看到一单淘宝单,点开就该是
   * 「淘宝」那一档,不用自己再选一遍。
   */
  const defaultChannel: AdminStoreOrderMarkChannel =
    row.paymentChannel === "taobao" ? "taobao" : "offline";

  /** 表单里选的通道 —— 决定要不要摆「淘宝订单号」那一栏 */
  const watchedChannel = Form.useWatch("channel", form) as
    | AdminStoreOrderMarkChannel
    | undefined;

  const { execute: markPaid, isPending } = useAction(
    adminMarkStoreOrderPaidAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(STORE_ORDER_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(
          data.changed ? t("messages.markPaidSuccess") : t("messages.updated")
        );
        onSaved();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  const submit = useCallback(async () => {
    let values: MarkPaidValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }

    const channel = values.channel ?? defaultChannel;
    markPaid({
      orderNo: row.orderNo,
      channel,
      externalOrderNo: values.externalOrderNo?.trim() || null,
      // ⚠️ **元 → 分** —— 界面收元,线上传分
      paidCents: yuanToCents(values.paidYuan),
    });
  }, [defaultChannel, form, markPaid, row.orderNo]);

  return (
    <div className="space-y-3">
      {/* 这一单现在的样子 —— 工作室得先看清楚「这一单是多少钱」 */}
      <div className="grid gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-muted-foreground">{t("form.orderNo")}</p>
          <p className="font-mono font-medium">{row.orderNo}</p>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-muted-foreground">{t("form.siteTotal")}</p>
          <p className="font-medium">
            {formatCents(row.totalCents, { locale })}
          </p>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-muted-foreground">{t("form.externalPaid")}</p>
          <p className="font-medium">
            {row.externalPaidCents === null
              ? "—"
              : formatCents(row.externalPaidCents, { locale })}
          </p>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-muted-foreground">{t("form.buyer")}</p>
          <p className="truncate font-medium">
            {row.buyerEmail ?? row.buyerName ?? "—"}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("form.hint")}</p>

      <Form<MarkPaidValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          channel: defaultChannel,
          externalOrderNo: row.providerOrderId ?? "",
          paidYuan: centsToYuan(row.externalPaidCents),
        }}
        className="max-w-3xl"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Form.Item
            name="channel"
            label={t("form.channel")}
            rules={[{ required: true, message: t("form.channelRequired") }]}
          >
            <Select
              options={[
                { value: "taobao", label: t("channels.taobao") },
                { value: "offline", label: t("channels.offline") },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="externalOrderNo"
            label={t("form.externalOrderNo")}
            extra={t("form.externalOrderNoHint")}
            rules={
              watchedChannel === "taobao"
                ? [
                    {
                      required: true,
                      message: t("form.externalOrderNoRequired"),
                    },
                  ]
                : []
            }
          >
            <Input placeholder={t("form.externalOrderNoPlaceholder")} />
          </Form.Item>

          <Form.Item
            name="paidYuan"
            label={t("form.paidAmount")}
            extra={
              watchedChannel === "taobao"
                ? t("form.paidAmountHintTaobao")
                : t("form.paidAmountHintOffline")
            }
          >
            <InputNumber
              min={0}
              precision={2}
              step={0.01}
              className="w-full"
              placeholder={t("form.paidAmountPlaceholder")}
            />
          </Form.Item>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <Button type="primary" loading={isPending} onClick={submit}>
            {isPending ? t("form.saving") : t("form.save")}
          </Button>
          <Button onClick={onCancel}>{t("form.cancel")}</Button>
        </div>
      </Form>
    </div>
  );
}
