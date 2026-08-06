// Mooncada AI Agent - 系统提示词与工作流定义
import {
  MOCK_EFFECTS,
  MOCK_ORDERS,
  MOCK_PHOTOS,
  MOCK_PRODUCT_EFFECTS,
  MOCK_TASKS,
} from "./mock-data";

// ============ Agent 系统提示词 ============
export const AGENT_SYSTEM_PROMPT = `你是 Mooncada 3D 打印定制平台的智能助手「Mo」，负责协助管理员、设计师、操作员和代理商处理日常工作流。

## 你的核心职责
1. **3D 模型生成推荐**：根据用户上传的照片特征和 2D 效果图，智能推荐最合适的 3D 效果模版（Mask）
2. **任务路由分析**：分析订单特征，建议分配给哪位设计师、优先级如何
3. **异常检测**：识别订单超时、任务积压、下载异常等问题
4. **流程优化**：基于历史数据给出工作流优化建议
5. **业务问答**：解答平台功能、操作流程相关问题

## 平台业务背景
- 用户上传照片 → 选择模版生成 2D 效果图（豆包 AI）→ 生成 3D 模型（Meshy AI）→ 下单 → 设计师可能修改 → 操作员打印生产 → 发货
- 4 种内部角色：管理员(admin)、代理商(agent)、设计师(designer)、操作员(operator)
- 任务状态机：等待修改 → 等待生产 → 制作中 → 已完成（不可逆向回退，制作中可回到等待修改）

## 当前可用的 3D 效果模版
${MOCK_PRODUCT_EFFECTS.map((m) => `- ${m.maskId} 「${m.name}」 | 分类: ${m.category} | 价格 ¥${m.price} | 风格: ${m.config.style} | 使用次数: ${m.usageCount} | 状态: ${m.status}`).join("\n")}

## 当前任务/订单概况
- 待办任务: ${MOCK_TASKS.filter((t) => t.status === "pending_modify" || t.status === "pending_produce").length} 个
- 进行中任务: ${MOCK_TASKS.filter((t) => t.status === "in_progress").length} 个
- 待付款订单: ${MOCK_ORDERS.filter((o) => o.status === "pending").length} 个
- 生产中订单: ${MOCK_ORDERS.filter((o) => o.status === "producing").length} 个

## 回答规范
1. **简洁专业**：避免冗长说教，直击要点
2. **结构化输出**：推荐时给出排序后的列表，含理由
3. **数据驱动**：基于使用次数、价格、风格匹配度做推荐
4. **明确可执行**：每条建议都应可立即执行（含具体 ID、操作步骤）
5. **中文回复**：使用简体中文，技术术语保留英文

如果用户的问题超出平台业务范围，礼貌引导回业务话题。`;

// ============ 3D 模版推荐 Prompt 构造 ============
export interface MaskRecommendationInput {
  photoId?: string;
  effectId?: string;
  userDescription?: string; // 用户描述想要的风格
  budget?: number; // 预算上限
}

export interface MaskRecommendation {
  maskId: string;
  maskName: string;
  category: string;
  price: number;
  matchScore: number; // 0-100
  reason: string;
}

export function buildMaskRecommendationPrompt(
  input: MaskRecommendationInput
): string {
  const parts: string[] = [];

  if (input.photoId) {
    const photo = MOCK_PHOTOS.find((p) => p.photoId === input.photoId);
    if (photo) {
      parts.push(
        `照片信息：${photo.fileName}，尺寸 ${photo.width}×${photo.height}，格式 ${photo.format}，大小 ${(photo.fileSize / 1024 / 1024).toFixed(2)}MB`
      );
    }
  }

  if (input.effectId) {
    const effect = MOCK_EFFECTS.find((e) => e.effectId === input.effectId);
    if (effect) {
      parts.push(
        `已生成的 2D 效果图：使用模版「${effect.maskName}」(${effect.maskId})，prompt: ${effect.prompt}`
      );
    }
  }

  if (input.userDescription) {
    parts.push(`用户需求描述：${input.userDescription}`);
  }

  if (input.budget) {
    parts.push(`预算上限：¥${input.budget}`);
  }

  const availableMasks = MOCK_PRODUCT_EFFECTS.filter(
    (m) => m.status === "active"
  );
  parts.push(
    `\n请从以下 ${availableMasks.length} 个可用模版中推荐最匹配的 3 个，并按匹配度排序：`
  );
  parts.push(
    availableMasks
      .map(
        (m) =>
          `- ${m.maskId} 「${m.name}」 分类:${m.category} 价格:¥${m.price} 风格:${m.config.style} 材质:${m.config.material ?? "-"} 使用次数:${m.usageCount}`
      )
      .join("\n")
  );

  parts.push(`\n请以严格 JSON 格式返回（不要包含 markdown 代码块），结构如下：
{
  "recommendations": [
    {
      "maskId": "MASK_001",
      "maskName": "3D立体浮雕",
      "category": "浮雕",
      "price": 99,
      "matchScore": 92,
      "reason": "照片为人像，浮雕风格能保留面部细节；价格在预算内；使用次数最多，质量稳定"
    }
  ],
  "summary": "基于照片特征和需求，推荐了3个模版。首推 xxx 因为..."
}`);

  return parts.join("\n");
}

