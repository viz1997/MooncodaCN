"use client";

/**
 * 管理员 - 编辑用户对话框
 *
 * 可修改字段：
 * - name / email / image
 * - emailVerified / needsVerification
 * - role
 * - password（留空表示不重置；≥8 位时调用 setUserPassword）
 *
 * 封禁状态由独立的 ban/unban 操作管理，不在编辑对话框内。
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.5）
 * - shadcn Dialog 切到 antd Modal
 * - shadcn Avatar/Input/Input.Password/Checkbox/Select/Button/Label 切到 antd
 * - toast 切到 App.useApp().message
 * - 密码可见/隐藏用 Input.Password 自带 visibilityToggle
 */

import {
  Alert,
  App,
  Avatar,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
} from "antd";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { updateUserAction } from "../actions";

interface EditableUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "user" | "admin";
  banned: boolean;
  emailVerified: boolean;
  needsVerification: boolean;
}

interface UserEditDialogProps {
  /** 受控的对话框开关状态 */
  open: boolean;
  /** 关闭对话框 */
  onOpenChange: (open: boolean) => void;
  /** 待编辑用户（null 时对话框显示为空表单但不渲染内容） */
  user: EditableUser | null;
  /** 编辑成功后回调（通常用于刷新列表） */
  onUpdated?: () => void;
  /** 当前登录管理员的用户 ID，用于避免编辑自己 */
  currentUserId?: string | undefined;
}

export function UserEditDialog({
  open,
  onOpenChange,
  user,
  onUpdated,
  currentUserId,
}: UserEditDialogProps) {
  const { message } = App.useApp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 每次打开时，用 user 字段重置表单
  useEffect(() => {
    if (!open || !user) return;
    setName(user.name);
    setEmail(user.email);
    setImage(user.image ?? "");
    setEmailVerified(user.emailVerified);
    setNeedsVerification(user.needsVerification);
    setRole(user.role);
    setPassword("");
  }, [open, user]);

  const isSelf = !!user && user.id === currentUserId;

  const handleSubmit = async () => {
    if (!user) return;

    if (!name.trim()) {
      message.error("请输入用户名");
      return;
    }
    if (!email.trim()) {
      message.error("请输入邮箱地址");
      return;
    }
    if (password && password.length < 8) {
      message.error("密码至少需要 8 位");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await updateUserAction({
        userId: user.id,
        name: name.trim(),
        email: email.trim(),
        image: image.trim() || undefined,
        emailVerified,
        needsVerification,
        role,
        password: password.trim() || undefined,
      });

      if (result?.data) {
        message.success(result.data.message);
        onOpenChange(false);
        onUpdated?.();
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error("更新失败");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getInitials = (n: string) =>
    n
      .split(" ")
      .map((s) => s[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <Modal
      open={open}
      onCancel={() => !isSubmitting && onOpenChange(false)}
      title={
        <span className="flex items-center gap-2">
          <Pencil className="h-4 w-4" />
          编辑用户
        </span>
      }
      footer={[
        <Button
          key="cancel"
          type="default"
          onClick={() => onOpenChange(false)}
          disabled={isSubmitting}
        >
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={isSubmitting}
          disabled={!user}
          onClick={handleSubmit}
        >
          保存修改
        </Button>,
      ]}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        修改用户资料、邮箱验证状态、角色，或重置登录密码。
      </p>

      {isSelf && (
        <Alert
          type="warning"
          showIcon
          className="!mb-4"
          message="你正在编辑自己的账户，部分操作可能影响你的登录态。"
        />
      )}

      {user && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar
              src={image || user.image || undefined}
              alt={name}
              size={48}
              className="shrink-0 bg-primary text-primary-foreground"
            >
              {getInitials(name || user.name)}
            </Avatar>
            <div className="text-sm text-muted-foreground">ID: {user.id}</div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="editName"
                className="text-sm font-medium leading-none"
              >
                姓名 *
              </label>
              <Input
                id="editName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="editEmail"
                className="text-sm font-medium leading-none"
              >
                邮箱 *
              </label>
              <Input
                id="editEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="editImage"
              className="text-sm font-medium leading-none"
            >
              头像 URL
            </label>
            <Input
              id="editImage"
              type="url"
              placeholder="https://..."
              value={image}
              onChange={(e) => setImage(e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="editRole"
              className="text-sm font-medium leading-none"
            >
              角色
            </label>
            <Select
              id="editRole"
              value={role}
              onChange={(v) => setRole(v as "user" | "admin")}
              className="w-full"
              options={[
                { value: "user", label: "普通用户" },
                { value: "admin", label: "管理员" },
              ]}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="editPassword"
              className="text-sm font-medium leading-none"
            >
              重置密码
              <span className="ml-1 text-xs text-muted-foreground">
                （留空表示不修改）
              </span>
            </label>
            <Input.Password
              id="editPassword"
              placeholder="至少 8 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <Checkbox
              checked={emailVerified}
              onChange={(e) => setEmailVerified(e.target.checked)}
            >
              邮箱已验证
            </Checkbox>
            <Checkbox
              checked={needsVerification}
              onChange={(e) => setNeedsVerification(e.target.checked)}
            >
              需要邮箱验证（强制重发验证邮件）
            </Checkbox>
            {user.banned && (
              <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                该用户已被封禁，编辑保存不会自动解封 —— 请使用封禁/解封操作。
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
