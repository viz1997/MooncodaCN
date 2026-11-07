"use client";

/**
 * 打印前检查 —— 克重工具(`/tools/weight`)头部的那枚徽标
 *
 * ## 为什么克重工具里要有一枚检查徽标
 *
 * 工作室拿到一个模型要回答两个问题:**能不能印** / **要多少料**。以前这两
 * 个问题分在两个工具里,同一个文件要拖两次、解压两次、量两遍。
 *
 * 而克重工具那边其实**已经算出了完整拓扑** —— 摆盘 Worker 焊接的时候顺带
 * 做的。这一份摘要就是把它捡回来:徽标直接显示结论,用户**不用**先把文件
 * 拖进检查工具才知道能不能印。
 *
 * ## 一份口径
 *
 * 徽标里的每一个数、每一条结论都跟模型检查工具**走同一套代码**
 * (`tools/lib/mesh/summary.ts`)。所以两个工具**不可能**对同一个模型给出
 * 相反的结论 —— 摘要不是「另一套判定」,就是同一套判定的另一个出口。
 *
 * ## 它不是闸门
 *
 * 徽标只**摆事实**,不拦人 —— 有问题照样能加入打印单(工作室可能有特殊的
 * 处理办法)。加一道「确认」就多一个决策,而工作室要的是「少操作」。
 *
 * i18n 走 `ModelInspector` 命名空间 —— 检查工具的词汇表,两个工具共用。
 */

import { ArrowRight, CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { MeshCheckSummary } from "@/features/tools/lib/mesh/summary";

/**
 * 状态徽标 —— 摆在模型卡片的标签行里
 *
 * 「通过 / 需注意 / 发现问题」用的是 `ModelInspector.status.*` —— 检查工具
 * 侧栏用的就是这三个词,两边读到的同一个说法。
 */
export function MeshCheckBadge({
  summary,
}: {
  /** 焊接时算出来的自检摘要 —— 没有模型时是 null */
  summary: MeshCheckSummary | null;
}) {
  const t = useTranslations("ModelInspector");
  if (!summary) return null;

  const count = summary.warnings.length;

  if (summary.status === "pass") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-300 bg-emerald-50 text-emerald-700"
        title={t("check.passTitle")}
      >
        <CircleCheck className="size-3" aria-hidden />
        {t("status.pass")}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={
        summary.status === "fail"
          ? "border-rose-300 bg-rose-50 text-rose-700"
          : "border-amber-300 bg-amber-50 text-amber-700"
      }
      title={t("check.issuesTitle")}
    >
      <CircleAlert className="size-3" aria-hidden />
      {t("check.issues", { count })}
    </Badge>
  );
}

/**
 * 问题清单 —— 摆在标签行下面
 *
 * **有问题才渲染**(没问题时页面上一个多余的框都不该有)。文案跟检查工具
 * 侧栏的那份**逐字相同** —— 同一个 i18n key,不是各写一遍。
 */
export function MeshCheckIssues({
  summary,
  onInspect,
}: {
  summary: MeshCheckSummary | null;
  /** 「看详情」—— 带文件跳到检查工具;不给就不摆这个入口 */
  onInspect?: (() => void) | undefined;
}) {
  const t = useTranslations("ModelInspector");
  if (!summary || summary.status === "pass") return null;
  if (summary.warnings.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2">
      <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-900">
        {summary.warnings.map((w) => (
          <li key={w.key}>{t(w.key, w.params)}</li>
        ))}
      </ul>
      {onInspect && (
        <button
          type="button"
          onClick={onInspect}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 underline underline-offset-2 hover:no-underline"
        >
          {t("check.details")}
          <ArrowRight className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}
