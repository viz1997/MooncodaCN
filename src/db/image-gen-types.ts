/**
 * 生图相关持久化数据类型
 *
 * 用于 db/schema.ts 中 json 列的 $type<...> 类型标注，
 * 与 features/image-gen/lib/product-effect-types.ts 的 PromptVariable / PromptVersion 保持结构一致。
 * 放在 db 目录以避免 db → features 的反向依赖。
 */

import type {
  PromptVariable as FeaturePromptVariable,
  PromptVersion as FeaturePromptVersion,
} from "@/features/image-gen/lib/product-effect-types";

/** 提示词变量定义（持久化为 JSON） */
export type PromptVariable = FeaturePromptVariable;

/** 提示词版本历史（持久化为 JSON） */
export type PromptVersion = FeaturePromptVersion;

/** 产品效果配置（持久化为 JSON） */
export interface ProductEffectConfig {
  style: string;
  color?: string;
  material?: string;
}
