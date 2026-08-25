// @ts-nocheck

import { ConfigProvider, InputNumber, Switch } from "antd";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/features/canvas/i18n";
import type { CanvasTheme } from "@/features/canvas/lib/canvas-theme";
import type { AiConfig } from "@/features/canvas/stores/use-config-store";

const qualityOptions = [
  { value: "auto", labelKey: "auto" },
  { value: "high", labelKey: "high" },
  { value: "medium", labelKey: "medium" },
  { value: "low", labelKey: "low" },
];
const DIMENSION_STEP = 16;

const aspectOptions = [
  // 2026-08-25：去重尺寸。之前 16:9 有 3 个 entry（16:9 / 16:9(2k) / 16:9(4k)），
  // 9:16 同理有 3 个，1:1 有 2 个 —— 同一个宽高比反复出现，用户难选。
  // 现在每个比例只留 1 个标准分辨率；高分辨率需求交给上方的 W/H 数字输入
  // （已经支持自定义分辨率，会按 16 倍数对齐），不再塞进预设网格。
  { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
  { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
  { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
  { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
  { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
  {
    value: "16:9",
    label: "16:9",
    width: 1824,
    height: 1024,
    icon: "landscape",
  },
  { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
  { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

export const imageQualityOptions = qualityOptions.map((item) => ({
  value: item.value,
  get label() {
    return i18n.t(`settingsPanels.common.${item.labelKey}`);
  },
}));
export const imageAspectOptions = aspectOptions.map((item) => ({
  value: item.size || item.value,
  label: item.label,
}));

type ImageSettingsPanelProps = {
  config: AiConfig;
  onConfigChange: (
    key: "quality" | "size" | "count" | "background" | "autoStitch",
    value: string | boolean
  ) => void;
  theme: CanvasTheme;
  showTitle?: boolean;
  className?: string;
  maxCount?: number;
  quickCount?: number;
  /**
   * 是否在张数区显示 1-10 的快速选择 pill。
   * 默认 true（保留画布内的多选体验）；生图工作台 V2 设为 false，只留数字输入。
   */
  showQuickCount?: boolean;
};

export function ImageSettingsPanel({
  config,
  onConfigChange,
  theme,
  showTitle = true,
  className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5",
  maxCount = 15,
  quickCount = 10,
  showQuickCount = true,
}: ImageSettingsPanelProps) {
  const { t } = useTranslation();
  const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
  const quality = config.quality || "auto";
  const count = Math.max(
    1,
    Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1))
  );
  const activeSize = config.size || "auto";
  const transparentBackground = config.background === "transparent";
  const selectedAspect = aspectOptions.find(
    (item) =>
      (item.size || item.value) === activeSize || item.value === activeSize
  );
  const dimensions = readSizeDimensions(
    activeSize,
    selectedAspect || aspectOptions[0]
  );
  const selectAspect = (value: string) => {
    const option = aspectOptions.find((item) => item.value === value);
    onConfigChange("size", option?.size || option?.value || "auto");
  };
  const updateDimension = (key: "width" | "height", value: number | null) => {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
    const width = key === "width" ? next : dimensions.width;
    const height = key === "height" ? next : dimensions.height;
    onConfigChange(
      "size",
      `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`
    );
  };

  return (
    <ImageSettingsTheme theme={theme}>
      <div
        className={className}
        style={{ color: theme.node.text }}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (event.target instanceof HTMLInputElement) return;
          if (
            document.activeElement instanceof HTMLInputElement &&
            event.currentTarget.contains(document.activeElement)
          )
            document.activeElement.blur();
        }}
      >
        {showTitle ? (
          <div className="text-lg font-semibold">
            {t("settingsPanels.image.title")}
          </div>
        ) : null}
        {/* 2026-08-25：自动拼接宫格图 —— 放到设置面板最顶端，作为"结果呈现"
         * 开关优先级最高（用户进 Modal 最先想看到的就是这个）。之前放在
         * count 之后、Modal 末尾，Modal 内容长时容易被滚动条藏住。 */}
        <div
          className="rounded-md border bg-muted/40 px-3 py-2"
          style={{ borderColor: theme.node.stroke }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold">
                {t("settingsPanels.image.autoStitch")}
              </div>
              <div
                className="text-xs"
                style={{ color: theme.node.muted, opacity: 0.75 }}
              >
                {t("settingsPanels.image.autoStitchHint")}
              </div>
            </div>
            <span onMouseDown={(event) => event.stopPropagation()}>
              <Switch
                size="small"
                checked={Boolean(config.autoStitch)}
                onChange={(checked) => onConfigChange("autoStitch", checked)}
              />
            </span>
          </div>
        </div>
        <div className="space-y-2.5">
          <SettingTitle color={theme.node.muted}>
            {t("settingsPanels.image.quality")}
          </SettingTitle>
          <div className="grid grid-cols-4 gap-2.5">
            {qualityOptions.map((item) => (
              <OptionPill
                key={item.value}
                selected={quality === item.value}
                theme={theme}
                onClick={() => onConfigChange("quality", item.value)}
              >
                {t(`settingsPanels.common.${item.labelKey}`)}
              </OptionPill>
            ))}
          </div>
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <SettingTitle color={theme.node.muted}>
              {t("settingsPanels.image.size")}
            </SettingTitle>
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-medium"
                style={{ color: theme.node.muted }}
              >
                {t("settingsPanels.image.align16")}
              </span>
              <span
                title={t("settingsPanels.image.align16Hint")}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <Switch
                  size="small"
                  checked={snapDimensionToStep}
                  onChange={setSnapDimensionToStep}
                />
              </span>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
            <DimensionInput
              prefix="W"
              value={dimensions.width}
              disabled={activeSize === "auto"}
              theme={theme}
              alignToStep={snapDimensionToStep}
              onChange={(value) => updateDimension("width", value)}
            />
            <span className="text-lg opacity-45">↔</span>
            <DimensionInput
              prefix="H"
              value={dimensions.height}
              disabled={activeSize === "auto"}
              theme={theme}
              alignToStep={snapDimensionToStep}
              onChange={(value) => updateDimension("height", value)}
            />
          </div>
        </div>
        <div className="space-y-2.5">
          <SettingTitle color={theme.node.muted}>
            {t("settingsPanels.image.aspectRatio")}
          </SettingTitle>
          <div className="grid grid-cols-4 gap-2.5">
            {aspectOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                style={{
                  borderColor:
                    selectedAspect?.value === item.value
                      ? theme.node.text
                      : theme.node.stroke,
                  background: "transparent",
                  color: theme.node.text,
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => selectAspect(item.value)}
              >
                <AspectIcon
                  type={item.icon}
                  width={item.width}
                  height={item.height}
                  color={theme.node.text}
                />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <SettingTitle color={theme.node.muted}>
              {t("settingsPanels.image.transparent")}
            </SettingTitle>
            <div
              className="text-xs"
              style={{ color: theme.node.muted, opacity: 0.75 }}
            >
              {t("settingsPanels.image.transparentHint")}
            </div>
          </div>
          <span onMouseDown={(event) => event.stopPropagation()}>
            <Switch
              size="small"
              checked={transparentBackground}
              onChange={(checked) =>
                onConfigChange("background", checked ? "transparent" : "")
              }
            />
          </span>
        </div>
        <div className="space-y-2.5">
          <SettingTitle color={theme.node.muted}>
            {t("settingsPanels.image.count")}
          </SettingTitle>
          {showQuickCount ? (
            <div className="grid grid-cols-4 gap-2.5">
              {Array.from({ length: quickCount }, (_, index) => index + 1).map(
                (value) => (
                  <OptionPill
                    key={value}
                    selected={count === value}
                    theme={theme}
                    onClick={() => onConfigChange("count", String(value))}
                  >
                    {t("settingsPanels.image.images", { count: value })}
                  </OptionPill>
                )
              )}
              <CountInput
                value={count}
                max={maxCount}
                theme={theme}
                onChange={(value) =>
                  onConfigChange("count", String(value || 1))
                }
              />
            </div>
          ) : (
            <CountInput
              value={count}
              max={maxCount}
              theme={theme}
              onChange={(value) => onConfigChange("count", String(value || 1))}
              fullWidth
            />
          )}
        </div>
      </div>
    </ImageSettingsTheme>
  );
}

export function ImageSettingsTheme({
  theme,
  children,
}: {
  theme: CanvasTheme;
  children: ReactNode;
}) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorBgContainer: theme.toolbar.panel,
          colorBgElevated: theme.toolbar.panel,
          colorBorder: theme.node.stroke,
          colorPrimary: theme.node.activeStroke,
          colorText: theme.node.text,
          colorTextLightSolid: theme.node.panel,
        },
        components: {
          Button: {
            defaultBg: theme.toolbar.panel,
            defaultBorderColor: theme.node.stroke,
            defaultColor: theme.node.text,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

export function imageQualityLabel(value: string) {
  return ["auto", "high", "medium", "low"].includes(value)
    ? i18n.t(`settingsPanels.common.${value}`)
    : value;
}

export function imageSizeLabel(size: string) {
  return (
    aspectOptions.find(
      (item) => (item.size || item.value) === size || item.value === size
    )?.label || size
  );
}

function OptionPill({
  selected,
  theme,
  onClick,
  children,
}: {
  selected: boolean;
  theme: CanvasTheme;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
      style={{
        background: "transparent",
        borderColor: selected ? theme.node.text : theme.node.stroke,
        color: theme.node.text,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DimensionInput({
  prefix,
  value,
  disabled,
  theme,
  alignToStep,
  onChange,
}: {
  prefix: string;
  value: number;
  disabled: boolean;
  theme: CanvasTheme;
  alignToStep: boolean;
  onChange: (value: number | null) => void;
}) {
  const commit = (input: HTMLInputElement) => {
    const next = alignDimension(
      Math.max(1, Math.floor(Number(input.value) || value || 1024)),
      alignToStep
    );
    input.value = String(next);
    onChange(next);
  };

  return (
    <label
      className="flex h-9 overflow-hidden rounded-xl text-sm"
      style={{
        background: theme.node.fill,
        color: theme.node.text,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        className="grid w-9 place-items-center"
        style={{ color: theme.node.muted }}
      >
        {prefix}
      </span>
      <input
        type="number"
        min={1}
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        defaultValue={value || ""}
        key={`${prefix}-${value}`}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      />
    </label>
  );
}

function CountInput({
  value,
  max,
  theme,
  onChange,
  fullWidth = false,
}: {
  value: number;
  max: number;
  theme: CanvasTheme;
  onChange: (value: number | null) => void;
  /**
   * 独立使用（不嵌在 grid 里）时设为 true，让 label 撑满父容器宽度；
   * 默认 false 保留 col-span-2，与 quickCount 场景下的 4 列网格对齐。
   */
  fullWidth?: boolean;
}) {
  return (
    <div
      className={fullWidth ? "w-full" : "col-span-2"}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <InputNumber
        min={1}
        max={max}
        value={value}
        onChange={(next) => onChange(typeof next === "number" ? next : null)}
        size="middle"
        controls
        style={{
          width: "100%",
          borderRadius: 9999,
          background: "transparent",
          color: theme.node.text,
          borderColor: theme.node.stroke,
        }}
      />
    </div>
  );
}

function AspectIcon({
  type,
  width,
  height,
  color,
}: {
  type: string;
  width: number;
  height: number;
  color: string;
}) {
  if (type === "auto") return null;
  const ratio = width / Math.max(1, height);
  const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
  const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
  return (
    <span className="grid h-7 w-9 place-items-center">
      <span
        className="border-2"
        style={{ width: boxWidth, height: boxHeight, borderColor: color }}
      />
    </span>
  );
}

function SettingTitle({
  children,
  color,
}: {
  children: string;
  color: string;
}) {
  return (
    <div className="text-xs font-medium" style={{ color }}>
      {children}
    </div>
  );
}

function readSizeDimensions(
  size: string,
  fallback: { width: number; height: number }
) {
  const match = size?.match(/^(\d+)x(\d+)$/);
  return {
    width: match ? Number(match[1]) : fallback.width,
    height: match ? Number(match[2]) : fallback.height,
  };
}

function alignDimension(value: number, enabled: boolean) {
  return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
