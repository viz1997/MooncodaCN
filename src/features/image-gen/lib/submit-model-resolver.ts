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
 *
 * 2026-10-14 alias 归一化:小程序 / 浏览器客户端会用营销名(如 `2.5-fast` /
 * `2.5-plus`)指代本系统的 `apimart_gpt_image` / `apimart_gpt_image_sunburst`。
 * 这些名字不在 `ImageModelId` 类型里(类型故意保持严格),只在 BFF 入口处
 * 通过 `MODEL_ALIASES` 表归一化。白名单校验发生在归一化之后,所以表中没有的
 * 字符串(任意拼写错误、过期名)仍然 403 MODEL_NOT_ALLOWED —— **不会**因别名
 * 表变宽松而掩盖客户端 bug。
 *
 * 下线策略:每次新增 alias 必须配套:
 *   1. 一条 deprecation 日志(看 `ResolveSelectedModelResult.aliasUsed` 字段,
 *      由 route 层用 logImageGen 上报,统计发送频率 → 驱动客户端迁移);
 *   2. 推动客户端迁移的 owner 与时间表(默认 1 季度后从表中移除);
 *   3. 移除时同步更新 `external-api-for-miniprogram.md` 和
 *      `src/clients/miniprogram-sdk/README.md`。
 */
import type { ImageModelId } from "./image-models/types";

/**
 * 客户端营销 / 上游别名 → 规范 ImageModelId。
 *
 * 严格匹配(小写 + trim 后相等),不允许 `2.5fast` / `2.5 fast` 这类近似匹配,
 * 防止 typo-bypass。
 *
 * 当前条目(2026-10-14):
 *   - `2.5-fast`  → apimart_gpt_image            (apimart 速度/成本档,营销名「快」)
 *   - `2.5-plus`  → apimart_gpt_image_sunburst   (apimart 质量档,营销名「PLUS」)
 */
export const MODEL_ALIASES: Readonly<Record<string, ImageModelId>> =
  Object.freeze({
    "2.5-fast": "apimart_gpt_image",
    "2.5-plus": "apimart_gpt_image_sunburst",
  });

/**
 * 把任意输入字符串归一化为规范 ImageModelId(可能命中 alias,也可能本身就在白名单)。
 *
 * 返回:
 *   - canonical: 命中 alias 时返回规范 ID;输入本身已是规范 ID 也返回原值;其余返回 null
 *   - alias: 仅当「输入不是规范 ID 但命中 alias」时返回原 alias 字符串(便于上报)
 *   - alias 为 null 时,调用方照常走白名单校验(由 resolver 内部处理)
 */
export function normalizeModelAlias(
  input: string,
  allowedModels: readonly ImageModelId[]
): {
  canonical: ImageModelId | null;
  alias: string | null;
} {
  const key = input.trim().toLowerCase();
  // 已在白名单 → 原样返回(保留原大小写,便于排查)
  if ((allowedModels as readonly string[]).includes(key)) {
    return { canonical: key as ImageModelId, alias: null };
  }
  // 命中 alias
  const aliased = MODEL_ALIASES[key];
  if (aliased) {
    return { canonical: aliased, alias: key };
  }
  return { canonical: null, alias: null };
}

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
  /**
   * 命中 alias 时附带原始名字 + 归一化后的规范 ID,供 route 层打 deprecation 日志
   * 统计发送频率。alias 是 `2.5-fast` 这类营销名,canonical 是 `apimart_gpt_image`。
   * 未命中 alias 时为 undefined。
   */
  aliasUsed?: {
    alias: string;
    canonical: ImageModelId;
  };
}

export function resolveSelectedModel(
  input: ResolveSelectedModelInput
): ResolveSelectedModelResult {
  const { bodyModel, maskModel, allowedModels, fallback } = input;

  // 分支 1:用户显式指定 model —— 不被 mask.model 反向覆盖
  if (bodyModel !== undefined) {
    const normalized = normalizeModelAlias(bodyModel, allowedModels);
    if (normalized.canonical) {
      return {
        selectedModel: normalized.canonical,
        fromUserOverride: true,
        ...(normalized.alias
          ? {
              aliasUsed: {
                alias: normalized.alias,
                canonical: normalized.canonical,
              },
            }
          : {}),
      };
    }
    // 不在白名单也不在 alias 表 → 403,签名一路返回 undefined
    return { selectedModel: undefined, fromUserOverride: true };
  }

  // 分支 2:用户未指定 —— mask.model(过白名单)→ fallback
  // mask.model 也走归一化,防止 mask 配置里误写营销名导致悄悄兜底到 fallback
  // 而埋点看不到「mask 推荐被 alias 救回」的信号。
  const maskNormalized = maskModel
    ? normalizeModelAlias(maskModel, allowedModels)
    : null;
  const recommended = (maskNormalized?.canonical ?? fallback) as ImageModelId;
  return {
    selectedModel: allowedModels.includes(recommended) ? recommended : fallback,
    fromUserOverride: false,
    ...(maskNormalized?.alias
      ? {
          aliasUsed: {
            alias: maskNormalized.alias,
            canonical: maskNormalized.canonical as ImageModelId,
          },
        }
      : {}),
  };
}
