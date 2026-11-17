import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { toAdminShowcase } from "@/features/showcase/admin/types";
import {
  isExternalImageRef,
  normalizeImageRef,
  pickLocaleText,
  sortShowcaseRecords,
  toShowcaseCase,
  toShowcaseCases,
} from "@/features/showcase/lib/case-apply";
import type { ShowcaseCaseRecord } from "@/features/showcase/lib/case-types";
import {
  buildShowcaseObjectKey,
  extractShowcaseExtension,
  SHOWCASE_ALLOWED_EXTENSIONS,
  SHOWCASE_OBJECT_PREFIX,
} from "@/features/showcase/lib/upload-key";

/**
 * 「真实案例展示」(2026-11-16)
 *
 * ## 为什么这一层值得单测
 *
 * 工作室要求:**「电商平台需要增加案例来展示我们实际打印的效果」**。
 *
 * 以前前台那两块「真实照片。真实礼物。」喂的是**代码常量**
 * (`wjp-store-data.ts` 的 `WJP_COMMUNITY_POSTS`)—— 那是 Unsplash 的图库
 * 照片 + 编出来的点赞数。摆在「真实」两个字底下比不摆更糟。
 *
 * ⇒ 案例改成后台可维护的 DB 数据(`storefront_case` 表 + `/admin/showcases`),
 *   前台两处读它。这里钉住四类不变式:
 *
 * 1. **前台不再有假数据兜底** —— 没有案例就整段不渲染
 * 2. **图片引用不许进危险协议** —— 那个值最后会进 `<img src>`
 * 3. **排序 / 截断的口径** —— 先排后投影再截(少一条不能空一格)
 * 4. **迁移脚本不播种** —— 跑完线上行为一个字节都不变
 *
 * 纯文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 读一份语言包(仓库惯例:读文件 + JSON.parse,不在测试里 import JSON) */
function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释区别) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 把对象摊平成 `a.b.c` 这样的点分键 —— 比对中英文键集用 */
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return [prefix];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flatten(value, next));
    } else {
      out.push(next);
    }
  }
  return out.sort();
}

/** 造一条 DB 行 */
function record(over: Partial<ShowcaseCaseRecord> = {}): ShowcaseCaseRecord {
  return {
    id: "case_1",
    title: "金毛钥匙扣",
    titleEn: "Golden Retriever Keychain",
    description: "工作室实拍",
    descriptionEn: "Studio shot",
    coverUrl: "showcases/2026-11-16/a.webp",
    beforeImageUrl: null,
    authorName: "工作室实拍",
    productTypeCode: "R",
    productHandle: "keychain-01",
    likes: 12,
    sortOrder: 10,
    isActive: true,
    createdAt: new Date("2026-11-16T00:00:00Z"),
    updatedAt: new Date("2026-11-16T00:00:00Z"),
    ...over,
  };
}

/** 恒等解析器 —— 图片引用原样当地址 */
const identity = (ref: string): string => `https://cdn.example.com/${ref}`;

/* -------------------------------------------------------------------------- */
/*  文案                                                                        */
/* -------------------------------------------------------------------------- */

describe("案例文案 —— 中英两份按 locale 挑", () => {
  it("挑对应语言的那一份", () => {
    expect(pickLocaleText("中文标题", "English title", "zh")).toBe("中文标题");
    expect(pickLocaleText("中文标题", "English title", "en")).toBe(
      "English title"
    );
  });

  it("英文那份空 ⇒ 退回中文(后台不填英文很常见)", () => {
    expect(pickLocaleText("中文标题", "", "en")).toBe("中文标题");
    expect(pickLocaleText("中文标题", null, "en")).toBe("中文标题");
    expect(pickLocaleText("中文标题", "   ", "en")).toBe("中文标题");
  });

  it("中文那份空 ⇒ 退回英文", () => {
    expect(pickLocaleText("", "English title", "zh")).toBe("English title");
    expect(pickLocaleText(null, "English title", "zh")).toBe("English title");
  });

  it("两边都空 ⇒ 空串(前台就不摆那一行)", () => {
    expect(pickLocaleText("", "", "zh")).toBe("");
    expect(pickLocaleText(null, null, "en")).toBe("");
  });

  it("前后空白会被去掉", () => {
    expect(pickLocaleText("  中文标题  ", null, "zh")).toBe("中文标题");
  });
});

