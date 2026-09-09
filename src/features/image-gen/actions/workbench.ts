"use server";

/**
 * 2026-09-08：用户维度 workbench Server Actions
 *
 * 背景：原 /p/agent/[token] + agent-workbench 已彻底砍掉（见 plan
 * `snoopy-wiggling-volcano.md`）。新 workbench 把任何登录用户当作"用户
 * + 模板自选 + 个人 credit 扣费"的形态，承担原本 (agent) 业务的 workbench 流程。
 *
 * 范围（v0 最小可用版）：
 * - listUserWorkbenchAction：返回可服务模板 + 当前草稿订单（如有）
 * - createUserDraftOrderAction：登录用户在 workbench 选模板 → 建 promptOrder 草稿
 * - submitUserDraftOrderAction：草稿跑完上传/生成/选择/configure 后，最终提交并扣个人 credit
 *
 * 不在 v0：
 * - 个人 credit 不足自动引导充值（暂走 InsufficientCreditsError 抛错 + UI 提示）
 * - 草稿订单超时清理（待用户二次确认需求）
 * - 提交后再编辑（业务方明确 SELECTED 后锁死）
 *
 * 设计要点：
 * 1. 所有 action 走 protectedAction（需登录），不要 token 直传。
 * 2. promptOrder.agentId 永远写 null（业务方明确 ToB 砍了）。
 * 3. 个人 credit 扣费走现有 consumeCredits（已有事务 + FIFO + 余额校验）。
 * 4. 状态机：PENDING → CANDIDATES_READY（poll 路径写） → SELECTED（submit 写）。
 *    submit 必须在 status=CANDIDATES_READY 且 selections 全填，否则 400。
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { promptOrder, promptTemplate } from "@/db/schema";
import {
  consumeCredits,
  InsufficientCreditsError,
} from "@/features/credits/core";
import {
  countCandidateGroups,
  countSelections,
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import {
  getProductType,
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
import { protectedAction } from "@/lib/safe-action";

const withWorkbenchAction = (name: string) =>
  protectedAction.metadata({ action: `imageGen.workbench.${name}` });

// ============================================
// 列表：active 模板 + 当前用户草稿订单
// ============================================

/**
 * 返回 workbench 启动页所需的全部数据：
 * - templates：所有 active 模板（不含 prompt —— 用户端不能看，UI 上只展示 name/cover）
 * - draftOrder：当前 user 最近一个进行中的订单（PENDING / GENERATING /
 *   CANDIDATES_READY），后续步骤在 order 上下文中继续；null 表示要进
 *   TemplateSelectStep 选模板。
 *
 * 为什么不返回 prompt：模板 prompt 是商家资产，不应对个人用户暴露。变量替换逻辑
 * 在服务端 /upload + /poll 链路里完成，prompt 始终留在服务端。
 */
export const listUserWorkbenchAction = withWorkbenchAction("list")
  .schema(z.object({}).optional())
  .action(async ({ ctx }) => {
    const templates = await db
      .select({
        id: promptTemplate.id,
        name: promptTemplate.name,
        description: promptTemplate.description,
        size: promptTemplate.size,
        candidateCount: promptTemplate.candidateCount,
        coverUrl: promptTemplate.coverUrl,
        outputMode: promptTemplate.outputMode,
        // 个人 workbench 也要展示价格（用户付得起才接）
        price: promptTemplate.price,
        // 商品类别：选完后跳到 SpecSelectStep 时按这个分支
        productTypeCode: promptTemplate.productTypeCode,
      })
      .from(promptTemplate)
      .where(eqActiveTemplate())
      .orderBy(desc(promptTemplate.createdAt));

    const draftOrder = await db.query.promptOrder.findFirst({
      where: and(
        eq(promptOrder.createdBy, ctx.userId),
        inArray(promptOrder.status, [
          "PENDING",
          "GENERATING",
          "CANDIDATES_READY",
        ])
      ),
      orderBy: desc(promptOrder.updatedAt),
      with: {
        template: {
          columns: {
            id: true,
            name: true,
            description: true,
            coverUrl: true,
            candidateCount: true,
            size: true,
            outputMode: true,
          },
        },
      },
    });

    return {
      templates: templates.map((t) => ({
        ...t,
        outputMode: (t.outputMode as "grid" | "separate") ?? "grid",
      })),
      draftOrder: draftOrder
        ? {
            id: draftOrder.id,
            token: draftOrder.token,
            templateId: draftOrder.templateId,
            status: draftOrder.status,
            productTypeCode: draftOrder.productTypeCode,
            productSize: draftOrder.productSize,
            accessoryCode: draftOrder.accessoryCode,
            uploadCount: draftOrder.uploadCount,
            imagesPerUpload: draftOrder.imagesPerUpload,
            uploadedImageCount: parseUploadedImages(draftOrder.uploadedImages)
              .length,
            selections: countSelections(parseSelections(draftOrder.selections)),
            candidateGroups: countCandidateGroups(
              parseCandidates(draftOrder.candidates)
            ),
            engravingText: draftOrder.engravingText ?? null,
            engravingExposed: draftOrder.engravingExposed ?? null,
            template: draftOrder.template,
          }
        : null,
    };
  });

