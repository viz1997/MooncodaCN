"use client";

import { AlertTriangle, ImageIcon, Pause, StopCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { originalUrl } from "./image-urls";
import { formatEta } from "./order-lib";

interface GenerateStepProps {
  token: string;
  updatedAt: string;
  uploadedImageCount: number;
  /** 服务端已写入的效果组数 —— 真实进度，不是估算 */
  readyGroups: number;
  candidateCount: number;
  uploadedAt: string | null;
  /** 停止中——禁用按钮防止重复点击 */
  stopping?: boolean;
  /** "停止生成"是协作式打断当前 in-flight 的生成任务，订单保留 */
  onStopClick?: () => void;
  /**
   * GENERATING 起始「安静期」结束时刻（ms epoch）。与 useOrder 共享同一时间源，
   * 用于：(1) 让假进度 RAF 从一致的起点开始推；(2) 30s 内前端明确显示
   * "假进度"，不做任何上游真实进度断言；(3) 窗口结束后由上层决定
   * 是否轮询 /poll。null = 视作窗口已结束（mock / 旧订单回放）。
   */
  quietEndsAt: number | null;
}

/**
 * ETA fallback 单张耗时估值：90s。
 *
 * 旧值 30s/张在 GPT-Image-2 上游真实 60-180s 下会早早归零显示成 0，
 * 与 ORDER_DEADLINE_MS 10min 配合后 ETA 会显示 "0s" 误导用户。
 * 仅在没有任何 readyGroups 真实数据时作为兜底。
 */
const DEFAULT_PER_IMAGE_MS = 90_000;

/**
 * 停滞提示阈值：5 分钟。
 *
 * 超过这个时间没收到服务端更新（updatedAt 与上次快照相同）→ 提示用户
 * 主动点「停止生成」，避免干等。仅展示提示，不改 status——状态收敛
 * 由 advance-generation.ts 的硬超时独占，避免用户还在等时被前端抢先判死。
 */
const STALL_HINT_MS = 5 * 60_000;

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
 * 期间 useOrder 不打 /poll，前端只播假进度（indeterminate 滑光带），
 * 不显示任何数字进度，避免上游仍为 0 时给用户"假数字"误导。
 */
const QUIET_AFTER_GENERATING_MS = 30_000;

/**
 * 估算剩余时间（秒）
 * 优先用真实数据：elapsed / readyGroups = 单张耗时均值；没有 readyGroups 时退到默认 30s/张。
 */
function estimateEtaSec(
  uploadedAt: string | null,
  uploadedImageCount: number,
  readyGroups: number
): number {
  const remaining =
    uploadedImageCount - Math.min(readyGroups, uploadedImageCount);
  if (remaining <= 0) return 0;
  const perImageMs =
    uploadedAt && readyGroups > 0
      ? (Date.now() - new Date(uploadedAt).getTime()) / readyGroups
      : DEFAULT_PER_IMAGE_MS;
  return Math.max(1, Math.ceil((remaining * perImageMs) / 1000));
}

/**
 * 生成步骤 —— mobile-first 单列布局 + 横向进度条（业界主流"假进度"）。
 *
 * 设计参考 generate-step.tsx：
 * - 第 2 步徽章 + 标题 + ETA 副标题
 * - 原图缩略图（卡片圆角）
 * - 横向进度条：
 *   - 未拿到 readyGroups 时显示 indeterminate 滑光带
 *   - 拿到真实比例后用 ease-out 平滑推到 FAKE_PROGRESS_CAP 等真结果
 *   - 真实完成（100%）时滑满
 * - 3 个跳动圆点
 * - "停止生成" outline 按钮
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
  uploadedAt,
  stopping = false,
  onStopClick,
  quietEndsAt,
}: GenerateStepProps) {
  const done = Math.min(readyGroups, uploadedImageCount);
  const realPercent =
    uploadedImageCount > 0 ? (done / uploadedImageCount) * 100 : 0;
  const isAllDone = uploadedImageCount > 0 && done >= uploadedImageCount;
  const remaining = Math.max(0, uploadedImageCount - done);

  /**
   * 是否在 GENERATING 起始「安静期」内。
   * 与 useOrder 的 30s 跳过 /poll 窗口共用同一时间源——前端在此期间
   * 只播假进度，不显示任何"真实"进度（避免被服务端仍为 0/未刷新的
   * readyGroups 误导）。窗口结束后恢复 determinate 行为。
   */
  const inQuietWindow =
    !isAllDone && quietEndsAt !== null && Date.now() < quietEndsAt;

  // ETA 每秒刷新一次
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [remaining]);

  const etaSec = estimateEtaSec(uploadedAt, uploadedImageCount, readyGroups);

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

  // 停滞提示：updatedAt 超过 STALL_HINT_MS 未刷新 + 还有未完成张图
  // → amber 内联提示 + 一次性 toast.warning（latch 防重复弹）。
  // 仅展示，不改 status：状态收敛由服务端前置硬超时独占。
  const stalledMs = Date.now() - new Date(updatedAt).getTime();
  const stalled = remaining > 0 && stalledMs > STALL_HINT_MS;
  const stalledToastShownRef = useRef(false);
  useEffect(() => {
    if (!stalled || stalledToastShownRef.current) return;
    stalledToastShownRef.current = true;
    toast.warning(
      "已等待较长时间。若长时间无进展，可点「停止生成」取消本次重试",
      { duration: 6000 }
    );
  }, [stalled]);

  // 安静期内强制 indeterminate（滑光带），不显示任何百分比数字——
  // 上游此时还没真正跑，前端不该给"假数字"误导用户。
  const showIndeterminate = inQuietWindow || (done === 0 && !isAllDone);

  return (
    <section className="flex flex-col items-center px-5 pt-6 pb-8 animate-[fadeIn_.3s_ease-out]">
      {/* 标题 */}
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-stone-900">正在生成效果图</h2>
        <p className="mt-1 text-sm text-stone-400">
          第 {done + 1} 张原图
          {etaSec > 0 && (
            <span className="text-stone-300"> · {formatEta(etaSec)}</span>
          )}
        </p>
      </div>

      {/* 原图缩略图 */}
      <div className="mb-6 h-28 w-28 overflow-hidden rounded-xl bg-stone-100 shadow-sm ring-2 ring-stone-200">
        {uploadedImageCount > 0 ? (
          /* biome-ignore lint/performance/noImgElement: R2 远程 URL */
          <img
            src={originalUrl(token, done, updatedAt)}
            alt={`正在处理第 ${done + 1} 张原图`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-300">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
      </div>

      {/* 横向进度条：indeterminate 滑光带 → determinate 平滑增长 */}
      <div
        className="mb-2 w-full max-w-[260px]"
        role="progressbar"
        aria-label="生成进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayPercent)}
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
          {showIndeterminate ? (
            // 拿到首张真实结果前的滑光带：30% 宽渐变条循环扫过
            <div
              className="absolute inset-y-0 left-0 w-[30%] animate-indeterminate-progress bg-gradient-to-r from-transparent via-indigo-500 to-transparent"
              style={{ willChange: "transform" }}
            />
          ) : (
            <div
              className="h-full animate-progress-ease rounded-full bg-gradient-to-r from-indigo-500 to-blue-500"
              style={{ width: `${displayPercent}%` }}
            />
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-stone-400">
          <span>
            {showIndeterminate ? "正在处理…" : `${Math.round(displayPercent)}%`}
          </span>
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
              <span>
                已等待超过 5 分钟。如长时间无进展，可点「停止生成」取消本次重试
              </span>
            </output>
          )}
          <button
            type="button"
            onClick={onStopClick}
            disabled={stopping}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
          >
            <StopCircle className="h-3.5 w-3.5" />
            {stopping ? "停止中…" : "停止生成"}
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
    </section>
  );
}
