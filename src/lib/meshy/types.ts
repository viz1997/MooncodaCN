/**
 * Meshy API 类型定义（2026-09-15）
 *
 * 仅放 Meshy HTTP 响应 / 请求的类型 + Image-to-3D 业务参数。
 * 业务编排（积分 / R2 / 状态机）写在 src/features/canvas/services/meshy-image-to-3d.ts。
 *
 * 字段命名沿用 Meshy 官方文档 snake_case，避免 json key 在 type 与
 * fetch payload 之间反复 transform。
 *
 * 2026-09-16：新增 MeshyMultiImageTo3DOptions 与 MeshyMultiImageTo3DTask，
 * 与单图形态并列。轮询场景只关心 model_urls.glb，复用同 MeshyImageTo3DTask
 * 形态（多图响应是超集，多出的字段都是 optional）。
 */

/**
 * Meshy 任务状态。文档：PENDING / IN_PROGRESS / SUCCEEDED / FAILED / CANCELED
 *
 * 注意：Meshy 用大写枚举值，与我们 DB canvasRemoteJobStatusEnum
 * （pending / processing / completed / failed）小写不同 —— 业务层
 * 在写入 DB 时记得小写化（详见 meshy-image-to-3d.ts 的 statusMap）。
 */
export type MeshyTaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

/**
 * Image-to-3D 任务的可选参数。
 *
 * 字段与 Meshy 官方 POST /openapi/v1/image-to-3d 文档对齐。默认值放在
 * client.ts createImageTo3DTask 的 spread 里，便于单一来源管理。
 */
export type MeshyImageTo3DOptions = {
  ai_model?: "meshy-4-turbo" | "meshy-4" | "meshy-3" | "latest";
  topology?: "triangle" | "quad";
  target_polycount?: number;
  enable_pbr?: boolean;
  texture_resolution?: 512 | 1024 | 2048 | 4096;
  /** Symmetry 模式：默认 off。可选 on / auto。 */
  symmetry_mode?: "off" | "on" | "auto";
  /** 生成时是否给 AI 一段文字提示（如「add a small strap on top」） */
  text_prompt?: string;
  /** 风格 modifier：realistic / sculpture / lowpoly 等 */
  style?: string;
};

/**
 * Meshy 任务响应（GET /openapi/v1/image-to-3d/:id）。
 *
 * 字段随状态变化：PENDING 时 model_urls 为空，SUCCEEDED 才有 glb/fbx。
 * task_error 字段仅在 FAILED 时填充，含上游错误描述。
 *
 * 2026-09-16：multi-image 响应是超集（model_urls 多出 3mf/pre_remeshed_glb，
 * thumbnail_urls 多 4 视图），但只有 model_urls.glb 是轮询场景必须的；
 * 多图额外字段全部 optional 复用本类型。
 *
 * 详见 https://docs.meshy.cn/api/image-to-3d 与 /api/multi-image-to-3d
 */
export type MeshyImageTo3DTask = {
  id: string;
  status: MeshyTaskStatus;
  /** 进度 0~100，仅 PENDING / IN_PROGRESS 有意义 */
  progress?: number;
  created_at?: number;
  started_at?: number;
  finished_at?: number;
  /** Meshy 临时签名 URL，1 天左右过期 —— 业务层必须立即落 R2 */
  model_urls?: {
    glb?: string;
    fbx?: string;
    obj?: string;
    usdz?: string;
    /** multi-image 才有 */
    stl?: string;
    /** multi-image 才有，需 target_formats 显式包含 */
    mtl?: string;
    /** multi-image 才有，需 target_formats 显式包含 */
    "3mf"?: string;
    /** multi-image 才有，需 should_remesh=true + save_pre_remeshed_model=true */
    pre_remeshed_glb?: string;
  };
  thumbnail_url?: string;
  /** multi-image 才有（alpha_thumbnail=true 时返回） */
  alpha_thumbnail_url?: string;
  /** multi-image 才有（multi_view_thumbnails=true 时返回） */
  thumbnail_urls?: {
    front?: string;
    right?: string;
    back?: string;
    left?: string;
  };
  /** 失败原因：仅 FAILED 状态填充 */
  task_error?: {
    message?: string;
    code?: string;
  };
};

/**
 * Multi-Image to 3D 任务的可选参数（2026-09-16）。
 *
 * 字段与 Meshy 官方 POST /openapi/v1/multi-image-to-3d 文档对齐。
 *
 * 与单图 (MeshyImageTo3DOptions) 不复用 —— 多图 endpoint 有不同的模型列表
 * （meshy-5/6/7/latest vs 单图 meshy-4-turbo 等），且多出 ultra_mode /
 * pose_mode / image_enhancement / remove_lighting 等多图专属参数。
 * sibling 类型，不 extends。
 */
export type MeshyMultiImageTo3DOptions = {
  ai_model?: "meshy-5" | "meshy-6" | "meshy-7" | "latest";
  /** 仅 meshy-7 / latest 支持 */
  ultra_mode?: boolean;
  should_texture?: boolean;
  enable_pbr?: boolean;
  texture_resolution?: "2k" | "4k" | "8k";
  target_polycount?: number;
  topology?: "quad" | "triangle";
  /** pose_mode 替代已弃用的 symmetry_mode */
  pose_mode?: "a-pose" | "t-pose" | "";
  image_enhancement?: boolean;
  remove_lighting?: boolean;
  moderation?: boolean;
  /** 限制生成哪些格式；空则生成除 3mf 外所有 */
  target_formats?: Array<"glb" | "fbx" | "obj" | "usdz" | "stl" | "3mf">;
  /** 启用 AI 自动估算物体真实尺寸 */
  auto_size?: boolean;
  /** 引导纹理生成的文本 prompt（≤ 800 字符） */
  texture_prompt?: string;
  /** 风格 modifier */
  style?: string;
};
