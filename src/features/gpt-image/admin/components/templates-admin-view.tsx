"use client";

/**
 * 2026-08-20：shadcn → antd 迁移（Phase 3.4）
 * - shadcn AlertDialog/Card/Switch/Badge/Button → antd
 * - sonner toast → antd App.useApp().message
 * - AlertDialog → antd Modal with footer array
 * - Card → 内联 div
 * - Switch → antd Switch
 */

import { App, Badge, Button, Modal, Switch } from "antd";
import { Eye, EyeOff, FileImage, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  deleteTemplateAction,
  toggleTemplateActiveAction,
} from "@/features/gpt-image/actions/templates";
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";

import { TemplateFormDialog } from "./template-form-dialog";

export function TemplatesAdminView() {
  const { message } = App.useApp();
  const [templates, setTemplates] = useState<PromptTemplateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PromptTemplateView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplateView | null>(
    null
  );
  const [showPrompt, setShowPrompt] = useState<Record<string, boolean>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/templates");
      const json = await res.json();
      if (json.success) setTemplates(json.data as PromptTemplateView[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const handleEdit = (tpl: PromptTemplateView) => {
    setEditing(tpl);
    setDialogOpen(true);
  };

  const handleToggleActive = async (tpl: PromptTemplateView) => {
    if (togglingId === tpl.id) return;
    setTogglingId(tpl.id);
    try {
      const res = await toggleTemplateActiveAction({
        id: tpl.id,
        isActive: !tpl.isActive,
      });
      if (!res?.data) throw new Error("更新失败");
      message.success(tpl.isActive ? "已禁用" : "已启用");
      await fetchTemplates();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTemplateAction({ id: deleteTarget.id });
      message.success("模板已删除");
      setDeleteTarget(null);
      await fetchTemplates();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const togglePrompt = (id: string) => {
    setShowPrompt((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">提示词模板</h2>
          <p className="text-sm text-muted-foreground">
            管理生图模板。每个模板的提示词对用户不可见。
          </p>
        </div>
        <Button
          type="primary"
          onClick={handleCreate}
          icon={<Plus className="h-4 w-4" />}
        >
          新建模板
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-lg border bg-card text-card-foreground shadow-sm animate-pulse h-32"
            />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileImage className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="mb-3 text-sm text-muted-foreground">
              还没有模板。创建第一个模板来开始生图服务。
            </p>
            <Button
              type="primary"
              onClick={handleCreate}
              icon={<Plus className="h-4 w-4" />}
            >
              创建模板
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((tpl) => {
            const promptVisible = showPrompt[tpl.id];
            return (
              <div
                key={tpl.id}
                className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden"
              >
                <div className="pb-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="flex items-center gap-2 text-base font-semibold">
                        <span className="truncate">{tpl.name}</span>
                        {!tpl.isActive && (
                          <Badge color="default" className="!text-xs">
                            已禁用
                          </Badge>
                        )}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {tpl.description}
                      </p>
                    </div>
                    {tpl.coverUrl && (
                      /* biome-ignore lint/performance/noImgElement: 远程 coverUrl */
                      <img
                        src={tpl.coverUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-md object-cover"
                      />
                    )}
                  </div>
                </div>
                <div className="space-y-3 p-4 pt-0">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge color="default" className="!text-xs">
                      {tpl.size}
                    </Badge>
                    <Badge color="default" className="!text-xs">
                      {tpl.candidateCount} 宫格
                    </Badge>
                    <Badge color="default" className="!text-xs">
                      {tpl.orderCount ?? 0} 个订单
                    </Badge>
                  </div>

                  <div className="rounded-md border bg-slate-50 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        提示词（仅管理端可见）
                      </span>
                      <Button
                        type="text"
                        size="small"
                        onClick={() => togglePrompt(tpl.id)}
                        icon={
                          promptVisible ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )
                        }
                        aria-label={promptVisible ? "隐藏提示词" : "显示提示词"}
                      />
                    </div>
                    <p
                      className={`font-mono text-xs break-all text-slate-700 ${
                        promptVisible ? "" : "blur-sm select-none"
                      }`}
                    >
                      {tpl.prompt}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={tpl.isActive}
                        onChange={() => handleToggleActive(tpl)}
                        loading={togglingId === tpl.id}
                      />
                      <span className="text-xs text-muted-foreground">
                        {tpl.isActive ? "启用" : "禁用"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="default"
                        size="small"
                        onClick={() => handleEdit(tpl)}
                        icon={<Pencil className="h-3.5 w-3.5" />}
                      >
                        编辑
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={() => setDeleteTarget(tpl)}
                        icon={<Trash2 className="h-4 w-4" />}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TemplateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editing}
        onSaved={fetchTemplates}
      />

      <Modal
        open={!!deleteTarget}
        onCancel={() => !deleting && setDeleteTarget(null)}
        title={
          <span className="flex items-center gap-2 text-rose-600">
            <Trash2 className="h-4 w-4" />
            确认删除模板？
          </span>
        }
        footer={[
          <Button
            key="cancel"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            danger
            onClick={handleDelete}
            loading={deleting}
          >
            删除
          </Button>,
        ]}
      >
        <p className="text-sm text-muted-foreground">
          将删除模板「{deleteTarget?.name}
          」。此操作不可撤销，关联的订单将不受影响但无法重新生图。
        </p>
      </Modal>
    </div>
  );
}
