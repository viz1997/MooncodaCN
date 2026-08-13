/**
 * 一次性迁移脚本：处理 2026-08-05 去 base64 改造前的旧订单。
 *
 * 背景：去 base64 改造时，generation-service 改成把 Lingting (wellapi.ai)
 * 上游 URL 直接落库到 promptOrder.candidates。Lingting URL 有 TTL（典型
 * 1-24h），几天后必然过期。本脚本扫表，把命中"含非 R2 域 URL"的订单
 * 按状态分支处理：
 *
 *   - CANDIDATES_READY → 置 FAILED + errorMessage = "历史候选图已过期（上游 URL TTL 失效），请重新生成"。
 *     这部分订单还有可能挽救：用户在用户页面会看到 FAILED，触发"重新生成全部"走新的
 *     download→R2 路径，得到永久 URL。
 *
 *   - SELECTED → 仅写 errorMessage 提示，不动 status。
 *     用户已"提交"过选择，不能撤回。UI 层需要补一个"历史候选图已过期"的提示条
 *     让用户知道去联系服务方。
 *
 *   - PENDING / GENERATING / FAILED / CANCELLED → 仅打日志，不动 DB。
 *
 * R2 公开域白名单从 getR2PublicHosts() 派生（R2_PUBLIC_BASE_URL 派生域 +
 * ${R2_ACCOUNT_ID}.r2.cloudflarestorage.com）。
 *
 * 用法：
 *   pnpm tsx scripts/migrate-expired-candidate-urls.ts --dry-run   # 只读扫描，不写库
 *   pnpm tsx scripts/migrate-expired-candidate-urls.ts              # 实际写库
 */

import * as dotenv from "dotenv";

// ⚠️ 必须最先加载 env，再动态 import @/db（@/db 在模块顶层会校验 DATABASE_URL）
dotenv.config({ path: ".env.local", quiet: true });

// biome-ignore lint/suspicious/noExplicitAny: 动态导入避开 hoisting 问题
type Db = any;
// biome-ignore lint/suspicious/noExplicitAny: 同上
type Schema = any;
// biome-ignore lint/suspicious/noExplicitAny: 同上
type Drizzle = any;
// biome-ignore lint/suspicious/noExplicitAny: 同上
type Helpers = any;

const EXPIRED_MSG =
  "历史候选图已过期（上游 URL TTL 失效），请重新生成 / 联系服务方";

interface HitRow {
  id: string;
  token: string;
  status: string;
  candidates: string[][];
  /** 命中的非 R2 URL 总数 */
  expiredCount: number;
}

async function run(): Promise<void> {
  // 动态 import 避开静态导入 hoisting 问题（dotenv 必须先于 @/db 模块顶层检查）
  const { db } = (await import("@/db")) as { db: Db };
  const { promptOrder } = (await import("@/db/schema")) as { promptOrder: Schema };
  const { eq, inArray } = (await import("drizzle-orm")) as { eq: Drizzle; inArray: Drizzle };
  const { getR2PublicHosts } = (await import("@/features/image-gen/lib/r2")) as {
    getR2PublicHosts: () => string[];
  };
  const { parseCandidates } = (await import(
    "@/features/gpt-image/lib/order-helpers"
  )) as { parseCandidates: (raw: string | null | undefined) => string[][] };

  async function scanOrders(): Promise<HitRow[]> {
    const hosts = new Set(getR2PublicHosts());

    const rows = await db
      .select({
        id: promptOrder.id,
        token: promptOrder.token,
        status: promptOrder.status,
        candidates: promptOrder.candidates,
      })
      .from(promptOrder);

    const hits: HitRow[] = [];
    for (const row of rows) {
      const nested = parseCandidates(row.candidates);
      let expiredCount = 0;
      for (const group of nested) {
        if (!Array.isArray(group)) continue;
        for (const url of group) {
          if (typeof url !== "string" || !url) continue;
          try {
            const host = new URL(url).host.toLowerCase();
            // R2 公开域一律视为 OK；其他 host 一律视为过期
            if (![...hosts].some((h) => h.toLowerCase() === host)) {
              expiredCount++;
            }
          } catch {
            // 非合法 URL 也算过期
            expiredCount++;
          }
        }
      }
      if (expiredCount > 0) {
        hits.push({
          id: row.id,
          token: row.token,
          status: row.status,
          candidates: nested,
          expiredCount,
        });
      }
    }
    return hits;
  }

  async function writeFixes(
    hits: HitRow[],
    dryRun: boolean
  ): Promise<{ failed: number; selected: number; skipped: number }> {
    const failedIds: string[] = [];
    const selectedIds: string[] = [];
    let skipped = 0;

    for (const hit of hits) {
      if (hit.status === "CANDIDATES_READY") {
        failedIds.push(hit.id);
      } else if (hit.status === "SELECTED") {
        selectedIds.push(hit.id);
      } else {
        skipped++;
        console.log(
          `⏭  [${hit.status}] token=${hit.token.slice(0, 8)}… (${hit.expiredCount} 个过期 URL，跳过)`
        );
      }
    }

    if (failedIds.length > 0) {
      console.log(
        `\n📦 CANDIDATES_READY → FAILED: ${failedIds.length} 个订单${dryRun ? "（dry-run，不会写库）" : ""}`
      );
      if (!dryRun) {
        await db
          .update(promptOrder)
          .set({
            status: "FAILED",
            errorMessage: EXPIRED_MSG,
            updatedAt: new Date(),
          })
          .where(inArray(promptOrder.id, failedIds));
      }
    }

    if (selectedIds.length > 0) {
      console.log(
        `\n📝 SELECTED 写 errorMessage 提示: ${selectedIds.length} 个订单${dryRun ? "（dry-run，不会写库）" : ""}`
      );
      if (!dryRun) {
        for (const id of selectedIds) {
          await db
            .update(promptOrder)
            .set({ errorMessage: EXPIRED_MSG, updatedAt: new Date() })
            .where(eq(promptOrder.id, id));
        }
      }
    }

    return {
      failed: failedIds.length,
      selected: selectedIds.length,
      skipped,
    };
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("🔍 DRY RUN — 不会修改数据");
  }

  const r2Hosts = getR2PublicHosts();
  console.log(`🌐 R2 公开域白名单：${r2Hosts.join(", ") || "(未配置)"}`);

  const hits = await scanOrders();
  console.log(`\n🔍 扫描完成：${hits.length} 个订单含非 R2 域 URL`);

  if (hits.length === 0) {
    console.log("✅ 没有需要修复的订单");
    return;
  }

  // 按状态分组打印
  const byStatus = new Map<string, number>();
  for (const hit of hits) {
    byStatus.set(hit.status, (byStatus.get(hit.status) ?? 0) + 1);
  }
  console.log("\n📊 状态分布：");
  for (const [status, count] of byStatus.entries()) {
    console.log(`   ${status}: ${count}`);
  }

  const result = await writeFixes(hits, dryRun);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    `${dryRun ? "🔍 [DRY RUN] " : ""}✅ 完成：CANDIDATES_READY→FAILED ${result.failed} 个，SELECTED 写 errorMessage ${result.selected} 个，跳过 ${result.skipped} 个`
  );
}

run().catch((err) => {
  console.error("💥 脚本失败：", err);
  process.exit(1);
});