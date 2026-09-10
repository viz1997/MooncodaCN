"use client";

/**
 * SpecModal —— /image-gen demo 流「选择此效果下单」规格选择弹窗
 *
 * 2026-09-09：用户点结果卡上「选择此效果下单」触发。按模板绑定的 productTypeCode
 * 动态渲染 productSize / accessoryCode / 可选 engraving 字段。
 *
 * 字段规则：
 * - productTypeCode=null（老 ToC 模板） → 不应打开此 modal（UI 在父层直接走免规格分支）
 * - 有 productTypeCode 但 sizes 为空 → 不渲染 size 选择
 * - 有 productTypeCode 但 accessories 为空 → 不渲染 accessory 选择
 * - canEngrave=true → 渲染 engravingText + 外露 checkbox
 *
 * 默认值：catalog 第一项；engraving 留空。
 *
 * 与 /p/[token] 上 ProductConfigSection 的区别：
 * - ProductConfigSection 是「修改已有订单的 engraving」（PENDING 阶段可改）
 * - SpecModal 是「创建订单时选 spec」（一次性，createOrder 时锁定）
 */

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

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
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
import { cn } from "@/lib/utils";

export interface SpecSelection {
  productSize: string | null;
  accessoryCode: string | null;
  engravingText: string | null;
  engravingExposed: boolean | null;
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
  const availableSizes =
    productType?.sizes?.filter((s) =>
      allowedSizeSet ? allowedSizeSet.has(s) : true
    ) ?? [];
  const availableAccessories =
    productType?.accessories?.filter((a) =>
      allowedAccessorySet ? allowedAccessorySet.has(a) : true
    ) ?? [];
  const hasSize = availableSizes.length > 0;
  const hasAccessory = availableAccessories.length > 0;
  const canEngrave = productType?.capabilities.canEngrave ?? false;

  // 字段本地态
  const [productSize, setProductSize] = useState<string>("");
  const [accessoryCode, setAccessoryCode] = useState<string>("");
  const [engravingText, setEngravingText] = useState<string>("");
  const [engravingExposed, setEngravingExposed] = useState<boolean>(false);

  // 打开时按可用规格 defaults 重置（受 allowed 子集过滤）
  useEffect(() => {
    if (!open) return;
    setProductSize(availableSizes[0] ?? "");
    setAccessoryCode(availableAccessories[0] ?? "");
    setEngravingText("");
    setEngravingExposed(false);
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
    onConfirm({
      productSize: productSize || null,
      accessoryCode: accessoryCode || null,
      engravingText: engravingText.trim() || null,
      engravingExposed: engravingText.trim() ? engravingExposed : null,
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
