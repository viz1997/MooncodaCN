/**
 * 「本站商品 → 淘宝链接」的读写
 *
 * ## 这张表管什么
 *
 * 买家在结算页选「淘宝下单」⇒ 跳到这件设计对应的淘宝商品页 ⇒ 在淘宝付款。
 * 工作室在淘宝后台看到钱到了,再回本仓库把那笔单**手工标成已收款**
 * (见 `storefront_order.external_paid_cents`)。
 *
 * 键是 **handle**(商城那件设计的 id)—— 不是型号 id:
 * `product` 表是**型号**级的(6 行),商城卖的是 **12 件设计**(一件设计挂在
 * 某个型号下面)⇒ 挂型号上必然对不上(买家点了会落到别的设计)。
 *
 * ## 停用而不是删
 *
 * 停用之后这个设计**不再能选淘宝下单** —— 链接留着,历史单还能查。
 *
 * ## 读失败不抛
 *
 * 这张表**不在收钱的链路上**(收钱在淘宝那边)⇒ 读不到就当「没配链接」,
 * 让买家看到一句人话,而不是 500。
 */

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { type ProductTaobaoLinkRow, productTaobaoLink } from "@/db/schema";

/**
 * 某件设计的淘宝链接(只认**启用中**的那条)
 *
 * 查不到返回 null —— 调用方自己决定怎么说话。
 */
export async function getActiveTaobaoLink(
  productHandle: string
): Promise<ProductTaobaoLinkRow | null> {
  if (!productHandle) return null;
  const rows = await db
    .select()
    .from(productTaobaoLink)
    .where(
      and(
        eq(productTaobaoLink.productHandle, productHandle),
        eq(productTaobaoLink.isActive, true)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 一批设计 → 「handle → 淘宝链接」的映射
 *
 * 只含**启用中**的行。查不到的行**不在表里** ⇒ 调用方看到的是「这件没配
 * 链接」,而不是「配了个空链接」。
 */
export async function getActiveTaobaoLinkMap(
  handles: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(handles.filter((handle) => handle.length > 0))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const rows = await db
    .select()
    .from(productTaobaoLink)
    .where(
      and(
        inArray(productTaobaoLink.productHandle, unique),
        eq(productTaobaoLink.isActive, true)
      )
    );

  for (const row of rows) {
    map.set(row.productHandle, row.url);
  }
  return map;
}

/**
 * 一共配了几条启用中的链接
 *
 * 支付通道的「**配好了**」那道闸就靠它 —— 至少配了一条,这个通道才算
 * 「技术上收得到钱」(工作室有淘宝店 ⇒ 钱进得去)。
 *
 * ⚠️ **不是「每一件设计都配了」** —— 工作室可能只给几个设计开了淘宝链接,
 * 剩下的照旧走支付宝。某一件没配 ⇒ 结算时单独拦下(那句话要说清楚是哪
 * 一件),而不是把整个通道灰掉。
 */
export async function countActiveTaobaoLinks(): Promise<number> {
  const rows = await db
    .select({ handle: productTaobaoLink.productHandle })
    .from(productTaobaoLink)
    .where(eq(productTaobaoLink.isActive, true));
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/*  后台读写                                                                     */
/* -------------------------------------------------------------------------- */

/** 后台列表 —— 全部的行(启用中的和停用的都摆出来) */
export async function listTaobaoLinks(): Promise<ProductTaobaoLinkRow[]> {
  return db
    .select()
    .from(productTaobaoLink)
    .orderBy(productTaobaoLink.productHandle);
}

/**
 * 新增 / 改一条链接
 *
 * 一个设计**只有一条**链接(唯一索引 `product_taobao_link_handle_uniq_idx`)
 * ⇒ 重复保存就是覆盖。
 *
 * ⚠️ **链接本身在调用方校验过了**(`checkTaobaoUrl()`)—— 这里只负责落库。
 *
 * `skuMap` / `directOrder` 是 2026-11-18 新加的两样(「直接下单」):
 * - `skuMap` —— 「本站尺寸 id → 淘宝 skuId」的映射,**空对象 = 没配**
 * - `directOrder` —— 后台那颗开关,**默认开**(关掉 = 退回商品页的老行为)
 */
export async function upsertTaobaoLink(input: {
  productHandle: string;
  url: string;
  itemId: string | null;
  note: string | null;
  isActive: boolean;
  skuMap?: Record<string, string>;
  directOrder?: boolean;
}): Promise<ProductTaobaoLinkRow> {
  const now = new Date();
  const skuMap = input.skuMap ?? {};
  const directOrder = input.directOrder ?? true;
  const rows = await db
    .insert(productTaobaoLink)
    .values({
      id: nanoid(),
      productHandle: input.productHandle,
      url: input.url,
      itemId: input.itemId,
      note: input.note,
      isActive: input.isActive,
      skuMap,
      directOrder,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: productTaobaoLink.productHandle,
      set: {
        url: input.url,
        itemId: input.itemId,
        note: input.note,
        isActive: input.isActive,
        skuMap,
        directOrder,
        updatedAt: now,
      },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("保存淘宝链接失败:没有返回行");
  return row;
}

/**
 * 启用 / 停用一条链接
 *
 * 停用之后这个设计**不再能选淘宝下单** —— 链接留着,历史单还能查。
 */
export async function setTaobaoLinkActive(
  productHandle: string,
  isActive: boolean
): Promise<void> {
  await db
    .update(productTaobaoLink)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(productTaobaoLink.productHandle, productHandle));
}

/**
 * 删掉一条链接
 *
 * ⚠️ **默认不用这个** —— 停用就够了(链接留着,历史单还能查)。
 * 真的删(录错了 handle)才用得上。
 */
export async function deleteTaobaoLink(productHandle: string): Promise<void> {
  await db
    .delete(productTaobaoLink)
    .where(eq(productTaobaoLink.productHandle, productHandle));
}
