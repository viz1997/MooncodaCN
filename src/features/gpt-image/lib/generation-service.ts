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
import { logger } from "@/lib/logger";

import type { GenerationTask } from "./generation-task";
import { stringifyGenerationTask } from "./generation-task";
import { parseCandidates, parseUploadedImages } from "./order-helpers";

const LINGTING_API_KEY = process.env.LINGTING_API_KEY;
const LINGTING_BASE_URL = process.env.LINGTING_BASE_URL ?? "https://wellapi.ai";

/**
 * 检查 Lingting API 是否已配置
 */
export function isLingtingConfigured(): boolean {
  return !!LINGTING_API_KEY;
}

/** submit 阶段结果：上游可能同步返回 url，也可能返回 task_id 待轮询 */
export type SubmitResult =
  | { kind: "url"; url: string }
  | { kind: "task"; taskId: string };

/** poll 阶段结果 */
export type QueryResult =
  | { state: "pending" }
  | { state: "done"; url: string }
  | { state: "failed"; error: string };

/**
 * 提交一张原图的生成任务（不轮询）。
 *
 * Lingting 的 /v1/images/edits 要求 multipart/form-data，必须把原图作为
 * 文件字段上传，不能用 JSON body + URL 引用，因此先下载原图拿 buffer。
 *
 * 失败直接抛错，由调用方决定如何落库。
 */
export async function submitLingtingTask(
  imageUrl: string,
  prompt: string,
  size: string,
  imageIdx: number
): Promise<SubmitResult> {
  if (!LINGTING_API_KEY) {
    throw new Error("LINGTING_API_KEY 未配置");
  }

  // 1. 下载原图 buffer（imageUrl 通常是 R2 公开域 URL）
  let imageBuf: ArrayBuffer;
  let imageMime = "image/png";
  try {
    const imgRes = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imgRes.ok) {
      throw new Error(
        `下载原图失败：HTTP ${imgRes.status} ${imgRes.statusText}`
      );
    }
    const ct = imgRes.headers.get("content-type");
    if (ct?.startsWith("image/")) imageMime = ct;
    imageBuf = await imgRes.arrayBuffer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    throw new Error(`下载原图失败（${imageIdx + 1}）：${msg}`);
  }

  // 2. 构造 multipart/form-data
  const form = new FormData();
  // 第二个参数必须是 Blob/Buffer，文件名随便取
  form.append(
    "image",
    new Blob([new Uint8Array(imageBuf)], { type: imageMime }),
    `original-${imageIdx + 1}.${imageMime.split("/")[1] ?? "png"}`
  );
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size);
  form.append("response_format", "url");

  // 3. 提交任务
  const submitRes = await fetch(`${LINGTING_BASE_URL}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINGTING_API_KEY}`,
    },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "");
    throw new Error(
      `Lingting 提交失败：HTTP ${submitRes.status} ${text.slice(0, 200)}`
    );
  }

  const submitJson = (await submitRes.json()) as {
    data?: Array<{ url?: string }>;
    images?: Array<{ url?: string }>;
    task_id?: string;
  };

  // 3a. 同步返回：直接拿到 url，无需轮询
  const direct = submitJson.data?.[0]?.url ?? submitJson.images?.[0]?.url;
  if (direct) return { kind: "url", url: direct };

  // 3b. 异步返回：交给 /poll 轮询
  const taskId = submitJson.task_id;
  if (!taskId) {
    throw new Error(
      `Lingting 响应格式异常（无 task_id 也无 url）: ${JSON.stringify(submitJson).slice(0, 300)}`
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
export async function queryLingtingTask(taskId: string): Promise<QueryResult> {
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
    data?: Array<{ url?: string }>;
    images?: Array<{ url?: string }>;
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
    const url = pollJson.data?.[0]?.url ?? pollJson.images?.[0]?.url;
    if (url) return { state: "done", url };
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
  const layout = buildGridLayout(candidateCount);
  const compositePrompt = order.template.prompt + layout.suffix;
  const size = order.template.size;

  // uploadCount 基本为 1；多图时并行 submit，避免串行放大请求耗时
  const targets: number[] = [];
  for (let imageIdx = fromIdx; imageIdx < total; imageIdx++) {
    if (uploaded[imageIdx]) targets.push(imageIdx);
  }

  const settled = await Promise.all(
    targets.map(async (imageIdx) => {
      try {
        const imageUrl = uploaded[imageIdx] as string;
        const result = await submitLingtingTask(
          imageUrl,
          compositePrompt,
          size,
          imageIdx
        );
        return { imageIdx, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        logger.warn({ err, orderId, imageIdx }, "提交生图任务失败");
        return { imageIdx, error: `第 ${imageIdx + 1} 张：${msg}` };
      }
    })
  );

  // 汇总：同步拿到 url 的直接落 candidates，拿到 taskId 的进待轮询列表
  const nested = fillSparseSlots(parseCandidates(order.candidates), total);
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
      nested[item.imageIdx] = [result.url];
      readyCount++;
    } else {
      tasks.push({
        imageIdx: item.imageIdx,
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
        generationTask: stringifyGenerationTask({ tasks, total }),
        status: "GENERATING",
        templateId: order.templateId,
        errorMessage: failures.length > 0 ? failures.join("；") : null,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, orderId));
    logger.info(
      { orderId, taskCount: tasks.length, fromIdx, total },
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
