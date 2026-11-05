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
 * 支持: /legal/terms, /legal/privacy, /legal/cookie-policy
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
    <article className="container mx-auto max-w-3xl py-12">
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

      {/* 文档内容 - 使用 Tailwind Typography 样式 */}
      <div className="prose prose-neutral dark:prose-invert max-w-none prose-headings:font-semibold prose-h2:text-xl prose-h2:mt-8 prose-h3:text-lg prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-table:text-sm prose-th:bg-muted prose-th:p-2 prose-td:p-2 prose-td:border">
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
    </article>
  );
}
