"use client";

/**
 * WJP 商店 Header —— 1:1 移植自 atelier `store-header.tsx` + 接通本仓库的
 * mock commerce(见 architecture-sellbase-integration.md)。
 *
 * 视觉保留(atelier 1:1):
 *  - sticky 顶部 + 滚动后 backdrop-blur
 *  - 移动端 Sheet 菜单 (mobile menu + navLinks + series)
 *  - 桌面端 居中 Logo + 左侧 navLinks + 右侧 Search Input + 登录 + Cart
 *  - framer-motion 微动效:search dropdown opacity+y=8 fade-in、
 *    cart badge scale 弹跳
 *
 * 适配差异:
 *  - Cart 按钮 + count badge:从 `use-cart.itemCount` 取数 + `useCartUi.openCart` 打开抽屉
 *  - Search dropdown:用 `use-products` 拉所有 mock 商品,输入过滤 title / tags,
 *    点结果项 → `useStorefrontModal.setQuickView(product)` 弹 ProductQuickView
 *  - 用 mounted flag 延迟读 use-cart.itemCount(防 SSR/hydration flash)
 *
 * ── 2026-11-05 账号状态 ──────────────────────────────────────────────
 * 之前这里**无条件**渲染「登录」按钮 —— 登录之后回来看,还是「登录」,
 * 用户完全看不出自己已经登录了(而且手机上压根没有登录入口)。
 *
 * 现在按 `useSession()` 分三态:
 *  - pending → 灰色占位(SSR 和客户端首帧一致,不闪)
 *  - 已登录 → 头像 + 下拉(邮箱 / 商城订单 / 打印订单 / 收货地址 / 控制台 /
 *    退出登录)
 *  - 未登录 → 「登录」+ 移动端菜单里的「登录 / 注册」
 *
 * 2026-11-06:下拉里多出「商城订单 / 打印订单 / 收货地址」三项 —— 工作室
 * 要求「打印订单、购物订单、地址管理不放在控制台里面,而是电商首页的用户
 * 头像那里」。这三项指向 `/account/*`,原来的 `/dashboard/*` 地址留了重定向。
 *
 * 头像用 `useSession()` 而不是服务端 cookie 读的 —— 服务端读到的会话在
 * 客户端首帧还不一定一致,那样会 hydration mismatch。`useSession()` 首次
 * 挂载时 `isPending` 为 true,SSR 也是 true,两端渲染同一个占位。
 *
 * 导航 IA(2026-10-31 精简到 4 项):作品 / 流程 / 工艺 / 定制。
 * 标签按 next-intl 的 useLocale() 取 zh / en —— 之前全文件硬编码中文。
 * 桌面端与移动端共用同一份 STORE_NAV,不要在两处各写一遍文案。
 *
 * 2026-10-31 加了第 5 项「克重」(`/pricing` 3D 打印克重计算器):
 * 它是独立路由而不是首页锚点,所以 `kind` 是 `"route"` 而不是 `"anchor"`。
 * 渲染分支不用改 —— header 里是 `kind === "customize" ? button : link`,
 * route 走 link 分支。
 *
 * 2026-11-01 这第 5 项改成「工具」(`/tools` 工具中心):克重计算器不再是
 * 导航直挂的品类,而是工具中心里的一个工具,工具多了也不会把导航撑长。
 *
 * 原来这里是六项(生日 / 毕业 / 纪念 / 节日 / 定制 / 全部),移动端 Sheet 里还
 * 挂着一个「按形态」三项的二级列表 —— 一共九个可点的去处,导航本身成了首页
 * 最复杂的东西。场合四段色带还在首页上(各有自己的锚点),只是不再各占一个
 * 导航位;品类筛选则整个搬到作品集页去了。
 *
 * 「定制」不是链接(2026-10-22):渲染成 `<button>` 开品类选择层,不再跳
 * `/image-gen`(那是登录后的 SaaS 工作台,未登录访客会被 proxy 弹去登录墙)。
 * STORE_NAV 用 `kind` 区分两种渲染分支,桌面 / 移动两处都要跟着分支。
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  Package,
  Search,
  ShoppingBag,
} from "lucide-react";
import { useLocale } from "next-intl";
import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCart, useCartUi } from "@/features/storefront/hooks/use-cart";
import { useProducts } from "@/features/storefront/hooks/use-products";
import { useStorefrontModal } from "@/features/storefront/hooks/use-storefront-modal";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { signOut, useSession } from "@/lib/auth/client";
import { formatCents } from "@/lib/money";

import { STORE_NAV } from "./occasion-data";

/**
 * 导航标签按 locale 取。
 *
 * navLinks 原本硬编码中文(全文件唯一的 i18n 缺口)——这里用 next-intl 的
 * useLocale() 补上,桌面端与移动端 Sheet 共用同一份结果。
 */
