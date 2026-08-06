"use client";

import { Check, X } from "lucide-react";

import type { OrderStatus } from "@/features/gpt-image/lib/types";

const STEPS = ["上传", "生成", "选图", "完成"] as const;

/** 状态 → 当前所处步骤（0-3） */
function stepOf(status: OrderStatus): number {
  switch (status) {
    case "PENDING":
    case "FAILED":
      return 0;
    case "GENERATING":
      return 1;
    case "CANDIDATES_READY":
      return 2;
    case "SELECTED":
      return 3;
    default:
      return 0;
  }
}

export function StepRail({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") return null;

  const current = stepOf(status);
  const failed = status === "FAILED";
  const done = status === "SELECTED";

  return (
    <nav aria-label="流程进度">
      <ol className="flex items-center">
        {STEPS.map((label, i) => {
          const isDone = done || i < current;
          const isCurrent = !done && i === current;
          const isFailedStep = failed && i === 1;

          return (
            <li key={label} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  aria-hidden
                  className={[
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium transition-colors",
                    isFailedStep
                      ? "bg-red-100 text-red-700"
                      : isDone
                        ? "bg-zinc-900 text-white"
                        : isCurrent
                          ? "bg-white text-zinc-900 ring-2 ring-zinc-900"
                          : "bg-zinc-100 text-zinc-400",
                  ].join(" ")}
                >
                  {isFailedStep ? (
                    <X className="h-3 w-3" />
                  ) : isDone ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={[
                    "text-[11px] whitespace-nowrap",
                    isFailedStep
                      ? "text-red-700"
                      : isCurrent
                        ? "font-medium text-zinc-900"
                        : isDone
                          ? "text-zinc-600"
                          : "text-zinc-400",
                  ].join(" ")}
                >
                  {isFailedStep ? "失败" : label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={[
                    "mx-2 mb-5 h-px flex-1 rounded-full",
                    isDone ? "bg-zinc-900" : "bg-zinc-200",
                  ].join(" ")}
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">
        当前处于第 {current + 1} 步：{failed ? "生成失败" : STEPS[current]}
      </p>
    </nav>
  );
}