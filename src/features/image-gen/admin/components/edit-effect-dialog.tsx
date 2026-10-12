"use client";

/**
 * 产品效果编辑/新建 Modal
 *
 * 复用 product-effect-form 的字段逻辑，包装在 Modal 中。
 * 创建/编辑的区分通过是否传入 initialData 实现（与 mooncada-source EditDialog 一致）。
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）
 * - shadcn Dialog → antd Modal
 */

import { Modal } from "antd";
import { useRouter } from "next/navigation";

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
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      title={
        <span className="text-base">
          {isEdit ? `编辑效果模板 · ${effect?.maskId}` : "新建效果模板"}
        </span>
      }
      footer={null}
      width={672}
    >
      <p className="text-xs text-muted-foreground mb-4">
        {isEdit
          ? "修改提示词、变量、产品线关联等字段；保存后立即生效"
          : "填写基本信息与提示词；支持 {{变量}} 占位符"}
      </p>

      <ProductEffectForm
        {...(effect ? { initialData: effect } : {})}
        onSaved={() => {
          onOpenChange(false);
          router.refresh();
        }}
      />
    </Modal>
  );
}
