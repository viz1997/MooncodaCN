/**
 * 磁吸孔的 **MCP 服务器**(stdio)
 *
 * ## 为什么要有这个
 *
 * 工作室 2026-11-11 的原话:**「在 Blender 里 Scripting → 新建文本 → 把插件
 * 粘进去 → Run Script,桥接就起了。做出插件,或者 mcp 协议」**。
 *
 * - **插件那条路**:已经做完(``public/magnet/mooncoda_magnet_bridge.zip``,
 *   `pnpm magnet:addon` 构建)—— 装上之后一打开 Blender 桥接就自动起。
 * - **MCP 这条路**:就是**这个文件** —— 让能驱动 MCP 的 AI 客户端
 *   (Claude Code / Claude Desktop / 任何 MCP host)在本机直接切磁吸孔,
 *   **不用开网页、不用拖文件**。
 *
 * ## 引擎是**同一份代码**
 *
 * 这个服务器调的就是网页那条路调的那两个函数
 * (`magnet-cutter-handler.ts` 的 ``analyzeModel()`` / ``cutMagnetPocket()``)
 * ⇒ **网页上算出来的数,这边算出来是同一个数**。不是「另写一套 MCP 版算法」。
 *
 * ## 三条硬规矩(跟网页那条路一样)
 *
 * 1. **模型不出这台电脑** —— 文件从磁盘读、结果写回磁盘,中间不经过任何
 *    服务器。Blender 那条路也只跟 ``127.0.0.1`` 说话。
 * 2. **不进工单** —— 不碰报价 / 工单 / R2 上传 / 支撑克重那一整套。
 * 3. **不悄悄改用户的模型** —— 破口是**临时**封上的,切完摘掉
 *    (跟网页那条路同一个口径)。
 *
 * ## stdout 是**传输通道**
 *
 * MCP 的 stdio 传输 = **一行一个 JSON-RPC 消息**。⇒ 服务器往 stdout 写的
 * **只有** JSON-RPC 响应;所有日志都走 **stderr**(写 stdout 一行日志就把
 * 协议搅乱了)。
 *
 * ## 跑起来
 *
 * ```bash
 * pnpm magnet:mcp
 * ```
 *
 * MCP 客户端那边这样配(Claude Code):
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "mooncoda-magnet": {
 *       "command": "pnpm",
 *       "args": ["magnet:mcp"],
 *       "cwd": "/path/to/MooncodaCN"
 *     }
 *   }
 * }
 * ```
 *
 * ⚠️ **不会悄悄缩放模型** —— AI 导出的模型坐标常常是归一化的(±1),不是毫米。
 * 这边**只提醒**(`magnet_analyze` 的输出里有一行 ⚠️),不自己改尺寸 ——
 * 缩放多少是人的决定,工具替人改了就该告诉人。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  analyzeModel,
  cutMagnetPocket,
} from "@/features/magnet/lib/magnet-cutter-handler";
import type { MagnetCutOutcome } from "@/features/magnet/lib/magnet-cutter-protocol";
import {
  MAGNET_FACE_IDS,
  type MagnetHoleParams,
  type MagnetTargetId,
  normalizeHoleParams,
  parsePatchTarget,
} from "@/features/magnet/lib/magnet-params";
import {
  handleMcpLine,
  type McpToolHandlers,
  mcpText,
} from "@/features/magnet/lib/mcp-protocol";
import {
  formatAnalyzeReport,
  formatCutReport,
} from "@/features/magnet/lib/mcp-report";
import { writeObjFromSoup } from "@/features/magnet/lib/write-obj";
import {
  detectModelUnitScale,
  measurePositionsSize,
} from "@/features/pricing/lib/model-units";
import {
  parseMtl,
  parseMtllibNames,
  pickMtlFileName,
  rewriteMtlTextureRefs,
} from "@/features/pricing/lib/obj-materials";
import {
  decodeObjBytes,
  describeEmptyObjFile,
} from "@/features/pricing/lib/obj-text";
import { parseObjOnMainThread } from "@/features/pricing/lib/obj-worker-client";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 日志 —— **一律走 stderr**(stdout 是协议通道) */
function log(message: string): void {
  process.stderr.write(`[magnet-mcp] ${message}\n`);
}

