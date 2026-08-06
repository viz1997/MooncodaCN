/**
 * 积分账户管理
 *
 * 负责积分账户的创建、查询、冻结与解冻
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { creditsBalance } from "@/db/schema";

import { AccountFrozenError } from "./errors";

/**
 * 确保用户存在积分账户
 *
 * 不存在时创建新账户，存在时直接返回
 */
export async function ensureCreditsBalance(
  userId: string
): Promise<typeof creditsBalance.$inferSelect> {
  const existing = await db.query.creditsBalance.findFirst({
    where: eq(creditsBalance.userId, userId),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(creditsBalance)
    .values({
      id: crypto.randomUUID(),
      userId,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      status: "active",
    })
    .returning();

  if (!created) {
    throw new Error("创建积分账户失败");
  }

  return created;
}

/**
 * 获取用户积分账户
 *
 * 调用方应确保账户已存在
 */
export async function getCreditsBalance(
  userId: string
): Promise<typeof creditsBalance.$inferSelect> {
  const balance = await db.query.creditsBalance.findFirst({
    where: eq(creditsBalance.userId, userId),
  });

  if (!balance) {
    throw new Error("积分账户不存在");
  }

  return balance;
}

/**
 * 冻结积分账户
 */
export async function freezeCreditsAccount(userId: string): Promise<void> {
  const balance = await getCreditsBalance(userId);

  if (balance.status === "frozen") {
    return;
  }

  await db
    .update(creditsBalance)
    .set({ status: "frozen", updatedAt: new Date() })
    .where(eq(creditsBalance.userId, userId));
}

/**
 * 解冻积分账户
 */
export async function unfreezeCreditsAccount(userId: string): Promise<void> {
  const balance = await getCreditsBalance(userId);

  if (balance.status === "active") {
    return;
  }

  await db
    .update(creditsBalance)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(creditsBalance.userId, userId));
}

/**
 * 检查账户是否被冻结
 */
export async function assertAccountNotFrozen(userId: string): Promise<void> {
  const balance = await getCreditsBalance(userId);

  if (balance.status === "frozen") {
    throw new AccountFrozenError();
  }
}
