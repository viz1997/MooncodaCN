// 外部用户生图提交 API —— 异步 submit 模式
// 2026-10-13 v2.1:从 /api/public/generate POST 迁过来,handler 不动。
// 原 /api/public/generate 已 410 Gone(指向本路径)。
// 鉴权 / 限流 / 配额自增 / 响应 shape 全部与原路径完全一致。
//
// ⚠️ 安全:响应只返回图片 URL + 友好提示,不暴露内部 model/提示词/成本等

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptTemplate } from "@/db/schema";
import {
  findEffect,
  getClientIp,
  IMAGE_MODELS,
  logImageGen,
} from "@/features/image-gen";
import { createImageJob } from "@/features/image-gen/lib/generation-service";
import { resolveSelectedModel } from "@/features/image-gen/lib/submit-model-resolver";
import type { ResolveSelectedModelResult } from "@/features/image-gen/lib/submit-model-resolver";
import { triggerImageGenSubmit } from "@/features/image-gen/lib/submit";
import type {
  GenerateImageRequest,
  ImageModelId,
} from "@/features/image-gen/lib/image-models/types";
import { recordExternalApiKeyCall } from "@/features/image-gen/lib/external-api-key-service";
import { auth } from "@/lib/auth";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";
import { requireExternalApiKey } from "@/lib/require-external-api-key";

export const runtime = "nodejs";
// 2026-10-13:异步改造后 HTTP 路径不再等 apimart,createImageJob + Inngest
// send 是 <1s。Vercel 函数预算 10s 已绰绰有余,还给 Vercel 函数冷启动预算
// 留余量(同请求链还有 BA verifyOTP / DB 写入)。
export const maxDuration = 10;

// 外部用户可用全部模型(服务端控制,前端不感知具体模型)
// 2026-09-11:精简为 3 个核心模型(qwen / gpt_image_2 / nano_banana2)。
// 2026-10-12:接入 apimart_gpt_image 后扩为 4 个。apimart 是本公共 API 的默认模型。
// 2026-10-XX:apimart 拆为 flare(apimart_gpt_image,默认)与
// sunburst(apimart_gpt_image_sunburst)并列条目,扩为 5 个。
// 旧即梦 / DALL-E / SD / Flux / Midjourney / 通义万相 / 文心一格 / CogView / Nano Banana Pro 全部下线。
const PUBLIC_ALLOWED_MODELS: ImageModelId[] = [
  "apimart_gpt_image",
  "apimart_gpt_image_sunburst",
  "qwen",
  "gpt_image_2",
  "nano_banana2",
];

interface PublicGenerateRequest {
  // 无需 apiKey,服务端预配置
  imageUrl?: string; // 支持图片URL或base64 data URI(兼容旧 client,单张)
  /**
   * 2026-09-10:多张参考图数组(与工作台对齐,max 10)。
   * 客户端优先传 imageUrls[];服务端同时认 imageUrls 和 imageUrl 单数(向后兼容)。
   * mode 判断:imageUrls.length > 0 OR imageUrl 非空 都走 image_to_image。
   */
  imageUrls?: string[];
  maskId?: string;
  prompt?: string;
  size?: string;
  params?: Record<string, string>; // 用户填入的变量取值,优先于 defaultValue
  /**
   * 用户显式指定的模型(选填)。
   * 2026-10-14:优先级高于 mask.model —— mask.model 只是「模板推荐默认」,
   * 用户在 body 里显式传 model 表示「我知道我在做什么,绕过 mask 推荐」,
   * 服务端仅做 PUBLIC_ALLOWED_MODELS 白名单校验。
   *
   * - apimart_gpt_image           → apimart 上游 gpt-image-2.5-flare(速度/成本优先)
   * - apimart_gpt_image_sunburst  → apimart 上游 gpt-image-2.5-sunburst(质量优先,贵一档)
   * - qwen / gpt_image_2 / nano_banana2 仍可指定(白名单内)
   *
   * 不传:服务端按 mask.model → apimart_gpt_image 兜底。
   */
  model?: ImageModelId;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // IP 限流:公共生图较昂贵,用 strict 限流(3/分钟)
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // 2026-10-12:外部 API Key 校验(小程序 / 第三方集成等走本路由必须带 key)
  // 默认强制;本地 dev 可在 .env.local 设 EXTERNAL_API_KEY_REQUIRED=0 关闭。
  //
  // 2026-10-14:已登录 demo 流放行由 requireExternalApiKey helper 统一处理
  // —— BA session 命中则 verify=null 跳过,x-api-key 通道留给合作伙伴 / 小程序。
  // 这里拿到 verify=null 走原 dev 跳过同形态:不查 allowedMasks 白名单、不计
  // 外部 key 月配额,只把 userId 写到 imageJob 走 demo 流用户归属。
  // 合作伙伴路径(匿名 / mp 集成)无 BA session,会进 helper 的 x-api-key
  // 通道,白名单与配额自增在下方逻辑里照常生效。
  const { verify: externalKeyVerify, errorResponse: keyError } =
    await requireExternalApiKey(req, ip, rl);
  if (keyError) return keyError;

