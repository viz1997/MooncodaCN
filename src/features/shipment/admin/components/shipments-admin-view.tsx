"use client";

/**
 * 后台发货台 —— `/admin/shipments`
 *
 * ## 一行 = 一个订单,不是一行一个包裹
 *
 * 商城订单和打印工单**摆在一张表里** —— 工作室一天几十单,拆成两个页面等于
 * 来回切。订单行里的物流列是**摘要**(「顺丰速运 SF1234 · 已发货」),要填单号
 * / 改状态得展开那一行。
 *
 * ## 一律就地展开,不开弹窗
 *
 * 工作室的口味(跟优惠码后台 / 打印定价后台一个路子)。展开区在表格行下面,
 * 不挡别的行 —— 弹窗一开,工作室就看不见这一行还缺什么。
 *
 * ## 「待发货」这个筛选是**一个包裹都没有**
 *
 * 不是「有包裹但状态不是已发货」—— 那是「已发货但还没签收」,归在「已发货」
 * 那一档。一单可以有多个包裹(补发 / 分开发),所以筛选的是「这单有没有
 * 包裹」和「有没有包裹处于某个状态」。
 *
 * ## 展开由**我们自己管**(不用 antd 的 `expandedRowKeys` 受控 + 默认图标)
 *
 * 表格行里的那颗「发货 / 物流」按钮直接控制展开 —— 用默认的折叠箭头 +
 * 受控 `expandedRowKeys`,避免「按钮点一下、箭头再点一下」两套入口。
 */

