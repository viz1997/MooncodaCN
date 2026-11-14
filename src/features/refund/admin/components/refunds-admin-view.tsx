"use client";

/**
 * 后台退款管理 —— `/admin/refunds`
 *
 * ## 一行 = 一条**退款申请**,不是一行一个订单
 *
 * 商城订单和打印工单**摆在一张表里** —— 工作室一天几十单,拆成两个页面等于
 * 来回切。订单行只是**摘要**(「钥匙扣 ×2 · ¥249」),要处理得展开那一行。
 *
 * ## 一律就地展开,不开弹窗
 *
 * 工作室的口味(跟发货台 / 优惠码后台 / 打印定价后台一个路子)。展开区在表格行
 * 下面,不挡别的行 —— 弹窗一开,工作室就看不见这一行还缺什么。
 *
 * ## 展开由**我们自己管**(不用 antd 的 `expandedRowKeys` 受控 + 默认图标)
 *
 * 表格行里那颗按钮直接控制展开 —— 用默认的折叠箭头 + 受控
 * `expandedRowKeys`,避免「按钮点一下、箭头再点一下」两套入口。
 *
 * ## 错误文案查的是 `Refund.errors.*`,不是本地的表
 *
 * 买家侧和后台返回的是**同一批 code** ⇒ **一张表**。后台另开 `AdminRefund`
 * 命名空间只放后台那一层的外壳(标题 / 按钮 / 列名)。
 */

import { Button, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { adminListRefundRequestsAction } from "@/features/refund/admin/actions";
import { refundChannelLabel } from "@/features/refund/admin/channel-label";
import { RefundExpandPanel } from "@/features/refund/admin/components/refund-expand-panel";
import type {
  AdminRefundFilter,
  AdminRefundRow,
} from "@/features/refund/admin/types";
import { refundErrorTextKey } from "@/features/refund/lib/error-text";
import { refundStatusLabelKey } from "@/features/refund/lib/transitions";
import { formatCents } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/*  筛选                                                                       */
/* -------------------------------------------------------------------------- */

/** 一行的唯一键 —— 退款申请行的 id(幂等键就是它) */
function rowKeyOf(row: AdminRefundRow): string {
  return row.id;
}

/* -------------------------------------------------------------------------- */
/*  主组件                                                                     */
/* -------------------------------------------------------------------------- */

export function RefundsAdminView() {
  const t = useTranslations("AdminRefund");
  const tRefund = useTranslations("Refund");

  const [rows, setRows] = useState<AdminRefundRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminRefundFilter>("all");
  /** 展开着的行 */
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminListRefundRequestsAction({
        status: filter === "all" ? null : filter,
      });
      if (res?.data?.ok) {
        setRows(res.data.rows);
        setLoadError(null);
        return;
      }
      if (res?.data && !res.data.ok) {
        // 表还没建(迁移脚本没跑)—— 说人话,不是 500
        setLoadError(tRefund(refundErrorTextKey(res.data.code)));
        setRows(null);
        return;
      }
      setLoadError(t("messages.loadFailed"));
    } catch {
      setLoadError(t("messages.loadFailed"));
    }
  }, [filter, t, tRefund]);

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
      { value: "approved", label: t("filter.approved") },
      { value: "refunded", label: t("filter.refunded") },
      { value: "rejected", label: t("filter.rejected") },
    ],
    [t]
  );

  /** 收款通道的显示名 —— 认不出来的原样摆出来,不猜 */
  const channelText = useCallback(
    (row: AdminRefundRow): string => refundChannelLabel(t, row.paymentChannel),
    [t]
  );

  /** 状态的显示文案 —— 跟买家侧共用同一批键(`Refund.status.*`) */
  const statusText = useCallback(
    (status: AdminRefundRow["status"]): string =>
      tRefund(refundStatusLabelKey(status)),
    [tRefund]
  );

  /** 状态的标签颜色 —— 待处理最扎眼 */
  const statusColor = useCallback(
    (status: AdminRefundRow["status"]): string => {
      switch (status) {
        case "pending":
          return "gold";
        case "approved":
          return "blue";
        case "refunded":
          return "green";
        default:
          return "default";
      }
    },
    []
  );

  const columns: ColumnsType<AdminRefundRow> = useMemo(
    () => [
      {
        title: t("table.kindLabel"),
        dataIndex: "orderKind",
        key: "orderKind",
        width: 80,
        render: (kind: AdminRefundRow["orderKind"]) => (
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
        render: (orderNo: string) => (
          <span className="font-mono text-xs font-medium">{orderNo}</span>
        ),
      },
      {
        title: t("table.buyer"),
        dataIndex: "buyerLabel",
        key: "buyerLabel",
        width: 150,
        render: (buyerLabel: string) => (
          <span className="line-clamp-2 text-[11px] text-muted-foreground">
            {buyerLabel}
          </span>
        ),
      },
      {
        title: t("table.amount"),
        dataIndex: "amountCents",
        key: "amountCents",
        width: 100,
        render: (amountCents: number) => (
          <span className="font-mono text-xs">{formatCents(amountCents)}</span>
        ),
      },
      {
        title: t("table.channel"),
        dataIndex: "paymentChannel",
        key: "paymentChannel",
        width: 90,
        render: (_: string | null, row: AdminRefundRow) => (
          <span className="text-[11px] text-muted-foreground">
            {channelText(row)}
          </span>
        ),
      },
      {
        title: t("table.reason"),
        dataIndex: "reason",
        key: "reason",
        render: (reason: string) => (
          <span className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {reason}
          </span>
        ),
      },
      {
        title: t("table.status"),
        dataIndex: "status",
        key: "status",
        width: 110,
        render: (status: AdminRefundRow["status"]) => (
          <Tag bordered={false} color={statusColor(status)}>
            {statusText(status)}
          </Tag>
        ),
      },
      {
        title: t("table.appliedAt"),
        dataIndex: "createdAt",
        key: "createdAt",
        width: 130,
        render: (createdAt: string) => (
          <span className="text-[11px] text-muted-foreground">
            {new Date(createdAt).toLocaleString("zh-CN")}
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
              {expanded ? t("actions.close") : t("actions.manage")}
            </Button>
          );
        },
      },
    ],
    [expandedKeys, channelText, statusColor, statusText, t, toggleRow]
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
          <Undo2 className="h-5 w-5 text-orange-600" />
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
          <Select<AdminRefundFilter>
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
        <Table<AdminRefundRow>
          size="small"
          rowKey={rowKeyOf}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1080 }}
          locale={{ emptyText: t("messages.empty") }}
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) =>
              setExpandedKeys(keys.map((k) => String(k))),
            expandedRowRender: (row) => (
              <RefundExpandPanel
                key={row.id}
                row={row}
                onChanged={() => void load()}
              />
            ),
          }}
        />
      </section>
    </div>
  );
}
