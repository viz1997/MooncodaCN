/**
 * 画布内置渠道积分定价
 *
 * 简单维度：能力（image/video/audio/text）+ 模型分辨率 / 时长 / 字符数。
 * 实际定价可后续按上游成本调整 —— 先有一个合理默认让 Phase 3 跑通。
 *
 * 单位：积分（credits）。1 元 ≈ 1000 积分（CREDIT_PACKAGES 反推）。
 *
 * 参考 image-gen/lib/generation-service.ts:45-55 的 calculateCreditsCost（按 USD × 7.2 折 CNY × 1000 向上取整）；
 * 这里走固定表格，避免每次调上游拿价。
 */

export type CanvasCapability =
  | "image"
  | "video"
  | "audio"
  | "text"
  | "image-to-3d"
  | "multi-image-to-3d";

export type CanvasCostInput = {
  capability: CanvasCapability;
  // image: size 维度
  size?: string;
  // video: 时长（秒）
  videoSeconds?: number | string;
  // audio: 输入字符数
  audioInput?: string;
};

const LARGE_IMAGE_PATTERN = /1792|4K|2K|hd/i;

export function calculateCanvasCost(input: CanvasCostInput): number {
  const { capability } = input;

  if (capability === "image") {
    const size = input.size || "1024x1024";
    return LARGE_IMAGE_PATTERN.test(size) ? 80 : 20;
  }

  if (capability === "video") {
    const seconds = Number(input.videoSeconds) || 6;
    return Math.max(50, seconds * 50);
  }

  if (capability === "audio") {
    const chars = (input.audioInput || "").length;
    if (chars === 0) return 10;
    return Math.max(10, Math.ceil(chars / 1000) * 10);
  }

  // 2026-09-15：画布内 Meshy Image-to-3D —— 固定 200 积分/任务。
  // 定价参考：Meshy 一次 Image-to-3D 任务消耗约 20 credits，
  // 对标 OpenAI gpt-image-1 单图 4K 80 积分的 2.5x —— 用户获得的是
  // 「3D 可打印模型 + R2 永久 URL」比单图价值高。
  // 调价改这一行即可，无需触动其他逻辑。
  if (capability === "image-to-3d") {
    return 200;
  }

  // 2026-09-16：画布内 Meshy Multi-Image to 3D —— 固定 400 积分/任务。
  // 2-4 张图合并转 3D，单图 200 的 2 倍。多视图一致性 Meshy 上游成本更高，
  // 用户获得的是「多角度合并的高质量 GLB」比单图价值高。
  // 调价改这一行即可。
  if (capability === "multi-image-to-3d") {
    return 400;
  }

  // text（chat / 文本流式）
  return 5;
}

/**
 * 给前端展示用的"模型 → 单次成本"对照表。
 * UI 在 AppConfigModal「内置」模式下列出每条 entry。
 */
export const CANVAS_BUILTIN_MODELS: Array<{
  capability: CanvasCapability;
  model: string;
  labelKey: string;
  cost: number;
}> = [
  {
    capability: "image",
    model: "gpt-image-1",
    labelKey: "gpt-image-1",
    cost: 20,
  },
  {
    capability: "image",
    model: "gpt-image-2",
    labelKey: "gpt-image-2",
    cost: 25,
  },
  { capability: "image", model: "dall-e-3", labelKey: "dall-e-3", cost: 20 },
  {
    capability: "image",
    model: "gpt-image-1 (4K)",
    labelKey: "gpt-image-1-4k",
    cost: 80,
  },
  {
    capability: "audio",
    model: "gpt-4o-mini-tts",
    labelKey: "gpt-4o-mini-tts",
    cost: 10,
  },
  {
    capability: "text",
    model: "gpt-4o-mini",
    labelKey: "gpt-4o-mini",
    cost: 5,
  },
  // 2026-09-15：画布内 Meshy Image-to-3D 集成
  {
    capability: "image-to-3d",
    model: "meshy-image-to-3d",
    labelKey: "meshy-image-to-3d",
    cost: 200,
  },
  // 2026-09-16：画布内 Meshy Multi-Image to 3D 集成
  {
    capability: "multi-image-to-3d",
    model: "meshy-multi-image-to-3d",
    labelKey: "meshy-multi-image-to-3d",
    cost: 400,
  },
];
