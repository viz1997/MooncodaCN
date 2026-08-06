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
export const ROLE_MODULES: Record<UserRole, ModuleKey[]> = {
  admin: [
    "dashboard",
    "generate-workbench",
    "photos",
    "effects",
    "models",
    "orders",
    "tasks",
    "designer",
    "agent",
    "product-effects",
    "product-lines",
    "3d-providers",
    "image-models",
    "public-image-gen",
    "platform-users",
    "sys-logs",
  ],
  agent: ["dashboard", "orders", "agent", "product-lines"],
  designer: [
    "dashboard",
    "generate-workbench",
    "tasks",
    "designer",
    "models",
    "3d-providers",
    "product-lines",
    "product-effects",
    "image-models",
  ],
  operator: ["dashboard", "tasks", "models", "orders", "product-lines"],
  user: [
    "dashboard",
    "generate-workbench",
    "photos",
    "effects",
    "models",
    "orders",
    "product-lines",
  ],
};
