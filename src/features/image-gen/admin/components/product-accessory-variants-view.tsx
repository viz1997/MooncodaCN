"use client";

/**
 * 后台商品目录字典 —— **配件变体** 区块
 *
 * ## 这一块管的是「配件的每一个选项」
 *
 * 比如「金属扣」这个配件下面有「银色 / 黑色」两个变体,每个变体有自己的
 * **加价**(分)和**适用尺寸**(玻璃罩只有 4 / 6 / 8 三个尺寸)。
 *
 * 以前这些写死在 `src/features/gpt-image/lib/product-accessory-variants.ts`
 * ⇒ 后台改不了 ⇒ 工作室问「为什么商品 sku 无法设置以及价格」。
 *
 * ## 一律就地展开,不开弹窗
 *
 * 工作室的口味(跟优惠码后台 / 打印定价后台 / 发货台一个路子)。
 *
 * ## 「删除」= 停用,不是硬删
 *
 * 硬删之后那一行「DB 没行」⇒ 字典的兜底规则把它**原样复活**
 * ⇒ 工作室点了「删除」,刷新一下它又回来了。
 *
 * ## 型号不可改
 *
 * 变体挂在某个型号下面 ⇒ 一旦建好,**换型号等于换一行**
 * (服务端也是这么判的:型号取库里那一行的,不取表单的)。
 * ⇒ 编辑面板里那个字段是**只读**的。
 */

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Table,
  Tag,
} from "antd";
import type { FormInstance } from "antd/es/form";
import type { ColumnsType } from "antd/es/table";
import { Palette, Pencil, Plus, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useState } from "react";

import {
  deleteProductAccessoryVariantAction,
  upsertProductAccessoryVariantAction,
} from "@/features/image-gen/admin/actions";
import {
  CATALOG_ERROR_TEXT_KEYS,
  type AdminCatalogAccessoryVariant,
  type AdminCatalogErrorCode,
} from "@/features/image-gen/admin/types";
import { formatCents } from "@/lib/money";

import type { CatalogAdminRows } from "./catalog-admin-rows";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

type VariantFormValues = {
  accessoryCode: string;
  variantCode: string;
  name: string;
  nameEn: string;
  swatch: string;
  priceDeltaCents: number;
  appliesToSizesCm: number[];
  sortOrder: number;
};

/* -------------------------------------------------------------------------- */
/*  组件                                                                        */
/* -------------------------------------------------------------------------- */

