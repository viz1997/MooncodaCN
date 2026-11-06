/**
 * 打印定价设置 —— **纯逻辑**(不碰 DB、不碰网络)
 *
 * ## 这份设置是什么
 *
 * 打印服务所有跟「钱」和「工艺」有关的参数,现在由工作室在
 * `/admin/print-pricing` 自己配:
 *
 * - **计价基础** —— 密度、单价、后处理费
 * - **支撑加价规则** —— 自支撑阈值 + **分段**(1:1~1:2 一档,超 1:2 另一档)
 * - **交期三档比例** —— 标准 0 / 加急 / 特急,按小计的百分比收
 * - **支撑几何参数** —— 托底高度、底板留边
 *
 * ## 生效值的回退链(逐字段取第一个非空)
 *
 * ```
 * DB 配置行 → PRINT_* 环境变量 → DEFAULT_CONFIG / DEFAULT_DELIVERY_RATES
 * ```
 *
 * 保留环境变量这一环,是为了**迁移那一刻不让线上价格静默变掉**:
 * 迁移脚本只建表,不写配置行 —— 配置行为空时一切照旧走环境变量,
 * 等工作室在后台第一次点保存,才把「当前生效值」固化进 DB。
 *
 * ## 为什么这个文件是纯的
 *
 * 它被服务端(报价引擎)和客户端(工具页)同时 import,所以**不能**在这里
 * import 任何服务端模块(`@/db` 会把 Node 代码拖进客户端 bundle)。
 * 连库那一半在 `pricing-store.ts`。
 *
 * 纯的另一个好处:能进 `unit` project 跑单测(`src/test/` 下的 `pure` 目录),
 * 那里没有 DB。
 */

import { DEFAULT_CONFIG } from "@/features/pricing/lib/pricing-engine";

import { DEFAULT_DELIVERY_RATES, type DeliveryRates } from "./delivery-tier";

/* -------------------------------------------------------------------------- */
/*  类型                                                                       */
/* -------------------------------------------------------------------------- */

/** 材料类别 —— 模型本体 / 支撑 */
export type PrintMaterialKind = "model" | "support";

/**
 * 材料库的一行(只要报价用得到的那几个字段)
 *
 * 刻意不直接用 `PrintMaterialRow` —— 那是 Drizzle 的行类型,带 `Date`,
 * 客户端不需要。纯类型在这里定义,客户端和服务端共用一份。
 */
export type PrintMaterialLite = {
  id: string;
  code: string;
  name: string;
  kind: PrintMaterialKind;
  /** 密度 g/cm³ */
  density: number;
  /**
   * 单价 分/g
   *
   * **只有模型材料用得上** —— 支撑材料的加价走的是「分段规则」
   * (阈值 + 两档单价,见 `PrintPricingSettings`),不是材料的每克价。
   * 支撑材料行这里留 null。
   */
  unitPriceCentsPerGram: number | null;
  isActive: boolean;
  sortOrder: number;
};

/**
 * 计价设置那一行(同样只留用得到的字段)
 *
 * `modelMaterialId` / `supportMaterialId` 可空 —— null = 没指定哪一档,
 * 走环境变量 / 默认值那条路。
 */
export type PrintPricingConfigLite = {
  id: string;
  modelMaterialId: string | null;
  supportMaterialId: string | null;
  varnishFeeCents: number;
  varnishEnabled: boolean;
  /** 自支撑比例阈值(1 = 1:1)—— 低于它不收支撑费 */
  supportThreshold: number;
  /** 第一档上界(2 = 1:2)—— 超过这一档进第二档 */
  supportTier1Ratio: number;
  /** 第一档单价 分/g(1:1~1:2 那段) */
  supportTier1PriceCentsPerGram: number;
  /** 第二档单价 分/g(超过 1:2 那段) */
  supportTier2PriceCentsPerGram: number;
  supportEnabled: boolean;
  supportLiftMm: number;
  supportBaseMarginMm: number;
  /** 加急(72h)比例 0~1 */
  deliveryExpressRate: number;
  /** 特急(48h)比例 0~1 */
  deliveryUrgentRate: number;
};

