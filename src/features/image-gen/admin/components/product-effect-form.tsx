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
  updateProductEffectAdminAction,
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
  // null = 不引用，直接用本表单的 prompt 字段
  const [promptTemplateId, setPromptTemplateId] = useState<string | null>(
    initialData?.promptTemplateId ?? null
  );
  // promptTemplate 下拉选项（id + name + productTypeCode 三列）
  const [promptTemplateOptions, setPromptTemplateOptions] = useState<
    Array<{ id: string; name: string; productTypeCode: string | null }>
  >([]);

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

  const versions = initialData?.versions ?? [];
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [newVersionNote, setNewVersionNote] = useState("");

  const { execute: createEffect, isPending: isCreating } = useAction(
    createProductEffectAdminAction,
    {
      onSuccess: () => {
        message.success("创建成功");
        if (onSaved) {
          onSaved();
        } else {
          router.push("/admin/product-effects");
        }
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "创建失败");
      },
    }
  );

  const { execute: updateEffect, isPending: isUpdating } = useAction(
    updateProductEffectAdminAction,
    {
      onSuccess: () => {
        message.success("更新成功");
        if (onSaved) {
          onSaved();
        } else {
          router.push("/admin/product-effects");
        }
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "更新失败");
      },
    }
  );

  const isPending = isCreating || isUpdating;

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

  const handleSubmit = () => {
    if (!name.trim() || !prompt.trim()) {
      message.error("名称和提示词必填");
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
      // 2026-09-10：引用 prompt_template.id（null = 不引用，用本地 prompt 字段）
      promptTemplateId,
    };

    if (isEdit) {
      updateEffect({ maskId, updates: payload });
    } else {
      createEffect(payload);
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
        </div>
      )}

      {/* 2026-09-10：加工能力与颜色（覆盖字典默认，仅对 LB 等 4 个 flag 启用）
         - 4 个 capability Switch：override 语义——打开表示"我要 override 这个 key"
           （默认跟随 catalog 字典）；不勾 = 该 key 不在 override 里，落库时剔除
         - 5 个皮革色 chip：勾选 = 子集；空 = 全集
         - canEngrave 不展示（沿用 catalog，和现有刻字字段绑定避免歧义）
         - 仅在选了产品型号时显示；切型号时自动清空 */}
      {productType && (
        <div className="rounded-lg border bg-emerald-500/5 px-4 py-3 space-y-3">
          <div className="text-sm font-medium">
            加工能力与颜色（覆盖字典默认）
          </div>
          <div className="text-xs text-muted-foreground">
            不勾 = /image-gen SpecModal
            展示字典默认能力；勾选后只展示勾中的能力。已存在的订单不受影响。
          </div>

          {/* 4 个 capability Switch */}
          <div className="space-y-2">
            {(
              [
                ["canLeatherColor", "皮革颜色"],
                ["canLeatherExposed", "皮革外露"],
                ["canPvcProtection", "PVC 保护"],
                ["canHaveRemarks", "备注"],
              ] as Array<[keyof ProductCapabilities, string]>
            ).map(([key, label]) => {
              const catalogDefault = productType.capabilities[key];
              const overrideValue = allowedCapabilities[key];
              // 覆盖后的有效值：admin 没动 → 字典默认；动了 → override
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

          {/* 皮革色 chips（仅当 catalog 有 canLeatherColor=true 时显示） */}
          {productType.capabilities.canLeatherColor && (
            <div className="pt-2 border-t">
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
         - null = 不引用，提交时 promptTemplateId=null → 生成时走本地 prompt 字段
         - 非 null = 生成时优先用 promptTemplate.prompt（fallback 到本地）
         数据源：gpt-image 模块的 listTemplatesAction（含所有 promptTemplate） */}
      <Form.Item
        label={
          <span>
            引用提示词模板
            <span className="ml-1 text-xs text-muted-foreground">
              （生成时优先用模板 prompt，缺失则用本表单 prompt 字段）
            </span>
          </span>
        }
      >
        <Select
          value={promptTemplateId ?? "__none__"}
          onChange={(v) => setPromptTemplateId(v === "__none__" ? null : v)}
          options={[
            { value: "__none__", label: "不引用（直接用本表单 prompt 字段）" },
            ...promptTemplateOptions.map((t) => ({
              value: t.id,
              label: `${t.id} · ${t.name}${
                t.productTypeCode ? ` · ${t.productTypeCode}` : ""
              }`,
            })),
          ]}
          placeholder="选择 promptTemplate"
          allowClear={false}
          showSearch
          optionFilterProp="label"
          notFoundContent="暂无 promptTemplate"
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
