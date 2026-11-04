import { describe, expect, it } from "vitest";
import {
  computeSupportAtPose,
  DEFAULT_SUPPORT_PARAMS,
  findOptimalAngle,
  resolveSupportDensity,
} from "@/features/pricing/lib/angle-optimizer";
import {
  buildSupportShell,
  computeSupportVolume,
  prepareSupportModel,
  rotateSupportMesh,
  scaleSupportModel,
} from "@/features/tools/lib/mesh/support-shell";
import {
  boxTriangles,
  hollowShell,
  uvSphere,
} from "@/test/tools/fixtures/mesh-fixtures";

/**
 * 包裹支撑算法(模型检查工具 + 克重工具共用)的测试
 *
 * 支撑体 = 平台与模型下表面之间的那块材料,按 XY 列(height field)算。
 * 一列穿过模型表面得到一串 z 交点,按奇偶配对:相邻两个交点之间是模型材料,
 * 空出来的那几段才是支撑。
 *
 * 平台不在模型最低点上,而是**低 5mm**(`SUPPORT_LIFT_MM`)—— 有支撑的时候
 * 模型不直接贴平台,支撑先在平台上长一层 5mm 托住模型。所以:
 *   - 平底模型(立方体)→ 只有 5mm 托底(投影面积 × 5)
 *   - 悬空结构(帽 + 细腿)→ 帽下面那圈空间 + 5mm 托底
 *   - 宽底座 + 悬空身体 → 底座不能把上面那圈支撑吃掉
 *   - 球 → 球底那圈透镜形空间 + 5mm 托底
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
 * 帽下那圈空间(20×20 − 4×4)×18 是支撑,再加 5mm 托底
 */
const TABLE = concat(
  boxTriangles([8, 8, 0], [12, 12, 18]),
  boxTriangles([0, 0, 18], [20, 20, 20])
);

