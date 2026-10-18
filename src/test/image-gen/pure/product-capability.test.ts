/**
 * /api/image-gen/products 装配层 —— 纯函数单元测试
 *
 * 2026-10-18 v1.6.0:覆盖 product-capability.ts 的核心装配逻辑,不走 DB。
 * 测试目标:
 * 1) parseProductTypeCodes —— 校验入参 + 大写归一化 + 未知 code 抛错
 * 2) resolveLocale —— query > Accept-Language > 默认 zh
 * 3) assembleProductCapabilities —— 字典 + 变体表 + 模板 join 装配正确
 *    a) filterCodes 只返指定产品
 *    b) keyScope 白名单按 maskId 过滤
 *    c) M 产品的 accessories 含 glass_cover + 3 个变体
 *    d) R 产品的 accessories 含 braided_rope + 8 个变体
 *    e) 老配件(leather/metal/stand)的 variants = []
 *    f) visualStyles 按 id 去重聚合
 *    g) allowedCapabilities 覆盖合并(任一 false 即 false)
 *    h) allowedAccessories JSON 字符串数组正确解析
 *    i) 空 effects 返 []
 *    j) productEffect.productTypeCode 为空/null 自动跳过
 *
 * 鉴权(401/429)和 Cache-Control 头已由 requireExternalApiKey 和
 * rate-limit helper 各自覆盖(external-api-key-service.test.ts /
 * poll-public-view.test.ts 的同模式),route 层在 src/app/api/image-gen/
 * products/route.ts 内调用,本测聚焦装配逻辑。
 */

import { describe, expect, it, vi } from "vitest";

// 单元测试不走 DB,但 product-capability.ts 顶层 import 了 @/db,会触发
// DATABASE_URL 校验。给个空 stub 绕过,本测只调纯函数(getActiveVariantsByProduct
// / getActiveProductEffectsWithTemplates 不会被调到,即便被调也只是返回 undefined
// 链式方法,装配阶段不用 db)。
vi.mock("@/db", () => ({ db: {} }));

import type { AccessoryVariantDef } from "@/db/image-gen-types";
import type {
  productAccessoryVariant,
  productEffect,
  promptTemplate,
} from "@/db/schema";
import {
  type AccessoryCode,
  PRODUCT_META,
} from "@/features/gpt-image/lib/product-catalog";
import {
  _internals,
  assembleProductCapabilities,
  parseProductTypeCodes,
  resolveLocale,
} from "@/features/image-gen/lib/product-capability";

// ----------------------------------------------------------------------
// Fixture helpers —— 最小可用的 mock 行(只填装配路径读到的字段)
// ----------------------------------------------------------------------

type EffectRow = typeof productEffect.$inferSelect;
type TemplateRow = typeof promptTemplate.$inferSelect;
type VariantRow = typeof productAccessoryVariant.$inferSelect;

