"use client";

/**
 * 管理员 - 用户管理页面 (客户端组件)
 *
 * 功能:
 * - 搜索用户 (邮箱/名称)
 * - 查看积分余额
 * - 查看订阅状态
 * - 修改用户角色
 * - 封禁/解封用户
 * - 手动充值积分
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.1）
 * - shadcn Avatar/Badge/Button/Card/Checkbox/Dialog/Input/Label/Select/Textarea 切到 antd
 * - shadcn Dialog 切到 antd Modal
 * - toast 切到 App.useApp().message
 * - shadcn Card 切到内联 div
 */

import {
  App,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
} from "antd";
import { Ban, Coins, Pencil, Plus, Search, UserCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  adminGrantCreditsAction,
  banUserAction,
  createUserAction,
  getAllUsersAction,
} from "@/features/support/actions";
import { UserEditDialog, UserRoleSelect } from "@/features/support/components";
import { useSessionContext } from "@/lib/auth/session-context";

interface UserWithDetails {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "user" | "admin";
  banned: boolean;
  bannedReason: string | null;
  emailVerified: boolean;
  needsVerification: boolean;
  createdAt: Date;
  credits: {
    balance: number;
    totalEarned: number;
    totalSpent: number;
    status: "active" | "frozen";
  } | null;
  subscription: {
    status: string;
    priceId: string;
    currentPeriodEnd: Date | null;
  } | null;
}

/**
 * 订阅状态 → antd Badge color
 */
const SUB_STATUS_COLOR_MAP: Record<string, string> = {
  active: "green",
  canceled: "gold",
  past_due: "red",
  incomplete: "default",
};

const SUB_STATUS_LABEL: Record<string, string> = {
  active: "订阅中",
  canceled: "已取消",
  past_due: "逾期",
  incomplete: "未完成",
};

