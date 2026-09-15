/**
 * 订单文本智能识别器（order-text-parser）测试
 *
 * 2026-09-15 补：
 * - mm → cm 换算（用户原话「40mm 无法自动识别为 4cm」）
 * - inferAccessory 「金属」必须在「皮」之前判断
 *
 * 测试覆盖：
 * 1. platform 识别（淘宝/天猫/小红书/抖音/独立站/红人/合作/营销）
 * 2. orderNo 识别（淘宝 15-18 位、小红书 XHS 前缀、抖音 19 位 / dy 前缀）
 * 3. productType 识别（PRODUCT_TYPES 字典 name 命中）
 * 4. size 识别：cm / 厘米 / CM 大小写 / 中文 cm 后缀 / mm → cm
 * 5. leatherColor 识别（LEATHER_COLORS 字典 name 命中）
 * 6. accessoryCode 识别（金属优先 / 皮套/皮革/皮质）
 * 7. 用户原话 case：「抖音 xxx 钥匙扣 40mm 皮套+实物外露可触摸」
 * 8. 空文本 / 无效输入
 *
 * 不测：
 * - 数据无关边界（如脏数据），由业务侧 schema 校验
 * - 不写备注 / 刻字 / 皮革外露 / PVC 保护（解析器 line 24-25 设计原则，故意不写）
 */

import { describe, expect, it } from "vitest";

import { parseOrderText } from "@/features/image-gen/lib/order-text-parser";

describe("order-text-parser / platform 识别", () => {
  it("应该识别淘宝 / 天猫", () => {
    const r1 = parseOrderText("淘宝订单 4cm 钥匙扣");
    expect(r1.platform).toBe("taobao");
    expect(r1.inferredFields.has("platform")).toBe(true);

    const r2 = parseOrderText("天猫店铺 CM 钥匙扣 4cm");
    expect(r2.platform).toBe("taobao");
  });

  it("应该识别小红书 / RED", () => {
    expect(parseOrderText("小红书 4cm").platform).toBe("xiaohongshu");
    expect(parseOrderText("RED app 4cm").platform).toBe("xiaohongshu");
  });

  it("应该识别抖音 / tiktok", () => {
    expect(parseOrderText("抖音 xxx 钥匙扣 40mm").platform).toBe("douyin");
    expect(parseOrderText("TikTok 4cm").platform).toBe("douyin");
  });

  it("应该识别独立站 / 红人 / 合作 / 营销", () => {
    expect(parseOrderText("独立站订单 4cm").platform).toBe("independent_site");
    expect(parseOrderText("国内红人 4cm").platform).toBe("domestic_influencer");
    expect(parseOrderText("influencer 4cm").platform).toBe(
      "foreign_influencer"
    );
    expect(parseOrderText("合作方渠道 4cm").platform).toBe("partner");
    expect(parseOrderText("营销推广活动 4cm").platform).toBe("marketing");
  });

  it("关键字都没命中 → platform null", () => {
    const r = parseOrderText("Random text 4cm no platform keyword");
    expect(r.platform).toBeNull();
    expect(r.inferredFields.has("platform")).toBe(false);
  });
});

describe("order-text-parser / orderNo 识别", () => {
  it("应该匹配淘宝订单详情页『订单编号：xxx』标签", () => {
    const r = parseOrderText("订单编号：1234567890123456\n4cm 钥匙扣 皮套");
    expect(r.platformOrderNo).toBe("1234567890123456");
  });

  it("应该匹配淘宝 15-19 位数字", () => {
    const r = parseOrderText(
      "淘宝\n订单 123456789012345\n4cm 钥匙扣"
    );
    expect(r.platformOrderNo).toBe("123456789012345");
  });

  it("应该匹配小红书 XHS 前缀", () => {
    const r = parseOrderText("小红书 XHS12345abcde\n4cm 钥匙扣");
    expect(r.platformOrderNo).toBe("XHS12345abcde");
  });

  it("应该匹配抖音 dy 前缀", () => {
    const r = parseOrderText("抖音 dy123456789012345\n4cm 钥匙扣");
    expect(r.platformOrderNo).toBe("dy123456789012345");
  });

  it("完全没订单号 → null", () => {
    const r = parseOrderText("4cm 钥匙扣");
    expect(r.platformOrderNo).toBeNull();
  });
});

