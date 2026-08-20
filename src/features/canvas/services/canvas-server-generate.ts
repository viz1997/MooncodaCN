/**
 * 画布内置渠道生成 service —— /api/canvas/generate 与未来可能的 Server Action 共享
 *
 * 职责：
 *  1. 调上游（OpenAI SDK image/audio + axios video async create/poll）
 *  2. R2 永久化（fetch/buffer → putObject → 永久 URL）
 *  3. 积分扣减（**仅 video**）+ 失败回滚（**仅 video**）—— image/audio 不消耗积分
 *
 * 重要不变量：
 *  - **image / audio 不消耗积分**（产品决策 2026-08-20：内置渠道 = 用户带 key 平台代付），
 *    返回 `creditsConsumed: 0` / `transactionId: ""`，调用方不能拿这俩字段做扣费展示
 *  - video 在 create 时 pre-consume（事务原子；不足即抛 InsufficientCreditsError），
 *    poll 内检测到 failure 时回滚；任何抛错都会回滚积分，调用方无需再做
 *  - 同步产物（image / audio）一次函数调用内完成；异步产物（video）拆成 create + poll，
 *    pre-consume 在 create 时扣，poll 内检测到 failure 时回滚
 */

import { randomBytes } from "node:crypto";
import {
  type AccountFrozenError,
  consumeCredits,
  grantCredits,
  type InsufficientCreditsError,
} from "@/features/credits/core";
import {
  isLingtingConfigured,
  type QueryResult,
  queryLingtingTask,
  type SubmitResult,
  submitLingtingTask,
} from "@/features/gpt-image/lib/generation-service";
import { isR2Configured, putObject } from "@/features/image-gen/lib/r2";
import { audioSpeech, imageEdit, imageGeneration } from "@/lib/ai/openai";

import {
  type CanvasCapability,
  calculateCanvasCost,
} from "./canvas-credit-cost";

// ───────────────────────────────────────────────────────────────────────────
// 类型
// ───────────────────────────────────────────────────────────────────────────

export type CanvasRemoteReference = {
  /** data URL 或 R2 公共 URL；service 内部统一 fetch 为 Buffer */
  url: string;
  mimeType?: string;
  name?: string;
};

export type CanvasRemoteGenerateInput = {
  userId: string;
  capability: CanvasCapability;
  mode: "generation" | "edit" | "text";
  model: string;
  prompt: string;
  size?: string;
  quality?: string;
  background?: string;
  n?: number;
  videoSeconds?: number | string;
  voice?: string;
  audioFormat?: string;
  audioSpeed?: number;
  audioInstructions?: string;
  references?: CanvasRemoteReference[];
  mask?: CanvasRemoteReference;
};

export type CanvasRemoteGenerateResult = {
  success: true;
  capability: CanvasCapability;
  items: Array<{
    /** R2 永久 URL —— 前端直接渲染到节点 metadata.content */
    url: string;
    storageKey: string;
    mimeType: string;
    width?: number;
    height?: number;
    bytes: number;
  }>;
  creditsConsumed: number;
  transactionId: string;
};

export type CanvasRemoteVideoCreateResult = {
  success: true;
  jobId: string;
  creditsConsumed: number;
  transactionId: string;
};

// ───────────────────────────────────────────────────────────────────────────
// 工具
// ───────────────────────────────────────────────────────────────────────────

async function fetchToBuffer(
  url: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (url.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/u.exec(url);
    if (!match) throw new Error(`非法 data URL：${url.slice(0, 32)}`);
    const mimeType = match[1];
    const data = match[2];
    if (!mimeType || !data) {
      throw new Error(`非法 data URL：${url.slice(0, 32)}`);
    }
    return {
      mimeType,
      buffer: Buffer.from(data, "base64"),
    };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(
      `下载参考素材失败：HTTP ${res.status}（${url.slice(0, 80)}）`
    );
  }
  const mimeType =
    res.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("opus")) return "opus";
  if (mimeType.includes("mp4")) return "mp4";
  return "png";
}

