"use client";

/**
 * 商品 SKU 管理 - Admin（2026-10-21 新增）
 *
 * /admin/products/[code]：左边改商品资料，右边改 SKU 变体的绝对价和上下架。
 *
 * 对外对应 GET /api/image-gen/products 里每个 ProductCapability.variants[]：
 *   { sku, sizeCode, accessoryCode, variantCode, priceCents, isActive }
 * 小程序按 (sizeCode, accessoryCode, variantCode) 匹配到一行拿绝对价。
 *
 * 交互设计：
 *  - 表格内直接改价 / 切上下架，改动打「脏标记」不立即发请求
 *  - 底部「保存 N 处改动」一次性提交 —— 避免每敲一个数字打一次接口
 *  - 切上下架即时保存（它是一句话的事，且误操作成本低）
 */

import { App, Badge, Button, Form, InputNumber, Switch, Tooltip } from "antd";
import {
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  RotateCcw,
  Save,
  Wand2,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import {
  bulkUpdateProductVariantsAction,
  generateProductVariantsAction,
  getProductAdminAction,
  updateProductAdminAction,
} from "@/features/image-gen/admin/actions";
import {
  formValuesToInput,
  ProductFormFields,
  type ProductFormValues,
  productToFormValues,
} from "@/features/image-gen/admin/components/product-form-dialog";
import type {
  AdminProduct,
  AdminProductVariant,
} from "@/features/image-gen/lib/db-products";
import {
  formatCurrency,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { Link, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * 表格里「改了单价但还没保存」的行状态。
 *
 * 只有单价进草稿 —— 上下架开关是点一下立刻存盘的，不走批量提交。
 */
interface VariantDraft {
  priceYuan: number;
}

interface VariantViewProps {
  /** 路由参数 code */
  productCode: string;
}

/** 按配件 code 分组，表格按 组 → 尺寸 排序展示，比一长条 sku 好读 */
function groupLabel(v: AdminProductVariant): string {
  if (v.accessoryCode === "N-A") return "无配件";
  return v.accessoryCode;
}

export function ProductVariantsView({ productCode }: VariantViewProps) {
  const router = useRouter();
  const { message, modal } = App.useApp();

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [variants, setVariants] = useState<AdminProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  /** id → 未保存的改动 */
  const [drafts, setDrafts] = useState<Record<string, VariantDraft>>({});
  /** 上下架开关即时保存用 */
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [form] = Form.useForm<ProductFormValues>();

  const reload = async () => {
    setLoading(true);
    try {
      const res = await getProductAdminAction({ code: productCode });
      if (!res?.data?.product) {
        setNotFound(true);
        return;
      }
      setProduct(res.data.product);
      setVariants(res.data.variants ?? []);
      form.setFieldsValue(productToFormValues(res.data.product));
      setDrafts({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "加载商品失败";
      if (msg.includes("不存在")) setNotFound(true);
      else message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCode]);

  /* ---------------------------------------------------------------------- */
  /*  商品资料                                                                */
  /* ---------------------------------------------------------------------- */

  const { execute: saveProduct, isPending: isSavingProduct } = useAction(
    updateProductAdminAction,
    {
      onSuccess: () => {
        message.success("商品资料已保存，对外最长 10 分钟后生效（CDN 缓存）");
        reload();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "保存失败");
      },
    }
  );

  const handleSaveProduct = async () => {
    let values: ProductFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // code 是主键不可改，只取 updates 需要的字段
    const input = formValuesToInput(values);
    saveProduct({
      code: productCode,
      updates: {
        name: input.name,
        nameEn: input.nameEn,
        category: input.category,
        description: input.description,
        coverUrl: input.coverUrl,
        basePriceCents: input.basePriceCents,
        leadTimeDays: input.leadTimeDays,
        accent: input.accent,
        status: input.status,
        sortOrder: input.sortOrder,
      },
    });
  };

  /* ---------------------------------------------------------------------- */
  /*  SKU 批量改价                                                            */
  /* ---------------------------------------------------------------------- */

  const { execute: bulkUpdate, isPending: isSavingVariants } = useAction(
    bulkUpdateProductVariantsAction,
    {
      onSuccess: ({ data }) => {
        setTogglingId(null);
        message.success(
          `已保存 ${data?.count ?? 0} 处改动，对外最长 10 分钟后生效（CDN 缓存）`
        );
        reload();
      },
      onError: ({ error }) => {
        setTogglingId(null);
        message.error(error.serverError ?? "保存失败");
      },
    }
  );

  /** 表格里显示的值：有草稿用草稿，否则用 DB 值 */
  const displayPrice = (v: AdminProductVariant): number =>
    drafts[v.id]?.priceYuan ?? v.priceCents / 100;

  const dirtyIds = useMemo(() => Object.keys(drafts), [drafts]);

  // 按 (配件分组, 尺寸, SKU) 排序 —— 必须在所有 early return 之前算，
  // 否则「商品还没加载出来 → 后来加载到了」会触发 hooks 顺序错乱
  const sorted = useMemo(
    () =>
      [...variants].sort((a, b) => {
        const ga = groupLabel(a);
        const gb = groupLabel(b);
        if (ga !== gb) return ga.localeCompare(gb);
        if (a.sizeCode !== b.sizeCode) {
          const na = Number.parseFloat(a.sizeCode);
          const nb = Number.parseFloat(b.sizeCode);
          if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb)
            return na - nb;
          return a.sizeCode.localeCompare(b.sizeCode);
        }
        return a.sku.localeCompare(b.sku);
      }),
    [variants]
  );

  const activeCount = variants.filter((v) => v.isActive).length;
  const prices = variants.map((v) => displayPrice(v));

  const setDraft = (id: string, priceYuan: number) => {
    setDrafts((prev) => ({ ...prev, [id]: { priceYuan } }));
  };

  const discardDrafts = () => setDrafts({});

  const handleSaveVariants = () => {
    const updates = dirtyIds.map((id) => ({
      id,
      priceCents: Math.round((drafts[id]?.priceYuan ?? 0) * 100),
    }));
    bulkUpdate({ productCode, updates });
  };

  /** 上下架开关：即时保存，不进草稿 */
  const handleToggleActive = (v: AdminProductVariant, next: boolean) => {
    setTogglingId(v.id);
    bulkUpdate({
      productCode,
      updates: [{ id: v.id, isActive: next }],
    });
  };

  const { execute: regenerate, isPending: isRegenerating } = useAction(
    generateProductVariantsAction,
    {
      onSuccess: ({ data }) => {
        message.success(
          data?.created
            ? `新增 ${data.created} 个 SKU`
            : "没有新增 —— 所有 SKU 已存在（重复点击不会覆盖你改过的价）"
        );
        reload();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "生成失败");
      },
    }
  );

  const handleRegenerate = () => {
    modal.confirm({
      title: "按当前字典重新生成 SKU？",
      content:
        "会按 PRODUCT_TYPES 的尺寸 × 配件 × 配件变体补齐缺失的 SKU 行。" +
        "已存在的 SKU 不会被覆盖 —— 你在这里改过的价和上下架状态都保留。" +
        "新增的 SKU 价格 = 基础价 + 尺寸阶梯 + 配件加价。",
      okText: "生成",
      cancelText: "取消",
      onOk: () => regenerate({ productCode }),
    });
  };

  /* ---------------------------------------------------------------------- */
  /*  渲染                                                                    */
  /* ---------------------------------------------------------------------- */

  if (notFound) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center space-y-4">
        <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
        <div>
          <p className="font-semibold">商品 {productCode} 不存在</p>
          <p className="text-sm text-muted-foreground mt-1">
            它可能还没被 seed，或已被删除。可在{" "}
            <Link href="/admin/products" className="underline">
              商品列表
            </Link>{" "}
            查看全部。
          </p>
        </div>
        <Button onClick={() => router.push("/admin/products")}>
          返回商品列表
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={`商品 · ${product?.name ?? productCode}`}
        description="改商品资料 / 基础价，或逐行维护 SKU 变体的绝对价与上下架"
      />

      <Button
        type="text"
        onClick={() => router.push("/admin/products")}
        icon={<ArrowLeft className="h-4 w-4" />}
        className="-ml-2"
      >
        返回商品列表
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* ---------------- 左：商品资料 ---------------- */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
            <h3 className="font-semibold text-sm mb-1">商品资料</h3>
            <p className="text-xs text-muted-foreground mb-4">
              产品码是主键，创建后不可改
            </p>
            <Form form={form} layout="vertical">
              <ProductFormFields showCode={false} />
              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="primary"
                  onClick={handleSaveProduct}
                  loading={isSavingProduct}
                  icon={<Save className="h-4 w-4" />}
                >
                  保存资料
                </Button>
                <Button
                  onClick={reload}
                  icon={<RefreshCw className="h-4 w-4" />}
                >
                  重载
                </Button>
              </div>
            </Form>
          </div>

          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 text-xs text-muted-foreground space-y-2">
            <p className="font-semibold text-foreground">对外接口</p>
            <p>
              这个商品通过{" "}
              <code className="px-1 rounded bg-muted">
                GET /api/image-gen/products
              </code>
              暴露给小程序，字段对应关系：
            </p>
            <ul className="space-y-1 pl-3 list-disc">
              <li>
                <span className="font-mono">displayName</span> ← 名称 / 英文名
              </li>
              <li>
                <span className="font-mono">basePriceCents</span> ← 基础价 × 100
              </li>
              <li>
                <span className="font-mono">variants[]</span> ← 下方 SKU 表格
              </li>
              <li>
                <span className="font-mono">status=inactive</span> → 整个商品
                不返回
              </li>
            </ul>
            <p className="pt-1 border-t">
              该接口带 CDN 缓存（s-maxage=300 / SWR=600），改动最长 10 分钟
              才对小程序生效。
            </p>
          </div>
        </div>

        {/* ---------------- 右：SKU 变体 ---------------- */}
        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm">
                  SKU 变体
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    在售 {activeCount} / 共 {variants.length}
                    {prices.length > 0
                      ? ` · 价格区间 ${formatCurrency(Math.min(...prices))} ~ ${formatCurrency(Math.max(...prices))}`
                      : ""}
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  改价填「元」，保存时换算成分。开关切换即时生效。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip title="按 PRODUCT_TYPES 的尺寸 × 配件 × 配件变体补齐缺失的 SKU，不覆盖已有行">
                  <Button
                    onClick={handleRegenerate}
                    loading={isRegenerating}
                    icon={<Wand2 className="h-4 w-4" />}
                  >
                    补齐缺失 SKU
                  </Button>
                </Tooltip>
                <Button
                  onClick={discardDrafts}
                  disabled={dirtyIds.length === 0}
                  icon={<RotateCcw className="h-4 w-4" />}
                >
                  放弃改动
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : sorted.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  这个商品还没有任何 SKU 行
                </p>
                <p className="text-xs text-muted-foreground">
                  点右上角「补齐缺失 SKU」按字典生成，或运行{" "}
                  <code className="px-1 rounded bg-muted">
                    pnpm tsx src/db/seed-products.ts
                  </code>
                </p>
                <Button
                  type="primary"
                  onClick={handleRegenerate}
                  loading={isRegenerating}
                  icon={<Wand2 className="h-4 w-4" />}
                >
                  补齐缺失 SKU
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30">
                    <tr className="text-left">
                      <th className="font-medium text-xs text-muted-foreground px-3 py-2 whitespace-nowrap">
                        SKU
                      </th>
                      <th className="font-medium text-xs text-muted-foreground px-3 py-2 whitespace-nowrap">
                        规格
                      </th>
                      <th className="font-medium text-xs text-muted-foreground px-3 py-2 text-right whitespace-nowrap">
                        单价（元）
                      </th>
                      <th className="font-medium text-xs text-muted-foreground px-3 py-2 text-center whitespace-nowrap">
                        在售
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((v) => {
                      const dirty = drafts[v.id] !== undefined;
                      const active = v.isActive;
                      return (
                        <tr
                          key={v.id}
                          className={cn(
                            "border-b last:border-0",
                            dirty && "bg-amber-500/5",
                            !active && "opacity-60"
                          )}
                        >
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs">{v.sku}</span>
                              {dirty ? (
                                <Badge
                                  count={
                                    <span className="bg-amber-500 text-white text-[9px] px-1 rounded">
                                      未保存
                                    </span>
                                  }
                                />
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                            {v.label}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <InputNumber
                              size="small"
                              className="w-24"
                              min={0}
                              step={1}
                              precision={2}
                              value={displayPrice(v)}
                              disabled={!active || togglingId === v.id}
                              onChange={(val) =>
                                setDraft(v.id, Number(val ?? 0))
                              }
                            />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <Switch
                              size="small"
                              checked={active}
                              loading={togglingId === v.id}
                              onChange={(next) => handleToggleActive(v, next)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 保存条 */}
            {dirtyIds.length > 0 ? (
              <div className="p-3 border-t bg-amber-500/5 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {dirtyIds.length} 处未保存的改动
                </p>
                <div className="flex items-center gap-2">
                  <Button size="small" onClick={discardDrafts}>
                    放弃
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={handleSaveVariants}
                    loading={isSavingVariants}
                    icon={<Save className="h-4 w-4" />}
                  >
                    保存 {dirtyIds.length} 处改动
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
