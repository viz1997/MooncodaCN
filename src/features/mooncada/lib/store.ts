// Mooncada 全局状态管理
import { create } from "zustand";
import type { UserRole } from "./types";

export type ModuleKey =
  | "dashboard"
  | "generate-workbench"
  | "photos"
  | "effects"
  | "models"
  | "orders"
  | "tasks"
  | "designer"
  | "agent"
  | "product-effects"
  | "product-lines"
  | "3d-providers"
  | "image-models"
  | "public-image-gen"
  | "platform-users"
  | "sys-logs";

interface MooncadaState {
  currentRole: UserRole;
  activeModule: ModuleKey;
  sidebarCollapsed: boolean;
  setRole: (role: UserRole) => void;
  setModule: (module: ModuleKey) => void;
  toggleSidebar: () => void;
}

export const useMooncadaStore = create<MooncadaState>((set) => ({
  currentRole: "admin",
  activeModule: "dashboard",
  sidebarCollapsed: false,
  setRole: (role) => set({ currentRole: role, activeModule: "dashboard" }),
  setModule: (module) => set({ activeModule: module }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

// 角色可见的模块映射
// 2026-08-06 收紧：未启用的模块从 ROLE_MODULES 摘除，sidebar 自动隐藏
export const ROLE_MODULES: Record<UserRole, ModuleKey[]> = {
  admin: ["orders", "product-effects"],
  agent: ["orders"],
  designer: ["product-effects"],
  operator: ["orders"],
  user: ["orders", "product-effects"],
};