describe("order-text-parser / productType 识别", () => {
  it("应该识别 PRODUCT_TYPES.name 字典命中", () => {
    // R = CM 钥匙扣
    expect(parseOrderText("CM 钥匙扣").productTypeCode).toBe("R");
    // A = CM 异性钥匙扣
    expect(parseOrderText("CM 异性钥匙扣").productTypeCode).toBe("A");
    // P = CM 冰箱贴
    expect(parseOrderText("CM 冰箱贴").productTypeCode).toBe("P");
    // RM = CM 相框
    expect(parseOrderText("CM 相框").productTypeCode).toBe("RM");
    // LB = CM 皮革徽章
    expect(parseOrderText("CM 皮革徽章").productTypeCode).toBe("LB");
    // M = CM 手办
    expect(parseOrderText("CM 手办").productTypeCode).toBe("M");
  });

  it("字典外名称 → null（『钥匙扣』不带 CM 前缀不算型号）", () => {
    // 用户的 case 里「钥匙扣」是商品描述，不是 PRODUCT_TYPES.name
    expect(parseOrderText("钥匙扣 4cm").productTypeCode).toBeNull();
  });
});

describe("order-text-parser / size 识别 — cm / 厘米 / CM", () => {
  it("应该识别 4cm / 4 cm / 4CM / 4厘米", () => {
    expect(parseOrderText("4cm 钥匙扣").productSize).toBe("4");
    expect(parseOrderText("4 cm 钥匙扣").productSize).toBe("4");
    expect(parseOrderText("4CM 钥匙扣").productSize).toBe("4");
    expect(parseOrderText("4厘米 钥匙扣").productSize).toBe("4");
  });

  it("应该识别 VALID_SIZES 字典档位（4/5/6/8/10/11/12/15/18）", () => {
    expect(parseOrderText("8cm").productSize).toBe("8");
    expect(parseOrderText("11cm").productSize).toBe("11");
    expect(parseOrderText("18cm").productSize).toBe("18");
  });

  it("应该识别中文 cm 后缀『4cm装』『6cm款』", () => {
    expect(parseOrderText("钥匙扣 4cm装").productSize).toBe("4");
    expect(parseOrderText("钥匙扣 6cm款").productSize).toBe("6");
  });

  it("字典外尺寸（如 3cm / 7cm）→ null", () => {
    expect(parseOrderText("3cm 钥匙扣").productSize).toBeNull();
    expect(parseOrderText("7cm 钥匙扣").productSize).toBeNull();
    expect(parseOrderText("20cm 钥匙扣").productSize).toBeNull();
  });
});

describe("order-text-parser / size 识别 — mm → cm 换算（2026-09-15 新增）", () => {
  it("40mm 应该识别为 4cm", () => {
    expect(parseOrderText("钥匙扣 40mm").productSize).toBe("4");
  });

  it("50mm / 60mm / 80mm / 110mm / 120mm / 150mm / 180mm 应该换算", () => {
    expect(parseOrderText("钥匙扣 50mm").productSize).toBe("5");
    expect(parseOrderText("钥匙扣 60mm").productSize).toBe("6");
    expect(parseOrderText("钥匙扣 80mm").productSize).toBe("8");
    expect(parseOrderText("钥匙扣 110mm").productSize).toBe("11");
    expect(parseOrderText("钥匙扣 120mm").productSize).toBe("12");
    expect(parseOrderText("钥匙扣 150mm").productSize).toBe("15");
    expect(parseOrderText("钥匙扣 180mm").productSize).toBe("18");
  });

  it("20mm（=2cm，字典无 2cm）应该 null（不是合法档位）", () => {
    expect(parseOrderText("钥匙扣 20mm").productSize).toBeNull();
  });

  it("100mm（=10cm）应该识别", () => {
    expect(parseOrderText("钥匙扣 100mm").productSize).toBe("10");
  });

  it("mm 大小写 / 中文『毫米』都识别", () => {
    expect(parseOrderText("钥匙扣 40MM").productSize).toBe("4");
    expect(parseOrderText("钥匙扣 40Mm").productSize).toBe("4");
    // 2026-09-15：CJK 字符不是 \w，\b 在中文两侧不构成 word boundary，
    // mm 正则已去除末尾 \b 以正确匹配「40毫米」。
    expect(parseOrderText("钥匙扣 40毫米").productSize).toBe("4");
    expect(parseOrderText("钥匙扣 40毫米款").productSize).toBe("4");
  });

  it("非 10 倍数 mm（如 45mm）应该 null（不能整除 cm）", () => {
    expect(parseOrderText("钥匙扣 45mm").productSize).toBeNull();
  });

  it("字典外 cm 换算（如 200mm = 20cm）应该 null", () => {
    expect(parseOrderText("钥匙扣 200mm").productSize).toBeNull();
  });

  it("1 位 mm（如 5mm）不匹配（正则限制 2-3 位）", () => {
    expect(parseOrderText("钥匙扣 5mm").productSize).toBeNull();
  });

  it("cm 和 mm 同时存在时 cm 优先", () => {
    expect(parseOrderText("钥匙扣 4cm 40mm").productSize).toBe("4");
  });
});

