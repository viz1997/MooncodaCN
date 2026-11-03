"use client";

import * as THREE from "three";
import {
  parseMtl,
  resolveMaterialName,
  type TextureUrlMap,
} from "@/features/pricing/lib/obj-materials";

/**
 * 预览材质构建 —— 克重工具与模型检查工具**共用同一份实现**。
 *
 * ## 为什么抽出来
 *
 * 两个工具的 3D 预览以前各写各的:
 * - 克重工具走 three 的 `MTLLoader`,靠「patch `materialsInfo` → `preload()`」挂贴图
 * - 模型检查工具自己按 `usemtl` 建 `MeshStandardMaterial`,直接 `TextureLoader.load()`
 *
 * 两套实现的材质参数、兜底规则、UV 判定都不一样 —— 同一个模型在两个工具里
 * 长得不一样,贴图也经常一个能显示一个不能(白模)。
 *
 * 现在统一走这里:**每个材质挂它自己 `map_Kd` 指向的那张图**;
 * 没有贴图就退回该材质的 `Kd` 本色,绝不拿别的图顶替。
 */

/** 构建预览材质需要的输入 */
export type PreviewMaterialInput = {
  /** MTL 文本(模型没带材质表时为 null) */
  mtlText: string | null | undefined;
  /** 材质名 → 该材质自己的贴图 blob URL */
  textureUrls: TextureUrlMap | null | undefined;
  /** OBJ 的 `usemtl` 名(按首次出现顺序) */
  materialNames: string[];
  /**
   * 几何体有没有 `uv` 属性。
   *
   * 没有 uv 时**不能**挂贴图 —— three.js 会去采样 (0,0) 那个像素,
   * 整块模型糊成一片,比白模还难看。
   */
  hasUv: boolean;
  /** 是否启用顶点色(模型检查工具的问题色) */
  vertexColors?: boolean | undefined;
  /**
   * 是否显示贴图(模型检查工具的「显示贴图」开关)。
   *
   * 关掉时只是把 `map` 摘掉,贴图本体留在 `userData.baseMap` 里 ——
   * 切回来不用重新下载。默认 true。
   */
  showTexture?: boolean | undefined;
  /**
   * 兜底贴图 —— 模型**完全没有材质表**时挂这一张。
   *
   * 只在「一个材质都没有」时用:有材质但贴图对不上时**绝不**拿它顶替
   * (那正是「贴图错乱」的来源)。
   */
  fallbackTextureUrl?: string | undefined;
};

/** 构建结果 */
export type PreviewMaterials = {
  /** 材质槽位 —— 顺序与 `materialNames` 一致 */
  slots: THREE.Material[];
  /** 每个槽位有没有贴图 */
  slotHasMap: boolean[];
  /** 每个槽位有没有 MTL 的 `Kd` 本色 */
  slotHasKd: boolean[];
  /**
   * 单材质兜底 —— OBJ 没写 `usemtl` 时用。
   * (MTL 只有一个材质时也用它。)
   */
  single: THREE.Material | null;
};

/** 材质外观参数 —— 两个工具共用,避免「同一个模型两个长相」 */
const MATERIAL_PARAMS = {
  flatShading: true,
  side: THREE.DoubleSide,
  roughness: 0.75,
  metalness: 0.05,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
} as const;

/**
 * 按材质槽位构建材质数组。
 *
 * 材质槽位的顺序 = OBJ 里 `usemtl` 的首次出现顺序 —— 必须与
 * `materialIndex`(每三角形一个下标)严格对应,否则贴图会贴到别的面上。
 */
