import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 全站一套头尾(2026-11-13)
 *
 * 工作室连着问了两句「为什么」:
 *
 *  - 「**为什么还有 zh/products**」—— 那是**模板时代留下的静态作品集**
 *    (`src/features/products/lib/data.ts` 里 6 件写死的东西:¥49 / ¥89 /
 *    ¥299 / ¥199 / ¥159,封面指向 `public/products/**` —— 那个目录**压根不
 *    存在** ⇒ 每张封面都是破图,不能下单,后台改不了价)。真目录
 *    (`getStorefrontProducts()`,DB 驱动)却躲在 `/marketing/products` 下。
 *    两个页面**标题一模一样** ⇒ 重复内容。
 *
 *  - 「**为什么又进入非电商页面 legal/shipping**」—— 法律文档住在
 *    `(marketing)` 组 ⇒ 套的是**模板那套 Header / Footer**;而入口在商城
 *    页脚(`StoreFooter`)⇒ **点一下就换了一套头尾**。
 *
 * 工作室拍板:**「全站一套头尾」** ⇒ `(marketing)` 组整个删掉,全站只留
 * 商城那一套(`WjpStoreHeader` + `StoreFooter` + 四个 overlay)。
 *
 * ## 这个文件守住什么
 *
 * 1. **模板那套头尾和它的路由组没了** —— `(marketing)` 组目录不存在、
 *    `header.tsx` / `footer.tsx` / `nav-menu.tsx` 不在了、`nav.ts` 里
 *    `mainNav` / `productsNav` / `footerNav` / `marketingConfig` 也没了
 * 2. **messages 里那三个命名空间删了**(`Header` / `Navigation` / `Footer`),
 *    而且中英文的键集一致
 * 3. **真作品集住在 `/products`** —— canonical 是 `/products`;旧地址
 *    `/marketing/products` 是 308 桩(书签 / 外链 / 已被收录的 URL 不能断)
 * 4. **法律页在 `(marketing-atelier)` 下** —— 换的是外壳,URL 一个字没变
 * 5. **pSEO:删落地页,留引擎** —— JSON 空了、索引页没了、路由没了,
 *    **引擎文件都还在**(工作室以后填 JSON 就有页)
 * 6. **博客 / 生图 / 文档 / 模板徽章演示页的路由都不存在了**
 *    (工作室 2026-11-13 的原话:「不想进入这些路由页面」⇒ 直接 404,
 *    不是搬家)
 * 7. **全站只有一套头尾** —— 公开页面只有 `(marketing-atelier)` 这一个
 *    layout,别的 layout 不许再挂商城头 / 商城页脚
 * 8. **sitemap 里有 `/products`、没有 `/blog` / `/pseo`**
 *
 * 纯文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 文件在不在 */
function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

/** 读一份语言包(仓库惯例:读文件 + JSON.parse,不在测试里 import JSON) */
function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释改了什么) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 两个语言 —— 循环里当字面量用,免得被推成 `string` */
const LOCALES = ["zh", "en"] as const;

const ATELIER = "src/app/[locale]/(marketing-atelier)";
const MARKETING = "src/app/[locale]/(marketing)";
const ROOT_LAYOUT = "src/app/[locale]/layout.tsx";
const ATELIER_LAYOUT = `${ATELIER}/layout.tsx`;
const PRODUCTS_PAGE = `${ATELIER}/products/page.tsx`;
const LEGACY_PRODUCTS_PAGE = `${ATELIER}/marketing/products/page.tsx`;
const LEGAL_PAGE = `${ATELIER}/legal/[slug]/page.tsx`;
const SITEMAP = "src/app/sitemap.ts";
const NAV = "src/config/nav.ts";
const STORE_FOOTER =
  "src/features/marketing/components/storefront/store-footer.tsx";
const PSEO_JSON = "src/features/pseo/data/pseo-pages.json";

/** 模板那套头尾的三个文件 —— 2026-11-13 删了 */
const TEMPLATE_CHROME_FILES = [
  "src/features/marketing/components/header.tsx",
  "src/features/marketing/components/footer.tsx",
  "src/features/marketing/components/nav-menu.tsx",
] as const;

/** `nav.ts` 里被模板头尾独占的那四份配置 */
const TEMPLATE_NAV_EXPORTS = [
  "mainNav",
  "productsNav",
  "footerNav",
  "marketingConfig",
] as const;

/** 模板那三个 i18n 命名空间 */
const TEMPLATE_I18N_NAMESPACES = ["Header", "Navigation", "Footer"] as const;