/* -------------------------------------------------------------------------- */
/*  图片引用                                                                    */
/* -------------------------------------------------------------------------- */

describe("案例图片引用 —— 归一化 + 挡危险协议", () => {
  it("只认 http / https 是外链", () => {
    expect(isExternalImageRef("https://cdn.example.com/a.webp")).toBe(true);
    expect(isExternalImageRef("http://cdn.example.com/a.webp")).toBe(true);
    expect(isExternalImageRef("showcases/2026-11-16/a.webp")).toBe(false);
    expect(isExternalImageRef("javascript:alert(1)")).toBe(false);
    expect(isExternalImageRef("data:image/png;base64,AAA")).toBe(false);
    expect(isExternalImageRef(null)).toBe(false);
    expect(isExternalImageRef("")).toBe(false);
  });

  it("外链和对象键都收", () => {
    expect(normalizeImageRef("https://cdn.example.com/a.webp")).toBe(
      "https://cdn.example.com/a.webp"
    );
    expect(normalizeImageRef("showcases/2026-11-16/a.webp")).toBe(
      "showcases/2026-11-16/a.webp"
    );
  });

  it("危险协议一律拒(那个值最后会进 <img src>)", () => {
    expect(normalizeImageRef("javascript:alert(1)")).toBeNull();
    expect(normalizeImageRef("JavaScript:alert(1)")).toBeNull();
    expect(normalizeImageRef("data:image/png;base64,AAA")).toBeNull();
    expect(normalizeImageRef("file:///etc/passwd")).toBeNull();
    expect(normalizeImageRef("vbscript:msgbox(1)")).toBeNull();
  });

  it("含 .. 的键拒掉(路径穿越)", () => {
    expect(normalizeImageRef("showcases/../../secret")).toBeNull();
    expect(normalizeImageRef("../other/a.webp")).toBeNull();
  });

  it("空 / 超长拒掉", () => {
    expect(normalizeImageRef("")).toBeNull();
    expect(normalizeImageRef("   ")).toBeNull();
    expect(normalizeImageRef(null)).toBeNull();
    expect(normalizeImageRef(undefined)).toBeNull();
    expect(
      normalizeImageRef(`https://cdn.example.com/${"a".repeat(2100)}`)
    ).toBe(null);
  });

  it("前后空白去掉", () => {
    expect(normalizeImageRef("  showcases/a.webp  ")).toBe("showcases/a.webp");
  });
});

/* -------------------------------------------------------------------------- */
/*  排序                                                                        */
/* -------------------------------------------------------------------------- */

