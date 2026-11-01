/**
 * 打印订单的后台视图模型
 *
 * DB 里 numeric 列存的是字符串(Drizzle 的 `numeric` 默认返回 string),
 * 后台列表要的是能直接显示的数字 —— 在这里统一转一次,别让每个组件
 * 各写一遍 `Number(row.volumeCM3)`。
 */

import type { PrintOrderRow } from "@/db/schema";
import type { PrintOrderStatus } from "@/features/print-quote/lib/quote-types";

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
  totalPriceCents: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  note: string | null;
  /** ISO 时间串 */
  createdAt: string;
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
    totalPriceCents: row.totalPriceCents,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
