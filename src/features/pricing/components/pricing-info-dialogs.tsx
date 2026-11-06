"use client";

import { Beaker, Box, Calculator, Info } from "lucide-react";
import { useTranslations } from "next-intl";
/**
 * Mooncoda 3D 打印克重计算器的三个说明弹窗
 * （克重算法 / 产品类型预设 / 材料参数）。
 *
 * 移植自 wjp-source-code/src/app/page.tsx。
 *
 * ## 2026-11-06:材料参数改成**只读**
 *
 * 原来这里有一整套「密码解锁 → 改密度」的 UI(密码走
 * `/api/image-gen/pricing/materials-auth`)。现在密度跟支撑几何**由工作室
 * 在 `/admin/print-pricing` 统一配**,访客改不了:
 *
 *  - 访客改密度 → 支撑克重是假的 → 而服务端报价按自己那份密度算
 *    → 「工具页看到的克重」跟「打印单上的价」对不上
 *  - 密码那一层根本没起到保护作用(不配 `PRICING_MATERIALS_PASSWORD` 就是
 *    全网放开)
 *
 * 所以这条路由整个退役,这里只摆**当前生效值**。
 *
 * 弹窗只讲克重,不展示任何价格(单价 / 光油费 / 支撑费)。
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fmt,
  PRODUCT_ICONS,
  PRODUCT_TYPES,
} from "@/features/pricing/components/shared";

export type InfoDialogKind = "algorithm" | "products" | "materials" | null;

export type PricingInfoDialogsProps = {
  infoDialog: InfoDialogKind;
  onInfoDialogChange: (kind: InfoDialogKind) => void;

  /** 模型材料密度 g/cm³ —— 后台配的,只读 */
  materialDensity: number;
  /**
   * 支撑材料密度 (g/cm³) —— 支撑跟模型**不是**一种材料
   *
   * 水溶性支撑(PVA/BVOH,约 1.13~1.30 g/cm³)跟光敏树脂密度不同:
   * 支撑克重 = 支撑体积 × 支撑密度,总克重 = 耗材克重 + 支撑克重。
   */
  supportDensity: number;
  /** 托底高度 mm —— 后台配的,只读 */
  supportLiftMm: number;
  /** 底板留边 mm —— 后台配的,只读 */
  supportBaseMarginMm: number;

  /** 应用产品预设 */
  onApplyProduct: (productId: string) => void;
};

export function PricingInfoDialogs({
  infoDialog,
  onInfoDialogChange,
  materialDensity,
  supportDensity,
  supportLiftMm,
  supportBaseMarginMm,
  onApplyProduct,
}: PricingInfoDialogsProps) {
  const t = useTranslations("MaterialPricing");

  return (
    <Dialog
      open={infoDialog !== null}
      onOpenChange={(open) => {
        if (!open) onInfoDialogChange(null);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {infoDialog === "algorithm" && (
              <>
                <Calculator className="size-5 text-amber-600" />
                {t("info.algorithm.title")}
              </>
            )}
            {infoDialog === "products" && (
              <>
                <Box className="size-5 text-amber-600" />
                {t("info.products.title")}
              </>
            )}
            {infoDialog === "materials" && (
              <>
                <Beaker className="size-5 text-amber-600" />
                {t("info.materials.title")}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ---- 算法说明 ---- */}
        {infoDialog === "algorithm" && (
          <div className="space-y-4 text-sm text-stone-700">
            <p>{t("info.algorithm.p1")}</p>
            <div className="rounded-md bg-stone-50 border border-stone-200 p-2.5 font-mono text-xs">
              {t("info.algorithm.formula", {
                density: fmt(materialDensity, 2),
              })}
            </div>
            <p className="text-xs text-stone-500">{t("info.algorithm.p2")}</p>
            {/* 口径与边界:内腔算支撑、5mm 托底算支撑、逐列配对是近似、
                页面上的数是取整后相加 —— 别让「全包裹 × 单一密度」的说法
                混进这页。 */}
            <div className="rounded-md border border-stone-200 bg-stone-50/70 p-3">
              <h4 className="text-xs font-semibold text-stone-700 mb-2">
                {t("info.algorithm.boundariesTitle")}
              </h4>
              <ul className="space-y-1.5 list-disc list-inside text-[11px] leading-relaxed text-stone-500">
                {(t.raw("info.algorithm.boundaries") as string[]).map(
                  (item) => (
                    <li key={item}>{item}</li>
                  )
                )}
              </ul>
            </div>
          </div>
        )}

        {/* ---- 产品类型预设 ---- */}
        {infoDialog === "products" && (
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500 uppercase">
                  <th className="py-2 pr-4 font-medium">
                    {t("info.products.colProduct")}
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    {t("info.products.colRatio")}
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    {t("info.products.colDesc")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {PRODUCT_TYPES.map((p) => {
                  const Icon = PRODUCT_ICONS[p.icon];
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-stone-100 last:border-0 cursor-pointer hover:bg-amber-50/40 transition-colors"
                      onClick={() => {
                        onApplyProduct(p.id);
                        onInfoDialogChange(null);
                      }}
                    >
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Icon className="size-4" style={{ color: p.color }} />
                          <span className="font-medium text-stone-800">
                            {t(p.nameKey)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 font-mono text-stone-700">
                        {p.solidRatio}%
                      </td>
                      <td className="py-3 pr-4 text-stone-500 text-xs">
                        {t(p.descKey)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- 材料参数(只读) ---- */}
        {infoDialog === "materials" && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-4 py-2.5 text-xs leading-relaxed text-stone-600">
              <Info className="mt-0.5 size-3.5 shrink-0 text-stone-400" />
              <span>{t("info.materials.readOnly")}</span>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Box className="size-4 text-amber-600" />
                <h4 className="font-semibold text-stone-800">
                  {t("info.materials.density")}
                </h4>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500 shrink-0">
                    {t("info.materials.densityLabel")}
                  </span>
                  <span className="font-mono text-sm text-stone-800">
                    {fmt(materialDensity, 4)} g/cm³
                  </span>
                </div>
                {/* 支撑是另一种材料 —— 密度跟模型分开 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500 shrink-0">
                    {t("info.materials.supportDensityLabel")}
                  </span>
                  <span className="font-mono text-sm text-stone-800">
                    {fmt(supportDensity, 4)} g/cm³
                  </span>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-stone-500">
                {t("info.materials.supportDensityHint")}
              </p>
            </div>

            {/* 支撑几何 —— 跟报价同一口径,改了这儿数值也会跟着变 */}
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Beaker className="size-4 text-stone-500" />
                <h4 className="font-semibold text-stone-800">
                  {t("info.materials.geometry")}
                </h4>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500 shrink-0">
                    {t("info.materials.liftLabel")}
                  </span>
                  <span className="font-mono text-sm text-stone-800">
                    {fmt(supportLiftMm, 2)} mm
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500 shrink-0">
                    {t("info.materials.baseMarginLabel")}
                  </span>
                  <span className="font-mono text-sm text-stone-800">
                    {fmt(supportBaseMarginMm, 2)} mm
                  </span>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-stone-500">
                {t("info.materials.geometryHint")}
              </p>
            </div>

            <p className="text-[11px] leading-relaxed text-stone-500">
              {t("info.materials.supportHint")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
