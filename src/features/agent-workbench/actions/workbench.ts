"use server";

/**
 * 代理商 workbench server actions（2026-09-07）
 *
 * 入口路径：/p/agent/[token]
 * 流程：登录 → 选模板 → 上传 1 张图 → 选 1 个候选 → 选规格 → 提交
 *
 * 设计：
 * - 这层只管 workbench 专属的 3 个动作：list / createDraft / submitFinal。
 * - 上传 / 生成 / 选候选 复用现有 /api/orders/[token]/{upload,select} 路由，
 *   由前端直接 fetch（带 cookie 即可，因为 session 已经登录）。这样
 *   upload/generation 的 200+ 行服务端逻辑只维护一份。
 * - 所有 action 第一步都调 requireAgentByToken 校验 token ↔ session.agentId 绑定，
 *   防止 agent A 拿 B 的 token 访问。
 *
 * 顶层 "use server" 指令：把这个文件标记为 server action 模块，避免
 * client component（AgentWorkbenchView）import 时把 pg / db 拖进客户端 bundle。
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { agent, promptOrder, promptTemplate } from "@/db/schema";
import { requireAgentByToken } from "@/features/agent/lib/auth-agent-token";
import { debitAgentCreditsInTx } from "@/features/agent/lib/db-agent-credits";
import {
  findAgentDraftOrderFromDb,
  isTemplateAllowedForAgent,
  listActiveAgentPromptTemplatesFromDb,
} from "@/features/agent/lib/db-agents";
import { validateProductSpec } from "@/features/agent/lib/product-validation";
import { getProductType } from "@/features/gpt-image/lib/product-catalog";
import { protectedAction } from "@/lib/safe-action";

const withWorkbenchAction = (name: string) =>
  protectedAction.metadata({ action: `agent-workbench.${name}` });

// ============================================
// 共享 schema
// ============================================

/** 路径参数（token）由调用方注入；服务端必须重新校验。 */
const tokenSchema = z.string().min(1).max(128);

// ============================================
// 1. 列出 workbench 当前状态
// ============================================

/**
 * 给前端一次性拿全 workbench 数据：agent 基础信息 + 可用模板 + 草稿订单（如有）。
 * 这样首屏 RSC / page 只需要调一次，避免 N 次 waterfall。
 */
export const listAgentWorkbenchAction = withWorkbenchAction("list")
  .schema(z.object({ token: tokenSchema }))
  .action(async ({ parsedInput }) => {
    const { agent: a } = await requireAgentByToken(parsedInput.token, {
      redirectTo: false,
    });
    const [templates, draftOrder] = await Promise.all([
      listActiveAgentPromptTemplatesFromDb(a.id),
      findAgentDraftOrderFromDb(a.id),
    ]);
    return {
      agent: {
        id: a.id,
        name: a.name,
        contact: a.contact,
        creditBalance: a.creditBalance,
      },
      templates,
      draftOrder: draftOrder ?? null,
    };
  });

// ============================================
// 2. 创建 draft promptOrder
// ============================================

/**
 * agent 选模板后创建草稿订单。
 *
 * 约束：
 * - 同 agent 同时只允许一个 draft（PENDING/GENERATING/CANDIDATES_READY），
 *   已有则返回 CONFLICT 让前端切回续做。
 * - templateId 必须在 agent 的授权列表里（防 agent 知道别的 agent 的 id）。
 * - template 必须 isActive=true。
 * - template 必须 productTypeCode 非空（workbench 强制要求）。
 */
