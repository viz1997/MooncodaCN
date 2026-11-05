"use server";

/**
 * 收货地址 —— server action(Web 侧)
 *
 * ## 业务失败**返回**而不是 throw
 *
 * next-safe-action 的 `handleServerError` 在生产环境会把任何异常糊成
 * 「服务器错误,请稍后重试」。用户填错手机号应该看到「手机号格式不对」,
 * 所以这里返回 `{ok:false, code}`,让前端按 code 找文案。
 *
 * ## 逻辑不在这个文件里
 *
 * 真正的写操作在 `mutations.ts` —— 小程序侧的 HTTP 路由也调它。两边共用
 * 一份,「默认地址只有一个」那种约束才不会被改漏。
 *
 * ## 归属校验在数据层
 *
 * 所有写操作都按 `ctx.userId` 过滤 —— action 的入参里**没有** userId,
 * 客户端说了不算。
 *
 * ## **别从「use server」文件里 re-export 类型**
 *
 * 之前这里有一行 `export type { AddressErrorCode };`,看着人畜无害,结果把
 * 整个结算页搞崩了:
 *
 * ```
 * ReferenceError: AddressErrorCode is not defined
 * ```
 *
 * 原因:Turbopack 的 `"use server"` 转换把**所有 export** 都当成 server
 * action 去注册 —— 包括 `export type { X }` 这种类型 re-export。编译产物
 * 长这样:
 *
 * ```js
 * /* __next_internal_action_entry_do_not_use__ [... "7f876a04...":"AddressErrorCode"] *\/
 * AddressErrorCode,                                  // ← 运行时去引用一个类型
 * registerServerReference(AddressErrorCode, "7f876a04...", null);
 * ```
 *
 * 类型在编译期就被擦掉了,运行时根本没有这个绑定 → 引用即抛。
 * 表现是**页面直接 500**(不是某个 action 报错)—— server actions loader
 * 在模块求值阶段就炸了。
 *
 * 规矩:`"use server"` 文件只导出 **async 函数**。类型放 `types.ts`,
 * 客户端组件从那儿 import(类型导入编译期就擦掉了,不进 bundle)。
 *
 * (本地的 `export type X = ...` 类型别名是安全的 —— 被擦的是 re-export
 *  那种带 specifier 的形式。)
 */

import { protectedAction } from "@/lib/safe-action";

import {
  addressIdSchema,
  createAddressForUser,
  createAddressSchema,
  deleteAddressForUser,
  setDefaultAddressForUser,
  updateAddressForUser,
  updateAddressSchema,
} from "./mutations";
import type { AddressMutationResult } from "./types";

export type AddressActionResult = AddressMutationResult;

const withAddressAction = (name: string) =>
  protectedAction.metadata({ action: `address.${name}` });

/**
 * 新建地址
 *
 * 第一条地址自动成为默认地址 —— 用户第一次填地址,结算页就该有预选项。
 */
export const createAddressAction = withAddressAction("create")
  .schema(createAddressSchema)
  .action(
    async ({ parsedInput, ctx }): Promise<AddressActionResult> =>
      createAddressForUser(ctx.userId, parsedInput)
  );

/**
 * 改地址
 */
export const updateAddressAction = withAddressAction("update")
  .schema(updateAddressSchema)
  .action(
    async ({ parsedInput, ctx }): Promise<AddressActionResult> =>
      updateAddressForUser(ctx.userId, parsedInput)
  );

/**
 * 设成默认地址
 */
export const setDefaultAddressAction = withAddressAction("setDefault")
  .schema(addressIdSchema)
  .action(
    async ({ parsedInput, ctx }): Promise<AddressActionResult> =>
      setDefaultAddressForUser(ctx.userId, parsedInput.addressId)
  );

/**
 * 删地址
 *
 * 删掉的是**地址簿**里的那一条。历史订单上的地址是快照,不受影响。
 */
export const deleteAddressAction = withAddressAction("delete")
  .schema(addressIdSchema)
  .action(
    async ({ parsedInput, ctx }): Promise<AddressActionResult> =>
      deleteAddressForUser(ctx.userId, parsedInput.addressId)
  );
