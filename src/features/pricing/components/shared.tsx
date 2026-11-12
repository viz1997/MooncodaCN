"use client";

import { KeyRound, Magnet, Medal, PawPrint } from "lucide-react";
/**
 * 移植自 wjp-source-code/src/app/page.tsx 的共享常量与小组件。
 *
 * 与源实现保持一致；移植时仅做类型严格化与 i18n 改造（文案改为 t() 调用），
 * 未改变任何数值行为。
 */
import type { ComponentType, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// 产品类型预设
// ---------------------------------------------------------------------------

export type ProductType = {
  id: string;
  /** i18n key 后缀：MaterialPricing.products.<id>.name */
  nameKey: string;
  icon: "paw" | "medal" | "key" | "magnet";
  solidRatio: number;
  coverage: number;
  /** i18n key：MaterialPricing.products.<id>.desc */
  descKey: string;
  color: string;
};

export const PRODUCT_TYPES: ProductType[] = [
  {
    id: "pet",
    nameKey: "products.pet.name",
    icon: "paw",
    solidRatio: 30,
    coverage: 50,
    descKey: "products.pet.desc",
    color: "#f59e0b",
  },
  {
    id: "badge",
    nameKey: "products.badge.name",
    icon: "medal",
    solidRatio: 60,
    coverage: 80,
    descKey: "products.badge.desc",
    color: "#a78bfa",
  },
  {
    id: "keychain",
    nameKey: "products.keychain.name",
    icon: "key",
    solidRatio: 60,
    coverage: 80,
    descKey: "products.keychain.desc",
    color: "#22d3ee",
  },
  {
    id: "magnet",
    nameKey: "products.magnet.name",
    icon: "magnet",
    solidRatio: 50,
    coverage: 70,
    descKey: "products.magnet.desc",
    color: "#84cc16",
  },
];

export const PRODUCT_ICONS: Record<
  ProductType["icon"],
  ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  paw: PawPrint,
  medal: Medal,
  key: KeyRound,
  magnet: Magnet,
};

/** 实心比例快捷预设 */
export const SOLID_PRESETS: { labelKey: string; ratio: number }[] = [
  { labelKey: "presets.hollow", ratio: 10 },
  { labelKey: "presets.halfHollow", ratio: 20 },
  { labelKey: "presets.normal", ratio: 30 },
  { labelKey: "presets.functional", ratio: 60 },
  { labelKey: "presets.dense", ratio: 100 },
];

// ---------------------------------------------------------------------------
// 数字格式化
// ---------------------------------------------------------------------------

/**
 * 数字格式化（固定小数位，千分位）
 *
 * 注意：源实现硬编码 `zh-CN` locale。这里保持不变 —— 报价数字的排版
 * 在中英两个 locale 下保持一致，避免同一份报价出现两种千分位写法。
 */
export const fmt = (v: number, digits = 2): string => {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

// ---------------------------------------------------------------------------
// 几何缩放
// ---------------------------------------------------------------------------

/**
 * 按 XYZ 缩放因子计算新的体积、表面积、尺寸
 *
 * 移植自源实现（page.tsx 的 `scaleGeometryXYZ`）—— 源实现没有把这段逻辑放进
 * pricing-engine，所以在此处原样保留。
 */
export function scaleGeometryXYZ(
  volume: number,
  surface: number,
  dims: [number, number, number],
  sx: number,
  sy: number,
  sz: number
): {
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
} {
  const safeSx = Number.isFinite(sx) && sx > 0 ? sx : 1;
  const safeSy = Number.isFinite(sy) && sy > 0 ? sy : 1;
  const safeSz = Number.isFinite(sz) && sz > 0 ? sz : 1;
  return {
    volumeCM3: volume * safeSx * safeSy * safeSz,
    // 表面积近似按平均缩放因子²计算（非均匀缩放无法精确解析）
    surfaceAreaCM2:
      surface * Math.sqrt(safeSx * safeSy * safeSz) ** 2 * 0.5 +
      ((surface * (safeSx * safeSy + safeSy * safeSz + safeSx * safeSz)) / 3) *
        0.5,
    dims: [dims[0] * safeSx, dims[1] * safeSy, dims[2] * safeSz],
  };
}

// ---------------------------------------------------------------------------
// 小组件
// ---------------------------------------------------------------------------

/** 数字输入框（手动模式外形尺寸） */
export function DimInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-stone-500">{label}</Label>
      <Input
        type="number"
        min="0"
        step="0.1"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="font-mono"
        placeholder="0.0"
      />
    </div>
  );
}

