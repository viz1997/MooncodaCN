"use client";

/**
 * 提示词库页面视图 —— /dashboard/prompts
 *
 * 不走 Modal，页面常驻。点击卡片触发 onSelect（这里走"复制到剪贴板"语义）；
 * 每张卡还有一个"加入我的资产"按钮，写入 useAssetStore（type=text）。
 *
 * 与 PromptSelectDialog 共用 PromptLibraryContent，避免弹窗 / 页面双份
 * 维护。onClose 在页面模式下省略（PromptLibraryContent 用 onClose?.() 兜底）。
 */

import { App } from "antd";
import copy from "copy-to-clipboard";
import { useTranslation } from "react-i18next";
import {
  type AddPromptToAssetsPayload,
  PromptLibraryContent,
} from "@/features/canvas/components/prompts/prompt-select-dialog";
import { useAssetStore } from "@/features/canvas/stores/use-asset-store";

export function PromptLibraryView() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const addAsset = useAssetStore((state) => state.addAsset);

  const handleSelect = async (prompt: string) => {
    try {
      const ok = await copy(prompt);
      if (ok) {
        message.success(t("prompts.copied"));
        return;
      }
    } catch {
      // 落到 navigator.clipboard 兜底
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(prompt).then(
        () => message.success(t("prompts.copied")),
        () => message.info(t("prompts.copyManually"))
      );
      return;
    }
    message.info(t("prompts.copyManually"));
  };

  const handleAddToAssets = (payload: AddPromptToAssetsPayload) => {
    addAsset({
      kind: "text",
      title: payload.title,
      coverUrl: payload.coverUrl ?? "",
      tags: payload.tags ?? [],
      source: payload.source,
      data: { content: payload.prompt },
      ...(payload.metadata ? { metadata: payload.metadata } : {}),
    });
    message.success(t("common.addedToAssets"));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">
          {t("prompts.library")}
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {t("prompts.libraryDescription")}
        </p>
      </header>
      <PromptLibraryContent
        onSelect={handleSelect}
        onAddToAssets={handleAddToAssets}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
