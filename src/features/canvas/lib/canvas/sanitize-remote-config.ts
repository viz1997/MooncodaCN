/**
 * 画布内置渠道 — 配置剥离
 *
 * 浏览器发往 /api/canvas/generate 时**不能**带 apiKey / baseUrl / channels，
 * 这些都该由后端用 env 里的系统 Key 注入。前端只传 model / size / quality
 * 等"参数化"字段。
 *
 * 这个 helper 同时支持普通 `AiConfig` 与 user-mode 的简化版
 * （callers 拿到 AiConfig 即可，无需自己再剥）。
 */

import type { AiConfig } from "@/features/canvas/stores/use-config-store";
import { decodeChannelModel } from "@/features/canvas/stores/use-config-store";

export type RemoteConfigPayload = {
  model: string;
  size?: string;
  quality?: string;
  background?: string;
  n?: number;
  videoSeconds?: number;
  voice?: string;
  audioFormat?: string;
  audioSpeed?: number;
  audioInstructions?: string;
  reasoningEffort?: string;
};

/**
 * 内置渠道下的真实模型名 —— 剥掉 `channelId::` 前缀。
 * channelMode=remote 时后端不认 channel（走 env 系统 Key），传 channel-prefixed 名字会被 OpenAI 拒。
 */
function resolveBareModelName(value: string | undefined): string {
  if (!value) return "";
  return decodeChannelModel(value)?.model ?? value;
}

export function sanitizeForRemoteProxy(config: AiConfig): RemoteConfigPayload {
  return {
    model: resolveBareModelName(config.model) || config.model,
    ...(config.size ? { size: config.size } : {}),
    ...(config.quality ? { quality: config.quality } : {}),
    ...(config.background ? { background: config.background } : {}),
    ...(config.count ? { n: Number(config.count) || 1 } : {}),
    ...(config.videoSeconds
      ? { videoSeconds: Number(config.videoSeconds) }
      : {}),
    ...(config.audioVoice ? { voice: config.audioVoice } : {}),
    ...(config.audioFormat ? { audioFormat: config.audioFormat } : {}),
    ...(config.audioSpeed
      ? { audioSpeed: Number(config.audioSpeed) || 1 }
      : {}),
    ...(config.audioInstructions
      ? { audioInstructions: config.audioInstructions }
      : {}),
    ...(config.reasoningEffort
      ? { reasoningEffort: config.reasoningEffort }
      : {}),
  };
}
