/**
 * 物流 —— 共享类型
 *
 * ## 为什么物流是**独立的表**,不塞进订单的 `status`
 *
 * 物流状态跟订单状态是**正交的两个维度**:
 *
 * - 退过款的单照样发货
 * - 没付钱的单已经寄出
 * - 打印件「生产完成但快递还没揽收」
 *
 * 这跟仓库已有的 `status` / `payment_status` 分列是同一个道理 ——
 * `storefront_order.status` 说的是「这单走到哪一步」,`payment_status` 说的是
 * 「钱到没到」,物流说的是「东西在哪」。三个维度各走各的。
 *
 * ## 状态用**小写**
 *
 * `payment_status`(`unpaid`/`paid`/`refunded`)、`delivery_tier`
 * (`standard`/`express`/`urgent`)、`payment_channel`(`wechat`/`alipay`)全是
 * 小写,新表跟着走。
 *
 * ⚠️ **跟 `print_order.status` 的 `SHIPPED`(大写)是两回事**:
 * 那个是「制作进度」(打印件做到哪一步了),这个是「物流事实」(快递到哪了)。
 *
 * 这个文件是**纯类型** —— 不 import db / React / next,能直接跑单测。
 */

/**
 * 物流挂在哪种订单上
 *
 * 两张订单表的 id 不通用(商城订单的 id 跟打印工单的 id 是两套),所以物流行
 * 必须带这个维度才能定位到是哪一单。
 */
export type ShipmentOrderKind = "storefront" | "print";

/**
 * 物流状态 —— 与 `shipment.status` 列的枚举一一对应
 *
 * - `shipped`   已发货
 * - `delivered` 已签收
 * - `returned`  异常 / 退回
 *
 * `returned` 是**旁路**,不在主线(发货 → 签收)上。
 */
export type ShipmentStatus = "shipped" | "delivered" | "returned";

/**
 * 时间线里谁改的
 *
 * 一期只有后台和系统(没有「用户自己改物流」这回事)。
 */
export type ShipmentActor = "admin" | "system";

/**
 * 买家侧看到的物流
 *
 * 时间戳是 **ISO 字符串** —— 这一份要穿过 API(RSC → JSON)和 RSC props
 * 两条路,`Date` 对象在 JSON 序列化那一步会变成字符串,两边就长得不一样了。
 */
export type ShipmentView = {
  id: string;
  /** 第几个包裹 —— 一个订单可以拆多个包裹(补发 / 分开发) */
  packageIndex: number;
  status: ShipmentStatus;
  /** 快递公司**代码**(清单在 `carriers.ts`) */
  shippingCompany: string;
  /** 选了「其它」时工作室自己填的名字(code = `other` 时才有值) */
  shippingCompanyLabel: string | null;
  /** 运单号(入库前已归一化:全角→半角、去空白、转大写) */
  trackingNumber: string;
  /** 备注 —— 异常原因 / 撤销原因 */
  note: string | null;
  /** 发货时间 —— 建行那一刻定下,回退不重置(列是 NOT NULL,一定有值) */
  shippedAt: string;
  /** 签收时间(null = 还没签收) */
  deliveredAt: string | null;
  /** 异常 / 退回时间(null = 没发生过) */
  returnedAt: string | null;
  /** 最后一次变更时间 —— 轮询的变更检测靠它 */
  updatedAt: string;
};

/**
 * 物流时间线上的一条事件
 *
 * 系统句子不落库:「工作室把这单标成了已签收」由前端按 (actor, from, to)
 * 用 i18n 现场渲染,库里只存人工写的 note。
 */
export type ShipmentEventView = {
  id: string;
  /** 原状态;创建事件为 null */
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  actor: ShipmentActor;
  /** 人工备注;回退 / 异常时必填 */
  note: string | null;
  createdAt: string;
};

/**
 * 失败码 —— 服务端**不抛异常**,一律返这些码
 *
 * 界面按 code 查文案表(`features/shipment/admin/types.ts` 的
 * `SHIPMENT_ERROR_TEXT_KEYS`)。抛异常会被 next-safe-action 糊成「服务器错误」。
 */
export type ShipmentErrorCode =
  /** 订单不存在(或者不是这个订单的) */
  | "ORDER_NOT_FOUND"
  /** 包裹不存在 */
  | "SHIPMENT_NOT_FOUND"
  /** 不允许的状态变化 */
  | "INVALID_TRANSITION"
  /** 这条变更必须写备注 */
  | "NOTE_REQUIRED"
  /** 参数不对(快递公司 / 运单号 / 包裹下标) */
  | "INVALID_INPUT"
  /** 迁移脚本没跑(表不存在) */
  | "MIGRATION_MISSING"
  /** 写库失败 */
  | "SAVE_FAILED";

/**
 * 后台发货台的**一行** = 一个订单(不是一行一个包裹)
 *
 * 商城订单和打印工单**摆在一张表里** —— 工作室一天几十单,拆成两个页面
 * 反而要来回切。
 */
export type AdminShipmentRow = {
  orderKind: ShipmentOrderKind;
  orderId: string;
  orderNo: string;
  /** 摘要:商城 = 商品名;打印 = 模型文件名 */
  summary: string;
  /** 收件人姓名 */
  recipientName: string;
  /** 收件人电话 */
  recipientPhone: string;
  /** 收货地址(**一行**,用 `formatAddressLine()` 拼的) */
  addressLine: string;
  /** 订单金额(分) */
  totalCents: number;
  /** 订单状态(商城 `paid`/`fulfilled`…;打印 `PENDING`/`SHIPPED`…) */
  orderStatus: string;
  /** 收款状态(小写那套) */
  paymentStatus: string;
  /** 这单已经发出去的包裹(按 packageIndex 排) */
  shipments: ShipmentView[];
  /** 下单时间 */
  createdAt: string;
};
