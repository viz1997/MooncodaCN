"use client";

/**
 * 2026-08-20：shadcn → antd 迁移（Phase 3.4）
 * - shadcn Dialog/Collapsible/Tooltip/Input/Label/Select/Button → antd
 * - sonner toast → antd App.useApp().message
 * - Collapsible 改为 antd Collapse
 * - Tooltip 改为 antd Tooltip
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
import {
  Briefcase,
  ChevronDown,
  HelpCircle,
  Minus,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { listActiveAgentsAction } from "@/features/agent/actions/agents";
import {
  checkOrderNoConflictAction,
  createOrderAction,
} from "@/features/gpt-image/actions/orders";
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
  type PromptTemplateView,
} from "@/features/gpt-image/lib/types";

interface OrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PromptTemplateView[];
  /** 模板是否仍在加载（区分"还在拉"与"拉完但没有"） */
  templatesLoading?: boolean | undefined;
  /** 模板加载失败的错误信息；非空时显示红色提示 + 重新加载按钮 */
  templatesError?: string | null | undefined;
  /** 触发父组件重新调用 fetchTemplates */
  onRetryTemplates?: () => void;
  /** 创建成功回调，传入完整 OrderView（用于乐观插入列表） */
  onCreated: (order: OrderView) => void;
}

/**
 * 冲突的现有订单信息（来自 checkOrderNoConflictAction）
 */
interface ConflictOrder {
  id: string;
  orderNo: string;
  recipientName: string;
  templateName: string;
  createdAt: string;
}

