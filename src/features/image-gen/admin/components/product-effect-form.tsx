"use client";

/**
 * 产品效果表单（编辑/新建共用）
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）
 * - shadcn Card → 内联 div
 * - shadcn Badge/Button/Checkbox/Input/Label/Select/Textarea → antd
 * - sonner toast → antd App.useApp().message
 */

import { App, Badge, Button, Checkbox, Form, Input, Select } from "antd";
import { History, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

import {
  addProductEffectVersionAction,
  createProductEffectAdminAction,
  updateProductEffectAdminAction,
} from "@/features/image-gen/admin/actions";
import { IMAGE_MODEL_LIST } from "@/features/image-gen/lib/image-models/types";
import type {
  ProductEffect,
  PromptVariable,
} from "@/features/image-gen/lib/product-effect-types";
import {
  PROMPT_SCENE_LABELS,
  type PromptScene,
} from "@/features/image-gen/lib/product-effect-types";
import { MOCK_PRODUCT_LINES } from "@/features/image-gen/lib/product-lines-mock";
import { cn } from "@/lib/utils";

interface ProductEffectFormProps {
  initialData?: ProductEffect;
  /**
   * 保存成功回调；不传则默认跳回列表页
   */
  onSaved?: () => void;
}

function generateMaskId(): string {
  return `mask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ProductEffectForm({
  initialData,
  onSaved,
}: ProductEffectFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;
  const { message } = App.useApp();

  const [maskId, setMaskId] = useState(initialData?.maskId ?? generateMaskId());
  const [name, setName] = useState(initialData?.name ?? "");
  const [category, setCategory] = useState(initialData?.category ?? "其他");
  const [description, setDescription] = useState(
    initialData?.description ?? ""
  );
  const [previewUrl, setPreviewUrl] = useState(initialData?.previewUrl ?? "");
  const [prompt, setPrompt] = useState(initialData?.prompt ?? "");
  const [model, setModel] = useState(initialData?.model ?? "");
  const [scene, setScene] = useState<PromptScene>(
    initialData?.scene ?? "generate_2d"
  );
  const [style, setStyle] = useState(initialData?.config?.style ?? "custom");
  const [color, setColor] = useState(initialData?.config?.color ?? "");
  const [material, setMaterial] = useState(initialData?.config?.material ?? "");
  const [price, setPrice] = useState(initialData?.price ?? 0);
  const [status, setStatus] = useState<"active" | "inactive">(
    initialData?.status ?? "active"
  );
  const [variables, setVariables] = useState<PromptVariable[]>(
    initialData?.variables ?? []
  );
  const [productLineIds, setProductLineIds] = useState<string[]>(
    initialData?.productLineIds ?? []
  );
  const versions = initialData?.versions ?? [];
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [newVersionNote, setNewVersionNote] = useState("");

  const { execute: createEffect, isPending: isCreating } = useAction(
    createProductEffectAdminAction,
    {
      onSuccess: () => {
        message.success("创建成功");
        if (onSaved) {
          onSaved();
        } else {
          router.push("/admin/product-effects");
        }
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "创建失败");
      },
    }
  );

  const { execute: updateEffect, isPending: isUpdating } = useAction(
    updateProductEffectAdminAction,
    {
      onSuccess: () => {
        message.success("更新成功");
        if (onSaved) {
          onSaved();
        } else {
          router.push("/admin/product-effects");
        }
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "更新失败");
      },
    }
  );

  const isPending = isCreating || isUpdating;

  // 切换产品线选中
  const toggleProductLine = (id: string) => {
    setProductLineIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // 新增版本（编辑时）：立即把当前 prompt 存为新版本并应用为新 prompt
  const { execute: addVersion, isPending: isAddingVersion } = useAction(
    addProductEffectVersionAction,
    {
      onSuccess: () => {
        setNewVersionLabel("");
        setNewVersionNote("");
        message.success("已新增版本");
        // 刷新当前编辑数据
        if (onSaved) {
          onSaved();
        } else {
          router.refresh();
        }
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "新增版本失败");
      },
    }
  );

  const handleAddVersion = () => {
    if (!newVersionLabel.trim()) {
      message.error("请输入版本号");
      return;
    }
    addVersion({
      maskId,
      version: newVersionLabel,
      content: prompt,
      ...(newVersionNote ? { note: newVersionNote } : {}),
    });
  };

  const handleSubmit = () => {
    if (!name.trim() || !prompt.trim()) {
      message.error("名称和提示词必填");
      return;
    }

    const payload = {
      maskId,
      name,
      category,
      description,
      previewUrl,
      prompt,
      model: model || null,
      scene,
      config: {
        style: style || "custom",
        color: color || undefined,
        material: material || undefined,
      },
      price,
      status,
      variables,
      productLineIds,
      versions,
      author: initialData?.author ?? "admin",
    };

    if (isEdit) {
      updateEffect({ maskId, updates: payload });
    } else {
      createEffect(payload);
    }
  };

  const addVariable = () => {
    setVariables((prev) => [
      ...prev,
      {
        key: `var${prev.length + 1}`,
        label: `变量 ${prev.length + 1}`,
        description: "",
        defaultValue: "",
        required: false,
        options: [],
      },
    ]);
  };

  const updateVariable = (
    index: number,
    field: keyof PromptVariable,
    value: string | boolean | string[]
  ) => {
    setVariables((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  };

  const removeVariable = (index: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Form layout="vertical" className="max-w-3xl">
      <div className="grid grid-cols-2 gap-4">
        <Form.Item label="ID（唯一标识）">
          <Input
            value={maskId}
            onChange={(e) => setMaskId(e.target.value)}
            disabled={isEdit}
          />
        </Form.Item>
        <Form.Item label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Form.Item label="分类">
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </Form.Item>
        <Form.Item label="状态">
          <Select
            value={status}
            onChange={(v) => setStatus(v)}
            options={[
              { value: "active", label: "上架" },
              { value: "inactive", label: "下架" },
            ]}
          />
        </Form.Item>
      </div>

      <Form.Item label="描述">
        <Input.TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </Form.Item>

      <div className="grid grid-cols-2 gap-4">
        <Form.Item label="预览图 URL">
          <Input
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="https://..."
          />
        </Form.Item>
        <Form.Item label="价格（分）">
          <Input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </Form.Item>
      </div>

      <Form.Item label="指定模型（可选）">
        <Select
          value={model === "" ? "__none__" : model}
          onChange={(v) => setModel(v === "__none__" ? "" : v)}
          options={[
            { value: "__none__", label: "不指定" },
            ...IMAGE_MODEL_LIST.filter((m) => m.status === "active").map(
              (m) => ({
                value: m.id,
                label: m.name,
              })
            ),
          ]}
          placeholder="不指定"
        />
      </Form.Item>

      <Form.Item label="场景">
        <Select
          value={scene}
          onChange={(v) => setScene(v as PromptScene)}
          options={Object.entries(PROMPT_SCENE_LABELS).map(
            ([value, label]) => ({
              value,
              label,
            })
          )}
        />
      </Form.Item>

      <div className="grid grid-cols-3 gap-4">
        <Form.Item label="风格">
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="custom"
          />
        </Form.Item>
        <Form.Item label="主色调">
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="可选"
          />
        </Form.Item>
        <Form.Item label="材质">
          <Input
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            placeholder="可选"
          />
        </Form.Item>
      </div>

      <Form.Item label="提示词">
        <Input.TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="使用 {{变量名}} 占位符..."
        />
      </Form.Item>

      <div className="space-y-4 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">变量</span>
          <Button
            type="default"
            size="small"
            onClick={addVariable}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            添加变量
          </Button>
        </div>
        {variables.map((variable, index) => (
          <div key={variable.key} className="border rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={variable.key}
                onChange={(e) => updateVariable(index, "key", e.target.value)}
                placeholder="变量名"
              />
              <Input
                value={variable.label}
                onChange={(e) => updateVariable(index, "label", e.target.value)}
                placeholder="标签"
              />
              <Input
                value={variable.defaultValue}
                onChange={(e) =>
                  updateVariable(index, "defaultValue", e.target.value)
                }
                placeholder="默认值"
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={variable.description}
                onChange={(e) =>
                  updateVariable(index, "description", e.target.value)
                }
                placeholder="描述"
                className="flex-1"
              />
              <Button
                type="default"
                size="small"
                danger
                onClick={() => removeVariable(index)}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 产品线关联 */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">关联产品线（多选）</span>
          <span className="text-xs text-muted-foreground">
            已选 {productLineIds.length} 个
          </span>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-3 space-y-2">
            {MOCK_PRODUCT_LINES.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无产品线</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MOCK_PRODUCT_LINES.map((pl) => {
                  const checked = productLineIds.includes(pl.productLineId);
                  return (
                    <label
                      key={pl.productLineId}
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-2 cursor-pointer transition-colors",
                        checked
                          ? "bg-violet-500/10 border-violet-500/40"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={() => toggleProductLine(pl.productLineId)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{pl.name}</p>
                        <div className="flex items-center gap-1">
                          <Badge
                            color="default"
                            className="!text-[10px] font-mono"
                          >
                            {pl.productLineId}
                          </Badge>
                          <Badge color="default" className="!text-[10px]">
                            {pl.category}
                          </Badge>
                          {pl.status === "inactive" && (
                            <Badge
                              color="default"
                              className="!text-[10px] text-zinc-500"
                            >
                              下架
                            </Badge>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 版本历史（编辑模式） */}
      {isEdit && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1">
              <History className="h-3.5 w-3.5" />
              版本历史（{versions.length}）
            </span>
          </div>
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <div className="p-3 space-y-3">
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无历史版本</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {versions.map((ver) => (
                    <div
                      key={ver.version}
                      className="flex items-center justify-between rounded-md border p-2 text-xs bg-muted/30"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          color="default"
                          className="font-mono !text-[10px]"
                        >
                          {ver.version}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(ver.createdAt).toLocaleString("zh-CN")}
                        </span>
                        {ver.note && (
                          <span className="text-muted-foreground truncate">
                            · {ver.note}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 新增版本 */}
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  新增版本（将保存当前 prompt 为新版本）
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={newVersionLabel}
                    onChange={(e) => setNewVersionLabel(e.target.value)}
                    placeholder="v1.1.0"
                  />
                  <Input
                    value={newVersionNote}
                    onChange={(e) => setNewVersionNote(e.target.value)}
                    placeholder="备注（可选）"
                  />
                </div>
                <Button
                  type="default"
                  size="small"
                  onClick={handleAddVersion}
                  disabled={isAddingVersion || !newVersionLabel.trim()}
                  loading={isAddingVersion}
                  icon={<Plus className="h-3.5 w-3.5" />}
                >
                  新增版本
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEdit && initialData && (
        <div className="grid grid-cols-3 gap-4 rounded-lg border p-4 bg-muted/30 mb-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">使用次数</p>
            <p className="font-medium">{initialData.usageCount}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">成功率</p>
            <p className="font-medium">{initialData.successRate}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">平均耗时</p>
            <p className="font-medium">{initialData.avgDuration}ms</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4">
        <Button type="primary" onClick={handleSubmit} loading={isPending}>
          {isPending ? "保存中..." : isEdit ? "更新" : "创建"}
        </Button>
        {onSaved ? null : (
          <Button
            onClick={() => router.push("/admin/product-effects")}
            disabled={isPending}
          >
            取消
          </Button>
        )}
      </div>
    </Form>
  );
}
