"use client";

/**
 * 移植自 wjp-source-code/src/lib/zip-extractor.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
import JSZip from "jszip";
import { createExtractorFromData } from "node-unrar-js";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { ObjParseResult, Vec3 } from "./obj-parser";
import { type ObjWorkerResult, parseObjInWorker } from "./obj-worker-client";
import { loadUnrarWasm } from "./unrar-wasm-loader";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ModelFile = {
  name: string; // file name (without extension)
  objFileName: string;
  mtlFileName?: string | undefined;
  textureFileNames: string[];
  objText: string;
  mtlText?: string | undefined; // MTL file content (for 3D viewer)
  parseResult: ObjParseResult;
  previewUrl?: string | undefined; // object URL for the first PNG texture (for thumbnail)
  /** 所有纹理文件的 Blob（用于导出 ZIP 时保留原始纹理） */
  textureBlobs?: { name: string; blob: Blob }[] | undefined;
};

export type ZipExtractResult = {
  model: ModelFile | null;
  allFiles: { name: string; size: number }[];
  error?: string | undefined;
};

export type ExtractProgress = {
  /** 'unzip' = decompressing / reading file bytes; 'parse' = OBJ worker parsing */
  phase: "unzip" | "parse";
  /** 0-100 */
  percent: number;
};

// ---------------------------------------------------------------------------
// Internal: convert Worker output to existing ObjParseResult shape
// (page.tsx reads `parseResult.boundingBox.size.x/y/z`)
// ---------------------------------------------------------------------------

function workerResultToParseResult(r: ObjWorkerResult): ObjParseResult {
  const [sx, sy, sz] = r.boundingBox.size;
  const [mnX, mnY, mnZ] = r.boundingBox.min;
  const [mxX, mxY, mxZ] = r.boundingBox.max;

  const min: Vec3 = { x: mnX, y: mnY, z: mnZ };
  const max: Vec3 = { x: mxX, y: mxY, z: mxZ };
  const size: Vec3 = { x: sx, y: sy, z: sz };

  return {
    vertexCount: r.vertexCount,
    faceCount: r.faceCount,
    triangleCount: r.triangleCount,
    boundingBox: { min, max, size },
    volumeMM3: r.volumeMM3,
    volumeCM3: r.volumeCM3,
    surfaceAreaMM2: r.surfaceAreaMM2,
    surfaceAreaCM2: r.surfaceAreaCM2,
  };
}

// Small helper: yield to the UI thread so progress callbacks can paint.
const yieldToUI = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Public: dispatch by file extension
// ---------------------------------------------------------------------------

/**
 * Extract and parse an uploaded model file.
 *
 * Accepts:
 *   - `.zip` — looks for *.obj (required), *.mtl (optional), *.png/*.jpg/*.jpeg (textures)
 *   - `.rar` / `.cbr` — RAR archive (uses node-unrar-js, pure WASM, runs in browser)
 *   - `.obj` — reads text directly (no textures / MTL)
 *
 * Both branches parse the OBJ via a Web Worker (off the main thread) and
 * report progress through `onProgress`.
 */
export async function extractModelZip(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".obj")) {
    return extractDirectObj(file, onProgress);
  }
  if (lower.endsWith(".stl")) {
    return extractStl(file, onProgress);
  }
  if (lower.endsWith(".ply")) {
    return extractPly(file, onProgress);
  }
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) {
    return extractGlb(file, onProgress);
  }
  if (lower.endsWith(".zip")) {
    return extractZip(file, onProgress);
  }
  if (lower.endsWith(".rar") || lower.endsWith(".cbr")) {
    return extractRar(file, onProgress);
  }
  return {
    model: null,
    allFiles: [],
    error:
      "不支持的文件类型，请上传 .zip / .rar / .obj / .stl / .ply / .glb 文件",
  };
}

// ---------------------------------------------------------------------------
// Public helper: parse a direct .obj file
// ---------------------------------------------------------------------------

