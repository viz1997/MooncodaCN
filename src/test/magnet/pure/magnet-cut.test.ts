/**
 * 磁吸孔切割 —— **真跑 manifold** 的那一组
 *
 * 这些不是「假装跑一下」的测试 —— 它们真的调 Manifold3D 的布尔引擎,
 * 真的量切掉多少体积,真的检查结果是不是流形。
 *
 * 守住的每一件都是踩过坑换来的:
 *
 * 1. 切掉的体积**分毫不差** —— 跟「64 边形截面积 × 1.3mm」对上
 * 2. 切完的网格**还是封闭流形**(能再切一次不炸)
 * 3. **太薄**的面切不得(会捅穿)
 * 4. **非流形**的模型拒收(并指路到工作台的检查)
 * 5. 六个面里挑出**平整度最高**的
 * 6. 整体法线朝内的模型 —— manifold 自己不报错,**得我们翻过来**
 */
import { describe, expect, it } from "vitest";
import {
  analyzeModel,
  cutMagnetPocket,
  MagnetCutterError,
} from "@/features/magnet/lib/magnet-cutter-handler";
import type { MagnetVec3 } from "@/features/magnet/lib/magnet-params";
import {
  expectedRemovedVolumeMm3,
  MAGNET_HOLE_DEPTH_MM,
  MAGNET_HOLE_RADIUS_MM,
  pickDefaultFace,
} from "@/features/magnet/lib/magnet-params";

/** 立方体的三角汤(法线朝外) */
function cubeSoup(size: number): Float32Array {
  const h = size / 2;
  const v: MagnetVec3[] = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  const faces: [number, number, number][] = [
    [0, 3, 2],
    [0, 2, 1],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const p = v[f[k]!]!;
      out[i * 9 + k * 3] = p[0];
      out[i * 9 + k * 3 + 1] = p[1];
      out[i * 9 + k * 3 + 2] = p[2];
    }
  });
  return out;
}

/** 薄板(1mm 厚,XY 方向 40×40)—— 用来测「太薄」 */
function plateSoup(thickness: number): Float32Array {
  const h = 20;
  const t = thickness / 2;
  const v: MagnetVec3[] = [
    [-h, -h, -t],
    [h, -h, -t],
    [h, h, -t],
    [-h, h, -t],
    [-h, -h, t],
    [h, -h, t],
    [h, h, t],
    [-h, h, t],
  ];
  const faces: [number, number, number][] = [
    [0, 3, 2],
    [0, 2, 1],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const p = v[f[k]!]!;
      out[i * 9 + k * 3] = p[0];
      out[i * 9 + k * 3 + 1] = p[1];
      out[i * 9 + k * 3 + 2] = p[2];
    }
  });
  return out;
}

/** 缺一个面的立方体 —— 有开放边,不是封闭流形 */
function openCubeSoup(size: number): Float32Array {
  const full = cubeSoup(size);
  // 去掉最后一个三角形(还剩一个洞)
  return full.subarray(0, full.length - 9);
}

/** 整体法线朝内 —— manifold 自己不报错,体积是负的 */
function invertedCubeSoup(size: number): Float32Array {
  const src = cubeSoup(size);
  const out = new Float32Array(src.length);
  for (let f = 0; f < src.length / 9; f++) {
    for (let k = 0; k < 3; k++) {
      out[f * 9 + k * 3] = src[f * 9 + k * 3]!;
      out[f * 9 + k * 3 + 1] = src[f * 9 + k * 3 + 1]!;
      out[f * 9 + k * 3 + 2] = src[f * 9 + k * 3 + 2]!;
    }
    // 交换后两个顶点 ⇒ 绕序反转
    const t1 = out[f * 9 + 3]!;
    const t2 = out[f * 9 + 4]!;
    const t3 = out[f * 9 + 5]!;
    out[f * 9 + 3] = t3;
    out[f * 9 + 4] = t2;
    out[f * 9 + 5] = t1;
  }
  return out;
}

