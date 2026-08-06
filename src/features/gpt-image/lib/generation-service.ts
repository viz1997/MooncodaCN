/**
 * GPT-Image 效果图生成服务
 *
 * 策略：
 * - 唯一生成路径：Lingting (wellapi.ai) GPT-Image-2 异步接口
 *   - candidateCount ∈ {1, 2}：调 N 次，每次 n=1 返回 1 张独立候选
 *   - candidateCount ∈ {4, 9}（宫格模式）：调 1 次，prompt 追加"2x2 / 3x3 宫格"指令，返回 1 张拼接图
 * - 未配置 LINGTING_API_KEY 或 Lingting 报错 → 直接抛错，绝不静默 fallback
 *
 * 整条链路 URL-only：原图用 https URL 给 Lingting，效果图也是 https URL 落库。
 *
 * 协作式取消（"停止生成"，**不是取消订单**）：
 * - requestStopGeneration(orderId) 通过 AbortController 信号打断当前 in-flight 的
 *   Lingting 请求和后续轮询；runGeneration 在循环顶部检查 signal.aborted，
 *   一旦取消立刻 break 出循环。
 * - 已完成的部分会保留在 DB（CANDIDATES_READY 局部成功）。**订单本身仍然是同一
 *   个**，status 会按完成度落到 FAILED / CANDIDATES_READY，不会被标记 CANCELLED。
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { logger } from "@/lib/logger";

import { parseCandidates, parseUploadedImages } from "./order-helpers";

const LINGTING_API_KEY = process.env.LINGTING_API_KEY;
const LINGTING_BASE_URL = process.env.LINGTING_BASE_URL ?? "https://wellapi.ai";

// ============================================
// 单订单并发控制：inFlight Set 防重入 + AbortController 协作式取消
// ============================================
const inFlight = new Set<string>();
const abortControllers = new Map<string, AbortController>();

/**
 * 检查 Lingting API 是否已配置
 */
export function isLingtingConfigured(): boolean {
  return !!LINGTING_API_KEY;
}

/**
 * 调用 Lingting GPT-Image-2 异步生图接口
 *
 * 输入：原图 https URL + 模板 prompt + 尺寸 + 索引
 * 输出：生成的图片 https URL（不含 dataUrl 前缀）
 *
 * Lingting (wellapi.ai) 的 /v1/images/edits 端点要求 multipart/form-data，
 * 必须把原图作为文件字段上传，不能用 JSON body + URL 引用。
 * 因此先 fetch 原图拿 buffer，再构造 FormData。
 */
async function callLingtingImage2Edit(
  imageUrl: string,
  prompt: string,
  size: string,
  imageIdx: number,
  candIdx: number,
  signal?: AbortSignal
): Promise<string> {
  if (!LINGTING_API_KEY) {
    throw new Error("LINGTING_API_KEY 未配置");
  }

  // 1. 下载原图 buffer（imageUrl 通常是 R2 公开域 URL）
  let imageBuf: ArrayBuffer;
  let imageMime = "image/png";
  try {
    const composed = composeSignal(30_000, signal);
    const imgRes = await fetch(imageUrl, composed ? { signal: composed } : {});
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
    throw new Error(
      isAbortError(err, signal)
        ? `已停止生成（原图下载中断，第 ${imageIdx + 1} 张）`
        : `下载原图失败（${imageIdx + 1}）：${msg}`
    );
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

  // 3. 提交任务（异步）
  const submitRes = await fetch(`${LINGTING_BASE_URL}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINGTING_API_KEY}`,
    },
    body: form,
    ...(signal ? { signal } : {}),
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

  // 2a. 同步返回：直接拿到 url
  const direct = submitJson.data?.[0]?.url;
  if (direct) return direct;

  // 2b. 异步返回：需要轮询
  const taskId = submitJson.task_id;
  if (!taskId) {
    throw new Error(
      `Lingting 响应格式异常（无 task_id 也无 url）: ${JSON.stringify(submitJson).slice(0, 300)}`
    );
  }

  // 轮询
  const maxWaitMs = 90_000;
  const intervalMs = 2_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (signal?.aborted) {
      throw new Error(`已停止生成（轮询中断，第 ${imageIdx + 1} 张）`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    if (signal?.aborted) {
      throw new Error(`已停止生成（轮询中断，第 ${imageIdx + 1} 张）`);
    }
    const pollRes = await fetch(
      `${LINGTING_BASE_URL}/v1/images/tasks/${taskId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${LINGTING_API_KEY}` },
        ...(signal ? { signal } : {}),
      }
    );
    if (!pollRes.ok) continue;
    const pollJson = (await pollRes.json()) as {
      status?: string;
      data?: Array<{ url?: string }>;
      images?: Array<{ url?: string }>;
      error?: string;
    };
    const status = pollJson.status ?? "";
    if (status === "failed" || status === "error") {
      throw new Error(`Lingting 生成失败：${pollJson.error ?? "未知错误"}`);
    }
    if (
      status === "succeeded" ||
      status === "success" ||
      status === "completed"
    ) {
      const url = pollJson.data?.[0]?.url ?? pollJson.images?.[0]?.url;
      if (url) return url;
    }
  }
  throw new Error(`Lingting 生成超时（${imageIdx + 1}-${candIdx + 1}）`);
}

