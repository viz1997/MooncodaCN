"use server";

/**
 * 2026-09-07：代理商账本管理 actions（admin 端）。
 *
 * 决策：
 * - 所有 action 走 adminAction middleware（要求 role=admin）
 * - 充值 / 手动扣款 在 db.transaction 里原子化
 * - 积分扣减只在 agent workbench 路径自动发生；ToC /p/[token] 不扣费
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction } from "@/lib/safe-action";

import {
  deductAgentCreditsInDb,
  getAgentBalanceFromDb,
  listAgentCreditLogsFromDb,
  topUpAgentCreditsInDb,
} from "../lib/db-agent-credits";

const withAgentCreditAdmin = (name: string) =>
  adminAction.metadata({ action: `agent.credit.admin.${name}` });

/**
 * 查余额 + 最近流水（agent 编辑页 / 详情弹窗用）
 */
export const listAgentCreditsAdminAction = withAgentCreditAdmin("list")
  .schema(z.object({ agentId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const [balance, logs] = await Promise.all([
      getAgentBalanceFromDb(parsedInput.agentId),
      listAgentCreditLogsFromDb(parsedInput.agentId, 50),
    ]);
    return {
      agentId: parsedInput.agentId,
      creditBalance: balance,
      logs,
    };
  });

/**
 * 充值（admin 调整 / 客户付款后手动加款）
 */
const topUpSchema = z.object({
  agentId: z.string().min(1),
  amount: z
    .number()
    .int("金额必须为整数")
    .positive("金额必须大于 0")
    .max(1_000_000, "单次充值上限 100 万元"),
  note: z
    .string()
    .max(200, "备注最多 200 字符")
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
});

export const topUpAgentCreditsAdminAction = withAgentCreditAdmin("topUp")
  .schema(topUpSchema)
  .action(async ({ parsedInput }) => {
    const result = await topUpAgentCreditsInDb(
      parsedInput.agentId,
      parsedInput.amount,
      parsedInput.note
    );
    revalidatePath("/admin/agents");
    return result;
  });

/**
 * 手动扣款（admin 调整 / 纠错用）
 */
const deductSchema = z.object({
  agentId: z.string().min(1),
  amount: z
    .number()
    .int("金额必须为整数")
    .positive("金额必须大于 0")
    .max(1_000_000, "单次扣款上限 100 万元"),
  note: z.string().min(1, "请填写扣款备注").max(200, "备注最多 200 字符"),
});

export const deductAgentCreditsAdminAction = withAgentCreditAdmin("deduct")
  .schema(deductSchema)
  .action(async ({ parsedInput }) => {
    const result = await deductAgentCreditsInDb(
      parsedInput.agentId,
      parsedInput.amount,
      parsedInput.note
    );
    revalidatePath("/admin/agents");
    return result;
  });
