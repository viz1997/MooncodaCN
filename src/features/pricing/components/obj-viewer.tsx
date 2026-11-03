"use client";

import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { TextureUrlMap } from "@/features/pricing/lib/obj-materials";
import { parseObjInWorker } from "@/features/pricing/lib/obj-worker-client";
import {
  addMaterialGroups,
  buildPreviewMaterials,
} from "@/features/shared/components/obj-preview/materials";
import {
  ObjPreview,
  type PreviewContext,
} from "@/features/shared/components/obj-preview/obj-preview";
import {
  buildSupportShell,
  prepareSupportModel,
  rotateSupportMesh,
  type SupportModel,
} from "@/features/tools/lib/mesh/support-shell";

/**
 * 移植自 wjp-source-code/src/components/obj-viewer.tsx —— 耗材报价计算器的 3D 预览。
 *
 * 渲染逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）、去除 `any` 断言、Biome 格式化调整，
 * 未改变任何渲染行为。
 *
 * 2026-11-02:支撑可视化改用**模型检查工具的包裹支撑几何**
 * (`src/features/tools/lib/mesh/support-shell.ts`)——跟克重算法同一套算出来的,
 * 画面里的支撑体就是报价里算克重的那块支撑。
 *
 * 2026-11-03:**按材质分组渲染**,每个材质挂它自己 `map_Kd` 指向的贴图。
 * 之前是「整块模型挂一张图」—— 多材质模型必然贴错。
 *
 * 2026-11-03:场景本身(renderer / camera / 灯光 / 控制器 / 渲染循环)交给共用的
 * `<ObjPreview mode="print-bed" />` —— 与模型检查工具(/tools/model-check)是同一个
 * 组件,两个工具的模型观感、贴图表现完全一致。
 */

type Props = {
  objText: string;
  mtlText?: string | undefined;
  textureBlobUrl?: string | undefined;
  /**
   * 材质名 → 该材质自己的贴图 blob URL。
   *
   * 多材质模型靠它把贴图分对 —— 没有对应贴图的材质不挂贴图(退回材质本色),
   * 绝不拿别的图顶替。
   */
  textureUrls?: TextureUrlMap | undefined;
  /** Current display dimensions [X, Y, Z] in mm - shown as annotations on the bounding box */
  dims?: [number, number, number] | undefined;
  /** Rotation around X axis in degrees (for optimal print angle preview) */
  rotationX?: number | undefined;
  /** Rotation around Y axis in degrees */
  rotationY?: number | undefined;
  /** Rotation around Z axis (manual fine-tuning) */
  rotationZ?: number | undefined;
  /** Scale factor(s) for the model mesh. Can be a single number (uniform) or [sx, sy, sz] tuple. Default 1. */
  scale?: number | [number, number, number] | undefined;
  /** Show support shell visualization (semi-transparent shell around model). Default false. */
  showSupport?: boolean | undefined;
  /**
   * 是否显示模型自带的贴图。默认 true。
   *
   * 关掉时材质退回 MTL 的 `Kd` 本色(纯色视图)—— 贴图本体留在
   * `userData.baseMap` 里,切回来不用重新下载。
   */
  showTexture?: boolean | undefined;
  /** Called once when the 3D render has finished (model loaded + camera framed) */
  onReady?: (() => void) | undefined;
  /** Called with percent 0-100 during parsing/loading */
  onProgress?: ((percent: number) => void) | undefined;
  className?: string | undefined;
};

// Yield to the UI thread so progress callbacks and other tasks can run.
const yieldToUI = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 兜底贴图 URL —— 浏览器解不了的格式(BMP 等)先转成 PNG data URL。
 *
 * three 的 `TextureLoader` 直接吃 blob URL;解不了就借 `<img>` + canvas 转一道。
 * 转出来的 data URL 照样能交给 `TextureLoader`。
 */
async function resolveFallbackTextureUrl(
  url: string | undefined
): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        () => resolve(),
        undefined,
        () => reject(new Error("texture load failed"))
      );
    });
    return url;
  } catch {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("image decode failed"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return url;
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return url;
    }
  }
}

