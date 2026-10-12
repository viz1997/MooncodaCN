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

/**
 * 历史快照缩略图 URL：走 /candidates/[imageIdx]/0?historyId=... 通道
 * 服务端从快照 JSON 里读图，避免暴露上游 URL 给前端。
 *
 * 缩略图始终用 candIdx=0（整张宫格），由 QuadrantGrid 自行 crop。
 */
export function historyCandidateUrl(
  token: string,
  historyId: string,
  imageIdx: number,
  version?: string
) {
  const params = new URLSearchParams();
  params.set("historyId", historyId);
  if (version) params.set("t", version);
  return `/api/orders/${token}/candidates/${imageIdx}/0?${params.toString()}`;
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
