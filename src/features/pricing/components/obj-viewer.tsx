"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { parseObjInWorker } from "@/features/pricing/lib/obj-worker-client";
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
 */

type Props = {
  objText: string;
  mtlText?: string | undefined;
  textureBlobUrl?: string | undefined;
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
 * Lightweight three.js OBJ viewer.
 * - Parses OBJ off the main thread via a Web Worker (obj-worker-client)
 * - Builds a BufferGeometry from the worker's triangle-soup positions
 * - Parses `vt` UVs and attaches them as the 'uv' attribute
 * - Optionally parses MTL from text and patches texture paths BEFORE preload
 * - Optionally loads a texture (PNG/JPG) from a blob URL
 * - Auto-centers and scales the model to fit the viewport
 * - Shows a bounding box with axis colors (X red, Y green, Z blue)
 * - Orbit controls: drag to rotate, wheel to zoom, right-click to pan
 */
export function ObjViewer({
  objText,
  mtlText,
  textureBlobUrl,
  dims,
  rotationX,
  rotationY,
  rotationZ,
  scale,
  showSupport,
  onReady,
  onProgress,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const bboxHelperRef = useRef<THREE.Object3D | null>(null);
  const axisAnnotationRef = useRef<THREE.Group | null>(null);
  const frameIdRef = useRef<number | null>(null);
  // 支撑可视化组(包裹支撑:外壳 + 顶面 + 外壁 + 平台投影)
  const supportGroupRef = useRef<THREE.Group | null>(null);
  // 摆盘用的焊接模型(支撑几何的输入)——OBJ 解析时备一次,之后每个姿态只旋转
  const supportModelRef = useRef<SupportModel | null>(null);
  // 支撑开关(给异步的建模流程读)
  const showSupportRef = useRef(showSupport);
  showSupportRef.current = showSupport;
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
    if (!sceneRef.current) return;

    // Remove previous annotations
    if (axisAnnotationRef.current) {
      sceneRef.current.remove(axisAnnotationRef.current);
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

    sceneRef.current.add(group);
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
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

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
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!model || !camera || !controls) return;

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
    const scene = sceneRef.current;
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

    const scene = sceneRef.current;
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

        // 3. Materials - parse MTL if provided
        // FIX: patch map_kd texture path BEFORE preload() so the TextureLoader
        // resolves the blob URL when materials are constructed.
        let firstMaterial: THREE.Material | null = null;
        if (mtlText) {
          try {
            const mtlLoader = new MTLLoader();
            const creator = mtlLoader.parse(mtlText, "");

            // Patch texture paths BEFORE preload
            if (textureBlobUrl && creator.materialsInfo) {
              Object.values(creator.materialsInfo).forEach((info) => {
                if (info.map_kd !== undefined) {
                  info.map_kd = textureBlobUrl;
                }
              });
            }

            creator.preload();

            // Material brightness check: if RGB < 0.1 across all channels, set to 0xcccccc
            // This prevents invisible black meshes when the MTL specifies Ka/Kd of 0,0,0
            const materials = creator.materials;
            if (materials) {
              const matList = Object.values(materials);
              for (const mat of matList) {
                // MTLLoader 产出的是 MeshPhongMaterial（同样带 color 属性）
                const color = (mat as THREE.MeshPhongMaterial).color;
                if (color.r < 0.1 && color.g < 0.1 && color.b < 0.1) {
                  color.setHex(0xcccccc);
                  mat.needsUpdate = true;
                }
              }
              const first = matList[0];
              if (first) {
                firstMaterial = first;
              }
            }
          } catch (e) {
            console.warn("MTL parse failed, falling back:", e);
          }
        }

        if (cancelled) return;
        onProgressRef.current?.(92);
        await yieldToUI();

        // 4. Texture (fallback if no MTL, or to attach to a basic material)
        let texture: THREE.Texture | undefined;
        if (textureBlobUrl) {
          try {
            // 先尝试直接加载
            const texLoader = new THREE.TextureLoader();
            texture = await new Promise<THREE.Texture>((resolve, reject) => {
              texLoader.load(textureBlobUrl, resolve, undefined, reject);
            });
            texture.colorSpace = THREE.SRGBColorSpace;
            // 不设置 flipY，使用 three.js 默认值 flipY=true
            // 大多数 OBJ 导出器（Blender/ZBrush）的 UV 约定与 flipY=true 匹配
          } catch {
            // 直接加载失败，可能是 BMP 等不支持的格式，尝试用 Image + Canvas 转换
            try {
              const img = await new Promise<HTMLImageElement>(
                (resolve, reject) => {
                  const image = new Image();
                  image.onload = () => resolve(image);
                  image.onerror = reject;
                  image.src = textureBlobUrl;
                }
              );
              const canvas = document.createElement("canvas");
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                const pngUrl = canvas.toDataURL("image/png");
                const texLoader = new THREE.TextureLoader();
                texture = await new Promise<THREE.Texture>(
                  (resolve, reject) => {
                    texLoader.load(pngUrl, resolve, undefined, reject);
                  }
                );
                texture.colorSpace = THREE.SRGBColorSpace;
              }
            } catch (e2) {
              console.warn("Texture load failed (all methods):", e2);
            }
          }
        }

        if (cancelled) return;
        onProgressRef.current?.(95);
        await yieldToUI();

        // 5. Pick material: MTL > fallback standard with optional texture
        let material: THREE.Material;
        if (firstMaterial) {
          material = firstMaterial;
          // 如果 MTL 已加载了纹理，不需要额外设置 flipY
          if (texture) {
            const phongMat = material as THREE.MeshPhongMaterial;
            if (phongMat.isMeshPhongMaterial && !phongMat.map) {
              phongMat.map = texture;
              phongMat.needsUpdate = true;
            }
          }
        } else {
          material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.6,
            metalness: 0.05,
            map: texture ?? null,
          });
        }

        const mesh = new THREE.Mesh(geometry, material);
        const object = new THREE.Group();
        object.add(mesh);

        if (cancelled) return;

        // 6. Replace previous model
        const previous = modelRef.current;
        if (previous && sceneRef.current) {
          sceneRef.current.remove(previous);
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
        if (sceneRef.current) {
          sceneRef.current.add(object);
          fitCameraToModel();
        }

        // 7. 备一份焊接后的模型(支撑几何的输入)——焊接 + 拓扑是姿态无关的,
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
  }, [objText, mtlText, textureBlobUrl]);

  // Update axis annotations when dims change (without reloading the model)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在尺寸变化时刷新标注
  useEffect(() => {
    if (!modelRef.current || !sceneRef.current || !dims) return;
    updateBoundingBoxAndAnnotations();
  }, [dims]);

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

  // Scene setup (once)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 检测 WebGL 支持
    function checkWebGLSupport(): boolean {
      try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        return !!gl;
      } catch {
        return false;
      }
    }

    if (!checkWebGLSupport()) {
      setError(
        "当前浏览器环境不支持 WebGL，无法显示 3D 预览。请使用 Chrome/Edge 浏览器，或在浏览器设置中启用硬件加速。"
      );
      setLoading(false);
      onReadyRef.current?.();
      return;
    }

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f4); // stone-100
    sceneRef.current = scene;

    // Camera — Z-up 视角：相机从斜上方看，Z 轴朝上
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    camera.up.set(0, 0, 1); // Z 轴朝上
    camera.position.set(50, -50, 50); // 从 X+Y-Z+ 方向看
    cameraRef.current = camera;

    // Renderer — 包在 try-catch 中，防止沙箱环境创建失败导致白屏
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        failIfMajorPerformanceCaveat: false,
      });
    } catch (err) {
      console.error("WebGLRenderer creation failed:", err);
      setError(
        "WebGL 上下文创建失败，可能是沙箱环境限制。请尝试使用 Chrome/Edge 浏览器，或在本地部署运行。"
      );
      setLoading(false);
      onReadyRef.current?.();
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.localClippingEnabled = true; // 启用 clipping plane，支撑可视化需要
    // 画布的「显示尺寸」交给 CSS（100% 铺满容器）—— three.js 默认会把画布写成
    // 固定 px 宽高，容器变宽后画布不会跟着铺满，右侧会留一条空白。
    // 绘制缓冲区（分辨率）由下面的 syncSize() 同步，两者分开管。
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 容器尺寸 → 相机宽高比 + 绘制缓冲区尺寸
    let lastW = 0;
    let lastH = 0;
    const syncSize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false); // false = 不覆盖上面的 CSS 尺寸
    };
    syncSize();

    // Lights - enhanced for better visibility of resin prints
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);
    // HemisphereLight 0.6 (sky/ground gradient for natural look) — Z 轴朝上
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemi.position.set(0, 0, 50);
    scene.add(hemi);
    // DirectionalLight 1.2 (key) + 0.6 (fill)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(50, 50, 80);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-50, -50, 30);
    scene.add(fillLight);

    // Grid helper - 打印底板网格（放在 Z=0 平面上，因为 Z 是高度方向）
    const gridSize = Math.max(100, 200);
    const grid = new THREE.GridHelper(
      gridSize,
      gridSize / 10,
      0x999999,
      0xcccccc
    );
    // GridHelper 默认在 XZ 平面（Y=0），需要旋转到 XY 平面（Z=0）
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0;
    scene.add(grid);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Animation loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      syncSize(); // 兜底：容器尺寸变了但 ResizeObserver 没回调时也能跟上
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      syncSize();
    });
    resizeObserver.observe(container);

    return () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
      }
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      <div ref={containerRef} className="w-full h-full bg-stone-100" />
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
      {/* Hint */}
      <div className="absolute bottom-2 left-2 text-[10px] text-stone-500 bg-white/80 backdrop-blur-sm rounded px-2 py-1 border border-stone-200">
        拖拽旋转 · 滚轮缩放 · 右键平移
      </div>
    </div>
  );
}