/**
 * Lightweight three.js OBJ viewer.
 * - Parses OBJ off the main thread via a Web Worker (obj-worker-client)
 * - Builds a BufferGeometry from the worker's triangle-soup positions
 * - Parses `vt` UVs and attaches them as the 'uv' attribute
 * - Renders per-material groups, each material with its own `map_Kd` texture
 * - Auto-centers and scales the model to fit the viewport
 * - Shows a bounding box with axis colors (X red, Y green, Z blue)
 * - Orbit controls: drag to rotate, wheel to zoom, right-click to pan
 */
export function ObjViewer({
  objText,
  mtlText,
  textureBlobUrl,
  textureUrls,
  dims,
  rotationX,
  rotationY,
  rotationZ,
  scale,
  showSupport,
  showTexture,
  onReady,
  onProgress,
  className,
}: Props) {
  /** 预览场景上下文 —— <ObjPreview> 建好场景后交给我们 */
  const [previewCtx, setPreviewCtx] = useState<PreviewContext | null>(null);
  const ctxRef = useRef<PreviewContext | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const bboxHelperRef = useRef<THREE.Object3D | null>(null);
  const axisAnnotationRef = useRef<THREE.Group | null>(null);
  // 场景还没就绪时建好的模型 —— 场景一好就挂上去
  const pendingModelRef = useRef<THREE.Object3D | null>(null);
  // 支撑可视化组(包裹支撑:外壳 + 顶面 + 外壁 + 平台投影)
  const supportGroupRef = useRef<THREE.Group | null>(null);
  // 摆盘用的焊接模型(支撑几何的输入)——OBJ 解析时备一次,之后每个姿态只旋转
  const supportModelRef = useRef<SupportModel | null>(null);
  // 支撑开关(给异步的建模流程读)
  const showSupportRef = useRef(showSupport);
  showSupportRef.current = showSupport;
  // 贴图开关 —— 同理:建模是异步的,必须读 ref 拿到最新值
  const showTextureRef = useRef(showTexture);
  showTextureRef.current = showTexture;
  /** 贴图开关的生效值(默认开) */
  const showTextureOn = showTexture !== false;
  // Use refs for callbacks so the parse effect doesn't re-run on every parent render
  const onReadyRef = useRef(onReady);
  const onProgressRef = useRef(onProgress);
  // Track current rotation values so fitCameraToModel (called on remount) can apply them
  const rotationXRef = useRef(rotationX);
  const rotationYRef = useRef(rotationY);
  const rotationZRef = useRef(rotationZ);
  rotationXRef.current = rotationX;
  rotationYRef.current = rotationY;
  rotationZRef.current = rotationZ;
  // Track dims so updateBoundingBoxAndAnnotations can access current values
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  // Track scale so fitCameraToModel and rotation effect can apply current scale
  // 支持 number 或 [sx, sy, sz] 元组
  const getScaleTuple = (): [number, number, number] => {
    const s = scaleRef.current;
    if (Array.isArray(s)) return [s[0], s[1], s[2]];
    const v = typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 1;
    return [v, v, v];
  };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  onReadyRef.current = onReady;
  onProgressRef.current = onProgress;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** 当前场景 —— <ObjPreview> 还没建好时为 null */
  const getScene = (): THREE.Scene | null => ctxRef.current?.scene ?? null;

  // Add thick colored highlight lines along the 3 edges at the front-bottom-left corner.
  // These are visual axis identifiers only (no text labels).
  // X edge (red): along +X from origin (长, horizontal)
  // Y edge (green): along +Y from origin (宽, depth)
  // Z edge (blue): along +Z from origin (高, vertical — after -90° X rotation this becomes three.js Y)
  const addAxisAnnotations = (
    boxSize: THREE.Vector3,
    boxMin: THREE.Vector3,
    _dimValues: [number, number, number]
  ) => {
    const scene = getScene();
    if (!scene) return;

    // Remove previous annotations
    if (axisAnnotationRef.current) {
      scene.remove(axisAnnotationRef.current);
      axisAnnotationRef.current.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => {
              m.dispose();
            });
          } else {
            mesh.material.dispose();
          }
        }
      });
    }

    const group = new THREE.Group();
    const origin = boxMin.clone();
    const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z, 1);
    // Use cylinders for thick visible lines (LineBasicMaterial.linewidth is ignored in WebGL)
    const lineRadius = maxDim * 0.006;
    const sphereRadius = maxDim * 0.018;

    // Helper: create a colored cylinder from point A to point B
    const makeCylinder = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      color: number
    ): THREE.Mesh => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length() || 0.001;
      const geo = new THREE.CylinderGeometry(lineRadius, lineRadius, len, 12);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      // Cylinder default is along Y axis; rotate to align with dir
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      mesh.position.copy(mid);
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(
        up,
        dir.clone().normalize()
      );
      mesh.quaternion.copy(quat);
      return mesh;
    };

    // Helper: create a colored sphere at a point
    const makeSphere = (pos: THREE.Vector3, color: number): THREE.Mesh => {
      const geo = new THREE.SphereGeometry(sphereRadius, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      return mesh;
    };

    const xEnd = origin.clone().add(new THREE.Vector3(boxSize.x, 0, 0));
    const yEnd = origin.clone().add(new THREE.Vector3(0, boxSize.y, 0));
    const zEnd = origin.clone().add(new THREE.Vector3(0, 0, boxSize.z));

    // X axis - red (length, along X)
    group.add(makeCylinder(origin, xEnd, 0xef4444));
    group.add(makeSphere(xEnd, 0xef4444));

    // Y axis - green (height, along Y)
    group.add(makeCylinder(origin, yEnd, 0x22c55e));
    group.add(makeSphere(yEnd, 0x22c55e));

    // Z axis - blue (depth, along Z)
    group.add(makeCylinder(origin, zEnd, 0x3b82f6));
    group.add(makeSphere(zEnd, 0x3b82f6));

    // Common origin sphere (white) to mark the corner
    group.add(makeSphere(origin, 0xffffff));

    scene.add(group);
    axisAnnotationRef.current = group;
  };

  // 相机取景：让模型基本占满画面
  //
  // 旧实现的问题（画面里大片空白）：
  //  1. 只按竖直 FOV 算距离 —— 画布越宽两侧留白越多；
  //  2. 距离额外乘了 1.8 的余量，模型只占画面一半左右；
  //  3. 相机看向原点 (0,0,0)，而模型是「底面贴 Z=0」摆的，原点在模型
  //     底部而不是中心 —— 模型整体偏上，底部空一大块。
  //
  // 现在：用包围球半径同时约束竖直 / 水平视野，并对准包围盒中心。
  const applyCameraFit = (box: THREE.Box3) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { camera, controls } = ctx;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // 包围球半径（半个对角线）—— 保守但对任意朝向都成立
    const radius = Math.max(size.length() / 2, 0.001);

    const vFov = camera.fov * (Math.PI / 180);
    const aspect = Math.max(camera.aspect, 0.1);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // 包围球在竖直、水平两个方向都要装得下 → 取更远的那个
    const dist = Math.max(
      radius / Math.sin(vFov / 2),
      radius / Math.sin(hFov / 2)
    );

    // Z-up 视角：相机从 X+Y-Z+ 方向看（斜上方）；方向向量要归一化，
    // 否则 (0.7,-0.7,0.5) 的模长 1.109 会把相机额外推远
    const dir = new THREE.Vector3(0.7, -0.7, 0.5).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
  };

  // Fit camera to model bounding box and add bounding box helper
  // Defined as a function declaration so it can be called from the build effect above
  const fitCameraToModel = () => {
    const model = modelRef.current;
    const ctx = ctxRef.current;
    if (!model || !ctx) return;

    // 应用用户尺寸缩放（支持独立 XYZ）
    const [sx, sy, sz] = getScaleTuple();
    model.scale.set(sx, sy, sz);

    // 应用用户旋转（不需要基础 -90° X 旋转了，因为场景已经是 Z-up）
    //
    // 旋转顺序必须是 "ZYX"(即 Rz·Ry·Rx)：跟摆盘算法(rotateSupportMesh)和
    // OBJ 导出(obj-exporter.rotateVertex)的「先 X 后 Y 后 Z」口径一致。
    // three.js 默认的 "XYZ"(Rx·Ry·Rz)跟它对不上 —— 画面里的姿态会跟算出来的
    // 支撑克重对不上号。
    model.rotation.order = "ZYX";
    const rx = ((rotationXRef.current ?? 0) * Math.PI) / 180;
    const ry = ((rotationYRef.current ?? 0) * Math.PI) / 180;
    const rz = ((rotationZRef.current ?? 0) * Math.PI) / 180;
    model.rotation.x = rx;
    model.rotation.y = ry;
    model.rotation.z = rz;
    // 重置位置到原点
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    // 遍历所有 Mesh 子节点，确保几何体边界盒已计算
    model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        child.updateMatrixWorld(true);
        if (child.geometry.boundingBox === null) {
          child.geometry.computeBoundingBox();
        }
      }
    });
    // 使用精确模式计算旋转+缩放后的世界坐标包围盒
    const rotBox = new THREE.Box3().setFromObject(model, true);
    if (rotBox.isEmpty()) return;

    // 把模型底部贴到 Z=0（网格平面），同时居中 X/Y 到原点
    // Z 是高度方向，网格在 Z=0 平面上
    model.position.z = -rotBox.min.z;
    model.position.x = -(rotBox.min.x + rotBox.max.x) / 2;
    model.position.y = -(rotBox.min.y + rotBox.max.y) / 2;
    model.updateMatrixWorld(true);

    // 相机自适应（基于缩放+旋转后的最终包围盒）
    const finalBox = new THREE.Box3().setFromObject(model, true);
    if (finalBox.isEmpty()) return;
    applyCameraFit(finalBox);

    // 更新包围盒 helper 和坐标轴标注（基于最终位置）
    updateBoundingBoxAndAnnotations();
  };

  // 更新包围盒 helper 和坐标轴标注（基于模型当前世界位置）
  // 在 fitCameraToModel 和 rotation effect 中调用，确保坐标轴始终贴在网格平面
  const updateBoundingBoxAndAnnotations = () => {
    const model = modelRef.current;
    const scene = getScene();
    if (!model || !scene) return;

    // Remove previous bounding box helper
    if (bboxHelperRef.current && scene) {
      scene.remove(bboxHelperRef.current);
      const line = bboxHelperRef.current as THREE.LineSegments;
      if (line.geometry) line.geometry.dispose();
      const lineMat = line.material as THREE.Material;
      if (lineMat) lineMat.dispose();
    }

    // Build custom bounding box (neutral color, subtle)
    // 使用精确模式计算最终包围盒（与贴网格逻辑一致，确保 min.y = 0 时坐标轴在网格上）
    const newBox = new THREE.Box3().setFromObject(model, true);
    if (!newBox.isEmpty()) {
      const boxSize = newBox.getSize(new THREE.Vector3());
      const boxCenter = newBox.getCenter(new THREE.Vector3());
      const boxMin = newBox.min.clone();
      const boxGeo = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
      const edges = new THREE.EdgesGeometry(boxGeo);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.4,
      });
      const boxHelper = new THREE.LineSegments(edges, lineMat);
      boxHelper.position.copy(boxCenter);
      scene.add(boxHelper);
      bboxHelperRef.current = boxHelper;
      boxGeo.dispose();

      // Add colored axis annotations with dimension labels at the front-bottom-left corner
      const dimVals: [number, number, number] = dimsRef.current ?? [
        boxSize.x,
        boxSize.y,
        boxSize.z,
      ];
      addAxisAnnotations(boxSize, boxMin, dimVals);
    }
  };

  /**
   * 更新支撑可视化 —— 包裹支撑(与模型检查工具同一套几何)
   *
   * 2026-11-02:原来是本文件自己搭的一套「1mm 面法线外壳 + 8mm 膨胀栅格柱」,
   * 跟克重算法算出来的支撑体对不上 —— 画面里画的和报价里算的不是同一块东西。
   * 现在直接用模型检查工具的包裹支撑几何(`support-shell.ts`):
   *
   *   ① 外壳(浅琥珀,半透明):沿平滑法线外扩间隙后的模型表面(已剔除下朝向面)
   *   ② 支撑顶面(琥珀):模型的下朝向面 —— 支撑材料的上边界
   *   ③ 支撑外壁(琥珀):下朝向区域的边界边竖直挤到平台
   *   ④ 平台投影(琥珀):全部面片压平到平台 —— 支撑体的底面 / 占地区域
   *
   * 焊接后的模型在 OBJ 解析时备一次,之后每个姿态只旋转顶点(刚体旋转),
   * 拓扑不变,不用重算。
   */
  const updateSupportShell = (show: boolean) => {
    // 移除旧的支撑可视化
    const old = supportGroupRef.current;
    if (old) {
      old.parent?.remove(old);
      old.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => {
              m.dispose();
            });
          } else {
            mesh.material.dispose();
          }
        }
      });
      supportGroupRef.current = null;
    }

    const scene = getScene();
    const model = modelRef.current;
    const supportModel = supportModelRef.current;
    if (!show || !model || !scene || !supportModel) return;

    // 旋转到当前打印姿态(口径跟 obj-exporter / 摆盘算法一致:先 X 后 Y 后 Z)
    const rotated = rotateSupportMesh(
      supportModel.mesh,
      rotationXRef.current ?? 0,
      rotationYRef.current ?? 0,
      rotationZRef.current ?? 0
    );
    const shell = buildSupportShell(rotated, supportModel.faceEnclosed);
    if (shell.positions.length < 9) return;

    // 局部坐标(OBJ 的 mm,已按打印姿态旋转) → 世界坐标:
    // 只应用缩放 + 平移 —— 旋转已经烘进几何里了
    const toWorld = new THREE.Matrix4()
      .makeScale(model.scale.x, model.scale.y, model.scale.z)
      .setPosition(model.position.x, model.position.y, model.position.z);
    const tmp = new THREE.Vector3();
    const toWorldPositions = (src: Float32Array): Float32Array => {
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        tmp
          .set(src[i] ?? 0, src[i + 1] ?? 0, src[i + 2] ?? 0)
          .applyMatrix4(toWorld);
        out[i] = tmp.x;
        out[i + 1] = tmp.y;
        out[i + 2] = tmp.z;
      }
      return out;
    };

    const group = new THREE.Group();

    // ① 外壳(半透明):沿平滑法线外扩后的模型表面
    //    下朝向面已剔除 —— 那块由支撑顶面负责,避免两层面片叠加
    if (shell.topIndex.length >= 3) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(toWorldPositions(shell.positions), 3)
      );
      geo.setIndex(new THREE.BufferAttribute(shell.topIndex, 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0xfde68a,
        transparent: true,
        opacity: 0.28,
        roughness: 0.9,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      group.add(mesh);
    }

    // ② 支撑顶面:模型的下朝向面 —— 支撑材料的上边界
    if (shell.underside.length >= 9) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(toWorldPositions(shell.underside), 3)
      );
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 0;
      group.add(mesh);
    }

    // ③ 平台投影 / 占地区域:全部面片沿 Z 压平到平台平面
    //    用 MAX 混合方程,重叠三角形不叠加变亮
    {
      const flat = new Float32Array(shell.positions.length);
      for (let i = 0; i < flat.length; i += 3) {
        flat[i] = shell.positions[i] ?? 0;
        flat[i + 1] = shell.positions[i + 1] ?? 0;
        flat[i + 2] = shell.groundZ;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(toWorldPositions(flat), 3)
      );
      geo.setIndex(new THREE.BufferAttribute(shell.index, 1));
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = -1;
      group.add(mesh);
    }

    // ④ 支撑外壁:下朝向区域的边界边竖直挤到平台
    if (shell.curtain.length >= 9) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(toWorldPositions(shell.curtain), 3)
      );
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 0;
      group.add(mesh);
    }

    scene.add(group);
    supportGroupRef.current = group;
  };

  // ---------- 场景就绪 ----------
  const handleSceneReady = useCallback((ctx: PreviewContext) => {
    // 同步写 ref —— 建模流程是异步的,可能在下一次 React 渲染前就跑到这一步
    ctxRef.current = ctx;
    setPreviewCtx(ctx);
  }, []);

  /** WebGL 不可用 —— <ObjPreview> 兜底 */
  const handlePreviewError = useCallback((message: string) => {
    setError(message);
    setLoading(false);
    onReadyRef.current?.();
  }, []);

  // Build/load model whenever inputs change
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在模型源文件变化时重建
  useEffect(() => {
    if (!objText) return;

    let cancelled = false;

    const buildModel = async () => {
      try {
        setLoading(true);
        setError(null);
        onProgressRef.current?.(5);

        // 1. Parse OBJ via Web Worker (off main thread) with sendGeometry=true
        const workerResult = await parseObjInWorker(objText, {
          sendGeometry: true,
          onProgress: (p) => {
            // Worker reports 0-95; map to 5-80
            onProgressRef.current?.(5 + Math.round((p.percent / 95) * 75));
          },
        });

        if (cancelled) return;

        if (!workerResult.positions || workerResult.positions.length === 0) {
          throw new Error("OBJ 文件无几何数据（positions 为空）");
        }

        onProgressRef.current?.(82);
        // Yield to UI thread so progress can paint before heavy geometry work
        await yieldToUI();

        // 2. Build BufferGeometry from worker positions (triangle soup: 9 floats/tri)
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(workerResult.positions, 3)
        );

        // Parse UVs (vt) from worker results, set geometry 'uv' attribute
        if (workerResult.uvs && workerResult.uvs.length > 0) {
          geometry.setAttribute(
            "uv",
            new THREE.BufferAttribute(workerResult.uvs, 2)
          );
        }

        // Compute normals for proper lighting
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();

        if (cancelled) return;
        onProgressRef.current?.(88);
        await yieldToUI();

        // 3. 材质 —— 与模型检查工具共用同一份实现
        //    (src/features/shared/components/obj-preview/materials.ts)
        //
        // 关键点:
        //  - 每个材质挂**它自己**的贴图(材质名 → blob URL 的映射由解压管线建好)
        //  - 没有对应贴图的材质退回该材质的 Kd 本色 —— 绝不拿别的图顶替
        //  - 几何体没有 uv 时**不能**挂贴图:three.js 会去采样 (0,0) 那个
        //    像素,整块模型糊成一片(比白模还难看)
        const hasUv = Boolean(workerResult.uvs && workerResult.uvs.length > 0);
        const materialNames = workerResult.materialNames ?? [];
        const fallbackTextureUrl =
          await resolveFallbackTextureUrl(textureBlobUrl);
        if (cancelled) return;

        const { slots, single } = buildPreviewMaterials({
          mtlText,
          textureUrls,
          materialNames,
          hasUv,
          showTexture: showTextureRef.current !== false,
          fallbackTextureUrl,
        });

        onProgressRef.current?.(92);
        await yieldToUI();

        // 4. 选材质:
        //    - 有 `usemtl` 分组 → 材质数组 + geometry groups(每个材质一块)
        //    - 没有分组 → 整块用单个材质
        let material: THREE.Material | THREE.Material[];
        if (slots.length > 0) {
          material = slots;
          // 把三角汤按材质切成连续段 —— 非索引几何,group 的 start/count 是顶点数
          const materialIndex = workerResult.materialIndex;
          if (materialIndex && materialIndex.length > 0) {
            addMaterialGroups(geometry, materialIndex);
          } else {
            // 材质数组必须配 group,否则 three.js 一个面都不画
            geometry.addGroup(0, workerResult.positions.length, 0);
          }
        } else if (single) {
          material = single;
        } else {
          material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.6,
            metalness: 0.05,
          });
        }

        const mesh = new THREE.Mesh(geometry, material);
        const object = new THREE.Group();
        object.add(mesh);

        if (cancelled) return;

        // 5. Replace previous model
        const previous = modelRef.current;
        const scene = getScene();
        if (previous && scene) {
          scene.remove(previous);
          // Dispose geometries and materials
          previous.traverse((child) => {
            const m = child as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
              if (Array.isArray(m.material)) {
                m.material.forEach((mat) => {
                  mat.dispose();
                });
              } else {
                m.material.dispose();
              }
            }
          });
        }
        modelRef.current = object;
        if (scene) {
          scene.add(object);
          fitCameraToModel();
        } else {
          // 场景还没就绪 —— 先存着,场景一好就挂上去
          pendingModelRef.current = object;
        }

        // 6. 备一份焊接后的模型(支撑几何的输入)——焊接 + 拓扑是姿态无关的,
        //    只做一次,之后拖动角度时只旋转顶点。失败不影响主流程,只是不画支撑。
        try {
          supportModelRef.current = prepareSupportModel(workerResult.positions);
        } catch (err) {
          console.warn("支撑模型准备失败,支撑可视化不可用:", err);
          supportModelRef.current = null;
        }
        // 建模是异步的:开关可能早就打开了,这里补一次支撑可视化
        updateSupportShell(!!showSupportRef.current);

        setLoading(false);
        onProgressRef.current?.(100);
        onReadyRef.current?.();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    buildModel();

    return () => {
      cancelled = true;
    };
  }, [objText, mtlText, textureBlobUrl, textureUrls]);

  // 场景就绪后 —— 把「场景没赶上」时建好的模型挂进去
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在场景就绪时补挂一次
  useEffect(() => {
    const scene = previewCtx?.scene;
    const pending = pendingModelRef.current;
    if (!scene || !pending) return;
    pendingModelRef.current = null;
    scene.add(pending);
    fitCameraToModel();
  }, [previewCtx]);

  // Update axis annotations when dims change (without reloading the model)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在尺寸变化时刷新标注
  useEffect(() => {
    if (!modelRef.current || !getScene() || !dims) return;
    updateBoundingBoxAndAnnotations();
  }, [dims]);

  // 贴图开关:摘掉 / 挂回各材质自己的贴图
  //
  // 贴图本体一直留在 `userData.baseMap` 里 —— 切换只是摘/挂 `map`,
  // 不重新下载也不重建模型(重建要走一遍 worker 解析,太慢)。
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        const baseMap = std.userData.baseMap as THREE.Texture | undefined;
        if (!baseMap) continue;
        std.map = showTextureOn ? baseMap : null;
        std.needsUpdate = true;
      }
    });
  }, [showTextureOn]);

  // Show/hide support shell visualization
  // biome-ignore lint/correctness/useExhaustiveDependencies: 支撑壳层依赖当前模型状态
  useEffect(() => {
    updateSupportShell(!!showSupport);
  }, [showSupport]);

  // Apply rotation when rotationX/rotationY/rotationZ change (for optimal print angle + manual fine-tuning)
  // Also re-applies scale so changes to dimensions are reflected in the 3D preview.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 姿态变化需重算包围盒与支撑
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    // 应用用户尺寸缩放（支持独立 XYZ）
    const [sx, sy, sz] = Array.isArray(scale)
      ? [scale[0], scale[1], scale[2]]
      : [scale ?? 1, scale ?? 1, scale ?? 1];
    model.scale.set(sx, sy, sz);
    // 应用用户旋转（不需要基础 -90° X 旋转了，因为场景已经是 Z-up）
    // 顺序 "ZYX" = Rz·Ry·Rx,跟摆盘算法 / OBJ 导出口径一致(见 fitCameraToModel)
    model.rotation.order = "ZYX";
    const rx = ((rotationX ?? 0) * Math.PI) / 180;
    const ry = ((rotationY ?? 0) * Math.PI) / 180;
    const rz = ((rotationZ ?? 0) * Math.PI) / 180;
    model.rotation.x = rx;
    model.rotation.y = ry;
    model.rotation.z = rz;
    // 重置位置到原点，强制更新世界矩阵
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    // 遍历所有 Mesh 子节点，确保几何体边界球已计算
    model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        child.updateMatrixWorld(true);
        if (child.geometry.boundingBox === null) {
          child.geometry.computeBoundingBox();
        }
      }
    });
    // 计算旋转+缩放后的世界坐标包围盒
    const rotBox = new THREE.Box3().setFromObject(model, true);
    if (!rotBox.isEmpty()) {
      // 把模型底部贴到 Z=0（网格平面），Z 是高度方向
      model.position.z = -rotBox.min.z;
      // 同时居中 X/Y 到原点（水平方向）
      const centerX = (rotBox.min.x + rotBox.max.x) / 2;
      const centerY = (rotBox.min.y + rotBox.max.y) / 2;
      model.position.x = -centerX;
      model.position.y = -centerY;
      model.updateMatrixWorld(true);
    }
    // 更新包围盒 helper 和坐标轴标注（基于旋转后的最终位置）
    updateBoundingBoxAndAnnotations();
    // Re-fit camera after rotation
    const box = new THREE.Box3().setFromObject(model, true);
    if (!box.isEmpty()) {
      applyCameraFit(box);
    }
    // 旋转/缩放后更新支撑壳层位置
    updateSupportShell(!!showSupport);
  }, [rotationX, rotationY, rotationZ, scale, showSupport]);

  return (
    <ObjPreview
      mode="print-bed"
      className={className}
      onSceneReady={handleSceneReady}
      onError={handlePreviewError}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-stone-500 bg-stone-100/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="size-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span>加载模型中...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-xs text-stone-600 bg-stone-100/95">
          <div className="text-center max-w-sm">
            <div className="size-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="size-6 text-amber-600" />
            </div>
            <p className="font-medium text-stone-800 mb-2">3D 预览不可用</p>
            <p className="text-stone-500 leading-relaxed mb-3">{error}</p>
            <div className="text-[10px] text-stone-400 bg-white/60 rounded-md p-2 border border-stone-200 text-left">
              <p className="font-medium text-stone-600 mb-1">解决方案：</p>
              <p>1. 使用 Chrome / Edge 浏览器</p>
              <p>2. 浏览器设置 → 系统 → 启用「硬件加速」</p>
              <p>3. 或在本地运行：npm run dev</p>
            </div>
            <p className="text-[10px] text-stone-400 mt-3">
              其他功能（克重计算、批量报价、价格估算）不受影响
            </p>
          </div>
        </div>
      )}
      {/* Axis indicator overlay */}
      <div className="absolute top-2 right-2 bg-white/80 backdrop-blur-sm rounded-md px-2 py-1.5 text-[10px] font-mono shadow-sm border border-stone-200">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-red-500" />
          <span className="text-stone-600">X 长</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="size-2 rounded-sm bg-green-500" />
          <span className="text-stone-600">Y 宽</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="size-2 rounded-sm bg-blue-500" />
          <span className="text-stone-600">Z 高</span>
        </div>
      </div>
      {/* Hint —— 放左上角:底部中间要留给控制条(显示贴图 / 包裹支撑) */}
      <div className="absolute top-2 left-2 text-[10px] text-stone-500 bg-white/80 backdrop-blur-sm rounded px-2 py-1 border border-stone-200">
        拖拽旋转 · 滚轮缩放 · 右键平移
      </div>
    </ObjPreview>
  );
}
