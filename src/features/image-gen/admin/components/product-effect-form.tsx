"use client";

/**
 * 产品效果表单（编辑/新建共用）
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）
 * - shadcn Card → 内联 div
 * - shadcn Badge/Button/Checkbox/Input/Label/Select/Textarea → antd
 * - sonner toast → antd App.useApp().message
 */

import {
  App,
  Badge,
  Button,
  Checkbox,
  Form,
  Input,
  Select,
  Switch,
} from "antd";
import { History, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { listTemplatesAction } from "@/features/gpt-image/actions/orders";
import {
  ACCESSORIES,
  LEATHER_COLORS,
  PRODUCT_TYPES,
  type ProductCapabilities,
  type ProductType,
} from "@/features/gpt-image/lib/product-catalog";
import {
  addProductEffectVersionAction,
  createProductEffectAdminAction,
  listProductLinesAdminAction,
  listPromptTemplatePricesAction,
  updateProductEffectAdminAction,
  updatePromptTemplatePricesAction,
} from "@/features/image-gen/admin/actions";
import { IMAGE_MODEL_LIST } from "@/features/image-gen/lib/image-models/types";
import type {
  ProductEffect,
  ProductLine,
  PromptVariable,
} from "@/features/image-gen/lib/product-effect-types";
import {
  PROMPT_SCENE_LABELS,
  type PromptScene,
} from "@/features/image-gen/lib/product-effect-types";
import { MOCK_PRODUCT_LINES } from "@/features/image-gen/lib/product-lines-mock";
import { cn } from "@/lib/utils";

interface ProductEffectFormProps {
  initialData?: ProductEffect;
  /**
   * 保存成功回调；不传则默认跳回列表页
   */
  onSaved?: () => void;
}

function generateMaskId(): string {
  return `mask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ProductEffectForm({
  initialData,
  onSaved,
}: ProductEffectFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;
  const { message } = App.useApp();

  const [maskId, setMaskId] = useState(initialData?.maskId ?? generateMaskId());
  const [name, setName] = useState(initialData?.name ?? "");
  const [category, setCategory] = useState(initialData?.category ?? "其他");
  const [description, setDescription] = useState(
    initialData?.description ?? ""
  );
  const [previewUrl, setPreviewUrl] = useState(initialData?.previewUrl ?? "");
  const [prompt, setPrompt] = useState(initialData?.prompt ?? "");
  const [model, setModel] = useState(initialData?.model ?? "");
  const [scene, setScene] = useState<PromptScene>(
    initialData?.scene ?? "generate_2d"
  );
  const [style, setStyle] = useState(initialData?.config?.style ?? "custom");
  const [color, setColor] = useState(initialData?.config?.color ?? "");
  const [material, setMaterial] = useState(initialData?.config?.material ?? "");
  const [price, setPrice] = useState(initialData?.price ?? 0);
  const [status, setStatus] = useState<"active" | "inactive">(
    initialData?.status ?? "active"
  );
  // 2026-09-10：产品型号（关联 PRODUCT_TYPES 字典）。选了之后会在表单底部展示
  // 该型号的尺寸 + 配件预览，让 admin 配置时看到「/image-gen 弹出的可选规格」。
  const [productTypeCode, setProductTypeCode] = useState<string | null>(
    initialData?.productTypeCode ?? null
  );
  const productType: ProductType | null = productTypeCode
    ? (PRODUCT_TYPES.find((t) => t.code === productTypeCode) ?? null)
    : null;
  // 2026-09-10：可配置尺寸 + 配件子集（null = 字典全量；非空数组 = 仅这些）
  const [allowedSizes, setAllowedSizes] = useState<string[]>(
    initialData?.allowedSizes ?? []
  );
  const [allowedAccessories, setAllowedAccessories] = useState<string[]>(
    initialData?.allowedAccessories ?? []
  );
  // 2026-09-10：模板级 capability 覆盖（LB 皮革徽章 4 个 flag）。
  // 存的是"用户改过的 override"——空对象 {} 表示 admin 没动，序列化时
  // 落 null（让 SpecModal 沿用 catalog 默认）。
  const [allowedCapabilities, setAllowedCapabilities] = useState<
    Partial<ProductCapabilities>
  >(initialData?.allowedCapabilities ?? {});
  // 2026-09-10：皮革颜色子集（LEATHER_COLORS 全集；勾选 = 子集）
  const [allowedColors, setAllowedColors] = useState<string[]>(
    initialData?.allowedColors ?? []
  );
  // 2026-09-10：切换产品型号时清空子集（避免上一个型号的尺寸/配件 ID 残留
  // 到新型号字典里导致非法 chip；LB flag 同样清掉避免老型号标志错误应用）。
  // 新建模式下有效；编辑模式初次 mount 时不会触发（state 已被 initialData
  // 初始化为同值）。
  useEffect(() => {
    setAllowedSizes([]);
    setAllowedAccessories([]);
    setAllowedCapabilities({});
    setAllowedColors([]);
  }, [productTypeCode]);
  const [variables, setVariables] = useState<PromptVariable[]>(
    initialData?.variables ?? []
  );
  const [productLineIds, setProductLineIds] = useState<string[]>(
    initialData?.productLineIds ?? []
  );
  // 2026-09-10：产品线数据源（从 product_line 表读，替代 MOCK_PRODUCT_LINES）。
  // 加载失败/未挂载时回退 MOCK，确保 dev 无 DB 也不报错。
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  // 2026-09-10：引用 prompt_template.id（生成时优先用 promptTemplate.prompt）。
  // 2026-09-12：改为必填 —— 没绑的话 /image-gen demo 下单会撞「模板不存在或已停用」
  // （submit-image-gen-demo 直接拿 maskId 查 promptTemplate 表，admin 手工录入
  // 没绑的行查不到）。新建模式下默认空串（让用户必须选）；编辑模式沿用旧值。
  const [promptTemplateId, setPromptTemplateId] = useState<string>(
    initialData?.promptTemplateId ?? ""
  );
  // promptTemplate 下拉选项（id + name + productTypeCode 三列）
  const [promptTemplateOptions, setPromptTemplateOptions] = useState<
    Array<{ id: string; name: string; productTypeCode: string | null }>
  >([]);

  // 2026-09-12：按规格定价（basePrice + Σ matching rule.delta）。
  // 价格规则挂在 promptTemplate 上（prompt_template_price），admin 编辑
  // productEffect 时同时维护绑定模板的规则。priceRules 用 record 是因为
  // 同一 specKey 唯一，每行直接 specKey 索引；保存时 list<PriceRule> 输出。
  // 加载时机：mount 时若 initialData.promptTemplateId 有值；切换 promptTemplateId 时。
  const [priceRules, setPriceRules] = useState<
    Record<string, { priceDelta: number; label: string }>
  >({});
  const [basePriceSnapshot, setBasePriceSnapshot] = useState<number>(0);
  const [pricesLoaded, setPricesLoaded] = useState(false);

  /**
   * 按 specKey 拼当前规则 delta（默认 0）。
   */
  const getDelta = (specKey: string): number =>
    priceRules[specKey]?.priceDelta ?? 0;

  /**
   * 更新某 specKey 的 delta（label 保留，admin 没改 label 时不丢）。
   */
  const setDelta = (specKey: string, delta: number) => {
    setPriceRules((prev) => ({
      ...prev,
      [specKey]: {
        priceDelta: delta,
        label: prev[specKey]?.label ?? "",
      },
    }));
  };

  // 加载产品线 + promptTemplate 列表（mount 一次）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listProductLinesAdminAction();
        if (!cancelled && res?.data?.lines) {
          setProductLines(res.data.lines);
        }
      } catch {
        // 静默降级：用 MOCK_PRODUCT_LINES 兜底
        if (!cancelled) setProductLines([]);
      }
      try {
        const res = await listTemplatesAction({});
        if (!cancelled && res?.data?.templates) {
          setPromptTemplateOptions(
            res.data.templates.map(
              (t: {
                id: string;
                name: string;
                productTypeCode?: string | null;
              }) => ({
                id: t.id,
                name: t.name,
                productTypeCode: t.productTypeCode ?? null,
              })
            )
          );
        }
      } catch {
        if (!cancelled) setPromptTemplateOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2026-09-12：按 promptTemplateId 加载 / 刷新价格规则。
  // - initialData.promptTemplateId mount 时回填
  // - 用户切换 promptTemplateId 时重新加载（防交叉污染）
  // - 新建模式下 promptTemplateId 为空 → 不加载（用户先选模板后才有规则）
  useEffect(() => {
    if (!promptTemplateId) {
      setPriceRules({});
      setBasePriceSnapshot(0);
      setPricesLoaded(false);
      return;
    }
    let cancelled = false;
    setPricesLoaded(false);
    (async () => {
      try {
        const res = await listPromptTemplatePricesAction({
          templateId: promptTemplateId,
        });
        if (cancelled) return;
        const rules = res?.data?.rules ?? [];
        const next: Record<string, { priceDelta: number; label: string }> = {};
        for (const r of rules) {
          next[r.specKey] = { priceDelta: r.priceDelta, label: r.label };
        }
        setPriceRules(next);
        setBasePriceSnapshot(res?.data?.basePrice ?? 0);
      } catch {
        // 加载失败保留空规则，保存时会写空集（清空模板所有规则 → 退回基础价）
        if (!cancelled) {
          setPriceRules({});
          setBasePriceSnapshot(0);
        }
      } finally {
        if (!cancelled) setPricesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [promptTemplateId]);

  const versions = initialData?.versions ?? [];
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [newVersionNote, setNewVersionNote] = useState("");

  const { executeAsync: createEffectAsync, isPending: isCreating } = useAction(
    createProductEffectAdminAction
  );

  const { executeAsync: updateEffectAsync, isPending: isUpdating } = useAction(
    updateProductEffectAdminAction
  );

  // 2026-09-12：价格规则独立保存（挂在 promptTemplate 上，与 productEffect 表分离）。
  // 同样串行 await；失败抛错让 handleSubmit 兜底 toast。
  const { executeAsync: updatePricesAsync, isPending: isUpdatingPrices } =
    useAction(updatePromptTemplatePricesAction);

  const isPending = isCreating || isUpdating || isUpdatingPrices;

  // 切换产品线选中
  const toggleProductLine = (id: string) => {
    setProductLineIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // 新增版本（编辑时）：立即把当前 prompt 存为新版本并应用为新 prompt
  const { execute: addVersion, isPending: isAddingVersion } = useAction(
    addProductEffectVersionAction,
    {
      onSuccess: () => {
        setNewVersionLabel("");
        setNewVersionNote("");
        message.success("已新增版本");
        // 刷新当前编辑数据
        if (onSaved) {
          onSaved();
        } else {
          router.refresh();
        }
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "新增版本失败");
      },
    }
  );

  const handleAddVersion = () => {
    if (!newVersionLabel.trim()) {
      message.error("请输入版本号");
      return;
    }
    addVersion({
      maskId,
      version: newVersionLabel,
      content: prompt,
      ...(newVersionNote ? { note: newVersionNote } : {}),
    });
  };

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) {
      message.error("名称和提示词必填");
      return;
    }
    // 2026-09-12：强制要求绑定 promptTemplate，否则 /image-gen demo 下单会撞
    // 「模板不存在或已停用」（submit-image-gen-demo 用 maskId 查 promptTemplate 表）。
    if (!promptTemplateId) {
      message.error("请选择一个提示词模板（必填）");
      return;
    }

    const payload = {
      maskId,
      name,
      category,
      description,
      previewUrl,
      prompt,
      model: model || null,
      scene,
      config: {
        style: style || "custom",
        color: color || undefined,
        material: material || undefined,
      },
      price,
      status,
      variables,
      productLineIds,
      versions,
      author: initialData?.author ?? "admin",
      productTypeCode: productTypeCode ?? null,
      // 2026-09-10：可配置尺寸 + 配件子集；空数组 → null（不限制 = 字典全量）
      allowedSizes: allowedSizes.length > 0 ? allowedSizes : null,
      allowedAccessories:
        allowedAccessories.length > 0 ? allowedAccessories : null,
      // 2026-09-10：模板级 capability 覆盖；空对象 → null（继承 catalog 默认）
      // only-send-keys-with-explicit-override：用 Object.keys 过滤掉未动的 key，
      // 避免把 catalog 默认的 false 也"覆盖"成 false 造成歧义。
      allowedCapabilities:
        Object.keys(allowedCapabilities).length > 0
          ? allowedCapabilities
          : null,
      // 2026-09-10：皮革颜色子集；空数组 → null（LEATHER_COLORS 全展示）
      allowedColors: allowedColors.length > 0 ? allowedColors : null,
      // 2026-09-10：引用 prompt_template.id
      // 2026-09-12：改为必填（已在校验拦截）；传 string 给 server schema
      promptTemplateId,
    };

    // 2026-09-12：价格规则 list（specKey + delta + label）。
    // - 只存非 0 的 delta 进 list（DB 端 price_delta 默认 0，省点行）
    // - 全 0 时 rules=[]，updatePromptTemplatePrices 会整体清空该模板规则
    // - admin 在 UI 没改的 specKey（priceRules 里没记录）也按 0 处理，不写入
    const rules = Object.entries(priceRules)
      .filter(([, v]) => v.priceDelta !== 0 || v.label.trim() !== "")
      .map(([specKey, v]) => ({
        specKey,
        priceDelta: v.priceDelta,
        label: v.label,
      }));

    try {
      // 1. productEffect 写入
      if (isEdit) {
        await updateEffectAsync({ maskId, updates: payload });
      } else {
        await createEffectAsync(payload);
      }
      // 2. promptTemplate 价格规则写入（独立表，promptTemplateId 已必填）
      await updatePricesAsync({ templateId: promptTemplateId, rules });
      message.success(isEdit ? "更新成功" : "创建成功");
      if (onSaved) {
        onSaved();
      } else {
        router.push("/admin/product-effects");
      }
    } catch (err) {
      // next-safe-action 把 serverError 挂在 error.serverError 上；
      // 这里 err 是 Action 错误对象（含 .serverError），提取可读消息
      const msg =
        (err as { serverError?: string })?.serverError ??
        (err instanceof Error ? err.message : String(err));
      message.error(msg);
    }
  };

  const addVariable = () => {
    setVariables((prev) => [
      ...prev,
      {
        key: `var${prev.length + 1}`,
        label: `变量 ${prev.length + 1}`,
        description: "",
        defaultValue: "",
        required: false,
        options: [],
      },
    ]);
  };

  const updateVariable = (
    index: number,
    field: keyof PromptVariable,
    value: string | boolean | string[]
  ) => {
    setVariables((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  };

  const removeVariable = (index: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Form layout="vertical" className="max-w-3xl">
      <div className="grid grid-cols-2 gap-4">
        <Form.Item label="ID（唯一标识）">
          <Input
            value={maskId}
            onChange={(e) => setMaskId(e.target.value)}
            disabled={isEdit}
          />
        </Form.Item>
        <Form.Item label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Form.Item label="分类">
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </Form.Item>
        <Form.Item label="状态">
          <Select
            value={status}
            onChange={(v) => setStatus(v)}
            options={[
              { value: "active", label: "上架" },
              { value: "inactive", label: "下架" },
            ]}
          />
        </Form.Item>
      </div>

      <Form.Item label="描述">
        <Input.TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </Form.Item>

      <div className="grid grid-cols-2 gap-4">
        <Form.Item label="预览图 URL">
          <Input
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="https://..."
          />
        </Form.Item>
        <Form.Item label="价格（分）">
          <Input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </Form.Item>
      </div>

      <Form.Item label="指定模型（可选）">
        <Select
          value={model === "" ? "__none__" : model}
          onChange={(v) => setModel(v === "__none__" ? "" : v)}
          options={[
            { value: "__none__", label: "不指定" },
            ...IMAGE_MODEL_LIST.filter((m) => m.status === "active").map(
              (m) => ({
                value: m.id,
                label: m.name,
              })
            ),
          ]}
          placeholder="不指定"
        />
      </Form.Item>

      {/* 2026-09-10：产品型号绑定。/image-gen demo 流选了模板后弹 SpecModal，
          按 PRODUCT_TYPES 字典渲染该型号的尺寸 + 配件 + 刻字能力。null 表示老
          ToC 模板（无规格，spec 全 null）。 */}
      <Form.Item
        label={
          <span>
            产品型号
            <span className="ml-1 text-xs text-muted-foreground">
              （/image-gen 弹规格窗时的可选项）
            </span>
          </span>
        }
      >
        <Select
          value={productTypeCode ?? "__none__"}
          onChange={(v) => setProductTypeCode(v === "__none__" ? null : v)}
          options={[
            { value: "__none__", label: "不指定（老 ToC 模板）" },
            ...PRODUCT_TYPES.map((t) => ({
              value: t.code,
              label: `${t.code} · ${t.name}`,
            })),
          ]}
          placeholder="选择产品型号"
        />
      </Form.Item>

      {/* 选完型号后展示字典里的可选项预览，让 admin 确认配置无误 */}
      {productType && (
        <div className="rounded-lg border bg-violet-500/5 px-4 py-3 space-y-1.5">
          <div className="text-sm font-medium flex items-center gap-2">
            <Badge color="purple">{productType.code}</Badge>
            <span>{productType.name}</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              可选尺寸：
              {productType.sizes.length > 0 ? (
                productType.sizes.map((s) => (
                  <Badge key={s} className="ml-1">
                    {s}cm
                  </Badge>
                ))
              ) : (
                <span className="ml-1 text-muted-foreground">无</span>
              )}
            </div>
            <div>
              可选配件：
              {productType.accessories.length > 0 ? (
                productType.accessories.map((a) => {
                  const acc = ACCESSORIES.find((x) => x.code === a);
                  return (
                    <Badge key={a} className="ml-1">
                      {acc?.name ?? a}
                    </Badge>
                  );
                })
              ) : (
                <span className="ml-1 text-muted-foreground">无</span>
              )}
            </div>
            <div>
              刻字能力：
              <Badge
                color={
                  productType.capabilities.canEngrave ? "green" : "default"
                }
                className="ml-1"
              >
                {productType.capabilities.canEngrave ? "支持" : "不支持"}
              </Badge>
            </div>
          </div>
        </div>
      )}

      {/* 2026-09-10：可配置尺寸 + 配件子集（chip 多选）。
         - 仅在选了产品型号时显示，chip 来源于该型号字典
         - 默认空数组 = 字典全量（SpecModal 全部展示）；勾选子集 = 仅渲染这些
         - 改产品型号时自动清空避免无效残留 */}
      {productType && (
        <div className="rounded-lg border bg-amber-500/5 px-4 py-3 space-y-3">
          <div className="text-sm font-medium">
            可选规格子集（覆盖字典默认）
          </div>
          <div className="text-xs text-muted-foreground">
            不勾选 = 该模板在 /image-gen SpecModal
            展示字典全量；勾选后只展示勾中的子集。
          </div>

          {/* 尺寸 chips */}
          {productType.sizes.length > 0 && (
            <div>
              <div className="text-xs font-medium mb-1.5">尺寸</div>
              <div className="flex flex-wrap gap-2">
                {productType.sizes.map((s) => {
                  const checked = allowedSizes.includes(s);
                  return (
                    <label
                      key={s}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-2.5 py-1 cursor-pointer text-xs transition-colors",
                        checked
                          ? "bg-violet-500/15 border-violet-500/50 text-violet-700 dark:text-violet-300"
                          : "bg-background hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={() =>
                          setAllowedSizes((prev) =>
                            prev.includes(s)
                              ? prev.filter((x) => x !== s)
                              : [...prev, s]
                          )
                        }
                      />
                      {s}cm
                    </label>
                  );
                })}
              </div>
              {allowedSizes.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  已选 {allowedSizes.length} / {productType.sizes.length} 个
                </div>
              )}
            </div>
          )}

          {/* 配件 chips */}
          {productType.accessories.length > 0 && (
            <div>
              <div className="text-xs font-medium mb-1.5">配件</div>
              <div className="flex flex-wrap gap-2">
                {productType.accessories.map((a) => {
                  const acc = ACCESSORIES.find((x) => x.code === a);
                  const checked = allowedAccessories.includes(a);
                  return (
                    <label
                      key={a}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-2.5 py-1 cursor-pointer text-xs transition-colors",
                        checked
                          ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
                          : "bg-background hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={() =>
                          setAllowedAccessories((prev) =>
                            prev.includes(a)
                              ? prev.filter((x) => x !== a)
                              : [...prev, a]
                          )
                        }
                      />
                      {acc?.name ?? a}
                    </label>
                  );
                })}
              </div>
              {allowedAccessories.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  已选 {allowedAccessories.length} /{" "}
                  {productType.accessories.length} 个
                </div>
              )}
            </div>
          )}

          {/* 2026-09-12：皮革色 chips（从原「加工能力与颜色」段挪来，归到规格段）。
             - 仅当 catalog 有 canLeatherColor=true 时显示
             - 勾选 = 子集；空 = LEATHER_COLORS 全集 */}
          {productType.capabilities.canLeatherColor && (
            <div>
              <div className="text-xs font-medium mb-1.5">皮革颜色</div>
              <div className="text-[10px] text-muted-foreground mb-2">
                不勾选 = LEATHER_COLORS 全部展示；勾选后只展示勾中的颜色子集。
              </div>
              <div className="flex flex-wrap gap-2">
                {LEATHER_COLORS.map((c) => {
                  const checked = allowedColors.includes(c.code);
                  return (
                    <label
                      key={c.code}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border pl-1 pr-2.5 py-1 cursor-pointer text-xs transition-colors",
                        checked
                          ? "bg-amber-500/15 border-amber-500/50 text-amber-700"
                          : "bg-background hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={() =>
                          setAllowedColors((prev) =>
                            prev.includes(c.code)
                              ? prev.filter((x) => x !== c.code)
                              : [...prev, c.code]
                          )
                        }
                      />
                      <span
                        aria-hidden
                        className="h-3.5 w-3.5 rounded-full border"
                        style={{ backgroundColor: c.swatch }}
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
              {allowedColors.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  已选 {allowedColors.length} / {LEATHER_COLORS.length} 个
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2026-09-12：定制能力（覆盖字典默认，仅 LB 型号可用）
         - 2026-09-12 重构：颜色 / 保护套（实物外露 / PVC 保护）从这一段挪出去，
           归到「规格」段（与 SpecModal 端规格字段分类对齐）。
         - 只剩 2 个 capability Switch：备注 + 订单来源平台（capability-gated）。
         - override 语义：admin 勾选表示 override catalog 默认；不勾 = 沿用 catalog
         - canEngrave 不展示（沿用 catalog，和现有刻字字段绑定避免歧义）
         - 仅在选了产品型号时显示；切型号时自动清空 */}
      {productType && (
        <div className="rounded-lg border bg-emerald-500/5 px-4 py-3 space-y-3">
          <div className="text-sm font-medium">定制能力（覆盖字典默认）</div>
          <div className="text-xs text-muted-foreground">
            不勾 = /image-gen SpecModal
            展示字典默认能力；勾选后只展示勾中的能力。已存在的订单不受影响。
          </div>

          {/* 2 个 capability Switch（2026-09-12：去掉 canLeatherColor / canLeatherExposed / canPvcProtection，
              三者已挪到「规格」段「保护套类型」段） */}
          <div className="space-y-2">
            {(
              [
                ["canHaveRemarks", "备注"],
                ["canPlatform", "订单来源平台"],
              ] as Array<[keyof ProductCapabilities, string]>
            ).map(([key, label]) => {
              const catalogDefault = productType.capabilities[key];
              const overrideValue = allowedCapabilities[key];
              const effective = overrideValue ?? catalogDefault;
              const isOverride =
                overrideValue !== undefined && overrideValue !== catalogDefault;
              return (
                <label
                  key={key}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-2 cursor-pointer text-xs transition-colors",
                    effective
                      ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-700"
                      : "bg-background hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium">{label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      字典默认：
                      {catalogDefault ? "✓" : "✗"}
                    </span>
                    {isOverride && (
                      <Badge color="default" className="!text-[10px]">
                        已覆盖
                      </Badge>
                    )}
                  </div>
                  <Switch
                    checked={effective}
                    onChange={(checked) =>
                      setAllowedCapabilities((prev) => ({
                        ...prev,
                        [key]: checked,
                      }))
                    }
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 2026-09-12：保护套类型（独立段，从原「加工能力与颜色」段拆出）
         - 与 SpecModal 端「保护套类型」段同名对齐：实物外露 / PVC 保护
         - 2 个 capability Switch：admin 决定这个模板允不允许下这 2 种保护套
         - override 语义：admin 勾选表示 override catalog 默认；不勾 = 沿用 catalog
         - 仅在选了产品型号 + catalog 有 canLeatherExposed / canPvcProtection 之一时才显示
         - canLeatherExposed + canPvcProtection 互斥：admin 应只勾一个（数据库列是两个 boolean，
           UI 不强行互斥；提交后 server action submit-image-gen-demo 会挡二次校验） */}
      {productType &&
        (productType.capabilities.canLeatherExposed ||
          productType.capabilities.canPvcProtection) && (
          <div className="rounded-lg border bg-violet-500/5 px-4 py-3 space-y-3">
            <div className="text-sm font-medium">保护套类型</div>
            <div className="text-xs text-muted-foreground">
              勾选 = 该模板在 /image-gen SpecModal
              展示对应保护套选项；不勾 = 沿用产品型号字典默认。
            </div>

            <div className="space-y-2">
              {(
                [
                  ["canLeatherExposed", "实物外露"],
                  ["canPvcProtection", "PVC 保护"],
                ] as Array<[keyof ProductCapabilities, string]>
              ).map(([key, label]) => {
                const catalogDefault = productType.capabilities[key];
                const overrideValue = allowedCapabilities[key];
                const effective = overrideValue ?? catalogDefault;
                const isOverride =
                  overrideValue !== undefined &&
                  overrideValue !== catalogDefault;
                return (
                  <label
                    key={key}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md border px-3 py-2 cursor-pointer text-xs transition-colors",
                      effective
                        ? "bg-violet-500/15 border-violet-500/50 text-violet-700"
                        : "bg-background hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium">{label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        字典默认：
                        {catalogDefault ? "✓" : "✗"}
                      </span>
                      {isOverride && (
                        <Badge color="default" className="!text-[10px]">
                          已覆盖
                        </Badge>
                      )}
                    </div>
                    <Switch
                      checked={effective}
                      onChange={(checked) =>
                        setAllowedCapabilities((prev) => ({
                          ...prev,
                          [key]: checked,
                        }))
                      }
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}

      {/* 2026-09-12：定价（对账核心字段，按规格加价）
         - 挂在 promptTemplate 上（prompt_template_price 表），与 productEffect 表独立
         - 本单总扣 = basePrice（promptTemplate.price） + Σ(matching rule.delta)
         - 4 个子区域（按 specKey 维度）：尺寸 / 配件 / 皮革色 / 保护套
         - 始终展示字典全量（4cm/6cm/8cm/11cm + leather/pvc/bracket + 5 色 +
           exposed/pvc），与 allowed 子集解耦：admin 即使在「规格」段没勾某个
           尺寸，也能在这里预填 delta（运行时用户选不到就不命中 = 不影响）
         - 仅在选了 promptTemplateId 时显示（无模板的 productEffect 无意义）*/}
      {promptTemplateId && (
        <div className="rounded-lg border bg-rose-500/5 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">定价（按规格加价）</div>
            <div className="text-xs text-muted-foreground">
              基础价 {basePriceSnapshot} 积分 · 当前加价合计{" "}
              {Object.values(priceRules).reduce(
                (sum, r) => sum + r.priceDelta,
                0
              )}{" "}
              · 预览{" "}
              <span className="font-mono font-semibold text-rose-700">
                {basePriceSnapshot +
                  Object.values(priceRules).reduce(
                    (sum, r) => sum + r.priceDelta,
                    0
                  )}
              </span>{" "}
              积分
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            delta = 该规格命中时的加价（可负）。basePrice 在 promptTemplate
            详情页编辑，本表单只管理加价规则。
          </div>

          {!pricesLoaded ? (
            <div className="text-xs text-muted-foreground py-2">
              正在加载价格规则…
            </div>
          ) : (
            <div className="space-y-3">
              {/* 尺寸子区 */}
              <div>
                <div className="text-xs font-medium mb-1.5">尺寸</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {["4", "6", "8", "11"].map((s) => {
                    const specKey = `size:${s}`;
                    const delta = getDelta(specKey);
                    return (
                      <div
                        key={specKey}
                        className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                      >
                        <span className="text-xs font-mono">{s}cm</span>
                        <Input
                          type="number"
                          size="small"
                          value={delta}
                          onChange={(e) =>
                            setDelta(specKey, Number(e.target.value))
                          }
                          className="!w-20"
                          placeholder="0"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          积分
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 配件子区 */}
              <div>
                <div className="text-xs font-medium mb-1.5">配件</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {ACCESSORIES.map((a) => {
                    const specKey = `accessory:${a.code}`;
                    const delta = getDelta(specKey);
                    return (
                      <div
                        key={specKey}
                        className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                      >
                        <span className="text-xs">{a.name}</span>
                        <Input
                          type="number"
                          size="small"
                          value={delta}
                          onChange={(e) =>
                            setDelta(specKey, Number(e.target.value))
                          }
                          className="!w-20"
                          placeholder="0"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          积分
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 皮革色子区 */}
              <div>
                <div className="text-xs font-medium mb-1.5">皮革颜色</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {LEATHER_COLORS.map((c) => {
                    const specKey = `leather_color:${c.code}`;
                    const delta = getDelta(specKey);
                    return (
                      <div
                        key={specKey}
                        className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                      >
                        <span
                          aria-hidden
                          className="h-3 w-3 rounded-full border shrink-0"
                          style={{ backgroundColor: c.swatch }}
                        />
                        <span className="text-xs truncate">{c.name}</span>
                        <Input
                          type="number"
                          size="small"
                          value={delta}
                          onChange={(e) =>
                            setDelta(specKey, Number(e.target.value))
                          }
                          className="!w-16"
                          placeholder="0"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 保护套子区（始终展示 2 行，admin 可为未开启的能力预配价格） */}
              <div>
                <div className="text-xs font-medium mb-1.5">保护套类型</div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["protection:exposed", "实物外露"],
                      ["protection:pvc", "PVC 保护"],
                    ] as const
                  ).map(([specKey, label]) => {
                    const delta = getDelta(specKey);
                    return (
                      <div
                        key={specKey}
                        className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                      >
                        <span className="text-xs">{label}</span>
                        <Input
                          type="number"
                          size="small"
                          value={delta}
                          onChange={(e) =>
                            setDelta(specKey, Number(e.target.value))
                          }
                          className="!w-20"
                          placeholder="0"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          积分
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Form.Item label="场景">
        <Select
          value={scene}
          onChange={(v) => setScene(v as PromptScene)}
          options={Object.entries(PROMPT_SCENE_LABELS).map(
            ([value, label]) => ({
              value,
              label,
            })
          )}
        />
      </Form.Item>

      <div className="grid grid-cols-3 gap-4">
        <Form.Item label="风格">
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="custom"
          />
        </Form.Item>
        <Form.Item label="主色调">
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="可选"
          />
        </Form.Item>
        <Form.Item label="材质">
          <Input
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            placeholder="可选"
          />
        </Form.Item>
      </div>

      <Form.Item label="提示词">
        <Input.TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="使用 {{变量名}} 占位符..."
        />
      </Form.Item>

      <div className="space-y-4 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">变量</span>
          <Button
            type="default"
            size="small"
            onClick={addVariable}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            添加变量
          </Button>
        </div>
        {variables.map((variable, index) => (
          <div key={variable.key} className="border rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={variable.key}
                onChange={(e) => updateVariable(index, "key", e.target.value)}
                placeholder="变量名"
              />
              <Input
                value={variable.label}
                onChange={(e) => updateVariable(index, "label", e.target.value)}
                placeholder="标签"
              />
              <Input
                value={variable.defaultValue}
                onChange={(e) =>
                  updateVariable(index, "defaultValue", e.target.value)
                }
                placeholder="默认值"
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={variable.description}
                onChange={(e) =>
                  updateVariable(index, "description", e.target.value)
                }
                placeholder="描述"
                className="flex-1"
              />
              <Button
                type="default"
                size="small"
                danger
                onClick={() => removeVariable(index)}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 2026-09-10：关联 prompt_template（下拉单选）。
         - 2026-09-12：改为必填 —— 不绑的话 /image-gen demo 下单会撞「模板不存在或已停用」
           （submit-image-gen-demo 直接拿 maskId 查 promptTemplate 表）。
           旧 admin 手工录入没绑的行 → 跑 scripts/list-effects-without-template.ts
           看清单，逐个到 /admin/product-effects 编辑页补一个。
         数据源：gpt-image 模块的 listTemplatesAction（含所有 promptTemplate） */}
      <Form.Item
        label={
          <span>
            关联提示词模板
            <span className="ml-1 text-rose-500">*</span>
            <span className="ml-1 text-xs text-muted-foreground">
              （必填，下单时按此 id 写 prompt_order.templateId 外键）
            </span>
          </span>
        }
        required
        {...(!promptTemplateId
          ? ({ validateStatus: "error", help: "请选择一个提示词模板" } as const)
          : {})}
      >
        <Select
          value={promptTemplateId || undefined}
          onChange={(v) => setPromptTemplateId(v ?? "")}
          options={promptTemplateOptions.map((t) => ({
            value: t.id,
            label: `${t.id} · ${t.name}${
              t.productTypeCode ? ` · ${t.productTypeCode}` : ""
            }`,
          }))}
          placeholder="选择 promptTemplate（必选）"
          allowClear={false}
          showSearch
          optionFilterProp="label"
          notFoundContent="暂无 promptTemplate，请先去 /admin/templates 创建"
        />
      </Form.Item>

      {/* 产品线关联（2026-09-10：数据源从 MOCK_PRODUCT_LINES 切到 product_line 表） */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">关联产品线（多选）</span>
          <span className="text-xs text-muted-foreground">
            已选 {productLineIds.length} 个
          </span>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-3 space-y-2">
            {productLines.length === 0 ? (
              // 2026-09-10：DB 无数据时回退 MOCK（dev 环境无 DB 不报错）
              MOCK_PRODUCT_LINES.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无产品线</p>
              ) : (
                <FallbackMockProductLines
                  productLineIds={productLineIds}
                  onToggle={toggleProductLine}
                />
              )
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {productLines.map((pl) => {
                  const checked = productLineIds.includes(pl.productLineId);
                  return (
                    <label
                      key={pl.productLineId}
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-2 cursor-pointer transition-colors",
                        checked
                          ? "bg-violet-500/10 border-violet-500/40"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={() => toggleProductLine(pl.productLineId)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{pl.name}</p>
                        <div className="flex items-center gap-1">
                          <Badge
                            color="default"
                            className="!text-[10px] font-mono"
                          >
                            {pl.productLineId}
                          </Badge>
                          <Badge color="default" className="!text-[10px]">
                            {pl.category}
                          </Badge>
                          {pl.status !== "active" && (
                            <Badge
                              color="default"
                              className="!text-[10px] text-zinc-500"
                            >
                              {pl.status}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 版本历史（编辑模式） */}
      {isEdit && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1">
              <History className="h-3.5 w-3.5" />
              版本历史（{versions.length}）
            </span>
          </div>
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <div className="p-3 space-y-3">
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无历史版本</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {versions.map((ver) => (
                    <div
                      key={ver.version}
                      className="flex items-center justify-between rounded-md border p-2 text-xs bg-muted/30"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          color="default"
                          className="font-mono !text-[10px]"
                        >
                          {ver.version}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(ver.createdAt).toLocaleString("zh-CN")}
                        </span>
                        {ver.note && (
                          <span className="text-muted-foreground truncate">
                            · {ver.note}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 新增版本 */}
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  新增版本（将保存当前 prompt 为新版本）
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={newVersionLabel}
                    onChange={(e) => setNewVersionLabel(e.target.value)}
                    placeholder="v1.1.0"
                  />
                  <Input
                    value={newVersionNote}
                    onChange={(e) => setNewVersionNote(e.target.value)}
                    placeholder="备注（可选）"
                  />
                </div>
                <Button
                  type="default"
                  size="small"
                  onClick={handleAddVersion}
                  disabled={isAddingVersion || !newVersionLabel.trim()}
                  loading={isAddingVersion}
                  icon={<Plus className="h-3.5 w-3.5" />}
                >
                  新增版本
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isEdit && initialData && (
        <div className="grid grid-cols-3 gap-4 rounded-lg border p-4 bg-muted/30 mb-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">使用次数</p>
            <p className="font-medium">{initialData.usageCount}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">成功率</p>
            <p className="font-medium">{initialData.successRate}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">平均耗时</p>
            <p className="font-medium">{initialData.avgDuration}ms</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4">
        <Button type="primary" onClick={handleSubmit} loading={isPending}>
          {isPending ? "保存中..." : isEdit ? "更新" : "创建"}
        </Button>
        {onSaved ? null : (
          <Button
            onClick={() => router.push("/admin/product-effects")}
            disabled={isPending}
          >
            取消
          </Button>
        )}
      </div>
    </Form>
  );
}

/**
 * 2026-09-10：MOCK 产品线回退渲染（DB 无数据时兜底）。
 * 独立组件避免主组件渲染逻辑嵌套过深。
 */
function FallbackMockProductLines({
  productLineIds,
  onToggle,
}: {
  productLineIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {MOCK_PRODUCT_LINES.map((pl) => {
        const checked = productLineIds.includes(pl.productLineId);
        return (
          <label
            key={pl.productLineId}
            className={cn(
              "flex items-center gap-2 rounded-md border p-2 cursor-pointer transition-colors",
              checked
                ? "bg-violet-500/10 border-violet-500/40"
                : "hover:bg-muted/50"
            )}
          >
            <Checkbox
              checked={checked}
              onChange={() => onToggle(pl.productLineId)}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{pl.name}</p>
              <div className="flex items-center gap-1">
                <Badge color="default" className="!text-[10px] font-mono">
                  {pl.productLineId}
                </Badge>
                <Badge color="default" className="!text-[10px]">
                  {pl.category}
                </Badge>
                {pl.status === "inactive" && (
                  <Badge color="default" className="!text-[10px] text-zinc-500">
                    下架
                  </Badge>
                )}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
