// 产品效果存储层
// 已从 JSON 文件迁移到 PostgreSQL 的 product_effect 表
// 保留原函数签名，调用方可无感切换

import {
  createEffectInDb,
  deleteEffectInDb,
  findEffectInDb,
  getActiveEffectsFromDb,
  getEffectsFromDb,
  updateEffectInDb,
} from "./db-effects";
import type { ProductEffect, PromptVariable } from "./product-effect-types";

// 获取所有产品效果
export async function getEffects(): Promise<ProductEffect[]> {
  return getEffectsFromDb();
}

// 获取所有上架的效果
export async function getActiveEffects(): Promise<ProductEffect[]> {
  return getActiveEffectsFromDb();
}

// 根据 maskId 查找
export async function findEffect(
  maskId: string
): Promise<ProductEffect | undefined> {
  return findEffectInDb(maskId);
}

// 新增效果
export async function addEffect(effect: ProductEffect): Promise<void> {
  await createEffectInDb(effect);
}

// 更新效果
export async function updateEffect(
  maskId: string,
  updates: Partial<ProductEffect>
): Promise<ProductEffect | null> {
  const updated = await updateEffectInDb(maskId, updates);
  return updated ?? null;
}

// 删除效果
export async function deleteEffect(maskId: string): Promise<boolean> {
  return deleteEffectInDb(maskId);
}

// 合并变量定义：按 prompt 占位符补齐缺失项、移除多余项
// 保留前端编辑过的 label/defaultValue/required/description/options，不被覆盖
export function mergeVariables(
  prompt: string,
  provided?: PromptVariable[],
  existing?: PromptVariable[]
): PromptVariable[] {
  const matches = prompt.match(/\{\{([^}]+)\}\}/g) ?? [];
  const keys = Array.from(
    new Set(matches.map((m) => m.replace(/^\{\{|\}\}$/g, "").trim()))
  );
  const source = provided ?? existing ?? [];
  return keys.map((key) => {
    const p = source.find((v) => v.key === key);
    return {
      key,
      label: p?.label ?? key,
      defaultValue: p?.defaultValue ?? "",
      required: p?.required ?? false,
      description: p?.description,
      options: p?.options,
    };
  });
}
