"use client";

/**
 * 产品效果编辑/新建 Dialog
 *
 * 复用 product-effect-form 的字段逻辑，包装在 Dialog 中。
 * 创建/编辑的区分通过是否传入 initialData 实现（与 mooncada-source EditDialog 一致）。
 */

import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductEffectForm } from "@/features/image-gen/admin/components/product-effect-form";
import type { ProductEffect } from "@/features/image-gen/lib/product-effect-types";

interface EditEffectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  effect?: ProductEffect | null;
}

export function EditEffectDialog({
  open,
  onOpenChange,
  effect,
}: EditEffectDialogProps) {
  const router = useRouter();
  const isEdit = !!effect;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isEdit ? `编辑效果模板 · ${effect?.maskId}` : "新建效果模板"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? "修改提示词、变量、产品线关联等字段；保存后立即生效"
              : "填写基本信息与提示词；支持 {{变量}} 占位符"}
          </DialogDescription>
        </DialogHeader>

        <ProductEffectForm
          {...(effect ? { initialData: effect } : {})}
          onSaved={() => {
            onOpenChange(false);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