async function persistBufferToR2(
  buffer: Buffer,
  mimeType: string,
  userId: string,
  prefix: "image" | "audio" | "video"
): Promise<{
  url: string;
  storageKey: string;
  bytes: number;
  mimeType: string;
}> {
  if (!isR2Configured()) {
    throw new Error("R2 未配置：内置渠道生成结果无法持久化");
  }
  const yyyymm = new Date().toISOString().slice(0, 7).replace("-", "");
  const objectKey = `canvas/results/${userId}/${yyyymm}/${prefix}-${randomBytes(8).toString("hex")}.${extFromMime(mimeType)}`;
  const url = await putObject({
    objectKey,
    body: buffer,
    contentType: mimeType,
  });
  return { url, storageKey: objectKey, bytes: buffer.length, mimeType };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "未知错误";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Lingting/WellAPI 提交 + 重试 —— 包装 submitLingtingTask 加 per-image retry，
 * 缓解 Lingting 偶发 cold start 单次超时（AbortError "The operation was
 * aborted due to timeout"），与 image-gen 工作台 gptImage2Adapter 同语义。
 *
 * retries: 0 由内层 submitLingtingTask 已用 Lingting 任务 token 占用
 * —— 重试会拿到新 task_id，重复扣配额。外层 retry 只是 cold start 重试。
 */
async function retrySubmitLingtingTask(
  orderId: string,
  imageUrl: string,
  prompt: string,
  size: string,
  imageIdx: number,
  maxRetries = 2,
  delayMs = 2000
): Promise<SubmitResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await submitLingtingTask(
        orderId,
        imageUrl,
        prompt,
        size,
        imageIdx
      );
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(delayMs);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("submitLingtingTask 失败");
}

/**
 * 把 data URL reference 上传到 R2 拿永久 URL —— WellAPI gpt-image-2
 * 的 /v1/images/edits 需要 multipart 上传，但 submitLingtingTask 内部又会
 * 用 URL fetch 原图。data URL 不能 fetch，所以先在 canvas 这一侧把
 * 用户上传的图转存 R2，再把 R2 URL 喂给 Lingting。
 *
 * 已经是 http(s):// 的视为 R2 公开 URL 直接返回。
 */
async function ensureRemoteUrlForLingting(
  ref: CanvasRemoteReference,
  userId: string
): Promise<string> {
  if (!ref.url.startsWith("data:")) return ref.url;
  const { buffer, mimeType } = await fetchToBuffer(ref.url);
  const persisted = await persistBufferToR2(buffer, mimeType, userId, "image");
  return persisted.url;
}

/**
 * Lingting/WellAPI 异步轮询直到 done / failed / 超时。
 *
 * 与 image-gen 工作台 gptImage2Adapter.queryTask 同语义：每次 queryLingtingTask
 * 都会把 done 的 url 落 R2（内部 persistCandidateToR2 / persistBase64ToR2），
 * 返回的 urls 已经是永久 URL。
 *
 * 超时上限 MAX_POLLS * POLL_INTERVAL_MS = 80s，留 10s 给 submit/上传 ref，
 * 加上 submit/upload ~10-30s 的冷启动，刚好压在 /api/canvas/generate
 * maxDuration=90 的预算内。Inngest 路径走 step.sleep 间隔由 step 调度，
 * 本函数用 setTimeout 直接轮询即可。
 */
const LINGTING_POLL_INTERVAL_MS = 5_000;
const LINGTING_POLL_MAX = 16; // ≈ 80s

async function pollLingtingUntilDone(
  taskId: string,
  orderId: string,
  imageIdx: number
): Promise<string[]> {
  for (let i = 0; i < LINGTING_POLL_MAX; i++) {
    await sleep(LINGTING_POLL_INTERVAL_MS);
    const polled: QueryResult = await queryLingtingTask(
      orderId,
      taskId,
      imageIdx
    );
    if (polled.state === "done") return polled.urls;
    if (polled.state === "failed") {
      throw new Error(polled.error);
    }
  }
  throw new Error(
    "Lingting 生成超时（同步兜底路径 80s 上限，请配置 INNGEST dev server 走异步路径）"
  );
}

/**
 * 把 Lingting 同步/异步返回的 url 转成 canvas items 形态。
 *
 * 关键：submitLingtingTask / queryLingtingTask 内部已经把上游产物
 * 落 R2（persistCandidateToR2 / persistBase64ToR2），返回的 url
 * 已经是 R2 永久 URL，storageKey 这里直接复用 url 字符串（canvas
 * 节点 metadata 用的是 url，不是 storageKey）。
 */
