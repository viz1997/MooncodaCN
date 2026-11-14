import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 字体**自托管**,不走 `next/font/google`(2026-11-14)
 *
 * ## 为什么值得测
 *
 * 那天 Vercel 上的生产构建直接炸了(32 个 Turbopack 报错):
 *
 * ```
 * Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
 * next/font/google queries have exactly one entry
 * ```
 *
 * 根因**不在本仓库的代码** —— Google 偶尔返回**没有扩展名**的字体地址
 * (`/l/font?kit=…`),Next 16.1.4 的 Turbopack 解析不了那个形状
 * (上游 vercel/next.js#99114,至今没有修复版)⇒ **构建结果取决于当天
 * Google 返回什么**。
 *
 * ⇒ 字体文件进仓库(产物由 `pnpm fonts:sync` 生成),构建期不再碰 Google。
 *
 * ## 这一栏守的是**四件会悄悄坏掉的事**
 *
 * 1. **谁又引回了 `next/font/google`** —— 构建期又变成看天吃饭;
 * 2. **字体文件被误删 / 改名** —— 构建期报「找不到文件」(这个是好的:响亮地炸);
 * 3. **CSS 变量名被改** —— `.atelier-root` 的字体栈跟着断(这个是坏的:静默地
 *    掉回系统字体,谁都不发现);
 * 4. **生成的 CSS 里混进了 `fonts.gstatic.com`** —— 又变成构建期 / 运行期联网。
 *
 * 纯文件扫描:不碰 DB、不碰网络。
 */

/* -------------------------------------------------------------------------- */
/*  读源码                                                                     */
/* -------------------------------------------------------------------------- */

function read(rel: string): string {
  return readFileSync(
    new URL(`../../../../${rel.replace(/^\/+/, "")}`, import.meta.url),
    "utf8"
  );
}

/** 把注释去掉 —— 只扫真正在跑的代码 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

const LAYOUT_SRC = read("src/app/layout.tsx");
const LAYOUT_CODE = stripComments(LAYOUT_SRC);
const ATELIER_LAYOUT_SRC = read(
  "src/app/[locale]/(marketing-atelier)/layout.tsx"
);
const ATELIER_LAYOUT_CODE = stripComments(ATELIER_LAYOUT_SRC);
const NOTO_CSS = read("src/fonts/noto-serif-sc/font.css");
const SYNC_SCRIPT = read("scripts/fetch-self-hosted-fonts.ts");
const PACKAGE_JSON = read("package.json");

/** 仓库根 —— 用来算相对路径(`fileURLToPath` —— Windows 上 `URL.pathname` 会带前导斜杠) */
const ROOT = REPO_ROOT;

/**
 * `layout.tsx` 里 `localFont` 的 `src` 数组引用的文件路径
 *
 * 路径**相对于 `src/app/layout.tsx`**(`../fonts/…` ⇒ `src/fonts/…`)。
 */
const FONT_PATHS: string[] = [...LAYOUT_CODE.matchAll(/path:\s*"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p): p is string => typeof p === "string");

/* -------------------------------------------------------------------------- */
/*  ① 不许再引回 `next/font/google`                                            */
/* -------------------------------------------------------------------------- */

describe("构建期不许再碰 Google 字体", () => {
  it("`src/app/layout.tsx` 不再 import `next/font/google`", () => {
    expect(LAYOUT_CODE).not.toContain("next/font/google");
  });

  it("`src/app/layout.tsx` 用的是 `next/font/local`", () => {
    expect(LAYOUT_CODE).toContain("next/font/local");
  });

  it("**整个 `src/` 目录**(除测试自己)都不许再 import `next/font/google`", () => {
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
        // 测试文件里会出现这个字符串(本文件就在讲这件事)—— 只扫产品代码
        if (full.replace(/\\/g, "/").includes("/src/test/")) continue;
        const src = stripComments(readFileSync(full, "utf8"));
        if (src.includes("next/font/google")) {
          offenders.push(full.slice(ROOT.length + 1).replace(/\\/g, "/"));
        }
      }
    };

    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });

  it("生成的 CSS 里**不许**残留 `fonts.gstatic.com`", () => {
    expect(NOTO_CSS).not.toContain("fonts.gstatic.com");
  });
});

/* -------------------------------------------------------------------------- */
/*  ② 引用的字体文件必须都在                                                   */
/* -------------------------------------------------------------------------- */

describe("`localFont` 引用的文件必须都在仓库里", () => {
  it("每个 `path:` 都能在磁盘上找到", () => {
    expect(FONT_PATHS.length).toBeGreaterThan(0);

    for (const p of FONT_PATHS) {
      // 路径相对于 `src/app/layout.tsx`
      const abs = resolve(join(ROOT, "src/app"), p);
      expect(
        existsSync(abs),
        `字体文件不存在:${p}(解析成 ${abs})`
      ).toBe(true);
    }
  });

  it("引用的文件都是 `.woff2`(Turbopack 认得的那几种)", () => {
    for (const p of FONT_PATHS) {
      expect(p.endsWith(".woff2")).toBe(true);
    }
  });

  it("**没有**空的 `src` 数组(空数组 = 一条字体都没有,页面静默掉回系统字体)", () => {
    expect(LAYOUT_CODE).not.toMatch(/src:\s*\[\s*\]/);
  });
});

/* -------------------------------------------------------------------------- */
/*  ③ CSS 变量名不许改                                                          */
/* -------------------------------------------------------------------------- */

describe("三个 CSS 变量名一个字都不许改", () => {
  const VARIABLES = [
    "--font-atelier-inter",
    "--font-atelier-serif",
    "--font-atelier-serif-sc",
  ] as const;

  it("`layout.tsx` 注入前两个(经 `localFont` 的 `variable`)", () => {
    expect(LAYOUT_CODE).toContain('variable: "--font-atelier-inter"');
    expect(LAYOUT_CODE).toContain('variable: "--font-atelier-serif"');
  });

  it("生成的 CSS 在 `:root` 上定义第三个", () => {
    const css = stripComments(NOTO_CSS);
    expect(css).toContain("--font-atelier-serif-sc:");
    expect(css).toMatch(
      /:root\s*\{[^}]*--font-atelier-serif-sc\s*:/
    );
  });

  it("`.atelier-root` 的字体栈用到这三个(少一个 = 静默掉回系统字体)", () => {
    expect(ATELIER_LAYOUT_CODE).toContain("var(--font-atelier-inter)");
    expect(ATELIER_LAYOUT_CODE).toContain("var(--font-atelier-serif)");
    expect(ATELIER_LAYOUT_CODE).toContain("var(--font-atelier-serif-sc)");
  });

  it("全仓再没有别的 `--font-atelier-*` 变量(多出来的那个是手滑)", () => {
    const found = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
        const src = readFileSync(full, "utf8");
        for (const m of src.matchAll(/--font-atelier-[a-z0-9-]+/g)) {
          found.add(m[0]);
        }
      }
    };
    walk(join(ROOT, "src"));
    expect([...found].sort()).toEqual([...VARIABLES].sort());
  });
});

