/**
 * GPT-Image 效果图生成服务
 *
 * 策略：
 * - 唯一生成路径：Lingting (wellapi.ai) GPT-Image-2 异步接口
 * - 全部走宫格模式：每张原图调 1 次，prompt 追加宫格指令，返回 1 张拼接图
 * - 未配置 LINGTING_API_KEY 或 Lingting 报错 → 直接抛错，绝不静默 fallback
 *
 * 整条链路 URL-only：原图用 https URL 给 Lingting，效果图也是 https URL 落库。
 *
 * ## submit / poll 两段式（Serverless 适配）
 *
 * Lingting 是异步接口：POST /v1/images/edits 提交后立刻返回 task_id，
 * 真正耗时的是之后的轮询。Serverless（Vercel）在 HTTP 响应后冻结 runtime，
 * 任何 fire-and-forget 的后台轮询都会被静默杀掉（曾导致订单永久卡在
 * GENERATING、上游零调用记录、errorMessage 为 null）。
 *
 * 因此职责拆成两半：
 * - submitGeneration()：服务端在请求周期内同步完成 submit，把 task_id 落库
 * - queryLingtingTask()：由 /api/orders/[token]/poll 驱动，前端轮询时各查一次
 *
 * 这样服务端永远没有长任务，不依赖 Inngest 等外部 worker。
 *
 * "停止生成"改为 DB 驱动（清空 generationTask + 置 FAILED），
 * 不再有进程内 AbortController —— 它在多实例 Serverless 下本就不可靠。
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { isR2Configured, putObject } from "@/features/image-gen/lib/r2";
import { logger } from "@/lib/logger";

import type { GenerationTask } from "./generation-task";
import { stringifyGenerationTask } from "./generation-task";
import { parseCandidates, parseUploadedImages } from "./order-helpers";

const LINGTING_API_KEY = process.env.LINGTING_API_KEY;
const LINGTING_BASE_URL = process.env.LINGTING_BASE_URL ?? "https://wellapi.ai";

/**
 * 把 Lingting 返回的临时效果图 URL 下载下来，重新上传到 R2，返回永久 R2 URL。
 *
 * 为什么不直接落库 upstream URL：wellapi.ai 的 URL 有 TTL（典型 1-24h，
 * 部分账户更短），几天后必然过期。R2 是我们自己控制的 bucket，URL
 * 永久有效。
 *
 * 失败抛错，由调用方决定是否计入 failures；不静默 fallback 回 upstream URL
 * —— 否则等于这次修改白做。
 */
export async function persistCandidateToR2(
  upstreamUrl: string,
  orderId: string,
  imageIdx: number
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error("R2 未配置：效果图无法持久化");
  }

  // 1. 下载上游
  //
  // 超时 60s：早期版本用 30s——但 Lingting CDN 偶发慢响应（wellapi.ai 边缘节点
  // 跨大洲回源 + 首次回源 cold cache），30s 在生产环境撞到过，AbortError
  // 冒泡成 failures："第 N 张：The operation was aborted due to timeout"。
  //
  // 旧版会被 /poll maxDuration=30 误诊成"Vercel 砍函数"——其实真因是
  // persistCandidateToR2 内部 download timeout。现在 /poll 调到 90s 后
  // 真实根因暴露，把这里也升到 60s 给 CDN 2x 缓冲。
  //
  // 60s 仍在 /poll maxDuration=90 预算内（60s download + 5s R2 PUT + DB
  // 往返 ~5s = 70s ≤ 90s）；多图走 Promise.all，墙钟 ≈ 单张时长。
  const res = await fetch(upstreamUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(
      `下载 Lingting 效果图失败：HTTP ${res.status} ${res.statusText}`
    );
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength === 0) {
    throw new Error("Lingting 返回空 body");
  }

  // 2. 推断扩展名（PNG/JPEG/WebP/GIF 都允许）
  const ext =
    contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "png";

  // 3. 上传 R2：objectKey 模板带订单 + 图片 idx + 时间戳，避免重复生成覆盖
  const objectKey = `gpt-image/results/${orderId}/${imageIdx}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const persistedUrl = await putObject({
    objectKey,
    body,
    contentType,
  });

  logger.info(
    {
      orderId,
      imageIdx,
      bytes: body.byteLength,
      objectKey,
    },
    "Lingting 效果图已转存 R2"
  );
  return persistedUrl;
}

/**
 * 把 Lingting 返回的 base64 编码效果图直接上传到 R2，返回永久 R2 URL。
 *
 * 为什么有这个 helper：wellapi gpt-image 系列同步调用固定返 b64_json（与
 * OpenAI 一致，response_format 参数对 gpt-image 系列无效），不走 URL。
 * 这条路径不需要再走"下载 URL → 上传 R2"两步，省一道网络往返。
 *
 * 失败抛错。b64 输入合法性由调用方保证；非合法 base64 会在这里 decode 阶段
 * 抛错被调用方 catch。
 */
export async function persistBase64ToR2(
  b64: string,
  contentType: string,
  orderId: string,
  imageIdx: number
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error("R2 未配置：效果图无法持久化");
  }

  const cleanB64 = b64.replace(/\s+/g, "");
  const body = new Uint8Array(Buffer.from(cleanB64, "base64"));
  if (body.byteLength === 0) {
    throw new Error("Lingting 返回空 b64 body");
  }

  const ext =
    contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "png";

  const objectKey = `gpt-image/results/${orderId}/${imageIdx}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const persistedUrl = await putObject({
    objectKey,
    body,
    contentType,
  });

  logger.info(
    {
      orderId,
      imageIdx,
      bytes: body.byteLength,
      objectKey,
      source: "b64",
    },
    "Lingting 效果图（b64）已转存 R2"
  );
  return persistedUrl;
}