function lingtingUrlsToCanvasItems(
  urls: string[]
): CanvasRemoteGenerateResult["items"] {
  return urls.map((url) => ({
    url,
    storageKey: url,
    mimeType: "image/png",
    bytes: 0,
  }));
}

/**
 * 解析并清理上游错误信息 —— submitLingtingTask 抛的错误形如
 * `Lingting 提交失败：HTTP {status} {body[:200]}`。body 经常是 wellapi
 * 的 Next.js 5xx HTML 错误页（<html id="__next_error__">），整段塞进
 * error.message 既不可读又占体积（4 次失败堆出 600+ 字符）。本 helper：
 *
 *  1. 抽 HTTP status
 *  2. body 优先尝试 JSON.parse（部分上游 5xx 是 JSON），失败则剥 HTML tag
 *  3. 实在没信息就标"upstream 返回空错误体"
 *  4. 截到 300 字符防爆
 */
function cleanUpstreamError(raw: string): string {
  const statusMatch = /HTTP\s+(\d+)/i.exec(raw);
  const status = statusMatch?.[1] ?? "5xx";
  // body 从 "HTTP {status} " 之后开始（s flag 允许跨行）
  const bodyMatch = /HTTP\s+\d+\s+(.*)$/s.exec(raw);
  let body = bodyMatch?.[1] ?? "";

  // 尝试 JSON：上游 5xx 有时是 {"error":{"message":"..."}}
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const msg =
        (parsed.error as { message?: string } | undefined)?.message ??
        (parsed.message as string | undefined) ??
        (parsed.msg as string | undefined);
      if (typeof msg === "string" && msg.length > 0) body = msg;
    } catch {
      // 不是合法 JSON，继续走 HTML 剥除
    }
  }

  // 剥 HTML tag（wellapi 5xx 错误页是 HTML）
  if (body.includes("<")) {
    // 截断检测：submitLingtingTask 抛错时已经 `text.slice(0, 200)` 截断，
    // 若 body 起始是 Next.js HTML 但不含闭合 `>`（如 `<link rel="preload" f`），
    // 剥 `<[^>]+>` 不动，整段丢给 fallback。
    const startsWithHtml = /^\s*<!DOCTYPE|<html\b/i.test(body);
    const hasClosing = body.includes(">");
    if (startsWithHtml && !hasClosing) {
      body =
        "upstream 返回 Next.js HTML 错误页（body 被截断到 200 字符，无 `>` 闭合）";
    } else {
      const stripped = body
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped.length > 0) body = stripped;
    }
  }

  if (body.length < 5) {
    body = "upstream 返回空错误体（HTML 错误页或被截断）";
  }

  return `HTTP ${status} ${body}`.slice(0, 300);
}

/**
 * 把 Lingting submit 阶段的批量失败汇总成单一可读错误。
 *
 * 输入：failures 数组（每项含 index + rejected reason）
 * 输出："Lingting 提交失败（第 1-4 张，HTTP 500）：HTTP 500 ..."
 *
 * 关键处理：
 *  1. **去重**：4 次并行重试往往返同一错误，message 数组要 Set 去重
 *     否则 600+ 字符 HTML 重复 4 遍进 toast
 *  2. **范围压缩**：全部失败用 "1-N"；部分失败用 "1/3/4"（保留 idx 信息）
 *  3. **剥 HTML**：见 cleanUpstreamError
 */
