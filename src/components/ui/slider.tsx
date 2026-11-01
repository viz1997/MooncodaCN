"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { type ComponentProps, useMemo } from "react";

import { cn } from "@/lib/utils";

/**
 * 滑块 —— 克重计算器的实心比例 / 并发线程 / 支撑参数都用它。
 *
 * 依赖 `@radix-ui/react-slider`(已在 package.json),此前仓库缺这个 shadcn 组件,
 * 随 wjp-source-code 移植一并补齐。
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  const values = useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      // Radix 的 `value` / `defaultValue` 是 `?: number[]`(不含 undefined),
      // 在 exactOptionalPropertyTypes 下不能直接传 undefined —— 按需展开。
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn("bg-primary absolute h-full")}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          // biome-ignore lint/suspicious/noArrayIndexKey: 滑块 thumb 数量固定,索引即 key
          key={index}
          data-slot="slider-thumb"
          className={cn(
            "border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