export const createDraftOrderAction = withWorkbenchAction("createDraft")
  .schema(
    z.object({
      token: tokenSchema,
      templateId: z.string().min(1),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { agent: a } = await requireAgentByToken(parsedInput.token, {
      redirectTo: false,
    });

    // 1. 校验模板在授权列表里
    const allowed = await isTemplateAllowedForAgent(
      a.id,
      parsedInput.templateId
    );
    if (!allowed) {
      throw new Error("该模板不在您的代理授权范围内");
    }

    // 2. 校验模板本身可用 + 有关联商品类别
    const template = await db.query.promptTemplate.findFirst({
      where: eq(promptTemplate.id, parsedInput.templateId),
    });
    if (!template) {
      throw new Error("模板不存在");
    }
    if (!template.isActive) {
      throw new Error("模板已停用");
    }
    if (!template.productTypeCode) {
      throw new Error("该模板未配置商品类别，workbench 无法使用");
    }

    // 3. 同一 agent 不能同时有多个 draft
    const existing = await findAgentDraftOrderFromDb(a.id);
    if (existing) {
      return {
        ok: false as const,
        code: "DRAFT_EXISTS" as const,
        orderId: existing.id,
        token: existing.token,
      };
    }

    // 4. 创建订单：agentId + templateId + token + status=PENDING
    //    默认 uploadCount=1 / imagesPerUpload=1（workbench 单图单批场景）；
    //    regenerateLimit=0（workbench 不允许自己重生成，admin 控）。
    const newOrderId = nanoid();
    const newToken = nanoid(24);
    const orderNo = `AG-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}-${nanoid(6).toUpperCase()}`;
    const [created] = await db
      .insert(promptOrder)
      .values({
        id: newOrderId,
        token: newToken,
        orderNo,
        agentId: a.id,
        templateId: template.id,
        recipientName: a.name ?? a.contact ?? "",
        // workbench 单图单批
        uploadCount: 1,
        imagesPerUpload: 1,
        // workbench 不允许自行重生成
        regenerateLimit: 0,
        status: "PENDING",
      })
      .returning();

    if (!created) {
      throw new Error("创建草稿订单失败");
    }

    revalidateTag("orders", "max");

    return {
      ok: true as const,
      orderId: created.id,
      token: created.token,
      orderNo: created.orderNo,
      userId: ctx.userId,
    };
  });

// ============================================
// 3. 提交最终订单（核心事务）
// ============================================

const submitFinalSchema = z.object({
  token: tokenSchema,
  orderId: z.string().min(1),
  /** 厘米数字字符串：4/6/8/11，必须在 productType.sizes 里 */
  productSize: z.string().min(1).max(8),
  /** 配件码：leather/pvc/bracket，可选；型号无配件时留 null */
  accessoryCode: z.string().min(1).max(16).nullable().optional(),
  /** 刻字内容（仅 canEngrave 型号生效） */
  engravingText: z.string().max(500).nullable().optional(),
  /** 刻字是否外露（true=外露 / false=内刻） */
  engravingExposed: z.boolean().nullable().optional(),
});

/**
 * workbench 终态提交。
 *
 * 全部走 db.transaction，4 步要么全成要么全回滚：
 * 1. 锁行重读 promptOrder，校验 order.agentId === ctxAgentId + status 允许
 * 2. 校验 productTypeCode（从 order.templateId 读）非空 + 三件套字典组合合法
 * 3. UPDATE prompt_order SET status='SELECTED', selected_at=NOW(),
 *    product_type_code / product_size / accessory_code / engraving_text / engraving_exposed
 * 4. 若 amount > 0（template.price > 0 且非重复提交）：
 *    a. UPDATE agent SET credit_balance = credit_balance - amount
 *       WHERE credit_balance >= amount；affected=0 → 抛 INSUFFICIENT_CREDITS
 *    b. INSERT INTO agent_credit_transaction (type='debit', amount=-amount, order_id, note)
 */
export const submitFinalOrderAction = withWorkbenchAction("submitFinal")
  .schema(submitFinalSchema)
  .action(async ({ parsedInput }) => {
    const { agent: a } = await requireAgentByToken(parsedInput.token, {
      redirectTo: false,
    });

    // 1. 锁行重读 + 关联 template
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.id, parsedInput.orderId),
      with: { template: true },
    });
    if (!order) {
      throw new Error("订单不存在");
    }
    if (order.agentId !== a.id) {
      throw new Error("该订单不属于当前代理商");
    }
    if (order.status !== "CANDIDATES_READY" && order.status !== "SELECTED") {
      throw new Error(`当前状态 ${order.status} 无法提交，请先上传并选择候选`);
    }

    // 2. 校验 productTypeCode + 三件套
    const productTypeCode = order.template.productTypeCode;
    if (!productTypeCode) {
      throw new Error("模板未配置商品类别，无法提交");
    }
    validateProductSpec(
      productTypeCode,
      parsedInput.productSize,
      parsedInput.accessoryCode ?? null
    );

    // canEngrave 才能填 engravingText
    const productType = getProductType(productTypeCode);
    if (!productType) {
      throw new Error("商品类别字典缺失");
    }
    const wantsEngrave =
      parsedInput.engravingText != null &&
      parsedInput.engravingText.trim().length > 0;
    if (wantsEngrave && !productType.capabilities.canEngrave) {
      throw new Error(`${productType.name} 不支持刻字`);
    }

    // 3. 计算扣费金额（只在首次提交时扣，重复提交覆盖规格不重扣）
    const amount = order.template.price ?? 0;
    const isFirstSubmit = order.status !== "SELECTED";

    // 4. 事务化提交（4 步全成或全回滚）
    await db.transaction(async (tx) => {
      // 4.a 扣减 credit（首次提交才扣，覆盖规格不重扣）+ 写流水
      if (amount > 0 && isFirstSubmit) {
        await debitAgentCreditsInTx(
          tx,
          a.id,
          order.id,
          amount,
          `workbench 提交订单 ${order.orderNo}（${order.template.name}）`
        );
      }

      // 4.b 写 prompt_order（覆盖 spec + 状态 SELECTED）
      await tx
        .update(promptOrder)
        .set({
          productTypeCode,
          productSize: parsedInput.productSize,
          accessoryCode: parsedInput.accessoryCode ?? null,
          engravingText: wantsEngrave
            ? (parsedInput.engravingText ?? "").trim()
            : null,
          engravingExposed: wantsEngrave
            ? (parsedInput.engravingExposed ?? false)
            : null,
          status: "SELECTED",
          selectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(promptOrder.id, order.id));
    });

    // 重新读最新余额返回
    const newBalanceRow = await db.query.agent.findFirst({
      where: eq(agent.id, a.id),
      columns: { creditBalance: true },
    });

    revalidateTag("orders", "max");
    revalidateTag(`order:${order.id}`, "max");

    return {
      ok: true as const,
      orderId: order.id,
      newStatus: "SELECTED" as const,
      deducted: isFirstSubmit ? amount : 0,
      newBalance: newBalanceRow?.creditBalance ?? a.creditBalance - amount,
    };
  });
