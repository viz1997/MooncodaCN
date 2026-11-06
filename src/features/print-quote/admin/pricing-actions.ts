"use server";

/**
 * /admin/print-pricing —— 打印定价后台 server actions(2026-11-06)
 *
 * 工作室要能在后台改**克重的计算和计价、材料、计算逻辑**。这一组 action
 * 是那条路的唯一写入口:
 *
 * - `adminGetPrintPricingAction` —— 读「当前生效值 + 材料库」
 * - `adminSavePrintPricingAction` —— 保存计价设置(upsert 配置行)
 * - `adminSetPrintPricingMaterialAction` —— 把某一档材料设为当前生效
 * - `adminCreatePrintMaterialAction` —— 新增材料
 * - `adminUpdatePrintMaterialAction` —— 改材料
 * - `adminDeletePrintMaterialAction` —— 停用材料
 *
 * ## 跟订单那套 actions 分开
 *
 * `admin/actions.ts` 管的是**工单状态机**(状态转移 + 通知 + 留痕),
 * 这里管的是**定价配置**。两件事的关注点完全不一样,别混在一个文件里。
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(是 code 重复?是材料正在生效不能停用?)。所以这里把**能预见的**
 * 失败都变成一个 code,界面照着 code 给话。
 *
 * ## 生效值的回退链不在这里
 *
 * 回退链(DB 配置行 → `PRINT_*` 环境变量 → 默认值)在
 * `pricing-settings.ts` 的 `resolvePrintPricingSettings()` 里 —— 纯函数,
 * 跟写操作无关。这里只管「把值写进 DB」。
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  PrintPricingOverview,
  PrintPricingSettings,
} from "@/features/print-quote/lib/pricing-settings";
import {
  deactivatePrintMaterial,
  getPrintPricingConfigRow,
  getPrintPricingOverview,
  getPrintPricingSettings,
  isPrintMaterialReferenced,
  listPrintMaterials,
  type SavePrintPricingConfigInput,
  savePrintMaterial,
  savePrintPricingConfig,
} from "@/features/print-quote/lib/pricing-store";
import { adminAction } from "@/lib/safe-action";

const withAdminPricingAction = (name: string) =>
  adminAction.metadata({ action: `admin.printPricing.${name}` });

/** 每次写完都要刷的路径 */
const REVALIDATE_PATH = "/[locale]/admin/print-pricing";

/* -------------------------------------------------------------------------- */
/*  返回形状                                                                    */
/* -------------------------------------------------------------------------- */

/** 写操作的统一返回 */
export type AdminPricingWriteResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "TIER1_RATIO_BELOW_THRESHOLD"
        | "MATERIAL_NOT_FOUND"
        | "MATERIAL_IN_USE"
        | "CODE_DUPLICATE"
        | "SAVE_FAILED";
    };

/* -------------------------------------------------------------------------- */
/*  校验                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 唯一索引撞了 —— Postgres 错误码 `23505`
 *
 * Drizzle 会把底层错误包一层(`DrizzleQueryError` → `cause`),所以这里
 * 顺着 `cause` 链找一层。找不到就当「不是重复」—— 宁可让操作报错,也不
 * 要把一次真失败说成成功。
 */
function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    if (record.cause) {
      current = record.cause;
      continue;
    }
    break;
  }
  return false;
}

