"use client";

/**
 * 2026-08-20：shadcn → antd 迁移（Phase 3.4）
 * - shadcn Dialog/Input/Label/Select/Button → antd
 * - sonner toast → antd App.useApp().message
 * - 用 antd Form.Item 包裹 label + input；Select options 数组
 *
 * 2026-08-24：代理商业务（ToB）—— 加 Collapse 块承载 4 个 cascading 字段。
 * 与 OrderFormDialog 同形态；但语义是"覆盖"：保存时直传 value || null，
 * 想清空 ToB 块就把 4 个 select 全部切到"未指定"。
 */

import { App, Button, Collapse, Form, Input, Modal, Select } from "antd";
import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { updateOrderAction } from "@/features/gpt-image/actions/orders";
import {
  ACCESSORIES,
  getProductType,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
import {
  ORDER_PLATFORM_LABELS,
  ORDER_PLATFORMS,
  type OrderPlatform,
  type OrderView,
} from "@/features/gpt-image/lib/types";

interface OrderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待编辑订单；null 时对话框不渲染内容 */
  order: OrderView | null;
  /** 编辑成功回调，传入最新 OrderView（用于乐观替换列表中的旧条目） */
  onUpdated: (order: OrderView) => void;
}

export function OrderEditDialog({
  open,
  onOpenChange,
  order,
  onUpdated,
}: OrderEditDialogProps) {
  const { message } = App.useApp();
  const [orderNo, setOrderNo] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [platform, setPlatform] = useState<OrderPlatform | "">("");
  const [uploadCount, setUploadCount] = useState(1);
  const [imagesPerUpload, setImagesPerUpload] = useState(3);
  const [regenerateLimit, setRegenerateLimit] = useState(5);
  const [saving, setSaving] = useState(false);
  // 三件套字段（管理员编辑存量订单时可改）
  const [productTypeCode, setProductTypeCode] = useState<string>("");
  const [productSize, setProductSize] = useState<string>("");
  const [accessoryCode, setAccessoryCode] = useState<string>("");

  // 每次打开时用 order 字段填充表单
  useEffect(() => {
    if (!open || !order) return;
    setOrderNo(order.orderNo);
    setRecipientName(order.recipientName ?? "");
    setPlatform((order.platform ?? "") as OrderPlatform | "");
    setUploadCount(order.uploadCount);
    setImagesPerUpload(order.imagesPerUpload ?? 3);
    setRegenerateLimit(order.regenerateLimit ?? 5);
    setProductTypeCode(order.productTypeCode ?? "");
    setProductSize(order.productSize ?? "");
    setAccessoryCode(order.accessoryCode ?? "");
  }, [open, order]);

  /**
   * 当前选中型号下的可选尺寸 / 配件（cascade）
   * 与 OrderFormDialog 同逻辑；没选型号时尺寸/配件 select 都禁用
   */
  const selectedProductType = useMemo(
    () => getProductType(productTypeCode),
    [productTypeCode]
  );
  const availableSizes = selectedProductType?.sizes ?? [];
  const availableAccessories = useMemo(() => {
    if (!selectedProductType) return [];
    return selectedProductType.accessories.map((code) => {
      const a = ACCESSORIES.find((x) => x.code === code);
      return a ?? { code, name: code };
    });
  }, [selectedProductType]);

  /**
   * 切换型号：清空尺寸与配件（避免遗留选项）
   */
  const handleProductTypeChange = (v: string) => {
    setProductTypeCode(v);
    setProductSize("");
    setAccessoryCode("");
  };

  const handleSave = async () => {
    if (!order) return;
    if (!orderNo.trim()) {
      message.error("请输入订单号");
      return;
    }
    setSaving(true);
    try {
      const res = await updateOrderAction({
        id: order.id,
        orderNo: orderNo.trim(),
        recipientName: recipientName.trim(),
        platform: platform || null,
        uploadCount,
        imagesPerUpload,
        regenerateLimit,
        // 三件套：编辑对话框语义是"覆盖"，value || null 让用户能直接清空
        productTypeCode: productTypeCode || null,
        productSize: productSize || null,
        accessoryCode: accessoryCode || null,
      });
      if (!res?.data) throw new Error("保存失败");
      message.success("订单已更新");
      onUpdated(res.data.order);
      onOpenChange(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => !saving && onOpenChange(false)}
      title="编辑订单"
      footer={[
        <Button
          key="cancel"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          onClick={handleSave}
          disabled={saving || !order}
          loading={saving}
        >
          保存修改
        </Button>,
      ]}
      width={480}
    >
      <p className="text-sm text-muted-foreground mb-4">
        仅业务字段（订单号、收件人、平台、上传数量、每批重试次数）可改；模板、访问链接、状态、上传内容保持不变。
      </p>

      {!order ? null : (
        <Form layout="vertical" className="space-y-3">
          <Form.Item label="订单号" required className="!mb-0">
            <Input
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground mt-1">
              订单号不必唯一；改完后历史访问链接不受影响（token 未动）。
            </p>
          </Form.Item>

          <Form.Item label="收件人（昵称/标识）" className="!mb-0">
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              maxLength={100}
              placeholder="留空表示未指定"
            />
          </Form.Item>

          <Form.Item label="来源平台" className="!mb-0">
            <Select
              value={platform || "_none"}
              onChange={(v) =>
                setPlatform(v === "_none" ? "" : (v as OrderPlatform))
              }
              options={[
                { value: "_none", label: "未指定" },
                ...ORDER_PLATFORMS.map((p) => ({
                  value: p,
                  label: ORDER_PLATFORM_LABELS[p],
                })),
              ]}
              placeholder="未指定"
              className="w-full"
            />
          </Form.Item>

          <Form.Item label="效果数量" className="!mb-0">
            <div className="flex items-stretch gap-2">
              <Button
                type="default"
                onClick={() => setUploadCount((n) => Math.max(1, n - 1))}
                disabled={uploadCount <= 1}
                aria-label="减少"
                icon={<Minus className="h-4 w-4" />}
              />
              <Input
                type="number"
                min={1}
                max={10}
                value={uploadCount}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setUploadCount(
                    Number.isNaN(n) ? 1 : Math.min(10, Math.max(1, n))
                  );
                }}
                className="text-center"
              />
              <Button
                type="default"
                onClick={() => setUploadCount((n) => Math.min(10, n + 1))}
                disabled={uploadCount >= 10}
                aria-label="增加"
                icon={<Plus className="h-4 w-4" />}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              修改后用户可继续按新批次上传；总容量 = 批次 × 每批张数。
            </p>
          </Form.Item>

          <Form.Item label="每批参考图数量" className="!mb-0">
            <div className="flex items-stretch gap-2">
              <Button
                type="default"
                onClick={() => setImagesPerUpload((n) => Math.max(1, n - 1))}
                disabled={imagesPerUpload <= 1}
                aria-label="减少"
                icon={<Minus className="h-4 w-4" />}
              />
              <Input
                type="number"
                min={1}
                max={3}
                value={imagesPerUpload}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setImagesPerUpload(
                    Number.isNaN(n) ? 1 : Math.min(3, Math.max(1, n))
                  );
                }}
                className="text-center"
              />
              <Button
                type="default"
                onClick={() => setImagesPerUpload((n) => Math.min(3, n + 1))}
                disabled={imagesPerUpload >= 3}
                aria-label="增加"
                icon={<Plus className="h-4 w-4" />}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              用户每次上传会话最多塞几张参考图。范围 1-3。
            </p>
          </Form.Item>

          <Form.Item label="每批重试次数" className="!mb-0">
            <div className="flex items-stretch gap-2">
              <Button
                type="default"
                onClick={() => setRegenerateLimit((n) => Math.max(0, n - 1))}
                disabled={regenerateLimit <= 0}
                aria-label="减少"
                icon={<Minus className="h-4 w-4" />}
              />
              <Input
                type="number"
                min={0}
                max={20}
                value={regenerateLimit}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setRegenerateLimit(
                    Number.isNaN(n) ? 0 : Math.min(20, Math.max(0, n))
                  );
                }}
                className="text-center"
              />
              <Button
                type="default"
                onClick={() => setRegenerateLimit((n) => Math.min(20, n + 1))}
                disabled={regenerateLimit >= 20}
                aria-label="增加"
                icon={<Plus className="h-4 w-4" />}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              每个效果图最多尝试次数，含首次。例如填 5 = 1 次首次 + 4
              次重新生成。 仅单图重新生成路径计数，批量重跑 / FAILED
              一键重试不计。
            </p>
          </Form.Item>

          {/* ============================================
              2026-09-08：(agent) 业务砍掉后只剩三件套编辑。
              管理员编辑存量订单时改 productTypeCode / productSize / accessoryCode。
              ============================================ */}
          <Collapse
            ghost
            defaultActiveKey={["product"]}
            items={[
              {
                key: "product",
                label: (
                  <span className="flex items-center gap-1.5 text-sm text-stone-600">
                    产品规格
                    {productTypeCode ? (
                      <span className="text-[10px] text-violet-600 font-medium">
                        · 已绑定 {productTypeCode}
                      </span>
                    ) : (
                      <span className="text-[10px] text-stone-400 font-normal">
                        · 未指定
                      </span>
                    )}
                  </span>
                ),
                extra: (
                  <span className="text-xs text-stone-400">
                    {productTypeCode
                      ? "改型号 / 改尺寸 / 改配件"
                      : "默认留空 = 不绑型号"}
                  </span>
                ),
                children: (
                  <div className="grid grid-cols-1 gap-y-3 pb-1">
                    <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                      <span className="text-sm">产品型号</span>
                      <Select
                        value={productTypeCode || "_none"}
                        onChange={(v) =>
                          handleProductTypeChange(v === "_none" ? "" : v)
                        }
                        placeholder="未指定"
                        className="w-full"
                        options={[
                          { value: "_none", label: "未指定" },
                          ...PRODUCT_TYPES.map((t) => ({
                            value: t.code,
                            label: `${t.code} · ${t.name}`,
                          })),
                        ]}
                      />
                    </div>

                    <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                      <span className="text-sm">
                        尺寸{" "}
                        {!selectedProductType && (
                          <span className="text-xs font-normal text-zinc-400">
                            （先选型号）
                          </span>
                        )}
                      </span>
                      <Select
                        value={productSize || "_none"}
                        onChange={(v) => setProductSize(v === "_none" ? "" : v)}
                        placeholder={
                          selectedProductType ? "未指定" : "请先选择型号"
                        }
                        className="w-full"
                        disabled={!selectedProductType}
                        options={[
                          { value: "_none", label: "未指定" },
                          ...availableSizes.map((s) => ({
                            value: s,
                            label: `${s}cm`,
                          })),
                        ]}
                      />
                    </div>

                    <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                      <span className="text-sm">配件</span>
                      <Select
                        value={accessoryCode || "_none"}
                        onChange={(v) =>
                          setAccessoryCode(v === "_none" ? "" : v)
                        }
                        placeholder={
                          selectedProductType
                            ? availableAccessories.length === 0
                              ? "该型号无配件选项"
                              : "未指定"
                            : "请先选择型号"
                        }
                        className="w-full"
                        disabled={
                          !selectedProductType ||
                          availableAccessories.length === 0
                        }
                        options={[
                          { value: "_none", label: "未指定" },
                          ...availableAccessories.map((a) => ({
                            value: a.code,
                            label: a.name,
                          })),
                        ]}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
            className="rounded-lg border border-dashed border-stone-200 bg-stone-50/50"
          />

          <div className="rounded-md border bg-slate-50 p-3 text-xs text-muted-foreground">
            <div className="mb-1 font-medium text-slate-700">不可修改</div>
            <ul className="list-inside list-disc space-y-0.5">
              <li>模板：{order.template.name}</li>
              <li>访问链接：/p/{order.token}</li>
              <li>状态：{order.status}</li>
            </ul>
          </div>
        </Form>
      )}
    </Modal>
  );
}
