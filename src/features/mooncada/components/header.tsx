"use client";

import {
  Bell,
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMooncadaStore } from "@/features/mooncada/lib/store";
import type { UserRole } from "@/features/mooncada/lib/types";
import { ROLE_LABELS } from "@/features/mooncada/lib/types";
import { signOut, useSession } from "@/lib/auth/client";
import { formatDate } from "./shared";

export function Header() {
  const { currentRole, setRole } = useMooncadaStore();
  const { data: session } = useSession();
  const user = session?.user;
  const { theme, setTheme } = useTheme();

  const roles: UserRole[] = ["admin", "agent", "designer", "operator", "user"];

  const roleColors: Record<UserRole, string> = {
    admin: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    agent:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    designer:
      "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    operator: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
    user: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  };

  const handleSignOut = async () => {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/sign-in";
        },
      },
    });
  };

  const displayName = user?.name || user?.email || "用户";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 sm:px-6 flex items-center justify-between gap-4">
      {/* Left: Search */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索订单、模型、任务..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
          />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Role Switcher (demo) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${roleColors[currentRole as UserRole]}`}
              >
                {ROLE_LABELS[currentRole as UserRole]}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              切换角色（演示）
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {roles.map((r) => (
              <DropdownMenuItem
                key={r}
                onClick={() => setRole(r)}
                className="flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${roleColors[r]}`}
                  >
                    {ROLE_LABELS[r]}
                  </span>
                </span>
                {currentRole === r && (
                  <span className="text-emerald-600 text-xs">✓</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Theme switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              {theme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => setTheme("light")}
              className="gap-2 cursor-pointer"
            >
              <Sun className="h-4 w-4" /> 浅色
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("dark")}
              className="gap-2 cursor-pointer"
            >
              <Moon className="h-4 w-4" /> 深色
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("system")}
              className="gap-2 cursor-pointer"
            >
              <Monitor className="h-4 w-4" /> 跟随系统
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="h-9 w-9 relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg hover:bg-muted/60 p-1 pr-2 transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-xs font-medium leading-tight">
                  {displayName}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {user?.email || "-"}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{displayName}</p>
              <p className="text-xs text-muted-foreground">
                {user?.email || "-"}
              </p>
              <Badge variant="outline" className="mt-1.5 text-[10px]">
                {ROLE_LABELS[currentRole as UserRole]}
              </Badge>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              账户信息
            </DropdownMenuLabel>
            <div className="px-2 py-1 text-xs text-muted-foreground space-y-1">
              <p>
                ID: <span className="font-mono">{user?.id || "-"}</span>
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 cursor-pointer">
              <UserIcon className="h-4 w-4" /> 个人资料
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 cursor-pointer">
              <Settings className="h-4 w-4" /> 设置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-rose-600 cursor-pointer"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" /> 退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
