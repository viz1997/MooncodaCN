"use client";

import { Button, Collapse, Modal, Switch } from "antd";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_KEY,
  COOKIE_PREFERENCES_KEY,
  type CookieConsentType,
  type CookiePreferences,
} from "@/lib/cookie-consent";
import { cn } from "@/lib/utils";

/**
 * 默认 Cookie 偏好
 */
const DEFAULT_PREFERENCES: CookiePreferences = {
  analytics: true,
  marketing: true,
};

/**
 * Cookie Settings Dialog 组件属性
 */
interface CookieSettingsDialogProps {
  /** 触发按钮的子元素 */
  children: React.ReactElement;
}

/**
 * Cookie Settings Dialog 组件
 *
 * 功能:
 * - 显示 Cookie 偏好设置对话框
 * - 可展开的 Cookie 类别
 * - 支持 Accept all / Reject all / Accept current selection
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.6）
 * - Dialog → antd Modal（用 controlled open 状态 + cloneElement 把 onClick 注入 trigger）
 * - Collapsible → antd Collapse（用 items API）
 * - Switch → antd Switch（API 几乎一致：checked / onChange）
 */
export function CookieSettingsDialog({ children }: CookieSettingsDialogProps) {
  const t = useTranslations("Cookie");
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] =
    useState<CookiePreferences>(DEFAULT_PREFERENCES);
  const [expandedItems, setExpandedItems] = useState<string[]>(["necessary"]);

  const cookieCategories = [
    {
      id: "necessary",
      title: t("essential.title"),
      description: t("essential.description"),
      required: true,
    },
    {
      id: "analytics",
      title: t("analytics.title"),
      description: t("analytics.description"),
      required: false,
    },
    {
      id: "marketing",
      title: t("marketing.title"),
      description: t("marketing.description"),
      required: false,
    },
  ] as const;

  /**
   * 加载已保存的偏好设置
   */
  useEffect(() => {
    if (open) {
      const savedPreferences = localStorage.getItem(COOKIE_PREFERENCES_KEY);
      if (savedPreferences) {
        try {
          setPreferences(JSON.parse(savedPreferences));
        } catch {
          // 忽略解析错误
        }
      }
    }
  }, [open]);

  /**
   * 切换展开状态
   */
  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  /**
   * 保存 Cookie 同意设置
   */
  const saveConsent = useCallback(
    (consent: CookieConsentType, prefs: CookiePreferences) => {
      localStorage.setItem(COOKIE_CONSENT_KEY, consent || "");
      localStorage.setItem(COOKIE_PREFERENCES_KEY, JSON.stringify(prefs));
      // 触发自定义事件通知 Analytics 组件
      window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGE_EVENT));
      setOpen(false);
    },
    []
  );

  /**
   * 处理接受全部 Cookie
   */
  const handleAcceptAll = useCallback(() => {
    const allPreferences: CookiePreferences = {
      analytics: true,
      marketing: true,
    };
    setPreferences(allPreferences);
    saveConsent("all", allPreferences);
  }, [saveConsent]);

  /**
   * 处理拒绝全部（仅必要）
   */
  const handleRejectAll = useCallback(() => {
    const essentialPreferences: CookiePreferences = {
      analytics: false,
      marketing: false,
    };
    setPreferences(essentialPreferences);
    saveConsent("essential", essentialPreferences);
  }, [saveConsent]);

  /**
   * 处理保存当前选择
   */
  const handleSavePreferences = useCallback(() => {
    const consentType: CookieConsentType =
      preferences.analytics || preferences.marketing ? "all" : "essential";
    saveConsent(consentType, preferences);
  }, [preferences, saveConsent]);

  /**
   * 更新偏好设置
   */
  const updatePreference = (key: keyof CookiePreferences, value: boolean) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * 获取某个类别的开关状态
   */
  const getCategoryValue = (id: string): boolean => {
    if (id === "necessary") return true;
    if (id === "analytics") return preferences.analytics;
    if (id === "marketing") return preferences.marketing;
    return false;
  };

  /**
   * 处理某个类别的开关变化
   */
  const handleCategoryChange = (id: string, value: boolean) => {
    if (id === "analytics") updatePreference("analytics", value);
    if (id === "marketing") updatePreference("marketing", value);
  };

  /**
   * 把 onClick 注入到 trigger 子元素（替代 shadcn DialogTrigger asChild）
   */
  const triggerElement = isValidElement(children)
    ? cloneElement(
        children as React.ReactElement<{
          onClick?: (...args: unknown[]) => void;
        }>,
        {
          onClick: (...args: unknown[]) => {
            // 调用原本的 onClick（如果有）
            const original = (
              children.props as {
                onClick?: (...args: unknown[]) => void;
              }
            ).onClick;
            if (original) {
              original(...args);
            }
            setOpen(true);
          },
        }
      )
    : children;

  return (
    <>
      {triggerElement}
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={672}
        className="!max-h-[90vh] !p-0"
        title={
          <span className="text-lg font-semibold">{t("dialog.title")}</span>
        }
        closeIcon={null}
        destroyOnClose={false}
        maskClosable
      >
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {/* Description */}
          <div className="mb-6">
            <h3 className="mb-2 font-semibold">{t("dialog.heading")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("dialog.description")}
            </p>
          </div>

          {/* Cookie Categories */}
          <Collapse
            activeKey={expandedItems}
            onChange={(keys) => {
              const next = Array.isArray(keys) ? keys : [keys];
              setExpandedItems(
                next.filter((k): k is string => typeof k === "string")
              );
            }}
            ghost
            items={cookieCategories.map((category) => {
              const isExpanded = expandedItems.includes(category.id);
              const isChecked = getCategoryValue(category.id);
              return {
                key: category.id,
                showArrow: false,
                label: (
                  <div className="flex w-full items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(category.id);
                      }}
                      className="flex items-center gap-2 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          isExpanded && "rotate-180"
                        )}
                      />
                      <span className="font-medium">{category.title}</span>
                    </button>
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: antd Switch 自带键盘事件 */}
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上 */}
                    <span
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto"
                    >
                      <Switch
                        checked={isChecked}
                        onChange={(value) =>
                          handleCategoryChange(category.id, value)
                        }
                        disabled={category.required}
                      />
                    </span>
                  </div>
                ),
                children: (
                  <div className="px-1 pb-3 pt-1">
                    <p className="text-sm text-muted-foreground">
                      {category.description}
                    </p>
                  </div>
                ),
              };
            })}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <div className="flex gap-2">
            <Button
              type="primary"
              onClick={handleAcceptAll}
              className="!bg-gray-900 hover:!bg-gray-800"
            >
              {t("acceptAll")}
            </Button>
            <Button type="default" onClick={handleRejectAll}>
              {t("rejectAll")}
            </Button>
          </div>
          <Button type="default" onClick={handleSavePreferences}>
            {t("dialog.acceptCurrentSelection")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
