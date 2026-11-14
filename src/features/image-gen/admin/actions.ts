"use server";

/**
 * 生图业务 Admin Server Actions
 *
 * 供 Admin 面板管理产品效果模板、查看模型配置
 */

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { promptTemplate, promptTemplatePrice } from "@/db/schema";
import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";
import type { AdminCatalogErrorCode } from "@/features/image-gen/admin/types";
import {
  accessoryExists,
  deactivateProductAccessoryRow,
  deactivateProductAccessoryVariantRow,
  deactivateProductSizeRow,
  findConflictingVariantCode,
  productExists,
  readAccessoryVariantRow,
  readAdminCatalogRows,
  readProductBasePriceCents,
  setProductAccessoryOptionRow,
  upsertProductAccessoryRow,
  upsertProductAccessoryVariantRow,
  upsertProductSizeRow,
} from "@/features/image-gen/lib/catalog-dictionary-admin";
import { getCatalogDictionaryFresh } from "@/features/image-gen/lib/catalog-dictionary-store";
import {
  createEffectInDb,
  deleteEffectInDb,
  getEffectsFromDb,
  updateEffectInDb,
} from "@/features/image-gen/lib/db-effects";
import {
  createLineInDb,
  deleteLineInDb,
  findLineInDb,
  getActiveLinesFromDb,
  getLinesFromDb,
  updateLineInDb,
} from "@/features/image-gen/lib/db-lines";
import {
  bulkUpdateVariantsInDb,
  createProductInDb,
  deleteProductInDb,
  findProductInDb,
  generateVariantsForProductInDb,
  getProductsFromDb,
  getVariantsFromDb,
  recomputeProductVariantPricesInDb,
  updateProductInDb,
} from "@/features/image-gen/lib/db-products";
import {
  createExternalApiKey as createExternalApiKeyInDb,
  listExternalApiKeys as listExternalApiKeysInDb,
  parseAllowedMasks,
  softDeleteExternalApiKey as softDeleteExternalApiKeyInDb,
  updateExternalApiKey as updateExternalApiKeyInDb,
} from "@/features/image-gen/lib/external-api-key-service";
import {
  isSuspiciousCustomerName,
  SUSPICIOUS_CUSTOMER_NAME_MESSAGE_SERVER,
} from "@/features/image-gen/lib/external-api-key-validation";
import type {
  ProductEffect,
  ProductLine,
  ProductLinePricing,
  ProductLineSpec,
  PromptScene,
} from "@/features/image-gen/lib/product-effect-types";
import { PROMPT_SCENE_LABELS } from "@/features/image-gen/lib/product-effect-types";
import { describeDbError } from "@/features/shared/lib/db-error";
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
  // 2026-09-14：删除 prompt 字段 —— 提示词内容由 promptTemplateId 关联的 promptTemplate.prompt 提供（必填）。
  // productEffect 不再独立存提示词文本。
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
  /**
   * 2026-09-10：模板级 capability 覆盖（Partial<ProductCapabilities>）。
   * - null → 继承 catalog 默认（productTypeCode 对应 PRODUCT_TYPES 字典）
   * - 非 null → 只覆盖 override 里出现的 key；canEngrave 不在覆盖范围
   *   （避免和现有刻字字段冲突，沿用 catalog）
   * 例：{ canLeatherColor: true, canPvcProtection: true } → 关掉皮革外露 / 备注
   * 2026-09-11：加 canPlatform 字段（订单来源平台，PLATFORMS 字典），
   * admin 可在 LB 模板级关掉这个开关（比如临时让一个 LB 模板不让用户选渠道）。
   */
  allowedCapabilities: z
    .object({
      canLeatherColor: z.boolean().optional(),
      canLeatherExposed: z.boolean().optional(),
      canPvcProtection: z.boolean().optional(),
      canHaveRemarks: z.boolean().optional(),
      canPlatform: z.boolean().optional(),
    })
    .nullable()
    .default(null),
  /**
   * 2026-09-10：皮革颜色子集（code 字符串数组，与 LEATHER_COLORS 字典对齐）。
   * - null/[] → LEATHER_COLORS 全展示
   * - ["brown","black"] → 只允许棕/黑（不在字典里的 code 会被静默丢弃）
   */
  allowedColors: z.array(z.string()).nullable().default(null),
  /**
   * 2026-09-10：引用 promptTemplate.id（gpt-image 模块的提示词模板表）。
   * 生成时优先用 promptTemplate.prompt。
   *
   * 2026-09-12：改为必填 —— 公开 demo 下单 action 写 promptOrder.templateId
   * 会被 promptTemplate 外键 FK 校验拦下（onDelete restrict），必须先有
   * promptTemplate 行才能落单；旧 admin 手工录入未绑的 productEffect
   * 下单时直接 throw「模板不存在或已停用」。强制必填挡住新录入没绑的漏网之鱼，
   * 旧存量通过 scripts/list-effects-without-template.ts 让 admin 手工补。
   *
   * 2026-09-14：移除本地 prompt 兜底（promptTemplateId 必填 → 一定有值）。
   */
  promptTemplateId: z.string().min(1),
  // 2026-09-14：删除 versions[] 字段 —— 生成时不读 productEffect.versions[]（仅 promptTemplate.prompt 生效），
  // form UI 已移除「新增版本」入口，schema 同步收口，避免 admin 通过其它途径塞脏数据。
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
      // 2026-09-14：productEffect.prompt 由关联 promptTemplate.prompt 提供，此处留空串占位
      // （DB 列保留为 NOT NULL default ''，与 ProductEffect 类型仍为 required string 对齐）
      prompt: "",
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
      // 2026-09-14：productEffect.versions[] 不再维护（生成时不读），留空数组占位
      versions: [],
      usageCount: 0,
      successRate: 0,
      avgDuration: 0,
      productLineIds: parsedInput.productLineIds ?? [],
      productTypeCode: parsedInput.productTypeCode ?? null,
      // 2026-09-10：可配置尺寸 + 配件子集（null → undefined，匹配 ProductEffect 类型）
      allowedSizes: parsedInput.allowedSizes ?? undefined,
      allowedAccessories: parsedInput.allowedAccessories ?? undefined,
      // 2026-09-10：模板级 capability 覆盖 + 皮革色子集
      allowedCapabilities:
        (parsedInput.allowedCapabilities as Partial<ProductCapabilities>) ??
        null,
      allowedColors: parsedInput.allowedColors ?? undefined,
      // 2026-09-10：引用 prompt_template.id（生成时优先取 promptTemplate.prompt）
      promptTemplateId: parsedInput.promptTemplateId ?? null,
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
    // 2026-09-14：删除 updates.prompt 处理（schema 已无 prompt 字段）。
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
    // 2026-09-10：模板级 capability 覆盖 + 皮革色子集
    if (updates.allowedCapabilities !== undefined)
      updatePayload.allowedCapabilities =
        (updates.allowedCapabilities as Partial<ProductCapabilities>) ?? null;
    if (updates.allowedColors !== undefined)
      updatePayload.allowedColors = updates.allowedColors ?? undefined;
    // 2026-09-10：promptTemplateId 引用更新（null = 解除引用）
    // 2026-09-12：改为必填（已在校验拦截）；update 仅支持修改引用模板
    if (updates.promptTemplateId !== undefined)
      updatePayload.promptTemplateId = updates.promptTemplateId ?? null;
    // 2026-09-14：删除 updates.versions 处理（schema 已无 versions 字段）。

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

