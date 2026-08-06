// 产品效果 / 模版 类型定义
// 产品效果 = AI效果定义 + 自带提示词（支持变量）+ 关联生图模型

// 提示词变量定义
export interface PromptVariable {
  key: string; // 变量名，如 photo_style
  label: string; // 显示名，如 照片风格
  defaultValue: string;
  required: boolean;
  description?: string | undefined;
  options?: string[] | undefined; // 候选取值；有则渲染下拉，无则渲染文本框
}

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
}
