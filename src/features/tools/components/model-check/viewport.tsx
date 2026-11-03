"use client";

/**
 * 3D 视口:Z-up(打印方向),网格按问题类型着色,问题边高亮,支持聚焦动画与悬停提示。
 *
 * 移植自 wjp-model-checker-source/src/components/model-checker/Viewport.tsx,
 * 只改了 import 路径与悬停提示文案(改为 next-intl)。
 *
 * 2026-11-03:场景本身(renderer / camera / 灯光 / 控制器 / 渲染循环)交给共用的
 * `<ObjPreview mode="inspect" />` —— 与克重工具(/tools/weight)是同一个组件,
 * 两个工具的模型观感、贴图表现完全一致。
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  parseMtl,
  type TextureUrlMap,
} from "@/features/pricing/lib/obj-materials";
import {
  addMaterialGroups,
  buildPreviewMaterials,
} from "@/features/shared/components/obj-preview/materials";
import {
  ObjPreview,
  type PreviewContext,
} from "@/features/shared/components/obj-preview/obj-preview";
import {
  type AnalysisResult,
  FACE_FLAG,
  ISSUE_COLORS,
  SHELL_COLORS,
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

interface ViewportProps {
  result: AnalysisResult | null;
  /** 三角汤坐标(主线程持有),9 floats per triangle */
  meshPositions: Float32Array | null;
  /** 贴图与材质分组(没有贴图的模型传 null) */
  textures: MeshTextureInfo | null;
  /** 是否显示贴图(用户可在图例栏切换) */
  showTexture: boolean;
  visibility: ViewportVisibility;
  /** 是否显示包裹支撑外壳(WJP 水溶性支撑示意) */
  showSupport: boolean;
  /** 聚焦请求:带递增序号,触发相机飞往该点 */
  focusRequest: {
    seq: number;
    point: [number, number, number] | null;
    radius?: number;
    dir?: [number, number, number];
  } | null;
  /** 重置视角信号 */
  fitSignal: number;
}

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

