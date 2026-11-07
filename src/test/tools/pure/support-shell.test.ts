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
  SUPPORT_BASE_MARGIN_MM,
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
 *   - 平底模型(立方体)→ 只有 5mm 托底(底板占地 × 5)
 *   - 悬空结构(帽 + 细腿)→ 帽下面那圈空间 + 5mm 托底
 *   - 宽底座 + 悬空身体 → 底座不能把上面那圈支撑吃掉
 *   - 球 → 球底那圈透镜形空间 + 5mm 托底
 *
 * **底板留边**(`SUPPORT_BASE_MARGIN_MM` = 5mm):工作室的工艺是底板比模型
 * 轮廓**四周各留一圈边**再铺 5mm 托底 —— 底板不是照着轮廓卡着裁的。
 * 那圈边也是实心支撑,算进支撑克重(冰箱贴留边 5mm 时 43 + 59 = 102g,
 * 跟工作室报的一致)。
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
 * 支撑 = 身体底下那圈空气 26×26×6 = 4056 mm³,再加 5mm 托底
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
  baseMarginMM?: number;
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
    baseMarginMM: options.baseMarginMM,
  });
  return { shell, volume };
}

/**
 * 20×20 的方形轮廓外扩 5mm 后的底板占地 (mm²)
 *
 * 连续几何的精确值:外扩后的方形 30×30,四角被 5mm 圆角切掉
 *   900 − 4×(25 − π·25/4) = 878.4
 * 栅格离散(0.25mm 格 + 半格修正)算出来 877,差 0.2%。
 */
const CUBE_BASE_AREA = 877;

