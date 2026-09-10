/**
 * 订单详情视图 —— 在 /image-gen/orders 独立页面的右栏就地展开
 *
 * 2026-09-10：从 /image-gen 右侧抽屉抽出，复用到独立页面。展示：
 * - 主图（按 selectedImageIdx 取 candidates 扁平化后的图）
 * - 模板名 + 订单号 + 状态 + 创建时间
 * - 已选规格（productTypeCode / productSize / accessoryCode / engravingText /
 *   engravingExposed），中文名走 productCatalog 字典
 * - 多候选图 grid（demo 一键下单 1 张；工作台 / 手动流程可能 N 张）
 *
 * 不跳 /p/[token]（避免破坏免登录分享链语义）。如果后续要"跳转订单公共页"
 * 加一个 "查看订单" 按钮即可。
 */

import { CheckCircle2, ImageIcon, Sparkles } from "lucide-react";

import {
  ACCESSORIES,
  getLeatherColor,
  getProductType,
} from "@/features/gpt-image/lib/product-catalog";
import { cn } from "@/lib/utils";

export interface OrderDetail {
  orderId: string;
  orderNo: string;
  token: string;
  status:
    | "PENDING"
    | "GENERATING"
    | "CANDIDATES_READY"
    | "SELECTED"
    | "CANCELLED"
    | "FAILED";
  productTypeCode: string | null;
  productSize: string | null;
  accessoryCode: string | null;
  engravingText: string | null;
  engravingExposed: boolean | null;
  // 2026-09-10：LB 皮革徽章扩展定制（capability-gated）
  leatherColor: string | null;
  leatherExposed: boolean | null;
  pvcProtection: boolean | null;
  remarks: string | null;
  templateName: string;
  templateId: string;
  candidateUrls: string[];
  selectedImageIdx: number;
  createdAt: string;
  /**
   * 2026-09-10：列表缩略图（服务端从 candidates + selections 提取）；
   * /image-gen/orders 列表项直接展示，详情视图用 candidateUrls 主图。
   * /p/[token] 公共订单详情不传此字段，所以 optional。
   */
  thumbnailUrl?: string | null;
}

