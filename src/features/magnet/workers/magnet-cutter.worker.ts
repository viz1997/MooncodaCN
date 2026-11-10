/// <reference lib="webworker" />
/**
 * 磁吸孔切割 Worker —— 把「焊接 + 布尔运算」搬离主线程。
 *
 * 为什么要有这个 Worker:
 * - 焊接 + 建拓扑(网格去重、边-面映射)是 O(n) 的重活,大模型能跑几百毫秒
 *   到几秒;
 * - 布尔运算(Manifold3D)对大模型要跑好几秒;
 * - **wasm 编译**本身也要几百毫秒。
 *
 * 这些都在主线程上跑的话,用户点「切磁吸孔」之后整页卡死 —— 按钮点不动、
 * 滑块拖不动、动画停住。搬到 Worker 里之后主线程始终是闲的。
 *
 * wasm 从 `/manifold.wasm` 拿(`scripts/copy-manifold-wasm.ts` 拷进 `public/`
 * 的,产物提交进仓库)。
 *
 * 消息处理逻辑在 `lib/magnet-cutter-handler.ts` 里(跟测试共用),
 * 这里只当入口。
 */
import { handleMagnetWorkerMessage } from "@/features/magnet/lib/magnet-cutter-handler";
import type {
  MagnetWorkerIn,
  MagnetWorkerOut,
} from "@/features/magnet/lib/magnet-cutter-protocol";

function post(msg: MagnetWorkerOut) {
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (e: MessageEvent<MagnetWorkerIn>) => {
  handleMagnetWorkerMessage(e.data, post);
};
