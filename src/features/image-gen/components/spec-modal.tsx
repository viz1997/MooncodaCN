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
 * 2026-09-11：订单来源平台（PLATFORMS 字典）+ 渠道订单号（与 platform 配对）。
 *
 * 2026-09-12：全量重设计 —— 从 10 个 useState + useEffect reset 模式迁移到
 * react-hook-form + zodResolver。根因：父组件 `clearPoll` / `pollTask` 内联函数
 * 引用每 render 新建 → useEffect `[clearPoll]` 每 render 跑 cleanup+resubscribe
 * → SpecModal 内部 useEffect reset 被 re-render storm 误触，字段点完就重置。
 *
 * 2026-09-12：UI 重设计 —— 改为 3 分组卡片（产品选项 / 定制选项 / 订单信息），
 * 每块独立 card 边框视觉分组。同时移除 engravingExposed 字段（用户反馈
 * 「SpecModal 不需要外露开关」，刻字一律默认内刻；DB 列保留，server action
 * 不传该字段时落 null）。
 *
 * RHF 优势：
 * - 字段态在 ref 中，外部 React re-render 不重挂载 field DOM
 * - 跨字段校验（订单号必须有 platform / 皮革外露 ⇄ PVC 互斥）由 zod `.refine` 产出
 * - `form.watch()` 替代 useState 控制条件渲染
 *
 * SpecSelection 输出 contract：
 * - 不再包含 engravingExposed（与 submit-image-gen-demo server 端对齐 → 默认 null）
 * - 其余 9 个字段不变；父组件 handleConfirmSpec 调用点不动
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";

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

import { type SpecModalFormValues, specModalSchema } from "./spec-modal-schema";

