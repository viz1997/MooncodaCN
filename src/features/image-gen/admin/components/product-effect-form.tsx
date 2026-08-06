"use client";

import { History, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
        toast.success("创建成功");
        if (onSaved) {
          onSaved();
        } else {
          router.push("/admin/product-effects");
        }
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "创建失败");
      },
    }
  );

  const { execute: updateEffect, isPending: isUpdating } = useAction(
    updateProductEffectAdminAction,
    {
      onSuccess: () => {
        toast.success("更新成功");
        if (onSaved) {
          onSaved();
        } else {
          router.push("/admin/product-effects");
        }
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "更新失败");
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
        toast.success("已新增版本");
        // 刷新当前编辑数据
        if (onSaved) {
          onSaved();
        } else {
          router.refresh();
        }
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "新增版本失败");
      },
    }
  );

  const handleAddVersion = () => {
    if (!newVersionLabel.trim()) {
      toast.error("请输入版本号");
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
      toast.error("名称和提示词必填");
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
    <div className="max-w-3xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>ID（唯一标识）</Label>
          <Input
            value={maskId}
            onChange={(e) => setMaskId(e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div className="space-y-2">
          <Label>名称</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>分类</Label>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>状态</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as typeof status)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">上架</SelectItem>
              <SelectItem value="inactive">下架</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>描述</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>预览图 URL</Label>
          <Input
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-2">
          <Label>价格（分）</Label>
          <Input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>指定模型（可选）</Label>
        <Select
          value={model === "" ? "__none__" : model}
          onValueChange={(v) => setModel(v === "__none__" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="不指定" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">不指定</SelectItem>
            {IMAGE_MODEL_LIST.filter((m) => m.status === "active").map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>场景</Label>
        <Select value={scene} onValueChange={(v) => setScene(v as PromptScene)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PROMPT_SCENE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>风格</Label>
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="custom"
          />
        </div>
        <div className="space-y-2">
          <Label>主色调</Label>
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="可选"
          />
        </div>
        <div className="space-y-2">
          <Label>材质</Label>
          <Input
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            placeholder="可选"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>提示词</Label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="使用 {{变量名}} 占位符..."
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>变量</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addVariable}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
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
                type="button"
                size="sm"
                variant="outline"
                className="text-rose-600 hover:text-rose-700"
                onClick={() => removeVariable(index)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* 产品线关联 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>关联产品线（多选）</Label>
          <span className="text-xs text-muted-foreground">
            已选 {productLineIds.length} 个
          </span>
        </div>
        <Card>
          <CardContent className="p-3 space-y-2">
            {MOCK_PRODUCT_LINES.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无产品线</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MOCK_PRODUCT_LINES.map((pl) => {
                  const checked = productLineIds.includes(pl.productLineId);
                  return (
                    // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox 是 Radix 控件，原生 input 嵌套在 label 内即可
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
                        onCheckedChange={() =>
                          toggleProductLine(pl.productLineId)
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{pl.name}</p>
                        <div className="flex items-center gap-1">
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono py-0"
                          >
                            {pl.productLineId}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] py-0">
                            {pl.category}
                          </Badge>
                          {pl.status === "inactive" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-zinc-500"
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
          </CardContent>
        </Card>
      </div>

      {/* 版本历史（编辑模式） */}
      {isEdit && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1">
              <History className="h-3.5 w-3.5" />
              版本历史（{versions.length}）
            </Label>
          </div>
          <Card>
            <CardContent className="p-3 space-y-3">
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
                          variant="outline"
                          className="font-mono text-[10px] py-0"
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
                    className="h-8 text-sm"
                  />
                  <Input
                    value={newVersionNote}
                    onChange={(e) => setNewVersionNote(e.target.value)}
                    placeholder="备注（可选）"
                    className="h-8 text-sm"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddVersion}
                  disabled={isAddingVersion || !newVersionLabel.trim()}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {isAddingVersion ? "新增中..." : "新增版本"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isEdit && initialData && (
        <div className="grid grid-cols-3 gap-4 rounded-lg border p-4 bg-muted/30">
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
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? "保存中..." : isEdit ? "更新" : "创建"}
        </Button>
        {onSaved ? null : (
          <Button
            variant="outline"
            onClick={() => router.push("/admin/product-effects")}
            disabled={isPending}
          >
            取消
          </Button>
        )}
      </div>
    </div>
  );
}
