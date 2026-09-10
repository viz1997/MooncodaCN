"use server";

/**
 * 生图业务 Admin Server Actions
 *
 * 供 Admin 面板管理产品效果模板、查看模型配置
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createEffectInDb,
  deleteEffectInDb,
  findEffectInDb,
  getEffectsFromDb,
  updateEffectInDb,
} from "@/features/image-gen/lib/db-effects";
import type {
  ProductEffect,
  PromptScene,
  PromptVersion,
} from "@/features/image-gen/lib/product-effect-types";
import { PROMPT_SCENE_LABELS } from "@/features/image-gen/lib/product-effect-types";
import { adminAction } from "@/lib/safe-action";

const withImageGenAdminAction = (name: string) =>
  adminAction.metadata({ action: `imageGenAdmin.${name}` });

/**
 * 获取所有产品效果模板
 */
export const listProductEffectsAdminAction = withImageGenAdminAction(
  "listProductEffects"
)
  .schema(z.void().optional())
  .action(async () => {
    const effects = await getEffectsFromDb();
    return { effects };
  });

/**
 * 获取单个产品效果模板
 */
export const getProductEffectAdminAction = withImageGenAdminAction(
  "getProductEffect"
)
  .schema(z.object({ maskId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const { findEffectInDb } = await import(
      "@/features/image-gen/lib/db-effects"
    );
    const effect = await findEffectInDb(parsedInput.maskId);
    if (!effect) {
      throw new Error("效果模板不存在");
    }
    return { effect };
  });

const productEffectFormSchema = z.object({
  maskId: z.string().min(1),
  name: z.string().min(1),
  category: z.string().default("其他"),
  description: z.string().default(""),
  previewUrl: z.string().default(""),
  prompt: z.string().min(1),
  variables: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().default(""),
        description: z.string().default(""),
        defaultValue: z.string().default(""),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional(),
      })
    )
    .default([]),
  model: z.string().nullable().default(null),
  scene: z
    .enum(Object.keys(PROMPT_SCENE_LABELS) as [PromptScene, ...PromptScene[]])
    .default("generate_2d"),
  config: z
    .object({
      style: z.string().default("custom"),
      color: z.string().optional(),
      material: z.string().optional(),
    })
    .default({ style: "custom" }),
  price: z.number().int().min(0).default(0),
  status: z.enum(["active", "inactive"]).default("active"),
  author: z.string().default("admin"),
  productLineIds: z.array(z.string()).default([]),
  /**
   * 2026-09-10：绑产品型号（PRODUCT_TYPES 字典里的 code，如 "R"/"A"/"P"/"RM"/"LB"）。
   * 绑了之后 /image-gen demo 流的 SpecModal 会按字典自动渲染尺寸 + 配件 + 刻字。
   * null = 老 ToC 模板（无规格，spec 全 null）。
   */
  productTypeCode: z.string().nullable().default(null),
  /**
   * 2026-09-10：该模板允许的尺寸子集（cm 数字字符串数组，与 PRODUCT_TYPES 字典对齐）。
   * - null/[] → 不限制，按 productTypeCode 字典全量提供
   * - ["6"] → 只允许 6cm，SpecModal 只渲染这一个选项
   */
  allowedSizes: z.array(z.string()).nullable().default(null),
  /**
   * 2026-09-10：该模板允许的配件子集（code 字符串数组，与 ACCESSORIES 字典对齐）。
   * - null/[] → 不限制，按 productTypeCode 字典全量提供
   * - ["leather"] → 只允许皮套，SpecModal 只渲染这一个选项
   */
  allowedAccessories: z.array(z.string()).nullable().default(null),
  versions: z
    .array(
      z.object({
        version: z.string().min(1),
        content: z.string().min(1),
        createdAt: z.string(),
        note: z.string().optional(),
      })
    )
    .default([]),
});

/**
 * 新增版本
 */
