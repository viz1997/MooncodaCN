/**
 * /api/canvas/generate —— 画布内置渠道后端代理（POST）
 *
 * Phase 4 主入口（image / audio 异步化）：
 *  1. better-auth 校验 session
 *  2. 校验 body（capability / mode / model / prompt / references 等）
 *  3. 写 canvasRemoteJob 行（status=pending）→ inngest.send → 立即返 { jobId }
 *  4. Inngest 函数 `canvasRemoteGenerateJob` 后台跑生成 → R2 永久化 → 写回结果
 *  5. 前端 GET /api/canvas/poll/{jobId} 轮询状态
 *
 * 视频继续走两段式：本路由返 jobId，前端再轮询 /api/canvas/poll/[jobId]
 */

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { canvasRemoteJob } from "@/db/schema";
import {
  type CanvasRemoteGenerateInput,
  type CanvasRemoteReference,
  createVideoOnServer,
  generateOnServerSync,
} from "@/features/canvas/services/canvas-server-generate";
import { inngest } from "@/inngest/client";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
// 异步路径（Inngest send 成功）只需要 < 1s，30s 足够
// 同步 fallback（Inngest send 失败时）需要跑 generateOnServerSync：
//   - audio TTS 通常 < 5s
//   - image generation 5-30s
//   - image edit (gpt-image-2) 30-90s
// 提至 90 覆盖 gpt-image-2 同步 fallback。Vercel Hobby 上限 60s，
// 真要同步兜底 gpt-image-2 只能上 Pro / 配 Inngest dev server。
export const maxDuration = 90;

const MAX_REFERENCES = 10;

