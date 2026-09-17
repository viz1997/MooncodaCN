/**
 * CustomWorkshop —— 1:1 移植自 atelier custom-workshop.tsx
 *
 * 4 阶段:Upload → Transform → Configure → Review
 *  - Upload:drag-drop / click 上传图片,验证 image/* + ≤10MB
 *  - Transform:5 种 AI 风格(Original / Q-Version / Anime / Watercolor / Line Art),
 *    调 /api/store/ai/transform(委托 lingting/wellapi),返回 R2 URL
 *  - Configure:选材质(按 productType 过滤)+ 尺寸(按 productType 过滤)
 *    + 刻字(≤30 chars)+ 数量(1-100)
 *  - Review:Before/After 对比 + spec 摘要 + 服务端定价 + Add to Bag
 *
 * 适配差异:
 *  - useCartStore → useStorefrontModal + useCart
 *  - /api/ai/transform → /api/store/ai/transform(委托 lingting,输出 R2 URL)
 *  - /api/pricing/calculate → /api/store/pricing/calculate
 *  - addItem → useCart.addLineItem.mutate
 *  - 中文化文案 + CNY
 *  - 用 shadcn Dialog 而非 raw framer-motion
 *
 * 服务端定价权威:cart 存 server 算的 unitPriceCents,client 不自己算。
 */

"use client";

