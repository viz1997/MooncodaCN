/**
 * 收货地址 —— 读
 *
 * 全部按 userId 过滤 —— 地址是私密的,任何漏掉 userId 的查询都是越权。
 */

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { type AddressRow, address } from "@/db/schema";

import type { AddressView } from "./types";

function toView(row: AddressRow): AddressView {
  return {
    id: row.id,
    recipientName: row.recipientName,
    phone: row.phone,
    province: row.province,
    city: row.city,
    district: row.district,
    detail: row.detail,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 列出某个用户的地址
 *
 * 排序:默认地址排最前,其余按创建时间倒序。
 */
export async function listUserAddresses(
  userId: string
): Promise<AddressView[]> {
  const rows = await db
    .select()
    .from(address)
    .where(eq(address.userId, userId))
    .orderBy(desc(address.isDefault), desc(address.createdAt));

  return rows.map(toView);
}

/**
 * 取某一条地址 —— **归属校验在这里**
 *
 * 别人的地址一律当「不存在」(404),不返回「无权限」—— 不该告诉调用方
 * 「这个 id 存在,只是不是你的」。
 */
export async function getUserAddress(
  userId: string,
  addressId: string
): Promise<AddressView | null> {
  const rows = await db
    .select()
    .from(address)
    .where(eq(address.id, addressId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== userId) return null;
  return toView(row);
}

/**
 * 默认地址(没有默认的就取最近建的那条)
 *
 * 结算页预选用。
 */
export async function getDefaultAddress(
  userId: string
): Promise<AddressView | null> {
  const rows = await db
    .select()
    .from(address)
    .where(eq(address.userId, userId))
    .orderBy(desc(address.isDefault), desc(address.createdAt))
    .limit(1);

  const row = rows[0];
  return row ? toView(row) : null;
}
