#!/usr/bin/env -S npx tsx

/**
 * 同步商品目录到 Sellbase（2026-11-04）
 *
 * ## 这个脚本干什么
 *
 * 本仓库是**目录与定价的真理源**,Sellbase 那边只负责收钱。所以这个脚本把
 * 本仓库的 `product` / `product_variant` 推成 Sellbase 的 product / variant,
 * 并把 Sellbase 生成的 variant id 回填到 `product_variant.sellbase_variant_id`
 * —— 建单时每一行商品都要填一个合法的 `variant_id`,那列就是「本地 SKU →
 * Sellbase 变体」的映射。
 *
 * **真正的价格永远是 `items[].unit_price_amount`**(本仓库算的),Sellbase
 * 目录里的价格只是给工作室看的一个参考值。
 *
 * ## 跑法
 *
 * ```bash
 * pnpm tsx scripts/sync-sellbase-catalog.ts            # 干跑,只报告
 * pnpm tsx scripts/sync-sellbase-catalog.ts --apply    # 真同步
 * ```
 *
 * 默认干跑 —— 同步会写 Sellbase 那边,先看一眼要写什么再动手。
 *
 * ## 幂等
 *
 * - 商品按 `metadata.mooncoda_product_code` 认(不是按标题 —— 标题会被改)
 * - 变体按 **sku** 认;已有 id 的直接传 id,Sellbase 那边就是「更新」而不是
 *   「新建」
 * - 本地 `isActive = false` 的 SKU **不进**变体列表 —— Sellbase 会把没出现的
 *   变体归档,正好对上「下架」
 *
 * ## 两条硬断言
 *
 * 1. **币种必须是 cny** —— 本仓库的金额单位是「人民币分」,跟 CNY 的最小单位
 *    1:1。币种不是 CNY 时本仓库算出来的分跟 Sellbase 收的钱不是一个数。
 * 2. **税率必须是 0** —— Sellbase 的税会加到 `total_amount` 上,加了税就跟
 *    本仓库的报价对不上(结算页显示的价 ≠ 收的价)。
 *
 * 断言不通过就直接退出,不自动改 Sellbase 的店铺设置 —— 改店铺设置是人的决定。
 *
 * ## 环境变量
 *
 * `SELLBASE_URL` + `SELLBASE_API_TOKEN`(admin token,需要 `catalog:write`)。
 * 详见 `src/features/sellbase/lib/env.ts` 的文件头。
 */

import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import "./lib/load-env";
import { db } from "@/db";
import { product, productVariant } from "@/db/schema";
import {
  PRINT_SERVICE_PRODUCT_CODE,
  PRINT_SERVICE_SKU,
} from "@/features/sellbase/lib/carrier";
import { callSellbase, getSellbaseAdmin } from "@/features/sellbase/lib/client";
import { getSellbaseConfig } from "@/features/sellbase/lib/env";

/** 干跑还是真跑 */
const APPLY = process.argv.includes("--apply");

/** Sellbase 变体列表一次拉多少 */
const PAGE_SIZE = 100;

/** 打印服务载体商品的标题 / slug —— 固定文案,后台好认 */
const PRINT_SERVICE_TITLE = "打印服务(按克重)";
const PRINT_SERVICE_SLUG = "print-service";

/** 本仓库商品在 Sellbase metadata 里的标记键 */
const META_KEY = "mooncoda_product_code";

/* -------------------------------------------------------------------------- */
/*  本地数据                                                                  */
/* -------------------------------------------------------------------------- */

interface LocalVariant {
  id: string;
  productCode: string;
  sku: string;
  sizeCode: string;
  accessoryCode: string;
  variantCode: string;
  priceCents: number;
  isActive: boolean;
  sellbaseVariantId: string | null;
}

interface LocalProduct {
  code: string;
  name: string;
  nameEn: string;
  category: string;
  description: string;
  status: "active" | "inactive";
}

/* -------------------------------------------------------------------------- */
/*  Sellbase 侧类型                                                            */
/* -------------------------------------------------------------------------- */