// ============================================
// 2026-09-12：prompt_template_price admin actions（按规格定价对账核心）
// ============================================
//
// 设计：
//   - listPromptTemplatePricesAction(templateId)：拉取某模板的全部价格规则
//     （specKey + priceDelta + label），按 specKey 字母序；admin product-effect-form
//     mount 时 + promptTemplateId 切换时调用，把规则预填进 UI
//   - updatePromptTemplatePricesAction(templateId, rules)：整体替换（先删后插）
//     简化并发：单一来源（admin），避免行级 diff + 部分失败
//   - 校验 templateId 存在且 active；规则 specKey 用白名单（防止脏数据）
//
// 与 productEffectFormSchema 的关系：
//   价格规则**不**塞进 productEffectFormSchema（productEffect 不存价格规则，
//   挂在 promptTemplate 上）。admin form 提交时串行调 updateProductEffect
//   + updatePromptTemplatePrices，两边一致才算保存成功。
// ============================================

/**
 * specKey 白名单（与 prompt_template_price migration 注释 + product-catalog.ts 对齐）。
 * 列表中前段为 size/accessory/leather_color 三种 chip 子集；protection 两条
 * 写死（admin 可改 delta，但 key 不让 admin 自由加新保护套类型，避免
 * SPEC 不一致导致 prompt_order.leather_exposed/pvc_protection 落 null）。
 */
const ALLOWED_SPEC_KEY_PREFIXES = [
  "size:",
  "accessory:",
  "leather_color:",
  "protection:",
] as const;

const ALLOWED_SIZE_VALUES = new Set(["4", "6", "8", "11"]);
const ALLOWED_ACCESSORY_VALUES = new Set(["leather", "pvc", "bracket"]);
const ALLOWED_LEATHER_COLOR_VALUES = new Set([
  "natural",
  "brown",
  "black",
  "red",
  "navy",
]);
const ALLOWED_PROTECTION_VALUES = new Set(["exposed", "pvc"]);

/**
 * specKey 合法性校验。rule 是 admin 提交上来的 raw 值（{ specKey, priceDelta, label }）。
 * 非法 → 抛 Error（admin 看到消息后改正）。失败一条 = 整体拒绝写入（事务语义）。
 */
function validateSpecKey(specKey: string): void {
  const [dim, value] = specKey.split(":");
  if (!dim || !value) {
    throw new Error(`非法规格 key：${specKey}（格式应为 "dimension:value"）`);
  }
  const prefix = `${dim}:`;
  if (!(ALLOWED_SPEC_KEY_PREFIXES as readonly string[]).includes(prefix)) {
    throw new Error(
      `非法规格维度 ${dim}（允许：${ALLOWED_SPEC_KEY_PREFIXES.join(" / ")})`
    );
  }
  switch (dim) {
    case "size":
      if (!ALLOWED_SIZE_VALUES.has(value)) {
        throw new Error(`非法尺寸 ${value}cm（允许：4 / 6 / 8 / 11）`);
      }
      return;
    case "accessory":
      if (!ALLOWED_ACCESSORY_VALUES.has(value)) {
        throw new Error(`非法配件 ${value}（允许：leather / pvc / bracket）`);
      }
      return;
    case "leather_color":
      if (!ALLOWED_LEATHER_COLOR_VALUES.has(value)) {
        throw new Error(
          `非法皮革色 ${value}（允许：natural / brown / black / red / navy）`
        );
      }
      return;
    case "protection":
      if (!ALLOWED_PROTECTION_VALUES.has(value)) {
        throw new Error(`非法保护套类型 ${value}（允许：exposed / pvc）`);
      }
      return;
    default:
      throw new Error(`未实现的规格维度：${dim}`);
  }
}

const priceRuleSchema = z.object({
  specKey: z.string().min(1).max(64),
  priceDelta: z.number().int().min(-10000).max(100000),
  label: z.string().max(64).default(""),
});

/**
 * 列出某 promptTemplate 的全部价格规则（admin form mount 加载用）。
 * 模板不存在 / 已停用都抛错，admin form 捕获后转 toast。
 */
