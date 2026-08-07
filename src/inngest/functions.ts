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
 * 导出所有 Inngest 函数
 * 在 src/app/api/inngest/route.ts 中注册
 *
 * 注：原 generatePromptOrder 已移除 —— 生图改为 submit/poll 两段式
 * （服务端只提交，前端调 /api/orders/[token]/poll 驱动轮询），
 * 不再需要长时 worker，因此也不再依赖 Inngest。
 */
export const functions = [helloWorld];
