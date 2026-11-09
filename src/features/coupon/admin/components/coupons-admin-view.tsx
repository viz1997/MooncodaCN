"use client";

/**
 * 优惠码后台 —— `/admin/coupons`
 *
 * 工作室要能自己发券。这一页三块:
 *
 * 1. **四个预设按钮** —— 满减 / 百分比 / 免运费 / 新人首单。点一下就把
 *    表单填成那个形状(面额 / 折扣率 / 门槛 / 首单开关),工作室改两个数
 *    就能发一张券,不用从零想「这张券该长什么样」。
 * 2. **编辑表单** —— **就地展开,不开弹窗**(工作室的口味:配置界面在页面上
 *    直接处理,不要弹窗挡住别的内容)。
 * 3. **券列表** —— 停用而不是删(历史订单还引用着它)。
 *
 * ## 单位:金额一律「元」,折扣率一律「%」
 *
 * - 金额输入框收**元**(10 = 10 元)—— 工作室看的是钱,让人填「1000 分」
 *   等于让人自己心算换算,填错一个数量级就是把优惠定成 100 倍。
 * - **提交时换算成整数分**,服务端和 DB 的口径没动(还是分)—— 换算只发生
 *   在表单这一层。
 * - 折扣率界面用百分比(填 15 = 减 15%),提交时换算成 0~1 的小数。
 *
 * ## 「新人首单券」不是第四种类型
 *
 * 底层 `kind` 只有三个(`amount` / `percent` / `free_shipping`),
 * 「新人首单」是叠在任意一种上的**布尔修饰**(`firstOrderOnly`)。
 * 所以预设按钮「新人首单」给的是「满减 + 首单限定」,不是新类型。
 */

