"use client";

/**
 * 共用的模型 3D 视口 —— 打印前工作台(`/tools/workbench`)的**两个视角**
 * (检查 / 克重)用的是同一个组件。
 *
 * ## 为什么抽出来
 *
 * 以前有两个预览:模型检查那一套深色视口(`tools/components/model-check/
 * viewport.tsx`)和克重那一套浅色视口(`pricing/components/obj-viewer.tsx`)。
 * 两套代码、两套相机、两套材质 —— 同一模型在两个视角里长得不一样,支撑的
 * 画法也不一样(一个是「画出来的近似」,一个是「算出来的那块」)。
 *
 * 现在只有这一个 —— **克重也用检查的 3D 预览**。
 *
 * ## 一份口径
 *
 * - **支撑几何由外面传进来** —— `supportShell` 是摆盘 Worker 算完姿态时
 *   **同一块**几何(外壳 / 顶面 / 外壁 / 底板留边)。渲染用的外壳跟算体积
 *   用的外壳在同一次调用里建出来 —— 画出来的那圈支撑就是算克重的那块支撑,
 *   不是「照着算出来的样子再画一遍」。
 * - **外壳带着算它时的姿态** —— `SupportShellData.pose`。视口只认**当前
 *   姿态**的那块(`shellMatchesPose`),对不上的不画、也不拿它摆平台 ——
 *   支撑是「某个姿态下的一次结果」,拿旧姿态的外壳摆平台,转过之后的模型
 *   会**沉到平台下面**(工作室 2026-11-07 报的「模型不能低过平面」)。
 * - **姿态是变换,不是重算** —— 模型与问题边线装在一个姿态组里,改角度只改
 *   组的旋转(`order = "ZYX"`,口径跟摆盘算法 / OBJ 导出完全一致),几何不重建
 *   —— 拖滑块时不会卡。
 * - **托底高度跟随后台** —— `supportLiftMm`(`/admin/print-pricing` 配的那个)。
 *
 * ## 坐标系
 *
 * - 场景是 **Z-up**(打印方向),网格地面在 `z = 0`,即打印平台。
 * - 模型组整体平移,使平台落在 `z = 0`、模型坐在平台上方一段托底高度
 *   (**自动置于平面**)。平台平面取**包围盒最低点**(支撑体积算平台平面
 *   也是这个口径)—— 包围盒装着模型 ⇒ 平台平面 ≤ 模型最低点 ⇒
 *   **模型永远在平台上面,不会低过平面**。
 * - 姿态组在模型组里面,只管旋转 —— **支撑几何不进姿态组**:外面传进来的
 *   支撑已经是**转好姿态**的坐标,再转一次就转过了。
 *
 * ## 旋转用**控制器**(gizmo),不是拖着模型瞎转
 *
 * 工作室的原话:**「模型旋转不是这样操作,按照业界主流设计,带控制器」**。
 *
 * 业界主流(BIM / 三维建模 / 在线建模工具)转模型用的都是**三轴旋转控制器**
 * —— 模型上套三个彩色圆环,拖着环转。three.js 里有现成的 `TransformControls`
 * (Blender / Sketchfab 那一套),不用自己搓一个。
 *
 * | 操作 | 效果 |
 * |---|---|
 * | **拖彩色圆环** | 转**模型**(改打印姿态)—— 支撑**不**跟着重算,摆定角度后点「包裹支撑」才算 |
 * | 左键拖(空白处) | 转**相机** |
 * | 滚轮 | 缩放(相机) |
 * | 右键拖 | 平移(相机) |
 *
 * 拖控制器的时候左键被控制器吃掉了,相机得让开(松手再交回去)—— 否则
 * 拖环的同时相机也在转,画面跟着抖。
 *
 * **转的是模型,不是相机** —— 摆着看(转相机)跟摆着印(转模型)是两件事,
 * 后者决定支撑克重。控制器挂在**姿态组**上,改的就是那个组的旋转。
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  parseMtl,
  type TextureUrlMap,
} from "@/features/pricing/lib/obj-materials";
import {
  POSE_EULER_ORDER,
  rotatedBBoxMinZ,
  shellMatchesPose,
} from "@/features/shared/components/model-viewport/pose";
import {
  addMaterialGroups,
  buildPreviewMaterials,
} from "@/features/shared/components/obj-preview/materials";
import {
  ObjPreview,
  type PreviewContext,
} from "@/features/shared/components/obj-preview/obj-preview";
import { SUPPORT_LIFT_MM } from "@/features/tools/lib/mesh/support-shell";
import {
  type AnalysisResult,
  FACE_FLAG,
  ISSUE_COLORS,
  SHELL_COLORS,
  type SupportShellData,
} from "@/features/tools/lib/mesh/types";

export interface ViewportVisibility {
  flipped: boolean;
  degenerate: boolean;
  duplicate: boolean;
  shellExtra: boolean;
  shellNoise: boolean;
  openEdge: boolean;
  planarHole: boolean;
  nonManifoldEdge: boolean;
  outline: boolean;
}

/**
 * 没有任何问题图层时的开关状态 —— 克重视角没有分析结果,
 * 传这个就行(问题着色那一层压根不画)。
 */
const NO_ISSUES: ViewportVisibility = {
  flipped: false,
  degenerate: false,
  duplicate: false,
  shellExtra: false,
  shellNoise: false,
  openEdge: false,
  planarHole: false,
  nonManifoldEdge: false,
  outline: false,
};

/**
 * 模型的贴图与材质分组信息。
 *
 * 全部来自 OBJ 的 `usemtl` / `vt` 与 MTL 的 `map_Kd` ——
 * 没有它们就只能是灰模(白模)。
 */
