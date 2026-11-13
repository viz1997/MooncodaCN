"use client";

/**
 * 发货台 —— 展开一行的内容(2026-11-13)
 *
 * ## 一律就地展开,不开弹窗
 *
 * 工作室的口味(跟优惠码后台 / 打印定价后台一个路子):配置界面在页面上直接
 * 处理,不要弹窗挡住别的内容 —— 弹窗一开,工作室就看不见这一行还缺什么。
 *
 * ## 展开区里有三块
 *
 * 1. **已有包裹** —— 每个包裹一行(快递公司 + 单号 + 状态 + 时间 + 备注),
 *    后面跟一个「改状态」下拉;选了需要备注的目标就展开备注框
 * 2. **新包裹** —— 「发货」/「再加一个包裹」按钮展开发货表单
 * 3. **订单状态** —— 这一行的订单现在是什么状态(发货会把它往前推一格)
 *
 * ## 包裹序号由服务端算
 *
 * 表单里**没有**「第几个包裹」这个输入框 —— 客户端传了也会被忽略
 * (服务端在事务里算「现有最大 + 1」)。两个人同时点「发货」不会裂成两个
 * 1 号包裹。
 */

import { App, Button, Form, Input, Select, Tag } from "antd";
import { Package, Plus, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useState } from "react";

import {
  adminCreateShipmentAction,
  adminUpdateShipmentStatusAction,
} from "@/features/shipment/admin/actions";
import { SHIPMENT_ERROR_TEXT_KEYS } from "@/features/shipment/admin/types";
import {
  resolveShipmentCarrierLabel,
  SHIPMENT_CARRIERS,
} from "@/features/shipment/lib/carriers";
import {
  allowedNextShipmentStatuses,
  shipmentStatusLabelKey,
  shipmentTransitionRequiresNote,
} from "@/features/shipment/lib/transitions";
import type {
  AdminShipmentRow,
  ShipmentStatus,
  ShipmentView,
} from "@/features/shipment/lib/types";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

/** 发货表单的值 */
type CreateShipmentValues = {
  shippingCompany: string;
  /** 「其它」时自己填的公司名 */
  shippingCompanyLabel?: string;
  trackingNumber: string;
  note?: string;
};

/* -------------------------------------------------------------------------- */
/*  组件                                                                        */
/* -------------------------------------------------------------------------- */