// ============ 工作流分析 Prompt 构造 ============
export interface WorkflowAnalysisInput {
  analysisType:
    | "task_routing"
    | "anomaly_detection"
    | "capacity_planning"
    | "workflow_optimization";
  context?: {
    taskId?: string;
    orderId?: string;
    designerId?: string;
  };
}

export function buildWorkflowAnalysisPrompt(
  input: WorkflowAnalysisInput
): string {
  const typeMap = {
    task_routing: {
      title: "任务路由分析",
      desc: "分析当前待分配的任务，建议最优的设计师分配方案和优先级",
    },
    anomaly_detection: {
      title: "异常检测",
      desc: "识别超期任务、积压订单、下载异常等潜在问题",
    },
    capacity_planning: {
      title: "产能规划",
      desc: "基于当前任务量和设计师产能，预测瓶颈并给出扩容建议",
    },
    workflow_optimization: {
      title: "工作流优化",
      desc: "分析整个业务流程，找出可优化点并给出改进建议",
    },
  };
  const cfg = typeMap[input.analysisType];

  let prompt = `请进行「${cfg.title}」分析。\n分析目标：${cfg.desc}\n\n`;

  // 注入上下文数据
  if (input.analysisType === "task_routing") {
    const pending = MOCK_TASKS.filter(
      (t) => t.status === "pending_modify" || t.status === "pending_produce"
    );
    prompt += `当前待处理任务 ${pending.length} 个：\n`;
    prompt += pending
      .map(
        (t) =>
          `- ${t.taskId} | 订单:${t.orderId} | 状态:${t.status} | 优先级:${t.priority} | 设计师:${t.designerId ?? "未分配"} | 截止:${t.deadline} | 备注:${t.remark ?? "-"}`
      )
      .join("\n");
  } else if (input.analysisType === "anomaly_detection") {
    const allTasks = MOCK_TASKS;
    const now = new Date();
    const overdue = allTasks.filter(
      (t) => new Date(t.deadline) < now && t.status !== "completed"
    );
    prompt += `任务总数: ${allTasks.length}，其中超期未完成: ${overdue.length}\n`;
    prompt += `订单分布: ${JSON.stringify(
      MOCK_ORDERS.reduce(
        (acc, o) => {
          acc[o.status] = (acc[o.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      )
    )}\n`;
    if (overdue.length > 0) {
      prompt += `超期任务详情：\n${overdue.map((t) => `- ${t.taskId} 截止:${t.deadline} 设计师:${t.designerId}`).join("\n")}\n`;
    }
  } else if (input.analysisType === "capacity_planning") {
    const designers = ["U_DES_001", "U_DES_002"];
    prompt += `设计师产能：\n`;
    designers.forEach((dId) => {
      const active = MOCK_TASKS.filter(
        (t) => t.designerId === dId && t.status !== "completed"
      ).length;
      const completed = MOCK_TASKS.filter(
        (t) => t.designerId === dId && t.status === "completed"
      ).length;
      prompt += `- ${dId}: 进行中 ${active} 个，已完成 ${completed} 个\n`;
    });
  } else if (input.analysisType === "workflow_optimization") {
    prompt += `平台数据概览：\n`;
    prompt += `- 累计订单: ${MOCK_ORDERS.length}\n`;
    prompt += `- 累计任务: ${MOCK_TASKS.length}\n`;
    prompt += `- 已生成 2D 效果图: ${MOCK_EFFECTS.length}\n`;
    prompt += `- 已生成 3D 模型: ${MOCK_PHOTOS.length}\n`;
    prompt += `- 任务状态分布: ${JSON.stringify(
      MOCK_TASKS.reduce(
        (acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      )
    )}\n`;
  }

  prompt += `\n请以结构化 Markdown 格式输出分析报告，包含：1) 核心发现 2) 具体建议（含可执行的操作）3) 风险提示`;

  return prompt;
}

// ============ 解析 LLM 返回的 JSON ============
export function parseJsonResponse<T>(content: string): T | null {
  try {
    // 移除可能的 markdown 代码块标记
    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // 尝试提取 JSON 部分
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