/** 配置行的校验 —— 比例 0~1、金额非负整数、几何非负 */
const configSchema = z.object({
  /** 当前生效的模型材料(null = 走环境变量 / 默认值那条路) */
  modelMaterialId: z.string().min(1).max(64).nullable(),
  /** 当前生效的支撑材料 */
  supportMaterialId: z.string().min(1).max(64).nullable(),
  /** 后处理 / 光油固定费(分) */
  varnishFeeCents: z.number().int().min(0).max(1_000_000),
  /** 后处理是否计入报价 */
  varnishEnabled: z.boolean(),
  /**
   * 自支撑比例阈值(1 = 1:1)
   *
   * 「本体支撑比例」= 支撑克重 ÷ 耗材克重。低于它不收支撑费。
   */
  supportThreshold: z.number().min(0.01).max(100),
  /**
   * 支撑加价第一档上界(2 = 1:2)
   *
   * 工作室的规则(2026-11-06):「模型支撑超过 1:1 的多的支撑按照 0.5 元
   * 一克,1:2 的多的支撑按照 1 元一克」。所以超出阈值的部分分两段收。
   */
  supportTier1Ratio: z.number().min(0.01).max(100),
  /** 第一档单价 分/g(1:1~1:2 那段) */
  supportTier1PriceCentsPerGram: z.number().int().min(0).max(1_000_000),
  /** 第二档单价 分/g(超过 1:2 那段) */
  supportTier2PriceCentsPerGram: z.number().int().min(0).max(1_000_000),
  /** 支撑加价总开关 */
  supportEnabled: z.boolean(),
  /** 托底高度 mm */
  supportLiftMm: z.number().min(0).max(1000),
  /** 底板留边 mm */
  supportBaseMarginMm: z.number().min(0).max(1000),
  /** 72 小时档加价比例(0~1,0.1 = 10%) */
  deliveryExpressRate: z.number().min(0).max(1),
  /** 48 小时档加价比例(0~1,0.37 = 37%) */
  deliveryUrgentRate: z.number().min(0).max(1),
});

/** 材料行的校验 */
const materialSchema = z.object({
  /** 稳定标识 —— 唯一,只允许小写字母 / 数字 / 连字符 */
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "标识只能用小写字母、数字和连字符"),
  name: z.string().min(1).max(64),
  kind: z.enum(["model", "support"]),
  /** 密度 g/cm³ */
  density: z.number().positive().max(100),
  /**
   * 单价 分/g
   *
   * **支撑材料不给这个值** —— 支撑的加价走的是配置行上那条分段规则,
   * 不是材料的每克价。所以 `kind === "support"` 时一律存 null。
   */
  unitPriceCentsPerGram: z.number().int().min(0).max(1_000_000).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
});

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读后台概览:生效设置 + 材料库 + 「配置行存不存在」
 *
 * `hasConfigRow = false` 说明还在走 `PRINT_*` 环境变量 / 默认值 ——
 * 后台顶部要把这件事摆出来,工作室才知道「我配的值还没存进库」。
 */
export const adminGetPrintPricingAction = withAdminPricingAction("get").action(
  async (): Promise<PrintPricingOverview> => {
    return getPrintPricingOverview();
  }
);

/* -------------------------------------------------------------------------- */
/*  写:计价设置                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 保存计价设置(upsert 单行)
 *
 * 「单价跟着生效材料走」—— 模型单价不是配置行上的字段,而是**生效模型材料
 * 那一行**的 `unit_price_cents_per_gram`。所以改价 = 改材料行。
 *
 * 比例的夹取在两层:
 * - zod 拦住明显离谱的(比例 > 1、密度 ≤ 0、金额不是整数)
 * - `resolvePrintPricingSettings()` 再夹一次(读的时候)
 */
