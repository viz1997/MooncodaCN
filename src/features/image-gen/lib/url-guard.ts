/**
 * 图片代理 URL 白名单（SSRF 防御）。
 *
 * 服务端下载 / 缩略图代理（/api/image-gen/download, /api/image-gen/thumbnail）
 * 在拿到 ?url= 后先过这个守卫：只放行 R2 公开域与已知上游 provider，
 * 拒绝 data:、localhost、私网 IP、非 https。
 *
 * 白名单构建方式：R2 hosts 由 `getR2PublicHosts()` 运行时给出（依据
 * R2_PUBLIC_BASE_URL / R2_ACCOUNT_ID env），其余白名单域硬编码 —— 都是
 * 已知的生图 provider，不会随用户输入扩展。
 *
 * 与 `src/app/api/orders/[token]/upload/route.ts:80 isAllowedPublicUrl` 形态一致，
 * 但本守卫更严格：必须 https + 命中白名单，缺一不可。
 */

import { getR2PublicHosts } from "@/features/image-gen/lib/r2";

/** 硬编码白名单：上游 provider 域，结果 URL 可能直链。 */
const HARDCODED_ALLOWED_HOSTS = ["wellapi.ai", "cdn.wellapi.ai"] as const;

function isHardcodedAllowed(host: string): boolean {
  return HARDCODED_ALLOWED_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

/**
 * 判断一个 URL 是否允许走服务端代理。
 *
 * - 必须是 https（防 http 降级 + 防协议攻击）
 * - host 必须命中 R2 公开域或硬编码 provider 域
 * - 拒绝 data: / blob: / 相对路径（这些本来就该 client-side 直接用）
 *
 * @param value - 任意 URL 字符串
 * @returns true 表示可以 fetch
 */
export function isAllowedImageUrl(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  if (!/^https:\/\//i.test(value)) return false;

  let host = "";
  try {
    host = new URL(value).host;
  } catch {
    return false;
  }
  if (!host) return false;

  // R2 公开域：动态从 env 读取
  const r2Hosts = getR2PublicHosts();
  const matchesR2 = r2Hosts.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
  if (matchesR2) return true;

  // 硬编码 provider 域
  if (isHardcodedAllowed(host)) return true;

  return false;
}

/**
 * 提取 Content-Type 兜底值：上游响应无头时按 URL 后缀推断。
 */
export function inferImageContentType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".avif")) return "image/avif";
  // 兜底 png：浏览器 / Sharp 都能识别
  return "image/png";
}