interface SellbaseVariant {
  id: string;
  sku: string | null;
  title: string;
  option_values: Record<string, string>;
  price_amount: number;
  status: "draft" | "active" | "archived";
}

interface SellbaseProduct {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "active" | "archived";
  metadata: Record<string, unknown>;
  variants: SellbaseVariant[];
}

/* -------------------------------------------------------------------------- */
/*  主流程                                                                    */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const config = getSellbaseConfig();
  const client = getSellbaseAdmin();

  console.log(
    `[sync] ${APPLY ? "真同步" : "干跑(加 --apply 才写)"} · ${config.url}`
  );

  // ── 1. 读店铺设置 + 两条硬断言 ────────────────────────────────────────
  const store = await callSellbase(() => client.request("storeGet", {}));

  const storeCurrency = store.default_currency.toLowerCase();
  if (storeCurrency !== "cny") {
    throw new Error(
      `Sellbase 店铺币种是 ${store.default_currency},不是 CNY —— 本仓库的金额单位是「人民币分」,` +
        `跟 CNY 的最小单位 1:1 对应。换成别的币种请先改本仓库的定价口径。`
    );
  }

  const rateBps = store.settings?.tax?.rate_bps ?? 0;
  if (rateBps !== 0) {
    throw new Error(
      `Sellbase 店铺税率是 ${rateBps / 100}%(不是 0)—— 税会加到订单的 total_amount 上,` +
        `跟本仓库的报价对不上。请在 Sellbase 后台把税率改成 0 再跑。`
    );
  }
  console.log(`[sync] 店铺:币种 ${storeCurrency} · 税率 0 ✓`);

  // ── 2. 读本地目录 ─────────────────────────────────────────────────────
  const localProducts = (await db
    .select()
    .from(product)
    .orderBy(asc(product.sortOrder), asc(product.code))) as LocalProduct[];

  const localVariants = (await db
    .select()
    .from(productVariant)
    .orderBy(
      asc(productVariant.sortOrder),
      asc(productVariant.sku)
    )) as LocalVariant[];

  // 打印服务载体 —— 本地那一行还没有就建出来
  const printServiceVariant = await ensurePrintServiceRow(localVariants);
  // 只有**新建**的那行才补进列表:库里已有的行本来就在 `localVariants` 里
  // (同一个对象引用),再 push 一次会让 SERVICE 商品发出两条同 SKU 的变体。
  if (printServiceVariant && !localVariants.includes(printServiceVariant)) {
    localVariants.push(printServiceVariant);
  }

  console.log(
    `[sync] 本地:${localProducts.length} 个商品 / ${localVariants.length} 条 SKU`
  );

  // ── 3. 读 Sellbase 现有商品 ───────────────────────────────────────────
  const remoteProducts = await listAllProducts(client);
  const remoteByCode = new Map<string, SellbaseProduct>();
  for (const p of remoteProducts) {
    const code = p.metadata?.[META_KEY];
    if (typeof code === "string" && code) remoteByCode.set(code, p);
  }
  console.log(
    `[sync] Sellbase 现有:${remoteProducts.length} 个商品(` +
      `${remoteByCode.size} 个带本仓库标记)`
  );

  // ── 4. 逐个商品 upsert ────────────────────────────────────────────────
  interface SyncPlan {
    code: string;
    title: string;
    slug: string;
    description: string;
    status: "draft" | "active";
    tags: string[];
    variants: LocalVariant[];
    remoteId: string | null;
  }

  const plans: SyncPlan[] = localProducts.map((p) => ({
    code: p.code,
    title: p.name,
    slug: buildSlug(p.category, p.code),
    description: p.description,
    // 本地 inactive = 对外下线。Sellbase 的 draft 同样不进店面,
    // 但不像 archived 那样把历史订单也判死。
    status: p.status === "active" ? "active" : "draft",
    tags: [p.category],
    variants: localVariants.filter(
      (v) => v.productCode === p.code && v.isActive
    ),
    remoteId: remoteByCode.get(p.code)?.id ?? null,
  }));

  // 打印服务载体商品 —— 本地没有 product 行,Sellbase 那边照样要有一个
  plans.push({
    code: PRINT_SERVICE_PRODUCT_CODE,
    title: PRINT_SERVICE_TITLE,
    slug: PRINT_SERVICE_SLUG,
    description:
      "按克重计价的 3D 打印服务工单载体 —— 价格永远由本仓库算好后覆盖,这里的目录价是 0。",
    status: "active",
    tags: ["service"],
    variants: localVariants.filter(
      (v) => v.productCode === PRINT_SERVICE_PRODUCT_CODE && v.isActive
    ),
    remoteId: remoteByCode.get(PRINT_SERVICE_PRODUCT_CODE)?.id ?? null,
  });

  const writeBack = new Map<string, string>(); // 本地 sku → Sellbase variant id

  for (const plan of plans) {
    if (plan.variants.length === 0) {
      console.log(`[sync] 跳过 ${plan.code}:没有上架的 SKU`);
      continue;
    }

    const body = {
      ...(plan.remoteId ? { id: plan.remoteId } : {}),
      type: "physical" as const,
      title: plan.title,
      slug: plan.slug,
      description: plan.description,
      status: plan.status,
      tags: plan.tags,
      // metadata 是「本地哪个商品」的标记 —— 靠它认出已存在的商品,
      // 不靠标题(标题会被运营改)
      metadata: { [META_KEY]: plan.code },
      options: buildOptions(plan.variants),
      variants: plan.variants.map((v) => ({
        ...(v.sellbaseVariantId ? { id: v.sellbaseVariantId } : {}),
        sku: v.sku,
        title: v.sku,
        option_values: {
          size: v.sizeCode,
          accessory: v.accessoryCode,
          variant: v.variantCode,
        },
        price_amount: v.priceCents,
      })),
    };

    console.log(
      `[sync] ${plan.code}(${plan.title})· ${plan.variants.length} 个变体` +
        `${plan.remoteId ? " · 更新" : " · 新建"}`
    );

    if (!APPLY) continue;

    const result = await callSellbase(() =>
      client.request("productUpsert", {
        body,
        // 幂等键带上 payload 的哈希 —— 同样的内容重试拿缓存结果,
        // 内容变了就换一个新键(不然会拿到旧响应)
        idempotencyKey: buildIdempotencyKey(plan.code, body),
      })
    );

    for (const v of result.variants) {
      if (v.sku) writeBack.set(v.sku, v.id);
    }
  }

  // ── 5. 回填 variant id ────────────────────────────────────────────────
  if (!APPLY) {
    console.log("\n[sync] 干跑结束 —— 没写任何东西。加 --apply 真同步。");
    printPlanSummary(plans, localVariants);
    return;
  }

  let updated = 0;
  for (const [sku, variantId] of writeBack) {
    const row = localVariants.find((v) => v.sku === sku);
    if (!row || row.sellbaseVariantId === variantId) continue;
    await db
      .update(productVariant)
      .set({ sellbaseVariantId: variantId, updatedAt: new Date() })
      .where(eq(productVariant.sku, sku));
    // 内存里的那份也要跟上 —— 否则最后那张对账表还按「回填前」的状态算,
    // 会报「84 条 SKU 还没有变体 id」,而库里明明已经填满了。
    row.sellbaseVariantId = variantId;
    updated += 1;
  }
  console.log(`[sync] 回填 variant id:${updated} 条`);

  console.log("\n[sync] 完成");
  printPlanSummary(plans, localVariants);
}

