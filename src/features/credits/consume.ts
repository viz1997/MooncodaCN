/**
 * 积分消费
 *
 * 实现 FIFO（先进先出）积分消费：优先消费最早过期的批次
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { creditsBalance, creditsBatch, creditsTransaction } from "@/db/schema";

import { getCreditsBalance } from "./account";
import { AccountFrozenError, InsufficientCreditsError } from "./errors";
import type {
  ConsumeCreditsParams,
  ConsumeCreditsResult,
  ConsumedBatch,
} from "./types";

/**
 * 消费积分
 *
 * 按 FIFO 原则从用户的活跃批次中扣减，创建交易记录并更新余额
 */
export async function consumeCredits(
  params: ConsumeCreditsParams
): Promise<ConsumeCreditsResult> {
  const { userId, amount, serviceName, description, metadata } = params;

  if (amount <= 0) {
    throw new Error("消费数量必须大于 0");
  }

  const balance = await getCreditsBalance(userId);

  if (balance.status === "frozen") {
    throw new AccountFrozenError();
  }

  if (balance.balance < amount) {
    throw new InsufficientCreditsError(amount, balance.balance);
  }

  // 查询活跃批次，按过期时间升序（先过期先消费），永不过期排最后
  const batches = await db.query.creditsBatch.findMany({
    where: and(
      eq(creditsBatch.userId, userId),
      eq(creditsBatch.status, "active"),
      sql`${creditsBatch.remaining} > 0`
    ),
    orderBy: [
      sql`${creditsBatch.expiresAt} ASC NULLS LAST`,
      sql`${creditsBatch.issuedAt} ASC`,
    ],
  });

  if (batches.length === 0) {
    throw new InsufficientCreditsError(amount, balance.balance);
  }

  let remainingToConsume = amount;
  const consumedBatches: ConsumedBatch[] = [];
  const now = new Date();
  let transactionId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    for (const batch of batches) {
      if (remainingToConsume <= 0) break;
      if (batch.remaining <= 0) continue;

      const consumeFromBatch = Math.min(batch.remaining, remainingToConsume);
      const newRemaining = batch.remaining - consumeFromBatch;
      const newStatus = newRemaining <= 0 ? "consumed" : "active";

      await tx
        .update(creditsBatch)
        .set({
          remaining: newRemaining,
          status: newStatus,
          updatedAt: now,
        })
        .where(eq(creditsBatch.id, batch.id));

      consumedBatches.push({
        batchId: batch.id,
        consumedFromBatch: consumeFromBatch,
      });

      remainingToConsume -= consumeFromBatch;
    }

    if (remainingToConsume > 0) {
      throw new InsufficientCreditsError(
        amount,
        balance.balance - remainingToConsume
      );
    }

    transactionId = crypto.randomUUID();

    const [transaction] = await tx
      .insert(creditsTransaction)
      .values({
        id: transactionId,
        userId,
        type: "consumption",
        amount,
        debitAccount: `USER:${userId}`,
        creditAccount: `SERVICE:${serviceName}`,
        description,
        metadata,
        createdAt: now,
      })
      .returning();

    if (!transaction) {
      throw new Error("创建积分消费记录失败");
    }

    await tx
      .update(creditsBalance)
      .set({
        balance: balance.balance - amount,
        totalSpent: balance.totalSpent + amount,
        updatedAt: now,
      })
      .where(eq(creditsBalance.userId, userId));
  });

  const updatedBalance = await getCreditsBalance(userId);

  return {
    success: true,
    consumedAmount: amount,
    remainingBalance: updatedBalance.balance,
    transactionId,
    consumedBatches,
  };
}
