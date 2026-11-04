/// <reference lib="webworker" />
/**
 * 智能摆盘 Worker —— 把「625 个候选姿态 × 包裹支撑体积」的搜索搬离主线程。
 *
 * 为什么要有这个 Worker:
 * - 焊接 + 建拓扑(网格去重、边-面映射)是 O(n) 的重活,大模型能跑几百毫秒
 *   到几秒;
 * - 摆盘要在 25×25 = 625 个姿态上各算一遍支撑体积(每个姿态 = 旋转网格 +
 *   按列求交),一个中等模型(1.4 万面)就要 2 秒,大模型 10 秒打底。
 *
 * 这两段都在主线程上跑的话,用户点「智能摆盘」之后整页卡死 —— 按钮点不动、
 * 滑块拖不动、动画停住。搬到 Worker 里之后主线程始终是闲的,只有进度条在动。
 *
 * Worker 内部持有焊接好的模型(按 `modelId` 分),主线程只发「算这个姿态」
 * 「搜最优姿态」这类指令 —— 几何不用来回搬。
 *
 * 消息处理逻辑在 `lib/angle-optimizer-handler.ts` 里(跟测试共用),
 * 这里只当入口。
 */
import { handleAngleWorkerMessage } from "@/features/pricing/lib/angle-optimizer-handler";
import type {
  AngleWorkerIn,
  AngleWorkerOut,
} from "@/features/pricing/lib/angle-optimizer-protocol";

function post(msg: AngleWorkerOut) {
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (e: MessageEvent<AngleWorkerIn>) => {
  handleAngleWorkerMessage(e.data, post);
};
