"use client";

/**
 * 外部生图 API Key 管理 - Admin 视图
 *
 * 2026-10-12：MOCK_EXTERNAL_API_KEYS → 真实 externalApiKey 表
 * - 列表/创建/启停/删除全部走 admin safer-action
 * - rawKey 仅在新建 Modal 一次性显示（明文落库的是 SHA-256 hash，无法再取）
 * - 移除「累计成本」字段（DB schema 未追踪 cost；只留 totalCalls/monthlyCalls）
 * - 移除「最后使用」为 ISO 字符串 → 直接用 Date 显示
 *
 * 历史：仿 mooncada-source/src/components/mooncada/modules/public-image-gen.tsx 设计
 * 2026-08-20：shadcn → antd 迁移（Phase 3.3）
 */

import { App, Badge, Button, Form, Input, InputNumber, Modal } from "antd";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Key,
  Plus,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";

import {
  createExternalApiKeyAdminAction,
  deleteExternalApiKeyAdminAction,
  listExternalApiKeysAdminAction,
  updateExternalApiKeyAdminAction,
} from "@/features/image-gen/admin/actions";
import { isSuspiciousCustomerName } from "@/features/image-gen/lib/external-api-key-validation";
import { cn } from "@/lib/utils";

const QUOTA_BAR_RED = 1;
const QUOTA_BAR_AMBER = 0.8;

/**
 * 服务端 list action 返回的视图模型
 * 字段与 src/features/image-gen/admin/actions.ts listExternalApiKeysAdminAction
 * 完全对齐；本 view 不再返 rawKey（DB 只存 hash）。
 */
interface ApiKeyViewModel {
  id: string;
  name: string;
  keyPrefix: string;
  status: "active" | "disabled";
  monthlyQuota: number;
  monthlyCalls: number;
  monthlyCallsResetAt: string;
  totalCalls: number;
  lastUsedAt: string | null;
  allowedMasks: string[];
  createdAt: string;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "从未";
  return new Date(iso).toLocaleString("zh-CN");
}

interface QuotaStat {
  percent: number;
  level: "ok" | "amber" | "red";
}

function computeQuota(
  monthlyCalls: number,
  monthlyQuota: number
): QuotaStat {
  // monthlyQuota ≤ 0 表示无限（admin 给的语义）
  if (monthlyQuota <= 0) {
    return { percent: 0, level: "ok" };
  }
  const percent = Math.min(
    100,
    Math.round((monthlyCalls / monthlyQuota) * 100)
  );
  const level: QuotaStat["level"] =
    monthlyCalls >= monthlyQuota * QUOTA_BAR_RED
      ? "red"
      : monthlyCalls >= monthlyQuota * QUOTA_BAR_AMBER
        ? "amber"
        : "ok";
  return { percent, level };
}

interface CreateFormValues {
  name: string;
  monthlyQuota: number;
  /**
   * 允许的 maskId 列表，逗号分隔。空 = 不绑白名单（合作伙伴可调任何 active 模板）。
   * 真实使用场景：admin 从 productEffect 列表复制 maskId 填入；或留空。
   */
  allowedMasksText: string;
}

/**
 * 把 "MASK_001, MASK_002 / MASK_003" 之类用户输入归一化：
 * 去空白 + 去空 + 去重，保留输入顺序
 */
function parseMasksText(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,，/\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
}

// isSuspiciousCustomerName 已在
// @/features/image-gen/lib/external-api-key-validation 统一实现，
// 客户端 + 服务端共用同一份规则（双层校验）。

