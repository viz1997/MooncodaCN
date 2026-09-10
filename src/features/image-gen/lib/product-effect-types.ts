// 产品效果 / 模版 类型定义
// 产品效果 = AI效果定义 + 自带提示词（支持变量）+ 关联生图模型
//
// Phase A 起 PromptVariable 已迁到 @/db/image-gen-types 作为跨模块共享类型，
// 这里仅 re-export 保留向后兼容，Phase D 删除本文件时一并清理。

import type { PromptVariable } from "@/db/image-gen-types";
import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";

export type { PromptVariable };

// 提示词版本历史
export interface PromptVersion {
  version: string; // 如 v1.0.0
  content: string;
  createdAt: string;
  note?: string | undefined;
}

// AI 模型场景
export type PromptScene =
  | "generate_2d" // 2D 效果图生成
  | "generate_3d" // 3D 模型生成
  | "translate" // 文本翻译
  | "stylize" // 风格化
  | "enhance" // 图片增强
  | "custom"; // 自定义

export const PROMPT_SCENE_LABELS: Record<PromptScene, string> = {
  generate_2d: "2D效果图生成",
  generate_3d: "3D模型生成",
  translate: "文本翻译",
  stylize: "风格化",
  enhance: "图片增强",
  custom: "自定义",
};

export const PROMPT_SCENE_COLORS: Record<PromptScene, string> = {
  generate_2d:
    "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  generate_3d:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  translate: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  stylize:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  enhance: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  custom: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
};

export interface ProductEffect {
  maskId: string;
  name: string;
  category: string;
  description: string;
  previewUrl: string;
  // 提示词（支持 {{变量}} 占位符）
  prompt: string;
  // 提示词变量定义
  variables: PromptVariable[];
  // AI 场景与推荐模型
  scene: PromptScene;
  model: string; // 推荐使用的生图模型 id，如 doubao / nano_banana2
  // 版本历史
  versions: PromptVersion[];
  config: {
    style: string;
    color?: string | undefined;
    material?: string | undefined;
  };
  price: number;
  status: "active" | "inactive";
  usageCount: number;
  successRate: number; // 成功率 0-100
  avgDuration: number; // 平均耗时(ms)
  createdAt: string;
  updatedAt: string;
  author: string;
  // 关联的产品线
  productLineIds?: string[] | undefined;
  /**
   * 2026-09-09：绑定的产品型号（与 PRODUCT_TYPES 字典对齐）。
   * /image-gen 工作台选模板后按此字段渲染 productSize/accessoryCode/engraving 表单。
   * null 表示纯 ToC 模板（无定制）。
   */
  productTypeCode?: string | null | undefined;
  /**
   * 2026-09-10：该模板允许的尺寸子集（单位 cm 数字字符串数组）。
   * 空 = 用字典全量。
   */
  allowedSizes?: string[] | undefined;
  /**
   * 2026-09-10：该模板允许的配件子集（code 数组）。
   * 空 = 用字典全量。
   */
  allowedAccessories?: string[] | undefined;
  /**
   * 2026-09-10：模板级 capability 覆盖（仅作用于创建时，SpecModal 渲染 effective capability）。
   * - null/undefined → 继承 productTypeCode 对应 PRODUCT_TYPES 字典里的 capabilities
   * - 非空 → 只覆盖 override 里出现的 key；canEngrave 始终跟随 catalog（不在覆盖范围）
   *
   * /p/[token] 仍按 catalog 默认能力（不读此覆盖），避免"已生成订单被追溯关能力"，
   * 覆盖的语义边界 = "未来创建的订单"。见 [[image-gen-product-effect-capabilities]]。
   */
  allowedCapabilities?: Partial<ProductCapabilities> | null | undefined;
  /**
   * 2026-09-10：皮革颜色子集（code 数组）。
   * - null/undefined/[] → LEATHER_COLORS 全展示
   * - 非空 → 仅这些 code（不在 LEATHER_COLORS 字典里的静默丢弃）
   */
  allowedColors?: string[] | null | undefined;
  /**
   * 2026-09-10：引用 prompt_template.id（gpt-image 模块的提示词模板表）。
   * - null/undefined = 不引用，生成时用本地 prompt 字段
   * - 非空 = 生成时优先用 promptTemplate.prompt（fallback 到本字段）
   * admin 在 product-effect-form 里下拉选 promptTemplate；
   * 不加 DB FK（与 productLineIds 一致，应用层校验合法性）
   */
  promptTemplateId?: string | null | undefined;
}

// ============================================
// 2026-09-10：产品线独立类型（替代 MOCK_PRODUCT_LINES 前端 mock）
// ============================================
/** 产品线规格：尺寸区间 / 材质 / 工艺 */
export interface ProductLineSpec {
  sizeRange?: { min: number; max: number; unit: "mm" | "cm" };
  material?: string[];
  finish?: string[];
}
/** 产品线报价：基础价 / 阶梯加价 / 工艺加价 */
export interface ProductLinePricing {
  basePrice: number;
  currency?: string;
  sizeSurcharge?: Array<{ threshold: number; extra: number }>;
  finishSurcharge?: Record<string, number>;
}
/** 产品线运行时类型（来自 product_line 表） */
export interface ProductLine {
  productLineId: string;
  name: string;
  category: string;
  description: string;
  coverUrl: string;
  spec: ProductLineSpec;
  pricing: ProductLinePricing;
  status: "active" | "inactive" | "draft";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
