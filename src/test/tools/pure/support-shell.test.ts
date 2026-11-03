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
  scaleSupportModel,
} from "@/features/tools/lib/mesh/support-shell";
import { boxTriangles, uvSphere } from "@/test/tools/fixtures/mesh-fixtures";

/**
 * 包裹支撑算法(模型检查工具 + 克重工具共用)的测试
 *
 * 支撑体 = 平台与模型下表面之间的那块材料,按 XY 列(height field)算。
 * 一列穿过模型表面得到一串 z 交点,按奇偶配对:相邻两个交点之间是模型材料,
 * 空出来的那几段才是支撑。平台取模型最低点(模型是摆在平台上的),所以:
 *   - 平底模型(立方体)→ 没有支撑
 *   - 悬空结构(帽 + 细腿)→ 帽下面那圈空间是支撑
 *   - 宽底座 + 悬空身体 → 底座不能把上面那圈支撑吃掉
 *   - 球 → 球底那圈透镜形空间是支撑
 *
 * 体积走真几何(网格自己的顶点),跟模型克重同一口径 —— 检测工具画外壳时
 * 那圈可视化间隙不进克重。
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

/**
 * 宽底座 + 悬空身体:底座 32×32×4,身体 26×26 悬在底座上方 6mm(z 10~30)
 * 支撑 = 身体底下那圈空气 = 26×26×6 = 4056 mm³
 *
 * 这一对是老算法翻车的地方:老算法假设「一列里的模型是从下边界一直实心到
 * 上边界」,底座一盖住身体,悬空那 6mm 就被当成模型自己占掉,支撑算成 0。
 */
const BASE_AND_HOVERING_BODY = concat(
  boxTriangles([-16, -16, 0], [16, 16, 4]),
  boxTriangles([-13, -13, 10], [13, 13, 30])
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

  it("宽底座 + 悬空身体:底座不能把悬空那圈支撑吃掉", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY);

    // 解析值 26×26×6 = 4056 mm³
    expect(volume.volumeMM3).toBeGreaterThan(3800);
    expect(volume.volumeMM3).toBeLessThan(4300);
    // 支撑占地 = 身体的投影 26×26
    expect(volume.supportAreaMM2).toBeGreaterThan(640);
    expect(volume.supportAreaMM2).toBeLessThan(700);
    // 支撑最高点 = 支撑顶面(身体底面)离平台的高度
    expect(volume.maxHeightMM).toBeGreaterThan(9.5);
    expect(volume.maxHeightMM).toBeLessThan(10.5);
  });

  it("包裹间隙倍率:只影响可视化外壳,不影响支撑克重", () => {
    const a = supportOf(TABLE);
    const b = supportOf(TABLE, { gapScale: 2 });

    expect(b.shell.gap).toBeCloseTo(a.shell.gap * 2, 6);
    // 外壳间隙是检测工具画外壳时用的,不进克重 —— 支撑体积跟模型克重同一口径
    expect(b.volume.volumeMM3).toBeCloseTo(a.volume.volumeMM3, 6);
    expect(b.volume.supportAreaMM2).toBeCloseTo(a.volume.supportAreaMM2, 6);
    // 平台平面始终贴着模型最低点
    expect(b.shell.groundZ).toBeCloseTo(a.shell.groundZ, 6);
  });

  it("平台平面在模型最低点略下方", () => {
    const { shell } = supportOf(TABLE);

    expect(shell.groundZ).toBeLessThan(0);
    expect(shell.groundZ).toBeGreaterThan(-0.5);
  });
});

