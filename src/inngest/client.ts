import { Inngest } from "inngest";

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
};