function makeEffect(overrides: Partial<EffectRow> = {}): EffectRow {
  return {
    id: "eff_x",
    name: "Default",
    category: "默认",
    description: "",
    previewUrl: "https://example.com/preview.png",
    prompt: "test prompt",
    variables: [],
    model: "qwen",
    config: { style: "custom" },
    scene: "generate_2d",
    promptTemplateId: null,
    versions: [],
    price: 0,
    status: "active",
    usageCount: 0,
    successRate: 0,
    avgDuration: 0,
    author: "admin",
    productLineIds: [],
    productTypeCode: "R",
    allowedSizes: null,
    allowedAccessories: null,
    allowedCapabilities: null,
    allowedColors: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    id: "tpl_x",
    name: "Tpl",
    description: "",
    prompt: "p",
    variables: [],
    model: "qwen",
    price: 0,
    size: "1024x1024",
    candidateCount: 4,
    coverUrl: null,
    isActive: true,
    outputMode: "grid",
    productTypeCode: "R",
    allowedSizes: null,
    allowedAccessories: null,
    styles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeVariant(overrides: Partial<VariantRow> = {}): VariantRow {
  return {
    id: "var_x",
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_red",
    name: "正红",
    nameEn: "Red",
    swatch: "#C0392B",
    priceDeltaCents: 200,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeVariantMap(
  rows: VariantRow[]
): Map<string, Map<AccessoryCode, AccessoryVariantDef[]>> {
  const out = new Map<string, Map<AccessoryCode, AccessoryVariantDef[]>>();
  for (const r of rows) {
    let inner = out.get(r.productTypeCode);
    if (!inner) {
      inner = new Map();
      out.set(r.productTypeCode, inner);
    }
    let arr = inner.get(r.accessoryCode as AccessoryCode);
    if (!arr) {
      arr = [];
      inner.set(r.accessoryCode as AccessoryCode, arr);
    }
    arr.push({
      code: r.variantCode,
      name: { zh: r.name, en: r.nameEn },
      swatch: r.swatch ?? null,
      priceDeltaCents: r.priceDeltaCents,
    });
  }
  // 与 product-capability.ts:getActiveVariantsByProduct 一致:按 code 升序
  for (const inner of out.values()) {
    for (const arr of inner.values()) {
      arr.sort((a, b) => a.code.localeCompare(b.code));
    }
  }
  return out;
}

/** 全套 R 钥匙扣编织绳变体(8 色)+ M 玻璃罩 3 尺寸 + 老配件空 */
function makeRopeVariants(): VariantRow[] {
  const colors: Array<[string, string, string, string]> = [
    ["rope_red", "正红", "Red", "#C0392B"],
    ["rope_black", "墨黑", "Black", "#1A1A1A"],
    ["rope_blue", "宝蓝", "Blue", "#1F3A93"],
    ["rope_green", "墨绿", "Green", "#1E8449"],
    ["rope_yellow", "明黄", "Yellow", "#F1C40F"],
    ["rope_purple", "紫罗兰", "Purple", "#7D3C98"],
    ["rope_white", "米白", "White", "#F8F8F8"],
    ["rope_brown", "咖啡", "Brown", "#6E4B2A"],
  ];
  return colors.map(([code, zh, en, hex], i) =>
    makeVariant({
      id: `v_rope_${code}`,
      productTypeCode: "R",
      accessoryCode: "braided_rope",
      variantCode: code,
      name: zh,
      nameEn: en,
      swatch: hex,
      priceDeltaCents: 200,
      sortOrder: i,
    })
  );
}

function makeGlassVariants(): VariantRow[] {
  return [
    makeVariant({
      id: "v_glass_4",
      productTypeCode: "M",
      accessoryCode: "glass_cover",
      variantCode: "glass_4",
      name: "4cm 罩",
      nameEn: "4cm Cover",
      swatch: null,
      priceDeltaCents: 0,
      sortOrder: 0,
    }),
    makeVariant({
      id: "v_glass_6",
      productTypeCode: "M",
      accessoryCode: "glass_cover",
      variantCode: "glass_6",
      name: "6cm 罩",
      nameEn: "6cm Cover",
      swatch: null,
      priceDeltaCents: 500,
      sortOrder: 1,
    }),
    makeVariant({
      id: "v_glass_8",
      productTypeCode: "M",
      accessoryCode: "glass_cover",
      variantCode: "glass_8",
      name: "8cm 罩",
      nameEn: "8cm Cover",
      swatch: null,
      priceDeltaCents: 1000,
      sortOrder: 2,
    }),
  ];
}

function makeLeatherVariants(): VariantRow[] {
  // 5 色(种子脚本设定);覆盖「老配件走表」分支
  return ["brown", "black", "red", "white", "natural"].map((code, i) =>
    makeVariant({
      id: `v_leather_${code}`,
      productTypeCode: "R",
      accessoryCode: "leather",
      variantCode: `leather_${code}`,
      name: code,
      nameEn: code,
      swatch: "#000000",
      sortOrder: i,
    })
  );
}

// ----------------------------------------------------------------------
// parseProductTypeCodes
// ----------------------------------------------------------------------

describe("parseProductTypeCodes", () => {
  it("空 / null → null(返全部)", () => {
    expect(parseProductTypeCodes(null)).toBeNull();
    expect(parseProductTypeCodes("")).toBeNull();
    expect(parseProductTypeCodes("   ")).toBeNull();
  });

  it("合法 code 列表 → 大写归一化 + 去空", () => {
    expect(parseProductTypeCodes("R,M,P")).toEqual(["R", "M", "P"]);
    expect(parseProductTypeCodes(" r , m ")).toEqual(["R", "M"]);
  });

  it("未知 code → 抛错(防止拼错静默走全集)", () => {
    expect(() => parseProductTypeCodes("R,XX")).toThrow(/未知的产品码/);
    expect(() => parseProductTypeCodes("YYY")).toThrow(/未知的产品码/);
  });

  it("全部 6 种合法产品码可解析", () => {
    expect(parseProductTypeCodes("R,A,P,RM,LB,M")).toEqual([
      "R",
      "A",
      "P",
      "RM",
      "LB",
      "M",
    ]);
  });
});

// ----------------------------------------------------------------------
// resolveLocale
// ----------------------------------------------------------------------

describe("resolveLocale", () => {
  function makeRequest(acceptLang: string | null): Request {
    return new Request("https://example.com", {
      headers: acceptLang ? { "accept-language": acceptLang } : {},
    });
  }

  it("query 参数优先", () => {
    const req = makeRequest("en-US,en;q=0.9");
    expect(resolveLocale(req, "zh")).toBe("zh");
    expect(resolveLocale(req, "en")).toBe("en");
  });

  it("query 无值时按 Accept-Language 推断", () => {
    expect(resolveLocale(makeRequest("en-US,en;q=0.9"), null)).toBe("en");
    expect(resolveLocale(makeRequest("zh-CN,zh;q=0.9"), null)).toBe("zh");
    expect(resolveLocale(makeRequest("en-GB"), null)).toBe("en");
  });

  it("Accept-Language 缺失/无法识别 → 默认 zh", () => {
    expect(resolveLocale(makeRequest(null), null)).toBe("zh");
    expect(resolveLocale(makeRequest("fr-FR"), null)).toBe("zh");
  });
});

// ----------------------------------------------------------------------
// assembleProductCapabilities —— 核心装配
// ----------------------------------------------------------------------

describe("assembleProductCapabilities", () => {
  // 用 R 钥匙扣 + M 3D 手办两个活跃 effect + 一条「无 productTypeCode」
  // 的脏数据,验证装配正确性。
  const tplR = makeTemplate({
    id: "tpl_R",
    productTypeCode: "R",
    outputMode: "separate",
    candidateCount: 2,
    styles: [
      {
        id: "ai_qversion",
        name: "Q 版",
        nameEn: "Q-Version",
        prompt: "q-style",
        surchargeCents: 0,
        outputSize: "1024x1024",
        swatch: "#FFB6C1",
        estimatedLatencySec: 20,
      },
      {
        id: "ai_realistic",
        name: "写实",
        nameEn: "Realistic",
        prompt: "realistic",
        surchargeCents: 2500,
        outputSize: "1536x1024",
        swatch: "#7A5C3A",
        estimatedLatencySec: 35,
      },
    ],
  });
  const tplM = makeTemplate({
    id: "tpl_M",
    productTypeCode: "M",
    outputMode: "grid",
    candidateCount: 4,
    styles: [
      {
        id: "ai_qversion",
        name: "Q 版",
        nameEn: "Q-Version",
        prompt: "q-style",
        surchargeCents: 0,
        outputSize: "1024x1024",
        swatch: "#FFB6C1",
        estimatedLatencySec: 20,
      },
      {
        id: "ai_anime",
        name: "动漫",
        nameEn: "Anime",
        prompt: "anime",
        surchargeCents: 0,
        outputSize: "1024x1024",
        swatch: "#9B59B6",
        estimatedLatencySec: 25,
      },
    ],
  });

  const effR = makeEffect({
    id: "eff_R_1",
    name: "复古钥匙扣",
    previewUrl: "https://example.com/r.png",
    price: 50,
    productTypeCode: "R",
    promptTemplateId: "tpl_R",
    allowedAccessories: JSON.stringify(["leather", "braided_rope"]),
  });
  const effM = makeEffect({
    id: "eff_M_1",
    name: "Q 版手办",
    previewUrl: "https://example.com/m.png",
    price: 200,
    productTypeCode: "M",
    promptTemplateId: "tpl_M",
    allowedAccessories: JSON.stringify(["stand", "glass_cover"]),
  });
  // 脏数据:productTypeCode=null → 跳过
  const effOrphan = makeEffect({
    id: "eff_orphan",
    name: "未关联",
    productTypeCode: null,
  });

  const effects = [
    { effect: effR, template: tplR },
    { effect: effM, template: tplM },
    { effect: effOrphan, template: null },
  ];

  const variants = [
    ...makeRopeVariants(), // 8 个 R+braided_rope
    ...makeGlassVariants(), // 3 个 M+glass_cover
    ...makeLeatherVariants(), // 5 个 R+leather(老配件也走表)
  ];
  const variantsByProduct = makeVariantMap(variants);

  it("按 productTypeCode 字母序输出", () => {
    const products = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    // R 在 M 前(字母序)
    expect(products.map((p) => p.productTypeCode)).toEqual(["M", "R"]);
  });

  it("filterCodes 仅返指定产品", () => {
    const onlyM = assembleProductCapabilities(
      effects,
      variantsByProduct,
      ["M"],
      null
    );
    expect(onlyM).toHaveLength(1);
    expect(onlyM[0]?.productTypeCode).toBe("M");

    const onlyR = assembleProductCapabilities(
      effects,
      variantsByProduct,
      ["R"],
      null
    );
    expect(onlyR).toHaveLength(1);
    expect(onlyR[0]?.productTypeCode).toBe("R");
  });

  it("keyScope 白名单按 maskId 过滤 → 该 effect 整条不进", () => {
    // 白名单只允许 eff_M_1,eff_R_1 被剔除 → R 整条消失,M 留下
    const filtered = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      ["eff_M_1"]
    );
    expect(filtered.map((p) => p.productTypeCode)).toEqual(["M"]);
    expect(filtered[0]?.templates[0]?.templateId).toBe("eff_M_1");
  });

  it("空 keyScope 数组 → 视为不过滤(返全量)", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      []
    );
    expect(out).toHaveLength(2);
  });

  it("M 产品的 accessories 含 glass_cover + 3 个变体", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    const m = out.find((p) => p.productTypeCode === "M");
    expect(m).toBeDefined();
    const codes = m!.accessories.map((a) => a.code);
    expect(codes).toContain("glass_cover");
    const glass = m!.accessories.find((a) => a.code === "glass_cover")!;
    expect(glass.variants).toHaveLength(3);
    expect(glass.variants.map((v) => v.code)).toEqual([
      "glass_4",
      "glass_6",
      "glass_8",
    ]);
    // swatch 为 null 的变体应保留为 null(尺寸类无颜色 hex)
    expect(glass.variants[0]?.swatch).toBeNull();
  });

  it("R 产品的 accessories 含 braided_rope + 8 个变体", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    const r = out.find((p) => p.productTypeCode === "R")!;
    const rope = r.accessories.find((a) => a.code === "braided_rope")!;
    expect(rope.variants).toHaveLength(8);
    // swatch 不为 null
    expect(rope.variants[0]?.swatch).toMatch(/^#[0-9A-F]{6}$/i);
    // 按 variantCode 字母升序(sortOrder 决定)
    const codes = rope.variants.map((v) => v.code);
    expect(codes).toEqual([...codes].sort());
  });

  it("老配件走变体表时(R + leather)有变体,字典里挂的 metal/stand 走 []", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    const r = out.find((p) => p.productTypeCode === "R")!;
    const leather = r.accessories.find((a) => a.code === "leather")!;
    expect(leather.variants).toHaveLength(5);
    // 字典里挂但表里没的(本 fixture 没造 metal/stand 变体)→ variants = []
    const m = out.find((p) => p.productTypeCode === "M")!;
    const stand = m.accessories.find((a) => a.code === "stand")!;
    expect(stand.variants).toEqual([]);
  });

  it("visualStyles 按 id 去重聚合(多模板共享同一 style 不重复)", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    // M 只有 1 条 effect,聚合 tpl_M.styles 的 2 个 id
    const m = out.find((p) => p.productTypeCode === "M")!;
    const mIds = m.visualStyles.map((s) => s.id).sort();
    expect(mIds).toEqual(["ai_anime", "ai_qversion"]);

    // 模拟 2 条 R effect 共享 ai_qversion,ai_realistic(只挂在 tpl_R)
    const tplR2 = makeTemplate({
      id: "tpl_R2",
      productTypeCode: "R",
      styles: [
        {
          id: "ai_qversion",
          name: "Q 版",
          nameEn: "Q-Version",
          prompt: "q",
          surchargeCents: 0,
          outputSize: "1024x1024",
          swatch: "#FFB6C1",
          estimatedLatencySec: 20,
        },
      ],
    });
    const effR2 = makeEffect({
      id: "eff_R_2",
      productTypeCode: "R",
      promptTemplateId: "tpl_R2",
    });
    const out2 = assembleProductCapabilities(
      [...effects, { effect: effR2, template: tplR2 }],
      variantsByProduct,
      null,
      null
    );
    const r = out2.find((p) => p.productTypeCode === "R")!;
    // ai_qversion 只出现一次(去重)
    const rIds = r.visualStyles.map((s) => s.id);
    expect(new Set(rIds).size).toBe(rIds.length);
    expect(rIds).toContain("ai_qversion");
    expect(rIds).toContain("ai_realistic");
  });

  it("templates[].allowedAccessories 正确解析为字符串数组", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    const m = out.find((p) => p.productTypeCode === "M")!;
    expect(m.templates[0]?.allowedAccessories).toEqual([
      "stand",
      "glass_cover",
    ]);
  });

  it("allowedCapabilities 模板级覆盖:任一模板 false 即合并 false", () => {
    // 给 eff_R_1 加一个 false 覆盖
    const effROverride = makeEffect({
      ...effR,
      allowedCapabilities: JSON.stringify({ canLeatherColor: false }),
    });
    const out = assembleProductCapabilities(
      [{ effect: effROverride, template: tplR }],
      variantsByProduct,
      ["R"],
      null
    );
    // catalog 默认 R.canLeatherColor = true,被覆盖为 false
    expect(out[0]?.capabilities.canLeatherColor).toBe(false);
  });

  it("allowedCapabilities 缺字段不覆盖(catalog 默认值保留)", () => {
    // R catalog 默认:canLeatherExposed=true, canLeatherColor=false,
    // canHaveRemarks=false, canPlatform=false
    // 模板级 override 只识别 false 方向(取最严),true 不动。
    const effRObj = makeEffect({
      ...effR,
      // 关键:这个 true 被生产代码忽略(只应用 false 覆盖),
      // 没有 false 项 → 所有字段保留 catalog 默认
      allowedCapabilities: JSON.stringify({ canHaveRemarks: true }),
    });
    const out = assembleProductCapabilities(
      [{ effect: effRObj, template: tplR }],
      variantsByProduct,
      ["R"],
      null
    );
    expect(out[0]?.capabilities.canLeatherExposed).toBe(true);
    expect(out[0]?.capabilities.canLeatherColor).toBe(false);
    // canHaveRemarks 不被 true 覆盖,保留 catalog 默认 false
    expect(out[0]?.capabilities.canHaveRemarks).toBe(false);
  });

  it("sizes 来自 productType.sizes 字典,priceDeltaCents 按 idx×500", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    const r = out.find((p) => p.productTypeCode === "R")!;
    expect(r.sizes.length).toBeGreaterThan(0);
    expect(r.sizes[0]?.priceDeltaCents).toBe(0);
    expect(r.sizes[1]?.priceDeltaCents).toBe(500);
    // 第三个若存在
    if (r.sizes[2]) expect(r.sizes[2].priceDeltaCents).toBe(1000);
  });

  it("空 effects → 返 []", () => {
    expect(
      assembleProductCapabilities([], variantsByProduct, null, null)
    ).toEqual([]);
  });

  it("productTypeCode 为 null/'' 的 effect 自动跳过(脏数据兼容)", () => {
    const effBlank = makeEffect({ id: "eff_blank", productTypeCode: "" });
    const out = assembleProductCapabilities(
      [
        { effect: effR, template: tplR },
        { effect: effBlank, template: null },
        { effect: effOrphan, template: null },
      ],
      variantsByProduct,
      null,
      null
    );
    // 跳过 2 条脏数据,只留 R
    expect(out).toHaveLength(1);
    expect(out[0]?.productTypeCode).toBe("R");
  });

  it("displayName/description 来自 PRODUCT_META,category 字面量映射正确", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    const r = out.find((p) => p.productTypeCode === "R")!;
    expect(r.displayName).toEqual(PRODUCT_META.R?.displayName);
    expect(r.description).toEqual(PRODUCT_META.R?.description);
    expect(r.category).toBe("keychain");
    const m = out.find((p) => p.productTypeCode === "M")!;
    expect(m.category).toBe("figure");
  });

  it("cover 取自 templates[0].previewUrl(无 templates 时空串)", () => {
    const out = assembleProductCapabilities(
      effects,
      variantsByProduct,
      null,
      null
    );
    const r = out.find((p) => p.productTypeCode === "R")!;
    expect(r.cover).toBe("https://example.com/r.png");
  });
});

