/**
 * 2026-09-12：prompt order 按规格价格计算（basePrice + 加价规则）
 *
 * 历史：之前 promptTemplate.price 是单一固定值，createOrder* / submitPublicOrder*
 * / submitImageGenDemoAction 三个 server action 全按这个固定值扣积分。对账痛点：
 * 同模板不同规格组合（4cm/6cm × 皮套/无 × 棕/黑 ...）扣一样积分，代理商无法按
 * 规格统计"哪种组合各扣了多少"。
 *
 * 设计：
 *   本单总价 = promptTemplate.price（基础价） + Σ(matching promptTemplatePrice.delta)
 *   matching 规则：promptTemplatePrice.specKey 命中当前订单选中的规格项
 *
 * specKey 命名（与 prompt_template_price migration 注释对齐）：
 *   size:4 / size:6 / size:8 / size:11
 *   accessory:leather / accessory:pvc / accessory:bracket
 *   leather_color:natural / leather_color:brown / leather_color:black /
 *                  leather_color:red / leather_color:navy
 *   protection:exposed / protection:pvc
 *
 * 与各 server action 的关系：
 *   - submit-image-gen-demo.ts：demo 流一键下单（核心入口）
 *   - actions/order.ts (createOrderFromImageGenAction)：老 6 步工作台
 *   - submitPublicOrderAction：免登录 /p/[token] 下单
 *   三处都走本 helper，避免散落多份价格规则导致对账口径不一致。
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { promptTemplatePrice } from "@/db/schema";
import {
  getAccessory,
  getLeatherColor,
  getProductType,
} from "@/features/gpt-image/lib/product-catalog";

/**
 * 价格计算入参：当前订单用户选的规格（与 promptOrder 列 1:1）。
 * 允许 null —— null 表示"用户没选 / capability 不支持"，对应的 specKey 不会
 * 匹配任何加价规则。
 */
export interface PriceCalcInput {
  productTypeCode: string | null;
  productSize: string | null;
  accessoryCode: string | null;
  leatherColor: string | null;
  leatherExposed: boolean | null;
  pvcProtection: boolean | null;
}

/**
 * 加价明细单条（写入 promptOrder.creditsBreakdown + creditsTransaction.metadata）。
 */
export interface PriceBreakdownItem {
  specKey: string;
  /** 给人看的标签（来自 prompt_template_price.label；运行时回退组装） */
  label: string;
  delta: number;
}

export interface PriceCalcResult {
  /** promptTemplate.price（基础价） */
  basePrice: number;
  /** Σ(matching rule.delta)，可能为 0 */
  deltaTotal: number;
  /** basePrice + deltaTotal，最终 consumeCredits 的 amount */
  totalCredits: number;
  /** 加价明细（按 specKey 字母序）—— 对账可见 */
  breakdown: PriceBreakdownItem[];
}

/**
 * 按规格组合计算本单总扣积分。
 *
 * 流程：
 *   1. 校验 size / accessory / leatherColor / protection 各项值合法（防止
 *      promptOrder 写入脏数据后调用 helper 时返非预期 delta）
 *   2. 拼出当前订单"激活的 specKey 集合"
 *   3. 查 promptTemplatePrice WHERE templateId=? AND specKey IN (...)，
 *      未配置规则的 specKey 视为 delta=0（基础价覆盖）
 *   4. 按 specKey 字母序组装 breakdown，total = basePrice + Σ(delta)
 *
 * 为什么校验在 helper 里再做一次：
 *   server action 已经做过 validateProductSpec / validateLeatherColor 等，
 *   helper 这里加一次兜底防御：万一调用方传脏值，至少不会返负积分或 NaN。
 *   校验失败抛 Error，server action 接住 → 抛给前端可读消息。
 */
