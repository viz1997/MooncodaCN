// AI Agent 状态管理与类型定义
import { create } from "zustand";

// ============ 类型 ============
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  // 可选的富内容：模版推荐结果、分析报告等
  type?: "text" | "recommendation" | "analysis" | "error";
  data?: unknown;
  pending?: boolean;
}

export interface MaskRecommendation {
  maskId: string;
  maskName: string;
  category: string;
  price: number;
  matchScore: number;
  reason: string;
}

export interface RecommendationResult {
  recommendations: MaskRecommendation[];
  summary: string;
}

export interface WorkflowAnalysisResult {
  analysisType: string;
  title: string;
  response: string;
  generatedAt: string;
}

// 快捷工作流类型
export type QuickWorkflowType =
  | "recommend_mask" // 推荐3D模版
  | "task_routing" // 任务路由
  | "anomaly_detection" // 异常检测
  | "capacity_planning" // 产能规划
  | "workflow_optimization"; // 工作流优化

export interface QuickWorkflowDef {
  key: QuickWorkflowType;
  label: string;
  description: string;
  icon: string; // lucide icon name
  color: string; // tailwind classes
}

export const QUICK_WORKFLOWS: QuickWorkflowDef[] = [
  {
    key: "recommend_mask",
    label: "推荐3D模版",
    description: "基于照片/效果图智能推荐3D生成模版",
    icon: "Sparkles",
    color: "from-violet-500 to-purple-600",
  },
  {
    key: "task_routing",
    label: "任务路由",
    description: "分析待分配任务，建议最优设计师分配方案",
    icon: "Route",
    color: "from-sky-500 to-blue-600",
  },
  {
    key: "anomaly_detection",
    label: "异常检测",
    description: "识别超期任务、积压订单等潜在问题",
    icon: "AlertTriangle",
    color: "from-amber-500 to-orange-600",
  },
  {
    key: "capacity_planning",
    label: "产能规划",
    description: "预测设计师产能瓶颈并给出扩容建议",
    icon: "TrendingUp",
    color: "from-emerald-500 to-teal-600",
  },
  {
    key: "workflow_optimization",
    label: "工作流优化",
    description: "分析整个业务流程，找出可优化点",
    icon: "Workflow",
    color: "from-rose-500 to-pink-600",
  },
];

// ============ Store ============
interface AgentState {
  isOpen: boolean;
  messages: AgentMessage[];
  isThinking: boolean;
  // 当前的推荐上下文（用于预填到推荐表单）
  recommendContext: {
    // 项目 tsconfig 启用了 exactOptionalPropertyTypes，可选字段要么省略要么
    // 显式带 `| undefined`，否则 `setRecommendContext({ photoId: undefined })`
    // 会被类型系统拒绝。
    photoId?: string | undefined;
    effectId?: string | undefined;
    userDescription?: string | undefined;
    budget?: number | undefined;
  };
  // 当前激活的快捷工作流
  activeWorkflow: QuickWorkflowType | null;
  // 操作
  open: () => void;
  close: () => void;
  toggle: () => void;
  addMessage: (msg: Omit<AgentMessage, "id" | "timestamp">) => string;
  updateMessage: (id: string, updates: Partial<AgentMessage>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setThinking: (v: boolean) => void;
  setRecommendContext: (ctx: Partial<AgentState["recommendContext"]>) => void;
  setActiveWorkflow: (w: QuickWorkflowType | null) => void;
  // 快捷方法
  sendUserMessage: (content: string) => string;
}

let msgIdCounter = 0;
const genId = () => `msg_${Date.now()}_${++msgIdCounter}`;

export const useAgentStore = create<AgentState>((set, get) => ({
  isOpen: false,
  messages: [],
  isThinking: false,
  recommendContext: {},
  activeWorkflow: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  addMessage: (msg) => {
    const id = genId();
    const fullMsg: AgentMessage = {
      ...msg,
      id,
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, fullMsg] }));
    return id;
  },

  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  removeMessage: (id) =>
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),

  clearMessages: () => set({ messages: [], activeWorkflow: null }),

  setThinking: (v) => set({ isThinking: v }),

  setRecommendContext: (ctx) =>
    set((s) => ({ recommendContext: { ...s.recommendContext, ...ctx } })),

  setActiveWorkflow: (w) => set({ activeWorkflow: w }),

  sendUserMessage: (content) => {
    const id = genId();
    const msg: AgentMessage = {
      id,
      role: "user",
      content,
      timestamp: Date.now(),
      type: "text",
    };
    set((s) => ({ messages: [...s.messages, msg] }));
    return id;
  },
}));

// ============ API 调用封装 ============
export async function callAgentChat(
  messages: { role: "user" | "assistant"; content: string }[],
  context?: { module?: string; currentRole?: string; itemId?: string }
): Promise<{ success: boolean; response?: string; error?: string }> {
  try {
    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, context }),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || "请求失败" };
    }
    return { success: true, response: data.response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "网络错误";
    return { success: false, error: msg };
  }
}

export async function callRecommendMask(input: {
  // 项目 tsconfig 启用了 exactOptionalPropertyTypes：可选参数要么不传，要么
  // 显式允许 undefined，否则 `string | undefined` 实参会被类型系统拒绝。
  photoId?: string | undefined;
  effectId?: string | undefined;
  userDescription?: string | undefined;
  budget?: number | undefined;
}): Promise<{
  success: boolean;
  data?: RecommendationResult;
  rawResponse?: string;
  error?: string;
  fallback?: boolean;
}> {
  try {
    const res = await fetch("/api/agent/recommend-3d-mask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || "推荐失败" };
    }
    return {
      success: true,
      data: {
        recommendations: data.recommendations,
        summary: data.summary,
      },
      rawResponse: data.rawResponse,
      fallback: data.fallback,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "网络错误";
    return { success: false, error: msg };
  }
}

export async function callAnalyzeWorkflow(input: {
  analysisType: string;
  context?: { taskId?: string; orderId?: string; designerId?: string };
}): Promise<{
  success: boolean;
  data?: WorkflowAnalysisResult;
  error?: string;
}> {
  try {
    const res = await fetch("/api/agent/analyze-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || "分析失败" };
    }
    return {
      success: true,
      data: {
        analysisType: data.analysisType,
        title: data.title,
        response: data.response,
        generatedAt: data.generatedAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "网络错误";
    return { success: false, error: msg };
  }
}
