import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 打印定价设置的**回退链** —— 纯函数测试
 *
 * ## 为什么这个值得测
 *
 * 生效值 = **DB 配置行 → `PRINT_*` 环境变量 → 默认值**(逐字段取第一个非空)。
 * 这条链子有三个容易出错的点:
 *
 * 1. **逐字段**,不是整体 —— 后台只配了密度,单价仍然要走环境变量那一档。
 *    写成「配置行优先,没有就整个回退」的话,工作室只改一个数就会把其余
 *    全部改回默认。
 * 2. **材料的密度和单价跟着材料走** —— 「密度 1.2 的树脂就是 450 分/g」
 *    是**同一个材料**的属性。配置行只存「当前生效的是哪一档」,密度和单价
 *    从材料行读。引用了但材料库找不到(被删了)→ 退回兜底,不能是 0。
 * 3. **非法值退回兜底** —— 后台手滑填了密度 0 / 比例 5,报价链路不能收
 *    一个离谱的价(也不能崩)。
 *
 * 这三条都是纯函数的判断,写反例比在 dev 环境手动点便宜得多。
 *
 * ## 不碰 DB
 *
 * `pricing-settings.ts` 是纯的那一半(不 import `@/db`),所以这个文件留在
 * Vitest 的 `unit` project 里,不需要数据库。
 */

import {
  type PrintMaterialLite,
  type PrintPricingConfigLite,
  type PrintPricingSettings,
  readPrintPricingFallback,
  resolvePrintPricingSettings,
  toClientPrintConfig,
} from "@/features/print-quote/lib/pricing-settings";

/* -------------------------------------------------------------------------- */
/*  手写的样例                                                                  */
/* -------------------------------------------------------------------------- */

/** 材料库:两档模型 + 一档支撑 */
const MATERIAL_A: PrintMaterialLite = {
  id: "mat-a",
  code: "resin-a",
  name: "树脂 A",
  kind: "model",
  density: 1.15,
  unitPriceCentsPerGram: 500,
  isActive: true,
  sortOrder: 0,
};

const MATERIALS: PrintMaterialLite[] = [
  MATERIAL_A,
  {
    id: "mat-b",
    code: "resin-b",
    name: "树脂 B",
    kind: "model",
    density: 1.3,
    unitPriceCentsPerGram: 620,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: "sup-a",
    code: "pva",
    name: "水溶性支撑",
    kind: "support",
    density: 1.28,
    unitPriceCentsPerGram: null,
    isActive: true,
    sortOrder: 2,
  },
];

/** 一份兜底设置(相当于 env 那一档) */
const FALLBACK: PrintPricingSettings = {
  modelMaterialId: null,
  modelMaterialName: "默认材料",
  modelDensity: 1.2,
  unitPriceCentsPerGram: 450,
  supportMaterialId: null,
  supportMaterialName: "默认支撑",
  supportDensity: 1.28,
  supportThreshold: 1,
  supportTier1Ratio: 2,
  supportTier1PriceCentsPerGram: 50,
  supportTier2PriceCentsPerGram: 100,
  supportEnabled: false,
  varnishFeeCents: 1000,
  varnishEnabled: true,
  supportLiftMm: 5,
  supportBaseMarginMm: 5,
  deliveryRates: { standard: 0, express: 0.1, urgent: 0.37 },
};

