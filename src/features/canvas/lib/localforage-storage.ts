// @ts-nocheck
import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

/**
 * localforage 配置 - Mooncoda 画布
 *
 * 数据库名 + store 名沿用 infinite-canvas 原值（"infinite-canvas" / "app_state"），
 * 因为这些是 IndexedDB 的物理容器名（不改可避免迁移脚本）。KEY_PREFIX 与
 * zustand persist name 在迁移到 "mooncoda:canvas:*"，**逻辑上**与原项目隔离。
 *
 * 注意：这里是**新部署**的 IndexedDB；旧 "infinite-canvas:*" key 不会再被读到。
 * 旧的画布项目（如果存在）需要走重新创建流程。
 */
localforage.config({
  name: "infinite-canvas",
  storeName: "app_state",
});

export const localForageStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === "undefined") return null;
    try {
      return (await localforage.getItem<string>(name)) || null;
    } catch {
      return window.localStorage.getItem(name);
    }
  },
  setItem: async (name, value) => {
    if (typeof window === "undefined") return;
    try {
      await localforage.setItem(name, value);
    } catch {
      window.localStorage.setItem(name, value);
    }
  },
  removeItem: async (name) => {
    if (typeof window === "undefined") return;
    try {
      await localforage.removeItem(name);
    } catch {
      window.localStorage.removeItem(name);
    }
  },
};
