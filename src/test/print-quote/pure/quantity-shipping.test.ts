import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 打印件数 + 配送方式 + 运费(2026-11-17)
 *
 * ## 工作室的四条原话
 *
 * 1. 后处理口径:去支撑、清洗、基础打磨、上 uv 光油、独立包装与结构质保
 * 2. 配送方式三档(运费按单收):顺丰到付(到付,¥0) / 顺丰标快(¥18) /
 *    顺丰空运(¥22)
 * 3. 同一模型打印多件;后处理按件计,不重复收起步价
 * 4. 含税价已包含 1% 普票 · 不另收
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 不守会怎样 |
 * |---|---|
 * | 件数放大在「元」上做,取整只做一次 | 逐件取整再相乘 ⇒ 每件的零头累积 ⇒ **系统性少收** |
 * | `× 100` 那一次不能少 | 10 元算成 10 分 —— **按原价的 1% 收款**,界面上看着「便宜得离谱」但不报错 |
 * | 运费**不乘件数** | 多印几件就多收运费 —— 工作室的原话是「运费按单收取」 |
 * | 运费**不参与交期加价的基数** | 拿它当基数 = 运费也加急一次 ⇒ **多收钱** |
 * | 合计 = **五项**之和 | 少一项 ⇒ 明细加起来 ≠ 合计,用户会来问「为什么差一分」 |
 * | 优惠基数扣掉运费 | 拿运费参与满减 ⇒ **优惠比应该给的少**(收少了) |
 * | 接口层**拒绝**越界件数 | 引擎那层是「夹取」⇒ 用户要 5000 件被夹成 999 件 ⇒ **静默少收 4/5 的钱** |
 * | 客户端**只传档位 id** | 客户端传金额 ⇒ 用户能自己把运费改成 ¥0 ⇒ **少收钱** |
 * | 认不出来的配送方式落到「顺丰到付」 | 按最贵那档兜底 ⇒ **凭空多收 ¥22** |
 *
 * 全部是纯函数 + 文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

import { computePrintQuote } from "@mooncoda/print-tool-core/quote/compute-quote";
import { printCouponBaseCents } from "@mooncoda/print-tool-core/quote/coupon-base";
import type { PrintPricingSettings } from "@mooncoda/print-tool-core/quote/pricing-settings";
import {
  MAX_QUANTITY,
  MIN_QUANTITY,
  normalizeQuantity,
  scaleYuan,
  scaleYuanToCentsCeil,
} from "@mooncoda/print-tool-core/quote/quantity";
import { ceilCents } from "@mooncoda/print-tool-core/quote/rounding";
import {
  computeShippingFeeCents,
  DEFAULT_SHIPPING_FEES,
  DEFAULT_SHIPPING_OPTION,
  normalizeShippingOption,
  SHIPPING_OPTIONS,
} from "@mooncoda/print-tool-core/quote/shipping-option";

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前不乘件数」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/*  夹具                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 一份生效设置
 *
 * 数字是**手算得出来的**,不是从代码里抄的:
 *
 * ```
 * 体积 10 cm³ × 密度 1.2        = 12 g 耗材
 * 12 g × 4.5 元/g                = 54 元   → 5400 分
 * 后处理                          =  5 元   →  500 分
 * 支撑 20 g,比例 3 → 两档 3.33 + 6.67 元 = 10 元 → 1000 分
 * ```
 */
const SETTINGS: PrintPricingSettings = {
  modelMaterialId: null,
  modelMaterialName: "测试树脂",
  modelDensity: 1.2,
  unitPriceCentsPerGram: 450,
  supportMaterialId: null,
  supportMaterialName: "测试支撑",
  supportDensity: 1.28,
  supportThreshold: 1,
  supportTier1Ratio: 2,
  supportTier1PriceCentsPerGram: 50,
  supportTier2PriceCentsPerGram: 100,
  supportEnabled: true,
  varnishFeeCents: 500,
  varnishEnabled: true,
  supportLiftMm: 5,
  supportReliefLiftMm: 1,
  supportBaseMarginMm: 5,
  deliveryRates: { standard: 0, express: 0.1, urgent: 0.37 },
  shippingFees: DEFAULT_SHIPPING_FEES,
  allowGuestPricing: true,
};

