/**
 * 订单的收款状态转移 —— **纯函数**
 *
 * ## 为什么单独一个文件
 *
 * 状态转移的**判断**和状态转移的**落库**是两件事。判断决定「这次回调
 * 该改什么、不该改什么」,落库只是把判断结果写进 Drizzle。
 *
 * 判断这部分是最容易出错的地方 —— 里面藏着两条血淋淋的教训:
 *
 * 1. **退款不是订单状态**。退款只改 `paymentStatus`,`status` 留在原地。
 *    早先只有一列 `status` 的时候,退款把订单写成了「已取消」,用户看着
 *    像没买过。
 * 2. **迟到的收款通知不能把退过款的单改回「已支付」**。webhook 会重投,
 *    投递顺序也不保证。
 *
 * 这两条都值得有测试盯着。所以判断抽成纯函数(零 DB 依赖,能进 `unit`
 * project),落库留在 `settle.ts`。
 *
 * ## 为什么跟支付通道无关
 *
 * 微信 / 支付宝 / Shopify / 旧的 Sellbase —— 四个通道的回调最终都落到
 * 同一套判断上。「退款不是订单状态」「迟到的通知不改回来」这两条规矩
 * 不能每个通道各写一遍,写一遍就漏一遍。
 *
 * ## 两个状态是正交的
 *
 * | 列 | 含义 | 取值 |
 * |---|---|---|
 * | `status` | 订单走到哪一步 | `unpaid` / `paid` / `fulfilled` / `cancelled` |
 * | `paymentStatus` | 钱到没到、退没退 | `unpaid` / `paid` / `refunded` / `failed` |
 *
 * 合法的组合有 `status=paid` + `paymentStatus=refunded`(退过款的单)、
 * `status=cancelled` + `paymentStatus=paid`(先付后取消)。
 */

/** 商城订单当前的状态(两个维度) */
export interface StorefrontOrderState {
  /** 订单状态 */
  status: string;
  /** 支付状态 */
  paymentStatus: string;
}

/** webhook 能触发的三种支付动作 */
export type StorefrontPaymentKind =
  | "mark_paid"
  | "mark_refunded"
  | "mark_cancelled";

/**
 * 转移的结果
 *
 * - `apply` —— 按 `setStatus` / `setPaymentStatus` / `markPaidAt` 写库
 * - `skip` —— 什么都不写(`reason` 给日志看)
 */
export type StorefrontTransitionDecision =
  | {
      kind: "apply";
      /** 要写的订单状态;不写就是不动它 */
      setStatus?: "paid" | "cancelled";
      /** 要写的支付状态;不写就是不动它 */
      setPaymentStatus?: "paid" | "refunded";
      /** 要不要写 `paid_at` */
      markPaidAt: boolean;
    }
  | {
      kind: "skip";
      reason: string;
    };

/**
 * 判断一次 webhook 动作对商城订单意味着什么
 *
 * **幂等**:同样的输入永远得到同样的输出 —— 重投一次和重投十次,结果一样。
 */
export function decideStorefrontTransition(
  order: StorefrontOrderState,
  action: StorefrontPaymentKind
): StorefrontTransitionDecision {
  switch (action) {
    case "mark_paid": {
      // 已经付过了 —— 重投,不动
      if (order.paymentStatus === "paid") {
        return { kind: "skip", reason: "已经标记过收款" };
      }
      // 退过款的单不改回来(迟到的 paid 事件)
      if (order.paymentStatus === "refunded") {
        return { kind: "skip", reason: "订单已退款,忽略迟到的收款事件" };
      }
      // 已取消的单不改回来
      if (order.status === "cancelled") {
        return { kind: "skip", reason: "订单已取消,忽略收款事件" };
      }
      return {
        kind: "apply",
        setStatus: "paid",
        setPaymentStatus: "paid",
        markPaidAt: true,
      };
    }

    case "mark_refunded": {
      if (order.paymentStatus === "refunded") {
        return { kind: "skip", reason: "已经标记过退款" };
      }
      // 只动支付状态 —— 订单本身留着(status 不改)
      return { kind: "apply", setPaymentStatus: "refunded", markPaidAt: false };
    }

    case "mark_cancelled": {
      if (order.status === "cancelled") {
        return { kind: "skip", reason: "订单已经取消过了" };
      }
      // 取消只动订单状态 —— 钱怎么样是另一回事(退不退款看退款事件)
      return { kind: "apply", setStatus: "cancelled", markPaidAt: false };
    }

    default:
      return { kind: "skip", reason: "不处理的动作" };
  }
}

/* -------------------------------------------------------------------------- */
/*  挂在商城订单下的工单                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 挂在商城订单下面的打印工单 —— 只需要支付状态
 *
 * 走商城购物车结算的打印服务行,工单挂 `print_order.storefront_order_id`
 * 上(整张购物车共用**一张**支付订单,`provider_order_id` 那类列是唯一索引,
 * 挂不上去)。
 */
export interface LinkedPrintOrderState {
  /** 支付状态 */
  paymentStatus: string;
}

/**
 * 「这张工单跟着商城订单一起变」的决定
 *
 * - `apply` —— 按 `setPaymentStatus` / `markPaidAt` 写库
 * - `cancel_via_state_machine` —— 取消要走状态机(时间线上要留一条事件)
 * - `skip` —— 什么都不写
 */
export type LinkedPrintOrderDecision =
  | {
      kind: "apply";
      /** 要写的支付状态 */
      setPaymentStatus: "paid" | "refunded";
      /** 要不要写 `paid_at` */
      markPaidAt: boolean;
      /** 要不要写 `payment_channel` */
      setPaymentChannel: boolean;
    }
  | { kind: "cancel_via_state_machine" }
  | { kind: "skip"; reason: string };

/**
 * 判断一次 webhook 动作对「挂在商城订单下的工单」意味着什么
 *
 * ## 口径跟独立的工单、跟商城订单**完全一致**
 *
 * - 已经付过了 → 重投,不动
 * - 退过款的 → 迟到的收款通知不能把它改回「已支付」
 *
 * 钱是**整单收**的:商城订单一付款,挂在它下面的所有工单一起变成已付款。
 * 工单还停在「未付款」的话,工作室点「开始生产」会被 PAYMENT_REQUIRED
 * 挡住 —— 单子卡住。
 */
export function decideLinkedPrintOrderTransition(
  order: LinkedPrintOrderState,
  action: StorefrontPaymentKind
): LinkedPrintOrderDecision {
  switch (action) {
    case "mark_paid": {
      if (order.paymentStatus === "paid") {
        return { kind: "skip", reason: "工单已经标记过收款" };
      }
      if (order.paymentStatus === "refunded") {
        return { kind: "skip", reason: "工单已退款,忽略迟到的收款事件" };
      }
      return {
        kind: "apply",
        setPaymentStatus: "paid",
        markPaidAt: true,
        setPaymentChannel: true,
      };
    }

    case "mark_refunded": {
      if (order.paymentStatus === "refunded") {
        return { kind: "skip", reason: "工单已经标记过退款" };
      }
      return {
        kind: "apply",
        setPaymentStatus: "refunded",
        markPaidAt: false,
        setPaymentChannel: false,
      };
    }

    case "mark_cancelled": {
      // 取消要走状态机 —— 时间线上要留一条事件,用户看得见
      return { kind: "cancel_via_state_machine" };
    }

    default:
      return { kind: "skip", reason: "不处理的动作" };
  }
}
