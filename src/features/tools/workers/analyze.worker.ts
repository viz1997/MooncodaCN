/// <reference lib="webworker" />
/**
 * 模型分析 Worker:避免大网格分析阻塞 UI。
 *
 * 移植自 wjp-model-checker-source/src/workers/analyze.worker.ts,只改了 import 路径
 * 与消息体形状(直接传 positions + fileName,不再包一层 RawMesh)。
 */
import { analyzeNewMesh } from "@/features/tools/lib/mesh/analyze";
import type {
  WorkerInMessage,
  WorkerOutMessage,
} from "@/features/tools/lib/mesh/types";

function post(msg: WorkerOutMessage) {
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type !== "analyze") return;
  const { seq, positions, fileName, liftMm, baseMarginMm } = msg;
  try {
    const { result } = analyzeNewMesh(
      positions,
      fileName,
      (stage, pct) => post({ type: "progress", seq, stage, pct }),
      liftMm,
      baseMarginMm
    );
    post({ type: "result", seq, result });
  } catch (err) {
    post({
      type: "error",
      seq,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
