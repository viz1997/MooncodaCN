"use server";

/**
 * 代理商 Server Actions
 *
 * - listActiveAgentsAction：protectedAction（订单创建表单下拉用），
 *   仅返回启用的代理商，避免把停用项暴露给业务侧
 * - 其余（list / create / update / setActive）：adminAction，要求 admin 角色
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { agent as agentTable } from "@/db/schema";
import { auth } from "@/lib/auth";
import { adminAction, protectedAction } from "@/lib/safe-action";
import {
  insertAgentToDb,
  listActiveAgentsFromDb,
  listAgentsFromDb,
  listAgentTemplatesFromDb,
  setAgentActiveInDb,
  setAgentPromptTemplatesInDb,
  updateAgentInDb,
} from "../lib/db-agents";

const withAgentAdminAction = (name: string) =>
  adminAction.metadata({ action: `agent.admin.${name}` });

const withAgentProtectedAction = (name: string) =>
  protectedAction.metadata({ action: `agent.protected.${name}` });

/**
 * 列出启用的代理商（订单创建表单 picker 用）
 *
 * 返回 id / name / contact 三个字段，详见 listActiveAgentsFromDb。
 */
export const listActiveAgentsAction = withAgentProtectedAction(
  "listActiveAgents"
)
  .schema(z.void().optional())
  .action(async () => {
    const agents = await listActiveAgentsFromDb();
    return { agents };
  });

/**
 * 列表
 */
export const listAgentsAdminAction = withAgentAdminAction("listAgents")
  .schema(z.void().optional())
  .action(async () => {
    const agents = await listAgentsFromDb();
    return { agents };
  });

/**
 * 创建
 *
 * name / email / password 必填；contact/phone/remark 可选；
 * isActive 默认 true（新建即启用）。
 *
 * 2026-09-08：email 必填化 + 新增 password 字段。email 同时作为登录邮箱
 * （复用 agent.email 列，不再额外存 loginEmail）；password 用于
 * Better Auth admin 插件 createUser 创建登录账号，绑 user.agentId → agent.id。
 *
 * ID 用 nanoid 12 位，与 prompt_template / photo 风格一致。
 */
const createAgentSchema = z.object({
  name: z.string().min(1, "请输入代理商名称").max(100, "名称最多100字符"),
  contact: z
    .string()
    .max(50, "联系人姓名最多50字符")
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
  phone: z
    .string()
    .max(30, "电话号码过长")
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
  email: z
    .string()
    .min(1, "请输入登录邮箱")
    .max(255, "邮箱过长")
    .transform((v) => v.trim())
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "请输入有效邮箱"),
  // bcrypt 72 字节上限（Better Auth 内部 hash 用 bcrypt）；最低 8 位平衡安全与记忆成本
  password: z
    .string()
    .min(8, "初始密码至少 8 位")
    .max(72, "密码过长（最多 72 字节）"),
  remark: z
    .string()
    .max(500, "备注最多500字符")
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
});

export type CreateAgentInput = z.input<typeof createAgentSchema>;

export const createAgentAdminAction = withAgentAdminAction("createAgent")
  .schema(createAgentSchema)
  .action(async ({ parsedInput }) => {
    const id = `AG_${nanoid(12)}`;
    try {
      // Step 1: INSERT agent 行（自己 tx，立即 commit）
      const agent = await insertAgentToDb({
        id,
        name: parsedInput.name,
        email: parsedInput.email,
        ...(parsedInput.contact ? { contact: parsedInput.contact } : {}),
        ...(parsedInput.phone ? { phone: parsedInput.phone } : {}),
        ...(parsedInput.remark ? { remark: parsedInput.remark } : {}),
        isActive: true,
      });

      // Step 2: Better Auth admin 插件 createUser（内部管 user+account 表）
      // - user.agentId = agent.id：让代理商能用该 user 登录后访问 /p/agent/[token]
      // - role: "user"：代理商不是平台 admin
      // - needsVerification: false / emailVerified: true：admin 亲自设的密码，无需邮件验证
      await auth.api.createUser({
        headers: await headers(),
        body: {
          name: parsedInput.name,
          email: parsedInput.email,
          password: parsedInput.password,
          role: "user",
          data: {
            agentId: agent.id,
            needsVerification: false,
            emailVerified: true,
          },
        },
      });

      revalidatePath("/admin/agents");
      revalidatePath("/admin/users");
      // 把凭证返回给 UI，让 admin 一次性看到密码并交付给代理商
      return {
        agent,
        credentials: {
          email: parsedInput.email,
          password: parsedInput.password,
        },
      };
    } catch (err) {
      // Step 1 已成功但 Step 2 失败：手动回滚 agent 行（createUser 用 BA 自有连接，
      // 不能复用外部 db.transaction）
      await db
        .delete(agentTable)
        .where(eq(agentTable.id, id))
        .catch(() => {});
      const message = err instanceof Error ? err.message : "创建代理商失败";
      if (/already exists/i.test(message)) {
        throw new Error("该邮箱已被注册，请更换邮箱");
      }
      throw new Error(message);
    }
  });

