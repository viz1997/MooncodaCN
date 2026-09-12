"use client";

/**
 * SpecModal —— /image-gen demo 流「选择此效果下单」规格选择弹窗
 *
 * 2026-09-09：用户点结果卡上「选择此效果下单」触发。按模板绑定的 productTypeCode
 * 动态渲染 productSize / accessoryCode / 可选 engraving 字段。
 *
 * 2026-09-10：LB 皮革徽章扩 4 字段（皮革色 / 皮革外露 / PVC 保护 / 备注）。
 * capability-gated：capabilities.canLeatherColor 等 4 flag 决定 UI 块是否渲染。
 *
 * 字段规则：
 * - productTypeCode=null（老 ToC 模板） → 不应打开此 modal（UI 在父层直接走免规格分支）
 * - 有 productTypeCode 但 sizes 为空 → 不渲染 size 选择
 * - 有 productTypeCode 但 accessories 为空 → 不渲染 accessory 选择
 * - canEngrave=true → 渲染 engravingText + 外露 checkbox
 * - canLeatherColor=true → 渲染皮革色色卡（仅 LB）
 * - canLeatherExposed=true → 皮革外露 checkbox（仅 LB；与 engravingExposed 解耦）
 * - canPvcProtection=true → PVC 保护 checkbox（仅 LB）
 * - canHaveRemarks=true → 备注 textarea（仅 LB）
 *
 * 默认值：catalog 第一项；engraving 留空；皮革色默认不选（空）。
 *
 * 与 /p/[token] 上 ProductConfigSection 的区别：
 * - ProductConfigSection 是「修改已有订单的 engraving」（PENDING 阶段可改）
 * - SpecModal 是「创建订单时选 spec」（一次性，createOrder 时锁定）
 */

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACCESSORIES,
  getProductType,
  PLATFORMS,
  type PlatformCode,
  type ProductCapabilities,
  validatePlatform,
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
import {
  getEffectiveCapabilities,
  getEffectiveLeatherColors,
} from "@/features/image-gen/lib/product-effect-capabilities";
import { cn } from "@/lib/utils";

export interface SpecSelection {
  productSize: string | null;
  accessoryCode: string | null;
  engravingText: string | null;
  engravingExposed: boolean | null;
  // 2026-09-10：LB 皮革徽章扩展字段
  leatherColor: string | null;
  leatherExposed: boolean | null;
  pvcProtection: boolean | null;
  remarks: string | null;
  /** 2026-09-11：订单来源平台（PLATFORMS 字典 code；null = 未选） */
  platform: PlatformCode | null;
  /**
   * 2026-09-11：渠道订单号（与 platform 配对；异构字符串 free text）。
   * 仅在 platform 选中的时候才会被收集；空串视为未填 → null。
   */
  platformOrderNo: string | null;
}

interface SpecModalProps {
  open: boolean;
  template: {
    maskId: string;
    name: string;
    previewUrl: string;
    productTypeCode: string | null;
    /**
     * 2026-09-10：模板级可配置尺寸子集（覆盖字典默认）。
     * null/空 → 用字典全量；非空 → 仅这些。
     */
    allowedSizes?: string[] | null;
    /**
     * 2026-09-10：模板级可配置配件子集。
     */
    allowedAccessories?: string[] | null;
    /**
     * 2026-09-10：模板级 capability 覆盖。null/undefined = 继承 catalog 默认。
     * 仅在创建时生效；/p/[token] 路径不读此覆盖（catalog 默认）。
     */
    allowedCapabilities?: Partial<ProductCapabilities> | null;
    /**
     * 2026-09-10：皮革颜色子集。null/空 = LEATHER_COLORS 全展示。
     */
    allowedColors?: string[] | null;
  } | null;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (spec: SpecSelection) => void;
}

