/**
 * 商城订单状态的**视觉**映射
 *
 * ## 为什么只放视觉,不放文案
 *
 * 状态文案走 i18n `StorefrontOrder.status.*` —— 文案跟着当前 locale 走,
 * 这里只管颜色。跟 `print-quote/lib/status-ui.ts` 一个路子。
 *
 * ## 关于 tailwind class 写在 .ts 文件里
 *
 * Tailwind v4 的自动内容检测会扫全项目(排除 .gitignore 里的),`.ts` 也在
 * 内 —— 这里全是**字面量** class 字符串,不是拼接的,扫得到。
 */

import type {
  StoreOrderPaymentStatus,
  StoreOrderStatus,
} from "./order-detail-types";

/** 订单状态 chip(用户侧,浅底彩) */
export const STORE_ORDER_STATUS_CHIP: Record<StoreOrderStatus, string> = {
  unpaid: "bg-amber-50 text-amber-700 ring-amber-600/20",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  fulfilled: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  cancelled: "bg-stone-100 text-stone-500 ring-stone-500/20",
};

/**
 * 收款状态 chip —— 跟订单状态是**两套**
 *
 * 订单状态说「单子走到哪一步」,收款状态说「钱到没到」。用户最关心后者。
 */
export const STORE_ORDER_PAYMENT_CHIP: Record<StoreOrderPaymentStatus, string> =
  {
    unpaid: "bg-amber-50 text-amber-700 ring-amber-600/20",
    paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    refunded: "bg-stone-100 text-stone-600 ring-stone-500/20",
    failed: "bg-red-50 text-red-700 ring-red-600/20",
  };