/* -------------------------------------------------------------------------- */
/*  辅助                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 打印服务载体行 —— 本地 `product_variant` 里那一行
 *
 * 为什么放在 `product_variant` 而不是另开一张表:所有「本地东西 → Sellbase
 * variant id」的映射都收在这一列,建单时只查一处。
 *
 * 刻意**不**给它在 `product` 表建行 —— 那张表是给运营看的真实商品目录,
 * 混进一个「打印服务」会让 `/admin/products` 多一个点不动的条目。
 * 副作用:它会出现在后台的「全部 SKU」列表里(`getAllVariantsFromDb`),
 * 但不在任何商品的 SKU 明细下。
 */
async function ensurePrintServiceRow(
  variants: LocalVariant[]
): Promise<LocalVariant | null> {
  const existing = variants.find(
    (v) =>
      v.productCode === PRINT_SERVICE_PRODUCT_CODE &&
      v.sku === PRINT_SERVICE_SKU
  );
  if (existing) return existing;

  const row = {
    id: nanoid(),
    productCode: PRINT_SERVICE_PRODUCT_CODE,
    sku: PRINT_SERVICE_SKU,
    sizeCode: "N-A",
    accessoryCode: "N-A",
    variantCode: "N-A",
    // 目录价 0 —— 打印服务按克重报价,建单时用 unit_price_amount 覆盖
    priceCents: 0,
    isActive: true,
    sortOrder: 9999,
    sellbaseVariantId: null,
  };

  if (APPLY) {
    await db.insert(productVariant).values(row);
    console.log(`[sync] 新建打印服务载体行(SKU ${PRINT_SERVICE_SKU})`);
  } else {
    console.log(
      `[sync] 打印服务载体行本地不存在,真同步时会新建(SKU ${PRINT_SERVICE_SKU})`
    );
  }

  return row as LocalVariant;
}

