"use client";

/**
 * 模型文件上传 —— 打包成 ZIP 直传 R2
 *
 * ## 为什么单独一个文件
 *
 * 两条路都要用它:
 *
 * - 打印前工作台 `/tools/workbench`:点「加入打印单」时上传(2026-11-06 起)
 * - 商城购物车里的打印服务行:落购物车时上传(界面上没有入口,但 API 那条路
 *   还在)
 *
 * 之前这段逻辑只写在 `quote-workbench.tsx` 里,第二个地方要用就得复制一份 ——
 * 两份打包逻辑迟早会漂移(比如「按缩放重新打包」这条改了只改了一处,工作室
 * 拿到的文件尺寸就跟报价单对不上)。
 *
 * ## 打包时按用户调过的尺寸重新缩放
 *
 * 否则工作室拿到的文件尺寸和报价单上的对不上。**不旋转**:报价单上的尺寸是
 * 未旋转的包围盒,旋转后包围盒会变,两边对不上;摆盘角度是给工作室的参考,
 * 不是硬约束。
 */

import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import {
  buildModelZipBlob,
  exportRotatedObj,
} from "@/features/pricing/lib/obj-exporter";

/** 上传结果 */
export type UploadedModelFile = {
  /** R2 上的永久 URL(工作室按它取件) */
  url: string;
  /** R2 对象键 —— 归属校验按它算 */
  objectKey: string;
  /** 字节数 */
  size: number;
  /** 文件名(打包出来的 zip 名) */
  fileName: string;
};

/**
 * 把模型打包成 ZIP 直传到 R2
 *
 * 三步:① 打包成 zip ② 问服务端要预签名 URL ③ raw PUT 到 R2。
 * 服务端不碰字节 —— Vercel 的请求体上限 4.5MB,3D 模型轻松超。
 */
export async function uploadModelFile(
  payload: PricingModelPayload
): Promise<UploadedModelFile> {
  const { model, scales } = payload;

  const objText = exportRotatedObj(
    model.objText,
    { rotX: 0, rotY: 0, rotZ: 0 },
    { scaleX: scales[0], scaleY: scales[1], scaleZ: scales[2] }
  );

  const blob = await buildModelZipBlob(
    objText,
    model.mtlText,
    model.textureBlobs,
    model.objFileName,
    model.mtlFileName
  );

  const fileName = `${model.name || "model"}.zip`;

  const presignRes = await fetch("/api/print-orders/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, size: blob.size }),
  });
  if (!presignRes.ok) {
    const body = (await presignRes.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "presign failed");
  }

  const presign = (await presignRes.json()) as {
    uploadUrl: string;
    publicUrl: string;
    objectKey: string;
    headers: Record<string, string>;
  };

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers,
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`R2 PUT failed: ${putRes.status}`);
  }

  return {
    url: presign.publicUrl,
    objectKey: presign.objectKey,
    size: blob.size,
    fileName,
  };
}
