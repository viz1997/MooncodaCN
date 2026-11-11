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
 * 4. **不是封闭实体的模型**(有开放边 / 非流形边)⇒ **自动修好再切**,
 *    不因为这个拒绝(工作室 2026-11-11)
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

/** 绕 X 轴把整个三角汤转 `deg` 度(刚体旋转,拓扑不动) */
function rotateSoupX(soup: Float32Array, deg: number): Float32Array {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i]!;
    const y = soup[i + 1]!;
    const z = soup[i + 2]!;
    out[i] = x;
    out[i + 1] = y * c - z * s;
    out[i + 2] = y * s + z * c;
  }
  return out;
}

/** 立方体的 UV(每三角形 6 个 float)—— 每个三角形给一组**互不相同**的 UV */
function cubeUvs(triangleCount: number): Float32Array {
  const uvs = new Float32Array(triangleCount * 6);
  for (let t = 0; t < triangleCount; t++) {
    uvs[t * 6 + 0] = t / triangleCount;
    uvs[t * 6 + 1] = 0;
    uvs[t * 6 + 2] = (t + 1) / triangleCount;
    uvs[t * 6 + 3] = 0;
    uvs[t * 6 + 4] = t / triangleCount;
    uvs[t * 6 + 5] = 1 / triangleCount;
  }
  return uvs;
}

