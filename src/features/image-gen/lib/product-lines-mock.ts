// 产品线 Mock 数据
// 仿 mooncada-source MOCK_PRODUCT_LINES，简化字段
// 前端 mock 演示，后端接入留后续阶段

export interface MockProductLine {
  productLineId: string;
  name: string;
  category: string;
  status: "active" | "inactive";
}

export const MOCK_PRODUCT_LINES: MockProductLine[] = [
  {
    productLineId: "PL_001",
    name: "浮雕吧唧徽章",
    category: "badge",
    status: "active",
  },
  {
    productLineId: "PL_002",
    name: "亚克力钥匙扣",
    category: "keychain",
    status: "active",
  },
  {
    productLineId: "PL_003",
    name: "树脂挂件",
    category: "charm",
    status: "active",
  },
  {
    productLineId: "PL_004",
    name: "PVC 软胶冰箱贴",
    category: "fridge-magnet",
    status: "inactive",
  },
];