/* -------------------------------------------------------------------------- */
/*  ④ `localFont` 的绑定名 = 全局的 font-family 名 ⇒ 必须全仓唯一              */
/* -------------------------------------------------------------------------- */

describe("`localFont` 的绑定名(它就是全局的 `font-family` 名)", () => {
  /**
   * **为什么这一条要守** —— `next/font/local` 生成的 `@font-face` 里,
   * `font-family` 用的就是 SWC 注入的 `variableName`,而那个名字是**按调用处
   * 的绑定标识符**生成的(实测:构建产物里是 `font-family:inter` /
   * `font-family:playfair`,正好是 `layout.tsx` 里那两个 `const` 的名字)。
   *
   * ⇒ 两个不同文件里的两个 `localFont` **绑到同一个名字** ⇒ 两套 `@font-face`
   * 共用一个 family ⇒ 浏览器按先到先得挑 ⇒ **字形悄悄变成另一个字体**。
   * 这类 bug 页面上看不出来(字还是字),只有比对源码才发现。
   */
  it("全仓的 `localFont` 绑定名**互不重复**", () => {
    const seen = new Map<string, string>();

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
        const src = stripComments(readFileSync(full, "utf8"));
        const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*localFont\s*\(/g;
        for (const m of src.matchAll(re)) {
          const name = m[1];
          if (typeof name !== "string") continue;
          const where = full.slice(ROOT.length + 1).replace(/\\/g, "/");
          expect(
            seen.get(name),
            `\`localFont\` 的绑定名「${name}」重复了:${seen.get(name)} 与 ${where}`
          ).toBeUndefined();
          seen.set(name, where);
        }
      }
    };

    walk(join(ROOT, "src"));
    // 至少得有 Inter 与 Playfair 两个
    expect(seen.size).toBeGreaterThanOrEqual(2);
    expect([...seen.keys()].sort()).toEqual(["inter", "playfair"]);
  });

  it("Inter 与 Playfair 的文件住在**不同的目录**里(两套字体的来源一眼能分开)", () => {
    const dirs = new Set(FONT_PATHS.map((p) => dirname(p)));
    expect([...dirs].sort()).toEqual([
      "../fonts/inter",
      "../fonts/playfair-display",
    ]);
  });

  it("Playfair 的 normal 与 italic 是**两个文件**(不是一个文件两种 style)", () => {
    expect(LAYOUT_CODE).toContain("../fonts/playfair-display/latin.woff2");
    expect(LAYOUT_CODE).toContain(
      "../fonts/playfair-display/latin-italic.woff2"
    );
  });

  it("Playfair 走衬线度量(`adjustFontFallback: \"Times New Roman\"`)", () => {
    expect(LAYOUT_CODE).toContain('adjustFontFallback: "Times New Roman"');
  });

  it("字重区间写法对(可变字体 —— 一个文件管 100–900 / 400–700)", () => {
    expect(LAYOUT_CODE).toContain('weight: "100 900"');
    expect(LAYOUT_CODE).toContain('weight: "400 700"');
  });
});

