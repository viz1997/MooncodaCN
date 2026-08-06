"use client";

import {
  AlertTriangle,
  FileText,
  Loader2,
  RefreshCw,
  Route,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react";
// 工作流分析卡片
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { QuickWorkflowType } from "@/features/mooncada/lib/agent-store";
import {
  callAnalyzeWorkflow,
  QUICK_WORKFLOWS,
  useAgentStore,
} from "@/features/mooncada/lib/agent-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, typeof Sparkles> = {
  Sparkles,
  Route,
  AlertTriangle,
  TrendingUp,
  Workflow,
};

interface Props {
  analysisType: QuickWorkflowType;
  compact?: boolean;
}

export function WorkflowAnalysisTrigger({
  analysisType,
  compact = false,
}: Props) {
  const { toast } = useToast();
  const { addMessage, updateMessage, setThinking, setActiveWorkflow } =
    useAgentStore();
  const [loading, setLoading] = useState(false);

  const wf = QUICK_WORKFLOWS.find((w) => w.key === analysisType);
  if (!wf) return null;
  const Icon = ICON_MAP[wf.icon] ?? Sparkles;

  const handleAnalyze = async () => {
    setLoading(true);
    setThinking(true);
    setActiveWorkflow(analysisType);
    addMessage({
      role: "user",
      content: `请执行「${wf.label}」分析`,
      type: "text",
    });
    const pendingId = addMessage({
      role: "assistant",
      content: `正在执行${wf.label}分析...`,
      type: "text",
      pending: true,
    });
    const result = await callAnalyzeWorkflow({ analysisType });
    setLoading(false);
    setThinking(false);
    if (!result.success || !result.data) {
      updateMessage(pendingId, {
        content: `分析失败：${result.error}`,
        type: "error",
        pending: false,
      });
      toast({
        title: "分析失败",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    updateMessage(pendingId, {
      content: result.data.response,
      type: "analysis",
      data: result.data,
      pending: false,
    });
    setActiveWorkflow(null);
    toast({
      title: `${result.data.title}完成`,
      description: "查看助手面板中的详细报告",
    });
  };

  if (compact) {
    return (
      <Button
        onClick={handleAnalyze}
        disabled={loading}
        size="sm"
        variant="outline"
        className={cn(
          "gap-1.5",
          `bg-gradient-to-r ${wf.color} text-white border-0 hover:opacity-90`
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
        {wf.label}
      </Button>
    );
  }

  return (
    <button
      onClick={handleAnalyze}
      disabled={loading}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm disabled:opacity-60",
        "bg-gradient-to-br from-card to-card/50"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "rounded-lg p-2 shrink-0 bg-gradient-to-br text-white",
            wf.color
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5">
            {wf.label}
            {loading && (
              <span className="text-[10px] text-muted-foreground">
                分析中...
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {wf.description}
          </p>
        </div>
      </div>
    </button>
  );
}

// 分析结果渲染（Markdown 风格简化版）
export function AnalysisCard({
  data,
}: {
  data: {
    title: string;
    response: string;
    generatedAt: string;
    analysisType: string;
  };
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-sky-600" />
          <span className="text-sm font-semibold">{data.title}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {new Date(data.generatedAt).toLocaleString("zh-CN")}
        </span>
      </div>
      <div className="text-xs leading-relaxed whitespace-pre-wrap">
        {data.response}
      </div>
    </div>
  );
}

// 重新分析按钮
export function ReanalyzeButton({ analysisType }: { analysisType: string }) {
  return (
    <Button size="sm" variant="ghost" className="text-xs">
      <RefreshCw className="h-3 w-3 mr-1" />
      重新分析
    </Button>
  );
}
