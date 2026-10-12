// 外部生图 API Key Mock 数据
// 仿 mooncada-source 设计：每个 Key 对应一个外部客户，独立配额与允许效果
// 前端 mock 演示，后端接入留后续阶段

import type { ExternalApiKey } from "./external-api-keys-types";

export const MOCK_EXTERNAL_API_KEYS: ExternalApiKey[] = [
  {
    id: "ak_001",
    name: "合作伙伴A·深圳文创",
    apiKey: "mk_public_a1b2c3d4e5f6g7h8i9j0k1l2m3n4",
    maskedKey: "mk_public_a1b2****n4",
    status: "active",
    createdAt: "2026-06-01T10:00:00Z",
    lastUsedAt: "2026-07-17T09:30:00Z",
    totalCalls: 1280,
    monthlyCalls: 320,
    monthlyQuota: 500,
    cost: 76.8,
    allowedMasks: ["MASK_001", "MASK_002", "MASK_005"],
  },
  {
    id: "ak_002",
    name: "合作伙伴B·广州电商",
    apiKey: "mk_public_x9y8z7w6v5u4t3s2r1q0p9o8n7m6",
    maskedKey: "mk_public_x9y8****m6",
    status: "active",
    createdAt: "2026-05-15T14:00:00Z",
    lastUsedAt: "2026-07-17T08:15:00Z",
    totalCalls: 3450,
    monthlyCalls: 890,
    monthlyQuota: 1000,
    cost: 207.0,
    allowedMasks: ["MASK_001", "MASK_002", "MASK_003", "MASK_005"],
  },
  {
    id: "ak_003",
    name: "试用客户C·北京",
    apiKey: "mk_public_q1w2e3r4t5y6u7i8o9p0a1s2d3f4",
    maskedKey: "mk_public_q1w2****f4",
    status: "disabled",
    createdAt: "2026-07-01T09:00:00Z",
    lastUsedAt: "2026-07-10T16:00:00Z",
    totalCalls: 45,
    monthlyCalls: 45,
    monthlyQuota: 100,
    cost: 2.7,
    allowedMasks: ["MASK_001"],
  },
];
