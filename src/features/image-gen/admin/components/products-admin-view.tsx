"use client";

/**
 * 商品管理 - Admin 列表视图（2026-10-21 新增）
 *
 * 背景：小程序的商品列表走 GET /api/image-gen/products，它的产品资料
 * 原来全来自 product-catalog.ts 的硬编码常量，运营改价要发版。现在搬到
 * product 表，这里就是运营改的地方。
 *
 * 卡片内容刻意对齐小程序实际拿到的数据（displayName / basePriceCents /
 * variants[]），运营在后台看到的和小程序看到的是同一份。
 *
 * SKU 明细在 /admin/products/[code]，本页只做列表 + 商品资料编辑。
 */

import { App, Badge, Button, Modal } from "antd";
import {
  AlertTriangle,
  Boxes,
  Edit,
  Eye,
  Package,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import {
  deleteProductAdminAction,
  listProductsAdminAction,
} from "@/features/image-gen/admin/actions";
import { ProductFormDialog } from "@/features/image-gen/admin/components/product-form-dialog";
import type { AdminProduct } from "@/features/image-gen/lib/db-products";
import {
  EmptyState,
  formatCurrency,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  active: "上架",
  inactive: "下架",
};

/** 价格区间展示；min === max 时只显示一个价 */
function priceRangeText(p: AdminProduct): string {
  const range = p.priceRangeCents;
  if (!range) return "—";
  const min = formatCurrency(range.min / 100);
  const max = formatCurrency(range.max / 100);
  return min === max ? min : `${min} ~ ${max}`;
}

export function ProductsAdminView() {
  const { message } = App.useApp();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await listProductsAdminAction();
      setProducts(res?.data?.products ?? []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载商品失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { execute: deleteProduct, isPending: isDeleting } = useAction(
    deleteProductAdminAction,
    {
      onSuccess: () => {
        setDeleting(null);
        message.success("删除成功");
        reload();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "删除失败");
      },
    }
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q);
      const matchStatus = filterStatus === "all" || p.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [products, search, filterStatus]);

  const stats = useMemo(
    () => ({
      total: products.length,
      active: products.filter((p) => p.status === "active").length,
      inactive: products.filter((p) => p.status === "inactive").length,
      skuCount: products.reduce((sum, p) => sum + p.totalSkuCount, 0),
      noSku: products.filter(
        (p) => p.status === "active" && p.activeSkuCount === 0
      ),
    }),
    [products]
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="商品管理"
        description="商品资料 · 基础价 · SKU 变体 · 上下架 —— 对外由 /api/image-gen/products 提供给小程序"
      />

      {/* 操作栏 */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="relative max-w-md flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索商品名称 / 产品码..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", "active", "inactive"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterStatus(s)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  filterStatus === s
                    ? "bg-foreground text-background border-foreground"
                    : "hover:bg-muted"
                )}
              >
                {s === "all" ? "全部" : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>
            刷新
          </Button>
          <Button
            type="primary"
            onClick={() => setCreateOpen(true)}
            className="bg-gradient-to-r from-teal-500 to-emerald-600 border-0"
            icon={<Plus className="h-4 w-4" />}
          >
            新建商品
          </Button>
        </div>
      </div>

      {/* 空表提示：没跑 seed 脚本时给出可执行的引导 */}
      {!loading && products.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              商品表还是空的
            </p>
            <p className="text-amber-700 dark:text-amber-400 mt-1">
              先跑一次种子脚本灌入 6 个型号和它们的 SKU：
              <code className="mx-1 px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-xs">
                pnpm tsx src/db/seed-products.ts
              </code>
              在此之前 /api/image-gen/products 会继续走 product-catalog.ts
              的硬编码常量，对外行为不变。
            </p>
          </div>
        </div>
      ) : null}

      {/* 上架但没有 SKU 的商品 —— 小程序会退回旧拼价逻辑，值得预警 */}
      {stats.noSku.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-3 text-sm">
          <Tags className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            以下上架商品没有任何在售 SKU，小程序会退回「基础价 + 各维度
            价差」的旧拼价逻辑：
            <span className="font-mono">
              {stats.noSku.map((p) => p.code).join(" / ")}
            </span>
          </span>
        </div>
      ) : null}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">商品</p>
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
              <Eye className="h-4 w-4 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">下架</p>
              <p className="text-xl font-bold text-zinc-600">
                {stats.inactive}
              </p>
            </div>
            <div className="rounded-lg bg-zinc-500/10 p-2">
              <Eye className="h-4 w-4 text-zinc-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">SKU 变体</p>
              <p className="text-xl font-bold text-sky-600">{stats.skuCount}</p>
            </div>
            <div className="rounded-lg bg-sky-500/10 p-2">
              <Boxes className="h-4 w-4 text-sky-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 商品卡片 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <EmptyState
              icon={Package}
              title={products.length === 0 ? "暂无商品" : "无匹配商品"}
              description={
                products.length === 0
                  ? '点击右上角"新建商品"，或先运行 seed 脚本'
                  : "尝试调整搜索条件"
              }
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div
              key={p.code}
              className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden hover:shadow-md transition-all"
            >
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
                <div className="absolute top-2 right-2 flex gap-1.5">
                  <Badge
                    count={
                      p.status === "active" ? (
                        <span className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded">
                          {STATUS_LABELS.active}
                        </span>
                      ) : (
                        <span className="bg-zinc-500 text-white text-[10px] px-1.5 py-0.5 rounded">
                          {STATUS_LABELS.inactive}
                        </span>
                      )
                    }
                  />
                </div>
              </div>

              <div className="p-3 space-y-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {p.code}
                    </span>
                    <p className="font-semibold truncate">{p.name}</p>
                  </div>
                  {p.nameEn ? (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {p.nameEn}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/30 rounded px-2 py-1.5">
                    <p className="text-muted-foreground">基础价</p>
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(p.basePriceCents / 100)}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded px-2 py-1.5">
                    <p className="text-muted-foreground">SKU 价格区间</p>
                    <p className="font-bold">{priceRangeText(p)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    在售 SKU {p.activeSkuCount}/{p.totalSkuCount}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    配件变体 {p.accessoryVariantCount}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    交期 {p.leadTimeDays} 天
                  </span>
                </div>

                <div className="flex items-center gap-1.5 pt-1">
                  <Link
                    href={`/admin/products/${p.code}`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1 rounded-md border bg-background hover:bg-accent transition-colors"
                  >
                    <Boxes className="h-3.5 w-3.5" />
                    SKU 管理
                  </Link>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => setEditing(p)}
                    aria-label="编辑"
                    icon={<Edit className="h-3.5 w-3.5" />}
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    onClick={() => setDeleting(p)}
                    aria-label="删除"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建 / 编辑弹窗 */}
      <ProductFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={reload}
      />
      <ProductFormDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        initialProduct={editing}
        onSuccess={reload}
      />

      {/* 删除确认 */}
      <Modal
        open={!!deleting}
        onCancel={() => !isDeleting && setDeleting(null)}
        title={
          <span className="flex items-center gap-2 text-rose-600">
            <Trash2 className="h-4 w-4" />
            确认删除商品
          </span>
        }
        footer={[
          <Button
            key="cancel"
            onClick={() => setDeleting(null)}
            disabled={isDeleting}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            danger
            loading={isDeleting}
            onClick={() => deleting && deleteProduct({ code: deleting.code })}
          >
            {isDeleting ? "删除中..." : "确认删除"}
          </Button>,
        ]}
      >
        <p className="text-sm py-2">
          确定要删除 <span className="font-semibold">{deleting?.name}</span>（
          <span className="font-mono">{deleting?.code}</span>）吗？
        </p>
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-700 dark:text-rose-400 space-y-1">
          <p className="font-semibold">连带影响：</p>
          <p>· 其 {deleting?.totalSkuCount ?? 0} 个 SKU 变体行会一并删除</p>
          <p>· 该商品立刻从 /api/image-gen/products 消失</p>
          <p>· 关联的 AI 模板（productEffect）不会被删，但小程序选不到它</p>
          <p className="pt-1">此操作不可撤销。</p>
        </div>
      </Modal>
    </div>
  );
}
