/* 一次性验证脚本 —— 确认 0044 migration 已落库 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[verify] 缺少 DATABASE_URL");
    process.exit(1);
  }
  const { Client } = await import("pg");
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const tables = await c.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('external_api_key','canvas_remote_job')
     ORDER BY table_name`
  );
  console.log("tables:", tables.rows);
  const enums = await c.query<{ typname: string; values: string[] }>(
    `SELECT t.typname,
            array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN (
        'external_api_key_status',
        'canvas_remote_job_status',
        'canvas_remote_capability'
      )
      GROUP BY t.typname
      ORDER BY t.typname`
  );
  console.log("enums:", enums.rows);
  const expected = {
    canvas_remote_capability: [
      "image",
      "video",
      "audio",
      "text",
      "image-to-3d",
      "multi-image-to-3d",
    ],
    canvas_remote_job_status: ["pending", "processing", "completed", "failed"],
    external_api_key_status: ["active", "disabled"],
  };
  for (const row of enums.rows) {
    const want = expected[row.typname as keyof typeof expected];
    // pg 把 text[] 序列化成 "{a,b,c}" 字符串，需要剥括号
    const haveStr =
      typeof row.values === "string"
        ? row.values.replace(/^\{|\}$/g, "")
        : Array.isArray(row.values)
          ? row.values.join(",")
          : String(row.values);
    const have = haveStr ? haveStr.split(",") : [];
    const missing = want.filter((v) => !have.includes(v));
    if (missing.length > 0) {
      console.warn(
        `[verify] ⚠ ${row.typname} 缺值：${missing.join(", ")}（当前：${have.join(",")}）`
      );
    } else {
      console.log(`[verify] ✓ ${row.typname} 完整：${have.join(",")}`);
    }
  }
  await c.end();
}

main().catch((err) => {
  console.error("[verify] 未处理错误：", err);
  process.exit(1);
});
