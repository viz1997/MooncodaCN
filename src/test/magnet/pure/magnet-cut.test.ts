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
 * 4. **不是封闭实体的模型**(有开放边 / 非流形边)⇒ **临时盖面再切**,
 *    不因为这个拒绝(工作室 2026-11-11)
 * 5. **切完用户的模型一个字节都没改** —— 临时盖面切完就摘掉,破口还在
 *    (工作室 2026-11-11:「不需要修复用户的模型,只需要完成磁铁孔」)
 * 6. 六个面里挑出**平整度最高**的
 * 7. 整体法线朝内的模型 —— manifold 自己不报错,**得我们翻过来**
 */
import { describe, expect, it } from "vitest";
import {
  analyzeModel,
  cutMagnetPocket,
  MagnetCutterError,
} from "@/features/magnet/lib/magnet-cutter-handler";
import { scanMagnetBoundary } from "@/features/magnet/lib/magnet-lid";
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

/**
 * 三角汤 → 索引面表(按「坐标完全一样」焊)
 *
 * 用来数开放边 —— 切完的模型**是不是还带着用户自己的破口**,就看这个数。
 */
function indexSoup(soup: Float32Array): number[] {
  const map = new Map<string, number>();
  const faceVertex: number[] = [];
  const triCount = soup.length / 9;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      const key = `${soup[i]!}|${soup[i + 1]!}|${soup[i + 2]!}`;
      let id = map.get(key);
      if (id === undefined) {
        id = map.size;
        map.set(key, id);
      }
      faceVertex.push(id);
    }
  }
  return faceVertex;
}

/**
 * 每个面的三个顶点**各复制一份**并加一点点扰动
 *
 * 这就是 AI 生成模型的典型样子:同一个逻辑顶点,不同面各自算了一遍,
 * 差了 1e-4mm。**模型本身没破** —— 破了的是我们的焊接容差。
 */
function jitteredCubeSoup(size: number, jitter: number): Float32Array {
  const src = cubeSoup(size);
  const out = new Float32Array(src.length);
  for (let f = 0; f < src.length / 9; f++) {
    for (let k = 0; k < 3; k++) {
      out[f * 9 + k * 3] = src[f * 9 + k * 3]!;
      out[f * 9 + k * 3 + 1] = src[f * 9 + k * 3 + 1]!;
      out[f * 9 + k * 3 + 2] = src[f * 9 + k * 3 + 2]!;
    }
    // 三个顶点各错开一点(方向不同 ⇒ 不会互相抵消)
    out[f * 9] = out[f * 9]! + jitter;
    out[f * 9 + 4] = out[f * 9 + 4]! + jitter;
    out[f * 9 + 8] = out[f * 9 + 8]! + jitter;
  }
  return out;
}

/**
 * 整体法线朝内 —— manifold 自己不报错,体积是负的
 *
 * ⚠️ **这里换的是「整个顶点」** —— 把每张面的第 2、第 3 个顶点对调,
 * 绕序就反了,几何一点没变(还是那 8 个立方体的角)。
 *
 * (早先那版换的是「顶点 2 的 x / z 分量」—— 那是把顶点**镜像**了一下,
 *  面跟面之间的边对不上了,整个网格是**破的**(8 条开放边 / 3 条非流形边),
 *  压根不是「朝内」。它当年能过,是因为修复那一层会**补洞**把它糊起来 ——
 *  补洞那套 2026-11-11 已经退役了(工作室:「不需要修复用户的模型」),
 *  所以夹具得改成真的朝内。)
 */
