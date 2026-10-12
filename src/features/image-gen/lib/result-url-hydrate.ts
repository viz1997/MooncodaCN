/**
 * 历史 wellapi/上游 URL → R2 永久化 hydrate helper。
 *
 * 触发点：/api/image-gen/thumbnail 命中白名单中 hardcoded provider 域
 * （wellapi.ai / wellapi.cc / cdn.wellapi.ai），通过 `next/server` 的 after()
 * 后台 fire-and-forget 调本函数。用户感知到的代理图仍来自上游 CDN
 * （首次走 wellapi CDN，本就要付 60s fetch；hydrate 在后台异步，等同
 * 免费搭车），DB 写回后下次任何人访问都是 R2 CDN。
 *
 * R2 上传这一步**不自己做**,直接复用
 * `src/features/gpt-image/lib/generation-service.ts:53 persistCandidateToR2`
 * —— gpt_image_2 adapter 也用它跨模块 import,本仓库的现成方案。
 * 本模块只剩 DB 反查 image_job + UPDATE 两件事。
 *
 * 没抽出"哪些 URL 要 hydrate"的判定 —— 复用 url-guard.ts HARDCODED 域
 * 集合,通过 `isHydrateCandidate` 检查白名单通过后的 URL 是否还在
 * hardcoded 集合内（R2 域已迁过,跳过）。
 */

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { imageJob } from "@/db/schema";
import { persistCandidateToR2 } from "@/features/gpt-image/lib/generation-service";
import { HARDCODED_PROVIDER_HOSTS } from "@/features/image-gen/lib/url-guard";
import { logger } from "@/lib/logger";

/**
 * 把单个历史 wellapi URL 迁到 R2，并把 DB 里所有 result_urls 引用它的
 * image_job 行写回新 URL。
 *
 * R2 上传委派给现成 persistCandidateToR2；本函数只做 DB 反查 + UPDATE。
 *
 * 失败语义：抛错由调用方(after() 包装)catch，**不影响**已经返回的
 * 缩略图响应。
 *
 * @param upstreamUrl  上游 wellapi/历史直链 URL
 * @returns R2 公开 URL；DB 写回成功后此 URL 会在后续 thumbnail 请求中
 *          直接命中白名单 R2 分支走 R2 CDN
 */
export async function migrateResultUrlToR2(
  upstreamUrl: string
): Promise<string> {
  // 复用 gpt-image 已有的 helper：fetch upstream → putObject R2 → 返回 R2 URL。
  // 这一步失败由调用方 catch 记 warn,不影响已返回的缩略图。
  // traceHint 仅用于 objectKey 与日志,清理成纯 base36 字符串避免
  // URL 末段字符（.png / .ico）污染 R2 objectKey 形态。
  const traceHint = `ih${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const persistedUrl = await persistCandidateToR2(upstreamUrl, traceHint, 0);

  // DB 反查：jsonb @> jsonb 谓词表示 "result_urls 数组包含 url 这个元素"。
  //
  // schema 里 result_urls 是 json 类型（不是 jsonb），所以左右都 cast 成 jsonb：
  // `json @> jsonb` 操作符在 PG18 不存在，会报
  // ERROR: operator does not exist: json @> jsonb。两侧 ::jsonb cast 解决。
  //
  // 没建 GIN 索引：imageJob 表生产规模约 ~几万行，全表扫可控；
  // 如果未来 imageJob 行数膨胀到 10w+ 再考虑加
  // `CREATE INDEX ... USING GIN (result_urls jsonb_path_ops)`。
  const matches = await db
    .select({ id: imageJob.id, resultUrls: imageJob.resultUrls })
    .from(imageJob)
    .where(
      sql`${imageJob.resultUrls}::jsonb @> ${JSON.stringify([upstreamUrl])}::jsonb`
    );

  if (matches.length === 0) {
    logger.warn(
      { upstreamUrl, persistedUrl },
      "image-gen: hydrate 没找到引用 image_job,可能是孤儿 URL"
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
      u === upstreamUrl ? persistedUrl : u
    );
    try {
      await db
        .update(imageJob)
        .set({ resultUrls: next })
        .where(eq(imageJob.id, row.id));
      updatedRows += 1;
    } catch (err) {
      logger.error(
        {
          jobId: row.id,
          upstreamUrl,
          err: err instanceof Error ? err.message : String(err),
        },
        "image-gen: hydrate UPDATE 单行失败"
      );
    }
  }

  logger.info(
    {
      upstreamUrl,
      persistedUrl,
      matched: matches.length,
      updatedRows,
    },
    "image-gen: hydrate 完成"
  );

  return persistedUrl;
}

/**
 * 判定一个 URL 是不是需要 hydrate 的"上游直链"。
 *
 * 当前实现：HARDCODED provider 域（wellapi.ai / wellapi.cc / cdn.wellapi.ai）
 * 都视为可能过期、需要 hydrate；R2 域（动态 getR2PublicHosts()）视为已
 * 持久化,跳过。
 *
 * 复用 url-guard 暴露的 HARDCODED_PROVIDER_HOSTS —— 单一来源,url-guard
 * 决定 "能否代理",本函数决定 "代理完成后是否要 hydrate"。两集合从
 * 同一 const 派生,增减 provider 域只改一处。
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
  return HARDCODED_PROVIDER_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}
