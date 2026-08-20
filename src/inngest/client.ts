import { Inngest } from "inngest";
import type { CanvasRemoteGenerateInput } from "@/features/canvas/services/canvas-server-generate";
import type { InternalGenerateInput } from "@/features/image-gen/lib/validation";

/**
 * Inngest 客户端配置
 *
 * 用于发送事件和定义后台函数
 * 支持 Vercel 的长时运行任务（突破 60 秒限制）
 *
 * 环境变量:
 * - INNGEST_EVENT_KEY: 生产/云端事件密钥
 * - INNGEST_SIGNING_KEY: 生产/云端签名密钥
 * - INNGEST_DEV: 开发模式 (1 | 0)
 */
export const inngest = new Inngest({
  id: "saas-template",
  // 开发模式下使用本地 Dev Server，生产使用事件密钥
  ...(process.env.INNGEST_EVENT_KEY && {
    eventKey: process.env.INNGEST_EVENT_KEY,
  }),
});

/**
 * 事件类型定义
 * 确保类型安全的事件发送
 */
export type Events = {
  /** 示例事件：Hello World */
  "app/hello-world": {
    data: {
      message: string;
    };
  };
  /**
   * gpt-image 提交生图任务
   *
   * 由 /api/orders/[token]/upload 与 /regenerate 触发，把 R2 URL 列表
   * 落库后立即 send 返回 202，后台 Inngest 函数再去调 Lingting
   * `submitGeneration`。这样 /upload 路由不再被 Lingting 的 120s R2
   * 下载 + 120s Lingting POST 阻塞，maxDuration 也不用顶到 300s。
   *
   * retries: 0 因为 Lingting 不支持幂等键，重复提交会重复扣配额。
   */
  "gpt-image/submit-generation": {
    data: {
      orderId: string;
      fromIdx: number;
      total: number;
      candidateCount: number;
    };
  };
  /**
   * image-gen 工作台提交生图任务
   *
   * 由 generateImageAction Server Action 在 createImageJob（落 imageJob
   * 行为 pending）后立即 send。前端拿到 jobId 就走，不再被 dispatchGenerateImage
   * 同步阻塞 —— 这是 /p/[token] 异步 submit 模式在工作台的镜像。
   *
   * payload 必须带原始 input（不只是 jobId），因为 imageJob 行没存
   * enableSafetyCheck / watermark 等字段，重建 GenerateImageRequest 会丢信息。
   * retries: 0 与 gpt-image 一致 —— Lingting 等上游没有幂等键，重复提交
   * 会重复扣配额。
   */
  "image-gen/submit-job": {
    data: {
      jobId: string;
      input: InternalGenerateInput;
    };
  };
  /**
   * 画布内置渠道提交生成任务（image / audio）
   *
   * 由 /api/canvas/generate 在写 canvasRemoteJob（status=pending）后立即 send。
   * 前端拿到 jobId 后轮询 GET /api/canvas/poll/{jobId}；Inngest 函数在后台
   * 跑 generateOnServerSync（pre-consume 积分 + 调上游 + R2 + 失败 refund），
   * 把 result 写回 canvasRemoteJob 行。
   *
   * payload 必须带完整 CanvasRemoteGenerateInput（含 references/mask data URL），
   * 因为 canvasRemoteJob.payload 是 json 序列化后的快照 —— Inngest 函数
   * 直接拿这个调 service，无需再回前端取。
   *
   * retries: 0 与既有约定一致 —— 上游（OpenAI / Lingting）无幂等键，
   * 重复提交会重复扣积分 / 重复消耗配额。
   */
  "canvas/remote-generate": {
    data: {
      jobId: string;
      userId: string;
      payload: CanvasRemoteGenerateInput;
    };
  };
};
