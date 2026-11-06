import type { Metadata } from "next";
import { PrintServiceWeightTool } from "@/features/print-quote/components/print-service-weight-tool";
import { getServerSession } from "@/lib/auth/server";

/**
 * 3D 打印克重计算器 —— `/tools/weight`
 *
 * 移植自 `C:\Users\Admin1\Downloads\wjp-source-code`(PolyJet 耗材填充克重
 * 计算器)。整页的克重 / 摆盘 / 解析都在浏览器本地跑:
 *  - 模型文件**默认**不上传服务器;
 *  - 计算结果不写数据库(「只算不存」);
 *  - 唯一的网络请求是「材料参数是否需要密码」,见
 *    `/api/image-gen/pricing/materials-auth`。
 *
 * ## 2026-11-06:工具页只留一个「报价下单」入口
 *
 * 2026-11-05 曾在右栏挂过「报价 + 交期 + 加入购物车」那一整套(跟 `/quote`
 * 平行的一份),当天按工作室要求撤掉 —— 工具里不该直接放那些下单控件。
 * 现在右栏是一个入口卡片:点「去报价下单」到 `/quote`,那边能选交期、填
 * 收货信息、付款下单。
 *
 * 两条边界照旧:
 * - **工具页不显示价格** —— 计算器跑工具模式,几何数据不抛给服务端,也就
 *   没有报价请求。价格、交期、下单全在报价台那一条路上
 * - **模型不上传** —— 上传是**下单动作**的一部分,不是量重量的副产品
 *
 * 量好的模型会**接力**给报价台(用户不用在那边重选一遍文件),但接力只在
 * 客户端跳转里成立 —— 未登录会被弹去登录页(整页跳转),接力作废,所以卡片
 * 上写明了这一点。登录态由页面的 RSC 查好传下去。
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
    ? "上传 3D 模型,本地解析体积与表面积,算出耗材克重、支撑克重与最佳打印摆盘角度。量完可直接去报价台下单 —— 量重量的过程模型不上传。"
    : "Upload a 3D model and get its resin weight, support weight and best print orientation — computed locally in your browser. Head to the quote desk to order; nothing is uploaded while measuring.";

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

export default async function WeightToolPage() {
  // 登录态 —— 只为了在入口卡片上写明「没登录会先跳登录页,接力会丢」
  const session = await getServerSession();
  const isLoggedIn = Boolean(session?.user?.id);

  return <PrintServiceWeightTool isLoggedIn={isLoggedIn} />;
}