/**
 * 生效中的打印定价设置
 *
 * **报价引擎只认这一个形状** —— 它的输入是纯数据,不含任何「从哪儿来」
 * 的痕迹。这样引擎能被单测直接喂一份手写的设置。
 */
export type PrintPricingSettings = {
  /** 生效的模型材料 id(null = 走兜底) */
  modelMaterialId: string | null;
  /** 生效的模型材料名 —— 给界面显示 */
  modelMaterialName: string;
  /** 模型材料密度 g/cm³ —— 耗材克重按它算 */
  modelDensity: number;
  /** 模型材料单价 分/g */
  unitPriceCentsPerGram: number;
  /** 生效的支撑材料 id(null = 走兜底) */
  supportMaterialId: string | null;
  /** 生效的支撑材料名 —— 给界面显示 */
  supportMaterialName: string;
  /** 支撑材料密度 g/cm³ —— 支撑克重按它算 */
  supportDensity: number;
  /**
   * 自支撑比例阈值(1 = 1:1)—— 低于它不收支撑费
   *
   * 「本体支撑比例」= 支撑克重 ÷ 耗材克重。
   */
  supportThreshold: number;
  /**
   * 第一档上界(2 = 1:2)
   *
   * 工作室的规则(原文):「模型支撑超过 1:1 的多的支撑按照 0.5 元一克,
   * 1:2 的多的支撑按照 1 元一克」。所以超出阈值的部分分两段收:
   *
   * ```
   * r ≤ 1         不收钱
   * 1 < r ≤ 2     超出部分 × 第一档单价(0.5 元/g)
   * r > 2         再超出部分 × 第二档单价(1 元/g)
   * ```
   */
  supportTier1Ratio: number;
  /** 第一档单价 分/g —— 1:1~1:2 那段 */
  supportTier1PriceCentsPerGram: number;
  /** 第二档单价 分/g —— 超过 1:2 那段 */
  supportTier2PriceCentsPerGram: number;
  /** 支撑加价总开关 */
  supportEnabled: boolean;
  /** 后处理 / 光油固定费 分 */
  varnishFeeCents: number;
  /** 后处理是否计入报价 */
  varnishEnabled: boolean;
  /** 托底高度 mm */
  supportLiftMm: number;
  /** 底板留边 mm */
  supportBaseMarginMm: number;
  /** 各档交期加价比例(标准档恒为 0) */
  deliveryRates: DeliveryRates;
};

/**
 * 客户端需要的子集
 *
 * 工具页只显示**克重**,不显示价格 —— 所以它只要密度和支撑几何。
 * 单价 / 后处理 / 阈值 / 交期比例**一律服务端算**,不往浏览器里发。
 */
export type ClientPrintConfig = {
  /** 模型材料密度 g/cm³ */
  modelDensity: number;
  /** 支撑材料密度 g/cm³ */
  supportDensity: number;
  /** 托底高度 mm */
  supportLiftMm: number;
  /** 底板留边 mm */
  supportBaseMarginMm: number;
};

/** 从生效设置里挑出客户端要的那几个数 */
export function toClientPrintConfig(
  settings: PrintPricingSettings
): ClientPrintConfig {
  return {
    modelDensity: settings.modelDensity,
    supportDensity: settings.supportDensity,
    supportLiftMm: settings.supportLiftMm,
    supportBaseMarginMm: settings.supportBaseMarginMm,
  };
}

/* -------------------------------------------------------------------------- */
/*  取值与夹取                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 读一个非负数字环境变量;非法或缺失时用 fallback。
 *
 * 不合法的值静默退回默认值而不是抛错 —— 报价服务挂掉比用错价格更糟,
 * 但「配置写错了」应该被看见,所以这里把 fallback 的来源写清楚。
 *
 * (这段是从 `quote-server.ts` 搬过来的 —— 那边现在只负责算价。)
 */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/**
 * 读一个 0~1 之间的比例环境变量;越界 / 非法时用 fallback。
 *
 * 比例必须夹在 [0, 1] —— 加价超过 100% 是配置写错了(不是「加两倍」),
 * 这种值静默生效会让用户看到离谱的报价,比退回默认值危险。
 */