function invertedCubeSoup(size: number): Float32Array {
  const src = cubeSoup(size);
  const out = new Float32Array(src.length);
  out.set(src);
  for (let f = 0; f < src.length / 9; f++) {
    const base = f * 9;
    for (let k = 0; k < 3; k++) {
      const v1 = out[base + 3 + k]!;
      out[base + 3 + k] = out[base + 6 + k]!;
      out[base + 6 + k] = v1;
    }
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

  it("**不是封闭实体的模型也能切** —— 临时盖面,切完摘掉(工作室 2026-11-11)", async () => {
    // 缺一个面的立方体:有开放边,不是封闭流形。
    // 早先这一条是「拒收」—— 工作室的原话是「不要因为这个问题切不了」。
    const broken = openCubeSoup(40);

    // 临时盖上之后照样切得动
    const result = await cutMagnetPocket(broken, "posZ");
    const expected = expectedRemovedVolumeMm3();
    // 切掉的体积跟完好的立方体**分毫不差** ⇒ 盖面就在正确的位置
    expect(result.removedVolume).toBeCloseTo(expected, 3);
    // 切之前的体积是完整的 40³(临时盖面把体积补回来了 —— 只是给布尔用的)
    expect(result.volumeBefore).toBeCloseTo(64000, 0);
  });

  it("**不需要修复用户的模型** —— 切完用户的破口还在,一个面都没多(工作室 2026-11-11)", async () => {
    const broken = openCubeSoup(40);
    const solid = cubeSoup(40);

    const open = await cutMagnetPocket(broken, "posZ");
    const closed = await cutMagnetPocket(solid, "posZ");

    // 孔切得一模一样
    expect(open.removedVolume).toBeCloseTo(closed.removedVolume, 6);

    // **临时盖面被摘掉了** ⇒ 破的那个立方体切出来的面数比完好的少一张
    // (完好的那个:盖面 = 缺掉的那半张 −X 面;破的那个:那张盖面没了)
    expect(open.triangleCount).toBe(closed.triangleCount - 1);

    // **破口还在** —— 完好的那个是封闭的,破的那个不是
    expect(scanMagnetBoundary(indexSoup(closed.positions)).openEdges).toBe(0);
    const openScan = scanMagnetBoundary(indexSoup(open.positions));
    expect(openScan.openEdges).toBeGreaterThan(0);
    expect(openScan.loops.length).toBeGreaterThan(0);
  });

  it("**近重合顶点的模型照样切** —— 焊回去就好,**不用修复**(工作室 2026-11-11)", async () => {
    // 工作室的真实模型:461 条开放边。根因**不是模型破**,是我们的焊接太严
    // (diag × 1e-7 ≈ 0.000004mm,Blender 的 `remove_doubles` 是 0.1mm ——
    //  粗了两万五千倍)。同一个逻辑顶点差 1e-4mm ⇒ 焊不上 ⇒ 一堆假开放边。
    const jittered = jitteredCubeSoup(40, 1e-4);

    // 切得动 —— 切掉的体积跟完好的立方体分毫不差
    const result = await cutMagnetPocket(jittered, "posZ");
    expect(result.removedVolume).toBeCloseTo(expectedRemovedVolumeMm3(), 3);
    expect(result.volumeBefore).toBeCloseTo(64000, 0);

    // **而且一丁点几何都没改** —— 没补洞、没删面、没翻绕序
    const analysis = await analyzeModel(jittered);
    expect(analysis.repair?.cappedLoops).toBe(0);
    expect(analysis.repair?.lidFaces).toBe(0);
    expect(analysis.repair?.droppedDegenerate).toBe(0);
    expect(analysis.repair?.droppedDuplicate).toBe(0);
    expect(analysis.repair?.droppedNonManifold).toBe(0);
    expect(analysis.repair?.flippedFaces).toBe(0);
    expect(analysis.repair?.changed).toBe(false);

    // 焊上去了 —— 界面上的那句告知有东西可说
    expect(analysis.repair?.weldedNearDuplicates).toBeGreaterThan(0);
  });

  it("临时盖面也封不上 ⇒ 那才拒收(而且说清楚还剩几条)", async () => {
    // 一张孤零零的三角形:临时盖上之后「封闭」了,但它**没有厚度**
    // (体积是 0)⇒ 布尔那一步会拒。自己先拦下来,说人话。
    const shards = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    await expect(cutMagnetPocket(shards, "posZ")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof MagnetCutterError &&
        err.code === "NOT_MANIFOLD" &&
        /没有实体|厚度/.test(err.message)
    );
  });

  it("**用户的模型一个字节都没改** —— 分析结果里说的就是「临时封上,切完摘掉」", async () => {
    const analysis = await analyzeModel(openCubeSoup(40));
    expect(analysis.repair).not.toBeNull();
    // **模型本身还是破的**(我们没有补它)
    expect(analysis.repair?.closed).toBe(false);
    expect(analysis.repair?.openEdgesAfter).toBeGreaterThan(0);
    // 但**临时封上之后能参与布尔运算**
    expect(analysis.repair?.closedForBoolean).toBe(true);
    // 临时盖面补了几处
    expect(analysis.repair?.cappedLoops).toBe(1);
    expect(analysis.repair?.lidFaces).toBe(1);
    // **一丁点几何都没动** —— 盖面是临时的,不算「改过」
    expect(analysis.repair?.changed).toBe(false);

    // 完好的模型 —— **一个字节都没动**
    const clean = await analyzeModel(cubeSoup(40));
    expect(clean.repair?.changed).toBe(false);
    expect(clean.repair?.cappedLoops).toBe(0);
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
