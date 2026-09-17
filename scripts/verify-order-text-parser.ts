/**
 * 2026-09-15：order-text-parser 验证脚本 —— 不走 vitest setup（测试 DB 在沙箱里
 * 不可达），直接 import 跑测试数据。本脚本是一次性的纯函数冒烟，下次改 parser 时
 * 跑一次对照预期；CI 上有完整 vitest + DB 环境，unit test 见
 * src/test/image-gen/order-text-parser.test.ts。
 *
 * 用法：pnpm tsx scripts/verify-order-text-parser.ts
 */

import { parseOrderText } from "@/features/image-gen/lib/order-text-parser";

interface Case {
  name: string;
  text: string;
  expect: Record<string, string | null>;
}

const cases: Case[] = [
  // ============ platform 识别 ============
  {
    name: "平台 - 淘宝",
    text: "淘宝订单 4cm 钥匙扣",
    expect: { platform: "taobao" },
  },
  {
    name: "平台 - 天猫",
    text: "天猫店铺 CM 钥匙扣 4cm",
    expect: { platform: "taobao" },
  },
  {
    name: "平台 - 小红书",
    text: "小红书 4cm",
    expect: { platform: "xiaohongshu" },
  },
  {
    name: "平台 - RED",
    text: "RED app 4cm",
    expect: { platform: "xiaohongshu" },
  },
  {
    name: "平台 - 抖音",
    text: "抖音 xxx 钥匙扣 40mm",
    expect: { platform: "douyin" },
  },
  {
    name: "平台 - 独立站",
    text: "独立站订单 4cm",
    expect: { platform: "independent_site" },
  },
  {
    name: "平台 - 国内红人",
    text: "国内红人 4cm",
    expect: { platform: "domestic_influencer" },
  },
  {
    name: "平台 - 国外红人",
    text: "influencer 4cm",
    expect: { platform: "foreign_influencer" },
  },
  {
    name: "平台 - 合作方",
    text: "合作方渠道 4cm",
    expect: { platform: "partner" },
  },
  {
    name: "平台 - 营销",
    text: "营销推广活动 4cm",
    expect: { platform: "marketing" },
  },

  // ============ size 识别 — cm ============
  { name: "尺寸 - 4cm", text: "4cm 钥匙扣", expect: { productSize: "4" } },
  { name: "尺寸 - 4 cm", text: "4 cm 钥匙扣", expect: { productSize: "4" } },
  { name: "尺寸 - 4CM", text: "4CM 钥匙扣", expect: { productSize: "4" } },
  { name: "尺寸 - 4厘米", text: "4厘米 钥匙扣", expect: { productSize: "4" } },
  { name: "尺寸 - 8cm", text: "8cm", expect: { productSize: "8" } },
  { name: "尺寸 - 11cm", text: "11cm", expect: { productSize: "11" } },
  { name: "尺寸 - 18cm", text: "18cm", expect: { productSize: "18" } },
  { name: "尺寸 - 4cm装", text: "钥匙扣 4cm装", expect: { productSize: "4" } },
  { name: "尺寸 - 6cm款", text: "钥匙扣 6cm款", expect: { productSize: "6" } },
  {
    name: "尺寸 - 3cm 字典外",
    text: "3cm 钥匙扣",
    expect: { productSize: null },
  },
  {
    name: "尺寸 - 7cm 字典外",
    text: "7cm 钥匙扣",
    expect: { productSize: null },
  },
  {
    name: "尺寸 - 20cm 字典外",
    text: "20cm 钥匙扣",
    expect: { productSize: null },
  },

  // ============ size 识别 — mm → cm (2026-09-15 新增) ============
  {
    name: "尺寸 - 40mm → 4cm",
    text: "钥匙扣 40mm",
    expect: { productSize: "4" },
  },
  {
    name: "尺寸 - 50mm → 5cm",
    text: "钥匙扣 50mm",
    expect: { productSize: "5" },
  },
  {
    name: "尺寸 - 60mm → 6cm",
    text: "钥匙扣 60mm",
    expect: { productSize: "6" },
  },
  {
    name: "尺寸 - 80mm → 8cm",
    text: "钥匙扣 80mm",
    expect: { productSize: "8" },
  },
  {
    name: "尺寸 - 100mm → 10cm",
    text: "钥匙扣 100mm",
    expect: { productSize: "10" },
  },
  {
    name: "尺寸 - 110mm → 11cm",
    text: "钥匙扣 110mm",
    expect: { productSize: "11" },
  },
  {
    name: "尺寸 - 120mm → 12cm",
    text: "钥匙扣 120mm",
    expect: { productSize: "12" },
  },
  {
    name: "尺寸 - 150mm → 15cm",
    text: "钥匙扣 150mm",
    expect: { productSize: "15" },
  },
  {
    name: "尺寸 - 180mm → 18cm",
    text: "钥匙扣 180mm",
    expect: { productSize: "18" },
  },
  {
    name: "尺寸 - 40MM 大写",
    text: "钥匙扣 40MM",
    expect: { productSize: "4" },
  },
  {
    name: "尺寸 - 40Mm 大小写",
    text: "钥匙扣 40Mm",
    expect: { productSize: "4" },
  },
  {
    name: "尺寸 - 40毫米 中文",
    text: "钥匙扣 40毫米",
    expect: { productSize: "4" },
  },
  {
    name: "尺寸 - 20mm 字典外",
    text: "钥匙扣 20mm",
    expect: { productSize: null },
  },
  {
    name: "尺寸 - 200mm 字典外",
    text: "钥匙扣 200mm",
    expect: { productSize: null },
  },
  {
    name: "尺寸 - 45mm 非10倍数",
    text: "钥匙扣 45mm",
    expect: { productSize: null },
  },
  {
    name: "尺寸 - 5mm 1位数",
    text: "钥匙扣 5mm",
    expect: { productSize: null },
  },
  {
    name: "尺寸 - cm 优先于 mm",
    text: "钥匙扣 4cm 40mm",
    expect: { productSize: "4" },
  },

  // ============ productType 识别 ============
  {
    name: "型号 - CM 钥匙扣",
    text: "CM 钥匙扣",
    expect: { productTypeCode: "R" },
  },
  {
    name: "型号 - CM 异性钥匙扣",
    text: "CM 异性钥匙扣",
    expect: { productTypeCode: "A" },
  },
  {
    name: "型号 - CM 冰箱贴",
    text: "CM 冰箱贴",
    expect: { productTypeCode: "P" },
  },
  {
    name: "型号 - CM 相框",
    text: "CM 相框",
    expect: { productTypeCode: "RM" },
  },
  {
    name: "型号 - CM 皮革徽章",
    text: "CM 皮革徽章",
    expect: { productTypeCode: "LB" },
  },
  { name: "型号 - CM 手办", text: "CM 手办", expect: { productTypeCode: "M" } },
  {
    name: "型号 - 钥匙扣无CM前缀（字典外）",
    text: "钥匙扣 4cm",
    expect: { productTypeCode: null },
  },

  // ============ leatherColor 识别 ============
  {
    name: "颜色 - 棕色",
    text: "皮革徽章 棕色",
    expect: { leatherColor: "brown" },
  },
  {
    name: "颜色 - 黑色",
    text: "皮革徽章 黑色",
    expect: { leatherColor: "black" },
  },
  {
    name: "颜色 - 酒红",
    text: "皮革徽章 酒红",
    expect: { leatherColor: "red" },
  },
  {
    name: "颜色 - 藏青",
    text: "皮革徽章 藏青",
    expect: { leatherColor: "navy" },
  },
  {
    name: "颜色 - 皮革原色",
    text: "皮革徽章 皮革原色",
    expect: { leatherColor: "natural" },
  },
  {
    name: "颜色 - 紫色 字典外",
    text: "皮革徽章 紫色",
    expect: { leatherColor: null },
  },

  // ============ accessoryCode 识别 ============
  {
    name: "配件 - 皮套",
    text: "钥匙扣 皮套",
    expect: { accessoryCode: "leather" },
  },
  {
    name: "配件 - 皮革",
    text: "钥匙扣 皮革",
    expect: { accessoryCode: "leather" },
  },
  {
    name: "配件 - 皮质",
    text: "钥匙扣 皮质",
    expect: { accessoryCode: "leather" },
  },
  {
    name: "配件 - 金属",
    text: "钥匙扣 金属",
    expect: { accessoryCode: "metal" },
  },
  {
    name: "配件 - 金属皮革扣（金属优先）",
    text: "钥匙扣 金属皮革扣",
    expect: { accessoryCode: "metal" },
  },
  { name: "配件 - 无", text: "钥匙扣 4cm", expect: { accessoryCode: null } },

  // ============ orderNo 识别 ============
  {
    name: "订单号 - 淘宝带标签",
    text: "订单编号：1234567890123456\n4cm 钥匙扣 皮套",
    expect: { platformOrderNo: "1234567890123456" },
  },
  {
    name: "订单号 - 小红书 XHS 前缀",
    text: "小红书 XHS12345abcde\n4cm 钥匙扣",
    expect: { platformOrderNo: "XHS12345abcde" },
  },
  {
    name: "订单号 - 抖音 dy 前缀",
    text: "抖音 dy123456789012345\n4cm 钥匙扣",
    expect: { platformOrderNo: "dy123456789012345" },
  },
  {
    name: "订单号 - 无",
    text: "4cm 钥匙扣",
    expect: { platformOrderNo: null },
  },

  // ============ 用户原话 case ============
  {
    name: "用户原话 抖音钥匙扣40mm皮套",
    text: "抖音：xxx\n钥匙扣\n40mm / 皮套+实物外露可触摸",
    expect: {
      platform: "douyin",
      productSize: "4",
      accessoryCode: "leather",
      productTypeCode: null,
      platformOrderNo: null,
      leatherColor: null,
    },
  },

  // ============ 边界 ============
  {
    name: "边界 - 空文本",
    text: "",
    expect: {
      platform: null,
      platformOrderNo: null,
      productTypeCode: null,
      productSize: null,
      leatherColor: null,
      accessoryCode: null,
    },
  },
  {
    name: "边界 - 纯空白",
    text: "   \n\t  ",
    expect: {
      platform: null,
      productSize: null,
      accessoryCode: null,
    },
  },
  {
    name: "边界 - 乱码",
    text: "@@##$$%^&*()",
    expect: { platform: null, productSize: null },
  },
  {
    name: "边界 - 不写备注/刻字/外露/PVC（设计原则）",
    // 注意：productType 命中要求 PRODUCT_TYPES.name 含 "CM " 前缀（"CM 皮革徽章"）。
    // 用户粘的纯文本通常不带 CM 前缀，所以这块期望是 null —— 设计原则是只
    // 写「订单商品规格」字段（型号/尺寸/颜色/配件），用户意图/定制能力（刻字/
    // 备注/外露/PVC）留给 SpecModal 手动勾选。
    text: "皮革徽章 4cm 棕色\n刻字：生日快乐\n备注：加急\n外露：可触摸\nPVC：需要",
    expect: {
      productTypeCode: null,
      productSize: "4",
      leatherColor: "brown",
    },
  },
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const c of cases) {
  const r = parseOrderText(c.text);
  const got: Record<string, string | null> = {
    platform: r.platform,
    platformOrderNo: r.platformOrderNo,
    productTypeCode: r.productTypeCode,
    productSize: r.productSize,
    leatherColor: r.leatherColor,
    accessoryCode: r.accessoryCode,
  };

  let ok = true;
  const mismatches: string[] = [];
  for (const [k, expected] of Object.entries(c.expect)) {
    if (got[k] !== expected) {
      ok = false;
      mismatches.push(
        `${k}: expect=${expected ?? "null"} got=${got[k] ?? "null"}`
      );
    }
  }

  if (ok) {
    pass++;
    console.log(`  ✓ ${c.name}`);
  } else {
    fail++;
    failures.push(
      `✗ ${c.name}\n    text: ${JSON.stringify(c.text)}\n    ${mismatches.join(" / ")}`
    );
    console.log(`  ✗ ${c.name}`);
    console.log(`    ${mismatches.join(" / ")}`);
  }
}

console.log(`\n总计 ${cases.length} 例：✓ ${pass} pass / ✗ ${fail} fail`);
if (fail > 0) {
  console.log("\n失败明细：");
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
