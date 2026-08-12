"use client";

import {
  AlertTriangle,
  ImageIcon,
  Maximize2,
  Pause,
  StopCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { originalUrl } from "./image-urls";
import { OriginalLightbox } from "./original-lightbox";

interface GenerateStepProps {
  token: string;
  updatedAt: string;
  uploadedImageCount: number;
  /** 服务端已写入的效果组数 —— 真实进度，不是估算 */
  readyGroups: number;
  candidateCount: number;
  /** 停止中——禁用按钮防止重复点击 */
  stopping?: boolean;
  /** "停止生成"是协作式打断当前 in-flight 的生成任务，订单保留 */
  onStopClick?: () => void;
  /**
   * GENERATING 起始「安静期」结束时刻（ms epoch）。与 useOrder 共享同一时间源，
   * 用于让假进度 RAF 从一致的起点开始推（= quietEndsAt - QUIET_AFTER_GENERATING_MS）。
   * null = 视作窗口已结束（mock / 旧订单回放）。
   */
  quietEndsAt: number | null;
}

/**
 * 停滞自动停止阈值：2 分钟。
 *
 * 超过这个时间没收到服务端更新（updatedAt 与上次快照相同）→ 客户端
 * watchdog 自动调 stopGeneration，等价于"自动失败"：订单会被置
 * FAILED，走 FailureNotice 的"重新生成全部"复活路径。
 *
 * 阈值与 ORDER_DEADLINE_MS（服务端硬超时）对齐——保证：
 * - 客户端路径：watchdog 先到 2 分钟就停，用户感知 < 服务端最坏情况
 * - 服务端路径：即便前端 watchdog 没跑起来（如浏览器崩溃、tab 冻），
 *   下一次 /poll 进入 advance-generation.ts 也会被硬超时命中
 *
 * 不需要再加 STALL_HINT_MS 渐进提示——watchdog 本身就是动作，
 * 不留"再等等自己可能好"的窗口。
 */
const STALL_HINT_MS = 2 * 60_000;

/**
 * 「假进度」上限：95%。
 *
 * 业界主流做法：拿到首张真实结果前，UI 不能停在 0%，要"看起来在跑"；
 * 但又不能假装跑到 100%，否则用户以为已结束。我们用 RAF 平滑推进到
 * 这个上限就停住，剩下的 5% 等真实 done 比例拉到 100% 时直接 100%。
 */
const FAKE_PROGRESS_CAP = 95;

/**
 * GENERATING 起始「安静期」长度：30 秒。
 *
 * 与 useOrder 的 QUIET_AFTER_GENERATING_MS 同值——必须保持一致，
 * 否则假进度节奏会和 /poll 跳过窗口错位。镜像写一份避免引入跨模块
 * 常量依赖（generate-step 不应反向依赖 use-order 的内部常量）。
 *
 * 此处仅用于把假进度起点对齐到安静期起点（= quietEndsAt - 30s），
 * 保证用户中途切页 / 刷新后进度从一致位置继续。
 */
const QUIET_AFTER_GENERATING_MS = 30_000;

/**
 * 生成步骤 —— mobile-first 单列布局 + 横向进度条（业界主流"假进度"）。
 *
 * 设计要点：
 * - **从 t=0 起就显示假百分比数字**（不再用 indeterminate 滑光带）——
 *   用户进入即看到进度增长，不用等到上游首张就绪。
 * - **不向用户展示 ETA**：上游耗时 60-180s 波动大，给出"X 秒"会让用户
 *   倒计时到 0 后怀疑系统卡住，索性不显示。
 * - 进度条横向，ease-out 平滑增长：
 *   - done === 0：RAF 假进度从 0 推到 FAKE_PROGRESS_CAP
 *   - done > 0：取 max(fake, real)，不回弹（避免"退步"错觉）
 *   - isAllDone：直接 100%
 *
 * 注意：这里的"停止"是协作式打断当前 in-flight 的生成任务，订单保留；
 * 不等于"取消订单"——后者会置订单为 CANCELLED（终态），由 TopBar 的取消按钮触发。
 */
export function GenerateStep({
  token,
  updatedAt,
  uploadedImageCount,
  readyGroups,
  candidateCount,
  stopping = false,
  onStopClick,
  quietEndsAt,
}: GenerateStepProps) {
  const done = Math.min(readyGroups, uploadedImageCount);
  const realPercent =
    uploadedImageCount > 0 ? (done / uploadedImageCount) * 100 : 0;
  const isAllDone = uploadedImageCount > 0 && done >= uploadedImageCount;
  const remaining = Math.max(0, uploadedImageCount - done);

  // 原图预览灯箱：点击正在处理的缩略图打开，可左右翻看本批所有原图
  const [originalPreviewOpen, setOriginalPreviewOpen] = useState(false);
  const previewIdx = done;

  /**
   * 假进度 RAF 循环。
   *
   * - mounted 后从 0 平滑 ease-out-cubic 推到 FAKE_PROGRESS_CAP
   *   （约 4 分钟跑满——配合下游 P99 60-180s 单张，剩余张数会先到达 100%，
   *    视觉节奏不显拖）。
   * - 一旦拿到真实进度（done > 0 或 allDone），立刻锚定到真实比例——
   *   若真实 < 当前假进度则保留假进度（不回弹），否则取 max 后 ease-out 推。
   * - 全部完成（isAllDone）→ 直接 100%。
   *
   * 用 max 策略的核心原因：上游可能先回报 partial done，例如 done=1/4=25%，
   * 此时 fake 已跑到 60%——立刻拉到 25% 会让用户觉得"退步了"。保留更大值，
   * 等下一张 ready 时再被真实比例覆盖（用 ease-out 动画）。
   */
  const [displayPercent, setDisplayPercent] = useState(0);
  const fakeStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (isAllDone) {
      setDisplayPercent(100);
      fakeStartRef.current = null;
      return;
    }
    if (done > 0) {
      // 真实进度锚定：取 max，防止回弹
      setDisplayPercent((prev) => Math.max(prev, realPercent));
      fakeStartRef.current = null;
      return;
    }
    // done === 0：启动/重置 RAF 假进度。
    // displayPercent 进入依赖后，每次 RAF 推进都会让 effect 重跑——但 RAF 内部
    // 用函数式 setState 比较 next > prev 才写，已在极限（cap）下不会再增加，
    // 所以重跑只在用户手动切页面后从 0 重新开始，或 cap 之前短暂发生几次，
    // 不会出现循环风暴。
    if (fakeStartRef.current === null) {
      // 起点优先对齐「安静期起点」（= quietEndsAt - 30s），保证假进度
      // 节奏和上层 /poll 跳过窗口同步；上层未提供（mock / 老订单）时退化
      // 为 performance.now()，表现与之前一致。
      const quietStartMs =
        quietEndsAt !== null ? quietEndsAt - QUIET_AFTER_GENERATING_MS : null;
      fakeStartRef.current =
        quietStartMs !== null
          ? quietStartMs
          : performance.now() - (displayPercent / FAKE_PROGRESS_CAP) * 240_000;
    }
    let rafId = 0;
    const tick = (now: number) => {
      const start = fakeStartRef.current ?? now;
      const elapsed = now - start;
      // 240 秒跑到 FAKE_PROGRESS_CAP；ease-out-cubic 曲线，前快后慢
      const t = Math.min(1, elapsed / 240_000);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.min(FAKE_PROGRESS_CAP, eased * FAKE_PROGRESS_CAP);
      setDisplayPercent((prev) => (next > prev ? next : prev));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isAllDone, done, realPercent, displayPercent, quietEndsAt]);

  // 停滞 watchdog：updatedAt 超过 STALL_HINT_MS 未刷新 + 还有未完成张图
  // → 自动调 onStopClick()（= stopGeneration），把订单置 FAILED。
  //
  // 等价于"自动失败"：状态收敛到 FAILED 后，前端进入 FailureNotice，
  // 用户点"重新生成全部"复活。不需要用户手动操作。
  //
  // latch 防止组件在多个 render 周期里重复触发 stopGeneration。
  const stalledMs = Date.now() - new Date(updatedAt).getTime();
  const stalled = remaining > 0 && stalledMs > STALL_HINT_MS;
  const autoStopFiredRef = useRef(false);
  useEffect(() => {
    if (!stalled || autoStopFiredRef.current) return;
    if (!onStopClick) return;
    autoStopFiredRef.current = true;
    toast.warning("已超过 2 分钟无进展，自动停止本次生成", { duration: 5000 });
    void onStopClick();
  }, [stalled, onStopClick]);

  return (
    <section className="flex flex-col items-center px-5 pt-6 pb-8 animate-[fadeIn_.3s_ease-out]">
      {/* 标题 */}
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-stone-900">正在生成效果图</h2>
        <p className="mt-1 text-sm text-stone-400">第 {done + 1} 张原图</p>
      </div>

      {/* 原图缩略图（点击放大预览） */}
      <button
        type="button"
        onClick={() => uploadedImageCount > 0 && setOriginalPreviewOpen(true)}
        disabled={uploadedImageCount === 0}
        aria-label={
          uploadedImageCount > 0
            ? `放大查看第 ${done + 1} 张原图`
            : "尚未上传原图"
        }
        className="group relative mb-6 h-28 w-28 overflow-hidden rounded-xl bg-stone-100 shadow-sm ring-2 ring-stone-200 transition-shadow hover:ring-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed"
      >
        {uploadedImageCount > 0 ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
            <img
              src={originalUrl(token, done, updatedAt)}
              alt={`正在处理第 ${done + 1} 张原图`}
              className="h-full w-full object-cover"
            />
            {/* hover 时浮出放大图标，明确可点击 */}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-colors group-hover:bg-black/30 group-focus-visible:bg-black/30 group-hover:opacity-100 group-focus-visible:opacity-100">
              <Maximize2 className="h-5 w-5 text-white drop-shadow" />
            </span>
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-300">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
      </button>

      {/* 横向进度条：从 t=0 起就显示假百分比（不再用 indeterminate 滑光带） */}
      <div
        className="mb-2 w-full max-w-[260px]"
        role="progressbar"
        aria-label="生成进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayPercent)}
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full animate-progress-ease rounded-full bg-gradient-to-r from-indigo-500 to-blue-500"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-stone-400">
          <span>{Math.round(displayPercent)}%</span>
          <span>
            {done}/{uploadedImageCount}
          </span>
        </div>
      </div>

      {/* 跳动圆点 */}
      <div className="mt-3 mb-5 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>

      {/* 进度明细 */}
      <p className="mb-4 text-center text-xs text-stone-500 tabular-nums">
        {done}/{uploadedImageCount} 张已完成
        {uploadedImageCount > 1 && (
          <span className="ml-1 text-stone-400">
            · {candidateCount} 宫格 × {uploadedImageCount} 张
          </span>
        )}
      </p>

      {/* 停止按钮 */}
      {onStopClick && (
        <>
          {stalled && (
            <output className="mb-3 inline-flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>已超过 2 分钟无进展，正在自动停止本次生成…</span>
            </output>
          )}
          <button
            type="button"
            onClick={onStopClick}
            disabled={stopping || stalled}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
          >
            <StopCircle className="h-3.5 w-3.5" />
            {stopping ? "停止中…" : stalled ? "自动停止中…" : "停止生成"}
          </button>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-stone-400">
            <Pause className="h-2.5 w-2.5" />
            停止不会取消订单，可在下一步重新发起
          </p>
        </>
      )}

      <p aria-live="polite" className="sr-only">
        已完成 {done} 张，共 {uploadedImageCount} 张
      </p>

      {/* 原图预览灯箱 */}
      <OriginalLightbox
        open={originalPreviewOpen}
        onClose={() => setOriginalPreviewOpen(false)}
        token={token}
        updatedAt={updatedAt}
        imageIdx={previewIdx}
        imageCount={uploadedImageCount}
      />
    </section>
  );
}
