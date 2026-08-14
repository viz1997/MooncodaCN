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
 * 停滞自动停止阈值：5 分钟。
 *
 * 超过这个时间没收到服务端更新（updatedAt 与上次快照相同）→ 客户端
 * watchdog 自动调 stopGeneration，等价于"自动失败"：订单会被置
 * FAILED，走 FailureNotice 的"重新生成全部"复活路径。
 *
 * 阈值与 ORDER_DEADLINE_MS（服务端硬超时 5 min）对齐——保证：
 * - 客户端路径：watchdog 先到 5 分钟就停，用户感知 < 服务端最坏情况
 * - 服务端路径：即便前端 watchdog 没跑起来（如浏览器崩溃、tab 冻），
 *   下一次 /poll 进入 advance-generation.ts 也会被硬超时命中
 *
 * 不需要再加 STALL_HINT_MS 渐进提示——watchdog 本身就是动作，
 * 不留"再等等自己可能好"的窗口。
 *
 * 早期版本用 2 分钟，但 2026-08-13 把上传 / Lingting submit / Lingting
 * CDN 下载三个超时统一升到 60s 后，最坏链路（R2 60s + Lingting 60s +
 * Lingting P99 180s = 300s = 5 min）会让 2 min watchdog 误判——把
 * 用户感知窗口扩到 5 min 与服务端 deadline 对齐。
 */
const STALL_HINT_MS = 5 * 60_000;

/**
 * 「假进度」上限：99%。
 *
 * 业界主流做法：拿到首张真实结果前，UI 不能停在 0%，要"看起来在跑"；
 * 但又不能假装跑到 100%，否则用户以为已结束。我们用 RAF 平滑推进到
 * 这个上限就停住，剩下的 1% 等真实 done 比例拉到 100% 时直接 100%。
 *
 * 原版用 95%——用户反馈"卡在 95% 等真实进度"感觉像被卡住了，留 5% 给真实
 * 比例太宽。99% 让假进度一路几乎跑到顶，最坏情况（极慢上游）下用户看到
 * 99% 等真实 100%，视觉差只有 1%，体感上"假进度几乎完整跑完了，剩下的
 * 是真实完成度接管"，不再有"卡住"的错觉。
 */
const FAKE_PROGRESS_CAP = 99;

/**
 * 假进度爬升到 cap 所需的时间：90 秒。
 *
 * 原 240s 太长——单图 P50 ≈ 60s、P99 ≈ 180s，240s 窗口下前 30s 用户只
 * 看到 0%→31%，节奏过慢容易让人误以为卡死。90s 让前 30s 推到 ~50%，
 * 既给单图/多图并行都留足缓冲，又让用户在前 30s 内明显看到数字推进。
 */
const FAKE_PROGRESS_WINDOW_MS = 90_000;

/**
 * GENERATING 起始「首轮真实查询时刻」相对 updatedAt 的偏移：15 秒。
 *
 * 与 useOrder 的 POLL_SCHEDULE_MS[0] 同值（也镜像到 useOrder 的
 * QUIET_AFTER_GENERATING_MS）——必须保持一致，否则假进度节奏会和
 * /poll 调度表错位。
 *
 * 镜像写一份避免引入跨模块常量依赖（generate-step 不应反向依赖
 * use-order 的内部常量）。
 *
 * 此处仅用于把假进度起点对齐到首轮查询起点（= quietEndsAt - 15s），
 * 保证用户中途切页 / 刷新后进度从一致位置继续。
 */
const QUIET_AFTER_GENERATING_MS = 15_000;

/**
 * 「起步偏移」：把 fakeStart 永远向前推 2.5s，让 RAF 首帧就把
 * displayPercent 推到 ~3%，避免 ease-out-cubic 起步阶段（t≈0）的亚百分点
 * 被 Math.round 卡在 "0%" 一段时间看不出动静。
 *
 * 原版只对 fallback 路径（quietStartMs 不可用）应用偏移，但实测 normal 路径
 * 里 quietStartMs ≈ updatedAt ≈ 服务端刚刚写的时刻，到客户端首帧之间只过
 * 100ms-1s，elapsed 仍是亚百分点——进度条照样停在 0%。现在统一应用偏移，
 * 首帧 elapsed=2500ms → t≈0.028 → eased≈0.082 → next≈7.8%（90s 窗口），
 * 进入即显示 "8%"，用户立刻看到数字跳变。
 */
