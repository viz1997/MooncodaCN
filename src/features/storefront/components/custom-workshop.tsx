/**
 * CustomWorkshop —— 1:1 移植自 atelier custom-workshop.tsx
 *
 * 4 阶段:Upload → Style → Configure → Review
 *  - Upload:drag-drop / click 上传图片,验证 image/* + ≤10MB
 *  - Style:选尺寸 + 选 AI 风格(Original / Q-Version / Anime / Watercolor /
 *    Line Art / Realistic),点风格只选中,底栏 CTA 统一提交,
 *    调 /api/store/ai/transform(委托 lingting/wellapi),返回 R2 URL
 *  - Configure:选材质(按 productType 过滤)
 *    + 配件(底座 / 玻璃罩 / 皮套 / 编织绳)+ 刻字(按型号能力开合)+ 加急 + 数量
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
 *
 * ── 2026-11-02 规格屏改版 ──────────────────────────────────────────
 *  - 左预览图 / 右规格(桌面端并排,手机端上下)
 *  - 尺寸 chip 改胶囊 + 选中态填色,第二行显示英寸(不再显示尺寸加价)
 *  - 默认选中「标准款」(product.defaultSizeCm),不再是列表第一项
 *  - 材质只有一种时内联展示,不再占半格空网格
 *  - 新增配件选择器(按 product.accessoryGroups,组内单选)
 *  - 新增加急开关(+¥15,发货天数减半)
 *  - 刻字输入框按 product.canEngrave 开合(手办 / 冰箱贴不刻字)
 *  - 数量 / 单价 / 合计 / CTA 收进底部固定条,规格区独立滚动
 *
 * ── 2026-11-02 尺寸与风格前置 ──────────────────────────────────────
 * 用户诉求:「上传图片后选择尺寸和风格,风格不应该和原图放在一起」。
 *
 *  - 第 2 步改名「尺寸与风格」:尺寸从第 3 步搬上来,跟风格一屏选完
 *  - 原图从「左半屏大图」退成一行小缩略图条(缩略图 + 文件名 + 换一张),
 *    不再和风格网格并排 —— 风格网格现在占满整宽
 *  - 风格从竖排列表改成 2/3 列卡片网格(色卡 + 名字 + 预计耗时)
 *  - 点风格**只选中**,不再立刻发 AI 请求(18–35s);底栏 CTA 统一提交
 *  - CTA 三态:生成预览 / 重新生成预览 / 继续
 *
 * 关键不变式:**能进第 3 步 ⟺ 有预览图,且 previewStyleId === aiStyle.id**。
 * 「进第 3 步」的唯一入口是第 2 步的 CTA(stepper 只允许往回点),
 * CTA 按 styleStale 分支,所以图和风格 id 永远配对,不会写错购物袋。
 *
 * ── 2026-11-02 生图要登录 ───────────────────────────────────────────
 * `/api/store/ai/transform` 现在缺会话一律 401。入口(商品卡 / 品类层 /
 * 详情页 / 快速预览)在开工作台之前就拦一道(`use-require-sign-in.ts`),
 * 这里再兜一层底:发请求前看会话、收到 401 也送登录页。
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
  Zap,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";
import { formatCents } from "@/lib/money";

import { useAtelierContainer } from "../hooks/use-atelier-container";
import { useCart, useCartUi } from "../hooks/use-cart";
import { useSignInUrl } from "../hooks/use-require-sign-in";
import { useStorefrontModal } from "../hooks/use-storefront-modal";
import { PRICING_CONSTANTS } from "../lib/pricing-constants";
import { formatInches, formatSizeWithInches } from "../lib/size-format";
import type {
  AccessoryGroup,
  AiStyle,
  CustomizationSpec,
  PricingResult,
} from "../types";

type Phase = "upload" | "style" | "configure" | "review";

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
  { id: "style", label: "尺寸与风格", num: "02" },
  { id: "configure", label: "规格", num: "03" },
  { id: "review", label: "确认", num: "04" },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ENGRAVING_MAX_LENGTH = 30;
const MAX_QUANTITY = 100;

/** 刻字输入的防抖 —— 每敲一个字都打一次定价接口没必要 */
const ENGRAVING_DEBOUNCE_MS = 300;

