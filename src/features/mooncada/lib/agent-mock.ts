// 代理商中心 Mock 数据
// 仿 mooncada-source MOCK_PROXY_INFO / MOCK_PROXY_WITHDRAWALS
// 前端 mock 演示，后端接入留后续阶段

export type WithdrawalMethod = "alipay" | "wechat" | "bank";
export type WithdrawalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed";

export interface MockAgentInfo {
  proxyId: string;
  name: string;
  level: string;
  availableBalance: number;
  frozenBalance: number;
  monthlyCommission: number;
  totalCommission: number;
  referralCode: string;
  referralUrl: string;
  qrcodeUrl: string;
  referredUsers: number;
  commissionRate: number;
}

export interface MockWithdrawal {
  withdrawalId: string;
  proxyId: string;
  amount: number;
  status: WithdrawalStatus;
  method: WithdrawalMethod;
  account: string;
  createdAt: string;
  processedAt?: string | undefined;
  remark?: string | undefined;
}

export const MOCK_AGENT_INFO: MockAgentInfo = {
  proxyId: "P_001",
  name: "李代理",
  level: "金牌代理",
  availableBalance: 8520.5,
  frozenBalance: 1200,
  monthlyCommission: 3280.5,
  totalCommission: 28450.8,
  referralCode: "MOONCADA-LI2026",
  referralUrl: "https://mooncoda.com/?ref=MOONCADA-LI2026",
  qrcodeUrl:
    "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://mooncoda.com/?ref=MOONCADA-LI2026",
  referredUsers: 156,
  commissionRate: 0.08,
};

export const MOCK_WITHDRAWALS: MockWithdrawal[] = [
  {
    withdrawalId: "PWD_001",
    proxyId: "P_001",
    amount: 2000,
    status: "completed",
    method: "alipay",
    account: "li_agent@alipay.com",
    createdAt: "2026-07-10T10:30:00.000Z",
    processedAt: "2026-07-12T14:20:00.000Z",
  },
  {
    withdrawalId: "PWD_002",
    proxyId: "P_001",
    amount: 1500,
    status: "approved",
    method: "wechat",
    account: "li_agent_wx",
    createdAt: "2026-07-18T09:15:00.000Z",
  },
  {
    withdrawalId: "PWD_003",
    proxyId: "P_001",
    amount: 800,
    status: "pending",
    method: "bank",
    account: "6228 **** **** 1234",
    createdAt: "2026-07-25T16:42:00.000Z",
    remark: "日常提现",
  },
  {
    withdrawalId: "PWD_004",
    proxyId: "P_001",
    amount: 3000,
    status: "completed",
    method: "alipay",
    account: "li_agent@alipay.com",
    createdAt: "2026-07-01T11:00:00.000Z",
    processedAt: "2026-07-03T15:00:00.000Z",
  },
];

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  completed: "已完成",
};

export const WITHDRAWAL_STATUS_COLORS: Record<WithdrawalStatus, string> = {
  pending:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  approved:
    "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  rejected:
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  completed:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

export const METHOD_LABELS: Record<WithdrawalMethod, string> = {
  alipay: "支付宝",
  wechat: "微信",
  bank: "银行卡",
};