export async function extractDirectObj(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  try {
    onProgress?.({ phase: "unzip", percent: 5 });

    const objText = await file.text();
    onProgress?.({ phase: "unzip", percent: 25 });

    // Yield so the UI can paint the "parsing…" state before we kick off the worker
    await yieldToUI();

    onProgress?.({ phase: "parse", percent: 30 });

    const workerResult = await parseObjInWorker(objText, {
      sendGeometry: false,
      onProgress: (wp) => {
        // Worker reports 0-95; remap to 30-95 for our overall progress
        const pct = 30 + Math.round((wp.percent / 95) * 65);
        onProgress?.({ phase: "parse", percent: pct });
      },
    });

    onProgress?.({ phase: "parse", percent: 100 });

    const parseResult = workerResultToParseResult(workerResult);

    if (parseResult.vertexCount === 0) {
      return {
        model: null,
        allFiles: [{ name: file.name, size: file.size }],
        error: "OBJ 文件解析失败，未找到顶点数据",
      };
    }

    const baseName = file.name.split("/").pop() || file.name;
    const nameWithoutExt = baseName.replace(/\.[^.]+$/, "");

    return {
      model: {
        name: nameWithoutExt,
        objFileName: file.name,
        textureFileNames: [],
        objText,
        parseResult,
      },
      allFiles: [{ name: file.name, size: file.size }],
    };
  } catch (err) {
    return {
      model: null,
      allFiles: [],
      error: `OBJ 解析失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Public helper: convert STL / PLY / GLB to OBJ text, then parse
// ---------------------------------------------------------------------------

/**
 * 将 THREE.BufferGeometry 转换为 OBJ 格式文本
 *
 * 遍历所有三角面，输出 v (顶点) 和 f (面) 行。
 */
function geometryToObjText(geometry: THREE.BufferGeometry): string {
  const positions = geometry.attributes.position;
  if (!positions || positions.count === 0) return "";

  const index = geometry.index;
  const lines: string[] = [];

  // 输出所有顶点
  for (let i = 0; i < positions.count; i++) {
    lines.push(
      `v ${positions.getX(i)} ${positions.getY(i)} ${positions.getZ(i)}`
    );
  }

  // 输出面（三角形 fan 或 indexed）
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i) + 1;
      const b = index.getX(i + 1) + 1;
      const c = index.getX(i + 2) + 1;
      lines.push(`f ${a} ${b} ${c}`);
    }
  } else {
    for (let i = 0; i < positions.count; i += 3) {
      lines.push(`f ${i + 1} ${i + 2} ${i + 3}`);
    }
  }

  return lines.join("\n");
}

/**
 * 从 GLTF scene 中提取所有 Mesh 的几何体，合并为一个 BufferGeometry
 */
function mergeSceneGeometries(scene: THREE.Object3D): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      // 克隆几何体并应用 mesh 的世界变换
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      geometries.push(geo);
    }
  });
  if (geometries.length === 0) return new THREE.BufferGeometry();
  if (geometries.length === 1) return geometries[0]!;
  // 使用 BufferGeometryUtils.mergeGeometries（内联实现以避免额外导入）
  const merged = new THREE.BufferGeometry();
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geometries) {
    totalVerts += g.attributes.position!.count;
    totalIndices += g.index ? g.index.count : g.attributes.position!.count;
  }
  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);
  let posOffset = 0;
  let idxOffset = 0;
  let vertOffset = 0;
  for (const g of geometries) {
    const pos = g.attributes.position!;
    positions.set(pos.array as Float32Array, posOffset);
    posOffset += pos.count * 3;
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices[idxOffset++] = g.index.getX(i) + vertOffset;
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[idxOffset++] = i + vertOffset;
      }
    }
    vertOffset += pos.count;
  }
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/**
 * 通用：从 BufferGeometry 解析并返回 ModelFile
 */
async function geometryToModel(
  geometry: THREE.BufferGeometry,
  fileName: string,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  try {
    // 确保 geometry 有 position 属性
    if (
      !geometry.attributes.position ||
      geometry.attributes.position.count === 0
    ) {
      return {
        model: null,
        allFiles: [],
        error: "模型几何体为空，未找到顶点数据",
      };
    }

    onProgress?.({ phase: "unzip", percent: 50 });

    // 转换为 OBJ 文本
    const objText = geometryToObjText(geometry);

    onProgress?.({ phase: "parse", percent: 60 });

    await yieldToUI();

    // 用 Worker 解析 OBJ 文本（获取体积、表面积、包围盒等）
    const workerResult = await parseObjInWorker(objText, {
      sendGeometry: false,
      onProgress: (wp) => {
        const pct = 60 + Math.round((wp.percent / 95) * 35);
        onProgress?.({ phase: "parse", percent: pct });
      },
    });

    onProgress?.({ phase: "parse", percent: 100 });

    const parseResult = workerResultToParseResult(workerResult);
    if (parseResult.vertexCount === 0) {
      return { model: null, allFiles: [], error: "解析失败，未找到顶点数据" };
    }

    const baseName = fileName.split("/").pop() || fileName;
    const nameWithoutExt = baseName.replace(/\.[^.]+$/, "");

    return {
      model: {
        name: nameWithoutExt,
        objFileName: fileName,
        textureFileNames: [],
        objText,
        parseResult,
      },
      allFiles: [{ name: fileName, size: 0 }],
    };
  } catch (err) {
    return {
      model: null,
      allFiles: [],
      error: `解析失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 解析 STL 文件
 */
export async function extractStl(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  try {
    onProgress?.({ phase: "unzip", percent: 10 });
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.({ phase: "unzip", percent: 40 });

    const loader = new STLLoader();
    const geometry = loader.parse(arrayBuffer);

    return geometryToModel(geometry, file.name, onProgress);
  } catch (err) {
    return {
      model: null,
      allFiles: [],
      error: `STL 解析失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 解析 PLY 文件
 */
export async function extractPly(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  try {
    onProgress?.({ phase: "unzip", percent: 10 });
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.({ phase: "unzip", percent: 40 });

    const loader = new PLYLoader();
    const geometry = loader.parse(arrayBuffer);

    return geometryToModel(geometry, file.name, onProgress);
  } catch (err) {
    return {
      model: null,
      allFiles: [],
      error: `PLY 解析失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 解析 GLB / GLTF 文件
 */
export async function extractGlb(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  try {
    onProgress?.({ phase: "unzip", percent: 10 });
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.({ phase: "unzip", percent: 30 });

    const loader = new GLTFLoader();
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(arrayBuffer, "", resolve, reject);
    });

    onProgress?.({ phase: "unzip", percent: 45 });

    // 合并 scene 中所有 Mesh 的几何体
    const geometry = mergeSceneGeometries(gltf.scene || gltf.scenes[0]);

    return geometryToModel(geometry, file.name, onProgress);
  } catch (err) {
    return {
      model: null,
      allFiles: [],
      error: `GLB/GLTF 解析失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Public helper: extract from a ZIP archive
// ---------------------------------------------------------------------------

export async function extractZip(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  try {
    onProgress?.({ phase: "unzip", percent: 5 });

    const zip = await JSZip.loadAsync(file);
    const allFiles: { name: string; size: number }[] = [];

    const entries = Object.values(zip.files);
    let processed = 0;
    // 收集所有 OBJ 文件（组合模型可能包含多个）
    const objFiles: { entry: JSZip.JSZipObject; name: string }[] = [];
    let mtlFileName: string | undefined;
    const textureFileNames: string[] = [];
    let firstTextureBlob: Blob | null = null;
    const textureBlobs: { name: string; blob: Blob }[] = [];

    for (const entry of entries) {
      if (entry.dir) {
        processed++;
        continue;
      }
      allFiles.push({ name: entry.name, size: 0 });
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".obj")) {
        objFiles.push({ entry, name: entry.name });
      } else if (lower.endsWith(".mtl") && !mtlFileName) {
        mtlFileName = entry.name;
      } else if (
        lower.endsWith(".png") ||
        lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg") ||
        lower.endsWith(".bmp") ||
        lower.endsWith(".tga") ||
        lower.endsWith(".tiff") ||
        lower.endsWith(".tif") ||
        lower.endsWith(".webp")
      ) {
        textureFileNames.push(entry.name);
        const blob = await entry.async("blob");
        textureBlobs.push({ name: entry.name, blob });
        if (!firstTextureBlob) {
          firstTextureBlob = blob;
        }
      }
      processed++;
      onProgress?.({
        phase: "unzip",
        percent: Math.min(
          25,
          5 + Math.floor((processed / Math.max(entries.length, 1)) * 20)
        ),
      });
    }

    if (objFiles.length === 0) {
      return {
        model: null,
        allFiles,
        error: "压缩包内未找到 .obj 文件，请确认压缩包包含 OBJ 模型",
      };
    }

    onProgress?.({ phase: "unzip", percent: 28 });

    // 读取所有 OBJ 文件内容并合并
    // 组合模型：多个 OBJ 文件的顶点/面数据拼接在一起
    // 顶点索引需要偏移（每个文件的顶点从上一个文件的最大索引+1开始）
    let combinedObjText = "";
    let vertexOffset = 0;
    for (let i = 0; i < objFiles.length; i++) {
      const { entry } = objFiles[i]!;
      let text: string = await entry.async("text");
      if (i > 0) {
        // 偏移顶点索引：v 不变，f 的索引加上 vertexOffset
        text = text
          .split("\n")
          .map((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("f ")) {
              // 偏移面索引
              return line
                .split(/\s+/)
                .map((token) => {
                  if (token === "f") return token;
                  const parts = token.split("/");
                  const vIdx = parseInt(parts[0] ?? "", 10);
                  if (vIdx > 0) parts[0] = String(vIdx + vertexOffset);
                  else if (vIdx < 0) parts[0] = String(vIdx - vertexOffset); // 负索引
                  return parts.join("/");
                })
                .join(" ");
            }
            return line;
          })
          .join("\n");
      }
      combinedObjText += `${text}\n`;
      // 计算这个文件的顶点数用于偏移
      const vCount = (text.match(/^v\s/gm) || []).length;
      vertexOffset += vCount;
      onProgress?.({
        phase: "unzip",
        percent: Math.min(30, 28 + Math.floor(((i + 1) / objFiles.length) * 2)),
      });
    }

    const objText = combinedObjText;
    const objFileName =
      objFiles.length === 1
        ? objFiles[0]!.name
        : `${objFiles.length} 个 OBJ 合并`;
    onProgress?.({ phase: "unzip", percent: 30 });

    // Yield so the UI can paint before kicking off the worker
    await yieldToUI();

    // Parse OBJ via Web Worker (off main thread)
    const workerResult = await parseObjInWorker(objText, {
      sendGeometry: false,
      onProgress: (wp) => {
        const pct = 30 + Math.round((wp.percent / 95) * 65);
        onProgress?.({ phase: "parse", percent: pct });
      },
    });

    onProgress?.({ phase: "parse", percent: 100 });

    const parseResult = workerResultToParseResult(workerResult);

    if (parseResult.vertexCount === 0) {
      return {
        model: null,
        allFiles,
        error: "OBJ 文件解析失败，未找到顶点数据",
      };
    }

    // 模型名称：单个文件取文件名，多个文件用合并名
    let nameWithoutExt: string;
    if (objFiles.length === 1) {
      const baseName = objFiles[0]!.name.split("/").pop() || objFiles[0]!.name;
      nameWithoutExt = baseName.replace(/\.[^.]+$/, "");
    } else {
      nameWithoutExt = `组合模型(${objFiles.length})`;
    }

    // Read MTL text if present (for 3D viewer)
    let mtlText: string | undefined;
    if (mtlFileName) {
      const mtlEntry = zip.file(mtlFileName);
      if (mtlEntry) {
        mtlText = await mtlEntry.async("text");
      }
    }

    // 根据 MTL 中的 map_Kd 指定的文件名匹配正确的贴图
    let previewUrl: string | undefined;
    let correctTextureBlob: Blob | null = firstTextureBlob;
    if (mtlText) {
      // 解析 MTL 中的 map_Kd 行，提取贴图文件名
      const mapKdMatch = mtlText.match(/^\s*map_Kd\s+(.+)$/im);
      if (mapKdMatch) {
        const mapKdFileName = mapKdMatch[1]!.trim().replace(/\\/g, "/");
        // 从 textureBlobs 中查找匹配的贴图
        const matchedBlob = textureBlobs.find((tb) => {
          const tbName = tb.name.replace(/\\/g, "/");
          // 匹配文件名（忽略路径，只比较文件名部分）
          const tbBase = tbName.split("/").pop()?.toLowerCase();
          const mapBase = mapKdFileName.split("/").pop()?.toLowerCase();
          return tbBase === mapBase;
        });
        if (matchedBlob) {
          correctTextureBlob = matchedBlob.blob;
        }
      }
    }
    if (correctTextureBlob) {
      previewUrl = URL.createObjectURL(correctTextureBlob);
    }

    return {
      model: {
        name: nameWithoutExt,
        objFileName,
        mtlFileName,
        textureFileNames,
        objText,
        mtlText,
        parseResult,
        previewUrl,
        textureBlobs,
      },
      allFiles,
    };
  } catch (err) {
    return {
      model: null,
      allFiles: [],
      error: `解压失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Public helper: extract from a RAR archive (uses node-unrar-js, WASM-based)
// ---------------------------------------------------------------------------

export async function extractRar(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ZipExtractResult> {
  try {
    onProgress?.({ phase: "unzip", percent: 5 });

    // Read file as ArrayBuffer for node-unrar-js
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.({ phase: "unzip", percent: 10 });

    // Pre-load WASM binary (avoids runtime path resolution issues with Turbopack)
    const wasmBinary = await loadUnrarWasm();
    onProgress?.({ phase: "unzip", percent: 20 });

    // Create WASM-based extractor with preloaded binary
    const extractor = await createExtractorFromData({
      data: arrayBuffer,
      wasmBinary,
    });
    onProgress?.({ phase: "unzip", percent: 25 });

    // List all files in the archive
    const list = extractor.getFileList();
    const allFiles: { name: string; size: number }[] = [];
    const objFiles: { name: string }[] = [];
    let mtlFileName: string | undefined;
    const textureFileNames: string[] = [];

    for (const fh of list.fileHeaders) {
      if (fh.flags.directory) continue;
      allFiles.push({ name: fh.name, size: fh.unpSize });
      const lower = fh.name.toLowerCase();
      if (lower.endsWith(".obj")) {
        objFiles.push({ name: fh.name });
      } else if (lower.endsWith(".mtl") && !mtlFileName) {
        mtlFileName = fh.name;
      } else if (
        lower.endsWith(".png") ||
        lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg")
      ) {
        textureFileNames.push(fh.name);
      }
    }

    if (objFiles.length === 0) {
      return {
        model: null,
        allFiles,
        error: "RAR 压缩包内未找到 .obj 文件，请确认压缩包包含 OBJ 模型",
      };
    }

    onProgress?.({ phase: "unzip", percent: 28 });

    // Extract all files (we need OBJ + MTL + textures)
    // Extract only the files we care about (OBJ, MTL, textures)
    const wantedNames = new Set<string>();
    for (const f of objFiles) wantedNames.add(f.name);
    if (mtlFileName) wantedNames.add(mtlFileName);
    for (const t of textureFileNames) wantedNames.add(t);

    const extracted = extractor.extract({
      files: (fh) => wantedNames.has(fh.name),
    });

    // Collect extracted file contents
    const fileContents = new Map<string, Uint8Array>();
    let firstTextureBlob: Blob | null = null;
    const rarTextureBlobs: { name: string; blob: Blob }[] = [];
    for (const arcFile of extracted.files) {
      const name = arcFile.fileHeader.name;
      const content = arcFile.extraction;
      if (content) {
        fileContents.set(name, content as Uint8Array);
        // If it's a texture, save as blob
        const lower = name.toLowerCase();
        if (
          lower.endsWith(".png") ||
          lower.endsWith(".jpg") ||
          lower.endsWith(".jpeg")
        ) {
          const bytes = content as Uint8Array;
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          const blob = new Blob([copy.buffer]);
          rarTextureBlobs.push({ name, blob });
          if (!firstTextureBlob) {
            firstTextureBlob = blob;
          }
        }
      }
    }

    onProgress?.({ phase: "unzip", percent: 30 });

    // Merge all OBJ files (combination models with multiple OBJs)
    let combinedObjText = "";
    let vertexOffset = 0;
    for (let i = 0; i < objFiles.length; i++) {
      const name = objFiles[i]!.name;
      const content = fileContents.get(name);
      if (!content) continue;
      const text = new TextDecoder().decode(content);
      if (i > 0) {
        // Offset vertex indices for combined OBJ
        const lines = text
          .split("\n")
          .map((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("f ")) {
              return line
                .split(/\s+/)
                .map((token) => {
                  if (token === "f") return token;
                  const parts = token.split("/");
                  const vIdx = parseInt(parts[0] ?? "", 10);
                  if (vIdx > 0) parts[0] = String(vIdx + vertexOffset);
                  else if (vIdx < 0) parts[0] = String(vIdx - vertexOffset);
                  return parts.join("/");
                })
                .join(" ");
            }
            return line;
          })
          .join("\n");
        combinedObjText += `${lines}\n`;
      } else {
        combinedObjText += `${text}\n`;
      }
      const vCount = (text.match(/^v\s/gm) || []).length;
      vertexOffset += vCount;
    }

    const objText = combinedObjText;
    const objFileName =
      objFiles.length === 1
        ? objFiles[0]!.name
        : `${objFiles.length} 个 OBJ 合并`;
    onProgress?.({ phase: "unzip", percent: 30 });

    await yieldToUI();

    // Parse OBJ via Web Worker
    const workerResult = await parseObjInWorker(objText, {
      sendGeometry: false,
      onProgress: (wp) => {
        const pct = 30 + Math.round((wp.percent / 95) * 65);
        onProgress?.({ phase: "parse", percent: pct });
      },
    });

    onProgress?.({ phase: "parse", percent: 100 });

    const parseResult = workerResultToParseResult(workerResult);

    if (parseResult.vertexCount === 0) {
      return {
        model: null,
        allFiles,
        error: "OBJ 文件解析失败，未找到顶点数据",
      };
    }

    // Model name
    let nameWithoutExt: string;
    if (objFiles.length === 1) {
      const baseName = objFiles[0]!.name.split("/").pop() || objFiles[0]!.name;
      nameWithoutExt = baseName.replace(/\.[^.]+$/, "");
    } else {
      nameWithoutExt = `组合模型(${objFiles.length})`;
    }

    // Read MTL text
    let mtlText: string | undefined;
    if (mtlFileName) {
      const mtlContent = fileContents.get(mtlFileName);
      if (mtlContent) {
        mtlText = new TextDecoder().decode(mtlContent);
      }
    }

    let previewUrl: string | undefined;
    if (firstTextureBlob) {
      previewUrl = URL.createObjectURL(firstTextureBlob);
    }

    return {
      model: {
        name: nameWithoutExt,
        objFileName,
        mtlFileName,
        textureFileNames,
        objText,
        mtlText,
        parseResult,
        previewUrl,
        textureBlobs: rarTextureBlobs,
      },
      allFiles,
    };
  } catch (err) {
    return {
      model: null,
      allFiles: [],
      error: `RAR 解压失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