function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/** 密度必须 > 0 —— 0 算不出克重,负数是荒谬的 */
function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 金额 / 长度可以是 0,但不能是负数 */
function nonNegativeOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** 比例必须落在 0~1 */
function rateOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

/* -------------------------------------------------------------------------- */
/*  兜底值(env + 默认)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 环境变量 + `DEFAULT_CONFIG` 那一档 —— 回退链的最后一环
 *
 * ## 环境变量清单
 *
 * 全部可选,不配就用 `pricing-engine.ts` 里 `DEFAULT_CONFIG` 的默认值:
 *
 * | 环境变量 | 含义 | 默认 |
 * |---|---|---|
 * | `PRINT_MATERIAL_DENSITY` | 模型材料密度 g/cm³ | 1.2 |
 * | `PRINT_UNIT_PRICE_CENTS_PER_GRAM` | 模型单价 分/g | 450(4.5 元/g) |
 * | `PRINT_SUPPORT_DENSITY` | 支撑材料密度 g/cm³ | 1.28 |
 * | `PRINT_VARNISH_FEE_CENTS` | 后处理固定费 分 | 1000(10 元) |
 * | `PRINT_VARNISH_ENABLED` | 后处理是否计入(`"false"` 才关) | 计入 |
 * | `PRINT_SUPPORT_THRESHOLD` | 自支撑比例阈值(1 = 1:1) | 1 |
 * | `PRINT_SUPPORT_TIER1_RATIO` | 支撑加价第一档上界(2 = 1:2) | 2 |
 * | `PRINT_SUPPORT_TIER1_PRICE_CENTS_PER_GRAM` | 第一档单价 分/g | 50(0.5 元/g) |
 * | `PRINT_SUPPORT_TIER2_PRICE_CENTS_PER_GRAM` | 第二档单价 分/g | 100(1 元/g) |
 * | `PRINT_SUPPORT_PRICE_CENTS_PER_GRAM` | **第二档单价的旧名字**(优先用上面那个) | 100 |
 * | `PRINT_SUPPORT_ENABLED` | 支撑加价总开关(`"true"` 才开) | 关 |
 * | `PRINT_SUPPORT_LIFT_MM` | 托底高度 mm | 5 |
 * | `PRINT_SUPPORT_BASE_MARGIN_MM` | 底板留边 mm | 5 |
 * | `PRINT_DELIVERY_EXPRESS_RATE` | 72 小时档加价比例(0~1) | 0.1 |
 * | `PRINT_DELIVERY_URGENT_RATE` | 48 小时档加价比例(0~1) | 0.37 |
 *
 * 注意:本仓库的 `.gitignore` 把 `.env*` 整个排掉了(`.env.example` 也一样),
 * 所以这份说明放在代码里 —— 环境变量的名字跟着代码走,不会因为
 * 「文档在一个没人能看到的文件里」而丢失。
 *
 * **2026-11-06 起这些变量是「兜底」,不是「唯一的调价手段」** ——
 * 后台(`/admin/print-pricing`)配过之后以后台为准。
 */
