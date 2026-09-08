/**
 * 2026-09-07：代理商账本数据库访问层。
 *
 * 设计：
 * - 不使用双表账本（FIFO 批次 / 过期）：代理商无套餐过期业务。
 * - agent.creditBalance 是当前余额；agent_credit_transaction 是追加日志。
 * - amount 带符号：topup 正、debit 负；SUM(amount) = creditBalance（对账）。
 * - 扣减 / 充值走 db.transaction，保证余额与流水原子性。
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  type AgentCreditTransaction,
  type AgentCreditTxnType,
  agent,
  agentCreditTransaction,
} from "@/db/schema";

export type AgentCreditLog = AgentCreditTransaction;

/** db.transaction 回调里的 tx 类型，从 db 推导（避免硬编码 neon-serverless 驱动）。 */
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 查 agent 当前余额（不在此函数内做并发控制；调用方负责事务）
 */
export async function getAgentBalanceFromDb(
  agentId: string
): Promise<number | null> {
  const row = await db.query.agent.findFirst({
    where: eq(agent.id, agentId),
    columns: { creditBalance: true },
  });
  return row?.creditBalance ?? null;
}

/**
 * 查 agent 最近 N 条流水（默认 50）
 */
export async function listAgentCreditLogsFromDb(
  agentId: string,
  limit = 50
): Promise<AgentCreditLog[]> {
  return db.query.agentCreditTransaction.findMany({
    where: eq(agentCreditTransaction.agentId, agentId),
    orderBy: [desc(agentCreditTransaction.createdAt)],
    limit,
  });
}

/**
 * 充值：在事务里 +amount 余额 + 写 topup 流水。
 *
 * @returns 更新后的 agent 行（含新余额）
 */
export async function topUpAgentCreditsInDb(
  agentId: string,
  amount: number,
  note?: string
): Promise<{ agentId: string; creditBalance: number }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("充值金额必须为正整数");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(agent)
      .set({
        creditBalance: sql`${agent.creditBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(agent.id, agentId))
      .returning({ id: agent.id, creditBalance: agent.creditBalance });

    if (!updated) {
      throw new Error("代理商不存在");
    }

    await tx.insert(agentCreditTransaction).values({
      id: `ACT_${nanoid(16)}`,
      agentId,
      type: "topup",
      amount,
      orderId: null,
      note: note ?? null,
    });

    return { agentId: updated.id, creditBalance: updated.creditBalance };
  });
}

/**
 * 手动扣款（admin 调整用，不经订单）：在事务里 -amount 余额 + 写 debit 流水。
 *
 * 防超额：SQL 层用 WHERE credit_balance >= amount，affected rows = 0
 * 即视为余额不足，事务回滚。
 */
export async function deductAgentCreditsInDb(
  agentId: string,
  amount: number,
  note: string
): Promise<{ agentId: string; creditBalance: number }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("扣款金额必须为正整数");
  }
  if (!note?.trim()) {
    throw new Error("手动扣款必须填写备注");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(agent)
      .set({
        creditBalance: sql`${agent.creditBalance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(agent.id, agentId), sql`${agent.creditBalance} >= ${amount}`)
      )
      .returning({ id: agent.id, creditBalance: agent.creditBalance });

    if (!updated) {
      throw new Error("余额不足或代理商不存在");
    }

    await tx.insert(agentCreditTransaction).values({
      id: `ACT_${nanoid(16)}`,
      agentId,
      type: "debit",
      amount: -amount,
      orderId: null,
      note,
    });

    return { agentId: updated.id, creditBalance: updated.creditBalance };
  });
}

/**
 * 提交订单时扣减（workbench submitFinalOrderAction 用）。
 *
 * 与 deductAgentCreditsInDb 的区别：
 * - 不需要 note 必填（用模板名自动填）
 * - 关联 orderId
 * - 调用方已在事务里同时更新 promptOrder；本函数单独走事务更安全
 *
 * 防超额：SQL 层 WHERE credit_balance >= amount，affected = 0 即拒绝。
 *
 * @throws Error("INSUFFICIENT_CREDITS") 当余额不足
 */
export async function debitAgentCreditsForOrderInDb(
  agentId: string,
  orderId: string,
  amount: number,
  note: string
): Promise<{ agentId: string; creditBalance: number }> {
  return db.transaction(async (tx) => {
    return debitAgentCreditsInTx(tx, agentId, orderId, amount, note);
  });
}

/**
 * 事务版扣减：在调用方提供的 tx 内扣 agent credit + 写流水。
 *
 * 给 submitFinalOrderAction 用：把"扣余额"和"改 promptOrder"放在同一个事务里，
 * 避免"扣了钱但订单没改成 SELECTED"的脏状态。
 *
 * 防超额：SQL 层 WHERE credit_balance >= amount，affected = 0 即拒绝。
 *
 * @throws Error("INSUFFICIENT_CREDITS") 当余额不足
 * @throws Error("扣减金额必须为正整数") 当 amount 非正整数
 */
export async function debitAgentCreditsInTx(
  tx: DbTx,
  agentId: string,
  orderId: string,
  amount: number,
  note: string
): Promise<{ agentId: string; creditBalance: number }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("扣减金额必须为正整数");
  }

  const [updated] = await tx
    .update(agent)
    .set({
      creditBalance: sql`${agent.creditBalance} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(eq(agent.id, agentId), sql`${agent.creditBalance} >= ${amount}`))
    .returning({ id: agent.id, creditBalance: agent.creditBalance });

  if (!updated) {
    throw new Error("INSUFFICIENT_CREDITS");
  }

  await tx.insert(agentCreditTransaction).values({
    id: `ACT_${nanoid(16)}`,
    agentId,
    type: "debit",
    amount: -amount,
    orderId,
    note,
  });

  return { agentId: updated.id, creditBalance: updated.creditBalance };
}

/**
 * 类型导出：让外部 import 时不需要重新导出 enum。
 */
export type { AgentCreditTxnType };
