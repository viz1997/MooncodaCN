import { describe, expect, it } from "vitest";

/**
 * 模型文件的**单位判定** —— 纯函数 + 真几何测试
 *
 * ## 背景(2026-11-06 线上踩到)
 *
 * AI 生成(Meshy)、Blender 默认导出的模型,坐标是**归一化的**(±1),不是毫米。
 * 工具把坐标当毫米(`obj-parser.ts` 的 `// dimensions in mm (assuming OBJ is
 * in mm)`),于是:
 *
 * - 托底 5mm 是**固定的毫米值**,不跟着模型缩放 → 平台被拉到模型下面 5 个
 *   **单位** → 支撑比模型本身还高 3.5 倍
 * - 耗材克重算出来是 0.001 g,支撑比例是**几万倍**(实测 56,868%)
 * - 报价完全不对,而且页面上看不出来 —— 数字都"有",就是离谱
 *
 * 修法:识别出「坐标不是毫米」→ 按**最大边 100mm** 归一化,并在面板上
 * 挂一条横幅告诉用户换算过了。
 *
 * ## 这个文件守住两件事
 *
 * 1. **判定本身** —— 什么算「不是毫米」,什么不算
 * 2. **归一化之后支撑比例回到正常量级** —— 走真几何(焊接 → 缩放 → 外壳 →
 *    体积),不是断言一个数,而是断言**整条链路的结果**
 */

import {
  computeSupportAtPose,
  DEFAULT_SUPPORT_PARAMS,
} from "@/features/pricing/lib/angle-optimizer";
import {
  ASSUMED_MAX_EXTENT_MM,
  detectModelUnitScale,
  IMPLAUSIBLE_MM_EXTENT,
  measurePositionsSize,
  scalePositions,
} from "@/features/pricing/lib/model-units";
import {
  prepareSupportModel,
  scaleSupportModel,
} from "@/features/tools/lib/mesh/support-shell";
import { boxTriangles } from "@/test/tools/fixtures/mesh-fixtures";

/* -------------------------------------------------------------------------- */
/*  判定                                                                        */
/* -------------------------------------------------------------------------- */

