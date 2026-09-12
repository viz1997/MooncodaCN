"use server";

/**
 * 2026-09-09：/image-gen 升级为 6 步下单工作台后的 server actions
 *
 * 流程：
 *   1. 用户在 /image-gen 选模板 + 选规格（productSize / accessoryCode / 可选 engraving）
 *   2. 调 createOrderFromImageGenAction 建 PENDING promptOrder，返 token
 *   3. 客户端用 token 调 /api/orders/[token]/upload + /image + /poll + /select
 *   4. 调 submitPublicOrderAction 扣个人 credit + SELECTED
 *
 * 与 V1 workbench（已删）的区别：
 *   - productTypeCode 来自 productEffect 的 productTypeCode 字段（用户选模板时绑定）
 *   - 三件套在 createOrder 时一次性定死（与 admin createOrder 语义一致）
 *   - engravingText / engravingExposed 在 SELECTED 后由 /p/[token] 页面改
 *     （保留 [[promptorder-product-customization]] 中"createOrder 锁三件套 + configure 改 engraving"分工）
 *
 * 安全：
 *   - 全走 protectedAction（要登录）
 *   - agentId 永远 null（代理商概念已砍）
 *   - credit 不足抛 InsufficientCreditsError，UI 转友好提示
 */

import { and, desc, eq, inArray, like, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { promptOrder, promptTemplate } from "@/db/schema";
import {
  consumeCredits,
  InsufficientCreditsError,
} from "@/features/credits/core";
import { generateOrderToken } from "@/features/gpt-image/lib/generation-service";
import {
  getAccessory,
  getLeatherColor,
  getProductType,
  validateLeatherColor,
  validatePlatform,
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
import { computePromptOrderCredits } from "@/features/image-gen/lib/price-calculator";
import { protectedAction } from "@/lib/safe-action";

const withOrderAction = (name: string) =>
  protectedAction.metadata({ action: `imageGen.order.${name}` });

// ============================================
// 创建订单
// ============================================

const createOrderSchema = z.object({
  /**
   * productEffect.id（也是 promptTemplate.id，因为 sync 脚本两个表 id 对齐）。
   * 实际写入时直接用此 id 填 promptOrder.templateId；promptOrder 与 promptTemplate
   * 通过 id 关联（schema.ts line 988）。
   */
  templateId: z.string().min(1),
  // 模板绑定的 productTypeCode（来自 productEffect.productTypeCode）
  productTypeCode: z.string().min(1).max(8).nullable().optional(),
  productSize: z.string().min(1).max(8).nullable().optional(),
  accessoryCode: z.string().min(1).max(16).nullable().optional(),
  // 2026-09-09：/image-gen 工作台允许用户在创建时直接填 engraving（与 /p/[token] 体验区分）
  engravingText: z.string().trim().max(40).nullable().optional(),
  engravingExposed: z.boolean().nullable().optional(),
  // 2026-09-10：LB 皮革徽章扩展定制（capability-gated）
  leatherColor: z.string().min(1).max(32).nullable().optional(),
  leatherExposed: z.boolean().nullable().optional(),
  pvcProtection: z.boolean().nullable().optional(),
  remarks: z.string().trim().min(0).max(500).nullable().optional(),
  /**
   * 2026-09-11：订单来源平台（PLATFORMS 字典 code）。
   * - null/undefined = 用户未选 → 落 null
   * - 非空 → 服务端 validatePlatform 校验字典，非法抛错
   */
  platform: z.string().min(1).max(32).nullable().optional(),
  /**
   * 2026-09-11：渠道订单号（与 platform 配对；跨平台异构字符串）。
   * - null/undefined = 用户未填 → 落 null
   * - 非空 → 服务端 trim 后存，max 64 字符（淘宝订单号 18 位 + 留余量）
   * - capability-gated：canPlatform=false → 静默落 null（与 platform 联动）
   */
  platformOrderNo: z.string().trim().min(0).max(64).nullable().optional(),
});

/**
 * 登录用户在 /image-gen 选完模板 + 规格 → 建 PENDING promptOrder 草稿。
 *
 * 行为：
 *   - 校验模板存在 + active
 *   - 校验三件套（productTypeCode / productSize / accessoryCode）
 *   - 按 catalog defaults 填 productSize / accessoryCode（如未传）
 *   - engraving 联动校验：canEngrave=false 时强制 null
 *   - 若当前 user 已有 PENDING / GENERATING / CANDIDATES_READY 订单，先清掉
 *     （同一时间一个用户只挂一张草稿）
 *
 * 返：{ orderId, token, productTypeCode, productSize, accessoryCode } 给客户端走
 *     /api/orders/[token]/upload + /image + /poll + /select 流程。
 */
export const createOrderFromImageGenAction = withOrderAction("create")
  .schema(createOrderSchema)
  .action(async ({ parsedInput, ctx }) => {
    // 1. 清旧草稿（一个用户同一时间只能挂一张草稿）
    await db
      .delete(promptOrder)
      .where(
        and(
          eq(promptOrder.createdBy, ctx.userId),
          inArray(promptOrder.status, [
            "PENDING",
            "GENERATING",
            "CANDIDATES_READY",
          ])
        )
      );

    // 2. 校验模板存在 + active；同时拉取 allowedSizes/allowedAccessories
    //    校验提交上来的 size/accessory 必须落在模板允许的子集内
    //    （2026-09-10：模板级可配置规格子集，避免选了 4cm 效果图却出 8cm 规格）。
    //    2026-09-12：拉 price 用于预先算 creditsCharged / creditsBreakdown，
    //    让用户在 PENDING 阶段就看到价格预估 + submit 时复用同一份定价。
    const template = await db.query.promptTemplate.findFirst({
      where: and(
        eq(promptTemplate.id, parsedInput.templateId),
        eq(promptTemplate.isActive, true)
      ),
      columns: {
        id: true,
        candidateCount: true,
        size: true,
        allowedSizes: true,
        allowedAccessories: true,
        price: true,
      },
    });
    if (!template) throw new Error("模板不存在或已停用");

    // 3. 三件套校验
    validateProductSpec(
      parsedInput.productTypeCode ?? null,
      parsedInput.productSize ?? null,
      parsedInput.accessoryCode ?? null
    );

    // 2026-09-10：解析模板级 allowedSizes/allowedAccessories 子集
    const allowedSizes = parseJsonStringArray(template.allowedSizes);
    const allowedAccessories = parseJsonStringArray(
      template.allowedAccessories
    );

    // 4. 按 catalog defaults 填 size / accessory（受 allowed 子集过滤）
    let finalProductSize = parsedInput.productSize ?? null;
    let finalAccessoryCode = parsedInput.accessoryCode ?? null;
    if (parsedInput.productTypeCode) {
      const type = getProductType(parsedInput.productTypeCode);
      if (type) {
        const sizesAvailable = type.sizes.filter((s) =>
          allowedSizes ? allowedSizes.includes(s) : true
        );
        const accessoriesAvailable = type.accessories.filter((a) =>
          allowedAccessories ? allowedAccessories.includes(a) : true
        );
        if (!finalProductSize && sizesAvailable.length > 0) {
          finalProductSize = sizesAvailable[0] ?? null;
        }
        if (!finalAccessoryCode && accessoriesAvailable.length > 0) {
          finalAccessoryCode = accessoriesAvailable[0] ?? null;
        }
      }
    }

    // 2026-09-10：兜底校验——若 client 传了 size/accessory 但不在子集内，直接拒
    if (
      finalProductSize &&
      allowedSizes &&
      !allowedSizes.includes(finalProductSize)
    ) {
      throw new Error(
        `模板仅允许尺寸：${allowedSizes.join("/")}cm，当前选择了 ${finalProductSize}cm`
      );
    }
    if (
      finalAccessoryCode &&
      allowedAccessories &&
      !allowedAccessories.includes(finalAccessoryCode)
    ) {
      throw new Error(`模板不允许该配件：${finalAccessoryCode}`);
    }

    // 5. engraving 联动校验
    let finalEngravingText = parsedInput.engravingText ?? null;
    let finalEngravingExposed = parsedInput.engravingExposed ?? null;
    if (parsedInput.productTypeCode) {
      const type = getProductType(parsedInput.productTypeCode);
      if (!type || !type.capabilities.canEngrave) {
        finalEngravingText = null;
        finalEngravingExposed = null;
      } else if (!finalEngravingText || finalEngravingText.trim() === "") {
        finalEngravingText = null;
        finalEngravingExposed = null;
      }
    } else {
      finalEngravingText = null;
      finalEngravingExposed = null;
    }

    // 5b. 2026-09-10：LB 皮革徽章定制联动（capability-gated，关闭的字段静默 collapse 为 null）
    let finalLeatherColor: string | null = null;
    let finalLeatherExposed: boolean | null = null;
    let finalPvcProtection: boolean | null = null;
    let finalRemarks: string | null = null;
    // 2026-09-11：订单来源平台（仅 LB canPlatform=true 接受）
    let finalPlatform: string | null = null;
    // 2026-09-11：渠道订单号（与 platform 配对；capability-gated）
    let finalPlatformOrderNo: string | null = null;
    if (parsedInput.productTypeCode) {
      const capType = getProductType(parsedInput.productTypeCode);
      if (capType) {
        if (capType.capabilities.canLeatherColor) {
          finalLeatherColor = parsedInput.leatherColor ?? null;
          validateLeatherColor(finalLeatherColor); // 字典外的 code 直接抛
        }
        if (capType.capabilities.canLeatherExposed) {
          finalLeatherExposed = parsedInput.leatherExposed === true;
        }
        if (capType.capabilities.canPvcProtection) {
          finalPvcProtection = parsedInput.pvcProtection === true;
        }
        // 2026-09-11：皮革外露 / PVC 保护互斥（二选一）。
        // UI 层 SpecModal 已经做了互斥，server 再兜一次挡绕过前端的脏请求。
        if (finalLeatherExposed === true && finalPvcProtection === true) {
          throw new Error("皮革外露 与 PVC 保护 不能同时勾选");
        }
        if (capType.capabilities.canHaveRemarks) {
          const trimmed = parsedInput.remarks?.trim();
          finalRemarks = trimmed && trimmed.length > 0 ? trimmed : null;
        }
        if (capType.capabilities.canPlatform) {
          finalPlatform = parsedInput.platform ?? null;
          if (finalPlatform) validatePlatform(finalPlatform); // 字典外的 code 抛
          // 渠道订单号：trim 后存；空串视为未填 → null
          const trimmedOrderNo = parsedInput.platformOrderNo?.trim();
          finalPlatformOrderNo =
            trimmedOrderNo && trimmedOrderNo.length > 0 ? trimmedOrderNo : null;
          // 业务规则：用户填了渠道订单号但没选 platform → 提示配对填写
          if (finalPlatformOrderNo && !finalPlatform) {
            throw new Error("填写渠道订单号时需同时选择订单来源平台");
          }
        }
      }
    }

    const token = generateOrderToken();

    // 2026-09-12：PENDING 阶段就预先算好本单定价，submit 时复用同一定价避免对账口径漂移。
    const priceResult = await computePromptOrderCredits(
      template.id,
      template.price ?? 0,
      {
        productTypeCode: parsedInput.productTypeCode ?? null,
        productSize: finalProductSize,
        accessoryCode: finalAccessoryCode,
        leatherColor: finalLeatherColor,
        leatherExposed: finalLeatherExposed,
        pvcProtection: finalPvcProtection,
      }
    );

    const [created] = await db
      .insert(promptOrder)
      .values({
        id: nanoid(),
        orderNo: generateOrderNo(),
        templateId: parsedInput.templateId,
        token,
        status: "PENDING",
        uploadCount: 1,
        imagesPerUpload: 3,
        regenerateLimit: 5,
        createdBy: ctx.userId,
        agentId: null,
        productTypeCode: parsedInput.productTypeCode ?? null,
        productSize: finalProductSize,
        accessoryCode: finalAccessoryCode,
        engravingText: finalEngravingText,
        engravingExposed: finalEngravingExposed,
        leatherColor: finalLeatherColor,
        leatherExposed: finalLeatherExposed,
        pvcProtection: finalPvcProtection,
        remarks: finalRemarks,
        // 2026-09-11：订单来源平台（PLATFORMS 字典 code）
        platform: finalPlatform,
        // 2026-09-11：渠道订单号（与 platform 配对）
        platformOrderNo: finalPlatformOrderNo,
        // 2026-09-12：本单价格预估（PENDING 阶段算好，submit 时直接读）
        creditsCharged: priceResult.totalCredits,
        creditsBreakdown: JSON.stringify(priceResult.breakdown),
      })
      .returning();

    if (!created) throw new Error("创建订单失败");

    revalidatePath("/image-gen");

    return {
      orderId: created.id,
      orderNo: created.orderNo,
      token: created.token,
      templateId: created.templateId,
      productTypeCode: created.productTypeCode,
      productSize: created.productSize,
      accessoryCode: created.accessoryCode,
    };
  });

// ============================================
// 提交订单
// ============================================

const submitOrderSchema = z.object({
  orderId: z.string().min(1),
});

/**
 * 用户在 /image-gen 工作台选完候选图后提交 → 扣个人 credit + SELECTED。
 *
 * 行为：
 *   - 校验订单归属（createdBy === ctx.userId）+ 状态（CANDIDATES_READY）
 *   - 扣 template.price 个人 credit（template.price === 0 时跳过）
 *   - promptOrder.status = SELECTED + selectedAt = now()
 *
 * 失败模式：
 *   - 订单不存在 / 不归属当前用户 → 抛错
 *   - 状态不对（必须 CANDIDATES_READY）→ 抛错
 *   - credit 不足 → 抛 InsufficientCreditsError，前端 toast
 *
 * 提交后留在 /image-gen 重置表单（用户选择"留在 /image-gen 试下一个效果"）。
 *   后续订单详情 / 改 engraving 走 /p/[token]。
 */
export const submitPublicOrderAction = withOrderAction("submit")
  .schema(submitOrderSchema)
  .action(async ({ parsedInput, ctx }) => {
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.id, parsedInput.orderId),
      with: {
        template: {
          columns: { id: true, name: true, price: true },
        },
      },
    });
    if (!order) throw new Error("订单不存在");
    if (order.createdBy !== ctx.userId) {
      throw new Error("无权操作此订单");
    }
    if (order.status !== "CANDIDATES_READY") {
      throw new Error(
        `当前状态（${order.status}）不允许提交，需先生成并选择候选图`
      );
    }

    // 扣个人 credit。优先读 promptOrder.creditsCharged（PENDING 阶段 createOrder
    // 已经算好的本单总价，submit 不重算避免对账口径漂移）；老订单该列为 null 时
    // 回退 template.price（兼容历史数据）。
    const creditsCharged =
      order.creditsCharged ?? order.template.price ?? 0;
    if (creditsCharged > 0) {
      try {
        // description 写规格摘要（与 submit-image-gen-demo 同口径）：
        //   "CM 皮革徽章 6cm · 皮套 · 黑色 · PVC 保护 = 164 积分"
        const specSummary = [
          order.template.name,
          order.productSize ? `${order.productSize}cm` : null,
          order.accessoryCode ? getAccessoryName(order.accessoryCode) : null,
          order.leatherColor ? getLeatherColorName(order.leatherColor) : null,
          order.leatherExposed === true ? "实物外露" : null,
          order.pvcProtection === true ? "PVC 保护" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const description = `${specSummary} = ${creditsCharged} 积分`;

        // metadata 解析 creditsBreakdown JSON（对账可见）
        let breakdownParsed: unknown = null;
        if (order.creditsBreakdown) {
          try {
            breakdownParsed = JSON.parse(order.creditsBreakdown);
          } catch {
            // 解析失败不阻塞扣减（极端脏数据）
          }
        }

        await consumeCredits({
          userId: ctx.userId,
          amount: creditsCharged,
          serviceName: "image-gen-workbench",
          description,
          metadata: {
            orderId: order.id,
            orderNo: order.orderNo,
            templateId: order.templateId,
            templateName: order.template.name,
            breakdown: breakdownParsed,
          },
        });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          throw new Error(
            `个人积分不足（需要 ${err.required}，当前可用 ${err.available}），请充值后再提交`
          );
        }
        throw err;
      }
    }

    await db
      .update(promptOrder)
      .set({
        status: "SELECTED",
        selectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    revalidatePath("/image-gen");
    revalidatePath(`/p/${order.token}`);

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: "SELECTED" as const,
      token: order.token,
      creditsConsumed: creditsCharged,
    };
  });

