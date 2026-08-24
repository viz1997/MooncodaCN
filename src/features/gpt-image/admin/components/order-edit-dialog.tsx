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

import {
  App,
  Button,
  Collapse,
  Form,
  Input,
  Modal,
  Select,
  Tooltip,
} from "antd";
import { Briefcase, HelpCircle, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { listActiveAgentsAction } from "@/features/agent/actions/agents";
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
  // ============================================
  // 2026-08-24：代理商业务（ToB）—— 编辑时可改 / 可清空
  // ============================================
  const [activeAgents, setActiveAgents] = useState<
    { id: string; name: string; contact: string | null }[]
  >([]);
  const [agentId, setAgentId] = useState<string>("");
  const [productTypeCode, setProductTypeCode] = useState<string>("");
  const [productSize, setProductSize] = useState<string>("");
  const [accessoryCode, setAccessoryCode] = useState<string>("");

  // 打开时拉代理商列表（与 OrderFormDialog 共用 action）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listActiveAgentsAction()
      .then((res) => {
        if (cancelled) return;
        if (res?.data?.agents) {
          setActiveAgents(res.data.agents);
        }
      })
      .catch((err) => {
        console.error("[OrderEditDialog] 加载代理商列表失败：", err);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 每次打开时用 order 字段填充表单
  useEffect(() => {
    if (!open || !order) return;
    setOrderNo(order.orderNo);
    setRecipientName(order.recipientName ?? "");
    setPlatform((order.platform ?? "") as OrderPlatform | "");
    setUploadCount(order.uploadCount);
    setImagesPerUpload(order.imagesPerUpload ?? 3);
    setRegenerateLimit(order.regenerateLimit ?? 5);
    setAgentId(order.agentId ?? "");
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
        // 2026-08-24：代理商业务字段 —— 编辑对话框语义是"覆盖"，
        // 不再像之前那样回退到 order 的旧值；value || null 让用户能直接清空 ToB 块
        agentId: agentId || null,
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
        仅业务字段（订单号、收件人、平台、上传数量、重新生成次数）可改；模板、访问链接、状态、上传内容保持不变。
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

          <Form.Item label="用户上传批次（次数）" className="!mb-0">
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

          <Form.Item label="每批上传原图数量" className="!mb-0">
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

          <Form.Item label="用户重新生成次数上限" className="!mb-0">
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
              仅"重新生成第 N 张"（单图路径）计数；批量重跑 / FAILED
              一键重试不计。
            </p>
          </Form.Item>

          {/* ============================================
              2026-08-24：代理商业务（ToB）—— 可编辑
              默认展开：如果 order 原本就绑了 ToB 数据，自动让用户看到；ToC
              订单也展开，方便把"无意中归到 ToB"或反过来切换。
              ============================================ */}
          <Collapse
            ghost
            defaultActiveKey={["agent"]}
            items={[
              {
                key: "agent",
                label: (
                  <span className="flex items-center gap-1.5 text-sm text-stone-600">
                    <Briefcase className="h-3.5 w-3.5" />
                    代理商业务（ToB）
                    {agentId ? (
                      <span className="text-[10px] text-violet-600 font-medium">
                        · 已绑定
                      </span>
                    ) : (
                      <span className="text-[10px] text-stone-400 font-normal">
                        · 未绑定（ToC）
                      </span>
                    )}
                  </span>
                ),
                extra: (
                  <span className="text-xs text-stone-400">
                    {agentId ? "改代理商 / 改规格" : "默认留空 = ToC 订单"}
                  </span>
                ),
                children: (
                  <div className="grid grid-cols-1 gap-y-3 pb-1">
                    <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                      <div className="flex items-center gap-1">
                        <span className="text-sm">代理商</span>
                        <Tooltip title="编辑时可切换或清空；清空后订单回到 ToC。">
                          <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
                        </Tooltip>
                      </div>
                      <Select
                        value={agentId || "_none"}
                        onChange={(v) => setAgentId(v === "_none" ? "" : v)}
                        placeholder={
                          activeAgents.length === 0
                            ? "暂无可用代理商"
                            : "未指定（ToC 订单）"
                        }
                        className="w-full"
                        options={[
                          { value: "_none", label: "未指定（ToC 订单）" },
                          ...activeAgents.map((a) => ({
                            value: a.id,
                            label: a.contact
                              ? `${a.name} · ${a.contact}`
                              : a.name,
                          })),
                        ]}
                        disabled={activeAgents.length === 0}
                      />
                    </div>

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
