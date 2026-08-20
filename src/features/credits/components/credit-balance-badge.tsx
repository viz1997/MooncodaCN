"use client";

/**
 * 积分余额徽章组件
 *
 * 显示在侧边栏中，展示用户当前可用积分
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.3）
 * - shadcn Badge 切到 antd Badge（color 替代 variant）
 */

import { Badge } from "antd";
import { Coins } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";

import { getMyCreditsBalance } from "@/features/credits/actions";

/**
 * 积分余额徽章
 *
 * 特性:
 * - 自动获取用户积分余额
 * - 显示为闪电图标 + 数字格式
 * - 支持 Tooltip 显示详情
 */
export function CreditBalanceBadge() {
  const { execute, result, isPending } = useAction(getMyCreditsBalance);

  // 组件挂载时获取余额
  useEffect(() => {
    execute();
  }, [execute]);

  const balance = result.data?.balance ?? 0;

  // 加载状态
  if (isPending) {
    return (
      <Badge
        color="default"
        title="Available Credits"
        className="!gap-1 !px-2 !py-1"
      >
        <Coins className="h-3 w-3" />
        <span className="text-xs">...</span>
      </Badge>
    );
  }

  return (
    <Badge
      color="gold"
      title="Available Credits"
      className="!gap-1 !px-2 !py-1"
    >
      <Coins className="h-3 w-3" />
      <span className="text-xs font-medium">{balance.toLocaleString()}</span>
    </Badge>
  );
}
