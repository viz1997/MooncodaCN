import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/routing";
import {
  getAllLegalSlugs,
  getLegalDoc,
  getLegalDocs,
  getLegalSlug,
} from "@/lib/source";

/**
 * MDX 里的站内链接
 *
 * MDX 里写 `/legal/design-spec` 是**不带语言前缀**的 —— 本仓库的
 * localePrefix 是 always,直接丢给浏览器会 404。交给 next-intl 的 Link
 * 补前缀(`/zh/legal/design-spec`)。站外链接(带协议)原样输出。
 */
function MdxLink({ href = "", children, ...props }: React.ComponentProps<"a">) {
  // 协议头(http: / mailto: / tel:)和协议相对的 "//host" 都不做本地化
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

/**
 * 生成静态参数
 * 用于预渲染所有法律文档页面
 */
export function generateStaticParams() {
  return getAllLegalSlugs();
}

/**
 * 生成页面元数据
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const doc = getLegalDoc(slug, locale);

  if (!doc) {
    return {
      title: "Document Not Found",
    };
  }

  return {
    title: doc.title,
    description: doc.description,
  };
}

/**
 * 法律文档详情页面
 *
 * 路由: /legal/[slug]
 *
 * 2026-11-12:模板(SaaS 模板)那三份 —— `terms` / `privacy` /
 * `cookie-policy` —— **MDX 已删**(讲的是「生成闪卡」「Anki 包」那一套,
 * 跟打印业务无关)。现在这个集合里剩的都是**工作室自己的**文档:
 * `print-notice` / `design-spec` / `after-sales` / `print-order-notice` /
 * `shipping`。
 *
 * 页面内容**全部由集合驱动** —— 下面那个「其他文档」列表是
 * `getLegalDocs(locale)` 减去当前这篇 ⇒ **加一篇 MDX 就自动多一个链接**,
 * 不用改这里。
 */
export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = getLegalDoc(slug, locale);

  // 文档不存在时返回 404
  if (!doc) {
    notFound();
  }

  // 获取 MDX 内容组件
  const MDXContent = doc.body;

  // 同语言下的其他文档 —— 页脚列出,加文档时不用改这里
  const siblings = getLegalDocs(locale).filter(
    (item) => getLegalSlug(item) !== slug
  );

  // 格式化日期
  const formattedDate =
    typeof doc.date === "string"
      ? doc.date
      : doc.date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

  return (
    // 外框 = 全站统一的 `atelier-container`(1280),里面再居中摆一条阅读栏
    // (正文一行太长不好读)。框归框、栏归栏 ⇒ 左右边缘仍跟页头页脚对齐。
    <article className="atelier-container py-12">
      <div className="atelier-measure">
        {/* 返回链接 */}
        <Link
          href="/"
          className="mb-8 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          ← {locale === "zh" ? "返回首页" : "Back to Home"}
        </Link>

        {/* 文档头部 */}
        <header className="mb-8 border-b pb-8">
          {/* 标题 */}
          <h1 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
            {doc.title}
          </h1>

          {/* 最后更新日期 */}
          <p className="text-sm text-muted-foreground">
            {locale === "zh" ? "最后更新：" : "Last Updated: "}
            <time dateTime={formattedDate}>{formattedDate}</time>
          </p>
        </header>

        {/* 文档内容 —— `.legal-doc` 是本组自己写的排版(`atelier.css`)
            ⚠️ **别再用 `prose-*` 那套** —— `@tailwindcss/typography` 这个包
            本仓库没装,那些类全是死的;真正生效的是 Fumadocs 的 `.prose`
            (冷灰色板),链接跟正文一个颜色、表格是灰卡片摆在暖纸底上
            ⇒ 「文字和主题颜色相似导致看不清」。 */}
        <div className="legal-doc">
          <MDXContent components={{ a: MdxLink }} />
        </div>

        {/* 底部导航 —— 列出该语言下的全部文档 */}
        <footer className="mt-12 border-t pt-8">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <span className="text-muted-foreground">
              {locale === "zh" ? "其他文档：" : "Other documents:"}
            </span>
            {siblings.map((item) => (
              <Link
                key={item.info.path}
                href={`/legal/${getLegalSlug(item)}`}
                className="text-primary hover:underline"
              >
                {item.title}
              </Link>
            ))}
          </div>
        </footer>
      </div>
    </article>
  );
}
