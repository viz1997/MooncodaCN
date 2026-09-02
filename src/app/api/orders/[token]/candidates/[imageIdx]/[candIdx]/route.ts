/**
 * 用户端 - 获取效果图（URL / 二进制流）
 * GET /api/orders/[token]/candidates/[imageIdx]/[candIdx]
 *
 * 2026-09-02：URL 路径段 [imageIdx] 内部实际 = batchIdx（candidates 数组
 * 外层下标 = 批次槽位，不再是单张原图下标）。保留 URL 段名以兼容现有
 * 前端 helper 与书签链接；调用方按 batchIdx 计算。
 *
 * 默认：302 重定向到效果图 URL（用于 <img src> 直接展示）
 *
 * 带 ?historyId=... 时：从指定历史快照的 candidates JSON 中读图。
 * 校验 historyId 属于该 token 的订单，避免越权读到别人的快照。
 *
 * 带 ?download=1 时：服务端 fetch 图二进制 → stream 回前端，
 * 触发 Content-Disposition: attachment 下载。
 * 修公共免登录页 (/p/[token]) 的下载失败：浏览器 fetch(R2 URL)
 * 会被 R2 公共域默认无 CORS 拒绝（与 [[workbench-image-proxy]]
 * 同一根因），服务端 fetch 没有跨域限制。
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder, promptOrderHistory } from "@/db/schema";
import {
  parseCandidates,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
// 2026-09-02：download 路径要 stream R2 二进制，cold fetch 16s+
export const maxDuration = 60;

/**
 * 解析候选图 URL（含旧 per-image 格式兜底）。
 *
 * 正常路径：`nested[imageIdx][candIdx]`，越界返 undefined。
 *
 * 旧 per-image candidates 兜底（2026-09-02 batch 索引重构前的数据）：
 * 当 `nested.length > batchCount` 时判定为旧格式——candidates 外层长度
 * 实际等于 uploadedImageCount（每张原图独立跑了 1 次生成）。这种订单
 * 即使迁移过，如果再有边界情况走错 URL（例如 imageIdx 越界）也不该硬
 * 返 404 —— 用户的图必须能看见。回退链：
 *   1. nested[imageIdx][0]      （同 imageIdx 的首张候选，老 UI 也是这张）
 *   2. nested[selectedIndex][0] （用户曾经选过的 imageIdx = selectedIndex
 *                                的代表图，老 code 把 selectedIndex 当 imageIdx 用）
 *   3. nested 任意一组的 [0]    （最后的兜底，只要 DB 有 URL 就给一张）
 *
 * 注意：这只在 nested.length > batchCount 触发，正常新格式数据走默认路径。
 */
function resolveCandidateUrl(
  nested: string[][],
  imageIdx: number,
  candIdx: number,
  fallbackCtx: {
    uploadedImages: string | null;
    imagesPerUpload: number;
    selectedIndex: number | null;
  }
): string | undefined {
  const group = nested[imageIdx];
  const exact = Array.isArray(group) ? group[candIdx] : undefined;
  if (typeof exact === "string" && exact) return exact;

  // 兜底仅在「旧格式 candidates 外层过长」时启用
  const uploadedCount = parseUploadedImages(fallbackCtx.uploadedImages).length;
  const imagesPerUpload = Math.max(1, fallbackCtx.imagesPerUpload);
  const batchCount = Math.ceil(uploadedCount / imagesPerUpload);
  if (nested.length <= batchCount) return undefined;

  // 1) 同 imageIdx 首张候选（per-image 模式下每张只有 1 张图）
  if (Array.isArray(group) && typeof group[0] === "string" && group[0]) {
    return group[0];
  }
  // 2) 用户选过的 imageIdx = selectedIndex（老 code 写 selectedIndex 时是 imageIdx 维度）
  const si = fallbackCtx.selectedIndex;
  if (
    typeof si === "number" &&
    Array.isArray(nested[si]) &&
    typeof nested[si][0] === "string" &&
    nested[si][0]
  ) {
    return nested[si][0];
  }
  // 3) 任意一组的首张
  for (const g of nested) {
    if (Array.isArray(g) && typeof g[0] === "string" && g[0]) return g[0];
  }
  return undefined;
}

