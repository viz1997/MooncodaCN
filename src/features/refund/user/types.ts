/**
 * 买家侧退款的类型 —— **纯类型**模块
 *
 * ## 为什么不放在 `actions.ts` 里
 *
 * `actions.ts` 是 **`"use server"`** 文件 —— Turbopack 会把它的**所有 export**
 * 都当成 server action 去注册,**包括带 specifier 的类型 re-export**
 * (`export type { X }`)。编译产物里会去引用一个编译期已被擦掉的类型绑定 ⇒
 * 运行时 `ReferenceError` ⇒ **整个页面 500**。
 *
 * 所以类型住在**单独的纯类型文件**里,客户端组件从这儿 import
 * (类型导入编译期擦掉,不进 bundle)。
 *
 * 仓库里有测试守着这条规矩:`src/test/repo/pure/use-server-exports.test.ts`。
 */

import type {
  RefundErrorCode,
  RefundIneligibleCode,
  RefundView,
} from "../lib/types";

/**
 * 申请退款失败的机器可读原因
 *
 * 两个来源合在一起:
 *
 * - `RefundErrorCode` —— 数据层 / 存储层的失败(写库失败、迁移没跑…)
 * - `RefundIneligibleCode` —— **这一单不符合退款条件**的具体原因
 *   (没付款 / 生产已经开始 / 已发货 / 已经申请过了)
 *
 * 界面按 code 查文案表 ⇒ 买家看到的是「为什么不能退」,不是一句「操作失败」。
 */
export type RequestRefundErrorCode = RefundErrorCode | RefundIneligibleCode;

/** 申请退款的返回 */
export type RequestRefundResult =
  | { ok: true; refund: RefundView }
  | { ok: false; code: RequestRefundErrorCode };
