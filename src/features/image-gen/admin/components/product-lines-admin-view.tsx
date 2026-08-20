"use client";

/**
 * 产品线管理 - Admin 视图
 *
 * 仿 mooncada-source/modules/product-lines.tsx 设计：
 * - 5 张统计卡片（产品线 / 上架中 / 累计销量 / 月销量 / 平均评分）
 * - 搜索 + 分类筛选
 * - 卡片网格（预览图 + 关键规格 + 定价 + 销量 + 兼容效果数）
 * - 详情对话框：规格 / 设计规范 / 定价 / 生产 / 兼容效果 Tab
 *
 * 注：mooncada 的 ProductLine 类型有 30+ 字段（嵌套 spec/designSpec/pricing/production），
 * 本次按简化版 MockProductLine 渲染，后续接入 Drizzle 表时再扩展。
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）
 * - shadcn Card 系列 → 内联 div
 * - shadcn Badge/Button/Dialog/Tabs → antd
 */

import { Badge, Button, Modal, Tabs } from "antd";
import {
  DollarSign,
  Edit,
  Eye,
  Factory,
  Package,
  Palette,
  Ruler,
  Search,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";

import {
  MOCK_PRODUCT_LINES,
  type MockProductLine,
} from "@/features/image-gen/lib/product-lines-mock";
import {
  EmptyState,
  formatCurrency,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { cn } from "@/lib/utils";

type Category = MockProductLine["category"];

// 分类颜色与标签（与 mooncada 对齐）
const CATEGORY_LABELS: Record<Category, string> = {
  badge: "徽章",
  keychain: "钥匙扣",
  charm: "挂件",
  "fridge-magnet": "冰箱贴",
  other: "其他",
};

const CATEGORY_COLORS: Record<Category, string> = {
  badge:
    "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  keychain:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  charm: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  "fridge-magnet":
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  other: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
};

// 演示用：基于 ID 给每个产品线生成预览图（picsum）+ 销量数字
function previewUrlFor(id: string): string {
  return `https://picsum.photos/seed/${id}/400/300`;
}

interface EnrichedProductLine extends MockProductLine {
  description: string;
  spec: {
    size: string;
    material: string;
    thickness: string;
    weight: string;
  };
  pricing: {
    basePrice: number;
    bulkPrice: number;
    moq: number;
    currency: string;
  };
  production: {
    productionTime: string;
    dailyCapacity: number;
    factory: string;
  };
  totalSold: number;
  monthlySold: number;
  rating: number;
  compatibleMaskIds: string[];
  tags: string[];
}

const ENRICHED: Record<string, Partial<EnrichedProductLine>> = {
  PL_001: {
    description:
      "精美浮雕吧唧徽章，可定制任意图案，适合动漫周边、活动纪念、粉丝应援。马口铁底盘+亚克力面+浮雕层，质感细腻。",
    spec: {
      size: "直径 58mm",
      material: "马口铁 + 亚克力",
      thickness: "3mm",
      weight: "约 15g",
    },
    pricing: { basePrice: 12, bulkPrice: 6.5, moq: 1, currency: "CNY" },
    production: {
      productionTime: "3-5 个工作日",
      dailyCapacity: 2000,
      factory: "深圳·浮雕车间 A",
    },
    totalSold: 15680,
    monthlySold: 1820,
    rating: 4.8,
    compatibleMaskIds: ["MASK_001", "MASK_002", "MASK_005"],
    tags: ["徽章", "吧唧", "浮雕", "动漫周边", "应援"],
  },
  PL_002: {
    description:
      "亚克力钥匙扣，浮雕效果清晰，坚固耐用。适合礼品定制、品牌周边、卡通形象衍生品。",
    spec: {
      size: "55×35mm",
      material: "透明亚克力",
      thickness: "4mm",
      weight: "约 8g",
    },
    pricing: { basePrice: 6, bulkPrice: 3.5, moq: 1, currency: "CNY" },
    production: {
      productionTime: "2-4 个工作日",
      dailyCapacity: 5000,
      factory: "深圳·亚克力车间 B",
    },
    totalSold: 28460,
    monthlySold: 3120,
    rating: 4.7,
    compatibleMaskIds: ["MASK_001", "MASK_003", "MASK_005"],
    tags: ["钥匙扣", "亚克力", "礼品", "定制"],
  },
  PL_003: {
    description:
      "树脂挂件，立体浮雕，色泽鲜艳。适合高端礼品、IP 衍生品、收藏品。",
    spec: {
      size: "60×40mm",
      material: "PU 树脂",
      thickness: "6mm",
      weight: "约 20g",
    },
    pricing: { basePrice: 18, bulkPrice: 10, moq: 1, currency: "CNY" },
    production: {
      productionTime: "5-7 个工作日",
      dailyCapacity: 1200,
      factory: "东莞·树脂车间 C",
    },
    totalSold: 9120,
    monthlySold: 980,
    rating: 4.9,
    compatibleMaskIds: ["MASK_002", "MASK_004"],
    tags: ["挂件", "树脂", "立体", "收藏"],
  },
  PL_004: {
    description: "PVC 软胶冰箱贴，柔韧耐用。适合家居装饰、旅游纪念品。",
    spec: {
      size: "70×50mm",
      material: "软质 PVC",
      thickness: "3mm",
      weight: "约 12g",
    },
    pricing: { basePrice: 4, bulkPrice: 2.5, moq: 1, currency: "CNY" },
    production: {
      productionTime: "3-5 个工作日",
      dailyCapacity: 3000,
      factory: "深圳·软胶车间 D",
    },
    totalSold: 5240,
    monthlySold: 410,
    rating: 4.6,
    compatibleMaskIds: ["MASK_001"],
    tags: ["冰箱贴", "PVC", "软胶", "纪念品"],
  },
};

function enrich(line: MockProductLine): EnrichedProductLine {
  const extra = ENRICHED[line.productLineId] ?? {};
  return {
    ...line,
    description: extra.description ?? "",
    spec: extra.spec ?? {
      size: "-",
      material: "-",
      thickness: "-",
      weight: "-",
    },
    pricing: extra.pricing ?? {
      basePrice: 0,
      bulkPrice: 0,
      moq: 1,
      currency: "CNY",
    },
    production: extra.production ?? {
      productionTime: "-",
      dailyCapacity: 0,
      factory: "-",
    },
    totalSold: extra.totalSold ?? 0,
    monthlySold: extra.monthlySold ?? 0,
    rating: extra.rating ?? 0,
    compatibleMaskIds: extra.compatibleMaskIds ?? [],
    tags: extra.tags ?? [],
  };
}

const ENRICHED_LINES = MOCK_PRODUCT_LINES.map(enrich);

function ProductLineDetailDialog({
  productLine,
  open,
  onOpenChange,
}: {
  productLine: EnrichedProductLine | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!productLine) return null;

  const tabItems = [
    {
      key: "spec",
      label: (
        <span className="text-xs">
          <Ruler className="h-3 w-3 mr-1" />
          规格
        </span>
      ),
      children: (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-muted-foreground text-[10px]">默认尺寸</p>
            <p className="font-medium">{productLine.spec.size}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-muted-foreground text-[10px]">主材质</p>
            <p className="font-medium">{productLine.spec.material}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-muted-foreground text-[10px]">厚度</p>
            <p className="font-medium">{productLine.spec.thickness}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-muted-foreground text-[10px]">重量</p>
            <p className="font-medium">{productLine.spec.weight}</p>
          </div>
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
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground">基础价 (1件)</p>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {formatCurrency(
                productLine.pricing.basePrice,
                productLine.pricing.currency
              )}
            </p>
          </div>
          <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground">批量价 (≥100)</p>
            <p className="text-xl font-bold text-sky-700 dark:text-sky-400">
              {formatCurrency(
                productLine.pricing.bulkPrice,
                productLine.pricing.currency
              )}
            </p>
          </div>
          <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground">最小起订</p>
            <p className="text-xl font-bold text-violet-700 dark:text-violet-400">
              {productLine.pricing.moq}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "production",
      label: (
        <span className="text-xs">
          <Factory className="h-3 w-3 mr-1" />
          生产
        </span>
      ),
      children: (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-muted-foreground text-[10px]">生产周期</p>
            <p className="font-medium">
              {productLine.production.productionTime}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-muted-foreground text-[10px]">日产能</p>
            <p className="font-medium">
              {productLine.production.dailyCapacity.toLocaleString("zh-CN")}{" "}
              件/天
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5 col-span-2">
            <p className="text-muted-foreground text-[10px]">生产工厂</p>
            <p className="font-medium">{productLine.production.factory}</p>
          </div>
        </div>
      ),
    },
    {
      key: "masks",
      label: (
        <span className="text-xs">
          <Sparkles className="h-3 w-3 mr-1" />
          兼容效果
        </span>
      ),
      children: (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            该产品线兼容 {productLine.compatibleMaskIds.length} 个 AI 效果模版
          </p>
          <div className="grid grid-cols-2 gap-2">
            {productLine.compatibleMaskIds.map((mid) => (
              <div
                key={mid}
                className="flex items-center gap-2 p-2 rounded-lg border bg-card"
              >
                <div className="h-10 w-10 rounded bg-violet-500/10 flex items-center justify-center">
                  <Palette className="h-4 w-4 text-violet-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono">{mid}</p>
                  <p className="text-[10px] text-muted-foreground">效果模版</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

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
            CATEGORY_COLORS[productLine.category]
          )}
        >
          {CATEGORY_LABELS[productLine.category]}
        </span>
        <Badge color="default" className="!text-[10px]">
          评分 {productLine.rating} ★
        </Badge>
        <Badge
          color={productLine.status === "active" ? "green" : "default"}
          className="!text-[10px]"
        >
          {productLine.status === "active" ? "上架" : "下架"}
        </Badge>
      </p>

      {/* 预览图 + 描述 */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="aspect-square rounded-lg overflow-hidden bg-muted">
          {/* biome-ignore lint/performance/noImgElement: 外部预览图（Picsum）需要原生 img */}
          <img
            src={previewUrlFor(productLine.productLineId)}
            alt={productLine.name}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="col-span-2 space-y-2">
          <p className="text-sm">{productLine.description}</p>
          <div className="flex flex-wrap gap-1">
            {productLine.tags.map((t) => (
              <Badge key={t} color="default" className="!text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="bg-muted/30 rounded p-2 text-center">
              <p className="text-[10px] text-muted-foreground">累计销量</p>
              <p className="text-sm font-bold">
                {productLine.totalSold.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="bg-muted/30 rounded p-2 text-center">
              <p className="text-[10px] text-muted-foreground">月销</p>
              <p className="text-sm font-bold text-emerald-600">
                {productLine.monthlySold.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="bg-muted/30 rounded p-2 text-center">
              <p className="text-[10px] text-muted-foreground">基础价</p>
              <p className="text-sm font-bold">
                {formatCurrency(
                  productLine.pricing.basePrice,
                  productLine.pricing.currency
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultActiveKey="spec" items={tabItems} className="w-full" />
    </Modal>
  );
}

export function ProductLinesAdminView() {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [previewLine, setPreviewLine] = useState<EnrichedProductLine | null>(
    null
  );

  const categories = Array.from(new Set(ENRICHED_LINES.map((l) => l.category)));

  const filtered = ENRICHED_LINES.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.productLineId.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchCategory =
      filterCategory === "all" || p.category === filterCategory;
    return matchSearch && matchCategory;
  });

  // 统计
  const stats = {
    total: ENRICHED_LINES.length,
    active: ENRICHED_LINES.filter((p) => p.status === "active").length,
    totalSold: ENRICHED_LINES.reduce((s, p) => s + p.totalSold, 0),
    monthlySold: ENRICHED_LINES.reduce((s, p) => s + p.monthlySold, 0),
    avgRating: (
      ENRICHED_LINES.reduce((s, p) => s + p.rating, 0) / ENRICHED_LINES.length
    ).toFixed(1),
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="产品线管理"
        description="管理物理商品产品线 · 浮雕吧唧徽章 / 亚克力钥匙扣 / 树脂挂件 / PVC 软胶冰箱贴 · 规格定价与生产信息"
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">累计销量</p>
              <p className="text-xl font-bold">
                {stats.totalSold.toLocaleString("zh-CN")}
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
              <p className="text-[10px] text-muted-foreground">月销量</p>
              <p className="text-xl font-bold text-amber-600">
                {stats.monthlySold.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-amber-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">平均评分</p>
              <p className="text-xl font-bold text-rose-600">
                {stats.avgRating}
              </p>
            </div>
            <div className="rounded-lg bg-rose-500/10 p-2">
              <Star className="h-4 w-4 text-rose-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索产品线名称、ID或标签..."
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
              {c === "all" ? "全部" : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/* 产品线卡片 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <EmptyState
              icon={Package}
              title="无匹配产品线"
              description="尝试调整搜索条件"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div
              key={p.productLineId}
              className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden hover:shadow-md transition-all"
            >
              {/* 预览图 */}
              <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 relative cursor-pointer group">
                {/* biome-ignore lint/performance/noImgElement: 外部预览图（Picsum）需要原生 img */}
                <img
                  src={previewUrlFor(p.productLineId)}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <Button
                    size="small"
                    onClick={() => setPreviewLine(p)}
                    icon={<Eye className="h-3.5 w-3.5" />}
                  >
                    查看详情
                  </Button>
                </div>
                <span
                  className={cn(
                    "absolute top-2 left-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                    CATEGORY_COLORS[p.category]
                  )}
                >
                  {CATEGORY_LABELS[p.category]}
                </span>
                <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-md bg-black/60 text-white px-1.5 py-0.5 text-[10px]">
                  <Star className="h-2.5 w-2.5 text-amber-400 fill-amber-400" />
                  {p.rating}
                </span>
              </div>

              <div className="p-3 space-y-2">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {p.productLineId}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 h-8">
                  {p.description}
                </p>

                {/* 关键规格 */}
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <div className="flex items-center gap-1 bg-muted/30 rounded px-1.5 py-1">
                    <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{p.spec.size}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-muted/30 rounded px-1.5 py-1">
                    <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{p.spec.material}</span>
                  </div>
                </div>

                {/* 定价 */}
                <div className="flex items-center justify-between bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                  <div>
                    <p className="text-[10px] text-muted-foreground">基础价</p>
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(p.pricing.basePrice, p.pricing.currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">
                      批量(≥100)
                    </p>
                    <p className="text-sm font-bold text-sky-700 dark:text-sky-400">
                      {formatCurrency(p.pricing.bulkPrice, p.pricing.currency)}
                    </p>
                  </div>
                </div>

                {/* 生产 + 销量 */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t">
                  <span className="flex items-center gap-1">
                    <Factory className="h-3 w-3" />
                    {p.production.productionTime}
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    月销 {p.monthlySold}
                  </span>
                </div>

                {/* 兼容效果数 */}
                <div className="flex items-center gap-1.5 text-[10px]">
                  <Sparkles className="h-3 w-3 text-violet-600" />
                  <span className="text-muted-foreground">
                    兼容 {p.compatibleMaskIds.length} 个效果模版
                  </span>
                </div>

                <div className="flex items-center gap-2">
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
                    icon={<Edit className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 详情对话框 */}
      <ProductLineDetailDialog
        productLine={previewLine}
        open={!!previewLine}
        onOpenChange={(open) => !open && setPreviewLine(null)}
      />
    </div>
  );
}
