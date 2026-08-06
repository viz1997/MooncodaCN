"use client";

/**
 * 产品效果预览对话框
 *
 * 对齐 mooncada-source PreviewDialog 结构：
 * - Tabs：基本信息 / 变量测试 / 版本历史
 * - 每个 Tab 各自承载对应内容
 */

import { Code, Copy, Loader2, Play, Variable } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  ProductEffect,
  PromptVariable,
} from "@/features/image-gen/lib/product-effect-types";
import {
  PROMPT_SCENE_COLORS,
  PROMPT_SCENE_LABELS,
} from "@/features/image-gen/lib/product-effect-types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PreviewEffectDialogProps {
  effect: ProductEffect | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 高亮渲染 prompt 中的 {{变量}}
 */
function renderHighlightedPrompt(content: string) {
  const parts = content.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (/^\{\{[^}]+\}\}$/.test(part)) {
      return (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 按位置切分，原样回写
          key={`var-${i}`}
          className="inline-flex items-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 mx-0.5 text-xs font-mono border border-violet-500/20"
        >
          <Variable className="h-3 w-3 mr-0.5" />
          {part}
        </span>
      );
    }
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: 按位置切分，原样回写
      <span key={`txt-${i}`}>{part}</span>
    );
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN");
}

export function PreviewEffectDialog({
  effect,
  open,
  onOpenChange,
}: PreviewEffectDialogProps) {
  const { toast } = useToast();
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState("");
  const [testing, setTesting] = useState(false);
  const [selectedVersionIdx, setSelectedVersionIdx] = useState<number>(-1);

  if (!effect) return null;

  const versions = effect.versions ?? [];
  const currentContent =
    selectedVersionIdx >= 0
      ? (versions[selectedVersionIdx]?.content ?? effect.prompt)
      : effect.prompt;
  const currentVersionLabel =
    selectedVersionIdx >= 0
      ? (versions[selectedVersionIdx]?.version ?? "当前")
      : "当前";

  const handleTest = () => {
    setTesting(true);
    setTimeout(() => {
      let result = currentContent;
      effect.variables.forEach((v: PromptVariable) => {
        const val = testValues[v.key] || v.defaultValue || `{{${v.key}}}`;
        result = result.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), val);
      });
      setRendered(result);
      setTesting(false);
      toast({ title: "渲染完成", description: "已使用填入的变量值生成预览" });
    }, 400);
  };

  const handleCopy = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    toast({ title: "已复制到剪贴板" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-4 w-4 text-teal-600" />
            {effect.name}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue="info"
          className="flex-1 overflow-hidden flex flex-col"
        >
          <TabsList className="self-start">
            <TabsTrigger value="info">基本信息</TabsTrigger>
            <TabsTrigger value="test">变量测试</TabsTrigger>
            <TabsTrigger value="versions">
              版本历史（{versions.length}）
            </TabsTrigger>
          </TabsList>

          {/* 基本信息 */}
          <TabsContent
            value="info"
            className="flex-1 overflow-y-auto pr-2 space-y-3"
          >
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs">{effect.maskId}</span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                    PROMPT_SCENE_COLORS[effect.scene]
                  )}
                >
                  {PROMPT_SCENE_LABELS[effect.scene]}
                </span>
                {effect.model && (
                  <Badge variant="outline" className="text-[10px]">
                    模型: {effect.model}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {effect.category}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    effect.status === "active"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "bg-zinc-500/10 text-zinc-700"
                  )}
                >
                  {effect.status === "active" ? "上架" : "下架"}
                </Badge>
              </div>
              {effect.description && (
                <p className="text-xs text-muted-foreground">
                  {effect.description}
                </p>
              )}
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Prompt · {currentVersionLabel}
                </Label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => handleCopy(currentContent)}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  复制
                </Button>
              </div>
              <div className="text-xs font-mono whitespace-pre-wrap break-words bg-background rounded border p-2 max-h-72 overflow-y-auto">
                {renderHighlightedPrompt(currentContent)}
              </div>
            </div>

            {/* 关联产品线 */}
            {effect.productLineIds && effect.productLineIds.length > 0 ? (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <Label className="text-xs font-semibold">关联产品线</Label>
                <div className="flex flex-wrap gap-1">
                  {effect.productLineIds.map((id) => (
                    <Badge
                      key={id}
                      variant="outline"
                      className="text-[10px] font-mono"
                    >
                      {id}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border bg-muted/30 p-3">
              <Label className="text-xs font-semibold">使用统计</Label>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">累计使用</p>
                  <p className="text-sm font-medium">
                    {effect.usageCount.toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">成功率</p>
                  <p className="text-sm font-medium">{effect.successRate}%</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">平均耗时</p>
                  <p className="text-sm font-medium">
                    {(effect.avgDuration / 1000).toFixed(2)}s
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* 变量测试 */}
          <TabsContent value="test" className="flex-1 overflow-y-auto pr-2">
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">变量测试</Label>
                  <Button
                    size="sm"
                    onClick={handleTest}
                    disabled={testing || effect.variables.length === 0}
                  >
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 mr-1" />
                    )}
                    {testing ? "渲染中..." : "测试渲染"}
                  </Button>
                </div>

                {effect.variables.length === 0 ? (
                  <p className="text-xs text-muted-foreground">无变量</p>
                ) : (
                  <div className="space-y-2">
                    {effect.variables.map((v) => {
                      const value = testValues[v.key] ?? "";
                      return (
                        <div key={v.key} className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            {v.label || v.key}{" "}
                            {v.required && (
                              <span className="text-rose-600">*</span>
                            )}
                            <code className="ml-1 text-[10px] font-mono">
                              {`{{${v.key}}}`}
                            </code>
                          </Label>
                          {v.options && v.options.length > 0 ? (
                            <Select
                              value={value || v.defaultValue}
                              onValueChange={(val) =>
                                setTestValues((prev) => ({
                                  ...prev,
                                  [v.key]: val,
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={v.defaultValue} />
                              </SelectTrigger>
                              <SelectContent>
                                {v.options.map((opt) => (
                                  <SelectItem key={opt} value={opt}>
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={value}
                              onChange={(e) =>
                                setTestValues((prev) => ({
                                  ...prev,
                                  [v.key]: e.target.value,
                                }))
                              }
                              placeholder={v.defaultValue}
                              className="h-8 text-sm"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {rendered && (
                <div className="rounded-lg border bg-violet-500/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                      渲染结果
                    </Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => handleCopy(rendered)}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      复制
                    </Button>
                  </div>
                  <Textarea
                    value={rendered}
                    readOnly
                    rows={6}
                    className="text-xs font-mono bg-background"
                  />
                </div>
              )}
            </div>
          </TabsContent>

          {/* 版本历史 */}
          <TabsContent
            value="versions"
            className="flex-1 overflow-y-auto pr-2 space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                共 {versions.length} 个历史版本，点击切换 prompt 预览
              </p>
              <Select
                value={String(selectedVersionIdx)}
                onValueChange={(v) => setSelectedVersionIdx(Number(v))}
              >
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="-1">当前版本</SelectItem>
                  {versions.map((ver, idx) => (
                    <SelectItem key={ver.version} value={String(idx)}>
                      {ver.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无历史版本</p>
              ) : (
                versions.map((ver, i) => (
                  <button
                    type="button"
                    key={ver.version}
                    className={cn(
                      "w-full text-left rounded-lg border p-3 cursor-pointer transition-colors",
                      i === 0
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-border",
                      selectedVersionIdx === i && "ring-1 ring-violet-500/40"
                    )}
                    onClick={() => setSelectedVersionIdx(i)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono">
                          {ver.version}
                        </Badge>
                        {i === 0 ? (
                          <Badge className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                            当前版本
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(ver.createdAt)}
                      </span>
                    </div>
                    {ver.note && (
                      <p className="text-xs text-muted-foreground">
                        {ver.note}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