export function buildPreviewMaterials(
  input: PreviewMaterialInput
): PreviewMaterials {
  const {
    mtlText,
    textureUrls,
    materialNames,
    hasUv,
    vertexColors,
    showTexture = true,
    fallbackTextureUrl,
  } = input;

  const materials = mtlText ? parseMtl(mtlText) : [];
  const mtlNames = materials.map((m) => m.name);
  // OBJ 的 `usemtl` 名与 MTL 的 `newmtl` 名可能对不上(大小写 / `.001` 副本后缀)
  // —— 先解析出 MTL 里真正对应的那个,否则贴图与本色都取不到
  const resolveMtl = (slot: string) => {
    const hit = resolveMaterialName(slot, mtlNames);
    return hit ? materials.find((m) => m.name === hit) : undefined;
  };

  const textureLoader = new THREE.TextureLoader();
  const slots: THREE.Material[] = [];
  const slotHasMap: boolean[] = [];
  const slotHasKd: boolean[] = [];

  const makeSlot = (slot: string): THREE.Material => {
    const mat = new THREE.MeshStandardMaterial({
      ...MATERIAL_PARAMS,
      vertexColors: vertexColors === true,
    });
    const url = hasUv ? textureUrls?.[slot]?.map : undefined;
    const kd = resolveMtl(slot)?.kd;
    slotHasKd.push(Boolean(kd));
    if (url) {
      const map = textureLoader.load(url);
      map.colorSpace = THREE.SRGBColorSpace;
      // 贴图开关关掉时只摘掉 map,贴图本体留着(切回来不用重新下载)
      mat.userData.baseMap = map;
      mat.map = showTexture ? map : null;
      mat.needsUpdate = true;
      slotHasMap.push(true);
    } else {
      // 没有贴图的材质:用 MTL 的 Kd 本色(没有 Kd 就退回白,顶点色负责外观)
      if (kd) {
        mat.color.setRGB(kd[0], kd[1], kd[2], THREE.SRGBColorSpace);
      }
      slotHasMap.push(false);
    }
    return mat;
  };

  if (materialNames.length > 0) {
    for (const name of materialNames) {
      slots.push(makeSlot(name));
    }
  }

  // OBJ 没写 usemtl → 整块模型用 MTL 里的第一个材质
  let single: THREE.Material | null = null;
  if (slots.length === 0 && materials.length > 0) {
    single = makeSlot(materials[0]!.name);
  }

  // 连材质表都没有 → 挂兜底贴图(有材质但贴图对不上时**绝不**走这条路)
  if (!single && fallbackTextureUrl && hasUv) {
    const mat = new THREE.MeshStandardMaterial({
      ...MATERIAL_PARAMS,
      vertexColors: vertexColors === true,
    });
    const map = textureLoader.load(fallbackTextureUrl);
    map.colorSpace = THREE.SRGBColorSpace;
    // 贴图开关关掉时只摘掉 map,贴图本体留着(切回来不用重新下载)
    mat.userData.baseMap = map;
    mat.map = showTexture ? map : null;
    mat.needsUpdate = true;
    slotHasMap.push(true);
    slotHasKd.push(false);
    single = mat;
  }

  return { slots, slotHasMap, slotHasKd, single };
}

/**
 * 按材质下标把三角汤切成连续段 → `geometry.addGroup`。
 *
 * 几何体保持**非索引**(三角汤),这样 three.js 的 `intersection.faceIndex`
 * 仍然是**全局三角形序号** —— 模型检查工具的 hover 提示直接拿它查 `flags[f]`。
 */
export function addMaterialGroups(
  geometry: THREE.BufferGeometry,
  materialIndex: Uint16Array | null | undefined
): void {
  if (!materialIndex || materialIndex.length === 0) return;
  let groupStart = 0;
  for (let t = 0; t <= materialIndex.length; t++) {
    const prev = materialIndex[groupStart] ?? 0;
    const cur = t < materialIndex.length ? (materialIndex[t] ?? 0) : -1;
    if (t === materialIndex.length || cur !== prev) {
      const count = (t - groupStart) * 3;
      if (count > 0) geometry.addGroup(groupStart * 3, count, prev);
      groupStart = t;
    }
  }
}