export const addProductEffectVersionAction = withImageGenAdminAction(
  "addProductEffectVersion"
)
  .schema(
    z.object({
      maskId: z.string().min(1),
      content: z.string().min(1),
      version: z.string().min(1),
      note: z.string().optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const { maskId, content, version, note } = parsedInput;
    const existing = await findEffectInDb(maskId);
    if (!existing) throw new Error("效果模板不存在");
    const newVersion: PromptVersion = {
      version,
      content,
      createdAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    const updated = await updateEffectInDb(maskId, {
      prompt: content,
      versions: [...existing.versions, newVersion],
    });
    revalidatePath(`/admin/product-effects/${maskId}`);
    revalidatePath("/admin/product-effects");
    return { effect: updated };
  });

/**
 * 创建产品效果模板
 */
export const createProductEffectAdminAction = withImageGenAdminAction(
  "createProductEffect"
)
  .schema(productEffectFormSchema)
  .action(async ({ parsedInput }) => {
    const effect: ProductEffect = {
      maskId: parsedInput.maskId,
      name: parsedInput.name,
      category: parsedInput.category,
      description: parsedInput.description,
      previewUrl: parsedInput.previewUrl,
      prompt: parsedInput.prompt,
      variables: parsedInput.variables.map((v) => ({
        ...v,
        options: v.options ?? [],
      })),
      model: parsedInput.model ?? "",
      config: parsedInput.config,
      price: parsedInput.price,
      status: parsedInput.status,
      author: parsedInput.author,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scene: parsedInput.scene,
      versions: parsedInput.versions ?? [],
      usageCount: 0,
      successRate: 0,
      avgDuration: 0,
      productLineIds: parsedInput.productLineIds ?? [],
      productTypeCode: parsedInput.productTypeCode ?? null,
      // 2026-09-10：可配置尺寸 + 配件子集（null → undefined，匹配 ProductEffect 类型）
      allowedSizes: parsedInput.allowedSizes ?? undefined,
      allowedAccessories: parsedInput.allowedAccessories ?? undefined,
    };

    const created = await createEffectInDb(effect);
    revalidatePath("/admin/product-effects");
    return { effect: created };
  });

/**
 * 更新产品效果模板
 */
export const updateProductEffectAdminAction = withImageGenAdminAction(
  "updateProductEffect"
)
  .schema(
    z.object({
      maskId: z.string().min(1),
      updates: productEffectFormSchema.partial(),
    })
  )
  .action(async ({ parsedInput }) => {
    const { maskId, updates } = parsedInput;

    const updatePayload: Partial<ProductEffect> = {};
    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.category !== undefined)
      updatePayload.category = updates.category;
    if (updates.description !== undefined)
      updatePayload.description = updates.description;
    if (updates.previewUrl !== undefined)
      updatePayload.previewUrl = updates.previewUrl;
    if (updates.prompt !== undefined) updatePayload.prompt = updates.prompt;
    if (updates.variables !== undefined)
      updatePayload.variables = updates.variables.map((v) => ({
        ...v,
        options: v.options ?? [],
      }));
    if (updates.model !== undefined) updatePayload.model = updates.model ?? "";
    if (updates.scene !== undefined) updatePayload.scene = updates.scene;
    if (updates.config !== undefined) updatePayload.config = updates.config;
    if (updates.price !== undefined) updatePayload.price = updates.price;
    if (updates.status !== undefined) updatePayload.status = updates.status;
    if (updates.author !== undefined) updatePayload.author = updates.author;
    if (updates.productLineIds !== undefined)
      updatePayload.productLineIds = updates.productLineIds;
    if (updates.productTypeCode !== undefined)
      updatePayload.productTypeCode = updates.productTypeCode;
    // 2026-09-10：可配置尺寸 + 配件子集（null 表示不限制 / 字典全量）
    if (updates.allowedSizes !== undefined)
      updatePayload.allowedSizes = updates.allowedSizes ?? undefined;
    if (updates.allowedAccessories !== undefined)
      updatePayload.allowedAccessories =
        updates.allowedAccessories ?? undefined;
    if (updates.versions !== undefined)
      updatePayload.versions = updates.versions;

    const updated = await updateEffectInDb(maskId, updatePayload);
    if (!updated) {
      throw new Error("效果模板不存在");
    }

    revalidatePath("/admin/product-effects");
    revalidatePath(`/admin/product-effects/${maskId}`);
    return { effect: updated };
  });

/**
 * 删除产品效果模板
 */
export const deleteProductEffectAdminAction = withImageGenAdminAction(
  "deleteProductEffect"
)
  .schema(z.object({ maskId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const deleted = await deleteEffectInDb(parsedInput.maskId);
    if (!deleted) {
      throw new Error("效果模板不存在");
    }
    revalidatePath("/admin/product-effects");
    return { success: true };
  });