/* -------------------------------------------------------------------------- */
/*  ⑤ 生成的中文切片表                                                          */
/* -------------------------------------------------------------------------- */

describe("中文衬线的切片表", () => {
  it("每个 `url(\"./xxx.woff2\")` 都能在磁盘上找到", () => {
    const urls = [
      ...NOTO_CSS.matchAll(/url\(\s*["']\.\/([^"')]+)["']\s*\)/g),
    ]
      .map((m) => m[1])
      .filter((u): u is string => typeof u === "string");
    expect(urls.length).toBeGreaterThan(0);

    for (const name of urls) {
      const abs = join(ROOT, "src/fonts/noto-serif-sc", name);
      expect(existsSync(abs), `切片文件不存在:${name}`).toBe(true);
    }
  });

  it("每一条 `@font-face` 都带 `unicode-range`(没有它 = 浏览器全量下)", () => {
    const faces = NOTO_CSS.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toContain("unicode-range:");
    }
  });

  it("每一条 `@font-face` 都带 `font-display: swap`", () => {
    const faces = NOTO_CSS.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    for (const face of faces) {
      expect(face).toContain("font-display:");
    }
  });

  it("**没被手工改过** —— 头上写着「生成文件,别手改」", () => {
    expect(NOTO_CSS).toContain("生成文件");
    expect(NOTO_CSS).toContain("别手改");
  });
});

/* -------------------------------------------------------------------------- */
/*  ⑥ 重新生成的入口还在                                                        */
/* -------------------------------------------------------------------------- */

describe("重新生成字体的入口", () => {
  it("`scripts/fetch-self-hosted-fonts.ts` 在仓库里", () => {
    expect(existsSync(join(ROOT, "scripts/fetch-self-hosted-fonts.ts"))).toBe(
      true
    );
  });

  it("`package.json` 登记了 `fonts:sync`", () => {
    const pkg = JSON.parse(PACKAGE_JSON);
    expect(pkg.scripts["fonts:sync"]).toBe(
      "tsx scripts/fetch-self-hosted-fonts.ts"
    );
  });

  it("同步脚本**必须用 Next 当初那个 User-Agent**(Google 对 UA 敏感)", () => {
    expect(SYNC_SCRIPT).toContain("Mozilla/5.0");
    expect(SYNC_SCRIPT).toContain("Chrome/");
  });

  it("同步脚本会校验下载到的**确实是 woff2**(2026-11-14 那次失败就是形状不对)", () => {
    expect(SYNC_SCRIPT).toContain("woff2");
    expect(SYNC_SCRIPT).toMatch(/assert|throw/i);
  });

  it("`src/fonts/README.md` 在仓库里(为什么自托管 / 怎么重新拉)", () => {
    expect(existsSync(join(ROOT, "src/fonts/README.md"))).toBe(true);
  });
});
