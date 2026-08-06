"use client";

/**
 * 设计师中心 - 模块组件
 *
 * 仿 mooncada-source/modules/designer.tsx 设计：
 * - 8 张统计卡片（收入 4 张 + 任务 4 张）
 * - 我的任务 + 提现历史 双 Tab
 * - 申请提现对话框
 *
 * 数据使用前端 mock，后续接入 Drizzle 表 + Better Auth 角色（设计师）
 */

import {
  Banknote,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  Palette,
  Plus,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  formatCurrency,
  formatDate,
  ModuleHeader,
  StatCard,
} from "@/features/mooncada/components/shared";
import {
  type DesignerWithdrawalMethod,
  METHOD_LABELS,
  MOCK_DESIGNER_STATS,
  MOCK_DESIGNER_TASKS,
  MOCK_DESIGNER_WITHDRAWALS,
  type MockDesignerWithdrawal,
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  WITHDRAWAL_STATUS_COLORS,
  WITHDRAWAL_STATUS_LABELS,
} from "@/features/mooncada/lib/designer-mock";
import { cn } from "@/lib/utils";

export function DesignerModule() {
  const stats = MOCK_DESIGNER_STATS;
  const [withdrawals, setWithdrawals] = useState<MockDesignerWithdrawal[]>(
    MOCK_DESIGNER_WITHDRAWALS
  );
  const [applyOpen, setApplyOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<DesignerWithdrawalMethod>("alipay");
  const [account, setAccount] = useState("");
  const [remark, setRemark] = useState("");
  const [applying, setApplying] = useState(false);

  const handleApply = () => {
    const amt = Number.parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("请输入有效金额");
      return;
    }
    if (amt > stats.availableBalance) {
      toast.error(
        `余额不足，可提现余额: ${formatCurrency(stats.availableBalance)}`
      );
      return;
    }
    if (!account) {
      toast.error("请输入收款账户");
      return;
    }
    setApplying(true);
    setTimeout(() => {
      const newW: MockDesignerWithdrawal = {
        withdrawalId: `WD_${String(Date.now()).slice(-6)}`,
        designerId: "U_DES_001",
        amount: amt,
        status: "pending",
        method,
        account,
        createdAt: new Date().toISOString(),
        ...(remark ? { remark } : {}),
      };
      setWithdrawals((prev) => [newW, ...prev]);
      setApplying(false);
      setApplyOpen(false);
      setAmount("");
      setAccount("");
      setRemark("");
      toast.success(
        `提现申请已提交 · ${formatCurrency(amt)} · ${METHOD_LABELS[method]} · 等待审核`
      );
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="设计师中心"
        description="欢迎回来，wang · 任务统计、收入管理与提现申请"
        actions={
          <Button
            onClick={() => setApplyOpen(true)}
            className="bg-gradient-to-r from-violet-500 to-purple-600"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            申请提现
          </Button>
        }
      />

      {/* 收入概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Wallet}
          label="可提现余额"
          value={formatCurrency(stats.availableBalance)}
          accent="emerald"
        />
        <StatCard
          icon={Clock}
          label="冻结中"
          value={formatCurrency(stats.frozenBalance)}
          accent="amber"
        />
        <StatCard
          icon={TrendingUp}
          label="本月收入"
          value={formatCurrency(stats.monthlyEarnings)}
          trend="+12.5%"
          trendUp
          accent="sky"
        />
        <StatCard
          icon={DollarSign}
          label="累计收入"
          value={formatCurrency(stats.totalEarnings)}
          accent="teal"
        />
      </div>

      {/* 任务统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={CheckCircle2}
          label="已完成任务"
          value={stats.completedCount}
          accent="emerald"
        />
        <StatCard
          icon={Clock}
          label="待办任务"
          value={stats.pendingCount}
          accent="amber"
        />
        <StatCard
          icon={Loader2}
          label="进行中"
          value={stats.inProgressCount}
          accent="violet"
        />
        <StatCard
          icon={FileText}
          label="总任务数"
          value={
            stats.completedCount + stats.pendingCount + stats.inProgressCount
          }
          accent="sky"
        />
      </div>

      <Tabs defaultValue="tasks" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="tasks">我的任务</TabsTrigger>
          <TabsTrigger value="withdrawals">提现历史</TabsTrigger>
        </TabsList>

        {/* 我的任务 */}
        <TabsContent value="tasks">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-violet-600" />
                我的任务列表
              </CardTitle>
              <CardDescription className="text-xs">
                分配给我的设计任务，含「等待审核」状态
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {MOCK_DESIGNER_TASKS.length === 0 ? (
                <div className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
                  <FileText className="h-10 w-10 mb-3" />
                  <p className="font-medium">暂无任务</p>
                  <p className="text-sm">任务分配后将在此处显示</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium">
                          任务ID
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          订单号
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          状态
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          截止时间
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          备注
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {MOCK_DESIGNER_TASKS.map((t) => (
                        <tr key={t.taskId} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-xs">
                            {t.taskId}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {t.orderId}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                TASK_STATUS_COLORS[t.status]
                              )}
                            >
                              {TASK_STATUS_LABELS[t.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {formatDate(t.deadline)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[200px]">
                            {t.remark ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 提现历史 */}
        <TabsContent value="withdrawals">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Banknote className="h-4 w-4 text-violet-600" />
                提现记录
              </CardTitle>
              <CardDescription className="text-xs">
                共 {withdrawals.length} 笔提现申请
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {withdrawals.length === 0 ? (
                <div className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
                  <Banknote className="h-10 w-10 mb-3" />
                  <p className="font-medium">暂无提现记录</p>
                  <p className="text-sm">点击右上角按钮申请第一笔提现</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium">
                          提现ID
                        </th>
                        <th className="text-right px-4 py-3 font-medium">
                          金额
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          方式
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          账户
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          状态
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          申请时间
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {withdrawals.map((w) => (
                        <tr key={w.withdrawalId} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-xs">
                            {w.withdrawalId}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {formatCurrency(w.amount)}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {METHOD_LABELS[w.method]}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono">
                            {w.account}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                WITHDRAWAL_STATUS_COLORS[w.status]
                              )}
                            >
                              {WITHDRAWAL_STATUS_LABELS[w.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {formatDate(w.createdAt, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 申请提现对话框 */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-violet-600" />
              申请提现
            </DialogTitle>
            <DialogDescription>
              可提现余额: {formatCurrency(stats.availableBalance)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">可提现余额</p>
                <p className="text-xl font-bold text-violet-700 dark:text-violet-400">
                  {formatCurrency(stats.availableBalance)}
                </p>
              </div>
              <Wallet className="h-8 w-8 text-violet-500/40" />
            </div>
            <div className="space-y-1.5">
              <Label>提现金额 (CNY)</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="请输入提现金额"
              />
              <div className="flex gap-1.5">
                {[1000, 3000, 5000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className="text-xs px-2 py-0.5 rounded border hover:bg-muted"
                  >
                    ¥{v}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAmount(String(stats.availableBalance))}
                  className="text-xs px-2 py-0.5 rounded border hover:bg-muted text-violet-600"
                >
                  全部提现
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>提现方式</Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as DesignerWithdrawalMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alipay">支付宝</SelectItem>
                  <SelectItem value="wechat">微信</SelectItem>
                  <SelectItem value="bank">银行卡</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>收款账户</Label>
              <Input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={
                  method === "alipay"
                    ? "支付宝账号"
                    : method === "wechat"
                      ? "微信号"
                      : "银行卡号"
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>备注（可选）</Label>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="如有特殊说明请填写..."
                rows={2}
              />
            </div>
            <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5">
              <p>· 设计费提现将在3-5个工作日内到账</p>
              <p>· 单笔最低提现金额 ¥100</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying}
              className="bg-gradient-to-r from-violet-500 to-purple-600"
            >
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  提交中...
                </>
              ) : (
                "提交申请"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