function navLabel(item: { label: string; labelEn: string }, isZh: boolean) {
  return isZh ? item.label : item.labelEn;
}

/**
 * 头像里的缩写
 *
 * `name` 优先(取前两个词的首字母);没有名字就退到邮箱的首字母 ——
 * 手机号注册的用户 `name` 可能是空的,那会儿只剩邮箱能认人。
 */
function getInitials(name?: string | null, email?: string | null): string {
  const raw = (name ?? "").trim();
  if (raw) {
    return raw
      .split(/\s+/)
      .map((n) => n[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  const mail = (email ?? "").trim();
  return mail ? (mail[0] ?? "").toUpperCase() : "·";
}

export function WjpStoreHeader() {
  const locale = useLocale();
  const isZh = locale === "zh";

  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const searchRef = React.useRef<HTMLDivElement>(null);

  const { itemCount } = useCart();
  const openCart = useCartUi((s) => s.openCart);
  const setQuickView = useStorefrontModal((s) => s.setQuickView);

  // 账号 —— 登录后要在页面上看得见(2026-11-05)
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const user = session?.user;

  const handleSignOut = async () => {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };
  // 「定制」导航项 —— 开品类选择层(CustomizeEntry → CustomWorkshop),
  // 不再跳 /image-gen(那是登录后的 SaaS 工作台,访客点会撞登录墙)
  const openCustomizePicker = useStorefrontModal((s) => s.openCustomizePicker);

  // mounted flag —— 防 cart count 在 SSR(0) vs client(cookie 持久化)之间 hydration flash
  React.useEffect(() => setMounted(true), []);
  const displayItemCount = mounted ? itemCount : 0;

  // 2026-09-20：登录按钮拼 callbackUrl，登录后回到当前页（而非 /dashboard）
  // 旧版硬编码 href="/dashboard"：未登录用户点登录直接被甩到 dashboard，
  // 跟原本想看的 atelier 商品页断链。改成动态 callbackUrl 透传 pathname。
  //
  // 2026-11-01 修 hydration mismatch：原实现用 `typeof window === "undefined"`
  // 让服务端走 `/sign-in` 分支、客户端走带 callbackUrl 的分支 —— 服务端吐出的
  // HTML（/zh/sign-in）和客户端首帧渲染（/zh/sign-in?callbackUrl=%2Fzh%2Fpricing）
  // 不一致，React 报 "A tree hydrated but some attributes didn't match"。
  //
  // 现在两端算的是同一份值，全程不碰 window：
  //  - locale 用 next-intl 的 useLocale()（NextIntlClientProvider 在 [locale]
  //    layout 层，服务端/客户端都拿得到）
  //  - pathname 用 next-intl 的 usePathname()（SSR 可见，且已去掉 locale 前缀）
  const pathname = usePathname();
  const signInHref = React.useMemo(() => {
    if (pathname === "/sign-in" || pathname === "/sign-up") {
      return "/sign-in";
    }
    const target = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const prefix = locale ? `/${locale}` : "";
    return `/sign-in?callbackUrl=${encodeURIComponent(`${prefix}${target}`)}`;
  }, [pathname, locale]);

  // mock 12 products,limit=50 已覆盖
  const { data: productsResp, isLoading: productsLoading } = useProducts({
    limit: 50,
  });

  const filtered = React.useMemo(() => {
    if (!productsResp?.products) return [];
    const q = searchValue.trim().toLowerCase();
    if (!q) return [];
    return productsResp.products
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.titleEn.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.seriesName.toLowerCase().includes(q) ||
          p.seriesNameEn.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [productsResp, searchValue]);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 点外面关闭 search dropdown
  React.useEffect(() => {
    if (!searchOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [searchOpen]);

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
        scrolled
          ? "bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80"
          : "bg-background"
      }`}
    >
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Left: mobile menu + desktop nav */}
          <div className="flex items-center gap-1 flex-1">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden -ml-2"
                  aria-label="Open menu"
                  type="button"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[320px] sm:w-[380px] p-0 flex flex-col"
              >
                <SheetHeader className="px-6 pt-6 pb-4 border-b">
                  <SheetTitle className="text-xl font-semibold tracking-tight">
                    Mooncoda 梦可达
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex-1 overflow-y-auto flex flex-col px-2 py-4">
                  {STORE_NAV.map((link) =>
                    link.kind === "customize" ? (
                      // 「定制」是动作不是链接 —— 开品类选择层,不跳页(见 occasion-data.ts)
                      <button
                        key={link.id}
                        type="button"
                        onClick={() => {
                          setMobileOpen(false);
                          openCustomizePicker();
                        }}
                        className="px-4 py-3 text-sm font-medium text-left hover:bg-muted transition-colors rounded-md"
                      >
                        {navLabel(link, isZh)}
                      </button>
                    ) : (
                      <Link
                        key={link.id}
                        href={link.href}
                        onClick={() => setMobileOpen(false)}
                        className="px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                      >
                        {navLabel(link, isZh)}
                      </Link>
                    )
                  )}
                </nav>

                {/* 账号 —— 手机上原本没有登录入口(桌面端那个「登录」按钮是
                    `hidden sm:inline-flex`),这里补上 */}
                <div className="border-t px-2 py-3">
                  {sessionPending ? (
                    <div className="h-9 animate-pulse rounded-md bg-muted" />
                  ) : user ? (
                    <div className="flex flex-col">
                      <p className="px-4 pb-2 text-xs text-muted-foreground truncate">
                        {user.name || user.email}
                      </p>
                      <Link
                        href="/account/orders"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                      >
                        <ShoppingBag className="size-4" />
                        {isZh ? "商城订单" : "Store orders"}
                      </Link>
                      <Link
                        href="/account/print-orders"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                      >
                        <Package className="size-4" />
                        {isZh ? "打印订单" : "Print orders"}
                      </Link>
                      <Link
                        href="/account/addresses"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                      >
                        <MapPin className="size-4" />
                        {isZh ? "收货地址" : "Addresses"}
                      </Link>
                      <Link
                        href="/dashboard"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                      >
                        <LayoutDashboard className="size-4" />
                        {isZh ? "控制台" : "Dashboard"}
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileOpen(false);
                          void handleSignOut();
                        }}
                        className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-left hover:bg-muted transition-colors rounded-md"
                      >
                        <LogOut className="size-4" />
                        {isZh ? "退出登录" : "Sign out"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <Link
                        href={signInHref}
                        onClick={() => setMobileOpen(false)}
                        className="px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                      >
                        {isZh ? "登录" : "Sign in"}
                      </Link>
                      <Link
                        href="/sign-up"
                        onClick={() => setMobileOpen(false)}
                        className="px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                      >
                        {isZh ? "注册" : "Sign up"}
                      </Link>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <nav className="hidden lg:flex items-center gap-6">
              {STORE_NAV.map((link) =>
                link.kind === "customize" ? (
                  <button
                    key={link.id}
                    type="button"
                    onClick={openCustomizePicker}
                    className="text-sm font-medium text-foreground/70 hover:text-[var(--primary)] transition-colors"
                  >
                    {navLabel(link, isZh)}
                  </button>
                ) : (
                  <Link
                    key={link.id}
                    href={link.href}
                    className="text-sm font-medium text-foreground/70 hover:text-[var(--primary)] transition-colors"
                  >
                    {navLabel(link, isZh)}
                  </Link>
                )
              )}
            </nav>
          </div>

          {/* Center: logo —— Playfair editorial 字标,汉字回退到 Noto Serif SC */}
          <Link
            href="/"
            className="absolute left-1/2 -translate-x-1/2 text-xl font-medium tracking-tight select-none"
            style={{
              fontFamily:
                "var(--font-atelier-serif), var(--font-atelier-serif-sc), Georgia, serif",
            }}
          >
            Mooncoda 梦可达
          </Link>

          {/* Right: search + sign-in + cart */}
          <div className="flex items-center gap-1 flex-1 justify-end">
            {/* Search with dropdown */}
            <div ref={searchRef} className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none z-10" />
              <Input
                value={searchValue}
                onChange={(event) => {
                  setSearchValue(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder={isZh ? "搜索作品" : "Search pieces"}
                aria-label={isZh ? "搜索作品" : "Search pieces"}
                className="w-44 lg:w-56 pl-9 pr-3 h-9 bg-muted/50 border-transparent text-sm rounded-md focus-visible:bg-background focus-visible:border-border transition-all"
              />

              <AnimatePresence>
                {searchOpen && searchValue.trim() && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full right-0 mt-2 w-80 bg-popover border rounded-md shadow-lg overflow-hidden z-50"
                  >
                    {productsLoading ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        <Loader2 className="inline-block size-4 animate-spin mr-1.5" />
                        {isZh ? "加载中..." : "Loading..."}
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {isZh
                          ? `没有匹配「${searchValue}」的作品`
                          : `No pieces match "${searchValue}"`}
                      </div>
                    ) : (
                      <ul className="divide-y divide-border max-h-96 overflow-y-auto">
                        {filtered.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickView(p);
                                setSearchOpen(false);
                                setSearchValue("");
                              }}
                              className="w-full flex items-center gap-3 p-3 hover:bg-muted/60 transition-colors text-left"
                            >
                              <img
                                src={p.thumbnail}
                                alt={isZh ? p.title : p.titleEn}
                                className="size-12 object-cover rounded-sm bg-muted shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {isZh ? p.title : p.titleEn}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {isZh ? p.seriesName : p.seriesNameEn} ·{" "}
                                  {isZh ? p.typeLabel : p.typeLabelEn}
                                </p>
                              </div>
                              <p className="text-sm font-medium shrink-0">
                                {formatCents(p.basePriceCents, {
                                  locale: isZh ? "zh-CN" : "en",
                                })}
                              </p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              aria-label={isZh ? "搜索" : "Search"}
              type="button"
            >
              <Search className="size-5" />
            </Button>

            {/* 账号 —— 未登录显示「登录」,已登录显示头像 + 邮箱 */}
            {sessionPending ? (
              <div
                className="hidden size-9 animate-pulse rounded-full bg-muted sm:block"
                aria-hidden
              />
            ) : user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={isZh ? "我的账户" : "My account"}
                    className="hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
                  >
                    <Avatar className="size-8">
                      <AvatarImage
                        src={user.image || undefined}
                        alt={user.name || user.email}
                      />
                      <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                        {getInitials(user.name, user.email)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <span className="block text-xs text-muted-foreground">
                      {isZh ? "已登录" : "Signed in"}
                    </span>
                    <span className="block truncate text-sm font-medium">
                      {user.name || user.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* 买家的三样东西 —— 2026-11-06 从控制台搬到这里。
                      工作室的原话:「打印订单、购物订单、地址管理不放在控制台
                      里面,而是电商首页的用户头像那里。」这三个入口指向
                      `/account/*`,不在 `/dashboard` 底下了。
                      「控制台」还留着 —— 那是工具用户的地方(积分 / 画布 / 生图),
                      跟买家那三样是两回事。 */}
                  <DropdownMenuItem asChild>
                    <Link href="/account/orders">
                      <ShoppingBag className="size-4" />
                      {isZh ? "商城订单" : "Store orders"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/account/print-orders">
                      <Package className="size-4" />
                      {isZh ? "打印订单" : "Print orders"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/account/addresses">
                      <MapPin className="size-4" />
                      {isZh ? "收货地址" : "Addresses"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard">
                      <LayoutDashboard className="size-4" />
                      {isZh ? "控制台" : "Dashboard"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleSignOut}>
                    <LogOut className="size-4" />
                    {isZh ? "退出登录" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex h-9 px-3 text-sm font-medium"
              >
                <Link href={signInHref}>{isZh ? "登录" : "Sign in"}</Link>
              </Button>
            )}

            {/* Cart */}
            <Button
              variant="ghost"
              size="icon"
              onClick={openCart}
              aria-label={isZh ? "购物袋" : "Shopping bag"}
              className="relative size-9"
              type="button"
            >
              <ShoppingBag className="size-5" />
              <AnimatePresence>
                {displayItemCount > 0 && (
                  <motion.span
                    key={displayItemCount}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-semibold flex items-center justify-center"
                  >
                    {displayItemCount > 99 ? "99+" : displayItemCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