import {
  App,
  Button,
  DatePicker,
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
import dayjs, { type Dayjs } from "dayjs";
import {
  BadgePercent,
  Check,
  CircleDollarSign,
  Gift,
  Plus,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
  Truck,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  adminDeactivateCouponAction,
  adminListCouponsAction,
  adminSaveCouponAction,
} from "@/features/coupon/admin/actions";
import type { AdminCoupon } from "@/features/coupon/admin/types";
import type {
  CouponKind,
  CouponScope,
} from "@/features/coupon/lib/coupon-calc";
import { formatCents } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 表单值 —— 金额是**元**,折扣率是**百分比**
 *
 * 字段名带 `Yuan` / `Percent` —— 名字就是单位,写错名字的东西迟早会被
 * 当成另一个单位用(仓库里踩过「差 100 倍」的坑)。
 */
type CouponFormValues = {
  code: string;
  name: string;
  kind: CouponKind;
  /** 元 —— `kind = "amount"` */
  amountYuan: number | null;
  /** 百分比(15 = 减 15%)—— `kind = "percent"` */
  discountPercent: number | null;
  /** 元 —— `kind = "percent"` 的封顶 */
  maxDiscountYuan: number | null;
  /** 元 —— 满多少才用 */
  minAmountYuan: number | null;
  scope: CouponScope;
  firstOrderOnly: boolean;
  usageLimit: number | null;
  perUserLimit: number | null;
  /** Dayjs 对象(antd DatePicker 给的) */
  startsAt: Dayjs | null;
  endsAt: Dayjs | null;
  isActive: boolean;
};

/* -------------------------------------------------------------------------- */
/*  小工具                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 元 → 分(提交给服务端的值)
 *
 * 服务端口径是**整数分**,这里只做单位换算 + 取整。`+ Number.EPSILON`
 * 是为了对付浮点误差:1.005 * 100 在 IEEE754 下是 100.49999999999999,
 * 直接 round 会掉到 100。
 */
function yuanToCents(value: number | null | undefined): number {
  return Math.round(((value ?? 0) + Number.EPSILON) * 100);
}

/** 分 → 元(填进表单的值) */
function centsToYuan(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

/** 百分比(15)→ 小数(0.15)—— 界面填百分比,服务端认小数 */
function percentToRate(percent: number | null | undefined): number {
  return (percent ?? 0) / 100;
}

/* -------------------------------------------------------------------------- */
/*  主组件                                                                      */
/* -------------------------------------------------------------------------- */

export function CouponsAdminView() {
  const t = useTranslations("AdminCoupons");
  const { message } = App.useApp();

  const [coupons, setCoupons] = useState<AdminCoupon[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 正在编辑的那张券 —— null = 没在编辑;`"__new__"` = 新增 */
  const [editingId, setEditingId] = useState<string | "__new__" | null>(null);

  const [form] = Form.useForm<CouponFormValues>();

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminListCouponsAction();
      if (res?.data) {
        setCoupons(res.data);
        setLoadError(null);
      }
    } catch {
      setLoadError(t("messages.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: saveCoupon, isPending: isSaving } = useAction(
    adminSaveCouponAction,
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

  const { execute: deactivate, isPending: isDeactivating } = useAction(
    adminDeactivateCouponAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        message.success(t("messages.deactivateSuccess"));
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  /* ------------------------------------------------------------ 表单动作 -- */

  /**
   * 一张券的「优惠说明」—— 表格里那一列
   *
   * 例:「满 ¥99 减 ¥20」「减 15%(封顶 ¥50)」「免运费」
   *
   * 句子用**插值**拼,不用片段拼接 —— 英文语序跟中文不一样,
   * 「满 ¥99」和「减 ¥20」拆成两个半截,英文就拼不出来了。
   */
  const describeCoupon = useCallback(
    (row: AdminCoupon): string => {
      const min = row.minAmountCents;
      const hasMin = min > 0;

      switch (row.kind) {
        case "amount":
          return hasMin
            ? t("table.amountDesc", {
                min: formatCents(min),
                amount: formatCents(row.amountCents ?? 0),
              })
            : t("table.amountDescNoMin", {
                amount: formatCents(row.amountCents ?? 0),
              });
        case "percent": {
          const percent = Math.round((row.discountRate ?? 0) * 100);
          const cap = row.maxDiscountCents;
          const body = hasMin
            ? t("table.percentDesc", {
                min: formatCents(min),
                percent,
              })
            : t("table.percentDescNoMin", { percent });
          return cap == null
            ? body
            : t("table.percentDescCapped", {
                percent: body,
                cap: formatCents(cap),
              });
        }
        case "free_shipping":
          return hasMin
            ? t("table.freeShippingDesc", { min: formatCents(min) })
            : t("table.freeShippingDescNoMin");
        default:
          return "—";
      }
    },
    [t]
  );

  const startCreate = (
    preset?: "amount" | "percent" | "freeShipping" | "firstOrder"
  ) => {
    setEditingId("__new__");
    form.resetFields();
    const base: CouponFormValues = {
      code: "",
      name: "",
      kind: "amount",
      amountYuan: 20,
      discountPercent: null,
      maxDiscountYuan: null,
      minAmountYuan: 99,
      scope: "both",
      firstOrderOnly: false,
      usageLimit: null,
      perUserLimit: null,
      startsAt: null,
      endsAt: null,
      isActive: true,
    };

    if (preset === "percent") {
      form.setFieldsValue({
        ...base,
        kind: "percent",
        discountPercent: 15,
        maxDiscountYuan: 50,
        amountYuan: null,
      });
      return;
    }
    if (preset === "freeShipping") {
      form.setFieldsValue({
        ...base,
        kind: "free_shipping",
        amountYuan: null,
        discountPercent: null,
        maxDiscountYuan: null,
        scope: "mall",
      });
      return;
    }
    if (preset === "firstOrder") {
      form.setFieldsValue({
        ...base,
        minAmountYuan: 0,
        firstOrderOnly: true,
      });
      return;
    }
    form.setFieldsValue(base);
  };

  /**
   * 填进表单(编辑已有的一张券)
   *
   * `useCallback` 的依赖只有 `form` —— antd 的 form 实例在组件生命周期里
   * 是稳定的,所以这个函数不会每次渲染都换新。列定义那个 `useMemo` 靠它
   * 保持稳定(不然整张表每次渲染都要重建列)。
   */
  const startEdit = useCallback(
    (row: AdminCoupon) => {
      setEditingId(row.id);
      form.resetFields();
      form.setFieldsValue({
        code: row.code,
        name: row.name,
        kind: row.kind,
        amountYuan: centsToYuan(row.amountCents),
        discountPercent:
          row.discountRate == null
            ? null
            : Math.round(row.discountRate * 10000) / 100,
        maxDiscountYuan: centsToYuan(row.maxDiscountCents),
        minAmountYuan: centsToYuan(row.minAmountCents),
        scope: row.scope,
        firstOrderOnly: row.firstOrderOnly,
        usageLimit: row.usageLimit,
        perUserLimit: row.perUserLimit,
        startsAt: row.startsAt ? dayjs(row.startsAt) : null,
        endsAt: row.endsAt ? dayjs(row.endsAt) : null,
        isActive: row.isActive,
      });
    },
    [form]
  );

  const handleSubmit = async () => {
    let values: CouponFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }

    saveCoupon({
      id: editingId === "__new__" ? null : editingId,
      code: values.code.trim(),
      name: values.name.trim(),
      kind: values.kind,
      // 表单里是元 / 百分比,服务端要整数分 / 小数 —— 换算只在这一层
      amountCents:
        values.kind === "amount" ? yuanToCents(values.amountYuan) : null,
      discountRate:
        values.kind === "percent"
          ? percentToRate(values.discountPercent)
          : null,
      maxDiscountCents:
        values.kind === "percent" ? yuanToCents(values.maxDiscountYuan) : null,
      minAmountCents: yuanToCents(values.minAmountYuan),
      scope: values.scope,
      firstOrderOnly: values.firstOrderOnly ?? false,
      usageLimit: values.usageLimit ?? null,
      perUserLimit: values.perUserLimit ?? null,
      startsAt: values.startsAt ? values.startsAt.toISOString() : null,
      endsAt: values.endsAt ? values.endsAt.toISOString() : null,
      isActive: values.isActive ?? true,
    });
  };

  /* ------------------------------------------------------------ 派生数据 -- */

  /** 表单里正在选的类型 —— 决定显示哪几个字段 */
  const watchedKind = Form.useWatch("kind", form) as CouponKind | undefined;
  const effectiveKind: CouponKind = watchedKind ?? "amount";

  const watchedScope = Form.useWatch("scope", form) as CouponScope | undefined;

  const rows = coupons ?? [];

  const columns: ColumnsType<AdminCoupon> = useMemo(
    () => [
      {
        title: t("table.code"),
        dataIndex: "code",
        key: "code",
        width: 140,
        render: (code: string, row) => (
          <div>
            <p className="font-mono text-xs font-medium">{code}</p>
            <p className="text-[11px] text-muted-foreground">{row.name}</p>
          </div>
        ),
      },
      {
        title: t("table.type"),
        dataIndex: "kind",
        key: "kind",
        width: 120,
        render: (k: CouponKind, row) => (
          <div className="flex flex-wrap gap-1">
            <Tag
              color={
                k === "amount" ? "blue" : k === "percent" ? "purple" : "cyan"
              }
            >
              {t(`kinds.${k}`)}
            </Tag>
            {row.firstOrderOnly ? (
              <Tag color="gold" icon={<UserRound className="h-3 w-3" />}>
                {t("table.firstOrderTag")}
              </Tag>
            ) : null}
          </div>
        ),
      },
      {
        title: t("table.benefit"),
        key: "benefit",
        render: (_, row) => (
          <span className="text-xs">{describeCoupon(row)}</span>
        ),
      },
      {
        title: t("table.scope"),
        dataIndex: "scope",
        key: "scope",
        width: 120,
        render: (s: CouponScope) => (
          <span className="text-xs text-muted-foreground">
            {t(`scopes.${s}`)}
          </span>
        ),
      },
      {
        title: t("table.usage"),
        key: "usage",
        width: 110,
        render: (_, row) => (
          <span className="font-mono text-xs">
            {row.usedCount}
            {row.usageLimit != null ? ` / ${row.usageLimit}` : ""}
          </span>
        ),
      },
      {
        title: t("table.validity"),
        key: "validity",
        width: 190,
        render: (_, row) => (
          <span className="text-[11px] text-muted-foreground">
            {row.startsAt
              ? new Date(row.startsAt).toLocaleDateString("zh-CN")
              : t("messages.instant")}
            {" → "}
            {row.endsAt
              ? new Date(row.endsAt).toLocaleDateString("zh-CN")
              : t("messages.forever")}
          </span>
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
        width: 160,
        render: (_, row) => (
          <div className="flex items-center gap-1">
            <Button size="small" type="text" onClick={() => startEdit(row)}>
              {t("actions.edit")}
            </Button>
            {row.isActive ? (
              <Button
                size="small"
                type="text"
                danger
                loading={isDeactivating}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => deactivate({ id: row.id })}
              >
                {t("actions.deactivate")}
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [deactivate, describeCoupon, isDeactivating, startEdit, t]
  );

  /* ------------------------------------------------------------ 渲染 ------ */

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        {loadError}
      </div>
    );
  }

  if (coupons === null) {
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
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Gift className="h-5 w-5 text-rose-600" />
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 预设 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <TagIcon className="h-4 w-4 text-sky-600" />
          {t("presets.title")}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("presets.subtitle")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<CircleDollarSign className="h-3.5 w-3.5" />}
            onClick={() => startCreate("amount")}
          >
            {t("presets.amount")}
          </Button>
          <Button
            icon={<BadgePercent className="h-3.5 w-3.5" />}
            onClick={() => startCreate("percent")}
          >
            {t("presets.percent")}
          </Button>
          <Button
            icon={<Truck className="h-3.5 w-3.5" />}
            onClick={() => startCreate("freeShipping")}
          >
            {t("presets.freeShipping")}
          </Button>
          <Button
            icon={<UserRound className="h-3.5 w-3.5" />}
            onClick={() => startCreate("firstOrder")}
          >
            {t("presets.firstOrder")}
          </Button>
          <Button
            type="primary"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => startCreate()}
          >
            {t("presets.blank")}
          </Button>
        </div>
      </section>

      {/* 编辑表单 —— 就地展开,不开弹窗 */}
      {editingId !== null ? (
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">
            {editingId === "__new__" ? t("form.create") : t("form.edit")}
          </h3>

          <Form form={form} layout="vertical">
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 lg:grid-cols-3">
              <Form.Item
                name="code"
                label={t("form.code")}
                extra={t("form.codeHint")}
                rules={[
                  { required: true, message: t("form.required") },
                  {
                    pattern: /^[A-Za-z0-9_-]+$/,
                    message: t("form.codePattern"),
                  },
                  { min: 2, max: 32, message: t("form.codeLength") },
                ]}
              >
                <Input placeholder="SUMMER20" className="font-mono" />
              </Form.Item>

              <Form.Item
                name="name"
                label={t("form.name")}
                extra={t("form.nameHint")}
                rules={[{ required: true, message: t("form.required") }]}
              >
                <Input placeholder={t("form.namePlaceholder")} />
              </Form.Item>

              <Form.Item name="kind" label={t("form.kind")}>
                <Select
                  options={[
                    { value: "amount", label: t("form.kindAmount") },
                    { value: "percent", label: t("form.kindPercent") },
                    {
                      value: "free_shipping",
                      label: t("form.kindFreeShipping"),
                    },
                  ]}
                />
              </Form.Item>

              {effectiveKind === "amount" ? (
                <Form.Item
                  name="amountYuan"
                  label={t("form.amount")}
                  extra={t("form.amountHint")}
                  rules={[{ required: true, message: t("form.required") }]}
                >
                  <InputNumber
                    min={0}
                    max={10_000}
                    step={1}
                    className="w-full"
                  />
                </Form.Item>
              ) : null}

              {effectiveKind === "percent" ? (
                <>
                  <Form.Item
                    name="discountPercent"
                    label={t("form.discount")}
                    extra={t("form.discountHint")}
                    rules={[{ required: true, message: t("form.required") }]}
                  >
                    <InputNumber
                      min={0.01}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                  </Form.Item>
                  <Form.Item
                    name="maxDiscountYuan"
                    label={t("form.maxDiscount")}
                    extra={t("form.maxDiscountHint")}
                  >
                    <InputNumber
                      min={0}
                      max={100_000}
                      step={1}
                      className="w-full"
                    />
                  </Form.Item>
                </>
              ) : null}

              <Form.Item
                name="minAmountYuan"
                label={t("form.minAmount")}
                extra={t("form.minAmountHint")}
              >
                <InputNumber
                  min={0}
                  max={1_000_000}
                  step={1}
                  className="w-full"
                />
              </Form.Item>

              <Form.Item
                name="scope"
                label={t("form.scope")}
                extra={t("form.scopeHint")}
              >
                <Select
                  options={[
                    { value: "mall", label: t("form.scopeMall") },
                    { value: "print", label: t("form.scopePrint") },
                    { value: "both", label: t("form.scopeBoth") },
                  ]}
                />
              </Form.Item>

              <Form.Item
                name="usageLimit"
                label={t("form.usageLimit")}
                extra={t("form.usageLimitHint")}
              >
                <InputNumber
                  min={1}
                  max={1_000_000}
                  step={1}
                  className="w-full"
                />
              </Form.Item>

              <Form.Item
                name="perUserLimit"
                label={t("form.perUserLimit")}
                extra={t("form.perUserLimitHint")}
              >
                <InputNumber
                  min={1}
                  max={1_000_000}
                  step={1}
                  className="w-full"
                />
              </Form.Item>

              <Form.Item
                name="startsAt"
                label={t("form.startsAt")}
                extra={t("form.startsAtHint")}
              >
                <DatePicker showTime className="w-full" />
              </Form.Item>

              <Form.Item
                name="endsAt"
                label={t("form.endsAt")}
                extra={t("form.endsAtHint")}
              >
                <DatePicker showTime className="w-full" />
              </Form.Item>
            </div>

            <Divider titlePlacement="left" plain>
              <span className="text-xs text-muted-foreground">
                {t("form.modifiers")}
              </span>
            </Divider>

            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">{t("form.firstOrder")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("form.firstOrderHint")}
                  </p>
                </div>
                <Form.Item name="firstOrderOnly" noStyle>
                  <Switch />
                </Form.Item>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">{t("form.active")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("form.activeHint")}
                  </p>
                </div>
                <Form.Item name="isActive" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </div>

            {watchedScope === "print" || watchedScope === "both" ? (
              <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                {t("form.scopePrintWarning")}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="primary" loading={isSaving} onClick={handleSubmit}>
                {isSaving ? t("form.saving") : t("form.save")}
              </Button>
              <Button
                onClick={() => {
                  setEditingId(null);
                  form.resetFields();
                }}
              >
                {t("form.cancel")}
              </Button>
            </div>
          </Form>
        </section>
      ) : null}

      {/* 列表 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <Table<AdminCoupon>
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: t("messages.empty") }}
        />

        <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="h-3 w-3 text-emerald-600" />
          {t("messages.instantEffect")}
        </p>
      </section>
    </div>
  );
}
