/**
 * 磁吸孔切割的参数与切刀摆放数学
 *
 * ## 这套参数从哪来
 *
 * 工作室给的那段 Blender Python 脚本里:
 *
 * ```python
 * HOLE_DIA_MM   = 20.5
 * TOLERANCE     = 0.2      # ⇒ 实际孔径 20.7mm
 * SLOT_DEPTH_MM = 1.3
 * ```
 *
 * 磁铁是**固定尺寸的实体**,所以孔径按**实物毫米固定**(Ø20.7mm / 深 1.3mm),
 * **不跟模型缩放**。
 *
 * ## 跟 Blender 脚本不一样的那一处(重要)
 *
 * 脚本里有这么一段:
 *
 * ```python
 * ratio = max_dim_mm / EXPECTED_WIDTH_MM   # EXPECTED_WIDTH_MM = 60.0
 * radius = ((HOLE_DIA_MM + TOLERANCE) / 2000.0) * ratio
 * ```
 *
 * 孔径**跟着模型最大边一起缩放** —— 那是当年为了绕开「Meshy 导出来的 7000mm」
 * 临时加的假设(脚本里 `transform_apply` 那一步就是在处理它)。网页端**知道
 * 最终打印尺寸**,不需要这个假设:照搬会让一个 40mm 宽的模型只得到 Ø13.8mm 的孔。
 * 所以这里的半径是**绝对毫米**,跟模型大小无关。
 *
 * ## 零依赖
 *
 * 不引 `@/db`、不引 `server-only`、不引 manifold ⇒ 纯函数层能进 `unit` project
 * 跑单测(`src/test/magnet/pure/magnet-params.test.ts`)。
 */

/** 三维向量(元组)—— 跟 manifold 的 `Vec3` 一个形状,好直接传 */
export type MagnetVec3 = [number, number, number];

/**
 * 六个候选面
 *
 * **只用轴和符号命名,不用「前/后/左/右」** —— 朝向取决于模型自己的摆放,
 * 说「前面」会跟用户脑子里的方向对不上。轴 + 符号是**不会歧义**的,
 * 3D 预览里也能一眼对上。
 */
export type MagnetFaceId = "posX" | "negX" | "posY" | "negY" | "posZ" | "negZ";

/** 孔径(mm)—— 磁铁是固定尺寸的实体,这个数**不可调** */
export const MAGNET_HOLE_DIA_MM = 20.7;

/** 孔半径(mm) */
export const MAGNET_HOLE_RADIUS_MM = MAGNET_HOLE_DIA_MM / 2;

/** 沉孔深(mm)—— 从面向里挖多深 */
export const MAGNET_HOLE_DEPTH_MM = 1.3;

/** 切刀圆柱的圆周段数 —— 跟 Blender 脚本一样是 64 */
export const MAGNET_CUTTER_SEGMENTS = 64;

/**
 * 切刀在面**外面**多伸多少(mm)
 *
 * Blender 脚本里的 `penetration = 0.5mm`。**这一段不能省**:
 * 切刀跟面完全共面时布尔会出退化结果(切不进去,或者切出一圈毛边)。
 * 脚本作者加这一段就是为了躲开那个坑 —— 别以后有人「优化」掉它。
 */
export const MAGNET_CUTTER_PENETRATION_MM = 0.5;

/**
 * 孔底最少还要剩多少壁厚(mm)
 *
 * 切 1.3mm 深之后,底下至少得留 0.3mm 的料 —— 不然磁铁会把底捅穿。
 */
export const MAGNET_MIN_WALL_MM = 0.3;

/** 六个面的枚举顺序(表格里从上到下) */
export const MAGNET_FACE_IDS: readonly MagnetFaceId[] = [
  "posZ",
  "negZ",
  "posY",
  "negY",
  "posX",
  "negX",
];

/** 每个面**朝外**的方向(单位向量) */
export const MAGNET_FACE_DIRECTIONS: Record<MagnetFaceId, MagnetVec3> = {
  posX: [1, 0, 0],
  negX: [-1, 0, 0],
  posY: [0, 1, 0],
  negY: [0, -1, 0],
  posZ: [0, 0, 1],
  negZ: [0, 0, -1],
};

/** 每个面在界面上的短标签(轴 + 符号) */
export const MAGNET_FACE_LABELS: Record<MagnetFaceId, string> = {
  posX: "+X",
  negX: "−X",
  posY: "+Y",
  negY: "−Y",
  posZ: "+Z",
  negZ: "−Z",
};

