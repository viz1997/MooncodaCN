/**
 * 生图相关持久化数据类型
 *
 * 用于 db/schema.ts 中 json 列的 $type<...> 类型标注，
 * 放在 db 目录以避免 db → features 的反向依赖。
 *
 * 共享类型 PromptVariable / PromptVersion 现在定义在本文件，
 * features/image-gen 与 features/gpt-image 都从这里导入。
 * （原 product-effect-types.ts 仅作为兼容期 re-export 壳，Phase D 退役时删）
 */

import type { PromptVersion as FeaturePromptVersion } from "@/features/image-gen/lib/product-effect-types";

/** 提示词变量定义（持久化为 JSON） */
export interface PromptVariable {
  key: string; // 变量名，如 photo_style
  label: string; // 显示名，如 照片风格
  defaultValue: string;
  required: boolean;
  description?: string | undefined;
  options?: string[] | undefined; // 候选取值；有则渲染下拉，无则渲染文本框
}

/** 提示词版本历史（持久化为 JSON） */
export type PromptVersion = FeaturePromptVersion;
