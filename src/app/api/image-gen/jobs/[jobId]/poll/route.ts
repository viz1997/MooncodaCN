/**
 * image-gen 工作台 + 外部 mp 通用 —— 推进并返回 imageJob 状态
 *
 * POST /api/image-gen/jobs/[jobId]/poll
 *
 * 2026-10-13 v2.1: 加双鉴权 (BA session OR x-api-key),让 mp 跟工作台共用
 * 同一份轮询端点。原本只接 BA session;新流程里 mp 拿到的 taskId 就是
 * imageJob.id(就是 path 里的 jobId),UUID v4 128-bit 熵不可枚举 = 凭证。
 *
 * 鉴权规则(2026-10-13 v2.1):
 *   1) 优先 BA session:session.user.id === job.userId(原行为,零回归)
 *   2) 无 session 退到 x-api-key:requireExternalApiKey 通过后
 *      - job.userId IS NULL → 接受(匿名任务,任一合法 key 可读)
 *      - job.userId IS NOT NULL → 404(不告诉外部 key 此 job 存在)
 *   3) 都没:401
 *
 * 与 gpt-image /api/orders/[token]/poll 同语义:token / uuid 不可枚举即
 * 凭证,挂在 session 下不是必需。
 *
 * 与 /p/[token] /api/orders/[token]/poll 形态对称,方便后人对照。
 * Vercel 函数预算:HTTP 路由 maxDuration 显式可控。
 *
 * maxDuration: 60s
 *   推进本身只是 1 次上游 GET(≤8s)+ 1 次 DB 写(≤1s),30s 已够。
 *   设 60s 是为了和 /api/orders/[token]/poll 保持同一个安全冗余。
 */

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { imageJob } from "@/db/schema";
import { advanceImageGenJob } from "@/features/image-gen/lib/generation-service";
import { toPublicJobView } from "@/features/image-gen/lib/poll-public-view";
import { getClientIp, logImageGen } from "@/features/image-gen";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";
import { requireExternalApiKey } from "@/lib/require-external-api-key";

export const runtime = "nodejs";
export const maxDuration = 60;

async function postHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json(
      { success: false, error: "jobId 必填" },
      { status: 400 }
    );
  }

  // 限流:与 image-gen/submit 共享 ai 桶(防止恶意拿 key 狂轮询)
  const ip = getClientIp(_req.headers);
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // ----------------------------------------------------------------------
  // 双鉴权 —— 先读 job(两路都要),再按 session / x-api-key 分支判断
  // ----------------------------------------------------------------------
  const found = await db.query.imageJob.findFirst({
    where: eq(imageJob.id, jobId),
    columns: { id: true, userId: true },
  });
  if (!found) {
    // 404 兜底:jobId 真的不存在。两条路都走这条(不区分内外)。
    return NextResponse.json(
      { success: false, error: "任务不存在" },
      { status: 404 }
    );
  }

  // 路径 1: BA session —— 工作台登录用户(原行为,零回归)
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  // 2026-10-14:标记走的是哪条鉴权路径,决定 response shape —— owner 拿全行,
  // external 拿 toPublicJobView 投影(避免泄露上游 fingerprint + 内部字段)。
  let authMode: "owner" | "external" = "external";
  if (session?.user) {
    if (found.userId !== session.user.id) {
      // 不告诉前端"存在但无权",统一 404 防枚举(原逻辑保留)
      return NextResponse.json(
        { success: false, error: "任务不存在" },
        { status: 404 }
      );
    }
    authMode = "owner";
    // session owner 校验通过,落到下面统一推进逻辑
  } else {
    // 路径 2: x-api-key —— mp / 外部集成方
    const { verify, errorResponse } = await requireExternalApiKey(
      _req,
      ip,
      rl
    );
    if (errorResponse) return errorResponse;
    // requireExternalApiKey 在 dev 关校验(isExternalApiKeyRequired=false)时
    // 返 verify=null。本端点是 production 必校验,verify=null 视为无 key → 401
    if (!verify?.ok) {
      return NextResponse.json(
        { success: false, error: "需要登录或 API Key" },
        { status: 401, headers: getRateLimitHeaders(rl) }
      );
    }
    // key 合法:仅在 job 是匿名(userId IS NULL)时放行
    if (found.userId !== null) {
      // 不告诉外部 key 此 job 存在(避免泄露 mp 之外的工作台 jobId)
      // 也不告诉其归谁所有 —— 统一 404
      logImageGen({
        event: "query",
        outcome: "failed",
        source: "public",
        model: "unknown",
        errorCode: "POLL_FORBIDDEN",
        errorMessage: `外部 API key ${verify.name} 尝试轮询有主 jobId=${jobId}`,
        ip,
      });
      return NextResponse.json(
        { success: false, error: "任务不存在" },
        { status: 404, headers: getRateLimitHeaders(rl) }
      );
    }
    // authMode 保持默认 "external"
  }

  try {
    // 推进(幂等:无 taskId / 终态时不动)
    const job = await advanceImageGenJob(jobId);
    // 2026-10-14:owner 路径返全行(零回归);external 路径用投影避免泄露
    // 上游 fingerprint(例 apimart request_id)+ 内部 model/prompt/cost。
    const jobView = authMode === "owner" ? job : toPublicJobView(job);

    return NextResponse.json(
      {
        success: true,
        data: {
          job: jobView,
        },
      },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[image-gen /poll] 推进失败", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "推进失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
