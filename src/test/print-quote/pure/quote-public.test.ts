import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/features/pricing/lib/pricing-engine";
import { toPublicQuote } from "@/features/print-quote/lib/quote-public";
import type { PrintQuote } from "@/features/print-quote/lib/quote-types";

/**
 * 单价一个字节都不出去(2026-11-16)
 *
 * 工作室的原话:**「注意模型检测克重报价不要展示 4.5 元/g 这种单价,避免暴露
 * 我们的成本」**。
 *
 * ## 漏在哪儿了
 *
 * 界面本来就没摆单价 —— 工具页、材料参数弹窗、报价弹窗、收据,四处都干净。
 * 漏的是**两个地方**:
 *
 * 1. **传输层** —— 内部那份报价 `PrintQuote` 带着 `unitPriceCentsPerGram` /
 *    `supportFeeBands`(每一档都带单价)/ `excessSupportWeightG`,它们跟着
 *    响应体一路走到浏览器。「查看网页源代码 / DevTools → Network」就能看到。
 * 2. **客户端 bundle** —— `pricing-engine.ts` 里的 `DEFAULT_CONFIG` 带着
 *    `unitPrice: 4.5` 这个**字面量**。只要客户端能 import 到这个文件,
 *    任何人打开页面源码 / 翻一下 JS chunk 就看见了 —— **哪怕界面上一个
 *    单价字都没摆**。
 *
 * 第 ② 条是关键:「不展示」和「不在包里」是两件事。
 *
 * ## 两条防线
 *
 * | 防线 | 做法 |
 * |---|---|
 * | **传输层** | 边界上投影一次 —— `toPublicQuote()`(**白名单**) |
 * | **bundle 层** | 客户端**不许** import `pricing-engine.ts` |
 *
 * ## 仓库里没有 `server-only` 这个包
 *
 * 装不了就靠**结构 + 单测**守:下面那个「客户端可达图」从**每一个**
 * `"use client"` 文件出发,顺着 import 边走一遍,看能不能走到
 * `pricing-engine.ts`。
 *
 * 走到 = 成本字面量进客户端 bundle = **测试当场失败**。
 *
 * 顺带守住「别把它改成黑名单」:`toPublicQuote()` 是**逐字段列出来**的白名单
 * —— 以后有人给 `PrintQuote` 加字段,TypeScript 就会报错,逼着做决定
 * 「这个字段能不能出去」。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(isAbsolute(rel) ? rel : join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前有单价」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 成本引擎 —— ⛔ 不许进客户端 bundle */
const PRICING_ENGINE = "src/features/pricing/lib/pricing-engine.ts";
/** 定价配置(读 DB / 环境变量的那一层)—— 同样只在服务端 */
const PRICING_SETTINGS = "src/features/print-quote/lib/pricing-settings.ts";
/** 对外投影 */
const QUOTE_PUBLIC = "src/features/print-quote/lib/quote-public.ts";
/** 共享类型 */
const QUOTE_TYPES = "src/features/print-quote/lib/quote-types.ts";
/** 工单落库 / 用户侧视图 */
const ORDER_STORE = "src/features/print-quote/lib/order-store.ts";
/** 服务端算价 */
const QUOTE_SERVER = "src/features/print-quote/lib/quote-server.ts";

const QUOTE_ROUTE = "src/app/api/print-quote/route.ts";
const PRINT_ORDER_ROUTE = "src/app/api/print-orders/route.ts";
const PRINT_ORDER_DETAIL_ROUTE = "src/app/api/print-orders/[orderNo]/route.ts";

/** 一份**内部**报价 —— 三个成本口径的字段都在 */
const FULL_QUOTE: PrintQuote = {
  materialWeightG: 8.3,
  supportWeightG: 6.7,
  volumeCM3: 6.92,
  surfaceAreaCM2: 24.1,
  dims: [40, 40, 30],
  density: 1.2,
  /** ¥4.50/g —— 内部口径 */
  unitPriceCentsPerGram: 450,
  weightFeeCents: 3735,
  varnishFeeCents: 1000,
  supportFeeCents: 385,
  excessSupportWeightG: 5.5,
  supportFeeBands: [
    {
      fromRatio: 1,
      upToRatio: 2,
      priceCentsPerGram: 50,
      weightG: 3.3,
      feeCents: 165,
    },
    {
      fromRatio: 2,
      upToRatio: null,
      priceCentsPerGram: 100,
      weightG: 2.2,
      feeCents: 220,
    },
  ],
  deliveryFeeCents: 0,
  deliveryTier: "standard",
  deliveryHours: 96,
  deliveryRates: { standard: 0, express: 0.1, urgent: 0.37 },
  totalPriceCents: 5120,
};