/**
 * 把超时信号和"停止生成"信号合并，任一触发都会 abort。
 * 任一为 undefined 时退化为另一个。
 */
function composeSignal(
  timeoutMs: number,
  parent?: AbortSignal
): AbortSignal | undefined {
  if (!parent) return AbortSignal.timeout(timeoutMs);
  if (parent.aborted) return parent;
  const timeout = AbortSignal.timeout(timeoutMs);
  const composite = new AbortController();
  const onAbort = () => composite.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  timeout.addEventListener("abort", onAbort, { once: true });
  return composite.signal;
}

/** 判断一个 fetch 抛出的错误是不是由外部 signal 触发的"停止生成"。 */
function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && /aborted|abort/i.test(err.message);
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
 * 为指定原图生成一张效果图（返回 https URL）。
 *
 * 失败直接抛错，由调用方决定如何处理（不再 silent fallback 到占位图）。
 */
export async function generateCandidate(
  imageUrl: string,
  prompt: string,
  size: string,
  imageIdx: number,
  candIdx: number,
  signal?: AbortSignal
): Promise<string> {
  if (!isLingtingConfigured()) {
    throw new Error("LINGTING_API_KEY 未配置，无法生成效果图");
  }
  return callLingtingImage2Edit(
    imageUrl,
    prompt,
    size,
    imageIdx,
    candIdx,
    signal
  );
}

/**
 * 为 [fromIdx, total) 区间内的每张新原图各生成一组效果图。
 *
 * **全部走宫格模式**：每张原图调 1 次 Lingting，prompt 追加宫格指令（1/2/4/9
 * 分别对应 1x1 / 1x2 / 2x2 / 3x3 布局），返回 1 张拼接图。
 * candidates[imageIdx] = [compositeUrl]（数组始终长度 1，selection 存的是宫格索引）。
 *
 * 每完成一组立刻落库，前端轮询 candidateGroups 即可看到真实进度。
 *
 * 错误隔离：单张原图生成失败仅记日志、不影响其他原图继续生成；最终汇总错误到
 * errorMessage（仅在所有原图都失败时才把订单标 FAILED，否则仍是 CANDIDATES_READY）。
 */