/**
 * 检查 Lingting API 是否已配置
 */
export function isLingtingConfigured(): boolean {
  return !!LINGTING_API_KEY;
}

/** submit 阶段结果：上游可能同步返回 1..N 张 url，也可能返回 task_id 待轮询
 *
 * urls 元素永远指 R2 永久 URL（b64_json 路径已在内部走 persistBase64ToR2）。
 * 调用方拿到的 urls 即为可直接落库的成品。
 */
export type SubmitResult =
  | { kind: "url"; urls: string[] }
  | { kind: "task"; taskId: string };

/** poll 阶段结果 */
export type QueryResult =
  | { state: "pending" }
  | { state: "done"; urls: string[] }
  | { state: "failed"; error: string };

/**
 * 把 wellapi 返回的 data/images 数组逐条落 R2，返回永久 URL 数组。
 *
 * wellapi gpt-image-2 可能同步返回多张图（n 参数或多图规则触发），
 * 也可能单张；本 helper 统一处理两种形态，url 与 b64_json 混合也能识别。
 * 持久化走 Promise.all 并行，多张同轮 done 时墙钟 ≈ 单张时长。
 *
 * 单条失败抛错，由调用方决定整批放弃 / 部分落库。当前实现是 fail-fast：
 * 一张失败整批 reject —— wellapi 多图同轮失败几乎不会发生，全军覆没概率
 * 极低，简化逻辑优先。
 */
async function persistWellapiDataToR2(
  items: Array<{ url?: string; b64_json?: string }>,
  orderId: string,
  imageIdx: number
): Promise<string[]> {
  const valid = items.filter(
    (it): it is { url: string } | { b64_json: string } =>
      typeof it.url === "string" || typeof it.b64_json === "string"
  );
  if (valid.length === 0) return [];

  const persisted = await Promise.all(
    valid.map((it) => {
      if ("url" in it) return persistCandidateToR2(it.url, orderId, imageIdx);
      return persistBase64ToR2(
        it.b64_json as string,
        "image/png",
        orderId,
        imageIdx
      );
    })
  );
  return persisted;
}

/**
 * 提交一批原图的生成任务（不轮询）。
 *
 * Lingting 的 /v1/images/edits 要求 multipart/form-data，必须把原图作为
 * 文件字段上传，不能用 JSON body + URL 引用，因此先下载每张原图拿 buffer。
 *
 * 多图参考（2026-09-02）：wellapi.ai `/v1/images/edits` 接受同一 `image` key
 * 重复多次（`image` + `image` + `image`），最大 16 张、50MB total，作为多张
 * 参考图让模型综合生成。前端 `UploadStep` 已校验每批最多 imagesPerUpload
 * 张，这里 imageUrls 数量 = 一次 /upload 接受的批次内张数（1..imagesPerUpload）。
 *
 * 关于 response_format：gpt-image 系列固定忽略此参数，sync 调用永远返
 * b64_json（参见 wellapi/OpenAI 文档）。我们不再发这个字段，由本函数内
 * 部检测 url/b64 两种返回形态，b64 路径走 persistBase64ToR2 落库后
 * 透明返 { kind: "url", url }。
 *
 * 2026-09-01：增加 n 参数（默认 1 保持兼容）。模板 outputMode="separate" 时
 * 调用方传 candidateCount，让 Lingting 一次返 N 张独立图（替代宫格模式）；
 * "grid" 模式仍走 n=1 + prompt 末尾追加宫格指令。
 *
 * imageIdx 现在 = 批次槽位下标（= candidates 外层下标），不再是单张原图
 * 下标 —— 一批 N 张合一次生图，candidates 写入用 batchIdx 而非 imageIdx。
 *
 * 失败直接抛错，由调用方决定如何落库。
 */
