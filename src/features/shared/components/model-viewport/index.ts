// 共用的模型 3D 视口 —— 打印前工作台(/tools/workbench)的两个视角
// (检查 / 克重)用的是同一个组件。
export {
  default as ModelViewport,
  type MeshTextureInfo,
  type ModelViewportProps,
  type ViewportPose,
  type ViewportVisibility,
} from "./model-viewport";

// 姿态旋转的纯实现 —— 跟摆盘算法(`rotateSupportMesh`)同一套口径。
export {
  type BBoxLike,
  POSE_EULER_ORDER,
  type Point3,
  rotatedBBoxMinZ,
  rotatePointXYZ,
} from "./pose";