async function getHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; imageIdx: string; candIdx: string }> }
) {
  try {
    const { token, imageIdx: imgStr, candIdx: candStr } = await ctx.params;
    const imageIdx = Number.parseInt(imgStr, 10);
    const candIdx = Number.parseInt(candStr, 10);
    if (
      !Number.isInteger(imageIdx) ||
      !Number.isInteger(candIdx) ||
      imageIdx < 0 ||
      candIdx < 0
    ) {
      return NextResponse.json(
        { success: false, error: "参数无效" },
        { status: 400 }
      );
    }
    const historyId = req.nextUrl.searchParams.get("historyId");

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: {
        id: true,
        candidates: true,
        uploadedImages: true,
        imagesPerUpload: true,
        selectedIndex: true,
      },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    // 历史快照路径：historyId 必须属于该订单
    if (historyId) {
      const snap = await db
        .select({ candidates: promptOrderHistory.candidates })
        .from(promptOrderHistory)
        .where(
          and(
            eq(promptOrderHistory.id, historyId),
            eq(promptOrderHistory.orderId, order.id)
          )
        )
        .limit(1);
      const row = snap[0];
      if (!row) {
        return NextResponse.json(
          { success: false, error: "历史快照不存在或不属于该订单" },
          { status: 404 }
        );
      }
      const nested = parseCandidates(row.candidates);
      const target = resolveCandidateUrl(nested, imageIdx, candIdx, {
        uploadedImages: order.uploadedImages,
        imagesPerUpload: order.imagesPerUpload,
        selectedIndex: order.selectedIndex,
      });
      if (typeof target !== "string" || !target) {
        return NextResponse.json(
          { success: false, error: "历史快照的效果图不存在" },
          { status: 404 }
        );
      }
      if (!/^https?:\/\//i.test(target)) {
        return NextResponse.json(
          {
            success: false,
            error: "历史快照字段不是合法 URL",
          },
          { status: 500 }
        );
      }
      if (req.nextUrl.searchParams.get("download") === "1") {
        // 同主路径：服务端 stream（修 R2 CORS）
        let upstream: Response;
        try {
          upstream = await fetch(target, {
            signal: AbortSignal.timeout(25_000),
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
        const contentType =
          upstream.headers.get("Content-Type") ?? "application/octet-stream";
        const headers: HeadersInit = {
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=300",
        };
        return new Response(upstream.body, { headers });
      }
      return NextResponse.redirect(target, {
        status: 302,
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    // 正常路径
    const nested = parseCandidates(order.candidates as string | null);
    const target = resolveCandidateUrl(nested, imageIdx, candIdx, {
      uploadedImages: order.uploadedImages,
      imagesPerUpload: order.imagesPerUpload,
      selectedIndex: order.selectedIndex,
    });
    if (typeof target !== "string" || !target) {
      return NextResponse.json(
        { success: false, error: "效果图不存在" },
        { status: 404 }
      );
    }
    if (!/^https?:\/\//i.test(target)) {
      return NextResponse.json(
        {
          success: false,
          error: "效果图字段不是合法 URL（可能是历史 base64 数据）",
        },
        { status: 500 }
      );
    }

    // 2026-09-02：下载模式 — 服务端 fetch 图二进制 → stream 回前端。
    // 修公共免登录页 (/p/[token]) 的下载失败：浏览器 fetch(R2 URL)
    // 会被 R2 公共域默认无 CORS 拒绝（与 [[workbench-image-proxy]] 同一根因），
    // 服务端 fetch 没有跨域限制。
    if (req.nextUrl.searchParams.get("download") === "1") {
      let upstream: Response;
      try {
        upstream = await fetch(target, {
          signal: AbortSignal.timeout(25_000),
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
      const contentType =
        upstream.headers.get("Content-Type") ?? "application/octet-stream";
      const headers: HeadersInit = {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      };
      return new Response(upstream.body, { headers });
    }

    return NextResponse.redirect(target, {
      status: 302,
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "获取失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
