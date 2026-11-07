/**
 * 姿态旋转 —— **一份口径**(纯数学,不碰 three.js)
 *
 * ## 为什么单独一个文件
 *
 * 画面里的姿态必须跟**算克重的那块姿态**是同一个姿态:画面转到 30°,
 * 克重也得是 30° 那个数。否则用户看着模型「立起来了」,克重却还是躺着
 * 算的 —— 这种错在页面上完全看不出来,只会让工作室觉得「报价不准」。
 *
 * 摆盘那边转模型用的是 `rotateSupportMesh()`
 * (`features/tools/lib/mesh/support-shell.ts`),视口这边转的是 three.js 的
 * `rotation.order = "ZYX"`。三处必须指向同一个矩阵,否则对不上。
 *
 * 画面上的旋转由**旋转控制器**(`TransformControls`)拖出来 —— 它写的是
 * quaternion,得按同一个顺序分解回欧拉角(见 `model-viewport.tsx`)。
 *
 * ## 口径:先 X 后 Y 后 Z(外旋)
 *
 * ```
 * R = Rz · Ry · Rx
 * ```
 *
 * 也就是「先绕 X 转,再绕 Y,最后绕 Z」。three.js 的 `Euler` 顺序
 * `"ZYX"` 对应的正是这个矩阵(`"XYZ"` 对应的是 `Rx·Ry·Rz`,反的)。
 *
 * 本文件的纯实现跟 `rotateSupportMesh()` 的算法一致 —— 单元测试
 * (`src/test/tools/pure/shared-viewport.test.ts`)把两者对着算一遍。
 */

/** three.js 的欧拉顺序 —— `"ZYX"` = Rz·Ry·Rx = 先 X 后 Y 后 Z */
export const POSE_EULER_ORDER = "ZYX";

/** 一个点(毫米) */
export type Point3 = { x: number; y: number; z: number };

/** 一个包围盒 —— 只要 min / max,不需要 three.js 的类型 */
export type BBoxLike = { min: Point3; max: Point3 };

/**
 * 把一个点按「先 X 后 Y 后 Z」转过去
 *
 * 跟 `rotateSupportMesh()` 里那三步是同一套三角函数。
 */
export function rotatePointXYZ(
  p: Point3,
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number
): Point3 {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const rz = (rotZDeg * Math.PI) / 180;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);

  // X
  const y1 = p.y * cosX - p.z * sinX;
  const z1 = p.y * sinX + p.z * cosX;
  // Y
  const x2 = p.x * cosY + z1 * sinY;
  const z2 = -p.x * sinY + z1 * cosY;
  // Z
  const x3 = x2 * cosZ - y1 * sinZ;
  const y3 = x2 * sinZ + y1 * cosZ;

  return { x: x3, y: y3, z: z2 };
}

/**
 * 刚体旋转后的包围盒最低点
 *
 * 刚体旋转下,包围盒的 8 个角点转过去就框住了整个旋转结果 —— 不用把
 * 每个顶点都转一遍(大模型几十万个顶点,拖滑块时每帧转一遍太贵)。
 *
 * ## 它是「平台平面」的依据
 *
 * 视口拿它把模型抬到平台上方一段托底高度:平台平面落在 z=0,模型最低点
 * 悬在 `lift` 上。**支撑体积算平台平面用的是同一个口径**
 * (`mesh.bboxMin[2] - 托底`)—— 两边不一样的话,画面跟克重就对不上。
 *
 * ## 关键性质:包围盒最低点 ≤ 模型最低点
 *
 * 包围盒装着模型,所以拿它当平台平面**永远是安全的** —— 平台平面不会
 * 高过模型的最低点,模型**不会低过平台**(工作室 2026-11-07:
 * 「显示支撑必须自动置于平面,模型不能低过平面」)。
 */
export function rotatedBBoxMinZ(
  bbox: BBoxLike,
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number
): number {
  let minZ = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = rotatePointXYZ(
      {
        x: i & 1 ? bbox.max.x : bbox.min.x,
        y: i & 2 ? bbox.max.y : bbox.min.y,
        z: i & 4 ? bbox.max.z : bbox.min.z,
      },
      rotXDeg,
      rotYDeg,
      rotZDeg
    );
    if (p.z < minZ) minZ = p.z;
  }
  return minZ;
}

/** 姿态差超过这个值就算「不是同一个姿态」(度) */
const POSE_MATCH_EPSILON_DEG = 0.01;

/**
 * 这块支撑外壳是不是按**当前姿态**算出来的
 *
 * 支撑是「某个姿态下的一次结果」(工作室 2026-11-07 的口径:支撑不跟随角度
 * 实时变化)。姿态一变,手里那块外壳就是**旧姿态**的 —— 拿它摆平台平面,
 * 转过之后的模型会**低过平台**(工作室报的「模型不能低过平面」)。
 *
 * 外壳上带着算它时的角度(`SupportShellData.pose`):
 * - 摆盘 Worker 算的那块带**真实**角度;
 * - 分析器算的那块(检查视角)是**未旋转**的模型,记 (0,0,0)。
 *
 * 没有角度标记的外壳一律**不认** —— 不知道它是哪个姿态的,就不能拿它摆平台。
 */
export function shellMatchesPose(
  shell: {
    pose?: { rotX: number; rotY: number; rotZ: number } | undefined;
  },
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number
): boolean {
  const p = shell.pose;
  if (!p) return false;
  return (
    Math.abs(p.rotX - rotXDeg) <= POSE_MATCH_EPSILON_DEG &&
    Math.abs(p.rotY - rotYDeg) <= POSE_MATCH_EPSILON_DEG &&
    Math.abs(p.rotZ - rotZDeg) <= POSE_MATCH_EPSILON_DEG
  );
}
