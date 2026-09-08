"use client";

/**
 * 2026-09-07：产品定制（刻字 / 外露）
 *
 * 终端用户在 /p/[token] 上填（与"尺寸/配件"在创建时由代理商定死语义互补）。
 * 按 order.productTypeCode 的 capabilities 动态渲染：
 * - 没 productTypeCode 或 capabilities.canEngrave=false → 不渲染（ToC 订单 或 冰箱贴）
 * - canEngrave=true → 渲染"是否刻字"开关；开启后渲染刻字文本框 + 外露开关
 *
 * 历史：初版还有皮革徽章开关挂在 R 钥匙扣上。同日下午重构：皮革徽章作为
 * 独立产品型号 LB 进入 catalog，hasLeatherBadge capability + schema 列全删。
 *
 * 编辑模式：仅 PENDING 阶段可改（GENERATING 后已交给上游生图，刻什么
 * 字都来不及，强行改会和服务端生成内容不一致）。非 PENDING 阶段退化为
 * 只读 summary（"已定制"区，展示在 UploadStep 上方）。
 */

import { Pencil, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import {
  formatCustomization,
  getProductType,
} from "@/features/gpt-image/lib/product-catalog";
import type { OrderView } from "@/features/gpt-image/lib/types";

interface ProductConfigSectionProps {
  order: OrderView;
  /** 是否处于 PENDING 阶段（可编辑）。非 PENDING 退化为只读 summary。 */
  editable: boolean;
  /** 保存中态（来自 actions.configuring） */
  saving: boolean;
  /** 提交调用，success=true 表示后端已落库（包含服务端能力联动） */
  onSave: (input: {
    engravingText: string | null;
    engravingExposed: boolean | null;
  }) => Promise<boolean>;
}

export function ProductConfigSection({
  order,
  editable,
  saving,
  onSave,
}: ProductConfigSectionProps) {
  const type = getProductType(order.productTypeCode);
  const canEngrave = type?.capabilities.canEngrave ?? false;

  // 本地草稿态：UI 即时响应，保存按钮才落库
  const [engrave, setEngrave] = useState<boolean>(
    Boolean(order.engravingText && order.engravingText.trim().length > 0)
  );
  const [engravingText, setEngravingText] = useState<string>(
    order.engravingText ?? ""
  );
  const [engravingExposed, setEngravingExposed] = useState<boolean>(
    order.engravingExposed === true
  );

  // 订单刷新（别人/外部改了这 2 个字段）→ 同步本地草稿
  useEffect(() => {
    const text = order.engravingText ?? "";
    setEngrave(text.trim().length > 0);
    setEngravingText(text);
    setEngravingExposed(order.engravingExposed === true);
  }, [order.engravingText, order.engravingExposed]);

  // 没型号 或 不能刻字 → 不渲染（hooks 全部已声明后再做早返，符合 rules-of-hooks）
  if (!type || !canEngrave) return null;

  // 摘要（始终展示，作为用户已选了什么的最权威视图）
  const summary = formatCustomization({
    engravingText: order.engravingText,
    engravingExposed: order.engravingExposed,
  });

  // 只读 summary（非 PENDING 阶段）：直接展示
  if (!editable) {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
          <Sparkles className="h-3.5 w-3.5" />
          你的定制
        </div>
        {summary ? (
          <p className="mt-1.5 text-sm text-stone-800">{summary}</p>
        ) : (
          <p className="mt-1.5 text-xs text-stone-400">未定制</p>
        )}
      </section>
    );
  }

  // 编辑模式：本地草稿 + 保存按钮
  const dirty =
    (engrave ? engravingText.trim() : "") !==
      (order.engravingText?.trim() ?? "") ||
    engravingExposed !== (order.engravingExposed === true);

  const handleSave = async () => {
    // 草稿 → 入参：刻字关闭时清空文本
    const finalText = engrave ? engravingText.trim() : "";
    await onSave({
      engravingText: finalText.length > 0 ? finalText : null,
      engravingExposed: engrave ? engravingExposed : null,
    });
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
        <Sparkles className="h-3.5 w-3.5" />
        产品定制（PENDING 阶段可改，开始生成后锁定）
      </div>

      <div className="rounded-lg border border-stone-100 bg-stone-50/50 px-3 py-2 space-y-2">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div>
            <div className="text-sm font-medium text-stone-800">刻字</div>
            <p className="text-[11px] text-stone-500 mt-0.5">
              最多 40 个字符（中文 / 英文 / 数字 / 空格）
            </p>
          </div>
          <input
            type="checkbox"
            className="h-5 w-5 accent-emerald-600"
            checked={engrave}
            onChange={(e) => setEngrave(e.target.checked)}
            disabled={saving}
          />
        </label>
        {engrave && (
          <>
            <input
              type="text"
              value={engravingText}
              onChange={(e) => setEngravingText(e.target.value.slice(0, 40))}
              maxLength={40}
              placeholder="如：Love U / 2026.09.07 / 宝贝 1 岁"
              disabled={saving}
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
            />
            <label className="flex items-center justify-between gap-3 pt-1 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-stone-800">外露</div>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  关 = 内刻（默认）。开 = 刻在外表面
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 accent-emerald-600"
                checked={engravingExposed}
                onChange={(e) => setEngravingExposed(e.target.checked)}
                disabled={saving}
              />
            </label>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-[11px] text-stone-500 flex-1 min-w-0">
          {summary ? <>当前：{summary}</> : <>未定制（可不选）</>}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          <Pencil className="h-3.5 w-3.5" />
          {saving ? "保存中…" : "保存定制"}
        </button>
      </div>
    </section>
  );
}
