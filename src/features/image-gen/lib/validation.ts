/**
 * 内部生图请求校验 Schema
 *
 * 用于 /api/image/generate 和 generateImageAction
 */

import { z } from "zod";

import type { ImageModelId, ImageSize } from "./image-models/types";
import { IMAGE_MODELS } from "./image-models/types";

// 合法的生图模型 ID 集合
const IMAGE_MODEL_IDS = Object.keys(IMAGE_MODELS) as [
  ImageModelId,
  ...ImageModelId[],
];

// 合法的尺寸集合
const IMAGE_SIZES = Object.values(IMAGE_MODELS)
  .flatMap((m) => m.capabilities.sizes)
  .filter((v, i, a) => a.indexOf(v) === i) as [ImageSize, ...ImageSize[]];

/**
 * 内部生图请求体
 */
export const internalGenerateSchema = z.object({
  model: z.enum(IMAGE_MODEL_IDS),
  mode: z.enum([
    "text_to_image",
    "image_to_image",
    "image_editing",
    "inpainting",
    "upscaling",
  ]),
  prompt: z.string().min(1, "提示词不能为空"),
  negativePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
  maskUrl: z.string().optional(),
  size: z.enum(IMAGE_SIZES).default("1024x1024"),
  customWidth: z.number().int().positive().optional(),
  customHeight: z.number().int().positive().optional(),
  style: z
    .enum([
      "natural",
      "vivid",
      "anime",
      "photographic",
      "digital_art",
      "concept_art",
      "oil_painting",
      "watercolor",
      "3d_render",
      "pixel_art",
    ])
    .optional(),
  batchSize: z.number().int().min(1).max(4).default(1),
  seed: z.number().int().optional(),
  guidanceScale: z.number().min(1).max(20).optional(),
  numInferenceSteps: z.number().int().min(10).max(50).optional(),
  enableSafetyCheck: z.boolean().default(true),
  watermark: z.boolean().default(false),
  maskId: z.string().optional(),
  photoId: z.string().optional(),
});

export type InternalGenerateInput = z.infer<typeof internalGenerateSchema>;

/**
 * 上传照片后写入 photo 表的回调请求
 */
export const createPhotoSchema = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  md5: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  format: z.string().optional(),
  fileSize: z.number().int().nonnegative().optional(),
});

export type CreatePhotoInput = z.infer<typeof createPhotoSchema>;
