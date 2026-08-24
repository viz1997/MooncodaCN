"use server";

/**
 * 代理商 Admin Server Actions
 *
 * 全部走 adminAction 客户端（要求登录用户 role=admin），
 * 与 src/features/image-gen/admin/actions.ts 同源。
 */

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction } from "@/lib/safe-action";

import {
  insertAgentToDb,
  listAgentsFromDb,
  setAgentActiveInDb,
  updateAgentInDb,
} from "../lib/db-agents";

const withAgentAdminAction = (name: string) =>
  adminAction.metadata({ action: `agent.admin.${name}` });

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
 * name 必填；contact/phone/email/remark 可选；
 * isActive 默认 true（新建即启用）。
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
    .max(255, "邮箱过长")
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "请输入有效邮箱"
    ),
  remark: z
    .string()
    .max(500, "备注最多500字符")
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const createAgentAdminAction = withAgentAdminAction("createAgent")
  .schema(createAgentSchema)
  .action(async ({ parsedInput }) => {
    const id = `AG_${nanoid(12)}`;
    const agent = await insertAgentToDb({
      id,
      name: parsedInput.name,
      ...(parsedInput.contact ? { contact: parsedInput.contact } : {}),
      ...(parsedInput.phone ? { phone: parsedInput.phone } : {}),
      ...(parsedInput.email ? { email: parsedInput.email } : {}),
      ...(parsedInput.remark ? { remark: parsedInput.remark } : {}),
      isActive: true,
    });
    revalidatePath("/admin/agents");
    return { agent };
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