// ============================================
// 列出当前用户的草稿订单（页面挂载时恢复用）
// ============================================

/**
 * 列出当前登录用户的最近一个草稿订单（PENDING / GENERATING / CANDIDATES_READY）。
 * 刷新页面 / 重进 /image-gen 时用来恢复 stepper 状态。
 *
 * null 表示没草稿，要从 Step 1 开始。
 */
export const listUserDraftAction = withOrderAction("listDraft")
  .schema(z.object({}).optional())
  .action(async ({ ctx }) => {
    const order = await db.query.promptOrder.findFirst({
      where: and(
        eq(promptOrder.createdBy, ctx.userId),
        inArray(promptOrder.status, [
          "PENDING",
          "GENERATING",
          "CANDIDATES_READY",
        ])
      ),
      orderBy: desc(promptOrder.updatedAt),
      columns: {
        id: true,
        orderNo: true,
        token: true,
        status: true,
        productTypeCode: true,
        productSize: true,
        accessoryCode: true,
        engravingText: true,
        engravingExposed: true,
        // 2026-09-10：LB 皮革徽章扩展字段
        leatherColor: true,
        leatherExposed: true,
        pvcProtection: true,
        remarks: true,
        // 2026-09-11：订单来源平台（PLATFORMS 字典 code）
        platform: true,
        // 2026-09-11：渠道订单号（与 platform 配对）
        platformOrderNo: true,
        selectedIndex: true,
        templateId: true,
      },
    });
    return {
      draft: order
        ? {
            orderId: order.id,
            orderNo: order.orderNo,
            token: order.token,
            status: order.status,
            productTypeCode: order.productTypeCode,
            productSize: order.productSize,
            accessoryCode: order.accessoryCode,
            engravingText: order.engravingText,
            engravingExposed: order.engravingExposed,
            leatherColor: order.leatherColor,
            leatherExposed: order.leatherExposed,
            pvcProtection: order.pvcProtection,
            remarks: order.remarks,
            // 2026-09-11：订单来源平台（PLATFORMS 字典 code）
            platform: order.platform,
            // 2026-09-11：渠道订单号
            platformOrderNo: order.platformOrderNo,
            selectedIndex: order.selectedIndex,
            templateId: order.templateId,
          }
        : null,
    };
  });

