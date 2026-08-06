/**
 * 积分发放
 *
 * 实现积分发放、注册奖励等正向积分变动
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  type CreditsTransactionType,
  creditsBalance,
  creditsBatch,
  creditsTransaction,
} from "@/db/schema";

import { ensureCreditsBalance } from "./account";
import { AccountFrozenError } from "./errors";
import type {
  EnsureRegistrationBonusResult,
  GrantCreditsParams,
  GrantCreditsResult,
} from "./types";

/**
 * 发放积分
 *
 * 创建积分批次、交易记录，并更新余额
 */
export async function grantCredits(
  params: GrantCreditsParams
): Promise<GrantCreditsResult> {
  const {
    userId,
    amount,
    sourceType,
    debitAccount,
    transactionType,
    expiresAt,
    sourceRef,
    description,
    metadata,
  } = params;

  if (amount <= 0) {
    throw new Error("积分数量必须大于 0");
  }

  const balance = await ensureCreditsBalance(userId);

  if (balance.status === "frozen") {
    throw new AccountFrozenError();
  }

  const batchId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const now = new Date();

  const [batch] = await db
    .insert(creditsBatch)
    .values({
      id: batchId,
      userId,
      amount,
      remaining: amount,
      issuedAt: now,
      expiresAt: expiresAt ?? null,
      status: "active",
      sourceType,
      sourceRef,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!batch) {
    throw new Error("创建积分批次失败");
  }

  const [transaction] = await db
    .insert(creditsTransaction)
    .values({
      id: transactionId,
      userId,
      type: transactionType,
      amount,
      debitAccount,
      creditAccount: `USER:${userId}`,
      description,
      metadata,
      createdAt: now,
    })
    .returning();

  if (!transaction) {
    throw new Error("创建积分交易记录失败");
  }

  const [updated] = await db
    .update(creditsBalance)
    .set({
      balance: balance.balance + amount,
      totalEarned: balance.totalEarned + amount,
      updatedAt: now,
    })
    .where(eq(creditsBalance.userId, userId))
    .returning();

  if (!updated) {
    throw new Error("更新积分余额失败");
  }

  return {
    amount,
    batchId,
    transactionId,
    newBalance: updated.balance,
  };
}

/**
 * 确保新用户获得注册奖励
 *
 * 懒加载机制：当用户没有任何交易记录时才发放
 */
export async function ensureRegistrationBonus(
  userId: string,
  amount: number,
  expiryDays: number | null
): Promise<EnsureRegistrationBonusResult> {
  await ensureCreditsBalance(userId);

  const existingTransactions = await db.query.creditsTransaction.findMany({
    where: eq(creditsTransaction.userId, userId),
    limit: 1,
  });

  if (existingTransactions.length > 0) {
    return { granted: false, reason: "User already has transactions" };
  }

  const expiresAt = expiryDays
    ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
    : null;

  await grantCredits({
    userId,
    amount,
    sourceType: "bonus",
    debitAccount: "SYSTEM:registration_bonus",
    transactionType: "registration_bonus" as CreditsTransactionType,
    expiresAt,
    description: "新用户注册奖励",
    metadata: { bonusType: "registration" },
  });

  return { granted: true, amount };
}
