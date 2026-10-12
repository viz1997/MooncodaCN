/**
 * 积分系统错误类
 *
 * 提供具有业务语义的异常类型，便于调用方做差异化处理
 */

/**
 * 积分不足错误
 */
export class InsufficientCreditsError extends Error {
  /** 所需积分 */
  required: number;
  /** 可用积分 */
  available: number;

  constructor(required: number, available: number) {
    super(`积分不足：需要 ${required}，当前可用 ${available}`);
    this.name = "InsufficientCreditsError";
    this.required = required;
    this.available = available;
  }
}

/**
 * 账户已冻结错误
 */
export class AccountFrozenError extends Error {
  constructor(message = "积分账户已冻结，无法操作") {
    super(message);
    this.name = "AccountFrozenError";
  }
}
