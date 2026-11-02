/**
 * 尺寸展示 —— cm 为主,附英寸。
 *
 * 用户口径(2026-11-02):「注意附上英尺」。只给 cm 的话,按英寸挑尺寸的买家
 * 要自己换算,选错档只能等实物到手才发现 —— 定制件没有「退换」这回事。
 * 规格屏的尺寸 chip 第二行、确认页、购物袋都走这里的格式,避免各写各的。
 */

/** 1 英寸 = 2.54 cm(固定换算率) */
export const CM_PER_INCH = 2.54;

/** cm → 英寸(未取整) */
export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

/** 英寸字符串,两位小数 —— "2.36in" */
export function formatInches(cm: number): string {
  return `${cmToInches(cm).toFixed(2)}in`;
}

/** 尺寸完整文案 —— "6cm / 2.36in" */
export function formatSizeWithInches(cm: number): string {
  return `${cm}cm / ${formatInches(cm)}`;
}

/**
 * 紧凑尺寸 —— "6cm(2.36in)"
 *
 * 商品详情页把多档尺寸连成一行("4cm(1.57in) / 6cm(2.36in)"),这时不能
 * 用 formatSizeWithInches —— "4cm / 1.57in / 6cm / 2.36in" 分不清哪个
 * cm 配哪个 inch。
 */
export function formatSizeCompact(cm: number): string {
  return `${cm}cm(${formatInches(cm)})`;
}
