import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PRODUCT_ACCESSORY_VARIANTS } from "@/features/gpt-image/lib/product-accessory-variants";

/**
 * `variantCode` 必须**全局唯一**(2026-11-08)
 *
 * ## 为什么
 *
 * 商城按 `acc_${variantCode}` 查配件加价 —— `mock-catalog.ts` 的
 * `findAccessoryVariant()` 就是这么拼的,`price-source.ts` 的 DB 价表也是
 * 这么拼键的。
 *
 * DB 的唯一索引是 `(product_type_code, accessory_code, variant_code)` ——
 * 只保证**型号内**唯一。**同一个 `variantCode` 挂在两个型号下**时,
 * 商城按 `acc_<variantCode>` 查就「取到哪个算哪个」:同一个配件,
 * 在钥匙扣上是 ¥8、在手办上是 ¥30,商城显示哪个看 DB 返回的顺序。
 *
 * ⇒ 商城那条路上 `variantCode` 必须是**全局唯一**的。
 *
 * 这个不变式**今天成立**(19 行,零重复),但它是**约定**,不是数据库约束 ——
 * 哪天有人加了一行,只靠「加的时候记得看一眼」是守不住的。
 *
 * ## 这里守两件事
 *
 * 1. **代码字典**里 `variantCode` 零重复(现在的事实)
 * 2. **DB 里出现重复时,商城不猜** —— `price-source.ts` 要把那一行**踢出
 *    价表**(退回代码常量)并打一条 error 日志,而不是「取到哪个算哪个」
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("配件变体的 `variantCode` 全局唯一", () => {
  it("代码字典里零重复", () => {
    const seen = new Map<string, string[]>();
    for (const v of PRODUCT_ACCESSORY_VARIANTS) {
      const list = seen.get(v.variantCode) ?? [];
      list.push(v.productTypeCode);
      seen.set(v.variantCode, list);
    }

    const duplicates = [...seen.entries()]
      .filter(([, codes]) => codes.length > 1)
      .map(([code, codes]) => `${code} 挂在 ${codes.join(" / ")} 上`);

    expect(duplicates).toEqual([]);
  });

  it("字典里每一行都有型号、配件码、变体码 —— 拼键少一样就查不到", () => {
    for (const v of PRODUCT_ACCESSORY_VARIANTS) {
      expect(v.productTypeCode, v.variantCode).toBeTruthy();
      expect(v.accessoryCode, v.variantCode).toBeTruthy();
      expect(v.variantCode, v.variantCode).toBeTruthy();
    }
  });
});

describe("DB 里出现重复时 —— 商城不猜", () => {
  it("`price-source.ts` 按 `acc_<variantCode>` 拼键", () => {
    const code = read("src/features/storefront/lib/price-source.ts");

    // 用模板字面量写 —— 那串本身就是一个模板字面量(反引号 + `${}`)
    expect(code).toContain(`const key = \`acc_\${row.variantCode}\``);
  });

  it("同一个 `variantCode` 出现两次 → 那一行**踢出价表** + 打 error 日志", () => {
    const code = read("src/features/storefront/lib/price-source.ts");

    // 标记「这个键有歧义」
    expect(code).toContain("const ambiguous = new Set<string>()");
    // 踢出价表
    expect(code).toContain("accessoryDeltaCentsByVariantId.delete(key)");
    // 喊出来
    expect(code).toContain("console.error");
  });
});

/* ========================================================================== */
/*  后台不许加出重复的 variantCode(2026-11-14)                                  */
/* ========================================================================== */

/**
 * 2026-11-14:后台能自由加配件变体了 ⇒ 「加的时候记得看一眼」守不住了
 *
 * 之前那是**约定**(代码字典里零重复);现在后台能加行 ⇒ 必须有**闸**。
 *
 * 三道:
 *
 * 1. **action 里查一次全局重复** —— `findConflictingVariantCode()` 按
 *    `variantCode` **全局**查(不带型号),撞了就返 `VARIANT_CODE_DUPLICATED`。
 * 2. **DB 兜底** —— 迁移给 `variant_code` 加了**全局唯一索引**
 *    (`pav_variant_code_uniq_idx`);action 里那条漏了的话,PG 报 `23505`,
 *    `isUniqueViolation()` 认出来,一样返那个码。
 * 3. **迁移脚本先查重复** —— 有重复就**打印 + 中止**,不硬加索引
 *    (硬加会失败,而「失败」比「中止 + 说清楚哪几行重复」难查得多)。
 */