// ============================================
// 历史订单：用户提交过的所有非草稿订单
// ============================================

/**
 * 列出当前登录用户提交过的订单（排除 PENDING / GENERATING /
 * CANDIDATES_READY 草稿 —— 那些在 listUserWorkbenchAction 里另外返回）。
 * 倒序按 createdAt 排，最多 50 条。
 *
 * 与 admin listOrders 的区别：
 * - 永远 createdBy=ctx.userId（service 层强制），无法 skipCreatorFilter
 * - 永远不返 prompt 字段（同 listUserWorkbenchAction 理由）
 * - 不返 history 表内容（用户不该看见自己的尝试次数明细）
 *
 * UI 上「我的订单」用。每行展示 orderNo / 模板名 / productTypeCode / status /
 * 提交时间；点 token 跳 /p/[token] 看完整订单。
 */
export const listUserOrderHistoryAction = withWorkbenchAction("listHistory")
  .schema(z.object({}).optional())
  .action(async ({ ctx }) => {
    const orders = await db.query.promptOrder.findMany({
      where: and(
        eq(promptOrder.createdBy, ctx.userId),
        inArray(promptOrder.status, [
          "SELECTED",
          "CANCELLED",
          "FAILED",
        ])
      ),
      orderBy: desc(promptOrder.createdAt),
      limit: 50,
      columns: {
        id: true,
        orderNo: true,
        token: true,
        status: true,
        productTypeCode: true,
        productSize: true,
        accessoryCode: true,
        engravingText: true,
        selectedAt: true,
        cancelledAt: true,
        createdAt: true,
      },
      with: {
        template: {
          columns: {
            id: true,
            name: true,
            coverUrl: true,
          },
        },
      },
    });

    return {
      orders: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        token: o.token,
        status: o.status,
        productTypeCode: o.productTypeCode,
        productSize: o.productSize,
        accessoryCode: o.accessoryCode,
        engravingText: o.engravingText ?? null,
        selectedAt: o.selectedAt?.toISOString() ?? null,
        cancelledAt: o.cancelledAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
        template: o.template,
      })),
    };
  });

// ============================================
// 建草稿
// ============================================

const createDraftSchema = z.object({
  templateId: z.string().min(1),
  // 商品型号可选 —— ToC 模板可不传，ToB 模板（带 productTypeCode）建议传
  productTypeCode: z.string().min(1).max(8).nullable().optional(),
  productSize: z.string().min(1).max(8).nullable().optional(),
  accessoryCode: z.string().min(1).max(16).nullable().optional(),
});

/**
 * 用户在 workbench TemplateSelectStep 选完模板 → 创建 promptOrder 草稿。
 *
 * 与 admin createOrderAction 的区别：
 * - 不传 createdBy（从 ctx.userId 拿）
 * - agentId 写 null
 * - 上传数量 / 平台 / recipientName 等都走默认值（workbench 自助流程，
 *   用户不用填这些字段；recipientName 在 SELECTED 后由 admin 补）
 *
 * 若当前 user 已有 PENDING/GENERATING/CANDIDATES_READY 订单，先清掉
 * （删 SELECTED / CANCELLED 历史以外的草稿，防止一个用户堆 N 张草稿）。
 *
 * 失败模式：
 * - 模板不存在 / 未激活 → 抛错
 * - productTypeCode 非法（不在 catalog）→ 抛错
 * - 三件套校验失败 → 抛错
 */