export function readPrintPricingFallback(): PrintPricingSettings {
  // 第二档单价:新名字优先,旧名字兜底(老部署上配的是那个)
  const supportTier2PriceCentsPerGram = Math.round(
    envNumber(
      "PRINT_SUPPORT_TIER2_PRICE_CENTS_PER_GRAM",
      envNumber(
        "PRINT_SUPPORT_PRICE_CENTS_PER_GRAM",
        DEFAULT_CONFIG.supportTier2Price * 100
      )
    )
  );

  return {
    modelMaterialId: null,
    modelMaterialName: "默认材料",
    modelDensity: envNumber(
      "PRINT_MATERIAL_DENSITY",
      DEFAULT_CONFIG.materialDensity
    ),
    unitPriceCentsPerGram: Math.round(
      envNumber(
        "PRINT_UNIT_PRICE_CENTS_PER_GRAM",
        DEFAULT_CONFIG.unitPrice * 100
      )
    ),
    supportMaterialId: null,
    supportMaterialName: "默认支撑",
    supportDensity: envNumber(
      "PRINT_SUPPORT_DENSITY",
      DEFAULT_CONFIG.supportDensity
    ),
    supportThreshold: envNumber(
      "PRINT_SUPPORT_THRESHOLD",
      DEFAULT_CONFIG.supportThreshold
    ),
    supportTier1Ratio: envNumber(
      "PRINT_SUPPORT_TIER1_RATIO",
      DEFAULT_CONFIG.supportTier1Ratio
    ),
    supportTier1PriceCentsPerGram: Math.round(
      envNumber(
        "PRINT_SUPPORT_TIER1_PRICE_CENTS_PER_GRAM",
        DEFAULT_CONFIG.supportTier1Price * 100
      )
    ),
    supportTier2PriceCentsPerGram: supportTier2PriceCentsPerGram,
    supportEnabled: process.env.PRINT_SUPPORT_ENABLED === "true",
    varnishFeeCents: Math.round(
      envNumber("PRINT_VARNISH_FEE_CENTS", DEFAULT_CONFIG.varnishFee * 100)
    ),
    varnishEnabled: process.env.PRINT_VARNISH_ENABLED !== "false",
    supportLiftMm: envNumber("PRINT_SUPPORT_LIFT_MM", 5),
    supportBaseMarginMm: envNumber("PRINT_SUPPORT_BASE_MARGIN_MM", 5),
    deliveryRates: {
      standard: 0,
      express: envRate(
        "PRINT_DELIVERY_EXPRESS_RATE",
        DEFAULT_DELIVERY_RATES.express
      ),
      urgent: envRate(
        "PRINT_DELIVERY_URGENT_RATE",
        DEFAULT_DELIVERY_RATES.urgent
      ),
    },
  };
}

/**
 * 同步快照 —— 只走 env / 默认值那一档
 *
 * DB 读不到时的兜底,也是客户端拿不到设置时的兜底。
 */
export function getPrintPricingSettingsSnapshot(): PrintPricingSettings {
  return readPrintPricingFallback();
}

/* -------------------------------------------------------------------------- */
/*  回退链的解析                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 把「DB 配置行 + 材料库」解析成一份生效设置
 *
 * **纯函数** —— 不读 `process.env`,不碰 DB。env 那一档由调用方以
 * `fallback` 的形式传进来(`readPrintPricingFallback()` 造)。
 *
 * ## 逐字段的优先级
 *
 * - 密度 / 模型单价:**生效材料**的行 → fallback
 *   (单价跟着材料走 —— 「密度 1.2 的树脂就是 450 分/g」是同一个材料的事)
 * - 支撑加价规则(阈值 / 两档上界 / 两档单价):**DB 配置行** → fallback
 *   —— 这是一条**规则**,不是某个材料的属性,所以整条都在配置行里
 * - 其余(后处理 / 开关 / 几何 / 交期比例):**DB 配置行** → fallback
 *
 * ## 夹取
 *
 * 每个值都要过一遍合法性检查:密度 > 0、单价 ≥ 0、比例 ∈ [0,1]、几何 ≥ 0。
 * 后台填了离谱的值(比例 5、密度 0)时**退回 fallback**,而不是把离谱的价
 * 收上去 —— 报价链路不能因为后台手滑就崩。
 */
