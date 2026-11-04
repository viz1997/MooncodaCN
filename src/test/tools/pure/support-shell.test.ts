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
 * 空出来的那几段才是支撑。
 *
 * 平台不在模型最低点上,而是**低 1mm**(`SUPPORT_LIFT_MM`)—— 有支撑的时候
 * 模型不直接贴平台,支撑先在平台上长一层 1mm 托住模型。所以:
 *   - 平底模型(立方体)→ 只有 1mm 托底(投影面积 × 1)
 *   - 悬空结构(帽 + 细腿)→ 帽下面那圈空间 + 1mm 托底
 *   - 宽底座 + 悬空身体 → 底座不能把上面那圈支撑吃掉
 *   - 球 → 球底那圈透镜形空间 + 1mm 托底
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
 * 帽下那圈空间(20×20 − 4×4)×18 是支撑,再加 1mm 托底
 */
const TABLE = concat(
  boxTriangles([8, 8, 0], [12, 12, 18]),
  boxTriangles([0, 0, 18], [20, 20, 20])
);

/**
 * 宽底座 + 悬空身体:底座 32×32×4,身体 26×26 悬在底座上方 6mm(z 10~30)
 * 支撑 = 身体底下那圈空气 26×26×6 = 4056 mm³,再加 1mm 托底 32×32×1 = 1024
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
  it("平底立方体:只剩 1mm 托底,没有别的支撑", () => {
    const { volume } = supportOf(CUBE);

    // 支撑 = 1mm 托底 × 投影面积 = 1 × (20×20) = 400 mm³
    expect(volume.volumeMM3).toBeCloseTo(400, 0);
    expect(volume.supportAreaMM2).toBeCloseTo(400, 0);
    expect(volume.maxHeightMM).toBeCloseTo(1, 1);
  });

  it("桌子:帽下那圈空间 + 1mm 托底是支撑", () => {
    const { volume } = supportOf(TABLE);

    // 帽下空腔 (400−16)×18 = 6912,加托底 20×20×1 = 400 → 7312 mm³
    expect(volume.volumeMM3).toBeCloseTo(7312, 0);
    // 支撑占地 = 帽的投影(托底盖满整个脚印)
    expect(volume.supportAreaMM2).toBeCloseTo(400, 0);
    // 支撑最高点 = 帽底离平台的高度(帽底 18,平台 −1)
    expect(volume.maxHeightMM).toBeCloseTo(19, 1);
  });

  it("桌子翻过来(180°):帽变成底座 → 只剩 1mm 托底", () => {
    const { volume } = supportOf(TABLE, { rotX: 180 });

    expect(volume.volumeMM3).toBeCloseTo(400, 0);
    expect(volume.supportAreaMM2).toBeCloseTo(400, 0);
  });

  it("球:球底透镜形空间 + 1mm 托底是支撑", () => {
    const { volume } = supportOf(BALL);

    // 球底透镜 (1/3)πr³ ≈ 1047,加托底 πr²×1 ≈ 307 → ≈ 1352 mm³
    expect(volume.volumeMM3).toBeGreaterThan(1200);
    expect(volume.volumeMM3).toBeLessThan(1500);
  });

  it("宽底座 + 悬空身体:底座不能把悬空那圈支撑吃掉", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY);

    // 身体底下那圈空腔 26×26×6 = 4056,加托底 32×32×1 = 1024 → 5080 mm³
    expect(volume.volumeMM3).toBeCloseTo(5080, 0);
    // 支撑占地 = 底座投影 32×32
    expect(volume.supportAreaMM2).toBeCloseTo(1024, 0);
    // 支撑最高点 = 身体底面(z=10)离平台(−1)的高度
    expect(volume.maxHeightMM).toBeCloseTo(11, 1);
  });

  it("包裹间隙倍率:只影响可视化外壳,不影响支撑克重", () => {
    const a = supportOf(TABLE);
    const b = supportOf(TABLE, { gapScale: 2 });

    expect(b.shell.gap).toBeCloseTo(a.shell.gap * 2, 6);
    // 外壳间隙是检测工具画外壳时用的,不进克重 —— 支撑体积跟模型克重同一口径
    expect(b.volume.volumeMM3).toBeCloseTo(a.volume.volumeMM3, 6);
    expect(b.volume.supportAreaMM2).toBeCloseTo(a.volume.supportAreaMM2, 6);
    // 平台平面始终在模型最低点下方 1mm(托底)
    expect(b.shell.groundZ).toBeCloseTo(a.shell.groundZ, 6);
  });

  it("平台平面在模型最低点下方 1mm(托底)", () => {
    const { shell } = supportOf(TABLE);

    // 托底 1mm + 一点安全余量(0.05~0.1mm)
    expect(shell.groundZ).toBeLessThan(-1);
    expect(shell.groundZ).toBeGreaterThan(-1.2);
  });
});

describe("尺寸缩放(2026-11-03)", () => {
  it("均匀缩放 k 倍:空腔按 k³ 走,托底那层只按 k²", () => {
    const base = prepareSupportModel(TABLE);
    const scaled = scaleSupportModel(base, 2, 2, 2);
    const a = computeSupportAtPose(base, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });
    const b = computeSupportAtPose(scaled, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });

    // 支撑区域(模型下表面到平台)在缩放下是自映射的 → 空腔体积精确乘 det(S);
    // 托底是**固定的 1mm**(打印机在平台上长一层 1mm,不是模型的一部分),
    // 只有占地按 k² 涨,厚度还是 1mm。
    //   (400×k² + 6912×k³) / (400 + 6912)
    const ratio = b.supportVolumeMM3 / a.supportVolumeMM3;
    expect(ratio).toBeCloseTo((400 * 4 + 6912 * 8) / 7312, 2);
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

    // 克重 = 体积 × 密度,两边同样算 → 比值就是体积比
    const weightA = a.supportWeightG;
    const weightB = b.supportWeightG;
    // 跟上面同一口径:空腔按 k³,托底按 k²
    expect(weightB / weightA).toBeCloseTo(
      (400 * 1.5 ** 2 + 6912 * 1.5 ** 3) / 7312,
      2
    );
  });
});

describe("全包裹 − 模型 = 支撑(2026-11-03)", () => {
  it("桌子:全包裹体积 = 支撑体积 + 模型体积", () => {
    const { volume } = supportOf(TABLE, { gridSizeMM: 0.25 });

    // 全包裹 = 平台到模型顶的整块:20×20 投影 × 21mm 高(平台在底面下 1mm)
    expect(volume.wrapVolumeMM3).toBeCloseTo(8400, 0);
    // 模型本体 = 帽 20×20×2 + 腿 4×4×18 = 1088 mm³
    // 支撑 = 全包裹 − 模型(栅格离散留几个百分点)
    expect(volume.wrapVolumeMM3 - 1088).toBeCloseTo(volume.volumeMM3, -2);
  });

  it("平底立方体:全包裹 = 模型 + 1mm 托底", () => {
    const { volume } = supportOf(CUBE, { gridSizeMM: 0.25 });

    expect(volume.volumeMM3).toBeCloseTo(400, 0);
    // 20×20×20 + 20×20×1 = 8400 mm³
    expect(volume.wrapVolumeMM3).toBeCloseTo(8400, 0);
  });

  it("宽底座 + 悬空身体:全包裹 = 底座那圈 + 身体那圈", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY, { gridSizeMM: 0.25 });

    // 全包裹:身体的列从平台(−1)到 z=30 → 26×26×31,底座多出来的那圈
    //   从 −1 到 4 → (32×32 − 26×26)×5
    //   = 20956 + 1740 = 22696 mm³
    expect(volume.wrapVolumeMM3).toBeCloseTo(22696, 0);
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
    // 克重 = 体积 × 材料密度(支撑跟模型同一种材料,实心)
    expect(pose.supportWeightG).toBeCloseTo(
      volume.volumeMM3 * DEFAULT_SUPPORT_PARAMS.materialDensity * 0.001,
      6
    );
  });

  it("摆盘会挑支撑最少的姿态(桌子翻过来)", () => {
    const model = prepareSupportModel(TABLE);
    // 模型本体:帽 20×20×2 + 腿 4×4×18 = 1088 mm³ → 1.088 cm³ × 1.15 g/cm³
    const optimal = findOptimalAngle(model, undefined, 50, 1.25);

    // ±180 等价:帽翻过来当底座(翻 X 或翻 Y 都一样)
    expect(
      Math.abs(optimal.rotX) === 180 || Math.abs(optimal.rotY) === 180
    ).toBe(true);
    // 翻过来只剩 1mm 托底:20×20×1 = 400 mm³ × 1.2 g/cm³ ≈ 0.48 g
    // (原姿态是 7312 mm³ ≈ 8.8 g —— 摆盘就是为了省这块)
    expect(optimal.totalSupportWeight).toBeCloseTo(0.48, 2);
    expect(optimal.selfSupportRatio).toBeLessThan(1);
  });
});
