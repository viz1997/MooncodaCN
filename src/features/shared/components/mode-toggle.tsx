"use client";

import { Button, Dropdown, Tooltip } from "antd";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

/**
 * 主题切换组件
 *
 * 功能:
 * - 在浅色、深色、系统主题之间切换
 * - 使用 next-themes 管理主题状态
 * - 支持两种显示模式: dropdown 和 inline
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.6）
 * - DropdownMenu → antd Dropdown
 * - Button variant="ghost" size="icon" → type="text" shape="circle"
 */

interface ModeToggleProps {
  /**
   * 显示模式
   * - dropdown: 下拉菜单形式 (默认)
   * - inline: 并排按钮形式
   */
  variant?: "dropdown" | "inline";
  /**
   * 自定义类名
   */
  className?: string;
}

export function ModeToggle({
  variant = "dropdown",
  className,
}: ModeToggleProps) {
  const { theme, setTheme } = useTheme();

  // 内联按钮模式
  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Tooltip title="浅色模式">
          <Button
            type={theme === "light" ? "default" : "text"}
            shape="circle"
            onClick={() => setTheme("light")}
            icon={<Sun className="h-4 w-4" />}
          />
        </Tooltip>
        <Tooltip title="深色模式">
          <Button
            type={theme === "dark" ? "default" : "text"}
            shape="circle"
            onClick={() => setTheme("dark")}
            icon={<Moon className="h-4 w-4" />}
          />
        </Tooltip>
        <Tooltip title="跟随系统">
          <Button
            type={theme === "system" ? "primary" : "text"}
            shape="circle"
            onClick={() => setTheme("system")}
            icon={<Monitor className="h-4 w-4" />}
          />
        </Tooltip>
      </div>
    );
  }

  // 下拉菜单模式 (默认)
  return (
    <Dropdown
      placement="bottomRight"
      trigger={["click"]}
      menu={{
        items: [
          {
            key: "light",
            label: (
              <span>
                <Sun className="mr-2 inline h-4 w-4" />
                浅色
              </span>
            ),
            onClick: () => setTheme("light"),
          },
          {
            key: "dark",
            label: (
              <span>
                <Moon className="mr-2 inline h-4 w-4" />
                深色
              </span>
            ),
            onClick: () => setTheme("dark"),
          },
          {
            key: "system",
            label: (
              <span>
                <Monitor className="mr-2 inline h-4 w-4" />
                跟随系统
              </span>
            ),
            onClick: () => setTheme("system"),
          },
        ],
        selectedKeys: [theme ?? ""],
      }}
    >
      <Button
        type="text"
        shape="circle"
        aria-label="切换主题"
        icon={
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        }
        {...(className ? { className } : {})}
      />
    </Dropdown>
  );
}
