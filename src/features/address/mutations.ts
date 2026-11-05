/**
 * 收货地址 —— 写操作(跟调用方无关)
 *
 * ## 为什么单独一个文件
 *
 * 地址的写操作有两类调用方:
 *
 * - **Web**(server action)—— `src/features/address/actions.ts`
 * - **小程序 / HTTP**(route handler)—— `src/app/api/store/addresses/`
 *
 * 两条路的校验规则、默认地址的互斥逻辑必须**一模一样**。写两份的话改一处
 * 忘一处,最典型的是「默认地址只有一个」那条约束 —— 两边各写一遍,总有一边
 * 忘了先把别人的默认置掉。
 *
 * 所以这里放**纯业务逻辑**(不认识 HTTP,也不认识 next-safe-action),调用方
 * 只负责「把入参变成 userId + 字段」。
 *
 * ## 归属校验在数据层
 *
 * 所有写操作都按 `userId` 过滤 —— 入参里**没有** userId,客户端说了不算。
 * 别人的地址一律当「不存在」。
 *
 * ## 默认地址只有一个
 *
 * 没有做「唯一默认地址」的数据库约束 —— 那个约束在并发下很难做对,
 * 而默认地址选错的后果很轻(用户能改)。这里的做法是:设默认时先把该用户
 * 其它地址的 `isDefault` 置 false,再把这一条置 true。
 */

import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@/db";
import { address } from "@/db/schema";

import type { AddressErrorCode, AddressMutationResult } from "./types";

// 类型的「家」在 types.ts —— 这里再 export 一遍,服务端(API 路由)就能
// 从 mutations 一把 import 齐。注意:**别把这个 re-export 搬到
// actions.ts**("use server" 模块 re-export 类型会被 Turbopack 当成
// server action 注册,运行时 ReferenceError)。
export type { AddressErrorCode, AddressMutationResult };

/* -------------------------------------------------------------------------- */
/*  校验                                                                      */
/* -------------------------------------------------------------------------- */

/** 手机号:先按国内手机号收,以后要国际号码再放宽 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "请填写手机号")
  .max(32, "手机号太长了")
  .regex(/^[0-9+\-\s()]{6,32}$/, "手机号格式不对");

/** 地址的公共字段 */
export const addressFields = {
  recipientName: z.string().trim().min(1, "请填写收件人").max(64),
  phone: phoneSchema,
  province: z.string().trim().min(1, "请填写省份").max(64),
  city: z.string().trim().min(1, "请填写城市").max(64),
  district: z.string().trim().max(64).default(""),
  detail: z.string().trim().min(1, "请填写详细地址").max(256),
};

/** 新建地址 */
export const createAddressSchema = z.object({
  ...addressFields,
  isDefault: z.boolean().optional(),
});

/** 改地址 */
export const updateAddressSchema = z.object({
  addressId: z.string().min(1),
  ...addressFields,
  isDefault: z.boolean().optional(),
});

/** 只带地址 id 的操作(设默认 / 删) */
export const addressIdSchema = z.object({ addressId: z.string().min(1) });

/* -------------------------------------------------------------------------- */
/*  结果                                                                      */
/* -------------------------------------------------------------------------- */

/** 一个人最多存多少个地址 —— 挡一下「脚本批量灌地址」 */
export const MAX_ADDRESSES = 20;

/* -------------------------------------------------------------------------- */
/*  写                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 新建地址
 *
 * 第一条地址自动成为默认地址 —— 用户第一次填地址,结算页就该有预选项。
 */
