"use client";

/**
 * 下单表单 —— **内联在页面里**,不是弹窗
 *
 * 订单表单要填的东西不少(称呼 / 邮箱 / 电话 / 备注),塞进弹窗会被挤成
 * 一列窄输入框,而且弹窗关掉就丢了。这里直接展开在报价台下面,
 * 一屏能看完。
 *
 * 表单本身不碰网络 —— 提交时把值交给父组件(父组件负责打包模型 + 直传
 * R2 + 建单),这里只管收集和校验。
 */

import { AlertCircle, Loader2, Package, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { formatCents } from "@/features/print-quote/lib/format";
import type { PrintQuote } from "@/features/print-quote/lib/quote-types";

export type OrderContact = {
  name: string;
  email: string;
  phone: string;
  note: string;
};

export type OrderFormProps = {
  quote: PrintQuote | null;
  /** 模型文件名(下单时上传的那个) */
  modelName: string;
  /** 提交进度 */
  phase: "idle" | "uploading" | "submitting";
  error: string | null;
  onSubmit: (contact: OrderContact) => void;
  onCancel: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OrderForm({
  quote,
  modelName,
  phase,
  error,
  onSubmit,
  onCancel,
}: OrderFormProps) {
  const t = useTranslations("PrintQuote");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const busy = phase !== "idle";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (!name.trim()) {
      setFieldError(t("order.errors.name"));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setFieldError(t("order.errors.email"));
      return;
    }
    setFieldError(null);
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      note: note.trim(),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-stone-900">
            {t("order.formTitle")}
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            {t("order.formSubtitle")}
          </p>
        </div>
        {quote && (
          <div className="text-right">
            <p className="text-[11px] text-stone-500">{t("quote.total")}</p>
            <p className="font-mono text-lg font-semibold text-amber-700">
              {formatCents(quote.totalPriceCents)}
            </p>
          </div>
        )}
      </div>

      {/* 模型文件 —— 让用户看清楚要上传的是什么 */}
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-stone-200 bg-stone-50 p-3">
        <Package className="mt-0.5 size-4 shrink-0 text-stone-400" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-stone-700">
            {modelName}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
            {t("order.modelUploadHint")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pq-name" label={t("order.name")} required>
          <input
            id="pq-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            disabled={busy}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none transition-colors focus:border-stone-900 disabled:bg-stone-50"
          />
        </Field>

        <Field id="pq-email" label={t("order.email")} required>
          <input
            id="pq-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            disabled={busy}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none transition-colors focus:border-stone-900 disabled:bg-stone-50"
          />
        </Field>

        <Field id="pq-phone" label={t("order.phone")}>
          <input
            id="pq-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
            disabled={busy}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none transition-colors focus:border-stone-900 disabled:bg-stone-50"
          />
        </Field>

        <Field id="pq-note" label={t("order.note")}>
          <input
            id="pq-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            disabled={busy}
            placeholder={t("order.notePlaceholder")}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none transition-colors focus:border-stone-900 disabled:bg-stone-50"
          />
        </Field>
      </div>

      {(fieldError || error) && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {fieldError ?? error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !quote}
          className="inline-flex items-center gap-2 rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {phase === "uploading" ? (
            <>
              <Upload className="size-4" />
              {t("order.uploading")}
            </>
          ) : phase === "submitting" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("order.submitting")}
            </>
          ) : (
            <>
              <Package className="size-4" />
              {t("order.submit")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-stone-300 px-4 py-2.5 text-sm text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50"
        >
          {t("order.cancel")}
        </button>
        <p className="text-[11px] text-stone-400">{t("order.payHint")}</p>
      </div>
    </form>
  );
}

/**
 * 带标签的表单字段
 *
 * label 用 `htmlFor` 显式关联输入框(而不是把 input 塞进 label 里)——
 * 读屏软件认的是显式关联,点标签也能聚焦。
 */
function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium text-stone-600"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
