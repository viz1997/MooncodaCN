/**
 * GPT-Image 业务 Zod 校验
 */

import { z } from "zod";
import { validateProductSpec } from "@/features/agent/lib/product-validation";

/** 单个提示词变量结构（Phase A 起 image-gen 工作台复用） */
export const promptVariableSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "变量名不能为空")
    .max(64, "变量名过长")
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "变量名仅允许字母/数字/下划线且不能以数字开头"
    ),
  label: z.string().trim().min(1, "变量显示名不能为空").max(64),
  defaultValue: z.string().max(32000).default(""),
  required: z.boolean().default(false),
  description: z.string().max(500).optional(),
  options: z.array(z.string().min(1)).max(50).optional(),
});

/** 创建/更新提示词模板 */
export const promptTemplateSchema = z.object({
  name: z.string().trim().min(1, "模板名称不能为空").max(100),
  description: z.string().trim().min(1, "描述不能为空").max(500),
  prompt: z.string().trim().min(1, "提示词不能为空").max(32000),
  size: z
    .enum([
      "1024x1024",
      "1344x768",
      "768x1344",
      "1440x720",
      "720x1440",
      "1152x864",
      "864x1152",
    ])
    .default("1024x1024"),
  candidateCount: z.number().int().min(1).max(9).default(4),
  coverUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().default(true),
  // 2026-09-01：候选输出模式（默认 'grid' 兼容老模板）
  //  - grid：n=1 + prompt 末尾追加宫格指令，让 Lingting 一次返 1 张拼接图
  //  - separate：n=candidateCount + 不追加指令，让 Lingting 一次返 N 张独立图
  outputMode: z.enum(["grid", "separate"]).default("grid"),
  // Phase A 起新增：image-gen 工作台复用 —— {{变量}} 替换 + 按效果锁模型 + 价格
  variables: z.array(promptVariableSchema).max(20).default([]),
  model: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .nullable()
    .optional()
    .transform((v) => v || "doubao"),
  price: z.number().int().min(0).max(9999).default(0),
});

/** 订单来源平台（共享类型在 types.ts） */
import { ORDER_PLATFORMS } from "./types";

export type { OrderPlatform } from "./types";
export { ORDER_PLATFORM_LABELS, ORDER_PLATFORMS } from "./types";

/** 创建订单 */
export const promptOrderCreateSchema = z
  .object({
    orderNo: z.string().trim().min(1, "订单号不能为空").max(64),
    templateId: z.string().min(1, "模板 ID 必填"),
    // 用户名选填，留空时存 ""（DB 列 notNull 但允许默认空串）
    recipientName: z.string().trim().max(64).optional().default(""),
    // 平台选填，不指定为 undefined
    platform: z.enum(ORDER_PLATFORMS).optional(),
    /**
     * 用户可上传的批次次数（默认 1）。总容量 = uploadCount × imagesPerUpload。
     * 历史遗留字段"上传图片数量"的实际语义是批次数，被误解为张数。
     * 单批上传几张图见 imagesPerUpload。
     */
    uploadCount: z.number().int().min(1).max(50).default(1),
    /**
     * 每批上传的原图参考图数量（1-3，默认 3）。
     * 用户一次"上传"操作可塞 imagesPerUpload 张图，全部塞进去算占满一批。
     * 2026-08-15 起从隐式 1 放宽到 1-3，由用户/管理员每次下单时设置。
     */
    imagesPerUpload: z.number().int().min(1).max(3).default(3),
    /**
     * 用户主动重新生成次数上限（仅 imageIdx 单图路径计数）。
     * 批量重跑 / FAILED 一键重试不计。
     */
    regenerateLimit: z.number().int().min(0).max(20).default(5),
    /**
     * 覆盖已有订单 —— 传 existingId 时走 updateOrder 分支，保留 token/状态/上传内容。
     * null/undefined 表示全新创建。
     */
    replaceOrderId: z.string().min(1).optional(),
    // ============================================
    // 2026-08-23：代理商业务（飞书 docx「链接生成管理系统」）
    // 4 个可选字段，ToB 订单创建时由管理员挑选；ToC 订单全部留空。
    // 字典见 src/features/gpt-image/lib/product-catalog.ts。
    // ============================================
    /** 代理商 ID（指向 agent.id，FK 已设 set null）。空 = ToC 订单 */
    agentId: z.string().min(1).max(64).optional(),
    /** 产品型号（R/A/P/RM，单字母） */
    productTypeCode: z.string().min(1).max(8).optional(),
    /** 尺寸（厘米数字字符串 4/6/8/11） */
    productSize: z.string().min(1).max(8).optional(),
    /** 配件（leather/pvc/bracket），部分型号无配件选项，可选 */
    accessoryCode: z.string().min(1).max(16).optional(),
  })
  // 2026-09-03：三件套字典组合校验 —— 复用 agent 模块的 validateProductSpec。
  // ToC 订单允许三件套全 null；只要任一字段非空就跑校验。
  // 静态 import：实际不构成循环依赖（agent/lib 只依赖 product-catalog，
  // 不依赖 validation）。
  .superRefine((data, ctx) => {
    if (!data.productTypeCode && !data.productSize && !data.accessoryCode) {
      return;
    }
    try {
      validateProductSpec(
        data.productTypeCode ?? null,
        data.productSize ?? null,
        data.accessoryCode ?? null
      );
    } catch (e) {
      // 把校验失败的 message 挂到 productTypeCode 字段上（前端级联出错点）
      const msg = e instanceof Error ? e.message : "产品规格组合不合法";
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productTypeCode"],
        message: msg,
      });
    }
  });

/** 用户上传原图（dataUrl 数组） */
export const uploadImagesSchema = z.object({
  images: z
    .array(z.string().min(1))
    .min(1, "至少上传一张图片")
    .max(50, "一次最多上传 50 张"),
});

/** 用户提交选择 */
export const selectCandidatesSchema = z.object({
  selections: z.array(z.number().int().min(0).max(8)).min(1, "请至少选择一张"),
});

/** 模板 ID 路径参数 */
export const templateIdSchema = z.object({
  id: z.string().min(1),
});

/** 订单 token 路径参数 */
export const orderTokenSchema = z.object({
  token: z.string().min(1),
});

/** 效果图路径参数 */
export const candidatePathSchema = z.object({
  token: z.string().min(1),
  imageIdx: z.coerce.number().int().min(0),
  candIdx: z.coerce.number().int().min(0),
});

/** 原图路径参数 */
export const orderImageQuerySchema = z.object({
  index: z.coerce.number().int().min(0),
});

export type PromptTemplateInput = z.infer<typeof promptTemplateSchema>;
export type PromptOrderCreateInput = z.infer<typeof promptOrderCreateSchema>;
export type UploadImagesInput = z.infer<typeof uploadImagesSchema>;
export type SelectCandidatesInput = z.infer<typeof selectCandidatesSchema>;