describe("order-text-parser / leatherColor 识别", () => {
  it("应该识别 LEATHER_COLORS 字典 name 命中", () => {
    expect(parseOrderText("皮革徽章 棕色").leatherColor).toBe("brown");
    expect(parseOrderText("皮革徽章 黑色").leatherColor).toBe("black");
    expect(parseOrderText("皮革徽章 酒红").leatherColor).toBe("red");
    expect(parseOrderText("皮革徽章 藏青").leatherColor).toBe("navy");
    expect(parseOrderText("皮革徽章 皮革原色").leatherColor).toBe("natural");
  });

  it("字典外名称 → null", () => {
    expect(parseOrderText("皮革徽章 紫色").leatherColor).toBeNull();
  });
});

describe("order-text-parser / accessoryCode 识别", () => {
  it("应该识别『皮套』 / 『皮革』 / 『皮质』 → leather", () => {
    expect(parseOrderText("钥匙扣 皮套").accessoryCode).toBe("leather");
    expect(parseOrderText("钥匙扣 皮革").accessoryCode).toBe("leather");
    expect(parseOrderText("钥匙扣 皮质").accessoryCode).toBe("leather");
  });

  it("应该识别『金属』 → metal", () => {
    expect(parseOrderText("钥匙扣 金属").accessoryCode).toBe("metal");
  });

  it("『金属』必须在『皮』之前判断（避免『金属皮革』误中皮革）", () => {
    // 「金属皮革扣」字面同时含「金属」和「皮革」，按业务意图应该是 metal
    // （金属款 + 皮革包边）
    expect(parseOrderText("钥匙扣 金属皮革扣").accessoryCode).toBe("metal");
  });

  it("两者都没有 → null", () => {
    expect(parseOrderText("钥匙扣 4cm").accessoryCode).toBeNull();
  });
});

describe("order-text-parser / 用户原话 case", () => {
  it("抖音 xxx 钥匙扣 40mm 皮套+实物外露可触摸", () => {
    const r = parseOrderText("抖音：xxx\n钥匙扣\n40mm / 皮套+实物外露可触摸");
    // platform = 抖音
    expect(r.platform).toBe("douyin");
    expect(r.inferredFields.has("platform")).toBe(true);
    // size = 40mm → 4cm
    expect(r.productSize).toBe("4");
    expect(r.inferredFields.has("productSize")).toBe(true);
    // accessory = 皮套 → leather
    expect(r.accessoryCode).toBe("leather");
    expect(r.inferredFields.has("accessoryCode")).toBe(true);
    // 产品型号 = null（『钥匙扣』不带 CM 前缀不在 PRODUCT_TYPES.name）
    expect(r.productTypeCode).toBeNull();
    // 订单号 = null（文本里没订单号段）
    expect(r.platformOrderNo).toBeNull();
    // 颜色 = null（没颜色字）
    expect(r.leatherColor).toBeNull();
    // inferredFields 应该正好是 3 项
    expect(r.inferredFields.size).toBe(3);
  });
});

describe("order-text-parser / 边界", () => {
  it("空文本 → 全 null", () => {
    const r = parseOrderText("");
    expect(r.platform).toBeNull();
    expect(r.platformOrderNo).toBeNull();
    expect(r.productTypeCode).toBeNull();
    expect(r.productSize).toBeNull();
    expect(r.leatherColor).toBeNull();
    expect(r.accessoryCode).toBeNull();
    expect(r.inferredFields.size).toBe(0);
  });

  it("纯空白 → 全 null", () => {
    const r = parseOrderText("   \n\t  ");
    expect(r.platform).toBeNull();
    expect(r.productSize).toBeNull();
    expect(r.inferredFields.size).toBe(0);
  });

  it("乱码文本 → 各字段独立 null，无 throw", () => {
    expect(() => parseOrderText("@@##$$%^&*()")).not.toThrow();
    const r = parseOrderText("@@##$$%^&*()");
    expect(r.platform).toBeNull();
    expect(r.productSize).toBeNull();
  });

  it("只识别 allowed 字段 — 不写备注 / 刻字 / 皮革外露", () => {
    // 设计原则：解析器只填订单商品规格字段；定制能力/用户意图留给 SpecModal 手动勾选
    // 注意：「皮革徽章」不带 CM 前缀时 productTypeCode=null（PRODUCT_TYPES.name
    // 要求完整 "CM 皮革徽章" 才命中），属设计行为而非 bug。
    const r = parseOrderText(
      "皮革徽章 4cm 棕色\n刻字：生日快乐\n备注：加急\n外露：可触摸\nPVC：需要"
    );
    // 识别的
    expect(r.platform).toBeNull();
    expect(r.productTypeCode).toBeNull();
    expect(r.productSize).toBe("4");
    expect(r.leatherColor).toBe("brown");
    // 不识别的 → 解析器没字段承载，inferredFields 也不含
    expect(r.inferredFields.has("remarks")).toBe(false);
    expect(r.inferredFields.has("engraving")).toBe(false);
  });
});
