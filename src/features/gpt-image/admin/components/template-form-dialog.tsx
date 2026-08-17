"use client";

import { Loader2, Plus, Trash2, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PromptVariable } from "@/db/image-gen-types";
import {
  createTemplateAction,
  updateTemplateAction,
} from "@/features/gpt-image/actions/templates";
import {
  CANDIDATE_COUNTS,
  IMAGE_SIZES,
  type PromptTemplateView,
} from "@/features/gpt-image/lib/types";

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: PromptTemplateView | null;
  onSaved: () => void;
}

/**
 * image-gen 工作台共用的可选模型列表（与 src/features/image-gen/lib/image-models/types.ts 对齐）。
 * 这里硬编码一份，避免 gpt-image 模块反向依赖 image-gen 模块的内部模型注册表。
 * image-gen 工作台选中模板时若 model 不在 IMAGE_MODEL_LIST 中，会回退到默认 doubao。
 */
const KNOWN_IMAGE_MODELS = [
  { id: "doubao", name: "豆包 / 即梦" },
  { id: "dalle3", name: "DALL·E 3" },
  { id: "gpt_image_2", name: "GPT-Image-2" },
  { id: "nano_banana_pro", name: "Nano Banana Pro" },
  { id: "wanx", name: "通义万相" },
  { id: "flux1", name: "Flux.1" },
  { id: "sd3", name: "Stable Diffusion 3" },
  { id: "midjourney", name: "Midjourney" },
  { id: "ernie", name: "文心一格" },
  { id: "cogview", name: "CogView" },
] as const;

