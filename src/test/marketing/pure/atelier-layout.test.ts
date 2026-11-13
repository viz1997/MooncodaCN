import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 公开页的版式:统一宽度 + 法律文档排版(2026-11-13)
 *
 * 工作室报的是两件事:
 *
 * 1. **「legal/shipping 的文字和主题颜色相似导致看不清」**
 * 2. **「每个页面的宽度不一致」**
 *
 * ## 为什么这两件事值得单测
 *
 * **① 颜色的坑是「一整套排版压根没生效」,不是「配错了一个色」。**
 *
 * 页面上写的是 `prose prose-a:text-primary prose-th:bg-muted …` ——
 * 那是 `@tailwindcss/typography` 的类,而**这个包本仓库没装**
 * (package.json / pnpm-lock.yaml 里零命中)⇒ **那些 `prose-*` 全是死的**。
 * 真正生效的是 Fumadocs 自带的 `.prose`(`globals.css` 第一行
 * `@import "fumadocs-ui/style.css"`),建在**另一套冷灰色板**上
 * (`--color-fd-foreground:#0a0a0a` / `--color-fd-card:#f1f1f1`)
 * ⇒ **链接跟正文一个颜色**、**表格是灰卡片摆在暖纸底上**。
 *
 * ⇒ 现在法律文档走本组自己写的 `.legal-doc`,只用 atelier 的色值。
 * 这条断言守着「别再把 `prose-*` 加回来」—— 加回来 = 页面立刻退回冷灰那套。
 *
 * **② 宽度散在十几个文件里,谁都能再加一档。**
 *
 * 改之前公开页有**四档**:1280(首页/作品集/头尾)/ 1100(购物袋/结算/买家中心)/
 * 768(法律文档)/ 560(结算成功页)。⇒ 现在统一走 `atelier-container`。
 *
 * **③ `@utility` 在这个文件里写了也不生效(踩过的坑)。**
 *
 * Tailwind v4 的 PostCSS 插件有个「快速跳过」检查:文件里**没有**
 * `@import` / `@theme` / `@reference` / `@apply` / `@tailwind` 这类指令时,
 * **整个文件原样输出**,插件压根不处理 ⇒ `@utility` 写出来浏览器不认
 * (类名彻底失效,宽度全丢)。⇒ `atelier.css` 里的类必须是**普通 CSS**。
 *
 * 纯文件扫描 —— 不需要浏览器 / DB / 网络。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释区别) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const ATELIER_CSS = "src/app/[locale]/(marketing-atelier)/atelier.css";
const LEGAL_PAGE = "src/app/[locale]/(marketing-atelier)/legal/[slug]/page.tsx";
const LAYOUT = "src/app/[locale]/(marketing-atelier)/layout.tsx";

/** 公开面 —— 「浏览面」上的组件(不是控制台 / 后台 / 工具台) */
const PUBLIC_SURFACE = [
  "src/features/marketing/components/storefront",
  "src/features/storefront/components",
];

/** 公开面里**逐个文件**都该用 `atelier-container` 的那些 */
const FRAME_FILES = [
  "src/features/marketing/components/storefront/category-strip.tsx",
  "src/features/marketing/components/storefront/community-wall.tsx",
  "src/features/marketing/components/storefront/craft-gallery.tsx",
  "src/features/marketing/components/storefront/craft-story.tsx",
  "src/features/marketing/components/storefront/featured-products.tsx",
  "src/features/marketing/components/storefront/how-it-works.tsx",
  "src/features/marketing/components/storefront/international-store-bar.tsx",
  "src/features/marketing/components/storefront/occasion-shelf.tsx",
  "src/features/marketing/components/storefront/series-showcase.tsx",
  "src/features/marketing/components/storefront/shop-grid.tsx",
  "src/features/marketing/components/storefront/store-footer.tsx",
  "src/features/marketing/components/storefront/store-hero.tsx",
  "src/features/marketing/components/storefront/wjp-store-header.tsx",
  "src/features/storefront/components/cart-page-view.tsx",
  "src/features/storefront/components/checkout-success-view.tsx",
  "src/features/storefront/components/checkout-view.tsx",
  "src/features/storefront/components/product-detail.tsx",
  "src/features/shared/components/atelier-page.tsx",
  "src/features/tools/components/tools-hub.tsx",
  "src/app/[locale]/(marketing-atelier)/legal/[slug]/page.tsx",
  "src/app/[locale]/(marketing-atelier)/checkout/success/page.tsx",
];

/** 公开面目录下的所有 `.tsx` */
function publicSurfaceFiles(): string[] {
  const out: string[] = [];
  for (const dir of PUBLIC_SURFACE) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name.endsWith(".tsx")) out.push(`${dir}/${name}`);
    }
  }
  return out;
}