// ============================================
// 列出当前用户的所有订单（/image-gen 右侧抽屉用）
// ============================================

/**
 * 列出当前登录用户的所有 promptOrder（按 createdAt desc），最多 50 条。
 *
 * 2026-09-10：替代「跳 /dashboard/prompt-orders」—— /image-gen demo 流的内嵌
 * 订单抽屉直接消费这个 action。每条订单返回：
 *   - orderId / orderNo / token（前端跳 /p/[token]）
 *   - status / productTypeCode / productSize / accessoryCode
 *   - thumbnailUrl（candidates[0][selectedIndex] 或 candidates[0][0]，
 *     demo 一键下单直接落 SELECTED + candidates=[[previewUrl]]）
 *   - templateName（join promptTemplate.name 显示）
 *   - createdAt
 *
 * agentId=null（代理商已砍），createdBy 限定当前用户。
 */
/**
 * /image-gen/orders 列表查询参数
 *
 * 2026-09-10：加 cursor 支持无限滚动（keyset pagination by (createdAt DESC, id DESC)）。
 * 客户端第一页 cursor 留空；后续每页传上一页最后一项的 cursor，服务端
 * 用 `(createdAt < cursor.createdAt) OR (createdAt = cursor.createdAt AND id < cursor.id)`
 * 过滤。比 offset 在大表上稳定——按 (created_by, created_at DESC, id DESC) 索引直接定位。
 */