/**
 * 宽底座 + 悬空身体:底座 32×32×4,身体 26×26 悬在底座上方 6mm(z 10~30)
 * 支撑 = 身体底下那圈空气 26×26×6 = 4056 mm³,再加 5mm 托底 32×32×5 = 5120
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
  it("平底立方体:只剩 5mm 托底,没有别的支撑", () => {
    const { volume } = supportOf(CUBE);

    // 支撑 = 5mm 托底 × 投影面积 = 5 × (20×20) = 2000 mm³
    expect(volume.volumeMM3).toBeCloseTo(2000, 0);
    expect(volume.supportAreaMM2).toBeCloseTo(400, 0);
    expect(volume.maxHeightMM).toBeCloseTo(5, 1);
  });

  it("桌子:帽下那圈空间 + 5mm 托底是支撑", () => {
    const { volume } = supportOf(TABLE);

    // 帽下空腔 (400−16)×18 = 6912,加托底 20×20×5 = 2000 → 8912 mm³
    expect(volume.volumeMM3).toBeCloseTo(8912, 0);
    // 支撑占地 = 帽的投影(托底盖满整个脚印)
    expect(volume.supportAreaMM2).toBeCloseTo(400, 0);
    // 支撑最高点 = 帽底离平台的高度(帽底 18,平台 −5)
    expect(volume.maxHeightMM).toBeCloseTo(23, 1);
  });

  it("桌子翻过来(180°):帽变成底座 → 只剩 5mm 托底", () => {
    const { volume } = supportOf(TABLE, { rotX: 180 });

    expect(volume.volumeMM3).toBeCloseTo(2000, 0);
    expect(volume.supportAreaMM2).toBeCloseTo(400, 0);
  });

  it("球:球底透镜形空间 + 5mm 托底是支撑", () => {
    const { volume } = supportOf(BALL);

    // 球底透镜 (1/3)πr³ ≈ 1047,加托底 πr²×5 ≈ 1571 → ≈ 2618 mm³
    expect(volume.volumeMM3).toBeGreaterThan(2400);
    expect(volume.volumeMM3).toBeLessThan(2850);
  });

  it("宽底座 + 悬空身体:底座不能把悬空那圈支撑吃掉", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY);

    // 身体底下那圈空腔 26×26×6 = 4056,加托底 32×32×5 = 5120 → 9176 mm³
    expect(volume.volumeMM3).toBeCloseTo(9176, 0);
    // 支撑占地 = 底座投影 32×32
    expect(volume.supportAreaMM2).toBeCloseTo(1024, 0);
    // 支撑最高点 = 身体底面(z=10)离平台(−5)的高度
    expect(volume.maxHeightMM).toBeCloseTo(15, 1);
  });

  it("包裹间隙倍率:只影响可视化外壳,不影响支撑克重", () => {
    const a = supportOf(TABLE);
    const b = supportOf(TABLE, { gapScale: 2 });

    expect(b.shell.gap).toBeCloseTo(a.shell.gap * 2, 6);
    // 外壳间隙是检测工具画外壳时用的,不进克重 —— 支撑体积跟模型克重同一口径
    expect(b.volume.volumeMM3).toBeCloseTo(a.volume.volumeMM3, 6);
    expect(b.volume.supportAreaMM2).toBeCloseTo(a.volume.supportAreaMM2, 6);
    // 平台平面始终在模型最低点下方 5mm(托底)
    expect(b.shell.groundZ).toBeCloseTo(a.shell.groundZ, 6);
  });

  it("平台平面在模型最低点下方 5mm(托底)", () => {
    const { shell } = supportOf(TABLE);

    // 托底 5mm + 一点安全余量(0.05~0.1mm)
    expect(shell.groundZ).toBeLessThan(-5);
    expect(shell.groundZ).toBeGreaterThan(-5.2);
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
    // 托底是**固定的 5mm**(打印机在平台上长一层 5mm,不是模型的一部分),
    // 只有占地按 k² 涨,厚度还是 5mm。
    //   (2000×k² + 6912×k³) / (2000 + 6912)
    const ratio = b.supportVolumeMM3 / a.supportVolumeMM3;
    expect(ratio).toBeCloseTo((2000 * 4 + 6912 * 8) / 8912, 2);
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
      (2000 * 1.5 ** 2 + 6912 * 1.5 ** 3) / 8912,
      2
    );
  });
});

describe("全包裹 − 模型 = 支撑(2026-11-03)", () => {
  it("桌子:全包裹体积 = 支撑体积 + 模型体积", () => {
    const { volume } = supportOf(TABLE, { gridSizeMM: 0.25 });

    // 全包裹 = 平台到模型顶的整块:20×20 投影 × 25mm 高(平台在底面下 5mm)
    expect(volume.wrapVolumeMM3).toBeCloseTo(10000, 0);
    // 模型本体 = 帽 20×20×2 + 腿 4×4×18 = 1088 mm³
    // 支撑 = 全包裹 − 模型(栅格离散留几个百分点)
    expect(volume.wrapVolumeMM3 - 1088).toBeCloseTo(volume.volumeMM3, -2);
  });

  it("平底立方体:全包裹 = 模型 + 5mm 托底", () => {
    const { volume } = supportOf(CUBE, { gridSizeMM: 0.25 });

    expect(volume.volumeMM3).toBeCloseTo(2000, 0);
    // 20×20×20 + 20×20×5 = 10000 mm³
    expect(volume.wrapVolumeMM3).toBeCloseTo(10000, 0);
  });

  it("宽底座 + 悬空身体:全包裹 = 底座那圈 + 身体那圈", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY, { gridSizeMM: 0.25 });

    // 全包裹:身体的列从平台(−5)到 z=30 → 26×26×35,底座多出来的那圈
    //   从 −5 到 4 → (32×32 − 26×26)×9
    //   = 23660 + 3132 = 26792 mm³
    expect(volume.wrapVolumeMM3).toBeCloseTo(26792, 0);
    // 模型 = 底座 32×32×4 + 身体 26×26×20 = 4096 + 13520 = 17616 mm³
    expect(volume.wrapVolumeMM3 - 17616).toBeCloseTo(volume.volumeMM3, -2);
  });
});

describe("双密度(2026-11-04):支撑是另一种材料", () => {
  it("支撑克重按支撑密度算,不是模型密度", () => {
    const model = prepareSupportModel(CUBE);
    const pose = computeSupportAtPose(model, 0, 0, 0, {
      modelDensity: 1.2,
      supportDensity: 1.3,
    });

    // 平底立方体:支撑 = 5mm 托底 = 2000 mm³
    expect(pose.supportVolumeMM3).toBeCloseTo(2000, 0);
    // × 支撑密度 1.3 g/cm³ = 2.6 g(拿模型密度 1.2 算就是 2.4 g,错了)
    expect(pose.supportWeightG).toBeCloseTo(2.6, 6);
  });

  it("没给支撑密度 → 退回模型密度(同材料支撑的老口径)", () => {
    const model = prepareSupportModel(CUBE);
    const pose = computeSupportAtPose(model, 0, 0, 0, { modelDensity: 1.2 });

    expect(pose.supportWeightG).toBeCloseTo(2.4, 6);
  });

  it("支撑密度非法(≤0)→ 退回模型密度,不能算出 NaN", () => {
    const model = prepareSupportModel(CUBE);
    const pose = computeSupportAtPose(model, 0, 0, 0, {
      modelDensity: 1.2,
      supportDensity: 0,
    });

    expect(pose.supportWeightG).toBeCloseTo(2.4, 6);
  });
});

describe("封闭内腔也算支撑(水溶性支撑会灌进去)", () => {
  it("空心立方体:内腔体积 + 5mm 托底都算支撑", () => {
    // 业务口径:**按几何全包裹计,不区分可达性** —— 内腔灌满了水溶性
    // 支撑,洗的时候一起溶掉,所以内腔的体积算支撑材料。
    const { volume } = supportOf(hollowShell().positions);

    // 内腔 19×19×19 = 6859,加托底 20×20×5 = 2000 → 8859 mm³
    expect(volume.volumeMM3).toBeCloseTo(8859, 0);
  });

  it("内腔算支撑时用的也是支撑密度", () => {
    const model = prepareSupportModel(hollowShell().positions);
    const pose = computeSupportAtPose(
      model,
      0,
      0,
      0,
      {
        modelDensity: 1.2,
        supportDensity: 1.3,
      },
      { gridSizeMM: 0.25 }
    );

    // 8859 mm³ × 1.3 g/cm³ ≈ 11.52 g
    expect(pose.supportWeightG).toBeCloseTo(11.52, 1);
  });

  it("生产栅格(1mm)也不能把内腔的支撑算爆", () => {
    // 内腔壁正好落在栅格线上时,格心采样点会「擦」在面上 —— 交点个数多算
    // 一个,奇偶配对整体错位,这一格会被当成空腔(支撑系统性地多算
    // 10~30%)。掠射列按两种解释取平均,栅格再粗也不能离谱。
    const model = prepareSupportModel(hollowShell().positions);
    const pose = computeSupportAtPose(model, 0, 0, 0, DEFAULT_SUPPORT_PARAMS);

    // 真值 8859 mm³,1mm 栅格下允许 2% 的离散误差
    expect(pose.supportVolumeMM3).toBeGreaterThan(8859 * 0.98);
    expect(pose.supportVolumeMM3).toBeLessThan(8859 * 1.02);
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
    // 克重 = 体积 × 支撑密度(支撑是另一种材料,实心)
    expect(pose.supportWeightG).toBeCloseTo(
      volume.volumeMM3 * resolveSupportDensity(DEFAULT_SUPPORT_PARAMS) * 0.001,
      6
    );
  });

  it("摆盘会挑支撑最少的姿态", () => {
    const model = prepareSupportModel(TABLE);
    // 模型本体:帽 20×20×2 + 腿 4×4×18 = 1088 mm³ → 1.088 cm³ × 1.15 g/cm³
    const optimal = findOptimalAngle(model, undefined, 50, 1.25);

    // 5mm 托底是按**占地**算的(占地 × 5),所以「占地小」比「躺平」更省:
    //   - 原姿态(腿朝下)→ 帽下空腔 6912 + 20×20 托底 2000 = 8912 mm³
    //   - 翻过来(帽当底座)→ 20×20 托底 2000 mm³
    //   - 侧躺(帽竖着)→ 占地只有 94 mm²,托底 470 + 腿上那圈 = 990 mm³
    // 摆盘挑的就是最省的那个(侧躺 45°)。
    expect(optimal.totalSupportWeight).toBeCloseTo(1.19, 2);
    // 一定比原姿态省
    expect(optimal.totalSupportWeight).toBeLessThan(10.69);
    expect(optimal.selfSupportRatio).toBeLessThan(1);
  });
});