export async function submitLingtingTask(
  orderId: string,
  // 2026-09-02：imageUrls: string[] 改自单图 string。多张参考图作为
  // multipart image[] 上传到 wellapi.ai，合一次生图任务。
  imageUrls: string[],
  prompt: string,
  size: string,
  // 2026-09-02：imageIdx 现在 = 批次槽位（= candidates 外层下标）。
  imageIdx: number,
  // 2026-09-01：n=1 = 宫格模式（默认），n>1 = 独立候选模式
  n: number = 1
): Promise<SubmitResult> {
  if (!LINGTING_API_KEY) {
    throw new Error("LINGTING_API_KEY 未配置");
  }
  if (imageUrls.length === 0) {
    throw new Error("submitLingtingTask 需要至少 1 张参考图");
  }

  // 1. 逐张下载原图 buffer（imageUrl 通常是 R2 公开域 URL）
  //
  // 超时 120s：旧 60s 在 Vercel 跨区域回源 R2 + 大图（>5MB）偶发撞线
  // （用户反馈 "第 1 张：The operation was aborted due to timeout"）。
  // 120s 给 R2 充足缓冲——async task_id 路径下这是阻塞点；sync URL 路径
  // 还会走 persistCandidateToR2（60s），叠加 245s 仍在 /upload maxDuration=300s
  // 预算内。
  //
  // 多张参考图时并行下载（每张独立 120s），wall-clock ≈ 单张时长 + ε。
  const downloaded = await Promise.all(
    imageUrls.map(async (url, i) => {
      try {
        const imgRes = await fetch(url, {
          signal: AbortSignal.timeout(120_000),
        });
        if (!imgRes.ok) {
          throw new Error(
            `下载原图失败：HTTP ${imgRes.status} ${imgRes.statusText}`
          );
        }
        const ct = imgRes.headers.get("content-type");
        const mime = ct?.startsWith("image/") ? ct : "image/png";
        const buf = await imgRes.arrayBuffer();
        return { buf, mime };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        throw new Error(`下载原图失败（第 ${i + 1} 张）：${msg}`);
      }
    })
  );

  // 2. 构造 multipart/form-data —— 同 key `image` 重复 append。
  // wellapi 把多次 `image` 字段当 image[] 多图参考处理（主图在 image[0]，
  // 其余按顺序 image[1..N-1]）。文件名 ref-1.png / ref-2.png 仅供调试，
  // 上游不解析。
  const form = new FormData();
  for (let i = 0; i < downloaded.length; i++) {
    const { buf, mime } = downloaded[i] as { buf: ArrayBuffer; mime: string };
    form.append(
      "image",
      new Blob([new Uint8Array(buf)], { type: mime }),
      `ref-${i + 1}.${mime.split("/")[1] ?? "png"}`
    );
  }
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  // 2026-09-01：n 按 outputMode 传 —— grid 模式仍是 1（让 Lingting 自己拼宫格），
  // separate 模式传 candidateCount（一次返 N 张独立候选）。
  form.append("n", String(n));
  form.append("size", size);
  // 注意：gpt-image 系列固定返 b64_json，response_format 参数无效。
  // 部分账户在 dall-e-2 模型上仍接受此参数，但 gpt-image-2 路径会被忽略，
  // 显式发出只会增加请求体大小，不再传。

  // 3. 提交任务。
  // 超时 120s：旧 60s 仍被 Lingting 偶发 cold start / 模型队列积压撞线
  // （用户反馈 "第 1 张：The operation was aborted due to timeout"）。
  // 120s 给 Lingting 充足缓冲；async task_id 路径下返回 task_id 即退出，
  // 不会消费完整 120s——墙钟 ≈ R2 120s + Lingting ~5-10s + DB 5s = 130-140s
  // ≤ /upload maxDuration=300s。sync URL 路径叠加 persist 65s 后 195s，
  // 仍在预算内。
  const submitRes = await fetch(`${LINGTING_BASE_URL}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINGTING_API_KEY}`,
    },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    // 2026-09-02：Lingting/WellAPI 对 multipart body 限制约 8MB，超过会返 413。
    // 前端 handleFileSelect / handleFiles / uploadFile 已经先 resize 到 ≤5MB；
    // 这里仍命中意味着上游对当前账号限制更严，给用户可操作提示。
    if (submitRes.status === 413) {
      throw new Error(
        `Lingting 提交失败：HTTP 413（参考图过大，请压缩到 5MB 以下再试）${text.slice(0, 100)}`
      );
    }
    throw new Error(
      `Lingting 提交失败：HTTP ${submitRes.status} ${text.slice(0, 200)}`
    );
  }

  const submitJson = (await submitRes.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
    images?: Array<{ url?: string; b64_json?: string }>;
    task_id?: string;
  };

  // 3a. 同步返回 url 或 b64_json（可能 1..N 张）：全部并行落 R2 后返
  const directItems = submitJson.data ?? submitJson.images ?? [];
  const persistedUrls = await persistWellapiDataToR2(
    directItems,
    orderId,
    imageIdx
  );
  if (persistedUrls.length > 0) {
    return { kind: "url", urls: persistedUrls };
  }

  // 3b. 异步返回：交给 /poll 轮询
  const taskId = submitJson.task_id;
  if (!taskId) {
    throw new Error(
      `Lingting 响应格式异常（无 task_id 也无 url/b64）: ${JSON.stringify(submitJson).slice(0, 300)}`
    );
  }
  return { kind: "task", taskId };
}

