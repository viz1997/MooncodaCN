/**
 * 积分系统核心类型
 *
 * 定义积分发放、消费、查询所需的参数与结果类型
 */

import type { CreditsBatchSource, CreditsTransactionType } from "@/db/schema";

/**
 * 发放积分参数
 */
export interface GrantCreditsParams {
  /** 用户 ID */
  userId: string;
  /** 积分数量 */
  amount: number;
  /** 批次来源类型 */
  sourceType: CreditsBatchSource;
  /** 借方账户（资金来源） */
  debitAccount: string;
  /** 交易类型 */
  transactionType: CreditsTransactionType;
  /** 过期时间，null 表示永不过期 */
  expiresAt?: Date | null;
  /** 来源引用（订单 ID、订阅 ID 等） */
  sourceRef?: string;
  /** 交易描述 */
  description?: string;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 发放积分结果
 */
export interface GrantCreditsResult {
  /** 实际发放数量 */
  amount: number;
  /** 积分批次 ID */
  batchId: string;
  /** 交易记录 ID */
  transactionId: string;
  /** 发放后余额 */
  newBalance: number;
}

/**
 * 从某个批次中消费的明细
 */
export interface ConsumedBatch {
  /** 批次 ID */
  batchId: string;
  /** 从该批次消费的数量 */
  consumedFromBatch: number;
}

/**
 * 消费积分参数
 */
export interface ConsumeCreditsParams {
  /** 用户 ID */
  userId: string;
  /** 消费数量 */
  amount: number;
  /** 服务名称 */
  serviceName: string;
  /** 交易描述 */
  description?: string;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 消费积分结果
 */
export interface ConsumeCreditsResult {
  /** 是否成功 */
  success: boolean;
  /** 实际消费数量 */
  consumedAmount: number;
  /** 剩余余额 */
  remainingBalance: number;
  /** 交易记录 ID */
  transactionId: string;
  /** 消费明细 */
  consumedBatches: ConsumedBatch[];
}

/**
 * 注册奖励结果
 */
export type EnsureRegistrationBonusResult =
  | { granted: true; amount: number }
  | { granted: false; reason: string };

/**
 * 过期批次处理结果
 */
export interface ExpiredBatchResult {
  /** 批次 ID */
  batchId: string;
  /** 用户 ID */
  userId: string;
  /** 过期积分数量 */
  expiredAmount: number;
}

/**
 * 交易查询分页选项
 */
export interface TransactionQueryOptions {
  /** 返回数量上限 */
  limit?: number;
  /** 跳过数量 */
  offset?: number;
}
