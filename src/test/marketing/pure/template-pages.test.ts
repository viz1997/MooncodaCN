import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 不再展示原项目(SaaS 模板)的页面(2026-11-12)
 *
 * 工作室把整个站点的头 + 页脚贴过来,原话是:
 *
 * > 「不再展示这些页面，即原项目的页面」
 *
 * ## 「原项目的页面」具体是哪几页
 *
 * 不是「所有跟模板有关的页面」,是**点开就是 404 / 死链 / 内容不对**的那几页。
 * 逐个查过:
 *
 * | 原来在哪 | 指向 | 为什么算「原项目的页面」 |
 * |---|---|---|
 * | 头部 `Docs` | `/docs` | `src/content/docs` 这个目录**压根不存在** ⇒ `/zh/docs` 直接 404 |
 * | 头部 `Pricing` | `/#pricing` | 首页上**没有** `id="pricing"` 的元素 ⇒ 死锚点(点过去落在页顶)。模板的 `/pricing` 页 2026-11-07 起 308 跳到 `/tools/workbench` |
 * | 头部 `Blog` | `/blog` | 模板的博客只有两篇「你好世界」「Mooncoda 开源了」—— 讲的是这个 Next.js SaaS 模板 |
 * | 页脚 `Pricing` | `/#pricing` | 跟头部同一页 |
 * | 页脚 `Changelog` | `/blog` | 跟头部同一页 |
 * | 页脚「条款」整组 | `/legal/terms`、`/legal/privacy`、`/legal/cookie-policy` | 三份都是模板的文档 —— 隐私政策里写的是「生成闪卡」「Anki 包」那一套 SaaS 业务 |
 * | 登录页页脚 | 隐私政策 / 服务条款 | 同上 |
 * | Cookie 横幅 | 隐私政策 | 同上 |
 *
 * ⇒ **留着**的是工作室自己的:Gallery(`/products`)/ Image Gen(`/image-gen`)/
 * Print(`/cart`)/ Tools(`/tools`)/ `/dashboard`/ Contact Us(mailto)/
 * 工作室自己的四份打印服务文档。**博客这一节本身留着**(工作室随时能写
 * 自己的文章),只是没有文章之前**不占导航位、不进 sitemap**。
 *
 * ## 同一批改动里还做了一件事:`/legal/shipping`
 *
 * 工作室报的是**「legal/shipping,缺少路由页面」** —— 页脚有一个运费入口,
 * 但没有那篇文章。运费 / 免运费门槛 / 交期档位的事实全部来自仓库自己的
 * 代码(`pricing-constants.ts` / `delivery-tier.ts`),**不是编的**。
 *
 * ## 这个文件守住什么
 *
 * 1. **模板那三份法律 MDX 真的删了** —— 摆在页脚上比不摆更糟
 * 2. **法律集合里只剩工作室自己的文档**,而且**两个语言一样**
 * 3. **页脚 / 导航里的每一个 `/legal/…` 链接都指向真实存在的 slug** ——
 *    死链是最难被发现的回归(页面照常渲染,只是点过去 404)
 * 4. **原项目的页面不在导航 / 页脚 / sitemap 里**
 * 5. **messages 里那四个键删了**、新的那个加了、中英文一致
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

/** 把注释去掉 —— 注释里**提到**那个路径不算违规(那儿恰恰要解释改了什么) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const NAV = "src/config/nav.ts";
const MARKETING_FOOTER = "src/features/marketing/components/footer.tsx";
const STORE_FOOTER =
  "src/features/marketing/components/storefront/store-footer.tsx";
const AUTH_FOOTER = "src/features/auth/components/auth-footer.tsx";
const COOKIE_CONSENT = "src/features/marketing/components/cookie-consent.tsx";
const SITEMAP = "src/app/sitemap.ts";
const SOURCE_CONFIG = "source.config.ts";

/** 工作室自己的法律文档 —— 两个语言必须一样 */
const STUDIO_LEGAL_SLUGS = [
  "after-sales",
  "design-spec",
  "print-notice",
  "print-order-notice",
  "shipping",
] as const;

/** 模板(SaaS 模板)那三份 —— 2026-11-12 删了 */
const TEMPLATE_LEGAL_SLUGS = ["terms", "privacy", "cookie-policy"] as const;

/** 模板自带的博客文章 —— 2026-11-12 删了 */
const TEMPLATE_BLOG_SLUGS = ["hello-world", "mooncoda-linuxdo-intro"] as const;

/** 两个语言 —— 循环里当字面量用,免得被推成 `string` */
const LOCALES = ["zh", "en"] as const;

/** 抠出文件里所有 `/legal/xxx` 形式的链接 */
function legalLinks(src: string): string[] {
  const out: string[] = [];
  const re = /["'`](\/legal\/[a-z0-9-]+)["'`]/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.push(m[1] as string);
    m = re.exec(src);
  }
  return out;
}

