/**
 * 商城订单详情页的视图模型 —— **纯类型,零 import**
 *
 * ## 为什么单独一个文件
 *
 * `storefront/lib/orders.ts` 是**服务端**模块(它 import `@/db`)。客户端
 * 组件要拿订单的形状,不能从那儿 import —— 那一 import 会把 drizzle 和
 * 整张 schema 拖进客户端 bundle。
 *
 * 这里放**只有类型**的版本:客户端组件 import 它,运行时是零成本(TS 把
 * `import type` 整个抹掉)。映射(行 → 视图)在 RSC 里做。
 *
 * ## 为什么字段全是「可序列化的原始值」
 *
 * 这些对象要穿过 RSC → 客户端的边界(Date 对象过那道边界会变成字符串,
 * 行为还不统一)。所以时间一律是 **ISO 字符串**,金额一律是**整数分**。
 */

import type { ShippingAddressSnapshot } from "@/db/schema";

/**
 * 订单状态 —— 单子走到哪一步了
 *
 * `fulfilled` = 已发货。工作室在后台发货台填了单号,商城订单就会从 `paid`
 * 推到 `fulfilled`(见 `features/shipment/lib/order-linkage.ts`)。
 */
export type StoreOrderStatus = "unpaid" | "paid" | "fulfilled" | "cancelled";

/** 支付状态 —— 钱怎么样了(跟订单状态是**两回事**) */
export type StoreOrderPaymentStatus = "unpaid" | "paid" | "refunded" | "failed";

/** 订单行 —— 一行一个商品 */
export interface StoreOrderDetailItem {
  id: string;
  /** 商品名 */
  title: string;
  /** 封面图 */
  thumbnail: string | null;
  /** SKU */
  sku: string | null;
  quantity: number;
  /** 原价单价(分) */
  unitPriceCents: number;
  /**
   * 折后单价(分) —— **用户真正付的那一档**
   *
   * 数量阶梯折扣折在**单价**上,不是折在小计上(见
   * `features/storefront/lib/cart-totals.ts`)。所以这一列才是收款依据。
   */
  discountedUnitPriceCents: number;
  /** 行小计(分) */
  lineTotalCents: number;
}

/** 订单本体 —— 详情页要显示的那些列 */
export interface StoreOrderDetailOrder {
  orderNo: string;
  status: StoreOrderStatus;
  paymentStatus: StoreOrderPaymentStatus;
  currency: string;
  /** 原价小计(分) —— 折前 */
  subtotalCents: number;
  /** 数量阶梯折扣(分) */
  discountCents: number;
  /** 优惠码减了多少(分) */
  couponDiscountCents: number;
  /** 用的哪个码(优惠码住在**车**上,这一列只是快照) */
  couponCode: string | null;
  /** 运费(分) */
  shippingCents: number;
  /** 应付总额(分) —— `subtotal − discount − couponDiscount + shipping` */
  totalCents: number;
  paymentUrl: string | null;
  /** 微信扫码的二维码内容(其它通道是 null) */
  paymentQrCodeUrl: string | null;
  paymentChannel: string | null;
  /** 付款时间(ISO) —— null = 还没付 */
  paidAt: string | null;
  /** 下单时间(ISO) */
  createdAt: string;
  /** 买家留言 */
  note: string | null;
  /**
   * 收货地址快照 —— 落库了但买家侧一直没渲染过
   *
   * 用快照不用地址簿:用户后来改了地址簿,历史订单的收货地址不该跟着变
   * (包裹已经按老地址寄出去了)。
   */
  shippingAddress: ShippingAddressSnapshot | null;
}

/**
 * 轮询时会变的那几个字段
 *
 * 商品行和金额**不会**变(建单之后就是死的)⇒ 不进轮询接口,也不进指纹。
 * 会变的只有:订单状态 / 收款状态 / 付款入口 / 物流。
 */
export interface StoreOrderPaymentSnapshot {
  status: StoreOrderStatus;
  paymentStatus: StoreOrderPaymentStatus;
  paymentUrl: string | null;
  paymentQrCodeUrl: string | null;
}
