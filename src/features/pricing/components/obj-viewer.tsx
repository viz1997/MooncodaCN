"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { parseObjInWorker } from "@/features/pricing/lib/obj-worker-client";

/**
 * 移植自 wjp-source-code/src/components/obj-viewer.tsx —— 耗材报价计算器的 3D 预览。
 *
 * 渲染逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）、去除 `any` 断言、Biome 格式化调整，
 * 未改变任何渲染行为。
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
  // Support shell mesh (semi-transparent shell around model)
  const supportShellRef = useRef<THREE.Mesh | null>(null);
  // Support fill mesh (bottom support columns, InstancedMesh)
  const supportFillRef = useRef<THREE.Object3D | null>(null);
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

  // 更新支撑可视化（PolyJet 多材料喷射全彩打印支撑模型）
  //
  // 核心改进：
  //   1. 外壳包裹层：基于「面法线」(非顶点法线) 沿法线方向外扩 1mm
  //      - 仅对 nz ≤ 0 的面进行包裹（侧面、悬垂面、朝下面）
  //      - 平顶朝上的面（nz > 0）不参与
  //      - 面法线外扩避免顶点法线在尖锐角处的自交问题
  //
  //   2. 底部填充：按模型 XY 投影轮廓生成 InstancedMesh（+1mm 膨胀）
  //      - 不再用方方正正的包围盒，跟随模型外轮廓
  const updateSupportShell = (show: boolean) => {
    // 移除旧的支撑可视化
    const oldShell = supportShellRef.current;
    if (oldShell) {
      oldShell.parent?.remove(oldShell);
      oldShell.geometry.dispose();
      const shellMat = oldShell.material;
      if (Array.isArray(shellMat)) {
        shellMat.forEach((m) => {
          m.dispose();
        });
      } else {
        shellMat.dispose();
      }
      supportShellRef.current = null;
    }
    const oldFill = supportFillRef.current;
    if (oldFill) {
      oldFill.parent?.remove(oldFill);
      oldFill.traverse((child) => {
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
      supportFillRef.current = null;
    }

    const scene = sceneRef.current;
    const model = modelRef.current;
    if (!show || !model || !scene) return;

    // 找到模型的 Mesh
    const meshes: THREE.Mesh[] = [];
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    const modelMesh = meshes[0];
    if (!modelMesh) return;
    const meshGeometry = modelMesh.geometry;
    if (!meshGeometry) return;

    if (!meshGeometry.attributes.normal) {
      meshGeometry.computeVertexNormals();
    }
    if (!meshGeometry.attributes.position) return;

    const posAttr = meshGeometry.attributes.position;
    const index = meshGeometry.index;

    // 获取模型世界矩阵（包含旋转/缩放/平移）
    const matrix = model.matrixWorld.clone();

    // 计算模型世界坐标包围盒
    const box2 = new THREE.Box3().setFromObject(model, true);
    if (box2.isEmpty()) return;
    const boxSize2 = box2.getSize(new THREE.Vector3());
    const zOffset = -box2.min.z; // 使底板位于 Z=0

    // 计算 wrapTopZ：接近模型顶部（仅留 1-2 层给模型本身的最终封顶层）
    // 与算法层 angle-optimizer.ts 的 computePolyJetSupport 保持一致
    // PolyJet 工艺：支撑逐层与模型同步沉积，打印完成时支撑延伸到接近模型顶部
    // 不存在「顶部 10% 不需要支撑」——只要还有悬垂或侧面需要包裹，支撑就跟着堆
    const TOP_RESERVE_LAYERS = 0.2; // 顶部预留 0.2mm（约 10 层，PolyJet 层厚 16-30μm）
    let wrapTopZ = Math.max(0, boxSize2.z - TOP_RESERVE_LAYERS);
    if (wrapTopZ < 1 && boxSize2.z > 0) wrapTopZ = Math.min(boxSize2.z, 1);

    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();
    const triCount = index
      ? Math.floor(index.count / 3)
      : Math.floor(posAttr.count / 3);

    // 收集下半部分（Z ≤ wrapTopZ）的所有面顶点，沿面法线外扩 1mm 形成壳层
    // PolyJet 工艺：整个下半部分都被支撑材料包裹（包括朝上的面，不只是悬垂面）
    const shellPositions: number[] = [];
    const shellNormals: number[] = [];
    const SHELL_THICKNESS = 1.0; // 1mm 外壳（与算法默认值对齐，用户可调）

    for (let t = 0; t < triCount; t++) {
      let i0: number;
      let i1: number;
      let i2: number;
      if (index) {
        i0 = index.getX(t * 3);
        i1 = index.getX(t * 3 + 1);
        i2 = index.getX(t * 3 + 2);
      } else {
        i0 = t * 3;
        i1 = t * 3 + 1;
        i2 = t * 3 + 2;
      }
      if (i0 >= posAttr.count || i1 >= posAttr.count || i2 >= posAttr.count) {
        continue;
      }

      v0.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)).applyMatrix4(
        matrix
      );
      v1.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)).applyMatrix4(
        matrix
      );
      v2.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)).applyMatrix4(
        matrix
      );

      // 跳过完全在 wrapTopZ 上方的面（顶部一小段不需要壳层）
      const faceMinZ = Math.min(v0.z, v1.z, v2.z) + zOffset;
      if (faceMinZ > wrapTopZ) continue;

      // 面法线（世界坐标）
      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      faceNormal.crossVectors(edge1, edge2).normalize();

      // 用户要求：
      //   1) 「模型法线正面只需要沿着表面覆盖，不需要和底下对称覆盖」
      //      → 所有朝下面（faceNormal.z < 0）都不生成薄壳
      //   2) 「不是悬垂薄壳，是一直有支撑下去」
      //      → 悬空朝下面下方的支撑由「填充柱」负责
      //
      // 规则：
      //   - faceNormal.z >= 0（朝上/侧面）：保留，沿法线外扩 1mm 形成表面薄壳
      //   - faceNormal.z < 0（所有朝下面，包括贴底板和悬空）：跳过
      if (faceNormal.z < -0.01) continue;

      // 沿面法线外扩 SHELL_THICKNESS 距离
      const offsetX = faceNormal.x * SHELL_THICKNESS;
      const offsetY = faceNormal.y * SHELL_THICKNESS;
      const offsetZ = faceNormal.z * SHELL_THICKNESS;

      shellPositions.push(
        v0.x + offsetX,
        v0.y + offsetY,
        v0.z + offsetZ,
        v1.x + offsetX,
        v1.y + offsetY,
        v1.z + offsetZ,
        v2.x + offsetX,
        v2.y + offsetY,
        v2.z + offsetZ
      );
      // 三角面 3 个顶点共享同一个面法线
      for (let k = 0; k < 3; k++) {
        shellNormals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      }
    }

    // 创建壳层 Mesh（使用标准 MeshStandardMaterial，比 ShaderMaterial 更可靠）
    if (shellPositions.length > 0) {
      const shellGeo = new THREE.BufferGeometry();
      shellGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(shellPositions, 3)
      );
      shellGeo.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(shellNormals, 3)
      );
      shellGeo.computeBoundingSphere();

      // 使用标准材质，透明度 0.65，琥珀色
      const shellMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.65,
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const shellMesh = new THREE.Mesh(shellGeo, shellMat);
      // 壳层顶点已在世界坐标，不跟随 Group 变换
      scene.add(shellMesh);
      supportShellRef.current = shellMesh;
    }

    // === 底部填充：水溶性支撑包裹式（按模型 XY 投影轮廓生成，非矩形包围盒）===
    // PolyJet 工艺物理现实：
    //   - 底部平整贴底板（Z=0）
    //   - 顶部跟随模型底面轮廓（不平整，反映模型下方空间形状）
    //   - 每个 XY cell 的支撑柱高度 = 该 cell 处模型「向下法线面」的最低 Z
    //
    // 关键修复（用户反馈「不要上下对称，最上面是不平整的」）：
    //   - 只统计「向下法线面」（faceNormal.z < 0）的 minZ
    //   - 这样 minZ 真正代表模型在该 cell 的「下方表面」Z
    //
    // 实现方式：
    //   1. 第一遍：栅格化所有面 → coveredGrid（标记投影内的 cell）
    //   2. 第二遍：栅格化向下法线面 → minZGrid（每个 cell 的模型底面 Z）
    //   3. 对每个被覆盖的 cell，生成一个支撑柱（柱底贴底板）
    const gridSize = 0.5; // 0.5mm 栅格精度（更精细，让圆形边界更圆润）
    const gridW = Math.ceil(boxSize2.x / gridSize) + 2;
    const gridH = Math.ceil(boxSize2.y / gridSize) + 2;
    const coveredGrid = new Uint8Array(gridW * gridH);
    const minZGrid = new Float32Array(gridW * gridH).fill(Infinity);
    // maxZGrid 记录每个 cell 处模型「向上法线面」的最高 Z（即模型顶面）
    // 用于生成「上方跟随模型形状」的支撑顶部（不平整）
    const maxZGrid = new Float32Array(gridW * gridH).fill(-Infinity);

    // 第一遍：栅格化所有面到 XY 投影（标记被覆盖的 cell + 记录 minZ / maxZ）
    for (let t = 0; t < triCount; t++) {
      let i0: number;
      let i1: number;
      let i2: number;
      if (index) {
        i0 = index.getX(t * 3);
        i1 = index.getX(t * 3 + 1);
        i2 = index.getX(t * 3 + 2);
      } else {
        i0 = t * 3;
        i1 = t * 3 + 1;
        i2 = t * 3 + 2;
      }
      if (i0 >= posAttr.count || i1 >= posAttr.count || i2 >= posAttr.count) {
        continue;
      }
      v0.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)).applyMatrix4(
        matrix
      );
      v1.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)).applyMatrix4(
        matrix
      );
      v2.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)).applyMatrix4(
        matrix
      );

      const ax = v0.x - box2.min.x;
      const ay = v0.y - box2.min.y;
      const bx = v1.x - box2.min.x;
      const by = v1.y - box2.min.y;
      const cx = v2.x - box2.min.x;
      const cy = v2.y - box2.min.y;
      const txMin = Math.max(0, Math.floor(Math.min(ax, bx, cx) / gridSize));
      const txMax = Math.min(
        gridW - 1,
        Math.floor(Math.max(ax, bx, cx) / gridSize)
      );
      const tyMin = Math.max(0, Math.floor(Math.min(ay, by, cy) / gridSize));
      const tyMax = Math.min(
        gridH - 1,
        Math.floor(Math.max(ay, by, cy) / gridSize)
      );
      if (txMin > txMax || tyMin > tyMax) continue;
      // 计算面法线（仅用于判断朝向）
      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      faceNormal.crossVectors(edge1, edge2).normalize();
      const faceMinZWorld = Math.min(v0.z, v1.z, v2.z) + zOffset;
      const faceMaxZWorld = Math.max(v0.z, v1.z, v2.z) + zOffset;

      for (let gy = tyMin; gy <= tyMax; gy++) {
        for (let gx = txMin; gx <= txMax; gx++) {
          const px = (gx + 0.5) * gridSize;
          const py = (gy + 0.5) * gridSize;
          const w0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
          const w1 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
          const w2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
          if (
            (w0 >= 0 && w1 >= 0 && w2 >= 0) ||
            (w0 <= 0 && w1 <= 0 && w2 <= 0)
          ) {
            const cellIdx = gy * gridW + gx;
            coveredGrid[cellIdx] = 1;
            // 仅向下法线面参与 minZ 更新（模型底面）
            if (faceNormal.z < -0.01) {
              if (faceMinZWorld < minZGrid[cellIdx]!) {
                minZGrid[cellIdx] = faceMinZWorld;
              }
            }
            // 仅向上法线面参与 maxZ 更新（模型顶面）
            if (faceNormal.z > 0.01) {
              if (faceMaxZWorld > maxZGrid[cellIdx]!) {
                maxZGrid[cellIdx] = faceMaxZWorld;
              }
            }
          }
        }
      }
    }

    // === 膨胀覆盖区域：真正的圆形扩展（distance field）===
    //   - 用真正的圆形 distance field：每个 cell 计算到最近原始 cell 的欧几里得距离
    //   - 距离 ≤ R 才标记为覆盖
    //   - 配合 0.5mm 栅格精度（gridSize=0.5）让边界更精细
    const DILATE_RADIUS_MM = 8; // 8mm 扩展半径（毫米）
    const dilatedGrid = new Uint8Array(gridW * gridH);
    const dilatedMinZ = new Float32Array(gridW * gridH).fill(Infinity);
    const dilatedMaxZ = new Float32Array(gridW * gridH).fill(-Infinity);
    // 先复制原始 cell
    for (let i = 0; i < coveredGrid.length; i++) {
      if (coveredGrid[i]) {
        dilatedGrid[i] = 1;
        dilatedMinZ[i] = minZGrid[i]!;
        dilatedMaxZ[i] = maxZGrid[i]!;
      }
    }
    // 对每个非原始 cell，搜索最近的原始 cell，距离 ≤ R 则标记
    const Rcells = Math.ceil(DILATE_RADIUS_MM / gridSize);
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (coveredGrid[idx]) continue;
        // 在半径 Rcells 内搜索最近的原始 cell
        let bestDist = Infinity;
        let bestMinZ = 0;
        let bestMaxZ = wrapTopZ;
        for (let dy = -Rcells; dy <= Rcells; dy++) {
          for (let dx = -Rcells; dx <= Rcells; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (!coveredGrid[nIdx]) continue;
            // 欧几里得距离（mm）
            const dist = Math.sqrt(dx * dx + dy * dy) * gridSize;
            if (dist > DILATE_RADIUS_MM) continue;
            if (dist < bestDist) {
              bestDist = dist;
              bestMinZ = minZGrid[nIdx]!;
              bestMaxZ = maxZGrid[nIdx]!;
            }
          }
        }
        if (bestDist < Infinity) {
          dilatedGrid[idx] = 1;
          dilatedMinZ[idx] = bestMinZ;
          dilatedMaxZ[idx] = bestMaxZ;
        }
      }
    }
    for (let i = 0; i < coveredGrid.length; i++) {
      coveredGrid[i] = dilatedGrid[i]!;
      minZGrid[i] = dilatedMinZ[i] === Infinity ? 0 : dilatedMinZ[i]!;
      maxZGrid[i] = dilatedMaxZ[i] === -Infinity ? wrapTopZ : dilatedMaxZ[i]!;
    }

    // === 平滑 maxZGrid / minZGrid（消除锯齿，让顶部和底部圆润）===
    const SMOOTH_ITER = 8; // 增加到 8 次迭代
    const SMOOTH_RADIUS = 3; // 7x7 邻域（扩大范围让过渡更圆润）
    for (let iter = 0; iter < SMOOTH_ITER; iter++) {
      const prevMax = new Float32Array(maxZGrid);
      const prevMin = new Float32Array(minZGrid);
      for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          const idx = gy * gridW + gx;
          if (!coveredGrid[idx]) continue;
          let sumWMax = 0;
          let sumMax = 0;
          let sumWMin = 0;
          let sumMin = 0;
          for (let dy = -SMOOTH_RADIUS; dy <= SMOOTH_RADIUS; dy++) {
            for (let dx = -SMOOTH_RADIUS; dx <= SMOOTH_RADIUS; dx++) {
              const nx = gx + dx;
              const ny = gy + dy;
              if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
              const nIdx = ny * gridW + nx;
              if (!coveredGrid[nIdx]) continue;
              const distSq = dx * dx + dy * dy;
              // 高斯衰减（σ更大让更多邻域参与）
              const w = Math.exp(-distSq / 6);
              sumWMax += w;
              sumMax += prevMax[nIdx]! * w;
              sumWMin += w;
              sumMin += prevMin[nIdx]! * w;
            }
          }
          if (sumWMax > 0) maxZGrid[idx] = sumMax / sumWMax;
          if (sumWMin > 0) minZGrid[idx] = sumMin / sumWMin;
        }
      }
    }

    // 收集被覆盖的单元
    // 用户要求「上方依然保持模型的形状」：
    //   - 每个 cell 的支撑柱从 Z=0 填到 maxZ[cell]
    //   - maxZ[cell] = 该 cell 处模型「向上法线面」的最高 Z（即模型顶面）
    //   - 这样支撑顶部跟随模型顶面形状（不平整，跟随模型上表面）
    const coveredCells: { x: number; y: number; h: number; z: number }[] = [];
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (coveredGrid[idx]) {
          // 高度 = maxZ（模型顶面 Z，确保覆盖整个模型）
          // 位置 z = h/2（柱底贴底板）
          const h = Math.max(0.5, maxZGrid[idx]!); // 至少 0.5mm 高度，避免 0 高度柱
          coveredCells.push({ x: gx, y: gy, h, z: h / 2 });
        }
      }
    }

    if (coveredCells.length > 0) {
      // 使用标准 MeshStandardMaterial（避免 shader 编译失败导致不可见）
      // 透明度 0.4，琥珀色，让支撑清晰可见
      const fillMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.4,
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      // 单元几何：1mm × 1mm × 1mm 单位立方体，通过 InstancedMesh 的 scale 实现不同高度
      const cellGeo = new THREE.BoxGeometry(
        gridSize * 0.98,
        gridSize * 0.98,
        1.0
      );
      const inst = new THREE.InstancedMesh(
        cellGeo,
        fillMat,
        coveredCells.length
      );
      const dummy = new THREE.Object3D();
      for (let i = 0; i < coveredCells.length; i++) {
        const c = coveredCells[i]!;
        // 柱底贴底板（Z=0），柱高 = c.h（= maxZ[cell] = 模型顶面 Z）
        dummy.position.set(
          box2.min.x + c.x * gridSize + gridSize / 2,
          box2.min.y + c.y * gridSize + gridSize / 2,
          box2.min.z + c.z // 柱中心位于 c.z = c.h/2，柱底自然贴底板
        );
        // 沿 Z 轴缩放到目标高度
        dummy.scale.set(1, 1, c.h);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
      supportFillRef.current = inst;
    }
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
