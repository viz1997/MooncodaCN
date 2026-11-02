/**
 * 打印工单状态的**视觉**映射
 *
 * ## 为什么只放视觉,不放文案
 *
 * 状态文案(「待确认」「已确认」…)走 i18n `PrintQuote.status.*` —— 用户侧和
 * 后台侧读的是同一份 key,加一个新状态时两边不会漂移。中文/英文由当前
 * locale 决定。
 *
 * 这里只放**颜色**:chip 背景色、小圆点。用户侧是浅底彩 chip,dashboard /
 * 后台是深色主题,配色不一样,所以两套 class map 都在这儿,谁用哪套自己取。
 *
 * 放在 lib/ 而不是组件里:用户侧列表(`print-order-list.tsx`)、工单详情页
 * (`print-order-detail-view.tsx`)、后台视图(`print-orders-admin-view.tsx`)
 * 都要用,抄三份必然对不上。
 *
 * ## 关于 tailwind class 写在 .ts 文件里
 *
 * Tailwind v4 的自动内容检测会扫全项目(排除 .gitignore 里的),`.ts` 也在
 * 内 —— 这里全是**字面量** class 字符串,不是拼接的,扫得到。
 */

import type { PrintOrderStatus } from "./quote-types";

/**
 * 用户侧 chip(浅底彩,给 stone 色板的页面用)
 *
 * 键是穷尽的:往 `PrintOrderStatus` 联合类型里加一个状态,这里少写一个
 * 就编译不过。
 */
export const PRINT_ORDER_STATUS_CHIP: Record<PrintOrderStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  CONFIRMED: "bg-sky-50 text-sky-700 ring-sky-600/20",
  IN_PRODUCTION: "bg-violet-50 text-violet-700 ring-violet-600/20",
  SHIPPED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-stone-100 text-stone-500 ring-stone-500/20",
};

/** 后台小圆点 */
export const PRINT_ORDER_STATUS_DOT: Record<PrintOrderStatus, string> = {
  PENDING: "bg-amber-500",
  CONFIRMED: "bg-sky-500",
  IN_PRODUCTION: "bg-violet-500",
  SHIPPED: "bg-emerald-500",
  COMPLETED: "bg-emerald-600",
  CANCELLED: "bg-zinc-500",
};

/** 后台 chip(深色主题) */
export const PRINT_ORDER_STATUS_ADMIN_CHIP: Record<PrintOrderStatus, string> = {
  PENDING: "border-amber-500/30 text-amber-700 dark:text-amber-300",
  CONFIRMED: "border-sky-500/30 text-sky-700 dark:text-sky-300",
  IN_PRODUCTION: "border-violet-500/30 text-violet-700 dark:text-violet-300",
  SHIPPED: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  COMPLETED: "border-emerald-600/30 text-emerald-700 dark:text-emerald-300",
  CANCELLED: "border-zinc-500/30 text-zinc-600 dark:text-zinc-300",
};
