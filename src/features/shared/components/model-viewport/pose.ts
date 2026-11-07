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
 * 一个姿态(度)—— 跟 `ViewportPose` 同一个形状
 *
 * 这里单独定义一份,是为了让 `pose.ts` 不依赖 three.js 也不依赖 React
 * (它是纯数学文件,能进 unit project 跑单测)。
 */
export type PoseAngles = { rotX: number; rotY: number; rotZ: number };

/**
 * 拖一像素转多少度
 *
 * 0.35°/px ≈ 拖 100px 转 35°。太快了会转晕,太慢了拖半天不动。
 */
export const DRAG_DEG_PER_PX = 0.35;

/**
 * 拖动之后的新姿态 —— 预览里**拖模型**改的是打印姿态,不是相机
 *
 * ## 为什么拖的是模型
 *
 * 摆着看(转相机)跟摆着印(转模型)是两件事 —— **后者决定支撑克重**。
 * 工作室要的是「在预览里拖着看,顺手把这个姿态的克重算出来」,所以左键
 * 拖改的是**模型姿态**;相机那边留给滚轮缩放 + 右键平移。
 *
 * ## 映射
 *
 * - 横向拖 → 绕 **Z** 转(绕打印轴转,像转盘子)
 * - 纵向拖 → 绕 **X** 转(往前 / 往后倾)
 *
 * Y 轴(左右倾)拖不出来 —— 角度条上的输入框填。
 *
 * ## 从「拖动开始那一下」累加,不是每个事件增量加
 *
 * 增量加的话,浏览器把几个 pointermove 合并掉(或者丢掉一个)就会漂 ——
 * 拖出来的角度跟手对不上。累加的话,中间丢几个事件不影响结果。
 */
export function poseAfterDrag(
  base: PoseAngles,
  dx: number,
  dy: number
): PoseAngles {
  return {
    // 往下拖 → 模型的近端往下沉 → 绕 X 正转
    rotX: base.rotX + dy * DRAG_DEG_PER_PX,
    rotY: base.rotY,
    // 往右拖 → 模型跟着手往右转 → 绕 Z 正转
    rotZ: base.rotZ + dx * DRAG_DEG_PER_PX,
  };
}

/**
 * 刚体旋转后的包围盒最低点
 *
 * 刚体旋转下,包围盒的 8 个角点转过去就框住了整个旋转结果 —— 不用把
 * 每个顶点都转一遍(大模型几十万个顶点,拖滑块时每帧转一遍太贵)。
 *
 * 用它把模型抬到平台上方一段托底高度:平台平面落在 z=0,模型最低点正好
 * 悬在 `lift` 上。
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
