/**
 * 切刀摆放数学 —— 纯函数那一层
 *
 * 守住的是**工作室那段 Blender 脚本翻译过来之后的关键数字**:
 * 半径 10.35 / 沉孔深 1.3 / 切刀外伸 0.5(两头共 1mm)。
 *
 * 这些数字错一个,切出来的孔就不是那个孔了。
 */
import { describe, expect, it } from "vitest";
import {
  alignZTo,
  computeCutterPlacement,
  expectedRemovedVolumeMm3,
  judgeFaceVerdict,
  MAGNET_CUTTER_PENETRATION_MM,
  MAGNET_CUTTER_SEGMENTS,
  MAGNET_FACE_DIRECTIONS,
  MAGNET_FACE_IDS,
  MAGNET_FACE_LABELS,
  MAGNET_HOLE_DEPTH_MM,
  MAGNET_HOLE_DIA_MM,
  MAGNET_HOLE_RADIUS_MM,
  MAGNET_MIN_WALL_MM,
  type MagnetVec3,
  pickDefaultFace,
  polygonAreaMm2,
} from "@/features/magnet/lib/magnet-params";

describe("磁吸孔参数", () => {
  it("孔径是固定的实物尺寸 —— Ø20.7mm / 深 1.3mm", () => {
    // 脚本里 HOLE_DIA_MM = 20.5 + TOLERANCE = 0.2
    expect(MAGNET_HOLE_DIA_MM).toBe(20.7);
    expect(MAGNET_HOLE_RADIUS_MM).toBe(10.35);
    expect(MAGNET_HOLE_DEPTH_MM).toBe(1.3);
    // 跟模型大小**无关** —— 磁铁是固定尺寸的实体
    expect(MAGNET_HOLE_DIA_MM).toBe(20.7);
  });

  it("切刀 64 段(跟 Blender 脚本一样)", () => {
    expect(MAGNET_CUTTER_SEGMENTS).toBe(64);
  });

  it("切刀在面外面多伸 0.5mm —— 这段不能省", () => {
    // 切刀跟面完全共面时布尔会出退化结果(切不进去 / 切出一圈毛边)
    expect(MAGNET_CUTTER_PENETRATION_MM).toBe(0.5);
  });

  it("孔底最少留 0.3mm 的料", () => {
    expect(MAGNET_MIN_WALL_MM).toBe(0.3);
  });
});

describe("切刀摆放", () => {
  const facePoint: MagnetVec3 = [0, 0, 20];
  const normal: MagnetVec3 = [0, 0, 1];

  it("切刀近端在面外面 1mm、远端在面里面 1.3mm", () => {
    const p = computeCutterPlacement(facePoint, normal);

    // 近端 / 远端的偏移是相对**面点**的(不是相对切刀中心)
    const near: MagnetVec3 = [
      facePoint[0] + p.axis[0] * p.nearOffsetMm,
      facePoint[1] + p.axis[1] * p.nearOffsetMm,
      facePoint[2] + p.axis[2] * p.nearOffsetMm,
    ];
    const far: MagnetVec3 = [
      facePoint[0] + p.axis[0] * p.farOffsetMm,
      facePoint[1] + p.axis[1] * p.farOffsetMm,
      facePoint[2] + p.axis[2] * p.farOffsetMm,
    ];

    // 面在 z=20,朝内是 −z
    expect(near[2]).toBeCloseTo(21, 6); // 面外 1mm
    expect(far[2]).toBeCloseTo(18.7, 6); // 面内 1.3mm

    // 切刀中心 = 面点 + 朝内 × (d/2 − p) = 20 − 0.15
    expect(p.center[2]).toBeCloseTo(19.85, 6);
  });

  it("切刀总高 = 沉孔深 + 两头各外伸一段 = 2.3mm", () => {
    const p = computeCutterPlacement(facePoint, normal);
    expect(p.height).toBeCloseTo(2.3, 6);
    expect(p.radius).toBeCloseTo(10.35, 6);
    expect(p.segments).toBe(64);
  });

  it("切刀轴 = 朝面的方向(跟法线反向)", () => {
    const p = computeCutterPlacement(facePoint, normal);
    expect(p.axis[0]).toBeCloseTo(0, 6);
    expect(p.axis[1]).toBeCloseTo(0, 6);
    expect(p.axis[2]).toBeCloseTo(-1, 6);
  });

  it("法线不归一化也能算对", () => {
    const p = computeCutterPlacement([0, 0, 0], [0, 0, 5]);
    expect(p.axis[2]).toBeCloseTo(-1, 6);
    expect(p.center[2]).toBeCloseTo(-0.15, 6);
  });
});

