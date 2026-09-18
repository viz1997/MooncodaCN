"use client";

/**
 * WJP 商店 Header —— 1:1 移植自 atelier `store-header.tsx` + 接通 mock Medusa
 * commerce(matching [[wjp-mock-medusa-storefront]])。
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
 *  - 删除 User icon,改为「登录」按钮
 *  - navLinks href 与中文化保持
 *  - 用 mounted flag 延迟读 use-cart.itemCount(防 SSR/hydration flash)
 */

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Menu, Search, ShoppingBag } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";
import { useCart, useCartUi } from "@/features/storefront/hooks/use-cart";
import { useProducts } from "@/features/storefront/hooks/use-products";
import { useStorefrontModal } from "@/features/storefront/hooks/use-storefront-modal";
import { Link } from "@/i18n/routing";

import { WJP_SERIES } from "./wjp-store-data";

const navLinks = [
  { label: "全部", href: "/#new" },
  { label: "钥匙扣", href: "/#keychain" },
  { label: "Q版手办", href: "/#figure" },
  { label: "冰箱贴", href: "/#magnet" },
  { label: "工艺故事", href: "/#craft" },
] as const;

export function WjpStoreHeader() {
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const searchRef = React.useRef<HTMLDivElement>(null);

  const { itemCount } = useCart();
  const openCart = useCartUi((s) => s.openCart);
  const setQuickView = useStorefrontModal((s) => s.setQuickView);

  // mounted flag —— 防 cart count 在 SSR(0) vs client(cookie 持久化)之间 hydration flash
  React.useEffect(() => setMounted(true), []);
  const displayItemCount = mounted ? itemCount : 0;

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
          p.seriesName.toLowerCase().includes(q)
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
              <SheetContent side="left" className="w-[320px] sm:w-[380px] p-0">
                <SheetHeader className="px-6 pt-6 pb-4 border-b">
                  <SheetTitle className="text-xl font-semibold tracking-tight">
                    WJP 梦可达
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col px-2 py-4">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="px-4 py-3 text-sm font-medium hover:bg-muted transition-colors rounded-md"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <div className="border-t my-3" />
                  <p className="px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    系列
                  </p>
                  {WJP_SERIES.map((s) => (
                    <Link
                      key={s.id}
                      href={`/#${s.id}`}
                      onClick={() => setMobileOpen(false)}
                      className="px-4 py-3 text-sm hover:bg-muted transition-colors rounded-md flex items-center gap-2"
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: s.accent }}
                      />
                      {s.name}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>

            <nav className="hidden lg:flex items-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Center: logo —— Playfair editorial 字标,atelier 1:1 风格 */}
          <Link
            href="/"
            className="absolute left-1/2 -translate-x-1/2 text-xl font-semibold tracking-tight select-none"
            style={{ fontFamily: "var(--font-atelier-serif), Georgia, serif" }}
          >
            WJP 梦可达
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
                placeholder="搜索作品"
                aria-label="搜索作品"
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
                        加载中...
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        没有匹配「{searchValue}」的作品
                      </div>
                    ) : (
                      <ul className="divide-y divide-border max-h-96 overflow-y-auto">
                        {filtered.map((p) => (
                          // biome-ignore lint/a11y/useSemanticElements: ul > li > button 复合结构
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
                                alt={p.title}
                                className="size-12 object-cover rounded-sm bg-muted shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {p.title}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {p.seriesName} · {p.typeLabel}
                                </p>
                              </div>
                              <p className="text-sm font-medium shrink-0">
                                {formatPriceCNY(p.basePriceCents / 100)}
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
              aria-label="搜索"
              type="button"
            >
              <Search className="size-5" />
            </Button>

            {/* 登录 */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex h-9 px-3 text-sm font-medium"
            >
              <Link href="/dashboard">登录</Link>
            </Button>

            {/* Cart */}
            <Button
              variant="ghost"
              size="icon"
              onClick={openCart}
              aria-label="购物袋"
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
                    className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-foreground text-background text-[10px] font-semibold flex items-center justify-center"
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
