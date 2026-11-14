/**
 * 后台退款管理的**视图模型 + 错误码联合类型**
 *
 * ## 为什么类型不住在 `"use server"` 文件里
 *
 * `admin/actions.ts` 是 `"use server"` —— Turbopack 会把那个文件里**所有
 * 导出**注册成 server action。`export type { X }` / `export { type X }` 这种
 * **再导出**会被注册成一个**不存在的 action** ⇒ 运行时 `ReferenceError`
 * ⇒ **整页 500**。
 *
 * ⇒ 类型全部搬到这个**不是** `"use server"` 的文件里。仓库有
 * `src/test/repo/pure/use-server-exports.test.ts` 守着这条。
 *
 * ## 错误码跟买家侧**共用一批**
 *
 * `RefundErrorCode` 是共享的 —— 买家侧的「申请退款」和后台的「处理退款」
 * 返回的是**同一批 code**,文案表也只有一张(`features/refund/lib/error-text.ts`
 * 的 `refundErrorTextKey`)。后台另开一个 `AdminRefund` 命名空间,只放
 * **后台那一层的外壳**(标题 / 按钮 / 列名),错误文案仍然查 `Refund.errors.*`
 * ⇒ **一张表,一个来源**。
 */

/**
 * 后台退款管理的失败码 —— 跟买家侧**同一批**
 *
 * 界面按 code 查文案(`Refund.errors.<code>`),查不到退回 `errors.FAILED`。
 */
import type {
  AdminRefundRow,
  RefundStatus,
} from "@/features/refund/lib/types";

export type AdminRefundErrorCode =
  | "ORDER_NOT_FOUND"
  | "REFUND_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "NOTE_REQUIRED"
  | "INVALID_INPUT"
  | "NOT_REFUNDABLE"
  | "REQUEST_EXISTS"
  | "REFUND_NOT_SUPPORTED"
  | "PROVIDER_REJECTED"
  | "REFUND_PROCESSING"
  | "MIGRATION_MISSING"
  | "SAVE_FAILED";

/**
 * 平台退款 API 的结果 —— 只有「执行退款」那一步才有
 *
 * - `succeeded` —— 钱退了(本地状态直接落 `refunded`)
 * - `processing` —— 钱还在路上(等平台的异步通知)
 */
export type AdminRefundProviderStatus = "succeeded" | "processing";

/**
 * 后台列表的结果
 */
export type AdminRefundListResult =
  | { ok: true; rows: AdminRefundRow[] }
  | { ok: false; code: AdminRefundErrorCode };

/**
 * 后台写操作的结果
 *
 * ## `detail` 是**平台给的原文**
 *
 * 「执行退款」被拒的时候,平台会回一句原因(「订单不存在」「余额不足」…)
 * ⇒ 原样带回来,工作室一眼能看出是哪边的问题。**不要自己改写它** ——
 * 改写了就等于把平台的原话丢了。
 */
export type AdminRefundWriteResult =
  | {
      ok: true;
      /** 退款申请行的 id */
      refundId: string;
      /** 状态**真的**变了吗 —— 重复点同一个按钮是 false */
      changed: boolean;
      /** 平台那一边的结果 —— 只有「执行退款」才有 */
      providerStatus?: AdminRefundProviderStatus;
      /** 平台侧的退款单号 */
      providerRefundId?: string | null;
      /** 平台给的原文 / 补充说明 */
      detail?: string | null;
    }
  | {
      ok: false;
      code: AdminRefundErrorCode;
      /** 平台给的原文(被拒 / 通道没配好的时候) */
      detail?: string | null;
    };

/**
 * 列表筛选 —— `all` 是「全部」
 *
 * 其余四个就是 `RefundStatus` —— 跟状态机的四档一一对应。
 */
export type AdminRefundFilter = RefundStatus | "all";

/**
 * ⚠️ **这里的再导出是安全的**
 *
 * 本文件**不是** `"use server"` ⇒ Turbopack 不会把它里的导出注册成
 * server action。(危险的是 `"use server"` 文件里的再导出。)
 *
 * 组件只从 `admin/types.ts` import —— 别改成从 `admin/actions.ts` import,
 * 那边再导出会炸。
 */
export type {
  AdminRefundRow,
  RefundOrderKind,
  RefundStatus,
} from "@/features/refund/lib/types";
