// @ts-nocheck

/**
 * 画布 Meshy Image-to-3D 节点（2026-09-15）
 *
 * 注册一个内置插件节点类型 "meshy-3d:model3d"，由 convertImageTo3D handler
 * 创建，对应一个 GLB 模型查看器节点。
 *
 * 实现选择：使用 Google `<model-viewer>` web component 而非自己写 Three.js：
 * - 零 npm 依赖：通过 CDN 动态注入 script（仅首次加载时）
 * - 内建 OrbitControls + 环境光照，GLB 渲染开箱即用
 * - 与画布一起用 iframe-free 渲染（model-viewer 是 web component + shadow DOM）
 *
 * 与 builtin-nodes.tsx 镜像：registerMeshy3DNodes() 一次性注册，
 * 由 project-editor.tsx 在初始化阶段调用一次。
 */

import { Box, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import i18n from "@/features/canvas/i18n";
import { registerNodeDefinitions } from "@/features/canvas/lib/canvas/node-registry";
import type {
  CanvasNodeContext,
  CanvasNodeDefinition,
} from "@/features/canvas/types/canvas-plugin";

// ───────────────────────────────────────────────────────────────────────────
// 类型
// ───────────────────────────────────────────────────────────────────────────

type MeshyNodeMetadata = {
  status?: "loading" | "success" | "failed";
  modelUrl?: string;
  jobId?: string;
  errorMessage?: string;
  /**
   * 单图模式（image-to-3d）的源图 URL。
   * 多图模式（multi-image-to-3d）保留此字段并存第一张图 URL，作为
   * back-compat fallback；新读取应优先用 sourceImageUrls。
   */
  sourceImageUrl?: string;
  /**
   * 2026-09-16：多图模式源图 URL 数组。首张为主视图（正面）。
   * 旧数据若无此字段，Content 自动回退到 [sourceImageUrl]。
   */
  sourceImageUrls?: string[];
  /** 2026-09-16：多图模式上游 source node ids（用于 Content 展示/排查） */
  sourceNodeIds?: string[];
  /** 2026-09-16：多图模式主视图对应的 source node id */
  primarySourceNodeId?: string;
};

// ───────────────────────────────────────────────────────────────────────────
// 动态加载 model-viewer
// ───────────────────────────────────────────────────────────────────────────

const MODEL_VIEWER_SCRIPT_URL =
  "https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js";

let modelViewerLoadPromise: Promise<void> | null = null;

function ensureModelViewerLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // model-viewer 注入 <script> 后会自动定义 customElements "model-viewer"
  if (customElementsAlreadyDefined()) return Promise.resolve();
  if (modelViewerLoadPromise) return modelViewerLoadPromise;
  modelViewerLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-model-viewer="true"]`);
    if (existing) {
      // 已存在（重复触发）—— 监听 load 事件
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("model-viewer script load failed")),
        { once: true }
      );
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = MODEL_VIEWER_SCRIPT_URL;
    script.dataset.modelViewer = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("model-viewer script load failed")),
      { once: true }
    );
    document.head.appendChild(script);
  });
  return modelViewerLoadPromise;
}

function customElementsAlreadyDefined(): boolean {
  return (
    typeof window !== "undefined" &&
    "customElements" in window &&
    Boolean(window.customElements.get?.("model-viewer"))
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Content 组件
// ───────────────────────────────────────────────────────────────────────────

function MeshyModel3DContent({ ctx }: { ctx: CanvasNodeContext }) {
  const metadata = (ctx.node.metadata ?? {}) as MeshyNodeMetadata;
  const status = metadata.status ?? "loading";
  const modelUrl = metadata.modelUrl;
  const errorMessage = metadata.errorMessage;
  const containerRef = useRef<HTMLDivElement>(null);
  const [modelViewerReady, setModelViewerReady] = useState(
    customElementsAlreadyDefined()
  );

  useEffect(() => {
    if (status !== "success" || !modelUrl) return;
    if (modelViewerReady) return;
    let cancelled = false;
    void ensureModelViewerLoaded().then(() => {
      if (!cancelled) setModelViewerReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [status, modelUrl, modelViewerReady]);

  // loading 状态：spinner + 文案
  if (status === "loading" || !modelUrl) {
    return (
      <div
        ref={containerRef}
        className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/30"
      >
        <Loader2 className="size-6 animate-spin text-purple-500" />
        <span className="text-xs text-muted-foreground">
          {i18n.t("canvas.meshy3d.generating")}
        </span>
        {metadata.jobId ? (
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {metadata.jobId}
          </span>
        ) : null}
      </div>
    );
  }

  // failed 状态：错误 + 重试按钮
  if (status === "failed") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-destructive/5 p-3 text-center">
        <span className="text-xs text-destructive">
          {errorMessage ?? i18n.t("canvas.meshy3d.failed")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {i18n.t("canvas.meshy3d.creditsRefunded")}
        </span>
      </div>
    );
  }

  // success 状态：model-viewer
  if (!modelViewerReady) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/30">
        <Loader2 className="size-5 animate-spin text-purple-500" />
      </div>
    );
  }

  // 用 React.createElement 避免引入 JSX（项目混用 .tsx/.ts，但本文件可用 JSX）
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-gradient-to-br from-purple-50 to-blue-50"
    >
      {/* @ts-expect-error model-viewer 是 custom element，未在 JSX.IntrinsicElements 声明 */}
      <model-viewer
        src={modelUrl}
        alt={i18n.t("canvas.meshy3d.modelAlt")}
        camera-controls
        auto-rotate
        auto-rotate-delay="2000"
        rotation-per-second="18deg"
        shadow-intensity="1"
        exposure="0.9"
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 注册函数
// ───────────────────────────────────────────────────────────────────────────

let registered = false;

export function registerMeshy3DNodes() {
  if (registered) return;
  registered = true;

  const def: CanvasNodeDefinition = {
    type: "meshy-3d:model3d",
    title: i18n.t("canvas.meshy3d.nodeTitle"),
    icon: <Box className="size-5" />,
    description: i18n.t("canvas.meshy3d.nodeDescription"),
    defaultSize: { width: 360, height: 320 },
    minimapColor: "#8b5cf6",
    showInCreateMenu: false, // 仅作 image 节点工具栏触发，不让用户在创建菜单手动建
    hasSourceHandle: true,
    transparentBackground: false,
    hidePanel: true, // 无 prompt 可编辑 —— hidePanel 防止 click 弹内置 panel
    // GLB 模型需要 OrbitControls 拖拽，interactionToggle 让"操作节点位置"
    // vs"操作 3D 模型"可切换；但 model-viewer 的 pointer-events 默认会冒泡，
    // 由 CanvasNode 在 selection 状态时通过 metadata.interactive 注入控制。
    interactionToggle: true,
    Content: MeshyModel3DContent,
    // resource 用于资源引用 / agent 消费：返回 model3d 类型 GLB URL
    resource: (node) => {
      const meta = (node.metadata ?? {}) as MeshyNodeMetadata;
      if (meta.status === "success" && meta.modelUrl) {
        return { kind: "model3d", url: meta.modelUrl };
      }
      return null;
    },
  };

  registerNodeDefinitions([def], "meshy-3d");
}