/** 几何 —— 10 cm³ / 120 cm² / 50×40×30 mm */
const BASE = {
  volumeCM3: 10,
  surfaceAreaCM2: 120,
  dims: [50, 40, 30] as [number, number, number],
  /** 支撑 20 g,比例 3(1:3)⇒ 两档都要收 */
  supportWeightG: 20,
  selfSupportRatio: 3,
};

/* -------------------------------------------------------------------------- */
/*  引擎层 —— 件数                                                             */
/* -------------------------------------------------------------------------- */

describe("normalizeQuantity —— 把任意输入收敛成合法件数", () => {
  it("没传 / 空 / null ⇒ 一件(不是 0)", () => {
    expect(normalizeQuantity(undefined)).toBe(1);
    expect(normalizeQuantity(null)).toBe(1);
    expect(normalizeQuantity("")).toBe(1);
  });

  it("0 / 负数 ⇒ 一件 —— 打印件数没有 0 件这一说", () => {
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(-3)).toBe(1);
  });

  it("非整数 ⇒ 截断(3.7 件 ⇒ 3 件)", () => {
    expect(normalizeQuantity(3.7)).toBe(3);
  });

  it("NaN / Infinity ⇒ 一件", () => {
    expect(normalizeQuantity(Number.NaN)).toBe(1);
    expect(normalizeQuantity(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("字符串数字也认 —— 表单里传过来的是字符串", () => {
    expect(normalizeQuantity("5")).toBe(5);
  });

  it("边界:999 件认,1000 件落到兜底", () => {
    expect(MAX_QUANTITY).toBe(999);
    expect(MIN_QUANTITY).toBe(1);
    expect(normalizeQuantity(999)).toBe(999);
    // 越界 ⇒ 兜底(引擎这层是兜底,**接口层用 zod 拒绝**)
    expect(normalizeQuantity(1000)).toBe(1);
    expect(normalizeQuantity(5000)).toBe(1);
  });
});

describe("scaleYuanToCentsCeil —— 件数放大 + 取整", () => {
  it("⚠️ **100× 回归** —— 少了那一次 `× 100`,10 元会算成 10 分", () => {
    // 10 元 × 3 件 = 30 元 = 3000 分
    expect(scaleYuanToCentsCeil(10, 3)).toBe(3000);
    // 少了 `× 100` 的话这里是 30
    expect(scaleYuanToCentsCeil(10, 3)).not.toBe(30);
  });

  it("⚠️ **取整顺序:先乘后取整** —— 逐件取整会系统性少收", () => {
    // 单件 0.001 元 ⇒ 0.1 分
    // 先乘:ceil(0.001 × 3 × 100) = ceil(0.3) = **1 分**
    // 逐件取整:ceil(0.1) × 3 = 1 × 3 = **3 分** —— 但引擎要的是 1 分
    expect(scaleYuanToCentsCeil(0.001, 3)).toBe(1);
    // 「逐件取整再相乘」那个错法长什么样
    const perPiece = ceilCents(0.001 * 100) * 3;
    expect(perPiece).toBe(3);
    // 差的那两分就是少收的钱
    expect(scaleYuanToCentsCeil(0.001, 3)).toBeLessThan(perPiece);
  });

  it("放大在「元」上做 —— scaleYuan 不碰分", () => {
    expect(scaleYuan(1.5, 4)).toBe(6);
  });

  it("`-0` 归一化成 `+0` —— 落库 / 序列化都当它是另一个数", () => {
    expect(Object.is(scaleYuanToCentsCeil(-0.001, 1), 0)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  引擎层 —— 配送方式                                                         */
/* -------------------------------------------------------------------------- */

describe("配送方式 —— 三档 + 运费按单收", () => {
  it("三档运费:到付 ¥0 / 标快 ¥18 / 空运 ¥22", () => {
    expect(DEFAULT_SHIPPING_FEES.cod).toBe(0);
    expect(DEFAULT_SHIPPING_FEES.standard).toBe(1800);
    expect(DEFAULT_SHIPPING_FEES.air).toBe(2200);
    expect(computeShippingFeeCents("cod")).toBe(0);
    expect(computeShippingFeeCents("standard")).toBe(1800);
    expect(computeShippingFeeCents("air")).toBe(2200);
  });

  it("渲染顺序是「快 → 慢」,到付放最后(它是默认值,不是一个要选的档位)", () => {
    expect(SHIPPING_OPTIONS.map((option) => option.id)).toEqual([
      "air",
      "standard",
      "cod",
    ]);
    expect(DEFAULT_SHIPPING_OPTION).toBe("cod");
  });

  it("运费**不乘件数** —— 工作室的原话「运费按单收取」", () => {
    // 同一个函数没有件数这个入参 —— 这就是「不乘」的结构性保证
    expect(computeShippingFeeCents.length).toBe(1);
  });

  it("负数 / 非有限 / 缺档 ⇒ 0 —— 不认的数不收钱,也不报错", () => {
    const broken = { cod: -100, standard: Number.NaN, air: 2200 };
    expect(computeShippingFeeCents("cod", broken)).toBe(0);
    expect(computeShippingFeeCents("standard", broken)).toBe(0);
  });

  it("后台配的运费可以覆盖默认值", () => {
    const custom = { cod: 500, standard: 2000, air: 2500 };
    expect(computeShippingFeeCents("cod", custom)).toBe(500);
    expect(computeShippingFeeCents("air", custom)).toBe(2500);
  });

  it("运费带零头 ⇒ 向上取整到分", () => {
    const custom = { cod: 0, standard: 0, air: 2200.4 };
    expect(computeShippingFeeCents("air", custom)).toBe(2201);
  });

  it("认不出来的档位 ⇒ 顺丰到付(¥0)—— 不是按最贵那档兜底", () => {
    expect(normalizeShippingOption("cod")).toBe("cod");
    expect(normalizeShippingOption("standard")).toBe("standard");
    expect(normalizeShippingOption("air")).toBe("air");
    // 认不出来的
    expect(normalizeShippingOption(undefined)).toBe("cod");
    expect(normalizeShippingOption(null)).toBe("cod");
    expect(normalizeShippingOption("")).toBe("cod");
    expect(normalizeShippingOption("AIR")).toBe("cod");
    // ⚠️ **「express」是交期档位,不是配送方式** —— 混进来必须落到到付
    expect(normalizeShippingOption("express")).toBe("cod");
  });
});

/* -------------------------------------------------------------------------- */
/*  报价层                                                                     */
/* -------------------------------------------------------------------------- */

describe("computePrintQuote —— 件数放大的是「按件的活」", () => {
  it("克重费 / 后处理费 / 支撑加价都乘 N", () => {
    const one = computePrintQuote(SETTINGS, { ...BASE, quantity: 1 });
    const three = computePrintQuote(SETTINGS, { ...BASE, quantity: 3 });
    expect(one).not.toBeNull();
    expect(three).not.toBeNull();

    // 单件:54 元 + 5 元 + 10 元 = 69 元 = 6900 分
    expect(one?.weightFeeCents).toBe(5400);
    expect(one?.varnishFeeCents).toBe(500);
    expect(one?.supportFeeCents).toBe(1000);

    // 三件:54×3 + 5×3 + 10×3 = 207 元 = 20700 分
    expect(three?.weightFeeCents).toBe(16200);
    expect(three?.varnishFeeCents).toBe(1500);
    expect(three?.supportFeeCents).toBe(3000);
  });

  it("耗材克重 / 支撑克重也乘 N —— 那是工单的账", () => {
    const three = computePrintQuote(SETTINGS, { ...BASE, quantity: 3 });
    expect(three?.materialWeightG).toBeCloseTo(36, 6);
    expect(three?.supportWeightG).toBeCloseTo(60, 6);
  });

  it("运费**不乘件数**", () => {
    const one = computePrintQuote(SETTINGS, {
      ...BASE,
      quantity: 1,
      shippingOption: "air",
    });
    const three = computePrintQuote(SETTINGS, {
      ...BASE,
      quantity: 3,
      shippingOption: "air",
    });
    expect(one?.shippingFeeCents).toBe(2200);
    expect(three?.shippingFeeCents).toBe(2200);
  });

  it("交期加价按**整单**小计的比例 —— 印三件,加急费自动变大", () => {
    const one = computePrintQuote(SETTINGS, {
      ...BASE,
      quantity: 1,
      deliveryTier: "express",
    });
    const three = computePrintQuote(SETTINGS, {
      ...BASE,
      quantity: 3,
      deliveryTier: "express",
    });
    // 单件小计 6900 × 10% = 690
    expect(one?.deliveryFeeCents).toBe(690);
    // 三件小计 20700 × 10% = 2070
    expect(three?.deliveryFeeCents).toBe(2070);
  });

  it("⚠️ 运费**不进**交期加价的基数 —— 那是「多收钱」", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...BASE,
      quantity: 1,
      deliveryTier: "express",
      shippingOption: "air",
    });
    // 基数 = 5400 + 500 + 1000 = 6900(运费 2200 不在里面)
    // 若把运费算进基数:9100 × 10% = 910 —— 多了 220 分
    expect(quote?.deliveryFeeCents).toBe(690);
  });

  it("合计 = **五项**之和(克重 + 后处理 + 支撑 + 交期加价 + 运费)", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...BASE,
      quantity: 3,
      deliveryTier: "urgent",
      shippingOption: "air",
    });
    // 20700 + ceil(20700×0.37) + 2200 = 20700 + 7659 + 2200
    expect(quote?.deliveryFeeCents).toBe(7659);
    expect(quote?.totalPriceCents).toBe(30559);
    expect(quote?.totalPriceCents).toBe(
      (quote?.weightFeeCents ?? 0) +
        (quote?.varnishFeeCents ?? 0) +
        (quote?.supportFeeCents ?? 0) +
        (quote?.deliveryFeeCents ?? 0) +
        (quote?.shippingFeeCents ?? 0)
    );
  });

  it("支撑分段各档之和 = 支撑加价(放大之后仍然成立)", () => {
    const quote = computePrintQuote(SETTINGS, { ...BASE, quantity: 3 });
    const sum = (quote?.supportFeeBands ?? []).reduce(
      (acc, band) => acc + band.feeCents,
      0
    );
    expect(sum).toBe(quote?.supportFeeCents);
    // 放大之后各档仍然是「先乘后取整」
    expect(quote?.supportFeeBands.length).toBe(2);
    for (const band of quote?.supportFeeBands ?? []) {
      expect(band.feeCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("分段明细的**单价不乘件数** —— 单价是「每克多少钱」", () => {
    const quote = computePrintQuote(SETTINGS, { ...BASE, quantity: 3 });
    expect(quote?.supportFeeBands[0]?.priceCentsPerGram).toBe(50);
    expect(quote?.supportFeeBands[1]?.priceCentsPerGram).toBe(100);
  });

  it("老调用方(不传件数 / 配送方式)⇒ 一件 + 顺丰到付 + 运费 0", () => {
    const quote = computePrintQuote(SETTINGS, BASE);
    expect(quote?.quantity).toBe(1);
    expect(quote?.shippingOption).toBe("cod");
    expect(quote?.shippingFeeCents).toBe(0);
    // 跟 2026-11-17 之前那套口径完全一致 —— 老单不该被改动
    expect(quote?.totalPriceCents).toBe(6900);
  });

  it("交期档位跟配送方式是**两个正交的轴** —— 加急不改变运费", () => {
    const standard = computePrintQuote(SETTINGS, {
      ...BASE,
      deliveryTier: "standard",
      shippingOption: "air",
    });
    const urgent = computePrintQuote(SETTINGS, {
      ...BASE,
      deliveryTier: "urgent",
      shippingOption: "air",
    });
    expect(standard?.shippingFeeCents).toBe(urgent?.shippingFeeCents);
    expect(urgent?.deliveryFeeCents).toBeGreaterThan(
      standard?.deliveryFeeCents ?? 0
    );
  });
});

describe("优惠基数 —— 运费和交期加价都不参与", () => {
  it("基数 = 合计 − 交期加价 − 运费 = 三项按件的活", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...BASE,
      quantity: 3,
      deliveryTier: "urgent",
      shippingOption: "air",
    });
    expect(quote).not.toBeNull();
    expect(printCouponBaseCents(quote!)).toBe(20700);
  });

  it("老调用方不传运费 ⇒ 按 0 算(等价于以前「没有运费行」)", () => {
    expect(
      printCouponBaseCents({
        totalPriceCents: 6900,
        deliveryFeeCents: 690,
      })
    ).toBe(6210);
  });

  it("不会算出负数", () => {
    expect(
      printCouponBaseCents({
        totalPriceCents: 100,
        deliveryFeeCents: 500,
        shippingFeeCents: 50,
      })
    ).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  仓库扫描层                                                                 */
/* -------------------------------------------------------------------------- */

const QUOTE_ROUTE = "src/app/api/print-quote/route.ts";
const ORDERS_ROUTE = "src/app/api/print-orders/route.ts";
const ORDER_FORM =
  "src/features/print-quote/components/print-service-order-form.tsx";
const WEIGHT_TOOL =
  "src/features/print-quote/components/print-service-weight-tool.tsx";
const RECEIPT = "src/features/print-quote/components/quote-breakdown.tsx";
const PICKER = "src/features/print-quote/components/shipping-option-picker.tsx";
const ORDER_LIST = "src/features/print-quote/components/print-order-list.tsx";
const IDEMPOTENCY = "src/features/print-quote/lib/idempotency.ts";
const MIGRATION = "scripts/apply-print-shipping-schema.ts";

describe("接口层 —— 越界要拒,金额不许客户端传", () => {
  it("件数越界 ⇒ zod 拒绝(返 400)—— 不能靠引擎夹取", () => {
    for (const route of [QUOTE_ROUTE, ORDERS_ROUTE]) {
      const code = stripComments(read(route));
      // ⚠️ **必须带 max(999)** —— 只有 min 的话 5000 件会被引擎夹成兜底值,
      // 用户要 5000 件我们只收 1 件的钱 ⇒ 静默少收 4/5
      expect(code).toContain("quantity: z.number().int().min(1).max(999)");
      expect(code).toContain(
        'shippingOption: z.enum(["cod", "standard", "air"])'
      );
    }
  });

  it("客户端**传不了运费金额** —— 只能传档位 id", () => {
    const quote = stripComments(read(QUOTE_ROUTE));
    const orders = stripComments(read(ORDERS_ROUTE));
    // 请求体里没有「运费金额」这个字段
    expect(quote).not.toContain("shippingFeeCents:");
    expect(orders).not.toContain("shippingFeeCents:");
    // 运费是服务端按 settings 算的
    expect(orders).toContain("settings.shippingFees");
  });

  it("提交时只把**档位 id**发上去 —— 不发金额", () => {
    const form = stripComments(read(ORDER_FORM));
    expect(form).toContain("shippingOption,");
    // 提交载荷里没有金额
    expect(form).not.toContain("shippingFeeCents:");
    // 也没把报价总额发上去(服务端自己重算)
    expect(form).not.toContain("totalPriceCents:");
  });
});

describe("界面 —— 收据 / 选择器 / 列表", () => {
  it("收据上有**件数行**(只在 > 1 的时候摆)", () => {
    const code = stripComments(read(RECEIPT));
    expect(code).toContain("const quantity = values.quantity ?? 1;");
    expect(code).toContain("{quantity > 1 ? (");
    expect(code).toContain('t("quote.quantity")');
    expect(code).toContain('t("quantity.value", { count: quantity })');
  });

  it("收据上有**配送行** —— 到付那一档写「收件人付款」,不是 ¥0.00", () => {
    const code = stripComments(read(RECEIPT));
    expect(code).toContain("{shippingOption ? (");
    expect(code).toContain('t("shipping.row", {');
    expect(code).toContain('t("shipping.receiverPays")');
    expect(code).toContain("formatCents(shippingFeeCents)");
  });

  it("收据的脚注(后处理 / 普票)在 `<dl>` **外面**", () => {
    const code = stripComments(read(RECEIPT));
    const dlEnd = code.indexOf("</dl>");
    const footnote = code.indexOf('t("postProcess.items")');
    expect(dlEnd).toBeGreaterThan(-1);
    expect(footnote).toBeGreaterThan(dlEnd);
    // 两条脚注都在
    expect(code).toContain('t("invoice.note")');
  });

  it("收据摆**服务内容**(后处理 / 普票),但费用明细只在收据上", () => {
    const code = stripComments(read(RECEIPT));
    // 明细在(这是收据 —— 已经付掉的账)
    expect(code).toContain('t("quote.weightFee")');
    expect(code).toContain('t("quote.varnishFee")');
    expect(code).toContain('t("quote.supportFee")');
    // 后处理口径 + 普票口径
    expect(code).toContain('t("postProcess.items")');
    expect(code).toContain('t("invoice.note")');
  });

  it("配送方式选择器跟服务端**读同一份**实现", () => {
    const code = stripComments(read(PICKER));
    expect(code).toContain("computeShippingFeeCents");
    expect(code).toContain("SHIPPING_OPTIONS");
    expect(code).toContain(
      "const fee = computeShippingFeeCents(option.id, fees);"
    );
    // ¥0 显示「收件人付款」,不是 ¥0.00
    expect(code).toContain('fee === 0 ? t("shipping.receiverPays")');
  });

  it("列表页上的件数 chip 只在 > 1 的时候摆", () => {
    const code = stripComments(read(ORDER_LIST));
    expect(code).toContain("order.quantity > 1 ? (");
    expect(code).toContain('t("quantity.value", { count: order.quantity })');
  });

  it("下单表单里的件数输入框有上下限,提交前归一化", () => {
    const code = stripComments(read(ORDER_FORM));
    expect(code).toContain("min={MIN_QUANTITY}");
    expect(code).toContain("max={MAX_QUANTITY}");
    expect(code).toContain("Math.trunc(parsed)");
  });

  it("⚠️ 交期加价的小计**扣掉运费** —— 拿运费当基数就是多收钱", () => {
    const code = stripComments(read(ORDER_FORM));
    expect(code).toContain(
      "quote.totalPriceCents - quote.deliveryFeeCents - quote.shippingFeeCents"
    );
  });

  it("工单提交时带上件数和配送方式", () => {
    const code = stripComments(read(WEIGHT_TOOL));
    expect(code).toContain("quantity: values.quantity");
    expect(code).toContain("shippingOption: values.shippingOption");
  });
});

describe("幂等键 —— 件数和配送方式都要进去", () => {
  it("键里含 `quantity` + `shippingOption`", () => {
    const code = stripComments(read(IDEMPOTENCY));
    expect(code).toContain("normalizeQuantity(intent.quantity)");
    expect(code).toContain("normalizeShippingOption(intent.shippingOption)");
    // 版本号进键 —— 改了「哪些字段进键」的规则要 +1
    expect(code).toContain("print-order-intent-v2");
  });

  it("建单时那两项从请求体里取出来", () => {
    const code = stripComments(read(ORDERS_ROUTE));
    expect(code).toContain("quantity: parsed.data.quote.quantity ?? null");
    expect(code).toContain(
      "shippingOption: parsed.data.quote.shippingOption ?? null"
    );
  });
});

describe("迁移脚本 —— 只写,不跑", () => {
  it("加两列(配送方式 + 运费),幂等,不回填历史工单", () => {
    const code = stripComments(read(MIGRATION));
    expect(code).toContain("shipping_option");
    expect(code).toContain("shipping_fee_cents");
    expect(code).toContain("ADD COLUMN IF NOT EXISTS");
    expect(code).toContain("--dry-run");
  });
});

/* -------------------------------------------------------------------------- */
/*  i18n                                                                        */
/* -------------------------------------------------------------------------- */

/** 取叶子路径 —— `a.b.c` 那一串 */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  if (Array.isArray(value)) return [prefix];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    out.push(...leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

describe("i18n —— 件数 / 配送方式 / 后处理 / 普票", () => {
  it("中英文**键集完全一致** —— 少一个语言 = 那一侧显示 key 名", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    for (const ns of ["quantity", "shipping", "invoice", "postProcess"]) {
      expect(leafPaths(en.PrintQuote[ns]).sort()).toEqual(
        leafPaths(zh.PrintQuote[ns]).sort()
      );
    }
  });

  it("三档配送方式都有名字", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    for (const option of ["cod", "standard", "air"]) {
      expect(typeof zh.PrintQuote.shipping.option[option]).toBe("string");
      expect(typeof en.PrintQuote.shipping.option[option]).toBe("string");
    }
    // 工作室给的三档:到付 / 标快 / 空运
    expect(zh.PrintQuote.shipping.option.cod).toContain("到付");
    expect(zh.PrintQuote.shipping.option.standard).toContain("标快");
    expect(zh.PrintQuote.shipping.option.air).toContain("空运");
  });

  it("普票那一句是工作室的原话 —— 「含税价已包含 1% 普票 · 不另收」", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    expect(zh.PrintQuote.invoice.note).toContain("含税价");
    expect(zh.PrintQuote.invoice.note).toContain("1%");
    expect(zh.PrintQuote.invoice.note).toContain("普票");
    expect(zh.PrintQuote.invoice.note).toContain("不另收");
  });

  it("后处理那一句列全了五项 + 结构质保", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const note = zh.PrintQuote.postProcess.items;
    for (const item of ["去支撑", "清洗", "基础打磨", "UV 光油", "独立包装"]) {
      expect(note).toContain(item);
    }
    expect(note).toContain("结构质保");
  });

  it("件数那一句说清「按件计 / 按单收」", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    expect(zh.PrintQuote.quantity.hint).toContain("按件");
    expect(zh.PrintQuote.quantity.hint).toContain("按单");
    expect(zh.PrintQuote.shipping.hint).toContain("按单");
  });
});
