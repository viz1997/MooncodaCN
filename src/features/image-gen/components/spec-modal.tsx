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
 * 2026-09-12：UI 重设计 v1 —— 改为 3 分组卡片（产品选项 / 定制选项 / 订单信息），
 * 每块独立 card 边框视觉分组。同时移除 engravingExposed 字段（用户反馈
 * 「SpecModal 不需要外露开关」，刻字一律默认内刻；DB 列保留，server action
 * 不传该字段时落 null）。
 *
 * 2026-09-12：UI 重设计 v2 —— 用户反馈「订单信息应该放在弹窗最前面 +
 * 弹窗整体很难看而且不人性」。新版结构：
 *
 *   1. 「订单来源」段 —— platform + 渠道订单号（最前置，原 v1 卡片 3 内容）。
 *   2. 「订单概要」卡 —— 模板预览缩略图 + 模板名 + 产品类型 + 选中分镜
 *      badge + 积分成本 badge，让用户一眼看到在下单什么。
 *   3. 「产品规格」段 —— 尺寸 + 配件（原 v1 卡片 1）。
 *   4. 「定制选项」段 —— 刻字 + 皮革色 + 外露/PVC + 备注（原 v1 卡片 2）。
 *
 * 视觉改造要点：
 *   - 去掉硬边框 card 包裹，改用分隔线 + 间距分组（less rigid）
 *   - 字段块标题用大图标 + 中文标题，让人一眼看懂
 *   - 选项 pill 选中态更明显（border + bg + 阴影 + 加粗）
 *   - 文字输入框更宽更大
 *   - 顶部订单概要用浅紫渐变背景强化"商品卡"感
 *
 * SpecSelection 输出 contract 不变：父组件 handleConfirmSpec 调用点不动。
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  Coins,
  CreditCard,
  Loader2,
  Package,
  Palette,
  Pencil,
  ShoppingBag,
  Sparkles,
  Tag,
} from "lucide-react";
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
     * 2026-09-12：模板成本（demo 下单扣减的积分数）。price=0 时弹"免费下单"徽标。
     */
    price?: number | null;
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
  /**
   * 2026-09-12：用户从宫格里选中的 cell（仅 candidateCount>1 + outputMode=grid 时有值）。
   * 在订单概要上以 badge 形式显示，让用户确认自己下的是哪一张。
   */
  selectedCell?: number | null;
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
  selectedCell,
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
      <DialogContent className="max-w-lg sm:max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* 2026-09-12 v2：极简 header —— 标题 + 副标题，去掉冗余 description */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/60 bg-gradient-to-br from-violet-50/40 via-background to-purple-50/30 dark:from-violet-950/20 dark:via-background dark:to-purple-950/10">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
              <ShoppingBag className="h-4 w-4" />
            </div>
            下单信息
          </DialogTitle>
          <DialogDescription className="text-xs">
            填写规格后立即创建订单
          </DialogDescription>
        </DialogHeader>

        <form
          id="spec-modal-form"
          onSubmit={handleConfirm}
          className="flex-1 overflow-y-auto"
        >
          {/* ====== 段 1：订单来源（最前置）—— 用户最关心的"下给谁/哪个渠道"信息 ====== */}
          {canPlatform && productType && (
            <section className="px-6 pt-5 pb-1">
              <SectionTitle icon={<Tag className="h-4 w-4" />} title="订单来源" />
              <p className="text-xs text-muted-foreground -mt-2 mb-3">
                从哪个渠道找到我们？用于代理商活动结算（可不填）
              </p>
              <Controller
                control={form.control}
                name="platform"
                render={({ field, fieldState }) => (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
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
                              "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                              active
                                ? "border-violet-500 bg-violet-500 text-white shadow-sm"
                                : "border-border bg-background hover:border-violet-500/50 hover:bg-violet-500/5"
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
              <div className="mt-3">
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
                      className="text-sm font-mono disabled:opacity-50 h-10"
                      {...field}
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  {platform
                    ? "用于代理商对账；淘宝订单号约 15~18 位数字"
                    : "选中平台后才能填写渠道订单号"}
                </p>
              </div>
            </section>
          )}

          {/* 分隔线：订单来源 → 订单概要 */}
          {canPlatform && productType && template && (
            <hr className="mx-6 border-border/40" />
          )}

          {/* ====== 段 2：「订单概要」卡 —— 让用户一眼看到在下单什么 ====== */}
          {template && (
            <div className="px-6 pt-5 pb-4 border-b border-border/40 bg-gradient-to-br from-violet-50/30 to-purple-50/20 dark:from-violet-950/15 dark:to-purple-950/10">
              <div className="flex gap-3.5">
                {/* 模板预览缩略图 */}
                <div className="relative shrink-0">
                  <div className="h-20 w-20 rounded-xl overflow-hidden border-2 border-violet-500/20 bg-gradient-to-br from-sky-100 to-indigo-100 dark:from-sky-950/40 dark:to-indigo-950/40 shadow-sm">
                    {template.previewUrl ? (
                      // biome-ignore lint/performance/noImgElement: 模板预览图
                      <img
                        src={template.previewUrl}
                        alt={template.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-violet-500 font-bold text-2xl">
                        {template.name.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  {selectedCell !== null && selectedCell !== undefined && (
                    <div className="absolute -bottom-1.5 -right-1.5 h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] font-bold shadow-md ring-2 ring-background">
                      {selectedCell + 1}
                    </div>
                  )}
                </div>

                {/* 模板名 + 产品类型 + 成本 */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="text-sm font-semibold truncate">
                      {template.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {productType?.name ?? "通用款式"}
                      {selectedCell !== null && selectedCell !== undefined && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                          · 已选第 {selectedCell + 1} 格
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    {(() => {
                      const price = template.price ?? 0;
                      if (price > 0) {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] font-semibold border border-amber-500/20">
                            <Coins className="h-3 w-3" />
                            将扣减 {price} 积分
                          </span>
                        );
                      }
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold border border-emerald-500/20">
                          <CheckCircle2 className="h-3 w-3" />
                          免费下单
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 无 productTypeCode（老 ToC 模板）→ 提示「无需选规格」 */}
          {!productType && (
            <div className="mx-6 mt-5 rounded-lg border border-dashed border-border/80 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              此模板为通用款式，无需选择配件规格
            </div>
          )}

          {/* 分隔线：订单概要 → 产品规格 */}
          {template && (hasSize || hasAccessory) && productType && (
            <hr className="mx-6 border-border/40" />
          )}

          {/* ====== 段 3：产品规格 ====== */}
          {(hasSize || hasAccessory) && productType && (
            <section className="px-6 pt-5 pb-1">
              <SectionTitle
                icon={<Package className="h-4 w-4" />}
                title="产品规格"
              />
              <div className="space-y-4">
                {/* 尺寸 */}
                {hasSize && (
                  <Controller
                    control={form.control}
                    name="productSize"
                    render={({ field }) => (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground">
                          尺寸
                        </div>
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
                                  "inline-flex items-center justify-center min-w-[64px] px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all",
                                  active
                                    ? "border-violet-500 bg-violet-500 text-white shadow-md"
                                    : "border-border bg-background hover:border-violet-500/50 hover:bg-violet-500/5"
                                )}
                              >
                                {s} cm
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  />
                )}

                {/* 配件 */}
                {hasAccessory && (
                  <Controller
                    control={form.control}
                    name="accessoryCode"
                    render={({ field }) => (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground">
                          配件
                        </div>
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
                                  "inline-flex items-center px-4 py-2.5 rounded-xl border text-sm font-medium transition-all",
                                  active
                                    ? "border-violet-500 bg-violet-500 text-white shadow-md"
                                    : "border-border bg-background hover:border-violet-500/50 hover:bg-violet-500/5"
                                )}
                              >
                                {acc?.name ?? a}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  />
                )}
              </div>
            </section>
          )}

          {/* 分隔线 */}
          {(hasSize || hasAccessory) &&
            productType &&
            (canEngrave ||
              canLeatherColor ||
              canLeatherExposed ||
              canPvcProtection ||
              canHaveRemarks) && <hr className="mx-6 border-border/40" />}

          {/* ====== 段 4：定制选项 ====== */}
          {(canEngrave ||
            canLeatherColor ||
            canLeatherExposed ||
            canPvcProtection ||
            canHaveRemarks) &&
            productType && (
              <section className="px-6 pt-5 pb-5">
                <SectionTitle
                  icon={<Sparkles className="h-4 w-4" />}
                  title="定制选项"
                />
                <div className="space-y-4">
                  {/* 刻字 */}
                  {canEngrave && (
                    <Controller
                      control={form.control}
                      name="engravingText"
                      render={({ field, fieldState }) => (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                              <Pencil className="h-3.5 w-3.5" />
                              刻字（可选）
                            </Label>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {field.value.length} / 40
                            </span>
                          </div>
                          <Input
                            type="text"
                            placeholder="如：Love U / 2026.09.09 / 宝贝 1 岁"
                            className="text-sm h-10"
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
                          <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                            <Palette className="h-3.5 w-3.5" />
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
                                    "inline-flex items-center gap-2 rounded-full border pl-1 pr-3 py-1.5 text-xs font-medium transition-all",
                                    active
                                      ? "border-violet-500 bg-violet-500 text-white shadow-md"
                                      : "border-border bg-background hover:border-violet-500/50 hover:bg-violet-500/5"
                                  )}
                                  title={c.name}
                                >
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "h-4 w-4 rounded-full border-2",
                                      active ? "border-white" : "border-border"
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
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">
                        表面处理（可选，二选一）
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {canLeatherExposed && (
                          <Controller
                            control={form.control}
                            name="leatherExposed"
                            render={({ field }) => (
                              <label
                                className={cn(
                                  "flex items-start gap-3 cursor-pointer rounded-xl border p-3.5 transition-all",
                                  field.value
                                    ? "border-violet-500 bg-violet-500 text-white shadow-md"
                                    : "border-border bg-background hover:border-violet-500/50 hover:bg-violet-500/5"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className={cn(
                                    "mt-0.5 h-4 w-4",
                                    field.value
                                      ? "accent-white"
                                      : "accent-violet-600"
                                  )}
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
                                  <div
                                    className={cn(
                                      "text-sm font-semibold leading-tight",
                                      !field.value && "text-foreground"
                                    )}
                                  >
                                    皮革外露
                                  </div>
                                  <p
                                    className={cn(
                                      "text-xs mt-1 leading-snug",
                                      field.value
                                        ? "text-white/85"
                                        : "text-muted-foreground"
                                    )}
                                  >
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
                              <label
                                className={cn(
                                  "flex items-start gap-3 cursor-pointer rounded-xl border p-3.5 transition-all",
                                  field.value
                                    ? "border-violet-500 bg-violet-500 text-white shadow-md"
                                    : "border-border bg-background hover:border-violet-500/50 hover:bg-violet-500/5"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className={cn(
                                    "mt-0.5 h-4 w-4",
                                    field.value
                                      ? "accent-white"
                                      : "accent-violet-600"
                                  )}
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
                                  <div
                                    className={cn(
                                      "text-sm font-semibold leading-tight",
                                      !field.value && "text-foreground"
                                    )}
                                  >
                                    PVC 保护
                                  </div>
                                  <p
                                    className={cn(
                                      "text-xs mt-1 leading-snug",
                                      field.value
                                        ? "text-white/85"
                                        : "text-muted-foreground"
                                    )}
                                  >
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
                    </div>
                  )}

                  {/* 备注 */}
                  {canHaveRemarks && (
                    <Controller
                      control={form.control}
                      name="remarks"
                      render={({ field }) => (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold text-muted-foreground">
                              备注（可选）
                            </Label>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {field.value.length} / 500
                            </span>
                          </div>
                          <textarea
                            rows={3}
                            placeholder="如：请尽快发货 / 希望礼品包装"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-y"
                            maxLength={500}
                            {...field}
                          />
                        </div>
                      )}
                    />
                  )}
                </div>
              </section>
            )}
        </form>

        {/* 2026-09-12 v2：footer 加大字号 + 视觉强化主操作 */}
        <DialogFooter className="px-6 py-4 border-t border-border/60 bg-muted/20 gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="h-11 px-5"
          >
            取消
          </Button>
          <Button
            type="submit"
            form="spec-modal-form"
            disabled={submitting || !form.formState.isValid}
            className="h-11 px-6 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 font-semibold shadow-lg shadow-violet-500/20"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <CreditCard className="h-4 w-4 mr-1.5" />
                确认下单
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 2026-09-12 v2：内部 SectionTitle —— 段标题统一格式：图标方块 + 标题文字。
 * 减少 rigid 的 card 包裹，改用「分隔线 + 段标题」分组（less rigid）。
 */
function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-6 w-6 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
  );
}
