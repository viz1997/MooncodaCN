/**
 * 2026-09-12：列出 product_effect 表里 prompt_template_id IS NULL 的行
 *
 * 为什么：
 *   submit-image-gen-demo.ts 第 111 行用 maskId（=productEffect.id）查 prompt_template 表。
 *   admin 手工录入 productEffect 时若没绑 promptTemplateId，/image-gen demo 下单会撞
 *   「模板不存在或已停用」。
 *
 *   跑这个脚本看清单，逐个到 /admin/product-effects/<id> 编辑页绑一个 promptTemplate。
 *   （2026-09-12 已把 admin 表单改为强制必填；存量靠手工补完。）
 *
 * 用法：
 *   pnpm tsx scripts/list-effects-without-template.ts
 */

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL 未设置");

const isRemote =
  databaseUrl.includes("neon.tech") || databaseUrl.includes("supabase");
const finalUrl = databaseUrl
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace(/[?&]ssl=[^&]*/g, "")
  .replace(/[?&]uselibpqcompat=[^&]*/g, "");

async function main() {
  const client = new Client({
    connectionString: finalUrl,
    ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    // 顺手拉一下 prompt_template 表的 id + name，让 admin 知道有哪些模板可选
    const tmpls = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM prompt_template WHERE is_active = true ORDER BY id`
    );
    if (tmpls.rows.length === 0) {
      console.log(
        "⚠️  prompt_template 表没有任何 active 行 —— 先去 /admin/templates 创建提示词模板，再来绑 product_effect.prompt_template_id"
      );
      return;
    }

    const res = await client.query<{
      id: string;
      name: string;
      status: string;
      author: string;
      product_type_code: string | null;
    }>(
      `SELECT id, name, status, author, product_type_code
       FROM product_effect
       WHERE prompt_template_id IS NULL OR prompt_template_id = ''
       ORDER BY created_at ASC`
    );

    if (res.rows.length === 0) {
      console.log("✅ product_effect 全部已绑 prompt_template_id，无需补");
      return;
    }

    console.log(
      `❌ ${res.rows.length} 行 product_effect 未绑 prompt_template_id（按 created_at 升序）：\n`
    );
    console.table(
      res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        productType: r.product_type_code ?? "(空)",
        author: r.author,
        action: `→ /admin/product-effects/${r.id} 编辑补一个`,
      }))
    );

    console.log(`\n可选 prompt_template 列表（active）：`);
    console.table(tmpls.rows);

    console.log(`\n补法（任选其一）：`);
    console.log(`  1) 浏览器进 /admin/product-effects/<id> 编辑页，选一个 promptTemplate 提交`);
    console.log(
      `  2) 直接 SQL：UPDATE product_effect SET prompt_template_id = '<选中的id>' WHERE id = '<待补的id>';`
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[list] 失败：", e);
  process.exit(1);
});