export default function AdminUsersPage() {
  const { message } = App.useApp();
  const { user: currentUser } = useSessionContext();
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // 封禁对话框状态
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(
    null
  );
  const [banReason, setBanReason] = useState("");
  const [isBanning, setIsBanning] = useState(false);

  // 充值对话框状态
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [isGranting, setIsGranting] = useState(false);

  // 新增用户对话框状态
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<"user" | "admin">("user");
  const [createNeedsVerification, setCreateNeedsVerification] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // 编辑用户对话框状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null);

  /**
   * 加载用户列表
   */
  const loadUsers = useCallback(
    async (query?: string) => {
      setIsLoading(true);
      try {
        const result = await getAllUsersAction(query ? { query } : undefined);
        if (result?.data?.users) {
          setUsers(result.data.users as UserWithDetails[]);
        }
      } catch (error) {
        message.error("加载用户列表失败");
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    },
    [message]
  );

  // 初始加载
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  /**
   * 处理搜索
   */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    loadUsers(searchInput);
  };

  /**
   * 打开封禁对话框
   */
  const openBanDialog = (user: UserWithDetails) => {
    setSelectedUser(user);
    setBanReason("");
    setBanDialogOpen(true);
  };

  /**
   * 处理封禁/解封
   */
  const handleBan = async () => {
    if (!selectedUser) return;

    setIsBanning(true);
    try {
      const result = await banUserAction({
        userId: selectedUser.id,
        banned: !selectedUser.banned,
        reason: banReason || undefined,
      });

      if (result?.data) {
        message.success(result.data.message);
        setBanDialogOpen(false);
        loadUsers(searchQuery);
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error("操作失败");
      console.error(error);
    } finally {
      setIsBanning(false);
    }
  };

  /**
   * 打开充值对话框
   */
  const openGrantDialog = (user: UserWithDetails) => {
    setSelectedUser(user);
    setGrantAmount("");
    setGrantReason("");
    setGrantDialogOpen(true);
  };

  /**
   * 处理充值
   */
  const handleGrant = async () => {
    if (!selectedUser) return;

    const amount = parseInt(grantAmount, 10);
    if (Number.isNaN(amount) || amount <= 0) {
      message.error("请输入有效的积分数量");
      return;
    }

    if (!grantReason.trim()) {
      message.error("请填写充值原因");
      return;
    }

    setIsGranting(true);
    try {
      const result = await adminGrantCreditsAction({
        userId: selectedUser.id,
        amount,
        reason: grantReason.trim(),
      });

      if (result?.data) {
        message.success(result.data.message);
        setGrantDialogOpen(false);
        loadUsers(searchQuery);
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error("充值失败");
      console.error(error);
    } finally {
      setIsGranting(false);
    }
  };

  /**
   * 打开新增用户对话框
   */
  const openCreateDialog = () => {
    setCreateName("");
    setCreateEmail("");
    setCreatePassword("");
    setCreateRole("user");
    setCreateNeedsVerification(false);
    setCreateDialogOpen(true);
  };

  /**
   * 打开编辑用户对话框
   */
  const openEditDialog = (user: UserWithDetails) => {
    setEditingUser(user);
    setEditDialogOpen(true);
  };

  /**
   * 处理新增用户
   */
  const handleCreateUser = async () => {
    if (!createName.trim()) {
      message.error("请输入用户名");
      return;
    }

    if (!createEmail.trim()) {
      message.error("请输入邮箱地址");
      return;
    }

    if (createPassword && createPassword.length < 8) {
      message.error("密码至少需要8位");
      return;
    }

    setIsCreating(true);
    try {
      const result = await createUserAction({
        name: createName.trim(),
        email: createEmail.trim(),
        password: createPassword || undefined,
        role: createRole,
        needsVerification: createNeedsVerification,
      });

      if (result?.data) {
        message.success(result.data.message);
        setCreateDialogOpen(false);
        loadUsers(searchQuery);
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error("创建用户失败");
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * 获取用户名首字母
   */
  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  /**
   * 获取订阅状态显示
   */
  const getSubscriptionBadge = (sub: UserWithDetails["subscription"]) => {
    if (!sub) {
      return (
        <Badge color="default" className="!text-xs">
          无订阅
        </Badge>
      );
    }
    return (
      <Badge
        color={SUB_STATUS_COLOR_MAP[sub.status] ?? "default"}
        className="!text-xs"
      >
        {SUB_STATUS_LABEL[sub.status] ?? "未完成"}
      </Badge>
    );
  };

  // 统计数据
  const totalUsers = users.length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const bannedCount = users.filter((u) => u.banned).length;
  const activeSubscriptions = users.filter(
    (u) => u.subscription?.status === "active"
  ).length;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">用户管理</h2>
          <p className="text-muted-foreground">查看和管理系统中的所有用户</p>
        </div>
        <Button
          type="primary"
          onClick={openCreateDialog}
          icon={<Plus className="h-4 w-4" />}
        >
          新增用户
        </Button>
      </div>

      {/* 统计信息 */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">总用户数</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">{totalUsers}</div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">管理员</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-blue-600">{adminCount}</div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">订阅用户</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-green-600">
              {activeSubscriptions}
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">已封禁</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-red-600">{bannedCount}</div>
          </div>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="pt-6 p-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索邮箱或用户名..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="!pl-10"
              />
            </div>
            <Button type="primary" htmlType="submit" loading={isLoading}>
              搜索
            </Button>
            {searchQuery && (
              <Button
                type="default"
                onClick={() => {
                  setSearchInput("");
                  setSearchQuery("");
                  loadUsers();
                }}
              >
                清除
              </Button>
            )}
          </form>
        </div>
      </div>

      {/* 用户列表 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="text-lg font-semibold leading-none tracking-tight">
            用户列表
            {searchQuery && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                搜索: "{searchQuery}"
              </span>
            )}
          </h3>
        </div>
        <div className="p-6 pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-r-transparent" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? "没有找到匹配的用户" : "暂无用户"}
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3">用户</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">积分</th>
                    <th className="px-4 py-3">订阅</th>
                    <th className="px-4 py-3">角色</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={u.image || undefined}
                            alt={u.name}
                            size={32}
                            className="shrink-0 !bg-primary !text-primary-foreground !text-xs"
                          >
                            {getInitials(u.name)}
                          </Avatar>
                          <div>
                            <span className="font-medium">{u.name}</span>
                            <p className="text-xs text-muted-foreground">
                              {u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {u.banned ? (
                            <Badge color="red" className="!text-xs">
                              已封禁
                            </Badge>
                          ) : u.emailVerified ? (
                            <Badge color="green" className="!text-xs">
                              已验证
                            </Badge>
                          ) : (
                            <Badge color="gold" className="!text-xs">
                              {u.needsVerification ? "需邮箱验证" : "未验证"}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Coins className="h-4 w-4 text-yellow-500" />
                          <span className="font-medium">
                            {u.credits?.balance ?? 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {getSubscriptionBadge(u.subscription)}
                      </td>
                      <td className="px-4 py-3">
                        <UserRoleSelect userId={u.id} currentRole={u.role} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="small"
                            type="default"
                            onClick={() => openEditDialog(u)}
                            title="编辑用户"
                            icon={<Pencil className="h-4 w-4" />}
                          />
                          <Button
                            size="small"
                            type="default"
                            onClick={() => openGrantDialog(u)}
                            title="充值积分"
                            icon={<Coins className="h-4 w-4" />}
                          />
                          <Button
                            size="small"
                            danger={!u.banned}
                            type={u.banned ? "primary" : "default"}
                            onClick={() => openBanDialog(u)}
                            title={u.banned ? "解封" : "封禁"}
                            icon={
                              u.banned ? (
                                <UserCheck className="h-4 w-4" />
                              ) : (
                                <Ban className="h-4 w-4" />
                              )
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 封禁对话框 */}
      <Modal
        open={banDialogOpen}
        onCancel={() => !isBanning && setBanDialogOpen(false)}
        title={selectedUser?.banned ? "解除封禁" : "封禁用户"}
        footer={[
          <Button
            key="cancel"
            type="default"
            onClick={() => setBanDialogOpen(false)}
            disabled={isBanning}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger={!selectedUser?.banned}
            loading={isBanning}
            onClick={handleBan}
          >
            {selectedUser?.banned ? "解除封禁" : "确认封禁"}
          </Button>,
        ]}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {selectedUser?.banned
            ? `确定要解除用户 ${selectedUser?.name} 的封禁吗？`
            : `确定要封禁用户 ${selectedUser?.name} 吗？封禁后该用户将无法登录。`}
        </p>
        {!selectedUser?.banned && (
          <div className="space-y-2">
            <label
              htmlFor="banReason"
              className="text-sm font-medium leading-none"
            >
              封禁原因 (可选)
            </label>
            <Input.TextArea
              id="banReason"
              placeholder="请输入封禁原因..."
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              rows={3}
            />
          </div>
        )}
      </Modal>

      {/* 充值对话框 */}
      <Modal
        open={grantDialogOpen}
        onCancel={() => !isGranting && setGrantDialogOpen(false)}
        title="手动充值积分"
        footer={[
          <Button
            key="cancel"
            type="default"
            onClick={() => setGrantDialogOpen(false)}
            disabled={isGranting}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={isGranting}
            onClick={handleGrant}
          >
            确认充值
          </Button>,
        ]}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          为用户 {selectedUser?.name} 充值积分
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="grantAmount"
              className="text-sm font-medium leading-none"
            >
              积分数量 *
            </label>
            <Input
              id="grantAmount"
              type="number"
              placeholder="请输入积分数量"
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              min={1}
              max={100000}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="grantReason"
              className="text-sm font-medium leading-none"
            >
              充值原因 *
            </label>
            <Input.TextArea
              id="grantReason"
              placeholder="请输入充值原因 (如：客服补偿、活动奖励等)"
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              maxLength={200}
              rows={3}
            />
          </div>
        </div>
      </Modal>

      {/* 新增用户对话框 */}
      <Modal
        open={createDialogOpen}
        onCancel={() => !isCreating && setCreateDialogOpen(false)}
        title="新增用户"
        footer={[
          <Button
            key="cancel"
            type="default"
            onClick={() => setCreateDialogOpen(false)}
            disabled={isCreating}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={isCreating}
            onClick={handleCreateUser}
          >
            确认创建
          </Button>,
        ]}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          手动创建账户。支持设置初始密码和邮箱验证要求。
          无密码账户将强制需要邮箱验证。
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="createName"
              className="text-sm font-medium leading-none"
            >
              姓名 *
            </label>
            <Input
              id="createName"
              placeholder="请输入用户姓名"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              maxLength={50}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="createEmail"
              className="text-sm font-medium leading-none"
            >
              邮箱 *
            </label>
            <Input
              id="createEmail"
              type="email"
              placeholder="请输入邮箱地址"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="createPassword"
              className="text-sm font-medium leading-none"
            >
              密码
              <span className="ml-1 text-xs text-muted-foreground">
                （留空则创建无密码账户）
              </span>
            </label>
            <Input
              id="createPassword"
              placeholder="至少8位（可选）"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="createRole"
              className="text-sm font-medium leading-none"
            >
              角色
            </label>
            <Select
              id="createRole"
              value={createRole}
              onChange={(v) => setCreateRole(v as "user" | "admin")}
              className="w-full"
              options={[
                { value: "user", label: "普通用户" },
                { value: "admin", label: "管理员" },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={createNeedsVerification}
              onChange={(e) => setCreateNeedsVerification(e.target.checked)}
            >
              需要邮箱验证
              <span className="ml-1 text-xs text-muted-foreground">
                {createPassword
                  ? "（用户需验证后登录）"
                  : "（无密码账户，必填）"}
              </span>
            </Checkbox>
          </div>
        </div>
      </Modal>

      {/* 编辑用户对话框 */}
      <UserEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        user={editingUser}
        currentUserId={currentUser?.id}
        onUpdated={() => loadUsers(searchQuery)}
      />
    </div>
  );
}
