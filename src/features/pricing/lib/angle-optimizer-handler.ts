/**
 * 摆盘 Worker 的消息处理 —— Worker 入口和测试共用同一份逻辑。
 *
 * 为什么单独拆一个模块:Worker 入口文件(`workers/angle-optimizer.worker.ts`)
 * 一 import 就会接管 `self.onmessage`,在 Node 里没法直接测。拆开之后
 * 测试能直接调 `handleAngleWorkerMessage`,把「load → pose → search」
 * 这条链路(初始角度的支撑就走 `pose`)钉死。
 *
 * Worker 内部持有焊接好的模型(按 `modelId` 分),主线程只发「算这个姿态」
 * 「搜最优姿态」这类指令 —— 几何不用来回搬。
 */
import {
  computeSupportAtPose,
  findOptimalAngle,
} from "@/features/pricing/lib/angle-optimizer";
import type {
  AngleWorkerIn,
  AngleWorkerOut,
} from "@/features/pricing/lib/angle-optimizer-protocol";
import {
  prepareSupportModel,
  type SupportModel,
  scaleSupportModel,
} from "@/features/tools/lib/mesh/support-shell";

/** 焊接好的模型 —— 按 modelId 存,主线程换模型时换 id */
const models = new Map<string, SupportModel>();

/**
 * 处理一条 Worker 指令
 *
 * @param msg 主线程发来的指令
 * @param post 回主线程(Worker 里是 `self.postMessage`,测试里是数组收集)
 */
export function handleAngleWorkerMessage(
  msg: AngleWorkerIn,
  post: (out: AngleWorkerOut) => void
): void {
  try {
    if (msg.type === "load") {
      // 焊接 + 拓扑:CPU 密集,放在 Worker 里
      // 自检摘要也在这一步出 —— 吃的就是刚焊出来的那份拓扑,不多焊一次
      const model = prepareSupportModel(msg.positions, {
        fileName: msg.fileName,
      });
      models.set(msg.modelId, model);
      post({
        type: "loaded",
        seq: msg.seq,
        modelId: msg.modelId,
        summary: model.summary,
      });
      return;
    }

    const base = models.get(msg.modelId);
    if (!base) {
      post({
        type: "error",
        seq: msg.seq,
        message: "模型还没交给 Worker(先发 load)",
      });
      return;
    }

    if (msg.type === "pose") {
      // 缩放只挪顶点,拓扑不变 —— 每次按当前尺寸派生一份
      const scaled = scaleSupportModel(
        base,
        msg.scales[0],
        msg.scales[1],
        msg.scales[2]
      );
      const result = computeSupportAtPose(
        scaled,
        msg.rotX,
        msg.rotY,
        msg.rotZ,
        msg.params,
        { withShell: msg.withShell === true }
      );
      post({ type: "pose", seq: msg.seq, result });
      return;
    }

    if (msg.type === "search") {
      const scaled = scaleSupportModel(
        base,
        msg.scales[0],
        msg.scales[1],
        msg.scales[2]
      );
      const result = findOptimalAngle(
        scaled,
        (percent) => post({ type: "progress", seq: msg.seq, percent }),
        msg.maxHeightMM,
        msg.modelWeightG,
        undefined,
        false,
        msg.params
      );
      post({ type: "search", seq: msg.seq, result });
      return;
    }
  } catch (err) {
    post({
      type: "error",
      seq: msg.seq,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