export interface SpecSelection {
  productSize: string | null;
  accessoryCode: string | null;
  engravingText: string | null;
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

/** 空表单 defaults —— modal 打开时按 template 算出来的 size/accessory 默认项会覆盖这两个字段 */
const EMPTY_DEFAULTS: SpecModalFormValues = {
  productSize: "",
  accessoryCode: "",
  engravingText: "",
  leatherColor: "",
  leatherExposed: false,
  pvcProtection: false,
  remarks: "",
  platform: "",
  platformOrderNo: "",
};

export function SpecModal({
  open,
  template,
  submitting,
  onClose,
  onConfirm,
}: SpecModalProps) {
  const productType = getProductType(template?.productTypeCode);

  // 派生数组全部 useMemo 锁引用，避免父组件 re-render 造成 useEffect 误触发
  const allowedSizeSet = useMemo(
    () =>
      template?.allowedSizes && template.allowedSizes.length > 0
        ? new Set(template.allowedSizes)
        : null,
    [template?.allowedSizes]
  );
  const allowedAccessorySet = useMemo(
    () =>
      template?.allowedAccessories && template.allowedAccessories.length > 0
        ? new Set(template.allowedAccessories)
        : null,
    [template?.allowedAccessories]
  );
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
  const effectiveLeatherColors = useMemo(
    () => getEffectiveLeatherColors(template?.allowedColors),
    [template?.allowedColors]
  );

  const hasSize = availableSizes.length > 0;
  const hasAccessory = availableAccessories.length > 0;

  // capability：catalog 默认 ∪ 模板级覆盖（canEngrave 不参与覆盖）
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
  const canPlatform = caps?.canPlatform ?? false;

  // ===== RHF =====

  // defaults：按模板允许子集算出 size/accessory 默认项，其余字段不重置（用空值）
  // 2026-09-12：直接喂 useForm defaultValues —— Dialog 关→开 时 children unmount/remount
  // → RHF 在 mount 时读 defaultValues 重新初始化；不需要 useEffect reset，
  // 也就不需要 [open] deps 触发的 biome 警告 + lint suppressions。
  const formDefaults = useMemo<SpecModalFormValues>(
    () => ({
      ...EMPTY_DEFAULTS,
      productSize: availableSizes[0] ?? "",
      accessoryCode: availableAccessories[0] ?? "",
    }),
    [availableSizes, availableAccessories]
  );

  const form = useForm<SpecModalFormValues>({
    resolver: zodResolver(specModalSchema),
    defaultValues: formDefaults,
    mode: "onChange",
  });

  // 条件渲染 watch（仅订单号 disabled 需要 platform 状态）
  const platform = form.watch("platform");

  const handleConfirm = form.handleSubmit((raw) => {
    if (!template) return;
    try {
      validateProductSpec(
        template.productTypeCode,
        raw.productSize || null,
        raw.accessoryCode || null
      );
    } catch {
      // 客户端兜底校验失败 —— zodResolver 已 catch cross-field，UI 不应让用户走到这里
      return;
    }
    // 字典外 code 防御（zod 已 catch，正常不会走到 catch）
    let platformCode: PlatformCode | null = null;
    if (raw.platform) {
      try {
        validatePlatform(raw.platform);
        platformCode = raw.platform as PlatformCode;
      } catch {
        platformCode = null;
      }
    }
    const trimmedEngraving = raw.engravingText.trim();
    const trimmedPlatformOrderNo = raw.platformOrderNo.trim();
    onConfirm({
      productSize: raw.productSize || null,
      accessoryCode: raw.accessoryCode || null,
      engravingText: trimmedEngraving || null,
      leatherColor: raw.leatherColor || null,
      leatherExposed: raw.leatherExposed,
      pvcProtection: raw.pvcProtection,
      remarks: raw.remarks.trim() || null,
      platform: platformCode,
      platformOrderNo:
        trimmedPlatformOrderNo.length > 0 ? trimmedPlatformOrderNo : null,
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md sm:max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            选择配件规格
          </DialogTitle>
          <DialogDescription>
            {template?.name}
            {productType ? ` · ${productType.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form
          id="spec-modal-form"
          onSubmit={handleConfirm}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
        >
          {/* 无 productTypeCode（老 ToC 模板）→ 提示「无需选规格」 */}
          {!productType && (
            <div className="rounded-lg border border-dashed border-border/80 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              此模板为通用款式，无需选择配件规格
            </div>
          )}

          {/* ====== 卡片 1：产品选项 ====== */}
          {(hasSize || hasAccessory) && (
            <section className="rounded-lg border border-border/70 bg-card overflow-hidden">
              <header className="px-4 py-2.5 bg-muted/40 border-b border-border/60 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-600 dark:text-violet-300">
                  1
                </span>
                <h3 className="text-sm font-semibold">产品选项</h3>
              </header>
              <div className="p-4 space-y-4">
                {/* 尺寸 */}
                {hasSize && productType && (
                  <Controller
                    control={form.control}
                    name="productSize"
                    render={({ field }) => (
                      <fieldset className="space-y-2">
                        <legend className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          尺寸
                        </legend>
                        <div className="flex flex-wrap gap-2">
                          {availableSizes.map((s) => {
                            const active = field.value === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                aria-pressed={active}
                                onClick={() => field.onChange(s)}
                                className={cn(
                                  "inline-flex items-center px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-all",
                                  active
                                    ? "border-violet-500 bg-violet-50 text-violet-700 shadow-sm dark:bg-violet-950/40 dark:text-violet-300"
                                    : "border-border hover:border-violet-500/50"
                                )}
                              >
                                {s} cm
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                    )}
                  />
                )}

                {/* 配件 */}
                {hasAccessory && productType && (
                  <Controller
                    control={form.control}
                    name="accessoryCode"
                    render={({ field }) => (
                      <fieldset className="space-y-2">
                        <legend className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          配件
                        </legend>
                        <div className="flex flex-wrap gap-2">
                          {availableAccessories.map((a) => {
                            const acc = ACCESSORIES.find((x) => x.code === a);
                            const active = field.value === a;
                            return (
                              <button
                                key={a}
                                type="button"
                                aria-pressed={active}
                                onClick={() => field.onChange(a)}
                                className={cn(
                                  "inline-flex items-center px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-all",
                                  active
                                    ? "border-violet-500 bg-violet-50 text-violet-700 shadow-sm dark:bg-violet-950/40 dark:text-violet-300"
                                    : "border-border hover:border-violet-500/50"
                                )}
                              >
                                {acc?.name ?? a}
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                    )}
                  />
                )}
              </div>
            </section>
          )}

          {/* ====== 卡片 2：定制选项 ====== */}
          {(canEngrave ||
            canLeatherColor ||
            canLeatherExposed ||
            canPvcProtection ||
            canHaveRemarks) && (
            <section className="rounded-lg border border-border/70 bg-card overflow-hidden">
              <header className="px-4 py-2.5 bg-muted/40 border-b border-border/60 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-600 dark:text-violet-300">
                  2
                </span>
                <h3 className="text-sm font-semibold">定制选项</h3>
              </header>
              <div className="p-4 space-y-4">
                {/* 刻字 */}
                {canEngrave && (
                  <Controller
                    control={form.control}
                    name="engravingText"
                    render={({ field, fieldState }) => (
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          刻字（可选）
                        </Label>
                        <Input
                          type="text"
                          placeholder="如：Love U / 2026.09.09 / 宝贝 1 岁"
                          className="text-sm"
                          maxLength={40}
                          {...field}
                        />
                        <p className="text-xs text-muted-foreground">
                          最多 40 个字符（中文 / 英文 / 数字 / 空格）；默认内刻
                        </p>
                        {fieldState.error?.message && (
                          <p className="text-xs text-rose-600">
                            {fieldState.error.message}
                          </p>
                        )}
                      </div>
                    )}
                  />
                )}

                {/* 皮革颜色色卡 */}
                {canLeatherColor && (
                  <Controller
                    control={form.control}
                    name="leatherColor"
                    render={({ field }) => (
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          皮革颜色
                        </Label>
                        <div className="flex flex-wrap gap-2">
                          {effectiveLeatherColors.map((c) => {
                            const active = field.value === c.code;
                            return (
                              <button
                                key={c.code}
                                type="button"
                                aria-pressed={active}
                                onClick={() =>
                                  field.onChange(active ? "" : c.code)
                                }
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 text-xs font-medium transition-colors",
                                  active
                                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                                    : "border-border hover:border-violet-500/50"
                                )}
                                title={c.name}
                              >
                                <span
                                  aria-hidden
                                  className={cn(
                                    "h-4 w-4 rounded-full border",
                                    active &&
                                      "ring-2 ring-violet-500 ring-offset-1"
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
                  />
                )}

                {/* 皮革外露 / PVC 保护（互斥，二选一并排成 2 列） */}
                {(canLeatherExposed || canPvcProtection) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {canLeatherExposed && (
                      <Controller
                        control={form.control}
                        name="leatherExposed"
                        render={({ field }) => (
                          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border/70 p-3 hover:border-violet-500/40 transition-colors">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 accent-violet-600"
                              checked={field.value}
                              onChange={(e) => {
                                field.onChange(e.target.checked);
                                if (e.target.checked)
                                  form.setValue("pvcProtection", false, {
                                    shouldValidate: false,
                                  });
                              }}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium leading-tight">
                                皮革外露
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                                开 = 皮革面外露可见
                              </p>
                            </div>
                          </label>
                        )}
                      />
                    )}
                    {canPvcProtection && (
                      <Controller
                        control={form.control}
                        name="pvcProtection"
                        render={({ field, fieldState }) => (
                          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border/70 p-3 hover:border-violet-500/40 transition-colors">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 accent-violet-600"
                              checked={field.value}
                              onChange={(e) => {
                                field.onChange(e.target.checked);
                                if (e.target.checked)
                                  form.setValue("leatherExposed", false, {
                                    shouldValidate: false,
                                  });
                              }}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium leading-tight">
                                PVC 保护
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                                包一层透明 PVC 膜防刮花
                              </p>
                            </div>
                            {fieldState.error?.message && (
                              <p className="text-xs text-rose-600 mt-1 col-span-2">
                                {fieldState.error.message}
                              </p>
                            )}
                          </label>
                        )}
                      />
                    )}
                  </div>
                )}

                {/* 备注 */}
                {canHaveRemarks && (
                  <Controller
                    control={form.control}
                    name="remarks"
                    render={({ field }) => (
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          备注（可选）
                        </Label>
                        <textarea
                          rows={3}
                          placeholder="如：请尽快发货 / 希望礼品包装"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-y"
                          maxLength={500}
                          {...field}
                        />
                        <p className="text-xs text-muted-foreground text-right tabular-nums">
                          {field.value.length} / 500
                        </p>
                      </div>
                    )}
                  />
                )}
              </div>
            </section>
          )}

          {/* ====== 卡片 3：订单信息 ====== */}
          {canPlatform && (
            <section className="rounded-lg border border-border/70 bg-card overflow-hidden">
              <header className="px-4 py-2.5 bg-muted/40 border-b border-border/60 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-600 dark:text-violet-300">
                  3
                </span>
                <h3 className="text-sm font-semibold">订单信息</h3>
              </header>
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    订单来源（可选）
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    从哪个渠道找到我们？用于代理商活动结算
                  </p>
                  <Controller
                    control={form.control}
                    name="platform"
                    render={({ field, fieldState }) => (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          {PLATFORMS.map((p) => {
                            const active = field.value === p.code;
                            return (
                              <button
                                key={p.code}
                                type="button"
                                aria-pressed={active}
                                onClick={() => {
                                  // 切换平台时清空旧订单号，避免"换平台但留旧渠道订单号"混淆
                                  if (!active)
                                    form.setValue("platformOrderNo", "", {
                                      shouldValidate: false,
                                    });
                                  field.onChange(active ? "" : p.code);
                                }}
                                className={cn(
                                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                  active
                                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                                    : "border-border hover:border-violet-500/50"
                                )}
                              >
                                {p.name}
                              </button>
                            );
                          })}
                        </div>
                        {fieldState.error?.message && (
                          <p className="text-xs text-rose-600">
                            {fieldState.error.message}
                          </p>
                        )}
                      </div>
                    )}
                  />
                </div>

                {/* 渠道订单号：始终显示，未选平台时 disabled；视觉分隔与平台 pills 区分 */}
                <div className="space-y-1.5 pt-2 border-t border-dashed border-border/60">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    渠道订单号（可选）
                  </Label>
                  <Controller
                    control={form.control}
                    name="platformOrderNo"
                    render={({ field }) => (
                      <Input
                        type="text"
                        placeholder={
                          platform
                            ? "如淘宝订单号 / 小红书订单 ID"
                            : "请先在上方选择订单来源平台"
                        }
                        disabled={!platform}
                        maxLength={64}
                        className="text-sm font-mono disabled:opacity-60"
                        {...field}
                      />
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    {platform
                      ? "用于代理商对账；淘宝订单号约 15~18 位数字"
                      : "选中平台后才能填写渠道订单号"}
                  </p>
                </div>
              </div>
            </section>
          )}
        </form>

        <DialogFooter className="px-5 py-3 border-t border-border/60 bg-muted/30 gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="submit"
            form="spec-modal-form"
            disabled={submitting || !form.formState.isValid}
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
