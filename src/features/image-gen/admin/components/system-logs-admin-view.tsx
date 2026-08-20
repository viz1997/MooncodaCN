"use client";

/**
 * 系统日志 - Admin 视图
 *
 * 仿 mooncada-source/modules/platform.tsx SysLogsModule 设计：
 * - 4 张级别统计卡（Debug / Info / Warn / Error）
 * - 搜索 + 级别 + 类型筛选
 * - 日志列表（图标 + 级别 + 类型 + ID + 时间 + 用户/IP/details）
 *
 * 数据使用前端 mock（MOCK_SYS_LOGS），后续接入 Pino/Axiom 日志流
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）
 * - shadcn Card 系列 → 内联 div
 * - shadcn Badge/Select → antd
 */

import { Badge, Select } from "antd";
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  Info,
  ScrollText,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  LOG_LEVEL_CONFIG,
  LOG_TYPE_LABELS,
  type LogLevel,
  type LogType,
  MOCK_SYS_LOGS,
  type MockSysLog,
} from "@/features/image-gen/lib/sys-logs-mock";
import {
  EmptyState,
  formatDate,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { cn } from "@/lib/utils";

const LEVEL_ICON: Record<LogLevel, typeof Info> = {
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const LEVEL_BORDER: Record<LogLevel, string> = {
  debug: "border-zinc-500/20",
  info: "border-sky-500/20",
  warn: "border-amber-500/20",
  error: "border-rose-500/20",
};

export function SystemLogsAdminView() {
  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const filtered = useMemo(() => {
    return MOCK_SYS_LOGS.filter((l) => {
      const matchSearch =
        l.message.toLowerCase().includes(search.toLowerCase()) ||
        (l.userId?.toLowerCase().includes(search.toLowerCase()) ?? false);
      const matchLevel = filterLevel === "all" || l.level === filterLevel;
      const matchType = filterType === "all" || l.logType === filterType;
      return matchSearch && matchLevel && matchType;
    });
  }, [search, filterLevel, filterType]);

  // 级别统计
  const counts = useMemo(() => {
    const result: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    for (const l of MOCK_SYS_LOGS) result[l.level] += 1;
    return result;
  }, []);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="系统日志"
        description="查看系统运行日志 · 认证、业务、API、系统事件 · 支持级别与类型筛选"
      />

      {/* 过滤器 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索日志内容或用户ID..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        <Select
          value={filterLevel}
          onChange={setFilterLevel}
          className="w-full sm:w-32"
          options={[
            { value: "all", label: "全部级别" },
            { value: "debug", label: "Debug" },
            { value: "info", label: "Info" },
            { value: "warn", label: "Warn" },
            { value: "error", label: "Error" },
          ]}
        />
        <Select
          value={filterType}
          onChange={setFilterType}
          className="w-full sm:w-32"
          options={[
            { value: "all", label: "全部类型" },
            { value: "auth", label: "认证" },
            { value: "business", label: "业务" },
            { value: "system", label: "系统" },
            { value: "api", label: "API" },
          ]}
        />
      </div>

      {/* 日志级别统计 */}
      <div className="grid grid-cols-4 gap-2">
        {(["debug", "info", "warn", "error"] as LogLevel[]).map((lv) => {
          const config = LOG_LEVEL_CONFIG[lv];
          const Icon = LEVEL_ICON[lv];
          const count = counts[lv];
          return (
            <div
              key={lv}
              className="rounded-lg border bg-card text-card-foreground shadow-sm p-3"
            >
              <div className="flex items-center justify-between">
                <Icon className={cn("h-4 w-4", config.color)} />
                <span className="text-lg font-bold">{count}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase">
                {lv}
              </p>
            </div>
          );
        })}
      </div>

      {/* 日志列表 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <EmptyState
              icon={ScrollText}
              title="暂无日志"
              description="没有匹配的日志记录"
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-0">
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {filtered.map((log: MockSysLog) => {
                const config = LOG_LEVEL_CONFIG[log.level];
                const Icon = LEVEL_ICON[log.level];
                return (
                  <div
                    key={log.logId}
                    className={cn(
                      "p-3 hover:bg-muted/50 transition-colors",
                      "border-l-4",
                      LEVEL_BORDER[log.level]
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "rounded-lg p-1.5 shrink-0",
                          config.color
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span
                            className={cn(
                              "text-[10px] font-semibold uppercase",
                              config.color.split(" ")[0]
                            )}
                          >
                            {log.level}
                          </span>
                          <Badge color="default" className="!text-[10px]">
                            {LOG_TYPE_LABELS[log.logType as LogType]}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {log.logId}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {formatDate(log.createdAt, true)}
                          </span>
                        </div>
                        <p className="text-sm">{log.message}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                          {log.userId && (
                            <span>
                              用户:{" "}
                              <span className="font-mono">{log.userId}</span>
                            </span>
                          )}
                          <span>
                            IP: <span className="font-mono">{log.ip}</span>
                          </span>
                          {log.details && (
                            <span className="font-mono">
                              {Object.entries(log.details)
                                .map(([k, v]) => `${k}=${String(v)}`)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
