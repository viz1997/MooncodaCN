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

import { and, desc, eq, inArray } from "drizzle-orm";
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
  getProductType,
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
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

    const token = generateOrderToken();

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

    // 扣个人 credit（template.price === 0 跳过）
    const price = order.template.price ?? 0;
    if (price > 0) {
      try {
        await consumeCredits({
          userId: ctx.userId,
          amount: price,
          serviceName: "image-gen-workbench",
          description: `/image-gen 工作台提交订单 ${order.orderNo}`,
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
      creditsConsumed: price,
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
export const listUserOrdersAction = withOrderAction("listUserOrders")
  .schema(z.object({}).optional())
  .action(async ({ ctx }) => {
    const rows = await db.query.promptOrder.findMany({
      where: eq(promptOrder.createdBy, ctx.userId),
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
        candidates: true,
        selections: true,
        selectedIndex: true,
        createdAt: true,
        templateId: true,
      },
      with: {
        template: { columns: { name: true } },
      },
    });
    return {
      orders: rows.map((o) => ({
        orderId: o.id,
        orderNo: o.orderNo,
        token: o.token,
        status: o.status,
        productTypeCode: o.productTypeCode ?? null,
        productSize: o.productSize ?? null,
        accessoryCode: o.accessoryCode ?? null,
        templateName: o.template.name,
        templateId: o.templateId,
        // 缩略图：candidates 是嵌套数组 [[url1, url2, ...]]（外层 imageIdx，
        // 内层 candIdx）；demo 模式下 candidates=[[previewUrl]] 长度=1。
        // 优先用 selections[selectedIndex]，否则用 candidates[0][0]。
        thumbnailUrl: extractOrderThumbnail(
          o.candidates,
          o.selections,
          o.selectedIndex
        ),
        createdAt: o.createdAt.toISOString(),
      })),
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
