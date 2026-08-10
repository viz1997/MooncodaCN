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
  /** 正在取消整个订单（终态，不可恢复） */
  cancelling: boolean;
  /** 正在停止当前一轮的生成（订单保留，已完成的候选图保留） */
  stopping: boolean;
  regenerating: boolean;
  retryingAll: boolean;
  /** 把单个文件走 R2 预签名直传，然后 POST publicUrl 列表到 /upload */
  upload: (files: File[]) => Promise<boolean>;
  submit: (selections: number[]) => Promise<boolean>;
  /** 取消整个订单 → 状态变成 CANCELLED，链接失效 */
  cancel: () => Promise<boolean>;
  /** 停止生成 → 中断当前 in-flight 的生成任务，订单保留 */
  stopGeneration: () => Promise<boolean>;
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
  const [stopping, setStopping] = useState(false);
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
        // 后端会把"上传成功但生成启动失败"的情况以 success:false 回传，
        // 此时 status=FAILED、data.errorMessage 是真实原因——直接展示给用户，
        // 不再用"正在生成效果图"误导。
        const json = (await res.json()) as {
          success: boolean;
          message?: string;
          data?: { status?: string; errorMessage?: string | null };
        };
        if (json.success) {
          toast.success(`${files.length} 张图片已上传，正在生成效果图`);
        } else {
          toast.error(json.message ?? "生图任务提交失败，请稍后重试");
        }
        await refresh();
        return json.success;
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

  /**
   * "停止生成"——**不是取消订单**。
   *
   * 协作式打断当前在跑的生成任务。订单保留、已完成的候选图保留；
   * 状态机会落到 FAILED（完成度 0）或 CANDIDATES_READY（部分完成）。
   * 走的是 /stop-generation 这条单独的路由，不会变 CANCELLED。
   */
  const stopGeneration = useCallback(async () => {
    setStopping(true);
    try {
      const res = await fetch(`/api/orders/${token}/stop-generation`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await readError(res, "停止生成失败"));
      toast.success("已停止本次生成");
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "停止生成失败");
      return false;
    } finally {
      setStopping(false);
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
    stopping,
    regenerating,
    retryingAll,
    upload,
    submit,
    cancel,
    stopGeneration,
    regenerate,
    retryAll,
    download,
  };
}
