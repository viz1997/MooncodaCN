// @ts-nocheck
import axios from "axios";

import i18n from "@/features/canvas/i18n";
import {
  audioMimeType,
  normalizeAudioFormatValue,
  normalizeAudioSpeedValue,
  normalizeAudioVoiceValue,
} from "@/features/canvas/lib/audio-generation";
import { sanitizeForRemoteProxy } from "@/features/canvas/lib/canvas/sanitize-remote-config";
import {
  type UploadedFile,
  uploadMediaFile,
} from "@/features/canvas/services/file-storage";
import {
  type AiConfig,
  buildApiUrl,
  resolveModelRequestConfig,
  resolveModelScript,
} from "@/features/canvas/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";

type RequestOptions = { signal?: AbortSignal };
const apiText = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`apiErrors.${key}`, options);

function aiApiUrl(config: AiConfig, path: string) {
  return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function requestAudioGeneration(
  config: AiConfig,
  prompt: string,
  options?: RequestOptions
): Promise<Blob> {
  // Phase 3：内置渠道走 /api/canvas/generate 代理
  if (config.channelMode === "remote") {
    return requestRemoteAudio(config, prompt, options?.signal);
  }

  const requestConfig = resolveModelRequestConfig(
    config,
    config.model || config.audioModel
  );
  const model = requestConfig.model.trim();
  const format = normalizeAudioFormatValue(config.audioFormat);
  const script = resolveModelScript(config, config.model || config.audioModel);
  if (script) {
    if (!model) throw new Error(apiText("audioModelRequired"));
    if (!requestConfig.baseUrl.trim())
      throw new Error(apiText("baseUrlRequired"));
    if (!requestConfig.apiKey.trim())
      throw new Error(apiText("apiKeyRequired"));
    try {
      const result = await runModelPlugin({
        capability: "audio",
        script,
        config: requestConfig,
        prompt,
        params: {
          voice: normalizeAudioVoiceValue(config.audioVoice),
          format,
          speed: normalizeAudioSpeedValue(config.audioSpeed),
          instructions: config.audioInstructions.trim(),
        },
        signal: options?.signal,
      });
      return await audioPluginBlob(result, format);
    } catch (error) {
      throw new Error(readAxiosError(error, apiText("audioGenerationFailed")));
    }
  }
  assertAudioConfig(requestConfig, model);
  const instructions = config.audioInstructions.trim();

  try {
    const response = await axios.post<Blob>(
      aiApiUrl(requestConfig, "/audio/speech"),
      {
        model,
        input: prompt,
        voice: normalizeAudioVoiceValue(config.audioVoice),
        response_format: format,
        speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
        ...(instructions ? { instructions } : {}),
      },
      {
        headers: aiHeaders(requestConfig),
        responseType: "blob",
        signal: options?.signal,
      }
    );
    await assertAudioBlob(response.data);
    return response.data.type.startsWith("audio/")
      ? response.data
      : new Blob([response.data], { type: audioMimeType(format) });
  } catch (error) {
    throw new Error(readAxiosError(error, apiText("audioGenerationFailed")));
  }
}

async function audioPluginBlob(result: unknown, format: string): Promise<Blob> {
  if (result instanceof Blob)
    return result.type.startsWith("audio/")
      ? result
      : new Blob([result], { type: audioMimeType(format) });
  let source = "";
  if (typeof result === "string") source = result;
  else if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    source =
      typeof record.b64_json === "string"
        ? record.b64_json
        : typeof record.data === "string"
          ? record.data
          : typeof record.url === "string"
            ? record.url
            : "";
  }
  if (!source) throw new Error(apiText("scriptNoAudio"));
  const url =
    source.startsWith("data:") || /^https?:/i.test(source)
      ? source
      : `data:${audioMimeType(format)};base64,${source}`;
  const blob = await (await fetch(url)).blob();
  return blob.type.startsWith("audio/")
    ? blob
    : new Blob([blob], { type: audioMimeType(format) });
}

