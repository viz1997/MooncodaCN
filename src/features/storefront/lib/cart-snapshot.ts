/**
 * 「这单买了什么」的快照 —— 纯函数
 *
 * ## 干什么
 *
 * 购物车改成「**付款成功才清空**」之后,有两件事要靠它:
 *
 * 1. **复用**:购物车现在装的 == 某一单已经买了的 → 那一单直接复用
 *    (用户没付钱又回来点一次「去支付」,不该攒出两张一样的单)
 * 2. **摘除**:付款成功后 → 把**买掉的那些行**从购物车里摘掉(别的行留着)
 *
 * 两件事都要一个「行的集合」的表示 —— 规格 hash + 数量。
 *
 * ## 为什么用 hash 而不是逐字段比
 *
 * hash 就是「同 spec 合并」的判据(见 `cart-spec.ts`)—— 同一份规格永远算出
 * 同一个 hash,不同的两份一定不同。逐字段比要自己照顾「配件顺序无关」
 * 「打印服务走另一套字段」这些细节,hash 已经把它们都算进去了。
 *
 * ## 顺序无关
 *
 * 购物车的行按创建时间排,订单的行按插入顺序排 —— 两者不一定一样。所以
 * 比较之前先按 hash 排序。
 */

import type { ShippingAddressSnapshot } from "@/db/schema";

import type { CartLineItemMetadata } from "../types";

import { computeSpecHashForLine } from "./cart-spec";

/** 一行的快照 */
export interface LineSnapshot {
  /** 规格 hash */
  specHash: string;
  /** 数量 */
  quantity: number;
}

/** 能算快照的一行 */
export interface SnapshotLine {
  /** 服务端解析过的 product id */
  productId: string;
  /** 规格快照 */
  metadata: CartLineItemMetadata;
  /** 数量 */
  quantity: number;
}

/**
 * 把若干行算成快照(按 hash 排序 —— 顺序无关)
 */
export function buildLineSnapshot(lines: SnapshotLine[]): LineSnapshot[] {
  return lines
    .map((line) => ({
      specHash: computeSpecHashForLine({
        productId: line.productId,
        metadata: line.metadata,
      }),
      quantity: line.quantity,
    }))
    .sort((a, b) =>
      a.specHash < b.specHash ? -1 : a.specHash > b.specHash ? 1 : 0
    );
}

/**
 * 两份快照是不是同一批货
 *
 * 行数一样、每一行的 hash 一样、数量一样 —— 就算同一批。
 */
export function isSameLineSnapshot(
  a: LineSnapshot[],
  b: LineSnapshot[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      other.specHash === line.specHash &&
      other.quantity === line.quantity
    );
  });
}

/**
 * 两个收货地址是不是同一个
 *
 * 逐字段比 —— 收货地址是**快照**(下单那一刻存下来的),没有 id 可比。
 *
 * `district` 有可能是 `undefined`(直辖市那一档地址没有区),所以比之前
 * 统一按空串处理 —— `undefined` 和 `""` 是同一个意思。
 */
export function isSameAddress(
  a: ShippingAddressSnapshot | null | undefined,
  b: ShippingAddressSnapshot | null | undefined
): boolean {
  if (!a || !b) return false;
  return (
    a.recipientName === b.recipientName &&
    a.phone === b.phone &&
    a.province === b.province &&
    a.city === b.city &&
    (a.district ?? "") === (b.district ?? "") &&
    a.detail === b.detail
  );
}
