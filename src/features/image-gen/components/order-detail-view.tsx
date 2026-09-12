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

import { QuadrantGridPicker } from "@/components/quadrant-grid-picker";
import {
  ACCESSORIES,
  getLeatherColor,
  getPlatform,
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
  /**
   * 2026-09-11：订单来源平台（仅 LB 皮革徽章业务使用，PLATFORMS 字典 code）。
   * null = 用户未选；非 LB 型号不展示。
   */
  platform: string | null;
  /**
   * 2026-09-11：渠道订单号（与 platform 配对；仅 LB 业务）。
   * null = 用户未填 / 未选 platform / 不展示。淘宝 15~18 位数字、小红书
   * 字母数字混合等异构字符串，自由文本。
   */
  platformOrderNo: string | null;
  templateName: string;
  templateId: string;
  candidateUrls: string[];
  selectedImageIdx: number;
  /**
   * 2026-09-12：用户上传的原图列表（"原图"）—— 跟 candidates（效果图）区分。
   * 详情视图主图下方展示 "原图" 缩略图，让用户看清 AI 在原图基础上做了什么。
   * demo 流只有 1 张（referenceImageUrl）；多图工作台可能 N 张。
   * 老订单 / API 兜底 null 时为空数组。
   */
  uploadedImageUrls: string[];
  createdAt: string;
  /**
   * 2026-09-10：列表缩略图（服务端从 candidates + selections 提取）；
   * /image-gen/orders 列表项直接展示，详情视图用 candidateUrls 主图。
   * /p/[token] 公共订单详情不传此字段，所以 optional。
   */
  thumbnailUrl?: string | null;
  /**
   * 2026-09-11：模板宫格候选数（promptTemplate.candidateCount）。
   * 1 / 2 / 4 / 9。>1 且 outputMode=grid → 详情主图走 QuadrantGridPicker
   * 只读模式（composite + 高亮已选 cell）。
   */
  candidateCount: number;
  /**
   * 2026-09-11：模板输出模式（promptTemplate.outputMode）。
   * "grid" = composite 一张图；"separate" = 每张独立 URL。
   */
  outputMode: "grid" | "separate";
  /**
   * 2026-09-11：已选 cell（demo 订单 = composite 内 cell 索引；
   * gpt-image 订单 = candIdx；老订单无值 = null）。详情主图渲染
   * QuadrantGridPicker 时用此值显示 emerald 边框。
   */
  selectedCell: number | null;
  /**
   * 2026-09-12：本单实际扣减积分（basePrice + Σ(matching rule.delta)）。
   * null = 老订单 / 免扣（price=0）。详情卡「积分扣减」段展示。
   */
  creditsCharged: number | null;
  /**
   * 2026-09-12：本单扣减明细（JSON：[{ specKey, label, delta }]）。
   * 解析失败 / null → 不展开明细，只显示总额。
   */
  creditsBreakdown: string | null;
}

