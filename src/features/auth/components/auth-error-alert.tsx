"use client";

/**
 * 认证错误提示组件
 *
 * 用 antd Alert 渲染错误信息，type="error"。挂载要求：父组件必须在 AntdProvider
 * 范围内（message / modal / notification 根节点）—— 当前 (auth)/layout.tsx 已挂。
 */

import { Alert } from "antd";

interface AuthErrorAlertProps {
  /** 错误信息，为 null 时不显示 */
  message: string | null;
}

export function AuthErrorAlert({ message }: AuthErrorAlertProps) {
  // 没有错误信息时不渲染
  if (!message) return null;

  return (
    <Alert
      type="error"
      message={message}
      showIcon
      className="!text-sm"
      role="alert"
    />
  );
}
