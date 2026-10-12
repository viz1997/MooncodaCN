"use client";

/**
 * 我的资产页面视图 —— /dashboard/assets
 *
 * 与 AssetPickerModal 共用 AssetLibraryContent（asset-picker-modal.tsx
 * 内导出），避免弹窗 / 页面双份维护。
 *
 * 页面模式下 onInsert 含义：把资产加入剪贴板 / 触发下载 —— 不像弹窗模式
 * 那样注入到调用方的引用列表。文本直接复制；图片走 navigator.clipboard.write
 * （多数浏览器支持 image/png）；视频只能下载。
 */

import { App } from "antd";
import { useTranslation } from "react-i18next";
import {
  AssetLibraryContent,
  type InsertAssetPayload,
} from "@/features/canvas/components/canvas/asset-picker-modal";

export function AssetLibraryView() {
  const { t } = useTranslation();
  const { message } = App.useApp();

  const handleInsert = async (payload: InsertAssetPayload) => {
    try {
      if (payload.kind === "text") {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(payload.content);
          message.success(t("assets.copyTextSuccess"));
          return;
        }
        message.info(t("assets.copyManually"));
        return;
      }
      // 图片 / 视频：触发下载
      const link = document.createElement("a");
      link.href = payload.kind === "video" ? payload.url : payload.dataUrl;
      link.download = payload.title || "asset";
      link.click();
      message.success(t("assets.downloadStarted"));
    } catch {
      message.error(t("assets.actionFailed"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">
          {t("assets.title")}
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {t("assets.description")}
        </p>
      </header>
      <AssetLibraryContent onInsert={handleInsert} className="min-h-0 flex-1" />
    </div>
  );
}
