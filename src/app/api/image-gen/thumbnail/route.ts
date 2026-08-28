/**
 * 服务端缩略图代理（按需 sharp 缩放 + immutable 缓存）。
 *
 * GET /api/image-gen/thumbnail?url=...&w=96&q=70
 *
 * 工作台 timeline rail (48px) / 网格 cell (114px) / LogPanel (32px) 等
 * thumbnail-sized <img> 原本直接加载 1024+1024 原图，浪费带宽 + 渲染慢。
 * 这里服务端 fetch + sharp.resize → WebP 回流；URL 来自生成结果唯一
 * ID，永久缓存安全（immutable 1 年）。
 *
 * 安全：复用 isAllowedImageUrl 白名单（同 download 路由）。
 * 限流：复用 polling 桶（60/min）—— UI 一次可能加载几十张缩略图，
 *       polling 桶专为此设计。
 */

import { type NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import sharp from "sharp";

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
// 2026-08-28：R2 从 Vercel 函数拉链路上限 ~16s（curl 实测），加上
// sharp resize + 1MB+ buffer 读取，30s 死线撞 Vercel 杀掉 → 500。
// 升到 60s 给 sharp / 缓冲留余地（Vercel 所有 plan 都允许 60s）。
export const maxDuration = 60;

const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 16;
const MAX_WIDTH = 2048;
const DEFAULT_QUALITY = 70;

function parseInt32(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

async function getHandler(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");
  const width = Math.max(
    MIN_WIDTH,
    Math.min(
      MAX_WIDTH,
      parseInt32(req.nextUrl.searchParams.get("w"), DEFAULT_WIDTH)
    )
  );
  const quality = Math.max(
    1,
    Math.min(
      100,
      parseInt32(req.nextUrl.searchParams.get("q"), DEFAULT_QUALITY)
    )
  );

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
      // 2026-08-28：从 20s 提到 25s —— R2 dev 子域从 Vercel 函数拉 cold
      // fetch 实测 16s+（curl time_total=16.2s，1.37MB PNG），20s 太紧，
      // 后续 arrayBuffer 还没读完就被 abort，抛 AbortError 冒泡到 500。
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

  if (!upstream.ok) {
    return NextResponse.json(
      {
        success: false,
        error: `上游返回 ${upstream.status}`,
        status: upstream.status,
      },
      { status: 502 }
    );
  }

  // 2026-08-28：arrayBuffer() 没在 try/catch —— fetch 已经返回 200 但 body
  // 流被 AbortSignal 打断或上游断连时，arrayBuffer 抛 AbortError / network
  // error 冒泡到 withApiLogging → 500。包一层返 502。
  let inputBuffer: Buffer;
  try {
    inputBuffer = Buffer.from(await upstream.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `读取上游 body 失败：${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  // 首屏 hydrate：URL 命中已知会过期的硬编码 provider 域（wellapi.*）时，
  // 后台 fire-and-forget 把 wellapi URL → R2 永久 URL 并 UPDATE image_job。
  // next/server 的 after() 是 stable API（来自
  // node_modules/next/dist/server/after/index.d.ts），handler 已经返回 sharp
  // 缩略图，hydrate 在响应送出后跑，不阻塞用户。失败仅 log，**不影响**已经
  // 返回的缩略图 —— 这次慢，下一次任何人看就 R2 CDN。
  //
  // R2 上传委派给 gpt-image/lib/generation-service:persistCandidateToR2
  // （与 gpt_image_2 adapter 同源），本项目已有的方案；hydrate 模块只剩
  // "判定候选 + DB 反查 + UPDATE"。
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

  let output: Buffer;
  try {
    output = await sharp(inputBuffer)
      // 不放大小图：withoutEnlargement=true 让原图小于 width 时保持原尺寸
      .resize({ width, withoutEnlargement: true, fit: "inside" })
      .webp({ quality })
      .toBuffer();
  } catch (_err) {
    // sharp 解码失败（不是图片 / 损坏）：回退原图，让前端 <img onerror>
    // 自己处理。这里 stream 原 buffer + 原 Content-Type。
    const contentType =
      upstream.headers.get("Content-Type") ?? inferImageContentType(urlParam);
    return new Response(inputBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
        "X-Thumbnail-Fallback": "decode-failed",
        ...getRateLimitHeaders(rate),
      },
    });
  }

  return new Response(output as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/webp",
      // immutable 1 年 —— URL 来自唯一生成结果，不会复用同一 URL
      // 但内容不同。
      "Cache-Control": "public, max-age=31536000, immutable",
      ...getRateLimitHeaders(rate),
    },
  });
}

export const GET = withApiLogging(getHandler);
