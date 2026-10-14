/**
 * Submit 路由 model 优先级解析器 —— 纯函数,可单元测试。
 *
 * 2026-10-14:旧逻辑把 mask.model 当硬约束,leather badge 这种 mask.model = gpt_image_2
 * 的 case 会让用户在 body 里显式传 apimart_gpt_image_sunburst 仍然被反向覆盖回
 * gpt_image_2。新语义:
 *
 *   body.model(用户显式,可选) > mask.model(模板推荐默认) > fallback(系统兜底)
 *
 * 关键设计:
 * - 用户显式传的 model **不会被 mask 推荐反向兜底**;它要么在 allowedModels 里(返回),
 *   要么不在(返回 undefined,由调用方决定是否返 403)。
 * - mask.model 仅在用户未显式传时才参与决策,且过白名单。
 * - mask.model 缺省(空/undefined)或不在白名单时,落到 fallback(一般是 apimart_gpt_image)。
 *
 * 该函数**只解析**,不做白名单以外的校验(如外部 API Key 的 mask 白名单);
 * 不打日志、不返 HTTP 响应。Route 层拿到结果后再决定:
 *   - selectedModel === undefined → 403 MODEL_NOT_ALLOWED(用户传了非法 model)
 *   - selectedModel !== undefined → 透传到 dispatchGenerateImage
 */
import type { ImageModelId } from "./image-models/types";

export interface ResolveSelectedModelInput {
  /**
   * 用户在 body 里显式指定的 model(可选)。类型故意放宽到 string,
   * 因为客户端可能传任何字符串(历史遗留 id、拼错、已下线模型等),
   * 服务端只用 PUBLIC_ALLOWED_MODELS 校验合法性。
   */
  bodyModel: string | undefined;
  /** 模板 / mask 自带的推荐 model(可选,可能是历史遗留的非 ImageModelId 字符串) */
  maskModel: string | null | undefined;
  /** 服务端公共白名单(PUBLIC_ALLOWED_MODELS) */
  allowedModels: readonly ImageModelId[];
  /** 系统兜底(默认 "apimart_gpt_image") */
  fallback: ImageModelId;
}

export interface ResolveSelectedModelResult {
  /** 最终 model,undefined 表示用户显式传的 model 不在白名单 */
  selectedModel: ImageModelId | undefined;
  /**
   * 是否来自用户显式指定 —— 用于埋点区分「用户主动选」vs「mask 推荐」vs「默认兜底」,
   * 便于后续分析 mask 推荐命中率与用户主动覆盖率。
   */
  fromUserOverride: boolean;
}

export function resolveSelectedModel(
  input: ResolveSelectedModelInput,
): ResolveSelectedModelResult {
  const { bodyModel, maskModel, allowedModels, fallback } = input;

  // 分支 1:用户显式指定 model —— 不被 mask.model 反向覆盖
  if (bodyModel !== undefined) {
    return {
      selectedModel: allowedModels.includes(bodyModel as ImageModelId)
        ? (bodyModel as ImageModelId)
        : undefined,
      fromUserOverride: true,
    };
  }

  // 分支 2:用户未指定 —— mask.model(过白名单)→ fallback
  const recommended = (maskModel as ImageModelId | null | undefined) || fallback;
  return {
    selectedModel: allowedModels.includes(recommended) ? recommended : fallback,
    fromUserOverride: false,
  };
}