/**
 * 更新基础字段（不包含 isActive —— 启停单独走 setAgentActive）
 *
 * 不在 schema 里做 .transform：next-safe-action 的 .schema() 用的是 INPUT
 * 类型（zod transform 改 OUTPUT），call site 必须匹配 INPUT。空字符串 →
 * null 的清空逻辑放到 action handler 里集中处理。
 */
const updateAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "请输入代理商名称").max(100, "名称最多100字符"),
  contact: z.string().max(50, "联系人姓名最多50字符").optional(),
  phone: z.string().max(30, "电话号码过长").optional(),
  email: z
    .string()
    .max(255, "邮箱过长")
    .optional()
    .refine(
      (v) => !v || v.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "请输入有效邮箱"
    ),
  remark: z.string().max(500, "备注最多500字符").optional(),
});

/**
 * 空字符串归一为 null（明确清空该列）
 *
 * 注：表单永远会发所有字段，因此 `undefined` 不会出现；这里直接当空处理。
 */
function normalizeOptional(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export type UpdateAgentInput = z.input<typeof updateAgentSchema>;

export const updateAgentAdminAction = withAgentAdminAction("updateAgent")
  .schema(updateAgentSchema)
  .action(async ({ parsedInput }) => {
    const updated = await updateAgentInDb(parsedInput.id, {
      name: parsedInput.name,
      contact: normalizeOptional(parsedInput.contact),
      phone: normalizeOptional(parsedInput.phone),
      email: normalizeOptional(parsedInput.email),
      remark: normalizeOptional(parsedInput.remark),
    });
    if (!updated) {
      throw new Error("代理商不存在");
    }
    revalidatePath("/admin/agents");
    return { agent: updated };
  });

/**
 * 启停（停用 = 软删除，新建订单时不再可选，但历史订单 FK 已 set null）
 */
export const setAgentActiveAdminAction = withAgentAdminAction("setAgentActive")
  .schema(z.object({ id: z.string().min(1), isActive: z.boolean() }))
  .action(async ({ parsedInput }) => {
    const updated = await setAgentActiveInDb(
      parsedInput.id,
      parsedInput.isActive
    );
    if (!updated) {
      throw new Error("代理商不存在");
    }
    revalidatePath("/admin/agents");
    return { agent: updated };
  });

// ============================================
// 2026-09-07：代理商 ↔ 模板 M2M 编辑
// ============================================

/**
 * 查询 agent 已分配的模板 id 列表（agent 编辑页 / workbench 模板选择器）
 *
 * 走 protectedAction 而非 adminAction：因为 workbench 入口需要查自己
 * 的模板列表。admin 后台查任意 agent 的授权也走这里。
 */
export const listAgentTemplatesAction = withAgentProtectedAction(
  "listAgentTemplates"
)
  .schema(z.object({ agentId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const rows = await listAgentTemplatesFromDb(parsedInput.agentId);
    return {
      templateIds: rows.map((r) => r.promptTemplateId),
    };
  });

/**
 * 替换 agent 的可服务模板集合（全删全插，幂等）。
 *
 * 仅 adminAction：业务侧不允许 agent 自己改授权范围。
 */
export const setAgentPromptTemplatesAdminAction = withAgentAdminAction(
  "setAgentPromptTemplates"
)
  .schema(
    z.object({
      agentId: z.string().min(1),
      templateIds: z.array(z.string().min(1)).max(200, "一次最多 200 个模板"),
    })
  )
  .action(async ({ parsedInput }) => {
    // 去重保持幂等
    const uniq = Array.from(new Set(parsedInput.templateIds));
    await setAgentPromptTemplatesInDb(parsedInput.agentId, uniq);
    revalidatePath("/admin/agents");
    return { agentId: parsedInput.agentId, count: uniq.length };
  });

/**
 * 2026-09-07：当前登录代理商查自己的 workbench token（用于 portal 跳 workbench）。
 *
 * agentWorkbenchUrl = `/p/agent/{imageGenToken}`。
 * 仅当 ctx.agentId 存在时返回（非 agent 账号返回 null）。
 */
export const getMyAgentWorkbenchTokenAction = withAgentProtectedAction(
  "getMyAgentWorkbenchToken"
)
  .schema(z.void().optional())
  .action(async ({ ctx }) => {
    const agentId = (ctx as { agentId?: string | null }).agentId;
    if (!agentId) {
      return { token: null as string | null };
    }
    const row = await db.query.agent.findFirst({
      where: eq(agentTable.id, agentId),
      columns: { imageGenToken: true, isActive: true },
    });
    if (!row || !row.isActive) {
      return { token: null as string | null };
    }
    return { token: row.imageGenToken };
  });