export const createUserDraftOrderAction = withWorkbenchAction("createDraft")
  .schema(createDraftSchema)
  .action(async ({ parsedInput, ctx }) => {
    // 清旧草稿：避免一个用户挂多张草稿导致工作台状态错乱
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

    // 校验模板存在 + active
    const template = await db.query.promptTemplate.findFirst({
      where: and(
        eq(promptTemplate.id, parsedInput.templateId),
        eq(promptTemplate.isActive, true)
      ),
      columns: {
        id: true,
        candidateCount: true,
        size: true,
      },
    });
    if (!template) throw new Error("模板不存在或已停用");

    // 校验三件套（无 productTypeCode 时 productSize/accessoryCode 必须都为空）
    validateProductSpec(
      parsedInput.productTypeCode ?? null,
      parsedInput.productSize ?? null,
      parsedInput.accessoryCode ?? null
    );

    // 若只传 productTypeCode 自动按 catalog defaults 填 size/accessory
    let finalProductSize = parsedInput.productSize ?? null;
    let finalAccessoryCode = parsedInput.accessoryCode ?? null;
    if (parsedInput.productTypeCode && !finalProductSize) {
      const type = getProductType(parsedInput.productTypeCode);
      if (type && type.sizes.length > 0) {
        finalProductSize = type.sizes[0] ?? null;
      }
    }
    if (parsedInput.productTypeCode && !finalAccessoryCode) {
      const type = getProductType(parsedInput.productTypeCode);
      if (type && type.accessories.length > 0) {
        finalAccessoryCode = type.accessories[0] ?? null;
      }
    }

    const token = generateOrderTokenLocal();

    const [created] = await db
      .insert(promptOrder)
      .values({
        id: nanoid(),
        orderNo: generateOrderNoLocal(),
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
      })
      .returning();

    if (!created) throw new Error("创建草稿订单失败");

    revalidatePath("/image-gen");
    revalidateTag("orders", "max");

    return {
      order: {
        id: created.id,
        token: created.token,
        status: created.status,
        templateId: created.templateId,
        productTypeCode: created.productTypeCode,
        productSize: created.productSize,
        accessoryCode: created.accessoryCode,
        uploadCount: created.uploadCount,
        imagesPerUpload: created.imagesPerUpload,
      },
    };
  });

// ============================================
// 更新草稿规格：用户在 workbench 主页的「选规格」UI 改三件套
// ============================================

const updateSpecSchema = z.object({
  orderId: z.string().min(1),
  // 三件套：productTypeCode 创建时定死（来自模板绑定或「选型号」弹窗），
  // 这里只允许改 size + accessory（按 catalog 校验）
  productSize: z.string().min(1).max(8).nullable().optional(),
  accessoryCode: z.string().min(1).max(16).nullable().optional(),
});

/**
 * 2026-09-09：workbench 主页的「选规格」UI 调这个 action 覆盖三件套。
 * 与 admin updateOrder 的区别：
 * - 永远 createdBy=ctx.userId 校验（防越权改别人的草稿）
 * - 仅 PENDING / CANDIDATES_READY 状态可改（GENERATING 锁死防 race）
 * - 不返 prompt / history 等敏感字段（同 listUserWorkbenchAction 原则）
 *
 * 替代路径：用户也可去 /p/[token] 调 /api/orders/[token]/configure 改 engravingText
 * （不走本 action）。
 */
export const updateUserDraftSpecAction = withWorkbenchAction("updateSpec")
  .schema(updateSpecSchema)
  .action(async ({ parsedInput, ctx }) => {
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.id, parsedInput.orderId),
      columns: {
        id: true,
        createdBy: true,
        status: true,
        productTypeCode: true,
        productSize: true,
        accessoryCode: true,
      },
    });
    if (!order) throw new Error("订单不存在");
    if (order.createdBy !== ctx.userId) {
      throw new Error("无权操作此订单");
    }
    if (
      order.status !== "PENDING" &&
      order.status !== "CANDIDATES_READY"
    ) {
      throw new Error(`当前状态（${order.status}）不允许修改规格`);
    }

    // 校验三件套（productTypeCode 来自订单本身）
    validateProductSpec(
      order.productTypeCode ?? null,
      parsedInput.productSize ?? order.productSize ?? null,
      parsedInput.accessoryCode ?? order.accessoryCode ?? null
    );

    await db
      .update(promptOrder)
      .set({
        productSize: parsedInput.productSize ?? order.productSize ?? null,
        accessoryCode:
          parsedInput.accessoryCode ?? order.accessoryCode ?? null,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    revalidatePath("/image-gen");
    revalidateTag("orders", "max");

    return { success: true };
  });

