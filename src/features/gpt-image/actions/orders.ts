/**
 * GPT-Image 订单管理 Server Actions
 *
 * 任何登录用户可调用（protectedAction）——订单是用户自己创建给匿名收件人用的。
 * 模板管理仍是 adminAction（见 ./templates.ts）。
 */

"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { PromptOrderStatus } from "@/db/schema";
import { protectedAction } from "@/lib/safe-action";
import {
  createOrder as createOrderSvc,
  deleteOrderById,
  listOrders as listOrdersSvc,
  listTemplatesWithCounts,
} from "../lib/admin-services";
import { promptOrderCreateSchema } from "../lib/validation";

const withOrderAction = (name: string) =>
  protectedAction.metadata({ action: `gptImage.order.${name}` });

/** 创建订单 */
export const createOrderAction = withOrderAction("create")
  .schema(promptOrderCreateSchema)
  .action(async ({ parsedInput }) => {
    // 注意：不调用 revalidatePath —— 管理端列表走的是客户端 fetch /api/admin/orders，
    // revalidatePath 只清 RSC 缓存，对本列表无效。新订单通过客户端 onCreated 回调
    // 做乐观插入 + 后台 refetch 来更新。
    const order = await createOrderSvc(parsedInput);
    return { order };
  });

/** 列出订单（管理端） */
const listOrdersSchema = z.object({
  status: z.string().optional(),
  templateId: z.string().optional(),
});
export const listOrdersAction = withOrderAction("list")
  .schema(listOrdersSchema)
  .action(async ({ parsedInput }) => {
    const orders = await listOrdersSvc({
      ...(parsedInput.status !== undefined
        ? { status: parsedInput.status as PromptOrderStatus }
        : {}),
      ...(parsedInput.templateId !== undefined
        ? { templateId: parsedInput.templateId }
        : {}),
    });
    return { orders };
  });

/** 列出模板（含订单数） */
export const listTemplatesAction = withOrderAction("listTemplates")
  .schema(z.object({}).optional())
  .action(async () => {
    const templates = await listTemplatesWithCounts();
    return { templates };
  });

/** 删除订单 */
const deleteOrderSchema = z.object({ id: z.string().min(1) });
export const deleteOrderAction = withOrderAction("delete")
  .schema(deleteOrderSchema)
  .action(async ({ parsedInput }) => {
    await deleteOrderById(parsedInput.id);
    revalidatePath("/dashboard/prompt-orders");
    revalidateTag("admin-orders", "max");
    return { success: true };
  });