describe("后台加配件变体 —— 重复的 `variantCode` 当场拒", () => {
  const ADMIN = "src/features/image-gen/lib/catalog-dictionary-admin.ts";
  const ACTIONS = "src/features/image-gen/admin/actions.ts";
  const MIGRATION = "scripts/apply-catalog-dictionary-schema.ts";

  it("① 查重复时**不带型号** —— 全局查", () => {
    const code = read(ADMIN);

    // 函数在
    expect(code).toContain("export async function findConflictingVariantCode(");

    // where 只按 variantCode —— 没有型号、没有配件
    expect(code).toContain(
      ".where(eq(productAccessoryVariant.variantCode, variantCode));"
    );
  });

  it("② 同一个(型号, 配件)下不算撞车 —— 那是 DB 唯一索引管的事", () => {
    const code = read(ADMIN);

    // 同一个 (型号, 配件) ⇒ continue(不报冲突)
    expect(code).toContain("row.productTypeCode === productTypeCode &&");
    expect(code).toContain("row.accessoryCode === accessoryCode");
    expect(code).toContain("continue;");
  });

  it("③ 改行时**排除自己** —— 不然改一次就撞自己", () => {
    const code = read(ADMIN);
    expect(code).toContain("if (excludeRowId && row.id === excludeRowId) continue;");
  });

  it("④ action 撞上了就返精确的码 —— 不是笼统的「保存失败」", () => {
    const code = read(ACTIONS);

    expect(code).toContain("const conflict = await findConflictingVariantCode(");
    expect(code).toContain('if (conflict.conflict) {');
    expect(code).toContain('return catalogFailure("VARIANT_CODE_DUPLICATED");');
  });

  it("⑤ DB 唯一索引撞了也一样是那个码(PG 23505 兜底)", () => {
    const code = read(ACTIONS);

    // 认得出 PG 的唯一冲突
    expect(code).toContain("function isUniqueViolation(error: unknown): boolean");
    expect(code).toContain('if (code === "23505") return true;');
    // 认出来了就返同一个码
    expect(code).toContain(
      'if (isUniqueViolation(error)) {\n          return catalogFailure("VARIANT_CODE_DUPLICATED");'
    );
  });

  it("⑥ 迁移给 `variant_code` 加了**全局唯一索引**", () => {
    const code = read(MIGRATION);
    expect(code).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "pav_variant_code_uniq_idx"'
    );
    expect(code).toContain('ON "product_accessory_variant" ("variant_code");');
  });

  it("⑦ 迁移先查重复 —— 有重复就中止,不硬加索引", () => {
    const code = read(MIGRATION);

    // 查重复的 SQL
    expect(code).toContain("HAVING count(*) > 1");

    // **顺序**:查重复在建表建索引**之前**
    // (dry-run 那段也有一处 `for (const statement of STATEMENTS)` ⇒ 从查重复
    //  之后开始找,别把 dry-run 那处当成了建表那一处)
    const dupCheckAt = code.indexOf("HAVING count(*) > 1");
    const loopAt = code.indexOf(
      "for (const statement of STATEMENTS)",
      dupCheckAt
    );
    expect(dupCheckAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(-1);
    expect(dupCheckAt).toBeLessThan(loopAt);

    // 查到重复 ⇒ 中止
    expect(code).toContain("if (dupCheck.rows.length > 0) {");
    expect(code).toContain("process.exit(1);");

    // 中止时说清楚「索引没建」—— 重跑是安全的
    expect(code).toContain("全局唯一索引**没有建**");
  });

  it("⑧ `VARIANT_CODE_DUPLICATED` 两种语言都摆得上话", () => {
    for (const locale of ["zh", "en"] as const) {
      const messages = JSON.parse(
        read(`messages/${locale}.json`)
      ) as Record<string, unknown>;
      const ns = messages.AdminCatalog as Record<string, unknown>;
      const errors = ns.errors as Record<string, unknown>;
      expect(errors.VARIANT_CODE_DUPLICATED, locale).toBeTruthy();
    }
  });
});
