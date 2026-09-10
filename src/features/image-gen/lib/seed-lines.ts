/**
 * 产品线种子数据（2026-09-10）
 *
 * 配合 product-line 重写：
 * - 删旧的 4 条 MOCK_PRODUCT_LINES 前端 mock（PL_001/002/003/004），由 productLine 表接管
 * - 6 条业务化产品线，每条挂到真实的产品形态（吧唧/徽章/钥匙扣/立牌/挂件/冰箱贴）
 * - spec / pricing 字段按 ProductLineSpec / ProductLinePricing 类型组装
 *
 * 由 src/scripts/seed-product-lines.ts 调用 createLineInDb 落库。
 *
 * 设计原则（与 gpt-image 模块 PRODUCT_TYPES 字典对齐）：
 * - productTypeCode 暂不绑（产品线与产品型号是 1:N，不强制 FK），由 productEffect.productTypeCode 决定
 * - sizeRange 单位 cm 与字典一致（避免 mm/cm 混用导致 SpecModal 转换错）
 * - currency 默认 CNY
 */

import type { ProductLine } from "./product-effect-types";

export const SEED_PRODUCT_LINES: ProductLine[] = [
  {
    productLineId: "pl_pin_3d",
    name: "3D 立体吧唧",
    category: "badge",
    description: "58mm / 75mm 圆/方款 3D 浮雕马口铁吧唧，光面+磨砂双工艺",
    coverUrl: "",
    spec: {
      sizeRange: { min: 58, max: 75, unit: "mm" },
      material: ["马口铁", "铝合金"],
      finish: ["光面", "磨砂", "镭射"],
    },
    pricing: {
      basePrice: 8.5,
      currency: "CNY",
      sizeSurcharge: [{ threshold: 65, extra: 1.5 }],
      finishSurcharge: { 镭射: 1.0, 磨砂: 0.5 },
    },
    status: "active",
    sortOrder: 10,
    createdAt: "",
    updatedAt: "",
  },
  {
    productLineId: "pl_leather_badge",
    name: "真皮皮革徽章",
    category: "leather_badge",
    description: "头层牛皮激光雕刻徽章，可外露/PVC 保护/刻字",
    coverUrl: "",
    spec: {
      sizeRange: { min: 4, max: 8, unit: "cm" },
      material: ["头层牛皮", "PU 合成革"],
      finish: ["激光雕刻", "烫金", "丝印"],
    },
    pricing: {
      basePrice: 12.0,
      currency: "CNY",
      sizeSurcharge: [{ threshold: 6, extra: 2.0 }],
      finishSurcharge: { 烫金: 3.0, 激光雕刻: 1.5 },
    },
    status: "active",
    sortOrder: 20,
    createdAt: "",
    updatedAt: "",
  },
  {
    productLineId: "pl_keychain_3d",
    name: "3D 立体钥匙扣",
    category: "keychain",
    description: "PVC / 亚克力 3D 立体钥匙扣，双面图案+金属环",
    coverUrl: "",
    spec: {
      sizeRange: { min: 4, max: 7, unit: "cm" },
      material: ["PVC 软胶", "亚克力", "锌合金"],
      finish: ["双面图案", "单面图案", "透明填充"],
    },
    pricing: {
      basePrice: 9.0,
      currency: "CNY",
      sizeSurcharge: [{ threshold: 5.5, extra: 1.0 }],
      finishSurcharge: { 透明填充: 2.5, 双面图案: 1.5 },
    },
    status: "active",
    sortOrder: 30,
    createdAt: "",
    updatedAt: "",
  },
  {
    productLineId: "pl_acrylic_stand",
    name: "亚克力立牌",
    category: "acrylic_stand",
    description: "透明 / 磨砂亚克力人形立牌，带底座",
    coverUrl: "",
    spec: {
      sizeRange: { min: 8, max: 18, unit: "cm" },
      material: ["透明亚克力", "磨砂亚克力", "彩色亚克力"],
      finish: ["UV 打印", "丝印", "激光切割"],
    },
    pricing: {
      basePrice: 15.0,
      currency: "CNY",
      sizeSurcharge: [
        { threshold: 12, extra: 3.0 },
        { threshold: 15, extra: 5.0 },
      ],
      finishSurcharge: { 激光切割: 4.0, UV打印: 2.0 },
    },
    status: "active",
    sortOrder: 40,
    createdAt: "",
    updatedAt: "",
  },
  {
    productLineId: "pl_resin_pendant",
    name: "树脂挂件",
    category: "pendant",
    description: "UV 树脂灌注挂件，异形 / 半透 / 实色多工艺",
    coverUrl: "",
    spec: {
      sizeRange: { min: 3, max: 6, unit: "cm" },
      material: ["UV 树脂", "滴胶"],
      finish: ["半透明", "实色", "夜光", "闪粉"],
    },
    pricing: {
      basePrice: 6.5,
      currency: "CNY",
      sizeSurcharge: [{ threshold: 4.5, extra: 1.0 }],
      finishSurcharge: { 夜光: 2.0, 闪粉: 1.5 },
    },
    status: "active",
    sortOrder: 50,
    createdAt: "",
    updatedAt: "",
  },
  {
    productLineId: "pl_fridge_magnet",
    name: "PVC 冰箱贴",
    category: "fridge_magnet",
    description: "软磁 / 立体 PVC 冰箱贴，3D 浮雕效果",
    coverUrl: "",
    spec: {
      sizeRange: { min: 5, max: 10, unit: "cm" },
      material: ["软磁 PVC", "硬磁 PVC"],
      finish: ["3D 浮雕", "平面印刷", "夜光"],
    },
    pricing: {
      basePrice: 5.5,
      currency: "CNY",
      sizeSurcharge: [{ threshold: 7, extra: 1.0 }],
      finishSurcharge: { "3D浮雕": 1.5, 夜光: 1.0 },
    },
    status: "active",
    sortOrder: 60,
    createdAt: "",
    updatedAt: "",
  },
];
