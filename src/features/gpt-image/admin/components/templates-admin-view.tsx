"use client";

import { Eye, EyeOff, FileImage, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import {
  deleteTemplateAction,
  toggleTemplateActiveAction,
} from "@/features/gpt-image/actions/templates";
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";

import { TemplateFormDialog } from "./template-form-dialog";

export function TemplatesAdminView() {
  const [templates, setTemplates] = useState<PromptTemplateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PromptTemplateView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplateView | null>(
    null
  );
  const [showPrompt, setShowPrompt] = useState<Record<string, boolean>>({});

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
  }, []);

  const handleCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const handleEdit = (tpl: PromptTemplateView) => {
    setEditing(tpl);
    setDialogOpen(true);
  };

  const handleToggleActive = async (tpl: PromptTemplateView) => {
    try {
      const res = await toggleTemplateActiveAction({
        id: tpl.id,
        isActive: !tpl.isActive,
      });
      if (!res?.data) throw new Error("更新失败");
      toast.success(tpl.isActive ? "已禁用" : "已启用");
      await fetchTemplates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTemplateAction({ id: deleteTarget.id });
      toast.success("模板已删除");
      setDeleteTarget(null);
      await fetchTemplates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
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
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" /> 新建模板
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-32" />
            </Card>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileImage className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="mb-3 text-sm text-muted-foreground">
              还没有模板。创建第一个模板来开始生图服务。
            </p>
            <Button onClick={handleCreate}>
              <Plus className="mr-1 h-4 w-4" /> 创建模板
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((tpl) => {
            const promptVisible = showPrompt[tpl.id];
            return (
              <Card key={tpl.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="truncate">{tpl.name}</span>
                        {!tpl.isActive && (
                          <Badge variant="secondary" className="text-xs">
                            已禁用
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">
                        {tpl.description}
                      </CardDescription>
                    </div>
                    {tpl.coverUrl && (
                      <img
                        src={tpl.coverUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-md object-cover"
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">{tpl.size}</Badge>
                    <Badge variant="outline">{tpl.candidateCount} 宫格</Badge>
                    <Badge variant="outline">
                      {tpl.orderCount ?? 0} 个订单
                    </Badge>
                  </div>

                  <div className="rounded-md border bg-slate-50 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        提示词（仅管理端可见）
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => togglePrompt(tpl.id)}
                      >
                        {promptVisible ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>
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
                        onCheckedChange={() => handleToggleActive(tpl)}
                        id={`active-${tpl.id}`}
                      />
                      <span className="text-xs text-muted-foreground">
                        {tpl.isActive ? "启用" : "禁用"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(tpl)}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" /> 编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => setDeleteTarget(tpl)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除模板？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除模板「{deleteTarget?.name}
              」。此操作不可撤销，关联的订单将不受影响但无法重新生图。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
