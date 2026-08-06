"use client";

import {
  AlertCircle,
  Bot,
  ChevronRight,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  User as UserIcon,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  callAgentChat,
  QUICK_WORKFLOWS,
  useAgentStore,
} from "@/features/mooncada/lib/agent-store";
import { useMooncadaStore } from "@/features/mooncada/lib/store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RecommendationCard, RecommendMaskForm } from "./recommend-form";
import { AnalysisCard, WorkflowAnalysisTrigger } from "./workflow-analysis";

// 单条消息渲染
function MessageBubble({
  msg,
}: {
  msg: ReturnType<typeof useAgentStore.getState>["messages"][number];
}) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center shrink-0",
          isUser
            ? "bg-emerald-500 text-white"
            : "bg-gradient-to-br from-violet-500 to-purple-600 text-white"
        )}
      >
        {isUser ? (
          <UserIcon className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>
      <div
        className={cn(
          "flex-1 min-w-0 max-w-[85%]",
          isUser && "flex justify-end"
        )}
      >
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            isUser
              ? "bg-emerald-500 text-white"
              : msg.type === "error"
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20"
                : "bg-muted"
          )}
        >
          {/* pending 状态 */}
          {msg.pending ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">{msg.content}</span>
            </div>
          ) : msg.type === "recommendation" && msg.data ? (
            <RecommendationCard
              data={
                msg.data as {
                  recommendations: {
                    maskId: string;
                    maskName: string;
                    category: string;
                    price: number;
                    matchScore: number;
                    reason: string;
                  }[];
                  summary: string;
                }
              }
            />
          ) : msg.type === "analysis" && msg.data ? (
            <AnalysisCard
              data={
                msg.data as {
                  title: string;
                  response: string;
                  generatedAt: string;
                  analysisType: string;
                }
              }
            />
          ) : (
            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 px-1">
          {new Date(msg.timestamp).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

// 欢迎屏
function WelcomeScreen() {
  const { setActiveWorkflow } = useAgentStore();
  return (
    <div className="space-y-4 py-4">
      <div className="text-center space-y-2">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
          <Sparkles className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold">你好，我是 Mo 助手</h3>
        <p className="text-xs text-muted-foreground px-4">
          Mooncada 3D 打印平台的智能助手
          <br />
          可以帮你推荐 3D 模版、分析工作流、检测异常
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground px-1">
          快捷工作流：
        </p>
        {QUICK_WORKFLOWS.map((wf) => (
          <WorkflowAnalysisTrigger key={wf.key} analysisType={wf.key} />
        ))}
      </div>

      <div className="bg-muted/40 rounded-lg p-3 space-y-1.5">
        <p className="text-xs font-medium">你可以这样问我：</p>
        <ul className="text-[11px] text-muted-foreground space-y-1">
          <li className="flex items-start gap-1">
            <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />{" "}
            这张人像照片应该用哪个模版生成3D？
          </li>
          <li className="flex items-start gap-1">
            <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />{" "}
            当前有哪些超期任务？
          </li>
          <li className="flex items-start gap-1">
            <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" /> 设计师
            U_DES_001 还能接多少任务？
          </li>
          <li className="flex items-start gap-1">
            <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />{" "}
            任务状态机是怎么流转的？
          </li>
        </ul>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setActiveWorkflow("recommend_mask")}
      >
        <Wand2 className="h-3.5 w-3.5 mr-1.5" />
        使用3D模版推荐工具
      </Button>
    </div>
  );
}

export function AgentPanel() {
  const { toast } = useToast();
  const {
    isOpen,
    close,
    messages,
    isThinking,
    addMessage,
    updateMessage,
    setThinking,
    clearMessages,
    activeWorkflow,
    setActiveWorkflow,
    sendUserMessage,
  } = useAgentStore();
  const { currentRole, activeModule } = useMooncadaStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking) return;
    setInput("");
    sendUserMessage(text);
    // 构造历史消息（最多保留最近10条）
    const history = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    history.push({ role: "user", content: text });
    // 添加 pending 消息
    const pendingId = addMessage({
      role: "assistant",
      content: "正在思考...",
      type: "text",
      pending: true,
    });
    setThinking(true);
    const result = await callAgentChat(history, {
      module: activeModule,
      currentRole,
    });
    setThinking(false);
    if (!result.success || !result.response) {
      updateMessage(pendingId, {
        content: `抱歉，处理失败：${result.error}`,
        type: "error",
        pending: false,
      });
      toast({
        title: "AI 响应失败",
        description: result.error ?? "未知错误",
        variant: "destructive",
      });
      return;
    }
    updateMessage(pendingId, {
      content: result.response,
      type: "text",
      pending: false,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 遮罩（仅移动端） */}
      <div
        className="fixed inset-0 bg-black/30 z-40 lg:hidden"
        onClick={close}
        aria-hidden
      />

      {/* 侧边面板 */}
      <aside className="fixed right-0 top-0 bottom-0 w-full sm:w-[440px] bg-background border-l z-50 flex flex-col shadow-xl">
        {/* 头部 */}
        <div className="h-14 border-b flex items-center justify-between px-3 shrink-0 bg-gradient-to-r from-violet-500/5 to-purple-500/5">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">Mo · AI 助手</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {isThinking ? "思考中..." : "在线 · Mooncada 智能助手"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => {
                  clearMessages();
                  toast({ title: "对话已清空" });
                }}
                aria-label="清空"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={close}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 上下文标签 */}
        <div className="px-3 py-1.5 border-b bg-muted/30 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px] py-0">
            模块: {activeModule}
          </Badge>
          <Badge variant="outline" className="text-[10px] py-0">
            角色: {currentRole}
          </Badge>
          {activeWorkflow && (
            <Badge className="text-[10px] py-0 bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20">
              工作流:{" "}
              {QUICK_WORKFLOWS.find((w) => w.key === activeWorkflow)?.label}
            </Badge>
          )}
        </div>

        {/* 消息列表 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
          {messages.length === 0 ? (
            <WelcomeScreen />
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {/* 推荐3D模版表单（当激活的工作流为 recommend_mask 时显示） */}
              {activeWorkflow === "recommend_mask" && <RecommendMaskForm />}
            </>
          )}
        </div>

        {/* 错误提示 */}
        {messages.some((m) => m.type === "error") && (
          <div className="px-3 py-2 bg-rose-500/5 border-t border-rose-500/20 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>AI 服务可能不稳定，请稍后重试或使用快捷工作流</span>
          </div>
        )}

        {/* 输入区 */}
        <div className="border-t p-3 space-y-2 shrink-0">
          {/* 快捷工具栏 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              onClick={() =>
                setActiveWorkflow(
                  activeWorkflow === "recommend_mask" ? null : "recommend_mask"
                )
              }
            >
              <Wand2 className="h-3 w-3" />
              3D模版推荐
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              onClick={() => setInput("当前有哪些超期任务？请给出处理建议。")}
            >
              超期任务检查
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() =>
                setInput("帮我分析一下平台整体运营情况，并给出优化建议。")
              }
            >
              运营分析
            </Button>
          </div>

          {/* 输入框 */}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题，或点击上方快捷按钮..."
              rows={1}
              className="flex-1 resize-none rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30 px-3 py-2 text-sm max-h-32"
              disabled={isThinking}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              size="icon"
              className="bg-gradient-to-br from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 h-9 w-9 shrink-0"
              aria-label="发送"
            >
              {isThinking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            按 Enter 发送 · Shift+Enter 换行 · Mo 可能出错，请核实重要信息
          </p>
        </div>
      </aside>
    </>
  );
}

// 浮动触发按钮
export function AgentFab() {
  const { isOpen, open, messages, isThinking } = useAgentStore();
  if (isOpen) return null;
  const unreadCount = messages.filter((m) => m.pending).length;
  return (
    <button
      onClick={open}
      className="fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:scale-105 transition-all flex items-center justify-center group"
      aria-label="打开AI助手"
    >
      {isThinking ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <Sparkles className="h-6 w-6" />
      )}
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center font-bold">
          {unreadCount}
        </span>
      )}
      <span className="absolute right-16 bg-foreground text-background text-xs px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        询问 Mo 助手
      </span>
    </button>
  );
}