export const listPromptTemplatePricesAction = withImageGenAdminAction(
  "listPromptTemplatePrices"
)
  .schema(z.object({ templateId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const template = await db.query.promptTemplate.findFirst({
      where: and(
        eq(promptTemplate.id, parsedInput.templateId),
        eq(promptTemplate.isActive, true)
      ),
      columns: { id: true, price: true },
    });
    if (!template) {
      throw new Error("模板不存在或已停用");
    }
    const rows = await db
      .select({
        id: promptTemplatePrice.id,
        specKey: promptTemplatePrice.specKey,
        priceDelta: promptTemplatePrice.priceDelta,
        label: promptTemplatePrice.label,
      })
      .from(promptTemplatePrice)
      .where(eq(promptTemplatePrice.templateId, parsedInput.templateId));
    // 按 specKey 字母序（与 price-calculator 的 breakdown 排序一致）
    rows.sort((a, b) =>
      a.specKey < b.specKey ? -1 : a.specKey > b.specKey ? 1 : 0
    );
    return {
      basePrice: template.price ?? 0,
      rules: rows.map((r) => ({
        specKey: r.specKey,
        priceDelta: r.priceDelta,
        label: r.label,
      })),
    };
  });

/**
 * 整体替换某 promptTemplate 的价格规则（admin 保存用）。
 * 流程：先 DELETE WHERE template_id=? → INSERT 新规则（事务内）。
 * - 模板存在性 + active 校验（与 list 一致）
 * - 每条 rule specKey / priceDelta 范围校验（白名单见上）
 * - 同模板 (templateId, specKey) 唯一约束由 DB 保证（unique index ptp_template_spec_unique）
 */
export const updatePromptTemplatePricesAction = withImageGenAdminAction(
  "updatePromptTemplatePrices"
)
  .schema(
    z.object({
      templateId: z.string().min(1),
      rules: z.array(priceRuleSchema).max(64),
    })
  )
  .action(async ({ parsedInput }) => {
    const { templateId, rules } = parsedInput;
    const template = await db.query.promptTemplate.findFirst({
      where: and(
        eq(promptTemplate.id, templateId),
        eq(promptTemplate.isActive, true)
      ),
      columns: { id: true },
    });
    if (!template) {
      throw new Error("模板不存在或已停用");
    }
    // 1. specKey 合法性 + 唯一性校验
    const seenSpecKeys = new Set<string>();
    for (const rule of rules) {
      validateSpecKey(rule.specKey);
      if (seenSpecKeys.has(rule.specKey)) {
        throw new Error(`重复的规格 key：${rule.specKey}`);
      }
      seenSpecKeys.add(rule.specKey);
    }

    // 2. 事务内整体替换
    await db.transaction(async (tx) => {
      await tx
        .delete(promptTemplatePrice)
        .where(eq(promptTemplatePrice.templateId, templateId));
      if (rules.length > 0) {
        await tx.insert(promptTemplatePrice).values(
          rules.map((r) => ({
            id: nanoid(),
            templateId,
            specKey: r.specKey,
            priceDelta: r.priceDelta,
            label: r.label,
          }))
        );
      }
    });

    revalidatePath("/admin/product-effects");
    return { count: rules.length };
  });

// ============================================
// 2026-09-10：产品线 admin actions（5 个 CRUD）
// 替代 MOCK_PRODUCT_LINES 前端 mock，由 product_line 表接管
// ============================================

/**
 * 解析产品线 spec / pricing 输入字符串为对象
 * - 空 / 解析失败 → 空对象（fallback 到 schema 默认）
 * - 非法 JSON 抛错让上层 toast 提示
 */
function parseLineJsonInput<T>(
  raw: string | null | undefined,
  label: string
): T {
  if (!raw || !raw.trim()) return {} as T;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
    throw new Error(`${label} 必须是 JSON 对象`);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`${label} JSON 解析失败：${err.message}`);
    }
    throw err;
  }
}

const productLineFormSchema = z.object({
  productLineId: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().default(""),
  coverUrl: z.string().default(""),
  /**
   * spec / pricing 在 form 里是 JSON 字符串（admin 手填 JSON 调试），
   * 提交后由 parseLineJsonInput 转对象入库；DB 列存序列化 JSON 字符串。
   */
  spec: z.string().default(""),
  pricing: z.string().default(""),
  status: z.enum(["active", "inactive", "draft"]).default("active"),
  sortOrder: z.number().int().default(0),
});

/**
 * 获取所有产品线（管理后台用，含 inactive / draft）
 */
export const listProductLinesAdminAction = withImageGenAdminAction(
  "listProductLines"
)
  .schema(z.void().optional())
  .action(async () => {
    const lines = await getLinesFromDb();
    return { lines };
  });

/**
 * 获取所有上架产品线（用户端 /image-gen 选模板用）
 */
export const listActiveProductLinesAdminAction = withImageGenAdminAction(
  "listActiveProductLines"
)
  .schema(z.void().optional())
  .action(async () => {
    const lines = await getActiveLinesFromDb();
    return { lines };
  });

/**
 * 获取单个产品线
 */
export const getProductLineAdminAction = withImageGenAdminAction(
  "getProductLine"
)
  .schema(z.object({ productLineId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const line = await findLineInDb(parsedInput.productLineId);
    if (!line) throw new Error("产品线不存在");
    return { line };
  });

/**
 * 新增产品线
 */
export const createProductLineAdminAction = withImageGenAdminAction(
  "createProductLine"
)
  .schema(productLineFormSchema)
  .action(async ({ parsedInput }) => {
    const spec = parseLineJsonInput<ProductLineSpec>(parsedInput.spec, "spec");
    const pricing = parseLineJsonInput<ProductLinePricing>(
      parsedInput.pricing,
      "pricing"
    );

    const now = new Date().toISOString();
    const line: ProductLine = {
      productLineId: parsedInput.productLineId,
      name: parsedInput.name,
      category: parsedInput.category,
      description: parsedInput.description,
      coverUrl: parsedInput.coverUrl,
      spec,
      pricing,
      status: parsedInput.status,
      sortOrder: parsedInput.sortOrder,
      createdAt: now,
      updatedAt: now,
    };

    const created = await createLineInDb(line);
    revalidatePath("/admin/product-lines");
    revalidatePath("/image-gen");
    return { line: created };
  });

/**
 * 更新产品线
 */
export const updateProductLineAdminAction = withImageGenAdminAction(
  "updateProductLine"
)
  .schema(
    z.object({
      productLineId: z.string().min(1),
      updates: productLineFormSchema.partial(),
    })
  )
  .action(async ({ parsedInput }) => {
    const { productLineId, updates } = parsedInput;

    const updatePayload: Partial<ProductLine> = {};
    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.category !== undefined)
      updatePayload.category = updates.category;
    if (updates.description !== undefined)
      updatePayload.description = updates.description;
    if (updates.coverUrl !== undefined)
      updatePayload.coverUrl = updates.coverUrl;
    if (updates.spec !== undefined) {
      updatePayload.spec = parseLineJsonInput<ProductLineSpec>(
        updates.spec,
        "spec"
      );
    }
    if (updates.pricing !== undefined) {
      updatePayload.pricing = parseLineJsonInput<ProductLinePricing>(
        updates.pricing,
        "pricing"
      );
    }
    if (updates.status !== undefined) updatePayload.status = updates.status;
    if (updates.sortOrder !== undefined)
      updatePayload.sortOrder = updates.sortOrder;

    const updated = await updateLineInDb(productLineId, updatePayload);
    if (!updated) throw new Error("产品线不存在");

    revalidatePath("/admin/product-lines");
    revalidatePath("/image-gen");
    return { line: updated };
  });

/**
 * 删除产品线
 */
