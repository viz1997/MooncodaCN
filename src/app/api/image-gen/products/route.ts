/**
 * GET /api/image-gen/products
 *
 * 2026-10-18 v1.6.0:面向小程序 / 网页端的「产品 + 配件 + 视觉风格 + 模板」
 * 一站式元数据接口。
 *
 * 背景:
 *  - /api/image-gen/templates 返模板(以 maskId 维度),但缺产品维度的元
 *    数据 —— 「3D 手办能选哪些配件、钥匙扣能选哪些编织绳颜色」这些信息原
 *    先零散在 mock-catalog.ts + product-catalog.ts 硬编码字典里,小程序
 *    没法直接消费。
 *  - 本接口一次返回所有 productTypeCode(R/A/P/RM/LB/M)对应的 ProductCapability,
 *    嵌套 sizes / visualStyles / accessories(含变体) / templates。
 *  - 小程序一次拉完就能完整走「选产品 → 选尺寸 → 选配件 → 选模板 → 选风格
 *    → 提交」全链,无需再串 /api/image-gen/templates。
 *
 * 鉴权:与 /api/image-gen/templates 一致 —— 走 requireExternalApiKey
 * 3-tier 优先级(dev / BA session / x-api-key)。
 *
 * 缓存:CDN-friendly,60s 客户端 max-age + 300s CDN s-maxage + 600s SWR。
 * 产品字典变更后最长 10 分钟生效(与 admin 改 promptTemplate 后的视觉一
 * 致;若需立即生效可手动 purge 或调 query 加 cache-busting)。
 *
 * 限流:ai tier(20/min),与 templates / submit 一致。
 *
 * 白名单:externalApiKey.allowedMasks 非空时,只返回白名单内 productEffect
 * 所属的产品码;产品码下若全部 mask 都被白名单排除,整条 product 不返回。
 */

import { type NextRequest, NextResponse } from "next/server";

import { getClientIp, logImageGen } from "@/features/image-gen";
import {
  loadProductCapabilities,
  parseProductTypeCodes,
  resolveLocale,
} from "@/features/image-gen/lib/product-capability";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";
import { requireExternalApiKey } from "@/lib/require-external-api-key";

export const runtime = "nodejs";
// 30s:与 templates 同,DB 读 2-3 次 (effects + templates + variants) + join,
// 单测 <100ms,正常生产 <2s,留 buffer。
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // 限流:与 templates / submit 同 ai 限流(20/min)
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // API Key 鉴权:复用 submit 同款 helper(3-tier: dev / BA session / x-api-key)
  const { verify: externalKeyVerify, errorResponse: keyError } =
    await requireExternalApiKey(req, ip, rl);
  if (keyError) return keyError;

  try {
    const { searchParams } = new URL(req.url);
    const filterCodes = parseProductTypeCodes(
      searchParams.get("productTypeCode")
    );
    const locale = resolveLocale(req, searchParams.get("locale"));

    // 白名单:dev / BA session 都不过滤(verify=null);非空时只返白名单内 mask
    const keyScope =
      externalKeyVerify?.ok && externalKeyVerify.allowedMasks.length > 0
        ? externalKeyVerify.allowedMasks
        : null;

    const products = await loadProductCapabilities({
      filterCodes,
      keyScope,
    });

    return NextResponse.json(
      {
        success: true,
        keyScope: externalKeyVerify?.ok
          ? {
              keyName: externalKeyVerify.name,
              allowedMasks: externalKeyVerify.allowedMasks,
            }
          : null,
        locale,
        products,
      },
      {
        headers: {
          ...getRateLimitHeaders(rl),
          // CDN-friendly 缓存:浏览器 60s / CDN 300s / 后台 SWR 600s
          "Cache-Control":
            "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (error) {
    console.error("[Image Gen Products Error]", error);
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "unknown",
      errorCode: "INTERNAL_ERROR",
      errorMessage: error instanceof Error ? error.message : "未知错误",
      ip,
    });
    return NextResponse.json(
      { success: false, error: "加载产品失败,请稍后重试" },
      { status: 500, headers: getRateLimitHeaders(rl) }
    );
  }
}
