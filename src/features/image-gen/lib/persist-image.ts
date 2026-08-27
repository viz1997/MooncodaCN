/**
 * 生图结果持久化 helper（image-gen 模块内）。
 *
 * 上游 provider（wellapi.ai / wellapi.cc / 其它）返回的临时 URL 有 TTL
 * （wellapi 实测 1-24h），几天后必然过期。适配器拿到 URL 后立即
 * fetch + 转存 R2，返回永久 R2 URL 给前端的 <img> / 缩略图代理用。
 *
 * 与 `src/features/gpt-image/lib/generation-service.ts:53 persistCandidateToR2`
 * 同语义，但：
 * - objectKey 前缀用 `image-gen/results/`（与 gpt-image 的 `gpt-image/results/`
 *   物理隔离，避免 prefix 冲突）
 * - 不依赖 orderId —— image-gen 这边的标识是 imageJobId（gpt-image 那边是
 *   promptOrder.id）
 * - 没抽出共享 helper 是因为 image-gen 已经直接跨 feature import gpt-image
 *   的 lingting helpers，再依赖 gpt-image 会形成跨模块环
 *
 * 调用方必须自己处理"什么时候调"：Gemini 这类 sync 拿到 URL 的适配器在
 * findImage 后立即调；async 路径（gpt_image_2）在 queryLingtingTask 完成时
 * 由 lingting wrapper 内部统一处理，适配器不需要自己调。
 *
 * 失败语义：抛错，与 gpt-image persistCandidateToR2 保持一致。如果上游
 * 持久化拿不到 R2 URL 但又必须存，image-gen 应该整体不可用，而不是
 * "小图能看、几天后全破"的隐性 silent failure。
 */

import { randomBytes } from "node:crypto";

import { logger } from "@/lib/logger";

import { isR2Configured, putObject } from "./r2";

/**
 * 把上游临时效果图 URL 下载下来，重新上传到 R2，返回永久 R2 URL。
 *
 * @param upstreamUrl - 上游 provider 返回的临时 URL（http(s)）
 * @param jobIdHint - imageJobId 或任意 trace 标识，写进 objectKey 与日志
 * @param imageIdx - 当前 job 内多张结果的 idx
 * @returns R2 公开访问 URL（永久有效）
 * @throws R2 未配置 / fetch 失败 / R2 PUT 失败
 */
export async function persistUpstreamImageToR2(
  upstreamUrl: string,
  jobIdHint: string,
  imageIdx: number,
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error("R2 未配置：效果图无法持久化");
  }

  // 下载上游。60s 超时给 CDN 2x 缓冲（与 gpt-image persistCandidateToR2 同）。
  const res = await fetch(upstreamUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(
      `下载上游效果图失败：HTTP ${res.status} ${res.statusText}`,
    );
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength === 0) {
    throw new Error("上游返回空 body");
  }

  // 推断扩展名：PNG/JPEG/WebP/GIF 都允许
  const ext =
    contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "png";

  // objectKey：jobId + imageIdx + 时间戳 + 4 字节随机，避免重复生成覆盖
  const objectKey = `image-gen/results/${jobIdHint}/${imageIdx}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;

  let persistedUrl: string;
  try {
    persistedUrl = await putObject({
      objectKey,
      body,
      contentType,
    });
  } catch (err) {
    logger.error(
      {
        jobIdHint,
        imageIdx,
        err: err instanceof Error ? err.message : String(err),
      },
      "image-gen: 上传 R2 失败",
    );
    throw err;
  }

  logger.info(
    {
      jobIdHint,
      imageIdx,
      bytes: body.byteLength,
      contentType,
    },
    "image-gen: 上游效果图已转存 R2",
  );

  return persistedUrl;
}
