#!/usr/bin/env -S npx tsx

/**
 * 2026-09-14：preview_share 默认值错误修复
 *
 * 历史 migration 0040 把 images_per_upload 默认设成 3、upload_count 设成 0，
 * 导致 totalCapacity=0 → UploadStep quotaFull=true 误显示「本订单已完成」。
 *
 * preview 流硬编码单批单图（imagesPerUpload=1, uploadCount=1）。
 *
 * 修复范围：
 *   1. DB 默认值：schema.ts + migration 0040 都改成 1（防新行）
 *   2. INSERT 显式：create-preview-share.ts 写 imagesPerUpload:1, uploadCount:1
 *   3. 投影兜底：projectPreviewToOrderView 用 Math.max(1, ...) 修历史脏行
 *   4. **本脚本**：一键 UPDATE 历史脏行
 *
 * 用法：
 *   pnpm tsx scripts/fix-preview-share-defaults.ts
 *
 * 安全：
 *   - 条件 `images_per_upload = 3 OR upload_count = 0` 精确命中历史默认值
 *   - preview 流单批单图 → UPDATE 到 1 永远正确
 *   - 重复跑安全（UPDATE 1 → 1 无副作用）
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[fix-preview-share-defaults] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // 1. 看下有多少行会被 UPDATE（命中旧默认值 3 或 0）
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM preview_share
       WHERE images_per_upload = 3 OR upload_count = 0;`
    );
    const dirtyRows = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);
    console.log(
      `[fix-preview-share-defaults] 发现 ${dirtyRows} 行 preview_share 命中旧默认值（images_per_upload=3 或 upload_count=0）`
    );

    if (dirtyRows === 0) {
      console.log("[fix-preview-share-defaults] 无脏行，无需 UPDATE");
      return;
    }

    // 2. UPDATE 到正确值（preview 流硬编码单批单图）
    const updateResult = await client.query<{ id: string; order_no: string }>(
      `UPDATE preview_share
       SET images_per_upload = 1, upload_count = 1
       WHERE images_per_upload = 3 OR upload_count = 0
       RETURNING id, order_no;`
    );

    console.log(
      `[fix-preview-share-defaults] ✓ 已修复 ${updateResult.rowCount} 行`
    );
    for (const row of updateResult.rows) {
      console.log(`    - ${row.order_no} (id=${row.id})`);
    }

    // 3. 顺手打印修复后的样本（前 5 行）
    const sample = await client.query(
      `SELECT order_no, status, upload_count, images_per_upload
       FROM preview_share
       ORDER BY created_at DESC
       LIMIT 5;`
    );
    console.log(
      "\n[fix-preview-share-defaults] 最近 5 行 preview_share 状态："
    );
    for (const row of sample.rows) {
      console.log(
        `    ${row.order_no} status=${row.status} uploadCount=${row.upload_count} imagesPerUpload=${row.images_per_upload}`
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[fix-preview-share-defaults] 失败", err);
  process.exit(1);
});
