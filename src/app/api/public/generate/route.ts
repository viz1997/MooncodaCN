// 外部用户生图 API - 服务端预配置，用户无需登录
// ⚠️ 安全：响应只返回图片 URL + 友好提示，不暴露内部 model/提示词/成本等

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptTemplate } from "@/db/schema";
import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";
import {
  findEffect,
  getClientIp,
  getEffects,
  IMAGE_MODELS,
  logImageGen,
} from "@/features/image-gen";
import { getActiveLinesFromDb } from "@/features/image-gen/lib/db-lines";
import {
  createImageJob,
} from "@/features/image-gen/lib/generation-service";
import { triggerImageGenSubmit } from "@/features/image-gen/lib/submit";
import type {
  GenerateImageRequest,
  ImageModelId,
} from "@/features/image-gen/lib/image-models/types";
import { auth } from "@/lib/auth";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";
import {
  isExternalApiKeyRequired,
  recordExternalApiKeyCall,
  verifyExternalApiKey,
  type VerifyRejectReason,
} from "@/features/image-gen/lib/external-api-key-service";

/**
 * 从请求头提取 raw API key。
 * 优先级：x-api-key > Authorization: Bearer <key>
 * trim 后空串视作未传。
 */
function extractApiKeyFromHeaders(req: NextRequest): string | null {
  const xApiKey = req.headers.get("x-api-key");
  if (xApiKey) {
    const trimmed = xApiKey.trim();
    if (trimmed) return trimmed;
  }
  const auth = req.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (match?.[1]) {
      const trimmed = match[1].trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/** verify reject reason → HTTP status code */
const API_KEY_REJECT_STATUS: Record<VerifyRejectReason, number> = {
  missing: 401,
  malformed: 401,
  not_found: 401,
  disabled: 403,
  quota_exceeded: 429,
};

/** verify 完整 ok 结果的 type alias（service 返 union，这里抽出来便于多处复用） */
type KeyVerifyResult = Awaited<ReturnType<typeof verifyExternalApiKey>>;

/**
 * 统一 API Key 校验：POST / GET 共用
 *
 * 行为：
 * - EXTERNAL_API_KEY_REQUIRED=false（dev）→ verify = null，跳过校验
 * - 校验失败 → 返 errorResponse（带 status + rate limit headers + 埋点）
 * - 校验成功 → 返 verify（带 keyId / allowedMasks 等，调用方按需使用）
 *
 * 把 rate limit headers 透传进去：拒绝响应也带 X-RateLimit-*，让客户端能感知配额。
 */
async function requireExternalApiKey(
  req: NextRequest,
  ip: string | undefined,
  rl: Awaited<ReturnType<typeof checkRateLimit>>
): Promise<{ verify: KeyVerifyResult | null; errorResponse?: NextResponse }> {
  if (!isExternalApiKeyRequired()) {
    return { verify: null };
  }
  const rawKey = extractApiKeyFromHeaders(req);
  const verify = await verifyExternalApiKey(rawKey);
  if (!verify.ok) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "unknown",
      errorCode: `API_KEY_${verify.reason.toUpperCase()}`,
      errorMessage: verify.message,
      ip,
    });
    return {
      verify: null,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: verify.message,
          code: `API_KEY_${verify.reason.toUpperCase()}`,
        },
        {
          status: API_KEY_REJECT_STATUS[verify.reason],
          headers: getRateLimitHeaders(rl),
        }
      ),
    };
  }
  return { verify };
}

export const runtime = "nodejs";
// 2026-10-13：异步改造后 HTTP 路径不再等 apimart,createImageJob + Inngest
// send 是 <1s。Vercel 函数预算 10s 已绰绰有余,还给 Vercel 函数冷启动预算
// 留余量(同请求链还有 BA verifyOTP / DB 写入)。
export const maxDuration = 10;

