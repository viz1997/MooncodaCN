/**
 * 缩略图 URL 构造器（client-side helper）。
 *
 * 工作台 / 资产库 / photo 表的 <img> 缩略图位统一通过这个函数拿到 src：
 *   - data: URL 直接返回原值（浏览器原生支持，无 CORS 问题）
 *   - http(s) URL 走 /api/image-gen/thumbnail 代理，stream 透传上游原图 +
 *     immutable 1 年缓存（不再服务端缩放，见 route.ts 注释）
 *
 * width 参数保留是为了接口稳定 + 未来如果再加服务端处理能力时不用改 caller；
 * 当前实现忽略 width，由浏览器 <img> 用 object-fit / sizes / srcset 自适应。
 *
 * 注意：lightbox 全屏查看、参考图 Dialog 等"需要原始分辨率"的场景不走
 * 这个函数 —— 直接用原 URL。
 */

/** 缩略图最大宽度。当前路由已不缩放,这里保留仅为接口兼容性。 */
const MAX_THUMB_WIDTH = 1024;

/**
 * 把任意 URL 转成"用于 <img src> 的 URL"。
 *
 * - 空白 / 非字符串 → 原值透传（让上游渲染自己处理空 src 的视觉降级）
 * - data: / blob: → 原值透传（不走代理）
 * - http(s) → /api/image-gen/thumbnail?url=...&w=...
 *
 * @param url - 原始 URL（来自 R2 / provider / 上传结果 / 本地拼接）
 * @param width - 期望的展示宽度（px），用于 sharp resize 目标宽度
 */
export function thumbnailUrl(url: string, width: number): string {
  if (!url) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  // 容错：极少数旧 URL 是 http://（dev 早期产物）。代理强制 https 要求，
  // 此处直接放行让浏览器走原 URL —— 上线后这条分支基本不会触发。
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const w = Math.max(16, Math.min(MAX_THUMB_WIDTH, Math.round(width)));
    return `/api/image-gen/thumbnail?url=${encodeURIComponent(url)}&w=${w}`;
  }
  // 其他（相对路径 / protocol-relative 等）原样透传
  return url;
}

/**
 * 下载代理 URL 构造器（仅用于 HTTP(S) 链接；data: URL 不走代理）。
 *
 * 浏览器拿到这个 URL 会自动 GET → 服务端直 stream 二进制 + 弹下载框
 * （Content-Disposition: attachment）。data: URL 应走原来的 fetch + blob
 * 路径，与 thumbnailUrl 短路规则一致。
 */
export function downloadProxyUrl(url: string, filename: string): string {
  if (!url) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `/api/image-gen/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
}