/**
 * 查询一次任务状态（单次 GET，不阻塞）。
 *
 * 网络抖动 / 上游 5xx 一律返回 pending —— 让前端下一轮再试，
 * 由 /poll 的超时判定兜底，避免一次抖动就把订单判死。
 */
export async function queryLingtingTask(
  orderId: string,
  taskId: string,
  imageIdx: number
): Promise<QueryResult> {
  if (!LINGTING_API_KEY) {
    return { state: "failed", error: "LINGTING_API_KEY 未配置" };
  }

  let pollRes: Response;
  try {
    pollRes = await fetch(`${LINGTING_BASE_URL}/v1/images/tasks/${taskId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${LINGTING_API_KEY}` },
      // 单次上游超时压缩到 8s：一次 /poll 必须在平台函数预算内
      // 跑完（即使上游挂死），否则硬化超时判定永远没机会写库。
      // 多任务走 Promise.all，墙钟仍 ≈8s，加 2-3 次 DB round-trip
      // 可安全落进 10s。保留「网络抖动一律 pending」策略——
      // 上面有 ORDER_DEADLINE_MS 真兜底，不再叠成死链。
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { state: "pending" };
  }

  if (!pollRes.ok) return { state: "pending" };

  let pollJson: {
    status?: string;
    data?: Array<{ url?: string; b64_json?: string }>;
    images?: Array<{ url?: string; b64_json?: string }>;
    error?: string;
  };
  try {
    pollJson = await pollRes.json();
  } catch {
    return { state: "pending" };
  }

  const status = pollJson.status ?? "";
  if (status === "failed" || status === "error") {
    return {
      state: "failed",
      error: `Lingting 生成失败：${pollJson.error ?? "未知错误"}`,
    };
  }
  if (
    status === "succeeded" ||
    status === "success" ||
    status === "completed"
  ) {
    // poll 路径同样可能返 b64_json 或 url（1..N 张），全部并行落 R2
    const items = pollJson.data ?? pollJson.images ?? [];
    const persistedUrls = await persistWellapiDataToR2(
      items,
      orderId,
      imageIdx
    );
    if (persistedUrls.length > 0) {
      return { state: "done", urls: persistedUrls };
    }
  }
  return { state: "pending" };
}

/**
 * 给宫格模式在 prompt 末尾追加"输出形式"指令，避免模型只生成 1 张普通图。
 * 返回 (cols, rows) 和 prompt 后缀。
 */
