// @ts-nocheck

/**
 * 画布多选工具栏（2026-09-16）
 *
 * 选中 2-4 个 image 节点时显示，挂在 selection bbox 顶部居中位置。
 * 与 CanvasNodeHoverToolbar 形态镜像：mouseEnter onKeep / mouseLeave onLeave
 * 防止 toolbar 闪烁。显示「已选 N 张图 · 多图转 3D」按钮 + 「多图转 3D」icon。
 *
 * 触发链路：
 *   用户 Shift/Ctrl+click 多选 2-4 张图
 *   → project-editor.tsx 计算 selectedImageNodes
 *   → 本组件在 bbox 顶部显示
 *   → 点「多图转 3D」→ onMultiImageTo3d(sourceNodes[]) → handler 创建子节点 + POST + 轮询
 *
 * 不做的事：
 *   - 不算 bbox（project-editor.tsx 传入 viewport + imageNodes，组件只渲染位置）
 *   - 不调 API（业务逻辑在 handler）
 *
 * 关联：src/features/canvas/components/canvas/canvas-node-hover-toolbar.tsx
 */

import { Layers } from "lucide-react";
import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";
import type {
  CanvasNodeData,
  ViewportTransform,
} from "@/features/canvas/types/canvas";

type CanvasMultiSelectToolbarProps = {
  /** 2-4 个 image 节点（已过滤 metadata.content 存在） */
  imageNodes: CanvasNodeData[];
  viewport: ViewportTransform;
  /** 多图转 3D 触发回调 */
  onMultiImageTo3d: (nodes: CanvasNodeData[]) => void;
  /** mouseEnter —— 防止 toolbar 闪烁（mirror CanvasNodeHoverToolbar） */
  onKeep: (key: string) => void;
  /** mouseLeave —— 当 image_Open / settings 关闭时才真正隐藏 */
  onLeave: () => void;
};

type MultiSelectToolbarTool = {
  id: string;
  title: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

/**
 * 计算 selection bbox（call site 也会做，这里保留给单元测试 / 调试用）
 *
 * 给定 N 个节点，返回：
   - centerX / topY（toolbar 居中位置）
   - leftX / bottomY（备用）
   - rightEdge（最右边节点的右边界，用于 child 节点定位）
   - bboxHeight（垂直跨度，决定 toolbar 是否要让位）
 */
export function computeSelectionBBox(nodes: CanvasNodeData[]) {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const maxX = Math.max(...nodes.map((n) => n.position.x + n.width));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxY = Math.max(...nodes.map((n) => n.position.y + n.height));
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    topY: minY,
    bottomY: maxY,
    rightEdge: maxX,
    height: maxY - minY,
  };
}

export function CanvasMultiSelectToolbar({
  imageNodes,
  viewport,
  onMultiImageTo3d,
  onKeep,
  onLeave,
}: CanvasMultiSelectToolbarProps) {
  const { t: tr2 } = useTranslation();

  if (imageNodes.length < 2 || imageNodes.length > 4) return null;

  const bbox = computeSelectionBBox(imageNodes);
  if (!bbox) return null;

  // 工具栏定位：bbox 顶部居中，screen 坐标 = viewport.x + worldX * viewport.k
  const left = viewport.x + bbox.centerX * viewport.k;
  const top = viewport.y + bbox.topY * viewport.k - 14;
  const keepKey = `multi-select:${imageNodes.map((n) => n.id).join(",")}`;

  const tools: MultiSelectToolbarTool[] = [
    {
      id: "multiImageTo3d",
      title: tr2("canvas.imageTools.multiImageTo3dTitle"),
      label: tr2("canvas.imageTools.multiImageTo3d"),
      icon: <Layers className="size-4" />,
      onClick: () => onMultiImageTo3d(imageNodes),
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="multi-select"
      className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-purple-200 bg-white px-2 text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
      style={{ left, top }}
      onMouseEnter={() => onKeep(keepKey)}
      onMouseLeave={onLeave}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1 px-2 text-xs text-muted-foreground">
        <Layers className="size-3.5 text-purple-500" />
        <span>
          {tr2("canvas.imageTools.selectedImagesCount", {
            count: imageNodes.length,
          })}
        </span>
      </div>
      <div className="mx-1 h-6 w-px bg-purple-100" />
      {tools.map((tool) => (
        <MultiSelectToolbarAction
          key={tool.id}
          id={tool.id}
          title={tool.title}
          label={tool.label}
          icon={tool.icon}
          onClick={tool.onClick}
        />
      ))}
    </div>
  );
}

type MultiSelectToolbarActionProps = {
  id: string;
  title: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

function MultiSelectToolbarAction({
  id,
  title,
  label,
  icon,
  onClick,
}: MultiSelectToolbarActionProps) {
  return (
    <button
      type="button"
      data-tool-id={id}
      title={title}
      aria-label={title}
      onClick={onClick}
      className="group flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-purple-700 transition hover:bg-purple-50"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
