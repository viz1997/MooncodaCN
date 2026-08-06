"use client";

import { Loader2, Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

import { createOrderAction } from "@/features/gpt-image/actions/orders";
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
  const [saving, setSaving] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  useEffect(() => {
    if (open) {
      setOrderNo("");
      setTemplateId(templates[0]?.id || "");
      setRecipientName("");
      setPlatform("");
      setUploadCount(1);
    }
  }, [open, templates]);

  const handleCreate = async () => {
    if (!orderNo.trim() || !templateId) {
      toast.error("请填写订单号并选择模板");
      return;
    }
    setSaving(true);
    try {
      const res = await createOrderAction({
        orderNo: orderNo.trim(),
        templateId,
        recipientName: recipientName.trim() || undefined,
        platform: platform || undefined,
        uploadCount,
      });
      if (!res?.data) throw new Error("创建失败");
      toast.success("订单已创建，链接已生成");
      // 乐观插入：父组件立即把新订单加到列表顶部，避免空白闪烁
      onCreated(res.data.order);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
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
              业务唯一标识，将作为链接的一部分发给用户
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
              用户上传图片数量 <span className="text-red-500">*</span>
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
                max={50}
                value={uploadCount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  const clamped = Math.max(1, Math.min(50, Math.floor(v)));
                  setUploadCount(clamped);
                }}
                className="text-center font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setUploadCount((n) => Math.min(50, n + 1))}
                disabled={uploadCount >= 50}
                aria-label="增加"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              用户需上传此数量的图片才能触发生成。多张图将被融合为单次生图输入。建议
              1-10 张，最多 50 张。
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
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> 创建中…
              </>
            ) : (
              "创建并生成链接"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
