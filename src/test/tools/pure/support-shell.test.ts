import { describe, expect, it } from "vitest";
import {
  computeSupportAtPose,
  DEFAULT_SUPPORT_PARAMS,
  findOptimalAngle,
} from "@/features/pricing/lib/angle-optimizer";
import {
  buildSupportShell,
  computeSupportVolume,
  prepareSupportModel,
  rotateSupportMesh,
} from "@/features/tools/lib/mesh/support-shell";
import { boxTriangles, uvSphere } from "@/test/tools/fixtures/mesh-fixtures";

/**
 * 包裹支撑算法(模型检查工具 + 克重工具共用)的测试
 *
 * 支撑体 = 平台与模型下朝向面之间的那块材料,按 XY 列(height field)算:
 *
 *   支撑高 = (该列下朝向面的高度 underZ − 平台 groundZ)
 *            − 该列里模型自己占掉的部分
 *
 * 平台永远在模型最低点略下方(模型是摆在平台上的),所以:
 *   - 平底模型(立方体)→ 几乎没有支撑
 *   - 悬空结构(帽 + 细腿)→ 帽下面那圈空间是支撑
 *   - 球 → 球底那圈透镜形空间是支撑
 *
 * 纯计算,不需要 DB / 网络 / 浏览器。
 */

/** 拼多个三角汤 */
function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** 立方体:20mm 见方,底面贴平台 */
const CUBE = boxTriangles([0, 0, 0], [20, 20, 20]);

/**
 * 桌子:细腿(4×4×18)撑起一块大帽(20×20×2)
 * 帽下那圈空间(20×20 − 4×4)×18 是支撑
 */
const TABLE = concat(
  boxTriangles([8, 8, 0], [12, 12, 18]),
  boxTriangles([0, 0, 18], [20, 20, 20])
);

/** 球:r=10,底面贴平台 */
const BALL = (() => {
  const tris: number[][] = [];
  uvSphere(tris, 10, 10, 10, 10);
  return new Float32Array(tris.flat());
})();

type SupportOptions = {
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  gapScale?: number;
  gridSizeMM?: number;
};

/** 走一遍「检测工具」那条路:焊接 → 旋转 → 外壳 → 体积 */
function supportOf(positions: Float32Array, options: SupportOptions = {}) {
  const model = prepareSupportModel(positions);
  const rotated = rotateSupportMesh(
    model.mesh,
    options.rotX ?? 0,
    options.rotY ?? 0,
    options.rotZ ?? 0
  );
  const shell = buildSupportShell(
    rotated,
    model.faceEnclosed,
    undefined,
    options.gapScale ?? 1
  );
  const volume = computeSupportVolume(shell, rotated, {
    gridSizeMM: options.gridSizeMM ?? 0.25,
  });
  return { shell, volume };
}

describe("computeSupportVolume —— 包裹支撑体积", () => {
  it("平底立方体:底面贴平台 → 没有支撑", () => {
    const { volume } = supportOf(CUBE);

    expect(volume.volumeMM3).toBeLessThan(1);
    expect(volume.supportAreaMM2).toBeLessThan(1);
    expect(volume.maxHeightMM).toBeLessThan(0.001);
  });

  it("桌子:帽下那圈空间是支撑(≈ (400−16)×18)", () => {
    const { volume } = supportOf(TABLE);

    // 理论值 6912 mm³;外壳外扩与栅格离散会带来几个百分点的偏差
    expect(volume.volumeMM3).toBeGreaterThan(5200);
    expect(volume.volumeMM3).toBeLessThan(8600);
    // 支撑占地 = 帽的投影去掉腿
    expect(volume.supportAreaMM2).toBeGreaterThan(300);
    expect(volume.supportAreaMM2).toBeLessThan(420);
    // 支撑最高点 ≈ 帽底高度
    expect(volume.maxHeightMM).toBeGreaterThan(15);
    expect(volume.maxHeightMM).toBeLessThan(19);
  });

  it("桌子翻过来(180°):帽变成底座 → 没有支撑", () => {
    const { volume } = supportOf(TABLE, { rotX: 180 });

    expect(volume.volumeMM3).toBeLessThan(1);
    expect(volume.supportAreaMM2).toBeLessThan(1);
  });

  it("球:球底透镜形空间是支撑(≈ ⅓πr³)", () => {
    const { volume } = supportOf(BALL);

    // r=10 → (1/3)πr³ ≈ 1047 mm³;外壳外扩后略大
    expect(volume.volumeMM3).toBeGreaterThan(700);
    expect(volume.volumeMM3).toBeLessThan(1600);
  });

  it("包裹间隙倍率:只影响外壳间隙,不影响拓扑", () => {
    const a = supportOf(TABLE);
    const b = supportOf(TABLE, { gapScale: 2 });

    expect(b.shell.gap).toBeCloseTo(a.shell.gap * 2, 6);
    // 间隙变大 → 外壳撑得更开 → 帽底被压低 → 支撑变少
    expect(b.volume.volumeMM3).toBeLessThan(a.volume.volumeMM3);
    // 平台平面始终贴着模型最低点
    expect(b.shell.groundZ).toBeCloseTo(a.shell.groundZ, 6);
  });

  it("平台平面在模型最低点略下方", () => {
    const { shell } = supportOf(TABLE);

    expect(shell.groundZ).toBeLessThan(0);
    expect(shell.groundZ).toBeGreaterThan(-0.5);
  });
});

describe("两个工具算的是同一块支撑", () => {
  it("克重工具的支撑体积 == 检测工具的支撑体积", () => {
    const positions = TABLE;
    const model = prepareSupportModel(positions);
    const pose = computeSupportAtPose(model, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });
    const { volume } = supportOf(positions, { gridSizeMM: 0.25 });

    expect(pose.supportVolumeMM3).toBeCloseTo(volume.volumeMM3, 3);
    expect(pose.supportAreaMM2).toBeCloseTo(volume.supportAreaMM2, 3);
    expect(pose.wrapAreaMM2).toBeCloseTo(volume.contactAreaMM2, 3);
    // 克重 = 体积 × 填充率 × 密度
    expect(pose.supportWeightG).toBeCloseTo(
      volume.volumeMM3 *
        DEFAULT_SUPPORT_PARAMS.fillRate *
        DEFAULT_SUPPORT_PARAMS.density *
        0.001,
      6
    );
  });

  it("摆盘会挑支撑最少的姿态(桌子翻过来)", () => {
    const model = prepareSupportModel(TABLE);
    // 模型本体:帽 20×20×2 + 腿 4×4×18 = 1088 mm³ → 1.088 cm³ × 1.15 g/cm³
    const optimal = findOptimalAngle(model, 2400, undefined, 50, 1.25, 1);

    // ±180 等价:帽翻过来当底座
    expect(Math.abs(optimal.rotX)).toBe(180);
    expect(optimal.rotY).toBe(0);
    expect(optimal.totalSupportWeight).toBeLessThan(0.05);
    expect(optimal.selfSupportRatio).toBeLessThan(0.05);
  });
});