const listUserOrdersSchema = z.object({
  /** 状态过滤（可选） */
  status: z
    .enum([
      "PENDING",
      "GENERATING",
      "CANDIDATES_READY",
      "SELECTED",
      "CANCELLED",
      "FAILED",
    ])
    .optional(),
  /**
   * 关键字搜索（订单号 like + 模板名 in 名字集合，两边都满足才返回）。
   * 模板名搜索走 SQL IN 子查询，避免全表 LIKE。
   */
  search: z.string().trim().max(64).optional(),
  /** 取多少条，默认 30（无限滚动友好） */
  limit: z.number().int().min(1).max(100).default(30),
  /**
   * 翻页游标：第一页不传；后续传上一页返回的 nextCursor。
   * Drizzle zod 不接 Date，要 ISO 字符串到 handler 里再 new Date()。
   */
  cursor: z
    .object({
      createdAt: z.string().datetime(),
      id: z.string(),
    })
    .optional(),
});

export const listUserOrdersAction = withOrderAction("listUserOrders")
  .schema(listUserOrdersSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { status, search, limit, cursor } = parsedInput;

    // 搜索时先查出匹配的 templateId 集合，再去过滤 promptOrder。
    // 避免 promptOrder.templateId 上做 join 而拖累主表查询。
    let matchingTemplateIds: string[] | null = null;
    if (search && search.length > 0) {
      const matches = await db
        .select({ id: promptTemplate.id })
        .from(promptTemplate)
        .where(like(promptTemplate.name, `%${search}%`));
      matchingTemplateIds = matches.map((m) => m.id);
      // 没有匹配模板 → 直接空集合返回
      if (matchingTemplateIds.length === 0) {
        return { orders: [], nextCursor: null };
      }
    }

    const whereClauses = [eq(promptOrder.createdBy, ctx.userId)];
    if (status) {
      whereClauses.push(eq(promptOrder.status, status));
    }
    if (search && search.length > 0) {
      // orderNo like  OR  templateId in matchingTemplateIds
      const orExpr = or(
        like(promptOrder.orderNo, `%${search}%`),
        inArray(promptOrder.templateId, matchingTemplateIds ?? [])
      );
      if (orExpr) whereClauses.push(orExpr);
    }
    // 2026-09-10：keyset cursor 过滤（id DESC 是 tiebreaker，防 createdAt 同毫秒撞行）
    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      whereClauses.push(
        or(
          lt(promptOrder.createdAt, cursorDate),
          and(
            eq(promptOrder.createdAt, cursorDate),
            lt(promptOrder.id, cursor.id)
          )
        )!
      );
    }

    // 拉 limit+1 行用于判断是否还有下一页；最后一条不返回，仅用来生成 nextCursor
    const rows = await db.query.promptOrder.findMany({
      where: and(...whereClauses),
      orderBy: [desc(promptOrder.createdAt), desc(promptOrder.id)],
      limit: limit + 1,
      columns: {
        id: true,
        orderNo: true,
        token: true,
        status: true,
        productTypeCode: true,
        productSize: true,
        accessoryCode: true,
        engravingText: true,
        engravingExposed: true,
        // 2026-09-10：LB 皮革徽章扩展字段
        leatherColor: true,
        leatherExposed: true,
        pvcProtection: true,
        remarks: true,
        // 2026-09-11：订单来源平台（PLATFORMS 字典 code）
        platform: true,
        // 2026-09-11：渠道订单号（与 platform 配对）
        platformOrderNo: true,
        // 2026-09-12：本单扣减积分（对账核心字段）+ 加价明细（按规格拆解）
        creditsCharged: true,
        creditsBreakdown: true,
        candidates: true,
        selections: true,
        selectedIndex: true,
        createdAt: true,
        templateId: true,
      },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastPageRow = pageRows.at(-1);
    const nextCursor =
      hasMore && lastPageRow
        ? {
            createdAt: lastPageRow.createdAt.toISOString(),
            id: lastPageRow.id,
          }
        : null;

    // 单独批量拉 template 名字（避免 relations 推断问题）
    const templateIds = [...new Set(pageRows.map((o) => o.templateId))];
    const templates =
      templateIds.length > 0
        ? await db.query.promptTemplate.findMany({
            where: inArray(promptTemplate.id, templateIds),
            // 2026-09-11：扩 candidateCount/outputMode 让 /image-gen/orders 详情按此决定要不要渲染 QuadrantGridPicker
            columns: {
              id: true,
              name: true,
              candidateCount: true,
              outputMode: true,
            },
          })
        : [];
    const templateMetaMap = new Map(templates.map((t) => [t.id, t]));

    return {
      orders: pageRows.map((o) => {
        // 解析所有候选图（详情视图要展示 grid）
        const allCandidates = parseCandidates(o.candidates);
        const selectedIdx = resolveSelectedImageIdx(
          o.selections,
          o.selectedIndex
        );
        // 2026-09-11：从 selections 派生 selectedCell：
        //   - demo 订单 candidates=[[composite]]，selections=[cellIndex] → selectedCell = cellIndex
        //   - gpt-image 订单 candidates=[[cand1,cand2,...]]，selections[imageIdx]=candIdx → selectedCell = candIdx
        // 两者语义一致：都是「这张图里选哪个候选/cell」
        const selectedCell = resolveSelectedCell(o.selections, selectedIdx);
        const tpl = templateMetaMap.get(o.templateId);
        const candidateCount = tpl?.candidateCount ?? 1;
        const outputMode = (tpl?.outputMode ?? "grid") as "grid" | "separate";
        return {
          orderId: o.id,
          orderNo: o.orderNo,
          token: o.token,
          status: o.status,
          productTypeCode: o.productTypeCode ?? null,
          productSize: o.productSize ?? null,
          accessoryCode: o.accessoryCode ?? null,
          engravingText: o.engravingText ?? null,
          engravingExposed: o.engravingExposed ?? null,
          // 2026-09-10：LB 皮革徽章扩展字段
          leatherColor: o.leatherColor ?? null,
          leatherExposed: o.leatherExposed ?? null,
          pvcProtection: o.pvcProtection ?? null,
          remarks: o.remarks ?? null,
          // 2026-09-11：订单来源平台（PLATFORMS 字典 code）
          platform: o.platform ?? null,
          // 2026-09-11：渠道订单号（与 platform 配对）
          platformOrderNo: o.platformOrderNo ?? null,
          // 2026-09-12：本单扣减积分 + 加价明细（对账核心字段）
          creditsCharged: o.creditsCharged ?? null,
          creditsBreakdown: o.creditsBreakdown ?? null,
          templateName: tpl?.name ?? "未知模板",
          templateId: o.templateId,
          // 2026-09-11：模板宫格候选数 + 输出模式（让 OrderDetailView 决定要不要 picker）
          candidateCount,
          outputMode,
          // 2026-09-11：已选 cell（demo 订单 = composite 内 cell；gpt-image = candIdx）
          selectedCell,
          // 列表缩略图：selected > [0][0]
          thumbnailUrl: extractOrderThumbnail(
            o.candidates,
            o.selections,
            o.selectedIndex
          ),
          // 详情用：所有候选图扁平化（[[url1, url2], [url3, url4]] → [url1, url2, url3, url4]）
          candidateUrls: allCandidates,
          selectedImageIdx: selectedIdx,
          createdAt: o.createdAt.toISOString(),
        };
      }),
      nextCursor,
    };
  });

