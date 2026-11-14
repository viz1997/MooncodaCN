"use client";

/**
 * 后台商品目录字典 —— **尺寸 / 配件 / 配件归属** 三个区块
 *
 * ## 为什么在这一页
 *
 * 工作室问「为什么商品 sku 无法设置以及价格」——
 * 价能设(基础价),但**配件加价没有界面**、**新 SKU 造不出来**
 * (尺寸 / 配件清单写死在代码常量里)。
 *
 * ⇒ 这一页把那份字典搬进 DB,后台能自由增删。
 *
 * ## 一律就地展开,不开弹窗
 *
 * 工作室的口味(跟优惠码后台 / 打印定价后台 / 发货台一个路子):
 * 配置界面在页面上直接处理,不要弹窗挡住别的内容。
 *
 * ## 「删除」= 停用,不是硬删
 *
 * 硬删之后那一行「DB 没行」⇒ 字典的兜底规则把它**原样复活**
 * ⇒ 工作室点了「删除」,刷新一下它又回来了。
 *
 * ## 改加价 ⇒ 顺带重算 SKU 的绝对价
 *
 * 服务端那一步(`recomputeSkusAfterDictionaryChange`)已经做了 ⇒
 * 这一边只要在写完之后**刷新 SKU 表**(`onChanged`)。
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
} from "antd";
import type { FormInstance } from "antd/es/form";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, Puzzle, Ruler, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useState } from "react";

import {
  deleteProductAccessoryAction,
  deleteProductSizeAction,
  setProductAccessoryOptionAction,
  upsertProductAccessoryAction,
  upsertProductSizeAction,
} from "@/features/image-gen/admin/actions";
import {
  CATALOG_ERROR_TEXT_KEYS,
  type AdminCatalogAccessory,
  type AdminCatalogErrorCode,
  type AdminCatalogSize,
} from "@/features/image-gen/admin/types";
import { formatCents } from "@/lib/money";

import type { CatalogAdminRows } from "./catalog-admin-rows";

/* -------------------------------------------------------------------------- */
/*  配件分类                                                                    */
/* -------------------------------------------------------------------------- */

/** 配件分类 —— 后端只认这四个 */
const ACCESSORY_CATEGORIES = [
  "material",
  "protection",
  "mount",
  "decor",
] as const;

type AccessoryCategory = (typeof ACCESSORY_CATEGORIES)[number];

/** 查分类用 —— `Set` 才能拿「任意 string」去问 */
const ACCESSORY_CATEGORY_SET = new Set<string>(ACCESSORY_CATEGORIES);

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

type SizeFormValues = {
  sizeCode: string;
  priceDeltaCents: number;
  sortOrder: number;
};

type AccessoryFormValues = {
  code: string;
  name: string;
  nameEn: string;
  category: AccessoryCategory;
  sortOrder: number;
};

/* -------------------------------------------------------------------------- */
/*  组件                                                                        */
/* -------------------------------------------------------------------------- */

