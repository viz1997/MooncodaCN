import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ModelInspector } from "@/features/tools/components/model-inspector";

/**
 * 模型检查 —— `/tools/model-check`
 *
 * 3D 打印前的自检:破面(退化 / 重复 / 开放边 / 非流形边 / 翻面 / 重复顶点)
 * + 过薄(壁厚低于阈值)+ 悬空(需要支撑的面积占比)。
 *
 * 全部在浏览器本地跑:模型不上传,结果不入库,不要求登录。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "模型检查 — 破面 / 过薄 / 悬空自检"
    : "Model Inspector — Broken Faces, Thin Walls, Overhangs";

  const description = isZh
    ? "上传 3D 模型,本地检查破面(退化面 / 重复面 / 开放边 / 非流形边)、过薄区域与悬空面积。问题面在 3D 里直接标红。模型不上传。"
    : "Upload a 3D model and check it locally for broken faces, non-manifold edges, thin walls and overhangs. Problems are highlighted in 3D. Files are never uploaded.";

  return {
    title,
    description,
    keywords: isZh
      ? [
          "3D模型检查",
          "破面检测",
          "非流形边",
          "壁厚检测",
          "过薄",
          "悬空角度",
          "切片前检查",
        ]
      : [
          "3d model checker",
          "non-manifold edges",
          "thin wall check",
          "overhang angle",
          "mesh validation",
          "printability check",
        ],
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

export default async function ModelCheckPage() {
  const t = await getTranslations("ModelInspector");

  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
      <header className="max-w-2xl mb-8">
        <p className="eyebrow text-[var(--accent)] mb-4">{t("page.eyebrow")}</p>
        <h1 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.05] text-balance">
          {t("page.title")}
        </h1>
        <p className="mt-4 text-base text-foreground/65 leading-relaxed text-pretty">
          {t("page.description")}
        </p>
      </header>
      <ModelInspector />
    </div>
  );
}