/** 对外报价**应该**有的字段 —— 白名单 */
const PUBLIC_FIELDS = [
  "deliveryFeeCents",
  "deliveryHours",
  "deliveryRates",
  "deliveryTier",
  "density",
  "dims",
  "materialWeightG",
  "supportFeeCents",
  "supportWeightG",
  "surfaceAreaCM2",
  "totalPriceCents",
  "varnishFeeCents",
  "volumeCM3",
  "weightFeeCents",
] as const;

/** 成本口径的字段名 —— 对外一个都不许出现 */
const COST_FIELDS = [
  "unitPriceCentsPerGram",
  "supportFeeBands",
  "excessSupportWeightG",
  "priceCentsPerGram",
] as const;

// ---------------------------------------------------------------------------
// 客户端可达图 —— 「这个文件会不会进客户端 bundle」
// ---------------------------------------------------------------------------

/** 列出 `src/` 下所有 `.ts` / `.tsx` */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const SRC_DIR = join(ROOT, "src");
const ALL_SOURCE_FILES = listSourceFiles(SRC_DIR);

/** 把 import 说明符解析成仓库里的绝对路径;解析不了(外部包)返回 null */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(SRC_DIR, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(fromFile), spec);
  } else {
    // 外部包(npm)—— 不在我们要扫的范围里
    return null;
  }
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 这个 import 说明符是**纯类型**吗?
 *
 * `import type { X } from "..."` 在编译期**整个被抹掉** ⇒ 那个模块不进
 * bundle。所以走图的时候要跳过它们 —— 否则会误报。
 */
function isTypeOnlyClause(clause: string): boolean {
  const c = clause.trim();
  // `import type { A, B } from` / `import type X from`
  return /^type\s*[{*]/.test(c) || /^type\s+\w/.test(c);
}

/**
 * 遍历正则的全部匹配
 *
 * 不用 `while ((m = re.exec(src)))` 那个写法 —— Biome 的
 * `noAssignInExpressions` 不许把赋值写在表达式里。
 */
function* matchAll(re: RegExp, src: string): Generator<RegExpExecArray> {
  let m = re.exec(src);
  while (m) {
    yield m;
    m = re.exec(src);
  }
}

/** 从源码里抽出「会真的进 bundle」的 import 说明符 */
function valueImportSpecifiers(src: string): string[] {
  const specs: string[] = [];

  // import … from "…"
  const importRe = /\bimport\s+([^;]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of matchAll(importRe, src)) {
    if (!isTypeOnlyClause(m[1] ?? "")) specs.push(m[2] as string);
  }

  // import "…" —— 副作用导入
  const sideEffectRe = /\bimport\s+["']([^"']+)["']/g;
  for (const m of matchAll(sideEffectRe, src)) {
    specs.push(m[1] as string);
  }

  // export … from "…"
  const exportRe = /\bexport\s+([^;]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of matchAll(exportRe, src)) {
    if (!isTypeOnlyClause(m[1] ?? "")) specs.push(m[2] as string);
  }

  // import("…") —— 动态导入
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of matchAll(dynamicRe, src)) {
    specs.push(m[1] as string);
  }

  return specs;
}

