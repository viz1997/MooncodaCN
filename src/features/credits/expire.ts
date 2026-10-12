/**
 * 积分过期处理
 *
 * 扫描并处理已过期的积分批次，将其状态改为 expired 并扣除余额
 */

import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { creditsBalance, creditsBatch, creditsTransaction } from "@/db/schema";

import type { ExpiredBatchResult } from "./types";

/**
 * 处理所有已过期的积分批次
 *
 * 对每个过期批次：
 * 1. 将批次状态改为 expired
 * 2. 从用户余额中扣除剩余积分
 * 3. 创建 expiration 类型的交易记录
 */
export async function processExpiredBatches(): Promise<ExpiredBatchResult[]> {
  const now = new Date();

  // 查询所有已过期的活跃批次
  const expiredBatches = await db.query.creditsBatch.findMany({
    where: and(
      eq(creditsBatch.status, "active"),
      lt(creditsBatch.expiresAt, now),
      sql`${creditsBatch.remaining} > 0`
    ),
  });

  if (expiredBatches.length === 0) {
    return [];
  }

  const results: ExpiredBatchResult[] = [];

  for (const batch of expiredBatches) {
    const { id: batchId, userId, remaining } = batch;

    await db.transaction(async (tx) => {
      await tx
        .update(creditsBatch)
        .set({
          status: "expired",
          updatedAt: now,
        })
        .where(eq(creditsBatch.id, batchId));

      await tx.insert(creditsTransaction).values({
        id: crypto.randomUUID(),
        userId,
        type: "expiration",
        amount: remaining,
        debitAccount: `USER:${userId}`,
        creditAccount: "SYSTEM:expired_credits",
        description: "积分批次过期",
        metadata: { batchId },
        createdAt: now,
      });

      const [balance] = await tx
        .select({
          balance: creditsBalance.balance,
          totalSpent: creditsBalance.totalSpent,
        })
        .from(creditsBalance)
        .where(eq(creditsBalance.userId, userId))
        .limit(1);

      if (balance) {
        await tx
          .update(creditsBalance)
          .set({
            balance: Math.max(0, balance.balance - remaining),
            totalSpent: balance.totalSpent + remaining,
            updatedAt: now,
          })
          .where(eq(creditsBalance.userId, userId));
      }
    });

    results.push({ batchId, userId, expiredAmount: remaining });
  }

  return results;
}
