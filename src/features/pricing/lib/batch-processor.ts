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
 *   - Each file goes through: extract → parse → optimize angle → compute weight.
 *
 * All processing happens client-side; no files are uploaded to a server.
 *
 * ## ⛔ 这个文件**只算克重,不算钱**
 *
 * 工作室 2026-11-16 的要求:「不要展示 4.5 元/g 这种单价,避免暴露我们的
 * 成本」。这个文件是 `"use client"` —— 只要它 import 了 `pricing-engine.ts`
 * (单价住在那儿),那个字面量就进客户端 bundle 了。
 *
 * ⇒ 批量流水线**只算克重**:体积 × 密度。钱由服务端算(报价弹窗走
 * `/api/print-quote`),批量模式本来也没有下单出口(CLAUDE.md:「批量克重是
 * 另一个工具(批量量重),没有下单出口」)。
 *
 * 顺带修掉一个老 bug:原先这里是用**引擎默认的 4.5 元/g** 算的,不是后台
 * 配的当前价 —— 跟「后台改了价,商城还是老价」同一类错。
 */

import {
  SUPPORT_LIFT_MM,
  SUPPORT_RELIEF_LIFT_MM,
} from "@mooncoda/print-tool-core/mesh/support-shell";
import type { OptimalAngle, SupportParams } from "@mooncoda/print-tool-core/pricing/angle-optimizer";
import { AngleOptimizerClient } from "./angle-optimizer-client";
import { computeMaterialWeight } from "@mooncoda/print-tool-core/weight/material-weight";
import { detectModelUnitScale } from "@mooncoda/print-tool-core/weight/model-units";
import { parseObjInWorker } from "./obj-worker-client";
import { scaleGeometry } from "@mooncoda/print-tool-core/weight/pricing-geometry";
import { detectReliefKind, reliefLiftMm } from "@mooncoda/print-tool-core/pricing/relief-detect";
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
  /**
   * 支撑克重 (g) —— 摆盘过是最优姿态的,没摆盘是**初始角度 (0°,0°)** 的。
   *
   * 跟单模型页一个口径:不用先摆一次盘才知道要多少支撑。
   */
  supportWeightG: number;
  /** 本体支撑比例 = 支撑克重 / 模型克重 */
  supportRatio: number;
  /**
   * 几何 + 克重 —— **没有钱**
   *
   * 原来的 `pricing` 里带着 `weightFee` / `varnishFee` / `supportFee` /
   * `totalPrice` / `repairFee` —— 界面一个都没渲染,却把成本口径带进了
   * 客户端 bundle(工作室 2026-11-16:别暴露成本)。现在只剩克重跟几何。
   */
  metrics: {
    volumeCM3: number;
    surfaceAreaCM2: number;
    dims: [number, number, number];
    /** 耗材克重 (g) = 体积 × 材料密度 */
    materialWeight: number;
  };
  objText: string;
};