export function OrderDetailView({ order }: { order: OrderDetail }) {
  const productType = getProductType(order.productTypeCode);
  const accessoryName = (() => {
    if (!order.accessoryCode) return null;
    const acc = ACCESSORIES.find((x) => x.code === order.accessoryCode);
    return acc?.name ?? order.accessoryCode;
  })();
  // 2026-09-12：解析 creditsBreakdown JSON（[{ specKey, label, delta }]）。
  // 解析失败 / null → 不展开明细，只显示总额。
  const breakdownItems = (() => {
    if (!order.creditsBreakdown) return null;
    try {
      const parsed: unknown = JSON.parse(order.creditsBreakdown);
      if (!Array.isArray(parsed)) return null;
      const items: Array<{ specKey: string; label: string; delta: number }> = [];
      for (const item of parsed) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { specKey?: unknown }).specKey === "string" &&
          typeof (item as { delta?: unknown }).delta === "number"
        ) {
          const it = item as {
            specKey: string;
            delta: number;
            label?: unknown;
          };
          items.push({
            specKey: it.specKey,
            label: typeof it.label === "string" ? it.label : "",
            delta: it.delta,
          });
        }
      }
      return items;
    } catch {
      return null;
    }
  })();
  // 主图 = 已选图 > candidates[0]
  const primaryImageUrl =
    order.candidateUrls[order.selectedImageIdx] ??
    order.candidateUrls[0] ??
    null;
  // 2026-09-11：grid + 多 cell 订单（典型：demo 流 4 宫格下单）走 QuadrantGridPicker
  // 只读模式——composite 一张图 + 高亮已选 cell（emerald 边框）。
  // outputMode=separate 或 candidateCount<=1 时退回原 <img> 单图渲染。
  const cc = order.candidateCount;
  const om = order.outputMode;
  const isGridMulti =
    om === "grid" &&
    (cc === 2 || cc === 4 || cc === 9) &&
    primaryImageUrl !== null;

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
      {/* 主图（"已选效果图"）—— emerald 边框 + "已选"徽章标识用户选中的那张
          2026-09-12：修复 candidates 语义错位（之前 candidates 写的是原图，
          现在 candidates 才是 Lingting 生成的 demo 预览图 / 用户选中的 cell）。
          2026-09-12：去掉 max-h-[60vh] —— 之前 max-h 与 aspect-square 同时作用
          让容器变矩形（500×432），composite 1:1 在矩形里被压扁 + hotzone 位置偏移；
          现在严格 aspect-square 1:1，让 QuadrantGridPicker cell 位置对齐 composite 实际 cell。
          2026-09-12：max-w-md mx-auto —— 在宽屏上 1:1 容器宽度 = 右栏宽度，
          composite 被无意义放大，加 max-w-md（448px）限制合理查看尺寸。 */}
      <div className="relative aspect-square w-full max-w-md mx-auto bg-muted overflow-hidden ring-2 ring-emerald-500 ring-inset">
        {primaryImageUrl ? (
          isGridMulti ? (
            // 2026-09-11：grid 宫格订单只读 picker——onSelect 是 no-op（disabled 后点击无反应）
            <QuadrantGridPicker
              compositeUrl={primaryImageUrl}
              candidateCount={cc as 2 | 4 | 9}
              selectedCell={order.selectedCell}
              disabled
              onSelect={() => {}}
              ariaLabel="已选分镜（已锁定）"
              className="h-full w-full"
            />
          ) : (
            // biome-ignore lint/performance/noImgElement: 订单主图为远程 URL
            // 2026-09-12：object-contain 避免 composite 任意 ratio 被裁
            // （grid 模式由 QuadrantGridPicker 自身 object-contain 处理）
            <img
              src={primaryImageUrl}
              alt={order.templateName}
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-12 w-12 opacity-30" />
          </div>
        )}
        {/* "已选效果图" 徽章 —— 2026-09-12 统一标识（grid 模式 picker 自带
            emerald cell 高亮，但单图 / separate 模式无 picker，需要顶部
            徽章提示哪张是用户选的）。 */}
        {primaryImageUrl && (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-emerald-500 text-white text-[10px] font-semibold shadow-md">
            <CheckCircle2 className="h-3 w-3" />
            已选效果图
          </div>
        )}
      </div>

      {/* 2026-09-12：原图参考 —— 与效果图分开展示，让用户看清 AI 在原图基础上
          做了什么。多图工作台可能 N 张；demo 流 1 张。 */}
      {order.uploadedImageUrls.length > 0 && (
        <div className="px-4 sm:px-6 pt-3 pb-1">
          <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
            原图参考（{order.uploadedImageUrls.length}）
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {order.uploadedImageUrls.map((url, idx) => (
              <div
                key={url}
                className="relative shrink-0 h-16 w-16 sm:h-20 sm:w-20 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-800 opacity-80"
                title={`原图 ${idx + 1}`}
              >
                {/* biome-ignore lint/performance/noImgElement: 原图为远程 URL */}
                <img
                  src={url}
                  alt={`原图 ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}

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
            {/* 2026-09-11：订单来源平台（LB 皮革徽章业务 ToB 渠道归因） */}
            {order.platform && (
              <div className="text-[11px] flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0">
                  来源
                </span>
                <span className="font-medium">
                  {getPlatform(order.platform)?.name ?? order.platform}
                </span>
              </div>
            )}
            {/* 2026-09-11：渠道订单号（与 platform 配对；独立行展示，便于代理商对账） */}
            {order.platformOrderNo &&
              order.platformOrderNo.trim().length > 0 && (
                <div className="text-[11px] flex items-baseline gap-2">
                  <span className="text-muted-foreground w-16 shrink-0">
                    渠道订单号
                  </span>
                  <span className="font-mono font-medium">
                    {order.platformOrderNo.trim()}
                  </span>
                </div>
              )}
            {!productType &&
              !order.productSize &&
              !order.accessoryCode &&
              !order.engravingText &&
              !order.leatherColor &&
              order.leatherExposed !== true &&
              order.pvcProtection !== true &&
              !order.remarks &&
              !order.platform &&
              !order.platformOrderNo && (
                <div className="text-[11px] text-muted-foreground">
                  此订单无配件规格（通用款式）
                </div>
              )}
          </div>
        </div>

        {/* 2026-09-12：积分扣减（对账核心字段，代理商看一眼就懂这条订单扣了多少）
             - 老订单 creditsCharged=null 时整段不渲染
             - 有总额 + 明细时：rose 段「本单扣 X 积分」+ breakdown 列表 */}
        {order.creditsCharged !== null && order.creditsCharged > 0 && (
          <div className="rounded-lg border bg-rose-500/5 overflow-hidden">
            <div className="px-3 py-2 bg-rose-500/10 border-b border-rose-500/20">
              <span className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
                本单扣 {order.creditsCharged} 积分
              </span>
            </div>
            {breakdownItems && breakdownItems.length > 0 && (
              <div className="px-3 py-2.5 space-y-1">
                {breakdownItems.map((item) => (
                  <div
                    key={item.specKey}
                    className="text-[11px] flex items-baseline justify-between gap-2"
                  >
                    <span className="text-muted-foreground font-mono">
                      {item.specKey}
                      {item.label ? ` · ${item.label}` : ""}
                    </span>
                    <span
                      className={cn(
                        "font-mono font-medium",
                        item.delta > 0
                          ? "text-rose-700"
                          : item.delta < 0
                            ? "text-emerald-700"
                            : "text-muted-foreground"
                      )}
                    >
                      {item.delta > 0 ? "+" : ""}
                      {item.delta} 积分
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
