"use client";

import { Eye, EyeOff, Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { updateUserAction } from "../actions";

/**
 * 待编辑用户信息（与 AdminUsersPage.UserWithDetails 字段对齐）
 */
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
 */
export function UserEditDialog({
  open,
  onOpenChange,
  user,
  onUpdated,
  currentUserId,
}: UserEditDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    setShowPassword(false);
  }, [open, user]);

  const isSelf = !!user && user.id === currentUserId;

  const handleSubmit = async () => {
    if (!user) return;

    if (!name.trim()) {
      toast.error("请输入用户名");
      return;
    }
    if (!email.trim()) {
      toast.error("请输入邮箱地址");
      return;
    }
    if (password && password.length < 8) {
      toast.error("密码至少需要 8 位");
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
        toast.success(result.data.message);
        onOpenChange(false);
        onUpdated?.();
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error("更新失败");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            编辑用户
          </DialogTitle>
          <DialogDescription>
            修改用户资料、邮箱验证状态、角色，或重置登录密码。
          </DialogDescription>
        </DialogHeader>

        {isSelf && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
            ⚠️ 你正在编辑自己的账户，部分操作可能影响你的登录态。
          </div>
        )}

        {!user ? null : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarImage
                  src={image || user.image || undefined}
                  alt={name}
                />
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {getInitials(name || user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="text-sm text-muted-foreground">ID: {user.id}</div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="editName">姓名 *</Label>
                <Input
                  id="editName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEmail">邮箱 *</Label>
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
              <Label htmlFor="editImage">头像 URL</Label>
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
              <Label htmlFor="editRole">角色</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as "user" | "admin")}
              >
                <SelectTrigger id="editRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">普通用户</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="editPassword">
                重置密码
                <span className="ml-1 text-xs text-muted-foreground">
                  （留空表示不修改）
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="editPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="至少 8 位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="editEmailVerified"
                  checked={emailVerified}
                  onCheckedChange={(v) => setEmailVerified(!!v)}
                />
                <Label
                  htmlFor="editEmailVerified"
                  className="text-sm leading-none"
                >
                  邮箱已验证
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="editNeedsVerification"
                  checked={needsVerification}
                  onCheckedChange={(v) => setNeedsVerification(!!v)}
                />
                <Label
                  htmlFor="editNeedsVerification"
                  className="text-sm leading-none"
                >
                  需要邮箱验证（强制重发验证邮件）
                </Label>
              </div>
              {user.banned && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                  该用户已被封禁，编辑保存不会自动解封 —— 请使用封禁/解封操作。
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !user}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
