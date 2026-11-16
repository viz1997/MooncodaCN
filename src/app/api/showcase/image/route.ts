/**
 * GET /api/showcase/image?key=… —— 案例图片的**签名跳转**
 *
 * ## 为什么有这条路
 *
 * 案例图存在 R2 里。配了 `R2_PUBLIC_BASE_URL` 的时候,前台直接用 CDN 地址
 * (`https://cdn…/showcases/…`)当 `<img src>` —— 浏览器自己去拿,不过我们。
 *
 * **没配公开域名就不行** —— `getPublicUrl()` 那时候退化成 S3 API 地址
 * (`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`),那个地址在
 * 浏览器里**打不开**(要签名)⇒ 页面上是一堆裂图。
 *
 * ⇒ 这条路由兜底:签一个短时效的下载 URL,**302** 跳过去。
 *
 * ## ⚠️ 这个端点**只认案例图片**
 *
 * `key` 必须落在 `showcases/` 前缀下 —— 否则这个端点就等于「把整个桶
 * 变成公开下载站」(桶里还有生图产物、参考图那些)。
 *
 * ## ⚠️ 不带 locale 前缀
 *
 * API 路由住在 `src/app/api/**`,不在 `[locale]` 底下;`proxy.ts` 对
 * `/api/**` 直接 `NextResponse.next()`,不走 intl 中间件 ⇒ 两种语言的页面
 * 都能用同一个地址。
 */

import { type NextRequest, NextResponse } from "next/server";

import { isR2Configured, presignDownload } from "@/features/image-gen/lib/r2";
import { isShowcaseObjectKey } from "@/features/showcase/lib/case-image";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 签一个 URL 就 302 —— 10s 够 */
export const maxDuration = 10;

/**
 * 签名有效期 —— **一小时**
 *
 * 一次页面浏览要加载十几张图,15 分钟(仓库里下载链接的默认)有时候刚翻完
 * 就过期了(图片是懒加载的,滚到底部可能已经过了十几分钟)。一小时足够看完
 * 一页,又不会变成一条长期有效的链接。
 */
const EXPIRES_IN = 3600;

async function handle(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") ?? "";

  // ⚠️ 前缀校验 —— 这一条挡住「整个桶变公开下载站」
  if (!isShowcaseObjectKey(key)) {
    return NextResponse.json(
      { success: false, error: "图片不存在", code: "INVALID_KEY" },
      { status: 400 }
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { success: false, error: "R2 未配置", code: "R2_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const url = await presignDownload(key, { expiresIn: EXPIRES_IN });
    return NextResponse.redirect(url, {
      // 302 —— 不是永久跳转:签名 URL 会过期,浏览器不该永久缓存这条
      status: 302,
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { success: false, error: `签名失败: ${msg}`, code: "PRESIGN_FAILED" },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(handle);
