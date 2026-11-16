"use client";

/**
 * 案例后台 —— `/admin/showcases`
 *
 * 工作室把**真实打印成品**拍下来传上来,前台首页和作品集页就摆这些图。
 *
 * ## 为什么这一页很重要
 *
 * 以前前台那两块(首页 `CraftGallery` 的下半、作品集页 `CommunityWall`)摆的是
 * **代码常量** —— `wjp-store-data.ts` 里四条 Unsplash 图库链接,配着编出来的
 * 顾客昵称和点赞数。那不是我们打印出来的东西。
 *
 * 现在案例从 **DB** 来:工作室自己传、自己排、自己上下架。**前台没有静态兜底**
 * —— 一条案例都没有时,那两块**整段不渲染**(摆一个空的「真实照片」标题下面
 * 什么都没有,比不摆更糟)。
 *
 * ## 编辑是**就地展开**,不开弹窗
 *
 * 工作室的口味:配置界面在页面上直接处理,不要弹窗挡住别的内容。
 *
 * ## 图片走**直传**
 *
 * 客户端 → `/api/admin/showcases/upload-url` 拿预签名 → 直接 PUT 到 R2 →
 * 表单里存**对象键**(不是最终地址)⇒ 换 CDN 域名不用改库。
 *
 * 表单里的图也可以**直接贴外链**(工作室可能把微信相册里的图直接贴过来)——
 * 那时候存的就是那个 URL。
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
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  Eye,
  EyeOff,
  Image as ImageIcon,
  Images,
  Plus,
  RotateCcw,
  Upload as UploadIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";
import {
  adminListShowcaseCasesAction,
  adminSaveShowcaseCaseAction,
  adminSetShowcaseCaseActiveAction,
} from "@/features/showcase/admin/actions";
import type { AdminShowcase } from "@/features/showcase/admin/types";

/* -------------------------------------------------------------------------- */
/*  常量                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 单张图片的上限 —— 跟 `/api/admin/showcases/upload-url` 那条路由**同一个数**
 *
 * 12MB:案例图是手机拍的实拍图,原图能到 8~10MB。
 */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

type ShowcaseFormValues = {
  /** 成品图引用 —— 外链或 R2 对象键 */
  coverUrl: string;
  /** 原图引用 —— 空 = 没有 before/after 翻转 */
  beforeImageUrl: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  authorName: string;
  productTypeCode: string | null;
  productHandle: string;
  likes: number;
  sortOrder: number;
  isActive: boolean;
};

/* -------------------------------------------------------------------------- */
/*  小工具                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * code → 面向顾客的中文名(从 `PRODUCT_TYPES` 派生,不手抄一份)
 *
 * **要去掉 unit 前缀** —— `PRODUCT_TYPES[].name` 是内部规格名,`unit: "cm"`
 * 被拼在前面(R 的 name 实际是 "CM 钥匙扣")。直接印在顾客看的徽标上会读成
 * "CM 钥匙扣"这种莫名其妙的东西。
 */
const TYPE_LABELS: Record<string, string> = PRODUCT_TYPES.reduce(
  (acc, t) => {
    const prefix = `${t.unit.toUpperCase()} `;
    acc[t.code] = t.name.startsWith(prefix)
      ? t.name.slice(prefix.length)
      : t.name;
    return acc;
  },
  {} as Record<string, string>
);

/* -------------------------------------------------------------------------- */
/*  主组件                                                                      */
/* -------------------------------------------------------------------------- */

