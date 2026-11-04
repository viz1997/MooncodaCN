"use client";

import {
  AlertCircle,
  Beaker,
  Box,
  Calculator,
  CheckCircle2,
  KeyRound,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
/**
 * Mooncoda 3D 打印克重计算器的三个说明弹窗
 * （克重算法 / 产品类型预设 / 材料参数）。
 *
 * 移植自 wjp-source-code/src/app/page.tsx。与源实现的差异：
 *  - 材料参数的密码校验从「客户端硬编码哈希」改成
 *    「服务端环境变量 + 常量时间比较」（见 /api/image-gen/pricing/materials-auth）。
 *    未配置 `PRICING_MATERIALS_PASSWORD` 时直接放开编辑（优雅降级）。
 *  - 弹窗只讲克重，不再展示任何价格（单价 / 光油费 / 支撑费）。
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fmt,
  PRODUCT_ICONS,
  PRODUCT_TYPES,
} from "@/features/pricing/components/shared";

export type InfoDialogKind = "algorithm" | "products" | "materials" | null;

export type PricingInfoDialogsProps = {
  infoDialog: InfoDialogKind;
  onInfoDialogChange: (kind: InfoDialogKind) => void;

  /** 材料参数（受控） */
  materialDensity: number;
  onMaterialDensityChange: (v: number) => void;
  /**
   * 支撑材料密度 (g/cm³) —— 支撑跟模型**不是**一种材料
   *
   * 水溶性支撑(PVA/BVOH,约 1.13~1.30 g/cm³)跟光敏树脂密度不同:
   * 支撑克重 = 支撑体积 × 支撑密度,总克重 = 耗材克重 + 支撑克重。
   */
  supportDensity: number;
  onSupportDensityChange: (v: number) => void;

  /** 应用产品预设 */
  onApplyProduct: (productId: string) => void;
};

type AuthState = "checking" | "unlocked" | "locked" | "open";

export function PricingInfoDialogs({
  infoDialog,
  onInfoDialogChange,
  materialDensity,
  onMaterialDensityChange,
  supportDensity,
  onSupportDensityChange,
  onApplyProduct,
}: PricingInfoDialogsProps) {
  const t = useTranslations("MaterialPricing");

  // 材料参数解锁状态
  const [authState, setAuthState] = useState<AuthState>("open");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [verifyingPassword, setVerifyingPassword] = useState(false);

  // 打开「材料参数」弹窗时问一次服务端：这个部署到底要不要密码
  useEffect(() => {
    if (infoDialog !== "materials") return;
    let cancelled = false;
    setAuthState("checking");
    fetch("/api/image-gen/pricing/materials-auth")
      .then((res) => res.json())
      .then((data: { configured?: boolean }) => {
        if (cancelled) return;
        setAuthState(data.configured ? "locked" : "unlocked");
      })
      .catch(() => {
        // 网络异常时不阻塞使用 —— 直接放开
        if (!cancelled) setAuthState("unlocked");
      });
    return () => {
      cancelled = true;
    };
  }, [infoDialog]);

  const verifyMaterialsPassword = async () => {
    if (!passwordInput) return;
    setVerifyingPassword(true);
    setPasswordError(false);
    try {
      const res = await fetch("/api/image-gen/pricing/materials-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) {
        setAuthState("unlocked");
        setPasswordInput("");
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    } finally {
      setVerifyingPassword(false);
    }
  };

  const lockMaterials = () => {
    setAuthState("locked");
    setPasswordInput("");
    setPasswordError(false);
  };

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

        {/* ---- 材料参数 ---- */}
        {infoDialog === "materials" && authState === "checking" && (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="size-6 text-amber-600 animate-spin" />
          </div>
        )}

        {infoDialog === "materials" && authState === "unlocked" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="size-3.5" />
                <span>{t("info.materials.unlocked")}</span>
              </div>
              <button
                type="button"
                onClick={lockMaterials}
                className="text-xs text-stone-500 hover:text-red-600 flex items-center gap-1"
              >
                <KeyRound className="size-3" />
                {t("info.materials.lock")}
              </button>
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
                  <Label className="text-xs text-stone-500 shrink-0">
                    {t("info.materials.densityLabel")}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="5"
                    value={materialDensity}
                    onChange={(e) =>
                      // 必须夹逼到 > 0：密度为 0 时 `calculatePrice()` 返回 null，
                      // 整个克重界面（含体积 / 表面积）会一起消失。
                      onMaterialDensityChange(
                        Math.max(0.1, parseFloat(e.target.value) || 0.1)
                      )
                    }
                    className="font-mono h-8 text-sm max-w-[120px]"
                  />
                  <span className="text-xs text-stone-500">g/cm³</span>
                </div>
                {/* 支撑是另一种材料 —— 密度跟模型分开填 */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-stone-500 shrink-0">
                    {t("info.materials.supportDensityLabel")}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="5"
                    value={supportDensity}
                    onChange={(e) =>
                      // 同样夹逼到 > 0：密度非法时支撑克重算不出来
                      onSupportDensityChange(
                        Math.max(0.1, parseFloat(e.target.value) || 0.1)
                      )
                    }
                    className="font-mono h-8 text-sm max-w-[120px]"
                  />
                  <span className="text-xs text-stone-500">g/cm³</span>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-stone-500">
                {t("info.materials.supportDensityHint")}
              </p>
            </div>
          </div>
        )}

        {infoDialog === "materials" && authState === "locked" && (
          <div className="py-6 flex flex-col items-center text-center">
            <div className="size-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <KeyRound className="size-7 text-amber-600" />
            </div>
            <h3 className="text-base font-semibold text-stone-800 mb-1">
              {t("info.materials.lockedTitle")}
            </h3>
            <p className="text-sm text-stone-500 mb-4 max-w-xs">
              {t("info.materials.lockedHint")}
            </p>
            <div className="w-full max-w-xs space-y-3">
              <div className="relative">
                <Input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setPasswordError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") verifyMaterialsPassword();
                  }}
                  placeholder={t("info.materials.passwordPlaceholder")}
                  className={`font-mono text-center h-10 ${passwordError ? "border-red-300 focus-visible:ring-red-200" : ""}`}
                  disabled={verifyingPassword}
                  autoFocus
                />
                {passwordError && (
                  <p className="text-[11px] text-red-600 mt-1.5 flex items-center justify-center gap-1">
                    <AlertCircle className="size-3" />
                    {t("info.materials.passwordError")}
                  </p>
                )}
              </div>
              <Button
                onClick={verifyMaterialsPassword}
                disabled={!passwordInput || verifyingPassword}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              >
                {verifyingPassword ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("info.materials.verifying")}
                  </>
                ) : (
                  <>
                    <KeyRound className="size-4" />
                    {t("info.materials.verify")}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
