/**
 * 打印定价那两张表还在不在
 *
 * 迁移脚本没跑的时候,后台每一个写操作都会撞同一个错。与其让工作室看
 * 「保存失败,看服务端日志」,不如直接告诉他跑哪条命令。
 *
 * `describeDbError` 那部分住在 `shared/lib/db-error.ts` —— 商品定价那边
 * 也要用(见 `storefront/lib/price-source.ts`),不抄一份。
 */

import { describeDbError } from "@/features/shared/lib/db-error";

export type { DbErrorInfo } from "@/features/shared/lib/db-error";
export { describeDbError } from "@/features/shared/lib/db-error";

/**
 * 打印定价那两张表还在不在
 *
 * 迁移脚本没跑的时候,后台每一个写操作都会撞同一个错。与其让工作室看
 * 「保存失败,看服务端日志」,不如直接告诉他跑哪条命令。
 */
export function isMissingPrintPricingTable(error: unknown): boolean {
  return describeDbError(error).missingRelation;
}