async function runGeneration(
  orderId: string,
  fromIdx: number,
  total: number,
  candidateCount: number,
  signal: AbortSignal
): Promise<void> {
  // 读取订单拿到所有 uploadedImages + template
  const order = await db.query.promptOrder.findFirst({
    where: eq(promptOrder.id, orderId),
    with: { template: true },
  });
  if (!order) {
    logger.warn({ orderId }, "订单不存在，跳过生成");
    return;
  }
  const uploaded = parseUploadedImages(order.uploadedImages);
  const prompt = order.template.prompt;
  const size = order.template.size;
  const templateId = order.templateId;
  const layout = buildGridLayout(candidateCount);

  const failures: string[] = [];
  let aborted = false;

  for (let imageIdx = fromIdx; imageIdx < total; imageIdx++) {
    // 协作式取消：循环顶部立刻检查 signal，已停止则跳出
    if (signal.aborted) {
      aborted = true;
      break;
    }
    const imageUrl = uploaded[imageIdx];
    if (!imageUrl) continue;

    try {
      // 全部走宫格模式：1 次 Lingting 返回 1 张拼接图
      const compositePrompt = prompt + layout.suffix;
      const compositeUrl = await generateCandidate(
        imageUrl,
        compositePrompt,
        size,
        imageIdx,
        0,
        signal
      );
      const group = [compositeUrl];

      // 重新读取，避免覆盖并发写入
      const current = await db.query.promptOrder.findFirst({
        where: eq(promptOrder.id, orderId),
        columns: { candidates: true, status: true },
      });
      if (!current || current.status === "CANCELLED") return;

      const nested = parseCandidates(current.candidates);
      // 上一轮中途失败可能留下空洞；JSON.stringify 会把稀疏槽变成 null，
      // 导致 candidateGroups 虚高。先补齐再写入。
      for (let i = 0; i < imageIdx; i++) {
        if (!Array.isArray(nested[i])) nested[i] = [];
      }
      nested[imageIdx] = group;

      await db
        .update(promptOrder)
        .set({ candidates: JSON.stringify(nested), templateId })
        .where(eq(promptOrder.id, orderId));
    } catch (err) {
      // 取消信号触发的异常：标记 aborted 直接跳出，不再当成"部分失败"
      if (signal.aborted) {
        aborted = true;
        break;
      }
      const msg = err instanceof Error ? err.message : "未知错误";
      logger.warn({ err, orderIdx: imageIdx, orderId }, "原图生成失败，跳过");
      failures.push(`第 ${imageIdx + 1} 张：${msg}`);
    }
  }

  // 检查是否有任何原图成功
  const finalState = await db.query.promptOrder.findFirst({
    where: eq(promptOrder.id, orderId),
    columns: { candidates: true, status: true },
  });
  if (!finalState || finalState.status === "CANCELLED") return;

  const finalNested = parseCandidates(finalState.candidates);
  const successCount = finalNested.filter(
    (g) => Array.isArray(g) && g.length > 0
  ).length;

  if (aborted) {
    // 协作式"停止生成"：保留已完成的成果，根据完成度落 FAILED 或 CANDIDATES_READY
    // **不**改成 CANCELLED（那是订单级取消的语义，见 /api/orders/[token]/cancel）
    if (successCount === 0) {
      await db
        .update(promptOrder)
        .set({
          status: "FAILED",
          errorMessage: "已停止本次生成",
        })
        .where(eq(promptOrder.id, orderId));
    } else {
      await db
        .update(promptOrder)
        .set({
          status: "CANDIDATES_READY",
          generatedAt: new Date(),
          errorMessage: "已停止本次生成（部分完成）",
        })
        .where(eq(promptOrder.id, orderId));
    }
    return;
  }

  if (successCount === 0) {
    // 全部失败 → FAILED
    await db
      .update(promptOrder)
      .set({
        status: "FAILED",
        errorMessage: failures.join("；") || "未知错误",
      })
      .where(eq(promptOrder.id, orderId));
  } else {
    // 至少一张成功 → CANDIDATES_READY，错误信息仅汇总
    await db
      .update(promptOrder)
      .set({
        status: "CANDIDATES_READY",
        generatedAt: new Date(),
        errorMessage:
          failures.length > 0 ? `部分失败：${failures.join("；")}` : null,
      })
      .where(eq(promptOrder.id, orderId));
  }
}

/**
 * 异步触发订单效果图生成（fire-and-forget）
 *
 * 防重入：同一订单已有生成任务在跑则跳过。
 * 协作式取消：通过 requestStopGeneration(orderId) 中断对应任务的 AbortController。
 */
export function triggerGeneration(
  orderId: string,
  fromIdx: number,
  total: number,
  candidateCount: number
): void {
  if (inFlight.has(orderId)) {
    logger.info({ orderId }, "订单已有生成任务在跑，跳过重入");
    return;
  }
  const controller = new AbortController();
  abortControllers.set(orderId, controller);
  inFlight.add(orderId);
  void runGeneration(
    orderId,
    fromIdx,
    total,
    candidateCount,
    controller.signal
  )
    .catch(async (err) => {
      // 主动取消不属于"生成失败"
      if (controller.signal.aborted) {
        logger.info({ orderId }, "效果图生成被用户停止");
        return;
      }
      logger.error({ err, orderId }, "效果图生成失败");
      await db
        .update(promptOrder)
        .set({
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "未知错误",
        })
        .where(eq(promptOrder.id, orderId))
        .catch(() => {});
    })
    .finally(() => {
      inFlight.delete(orderId);
      abortControllers.delete(orderId);
    });
}

/**
 * 请求"停止生成"（**不是取消订单**）。
 *
 * 协作式：立刻 abort 当前 in-flight 的 fetch，并让 runGeneration 在下个迭代开头
 * 检测到 signal.aborted 而 break。已经落库的部分候选图保留，订单 status 会由
 * runGeneration 末尾按完成度写入 FAILED / CANDIDATES_READY，**不会变 CANCELLED**。
 *
 * 返回 true 表示有对应任务被中断；false 表示当前没有该订单的生成任务在跑。
 */
export function requestStopGeneration(orderId: string): boolean {
  const ctrl = abortControllers.get(orderId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * 生成新的访问 token（32 字符 hex）
 */
export function generateOrderToken(): string {
  return randomBytes(16).toString("hex");
}
