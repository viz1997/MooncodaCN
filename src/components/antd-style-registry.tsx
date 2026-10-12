"use client";

/**
 * Antd cssinjs SSR Registry
 *
 * 2026-08-22：修复 shadcn → antd 迁移后 dashboard/admin/auth layout 的 hydration mismatch
 *
 * 背景：
 * antd 6 用 @ant-design/cssinjs 生成 hash className 和对应 CSS。
 * 没有这个 registry 时，服务端/客户端的 cssinjs cache 互相独立，
 * 客户端第一次渲染时会"补出"服务端没输出的 className，
 * React reconciler 把这当成新增 DOM 节点 → hydration mismatch。
 *
 * 作用：
 * 1. 用 createCache() 建一个稳定的 cssinjs cache 容器
 * 2. 用 next/navigation 的 useServerInsertedHTML 把当前 cache 的 CSS
 *    作为 <style> 标签 flush 到 SSR 响应的 <head>
 * 3. 把 hashPriority="high" 仍交给内层 StyleProvider，避免与 Tailwind 4 hash 撞名
 *
 * 挂载顺序（业务侧 AntdProvider 内部）：
 *   <AntdStyleRegistry>
 *     <ConfigProvider locale theme>
 *       <App>{children}</App>
 *     </ConfigProvider>
 *   </AntdStyleRegistry>
 *
 * 注意：
 * - 不要在 (marketing) 路由组用本组件 —— marketing 仍走 shadcn/ui，
 *   不需要 antd 的 cssinjs registry，引入反而增加首屏体积
 * - 已在 (dashboard) / (auth) / (admin) 三个 route group layout 通过
 *   AntdLayoutShell → AntdProvider 包住
 */

import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import { useServerInsertedHTML } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo } from "react";

interface AntdStyleRegistryProps {
  children: ReactNode;
}

export function AntdStyleRegistry({ children }: AntdStyleRegistryProps) {
  // createCache 必须只跑一次，否则 hash 会因为 cache 实例不同而漂移
  const cache = useMemo(() => createCache(), []);

  // 把当前 cache 里累积的 CSS 作为 <style> 标签插入到 SSR 响应 head
  // plain=true: 输出压缩后的纯 CSS（无注释、无空白），更小
  useServerInsertedHTML(() => (
    <style
      id="antd-cssinjs"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: antd 6 cssinjs 官方推荐用法，cache 内容是 antd 内部 hash 化后的 CSS 字符串，不存在 XSS 风险
      dangerouslySetInnerHTML={{ __html: extractStyle(cache, true) }}
    />
  ));

  return (
    <StyleProvider cache={cache} hashPriority="high">
      {children}
    </StyleProvider>
  );
}