// ---------------------------------------------------------------------------
// 向量小工具(纯函数)
// ---------------------------------------------------------------------------

export function addScaled(
  base: MagnetVec3,
  dir: MagnetVec3,
  scale: number
): MagnetVec3 {
  return [
    base[0] + dir[0] * scale,
    base[1] + dir[1] * scale,
    base[2] + dir[2] * scale,
  ];
}

export function subtractVec(a: MagnetVec3, b: MagnetVec3): MagnetVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function dotVec(a: MagnetVec3, b: MagnetVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec(a: MagnetVec3, b: MagnetVec3): MagnetVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vecLength(v: MagnetVec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalizeVec(v: MagnetVec3): MagnetVec3 {
  const len = vecLength(v);
  if (!Number.isFinite(len) || len <= 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function distanceVec(a: MagnetVec3, b: MagnetVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------------------------
// 切刀摆放
// ---------------------------------------------------------------------------

export type MagnetCutterPlacement = {
  /** 切刀中心(世界坐标,mm) */
  center: MagnetVec3;
  /** 切刀半径(mm) */
  radius: number;
  /** 切刀总高(mm) = 沉孔深 + 两头各外伸一段 */
  height: number;
  /** 圆周段数 */
  segments: number;
  /** 切刀**近端**相对面的偏移(mm)—— 负数 = 在面**外面** */
  nearOffsetMm: number;
  /** 切刀**远端**相对面的偏移(mm)—— 正数 = 在面**里面** */
  farOffsetMm: number;
  /** 切刀轴方向(= 朝面的方向,单位向量) */
  axis: MagnetVec3;
};

/**
 * 算切刀该摆在哪
 *
 * Blender 脚本里的这段:
 *
 * ```python
 * penetration  = 0.5mm
 * cut_depth    = actual_depth + penetration * 2
 * cutter_center = face_center - face_normal * (actual_depth / 2 - penetration)
 * ```
 *
 * 翻译成这里的口径(`faceNormal` 是**朝外**的单位法线,`inward = -faceNormal`):
 *
 * ```
 * 切刀近端 = facePoint + inward * (-2p)   ← 在面外面 1.0mm
 * 切刀远端 = facePoint + inward * ( d )   ← 在面里面 1.3mm
 * 切刀中心 = facePoint + inward * (d/2 - p)
 * ```
 *
 * 验证过的几何(见 `magnet-cut.test.ts`):40mm 立方体顶面切完去掉
 * **436.7934 mm³**,跟「64 边形截面积 × 1.3mm」**分毫不差**(误差 0.0000%)。
 *
 * @param facePoint    命中点(切刀在这上面开孔)
 * @param outwardNormal 命中面的**朝外**单位法线
 */
export function computeCutterPlacement(
  facePoint: MagnetVec3,
  outwardNormal: MagnetVec3
): MagnetCutterPlacement {
  const depth = MAGNET_HOLE_DEPTH_MM;
  const pen = MAGNET_CUTTER_PENETRATION_MM;
  const axis = normalizeVec(outwardNormal);
  const inward: MagnetVec3 = [-axis[0], -axis[1], -axis[2]];
  return {
    center: addScaled(facePoint, inward, depth / 2 - pen),
    radius: MAGNET_HOLE_RADIUS_MM,
    height: depth + 2 * pen,
    segments: MAGNET_CUTTER_SEGMENTS,
    nearOffsetMm: -2 * pen,
    farOffsetMm: depth,
    axis: inward,
  };
}

/**
 * 把圆柱的 +Z 轴对齐到 `dir` 的 4×4 矩阵(**列主序**)
 *
 * 用矩阵而不是欧拉角 —— 矩阵没有「旋转顺序」的歧义(仓库自己的
 * `POSE_EULER_ORDER = "ZYX"` 那个坑不必再踩一遍)。
 *
 * 列主序:`m[4*col + row]`。三列分别是 `u`、`v`、`d`。
 *
 * 验证:圆柱的**最薄那条边**必须落在 `dir` 指向的轴上
 * (见 `magnet-params.test.ts`)。
 */
export function alignZTo(dir: MagnetVec3): number[] {
  const d = normalizeVec(dir);
  // 挑一个跟 d 夹角最大的种子轴,保证叉积不接近零
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  const seed: MagnetVec3 =
    ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const u = normalizeVec(crossVec(seed, d));
  const v = crossVec(d, u);
  return [
    u[0],
    u[1],
    u[2],
    0,
    v[0],
    v[1],
    v[2],
    0,
    d[0],
    d[1],
    d[2],
    0,
    0,
    0,
    0,
    1,
  ];
}

// ---------------------------------------------------------------------------
// 体积口径
// ---------------------------------------------------------------------------

/**
 * 正 n 边形的面积(外接圆半径 = `radius`)
 *
 * 64 边形跟真圆的面积只差 0.16%(335.99 vs 336.54)—— 但**必须按多边形算**,
 * 因为切刀就是那个多边形,按圆的算会有 0.16% 的偏差(切 1.3mm 深就是
 * 0.7 mm³ 的差)。
 */
export function polygonAreaMm2(
  radius: number,
  segments: number = MAGNET_CUTTER_SEGMENTS
): number {
  return 0.5 * segments * radius * radius * Math.sin((2 * Math.PI) / segments);
}

/**
 * 切一个孔**应该**去掉多少体积(mm³)
 *
 * 切刀完全落在实体里、面也够厚时的理论值。切完之后拿实际去掉量跟它比 ——
 * **少了**说明孔切到边上去了(或者实体比想象的薄)。
 */
export function expectedRemovedVolumeMm3(
  depthMm: number = MAGNET_HOLE_DEPTH_MM
): number {
  return polygonAreaMm2(MAGNET_HOLE_RADIUS_MM) * depthMm;
}

/**
 * 实际去掉量比理论值少多少 —— 超过这个比例就判定「没切进去 / 切到边上」
 *
 * 取 2%:布尔运算在退化几何上有一点点数值误差,2% 足够宽松,
 * 又足够抓住「孔有一大截跑到实体外面」那种情况(实测切到边上会掉 1.4%~100%)。
 */
export const MAGNET_REMOVED_VOLUME_TOLERANCE = 0.02;

// ---------------------------------------------------------------------------
// 「这个面能不能切」的判定
// ---------------------------------------------------------------------------

export type MagnetFaceIssue =
  /** 射线没打中 —— 这个方向上没有面 */
  | "no_hit"
  /** 太薄 —— 切下去会捅穿 */
  | "too_thin"
  /** 孔会切到边上 —— 面的边缘离孔心不够远 */
  | "edge_spill";

export type MagnetFaceVerdict = "ok" | MagnetFaceIssue;

export type MagnetFaceMetrics = {
  /** 命中点的**局部厚度**(mm)—— 沿朝内方向量到下一个面 */
  thicknessMm: number | null;
  /** 命中点到**面边缘**的净空(mm)—— 孔要放得下就得 ≥ 孔半径 */
  clearanceMm: number | null;
};

/**
 * 判定一个面能不能切
 *
 * - **太薄** —— 厚度 < 沉孔深 + 最小壁厚 ⇒ 切下去会捅穿
 * - **切到边上** —— 净空 < 孔半径 ⇒ 孔会有一截跑到面外面(磁铁会掉出去)
 */
export function judgeFaceVerdict(
  metrics: MagnetFaceMetrics
): MagnetFaceVerdict {
  if (metrics.thicknessMm == null) return "no_hit";
  if (metrics.thicknessMm < MAGNET_HOLE_DEPTH_MM + MAGNET_MIN_WALL_MM) {
    return "too_thin";
  }
  if (
    metrics.clearanceMm != null &&
    metrics.clearanceMm < MAGNET_HOLE_RADIUS_MM
  ) {
    return "edge_spill";
  }
  return "ok";
}

/**
 * 挑「默认切哪个面」
 *
 * Blender 脚本是自动挑最平的那个面。网页端**也自动挑,但让用户能改** ——
 * 脚本的自动挑面偶尔会挑到一个很小的边面,用户能自己换是必须的。
 *
 * 挑法:平整度最高(角度最小)且**能切**的面;一个都不能切就返回 null。
 */
export function pickDefaultFace<
  T extends { verdict: MagnetFaceVerdict; flatnessDeg: number },
>(faces: readonly T[]): T | null {
  const cuttable = faces.filter((f) => f.verdict === "ok");
  if (cuttable.length === 0) return null;
  return cuttable.reduce((best, f) =>
    f.flatnessDeg < best.flatnessDeg ? f : best
  );
}
