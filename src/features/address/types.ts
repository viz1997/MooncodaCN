/**
 * 收货地址 —— 类型
 *
 * ## 为什么地址簿整个留在本仓库
 *
 * Sellbase 的 `customer.addresses` 是**只读**的 —— 没有创建地址的路由。
 * 地址建在本仓库,下单时把**快照**一起发给 Sellbase(它只当一个字段存着)。
 *
 * ## 快照而不是外键
 *
 * 订单上的地址是**下单那一刻**的事实。用户后来改地址簿,不该改写历史订单
 * 的收货地址 —— 包裹已经按老地址发出去了。所以订单存快照,不走外键。
 */

/** 地址表单输入 */
export interface AddressInput {
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  /** 是否设为默认地址 */
  isDefault?: boolean | undefined;
}

/**
 * 失败的机器可读原因
 *
 * ## 为什么住在 types.ts 而不是 mutations.ts
 *
 * 客户端组件(`checkout-view.tsx` / `address-book.tsx`)要拿这个类型做
 * 「code → 文案」的映射。它们从 `actions.ts`(`"use server"`)导入**类型**
 * 没问题(类型导入会被编译期擦掉),但 `actions.ts` 自己**不能再往外 re-export
 * 类型** —— 见那个文件头的说明:Turbopack 会把 `export type { X }` 当成
 * server action 注册,运行时去引用一个不存在的类型绑定,直接
 * `ReferenceError: AddressErrorCode is not defined`。
 *
 * 所以类型的「家」是 types.ts(纯类型,客户端安全),`mutations.ts` 只是
 * 顺手再 export 一遍,方便服务端那边从 mutations 一把 import 齐。
 */
export type AddressErrorCode =
  | "ADDRESS_NOT_FOUND"
  | "INVALID_INPUT"
  | "TOO_MANY_ADDRESSES"
  | "FAILED";

/**
 * 写操作的结果
 *
 * 业务失败是**返回** `{ok:false, code}` 而不是 throw —— throw 的话
 * next-safe-action 的 `handleServerError` 会把原因糊成「服务器错误」,
 * 用户看不到「手机号格式不对」这种能照着改的信息。
 */
export type AddressMutationResult =
  | { ok: true; addressId: string }
  | { ok: false; code: AddressErrorCode };

/** 地址簿里的一条(带 id) */
export interface AddressView extends AddressInput {
  id: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 地址 → 一行「省市区 + 详细地址」
 *
 * 空的部分不拼进去(有些用户只填到市)。
 */
export function formatAddressLine(address: {
  province: string;
  city: string;
  district: string;
  detail: string;
}): string {
  return [address.province, address.city, address.district, address.detail]
    .filter((part) => part.trim().length > 0)
    .join(" ");
}