describe("案例排序 —— 三档,每档都有确定的兜底", () => {
  it("sortOrder 小的在前", () => {
    const list = sortShowcaseRecords([
      record({ id: "b", sortOrder: 20 }),
      record({ id: "a", sortOrder: 10 }),
    ]);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("同序 ⇒ 点赞多的在前", () => {
    const list = sortShowcaseRecords([
      record({ id: "b", sortOrder: 10, likes: 3 }),
      record({ id: "a", sortOrder: 10, likes: 30 }),
    ]);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("同序同赞 ⇒ 新的在前", () => {
    const list = sortShowcaseRecords([
      record({
        id: "b",
        sortOrder: 10,
        likes: 3,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      record({
        id: "a",
        sortOrder: 10,
        likes: 3,
        createdAt: new Date("2026-11-16T00:00:00Z"),
      }),
    ]);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("全同 ⇒ 按 id 排(不是未定义)", () => {
    const list = sortShowcaseRecords([
      record({ id: "b" }),
      record({ id: "a" }),
    ]);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("不原地改调用方那个数组", () => {
    const input = [record({ id: "b", sortOrder: 20 }), record({ id: "a" })];
    sortShowcaseRecords(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  投影                                                                        */
/* -------------------------------------------------------------------------- */

describe("DB 行 → 前台那一条", () => {
  it("封面引用非法 ⇒ 这一条不摆(返 null)", () => {
    expect(
      toShowcaseCase(
        record({ coverUrl: "javascript:alert(1)" }),
        "zh",
        identity
      )
    ).toBeNull();
  });

  it("封面解析不出来 ⇒ 这一条不摆", () => {
    expect(toShowcaseCase(record(), "zh", () => null)).toBeNull();
  });

  it("原图解析不出来 ⇒ 成品照摆,只是没有翻转", () => {
    const result = toShowcaseCase(
      record({ beforeImageUrl: "showcases/2026-11-16/before.webp" }),
      "zh",
      (ref) => (ref.includes("before") ? null : identity(ref))
    );
    expect(result).not.toBeNull();
    expect(result?.beforeSrc).toBeNull();
    expect(result?.coverSrc).toBeTruthy();
  });

  it("点赞数不会变成负数 / 小数", () => {
    expect(toShowcaseCase(record({ likes: -5 }), "zh", identity)?.likes).toBe(
      0
    );
    expect(toShowcaseCase(record({ likes: 12.7 }), "zh", identity)?.likes).toBe(
      12
    );
  });

  it("作者名去空白", () => {
    expect(
      toShowcaseCase(record({ authorName: "  工作室实拍 " }), "zh", identity)
        ?.authorName
    ).toBe("工作室实拍");
  });

  it("没有原图 ⇒ beforeSrc 就是 null", () => {
    expect(
      toShowcaseCase(record({ beforeImageUrl: null }), "zh", identity)
        ?.beforeSrc
    ).toBeNull();
  });
});

describe("一批记录 → 前台那一批 —— 先排后投影再截", () => {
  it("解析失败的条目不占名额(少一条不能空一格)", () => {
    const records = [
      record({ id: "bad", coverUrl: "showcases/bad.webp" }),
      record({ id: "ok1", coverUrl: "showcases/ok1.webp" }),
      record({ id: "ok2", coverUrl: "showcases/ok2.webp" }),
    ];
    const result = toShowcaseCases(
      records,
      "zh",
      (ref) => (ref.includes("bad") ? null : identity(ref)),
      2
    );
    expect(result.map((c) => c.id)).toEqual(["ok1", "ok2"]);
  });

  it("不传 limit ⇒ 全部", () => {
    const records = [
      record({ id: "a" }),
      record({ id: "b" }),
      record({ id: "c" }),
    ];
    expect(toShowcaseCases(records, "zh", identity)).toHaveLength(3);
  });

  it("排序在投影之前 —— 顺序按 sortOrder 走", () => {
    const records = [
      record({ id: "b", sortOrder: 20 }),
      record({ id: "a", sortOrder: 10 }),
    ];
    expect(toShowcaseCases(records, "zh", identity).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*  后台视图模型                                                                 */
/* -------------------------------------------------------------------------- */

describe("后台列表的那一行 —— 引用和地址是两回事", () => {
  it("没有 resolved ⇒ 地址是 null(但引用还在)", () => {
    const row = toAdminShowcase(record());
    expect(row.coverUrl).toBe("showcases/2026-11-16/a.webp");
    expect(row.coverSrc).toBeNull();
    expect(row.beforeSrc).toBeNull();
  });

  it("resolved 传进来 ⇒ 地址原样带出去", () => {
    const row = toAdminShowcase(record(), {
      coverSrc: "https://cdn.example.com/a.webp",
      beforeSrc: "https://cdn.example.com/before.webp",
    });
    expect(row.coverSrc).toBe("https://cdn.example.com/a.webp");
    expect(row.beforeSrc).toBe("https://cdn.example.com/before.webp");
  });

  it("点赞数不为负,排序值取整,时间戳是 ISO 串", () => {
    const row = toAdminShowcase(record({ likes: -3, sortOrder: 7.9 }));
    expect(row.likes).toBe(0);
    expect(row.sortOrder).toBe(7);
    expect(row.createdAt).toBe("2026-11-16T00:00:00.000Z");
  });
});

/* -------------------------------------------------------------------------- */
/*  对象键                                                                      */
/* -------------------------------------------------------------------------- */

describe("案例图片的对象键", () => {
  it("前缀只有一个定义 —— 生成和校验必须用同一个", () => {
    expect(SHOWCASE_OBJECT_PREFIX).toBe("showcases/");
    const imageSrc = read("src/features/showcase/lib/case-image.ts");
    expect(imageSrc).toContain('from "./upload-key"');
  });

  it("键落在前缀下", () => {
    const key = buildShowcaseObjectKey("webp");
    expect(key.startsWith(SHOWCASE_OBJECT_PREFIX)).toBe(true);
    expect(key.endsWith(".webp")).toBe(true);
  });

  it("扩展名取小写,没有点号", () => {
    expect(extractShowcaseExtension("a/b/c.PNG")).toBe("png");
    expect(extractShowcaseExtension("a/b/c")).toBe("");
    expect(extractShowcaseExtension(".png")).toBe("");
  });

  it("只签白名单里的格式", () => {
    expect(SHOWCASE_ALLOWED_EXTENSIONS).toContain("webp");
    expect(SHOWCASE_ALLOWED_EXTENSIONS).toContain("png");
    expect(SHOWCASE_ALLOWED_EXTENSIONS).not.toContain("exe");
  });
});

/* -------------------------------------------------------------------------- */
/*  前台:不再有假数据兜底                                                        */
/* -------------------------------------------------------------------------- */

describe("前台那两段 —— 没有案例就整段不渲染", () => {
  it("静态的假案例数据已经删掉了", () => {
    const data = read(
      "src/features/marketing/components/storefront/wjp-store-data.ts"
    );
    const code = stripComments(data);
    expect(code).not.toContain("WJP_COMMUNITY_POSTS");
    expect(code).not.toContain("WjpCommunityPost");
  });

  it("案例墙接的是 cases 属性,自己不读静态数据", () => {
    const src = read(
      "src/features/marketing/components/storefront/community-wall.tsx"
    );
    expect(src).toContain("cases");
    expect(src).toContain("ShowcaseCaseCell");
    // **不许 import 静态数据** —— 注释里提一句「以前喂的是 wjp-store-data.ts」
    // 是历史说明,不算(所以这里查 import 语句,不是查字面量)。
    expect(src).not.toMatch(/from\s+["'][^"']*wjp-store-data/);
    expect(src).not.toContain("WJP_COMMUNITY_POSTS");
  });

  it("工艺画廊也是接 cases 属性", () => {
    const src = read(
      "src/features/marketing/components/storefront/craft-gallery.tsx"
    );
    expect(src).toContain("cases");
    expect(src).toContain("ShowcaseCaseCell");
    expect(src).not.toMatch(/from\s+["'][^"']*wjp-store-data/);
    expect(src).not.toContain("WJP_COMMUNITY_POSTS");
  });

  it("两个组件共用同一份渲染(不许各画一个)", () => {
    const cell = read(
      "src/features/showcase/components/showcase-case-cell.tsx"
    );
    expect(cell).toContain("export function ShowcaseCaseCell");
    const wall = read(
      "src/features/marketing/components/storefront/community-wall.tsx"
    );
    const gallery = read(
      "src/features/marketing/components/storefront/craft-gallery.tsx"
    );
    expect(wall).toContain(
      'from "@/features/showcase/components/showcase-case-cell"'
    );
    expect(gallery).toContain(
      'from "@/features/showcase/components/showcase-case-cell"'
    );
  });

  it("读案例的那一层降级成空数组,不抛(案例不是收钱链路)", () => {
    const catalog = read("src/features/showcase/lib/showcase-catalog.ts");
    expect(catalog).toContain("return [];");
    expect(catalog).toContain("connection()");
    // 绝不拿静态数据兜底
    expect(catalog).not.toContain("wjp-store-data");
    expect(catalog).not.toContain("WJP_COMMUNITY_POSTS");
  });

  it("首页和作品集页都读案例、都把 cases 传下去", () => {
    const home = read("src/app/[locale]/(marketing-atelier)/page.tsx");
    expect(home).toContain("getShowcaseCases");
    expect(home).toContain("cases={showcaseCases}");

    const products = read(
      "src/app/[locale]/(marketing-atelier)/products/page.tsx"
    );
    expect(products).toContain("getShowcaseCases");
    expect(products).toContain("cases={showcaseCases}");
  });
});

/* -------------------------------------------------------------------------- */
/*  案例卡片 → 商品详情页的链接                                                  */
/* -------------------------------------------------------------------------- */

describe("案例卡片的「关联商品」链接 —— 商品详情页是**单数**那个地址", () => {
  it("链 `/product/[handle]`,不是 `/products/[handle]`", () => {
    const cell = stripComments(
      read("src/features/showcase/components/showcase-case-cell.tsx")
    );
    // 用正则而不是字面量 —— 那串里带 `${…}`(Biome 的
    // `noTemplateCurlyInString` 会报「这该是模板字符串」)
    expect(cell).toMatch(/href=\{`\/product\/\$\{item\.productHandle\}`\}/);
    // `/products/` 底下只有目录页,没有 `[handle]` ⇒ 那个地址必然 404
    expect(cell).not.toContain("/products/");
  });

  it("商品详情页那个路由真的存在(单数),复数那个不存在", () => {
    expect(
      existsSync(
        resolve(
          ROOT,
          "src/app/[locale]/(marketing-atelier)/product/[handle]/page.tsx"
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          ROOT,
          "src/app/[locale]/(marketing-atelier)/products/[handle]/page.tsx"
        )
      )
    ).toBe(false);
  });

  it("用 next-intl 的 `<Link>`(裸 `<a>` 不带 locale 前缀)", () => {
    const cell = read(
      "src/features/showcase/components/showcase-case-cell.tsx"
    );
    expect(cell).toContain('from "@/i18n/routing"');
    expect(cell).toContain("<Link href=");
  });
});

/* -------------------------------------------------------------------------- */
/*  后台                                                                        */
/* -------------------------------------------------------------------------- */

describe("后台「案例展示」", () => {
  it("路由在 /admin/showcases,侧边栏登记了", () => {
    const nav = read("src/config/nav.ts");
    expect(nav).toContain("/admin/showcases");

    const sidebar = read("src/features/admin/components/admin-sidebar.tsx");
    expect(sidebar).toContain("nav.showcases");
  });

  it("action 不 throw —— 失败走 {ok:false, code}", () => {
    const actions = read("src/features/showcase/admin/actions.ts");
    expect(actions).toContain('"use server"');
    expect(actions).toContain("ok: false");
    expect(actions).toContain("MIGRATION_MISSING");
    expect(actions).toContain("INVALID_INPUT");
    // throw 会被 next-safe-action 糊成「服务器错误」
    expect(stripComments(actions)).not.toMatch(/throw new Error/);
  });

  it("「use server」文件不 re-export 类型", () => {
    const actions = read("src/features/showcase/admin/actions.ts");
    expect(actions).not.toMatch(/export type \{/);
    expect(actions).not.toMatch(/export \{ type/);
  });

  it("页面在 /admin/showcases", () => {
    const page = read("src/app/[locale]/(admin)/admin/showcases/page.tsx");
    expect(page).toContain("ShowcasesAdminView");
  });
});

/* -------------------------------------------------------------------------- */
/*  迁移脚本                                                                     */
/* -------------------------------------------------------------------------- */

describe("迁移脚本 —— 建表,不播种", () => {
  const script = read("scripts/apply-showcase-schema.ts");

  it("建表 + 建索引,都幂等", () => {
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "storefront_case"');
    expect(script).toContain(
      'CREATE INDEX IF NOT EXISTS "storefront_case_active_sort_idx"'
    );
  });

  it("不播种任何一行 —— 跑完线上行为一个字节都不变", () => {
    const code = stripComments(script);
    expect(code).not.toContain("INSERT INTO");
    expect(code).not.toContain("UPDATE ");
    expect(code).not.toContain("DELETE FROM");
  });

  it("支持 --dry-run(只打印 SQL,不连库)", () => {
    expect(script).toContain("--dry-run");
    expect(script).toContain("DRY_RUN");
  });

  it("package.json 登记了这一条", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:apply-showcase"]).toBe(
      "tsx scripts/apply-showcase-schema.ts"
    );
  });

  it("schema 里有这张表", () => {
    const schema = read("src/db/schema.ts");
    expect(schema).toContain("storefrontCase");
    expect(schema).toContain("storefront_case");
    expect(schema).toContain("storefront_case_active_sort_idx");
  });
});

/* -------------------------------------------------------------------------- */
/*  i18n                                                                        */
/* -------------------------------------------------------------------------- */

describe("后台文案 —— 中英文键集完全一致", () => {
  it("AdminShowcase 的键集一样", () => {
    const zh = messages("zh");
    const en = messages("en");
    const zhKeys = flatten(zh.AdminShowcase, "AdminShowcase");
    const enKeys = flatten(en.AdminShowcase, "AdminShowcase");
    expect(zhKeys).toEqual(enKeys);
    expect(zhKeys.length).toBeGreaterThan(0);
  });

  it("侧边栏那一项两种语言都有", () => {
    const zh = messages("zh");
    const en = messages("en");
    const zhNav = (zh.AdminSidebar as { nav: Record<string, string> }).nav;
    const enNav = (en.AdminSidebar as { nav: Record<string, string> }).nav;
    expect(zhNav.showcases).toBeTruthy();
    expect(enNav.showcases).toBeTruthy();
    expect(Object.keys(zhNav).sort()).toEqual(Object.keys(enNav).sort());
  });
});
