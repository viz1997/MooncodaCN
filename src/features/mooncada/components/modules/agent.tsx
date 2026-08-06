"use client";

/**
 * 代理商中心 - 模块组件
 *
 * 仿 mooncada-source/modules/agent.tsx 设计：
 * - 4 张佣金统计卡片（可提现/冻结中/本月/累计）
 * - 推广信息卡片（推荐码 + 链接 + 推荐统计）
 * - 推广二维码卡片（外链 QR）
 * - 提现记录表格
 * - 申请提现对话框
 *
 * 数据使用前端 mock（MOCK_AGENT_INFO / MOCK_WITHDRAWALS），后续接入 Drizzle 表 + Better Auth 角色
 */

import {
  Banknote,
  Clock,
  Copy,
  DollarSign,
  Link as LinkIcon,
  Loader2,
  Plus,
  QrCode,
  Share2,
  Store,
  TrendingUp,
  Users,
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
import { Textarea } from "@/components/ui/textarea";
import {
  formatCurrency,
  formatDate,
  ModuleHeader,
  StatCard,
} from "@/features/mooncada/components/shared";
import {
  METHOD_LABELS,
  MOCK_AGENT_INFO,
  MOCK_WITHDRAWALS,
  type MockWithdrawal,
  WITHDRAWAL_STATUS_COLORS,
  WITHDRAWAL_STATUS_LABELS,
  type WithdrawalMethod,
} from "@/features/mooncada/lib/agent-mock";
import { cn } from "@/lib/utils";

export function AgentModule() {
  const info = MOCK_AGENT_INFO;
  const [withdrawals, setWithdrawals] =
    useState<MockWithdrawal[]>(MOCK_WITHDRAWALS);
  const [applyOpen, setApplyOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<WithdrawalMethod>("alipay");
  const [account, setAccount] = useState("");
  const [remark, setRemark] = useState("");
  const [applying, setApplying] = useState(false);

  const handleCopy = async (text: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
    toast.success(`已复制 ${label}`);
  };

  const handleApply = () => {
    const amt = Number.parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("请输入有效金额");
      return;
    }
    if (amt > info.availableBalance) {
      toast.error(
        `余额不足，可提现佣金: ${formatCurrency(info.availableBalance)}`
      );
      return;
    }
    if (!account) {
      toast.error("请输入收款账户");
      return;
    }
    setApplying(true);
    setTimeout(() => {
      const newW: MockWithdrawal = {
        withdrawalId: `PWD_${String(Date.now()).slice(-6)}`,
        proxyId: info.proxyId,
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
        title="代理商中心"
        description={`欢迎回来，${info.name} · 推广链接、佣金管理与提现申请`}
        actions={
          <Button
            onClick={() => setApplyOpen(true)}
            className="bg-gradient-to-r from-amber-500 to-orange-600"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            申请提现
          </Button>
        }
      />

      {/* 佣金概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Wallet}
          label="可提现佣金"
          value={formatCurrency(info.availableBalance)}
          accent="emerald"
        />
        <StatCard
          icon={Clock}
          label="冻结中"
          value={formatCurrency(info.frozenBalance)}
          accent="amber"
        />
        <StatCard
          icon={TrendingUp}
          label="本月佣金"
          value={formatCurrency(info.monthlyCommission)}
          trend="+18.2%"
          trendUp
          accent="sky"
        />
        <StatCard
          icon={DollarSign}
          label="累计佣金"
          value={formatCurrency(info.totalCommission)}
          accent="teal"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 推广信息 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Share2 className="h-4 w-4 text-amber-600" />
              推广信息
            </CardTitle>
            <CardDescription className="text-xs">
              分享专属链接，推荐用户购买即获佣金
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 推荐码 */}
            <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">我的推荐码</p>
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold font-mono tracking-wider text-amber-700 dark:text-amber-400">
                  {info.referralCode}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(info.referralCode, "推荐码")}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  复制
                </Button>
              </div>
            </div>
            {/* 推广链接 */}
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">推广链接</p>
              <div className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-mono truncate flex-1">
                  {info.referralUrl}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCopy(info.referralUrl, "推广链接")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {/* 推荐统计 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="h-3.5 w-3.5 text-sky-600" />
                  <p className="text-xs text-muted-foreground">已推荐用户</p>
                </div>
                <p className="text-xl font-bold">{info.referredUsers}</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                  <p className="text-xs text-muted-foreground">人均贡献</p>
                </div>
                <p className="text-xl font-bold">
                  {formatCurrency(info.totalCommission / info.referredUsers)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 二维码 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4 text-amber-600" />
              推广二维码
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div className="bg-white p-3 rounded-lg border">
              {/* biome-ignore lint/performance/noImgElement: 外部 QR 图（api.qrserver.com）需原生 img */}
              <img
                src={info.qrcodeUrl}
                alt="推广二维码"
                className="w-40 h-40"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              扫码进入专属推广页面
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => handleCopy(info.referralUrl, "推广链接")}
            >
              <Share2 className="h-3 w-3 mr-1" />
              分享链接
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 提现历史 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="h-4 w-4 text-amber-600" />
            提现记录
          </CardTitle>
          <CardDescription className="text-xs">
            共 {withdrawals.length} 笔提现申请
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {withdrawals.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
              <Store className="h-10 w-10 mb-3" />
              <p className="font-medium">暂无提现记录</p>
              <p className="text-sm">点击右上角按钮申请第一笔提现</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">提现ID</th>
                    <th className="text-right px-4 py-3 font-medium">金额</th>
                    <th className="text-left px-4 py-3 font-medium">方式</th>
                    <th className="text-left px-4 py-3 font-medium">账户</th>
                    <th className="text-left px-4 py-3 font-medium">状态</th>
                    <th className="text-left px-4 py-3 font-medium">
                      申请时间
                    </th>
                    <th className="text-left px-4 py-3 font-medium">
                      处理时间
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
                      <td className="px-4 py-3 text-xs">
                        {w.processedAt ? formatDate(w.processedAt, true) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 提现申请对话框 */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-amber-600" />
              申请提现
            </DialogTitle>
            <DialogDescription>
              可提现佣金: {formatCurrency(info.availableBalance)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">可提现佣金</p>
                <p className="text-xl font-bold text-amber-700 dark:text-amber-400">
                  {formatCurrency(info.availableBalance)}
                </p>
              </div>
              <Wallet className="h-8 w-8 text-amber-500/40" />
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
                {[1000, 2000, 5000].map((v) => (
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
                  onClick={() => setAmount(String(info.availableBalance))}
                  className="text-xs px-2 py-0.5 rounded border hover:bg-muted text-amber-600"
                >
                  全部提现
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>提现方式</Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as WithdrawalMethod)}
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
              <p>· 佣金提现将在3-5个工作日内到账</p>
              <p>· 单笔最低提现金额 ¥100</p>
              <p>
                · 佣金比例: 订单金额的 {(info.commissionRate * 100).toFixed(0)}%
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying}
              className="bg-gradient-to-r from-amber-500 to-orange-600"
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