export function ShowcasesAdminView() {
  const t = useTranslations("AdminShowcase");
  const { message } = App.useApp();

  const [cases, setCases] = useState<AdminShowcase[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 正在编辑的那一条 —— null = 没在编辑;`"__new__"` = 新增 */
  const [editingId, setEditingId] = useState<string | "__new__" | null>(null);

  /** 正在上传的是哪一张图 —— `cover` / `before` */
  const [uploadingField, setUploadingField] = useState<
    "cover" | "before" | null
  >(null);

  const [form] = Form.useForm<ShowcaseFormValues>();

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    const res = await adminListShowcaseCasesAction({});
    const data = res?.data;
    if (data?.ok === false) {
      setLoadError(t(`errors.${data.code}`));
      setCases([]);
      return;
    }
    if (data?.ok) {
      setCases(data.cases);
      setLoadError(null);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: saveCase, isPending: isSaving } = useAction(
    adminSaveShowcaseCaseAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        message.success(t("messages.saveSuccess"));
        setEditingId(null);
        form.resetFields();
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  const { execute: setActive, isPending: isToggling } = useAction(
    adminSetShowcaseCaseActiveAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        message.success(t("messages.toggleSuccess"));
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  /* ------------------------------------------------------------ 图片上传 -- */

  /**
   * 传一张图
   *
   * 1. 问后端要一个**预签名 URL**(后端签的是「这个键、这个类型、这么大」);
   * 2. 客户端把文件 raw binary PUT 上去(服务端不碰字节);
   * 3. 把**对象键**填进表单 —— **不是** `publicUrl`。
   *
   * ⚠️ 存对象键而不是最终地址 —— 换 CDN 域名要改环境变量,不该改每一行 DB。
   */
  const uploadImage = useCallback(
    async (file: File, field: "cover" | "before") => {
      if (file.size > MAX_UPLOAD_BYTES) {
        message.error(t("messages.tooLarge"));
        return;
      }
      if (!file.type.startsWith("image/")) {
        message.error(t("messages.notImage"));
        return;
      }

      setUploadingField(field);
      try {
        const presignRes = await fetch("/api/admin/showcases/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, size: file.size }),
        });
        const presign = (await presignRes.json()) as {
          success?: boolean;
          error?: string;
          uploadUrl?: string;
          objectKey?: string;
          headers?: Record<string, string>;
          contentType?: string;
        };
        if (!presignRes.ok || !presign.success || !presign.uploadUrl) {
          message.error(presign.error ?? t("messages.uploadFailed"));
          return;
        }

        const putRes = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: {
            ...(presign.headers ?? {}),
            "Content-Type": presign.contentType ?? file.type,
          },
          body: file,
        });
        if (!putRes.ok) {
          message.error(t("messages.uploadFailed"));
          return;
        }

        // 存**对象键** —— 前台渲染时再解析成能用的地址
        form.setFieldValue(
          field === "cover" ? "coverUrl" : "beforeImageUrl",
          presign.objectKey ?? ""
        );
        message.success(t("messages.uploadSuccess"));
      } catch {
        message.error(t("messages.uploadFailed"));
      } finally {
        setUploadingField(null);
      }
    },
    [form, message, t]
  );

  /* ------------------------------------------------------------ 表单动作 -- */

  const startCreate = useCallback(() => {
    setEditingId("__new__");
    form.resetFields();
    form.setFieldsValue({
      coverUrl: "",
      beforeImageUrl: "",
      title: "",
      titleEn: "",
      description: "",
      descriptionEn: "",
      authorName: "",
      productTypeCode: null,
      productHandle: "",
      likes: 0,
      sortOrder: 0,
      isActive: true,
    });
  }, [form]);

  /** 填进表单(编辑已有的一条) */
  const startEdit = useCallback(
    (row: AdminShowcase) => {
      setEditingId(row.id);
      form.resetFields();
      form.setFieldsValue({
        coverUrl: row.coverUrl,
        beforeImageUrl: row.beforeImageUrl ?? "",
        title: row.title,
        titleEn: row.titleEn ?? "",
        description: row.description ?? "",
        descriptionEn: row.descriptionEn ?? "",
        authorName: row.authorName,
        productTypeCode: row.productTypeCode,
        productHandle: row.productHandle ?? "",
        likes: row.likes,
        sortOrder: row.sortOrder,
        isActive: row.isActive,
      });
    },
    [form]
  );

  const handleSubmit = async () => {
    let values: ShowcaseFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }

    saveCase({
      id: editingId === "__new__" ? null : editingId,
      coverUrl: values.coverUrl.trim(),
      beforeImageUrl: values.beforeImageUrl.trim() || null,
      title: values.title.trim(),
      titleEn: values.titleEn.trim() || null,
      description: values.description.trim() || null,
      descriptionEn: values.descriptionEn.trim() || null,
      authorName: values.authorName.trim(),
      productTypeCode: values.productTypeCode ?? null,
      productHandle: values.productHandle.trim() || null,
      likes: values.likes ?? 0,
      sortOrder: values.sortOrder ?? 0,
      isActive: values.isActive ?? true,
    });
  };

  /* ------------------------------------------------------------ 派生数据 -- */

  const rows = cases ?? [];

  /** 正在编辑的那一条(用来在表单上方显示当前图) */
  const editingRow = useMemo(
    () => rows.find((r) => r.id === editingId) ?? null,
    [editingId, rows]
  );

  const typeOptions = useMemo(
    () =>
      PRODUCT_TYPES.map((t) => ({
        value: t.code,
        label: TYPE_LABELS[t.code] ?? t.code,
      })),
    []
  );

  const columns: ColumnsType<AdminShowcase> = useMemo(
    () => [
      {
        title: t("table.cover"),
        key: "cover",
        width: 96,
        render: (_, row) =>
          row.coverSrc ? (
            // biome-ignore lint/performance/noImgElement: 案例图地址是运行时解析的,next/image 的 loader 不认
            <img
              src={row.coverSrc}
              alt={row.title}
              className="size-16 rounded-md border object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-md border border-dashed text-muted-foreground">
              <ImageIcon className="size-4" />
            </div>
          ),
      },
      {
        title: t("table.title"),
        key: "title",
        render: (_, row) => (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{row.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {row.authorName || "—"}
            </p>
          </div>
        ),
      },
      {
        title: t("table.type"),
        dataIndex: "productTypeCode",
        key: "productTypeCode",
        width: 110,
        render: (code: string | null) =>
          code ? (
            <Tag>{TYPE_LABELS[code] ?? code}</Tag>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        title: t("table.likes"),
        dataIndex: "likes",
        key: "likes",
        width: 80,
        render: (likes: number) => (
          <span className="font-mono text-xs">{likes}</span>
        ),
      },
      {
        title: t("table.sortOrder"),
        dataIndex: "sortOrder",
        key: "sortOrder",
        width: 90,
        render: (sortOrder: number) => (
          <span className="font-mono text-xs">{sortOrder}</span>
        ),
      },
      {
        title: t("table.status"),
        dataIndex: "isActive",
        key: "isActive",
        width: 90,
        render: (isActive: boolean) =>
          isActive ? (
            <Tag color="green">{t("status.active")}</Tag>
          ) : (
            <Tag>{t("status.inactive")}</Tag>
          ),
      },
      {
        title: t("table.actions"),
        key: "actions",
        width: 150,
        render: (_, row) => (
          <div className="flex items-center gap-1">
            <Button size="small" type="text" onClick={() => startEdit(row)}>
              {t("actions.edit")}
            </Button>
            <Button
              size="small"
              type="text"
              danger={row.isActive}
              loading={isToggling}
              icon={
                row.isActive ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )
              }
              onClick={() => setActive({ id: row.id, isActive: !row.isActive })}
            >
              {row.isActive ? t("actions.disable") : t("actions.enable")}
            </Button>
          </div>
        ),
      },
    ],
    [isToggling, setActive, startEdit, t]
  );

  /* ------------------------------------------------------------ 渲染 ------ */

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        {loadError}
      </div>
    );
  }

  if (cases === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <RotateCcw className="h-4 w-4 animate-spin" />
        {t("messages.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Images className="h-5 w-5 text-emerald-600" />
            {t("title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          type="primary"
          icon={<Plus className="h-4 w-4" />}
          onClick={startCreate}
        >
          {t("actions.create")}
        </Button>
      </div>

      {/* 编辑表单 —— 就地展开,不开弹窗 */}
      {editingId !== null ? (
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">
            {editingId === "__new__" ? t("form.create") : t("form.edit")}
          </h3>

          <Form form={form} layout="vertical">
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 lg:grid-cols-3">
              {/* 成品图 */}
              <Form.Item
                name="coverUrl"
                label={t("form.coverUrl")}
                extra={t("form.coverUrlHint")}
                rules={[{ required: true, message: t("form.required") }]}
              >
                <Input placeholder={t("form.coverUrlPlaceholder")} />
              </Form.Item>

              {/* 原图 */}
              <Form.Item
                name="beforeImageUrl"
                label={t("form.beforeImageUrl")}
                extra={t("form.beforeImageUrlHint")}
              >
                <Input placeholder={t("form.beforeImageUrlPlaceholder")} />
              </Form.Item>

              {/* 标题 */}
              <Form.Item
                name="title"
                label={t("form.title")}
                rules={[{ required: true, message: t("form.required") }]}
              >
                <Input placeholder={t("form.titlePlaceholder")} />
              </Form.Item>

              <Form.Item name="titleEn" label={t("form.titleEn")}>
                <Input placeholder={t("form.titleEnPlaceholder")} />
              </Form.Item>

              <Form.Item name="description" label={t("form.description")}>
                <Input.TextArea
                  rows={2}
                  placeholder={t("form.descriptionPlaceholder")}
                />
              </Form.Item>

              <Form.Item name="descriptionEn" label={t("form.descriptionEn")}>
                <Input.TextArea
                  rows={2}
                  placeholder={t("form.descriptionEnPlaceholder")}
                />
              </Form.Item>

              <Form.Item
                name="authorName"
                label={t("form.authorName")}
                extra={t("form.authorNameHint")}
              >
                <Input placeholder={t("form.authorNamePlaceholder")} />
              </Form.Item>

              <Form.Item
                name="productTypeCode"
                label={t("form.productTypeCode")}
              >
                <Select
                  allowClear
                  options={typeOptions}
                  placeholder={t("form.productTypeCodePlaceholder")}
                />
              </Form.Item>

              <Form.Item
                name="productHandle"
                label={t("form.productHandle")}
                extra={t("form.productHandleHint")}
              >
                <Input placeholder={t("form.productHandlePlaceholder")} />
              </Form.Item>

              <Form.Item name="likes" label={t("form.likes")}>
                <InputNumber
                  min={0}
                  max={1_000_000}
                  step={1}
                  className="w-full"
                />
              </Form.Item>

              <Form.Item
                name="sortOrder"
                label={t("form.sortOrder")}
                extra={t("form.sortOrderHint")}
              >
                <InputNumber
                  min={0}
                  max={100_000}
                  step={1}
                  className="w-full"
                />
              </Form.Item>

              <Form.Item
                name="isActive"
                label={t("form.isActive")}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </div>

            {/* 上传 + 预览 */}
            <div className="mt-1 flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium">
                  {t("form.uploadTitle")}
                </span>
                <div className="flex gap-2">
                  <Upload
                    accept="image/*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void uploadImage(file, "cover");
                      return Upload.LIST_IGNORE;
                    }}
                  >
                    <Button
                      icon={<UploadIcon className="h-3.5 w-3.5" />}
                      loading={uploadingField === "cover"}
                    >
                      {t("form.uploadCover")}
                    </Button>
                  </Upload>
                  <Upload
                    accept="image/*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void uploadImage(file, "before");
                      return Upload.LIST_IGNORE;
                    }}
                  >
                    <Button
                      icon={<UploadIcon className="h-3.5 w-3.5" />}
                      loading={uploadingField === "before"}
                    >
                      {t("form.uploadBefore")}
                    </Button>
                  </Upload>
                </div>
              </div>

              {/* 当前这一条的图 —— 正在编辑的那一行有服务端解析好的地址 */}
              {editingRow?.coverSrc ? (
                // biome-ignore lint/performance/noImgElement: 案例图地址是运行时解析的,next/image 的 loader 不认
                <img
                  src={editingRow.coverSrc}
                  alt={t("form.preview")}
                  className="size-20 rounded-md border object-cover"
                />
              ) : null}
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="primary" loading={isSaving} onClick={handleSubmit}>
                {t("actions.save")}
              </Button>
              <Button
                onClick={() => {
                  setEditingId(null);
                  form.resetFields();
                }}
              >
                {t("actions.cancel")}
              </Button>
            </div>
          </Form>
        </section>
      ) : null}

      {/* 列表 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <Table<AdminShowcase>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: t("list.empty") }}
        />
      </section>
    </div>
  );
}
