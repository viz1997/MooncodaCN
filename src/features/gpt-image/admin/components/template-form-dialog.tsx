"use client";

import { Loader2, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description);
      setPrompt(template.prompt);
      setSize(template.size);
      setCandidateCount(template.candidateCount);
      setCoverUrl(template.coverUrl ?? "");
      setIsActive(template.isActive);
    } else {
      setName("");
      setDescription("");
      setPrompt("");
      setSize("1024x1024");
      setCandidateCount(4);
      setCoverUrl("");
      setIsActive(true);
    }
  }, [template, open]);

  const handleSave = async () => {
    if (!name.trim() || !description.trim() || !prompt.trim()) {
      toast.error("请填写模板名称、用户描述和提示词");
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
              placeholder="完整提示词，会基于用户上传的图片进行编辑"
              rows={4}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              用户端<span className="font-medium text-red-500">不会</span>
              看到此内容。后端会用此提示词 + 用户上传的图片调用 GPT-Image-2
              编辑接口生成效果图。
            </p>
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