export interface MeshTextureInfo {
  /** 顶点 UV,6 floats per triangle(模型没有 `vt` 时为 null) */
  uvs: Float32Array | null;
  /** `usemtl` 声明的材质名(按首次出现顺序) */
  materialNames: string[];
  /** 每三角形一个材质下标(指向 materialNames) */
  materialIndex: Uint16Array | null;
  /** MTL 文本 */
  mtlText: string | null;
  /** 材质名 → 该材质自己的贴图 blob URL */
  textureUrls: TextureUrlMap | null;
}

/** 当前姿态(度)—— 模型与问题边线一起转 */
export type ViewportPose = {
  rotX: number;
  rotY: number;
  rotZ: number;
};

export type ModelViewportProps = {
  /**
   * 分析结果 —— **可选**
   *
   * 有它才画问题着色 / 问题边线 / 悬停提示(检查视角);
   * 克重视角传 `null` —— 分析器不在后台偷偷跑。
   */
  result: AnalysisResult | null;
  /** 三角汤坐标(主线程持有),9 floats per triangle —— **已按当前尺寸缩放** */
  meshPositions: Float32Array | null;
  /** 贴图与材质分组(没有贴图的模型传 null) */
  textures: MeshTextureInfo | null;
  /** 是否显示贴图(用户可在图例栏切换) */
  showTexture: boolean;
  /** 问题图层的开关 —— 没有分析结果时忽略 */
  visibility?: ViewportVisibility | undefined;
  /** 是否显示包裹支撑外壳(WJP 水溶性支撑示意) */
  showSupport: boolean;
  /**
   * 外部传入的支撑外壳 —— **优先于** `result.supportShell`
   *
   * 摆盘 Worker 算完当前姿态时回传的那块几何(外壳 / 顶面 / 外壁 /
   * 底板留边)。**必须已经是转好姿态的坐标** —— 组件不会再转它一次。
   */
  supportShell?: SupportShellData | null | undefined;
  /** 当前姿态 —— 不传 = 不转 */
  pose?: ViewportPose | undefined;
  /**
   * 在预览里**转模型**改姿态 —— 回调新的姿态(度)
   *
   * 转的是**模型**(改打印姿态),不是转相机:摆着印(转模型)决定支撑克重,
   * 摆着看(转相机)决定看得清看不清,是两件事。
   *
   * 触发方式是**拖旋转控制器**(三轴圆环)—— 业界主流那套。相机那边留给
   * **左键空白处拖动** + **滚轮缩放** + **右键拖平移**。
   *
   * 不传这个回调 = 不挂控制器(这个视口也可能被别处拿去只看不动)。
   */
  onPoseChange?: ((pose: ViewportPose) => void) | undefined;
  /**
   * 托底高度 (mm) —— 模型悬在平台上方多远
   *
   * 不传 = `SUPPORT_LIFT_MM`(5mm)。**跟随后台**
   * (`/admin/print-pricing`)—— 画面跟克重工具算的必须是同一个几何。
   */
  supportLiftMm?: number | undefined;
  /** 聚焦请求:带递增序号,触发相机飞往该点 */
  focusRequest: {
    seq: number;
    point: [number, number, number] | null;
    radius?: number;
    dir?: [number, number, number];
  } | null;
  /** 重置视角信号 */
  fitSignal: number;
  /**
   * 模型几何建好之后回调一次
   *
   * 页面拿它把「解析中」切成「就绪」—— 视口不再自己解析 OBJ(几何是外面
   * 给的),但几何是**建好之后**才有画面,所以就绪信号还得由视口发。
   */
  onReady?: (() => void) | undefined;
};

const BASE_COLOR = new THREE.Color("#9aa3ad");
const BASE_DIM = new THREE.Color("#565d66");
/** 有贴图时干净面的顶点色 —— 白色才不压暗贴图 */
const TEXTURED_COLOR = new THREE.Color(0xffffff);

/** 面片级问题是否真实存在(按分析统计判断,避免无问题时也压暗模型) */
function faceIssuePresent(s: AnalysisResult["stats"]): {
  flipped: boolean;
  degenerate: boolean;
  duplicate: boolean;
  shellNoise: boolean;
  shellExtra: boolean;
} {
  return {
    flipped: s.flippedFaceCount > 0 || s.globalInvertedShellCount > 0,
    degenerate: s.degenerateCount > 0,
    duplicate: s.duplicateFaceCount > 0,
    shellNoise: s.noiseShellCount > 0,
    shellExtra: s.extraShellCount > 0,
  };
}

/** 当前开关状态下是否实际有可见的问题面(有问题才需要压暗其余面) */
function hasVisibleFaceIssues(
  s: AnalysisResult["stats"],
  vis: ViewportVisibility
): boolean {
  const p = faceIssuePresent(s);
  return (
    (p.flipped && vis.flipped) ||
    (p.degenerate && vis.degenerate) ||
    (p.duplicate && vis.duplicate) ||
    (p.shellNoise && vis.shellNoise) ||
    (p.shellExtra && vis.shellExtra)
  );
}

/** 着色优先级:翻转 > 退化 > 重复 > 噪声壳 > 非主壳 */
function faceColor(
  flags: number,
  comp: number,
  vis: ViewportVisibility,
  out: THREE.Color
): void {
  if (flags & FACE_FLAG.FLIPPED) {
    if (vis.flipped) {
      out.set(ISSUE_COLORS.flipped);
      return;
    }
  }
  if (flags & FACE_FLAG.DEGENERATE) {
    if (vis.degenerate) {
      out.set(ISSUE_COLORS.degenerate);
      return;
    }
  }
  if (flags & FACE_FLAG.DUPLICATE) {
    if (vis.duplicate) {
      out.set(ISSUE_COLORS.duplicate);
      return;
    }
  }
  if (flags & FACE_FLAG.SHELL_NOISE) {
    if (vis.shellNoise) {
      out.set(ISSUE_COLORS.shellNoise);
      return;
    }
  }
  if (flags & FACE_FLAG.SHELL_EXTRA) {
    if (vis.shellExtra) {
      out.set(
        SHELL_COLORS[Math.abs(comp) % SHELL_COLORS.length] ??
          ISSUE_COLORS.shellExtra
      );
      return;
    }
  }
  out.copy(BASE_COLOR);
}

