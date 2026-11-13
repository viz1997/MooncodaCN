/**
 * 后台发货台的**视图模型 + 错误码**
 *
 * ## 为什么单独一个文件
 *
 * 类型**不能**放在 `"use server"` 文件里 —— Turbopack 会把那个文件里的
 * 每一个 export 都注册成 server action,类型 re-export 会注册出一个不存在的
 * action,运行时 `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 所以 `actions.ts` 只导出 async 函数,类型全在这个纯文件里。
 *
 * 这个文件**零 import**(除了类型)—— 能进 vitest `unit` project 跑单测。
 */

import type {
  AdminShipmentRow,
  ShipmentErrorCode,
  ShipmentOrderKind,
  ShipmentStatus,
} from "@/features/shipment/lib/types";

/** 后台的错误码 = 物流层那一份(不多不少) */
export type AdminShipmentErrorCode = ShipmentErrorCode;

/**
 * 读列表的结果
 *
 * **表不存在也是一个结果**,不是异常 —— 迁移脚本没跑的时候,后台要显示
 * 「先跑 `pnpm migrate:apply-shipment`」,而不是甩一个 500。
 */
export type AdminShipmentListResult =
  | { ok: true; rows: AdminShipmentRow[] }
  | { ok: false; code: AdminShipmentErrorCode };

/**
 * 写操作的统一返回
 *
 * **不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,工作室根本
 * 不知道是哪儿错了(是订单不在?是这个状态不让改?是表还没建?)。
 */
export type AdminShipmentWriteResult =
  | {
      ok: true;
      /** 这次动的那个包裹 */
      shipmentId: string;
      /** 第几个包裹 */
      packageIndex: number;
      /** 真的改了吗(同状态 = 没改) */
      changed: boolean;
    }
  | { ok: false; code: AdminShipmentErrorCode };

/**
 * 错误码 → i18n 键
 *
 * **一张表,一个来源** —— 后台界面按 code 查文案,不许在组件里写
 * `code === "NOTE_REQUIRED" ? "..." : ...` 这种 if-else:多一个码就多一处
 * 要改的地方,漏一处那个码就显示成原始的英文常量。
 *
 * 键是**相对 `AdminShipment` 命名空间**的(不含前缀)—— 组件里
 * `t(SHIPMENT_ERROR_TEXT_KEYS[code])` 直接用。
 */
export const SHIPMENT_ERROR_TEXT_KEYS: Record<AdminShipmentErrorCode, string> =
  {
    ORDER_NOT_FOUND: "errors.ORDER_NOT_FOUND",
    SHIPMENT_NOT_FOUND: "errors.SHIPMENT_NOT_FOUND",
    INVALID_TRANSITION: "errors.INVALID_TRANSITION",
    NOTE_REQUIRED: "errors.NOTE_REQUIRED",
    INVALID_INPUT: "errors.INVALID_INPUT",
    MIGRATION_MISSING: "errors.MIGRATION_MISSING",
    SAVE_FAILED: "errors.SAVE_FAILED",
  };

/**
 * 后台列表的筛选条件
 *
 * - `pending` —— **一个包裹都没有**的单(还没发货)
 * - `shipped` / `delivered` / `returned` —— **至少有一个**包裹在那个状态
 */
export type AdminShipmentFilter = ShipmentStatus | "pending";

/** 发货台一行 = 一个订单 —— 类型住在 `lib/types.ts`(买家侧也用) */
export type { AdminShipmentRow, ShipmentOrderKind, ShipmentStatus };
