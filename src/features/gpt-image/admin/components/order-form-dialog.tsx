"use client";

import {
  ChevronDown,
  HelpCircle,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  checkOrderNoConflictAction,
  createOrderAction,
} from "@/features/gpt-image/actions/orders";

import {
  ORDER_PLATFORM_LABELS,
  ORDER_PLATFORMS,
  type OrderPlatform,
  type OrderView,
  type PromptTemplateView,
} from "@/features/gpt-image/lib/types";

interface OrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PromptTemplateView[];
  /** 模板是否仍在加载（区分"还在拉"与"拉完但没有"） */
  templatesLoading?: boolean | undefined;
  /** 模板加载失败的错误信息；非空时显示红色提示 + 重新加载按钮 */
  templatesError?: string | null | undefined;
  /** 触发父组件重新调用 fetchTemplates */
  onRetryTemplates?: () => void;
  /** 创建成功回调，传入完整 OrderView（用于乐观插入列表） */
  onCreated: (order: OrderView) => void;
}

/**
 * 冲突的现有订单信息（来自 checkOrderNoConflictAction）
 */
interface ConflictOrder {
  id: string;
  orderNo: string;
  recipientName: string;
  templateName: string;
  createdAt: string;
}

export function OrderFormDialog({
  open,
  onOpenChange,
  templates,
  templatesLoading = false,
  templatesError = null,
  onRetryTemplates,
  onCreated,
}: OrderFormDialogProps) {
  const [orderNo, setOrderNo] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [platform, setPlatform] = useState<OrderPlatform | "">("");
  const [uploadCount, setUploadCount] = useState(1);
  const [imagesPerUpload, setImagesPerUpload] = useState(3);
  const [regenerateLimit, setRegenerateLimit] = useState(5);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 冲突确认弹窗的待覆盖订单 */
  const [pendingConflict, setPendingConflict] = useState<ConflictOrder | null>(
    null
  );
  /** 冲突检查的 loading，避免按钮闪烁 */
  const [checkingConflict, setCheckingConflict] = useState(false);

  useEffect(() => {
    if (open) {
      setOrderNo("");
      setTemplateId(templates[0]?.id || "");
      setRecipientName("");
      setPlatform("");
      setUploadCount(1);
      setImagesPerUpload(3);
      setRegenerateLimit(5);
      setPendingConflict(null);
    }
  }, [open, templates]);

  /**
   * 真正下单（覆盖分支复用此函数）
   */
  const submitCreate = async (replaceOrderId?: string) => {
    setSaving(true);
    try {
      const res = await createOrderAction({
        orderNo: orderNo.trim(),
        templateId,
        recipientName: recipientName.trim() || undefined,
        platform: platform || undefined,
        uploadCount,
        imagesPerUpload,
        regenerateLimit,
        ...(replaceOrderId ? { replaceOrderId } : {}),
      });
      if (!res?.data) {
        // 不吞错：把 next-safe-action 的真实 serverError / validationErrors 冒
        // 到 toast，否则 DB 抖动、模板被删、session 过期、Zod 校验失败都会
        // 被压成同一个"创建失败"，运维和用户都看不到根因。
        const errorPayload = res as unknown as {
          serverError?: string;
          validationErrors?: Record<string, string[] | undefined>;
        };
        let detail = "创建失败";
        if (errorPayload.serverError) {
          detail = errorPayload.serverError;
        } else if (errorPayload.validationErrors) {
          const fields = Object.entries(errorPayload.validationErrors)
            .map(
              ([k, v]) =>
                `${k}: ${Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v ?? "")}`
            )
            .filter(Boolean)
            .join("；");
          detail = fields || "参数校验失败";
        }
        throw new Error(detail);
      }
      toast.success(replaceOrderId ? "已覆盖旧订单" : "订单已创建，链接已生成");
      onCreated(res.data.order);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!orderNo.trim() || !templateId) {
      toast.error("请填写订单号并选择模板");
      return;
    }
    setCheckingConflict(true);
    try {
      const checkRes = await checkOrderNoConflictAction({
        orderNo: orderNo.trim(),
      });
      if (checkRes?.data?.conflict && checkRes.data.existing) {
        // 弹出冲突确认；用户点"覆盖"才真正下单
        setPendingConflict(checkRes.data.existing);
        return;
      }
    } catch (e) {
      console.error("冲突检查失败，继续创建", e);
    } finally {
      setCheckingConflict(false);
    }
    await submitCreate();
  };

  const activeTemplates = templates.filter((t) => t.isActive);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建订单并生成链接</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-x-3 gap-y-4 py-2">
          {/* 横向 label-input 布局：每行 [140px label] [1fr control] */}
          <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
            <div className="flex items-center gap-1">
              <Label htmlFor="ord-no">
                订单号 <span className="text-red-500">*</span>
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="订单号说明"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  业务标识，作为链接的一部分发给用户。订单号不必唯一，多订单可复用。
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="ord-no"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              placeholder="如：ORD-20260803-001"
            />
          </div>

          <div className="grid grid-cols-[140px_1fr] items-start gap-x-3">
            <Label className="pt-2">
              关联模板 <span className="text-red-500">*</span>
            </Label>
            <div className="space-y-1.5">
              {templatesLoading ? (
                <>
                  <Select value="" disabled>
                    <SelectTrigger className="opacity-60">
                      <SelectValue placeholder="加载模板中…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_loading" disabled>
                        加载模板中…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    正在从 /api/templates 拉取可用模板…
                  </p>
                </>
              ) : templatesError ? (
                <>
                  <Select value="" disabled>
                    <SelectTrigger className="opacity-60">
                      <SelectValue placeholder="模板加载失败" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_error" disabled>
                        模板加载失败
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-2.5 space-y-1.5">
                    <p className="text-[10px] text-rose-700 dark:text-rose-400 font-medium">
                      模板加载失败
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono break-all">
                      {templatesError}
                    </p>
                    {onRetryTemplates && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={onRetryTemplates}
                      >
                        <RefreshCw className="mr-1 h-3 w-3" />
                        重新加载
                      </Button>
                    )}
                  </div>
                </>
              ) : activeTemplates.length === 0 ? (
                <>
                  <Select value="" disabled>
                    <SelectTrigger className="opacity-60">
                      <SelectValue placeholder="暂无启用的模板" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_empty" disabled>
                        暂无启用的模板
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 space-y-1">
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                      还没有可用的提示词模板
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      请先在
                      <a
                        href="/admin/prompt-templates"
                        className="text-violet-600 hover:underline mx-0.5"
                      >
                        提示词模板管理
                      </a>
                      新建并启用模板后再来创建订单。模板里
                      <code className="mx-0.5 px-1 py-0.5 rounded bg-muted text-[9px] font-mono">
                        isActive=false
                      </code>
                      的不会出现在此下拉里。
                    </p>
                  </div>
                </>
              ) : (
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择模板" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
            <div className="flex items-center gap-1">
              <Label htmlFor="ord-upload-count">
                用户上传批次（次数） <span className="text-red-500">*</span>
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="用户上传批次说明"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  用户最多可分多少次上传原图（每次上传算 1 批）。默认 1
                  批，多张图 订单需要更多批次时可调高。建议 1-3 批，最多 10 批。
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-stretch gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setUploadCount((n) => Math.max(1, n - 1))}
                disabled={uploadCount <= 1}
                aria-label="减少"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id="ord-upload-count"
                type="number"
                min={1}
                max={10}
                value={uploadCount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  const clamped = Math.max(1, Math.min(10, Math.floor(v)));
                  setUploadCount(clamped);
                }}
                className="text-center font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setUploadCount((n) => Math.min(10, n + 1))}
                disabled={uploadCount >= 10}
                aria-label="增加"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
            <div className="flex items-center gap-1">
              <Label htmlFor="ord-recipient">
                用户昵称{" "}
                <span className="text-xs font-normal text-zinc-400">
                  （选填）
                </span>
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="用户昵称说明"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  留空时不会在任何页面显示昵称
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="ord-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="如：张三 / user_001"
            />
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
            <div className="flex items-center gap-1">
              <Label>
                来源平台{" "}
                <span className="text-xs font-normal text-zinc-400">
                  （选填）
                </span>
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="来源平台说明"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  标识此订单从哪个渠道分发，便于后续统计
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={platform}
              onValueChange={(v) => setPlatform(v as OrderPlatform | "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="未指定" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">未指定</SelectItem>
                {ORDER_PLATFORMS.map((p: OrderPlatform) => (
                  <SelectItem key={p} value={p}>
                    {ORDER_PLATFORM_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 高级设置 —— 不常用字段折叠起来，默认收起保持表单简洁 */}
          <Collapsible
            open={showAdvanced}
            onOpenChange={setShowAdvanced}
            className="rounded-lg border border-dashed border-stone-200 bg-stone-50/50 px-3"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group flex w-full items-center justify-between py-2.5 text-left text-sm text-stone-600 transition-colors hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
              >
                <span className="flex items-center gap-1.5">
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-0" : "-rotate-90"}`}
                  />
                  更多设置
                </span>
                <span className="text-xs text-stone-400">
                  {showAdvanced ? "收起" : "每批张数 / 重新生成次数"}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-1 gap-y-4 pb-3">
                <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="ord-images-per-upload">
                      每批上传原图数量 <span className="text-red-500">*</span>
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="每批上传原图数量说明"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        用户每次上传会话最多塞几张参考图。多张图被融合为单次生图输入。
                        默认 3 张，可选 1-3 张。订单总容量 = 批次 × 每批张数。
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-stretch gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() =>
                        setImagesPerUpload((n) => Math.max(1, n - 1))
                      }
                      disabled={imagesPerUpload <= 1}
                      aria-label="减少"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      id="ord-images-per-upload"
                      type="number"
                      min={1}
                      max={3}
                      value={imagesPerUpload}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        const clamped = Math.max(1, Math.min(3, Math.floor(v)));
                        setImagesPerUpload(clamped);
                      }}
                      className="text-center font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() =>
                        setImagesPerUpload((n) => Math.min(3, n + 1))
                      }
                      disabled={imagesPerUpload >= 3}
                      aria-label="增加"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="ord-regenerate-limit">
                      用户重新生成次数上限
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="重新生成次数上限说明"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        仅"重新生成第 N 张"（单图路径）计数；批量重跑 / FAILED
                        一键重试不计。设为 0 表示禁止用户主动重新生成。
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-stretch gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() =>
                        setRegenerateLimit((n) => Math.max(0, n - 1))
                      }
                      disabled={regenerateLimit <= 0}
                      aria-label="减少"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      id="ord-regenerate-limit"
                      type="number"
                      min={0}
                      max={20}
                      value={regenerateLimit}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        const clamped = Math.max(
                          0,
                          Math.min(20, Math.floor(v))
                        );
                        setRegenerateLimit(clamped);
                      }}
                      className="text-center font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() =>
                        setRegenerateLimit((n) => Math.min(20, n + 1))
                      }
                      disabled={regenerateLimit >= 20}
                      aria-label="增加"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-4 w-4" /> 取消
          </Button>
          <Button onClick={handleCreate} disabled={saving || checkingConflict}>
            {saving || checkingConflict ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />{" "}
                {checkingConflict ? "检查中…" : "创建中…"}
              </>
            ) : (
              "创建并生成链接"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 订单号冲突确认 —— 询问是否覆盖旧订单 */}
      <Dialog
        open={!!pendingConflict}
        onOpenChange={(o) => !o && setPendingConflict(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>订单号已存在</DialogTitle>
            <DialogDescription>
              你已有一个名为{" "}
              <span className="font-mono">{pendingConflict?.orderNo}</span>{" "}
              的订单。
              <br />
              覆盖会用本次填写的收件人/平台/上传数量替换旧订单的业务字段，
              模板、访问链接、状态、上传内容保持不变。
            </DialogDescription>
          </DialogHeader>
          {pendingConflict && (
            <div className="rounded-md border bg-slate-50 p-3 text-xs space-y-1">
              <div>
                <span className="text-muted-foreground">旧订单模板：</span>
                {pendingConflict.templateName}
              </div>
              <div>
                <span className="text-muted-foreground">旧收件人：</span>
                {pendingConflict.recipientName || (
                  <span className="italic text-zinc-400">未指定</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">创建时间：</span>
                {new Date(pendingConflict.createdAt).toLocaleString("zh-CN")}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingConflict(null)}
              disabled={saving}
            >
              取消（回去改订单号）
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const targetId = pendingConflict?.id;
                setPendingConflict(null);
                if (targetId) void submitCreate(targetId);
              }}
              disabled={saving || !pendingConflict}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> 覆盖中…
                </>
              ) : (
                "确认覆盖"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
