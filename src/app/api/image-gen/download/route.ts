/**
 * 服务端下载代理（修 "Failed to fetch"）。
 *
 * GET /api/image-gen/download?url=...&filename=...
 *
 * 工作台 V1 的 downloadImage() 直接 fetch(R2 URL) 会被浏览器以 CORS 拒绝
 * （R2 公共域默认未配 CORS）。这里服务端 fetch 没有跨域限制，把二进制流
 * 回给浏览器，靠 Content-Disposition: attachment 触发下载弹框。
 *
 * 安全：
 * - url 必须过 `isAllowedImageUrl` 白名单（仅 R2 + 已知 provider）
 * - 拒绝 data: / blob: / http:// —— 这些应走原 fetch + blob 路径
 * - 仅 GET，无 body
 * - 复用 upload 限流桶（30/min）—— 下载与上传同量级
 *
 * 注意：data: URL 不应进这个端点；客户端 downloadProxyUrl() 已短路过滤。
 */

import { type NextRequest, NextResponse } from "next/server";

import {
  inferImageContentType,
  isAllowedImageUrl,
} from "@/features/image-gen/lib/url-guard";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

async function getHandler(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");
  const filenameParam =
    req.nextUrl.searchParams.get("filename") ?? "download.bin";

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

  // 限流：复用 upload 桶（30/min）
  const ip = getClientIp(req);
  const rate = await checkRateLimit(ip, "upload");
  if (!rate.success) return createRateLimitResponse(rate);

  let upstream: Response;
  try {
    upstream = await fetch(urlParam, {
      signal: AbortSignal.timeout(20_000),
      // 不自动跟随重定向到非 https（防御性）
      redirect: "follow",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `下载源失败：${err instanceof Error ? err.message : "unknown"}`,
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

  // filename 做 RFC 5987 编码（兼容中文 / 空格 / 引号）
  const safeFilename = filenameParam.replace(/[\r\n"]/g, "_");
  const encodedFilename = encodeURIComponent(safeFilename);
  const contentType =
    upstream.headers.get("Content-Type") ?? inferImageContentType(urlParam);

  const headers: HeadersInit = {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
    // 二进制流，加 no-store 防中间代理缓存错乱（每个 URL 唯一）
    "Cache-Control": "no-store",
    ...getRateLimitHeaders(rate),
  };

  // 直接 stream 上游 body，避免把整张图读进内存
  return new Response(upstream.body, { headers });
}

export const GET = withApiLogging(getHandler);
