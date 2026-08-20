"use client";

/**
 * 产品效果 Admin 网格视图
 *
 * 对齐 mooncada-source product-effects.tsx：
 * - 顶部统计卡片（总数 / 上架 / 累计调用 / 平均成功率）
 * - 网格布局（grid-cols-1 sm:2 md:3 lg:4），每张卡片：
 *   - 方形预览图（点击打开预览）
 *   - 左上分类、右上状态徽标
 *   - 名称、描述、场景+模型、变量标签、产品线
 *   - 底部统计与 maskId，操作按钮（预览 / 编辑 / 切换上架 / 删除）
 * - 编辑/新建用 EditEffectDialog 弹窗（不再跳独立路由）
 * - 分类筛选换 Radix Select
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）
 * - shadcn Card → 内联 div
 * - shadcn Badge/Button/Dialog/Select → antd
 * - sonner toast → antd App.useApp().message
 */

import { App, Badge, Button, Modal, Select } from "antd";
import {
  CheckCircle2,
  Edit,
  Eye,
  Layers,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";

import {
  deleteProductEffectAdminAction,
  updateProductEffectAdminAction,
} from "@/features/image-gen/admin/actions";
import { EditEffectDialog } from "@/features/image-gen/admin/components/edit-effect-dialog";
import { PreviewEffectDialog } from "@/features/image-gen/admin/components/preview-effect-dialog";
import {
  PROMPT_SCENE_COLORS,
  PROMPT_SCENE_LABELS,
  type ProductEffect,
} from "@/features/image-gen/lib/product-effect-types";
import { MOCK_PRODUCT_LINES } from "@/features/image-gen/lib/product-lines-mock";
import { cn } from "@/lib/utils";

interface ProductEffectsAdminViewProps {
  effects: ProductEffect[];
}

export function ProductEffectsAdminView({
  effects: initialEffects,
}: ProductEffectsAdminViewProps) {
  const { message } = App.useApp();
  const [effects, setEffects] = useState<ProductEffect[]>(initialEffects);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [deletingEffect, setDeletingEffect] = useState<ProductEffect | null>(
    null
  );
  const [previewEffect, setPreviewEffect] = useState<ProductEffect | null>(
    null
  );
  const [editingEffect, setEditingEffect] = useState<ProductEffect | null>(
    null
  );
  const [createOpen, setCreateOpen] = useState(false);

  const { execute: deleteEffect, isPending: isDeleting } = useAction(
    deleteProductEffectAdminAction,
    {
      onSuccess: ({ input }) => {
        setEffects((prev) => prev.filter((e) => e.maskId !== input.maskId));
        setDeletingEffect(null);
        message.success("删除成功");
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "删除失败");
      },
    }
  );

  const { execute: toggleStatus, isPending: isToggling } = useAction(
    updateProductEffectAdminAction,
    {
      onSuccess: ({ input }) => {
        const next = input.updates.status;
        setEffects((prev) =>
          prev.map((e) =>
            e.maskId === input.maskId
              ? {
                  ...e,
                  status: next ?? e.status,
                  updatedAt: new Date().toISOString(),
                }
              : e
          )
        );
        message.success(next === "active" ? "已上架" : "已下架");
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "状态更新失败");
      },
    }
  );

  const handleToggleStatus = (effect: ProductEffect) => {
    const next = effect.status === "active" ? "inactive" : "active";
    toggleStatus({ maskId: effect.maskId, updates: { status: next } });
  };

  const categories = useMemo(
    () => Array.from(new Set(effects.map((e) => e.category))),
    [effects]
  );

  const filtered = effects.filter((e) => {
    const matchSearch =
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.maskId.toLowerCase().includes(search.toLowerCase());
    const matchCategory =
      filterCategory === "all" || e.category === filterCategory;
    return matchSearch && matchCategory;
  });

  // 统计卡片数据
  const stats = useMemo(() => {
    const total = effects.length;
    const active = effects.filter((e) => e.status === "active").length;
    const totalUsage = effects.reduce((s, e) => s + e.usageCount, 0);
    const eligible = effects.filter((e) => e.successRate > 0);
    const avgSuccess =
      eligible.length === 0
        ? 0
        : Math.round(
            eligible.reduce((s, e) => s + e.successRate, 0) / eligible.length
          );
    return { total, active, totalUsage, avgSuccess };
  }, [effects]);

  return (
    <div className="space-y-6">
      {/* 顶部：标题 + 搜索 + 分类筛选 + 新建 */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5 text-violet-600" />
            产品效果管理
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            管理 AI 效果模板 · 提示词 · 变量 · 版本历史 · 产品线关联
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称或ID..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <Select
            value={filterCategory}
            onChange={setFilterCategory}
            className="w-full sm:w-40"
            placeholder="分类"
            options={[
              { value: "all", label: "全部分类" },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
          />
          <Button
            type="primary"
            onClick={() => setCreateOpen(true)}
            className="bg-gradient-to-r from-teal-500 to-emerald-600 border-0"
            icon={<Plus className="h-4 w-4" />}
          >
            新增效果
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">效果总数</p>
              <p className="text-xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-lg bg-violet-500/10 p-2">
              <Layers className="h-4 w-4 text-violet-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">上架中</p>
              <p className="text-xl font-bold text-emerald-600">
                {stats.active}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">累计调用</p>
              <p className="text-xl font-bold">
                {stats.totalUsage.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="rounded-lg bg-sky-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-sky-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">平均成功率</p>
              <p className="text-xl font-bold text-amber-600">
                {stats.avgSuccess}%
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-amber-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 模板网格 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="py-12">
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
              <Layers className="h-10 w-10 mb-3" />
              <p className="font-medium">暂无效果模板</p>
              <p className="text-sm">点击右上角新增效果模板</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((effect) => (
            <div
              key={effect.maskId}
              className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden hover:shadow-md transition-all"
            >
              <button
                type="button"
                className="aspect-square bg-muted relative cursor-pointer group w-full block"
                onClick={() => setPreviewEffect(effect)}
              >
                {effect.previewUrl ? (
                  // biome-ignore lint/performance/noImgElement: 远程预览图（picsum.photos），不宜走 next/image
                  <img
                    src={effect.previewUrl}
                    alt={effect.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Layers className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
                <div className="absolute top-2 left-2 flex gap-1">
                  <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold bg-black/60 text-white border-0">
                    {effect.category}
                  </span>
                </div>
                <div className="absolute top-2 right-2">
                  <Badge
                    color={effect.status === "active" ? "green" : "default"}
                    className="!text-[10px]"
                  >
                    {effect.status === "active" ? "上架" : "下架"}
                  </Badge>
                </div>
              </button>
              <div className="p-3 space-y-2">
                <p className="text-sm font-medium truncate">{effect.name}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-2 h-7">
                  {effect.description}
                </p>

                {/* 场景 + 模型 */}
                <div className="flex items-center gap-1 flex-wrap">
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-1 py-0 text-[9px] font-medium",
                      PROMPT_SCENE_COLORS[effect.scene]
                    )}
                  >
                    {PROMPT_SCENE_LABELS[effect.scene]}
                  </span>
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {effect.model || "未指定"}
                  </span>
                </div>

                {/* 变量标签 */}
                {effect.variables.length > 0 ? (
                  <div className="flex flex-wrap gap-0.5">
                    {effect.variables.slice(0, 4).map((v) => (
                      <span
                        key={v.key}
                        className="inline-flex items-center text-[9px] font-mono text-violet-700 dark:text-violet-400 bg-violet-500/10 px-1 py-0.5 rounded"
                      >
                        {`{{${v.key}}}`}
                      </span>
                    ))}
                    {effect.variables.length > 4 ? (
                      <span className="text-[9px] text-muted-foreground">
                        +{effect.variables.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* 关联产品线 */}
                {effect.productLineIds && effect.productLineIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {effect.productLineIds.map((plId) => {
                      const pl = MOCK_PRODUCT_LINES.find(
                        (p) => p.productLineId === plId
                      );
                      if (!pl) {
                        return (
                          <span
                            key={plId}
                            className="inline-flex items-center gap-0.5 text-[9px] bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 px-1.5 py-0.5 rounded font-mono"
                          >
                            {plId}
                          </span>
                        );
                      }
                      return (
                        <span
                          key={plId}
                          className="inline-flex items-center gap-0.5 text-[9px] bg-violet-500/10 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded"
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                          {pl.name}
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> 使用 {effect.usageCount}
                  </span>
                  <span className="font-mono">{effect.maskId}</span>
                </div>

                <div className="flex gap-1.5 pt-1">
                  <Button
                    size="small"
                    onClick={() => setPreviewEffect(effect)}
                    className="flex-1"
                    icon={<Eye className="h-3 w-3" />}
                  >
                    预览
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => setEditingEffect(effect)}
                    aria-label="编辑"
                    icon={<Edit className="h-3.5 w-3.5" />}
                  />
                  <Button
                    size="small"
                    type="text"
                    className={cn(
                      effect.status === "active"
                        ? "!text-emerald-600"
                        : "!text-muted-foreground"
                    )}
                    onClick={() => handleToggleStatus(effect)}
                    disabled={isToggling}
                    loading={isToggling}
                    aria-label={effect.status === "active" ? "下架" : "上架"}
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    onClick={() => setDeletingEffect(effect)}
                    aria-label="删除"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 删除确认 */}
      <Modal
        open={!!deletingEffect}
        onCancel={() => !isDeleting && setDeletingEffect(null)}
        title={
          <span className="flex items-center gap-2 text-rose-600">
            <Trash2 className="h-4 w-4" />
            确认删除产品效果
          </span>
        }
        footer={[
          <Button
            key="cancel"
            onClick={() => setDeletingEffect(null)}
            disabled={isDeleting}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            danger
            loading={isDeleting}
            onClick={() => {
              if (deletingEffect) {
                deleteEffect({ maskId: deletingEffect.maskId });
              }
            }}
          >
            {isDeleting ? "删除中..." : "确认删除"}
          </Button>,
        ]}
      >
        <p className="text-sm py-2">
          确定要删除{" "}
          <span className="font-semibold">{deletingEffect?.name}</span> (
          {deletingEffect?.maskId}) 吗？此操作不可撤销。
        </p>
      </Modal>

      {/* 预览对话框 */}
      <PreviewEffectDialog
        effect={previewEffect}
        open={!!previewEffect}
        onOpenChange={(open) => !open && setPreviewEffect(null)}
      />

      {/* 编辑对话框 */}
      <EditEffectDialog
        open={!!editingEffect}
        onOpenChange={(open) => !open && setEditingEffect(null)}
        effect={editingEffect}
      />

      {/* 新建对话框 */}
      <EditEffectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
