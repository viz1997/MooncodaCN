// 产品线 Mock 数据（dev fallback）
// 2026-09-10：product_line 表已接管正式数据；MOCK_PRODUCT_LINES 保留作为
// admin product-effect-form / product-effects-admin-view 在 DB 无数据时
// 的 dev 兜底，避免本地无数据库时表单/列表空跑。生产环境不会触发此分支。

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