// ----------------------------------------------------------------------
// _internals(sanitizeStyles / parseJsonStringArray / parseAllowedCapabilities)
// ----------------------------------------------------------------------

describe("product-capability _internals", () => {
  const { sanitizeStyles, parseJsonStringArray, parseAllowedCapabilities } =
    _internals;

  it("sanitizeStyles 过滤非数组 + 无 id 项", () => {
    expect(sanitizeStyles(null)).toEqual([]);
    expect(sanitizeStyles("not array")).toEqual([]);
    // 无 id 字段(null / 字符串)被过滤;有 id 的项保留
    expect(
      sanitizeStyles([{ id: "a", name: "n", nameEn: "ne" }, null, "x", {}])
    ).toEqual([{ id: "a", name: "n", nameEn: "ne" }]);
  });

  it("parseJsonStringArray 解析 + 类型过滤", () => {
    expect(parseJsonStringArray(null)).toEqual([]);
    expect(parseJsonStringArray("not json")).toEqual([]);
    expect(parseJsonStringArray("[]")).toEqual([]);
    expect(parseJsonStringArray(JSON.stringify(["a", 1, "b", null]))).toEqual([
      "a",
      "b",
    ]);
  });

  it("parseAllowedCapabilities 仅识别 4 个 LB 关心 flag", () => {
    expect(parseAllowedCapabilities(null)).toEqual({});
    expect(parseAllowedCapabilities("garbage")).toEqual({});
    expect(
      parseAllowedCapabilities(
        JSON.stringify({ canLeatherColor: true, canPvcProtection: false })
      )
    ).toEqual({ canLeatherColor: true, canPvcProtection: false });
    // 未知 flag 忽略
    expect(
      parseAllowedCapabilities(JSON.stringify({ canBraidedRopeColor: true }))
    ).toEqual({});
  });
});
