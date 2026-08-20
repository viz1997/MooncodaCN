import type { ReactNode } from "react";

/**
 * /dashboard/canvas/[projectId] —— 画布编辑器 fullscreen 布局
 *
 * 关键点：父 (dashboard)/layout.tsx 已经把 DashboardSidebar + DashboardMainWrapper
 * 渲染到 min-h-screen 上。画布编辑器需要：
 *   1. 跳出 sidebar（fixed inset-0 覆盖整个视口）
 *   2. z-index 高于 sidebar，避免被遮
 *
 * 用 fixed inset-0 + z-50 是最简单的解法——比改父 layout 影响范围小。
 *
 * 注意：保留 dashboard 父 layout 的 auth gate（这里不再额外校验）。
 */
export default function CanvasEditorLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div data-canvas-fullscreen className="fixed inset-0 z-50 bg-background">
      {children}
    </div>
  );
}
