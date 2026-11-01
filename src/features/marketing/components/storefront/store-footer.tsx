"use client";

import { Link } from "@/i18n/routing";

/**
 * WJP 商店 Footer —— 1:1 移植自 atelier `store-footer.tsx`。
 *
 * 适配差异:
 *  - 品牌名 "ATELIER" → "Mooncoda 梦可达"
 *  - 法律页链接到 (marketing)/legal 路由而不是占位 #
 *
 * 锚点(2026-10-31 修正):
 *  - 原来「钥匙扣 / Q 版手办 / 冰箱贴」三项全指向 `/marketing/products#series`
 *    —— 页面上**根本没有** id="series" 的元素(SeriesShowcase 段是
 *    id="categories"),点过去只会跳到页顶。三项品类链接整个删掉:作品集页
 *    顶部的筛选 chip 本身就是活的品类入口,footer 再列一份是死链接的复制品。
 *  - 场合四项指向首页的四段色带(#birthday / #graduation / #anniversary /
 *    #seasonal)。2026-10-31 首页导航精简到 4 项后,场合不再占导航位,但四段
 *    色带仍在首页上 —— footer 是它们最自然的入口。
 *  - 「工作流程」「工艺故事」指向当前页面自己的锚点(#how / #craft)。这个
 *    footer 只出现在 atelier 路由组(首页 + 商品详情页),两处都有这两个段。
 *  - 「工具中心」指向公开页 `/tools`(2026-11-01 起克重计算器 + 模型检查
 *    都收在工具中心里)。放在 footer 而不是顶部导航 —— 顶部导航已经有一个
 *    「工具」位(wjp-store-header 的 STORE_NAV),footer 再列一份是死链接
 *    的复制品。
 */
const footerLinks = [
  {
    title: "作品集",
    links: [
      { label: "全部作品", href: "/marketing/products" },
      { label: "生日礼物", href: "/#birthday" },
      { label: "毕业季", href: "/#graduation" },
      { label: "纪念日", href: "/#anniversary" },
      { label: "节日限定", href: "/#seasonal" },
    ],
  },
  {
    title: "帮助",
    links: [
      { label: "工作流程", href: "/#how" },
      { label: "工具中心", href: "/tools" },
      { label: "运费与售后", href: "/legal/shipping" },
      { label: "联系客服", href: "/dashboard/support" },
    ],
  },
  {
    title: "工作室",
    links: [
      { label: "工艺故事", href: "/#craft" },
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
              Mooncoda 梦可达
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
            © {new Date().getFullYear()} Mooncoda 梦可达
          </p>
          <p className="text-xs text-muted-foreground">每一件都用心做</p>
        </div>
      </div>
    </footer>
  );
}