/** 统计块（克重 / 体积 / 费用等） */
export function StatBlock({
  label,
  value,
  icon,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${highlight ? "border-amber-300 bg-amber-50/60" : muted ? "border-stone-200 bg-stone-50/40" : "border-stone-200 bg-white"}`}
    >
      <div
        className={`flex items-center gap-1.5 text-xs ${muted ? "text-stone-400" : "text-stone-500"}`}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 font-mono ${highlight ? "text-amber-700 font-semibold text-base" : "text-stone-800 text-sm"}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * 只读尺寸显示（原始尺寸模式）
 *
 * 2026-11-12:数值 + 单位之前会被裁掉 —— 「1,234.5 mm」在 360px 宽的侧栏里
 * 需要 94px,而格子(94.33px)减去 `p-3` 的左右内边距只剩 70.33px ⇒ "mm" 探出
 * 卡片右缘 12.69px,被卡片自己的 `overflow-hidden` 切掉(画面上看着像 "mn")。
 *
 * 三处一起改才装得下:① 侧栏加宽(`model-settings-panel.tsx` 的
 * `md:w-[400px] xl:w-[440px]`)② 格子内边距 `p-3` → `p-2` ③ 数值 `text-lg`
 * → `text-base`、"mm" `text-xs` → `text-[10px]`。
 *
 * 数值那一格给 `min-w-0 truncate` + `title` —— 万一来了个离谱的大数
 * (五位数毫米),宁可截断并把完整值挂在 tooltip 上,也不让它顶掉 "mm"。
 */
export function DimDisplay({
  axis,
  axisColor,
  label,
  value,
}: {
  axis: string;
  axisColor: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 h-[78px] flex flex-col">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="size-3 rounded-sm"
          style={{ backgroundColor: axisColor }}
        />
        <span className="text-xs font-medium text-zinc-400">{axis}</span>
        <span className="text-xs text-zinc-500 ml-auto">{label}</span>
      </div>
      <div className="font-mono text-base text-zinc-100 flex items-center gap-1 flex-1">
        <span className="min-w-0 truncate" title={`${fmt(value, 1)} mm`}>
          {fmt(value, 1)}
        </span>
        <span className="text-[10px] text-zinc-500 shrink-0">mm</span>
      </div>
    </div>
  );
}

/**
 * 可编辑尺寸（自选尺寸模式）
 *
 * 2026-11-12:跟 `DimDisplay` 一起收窄 —— 数值 `text-lg` → `text-base`、
 * 输入框左右内边距 `px-2` → `px-1`、"mm" `text-xs` → `text-[10px]`。
 *
 * ⚠️ **输入框必须写 `min-w-0`** —— `<input>` 的 `min-width` 默认是 `auto`,
 * 也就是「不小于内容宽度」:flex 容器再怎么挤,输入框也不会缩到内容宽度以下
 * ⇒ 数值一长就把 "mm" 顶出去。加 `min-w-0` 之后它才肯缩,剩下的字靠浏览器
 * 自己的横向滚动看得到(`title` 里挂完整值)。
 *
 * ⚠️ **数字输入框的上下箭头也去掉** —— Chrome 的 spinner 画在输入框里侧,
 * 在 121px 宽的格子里占掉 13px,还会压住最后一位数字。仓库里那套写法
 * (`[appearance:textfield]` + `::-webkit-*-spin-button:appearance-none`,
 * canvas 模块那几个面板也是这么写的)一刀切掉。
 */
export function DimEditor({
  axis,
  axisColor,
  label,
  value,
  onChange,
}: {
  axis: string;
  axisColor: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 h-[78px] flex flex-col focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-500/30 transition-colors">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="size-3 rounded-sm"
          style={{ backgroundColor: axisColor }}
        />
        <span className="text-xs font-medium text-zinc-400">{axis}</span>
        <span className="text-xs text-zinc-500 ml-auto">{label}</span>
      </div>
      <div className="flex items-center gap-1 flex-1">
        <Input
          type="number"
          min="0.1"
          step="0.1"
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : ""}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          title={`${fmt(value, 1)} mm`}
          className="font-mono text-base h-7 px-1 py-0 border-0 bg-transparent text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-0 min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          placeholder="0.0"
        />
        <span className="text-[10px] text-zinc-500 shrink-0">mm</span>
      </div>
    </div>
  );
}

/**
 * 角度输入框（手动微调摆盘角度）
 *
 * `tone="dark"` —— 放在**深色的视口条**上时用(工作台的「模型角度」条跟
 * 3D 视口是同一个深色区块)。默认 `light` 给浅色面板用。
 *
 * ## 为什么输入框是**定宽**的(2026-11-12)
 *
 * 以前输入框没写宽度 ⇒ shadcn 的 `w-full` 生效 ⇒ 它把整条剩下的空间
 * 全部吃掉:1600px 的时候每个框 250px 宽(一个 0~360° 的数字孤零零地
 * 待在一条 250px 的长框里,「°」被甩到最右边),820px 的时候被压成
 * **14px**(根本没法用)。
 *
 * 现在:外层 `shrink-0`(不再 `flex-1` 抢空间),输入框 `w-14`(56px)——
 * 「°」紧跟在数字后面,整组宽度是确定的,窄屏时由父级 `flex-wrap`
 * 换行而不是压扁。
 */
export function AngleInput({
  label,
  value,
  onChange,
  color,
  tone = "light",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span
        className="size-2.5 rounded-sm shrink-0"
        style={{ backgroundColor: color }}
      />
      <span
        className={`text-[10px] font-medium shrink-0 ${
          dark ? "text-zinc-400" : "text-stone-600"
        }`}
      >
        {label}
      </span>
      <Input
        type="number"
        step="1"
        value={Number.isFinite(value) ? Math.round(value) : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={
          dark
            ? "w-14 font-mono text-xs h-6 px-1.5 py-0 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-violet-500/40 focus-visible:border-violet-400"
            : "w-14 font-mono text-xs h-6 px-1.5 py-0 border-stone-200 focus-visible:ring-violet-200 focus-visible:border-violet-400"
        }
        placeholder="0"
      />
      <span
        className={`text-[10px] shrink-0 ${
          dark ? "text-zinc-500" : "text-stone-400"
        }`}
      >
        °
      </span>
    </div>
  );
}
