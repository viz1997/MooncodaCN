"use client";

/**
 * 移植自 wjp-source-code/src/lib/obj-worker-client.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * OBJ Web Worker client.
 *
 * Uses a Blob URL to spin up a Worker so we don't need any webpack worker-loader
 * config. The worker parses the OBJ text off the main thread and returns:
 *   - vertexCount / faceCount / triangleCount / uvCount
 *   - bounding box (min/max/size as [x,y,z] tuples)
 *   - volume (signed tetrahedra method, absolute value)
 *   - surface area (triangle area sum)
 *   - optional Float32Array positions (triangle soup: 9 floats per triangle)
 *   - optional Float32Array uvs     (6 floats per triangle, parsed from `vt` lines)
 *
 * Faces with >3 vertices are triangulated as a fan: (v0,v1,v2),(v0,v2,v3),...
 *
 * Progress is reported in three phases (vertices / faces / geometry) with a
 * percent value in the 0–95 range (95 = work done, 100 emitted by caller).
 * The worker is forcibly terminated after a 30s timeout.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ObjWorkerProgress = {
  phase: "vertices" | "faces" | "geometry";
  /** 0-95 — caller may bump to 100 when the promise resolves */
  percent: number;
};

export type ObjWorkerResult = {
  vertexCount: number;
  faceCount: number;
  triangleCount: number;
  uvCount: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  volumeMM3: number;
  volumeCM3: number;
  surfaceAreaMM2: number;
  surfaceAreaCM2: number;
  /** Triangle-soup positions, 9 floats per triangle. Present only when sendGeometry = true */
  positions?: Float32Array;
  /** Per-vertex UVs, 6 floats per triangle. Present only when sendGeometry = true and `vt` lines exist */
  uvs?: Float32Array;
  /**
   * `usemtl` 声明的材质名,按首次出现顺序。
   *
   * Present only when sendGeometry = true and the OBJ actually declares materials.
   * 材质分组是「每个材质挂自己的贴图」的前提 —— 丢掉它就只能整块模型挂一张图。
   */
  materialNames?: string[];
  /** 每个三角形一个材质下标(指向 materialNames)。与 positions 的三角形顺序一一对应 */
  materialIndex?: Uint16Array;
  /**
   * OBJ 里 `mtllib` 声明的材质表文件名。
   *
   * 压缩包里可能有好几个 `.mtl`,真正配套的那个由 `mtllib` 指明 ——
   * 拿「第一个 .mtl」就是贴图错乱的常见来源。
   */
  mtllibNames?: string[];
};

export type ObjWorkerError = {
  message: string;
};