function buildGridLayout(candidateCount: number): {
  cols: number;
  rows: number;
  suffix: string;
} {
  const size = "1024x1024"; // 实际尺寸由模板 size 决定；此处给模型参考
  if (candidateCount === 1) {
    return {
      cols: 1,
      rows: 1,
      suffix: "", // 1 个效果直接整张图，不需要拼接指令
    };
  }
  if (candidateCount === 2) {
    return {
      cols: 2,
      rows: 1,
      suffix: `\n\n请将 2 种不同效果以 1x2 横向宫格的形式呈现在同一张图片中（左右各一格），每格清晰可辨、无重叠。`,
    };
  }
  if (candidateCount === 4) {
    return {
      cols: 2,
      rows: 2,
      suffix: `\n\n请将 4 种不同效果以 2x2 宫格的形式呈现在同一张 ${size} 图片中，每格清晰可辨、无重叠。`,
    };
  }
  // 9
  return {
    cols: 3,
    rows: 3,
    suffix: `\n\n请将 9 种不同效果以 3x3 宫格的形式呈现在同一张 ${size} 图片中，每格清晰可辨、无重叠。`,
  };
}

/**
 * 把 candidates 的 [0, upTo) 区间稀疏槽补齐为 []，避免 JSON.stringify
 * 把空洞序列化成 null（上一轮中途失败会留下空洞）。
 */
function fillSparseSlots(nested: string[][], upTo: number): string[][] {
  for (let i = 0; i < upTo; i++) {
    if (!Array.isArray(nested[i])) nested[i] = [];
  }
  return nested;
}

/**
 * 提交 [fromIdx, total) 区间内每张原图的生成任务。
 *
 * **只做 submit，不轮询** —— 轮询由前端调 /api/orders/[token]/poll 驱动。
 * 调用方（upload / regenerate 路由）应 await 本函数，它在请求周期内完成。
 *
 * 落库结果：
 * - 有任务待轮询 → generationTask 写入 task 列表，status = GENERATING
 * - 上游同步返回了全部 url → 直接 CANDIDATES_READY
 * - 全部 submit 失败 → FAILED + errorMessage（用户能立刻看到真实原因）
 */