export const deleteProductLineAdminAction = withImageGenAdminAction(
  "deleteProductLine"
)
  .schema(z.object({ productLineId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const deleted = await deleteLineInDb(parsedInput.productLineId);
    if (!deleted) throw new Error("产品线不存在");
    revalidatePath("/admin/product-lines");
    revalidatePath("/image-gen");
    return { success: true };
  });

// ============================================
// 2026-10-12：外部生图 API Key 管理
// ============================================
// 数据形状参考 src/db/schema.ts externalApiKey + service 层。

/**
 * 列出所有未删除的 API Key（admin 后台用，仅返脱敏字段，不返 rawKey）
 */
export const listExternalApiKeysAdminAction = withImageGenAdminAction(
  "listExternalApiKeys"
)
  .schema(z.void().optional())
  .action(async () => {
    const rows = await listExternalApiKeysInDb();
    return {
      keys: rows.map((row) => ({
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        status: row.status,
        monthlyQuota: row.monthlyQuota,
        monthlyCalls: row.monthlyCalls,
        monthlyCallsResetAt: row.monthlyCallsResetAt.toISOString(),
        totalCalls: row.totalCalls,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        allowedMasks: parseAllowedMasks(row.allowedMasks),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

const createExternalApiKeySchema = z.object({
  // 2026-10-12：trim 防止 admin 误把含前后空白的字符串塞进来（如从其它字段复制粘贴时夹带空白），
  // 同时去掉首尾 \n / \r / \t 等不可见字符。
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    // 2026-10-12：防误粘 rawKey / 哈希片段。
    // 客户端 Form.Item rules 已有同名校验（外部 api-keys-admin-view.tsx），
    // 服务端这里再 superRefine 一遍，挡住脚本直调 / 绕过 form 的请求。
    .superRefine((val, ctx) => {
      if (isSuspiciousCustomerName(val)) {
        // 2026-10-12：Zod 4 推荐用字符串字面量代替旧 enum
        ctx.addIssue({
          code: "custom",
          message: SUSPICIOUS_CUSTOMER_NAME_MESSAGE_SERVER,
        });
      }
    }),
  monthlyQuota: z.number().int().min(-1).max(1_000_000),
  allowedMasks: z.array(z.string().min(1)).max(200).default([]),
});

/**
 * 新建 API Key（一次性返回 rawKey，admin 必须立刻复制保存）
 *
 * 注意：rawKey 在 DB 不存明文，只存 SHA-256(keyHash)；本 action 是 admin
 * 唯一能拿到明文的窗口。返回后 admin 视图应允许复制到剪贴板，
 * 刷新页面后无法再查看。
 */
export const createExternalApiKeyAdminAction = withImageGenAdminAction(
  "createExternalApiKey"
)
  .schema(createExternalApiKeySchema)
  .action(async ({ parsedInput, ctx }) => {
    const created = await createExternalApiKeyInDb({
      name: parsedInput.name,
      createdBy: ctx.userId,
      monthlyQuota: parsedInput.monthlyQuota,
      allowedMasks: parsedInput.allowedMasks,
    });
    return {
      key: {
        id: created.id,
        rawKey: created.rawKey,
        name: created.name,
        keyPrefix: created.keyPrefix,
        monthlyQuota: created.monthlyQuota,
        allowedMasks: created.allowedMasks,
        createdAt: created.createdAt.toISOString(),
      },
      // 记录审计 createdBy = 当前 admin user.id
      createdBy: ctx.userId,
    };
  });

const updateExternalApiKeySchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    // 2026-10-12：同上 — 同样挡住 update 时的误粘
    .superRefine((val, ctx) => {
      if (isSuspiciousCustomerName(val)) {
        // 2026-10-12：Zod 4 推荐用字符串字面量代替旧 enum
        ctx.addIssue({
          code: "custom",
          message: SUSPICIOUS_CUSTOMER_NAME_MESSAGE_SERVER,
        });
      }
    })
    .optional(),
  status: z.enum(["active", "disabled"]).optional(),
  monthlyQuota: z.number().int().min(-1).max(1_000_000).optional(),
  allowedMasks: z.array(z.string().min(1)).max(200).optional(),
});

/**
 * 更新 API Key（部分字段），至少要传一个要改的字段
 */
export const updateExternalApiKeyAdminAction = withImageGenAdminAction(
  "updateExternalApiKey"
)
  .schema(updateExternalApiKeySchema)
  .action(async ({ parsedInput }) => {
    const { id, ...rest } = parsedInput;
    // 没传任何修改字段时拒绝（service 层 silent noop 不友好）
    const updatableKeys = [
      "name",
      "status",
      "monthlyQuota",
      "allowedMasks",
    ] as const;
    if (!updatableKeys.some((k) => rest[k] !== undefined)) {
      throw new Error("至少要修改一个字段");
    }
    await updateExternalApiKeyInDb({ id, ...rest });
    revalidatePath("/admin/external-api-keys");
    return { success: true };
  });

/**
 * 软删除 API Key（保留行 + marked deletedAt，便于审计）
 */
export const deleteExternalApiKeyAdminAction = withImageGenAdminAction(
  "deleteExternalApiKey"
)
  .schema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await softDeleteExternalApiKeyInDb(parsedInput.id);
    revalidatePath("/admin/external-api-keys");
    return { success: true };
  });

// ============================================
// 2026-10-21：商品目录 admin actions
//
// 商品资料（名称 / 描述 / 封面 / 基础价 / 上下架）+ SKU 变体（真 SKU 绝对价）
// 从 product-catalog.ts 的硬编码常量搬到 product / product_variant 两张表，
// 运营在这里改，不再需要发版。
//
// 注意 /api/image-gen/products 有 CDN 缓存（s-maxage=300, swr=600），
// 这里 revalidatePath 只清 Next 自身的缓存；对外生效仍可能有最长 10 分钟
// 延迟，保存成功的 toast 里已提示。
// ============================================

const productFormSchema = z.object({
  code: z
    .string()
    .min(1)
    // 产品码同时是 SKU 前缀，锁死大写字母 + 数字，避免拼出歧义 SKU
    .regex(/^[A-Z][A-Z0-9]*$/, "产品码只能是大写字母和数字（如 R / RM / M）"),
  name: z.string().min(1, "请输入商品名称"),
  nameEn: z.string().default(""),
  category: z.string().default("keychain"),
  description: z.string().default(""),
  coverUrl: z.union([z.literal(""), z.string().url("封面必须是合法 URL")]),
  /** 基础价，单位「分」；表单里也是分，展示时才 /100 */
  basePriceCents: z.number().int().min(0).default(0),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
  accent: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
  sortOrder: z.number().int().default(0),
});

/**
 * 商城那几页也读 DB 的价 —— 后台改完价要清它们的缓存。
 *
 * 商城页是 `force-dynamic` + `connection()`(见
 * `src/features/storefront/lib/price-source.ts`),所以**每次请求都重算** ——
 * 这几个 `revalidatePath` 清的是**客户端 Router Cache** 和 Full Route
 * Cache,不是「价的缓存」。留着是为了用户改完价点回商城时看到的是新价,
 * 而不是浏览器里那个旧的 RSC 载荷。
 *
 * 路径跟 `src/app/[locale]/` 下的实际路由对应:
 *   `/[locale]`                        → (marketing-atelier)/page.tsx
 *   `/[locale]/products`               → (marketing-atelier)/products/page.tsx
 *   `/[locale]/product/[handle]`       → (marketing-atelier)/product/[handle]/page.tsx
 *
 * 2026-11-13:作品集从 `/marketing/products` 归位到 `/products`(见那一节的
 * CLAUDE.md 说明),这一行跟着改。旧地址留了 308 桩,重定向不用清缓存。
 */
function revalidateStorefrontProductPaths(): void {
  revalidatePath("/[locale]", "page");
  revalidatePath("/[locale]/products", "page");
  revalidatePath("/[locale]/product/[handle]", "page");
}

/** 商品列表（含 SKU / 配件变体统计） */
export const listProductsAdminAction = withImageGenAdminAction("listProducts")
  .schema(z.void().optional())
  .action(async () => {
    const products = await getProductsFromDb();
    return { products };
  });

/** 单个商品 + 其 SKU 列表 */
export const getProductAdminAction = withImageGenAdminAction("getProduct")
  .schema(z.object({ code: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const [product, variants] = await Promise.all([
      findProductInDb(parsedInput.code),
      getVariantsFromDb(parsedInput.code),
    ]);
    if (!product) throw new Error("商品不存在");
    return { product, variants };
  });

/**
 * 新建商品。
 *
 * ## code **不再**必须在 `PRODUCT_TYPES` 里（2026-11-14）
 *
 * 尺寸 / 配件清单搬进 DB 字典之后，新型号就该能自由创建 ——
 * 以前那道闸逼着工作室改代码常量才能加一个型号。
 *
 * ⚠️ 但**没有尺寸就生成不出 SKU** —— 那一道闸挪到「补齐缺失 SKU」那一步
 * （`generateVariantsForProductInDb`），那儿会说出人话。
 */
export const createProductAdminAction = withImageGenAdminAction("createProduct")
  .schema(productFormSchema)
  .action(async ({ parsedInput }) => {
    const existing = await findProductInDb(parsedInput.code);
    if (existing) throw new Error(`商品 ${parsedInput.code} 已存在`);

    const created = await createProductInDb(parsedInput);
    if (!created) throw new Error("创建失败");

    revalidatePath("/admin/products");
    revalidateStorefrontProductPaths();
    return { product: created };
  });

/**
 * 更新商品资料（不含 SKU —— SKU 的价由基础价自动算）
 *
 * ## 改了基础价 → 已有 SKU 的绝对价跟着重算
 *
 * 基础价是**唯一**的价源(工作室 2026-11-08 拍板)。SKU 的绝对价 =
 * `基础价 + 尺寸阶梯 + 配件加价`,所以改基础价必须把那批 SKU 行一起改 ——
 * 否则小程序按 SKU 拿到的绝对价跟商城对不上,又是一轮「改了不生效」。
 *
 * 重算只改 `price_cents`,`sellbase_variant_id` / `is_active` /
 * `sort_order` 一个都不动。
 */
export const updateProductAdminAction = withImageGenAdminAction("updateProduct")
  .schema(
    z.object({
      code: z.string().min(1),
      updates: productFormSchema.partial(),
    })
  )
  .action(async ({ parsedInput }) => {
    // code 是主键不可改，updates 里那份 code 丢掉
    const { code: _ignored, ...updates } = parsedInput.updates;
    const updated = await updateProductInDb(parsedInput.code, updates);
    if (!updated) throw new Error("商品不存在");

    // 基础价变了 → 重算这个商品已有 SKU 行的绝对价
    let recomputedVariants = 0;
    if (updates.basePriceCents !== undefined) {
      recomputedVariants = await recomputeProductVariantPricesInDb(
        parsedInput.code,
        updates.basePriceCents
      );
    }

    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${parsedInput.code}`);
    revalidateStorefrontProductPaths();
    return { product: updated, recomputedVariants };
  });

/** 删除商品（连带其全部 SKU 行） */
export const deleteProductAdminAction = withImageGenAdminAction("deleteProduct")
  .schema(z.object({ code: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const ok = await deleteProductInDb(parsedInput.code);
    if (!ok) throw new Error("商品不存在");

    revalidatePath("/admin/products");
    revalidateStorefrontProductPaths();
    return { success: true };
  });

/** 某商品的 SKU 行（含已下架） */
export const listProductVariantsAdminAction = withImageGenAdminAction(
  "listProductVariants"
)
  .schema(z.object({ productCode: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const variants = await getVariantsFromDb(parsedInput.productCode);
    return { variants };
  });

/**
 * 批量改 SKU 的上下架。
 *
 * **这里没有「改价」** —— SKU 的绝对价由**基础价**决定。改基础价就改
 * `updateProductAdminAction` 的 `basePriceCents`,那一批 SKU 的价会自动
 * 重算(`recomputeProductVariantPricesInDb`)。
 *
 * schema 里**故意没有** `priceCents` —— 留着就等于留了个后门:管理员能再把
 * SKU 价改成跟基础价不一致,直接破坏「基础价说了算」这条不变式。
 * 被 zod 拒掉是**故意的**,不是 bug。
 */
export const bulkUpdateProductVariantsAction = withImageGenAdminAction(
  "bulkUpdateProductVariants"
)
  .schema(
    z.object({
      productCode: z.string().min(1),
      updates: z
        .array(
          z.object({
            id: z.string().min(1),
            isActive: z.boolean().optional(),
          })
        )
        .max(1000),
    })
  )
  .action(async ({ parsedInput }) => {
    const count = await bulkUpdateVariantsInDb(
      parsedInput.updates.map((u) => ({
        id: u.id,
        isActive: u.isActive,
      }))
    );
    revalidatePath(`/admin/products/${parsedInput.productCode}`);
    return { count };
  });

/**
 * 按当前字典重新生成该商品的 SKU 行。
 *
 * 只 INSERT 不 UPDATE —— 运营改过的价不会被冲掉，已有行会被唯一索引挡下。
 *
 * ⚠️ **必须传「新鲜的」那份字典**（`getCatalogDictionaryFresh()`，不缓存）——
 * React 的 `cache()` 是**请求级**的：同一个请求里刚写完字典再读，拿到的还是
 * **改之前**那份 ⇒ 生成出来的 SKU 用的是**旧加价** ⇒ 工作室看着像没生效。
 */
export const generateProductVariantsAction = withImageGenAdminAction(
  "generateProductVariants"
)
  .schema(z.object({ productCode: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const dictionary = await getCatalogDictionaryFresh();
    const created = await generateVariantsForProductInDb(
      parsedInput.productCode,
      dictionary
    );
    revalidatePath(`/admin/products/${parsedInput.productCode}`);
    return { created };
  });

/* -------------------------------------------------------------------------- */
/*  商品目录字典（2026-11-14）                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 尺寸 / 配件 / 配件变体原先是**代码常量** ⇒ 后台改不了 ⇒
 * 工作室问「为什么商品 sku 无法设置以及价格」。
 *
 * 现在这三样是 **DB 字典**（`product_size` / `product_accessory` /
 * `product_accessory_option` / `product_accessory_variant`），后台能自由增删。
 *
 * ## 三条规矩
 *
 * 1. **「删除」= 停用（`isActive=false`），不是硬删** —— 硬删之后那一行
 *    「DB 没行」⇒ 字典的兜底规则把它**原样复活** ⇒ 工作室点了「删除」，
 *    刷新一下它又回来了。
 * 2. **`variantCode` 必须全局唯一** —— 商城拿 `acc_${variantCode}` 当键
 *    ⇒ 撞车了加价就变成「取到哪个算哪个」。
 * 3. **改加价 ⇒ 顺带重算 SKU 的绝对价** —— 尺寸加价 / 配件变体加价变了，
 *    对应型号的 SKU 绝对价要跟着变。
 *
 * ## 为什么不 throw
 *
 * throw 会被 next-safe-action 糊成一句「服务器错误，请稍后重试」——
 * 工作室根本不知道是**表还没建**、**变体码撞了**、还是**写库失败**。
 * ⇒ 每个失败都带一个稳定的 code，界面按 code 查文案
 * （文案表在 `admin/types.ts` 的 `CATALOG_ERROR_TEXT_KEYS`）。
 */

/** 尺寸码 —— 只能是数字（单位 cm）；`4.0` 归一化成 `4` */
const catalogSizeCodeSchema = z
  .string()
  .trim()
  .min(1, "请填写尺寸码")
  .max(16, "尺寸码太长了")
  .regex(/^\d+(\.\d+)?$/, "尺寸码只能是数字（单位 cm）");

/** 配件码 / 配件变体码 —— 小写字母、数字、下划线 */
const catalogCodeSchema = z
  .string()
  .trim()
  .min(1, "请填写编码")
  .max(64, "编码太长了")
  .regex(
    /^[a-z0-9_]+$/,
    "编码只能用小写字母、数字和下划线（如 leather_brown）"
  );

/** `4.0` → `4` —— 免得「4」和「4.0」变成两档尺寸 */
function normalizeSizeCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.includes(".")) return trimmed;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return trimmed;
  return String(parsed);
}

/**
 * 失败的返回 —— **统一走这一个工厂**
 *
 * ⚠️ 别直接写 `return { ok: false as const, code: "SIZE_NOT_FOUND" }`:
 * `ok` 加了 `as const`,但 `code` **没有** ⇒ 它的字面量类型**拓宽成 `string`**
 * ⇒ 前端 `CATALOG_ERROR_TEXT_KEYS[data.code]` 索引不上去(TS7053)
 * ⇒ **错误文案那一层整个塌掉**(界面只显示一个原始码)。
 *
 * ⇒ 走这一个工厂,`code` 的类型永远是 `AdminCatalogErrorCode`。
 */
function catalogFailure(code: AdminCatalogErrorCode): {
  ok: false;
  code: AdminCatalogErrorCode;
} {
  return { ok: false, code };
}

/** DB 报错 → 稳定的错误码 */
function catalogErrorCode(error: unknown): AdminCatalogErrorCode {
  const info = describeDbError(error);
  if (info.missingRelation) return "MIGRATION_MISSING";
  return "SAVE_FAILED";
}

/**
 * **读**失败 → 稳定的错误码
 *
 * ⚠️ 读失败跟写失败**不是一件事** —— 写失败是「保存没成」,读失败是
 * 「这一页摆不出来」。工作室看到的话要做的事不一样。
 *
 * 表还没建(`missingRelation`)⇒ `MIGRATION_MISSING`(界面直接告诉工作室
 * 先跑 `pnpm migrate:apply-catalog-dictionary`);其它 ⇒ `READ_FAILED`。
 */
function catalogReadErrorCode(error: unknown): AdminCatalogErrorCode {
  const info = describeDbError(error);
  if (info.missingRelation) return "MIGRATION_MISSING";
  return "READ_FAILED";
}

/**
 * PG 的唯一约束冲突（`23505`）
 *
 * ⚠️ 同一个 `(型号, 配件, 变体码)` 撞了 —— DB 的唯一索引会挡下来 ⇒
 * 把它翻译成 `VARIANT_CODE_DUPLICATED`，别让工作室看着一句「保存失败」。
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    const code = (current as { code?: unknown } | null | undefined)?.code;
    if (code === "23505") return true;
    const cause = (current as { cause?: unknown } | null | undefined)?.cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return false;
}

/**
 * 改完字典 ⇒ 顺带重算受影响型号的 SKU 绝对价
 *
 * ⚠️ **必须用「新鲜的」那份字典**（`getCatalogDictionaryFresh()`，不缓存）——
 * React 的 `cache()` 是**请求级**的：同一个请求里刚写完字典再读，拿到的还是
 * **改之前**那份 ⇒ 拿旧加价去重算 ⇒ **改了加价，SKU 的价还是老的**。
 *
 * 重算失败**只记日志、不抛** —— 字典已经写进库了（那才是工作室要的），
 * SKU 价没跟上可以再点一次「补齐缺失 SKU」。
 */
async function recomputeSkusAfterDictionaryChange(
  productTypeCode: string
): Promise<number> {
  try {
    const basePriceCents = await readProductBasePriceCents(productTypeCode);
    if (basePriceCents === null) return 0;
    const dictionary = await getCatalogDictionaryFresh();
    return await recomputeProductVariantPricesInDb(
      productTypeCode,
      basePriceCents,
      dictionary
    );
  } catch (error) {
    console.error(
      `[catalog] 重算型号 ${productTypeCode} 的 SKU 价失败:`,
      error
    );
    return 0;
  }
}

/**
 * 写完字典要刷的页面
 *
 * - 后台商品页 / SKU 页
 * - **商城页** —— 尺寸加价变了，商城显示的价要跟着变
 * - **效果模板页** —— 那个表单读的是同一份字典（型号 / 尺寸 / 配件清单）
 */
function revalidateCatalogPaths(productTypeCode?: string): void {
  revalidatePath("/admin/products");
  if (productTypeCode) {
    revalidatePath(`/admin/products/${productTypeCode}`);
  }
  revalidatePath("/admin/product-effects");
  revalidatePath("/admin/product-effects/new");
  revalidatePath("/admin/product-effects/[id]", "page");
  revalidateStorefrontProductPaths();
}

/**
 * 读某个型号的后台字典（四块一起）
 *
 * **表还没建也是一个结果**，不是异常 —— 迁移脚本没跑的时候界面要说
 * 「先跑 `pnpm migrate:apply-catalog-dictionary`」，而不是甩一个 500。
 */
export const listCatalogDictionaryAdminAction = withImageGenAdminAction(
  "listCatalogDictionary"
)
  .schema(z.object({ productTypeCode: z.string().min(1).max(32) }))
  .action(async ({ parsedInput }) => {
    try {
      const rows = await readAdminCatalogRows(parsedInput.productTypeCode);
      return {
        ok: true as const,
        sizes: rows.sizes.map((row) => ({
          id: row.id,
          productTypeCode: row.productTypeCode,
          sizeCode: row.sizeCode,
          priceDeltaCents: row.priceDeltaCents,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        })),
        accessories: rows.accessories.map((row) => ({
          code: row.code,
          name: row.name,
          nameEn: row.nameEn,
          category: row.category,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        })),
        accessoryOptions: rows.accessoryOptions.map((row) => ({
          id: row.id,
          productTypeCode: row.productTypeCode,
          accessoryCode: row.accessoryCode,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        })),
        variants: rows.variants.map((row) => ({
          id: row.id,
          productTypeCode: row.productTypeCode,
          accessoryCode: row.accessoryCode,
          variantCode: row.variantCode,
          name: row.name,
          nameEn: row.nameEn,
          swatch: row.swatch,
          priceDeltaCents: row.priceDeltaCents,
          appliesToSizesCm: row.appliesToSizesCm,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        })),
      };
    } catch (error) {
      return catalogFailure(catalogReadErrorCode(error));
    }
  });

/**
 * 写一档尺寸 —— 按 `(型号, 尺寸码)` upsert
 *
 * 「新增」和「改」用**同一个字段**区分：这个型号下还没有这个尺寸码 ⇒ 新增；
 * 已经有了 ⇒ 改那一行。
 */
export const upsertProductSizeAction = withImageGenAdminAction(
  "upsertProductSize"
)
  .schema(
    z.object({
      productTypeCode: z.string().min(1).max(32),
      sizeCode: catalogSizeCodeSchema,
      /** 显式加价（分）—— 不靠下标算 */
      priceDeltaCents: z.number().int().min(-1_000_000).max(1_000_000),
      sortOrder: z.number().int().min(0).max(10_000).default(0),
      isActive: z.boolean().default(true),
    })
  )
  .action(async ({ parsedInput }) => {
    try {
      if (!(await productExists(parsedInput.productTypeCode))) {
        return catalogFailure("PRODUCT_NOT_FOUND");
      }
      const sizeCode = normalizeSizeCode(parsedInput.sizeCode);
      await upsertProductSizeRow({ ...parsedInput, sizeCode });
      // 尺寸加价变了 ⇒ 这个型号的 SKU 绝对价要跟着重算
      const recomputedSkus = await recomputeSkusAfterDictionaryChange(
        parsedInput.productTypeCode
      );
      revalidateCatalogPaths(parsedInput.productTypeCode);
      return { ok: true as const, changed: true, recomputedSkus };
    } catch (error) {
      return catalogFailure(catalogErrorCode(error));
    }
  });

/**
 * 停用一档尺寸 —— **不是硬删**
 *
 * 停用之后这一档从字典里消失 ⇒ 商城不再显示它、也不再生成新的 SKU。
 * **已经生成的那些 SKU 的价不动**（重算时「查不到就跳过，不当成 0」）。
 */
export const deleteProductSizeAction = withImageGenAdminAction(
  "deleteProductSize"
)
  .schema(
    z.object({
      productTypeCode: z.string().min(1).max(32),
      sizeCode: catalogSizeCodeSchema,
    })
  )
  .action(async ({ parsedInput }) => {
    try {
      const sizeCode = normalizeSizeCode(parsedInput.sizeCode);
      const ok = await deactivateProductSizeRow(
        parsedInput.productTypeCode,
        sizeCode
      );
      if (!ok) return catalogFailure("SIZE_NOT_FOUND");
      const recomputedSkus = await recomputeSkusAfterDictionaryChange(
        parsedInput.productTypeCode
      );
      revalidateCatalogPaths(parsedInput.productTypeCode);
      return { ok: true as const, changed: true, recomputedSkus };
    } catch (error) {
      return catalogFailure(catalogErrorCode(error));
    }
  });

/**
 * 写一个配件 —— 按 `code` upsert
 *
 * ⚠️ **配件是全局的** —— 改一个配件的名字/分类，所有型号都跟着变。
 *
 * 配件这一层**没有加价**（加价在配件变体上）⇒ 这里改任何字段都**不需要**
 * 重算 SKU 价。
 */
export const upsertProductAccessoryAction = withImageGenAdminAction(
  "upsertProductAccessory"
)
  .schema(
    z.object({
      code: catalogCodeSchema,
      name: z.string().trim().min(1, "请填写配件名称").max(64),
      nameEn: z.string().trim().max(64).default(""),
      category: z.enum(["material", "protection", "mount", "decor"]),
      sortOrder: z.number().int().min(0).max(10_000).default(0),
      isActive: z.boolean().default(true),
    })
  )
  .action(async ({ parsedInput }) => {
    try {
      await upsertProductAccessoryRow(parsedInput);
      revalidateCatalogPaths();
      return { ok: true as const, changed: true };
    } catch (error) {
      return catalogFailure(catalogErrorCode(error));
    }
  });

/**
 * 停用一个配件 —— **不是硬删**
 *
 * ⚠️ 配件字典那一层的语义是「`isActive=false` ⇒ **这个配件整个没了**」
 * ⇒ 停用一个配件，所有型号都看不到它了（但已有的 SKU 行和它们的价不动）。
 */
export const deleteProductAccessoryAction = withImageGenAdminAction(
  "deleteProductAccessory"
)
  .schema(z.object({ code: catalogCodeSchema }))
  .action(async ({ parsedInput }) => {
    try {
      const ok = await deactivateProductAccessoryRow(parsedInput.code);
      if (!ok) return catalogFailure("ACCESSORY_NOT_FOUND");
      revalidateCatalogPaths();
      return { ok: true as const, changed: true };
    } catch (error) {
      return catalogFailure(catalogErrorCode(error));
    }
  });

/**
 * 「这个型号能配这个配件」—— 开 / 关
 *
 * `isActive = false` ⇒ 这个型号**不再配**它（配件本身还在别的型号上能用）。
 */
export const setProductAccessoryOptionAction = withImageGenAdminAction(
  "setProductAccessoryOption"
)
  .schema(
    z.object({
      productTypeCode: z.string().min(1).max(32),
      accessoryCode: catalogCodeSchema,
      sortOrder: z.number().int().min(0).max(10_000).default(0),
      isActive: z.boolean().default(true),
    })
  )
  .action(async ({ parsedInput }) => {
    try {
      if (!(await productExists(parsedInput.productTypeCode))) {
        return catalogFailure("PRODUCT_NOT_FOUND");
      }
      if (!(await accessoryExists(parsedInput.accessoryCode))) {
        return catalogFailure("ACCESSORY_NOT_FOUND");
      }
      await setProductAccessoryOptionRow(parsedInput);
      revalidateCatalogPaths(parsedInput.productTypeCode);
      return { ok: true as const, changed: true };
    } catch (error) {
      return catalogFailure(catalogErrorCode(error));
    }
  });

/**
 * 写一个配件变体 —— **加价就在这里**
 *
 * `id` 空 = 新增，非空 = 改那一行。
 *
 * ⚠️ **`variantCode` 必须全局唯一** —— 商城拿 `acc_${variantCode}` 当键 ⇒
 * 同一个码出现在两个（型号，配件）下，加价就变成「取到哪个算哪个」。
 * DB 的唯一索引只管 `(型号, 配件, 变体码)` ⇒ **全局那一层在这里查**。
 *
 * 改**加价** ⇒ 受影响型号的 SKU 绝对价要跟着重算。
 */
export const upsertProductAccessoryVariantAction = withImageGenAdminAction(
  "upsertProductAccessoryVariant"
)
  .schema(
    z.object({
      /** 空 = 新增；非空 = 改那一行 */
      id: z.string().default(""),
      productTypeCode: z.string().min(1).max(32),
      accessoryCode: catalogCodeSchema,
      variantCode: catalogCodeSchema,
      name: z.string().trim().min(1, "请填写变体名称").max(64),
      nameEn: z.string().trim().max(64).default(""),
      /** 色板（十六进制 / 颜色名）—— 可空 */
      swatch: z.string().trim().max(64).default(""),
      /** 加价（分） */
      priceDeltaCents: z.number().int().min(-1_000_000).max(1_000_000),
      /** 适用尺寸（cm）—— 空数组 = 全部适用 */
      appliesToSizesCm: z
        .array(z.number().int().min(0).max(1000))
        .max(50)
        .default([]),
      sortOrder: z.number().int().min(0).max(10_000).default(0),
      isActive: z.boolean().default(true),
    })
  )
  .action(async ({ parsedInput }) => {
    try {
      if (!(await productExists(parsedInput.productTypeCode))) {
        return catalogFailure("PRODUCT_NOT_FOUND");
      }
      if (!(await accessoryExists(parsedInput.accessoryCode))) {
        return catalogFailure("ACCESSORY_NOT_FOUND");
      }
      const conflict = await findConflictingVariantCode(
        parsedInput.variantCode,
        parsedInput.productTypeCode,
        parsedInput.accessoryCode,
        parsedInput.id || undefined
      );
      if (conflict.conflict) {
        return catalogFailure("VARIANT_CODE_DUPLICATED");
      }
      let result: "created" | "updated" | "not_found";
      try {
        result = await upsertProductAccessoryVariantRow({
          ...parsedInput,
          swatch: parsedInput.swatch || null,
        });
      } catch (error) {
        // 同一个 (型号, 配件, 变体码) 撞了 —— DB 的唯一索引挡下来了
        if (isUniqueViolation(error)) {
          return catalogFailure("VARIANT_CODE_DUPLICATED");
        }
        throw error;
      }
      if (result === "not_found") {
        return catalogFailure("VARIANT_NOT_FOUND");
      }
      // 改行时**型号不可改**（它是这一行的归属）⇒ 重算按库里那一行的型号
      const stored = parsedInput.id
        ? await readAccessoryVariantRow(parsedInput.id)
        : null;
      const targetType = stored?.productTypeCode ?? parsedInput.productTypeCode;
      const recomputedSkus =
        await recomputeSkusAfterDictionaryChange(targetType);
      revalidateCatalogPaths(targetType);
      return { ok: true as const, changed: true, recomputedSkus };
    } catch (error) {
      return catalogFailure(catalogErrorCode(error));
    }
  });

/**
 * 停用一个配件变体 —— **不是硬删**
 *
 * 停用之后不再为它生成新的 SKU；**已有的 SKU 行和它们的价不动**。
 */
export const deleteProductAccessoryVariantAction = withImageGenAdminAction(
  "deleteProductAccessoryVariant"
)
  .schema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    try {
      const stored = await readAccessoryVariantRow(parsedInput.id);
      const ok = await deactivateProductAccessoryVariantRow(parsedInput.id);
      if (!ok) return catalogFailure("VARIANT_NOT_FOUND");
      const recomputedSkus = stored
        ? await recomputeSkusAfterDictionaryChange(stored.productTypeCode)
        : 0;
      revalidateCatalogPaths(stored?.productTypeCode);
      return { ok: true as const, changed: true, recomputedSkus };
    } catch (error) {
      return catalogFailure(catalogErrorCode(error));
    }
  });
