"use client";

/**
 * WJP 商店 Header —— 1:1 移植自 atelier `store-header.tsx`,剥离 commerce。
 *
 * 视觉保留(atelier 1:1):
 *  - sticky 顶部 + 滚动后 backdrop-blur (scrolled state + useEffect)
 *  - 移动端 Sheet 菜单 (mobile menu + navLinks + series)
 *  - 桌面端 居中 Logo + 左侧 navLinks + 右侧 Search Input + 登录
 *
 * 适配差异:
 *  - 删除 useCartStore / useCurrencyStore / useFormatPrice / useHasMounted
 *    (commerce 全部归 Medusa,见 [[mooncada-medusa-integration]])
 *  - 删除 Cart 按钮 (ShoppingBag + itemCount badge)
 *  - 删除 Currency 切换 dropdown
 *  - 删除 Search dropdown results (没有 backing 数据)
 *  - 删除 User icon,改为「登录」按钮 (NextDevTpl `/dashboard`)
 *  - navLinks href 从 atelier `#new #keychain #figure #magnet` 改成 NextDevTpl
 *    现有路由(`/marketing/products` 详情 + 根 `/` 锚点)
 *  - navLinks label 中文化 (全部 / 钥匙扣 / Q版手办 / 冰箱贴 / 工艺故事)
 *  - Logo 文本 ATELIER → WJP 梦可达
 *  - Link 来自 `@/i18n/routing` 走 i18n 路由
 */

import { Menu, Search } from "lucide-react";
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
import { Link } from "@/i18n/routing";

import { WJP_SERIES } from "./wjp-store-data";

const navLinks = [
  { label: "全部", href: "/#new" },
  { label: "钥匙扣", href: "/marketing/products" },
  { label: "Q版手办", href: "/marketing/products" },
  { label: "冰箱贴", href: "/marketing/products" },
  { label: "工艺故事", href: "/#craft" },
] as const;

export function WjpStoreHeader() {
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

          {/* Center: logo */}
          <Link
            href="/"
            className="absolute left-1/2 -translate-x-1/2 text-xl font-semibold tracking-tight select-none"
          >
            WJP 梦可达
          </Link>

          {/* Right: search + sign-in (atelier visual 1:1, commerce stripped) */}
          <div className="flex items-center gap-1 flex-1 justify-end">
            {/* Search (visual only —— 没有 backing 数据,见注释) */}
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="搜索作品"
                aria-label="搜索作品"
                className="w-44 lg:w-56 pl-9 pr-3 h-9 bg-muted/50 border-transparent text-sm rounded-md focus-visible:bg-background focus-visible:border-border transition-all"
              />
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

            {/* 登录 (替换 atelier 的 User icon + Cart button) */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex h-9 px-3 text-sm font-medium"
            >
              <Link href="/dashboard">登录</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