export async function storeGeneratedAudio(
  blob: Blob,
  format = "mp3"
): Promise<UploadedFile> {
  const audio = blob.type.startsWith("audio/")
    ? blob
    : new Blob([blob], { type: audioMimeType(format) });
  return uploadMediaFile(audio, "audio");
}

// ───────────────────────────────────────────────────────────────────────────
// Phase 3：内置渠道（channelMode === "remote"）走 /api/canvas/generate 代理
// 后端返 items[0].url 是 R2 永久 URL；fetch 转 Blob 即可，调用方接口形态不变
// ───────────────────────────────────────────────────────────────────────────

async function requestRemoteAudio(
  config: AiConfig,
  prompt: string,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await fetch("/api/canvas/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      capability: "audio",
      mode: "generation",
      prompt,
      ...sanitizeForRemoteProxy(config),
    }),
    signal,
  });

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    items?: Array<{ url: string; mimeType?: string }>;
    error?: string;
  };
  if (!response.ok || !body.success || !body.items?.[0]) {
    throw new Error(body.error || `内置音频请求失败：HTTP ${response.status}`);
  }

  const item = body.items[0];
  // R2 URL 已经在后端持久化；前端只需要 fetch 成 Blob 给后续 audio 标签用
  const res = await fetch(item.url, { signal });
  if (!res.ok) throw new Error(`下载内置音频失败：HTTP ${res.status}`);
  const blob = await res.blob();
  return blob.type.startsWith("audio/")
    ? blob
    : new Blob([blob], { type: item.mimeType || "audio/mpeg" });
}

function assertAudioConfig(config: AiConfig, model: string) {
  if (!model) throw new Error(apiText("audioModelRequired"));
  if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
  if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
  if (config.apiFormat === "gemini")
    throw new Error(apiText("geminiAudioUnsupported"));
}

async function assertAudioBlob(blob: Blob) {
  if (!blob.type.includes("json")) return;
  let payload: { code?: number; msg?: string; error?: { message?: string } };
  try {
    payload = JSON.parse(await blob.text()) as {
      code?: number;
      msg?: string;
      error?: { message?: string };
    };
  } catch {
    return;
  }
  if (typeof payload.code === "number" && payload.code !== 0)
    throw new Error(payload.msg || apiText("audioGenerationFailed"));
  if (payload.error?.message) throw new Error(payload.error.message);
}

function readApiErrorMessage(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      const inner = readApiErrorMessage(parsed) || value;
      if (
        inner === value &&
        typeof parsed === "object" &&
        Object.keys(parsed).length === 0
      )
        return "";
      return inner;
    } catch {
      if (/<[a-z][\s\S]*>/i.test(value))
        return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
      return value;
    }
  }
  if (typeof value !== "object") return "";
  const payload = value as {
    msg?: unknown;
    message?: unknown;
    error?: unknown;
    detail?: unknown;
  };
  const errorMsg =
    typeof payload.error === "string"
      ? payload.error
      : (payload.error as { message?: unknown })?.message;
  return (
    readApiErrorMessage(payload.msg) ||
    readApiErrorMessage(payload.message) ||
    readApiErrorMessage(errorMsg) ||
    readApiErrorMessage(payload.detail) ||
    ""
  );
}

function readAxiosError(error: unknown, fallback: string) {
  if (axios.isCancel(error)) return apiText("requestCanceled");
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    const apiMsg = readApiErrorMessage(responseData);
    if (apiMsg) return apiMsg;
    const statusMsg = statusMessage(error.response?.status, fallback);
    if (statusMsg) return statusMsg;
    return error.message || fallback;
  }
  if (error instanceof DOMException && error.name === "AbortError")
    return apiText("requestCanceled");
  return error instanceof Error
    ? readApiErrorMessage(error.message) || error.message
    : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
  if (status === 401 || status === 403) return apiText("authenticationFailed");
  if (status === 429) return apiText("rateLimited");
  if (status === 404) return apiText("notFound");
  if (status === 502) return apiText("badGateway");
  if (status === 503) return apiText("serviceBusy");
  return status ? apiText("httpFailed", { status }) : fallback;
}