/** 相对路径 → 正斜杠(OBJ / zip 里都用正斜杠) */
function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** 一个读进来的模型 + 它的材质附件 */
type LoadedModel = {
  /** 绝对路径 */
  path: string;
  /** OBJ 所在目录 */
  dir: string;
  /** OBJ 文本 */
  objText: string;
  /** 三角汤 */
  positions: Float32Array;
  /** 逐三角形 UV(没有贴图就是 null) */
  uvs: Float32Array | null;
  /** 逐三角形材质下标 */
  materialIndex: Uint16Array | null;
  /** 材质名 */
  materialNames: string[] | null;
  /** 材质表的绝对路径(没有就是 null) */
  mtlPath: string | null;
  /** 材质表相对 OBJ 目录的路径(正斜杠)—— 写进 `mtllib` 那一行 */
  mtlRelToObj: string | null;
  /** 贴图:绝对路径 + 相对材质表目录的相对路径 */
  textures: { abs: string; relToMtl: string }[];
};

/**
 * 读一个 OBJ 文件(连带它的材质表 + 贴图)
 *
 * **按字节读 + 编码嗅探** —— 跟网页那边同一个函数
 * (`obj-text.ts` 的 `decodeObjBytes`)。Windows 上很多工具导出的 OBJ 是
 * UTF-16,按 UTF-8 解出来是一堆乱码。
 */
function loadModel(inputPath: string): LoadedModel {
  const path = resolve(inputPath);
  if (!existsSync(path)) {
    throw new Error(`文件不存在:${path}`);
  }
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`这不是一个文件:${path}`);
  }

  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length === 0) {
    throw new Error(describeEmptyObjFile(0));
  }
  const objText = decodeObjBytes(bytes);

  const parsed = parseObjOnMainThread(objText, true);
  if (!parsed) {
    throw new Error("OBJ 解析失败 —— 文件可能不是 OBJ,或者编码不对");
  }
  if (!parsed.positions || parsed.positions.length < 9) {
    throw new Error("这个 OBJ 里没有三角形 —— 里面可能只有点或者线");
  }

  const dir = dirname(path);
  const mtl = findMtl(objText, dir);
  const textures = mtl.path ? findTextures(mtl.path) : [];

  return {
    path,
    dir,
    objText,
    positions: parsed.positions,
    uvs: parsed.uvs ?? null,
    materialIndex: parsed.materialIndex ?? null,
    materialNames: parsed.materialNames ?? null,
    mtlPath: mtl.path,
    mtlRelToObj: mtl.path ? toPosix(relative(dir, mtl.path)) : null,
    textures,
  };
}

/**
 * 找到配套的材质表
 *
 * **OBJ 里 `mtllib` 指的那个才是配套的** —— 目录里可能有好几个 `.mtl`,
 * 拿「第一个」就是贴图错乱的经典来源(网页那边同一条口径)。
 */
function findMtl(objText: string, objDir: string): { path: string | null } {
  const refs = parseMtllibNames(objText);
  const candidates = readdirSync(objDir).filter((name) =>
    name.toLowerCase().endsWith(".mtl")
  );
  const picked = pickMtlFileName(refs, candidates);
  if (!picked) return { path: null };
  const full = join(objDir, picked);
  return existsSync(full) ? { path: full } : { path: null };
}

/**
 * 材质表里引用到的贴图(只收**磁盘上真的存在**的)
 *
 * 找不到的**不指别的图顶替** —— 那个材质退回本色(跟网页那条路一样)。
 */