export function ExternalApiKeysAdminView() {
  const { message } = App.useApp();
  const [keys, setKeys] = useState<ApiKeyViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFullKey, setShowFullKey] = useState<string | null>(null);

  // create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [freshlyCreated, setFreshlyCreated] = useState<{
    rawKey: string;
    name: string;
    keyPrefix: string;
  } | null>(null);

  // ---- safer-action hooks ----
  const { execute: executeList, isPending: isReloading } = useAction(
    listExternalApiKeysAdminAction,
    {
      onSuccess: (res) => {
        const data = res?.data as
          | { keys: ApiKeyViewModel[] }
          | undefined
          | null;
        setKeys(data?.keys ?? []);
      },
      onError: ({ error }) => {
        message.error(`加载失败：${error.serverError ?? "未知错误"}`);
      },
    }
  );

  const { executeAsync: executeCreate, isPending: isCreating } = useAction(
    createExternalApiKeyAdminAction
  );

  const { execute: executeUpdate } = useAction(
    updateExternalApiKeyAdminAction,
    {
      onError: ({ error }) => {
        message.error(`更新失败：${error.serverError ?? "未知错误"}`);
      },
    }
  );

  const { execute: executeDelete } = useAction(
    deleteExternalApiKeyAdminAction,
    {
      onError: ({ error }) => {
        message.error(`删除失败：${error.serverError ?? "未知错误"}`);
      },
    }
  );

  // 初次加载
  useEffect(() => {
    setLoading(true);
    executeList(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = () => {
    setLoading(true);
    executeList(undefined);
  };

  const stats = {
    total: keys.length,
    active: keys.filter((k) => k.status === "active").length,
    totalCalls: keys.reduce((s, k) => s + k.totalCalls, 0),
    monthlyCalls: keys.reduce((s, k) => s + k.monthlyCalls, 0),
  };

  const handleCopyText = (text: string, label: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    message.success(`已复制 ${label}`);
  };

  const handleToggleStatus = (k: ApiKeyViewModel) => {
    const nextStatus: "active" | "disabled" =
      k.status === "active" ? "disabled" : "active";
    // 乐观更新；失败由 onError 提示
    setKeys((prev) =>
      prev.map((x) => (x.id === k.id ? { ...x, status: nextStatus } : x))
    );
    executeUpdate({ id: k.id, status: nextStatus });
  };

  const handleDelete = (k: ApiKeyViewModel) => {
    Modal.confirm({
      title: `确认删除 ${k.name} ？`,
      content: "软删除后 Key 立即失效；如需恢复请联系数据库管理员。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        setKeys((prev) => prev.filter((x) => x.id !== k.id));
        executeDelete({ id: k.id });
      },
    });
  };

  const handleCreate = async () => {
    let values: CreateFormValues;
    try {
      values = await createForm.validateFields();
    } catch {
      return;
    }
    const masks = parseMasksText(values.allowedMasksText);
    const result = await executeCreate({
      name: values.name,
      monthlyQuota: values.monthlyQuota,
      allowedMasks: masks,
    });
    const payload = result?.data as
      | { key: { id: string; rawKey: string; name: string; keyPrefix: string } }
      | undefined
      | null;
    if (payload?.key) {
      setFreshlyCreated({
        rawKey: payload.key.rawKey,
        name: payload.key.name,
        keyPrefix: payload.key.keyPrefix,
      });
      createForm.resetFields();
      setCreateOpen(false);
      reload();
    }
  };

  const openPublicPage = () => {
    if (typeof window !== "undefined") {
      window.open("/image-gen", "_blank");
    }
  };

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-violet-600" />
            外部生图服务
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            为非平台用户提供独立的生图网页 · 专属 API Key 通道 · 极简操作体验
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={openPublicPage}
            icon={<ExternalLink className="h-4 w-4" />}
          >
            打开外部生图页面
          </Button>
          <Button
            type="primary"
            onClick={() => setCreateOpen(true)}
            className="bg-gradient-to-r from-violet-500 to-purple-600 border-0"
            icon={<Plus className="h-4 w-4" />}
          >
            新建 API Key
          </Button>
        </div>
      </div>

      {/* 外部页面预览卡片 */}
      <div className="rounded-lg border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-purple-500/5 text-card-foreground shadow-sm overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0">
              <Globe className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-bold">外部生图页面</h3>
                <Badge color="green" className="!text-[10px]">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                  已部署
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                独立路由页面，无需登录平台，外部用户通过专属 API Key
                即可使用生图服务
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-[11px] bg-muted px-2 py-0.5 rounded font-mono">
                  /image-gen
                </code>
                <Button
                  size="small"
                  type="text"
                  className="!h-6 !text-xs"
                  onClick={openPublicPage}
                >
                  访问页面 <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          </div>

          {/* 使用流程 */}
          <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t">
            {[
              { step: "1", title: "输入 API Key", desc: "专属通道认证" },
              { step: "2", title: "上传参考图", desc: "可选，支持拖拽" },
              { step: "3", title: "选择效果", desc: "已上架效果模版" },
              { step: "4", title: "生成下载", desc: "一键下载图片" },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="h-6 w-6 rounded-full bg-violet-500 text-white text-[10px] flex items-center justify-center font-bold mx-auto mb-1">
                  {s.step}
                </div>
                <p className="text-[11px] font-medium">{s.title}</p>
                <p className="text-[10px] text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">API Key 总数</p>
              <p className="text-xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-lg bg-violet-500/10 p-2">
              <Key className="h-4 w-4 text-violet-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">启用中</p>
              <p className="text-xl font-bold text-emerald-600">
                {stats.active}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">累计调用</p>
              <p className="text-xl font-bold">
                {stats.totalCalls.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="rounded-lg bg-sky-500/10 p-2">
              <Activity className="h-4 w-4 text-sky-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">本月调用</p>
              <p className="text-xl font-bold text-amber-600">
                {stats.monthlyCalls.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-amber-600" />
            </div>
          </div>
        </div>
      </div>

      {/* API Key 列表 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="text-base font-semibold leading-none tracking-tight flex items-center gap-2">
            <Key className="h-4 w-4 text-violet-600" />
            API Key 管理
          </h3>
          <p className="text-xs text-muted-foreground">
            每个 Key 对应一个外部客户，可独立配置配额与权限
          </p>
        </div>
        <div className="p-0">
          {loading && keys.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground text-sm">
              加载中…
            </div>
          ) : keys.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
              <Key className="h-10 w-10 mb-3" />
              <p className="font-medium">暂无 API Key</p>
              <p className="text-sm">点击右上角新建</p>
            </div>
          ) : (
            <div className="divide-y">
              {keys.map((k) => {
                const quota = computeQuota(k.monthlyCalls, k.monthlyQuota);
                return (
                  <div
                    key={k.id}
                    className="p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* 客户名 + 状态 */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{k.name}</p>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                              k.status === "active"
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900"
                                : "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-400 dark:border-zinc-800"
                            )}
                          >
                            {k.status === "active" ? "启用" : "已禁用"}
                          </span>
                        </div>

                        {/* API Key（始终脱敏；明文只在新建一次性 Modal 出现） */}
                        <div className="flex items-center gap-2 bg-muted/40 rounded px-2 py-1.5">
                          <code className="text-xs font-mono flex-1 truncate">
                            {k.keyPrefix}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyText(k.keyPrefix, "脱敏 Key")}
                            className="text-muted-foreground hover:text-foreground p-1"
                            aria-label="copy masked"
                            title="复制脱敏形式"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* 统计信息 */}
                        <div className="grid grid-cols-4 gap-2 text-[10px]">
                          <div>
                            <span className="text-muted-foreground">
                              累计调用
                            </span>
                            <p className="font-mono font-medium">
                              {k.totalCalls.toLocaleString("zh-CN")}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              本月/配额
                            </span>
                            <p className="font-mono font-medium">
                              <span
                                className={cn(
                                  quota.level === "red" && "text-rose-600"
                                )}
                              >
                                {k.monthlyCalls}
                              </span>
                              {k.monthlyQuota > 0
                                ? `/${k.monthlyQuota}`
                                : " / 无限制"}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              创建时间
                            </span>
                            <p className="font-medium">
                              {formatDateTime(k.createdAt)}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              最后使用
                            </span>
                            <p className="font-medium">
                              {formatDateTime(k.lastUsedAt)}
                            </p>
                          </div>
                        </div>

                        {/* 配额进度条（无限配额不显示） */}
                        {k.monthlyQuota > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full transition-all",
                                  quota.level === "red"
                                    ? "bg-rose-500"
                                    : quota.level === "amber"
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                )}
                                style={{ width: `${quota.percent}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                              {quota.percent}%
                            </span>
                          </div>
                        )}

                        {/* 允许的效果 */}
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] text-muted-foreground">
                            允许效果:
                          </span>
                          {k.allowedMasks.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground italic">
                              不限（可调用所有 active 模板）
                            </span>
                          ) : (
                            k.allowedMasks.map((m) => (
                              <Badge
                                key={m}
                                color="default"
                                className="!text-[9px] font-mono"
                              >
                                {m}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button
                          size="small"
                          type="text"
                          className="!h-7 !text-xs"
                          onClick={() => handleToggleStatus(k)}
                        >
                          {k.status === "active" ? "禁用" : "启用"}
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          danger
                          className="!h-7 !text-xs"
                          onClick={() => handleDelete(k)}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {isReloading && keys.length > 0 && (
                <div className="p-2 text-center text-[10px] text-muted-foreground">
                  刷新中…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 创建 Modal */}
      <Modal
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        title={
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-violet-600" />
            新建 API Key
          </span>
        }
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setCreateOpen(false);
              createForm.resetFields();
            }}
          >
            取消
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={isCreating}
            onClick={handleCreate}
            className="bg-gradient-to-r from-violet-500 to-purple-600 border-0"
          >
            确认创建
          </Button>,
        ]}
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{
            name: `新客户·${new Date().toLocaleDateString("zh-CN")}`,
            monthlyQuota: 100,
            allowedMasksText: "",
          }}
        >
          <Form.Item
            name="name"
            label="客户名称"
            rules={[
              { required: true, message: "请输入客户名称" },
              { max: 80, message: "最多 80 字符" },
              {
                // 2026-10-12：防误粘 rawKey / 哈希片段。
                // 客户名是给人读的，不该出现 mk_pub_ 前缀或长 hex 串。
                validator: (_rule, value: string | undefined) => {
                  if (value && isSuspiciousCustomerName(value)) {
                    // 文案与 src/features/image-gen/lib/external-api-key-validation 内的
                    // SUSPICIOUS_CUSTOMER_NAME_MESSAGE_SERVER 同步；修改时两边一起改。
                    return Promise.reject(
                      new Error(
                        "客户名中检测到 API Key 片段（mk_pub_ 前缀或 32+ 字符 hex），看起来是误粘了 Key / 哈希，请重新输入"
                      )
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="例：某某小程序 / 某某合作伙伴" />
          </Form.Item>
          <Form.Item
            name="monthlyQuota"
            label="月配额（≤0 表示无限制）"
            rules={[{ required: true, message: "请输入月配额" }]}
          >
            <InputNumber
              min={-1}
              max={1_000_000}
              step={50}
              className="!w-full"
              placeholder="默认 100；-1 表示不限制"
            />
          </Form.Item>
          <Form.Item
            name="allowedMasksText"
            label="允许的 maskId（留空 = 不限）"
            extra="逗号分隔，例：MASK_001, MASK_002"
          >
            <Input.TextArea
              rows={3}
              placeholder="MASK_001, MASK_002（留空表示可调用所有 active 模板）"
            />
          </Form.Item>
        </Form>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            创建后明文 API Key
            仅在下一个弹窗显示一次，请立刻复制到密码管理器。刷新页面后无法再查看。
          </p>
        </div>
      </Modal>

      {/* rawKey 一次性展示 Modal（admin 复制保存窗口） */}
      <Modal
        open={freshlyCreated !== null}
        onCancel={() => setFreshlyCreated(null)}
        title={
          <span className="flex items-center gap-2">
            <Key className="h-4 w-4 text-emerald-600" />
            API Key 已创建
          </span>
        }
        footer={[
          <Button
            key="close"
            type="primary"
            onClick={() => setFreshlyCreated(null)}
          >
            我已保存，关闭
          </Button>,
        ]}
      >
        {freshlyCreated && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              请把以下 API Key 安全保存到密码管理器。关闭后无法再查看明文。
            </p>
            <div className="flex items-center gap-2 bg-muted rounded p-2">
              <code
                className={cn(
                  "text-xs font-mono flex-1 break-all",
                  showFullKey ? "" : "blur-sm select-none"
                )}
              >
                {freshlyCreated.rawKey}
              </code>
              <button
                type="button"
                onClick={() => setShowFullKey(showFullKey ? null : "raw")}
                className="text-muted-foreground hover:text-foreground p-1"
                aria-label="toggle visibility"
              >
                {showFullKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  handleCopyText(freshlyCreated.rawKey, "API Key")
                }
                className="text-muted-foreground hover:text-foreground p-1"
                aria-label="copy"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1">
              <p>
                客户：<span className="font-medium">{freshlyCreated.name}</span>
              </p>
              <p>
                脱敏形式：
                <code className="bg-muted px-1 py-0.5 rounded">
                  {freshlyCreated.keyPrefix}
                </code>
              </p>
            </div>
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                警告：DB
                只存明文的 SHA-256 哈希，原始 key 一旦丢失无法找回。如客户遗失，请删除后重新创建。
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
