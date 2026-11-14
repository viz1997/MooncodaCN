/**
 * 退款 —— 共享类型
 *
 * ## 退款为什么是**独立的表**,不塞进订单的 `status`
 *
 * 退款跟订单状态是**正交的两个维度**:
 *
 * - 退过款的单**仍然是「已付款」那一列**(`payment_status = "refunded"`)
 * - 工作室还在处理申请的那段时间里,订单本身的状态一点没变
 *
 * 这跟仓库已有的 `status` / `payment_status` 分列是同一个道理 ——
 * `storefront_order.status` 说的是「这单走到哪一步」,`payment_status` 说的是
 * 「钱到没到、退没退」,退款申请说的是「买家申请了没有、工作室处理到哪一步」。
 *
 * ⚠️ **退款只改 `payment_status`,绝不动 `status`** —— 这条铁律在
 * `src/features/payments/lib/transitions.ts` 的 `mark_refunded` 分支里,
 * 全仓**只有那一处**能写 `payment_status = "refunded"`。
 *
 * ## 状态用**小写**
 *
 * `payment_status`(`unpaid`/`paid`/`refunded`)、`shipment.status` 全是小写,
 * 新表跟着走。
 *
 * ⚠️ **跟 `print_order.status` 的 `PENDING` / `SHIPPED`(大写)是两回事**:
 * 那个是「制作进度」(打印件做到哪一步了),这个是「退款申请处理到哪一步」。
 *
 * 这个文件是**纯类型** —— 不 import db / React / next,能直接跑单测。
 */

/**
 * 退款挂在哪种订单上
 *
 * 两张订单表的 id 不通用(商城订单的 id 跟打印工单的 id 是两套),所以退款行
 * 必须带这个维度才能定位到是哪一单。
 */
export type RefundOrderKind = "storefront" | "print";

/**
 * 退款申请状态 —— 与 `refund_request.status` 列的枚举一一对应
 *
 * - `pending`   待处理(买家刚提交)
 * - `approved`  已同意(工作室点了「同意退款」,钱退不退还在执行)
 * - `refunded`  已退款(钱已经退到买家账上了)
 * - `rejected`  已拒绝(工作室驳回了申请)
 *
 * `approved` 这一档是**给平台退款 API 留的位置** —— 微信/支付宝的退款接口
 * 可能返回 `PROCESSING`(钱还在路上),这时候本地不能急着写 `refunded`。
 */
export type RefundStatus = "pending" | "approved" | "refunded" | "rejected";

/**
 * 时间线里谁改的
 *
 * - `user`  —— 买家自己申请的
 * - `admin` —— 工作室处理的
 */
export type RefundActor = "user" | "admin";

/**
 * 买家侧看到的退款申请
 *
 * 时间戳是 **ISO 字符串** —— 这一份要穿过 API(RSC → JSON)和 RSC props
 * 两条路,`Date` 对象在 JSON 序列化那一步会变成字符串,两边就长得不一样了。
 */
export type RefundView = {
  id: string;
  /** 挂在哪种订单上 */
  orderKind: RefundOrderKind;
  /** 订单号 */
  orderNo: string;
  /** 申请金额(分)—— 整单退,所以就是订单总额 */
  amountCents: number;
  /** 买家填的原因 */
  reason: string;
  /** 申请状态 */
  status: RefundStatus;
  /** 工作室实际退的金额(分)—— 还没退成功时是 null */
  refundedCents: number | null;
  /** 收款通道(`wechat` / `alipay`) */
  paymentChannel: string | null;
  /** 工作室的备注 */
  note: string | null;
  /** 平台侧的退款单号 */
  providerRefundId: string | null;
  /** 平台给的退款状态(`SUCCESS` / `PROCESSING` / `CLOSED` / `ABNORMAL`) */
  providerRefundStatus: string | null;
  /** 退款失败的原因(平台回的原文) */
  refundError: string | null;
  /** 申请时间 */
  createdAt: string;
  /** 最后一次变更时间 —— 轮询的变更检测靠它 */
  updatedAt: string;
};

