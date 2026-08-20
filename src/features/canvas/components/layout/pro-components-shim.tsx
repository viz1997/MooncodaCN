// @ts-nocheck
"use client";

/**
 * @ant-design/pro-components 占位实现
 *
 * Plan §5.3：pro-components 还在 beta，画布内不需要它的复杂表格/描述列表。
 * 这里只暴露 ProConfigProvider（一个透传到 antd ConfigProvider 的壳），
 * 让 app-providers.tsx 能继续挂载它而不依赖 pro-components。
 *
 * 真要切回 pro-components：装 `@ant-design/pro-components` 并把这个文件删掉。
 */

import { ConfigProvider } from "antd";
import type { ReactNode } from "react";

interface ProConfigProviderProps {
  dark?: boolean;
  children?: ReactNode;
}

export function ProConfigProvider({ children }: ProConfigProviderProps) {
  return <ConfigProvider>{children}</ConfigProvider>;
}
