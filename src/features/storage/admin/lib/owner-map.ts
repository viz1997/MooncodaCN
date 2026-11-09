/**
 * 后台文件管理 —— **归属反查**(纯函数)
 *
 * ## 要解决什么
 *
 * 桶里的对象键**不含 userId**。工作室看到一个目录叫
 * `a08b4fd7fed13968/`,认不出是谁传的 —— 那 16 位是
 * `sha256(userId)` 的前 16 位(见 `print-quote/lib/upload-key.ts`)。
 *
 * sha256 不可逆,但**用户表是有限的** —— 把表里每个 userId 都算一遍哈希,
 * 建一张「哈希 → 用户」的表,就能反查。这是**枚举**,不是破解。
 *
 * ## 三种归属形状
 *
 * | 键的形状 | 怎么认 |
 * |---|---|
 * | `print-orders/<scope>/…` | `<scope>` 是哈希 → 查 `byScope` |
 * | `user-uploads/<userId>/…` | 直接就是 userId → 查 `byId` |
 * | `canvas/results/<userId>/…` | 同上 |
 * | 其它(`gpt-image/` / `orders/` / `public-uploads/` …) | 认不出来 → null |
 *
 * `gpt-image/` 那一支是**订单 token**,不是 userId —— 那要连订单表反查,
 * 不在这一版的范围里(界面上就是「—」)。
 *
 * ## 哈希必须用同一份函数
 *
 * 目录名是上传那一步用 `printOrderScope()` 算出来的。这里**必须 import 同一个
 * 函数**,自己另写一份 sha256 的话,两边对不上,谁也认不出谁。
 */

import { printOrderScope } from "@/features/print-quote/lib/upload-key";
import type { AdminFileOwner } from "@/features/storage/admin/types";
import { printOrderScopeFromKey, rawUserIdFromKey } from "./paths";

/**
 * 归属索引 —— 两张表
 *
 * `byId` 存裸 userId,`byScope` 存分区哈希。
 */
export interface OwnerIndex {
  byId: Map<string, AdminFileOwner>;
  byScope: Map<string, AdminFileOwner>;
}

/** 建索引要的那点用户信息 */
export interface OwnerIndexUser {
  id: string;
  name: string;
  email: string;
}

/**
 * 建归属索引
 *
 * 用户表有几行就算几行 —— 每个 userId 一次 sha256,微秒级的事。
 */
export function buildOwnerIndex(users: OwnerIndexUser[]): OwnerIndex {
  const byId = new Map<string, AdminFileOwner>();
  const byScope = new Map<string, AdminFileOwner>();

  for (const u of users) {
    const owner: AdminFileOwner = {
      id: u.id,
      name: u.name,
      email: u.email,
    };
    byId.set(u.id, owner);
    // 同一个哈希撞两个用户 —— 概率为零,但真撞了保留先来的那个
    // (别静默覆盖:那是另一个人的文件了)
    const scope = printOrderScope(u.id);
    if (!byScope.has(scope)) byScope.set(scope, owner);
  }

  return { byId, byScope };
}

/**
 * 从对象键认出归属
 *
 * 认不出来返回 null —— 界面摆「—」,**不猜**。
 */
export function resolveFileOwner(
  key: string,
  index: OwnerIndex
): AdminFileOwner | null {
  const rawId = rawUserIdFromKey(key);
  if (rawId) return index.byId.get(rawId) ?? null;

  const scope = printOrderScopeFromKey(key);
  if (scope) return index.byScope.get(scope) ?? null;

  return null;
}
