/**
 * 打印定价设置的**数据库读写** —— 服务端专用
 *
 * 纯逻辑那一半在 `pricing-settings.ts`(零依赖,能进单测)。这里只干三件事:
 *
 * 1. 读:配置行 + 材料库 → 解析成一份生效设置
 * 2. 写:后台保存时 upsert 配置行 / 增删改材料行
 * 3. 兜底:DB 读挂了 → 退回 env / 默认值,**绝不把异常抛进报价链路**
 *
 * ## 为什么读失败要兜底而不是抛
 *
 * 报价是收钱的链路。DB 抖一下就把整条下单链路炸掉,工作室会看到
 * 「下单失败」;而兜底到 env / 默认值,顶多是价格跟后台配的不一样 ——
 * 那是「可以立刻发现的错」,不是「用户下不了单」。
 *
 * 但**兜底不是静默的**:每次兜底都记一条 error 日志,运维能看见。
 *
 * ## 同一个请求内只查一次
 *
 * 购物车读一次 + 结算算一次会连着查两次。用 React 的 `cache()` 包一层,
 * 同一个请求内只打一次库。跨请求不缓存 —— 后台改完设置要**立刻**生效。
 */

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cache } from "react";

import { db } from "@/db";
import { printMaterial, printPricingConfig } from "@/db/schema";

import {
  type PrintMaterialKind,
  type PrintMaterialLite,
  type PrintPricingConfigLite,
  type PrintPricingOverview,
  type PrintPricingSettings,
  readPrintPricingFallback,
  resolvePrintPricingSettings,
} from "./pricing-settings";

/** 配置行的固定 id —— 打印服务只有一套定价口径 */
export const PRINT_PRICING_CONFIG_ID = "default";

/* -------------------------------------------------------------------------- */
/*  行 → 纯类型                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `numeric` 列在 Drizzle 里回来是**字符串**
 *
 * 全仓库的口径是「金额一律整数分」,而密度 / 比例 / 毫米是 `numeric` ——
 * 读出来一律 `Number()` 转一下,顺手把 `null` / `NaN` 兜成 0。
 */
