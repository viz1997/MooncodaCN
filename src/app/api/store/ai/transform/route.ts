/**
 * POST /api/store/ai/transform —— AI 风格转换(委托 lingting/wellapi)
 *
 * 对齐 atelier `/api/ai/transform`。
 * 输入:base64 data URL + aiStyleId
 * 输出:R2 永久 URL
 *
 * 此 Route 跟 commerce 后端无关:继续委托 lingting/wellapi 就行 ——
 * 图像处理是本仓库自己的事,Sellbase 只做收银台。
 *
 * 实现:
 *  0. 缺会话 → 401(2026-11-02:生图必须登录)
 *  1. base64 data URL → buffer → persistBase64ToR2(原图)
 *  2. aiStyleId === "ai_original" → 直接返回原图 URL(短路)
 *  3. 否则调 submitLingtingTask → 返回 transform 后 R2 URL
 *
 * 参考:
 *  - src/features/gpt-image/lib/generation-service.ts submitLingtingTask
 *  - src/features/image-gen/lib/r2.ts persistBase64ToR2
 *  - [[canvas-image-must-use-wellapi]]
 */

import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  persistBase64ToR2,
  submitLingtingTask,
} from "@/features/gpt-image/lib/generation-service";
import { isR2Configured } from "@/features/image-gen/lib/r2";
import { findAiStyle } from "@/features/storefront/lib/mock-catalog";
import { withApiLogging } from "@/lib/api-logger";
import { getServerSession } from "@/lib/auth/server";

export const runtime = "nodejs";
/** AI transform 单次最长 90s(对齐 lingting 8s × retry + cold start) */
export const maxDuration = 90;

const aiTransformInputSchema = z.object({
  /** base64 data URL:`data:image/png;base64,iVBOR...` */
  imageDataUrl: z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,/),
  aiStyleId: z.string().min(1),
  productTypeCode: z.enum(["R", "A", "P", "RM", "LB", "M"]),
});

async function handle(request: Request) {
  // 2026-11-02:生图要登录。transform 是一次真实的上游 AI 调用(真花钱),
  // 匿名访客不许白嫖。**放在所有业务校验之前** —— 未登录的人连「你的 R2 配没配」
  // 都不该知道。客户端有前置拦截(use-require-sign-in),这里是权威闸门。
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
        message: "请先登录后再生成图片",
      },
      { status: 401 }
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      {
        error: "R2_NOT_CONFIGURED",
        message: "R2 未配置,无法持久化 AI transform 输出",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = aiTransformInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "imageDataUrl 必须 data URL + aiStyleId + productTypeCode",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const { imageDataUrl, aiStyleId } = parsed.data;
  const aiStyle = findAiStyle(aiStyleId);
  if (!aiStyle) {
    return NextResponse.json(
      { error: "UNKNOWN_AI_STYLE", message: `AI 风格 ${aiStyleId} 不存在` },
      { status: 400 }
    );
  }

  const start = Date.now();

  // 1. base64 → R2(原图持久化)
  const match = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!match || !match[1] || !match[2]) {
    return NextResponse.json(
      { error: "INVALID_DATA_URL", message: "imageDataUrl 格式错误" },
      { status: 400 }
    );
  }
  const contentType = match[1];
  const b64 = match[2];

  const orderId = `store_${randomBytes(8).toString("hex")}`;
  const originalImageUrl = await persistBase64ToR2(
    b64,
    contentType,
    orderId,
    0
  );

  // 2. ai_original 短路:不调 AI,直接返回原图
  if (aiStyleId === "ai_original") {
    return NextResponse.json({
      previewImageUrl: originalImageUrl,
      originalImageUrl,
      aiStyleId,
      estimatedLatencyMs: Date.now() - start,
    });
  }

  // 3. 调 lingting/wellapi
  try {
    const result = await submitLingtingTask(
      orderId,
      [originalImageUrl],
      aiStyle.prompt,
      aiStyle.outputSize,
      1, // imageIdx
      1 // n=1(transform 不是 batch 生图)
    );

    if (result.kind === "url") {
      const previewUrl = result.urls[0];
      if (!previewUrl) {
        return NextResponse.json(
          { error: "NO_URL_RETURNED", message: "lingting 返回了空 url" },
          { status: 502 }
        );
      }
      return NextResponse.json({
        previewImageUrl: previewUrl,
        originalImageUrl,
        aiStyleId,
        estimatedLatencyMs: Date.now() - start,
      });
    }

    // async task → 让客户端轮询(本简化版不实现轮询,直接返回 502)
    // 真实场景应该返回 taskId 让前端轮询
    return NextResponse.json(
      {
        error: "ASYNC_TASK_NOT_SUPPORTED",
        message: "lingting 返回了 async task,本 mock 不支持轮询",
        taskId: result.taskId,
      },
      { status: 502 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "LINGTING_FAILED",
        message: error instanceof Error ? error.message : "lingting 调用失败",
      },
      { status: 502 }
    );
  }
}

export const POST = withApiLogging(handle);
