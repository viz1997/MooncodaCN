/**
 * 图片 URL 构造 + 预加载。
 *
 * 服务端对 /image 和 /candidates 都发 `Cache-Control: private`，
 * 重新生成后 order.updatedAt 会变，把它拼进 query 就能可靠地击穿缓存。
 */

export function originalUrl(token: string, imageIdx: number, version?: string) {
  const v = version ? `&t=${encodeURIComponent(version)}` : "";
  return `/api/orders/${token}/image?index=${imageIdx}${v}`;
}

export function candidateUrl(
  token: string,
  imageIdx: number,
  candIdx: number,
  version?: string
) {
  const v = version ? `?t=${encodeURIComponent(version)}` : "";
  return `/api/orders/${token}/candidates/${imageIdx}/${candIdx}${v}`;
}

/** 预热浏览器缓存，让灯箱翻页/对比时不闪白。 */
export function preloadImages(urls: Array<string | null | undefined>) {
  if (typeof window === "undefined") return;
  for (const url of urls) {
    if (!url) continue;
    const img = new window.Image();
    img.decoding = "async";
    img.src = url;
  }
}