function num(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMaterialLite(
  row: typeof printMaterial.$inferSelect
): PrintMaterialLite {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind as PrintMaterialKind,
    density: num(row.density),
    unitPriceCentsPerGram:
      row.unitPriceCentsPerGram === null ? null : row.unitPriceCentsPerGram,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function toConfigLite(
  row: typeof printPricingConfig.$inferSelect
): PrintPricingConfigLite {
  return {
    id: row.id,
    modelMaterialId: row.modelMaterialId,
    supportMaterialId: row.supportMaterialId,
    varnishFeeCents: row.varnishFeeCents,
    varnishEnabled: row.varnishEnabled,
    supportThreshold: num(row.supportThreshold),
    supportTier1Ratio: num(row.supportTier1Ratio),
    supportTier1PriceCentsPerGram: row.supportTier1PriceCentsPerGram,
    supportTier2PriceCentsPerGram: row.supportTier2PriceCentsPerGram,
    supportEnabled: row.supportEnabled,
    supportLiftMm: num(row.supportLiftMm),
    supportBaseMarginMm: num(row.supportBaseMarginMm),
    deliveryExpressRate: num(row.deliveryExpressRate),
    deliveryUrgentRate: num(row.deliveryUrgentRate),
  };
}

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/** 材料库(后台排序)—— 停用的也返回,后台要能看见并重新启用 */
export async function listPrintMaterials(): Promise<PrintMaterialLite[]> {
  const rows = await db
    .select()
    .from(printMaterial)
    .orderBy(asc(printMaterial.sortOrder), asc(printMaterial.createdAt));
  return rows.map(toMaterialLite);
}

/** 配置行 —— 没有就是 null(工作室还没在后台存过) */
export async function getPrintPricingConfigRow(): Promise<PrintPricingConfigLite | null> {
  const rows = await db
    .select()
    .from(printPricingConfig)
    .where(eq(printPricingConfig.id, PRINT_PRICING_CONFIG_ID))
    .limit(1);
  const row = rows[0];
  return row ? toConfigLite(row) : null;
}

/**
 * 生效中的打印定价设置
 *
 * **报价链路的唯一入口** —— 购物车重算、结算、下单都走它。
 *
 * 回退链:DB 配置行 → `PRINT_*` 环境变量 → `DEFAULT_CONFIG`(逐字段)。
 * DB 读失败 → 整份退回 env / 默认值,并记一条 error。
 */
export const getPrintPricingSettings = cache(
  async (): Promise<PrintPricingSettings> => {
    const fallback = readPrintPricingFallback();
    try {
      const [configRow, materials] = await Promise.all([
        getPrintPricingConfigRow(),
        listPrintMaterials(),
      ]);
      return resolvePrintPricingSettings({ configRow, materials, fallback });
    } catch (error) {
      console.error(
        "[print-pricing] 读配置失败,退回环境变量兜底:",
        error instanceof Error ? error.message : error
      );
      return fallback;
    }
  }
);

/**
 * 后台要的一整套:生效设置 + 材料库 + 「配置行存不存在」
 *
 * `hasConfigRow = false` 说明还在走 env / 默认值 —— 后台顶部要摆出来,
 * 让工作室知道「我配的值还没生效」。
 */
export const getPrintPricingOverview = cache(
  async (): Promise<PrintPricingOverview> => {
    const fallback = readPrintPricingFallback();
    try {
      const [configRow, materials] = await Promise.all([
        getPrintPricingConfigRow(),
        listPrintMaterials(),
      ]);
      return {
        settings: resolvePrintPricingSettings({
          configRow,
          materials,
          fallback,
        }),
        materials,
        hasConfigRow: configRow !== null,
      };
    } catch (error) {
      console.error(
        "[print-pricing] 读后台概览失败,退回环境变量兜底:",
        error instanceof Error ? error.message : error
      );
      return { settings: fallback, materials: [], hasConfigRow: false };
    }
  }
);

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/** 配置行要存的字段(价格都是**分**) */
export type SavePrintPricingConfigInput = {
  modelMaterialId: string | null;
  supportMaterialId: string | null;
  varnishFeeCents: number;
  varnishEnabled: boolean;
  supportThreshold: number;
  supportTier1Ratio: number;
  supportTier1PriceCentsPerGram: number;
  supportTier2PriceCentsPerGram: number;
  supportEnabled: boolean;
  supportLiftMm: number;
  supportBaseMarginMm: number;
  /** 0~1 的小数(0.1 = 10%) */
  deliveryExpressRate: number;
  deliveryUrgentRate: number;
};

/**
 * 写配置行(upsert,单行)
 *
 * `id` 恒为 `"default"` —— 打印服务只有一套定价口径。
 */
export async function savePrintPricingConfig(
  input: SavePrintPricingConfigInput
): Promise<void> {
  const values = {
    modelMaterialId: input.modelMaterialId,
    supportMaterialId: input.supportMaterialId,
    varnishFeeCents: input.varnishFeeCents,
    varnishEnabled: input.varnishEnabled,
    supportThreshold: String(input.supportThreshold),
    supportTier1Ratio: String(input.supportTier1Ratio),
    supportTier1PriceCentsPerGram: input.supportTier1PriceCentsPerGram,
    supportTier2PriceCentsPerGram: input.supportTier2PriceCentsPerGram,
    supportEnabled: input.supportEnabled,
    supportLiftMm: String(input.supportLiftMm),
    supportBaseMarginMm: String(input.supportBaseMarginMm),
    deliveryExpressRate: String(input.deliveryExpressRate),
    deliveryUrgentRate: String(input.deliveryUrgentRate),
    updatedAt: new Date(),
  };

  await db
    .insert(printPricingConfig)
    .values({ id: PRINT_PRICING_CONFIG_ID, ...values })
    .onConflictDoUpdate({
      target: printPricingConfig.id,
      set: values,
    });
}

/** 新增 / 改材料时要存的字段 */
export type SavePrintMaterialInput = {
  /** 有 id = 改,没 id = 新增 */
  id?: string | null;
  code: string;
  name: string;
  kind: PrintMaterialKind;
  density: number;
  /** 分/g —— 支撑材料可以不给(支撑的价走分段规则) */
  unitPriceCentsPerGram?: number | null;
  isActive: boolean;
  sortOrder?: number | null;
};

/**
 * 新增 / 改材料行
 *
 * `code` 唯一 —— 重复会撞唯一索引,让上层返回 `{ok:false}`。
 */
export async function savePrintMaterial(
  input: SavePrintMaterialInput
): Promise<PrintMaterialLite> {
  const payload = {
    code: input.code,
    name: input.name,
    kind: input.kind,
    density: String(input.density),
    unitPriceCentsPerGram:
      input.unitPriceCentsPerGram === undefined ||
      input.unitPriceCentsPerGram === null
        ? null
        : Math.round(input.unitPriceCentsPerGram),
    isActive: input.isActive,
    sortOrder: input.sortOrder ?? 0,
    updatedAt: new Date(),
  };

  if (input.id) {
    const rows = await db
      .update(printMaterial)
      .set(payload)
      .where(eq(printMaterial.id, input.id))
      .returning();
    const row = rows[0];
    if (!row) throw new Error("更新材料失败:找不到这一行");
    return toMaterialLite(row);
  }

  const rows = await db
    .insert(printMaterial)
    .values({ id: nanoid(), ...payload })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("新增材料失败:没有返回行");
  return toMaterialLite(row);
}

/**
 * 停用材料(不删)
 *
 * 真删的话,配置行引用它就会悬空 —— 配置行里的 `model_material_id`
 * 找不到材料,报价退回环境变量那条路,工作室会看到「我明明选了 X,怎么
 * 算出来是 Y」。
 */
export async function deactivatePrintMaterial(id: string): Promise<void> {
  await db
    .update(printMaterial)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(printMaterial.id, id));
}

/**
 * 某档材料有没有被配置行引用着
 *
 * 被引用着就不许删 —— 后台要提示工作室「这档正在生效,只能停用」。
 */
export async function isPrintMaterialReferenced(id: string): Promise<boolean> {
  const configRow = await getPrintPricingConfigRow();
  if (!configRow) return false;
  return configRow.modelMaterialId === id || configRow.supportMaterialId === id;
}
