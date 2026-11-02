import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ModelChecker } from "@/features/tools/components/model-check/model-checker";

/**
 * 模型检查 —— `/tools/model-check`
 *
 * WJP 全彩打印前的自检:反转法向(整体朝内 / 局部翻转)、坏边与破面
 * (缝隙、平面孔洞、退化面、重复面、非流形边)、壳体与封闭性
 * (多余壳体、噪声碎片、密封内腔)。
 *
 * 不检测悬空(WJP 用水溶性包裹支撑)、不做壁厚检测(全彩是实心填充)。
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
    ? "模型检查 — 反转法向 / 坏边破面 / 壳体封闭性自检"
    : "Model Inspector — Inverted Normals, Broken Faces, Shell Integrity";

  const description = isZh
    ? "上传 3D 模型,本地检查反转法向、坏边与破面(开放边 / 平面孔洞 / 退化面 / 重复面 / 非流形边)与壳体问题(多余壳体 / 噪声碎片 / 密封内腔),按 WJP 全彩工艺标准给出结论。问题位置在 3D 里直接标色。模型不上传。"
    : "Upload a 3D model and check it locally for inverted normals, broken edges and faces (open edges, planar holes, degenerate, duplicate, non-manifold) and shell problems (extra shells, noise fragments, sealed cavities) — judged against WJP full-color rules. Problems are highlighted in 3D. Files are never uploaded.";

  return {
    title,
    description,
    keywords: isZh
      ? [
          "3D模型检查",
          "模型破面检测",
          "反转法向",
          "非流形边",
          "平面孔洞",
          "密封内腔",
          "网格封闭性",
          "WJP全彩",
          "切片前检查",
        ]
      : [
          "3d model checker",
          "inverted normals",
          "non-manifold edges",
          "planar holes",
          "sealed cavity",
          "watertight mesh",
          "mesh validation",
          "WJP full color",
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
      <ModelChecker />
    </div>
  );
}