// 外部用户可用全部模型（服务端控制，前端不感知具体模型）
// 2026-09-11：精简为 3 个核心模型（qwen / gpt_image_2 / nano_banana2）。
// 2026-10-12：接入 apimart_gpt_image 后扩为 4 个。apimart 是本公共 API 的默认模型。
// 2026-10-XX：apimart 拆为 flare（apimart_gpt_image，默认）与
// sunburst（apimart_gpt_image_sunburst）并列条目，扩为 5 个。
// 旧即梦 / DALL-E / SD / Flux / Midjourney / 通义万相 / 文心一格 / CogView / Nano Banana Pro 全部下线。
const PUBLIC_ALLOWED_MODELS: ImageModelId[] = [
  "apimart_gpt_image",
  "apimart_gpt_image_sunburst",
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

  // 2026-10-12：外部 API Key 校验（小程序 / 第三方集成等走本路由必须带 key）
  // 默认强制；本地 dev 可在 .env.local 设 EXTERNAL_API_KEY_REQUIRED=0 关闭。
  // 即使是已登录 demo 用户也校验（admin 给合作伙伴发 key 时绑白名单/限额，
  // 走公共路由的请求统一记账）。
  const { verify: externalKeyVerify, errorResponse: keyError } =
    await requireExternalApiKey(req, ip, rl);
  if (keyError) return keyError;

  // 2026-09-14：已登录用户把 demo 流生图结果入库到 photo 表（source=generation）。
  // 公共 API 仍允许匿名（保持向后兼容）；/image-gen 页面层强制登录，所以
  // 走本路由的请求里如果有 session 就直接是「已登录 demo 用户」。无 session
  // 仍走老路径——不写库，不算失败。
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
    // 2026-10-12：默认模型切到 apimart_gpt_image，理由：
    //   - 多模式（text_to_image / image_to_image / image_editing），
    //     小程序 + /image-gen demo 流用户不发参考图也能直出，比 gpt_image_2 友好
    //   - 1K/2K/4K 三档 + 10 种比例 + auto，匹配小程序用户对分辨率与构图的多样需求
    //   - 异步任务模式 + R2 持久化路径稳定（与 gpt_image_2 adapter 同形态）
    // qwen / gpt_image_2 / nano_banana2 仍在 PUBLIC_ALLOWED_MODELS 中可被模板显式指定。
    let selectedModel: ImageModelId = "apimart_gpt_image";
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
      // 2026-09-14：prompt 来源单一 → 必绑的 promptTemplate.prompt
      // productEffect.prompt 本地字段已删除（schema + form UI 同步收口），
      // 不再走 mask.prompt 兜底。template 不存在/无 prompt 是 500，告知 admin 修复。
      // promptTemplateId 在 admin form 已必填（2026-09-12 起），findEffect 出来的 mask
      // 一定有值；type 上是 string | null 仅因为 ProductEffect.promptTemplateId 可选。
      if (!mask.promptTemplateId) {
        return NextResponse.json(
          {
            success: false,
            error: "效果模板未绑定提示词模板，请联系管理员",
            code: "MASK_TEMPLATE_NOT_BOUND",
          },
          { status: 500 }
        );
      }
      const tmpl = await db.query.promptTemplate.findFirst({
        where: eq(promptTemplate.id, mask.promptTemplateId),
      });
      // 2026-09-XX：模板 prompt 仍是主体；用户 body.prompt（非空时）追加到末尾
      // 让「选模板风格 + 加自己的修改意图」场景走通。模板无 prompt 且用户
      // 也没填 → 报错；用户填了但模板没 prompt → 用用户 prompt 兜底（这种
      // 组合是 admin 配置问题但降级不阻断）。
      const userPrompt = body.prompt?.trim() ?? "";
      if (tmpl?.prompt) {
        prompt = userPrompt ? `${tmpl.prompt}\n\n${userPrompt}` : tmpl.prompt;
      } else if (userPrompt) {
        prompt = userPrompt;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: "提示词模板缺失或无内容，请联系管理员",
            code: "PROMPT_TEMPLATE_MISSING",
          },
          { status: 500 }
        );
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
      // 2026-10-12：外部 API Key 白名单约束
      // allowedMasks 为空数组 = 不绑白名单（合作伙伴可以调用任何 active 模板）
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
            error: `当前 API Key 无权访问该效果（${body.maskId}）`,
            code: "MASK_NOT_ALLOWED",
          },
          { status: 403 }
        );
      }
      // 替换占位符：用户传入值 > defaultValue
      mask.variables.forEach((v) => {
        const val = body.params?.[v.key] || v.defaultValue;
        prompt = prompt.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), val);
      });
      maskName = mask.name;
      // 优先使用产品效果指定的生图模型（降级到 apimart_gpt_image）
      // 2026-09-11：精简后旧 mask.model === "doubao" 也会被 isPublicAllowed 过滤掉，
      // 自动落到默认模型。2026-10-12：默认从 qwen 切到 apimart_gpt_image，
      // 模板配置无效 / 模型下线都走 apimart（多模式 + 高质量兜底）。
      const preferredModel =
        (mask.model as ImageModelId) || "apimart_gpt_image";
      selectedModel = PUBLIC_ALLOWED_MODELS.includes(preferredModel)
        ? preferredModel
        : "apimart_gpt_image";
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
      watermark: false,
      ...(body.maskId !== undefined && { maskId: body.maskId }),
    };

    // 2026-10-13：异步改造 —— createImageJob + triggerImageGenSubmit + 立即返。
    //
    // 改前：await dispatchGenerateImage（匿名）/ createImageJob + dispatchImageGenerationJob
    //       （登录）—— 同步等 apimart 30-90s,BFF 函数挂死 + mp 30s timeout。
    // 改后：写 imageJob (pending) + Inngest send,立刻 <1s 返 taskId。
    //       apimart 在 Inngest cloud 后台跑,失败由 reconcileStaleJobs cron 兜底。
    //
    // 关键点：
    //   - internalReq 同时作为 GenerateImageRequest(adapter 用)和
    //     InternalGenerateInput(createImageJob / dispatchImageGenerationJob 用)
    //   - createImageJob 现在接 userId: string | null（schema 已 nullable）
    //   - triggerImageGenSubmit 有 sync fallback(Inngest 不可用时降级,
    //     dev 友好);返回 mode 仅用于诊断,业务行为不依赖
    //   - recordExternalApiKeyCall 改在 submit 成功时记一次(原逻辑是
    //     result.success 时记,异步后我们立刻返 pending 不再 result.success,
    //     改为"被接受 = 计 1 次配额",语义更符合"提交配额"直觉)

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

    // 埋点：submit 阶段
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

    // 立即返:imageJob.id 作为 taskId 返给 mp,mongo 后续调 /api/image/task/[id]
    // 轮询,端点已经支持 imageJob.id 查询
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
export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // 2026-10-12：GET 也加 IP 限流，避免拿到合法 key 的人狂拉列表
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // 2026-10-12：GET 与 POST 共用同一套 API Key 校验
  // 校验成功 + key 配了 allowedMasks 非空 → 下方只返白名单内的 mask；
  // allowedMasks=[]（不限）或 dev 关校验 → 返全部 active 模板。
  const { verify: externalKeyVerify, errorResponse: keyError } =
    await requireExternalApiKey(req, ip, rl);
  if (keyError) return keyError;

  const effects = await getEffects();
  const allActiveEffects = effects.filter((m) => m.status === "active");
  // 白名单过滤：空数组视为不限制；dev 模式（verify=null）也不限制
  const whitelist =
    externalKeyVerify?.ok && externalKeyVerify.allowedMasks.length > 0
      ? new Set(externalKeyVerify.allowedMasks)
      : null;
  const activeEffects = whitelist
    ? allActiveEffects.filter((m) => whitelist.has(m.maskId))
    : allActiveEffects;

  // 2026-09-10：取上架产品线（active）；按 sortOrder 升序；
  // maskCount = 该 productLineId 命中**当前可见**的 active mask 数（按 key 白名单过滤后）
  const lines = await getActiveLinesFromDb();
  const productLines = lines
    .map((l) => ({
      productLineId: l.productLineId,
      name: l.name,
      coverUrl: l.coverUrl ?? "",
      sortOrder: l.sortOrder,
      maskCount: activeEffects.filter((m) =>
        (m.productLineIds ?? []).includes(l.productLineId)
      ).length,
    }))
    // 白名单过滤后某 productLine 已无可见 mask → 整条隐藏，前端不显示空组
    .filter((l) => l.maskCount > 0);

  // 2026-09-11：按 promptTemplateId 一次性取 candidateCount/outputMode（避免 N+1）。
  // mask 没绑 template → 走兜底（candidateCount=1，outputMode=grid）
  const templateIds = Array.from(
    new Set(
      activeEffects
        .map((m) => m.promptTemplateId ?? null)
        .filter((id): id is string => Boolean(id))
    )
  );
  const templates =
    templateIds.length > 0
      ? await db.query.promptTemplate.findMany({
          where: (t, { inArray }) => inArray(t.id, templateIds),
          columns: { id: true, candidateCount: true, outputMode: true },
        })
      : [];
  const templateMap = new Map(templates.map((t) => [t.id, t] as const));

  return NextResponse.json(
    {
      success: true,
      // 2026-10-12：把当前 key 的可见范围告诉客户端，避免 UI 错把白名单外的
      // mask 拼到 POST body（虽然后端会再校验一次 403 MASK_NOT_ALLOWED）。
      keyScope: externalKeyVerify?.ok
        ? {
            keyName: externalKeyVerify.name,
            allowedMasks: externalKeyVerify.allowedMasks,
          }
        : null,
      masks: activeEffects.map((m) => {
        // 2026-09-11：从 promptTemplate 表取 candidateCount/outputMode，
        // demo 流按此决定要不要渲染 QuadrantGridPicker
        const tmpl = m.promptTemplateId
          ? templateMap.get(m.promptTemplateId)
          : null;
        const candidateCount = tmpl?.candidateCount ?? 1;
        const outputMode = (tmpl?.outputMode ?? "grid") as "grid" | "separate";
        return {
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
        allowedColors:
          (m as { allowedColors?: string[] }).allowedColors ?? null,
        // 2026-09-10：prompt_template.id 引用（POST 时优先用 promptTemplate.prompt）；
        // 前端无需关心，只用于诊断 / 显示
        promptTemplateId:
          (m as { promptTemplateId?: string | null }).promptTemplateId ?? null,
        // 2026-09-10：关联产品线 id 列表（用于 /image-gen 左侧产品线 Segmented 分组）
        productLineIds:
          (m as { productLineIds?: string[] }).productLineIds ?? [],
        // 2026-09-11：模板宫格候选数 + 输出模式（让 demo 流按此决定 picker）
        candidateCount,
        outputMode,
      };
    }),
    productLines,
  },
  { headers: getRateLimitHeaders(rl) }
  );
}
