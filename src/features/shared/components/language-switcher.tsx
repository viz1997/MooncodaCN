"use client";

import { Button, Dropdown } from "antd";
import { Globe } from "lucide-react";
import { useParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/routing";

/**
 * 支持的语言配置
 */
const locales = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
] as const;

/**
 * 语言切换器组件
 *
 * 功能:
 * - 显示当前语言
 * - 下拉菜单切换语言
 * - 切换时保持当前路径
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.6）
 * - DropdownMenu → antd Dropdown（用 menu.items API）
 * - Button variant="ghost" size="icon" → type="text" shape="circle"
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isPending, startTransition] = useTransition();

  /**
   * 切换语言
   */
  const handleLocaleChange = (newLocale: string) => {
    startTransition(() => {
      router.replace(
        // @ts-expect-error -- TypeScript will validate that only known `params`
        // are used in combination with a given `pathname`. Since the two will
        // always match for the current route, we can skip runtime checks.
        { pathname, params },
        { locale: newLocale }
      );
    });
  };

  return (
    <Dropdown
      placement="bottomRight"
      trigger={["click"]}
      menu={{
        items: locales.map((loc) => ({
          key: loc.code,
          label: (
            <span className={locale === loc.code ? "font-medium" : ""}>
              <span className="mr-2">{loc.flag}</span>
              {loc.label}
            </span>
          ),
          onClick: () => handleLocaleChange(loc.code),
        })),
        selectedKeys: [locale],
      }}
    >
      <Button
        type="text"
        shape="circle"
        disabled={isPending}
        aria-label="切换语言"
        icon={<Globe className="h-5 w-5" />}
      />
    </Dropdown>
  );
}
