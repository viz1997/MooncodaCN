// 外部用户生图 API - 服务端预配置，用户无需登录
// ⚠️ 安全：响应只返回图片 URL + 友好提示，不暴露内部 model/提示词/成本等
import { type NextRequest, NextResponse } from "next/server";
import {
  buildResultFields,
  dispatchGenerateImage,
  findEffect,
  getClientIp,
  getEffects,
  IMAGE_MODELS,
  logImageGen,
} from "@/features/image-gen";
import type {
  GenerateImageRequest,
  ImageModelId,
} from "@/features/image-gen/lib/image-models/types";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

// 外部用户可用全部模型（服务端控制，前端不感知具体模型）
const PUBLIC_ALLOWED_MODELS: ImageModelId[] = [
  "doubao",
  "gpt_image_2",
  "dalle3",
  "sd3",
  "flux1",
  "midjourney",
  "wanx",
  "ernie",
  "cogview",
  "nano_banana_pro",
  "nano_banana2",
];

interface PublicGenerateRequest {
  // 无需 apiKey，服务端预配置
  imageUrl?: string; // 支持图片URL或base64 data URI
  maskId?: string;
  prompt?: string;
  size?: string;
  params?: Record<string, string>; // 用户填入的变量取值，优先于 defaultValue
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // IP 限流：公共生图较昂贵，用 strict 限流（3/分钟）
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  try {
    const body: PublicGenerateRequest = await req.json();

    // 解析 prompt
    let prompt = body.prompt ?? "";
    let selectedModel: ImageModelId = "doubao";
    let maskName = "自定义";

    if (body.maskId) {
      const mask = await findEffect(body.maskId);
      if (!mask || mask.status !== "active") {
        return NextResponse.json(
          {
            success: false,
            error: "效果不存在或已下架",
            code: "INVALID_MASK",
          },
          { status: 400 }
        );
      }
      prompt = mask.prompt;
      // 必填变量校验：required 且无 params 值且无 defaultValue → 拒绝
      const missing = mask.variables.find(
        (v) => v.required && !(body.params?.[v.key] ?? v.defaultValue)
      );
      if (missing) {
        return NextResponse.json(
          { success: false, error: "缺少必填参数", code: "MISSING_PARAM" },
          { status: 400 }
        );
      }
      // 替换占位符：用户传入值 > defaultValue
      mask.variables.forEach((v) => {
        const val = body.params?.[v.key] || v.defaultValue;
        prompt = prompt.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), val);
      });
      maskName = mask.name;
      // 优先使用产品效果指定的生图模型（降级到 doubao）
      const preferredModel = (mask.model as ImageModelId) || "doubao";
      selectedModel = PUBLIC_ALLOWED_MODELS.includes(preferredModel)
        ? preferredModel
        : "doubao";
    }

    if (!prompt) {
      return NextResponse.json(
        {
          success: false,
          error: "请提供 maskId 或 prompt",
          code: "MISSING_INPUT",
        },
        { status: 400 }
      );
    }

    if (!PUBLIC_ALLOWED_MODELS.includes(selectedModel)) {
      return NextResponse.json(
        { success: false, error: "型不可用", code: "MODEL_NOT_ALLOWED" },
        { status: 403 }
      );
    }

    const modelConfig = IMAGE_MODELS[selectedModel];
    if (modelConfig.status === "maintenance") {
      return NextResponse.json(
        {
          success: false,
          error: "服务维护中，请稍后再试",
          code: "MODEL_MAINTENANCE",
        },
        { status: 503 }
      );
    }

    const internalReq: GenerateImageRequest = {
      model: selectedModel,
      mode: body.imageUrl ? "image_to_image" : "text_to_image",
      prompt,
      ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
      size: (body.size as GenerateImageRequest["size"]) ?? "1024x1024",
      batchSize: 1,
      enableSafetyCheck: true,
      ...(body.maskId !== undefined && { maskId: body.maskId }),
    };

    const result = await dispatchGenerateImage(internalReq);

    // 埋点：记录外部用户本次生图的结果（服务端用，不回传客户端）
    logImageGen({
      event: "submit",
      source: "public",
      model: selectedModel,
      mode: internalReq.mode,
      hasRefImage: !!body.imageUrl,
      maskId: body.maskId,
      size: internalReq.size,
      batchSize: 1,
      ...buildResultFields(result),
      ip,
    });

    // 响应只回传必要字段：图片 / 任务 id + 友好状态，不暴露 model/cost/currency
    if (result.success && result.taskId && result.status === "processing") {
      return NextResponse.json(
        {
          success: true,
          image: null,
          maskName,
          taskId: result.taskId,
          taskStatus: "processing",
        },
        { headers: getRateLimitHeaders(rl) }
      );
    }

    return NextResponse.json(
      {
        success: result.success,
        image: result.images?.[0] ?? null,
        maskName,
        taskId: result.taskId,
        taskStatus: result.status,
        error: result.success ? undefined : "生成失败，请稍后重试",
      },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (error) {
    console.error("[Public Generate Error]", error);
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "unknown",
      errorCode: "INTERNAL_ERROR",
      errorMessage: error instanceof Error ? error.message : "未知错误",
      ip,
    });
    return NextResponse.json(
      { success: false, error: "生成失败，请稍后重试", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

// 获取外部用户可用的效果模版列表
// ⚠️ 只返回 maskId + name + previewUrl，不暴露 model/price/prompt 等内部内容
export async function GET() {
  const effects = await getEffects();
  return NextResponse.json({
    success: true,
    masks: effects
      .filter((m) => m.status === "active")
      .map((m) => ({
        maskId: m.maskId,
        name: m.name,
        previewUrl: m.previewUrl,
      })),
  });
}
