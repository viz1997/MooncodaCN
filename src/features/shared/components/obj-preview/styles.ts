"use client";

import * as THREE from "three";

/**
 * 预览场景样式 —— 克重工具与模型检查工具共用。
 *
 * 两个工具以前各调各的灯光与背景,同一个模型在两边亮度不一样。
 * 现在统一在这里定义,`mode` 决定用哪一套。
 */
export type PreviewMode = "print-bed" | "inspect";

/** 一套场景外观 */
export type PreviewStyle = {
  /** 背景色 */
  background: number;
  /** 半球光(天空色 / 地面色 / 强度) */
  hemi: { sky: number; ground: number; intensity: number };
  /** 主方向光(颜色 / 强度 / 方向) */
  key: { color: number; intensity: number; position: [number, number, number] };
  /** 补方向光 */
  fill: {
    color: number;
    intensity: number;
    position: [number, number, number];
  };
  /** 环境光强度(0 = 不加) */
  ambient: number;
  /** 画布底色(跟背景同色,避免加载完成前闪白) */
  canvasClass: string;
  /** 是否画打印底板网格 */
  grid: boolean;
  /** 相机初始位置 */
  cameraPosition: [number, number, number];
  /** 相机远裁剪面 */
  cameraFar: number;
  /** 阻尼系数 */
  damping: number;
  /** 像素比上限 */
  maxPixelRatio: number;
};

/**
 * 克重工具:浅色底 + 打印底板网格 + 暖白灯光(树脂打印的观感)。
 */
const PRINT_BED_STYLE: PreviewStyle = {
  background: 0xf5f5f4,
  canvasClass: "bg-stone-100",
  hemi: { sky: 0xffffff, ground: 0x444444, intensity: 0.6 },
  key: { color: 0xffffff, intensity: 1.2, position: [50, 50, 80] },
  fill: { color: 0xffffff, intensity: 0.6, position: [-50, -50, 30] },
  ambient: 1.0,
  grid: true,
  cameraPosition: [50, -50, 50],
  cameraFar: 10000,
  damping: 0.08,
  maxPixelRatio: 2,
};

/**
 * 模型检查工具:深色底 + 高对比灯光(问题色在深底上更醒目)。
 */
const INSPECT_STYLE: PreviewStyle = {
  background: 0x111418,
  canvasClass: "bg-[#111418]",
  hemi: { sky: 0xffffff, ground: 0x33404d, intensity: 1.1 },
  key: { color: 0xffffff, intensity: 1.6, position: [150, -200, 300] },
  fill: { color: 0xffffff, intensity: 0.5, position: [-200, 150, -100] },
  ambient: 0,
  grid: false,
  cameraPosition: [80, -90, 60],
  cameraFar: 50000,
  damping: 0.12,
  maxPixelRatio: 2,
};

/** 取某个模式的场景样式 */
export function getPreviewStyle(mode: PreviewMode): PreviewStyle {
  return mode === "print-bed" ? PRINT_BED_STYLE : INSPECT_STYLE;
}

/**
 * 往场景里加灯光。
 *
 * 半球光的地面色在 Z-up 坐标系里是「下方」—— 两个工具都是 Z 轴朝上。
 */
export function addPreviewLights(
  scene: THREE.Scene,
  style: PreviewStyle
): void {
  if (style.ambient > 0) {
    scene.add(new THREE.AmbientLight(0xffffff, style.ambient));
  }
  const hemi = new THREE.HemisphereLight(
    style.hemi.sky,
    style.hemi.ground,
    style.hemi.intensity
  );
  hemi.position.set(0, 0, 50);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(style.key.color, style.key.intensity);
  key.position.set(...style.key.position);
  scene.add(key);

  const fill = new THREE.DirectionalLight(
    style.fill.color,
    style.fill.intensity
  );
  fill.position.set(...style.fill.position);
  scene.add(fill);
}

/**
 * 打印底板网格(克重工具用)—— GridHelper 默认在 XZ 平面,
 * 这里是 Z-up,得转到 XY 平面(Z=0)。
 */
export function addPrintBedGrid(scene: THREE.Scene): THREE.GridHelper {
  const gridSize = Math.max(100, 200);
  const grid = new THREE.GridHelper(
    gridSize,
    gridSize / 10,
    0x999999,
    0xcccccc
  );
  grid.rotation.x = Math.PI / 2;
  grid.position.z = 0;
  scene.add(grid);
  return grid;
}
