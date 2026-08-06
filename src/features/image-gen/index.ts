// image-gen feature 公共导出

export {
  createEffectInDb,
  deleteEffectInDb,
  findEffectInDb,
  getActiveEffectsFromDb,
  getEffectsFromDb,
  updateEffectInDb,
} from "./lib/db-effects";
// 产品效果
export {
  addEffect,
  deleteEffect,
  findEffect,
  getActiveEffects,
  getEffects,
  mergeVariables,
  updateEffect,
} from "./lib/effects-store";
// 生图业务服务
export {
  generateImageJob,
  getImageJob,
  listImageJobs,
  updateImageJobFromTaskResult,
} from "./lib/generation-service";
export type { ImageGenLogEntry } from "./lib/image-gen-log";
// 埋点
export {
  buildResultFields,
  extractSubmitContext,
  getClientIp,
  logImageGen,
} from "./lib/image-gen-log";
// 生图模型适配层
export {
  dispatchGenerateImage,
  dispatchQueryImageTask,
  IMAGE_ADAPTERS,
  parseTaskModel,
} from "./lib/image-models/adapters";
export type {
  GeneratedImage,
  GenerateImageRequest,
  GenerateImageResult,
  GenerationMode,
  ImageModelCapabilities,
  ImageModelConfig,
  ImageModelId,
  ImageSize,
  ImageStyle,
  ModelStatus,
} from "./lib/image-models/types";
export {
  IMAGE_MODEL_LIST,
  IMAGE_MODELS,
  MODE_LABELS,
  STYLE_LABELS,
} from "./lib/image-models/types";
export type {
  ProductEffect,
  PromptScene,
  PromptVariable,
  PromptVersion,
} from "./lib/product-effect-types";
export {
  PROMPT_SCENE_COLORS,
  PROMPT_SCENE_LABELS,
} from "./lib/product-effect-types";
export type { PresignResult } from "./lib/r2";
export {
  getPublicUrl,
  getR2PublicHosts,
  isR2Configured,
  presignUpload,
  putObject,
  R2_BUCKET,
} from "./lib/r2";