export async function submitGeneration(
  orderId: string,
  fromIdx: number,
  total: number,
  candidateCount: number
): Promise<void> {
  const order = await db.query.promptOrder.findFirst({
    where: eq(promptOrder.id, orderId),
    with: { template: true },
  });
  if (!order) {
    logger.warn({ orderId }, "订单不存在，跳过生成");
    return;
  }

  const uploaded = parseUploadedImages(order.uploadedImages);
  // 2026-09-01：按模板 outputMode 分支
  //  - "grid"（默认）：n=1 + prompt 末尾追加宫格指令，让 Lingting 一次返 1 张拼接图
  //  - "separate"：n=candidateCount + 不追加指令，让 Lingting 一次返 N 张独立候选
  // 老模板 DB 默认 'grid'，行为不变。
  const outputMode =
    (order.template.outputMode as "grid" | "separate") ?? "grid";
  let effectivePrompt: string;
  let n: number;
  if (outputMode === "separate") {
    effectivePrompt = order.template.prompt;
    n = candidateCount;
  } else {
    const layout = buildGridLayout(candidateCount);
    effectivePrompt = order.template.prompt + layout.suffix;
    n = 1;
  }
  const size = order.template.size;

  // 2026-09-02：拍平 batch 边界。
  // 旧版按 uploadedImages 下标 fan-out：imagesPerUpload=3 时 N 张图跑 N 次
  // 生图，扣 N 次额度。真实语义是 wellapi `image[]` 多图参考 —— 多张图是
  // 同一组输入，合一次生图任务。
  //
  // 新版：
  // - 按 imagesPerUpload 等分 uploadedImages 得到 batches[]（每批 imagesPerUpload 张）
  // - fromIdx / total 是【张数】索引 → 转成【批次】下标
  // - 每批调一次 submitLingtingTask(imageUrls: 本批全部 URL)
  // - 重试 2 次 × 2s（per-batch），失败计入整批失败
  //
  // FAILED 重传场景不严格整除也按 Math.floor 切，最后一批残缺也参与一次生图。
  const perBatch = Math.max(1, order.imagesPerUpload);
  const batchCount = Math.ceil(uploaded.length / perBatch);
  // fromIdx / total 是上传张数索引；转成批次：[0, fromBatch) 跳过
  const fromBatch = Math.floor(fromIdx / perBatch);
  // total 是 merged 后总张数；转成批次下标 [fromBatch, toBatch)
  const toBatch = Math.min(batchCount, Math.ceil(total / perBatch));

  // per-batch retry：Lingting 偶发 cold start 120s 撞线，整批等 2s 再试一次。
  // **不重试成功的批** —— 成功的批次不重复提交，省 Lingting 配额
  // （wellapi.ai 不支持幂等键，重复提交会被扣两次）。
  const MAX_SUBMIT_ATTEMPTS = 2;
  const SUBMIT_RETRY_DELAY_MS = 2_000;

  const settled = await Promise.all(
    Array.from({ length: toBatch - fromBatch }, (_, localIdx) => {
      const batchIdx = fromBatch + localIdx;
      return (async () => {
        const start = batchIdx * perBatch;
        const end = Math.min(uploaded.length, start + perBatch);
        const imageUrls = uploaded.slice(start, end);
        if (imageUrls.length === 0) {
          // 边界：merged 长度变化后某批可能为空（理论不应发生，防御）
          return {
            batchIdx,
            error: `第 ${batchIdx + 1} 批：本批无参考图`,
          };
        }
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
          try {
            const result = await submitLingtingTask(
              orderId,
              imageUrls,
              effectivePrompt,
              size,
              batchIdx,
              n
            );
            if (attempt > 1) {
              logger.info(
                { orderId, batchIdx, attempt },
                "提交生图任务重试成功"
              );
            }
            return { batchIdx, result };
          } catch (err) {
            lastError = err instanceof Error ? err.message : "未知错误";
            logger.warn(
              {
                err,
                orderId,
                batchIdx,
                attempt,
                maxAttempts: MAX_SUBMIT_ATTEMPTS,
              },
              "提交生图任务失败"
            );
            if (attempt < MAX_SUBMIT_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, SUBMIT_RETRY_DELAY_MS));
            }
          }
        }
        return {
          batchIdx,
          error: `第 ${batchIdx + 1} 批：${lastError ?? "未知错误"}`,
        };
      })();
    })
  );

  // 汇总：同步拿到 url 的直接落 candidates，拿到 taskId 的进待轮询列表
  const nested = fillSparseSlots(parseCandidates(order.candidates), batchCount);
  const tasks: GenerationTask[] = [];
  const failures: string[] = [];
  const now = Date.now();
  let readyCount = 0;

  for (const item of settled) {
    if ("error" in item && item.error) {
      failures.push(item.error);
      continue;
    }
    const result = item.result;
    if (!result) continue;
    if (result.kind === "url") {
      // submitLingtingTask 已经把每张图（url 或 b64）都落 R2 了，urls
      // 元素直接是永久 URL，可直接放 candidates。多图（wellapi 偶尔
      // 返多张）会按顺序落入同一个 batchIdx 的槽位。
      nested[item.batchIdx] = result.urls;
      readyCount += result.urls.length;
    } else {
      tasks.push({
        imageIdx: item.batchIdx,
        taskId: result.taskId,
        submittedAt: now,
      });
    }
  }

  // 仍有待轮询任务 → 保持 GENERATING，交给 /poll 推进
  if (tasks.length > 0) {
    await db
      .update(promptOrder)
      .set({
        candidates: JSON.stringify(nested),
        generationTask: stringifyGenerationTask({ tasks, total: batchCount }),
        status: "GENERATING",
        templateId: order.templateId,
        errorMessage: failures.length > 0 ? failures.join("；") : null,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, orderId));
    logger.info(
      { orderId, taskCount: tasks.length, fromIdx, total, batchCount },
      "生图任务已提交，等待前端轮询推进"
    );
    return;
  }

  // 无待轮询任务：本轮当场出结果
  const successCount = nested.filter(
    (g) => Array.isArray(g) && g.length > 0
  ).length;

  if (successCount === 0) {
    await db
      .update(promptOrder)
      .set({
        status: "FAILED",
        generationTask: null,
        errorMessage: failures.join("；") || "生图任务提交失败",
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, orderId));
    logger.error({ orderId, failures }, "生图任务全部提交失败");
    return;
  }

  await db
    .update(promptOrder)
    .set({
      candidates: JSON.stringify(nested),
      status: "CANDIDATES_READY",
      generationTask: null,
      generatedAt: new Date(),
      templateId: order.templateId,
      errorMessage:
        failures.length > 0 ? `部分失败：${failures.join("；")}` : null,
      updatedAt: new Date(),
    })
    .where(eq(promptOrder.id, orderId));
  logger.info({ orderId, readyCount }, "生图任务同步完成");
}

/**
 * 生成新的访问 token（32 字符 hex）
 */
export function generateOrderToken(): string {
  return randomBytes(16).toString("hex");
}
