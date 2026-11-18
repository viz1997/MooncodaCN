/**
 * 订单行摘要 —— 「钥匙扣 ×2、冰箱贴 ×1」
 *
 * 纯函数(零 import)⇒ 能进 vitest 的 `unit` project。
 *
 * ## 为什么单独一个文件
 *
 * **发货台**(`shipment-store.ts`)和**商城订单后台**(`storefront/admin/store.ts`)
 * 都要这个摘要 —— 两处各写一份,迟早漂(一个用「、」分隔,另一个用「,」,
 * 工作室看到两种写法会以为是两套数据)。
 *
 * ⚠️ **格式不许改** —— 发货台的邮件 / 后台表格已经用了这个写法,
 * 改了就跟历史记录对不上。
 */

/** 摘要需要的那两个字段 —— 订单行表里就有这两个 */
export interface OrderItemSummaryInput {
  /** 商品名(下单那一刻的快照) */
  productTitle: string;
  /** 数量 */
  quantity: number;
}

/**
 * 把订单行压成一行人话
 *
 * 空数组 ⇒ 空串(不是「无」,也不是 undefined)。
 */
export function summarizeOrderItems(items: OrderItemSummaryInput[]): string {
  if (items.length === 0) return "";
  return items
    .map((item) => `${item.productTitle} ×${item.quantity}`)
    .join("、");
}