export function ProductDictionaryView(props: {
  productTypeCode: string;
  rows: CatalogAdminRows;
  loading: boolean;
  errorCode: AdminCatalogErrorCode | null;
  /** 写完之后通知外层刷新(字典 + SKU 表) */
  onChanged: () => void;
}) {
  const { productTypeCode, rows, loading, errorCode, onChanged } = props;
  const t = useTranslations("AdminCatalog");
  const { message } = App.useApp();

  /** 正在写哪一行 —— 用来把那一行的开关置灰 */
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  /** 正在改哪一行(尺寸 / 配件) */
  const [expandedSizeKeys, setExpandedSizeKeys] = useState<string[]>([]);
  const [expandedAccessoryKeys, setExpandedAccessoryKeys] = useState<
    string[]
  >([]);

  /** 「新增」面板开着没有 */
  const [addingSize, setAddingSize] = useState(false);
  const [addingAccessory, setAddingAccessory] = useState(false);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: saveSize, isPending: isSavingSize } = useAction(
    upsertProductSizeAction,
    {
      onSuccess: ({ data }) => {
        setPendingKey(null);
        if (data?.ok === false) {
          message.error(t(CATALOG_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(
          t("messages.sizeSaved", {
            count: data?.recomputedSkus ?? 0,
          })
        );
        setAddingSize(false);
        setExpandedSizeKeys([]);
        onChanged();
      },
      onError: ({ error }) => {
        setPendingKey(null);
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: removeSize } = useAction(
    deleteProductSizeAction,
    {
      onSuccess: ({ data }) => {
        setPendingKey(null);
        if (data?.ok === false) {
          message.error(t(CATALOG_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(
          t("messages.sizeDisabled", { count: data?.recomputedSkus ?? 0 })
        );
        onChanged();
      },
      onError: ({ error }) => {
        setPendingKey(null);
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: saveAccessory, isPending: isSavingAccessory } = useAction(
    upsertProductAccessoryAction,
    {
      onSuccess: ({ data }) => {
        setPendingKey(null);
        if (data?.ok === false) {
          message.error(t(CATALOG_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(t("messages.accessorySaved"));
        setAddingAccessory(false);
        setExpandedAccessoryKeys([]);
        onChanged();
      },
      onError: ({ error }) => {
        setPendingKey(null);
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: removeAccessory } = useAction(
    deleteProductAccessoryAction,
    {
      onSuccess: ({ data }) => {
        setPendingKey(null);
        if (data?.ok === false) {
          message.error(t(CATALOG_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(t("messages.accessoryDisabled"));
        onChanged();
      },
      onError: ({ error }) => {
        setPendingKey(null);
        message.error(error.serverError ?? t("messages.validationFailed"));
      },
    }
  );

  const { execute: saveOption } = useAction(setProductAccessoryOptionAction, {
    onSuccess: ({ data }) => {
      setPendingKey(null);
      if (data?.ok === false) {
        message.error(t(CATALOG_ERROR_TEXT_KEYS[data.code]));
        return;
      }
      message.success(t("messages.optionSaved"));
      onChanged();
    },
    onError: ({ error }) => {
      setPendingKey(null);
      message.error(error.serverError ?? t("messages.validationFailed"));
    },
  });

  /* ------------------------------------------------------------ 开关动作 -- */

  const toggleSize = useCallback(
    (row: AdminCatalogSize, checked: boolean) => {
      const key = `size:${row.id}`;
      setPendingKey(key);
      if (!checked) {
        removeSize({ productTypeCode, sizeCode: row.sizeCode });
        return;
      }
      saveSize({
        productTypeCode,
        sizeCode: row.sizeCode,
        priceDeltaCents: row.priceDeltaCents,
        sortOrder: row.sortOrder,
        isActive: true,
      });
    },
    [productTypeCode, removeSize, saveSize]
  );

  const toggleAccessory = useCallback(
    (row: AdminCatalogAccessory, checked: boolean) => {
      const key = `accessory:${row.code}`;
      setPendingKey(key);
      if (!checked) {
        removeAccessory({ code: row.code });
        return;
      }
      saveAccessory({
        code: row.code,
        name: row.name,
        nameEn: row.nameEn,
        category: row.category as AccessoryCategory,
        sortOrder: row.sortOrder,
        isActive: true,
      });
    },
    [removeAccessory, saveAccessory]
  );

  const toggleOption = useCallback(
    (accessoryCode: string, checked: boolean, sortOrder: number) => {
      setPendingKey(`option:${accessoryCode}`);
      saveOption({
        productTypeCode,
        accessoryCode,
        sortOrder,
        isActive: checked,
      });
    },
    [productTypeCode, saveOption]
  );

  /* ------------------------------------------------------------ 派生数据 -- */

  /** 配件归属:配件编码 → 那一行 */
  const optionByAccessory = useMemo(() => {
    const map = new Map<string, (typeof rows.accessoryOptions)[number]>();
    for (const option of rows.accessoryOptions) {
      map.set(option.accessoryCode, option);
    }
    return map;
  }, [rows.accessoryOptions]);

  const categoryOptions = useMemo(() => {
    const known: { value: string; label: string }[] = ACCESSORY_CATEGORIES.map(
      (category) => ({
        value: category,
        label: t(`categories.${category}`),
      })
    );
    // DB 里可能有不在四个之内的分类(手改过)⇒ 补上,别让它在编辑框里消失
    const extra = new Set<string>();
    for (const accessory of rows.accessories) {
      if (!ACCESSORY_CATEGORY_SET.has(accessory.category)) {
        extra.add(accessory.category);
      }
    }
    for (const category of extra) {
      known.push({ value: category, label: category });
    }
    return known;
  }, [rows.accessories, t]);

  /* -------------------------------------------------------------- 表格 -- */

  const sizeColumns: ColumnsType<AdminCatalogSize> = [
    {
      title: t("columns.sizeCode"),
      dataIndex: "sizeCode",
      width: 120,
      render: (value: string) => <span className="font-mono">{value}</span>,
    },
    {
      title: t("columns.priceDelta"),
      dataIndex: "priceDeltaCents",
      width: 120,
      render: (value: number) => formatCents(value),
    },
    {
      title: t("columns.sortOrder"),
      dataIndex: "sortOrder",
      width: 90,
    },
    {
      title: t("columns.isActive"),
      dataIndex: "isActive",
      width: 90,
      render: (value: boolean, row) => (
        <Switch
          checked={value}
          size="small"
          loading={pendingKey === `size:${row.id}`}
          onChange={(checked) => toggleSize(row, checked)}
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
          onClick={() => setExpandedSizeKeys([row.id])}
        >
          {t("actions.edit")}
        </Button>
      ),
    },
  ];

  const accessoryColumns: ColumnsType<AdminCatalogAccessory> = [
    {
      title: t("columns.accessoryCode"),
      dataIndex: "code",
      width: 150,
      render: (value: string) => <span className="font-mono">{value}</span>,
    },
    {
      title: t("columns.name"),
      dataIndex: "name",
      width: 140,
    },
    {
      title: t("columns.nameEn"),
      dataIndex: "nameEn",
      width: 140,
    },
    {
      title: t("columns.category"),
      dataIndex: "category",
      width: 110,
      render: (value: string) =>
        ACCESSORY_CATEGORY_SET.has(value)
          ? t(`categories.${value}`)
          : value,
    },
    {
      title: t("columns.sortOrder"),
      dataIndex: "sortOrder",
      width: 90,
    },
    {
      title: t("columns.isActive"),
      dataIndex: "isActive",
      width: 90,
      render: (value: boolean, row) => (
        <Switch
          checked={value}
          size="small"
          loading={pendingKey === `accessory:${row.code}`}
          onChange={(checked) => toggleAccessory(row, checked)}
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
          onClick={() => setExpandedAccessoryKeys([row.code])}
        >
          {t("actions.edit")}
        </Button>
      ),
    },
  ];

  /** 配件归属那一行的形状(配件 + 归属合成一行) */
  type OptionRow = AdminCatalogAccessory & {
    optionSortOrder: number;
    optionEnabled: boolean;
  };

  const optionColumns: ColumnsType<OptionRow> = [
    {
      title: t("columns.accessory"),
      dataIndex: "name",
      width: 180,
      render: (value: string, row) => (
        <span>
          {value}
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            {row.code}
          </span>
        </span>
      ),
    },
    {
      title: t("columns.category"),
      dataIndex: "category",
      width: 110,
      render: (value: string) =>
        ACCESSORY_CATEGORY_SET.has(value)
          ? t(`categories.${value}`)
          : value,
    },
    {
      title: t("columns.optionEnabled"),
      dataIndex: "optionEnabled",
      width: 110,
      render: (value: boolean, row) => (
        <Switch
          checked={value}
          size="small"
          disabled={!row.isActive}
          loading={pendingKey === `option:${row.code}`}
          onChange={(checked) =>
            toggleOption(row.code, checked, row.optionSortOrder)}
        />
      ),
    },
    {
      title: t("columns.sortOrder"),
      dataIndex: "optionSortOrder",
      width: 90,
    },
  ];

  const optionRows: OptionRow[] = rows.accessories.map((accessory) => {
    const option = optionByAccessory.get(accessory.code);
    return {
      ...accessory,
      optionSortOrder: option?.sortOrder ?? 0,
      optionEnabled: option?.isActive ?? false,
    };
  });

  /* ---------------------------------------------------------------- 渲染 -- */

  if (errorCode) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <p className="font-medium">{t(CATALOG_ERROR_TEXT_KEYS[errorCode])}</p>
        {errorCode === "MIGRATION_MISSING" ? (
          <p className="mt-2 font-mono text-xs">
            pnpm migrate:apply-catalog-dictionary
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------ 尺寸字典 -- */}
      <section className="space-y-3">
        <header className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Ruler className="h-4 w-4" />
            {t("sections.sizes.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("sections.sizes.description")}
          </p>
        </header>

        {addingSize ? (
          <SizeEditor
            key="new-size"
            mode="create"
            productTypeCode={productTypeCode}
            saving={isSavingSize}
            onCancel={() => setAddingSize(false)}
            onSubmit={(values) =>
              saveSize({
                productTypeCode,
                sizeCode: values.sizeCode,
                priceDeltaCents: values.priceDeltaCents,
                sortOrder: values.sortOrder,
                isActive: true,
              })
            }
          />
        ) : (
          <Button
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setAddingSize(true)}
          >
            {t("actions.addSize")}
          </Button>
        )}

        <Table<AdminCatalogSize>
          size="small"
          rowKey={(row) => row.id}
          columns={sizeColumns}
          dataSource={rows.sizes}
          pagination={false}
          loading={loading}
          locale={{ emptyText: t("messages.emptySizes") }}
          expandable={{
            expandedRowKeys: expandedSizeKeys,
            onExpandedRowsChange: (keys) =>
              setExpandedSizeKeys(keys as string[]),
            expandedRowRender: (row) => (
              <SizeEditor
                key={row.id}
                mode="edit"
                productTypeCode={productTypeCode}
                initialValues={{
                  sizeCode: row.sizeCode,
                  priceDeltaCents: row.priceDeltaCents,
                  sortOrder: row.sortOrder,
                }}
                saving={isSavingSize}
                onCancel={() => setExpandedSizeKeys([])}
                onSubmit={(values) =>
                  saveSize({
                    productTypeCode,
                    sizeCode: values.sizeCode,
                    priceDeltaCents: values.priceDeltaCents,
                    sortOrder: values.sortOrder,
                    isActive: row.isActive,
                  })
                }
              />
            ),
          }}
        />
      </section>

      {/* ------------------------------------------------------ 配件字典 -- */}
      <section className="space-y-3">
        <header className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Puzzle className="h-4 w-4" />
            {t("sections.accessories.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("sections.accessories.description")}
          </p>
        </header>

        {addingAccessory ? (
          <AccessoryEditor
            key="new-accessory"
            mode="create"
            categoryOptions={categoryOptions}
            saving={isSavingAccessory}
            onCancel={() => setAddingAccessory(false)}
            onSubmit={(values) =>
              saveAccessory({
                code: values.code,
                name: values.name,
                nameEn: values.nameEn,
                category: values.category,
                sortOrder: values.sortOrder,
                isActive: true,
              })
            }
          />
        ) : (
          <Button
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setAddingAccessory(true)}
          >
            {t("actions.addAccessory")}
          </Button>
        )}

        <Table<AdminCatalogAccessory>
          size="small"
          rowKey={(row) => row.code}
          columns={accessoryColumns}
          dataSource={rows.accessories}
          pagination={false}
          loading={loading}
          locale={{ emptyText: t("messages.emptyAccessories") }}
          expandable={{
            expandedRowKeys: expandedAccessoryKeys,
            onExpandedRowsChange: (keys) =>
              setExpandedAccessoryKeys(keys as string[]),
            expandedRowRender: (row) => (
              <AccessoryEditor
                key={row.code}
                mode="edit"
                categoryOptions={categoryOptions}
                initialValues={{
                  code: row.code,
                  name: row.name,
                  nameEn: row.nameEn,
                  category: row.category as AccessoryCategory,
                  sortOrder: row.sortOrder,
                }}
                saving={isSavingAccessory}
                onCancel={() => setExpandedAccessoryKeys([])}
                onSubmit={(values) =>
                  saveAccessory({
                    code: values.code,
                    name: values.name,
                    nameEn: values.nameEn,
                    category: values.category,
                    sortOrder: values.sortOrder,
                    isActive: row.isActive,
                  })
                }
              />
            ),
          }}
        />
      </section>

      {/* -------------------------------------------------- 本型号的归属 -- */}
      <section className="space-y-3">
        <header className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Puzzle className="h-4 w-4" />
            {t("sections.options.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("sections.options.description", { code: productTypeCode })}
          </p>
        </header>

        <Table<OptionRow>
          size="small"
          rowKey={(row) => row.code}
          columns={optionColumns}
          dataSource={optionRows}
          pagination={false}
          loading={loading}
          locale={{ emptyText: t("messages.emptyOptions") }}
        />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  尺寸编辑                                                                    */
/* -------------------------------------------------------------------------- */

function SizeEditor(props: {
  mode: "create" | "edit";
  productTypeCode: string;
  initialValues?: SizeFormValues;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: SizeFormValues) => void;
}) {
  const { mode, initialValues, saving, onCancel, onSubmit } = props;
  const t = useTranslations("AdminCatalog");
  const [form] = Form.useForm<SizeFormValues>();

  const submit = useCallback(async () => {
    let values: SizeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }
    onSubmit({
      sizeCode: values.sizeCode.trim(),
      priceDeltaCents: values.priceDeltaCents ?? 0,
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
          initialValues ?? { sizeCode: "", priceDeltaCents: 0, sortOrder: 0 }
        }
      >
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
          <Form.Item
            name="sizeCode"
            label={t("form.sizeCode")}
            extra={t("form.sizeCodeHint")}
            rules={[{ required: true, message: t("form.required") }]}
          >
            <Input
              disabled={mode === "edit"}
              placeholder="4"
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
/*  配件编辑                                                                    */
/* -------------------------------------------------------------------------- */

function AccessoryEditor(props: {
  mode: "create" | "edit";
  categoryOptions: { value: string; label: string }[];
  initialValues?: AccessoryFormValues;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: AccessoryFormValues) => void;
}) {
  const { mode, categoryOptions, initialValues, saving, onCancel, onSubmit } =
    props;
  const t = useTranslations("AdminCatalog");
  const [form] = Form.useForm<AccessoryFormValues>();

  const submit = useCallback(async () => {
    let values: AccessoryFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    onSubmit({
      code: values.code.trim(),
      name: values.name.trim(),
      nameEn: (values.nameEn ?? "").trim(),
      category: values.category,
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
            code: "",
            name: "",
            nameEn: "",
            category: "material",
            sortOrder: 0,
          }
        }
      >
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
          <Form.Item
            name="code"
            label={t("form.accessoryCode")}
            extra={t("form.accessoryCodeHint")}
            rules={[{ required: true, message: t("form.required") }]}
          >
            <Input
              disabled={mode === "edit"}
              placeholder="leather_brown"
              className="font-mono"
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

          <Form.Item
            name="category"
            label={t("form.category")}
            rules={[{ required: true, message: t("form.required") }]}
          >
            <Select options={categoryOptions} />
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
 * 工作室看着「450」不直观 ⇒ 旁边摆一句折好的金额。
 */
function MoneyPreview(props: { form: FormInstance; name: string }) {
  const value = Form.useWatch(props.name, props.form);
  const cents = typeof value === "number" ? value : 0;
  return <span>{formatCents(cents)}</span>;
}
