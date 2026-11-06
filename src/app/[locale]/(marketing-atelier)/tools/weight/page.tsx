import type { Metadata } from "next";
import { PrintServiceWeightTool } from "@/features/print-quote/components/print-service-weight-tool";
import { toClientPrintConfig } from "@/features/print-quote/lib/pricing-settings";
import { getPrintPricingSettings } from "@/features/print-quote/lib/pricing-store";
import { getServerSession } from "@/lib/auth/server";

/**
 * 3D 打印克重计算器 —— `/tools/weight`
 *
 * 移植自 `C:\Users\Admin1\Downloads\wjp-source-code`(PolyJet 耗材填充克重
 * 计算器)。整页的克重 / 摆盘 / 解析都在浏览器本地跑:
 *  - 模型文件**默认**不上传服务器;
 *  - 计算结果不写数据库(「只算不存」);
 *  - 材料参数(密度 / 支撑几何)由后台 `/admin/print-pricing` 统一配置,
 *    访客改不了 —— 页面只读。
 *
 * ## 2026-11-06:工具页是打印服务的入口 —— 「加入打印单」
 *
 * 流程收成两步:
 *
 *   /tools/weight(量重量的工具,公开)→ 点「加入打印单」→ /print-order(打印单)
 *
 * 报价台(`/quote`)整页删掉了 —— 它跟工具页用的是**同一个**克重计算器,
 * 重复了一份「报价 + 交期 + 加进打印单」的下单控件。工作室要的是「工具里
 * 量完直接加进打印单,金额在打印单上确认」。
 *
 * 两条边界照旧:
 * - **工具页不显示价格** —— 价格是服务端算的,工具页只出几何(体积 / 表面积 /
 *   尺寸 / 支撑克重),交给服务端重算报价。价格、交期、下单全在打印单那一条路上
 * - **模型不上传** —— 上传是**加购动作**的一部分,不是量重量的副产品
 *
 * ## 登录要在量之前
 *
 * 加打印单要登录(工单挂在账号名下,模型文件也落到用户自己的 R2 分区)。
 * 登录那一下是**整页跳转**,浏览器里的模型会没 —— 所以卡片上的按钮在没登录
 * 时是「去登录」,文案写的是「先登录再量」,而不是让人量完再被弹去登录。
 *
 * 登录态由页面的 RSC 查好传下去。
 *
 * ## 为什么从 `/pricing` 挪到 `/tools/weight`
 *
 * 2026-11-01 起克重计算器是**工具**,不是商品品类。导航只留一个「工具」入口,
 * 工具清单在 `/tools`。老地址 `/pricing` 保留 308 跳转,不会断链。
 *
 * `showChrome={false}` —— 工具自带的页头页脚、标题块和工具按钮都不渲染,
 * 避免双 Header 双 Footer,页面里也不再重复出现一遍标题。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "3D 打印克重计算器 — 耗材用量预估"
    : "3D Print Weight Calculator — Resin Usage Estimator";

  const description = isZh
    ? "上传 3D 模型,本地解析体积与表面积,算出耗材克重、支撑克重与最佳打印摆盘角度。量完直接「加入打印单」,在打印单上确认金额再下单 —— 量重量的过程模型不上传。"
    : "Upload a 3D model and get its resin weight, support weight and best print orientation — computed locally in your browser. Add it to your print order and confirm the total there; nothing is uploaded while measuring.";

  return {
    title,
    description,
    keywords: isZh
      ? [
          "3D打印克重",
          "耗材克重计算器",
          "光敏树脂",
          "PolyJet",
          "支撑克重",
          "打印摆盘",
          "用量预估",
        ]
      : [
          "3d print weight calculator",
          "resin weight",
          "PolyJet",
          "support weight",
          "print orientation",
          "material usage estimator",
        ],
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

export default async function WeightToolPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // 登录态 —— 没登录不能加打印单(工单要挂在账号名下)
  const session = await getServerSession();
  const isLoggedIn = Boolean(session?.user?.id);

  // 登录链接带 callbackUrl —— 登录完回到工具页
  const signInUrl = `/sign-in?callbackUrl=${encodeURIComponent(
    `/${locale}/tools/weight`
  )}`;

  // 生效中的打印定价设置 —— 密度 / 支撑几何
  //
  // **访客改不了**(2026-11-06):这些数来自后台 `/admin/print-pricing`
  // (兜底 `PRINT_*` 环境变量)。工具页只显示**克重**,不显示价格 ——
  // 单价 / 后处理 / 阈值 / 交期比例一律不往浏览器里发,价由服务端算。
  const clientConfig = toClientPrintConfig(await getPrintPricingSettings());

  return (
    <PrintServiceWeightTool
      isLoggedIn={isLoggedIn}
      signInUrl={signInUrl}
      clientConfig={clientConfig}
    />
  );
}