/** 这个文件是客户端组件吗(`"use client"` 指令) */
function isClientComponent(src: string): boolean {
  // 去掉文件头的注释再看 —— 有些文件把说明写在指令前面
  const head = src
    .replace(/^\s*\/\*[\s\S]*?\*\//, "")
    .replace(/^\s*\/\/[^\n]*\n/gm, "");
  return /^\s*["']use client["']/.test(head);
}

/**
 * 这个文件是**服务端模块**吗(`"use server"` 指令)
 *
 * `"use server"` 的文件**不进客户端 bundle** —— 客户端拿到的是 Next 生成
 * 的 RPC 桩(一个空壳),实现留在服务端。
 *
 * ⇒ 走图的时候**到这儿就停**:它里面 import 的东西不会被带进客户端。
 * (不这么处理就会误报 —— 后台那些 `"use server"` 的 action 文件都 import
 * 了定价配置。)
 */
function isServerModule(src: string): boolean {
  const head = src
    .replace(/^\s*\/\*[\s\S]*?\*\//, "")
    .replace(/^\s*\/\/[^\n]*\n/gm, "");
  return /^\s*["']use server["']/.test(head);
}

/**
 * 从**每一个** `"use client"` 文件出发,能走到的所有模块
 *
 * 返回 `Map<模块绝对路径, 走到它的那个客户端入口>` —— 报的时候要能说清
 * 「是哪个客户端文件把它拉进来的」。
 */
let reachableCache: Map<string, string> | null = null;

function clientReachableMap(): Map<string, string> {
  // 走一遍要读几百个文件 —— 缓存起来,别跑三次
  if (reachableCache) return reachableCache;
  const roots = ALL_SOURCE_FILES.filter((f) => isClientComponent(read(f)));
  const reachable = new Map<string, string>();

  for (const root of roots) {
    const queue: string[] = [root];
    const seen = new Set<string>([root]);
    while (queue.length > 0) {
      const file = queue.shift() as string;
      const src = read(file);

      // ⚠️ `"use server"` 的文件是**边界** —— 客户端拿到的是 Next 生成的
      // RPC 桩,它的实现和它的 import **都不进客户端 bundle**。
      // 到这儿就停,不然会误报(后台那些 action 文件都 import 了定价配置)。
      if (isServerModule(src)) continue;

      for (const spec of valueImportSpecifiers(src)) {
        const target = resolveImport(file, spec);
        if (!target) continue;
        if (!reachable.has(target)) {
          reachable.set(target, root);
          if (!seen.has(target)) {
            seen.add(target);
            queue.push(target);
          }
        }
      }
    }
  }
  reachableCache = reachable;
  return reachable;
}

/** 客户端能不能走到某个模块 */
function clientCanReach(relPath: string): { reachable: boolean; via?: string } {
  const target = join(ROOT, relPath);
  const map = clientReachableMap();
  const via = map.get(target);
  return via ? { reachable: true, via } : { reachable: false };
}

// ---------------------------------------------------------------------------
// 防线一:传输层 —— 白名单投影
// ---------------------------------------------------------------------------

describe("对外报价 —— 单价一个字节都不出去", () => {
  it("对外报价里没有单价 / 分段明细 / 超阈值克重", () => {
    const pub = toPublicQuote(FULL_QUOTE);

    for (const field of COST_FIELDS) {
      expect(Object.keys(pub)).not.toContain(field);
    }
  });

  it("对外报价的字段就是那份白名单(多一个都不行)", () => {
    const pub = toPublicQuote(FULL_QUOTE);

    expect(Object.keys(pub).sort()).toEqual([...PUBLIC_FIELDS].sort());
  });

  it("对外报价仍然带着**总额** —— 用户得知道自己要付多少", () => {
    const pub = toPublicQuote(FULL_QUOTE);

    expect(pub.totalPriceCents).toBe(FULL_QUOTE.totalPriceCents);
    expect(pub.weightFeeCents).toBe(FULL_QUOTE.weightFeeCents);
    expect(pub.supportFeeCents).toBe(FULL_QUOTE.supportFeeCents);
    expect(pub.varnishFeeCents).toBe(FULL_QUOTE.varnishFeeCents);
    expect(pub.deliveryFeeCents).toBe(FULL_QUOTE.deliveryFeeCents);
  });

  it("投影是**白名单**不是黑名单 —— 内部那份一个字段都没少", () => {
    // 内部那份留着单价(后台要显示、留档要记、工单要能对账)
    expect(FULL_QUOTE.unitPriceCentsPerGram).toBe(450);
    expect(FULL_QUOTE.supportFeeBands).toHaveLength(2);
    expect(FULL_QUOTE.excessSupportWeightG).toBe(5.5);
  });

  it("`PublicPrintQuote` 排除的正是那三个成本字段", () => {
    const code = stripComments(read(QUOTE_TYPES));

    expect(code).toContain("PublicPrintQuote");
    for (const field of [
      "unitPriceCentsPerGram",
      "supportFeeBands",
      "excessSupportWeightG",
    ]) {
      expect(code).toContain(field);
    }
  });

  it("投影是**逐字段写出来**的白名单(不许有 `...rest` 那种抄底)", () => {
    const code = stripComments(read(QUOTE_PUBLIC));

    expect(code).toContain("export function toPublicQuote(");
    // 白名单 = 每个字段都点名。不许「把剩下的都抄过去」——
    // 那等于黑名单,以后给内部报价加个字段就自动泄出去了。
    expect(code).not.toMatch(/\.\.\./);
    for (const field of PUBLIC_FIELDS) {
      expect(code).toContain(field);
    }
    for (const field of COST_FIELDS) {
      expect(code).not.toContain(field);
    }
  });

  it("用户侧工单详情里没有单价字段", () => {
    const code = stripComments(read(QUOTE_TYPES));
    const start = code.indexOf("export type UserPrintOrderDetail");
    expect(start).toBeGreaterThan(-1);
    const block = code.slice(start, code.indexOf("};", start));

    expect(block).not.toContain("unitPriceCentsPerGram");
    // 克重费 / 后处理 / 支撑加价 —— 那是**总额**,要摆
    expect(block).toContain("weightFeeCents");
    expect(block).toContain("varnishFeeCents");
    expect(block).toContain("supportFeeCents");
  });
});

// ---------------------------------------------------------------------------
// 防线二:API 边界 —— 每一处发出去的报价都要投影
// ---------------------------------------------------------------------------

describe("API 边界 —— 每一份发出去的报价都投影一次", () => {
  it("报价预览接口用的是对外形状", () => {
    const code = stripComments(read(QUOTE_ROUTE));

    expect(code).toContain("quote: toPublicQuote(quote)");
  });

  it("建工单接口用的是对外形状", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    expect(code).toContain("quote: toPublicQuote(quote)");
  });

  it("工单详情接口不带单价", () => {
    const code = stripComments(read(PRINT_ORDER_DETAIL_ROUTE));

    expect(code).toContain("toUserPrintOrderDetail(");
    expect(code).not.toContain("unitPriceCentsPerGram");
  });

  it("用户侧工单视图不带单价(工单详情页的 RSC 载荷也是一条路)", () => {
    const code = stripComments(read(ORDER_STORE));

    expect(code).toContain("export function toUserPrintOrderDetail(");
    const start = code.indexOf("export function toUserPrintOrderDetail(");
    const block = code.slice(start, code.indexOf("\n}", start));
    expect(block).not.toContain("unitPriceCentsPerGram");
  });

  it("但**留档**还是要记单价(对账要能复算)", () => {
    const code = stripComments(read(ORDER_STORE));

    expect(code).toContain(
      "unitPriceCentsPerGram: input.quote.unitPriceCentsPerGram"
    );
  });
});

// ---------------------------------------------------------------------------
// 防线三:客户端 bundle —— 成本字面量不许进去
// ---------------------------------------------------------------------------

describe("客户端 bundle —— 成本字面量不许进去", () => {
  it("客户端**走不到** `pricing-engine.ts`(含 `unitPrice: 4.5` 字面量)", () => {
    const { reachable, via } = clientCanReach(PRICING_ENGINE);

    expect(
      reachable,
      via
        ? `客户端文件 ${via} 走得到 ${PRICING_ENGINE} —— 成本字面量进 bundle 了`
        : ""
    ).toBe(false);
  });

  it("客户端**走不到**定价配置那一层", () => {
    const { reachable, via } = clientCanReach(PRICING_SETTINGS);

    expect(
      reachable,
      via ? `客户端文件 ${via} 走得到 ${PRICING_SETTINGS}` : ""
    ).toBe(false);
  });

  it("客户端**走不到**服务端算价那一层", () => {
    const { reachable, via } = clientCanReach(QUOTE_SERVER);

    expect(
      reachable,
      via ? `客户端文件 ${via} 走得到 ${QUOTE_SERVER}` : ""
    ).toBe(false);
  });

  it("成本字面量**还在**引擎里(只是搬到了服务端 —— 别把它删了)", () => {
    // 服务端要靠它算价(后台要显示、留档要记、工单要能对账)
    expect(DEFAULT_CONFIG.unitPrice).toBe(4.5);
    expect(DEFAULT_CONFIG.supportTier1Price).toBe(0.5);
    expect(DEFAULT_CONFIG.supportTier2Price).toBe(1);
  });

  it("引擎文件自己声明了「⛔ 不许进客户端 bundle」", () => {
    const code = read(PRICING_ENGINE);

    expect(code).toContain("⛔");
    expect(code).toContain("quote-public.test.ts");
    // 它自己**不是**客户端组件
    expect(isClientComponent(code)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 防线四:界面上不许出现「每克单价」的字样
// ---------------------------------------------------------------------------

describe("界面文案 —— 不许有「每克单价」那种标签", () => {
  it("两个语言里都没有 `MaterialPricing.price` / `MaterialPricing.unit`", () => {
    for (const locale of ["zh", "en"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`)) as Record<
        string,
        Record<string, unknown>
      >;
      const mp = messages.MaterialPricing ?? {};

      expect(Object.keys(mp)).not.toContain("price");
      expect(Object.keys(mp)).not.toContain("unit");
    }
  });

  it("批量模式那几个单价标签也删了", () => {
    for (const locale of ["zh", "en"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`)) as Record<
        string,
        Record<string, Record<string, unknown>>
      >;
      const batch = messages.MaterialPricing?.batch ?? {};

      for (const key of [
        "unitPrice",
        "supportPrice",
        "totalPrice",
        "varnishOn",
        "varnishOff",
        "supportOn",
        "yuan",
      ]) {
        expect(Object.keys(batch)).not.toContain(key);
      }
    }
  });

  it("收据上摆的是**克重**和**那笔费用**,不是单价", () => {
    for (const locale of ["zh", "en"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`)) as Record<
        string,
        Record<string, Record<string, unknown>>
      >;
      const quote = messages.PrintQuote?.quote ?? {};

      expect(Object.keys(quote)).toContain("materialWeight");
      expect(Object.keys(quote)).toContain("total");
      expect(Object.keys(quote)).not.toContain("unitPrice");
    }
  });
});