/**
 * 从 promptOrder.candidates + selections 提取缩略图 URL。
 * 解析失败 / 空 → null。
 */
function extractOrderThumbnail(
  candidatesRaw: string | null,
  selectionsRaw: string | null,
  selectedIndex: number | null
): string | null {
  if (!candidatesRaw) return null;
  try {
    const candidates: unknown = JSON.parse(candidatesRaw);
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const firstImage = candidates[0];
    if (!Array.isArray(firstImage) || firstImage.length === 0) return null;
    const firstUrl = firstImage[0];
    if (typeof firstUrl !== "string") return null;

    // 优先 selections[selectedIndex]；否则取 candidates[0][0]
    if (selectionsRaw) {
      try {
        const selections: unknown = JSON.parse(selectionsRaw);
        if (
          Array.isArray(selections) &&
          typeof selectedIndex === "number" &&
          selectedIndex >= 0 &&
          selectedIndex < selections.length
        ) {
          // selections[imageIdx] 是 candIdx（数字）或者 null
          const candIdx = selections[selectedIndex];
          if (typeof candIdx === "number" && firstImage[candIdx]) {
            return firstImage[candIdx] as string;
          }
        }
      } catch {
        // ignore
      }
    }
    return firstUrl;
  } catch {
    return null;
  }
}