export default function Viewport({
  result,
  meshPositions,
  textures,
  showTexture,
  visibility,
  showSupport,
  focusRequest,
  fitSignal,
}: ViewportProps) {
  const t = useTranslations("ModelInspector");
  const tooltipRef = useRef<HTMLDivElement>(null);
  /** 预览场景上下文 —— <ObjPreview> 建好场景后交给我们 */
  const [previewCtx, setPreviewCtx] = useState<PreviewContext | null>(null);
  const ctxRef = useRef<PreviewContext | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const supportRef = useRef<THREE.Mesh | null>(null);
  const supportProjRef = useRef<THREE.Mesh | null>(null);
  const supportCurtainRef = useRef<THREE.Mesh | null>(null);
  const supportUnderRef = useRef<THREE.Mesh | null>(null);
  /** 模型组:承载模型+支撑+问题边线,整体平移使模型最低点贴住平台(z=0) */
  const groupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const lineRefs = useRef<Record<string, THREE.LineSegments | null>>({});
  const focusAnimRef = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    start: number;
  } | null>(null);
  const visibilityRef = useRef(visibility);
  const showSupportRef = useRef(showSupport);
  const showTextureRef = useRef(showTexture);
  const resultRef = useRef(result);
  /** 每个材质槽位有没有贴图(重着色时决定干净面用白色还是灰色) */
  const slotHasMapRef = useRef<boolean[]>([]);
  /** 悬停提示文案(事件回调只读 ref,避免每次 pointermove 都跑一遍翻译) */
  const tooltipTextsRef = useRef<Record<string, string>>({});

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
    showTextureRef.current = showTexture;
  }, [showTexture]);
  useEffect(() => {
    showSupportRef.current = showSupport;
    if (supportRef.current) supportRef.current.visible = showSupport;
    if (supportProjRef.current) supportProjRef.current.visible = showSupport;
    if (supportCurtainRef.current)
      supportCurtainRef.current.visible = showSupport;
    if (supportUnderRef.current) supportUnderRef.current.visible = showSupport;
  }, [showSupport]);
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
    const r = resultRef.current;
    if (!ctx) return;
    const { camera, controls } = ctx;
    let min = new THREE.Vector3(-10, -10, 0);
    let max = new THREE.Vector3(10, 10, 10);
    if (r) {
      // 模型组已整体平移落地(最低点贴住 z=0 平台),取景范围按落地后坐标计算
      const dz = r.stats.bboxMin[2];
      min = new THREE.Vector3(r.stats.bboxMin[0], r.stats.bboxMin[1], 0);
      max = new THREE.Vector3(
        r.stats.bboxMax[0],
        r.stats.bboxMax[1],
        r.stats.bboxMax[2] - dz
      );
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const diag = min.distanceTo(max) || 20;
    camera.near = Math.max(0.01, diag / 1000);
    camera.far = diag * 100;
    camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(1, -1.15, 0.85).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(diag * 1.7));
    controls.target.copy(center);
    controls.update();
  }, []);

  // ---------- 结果变化 → 重建几何 ----------
  useEffect(() => {
    const ctx = previewCtx;
    if (!ctx) return;
    const scene = ctx.scene;
    // 清理旧对象(全部挂在模型组下,随组一起移除)
    if (groupRef.current) {
      scene.remove(groupRef.current);
      for (const o of [
        meshRef.current,
        supportRef.current,
        supportProjRef.current,
        supportCurtainRef.current,
        supportUnderRef.current,
      ]) {
        if (o) {
          o.geometry.dispose();
          // 多材质模型:material 是数组
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.dispose();
        }
      }
      meshRef.current = null;
      supportRef.current = null;
      supportProjRef.current = null;
      supportCurtainRef.current = null;
      supportUnderRef.current = null;
      for (const key of Object.keys(lineRefs.current)) {
        const lines = lineRefs.current[key];
        if (lines) {
          lines.geometry.dispose();
          (lines.material as THREE.Material).dispose();
        }
        lineRefs.current[key] = null;
      }
      groupRef.current = null;
    }
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.traverse((o) => {
        if (o instanceof THREE.GridHelper || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      gridRef.current = null;
    }
    if (!result) return;
    const {
      flags,
      faceComponent,
      openEdges,
      nonManifoldEdges,
      planarHoleEdges,
      stats,
    } = result;
    if (!meshPositions) return;

    // 面几何(非索引,便于按面着色)
    const triCount = stats.triangleCount;
    const positions = new Float32Array(triCount * 9);
    const colors = new Float32Array(triCount * 9);
    const color = new THREE.Color();
    positions.set(
      meshPositions.subarray(0, Math.min(meshPositions.length, triCount * 9))
    );
    const vis = visibilityRef.current;
    // 有真实问题面时才压暗其余面(有问题才需要显示)
    const dimBase = hasVisibleFaceIssues(stats, vis);

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
    const diag = Math.hypot(
      stats.bboxMax[0] - stats.bboxMin[0],
      stats.bboxMax[1] - stats.bboxMin[1],
      stats.bboxMax[2] - stats.bboxMin[2]
    );
    // 模型组:整体平移使包围盒最低点贴住打印平台(世界 z=0,与网格地面重合),
    // 模型不再悬空于网格上方
    const group = new THREE.Group();
    group.position.z = -bb.min.z;
    scene.add(group);
    groupRef.current = group;

    if (slots.length > 0) {
      // 材质分组:把三角汤按材质切成连续段(非索引几何,group 的 start/count 是顶点数)
      if (materialIndex && materialIndex.length > 0) {
        addMaterialGroups(geo, materialIndex);
      } else {
        geo.addGroup(0, triCount * 3, 0);
      }
    }
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
      roughness: 0.75,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(
      geo,
      slots.length > 0 ? slots : (single ?? mat)
    );
    group.add(mesh);
    meshRef.current = mesh;

    // 包裹支撑(WJP 水溶性支撑示意):外壳 + 支撑体(顶面 / 侧壁 / 平台投影)。
    // WJP 逐层喷射不存在悬空:平台到模型之间全部为支撑材料,三者共同围合支撑体积。
    const shell = result.supportShell;
    if (shell && shell.positions.length >= 9) {
      // 平台平面(模型组局部坐标):由 worker 生成外壳时一并给出,
      // 跟克重工具算支撑体积用的是同一个基准(2026-11-02)
      const groundZ = shell.groundZ;

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
        supportRef.current = shellMesh;
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
        supportUnderRef.current = underMesh;
      }

      // ③ 平台投影 / 占地区域:全部面片沿 Z 压平到平台平面(略低于网格地面避免深度冲突);
      // 用 MAX 混合方程,重叠三角形不叠加变亮,网格线亮于填充色仍可透出
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
      supportProjRef.current = projMesh;

      // ④ 支撑体外壁(绿):下朝向区域边界边竖直向下挤出至平台
      if (shell.curtain.length >= 9) {
        const cg = new THREE.BufferGeometry();
        cg.setAttribute(
          "position",
          new THREE.BufferAttribute(shell.curtain, 3)
        );
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
        supportCurtainRef.current = curtainMesh;
      }
    }

    // 问题边线
    const makeLines = (
      data: Float32Array,
      hex: string,
      visible: boolean,
      opts?: { opacity?: number; depthTest?: boolean }
    ) => {
      if (data.length === 0) return null;
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
      group.add(lines);
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
    scene.add(gridGroup);
    gridRef.current = gridGroup;

    // 视角适配
    fitCamera();
  }, [previewCtx, result, meshPositions, textures, fitCamera]);

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
    if (!ctx) return;
    const { camera, controls } = ctx;
    const target = new THREE.Vector3(...focusRequest.point);
    // 聚焦点是模型原始坐标,同步落地平移(模型组整体 -bboxMin.z)
    const rr = resultRef.current;
    if (rr) target.z -= rr.stats.bboxMin[2];
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