describe("公开页宽度:只有一个出处", () => {
  it("atelier.css 定义三个宽度类(1280 / 46rem / 560)", () => {
    const css = read(ATELIER_CSS);
    expect(css).toMatch(/\.atelier-container\s*\{[^}]*max-width:\s*1280px/);
    expect(css).toMatch(/\.atelier-measure\s*\{[^}]*max-width:\s*46rem/);
    expect(css).toMatch(/\.atelier-narrow\s*\{[^}]*max-width:\s*560px/);
  });

  it("**不许用 `@utility`** —— Tailwind 会跳过没有 Tailwind 指令的文件", () => {
    // 踩过的坑:@utility 写在这个文件里 = 浏览器拿到不认识的 at-rule = 类名失效
    // (文件头那段注释里提到它 —— 那是解释,不是用法 ⇒ 先去掉注释再看)
    expect(stripComments(read(ATELIER_CSS))).not.toContain("@utility");
  });

  it("三个类都居中 + 撑满(宽度只有一个来源)", () => {
    const css = read(ATELIER_CSS);
    for (const cls of [
      "atelier-container",
      "atelier-measure",
      "atelier-narrow",
    ]) {
      const rule = css.match(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`))?.[0] ?? "";
      expect(rule).toContain("width: 100%");
      expect(rule).toContain("margin-inline: auto");
    }
  });

  it("公开面**逐个文件**都走 `atelier-container`", () => {
    for (const rel of FRAME_FILES) {
      expect(read(rel), `${rel} 该用 atelier-container`).toContain(
        "atelier-container"
      );
    }
  });

  it("旧的四档宽度在公开面里**已经没了**", () => {
    // 改之前:1280(首页/头尾)· 1100(购物袋/结算/买家中心)· 768(法律)· 560(成功页)
    for (const rel of publicSurfaceFiles()) {
      const code = stripComments(read(rel));
      expect(code, `${rel} 不许再有页面框级别的 max-w`).not.toContain(
        "max-w-[1100px]"
      );
      expect(code, `${rel} 不许再有页面框级别的 max-w`).not.toContain(
        "max-w-[560px]"
      );
      expect(code, `${rel} 不许再有页面框级别的 max-w`).not.toContain(
        "max-w-[1280px]"
      );
    }
  });

  it("工具台的 1600px **不许被动**(2026-11-09 工作室的决定)", () => {
    // 那是专门给 3D 视口留宽的决定(视口从 ~496px 涨到 ~730px)
    const src = read("src/features/pricing/components/pricing-calculator.tsx");
    expect(src).toContain("max-w-[1600px]");
  });

  it("法律文档在 1280 的框里**居中摆一条阅读栏**", () => {
    const src = read(LEGAL_PAGE);
    expect(src).toContain("atelier-container");
    expect(src).toContain("atelier-measure");
  });

  it("结算成功页是「框 + 窄栏」", () => {
    const src = read(
      "src/app/[locale]/(marketing-atelier)/checkout/success/page.tsx"
    );
    expect(src).toContain("atelier-container");
    expect(src).toContain("atelier-narrow");
  });
});

describe("法律文档:文字看得清", () => {
  it("页面用 `.legal-doc`,**不用 `prose`**", () => {
    const src = stripComments(read(LEGAL_PAGE));
    expect(src).toContain("legal-doc");
    // Fumadocs 的 `.prose` = 冷灰色板 = 「文字和主题颜色相似」的根因
    expect(src).not.toContain("prose");
  });

  it("`@tailwindcss/typography` 本仓库没装 ⇒ `prose-*` 全是死的", () => {
    // 页面要是再写 `prose-a:text-primary` 那一套,类名不会生效(包没装)
    expect(read("package.json")).not.toContain("typography");
  });

  it("正文用 `--foreground`,链接用 `--primary`(不是玫瑰色)", () => {
    const css = read(ATELIER_CSS);
    expect(css).toMatch(/\.legal-doc\s*\{[^}]*color:\s*var\(--foreground\)/);
    expect(css).toMatch(/\.legal-doc a\s*\{[^}]*color:\s*var\(--primary\)/);
    // --accent(玫瑰)在暖纸底上只有 ≈2.9:1,达不到 WCAG AA
    expect(css).not.toMatch(/\.legal-doc[^{]*\{[^}]*var\(--accent\)/);
  });

  it("表格是**暖色**的(--muted 底 + --border 描边),不是冷灰卡片", () => {
    const css = read(ATELIER_CSS);
    expect(css).toMatch(/\.legal-doc th\s*\{[^}]*background:\s*var\(--muted\)/);
    expect(css).toMatch(
      /\.legal-doc th,\s*\.legal-doc td\s*\{[^}]*var\(--border\)/
    );
  });

  it("MDX 里**没有重复的 H1**(标题由 frontmatter 渲染)", () => {
    for (const locale of ["zh", "en"]) {
      for (const name of readdirSync(join(ROOT, "src/content/legal", locale))) {
        if (!name.endsWith(".mdx")) continue;
        const body = stripComments(read(`src/content/legal/${locale}/${name}`));
        const h1 = body.match(/^# .+$/gm) ?? [];
        expect(h1.length, `${locale}/${name} 不该再有 H1`).toBe(0);
      }
    }
  });
});

describe("atelier 版式确实被 layout 引进来了", () => {
  it("layout 引入 `atelier.css`", () => {
    expect(read(LAYOUT)).toContain('import "./atelier.css"');
  });
});
