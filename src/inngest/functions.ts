import { runGeneration } from "@/features/gpt-image/lib/generation-service";
import { logger } from "@/lib/logger";
import { inngest } from "./client";

/**
 * Hello World 示例函数
 *
 * 演示 Inngest 后台任务的基本用法：
 * 1. 前端通过 inngest.send() 发送事件
 * 2. Inngest 函数在后台异步执行
 * 3. 使用 step.run() 进行可靠的步骤执行（支持重试）
 */
export const helloWorld = inngest.createFunction(
  {
    id: "hello-world",
    retries: 3,
  },
  { event: "app/hello-world" },
  async ({ event, step }) => {
    const result = await step.run("process-message", async () => {
      logger.info({ message: event.data.message }, "处理 hello-world 事件");
      return { processed: true, message: event.data.message };
    });

    return result;
  }
);

/**
 * GPT-Image 公共订单效果图生成
 *
 * 解决 Vercel serverless 冻结问题：
 * - 原 triggerGeneration 用 `void runGeneration(...)` fire-and-forget，
 *   Vercel 返回 HTTP 响应后立即冻结 runtime，fetch 调用被中途杀掉，订单卡在 GENERATING。
 * - 改用 Inngest 后，runGeneration 在 Inngest worker 上跑完整个 90s 轮询周期。
 *
 * step.run 单步最长 60s；原 runGeneration 中每张原图的 Lingting 调用
 * 已经被 fetch + 90s 轮询打包，所以这里直接整段包成一个 step。
 * 如未来需要更细粒度重试，可拆为 "per-image" step。
 */
export const generatePromptOrder = inngest.createFunction(
  {
    id: "generate-prompt-order",
    retries: 2,
    // 单个 function 上限 2 小时足够；90s × 5 张 + 余量
    // Inngest 默认会等 step 完成再判断超时
  },
  { event: "prompt-order/generate.requested" },
  async ({ event, step }) => {
    const { orderId, fromIdx, total, candidateCount } = event.data;

    logger.info(
      { orderId, fromIdx, total, candidateCount },
      "Inngest 启动生图任务"
    );

    await step.run("run-generation", async () => {
      // step.run 不支持外部 AbortSignal；如需"停止生成"走 Inngest 的 cancelOn 事件
      await runGeneration(orderId, fromIdx, total, candidateCount);
    });

    return { orderId, status: "completed" as const };
  }
);

/**
 * 导出所有 Inngest 函数
 * 在 src/app/api/inngest/route.ts 中注册
 */
export const functions = [generatePromptOrder, helloWorld];