export const adminSavePrintPricingAction = withAdminPricingAction("save")
  .schema(configSchema)
  .action(async ({ parsedInput }): Promise<AdminPricingWriteResult> => {
    // 第一档上界不能小于阈值 —— 否则第一档是空的,超出部分全落第二档,
    // 工作室会问「我填的 0.5 元/g 怎么一段都没用上」。
    if (parsedInput.supportTier1Ratio < parsedInput.supportThreshold) {
      return { ok: false, code: "TIER1_RATIO_BELOW_THRESHOLD" };
    }

    // 引用的材料必须真的存在 —— 否则外键会炸,报的还是看不懂的
    // 「insert or update violates foreign key constraint」。
    const materials = await listPrintMaterials();
    for (const id of [
      parsedInput.modelMaterialId,
      parsedInput.supportMaterialId,
    ]) {
      if (id && !materials.some((m) => m.id === id)) {
        return { ok: false, code: "MATERIAL_NOT_FOUND" };
      }
    }

    try {
      await savePrintPricingConfig(parsedInput);
    } catch (error) {
      console.error("[print-pricing] 保存计价设置失败:", error);
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*  写:材料库                                                                  */
/* -------------------------------------------------------------------------- */

const setMaterialSchema = z.object({
  /** 设为「当前模型材料」还是「当前支撑材料」 */
  role: z.enum(["model", "support"]),
  materialId: z.string().min(1).max(64),
});

/**
 * 把某一档材料设为当前生效
 *
 * **只改一个字段**,不动配置行上的其它值 —— 所以工作室在材料表里点
 * 「设为当前模型材料」不会把他在上面表单里改了一半的东西冲掉。
 *
 * 配置行还不存在时(还没在后台存过),用**当前生效值**打底建一行,再覆盖
 * 这一个字段。这样「第一次点保存」就把今天生效的口径固化进 DB,之后
 * 环境变量再改也不影响 —— 这正是「DB 配置行 > env」的回退链要的。
 */
export const adminSetPrintPricingMaterialAction = withAdminPricingAction(
  "setMaterial"
)
  .schema(setMaterialSchema)
  .action(async ({ parsedInput }): Promise<AdminPricingWriteResult> => {
    const materials = await listPrintMaterials();
    const material = materials.find((m) => m.id === parsedInput.materialId);
    if (!material || !material.isActive) {
      return { ok: false, code: "MATERIAL_NOT_FOUND" };
    }

    const base = await resolveConfigBase();
    const next: SavePrintPricingConfigInput = {
      ...base,
      modelMaterialId:
        parsedInput.role === "model" ? material.id : base.modelMaterialId,
      supportMaterialId:
        parsedInput.role === "support" ? material.id : base.supportMaterialId,
    };

    try {
      await savePrintPricingConfig(next);
    } catch (error) {
      console.error("[print-pricing] 设置当前材料失败:", error);
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/**
 * 配置行的「底稿」
 *
 * - 配置行存在 → 用它自己的值(原样,不做任何加工)
 * - 配置行不存在 → 用**当前生效值**(env / 默认值兜底的那一档)打底
 */
async function resolveConfigBase(): Promise<SavePrintPricingConfigInput> {
  const configRow = await getPrintPricingConfigRow();
  if (configRow) {
    return {
      modelMaterialId: configRow.modelMaterialId,
      supportMaterialId: configRow.supportMaterialId,
      varnishFeeCents: configRow.varnishFeeCents,
      varnishEnabled: configRow.varnishEnabled,
      supportThreshold: configRow.supportThreshold,
      supportTier1Ratio: configRow.supportTier1Ratio,
      supportTier1PriceCentsPerGram: configRow.supportTier1PriceCentsPerGram,
      supportTier2PriceCentsPerGram: configRow.supportTier2PriceCentsPerGram,
      supportEnabled: configRow.supportEnabled,
      supportLiftMm: configRow.supportLiftMm,
      supportBaseMarginMm: configRow.supportBaseMarginMm,
      deliveryExpressRate: configRow.deliveryExpressRate,
      deliveryUrgentRate: configRow.deliveryUrgentRate,
    };
  }

  const settings: PrintPricingSettings = await getPrintPricingSettings();
  return {
    modelMaterialId: settings.modelMaterialId,
    supportMaterialId: settings.supportMaterialId,
    varnishFeeCents: settings.varnishFeeCents,
    varnishEnabled: settings.varnishEnabled,
    supportThreshold: settings.supportThreshold,
    supportTier1Ratio: settings.supportTier1Ratio,
    supportTier1PriceCentsPerGram: settings.supportTier1PriceCentsPerGram,
    supportTier2PriceCentsPerGram: settings.supportTier2PriceCentsPerGram,
    supportEnabled: settings.supportEnabled,
    supportLiftMm: settings.supportLiftMm,
    supportBaseMarginMm: settings.supportBaseMarginMm,
    deliveryExpressRate: settings.deliveryRates.express,
    deliveryUrgentRate: settings.deliveryRates.urgent,
  };
}

/* -------------------------------------------------------------------------- */
/*  写:材料行                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 新增材料
 *
 * `code` 唯一 —— 撞了就回 `CODE_DUPLICATE`,不 throw。
 */
export const adminCreatePrintMaterialAction = withAdminPricingAction(
  "createMaterial"
)
  .schema(materialSchema)
  .action(async ({ parsedInput }): Promise<AdminPricingWriteResult> => {
    try {
      await savePrintMaterial({
        ...parsedInput,
        // 支撑材料没有每克单价 —— 它的价走配置行上那条分段规则
        unitPriceCentsPerGram:
          parsedInput.kind === "support"
            ? null
            : parsedInput.unitPriceCentsPerGram,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, code: "CODE_DUPLICATE" };
      }
      console.error("[print-pricing] 新增材料失败:", error);
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

const updateMaterialSchema = materialSchema.extend({
  /** 有 id = 改这一行 */
  id: z.string().min(1).max(64),
});

/**
 * 改材料(名称 / 标识 / 类别 / 密度 / 单价 / 排序 / 启用状态)
 *
 * **停用一条正在生效的材料会被拒** —— 停用之后配置行还指着它,生效值就会
 * 悬空(要么继续按它算,要么静默退回环境变量)。要停用,先把当前生效的
 * 那一档换成别的。
 */
export const adminUpdatePrintMaterialAction = withAdminPricingAction(
  "updateMaterial"
)
  .schema(updateMaterialSchema)
  .action(async ({ parsedInput }): Promise<AdminPricingWriteResult> => {
    const { id, ...rest } = parsedInput;

    if (!rest.isActive) {
      const referenced = await isPrintMaterialReferenced(id);
      if (referenced) {
        return { ok: false, code: "MATERIAL_IN_USE" };
      }
    }

    try {
      await savePrintMaterial({
        ...rest,
        id,
        unitPriceCentsPerGram:
          rest.kind === "support" ? null : rest.unitPriceCentsPerGram,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, code: "CODE_DUPLICATE" };
      }
      console.error("[print-pricing] 更新材料失败:", error);
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/**
 * 停用材料(**不删**)
 *
 * 真删的话,配置行引用过它就会悬空 —— 工作室会看到「我明明选了 X,怎么
 * 算出来是 Y」。所以这里只停用(`is_active = false`),行留着,工单留档
 * 还引得到。
 *
 * 正在生效的那一档不许停用 —— 先换成别的再来。
 */
export const adminDeletePrintMaterialAction = withAdminPricingAction(
  "deleteMaterial"
)
  .schema(z.object({ id: z.string().min(1).max(64) }))
  .action(async ({ parsedInput }): Promise<AdminPricingWriteResult> => {
    const referenced = await isPrintMaterialReferenced(parsedInput.id);
    if (referenced) {
      return { ok: false, code: "MATERIAL_IN_USE" };
    }

    try {
      await deactivatePrintMaterial(parsedInput.id);
    } catch (error) {
      console.error("[print-pricing] 停用材料失败:", error);
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*  给界面用的类型                                                               */
/* -------------------------------------------------------------------------- */

/*
 * `PrintMaterialLite` / `PrintMaterialKind` / `PrintPricingOverview` **不在
 * 这里 re-export** —— 「use server」文件只能导出 async 函数,类型 re-export
 * 会被 Turbopack 注册成 server action,运行时引用一个不存在的类型绑定 →
 * ReferenceError,整个页面 500(见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 界面从 `@/features/print-quote/lib/pricing-settings` 直接 import 那些类型
 * —— 那是纯类型模块,类型导入编译期就擦掉,不进 bundle。
 */
