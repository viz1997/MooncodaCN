"use client";

import {
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
// AI 推荐模版表单：基于照片/效果图智能推荐3D模版
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import type { MaskRecommendation } from "@/features/mooncada/lib/agent-store";
import {
  callRecommendMask,
  useAgentStore,
} from "@/features/mooncada/lib/agent-store";
import { MOCK_EFFECTS, MOCK_PHOTOS } from "@/features/mooncada/lib/mock-data";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCurrency } from "../shared";

export function RecommendMaskForm() {
  const { toast } = useToast();
  const {
    recommendContext,
    setRecommendContext,
    addMessage,
    updateMessage,
    setThinking,
    setActiveWorkflow,
  } = useAgentStore();
  const [loading, setLoading] = useState(false);

  const handleRecommend = async () => {
    if (
      !recommendContext.photoId &&
      !recommendContext.effectId &&
      !recommendContext.userDescription
    ) {
      toast({
        title: "请至少填写一项输入",
        description: "可选择照片/效果图，或直接描述需求",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    setThinking(true);
    const inputDesc = [
      recommendContext.photoId && `照片: ${recommendContext.photoId}`,
      recommendContext.effectId && `效果图: ${recommendContext.effectId}`,
      recommendContext.userDescription &&
        `需求: ${recommendContext.userDescription}`,
      recommendContext.budget && `预算: ¥${recommendContext.budget}`,
    ]
      .filter(Boolean)
      .join(" · ");
    addMessage({
      role: "user",
      content: `请帮我推荐3D模版。${inputDesc}`,
      type: "text",
    });
    const pendingId = addMessage({
      role: "assistant",
      content: "正在分析输入并匹配最佳模版...",
      type: "text",
      pending: true,
    });
    const result = await callRecommendMask({
      photoId: recommendContext.photoId,
      effectId: recommendContext.effectId,
      userDescription: recommendContext.userDescription,
      budget: recommendContext.budget,
    });
    setLoading(false);
    setThinking(false);
    if (!result.success || !result.data) {
      updateMessage(pendingId, {
        content: `推荐失败：${result.error}`,
        type: "error",
        pending: false,
      });
      return;
    }
    updateMessage(pendingId, {
      content: result.data.summary,
      type: "recommendation",
      data: result.data,
      pending: false,
    });
    if (result.fallback) {
      toast({
        title: "使用兜底推荐",
        description: "AI 响应解析失败，已使用默认推荐",
        variant: "default",
      });
    } else {
      toast({
        title: "推荐完成",
        description: `共推荐 ${result.data.recommendations.length} 个模版`,
      });
    }
    setActiveWorkflow(null);
    setRecommendContext({
      photoId: undefined,
      effectId: undefined,
      userDescription: undefined,
      budget: undefined,
    });
  };

  return (
    <div className="space-y-3 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
      <div className="flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-400">
        <Wand2 className="h-4 w-4" />
        AI 智能3D模版推荐
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">选择照片（可选）</Label>
        <Select
          value={recommendContext.photoId ?? ""}
          onValueChange={(v) =>
            setRecommendContext({ photoId: v || undefined })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="选择用户上传的照片" />
          </SelectTrigger>
          <SelectContent>
            {MOCK_PHOTOS.slice(0, 8).map((p) => (
              <SelectItem key={p.photoId} value={p.photoId} className="text-xs">
                <span className="flex items-center gap-1.5">
                  <ImageIcon className="h-3 w-3" />
                  {p.fileName} ({p.photoId})
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">选择2D效果图（可选）</Label>
        <Select
          value={recommendContext.effectId ?? ""}
          onValueChange={(v) =>
            setRecommendContext({ effectId: v || undefined })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="已生成的2D效果图" />
          </SelectTrigger>
          <SelectContent>
            {MOCK_EFFECTS.filter((e) => e.status === "completed").map((e) => (
              <SelectItem
                key={e.effectId}
                value={e.effectId}
                className="text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  {e.maskName} ({e.effectId})
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">需求描述（可选）</Label>
        <Textarea
          value={recommendContext.userDescription ?? ""}
          onChange={(e) =>
            setRecommendContext({ userDescription: e.target.value })
          }
          placeholder="例如：想要一个Q版手办风格、立体感强、保留人物发型细节..."
          rows={2}
          className="text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">预算上限（可选，CNY）</Label>
        <Input
          type="number"
          value={recommendContext.budget ?? ""}
          onChange={(e) =>
            setRecommendContext({
              budget: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          placeholder="如 200"
          className="h-8 text-xs"
        />
      </div>

      <Button
        onClick={handleRecommend}
        disabled={loading}
        className="w-full bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
        size="sm"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> AI 分析中...
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> 智能推荐
          </>
        )}
      </Button>
    </div>
  );
}

export function RecommendationCard({
  data,
}: {
  data: { recommendations: MaskRecommendation[]; summary: string };
}) {
  const { recommendations, summary } = data;
  return (
    <div className="space-y-2">
      <p className="text-sm">{summary}</p>
      <div className="space-y-2">
        {recommendations.map((rec, i) => (
          <div
            key={rec.maskId}
            className={cn(
              "rounded-lg border p-2.5 space-y-1.5",
              i === 0 ? "border-violet-500/40 bg-violet-500/5" : "border-border"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {i === 0 && (
                  <span className="inline-flex items-center rounded-md bg-violet-500 text-white text-[10px] px-1.5 py-0.5 font-semibold">
                    最佳匹配
                  </span>
                )}
                <span className="text-sm font-medium">{rec.maskName}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {rec.maskId}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-600">
                  {formatCurrency(rec.price)}
                </span>
                <div className="flex items-center gap-1">
                  <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-purple-600"
                      style={{ width: `${rec.matchScore}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono">
                    {rec.matchScore}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{rec.reason}</p>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {rec.category}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-1">
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        推荐结果基于模版特征匹配、使用频次与预算综合计算
      </div>
    </div>
  );
}