export async function createAddressForUser(
  userId: string,
  input: {
    recipientName: string;
    phone: string;
    province: string;
    city: string;
    district: string;
    detail: string;
    // `| undefined` 是为了配合 `exactOptionalPropertyTypes` —— zod 推出来的
    // 可选字段类型是 `boolean | undefined`,不是「可能缺省」
    isDefault?: boolean | undefined;
  }
): Promise<AddressMutationResult> {
  try {
    const existing = await db
      .select({ id: address.id })
      .from(address)
      .where(eq(address.userId, userId));

    if (existing.length >= MAX_ADDRESSES) {
      return { ok: false, code: "TOO_MANY_ADDRESSES" };
    }

    const isDefault = input.isDefault ?? existing.length === 0;
    const now = new Date();
    const id = `addr_${nanoid(16)}`;

    await db.transaction(async (tx) => {
      if (isDefault) {
        // 别人的默认地址先让位 —— 保证「只有一个默认」
        await tx
          .update(address)
          .set({ isDefault: false, updatedAt: now })
          .where(and(eq(address.userId, userId), eq(address.isDefault, true)));
      }
      await tx.insert(address).values({
        id,
        userId,
        recipientName: input.recipientName,
        phone: input.phone,
        province: input.province,
        city: input.city,
        district: input.district,
        detail: input.detail,
        isDefault,
        createdAt: now,
        updatedAt: now,
      });
    });

    return { ok: true, addressId: id };
  } catch {
    return { ok: false, code: "FAILED" };
  }
}

/**
 * 改地址
 */
export async function updateAddressForUser(
  userId: string,
  input: {
    addressId: string;
    recipientName: string;
    phone: string;
    province: string;
    city: string;
    district: string;
    detail: string;
    isDefault?: boolean | undefined;
  }
): Promise<AddressMutationResult> {
  try {
    // 归属校验:别人的地址当「不存在」
    const owned = await db
      .select({ id: address.id })
      .from(address)
      .where(and(eq(address.id, input.addressId), eq(address.userId, userId)))
      .limit(1);

    if (!owned[0]) return { ok: false, code: "ADDRESS_NOT_FOUND" };

    const now = new Date();
    const isDefault = input.isDefault ?? false;

    await db.transaction(async (tx) => {
      if (isDefault) {
        await tx
          .update(address)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(address.userId, userId),
              ne(address.id, input.addressId),
              eq(address.isDefault, true)
            )
          );
      }
      await tx
        .update(address)
        .set({
          recipientName: input.recipientName,
          phone: input.phone,
          province: input.province,
          city: input.city,
          district: input.district,
          detail: input.detail,
          ...(input.isDefault !== undefined
            ? { isDefault: input.isDefault }
            : {}),
          updatedAt: now,
        })
        .where(eq(address.id, input.addressId));
    });

    return { ok: true, addressId: input.addressId };
  } catch {
    return { ok: false, code: "FAILED" };
  }
}

/**
 * 设成默认地址
 */
export async function setDefaultAddressForUser(
  userId: string,
  addressId: string
): Promise<AddressMutationResult> {
  try {
    const owned = await db
      .select({ id: address.id })
      .from(address)
      .where(and(eq(address.id, addressId), eq(address.userId, userId)))
      .limit(1);

    if (!owned[0]) return { ok: false, code: "ADDRESS_NOT_FOUND" };

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(address)
        .set({ isDefault: false, updatedAt: now })
        .where(and(eq(address.userId, userId), eq(address.isDefault, true)));
      await tx
        .update(address)
        .set({ isDefault: true, updatedAt: now })
        .where(eq(address.id, addressId));
    });

    return { ok: true, addressId };
  } catch {
    return { ok: false, code: "FAILED" };
  }
}

/**
 * 删地址
 *
 * 删掉的是**地址簿**里的那一条。历史订单上的地址是快照,不受影响。
 */
export async function deleteAddressForUser(
  userId: string,
  addressId: string
): Promise<AddressMutationResult> {
  try {
    const deleted = await db
      .delete(address)
      .where(and(eq(address.id, addressId), eq(address.userId, userId)))
      .returning({ id: address.id });

    if (deleted.length === 0) return { ok: false, code: "ADDRESS_NOT_FOUND" };

    return { ok: true, addressId };
  } catch {
    return { ok: false, code: "FAILED" };
  }
}