export function ShipmentExpandPanel(props: {
  row: AdminShipmentRow;
  /** 写完通知外层刷新列表 */
  onChanged: () => void;
}) {
  const { row, onChanged } = props;
  const t = useTranslations("AdminShipment");
  const tShipment = useTranslations("Shipment");
  const { message } = App.useApp();

  /**
   * 发货表单展开着没有
   *
   * **一个包裹都没有时默认展开** —— 工作室点「发货」就是要填单号,再点一次
   * 「展开发货」是白绕一圈。已经发过货的单默认展开的是包裹列表(要先看现状)。
   */
  const [showCreate, setShowCreate] = useState(row.shipments.length === 0);
  const [createForm] = Form.useForm<CreateShipmentValues>();

  /** 正在改哪个包裹的状态 */
  const [target, setTarget] = useState<{
    shipmentId: string;
    toStatus: ShipmentStatus;
  } | null>(null);
  const [note, setNote] = useState("");

  /** 表单里选的快递公司 —— 决定要不要多摆一个「公司名」输入框 */
  const watchedCarrier = Form.useWatch("shippingCompany", createForm) as
    | string
    | undefined;

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: createShipment, isPending: isCreating } = useAction(
    adminCreateShipmentAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(SHIPMENT_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(t("messages.shipped"));
        setShowCreate(false);
        createForm.resetFields();
        onChanged();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: updateStatus, isPending: isUpdating } = useAction(
    adminUpdateShipmentStatusAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(SHIPMENT_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(t("messages.statusUpdated"));
        setTarget(null);
        setNote("");
        onChanged();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  /* ------------------------------------------------------------ 表单动作 -- */

  const submitCreate = useCallback(async () => {
    let values: CreateShipmentValues;
    try {
      values = await createForm.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }
    createShipment({
      orderKind: row.orderKind,
      orderId: row.orderId,
      orderNo: row.orderNo,
      shippingCompany: values.shippingCompany,
      shippingCompanyLabel: values.shippingCompanyLabel?.trim() || null,
      trackingNumber: values.trackingNumber.trim(),
      note: values.note?.trim() || null,
    });
  }, [createForm, createShipment, row]);

  const submitStatus = useCallback(() => {
    if (!target) return;
    const trimmed = note.trim();
    updateStatus({
      shipmentId: target.shipmentId,
      toStatus: target.toStatus,
      note: trimmed.length > 0 ? trimmed : null,
    });
  }, [note, target, updateStatus]);

  /* ------------------------------------------------------------ 派生数据 -- */

  const carrierOptions = useMemo(
    () =>
      SHIPMENT_CARRIERS.map((carrier) => ({
        value: carrier.code,
        label: tShipment(carrier.nameKey),
      })),
    [tShipment]
  );

  /** 订单状态的显示文案 —— 商城和工单的枚举不一样,各查各的 */
  const orderStatusLabel = useMemo(() => {
    if (row.orderKind === "storefront") {
      return t(`orderStatus.storefront.${row.orderStatus}`);
    }
    return t(`orderStatus.print.${row.orderStatus}`);
  }, [row.orderKind, row.orderStatus, t]);

  return (
    <div className="space-y-4">
      {/* 已有包裹 */}
      {row.shipments.length > 0 ? (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            {t("existing.title")}
          </h4>
          <div className="space-y-2">
            {row.shipments.map((shipment) => (
              <ShipmentItem
                key={shipment.id}
                shipment={shipment}
                target={target}
                note={note}
                isUpdating={isUpdating}
                onSelectStatus={(toStatus) => {
                  setTarget({ shipmentId: shipment.id, toStatus });
                  setNote("");
                }}
                onNoteChange={setNote}
                onSubmit={submitStatus}
                onCancel={() => {
                  setTarget(null);
                  setNote("");
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* 新包裹 */}
      {showCreate ? (
        <section className="rounded-md border bg-muted/30 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <Truck className="h-3.5 w-3.5" />
            {row.shipments.length > 0
              ? t("form.newPackageTitle")
              : t("form.firstPackageTitle")}
          </h4>

          <Form form={createForm} layout="vertical" requiredMark={false}>
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
              <Form.Item
                name="shippingCompany"
                label={t("form.carrier")}
                rules={[{ required: true, message: t("form.required") }]}
              >
                <Select options={carrierOptions} />
              </Form.Item>

              {watchedCarrier === "other" ? (
                <Form.Item
                  name="shippingCompanyLabel"
                  label={t("form.carrierOther")}
                  rules={[{ required: true, message: t("form.required") }]}
                >
                  <Input placeholder={t("form.carrierOtherPlaceholder")} />
                </Form.Item>
              ) : null}

              <Form.Item
                name="trackingNumber"
                label={t("form.trackingNumber")}
                rules={[{ required: true, message: t("form.required") }]}
              >
                <Input
                  placeholder={t("form.trackingPlaceholder")}
                  className="font-mono"
                />
              </Form.Item>
            </div>

            <Form.Item name="note" label={t("form.note")}>
              <Input.TextArea
                rows={2}
                placeholder={t("form.notePlaceholder")}
                maxLength={500}
              />
            </Form.Item>

            <div className="flex items-center gap-2">
              <Button
                type="primary"
                loading={isCreating}
                onClick={submitCreate}
                icon={<Truck className="h-3.5 w-3.5" />}
              >
                {t("form.submitShip")}
              </Button>
              <Button
                onClick={() => {
                  setShowCreate(false);
                  createForm.resetFields();
                }}
              >
                {t("form.cancel")}
              </Button>
            </div>
          </Form>
        </section>
      ) : (
        <Button
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setShowCreate(true)}
        >
          {row.shipments.length > 0
            ? t("actions.addPackage")
            : t("actions.ship")}
        </Button>
      )}

      {/* 订单状态 —— 发货会把它往前推一格 */}
      <p className="text-[11px] text-muted-foreground">
        {t("orderStatus.label")}:{" "}
        <Tag className="ml-1" bordered={false}>
          {orderStatusLabel}
        </Tag>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  一个包裹                                                                    */
/* -------------------------------------------------------------------------- */

function ShipmentItem(props: {
  shipment: ShipmentView;
  /** 正在改哪个包裹的状态 */
  target: { shipmentId: string; toStatus: ShipmentStatus } | null;
  note: string;
  isUpdating: boolean;
  onSelectStatus: (toStatus: ShipmentStatus) => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { shipment, target, note, isUpdating } = props;
  const t = useTranslations("AdminShipment");
  const tShipment = useTranslations("Shipment");

  const carrierLabel = resolveShipmentCarrierLabel({
    code: shipment.shippingCompany,
    customLabel: shipment.shippingCompanyLabel,
    translate: tShipment,
  });

  const isEditing = target !== null && target.shipmentId === shipment.id;
  const noteRequired = isEditing
    ? shipmentTransitionRequiresNote(shipment.status, target.toStatus)
    : false;

  const statusOptions = allowedNextShipmentStatuses(shipment.status).map(
    (status) => ({
      value: status,
      label: tShipment(shipmentStatusLabelKey(status)),
    })
  );

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <Tag bordered={false} className="m-0">
              {t("package.index", { index: shipment.packageIndex })}
            </Tag>
            <span className="font-medium">{carrierLabel}</span>
            <span className="font-mono text-muted-foreground">
              {shipment.trackingNumber}
            </span>
            <Tag
              bordered={false}
              color={
                shipment.status === "delivered"
                  ? "green"
                  : shipment.status === "returned"
                    ? "red"
                    : "blue"
              }
            >
              {tShipment(shipmentStatusLabelKey(shipment.status))}
            </Tag>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {tShipment("shippedAt")}:{" "}
            {new Date(shipment.shippedAt).toLocaleString("zh-CN")}
            {shipment.deliveredAt
              ? ` · ${tShipment("deliveredAt")}: ${new Date(
                  shipment.deliveredAt
                ).toLocaleString("zh-CN")}`
              : null}
            {shipment.returnedAt
              ? ` · ${tShipment("returnedAt")}: ${new Date(
                  shipment.returnedAt
                ).toLocaleString("zh-CN")}`
              : null}
          </p>
          {shipment.note ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {tShipment("note")}: {shipment.note}
            </p>
          ) : null}
        </div>

        {!isEditing ? (
          <Select<ShipmentStatus>
            size="small"
            value={null}
            placeholder={t("actions.changeStatus")}
            options={statusOptions}
            className="w-40"
            onChange={props.onSelectStatus}
          />
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-3 border-t pt-3">
          <Input.TextArea
            rows={2}
            value={note}
            onChange={(e) => props.onNoteChange(e.target.value)}
            placeholder={t("form.notePlaceholder")}
            maxLength={500}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="primary"
              size="small"
              loading={isUpdating}
              onClick={props.onSubmit}
              disabled={noteRequired && note.trim().length === 0}
            >
              {t("actions.submit")}
            </Button>
            <Button size="small" onClick={props.onCancel}>
              {t("actions.cancel")}
            </Button>
            {noteRequired ? (
              <span className="text-[11px] text-amber-600">
                {t("form.noteRequiredHint")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
