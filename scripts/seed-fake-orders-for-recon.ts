#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：dev 假数据 —— seed 几条 fake promptOrder 让对账脚本输出非空。
 *
 * 只用于本地开发 / inspect 脚本自检。prod 千万**不要**跑。
 *
 * 模拟 3 个用户 × 3 个模板 × 不同规格组合，总扣积分 = basePrice + Σ(delta)，
 * 让 scripts/inspect-order-credit-breakdown.ts 输出非空，验证 5 段 SQL 都正确。
 *
 * 用法：
 *   pnpm tsx scripts/seed-fake-orders-for-recon.ts
 *
 * 幂等：清掉 description LIKE 'FAKE-RECON-%' 的订单，避免重复堆积。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";
import { customAlphabet } from "nanoid";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  21
);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed-fake] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 先清掉历史 fake 订单（按 description 前缀识别）
  await client.query(`DELETE FROM prompt_order WHERE order_no LIKE 'FAKE-%'`);
  console.log("[seed-fake] 已清掉历史 fake 订单");

  // 找 user（任意 user，取第一个）
  const userRes = await client.query<{ id: string }>(
    `SELECT id FROM "user" LIMIT 1`
  );
  if (userRes.rows.length === 0) {
    console.error("[seed-fake] 没找到任何 user，跳过");
    await client.end();
    process.exit(0);
  }
  const userId = userRes.rows[0]?.id ?? "";
  console.log(`[seed-fake] 用 user ${userId} 作为 createdBy`);

  // 找 3 个模板（dev 可能有 productTypeCode=NULL 也 OK，seed 不强求）
  const tmplRes = await client.query<{
    id: string;
    name: string;
    price: number;
    product_type_code: string | null;
  }>(
    `SELECT id, name, price, product_type_code FROM prompt_template
     WHERE price > 0
     ORDER BY price LIMIT 3`
  );
  if (tmplRes.rows.length === 0) {
    console.error("[seed-fake] 没有 prompt_template 模板，跳过");
    await client.end();
    process.exit(0);
  }
  // 不足 3 个就循环复用（dev 数据稀疏常见）
  while (tmplRes.rows.length < 3) {
    tmplRes.rows.push(tmplRes.rows[0]!);
  }
  const tmpls = tmplRes.rows;
  console.log(
    `[seed-fake] 用 3 模板：` +
      tmpls.map((t) => `${t.id} (${t.price})`).join(" / ")
  );

  // 模拟 6 单（每模板 2 单：4cm vs 6cm）
  const fakeOrders = [
    {
      tmpl: tmpls[0],
      productSize: "4",
      accessory: "leather",
      leatherColor: null,
      leatherExposed: null,
      pvcProtection: null,
      breakdown: [{ specKey: "accessory:leather", label: "皮套 +20", delta: 20 }],
    },
    {
      tmpl: tmpls[0],
      productSize: "6",
      accessory: "leather",
      leatherColor: null,
      leatherExposed: null,
      pvcProtection: null,
      breakdown: [
        { specKey: "size:6", label: "6cm +30", delta: 30 },
        { specKey: "accessory:leather", label: "皮套 +20", delta: 20 },
      ],
    },
    {
      tmpl: tmpls[1],
      productSize: "4",
      accessory: null,
      leatherColor: "brown",
      leatherExposed: true,
      pvcProtection: null,
      breakdown: [
        { specKey: "leather_color:brown", label: "棕色 +0", delta: 0 },
        { specKey: "protection:exposed", label: "实物外露 +15", delta: 15 },
      ],
    },
    {
      tmpl: tmpls[1],
      productSize: "6",
      accessory: null,
      leatherColor: "black",
      leatherExposed: null,
      pvcProtection: true,
      breakdown: [
        { specKey: "size:6", label: "6cm +30", delta: 30 },
        { specKey: "leather_color:black", label: "黑色 +15", delta: 15 },
        { specKey: "protection:pvc", label: "PVC 保护 +10", delta: 10 },
      ],
    },
    {
      tmpl: tmpls[2],
      productSize: "8",
      accessory: null,
      leatherColor: null,
      leatherExposed: null,
      pvcProtection: null,
      breakdown: [{ specKey: "size:8", label: "8cm +20", delta: 20 }],
    },
    {
      tmpl: tmpls[2],
      productSize: "11",
      accessory: null,
      leatherColor: null,
      leatherExposed: null,
      pvcProtection: null,
      breakdown: [{ specKey: "size:11", label: "11cm +50", delta: 50 }],
    },
  ];

  for (const o of fakeOrders) {
    const breakdownJson = JSON.stringify(o.breakdown);
    const totalCredits =
      (o.tmpl?.price ?? 0) +
      o.breakdown.reduce((sum, b) => sum + b.delta, 0);
    const orderNo = `FAKE-${nanoid(8).toUpperCase()}`;
    await client.query(
      `INSERT INTO prompt_order
         (id, order_no, template_id, token, status,
          uploaded_images, upload_count, images_per_upload, regenerate_limit,
          product_type_code, product_size, accessory_code,
          leather_color, leather_exposed, pvc_protection,
          credits_charged, credits_breakdown,
          created_by, agent_id, created_at, updated_at,
          selected_at)
       VALUES ($1, $2, $3, $4, 'SELECTED',
         '[]', 1, 3, 5,
         $5, $6, $7,
         $8, $9, $10,
         $11, $12,
         $13, NULL, now(), now(),
         now())`,
      [
        nanoid(),
        orderNo,
        o.tmpl?.id ?? "",
        nanoid(32),
        o.tmpl?.product_type_code ?? null,
        o.productSize,
        o.accessory,
        o.leatherColor,
        o.leatherExposed,
        o.pvcProtection,
        totalCredits,
        breakdownJson,
        userId,
      ]
    );
    console.log(
      `[seed-fake] ${orderNo} ${o.tmpl?.id} ${o.productSize}cm → ${totalCredits} 积分`
    );
  }

  console.log(
    `\n[seed-fake] 完成。现在跑 pnpm tsx scripts/inspect-order-credit-breakdown.ts 看非空输出`
  );

  await client.end();
}

main().catch((err) => {
  console.error("[seed-fake] 失败：", err);
  process.exit(1);
});