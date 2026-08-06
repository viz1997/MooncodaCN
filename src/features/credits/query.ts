/**
 * 积分查询
 *
 * 提供积分批次、交易历史的查询能力
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { creditsBatch, creditsTransaction } from "@/db/schema";

import type { TransactionQueryOptions } from "./types";

/**
 * 获取用户的活跃积分批次
 *
 * 按过期时间升序返回（先过期先消费）
 */
export async function getUserActiveBatches(
  userId: string
): Promise<(typeof creditsBatch.$inferSelect)[]> {
  return db.query.creditsBatch.findMany({
    where: and(
      eq(creditsBatch.userId, userId),
      eq(creditsBatch.status, "active")
    ),
    orderBy: [creditsBatch.expiresAt, creditsBatch.issuedAt],
  });
}

/**
 * 获取用户的交易历史
 *
 * 按时间倒序返回，支持分页
 */
export async function getUserTransactions(
  userId: string,
  options: TransactionQueryOptions = {}
): Promise<(typeof creditsTransaction.$inferSelect)[]> {
  const { limit, offset } = options;

  return db.query.creditsTransaction.findMany({
    where: eq(creditsTransaction.userId, userId),
    orderBy: [desc(creditsTransaction.createdAt)],
    ...(limit !== undefined && { limit }),
    ...(offset !== undefined && { offset }),
  });
}

/**
 * 获取用户的交易记录总数
 */
export async function getUserTransactionsCount(
  userId: string
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditsTransaction)
    .where(eq(creditsTransaction.userId, userId));

  return result[0]?.count ?? 0;
}
