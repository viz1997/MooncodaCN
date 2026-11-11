import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { shouldShowInternationalStore } from "@/features/marketing/components/storefront/international-store";

/**
 * 外国访客 → 海外独立站入口(2026-11-10 定的,2026-11-11 改了口径)
 *
 * 工作室的独立站是**另一个 Shopify 店铺**(境外的那个)。本仓库有 `/en` 和
 * `/zh` 两个 locale,`localePrefix` 默认 `always` ⇒ URL 一定带前缀。
 *
 * ## 2026-11-11 工作室改的口径:**不是 en 才是,所有都要**
 *
 * 原来这条入口**只在英文站**出现 —— 当时的假设是「外国访客 = 会看英文」。
 * 工作室否掉了这个假设:**中文站上也有境外买家**(中文是他们的母语),
 * 境内价格 / 境内物流 / 境内客服对他们不合适 ⇒ 入口该给。
 *
 * 境内买家看到会不会困惑?靠**文案**解决(公告条写的是「中国大陆以外下单?
 * 请前往我们的海外独立站」),不靠**藏起来**。
 *
 * ⇒ 判定**不再看 locale**,只剩一个条件:**配了地址**。
 *
 * ## 这个文件守住什么
 *
 * 1. **可见性判定** —— 配了地址就出现(**所有语言站**);没配就不出现
 * 2. **判定里没有 locale 那一层** —— 两个渲染处都不传 locale
 * 3. **地址来自环境变量** —— `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL`;
 *    没配就是空字符串(不许留一条指向空地址的死链)
 * 4. **别跟已下线的支付通道搞混** —— `SHOPIFY_STORE_DOMAIN`(收款用的
 *    Admin API 域名,2026-11-05 那个通道就下线了)跟
 *    `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL`(顾客访问地址)**是两个变量**
 * 5. **公告条挂在两个 layout 上,且在 header 上面** —— 头是 sticky 的,
 *    条在头下面的话会被头盖住
 * 6. **导航按钮是站外链接** —— `<a target="_blank" rel="noopener noreferrer">`,
 *    不是 next-intl 的 `<Link>`(那个是给站内路由加 locale 前缀的)
 * 7. **中英文 key 一致**
 *
 * 纯函数 + 文件扫描 —— 不需要 DB / 网络 / 浏览器。
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

/** 把注释去掉 —— 注释里**提到**那个变量名不算违规(那儿恰恰要解释区别) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const SITE = "src/config/site.ts";
const PREDICATE =
  "src/features/marketing/components/storefront/international-store.ts";
const BAR =
  "src/features/marketing/components/storefront/international-store-bar.tsx";
const HEADER =
  "src/features/marketing/components/storefront/wjp-store-header.tsx";
const NAV_DATA =
  "src/features/marketing/components/storefront/occasion-data.ts";
const ATELIER_LAYOUT = "src/app/[locale]/(marketing-atelier)/layout.tsx";
const MARKETING_LAYOUT = "src/app/[locale]/(marketing)/layout.tsx";

describe("海外独立站入口", () => {
  describe("可见性判定", () => {
    it("配了地址 ⇒ 出现(**所有语言站都出现**)", () => {
      expect(
        shouldShowInternationalStore("https://example.myshopify.com")
      ).toBe(true);
    });

    it("没配地址 ⇒ 不出现(不留死链)", () => {
      expect(shouldShowInternationalStore("")).toBe(false);
      expect(shouldShowInternationalStore("   ")).toBe(false);
    });

    it("**判定里没有 locale 那一层** —— 工作室的口径是「不是 en 才是,所有都要」", () => {
      // 判定函数压根不接 locale(只有一个入参:地址)
      expect(shouldShowInternationalStore.length).toBe(1);
      // 注释里**提到**那个条件不算违规(那儿恰恰要解释改了什么)
      expect(stripComments(read(PREDICATE))).not.toContain('locale === "en"');
      // 两个渲染处也都不传 locale
      for (const rel of [BAR, HEADER]) {
        const code = stripComments(read(rel));
        expect(code).not.toMatch(/shouldShowInternationalStore\(\s*locale/);
        expect(code).not.toMatch(/shouldShowInternationalStore\(\s*"en"/);
      }
    });
  });

  describe("配置", () => {
    it("地址读环境变量,没配就是空字符串", () => {
      const src = read(SITE);
      expect(src).toContain("NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL");
      expect(src).toContain("internationalStoreUrl");
    });

    it("别跟已下线的 Shopify **支付通道**搞混", () => {
      // SHOPIFY_STORE_DOMAIN 是收款通道的 Admin API 域名(2026-11-05 下线)
      // —— 新代码里不许再出现它(注释里可以**提**它,那是解释区别)
      for (const rel of [SITE, BAR, HEADER, NAV_DATA]) {
        expect(stripComments(read(rel))).not.toContain("SHOPIFY_STORE_DOMAIN");
      }
    });
  });

  describe("公告条", () => {
    it("不满足条件就返回 null", () => {
      const src = read(BAR);
      expect(src).toContain("shouldShowInternationalStore");
      expect(src).toMatch(
        /if \(!shouldShowInternationalStore\([^)]*\)\) return null/
      );
    });

    it("是站外链接(target=_blank + noopener)", () => {
      const src = read(BAR);
      expect(src).toContain('target="_blank"');
      expect(src).toContain('rel="noopener noreferrer"');
    });

    it("挂在两个 layout 上,且在 header **上面**", () => {
      for (const rel of [ATELIER_LAYOUT, MARKETING_LAYOUT]) {
        // 注释里也提到过 `<WjpStoreHeader />` —— 排版要按**代码**算
        const src = stripComments(read(rel));
        expect(src).toContain("InternationalStoreBar");
        const barAt = src.indexOf("<InternationalStoreBar");
        expect(barAt).toBeGreaterThan(-1);
        // 头在条后面 —— 头是 sticky 的,条在头下面会被盖住
        const headerAt = src.indexOf("<WjpStoreHeader");
        const genericHeaderAt = src.indexOf("<Header");
        const headerIndex = headerAt > -1 ? headerAt : genericHeaderAt;
        expect(headerIndex).toBeGreaterThan(-1);
        expect(barAt).toBeLessThan(headerIndex);
      }
    });

    it("layout 读了 locale —— 公告条要按 locale 取文案", () => {
      for (const rel of [ATELIER_LAYOUT, MARKETING_LAYOUT]) {
        const src = read(rel);
        expect(src).toContain("params: Promise<{ locale: string }>");
        expect(src).toContain("await params");
      }
    });
  });

  describe("导航按钮", () => {
    it("STORE_NAV 里有 external 这一支", () => {
      const src = read(NAV_DATA);
      expect(src).toContain('kind: "external"');
      expect(src).toContain("internationalStoreUrl");
    });

    it("渲染成 <a target=_blank>,不是 next-intl 的 <Link>", () => {
      const src = read(HEADER);
      expect(src).toContain('link.kind === "external"');
      expect(src).toContain('target="_blank"');
      expect(src).toContain('rel="noopener noreferrer"');
      // 用的是同一个判定
      expect(src).toContain("shouldShowInternationalStore");
    });

    it("桌面端和移动端 Sheet 两处都处理了 external", () => {
      const src = read(HEADER);
      // 两处渲染分支 ⇒ 至少出现两次
      const matches = src.match(/link\.kind === "external"/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("i18n", () => {
    it("中英文 key 一致", () => {
      const zh = messages("zh").InternationalStore as Record<string, unknown>;
      const en = messages("en").InternationalStore as Record<string, unknown>;
      expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    });

    it("三个键都在", () => {
      const zh = messages("zh").InternationalStore as Record<string, unknown>;
      const en = messages("en").InternationalStore as Record<string, unknown>;
      for (const key of ["bar", "barCta", "nav"]) {
        expect(en).toHaveProperty(key);
        expect(zh).toHaveProperty(key);
      }
    });
  });
});
