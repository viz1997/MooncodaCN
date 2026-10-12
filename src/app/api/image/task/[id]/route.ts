// 查询异步生图任务状态（公共 + 内部共用）
// 任务 ID 不可猜测作为安全边界；model 从 taskId 解析，不要求客户端传 ?model=
import { type NextRequest, NextResponse } from "next/server";
import {
  dispatchQueryImageTask,
  getClientIp,
  logImageGen,
  parseTaskModel,
} from "@/features/image-gen";
import { updateImageJobFromTaskResult } from "@/features/image-gen/lib/generation-service";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

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

  // 从 taskId 解析 model，避免客户端传 ?model= 暴露内部模型
  const model = parseTaskModel(taskId);
  if (!model) {
    return NextResponse.json(
      { success: false, error: "任务不存在或已过期" },
      { status: 404 }
    );
  }

  // IP 限流（复用 ai 限流配置）
  const ip = getClientIp(req.headers);
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
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
