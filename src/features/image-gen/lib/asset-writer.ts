/**
 * 资产入库 helper（生图结果 → photo 表 source=generation）
 *
 * 2026-08-23 新增。把 imageJob 完成时的 resultUrls 数组逐条入库为
 * `photo` 行 `source="generation"`，让"我的资产"模块统一承载
 * 本地上传 + 生图结果两类资产。
 *
 * 设计要点：
 * - 幂等：用 imageJobId + fileUrl 去重（一个 job 多次完成只会入一次）
 * - 失败非致命：imageJob 写入已成功（生成结果可见），photo 索引是 secondary，
 *   helper 失败只 warn 不抛，避免把"成功生图"变成"失败"误导用户/前端
 * - 与 createPhotoAction 风格保持一致：width/height/md5 留 0/""（与
 *   photos-manager-view.tsx:148 的上传流一致，先把数据流跑通，二期再补 metadata）
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { photo } from "@/db/schema";

/**
 * 从 URL 推断图片格式（file extension）。
 *
 * 失败 fallback "png" —— 与 gpt-image 适配器（adapters.ts:683）的默认一致，
 * wellapi 大部分返回 png/jpeg，少数 webp。
 */
function inferFormatFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    const ext = match?.[1]?.toLowerCase();
    // 仅认可常见图片格式
    if (ext && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    // URL 解析失败，吃掉用 fallback
  }
  return "png";
}

export interface SaveGenerationResultsOpts {
  jobId: string;
  userId: string;
  resultUrls: string[];
  prompt: string;
  model: string;
}

export interface SaveGenerationResultsResult {
  inserted: number;
  skipped: number;
}

/**
 * 把 imageJob 完成时的 resultUrls 全部入库到 photo 表 source=generation。
 *
 * 幂等：同一 imageJobId 已有 photo 行时，新 resultUrls 中已在的 URL 跳过。
 * 失败：抛上来的异常被外层 try/catch 吃掉并 warn（参见 generation-service.ts
 * 的两个调用点）。
 */
export async function saveGenerationResultsAsAssets(
  opts: SaveGenerationResultsOpts
): Promise<SaveGenerationResultsResult> {
  const { jobId, userId, resultUrls, prompt, model } = opts;

  if (resultUrls.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  // 1. 查这个 job 之前入库过哪些 URL，避免重复
  const existing = await db
    .select({ fileUrl: photo.fileUrl })
    .from(photo)
    .where(eq(photo.imageJobId, jobId));

  const existingUrls = new Set(existing.map((r) => r.fileUrl));

  // 2. 过滤掉重复的；构造要插入的 rows
  const newUrls = resultUrls.filter((url) => !existingUrls.has(url));
  if (newUrls.length === 0) {
    return { inserted: 0, skipped: resultUrls.length };
  }

  const rows = newUrls.map((url) => {
    const ext = inferFormatFromUrl(url);
    // 在原始 resultUrls 里的位置 —— 用 indexOf 找出来，保证 fileName 后缀
    // 与该图在生成结果数组里的次序对齐（比如 4 张里的第 3 张就标 -3）
    const originalIdx = resultUrls.indexOf(url);
    return {
      id: crypto.randomUUID(),
      userId,
      source: "generation" as const,
      imageJobId: jobId,
      prompt,
      model,
      fileName: `gen-${jobId.slice(0, 8)}-${originalIdx + 1}.${ext}`,
      fileUrl: url,
      // 生图流不生成缩略图 —— 与上传流一致，thumbnailUrl 复用 fileUrl
      // （避免空字符串导致 SafeImage 渲染失败）
      thumbnailUrl: url,
      md5: "",
      width: 0,
      height: 0,
      format: ext,
      fileSize: null,
    };
  });

  // 3. 批量插入
  await db.insert(photo).values(rows);

  return {
    inserted: rows.length,
    skipped: resultUrls.length - rows.length,
  };
}
