/**
 * /admin/payment-settings 支付设置后台(2026-11-13)
 *
 * RSC:仅渲染客户端组件 <PaymentSettingsAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * 工作室 2026-11-13 的原话:**「支付宝、微信支付先用沙盒测试验证」**,补一句
 * **「可以后台配置」**。
 *
 * 两个通道的代码都写好了,但**一次真单都没跑过** —— 商户号 / 应用还在走开通
 * 流程,`WECHAT_PAY_*` / `ALIPAY_*` 那几组环境变量一行都没配。
 *
 * 这一页让工作室在后台:
 *
 * - 填两个通道的**沙箱凭据**(改完不用重新部署 —— 沙箱凭据在 `payment_setting`
 *   表,不在环境变量里)
 * - 拨**沙箱开关**(每个通道一颗,两个通道分开拨 —— 工作室可能微信先通、支付宝
 *   后通)
 * - 看见**确切端点**(排查时一眼看出打到了哪个 URL)
 * - 点一颗「跑一笔 ¥0.01 测试单」按钮,当场看到微信的 `code_url` / 支付宝的
 *   跳转地址
 *
 * 数据在 RSC 里不取:这一页要能「改完立刻看到生效值」,所以由客户端组件自己
 * 去调 admin action 拉,保存后原地刷新。
 *
 * ⚠️ **这一页不显示密钥原文** —— 已配的私钥只显示「已配置(…尾四位)」;输入框
 * 留空 = **保持原值**(不是清空)。
 */

import { PaymentSettingsAdminView } from "@/features/payments/admin/components/payment-settings-admin-view";

export default function AdminPaymentSettingsPage() {
  return <PaymentSettingsAdminView />;
}
