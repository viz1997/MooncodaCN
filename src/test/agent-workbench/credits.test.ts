/**
 * Agent Workbench 账本（credits）测试（2026-09-07）
 *
 * 覆盖：
 * - topUpAgentCreditsInDb：充值 + 流水追加
 * - deductAgentCreditsInDb：手动扣款 + 余额不足拒绝
 * - debitAgentCreditsForOrderInDb：workbench 提交扣款 + 防 race
 * - ledger 一致性：SUM(amount) = creditBalance
 */

import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  debitAgentCreditsForOrderInDb,
  deductAgentCreditsInDb,
  getAgentBalanceFromDb,
  listAgentCreditLogsFromDb,
  topUpAgentCreditsInDb,
} from "@/features/agent/lib/db-agent-credits";

import { testDb } from "../utils/db";
import {
  cleanupTestAgents,
  createTestAgent,
  createTestPromptTemplate,
  generateTestId,
} from "../utils/fixtures";

const agentIds: string[] = [];

afterAll(async () => {
  await cleanupTestAgents(agentIds);
});

describe("Agent credits ledger", () => {
  it("充值：余额累加 + topup 流水", async () => {
    const a = await createTestAgent({ creditBalance: 0 });
    agentIds.push(a.id);

    const after = await topUpAgentCreditsInDb(a.id, 100, "首次充值");
    expect(after.creditBalance).toBe(100);

    const logs = await listAgentCreditLogsFromDb(a.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.type).toBe("topup");
    expect(logs[0]?.amount).toBe(100);
    expect(logs[0]?.note).toBe("首次充值");
  });

  it("手动扣款：余额扣减 + debit 流水 + 余额不足拒绝", async () => {
    const a = await createTestAgent({ creditBalance: 50 });
    agentIds.push(a.id);

    const after = await deductAgentCreditsInDb(a.id, 30, "admin 手动扣款");
    expect(after.creditBalance).toBe(20);

    await expect(deductAgentCreditsInDb(a.id, 100, "超额")).rejects.toThrow(
      /余额不足/
    );

    // 余额应该没变（事务回滚）
    const balance = await getAgentBalanceFromDb(a.id);
    expect(balance).toBe(20);
  });

  it("workbench 扣款：超额时抛 INSUFFICIENT_CREDITS 且不写流水", async () => {
    const a = await createTestAgent({ creditBalance: 5 });
    agentIds.push(a.id);

    // 创建一个挂载到该 agent 的订单（外键需要）
    const tmpl = await createTestPromptTemplate({
      productTypeCode: "R",
      price: 10,
    });
    const orderId = generateTestId("test_order");
    await testDb.insert(schema.promptOrder).values({
      id: orderId,
      token: generateTestId("test_tok"),
      orderNo: `TEST-${nanoid(6).toUpperCase()}`,
      agentId: a.id,
      templateId: tmpl.id,
      recipientName: "test",
      uploadCount: 1,
      imagesPerUpload: 1,
      regenerateLimit: 0,
      status: "CANDIDATES_READY",
    });

    await expect(
      debitAgentCreditsForOrderInDb(a.id, orderId, 10, "submit final")
    ).rejects.toThrow("INSUFFICIENT_CREDITS");

    // 余额 + 流水都未变
    const balance = await getAgentBalanceFromDb(a.id);
    expect(balance).toBe(5);

    const logs = await listAgentCreditLogsFromDb(a.id);
    expect(logs).toHaveLength(0);

    // 清理临时订单
    await testDb
      .delete(schema.promptOrder)
      .where(eq(schema.promptOrder.id, orderId));
  });

  it("ledger 一致性：SUM(amount) = creditBalance", async () => {
    const a = await createTestAgent({ creditBalance: 0 });
    agentIds.push(a.id);

    await topUpAgentCreditsInDb(a.id, 200, "首充");
    await topUpAgentCreditsInDb(a.id, 50, "补款");
    await deductAgentCreditsInDb(a.id, 30, "手动扣 1");
    await deductAgentCreditsInDb(a.id, 20, "手动扣 2");

    const balance = await getAgentBalanceFromDb(a.id);
    expect(balance).toBe(200);

    // 直接 SUM(amount) 校验（带符号）
    const sum = await testDb
      .select({
        total: sql<number>`COALESCE(SUM(${schema.agentCreditTransaction.amount}), 0)::int`,
      })
      .from(schema.agentCreditTransaction)
      .where(eq(schema.agentCreditTransaction.agentId, a.id));
    expect(Number(sum[0]?.total ?? 0)).toBe(200);
  });

  it("workbench 扣款：余额充足时正常扣减 + debit 流水带 orderId", async () => {
    const a = await createTestAgent({ creditBalance: 100 });
    agentIds.push(a.id);

    const tmpl = await createTestPromptTemplate({
      productTypeCode: "R",
      price: 25,
    });
    const orderId = generateTestId("test_order2");
    await testDb.insert(schema.promptOrder).values({
      id: orderId,
      token: generateTestId("test_tok2"),
      orderNo: `TEST-${nanoid(6).toUpperCase()}`,
      agentId: a.id,
      templateId: tmpl.id,
      recipientName: "test",
      uploadCount: 1,
      imagesPerUpload: 1,
      regenerateLimit: 0,
      status: "CANDIDATES_READY",
    });

    const after = await debitAgentCreditsForOrderInDb(
      a.id,
      orderId,
      25,
      "workbench 提交"
    );
    expect(after.creditBalance).toBe(75);

    const logs = await listAgentCreditLogsFromDb(a.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.type).toBe("debit");
    expect(logs[0]?.amount).toBe(-25);
    expect(logs[0]?.orderId).toBe(orderId);

    // 清理
    await testDb
      .delete(schema.promptOrder)
      .where(eq(schema.promptOrder.id, orderId));
  });
});
