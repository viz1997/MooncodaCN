"use client";

/**
 * 用户角色选择组件
 *
 * 管理员可以通过此组件修改用户角色
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.5）
 * - shadcn Select/Badge 切到 antd
 * - toast 切到 App.useApp().message
 * - 加载中显示 spinner + 文案（不再渲染 Select）
 */

import { App, Badge, Select } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { updateUserRoleAction } from "@/features/support/actions";

interface UserRoleSelectProps {
  /** 用户 ID */
  userId: string;
  /** 当前角色 */
  currentRole: "user" | "admin";
}

type UserRole = "user" | "admin";

const ROLE_CONFIG: Record<UserRole, { color: string }> = {
  user: { color: "default" },
  admin: { color: "red" },
};

export function UserRoleSelect({ userId, currentRole }: UserRoleSelectProps) {
  const router = useRouter();
  const t = useTranslations("Support");
  const { message } = App.useApp();
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState<UserRole>(currentRole);

  const handleRoleChange = async (newRole: string) => {
    if (newRole === role) return;

    setIsLoading(true);

    try {
      const result = await updateUserRoleAction({
        userId,
        role: newRole as UserRole,
      });

      if (result?.data) {
        message.success(result.data.message);
        setRole(newRole as UserRole);
        router.refresh();
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error(t("roleUpdateFailed"));
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderBadge = (value: UserRole) => (
    <Badge color={ROLE_CONFIG[value].color} className="!text-xs">
      {value === "admin" ? t("admin") : t("user")}
    </Badge>
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        {t("updating")}
      </div>
    );
  }

  return (
    <Select
      value={role}
      onChange={handleRoleChange}
      style={{ width: 120 }}
      options={(["user", "admin"] as const).map((value) => ({
        value,
        label: renderBadge(value),
      }))}
      labelRender={(props) => renderBadge(props.value as UserRole)}
    />
  );
}
