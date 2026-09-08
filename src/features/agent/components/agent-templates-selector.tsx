"use client";

/**
 * 2026-09-07：代理商可服务模板选择器（M2M 编辑）。
 *
 * - 列出全部 active promptTemplates
 * - 多选 Checkbox.Group
 * - 与服务端 agent_prompt_template 表对齐（已选=有行，未选=无行）
 *
 * 使用方：AgentFormDialog（edit mode）底部。
 */

import { App, Button, Checkbox, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  listAgentTemplatesAction,
  setAgentPromptTemplatesAdminAction,
} from "@/features/agent/actions/agents";
import { listTemplatesAction } from "@/features/gpt-image/actions/orders";
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";

interface AgentTemplatesSelectorProps {
  agentId: string;
  /** 表单保存后是否刷新 list（默认 true） */
  onSaved?: () => void;
}

type SimpleTemplate = Pick<
  PromptTemplateView,
  "id" | "name" | "description" | "productTypeCode" | "price"
>;

export function AgentTemplatesSelector({
  agentId,
  onSaved,
}: AgentTemplatesSelectorProps) {
  const { message } = App.useApp();
  const [allTemplates, setAllTemplates] = useState<SimpleTemplate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initialIds, setInitialIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allRes, currentRes] = await Promise.all([
        listTemplatesAction({}),
        listAgentTemplatesAction({ agentId }),
      ]);
      if (allRes?.data?.templates) {
        // 只展示 active 的（listTemplatesAction 已经过滤）
        setAllTemplates(
          allRes.data.templates
            .filter((t: PromptTemplateView) => t.isActive)
            .map((t: PromptTemplateView) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              productTypeCode: t.productTypeCode ?? null,
              price: t.price ?? 0,
            }))
        );
      }
      if (currentRes?.data?.templateIds) {
        const set = new Set(currentRes.data.templateIds);
        setSelectedIds(set);
        setInitialIds(new Set(set));
      }
    } catch (e) {
      console.error("[AgentTemplatesSelector] load failed", e);
      message.error("加载模板失败");
    } finally {
      setLoading(false);
    }
  }, [agentId, message]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const dirty = useMemo(() => {
    if (selectedIds.size !== initialIds.size) return true;
    for (const id of selectedIds) {
      if (!initialIds.has(id)) return true;
    }
    return false;
  }, [selectedIds, initialIds]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await setAgentPromptTemplatesAdminAction({
        agentId,
        templateIds: Array.from(selectedIds),
      });
      if (res?.data) {
        message.success(`已更新授权：${res.data.count} 个模板`);
        setInitialIds(new Set(selectedIds));
        onSaved?.();
      } else if (res?.serverError) {
        message.error(res.serverError);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败";
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spin />
      </div>
    );
  }

  if (allTemplates.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
        暂无可分配的提示词模板。请先在「模板管理」创建并启用模板。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 p-3 max-h-[280px] overflow-y-auto">
        <Checkbox.Group
          className="!w-full"
          value={Array.from(selectedIds)}
          onChange={(vals) => setSelectedIds(new Set(vals as string[]))}
        >
          <div className="grid grid-cols-1 gap-2">
            {allTemplates.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 rounded-md border bg-card px-3 py-2"
              >
                <Checkbox value={t.id} className="!mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    {t.productTypeCode && (
                      <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700">
                        {t.productTypeCode}
                      </span>
                    )}
                    {(t.price ?? 0) > 0 && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700">
                        ¥{t.price}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                      {t.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Checkbox.Group>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          已选 {selectedIds.size} / {allTemplates.length} 个模板
        </span>
        <Button
          type="primary"
          size="small"
          disabled={!dirty}
          loading={saving}
          onClick={handleSave}
        >
          保存授权
        </Button>
      </div>
    </div>
  );
}