describe("alignZTo —— 列主序 4×4", () => {
  it("第三列就是目标方向", () => {
    for (const dir of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0.6, 0.8, 0],
    ] as MagnetVec3[]) {
      const m = alignZTo(dir);
      expect(m[8]).toBeCloseTo(dir[0]!, 6);
      expect(m[9]).toBeCloseTo(dir[1]!, 6);
      expect(m[10]).toBeCloseTo(dir[2]!, 6);
    }
  });

  it("三列互相正交、且都是单位向量", () => {
    const m = alignZTo([0.3, -0.5, 0.81]);
    const cols = [
      [m[0]!, m[1]!, m[2]!],
      [m[4]!, m[5]!, m[6]!],
      [m[8]!, m[9]!, m[10]!],
    ];
    for (const c of cols) {
      expect(Math.hypot(c[0]!, c[1]!, c[2]!)).toBeCloseTo(1, 6);
    }
    const dot = (a: number[], b: number[]) =>
      a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(cols[0]!, cols[1]!)).toBeCloseTo(0, 6);
    expect(dot(cols[0]!, cols[2]!)).toBeCloseTo(0, 6);
    expect(dot(cols[1]!, cols[2]!)).toBeCloseTo(0, 6);
  });

  it("末四行是齐次坐标那一行", () => {
    const m = alignZTo([0, 0, 1]);
    expect(m[12]).toBe(0);
    expect(m[13]).toBe(0);
    expect(m[14]).toBe(0);
    expect(m[15]).toBe(1);
  });
});

describe("体积口径", () => {
  it("64 边形的面积比真圆小 0.16% —— 但必须按多边形算", () => {
    const poly = polygonAreaMm2(MAGNET_HOLE_RADIUS_MM);
    const circle = Math.PI * MAGNET_HOLE_RADIUS_MM ** 2;
    expect(poly).toBeCloseTo(335.9949, 3);
    expect(circle).toBeCloseTo(336.5353, 3);
    expect(poly).toBeLessThan(circle);
    expect((circle - poly) / circle).toBeCloseTo(0.0016, 4);
  });

  it("切一个孔应该去掉 436.7934 mm³", () => {
    expect(expectedRemovedVolumeMm3()).toBeCloseTo(436.7934, 3);
  });
});

describe("「这个面能不能切」", () => {
  it("打不中 ⇒ no_hit", () => {
    expect(judgeFaceVerdict({ thicknessMm: null, clearanceMm: null })).toBe(
      "no_hit"
    );
  });

  it("厚度不够(切完会捅穿)⇒ too_thin", () => {
    // 需要 ≥ 1.3 + 0.3 = 1.6mm
    expect(judgeFaceVerdict({ thicknessMm: 1.5, clearanceMm: 20 })).toBe(
      "too_thin"
    );
    expect(judgeFaceVerdict({ thicknessMm: 1.6, clearanceMm: 20 })).toBe("ok");
  });

  it("净空不够(孔会切到边上)⇒ edge_spill", () => {
    expect(judgeFaceVerdict({ thicknessMm: 10, clearanceMm: 10.3 })).toBe(
      "edge_spill"
    );
    expect(judgeFaceVerdict({ thicknessMm: 10, clearanceMm: 10.35 })).toBe(
      "ok"
    );
  });

  it("净空量不出来(null)不判成 edge_spill", () => {
    expect(judgeFaceVerdict({ thicknessMm: 10, clearanceMm: null })).toBe("ok");
  });
});

describe("默认挑面", () => {
  it("挑平整度最高(角度最小)且能切的那个", () => {
    const best = pickDefaultFace([
      { verdict: "ok", flatnessDeg: 12 },
      { verdict: "ok", flatnessDeg: 3 },
      { verdict: "too_thin", flatnessDeg: 0 },
    ]);
    expect(best?.flatnessDeg).toBe(3);
  });

  it("一个都不能切 ⇒ null", () => {
    expect(
      pickDefaultFace([
        { verdict: "too_thin", flatnessDeg: 0 },
        { verdict: "edge_spill", flatnessDeg: 1 },
      ])
    ).toBeNull();
  });
});

describe("六个面的命名", () => {
  it("只用轴 + 符号(不用「前/后/左/右」)", () => {
    expect(MAGNET_FACE_IDS).toEqual([
      "posZ",
      "negZ",
      "posY",
      "negY",
      "posX",
      "negX",
    ]);
    for (const id of MAGNET_FACE_IDS) {
      expect(MAGNET_FACE_LABELS[id]).toMatch(/^[+−][XYZ]$/);
    }
  });

  it("每个面都有确定的朝外方向", () => {
    expect(MAGNET_FACE_DIRECTIONS.posX).toEqual([1, 0, 0]);
    expect(MAGNET_FACE_DIRECTIONS.negX).toEqual([-1, 0, 0]);
    expect(MAGNET_FACE_DIRECTIONS.posY).toEqual([0, 1, 0]);
    expect(MAGNET_FACE_DIRECTIONS.negY).toEqual([0, -1, 0]);
    expect(MAGNET_FACE_DIRECTIONS.posZ).toEqual([0, 0, 1]);
    expect(MAGNET_FACE_DIRECTIONS.negZ).toEqual([0, 0, -1]);
  });
});
