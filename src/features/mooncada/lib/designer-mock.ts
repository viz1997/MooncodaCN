// 设计师中心 Mock 数据
// 仿 mooncada-source MOCK_DESIGNER_STATS / MOCK_WITHDRAWALS / MOCK_TASKS
// 前端 mock 演示，后端接入留后续阶段

export type DesignerWithdrawalMethod = "alipay" | "wechat" | "bank";
export type DesignerWithdrawalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed";
export type DesignerTaskStatus =
  | "pending"
  | "in_progress"
  | "reviewing"
  | "completed"
  | "rejected";

export interface MockDesignerStats {
  availableBalance: number;
  frozenBalance: number;
  monthlyEarnings: number;
  totalEarnings: number;
  completedCount: number;
  pendingCount: number;
  inProgressCount: number;
}

export interface MockDesignerWithdrawal {
  withdrawalId: string;
  designerId: string;
  amount: number;
  status: DesignerWithdrawalStatus;
  method: DesignerWithdrawalMethod;
  account: string;
  createdAt: string;
  processedAt?: string | undefined;
  remark?: string | undefined;
}

export interface MockDesignerTask {
  taskId: string;
  orderId: string;
  status: DesignerTaskStatus;
  deadline: string;
  remark?: string | undefined;
}

export const MOCK_DESIGNER_STATS: MockDesignerStats = {
  availableBalance: 12680,
  frozenBalance: 2400,
  monthlyEarnings: 5680,
  totalEarnings: 78420,
  completedCount: 86,
  pendingCount: 12,
  inProgressCount: 4,
};

export const MOCK_DESIGNER_WITHDRAWALS: MockDesignerWithdrawal[] = [
  {
    withdrawalId: "WD_001",
    designerId: "U_DES_001",
    amount: 3000,
    status: "completed",
    method: "alipay",
    account: "wang_designer@alipay.com",
    createdAt: "2026-07-08T10:00:00.000Z",
    processedAt: "2026-07-10T14:20:00.000Z",
  },
  {
    withdrawalId: "WD_002",
    designerId: "U_DES_001",
    amount: 2000,
    status: "approved",
    method: "wechat",
    account: "wang_designer_wx",
    createdAt: "2026-07-20T09:30:00.000Z",
  },
  {
    withdrawalId: "WD_003",
    designerId: "U_DES_001",
    amount: 1500,
    status: "pending",
    method: "bank",
    account: "6228 **** **** 5678",
    createdAt: "2026-07-25T16:00:00.000Z",
    remark: "日常提现",
  },
];

export const MOCK_DESIGNER_TASKS: MockDesignerTask[] = [
  {
    taskId: "T_001",
    orderId: "O_2026_0725_001",
    status: "in_progress",
    deadline: "2026-07-30T18:00:00.000Z",
    remark: "客户希望加亮浮雕细节",
  },
  {
    taskId: "T_002",
    orderId: "O_2026_0724_005",
    status: "reviewing",
    deadline: "2026-07-28T18:00:00.000Z",
  },
  {
    taskId: "T_003",
    orderId: "O_2026_0723_002",
    status: "pending",
    deadline: "2026-07-29T18:00:00.000Z",
    remark: "需要确认色彩方案",
  },
  {
    taskId: "T_004",
    orderId: "O_2026_0720_008",
    status: "completed",
    deadline: "2026-07-25T18:00:00.000Z",
  },
];

export const WITHDRAWAL_STATUS_LABELS: Record<
  DesignerWithdrawalStatus,
  string
> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  completed: "已完成",
};

export const WITHDRAWAL_STATUS_COLORS: Record<
  DesignerWithdrawalStatus,
  string
> = {
  pending:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  approved:
    "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  rejected:
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  completed:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

export const TASK_STATUS_LABELS: Record<DesignerTaskStatus, string> = {
  pending: "待办",
  in_progress: "进行中",
  reviewing: "等待审核",
  completed: "已完成",
  rejected: "已拒绝",
};

export const TASK_STATUS_COLORS: Record<DesignerTaskStatus, string> = {
  pending:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  in_progress:
    "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  reviewing:
    "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  completed:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  rejected:
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
};

export const METHOD_LABELS: Record<DesignerWithdrawalMethod, string> = {
  alipay: "支付宝",
  wechat: "微信",
  bank: "银行卡",
};
