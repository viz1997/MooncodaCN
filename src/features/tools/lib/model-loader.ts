"use client";

import type {
  TextureDiagnostic,
  TextureUrlMap,
} from "@/features/pricing/lib/obj-materials";
/**
 * 模型文件读取 —— 复用克重工具(/tools/weight)的解压管线
 *
 * 支持的文件类型与克重工具完全一致(.zip / .rar / .cbr / .obj / .stl / .ply /
 * .glb / .gltf),不自己写一套 STL / OBJ 解析器:
 *
 * 1. `extractModelZip(file, onProgress)` —— 把压缩包解开、把 STL / PLY / GLB 转成
 *    OBJ 文本,并顺带算一遍体积 / 表面积(克重工具同款管线)。
 * 2. `parseObjInWorker(objText, { sendGeometry: true })` —— 再取一次三角汤坐标,
 *    正好是 `analyzeNewMesh()` 要的输入格式。
 *
 * 代价:OBJ 被解析两次(解压管线一次 + 取几何一次)。相对拓扑分析的开销可以忽略,
 * 换来的是「跟克重工具行为完全一致」。
 *
 * 坐标系:克重工具的 3D 场景本来就是 Z-up(`obj-viewer.tsx` `camera.up.set(0,0,1)`),
 * 源项目的 WJP 检查器也是 Z-up —— 两边一致,不需要任何旋转。单位统一按 mm。
 */
import {
  type ObjWorkerResult,
  parseObjInWorker,
} from "@/features/pricing/lib/obj-worker-client";
import {
  extractModelZip,
  revokeModelTextureUrls,
  type ZipExtractResult,
} from "@/features/pricing/lib/zip-extractor";
import type { MessageRef } from "./mesh/types";

/** 文件选择框的 accept —— 与克重工具逐字一致 */
export const MODEL_ACCEPT = ".zip,.rar,.7z,.obj,.stl,.ply,.glb,.gltf";

/**
 * 实际能解包的后缀(与 `extractModelZip` 的分支一致)。
 * `.7z` 只出现在 accept 里 —— 克重工具同样不支持 7z,行为保持一致。
 */
const SUPPORTED_EXTENSIONS = [
  ".obj",
  ".stl",
  ".ply",
  ".glb",
  ".gltf",
  ".zip",
  ".rar",
  ".cbr",
];

export type ModelLoadPhase = "extract" | "geometry";

export type ModelLoadProgress = {
  phase: ModelLoadPhase;
  /** 0-100 */
  percent: number;
};

export type LoadedModel = {
  /** 展示用文件名 */
  fileName: string;
  /** 三角汤,9 floats / 三角面 */
  positions: Float32Array;
  triangleCount: number;
  vertexCount: number;
  /** 顶点 UV,6 floats / 三角面(模型没有 `vt` 时为 null) */
  uvs: Float32Array | null;
  /** `usemtl` 声明的材质名(按首次出现顺序) */
  materialNames: string[];
  /** 每三角形一个材质下标(指向 materialNames);模型没声明材质时为 null */
  materialIndex: Uint16Array | null;
  /** MTL 文本(压缩包里没带材质表时为 null) */
  mtlText: string | null;
  /** 材质名 → 该材质自己的贴图 blob URL */
  textureUrls: TextureUrlMap | null;
  /**
   * 每个材质槽位的贴图解析诊断 —— 白模时用来解释「贴图断在哪一步」。
   */
  textureDiagnostics: TextureDiagnostic[] | null;
  /**
   * 释放贴图的 blob URL(换模型 / 组件卸载时必须调用,否则 blob 一直占着内存)。
   */
  releaseTextures: () => void;
};

/** 读取失败。`ref` 是 i18n key + 参数,UI 层用 next-intl 渲染成对应语言的文案。 */
export class ModelLoadError extends Error {
  readonly ref: MessageRef;

  constructor(ref: MessageRef, message?: string) {
    super(message ?? ref.key);
    this.name = "ModelLoadError";
    this.ref = ref;
  }
}

export function isSupportedModelFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * 读取模型文件 → 三角汤坐标
 *
 * @param file 用户选择的模型文件
 * @param onProgress 进度回调(解压 0~70%,取几何 70~100%)
 */
export async function loadModelGeometry(
  file: File,
  onProgress?: (p: ModelLoadProgress) => void
): Promise<LoadedModel> {
  if (!isSupportedModelFile(file)) {
    throw new ModelLoadError({
      key: "errors.unsupportedType",
      params: { accept: MODEL_ACCEPT },
    });
  }

  let extracted: ZipExtractResult;
  try {
    extracted = await extractModelZip(file, (p) => {
      onProgress?.({
        phase: "extract",
        percent: Math.round(p.percent * 0.7),
      });
    });
  } catch (err) {
    throw new ModelLoadError(
      { key: "errors.parseFailed" },
      err instanceof Error ? err.message : String(err)
    );
  }

  if (extracted.error || !extracted.model) {
    throw new ModelLoadError(
      { key: "errors.unsupportedType", params: { accept: MODEL_ACCEPT } },
      extracted.error
    );
  }

  const model = extracted.model;
  onProgress?.({ phase: "geometry", percent: 72 });

  let geometry: ObjWorkerResult;
  try {
    geometry = await parseObjInWorker(model.objText, {
      sendGeometry: true,
      onProgress: (p) => {
        onProgress?.({
          phase: "geometry",
          percent: 72 + Math.round((p.percent / 95) * 26),
        });
      },
    });
  } catch (err) {
    throw new ModelLoadError(
      { key: "errors.parseFailed" },
      err instanceof Error ? err.message : String(err)
    );
  }

  const positions = geometry.positions;
  if (!positions || positions.length < 9) {
    throw new ModelLoadError({ key: "errors.noGeometry" });
  }

  onProgress?.({ phase: "geometry", percent: 100 });

  return {
    fileName: model.objFileName || file.name,
    positions,
    triangleCount: geometry.triangleCount,
    vertexCount: geometry.vertexCount,
    uvs: geometry.uvs ?? null,
    materialNames: geometry.materialNames ?? [],
    materialIndex: geometry.materialIndex ?? null,
    mtlText: model.mtlText ?? null,
    textureUrls: model.textureUrls ?? null,
    textureDiagnostics: model.textureDiagnostics ?? null,
    releaseTextures: () => revokeModelTextureUrls(model),
  };
}
