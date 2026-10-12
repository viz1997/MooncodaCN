"use client";

/**
 * 2026-09-07：产品定制（刻字 / 外露）
 * 2026-09-10：LB 皮革徽章扩展 → 加 4 个 capability-gated 块
 *   - 皮革颜色（5 色色卡）
 *   - 皮革外露开关（与 engravingExposed 解耦）
 *   - PVC 保护开关
 *   - 备注 textarea（max 500，内部沟通，不进生图）
 *
 * 终端用户在 /p/[token] 上填（与"尺寸/配件"在创建时由 admin 定死语义互补）。
 * 按 order.productTypeCode 的 capabilities 动态渲染：
 * - 没 productTypeCode 或所有 capability 都是 false（ToC 订单 / 冰箱贴） → 不渲染
 * - 任一 capability=true → 渲染对应块（即使 canEngrave=false 但能选皮革色也算）
 *
 * 编辑模式：仅 PENDING 阶段可改（GENERATING 后已交给上游生图，刻什么
 * 字都来不及，强行改会和服务端生成内容不一致）。非 PENDING 阶段退化为
 * 只读 summary（"已定制"区，展示在 UploadStep 上方）。
 *
 * 历史：
 * - 2026-09-07 初版还有皮革徽章开关挂在 R 钥匙扣上。同日下午重构：皮革徽章作为
 *   独立产品型号 LB 进入 catalog，hasLeatherBadge capability + schema 列全删。
 * - 2026-09-10 加皮革徽章扩展字段；4 个新 capability 沿用"能力门控 + 静默 collapse"模式。
 */

import { Pencil, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import {
  formatCustomization,
  getProductType,
  LEATHER_COLORS,
  PLATFORMS,
  type PlatformCode,
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
    leatherColor: string | null;
    leatherExposed: boolean | null;
    pvcProtection: boolean | null;
    remarks: string | null;
    /** 2026-09-11：订单来源平台（PLATFORMS 字典 code，null = 用户未选） */
    platform: PlatformCode | null;
    /** 2026-09-11：渠道订单号（与 platform 配对；空/null = 未填） */
    platformOrderNo: string | null;
  }) => Promise<boolean>;
}