/** 被工作室要求「不想进入」的路由 —— 2026-11-13 直接删掉(⇒ 404) */
const REMOVED_ROUTE_DIRS = [
  `${ATELIER}/blog`,
  `${ATELIER}/image-gen`,
  `${ATELIER}/pseo`,
  `${ATELIER}/demo`,
  "src/app/[locale]/blog",
  "src/app/[locale]/image-gen",
  "src/app/[locale]/pseo",
  "src/app/[locale]/docs",
  "src/app/[locale]/demo",
] as const;

describe("全站一套头尾(2026-11-13)", () => {
  describe("模板那套头尾没了", () => {
    it("`(marketing)` 路由组整个不存在了", () => {
      expect(exists(MARKETING)).toBe(false);
    });

    it("模板的头 / 尾 / 导航菜单三个文件不在了", () => {
      for (const rel of TEMPLATE_CHROME_FILES) {
        expect(exists(rel), `${rel} 应该已经删掉`).toBe(false);
      }
    });

    it("模板那套静态作品集(`src/features/products/`)不在了", () => {
      // 6 件写死的演示数据、封面全是破图、不能下单 —— 留着就是个「看着像
      // 商城但点不动的」演示页。
      expect(exists("src/features/products")).toBe(false);
      expect(exists("src/features/products/lib/data.ts")).toBe(false);
    });

    it("`nav.ts` 里那四份只被模板头尾消费的配置没了", () => {
      const src = stripComments(read(NAV));
      for (const name of TEMPLATE_NAV_EXPORTS) {
        expect(src, `${name} 应该已经删掉`).not.toContain(name);
      }
      // 类型还在(dashboardNav / adminNav 在用)
      expect(src).toContain("NavItem");
      expect(src).toContain("NavGroup");
      expect(src).toContain("dashboardNav");
      expect(src).toContain("adminNav");
    });

    it("barrel 里也不许再导出那三个组件", () => {
      const src = stripComments(
        read("src/features/marketing/components/index.ts")
      );
      expect(src).not.toContain("./header");
      expect(src).not.toContain("./footer");
      expect(src).not.toContain("./nav-menu");
      // CookieConsent 留着(根 layout 在用)
      expect(src).toContain("CookieConsent");
    });
  });

  describe("messages", () => {
    it("模板那三个命名空间整个删了", () => {
      for (const locale of LOCALES) {
        const msgs = messages(locale);
        for (const ns of TEMPLATE_I18N_NAMESPACES) {
          expect(msgs, `${locale}.${ns} 应该已经删掉`).not.toHaveProperty(ns);
        }
      }
    });

    it("中英文的顶层键集一致", () => {
      const zh = Object.keys(messages("zh")).sort();
      const en = Object.keys(messages("en")).sort();
      expect(en).toEqual(zh);
    });
  });

  describe("真作品集归位到 `/products`", () => {
    it("真目录住在 `(marketing-atelier)/products` 下", () => {
      expect(exists(PRODUCTS_PAGE)).toBe(true);
      // 价来自 DB ⇒ 这一页不能被静态预渲染
      expect(stripComments(read(PRODUCTS_PAGE))).toContain(
        'dynamic = "force-dynamic"'
      );
    });

    it("canonical / alternates / OpenGraph 全是 `/products`", () => {
      const src = stripComments(read(PRODUCTS_PAGE));
      // 用正则而不是字面量 —— 那几个串里带 `${…}`(Biome 的
      // `noTemplateCurlyInString` 会报「这该是模板字符串」)
      expect(src).toMatch(
        /canonical: `\$\{siteConfig\.url\}\/\$\{locale\}\/products`/
      );
      expect(src).toMatch(/en: `\$\{siteConfig\.url\}\/en\/products`/);
      expect(src).toMatch(/zh: `\$\{siteConfig\.url\}\/zh\/products`/);
      expect(src).toMatch(
        /url: `\$\{siteConfig\.url\}\/\$\{locale\}\/products`/
      );
      // 旧地址不许再出现在这一页里
      expect(src).not.toContain("/marketing/products");
    });

    it("旧地址 `/marketing/products` 是 308 桩(永久搬家,权重要转移)", () => {
      expect(exists(LEGACY_PRODUCTS_PAGE)).toBe(true);
      const src = stripComments(read(LEGACY_PRODUCTS_PAGE));
      expect(src).toContain("permanentRedirect");
      expect(src).toMatch(/permanentRedirect\(`\/\$\{locale\}\/products`\)/);
      // 307 会被当成临时跳转 —— 不许用
      expect(src).not.toMatch(/\bredirect\(/);
    });

    it("商城页脚的「全部作品」指着 `/products`", () => {
      const src = stripComments(read(STORE_FOOTER));
      expect(src).toContain('href: "/products"');
      expect(src).not.toContain("/marketing/products");
    });
  });

  describe("法律页换了外壳,URL 一个字没变", () => {
    it("`legal/[slug]` 在 `(marketing-atelier)` 下", () => {
      expect(exists(LEGAL_PAGE)).toBe(true);
      expect(exists(`${MARKETING}/legal`)).toBe(false);
    });
  });

  describe("pSEO:删落地页,留引擎", () => {
    it("内容 JSON 清空了(留着文件 —— `pseo-data.ts` 在模块顶层 import 它)", () => {
      expect(exists(PSEO_JSON)).toBe(true);
      const parsed: unknown = JSON.parse(read(PSEO_JSON));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual([]);
    });

    it("索引页和单页路由都没了(工作室:「不想进入这些路由页面」)", () => {
      expect(exists(`${ATELIER}/pseo`)).toBe(false);
      expect(exists(`${MARKETING}/pseo`)).toBe(false);
    });

    it("**引擎文件都还在** —— 工作室以后填 JSON 就有页", () => {
      for (const rel of [
        "src/features/pseo/lib/pseo-data.ts",
        "src/features/pseo/components/index.ts",
        "src/features/pseo/components/pseo-hero.tsx",
        "src/features/pseo/components/pseo-faq.tsx",
        "src/features/pseo/components/pseo-feature-grid.tsx",
        "src/features/pseo/components/pseo-use-cases.tsx",
        "src/features/pseo/components/pseo-related.tsx",
        "src/features/pseo/components/pseo-cta.tsx",
      ]) {
        expect(exists(rel), `${rel} 应该还在`).toBe(true);
      }
    });

    it("sitemap 里没有 pSEO 的静态项", () => {
      const src = stripComments(read(SITEMAP));
      expect(src).not.toContain('"/pseo"');
    });
  });

  describe("工作室「不想进入」的路由都删了(⇒ 404)", () => {
    for (const rel of REMOVED_ROUTE_DIRS) {
      it(`${rel} 不存在`, () => {
        expect(exists(rel)).toBe(false);
      });
    }
  });

  describe("sitemap", () => {
    it("有 `/products`(作品集是主入口)", () => {
      expect(stripComments(read(SITEMAP))).toContain('"/products"');
    });

    it("没有 `/blog`(没有列表页了)", () => {
      const src = stripComments(read(SITEMAP));
      expect(src).not.toContain('"/blog"');
      expect(src).not.toContain("getAllBlogSlugs");
    });
  });

  describe("全站只有一套头尾", () => {
    it("公开页面只有 `(marketing-atelier)` 这一个 layout", () => {
      // `[locale]/layout.tsx` 是根 layout —— 它只挂 providers / CookieConsent /
      // Toaster / Analytics,**不挂头尾**。
      const root = stripComments(read(ROOT_LAYOUT));
      expect(root).not.toContain("WjpStoreHeader");
      expect(root).not.toContain("StoreFooter");

      // 根 layout 下面那些组里,只有 `(marketing-atelier)` 挂商城头尾
      const groups = readdirSync(join(ROOT, "src/app/[locale]"), {
        withFileTypes: true,
      })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      expect(groups).toContain("(marketing-atelier)");
      expect(groups).not.toContain("(marketing)");
    });

    it("那一个 layout 挂的是商城头 + 商城页脚 + 四个 overlay", () => {
      const src = stripComments(read(ATELIER_LAYOUT));
      expect(src).toContain("<WjpStoreHeader");
      expect(src).toContain("<StoreFooter");
      expect(src).toContain("<CartDrawer");
      expect(src).toContain("<ProductQuickView");
      expect(src).toContain("<CustomizeEntry");
      expect(src).toContain("<CustomWorkshop");
      // 模板那套组件不许再出现
      expect(src).not.toContain("@/features/marketing/components/header");
      expect(src).not.toContain("@/features/marketing/components/footer");
    });

    it("没有任何地方再 import 模板那三个组件", () => {
      // 逐个文件扫 `src/` —— 死 import 会让构建期报「模块不存在」
      const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const abs = join(dir, entry.name);
          if (entry.isDirectory()) {
            out.push(...walk(abs));
          } else if (/\.(ts|tsx)$/.test(entry.name)) {
            out.push(abs);
          }
        }
        return out;
      };
      for (const abs of walk(join(ROOT, "src"))) {
        const src = readFileSync(abs, "utf8");
        for (const rel of TEMPLATE_CHROME_FILES) {
          const base = rel.split("/").pop()?.replace(".tsx", "") ?? "";
          expect(src, `${abs} 还 import 着 ${base}`).not.toMatch(
            new RegExp(`from "[^"]*/${base}"`)
          );
        }
      }
    });
  });
});
