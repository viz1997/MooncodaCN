/**
 * 打印服务报价 —— 共享类型
 *
 * 客户端(报价页)和服务端(报价 API / 下单 API)共用这一份定义,避免两边
 * 字段名对不上导致「页面显示的价」和「入库的价」不是同一个东西。
 *
 * ## 金额单位:一律「分」
 *
 * 跟 `product.basePriceCents` / `product_variant.priceCents` 保持一致。
 * 报价页要显示金额,下单要落库,两边都拿分,不用在边界上做单位换算。
 *
 * ## 形状/尺寸单位
 *
 *  - 体积 cm³
 *  - 表面积 cm²
 *  - 尺寸 mm(X=长 Y=宽 Z=高)
 *  - 克重 g
 */

/** 订单状态 —— 与 `print_order_status` enum 一一对应 */
export type PrintOrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PRODUCTION"
  | "SHIPPED"
  | "COMPLETED"
  | "CANCELLED";

export const PRINT_ORDER_STATUSES: readonly PrintOrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
];

/**
 * 报价入参 —— 几何 + 支撑信息
 *
 * 几何是**客户端解析 + 用户尺寸调整之后**的结果(体积已经含缩放),
 * 服务端不重新解析模型,只按这组数算价。
 */
export type PrintQuoteInput = {
  /** 体积 cm³ */
  volumeCM3: number;
  /** 表面积 cm² */
  surfaceAreaCM2: number;
  /** 成品尺寸 mm:X=长 Y=宽 Z=高 */
  dims: [number, number, number];
  /** 智能摆盘算出的支撑克重 g;没跑摆盘是 null */
  supportWeightG?: number | null;
  /** 本体支撑比例(1 = 1:1);没跑摆盘是 null */
  selfSupportRatio?: number | null;
};

/**
 * 报价结果
 *
 * `totalPriceCents` 恒等于三项费用之和(各自取整后再加),不是先加后取整 ——
 * 报价页上「明细加起来 = 合计」必须成立,否则用户会来问为什么差一块。
 */
export type PrintQuote = {
  /** 耗材克重 g */
  materialWeightG: number;
  /** 支撑克重 g(没跑摆盘是 null) */
  supportWeightG: number | null;
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
  /** 材料密度 g/cm³ */
  density: number;
  /** 单价 分/g */
  unitPriceCentsPerGram: number;
  /** 克重费(分)= 克重 × 单价 */
  weightFeeCents: number;
  /** 光油 / 后处理固定费(分) */
  varnishFeeCents: number;
  /** 支撑加价(分)—— 本体支撑比例超 1:1 的部分 */
  supportFeeCents: number;
  /** 超出 1:1 阈值的支撑克重 g */
  excessSupportWeightG: number;
  /** 合计(分) */
  totalPriceCents: number;
};

/** 下单入参 */
export type PrintOrderRequest = {
  /** 几何 + 支撑信息 —— 服务端按这组数**重新算价**,不信客户端传来的总价 */
  quote: PrintQuoteInput;
  /** 模型文件名(用户上传时的原名) */
  modelFileName: string;
  /** 模型文件在 R2 上的对象键(由 `/api/print-orders/upload-url` 签发) */
  objectKey: string;
  /** 模型文件在 R2 上的永久 URL */
  modelUrl: string;
  /** 模型文件字节数 */
  modelSizeBytes: number | null;
  contactName: string;
  contactPhone: string | null;
  /** 用户留言(材质、颜色、特殊要求…) */
  note: string | null;
};

/**
 * 下单结果
 *
 * 2026-11-01:不再有 `token` —— 订单挂在账号名下,登录后按 userId 查,
 * 不需要「订单号 + 令牌」那套匿名查询机制了。
 */
export type PrintOrderCreated = {
  orderNo: string;
  /** 服务端重算后的报价(客户端显示的是这个,不是自己算的) */
  quote: PrintQuote;
  createdAt: string;
};

/**
 * 用户侧看到的订单 —— 「我的打印订单」列表里的一行
 *
 * 只暴露用户自己该看到的字段:不含内部 id、不含模型 URL(那是工作室取件用的)。
 */
export type UserPrintOrder = {
  orderNo: string;
  status: PrintOrderStatus;
  modelFileName: string;
  materialWeightG: number;
  supportWeightG: number | null;
  dims: [number, number, number];
  totalPriceCents: number;
  createdAt: string;
};