// ============================================
// 提交：扣个人 credit + 状态推进
// ============================================

const submitDraftSchema = z.object({
  orderId: z.string().min(1),
  /**
   * 提交时用户可在 SpecSelectStep 调整三件套 —— createDraft 阶段已落默认值，
   * 这里允许覆盖（与 admin 编辑存量订单语义一致）。
   */
  productSize: z.string().min(1).max(8).nullable().optional(),
  accessoryCode: z.string().min(1).max(16).nullable().optional(),
  // 终端用户在 submit 前可在 /p/[token] 上填的定制字段（call site 透传）
  engravingText: z.string().trim().max(40).nullable().optional(),
  engravingExposed: z.boolean().nullable().optional(),
});

/**
 * workbench 流程的最终提交：把草稿订单推到 SELECTED + 扣个人 credit。
 *
 * 流程：
 *   1. 校验订单归属（必须 createdBy === ctx.userId）+ 状态（CANDIDATES_READY）
 *   2. 校验三件套（覆盖 createDraft 阶段填的默认值）+ 定制字段联动
 *   3. 扣 template.price 个人 credit（template.price === 0 时跳过）
 *   4. promptOrder.status = SELECTED + selectedAt = now()
 *
 * 注：credit 不足抛 InsufficientCreditsError，由前端 toast 提示。
 * 提交失败不会回滚订单状态（SELECTED 是终态前最后一站，不能让用户重提）。
 */
export const submitUserDraftOrderAction = withWorkbenchAction("submitDraft")
  .schema(submitDraftSchema)
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

    // 校验三件套：覆盖 createDraft 阶段填的 productSize / accessoryCode
    validateProductSpec(
      order.productTypeCode ?? null,
      parsedInput.productSize ?? order.productSize ?? null,
      parsedInput.accessoryCode ?? order.accessoryCode ?? null
    );

    // 校验定制字段联动：刻字 / 外露必须按 productTypeCode 的 capabilities 走
    let finalEngravingText =
      parsedInput.engravingText ?? order.engravingText ?? null;
    let finalEngravingExposed =
      parsedInput.engravingExposed ?? order.engravingExposed ?? null;
    if (order.productTypeCode) {
      const type = getProductType(order.productTypeCode);
      if (type && !type.capabilities.canEngrave) {
        // 不支持刻字的型号强制清空
        finalEngravingText = null;
        finalEngravingExposed = null;
      } else if (!finalEngravingText || finalEngravingText.trim() === "") {
        // 没填刻字文本时外露也置 null（联动）
        finalEngravingText = null;
        finalEngravingExposed = null;
      }
    } else {
      // 无型号（ToC）不接受定制
      finalEngravingText = null;
      finalEngravingExposed = null;
    }

    // 扣个人 credit（template.price === 0 跳过）
    const price = order.template.price ?? 0;
    if (price > 0) {
      try {
        await consumeCredits({
          userId: ctx.userId,
          amount: price,
          serviceName: "image-gen-workbench",
          description: `workbench 提交订单 ${order.orderNo}`,
          metadata: {
            orderId: order.id,
            orderNo: order.orderNo,
            templateId: order.templateId,
            templateName: order.template.name,
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

    // 状态推进 + 字段覆盖
    await db
      .update(promptOrder)
      .set({
        status: "SELECTED",
        selectedAt: new Date(),
        productSize: parsedInput.productSize ?? order.productSize ?? null,
        accessoryCode: parsedInput.accessoryCode ?? order.accessoryCode ?? null,
        engravingText: finalEngravingText,
        engravingExposed: finalEngravingExposed,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    revalidatePath("/image-gen");
    revalidateTag("orders", "max");

    return {
      orderId: order.id,
      status: "SELECTED" as const,
      creditsConsumed: price,
    };
  });

// ============================================
// 内部 helpers（避免拉取外部模块依赖）
// ============================================

function eqActiveTemplate() {
  return eq(promptTemplate.isActive, true);
}

/**
 * 生图订单 token —— 与 /features/gpt-image/lib/generation-service.ts
 * 的 generateOrderToken 同形态（16 位 URL-safe），避免拉模块依赖。
 */
function generateOrderTokenLocal(): string {
  return nanoid(16);
}

function generateOrderNoLocal(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  const rand = nanoid(6).toUpperCase();
  return `WB-${ts}-${rand}`;
}
