#!/usr/bin/env -S npx tsx

/**
 * Backfill: 把历史 imageJob.resultUrls 入库到 photo 表（source=generation）
 *
 * 2026-08-23 新增。配合「效果图合入我的资产模块」上线：phase 3 接入 helper
 * 之后，新生成的图会自动入库；本脚本扫所有 status="completed" 的 imageJob
 * 行，把 resultUrls 数组里还没入 photo 的 URL 补入库。
 *
 * 幂等：saveGenerationResultsAsAssets 内部按 imageJobId+fileUrl 去重，跑
 * 第二次 inserted=0 / skipped=N。
 *
 * 使用：
 *   pnpm backfill:image-job-to-photo
 *
 * 环境变量：从 .env.local 加载（同 admin:seed），需要 DATABASE_URL。
 *
 * 输出：
 *   processed: N jobs, inserted: N photos, skipped: N (already in assets)
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

// 关键：必须在动态 import @/db 之前同步加载 .env.local
// ES Module 的 import 会被 hoist，但这里的动态 import 是异步的，所以 dotenv 先执行
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
// 也尝试加载 .env（兜底）
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

const BATCH_SIZE = 100;

interface JobRow {
  id: string;
  userId: string;
  prompt: string;
  model: string;
  resultUrls: unknown;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[backfill] 缺少 DATABASE_URL，请先在 .env.local 配置数据库连接"
    );
    process.exit(1);
  }

  console.log("[backfill] 开始扫描 imageJob（status=completed）");
  console.log(
    `[backfill] DATABASE_URL=${process.env.DATABASE_URL ? "已配置" : "❌ 未配置"}`
  );

  // 动态 import @/db：dotenv 此时已加载好 env
  const [{ db }, { imageJob }, { eq }, { saveGenerationResultsAsAssets }] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
      import("@/features/image-gen/lib/asset-writer"),
    ]);

  let offset = 0;
  let processedJobs = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let failedJobs = 0;

  // 分批拉：避免一次性 SELECT 太多行。imageJob 多数用户量级不大，但留个底线。
  // 不强制按 userId 分批 —— 一致性更重要。
  // biome-ignore lint/correctness/noConstantCondition: offset 由分批推进终止
  while (true) {
    const jobs: JobRow[] = await db
      .select({
        id: imageJob.id,
        userId: imageJob.userId,
        prompt: imageJob.prompt,
        model: imageJob.model,
        resultUrls: imageJob.resultUrls,
      })
      .from(imageJob)
      .where(eq(imageJob.status, "completed"))
      .limit(BATCH_SIZE)
      .offset(offset);

    if (jobs.length === 0) break;
    offset += jobs.length;

    for (const job of jobs) {
      processedJobs += 1;
      // resultUrls 是 JSON 列，Drizzle 在 postgres-js 下默认按 string 返回；
      // 早期行可能是对象/数组，做一次 normalization 兜底
      const raw = job.resultUrls;
      let urls: string[] = [];
      if (Array.isArray(raw)) {
        urls = raw.filter((u): u is string => typeof u === "string");
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            urls = parsed.filter((u): u is string => typeof u === "string");
          }
        } catch {
          // 不是合法 JSON，跳过这条
        }
      }

      if (urls.length === 0) {
        totalSkipped += 1;
        continue;
      }

      try {
        const res = await saveGenerationResultsAsAssets({
          jobId: job.id,
          userId: job.userId,
          resultUrls: urls,
          prompt: job.prompt,
          model: job.model,
        });
        totalInserted += res.inserted;
        totalSkipped += res.skipped;
      } catch (err) {
        failedJobs += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[backfill] job ${job.id.slice(0, 8)} 入库失败：${msg}（已跳过，继续）`
        );
      }
    }

    console.log(
      `[backfill] 进度：已扫 ${processedJobs} jobs（offset=${offset}），inserted=${totalInserted} skipped=${totalSkipped} failed=${failedJobs}`
    );
  }

  console.log("─".repeat(60));
  console.log(`[backfill] 完成`);
  console.log(`           processed: ${processedJobs} jobs`);
  console.log(`           inserted:  ${totalInserted} photos`);
  console.log(
    `           skipped:   ${totalSkipped} (already in assets or empty)`
  );
  if (failedJobs > 0) {
    console.log(`           failed:    ${failedJobs} jobs（已记 warn 日志）`);
  }
  console.log("[backfill] 提示：再跑一次 inserted 应为 0（验证幂等）");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] 未处理错误：", err);
    process.exit(1);
  });
