/**
 * 后台文件管理 —— 归属索引的**取数**(服务端专用)
 *
 * 纯逻辑那一半在 `owner-map.ts`(零依赖,能进单测)。这里只干一件事:
 * 把用户表读出来,喂给 `buildOwnerIndex()`。
 *
 * ## 为什么读全表
 *
 * 打印模型那一支的目录名是 `sha256(userId)` 的前 16 位 —— **哈希不能反查成
 * id**,只能拿用户表里每个 id 算一遍哈希去对。
 *
 * 读全表听着吓人,实际成本很低:
 *
 * - 只取三列(`id` / `name` / `email`),不取 `image` / `phoneNumber` 那些大字段
 * - 用户表是**账号表**,不是订单表 —— 几百到几千行,不是几百万行
 * - 同一个请求内只查一次(`cache()`)
 *
 * ## 读库失败怎么办
 *
 * **不抛** —— 归属显示不出来,不该让整个文件列表打不开。读失败就返回一个
 * 空索引:文件照样列得出来,归属那一列摆「—」。
 *
 * 这跟报价链路是同一个道理:能少给的信息就少给,别把整条链路炸掉。
 */

import { cache } from "react";

import { db } from "@/db";
import { user } from "@/db/schema";

import { buildOwnerIndex, type OwnerIndex } from "./owner-map";

/**
 * 归属索引 —— 同一个请求内只查一次库
 *
 * 跨请求**不缓存** —— 后台刚建的用户要立刻能对上号。
 */
export const getOwnerIndex = cache(async (): Promise<OwnerIndex> => {
  try {
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user);
    return buildOwnerIndex(rows);
  } catch (err) {
    // 归属只是「锦上添花」的一列 —— 读不到就摆「—」,别把文件列表拖垮
    console.error("[AdminFiles] 读用户表失败,归属列将为空", err);
    return buildOwnerIndex([]);
  }
});