/**
 * 退款申请时间线上的一条事件
 *
 * 系统句子不落库:「工作室同意了这笔退款」由前端按 (actor, from, to) 用 i18n
 * 现场渲染,库里只存人工写的 note。
 */
export type RefundEventView = {
  id: string;
  /** 原状态;创建事件为 null */
  fromStatus: RefundStatus | null;
  toStatus: RefundStatus;
  actor: RefundActor;
  /** 人工备注;拒绝时必填 */
  note: string | null;
  createdAt: string;
};

/**
 * 失败码 —— 服务端**不抛异常**,一律返这些码
 *
 * 界面按 code 查文案表(`features/refund/admin/types.ts` 的
 * `REFUND_ERROR_TEXT_KEYS`)。抛异常会被 next-safe-action 糊成「服务器错误」。
 */
export type RefundErrorCode =
  /** 订单不存在(或者不是这个订单的) */
  | "ORDER_NOT_FOUND"
  /** 退款申请不存在 */
  | "REFUND_NOT_FOUND"
  /** 不允许的状态变化 */
  | "INVALID_TRANSITION"
  /** 这条变更必须写备注 */
  | "NOTE_REQUIRED"
  /** 参数不对(金额 / 原因) */
  | "INVALID_INPUT"
  /** 这单不符合退款条件(见 `eligibility.ts`) */
  | "NOT_REFUNDABLE"
  /** 已经有一条进行中的申请 */
  | "REQUEST_EXISTS"
  /** 这个通道不支持退款 */
  | "REFUND_NOT_SUPPORTED"
  /** 平台拒绝了这次退款(微信 / 支付宝回的原文在 `detail` 里) */
  | "PROVIDER_REJECTED"
  /** 平台退款还在处理中(钱在路上) */
  | "REFUND_PROCESSING"
  /** 迁移脚本没跑(表不存在) */
  | "MIGRATION_MISSING"
  /** 写库失败 */
  | "SAVE_FAILED";

/**
 * 不符合退款条件的**具体原因**
 *
 * 比 `NOT_REFUNDABLE` 更细一层 —— 界面要能说清楚「为什么不能退」,而不是
 * 一句「不能退款」。
 */
export type RefundIneligibleCode =
  /** 没付款 / 已经退过款 */
  | "NOT_PAID"
  /** 单子已取消 */
  | "ORDER_CANCELLED"
  /** 打印已经开始了(工作室原话:「开始打印或者生产开始后无法退款」) */
  | "PRODUCTION_STARTED"
  /** 商城订单已发货 */
  | "ALREADY_SHIPPED"
  /** 已经有一条进行中的申请 */
  | "REQUEST_EXISTS"
  /** 订单不存在 / 不是你的 */
  | "NOT_FOUND";

/**
 * 后台退款管理的一行 = 一条退款申请
 */
export type AdminRefundRow = {
  id: string;
  orderKind: RefundOrderKind;
  orderId: string;
  orderNo: string;
  /** 买家 id */
  userId: string;
  /** 买家邮箱 / 昵称(后台好认人) */
  buyerLabel: string;
  /** 订单摘要(商城 = 商品名;打印 = 模型文件名) */
  summary: string;
  /** 申请金额(分) */
  amountCents: number;
  /** 买家填的原因 */
  reason: string;
  status: RefundStatus;
  /** 工作室实际退的金额(分) */
  refundedCents: number | null;
  /** 收款通道 */
  paymentChannel: string | null;
  /** 平台侧的退款单号 */
  providerRefundId: string | null;
  /** 平台给的退款状态 */
  providerRefundStatus: string | null;
  /** 退款失败的原因 */
  refundError: string | null;
  /** 工作室的备注 */
  note: string | null;
  /** 订单状态(商城 `paid`/`fulfilled`…;打印 `PENDING`/`SHIPPED`…) */
  orderStatus: string;
  /** 收款状态(小写那套) */
  paymentStatus: string;
  /** 申请时间 */
  createdAt: string;
  /** 最后一次变更时间 */
  updatedAt: string;
};
