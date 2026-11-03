"use client";

import { type ReactNode, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  addPreviewLights,
  addPrintBedGrid,
  getPreviewStyle,
  type PreviewMode,
} from "./styles";

/**
 * 3D 预览容器 —— 克重工具与模型检查工具**共用同一个组件**。
 *
 * ## 它负责什么
 *
 * - WebGL renderer / scene / camera / OrbitControls 的创建与销毁
 * - 灯光、背景、打印底板网格(按 `mode`)
 * - 尺寸同步(ResizeObserver)与渲染循环
 * - WebGL 不可用时的兜底(回调 `onError`,由各工具决定怎么提示)
 *
 * ## 它不负责什么
 *
 * 模型本身(几何体 / 材质 / 问题色)由各工具构建,通过 `onSceneReady` 拿到
 * 场景上下文后挂进 `ctx.scene` —— 两个工具的模型数据来源完全不同
 * (克重工具读 OBJ 文本,检测工具读三角汤),硬塞进一个组件反而更绕。
 */

/** 场景上下文 —— 工具拿它往场景里挂自己的东西 */
export type PreviewContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
};

export type ObjPreviewProps = {
  /** 场景外观:`print-bed`(克重工具)或 `inspect`(模型检查工具) */
  mode: PreviewMode;
  className?: string | undefined;
  /** 场景就绪后调用一次 —— 工具在这里把自己的模型挂进去 */
  onSceneReady?: ((ctx: PreviewContext) => void) | undefined;
  /** 每帧调用 —— 聚焦动画等逐帧逻辑 */
  onFrame?: ((ctx: PreviewContext) => void) | undefined;
  /** WebGL 不可用 / 上下文创建失败 */
  onError?: ((message: string) => void) | undefined;
  /** 覆盖层(loading / error UI) */
  children?: ReactNode;
};

/** WebGL 是否可用 */
function checkWebGLSupport(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function ObjPreview({
  mode,
  className,
  onSceneReady,
  onFrame,
  onError,
  children,
}: ObjPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 回调放进 ref —— 免得父组件每次重建函数就把整个场景拆了重建
  const onSceneReadyRef = useRef(onSceneReady);
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  onSceneReadyRef.current = onSceneReady;
  onFrameRef.current = onFrame;
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const style = getPreviewStyle(mode);

    if (!checkWebGLSupport()) {
      onErrorRef.current?.(
        "当前浏览器环境不支持 WebGL，无法显示 3D 预览。请使用 Chrome/Edge 浏览器，或在浏览器设置中启用硬件加速。"
      );
      return;
    }

    // ---------- 场景 ----------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(style.background);

    // ---------- 相机(Z-up) ----------
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, style.cameraFar);
    camera.up.set(0, 0, 1);
    camera.position.set(...style.cameraPosition);

    // ---------- 渲染器 ----------
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      onErrorRef.current?.(
        "WebGL 上下文创建失败，可能是沙箱环境限制。请尝试使用 Chrome/Edge 浏览器，或在本地部署运行。"
      );
      return;
    }
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, style.maxPixelRatio)
    );
    renderer.localClippingEnabled = true; // 支撑可视化需要
    // 画布的「显示尺寸」交给 CSS(100% 铺满容器)——
    // three.js 默认会把画布写成固定 px 宽高,容器变宽后画布不会跟着铺满。
    // 绘制缓冲区(分辨率)由下面的 syncSize() 同步,两者分开管。
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    // ---------- 尺寸同步 ----------
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

    // ---------- 灯光 ----------
    addPreviewLights(scene, style);
    if (style.grid) addPrintBedGrid(scene);

    // ---------- 控制器 ----------
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = style.damping;
    controls.target.set(0, 0, 0);

    // ---------- 渲染循环 ----------
    let frameId: number | null = null;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      syncSize(); // 兜底:容器尺寸变了但 ResizeObserver 没回调时也能跟上
      controls.update();
      onFrameRef.current?.({ scene, camera, renderer, controls });
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => syncSize());
    resizeObserver.observe(container);

    const ctx: PreviewContext = { scene, camera, renderer, controls };
    onSceneReadyRef.current?.(ctx);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    // 场景随 `mode` 重建 —— 模式变了灯光 / 背景 / 底板网格都得跟着换
  }, [mode]);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      <div
        ref={containerRef}
        className={`w-full h-full ${getPreviewStyle(mode).canvasClass}`}
      />
      {children}
    </div>
  );
}
