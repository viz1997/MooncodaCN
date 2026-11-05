/**
 * AddressBook —— 「收货地址」页
 *
 * ## 全部**展开**,不弹窗
 *
 * 地址簿是个「随时要改」的地方 —— 改一下收件人、换个门牌号。弹窗会把用户
 * 从「看我的地址」这个上下文里拽走,填完还要再点一次回来。展开一块表单就地
 * 填,填完保存,原地收起。
 *
 * ## 失败要说出原因
 *
 * server action 返回 `{ok:false, code}`,这里按 code 找文案 —— 不能只弹一句
 * 「操作失败」,用户不知道自己哪里做错了。
 *
 * ## 状态放在组件里,不用 TanStack Query
 *
 * 地址簿的数据量是「一个人几个地址」(上限 20)。改完直接重渲染就行,不用
 * 再拉一遍 —— 少一次往返,少一个缓存失效的坑。
 */

"use client";

import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import {
  createAddressAction,
  deleteAddressAction,
  setDefaultAddressAction,
  updateAddressAction,
} from "../actions";
import type { AddressErrorCode, AddressView } from "../types";

/** 地址表单的错误文案 */
const ERROR_TEXT: Record<AddressErrorCode, string> = {
  ADDRESS_NOT_FOUND: "地址不存在",
  INVALID_INPUT: "填写的信息不合法",
  TOO_MANY_ADDRESSES: "保存的地址太多了(最多 20 个)",
  FAILED: "操作失败,请稍后重试",
};

/** 表单里的空值 */
const EMPTY_FORM = {
  recipientName: "",
  phone: "",
  province: "",
  city: "",
  district: "",
  detail: "",
};

export function AddressBook({
  initialAddresses,
}: {
  initialAddresses: AddressView[];
}) {
  const [addresses, setAddresses] = useState<AddressView[]>(initialAddresses);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const create = useAction(createAddressAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setAddresses((prev) => [
          {
            id: data.addressId,
            ...form,
            isDefault: prev.length === 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setForm(EMPTY_FORM);
        setShowCreate(false);
        setError(null);
        return;
      }
      setError(ERROR_TEXT[(data?.code ?? "FAILED") as AddressErrorCode]);
    },
    onError: ({ error: actionError }) => {
      setError(actionError.serverError ?? "保存失败,请稍后重试");
    },
  });

  const update = useAction(updateAddressAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setAddresses((prev) =>
          prev.map((a) =>
            a.id === data.addressId
              ? {
                  ...a,
                  ...form,
                  updatedAt: new Date().toISOString(),
                }
              : a
          )
        );
        setEditingId(null);
        setForm(EMPTY_FORM);
        setError(null);
        return;
      }
      setError(ERROR_TEXT[(data?.code ?? "FAILED") as AddressErrorCode]);
    },
    onError: ({ error: actionError }) => {
      setError(actionError.serverError ?? "保存失败,请稍后重试");
    },
  });

  const setDefault = useAction(setDefaultAddressAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setAddresses((prev) =>
          prev.map((a) => ({ ...a, isDefault: a.id === data.addressId }))
        );
        setError(null);
        return;
      }
      setError(ERROR_TEXT[(data?.code ?? "FAILED") as AddressErrorCode]);
    },
    onError: ({ error: actionError }) => {
      setError(actionError.serverError ?? "操作失败,请稍后重试");
    },
  });

  const remove = useAction(deleteAddressAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setAddresses((prev) => prev.filter((a) => a.id !== data.addressId));
        setError(null);
        return;
      }
      setError(ERROR_TEXT[(data?.code ?? "FAILED") as AddressErrorCode]);
    },
    onError: ({ error: actionError }) => {
      setError(actionError.serverError ?? "删除失败,请稍后重试");
    },
  });

  const startEdit = (address: AddressView) => {
    setEditingId(address.id);
    setShowCreate(false);
    setError(null);
    setForm({
      recipientName: address.recipientName,
      phone: address.phone,
      province: address.province,
      city: address.city,
      district: address.district,
      detail: address.detail,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl">收货地址</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            下单时会选其中一个。地址改了不会影响已经下的订单 —— 订单上存的是
            下单那一刻的地址快照。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full shrink-0"
          type="button"
          onClick={() => {
            setShowCreate((v) => !v);
            setEditingId(null);
            setForm(EMPTY_FORM);
            setError(null);
          }}
        >
          {showCreate ? <X className="size-4" /> : <Plus className="size-4" />}
          {showCreate ? "收起" : "新建地址"}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {/* 新建 —— 展开,不弹窗 */}
      {showCreate && (
        <form
          className="rounded-md border border-border p-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create.execute(form);
          }}
        >
          <AddressFields form={form} setForm={setForm} />
          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              size="sm"
              disabled={create.isPending}
              className="rounded-full"
            >
              {create.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              保存地址
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setShowCreate(false);
                setForm(EMPTY_FORM);
              }}
            >
              取消
            </Button>
          </div>
        </form>
      )}

      {addresses.length === 0 && !showCreate ? (
        <p className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
          还没有收货地址 —— 点右上角「新建地址」加一个。
        </p>
      ) : (
        <ul className="space-y-3">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="rounded-md border border-border p-4 flex flex-wrap items-start gap-3"
            >
              {editingId === address.id ? (
                <form
                  className="w-full space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void update.execute({ addressId: address.id, ...form });
                  }}
                >
                  <AddressFields form={form} setForm={setForm} />
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={update.isPending}
                      className="rounded-full"
                    >
                      {update.isPending && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      保存
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={cancelEdit}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {address.recipientName}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {address.phone}
                      </span>
                      {address.isDefault && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                          默认
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[
                        address.province,
                        address.city,
                        address.district,
                        address.detail,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!address.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full"
                        type="button"
                        disabled={setDefault.isPending}
                        onClick={() =>
                          void setDefault.execute({ addressId: address.id })
                        }
                      >
                        <Check className="size-3.5" />
                        设为默认
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      type="button"
                      aria-label="编辑地址"
                      onClick={() => startEdit(address)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      type="button"
                      aria-label="删除地址"
                      disabled={remove.isPending}
                      onClick={() =>
                        void remove.execute({ addressId: address.id })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  表单字段                                                                   */
/* -------------------------------------------------------------------------- */

function AddressFields({
  form,
  setForm,
}: {
  form: typeof EMPTY_FORM;
  setForm: (form: typeof EMPTY_FORM) => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="收件人"
          value={form.recipientName}
          onChange={(v) => setForm({ ...form, recipientName: v })}
          placeholder="张三"
        />
        <Field
          label="手机号"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
          placeholder="13800000000"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="省"
          value={form.province}
          onChange={(v) => setForm({ ...form, province: v })}
          placeholder="广东省"
        />
        <Field
          label="市"
          value={form.city}
          onChange={(v) => setForm({ ...form, city: v })}
          placeholder="深圳市"
        />
        <Field
          label="区"
          value={form.district}
          onChange={(v) => setForm({ ...form, district: v })}
          placeholder="南山区"
        />
      </div>
      <Field
        label="详细地址"
        value={form.detail}
        onChange={(v) => setForm({ ...form, detail: v })}
        placeholder="科技园路 1 号 3 栋 502"
      />
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
      />
    </label>
  );
}
