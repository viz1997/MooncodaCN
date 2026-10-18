/**
 * GET /api/image-gen/templates
 *
 * 2026-10-13 v2.1:从 /api/public/prompt-templates 迁过来。
 * 原路径已 410 Gone(指向本路径)。迁移动机见 scripts/verify-image-gen-routes.sh。
 *
 * 鉴权:与 /api/public/prompt-templates 一致,默认强制外部 API Key
 * (x-api-key > Authorization: Bearer <key>),dev 模式 EXTERNAL_API_KEY_REQUIRED=0 关。
 *
 * 2026-10-14:已登录 BA session 也可访问(/image-gen 页面强制登录后 fetch
 * 本路由),由 requireExternalApiKey helper 统一处理 —— 命中 session 即
 * verify=null 跳过,本路由的 allowedMasks 白名单也自然不生效(demo 用户
 * 看全量 active 模板)。
 *
 * 与 /api/image-gen/submit (POST) 的关系:
 *   templates → 拿 maskId 下拉 + productLine 分组 + 每条模板的 styles
 *   submit    → 拿到的 maskId + 选中的 aiStyleId 提交生图
 *
 * 白名单:allowedMasks 非空时只返白名单内的模板,productLines 仅含过滤后仍有
 * 可见 mask 的 productLineId。
 *
 * 响应 shape 对齐小程序 SDK 的 PromptTemplatesResponse 契约
 *   ({ productLines, templates } 顶层 + 字段重命名 maskId→id, previewUrl→cover,
 *    price→costCredits, status 用 active/inactive)。原 /api/public/generate GET
 *   返 masks + productLines 是为 /image-gen 内部工作台,命名不一致。
 *
 * 2026-10-16 v1.5.0:每条模板携带自有 `styles: TemplateStyle[]`
 * (来自 promptTemplate.styles JSON 列)。SDK 据此渲染"风格 chip"。
 * 没有 styles 的老模板(空数组)→ mp 不渲染 chip,等同于 v1.4.0 行为。
 */

import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { getClientIp, getEffects, logImageGen } from "@/features/image-gen";
import { getActiveLinesFromDb } from "@/features/image-gen/lib/db-lines";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";
import { requireExternalApiKey } from "@/lib/require-external-api-key";

export const runtime = "nodejs";
// 30s:纯 DB 读,无上游;上限对齐 image/task poll
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // 限流:与 /api/image-gen/submit POST 一致,用 ai 限流配置(20/min)
  // 小程序启动时拉一次,正常不会撞;防止有人拿到 key 狂拉
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // API Key 鉴权:复用 submit 同款 helper
  const { verify: externalKeyVerify, errorResponse: keyError } =
    await requireExternalApiKey(req, ip, rl);
  if (keyError) return keyError;

  try {
    const effects = await getEffects();
    const allActiveEffects = effects.filter((m) => m.status === "active");

    // 白名单过滤:空数组 = 不限制;dev 模式(verify=null)也不限制
    const whitelist =
      externalKeyVerify?.ok && externalKeyVerify.allowedMasks.length > 0
        ? new Set(externalKeyVerify.allowedMasks)
        : null;
    const activeEffects = whitelist
      ? allActiveEffects.filter((m) => whitelist.has(m.maskId))
      : allActiveEffects;

    // 取上架产品线(active),按 sortOrder 升序;
    // maskCount = 该 productLineId 命中**当前可见**的 active mask 数(白名单过滤后)
    const lines = await getActiveLinesFromDb();
    const productLines = lines
      .map((l) => ({
        id: l.productLineId,
        name: l.name,
        // handle 与 id 同值;保留字段为未来稳定 slug 留位(不改协议可演进)
        handle: l.productLineId,
        cover: l.coverUrl ?? "",
        description: l.description ?? "",
        sortOrder: l.sortOrder,
        maskCount: activeEffects.filter((m) =>
          (m.productLineIds ?? []).includes(l.productLineId)
        ).length,
      }))
      // 白名单过滤后某 productLine 已无可见 mask → 整条隐藏,前端不显示空组
      .filter((l) => l.maskCount > 0);

    // 一次性取所有关联 promptTemplate(outputMode + candidateCount + styles),
    // 避免 N+1。mask 没绑 template → 走兜底(candidateCount=1, outputMode=grid,
    // styles=[])
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
            columns: {
              id: true,
              candidateCount: true,
              outputMode: true,
              // 2026-10-16 v1.5.0:模板自带 styles(JSON 列),提交生图时
              // aiStyleId 必须命中 mask 对应模板 styles 之一。这里一次
              // 性拉出来,避免 N+1。
              styles: true,
            },
          })
        : [];
    const templateMap = new Map(templates.map((t) => [t.id, t] as const));

    const templatesOut = activeEffects.map((m) => {
      const tmpl = m.promptTemplateId
        ? templateMap.get(m.promptTemplateId)
        : null;
      const candidateCount = tmpl?.candidateCount ?? 1;
      const outputMode = (tmpl?.outputMode ?? "grid") as "grid" | "separate";
      return {
        id: m.maskId,
        name: m.name,
        productTypeCode: m.productTypeCode ?? null,
        productLineIds: m.productLineIds ?? [],
        outputMode,
        candidateCount,
        // ProductEffect.allowedSizes 是 string[] cm,SDK 也按 string[] 对齐
        allowedSizes: m.allowedSizes ?? [],
        allowedAccessories: m.allowedAccessories ?? [],
        cover: m.previewUrl,
        // price 列单位 cents —— 与 SDK 「金额为 cents(整数)」约定一致
        costCredits: m.price ?? 0,
        // ProductEffect.status 仅 active/inactive;SDK 类型扩到 archived 但当前
        // 数据源没有 archived 状态,需要时再扩 productEffect.status enum
        status: m.status as "active" | "inactive",
        // 2026-10-16 v1.5.0:模板自有样式数组,可能为空(老模板/未配)。
        // 数组里每个 TemplateStyle 有 id / name / nameEn / prompt /
        // surchargeCents / outputSize / swatch / estimatedLatencySec。
        // mp SDK 端拿这里做 chip 渲染,submit 时把 aiStyleId 透传过来
        // 做 {{style}} 占位符替换。
        styles: tmpl?.styles ?? [],
      };
    });

    return NextResponse.json(
      {
        success: true,
        keyScope: externalKeyVerify?.ok
          ? {
              keyName: externalKeyVerify.name,
              allowedMasks: externalKeyVerify.allowedMasks,
            }
          : null,
        productLines,
        templates: templatesOut,
      },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (error) {
    console.error("[Image Gen Templates Error]", error);
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
      { success: false, error: "加载模板失败，请稍后重试" },
      { status: 500, headers: getRateLimitHeaders(rl) }
    );
  }
}