import { Button, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RotateCcw, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { adminListShipmentRowsAction } from "@/features/shipment/admin/actions";
import { ShipmentExpandPanel } from "@/features/shipment/admin/components/shipment-expand-panel";
import type {
  AdminShipmentFilter,
  AdminShipmentRow,
} from "@/features/shipment/admin/types";
import { resolveShipmentCarrierLabel } from "@/features/shipment/lib/carriers";
import { shipmentStatusLabelKey } from "@/features/shipment/lib/transitions";
import { formatCents } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/*  筛选                                                                       */
/* -------------------------------------------------------------------------- */

/** 筛选值 —— `pending` 是「一个包裹都没有」,其余是「至少有一个包裹在那个状态」 */
type FilterValue = AdminShipmentFilter | "all";

/** 一行的唯一键 —— 两张订单表的 id 不通用,得带上「哪种订单」 */
function rowKeyOf(row: AdminShipmentRow): string {
  return `${row.orderKind}:${row.orderId}`;
}

/* -------------------------------------------------------------------------- */
/*  主组件                                                                     */
/* -------------------------------------------------------------------------- */

export function ShipmentsAdminView() {
  const t = useTranslations("AdminShipment");
  const tShipment = useTranslations("Shipment");

  const [rows, setRows] = useState<AdminShipmentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  /** 展开着的行 */
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminListShipmentRowsAction({
        status: filter === "all" ? null : filter,
      });
      if (res?.data?.ok) {
        setRows(res.data.rows);
        setLoadError(null);
        return;
      }
      if (res?.data && !res.data.ok) {
        // 表还没建(迁移脚本没跑)—— 说人话,不是 500
        setLoadError(t(`errors.${res.data.code}`));
        setRows(null);
        return;
      }
      setLoadError(t("messages.loadFailed"));
    } catch {
      setLoadError(t("messages.loadFailed"));
    }
  }, [filter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------------ 展开动作 -- */

  const toggleRow = useCallback((key: string) => {
    setExpandedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  /* ------------------------------------------------------------ 派生数据 -- */

  const filterOptions = useMemo(
    () => [
      { value: "all", label: t("filter.all") },
      { value: "pending", label: t("filter.pending") },
      { value: "shipped", label: t("filter.shipped") },
      { value: "delivered", label: t("filter.delivered") },
      { value: "returned", label: t("filter.returned") },
    ],
    [t]
  );

  /** 订单状态的显示文案 —— 商城和工单的枚举不一样,各查各的 */
  const orderStatusText = useCallback(
    (row: AdminShipmentRow): string =>
      row.orderKind === "storefront"
        ? t(`orderStatus.storefront.${row.orderStatus}`)
        : t(`orderStatus.print.${row.orderStatus}`),
    [t]
  );

  /** 收款状态 —— 未收款要标一条提示(别给未付款的单发货) */
  const paymentStatusText = useCallback(
    (row: AdminShipmentRow): string => t(`payment.${row.paymentStatus}`),
    [t]
  );

  /** 物流摘要 —— 「顺丰速运 SF1234 · 已发货」 */
  const shipmentSummary = useCallback(
    (row: AdminShipmentRow): string => {
      const first = row.shipments[0];
      if (!first) {
        return t("shipment.none");
      }
      const carrier = resolveShipmentCarrierLabel({
        code: first.shippingCompany,
        customLabel: first.shippingCompanyLabel,
        translate: tShipment,
      });
      const head = `${carrier} ${first.trackingNumber}`;
      const status = tShipment(shipmentStatusLabelKey(first.status));
      if (row.shipments.length === 1) {
        return `${head} · ${status}`;
      }
      return `${head} · ${status} (+${row.shipments.length - 1})`;
    },
    [t, tShipment]
  );

  const columns: ColumnsType<AdminShipmentRow> = useMemo(
    () => [
      {
        title: t("table.kindLabel"),
        dataIndex: "orderKind",
        key: "orderKind",
        width: 80,
        render: (kind: AdminShipmentRow["orderKind"]) => (
          <Tag color={kind === "storefront" ? "blue" : "purple"}>
            {t(`table.kind.${kind}`)}
          </Tag>
        ),
      },
      {
        title: t("table.orderNo"),
        dataIndex: "orderNo",
        key: "orderNo",
        width: 170,
        render: (orderNo: string, row) => (
          <div>
            <p className="font-mono text-xs font-medium">{orderNo}</p>
            <p className="text-[11px] text-muted-foreground">
              {new Date(row.createdAt).toLocaleDateString("zh-CN")}
            </p>
          </div>
        ),
      },
      {
        title: t("table.recipient"),
        key: "recipient",
        width: 140,
        render: (_, row) => (
          <div>
            <p className="text-xs font-medium">{row.recipientName}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {row.recipientPhone}
            </p>
          </div>
        ),
      },
      {
        title: t("table.address"),
        dataIndex: "addressLine",
        key: "addressLine",
        render: (addressLine: string) => (
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            {addressLine}
          </span>
        ),
      },
      {
        title: t("table.summary"),
        dataIndex: "summary",
        key: "summary",
        width: 150,
        render: (summary: string) => (
          <span className="line-clamp-2 text-[11px] text-muted-foreground">
            {summary}
          </span>
        ),
      },
      {
        title: t("table.amount"),
        dataIndex: "totalCents",
        key: "totalCents",
        width: 100,
        render: (totalCents: number) => (
          <span className="font-mono text-xs">{formatCents(totalCents)}</span>
        ),
      },
      {
        title: t("table.payment"),
        dataIndex: "paymentStatus",
        key: "paymentStatus",
        width: 110,
        render: (_, row) => (
          <div className="space-y-1">
            <Tag
              bordered={false}
              color={
                row.paymentStatus === "paid"
                  ? "green"
                  : row.paymentStatus === "refunded"
                    ? "orange"
                    : "default"
              }
            >
              {paymentStatusText(row)}
            </Tag>
            <p className="text-[11px] text-muted-foreground">
              {orderStatusText(row)}
            </p>
          </div>
        ),
      },
      {
        title: t("table.shipment"),
        key: "shipment",
        width: 190,
        render: (_, row) => (
          <span className="text-[11px] leading-relaxed">
            {shipmentSummary(row)}
          </span>
        ),
      },
      {
        title: t("table.actions"),
        key: "actions",
        width: 90,
        render: (_, row) => {
          const key = rowKeyOf(row);
          const expanded = expandedKeys.includes(key);
          return (
            <Button
              size="small"
              type={expanded ? "default" : "primary"}
              onClick={() => toggleRow(key)}
            >
              {expanded
                ? t("actions.close")
                : row.shipments.length > 0
                  ? t("actions.manage")
                  : t("actions.ship")}
            </Button>
          );
        },
      },
    ],
    [
      expandedKeys,
      orderStatusText,
      paymentStatusText,
      shipmentSummary,
      t,
      toggleRow,
    ]
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
          <Truck className="h-5 w-5 text-sky-600" />
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 筛选 —— 就地筛选,不开弹窗 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">
            {t("filter.label")}
          </span>
          <Select<FilterValue>
            value={filter}
            options={filterOptions}
            onChange={setFilter}
            className="w-40"
          />
          <span className="text-[11px] text-muted-foreground">
            {t("messages.count", { count: rows.length })}
          </span>
        </div>
      </section>

      {/* 列表 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <Table<AdminShipmentRow>
          size="small"
          rowKey={rowKeyOf}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1180 }}
          locale={{ emptyText: t("messages.empty") }}
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) =>
              setExpandedKeys(keys.map((k) => String(k))),
            expandedRowRender: (row) => (
              <ShipmentExpandPanel row={row} onChanged={() => void load()} />
            ),
          }}
        />
      </section>
    </div>
  );
}
