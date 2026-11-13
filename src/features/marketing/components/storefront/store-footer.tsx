"use client";

import { Link } from "@/i18n/routing";

import { ServiceContactDialog } from "./service-contact-dialog";

/**
 * WJP 商店 Footer —— 1:1 移植自 atelier `store-footer.tsx`。
 *
 * 适配差异:
 *  - 品牌名 "ATELIER" → "Mooncoda 梦可达"
 *  - 法律页链接到 /legal 路由而不是占位 #
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
 *
 * 「全部作品」的地址(2026-11-13 改):`/marketing/products` → **`/products`**。
 * 真作品集归位到 `/products`(那个地址原先被模板那套 6 件写死的演示数据
 * 占着,封面全是破图、不能下单)。旧地址 `/marketing/products` 留了 308 桩。
 *
 * 「客服」那一栏(2026-11-13 加的):工作室要求「底部增加客服联系方式,比如
 * 点击后展示客服的微信二维码」⇒ 单独一栏,头一项是**客服微信**(点开弹
 * 二维码,见 `service-contact-dialog.tsx`),另外两项是邮箱和在线工单。
 *
 * ⚠️ **二维码那一项不是 `footerLinks` 里的一行** —— 它是个**按钮**(弹窗的
 * 触发器),不是链接。所以那一栏单独渲染,不混进 `footerLinks` 的结构里。
 */
const footerLinks = [
  {
    title: "作品集",
    links: [
      { label: "全部作品", href: "/products" },
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
      { label: "运费与交期", href: "/legal/shipping" },
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
    // 条款 —— 2026-11-12 换掉了原来那三条。
    //
    // 原来摆的是模板(SaaS 模板)的文档:隐私政策 / 服务条款 / Cookie 设置。
    // 前两份是模板自己的(隐私政策里写的是「生成闪卡」「Anki 包」),
    // 第三条 `/legal/cookies` **压根不是合法 slug**(真 slug 是
    // `cookie-policy`)⇒ 那是个 404。工作室的原话:
    // 「不再展示这些页面，即原项目的页面」。
    //
    // 现在摆的是**工作室自己的**打印服务文档 —— 跟营销页 footer 的
    // 「打印服务」那一栏是同一组。
    title: "条款",
    links: [
      { label: "打印须知", href: "/legal/print-notice" },
      { label: "3D模型设计规范", href: "/legal/design-spec" },
      { label: "售后说明", href: "/legal/after-sales" },
      { label: "下单须知", href: "/legal/print-order-notice" },
    ],
  },
];

/** 客服邮箱 —— 跟 `src/config/site.ts` 的兜底地址一致 */
const SERVICE_EMAIL = "support@mooncoda.com";

export function StoreFooter({ serviceQrUrl }: { serviceQrUrl?: string }) {
  return (
    <footer className="mt-auto bg-background border-t">
      <div className="atelier-container py-12 lg:py-16">
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
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
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

            {/* 客服(2026-11-13)—— 头一项是弹二维码的按钮,不是链接 */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground mb-4">
                客服
              </p>
              <ul className="space-y-2.5">
                <li>
                  <ServiceContactDialog qrUrl={serviceQrUrl ?? ""} />
                </li>
                <li>
                  <a
                    href={`mailto:${SERVICE_EMAIL}`}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    邮箱联系
                  </a>
                </li>
                <li>
                  <Link
                    href="/dashboard/support"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    在线工单
                  </Link>
                </li>
              </ul>
            </div>
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