/** 配置行的默认值 —— 测试里只改要测的那几个字段 */
function configRow(
  overrides: Partial<PrintPricingConfigLite> = {}
): PrintPricingConfigLite {
  return {
    id: "default",
    modelMaterialId: null,
    supportMaterialId: null,
    varnishFeeCents: 1000,
    varnishEnabled: true,
    supportThreshold: 1,
    supportTier1Ratio: 2,
    supportTier1PriceCentsPerGram: 50,
    supportTier2PriceCentsPerGram: 100,
    supportEnabled: false,
    supportLiftMm: 5,
    supportBaseMarginMm: 5,
    deliveryExpressRate: 0.1,
    deliveryUrgentRate: 0.37,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/*  回退链                                                                      */
/* -------------------------------------------------------------------------- */

describe("resolvePrintPricingSettings —— 回退链", () => {
  it("没有配置行 → 整份走兜底(迁移跑完、价格没变的那条路)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: null,
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings).toEqual(FALLBACK);
  });

  it("配置行存在 → 那一行的字段接管", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ varnishFeeCents: 2000, supportEnabled: true }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.varnishFeeCents).toBe(2000);
    expect(settings.supportEnabled).toBe(true);
  });

  it("**逐字段**回退 —— 配置行只改了密度,单价仍然走兜底", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ modelMaterialId: "mat-a" }),
      materials: [],
      fallback: FALLBACK,
    });
    // 材料库里找不到 mat-a → 密度和单价都退回兜底
    expect(settings.modelDensity).toBe(FALLBACK.modelDensity);
    expect(settings.unitPriceCentsPerGram).toBe(FALLBACK.unitPriceCentsPerGram);
  });

  it("配置行没配的那几个字段,仍然是兜底那一档(不是 0 / 不是 undefined)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ varnishFeeCents: 1500 }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.varnishFeeCents).toBe(1500);
    expect(settings.supportLiftMm).toBe(FALLBACK.supportLiftMm);
    expect(settings.supportBaseMarginMm).toBe(FALLBACK.supportBaseMarginMm);
    expect(settings.deliveryRates).toEqual(FALLBACK.deliveryRates);
  });
});

/* -------------------------------------------------------------------------- */
/*  材料库                                                                      */
/* -------------------------------------------------------------------------- */

describe("resolvePrintPricingSettings —— 材料库", () => {
  it("选中了哪一档,密度和单价就用哪一档", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ modelMaterialId: "mat-b" }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.modelDensity).toBe(1.3);
    expect(settings.unitPriceCentsPerGram).toBe(620);
    expect(settings.modelMaterialName).toBe("树脂 B");
    expect(settings.modelMaterialId).toBe("mat-b");
  });

  it("支撑材料的密度也跟着走(支撑的价走分段规则,不在材料行上)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ supportMaterialId: "sup-a" }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.supportDensity).toBe(1.28);
    expect(settings.supportMaterialName).toBe("水溶性支撑");
  });

  it("引用了但材料库里找不到 → 退回兜底(不能变成 0 密度 / 0 单价)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ modelMaterialId: "已经删掉的材料" }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.modelDensity).toBe(FALLBACK.modelDensity);
    expect(settings.unitPriceCentsPerGram).toBe(FALLBACK.unitPriceCentsPerGram);
    expect(settings.modelMaterialId).toBeNull();
  });

  it("配置行没指定材料 → 走兜底(材料库里有材料也不自动挑一档)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow(),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.modelMaterialId).toBeNull();
    expect(settings.modelDensity).toBe(FALLBACK.modelDensity);
  });
});

/* -------------------------------------------------------------------------- */
/*  非法值                                                                      */
/* -------------------------------------------------------------------------- */

describe("resolvePrintPricingSettings —— 非法值退回兜底", () => {
  it("密度 ≤ 0 → 退回兜底", () => {
    for (const density of [0, -1, Number.NaN]) {
      const settings = resolvePrintPricingSettings({
        configRow: configRow(),
        materials: [{ ...MATERIAL_A, density }],
        fallback: FALLBACK,
      });
      expect(settings.modelDensity).toBe(FALLBACK.modelDensity);
    }
  });

  it("单价 < 0 → 退回兜底(单价 0 是合法的,那是「免费」)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow(),
      materials: [{ ...MATERIAL_A, unitPriceCentsPerGram: -1 }],
      fallback: FALLBACK,
    });
    expect(settings.unitPriceCentsPerGram).toBe(FALLBACK.unitPriceCentsPerGram);
  });

  it("交期比例不在 0~1 → 退回兜底", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({
        deliveryExpressRate: 5,
        deliveryUrgentRate: -0.5,
      }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.deliveryRates.express).toBe(FALLBACK.deliveryRates.express);
    expect(settings.deliveryRates.urgent).toBe(FALLBACK.deliveryRates.urgent);
  });

  it("标准档恒为 0(不落列,也不能被配成别的数)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow(),
      materials: MATERIALS,
      fallback: {
        ...FALLBACK,
        deliveryRates: { standard: 0.2, express: 0.1, urgent: 0.37 },
      },
    });
    expect(settings.deliveryRates.standard).toBe(0);
  });

  it("阈值 ≤ 0 → 退回兜底", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ supportThreshold: 0 }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.supportThreshold).toBe(FALLBACK.supportThreshold);
  });

  it("第一档上界比阈值还小 → 抬到阈值(第一档不能是空的)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ supportThreshold: 2, supportTier1Ratio: 1 }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.supportTier1Ratio).toBe(2);
  });

  it("几何参数负数 → 退回兜底(0 是合法的)", () => {
    const settings = resolvePrintPricingSettings({
      configRow: configRow({ supportLiftMm: -3, supportBaseMarginMm: -1 }),
      materials: MATERIALS,
      fallback: FALLBACK,
    });
    expect(settings.supportLiftMm).toBe(FALLBACK.supportLiftMm);
    expect(settings.supportBaseMarginMm).toBe(FALLBACK.supportBaseMarginMm);
  });
});

