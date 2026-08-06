"use client";

import type { LucideIcon } from "lucide-react";
import {
  Box,
  Boxes,
  ChevronLeft,
  Cpu,
  Globe,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  ListChecks,
  Package,
  Palette,
  ScrollText,
  ShoppingCart,
  Sparkles,
  Store,
  Users,
  Wand2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type ModuleKey,
  ROLE_MODULES,
  useMooncadaStore,
} from "@/features/mooncada/lib/store";
import type { UserRole } from "@/features/mooncada/lib/types";
import { ROLE_LABELS } from "@/features/mooncada/lib/types";
import { cn } from "@/lib/utils";

interface ModuleDef {
  key: ModuleKey;
  label: string;
  icon: LucideIcon;
  description: string;
  group: "通用" | "业务" | "角色中心" | "管理";
}

const MODULE_DEFS: ModuleDef[] = [
  {
    key: "dashboard",
    label: "工作台",
    icon: LayoutDashboard,
    description: "数据概览",
    group: "通用",
  },
  {
    key: "generate-workbench",
    label: "生图工作台",
    icon: Wand2,
    description: "AI生图创作工作台",
    group: "通用",
  },
  {
    key: "photos",
    label: "图片管理",
    icon: ImageIcon,
    description: "上传与查看照片",
    group: "业务",
  },
  {
    key: "effects",
    label: "2D效果图",
    icon: Sparkles,
    description: "AI生成2D效果",
    group: "业务",
  },
  {
    key: "models",
    label: "3D模型",
    icon: Box,
    description: "生成与下载3D模型",
    group: "业务",
  },
  {
    key: "orders",
    label: "订单管理",
    icon: ShoppingCart,
    description: "订单查询与跟踪",
    group: "业务",
  },
  {
    key: "tasks",
    label: "任务管理",
    icon: ListChecks,
    description: "生产任务状态机",
    group: "业务",
  },
  {
    key: "product-effects",
    label: "产品效果",
    icon: Layers,
    description: "管理AI效果与提示词",
    group: "业务",
  },
  {
    key: "product-lines",
    label: "产品线",
    icon: Package,
    description: "管理物理商品产品线",
    group: "业务",
  },
  {
    key: "3d-providers",
    label: "3D引擎",
    icon: Cpu,
    description: "管理3D生成引擎",
    group: "业务",
  },
  {
    key: "image-models",
    label: "生图模型",
    icon: Wand2,
    description: "管理生图大模型",
    group: "业务",
  },
  {
    key: "public-image-gen",
    label: "外部生图",
    icon: Globe,
    description: "外部用户生图入口",
    group: "管理",
  },
  {
    key: "designer",
    label: "设计师中心",
    icon: Palette,
    description: "任务统计与提现",
    group: "角色中心",
  },
  {
    key: "agent",
    label: "代理商中心",
    icon: Store,
    description: "推广与佣金提现",
    group: "角色中心",
  },
  {
    key: "platform-users",
    label: "平台用户",
    icon: Users,
    description: "管理员管理用户",
    group: "管理",
  },
  {
    key: "sys-logs",
    label: "系统日志",
    icon: ScrollText,
    description: "查看系统运行日志",
    group: "管理",
  },
];

const GROUP_ORDER: ModuleDef["group"][] = ["通用", "业务", "角色中心", "管理"];

export function Sidebar() {
  const {
    currentRole,
    activeModule,
    setModule,
    sidebarCollapsed,
    toggleSidebar,
  } = useMooncadaStore();
  const allowedModules = ROLE_MODULES[currentRole as UserRole];
  const visibleModules = MODULE_DEFS.filter((m) =>
    allowedModules.includes(m.key)
  );

  // 按分组归类
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: visibleModules.filter((m) => m.group === g),
  })).filter((g) => g.items.length > 0);

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 h-screen sticky top-0",
        sidebarCollapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 h-16 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shrink-0">
            <Boxes className="h-5 w-5" />
          </div>
          {!sidebarCollapsed && (
            <div className="overflow-hidden">
              <p className="font-bold text-base leading-tight">Mooncada</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                3D打印定制平台
              </p>
            </div>
          )}
        </div>
        <button
          onClick={toggleSidebar}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-sidebar-accent shrink-0"
          aria-label="toggle sidebar"
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform",
              sidebarCollapsed && "rotate-180"
            )}
          />
        </button>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-3">
        <nav className="space-y-4">
          {grouped.map(({ group, items }) => (
            <div key={group}>
              {!sidebarCollapsed && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-3 mb-1.5">
                  {group}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((m) => {
                  const Icon = m.icon;
                  const isActive = activeModule === m.key;
                  return (
                    <button
                      key={m.key}
                      onClick={() => setModule(m.key)}
                      title={sidebarCollapsed ? m.label : undefined}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                        isActive
                          ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/30"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        sidebarCollapsed && "justify-center"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!sidebarCollapsed && (
                        <span className="flex-1 text-left truncate">
                          {m.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Role info footer */}
      {!sidebarCollapsed && (
        <div className="border-t border-sidebar-border p-3 shrink-0">
          <div className="rounded-lg bg-sidebar-accent/50 p-3">
            <p className="text-[10px] text-muted-foreground mb-0.5">当前角色</p>
            <p className="text-sm font-semibold">
              {ROLE_LABELS[currentRole as UserRole]}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
