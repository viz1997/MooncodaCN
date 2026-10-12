/**
 * image-gen 工作台 —— 推进并返回 imageJob 状态。
 *
 * POST /api/image-gen/jobs/[jobId]/poll
 *
 * 与 gpt-image /api/orders/[token]/poll 同语义：
 *   - 鉴权（必须登录且 jobId 属于该用户）
 *   - 调 advanceImageGenJob 把 processing 任务推一步（无 taskId / 终态时幂等）
 *   - 返回推进后的最新 imageJob 行
 *
 * 工作台（generate-workbench-view.tsx）的 startPolling 链每 N 秒调一次。
 * 改走 fetch 而非 Server Action 的好处：
 *   1. 与 /p/[token] /api/orders/[token]/poll 形态对称，方便后人对照
 *   2. 不走 next-safe-action 中间件，少一层序列化开销
 *   3. Vercel 函数预算：HTTP 路由 maxDuration 显式可控
 *
 * 旧 Server Action `pollImageJobAction` 保留 —— generateImageAction 不
 * 需要它，且下次切换 /fetch 时可以删。
 *
 * maxDuration: 60s
 *   推进本身只是 1 次上游 GET（≤8s）+ 1 次 DB 写（≤1s），30s 已够。
 *   设 60s 是为了和 /api/orders/[token]/poll 保持同一个安全冗余。
 */

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { imageJob } from "@/db/schema";
import { advanceImageGenJob } from "@/features/image-gen/lib/generation-service";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

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

  // 鉴权
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401 }
    );
  }

  // 权限校验：job 必须存在且属于当前用户
  const found = await db.query.imageJob.findFirst({
    where: eq(imageJob.id, jobId),
    columns: { id: true, userId: true },
  });
  if (!found) {
    return NextResponse.json(
      { success: false, error: "任务不存在" },
      { status: 404 }
    );
  }
  if (found.userId !== session.user.id) {
    // 不告诉前端"存在但无权"，统一 404 防枚举
    return NextResponse.json(
      { success: false, error: "任务不存在" },
      { status: 404 }
    );
  }

  try {
    // 推进（幂等：无 taskId / 终态时不动）
    const job = await advanceImageGenJob(jobId);

    return NextResponse.json({
      success: true,
      data: {
        job,
      },
    });
  } catch (err) {
    logger.error({ err, jobId }, "image-gen /poll 推进失败");
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
