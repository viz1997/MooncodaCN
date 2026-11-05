/**
 * 购物车「同规格」判定 —— 纯函数
 *
 * ## 为什么要有这个文件
 *
 * 购物车落库之前,「同一规格的行合并数量」是靠内存里逐字段比对
 * (`sameAccessories()` + 一串 `===`)做的。落库之后要做这件事只有两条路:
 *
 * - 每次加购都把整个购物车拉下来在内存里比 —— 简单,但多实例部署下两个
 *   请求会同时读到同一份旧数据,合并出两行
 * - 给每个规格算一个**稳定 hash**,`(cart_id, spec_hash)` 上加唯一索引,
 *   让数据库来判重 —— 天然抗并发
 *
 * 走第二条。所以这个文件只干一件事:**把一份规格变成一个稳定的 hash**。
 *
 * ## 「稳定」的两条要求
 *
 * 1. **同样的规格永远算出同样的 hash** —— 字段顺序固定、配件先排序。
 * 2. **不同的规格算出不同的 hash** —— 参与 hash 的字段必须覆盖所有会
 *    改变商品本身的维度。
 *
 * 配件数组要**排序后**再进 hash:配件的挑选顺序不影响商品本身(用户可能
 * 先点底座再点玻璃罩,也可能反过来),但 hash 必须一样,否则同一份配置会
 * 变成两行。
 */

import { createHash } from "node:crypto";

import type { CartLineItemMetadata } from "../types";

/** 参与「同 spec 合并」判断的字段 */
export interface CartSpecInput {
  productId: string;
  materialId: string;
  sizeId: string;
  aiStyleId: string;
  engravingText: string;
  rushOrder: boolean;
  /** 选中的配件变体 id —— **顺序无关** */
  accessoryVariantIds: string[];
  /** AI 预览图 —— 不同预览图是不同商品(用户改图了) */
  previewImage: string;
}

/**
 * 字段之间的分隔符
 *
 * ASCII 单元分隔符 U+001F —— 商品 id / 配件 id / 刻字文本里几乎不可能出现
 * 这个字符。空格不行:刻字文本里就有空格,`["a b", "c"]` 和 `["a", "b c"]`
 * 拼出来一样,两件不同的商品会算出同一个 hash。
 */
const FIELD_SEPARATOR = String.fromCharCode(31);

/**
 * 把配件 id 排序
 *
 * 排序用 `localeCompare` 的默认序就够了 —— 这里要的是「同一个集合 →
 * 同一个顺序」,不是「按中文习惯排序」。
 */
export function sortAccessoryIds(ids: string[] | null | undefined): string[] {
  return [...(ids ?? [])].sort();
}

/**
 * 算规格 hash
 *
 * sha256 取前 16 个 hex 字符 —— 128 bit,碰撞概率在本仓库的量级下可以忽略。
 */
export function computeSpecHash(input: CartSpecInput): string {
  const parts = [
    input.productId,
    input.materialId,
    input.sizeId,
    input.aiStyleId,
    input.engravingText,
    input.rushOrder ? "1" : "0",
    sortAccessoryIds(input.accessoryVariantIds).join(","),
    input.previewImage,
  ];

  return createHash("sha256")
    .update(parts.join(FIELD_SEPARATOR))
    .digest("hex")
    .slice(0, 16);
}

/**
 * 从 line item 的 metadata 算 hash
 *
 * `metadata` 是购物车行里存的规格快照 —— 直接拿它算,不用再拼一遍。
 */
export function computeSpecHashFromMetadata(
  metadata: CartLineItemMetadata
): string {
  return computeSpecHash({
    productId: metadata.productId,
    materialId: metadata.materialId,
    sizeId: metadata.sizeId,
    aiStyleId: metadata.aiStyleId,
    engravingText: metadata.engravingText,
    rushOrder: metadata.rushOrder,
    accessoryVariantIds: metadata.accessoryVariantIds ?? [],
    previewImage: metadata.previewImage,
  });
}

/**
 * 两份规格是否一致
 *
 * hash 相同 ⇔ 规格一致。留这个函数是为了让调用点的意图更清楚 ——
 * 「这两行能不能合并」比「这两个 hash 一不一样」好读。
 */
export function isSameSpec(a: CartSpecInput, b: CartSpecInput): boolean {
  return computeSpecHash(a) === computeSpecHash(b);
}
