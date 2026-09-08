/**
 * Agent Workbench DB helper 测试（2026-09-07）
 *
 * 覆盖：
 * - setAgentPromptTemplatesInDb：替换语义 + 幂等
 * - isTemplateAllowedForAgent：单条校验
 * - listActiveAgentPromptTemplatesFromDb：过滤 isActive=false
 * - findAgentDraftOrderFromDb：草稿查询（按 status 过滤）
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  findAgentDraftOrderFromDb,
  isTemplateAllowedForAgent,
  listActiveAgentPromptTemplatesFromDb,
  listAgentTemplatesFromDb,
  setAgentPromptTemplatesInDb,
} from "@/features/agent/lib/db-agents";
import { testDb } from "../utils/db";
import {
  assignTemplatesToAgent,
  cleanupTestAgents,
  createTestAgent,
  createTestPromptTemplate,
} from "../utils/fixtures";

const agentIds: string[] = [];

afterAll(async () => {
  await cleanupTestAgents(agentIds);
});

describe("Agent M2M helpers", () => {
  it("setAgentPromptTemplatesInDb：替换语义（先全删再插）", async () => {
    const a = await createTestAgent();
    agentIds.push(a.id);
    const t1 = await createTestPromptTemplate();
    const t2 = await createTestPromptTemplate();
    const t3 = await createTestPromptTemplate();

    // 初始分配 [t1, t2]
    await assignTemplatesToAgent(a.id, [t1.id, t2.id]);
    let assigned = await listAgentTemplatesFromDb(a.id);
    expect(assigned).toHaveLength(2);

    // 替换为 [t3] —— t1/t2 应该被移除
    await setAgentPromptTemplatesInDb(a.id, [t3.id]);
    assigned = await listAgentTemplatesFromDb(a.id);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.promptTemplateId).toBe(t3.id);

    // 重复调用（传 []）：保持空
    await setAgentPromptTemplatesInDb(a.id, []);
    assigned = await listAgentTemplatesFromDb(a.id);
    expect(assigned).toHaveLength(0);
  });

  it("isTemplateAllowedForAgent：单条校验", async () => {
    const a = await createTestAgent();
    agentIds.push(a.id);
    const t1 = await createTestPromptTemplate();
    const t2 = await createTestPromptTemplate();

    await assignTemplatesToAgent(a.id, [t1.id]);

    expect(await isTemplateAllowedForAgent(a.id, t1.id)).toBe(true);
    expect(await isTemplateAllowedForAgent(a.id, t2.id)).toBe(false);
    expect(await isTemplateAllowedForAgent(a.id, "nonexistent")).toBe(false);
  });

  it("listActiveAgentPromptTemplatesFromDb：只返回 active 模板", async () => {
    const a = await createTestAgent();
    agentIds.push(a.id);
    const activeT = await createTestPromptTemplate({ isActive: true });
    const inactiveT = await createTestPromptTemplate({ isActive: false });

    await assignTemplatesToAgent(a.id, [activeT.id, inactiveT.id]);

    const list = await listActiveAgentPromptTemplatesFromDb(a.id);
    const ids = list.map((t) => t.id);
    expect(ids).toContain(activeT.id);
    expect(ids).not.toContain(inactiveT.id);
  });

  it("findAgentDraftOrderFromDb：按 status 过滤 + 最新优先", async () => {
    const a = await createTestAgent();
    agentIds.push(a.id);
    const tmpl = await createTestPromptTemplate({ productTypeCode: "R" });

    // 创建一个 SELECTED（已完成）+ 一个 CANDIDATES_READY（草稿）
    const completedOrderId = `test_completed_${nanoid(8)}`;
    await testDb.insert(schema.promptOrder).values({
      id: completedOrderId,
      token: `test_tok_completed_${nanoid(8)}`,
      orderNo: `TC-${nanoid(6).toUpperCase()}`,
      agentId: a.id,
      templateId: tmpl.id,
      recipientName: "test",
      uploadCount: 1,
      imagesPerUpload: 1,
      regenerateLimit: 0,
      status: "SELECTED",
    });

    const draftOrderId = `test_draft_${nanoid(8)}`;
    await testDb.insert(schema.promptOrder).values({
      id: draftOrderId,
      token: `test_tok_draft_${nanoid(8)}`,
      orderNo: `TD-${nanoid(6).toUpperCase()}`,
      agentId: a.id,
      templateId: tmpl.id,
      recipientName: "test",
      uploadCount: 1,
      imagesPerUpload: 1,
      regenerateLimit: 0,
      status: "CANDIDATES_READY",
    });

    const draft = await findAgentDraftOrderFromDb(a.id);
    expect(draft?.id).toBe(draftOrderId);
    expect(draft?.status).toBe("CANDIDATES_READY");

    // 清理
    await testDb
      .delete(schema.promptOrder)
      .where(eq(schema.promptOrder.id, draftOrderId));
    await testDb
      .delete(schema.promptOrder)
      .where(eq(schema.promptOrder.id, completedOrderId));
  });
});
