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
  findOrderByOrderNoForCreator,
  listOrders as listOrdersSvc,
  listTemplatesWithCounts,
  updateOrder as updateOrderSvc,
} from "../lib/admin-services";
import { promptOrderCreateSchema } from "../lib/validation";

const withOrderAction = (name: string) =>
  protectedAction.metadata({ action: `gptImage.order.${name}` });

/** 创建订单 */
export const createOrderAction = withOrderAction("create")
  .schema(promptOrderCreateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const order = await createOrderSvc({
      ...parsedInput,
      createdBy: ctx.userId,
    });
    // 必须失效 orders tag：管理端列表走客户端 fetch /api/orders，该接口用
    // unstable_cache 缓存 60s。不失效的话 onCreated 里的后台 refetch 会拿到
    // 不含新订单的旧快照，把乐观插入的新行覆盖掉，直到缓存自然过期才出现。
    // （revalidatePath 对该接口确实无效，但 revalidateTag 有效。）
    revalidateTag("orders", "max");
    return { order };
  });

/**
 * 检测"同一创建者"的同 orderNo 冲突。
 *
 * 不抛错 —— 返回 `{ conflict: true/false, existing }` 让客户端弹确认框。
 */
const checkConflictSchema = z.object({
  orderNo: z.string().min(1).max(100),
});
export const checkOrderNoConflictAction = withOrderAction("checkConflict")
  .schema(checkConflictSchema)
  .action(async ({ parsedInput, ctx }) => {
    const existing = await findOrderByOrderNoForCreator(
      parsedInput.orderNo,
      ctx.userId
    );
    return { conflict: !!existing, existing };
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
    revalidateTag("orders", "max");
    return { success: true };
  });

/**
 * 编辑订单
 *
 * 模板、token、状态、上传内容均锁定，仅允许改：
 * - orderNo / recipientName / platform / uploadCount / regenerateLimit
 */
const updateOrderSchema = z.object({
  id: z.string().min(1),
  orderNo: z.string().min(1, "请输入订单号").max(100),
  recipientName: z.string().max(100),
  platform: z.string().nullable(),
  uploadCount: z.number().int().min(1).max(50),
  regenerateLimit: z.number().int().min(0).max(20),
});
export const updateOrderAction = withOrderAction("update")
  .schema(updateOrderSchema)
  .action(async ({ parsedInput }) => {
    const order = await updateOrderSvc(parsedInput);
    // 与 create 一样：列表走客户端 fetch，revalidateTag 让缓存失效，
    // onUpdated 回调做乐观更新
    revalidateTag("orders", "max");
    return { order };
  });
