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
 * ## 2026-11-05:量完可以直接加入购物车
 *
 * 之前这个页面只到「量」为止 —— 要下单得另去 `/quote` 重新传一遍文件。
 * 现在报价条挂在右栏(跟 `/quote` 用的是**同一个**服务端报价接口、
 * 同一套口径),量完就能:
 *
 *   选交期 → 加进购物车 → 跟别的商品一起结算(一次出 `SO-…` + `PO-…`)
 *
 * **模型文件仍然只在用户点「加入购物车」的那一刻才上传** —— 量的时候
 * 一个字节都不出浏览器。上传是加购动作的一部分,不是量重量的副产品。
 *
 * 加购要登录(模型要落到 R2,而且工单必须挂在账号名下),所以登录态由页面
 * 的 RSC 查好传下去,未登录时按钮变成登录链接。
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
    ? "上传 3D 模型,本地解析体积与表面积,算出耗材克重、支撑克重与最佳打印摆盘角度。量完可直接加入购物车下单 —— 量重量的过程模型不上传。"
    : "Upload a 3D model and get its resin weight, support weight and best print orientation — computed locally in your browser. Add it to the cart and order right away; nothing is uploaded while measuring.";

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

  // 加购要登录 —— 模型要上传到 R2,而且打印工单必须挂在账号名下
  const session = await getServerSession();
  const isLoggedIn = Boolean(session?.user?.id);

  // 登录完回到本页(用户得重新选一次模型文件 —— 文件在浏览器里,导航就没了)
  const signInUrl = `/sign-in?callbackUrl=${encodeURIComponent(
    `/${locale}/tools/weight`
  )}`;

  return (
    <PrintServiceWeightTool isLoggedIn={isLoggedIn} signInUrl={signInUrl} />
  );
}
