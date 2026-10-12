// 登录用户生图 API
// 与公共 API 不同：需要 session，支持更多参数，扣积分，写入 imageJob

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  generateImageJob,
  getClientIp,
  logImageGen,
} from "@/features/image-gen";
import { internalGenerateSchema } from "@/features/image-gen/lib/validation";
import { auth } from "@/lib/auth";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

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
  const ip = getClientIp(req.headers);

  const rl = await checkRateLimit(userId, "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体非法" },
      { status: 400 }
    );
  }

  const parseResult = internalGenerateSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数校验失败",
        details: parseResult.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await generateImageJob({
    userId,
    input: parseResult.data,
    ip,
  });

  if (!result.success) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "internal",
      model: parseResult.data.model,
      errorCode: "GENERATION_FAILED",
      errorMessage: result.error,
      ip,
    });

    return NextResponse.json(
      { success: false, error: result.error },
      { status: 500, headers: getRateLimitHeaders(rl) }
    );
  }

  return NextResponse.json(
    {
      success: true,
      jobId: result.jobId,
      taskId: result.taskId,
      status: result.status,
      images: result.images,
      creditsConsumed: result.creditsConsumed,
    },
    { headers: getRateLimitHeaders(rl) }
  );
}
