// @ts-nocheck
/**
 * 用户自存提示词 store
 *
 * 与 PromptSelectDialog「我的提示词」Tab 配套：
 *   - 工作台编辑 prompt 后点「收藏」→ addPrompt() 存到这里
 *   - Dialog 列出用户保存的所有提示词，点选后填回工作台
 *
 * 持久化：localforage（IndexedDB），key 前缀 mooncoda:canvas:* 与画布其他 store 保持一致。
 * 不走后端是因为这是本地草稿库（不像 promptTemplate 是管理员下发的官方模板）——
 * 与 useAssetStore（图片资产）的设计对称。
 *
 * 数据形态：
 *   - id：nanoid
 *   - title：用户起的名字（必填，dialog 里让用户填）
 *   - prompt：完整提示词文本（必填）
 *   - tags：可选标签，用于将来筛选
 *   - source：来源标记（"workbench" 暂时只有这一种，留着兼容 future）
 *   - createdAt / updatedAt：ISO 字符串
 */

import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { localForageStorage } from "@/features/canvas/lib/localforage-storage";

export type SavedPromptSource = "workbench" | "asset-text";

export type SavedPrompt = {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  source: SavedPromptSource;
  createdAt: string;
  updatedAt: string;
};

type MyPromptStore = {
  prompts: SavedPrompt[];
  addPrompt: (input: {
    title: string;
    prompt: string;
    tags?: string[];
    source?: SavedPromptSource;
  }) => string;
  updatePrompt: (
    id: string,
    patch: Partial<Omit<SavedPrompt, "id" | "createdAt">>
  ) => void;
  removePrompt: (id: string) => void;
};

const MY_PROMPT_STORE_KEY = "mooncoda:canvas:my_prompt_store";

export const useMyPromptStore = create<MyPromptStore>()(
  persist(
    (set) => ({
      prompts: [],
      addPrompt: (input) => {
        const now = new Date().toISOString();
        const id = nanoid();
        set((state) => ({
          prompts: [
            {
              id,
              title: input.title,
              prompt: input.prompt,
              tags: input.tags ?? [],
              source: input.source ?? "workbench",
              createdAt: now,
              updatedAt: now,
            },
            ...state.prompts,
          ],
        }));
        return id;
      },
      updatePrompt: (id, patch) =>
        set((state) => ({
          prompts: state.prompts.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...patch,
                  updatedAt: new Date().toISOString(),
                }
              : item
          ),
        })),
      removePrompt: (id) =>
        set((state) => ({
          prompts: state.prompts.filter((item) => item.id !== id),
        })),
    }),
    {
      name: MY_PROMPT_STORE_KEY,
      storage: {
        getItem: async (name) => {
          const raw = await localForageStorage.getItem(name);
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        setItem: (name, value) =>
          localForageStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => localForageStorage.removeItem(name),
      },
      partialize: (state) => ({ prompts: state.prompts }),
    }
  )
);
