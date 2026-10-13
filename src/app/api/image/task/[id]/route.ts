// 查询异步生图任务状态（公共 + 内部共用）
// 任务 ID 不可猜测作为安全边界；model 优先从 taskId 解析，
// 不在客户端 ?model= 上暴露；不支持的 taskId 形态走 404
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { imageJob } from "@/db/schema";
import {
  dispatchQueryImageTask,
  getClientIp,
  type ImageModelId,
  logImageGen,
  parseTaskModel,
} from "@/features/image-gen";
import { updateImageJobFromTaskResult } from "@/features/image-gen/lib/generation-service";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

/** apimart 上游 taskId 形态（ULID-like）。parseTaskModel 只认 imgtask_<model>_...
 * 形态，要把 apimart 也接进来 —— 两条 apimart adapter (flare / sunburst)
 * 共享 queryApimartTask，轮询端点不依赖具体上游 model，挑一个即可。
 */
const APIMART_TASK_ID_RE = /^task_[A-Za-z0-9_-]+$/;

/**
 * 2026-10-13：imageJob.id 形态（crypto.randomUUID() v4）。/api/public/generate
 * 改异步后返的 taskId 就是 imageJob.id,mp 拿到 UUID 形态的 taskId 来轮询。
 * 这里只接 UUID v4 严格格式（带连字符的 8-4-4-4-12 十六进制），避免与
 * imgtask_xxx / task_xxx 形态冲突,也避免误把 32 字符的 apimart ULID 当 UUID 走错分支。
 */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId 必填" },
      { status: 400 }
    );
  }

  // IP 限流（复用 ai 限流配置）—— 提前到模型解析前,空 taskId / 不支持
  // 形态的请求不消耗模型路由的限流配额
  const ip = getClientIp(req.headers);
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // 分支 1:UUID 形态 (= imageJob.id) —— /api/public/generate 异步改造后
  // mp 拿到的 taskId 就是这个。直接读 imageJob 表,状态机由 Inngest 推进。
  if (UUID_V4_RE.test(taskId)) {
    return await handleImageJobIdPoll(taskId, rl);
  }

  // 分支 2:apimart 上游 ULID 形态 / imgtask_<model> 形态 —— 老路径
  // 优先从 taskId 解析 model。apimart 的 ULID 形态兜底指向 apimart_gpt_image。
  let model: ImageModelId | null = parseTaskModel(taskId);
  if (!model && APIMART_TASK_ID_RE.test(taskId)) {
    model = "apimart_gpt_image";
  }
  if (!model) {
    return NextResponse.json(
      { success: false, error: "任务不存在或已过期" },
      { status: 404 }
    );
  }

  try {
    const result = await dispatchQueryImageTask(model, taskId);

    // 同步内部任务状态到 imageJob 表（无匹配任务时自动跳过）
    await updateImageJobFromTaskResult(taskId, result);

    // 埋点：仅记录终态（completed / failed），processing 不记录以避免刷屏
    if (result.status === "completed" || result.status === "failed") {
      logImageGen({
        event: "query",
        source: "internal",
        model,
        outcome: result.success ? "success" : "failed",
        taskId,
        taskStatus: result.status,
        imageCount: result.images?.length,
        durationMs: result.duration,
        errorMessage: result.success ? undefined : result.error,
        ip,
      });
    }
    // 响应不回传 model，避免暴露内部模型
    return NextResponse.json(
      {
        success: result.success,
        status: result.status,
        images: result.images,
        taskId: result.taskId,
        error: result.error,
        duration: result.duration,
      },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (error) {
    console.error("[Image Task Query Error]", error);
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { success: false, error: `任务查询失败: ${msg}` },
      { status: 500 }
    );
  }
}

/**
 * UUID 形态 (= imageJob.id) 的轮询处理。
 *
 * 设计：
 * - 不调 apimart 查上游(由 Inngest 推进,这里只读 DB)
 * - pending / processing:直接返当前状态,mongo 继续轮询
 * - completed:返 candidates(已经在 imageJob.resultUrls 里)
 * - failed:返 errorMsg
 * - 找不到:返 404(mp "任务不存在或已过期" 提示)
 *
 * 为什么不主动调 apimart 推进:
 * 1) 已经在 Inngest 里跑着,重复 query 会浪费配额 / 撞限流
 * 2) mp 30s 一次轮询,Inngest 异步推进 + reconcileStaleJobs 兜底足够
 * 3) 本路由是只读语义,加写路径会让路由行为不一致
 */
async function handleImageJobIdPoll(
  jobId: string,
  rl: Awaited<ReturnType<typeof checkRateLimit>>
) {
  const job = await db.query.imageJob.findFirst({
    where: eq(imageJob.id, jobId),
    columns: {
      id: true,
      status: true,
      resultUrls: true,
      errorMsg: true,
      generateDuration: true,
    },
  });

  if (!job) {
    return NextResponse.json(
      { success: false, error: "任务不存在或已过期" },
      { status: 404 }
    );
  }

  // pending / processing:告诉 mp "还没好",不返 images
  if (job.status === "pending" || job.status === "processing") {
    return NextResponse.json(
      {
        success: true,
        status: job.status,
        taskId: job.id,
        images: [],
      },
      { headers: getRateLimitHeaders(rl) }
    );
  }

  // completed:返 candidates
  if (job.status === "completed") {
    return NextResponse.json(
      {
        success: true,
        status: "completed",
        taskId: job.id,
        images: (job.resultUrls ?? []).map((url) => ({ url })),
        duration: job.generateDuration ?? undefined,
      },
      { headers: getRateLimitHeaders(rl) }
    );
  }

  // failed:返 error
  return NextResponse.json(
    {
      success: false,
      status: "failed",
      taskId: job.id,
      error: job.errorMsg ?? "生成失败",
    },
    { headers: getRateLimitHeaders(rl) }
  );
}
