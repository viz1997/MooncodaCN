"use client";

/**
 * 模型检查用的 3D 预览 —— 三角形汤直接喂 three.js,不做二次解析。
 *
 * 和克重计算器里的 `ObjViewer` 的区别:
 *  - ObjViewer 自己解析 OBJ(为了拿 UV / MTL),这里拿的是已经解析好的
 *    `positions` —— 同一个文件不必解析两遍;
 *  - 这里**支持按三角形上色**:检查出的问题面(破面 / 过薄 / 悬空)染成红色,
 *    其余保持本色,一眼看出问题在哪。
 *
 * 相机取景用包围球半径 + 水平/垂直两个 FOV 一起算,保证长条形模型也不会
 * 顶出画面。
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type MeshPreviewProps = {
  /** 三角形汤,9 float / 三角形 */
  positions: Float32Array;
  /** 每个三角形的问题位掩码(见 mesh-analysis 的 ISSUE_FLAGS) */
  faceFlags?: Uint8Array | undefined;
  /** 要染成红色的位掩码 —— 多个 bit 用 | 组合 */
  highlightMask?: number | undefined;
  className?: string | undefined;
};

/** 问题面的颜色 —— 琥珀偏红,和页面暖色调一致 */
const HIGHLIGHT_COLOR = new THREE.Color(0xdc2626);
/** 正常面的颜色 —— 浅灰,让红色跳出来 */
const BASE_COLOR = new THREE.Color(0xd6d3d1);

export function MeshPreview({
  positions,
  faceFlags,
  highlightMask,
  className,
}: MeshPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  // ---- 建场景(只跑一次) ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(0, 0, 120);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xffffff, 1.6);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 1.2, 1.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1.2, -0.6, 0.8);
    scene.add(fill);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      if (frameIdRef.current !== null) cancelAnimationFrame(frameIdRef.current);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  // ---- 换模型 / 换高亮 ----
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    if (positions.length === 0) return;

    const triangleCount = Math.floor(positions.length / 9);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions.slice(), 3)
    );

    // 面级颜色:命中高亮位的三角形整面染红
    const colors = new Float32Array(triangleCount * 9);
    for (let t = 0; t < triangleCount; t++) {
      const flags = faceFlags?.[t] ?? 0;
      const hit =
        highlightMask !== undefined &&
        highlightMask !== 0 &&
        (flags & highlightMask) !== 0;
      const color = hit ? HIGHLIGHT_COLOR : BASE_COLOR;
      for (let v = 0; v < 3; v++) {
        const o = (t * 3 + v) * 3;
        colors[o] = color.r;
        colors[o + 1] = color.g;
        colors[o + 2] = color.b;
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.04,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);

    const previous = meshRef.current;
    if (previous) {
      scene.remove(previous);
      previous.geometry.dispose();
      (previous.material as THREE.Material).dispose();
    }
    meshRef.current = mesh;
    scene.add(mesh);

    // 取景:包围球半径 + 水平/垂直 FOV
    const sphere = geometry.boundingSphere;
    if (sphere) {
      const radius = Math.max(sphere.radius, 1e-3);
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.15;
      // 相机放在斜前上方 —— 正对着看只能看到一个面,看不出模型长什么样,
      // 也看不出哪一面缺了、哪些面朝下(悬空)。三分之四视角是判断
      // 「能不能印」最常用的角度。
      const dir = new THREE.Vector3(1, 0.75, 1).normalize();
      camera.position.copy(sphere.center).addScaledVector(dir, distance);
      camera.near = Math.max(distance / 1000, 0.05);
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      camera.lookAt(sphere.center);
      const controls = controlsRef.current;
      if (controls) {
        controls.target.copy(sphere.center);
        controls.update();
      }
    }
  }, [positions, faceFlags, highlightMask]);

  return (
    <div
      ref={containerRef}
      className={
        className ?? "h-full w-full overflow-hidden rounded-lg bg-white"
      }
    />
  );
}