export type BatchOptions = {
  concurrency?: number;
  /**
   * 材料密度 (g/cm³) —— 耗材克重 = 体积 × 这个密度
   *
   * 密度**不是**成本口径(材料物性),可以直接发给浏览器。单价不是 ——
   * 单价住在 `pricing-engine.ts` 里,那个文件不许进客户端 bundle。
   */
  materialDensity: number;
  /**
   * 支撑材料密度 (g/cm³) —— 支撑跟模型**不是**一种材料
   *
   * 支撑克重按这个密度算;模型密度只用来算耗材克重。
   */
  supportDensity: number;
  /**
   * 托底高度 (mm) —— 平台面在模型最低点下方多远
   *
   * 省略 = 用 `SUPPORT_LIFT_MM`(5mm)。后台(`/admin/print-pricing`)配的值
   * 从这里进来 —— 批量模式跟单件模式必须同一口径。
   */
  supportLiftMm?: number | undefined;
  /**
   * 浮雕那档的托底高度 (mm) —— 2026-11-15
   *
   * 工作室的原话:「克重工具中浮雕模型不需要像手办模型5mm底部支撑，只需要1mm支撑」。
   *
   * 省略 = 用 `SUPPORT_RELIEF_LIFT_MM`(1mm)。批量模式**逐个文件判定**
   * (扁平板 ⇒ 浮雕 ⇒ 1mm;其余 ⇒ 手办 ⇒ 5mm)—— 批量里可能一半是浮雕
   * 一半是手办,一个值套不住。
   */
  supportReliefLiftMm?: number | undefined;
  /**
   * 底板留边 (mm) —— 底板比模型轮廓四周各留多宽
   *
   * 省略 = 用 `SUPPORT_BASE_MARGIN_MM`(5mm)。同上。
   */
  supportBaseMarginMm?: number | undefined;
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
 *   4. Compute weight (体积 × 密度) —— **不算钱**
 *
 * Updates are pushed via `onItemUpdate` so the UI can render progress live.
 */
export async function processBatch(
  items: BatchItem[],
  options: BatchOptions
): Promise<BatchItem[]> {
  const {
    concurrency = 4,
    materialDensity,
    supportDensity,
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

      // ---- 2. 几何(支撑克重 + 智能摆盘都要用) --------------------------
      let positions: Float32Array | null = null;
      let optimalAngle: OptimalAngle | null = null;
      /**
       * 支撑克重 (g) —— 摆盘过就用最优姿态的(支撑更少),没摆盘就用**初始
       * 角度 (0°,0°)** 的。跟单模型页一个口径:不用先摆一次盘才知道要多少
       * 支撑。
       */
      let supportWeightG = 0;
      update(item, {
        status: "parsing",
        progress: 45,
        message: "准备几何 (Worker)...",
      });
      // 解压阶段已经在 Worker 里把 OBJ 解析过了,几何顺手带出来了 ——
      // 不用再解析一遍(大模型的 OBJ 解析很贵)
      const parsed = model.parseResult.positions;
      if (parsed && parsed.length > 0) {
        positions = parsed;
      } else {
        // 老路径兜底:解析结果里没有几何就单独再解析一次
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
            `[${item.name}] Worker parse failed, skipping support calculation:`,
            err
          );
        }
      }

      if (signal?.aborted) {
        update(item, { status: "skipped", message: "已取消" });
        return;
      }

      // ---- 3. 支撑克重 + 智能摆盘 ---------------------------------------
      // 焊接 + 支撑搜索都跑在 Worker 里 —— 批量跑几十个模型时主线程不会被
      // 卡死,页面照样能点能取消。

      /**
       * 单位判定 —— 坐标不是毫米的文件(AI 生成 / Blender 默认导出)按最大边
       * 100mm 归一化
       *
       * 跟单模型页同一条规则(`lib/model-units.ts`)。批量模式**没有尺寸调节**,
       * 用户没法自己纠 —— 不归一化的话,托底 5mm 相对模型太大,支撑比例是
       * 几万倍(实测真实模型 56,868%)。
       */
      const unitScale = detectModelUnitScale(
        model.parseResult.boundingBox.size
      ).scale;

      /**
       * 托底档位 —— **逐个文件**判定(2026-11-15)
       *
       * 浮雕那档托底 1mm、手办那档 5mm。批量里可能一半是浮雕一半是手办,
       * 一个值套不住 ⇒ 每个文件按**自己的尺寸**判一次。
       *
       * 尺寸用的是**归一化之后**的毫米值(原始尺寸 × `unitScale`)——
       * 跟单件模式判的是同一组数。
       */
      const itemDimsMm: [number, number, number] = [
        model.parseResult.boundingBox.size.x * unitScale,
        model.parseResult.boundingBox.size.y * unitScale,
        model.parseResult.boundingBox.size.z * unitScale,
      ];
      const itemLiftMm = reliefLiftMm(detectReliefKind(itemDimsMm), {
        figurineLiftMm: options.supportLiftMm ?? SUPPORT_LIFT_MM,
        reliefLiftMm: options.supportReliefLiftMm ?? SUPPORT_RELIEF_LIFT_MM,
      });

      // 模型克重,用于"本体支撑比例"= 支撑克重 / 模型克重
      const modelWeightG =
        model.parseResult.volumeCM3 *
        unitScale *
        unitScale *
        unitScale *
        materialDensity;
      // 支撑跟模型**不是**一种材料(水溶性支撑)—— 支撑克重按支撑密度算,
      // 模型密度只用来算耗材克重
      const supportParams: SupportParams = {
        modelDensity: materialDensity,
        supportDensity,
        // 几何参数跟随后台 —— 批量模式跟单件模式必须同一口径
        liftMm: itemLiftMm,
        baseMarginMm: options.supportBaseMarginMm,
      };
      if (positions) {
        const client = new AngleOptimizerClient();
        try {
          await client.load(item.id, positions);
        } catch (err) {
          console.warn(`[${item.name}] Worker load failed:`, err);
        }
        // 智能摆盘(可选)—— 找支撑克重最小的姿态
        if (doOptimize) {
          update(item, {
            status: "optimizing",
            progress: 70,
            message: "智能摆盘...",
          });
          await yieldToUI();
          try {
            optimalAngle = await client.search(
              item.id,
              {
                scales: [unitScale, unitScale, unitScale],
                maxHeightMM: 50,
                modelWeightG,
                params: supportParams,
              },
              (p) => {
                const pct = 70 + Math.floor(p * 0.2);
                update(item, { progress: pct });
              }
            );
          } catch (err) {
            console.warn(`[${item.name}] Angle optimization failed:`, err);
            optimalAngle = null;
          }
        }
        // 支撑克重:摆盘过就用最优姿态,没摆盘就用**初始角度**(0°,0°)
        try {
          const pose = await client.pose(item.id, {
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            scales: [unitScale, unitScale, unitScale],
            params: supportParams,
          });
          supportWeightG =
            optimalAngle?.totalSupportWeight ?? pose.supportWeightG;
        } catch (err) {
          console.warn(`[${item.name}] Support calculation failed:`, err);
        } finally {
          client.dispose();
        }
        // 几何用完就扔 —— 批量跑几百个模型时,每份三角汤几 MB,
        // 全留着会把内存撑爆(OBJ 文本本来就还留着,不能再加一份几何)。
        model.parseResult.positions = undefined;
      }

      // ---- 4. 克重 ----------------------------------------------------
      // 状态值还是 "pricing"(界面上的徽章文案靠它)—— 但这里**不算钱**,
      // 只算克重。钱由服务端算(报价弹窗走 `/api/print-quote`)。
      update(item, { status: "pricing", progress: 92, message: "计算克重..." });
      const r = model.parseResult;
      // 3D viewer applies -90° X rotation (Z-up → Y-up), swapping visual Y and Z.
      // Display dims in VISUAL order: [size.x, size.z, size.y]
      const origDims: [number, number, number] = [
        r.boundingBox.size.x,
        r.boundingBox.size.z,
        r.boundingBox.size.y,
      ];
      const scaled = scaleGeometry(
        r.volumeCM3,
        r.surfaceAreaCM2,
        origDims,
        unitScale
      );
      // 耗材克重 = 体积 × 密度 —— 跟服务端 `calculatePrice()` 同一个公式,
      // 同一个守卫(体积 ≤ 0 或密度 ≤ 0 ⇒ 算不出来)。
      const materialWeight = computeMaterialWeight(
        scaled.volumeCM3,
        materialDensity
      );
      if (materialWeight === null) {
        update(item, {
          status: "error",
          progress: 100,
          error: "克重计算失败",
          message: "克重计算失败",
          endTime: Date.now(),
        });
        return;
      }

      const result: BatchResult = {
        model,
        parseResult: r,
        optimalAngle,
        // 支撑克重(摆盘过 = 最优姿态,没摆盘 = 初始角度)
        supportWeightG,
        // 本体支撑比例 = 支撑克重 / 模型克重
        supportRatio: modelWeightG > 0 ? supportWeightG / modelWeightG : 0,
        metrics: {
          volumeCM3: scaled.volumeCM3,
          surfaceAreaCM2: scaled.surfaceAreaCM2,
          dims: scaled.dims,
          materialWeight,
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
  // 支撑克重跟当前姿态走:摆盘过是最优姿态,没摆盘是初始角度。
  const totalWeight = done.reduce(
    (s, i) =>
      s +
      (i.result?.metrics.materialWeight ?? 0) +
      (i.result?.supportWeightG ?? 0),
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
    avgTimeMs: avgTime,
  };
}