export function resolvePrintPricingSettings(input: {
  /** DB 里的配置行 —— 没有就是 null(还没在后台存过) */
  configRow: PrintPricingConfigLite | null | undefined;
  /** 材料库(可选,只用来找生效的那两档) */
  materials?: readonly PrintMaterialLite[];
  /** env + 默认值那一档 */
  fallback: PrintPricingSettings;
}): PrintPricingSettings {
  const { configRow, materials = [], fallback } = input;

  const findMaterial = (id: string | null | undefined) =>
    id ? (materials.find((m) => m.id === id) ?? null) : null;

  const modelMaterial = findMaterial(configRow?.modelMaterialId);
  const supportMaterial = findMaterial(configRow?.supportMaterialId);

  // 交期比例:标准档恒为 0(不落列),两档加急档从配置行读
  const deliveryRates: DeliveryRates = {
    standard: 0,
    express: rateOr(
      configRow?.deliveryExpressRate ?? fallback.deliveryRates.express,
      fallback.deliveryRates.express
    ),
    urgent: rateOr(
      configRow?.deliveryUrgentRate ?? fallback.deliveryRates.urgent,
      fallback.deliveryRates.urgent
    ),
  };

  // 第一档上界不能小于阈值 —— 否则第一档是空的,超出部分全进第二档
  const supportThreshold = positiveOr(
    configRow?.supportThreshold ?? fallback.supportThreshold,
    fallback.supportThreshold
  );
  const supportTier1Ratio = Math.max(
    supportThreshold,
    positiveOr(
      configRow?.supportTier1Ratio ?? fallback.supportTier1Ratio,
      fallback.supportTier1Ratio
    )
  );

  return {
    modelMaterialId: modelMaterial?.id ?? null,
    modelMaterialName: modelMaterial?.name ?? fallback.modelMaterialName,
    modelDensity: positiveOr(
      modelMaterial?.density ?? fallback.modelDensity,
      fallback.modelDensity
    ),
    unitPriceCentsPerGram: nonNegativeOr(
      modelMaterial?.unitPriceCentsPerGram ?? fallback.unitPriceCentsPerGram,
      fallback.unitPriceCentsPerGram
    ),
    supportMaterialId: supportMaterial?.id ?? null,
    supportMaterialName: supportMaterial?.name ?? fallback.supportMaterialName,
    supportDensity: positiveOr(
      supportMaterial?.density ?? fallback.supportDensity,
      fallback.supportDensity
    ),
    supportThreshold,
    supportTier1Ratio,
    supportTier1PriceCentsPerGram: nonNegativeOr(
      configRow?.supportTier1PriceCentsPerGram ??
        fallback.supportTier1PriceCentsPerGram,
      fallback.supportTier1PriceCentsPerGram
    ),
    supportTier2PriceCentsPerGram: nonNegativeOr(
      configRow?.supportTier2PriceCentsPerGram ??
        fallback.supportTier2PriceCentsPerGram,
      fallback.supportTier2PriceCentsPerGram
    ),
    supportEnabled: configRow?.supportEnabled ?? fallback.supportEnabled,
    varnishFeeCents: nonNegativeOr(
      configRow?.varnishFeeCents ?? fallback.varnishFeeCents,
      fallback.varnishFeeCents
    ),
    varnishEnabled: configRow?.varnishEnabled ?? fallback.varnishEnabled,
    supportLiftMm: nonNegativeOr(
      configRow?.supportLiftMm ?? fallback.supportLiftMm,
      fallback.supportLiftMm
    ),
    supportBaseMarginMm: nonNegativeOr(
      configRow?.supportBaseMarginMm ?? fallback.supportBaseMarginMm,
      fallback.supportBaseMarginMm
    ),
    deliveryRates,
  };
}

/**
 * 后台表单用的「材料库 + 生效设置」
 *
 * 后台要同时看到「有哪些材料」和「现在生效的是哪几档」——
 * 两者是一个页面里的两块内容,一次返回省一次往返。
 */
export type PrintPricingOverview = {
  /** 生效设置 —— 表单初值 + 顶部「当前生效值」那张卡 */
  settings: PrintPricingSettings;
  /** 材料库(按 sortOrder 排) */
  materials: PrintMaterialLite[];
  /** 配置行存不存在 —— false = 还在走 env / 默认值 */
  hasConfigRow: boolean;
};
