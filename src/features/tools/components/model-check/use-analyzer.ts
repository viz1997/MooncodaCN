"use client";

/**
 * 分析器 Hook:管理 Web Worker 生命周期、进度与结果。
 *
 * 移植自 wjp-model-checker-source/src/components/model-checker/useAnalyzer.ts,
 * 追加两点:
 * - **seq 防串号**:每次分析带一个递增序号,过期结果直接丢弃(快速切换模型时不串);
 * - **主线程兜底**:worker 构造失败 / 脚本加载失败时自动降级为主线程调用
 *   `analyzeNewMesh()`,功能不缺,只是分析期间界面会短暂无响应。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeNewMesh } from "@/features/tools/lib/mesh/analyze";
import type {
  AnalysisResult,
  MessageRef,
  ProgressStage,
  WorkerOutMessage,
} from "@/features/tools/lib/mesh/types";

export interface AnalyzerState {
  busy: boolean;
  /** 当前阶段,UI 层按 locale 翻译 */
  stage: ProgressStage | null;
  /** 0-100 */
  pct: number;
  result: AnalysisResult | null;
  /** 结构化错误(UI 层翻译) */
  error: MessageRef | null;
}

export interface AnalyzerInput {
  /** 三角汤,9 floats / 三角面 */
  positions: Float32Array;
  fileName: string;
  /**
   * 托底高度 (mm) —— 支撑外壳的平台平面在模型最低点下方多远
   *
   * 不传 = `SUPPORT_LIFT_MM`(5mm)。**跟随后台**
   * (`/admin/print-pricing`)—— 模型检查页画的支撑跟克重工具算的必须是
   * 同一个几何。
   */
  liftMm?: number | undefined;
  /**
   * 底板留边 (mm) —— 底板比模型轮廓四周各留多宽
   *
   * 不传 = `SUPPORT_BASE_MARGIN_MM`(5mm)。**跟随后台**
   * (`/admin/print-pricing`)—— 检查视角画的底板跟克重工具算的支撑克重
   * 必须是同一个几何(那一圈边也是实心支撑,算进克重)。
   */
  baseMarginMm?: number | undefined;
}

export function useAnalyzer() {
  const [state, setState] = useState<AnalyzerState>({
    busy: false,
    stage: null,
    pct: 0,
    result: null,
    error: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  /** 已经降级到主线程,不再尝试重建 worker */
  const degradedRef = useRef(false);
  /** 最近一次分析的输入,worker 崩了要拿它重跑 */
  const inputRef = useRef<AnalyzerInput | null>(null);

  /** 主线程兜底:同步跑一遍分析 */
  const runOnMainThread = useCallback(
    async (input: AnalyzerInput, seq: number) => {
      setState((s) => ({
        ...s,
        busy: true,
        stage: "weld",
        pct: 0,
        error: null,
      }));
      // 先让「分析中」状态绘制出来,再进同步计算
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        const { result } = analyzeNewMesh(
          input.positions,
          input.fileName,
          (stage, pct) => {
            if (seqRef.current !== seq) return;
            setState((s) => ({ ...s, busy: pct < 100, stage, pct }));
          },
          input.liftMm,
          input.baseMarginMm
        );
        if (seqRef.current !== seq) return;
        setState({
          busy: false,
          stage: "done",
          pct: 100,
          result,
          error: null,
        });
      } catch (err) {
        if (seqRef.current !== seq) return;
        setState((s) => ({
          ...s,
          busy: false,
          error: {
            key: "errors.analysisFailed",
            params: {
              detail: err instanceof Error ? err.message : String(err),
            },
          },
        }));
      }
    },
    []
  );

  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    if (degradedRef.current) return null;
    try {
      // ⚠️ `new URL(..., import.meta.url)` 必须是字面量,打包器才能静态分析出 worker 入口
      const worker = new Worker(
        new URL("../../workers/analyze.worker.ts", import.meta.url)
      );
      worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
        const msg = e.data;
        if (msg.seq !== seqRef.current) return; // 过期结果
        if (msg.type === "progress") {
          setState((s) => ({
            ...s,
            busy: msg.pct < 100,
            stage: msg.stage,
            pct: msg.pct,
          }));
        } else if (msg.type === "result") {
          setState({
            busy: false,
            stage: "done",
            pct: 100,
            result: msg.result,
            error: null,
          });
        } else if (msg.type === "error") {
          setState((s) => ({
            ...s,
            busy: false,
            error: {
              key: "errors.analysisFailed",
              params: { detail: msg.message },
            },
          }));
        }
      };
      worker.onerror = () => {
        // worker 脚本加载失败 / 运行崩溃:降级到主线程重跑
        const seq = seqRef.current;
        const input = inputRef.current;
        degradedRef.current = true;
        workerRef.current?.terminate();
        workerRef.current = null;
        if (!input) return;
        void runOnMainThread(input, seq);
      };
      workerRef.current = worker;
      return worker;
    } catch {
      // 浏览器不支持 Worker / 打包配置没产出 worker chunk
      degradedRef.current = true;
      workerRef.current = null;
      return null;
    }
  }, [runOnMainThread]);

  const run = useCallback(
    (input: AnalyzerInput) => {
      const seq = ++seqRef.current;
      inputRef.current = input;
      setState((s) => ({
        ...s,
        busy: true,
        stage: "weld",
        pct: 0,
        result: null,
        error: null,
      }));
      const worker = ensureWorker();
      if (!worker) {
        void runOnMainThread(input, seq);
        return;
      }
      worker.postMessage({
        type: "analyze",
        seq,
        positions: input.positions,
        fileName: input.fileName,
        liftMm: input.liftMm,
        baseMarginMm: input.baseMarginMm,
      });
    },
    [ensureWorker, runOnMainThread]
  );

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return { state, run };
}