export function ProductAccessoryVariantsView(props: {
  productTypeCode: string;
  rows: CatalogAdminRows;
  loading: boolean;
  errorCode: AdminCatalogErrorCode | null;
  onChanged: () => void;
}) {
  const { productTypeCode, rows, loading, errorCode, onChanged } = props;
  const t = useTranslations("AdminCatalog");
  const { message } = App.useApp();

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: saveVariant, isPending: isSaving } = useAction(
    upsertProductAccessoryVariantAction,
    {
      onSuccess: ({ data }) => {
        setPendingKey(null);
        if (data?.ok === false) {
          message.error(t(CATALOG_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(
          t("messages.variantSaved", { count: data?.recomputedSkus ?? 0 })
        );
        setAdding(false);
        setExpandedKeys([]);
        onChanged();
      },
      onError: ({ error }) => {
        setPendingKey(null);
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: removeVariant } = useAction(
    deleteProductAccessoryVariantAction,
    {
      onSuccess: ({ data }) => {
        setPendingKey(null);
        if (data?.ok === false) {
          message.error(t(CATALOG_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(
          t("messages.variantDisabled", { count: data?.recomputedSkus ?? 0 })
        );
        onChanged();
      },
      onError: ({ error }) => {
        setPendingKey(null);
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  /* ------------------------------------------------------------ 开关动作 -- */

  const toggleVariant = useCallback(
    (row: AdminCatalogAccessoryVariant, checked: boolean) => {
      setPendingKey(`variant:${row.id}`);
      if (!checked) {
        removeVariant({ id: row.id });
        return;
      }
      saveVariant({
        id: row.id,
        productTypeCode: row.productTypeCode,
        accessoryCode: row.accessoryCode,
        variantCode: row.variantCode,
        name: row.name,
        nameEn: row.nameEn,
        swatch: row.swatch ?? "",
        priceDeltaCents: row.priceDeltaCents,
        appliesToSizesCm: row.appliesToSizesCm,
        sortOrder: row.sortOrder,
        isActive: true,
      });
    },
    [removeVariant, saveVariant]
  );

  /* ------------------------------------------------------------ 派生数据 -- */

  /** 配件编码 → 配件名 */
  const accessoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const accessory of rows.accessories) {
      map.set(accessory.code, accessory.name);
    }
    return map;
  }, [rows.accessories]);

  /** 配件下拉选项 —— 只给「启用中」的配件 */
  const accessoryOptions = useMemo(
    () =>
      rows.accessories
        .filter((accessory) => accessory.isActive)
        .map((accessory) => ({
          value: accessory.code,
          label: `${accessory.name}（${accessory.code}）`,
        })),
    [rows.accessories]
  );

  /**
   * 「适用尺寸」的下拉选项
   *
   * ⚠️ `appliesToSizesCm` 存的是**厘米数字**(`[4]` / `[6]`),而尺寸字典里
   * 的 `sizeCode` 是**字符串**(`"4"` / `"6"` / `"11"`)⇒ 这里做一次转换。
   *
   * 转换不出来的(手改过 DB 的怪值)**不摆出来** —— 摆一个「尺寸字典里没有
   * 的尺寸」给工作室勾,勾了也生成不出 SKU。
   */
  const sizeOptions = useMemo(() => {
    const seen = new Set<number>();
    const options: { value: number; label: string }[] = [];
    for (const size of rows.sizes) {
      const cm = Number(size.sizeCode);
      if (!Number.isFinite(cm) || seen.has(cm)) continue;
      seen.add(cm);
      options.push({ value: cm, label: `${size.sizeCode} cm` });
    }
    return options;
  }, [rows.sizes]);

  /* -------------------------------------------------------------- 表格 -- */

  const columns: ColumnsType<AdminCatalogAccessoryVariant> = [
    {
      title: t("columns.accessory"),
      dataIndex: "accessoryCode",
      width: 160,
      render: (value: string) => (
        <span>
          {accessoryName.get(value) ?? value}
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            {value}
          </span>
        </span>
      ),
    },
    {
      title: t("columns.variantCode"),
      dataIndex: "variantCode",
      width: 150,
      render: (value: string) => <span className="font-mono">{value}</span>,
    },
    {
      title: t("columns.name"),
      dataIndex: "name",
      width: 130,
    },
    {
      title: t("columns.nameEn"),
      dataIndex: "nameEn",
      width: 130,
    },
    {
      title: t("columns.swatch"),
      dataIndex: "swatch",
      width: 90,
      render: (value: string | null) =>
        value ? (
          <span
            role="img"
            className="inline-block h-4 w-4 rounded border"
            style={{ backgroundColor: value }}
            aria-label={value}
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      title: t("columns.priceDelta"),
      dataIndex: "priceDeltaCents",
      width: 110,
      render: (value: number) => formatCents(value),
    },
    {
      title: t("columns.appliesToSizes"),
      dataIndex: "appliesToSizesCm",
      width: 160,
      render: (value: number[]) =>
        value.length === 0 ? (
          <span className="text-muted-foreground">{t("allSizes")}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {value.map((cm) => (
              <Tag key={cm} bordered={false}>
                {cm} cm
              </Tag>
            ))}
          </span>
        ),
    },
    {
      title: t("columns.sortOrder"),
      dataIndex: "sortOrder",
      width: 80,
    },
    {
      title: t("columns.isActive"),
      dataIndex: "isActive",
      width: 90,
      render: (value: boolean, row) => (
        <Switch
          checked={value}
          size="small"
          loading={pendingKey === `variant:${row.id}`}
          onChange={(checked) => toggleVariant(row, checked)}
        />
      ),
    },
    {
      title: t("columns.actions"),
      key: "actions",
      width: 90,
      render: (_value, row) => (
        <Button
          type="link"
          size="small"
          icon={<Pencil className="h-3.5 w-3.5" />}
          onClick={() => setExpandedKeys([row.id])}
        >
          {t("actions.edit")}
        </Button>
      ),
    },
  ];

  /* ---------------------------------------------------------------- 渲染 -- */

  if (errorCode) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <p className="font-medium">{t(CATALOG_ERROR_TEXT_KEYS[errorCode])}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Palette className="h-4 w-4" />
          {t("sections.variants.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("sections.variants.description", { code: productTypeCode })}
        </p>
      </header>

      {adding ? (
        <VariantEditor
          key="new-variant"
          mode="create"
          accessoryOptions={accessoryOptions}
          sizeOptions={sizeOptions}
          saving={isSaving}
          onCancel={() => setAdding(false)}
          onSubmit={(values) =>
            saveVariant({
              id: "",
              productTypeCode,
              accessoryCode: values.accessoryCode,
              variantCode: values.variantCode,
              name: values.name,
              nameEn: values.nameEn,
              swatch: values.swatch,
              priceDeltaCents: values.priceDeltaCents,
              appliesToSizesCm: values.appliesToSizesCm,
              sortOrder: values.sortOrder,
              isActive: true,
            })
          }
        />
      ) : (
        <Button
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setAdding(true)}
        >
          {t("actions.addVariant")}
        </Button>
      )}

      <Table<AdminCatalogAccessoryVariant>
        size="small"
        rowKey={(row) => row.id}
        columns={columns}
        dataSource={rows.variants}
        pagination={false}
        loading={loading}
        locale={{ emptyText: t("messages.emptyVariants") }}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys(keys as string[]),
          expandedRowRender: (row) => (
            <VariantEditor
              key={row.id}
              mode="edit"
              accessoryOptions={accessoryOptions}
              sizeOptions={sizeOptions}
              initialValues={{
                accessoryCode: row.accessoryCode,
                variantCode: row.variantCode,
                name: row.name,
                nameEn: row.nameEn,
                swatch: row.swatch ?? "",
                priceDeltaCents: row.priceDeltaCents,
                appliesToSizesCm: row.appliesToSizesCm,
                sortOrder: row.sortOrder,
              }}
              saving={isSaving}
              onCancel={() => setExpandedKeys([])}
              onSubmit={(values) =>
                saveVariant({
                  id: row.id,
                  productTypeCode: row.productTypeCode,
                  accessoryCode: values.accessoryCode,
                  variantCode: values.variantCode,
                  name: values.name,
                  nameEn: values.nameEn,
                  swatch: values.swatch,
                  priceDeltaCents: values.priceDeltaCents,
                  appliesToSizesCm: values.appliesToSizesCm,
                  sortOrder: values.sortOrder,
                  isActive: row.isActive,
                })
              }
            />
          ),
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  变体编辑                                                                    */
/* -------------------------------------------------------------------------- */

function VariantEditor(props: {
  mode: "create" | "edit";
  accessoryOptions: { value: string; label: string }[];
  sizeOptions: { value: number; label: string }[];
  initialValues?: VariantFormValues;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: VariantFormValues) => void;
}) {
  const {
    mode,
    accessoryOptions,
    sizeOptions,
    initialValues,
    saving,
    onCancel,
    onSubmit,
  } = props;
  const t = useTranslations("AdminCatalog");
  const [form] = Form.useForm<VariantFormValues>();

  const submit = useCallback(async () => {
    let values: VariantFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }
    onSubmit({
      accessoryCode: values.accessoryCode,
      variantCode: values.variantCode.trim(),
      name: values.name.trim(),
      nameEn: (values.nameEn ?? "").trim(),
      swatch: (values.swatch ?? "").trim(),
      priceDeltaCents: values.priceDeltaCents ?? 0,
      appliesToSizesCm: values.appliesToSizesCm ?? [],
      sortOrder: values.sortOrder ?? 0,
    });
  }, [form, onSubmit]);

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <Form
        key={mode}
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={
          initialValues ?? {
            accessoryCode: "",
            variantCode: "",
            name: "",
            nameEn: "",
            swatch: "",
            priceDeltaCents: 0,
            appliesToSizesCm: [],
            sortOrder: 0,
          }
        }
      >
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
          <Form.Item
            name="accessoryCode"
            label={t("form.accessory")}
            extra={
              mode === "edit" ? t("form.accessoryLockedHint") : undefined
            }
            rules={[{ required: true, message: t("form.required") }]}
          >
            <Select
              options={accessoryOptions}
              disabled={mode === "edit"}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item
            name="variantCode"
            label={t("form.variantCode")}
            extra={t("form.variantCodeHint")}
            rules={[{ required: true, message: t("form.required") }]}
          >
            <Input
              disabled={mode === "edit"}
              placeholder="leather_brown"
              className="font-mono"
            />
          </Form.Item>

          <Form.Item
            name="priceDeltaCents"
            label={t("form.priceDeltaCents")}
            extra={<MoneyPreview form={form} name="priceDeltaCents" />}
            rules={[{ required: true, message: t("form.required") }]}
          >
            <InputNumber
              precision={0}
              step={100}
              className="w-full"
              addonAfter={t("form.cents")}
            />
          </Form.Item>

          <Form.Item
            name="name"
            label={t("form.name")}
            rules={[{ required: true, message: t("form.required") }]}
          >
            <Input placeholder={t("form.namePlaceholder")} />
          </Form.Item>

          <Form.Item name="nameEn" label={t("form.nameEn")}>
            <Input placeholder={t("form.nameEnPlaceholder")} />
          </Form.Item>

          <Form.Item name="swatch" label={t("form.swatch")}>
            <Input placeholder="#8B5A2B" className="font-mono" />
          </Form.Item>

          <Form.Item
            name="appliesToSizesCm"
            label={t("form.appliesToSizes")}
            extra={t("form.appliesToSizesHint")}
          >
            <Select
              mode="multiple"
              options={sizeOptions}
              placeholder={t("form.appliesToSizesPlaceholder")}
              allowClear
            />
          </Form.Item>

          <Form.Item
            name="sortOrder"
            label={t("form.sortOrder")}
            rules={[{ required: true, message: t("form.required") }]}
          >
            <InputNumber precision={0} step={1} className="w-full" />
          </Form.Item>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="primary"
            size="small"
            loading={saving}
            icon={<Save className="h-3.5 w-3.5" />}
            onClick={submit}
          >
            {t("actions.save")}
          </Button>
          <Button
            size="small"
            icon={<X className="h-3.5 w-3.5" />}
            onClick={onCancel}
          >
            {t("actions.cancel")}
          </Button>
        </div>
      </Form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  金额预览                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 输入框旁边的「这是多少钱」提示
 *
 * ⚠️ 加价是**整数分** —— 跟仓库里其它后台配置一个口径(450 = 4.5 元)。
 */
function MoneyPreview(props: { form: FormInstance; name: string }) {
  const value = Form.useWatch(props.name, props.form);
  const cents = typeof value === "number" ? value : 0;
  return <span>{formatCents(cents)}</span>;
}
