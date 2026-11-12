"use client";

/**
 * 移植自 wjp-source-code/src/components/obj-thumbnail.tsx —— 耗材报价计算器的模型正面照。
 *
 * 渲染逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何渲染行为。
 *
 * **2026-11-12:改成深色** —— 这张缩略图只摆在工作台的**深色头部**里
 * （`pricing-calculator.tsx` 的 `modelHeader`）。原来它是浅灰背景（`0xfafaf9`）
 * + 浅色边框，在一片深色里就是一个刺眼的白方块 —— 整页「一张脸」的
 * 原则在这里破了。现在跟侧栏的卡片一样是 `zinc-900`。
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";

type Props = {
  objText: string;
  size?: number;
  className?: string | undefined;
};

/**
 * 模型正面照缩略图
 *
 * 从模型正前方拍摄一张「证件照」风格的 3D 预览：
 *   - 相机在模型正前方（Y 方向），水平视角
 *   - Z-up 坐标系（Z 朝上）
 *   - 高亮灯光 + 暖色材质
 *   - 静态渲染一帧，无动画循环
 */
export function ObjThumbnail({ objText, size = 80, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !objText) return;

    const w = size;
    const h = size;

    // Scene
    const scene = new THREE.Scene();
    // 深色背景（zinc-900）—— 摆在深色头部里，不能是个白方块
    scene.background = new THREE.Color(0x18181b);

    // Camera — 正前方视角（从 -Y 方向看向模型，Z 朝上）
    const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 10000);
    camera.up.set(0, 0, 1); // Z-up

    // Renderer
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 充足的灯光
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(0, -100, 50); // 从正前方+上方打光
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-50, -50, 0); // 左侧补光
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffeedd, 0.5);
    rimLight.position.set(50, 50, 30); // 右侧轮廓光
    scene.add(rimLight);

    // 解析 OBJ（内联解析，缩略图只需要粗略几何）
    try {
      const lines = objText.split(/\r?\n/);
      const vertices: number[] = [];
      const faces: { v: number[] }[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("v ")) {
          const parts = trimmed.substring(2).trim().split(/\s+/);
          vertices.push(parseFloat(parts[0] ?? "") || 0);
          vertices.push(parseFloat(parts[1] ?? "") || 0);
          vertices.push(parseFloat(parts[2] ?? "") || 0);
        } else if (trimmed.startsWith("f ")) {
          const tokens = trimmed.substring(2).trim().split(/\s+/);
          const vIdx: number[] = [];
          for (const tok of tokens) {
            const slashIdx = tok.indexOf("/");
            const vi =
              slashIdx >= 0
                ? parseInt(tok.substring(0, slashIdx), 10)
                : parseInt(tok, 10);
            if (vi > 0) vIdx.push(vi - 1);
            else if (vi < 0) vIdx.push(vertices.length / 3 + vi);
          }
          if (vIdx.length >= 3) faces.push({ v: vIdx });
        }
      }

      if (vertices.length === 0 || faces.length === 0) return;

      // 构建 triangle-soup positions
      const positions = new Float32Array(faces.length * 9);
      let posIdx = 0;
      for (const f of faces) {
        for (let j = 1; j < f.v.length - 1; j++) {
          const a0 = f.v[0]! * 3;
          const a1 = f.v[j]! * 3;
          const a2 = f.v[j + 1]! * 3;
          if (
            a0 + 2 >= vertices.length ||
            a1 + 2 >= vertices.length ||
            a2 + 2 >= vertices.length
          ) {
            continue;
          }
          positions[posIdx++] = vertices[a0]!;
          positions[posIdx++] = vertices[a0 + 1]!;
          positions[posIdx++] = vertices[a0 + 2]!;
          positions[posIdx++] = vertices[a1]!;
          positions[posIdx++] = vertices[a1 + 1]!;
          positions[posIdx++] = vertices[a1 + 2]!;
          positions[posIdx++] = vertices[a2]!;
          positions[posIdx++] = vertices[a2 + 1]!;
          positions[posIdx++] = vertices[a2 + 2]!;
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions.subarray(0, posIdx), 3)
      );
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();

      // 暖色材质，类似树脂打印件的质感
      const material = new THREE.MeshStandardMaterial({
        color: 0xd4b896, // 暖米色（类似树脂件）
        roughness: 0.5,
        metalness: 0.0,
        flatShading: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      const group = new THREE.Group();
      group.add(mesh);
      scene.add(group);

      // 计算包围盒并定位模型
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty()) return;

      const size3 = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size3.x, size3.y, size3.z, 0.001);

      // 归一化缩放到 ~50 单位
      const scale = 50 / maxDim;
      group.scale.set(scale, scale, scale);

      // 把模型中心移到原点（水平居中 + 垂直居中）
      group.position.x = -center.x * scale;
      group.position.y = -center.y * scale;
      group.position.z = -box.min.z * scale; // 底部贴 Z=0

      // 相机正前方视角：从 -Y 方向看
      // 计算缩放后的模型高度和宽度
      const scaledH = size3.z * scale; // 高度
      const scaledW = Math.max(size3.x, size3.y) * scale; // 最大水平尺寸
      const camDist =
        Math.max(
          scaledW / (2 * Math.tan((camera.fov * Math.PI) / 180 / 2)),
          scaledH / (2 * Math.tan((camera.fov * Math.PI) / 180 / 2))
        ) *
        // 2.5 是源实现的留白 —— 模型只占画面的四成,缩略图里几乎看不清。
        // 1.8 让它填满大部分画面(留一点边,免得贴边被切)。
        1.8;
      camera.position.set(0, -camDist, scaledH * 0.45); // 正前方，略偏上看向模型中心
      camera.lookAt(0, 0, scaledH * 0.45);

      // 渲染
      renderer.render(scene, camera);
    } catch (err) {
      console.error("Thumbnail render failed:", err);
    }

    return () => {
      renderer?.dispose();
      if (renderer?.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [objText, size]);

  return (
    <div
      ref={containerRef}
      className={`rounded-md border border-zinc-800 overflow-hidden shrink-0 bg-zinc-900 ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
