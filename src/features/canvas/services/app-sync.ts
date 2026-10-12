// @ts-nocheck
/**
 * app-sync 占位 —— Plan §15 out-of-scope（WebDAV 备份/迁移）。
 */

export type AppSyncDomainKey = "canvasProjects" | "aiConfig" | "theme";
export type AppSyncProgressEvent = {
  domain: AppSyncDomainKey;
  done: number;
  total: number;
};

export async function syncAppDataToWebdav(): Promise<void> {
  console.warn("[canvas] app-sync.syncAppDataToWebdav 是占位实现，二期再做");
}