function summarizeLingtingFailures(
  failures: Array<{ i: number; t: PromiseSettledResult<unknown> }>,
  total: number
): Error {
  // 去重 unique error messages（HTML body 同一份只显示一次）
  const cleanedMsgs: string[] = [];
  const seen = new Set<string>();
  for (const f of failures) {
    if (f.t.status !== "rejected") continue;
    const raw =
      f.t.reason instanceof Error ? f.t.reason.message : String(f.t.reason);
    const cleaned = cleanUpstreamError(raw);
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      cleanedMsgs.push(cleaned);
    }
  }

  // 抽 HTTP status 用第一个 failure 的
  const firstReason =
    failures[0]?.t.status === "rejected" ? failures[0].t.reason : null;
  const firstMsg =
    firstReason instanceof Error
      ? firstReason.message
      : String(firstReason ?? "");
  const statusMatch = /HTTP\s+(\d+)/i.exec(firstMsg);
  const status = statusMatch?.[1] ?? "5xx";

  // 范围：全部失败 → "1-N"；部分失败 → "1/3/4"
  const failedIdxs = failures.map((x) => x.i + 1);
  const range =
    failedIdxs.length === total ? `1-${total}` : failedIdxs.join("/");

  return new Error(
    `Lingting 提交失败（第 ${range} 张，HTTP ${status}）：${cleanedMsgs.join("；")}`
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 同步产物（image / audio / text）
// ───────────────────────────────────────────────────────────────────────────

export async function generateOnServerSync(
  input: CanvasRemoteGenerateInput
): Promise<CanvasRemoteGenerateResult> {
  if (input.capability === "video") {
    throw new Error("video 必须走异步 create + poll 路径，不支持 sync");
  }

  // image / audio 路径不消耗积分（产品决策 2026-08-20）：
  // 内置渠道 = 用户带 key 平台代付，不扣用户积分。
  // video 路径在 createVideoOnServer 里独立 pre-consume。

  try {
    // 调上游
    const items: CanvasRemoteGenerateResult["items"] = [];

    if (input.capability === "image") {
      const n = input.n ?? 1;
      const isEdit =
        input.mode === "edit" && (input.references?.length ?? 0) > 0;
      // 走 Lingting/WellAPI 的 image 路径 —— 与 image-gen 工作台
      // gptImage2Adapter 同源。原因：用户用 wellapi，OpenAI SDK 直连
      // 撞 undici connectTimeout 10s × 3 ≈ 38s 后抛 APIConnectionTimeoutError。
      //
      // gpt-image-2 仅支持图生图（wellapi /v1/images/edits 必须带 image），
      // 所以 Lingting 路径只在 edit + 有 references 时启用；其他场景
      // （generation / 文生图 / 无 references）仍走 OpenAI SDK 兜底。
      //
      // Lingting 未配置（dev / 用户只配了 OpenAI Key）也兜底 OpenAI SDK，
      // 不让画布"内置渠道"完全不可用。
      const useLingting = isEdit && isLingtingConfigured();
      if (useLingting) {
        // 1. 把 data URL reference 落到 R2 拿永久 URL（wellapi 需要 URL 不是 data URL）
        const imageUrl = await ensureRemoteUrlForLingting(
          input.references![0]!,
          input.userId
        );
        const wellapiSize =
          !input.size || input.size === "auto" ? "1024x1024" : input.size;

        // 2. n > 1 走并行 submit（与 workbench gptImage2Adapter 同语义：
        //    wellapi 单次返 1 张，多张要循环提交收集）
        const batchSize = Math.min(n, 10);
        const tasks = await Promise.allSettled(
          Array.from({ length: batchSize }, (_, i) =>
            retrySubmitLingtingTask(
              input.userId,
              imageUrl,
              input.prompt,
              wellapiSize,
              i,
              2,
              2000
            )
          )
        );

        // 任一失败 → 整批失败（与 workbench gptImage2Adapter 同语义）。
        // 错误汇总走 summarizeLingtingFailures：去重 + 范围压缩 + 剥 HTML，
        // 避免 4 次失败堆出 600+ 字符 HTML 错误页塞 toast。
        const failures = tasks
          .map((t, i) => ({ t, i }))
          .filter((x) => x.t.status === "rejected");
        if (failures.length > 0) {
          throw summarizeLingtingFailures(failures, batchSize);
        }

        // 3. 收集 sync URL（submitLingtingTask 内部已落 R2）
        const syncUrls: string[] = [];
        for (const t of tasks) {
          if (t.status === "fulfilled" && t.value.kind === "url") {
            syncUrls.push(...t.value.urls);
          }
        }
        if (syncUrls.length > 0) {
          items.push(...lingtingUrlsToCanvasItems(syncUrls));
        } else {
          // 4. 全是 async task（少见）：拿第一个 taskId 轮询到底
          const firstTask = tasks.find(
            (t) => t.status === "fulfilled" && t.value.kind === "task"
          );
          if (
            firstTask &&
            firstTask.status === "fulfilled" &&
            firstTask.value.kind === "task"
          ) {
            const polledUrls = await pollLingtingUntilDone(
              firstTask.value.taskId,
              input.userId,
              0
            );
            items.push(...lingtingUrlsToCanvasItems(polledUrls));
          }
        }
      } else if (input.mode === "edit" && input.references?.length) {
        // OpenAI SDK 多参考图 edit 兜底（Lingting 未配 / 不想走 wellapi 时）
        const refBuffers = await Promise.all(
          input.references.map(async (ref) => {
            const { buffer, mimeType } = await fetchToBuffer(ref.url);
            return ref.name
              ? { buffer, mimeType, name: ref.name }
              : { buffer, mimeType };
          })
        );
        const maskBuf = input.mask
          ? await fetchToBuffer(input.mask.url)
          : undefined;
        const maskName = input.mask?.name;
        const generated = await imageEdit({
          prompt: input.prompt,
          model: input.model,
          images: refBuffers,
          ...(maskBuf && maskName
            ? {
                mask: {
                  buffer: maskBuf.buffer,
                  mimeType: maskBuf.mimeType,
                  name: maskName,
                },
              }
            : maskBuf
              ? {
                  mask: {
                    buffer: maskBuf.buffer,
                    mimeType: maskBuf.mimeType,
                  },
                }
              : {}),
          n,
          ...(input.size ? { size: input.size } : {}),
        });
        for (const g of generated) {
          const buffer = Buffer.from(g.b64, "base64");
          const persisted = await persistBufferToR2(
            buffer,
            g.mimeType,
            input.userId,
            "image"
          );
          items.push(persisted);
        }
      } else {
        // 文生图 / Lingting 未配置 —— OpenAI SDK imageGeneration
        const generated = await imageGeneration({
          prompt: input.prompt,
          model: input.model,
          n,
          ...(input.size ? { size: input.size } : {}),
          ...(input.quality ? { quality: input.quality } : {}),
          ...(input.background ? { background: input.background } : {}),
        });
        for (const g of generated) {
          const buffer = Buffer.from(g.b64, "base64");
          const persisted = await persistBufferToR2(
            buffer,
            g.mimeType,
            input.userId,
            "image"
          );
          items.push(persisted);
        }
      }
    } else if (input.capability === "audio") {
      const speech = await audioSpeech({
        input: input.prompt,
        model: input.model,
        ...(input.voice ? { voice: input.voice } : {}),
        ...(input.audioFormat ? { format: input.audioFormat } : {}),
        ...(input.audioSpeed ? { speed: input.audioSpeed } : {}),
        ...(input.audioInstructions
          ? { instructions: input.audioInstructions }
          : {}),
      });
      const persisted = await persistBufferToR2(
        speech.buffer,
        speech.mimeType,
        input.userId,
        "audio"
      );
      items.push(persisted);
    } else {
      // text —— chat completion：暂时不持久化产物，前端拿到原始文本流；落库层由前端自处理
      throw new Error(
        "text 模式请走 requestImageQuestion，不在 sync generate 范围"
      );
    }

    return {
      success: true,
      capability: input.capability,
      items,
      // image / audio 不消耗积分（见顶部 docblock）；字段保留以兼容调用方
      creditsConsumed: 0,
      transactionId: "",
    };
  } catch (err) {
    // image / audio 不消耗积分 → 无需 refund，错误直接抛给上层（Inngest 函数 / 路由）
    throw err;
  }
}

async function safeRefund(
  userId: string,
  amount: number,
  transactionId: string,
  capability: CanvasCapability,
  errorMessage: string
) {
  try {
    await grantCredits({
      userId,
      amount,
      sourceType: "refund",
      debitAccount: `SERVICE:canvas.${capability}`,
      transactionType: "refund",
      sourceRef: transactionId,
      description: `画布内置 ${capability} 生成失败回退`,
      metadata: { error: errorMessage },
    });
  } catch (refundErr) {
    // 回滚失败仅记日志；不能盖住原 error（避免上游修复后用户再被多扣）
    // eslint-disable-next-line no-console
    console.error("[canvas.refund-failed]", {
      userId,
      amount,
      transactionId,
      refundErr,
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 异步产物（video）：create 时扣积分 → poll 时检测失败回滚
// ───────────────────────────────────────────────────────────────────────────

const VIDEO_JOBS = new Map<
  string,
  {
    userId: string;
    cost: number;
    transactionId: string;
    providerJobId: string;
    status: "pending" | "completed" | "failed";
    items?: CanvasRemoteGenerateResult["items"];
    createdAt: number;
  }
>();

// 清理过期 job（30 分钟），防止内存泄漏
const VIDEO_JOB_TTL_MS = 30 * 60 * 1000;
setInterval(
  () => {
    const cutoff = Date.now() - VIDEO_JOB_TTL_MS;
    for (const [id, job] of VIDEO_JOBS) {
      if (job.createdAt < cutoff) VIDEO_JOBS.delete(id);
    }
  },
  5 * 60 * 1000
).unref();

export async function createVideoOnServer(input: {
  userId: string;
  model: string;
  prompt: string;
  seconds?: number;
  size?: string;
}): Promise<CanvasRemoteVideoCreateResult> {
  const cost = calculateCanvasCost({
    capability: "video",
    ...(input.seconds !== undefined ? { videoSeconds: input.seconds } : {}),
  });

  const consumed = await consumeCredits({
    userId: input.userId,
    amount: cost,
    serviceName: "canvas.video",
    description: "画布内置 video 生成（异步）",
    metadata: { model: input.model },
  });

  try {
    // 调 OpenAI /v1/videos —— 创建异步任务
    const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY 未配置，无法生成 video");

    const form = new FormData();
    form.append("model", input.model);
    form.append("prompt", input.prompt);
    if (input.seconds) form.append("seconds", String(input.seconds));
    if (input.size) form.append("size", input.size);

    const res = await fetch(`${baseUrl}/v1/videos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `OpenAI video create 失败：HTTP ${res.status} ${text.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("OpenAI video create 返回无 id");
    const providerJobId = json.id;

    const jobId = randomBytes(8).toString("hex");
    VIDEO_JOBS.set(jobId, {
      userId: input.userId,
      cost,
      transactionId: consumed.transactionId,
      providerJobId,
      status: "pending",
      createdAt: Date.now(),
    });

    return {
      success: true,
      jobId,
      creditsConsumed: consumed.consumedAmount,
      transactionId: consumed.transactionId,
    };
  } catch (err) {
    await safeRefund(
      input.userId,
      consumed.consumedAmount,
      consumed.transactionId,
      "video",
      describeError(err)
    );
    throw err;
  }
}

export async function pollVideoOnServer(input: {
  jobId: string;
  userId: string;
}): Promise<
  | { status: "pending" }
  | {
      status: "completed";
      items: CanvasRemoteGenerateResult["items"];
      creditsConsumed: number;
    }
  | { status: "failed"; message: string; creditsConsumed: number }
> {
  const job = VIDEO_JOBS.get(input.jobId);
  if (!job) throw new Error(`未知 jobId：${input.jobId}`);
  if (job.userId !== input.userId) throw new Error("无权访问该 job");

  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 未配置");

  const res = await fetch(`${baseUrl}/v1/videos/${job.providerJobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI video poll 失败：HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    status?: string;
    error?: { message?: string };
  };

  if (json.status === "completed" || json.status === "succeeded") {
    if (job.status === "completed" && job.items) {
      return {
        status: "completed",
        items: job.items,
        creditsConsumed: job.cost,
      };
    }
    // 下载视频内容
    const contentRes = await fetch(
      `${baseUrl}/v1/videos/${job.providerJobId}/content`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(120_000),
      }
    );
    if (!contentRes.ok) {
      throw new Error(
        `OpenAI video content 下载失败：HTTP ${contentRes.status}`
      );
    }
    const arrayBuffer = await contentRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = contentRes.headers.get("content-type") || "video/mp4";
    const persisted = await persistBufferToR2(
      buffer,
      mimeType,
      input.userId,
      "video"
    );
    job.items = [persisted];
    job.status = "completed";
    return { status: "completed", items: job.items, creditsConsumed: job.cost };
  }

  if (json.status === "failed" || json.status === "cancelled" || json.error) {
    job.status = "failed";
    await safeRefund(
      job.userId,
      job.cost,
      job.transactionId,
      "video",
      json.error?.message || `OpenAI video ${json.status}`
    );
    VIDEO_JOBS.delete(input.jobId);
    return {
      status: "failed",
      message: json.error?.message || "video 生成失败",
      creditsConsumed: job.cost,
    };
  }

  return { status: "pending" };
}

// 重新导出供上层 catch 时识别（业务异常）
export type { AccountFrozenError, InsufficientCreditsError };
