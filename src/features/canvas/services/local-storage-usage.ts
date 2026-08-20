// @ts-nocheck
/**
 * local-storage-usage 占位 —— Plan §15 out-of-scope。
 * 真实实现要扫 localStorage / IndexedDB 用量；本期不做，先返回空数据避免 UI 报错。
 */

export type LocalStorageUsage = {
  used: number;
  quota: number;
};

export async function readLocalStorageUsage(): Promise<LocalStorageUsage> {
  return { used: 0, quota: 0 };
}
