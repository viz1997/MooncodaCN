"use client";

/**
 * 淘宝链接后台 —— `/admin/taobao-links`
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 淘宝的商品页,在淘宝付款(享受平台担保)。钱进的是**淘宝那个账户**,不在本
 * 仓库的收钱链路里 ⇒ 工作室在淘宝后台看到钱到了,再回本站把那笔单**手工
 * 标成已收款**(在 `/admin/store-orders`)。
 *
 * 这一页只干一件事:**把「本站这件设计」和「淘宝上那个商品」连起来**。
 *
 * ## 一行 = 一件设计
 *
 * 商城卖的是 12 件设计(4 钥匙扣 + 4 手办 + 4 冰箱贴)—— 淘宝那边**每个设计
 * 一个链接**,所以链接挂在 **handle** 上,不是型号上。
 *
 * ## 就地展开,不开弹窗
 *
 * 工作室的口味(跟优惠码后台 / 发货台一个路子):配置界面在页面上直接处理,
 * 不要弹窗挡住别的内容 —— 弹窗一开,工作室就看不见这一行还缺什么。
 *
 * ## 停用而不是删
 *
 * 链接停用之后这件设计**不再能选淘宝下单**,但链接留着 —— 工作室在淘宝
 * 后台看到一笔历史单,还能查到当初跳到哪个链接去了。
 */

import { App, Button, Form, Input, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  Check,
  ExternalLink,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  adminDeleteTaobaoLinkAction,
  adminListTaobaoLinksAction,
  adminSaveTaobaoLinkAction,
  adminSetTaobaoLinkActiveAction,
} from "@/features/taobao/admin/actions";
import {
  type AdminTaobaoLinkRow,
  TAOBAO_ERROR_TEXT_KEYS,
} from "@/features/taobao/admin/types";
import { checkTaobaoUrl } from "@/features/taobao/lib/taobao-link";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

/** 一行展开区里的表单值 */
type LinkFormValues = {
  url: string;
  note?: string;
  isActive: boolean;
};

/* -------------------------------------------------------------------------- */
/*  主组件                                                                      */
/* -------------------------------------------------------------------------- */

