/**
 * /api/canvas/poll/[jobId] —— 画布内置渠道轮询（GET）
 *
 * 两种 job 来源（Phase 4）：
 *  1. canvasRemoteJob 表 —— image / audio，Phase 4 起走 Inngest 异步
 *     `/api/canvas/generate` 返 { jobId } 后写表（status=pending），
 *     Inngest 函数 `canvasRemoteGenerateJob` 后台跑生成，成功写回
 *     status=completed + result=items，失败 status=failed + error。
 *
 *  2. VIDEO_JOBS Map —— video，沿用 Phase 3 的 in-memory Map。
 *     canvasRemoteJob 表预留 capability=video 但暂未迁过来；
 *     poll 路由查 canvasRemoteJob 查不到就 fallback 到 VIDEO_JOBS。
 *
 * 返回体统一：
 *   { success: true, status: "pending" | "completed" | "failed", items?, message?, creditsConsumed? }
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { canvasRemoteJob } from "@/db/schema";
import { pollVideoOnServer } from "@/features/canvas/services/canvas-server-generate";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
// poll 只查 DB / 简单状态判断，10s 足够
export const maxDuration = 10;

type PollResponse =
  | { status: "pending" }
  | {
      status: "completed";
      items: Array<{ url: string; mimeType?: string }>;
      creditsConsumed: number;
    }
  | { status: "failed"; message: string; creditsConsumed: number };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401 }
    );
  }
  const userId = session.user.id;

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json(
      { success: false, error: "缺少 jobId" },
      { status: 400 }
    );
  }

  try {
    const result = await pollCanvasRemoteJob({ jobId, userId });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * 先查 canvasRemoteJob（image / audio），查不到 fallback 到 VIDEO_JOBS（video）。
 *
 * 顺序很重要：canvasRemoteJob 用 nanoid()/randomBytes 16字符 hex 作为 id，
 * VIDEO_JOBS 用 randomBytes(8) 16字符 hex；可能存在 hash 冲突概率极低，
 * 但当前者查不到时不要直接返 404，要给 video 留 fallback 路径。
 */
async function pollCanvasRemoteJob(input: {
  jobId: string;
  userId: string;
}): Promise<PollResponse> {
  const job = await db.query.canvasRemoteJob.findFirst({
    where: and(
      eq(canvasRemoteJob.id, input.jobId),
      eq(canvasRemoteJob.userId, input.userId)
    ),
  });
  if (job) {
    if (job.status === "completed") {
      return {
        status: "completed",
        items: (job.result ?? []).map((item) => ({
          url: item.url,
          ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        })),
        creditsConsumed: job.creditsConsumed ?? 0,
      };
    }
    if (job.status === "failed") {
      return {
        status: "failed",
        message: job.error ?? "生成失败（积分已自动回退）",
        creditsConsumed: 0,
      };
    }
    // pending / processing 都返 pending 给前端（前端不区分）
    return { status: "pending" };
  }

  // fallback：VIDEO_JOBS Map（video 路径）
  const videoResult = await pollVideoOnServer(input);
  return videoResult;
}