function findTextures(mtlPath: string): { abs: string; relToMtl: string }[] {
  let mtlText: string;
  try {
    mtlText = readFileSync(mtlPath, "utf8");
  } catch {
    return [];
  }
  const mtlDir = dirname(mtlPath);
  const out: { abs: string; relToMtl: string }[] = [];
  const seen = new Set<string>();

  for (const material of parseMtl(mtlText)) {
    for (const ref of [material.mapKd, material.mapKs, material.normalMap]) {
      if (!ref) continue;
      if (seen.has(ref)) continue;
      seen.add(ref);
      const abs = resolve(mtlDir, ref);
      if (!existsSync(abs)) continue;
      out.push({ abs, relToMtl: toPosix(relative(mtlDir, abs)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 写回磁盘
// ---------------------------------------------------------------------------

/**
 * 把切好的模型写回磁盘(OBJ + 材质表 + 贴图)
 *
 * **材质表和贴图按原来的相对位置摆** —— 材质表里写的是相对路径
 * (`map_Kd textures/wood.png`),位置一变引用就断了 ⇒ 贴图跟材质表**保持
 * 相对关系**,引用不用改。
 */
function writeModel(
  outPath: string,
  outcome: {
    positions: Float32Array;
    uvs: Float32Array | null;
    materialIndex: Uint16Array | null;
    materialNames: string[] | null;
  },
  source: LoadedModel
): void {
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });

  let mtlRelToObj: string | null = null;
  if (source.mtlPath && source.mtlRelToObj) {
    mtlRelToObj = source.mtlRelToObj;
    const mtlOut = join(outDir, mtlRelToObj);
    mkdirSync(dirname(mtlOut), { recursive: true });
    copyFileSync(source.mtlPath, mtlOut);
    // 贴图跟着材质表走(相对位置不变 ⇒ 材质表里的引用不用改)
    for (const texture of source.textures) {
      const dest = join(dirname(mtlOut), texture.relToMtl);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(texture.abs, dest);
    }
  }

  const objText = writeObjFromSoup(outcome.positions, {
    header: ["Mooncoda 磁吸孔 —— MCP 切出来的"],
    uvs: outcome.uvs,
    materialIndex: outcome.materialIndex,
    materialNames: outcome.materialNames,
    mtlFileName: mtlRelToObj,
  });
  writeFileSync(outPath, objText, "utf8");
}

// ---------------------------------------------------------------------------
// 孔参数 / 目标
// ---------------------------------------------------------------------------

/** 从工具入参里取孔参数 —— 缺省走实物磁铁的尺寸 */
function readHoleParams(args: Record<string, unknown>): MagnetHoleParams {
  return normalizeHoleParams({
    holeDiaMm: args.holeDiaMm as number | undefined,
    holeDepthMm: args.holeDepthMm as number | undefined,
  });
}

/**
 * 从工具入参里取目标面
 *
 * 认不出来就**说清楚认的是什么** —— 别默默切到别的地方去。
 */
function readTarget(args: Record<string, unknown>): MagnetTargetId {
  const raw = typeof args.target === "string" ? args.target.trim() : "";
  if (!raw || raw === "auto") return "auto";
  if (parsePatchTarget(raw) !== null) return raw as MagnetTargetId;
  if ((MAGNET_FACE_IDS as readonly string[]).includes(raw)) {
    return raw as MagnetTargetId;
  }
  throw new Error(
    `认不出要切哪个面:${raw}。` +
      `可以用 "auto"(智能识别出来的最大平面)、"patch:N"(第 N 块候选平面)` +
      `或者六个轴向面之一(${MAGNET_FACE_IDS.join(" / ")})`
  );
}

/** 目标 → 给人看的说法 */
function targetText(target: MagnetTargetId): string {
  if (target === "auto") return "智能识别出来的最大平面(auto)";
  return target;
}

// ---------------------------------------------------------------------------
// 三个工具
// ---------------------------------------------------------------------------

/** `magnet_analyze` —— 只读,不改文件 */
async function toolAnalyze(
  args: Record<string, unknown>
): Promise<{ text: string }> {
  const path = typeof args.path === "string" ? args.path : "";
  if (!path) throw new Error("缺 path —— 要分析哪个 OBJ 文件?");

  const model = loadModel(path);
  const hole = readHoleParams(args);
  const outcome = await analyzeModel(model.positions, hole);

  const size = measurePositionsSize(model.positions);
  const units = detectModelUnitScale(size);

  const text = formatAnalyzeReport(outcome, {
    path: model.path,
    holeDiaMm: hole.holeDiaMm,
    holeDepthMm: hole.holeDepthMm,
    looksLikeNotMillimeters: units.normalized,
    maxEdge: units.originalMaxExtent,
  });

  return { text };
}

/** `magnet_cut` —— 浏览器那条引擎(Manifold3D) */
async function toolCut(
  args: Record<string, unknown>
): Promise<{ text: string }> {
  const path = typeof args.path === "string" ? args.path : "";
  const outPath = typeof args.outPath === "string" ? args.outPath : "";
  if (!path) throw new Error("缺 path —— 要切哪个 OBJ 文件?");
  if (!outPath) throw new Error("缺 outPath —— 切好的模型写到哪里?");

  const model = loadModel(path);
  const hole = readHoleParams(args);
  const target = readTarget(args);

  const outcome: MagnetCutOutcome = await cutMagnetPocket(
    model.positions,
    target,
    hole,
    {
      uvs: model.uvs,
      materialIndex: model.materialIndex,
      materialNames: model.materialNames,
    }
  );

  const outAbs = resolve(outPath);
  writeModel(outAbs, outcome, model);

  const text = formatCutReport(outcome, {
    outPath: outAbs,
    holeDiaMm: hole.holeDiaMm,
    holeDepthMm: hole.holeDepthMm,
    targetText: targetText(target),
  });

  return { text };
}

/**
 * `magnet_cut_blender` —— 用户自己电脑上的 Blender
 *
 * **只跟 `127.0.0.1` 说话** —— 模型不出这台电脑。
 */
async function toolCutBlender(
  args: Record<string, unknown>
): Promise<{ text: string }> {
  const path = typeof args.path === "string" ? args.path : "";
  const outPath = typeof args.outPath === "string" ? args.outPath : "";
  if (!path) throw new Error("缺 path —— 要切哪个 OBJ 文件?");
  if (!outPath) throw new Error("缺 outPath —— 切好的模型写到哪里?");

  const model = loadModel(path);
  const hole = readHoleParams(args);
  const port = Number(args.port ?? 8765);
  const base = `http://127.0.0.1:${Number.isFinite(port) ? port : 8765}`;

  // ---- 打包发给 Blender ----
  const payload: Record<string, Uint8Array> = {
    [basename(model.path)]: strToU8(model.objText),
  };
  let mtlText: string | null = null;
  if (model.mtlPath) {
    mtlText = readFileSync(model.mtlPath, "utf8");
    // 贴图**平铺到根目录** ⇒ 材质表里的引用要改成裸文件名
    const flatNames = new Map<string, string>();
    for (const texture of model.textures) {
      flatNames.set(texture.relToMtl, basename(texture.abs));
    }
    mtlText = rewriteMtlTextureRefs(mtlText, (fileName) => {
      const normalized = toPosix(fileName).replace(/^\.\//, "");
      const hit = flatNames.get(normalized);
      if (hit) return hit;
      // 材质表里写的是裸文件名 —— 直接对上就上
      for (const texture of model.textures) {
        if (basename(texture.abs) === basename(fileName)) {
          return basename(texture.abs);
        }
      }
      return undefined;
    });
    payload[basename(model.mtlPath)] = strToU8(mtlText);
  }
  for (const texture of model.textures) {
    payload[basename(texture.abs)] = new Uint8Array(readFileSync(texture.abs));
  }

  const zipBytes = zipSync(payload, { level: 9 });

  // ---- 送过去 ----
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let res: Response;
  try {
    res = await fetch(`${base}/cut`, {
      method: "POST",
      headers: {
        "content-type": "application/zip",
        "x-magnet-params": JSON.stringify({
          holeDiaMm: hole.holeDiaMm,
          holeDepthMm: hole.holeDepthMm,
        }),
        "x-magnet-protocol": "1",
      },
      body: zipBytes as unknown as BodyInit,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      `连不上本地 Blender(${base})—— 插件起了吗?` +
        `装上插件之后一打开 Blender 就自动起了。` +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || contentType.includes("application/json")) {
    let detail = `HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string; code?: string };
      detail = payload.error ?? detail;
      if (payload.code) detail = `${detail}(code: ${payload.code})`;
    } catch {
      // 解析不了就摆 HTTP 状态
    }
    throw new Error(`本地 Blender 那边切失败了:${detail}`);
  }

  const statsHeader = res.headers.get("x-magnet-stats");
  const resultZip = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(resultZip);

  // ---- 结果写回磁盘 ----
  const outAbs = resolve(outPath);
  const outDir = dirname(outAbs);
  mkdirSync(outDir, { recursive: true });

  let objWritten = false;
  for (const [name, bytes] of Object.entries(files)) {
    if (name.toLowerCase().endsWith(".obj")) {
      writeFileSync(outAbs, strFromU8(bytes), "utf8");
      objWritten = true;
      continue;
    }
    const dest = join(outDir, basename(name));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  if (!objWritten) {
    throw new Error("本地 Blender 回的包里没有 OBJ 文件");
  }

  const lines: string[] = [];
  lines.push(`切好了 → ${outAbs}`);
  lines.push(
    `孔:Ø${hole.holeDiaMm.toFixed(2)}mm × 深 ${hole.holeDepthMm.toFixed(2)}mm(绝对毫米)`
  );
  lines.push("引擎:本地 Blender(EXACT → FAST 兜底)");
  if (statsHeader) {
    try {
      const stats = JSON.parse(statsHeader) as Record<string, unknown>;
      const before = stats.volumeBeforeMm3 as number | undefined;
      const after = stats.volumeAfterMm3 as number | undefined;
      const removed = stats.removedVolumeMm3 as number | undefined;
      if (typeof before === "number" && typeof after === "number") {
        lines.push(
          `体积:${before.toFixed(2)} → ${after.toFixed(2)} mm³` +
            (typeof removed === "number"
              ? `(去掉 ${removed.toFixed(2)} mm³)`
              : "")
        );
      }
      if (typeof stats.triangleCount === "number") {
        lines.push(`三角形:${stats.triangleCount}`);
      }
      const lidCapped = stats.lidCapped as number | undefined;
      const lidStripped = stats.lidStripped as number | undefined;
      if (typeof lidCapped === "number" && lidCapped > 0) {
        lines.push(
          `模型状态:临时封上了 ${lidCapped} 处破口,切完摘掉了 ${lidStripped ?? 0} 张盖面` +
            " —— 你的模型上不会多出几何"
        );
      }
      const warnings = stats.warnings as string[] | undefined;
      if (Array.isArray(warnings) && warnings.length > 0) {
        for (const warning of warnings) lines.push(`提醒:${warning}`);
      }
    } catch {
      // 统计头解析不了不影响结果 —— 跳过
    }
  }

  return { text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// 工具注册 + stdio 循环
// ---------------------------------------------------------------------------

/** 工具名 → 处理器 */
function createHandlers(): McpToolHandlers {
  return {
    magnet_analyze: async (args) => mcpText((await toolAnalyze(args)).text),
    magnet_cut: async (args) => mcpText((await toolCut(args)).text),
    magnet_cut_blender: async (args) =>
      mcpText((await toolCutBlender(args)).text),
  };
}

/**
 * 跑起来
 *
 * **一行一个 JSON-RPC 消息** —— 逐行解析,不用管消息边界。
 */
async function main(): Promise<void> {
  const handlers = createHandlers();
  log("磁吸孔 MCP 服务器已启动(stdio)");

  let buffer = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const response = await handleMcpLine(line, handlers);
        if (response) process.stdout.write(`${response}\n`);
      } catch (err) {
        // 兜底:协议层自己已经处理了大部分错误 —— 走到这儿说明是意外
        log(`处理消息时炸了:${err instanceof Error ? err.message : err}`);
      }
      index = buffer.indexOf("\n");
    }
  }
  log("stdin 关了,退出");
}

main().catch((err) => {
  log(`启动失败:${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