export function OrderFormDialog({
  open,
  onOpenChange,
  templates,
  templatesLoading = false,
  templatesError = null,
  onRetryTemplates,
  onCreated,
}: OrderFormDialogProps) {
  const { message } = App.useApp();
  const [orderNo, setOrderNo] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [platform, setPlatform] = useState<OrderPlatform | "">("");
  const [uploadCount, setUploadCount] = useState(1);
  const [imagesPerUpload, setImagesPerUpload] = useState(3);
  const [regenerateLimit, setRegenerateLimit] = useState(5);
  const [saving, setSaving] = useState(false);
  /** 冲突确认弹窗的待覆盖订单 */
  const [pendingConflict, setPendingConflict] = useState<ConflictOrder | null>(
    null
  );
  /** 冲突检查的 loading，避免按钮闪烁 */
  const [checkingConflict, setCheckingConflict] = useState(false);
  // ============================================
  // 2026-08-23：代理商业务（ToB 订单专属字段）
  // ============================================
  /** 启用的代理商列表（picker） */
  const [activeAgents, setActiveAgents] = useState<
    { id: string; name: string; contact: string | null }[]
  >([]);
  const [agentId, setAgentId] = useState<string | "">("");
  const [productTypeCode, setProductTypeCode] = useState<string>("");
  const [productSize, setProductSize] = useState<string>("");
  const [accessoryCode, setAccessoryCode] = useState<string>("");

  /**
   * 打开时拉取启用中的代理商；同时重置产品三件套
   */
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
        console.error("[OrderFormDialog] 加载代理商列表失败：", err);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setOrderNo("");
      setTemplateId(templates[0]?.id || "");
      setRecipientName("");
      setPlatform("");
      setUploadCount(1);
      setImagesPerUpload(3);
      setRegenerateLimit(5);
      setPendingConflict(null);
      setAgentId("");
      setProductTypeCode("");
      setProductSize("");
      setAccessoryCode("");
    }
  }, [open, templates]);

  /**
   * 当前选中型号下的可选尺寸 / 配件（cascade）
   * 没选型号时三个 select 都禁用
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

  /**
   * 真正下单（覆盖分支复用此函数）
   */
  const submitCreate = async (replaceOrderId?: string) => {
    setSaving(true);
    try {
      const res = await createOrderAction({
        orderNo: orderNo.trim(),
        templateId,
        recipientName: recipientName.trim() || undefined,
        platform: platform || undefined,
        uploadCount,
        imagesPerUpload,
        regenerateLimit,
        ...(agentId ? { agentId } : {}),
        ...(productTypeCode ? { productTypeCode } : {}),
        ...(productSize ? { productSize } : {}),
        ...(accessoryCode ? { accessoryCode } : {}),
        ...(replaceOrderId ? { replaceOrderId } : {}),
      });
      if (!res?.data) {
        // 不吞错：把 next-safe-action 的真实 serverError / validationErrors 冒
        // 到 message，否则 DB 抖动、模板被删、session 过期、Zod 校验失败都会
        // 被压成同一个"创建失败"，运维和用户都看不到根因。
        const errorPayload = res as unknown as {
          serverError?: string;
          validationErrors?: Record<string, string[] | undefined>;
        };
        let detail = "创建失败";
        if (errorPayload.serverError) {
          detail = errorPayload.serverError;
        } else if (errorPayload.validationErrors) {
          const fields = Object.entries(errorPayload.validationErrors)
            .map(
              ([k, v]) =>
                `${k}: ${Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v ?? "")}`
            )
            .filter(Boolean)
            .join("；");
          detail = fields || "参数校验失败";
        }
        throw new Error(detail);
      }
      message.success(
        replaceOrderId ? "已覆盖旧订单" : "订单已创建，链接已生成"
      );
      onCreated(res.data.order);
      onOpenChange(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!orderNo.trim() || !templateId) {
      message.error("请填写订单号并选择模板");
      return;
    }
    setCheckingConflict(true);
    try {
      const checkRes = await checkOrderNoConflictAction({
        orderNo: orderNo.trim(),
      });
      if (checkRes?.data?.conflict && checkRes.data.existing) {
        // 弹出冲突确认；用户点"覆盖"才真正下单
        setPendingConflict(checkRes.data.existing);
        return;
      }
    } catch (e) {
      console.error("冲突检查失败，继续创建", e);
    } finally {
      setCheckingConflict(false);
    }
    await submitCreate();
  };

  const activeTemplates = templates.filter((t) => t.isActive);

  return (
    <Modal
      open={open}
      onCancel={() => !saving && onOpenChange(false)}
      title="创建订单并生成链接"
      footer={[
        <Button
          key="cancel"
          onClick={() => onOpenChange(false)}
          disabled={saving}
          icon={<X className="h-4 w-4" />}
        >
          取消
        </Button>,
        <Button
          key="create"
          type="primary"
          onClick={handleCreate}
          disabled={saving || checkingConflict}
          loading={saving || checkingConflict}
        >
          {checkingConflict ? "检查中…" : saving ? "创建中…" : "创建并生成链接"}
        </Button>,
      ]}
      width={640}
      styles={{ body: { maxHeight: "calc(90vh - 110px)", overflowY: "auto" } }}
    >
      <Form layout="vertical" className="space-y-3 pt-2">
        {/* 横向 label-input 布局：每行 [140px label] [1fr control] */}
        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">
              订单号 <span className="text-rose-600">*</span>
            </span>
            <Tooltip title="业务标识，作为链接的一部分发给用户。订单号不必唯一，多订单可复用。">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
          <Input
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            placeholder="如：ORD-20260803-001"
          />
        </div>

        <div className="grid grid-cols-[140px_1fr] items-start gap-x-3">
          <span className="text-sm pt-2">
            关联模板 <span className="text-rose-600">*</span>
          </span>
          <div className="space-y-1.5">
            {templatesLoading ? (
              <>
                <Select
                  value="_loading"
                  disabled
                  className="w-full opacity-60"
                  options={[{ value: "_loading", label: "加载模板中…" }]}
                />
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
                  正在从 /api/templates 拉取可用模板…
                </p>
              </>
            ) : templatesError ? (
              <>
                <Select
                  value="_error"
                  disabled
                  className="w-full opacity-60"
                  options={[{ value: "_error", label: "模板加载失败" }]}
                />
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-[10px] text-rose-700 dark:text-rose-400 font-medium">
                    模板加载失败
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono break-all">
                    {templatesError}
                  </p>
                  {onRetryTemplates && (
                    <Button
                      type="default"
                      size="small"
                      onClick={onRetryTemplates}
                      icon={<RefreshCw className="h-3 w-3" />}
                    >
                      重新加载
                    </Button>
                  )}
                </div>
              </>
            ) : activeTemplates.length === 0 ? (
              <>
                <Select
                  value="_empty"
                  disabled
                  className="w-full opacity-60"
                  options={[{ value: "_empty", label: "暂无启用的模板" }]}
                />
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 space-y-1">
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                    还没有可用的提示词模板
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    请先在
                    <a
                      href="/admin/prompt-templates"
                      className="text-violet-600 hover:underline mx-0.5"
                    >
                      提示词模板管理
                    </a>
                    新建并启用模板后再来创建订单。模板里
                    <code className="mx-0.5 px-1 py-0.5 rounded bg-muted text-[9px] font-mono">
                      isActive=false
                    </code>
                    的不会出现在此下拉里。
                  </p>
                </div>
              </>
            ) : (
              <Select
                value={templateId}
                onChange={(v) => setTemplateId(v)}
                placeholder="选择模板"
                className="w-full"
                options={activeTemplates.map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">
              效果数量 <span className="text-rose-600">*</span>
            </span>
            <Tooltip title="用户需提交的「效果图」数量。每个效果图对应一批参考图，全部提交才算订单完成。建议 1-3 个，最多 10 个。">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
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
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                const clamped = Math.max(1, Math.min(10, Math.floor(v)));
                setUploadCount(clamped);
              }}
              className="text-center font-medium"
            />
            <Button
              type="default"
              onClick={() => setUploadCount((n) => Math.min(10, n + 1))}
              disabled={uploadCount >= 10}
              aria-label="增加"
              icon={<Plus className="h-4 w-4" />}
            />
          </div>
        </div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">
              用户昵称{" "}
              <span className="text-xs font-normal text-zinc-400">
                （选填）
              </span>
            </span>
            <Tooltip title="留空时不会在任何页面显示昵称">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
          <Input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="如：张三 / user_001"
          />
        </div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">
              来源平台{" "}
              <span className="text-xs font-normal text-zinc-400">
                （选填）
              </span>
            </span>
            <Tooltip title="标识此订单从哪个渠道分发，便于后续统计">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
          <Select
            value={platform || "_none"}
            onChange={(v) =>
              setPlatform(v === "_none" ? "" : (v as OrderPlatform))
            }
            placeholder="未指定"
            className="w-full"
            options={[
              { value: "_none", label: "未指定" },
              ...ORDER_PLATFORMS.map((p: OrderPlatform) => ({
                value: p,
                label: ORDER_PLATFORM_LABELS[p],
              })),
            ]}
          />
        </div>

        {/* ============================================
            2026-08-23：代理商业务（ToB）—— 默认收起
            ToC 订单留空所有 4 个字段；选代理商 / 选型号 后尺寸/配件 select 自动启用
            ============================================ */}
        <Collapse
          ghost
          items={[
            {
              key: "agent",
              label: (
                <span className="flex items-center gap-1.5 text-sm text-stone-600">
                  <Briefcase className="h-3.5 w-3.5" />
                  代理商业务（ToB）
                  {agentId && (
                    <span className="text-[10px] text-violet-600 font-medium">
                      · 已绑定
                    </span>
                  )}
                </span>
              ),
              extra: (
                <span className="text-xs text-stone-400">
                  {agentId ? "绑定代理商 + 产品规格" : "默认留空 = ToC 订单"}
                </span>
              ),
              children: (
                <div className="grid grid-cols-1 gap-y-3 pb-1">
                  <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                    <div className="flex items-center gap-1">
                      <span className="text-sm">代理商</span>
                      <Tooltip title="绑定代理商后此订单归因到该渠道；订单统计与对账会按代理商分组">
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
                      // 2026-08-24：不 disable —— 让用户能打开 dropdown 看 notFoundContent 的
                      // 跳转指引。否则空态时 select 灰成死控件，notFoundContent 永远不显示
                      notFoundContent={
                        activeAgents.length === 0 ? (
                          <div className="space-y-1.5 py-1 text-xs text-muted-foreground">
                            <div>暂无启用的代理商</div>
                            <a
                              href="/admin/agents"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-violet-700 hover:underline"
                            >
                              去代理商管理新建 →
                            </a>
                          </div>
                        ) : null
                      }
                    />
                  </div>

                  <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                    <div className="flex items-center gap-1">
                      <span className="text-sm">产品型号</span>
                    </div>
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
                    <div className="flex items-center gap-1">
                      <span className="text-sm">尺寸</span>
                      {!selectedProductType && (
                        <span className="text-xs font-normal text-zinc-400">
                          （先选型号）
                        </span>
                      )}
                    </div>
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
                    <div className="flex items-center gap-1">
                      <span className="text-sm">配件</span>
                    </div>
                    <Select
                      value={accessoryCode || "_none"}
                      onChange={(v) => setAccessoryCode(v === "_none" ? "" : v)}
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

        {/* 高级设置 —— 不常用字段折叠起来，默认收起保持表单简洁 */}
        <Collapse
          ghost
          items={[
            {
              key: "advanced",
              label: (
                <span className="flex items-center gap-1.5 text-sm text-stone-600">
                  <ChevronDown className="h-3.5 w-3.5" />
                  更多设置
                </span>
              ),
              extra: (
                <span className="text-xs text-stone-400">
                  每批参考图 / 每批重试次数
                </span>
              ),
              children: (
                <div className="grid grid-cols-1 gap-y-4 pb-1">
                  <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                    <div className="flex items-center gap-1">
                      <span className="text-sm">
                        每批参考图数量 <span className="text-rose-600">*</span>
                      </span>
                      <Tooltip title="用户每次上传会话最多塞几张参考图。多张图被融合为单次生图输入。默认 3 张，可选 1-3 张。订单总容量 = 批次 × 每批张数。">
                        <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
                      </Tooltip>
                    </div>
                    <div className="flex items-stretch gap-2">
                      <Button
                        type="default"
                        onClick={() =>
                          setImagesPerUpload((n) => Math.max(1, n - 1))
                        }
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
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const clamped = Math.max(
                            1,
                            Math.min(3, Math.floor(v))
                          );
                          setImagesPerUpload(clamped);
                        }}
                        className="text-center font-medium"
                      />
                      <Button
                        type="default"
                        onClick={() =>
                          setImagesPerUpload((n) => Math.min(3, n + 1))
                        }
                        disabled={imagesPerUpload >= 3}
                        aria-label="增加"
                        icon={<Plus className="h-4 w-4" />}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
                    <div className="flex items-center gap-1">
                      <span className="text-sm">每批重试次数</span>
                      <Tooltip title="每批效果图的重新生成机会。每个 batchIdx 独立计数，下 5 个效果图就有 5 × N 次总机会，互不挤占。批量重跑 / FAILED 一键重试不计。设为 0 表示禁止用户主动重新生成。">
                        <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
                      </Tooltip>
                    </div>
                    <div className="flex items-stretch gap-2">
                      <Button
                        type="default"
                        onClick={() =>
                          setRegenerateLimit((n) => Math.max(0, n - 1))
                        }
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
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const clamped = Math.max(
                            0,
                            Math.min(20, Math.floor(v))
                          );
                          setRegenerateLimit(clamped);
                        }}
                        className="text-center font-medium"
                      />
                      <Button
                        type="default"
                        onClick={() =>
                          setRegenerateLimit((n) => Math.min(20, n + 1))
                        }
                        disabled={regenerateLimit >= 20}
                        aria-label="增加"
                        icon={<Plus className="h-4 w-4" />}
                      />
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
          className="rounded-lg border border-dashed border-stone-200 bg-stone-50/50"
        />
      </Form>

      {/* 订单号冲突确认 —— 询问是否覆盖旧订单 */}
      <Modal
        open={!!pendingConflict}
        onCancel={() => !saving && setPendingConflict(null)}
        title="订单号已存在"
        footer={[
          <Button
            key="cancel"
            onClick={() => setPendingConflict(null)}
            disabled={saving}
          >
            取消（回去改订单号）
          </Button>,
          <Button
            key="overwrite"
            danger
            onClick={() => {
              const targetId = pendingConflict?.id;
              setPendingConflict(null);
              if (targetId) void submitCreate(targetId);
            }}
            disabled={saving || !pendingConflict}
            loading={saving}
          >
            确认覆盖
          </Button>,
        ]}
        width={400}
      >
        <p className="text-sm text-muted-foreground">
          你已有一个名为{" "}
          <span className="font-mono">{pendingConflict?.orderNo}</span> 的订单。
          <br />
          覆盖会用本次填写的收件人/平台/上传数量替换旧订单的业务字段，
          模板、访问链接、状态、上传内容保持不变。
        </p>
        {pendingConflict && (
          <div className="rounded-md border bg-slate-50 p-3 text-xs space-y-1 mt-3">
            <div>
              <span className="text-muted-foreground">旧订单模板：</span>
              {pendingConflict.templateName}
            </div>
            <div>
              <span className="text-muted-foreground">旧收件人：</span>
              {pendingConflict.recipientName || (
                <span className="italic text-zinc-400">未指定</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">创建时间：</span>
              {new Date(pendingConflict.createdAt).toLocaleString("zh-CN")}
            </div>
          </div>
        )}
      </Modal>
    </Modal>
  );
}
