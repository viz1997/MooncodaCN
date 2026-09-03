"use client";

/**
 * 2026-09-03：代理商 portal 侧边栏（ToB 自下单 / (agent) route group）。
 *
 * 仿 AdminSidebar 的形态（fixed left-0 / 顶 logo / 中 nav / 底 popover），
 * 但去掉 admin 专有的所有菜单，加 agent 自己的两个入口（订单列表 / 新建
 * 订单）和顶部紫色品牌色（与 admin 的红色 badge 区分）。
 *
 * 当前菜单（占位，后续可扩）：
 * - 我的订单 → /agent/orders
 * - 新建订单 → /agent/orders/new
 *
 * 不引入 adminConfig 的 sidebarNav，因为配置文件的语义是 admin；
 * agent 自己的菜单硬编码在本组件（仅 2 项，配置化得不偿失）。
 */

import { Avatar, Divider, Popover } from "antd";
import {
  Briefcase,
  ChevronsUpDown,
  LogOut,
  Monitor,
  Moon,
  PackagePlus,
  Sun,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { siteConfig } from "@/config";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { signOut, useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// 2026-09-03：硬编码 agent 导航 —— 与 adminConfig 解耦
const NAV_ITEMS: NavItem[] = [
  { href: "/agent/orders", label: "我的订单", icon: Briefcase },
  { href: "/agent/orders/new", label: "新建订单", icon: PackagePlus },
];

export function AgentSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("AdminSidebar");

  const getNavTitle = (title: string): string => {
    // 复用 admin 的 i18n key（"我的订单" 等还没单独翻译；先 fallback 原文）
    const titleMap: Record<string, string> = {
      我的订单: t("nav.gptImageOrders") || "我的订单",
      新建订单: "新建订单",
    };
    return titleMap[title] || title;
  };

  const { data: session } = useSession();
  const user = session?.user;

  const [theme, setTheme] = useState<Theme>("system");
  const [open, setOpen] = useState(false);

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const handleSignOut = async () => {
    setOpen(false);
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-violet-950 text-violet-50">
      {/* Logo - Agent 标识（紫色系区别 admin） */}
      <div className="flex h-14 items-center border-b border-violet-800 px-4">
        <Link
          href="/agent/orders"
          className="flex items-center gap-2 text-lg font-bold tracking-tight"
        >
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative logo */}
          <svg
            className="h-6 w-6 shrink-0 text-violet-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="rounded bg-violet-600 px-2 py-0.5 text-xs font-medium text-white">
            Agent
          </span>
          {siteConfig.name}
        </Link>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 overflow-y-auto p-4">
        <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-violet-300">
          我的工作台
        </p>
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            // /agent/orders/new 命中"/agent/orders"前缀会同时高亮"我的订单"，
            // 用 exact match 避免"新建订单"页时"我的订单"也跟着高亮
            const isActive =
              pathname === item.href ||
              (item.href !== "/agent/orders" &&
                pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-violet-800 text-white"
                    : "text-violet-200 hover:bg-violet-800 hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
                {getNavTitle(item.label)}
              </Link>
            );
          })}
        </div>

        {/* 返回 dashboard */}
        <div className="mt-6 pt-4 border-t border-violet-800">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-violet-300 hover:bg-violet-800 hover:text-white transition-colors"
          >
            {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            返回个人工作台
          </Link>
        </div>
      </nav>

      {/* 用户信息区域（popover 复用 admin 的形态） */}
      <div className="border-t border-violet-800 p-4">
        {user ? (
          <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="topLeft"
            content={
              <div className="w-64">
                <div className="flex items-center gap-3 p-4">
                  <Avatar
                    src={user.image || undefined}
                    alt={user.name}
                    size={40}
                    className="!bg-violet-600 !text-white"
                  >
                    {getInitials(user.name)}
                  </Avatar>
                  <div className="flex-1 truncate">
                    <p className="font-medium">{user.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </div>

                <Divider className="!my-0" />

                {/* 主题切换 */}
                <div className="flex items-center justify-center gap-1 p-3">
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                      theme === "light"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    title={t("lightMode")}
                  >
                    <Sun className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                      theme === "dark"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    title={t("darkMode")}
                  >
                    <Moon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("system")}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                      theme === "system"
                        ? "bg-violet-100 text-violet-600 dark:bg-violet-900 dark:text-violet-300"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    title={t("followSystem")}
                  >
                    <Monitor className="h-4 w-4" />
                  </button>
                </div>

                <Divider className="!my-0" />

                <div className="p-2">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    {t("signOut")}
                  </button>
                </div>
              </div>
            }
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-violet-800 transition-colors"
            >
              <Avatar
                src={user.image || undefined}
                alt={user.name}
                size={32}
                className="!bg-violet-600 !text-white !text-xs"
              >
                {getInitials(user.name)}
              </Avatar>
              <div className="flex-1 truncate text-left">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{user.name}</p>
                  <span className="rounded bg-violet-600/30 px-1.5 py-0.5 text-xs font-medium text-violet-200">
                    Agent
                  </span>
                </div>
                <p className="truncate text-xs text-violet-300">{user.email}</p>
              </div>
              <ChevronsUpDown className="h-4 w-4 text-violet-400" />
            </button>
          </Popover>
        ) : (
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="h-8 w-8 animate-pulse rounded-full bg-violet-800" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-20 animate-pulse rounded bg-violet-800" />
              <div className="h-3 w-32 animate-pulse rounded bg-violet-800" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
