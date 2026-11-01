"use client";

/**
 * 移植自 wjp-source-code/src/app/page.tsx 的「支撑克重校准」面板。
 *
 * 主页卡片与模型设置弹窗各有一份（源实现如此），这里抽成组件复用。
 * 三个参数（蜂窝填充率 / 外壳厚度 / 硅胶树脂密度）改动后立即通过
 * `onParamsChange` 回调重算支撑克重，无需重新摆盘。
 */
import { useTranslations } from "next-intl";

export type SupportParams = {
  fillRate: number;
  shellThickness: number;
  density: number;
};

export function SupportCalibration({
  params,
  onParamsChange,
  accent = "violet",
  columns = 3,
}: {
  params: SupportParams;
  onParamsChange: (next: SupportParams) => void;
  /** 主题色：violet（弹窗内）/ amber（主页卡片） */
  accent?: "violet" | "amber";
  /** 列数：3（弹窗内三列）/ 2（主页卡片两列） */
  columns?: 2 | 3;
}) {
  const t = useTranslations("MaterialPricing.calibration");
  const rangeClass =
    accent === "violet" ? "h-1.5 accent-violet-500" : "h-1.5 accent-amber-500";

  const apply = (next: Partial<SupportParams>) => {
    onParamsChange({ ...params, ...next });
  };

  const gridClass =
    columns === 3
      ? "grid grid-cols-1 sm:grid-cols-3 gap-2 p-2 bg-stone-50 rounded-b-md"
      : "grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-stone-50 rounded border border-stone-200";

  return (
    <div className={gridClass}>
      <label className="text-[10px] text-stone-600 flex flex-col gap-1">
        <span className="flex items-center justify-between">
          <span>{t("fillRate")}</span>
          <span className="font-mono text-stone-800">
            {(params.fillRate * 100).toFixed(0)}%
          </span>
        </span>
        <input
          type="range"
          min={0.05}
          max={1.0}
          step={0.01}
          value={params.fillRate}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v)) return;
            apply({ fillRate: v });
          }}
          className={rangeClass}
        />
        <input
          type="number"
          min={0.05}
          max={1.0}
          step={0.01}
          value={params.fillRate}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v)) return;
            apply({ fillRate: Math.max(0.05, Math.min(1.0, v)) });
          }}
          className="font-mono h-6 text-[10px] w-full px-1 border border-stone-300 rounded"
        />
      </label>

      <label className="text-[10px] text-stone-600 flex flex-col gap-1">
        <span className="flex items-center justify-between">
          <span>{t("shellThickness")}</span>
          <span className="font-mono text-stone-800">
            {params.shellThickness.toFixed(1)}
          </span>
        </span>
        <input
          type="range"
          min={0.5}
          max={5.0}
          step={0.1}
          value={params.shellThickness}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v)) return;
            apply({ shellThickness: v });
          }}
          className={rangeClass}
        />
        <input
          type="number"
          min={0.5}
          max={5.0}
          step={0.1}
          value={params.shellThickness}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v)) return;
            apply({ shellThickness: Math.max(0.5, Math.min(5.0, v)) });
          }}
          className="font-mono h-6 text-[10px] w-full px-1 border border-stone-300 rounded"
        />
      </label>

      <label className="text-[10px] text-stone-600 flex flex-col gap-1">
        <span className="flex items-center justify-between">
          <span>{t("density")}</span>
          <span className="font-mono text-stone-800">
            {params.density.toFixed(2)}
          </span>
        </span>
        <input
          type="range"
          min={0.5}
          max={2.0}
          step={0.05}
          value={params.density}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v)) return;
            apply({ density: v });
          }}
          className={rangeClass}
        />
        <input
          type="number"
          min={0.5}
          max={2.0}
          step={0.05}
          value={params.density}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v)) return;
            apply({ density: Math.max(0.5, Math.min(2.0, v)) });
          }}
          className="font-mono h-6 text-[10px] w-full px-1 border border-stone-300 rounded"
        />
      </label>

      <div
        className={
          columns === 3
            ? "col-span-full text-[9px] text-stone-400 leading-relaxed"
            : "sm:col-span-2 text-[9px] text-stone-400 leading-relaxed"
        }
      >
        {t("hint")}
      </div>
    </div>
  );
}
