"use server";

/**
 * 2026-09-03：代理商 portal Server Actions（ToB 自下单）。
 *
 * 三个 action：
 * 1. agentCreateOrderAction —— 创建订单（强制 agentId = ctx.agentId）
 * 2. agentListOrdersAction —— 列自己的订单（自动按 ctx.agentId 过滤）
 * 3. agentListTemplatesAction —— 列可选模板（不带 prompt 字段，
 *    与 createOrder 一致；同 createOrderAction.listTemplates 共用 service）
 *
 * 中间件用 agentAction（不是 protectedAction）—— 多一层"必须绑了代理商"
 * 校验，免去每个 handler 重复查 session。
 *
 * 不复用 /admin/prompt-orders 路由：listOrders 那个 query 走 createdBy
 * 过滤；代理商查自己订单必须走 agentId 过滤、不能 createdBy 过滤（否则
 * admin 替某个代理商店发后，那个 agent 的 user 看不到）。所以重新封装。
 */

import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import {
  createOrder as createOrderSvc,
  listActiveTemplatesForOrderCreate,
  listOrders as listOrdersSvc,
} from "@/features/gpt-image/lib/admin-services";
import { promptOrderCreateSchema } from "@/features/gpt-image/lib/validation";
import { agentAction } from "@/lib/safe-action";
import { validateAgentProductSpec } from "../lib/product-validation";

const withAgentPortalAction = (name: string) =>
  agentAction.metadata({ action: `agent.portal.${name}` });

/**
 * 代理商自下单 —— 创建订单。
 *
 * 与 admin 的 createOrderAction 区别：
 * - 中间件是 agentAction（ctx.agentId 必有）
 * - 强制把 ctx.agentId 写入订单（不允许 user 通过 parsedInput.agentId
 *   偷换"给别人下单"）
 * - 三件套字典必填（productTypeCode + productSize 必，accessoryCode 看
 *   型号），validateAgentProductSpec 校验
 */
export const agentCreateOrderAction = withAgentPortalAction("createOrder")
  .schema(promptOrderCreateSchema)
  .action(async ({ parsedInput, ctx }) => {
    // 三件套必填校验（代理商自下单硬性要求）
    validateAgentProductSpec({
      productTypeCode: parsedInput.productTypeCode ?? null,
      productSize: parsedInput.productSize ?? null,
      accessoryCode: parsedInput.accessoryCode ?? null,
    });

    // 防越权：parsedInput.agentId 必须是自己的 agentId（不允许替别人下单）
    if (parsedInput.agentId && parsedInput.agentId !== ctx.agentId) {
      throw new Error("不能为其他代理商下单");
    }

    const order = await createOrderSvc({
      ...parsedInput,
      agentId: ctx.agentId, // 强制注入，覆盖 parsedInput
      createdBy: ctx.userId,
    });

    // 失效缓存（与 createOrderAction 一致：列表 fetch /api/orders 走
    // unstable_cache，必须 revalidateTag 才有效果）
    revalidateTag("orders", "max");

    return {
      order,
      token: order.token,
    };
  });

/**
 * 代理商列自己的订单 —— ctx.agentId 是必传的过滤条件。
 *
 * status / templateId 可选；与 admin list 共用 service 路径（listOrdersSvc）。
 * 不传 skipCreatorFilter（永远 false）—— 自动按 agentId 过滤，不让代理商看
 * 别人的订单。
 */
const agentListOrdersSchema = z.object({
  status: z.string().optional(),
  templateId: z.string().optional(),
});
export const agentListOrdersAction = withAgentPortalAction("listOrders")
  .schema(agentListOrdersSchema)
  .action(async ({ parsedInput, ctx }) => {
    const orders = await listOrdersSvc({
      // 强制 agentId = ctx.agentId
      agentId: ctx.agentId,
      ...(parsedInput.status !== undefined
        ? { status: parsedInput.status as never }
        : {}),
      ...(parsedInput.templateId !== undefined
        ? { templateId: parsedInput.templateId }
        : {}),
    });
    return { orders };
  });

/**
 * 代理商创建订单时的模板下拉 —— 不返回 prompt 字段（提示词对用户隐藏）。
 *
 * 与 admin createOrderAction.listTemplates 共用 listActiveTemplatesForOrderCreate。
 * schema 用 z.void().optional()（不是 z.object({}).optional()）—— next-safe-action
 * 的 .schema() 调用方传 0 参数需要 void 类型。
 */
export const agentListTemplatesAction = withAgentPortalAction("listTemplates")
  .schema(z.void().optional())
  .action(async () => {
    const templates = await listActiveTemplatesForOrderCreate();
    return { templates };
  });

/**
 * 列出当前账号绑定的代理商档案（侧边栏 / 新建订单页头展示用）。
 *
 * 直接查 agent 表（agentId 从 ctx.agentId 拿），返回单条记录。
 * 不暴露到 client 不传更细字段—— ctx.agentId 已经过 checkAgent 守门，
 * 不会出现"查别人的 agent"越权场景。
 */
export const agentGetOwnAgentAction = withAgentPortalAction("getOwnAgent")
  .schema(z.void().optional())
  .action(async ({ ctx }) => {
    // 动态 import 避免循环依赖 + 集中 service 文件
    const { db } = await import("@/db");
    const { agent } = await import("@/db/schema");
    const row = await db.query.agent.findFirst({
      where: eq(agent.id, ctx.agentId),
    });
    if (!row) {
      throw new Error("代理商档案不存在");
    }
    return { agent: row };
  });
