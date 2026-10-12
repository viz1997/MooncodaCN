import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// 加载测试环境变量
config({ path: ".env.test" });

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/test/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
    // 集成测试需要更长的超时时间
    testTimeout: 30000,
    hookTimeout: 30000,
    // 顺序执行测试，避免数据库竞争
    sequence: {
      concurrent: false,
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/features/**/*.ts",
        "src/lib/**/*.ts",
        "src/config/**/*.ts",
      ],
      exclude: [
        "node_modules/",
        ".next/",
        "**/*.config.*",
        "**/*.d.ts",
        "**/components/**",
      ],
    },
    // 2026-10-12：纯单元测试项目 —— 无 DB 依赖（adapter / parser / helper）。
    // 通过 `pnpm test:run --project=unit` 单独运行；默认 `test` 仍走 DB 路径。
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/test/**/pure/**/*.{test,spec}.{ts,tsx}"],
          setupFiles: [],
          sequence: { concurrent: false },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