import {
  Check,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";
import { useToast } from "@/hooks/use-toast";

import { useCart, useCartUi } from "../hooks/use-cart";
import { useStorefrontModal } from "../hooks/use-storefront-modal";
import type { AiStyle, CustomizationSpec, PricingResult } from "../types";

type Phase = "upload" | "transform" | "configure" | "review";

interface TransformResponse {
  previewImageUrl: string;
  originalImageUrl: string;
  aiStyleId: string;
  estimatedLatencyMs: number;
}

interface PricingResponse {
  pricing: PricingResult;
}

const STEPS: { id: Phase; label: string; num: string }[] = [
  { id: "upload", label: "上传", num: "01" },
  { id: "transform", label: "AI 风格", num: "02" },
  { id: "configure", label: "规格", num: "03" },
  { id: "review", label: "确认", num: "04" },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ENGRAVING_MAX_LENGTH = 30;
const MAX_QUANTITY = 100;

export function CustomWorkshop() {
  const { toast } = useToast();
  const product = useStorefrontModal((s) => s.customizeProduct);
  const setCustomize = useStorefrontModal((s) => s.setCustomize);
  const openCart = useCartUi((s) => s.openCart);
  const { addLineItem } = useCart();

  const [phase, setPhase] = React.useState<Phase>("upload");
  const [uploadedImage, setUploadedImage] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = React.useState<string | null>(
    null
  );
  const [isDragging, setIsDragging] = React.useState(false);
  const [aiStyle, setAiStyle] = React.useState<AiStyle | null>(null);
  const [isTransforming, setIsTransforming] = React.useState(false);
  const [transformError, setTransformError] = React.useState<string | null>(
    null
  );

  const [selectedMaterialId, setSelectedMaterialId] = React.useState<
    string | null
  >(null);
  const [selectedSizeId, setSelectedSizeId] = React.useState<string | null>(
    null
  );
  const [engraving, setEngraving] = React.useState("");
  const [qty, setQty] = React.useState(1);

  const [pricing, setPricing] = React.useState<PricingResult | null>(null);
  const [pricingLoading, setPricingLoading] = React.useState(false);
  const [pricingError, setPricingError] = React.useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 初始化/重置:打开新 product 时
  React.useEffect(() => {
    if (product) {
      setPhase("upload");
      setUploadedImage(null);
      setPreviewUrl(null);
      setOriginalImageUrl(null);
      setAiStyle(product.aiStyles[0] ?? null);
      setTransformError(null);
      setSelectedMaterialId(product.materials[0]?.id ?? null);
      setSelectedSizeId(product.sizes[0]?.id ?? null);
      setEngraving("");
      setQty(1);
      setPricing(null);
      setPricingError(null);
    }
  }, [product]);

  // 调 pricing(进入 configure/review 时,spec 变化时也重算)
  React.useEffect(() => {
    if (!product) return;
    if (phase !== "configure" && phase !== "review") return;
    if (
      !selectedMaterialId ||
      !selectedSizeId ||
      !aiStyle ||
      !previewUrl ||
      !originalImageUrl
    ) {
      return;
    }

    const spec: CustomizationSpec = {
      productId: product.id,
      productHandle: product.handle,
      productTypeCode: product.productTypeCode,
      materialId: selectedMaterialId,
      sizeId: selectedSizeId,
      aiStyleId: aiStyle.id,
      engravingText: engraving,
      rushOrder: false,
      quantity: qty,
      previewImageUrl: previewUrl,
      originalImageUrl,
    };

    let cancelled = false;
    setPricingLoading(true);
    setPricingError(null);

    fetch("/api/store/pricing/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.message ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<PricingResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setPricing(data.pricing);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPricingError(err.message);
        setPricing(null);
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    product,
    phase,
    selectedMaterialId,
    selectedSizeId,
    aiStyle,
    engraving,
    qty,
    previewUrl,
    originalImageUrl,
  ]);

  /* --------------------------- File handlers --------------------------- */

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({
        title: "请上传图片",
        description: "支持 JPG / PNG / WebP",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "图片过大",
        description: "请上传 10MB 以内的图片",
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setUploadedImage(result);
      setPhase("transform");
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  /* --------------------------- Transform handlers --------------------------- */

  const handleTransform = async (styleOverride?: AiStyle) => {
    if (!uploadedImage) return;
    const style = styleOverride ?? aiStyle;
    if (!style) return;

    setIsTransforming(true);
    setTransformError(null);
    setAiStyle(style);

    try {
      const res = await fetch("/api/store/ai/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: uploadedImage,
          aiStyleId: style.id,
          productTypeCode: product?.productTypeCode ?? "R",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? "AI 转换失败");
      }

      const result = data as TransformResponse;
      setPreviewUrl(result.previewImageUrl);
      setOriginalImageUrl(result.originalImageUrl);
      setPhase("configure");

      const latencySec = Math.round(result.estimatedLatencyMs / 1000);
      toast({
        title:
          style.id === "ai_original" ? "原图保留" : `${style.name} 应用成功`,
        description:
          style.id === "ai_original"
            ? "未应用 AI 风格,保留原始照片"
            : `预览生成完成,耗时 ${latencySec}s`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络错误";
      setTransformError(msg);
      toast({
        title: "AI 转换失败",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsTransforming(false);
    }
  };

  /* --------------------------- Add to cart --------------------------- */

  const handleAddToBag = async () => {
    if (!product || !pricing || !previewUrl || !originalImageUrl) return;
    if (!selectedMaterialId || !selectedSizeId || !aiStyle) return;

    try {
      await addLineItem.mutateAsync({
        productId: product.id,
        spec: {
          productId: product.id,
          productHandle: product.handle,
          productTitle: product.title,
          productThumbnail: product.thumbnail,
          materialId: selectedMaterialId,
          sizeId: selectedSizeId,
          sizeCm: product.sizes.find((s) => s.id === selectedSizeId)?.cm ?? 0,
          aiStyleId: aiStyle.id,
          engravingText: engraving,
          rushOrder: false,
          previewImage: previewUrl,
          originalImage: originalImageUrl,
        },
        quantity: qty,
      });

      toast({
        title: "已加入购物袋",
        description: `${product.title} × ${qty}`,
      });
      setCustomize(null);
      openCart();
    } catch (err) {
      toast({
        title: "加入购物袋失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    }
  };

  if (!product) return null;

  return (
    <Dialog
      open={Boolean(product)}
      onOpenChange={(open) => !open && setCustomize(null)}
    >
      <DialogContent className="w-full sm:max-w-5xl max-h-[94vh] sm:max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">定制 {product.title}</DialogTitle>

        {/* Header + stepper */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b bg-background/95 backdrop-blur shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.22em] text-accent">
              {product.typeLabel} · Custom Workshop
            </p>
            <h2 className="font-serif text-lg sm:text-xl tracking-tight truncate">
              {product.title}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCustomize(null)}
            aria-label="关闭"
            className="size-9 rounded-full hover:bg-secondary shrink-0 ml-3"
            type="button"
          >
            <X className="size-5" />
          </Button>
        </div>

        <div className="px-5 sm:px-6 py-3 border-b bg-secondary/30 shrink-0">
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
            {STEPS.map((s, i) => {
              const active = phase === s.id;
              const done = STEPS.findIndex((x) => x.id === phase) > i;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: 固定 4 步
                <React.Fragment key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      if (done || active) setPhase(s.id);
                    }}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] whitespace-nowrap transition-colors ${
                      active
                        ? "bg-foreground text-background"
                        : done
                          ? "text-foreground hover:bg-secondary"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-4 rounded-full flex items-center justify-center text-[9px] ${
                        active
                          ? "bg-background/20"
                          : done
                            ? "bg-accent text-accent-foreground"
                            : "bg-secondary"
                      }`}
                    >
                      {done ? <Check className="size-2.5" /> : s.num}
                    </span>
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && (
                    <span className="h-px w-3 sm:w-5 bg-border shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {phase === "upload" && (
            <div className="p-5 sm:p-8">
              <button
                type="button"
                onDrop={handleDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-sm p-8 sm:p-12 text-center cursor-pointer transition-colors w-full ${
                  isDragging
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-foreground/40 hover:bg-secondary/40"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = ""; // 重置,允许重选同一文件
                  }}
                />
                <Upload className="size-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-serif text-xl mb-2">上传你的照片</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto text-pretty">
                  点击或拖拽图片到这里。JPG / PNG / WebP,10MB 以内。
                  建议人像清晰、主体居中。
                </p>
              </button>
              <p className="text-[11px] text-muted-foreground text-center mt-4">
                上传即表示你同意我们将图片用于 AI 风格转换与定制预览。
              </p>
            </div>
          )}

          {phase === "transform" && (
            <div className="p-5 sm:p-8">
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="bg-muted rounded-sm overflow-hidden aspect-square">
                  {uploadedImage && (
                    <img
                      src={uploadedImage}
                      alt="原图"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="size-4 text-accent" />
                    <p className="text-[11px] uppercase tracking-[0.16em] font-medium">
                      选择 AI 风格
                    </p>
                  </div>
                  <div className="space-y-2">
                    {product.aiStyles.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => handleTransform(style)}
                        disabled={isTransforming}
                        className={`w-full flex items-center gap-3 p-3 rounded-sm border transition-colors text-left ${
                          aiStyle?.id === style.id
                            ? "border-foreground bg-secondary/60"
                            : "border-border hover:border-foreground/40"
                        } disabled:opacity-50`}
                      >
                        <span
                          className="size-10 rounded-full shrink-0"
                          style={{ backgroundColor: style.swatch }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{style.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {style.id === "ai_original"
                              ? "不应用 AI"
                              : `约 ${style.estimatedLatencySec}s · +${formatPriceCNY(style.surchargeCents / 100)}`}
                          </p>
                        </div>
                        {aiStyle?.id === style.id && (
                          <Check className="size-4 text-foreground shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                  {isTransforming && (
                    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      AI 转换中...可能需要 30 秒
                    </div>
                  )}
                  {transformError && (
                    <div className="mt-4 p-3 rounded-sm bg-destructive/10 text-destructive text-sm">
                      {transformError}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTransform()}
                        disabled={isTransforming}
                        className="ml-2"
                        type="button"
                      >
                        <RefreshCw className="size-3 mr-1" />
                        重试
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {phase === "configure" && (
            <div className="p-5 sm:p-8 space-y-6">
              {previewUrl && (
                <div className="bg-muted rounded-sm overflow-hidden aspect-square max-w-md mx-auto">
                  <img
                    src={previewUrl}
                    alt="预览"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-5 max-w-2xl mx-auto">
                {/* 尺寸 */}
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] font-medium block mb-2">
                    尺寸
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {product.sizes.map((size) => (
                      <button
                        key={size.id}
                        type="button"
                        onClick={() => setSelectedSizeId(size.id)}
                        className={`px-3 py-2.5 text-sm rounded-sm border transition-colors ${
                          selectedSizeId === size.id
                            ? "border-foreground bg-secondary/60"
                            : "border-border hover:border-foreground/40"
                        }`}
                      >
                        {size.cm}cm
                        {size.surchargeCents > 0 && (
                          <span className="block text-[10px] text-muted-foreground">
                            +{formatPriceCNY(size.surchargeCents / 100)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 材质 */}
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] font-medium block mb-2">
                    材质
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {product.materials.map((mat) => (
                      <button
                        key={mat.id}
                        type="button"
                        onClick={() => setSelectedMaterialId(mat.id)}
                        className={`px-3 py-2.5 text-sm rounded-sm border transition-colors ${
                          selectedMaterialId === mat.id
                            ? "border-foreground bg-secondary/60"
                            : "border-border hover:border-foreground/40"
                        }`}
                      >
                        {mat.name}
                        {mat.surchargeCents > 0 && (
                          <span className="block text-[10px] text-muted-foreground">
                            +{formatPriceCNY(mat.surchargeCents / 100)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 刻字 */}
                <div className="sm:col-span-2">
                  <label
                    htmlFor="engraving-input"
                    className="text-[11px] uppercase tracking-[0.16em] font-medium block mb-2"
                  >
                    刻字(可选,≤{ENGRAVING_MAX_LENGTH} 字符)
                  </label>
                  <Input
                    id="engraving-input"
                    value={engraving}
                    onChange={(e) =>
                      setEngraving(
                        e.target.value.slice(0, ENGRAVING_MAX_LENGTH)
                      )
                    }
                    placeholder="Love U / 生日快乐 / 宝宝名"
                    maxLength={ENGRAVING_MAX_LENGTH}
                    className="rounded-sm"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {engraving.length}/{ENGRAVING_MAX_LENGTH}
                    {engraving.length > 0 && (
                      <span className="ml-2">+{formatPriceCNY(3)}</span>
                    )}
                  </p>
                </div>

                {/* 数量 */}
                <div>
                  <span className="text-[11px] uppercase tracking-[0.16em] font-medium block mb-2">
                    数量
                  </span>
                  <div className="flex items-center border rounded-full w-fit">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setQty(Math.max(1, qty - 1))}
                      disabled={qty <= 1}
                      aria-label="减少数量"
                      className="size-9 rounded-l-full"
                      type="button"
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-10 text-center text-sm font-medium">
                      {qty}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setQty(Math.min(MAX_QUANTITY, qty + 1))}
                      disabled={qty >= MAX_QUANTITY}
                      aria-label="增加数量"
                      className="size-9 rounded-r-full"
                      type="button"
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  {qty >= 10 && (
                    <p className="text-[11px] text-accent mt-2">
                      数量阶梯折扣:{qty >= 50 ? "20% off" : "10% off"}
                    </p>
                  )}
                </div>

                {/* 价格 */}
                <div className="flex flex-col justify-end items-end">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    单价
                  </p>
                  {pricingLoading ? (
                    <Loader2 className="size-5 animate-spin text-muted-foreground mt-1" />
                  ) : pricingError ? (
                    <p className="text-sm text-destructive mt-1">
                      {pricingError}
                    </p>
                  ) : pricing ? (
                    <p className="font-serif text-2xl">
                      {formatPriceCNY(pricing.unitPriceCents / 100)}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    预计 {product.leadTimeDays} 天发货
                  </p>
                </div>
              </div>

              <div className="flex justify-center pt-2">
                <Button
                  size="lg"
                  onClick={() => setPhase("review")}
                  disabled={!pricing || pricingLoading}
                  className="rounded-full px-8"
                  type="button"
                >
                  下一步:确认
                </Button>
              </div>
            </div>
          )}

          {phase === "review" && previewUrl && originalImageUrl && (
            <div className="p-5 sm:p-8 space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    原图
                  </p>
                  <div className="bg-muted rounded-sm overflow-hidden aspect-square">
                    <img
                      src={originalImageUrl}
                      alt="原图"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-accent mb-2">
                    定制预览
                  </p>
                  <div className="bg-muted rounded-sm overflow-hidden aspect-square">
                    <img
                      src={previewUrl}
                      alt="预览"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>

              <div className="max-w-xl mx-auto space-y-3">
                <p className="text-[11px] uppercase tracking-[0.16em] font-medium">
                  定制规格
                </p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">产品</dt>
                    <dd>{product.title}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">尺寸</dt>
                    <dd>
                      {product.sizes.find((s) => s.id === selectedSizeId)?.cm}
                      cm
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">材质</dt>
                    <dd>
                      {
                        product.materials.find(
                          (m) => m.id === selectedMaterialId
                        )?.name
                      }
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">AI 风格</dt>
                    <dd>{aiStyle?.name}</dd>
                  </div>
                  {engraving && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">刻字</dt>
                      <dd>&ldquo;{engraving}&rdquo;</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">数量</dt>
                    <dd>{qty}</dd>
                  </div>
                </dl>

                {pricing && (
                  <div className="border-t pt-3 space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">单价</span>
                      <span>
                        {formatPriceCNY(pricing.unitPriceCents / 100)}
                      </span>
                    </div>
                    {pricing.breakdown.quantityTierDiscountCents > 0 && (
                      <div className="flex justify-between text-sm text-accent">
                        <span>数量折扣</span>
                        <span>
                          -
                          {formatPriceCNY(
                            pricing.breakdown.quantityTierDiscountCents / 100
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-medium pt-1.5 border-t">
                      <span>合计</span>
                      <span>
                        {formatPriceCNY(pricing.totalPriceCents / 100)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => setPhase("configure")}
                  className="rounded-full"
                  type="button"
                >
                  返回修改
                </Button>
                <Button
                  size="lg"
                  onClick={handleAddToBag}
                  disabled={addLineItem.isPending || !pricing || pricingLoading}
                  className="rounded-full group"
                  type="button"
                >
                  {addLineItem.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      加入中...
                    </>
                  ) : (
                    <>
                      <Wand2 className="size-4 mr-2" />
                      加入购物袋
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
