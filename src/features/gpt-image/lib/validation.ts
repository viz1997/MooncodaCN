/**
 * GPT-Image 业务 Zod 校验
 */

import { z } from "zod";

/** 创建/更新提示词模板 */
export const promptTemplateSchema = z.object({
  name: z.string().trim().min(1, "模板名称不能为空").max(100),
  description: z.string().trim().min(1, "描述不能为空").max(500),
  prompt: z.string().trim().min(1, "提示词不能为空").max(4000),
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
});

/** 订单来源平台（共享类型在 types.ts） */
import { ORDER_PLATFORMS } from "./types";
export { ORDER_PLATFORMS, ORDER_PLATFORM_LABELS } from "./types";
export type { OrderPlatform } from "./types";

/** 创建订单 */
export const promptOrderCreateSchema = z.object({
  orderNo: z.string().trim().min(1, "订单号不能为空").max(64),
  templateId: z.string().min(1, "模板 ID 必填"),
  // 用户名选填，留空时存 ""（DB 列 notNull 但允许默认空串）
  recipientName: z.string().trim().max(64).optional().default(""),
  // 平台选填，不指定为 undefined
  platform: z.enum(ORDER_PLATFORMS).optional(),
  uploadCount: z.number().int().min(1).max(50).default(1),
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