/** 规格区的小节标题 */
function SpecLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] uppercase tracking-[0.16em] font-medium block mb-2">
      {children}
    </span>
  );
}

export function CustomWorkshop() {
  const { toast } = useToast();
  const product = useStorefrontModal((s) => s.customizeProduct);
  const setCustomize = useStorefrontModal((s) => s.setCustomize);
  const openCart = useCartUi((s) => s.openCart);
  const { addLineItem } = useCart();
  // 2026-11-02:生图要登录 —— 兜底闸门。进工作台的入口已经拦了一道
  // (use-require-sign-in),这里防的是「会话过期」和「入口放行时 session 还在
  // pending 没查完」这两种漏网情况。
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const signInUrl = useSignInUrl();
  // portal 指回 .atelier-root —— 否则工作台落在 atelier 的 token 子树外,
  // 配色和圆角退回全站默认主题(见 use-atelier-container.ts)
  const container = useAtelierContainer();

  const [phase, setPhase] = React.useState<Phase>("upload");
  const [uploadedImage, setUploadedImage] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = React.useState<string | null>(
    null
  );
  const [isDragging, setIsDragging] = React.useState(false);
  const [aiStyle, setAiStyle] = React.useState<AiStyle | null>(null);
  /**
   * 当前预览图是用哪个风格生成的 —— 用户换风格后靠它判断预览是否过期。
   * 只存 id:风格字典是静态的,id 够用。
   */
  const [previewStyleId, setPreviewStyleId] = React.useState<string | null>(
    null
  );
  /** 上传的文件名 —— 第 2 步顶部缩略图条要显示 */
  const [uploadedFileName, setUploadedFileName] = React.useState<string | null>(
    null
  );
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
  /** 选中的配件变体 id(组内单选、组间可多选) */
  const [selectedAccessoryIds, setSelectedAccessoryIds] = React.useState<
    string[]
  >([]);
  const [engraving, setEngraving] = React.useState("");
  const [debouncedEngraving, setDebouncedEngraving] = React.useState("");
  const [rushOrder, setRushOrder] = React.useState(false);
  const [qty, setQty] = React.useState(1);

  const [pricing, setPricing] = React.useState<PricingResult | null>(null);
  const [pricingLoading, setPricingLoading] = React.useState(false);
  const [pricingError, setPricingError] = React.useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  /**
   * transform 请求序号 —— 生成途中关掉弹窗再开别的商品时,旧响应回来会把
   * 上一个商品的预览写进当前状态。发请求前自增,回来时对不上就丢弃。
   */
  const transformSeqRef = React.useRef(0);

  // 配件数组当依赖会每次渲染都变引用 —— 用 join 出来的字符串当 key
  const accessoryKey = selectedAccessoryIds.join("|");

  /** 有没有可用的预览图(原图 + 风格图都在 R2 上) */
  const hasPreview = Boolean(previewUrl && originalImageUrl);
  /**
   * 预览是用别的风格生成的 —— 用户换了风格但还没重新生成。
   * 换图时 previewUrl 被清空 → hasPreview 为 false → 这里的 false,
   * 所以「换图」和「换风格」两种失效共用这一个布尔量,不用第二个 flag。
   */
  const styleStale = hasPreview && previewStyleId !== aiStyle?.id;

  /**
   * 某个步骤现在能不能进 —— stepper 点击和 CTA 都看它。
   *
   * 「规格」「确认」要求**预览图和当前风格对得上**,所以用户在第 2 步
   * 改了风格又没重新生成时,stepper 上的「03 规格」点不动:必须先重生成。
   */
  const stepReachable = (id: Phase): boolean => {
    if (id === "upload") return true;
    if (id === "style") return Boolean(uploadedImage);
    return hasPreview && previewStyleId === aiStyle?.id;
  };

  // 初始化/重置:打开新 product 时
  React.useEffect(() => {
    if (product) {
      setPhase("upload");
      setUploadedImage(null);
      setUploadedFileName(null);
      setPreviewUrl(null);
      setOriginalImageUrl(null);
      setPreviewStyleId(null);
      setAiStyle(product.aiStyles[0] ?? null);
      setTransformError(null);
      // 作废在飞的 transform —— 上一个商品的响应回来不能写进当前状态
      transformSeqRef.current += 1;
      setSelectedMaterialId(product.materials[0]?.id ?? null);
      // 默认选中「标准款」,不是列表第一项 —— 以前默认 4cm,跟文案说的
      // 8cm / 12cm 标准款对不上,用户一进来看到的价就是错的
      const defaultSize =
        product.sizes.find((s) => s.cm === product.defaultSizeCm) ??
        product.sizes[0];
      setSelectedSizeId(defaultSize?.id ?? null);
      setSelectedAccessoryIds([]);
      setEngraving("");
      setDebouncedEngraving("");
      setRushOrder(false);
      setQty(1);
      setPricing(null);
      setPricingError(null);
    }
  }, [product]);

  // 刻字防抖:输入框每敲一下都触发定价请求,300ms 内的输入合并成一次
  React.useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedEngraving(engraving),
      ENGRAVING_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [engraving]);

  // 尺寸变了,配不上的配件(玻璃罩按尺寸限定)自动摘掉
  React.useEffect(() => {
    if (!product || !selectedSizeId) return;
    const cm = product.sizes.find((s) => s.id === selectedSizeId)?.cm;
    if (cm == null) return;
    setSelectedAccessoryIds((prev) => {
      const next = prev.filter((id) => {
        const variant = product.accessoryGroups
          .flatMap((g) => g.variants)
          .find((v) => v.id === id);
        if (!variant) return false;
        return (
          variant.appliesToSizesCm.length === 0 ||
          variant.appliesToSizesCm.includes(cm)
        );
      });
      return next.length === prev.length ? prev : next;
    });
  }, [product, selectedSizeId]);

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
    // 防御:预览是旧风格生成的,aiStyle 却是新风格 —— 这种组合不该出现
    // (进第 3 步的唯一入口是第 2 步 CTA,CTA 保证两者一致),但真出现了
    // 就别拿它去算价,免得报一个用户看不懂的价
    if (previewStyleId !== aiStyle.id) return;

    const spec: CustomizationSpec = {
      productId: product.id,
      productHandle: product.handle,
      productTypeCode: product.productTypeCode,
      materialId: selectedMaterialId,
      sizeId: selectedSizeId,
      aiStyleId: aiStyle.id,
      engravingText: debouncedEngraving,
      rushOrder,
      accessoryVariantIds: accessoryKey ? accessoryKey.split("|") : [],
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
    debouncedEngraving,
    rushOrder,
    accessoryKey,
    qty,
    previewUrl,
    originalImageUrl,
    previewStyleId,
  ]);

  /* --------------------------- File handlers --------------------------- */

  /** 清空一切跟「图」有关的 state —— 换图时调用 */
  const resetPreview = React.useCallback(() => {
    setPreviewUrl(null);
    setOriginalImageUrl(null);
    setPreviewStyleId(null);
    setTransformError(null);
  }, []);

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
    // 换图 = 在飞的 transform 立刻作废。它回来时会写 previewUrl /
    // originalImageUrl,那是**上一张图**的 R2 URL,留着会跟新图配错对
    // (原图 URL 也会指向旧照片)。序号对不上 → 响应被丢弃。
    transformSeqRef.current += 1;
    setIsTransforming(false);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setUploadedImage(result);
      setUploadedFileName(file.name);
      // 换图 = 旧预览作废。旧 previewUrl / originalImageUrl 是上一张图的
      // R2 URL,留着会跟新图配错对(原图 URL 也会指向旧照片)。
      resetPreview();
      setPhase("style");
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

  /**
   * 跑一次 AI 风格转换(用当前选中的风格)。返回是否成功。
   *
   * 注意这里**不再 setPhase("configure")** —— 前进只允许从第 2 步的 CTA 发生,
   * 保证「进第 3 步」这个动作一定经过 styleStale 判定。
   */
  const handleTransform = async (): Promise<boolean> => {
    if (!uploadedImage || !aiStyle) return false;
    const style = aiStyle;

    // 2026-11-02:生图要登录。会话已经查完且没有用户 → 直接送登录页,
    // 免得白跑一趟(照片还在内存里,登录后回来再传一次不现实,所以留在原地)
    if (!sessionPending && !session?.user) {
      toast({
        title: "请先登录",
        description: "登录后即可继续生成预览",
      });
      router.push(signInUrl);
      return false;
    }

    const seq = ++transformSeqRef.current;
    setIsTransforming(true);
    setTransformError(null);

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

      // 401 = 会话没了(过期 / 被登出)。不当普通错误处理 —— 抛出去会弹一个
      // 「AI 转换失败」的红色 toast,吓人且没用。
      if (res.status === 401) {
        toast({
          title: "请先登录",
          description: "登录状态已失效,重新登录后即可继续生成预览",
        });
        router.push(signInUrl);
        return false;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? "AI 转换失败");
      }

      // 已经有更新的请求了(或者用户换商品了)—— 丢弃这次响应
      if (seq !== transformSeqRef.current) return false;

      const result = data as TransformResponse;
      setPreviewUrl(result.previewImageUrl);
      setOriginalImageUrl(result.originalImageUrl);
      // 记下这张预览是哪个风格生成的 —— 后面换风格时靠它判 stale
      setPreviewStyleId(result.aiStyleId ?? style.id);

      const latencySec = Math.round(result.estimatedLatencyMs / 1000);
      toast({
        title:
          style.id === "ai_original" ? "原图保留" : `${style.name} 应用成功`,
        description:
          style.id === "ai_original"
            ? "未应用 AI 风格,保留原始照片"
            : `预览生成完成,耗时 ${latencySec}s`,
      });
      return true;
    } catch (err) {
      if (seq !== transformSeqRef.current) return false;
      const msg = err instanceof Error ? err.message : "网络错误";
      setTransformError(msg);
      toast({
        title: "AI 转换失败",
        description: msg,
        variant: "destructive",
      });
      return false;
    } finally {
      if (seq === transformSeqRef.current) setIsTransforming(false);
    }
  };

  /**
   * 第 2 步底部 CTA —— 三态:
   *   没有预览        → 生成预览(跑一次 AI)
   *   有预览但风格变了 → 重新生成预览
   *   有预览且风格没变 → 直接进第 3 步,不重跑 AI
   */
  const handleStyleCta = async () => {
    if (!aiStyle) return;
    if (hasPreview && !styleStale) {
      setPhase("configure");
      return;
    }
    const ok = await handleTransform();
    if (ok) setPhase("configure");
  };

  /* --------------------------- Spec handlers --------------------------- */

  // 配件组内单选:再点一次同一个 = 取消;换一款 = 顶掉同组的那款
  const toggleAccessory = React.useCallback(
    (group: AccessoryGroup, variantId: string) => {
      setSelectedAccessoryIds((prev) => {
        if (prev.includes(variantId)) {
          return prev.filter((id) => id !== variantId);
        }
        const groupVariantIds = new Set(group.variants.map((v) => v.id));
        return [...prev.filter((id) => !groupVariantIds.has(id)), variantId];
      });
    },
    []
  );

  /* --------------------------- Add to cart --------------------------- */

  const handleAddToBag = async () => {
    if (!product || !pricing || !previewUrl || !originalImageUrl) return;
    if (!selectedMaterialId || !selectedSizeId || !aiStyle) return;
    // 防御:预览是旧风格生成的,id 却是新风格 —— 写进购物袋就是错的
    if (styleStale) {
      toast({
        title: "请先生成预览",
        description: "风格已变更,需要重新生成预览后才能加入购物袋",
        variant: "destructive",
      });
      return;
    }

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
          rushOrder,
          accessoryVariantIds: selectedAccessoryIds,
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

  const selectedSizeCm =
    product.sizes.find((s) => s.id === selectedSizeId)?.cm ?? 0;
  const selectedAccessories = product.accessoryGroups
    .flatMap((g) => g.variants.map((v) => ({ group: g, variant: v })))
    .filter(({ variant }) => selectedAccessoryIds.includes(variant.id));

  /** 刻字有防抖 —— 输入还没算完价时,屏幕上的单价是旧的,先别让人点下一步 */
  const pricingStale = engraving !== debouncedEngraving;

  return (
    <Dialog
      open={Boolean(product)}
      onOpenChange={(open) => !open && setCustomize(null)}
    >
      <DialogContent
        portalContainer={container}
        showCloseButton={false}
        className="w-full sm:max-w-5xl max-h-[94vh] sm:max-h-[90vh] p-0 overflow-hidden flex flex-col"
      >
        <DialogTitle className="sr-only">定制 {product.title}</DialogTitle>

        {/*
          文件 input 挂在 DialogContent 顶层,不埋在上传步的 dropzone 里 ——
          第 2 步的「换一张」要能复用同一个 input(埋进去的话那一步
          DOM 里根本没有这个节点,fileInputRef.current 是 null)。
          sr-only + absolute,不吃布局。
        */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = ""; // 重置,允许重选同一文件
          }}
        />

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
              const reachable = stepReachable(s.id);
              const done =
                STEPS.findIndex((x) => x.id === phase) > i && reachable;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: 固定 4 步
                <React.Fragment key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      if (active || !reachable) return;
                      // 只允许往回点;往前只放行到「尺寸与风格」——
                      // 第 1 步已经有图了就能直接跳过去选尺寸和风格
                      const idx = STEPS.findIndex((x) => x.id === phase);
                      if (idx > i || s.id === "style") setPhase(s.id);
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

              {/* 回到第 1 步但手里已经有图了 —— 给条近路,不然用户会被
                  困在上传页(第 2 步在 stepper 上点不到,因为它只允许往回点) */}
              {uploadedImage && (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="size-10 rounded-sm overflow-hidden bg-muted shrink-0">
                      <img
                        src={uploadedImage}
                        alt="当前图片"
                        className="w-full h-full object-cover"
                      />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {uploadedFileName ?? "已上传图片"}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setPhase("style")}
                    className="rounded-full"
                    type="button"
                  >
                    继续使用当前图片
                  </Button>
                </div>
              )}
            </div>
          )}

          {phase === "style" && (
            <div className="p-5 sm:p-8 space-y-7">
              {/* ---------- 原图条 ---------- */}
              {/* 原图退成一行小缩略图 —— 它只是「我们拿的是哪张照片」的凭据,
                  不该再占半屏、把风格挤到窄条里 */}
              <div className="flex items-center gap-3 rounded-sm border border-border bg-secondary/30 p-3">
                <span className="size-14 rounded-sm overflow-hidden bg-muted shrink-0">
                  {uploadedImage && (
                    <img
                      src={uploadedImage}
                      alt="原图"
                      className="w-full h-full object-cover"
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">
                    原图已上传
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {uploadedFileName ?? "未命名图片"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full shrink-0"
                  type="button"
                >
                  <Upload className="size-3.5 mr-1" />
                  换一张
                </Button>
              </div>

              {/* ---------- 尺寸 ---------- */}
              {/* 尺寸从第 3 步搬上来 —— 上传完最想先定的是尺寸 */}
              <div>
                <SpecLabel>尺寸</SpecLabel>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((size) => {
                    const active = selectedSizeId === size.id;
                    return (
                      <button
                        key={size.id}
                        type="button"
                        onClick={() => setSelectedSizeId(size.id)}
                        aria-pressed={active}
                        className={`min-w-[4.5rem] px-3 py-2 rounded-sm border text-sm transition-colors ${
                          active
                            ? "border-foreground bg-foreground text-background"
                            : "border-border hover:border-foreground/40"
                        }`}
                      >
                        <span className="block font-medium leading-tight">
                          {size.cm}cm
                        </span>
                        <span
                          className={`block text-[10px] leading-tight mt-0.5 ${
                            active
                              ? "text-background/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatInches(size.cm)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ---------- AI 风格 ---------- */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="size-4 text-accent" />
                  <p className="text-[11px] uppercase tracking-[0.16em] font-medium">
                    AI 风格
                  </p>
                </div>
                {/* 点风格**只选中**,不发请求 —— 底栏 CTA 统一提交。
                    误点一次风格就烧掉一次 30 秒的 AI 调用,体验太差 */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {product.aiStyles.map((style) => {
                    const active = aiStyle?.id === style.id;
                    return (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => setAiStyle(style)}
                        aria-pressed={active}
                        disabled={isTransforming}
                        className={`flex flex-col items-start gap-2 p-3 rounded-sm border text-left transition-colors ${
                          active
                            ? "border-foreground bg-secondary/60"
                            : "border-border hover:border-foreground/40"
                        } disabled:opacity-50`}
                      >
                        <span className="flex items-center gap-2 w-full">
                          <span
                            className="size-8 rounded-full shrink-0"
                            style={{ backgroundColor: style.swatch }}
                          />
                          {active && (
                            <Check className="size-4 text-foreground shrink-0 ml-auto" />
                          )}
                        </span>
                        <span className="text-sm font-medium leading-tight">
                          {style.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground leading-tight">
                          {style.id === "ai_original"
                            ? "不应用 AI"
                            : `约 ${style.estimatedLatencySec} 秒`}
                        </span>
                      </button>
                    );
                  })}
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
          )}

          {phase === "configure" && (
            <div className="p-5 sm:p-8">
              <div className="mx-auto max-w-4xl grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
                {/* 左:预览图(桌面端 sticky,滚动规格时不跟着跑) */}
                <div className="lg:sticky lg:top-0 self-start">
                  {previewUrl && (
                    <div className="bg-muted rounded-sm overflow-hidden aspect-square max-w-[260px] mx-auto lg:max-w-none">
                      <img
                        src={previewUrl}
                        alt="预览"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed text-center lg:text-left">
                    预览是 AI 生成的效果图,实物以收到的为准。
                  </p>
                </div>

                {/* 右:规格 */}
                <div className="space-y-5">
                  {/* 尺寸和风格在第 2 步就选好了 —— 这儿只做摘要 + 改回去的入口 */}
                  <div className="flex items-center gap-3 flex-wrap rounded-sm border border-border bg-secondary/30 px-3.5 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">尺寸</span>
                      <span className="font-medium">
                        {formatSizeWithInches(selectedSizeCm)}
                      </span>
                    </div>
                    <span className="h-4 w-px bg-border" aria-hidden />
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">风格</span>
                      <span className="font-medium">{aiStyle?.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPhase("style")}
                      className="ml-auto rounded-full"
                      type="button"
                    >
                      修改
                    </Button>
                  </div>

                  {/* 材质 —— 只有一种时内联,不留半格空网格 */}
                  <div>
                    <SpecLabel>材质</SpecLabel>
                    {product.materials.length === 1 ? (
                      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-sm border border-border bg-secondary/40 text-sm">
                        <span className="font-medium">
                          {product.materials[0]?.name}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {product.materials.map((mat) => {
                          const active = selectedMaterialId === mat.id;
                          return (
                            <button
                              key={mat.id}
                              type="button"
                              onClick={() => setSelectedMaterialId(mat.id)}
                              aria-pressed={active}
                              className={`inline-flex items-center gap-2 px-3 py-2 rounded-sm border text-sm transition-colors ${
                                active
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border hover:border-foreground/40"
                              }`}
                            >
                              <span className="font-medium">{mat.name}</span>
                              {mat.surchargeCents > 0 && (
                                <span
                                  className={`text-[10px] ${
                                    active
                                      ? "text-background/70"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  +{formatCents(mat.surchargeCents)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 配件 —— 底座 / 玻璃罩 / 皮套 / 编织绳 */}
                  {product.accessoryGroups.map((group) => {
                    // 玻璃罩这类按尺寸限定的变体,当前尺寸配不上就不显示
                    const available = group.variants.filter(
                      (v) =>
                        v.appliesToSizesCm.length === 0 ||
                        v.appliesToSizesCm.includes(selectedSizeCm)
                    );
                    if (available.length === 0) return null;
                    return (
                      <div key={group.code}>
                        <SpecLabel>{group.name}</SpecLabel>
                        <div className="flex flex-wrap gap-2">
                          {available.map((variant) => {
                            const active = selectedAccessoryIds.includes(
                              variant.id
                            );
                            return (
                              <button
                                key={variant.id}
                                type="button"
                                onClick={() =>
                                  toggleAccessory(group, variant.id)
                                }
                                aria-pressed={active}
                                className={`inline-flex items-center gap-2 px-3 py-2 rounded-sm border text-sm transition-colors ${
                                  active
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border hover:border-foreground/40"
                                }`}
                              >
                                {variant.swatch && (
                                  <span
                                    className="size-3 rounded-full shrink-0 border border-black/10"
                                    style={{ backgroundColor: variant.swatch }}
                                  />
                                )}
                                <span className="font-medium leading-tight">
                                  {variant.name}
                                </span>
                                {variant.surchargeCents > 0 && (
                                  <span
                                    className={`text-[10px] ${
                                      active
                                        ? "text-background/70"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    +{formatCents(variant.surchargeCents)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* 刻字 —— 只给支持的型号(手办 / 冰箱贴不做表面刻字) */}
                  {product.canEngrave && (
                    <div>
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
                          <span className="ml-2">
                            +
                            {formatCents(PRICING_CONSTANTS.ENGRAVING_FEE_CENTS)}
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {/* 加急 */}
                  <div>
                    <SpecLabel>发货</SpecLabel>
                    <button
                      type="button"
                      onClick={() => setRushOrder((v) => !v)}
                      aria-pressed={rushOrder}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-sm border text-left transition-colors ${
                        rushOrder
                          ? "border-foreground bg-foreground text-background"
                          : "border-border hover:border-foreground/40"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Zap className="size-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            加急制作
                          </span>
                          <span
                            className={`block text-[11px] mt-0.5 ${
                              rushOrder
                                ? "text-background/70"
                                : "text-muted-foreground"
                            }`}
                          >
                            加{" "}
                            {formatCents(
                              PRICING_CONSTANTS.RUSH_ORDER_FEE_CENTS
                            )}
                            ,发货天数减半
                          </span>
                        </span>
                      </span>
                      <span
                        className={`text-[11px] px-2 py-1 rounded-full shrink-0 ${
                          rushOrder
                            ? "bg-background/20"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {rushOrder ? "已选" : "选"}
                      </span>
                    </button>
                  </div>
                </div>
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
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">产品</dt>
                    <dd className="text-right">{product.title}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">尺寸</dt>
                    <dd className="text-right">
                      {formatSizeWithInches(selectedSizeCm)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">材质</dt>
                    <dd className="text-right">
                      {
                        product.materials.find(
                          (m) => m.id === selectedMaterialId
                        )?.name
                      }
                    </dd>
                  </div>
                  {selectedAccessories.map(({ group, variant }) => (
                    <div
                      key={variant.id}
                      className="flex justify-between gap-4"
                    >
                      <dt className="text-muted-foreground">{group.name}</dt>
                      <dd className="text-right">{variant.name}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">AI 风格</dt>
                    <dd className="text-right">{aiStyle?.name}</dd>
                  </div>
                  {engraving && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">刻字</dt>
                      <dd className="text-right">&ldquo;{engraving}&rdquo;</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">发货</dt>
                    <dd className="text-right">
                      {rushOrder ? "加急(发货天数减半)" : "标准"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">数量</dt>
                    <dd className="text-right">{qty}</dd>
                  </div>
                </dl>

                {pricing && (
                  <div className="border-t pt-3 space-y-1.5">
                    {/* 加选项的费用单独列出来 —— 尺寸加价按用户要求不在
                        规格屏展示,但配件 / 刻字 / 加急是用户自己点的,
                        钱花在哪儿得说清楚 */}
                    {pricing.breakdown.aiStyleCents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">AI 风格</span>
                        <span>
                          +{formatCents(pricing.breakdown.aiStyleCents)}
                        </span>
                      </div>
                    )}
                    {pricing.breakdown.accessoryCents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">配件</span>
                        <span>
                          +{formatCents(pricing.breakdown.accessoryCents)}
                        </span>
                      </div>
                    )}
                    {pricing.breakdown.engravingFeeCents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">刻字</span>
                        <span>
                          +{formatCents(pricing.breakdown.engravingFeeCents)}
                        </span>
                      </div>
                    )}
                    {pricing.breakdown.rushOrderCents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">加急</span>
                        <span>
                          +{formatCents(pricing.breakdown.rushOrderCents)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">单价</span>
                      <span>{formatCents(pricing.unitPriceCents)}</span>
                    </div>
                    {pricing.breakdown.quantityTierDiscountCents > 0 && (
                      <div className="flex justify-between text-sm text-accent">
                        <span>数量折扣</span>
                        <span>
                          -
                          {formatCents(
                            pricing.breakdown.quantityTierDiscountCents
                          )}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-medium pt-1.5 border-t">
                      <span>合计</span>
                      <span>{formatCents(pricing.totalPriceCents)}</span>
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
                  disabled={
                    addLineItem.isPending ||
                    !pricing ||
                    pricingLoading ||
                    pricingStale
                  }
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

        {/* 底部固定条 —— 第 2 步:尺寸和风格选完,一次性提交 */}
        {phase === "style" && (
          <div className="shrink-0 border-t bg-background/95 backdrop-blur px-5 sm:px-6 py-3">
            <div className="mx-auto max-w-4xl flex items-center gap-4 flex-wrap">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {hasPreview && !styleStale
                  ? "预览已生成,风格没变 —— 直接继续,不用再等一次 AI。"
                  : aiStyle?.id === "ai_original"
                    ? "保留原图,不跑 AI,生成几乎不耗时。"
                    : `生成预览大约需要 ${aiStyle?.estimatedLatencySec ?? 30} 秒。`}
              </p>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {formatSizeWithInches(selectedSizeCm)} · {aiStyle?.name}
                </span>
                <Button
                  size="lg"
                  onClick={handleStyleCta}
                  disabled={isTransforming || !aiStyle}
                  className="rounded-full px-7"
                  type="button"
                >
                  {isTransforming ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      生成中...
                    </>
                  ) : hasPreview && !styleStale ? (
                    "继续"
                  ) : hasPreview ? (
                    <>
                      <RefreshCw className="size-4 mr-2" />
                      重新生成预览
                    </>
                  ) : (
                    <>
                      <Wand2 className="size-4 mr-2" />
                      生成预览
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 底部固定结算条 —— 只在规格这步,规格区独立滚动 */}
        {phase === "configure" && (
          <div className="shrink-0 border-t bg-background/95 backdrop-blur px-5 sm:px-6 py-3">
            <div className="mx-auto max-w-4xl flex items-center gap-4 flex-wrap">
              {/* 数量 */}
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  数量
                </span>
                <div className="flex items-center border rounded-full">
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
                  <span className="text-[11px] text-accent">
                    {qty >= 50 ? "20% off" : "10% off"}
                  </span>
                )}
              </div>

              {/* 价格 + CTA */}
              <div className="ml-auto flex items-end gap-5">
                <div className="text-right">
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
                    <p className="font-serif text-xl leading-none mt-1">
                      {formatCents(pricing.unitPriceCents)}
                    </p>
                  ) : null}
                </div>
                {pricing && qty > 1 && (
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      合计
                    </p>
                    <p className="font-serif text-xl leading-none mt-1">
                      {formatCents(pricing.totalPriceCents)}
                    </p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    预计发货
                  </p>
                  <p className="text-sm leading-none mt-1.5 whitespace-nowrap">
                    {pricing?.estimatedShipDays ?? product.leadTimeDays} 天
                  </p>
                </div>
                <Button
                  size="lg"
                  onClick={() => setPhase("review")}
                  disabled={!pricing || pricingLoading || pricingStale}
                  className="rounded-full px-7"
                  type="button"
                >
                  下一步:确认
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
