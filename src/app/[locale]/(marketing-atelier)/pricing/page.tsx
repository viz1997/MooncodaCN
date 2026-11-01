import type { Metadata } from "next";
import { PricingCalculator } from "@/features/pricing/components/pricing-calculator";

/**
 * 3D 打印克重计算器 —— 公开页 `/pricing`
 *
 * 移植自 `C:\Users\Admin1\Downloads\wjp-source-code`(PolyJet 耗材填充克重
 * 计算器)。整页的克重 / 摆盘 / 解析都在浏览器本地跑:
 *  - 模型文件不上传服务器;
 *  - 计算结果不写数据库(「只算不存」);
 *  - 唯一的网络请求是「材料参数是否需要密码」,见
 *    `/api/image-gen/pricing/materials-auth`。
 *
 * 页面只呈现克重与摆盘结果,**不展示任何价格**。
 *
 * 路由组选 `(marketing-atelier)`:与首页 / 商品详情页共用 atelier 的
 * 页头、页脚和 commerce overlay,跟站点当前的公开面一致。
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
    ? "上传 3D 模型,本地解析体积与表面积,算出耗材克重、支撑克重与最佳打印摆盘角度。模型不上传,结果不入库。"
    : "Upload a 3D model and get its resin weight, support weight and best print orientation — computed locally in your browser. Files are never uploaded and results are never stored.";

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

export default function PricingPage() {
  return <PricingCalculator showChrome={false} />;
}
