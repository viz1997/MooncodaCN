/**
 * 商城订单后台 —— 视图模型(2026-11-18)
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:买家点了跳到
 * 淘宝,在淘宝付款(享受平台担保)。钱进的是**淘宝那个账户** ⇒ 工作室在淘宝
 * 后台看到钱到了,回本站把那一单**手工标成已收款**。
 *
 * 这一页(`/admin/store-orders`)就是那件事的地方。
 *
 * ## 零 DB 依赖
 *
 * 这个文件只放**类型**和**纯函数**(不 import `@/db`)⇒ 能进 vitest 的
 * `unit` project 直接测。
 *
 * ## 类型**不在** `"use server"` 文件里
 *
 * Turbopack 会把 `"use server"` 文件里的类型 re-export 注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。所以类型全在这儿。
 */

import type {
  StoreOrderPaymentStatus,
  StoreOrderStatus,
} from "@/features/storefront/lib/order-detail-types";

/* -------------------------------------------------------------------------- */
/*  错误码                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 后台这一页的失败原因
 *
 * 每个码都要有人话 —— 工作室看到的是一个能照着改的句子,不是「服务器错误」。
 */
export type AdminStoreOrderErrorCode =
  /** 订单号查不到 */
  | "ORDER_NOT_FOUND"
  /** 这一单退过款了 —— 不能改成已收款 */
  | "ORDER_REFUNDED"
  /** 这一单已经取消了 */
  | "ORDER_CANCELLED"
  /**
   * 金额对不上
   *
   * 只卡**线下转账**:那条路的实收金额**必须**等于订单应付(「逐分相等」)。
   * 淘宝那一单**允许**对不上 —— 淘宝那边的运费模板、优惠券是它自己那套。
   */
  | "AMOUNT_MISMATCH"
  /** 淘宝通道必须填淘宝订单号 */
  | "EXTERNAL_ORDER_NO_REQUIRED"
  /** 入参不合法 */
  | "INVALID_INPUT"
  /** 迁移脚本还没跑(表 / 列不存在) */
  | "MIGRATION_MISSING"
  /** 落库失败 */
  | "SAVE_FAILED"
  /** 列表读不出来 */
  | "LOAD_FAILED";

/** 错误码 → i18n 键(固定表,不做动态拼键) */
export const STORE_ORDER_ERROR_TEXT_KEYS: Record<
  AdminStoreOrderErrorCode,
  string
> = {
  ORDER_NOT_FOUND: "errors.ORDER_NOT_FOUND",
  ORDER_REFUNDED: "errors.ORDER_REFUNDED",
  ORDER_CANCELLED: "errors.ORDER_CANCELLED",
  AMOUNT_MISMATCH: "errors.AMOUNT_MISMATCH",
  EXTERNAL_ORDER_NO_REQUIRED: "errors.EXTERNAL_ORDER_NO_REQUIRED",
  INVALID_INPUT: "errors.INVALID_INPUT",
  MIGRATION_MISSING: "errors.MIGRATION_MISSING",
  SAVE_FAILED: "errors.SAVE_FAILED",
  LOAD_FAILED: "errors.LOAD_FAILED",
};

/* -------------------------------------------------------------------------- */
/*  通道                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 商城订单上可能出现的收款通道
 *
 * 跟 `PaymentChannel` 同一套取值 —— 这一页只是**展示**它们。
 */
export type AdminStoreOrderChannel =
  | "wechat"
  | "alipay"
  | "taobao"
  | "shopify"
  | "stripe"
  | "offline";

/** 通道 → i18n 键(固定表) */
export const STORE_ORDER_CHANNEL_TEXT_KEYS: Record<
  AdminStoreOrderChannel,
  string
> = {
  wechat: "channels.wechat",
  alipay: "channels.alipay",
  taobao: "channels.taobao",
  shopify: "channels.shopify",
  stripe: "channels.stripe",
  offline: "channels.offline",
};

/**
 * 「手工标已收款」这一步支持的通道
 *
 * 只有这两个:
 *
 * - `taobao` —— 钱在淘宝账户里,工作室在淘宝后台看到钱到了,回这儿标
 * - `offline` —— 线下转账(工作室后台手工标的老口径)
 *
 * 微信 / 支付宝**不在这里** —— 那两条路是回调自动标的,人再标一次是
 * 拿「人工」覆盖「机器」。
 */
export type AdminStoreOrderMarkChannel = "taobao" | "offline";

/* -------------------------------------------------------------------------- */
/*  行                                                                         */
/* -------------------------------------------------------------------------- */

/** 商城订单的一行(后台表格) */
export interface AdminStoreOrderRow {
  /** 业务订单号(用户可见的那个) */
  orderNo: string;
  /** 下单时间(ISO 字符串) */
  createdAt: string;
  /** 买家邮箱 */
  buyerEmail: string | null;
  /** 买家昵称 */
  buyerName: string | null;
  /** 商品摘要 —— 「钥匙扣 ×2、冰箱贴 ×1」 */
  itemSummary: string;
  /** 共几件 */
  itemCount: number;
  /** 订单状态 */
  status: StoreOrderStatus;
  /** 收款状态 */
  paymentStatus: StoreOrderPaymentStatus;
  /** 走哪个通道收的钱 */
  paymentChannel: AdminStoreOrderChannel | null;
  /** 平台侧单号(淘宝那一单 = 工作室抄进来的淘宝订单号) */
  providerOrderId: string | null;
  /**
   * 本站应付(分)—— **参考价**
   *
   * 淘宝那一单的真实金额以淘宝后台为准,不在这一列。
   */
  totalCents: number;
  /** 运费(分) */
  shippingCents: number;
  /** 用了哪个优惠码 */
  couponCode: string | null;
  /**
   * **外部渠道**实收金额(分)—— NULL = 还没填
   *
   * 只对淘宝那一路有意义(工作室在淘宝后台看到的实收)。
   */
  externalPaidCents: number | null;
  /** 这一行能不能手工标已收款 */
  canMarkPaid: boolean;
  /** 不能标的话,是什么挡住了(给界面显示那一句) */
  markPaidBlockCode: AdminStoreOrderErrorCode | null;
}