/** 释放一个 three.js 网格(几何 + 材质) */
function disposeMesh(mesh: THREE.Mesh | null | undefined): void {
  if (!mesh) return;
  mesh.geometry.dispose();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) m.dispose();
}

/**
 * 姿态旋转的**纯实现**在 `./pose.ts` —— 跟摆盘算法(`rotateSupportMesh`)
 * 对着算过,单元测试守住。three.js 那边的旋转用 `POSE_EULER_ORDER`
 * ("ZYX"),两者是同一个矩阵。
 */
export default function ModelViewport({
  result,
  meshPositions,
  textures,
  showTexture,
  visibility = NO_ISSUES,
  showSupport,
  supportShell,
  pose,
  supportLiftMm,
  focusRequest,
  fitSignal,
  onReady,
  onPoseChange,
}: ModelViewportProps) {
  const t = useTranslations("ModelInspector");
  const tooltipRef = useRef<HTMLDivElement>(null);
  /** 预览场景上下文 —— <ObjPreview> 建好场景后交给我们 */
  const [previewCtx, setPreviewCtx] = useState<PreviewContext | null>(null);
  const ctxRef = useRef<PreviewContext | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  /** 模型组:承载模型 + 支撑,整体平移使平台落在世界 z=0 */
  const groupRef = useRef<THREE.Group | null>(null);
  /** 姿态组:模型与问题边线在它里面 —— 改角度只改它的旋转 */
  const poseGroupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const lineRefs = useRef<Record<string, THREE.LineSegments | null>>({});
  /** 支撑那几块几何 */
  const supportRefs = useRef<{
    shell: THREE.Mesh | null;
    under: THREE.Mesh | null;
    proj: THREE.Mesh | null;
    ring: THREE.Mesh | null;
    curtain: THREE.Mesh | null;
  }>({ shell: null, under: null, proj: null, ring: null, curtain: null });
  /** 模型的包围盒 —— 平台高度与取景范围都要它 */
  const bboxRef = useRef<THREE.Box3 | null>(null);
  /** 聚焦动画的当前状态(每帧插值) */
  const focusAnimRef = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    start: number;
  } | null>(null);

  const visibilityRef = useRef(visibility);
  const showSupportRef = useRef(showSupport);
  /**
   * 托底高度 —— 用 ref 读,免得改一个数就把整条建模流程重跑一遍。
   *
   * 同一个数要喂给三处:模型抬离平台的高度、相机取景范围、聚焦目标点。
   */
  const supportLiftMmRef = useRef(supportLiftMm);
  supportLiftMmRef.current = supportLiftMm;
  const showTextureRef = useRef(showTexture);
  const resultRef = useRef(result);
  /** 每个材质槽位有没有贴图(重着色时决定干净面用白色还是灰色) */
  const slotHasMapRef = useRef<boolean[]>([]);
  /** 就绪回调 —— 放进 ref,免得回调换身份就把整条建模流程重跑一遍 */
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  /** 悬停提示文案(事件回调只读 ref,避免每次 pointermove 都跑一遍翻译) */
  const tooltipTextsRef = useRef<Record<string, string>>({});
  /** 旋转控制器 —— 拖环改姿态 */
  const gizmoRef = useRef<TransformControls | null>(null);
  /** 拖动回调 —— 放进 ref,免得回调换身份就把监听器重挂一遍 */
  const onPoseChangeRef = useRef(onPoseChange);
  onPoseChangeRef.current = onPoseChange;
  /** 正在拖 —— 悬停提示要躲开(不然一边转模型一边弹问题标签) */
  const draggingRef = useRef(false);

  const rotX = pose?.rotX ?? 0;
  const rotY = pose?.rotY ?? 0;
  const rotZ = pose?.rotZ ?? 0;

  /**
   * **当前姿态下能用的那块支撑外壳**
   *
   * 支撑是「某个姿态下的一次结果」(工作室 2026-11-07 的口径:支撑不跟随
   * 角度实时变化)。姿态一变,手里那块外壳就是**旧姿态**的 —— 拿旧姿态的
   * 外壳摆平台平面,转过之后的模型会**低过平台**(工作室报的
   * 「显示支撑必须自动置于平面,模型不能低过平面」)。
   *
   * 外壳上带着算它时的角度(`SupportShellData.pose`),这里核对一下:
   * **对不上就不认** —— 不画,也不拿它摆平台。
   *
   * - 摆盘 Worker 算的那块带真实角度 ✓
   * - 分析器算的那块(检查视角)是**未旋转**的模型,只在没转过的时候能用
   */
  const shellForPose = useMemo(() => {
    const shell = supportShell ?? result?.supportShell ?? null;
    if (!shell) return null;
    return shellMatchesPose(shell, rotX, rotY, rotZ) ? shell : null;
  }, [supportShell, result, rotX, rotY, rotZ]);

  useEffect(() => {
    tooltipTextsRef.current = {
      flipped: t("tooltip.flipped"),
      degenerate: t("tooltip.degenerate"),
      duplicate: t("tooltip.duplicate"),
      shellNoise: t("tooltip.shellNoise"),
      shellExtra: t("tooltip.shellExtra"),
    };
  }, [t]);

  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);
  useEffect(() => {
    showSupportRef.current = showSupport;
    for (const m of Object.values(supportRefs.current)) {
      if (m) m.visible = showSupport;
    }
  }, [showSupport]);
  useEffect(() => {
    showTextureRef.current = showTexture;
  }, [showTexture]);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  // ---------- 场景就绪 ----------
  const handleSceneReady = useCallback((ctx: PreviewContext) => {
    // 同步写 ref —— 相机取景等逻辑可能在 React 重新渲染前就被调用
    ctxRef.current = ctx;
    setPreviewCtx(ctx);
  }, []);

  // ---------- 每帧:聚焦动画 ----------
  const handleFrame = useCallback((ctx: PreviewContext) => {
    const fa = focusAnimRef.current;
    if (!fa) return;
    const t = Math.min(1, (performance.now() - fa.start) / 550);
    const e = 1 - (1 - t) ** 3;
    ctx.camera.position.lerpVectors(fa.from, fa.to, e);
    ctx.controls.target.lerpVectors(fa.fromT, fa.toT, e);
    if (t >= 1) focusAnimRef.current = null;
  }, []);

  const fitCamera = useCallback(() => {
    const ctx = ctxRef.current;
    const bbox = bboxRef.current;
    if (!ctx) return;
    const { camera, controls } = ctx;
    let min = new THREE.Vector3(-10, -10, 0);
    let max = new THREE.Vector3(10, 10, 10);
    if (bbox) {
      // 模型组已整体平移落地(最低点悬在 z=0 平台上方一段托底高度上),
      // 取景范围按落地后坐标计算
      const dz = bbox.min.z - (supportLiftMmRef.current ?? SUPPORT_LIFT_MM);
      min = new THREE.Vector3(bbox.min.x, bbox.min.y, 0);
      max = new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z - dz);
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const diag = min.distanceTo(max) || 20;
    camera.near = Math.max(0.01, diag / 1000);
    camera.far = diag * 100;
    camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(1, -1.15, 0.85).normalize();
    // 取景距离要**同时照顾竖直和水平**两个方向。
    //
    // 只按竖直方向算的话,视口一变成窄高比例(比如进全屏、或者竖屏),
    // 水平方向就装不下了 —— 模型会被裁掉一半。相机得退到「包围球在两个
    // 方向上都装得下」的距离。
    //
    // **宽高比从画布上量**,别读 `camera.aspect` —— 那是渲染循环里更新的,
    // 刚切完全屏那一帧它还是旧比例,按旧比例取景就会把模型裁掉一半。
    const canvas = ctx.renderer.domElement;
    const aspect =
      canvas.clientHeight > 0
        ? canvas.clientWidth / canvas.clientHeight
        : camera.aspect;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.05));
    const halfMin = Math.min(vFov, hFov) / 2;
    const dist = Math.max(diag / 2 / Math.sin(halfMin), diag) * 1.3;
    camera.position.copy(center).add(dir.multiplyScalar(dist));
    controls.target.copy(center);
    controls.update();
  }, []);

  // ---------- 场景骨架:模型组 + 姿态组 ----------
  useEffect(() => {
    const ctx = previewCtx;
    if (!ctx) return;
    const group = new THREE.Group();
    const poseGroup = new THREE.Group();
    group.add(poseGroup);
    ctx.scene.add(group);
    groupRef.current = group;
    poseGroupRef.current = poseGroup;
    return () => {
      ctx.scene.remove(group);
      groupRef.current = null;
      poseGroupRef.current = null;
    };
  }, [previewCtx]);

  // ---------- 模型几何 + 问题边线 + 网格地面 ----------
  useEffect(() => {
    const ctx = previewCtx;
    const poseGroup = poseGroupRef.current;
    if (!ctx || !poseGroup) return;

    // 清掉旧模型与旧问题线
    //
    // **先摘,再 dispose** —— 只 dispose 是不够的:
    // three.js 的 `BufferGeometry.dispose()` 只释放 GPU 缓冲,几何体的
    // `attributes` 还在 CPU 侧,下一次绘制时 `WebGLGeometries` 会把属性
    // **重新上传**。所以一个「dispose 过但仍然挂在 poseGroup 上」的旧 mesh
    // 会**继续被画出来** —— 用户改一次尺寸,画面上就多一个旧尺寸的模型
    // (工作室报的「调整尺寸后预览出现两个尺寸模型」)。
    const oldMesh = meshRef.current;
    if (oldMesh) {
      poseGroup.remove(oldMesh);
      disposeMesh(oldMesh);
    }
    meshRef.current = null;
    for (const key of Object.keys(lineRefs.current)) {
      const lines = lineRefs.current[key];
      if (lines) {
        poseGroup.remove(lines);
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
      }
      lineRefs.current[key] = null;
    }
    if (gridRef.current) {
      ctx.scene.remove(gridRef.current);
      gridRef.current.traverse((o) => {
        if (o instanceof THREE.GridHelper || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      gridRef.current = null;
    }
    bboxRef.current = null;

    if (!meshPositions) {
      onReadyRef.current?.();
      return;
    }
    const flags = result?.flags;
    const faceComponent = result?.faceComponent;
    const openEdges = result?.openEdges;
    const nonManifoldEdges = result?.nonManifoldEdges;
    const planarHoleEdges = result?.planarHoleEdges;

    // 面几何(非索引,便于按面着色)
    const triCount = result?.stats.triangleCount ?? meshPositions.length / 9;
    const positions = new Float32Array(triCount * 9);
    const colors = new Float32Array(triCount * 9);
    const color = new THREE.Color();
    positions.set(
      meshPositions.subarray(0, Math.min(meshPositions.length, triCount * 9))
    );
    const vis = visibilityRef.current;
    // 有真实问题面时才压暗其余面(有问题才需要显示)
    const dimBase = result ? hasVisibleFaceIssues(result.stats, vis) : false;

    // ---------- 材质与贴图 ----------
    // 材质槽位:优先按 OBJ 的 `usemtl` 分组;OBJ 没写 usemtl 时用 MTL 的第一个材质
    const mtlList = textures?.mtlText ? parseMtl(textures.mtlText) : [];
    const uvs = textures?.uvs ?? null;
    // 几何体没有 uv 时**不能**挂贴图 —— three.js 会去采样 (0,0),整块糊成一片
    const hasUv = !!uvs && uvs.length >= triCount * 6;
    const materialIndex = textures?.materialIndex ?? null;
    const slotNames =
      textures?.materialNames && textures.materialNames.length > 0
        ? textures.materialNames
        : mtlList.length > 0
          ? [mtlList[0]!.name]
          : [];

    // 材质构建只有一份实现 —— 与克重工具共用
    // (见 src/features/shared/components/obj-preview/materials.ts)
    const { slots, slotHasMap, slotHasKd, single } = buildPreviewMaterials({
      mtlText: textures?.mtlText,
      textureUrls: textures?.textureUrls,
      materialNames: slotNames,
      hasUv,
      vertexColors: true,
      showTexture: showTextureRef.current,
    });
    slotHasMapRef.current = slotHasMap;

    for (let f = 0; f < triCount; f++) {
      const slot = materialIndex ? (materialIndex[f] ?? 0) : 0;
      const textured = showTextureRef.current && slotHasMap[slot] === true;
      if (result && flags && faceComponent) {
        faceColor(flags[f] ?? 0, faceComponent[f] ?? 0, vis, color);
        if (color.getHex() === BASE_COLOR.getHex()) {
          // 干净面:
          //  - 有贴图 → 白色(别把贴图压暗 40%)
          //  - 无贴图但有 Kd → 白色(让 Kd 原色显示);有问题时压暗
          //  - 两者都没有 → 灰色(跟原来一致)
          if (textured) {
            color.copy(TEXTURED_COLOR);
          } else if (slotHasKd[slot]) {
            color.copy(dimBase ? BASE_DIM : TEXTURED_COLOR);
          } else if (dimBase) {
            color.copy(BASE_DIM);
          }
        }
      } else {
        // 没有分析结果(克重视角)—— 干净面:有贴图或 Kd → 白色,都没有 → 灰色
        if (textured || slotHasKd[slot]) {
          color.copy(TEXTURED_COLOR);
        } else {
          color.copy(BASE_COLOR);
        }
      }
      for (let v = 0; v < 3; v++) {
        colors[f * 9 + v * 3] = color.r;
        colors[f * 9 + v * 3 + 1] = color.g;
        colors[f * 9 + v * 3 + 2] = color.b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (hasUv && uvs) {
      geo.setAttribute(
        "uv",
        new THREE.BufferAttribute(uvs.subarray(0, triCount * 6), 2)
      );
    }
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    bboxRef.current = bb.clone();
    const diag = Math.hypot(
      bb.max.x - bb.min.x,
      bb.max.y - bb.min.y,
      bb.max.z - bb.min.z
    );

    if (slots.length > 0) {
      // 材质分组:把三角汤按材质切成连续段(非索引几何,group 的 start/count 是顶点数)
      if (materialIndex && materialIndex.length > 0) {
        addMaterialGroups(geo, materialIndex);
      } else {
        geo.addGroup(0, triCount * 3, 0);
      }
    }
    /**
     * 材质 —— **只在真的用得上的时候才建**
     *
     * `slots`(按 OBJ 的 `usemtl` 分组)或 `single`(单材质)有值时,下面那个
     * 兜底材质用不上 —— 以前是**无条件** new 的,于是每改一次尺寸就漏一个
     * 材质(`disposeMesh` 只 dispose 挂在 mesh 上的那一个)。
     */
    const mesh = new THREE.Mesh(
      geo,
      (slots.length > 0 ? slots : single) ??
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          flatShading: true,
          side: THREE.DoubleSide,
          roughness: 0.75,
          metalness: 0.05,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
    );
    poseGroup.add(mesh);
    meshRef.current = mesh;

    // 问题边线
    const makeLines = (
      data: Float32Array | undefined,
      hex: string,
      visible: boolean,
      opts?: { opacity?: number; depthTest?: boolean }
    ) => {
      if (!data || data.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(data, 3));
      const m = new THREE.LineBasicMaterial({
        color: hex,
        depthTest: opts?.depthTest ?? true,
        transparent: true,
        opacity: opts?.opacity ?? 0.95,
      });
      const lines = new THREE.LineSegments(g, m);
      lines.visible = visible;
      poseGroup.add(lines);
      return lines;
    };
    lineRefs.current.openEdge = makeLines(
      openEdges,
      ISSUE_COLORS.openEdge,
      vis.openEdge
    );
    lineRefs.current.planarHole = makeLines(
      planarHoleEdges,
      ISSUE_COLORS.planarHole,
      vis.planarHole
    );
    lineRefs.current.nonManifoldEdge = makeLines(
      nonManifoldEdges,
      ISSUE_COLORS.nonManifoldEdge,
      vis.nonManifoldEdge
    );
    // 轮廓:与开放边同源数据,半透明贯穿显示(轮廓线角色)
    lineRefs.current.outline = makeLines(
      openEdges,
      ISSUE_COLORS.outline,
      vis.outline,
      {
        opacity: 0.4,
        depthTest: false,
      }
    );

    // 网格地面(世界 z=0 即打印平台;整体略下沉避免与模型底面深度冲突,
    // 同时保持在平台投影上方,网格线可透过绿色占位填充透出)
    const sx = bb.max.x - bb.min.x;
    const sy = bb.max.y - bb.min.y;
    const span = Math.max(sx, sy, 10);
    const nice = 10 ** Math.ceil(Math.log10(span * 1.6));
    const gridGroup = new THREE.Group();
    gridGroup.position.z = -Math.max(0.02, diag * 0.0008);
    const grid1 = new THREE.GridHelper(
      nice,
      Math.max(
        8,
        Math.round(nice / Math.max(1, 10 ** Math.floor(Math.log10(span))))
      ),
      0x3a4150,
      0x242a35
    );
    grid1.rotation.x = Math.PI / 2;
    gridGroup.add(grid1);
    ctx.scene.add(gridGroup);
    gridRef.current = gridGroup;

    // 视角适配
    fitCamera();
    onReadyRef.current?.();
  }, [previewCtx, result, meshPositions, textures, fitCamera]);

  // ---------- 旋转控制器(gizmo) ----------
  //
  // 业界主流那套:模型上套三个彩色圆环,拖着环转。three.js 的
  // `TransformControls` 就是它 —— Blender / Sketchfab 用的同一个。
  //
  // 挂在**姿态组**上 —— 姿态组才是「打印姿态」那一份(模型 + 问题边线
  // 都在里面,`rotation.order = "ZYX"`,跟摆盘算法 / OBJ 导出同一个矩阵)。
  //
  // 控制器改的是 **quaternion**,不会顺手更新欧拉角那一栏 —— 得自己按
  // 仓库口径("ZYX" = 先 X 后 Y 后 Z)分解回去,不然角度条上的数跟画面
  // 对不上。
  //
  // 拖控制器的时候左键被控制器吃掉了,相机得让开 —— 否则拖环的同时相机
  // 也在转,画面跟着抖。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `meshPositions` 是触发条件 —— 换了模型就重建一次控制器,effect 体里不用读它
  useEffect(() => {
    const ctx = previewCtx;
    const poseGroup = poseGroupRef.current;
    if (!ctx || !poseGroup) return;
    // 模型还没建好 —— 控制器等它(空场景里挂一圈环没意义)
    if (!meshRef.current) return;
    if (!onPoseChangeRef.current) return;

    const tc = new TransformControls(ctx.camera, ctx.renderer.domElement);
    // 只给「转」—— 打印姿态不该被平移 / 缩放改掉
    tc.setMode("rotate");
    // 世界坐标轴 —— 环上那三个轴就是 rotX / rotY / rotZ,跟角度条上的数
    // 一一对应(绕模型自身的局部轴转的话,数对不上,用户会懵)
    tc.setSpace("world");
    tc.size = 0.9;
    tc.attach(poseGroup);
    const helper = tc.getHelper();
    ctx.scene.add(helper);

    const onObjectChange = () => {
      // 控制器写的是 quaternion —— 分解回仓库口径的欧拉角
      const e = new THREE.Euler().setFromQuaternion(
        poseGroup.quaternion,
        POSE_EULER_ORDER
      );
      onPoseChangeRef.current?.({
        rotX: THREE.MathUtils.radToDeg(e.x),
        rotY: THREE.MathUtils.radToDeg(e.y),
        rotZ: THREE.MathUtils.radToDeg(e.z),
      });
    };
    const onMouseDown = () => {
      draggingRef.current = true;
      // 相机让开 —— 左键这会儿归控制器
      ctx.controls.enabled = false;
    };
    const onMouseUp = () => {
      draggingRef.current = false;
      // 相机让回来 —— 控制器放手了,左键空白处又能转相机了
      ctx.controls.enabled = true;
    };

    tc.addEventListener("objectChange", onObjectChange);
    tc.addEventListener("mouseDown", onMouseDown);
    tc.addEventListener("mouseUp", onMouseUp);
    gizmoRef.current = tc;

    return () => {
      tc.removeEventListener("objectChange", onObjectChange);
      tc.removeEventListener("mouseDown", onMouseDown);
      tc.removeEventListener("mouseUp", onMouseUp);
      tc.detach();
      ctx.scene.remove(helper);
      tc.dispose();
      gizmoRef.current = null;
    };
    // `meshPositions` 变了 = 换了个模型 —— 控制器重建一次
  }, [previewCtx, meshPositions]);

  // ---------- 支撑几何 ----------
  //
  // 外面传进来的那块外壳优先(摆盘 Worker 算完姿态回传的那块 —— 跟克重
  // 算的是同一块几何);没有才用分析结果自带的那块。
  useEffect(() => {
    const ctx = previewCtx;
    const group = groupRef.current;
    if (!ctx || !group) return;

    // 清掉旧的支撑几何
    for (const m of Object.values(supportRefs.current)) {
      if (!m) continue;
      group.remove(m);
      disposeMesh(m);
    }
    supportRefs.current = {
      shell: null,
      under: null,
      proj: null,
      ring: null,
      curtain: null,
    };

    const shell = shellForPose;
    if (!shell || shell.positions.length < 9) return;

    // ① 支撑体外壳(白,半透明):已剔除下朝向面,该区域由支撑体顶面负责,避免叠加
    if (shell.topIndex.length >= 3) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute(
        "position",
        new THREE.BufferAttribute(shell.positions, 3)
      );
      sg.setIndex(new THREE.BufferAttribute(shell.topIndex, 1));
      sg.computeVertexNormals();
      const sm = new THREE.MeshStandardMaterial({
        color: "#d8e0e8",
        transparent: true,
        opacity: 0.24,
        roughness: 0.9,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const shellMesh = new THREE.Mesh(sg, sm);
      shellMesh.visible = showSupportRef.current;
      shellMesh.renderOrder = 1;
      group.add(shellMesh);
      supportRefs.current.shell = shellMesh;
    }

    // ② 支撑体顶面(绿):模型的下朝向面,即支撑材料的上边界
    if (shell.underside.length >= 9) {
      const ug = new THREE.BufferGeometry();
      ug.setAttribute(
        "position",
        new THREE.BufferAttribute(shell.underside, 3)
      );
      const um = new THREE.MeshBasicMaterial({
        color: "#2f7255",
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const underMesh = new THREE.Mesh(ug, um);
      underMesh.visible = showSupportRef.current;
      underMesh.renderOrder = 0;
      group.add(underMesh);
      supportRefs.current.under = underMesh;
    }

    // ③ 平台投影 / 占地区域:全部面片沿 Z 压平到平台平面(略低于网格地面避免深度冲突);
    // 用 MAX 混合方程,重叠三角形不叠加变亮,网格线亮于填充色仍可透出
    const groundZ = shell.groundZ;
    const projPos = new Float32Array(shell.positions.length);
    for (let i = 0; i < projPos.length; i += 3) {
      projPos[i] = shell.positions[i] ?? 0;
      projPos[i + 1] = shell.positions[i + 1] ?? 0;
      projPos[i + 2] = groundZ;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(projPos, 3));
    pg.setIndex(new THREE.BufferAttribute(shell.index, 1));
    const pm = new THREE.MeshBasicMaterial({
      color: "#2f7255",
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const projMesh = new THREE.Mesh(pg, pm);
    projMesh.visible = showSupportRef.current;
    projMesh.renderOrder = -1;
    group.add(projMesh);
    supportRefs.current.proj = projMesh;

    // ④ 底板留边那一圈(绿):底板比模型轮廓四周各留一圈边(默认 5mm),
    //    那圈边也是实心支撑 —— 克重那边**算进去了**,画面上也得画出来。
    //
    //    跟 ③ 平台投影画在同一个平面、同一套 MAX 混合,所以两片合起来读成
    //    一整块底板:投影是模型轮廓,这一圈是轮廓外扩出来的那圈边。
    if (shell.baseRing.length >= 9) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.BufferAttribute(shell.baseRing, 3));
      const rm = new THREE.MeshBasicMaterial({
        color: "#2f7255",
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      const ringMesh = new THREE.Mesh(rg, rm);
      ringMesh.visible = showSupportRef.current;
      ringMesh.renderOrder = -1;
      group.add(ringMesh);
      supportRefs.current.ring = ringMesh;
    }

    // ⑤ 支撑体外壁(绿):下朝向区域边界边竖直向下挤出至平台
    if (shell.curtain.length >= 9) {
      const cg = new THREE.BufferGeometry();
      cg.setAttribute("position", new THREE.BufferAttribute(shell.curtain, 3));
      const cm = new THREE.MeshBasicMaterial({
        color: "#2f7255",
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const curtainMesh = new THREE.Mesh(cg, cm);
      curtainMesh.visible = showSupportRef.current;
      curtainMesh.renderOrder = 0;
      group.add(curtainMesh);
      supportRefs.current.curtain = curtainMesh;
    }
  }, [previewCtx, shellForPose]);

  // ---------- 平台高度:模型组整体平移 ----------
  //
  // 平台平面落在世界 z=0,模型坐在平台上方一段托底高度(**自动置于平面**)。
  //
  // ## 平台平面怎么定
  //
  // | 有没有「当前姿态的那块外壳」 | 平台平面 |
  // |---|---|
  // | 有 | 外壳自己的 `groundZ` —— 那就是算支撑体积时用的平台平面,画出来的支撑跟算克重的支撑落在同一个平面上 |
  // | 没有 | 当前姿态下**包围盒**的最低点 − 托底高度 |
  //
  // 两条路用的是**同一个口径** —— 支撑体积算平台平面也是拿包围盒最低点
  // (`mesh.bboxMin[2] - 托底`)。所以:
  //
  // - 「显示支撑」开关前后模型**不会跳**(只差那 0.05~0.1mm 的安全余量);
  // - 支撑的外壳底面**不会沉到平台下面**(它就画在平台平面上)。
  //
  // ## 为什么模型**不会低过平面**
  //
  // 包围盒装着模型 ⇒ **包围盒最低点 ≤ 模型最低点**。
  //
  // 平台平面取的就是包围盒最低点(或更低的 `groundZ`)⇒
  // **平台平面 ≤ 模型最低点** ⇒ 模型永远在平台上面。
  //
  // ## 为什么不能用「旧姿态」的外壳
  //
  // 支撑是「某个姿态下的一次结果」—— 姿态一变,手里那块外壳就是旧姿态的。
  // 拿它摆平台平面,转过之后的模型会**沉到平台下面**(工作室 2026-11-07 报
  // 的「显示支撑必须自动置于平面,模型不能低过平面」)。所以外壳先过一遍
  // `shellMatchesPose`,对不上的直接不认(见上面的 `shellForPose`)。
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const bbox = bboxRef.current;
    if (!bbox) return;
    const platformZ = shellForPose
      ? shellForPose.groundZ
      : rotatedBBoxMinZ(bbox, rotX, rotY, rotZ) -
        (supportLiftMmRef.current ?? SUPPORT_LIFT_MM);
    group.position.z = -platformZ;
  }, [previewCtx, shellForPose, meshPositions, rotX, rotY, rotZ]);

  // ---------- 姿态:只改组的旋转,几何不重建 ----------
  useEffect(() => {
    const poseGroup = poseGroupRef.current;
    if (!poseGroup) return;
    // 旋转顺序必须是 "ZYX"(即 Rz·Ry·Rx):跟摆盘算法(rotateSupportMesh)和
    // OBJ 导出(obj-exporter.rotateVertex)的「先 X 后 Y 后 Z」口径一致。
    // three.js 默认的 "XYZ"(Rx·Ry·Rz)跟它对不上 —— 画面里的姿态会跟算出来的
    // 支撑克重对不上号。
    poseGroup.rotation.order = POSE_EULER_ORDER;
    poseGroup.rotation.set(
      (rotX * Math.PI) / 180,
      (rotY * Math.PI) / 180,
      (rotZ * Math.PI) / 180,
      POSE_EULER_ORDER
    );
  }, [previewCtx, rotX, rotY, rotZ]);

  // ---------- 贴图开关:摘掉 / 挂回各材质自己的贴图 ----------
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      const baseMap = std.userData.baseMap as THREE.Texture | undefined;
      if (!baseMap) continue;
      std.map = showTexture ? baseMap : null;
      std.needsUpdate = true;
    }
  }, [showTexture]);

  // ---------- 可见性 / 贴图开关变化 → 重新着色 ----------
  useEffect(() => {
    const mesh = meshRef.current;
    // 直接读 prop 而不是 resultRef:结果变了要重着色,ref 要等上面那个 effect
    // 同步才有值,这里读 prop 语义更直接
    const r = result;
    if (!mesh || !r) return;
    const colorAttr = mesh.geometry.getAttribute(
      "color"
    ) as THREE.BufferAttribute;
    const flags = r.flags;
    const comps = r.faceComponent;
    const dimBase = hasVisibleFaceIssues(r.stats, visibility);
    const slotHasMap = slotHasMapRef.current;
    const materialIndex = textures?.materialIndex ?? null;
    const color = new THREE.Color();
    for (let f = 0; f < r.stats.triangleCount; f++) {
      const slot = materialIndex ? (materialIndex[f] ?? 0) : 0;
      const textured = showTexture && slotHasMap[slot] === true;
      faceColor(flags[f] ?? 0, comps[f] ?? 0, visibility, color);
      if (color.getHex() === BASE_COLOR.getHex()) {
        // 干净面:有贴图 → 白色(别压暗贴图);否则沿用原来的灰色 / 压暗
        if (textured) {
          color.copy(TEXTURED_COLOR);
        } else if (dimBase) {
          color.copy(BASE_DIM);
        }
      }
      for (let v = 0; v < 3; v++)
        colorAttr.setXYZ(f * 3 + v, color.r, color.g, color.b);
    }
    colorAttr.needsUpdate = true;
    if (lineRefs.current.openEdge) {
      lineRefs.current.openEdge.visible = visibility.openEdge;
    }
    if (lineRefs.current.planarHole) {
      lineRefs.current.planarHole.visible = visibility.planarHole;
    }
    if (lineRefs.current.nonManifoldEdge) {
      lineRefs.current.nonManifoldEdge.visible = visibility.nonManifoldEdge;
    }
    if (lineRefs.current.outline) {
      lineRefs.current.outline.visible = visibility.outline;
    }
  }, [visibility, result, showTexture, textures]);

  // ---------- 悬停提示 ----------
  useEffect(() => {
    if (!previewCtx) return;
    const { renderer, camera } = previewCtx;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastHover = 0;
    const onMove = (ev: PointerEvent) => {
      const now = performance.now();
      const tip = tooltipRef.current;
      if (!tip) return;
      // 正在拖模型 —— 别弹问题标签(一边转一边闪)
      if (draggingRef.current) {
        tip.style.display = "none";
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      tip.style.left = `${ev.clientX - rect.left + 14}px`;
      tip.style.top = `${ev.clientY - rect.top + 14}px`;
      if (now - lastHover < 90) return;
      lastHover = now;
      const r = resultRef.current;
      const mesh = meshRef.current;
      if (!r || !mesh || r.stats.triangleCount > 150000) {
        tip.style.display = "none";
        return;
      }
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = (-(ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(mesh, false);
      const hit = hits[0];
      if (hit && hit.faceIndex != null) {
        const f = hit.faceIndex;
        const fl = r.flags[f] ?? 0;
        const texts = tooltipTextsRef.current;
        let text = "";
        if (fl & FACE_FLAG.FLIPPED) text = texts.flipped ?? "";
        else if (fl & FACE_FLAG.DEGENERATE) text = texts.degenerate ?? "";
        else if (fl & FACE_FLAG.DUPLICATE) text = texts.duplicate ?? "";
        else if (fl & FACE_FLAG.SHELL_NOISE) text = texts.shellNoise ?? "";
        else if (fl & FACE_FLAG.SHELL_EXTRA) text = texts.shellExtra ?? "";
        if (text) {
          tip.textContent = text;
          tip.style.display = "block";
        } else {
          tip.style.display = "none";
        }
      } else {
        tip.style.display = "none";
      }
    };
    const onLeave = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    return () => {
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
    };
  }, [previewCtx]);

  // ---------- 聚焦动画 ----------
  useEffect(() => {
    if (!focusRequest || !focusRequest.point) return;
    const ctx = ctxRef.current;
    const poseGroup = poseGroupRef.current;
    if (!ctx || !poseGroup) return;
    const { camera, controls } = ctx;
    const target = new THREE.Vector3(...focusRequest.point);
    // 聚焦点是模型原始坐标 —— 先按姿态转,再落平台平移
    // (姿态组与模型组的世界矩阵就是这两步)
    ctx.scene.updateMatrixWorld(true);
    target.applyMatrix4(poseGroup.matrixWorld);
    const dist = focusRequest.radius ?? 40;
    const dir = new THREE.Vector3(...(focusRequest.dir ?? [0.9, -1.1, 0.75]))
      .normalize()
      .multiplyScalar(dist);
    focusAnimRef.current = {
      from: camera.position.clone(),
      to: target.clone().add(dir),
      fromT: controls.target.clone(),
      toT: target,
      start: performance.now(),
    };
  }, [focusRequest]);

  // ---------- 重置视角 ----------
  useEffect(() => {
    if (fitSignal > 0) fitCamera();
  }, [fitSignal, fitCamera]);

  return (
    <div className="absolute inset-0" data-testid="viewport">
      <ObjPreview
        mode="inspect"
        onSceneReady={handleSceneReady}
        onFrame={handleFrame}
      >
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-10 hidden rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-xs text-zinc-100 shadow-lg"
          style={{ display: "none" }}
        />
      </ObjPreview>
    </div>
  );
}
