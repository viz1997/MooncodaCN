"use client";

/**
 * 打印前工作台 —— 「检查」视角的**侧栏**
 *
 * ## 它是什么
 *
 * 2026-11-07 起,模型检查工具**并进**打印前工作台(`/tools/workbench`):两个工具页
 * 合成一个工作台,模型只载入一次,里面用 **检查 / 克重** 两个视角
 * 看同一个模型。
 *
 * 2026-11-07 又改了一次:两个视角**共用一个展示区域** —— 3D 视口只挂一次,
 * 切视角只换喂进去的数据(见 `features/shared/components/model-viewport/`)。
 * 所以本组件**不再自己挂视口**,只负责右栏那一块:
 *
 * - 顶部:分析出错 / 单位不是毫米 两条提示
 * - 中间:`Sidebar` —— WJP 评估 + 反转法向 / 坏边 / 壳体 三张卡片
 * - 底部:状态栏(三角形 / 顶点 / 水密 / 体积 / 耗时)
 *
 * 视口那一半由上层的工作台框架渲染(`pricing/components/model-settings-panel.tsx`)
 * —— 它拿着同一份分析结果、同一组图层开关、同一份聚焦请求。
 *
 * ## 一份口径(结构上保证)
 *
 * - **几何只有一份** —— 上层传的顶点就是克重工具那份(同一个 `ModelFile`,
 *   同一个 `parseResult`)。以前检查工具会**再解析一遍 OBJ** 才能拿到 UV /
 *   材质分组,现在不用了。
 * - **尺寸跟着当前缩放走** —— 上层按当前生效的缩放因子缩放顶点后再分析,
 *   所以画出来的支撑外壳跟克重那一栏的支撑克重是**同一个几何**。
 * - **托底高度跟随后台** —— `clientConfig.supportLiftMm`,跟克重工具、
 *   跟服务端报价用的是同一个值。
 */
import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ModelUnitCheck } from "@/features/pricing/lib/model-units";
import type {
  AnalysisResult,
  IssueCluster,
  MessageRef,
} from "@/features/tools/lib/mesh/types";
import Sidebar from "./sidebar";

export function ModelCheckSidePanel({
  result,
  busy,
  error,
  unitCheck,
  onFocusCluster,
  onFocusPoint,
}: {
  /** 分析结果 —— 侧栏吃它,视口也吃**同一份** */
  result: AnalysisResult | null;
  /** 正在分析 —— 侧栏据此显示「分析中」 */
  busy: boolean;
  /** 分析出错 */
  error: MessageRef | null;
  /** 单位判定结果 —— 文件坐标不是毫米时才有值 */
  unitCheck?: ModelUnitCheck | null | undefined;
  /** 点一簇问题 → 相机飞过去 */
  onFocusCluster: (c: IssueCluster) => void;
  /** 点一个问题点 → 相机飞过去 */
  onFocusPoint: (p: [number, number, number], radius: number) => void;
}) {
  const t = useTranslations("ModelInspector");
  const stats = result?.stats ?? null;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          role="alert"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t(error.key, error.params)}</span>
        </div>
      )}

      {/* 单位判定 —— 文件坐标不是毫米时,支撑外壳按归一化后的真实尺寸画 */}
      {unitCheck?.normalized && (
        <output className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("units.notMillimeters", {
              extent: unitCheck.originalMaxExtent.toFixed(2),
            })}
            <span className="mt-1 block text-amber-400/80">
              {t("units.treatedAs", {
                size: unitCheck.assumedMaxExtentMm,
              })}
            </span>
          </span>
        </output>
      )}

      <Sidebar
        result={result}
        busy={busy}
        onFocusCluster={onFocusCluster}
        onFocusPoint={onFocusPoint}
      />

      {/* ---------- 状态栏 ---------- */}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
        <span className="max-w-48 truncate text-zinc-400">
          {stats?.fileName ?? t("stats.notLoaded")}
        </span>
        {stats && (
          <>
            <span>
              {t("stats.triangles")}{" "}
              <b className="font-mono text-zinc-300">
                {stats.triangleCount.toLocaleString()}
              </b>
            </span>
            <span>
              {t("stats.vertices")}{" "}
              <b className="font-mono text-zinc-300">
                {stats.vertexCount.toLocaleString()}
              </b>
            </span>
            <span>
              {t("stats.watertight")}{" "}
              <b
                className={
                  stats.watertight ? "text-emerald-400" : "text-rose-400"
                }
              >
                {stats.watertight
                  ? t("stats.watertightYes")
                  : t("stats.watertightNo")}
              </b>
            </span>
            <span>
              {t("stats.volume")}{" "}
              <b className="font-mono text-zinc-300">
                {stats.volumeMm3 >= 0 ? "" : "-"}
                {Math.abs(stats.volumeMm3) >= 1e6
                  ? `${(Math.abs(stats.volumeMm3) / 1000).toFixed(1)} cm³`
                  : `${Math.abs(stats.volumeMm3).toFixed(0)} mm³`}
              </b>
            </span>
            <span className="hidden sm:inline">
              {t("stats.analysisMs")}{" "}
              <b className="font-mono text-zinc-300">{stats.analysisMs} ms</b>
            </span>
          </>
        )}
        {!stats && (
          <span className="text-zinc-600">{t("stats.localHint")}</span>
        )}
      </footer>
    </div>
  );
}