describe("磁吸孔切割(真跑 manifold)", () => {
  it("切掉的体积跟「64 边形截面积 × 沉孔深」分毫不差", async () => {
    const result = await cutMagnetPocket(cubeSoup(40), "posZ");

    const expected = expectedRemovedVolumeMm3();
    expect(expected).toBeCloseTo(436.7934, 3);

    // 误差 < 0.01%
    const error = Math.abs(result.removedVolume - expected) / expected;
    expect(error).toBeLessThan(0.0001);

    // 切之前的体积就是 40³
    expect(result.volumeBefore).toBeCloseTo(64000, 0);
    expect(result.volumeAfter).toBeCloseTo(64000 - expected, 3);
  });

  it("切完的网格还是封闭流形(能再切一次不炸)", async () => {
    const result = await cutMagnetPocket(cubeSoup(40), "posZ");

    // 面数应该**变多**(孔壁 + 孔底)
    expect(result.triangleCount).toBeGreaterThan(12);

    // 拿切完的东西再切一次 ⇒ 不抛错 ⇒ 还是流形
    const again = await cutMagnetPocket(result.positions, "posZ");
    expect(again.removedVolume).toBeGreaterThan(0);
  });

  it("孔是**盲孔** —— 切完的体积比「通孔」少(底下还留着料)", async () => {
    const result = await cutMagnetPocket(cubeSoup(40), "posZ");
    const throughHole = Math.PI * MAGNET_HOLE_RADIUS_MM ** 2 * 40;
    expect(result.removedVolume).toBeLessThan(throughHole);
  });

  it("太薄的面切不得(1mm 板子会捅穿)", async () => {
    const analysis = await analyzeModel(plateSoup(1));

    // 上下两面:厚度只有 1mm,切 1.3mm 会捅穿
    const top = analysis.faces.find((f) => f.faceId === "posZ")!;
    expect(top.thicknessMm).toBeCloseTo(1, 3);
    expect(top.verdict).toBe("too_thin");

    // 四个侧面:厚度有 40mm(够),但孔放不下(净空只有 0.5mm)
    const side = analysis.faces.find((f) => f.faceId === "posX")!;
    expect(side.thicknessMm).toBeCloseTo(40, 3);
    expect(side.clearanceMm).toBeCloseTo(0.5, 2);
    expect(side.verdict).toBe("edge_spill");

    // 一个都不能切 ⇒ 默认挑面挑不出来
    expect(pickDefaultFace(analysis.faces)).toBeNull();

    await expect(cutMagnetPocket(plateSoup(1), "posZ")).rejects.toThrow(/捅穿/);
  });

  it("非流形的模型拒收,并指路到工作台的检查", async () => {
    await expect(cutMagnetPocket(openCubeSoup(40), "posZ")).rejects.toThrow(
      /封闭流形/
    );
    await expect(cutMagnetPocket(openCubeSoup(40), "posZ")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof MagnetCutterError && err.code === "NOT_MANIFOLD"
    );
  });

  it("整体法线朝内的模型 —— 自己翻过来照样能切", async () => {
    const normal = await cutMagnetPocket(cubeSoup(40), "posZ");
    const inverted = await cutMagnetPocket(invertedCubeSoup(40), "posZ");
    expect(inverted.removedVolume).toBeCloseTo(normal.removedVolume, 6);
  });

  it("六个面里挑出平整度最高的那个(立方体两个大面都是 0°)", async () => {
    const analysis = await analyzeModel(cubeSoup(40));
    expect(analysis.faces).toHaveLength(6);

    // 立方体:六个面的法线都跟射线完全垂直 ⇒ 平整度全是 0°
    for (const f of analysis.faces) {
      expect(f.hit).toBe(true);
      expect(f.flatnessDeg).toBeCloseTo(0, 5);
      expect(f.thicknessMm).toBeCloseTo(40, 3);
      expect(f.verdict).toBe("ok");
    }

    // 净空 = 半边长 20mm > 孔半径 10.35mm ⇒ 放得下
    expect(analysis.faces[0]!.clearanceMm).toBeCloseTo(20, 1);

    const best = pickDefaultFace(analysis.faces);
    expect(best).not.toBeNull();
    expect(best!.verdict).toBe("ok");
  });

  it("孔比面还大的时候 —— 那个面标「会切到边上」,切不得", async () => {
    // 20mm 的立方体:半边长 10mm < 孔半径 10.35mm
    const analysis = await analyzeModel(cubeSoup(20));
    expect(analysis.faces[0]!.clearanceMm).toBeCloseTo(10, 1);
    expect(analysis.faces[0]!.verdict).toBe("edge_spill");

    await expect(cutMagnetPocket(cubeSoup(20), "posZ")).rejects.toThrow(
      /切到边上/
    );
  });

  it("沉孔深就是 1.3mm —— 孔底还留着 38.7mm 的料", async () => {
    const result = await cutMagnetPocket(cubeSoup(40), "posZ");
    // 切掉的厚度 = 沉孔深;40 - 1.3 = 38.7
    const expected = expectedRemovedVolumeMm3(MAGNET_HOLE_DEPTH_MM);
    expect(result.removedVolume).toBeCloseTo(expected, 3);
  });
});
