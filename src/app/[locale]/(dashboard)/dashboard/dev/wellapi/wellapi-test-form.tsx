"use client";

/**
 * wellapi 测试表单 - 客户端组件
 * 负责：上传图、构造 FormData、POST 到 /api/test/wellapi、展示结果
 */

import { Download, Loader2, Send } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const SIZE_OPTIONS = [
  { value: "auto", label: "auto（默认）" },
  { value: "1024x1024", label: "1024×1024（方形）" },
  { value: "1536x1024", label: "1536×1024（横版）" },
  { value: "1024x1536", label: "1024×1536（竖版）" },
] as const;

interface WellapiResult {
  success: boolean;
  status?: number;
  statusText?: string;
  data?: {
    created?: number;
    data?: Array<{ url?: string; b64_json?: string }>;
    error?: { message?: string };
    raw?: string;
  };
  error?: string;
  hint?: string;
}

/**
 * 把单条 wellapi data 项渲染成可显示的图片 URL。
 * 优先用 upstream url（dall-e-2 / 部分 lite 模型），否则把 b64_json 包成 data URI
 * （gpt-image-1 / gpt-image-2 同步调用固定返 b64_json）。
 */
function toImageSrc(item: { url?: string; b64_json?: string }): string | null {
  if (item.url) return item.url;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  return null;
}

export function WellapiTestForm() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(
    "Create a ceramic pet refrigerator magnet based on the uploaded pet photo"
  );
  const [n, setN] = useState("1");
  const [size, setSize] = useState<string>("auto");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WellapiResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(f.type)
    ) {
      setResult({ success: false, error: "格式不支持，仅 JPG/PNG/WEBP" });
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setResult({ success: false, error: "图片超过 25MB" });
      return;
    }
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!file) {
      setResult({ success: false, error: "请先选择图片" });
      return;
    }
    if (!prompt.trim()) {
      setResult({ success: false, error: "请输入提示词" });
      return;
    }

    setSubmitting(true);
    setResult(null);
    setElapsedMs(null);
    const t0 = performance.now();

    const fd = new FormData();
    fd.append("image", file);
    fd.append("prompt", prompt.trim());
    fd.append("n", n);
    fd.append("size", size);

    try {
      const resp = await fetch("/api/test/wellapi", {
        method: "POST",
        body: fd,
      });
      const data = (await resp.json()) as WellapiResult;
      setResult(data);
      setElapsedMs(Math.round(performance.now() - t0));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "请求失败";
      setResult({ success: false, error: msg });
      setElapsedMs(Math.round(performance.now() - t0));
    } finally {
      setSubmitting(false);
    }
  };

  const images =
    result?.data?.data
      ?.map((d) => ({ src: toImageSrc(d), raw: d }))
      .filter(
        (x): x is { src: string; raw: { url?: string; b64_json?: string } } =>
          x.src !== null
      ) ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ============ 左侧：表单 ============ */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="space-y-2">
          <Label className="text-xs font-semibold">参考图（≤25MB）</Label>
          <Input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="text-xs"
          />
          {previewUrl && (
            <div className="mt-2">
              {/* biome-ignore lint/performance/noImgElement: 本地预览 */}
              <img
                src={previewUrl}
                alt="preview"
                className="w-full max-h-64 object-contain rounded border bg-muted"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {file?.name} · {((file?.size ?? 0) / 1024).toFixed(1)} KB
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold">Prompt</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="text-xs font-mono"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">数量 n</Label>
            <Select value={n} onValueChange={setN}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                  <SelectItem key={v} value={String(v)} className="text-xs">
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold">尺寸</Label>
            <Select value={size} onValueChange={setSize}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-violet-600 hover:bg-violet-700"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              wellapi 推理中…
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              提交测试
            </>
          )}
        </Button>
      </div>

      {/* ============ 右侧：结果 ============ */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">结果</Label>
          {result && (
            <div className="flex items-center gap-2">
              {elapsedMs !== null && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  {(elapsedMs / 1000).toFixed(1)}s
                </Badge>
              )}
              <Badge
                variant={result.success ? "default" : "destructive"}
                className="text-[10px]"
              >
                {result.success
                  ? `${result.status ?? 200} OK`
                  : `${result.status ?? "ERR"} ${result.statusText ?? ""}`}
              </Badge>
            </div>
          )}
        </div>

        {!result ? (
          <div className="aspect-video rounded border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground">
            提交后在此查看响应
          </div>
        ) : result.error ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
            <p className="font-semibold text-rose-700 dark:text-rose-400 mb-1">
              调用失败
            </p>
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-rose-600">
              {result.error}
            </pre>
          </div>
        ) : (
          <div className="space-y-3">
            {images.length > 0 && (
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(images.length, 2)}, minmax(0, 1fr))`,
                }}
              >
                {images.map((img, i) => {
                  const isDataUri = img.src.startsWith("data:");
                  const dl = isDataUri
                    ? // data URI 用 <a download> 直接下载
                      img.src
                    : img.src;
                  const dlName = `wellapi-${Date.now()}-${i + 1}.png`;
                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: 候选按返回顺序
                      key={i}
                      className="space-y-1"
                    >
                      {/* biome-ignore lint/performance/noImgElement: wellapi 返回 url 或 data URI */}
                      <img
                        src={img.src}
                        alt={`result-${i + 1}`}
                        className="w-full aspect-square object-cover rounded border bg-muted"
                      />
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {img.raw.b64_json
                            ? `b64_json · ${(img.raw.b64_json.length / 1024).toFixed(1)}KB`
                            : img.raw.url
                              ? "url"
                              : "?"}
                        </span>
                        {isDataUri ? (
                          <a
                            href={dl}
                            download={dlName}
                            className="text-[10px] text-violet-600 hover:underline inline-flex items-center gap-1"
                          >
                            <Download className="h-3 w-3" />
                            保存
                          </a>
                        ) : (
                          <a
                            href={img.src}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-violet-600 hover:underline inline-flex items-center gap-1"
                          >
                            打开
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded border bg-muted/30 p-2">
              <p className="text-[10px] text-muted-foreground mb-1">
                原始 JSON
              </p>
              <pre className="text-[10px] font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
