"use client";

/**
 * 收货地址区块 —— 商城结算页共用
 *
 * ## 为什么抽出来
 *
 * 「选一个地址 / 新建一个地址」在好几处都要出现(商城结算页、工单详情页
 * 的改地址、账号页的地址管理)。各写一遍的话,改一次地址表单要改好几处 ——
 * 而且「默认地址」的逻辑一旦漂移,用户在两个页面看到的默认地址不一样,会
 * 以为系统有毛病。
 *
 * ## 状态在**组件自己**里
 *
 * 父组件只关心「选中了哪个地址 id」(`value` / `onChange`)。地址列表、
 * 新建表单、错误提示都在这儿 —— 父组件不需要知道这些。
 *
 * 新建地址成功后**直接把新地址选中**:用户刚填完,意图很明确。
 */

import { ChevronUp, Loader2, Plus } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { createAddressAction } from "../actions";
import type { AddressErrorCode, AddressView } from "../types";

/** 地址表单的失败文案 */
const ADDRESS_ERROR_TEXT: Record<AddressErrorCode, string> = {
  ADDRESS_NOT_FOUND: "地址不存在",
  INVALID_INPUT: "填写的信息不合法",
  TOO_MANY_ADDRESSES: "保存的地址太多了(最多 20 个)",
  FAILED: "保存失败,请稍后重试",
};

export function AddressSection({
  addresses,
  value,
  onChange,
}: {
  /** 地址簿(服务端查好传进来) */
  addresses: AddressView[];
  /** 选中的地址 id */
  value: string | null;
  /** 选中变了(父组件拿去结算) */
  onChange: (addressId: string) => void;
}) {
  const [addressList, setAddressList] = useState<AddressView[]>(addresses);
  const [showForm, setShowForm] = useState(addresses.length === 0);
  const [form, setForm] = useState(emptyAddressForm());
  const [addressError, setAddressError] = useState<string | null>(null);

  const createAddress = useAction(createAddressAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setAddressError(null);
        setForm(emptyAddressForm());
        setShowForm(false);
        // 新建的地址直接选中 —— 用户刚填完,意图很明确
        onChange(data.addressId);
        setAddressList((prev) => [
          {
            id: data.addressId,
            ...form,
            isDefault: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        return;
      }
      setAddressError(
        ADDRESS_ERROR_TEXT[(data?.code ?? "FAILED") as AddressErrorCode]
      );
    },
    onError: ({ error }) => {
      setAddressError(error.serverError ?? "保存失败,请稍后重试");
    },
  });

  return (
    <>
      {addressList.length > 0 && (
        <ul className="space-y-3">
          {addressList.map((address) => (
            <li key={address.id}>
              <label
                className={`flex gap-3 p-4 border rounded-sm cursor-pointer transition-colors ${
                  value === address.id
                    ? "border-primary bg-secondary/40"
                    : "border-border hover:bg-secondary/30"
                }`}
              >
                <input
                  type="radio"
                  name="checkout-address"
                  value={address.id}
                  checked={value === address.id}
                  onChange={() => onChange(address.id)}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {address.recipientName}
                    <span className="text-muted-foreground font-normal">
                      {address.phone}
                    </span>
                    {address.isDefault && (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-accent">
                        默认
                      </span>
                    )}
                  </span>
                  <span className="block mt-1 text-xs text-muted-foreground">
                    {[
                      address.province,
                      address.city,
                      address.district,
                      address.detail,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* 新建地址 —— 展开,不弹窗 */}
      <div className="mt-4">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full"
        >
          {showForm ? (
            <ChevronUp className="size-4" />
          ) : (
            <Plus className="size-4" />
          )}
          {showForm ? "收起" : "新建收货地址"}
        </Button>

        {showForm && (
          <form
            className="mt-4 p-5 border border-border rounded-sm space-y-3 bg-secondary/20"
            onSubmit={(e) => {
              e.preventDefault();
              void createAddress.execute(form);
            }}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <AddressField
                label="收件人"
                value={form.recipientName}
                onChange={(v) => setForm({ ...form, recipientName: v })}
                placeholder="张三"
              />
              <AddressField
                label="手机号"
                value={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
                placeholder="13800000000"
              />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <AddressField
                label="省"
                value={form.province}
                onChange={(v) => setForm({ ...form, province: v })}
                placeholder="广东省"
              />
              <AddressField
                label="市"
                value={form.city}
                onChange={(v) => setForm({ ...form, city: v })}
                placeholder="深圳市"
              />
              <AddressField
                label="区"
                value={form.district}
                onChange={(v) => setForm({ ...form, district: v })}
                placeholder="南山区"
              />
            </div>
            <AddressField
              label="详细地址"
              value={form.detail}
              onChange={(v) => setForm({ ...form, detail: v })}
              placeholder="科技园路 1 号 3 栋 502"
            />

            {addressError && (
              <p className="text-xs text-destructive">{addressError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                size="sm"
                disabled={createAddress.isPending}
                className="rounded-full"
              >
                {createAddress.isPending && (
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
                  setForm(emptyAddressForm());
                  setAddressError(null);
                  setShowForm(false);
                }}
              >
                取消
              </Button>
            </div>
          </form>
        )}
      </div>

      {addressError && !showForm && (
        <p className="mt-3 text-xs text-destructive">{addressError}</p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  子组件                                                                     */
/* -------------------------------------------------------------------------- */

function AddressField({
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
      <span className="block text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-border rounded-sm bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*  工具                                                                       */
/* -------------------------------------------------------------------------- */

function emptyAddressForm() {
  return {
    recipientName: "",
    phone: "",
    province: "",
    city: "",
    district: "",
    detail: "",
  };
}
