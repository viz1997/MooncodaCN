/**
 * Submit 路由 model 优先级解析器 —— 纯函数单元测试
 *
 * 2026-10-14:抽出 pure function 后补的覆盖。覆盖矩阵:
 *
 * | bodyModel     | maskModel  | 期望 selectedModel       | fromUserOverride |
 * |---------------|------------|--------------------------|------------------|
 * | undefined     | undefined  | fallback                 | false            |
 * | undefined     | "qwen"     | "qwen"                   | false            |
 * | undefined     | "doubao"   | fallback(mask 不在白名单)| false            |
 * | undefined     | null       | fallback                 | false            |
 * | "apimart..."  | undefined  | "apimart..."             | true             |
 * | "apimart..."  | "gpt_image_2" | "apimart..."         | true(不被 mask 反向覆盖)|
 * | "doubao"      | "qwen"     | undefined(用户非法)      | true             |
 * | "qwen"        | "doubao"   | "qwen"(不被 mask 反向覆盖)| true            |
 */

import { describe, expect, it } from "vitest";

import { resolveSelectedModel } from "@/features/image-gen/lib/submit-model-resolver";

const ALLOWED = [
  "apimart_gpt_image",
  "apimart_gpt_image_sunburst",
  "qwen",
  "gpt_image_2",
  "nano_banana2",
] as const;

describe("resolveSelectedModel", () => {
  describe("用户未传 model(mask 推荐路径)", () => {
    it("mask.model 缺省 → fallback", () => {
      const result = resolveSelectedModel({
        bodyModel: undefined,
        maskModel: undefined,
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBe("apimart_gpt_image");
      expect(result.fromUserOverride).toBe(false);
    });

    it("mask.model === null → fallback", () => {
      const result = resolveSelectedModel({
        bodyModel: undefined,
        maskModel: null,
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBe("apimart_gpt_image");
      expect(result.fromUserOverride).toBe(false);
    });

    it("mask.model 是白名单内合法值 → 用 mask.model", () => {
      const result = resolveSelectedModel({
        bodyModel: undefined,
        maskModel: "qwen",
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBe("qwen");
      expect(result.fromUserOverride).toBe(false);
    });

    it("mask.model 不在白名单(2026-09-11 精简后的历史遗留如 doubao)→ fallback,不抛错", () => {
      const result = resolveSelectedModel({
        bodyModel: undefined,
        maskModel: "doubao",
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBe("apimart_gpt_image");
      expect(result.fromUserOverride).toBe(false);
    });
  });

  describe("用户显式传 model(body.model 路径)", () => {
    it("用户传白名单内 model → 用用户的,标记 fromUserOverride", () => {
      const result = resolveSelectedModel({
        bodyModel: "apimart_gpt_image",
        maskModel: undefined,
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBe("apimart_gpt_image");
      expect(result.fromUserOverride).toBe(true);
    });

    it("用户传白名单内 model → 不被 mask.model 反向覆盖(leather badge 场景)", () => {
      // 模拟 leather badge:mask.model = "gpt_image_2",用户显式传 apimart_gpt_image_sunburst
      const result = resolveSelectedModel({
        bodyModel: "apimart_gpt_image_sunburst",
        maskModel: "gpt_image_2",
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBe("apimart_gpt_image_sunburst");
      expect(result.fromUserOverride).toBe(true);
    });

    it("用户传不在白名单的 model → selectedModel === undefined(由 route 返 403)", () => {
      const result = resolveSelectedModel({
        bodyModel: "doubao", // 已下线模型
        maskModel: "qwen", // mask 推荐合法
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBeUndefined();
      expect(result.fromUserOverride).toBe(true);
    });

    it("用户传不在白名单的 model,即使 mask 推荐也不在白名单 → 仍是 undefined,不 fallback 到 mask 推荐", () => {
      // 关键:用户非法 model 不能被「mask 推荐 fallback」掩盖,
      // 否则前端看到「我传 X 怎么出来 Y」会困惑。
      const result = resolveSelectedModel({
        bodyModel: "doubao",
        maskModel: "old-model", // 也不在白名单
        allowedModels: ALLOWED,
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBeUndefined();
      expect(result.fromUserOverride).toBe(true);
    });
  });

  describe("边界 case", () => {
    it("allowedModels 为空数组 → 任何 mask 推荐都 fallback,用户显式一律 undefined", () => {
      const resultUser = resolveSelectedModel({
        bodyModel: "qwen",
        maskModel: undefined,
        allowedModels: [],
        fallback: "apimart_gpt_image",
      });
      expect(resultUser.selectedModel).toBeUndefined();
      expect(resultUser.fromUserOverride).toBe(true);

      const resultMask = resolveSelectedModel({
        bodyModel: undefined,
        maskModel: "qwen",
        allowedModels: [],
        fallback: "apimart_gpt_image",
      });
      expect(resultMask.selectedModel).toBe("apimart_gpt_image");
      expect(resultMask.fromUserOverride).toBe(false);
    });

    it("fallback 也不在白名单 → 仍然返回 fallback(兜底值,信任调用方)", () => {
      // 防御性测试:即使 fallback 配置错(理论上不应该发生),resolver
      // 也会返 fallback 让调用方走 403 / panic,而不是返 undefined。
      const result = resolveSelectedModel({
        bodyModel: undefined,
        maskModel: undefined,
        allowedModels: ["qwen"], // fallback 不在里面
        fallback: "apimart_gpt_image",
      });
      expect(result.selectedModel).toBe("apimart_gpt_image");
    });
  });
});
