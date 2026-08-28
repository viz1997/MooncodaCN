/**
 * 服务端图片代理（修 "Failed to fetch" + 提供 immutable CDN 缓存）。
 *
 * GET /api/image-gen/thumbnail?url=...
 *
 * 工作台 timeline rail / 网格 cell / LogPanel 等 thumbnail-sized <img>
  走这条代理：
 *   - 服务端 fetch 没有 CORS 限制,R2 公网域默认没配 Access-Control-Allow-Origin,
 *     浏览器直接 fetch 会被拒
 *   - immutable 1 年缓存 —— URL 来自唯一生成结果,内容固定
 *
 * 历史版本曾用 sharp 做服务端缩放(目标宽度 96/228/400 等),但 Vercel serverless
 * 部署 sharp 的 libvips-cpp.so.8.18.3 native binary 经常装不上(2026-08-28:
 * ERR_DLOPEN_FAILED),所有缩略图代理 → 全站破图。去掉 sharp 后改为 stream
 * 透传上游原图,让浏览器用 object-fit / sizes / srcset 自己 scale。
 * 代价:Vercel 函数出口流量从 ~200KB WebP 涨到 1MB+ 原图;收益是不再依赖
 * 任何 native binary,部署彻底摆脱 libvips 平台绑定。
 *
 * 安全:复用 isAllowedImageUrl 白名单(同 download 路由)。
 * 限流:复用 polling 桶(60/min)—— UI 一次可能加载几十张图,
 *      polling 桶专为此设计。
 */

import { type NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

import {
  isHydrateCandidate,
  migrateResultUrlToR2,
} from "@/features/image-gen/lib/result-url-hydrate";
import {
  inferImageContentType,
  isAllowedImageUrl,
} from "@/features/image-gen/lib/url-guard";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
// 2026-08-28：R2 从 Vercel 函数拉链路上限 ~16s（curl 实测），加上 stream
// 转发开销，30s 死线撞 Vercel 杀掉。升到 60s 给 R2 慢响应留余地。
export const maxDuration = 60;

async function getHandler(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");

  if (!urlParam) {
    return NextResponse.json(
      { success: false, error: "缺少 url 参数" },
      { status: 400 }
    );
  }
  if (!isAllowedImageUrl(urlParam)) {
    return NextResponse.json(
      { success: false, error: "url 不在白名单内（仅 R2 / 已知 provider）" },
      { status: 403 }
    );
  }

  // 限流：复用 polling 桶（60/min）
  const ip = getClientIp(req);
  const rate = await checkRateLimit(ip, "polling");
  if (!rate.success) return createRateLimitResponse(rate);

  let upstream: Response;
  try {
    upstream = await fetch(urlParam, {
      // R2 dev 子域从 Vercel 函数拉 cold fetch 实测 16s+，20s 太紧
      signal: AbortSignal.timeout(25_000),
      redirect: "follow",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `抓取源失败：${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      {
        success: false,
        error: `上游返回 ${upstream.status}`,
        status: upstream.status,
      },
      { status: 502 }
    );
  }

  // 首屏 hydrate：URL 命中已知会过期的硬编码 provider 域（wellapi.*）时，
  // 后台 fire-and-forget 把 wellapi URL → R2 永久 URL 并 UPDATE image_job。
  // next/server 的 after() 是 stable API，handler 已经返回上游原图，hydrate
  // 在响应送出后跑，不阻塞用户。失败仅 log，**不影响**已经返回的图片。
  if (isHydrateCandidate(urlParam)) {
    after(async () => {
      try {
        await migrateResultUrlToR2(urlParam);
      } catch (err) {
        logger.warn(
          {
            url: urlParam,
            err: err instanceof Error ? err.message : String(err),
          },
          "image-gen: 后台 hydrate 历史 URL 失败",
        );
      }
    });
  }

  // 2026-08-28：去 sharp，stream 透传上游 body 给浏览器。
  // 上游已 read body 检查 ok，但 stream 不需要再读 —— 直接 pipe 上游
  // ReadableStream 到 Response。Content-Type 优先透传上游，缺失则按 URL 后缀推断。
  const contentType =
    upstream.headers.get("Content-Type") ?? inferImageContentType(urlParam);

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      // immutable 1 年 —— URL 来自唯一生成结果，内容固定可永久缓存
      "Cache-Control": "public, max-age=31536000, immutable",
      ...getRateLimitHeaders(rate),
    },
  });
}

export const GET = withApiLogging(getHandler);