describe("原项目的页面 —— 不再展示", () => {
  describe("模板的法律文档已经删了", () => {
    it("那三份 MDX 不在了(zh + en 各三个)", () => {
      for (const locale of LOCALES) {
        for (const slug of TEMPLATE_LEGAL_SLUGS) {
          expect(
            exists(`src/content/legal/${locale}/${slug}.mdx`),
            `${locale}/${slug}.mdx 应该已经删掉`
          ).toBe(false);
        }
      }
    });

    it("模板那两篇博客也不在了", () => {
      for (const locale of LOCALES) {
        for (const slug of TEMPLATE_BLOG_SLUGS) {
          expect(
            exists(`src/content/blog/${locale}/${slug}.mdx`),
            `${locale}/${slug}.mdx 应该已经删掉`
          ).toBe(false);
        }
      }
      // 整个博客集合现在是空的 —— 目录留着(集合配置指着它),文章一篇没有
      expect(exists("src/content/blog")).toBe(true);
    });

    it("法律集合里只剩工作室自己的文档(两个语言一样)", () => {
      for (const locale of LOCALES) {
        const found = STUDIO_LEGAL_SLUGS.map((slug) =>
          exists(`src/content/legal/${locale}/${slug}.mdx`)
        );
        expect(
          found.every(Boolean),
          `${locale} 的法律文档应该齐:${STUDIO_LEGAL_SLUGS.join(" / ")}`
        ).toBe(true);

        // 目录里**不多不少**就是这几篇
        const dir = join(ROOT, "src/content/legal", locale);
        const mdx = readdirSync(dir)
          .filter((f) => f.endsWith(".mdx"))
          .sort();
        expect(mdx).toEqual(
          [...STUDIO_LEGAL_SLUGS].map((s) => `${s}.mdx`).sort()
        );
      }
    });
  });

  describe("`/legal/shipping` 存在(2026-11-12)", () => {
    it("两个语言都有这一篇", () => {
      for (const locale of LOCALES) {
        expect(exists(`src/content/legal/${locale}/shipping.mdx`)).toBe(true);
      }
    });

    it("frontmatter 齐(标题 / 日期 / 描述)", () => {
      for (const locale of LOCALES) {
        const src = read(`src/content/legal/${locale}/shipping.mdx`);
        expect(src).toMatch(/^title:/m);
        expect(src).toMatch(/^date:/m);
        expect(src).toMatch(/^description:/m);
      }
    });

    it("运费 / 交期的事实跟代码里的一致", () => {
      // ¥8 运费、¥99 免运费门槛
      const constants = read(
        "src/features/storefront/lib/pricing-constants.ts"
      );
      expect(constants).toContain("DEFAULT_SHIPPING_CENTS: 800");
      expect(constants).toContain("FREE_SHIPPING_THRESHOLD_CENTS: 9900");
      // 交期三档:96h / 72h / 48h,加价 10% / 37%
      const tiers = read("src/features/print-quote/lib/delivery-tier.ts");
      expect(tiers).toContain("96");
      expect(tiers).toContain("72");
      expect(tiers).toContain("48");

      // 页面里写的两个数不能跑偏
      const zh = read("src/content/legal/zh/shipping.mdx");
      expect(zh).toContain("¥8");
      expect(zh).toContain("¥99");
      expect(zh).toContain("96 小时");
      expect(zh).toContain("72 小时");
      expect(zh).toContain("48 小时");
      expect(zh).toContain("10%");
      expect(zh).toContain("37%");
    });

    it("页脚指着它(营销页 footer + 商城 footer)", () => {
      const nav = stripComments(read(NAV));
      expect(nav).toContain("/legal/shipping");
      const store = stripComments(read(STORE_FOOTER));
      expect(store).toContain("/legal/shipping");
    });

    it("页脚链接的标题走 i18n(中英文都有一份)", () => {
      for (const locale of LOCALES) {
        const footer = messages(locale).Footer as Record<string, unknown>;
        expect(footer).toHaveProperty("shipping");
      }
    });
  });

  describe("页脚 / 导航里的法律链接都能解析", () => {
    it("每一个 `/legal/…` 链接都对应一篇真实存在的 MDX", () => {
      const sources = [
        NAV,
        MARKETING_FOOTER,
        STORE_FOOTER,
        AUTH_FOOTER,
        COOKIE_CONSENT,
      ];
      for (const rel of sources) {
        for (const link of legalLinks(stripComments(read(rel)))) {
          const slug = link.replace("/legal/", "");
          // 两个语言都得有
          for (const locale of LOCALES) {
            expect(
              exists(`src/content/legal/${locale}/${slug}.mdx`),
              `${rel} 里的 ${link} 在 ${locale} 下没有对应文章`
            ).toBe(true);
          }
        }
      }
    });

    it("不许再指向模板那三份", () => {
      for (const rel of [
        NAV,
        MARKETING_FOOTER,
        STORE_FOOTER,
        AUTH_FOOTER,
        COOKIE_CONSENT,
      ]) {
        const code = stripComments(read(rel));
        for (const slug of TEMPLATE_LEGAL_SLUGS) {
          expect(code).not.toContain(`/legal/${slug}`);
        }
      }
    });

    it("不许指向 `/legal/cookies`(那压根不是合法 slug —— 真 slug 是 `cookie-policy`)", () => {
      // 2026-11-12 之前商城页脚摆的就是这个 ⇒ 一个点开就 404 的链接
      for (const rel of [NAV, MARKETING_FOOTER, STORE_FOOTER]) {
        expect(stripComments(read(rel))).not.toContain("/legal/cookies");
      }
    });
  });

  describe("原项目的页面不在导航 / 页脚 / sitemap 里", () => {
    it("头部导航里没有 `/docs`、死锚点 `/#pricing`、`/blog`", () => {
      const nav = stripComments(read(NAV));
      const mainNav = nav.slice(
        nav.indexOf("export const mainNav"),
        nav.indexOf("export const footerNav")
      );
      expect(mainNav).not.toContain('"/docs"');
      expect(mainNav).not.toContain('"/blog"');
      expect(mainNav).not.toContain("#pricing");
      // 留下的四项是工作室自己的
      expect(mainNav).toContain('"/products"');
      expect(mainNav).toContain('"/image-gen"');
      expect(mainNav).toContain('"/cart"');
      expect(mainNav).toContain('"/tools"');
    });

    it("页脚没有「条款」那一组(模板那三份)", () => {
      const nav = stripComments(read(NAV));
      const footer = nav.slice(nav.indexOf("export const footerNav"));
      expect(footer).not.toContain("legal:");
      // 页脚里也不许有死锚点 / 博客
      expect(footer).not.toContain("#pricing");
      expect(footer).not.toContain('"/blog"');
    });

    it("营销页 footer 是两列(作品 / 打印服务),没有第三列", () => {
      const src = stripComments(read(MARKETING_FOOTER));
      expect(src).toContain("grid-cols-2");
      // 三个栏目:作品 / 打印服务 —— 模板那份「条款」没了
      expect(src).toContain("footerNav.product");
      expect(src).toContain("footerNav.service");
    });

    it("商城页脚的「条款」摆的是工作室自己的四份", () => {
      const src = stripComments(read(STORE_FOOTER));
      for (const slug of [
        "print-notice",
        "design-spec",
        "after-sales",
        "print-order-notice",
      ]) {
        expect(src).toContain(`/legal/${slug}`);
      }
    });

    it("登录页页脚不再链隐私政策 / 服务条款(Cookie 设置留着)", () => {
      const src = stripComments(read(AUTH_FOOTER));
      expect(src).not.toContain("/legal/privacy");
      expect(src).not.toContain("/legal/terms");
      // Cookie 设置是**功能**,不是模板文案 —— 留着
      expect(src).toContain("CookieSettingsDialog");
    });

    it("Cookie 横幅不再链隐私政策", () => {
      const src = stripComments(read(COOKIE_CONSENT));
      expect(src).not.toContain("/legal/privacy");
      expect(src).not.toContain("/legal/cookie-policy");
    });

    it("sitemap 里没有 `/blog`(空列表页进 sitemap 等于告诉搜索引擎「这是正式页面」)", () => {
      const src = stripComments(read(SITEMAP));
      expect(src).not.toContain('"/blog"');
      expect(src).not.toContain("getAllBlogSlugs");
    });

    it("博客这一节本身留着 —— 工作室随时能写自己的文章", () => {
      // 集合配置还指着 `src/content/blog` ⇒ 目录不能删,文章能加
      const config = read(SOURCE_CONFIG);
      expect(config).toContain('dir: "src/content/blog"');
      // 列表页还在,而且**零文章时有空状态**(不是白屏)
      const page = read("src/app/[locale]/(marketing)/blog/page.tsx");
      expect(page).toContain("暂无博客文章");
      expect(page).toContain("No blog posts yet");
    });
  });

  describe("messages", () => {
    it("模板那四个键删了", () => {
      for (const locale of LOCALES) {
        const msgs = messages(locale);
        const footer = msgs.Footer as Record<string, unknown>;
        expect(footer).not.toHaveProperty("legal");
        const authFooter = (msgs.Auth as Record<string, unknown>).footer as
          | Record<string, unknown>
          | undefined;
        expect(authFooter).toBeTruthy();
        expect(authFooter).not.toHaveProperty("privacy");
        expect(authFooter).not.toHaveProperty("terms");
        const cookie = msgs.Cookie as Record<string, unknown>;
        expect(cookie).not.toHaveProperty("privacyPolicy");
      }
    });

    it("中英文 key 一致(Footer / Auth.footer / Cookie)", () => {
      const zh = messages("zh");
      const en = messages("en");
      for (const ns of ["Footer"]) {
        const a = zh[ns] as Record<string, unknown>;
        const b = en[ns] as Record<string, unknown>;
        expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      }
      const zhAuth = (zh.Auth as Record<string, unknown>).footer as Record<
        string,
        unknown
      >;
      const enAuth = (en.Auth as Record<string, unknown>).footer as Record<
        string,
        unknown
      >;
      expect(Object.keys(enAuth).sort()).toEqual(Object.keys(zhAuth).sort());
      const zhCookie = zh.Cookie as Record<string, unknown>;
      const enCookie = en.Cookie as Record<string, unknown>;
      expect(Object.keys(enCookie).sort()).toEqual(
        Object.keys(zhCookie).sort()
      );
    });
  });
});
