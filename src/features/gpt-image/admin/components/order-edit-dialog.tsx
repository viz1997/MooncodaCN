"use client";

import { Loader2, Minus, Plus } from "lucide-react";
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

import { updateOrderAction } from "@/features/gpt-image/actions/orders";
import {
  ORDER_PLATFORM_LABELS,
  ORDER_PLATFORMS,
  type OrderPlatform,
  type OrderView,
} from "@/features/gpt-image/lib/types";

interface OrderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待编辑订单；null 时对话框不渲染内容 */
  order: OrderView | null;
  /** 编辑成功回调，传入最新 OrderView（用于乐观替换列表中的旧条目） */
  onUpdated: (order: OrderView) => void;
}

export function OrderEditDialog({
  open,
  onOpenChange,
  order,
  onUpdated,
}: OrderEditDialogProps) {
  const [orderNo, setOrderNo] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [platform, setPlatform] = useState<OrderPlatform | "">("");
  const [uploadCount, setUploadCount] = useState(1);
  const [saving, setSaving] = useState(false);

  // 每次打开时用 order 字段填充表单
  useEffect(() => {
    if (!open || !order) return;
    setOrderNo(order.orderNo);
    setRecipientName(order.recipientName ?? "");
    setPlatform((order.platform ?? "") as OrderPlatform | "");
    setUploadCount(order.uploadCount);
  }, [open, order]);

  const handleSave = async () => {
    if (!order) return;
    if (!orderNo.trim()) {
      toast.error("请输入订单号");
      return;
    }
    setSaving(true);
    try {
      const res = await updateOrderAction({
        id: order.id,
        orderNo: orderNo.trim(),
        recipientName: recipientName.trim(),
        platform: platform || null,
        uploadCount,
      });
      if (!res?.data) throw new Error("保存失败");
      toast.success("订单已更新");
      onUpdated(res.data.order);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑订单</DialogTitle>
          <DialogDescription>
            仅业务字段（订单号、收件人、平台、上传数量）可改；模板、访问链接、状态、上传内容保持不变。
          </DialogDescription>
        </DialogHeader>

        {!order ? null : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-ord-no">
                订单号 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-ord-no"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                订单号不必唯一；改完后历史访问链接不受影响（token 未动）。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-recipient">收件人（昵称/标识）</Label>
              <Input
                id="edit-recipient"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                maxLength={100}
                placeholder="留空表示未指定"
              />
            </div>

            <div className="space-y-2">
              <Label>来源平台</Label>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as OrderPlatform | "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="未指定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">未指定</SelectItem>
                  {ORDER_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {ORDER_PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-upload-count">用户上传图片数量</Label>
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
                  id="edit-upload-count"
                  type="number"
                  min={1}
                  max={50}
                  value={uploadCount}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setUploadCount(
                      Number.isNaN(n) ? 1 : Math.min(50, Math.max(1, n))
                    );
                  }}
                  className="text-center"
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
                修改后用户可继续按新数量上传；超出原数量的部分也会被保留。
              </p>
            </div>

            <div className="rounded-md border bg-slate-50 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-slate-700">不可修改</div>
              <ul className="list-inside list-disc space-y-0.5">
                <li>模板：{order.template.name}</li>
                <li>访问链接：/p/{order.token}</li>
                <li>状态：{order.status}</li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !order}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
