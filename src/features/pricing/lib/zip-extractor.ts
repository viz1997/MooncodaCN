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
import {
  baseName,
  buildSlotTextureUrls,
  buildTextureUrlMap,
  combineObjSources,
  diagnoseMaterialTextures,
  matchMaterialTextures,
  parseMtl,
  parseMtllibNames,
  parseUsemtlNames,
  pickMtlFileName,
  pickPreviewTextureUrl,
  type TextureDiagnostic,
  type TextureUrlMap,
} from "./obj-materials";
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
  /** 第一张 base color 贴图的 object URL（缩略图 / 单材质兜底） */
  previewUrl?: string | undefined;
  /** 所有纹理文件的 Blob（用于导出 ZIP 时保留原始纹理） */
  textureBlobs?: { name: string; blob: Blob }[] | undefined;
  /**
   * 每个材质槽位的贴图解析诊断 —— 白模时用来解释「贴图断在哪一步」。
   */
  textureDiagnostics?: TextureDiagnostic[] | undefined;
  /**
   * 材质名 → 该材质**自己**的贴图 object URL。
   *
   * 多材质模型每个材质挂各自的 `map_Kd` —— 匹配不上的材质不挂贴图,
   * 退回材质本色,绝不拿别的图顶替。
   */
  textureUrls?: TextureUrlMap | undefined;
};

/**
 * 回收一个模型占用的所有 blob URL（缩略图 + 各材质贴图）。
 *
 * 同一张图可能被多个材质引用 —— 用 Set 去重,避免重复 revoke。
 */
export function revokeModelTextureUrls(model: ModelFile | null | undefined) {
  if (!model) return;
  const urls = new Set<string>();
  if (model.previewUrl) urls.add(model.previewUrl);
  for (const entry of Object.values(model.textureUrls ?? {})) {
    if (entry.map) urls.add(entry.map);
    if (entry.specularMap) urls.add(entry.specularMap);
    if (entry.normalMap) urls.add(entry.normalMap);
  }
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

/** 压缩包里的贴图文件后缀白名单（ZIP / RAR 共用） */
const TEXTURE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".tga",
  ".tiff",
  ".tif",
  ".webp",
];

/** 是不是贴图文件 */
function isTextureName(lowerName: string): boolean {
  return TEXTURE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

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
    // 智能摆盘 Worker 要几何:解析时就带上,别再解析一遍
    positions: r.positions,
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
      sendGeometry: true,
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

    const fileBaseName = file.name.split("/").pop() || file.name;
    const nameWithoutExt = fileBaseName.replace(/\.[^.]+$/, "");

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
      sendGeometry: true,
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

    const fileBaseName = fileName.split("/").pop() || fileName;
    const nameWithoutExt = fileBaseName.replace(/\.[^.]+$/, "");

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
 * 把 three 的纹理转成 PNG Blob。
 *
 * glTF 的贴图在 GLB 里是内嵌二进制,GLTFLoader 解码成 ImageBitmap;
 * 要把它导出成 PNG 文件(进 zip / 建 blob URL),得先画到 canvas 上。
 *
 * **竖直方向要翻转**:glTF 的贴图是 `flipY = false`(UV 原点在左上),
 * 而 OBJ/MTL 走 MTLLoader,那边是 `flipY = true`(UV 原点在左下)。
 * 不翻转的话贴图上下颠倒 —— 那也是「贴图错乱」。
 */
async function textureToPngBlob(
  texture: THREE.Texture
): Promise<Blob | undefined> {
  const image = texture.image as
    | ImageBitmap
    | HTMLImageElement
    | HTMLCanvasElement
    | undefined;
  if (!image || typeof document === "undefined") return undefined;

  const width = (image as { width?: number }).width ?? 0;
  const height = (image as { height?: number }).height ?? 0;
  if (!width || !height) return undefined;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    if (!texture.flipY) {
      // 目标贴图用 flipY = true 载入 → 画的时候先翻转,才跟 glTF 的 UV 对得上
      ctx.translate(0, height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
    return await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
    });
  } catch {
    // 跨域污染的贴图画不到 canvas → 该材质退回本色
    return undefined;
  }
}

/** 顶点属性 —— 普通 BufferAttribute 与 InterleavedBufferAttribute 都满足 */
type VertexAttribute = {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
};

