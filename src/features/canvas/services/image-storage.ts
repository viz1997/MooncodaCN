// @ts-nocheck
import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/features/canvas/i18n";
import { readImageMeta } from "@/features/canvas/lib/image-utils";

export type UploadedImage = {
  url: string;
  storageKey: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

const store = localforage.createInstance({
  name: "infinite-canvas",
  storeName: "image_files",
});
const imageLogStore = localforage.createInstance({
  name: "infinite-canvas",
  storeName: "image_generation_logs",
});
const videoLogStore = localforage.createInstance({
  name: "infinite-canvas",
  storeName: "video_generation_logs",
});
const objectUrls = new Map<string, string>();

export async function uploadImage(
  input: string | Blob
): Promise<UploadedImage> {
  // Phase 3：内置渠道（/api/canvas/generate）已经返回 R2 永久 URL —— 不再走
  // localforage，URL 直接作为渲染地址，storageKey 用 R2 objectKey（以 "r2:" 前缀
  // 区分本地 blob）。这样：
  //   - 节点 metadata.content 是 R2 公开 URL，跨设备 / 跨会话稳定
  //   - 浏览器关闭也不丢图（localforage 是本地的，关浏览器就清空）
  if (typeof input === "string" && /^https?:\/\//i.test(input)) {
    const meta = await readImageMeta(input);
    return {
      url: input,
      storageKey: `r2:${input}`,
      width: meta.width,
      height: meta.height,
      bytes: 0,
      mimeType: meta.mimeType,
    };
  }

  const blob =
    typeof input === "string" ? await (await fetch(input)).blob() : input;
  const storageKey = `image:${nanoid()}`;
  await store.setItem(storageKey, blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  const meta = await readImageMeta(url);
  return {
    url,
    storageKey,
    width: meta.width,
    height: meta.height,
    bytes: blob.size,
    mimeType: blob.type || meta.mimeType,
  };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
  if (!storageKey) return fallback;
  // 2026-08-28：r2: 前缀的 storageKey 是 Phase 3 内置渠道持久化方案
  // （见 uploadImage 注释）—— URL 本身就是 R2 公开地址，没有对应的 localforage
  // blob。直接返回 URL，否则会去 store.getItem miss、再回落 fallback，导致
  // thumbnailUrl(dataUrl, w) 拿到空串 → <img> 破图。
  if (storageKey.startsWith("r2:")) return storageKey.slice(3);
  const cached = objectUrls.get(storageKey);
  if (cached) return cached;
  const blob = await store.getItem<Blob>(storageKey);
  if (!blob) return fallback;
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  return url;
}

export async function getImageBlob(storageKey: string) {
  return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
  await store.setItem(storageKey, blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  return url;
}

export async function imageToDataUrl(
  image: {
    url?: string;
    dataUrl?: string;
    storageKey?: string;
  },
  /**
   * 2026-08-24：内置渠道（/api/canvas/generate）已经把节点 URL 持久化为 R2
   * 公开地址，无脑 fetch + base64 会让多张高清参考图的 POST body 直接撞
   * Vercel 4.5MB 上限（413）。这里默认对 https URL 直传，但用户配置渠道里
   * 还有 FormData multipart 上传路径（OpenAI /images/edits、OpenAI 视频）
   * 真需要 base64 才能塞进 File —— 这种情况 caller 必须传
   * `{ forceDataUrl: true }`，否则会把 URL 字符串当 base64 解码成 0 字节文件。
   */
  options: { forceDataUrl?: boolean } = {}
) {
  const url =
    image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
  if (!url) return "";
  if (!options.forceDataUrl && /^https?:\/\//i.test(url)) return url;
  if (url.startsWith("data:")) return url;
  return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
  await Promise.all(
    Array.from(new Set(keys)).map(async (key) => {
      const url = objectUrls.get(key);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(key);
      await store.removeItem(key);
    })
  );
}

export async function cleanupUnusedImages(usedData: unknown) {
  const usedKeys = collectImageStorageKeys(usedData);
  await Promise.all([
    imageLogStore.iterate((value) => {
      collectImageStorageKeys(value, usedKeys);
    }),
    videoLogStore.iterate((value) => {
      collectImageStorageKeys(value, usedKeys);
    }),
  ]);
  const unused: string[] = [];
  await store.iterate((_value, key) => {
    if (!usedKeys.has(key)) unused.push(key);
  });
  await deleteStoredImages(unused);
}

export function collectImageStorageKeys(
  value: unknown,
  keys = new Set<string>()
) {
  if (!value || typeof value !== "object") return keys;
  if (
    "storageKey" in value &&
    typeof value.storageKey === "string" &&
    value.storageKey.startsWith("image:")
  )
    keys.add(value.storageKey);
  Object.values(value).forEach((item) =>
    Array.isArray(item)
      ? item.forEach((child) => collectImageStorageKeys(child, keys))
      : collectImageStorageKeys(item, keys)
  );
  return keys;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
    reader.readAsDataURL(blob);
  });
}