export function ProductConfigSection({
  order,
  editable,
  saving,
  onSave,
}: ProductConfigSectionProps) {
  const type = getProductType(order.productTypeCode);
  const caps = type?.capabilities;
  // 任一 capability 开启 → 渲染该段；全 false → 整段不渲染
  const canAnyCustomize =
    caps?.canEngrave ||
    caps?.canLeatherColor ||
    caps?.canPvcProtection ||
    caps?.canLeatherExposed ||
    caps?.canHaveRemarks ||
    caps?.canPlatform ||
    false;

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
  // 2026-09-10：LB 皮革徽章 4 个新字段
  const [leatherColor, setLeatherColor] = useState<string>(
    order.leatherColor ?? ""
  );
  const [leatherExposed, setLeatherExposed] = useState<boolean>(
    order.leatherExposed === true
  );
  const [pvcProtection, setPvcProtection] = useState<boolean>(
    order.pvcProtection === true
  );
  const [remarks, setRemarks] = useState<string>(order.remarks ?? "");
  // 2026-09-11：订单来源平台（PLATFORMS 字典 code；空串 = 未选）
  const [platform, setPlatform] = useState<string>(order.platform ?? "");
  // 2026-09-11：渠道订单号（与 platform 配对；空串 = 未填）
  const [platformOrderNo, setPlatformOrderNo] = useState<string>(
    order.platformOrderNo ?? ""
  );

  // 订单刷新（别人/外部改了字段）→ 同步本地草稿
  useEffect(() => {
    const text = order.engravingText ?? "";
    setEngrave(text.trim().length > 0);
    setEngravingText(text);
    setEngravingExposed(order.engravingExposed === true);
    setLeatherColor(order.leatherColor ?? "");
    setLeatherExposed(order.leatherExposed === true);
    setPvcProtection(order.pvcProtection === true);
    setRemarks(order.remarks ?? "");
    setPlatform(order.platform ?? "");
    setPlatformOrderNo(order.platformOrderNo ?? "");
  }, [
    order.engravingText,
    order.engravingExposed,
    order.leatherColor,
    order.leatherExposed,
    order.pvcProtection,
    order.remarks,
    order.platform,
    order.platformOrderNo,
  ]);

  // 没型号 或 所有 capability 都关 → 不渲染
  if (!type || !canAnyCustomize) return null;

  // 摘要（始终展示，作为用户已选了什么的最权威视图）
  // 备注不在 summary string 里——可能很长，单独行渲染
  const summary = formatCustomization({
    engravingText: order.engravingText,
    engravingExposed: order.engravingExposed,
    leatherColor: order.leatherColor,
    leatherExposed: order.leatherExposed,
    pvcProtection: order.pvcProtection,
    remarks: order.remarks,
    platform: order.platform,
  });
  const trimmedRemarks = order.remarks?.trim() ?? "";
  // 2026-09-11：渠道订单号（已保存的；只读 summary 中单独行展示）
  const trimmedPlatformOrderNo = order.platformOrderNo?.trim() ?? "";

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
        {trimmedRemarks.length > 0 && (
          <div className="mt-2 rounded-md bg-stone-50 px-2.5 py-1.5 text-[11px] text-stone-600 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
            <span className="text-stone-400 mr-1">备注：</span>
            {trimmedRemarks}
          </div>
        )}
        {/* 2026-09-11：渠道订单号（只读 summary 单独一行展示，便于 admin 复盘对账） */}
        {trimmedPlatformOrderNo.length > 0 && (
          <div className="mt-1.5 flex items-baseline gap-2 text-[11px]">
            <span className="text-stone-400">渠道订单号：</span>
            <span className="font-mono text-stone-700">
              {trimmedPlatformOrderNo}
            </span>
          </div>
        )}
      </section>
    );
  }

  // 编辑模式：本地草稿 + 保存按钮
  const dirty =
    (engrave ? engravingText.trim() : "") !==
      (order.engravingText?.trim() ?? "") ||
    engravingExposed !== (order.engravingExposed === true) ||
    leatherColor !== (order.leatherColor ?? "") ||
    leatherExposed !== (order.leatherExposed === true) ||
    pvcProtection !== (order.pvcProtection === true) ||
    remarks !== (order.remarks ?? "") ||
    platform !== (order.platform ?? "") ||
    platformOrderNo !== (order.platformOrderNo ?? "");

  const handleSave = async () => {
    // 草稿 → 入参：刻字关闭时清空文本
    const finalText = engrave ? engravingText.trim() : "";
    // 2026-09-11：业务规则 — 渠道订单号必须配合 platform 一起填；只填订单号不选平台，
    // UI 层 hint 提示但仍允许点保存，由 server 端抛 400 兜底。
    const trimmedPlatformOrderNo = platformOrderNo.trim();
    const finalPlatformOrderNo =
      trimmedPlatformOrderNo.length > 0 ? trimmedPlatformOrderNo : null;
    await onSave({
      engravingText: finalText.length > 0 ? finalText : null,
      engravingExposed: engrave ? engravingExposed : null,
      leatherColor: leatherColor.trim() ? leatherColor : null,
      leatherExposed: leatherExposed,
      pvcProtection: pvcProtection,
      remarks: remarks.trim() ? remarks.trim() : null,
      // 2026-09-11：订单来源平台（PLATFORMS 字典 code；空串 → null）
      platform: platform.trim() ? (platform.trim() as PlatformCode) : null,
      // 2026-09-11：渠道订单号（与 platform 配对；空 → null）
      platformOrderNo: finalPlatformOrderNo,
    });
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
        <Sparkles className="h-3.5 w-3.5" />
        产品定制（PENDING 阶段可改，开始生成后锁定）
      </div>

      {/* ============ 皮革颜色（仅 canLeatherColor=true） ============ */}
      {caps?.canLeatherColor && (
        <div className="rounded-lg border border-stone-100 bg-stone-50/50 px-3 py-2 space-y-2">
          <div className="text-sm font-medium text-stone-800">皮革颜色</div>
          <p className="text-[11px] text-stone-500">
            实物皮革色；按下保存后随订单一起传给代理商
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {LEATHER_COLORS.map((c) => {
              const active = leatherColor === c.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  disabled={saving}
                  onClick={() => setLeatherColor(active ? "" : c.code)}
                  title={c.name}
                  className={`group flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
                    active
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-stone-200 bg-white hover:border-emerald-300"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-5 w-5 rounded-full border ${
                      active ? "ring-2 ring-emerald-500 ring-offset-1" : ""
                    }`}
                    style={{ backgroundColor: c.swatch }}
                  />
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ 皮革外露（仅 canLeatherExposed=true，独立于刻字外露）
            2026-09-11：与「PVC 保护」互斥（二选一）—— 勾选时自动取消另一项。 ============ */}
      {caps?.canLeatherExposed && (
        <div className="rounded-lg border border-stone-100 bg-stone-50/50 px-3 py-2">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-medium text-stone-800">皮革外露</div>
              <p className="text-[11px] text-stone-500 mt-0.5">
                开 = 皮革面外露可见；关 = 内嵌不外露
              </p>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5 accent-emerald-600"
              checked={leatherExposed}
              onChange={(e) => {
                setLeatherExposed(e.target.checked);
                // 互斥：勾皮革外露 → 自动取消 PVC 保护
                if (e.target.checked) setPvcProtection(false);
              }}
              disabled={saving}
            />
          </label>
        </div>
      )}

      {/* ============ PVC 保护（仅 canPvcProtection=true，与皮革外露互斥） ============ */}
      {caps?.canPvcProtection && (
        <div className="rounded-lg border border-stone-100 bg-stone-50/50 px-3 py-2">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-medium text-stone-800">PVC 保护</div>
              <p className="text-[11px] text-stone-500 mt-0.5">
                包一层透明 PVC 膜防刮花
              </p>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5 accent-emerald-600"
              checked={pvcProtection}
              onChange={(e) => {
                setPvcProtection(e.target.checked);
                // 互斥：勾 PVC 保护 → 自动取消皮革外露
                if (e.target.checked) setLeatherExposed(false);
              }}
              disabled={saving}
            />
          </label>
        </div>
      )}

      {/* ============ 刻字（仅 canEngrave=true） ============ */}
      {caps?.canEngrave && (
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
      )}

      {/* ============ 备注（仅 canHaveRemarks=true） ============ */}
      {caps?.canHaveRemarks && (
        <div className="rounded-lg border border-stone-100 bg-stone-50/50 px-3 py-2 space-y-2">
          <div className="text-sm font-medium text-stone-800">备注</div>
          <p className="text-[11px] text-stone-500">
            内部沟通用，不参与生图；最多 500 字符
          </p>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
            placeholder="如：请尽快发货 / 希望礼品包装 / 有 2 张待合并"
            disabled={saving}
            className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 resize-y"
          />
          <p className="text-[10px] text-stone-400 text-right">
            {remarks.length} / 500
          </p>
        </div>
      )}

      {/* ============ 订单来源平台（仅 canPlatform=true）
            2026-09-11：业务侧 ToB 渠道归因 —— 用户告诉代理商从哪个渠道来的。
            顺序按"自营 → 第三方电商 → 内容/网红 → 合作/营销"排列。
            "未选" = 走 unknown 兜底，admin 复盘单独 group by。
            2026-09-11：加「渠道订单号」输入框 —— 选中平台后才出现，
            与 platform 配对用于代理商对账。 ============ */}
      {caps?.canPlatform && (
        <div className="rounded-lg border border-stone-100 bg-stone-50/50 px-3 py-2 space-y-2">
          <div className="text-sm font-medium text-stone-800">订单来源</div>
          <p className="text-[11px] text-stone-500">
            从哪个渠道看到 / 找到我们的？用于活动结算
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PLATFORMS.map((p) => {
              const active = platform === p.code;
              return (
                <button
                  key={p.code}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    // 切换平台时清空旧订单号，避免"换平台但留旧渠道订单号"混淆
                    if (!active) setPlatformOrderNo("");
                    setPlatform(active ? "" : p.code);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-60 ${
                    active
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-stone-200 bg-white hover:border-emerald-300"
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
          {/* 2026-09-11：渠道订单号（max 64）。平台选中后才出现。 */}
          {platform && (
            <div className="pt-1 space-y-1">
              <label className="text-[11px] text-stone-600">
                渠道订单号（可选，用于代理商对账）
              </label>
              <input
                type="text"
                value={platformOrderNo}
                onChange={(e) =>
                  setPlatformOrderNo(e.target.value.slice(0, 64))
                }
                maxLength={64}
                disabled={saving}
                placeholder="如淘宝订单号 / 小红书订单 ID"
                className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
              />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-[11px] text-stone-500 flex-1 min-w-0 truncate">
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
