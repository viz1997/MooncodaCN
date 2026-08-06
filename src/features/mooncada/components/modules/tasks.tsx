"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileEdit,
  Hammer,
  ListChecks,
  Search,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowAnalysisTrigger } from "@/features/mooncada/components/agent/workflow-analysis";
import {
  EmptyState,
  formatDate,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { MOCK_TASKS } from "@/features/mooncada/lib/mock-data";
import { useMooncadaStore } from "@/features/mooncada/lib/store";
import type { Task, TaskStatus } from "@/features/mooncada/lib/types";
import {
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
} from "@/features/mooncada/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// 状态机：允许的转换
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending_modify: ["pending_produce"],
  pending_produce: ["in_progress"],
  in_progress: ["completed", "pending_modify"],
  completed: [],
};

// 状态图标
const STATUS_ICONS: Record<TaskStatus, typeof Clock> = {
  pending_modify: FileEdit,
  pending_produce: Clock,
  in_progress: Hammer,
  completed: CheckCircle2,
};

const PRIORITY_CONFIG = {
  high: {
    label: "高",
    color:
      "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  },
  medium: {
    label: "中",
    color:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  },
  low: {
    label: "低",
    color:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-300 dark:border-zinc-800",
  },
};

export function TasksModule() {
  const { toast } = useToast();
  const { currentRole } = useMooncadaStore();
  const [tasks, setTasks] = useState<Task[]>(MOCK_TASKS);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [updateTask, setUpdateTask] = useState<Task | null>(null);
  const [newStatus, setNewStatus] = useState<string>("");
  const [remark, setRemark] = useState("");
  const [uploadTask, setUploadTask] = useState<Task | null>(null);

  const filtered = tasks.filter((t) => {
    const matchSearch =
      t.taskId.toLowerCase().includes(search.toLowerCase()) ||
      t.orderId.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const statusCounts = tasks.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const handleStatusUpdate = () => {
    if (!updateTask || !newStatus) return;
    const allowed = ALLOWED_TRANSITIONS[updateTask.status];
    if (!allowed.includes(newStatus as TaskStatus)) {
      toast({
        title: "状态转换不允许",
        description: `${TASK_STATUS_LABELS[updateTask.status]} 不能直接转为 ${TASK_STATUS_LABELS[newStatus as TaskStatus]}`,
        variant: "destructive",
      });
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.taskId === updateTask.taskId
          ? {
              ...t,
              status: newStatus as TaskStatus,
              remark: remark || t.remark,
              updatedAt: new Date().toISOString(),
            }
          : t
      )
    );
    toast({
      title: "任务状态已更新",
      description: `${updateTask.taskId}: ${TASK_STATUS_LABELS[updateTask.status]} → ${TASK_STATUS_LABELS[newStatus as TaskStatus]}`,
    });
    setUpdateTask(null);
    setNewStatus("");
    setRemark("");
  };

  const handleUploadModified = () => {
    if (!uploadTask) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.taskId === uploadTask.taskId
          ? {
              ...t,
              modifiedFileUrl: "#",
              status: "pending_produce",
              updatedAt: new Date().toISOString(),
            }
          : t
      )
    );
    toast({
      title: "修改版已上传",
      description: `${uploadTask.taskId} 已提交，等待生产`,
    });
    setUploadTask(null);
  };

  // 角色权限：admin/operator 可更新，designer 可上传修改版
  const canUpdate = currentRole === "admin" || currentRole === "operator";
  const canUpload = currentRole === "admin" || currentRole === "designer";

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="任务管理"
        description="生产任务状态机管理 · 等待修改 → 等待生产 → 制作中 → 已完成 · 角色权限控制"
        actions={
          <div className="flex items-center gap-2">
            <WorkflowAnalysisTrigger analysisType="task_routing" compact />
            <WorkflowAnalysisTrigger analysisType="anomaly_detection" compact />
          </div>
        }
      />

      {/* 状态机可视化 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-muted-foreground mr-2">状态机：</p>
            {(
              [
                "pending_modify",
                "pending_produce",
                "in_progress",
                "completed",
              ] as TaskStatus[]
            ).map((s, i, arr) => {
              const Icon = STATUS_ICONS[s];
              return (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
                      TASK_STATUS_COLORS[s],
                      filterStatus === s && "ring-2 ring-emerald-500/30"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {TASK_STATUS_LABELS[s]}
                    <span className="ml-1 px-1.5 rounded-full bg-background/60 text-[10px]">
                      {statusCounts[s] || 0}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => setFilterStatus("all")}
            >
              显示全部
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 搜索 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务ID或订单号..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        {filterStatus !== "all" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterStatus("all")}
          >
            清除筛选
          </Button>
        )}
      </div>

      {/* 任务表格 */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ListChecks}
              title="暂无任务"
              description="任务创建后将在此处显示"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[110px]">任务ID</TableHead>
                    <TableHead className="min-w-[120px]">订单号</TableHead>
                    <TableHead className="min-w-[100px]">状态</TableHead>
                    <TableHead className="min-w-[80px]">优先级</TableHead>
                    <TableHead className="min-w-[120px]">设计师</TableHead>
                    <TableHead className="min-w-[140px]">截止时间</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => {
                    const Icon = STATUS_ICONS[t.status];
                    return (
                      <TableRow key={t.taskId} className="hover:bg-muted/50">
                        <TableCell>
                          <span className="font-mono text-xs font-medium">
                            {t.taskId}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{t.orderId}</span>
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => setFilterStatus(t.status)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              TASK_STATUS_COLORS[t.status]
                            )}
                          >
                            <Icon className="h-3 w-3" />
                            {TASK_STATUS_LABELS[t.status]}
                          </button>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
                              PRIORITY_CONFIG[t.priority].color
                            )}
                          >
                            {PRIORITY_CONFIG[t.priority].label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono">
                            {t.designerId ?? "-"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs">{formatDate(t.deadline)}</p>
                          <p
                            className="text-[10px] text-muted-foreground"
                            suppressHydrationWarning
                          >
                            {new Date(t.deadline) < new Date()
                              ? "已超期"
                              : "剩余 " +
                                Math.ceil(
                                  (new Date(t.deadline).getTime() -
                                    Date.now()) /
                                    86400000
                                ) +
                                " 天"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                            {t.remark ?? "-"}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canUpload && t.status === "pending_modify" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setUploadTask(t)}
                              >
                                <Upload className="h-3.5 w-3.5 mr-1" /> 上传修改
                              </Button>
                            )}
                            {canUpdate &&
                              ALLOWED_TRANSITIONS[t.status].length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setUpdateTask(t);
                                    setNewStatus("");
                                    setRemark(t.remark ?? "");
                                  }}
                                >
                                  更新状态
                                </Button>
                              )}
                            {ALLOWED_TRANSITIONS[t.status].length === 0 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-muted-foreground"
                              >
                                已完结
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 状态更新对话框 */}
      <Dialog
        open={!!updateTask}
        onOpenChange={(open) => !open && setUpdateTask(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              更新任务状态
            </DialogTitle>
            <DialogDescription>
              任务 {updateTask?.taskId} · 当前状态:{" "}
              {updateTask && TASK_STATUS_LABELS[updateTask.status]}
            </DialogDescription>
          </DialogHeader>
          {updateTask && (
            <div className="space-y-4 py-2">
              {/* 状态转换可视化 */}
              <div className="flex items-center justify-center gap-3 py-3 bg-muted/30 rounded-lg">
                <div
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium",
                    TASK_STATUS_COLORS[updateTask.status]
                  )}
                >
                  {TASK_STATUS_LABELS[updateTask.status]}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="text-xs text-muted-foreground">选择新状态</div>
              </div>
              <div className="space-y-1.5">
                <Label>新状态</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择允许的状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {ALLOWED_TRANSITIONS[updateTask.status].map((s) => (
                      <SelectItem key={s} value={s}>
                        {TASK_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ALLOWED_TRANSITIONS[updateTask.status].length === 0 && (
                  <p className="text-xs text-rose-600">
                    当前状态为终态，无法继续转换
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>备注</Label>
                <Textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="请输入状态变更说明..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateTask(null)}>
              取消
            </Button>
            <Button
              onClick={handleStatusUpdate}
              disabled={!newStatus}
              className="bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              确认更新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 上传修改版对话框 */}
      <Dialog
        open={!!uploadTask}
        onOpenChange={(open) => !open && setUploadTask(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-violet-600" />
              上传修改版模型
            </DialogTitle>
            <DialogDescription>
              任务 {uploadTask?.taskId} · 上传后状态将变为「等待生产」
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 text-center hover:border-violet-500/50 transition-colors cursor-pointer">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">点击或拖拽文件到此处</p>
              <p className="text-xs text-muted-foreground">
                支持 STL / OBJ / 3MF 格式 · 最大 200MB
              </p>
            </div>
            <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-3 text-xs text-muted-foreground">
              <p className="font-medium text-violet-700 dark:text-violet-400 mb-1">
                上传须知
              </p>
              <p>· 修改版文件将替换原始版本，供操作员使用</p>
              <p>· 上传后任务状态自动变更为「等待生产」</p>
              <p>· 请确保文件完整可打印</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadTask(null)}>
              取消
            </Button>
            <Button
              onClick={handleUploadModified}
              className="bg-gradient-to-r from-violet-500 to-purple-600"
            >
              <Upload className="h-4 w-4 mr-1.5" /> 确认上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
