"use client";

/**
 * 「检查」视角的状态 —— **分析器 + 图层开关 + 聚焦请求**
 *
 * ## 为什么状态住在这一层,不在检查面板里
 *
 * 2026-11-07:两个视角(检查 / 克重)**共用一个展示区域** —— 3D 视口
 * 只挂一次,切视角只换**喂进去的数据**。
 *
 * 视口要吃三样「检查」独有的数据:
 *
 * | 数据 | 干什么 |
 * |---|---|
 * | `result` | 画问题着色 / 问题边线 |
 * | `visibility` | 哪些问题图层要显示(图例栏的开关) |
 * | `focusRequest` | 点侧栏里的问题 → 相机飞过去 |
 *
 * 这三样都归这个 hook 管,住在**视口的上一层**。检查面板自己只负责
 * 「把结果摆出来」(侧栏),不持有状态 —— 它要是自己持有,视口就没法在
 * 切到「克重」那一栏时还挂着同一份数据。
 *
 * ## 分析器不在后台偷偷跑
 *
 * `active` = 当前是不是「检查」那一栏。只有切到那一栏才启动分析 ——
 * 用户只想量个克重,不该在后台跑一遍焊接 + 拓扑分析。
 *
 * 切走再切回来**不重跑**:同一份几何分析过一次就留着(`analyzedRef`),
 * 免得来回切一次视角就等几秒。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewportVisibility } from "@/features/shared/components/model-viewport";
import {
  ISSUE_COLORS,
  type IssueCluster,
} from "@/features/tools/lib/mesh/types";
import { useAnalyzer } from "./use-analyzer";

/**
 * 图层默认开关:对应参考软件检测面板
 * (反转法向 ✓ / 坏边:缝隙 ✓ 平面孔洞 ✓ 轮廓 ✗ / 壳体 ✓ / 噪声壳体 ✗)
 */
export const ALL_VISIBILITY: ViewportVisibility = {
  flipped: true,
  degenerate: true,
  duplicate: true,
  shellExtra: true,
  shellNoise: false, // 噪声壳体默认不显示(对应参考软件未勾选)
  openEdge: true,
  planarHole: true,
  nonManifoldEdge: true,
  outline: false, // 轮廓默认不显示(对应参考软件未勾选)
};

/** 图例项 —— 顺序就是显示顺序(颜色取自分析层的那一份) */
export const LEGEND_ITEMS: { key: keyof ViewportVisibility; color: string }[] =
  [
    { key: "flipped", color: ISSUE_COLORS.flipped },
    { key: "degenerate", color: ISSUE_COLORS.degenerate },
    { key: "duplicate", color: ISSUE_COLORS.duplicate },
    { key: "shellExtra", color: ISSUE_COLORS.shellExtra },
    { key: "shellNoise", color: ISSUE_COLORS.shellNoise },
    { key: "openEdge", color: ISSUE_COLORS.openEdge },
    { key: "planarHole", color: ISSUE_COLORS.planarHole },
    { key: "nonManifoldEdge", color: ISSUE_COLORS.nonManifoldEdge },
    { key: "outline", color: ISSUE_COLORS.outline },
  ];

/** 聚焦请求 —— 视口据此把相机飞过去 */
export type CheckFocusRequest = {
  seq: number;
  point: [number, number, number] | null;
  radius?: number;
  dir?: [number, number, number];
};

export function useCheckView({
  positions,
  fileName,
  liftMm,
  baseMarginMm,
  active,
}: {
  /**
   * 缩放后的三角汤 —— 分析器跟视口吃的是**同一份**
   *
   * 由上层算好传进来(上层也要用它画视口)—— 两边各缩放一次的话,
   * 尺寸面板改的是**另一边**的几何,支撑克重跟画面对不上。
   */
  positions: Float32Array | null;
  /** 文件名 —— 报告里显示 */
  fileName: string;
  /** 托底高度 (mm) —— 跟随后台(`/admin/print-pricing`) */
  liftMm?: number | undefined;
  /** 底板留边 (mm) —— 跟随后台 */
  baseMarginMm?: number | undefined;
  /** 当前是不是「检查」那一栏 —— 只有切到那一栏才启动分析器 */
  active: boolean;
}) {
  const { state, run } = useAnalyzer();
  const { result, busy, stage, pct, error } = state;

  const [visibility, setVisibility] =
    useState<ViewportVisibility>(ALL_VISIBILITY);
  const [focusRequest, setFocusRequest] = useState<CheckFocusRequest | null>(
    null
  );
  const focusSeq = useRef(0);

  /**
   * 已经分析过的那份几何
   *
   * 切走再切回来不重跑 —— 同一份几何(同一份缩放后的顶点 + 同一组参数)
   * 分析过一次就够了。
   */
  const analyzedRef = useRef<{
    positions: Float32Array;
    fileName: string;
    liftMm: number | undefined;
    baseMarginMm: number | undefined;
  } | null>(null);

  useEffect(() => {
    // 没切到「检查」那一栏 → 不启动(分析器不在后台偷偷跑)
    if (!active || !positions) return;
    const last = analyzedRef.current;
    if (
      last &&
      last.positions === positions &&
      last.fileName === fileName &&
      last.liftMm === liftMm &&
      last.baseMarginMm === baseMarginMm
    ) {
      return;
    }
    analyzedRef.current = { positions, fileName, liftMm, baseMarginMm };
    run({ positions, fileName, liftMm, baseMarginMm });
  }, [active, positions, fileName, run, liftMm, baseMarginMm]);

  /** 点侧栏里的一簇问题 → 相机飞过去 */
  const focusCluster = useCallback((c: IssueCluster) => {
    focusSeq.current += 1;
    setFocusRequest({
      seq: focusSeq.current,
      point: c.centroid,
      dir: [0.9, -1.1, 0.75],
    });
  }, []);

  /** 点侧栏里的单个问题点 → 相机飞过去 */
  const focusPoint = useCallback(
    (p: [number, number, number], radius: number) => {
      focusSeq.current += 1;
      setFocusRequest({ seq: focusSeq.current, point: p, radius });
    },
    []
  );

  /**
   * 实际检出了哪些问题 —— 图例只显示检出的类别
   *
   * 没检出的类别不摆开关:摆一个永远点不动的按钮比不摆更糟。
   */
  const issuePresent = useMemo(() => {
    if (!result) return null;
    const s = result.stats;
    return {
      flipped: s.flippedFaceCount > 0 || s.globalInvertedShellCount > 0,
      degenerate: s.degenerateCount > 0,
      duplicate: s.duplicateFaceCount > 0,
      shellExtra: s.extraShellCount > 0,
      shellNoise: s.noiseShellCount > 0,
      openEdge: s.openEdgeCount > 0,
      planarHole: s.planarHoleCount > 0,
      nonManifoldEdge: s.nonManifoldEdgeCount > 0,
      outline: s.openEdgeCount > 0,
    } as Record<keyof ViewportVisibility, boolean>;
  }, [result]);

  const activeLegend = useMemo(
    () => (issuePresent ? LEGEND_ITEMS.filter((i) => issuePresent[i.key]) : []),
    [issuePresent]
  );

  return {
    result,
    busy,
    stage,
    pct,
    error,
    visibility,
    setVisibility,
    focusRequest,
    focusCluster,
    focusPoint,
    issuePresent,
    activeLegend,
  };
}
