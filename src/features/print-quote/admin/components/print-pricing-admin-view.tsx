"use client";

/**
 * 打印定价后台 —— `/admin/print-pricing`
 *
 * 工作室要能自己管:**克重的计算和计价、材料、计算逻辑**。这一页是那条
 * 路的唯一入口,三块:
 *
 * 1. **当前生效值**(只读卡)—— 先让人看见「现在到底按什么在算」,
 *    再动下面的表单。没配过的部署这里会挂一条横幅:还在走环境变量兜底。
 * 2. **计价设置**(表单)—— 后处理费、支撑加价的**分段规则**、交期三档
 *    比例、支撑几何参数(托底高度 / 底板留边)。
 * 3. **材料库**(表格)—— 多档材料,增删改 + 停用,再指定哪一档当前生效。
 *
 * ## 单位:金额一律「元」,比例界面用「%」
 *
 * - 金额输入框收**元**(4.5 = 4.5 元/g)—— 工作室看的是钱,让人填「450 分」
 *   等于让人自己心算换算,填错一个数量级就是把价定成 100 倍。
 * - **提交时换算成整数分**,服务端和 DB 的口径没动(还是分)—— 换算只发生
 *   在表单这一层,`pricing-actions.ts` 收到的仍然是分。
 * - 交期比例界面用百分比(填 37 = 37%),提交时换算成 0~1 的小数 ——
 *   `delivery-tier.ts` 里的口径就是小数。
 *
 * ## 「页面上显示的加价」= 「服务端收的加价」
 *
 * 比例由服务端给,前端只负责预览。这里预览用的是**同一份**比例值,不是
 * 另抄一份,所以界面上写的 20% 就是服务端按 20% 收。
 *
 * ## 材料编辑**就地展开**,不开弹窗
 *
 * 工作室的口味:配置界面在页面上直接处理,不要弹窗挡住别的内容。
 * 点「编辑」/「新增」,表单就展开在这张卡的下面。
 */

import {
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AlertTriangle,
  Check,
  CircleDot,
  Layers,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  adminCreatePrintMaterialAction,
  adminDeletePrintMaterialAction,
  adminGetPrintPricingAction,
  adminSavePrintPricingAction,
  adminSetPrintPricingMaterialAction,
  adminUpdatePrintMaterialAction,
} from "@/features/print-quote/admin/pricing-actions";
import type {
  PrintMaterialLite,
  PrintPricingOverview,
  PrintPricingSettings,
} from "@/features/print-quote/lib/pricing-settings";
import { formatCents } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 计价设置的表单值 —— 金额是**元**,交期比例是百分比
 *
 * 表单里的金额字段一律叫 `...Yuan...`,不叫 `...Cents...` —— 名字就是
 * 单位,写错名字的东西迟早会被当成另一个单位用(仓库里踩过「差 100 倍」
 * 的坑)。提交时在 `handleSaveConfig` 里换算成整数分。
 */
type ConfigFormValues = {
  modelMaterialId: string | null;
  supportMaterialId: string | null;
  /** 元 */
  varnishFeeYuan: number | null;
  varnishEnabled: boolean;
  supportThreshold: number | null;
  supportTier1Ratio: number | null;
  /** 元/g */
  supportTier1PriceYuanPerGram: number | null;
  /** 元/g */
  supportTier2PriceYuanPerGram: number | null;
  supportEnabled: boolean;
  supportLiftMm: number | null;
  supportBaseMarginMm: number | null;
  /** 百分比(37 = 37%)—— 提交时换算成 0.37 */
  deliveryExpressPercent: number | null;
  deliveryUrgentPercent: number | null;
};

/** 材料行的表单值 —— 金额是**元** */
type MaterialFormValues = {
  code: string;
  name: string;
  kind: "model" | "support";
  density: number | null;
  /** 元/g */
  unitPriceYuanPerGram: number | null;
  isActive: boolean;
  sortOrder: number | null;
};

/* -------------------------------------------------------------------------- */
/*  小工具                                                                      */
/* -------------------------------------------------------------------------- */