export type ObjWorkerOptions = {
  /** If true, the worker builds and transfers Float32Array positions + uvs. */
  sendGeometry?: boolean;
  /** Progress callback (0-95). */
  onProgress?: (progress: ObjWorkerProgress) => void;
  /** Override the default 30s timeout (ms). */
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Worker script (inline string, served via Blob URL)
// ---------------------------------------------------------------------------

/**
 * Worker 源码(纯字符串,导出供单测在 Node 里直接跑)。
 */
export const WORKER_SOURCE = `
"use strict";
self.onmessage = function (e) {
  try {
    var data = e.data || {};
    var objText = data.objText || '';
    var sendGeometry = !!data.sendGeometry;
    if (!objText) {
      self.postMessage({ type: 'error', message: '空 OBJ 文本' });
      return;
    }

    var lines = objText.split(/\\r?\\n/);
    var totalLines = lines.length;

    // ---- Pass 1: vertices + uvs (0-30%) -----------------------------------
    var vertices = [];  // flat [x,y,z, ...]
    var uvs = [];       // flat [u,v, ...]
    var faces = [];     // each entry: { v: number[], t: number[], m: number } (顶点下标 / 贴图下标 / 材质下标, 0-based)
    var materialNames = [];        // usemtl 材质名,按首次出现顺序
    var materialLookup = {};       // 材质名 → materialNames 下标
    var currentMaterial = -1;      // 当前 usemtl 指向的材质下标(-1 = 还没声明过)
    var mtllibNames = [];          // OBJ 声明的 mtllib 文件名

    var i, j, line, sp, cmd, rest, parts;

    for (i = 0; i < totalLines; i++) {
      line = lines[i];
      var trimStart = 0;
      while (trimStart < line.length && (line.charCodeAt(trimStart) === 32 || line.charCodeAt(trimStart) === 9)) trimStart++;
      line = line.substring(trimStart);
      if (!line) continue;
      if (line.charAt(0) === '#') continue;

      sp = line.indexOf(' ');
      if (sp < 0) sp = line.indexOf('\\t');
      if (sp < 0) continue;
      cmd = line.substring(0, sp);
      rest = line.substring(sp + 1).trim();

      if (cmd === 'v') {
        parts = rest.split(/\\s+/);
        vertices.push(parseFloat(parts[0]) || 0);
        vertices.push(parseFloat(parts[1]) || 0);
        vertices.push(parseFloat(parts[2]) || 0);
      } else if (cmd === 'vt') {
        parts = rest.split(/\\s+/);
        uvs.push(parseFloat(parts[0]) || 0);
        uvs.push(parseFloat(parts[1]) || 0);
      } else if (cmd === 'mtllib') {
        // mtllib 一行可以写多个文件名
        var mtlTokens = rest.split(/\\s+/);
        for (j = 0; j < mtlTokens.length; j++) {
          if (mtlTokens[j]) mtllibNames.push(mtlTokens[j]);
        }
      }

      if ((i & 8191) === 0) {
        self.postMessage({
          type: 'progress',
          phase: 'vertices',
          percent: Math.min(30, ((i / totalLines) * 30) | 0),
        });
      }
    }

    var vertexCount = (vertices.length / 3) | 0;
    var uvCount = (uvs.length / 2) | 0;

    // ---- Pass 2: faces (30-70%) -------------------------------------------
    // 到目前为止已经出现的 v / vt 数量 —— 负下标按它解析(见下方说明)
    var vSeen = 0;
    var vtSeen = 0;
    for (i = 0; i < totalLines; i++) {
      line = lines[i];
      var s = 0;
      while (s < line.length && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
      line = line.substring(s);
      if (!line || line.charAt(0) === '#') continue;

      sp = line.indexOf(' ');
      if (sp < 0) sp = line.indexOf('\\t');
      if (sp < 0) continue;
      cmd = line.substring(0, sp);
      rest = line.substring(sp + 1).trim();

      // v / vt 计数 —— 负下标按「到该行为止」的数量解析
      if (cmd === 'v') { vSeen++; continue; }
      if (cmd === 'vt') { vtSeen++; continue; }

      // usemtl 切换当前材质 —— 之后的每个面都归它
      if (cmd === 'usemtl') {
        var mname = rest.trim();
        if (mname) {
          if (materialLookup[mname] === undefined) {
            materialLookup[mname] = materialNames.length;
            materialNames.push(mname);
          }
          currentMaterial = materialLookup[mname];
        }
        continue;
      }
      if (cmd !== 'f') continue;

      var tokens = rest.split(/\\s+/);
      var vIdx = [];
      var tIdx = [];
      for (j = 0; j < tokens.length; j++) {
        var tok = tokens[j];
        if (!tok) continue;
        var slashes = tok.split('/');
        var vi = parseInt(slashes[0], 10);
        var ti = slashes.length > 1 && slashes[1] ? parseInt(slashes[1], 10) : NaN;
        // 负下标按「到该行为止已经出现的 v / vt 数量」解析,而不是整个文件的数量。
        //
        // OBJ 规范说 -N 是「从文件末尾数第 N 个」,但很多导出器是流式写文件的:
        // 每写一个面就紧跟写它自己的几个 vt,面里用 -3 -2 -1 引用「刚写的那几个」。
        // 按规范解析的话,每个面都会拿到文件最后几个 vt —— 整张模型的 UV 全变成
        // 同几个点,贴图采样出来是一整块纯色(看起来就是「模型没有贴图」)。
        // 常规文件(v / vt 全写在 f 之前)两种解析结果完全一致,没有回归。
        if (vi > 0) vIdx.push(vi - 1);
        else if (vi < 0) vIdx.push(vSeen + vi);
        else continue; // 顶点下标非法 → 整个角丢掉(vIdx / tIdx 必须等长)
        // 该角没有 vt → 记 -1,后面逐角兜底(而不是让整面 UV 归零)
        if (ti > 0) tIdx.push(ti - 1);
        else if (ti < 0) tIdx.push(vtSeen + ti);
        else tIdx.push(-1);
      }
      if (vIdx.length >= 3) faces.push({ v: vIdx, t: tIdx, m: currentMaterial });

      if ((i & 8191) === 0) {
        self.postMessage({
          type: 'progress',
          phase: 'faces',
          percent: 30 + Math.min(40, ((i / totalLines) * 40) | 0),
        });
      }
    }

    // ---- Pass 3: bounding box, volume, surface area, geometry (70-95%) -----
    var minX = Infinity, minY = Infinity, minZ = Infinity;
    var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (i = 0; i < vertices.length; i += 3) {
      var x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!isFinite(minX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }

    // Pre-compute total triangle count for exact buffer allocation
    var totalTriangles = 0;
    for (i = 0; i < faces.length; i++) {
      var n = faces[i].v.length;
      if (n >= 3) totalTriangles += (n - 2);
    }

    var positions = null;
    var uvArray = null;
    var materialIndex = null;
    if (sendGeometry) {
      positions = new Float32Array(totalTriangles * 9);
      if (uvCount > 0) uvArray = new Float32Array(totalTriangles * 6);
      if (materialNames.length > 0) materialIndex = new Uint16Array(totalTriangles);
    }
    var posIdx = 0;
    var uvIdx2 = 0;

    var signedVolume = 0;
    var surfaceArea = 0;
    var triangleCount = 0;

    for (i = 0; i < faces.length; i++) {
      var f = faces[i];
      var vi = f.v;
      var ti2 = f.t;
      var nv = vi.length;
      if (nv < 3) continue;

      // 逐角取 UV —— 该角没有 vt 就退 (0,0),不再让整面 UV 归零
      var hasUv = uvArray !== null && ti2.length === nv;
      var t0 = hasUv ? ti2[0] : -1;

      for (j = 1; j < nv - 1; j++) {
        var a0 = vi[0] * 3;
        var a1 = vi[j] * 3;
        var a2 = vi[j + 1] * 3;

        var v0x = vertices[a0], v0y = vertices[a0 + 1], v0z = vertices[a0 + 2];
        var v1x = vertices[a1], v1y = vertices[a1 + 1], v1z = vertices[a1 + 2];
        var v2x = vertices[a2], v2y = vertices[a2 + 1], v2z = vertices[a2 + 2];

        // Signed tetrahedron volume (origin, v0, v1, v2) = (v0 . (v1 x v2)) / 6
        var cx = v1y * v2z - v1z * v2y;
        var cy = v1z * v2x - v1x * v2z;
        var cz = v1x * v2y - v1y * v2x;
        signedVolume += (v0x * cx + v0y * cy + v0z * cz) / 6;

        // Triangle area = |(v1-v0) x (v2-v0)| / 2
        var e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
        var e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
        var ax = e1y * e2z - e1z * e2y;
        var ay = e1z * e2x - e1x * e2z;
        var az = e1x * e2y - e1y * e2x;
        var len = Math.sqrt(ax * ax + ay * ay + az * az);
        surfaceArea += len / 2;

        triangleCount++;

        if (materialIndex) {
          // -1 = 还没声明 usemtl → 归到第一个材质
          materialIndex[triangleCount - 1] = f.m >= 0 ? f.m : 0;
        }

        if (positions) {
          positions[posIdx++] = v0x; positions[posIdx++] = v0y; positions[posIdx++] = v0z;
          positions[posIdx++] = v1x; positions[posIdx++] = v1y; positions[posIdx++] = v1z;
          positions[posIdx++] = v2x; positions[posIdx++] = v2y; positions[posIdx++] = v2z;

          if (uvArray) {
            // 逐角兜底:该角没有 vt → (0,0),其余角照旧
            var tu0 = t0;
            var tu1 = hasUv ? ti2[j] : -1;
            var tu2 = hasUv ? ti2[j + 1] : -1;
            uvArray[uvIdx2++] = tu0 >= 0 ? uvs[tu0 * 2] : 0;
            uvArray[uvIdx2++] = tu0 >= 0 ? uvs[tu0 * 2 + 1] : 0;
            uvArray[uvIdx2++] = tu1 >= 0 ? uvs[tu1 * 2] : 0;
            uvArray[uvIdx2++] = tu1 >= 0 ? uvs[tu1 * 2 + 1] : 0;
            uvArray[uvIdx2++] = tu2 >= 0 ? uvs[tu2 * 2] : 0;
            uvArray[uvIdx2++] = tu2 >= 0 ? uvs[tu2 * 2 + 1] : 0;
          }
        }
      }

      if ((i & 2047) === 0) {
        self.postMessage({
          type: 'progress',
          phase: 'geometry',
          percent: 70 + Math.min(25, ((i / faces.length) * 25) | 0),
        });
      }
    }

    var volumeMM3 = Math.abs(signedVolume);
    var volumeCM3 = volumeMM3 / 1000;
    var surfaceAreaMM2 = surfaceArea;
    var surfaceAreaCM2 = surfaceArea / 100;

    var result = {
      vertexCount: vertexCount,
      faceCount: faces.length,
      triangleCount: triangleCount,
      uvCount: uvCount,
      boundingBox: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size: [Math.abs(maxX - minX), Math.abs(maxY - minY), Math.abs(maxZ - minZ)],
      },
      volumeMM3: volumeMM3,
      volumeCM3: volumeCM3,
      surfaceAreaMM2: surfaceAreaMM2,
      surfaceAreaCM2: surfaceAreaCM2,
      mtllibNames: mtllibNames,
    };

    if (sendGeometry && positions) {
      result.positions = positions;
      if (uvArray && uvIdx2 > 0) {
        // Trim UV buffer in case some faces had no UVs (already zero-filled above, but keep slice for safety)
        result.uvs = uvArray.length === uvIdx2 ? uvArray : uvArray.slice(0, uvIdx2);
      }
      if (materialIndex) {
        result.materialNames = materialNames;
        result.materialIndex = materialIndex;
      }
    }

    var transfer = [];
    if (result.positions) transfer.push(result.positions.buffer);
    if (result.uvs) transfer.push(result.uvs.buffer);
    if (result.materialIndex) transfer.push(result.materialIndex.buffer);

    self.postMessage({ type: 'result', result: result }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) ? err.message : String(err) });
  }
};
`;

// Cache the Blob URL across calls (re-created lazily if revoked)
let cachedBlobUrl: string | null = null;

function getWorkerUrl(): string {
  if (cachedBlobUrl) return cachedBlobUrl;
  const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
  cachedBlobUrl = URL.createObjectURL(blob);
  return cachedBlobUrl;
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Parse an OBJ file in a Web Worker.
 *
 * @param objText Raw OBJ text (UTF-8).
 * @param options { sendGeometry, onProgress, timeoutMs }
 * @returns Promise<ObjWorkerResult>
 */
export function parseObjInWorker(
  objText: string,
  options: ObjWorkerOptions = {}
): Promise<ObjWorkerResult> {
  const { sendGeometry = false, onProgress, timeoutMs = 30_000 } = options;

  return new Promise<ObjWorkerResult>((resolve, reject) => {
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        worker = null;
      }
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("OBJ 解析超时（30s）"));
    }, timeoutMs);

    try {
      worker = new Worker(getWorkerUrl());
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `创建 Worker 失败：${err instanceof Error ? err.message : String(err)}`
        )
      );
      return;
    }

    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as
        | {
            type: "progress";
            phase: ObjWorkerProgress["phase"];
            percent: number;
          }
        | { type: "result"; result: ObjWorkerResult }
        | { type: "error"; message: string };

      if (data.type === "progress") {
        if (onProgress) {
          try {
            onProgress({ phase: data.phase, percent: data.percent });
          } catch {
            /* ignore caller errors */
          }
        }
        return;
      }

      if (data.type === "result") {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data.result);
        return;
      }

      if (data.type === "error") {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(data.message || "Worker 解析错误"));
        return;
      }
    };

    worker.onerror = (err: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(err.message || "Worker 解析错误"));
    };

    worker.postMessage({ objText, sendGeometry });
  });
}

// Revoke the cached Blob URL on page unload (best-effort).
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (cachedBlobUrl) {
      URL.revokeObjectURL(cachedBlobUrl);
      cachedBlobUrl = null;
    }
  });
}