/** GLTF 场景里的一块网格(已应用世界变换) */
type GlbPart = {
  positions: VertexAttribute;
  uv: VertexAttribute | undefined;
  /** 每个三角形 3 个顶点下标 */
  vIdx: number[];
  /** 每个三角形 3 个 UV 下标(没有 uv 时为 undefined) */
  tIdx: number[] | undefined;
  material: THREE.Material;
};

/**
 * GLTF 场景 → OBJ 文本(带 `vt` / `usemtl`)+ 合成 MTL + 贴图文件。
 *
 * 之前 GLB 走 `mergeSceneGeometries` 把所有网格并成一个几何体,只输出 `v` / `f` ——
 * UV 和材质全丢,GLB 模型必然白模。这里改成**逐网格**输出,保住 UV 与材质分组。
 */
async function sceneToObjAssets(
  scene: THREE.Object3D,
  mtlFileName: string
): Promise<{
  objText: string;
  mtlText: string;
  textureBlobs: { name: string; blob: Blob }[];
}> {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry?.attributes.position) {
      meshes.push(child);
    }
  });

  // ---- 1. 拆出每个网格的顶点 / UV / 面 / 材质 ----
  const parts: GlbPart[] = [];
  const materials: THREE.Material[] = [];
  const seenMaterials = new Set<THREE.Material>();

  for (const mesh of meshes) {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    const positions = geo.attributes.position;
    if (!positions || positions.count === 0) continue;
    const uv = geo.attributes.uv;
    const index = geo.index;
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    // groups 决定每个面用哪个材质;没有 groups 就整块用第一个材质
    const groups =
      geo.groups.length > 0
        ? geo.groups
        : [
            {
              start: 0,
              count: index ? index.count : positions.count,
              materialIndex: 0,
            },
          ];

    for (const group of groups) {
      const material =
        meshMaterials[group.materialIndex ?? 0] ?? meshMaterials[0];
      if (!material) continue;

      const vIdx: number[] = [];
      const tIdx: number[] = [];
      const pushTri = (a: number, b: number, c: number) => {
        vIdx.push(a, b, c);
        // three 的 uv 属性跟 position 一一对应 → 索引可以照抄
        if (uv) tIdx.push(a, b, c);
      };

      const end = group.start + group.count;
      if (index) {
        for (let i = group.start; i + 2 < end; i += 3) {
          pushTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
        }
      } else {
        for (let i = group.start; i + 2 < end; i += 3) {
          pushTri(i, i + 1, i + 2);
        }
      }

      if (vIdx.length === 0) continue;

      parts.push({
        positions,
        uv,
        vIdx,
        tIdx: uv ? tIdx : undefined,
        material,
      });

      if (!seenMaterials.has(material)) {
        seenMaterials.add(material);
        materials.push(material);
      }
    }
  }

  // ---- 2. 材质 → 名字 / Kd 本色 / 贴图文件 ----
  const nameByMaterial = new Map<THREE.Material, string>();
  const usedNames = new Set<string>();
  for (const material of materials) {
    const base = material.name?.trim() || "material";
    let name = base;
    let n = 1;
    while (usedNames.has(name.toLowerCase())) {
      name = `${base}_${n}`;
      n += 1;
    }
    usedNames.add(name.toLowerCase());
    nameByMaterial.set(material, name);
  }

  const textureBlobs: { name: string; blob: Blob }[] = [];
  const fileByTexture = new Map<THREE.Texture, string>();
  const usedFiles = new Set<string>();

  const textureFileName = async (
    texture: THREE.Texture | null | undefined
  ): Promise<string | undefined> => {
    if (!texture) return undefined;
    const cached = fileByTexture.get(texture);
    if (cached) return cached;
    const blob = await textureToPngBlob(texture);
    if (!blob) return undefined;
    // glTF 的 texture.name 可能是 URI(带目录)—— 只取文件名
    const stem =
      baseName(texture.name?.trim().replace(/\.[^.]+$/, "") ?? "") ||
      `texture_${textureBlobs.length + 1}`;
    let fileName = `${stem}.png`;
    let n = 1;
    while (usedFiles.has(fileName.toLowerCase())) {
      fileName = `${stem}_${n}.png`;
      n += 1;
    }
    usedFiles.add(fileName.toLowerCase());
    textureBlobs.push({ name: fileName, blob });
    fileByTexture.set(texture, fileName);
    return fileName;
  };

  const mtlLines: string[] = [];
  for (const material of materials) {
    const name = nameByMaterial.get(material);
    if (!name) continue;
    const std = material as THREE.MeshStandardMaterial;
    const color = std.color;
    const kd: [number, number, number] = color
      ? [color.r, color.g, color.b]
      : [0.8, 0.8, 0.8];
    mtlLines.push(`newmtl ${name}`);
    mtlLines.push(
      `Kd ${kd[0].toFixed(6)} ${kd[1].toFixed(6)} ${kd[2].toFixed(6)}`
    );
    const mapFile = await textureFileName(std.map);
    if (mapFile) mtlLines.push(`map_Kd ${mapFile}`);
    const normFile = await textureFileName(std.normalMap);
    if (normFile) mtlLines.push(`norm ${normFile}`);
  }

  // ---- 3. 拼 OBJ 文本 ----
  const lines: string[] = [`mtllib ${mtlFileName}`];
  let vertexOffset = 0;
  let uvOffset = 0;

  for (const part of parts) {
    const pos = part.positions;
    for (let i = 0; i < pos.count; i++) {
      lines.push(`v ${pos.getX(i)} ${pos.getY(i)} ${pos.getZ(i)}`);
    }
    if (part.uv) {
      const uv = part.uv;
      for (let i = 0; i < uv.count; i++) {
        lines.push(`vt ${uv.getX(i)} ${uv.getY(i)}`);
      }
    }

    const name = nameByMaterial.get(part.material);
    if (name) lines.push(`usemtl ${name}`);

    for (let i = 0; i < part.vIdx.length; i += 3) {
      const a = part.vIdx[i]! + 1 + vertexOffset;
      const b = part.vIdx[i + 1]! + 1 + vertexOffset;
      const c = part.vIdx[i + 2]! + 1 + vertexOffset;
      if (part.tIdx) {
        const ta = part.tIdx[i]! + 1 + uvOffset;
        const tb = part.tIdx[i + 1]! + 1 + uvOffset;
        const tc = part.tIdx[i + 2]! + 1 + uvOffset;
        lines.push(`f ${a}/${ta} ${b}/${tb} ${c}/${tc}`);
      } else {
        lines.push(`f ${a} ${b} ${c}`);
      }
    }

    vertexOffset += pos.count;
    if (part.uv) uvOffset += part.uv.count;
  }

  return {
    objText: lines.join("\n"),
    mtlText: mtlLines.join("\n"),
    textureBlobs,
  };
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

    const scene = gltf.scene || gltf.scenes[0];
    if (!scene) {
      return {
        model: null,
        allFiles: [],
        error: "GLB/GLTF 内没有场景数据",
      };
    }

    // 合成 OBJ + MTL(保住 UV 与材质分组)+ 导出贴图
    const stem = file.name.replace(/\.[^.]+$/, "") || "model";
    const mtlFileName = `${stem}.mtl`;
    const assets = await sceneToObjAssets(scene, mtlFileName);
    const objText = assets.objText;

    onProgress?.({ phase: "parse", percent: 60 });

    await yieldToUI();

    const workerResult = await parseObjInWorker(objText, {
      sendGeometry: true,
      onProgress: (wp) => {
        const pct = 60 + Math.round((wp.percent / 95) * 35);
        onProgress?.({ phase: "parse", percent: pct });
      },
    });

    onProgress?.({ phase: "parse", percent: 100 });

    const parseResult = workerResultToParseResult(workerResult);
    if (parseResult.vertexCount === 0) {
      return {
        model: null,
        allFiles: [],
        error: "GLB/GLTF 解析失败，未找到顶点数据",
      };
    }

    // 按材质解析贴图:每个材质挂它自己的 map_Kd
    const materials = parseMtl(assets.mtlText);
    const materialTextures = matchMaterialTextures(
      materials,
      assets.textureBlobs
    );
    const urlsByMaterial = buildTextureUrlMap(
      materialTextures,
      assets.textureBlobs,
      (blob) => URL.createObjectURL(blob)
    );
    const textureUrls = buildSlotTextureUrls(
      materials,
      urlsByMaterial,
      parseUsemtlNames(objText)
    );
    const previewUrl = pickPreviewTextureUrl(materials, textureUrls);

    return {
      model: {
        name: stem,
        objFileName: `${stem}.obj`,
        mtlFileName,
        textureFileNames: assets.textureBlobs.map((t) => t.name),
        objText,
        mtlText: assets.mtlText,
        parseResult,
        previewUrl,
        textureBlobs: assets.textureBlobs,
        textureUrls,
      },
      allFiles: [{ name: file.name, size: 0 }],
    };
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
    // 压缩包里可能有多个 .mtl —— 真正配套的那个由 OBJ 的 `mtllib` 指定
    const mtlFiles: { entry: JSZip.JSZipObject; name: string }[] = [];
    const textureFileNames: string[] = [];
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
      } else if (lower.endsWith(".mtl")) {
        mtlFiles.push({ entry, name: entry.name });
      } else if (isTextureName(lower)) {
        textureFileNames.push(entry.name);
        const blob = await entry.async("blob");
        textureBlobs.push({ name: entry.name, blob });
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

    // 读出所有 MTL 文本
    const mtlTexts = new Map<string, string>();
    for (const m of mtlFiles) {
      mtlTexts.set(m.name, await m.entry.async("text"));
    }
    const mtlCandidates = [...mtlTexts.keys()];

    // 每个 OBJ 按自己的 `mtllib` 找配套 MTL，再合并（组合模型）
    const sources = [];
    for (let i = 0; i < objFiles.length; i++) {
      const { entry, name } = objFiles[i]!;
      const text: string = await entry.async("text");
      const picked = pickMtlFileName(parseMtllibNames(text), mtlCandidates);
      sources.push({
        objText: text,
        objFileName: name,
        mtlFileName: picked,
        mtlText: picked ? mtlTexts.get(picked) : undefined,
      });
      onProgress?.({
        phase: "unzip",
        percent: Math.min(30, 28 + Math.floor(((i + 1) / objFiles.length) * 2)),
      });
    }

    // 合并：顶点与 UV 索引分别偏移，材质名撞车时同步改名
    const combined = combineObjSources(sources);
    const objText = combined.objText;
    const mtlText = combined.mtlText;
    const mtlFileName = combined.mtlFileName;
    const objFileName =
      objFiles.length === 1
        ? objFiles[0]!.name
        : `${objFiles.length} 个 OBJ 合并`;
    onProgress?.({ phase: "unzip", percent: 30 });

    // Yield so the UI can paint before kicking off the worker
    await yieldToUI();

    // Parse OBJ via Web Worker (off main thread)
    const workerResult = await parseObjInWorker(objText, {
      sendGeometry: true,
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
      const fileBaseName =
        objFiles[0]!.name.split("/").pop() || objFiles[0]!.name;
      nameWithoutExt = fileBaseName.replace(/\.[^.]+$/, "");
    } else {
      nameWithoutExt = `组合模型(${objFiles.length})`;
    }

    // 按材质解析贴图：每个材质挂它自己 map_Kd 指向的那张图
    let previewUrl: string | undefined;
    let textureUrls: TextureUrlMap | undefined;
    let textureDiagnostics: TextureDiagnostic[] | undefined;
    if (mtlText) {
      const materials = parseMtl(mtlText);
      const materialTextures = matchMaterialTextures(materials, textureBlobs);
      const urlsByMaterial = buildTextureUrlMap(
        materialTextures,
        textureBlobs,
        (blob) => URL.createObjectURL(blob)
      );
      // viewer 是拿 OBJ 的 `usemtl` 名查贴图的,而贴图按 MTL 的 `newmtl` 名存着
      // —— 两者对不上(大小写 / `.001` 后缀)就会查不到,模型直接变白模。
      // 这里把 `usemtl` 名也建成别名,两边都能查到。
      const slotNames = parseUsemtlNames(objText);
      textureUrls = buildSlotTextureUrls(materials, urlsByMaterial, slotNames);
      previewUrl = pickPreviewTextureUrl(materials, textureUrls);
      textureDiagnostics = diagnoseMaterialTextures(
        materials,
        materialTextures,
        slotNames.length > 0 ? slotNames : materials.map((m) => m.name)
      );
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
        textureUrls,
        textureDiagnostics,
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
    // 压缩包里可能有多个 .mtl —— 真正配套的那个由 OBJ 的 `mtllib` 指定
    const mtlFiles: string[] = [];
    const textureFileNames: string[] = [];

    for (const fh of list.fileHeaders) {
      if (fh.flags.directory) continue;
      allFiles.push({ name: fh.name, size: fh.unpSize });
      const lower = fh.name.toLowerCase();
      if (lower.endsWith(".obj")) {
        objFiles.push({ name: fh.name });
      } else if (lower.endsWith(".mtl")) {
        mtlFiles.push(fh.name);
      } else if (isTextureName(lower)) {
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
    for (const m of mtlFiles) wantedNames.add(m);
    for (const t of textureFileNames) wantedNames.add(t);

    const extracted = extractor.extract({
      files: (fh) => wantedNames.has(fh.name),
    });

    // Collect extracted file contents
    const fileContents = new Map<string, Uint8Array>();
    const rarTextureBlobs: { name: string; blob: Blob }[] = [];
    for (const arcFile of extracted.files) {
      const name = arcFile.fileHeader.name;
      const content = arcFile.extraction;
      if (content) {
        fileContents.set(name, content as Uint8Array);
        // If it's a texture, save as blob
        const lower = name.toLowerCase();
        if (isTextureName(lower)) {
          const bytes = content as Uint8Array;
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          const blob = new Blob([copy.buffer]);
          rarTextureBlobs.push({ name, blob });
        }
      }
    }

    onProgress?.({ phase: "unzip", percent: 30 });

    // 每个 OBJ 按自己的 `mtllib` 找配套 MTL，再合并（组合模型）
    const decoder = new TextDecoder();
    const sources = [];
    for (const obj of objFiles) {
      const content = fileContents.get(obj.name);
      if (!content) continue;
      const text = decoder.decode(content);
      const picked = pickMtlFileName(parseMtllibNames(text), mtlFiles);
      const mtlContent = picked ? fileContents.get(picked) : undefined;
      sources.push({
        objText: text,
        objFileName: obj.name,
        mtlFileName: picked,
        mtlText: mtlContent ? decoder.decode(mtlContent) : undefined,
      });
    }

    // 合并：顶点与 UV 索引分别偏移，材质名撞车时同步改名
    const combined = combineObjSources(sources);
    const objText = combined.objText;
    const mtlText = combined.mtlText;
    const mtlFileName = combined.mtlFileName;
    const objFileName =
      objFiles.length === 1
        ? objFiles[0]!.name
        : `${objFiles.length} 个 OBJ 合并`;
    onProgress?.({ phase: "unzip", percent: 30 });

    await yieldToUI();

    // Parse OBJ via Web Worker
    const workerResult = await parseObjInWorker(objText, {
      sendGeometry: true,
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
      const fileBaseName =
        objFiles[0]!.name.split("/").pop() || objFiles[0]!.name;
      nameWithoutExt = fileBaseName.replace(/\.[^.]+$/, "");
    } else {
      nameWithoutExt = `组合模型(${objFiles.length})`;
    }

    // 按材质解析贴图：每个材质挂它自己 map_Kd 指向的那张图
    let previewUrl: string | undefined;
    let textureUrls: TextureUrlMap | undefined;
    let textureDiagnostics: TextureDiagnostic[] | undefined;
    if (mtlText) {
      const materials = parseMtl(mtlText);
      const materialTextures = matchMaterialTextures(
        materials,
        rarTextureBlobs
      );
      const urlsByMaterial = buildTextureUrlMap(
        materialTextures,
        rarTextureBlobs,
        (blob) => URL.createObjectURL(blob)
      );
      // 同 ZIP 分支：`usemtl` 名也建成别名,viewer 按它查得到贴图
      const slotNames = parseUsemtlNames(objText);
      textureUrls = buildSlotTextureUrls(materials, urlsByMaterial, slotNames);
      previewUrl = pickPreviewTextureUrl(materials, textureUrls);
      textureDiagnostics = diagnoseMaterialTextures(
        materials,
        materialTextures,
        slotNames.length > 0 ? slotNames : materials.map((m) => m.name)
      );
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
        textureUrls,
        textureDiagnostics,
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
