// @ts-nocheck
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/**
 * 应用 antd 6 主题（中性黑白 + antd algorithm）
 *
 * 共享给：
 * - 画布（src/features/canvas/components/layout/app-providers.tsx）
 * - 业务 dashboard / auth / admin（route group layout 通过 AntdProvider 挂载）
 *
 * 2026-08-20：从 src/features/canvas/lib/app-theme.ts 抽出，画布沿用中性黑白，
 * dashboard/auth/admin 也走同一份主题（避免双主题），shadcn 仍负责 marketing/blog/docs。
 *
 * 中性黑白色板：
 * - light：primary = #171717（中性黑），bg 偏暖白（#fafaf9）
 * - dark：primary = #fafafa（中性白），bg 偏暖黑（#0c0a09）
 *
 * 画布原本使用 #1c1917 / #fafaf9 体系；统一后 dashboard/auth/admin 的暗色 bg 略深。
 * 如需更严格画布原样，把 colorBgContainer 改回 #1c1917 即可。
 */

const neutral = {
  light: {
    primary: "#171717",
    primaryHover: "#000000",
    primaryText: "#ffffff",
    bgLayout: "#fafaf9",
    bgContainer: "#ffffff",
    bgElevated: "#ffffff",
    textBase: "#0c0a09",
    itemHoverBg: "rgba(23, 23, 23, 0.06)",
    itemSelectedBg: "rgba(23, 23, 23, 0.1)",
    itemSelectedHoverBg: "rgba(23, 23, 23, 0.14)",
    itemText: "#171717",
    tableSelectedBg: "rgba(17, 17, 17, 0.05)",
    tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
  },
  dark: {
    primary: "#fafafa",
    primaryHover: "#ffffff",
    primaryText: "#171717",
    bgLayout: "#0c0a09",
    bgContainer: "#1c1917",
    bgElevated: "#1c1917",
    textBase: "#fafaf9",
    itemHoverBg: "rgba(250, 250, 249, 0.08)",
    itemSelectedBg: "rgba(250, 250, 249, 0.12)",
    itemSelectedHoverBg: "rgba(250, 250, 249, 0.16)",
    itemText: "#fafafa",
    tableSelectedBg: "rgba(255, 255, 255, 0.08)",
    tableSelectedHoverBg: "rgba(255, 255, 255, 0.12)",
  },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
  const color = dark ? neutral.dark : neutral.light;

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    cssVar: { key: dark ? "app-dark" : "app-light" },
    token: {
      colorPrimary: color.primary,
      colorInfo: color.primary,
      colorLink: color.primary,
      colorLinkHover: color.primaryHover,
      colorLinkActive: color.primary,
      colorTextLightSolid: color.primaryText,
      colorBgLayout: color.bgLayout,
      colorBgContainer: color.bgContainer,
      colorBgElevated: color.bgElevated,
      colorText: color.textBase,
      borderRadius: 10, // 0.625rem（中性画布风圆角，区别于 shadcn 1.25rem）
      controlItemBgHover: color.itemHoverBg,
      controlItemBgActive: color.itemSelectedBg,
      controlItemBgActiveHover: color.itemSelectedHoverBg,
    },
    components: {
      Button: {
        primaryShadow: "none",
      },
      Dropdown: {
        colorBgElevated: color.bgElevated,
        colorText: color.itemText,
        controlItemBgHover: color.itemHoverBg,
        controlItemBgActive: color.itemSelectedBg,
        controlItemBgActiveHover: color.itemSelectedHoverBg,
      },
      Menu: {
        popupBg: color.bgElevated,
        itemActiveBg: color.itemSelectedBg,
        itemHoverBg: color.itemHoverBg,
        itemSelectedBg: color.itemSelectedBg,
        itemSelectedColor: color.itemText,
        darkPopupBg: neutral.dark.bgElevated,
        darkItemHoverBg: neutral.dark.itemHoverBg,
        darkItemSelectedBg: neutral.dark.itemSelectedBg,
        darkItemSelectedColor: neutral.dark.itemText,
      },
      Select: {
        optionActiveBg: color.itemHoverBg,
        optionSelectedBg: color.itemSelectedBg,
        optionSelectedColor: color.itemText,
      },
      Table: {
        rowSelectedBg: color.tableSelectedBg,
        rowSelectedHoverBg: color.tableSelectedHoverBg,
      },
    },
  };
}
