// 系统日志 mock 数据
// 仿 mooncada-source MOCK_SYS_LOGS
// 前端 mock 演示，后端接入留后续阶段

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogType = "auth" | "business" | "system" | "api";

export interface MockSysLog {
  logId: string;
  level: LogLevel;
  logType: LogType;
  message: string;
  userId?: string;
  ip: string;
  details?: Record<string, string | number | boolean>;
  createdAt: string;
}

export const MOCK_SYS_LOGS: MockSysLog[] = [
  {
    logId: "log_2026_0727_001",
    level: "info",
    logType: "auth",
    message: "用户登录成功",
    userId: "user_001",
    ip: "192.168.1.10",
    details: { method: "email" },
    createdAt: "2026-07-27T08:30:15.000Z",
  },
  {
    logId: "log_2026_0727_002",
    level: "warn",
    logType: "auth",
    message: "登录失败次数过多，临时锁定",
    userId: "user_002",
    ip: "10.0.0.45",
    details: { attempts: 5, lockMinutes: 30 },
    createdAt: "2026-07-27T08:45:22.000Z",
  },
  {
    logId: "log_2026_0727_003",
    level: "info",
    logType: "business",
    message: "产品效果 MASK_301 生成成功",
    userId: "user_001",
    ip: "192.168.1.10",
    details: { maskId: "MASK_301", model: "doubao", duration: 4500 },
    createdAt: "2026-07-27T09:02:11.000Z",
  },
  {
    logId: "log_2026_0727_004",
    level: "error",
    logType: "api",
    message: "Upstash 限流触发",
    ip: "203.0.113.7",
    details: { route: "/api/public/generate", limit: 10 },
    createdAt: "2026-07-27T09:15:33.000Z",
  },
  {
    logId: "log_2026_0727_005",
    level: "info",
    logType: "system",
    message: "定时任务 credits.expire 执行完成",
    ip: "internal",
    details: { expired: 12, batched: 3 },
    createdAt: "2026-07-27T10:00:00.000Z",
  },
  {
    logId: "log_2026_0727_006",
    level: "debug",
    logType: "api",
    message: "Cache HIT /api/public/generate",
    ip: "192.168.1.10",
    details: { cacheKey: "masks:active", ttl: 300 },
    createdAt: "2026-07-27T10:08:42.000Z",
  },
  {
    logId: "log_2026_0727_007",
    level: "error",
    logType: "business",
    message: "生图任务失败：上游模型超时",
    userId: "user_003",
    ip: "172.16.0.8",
    details: { maskId: "MASK_293", model: "midjourney", error: "timeout" },
    createdAt: "2026-07-27T10:20:01.000Z",
  },
  {
    logId: "log_2026_0727_008",
    level: "warn",
    logType: "system",
    message: "数据库连接池使用率超过 80%",
    ip: "internal",
    details: { poolSize: 20, active: 17 },
    createdAt: "2026-07-27T10:32:18.000Z",
  },
  {
    logId: "log_2026_0727_009",
    level: "info",
    logType: "business",
    message: "积分批量发放：月度订阅赠送",
    userId: "user_001",
    ip: "192.168.1.10",
    details: { plan: "Pro", credits: 500 },
    createdAt: "2026-07-27T11:00:00.000Z",
  },
  {
    logId: "log_2026_0727_010",
    level: "info",
    logType: "auth",
    message: "管理员登录成功",
    userId: "admin_001",
    ip: "192.168.1.5",
    details: { method: "oauth_google" },
    createdAt: "2026-07-27T11:15:00.000Z",
  },
];

export const LOG_LEVEL_CONFIG: Record<
  LogLevel,
  { color: string; label: string }
> = {
  debug: { color: "text-zinc-500 bg-zinc-500/10", label: "Debug" },
  info: { color: "text-sky-600 bg-sky-500/10", label: "Info" },
  warn: { color: "text-amber-600 bg-amber-500/10", label: "Warn" },
  error: { color: "text-rose-600 bg-rose-500/10", label: "Error" },
};

export const LOG_TYPE_LABELS: Record<LogType, string> = {
  auth: "认证",
  business: "业务",
  system: "系统",
  api: "API",
};
