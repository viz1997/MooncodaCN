// 外部用户生图 API - 服务端预配置，用户无需登录
// ⚠️ 安全：响应只返回图片 URL + 友好提示，不暴露内部 model/提示词/成本等

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptTemplate } from "@/db/schema";
import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";
import {
  buildResultFields,
  dispatchGenerateImage,
  findEffect,
  getClientIp,
  getEffects,
  IMAGE_MODELS,
  logImageGen,
} from "@/features/image-gen";
import { getActiveLinesFromDb } from "@/features/image-gen/lib/db-lines";
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
// 2026-09-11：精简为 3 个核心模型（qwen / gpt_image_2 / nano_banana2）。
// 旧即梦 / DALL-E / SD / Flux / Midjourney / 通义万相 / 文心一格 / CogView / Nano Banana Pro 全部下线。
const PUBLIC_ALLOWED_MODELS: ImageModelId[] = [
  "qwen",
  "gpt_image_2",
  "nano_banana2",
];

interface PublicGenerateRequest {
  // 无需 apiKey，服务端预配置
  imageUrl?: string; // 支持图片URL或base64 data URI（兼容旧 client，单张）
  /**
   * 2026-09-10：多张参考图数组（与工作台对齐，max 10）。
   * 客户端优先传 imageUrls[]；服务端同时认 imageUrls 和 imageUrl 单数（向后兼容）。
   * mode 判断：imageUrls.length > 0 OR imageUrl 非空 都走 image_to_image。
   */
  imageUrls?: string[];
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
    // 2026-09-11：默认模型从 doubao 切到 qwen（中文场景 + 国产合规兜底）。
    let selectedModel: ImageModelId = "qwen";
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
      // 2026-09-10：prompt 来源优先级
      // 1) productEffect.promptTemplateId 命中 promptTemplate 行 → 用其 prompt
      // 2) fallback 到 productEffect.prompt 本地字段
      if (mask.promptTemplateId) {
        try {
          const tmpl = await db.query.promptTemplate.findFirst({
            where: eq(promptTemplate.id, mask.promptTemplateId),
          });
          if (tmpl?.prompt) {
            prompt = tmpl.prompt;
          } else {
            prompt = mask.prompt;
          }
        } catch {
          prompt = mask.prompt;
        }
      } else {
        prompt = mask.prompt;
      }
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
      // 优先使用产品效果指定的生图模型（降级到 qwen）
      // 2026-09-11：精简后旧 mask.model === "doubao" 也会被 isPublicAllowed 过滤掉，
      // 自动落到 qwen（与 IMAGE_MODELS 默认值对齐）。
      const preferredModel = (mask.model as ImageModelId) || "qwen";
      selectedModel = PUBLIC_ALLOWED_MODELS.includes(preferredModel)
        ? preferredModel
        : "qwen";
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

    // 2026-09-10：合并 imageUrls[]  + imageUrl 单数，统一收敛成 imageUrls[] 透传
    // 给 dispatchGenerateImage（与 generation-service.buildGenerateRequest 语义一致）。
    const refImageUrls: string[] = [
      ...(Array.isArray(body.imageUrls) ? body.imageUrls : []),
      ...(body.imageUrl ? [body.imageUrl] : []),
    ];
    const hasRef = refImageUrls.length > 0;

    const internalReq: GenerateImageRequest = {
      model: selectedModel,
      mode: hasRef ? "image_to_image" : "text_to_image",
      prompt,
      // adapter 内部只看 imageUrls（看 adapters.ts validateImageRequest 系列校验）
      ...(hasRef && { imageUrls: refImageUrls }),
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
        // 把上游真实错误透传给用户（之前 catch-all 文案掩盖了根因）
        error: result.success
          ? undefined
          : (result.error ?? "生成失败，请稍后重试"),
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
// ⚠️ 只返回 maskId + name + previewUrl + productTypeCode + price，不暴露 model/prompt 等内部内容
// 2026-09-09：/image-gen 升级为下单工作台后，前端需要 productTypeCode 渲染 SpecStep
// （productSize / accessoryCode / engraving 表单按 productTypeCode 走 PRODUCT_TYPES 字典），
// 以及 price 显示模板定价。model/prompt 仍不在公开响应中（管理员专属）。
// 2026-09-10：扩 allowedSizes / allowedAccessories 让 SpecModal 按子集渲染（不暴露字典全量）
// 2026-09-10：扩 promptTemplateId / productLineIds 让前端按 promptTemplate 优先 + 按产品线分组；
// 返 productLines 数组（含 sortOrder + maskCount）让前端 Segmented 直接渲染分组筛选。
export async function GET() {
  const effects = await getEffects();
  const activeEffects = effects.filter((m) => m.status === "active");
  // 2026-09-10：取上架产品线（active）；按 sortOrder 升序；
  // maskCount = 该 productLineId 命中的 active mask 数
  const lines = await getActiveLinesFromDb();
  const productLines = lines.map((l) => ({
    productLineId: l.productLineId,
    name: l.name,
    coverUrl: l.coverUrl ?? "",
    sortOrder: l.sortOrder,
    maskCount: activeEffects.filter((m) =>
      (m.productLineIds ?? []).includes(l.productLineId)
    ).length,
  }));

  return NextResponse.json({
    success: true,
    masks: activeEffects.map((m) => ({
      maskId: m.maskId,
      name: m.name,
      previewUrl: m.previewUrl,
      // 2026-09-09：扩给 /image-gen 6 步 stepper 用
      productTypeCode:
        (m as { productTypeCode?: string | null }).productTypeCode ?? null,
      price: m.price ?? 0,
      description: m.description ?? "",
      // 推荐模型仅返回 id，前端按 id 展示名字；不暴露完整 prompt/cost
      model: m.model,
      // 2026-09-10：模板级可配置规格子集；空 = 字典全量
      allowedSizes: (m as { allowedSizes?: string[] }).allowedSizes ?? null,
      allowedAccessories:
        (m as { allowedAccessories?: string[] }).allowedAccessories ?? null,
      // 2026-09-10：模板级 capability 覆盖 + 皮革色子集（仅创建时 SpecModal 用）
      allowedCapabilities:
        (m as { allowedCapabilities?: Partial<ProductCapabilities> | null })
          .allowedCapabilities ?? null,
      allowedColors: (m as { allowedColors?: string[] }).allowedColors ?? null,
      // 2026-09-10：prompt_template.id 引用（POST 时优先用 promptTemplate.prompt）；
      // 前端无需关心，只用于诊断 / 显示
      promptTemplateId:
        (m as { promptTemplateId?: string | null }).promptTemplateId ?? null,
      // 2026-09-10：关联产品线 id 列表（用于 /image-gen 左侧产品线 Segmented 分组）
      productLineIds: (m as { productLineIds?: string[] }).productLineIds ?? [],
    })),
    productLines,
  });
}
