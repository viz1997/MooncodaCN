/**
 * 一次性同步脚本：把 prompt_template 表 active 行拷到 product_effect
 *
 * 2026-09-09：/image-gen 公开 demo 用 productEffect 表作为数据源；
 * 现在 productEffect 是空表，promptTemplate 有 6 行 active。
 * 手动跑一次同步，让 /image-gen 的「选择效果」能展示模板。
 *
 * 设计原则：
 * - 单向同步（promptTemplate → productEffect），不反向
 * - 幂等：onConflictDoNothing + 仅补 status='active' 的源
 * - 仅迁移字段对应的部分；business metadata（usageCount / successRate / author）
 *   落默认值，后续 admin UI 可在 productEffect 单独编辑
 *
 * 用法：
 *   pnpm tsx scripts/sync-prompt-templates-to-effects.ts
 * 或带 --dry-run 预览
 *
 * 注意：必须用 dynamic import 加载 @/db，因为 @/db/index.ts 在模块加载时
 * 立即校验 DATABASE_URL，static import 会被 tsx hoisting 提前到 loadEnv 之前。
 */

import { config as loadEnv } from "dotenv";
import { eq, sql } from "drizzle-orm";

// 与 scripts/apply-*.ts 一致：先 .env.local 再 .env，前者覆盖后者
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 未设置 —— 检查 .env.local");
}

const SOURCE_AUTHOR = "sync-from-promptTemplate";
const isDryRun = process.argv.includes("--dry-run");

async function main() {
  // dynamic import 在 loadEnv 之后才执行 @/db 的 env check
  const { db } = await import("@/db");
  const { productEffect, promptTemplate } = await import("@/db/schema");

  console.log("[sync] 读取 prompt_template 表 active 行...");
  const sources = await db
    .select({
      id: promptTemplate.id,
      name: promptTemplate.name,
      description: promptTemplate.description,
      prompt: promptTemplate.prompt,
      variables: promptTemplate.variables,
      model: promptTemplate.model,
      price: promptTemplate.price,
      size: promptTemplate.size,
      candidateCount: promptTemplate.candidateCount,
      coverUrl: promptTemplate.coverUrl,
      productTypeCode: promptTemplate.productTypeCode,
      price: promptTemplate.price,
    })
    .from(promptTemplate)
    .where(eq(promptTemplate.isActive, true));

  console.log(`[sync] 找到 ${sources.length} 行 active 模板`);

  if (sources.length === 0) {
    console.log("[sync] 无可同步数据，退出");
    return;
  }

  // previewUrl 是 NOT NULL，没封面图时落空字符串（前端用 gradient 兜底）
  const values = sources.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.productTypeCode ? `产品-${s.productTypeCode}` : "通用",
    description: s.description,
    previewUrl: s.coverUrl ?? "",
    prompt: s.prompt,
    variables: s.variables,
    // productEffect.model 是 NOT NULL；promptTemplate.model 可空，默认 doubao
    model: s.model ?? "doubao",
    config: { style: "custom" as const },
    scene: "generate_2d" as const,
    versions: [],
    price: s.price,
    status: "active" as const,
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    author: SOURCE_AUTHOR,
    productLineIds: [],
    // 2026-09-09：透传 productTypeCode 给 /image-gen 工作台渲染 SpecStep
    productTypeCode: s.productTypeCode ?? null,
  }));

  if (isDryRun) {
    console.log("[sync] --dry-run 模式，不写库。下面是预览：");
    for (const v of values) {
      console.log(
        `  - ${v.id} | ${v.name} | model=${v.model} | category=${v.category} | ${v.previewUrl ? "有封面" : "无封面"}`,
      );
    }
    return;
  }

  console.log(`[sync] 开始写入 product_effect...`);
  const inserted = await db
    .insert(productEffect)
    .values(values)
    .onConflictDoNothing({ target: productEffect.id })
    .returning({ id: productEffect.id });

  console.log(
    `[sync] 实际新增 ${inserted.length} 行（剩余 ${sources.length - inserted.length} 行因 id 冲突跳过）`,
  );

  // 统计最终状态
  const stats = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status='active')::int`,
      fromSync: sql<number>`count(*) filter (where author=${SOURCE_AUTHOR})::int`,
    })
    .from(productEffect);
  const s = stats[0];
  if (s) {
    console.log(
      `[sync] product_effect 当前：total=${s.total}, active=${s.active}, sync-from-promptTemplate=${s.fromSync}`,
    );
  }

  // category 分布
  const byCategory = await db
    .select({
      category: productEffect.category,
      cnt: sql<number>`count(*)::int`,
    })
    .from(productEffect)
    .groupBy(productEffect.category);
  console.log("[sync] category 分布：");
  for (const row of byCategory) {
    console.log(`  ${row.category}: ${row.cnt}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[sync] 失败:", err);
    process.exit(1);
  });
