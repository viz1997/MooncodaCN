"use client";

import { Loader2, Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  onCreated,
}: OrderFormDialogProps) {
  const [orderNo, setOrderNo] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [platform, setPlatform] = useState<OrderPlatform | "">("");
  const [uploadCount, setUploadCount] = useState(1);
  const [imagesPerUpload, setImagesPerUpload] = useState(3);
  const [regenerateLimit, setRegenerateLimit] = useState(5);
  const [saving, setSaving] = useState(false);
  /** 冲突确认弹窗的待覆盖订单 */
  const [pendingConflict, setPendingConflict] = useState<ConflictOrder | null>(
    null
  );
  /** 冲突检查的 loading，避免按钮闪烁 */
  const [checkingConflict, setCheckingConflict] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === templateId);

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
      if (!res?.data) throw new Error("创建失败");
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>创建订单并生成链接</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="ord-no">
              订单号 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="ord-no"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              placeholder="如：ORD-20260803-001"
            />
            <p className="text-xs text-muted-foreground">
              业务标识，作为链接的一部分发给用户。订单号不必唯一，多订单可复用。
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              关联模板 <span className="text-red-500">*</span>
            </Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="选择模板" />
              </SelectTrigger>
              <SelectContent>
                {activeTemplates.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    无可用模板
                  </SelectItem>
                ) : (
                  activeTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedTemplate && (
              <p className="text-xs text-muted-foreground">
                模型会生成{" "}
                <span className="font-medium text-emerald-700">
                  {selectedTemplate.candidateCount} 种效果
                </span>
                ，拼接成 1 张图（
                {selectedTemplate.candidateCount === 1
                  ? "整张图"
                  : selectedTemplate.candidateCount === 2
                    ? "1×2 横向"
                    : selectedTemplate.candidateCount === 4
                      ? "2×2"
                      : "3×3"}{" "}
                宫格），用户从中选喜欢的 1 个
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ord-upload-count">
              用户上传批次（次数） <span className="text-red-500">*</span>
            </Label>
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
            <p className="text-xs text-muted-foreground">
              用户最多可分多少次上传原图（每次上传算 1 批）。默认 1 批，多张图
              订单需要更多批次时可调高。建议 1-3 批，最多 10 批。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ord-images-per-upload">
              每批上传原图数量 <span className="text-red-500">*</span>
            </Label>
            <div className="flex items-stretch gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setImagesPerUpload((n) => Math.max(1, n - 1))}
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
                onClick={() => setImagesPerUpload((n) => Math.min(3, n + 1))}
                disabled={imagesPerUpload >= 3}
                aria-label="增加"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              用户每次上传会话最多塞几张参考图。多张图被融合为单次生图输入。
              默认 3 张，可选 1-3 张。订单总容量 = 批次 × 每批张数。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ord-regenerate-limit">用户重新生成次数上限</Label>
            <div className="flex items-stretch gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setRegenerateLimit((n) => Math.max(0, n - 1))}
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
                  const clamped = Math.max(0, Math.min(20, Math.floor(v)));
                  setRegenerateLimit(clamped);
                }}
                className="text-center font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setRegenerateLimit((n) => Math.min(20, n + 1))}
                disabled={regenerateLimit >= 20}
                aria-label="增加"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              仅"重新生成第 N 张"（单图路径）计数；批量重跑 / FAILED
              一键重试不计。 设为 0 表示禁止用户主动重新生成。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ord-recipient">
              用户昵称{" "}
              <span className="text-xs font-normal text-zinc-400">
                （选填）
              </span>
            </Label>
            <Input
              id="ord-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="如：张三 / user_001"
            />
            <p className="text-xs text-muted-foreground">
              留空时不会在任何页面显示昵称
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              来源平台{" "}
              <span className="text-xs font-normal text-zinc-400">
                （选填）
              </span>
            </Label>
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
            <p className="text-xs text-muted-foreground">
              标识此订单从哪个渠道分发，便于后续统计
            </p>
          </div>
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