/** 分 → 「¥4.50」 —— 服务端 / DB 给的是分,读数时换成人看得懂的元 */
function yuan(cents: number): string {
  return formatCents(cents);
}

/** 元 → 「¥4.50」 —— 表单里已经是元,过一遍 formatCents 保持一个格式化入口 */
function yuanOf(value: number): string {
  return formatCents(yuanToCents(value));
}

/** 分 → 元(填进表单的值) */
function centsToYuan(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

/**
 * 元 → 分(提交给服务端的值)
 *
 * 服务端口径是**整数分**,这里只做单位换算 + 取整。`+ Number.EPSILON`
 * 是为了对付浮点误差:1.005 * 100 在 IEEE754 下是 100.49999999999999,
 * 直接 round 会掉到 100,加一点点再乘就落在 100.5 上,round 到 101。
 */
function yuanToCents(value: number | null | undefined): number {
  return Math.round(((value ?? 0) + Number.EPSILON) * 100);
}

/** 生效设置 → 表单初值(金额从分换成元) */
function toFormValues(settings: PrintPricingSettings): ConfigFormValues {
  return {
    modelMaterialId: settings.modelMaterialId,
    supportMaterialId: settings.supportMaterialId,
    varnishFeeYuan: centsToYuan(settings.varnishFeeCents),
    varnishEnabled: settings.varnishEnabled,
    supportThreshold: settings.supportThreshold,
    supportTier1Ratio: settings.supportTier1Ratio,
    supportTier1PriceYuanPerGram: centsToYuan(
      settings.supportTier1PriceCentsPerGram
    ),
    supportTier2PriceYuanPerGram: centsToYuan(
      settings.supportTier2PriceCentsPerGram
    ),
    supportEnabled: settings.supportEnabled,
    supportLiftMm: settings.supportLiftMm,
    supportBaseMarginMm: settings.supportBaseMarginMm,
    deliveryExpressPercent: round4(settings.deliveryRates.express * 100),
    deliveryUrgentPercent: round4(settings.deliveryRates.urgent * 100),
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 「1:2」这类比例的写法 —— 2 → 「1:2」,1.5 → 「1:1.5」 */
function ratioLabel(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  if (Number.isInteger(ratio)) return `1:${ratio}`;
  return `1:${round4(ratio)}`;
}

/** 错误码 → 人话 */
const ERROR_TEXT: Record<string, string> = {
  TIER1_RATIO_BELOW_THRESHOLD: "第一档上界不能小于自支撑阈值",
  MATERIAL_NOT_FOUND: "找不到这档材料(可能已经被删了)",
  MATERIAL_IN_USE: "这档材料正在生效,先换成别的再停用",
  CODE_DUPLICATE: "标识重复了,换一个新的",
  MIGRATION_MISSING:
    "打印定价的表还不存在 —— 先跑一次迁移脚本(pnpm migrate:apply-print-pricing),再回来保存",
  SAVE_FAILED: "保存失败,看服务端日志",
};

/* -------------------------------------------------------------------------- */
/*  主组件                                                                      */
/* -------------------------------------------------------------------------- */

export function PrintPricingAdminView() {
  const { message } = App.useApp();

  const [overview, setOverview] = useState<PrintPricingOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 材料编辑:null = 没在编辑;`"__new__"` = 新增
  const [editingMaterial, setEditingMaterial] = useState<
    string | "__new__" | null
  >(null);

  const [configForm] = Form.useForm<ConfigFormValues>();
  const [materialForm] = Form.useForm<MaterialFormValues>();

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminGetPrintPricingAction();
      if (res?.data) {
        setOverview(res.data);
        setLoadError(null);
        configForm.setFieldsValue(toFormValues(res.data.settings));
      }
    } catch {
      setLoadError("读取打印定价配置失败,请刷新页面重试");
    }
  }, [configForm]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------------ 写:设置 -- */

  const { execute: saveConfig, isPending: isSaving } = useAction(
    adminSavePrintPricingAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(ERROR_TEXT[data.code] ?? "保存失败");
          return;
        }
        message.success("计价设置已保存,立刻生效");
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "保存失败");
      },
    }
  );

  const handleSaveConfig = async () => {
    let values: ConfigFormValues;
    try {
      values = await configForm.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }

    saveConfig({
      modelMaterialId: values.modelMaterialId ?? null,
      supportMaterialId: values.supportMaterialId ?? null,
      // 表单里是元,服务端要整数分 —— 换算只在这一层发生
      varnishFeeCents: yuanToCents(values.varnishFeeYuan),
      varnishEnabled: values.varnishEnabled,
      supportThreshold: values.supportThreshold ?? 1,
      supportTier1Ratio: values.supportTier1Ratio ?? 2,
      supportTier1PriceCentsPerGram: yuanToCents(
        values.supportTier1PriceYuanPerGram
      ),
      supportTier2PriceCentsPerGram: yuanToCents(
        values.supportTier2PriceYuanPerGram
      ),
      supportEnabled: values.supportEnabled,
      supportLiftMm: values.supportLiftMm ?? 0,
      supportBaseMarginMm: values.supportBaseMarginMm ?? 0,
      // 百分比 → 小数(服务端那边存的就是小数)
      deliveryExpressRate: (values.deliveryExpressPercent ?? 0) / 100,
      deliveryUrgentRate: (values.deliveryUrgentPercent ?? 0) / 100,
    });
  };

  /* ------------------------------------------------------------ 写:材料 -- */

  const { execute: createMaterial, isPending: isCreating } = useAction(
    adminCreatePrintMaterialAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(ERROR_TEXT[data.code] ?? "新增失败");
          return;
        }
        message.success("材料已新增");
        setEditingMaterial(null);
        materialForm.resetFields();
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "新增失败");
      },
    }
  );

  const { execute: updateMaterial, isPending: isUpdating } = useAction(
    adminUpdatePrintMaterialAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(ERROR_TEXT[data.code] ?? "更新失败");
          return;
        }
        message.success("材料已更新,立刻生效");
        setEditingMaterial(null);
        materialForm.resetFields();
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "更新失败");
      },
    }
  );

  const { execute: deactivateMaterial, isPending: isDeactivating } = useAction(
    adminDeletePrintMaterialAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(ERROR_TEXT[data.code] ?? "停用失败");
          return;
        }
        message.success("材料已停用");
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "停用失败");
      },
    }
  );

  const { execute: setCurrentMaterial, isPending: isSetting } = useAction(
    adminSetPrintPricingMaterialAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(ERROR_TEXT[data.code] ?? "设置失败");
          return;
        }
        message.success("已设为当前生效材料");
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "设置失败");
      },
    }
  );

  /* -------------------------------------------------------- 表单:材料 ---- */

  const startCreateMaterial = () => {
    setEditingMaterial("__new__");
    materialForm.setFieldsValue({
      code: "",
      name: "",
      kind: "model",
      density: 1.2,
      // 出厂树脂 4.5 元/g(= 450 分/g)
      unitPriceYuanPerGram: 4.5,
      isActive: true,
      sortOrder: 0,
    });
  };

  const startEditMaterial = (row: PrintMaterialLite) => {
    setEditingMaterial(row.id);
    materialForm.setFieldsValue({
      code: row.code,
      name: row.name,
      kind: row.kind,
      density: row.density,
      unitPriceYuanPerGram: centsToYuan(row.unitPriceCentsPerGram),
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });
  };

  const handleSubmitMaterial = async () => {
    let values: MaterialFormValues;
    try {
      values = await materialForm.validateFields();
    } catch {
      return;
    }

    const payload = {
      code: values.code.trim(),
      name: values.name.trim(),
      kind: values.kind,
      density: values.density ?? 1.2,
      // 支撑材料没有每克单价 —— 它的价走配置行上那条分段规则
      unitPriceCentsPerGram:
        values.kind === "support"
          ? null
          : yuanToCents(values.unitPriceYuanPerGram),
      isActive: values.isActive,
      sortOrder: values.sortOrder ?? 0,
    };

    if (editingMaterial === "__new__") {
      createMaterial(payload);
    } else if (editingMaterial) {
      updateMaterial({ id: editingMaterial, ...payload });
    }
  };

  /* -------------------------------------------------------- 派生数据 ----- */

  const settings = overview?.settings ?? null;
  const materials = overview?.materials ?? [];

  const modelMaterialOptions = useMemo(
    () =>
      materials
        .filter((m) => m.kind === "model")
        .map((m) => ({
          value: m.id,
          label: `${m.name}(${m.density} g/cm³)${m.isActive ? "" : " · 已停用"}`,
        })),
    [materials]
  );

  const supportMaterialOptions = useMemo(
    () =>
      materials
        .filter((m) => m.kind === "support")
        .map((m) => ({
          value: m.id,
          label: `${m.name}(${m.density} g/cm³)${m.isActive ? "" : " · 已停用"}`,
        })),
    [materials]
  );

  // 支撑加价规则的实时预览 —— 改一个数就能看到规则变成什么样
  // (watch 到的值是**元** —— 表单里填的就是元)
  const threshold = Form.useWatch("supportThreshold", configForm);
  const tier1Ratio = Form.useWatch("supportTier1Ratio", configForm);
  const tier1Price = Form.useWatch("supportTier1PriceYuanPerGram", configForm);
  const tier2Price = Form.useWatch("supportTier2PriceYuanPerGram", configForm);

  const rulePreview = useMemo(() => {
    const t = threshold ?? 1;
    const b = Math.max(t, tier1Ratio ?? t);
    return [
      `比例 ≤ ${ratioLabel(t)}:不收`,
      `${ratioLabel(t)} < 比例 ≤ ${ratioLabel(b)}:超出部分 ${yuanOf(tier1Price ?? 0)}/g`,
      `比例 > ${ratioLabel(b)}:再超出部分 ${yuanOf(tier2Price ?? 0)}/g`,
    ];
  }, [threshold, tier1Ratio, tier1Price, tier2Price]);

  /* -------------------------------------------------------- 材料表列 ----- */

  const columns: ColumnsType<PrintMaterialLite> = [
    {
      title: "材料",
      dataIndex: "name",
      key: "name",
      render: (name: string, row) => (
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {row.code}
          </p>
        </div>
      ),
    },
    {
      title: "类别",
      dataIndex: "kind",
      key: "kind",
      width: 100,
      render: (kind: string) => (
        <Tag color={kind === "model" ? "blue" : "purple"}>
          {kind === "model" ? "模型材料" : "支撑材料"}
        </Tag>
      ),
    },
    {
      title: "密度",
      dataIndex: "density",
      key: "density",
      width: 110,
      render: (density: number) => `${density} g/cm³`,
    },
    {
      title: "单价",
      dataIndex: "unitPriceCentsPerGram",
      key: "unitPrice",
      width: 130,
      render: (price: number | null) =>
        price === null ? (
          <span className="text-xs text-muted-foreground">按分段规则</span>
        ) : (
          `${yuan(price)}/g`
        ),
    },
    {
      title: "状态",
      dataIndex: "isActive",
      key: "isActive",
      width: 90,
      render: (isActive: boolean) =>
        isActive ? <Tag color="green">启用</Tag> : <Tag>已停用</Tag>,
    },
    {
      title: "当前生效",
      key: "current",
      width: 200,
      render: (_, row) => {
        const isModel = settings?.modelMaterialId === row.id;
        const isSupport = settings?.supportMaterialId === row.id;
        if (!isModel && !isSupport) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {isModel ? (
              <Tag color="geekblue" icon={<CircleDot className="h-3 w-3" />}>
                模型材料
              </Tag>
            ) : null}
            {isSupport ? (
              <Tag color="purple" icon={<CircleDot className="h-3 w-3" />}>
                支撑材料
              </Tag>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_, row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="small"
            type="text"
            onClick={() => startEditMaterial(row)}
          >
            编辑
          </Button>
          {row.kind === "model" ? (
            <Button
              size="small"
              type="link"
              disabled={
                isSetting ||
                settings?.modelMaterialId === row.id ||
                !row.isActive
              }
              onClick={() =>
                setCurrentMaterial({ role: "model", materialId: row.id })
              }
            >
              设为模型材料
            </Button>
          ) : (
            <Button
              size="small"
              type="link"
              disabled={
                isSetting ||
                settings?.supportMaterialId === row.id ||
                !row.isActive
              }
              onClick={() =>
                setCurrentMaterial({ role: "support", materialId: row.id })
              }
            >
              设为支撑材料
            </Button>
          )}
          {row.isActive ? (
            <Button
              size="small"
              type="text"
              danger
              loading={isDeactivating}
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => deactivateMaterial({ id: row.id })}
            >
              停用
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  /* -------------------------------------------------------- 渲染 --------- */

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        {loadError}
      </div>
    );
  }

  if (!overview || !settings) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <RotateCcw className="h-4 w-4 animate-spin" />
        正在读取打印定价配置…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <SlidersHorizontal className="h-5 w-5 text-violet-600" />
          打印定价
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          克重计算与计价的全部口径 —— 材料、加价规则、交期比例、支撑几何参数。
          工具页和打印单一律跟这里走,访客改不了。
        </p>
      </div>

      {/* ① 当前生效值 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CircleDot className="h-4 w-4 text-emerald-600" />
            当前生效值
          </h3>
          {overview.hasConfigRow ? (
            <Tag color="green">已存进后台配置</Tag>
          ) : (
            <Tag color="orange">还在走环境变量兜底</Tag>
          )}
        </div>

        {overview.readError ? (
          /* 读失败跟「还没存过配置」是两回事 —— 前者得先跑迁移脚本,
             不然后台每个写操作都会撞同一个错。用红条摆出来。 */
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
            <p className="mb-1 flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              读不到定价配置
            </p>
            <p className="text-muted-foreground">
              {overview.readError}。现在页面上摆的是环境变量 / 默认值那一份,
              存不进去 —— 先把
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">
                pnpm migrate:apply-print-pricing
              </code>
              跑一遍,再回来保存。
            </p>
          </div>
        ) : !overview.hasConfigRow ? (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
            还没有后台配置行,现在生效的是 `PRINT_*` 环境变量 / 代码里的默认值。
            在下面点一次「保存」,今天的生效值就会固化进数据库,之后改环境变量不再影响线上。
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs md:grid-cols-4">
          <Readonly label="当前模型材料" value={settings.modelMaterialName} />
          <Readonly label="模型密度" value={`${settings.modelDensity} g/cm³`} />
          <Readonly
            label="模型单价"
            value={`${yuan(settings.unitPriceCentsPerGram)}/g`}
          />
          <Readonly label="当前支撑材料" value={settings.supportMaterialName} />
          <Readonly
            label="支撑密度"
            value={`${settings.supportDensity} g/cm³`}
          />
          <Readonly
            label="后处理费"
            value={
              settings.varnishEnabled
                ? yuan(settings.varnishFeeCents)
                : "不计入"
            }
          />
          <Readonly label="托底高度" value={`${settings.supportLiftMm} mm`} />
          <Readonly
            label="底板留边"
            value={`${settings.supportBaseMarginMm} mm`}
          />
          <Readonly
            label="交期 72 小时"
            value={`${round4(settings.deliveryRates.express * 100)}%`}
          />
          <Readonly
            label="交期 48 小时"
            value={`${round4(settings.deliveryRates.urgent * 100)}%`}
          />
          <Readonly
            label="支撑加价"
            value={settings.supportEnabled ? "已开启" : "未开启"}
          />
        </div>
      </section>

      {/* ② 计价设置 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-violet-600" />
          计价设置
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          金额单位是<b>元</b>(4.5 = 4.5 元/g);交期比例填百分比(37 = 37%)。
          保存后立刻生效 —— 购物车、打印单、结算都按新的值重算。
        </p>

        <Form form={configForm} layout="vertical">
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
            <Form.Item
              name="modelMaterialId"
              label="当前模型材料"
              extra="材料库里选一档;留空 = 走环境变量兜底"
            >
              <Select
                allowClear
                placeholder="未指定(走环境变量)"
                options={modelMaterialOptions}
              />
            </Form.Item>

            <Form.Item
              name="supportMaterialId"
              label="当前支撑材料"
              extra="支撑的密度按它算;支撑的加价价走下面的分段规则"
            >
              <Select
                allowClear
                placeholder="未指定(走环境变量)"
                options={supportMaterialOptions}
              />
            </Form.Item>
          </div>

          <Divider titlePlacement="left" plain>
            <span className="text-xs text-muted-foreground">支撑加价规则</span>
          </Divider>

          <div className="mb-3 flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-2">
            <div>
              <p className="text-xs font-medium">支撑加价总开关</p>
              <p className="text-[11px] text-muted-foreground">
                关掉就完全不计支撑费(默认关)
              </p>
            </div>
            <Form.Item name="supportEnabled" noStyle>
              <Switch />
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 lg:grid-cols-4">
            <Form.Item
              name="supportThreshold"
              label="自支撑阈值(比例)"
              extra="1 = 1:1,支撑克重 ÷ 耗材克重。低于它不收钱"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0.01} max={100} step={0.1} className="w-full" />
            </Form.Item>

            <Form.Item
              name="supportTier1Ratio"
              label="第一档上界(比例)"
              extra="2 = 1:2。超过这一档进第二档"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0.01} max={100} step={0.1} className="w-full" />
            </Form.Item>

            <Form.Item
              name="supportTier1PriceYuanPerGram"
              label="第一档单价(元/g)"
              extra="1:1 ~ 1:2 那部分支撑按它收"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0} max={10_000} step={0.1} className="w-full" />
            </Form.Item>

            <Form.Item
              name="supportTier2PriceYuanPerGram"
              label="第二档单价(元/g)"
              extra="超过 1:2 那部分支撑按它收"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0} max={10_000} step={0.1} className="w-full" />
            </Form.Item>
          </div>

          <div className="mb-4 rounded-md border border-dashed px-3 py-2 text-xs leading-relaxed">
            <p className="mb-1 flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              当前规则
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {rulePreview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <Divider titlePlacement="left" plain>
            <span className="text-xs text-muted-foreground">
              后处理 / 交期 / 几何
            </span>
          </Divider>

          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 lg:grid-cols-3">
            <Form.Item
              name="varnishFeeYuan"
              label="后处理固定费(元)"
              extra="光油 / 后处理,默认 10 元"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0} max={10_000} step={1} className="w-full" />
            </Form.Item>

            <Form.Item
              name="varnishEnabled"
              label="后处理是否计入报价"
              rules={[{ required: true, message: "必填" }]}
            >
              <Select
                options={[
                  { value: true, label: "计入" },
                  { value: false, label: "不计入" },
                ]}
              />
            </Form.Item>

            <Form.Item
              name="deliveryExpressPercent"
              label="交期 72 小时加价(%)"
              extra="按小计的百分比收"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0} max={100} step={1} className="w-full" />
            </Form.Item>

            <Form.Item
              name="deliveryUrgentPercent"
              label="交期 48 小时加价(%)"
              extra="按小计的百分比收"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0} max={100} step={1} className="w-full" />
            </Form.Item>

            <Form.Item
              name="supportLiftMm"
              label="托底高度(mm)"
              extra="支撑在平台上先长一层托住模型"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0} max={1000} step={0.5} className="w-full" />
            </Form.Item>

            <Form.Item
              name="supportBaseMarginMm"
              label="底板留边(mm)"
              extra="底板比模型轮廓四周多留一圈"
              rules={[{ required: true, message: "必填" }]}
            >
              <InputNumber min={0} max={1000} step={0.5} className="w-full" />
            </Form.Item>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="primary"
              loading={isSaving}
              onClick={handleSaveConfig}
            >
              {isSaving ? "保存中…" : "保存计价设置"}
            </Button>
            <Button
              onClick={() => configForm.setFieldsValue(toFormValues(settings))}
              disabled={isSaving}
            >
              还原成当前生效值
            </Button>
          </div>
        </Form>
      </section>

      {/* ③ 材料库 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-sky-600" />
              材料库
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              多档材料,各带自己的密度;上面「当前生效」的两格决定用哪一档。
              停用不删 —— 引用过它的工单还要引得到。
            </p>
          </div>
          <Button
            type="primary"
            icon={<Plus className="h-4 w-4" />}
            onClick={startCreateMaterial}
          >
            新增材料
          </Button>
        </div>

        {/* 材料表单 —— 就地展开,不开弹窗 */}
        {editingMaterial !== null ? (
          <div className="mt-4 rounded-md border bg-muted/30 p-4">
            <p className="mb-3 text-sm font-medium">
              {editingMaterial === "__new__" ? "新增材料" : "编辑材料"}
            </p>
            <Form form={materialForm} layout="vertical">
              <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 lg:grid-cols-3">
                <Form.Item
                  name="name"
                  label="名称"
                  rules={[{ required: true, message: "必填" }]}
                >
                  <Input placeholder="光敏树脂(通用)" />
                </Form.Item>

                <Form.Item
                  name="code"
                  label="标识"
                  extra="唯一;小写字母 / 数字 / 连字符"
                  rules={[
                    { required: true, message: "必填" },
                    {
                      pattern: /^[a-z0-9-]+$/,
                      message: "只能用小写字母、数字和连字符",
                    },
                  ]}
                >
                  <Input placeholder="resin-general" className="font-mono" />
                </Form.Item>

                <Form.Item name="kind" label="类别">
                  <Select
                    options={[
                      { value: "model", label: "模型材料" },
                      { value: "support", label: "支撑材料" },
                    ]}
                  />
                </Form.Item>

                <Form.Item
                  name="density"
                  label="密度(g/cm³)"
                  rules={[{ required: true, message: "必填" }]}
                >
                  <InputNumber
                    min={0.001}
                    max={100}
                    step={0.01}
                    className="w-full"
                  />
                </Form.Item>

                <Form.Item
                  name="unitPriceYuanPerGram"
                  label="单价(元/g)"
                  extra="只有模型材料用得上;支撑材料走分段规则"
                >
                  <InputNumber
                    min={0}
                    max={10_000}
                    step={0.1}
                    className="w-full"
                  />
                </Form.Item>

                <Form.Item name="sortOrder" label="排序(小的靠前)">
                  <InputNumber min={0} max={9999} className="w-full" />
                </Form.Item>
              </div>

              <div className="mb-3 flex items-center gap-3">
                <span className="text-xs text-muted-foreground">启用</span>
                <Form.Item name="isActive" noStyle>
                  <Switch />
                </Form.Item>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="primary"
                  loading={isCreating || isUpdating}
                  onClick={handleSubmitMaterial}
                >
                  {isCreating || isUpdating ? "保存中…" : "保存"}
                </Button>
                <Button
                  onClick={() => {
                    setEditingMaterial(null);
                    materialForm.resetFields();
                  }}
                >
                  取消
                </Button>
              </div>
            </Form>
          </div>
        ) : null}

        <Table<PrintMaterialLite>
          className="mt-4"
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={materials}
          pagination={false}
          locale={{ emptyText: "还没有材料 —— 点右上角「新增材料」" }}
        />

        <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="h-3 w-3 text-emerald-600" />
          改材料行的密度 / 单价会**立刻**改变生效值 —— 购物车每次读都重算。
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  只读字段                                                                    */
/* -------------------------------------------------------------------------- */

function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