describe("尺寸缩放(2026-11-03)", () => {
  it("均匀缩放 k 倍:支撑体积按 k³ 走", () => {
    const base = prepareSupportModel(TABLE);
    const scaled = scaleSupportModel(base, 2, 2, 2);
    const a = computeSupportAtPose(base, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });
    const b = computeSupportAtPose(scaled, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });

    // 支撑区域(模型下表面到平台)在缩放下是自映射的 → 体积精确乘 det(S)
    const ratio = b.supportVolumeMM3 / a.supportVolumeMM3;
    expect(ratio).toBeGreaterThan(7.8);
    expect(ratio).toBeLessThan(8.2);
    // 占地按 k²
    expect(b.supportAreaMM2 / a.supportAreaMM2).toBeCloseTo(4, 1);
  });

  it("非均匀缩放:高度按真实几何算(不是乘系数)", () => {
    const base = prepareSupportModel(TABLE);
    const scaled = scaleSupportModel(base, 1, 1, 2);
    const pose = computeSupportAtPose(scaled, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });

    // 桌子原高 20mm(腿 18 + 帽 2),Z 拉高 2 倍 → 40mm
    expect(pose.rotatedHeightMM).toBeCloseTo(40, 1);
  });

  it("缩放后模型克重与支撑克重同一口径(体积 × 缩放因子)", () => {
    const base = prepareSupportModel(TABLE);
    const scaled = scaleSupportModel(base, 1.5, 1.5, 1.5);
    const a = computeSupportAtPose(base, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });
    const b = computeSupportAtPose(scaled, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });

    // 克重 = 体积 × 填充率 × 密度,两边同样算 → 比值就是体积比
    const weightA = a.supportWeightG;
    const weightB = b.supportWeightG;
    expect(weightB / weightA).toBeCloseTo(1.5 ** 3, 1);
  });
});

describe("全包裹 − 模型 = 支撑(2026-11-03)", () => {
  it("桌子:全包裹体积 = 支撑体积 + 模型体积", () => {
    const { volume } = supportOf(TABLE, { gridSizeMM: 0.25 });

    // 全包裹 = 平台到模型顶的整块:20×20 投影 × 20mm 高 = 8000 mm³
    expect(volume.wrapVolumeMM3).toBeGreaterThan(7600);
    expect(volume.wrapVolumeMM3).toBeLessThan(8400);
    // 模型本体 = 帽 20×20×2 + 腿 4×4×18 = 1088 mm³
    // 支撑 = 全包裹 − 模型(栅格离散留几个百分点)
    expect(volume.wrapVolumeMM3 - 1088).toBeCloseTo(volume.volumeMM3, -2);
  });

  it("平底立方体:没有支撑,全包裹就是模型自己", () => {
    const { volume } = supportOf(CUBE, { gridSizeMM: 0.25 });

    expect(volume.volumeMM3).toBeLessThan(1);
    // 20×20×20 = 8000 mm³
    expect(volume.wrapVolumeMM3).toBeGreaterThan(7600);
    expect(volume.wrapVolumeMM3).toBeLessThan(8400);
  });

  it("宽底座 + 悬空身体:全包裹 = 底座那圈 + 身体那圈", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY, { gridSizeMM: 0.25 });

    // 全包裹:身体的列到 z=30(26×26×30),底座多出来的一圈到 z=4
    //   = 26×26×30 + (32×32 − 26×26)×4 = 20280 + 1152 = 21432 mm³
    expect(volume.wrapVolumeMM3).toBeGreaterThan(20600);
    expect(volume.wrapVolumeMM3).toBeLessThan(22200);
    // 模型 = 底座 32×32×4 + 身体 26×26×20 = 4096 + 13520 = 17616 mm³
    expect(volume.wrapVolumeMM3 - 17616).toBeCloseTo(volume.volumeMM3, -2);
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
    const optimal = findOptimalAngle(model, undefined, 50, 1.25);

    // ±180 等价:帽翻过来当底座
    expect(Math.abs(optimal.rotX)).toBe(180);
    expect(optimal.rotY).toBe(0);
    expect(optimal.totalSupportWeight).toBeLessThan(0.05);
    expect(optimal.selfSupportRatio).toBeLessThan(0.05);
  });
});