/**
 * 解析 candidates 嵌套数组 → 扁平 URL 数组。
 * candidates: [[url1, url2], [url3, url4]] → [url1, url2, url3, url4]
 * 解析失败 → []
 */
function parseCandidates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const flat: string[] = [];
    for (const group of parsed) {
      if (Array.isArray(group)) {
        for (const url of group) {
          if (typeof url === "string") flat.push(url);
        }
      }
    }
    return flat;
  } catch {
    return [];
  }
}

/**
 * 从 selections 数组解析出已选的 imageIdx（外层索引）。
 * 旧 schema 用 selectedIndex 单字段；新 schema 用 selections[imageIdx] = candIdx。
 * 兼容两者：有 selections 走 selections；否则用 selectedIndex。
 */
function resolveSelectedImageIdx(
  selectionsRaw: string | null,
  selectedIndex: number | null
): number {
  if (selectionsRaw) {
    try {
      const selections: unknown = JSON.parse(selectionsRaw);
      if (Array.isArray(selections)) {
        for (let i = 0; i < selections.length; i++) {
          if (typeof selections[i] === "number") return i;
        }
      }
    } catch {
      // ignore
    }
  }
  return selectedIndex ?? 0;
}

/**
 * 2026-09-11：从 selections 解析「已选 cell」索引（OrderDetailView 用）。
 * - demo 订单 candidates=[[composite]]，selections=[cellIndex] → selectedCell = cellIndex
 * - gpt-image 订单 candidates=[[cand1,cand2,...]]，selections[imageIdx]=candIdx → selectedCell = candIdx
 * - 老订单无 selections / 解析失败 → null（详情页用未选态渲染）
 */
