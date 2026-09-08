"use client";

/**
 * 单图上传步骤（workbench 第二步）
 * 复用 /api/orders/[token]/upload + /api/orders/[token]/upload-url 的 R2 预签流程。
 */

import { App, Card, Spin, Upload } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { Inbox } from "lucide-react";
import { useState } from "react";

interface UploadStepProps {
  orderToken: string;
  onUploaded: () => Promise<void> | void;
}

export function UploadStep({ orderToken, onUploaded }: UploadStepProps) {
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  /**
   * 单图上传：1) 拿 R2 预签 URL；2) PUT 到 R2；3) 调 /upload 触发生成。
   * 失败 / 取消都会通过 message 反馈给用户。
   */
  const handleUpload = async (file: File) => {
    setSubmitting(true);
    try {
      // 1. 拿预签 URL
      const presignRes = await fetch(`/api/orders/${orderToken}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      if (!presignRes.ok) {
        throw new Error("获取上传地址失败");
      }
      const presignJson = (await presignRes.json()) as {
        success?: boolean;
        data?: { publicUrl?: string; uploadUrl?: string };
        error?: string;
      };
      if (!presignJson.success || !presignJson.data?.publicUrl) {
        throw new Error(presignJson.error ?? "获取上传地址失败");
      }
      const { publicUrl, uploadUrl } = presignJson.data;
      if (!uploadUrl) {
        throw new Error("预签 URL 缺失");
      }

      // 2. PUT 到 R2
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error("上传到 R2 失败");
      }

      // 3. 通知后端开始生成
      const submitRes = await fetch(`/api/orders/${orderToken}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [{ publicUrl }],
        }),
      });
      if (!submitRes.ok) {
        throw new Error("提交生成失败");
      }
      const submitJson = (await submitRes.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!submitJson.success) {
        throw new Error(submitJson.error ?? "提交生成失败");
      }

      message.success("已上传，正在生成效果图");
      await onUploaded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "上传失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-medium mb-3">上传原图</h2>
      <p className="text-xs text-muted-foreground mb-4">
        请上传 1 张原图（JPG / PNG），系统将基于此图生成效果图。
      </p>
      <Upload.Dragger
        multiple={false}
        beforeUpload={(file) => {
          void handleUpload(file);
          return false; // 阻止 antd 默认上传，我们自己处理
        }}
        fileList={fileList}
        onChange={(info) => setFileList(info.fileList.slice(-1))}
        accept="image/*"
        disabled={submitting}
        showUploadList={false}
        className="!bg-violet-500/5"
      >
        <p className="ant-upload-drag-icon">
          <Inbox className="mx-auto h-10 w-10 text-violet-500" />
        </p>
        <p className="ant-upload-text text-sm">点击或拖拽图片到此处上传</p>
        <p className="ant-upload-hint text-xs text-muted-foreground">
          支持 JPG / PNG，单张
        </p>
      </Upload.Dragger>
      {submitting && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Spin size="small" />
          正在上传并触发生成…
        </div>
      )}
    </Card>
  );
}
