// 3D 提供商适配器实现
// 每个适配器负责：1) 校验请求 2) 转换为提供商专属参数 3) 调用 API 4) 标准化响应
// 当前为 Mock 实现（模拟调用），结构已就绪，实际部署时填充 fetch 逻辑即可

import { seededRandom } from "./random";
import {
  type Generate3DRequest,
  type Generate3DResult,
  PROVIDERS_3D,
  type Provider3DAdapter,
  type Provider3DId,
} from "./types";

// 模拟异步延迟
const simulateLatency = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 生成模型ID
const genModelId = (provider: Provider3DId) =>
  `MD_${provider.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`;

// ============ 1. Tripo3D 适配器 ============
export const tripo3dAdapter: Provider3DAdapter = {
  config: PROVIDERS_3D.tripo3d,
  validate(req) {
    if (req.inputType === "text" && !req.textPrompt)
      return "Tripo3D 文本生成需要 textPrompt";
    if (req.inputType === "image" && !req.imageUrl)
      return "Tripo3D 图片生成需要 imageUrl";
    if (
      req.outputFormat &&
      !["glb", "gltf", "fbx", "obj", "usdz"].includes(req.outputFormat)
    ) {
      return "Tripo3D 不支持该输出格式";
    }
    return null;
  },
  async generate(req) {
    await simulateLatency(800 + seededRandom() * 400);
    // Tripo3D 特有参数转换（示例）:
    // - 支持 draft/medium/high/ultra
    // - 自动多视角生成
    const taskId = `tripo_task_${Date.now()}`;
    return {
      success: true,
      provider: "tripo3d",
      taskId,
      modelId: genModelId("tripo3d"),
      status: "processing",
      previewUrl: `https://picsum.photos/seed/tripo${Date.now()}/400/400`,
      cost: 1.2,
      currency: "USD",
      raw: {
        endpoint: "POST https://api.tripo3d.ai/v2/generate",
        payload: {
          type: req.inputType === "text" ? "text_to_model" : "image_to_model",
          prompt: req.textPrompt,
          image: req.imageUrl,
          output_format: req.outputFormat ?? "glb",
          quality: req.quality ?? "medium",
          enable_pbr: req.enablePBR ?? true,
          enable_rigging: req.enableRigging ?? false,
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    return {
      success: true,
      provider: "tripo3d",
      taskId,
      status: "completed",
      modelUrl: `https://cdn.tripo3d.ai/${taskId}/model.glb`,
      previewUrl: `https://picsum.photos/seed/${taskId}/400/400`,
      duration: 25000,
    };
  },
};

// ============ 2. 混元3D 适配器 ============
export const hunyuan3dAdapter: Provider3DAdapter = {
  config: PROVIDERS_3D.hunyuan3d,
  validate(req) {
    if (req.inputType === "text" && !req.textPrompt)
      return "混元3D 文本生成需要 textPrompt";
    if (req.inputType === "image" && !req.imageUrl)
      return "混元3D 图片生成需要 imageUrl";
    if (req.enableRigging) return "混元3D 暂不支持骨骼绑定";
    if (req.enableAnimation) return "混元3D 暂不支持动画";
    return null;
  },
  async generate(req) {
    await simulateLatency(900 + seededRandom() * 500);
    const taskId = `hunyuan_task_${Date.now()}`;
    return {
      success: true,
      provider: "hunyuan3d",
      taskId,
      modelId: genModelId("hunyuan3d"),
      status: "processing",
      previewUrl: `https://picsum.photos/seed/hunyuan${Date.now()}/400/400`,
      cost: 2.5,
      currency: "CNY",
      raw: {
        endpoint: "POST https://hunyuan.tencent.com/api/v1/3d/generate",
        payload: {
          model: "hunyuan3d-2.0",
          input_type: req.inputType,
          text: req.textPrompt,
          image_url: req.imageUrl,
          format: req.outputFormat ?? "glb",
          texture_quality: req.quality ?? "high",
          max_poly: Math.min(req.polyCount ?? 80000, 80000),
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    return {
      success: true,
      provider: "hunyuan3d",
      taskId,
      status: "completed",
      modelUrl: `https://hunyuan.tencent.com/3d/${taskId}.glb`,
      previewUrl: `https://picsum.photos/seed/${taskId}/400/400`,
      duration: 32000,
    };
  },
};

// ============ 3. Meshy 适配器 ============
export const meshyAdapter: Provider3DAdapter = {
  config: PROVIDERS_3D.meshy,
  validate(req) {
    if (req.inputType === "text" && !req.textPrompt)
      return "Meshy 文本生成需要 textPrompt";
    if (req.inputType === "image" && !req.imageUrl)
      return "Meshy 图片生成需要 imageUrl";
    return null;
  },
  async generate(req) {
    await simulateLatency(600 + seededRandom() * 300);
    const taskId = `meshy_task_${Date.now()}`;
    return {
      success: true,
      provider: "meshy",
      taskId,
      modelId: genModelId("meshy"),
      status: "processing",
      previewUrl: `https://picsum.photos/seed/meshy${Date.now()}/400/400`,
      cost: 0.8,
      currency: "USD",
      raw: {
        endpoint: "POST https://api.meshy.ai/v2/generate",
        payload: {
          mode: req.inputType === "text" ? "text-to-3d" : "image-to-3d",
          prompt: req.textPrompt,
          image_url: req.imageUrl,
          art_style: "realistic",
          negative_prompt: "low quality, blurry",
          output_formats: [req.outputFormat ?? "glb"],
          enable_pbr: req.enablePBR ?? true,
          should_remesh: req.polyCount ? true : false,
          target_polycount: req.polyCount ?? 50000,
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    return {
      success: true,
      provider: "meshy",
      taskId,
      status: "completed",
      modelUrl: `https://api.meshy.ai/v2/${taskId}/model.glb`,
      previewUrl: `https://picsum.photos/seed/${taskId}/400/400`,
      duration: 18500,
    };
  },
};

// ============ 4. Hyper3D (Rodin) 适配器 ============
export const hyper3dAdapter: Provider3DAdapter = {
  config: PROVIDERS_3D.hyper3d,
  validate(req) {
    if (req.inputType === "text" && !req.textPrompt)
      return "Hyper3D 文本生成需要 textPrompt";
    if (req.inputType === "image" && !req.imageUrl)
      return "Hyper3D 图片生成需要 imageUrl";
    if (req.enableAnimation) return "Hyper3D Rodin 当前版本不支持动画";
    return null;
  },
  async generate(req) {
    await simulateLatency(1100 + seededRandom() * 600);
    const taskId = `rodin_task_${Date.now()}`;
    return {
      success: true,
      provider: "hyper3d",
      taskId,
      modelId: genModelId("hyper3d"),
      status: "processing",
      previewUrl: `https://picsum.photos/seed/rodin${Date.now()}/400/400`,
      cost: 1.5,
      currency: "USD",
      raw: {
        endpoint: "POST https://api.hyper3d.ai/v1/rodin/generate",
        payload: {
          model: "rodin-v2",
          input_mode: req.inputType,
          text: req.textPrompt,
          images: req.imageUrl ? [req.imageUrl] : [],
          quality_tier: req.quality ?? "high",
          output_format: req.outputFormat ?? "glb",
          texture_resolution: req.outputFormat ? 4096 : 2048,
          max_polygon_count: Math.min(req.polyCount ?? 150000, 150000),
          enable_pbr: req.enablePBR ?? true,
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    return {
      success: true,
      provider: "hyper3d",
      taskId,
      status: "completed",
      modelUrl: `https://cdn.hyper3d.ai/${taskId}/rodin.glb`,
      previewUrl: `https://picsum.photos/seed/${taskId}/400/400`,
      duration: 42000,
    };
  },
};

// ============ 5. Hitem3D 适配器 ============
export const hitem3dAdapter: Provider3DAdapter = {
  config: PROVIDERS_3D.hitem3d,
  validate(req) {
    if (req.inputType === "text" && !req.textPrompt)
      return "Hitem3D 文本生成需要 textPrompt";
    if (req.inputType === "image" && !req.imageUrl)
      return "Hitem3D 图片生成需要 imageUrl";
    if (req.enableRigging) return "Hitem3D 不支持骨骼绑定";
    if (req.enableAnimation) return "Hitem3D 不支持动画";
    if (req.polyCount && req.polyCount > 60000) return "Hitem3D 最大面数 60000";
    return null;
  },
  async generate(req) {
    await simulateLatency(500 + seededRandom() * 300);
    const taskId = `hitem_task_${Date.now()}`;
    return {
      success: true,
      provider: "hitem3d",
      taskId,
      modelId: genModelId("hitem3d"),
      status: "processing",
      previewUrl: `https://picsum.photos/seed/hitem${Date.now()}/400/400`,
      cost: 1.8,
      currency: "CNY",
      raw: {
        endpoint: "POST https://api.hitem3d.com/v1/generate",
        payload: {
          input_type: req.inputType,
          text: req.textPrompt,
          image: req.imageUrl,
          format: req.outputFormat ?? "glb",
          poly_count: Math.min(req.polyCount ?? 60000, 60000),
          texture: req.enablePBR ? "pbr" : "simple",
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    return {
      success: true,
      provider: "hitem3d",
      taskId,
      status: "completed",
      modelUrl: `https://api.hitem3d.com/${taskId}/model.glb`,
      previewUrl: `https://picsum.photos/seed/${taskId}/400/400`,
      duration: 15000,
    };
  },
};

// ============ 6. Triverse3D 适配器 ============
export const triverse3dAdapter: Provider3DAdapter = {
  config: PROVIDERS_3D.triverse3d,
  validate(req) {
    if (PROVIDERS_3D.triverse3d.status === "maintenance") {
      return "Triverse3D 当前维护中，预计 2 小时后恢复";
    }
    if (req.inputType === "text" && !req.textPrompt)
      return "Triverse3D 文本生成需要 textPrompt";
    if (req.inputType === "image" && !req.imageUrl)
      return "Triverse3D 图片生成需要 imageUrl";
    return null;
  },
  async generate(req) {
    await simulateLatency(900 + seededRandom() * 500);
    const taskId = `triver_task_${Date.now()}`;
    return {
      success: true,
      provider: "triverse3d",
      taskId,
      modelId: genModelId("triverse3d"),
      status: "processing",
      previewUrl: `https://picsum.photos/seed/triver${Date.now()}/400/400`,
      cost: 1.0,
      currency: "USD",
      raw: {
        endpoint: "POST https://api.triverse3d.com/v2/create",
        payload: {
          mode: req.inputType === "text" ? "text_to_3d" : "image_to_3d",
          prompt: req.textPrompt,
          image_url: req.imageUrl,
          output_format: req.outputFormat ?? "glb",
          quality: req.quality ?? "high",
          enable_lod: true,
          auto_topology: true,
          enable_pbr: req.enablePBR ?? true,
          enable_rigging: req.enableRigging ?? false,
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    return {
      success: true,
      provider: "triverse3d",
      taskId,
      status: "completed",
      modelUrl: `https://api.triverse3d.com/${taskId}/model.glb`,
      previewUrl: `https://picsum.photos/seed/${taskId}/400/400`,
      duration: 28000,
    };
  },
};

// ============ 适配器注册表 ============
export const ADAPTERS_3D: Record<Provider3DId, Provider3DAdapter> = {
  tripo3d: tripo3dAdapter,
  hunyuan3d: hunyuan3dAdapter,
  meshy: meshyAdapter,
  hyper3d: hyper3dAdapter,
  hitem3d: hitem3dAdapter,
  triverse3d: triverse3dAdapter,
};

// 统一调度入口
export async function dispatchGenerate3D(
  req: Generate3DRequest
): Promise<Generate3DResult> {
  const adapter = ADAPTERS_3D[req.provider];
  if (!adapter) {
    return {
      success: false,
      provider: req.provider,
      status: "failed",
      error: `未知的提供商: ${req.provider}`,
    };
  }
  // 检查状态
  if (adapter.config.status === "maintenance") {
    return {
      success: false,
      provider: req.provider,
      status: "failed",
      error: `${adapter.config.name} 当前维护中`,
    };
  }
  if (adapter.config.status === "deprecated") {
    return {
      success: false,
      provider: req.provider,
      status: "failed",
      error: `${adapter.config.name} 已下线`,
    };
  }
  // 校验
  const validationError = adapter.validate(req);
  if (validationError) {
    return {
      success: false,
      provider: req.provider,
      status: "failed",
      error: validationError,
    };
  }
  // 调用
  try {
    const result = await adapter.generate(req);
    // 模拟异步任务完成
    if (result.taskId) {
      // 等待 2 秒后查询
      setTimeout(async () => {
        await adapter.queryTask(result.taskId!);
      }, 2000);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return {
      success: false,
      provider: req.provider,
      status: "failed",
      error: msg,
    };
  }
}
