"use client";

/**
 * 账单设置组件
 *
 * Settings > Billing Tab 的主要内容
 * 包含:
 * - 当前订阅计划
 * - 支付方式
 * - 账单历史
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.4）
 * - shadcn AlertDialog 切到 antd Modal（controlled open 状态）
 * - shadcn Badge/Button/Separator 切到 antd
 */

import { App, Badge, Button, Divider, Modal } from "antd";
import { Receipt, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState, useTransition } from "react";

import { findPlanByPriceId } from "@/config/payment";
import {
  PLAN_PRIVILEGES,
  type SubscriptionPlan,
} from "@/config/subscription-plan";
import { cancelSubscription } from "@/features/payment/actions";
import { getMyPlanAction } from "@/features/subscription/actions/get-user-plan";
import {
  PlanBadge,
  type PlanType,
} from "@/features/subscription/components/plan-badge";
import { Link } from "@/i18n/routing";

/**
 * 账单设置组件
 */
export function BillingSection() {
  const t = useTranslations("Settings.billing");
  const locale = useLocale();
  const { message } = App.useApp();

  // 获取用户订阅计划
  const { execute: fetchPlan, result: planResult } = useAction(getMyPlanAction);
  const userPlan = (planResult.data?.plan as PlanType) || "free";
  const planConfig = PLAN_PRIVILEGES[userPlan as SubscriptionPlan];
  const isCancelPending = planResult.data?.cancelAtPeriodEnd ?? false;

  // 取消订阅
  const [isCancelling, startCancelTransition] = useTransition();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // 计算续期日期和价格
  const renewalDate = useMemo(() => {
    const iso = planResult.data?.currentPeriodEnd;
    if (!iso) return null;
    return new Date(iso);
  }, [planResult.data?.currentPeriodEnd]);

  const formattedRenewalDate = renewalDate
    ? renewalDate.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const priceDisplay = useMemo(() => {
    if (userPlan === "free") return "$0";
    const priceId = planResult.data?.priceId;
    if (!priceId) return "-";
    const { price } = findPlanByPriceId(priceId);
    if (!price) return "-";
    return `$${price.amount}`;
  }, [userPlan, planResult.data?.priceId]);

  const priceInterval = useMemo(() => {
    if (userPlan === "free") return t("currentPlan.perMonth");
    const priceId = planResult.data?.priceId;
    if (!priceId) return "";
    const { price } = findPlanByPriceId(priceId);
    if (!price) return "";
    return price.interval === "yearly"
      ? t("currentPlan.perYear")
      : t("currentPlan.perMonth");
  }, [userPlan, planResult.data?.priceId, t]);

  // 组件挂载时获取计划
  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  // 处理取消订阅
  const handleCancelSubscription = () => {
    startCancelTransition(async () => {
      try {
        await cancelSubscription();
        setCancelDialogOpen(false);
        message.success(t("currentPlan.cancelDialog.success"));
        fetchPlan(); // 刷新状态
      } catch (error) {
        console.error("Failed to cancel subscription:", error);
        message.error(t("currentPlan.cancelDialog.error"));
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* 当前计划 */}
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">{t("currentPlan.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("currentPlan.description")}
          </p>
        </div>

        <div className="rounded-lg border p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <PlanBadge plan={userPlan} size="lg" showLabel={false} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">
                    {planConfig.name} Plan
                  </h3>
                  <Badge color="default">{t("currentPlan.current")}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {userPlan === "free"
                    ? t("currentPlan.basicFeatures")
                    : t("currentPlan.premiumFeatures")}
                </p>
              </div>
            </div>
            {userPlan === "free" && (
              <Link href="/#pricing">
                <Button type="primary" icon={<Sparkles className="h-4 w-4" />}>
                  {t("currentPlan.upgradePlan")}
                </Button>
              </Link>
            )}
            {userPlan !== "free" && (
              <div className="flex items-center gap-2">
                {isCancelPending ? (
                  <Badge color="gold" className="!text-amber-600">
                    {t("currentPlan.cancelPending", {
                      date: formattedRenewalDate ?? "",
                    })}
                  </Badge>
                ) : (
                  <Button
                    type="default"
                    size="small"
                    onClick={() => setCancelDialogOpen(true)}
                  >
                    {t("currentPlan.cancelSubscription")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <Divider className="!my-4" />

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">
                {t("currentPlan.monthlyCredits")}
              </p>
              <p className="font-medium">
                {planConfig.monthlyCredits.toLocaleString()} credits
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t("currentPlan.renewalDate")}
              </p>
              <p
                className={`font-medium ${isCancelPending ? "text-amber-600" : ""}`}
              >
                {formattedRenewalDate ?? t("currentPlan.notApplicable")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("currentPlan.price")}</p>
              <p className="font-medium">
                {priceDisplay}
                {priceInterval && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    /{priceInterval}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 取消订阅确认对话框 */}
      <Modal
        open={cancelDialogOpen}
        onCancel={() => setCancelDialogOpen(false)}
        title={t("currentPlan.cancelDialog.title")}
        footer={[
          <Button
            key="cancel"
            type="default"
            onClick={() => setCancelDialogOpen(false)}
            disabled={isCancelling}
          >
            {t("currentPlan.cancelDialog.cancel")}
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger
            loading={isCancelling}
            onClick={handleCancelSubscription}
          >
            {t("currentPlan.cancelDialog.confirm")}
          </Button>,
        ]}
      >
        <div className="space-y-2">
          <p>
            {t("currentPlan.cancelDialog.description", {
              date: formattedRenewalDate ?? "",
            })}
          </p>
          <p className="font-medium">
            {t("currentPlan.cancelDialog.keepBenefits", {
              date: formattedRenewalDate ?? "",
            })}
          </p>
        </div>
      </Modal>

      <Divider />

      {/* 账单历史 */}
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">{t("history.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("history.description")}
          </p>
        </div>

        {/* 表格 */}
        <div className="rounded-lg border">
          {/* 表头 */}
          <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-muted/50 text-sm font-medium text-muted-foreground">
            <div className="col-span-3">{t("history.date")}</div>
            <div className="col-span-4">{t("history.historyDescription")}</div>
            <div className="col-span-2 text-right">{t("history.amount")}</div>
            <div className="col-span-2 text-center">{t("history.status")}</div>
            <div className="col-span-1 text-center">{t("history.invoice")}</div>
          </div>

          <Divider className="!my-0" />

          {/* 空状态 */}
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Receipt className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">{t("history.noHistory")}</p>
            <p className="text-sm text-muted-foreground/70">
              {t("history.noHistoryHint")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
