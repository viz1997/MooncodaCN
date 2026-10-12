/**
 * GPT-Image 模板管理 Server Actions
 *
 * 仅管理员可调用（adminAction）。
 */

"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { adminAction } from "@/lib/safe-action";

import {
  createTemplate as createTemplateSvc,
  deleteTemplate as deleteTemplateSvc,
  toggleTemplateActive as toggleTemplateActiveSvc,
  updateTemplate as updateTemplateSvc,
} from "../lib/admin-services";
import { promptTemplateSchema } from "../lib/validation";

const withTemplateAction = (name: string) =>
  adminAction.metadata({ action: `gptImage.template.${name}` });

/** 创建模板 */
export const createTemplateAction = withTemplateAction("create")
  .schema(promptTemplateSchema)
  .action(async ({ parsedInput }) => {
    const template = await createTemplateSvc({
      ...parsedInput,
      coverUrl: parsedInput.coverUrl ?? null,
    });
    revalidatePath("/admin/prompt-templates");
    revalidateTag("admin-templates", "max");
    revalidateTag("templates", "max");
    return { template };
  });

/** 更新模板（按 ID） */
const updateTemplateInputSchema = z.object({
  id: z.string().min(1),
  data: promptTemplateSchema.partial(),
});
export const updateTemplateAction = withTemplateAction("update")
  .schema(updateTemplateInputSchema)
  .action(async ({ parsedInput }) => {
    const template = await updateTemplateSvc(parsedInput.id, parsedInput.data);
    revalidatePath("/admin/prompt-templates");
    revalidateTag("admin-templates", "max");
    revalidateTag("templates", "max");
    return { template };
  });

/** 切换启用状态 */
const toggleActiveSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
export const toggleTemplateActiveAction = withTemplateAction("toggleActive")
  .schema(toggleActiveSchema)
  .action(async ({ parsedInput }) => {
    const template = await toggleTemplateActiveSvc(
      parsedInput.id,
      parsedInput.isActive
    );
    revalidatePath("/admin/prompt-templates");
    revalidateTag("admin-templates", "max");
    revalidateTag("templates", "max");
    return { template };
  });

/** 删除模板 */
const deleteTemplateSchema = z.object({ id: z.string().min(1) });
export const deleteTemplateAction = withTemplateAction("delete")
  .schema(deleteTemplateSchema)
  .action(async ({ parsedInput }) => {
    await deleteTemplateSvc(parsedInput.id);
    revalidatePath("/admin/prompt-templates");
    revalidateTag("admin-templates", "max");
    revalidateTag("templates", "max");
    return { success: true };
  });
