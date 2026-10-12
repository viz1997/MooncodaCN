"use client";

import { Link } from "@/i18n/routing";

/**
 * WJP 商店 Footer —— 1:1 移植自 atelier `store-footer.tsx`。
 *
 * 适配差异:
 *  - 品牌名 "ATELIER" → "WJP 梦可达"
 *  - 链接全部指向 NextDevTpl 现有路由 (#series / #how / #craft / #gallery / /legal)
 *  - 法律页链接到 (marketing)/legal 路由而不是占位 #
 */
const footerLinks = [
  {
    title: "作品集",
    links: [
      { label: "全部作品", href: "/marketing/products" },
      { label: "钥匙扣", href: "/marketing/products#series" },
      { label: "Q 版手办", href: "/marketing/products#series" },
      { label: "冰箱贴", href: "/marketing/products#series" },
    ],
  },
  {
    title: "帮助",
    links: [
      { label: "工作流程", href: "/marketing/products#how" },
      { label: "运费与售后", href: "/legal/shipping" },
      { label: "联系客服", href: "/dashboard/support" },
    ],
  },
  {
    title: "工作室",
    links: [
      { label: "工艺故事", href: "/marketing/products#craft" },
      { label: "批量定制 / 企业", href: "/dashboard/support" },
      { label: "代理商合作", href: "/dashboard/support" },
    ],
  },
  {
    title: "条款",
    links: [
      { label: "隐私政策", href: "/legal/privacy" },
      { label: "服务条款", href: "/legal/terms" },
      { label: "Cookie 设置", href: "/legal/cookies" },
    ],
  },
];

export function StoreFooter() {
  return (
    <footer className="mt-auto bg-background border-t">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Brand */}
          <div className="lg:col-span-4">
            <Link href="/" className="text-xl font-semibold tracking-tight">
              WJP 梦可达
            </Link>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-xs text-pretty">
              AI 渲染、人工精修、整件全彩 3D 打印 ——
              把你的照片变成拿得出手的礼物。
            </p>
          </div>

          {/* Link columns */}
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-8">
            {footerLinks.map((col) => (
              <div key={col.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground mb-4">
                  {col.title}
                </p>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} WJP 梦可达 · 上海工作室
          </p>
          <p className="text-xs text-muted-foreground">每一件都用心做</p>
        </div>
      </div>
    </footer>
  );
}
