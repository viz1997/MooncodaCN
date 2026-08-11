// Mooncada Mock 数据 - 临时最小 stub（2026-08-06）
// 原文件 1379 行含大量 mock 数据，因 noUncheckedIndexedAccess + exactOptionalPropertyTypes 双重严格
// 触发数十个未定义访问 / 类型不兼容错误。mooncada 业务模块已全部 stub 成"暂未启用"，
// 仅 agent-prompts.ts 还会引用此处空数组来构造 prompt 字符串（空数组下模板渲染安全）。
import type {
  DashboardStats,
  DesignerStats,
  Effect2D,
  Model3D,
  Order,
  Photo,
  PlatformUser,
  ProductEffect,
  ProductLine,
  ProxyInfo,
  ProxyWithdrawal,
  SysLog,
  Task,
  User,
  Withdrawal,
} from "./types";

// 占位：业务模块全部 stub，agent 组件全部 stub，所有 mock 数组暂为空
// 真实数据迁移到 gpt-image / image-gen 模块（Drizzle + JSON 持久化）

export const MOCK_USERS: User[] = [];
export const MOCK_PHOTOS: Photo[] = [];
export const MOCK_PRODUCT_EFFECTS: ProductEffect[] = [];
export const MOCK_EFFECTS: Effect2D[] = [];
export const MOCK_MODELS: Model3D[] = [];
export const MOCK_ORDERS: Order[] = [];
export const MOCK_TASKS: Task[] = [];
export const MOCK_DESIGNER_STATS = {} as DesignerStats;
export const MOCK_WITHDRAWALS: Withdrawal[] = [];
export const MOCK_PROXY_INFO = {} as ProxyInfo;
export const MOCK_PROXY_WITHDRAWALS: ProxyWithdrawal[] = [];
export const MOCK_PLATFORM_USERS: PlatformUser[] = [];
export const MOCK_SYS_LOGS: SysLog[] = [];
export const MOCK_PRODUCT_LINES: ProductLine[] = [];
export const MOCK_DASHBOARD_STATS = {} as DashboardStats;
