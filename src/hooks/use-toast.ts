"use client";

import { toast as sonnerToast } from "sonner";

/**
 * mooncada 模块兼容用 toast hook
 *
 * mooncada 组件统一使用 `const { toast } = useToast()` 配合
 * `toast({ title, description, variant })` 风格（基于 @radix-ui/react-toast）。
 * Mooncoda 使用 sonner，这里做一层适配，保持迁移组件代码不改：
 *  - variant === "destructive" → sonner 的 error 提示
 *  - 其余 → sonner 的 success 提示
 *  - 仅 title 时退化为 message 提示
 */
type ToastVariant = "default" | "destructive" | null | undefined;

// 项目 tsconfig 启用了 exactOptionalPropertyTypes：可选字段要么省略，要么
// 显式带 `| undefined`，否则 `string | undefined` 实参会被类型系统拒绝。
interface ToastOptions {
  title?: string | undefined;
  description?: string | undefined;
  variant?: ToastVariant | undefined;
}

function showToast({ title, description, variant }: ToastOptions) {
  const message = title ?? "";
  const isError = variant === "destructive";
  if (isError) {
    sonnerToast.error(message, description ? { description } : undefined);
    return;
  }
  sonnerToast.success(message, description ? { description } : undefined);
}

/**
 * 兼容 mooncada 的 useToast hook
 * 返回 { toast } 供组件解构使用
 */
export function useToast() {
  return {
    toast: showToast,
    dismiss: sonnerToast.dismiss,
  };
}

export { showToast as toast };
