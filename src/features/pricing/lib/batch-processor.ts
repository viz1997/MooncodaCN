"use client";

/**
 * 移植自 wjp-source-code/src/lib/batch-processor.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * Batch Processor
 *
 * Processes multiple model files in parallel using Web Workers.
 *
 * Concurrency model:
 *   - Each `parseObjInWorker` call spawns its own Worker via the cached Blob URL.
 *   - We dispatch up to `concurrency` files at a time (default 4 — matches
 *     typical browser connection limits for Blob URL workers).
 *   - Each file goes through: extract → parse → optimize angle → compute price.
 *
 * All processing happens client-side; no files are uploaded to a server.
 */

import {
  findOptimalAngle,
  type OptimalAngle,
  prepareSupportModel,
} from "./angle-optimizer";
import { parseObjInWorker } from "./obj-worker-client";
import {
  calculatePrice,
  type PricingConfig,
  type PricingInput,
  scaleGeometry,
} from "./pricing-engine";
import {
  extractModelZip,
  type ModelFile,
  revokeModelTextureUrls,
} from "./zip-extractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BatchStatus =
  | "pending"
  | "extracting"
  | "parsing"
  | "optimizing"
  | "pricing"
  | "done"
  | "error"
  | "skipped";

export type BatchItem = {
  id: string;
  file: File;
  name: string;
  status: BatchStatus;
  /** 0-100 within this item's own pipeline */
  progress: number;
  /** Brief status message shown to the user */
  message?: string | undefined;
  startTime?: number | undefined;
  endTime?: number | undefined;

  // Result fields (populated when status === 'done')
  result?: BatchResult | undefined;
  error?: string | undefined;
};

export type BatchResult = {
  model: ModelFile;
  parseResult: ModelFile["parseResult"];
  optimalAngle: OptimalAngle | null;
  pricing: {
    volumeCM3: number;
    surfaceAreaCM2: number;
    dims: [number, number, number];
    materialWeight: number;
    weightFee: number;
    varnishFee: number;
    /** 支撑加价（元）。本体支撑比例超过 1:1 阈值时，超出部分按 supportPrice 元/g 加收 */
    supportFee: number;
    /** 超出阈值的支撑克重（g） */
    excessSupportWeight: number;
    totalPrice: number;
    repairFee: number;
  };
  objText: string;
};