/** 列出 Sellbase 全部商品(翻页) */
async function listAllProducts(
  client: ReturnType<typeof getSellbaseAdmin>
): Promise<SellbaseProduct[]> {
  const out: SellbaseProduct[] = [];
  let cursor: string | undefined;

  do {
    const page = await callSellbase(() =>
      client.request("productsList", {
        query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      })
    );
    out.push(...(page.data as unknown as SellbaseProduct[]));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);

  return out;
}

/**
 * 变体选项定义 —— 从实际用到的取值反推
 *
 * 只声明真正用到的选项名和取值(比如某个商品没有配件,就不声明 accessory
 * 那个选项),Sellbase 的店面页会照这个渲染下拉。
 */
function buildOptions(
  variants: LocalVariant[]
): Array<{ name: string; values: string[] }> {
  const dims: Array<[string, (v: LocalVariant) => string]> = [
    ["size", (v) => v.sizeCode],
    ["accessory", (v) => v.accessoryCode],
    ["variant", (v) => v.variantCode],
  ];

  const options: Array<{ name: string; values: string[] }> = [];
  for (const [name, pick] of dims) {
    const values = [...new Set(variants.map(pick))].sort();
    // 全是 "N-A"(这一维没有概念)就不声明这个选项
    if (values.length === 1 && values[0] === "N-A") continue;
    options.push({ name, values });
  }
  return options;
}

/** slug —— `类别-产品码`,小写 */
function buildSlug(category: string, code: string): string {
  return `${category}-${code}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * 幂等键
 *
 * 带上 payload 的哈希:同样的内容重试 → 同一个键 → Sellbase 返回缓存结果;
 * 内容变了 → 新的键 → 真的重新写。
 */
function buildIdempotencyKey(code: string, body: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex")
    .slice(0, 24);
  return `mooncoda-catalog-${code}-${hash}`;
}

/** 干跑时打印一份「哪些 SKU 还没有 Sellbase 变体 id」的对账表 */
function printPlanSummary(
  plans: Array<{ code: string; variants: LocalVariant[] }>,
  localVariants: LocalVariant[]
): void {
  const missing = localVariants.filter(
    (v) =>
      v.isActive &&
      v.productCode !== PRINT_SERVICE_PRODUCT_CODE &&
      !v.sellbaseVariantId
  );
  if (missing.length > 0) {
    console.log(
      `[sync] ${missing.length} 条上架 SKU 还没有 Sellbase 变体 id(真同步后回填)`
    );
  }
  console.log("[sync] 对账表:");
  for (const plan of plans) {
    console.log(`  ${plan.code}: ${plan.variants.length} 个变体`);
  }
}

main().catch((error) => {
  console.error("\n[sync] 失败:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
