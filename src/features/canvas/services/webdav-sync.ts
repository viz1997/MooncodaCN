// @ts-nocheck
/**
 * webdav-sync 占位 —— Plan §15 out-of-scope。
 */

export const WEBDAV_MANIFEST_FILE_NAME = "mooncoda-canvas-manifest.json";

export async function testWebdavConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  console.warn(
    "[canvas] webdav-sync.testWebdavConnection 是占位实现，二期再做"
  );
  return { ok: false, error: "not-implemented" };
}