export async function computePromptOrderCredits(
  templateId: string,
  basePrice: number,
  input: PriceCalcInput
): Promise<PriceCalcResult> {
  // 1. 兜底校验（仅在 productTypeCode 非空时校验具体值，避免无型号老订单误伤）
  if (input.productTypeCode) {
    const type = getProductType(input.productTypeCode);
    if (!type) {
      throw new Error(`未知的产品型号：${input.productTypeCode}`);
    }
    if (input.productSize && !type.sizes.includes(input.productSize)) {
      throw new Error(
        `产品型号 ${type.code} 不支持尺寸 ${input.productSize}cm`
      );
    }
    if (
      input.accessoryCode &&
      !type.accessories.includes(
        input.accessoryCode as (typeof type.accessories)[number]
      )
    ) {
      throw new Error(
        `产品型号 ${type.code} 不支持配件 ${input.accessoryCode}`
      );
    }
    if (input.leatherColor) {
      const color = getLeatherColor(input.leatherColor);
      if (!color) {
        throw new Error(`未知的皮革颜色：${input.leatherColor}`);
      }
    }
    if (input.leatherExposed === true && input.pvcProtection === true) {
      throw new Error("皮革外露 与 PVC 保护 不能同时勾选");
    }
  }

  // 2. 拼当前订单激活的 specKey 集合
  const activeSpecKeys: string[] = [];
  if (input.productSize) activeSpecKeys.push(`size:${input.productSize}`);
  if (input.accessoryCode) {
    activeSpecKeys.push(`accessory:${input.accessoryCode}`);
  }
  if (input.leatherColor) {
    activeSpecKeys.push(`leather_color:${input.leatherColor}`);
  }
  // protection：互斥（皮革外露 vs PVC 保护），只会有一个命中
  if (input.leatherExposed === true) {
    activeSpecKeys.push("protection:exposed");
  } else if (input.pvcProtection === true) {
    activeSpecKeys.push("protection:pvc");
  }

  // 3. 查 promptTemplatePrice 里命中的规则
  let matched: Array<{
    specKey: string;
    priceDelta: number;
    label: string;
  }> = [];
  if (activeSpecKeys.length > 0) {
    const rows = await db
      .select({
        specKey: promptTemplatePrice.specKey,
        priceDelta: promptTemplatePrice.priceDelta,
        label: promptTemplatePrice.label,
      })
      .from(promptTemplatePrice)
      .where(
        and(
          eq(promptTemplatePrice.templateId, templateId),
          // specKey IN (...) —— 用 OR 链（Drizzle 没有 in-array 跨字段便捷 API）
          ...activeSpecKeys.map((key) =>
            eq(promptTemplatePrice.specKey, key)
          )
        )
      );
    matched = rows;
  }

  // 4. 按 specKey 字母序组装 breakdown（跨订单对比易读）
  const breakdown: PriceBreakdownItem[] = matched
    .slice()
    .sort((a, b) => (a.specKey < b.specKey ? -1 : a.specKey > b.specKey ? 1 : 0))
    .map((r) => ({
      specKey: r.specKey,
      // DB label 优先；空则回退运行时组装（"6cm + 30"）
      label: r.label.trim() || fallbackLabel(r.specKey, r.priceDelta),
      delta: r.priceDelta,
    }));

  const deltaTotal = breakdown.reduce((sum, b) => sum + b.delta, 0);
  const totalCredits = basePrice + deltaTotal;

  return {
    basePrice,
    deltaTotal,
    totalCredits,
    breakdown,
  };
}

/**
 * DB label 为空时，回退组装一条可读标签（用于对账汇总）。
 * 形如：「6cm +30」「皮套 +20」「黑色 +15」「实物外露 +10」。
 */
function fallbackLabel(specKey: string, delta: number): string {
  const sign = delta >= 0 ? `+${delta}` : `${delta}`;
  const [dim, value] = specKey.split(":");
  if (!dim || !value) return `${specKey} ${sign}`;
  switch (dim) {
    case "size":
      return `${value}cm ${sign}`;
    case "accessory": {
      const acc = getAccessory(value);
      return `${acc?.name ?? value} ${sign}`;
    }
    case "leather_color": {
      const color = getLeatherColor(value);
      return `${color?.name ?? value} ${sign}`;
    }
    case "protection":
      if (value === "exposed") return `实物外露 ${sign}`;
      if (value === "pvc") return `PVC 保护 ${sign}`;
      return `${value} ${sign}`;
    default:
      return `${specKey} ${sign}`;
  }
}