const INITIAL_FAKE_OFFSET_MS = 2_500;

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
  // done 计数到 uploadedImageCount 时越界（没有"第 uploadedCount+1 张"），
  // 选最后一张原图作为成品预览图。clamp 到 [0, uploadedImageCount-1]。
  const previewIdx = isAllDone
    ? uploadedImageCount - 1
    : Math.min(done, uploadedImageCount - 1);

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
      // 节奏和上层 /poll 跳过窗口同步；上层未提供（mock / 老订单 / brief
      // regen window）时退化到 Date.now()。
      //
      // ⚠️ **两条路都用 Date.now()（epoch ms）**，不要用 performance.now()。
      // useOrder 的 quietEndsAt 来自服务端 updatedAt 的 Date.now() 值（如
      // 1755000000000），而 RAF 回调的 `now` 是 performance.now()（页内
      // 相对 ms，如 5000）——两者**不在同一时间基**，now - start 会是巨大
      // 负值，下面的 Math.max(0, ...) 把它钳到 0，导致假进度永远停在 0%
      // （用户反馈"进度百分比还是 0%"）。统一用 Date.now() 后 start 与
      // 当前时刻同时间基，elapsed 正常推进。
      //
      // 不论哪条路，**都**把 start 向前推 INITIAL_FAKE_OFFSET_MS：
      // ease-out-cubic 起步阶段（t≈0）的小增量会被 Math.round 卡在 0% 一段时间
      // 看不出动静。统一偏移保证首帧 elapsed=2.5s，next ≈ 7-8%（90s 窗口），
      // 用户进入即看到数字跳变。
      const quietStartMs =
        quietEndsAt !== null ? quietEndsAt - QUIET_AFTER_GENERATING_MS : null;
      const baseStartMs = quietStartMs !== null ? quietStartMs : Date.now();
      fakeStartRef.current = baseStartMs - INITIAL_FAKE_OFFSET_MS;
    }
    let rafId = 0;
    const tick = (_now: number) => {
      // 同上：必须用 Date.now() 与 start 同时间基（epoch ms），不能用 RAF
      // 传入的 performance.now()。
      const start = fakeStartRef.current ?? Date.now();
      const elapsed = Math.max(0, Date.now() - start);
      // 90 秒跑到 FAKE_PROGRESS_CAP；ease-out-cubic 曲线，前快后慢
      const t = Math.min(1, elapsed / FAKE_PROGRESS_WINDOW_MS);
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
        <h2 className="text-xl font-bold text-stone-900">
          {isAllDone ? "生成完成" : "正在生成效果图"}
        </h2>
        <p className="mt-1 text-sm text-stone-400">
          {isAllDone
            ? `全部 ${uploadedImageCount} 张候选已就绪`
            : `第 ${done + 1} 张原图`}
        </p>
      </div>

      {/* 原图缩略图（点击放大预览） */}
      <button
        type="button"
        onClick={() => uploadedImageCount > 0 && setOriginalPreviewOpen(true)}
        disabled={uploadedImageCount === 0}
        aria-label={
          uploadedImageCount > 0
            ? `放大查看第 ${previewIdx + 1} 张原图`
            : "尚未上传原图"
        }
        className="group relative mb-6 h-28 w-28 overflow-hidden rounded-xl bg-stone-100 shadow-sm ring-2 ring-stone-200 transition-shadow hover:ring-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed"
      >
        {uploadedImageCount > 0 ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
            <img
              src={originalUrl(token, previewIdx, updatedAt)}
              alt={
                isAllDone
                  ? `已生成 ${uploadedImageCount} 张候选`
                  : `正在处理第 ${done + 1} 张原图`
              }
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
