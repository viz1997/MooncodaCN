"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RootProvider } from "fumadocs-ui/provider/next";
import { ThemeProvider } from "next-themes";
import * as React from "react";

import { SessionProvider } from "@/lib/auth/session-context";

/**
 * 全局 Providers 组件
 *
 * 功能:
 * - 主题管理 (next-themes)
 * - Fumadocs UI 框架支持 (RootProvider)
 * - Session 管理 (SessionProvider)
 * - TanStack QueryClient (全站统一 client,useState lazy init 避免 SSR 重渲)
 *   服务 store cart / products + 未来 dashboard/canvas 复用
 */

interface ProvidersProps {
  children: React.ReactNode;
  locale?: string;
}

const docsLocales = [
  { locale: "en", name: "English" },
  { locale: "zh", name: "中文" },
];

const zhDocsTranslations = {
  search: "搜索",
  searchNoResult: "没有找到结果",
  toc: "本页目录",
  tocNoHeadings: "没有标题",
  lastUpdate: "最后更新于",
  chooseLanguage: "选择语言",
  nextPage: "下一页",
  previousPage: "上一页",
  chooseTheme: "选择主题",
  editOnGithub: "在 GitHub 编辑",
} as const;

export function Providers({ children, locale = "en" }: ProvidersProps) {
  const docsLocale = locale === "zh" ? "zh" : "en";

  // QueryClient 工厂模式 lazy init —— 避免 SSR 时新建导致 hydration 不一致
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <RootProvider
            i18n={{
              locale: docsLocale,
              locales: docsLocales,
              ...(docsLocale === "zh"
                ? { translations: zhDocsTranslations }
                : {}),
            }}
          >
            {children}
          </RootProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