export function OrderDetailView({ order }: { order: OrderDetail }) {
  const productType = getProductType(order.productTypeCode);
  const accessoryName = (() => {
    if (!order.accessoryCode) return null;
    const acc = ACCESSORIES.find((x) => x.code === order.accessoryCode);
    return acc?.name ?? order.accessoryCode;
  })();
  // 主图 = 已选图 > candidates[0]
  const primaryImageUrl =
    order.candidateUrls[order.selectedImageIdx] ??
    order.candidateUrls[0] ??
    null;

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
      {/* 主图 */}
      <div className="aspect-square w-full max-h-[60vh] bg-muted overflow-hidden">
        {primaryImageUrl ? (
          // biome-ignore lint/performance/noImgElement: 订单主图为远程 URL
          <img
            src={primaryImageUrl}
            alt={order.templateName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-12 w-12 opacity-30" />
          </div>
        )}
      </div>

      <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
        {/* 模板 + 状态 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <OrderStatusBadge status={order.status} />
            <span className="text-[10px] font-mono text-muted-foreground">
              {order.orderNo}
            </span>
          </div>
          <h3 className="text-base font-semibold">{order.templateName}</h3>
          <p className="text-[10px] text-muted-foreground">
            {new Date(order.createdAt).toLocaleString("zh-CN")}
          </p>
        </div>

        {/* 已选规格 */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 border-b">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-500" />
              已选规格
            </span>
          </div>
          <div className="px-3 py-2.5 space-y-1.5">
            {productType ? (
              <div className="text-[11px] flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0">
                  产品型号
                </span>
                <span className="inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20">
                  {productType.name}
                </span>
              </div>
            ) : (
              <div className="text-[11px] flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0">
                  产品型号
                </span>
                <span className="text-muted-foreground">通用款式</span>
              </div>
            )}
            <div className="text-[11px] flex items-baseline gap-2">
              <span className="text-muted-foreground w-16 shrink-0">尺寸</span>
              <span className="font-medium">
                {order.productSize ? `${order.productSize} cm` : "默认"}
              </span>
            </div>
            <div className="text-[11px] flex items-baseline gap-2">
              <span className="text-muted-foreground w-16 shrink-0">配件</span>
              <span className="font-medium">{accessoryName ?? "默认"}</span>
            </div>
            {order.engravingText && (
              <div className="text-[11px] space-y-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground w-16 shrink-0">
                    刻字
                  </span>
                  <span className="font-medium">「{order.engravingText}」</span>
                </div>
                {order.engravingExposed !== null && (
                  <div className="text-[10px] text-muted-foreground pl-[72px]">
                    {order.engravingExposed ? "外露" : "内刻（默认）"}
                  </div>
                )}
              </div>
            )}
            {/* 2026-09-10：LB 皮革徽章定制详情（capability-gated 渲染）。
                皮革颜色查字典取中文名；皮革外露 / PVC 保护独立 boolean；备注单独一行。 */}
            {order.leatherColor && (
              <div className="text-[11px] flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0">
                  皮革色
                </span>
                <span className="font-medium flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-full border"
                    style={{
                      backgroundColor:
                        getLeatherColor(order.leatherColor)?.swatch ?? "#999",
                    }}
                  />
                  {getLeatherColor(order.leatherColor)?.name ??
                    order.leatherColor}
                </span>
              </div>
            )}
            {order.leatherExposed === true && (
              <div className="text-[11px] flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0">
                  皮革外露
                </span>
                <span className="font-medium">是</span>
              </div>
            )}
            {order.pvcProtection === true && (
              <div className="text-[11px] flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0">
                  PVC 保护
                </span>
                <span className="font-medium">是</span>
              </div>
            )}
            {order.remarks && order.remarks.trim().length > 0 && (
              <div className="text-[11px] space-y-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground w-16 shrink-0">
                    备注
                  </span>
                </div>
                <div className="text-[11px] text-stone-700 whitespace-pre-wrap break-words bg-stone-50 rounded-md px-2.5 py-1.5 pl-[72px] max-h-24 overflow-y-auto">
                  {order.remarks.trim()}
                </div>
              </div>
            )}
            {!productType &&
              !order.productSize &&
              !order.accessoryCode &&
              !order.engravingText &&
              !order.leatherColor &&
              order.leatherExposed !== true &&
              order.pvcProtection !== true &&
              !order.remarks && (
                <div className="text-[11px] text-muted-foreground">
                  此订单无配件规格（通用款式）
                </div>
              )}
          </div>
        </div>

        {/* 候选图 grid */}
        {order.candidateUrls.length > 1 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold">
              候选图（{order.candidateUrls.length}）
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {order.candidateUrls.map((url, idx) => (
                <div
                  key={url}
                  className={cn(
                    "relative aspect-square rounded-md overflow-hidden border-2",
                    idx === order.selectedImageIdx
                      ? "border-emerald-500"
                      : "border-transparent opacity-70"
                  )}
                >
                  {/* biome-ignore lint/performance/noImgElement: 候选图为远程 URL */}
                  <img
                    src={url}
                    alt={`候选 ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {idx === order.selectedImageIdx && (
                    <div className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center">
                      <CheckCircle2 className="h-3 w-3 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground text-center pt-2 pb-1">
          订单号：{order.orderNo}
        </div>
      </div>
    </div>
  );
}

/**
 * 订单状态徽章 —— 极简配色（与 /dashboard/prompt-orders 保持一致）
 */
export function OrderStatusBadge({
  status,
}: {
  status: OrderDetail["status"];
}) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: {
      label: "待处理",
      cls: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20",
    },
    GENERATING: {
      label: "生成中",
      cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
    },
    CANDIDATES_READY: {
      label: "候选就绪",
      cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20",
    },
    SELECTED: {
      label: "已下单",
      cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    },
    CANCELLED: {
      label: "已取消",
      cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
    },
    FAILED: {
      label: "失败",
      cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
    },
  };
  const item = map[status] ?? {
    label: status,
    cls: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 h-4 rounded text-[9px] font-medium border",
        item.cls
      )}
    >
      {item.label}
    </span>
  );
}