export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: TemplateFormDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<string>("1024x1024");
  const [candidateCount, setCandidateCount] = useState<number>(4);
  const [coverUrl, setCoverUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  // Phase A 起新增：image-gen 工作台复用 —— {{变量}} + 推荐模型 + 价格
  const [variables, setVariables] = useState<PromptVariable[]>([]);
  const [model, setModel] = useState<string>("doubao");
  const [price, setPrice] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description);
      // prompt 在公开视图里可能缺失（仅 admin 视图有），admin 编辑场景一定有
      setPrompt(template.prompt ?? "");
      setSize(template.size);
      setCandidateCount(template.candidateCount);
      setCoverUrl(template.coverUrl ?? "");
      setIsActive(template.isActive);
      setVariables(template.variables ?? []);
      setModel(template.model ?? "doubao");
      setPrice(template.price ?? 0);
    } else {
      setName("");
      setDescription("");
      setPrompt("");
      setSize("1024x1024");
      setCandidateCount(4);
      setCoverUrl("");
      setIsActive(true);
      setVariables([]);
      setModel("doubao");
      setPrice(0);
    }
  }, [template, open]);

  /**
   * 校验变量数组：
   * - key 必须非空且唯一（否则 image-gen 工作台 {{key}} 替换会被多次匹配）
   * - 提示词里 {{key}} 必须都有定义（否则原样输出给模型，会污染生图结果）
   * - 反过来，定义了的变量如果提示词里没用也会报警（提醒管理员清理）
   */
  const validateVariables = (vars: PromptVariable[], promptText: string) => {
    const keys = vars.map((v) => v.key);
    const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dups.length > 0) {
      throw new Error(`变量 key 重复：${[...new Set(dups)].join(", ")}`);
    }
    const placeholders = [
      ...promptText.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g),
    ]
      .map((m) => m[1])
      .filter((s): s is string => typeof s === "string");
    const missing = placeholders.filter((p) => !keys.includes(p));
    if (missing.length > 0) {
      throw new Error(
        `提示词里有 {{${missing.join("}}, {{")}} 但变量列表里没定义`
      );
    }
    const unused = keys.filter(
      (k) => !placeholders.includes(k) && k.length > 0
    );
    if (unused.length > 0) {
      toast.warning(
        `变量已定义但提示词里未使用：{{${unused.join("}}, {{")}}}`,
        { duration: 4000 }
      );
    }
  };

  const addVariable = () => {
    setVariables((prev) => [
      ...prev,
      {
        key: "",
        label: "",
        defaultValue: "",
        required: false,
      },
    ]);
  };

  const updateVariable = (idx: number, patch: Partial<PromptVariable>) => {
    setVariables((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, ...patch } : v))
    );
  };

  const removeVariable = (idx: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name.trim() || !description.trim() || !prompt.trim()) {
      toast.error("请填写模板名称、用户描述和提示词");
      return;
    }
    // 校验变量：空 key 当作未填写，自动跳过
    const cleanedVars = variables.filter(
      (v) => v.key.trim().length > 0 && v.label.trim().length > 0
    );
    try {
      validateVariables(cleanedVars, prompt.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "变量配置错误";
      toast.error(msg);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        size: size as (typeof IMAGE_SIZES)[number]["value"],
        candidateCount,
        coverUrl: coverUrl.trim() || null,
        isActive,
        // Phase A 起新增
        variables: cleanedVars,
        model: model || "doubao",
        price,
      };
      if (template) {
        const res = await updateTemplateAction({
          id: template.id,
          data: payload,
        });
        if (!res?.data) throw new Error("保存失败");
        toast.success("模板已更新");
      } else {
        const res = await createTemplateAction(payload);
        if (!res?.data) throw new Error("保存失败");
        toast.success("模板已创建");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "编辑模板" : "新建模板"}</DialogTitle>
          <DialogDescription>
            模板字段同时供 image-gen 工作台与 gpt-image 订单共用，
            <code className="mx-1 rounded bg-muted px-1 text-xs">
              {"{{变量}}"}
            </code>
            会在 image-gen 工作台让用户填值后替换。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">
              模板名称 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：宠物迪士尼风插画"
            />
            <p className="text-xs text-muted-foreground">
              仅管理端可见，用于区分模板
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-desc">
              用户可见描述 <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="向用户描述这个生图场景，例如：上传您的宠物照片，我们将生成多张迪士尼风格插画供您选择"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              用户端将看到这段描述（不会看到下面的提示词）
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-prompt">
              提示词内容 <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="tpl-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="完整提示词，会基于用户上传的图片进行编辑。使用 {{key}} 占位符让用户在 image-gen 工作台填值。"
              rows={4}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              用户端<span className="font-medium text-red-500">不会</span>
              看到此内容。gpt-image 后端会用此提示词 + 用户上传的图片调用
              GPT-Image-2 编辑接口生成效果图；image-gen 工作台会先替换{" "}
              {"{{key}}"} 再调用其他生图模型。
            </p>
          </div>

          {/* Phase A 起新增：变量可视化编辑 */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>提示词变量（image-gen 工作台用）</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  在提示词里写 {"{{key}}"}{" "}
                  占位符，工作台用户选中此模板时会逐项填值后替换。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addVariable}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> 添加变量
              </Button>
            </div>
            {variables.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">
                暂无变量 —— 工作台会直接把提示词发到模型。
              </p>
            ) : (
              <div className="space-y-2">
                {variables.map((v, idx) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: 临时编辑态，顺序即索引
                    key={idx}
                    className="grid grid-cols-[110px_140px_1fr_auto_auto] gap-1.5 items-center rounded border bg-background p-1.5"
                  >
                    <Input
                      value={v.key}
                      onChange={(e) =>
                        updateVariable(idx, {
                          key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                        })
                      }
                      placeholder="key"
                      className="h-8 font-mono text-xs"
                      title="变量 key（用于 {{key}} 占位符）"
                    />
                    <Input
                      value={v.label}
                      onChange={(e) =>
                        updateVariable(idx, { label: e.target.value })
                      }
                      placeholder="显示名"
                      className="h-8 text-xs"
                      title="工作台给用户看的标签"
                    />
                    <Input
                      value={v.defaultValue}
                      onChange={(e) =>
                        updateVariable(idx, {
                          defaultValue: e.target.value,
                        })
                      }
                      placeholder="默认值"
                      className="h-8 text-xs"
                      title="用户未填值时的兜底"
                    />
                    <label
                      className="flex items-center gap-1 text-xs text-muted-foreground px-1"
                      title="必填：工作台未填值时不许生成"
                    >
                      <input
                        type="checkbox"
                        checked={v.required}
                        onChange={(e) =>
                          updateVariable(idx, { required: e.target.checked })
                        }
                      />
                      必填
                    </label>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-rose-500 hover:text-rose-600"
                      onClick={() => removeVariable(idx)}
                      aria-label="删除变量"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>输出图片尺寸</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_SIZES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tpl-count">输出网格图</Label>
              <Select
                value={String(candidateCount)}
                onValueChange={(v) => setCandidateCount(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANDIDATE_COUNTS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} 宫格（
                      {n === 1
                        ? "单图"
                        : n === 2
                          ? "1×2"
                          : n === 4
                            ? "2×2"
                            : "3×3"}
                      ）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                单次生图返回的网格图数量
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Phase A 起新增：image-gen 工作台推荐模型 */}
            <div className="space-y-2">
              <Label>推荐生图模型（image-gen 工作台）</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWN_IMAGE_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                工作台选中此模板时会锁定该模型
              </p>
            </div>

            {/* Phase A 起新增：模板价格 */}
            <div className="space-y-2">
              <Label htmlFor="tpl-price">价格（元）</Label>
              <Input
                id="tpl-price"
                type="number"
                min={0}
                max={9999}
                step={1}
                value={price}
                onChange={(e) =>
                  setPrice(
                    Math.max(0, Math.min(9999, Number(e.target.value) || 0))
                  )
                }
                className="text-xs"
              />
              <p className="text-xs text-muted-foreground">
                image-gen 工作台 Select item 末尾会展示 `· ¥{price}`
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-cover">封面图 URL（可选）</Label>
            <Input
              id="tpl-cover"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              id="tpl-active"
            />
            <Label htmlFor="tpl-active">启用此模板</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-4 w-4" /> 取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> 保存中…
              </>
            ) : (
              "保存"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