/* -------------------------------------------------------------------------- */
/*  纯函数                                                                     */
/* -------------------------------------------------------------------------- */

/** 建行要的那些原始字段(从 DB 读出来的那几列) */
export interface AdminStoreOrderSource {
  orderNo: string;
  createdAt: Date;
  buyerEmail: string | null;
  buyerName: string | null;
  itemSummary: string;
  itemCount: number;
  status: string;
  paymentStatus: string;
  paymentChannel: string | null;
  providerOrderId: string | null;
  totalCents: number;
  shippingCents: number;
  couponCode: string | null;
  externalPaidCents: number | null;
}

/** DB 里的状态列 → 界面上那套取值(认不出来的一律当「待支付」) */
function toOrderStatus(raw: string): StoreOrderStatus {
  if (
    raw === "unpaid" ||
    raw === "paid" ||
    raw === "fulfilled" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "unpaid";
}

function toPaymentStatus(raw: string): StoreOrderPaymentStatus {
  if (
    raw === "unpaid" ||
    raw === "paid" ||
    raw === "refunded" ||
    raw === "failed"
  ) {
    return raw;
  }
  return "unpaid";
}

/** DB 里的通道列 → 界面上那套取值(认不出来的就是 null) */
function toChannel(raw: string | null): AdminStoreOrderChannel | null {
  if (
    raw === "wechat" ||
    raw === "alipay" ||
    raw === "taobao" ||
    raw === "shopify" ||
    raw === "stripe" ||
    raw === "offline"
  ) {
    return raw;
  }
  return null;
}

/**
 * 这一行能不能手工标已收款
 *
 * 判定顺序跟服务端那三道闸**一致**(退款 → 取消 → 已付):
 *
 * - 退过款的 ⇒ 不能标(迟到的收款通知也不能把它改回「已支付」)
 * - 已取消的 ⇒ 不能标
 * - 已经付过的 ⇒ **可以标**(那是去补填「淘宝实收金额」,不是再收一次钱)
 */
export function evaluateMarkPaid(
  row: Pick<
    AdminStoreOrderRow,
    "status" | "paymentStatus" | "externalPaidCents"
  >
): { canMarkPaid: boolean; blockCode: AdminStoreOrderErrorCode | null } {
  if (row.paymentStatus === "refunded") {
    return { canMarkPaid: false, blockCode: "ORDER_REFUNDED" };
  }
  if (row.status === "cancelled") {
    return { canMarkPaid: false, blockCode: "ORDER_CANCELLED" };
  }
  return { canMarkPaid: true, blockCode: null };
}

/** 把原始行组装成视图行 */
export function toAdminStoreOrderRow(
  source: AdminStoreOrderSource
): AdminStoreOrderRow {
  const status = toOrderStatus(source.status);
  const paymentStatus = toPaymentStatus(source.paymentStatus);
  const { canMarkPaid, blockCode } = evaluateMarkPaid({
    status,
    paymentStatus,
    externalPaidCents: source.externalPaidCents,
  });

  return {
    orderNo: source.orderNo,
    createdAt: source.createdAt.toISOString(),
    buyerEmail: source.buyerEmail,
    buyerName: source.buyerName,
    itemSummary: source.itemSummary,
    itemCount: source.itemCount,
    status,
    paymentStatus,
    paymentChannel: toChannel(source.paymentChannel),
    providerOrderId: source.providerOrderId,
    totalCents: source.totalCents,
    shippingCents: source.shippingCents,
    couponCode: source.couponCode,
    externalPaidCents: source.externalPaidCents,
    canMarkPaid,
    markPaidBlockCode: blockCode,
  };
}

/**
 * 实收与本站应付的差额(分)
 *
 * - `null` —— 还没填实收金额
 * - `0` —— 一分不差
 * - 正数 —— 淘宝那边多收了(运费模板 / 优惠券口径不同)
 * - 负数 —— 淘宝那边少收了(工作室该补)
 *
 * ⚠️ **淘宝那一单本来就不该相等** —— 本站是参考价,淘宝有它自己的运费模板
 * 和优惠券。所以这个差额是**给工作室看的**,不是「对不上就报错」。
 */
export function externalPaidDifferenceCents(
  row: Pick<AdminStoreOrderRow, "totalCents" | "externalPaidCents">
): number | null {
  if (row.externalPaidCents === null) return null;
  return row.externalPaidCents - row.totalCents;
}

/* -------------------------------------------------------------------------- */
/*  action 的返回值                                                            */
/* -------------------------------------------------------------------------- */

/** 读列表 */
export type AdminStoreOrderListResult =
  | { ok: true; rows: AdminStoreOrderRow[] }
  | { ok: false; code: AdminStoreOrderErrorCode };

/**
 * 写(标已收款)
 *
 * `changed` = 状态**真的**变了:
 *
 * - `true` —— 刚从「待支付」变成「已支付」
 * - `false` —— 已经是「已支付」了,这次只是补填了金额 / 单号
 */
export type AdminStoreOrderWriteResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: AdminStoreOrderErrorCode };
