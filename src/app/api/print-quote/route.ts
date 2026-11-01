/**
 * POST /api/print-quote —— 按几何算报价
 *
 * 报价页在用户改尺寸时实时调这个接口拿价格。**不写库** —— 报价是临时的,
 * 只有真的下单才会落一条 `print_order`。
 *
 * 限流走 `polling` 桶(60/min):语义上是「客户端反复拉同一个资源的最新
 * 状态」—— 用户拖一下尺寸滑块就换一个几何,报价得跟着变。
 *
 * 不用 `ai` 桶(20/min):这个接口只做算术,不调任何付费上游,开销跟 AI
 * 推理没法比;而且客户端有 400ms 防抖 + 定时器重置,连续拖动期间根本不会
 * 发请求,真正发出的请求数远低于「拖动频率」。
 *
 * 2026-11-01:要登录。整个打印服务改成「登录后下单」,报价接口同步收口 ——
 * 页面本身已经拦了未登录的人,接口不留后门。
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrintOrderUser } from "@/features/print-quote/lib/auth";
import { computePrintQuote } from "@/features/print-quote/lib/quote-server";
import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 纯计算 + 一次 DB-less 逻辑,10s 绰绰有余 */
export const maxDuration = 10;

const quoteInputSchema = z.object({
  /** 体积 cm³ */
  volumeCM3: z.number().positive().max(1_000_000),
  /** 表面积 cm² */
  surfaceAreaCM2: z.number().min(0).max(1_000_000),
  /** 成品尺寸 mm:X=长 Y=宽 Z=高 */
  dims: z
    .tuple([
      z.number().min(0).max(100_000),
      z.number().min(0).max(100_000),
      z.number().min(0).max(100_000),
    ])
    .refine(([x, y, z]) => x > 0 || y > 0 || z > 0, {
      message: "尺寸不能全为 0",
    }),
  /** 智能摆盘算出的支撑克重 g */
  supportWeightG: z.number().min(0).max(1_000_000).nullish(),
  /** 本体支撑比例(1 = 1:1) */
  selfSupportRatio: z.number().min(0).max(1_000_000).nullish(),
});

async function handle(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "polling");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // 打印服务要登录 —— 未登录直接拒
  const user = await getPrintOrderUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
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

  const parsed = quoteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "报价参数不合法",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const input: PrintQuoteInput = {
    volumeCM3: parsed.data.volumeCM3,
    surfaceAreaCM2: parsed.data.surfaceAreaCM2,
    dims: parsed.data.dims,
    supportWeightG: parsed.data.supportWeightG ?? null,
    selfSupportRatio: parsed.data.selfSupportRatio ?? null,
  };

  const quote = computePrintQuote(input);
  if (!quote) {
    return NextResponse.json(
      { error: "QUOTE_UNAVAILABLE", message: "这组几何算不出报价" },
      { status: 422 }
    );
  }

  return NextResponse.json({ quote }, { headers: getRateLimitHeaders(rl) });
}

export const POST = withApiLogging(handle);
