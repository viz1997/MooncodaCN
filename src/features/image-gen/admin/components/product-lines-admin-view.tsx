"use client";

/**
 * 产品线管理 - Admin 视图（2026-09-10 重写）
 *
 * 数据源切换：mooncada-source ENRICHED 内联 mock → product_line 表（db-lines.ts）
 * 字段简化：
 * - 移除 production / totalSold / monthlySold / rating / tags / compatibleMaskIds
 *   （mock 字段，无业务意义，且 admin 后台不展示销量）
 * - spec / pricing 改读 ProductLineSpec / ProductLinePricing JSON 字段
 * - CRUD 接入 listProductLinesAdminAction + ProductLineFormDialog + deleteProductLineAdminAction
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）；规格/定价卡片从 ENRICHED 改 ProductLine.spec/pricing
 */

import { App, Badge, Button, Empty, Modal, Tabs } from "antd";
import {
  DollarSign,
  Edit,
  Eye,
  Package,
  Plus,
  Ruler,
  Search,
  Trash2,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";

import {
  deleteProductLineAdminAction,
  listProductLinesAdminAction,
} from "@/features/image-gen/admin/actions";
import { ProductLineFormDialog } from "@/features/image-gen/admin/components/product-line-form-dialog";
import type {
  ProductLine,
  ProductLinePricing,
  ProductLineSpec,
} from "@/features/image-gen/lib/product-effect-types";
import {
  EmptyState,
  formatCurrency,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { cn } from "@/lib/utils";

/**
 * 通用 category 标签表（不强制 enum，DB 端是 text）。
 * 几个常见类别给固定中文标签 + 配色；其他 fallback "其他"
 */
const CATEGORY_LABELS: Record<string, string> = {
  badge: "徽章",
  keychain: "钥匙扣",
  charm: "挂件",
  pendant: "挂件",
  "fridge-magnet": "冰箱贴",
  acrylic_stand: "亚克力立牌",
  leather_badge: "皮革徽章",
  other: "其他",
};

const CATEGORY_COLORS: Record<string, string> = {
  badge:
    "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  keychain:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  charm: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  pendant: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  "fridge-magnet":
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  acrylic_stand:
    "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  leather_badge:
    "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-500/20",
  other: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other ?? "";
}

/**
 * ProductLineDetailDialog - 产品线详情
 * 渲染从 DB 来的 spec/pricing JSON 字段（替代 ENRICHED 内联 mock）
 */
function ProductLineDetailDialog({
  productLine,
  open,
  onOpenChange,
}: {
  productLine: ProductLine | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!productLine) return null;

  const spec: ProductLineSpec = productLine.spec ?? {};
  const pricing = productLine.pricing as ProductLinePricing;
  const materialList = spec.material ?? [];
  const finishList = spec.finish ?? [];

  return (
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      title={
        <span className="flex items-center gap-2">
          <Package className="h-5 w-5 text-violet-600" />
          {productLine.name}
        </span>
      }
      footer={[
        <Button key="close" onClick={() => onOpenChange(false)}>
          关闭
        </Button>,
      ]}
      width={672}
    >
      <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mb-3">
        <span className="font-mono">{productLine.productLineId}</span>
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
            categoryColor(productLine.category)
          )}
        >
          {categoryLabel(productLine.category)}
        </span>
        <Badge
          color={
            productLine.status === "active"
              ? "green"
              : productLine.status === "draft"
                ? "default"
                : "default"
          }
          className="!text-[10px]"
        >
          {productLine.status === "active"
            ? "上架"
            : productLine.status === "draft"
              ? "草稿"
              : "下架"}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          排序 {productLine.sortOrder}
        </span>
      </p>

      {/* 描述 + 封面图 */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {productLine.coverUrl ? (
          <div className="aspect-square rounded-lg overflow-hidden bg-muted">
            {/* biome-ignore lint/performance/noImgElement: 外部预览图 */}
            <img
              src={productLine.coverUrl}
              alt={productLine.name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-square rounded-lg bg-muted flex items-center justify-center">
            <Package className="h-10 w-10 text-muted-foreground/40" />
          </div>
        )}
        <div className="col-span-2 space-y-2">
          {productLine.description && (
            <p className="text-sm">{productLine.description}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {materialList.map((m) => (
              <Badge key={m} color="default" className="!text-[10px]">
                {m}
              </Badge>
            ))}
            {finishList.map((f) => (
              <Badge key={f} color="purple" className="!text-[10px]">
                {f}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <Tabs
        defaultActiveKey="spec"
        items={[
          {
            key: "spec",
            label: (
              <span className="text-xs">
                <Ruler className="h-3 w-3 mr-1" />
                规格
              </span>
            ),
            children: (
              <div className="space-y-2">
                {spec.sizeRange ? (
                  <div className="bg-muted/30 rounded-lg p-3 text-xs">
                    <p className="text-muted-foreground text-[10px] mb-1">
                      尺寸区间
                    </p>
                    <p className="font-medium">
                      {spec.sizeRange.min} - {spec.sizeRange.max}{" "}
                      {spec.sizeRange.unit}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    未设置尺寸区间
                  </p>
                )}
                {materialList.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 text-xs">
                    <p className="text-muted-foreground text-[10px] mb-1">
                      材质
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {materialList.map((m) => (
                        <Badge key={m} color="default" className="!text-[10px]">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {finishList.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 text-xs">
                    <p className="text-muted-foreground text-[10px] mb-1">
                      工艺
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {finishList.map((f) => (
                        <Badge key={f} color="purple" className="!text-[10px]">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {!spec.sizeRange &&
                  materialList.length === 0 &&
                  finishList.length === 0 && (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无规格信息"
                    />
                  )}
              </div>
            ),
          },
          {
            key: "pricing",
            label: (
              <span className="text-xs">
                <DollarSign className="h-3 w-3 mr-1" />
                定价
              </span>
            ),
            children: (
              <div className="space-y-2">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-muted-foreground">基础价</p>
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                    {pricing.basePrice
                      ? formatCurrency(
                          pricing.basePrice,
                          pricing.currency ?? "CNY"
                        )
                      : "-"}
                  </p>
                </div>
                {pricing.sizeSurcharge && pricing.sizeSurcharge.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 text-xs">
                    <p className="text-muted-foreground text-[10px] mb-1">
                      阶梯加价
                    </p>
                    <div className="space-y-0.5">
                      {pricing.sizeSurcharge.map((s, i) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: 简单列表渲染
                          key={`size-${i}`}
                          className="flex justify-between"
                        >
                          <span>≥ {s.threshold} cm</span>
                          <span className="font-mono">
                            + {s.extra.toFixed(2)} {pricing.currency ?? "CNY"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {pricing.finishSurcharge &&
                  Object.keys(pricing.finishSurcharge).length > 0 && (
                    <div className="bg-muted/30 rounded-lg p-3 text-xs">
                      <p className="text-muted-foreground text-[10px] mb-1">
                        工艺加价
                      </p>
                      <div className="space-y-0.5">
                        {Object.entries(pricing.finishSurcharge).map(
                          ([finish, extra]) => (
                            <div key={finish} className="flex justify-between">
                              <span>{finish}</span>
                              <span className="font-mono">
                                + {Number(extra).toFixed(2)}{" "}
                                {pricing.currency ?? "CNY"}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}

export function ProductLinesAdminView() {
  const { message } = App.useApp();
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [previewLine, setPreviewLine] = useState<ProductLine | null>(null);
  const [editingLine, setEditingLine] = useState<ProductLine | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingLine, setDeletingLine] = useState<ProductLine | null>(null);

  // 加载产品线列表
  const reload = async () => {
    try {
      const res = await listProductLinesAdminAction();
      if (res?.data?.lines) {
        setLines(res.data.lines);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载产品线失败");
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { execute: deleteLine, isPending: isDeleting } = useAction(
    deleteProductLineAdminAction,
    {
      onSuccess: () => {
        setDeletingLine(null);
        message.success("删除成功");
        reload();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "删除失败");
      },
    }
  );

  const categories = useMemo(
    () => Array.from(new Set(lines.map((l) => l.category))),
    [lines]
  );

  const filtered = lines.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.productLineId.toLowerCase().includes(search.toLowerCase());
    const matchCategory =
      filterCategory === "all" || p.category === filterCategory;
    return matchSearch && matchCategory;
  });

  // 统计
  const stats = {
    total: lines.length,
    active: lines.filter((p) => p.status === "active").length,
    draft: lines.filter((p) => p.status === "draft").length,
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="产品线管理"
        description="管理物理商品产品线 · 规格 · 报价 · 状态 · 排序"
      />

      {/* 操作栏 */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索产品线名称、ID..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", ...categories] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilterCategory(c)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  filterCategory === c
                    ? "bg-foreground text-background border-foreground"
                    : "hover:bg-muted"
                )}
              >
                {c === "all" ? "全部" : categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
        <Button
          type="primary"
          onClick={() => setCreateOpen(true)}
          className="bg-gradient-to-r from-teal-500 to-emerald-600 border-0"
          icon={<Plus className="h-4 w-4" />}
        >
          新建产品线
        </Button>
      </div>

      {/* 统计卡片（3 张，去除 mock 的销量/评分） */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">产品线</p>
              <p className="text-xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-lg bg-violet-500/10 p-2">
              <Package className="h-4 w-4 text-violet-600" />
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
              <Package className="h-4 w-4 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">草稿</p>
              <p className="text-xl font-bold text-zinc-600">{stats.draft}</p>
            </div>
            <div className="rounded-lg bg-zinc-500/10 p-2">
              <Package className="h-4 w-4 text-zinc-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 产品线卡片 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <EmptyState
              icon={Package}
              title={lines.length === 0 ? "暂无产品线" : "无匹配产品线"}
              description={
                lines.length === 0
                  ? '点击右上角"新建产品线"开始'
                  : "尝试调整搜索条件"
              }
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const spec: ProductLineSpec = p.spec ?? {};
            const pricing = p.pricing as ProductLinePricing;
            const sizeRange = spec.sizeRange;
            const materialList = spec.material ?? [];
            const basePrice = pricing.basePrice;
            return (
              <div
                key={p.productLineId}
                className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden hover:shadow-md transition-all"
              >
                {/* 预览图 / 默认占位 */}
                <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 relative">
                  {p.coverUrl ? (
                    // biome-ignore lint/performance/noImgElement: 外部预览图
                    <img
                      src={p.coverUrl}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="h-10 w-10 text-muted-foreground/40" />
                    </div>
                  )}
                  <span
                    className={cn(
                      "absolute top-2 left-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                      categoryColor(p.category)
                    )}
                  >
                    {categoryLabel(p.category)}
                  </span>
                  <span
                    className={cn(
                      "absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px]",
                      p.status === "active"
                        ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                        : p.status === "draft"
                          ? "bg-zinc-500/10 text-zinc-700 border-zinc-500/20"
                          : "bg-amber-500/10 text-amber-700 border-amber-500/20"
                    )}
                  >
                    {p.status === "active"
                      ? "上架"
                      : p.status === "draft"
                        ? "草稿"
                        : "下架"}
                  </span>
                </div>

                <div className="p-3 space-y-2">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {p.productLineId} · 排序 {p.sortOrder}
                    </p>
                  </div>
                  {p.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 h-8">
                      {p.description}
                    </p>
                  )}

                  {/* 关键规格 */}
                  {(sizeRange || materialList.length > 0) && (
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      {sizeRange && (
                        <div className="flex items-center gap-1 bg-muted/30 rounded px-1.5 py-1">
                          <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">
                            {sizeRange.min}-{sizeRange.max}
                            {sizeRange.unit}
                          </span>
                        </div>
                      )}
                      {materialList[0] && (
                        <div className="flex items-center gap-1 bg-muted/30 rounded px-1.5 py-1">
                          <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">{materialList[0]}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 定价 */}
                  {basePrice ? (
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                      <p className="text-[10px] text-muted-foreground">
                        基础价
                      </p>
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(basePrice, pricing.currency ?? "CNY")}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-1.5 pt-1">
                    <Button
                      size="small"
                      onClick={() => setPreviewLine(p)}
                      className="flex-1"
                      icon={<Eye className="h-3.5 w-3.5" />}
                    >
                      查看
                    </Button>
                    <Button
                      size="small"
                      type="text"
                      onClick={() => setEditingLine(p)}
                      aria-label="编辑"
                      icon={<Edit className="h-3.5 w-3.5" />}
                    />
                    <Button
                      size="small"
                      type="text"
                      danger
                      onClick={() => setDeletingLine(p)}
                      aria-label="删除"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 详情对话框 */}
      <ProductLineDetailDialog
        productLine={previewLine}
        open={!!previewLine}
        onOpenChange={(open) => !open && setPreviewLine(null)}
      />

      {/* 新建 / 编辑弹窗 */}
      <ProductLineFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={reload}
      />
      <ProductLineFormDialog
        open={!!editingLine}
        onOpenChange={(open) => !open && setEditingLine(null)}
        initialLine={editingLine}
        onSuccess={reload}
      />

      {/* 删除确认 */}
      <Modal
        open={!!deletingLine}
        onCancel={() => !isDeleting && setDeletingLine(null)}
        title={
          <span className="flex items-center gap-2 text-rose-600">
            <Trash2 className="h-4 w-4" />
            确认删除产品线
          </span>
        }
        footer={[
          <Button
            key="cancel"
            onClick={() => setDeletingLine(null)}
            disabled={isDeleting}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            danger
            loading={isDeleting}
            onClick={() => {
              if (deletingLine) {
                deleteLine({ productLineId: deletingLine.productLineId });
              }
            }}
          >
            {isDeleting ? "删除中..." : "确认删除"}
          </Button>,
        ]}
      >
        <p className="text-sm py-2">
          确定要删除 <span className="font-semibold">{deletingLine?.name}</span>{" "}
          ({deletingLine?.productLineId}) 吗？关联的 effect.productLineIds
          不会自动清理（应用层查询时会 fallback 显示原 id）。此操作不可撤销。
        </p>
      </Modal>
    </div>
  );
}
