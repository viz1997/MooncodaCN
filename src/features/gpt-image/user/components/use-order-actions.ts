"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { candidateUrl } from "./image-urls";

interface ActionsOptions {
  token: string;
  refresh: () => Promise<void>;
}

export interface UseOrderActionsResult {
  uploading: boolean;
  submitting: boolean;
  cancelling: boolean;
  regenerating: boolean;
  retryingAll: boolean;
  /** 把单个文件走 R2 预签名直传，然后 POST publicUrl 列表到 /upload */
  upload: (files: File[]) => Promise<boolean>;
  submit: (selections: number[]) => Promise<boolean>;
  cancel: () => Promise<boolean>;
  regenerate: (imageIdx: number) => Promise<boolean>;
  /** 失败后一键重试：对所有已上传图重新跑生成 */
  retryAll: () => Promise<boolean>;
  download: (
    orderNo: string,
    imageIdx: number,
    candIdx: number
  ) => Promise<void>;
}

async function readError(res: Response, fallback: string) {
  try {
    const json = await res.json();
    return json.error || fallback;
  } catch {
    return fallback;
  }
}

async function presignOne(
  token: string,
  file: File
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const presignRes = await fetch(`/api/orders/${token}/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentType: file.type,
      size: file.size,
      ext: file.name.split(".").pop()?.toLowerCase(),
    }),
  });
  if (!presignRes.ok) {
    throw new Error(await readError(presignRes, "获取上传地址失败"));
  }
  const presignJson = (await presignRes.json()) as {
    success: boolean;
    uploadUrl?: string;
    publicUrl?: string;
    error?: string;
  };
  if (
    !presignJson.success ||
    !presignJson.uploadUrl ||
    !presignJson.publicUrl
  ) {
    throw new Error(presignJson.error ?? "获取上传地址失败");
  }
  return {
    uploadUrl: presignJson.uploadUrl,
    publicUrl: presignJson.publicUrl,
  };
}

async function putToR2(
  uploadUrl: string,
  file: File,
  contentType: string
): Promise<void> {
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`上传到存储失败：HTTP ${putRes.status}`);
  }
}

export function useOrderActions({
  token,
  refresh,
}: ActionsOptions): UseOrderActionsResult {
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        toast.error("请先选择至少一张图片");
        return false;
      }
      setUploading(true);
      try {
        // 1) 对每张图串行：取预签名 → PUT 到 R2
        const publicUrls: string[] = [];
        for (const file of files) {
          const { uploadUrl, publicUrl } = await presignOne(token, file);
          // 注意：uploadUrl 是 S3 API endpoint 签名 URL（用于 PUT），
          // publicUrl 是 r2.dev 公共域（用于读），二者不能混用。
          await putToR2(uploadUrl, file, file.type);
          publicUrls.push(publicUrl);
        }
        // 2) 把公开 URL 列表交给 /upload 落库 + 触发生成
        const res = await fetch(`/api/orders/${token}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: publicUrls.map((publicUrl) => ({ publicUrl })),
          }),
        });
        if (!res.ok) throw new Error(await readError(res, "提交失败"));
        toast.success(`${files.length} 张图片已上传，正在生成效果图`);
        await refresh();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "上传失败");
        return false;
      } finally {
        setUploading(false);
      }
    },
    [token, refresh]
  );

  const submit = useCallback(
    async (selections: number[]) => {
      setSubmitting(true);
      try {
        const res = await fetch(`/api/orders/${token}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selections }),
        });
        if (!res.ok) throw new Error(await readError(res, "提交失败"));
        toast.success("已提交，结果已锁定");
        await refresh();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "提交失败");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [token, refresh]
  );

  const cancel = useCallback(async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/orders/${token}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await readError(res, "取消失败"));
      toast.success("订单已取消");
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取消失败");
      return false;
    } finally {
      setCancelling(false);
    }
  }, [token, refresh]);

  const regenerate = useCallback(
    async (imageIdx: number) => {
      setRegenerating(true);
      try {
        const res = await fetch(`/api/orders/${token}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIdx }),
        });
        if (!res.ok) throw new Error(await readError(res, "重新生成失败"));
        toast.success("正在重新生成效果图");
        await refresh();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "重新生成失败");
        return false;
      } finally {
        setRegenerating(false);
      }
    },
    [token, refresh]
  );

  const retryAll = useCallback(async () => {
    setRetryingAll(true);
    try {
      // 不传 imageIdx = 批量重跑所有已上传图（用于 FAILED 状态）
      const res = await fetch(`/api/orders/${token}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await readError(res, "重新生成失败"));
      toast.success("正在为所有图片重新生成效果图");
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重新生成失败");
      return false;
    } finally {
      setRetryingAll(false);
    }
  }, [token, refresh]);

  const download = useCallback(
    async (orderNo: string, imageIdx: number, candIdx: number) => {
      try {
        // /candidates 现在是 302 → fetch 自动跟随重定向拿到二进制
        const res = await fetch(candidateUrl(token, imageIdx, candIdx));
        if (!res.ok) throw new Error(await readError(res, "下载失败"));
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${orderNo}-img${imageIdx + 1}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "下载失败");
      }
    },
    [token]
  );

  return {
    uploading,
    submitting,
    cancelling,
    regenerating,
    retryingAll,
    upload,
    submit,
    cancel,
    regenerate,
    retryAll,
    download,
  };
}
