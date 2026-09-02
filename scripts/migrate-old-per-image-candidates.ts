/**
 * 一次性迁移脚本：把旧 per-image 格式 candidates 折叠为 per-batch 格式。
 *
 * 2026-09-02 batch 索引重构背景：
 * - 旧 `promptOrder.candidates` 是按 imageIdx 维度存的 `string[][]`，
 *   外层长度 = uploadedImageCount，每张原图独立跑了一次生成。
 * - 新语义改成按 batchIdx 维度（每批 N 张原图合一次生图 = 1 个候选组），
 *   外层长度 = ceil(uploadedImageCount / imagesPerUpload)。
 *
 * 已存在的旧订单 candidates 字段还是旧格式。如果又触发了新的
 * `/api/orders/[token]/select` 路由，新路由按 batchIdx 写入 selections，
 * status 提前到 SELECTED，但 candidates 没动——前端 ResultStep 拿
 * selections[0]=1 请求 /candidates/0/1，但 DB candidates[0] = [url0]（只
 * 1 个 URL），candidates[0][1] undefined → 404。用户 /p/[token] 刷新后
 * 已选效果图消失。
 *
 * 修复：找到每个 batch 内用户选过的代表 URL（按 oldSelections[imageIdx]
 * 命中 oldCandidates[imageIdx][selections[imageIdx]] 兜底
 * oldCandidates[imageIdx][0]），折叠成新格式 candidates = [[url]]（1
 * 批 1 张代表图），selections = [0]，selectedIndex = 0。
 *
 * 不动 `prompt_order_history` —— 历史快照原貌保留（用户决策）。
 *
 * 用法：
 *   pnpm tsx scripts/migrate-old-per-image-candidates.ts --dry-run   # 只读扫描
 *   pnpm tsx scripts/migrate-old-per-image-candidates.ts --run       # 实际写库
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

interface MigrationPlan {
  id: string;
  token: string;
  status: string;
  uploadedCount: number;
  imagesPerUpload: number;
  batchCount: number;
  oldCandidatesLen: number;
  oldSelectionsLen: number | "NULL";
  newCandidates: string[][];
  newSelections: (number | null)[];
  newSelectedIndex: number | null;
  pickedSource: "oldSelections" | "firstNonEmpty" | "fallback";
}

async function run(): Promise<void> {
  // 动态 import 避开静态导入 hoisting 问题（dotenv 必须先于 @/db 模块顶层检查）
  const { db } = (await import("@/db")) as { db: Db };
  const { promptOrder } = (await import("@/db/schema")) as {
    promptOrder: Schema;
  };
  const { eq, inArray } = (await import("drizzle-orm")) as {
    eq: Drizzle;
    inArray: Drizzle;
  };
  const { parseCandidates, parseSelections, parseUploadedImages } =
    (await import("@/features/gpt-image/lib/order-helpers")) as {
      parseCandidates: (raw: string | null | undefined) => string[][];
      parseSelections: (
        raw: string | null | undefined
      ) => (number | null)[] | null;
      parseUploadedImages: (raw: string | null | undefined) => string[];
    };

  const dryRun = !process.argv.includes("--run");
  if (dryRun) {
    console.log("🔍 DRY RUN — 不会修改数据");
  } else {
    console.log("🚨 RUN 模式 — 将要写库！");
  }

  // 扫所有有 uploaded_images + candidates 的订单
  const rows = await db
    .select({
      id: promptOrder.id,
      token: promptOrder.token,
      status: promptOrder.status,
      uploadCount: promptOrder.uploadCount,
      imagesPerUpload: promptOrder.imagesPerUpload,
      uploadedImages: promptOrder.uploadedImages,
      candidates: promptOrder.candidates,
      selections: promptOrder.selections,
      selectedIndex: promptOrder.selectedIndex,
    })
    .from(promptOrder);

  const plans: MigrationPlan[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const row of rows) {
    const uploaded = parseUploadedImages(row.uploadedImages);
    const uploadedCount = uploaded.length;
    if (uploadedCount === 0) {
      skipped.push({ id: row.id, reason: "no uploaded images" });
      continue;
    }
    const imagesPerUpload = Math.max(1, row.imagesPerUpload);
    const batchCount = Math.ceil(uploadedCount / imagesPerUpload);

    const oldCandidates = parseCandidates(row.candidates);
    const oldSelections = parseSelections(row.selections);

    // 已经是新格式 → 跳过
    if (oldCandidates.length <= batchCount) {
      // 但 selections 可能是旧 imageIdx 维度（length=uploadedCount）—— 也算遗留
      const selLen = oldSelections?.length ?? "NULL";
      if (selLen !== "NULL" && selLen > batchCount) {
        // selections 仍是旧 imageIdx 维度但 candidates 已新格式（少见）—— 也迁移
        // fallthrough
      } else {
        skipped.push({
          id: row.id,
          reason: `candidates.len=${oldCandidates.length} <= batchCount=${batchCount}`,
        });
        continue;
      }
    }

    const newCandidates: string[][] = [];
    const newSelections: (number | null)[] = [];
    const pickedSources: Array<"oldSelections" | "firstNonEmpty" | "fallback"> =
      [];

    for (let b = 0; b < batchCount; b++) {
      const firstImg = b * imagesPerUpload;
      const lastImg = Math.min((b + 1) * imagesPerUpload, uploadedCount);

      let pickedUrl: string | null = null;
      let pickedSource: "oldSelections" | "firstNonEmpty" | "fallback" =
        "fallback";

      // 1) 优先：用户在老 UI 选过的 candIdx 对应的 URL
      //    老 selections 是按 imageIdx 维度存的（每张原图一个 candIdx），
      //    命中 candidates[imageIdx][selections[imageIdx]] 即为 user 看过的图
      for (let i = firstImg; i < lastImg; i++) {
        const candIdx = oldSelections?.[i];
        if (
          typeof candIdx === "number" &&
          Array.isArray(oldCandidates[i]) &&
          typeof oldCandidates[i][candIdx] === "string" &&
          oldCandidates[i][candIdx]
        ) {
          pickedUrl = oldCandidates[i][candIdx];
          pickedSource = "oldSelections";
          break;
        }
      }

      // 2) 兜底：selectedIndex 是 order 级的「第一个锁定的 imageIdx」
      //    老 code 写 selectedIndex 时把它当 imageIdx 用，不是 candIdx。
      //    例如 fW3rCE1fsH3ph0bRBY0kj：selectedIndex=1 → user 选的是
      //    candidates[1][0]，不是 candidates[0][1]（后者不存在）。
      //    这一步只对 SELECTED 状态有意义；其他状态 selectedIndex 通常是 null
      if (
        !pickedUrl &&
        typeof row.selectedIndex === "number" &&
        row.selectedIndex >= firstImg &&
        row.selectedIndex < lastImg
      ) {
        const idx = row.selectedIndex;
        if (
          Array.isArray(oldCandidates[idx]) &&
          typeof oldCandidates[idx][0] === "string" &&
          oldCandidates[idx][0]
        ) {
          pickedUrl = oldCandidates[idx][0];
          pickedSource = "firstNonEmpty"; // 借用 source 名（语义就是第一张）
        }
      }

      // 3) 兜底：本批内第一张非空 URL
      if (!pickedUrl) {
        for (let i = firstImg; i < lastImg; i++) {
          if (Array.isArray(oldCandidates[i]) && oldCandidates[i][0]) {
            pickedUrl = oldCandidates[i][0];
            pickedSource = "firstNonEmpty";
            break;
          }
        }
      }

      // 3) 全空：本批没有 URL（极少见）
      if (!pickedUrl) {
        pickedSource = "fallback";
      }

      newCandidates.push(pickedUrl ? [pickedUrl] : []);
      newSelections.push(pickedUrl ? 0 : null);
      pickedSources.push(pickedSource);
    }

    // selectedIndex：新格式下 = 第一个 locked batch 的 candIdx (= 0)
    let newSelectedIndex: number | null = null;
    if (row.status === "SELECTED" && newSelections[0] === 0) {
      newSelectedIndex = 0;
    }

    plans.push({
      id: row.id,
      token: row.token,
      status: row.status,
      uploadedCount,
      imagesPerUpload,
      batchCount,
      oldCandidatesLen: oldCandidates.length,
      oldSelectionsLen: oldSelections?.length ?? "NULL",
      newCandidates,
      newSelections,
      newSelectedIndex,
      pickedSource: pickedSources[0] ?? "fallback",
    });
  }

  console.log(
    `\n📊 扫描完成：${plans.length} 个订单需要迁移，${skipped.length} 个跳过\n`
  );

  if (plans.length === 0) {
    console.log("✅ 没有需要修复的订单");
    return;
  }

  // 详细打印每个 plan
  for (const plan of plans) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔧 [${plan.status}] id=${plan.id}`);
    console.log(`   token=${plan.token.slice(0, 12)}…`);
    console.log(
      `   uploaded=${plan.uploadedCount}, ipu=${plan.imagesPerUpload}, batchCount=${plan.batchCount}`
    );
    console.log(
      `   oldCandidates.len=${plan.oldCandidatesLen}, oldSelections.len=${plan.oldSelectionsLen}`
    );
    console.log(`   pickedSource=${plan.pickedSource}`);
    console.log(`   newCandidates=${JSON.stringify(plan.newCandidates)}`);
    console.log(`   newSelections=${JSON.stringify(plan.newSelections)}`);
    console.log(`   newSelectedIndex=${plan.newSelectedIndex}`);
  }

  if (dryRun) {
    console.log(`\n🔍 [DRY RUN] 完成 — 上面是迁移计划。加 --run 参数实际执行`);
    console.log(
      `   pnpm tsx scripts/migrate-old-per-image-candidates.ts --run`
    );
    return;
  }

  // 实际写库
  console.log(`\n🚨 开始写库...`);
  const idsToUpdate = plans.map((p) => p.id);
  let successCount = 0;
  for (const plan of plans) {
    const selectionsJson = plan.newSelections.some((v) => v !== null)
      ? JSON.stringify(plan.newSelections)
      : null;
    await db
      .update(promptOrder)
      .set({
        candidates: JSON.stringify(plan.newCandidates),
        selections: selectionsJson,
        selectedIndex: plan.newSelectedIndex,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, plan.id));
    successCount++;
    console.log(`   ✅ ${plan.id.slice(0, 12)}… → migrated`);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ 完成：迁移 ${successCount} 个订单`);
  // 同时也输出 inArray 形式供后续审计用
  void idsToUpdate;
  void inArray;
}

run().catch((err) => {
  console.error("💥 脚本失败：", err);
  process.exit(1);
});
