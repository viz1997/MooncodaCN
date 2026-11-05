/**
 * 打印订单的后台视图模型
 *
 * DB 里 numeric 列存的是字符串(Drizzle 的 `numeric` 默认返回 string),
 * 后台列表要的是能直接显示的数字 —— 在这里统一转一次,别让每个组件
 * 各写一遍 `Number(row.volumeCM3)`。
 */

import type { PrintOrderRow } from "@/db/schema";
import {
  type DeliveryTierId,
  getDeliveryTier,
} from "@/features/print-quote/lib/delivery-tier";
import type {
  PrintOrderLocale,
  PrintOrderPaymentChannel,
  PrintOrderPaymentStatus,
  PrintOrderStatus,
} from "@/features/print-quote/lib/quote-types";

export type AdminPrintOrder = {
  id: string;
  orderNo: string;
  /** 下单人 —— 2026-11-01 起订单挂在账号名下 */
  userId: string;
  status: PrintOrderStatus;
  modelFileName: string;
  modelUrl: string;
  modelSizeBytes: number | null;
  volumeCM3: number;
  surfaceAreaCM2: number;
  /** 成品尺寸 mm */
  dims: [number, number, number];
  materialWeightG: number;
  supportWeightG: number | null;
  weightFeeCents: number;
  varnishFeeCents: number;
  supportFeeCents: number;
  /** 交期档位(standard / express / urgent)—— 工作室据此排产 */
  deliveryTier: DeliveryTierId;
  /** 交期加价(分)—— 按小计比例收 */
  deliveryFeeCents: number;
  /** 承诺交期(小时) */
  deliveryHours: number;
  totalPriceCents: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  note: string | null;
  /**
   * 这单的邮件通知语言
   *
   * 工作室改状态时通知用户的邮件用这个语言 —— 后台界面的语言跟它没关系。
   */
  locale: PrintOrderLocale;
  /**
   * 收款状态(2026-11-04)
   *
   * 「生产中」这个状态要求 `paymentStatus === "paid"` —— 没收到钱的单
   * 不该开工。工作室在这里能看到是不是已经付了。
   */
  paymentStatus: PrintOrderPaymentStatus;
  /** 收款渠道:线上(stripe) / 线下转账(offline) */
  paymentChannel: PrintOrderPaymentChannel | null;
  /** 收款时间 */
  paidAt: string | null;
  /** ISO 时间串 */
  createdAt: string;
  /** 最后一次状态变更时间 */
  updatedAt: string;
};

function num(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toAdminPrintOrder(row: PrintOrderRow): AdminPrintOrder {
  return {
    id: row.id,
    orderNo: row.orderNo,
    userId: row.userId,
    status: row.status,
    modelFileName: row.modelFileName,
    modelUrl: row.modelUrl,
    modelSizeBytes: row.modelSizeBytes,
    volumeCM3: num(row.volumeCM3),
    surfaceAreaCM2: num(row.surfaceAreaCM2),
    dims: [num(row.dimX), num(row.dimY), num(row.dimZ)],
    materialWeightG: num(row.materialWeightG),
    supportWeightG:
      row.supportWeightG === null ? null : num(row.supportWeightG),
    weightFeeCents: row.weightFeeCents,
    varnishFeeCents: row.varnishFeeCents,
    supportFeeCents: row.supportFeeCents,
    deliveryTier: row.deliveryTier,
    deliveryFeeCents: row.deliveryFeeCents,
    deliveryHours: getDeliveryTier(row.deliveryTier).hours,
    totalPriceCents: row.totalPriceCents,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    note: row.note,
    locale: row.locale === "en" ? "en" : "zh",
    paymentStatus: row.paymentStatus,
    paymentChannel: row.paymentChannel,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