/* -------------------------------------------------------------------------- */
/*  环境变量那一档                                                               */
/* -------------------------------------------------------------------------- */

describe("readPrintPricingFallback —— 环境变量那一档", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("不配任何 PRINT_* → 落到默认值", () => {
    for (const key of [
      "PRINT_MATERIAL_DENSITY",
      "PRINT_UNIT_PRICE_CENTS_PER_GRAM",
      "PRINT_SUPPORT_DENSITY",
      "PRINT_DELIVERY_EXPRESS_RATE",
      "PRINT_DELIVERY_URGENT_RATE",
    ]) {
      vi.stubEnv(key, "");
    }
    const fallback = readPrintPricingFallback();
    expect(fallback.modelDensity).toBe(1.2);
    expect(fallback.unitPriceCentsPerGram).toBe(450);
    expect(fallback.supportDensity).toBe(1.28);
    expect(fallback.deliveryRates).toEqual({
      standard: 0,
      express: 0.1,
      urgent: 0.37,
    });
  });

  it("配了环境变量 → 用环境变量那一档(线上老部署还在靠它)", () => {
    vi.stubEnv("PRINT_MATERIAL_DENSITY", "1.15");
    vi.stubEnv("PRINT_UNIT_PRICE_CENTS_PER_GRAM", "500");
    vi.stubEnv("PRINT_SUPPORT_DENSITY", "1.3");
    vi.stubEnv("PRINT_DELIVERY_EXPRESS_RATE", "0.2");
    const fallback = readPrintPricingFallback();
    expect(fallback.modelDensity).toBe(1.15);
    expect(fallback.unitPriceCentsPerGram).toBe(500);
    expect(fallback.supportDensity).toBe(1.3);
    expect(fallback.deliveryRates.express).toBe(0.2);
  });

  it("环境变量是非法值 → 退回默认值(不崩)", () => {
    vi.stubEnv("PRINT_MATERIAL_DENSITY", "abc");
    vi.stubEnv("PRINT_DELIVERY_EXPRESS_RATE", "5");
    const fallback = readPrintPricingFallback();
    expect(fallback.modelDensity).toBe(1.2);
    expect(fallback.deliveryRates.express).toBe(0.1);
  });

  it("第二档单价:新名字优先,旧名字兜底(老部署上配的是那个)", () => {
    vi.stubEnv("PRINT_SUPPORT_TIER2_PRICE_CENTS_PER_GRAM", "120");
    vi.stubEnv("PRINT_SUPPORT_PRICE_CENTS_PER_GRAM", "100");
    expect(readPrintPricingFallback().supportTier2PriceCentsPerGram).toBe(120);

    vi.stubEnv("PRINT_SUPPORT_TIER2_PRICE_CENTS_PER_GRAM", "");
    expect(readPrintPricingFallback().supportTier2PriceCentsPerGram).toBe(100);
  });
});

/* -------------------------------------------------------------------------- */
/*  客户端子集                                                                  */
/* -------------------------------------------------------------------------- */

describe("toClientPrintConfig", () => {
  it("只把密度和几何发给浏览器 —— 单价 / 阈值 / 比例一律不发", () => {
    const client = toClientPrintConfig({
      ...FALLBACK,
      modelDensity: 1.15,
      supportDensity: 1.3,
      supportLiftMm: 3,
      supportBaseMarginMm: 6,
      unitPriceCentsPerGram: 999,
      supportThreshold: 5,
    });
    expect(client).toEqual({
      modelDensity: 1.15,
      supportDensity: 1.3,
      supportLiftMm: 3,
      supportBaseMarginMm: 6,
    });
    expect(Object.keys(client)).not.toContain("unitPriceCentsPerGram");
    expect(Object.keys(client)).not.toContain("supportThreshold");
  });
});
