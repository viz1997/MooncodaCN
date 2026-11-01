import type { Metadata } from "next";
import { ToolsHub } from "@/features/tools/components/tools-hub";

/**
 * 工具中心 —— `/tools`
 *
 * 全站公开工具的入口。导航上只占一个「工具」位,具体有哪些工具在这一页列。
 *
 * 工具本身都是**本地计算**:模型不上传,结果不入库,不要求登录。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "工具中心 — 3D 打印自检工具"
    : "Tools — 3D Printing Utilities";
  const description = isZh
    ? "克重计算器、模型检查(破面 / 过薄)—— 全部在浏览器本地跑,模型不上传,结果不入库。"
    : "Resin weight calculator and model inspector (broken faces, thin walls) — everything runs locally in your browser.";

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default function ToolsPage() {
  return <ToolsHub />;
}
