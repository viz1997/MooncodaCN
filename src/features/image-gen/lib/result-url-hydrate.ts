/**
 * 历史 wellapi/上游 URL → R2 永久化 hydrate helper。
 *
 * 触发点：/api/image-gen/thumbnail 命中白名单中 hardcoded provider 域
 * （wellapi.ai / wellapi.cc / cdn.wellapi.ai），通过 `next/server` 的 after()
 * 后台 fire-and-forget 调本函数。用户感知到的 sharp 缩略图仍来自上游
 * （首次走 wellapi CDN，本就要付 60s fetch；hydrate 在后台异步，等同
 * 免费搭车），DB 写回后下次任何人访问都是 R2 CDN。
 *
 * 不抽到 pg 跨集群共享状态：DB SELECT 用 jsonb @> 谓词 + objectKey 随机
 * 后缀，重复 migrate 同一张图只产生孤儿 R2 对象（几十 GB 上限，后续可清理）。
 * 失败仅 log，不抛响 —— 缩略图本身已经正确返回。
 *
 * 与 `lib/persist-image.ts: persistUpstreamImageToR2` 区别：本函数多一步 DB
 * 回写，且**复用上游 thumbnail 已 fetch 到的 buffer**（不再二次 fetch 上游，
 * 节省 60s）。persistedUrl 与 objectKey 设计一致，objectKey 前缀
 * `image-gen/migrated/` 与 `image-gen/results/` 物理隔离，方便区分
 * "新生成结果" vs "历史迁移结果"。
 */

import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { imageJob } from "@/db/schema";
import { logger } from "@/lib/logger";

import { isR2Configured, putObject } from "./r2";

/**
 * 把单个历史 wellapi URL 迁到 R2，并把 DB 里所有 result_urls 引用它的
 * image_job 行写回新 URL。
 *
 * 失败语义：抛错由调用方(after() 包装)catch，**不影响**已经返回的
 * 缩略图响应。
 *
 * @param upstreamUrl  上游 wellapi/历史直链 URL
 * @param buffer       上游 fetch 已读到的 byte 内容（来自 thumbnail handler）
 * @param contentType  上游响应的 Content-Type（用于 putObject + ext 推断）
 * @returns R2 公开 URL；DB 写回成功后此 URL 会在后续 thumbnail 请求中
 *          命中 isR2Configured() 走 R2 CDN
 */
export async function migrateResultUrlToR2(
  upstreamUrl: string,
  buffer: Uint8Array,
  contentType: string,
): Promise<string> {
  if (!isR2Configured()) {
    // R2 未配置，不抛错 —— 调用方会 catch 后直接 log 退出。
    // 这种情况实际上意味着部署没配 R2,业务不可用,但这是配置问题。
    throw new Error("R2 未配置，无法 hydrate 历史 URL");
  }
  if (buffer.byteLength === 0) {
    throw new Error("上游 buffer 为空");
  }

  // 推断扩展名（与 persistUpstreamImageToR2 同形）
  const ext =
    contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "png";

  // objectKey 前缀 `migrated/` 与 `results/` 物理隔离
  const objectKey = `image-gen/migrated/${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  const persistedUrl = await putObject({
    objectKey,
    body: buffer,
    contentType,
  });

  // DB 反查：jsonb @> 谓词对 json / jsonb 都可用。`json @> '["url"]'::jsonb`
  // 表示 "result_urls 数组包含 url 这个元素"。返回所有匹配 rowId。
  //
  // 没建 GIN 索引：imageJob 表生产规模约 ~几万行，全表扫可控；
  // 如果未来 imageJob 行数膨胀到 10w+ 再考虑加
  // `CREATE INDEX ... USING GIN (result_urls jsonb_path_ops)`。
  const matches = await db
    .select({ id: imageJob.id, resultUrls: imageJob.resultUrls })
    .from(imageJob)
    .where(
      sql`${imageJob.resultUrls} @> ${JSON.stringify([upstreamUrl])}::jsonb`,
    );

  if (matches.length === 0) {
    // 没找到引用 —— 可能是孤儿 URL（被 link-only 分享出去、或被人工
    // 清过 result_urls）。R2 对象已上传但没人引用，记 warn 让后续清理
    // 脚本捡到。
    logger.warn(
      { upstreamUrl, persistedUrl, objectKey },
      "image-gen: hydrate 没找到引用 image_job",
    );
    return persistedUrl;
  }

  // read-modify-write：read resultUrls,JS 替换,write 回去。
  // 并发竞争 window：两用户同访问 → 都 SELECT 都 UPDATE，后写者赢。
  // 内容是同一张图的不同 R2 URL（objectKey 随机），视觉无害。
  let updatedRows = 0;
  for (const row of matches) {
    if (!row.resultUrls.includes(upstreamUrl)) continue;
    const next = row.resultUrls.map((u) =>
      u === upstreamUrl ? persistedUrl : u,
    );
    try {
      await db
        .update(imageJob)
        .set({ resultUrls: next })
        .where(eq(imageJob.id, row.id));
      updatedRows += 1;
    } catch (err) {
      // 单行失败不阻断 —— 其他 row 仍要尝试
      logger.error(
        {
          jobId: row.id,
          upstreamUrl,
          err: err instanceof Error ? err.message : String(err),
        },
        "image-gen: hydrate UPDATE 单行失败",
      );
    }
  }

  logger.info(
    {
      upstreamUrl,
      persistedUrl,
      bytes: buffer.byteLength,
      matched: matches.length,
      updatedRows,
    },
    "image-gen: hydrate 完成",
  );

  return persistedUrl;
}

/**
 * 判定一个 URL 是不是需要 hydrate 的"上游直链"。
 *
 * 当前实现：白名单 HARDCODED 域（wellapi.ai / wellapi.cc / cdn.wellapi.ai）
 * 都视为可能过期、需要 hydrate；R2 域（动态 getR2PublicHosts()）视为已
 * 持久化,跳过。
 *
 * 与 `lib/url-guard.ts HARDCODED_ALLOWED_HOSTS` 的关系：url-guard 决定
 * "能代理",本函数决定 "代理完成后是否要 hydrate"。两集合保持同步。
 */
export function isHydrateCandidate(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  if (!/^https?:\/\//i.test(value)) return false;
  let host = "";
  try {
    host = new URL(value).host;
  } catch {
    return false;
  }
  if (!host) return false;
  // 复用白名单常量：避免双维护
  const HARDCODED = ["wellapi.ai", "cdn.wellapi.ai", "wellapi.cc"] as const;
  return HARDCODED.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}
