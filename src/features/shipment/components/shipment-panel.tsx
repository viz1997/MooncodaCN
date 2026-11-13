"use client";

/**
 * 买家侧的物流显示 —— 打印工单详情页和商城订单详情页**共用这一份**
 *
 * ## 为什么共用
 *
 * 两处显示的东西一模一样(快递公司 + 运单号 + 状态 + 时间 + 备注)——
 * 写两份的话,工作室改一次文案要改两个地方,漏一个就漂了。
 *
 * ## 没有包裹时摆一句「还没发货」
 *
 * 空白看着像「坏了」。工作室寄出去之前,买家看这一格该知道**还没发货**,
 * 而不是以为自己漏看了什么。
 *
 * ## 收货地址也在这儿
 *
 * 地址快照一直落在订单上(`storefront_order.shipping_address` /
 * `print_order.shipping_address`),但**买家侧从来没渲染过它** —— 跟物流
 * 放在一起正好:买家要看的就是「寄到哪儿、怎么寄的」。
 *
 * ## 面板自己带 `AtelierPanel`
 *
 * 组件自带外壳(标题 + 边框面板),调用方只管把它摆进页面 —— 两处的版式
 * 不会各写一遍然后漂掉。
 */

import { MapPin, Truck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ShippingAddressSnapshot } from "@/db/schema";
import { formatAddressLine } from "@/features/address/types";
import {
  AtelierPanel,
  AtelierSectionTitle,
} from "@/features/shared/components/atelier-page";
import { resolveShipmentCarrierLabel } from "@/features/shipment/lib/carriers";
import { shipmentStatusLabelKey } from "@/features/shipment/lib/transitions";
import type { ShipmentView } from "@/features/shipment/lib/types";

/* -------------------------------------------------------------------------- */
/*  状态徽章                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 状态徽章的配色 —— 跟后台那一套区分开
 *
 * 后台是 antd 的 `Tag`,这里是 atelier 的细边框小徽章。签收用绿(好消息)、
 * 异常用红(要处理),发货用中性色。
 */
const STATUS_CHIP: Record<ShipmentView["status"], string> = {
  shipped: "text-foreground ring-border",
  delivered: "text-emerald-700 ring-emerald-600/30",
  returned: "text-destructive ring-destructive/30",
};

/* -------------------------------------------------------------------------- */
/*  物流                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 物流面板 —— 一个订单可能有多个包裹(补发 / 分开发)
 *
 * 包裹按 `packageIndex` 排(服务端就是这么排的),买家看到「包裹 1」「包裹 2」。
 */
export function ShipmentPanel({ shipments }: { shipments: ShipmentView[] }) {
  const t = useTranslations("Shipment");
  const format = useFormatter();

  return (
    <AtelierPanel>
      <AtelierSectionTitle icon={Truck}>{t("title")}</AtelierSectionTitle>

      {shipments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {shipments.map((shipment) => {
            const carrier = resolveShipmentCarrierLabel({
              code: shipment.shippingCompany,
              customLabel: shipment.shippingCompanyLabel,
              translate: t,
            });
            return (
              <li
                key={shipment.id}
                className="border-t border-border pt-4 first:border-t-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {carrier}
                  </span>
                  <span className="font-mono text-sm break-all text-foreground">
                    {shipment.trackingNumber}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                      STATUS_CHIP[shipment.status]
                    }`}
                  >
                    {t(shipmentStatusLabelKey(shipment.status))}
                  </span>
                  {shipments.length > 1 ? (
                    <span className="text-[11px] text-muted-foreground">
                      {t("packageIndex", { index: shipment.packageIndex })}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("shippedAt")}:{" "}
                  {format.dateTime(new Date(shipment.shippedAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {shipment.deliveredAt ? (
                    <>
                      {" · "}
                      {t("deliveredAt")}:{" "}
                      {format.dateTime(new Date(shipment.deliveredAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </>
                  ) : null}
                  {shipment.returnedAt ? (
                    <>
                      {" · "}
                      {t("returnedAt")}:{" "}
                      {format.dateTime(new Date(shipment.returnedAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </>
                  ) : null}
                </p>

                {shipment.note ? (
                  <p className="mt-1 whitespace-pre-line text-[11px] text-muted-foreground">
                    {t("note")}: {shipment.note}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </AtelierPanel>
  );
}

/* -------------------------------------------------------------------------- */
/*  收货地址                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 收货地址面板 —— 订单上那份**快照**
 *
 * 用快照不用地址簿:用户后来改了地址簿,历史订单的收货地址不该跟着变
 * (包裹已经按老地址寄出去了)。
 *
 * 没有快照的老单摆「—」,不编一个地址出来。
 */
export function ShippingAddressPanel({
  address,
}: {
  address: ShippingAddressSnapshot | null;
}) {
  const t = useTranslations("Shipment");

  return (
    <AtelierPanel>
      <AtelierSectionTitle icon={MapPin}>{t("address")}</AtelierSectionTitle>

      {address ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {t("recipient")}
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {address.recipientName}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">{t("phone")}</dt>
            <dd className="mt-1 font-mono text-sm break-all text-foreground">
              {address.phone}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-muted-foreground">
              {t("addressLine")}
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {formatAddressLine(address)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </AtelierPanel>
  );
}