function resolveSelectedCell(
  selectionsRaw: string | null,
  selectedImageIdx: number
): number | null {
  if (!selectionsRaw) return null;
  try {
    const selections: unknown = JSON.parse(selectionsRaw);
    if (!Array.isArray(selections)) return null;
    const cell = selections[selectedImageIdx];
    return typeof cell === "number" ? cell : null;
  } catch {
    return null;
  }
}

// ============================================
// helpers
// ============================================

/**
 * 生成订单号：IG-YYYYMMDD-XXXXXX（IG = ImageGen，XXXXXX = nanoid 6 位大写）
 * 与 admin createOrder 用 nanoid(8) 不同，方便视觉区分来源。
 */
function generateOrderNo(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 8);
  const rand = nanoid(6).toUpperCase();
  return `IG-${ts}-${rand}`;
}

/**
 * 把 accessory code 翻译成中文名（用于 creditsTransaction.description）。
 * 不在字典里时直接返回 code（罕见情况：脏数据）。
 */
function getAccessoryName(code: string): string {
  return getAccessory(code)?.name ?? code;
}

/**
 * 把 leather color code 翻译成中文名（用于 creditsTransaction.description）。
 */
function getLeatherColorName(code: string): string {
  return getLeatherColor(code)?.name ?? code;
}

/**
 * 解析 JSON 字符串数组列（与 db-effects.ts / submit-image-gen-demo 同名 helper）。
 * null/空字符串/解析失败 → null（表示「不限制 / 字典全量」）。
 */
function parseJsonStringArray(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
    return null;
  } catch {
    return null;
  }
}