export async function POST(req: NextRequest) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401 }
    );
  }
  const userId = session.user.id;

  // 简易 rate limit（按 userId 走 global 类型；具体窗口/上限由 rate-limit config 控制）
  const rateLimit = await checkRateLimit(`canvas-generate:${userId}`);
  if (!rateLimit.success) {
    return createRateLimitResponse(rateLimit);
  }

  let parsed: CanvasRemoteGenerateInput;
  try {
    parsed = (await req.json()) as CanvasRemoteGenerateInput;
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  if (
    !parsed.capability ||
    !["image", "video", "audio", "text"].includes(parsed.capability)
  ) {
    return NextResponse.json(
      { success: false, error: `不支持的 capability：${parsed.capability}` },
      { status: 400 }
    );
  }

  if (!parsed.model || !parsed.prompt) {
    return NextResponse.json(
      { success: false, error: "缺少必填字段 model 或 prompt" },
      { status: 400 }
    );
  }

  if (parsed.references && parsed.references.length > MAX_REFERENCES) {
    return NextResponse.json(
      { success: false, error: `references 最多 ${MAX_REFERENCES} 张` },
      { status: 400 }
    );
  }

  // 防御性裁剪 references，只保留前端需要的字段
  const references: CanvasRemoteReference[] | undefined =
    parsed.references?.map((ref) => ({
      url: ref.url,
      ...(ref.mimeType ? { mimeType: ref.mimeType } : {}),
      ...(ref.name ? { name: ref.name } : {}),
    }));

  try {
    // video 走 createVideoOnServer 异步路径（VIDEO_JOBS Map），
    // 返 jobId 给前端去轮询 /api/canvas/poll —— 与 Phase 3 一致
    if (parsed.capability === "video") {
      const result = await createVideoOnServer({
        userId,
        model: parsed.model,
        prompt: parsed.prompt,
        ...(parsed.videoSeconds
          ? { seconds: Number(parsed.videoSeconds) }
          : {}),
        ...(parsed.size ? { size: parsed.size } : {}),
      });
      const res = NextResponse.json({
        success: true,
        capability: "video",
        jobId: result.jobId,
        creditsConsumed: result.creditsConsumed,
        transactionId: result.transactionId,
      });
      Object.entries(getRateLimitHeaders(rateLimit)).forEach(([k, v]) => {
        res.headers.set(k, v);
      });
      return res;
    }

    // image / audio / text —— 异步路径 + Inngest 同步 fallback
    //
    // 1. 写 canvasRemoteJob 行（pending）
    // 2. try inngest.send("canvas/remote-generate") —— Inngest 函数后台跑
    //    generateOnServerSync，把 result 写回 canvasRemoteJob
    // 3. catch —— send 失败（401 / dev server 未起 / 网络）→ 同步跑
    //    generateOnServerSync 并写回，返 { jobId, status: "completed", items }
    //    与 src/features/image-gen/lib/submit.ts 的 triggerImageGenSubmit
    //    同形态：dev 不起 Inngest CLI / INNGEST_EVENT_KEY 401 都不影响业务
    // 4. 成功路径：返 { jobId, status: "pending", pollUrl } 让前端轮询
    const jobId = randomBytes(8).toString("hex");
    const now = new Date();
    const payload = {
      ...parsed,
      ...(references ? { references } : {}),
      userId,
    };

    await db.insert(canvasRemoteJob).values({
      id: jobId,
      userId,
      capability: parsed.capability,
      mode: parsed.mode,
      payload,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    let dispatchedViaInngest = false;
    try {
      await inngest.send({
        name: "canvas/remote-generate",
        data: { jobId, userId, payload },
      });
      dispatchedViaInngest = true;
    } catch (sendErr) {
      logger.warn(
        { err: sendErr, jobId, userId },
        "Inngest send 失败，降级到同步 generateOnServerSync（dev server 未起 / INNGEST_EVENT_KEY 未配或无效）"
      );
    }

    if (!dispatchedViaInngest) {
      // 同步 fallback —— 与 triggerImageGenSubmit 的 catch 分支同语义
      try {
        await db
          .update(canvasRemoteJob)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(canvasRemoteJob.id, jobId));

        const result = await generateOnServerSync({
          ...parsed,
          ...(references ? { references } : {}),
          userId,
        });

        await db
          .update(canvasRemoteJob)
          .set({
            status: "completed",
            result: result.items,
            creditsConsumed: result.creditsConsumed,
            transactionId: result.transactionId,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));

        const res = NextResponse.json({
          success: true,
          capability: parsed.capability,
          jobId,
          status: "completed",
          items: result.items,
          creditsConsumed: result.creditsConsumed,
          transactionId: result.transactionId,
          pollUrl: `/api/canvas/poll/${jobId}`,
        });
        Object.entries(getRateLimitHeaders(rateLimit)).forEach(([k, v]) => {
          res.headers.set(k, v);
        });
        return res;
      } catch (syncErr) {
        const message = syncErr instanceof Error ? syncErr.message : "未知错误";
        await db
          .update(canvasRemoteJob)
          .set({
            status: "failed",
            error: message.slice(0, 1000),
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));
        logger.error(
          { err: syncErr, jobId, userId, capability: parsed.capability },
          "canvas generate 同步 fallback 也失败（image/audio 不消耗积分；video 路径 service 内部已 refund）"
        );
        if (
          syncErr instanceof Error &&
          syncErr.name === "InsufficientCreditsError"
        ) {
          return NextResponse.json(
            { success: false, error: message, code: "insufficient_credits" },
            { status: 402 }
          );
        }
        if (syncErr instanceof Error && syncErr.name === "AccountFrozenError") {
          return NextResponse.json(
            { success: false, error: message, code: "account_frozen" },
            { status: 403 }
          );
        }
        return NextResponse.json(
          { success: false, error: message },
          { status: 500 }
        );
      }
    }

    const res = NextResponse.json({
      success: true,
      capability: parsed.capability,
      jobId,
      status: "pending",
      pollUrl: `/api/canvas/poll/${jobId}`,
    });
    Object.entries(getRateLimitHeaders(rateLimit)).forEach(([k, v]) => {
      res.headers.set(k, v);
    });
    res.headers.set("x-ratelimit-remaining", String(rateLimit.remaining));
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    logger.error(
      { err, userId, capability: parsed.capability },
      "canvas generate failed"
    );
    // 业务异常（积分不足 / 账号冻结）返 402；其他异常 500
    if (err instanceof Error && err.name === "InsufficientCreditsError") {
      return NextResponse.json(
        { success: false, error: message, code: "insufficient_credits" },
        { status: 402 }
      );
    }
    if (err instanceof Error && err.name === "AccountFrozenError") {
      return NextResponse.json(
        { success: false, error: message, code: "account_frozen" },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