describe("detectModelUnitScale —— 这个文件的坐标是不是毫米", () => {
  it("归一化坐标(AI 生成 / Blender 默认导出)→ 判成不是毫米", () => {
    // 实测:Meshy 导出的比雄小狗,bbox 1.16 × 1.87 × 1.90
    const check = detectModelUnitScale({ x: 1.16, y: 1.87, z: 1.9 });
    expect(check.normalized).toBe(true);
    expect(check.originalMaxExtent).toBeCloseTo(1.9, 6);
    // 归一化到最大边 100mm
    expect(check.scale).toBeCloseTo(ASSUMED_MAX_EXTENT_MM / 1.9, 6);
    expect(check.assumedMaxExtentMm).toBe(ASSUMED_MAX_EXTENT_MM);
  });

  it("工作室自己的毫米文件 → 一个字节都不动", () => {
    const check = detectModelUnitScale({ x: 43.6, y: 32, z: 61 });
    expect(check.normalized).toBe(false);
    expect(check.scale).toBe(1);
    expect(check.originalMaxExtent).toBeCloseTo(61, 6);
    expect(check.assumedMaxExtentMm).toBeCloseTo(61, 6);
  });

  it("扁平模型(冰箱贴 40×40×2)→ 按毫米走,不当成归一化文件", () => {
    // 看的是**最大边**不是最小边 —— 2mm 厚不是「文件没有单位」
    const check = detectModelUnitScale({ x: 40, y: 40, z: 2 });
    expect(check.normalized).toBe(false);
    expect(check.scale).toBe(1);
  });

  it("阈值:最大边正好 10 不动,比 10 小才归一化", () => {
    expect(detectModelUnitScale({ x: 10, y: 10, z: 10 }).normalized).toBe(
      false
    );
    expect(detectModelUnitScale({ x: 9.99, y: 9.99, z: 9.99 }).normalized).toBe(
      true
    );
    expect(IMPLAUSIBLE_MM_EXTENT).toBe(10);
  });

  it("退化输入(空模型 / 某一轴是 0 / NaN)→ 不动", () => {
    // 给一个坏文件编一个 100 倍的尺寸,比不改更糟
    for (const size of [
      { x: 0, y: 0, z: 0 },
      { x: Number.NaN, y: 1, z: 1 },
      { x: -1, y: 2, z: 3 },
      { x: 1, y: 0, z: 1 },
    ]) {
      const check = detectModelUnitScale(size);
      expect(check.normalized).toBe(false);
      expect(check.scale).toBe(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  归一化之后,支撑比例回到正常量级                                              */
/* -------------------------------------------------------------------------- */

/**
 * 归一化坐标的立方体 —— 1.9「单位」见方
 *
 * 每次都新建一份:`prepareSupportModel` 的焊接过程**会原地改顶点**,复用
 * 同一份 Float32Array 会让第二次算的是被改过的几何。
 */
function normalizedCube(): Float32Array {
  return boxTriangles([0, 0, 0], [1.9, 1.9, 1.9]);
}

describe("归一化 —— 支撑比例回到正常量级(走真几何)", () => {
  it("不归一化:支撑比例是几万倍(托底 5mm 相对模型太大了)", () => {
    const model = prepareSupportModel(normalizedCube());
    const pose = computeSupportAtPose(model, 0, 0, 0, DEFAULT_SUPPORT_PARAMS);

    // 模型克重:1.9³ mm³ → cm³ → × 模型密度
    const modelWeightG =
      (1.9 ** 3 / 1000) * DEFAULT_SUPPORT_PARAMS.modelDensity;
    const ratio = pose.supportWeightG / modelWeightG;

    // 这就是线上看到的那个数(实测真实模型是 56,868%)
    expect(ratio).toBeGreaterThan(50);
  });

  it("归一化到最大边 100mm:支撑比例回到个位数百分比", () => {
    const check = detectModelUnitScale({ x: 1.9, y: 1.9, z: 1.9 });
    expect(check.normalized).toBe(true);

    const model = prepareSupportModel(normalizedCube());
    // 归一化走的正是「自选尺寸」那条路:缩放只挪顶点,拓扑不变
    const scaled = scaleSupportModel(
      model,
      check.scale,
      check.scale,
      check.scale
    );
    const pose = computeSupportAtPose(scaled, 0, 0, 0, DEFAULT_SUPPORT_PARAMS);

    // 100mm 立方体 → 1000 cm³ → 1200 g
    const modelWeightG =
      (100 ** 3 / 1000) * DEFAULT_SUPPORT_PARAMS.modelDensity;
    const ratio = pose.supportWeightG / modelWeightG;

    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.2);
  });

  it("归一化之后,支撑就是「5mm 托底 × 底板占地」那个量", () => {
    const check = detectModelUnitScale({ x: 1.9, y: 1.9, z: 1.9 });
    const model = prepareSupportModel(normalizedCube());
    const scaled = scaleSupportModel(
      model,
      check.scale,
      check.scale,
      check.scale
    );
    const pose = computeSupportAtPose(scaled, 0, 0, 0, DEFAULT_SUPPORT_PARAMS);

    // 100mm 立方体 + 5mm 留边 → 底板 110×110(四角切掉 5mm 圆角)
    //   12100 − 4×(25 − π·25/4) ≈ 12078 mm²
    // 支撑 = 底板 × 5mm 托底 ≈ 60,392 mm³
    const expectedBaseArea = 110 * 110 - 4 * (25 - (Math.PI * 25) / 4);
    expect(pose.supportVolumeMM3).toBeCloseTo(expectedBaseArea * 5, -2);
  });
});

/* -------------------------------------------------------------------------- */
/*  三角汤工具(模型检查那条链路用)                                             */
/* -------------------------------------------------------------------------- */

describe("measurePositionsSize / scalePositions", () => {
  /** 一个 2×3×4 的三角汤 */
  const soup = () => new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4]);

  it("量出包围盒尺寸", () => {
    expect(measurePositionsSize(soup())).toEqual({ x: 2, y: 3, z: 4 });
  });

  it("空三角汤 → 退化尺寸(不抛)", () => {
    expect(measurePositionsSize(new Float32Array(0))).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it("缩放:顶点乘系数,长度不变,原数组不动", () => {
    const src = soup();
    const out = scalePositions(src, 10);
    expect(out).not.toBe(src);
    expect(out.length).toBe(src.length);
    expect(measurePositionsSize(out)).toEqual({ x: 20, y: 30, z: 40 });
    // 原数组没被改 —— 别把别人的几何就地改了
    expect(measurePositionsSize(src)).toEqual({ x: 2, y: 3, z: 4 });
  });

  it("系数 = 1 → 原样返回", () => {
    const src = soup();
    expect(scalePositions(src, 1)).toBe(src);
  });
});
