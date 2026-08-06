// 外部生图 API Key 类型定义
// 仿 mooncada-source，每个 Key 独立配额、允许效果与成本核算

export interface ExternalApiKey {
  id: string;
  name: string; // 客户名称
  apiKey: string; // 完整 API Key
  maskedKey: string; // 脱敏显示
  status: "active" | "disabled";
  createdAt: string;
  lastUsedAt?: string | undefined;
  totalCalls: number;
  monthlyCalls: number;
  monthlyQuota: number; // 月配额
  cost: number; // 累计成本（CNY）
  allowedMasks: string[]; // 允许使用的效果 maskId 列表
}