describe("computeSupportVolume —— 包裹支撑体积", () => {
  it("平底立方体:只剩 5mm 托底,没有别的支撑", () => {
    const { volume } = supportOf(CUBE);

    // 支撑 = 5mm 托底 × 底板占地(轮廓外扩 5mm 后的 877mm²)
    expect(volume.volumeMM3).toBeCloseTo(CUBE_BASE_AREA * 5, 0);
    // 支撑占地 = 底板(轮廓 + 留边)
    expect(volume.supportAreaMM2).toBeCloseTo(CUBE_BASE_AREA, 0);
    expect(volume.maxHeightMM).toBeCloseTo(5, 1);
  });

  it("桌子:帽下那圈空间 + 5mm 托底是支撑", () => {
    const { volume } = supportOf(TABLE);

    // 帽下空腔 (400−16)×18 = 6912,加托底 877×5 = 4385 → 11297 mm³
    expect(volume.volumeMM3).toBeCloseTo(11297, 0);
    // 支撑占地 = 底板(帽的轮廓外扩 5mm)
    expect(volume.supportAreaMM2).toBeCloseTo(CUBE_BASE_AREA, 0);
    // 支撑最高点 = 帽底离平台的高度(帽底 18,平台 −5)
    expect(volume.maxHeightMM).toBeCloseTo(23, 1);
  });

  it("桌子翻过来(180°):帽变成底座 → 只剩 5mm 托底", () => {
    const { volume } = supportOf(TABLE, { rotX: 180 });

    expect(volume.volumeMM3).toBeCloseTo(CUBE_BASE_AREA * 5, 0);
    expect(volume.supportAreaMM2).toBeCloseTo(CUBE_BASE_AREA, 0);
  });

  it("球:球底透镜形空间 + 5mm 托底是支撑", () => {
    const { volume } = supportOf(BALL);

    // 球底透镜 (1/3)πr³ ≈ 1047,加托底(外扩后的圆盘 701mm²)×5 ≈ 3505
    // → ≈ 4550 mm³
    expect(volume.volumeMM3).toBeGreaterThan(4400);
    expect(volume.volumeMM3).toBeLessThan(4700);
  });

  it("宽底座 + 悬空身体:底座不能把悬空那圈支撑吃掉", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY);

    // 身体底下那圈空腔 26×26×6 = 4056,加托底(外扩后的 1741mm²)×5 = 8705
    // → 12761 mm³
    expect(volume.volumeMM3).toBeCloseTo(12761, 0);
    // 支撑占地 = 底板(底座轮廓外扩 5mm)
    expect(volume.supportAreaMM2).toBeCloseTo(1741, 0);
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

describe("底板留边(2026-11-04):底板比模型轮廓四周各留一圈", () => {
  it("底板占地 = 轮廓外扩 5mm 后的面积", () => {
    const { volume } = supportOf(CUBE);

    // 20×20 的轮廓外扩 5mm → 30×30 切掉四角圆弧 = 878.4 mm²(连续几何)
    expect(volume.supportAreaMM2).toBeCloseTo(878.4, -1.5);
    // 模型的投影面积本身不变(留边的是底板,不是模型)
    expect(volume.footprintAreaMM2).toBeCloseTo(400, 0);
  });

  it("留边 0mm = 老口径:底板照着模型轮廓裁", () => {
    const { volume } = supportOf(CUBE, { baseMarginMM: 0 });

    expect(volume.supportAreaMM2).toBeCloseTo(400, 0);
    expect(volume.volumeMM3).toBeCloseTo(2000, 0);
  });

  it("留边越大底板越大(单调查)", () => {
    const a = supportOf(CUBE, { baseMarginMM: 0 });
    const b = supportOf(CUBE, { baseMarginMM: 5 });
    const c = supportOf(CUBE, { baseMarginMM: 10 });

    expect(b.volume.supportAreaMM2).toBeGreaterThan(a.volume.supportAreaMM2);
    expect(c.volume.supportAreaMM2).toBeGreaterThan(b.volume.supportAreaMM2);
    // 留边 10mm:20×20 → 40×40 切角 ≈ 1514 mm²
    expect(c.volume.supportAreaMM2).toBeCloseTo(1514, -1.5);
  });

  it("默认留边就是 SUPPORT_BASE_MARGIN_MM(5mm)", () => {
    const def = supportOf(CUBE);
    const five = supportOf(CUBE, { baseMarginMM: SUPPORT_BASE_MARGIN_MM });

    expect(def.volume.supportAreaMM2).toBeCloseTo(
      five.volume.supportAreaMM2,
      6
    );
    expect(def.volume.volumeMM3).toBeCloseTo(five.volume.volumeMM3, 6);
  });
});

describe("底板留边那一圈:画面跟克重是同一圈(2026-11-07)", () => {
  /**
   * 画底板用的外壳 —— **栅格跟算体积那边保持一致**
   *
   * 两边共用同一张栅格(`rasterizeFootprint`),所以这里必须传同一个
   * `gridSizeMM`:栅格不一样,画出来的边界跟算出来的边界就会差几格。
   */
  function shellWithRing(positions: Float32Array, gridSizeMM: number) {
    const model = prepareSupportModel(positions);
    const shell = buildSupportShell(model.mesh, model.faceEnclosed, {
      includeBaseRing: true,
      baseMarginMM: SUPPORT_BASE_MARGIN_MM,
      gridSizeMM,
      liftMm: 5,
    });
    const volume = computeSupportVolume(shell, model.mesh, {
      gridSizeMM,
      baseMarginMM: SUPPORT_BASE_MARGIN_MM,
      liftMm: 5,
    });
    return { shell, volume };
  }

  it("画出来的环 == 算进克重的那圈边", () => {
    const { shell, volume } = shellWithRing(CUBE, 0.25);

    // 环 = 外扩出来的那圈格子(每格两个三角形 = 18 个 float)
    const cells = shell.baseRing.length / 18;
    const ringArea = cells * 0.25 * 0.25;
    // 算进克重的那圈 = 底板占地 − 模型投影面积
    expect(ringArea).toBeCloseTo(
      volume.supportAreaMM2 - volume.footprintAreaMM2,
      3
    );
    // 20×20 的轮廓外扩 5mm → 底板 877,模型 400,留边那圈 477 mm²
    expect(ringArea).toBeCloseTo(477, -1.5);
  });

  it("环平铺在平台平面上", () => {
    const { shell } = shellWithRing(CUBE, 0.25);

    expect(shell.baseRing.length).toBeGreaterThan(0);
    for (let i = 2; i < shell.baseRing.length; i += 3) {
      expect(shell.baseRing[i]).toBeCloseTo(shell.groundZ, 6);
    }
  });

  it("默认不画环(摆盘搜索一次要建 625 个外壳,太贵)", () => {
    const model = prepareSupportModel(CUBE);
    const shell = buildSupportShell(model.mesh, model.faceEnclosed, undefined);

    expect(shell.baseRing.length).toBe(0);
  });

  it("留边 0 = 没有环(底板照着模型轮廓裁)", () => {
    const model = prepareSupportModel(CUBE);
    const shell = buildSupportShell(model.mesh, model.faceEnclosed, {
      includeBaseRing: true,
      baseMarginMM: 0,
    });

    expect(shell.baseRing.length).toBe(0);
  });
});

describe("尺寸缩放(2026-11-03)", () => {
  it("均匀缩放 k 倍:空腔按 k³ 走,底板按 k² 走(留边是固定的 5mm)", () => {
    const base = prepareSupportModel(TABLE);
    const scaled = scaleSupportModel(base, 2, 2, 2);
    const a = computeSupportAtPose(base, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });
    const b = computeSupportAtPose(scaled, 0, 0, 0, DEFAULT_SUPPORT_PARAMS, {
      gridSizeMM: 0.25,
    });

    // 支撑区域(模型下表面到平台)在缩放下是自映射的 → 空腔体积精确乘 det(S);
    // 底板是**固定的 5mm 厚**(打印机在平台上长一层 5mm,不是模型的一部分),
    // 它的占地是「轮廓外扩 5mm」—— 轮廓按 k² 涨,留边那 5mm 不涨,
    // 所以底板不是精确的 k²(实测 2.82 倍,k² = 4)。
    const ratio = b.supportVolumeMM3 / a.supportVolumeMM3;
    expect(ratio).toBeCloseTo(5.99, 1);
    // 底板占地:877 → 2477(比 2.82,不是 4 —— 留边那圈不跟着缩放)
    expect(b.supportAreaMM2 / a.supportAreaMM2).toBeCloseTo(2.82, 1);
    // 空腔部分严格按 k³:空腔 = 支撑体积 − 底板(占地 × 5)
    const cavityA = a.supportVolumeMM3 - a.supportAreaMM2 * 5;
    const cavityB = b.supportVolumeMM3 - b.supportAreaMM2 * 5;
    expect(cavityB / cavityA).toBeCloseTo(8, 1);
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
    expect(weightB / weightA).toBeCloseTo(
      b.supportVolumeMM3 / a.supportVolumeMM3,
      6
    );
  });
});

describe("全包裹 − 模型 = 支撑(2026-11-03)", () => {
  it("桌子:全包裹体积 = 支撑体积 + 模型体积", () => {
    const { volume } = supportOf(TABLE, { gridSizeMM: 0.25 });

    // 全包裹 = 平台到模型顶的整块(支撑 + 模型),外加底板留边那一圈
    //   20×20×25 = 10000,加底板留边 877−400 = 477mm² × 5 = 2385
    expect(volume.wrapVolumeMM3).toBeCloseTo(12385, 0);
    // 模型本体 = 帽 20×20×2 + 腿 4×4×18 = 1088 mm³
    // 支撑 = 全包裹 − 模型(栅格离散留几个百分点)
    expect(volume.wrapVolumeMM3 - 1088).toBeCloseTo(volume.volumeMM3, -2);
  });

  it("平底立方体:全包裹 = 模型 + 5mm 托底", () => {
    const { volume } = supportOf(CUBE, { gridSizeMM: 0.25 });

    expect(volume.volumeMM3).toBeCloseTo(CUBE_BASE_AREA * 5, 0);
    // 20×20×20 + 底板 877×5 = 8000 + 4385 = 12385 mm³
    expect(volume.wrapVolumeMM3).toBeCloseTo(12385, 0);
  });

  it("宽底座 + 悬空身体:全包裹 = 底座那圈 + 身体那圈", () => {
    const { volume } = supportOf(BASE_AND_HOVERING_BODY, { gridSizeMM: 0.25 });

    // 全包裹:身体的列从平台(−5)到 z=30 → 26×26×35,底座多出来的那圈
    //   从 −5 到 4 → (32×32 − 26×26)×9,再加底板留边 (1741−1024)×5
    //   = 23660 + 3132 + 3585 = 30377 mm³
    expect(volume.wrapVolumeMM3).toBeCloseTo(30377, 0);
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

    // 平底立方体:支撑 = 5mm 托底(底板 876mm²)= 4380 mm³
    // (走的是 computeSupportAtPose 的 1mm 栅格,0.25mm 栅格是 4385)
    expect(pose.supportVolumeMM3).toBeCloseTo(4380, 0);
    // × 支撑密度 1.3 g/cm³ = 5.69 g(拿模型密度 1.2 算就是 5.26 g,错了)
    expect(pose.supportWeightG).toBeCloseTo(5.69, 2);
  });

  it("没给支撑密度 → 退回模型密度(同材料支撑的老口径)", () => {
    const model = prepareSupportModel(CUBE);
    const pose = computeSupportAtPose(model, 0, 0, 0, { modelDensity: 1.2 });

    expect(pose.supportWeightG).toBeCloseTo(5.26, 1);
  });

  it("支撑密度非法(≤0)→ 退回模型密度,不能算出 NaN", () => {
    const model = prepareSupportModel(CUBE);
    const pose = computeSupportAtPose(model, 0, 0, 0, {
      modelDensity: 1.2,
      supportDensity: 0,
    });

    expect(pose.supportWeightG).toBeCloseTo(5.26, 1);
  });
});

describe("封闭内腔也算支撑(水溶性支撑会灌进去)", () => {
  it("空心立方体:内腔体积 + 5mm 托底都算支撑", () => {
    // 业务口径:**按几何全包裹计,不区分可达性** —— 内腔灌满了水溶性
    // 支撑,洗的时候一起溶掉,所以内腔的体积算支撑材料。
    const { volume } = supportOf(hollowShell().positions);

    // 内腔 19×19×19 = 6859,加托底 877×5 = 4385 → 11244 mm³
    expect(volume.volumeMM3).toBeCloseTo(11244, 0);
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

    // 11244 mm³ × 1.3 g/cm³ ≈ 14.6 g
    expect(pose.supportWeightG).toBeCloseTo(14.6, 1);
  });

  it("生产栅格(1mm)也不能把内腔的支撑算爆", () => {
    // 内腔壁正好落在栅格线上时,格心采样点会「擦」在面上 —— 交点个数多算
    // 一个,奇偶配对整体错位,这一格会被当成空腔(支撑系统性地多算
    // 10~30%)。掠射列按两种解释取平均,栅格再粗也不能离谱。
    const model = prepareSupportModel(hollowShell().positions);
    const pose = computeSupportAtPose(model, 0, 0, 0, DEFAULT_SUPPORT_PARAMS);

    // 真值 11244 mm³,1mm 栅格下允许 2% 的离散误差
    expect(pose.supportVolumeMM3).toBeGreaterThan(11244 * 0.98);
    expect(pose.supportVolumeMM3).toBeLessThan(11244 * 1.02);
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

    // 5mm 托底是按**底板占地**算的(轮廓外扩 5mm × 5),所以「占地小」比
    // 「躺平」更省:
    //   - 原姿态(腿朝下)→ 帽下空腔 6912 + 底板 4385 = 11297 mm³ → 14.46 g
    //   - 翻过来(帽当底座)→ 底板 4385 mm³
    //   - 侧躺(帽竖着)→ 占地只有 40mm²,底板 ≈ 340×5 ≈ 1700,加腿上那圈
    // 摆盘挑的就是最省的那个(侧躺 45°)。
    expect(optimal.totalSupportWeight).toBeCloseTo(4.24, 2);
    // 一定比原姿态省
    expect(optimal.totalSupportWeight).toBeLessThan(14.46);
    // 底板是固定的 5mm,小模型摊上就不便宜 —— 支撑比模型重(比例 > 1)
    expect(optimal.selfSupportRatio).toBeGreaterThan(1);
  });
});
