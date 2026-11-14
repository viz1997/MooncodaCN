import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 后台侧边栏的 i18n 键 —— 扫描式守卫(2026-11-14)
 *
 * ## 背景:一个从来没进过 `messages` 的键
 *
 * `admin-sidebar.tsx` 的 `getNavTitle()` 里有一行:
 *
 * ```ts
 * 商品: t("nav.products"),
 * ```
 *
 * 看着没问题 —— 但 `AdminSidebar.nav.products` 这个键**从来没进过
 * `messages/{zh,en}.json`**(2026-10-21 那次加商品目录时只改了侧边栏,
 * 忘了加键)。⇒ 后台侧边栏「商品」那一项渲染出来的是**原始键名**
 * `nav.products`,控制台还刷一条 `MISSING_MESSAGE`。
 *
 * ## 为什么「中英文键集一致」那条测试**抓不到**
 *
 * 两个语言**都缺**这个键 ⇒ 键集照样一致 ⇒ 只比 zh / en 的测试一律通过。
 * ⇒ 必须**从源码里抠出用了哪些键**,逐个去 `messages` 里查 —— 这才是
 * 能抓住这类漏的方法。
 *
 * ## 扫描的规矩
 *
 * - 键从 `t("…")` 里抠(不是手抄一份清单)—— 手抄的清单会跟源码漂。
 * - `nav.ts` 里**带中文的标题**必须都有 i18n 映射 —— `/en` 的后台不该漏中文。
 */

const ROOT = resolve(process.cwd());

/** 侧边栏组件(那张中文标题 → i18n 键的映射表在这儿) */
const SIDEBAR = "src/features/admin/components/admin-sidebar.tsx";

/** 导航配置(侧边栏的标题来源) */
const NAV = "src/config/nav.ts";

/** 含中文的字符 */
const CJK = /[一-鿿]/;

/** 读文件(路径写错要立刻炸) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 读一份 messages */
function loadMessages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 按 `a.b.c` 取值 —— 取不到返 `undefined` */
function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 侧边栏里用到的所有 i18n 键(`t("…")`) */
function usedKeys(src: string): string[] {
  const keys = [...src.matchAll(/\bt\(\s*"([^"]+)"\s*\)/g)]
    .map((m) => m[1])
    .filter((key): key is string => key !== undefined);
  // `t(" ")` 是个空格占位(不是键)
  return [...new Set(keys.filter((key) => key.trim() !== ""))];
}

/** 侧边栏那张映射表里的条目 —— 中文标题 → i18n 键 */
function titleMapEntries(src: string): Array<{ title: string; key: string }> {
  const entries: Array<{ title: string; key: string }> = [];
  const re = /(?:"([^"]+)"|([一-鿿]+)):\s*t\("(nav\.[^"]+)"\)/g;
  for (const match of src.matchAll(re)) {
    const title = match[1] ?? match[2];
    const key = match[3];
    if (!title || !key) continue;
    entries.push({ title, key });
  }
  return entries;
}

describe("后台侧边栏的 i18n —— 扫描式守卫", () => {
  it('① 侧边栏里 `t("…")` 的每个键在 zh / en 都存在', () => {
    const keys = usedKeys(read(SIDEBAR));
    expect(keys.length, "没抠到任何键 —— 扫描正则坏了").toBeGreaterThan(0);

    for (const locale of ["zh", "en"] as const) {
      const messages = loadMessages(locale);
      for (const key of keys) {
        const value = getPath(messages, `AdminSidebar.${key}`);
        expect(value, `${locale}.json 缺 AdminSidebar.${key}`).toBeDefined();
      }
    }
  });

  it("② zh / en 的 `AdminSidebar` 键集完全一致", () => {
    const zh = getPath(loadMessages("zh"), "AdminSidebar") as Record<
      string,
      unknown
    >;
    const en = getPath(loadMessages("en"), "AdminSidebar") as Record<
      string,
      unknown
    >;

    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());

    const zhNav = Object.keys(zh.nav as Record<string, unknown>).sort();
    const enNav = Object.keys(en.nav as Record<string, unknown>).sort();
    expect(enNav).toEqual(zhNav);
  });

  it("③ `nav.products` 在 —— 商品目录那一项", () => {
    // 这个键 2026-10-21 加商品目录时就用了,但**从来没进过 messages**
    // ⇒ 后台侧边栏那一项渲染出来是原始键名 `nav.products`
    expect(getPath(loadMessages("zh"), "AdminSidebar.nav.products")).toBe(
      "商品"
    );
    expect(getPath(loadMessages("en"), "AdminSidebar.nav.products")).toBe(
      "Products"
    );
  });

  it("④ `nav.ts` 里带中文的标题**都要有** i18n 映射(否则 /en 漏中文)", () => {
    const nav = read(NAV);
    const sidebar = read(SIDEBAR);

    const titles = [...nav.matchAll(/\btitle:\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((title): title is string => title !== undefined);
    const cjkTitles = [...new Set(titles.filter((t) => CJK.test(t)))];
    expect(cjkTitles.length, "没抠到中文标题 —— 扫描正则坏了").toBeGreaterThan(
      0
    );

    const mapped = new Set(titleMapEntries(sidebar).map((e) => e.title));
    for (const title of cjkTitles) {
      expect(
        mapped.has(title),
        `侧边栏没有「${title}」的 i18n 映射 —— /en 的后台会漏中文`
      ).toBe(true);
    }
  });
});