export function TaobaoLinksAdminView() {
  const t = useTranslations("AdminTaobaoLinks");
  const locale = useLocale();
  const { message } = App.useApp();

  const [rows, setRows] = useState<AdminTaobaoLinkRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 展开着的那一行(handle)—— null = 都没展开 */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminListTaobaoLinksAction();
      const data = res?.data;
      if (data?.ok === true) {
        setRows(data.rows);
        setLoadError(null);
        return;
      }
      if (data?.ok === false) {
        setLoadError(t(TAOBAO_ERROR_TEXT_KEYS[data.code]));
        return;
      }
    } catch {
      setLoadError(t("messages.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: setActive, isPending: isToggling } = useAction(
    adminSetTaobaoLinkActiveAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(TAOBAO_ERROR_TEXT_KEYS[data.code]));
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

  const { execute: removeLink, isPending: isDeleting } = useAction(
    adminDeleteTaobaoLinkAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(TAOBAO_ERROR_TEXT_KEYS[data.code]));
          return;
        }
        message.success(t("messages.deleteSuccess"));
        setExpandedKey(null);
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  /* ------------------------------------------------------------ 派生数据 -- */

  /** 配了几条(启用中的)—— 页头那句话用 */
  const activeCount = useMemo(
    () => (rows ?? []).filter((row) => row.hasLink && row.isActive).length,
    [rows]
  );

  const columns: ColumnsType<AdminTaobaoLinkRow> = useMemo(
    () => [
      {
        title: t("table.design"),
        key: "design",
        render: (_, row) => (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">
              {locale === "en" ? row.titleEn : row.title}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {locale === "en" ? row.typeLabelEn : row.typeLabel} ·{" "}
              {locale === "en" ? row.seriesNameEn : row.seriesName}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground/80">
              {row.productHandle}
            </p>
          </div>
        ),
      },
      {
        title: t("table.link"),
        key: "link",
        render: (_, row) =>
          row.url ? (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-[280px] items-center gap-1 truncate text-xs text-blue-600 hover:underline"
            >
              <span className="truncate">{row.url}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <Tag bordered={false}>{t("status.notConfigured")}</Tag>
          ),
      },
      {
        title: t("table.itemId"),
        dataIndex: "itemId",
        key: "itemId",
        width: 130,
        render: (itemId: string | null) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {itemId ?? "—"}
          </span>
        ),
      },
      {
        title: t("table.status"),
        key: "status",
        width: 110,
        render: (_, row) => {
          if (!row.hasLink) {
            return <Tag bordered={false}>{t("status.notConfigured")}</Tag>;
          }
          return row.isActive ? (
            <Tag color="green" bordered={false}>
              {t("status.active")}
            </Tag>
          ) : (
            <Tag bordered={false}>{t("status.inactive")}</Tag>
          );
        },
      },
      {
        title: t("table.actions"),
        key: "actions",
        width: 200,
        render: (_, row) => (
          <div className="flex items-center gap-1">
            <Button
              size="small"
              type="text"
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() =>
                setExpandedKey((current) =>
                  current === row.productHandle ? null : row.productHandle
                )
              }
            >
              {t("actions.edit")}
            </Button>
            {row.hasLink ? (
              <Button
                size="small"
                type="text"
                loading={isToggling}
                onClick={() =>
                  setActive({
                    productHandle: row.productHandle,
                    isActive: !row.isActive,
                  })
                }
              >
                {row.isActive ? t("actions.deactivate") : t("actions.activate")}
              </Button>
            ) : null}
            {row.hasLink ? (
              <Button
                size="small"
                type="text"
                danger
                loading={isDeleting}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => removeLink({ productHandle: row.productHandle })}
              >
                {t("actions.delete")}
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [isDeleting, isToggling, locale, removeLink, setActive, t]
  );

  /* ------------------------------------------------------------ 渲染 ------ */

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        {loadError}
      </div>
    );
  }

  if (rows === null) {
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
          <Link2 className="h-5 w-5 text-orange-600" />
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 这条路是怎么走钱的 —— 摆在前头,别让工作室以为钱进本站 */}
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <h3 className="mb-1 text-sm font-semibold text-amber-800">
          {t("notice.title")}
        </h3>
        <p className="text-xs leading-relaxed text-amber-800/90">
          {t("notice.detail")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-amber-800/90">
          {t("notice.detail2")}
        </p>
      </section>

      {/* 列表 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("list.title")}</h3>
          <p className="text-[11px] text-muted-foreground">
            {t("list.summary", { count: activeCount, total: rows.length })}
          </p>
        </div>

        <Table<AdminTaobaoLinkRow>
          size="small"
          rowKey="productHandle"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: t("messages.empty") }}
          expandable={{
            expandedRowKeys: expandedKey ? [expandedKey] : [],
            onExpand: (expanded) => {
              setExpandedKey(expanded ? String(expanded) : null);
            },
            expandedRowRender: (row) => (
              <TaobaoLinkRowForm
                key={row.productHandle}
                row={row}
                onSaved={() => {
                  setExpandedKey(null);
                  void load();
                }}
                onCancel={() => setExpandedKey(null)}
              />
            ),
          }}
        />

        <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="h-3 w-3 text-emerald-600" />
          {t("messages.instantEffect")}
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  一行的编辑表单(展开区里)                                                    */
/* -------------------------------------------------------------------------- */

function TaobaoLinkRowForm(props: {
  row: AdminTaobaoLinkRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { row, onSaved, onCancel } = props;
  const t = useTranslations("AdminTaobaoLinks");
  const { message } = App.useApp();
  const [form] = Form.useForm<LinkFormValues>();

  /**
   * 链接的校验 —— **用仓库那份纯函数**,不另写一遍
   *
   * `checkTaobaoUrl()` 是纯函数(零 import),服务端 action 用的也是它 ⇒
   * 前端和服务端的判断**不可能漂**。
   */
  const validateUrl = useCallback(
    (_rule: unknown, value: string) => {
      const check = checkTaobaoUrl(value ?? "");
      if (check.ok) return Promise.resolve();
      return Promise.reject(
        new Error(t(TAOBAO_ERROR_TEXT_KEYS[check.problem]))
      );
    },
    [t]
  );

  const { execute: save, isPending } = useAction(adminSaveTaobaoLinkAction, {
    onSuccess: ({ data }) => {
      if (data?.ok === false) {
        message.error(t(TAOBAO_ERROR_TEXT_KEYS[data.code]));
        return;
      }
      message.success(t("messages.saveSuccess"));
      onSaved();
    },
    onError: ({ error }) => {
      message.error(error.serverError ?? t("errors.SAVE_FAILED"));
    },
  });

  const submit = useCallback(async () => {
    let values: LinkFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已经标出哪个字段不对
    }
    save({
      productHandle: row.productHandle,
      url: values.url.trim(),
      note: values.note?.trim() || null,
      isActive: values.isActive ?? true,
    });
  }, [form, row.productHandle, save]);

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{
        url: row.url ?? "",
        note: row.note ?? "",
        isActive: row.hasLink ? row.isActive : true,
      }}
      className="max-w-3xl"
    >
      <Form.Item
        name="url"
        label={t("form.url")}
        extra={t("form.urlHint")}
        rules={[
          { required: true, message: t("form.required") },
          { validator: validateUrl },
        ]}
      >
        <Input placeholder={t("form.urlPlaceholder")} className="font-mono" />
      </Form.Item>

      <Form.Item name="note" label={t("form.note")} extra={t("form.noteHint")}>
        <Input.TextArea rows={2} maxLength={200} />
      </Form.Item>

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

      <div className="mt-3 flex items-center gap-2">
        <Button type="primary" loading={isPending} onClick={submit}>
          {isPending ? t("form.saving") : t("form.save")}
        </Button>
        <Button onClick={onCancel}>{t("form.cancel")}</Button>
      </div>
    </Form>
  );
}
