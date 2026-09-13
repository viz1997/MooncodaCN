/**
 * 2026-09-13：把图片复制到剪贴板（含三层降级）。
 *
 * 用于 demo 流「复制图片」按钮：代理商生成预览图后想把图发给客户，把 PNG
 * 直接贴到微信 / 邮件 / 笔记等富文本输入框比贴 URL 体验好。
 *
 * 浏览器兼容性（2026-09）：
 * - Chrome / Edge / Firefox 127+：navigator.clipboard.write + ClipboardItem
 *   支持 image/png MIME ✓
 * - iOS Safari：navigator.clipboard.write 仅支持 text/plain，写 image/png
 *   抛 NotAllowedError → 降级 writeText URL
 * - 旧浏览器 / 非 https：clipboard API 完全不可用 → 返回 failed 让调用方 toast
 *
 * 三层降级返回类型让调用方按结果给差异化 toast 文案：
 * - "image"  → L1 成功写入了 PNG 到剪贴板
 * - "url"    → L2 降级为写入了图片 URL（部分设备需长按打开）
 * - "failed" → L3 兜底，调用方提示「长按图片手动复制」
 *
 * 注意：
 * - 函数依赖 navigator / fetch；SSR 调用需在外层判 typeof window === "undefined"
 * - fetch 加 5s AbortController 超时，避免 R2 冷启动挂死时 toast 不出
 * - blob.type 重包 image/png 是为了让写入 PNG 时 MIME 字段稳定
 *   （实际数据可能不是 PNG，但剪贴板只认 MIME，不影响粘贴效果）
 */

export type CopyImageResult = "image" | "url" | "failed";

/**
 * 把图片复制到剪贴板。
 *
 * @param url 图片公开 URL（必须同源或 R2 公开域有 CORS 头）
 * @returns 复制结果（用于 toast 差异化文案）
 */
export async function copyImageToClipboard(url: string): Promise<CopyImageResult> {
  // SSR 防御：服务端无 navigator / clipboard，直接返 failed
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "failed";
  }

  // L1：fetch → blob → ClipboardItem image/png
  try {
    const blob = await fetchImageBlob(url);
    if (
      typeof ClipboardItem !== "undefined" &&
      blob &&
      typeof navigator.clipboard?.write === "function"
    ) {
      // 重包 image/png MIME（剪贴板只认声明的 MIME，blob 实际格式不影响粘贴）
      const pngBlob =
        blob.type === "image/png"
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngBlob }),
      ]);
      return "image";
    }
    // ClipboardItem 不可用 → 降级到 L2
  } catch {
    // fetch 失败 / clipboard.write 抛错 → 降级到 L2
  }

  // L2：writeText 写图片 URL（iOS Safari 等不支持 image/png 的浏览器命中）
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(url);
      return "url";
    }
  } catch {
    // writeText 也失败 → 兜底 L3
  }

  // L3：完全不可用（剪贴板权限拒 / 旧浏览器 / 非 https）
  return "failed";
}

/**
 * 内部辅助：fetch 图片转 blob，加 5s 超时避免 R2 冷启动挂死。
 */
async function fetchImageBlob(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      mode: "cors",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`fetch ${url} → HTTP ${res.status}`);
    }
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}