  // 2026-09-14:已登录用户把 demo 流生图结果入库到 photo 表(source=generation)。
  // 公共 API 仍允许匿名(保持向后兼容);/image-gen 页面层强制登录,所以
  // 走本路由的请求里如果有 session 就直接是「已登录 demo 用户」。无 session
  // 仍走老路径——不写库,不算失败。
  // 2026-10-13:userId 改 nullable(imageJob schema 已适配匿名)
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) userId = session.user.id;
  } catch {
    // session 取失败也不阻塞主流程
  }

  try {
    const body: PublicGenerateRequest = await req.json();

    // 解析 prompt
    let prompt = body.prompt ?? "";
    // 2026-10-12:默认模型切到 apimart_gpt_image,理由:
    //   - 多模式(text_to_image / image_to_image / image_editing),
    //     小程序 + /image-gen demo 流用户不发参考图也能直出,比 gpt_image_2 友好
    //   - 1K/2K/4K 三档 + 10 种比例 + auto,匹配小程序用户对分辨率与构图的多样需求
    //   - 异步任务模式 + R2 持久化路径稳定(与 gpt_image_2 adapter 同形态)
    // qwen / gpt_image_2 / nano_banana2 仍在 PUBLIC_ALLOWED_MODELS 中可被模板显式指定。
    let selectedModel: ImageModelId = "apimart_gpt_image";
    let maskName = "自定义";
    // 2026-10-14:resolveResult 提到 if 块外,统一 403 判断时需要区分
    // 「用户显式传了非法 model」vs「系统兜底后还不在白名单」。
    let resolveResult: ResolveSelectedModelResult | null = null;

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
      // 2026-09-14:prompt 来源单一 → 必绑的 promptTemplate.prompt
      // productEffect.prompt 本地字段已删除(schema + form UI 同步收口),
      // 不再走 mask.prompt 兜底。template 不存在/无 prompt 是 500,告知 admin 修复。
      // promptTemplateId 在 admin form 已必填(2026-09-12 起),findEffect 出来的 mask
      // 一定有值;type 上是 string | null 仅因为 ProductEffect.promptTemplateId 可选。
      if (!mask.promptTemplateId) {
        return NextResponse.json(
          {
            success: false,
            error: "效果模板未绑定提示词模板,请联系管理员",
            code: "MASK_TEMPLATE_NOT_BOUND",
          },
          { status: 500 }
        );
      }
      const tmpl = await db.query.promptTemplate.findFirst({
        where: eq(promptTemplate.id, mask.promptTemplateId),
      });
      // 2026-09-XX:模板 prompt 仍是主体;用户 body.prompt(非空时)追加到末尾
      // 让「选模板风格 + 加自己的修改意图」场景走通。模板无 prompt 且用户
      // 也没填 → 报错;用户填了但模板没 prompt → 用用户 prompt 兜底(这种
      // 组合是 admin 配置问题但降级不阻断)。
      const userPrompt = body.prompt?.trim() ?? "";
      if (tmpl?.prompt) {
        prompt = userPrompt ? `${tmpl.prompt}\n\n${userPrompt}` : tmpl.prompt;
      } else if (userPrompt) {
        prompt = userPrompt;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: "提示词模板缺失或无内容,请联系管理员",
            code: "PROMPT_TEMPLATE_MISSING",
          },
          { status: 500 }
        );
      }
      // 必填变量校验:required 且无 params 值且无 defaultValue → 拒绝
      const missing = mask.variables.find(
        (v) => v.required && !(body.params?.[v.key] ?? v.defaultValue)
      );
      if (missing) {
        return NextResponse.json(
          { success: false, error: "缺少必填参数", code: "MISSING_PARAM" },
          { status: 400 }
        );
      }
      // 2026-10-12:外部 API Key 白名单约束
      // allowedMasks 为空数组 = 不绑白名单(合作伙伴可以调用任何 active 模板)
      // 非空 = 只能调白名单内的 maskId
      if (
        externalKeyVerify?.ok &&
        externalKeyVerify.allowedMasks.length > 0 &&
        !externalKeyVerify.allowedMasks.includes(body.maskId)
      ) {
        logImageGen({
          event: "submit",
          outcome: "failed",
          source: "public",
          model: selectedModel,
          maskId: body.maskId,
          errorCode: "MASK_NOT_ALLOWED",
          errorMessage: `API key ${externalKeyVerify.name} 无权访问 ${body.maskId}`,
          ip,
        });
        return NextResponse.json(
          {
            success: false,
            error: `当前 API Key 无权访问该效果(${body.maskId})`,
            code: "MASK_NOT_ALLOWED",
          },
          { status: 403 }
        );
      }
      // 替换占位符:用户传入值 > defaultValue
      mask.variables.forEach((v) => {
        const val = body.params?.[v.key] || v.defaultValue;
        prompt = prompt.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), val);
      });
      maskName = mask.name;
      // 2026-10-14:model 优先级 —— body.model(用户显式) > mask.model(模板推荐) > 默认
      //
      // 旧逻辑(mask.model 硬约束)的问题:mask 是「模板作者认为该场景最适合的模型」,
      // 只是一个推荐默认,不是硬约束。leather badge 写死 gpt_image_2 是 admin 当下
      // 决定,用户显式传 apimart_gpt_image_sunburst 应当能被尊重(不要反向被 mask
      // 推荐覆盖)。详见 src/features/image-gen/lib/submit-model-resolver.ts。
      //
      // 语义:
      //   - 用户在 body 传了 model → 用用户传的;不在白名单则 selectedModel = undefined,
      //     交给下方统一 403 MODEL_NOT_ALLOWED
      //   - 用户没传 → mask.model(过白名单) → apimart_gpt_image 兜底
      const resolveResultLocal = resolveSelectedModel({
        bodyModel: body.model,
        maskModel: mask.model,
        allowedModels: PUBLIC_ALLOWED_MODELS,
        fallback: "apimart_gpt_image",
      });
      resolveResult = resolveResultLocal;
      selectedModel = resolveResultLocal.selectedModel ?? "apimart_gpt_image";
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
        { success: false, error: "模型不可用", code: "MODEL_NOT_ALLOWED" },
        { status: 403 }
      );
    }
    // 2026-10-14:用户显式传了不在白名单的 model → 403(不掩盖用户意图,
    // 否则前端看到「我传了 X 怎么出来的是 Y」会困惑)。mask 推荐路径兜底
    // 到 fallback 后必在白名单,不会触发这里。
    if (resolveResult?.fromUserOverride && !resolveResult.selectedModel) {
      logImageGen({
        event: "submit",
        outcome: "failed",
        source: "public",
        model: body.model ?? "unknown",
        maskId: body.maskId,
        errorCode: "MODEL_NOT_ALLOWED",
        errorMessage: `用户显式指定的模型 ${body.model} 不在公共白名单`,
        ip,
      });
      return NextResponse.json(
        {
          success: false,
          error: "模型不可用",
          code: "MODEL_NOT_ALLOWED",
        },
        { status: 403 }
      );
    }

    const modelConfig = IMAGE_MODELS[selectedModel];
    if (modelConfig.status === "maintenance") {
      return NextResponse.json(
        {
          success: false,
          error: "服务维护中,请稍后再试",
          code: "MODEL_MAINTENANCE",
        },
        { status: 503 }
      );
    }

    // 2026-09-10:合并 imageUrls[]  + imageUrl 单数,统一收敛成 imageUrls[] 透传
    // 给 dispatchGenerateImage(与 generation-service.buildGenerateRequest 语义一致)。
    const refImageUrls: string[] = [
      ...(Array.isArray(body.imageUrls) ? body.imageUrls : []),
      ...(body.imageUrl ? [body.imageUrl] : []),
    ];
    const hasRef = refImageUrls.length > 0;

    const internalReq: GenerateImageRequest = {
      model: selectedModel,
      mode: hasRef ? "image_to_image" : "text_to_image",
      prompt,
      // adapter 内部只看 imageUrls(看 adapters.ts validateImageRequest 系列校验)
      ...(hasRef && { imageUrls: refImageUrls }),
      size: (body.size as GenerateImageRequest["size"]) ?? "1024x1024",
      batchSize: 1,
      enableSafetyCheck: true,
      watermark: false,
      ...(body.maskId !== undefined && { maskId: body.maskId }),
    };

    // 2026-10-13:异步改造 —— createImageJob + triggerImageGenSubmit + 立即返。
    //
    // 改前:await dispatchGenerateImage(匿名)/ createImageJob + dispatchImageGenerationJob
    //       (登录)—— 同步等 apimart 30-90s,BFF 函数挂死 + mp 30s timeout。
    // 改后:写 imageJob (pending) + Inngest send,立刻 <1s 返 taskId。
    //       apimart 在 Inngest cloud 后台跑,失败由 reconcileStaleJobs cron 兜底。
    //
    // 关键点:
    //   - internalReq 同时作为 GenerateImageRequest(adapter 用)和
    //     InternalGenerateInput(createImageJob / dispatchImageGenerationJob 用)
    //   - createImageJob 现在接 userId: string | null(schema 已 nullable)
    //   - triggerImageGenSubmit 有 sync fallback(Inngest 不可用时降级,
    //     dev 友好);返回 mode 仅用于诊断,业务行为不依赖
    //   - recordExternalApiKeyCall 改在 submit 成功时记一次(原逻辑是
    //     result.success 时记,异步后我们立刻返 pending 不再 result.success,
    //     改为"被 accept = 计 1 次配额",语义更符合"提交配额"直觉)

    const createResult = await createImageJob({
      userId, // string | null
      input: internalReq as Parameters<typeof createImageJob>[0]["input"],
      creditsConsumed: 0,
    });
    if (!createResult.success) {
      throw new Error(createResult.error ?? "创建生图任务失败");
    }

    const { mode: submitMode } = await triggerImageGenSubmit(
      createResult.jobId,
      internalReq as Parameters<typeof triggerImageGenSubmit>[1]
    );

    // 埋点:submit 阶段
    logImageGen({
      event: "submit",
      outcome: "pending",
      source: "public",
      model: selectedModel,
      mode: internalReq.mode,
      hasRefImage: !!body.imageUrl,
      maskId: body.maskId,
      size: internalReq.size,
      batchSize: 1,
      // 异步路径无 images / taskId(taskId 在 Inngest dispatch 时由 apimart adapter
      // 写入 imageJob.taskId 列);埋点仅记 submit 维度
      submitMode,
      ip,
    });

    // 外部 API Key 配额自增(被 accept 即记 1 次)
    if (externalKeyVerify?.ok) {
      try {
        await recordExternalApiKeyCall(externalKeyVerify.keyId);
      } catch (e) {
        console.error("[External API Key] record call failed", e);
      }
    }

    // 立即返:imageJob.id 作为 taskId 返给 mp,mongo 后续调
    // /api/image-gen/jobs/[jobId]/poll 轮询(已支持 imageJob.id 查询)
    return NextResponse.json(
      {
        success: true,
        taskId: createResult.jobId,
        jobId: createResult.jobId, // 双返兼容旧 mp 调用方
        taskStatus: "pending" as const,
        maskName,
      },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (error) {
    console.error("[Image Gen Submit Error]", error);
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