/** 立方体的材质分组 —— 顶面(三角形 2、3)是材质 1,其余是材质 0 */
function cubeMaterialIndex(triangleCount: number): Uint16Array {
  const out = new Uint16Array(triangleCount);
  out[2] = 1;
  out[3] = 1;
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

  it("**不是封闭实体的模型也能切** —— 自动补洞(工作室 2026-11-11)", async () => {
    // 缺一个面的立方体:有开放边,不是封闭流形。
    // 早先这一条是「拒收」—— 工作室的原话是「不要因为这个问题切不了」。
    const broken = openCubeSoup(40);

    // 修好之后照样切得动
    const result = await cutMagnetPocket(broken, "posZ");
    const expected = expectedRemovedVolumeMm3();
    // 切掉的体积跟完好的立方体**分毫不差** ⇒ 补出来的那个面就在正确的位置
    expect(result.removedVolume).toBeCloseTo(expected, 3);
    // 切之前的体积是完整的 40³(补出来的盖面把体积补回来了)
    expect(result.volumeBefore).toBeCloseTo(64000, 0);
  });

  it("自动修复之后还是破的 ⇒ 那才拒收(而且说清楚还剩几条)", async () => {
    // 一张孤零零的三角形:补上盖面之后「封闭」了,但它**没有厚度**
    // (体积是 0)⇒ 布尔那一步会拒。自己先拦下来,说人话。
    const shards = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    await expect(cutMagnetPocket(shards, "posZ")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof MagnetCutterError &&
        err.code === "NOT_MANIFOLD" &&
        /自动修复之后/.test(err.message)
    );
  });

  it("**改了用户的模型就得告诉用户** —— 分析结果里带着修复的经过", async () => {
    const analysis = await analyzeModel(openCubeSoup(40));
    expect(analysis.repair).not.toBeNull();
    expect(analysis.repair?.changed).toBe(true);
    // 补了一个洞(缺的那一面)
    expect(analysis.repair?.filledLoops).toBe(1);
    expect(analysis.repair?.closed).toBe(true);

    // 完好的模型 —— **一个字节都没动**
    const clean = await analyzeModel(cubeSoup(40));
    expect(clean.repair?.changed).toBe(false);
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

describe("孔参数可调(工作室 2026-11-11)", () => {
  it("Ø10 / 深 2mm ⇒ 去掉 156.83 mm³", async () => {
    const hole = { holeDiaMm: 10, holeDepthMm: 2 };
    const result = await cutMagnetPocket(cubeSoup(40), "posZ", hole);

    const expected = expectedRemovedVolumeMm3(2, 5);
    expect(expected).toBeCloseTo(156.8274, 3);

    const error = Math.abs(result.removedVolume - expected) / expected;
    expect(error).toBeLessThan(0.0001);
    expect(result.expectedRemovedVolume).toBeCloseTo(expected, 3);
  });

  it("**孔径是绝对毫米** —— 模型放大一倍,孔还是那么粗", async () => {
    const hole = { holeDiaMm: 10, holeDepthMm: 2 };
    const small = await cutMagnetPocket(cubeSoup(40), "posZ", hole);
    const big = await cutMagnetPocket(cubeSoup(80), "posZ", hole);
    // 去掉的是同一块料 —— 孔不跟模型缩放
    expect(big.removedVolume).toBeCloseTo(small.removedVolume, 3);
  });

  it("调浅了 ⇒ 1mm 的薄板也切得动(默认 1.3mm 会捅穿)", async () => {
    const hole = { holeDiaMm: 20.7, holeDepthMm: 0.5 };
    const analysis = await analyzeModel(plateSoup(1), hole);
    const top = analysis.faces.find((f) => f.faceId === "posZ")!;
    // 0.5 + 0.3 = 0.8mm ≤ 1mm ⇒ 不算太薄
    expect(top.verdict).toBe("ok");

    const result = await cutMagnetPocket(plateSoup(1), "posZ", hole);
    const expected = expectedRemovedVolumeMm3(0.5, 10.35);
    expect(result.removedVolume).toBeCloseTo(expected, 3);
  });

  it("调深了 ⇒ 同一个面判成「太薄」,切不得", async () => {
    const analysis = await analyzeModel(plateSoup(1), {
      holeDiaMm: 20.7,
      holeDepthMm: 2,
    });
    const top = analysis.faces.find((f) => f.faceId === "posZ")!;
    expect(top.verdict).toBe("too_thin");

    await expect(
      cutMagnetPocket(plateSoup(1), "posZ", {
        holeDiaMm: 20.7,
        holeDepthMm: 2,
      })
    ).rejects.toThrow(/捅穿/);
  });
});

describe("智能识别背面(工作室 2026-11-11)", () => {
  it("立方体 ⇒ 找出 6 块平面,最大那块就是背面", async () => {
    const analysis = await analyzeModel(cubeSoup(40));

    expect(analysis.patches).toHaveLength(6);
    expect(analysis.backFace).not.toBeNull();
    // 每个面 40×40 = 1600mm²
    expect(analysis.backFace!.areaMm2).toBeCloseTo(1600, 3);
    expect(analysis.backFace!.faceCount).toBe(2);
    // 面积从大到小排
    for (let i = 1; i < analysis.patches.length; i++) {
      expect(analysis.patches[i]!.areaMm2).toBeLessThanOrEqual(
        analysis.patches[i - 1]!.areaMm2
      );
    }
  });

  it("长方体 ⇒ 挑面积最大的那块(不是「最平的那个轴向面」)", async () => {
    const analysis = await analyzeModel(plateSoup(10));
    // 40×40 = 1600 > 40×10 = 400
    expect(analysis.backFace!.areaMm2).toBeCloseTo(1600, 3);
  });

  it("**模型歪了照样找得到** —— 原脚本只在六个轴向里找,歪了就找不着", async () => {
    const tilted = rotateSoupX(plateSoup(10), 37);
    const analysis = await analyzeModel(tilted);

    expect(analysis.backFace).not.toBeNull();
    expect(analysis.backFace!.areaMm2).toBeCloseTo(1600, 3);
    expect(analysis.backFace!.verdict).toBe("ok");
    // 法线跟着模型转了 —— 不是 [0,0,1]
    expect(analysis.backFace!.normal[2]).not.toBeCloseTo(1, 3);
  });

  it("`auto` 切的就是那块平面", async () => {
    const result = await cutMagnetPocket(cubeSoup(40), "auto");
    const expected = expectedRemovedVolumeMm3();
    expect(result.removedVolume).toBeCloseTo(expected, 3);
  });

  it("`auto` 在歪着的模型上也切得动", async () => {
    const tilted = rotateSoupX(plateSoup(10), 37);
    const result = await cutMagnetPocket(tilted, "auto");
    const expected = expectedRemovedVolumeMm3();
    expect(result.removedVolume).toBeCloseTo(expected, 3);
  });

  it("`patch:1` 切第二块候选平面", async () => {
    const result = await cutMagnetPocket(cubeSoup(40), "patch:1");
    const expected = expectedRemovedVolumeMm3();
    expect(result.removedVolume).toBeCloseTo(expected, 3);
  });
});

describe("导出要保留原来的材质贴图(工作室 2026-11-11)", () => {
  it("UV 和材质分组布尔之后都还在", async () => {
    const soup = cubeSoup(40);
    const triangleCount = soup.length / 9;
    const uvs = cubeUvs(triangleCount);
    const materialIndex = cubeMaterialIndex(triangleCount);

    const result = await cutMagnetPocket(soup, "posZ", null, {
      uvs,
      materialIndex,
      materialNames: ["Base", "Top"],
    });

    // --- UV ---
    expect(result.uvs).not.toBeNull();
    expect(result.uvs!.length).toBe(result.triangleCount * 6);

    // 原来 12 个三角形的 UV 一组都没丢
    const original = new Set<string>();
    for (let t = 0; t < triangleCount; t++) {
      for (let k = 0; k < 3; k++) {
        original.add(`${uvs[t * 6 + k * 2]},${uvs[t * 6 + k * 2 + 1]}`);
      }
    }
    const survived = new Set<string>();
    for (let t = 0; t < result.triangleCount; t++) {
      for (let k = 0; k < 3; k++) {
        survived.add(
          `${result.uvs![t * 6 + k * 2]},${result.uvs![t * 6 + k * 2 + 1]}`
        );
      }
    }
    for (const uv of original) {
      expect(survived.has(uv)).toBe(true);
    }

    // --- 材质分组 ---
    expect(result.materialIndex).not.toBeNull();
    expect(result.materialIndex!.length).toBe(result.triangleCount);
    expect(result.materialNames).toEqual(["Base", "Top"]);

    const used = new Set(result.materialIndex!);
    expect(used.has(0)).toBe(true);
    expect(used.has(1)).toBe(true);

    // 孔壁 / 孔底是新生成的三角形 ⇒ 归到「被切那个面」的材质(材质 1)
    const topCount = [...result.materialIndex!].filter((m) => m === 1).length;
    expect(topCount).toBeGreaterThan(2);
  });

  it("没贴图的模型 ⇒ UV / 材质是 null(不硬塞一个空的)", async () => {
    const result = await cutMagnetPocket(cubeSoup(40), "posZ");
    expect(result.uvs).toBeNull();
    expect(result.materialIndex).toBeNull();
    expect(result.materialNames).toBeNull();
  });

  it("切完之后还是封闭流形 —— 带贴图那条路也是", async () => {
    const soup = cubeSoup(40);
    const triangleCount = soup.length / 9;
    const result = await cutMagnetPocket(soup, "posZ", null, {
      uvs: cubeUvs(triangleCount),
      materialIndex: cubeMaterialIndex(triangleCount),
      materialNames: ["Base", "Top"],
    });

    // 再切一次 ⇒ 不抛错
    const again = await cutMagnetPocket(result.positions, "posZ");
    expect(again.removedVolume).toBeGreaterThan(0);
  });
});