export function SpecModal({
  open,
  template,
  submitting,
  onClose,
  onConfirm,
}: SpecModalProps) {
  const productType = getProductType(template?.productTypeCode);
  // 2026-09-10：模板允许的尺寸 / 配件子集（与字典全集求交集，过滤非法残留）。
  // null/空数组 → 用字典全量；否则只渲染勾选出的子集。
  const allowedSizeSet =
    template?.allowedSizes && template.allowedSizes.length > 0
      ? new Set(template.allowedSizes)
      : null;
  const allowedAccessorySet =
    template?.allowedAccessories && template.allowedAccessories.length > 0
      ? new Set(template.allowedAccessories)
      : null;
  // 2026-09-12：useMemo 锁住数组引用——下方 useEffect 依赖 availableSizes/availableAccessories/effectiveLeatherColors；
  // 不 memoize 时每次父组件重渲染都生成新数组引用，触发 effect 重置 SpecModal 全部本地 state（用户反馈「点了 6cm 仍 4cm 高亮」）
  const availableSizes = useMemo(
    () =>
      productType?.sizes?.filter((s) =>
        allowedSizeSet ? allowedSizeSet.has(s) : true
      ) ?? [],
    [productType, allowedSizeSet]
  );
  const availableAccessories = useMemo(
    () =>
      productType?.accessories?.filter((a) =>
        allowedAccessorySet ? allowedAccessorySet.has(a) : true
      ) ?? [],
    [productType, allowedAccessorySet]
  );
  const hasSize = availableSizes.length > 0;
  const hasAccessory = availableAccessories.length > 0;
  // 2026-09-10：effective capability = catalog 默认 ∪ 模板级覆盖
  // canEngrave 不参与覆盖，沿用 catalog 默认
  const effectiveCaps = getEffectiveCapabilities(
    template?.productTypeCode,
    template?.allowedCapabilities
  );
  const caps = effectiveCaps ?? productType?.capabilities;
  const canEngrave = caps?.canEngrave ?? false;
  const canLeatherColor = caps?.canLeatherColor ?? false;
  const canLeatherExposed = caps?.canLeatherExposed ?? false;
  const canPvcProtection = caps?.canPvcProtection ?? false;
  const canHaveRemarks = caps?.canHaveRemarks ?? false;
  // 2026-09-11：订单来源平台（仅 LB 皮革徽章）
  const canPlatform = caps?.canPlatform ?? false;
  // 2026-09-10：皮革色按 allowedColors 子集过滤
  const effectiveLeatherColors = useMemo(
    () => getEffectiveLeatherColors(template?.allowedColors),
    [template?.allowedColors]
  );

  // 字段本地态
  const [productSize, setProductSize] = useState<string>("");
  const [accessoryCode, setAccessoryCode] = useState<string>("");
  const [engravingText, setEngravingText] = useState<string>("");
  const [engravingExposed, setEngravingExposed] = useState<boolean>(false);
  // 2026-09-10：LB 皮革徽章 4 个新字段
  const [leatherColor, setLeatherColor] = useState<string>("");
  const [leatherExposed, setLeatherExposed] = useState<boolean>(false);
  const [pvcProtection, setPvcProtection] = useState<boolean>(false);
  const [remarks, setRemarks] = useState<string>("");
  // 2026-09-11：订单来源平台
  const [platform, setPlatform] = useState<string>("");
  // 2026-09-11：渠道订单号（与 platform 配对；仅 platform 选中时才允许填写）
  const [platformOrderNo, setPlatformOrderNo] = useState<string>("");

  // 打开时按可用规格 defaults 重置（受 allowed 子集过滤）
  useEffect(() => {
    if (!open) return;
    setProductSize(availableSizes[0] ?? "");
    setAccessoryCode(availableAccessories[0] ?? "");
    setEngravingText("");
    setEngravingExposed(false);
    setLeatherColor("");
    setLeatherExposed(false);
    setPvcProtection(false);
    setRemarks("");
    setPlatform("");
    setPlatformOrderNo("");
    // availableSizes/availableAccessories 依赖 template.allowed*；同步开 modal 时一并刷新
  }, [open, availableSizes, availableAccessories]);

  const handleConfirm = () => {
    if (!template) return;
    try {
      validateProductSpec(
        template.productTypeCode,
        productSize || null,
        accessoryCode || null
      );
    } catch (_err) {
      // 客户端兜底校验失败 —— 理论上 UI 已禁用非法组合
      return;
    }
    const trimmedEngraving = engravingText.trim();
    // 2026-09-11：校验 platform code 在 PLATFORMS 字典里；空串视为未选。
    let platformCode: PlatformCode | null = null;
    if (platform) {
      try {
        validatePlatform(platform);
        platformCode = platform as PlatformCode;
      } catch {
        platformCode = null;
      }
    }
    // 2026-09-11：渠道订单号 trim；空 = null。
    const trimmedPlatformOrderNo = platformOrderNo.trim();
    const finalPlatformOrderNo =
      trimmedPlatformOrderNo.length > 0 ? trimmedPlatformOrderNo : null;
    onConfirm({
      productSize: productSize || null,
      accessoryCode: accessoryCode || null,
      engravingText: trimmedEngraving || null,
      engravingExposed: trimmedEngraving ? engravingExposed : null,
      // 2026-09-10：LB 扩字段透传。空字符串视为不选（与 createOrder 联动 null 对齐）
      leatherColor: leatherColor || null,
      leatherExposed: leatherExposed,
      pvcProtection: pvcProtection,
      remarks: remarks.trim() || null,
      // 2026-09-11：订单来源平台（字典 code；空 = null）
      platform: platformCode,
      // 2026-09-11：渠道订单号（与 platform 配对）
      platformOrderNo: finalPlatformOrderNo,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            选择配件规格
          </DialogTitle>
          <DialogDescription>
            {template?.name}
            {productType ? ` · ${productType.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* 尺寸（按 availableSizes，受 allowedSizes 子集过滤） */}
          {hasSize && productType && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">尺寸</Label>
              <div className="flex flex-wrap gap-2">
                {availableSizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setProductSize(s)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-all",
                      productSize === s
                        ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                        : "border-muted-foreground/20 hover:border-violet-500/50"
                    )}
                  >
                    {s} cm
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 配件（按 availableAccessories，受 allowedAccessories 子集过滤） */}
          {hasAccessory && productType && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">配件</Label>
              <div className="flex flex-wrap gap-2">
                {availableAccessories.map((a) => {
                  const acc = ACCESSORIES.find((x) => x.code === a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAccessoryCode(a)}
                      className={cn(
                        "px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-all",
                        accessoryCode === a
                          ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                          : "border-muted-foreground/20 hover:border-violet-500/50"
                      )}
                    >
                      {acc?.name ?? a}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 刻字 */}
          {canEngrave && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">刻字（可选）</Label>
              <Input
                type="text"
                value={engravingText}
                onChange={(e) => setEngravingText(e.target.value.slice(0, 40))}
                maxLength={40}
                placeholder="如：Love U / 2026.09.09 / 宝贝 1 岁"
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                最多 40 个字符（中文 / 英文 / 数字 / 空格）
              </p>
              {engravingText.trim().length > 0 && (
                <label className="flex items-center justify-between gap-3 cursor-pointer pt-1">
                  <div>
                    <div className="text-sm font-medium">外露</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      关 = 内刻（默认）。开 = 刻在外表面
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-violet-600"
                    checked={engravingExposed}
                    onChange={(e) => setEngravingExposed(e.target.checked)}
                  />
                </label>
              )}
            </div>
          )}

          {/* 2026-09-10：LB 皮革颜色色卡（capability-gated + 按 allowedColors 子集过滤） */}
          {canLeatherColor && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">皮革颜色</Label>
              <div className="flex flex-wrap gap-2">
                {effectiveLeatherColors.map((c) => {
                  const active = leatherColor === c.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => setLeatherColor(active ? "" : c.code)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                          : "border-muted-foreground/20 hover:border-violet-500/50"
                      )}
                      title={c.name}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "h-4 w-4 rounded-full border",
                          active && "ring-2 ring-violet-500 ring-offset-1"
                        )}
                        style={{ backgroundColor: c.swatch }}
                      />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2026-09-10：皮革外露（独立于刻字外露）。
              2026-09-11：与「PVC 保护」互斥（二选一）—— 勾选时自动取消另一项。 */}
          {canLeatherExposed && (
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-sm font-semibold">皮革外露</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  开 = 皮革面外露可见；关 = 内嵌不外露
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 accent-violet-600"
                checked={leatherExposed}
                onChange={(e) => {
                  setLeatherExposed(e.target.checked);
                  // 互斥：勾皮革外露 → 自动取消 PVC 保护
                  if (e.target.checked) setPvcProtection(false);
                }}
              />
            </label>
          )}

          {/* 2026-09-10：PVC 保护（与皮革外露互斥） */}
          {canPvcProtection && (
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-sm font-semibold">PVC 保护</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  包一层透明 PVC 膜防刮花
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 accent-violet-600"
                checked={pvcProtection}
                onChange={(e) => {
                  setPvcProtection(e.target.checked);
                  // 互斥：勾 PVC 保护 → 自动取消皮革外露
                  if (e.target.checked) setLeatherExposed(false);
                }}
              />
            </label>
          )}

          {/* 2026-09-10：备注（不参与生图） */}
          {canHaveRemarks && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">备注（可选）</Label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                placeholder="如：请尽快发货 / 希望礼品包装"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-y"
              />
              <p className="text-[10px] text-muted-foreground text-right">
                {remarks.length} / 500
              </p>
            </div>
          )}

          {/* 2026-09-11：订单来源平台（仅 LB 皮革徽章业务使用） */}
          {canPlatform && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">订单来源（可选）</Label>
              <p className="text-[11px] text-muted-foreground -mt-1">
                从哪个渠道找到我们？用于代理商活动结算
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.map((p) => {
                  const active = platform === p.code;
                  return (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => {
                        // 切换平台时清空旧订单号，避免"换平台但留旧渠道订单号"混淆
                        if (!active) setPlatformOrderNo("");
                        setPlatform(active ? "" : p.code);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                          : "border-muted-foreground/20 hover:border-violet-500/50"
                      )}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {/* 2026-09-12：渠道订单号始终显示（即使没选平台），未选平台时 disabled，
                  避免用户找输入框找不到。跨平台订单号体系：淘宝 15~18 位数字、
                  小红书字母数字混合、抖音 ID 等，不强制格式校验。
                  server 端兜底校验「有订单号必须有 platform」（见 submit-image-gen-demo）。 */}
              <div className="pt-1 space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  渠道订单号（可选）
                </Label>
                <Input
                  type="text"
                  value={platformOrderNo}
                  onChange={(e) =>
                    setPlatformOrderNo(e.target.value.slice(0, 64))
                  }
                  maxLength={64}
                  disabled={!platform}
                  placeholder={
                    platform
                      ? "如淘宝订单号 / 小红书订单 ID"
                      : "请先在上方选择订单来源平台"
                  }
                  className="text-sm font-mono disabled:opacity-60"
                />
                <p className="text-[10px] text-muted-foreground">
                  {platform
                    ? "用于代理商对账；淘宝订单号约 15~18 位数字"
                    : "选中平台后才能填写渠道订单号"}
                </p>
              </div>
            </div>
          )}

          {/* 无 productTypeCode（老 ToC 模板）→ 提示「无需选规格」 */}
          {!productType && (
            <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              此模板为通用款式，无需选择配件规格
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1.5" />
                确认下单
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