export type BatchOptions = {
  concurrency?: number;
  pricingConfig: PricingConfig;
  solidRatio: number;
  repairEnabled: boolean;
  repairPrice: number;
  /** Apply angle optimization? Default true */
  optimizeAngle?: boolean;
  /** Called whenever any item's status/progress changes */
  onItemUpdate?: (id: string, patch: Partial<BatchItem>) => void;
  /** Called when the whole batch finishes */
  onComplete?: (items: BatchItem[]) => void;
  /** Abort signal */
  signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const yieldToUI = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Run an async pool with fixed concurrency.
 *
 * - `items` are dispatched up to `concurrency` at a time.
 * - `worker(item, index)` returns a Promise that resolves when the item
 *   is fully processed.
 * - Returns when all items have settled (resolved or rejected).
 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const maxConcurrent = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;
  let active = 0;

  await new Promise<void>((resolve) => {
    const launchNext = () => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      while (active < maxConcurrent && cursor < items.length) {
        if (signal?.aborted) {
          resolve();
          return;
        }
        const idx = cursor++;
        active++;
        worker(items[idx]!, idx)
          .catch((err) => {
            // Errors are handled by the worker via item patches; we just
            // continue here.
            console.error("Batch item failed:", err);
          })
          .finally(() => {
            active--;
            if (cursor >= items.length && active === 0) {
              resolve();
            } else {
              launchNext();
            }
          });
      }
    };
    launchNext();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize a batch from a list of files.
 *
 * Returns BatchItem[] with status='pending' for each file. Pass to
 * `processBatch` to start processing.
 */
export function initBatch(files: File[]): BatchItem[] {
  return files.map((file, idx) => ({
    id: `${Date.now()}-${idx}-${file.name}`,
    file,
    name: file.name.replace(/\.[^.]+$/, ""),
    status: "pending",
    progress: 0,
    startTime: undefined,
    endTime: undefined,
  }));
}

/**
 * Process a batch of model files in parallel.
 *
 * Each item goes through:
 *   1. Extract (decompress ZIP or read .obj text)
 *   2. Parse OBJ via Worker (with sendGeometry=true)
 *   3. Optimize print angle (findOptimalAngle)
 *   4. Compute price (calculatePrice)
 *
 * Updates are pushed via `onItemUpdate` so the UI can render progress live.
 */
export async function processBatch(
  items: BatchItem[],
  options: BatchOptions
): Promise<BatchItem[]> {
  const {
    concurrency = 4,
    pricingConfig,
    solidRatio,
    repairEnabled,
    repairPrice,
    optimizeAngle: doOptimize = true,
    onItemUpdate,
    signal,
  } = options;

  const update = (item: BatchItem, patch: Partial<BatchItem>) => {
    Object.assign(item, patch);
    onItemUpdate?.(item.id, patch);
  };

  await runPool(
    items,
    concurrency,
    async (item) => {
      if (signal?.aborted) {
        update(item, { status: "skipped", message: "已取消" });
        return;
      }

      item.startTime = Date.now();
      update(item, { status: "extracting", progress: 5, message: "解压中..." });

      // ---- 1. Extract (ZIP / direct OBJ) ---------------------------------
      let model: ModelFile | null = null;
      try {
        const extractResult = await extractModelZip(item.file, (p) => {
          const pct = Math.min(40, 5 + Math.floor(p.percent * 0.35));
          update(item, {
            status: p.phase === "unzip" ? "extracting" : "parsing",
            progress: pct,
            message: p.phase === "unzip" ? "解压中..." : "解析几何...",
          });
        });
        if (extractResult.error || !extractResult.model) {
          update(item, {
            status: "error",
            progress: 100,
            error: extractResult.error ?? "解析失败",
            message: "解析失败",
            endTime: Date.now(),
          });
          return;
        }
        model = extractResult.model;
        // 批量模式不渲染 3D 预览 —— 贴图的 blob URL 用不上,直接回收
        // (每个文件都建一份 URL,不回收的话批量跑几百个就把内存撑爆了)
        revokeModelTextureUrls(model);
        model.previewUrl = undefined;
        model.textureUrls = undefined;
      } catch (err) {
        update(item, {
          status: "error",
          progress: 100,
          error: err instanceof Error ? err.message : String(err),
          message: "解析失败",
          endTime: Date.now(),
        });
        return;
      }

      if (signal?.aborted) {
        update(item, { status: "skipped", message: "已取消" });
        return;
      }

      // ---- 2. Parse with geometry (for angle optimization) ---------------
      let positions: Float32Array | null = null;
      let optimalAngle: OptimalAngle | null = null;
      if (doOptimize) {
        update(item, {
          status: "parsing",
          progress: 45,
          message: "解析几何 (Worker)...",
        });
        try {
          const result = await parseObjInWorker(model.objText, {
            sendGeometry: true,
            onProgress: (wp) => {
              const pct = 45 + Math.floor((wp.percent / 95) * 20);
              update(item, { progress: pct });
            },
          });
          if (result.positions && result.positions.length > 0) {
            positions = result.positions;
          }
        } catch (err) {
          console.warn(
            `[${item.name}] Worker parse failed, skipping angle optimization:`,
            err
          );
        }

        if (signal?.aborted) {
          update(item, { status: "skipped", message: "已取消" });
          return;
        }

        // ---- 3. Optimize angle ------------------------------------------
        if (positions) {
          update(item, {
            status: "optimizing",
            progress: 70,
            message: "智能摆盘...",
          });
          await yieldToUI();
          // 计算模型克重，用于"本体支撑比例"= 支撑克重 / 模型克重
          const modelWeightG =
            model.parseResult.volumeCM3 * pricingConfig.materialDensity;
          try {
            // 焊接一次(2026-11-02):支撑算法跟模型检查工具共用同一套网格准备
            optimalAngle = findOptimalAngle(
              prepareSupportModel(positions),
              (p) => {
                const pct = 70 + Math.floor(p * 0.2);
                update(item, { progress: pct });
              },
              50,
              modelWeightG
            );
          } catch (err) {
            console.warn(`[${item.name}] Angle optimization failed:`, err);
            optimalAngle = null;
          }
        }
      }

      // ---- 4. Pricing ----------------------------------------------------
      update(item, { status: "pricing", progress: 92, message: "计算克重..." });
      const r = model.parseResult;
      // 3D viewer applies -90° X rotation (Z-up → Y-up), swapping visual Y and Z.
      // Display dims in VISUAL order: [size.x, size.z, size.y]
      const origDims: [number, number, number] = [
        r.boundingBox.size.x,
        r.boundingBox.size.z,
        r.boundingBox.size.y,
      ];
      const scaled = scaleGeometry(r.volumeCM3, r.surfaceAreaCM2, origDims, 1);
      const input: PricingInput = {
        volumeCM3: scaled.volumeCM3,
        surfaceAreaCM2: scaled.surfaceAreaCM2,
        mode: "upload",
        solidRatio,
        dims: scaled.dims,
        // 支撑加价仅在开关开启时计入；关闭时传 0 让 pricing-engine 跳过
        supportWeight: pricingConfig.supportEnabled
          ? (optimalAngle?.totalSupportWeight ?? 0)
          : 0,
        selfSupportRatio: pricingConfig.supportEnabled
          ? (optimalAngle?.selfSupportRatio ?? 0)
          : 0,
      };
      const priceResult = calculatePrice(pricingConfig, input);
      if (!priceResult) {
        update(item, {
          status: "error",
          progress: 100,
          error: "克重计算失败",
          message: "克重计算失败",
          endTime: Date.now(),
        });
        return;
      }

      const repairFee = repairEnabled ? repairPrice : 0;
      const result: BatchResult = {
        model,
        parseResult: r,
        optimalAngle,
        pricing: {
          volumeCM3: scaled.volumeCM3,
          surfaceAreaCM2: scaled.surfaceAreaCM2,
          dims: scaled.dims,
          materialWeight: priceResult.materialWeight,
          weightFee: priceResult.weightFee,
          varnishFee: priceResult.varnishFee,
          supportFee: priceResult.supportFee,
          excessSupportWeight: priceResult.excessSupportWeight,
          totalPrice: priceResult.totalPrice + repairFee,
          repairFee,
        },
        objText: model.objText,
      };

      update(item, {
        status: "done",
        progress: 100,
        message: "完成",
        result,
        endTime: Date.now(),
      });
    },
    signal
  );

  return items;
}

// ---------------------------------------------------------------------------
// Summary helpers
// ---------------------------------------------------------------------------

export function summarizeBatch(items: BatchItem[]) {
  const done = items.filter((i) => i.status === "done");
  const errors = items.filter((i) => i.status === "error");
  const total = items.length;
  // 总克重 = 耗材克重 + 支撑克重 —— 跟单模型页一个口径:
  // 打印出来还没洗支撑时,这一批整块称重的总和。
  // 没跑智能摆盘的条目没有支撑数据,只算耗材那部分。
  const totalWeight = done.reduce(
    (s, i) =>
      s +
      (i.result?.pricing.materialWeight ?? 0) +
      (i.result?.optimalAngle?.totalSupportWeight ?? 0),
    0
  );
  const totalPrice = done.reduce(
    (s, i) => s + (i.result?.pricing.totalPrice ?? 0),
    0
  );
  const avgTime =
    done.length > 0
      ? done.reduce((s, i) => s + ((i.endTime ?? 0) - (i.startTime ?? 0)), 0) /
        done.length
      : 0;

  return {
    total,
    done: done.length,
    errors: errors.length,
    pending: total - done.length - errors.length,
    totalWeight,
    totalPrice,
    avgTimeMs: avgTime,
  };
}
