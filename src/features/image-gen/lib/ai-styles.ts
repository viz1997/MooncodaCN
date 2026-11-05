/**
 * 模板视觉样式 —— 默认种子 + helpers
 *
 * 2026-10-16 v1.5.0:本模块最初被设计为「全平台共享的样式字典」,通过
 * GET /api/image-gen/style-types 暴露给 SDK。后被需求调整推翻,改成
 * 「每个 promptTemplate 自带 styles 数组」的形态:
 *
 *   - 真值源 = promptTemplate.styles(JSON 列,见 src/db/schema.ts)
 *   - 本模块 = DEFAULT_TEMPLATE_STYLES,给新建模板的 admin 表单当默认
 *     seeds;模板可在此基础上增删改覆盖
 *   - 不再有独立的 GET /api/image-gen/style-types 端点
 *
 * 概念对照(必读):
 *   - 视觉样式(本模块)= prompt 替换占位词
 *     例:template.prompt = "Render pet in {{style}} style"
 *          + ai_anime.style.prompt = "anime illustration..."
 *     结果 = "Render pet in anime illustration... style"
 *   - 模型参数样式(validation.ts:46 那个 natural/vivid/anime enum)
 *     = OpenAI 类上游原生滤镜,与本模块正交。
 *   - 工艺样式(productEffect.config.style: string)
 *     = 数据库里 relief / engraving / 3d-figurine,UI 上另一个维度。
 *
 * 当前默认 5 项:Q 版 / 日漫 / 水彩 / 线稿 + 原图保留(直通)。
 * ai_original 的 prompt = "",服务端看到会跳过替换(等价于不传 aiStyleId),
 * 行为与 v1.4.0 完全一致 —— 零回归。
 */

import type { TemplateStyle } from "@/db/image-gen-types";

export type { TemplateStyle };

/**
 * 默认样式种子 —— 新建 promptTemplate 时 admin 表单可一键填这 5 项。
 * 已有模板无 styles(老数据)用此 list 自动补全,过渡平滑。
 *
 * 注意:不是真理源 —— promptTemplate.styles 列才是。两边手动修改互不
 * 影响(模板覆盖优先,默认种子只是 admin 便利);业务读取永远走模板。
 */
export const DEFAULT_TEMPLATE_STYLES: TemplateStyle[] = [
  {
    id: "ai_original",
    name: "原图保留",
    nameEn: "Original",
    prompt: "", // 直通,不替换 {{style}}(占位符缺失时也不 prepend)
    surchargeCents: 0,
    outputSize: "1024x1024",
    swatch: "#9CA3AF",
    estimatedLatencySec: 0,
  },
  {
    id: "ai_qversion",
    name: "Q 版萌系",
    nameEn: "Q-Version",
    prompt:
      "Q-version chibi figurine with simplified features, big eyes, and soft pastel tones; identity recognizable",
    surchargeCents: 1500, // +¥15
    outputSize: "1024x1024",
    swatch: "#7A5A8C",
    estimatedLatencySec: 25,
  },
  {
    id: "ai_anime",
    name: "日漫风",
    nameEn: "Anime",
    prompt:
      "Japanese anime illustration style with vibrant colors, clean line art, and detailed shading; facial features and hairstyle preserved",
    surchargeCents: 2000, // +¥20
    outputSize: "1024x1024",
    swatch: "#E879F9",
    estimatedLatencySec: 28,
  },
  {
    id: "ai_watercolor",
    name: "水彩手绘",
    nameEn: "Watercolor",
    prompt:
      "soft watercolor painting with visible brushstrokes, gentle color bleeds, and warm light; recognizable silhouette",
    surchargeCents: 1500, // +¥15
    outputSize: "1024x1024",
    swatch: "#60A5FA",
    estimatedLatencySec: 22,
  },
  {
    id: "ai_lineart",
    name: "线稿简笔",
    nameEn: "Line Art",
    prompt:
      "clean black-and-white line art suitable for engraving; bold outlines, no shading, simplified details for laser-cut reproduction",
    surchargeCents: 1000, // +¥10
    outputSize: "1024x1024",
    swatch: "#1F2937",
    estimatedLatencySec: 18,
  },
  // 2026-10-18 v1.6.0：新增写实风格。语义对齐「3D 手办 / 真人雕塑」业务
  // （用户原话「3D手办里面设置了Q版、写实」）。admin 把这个 seed 项分配到
  // 对应 promptTemplate.styles[] 即可生效；未分配的模板不渲染该 chip。
  {
    id: "ai_realistic",
    name: "写实风格",
    nameEn: "Realistic",
    prompt:
      "photorealistic style with true-to-life materials, natural lighting, fine surface textures, and accurate proportions; portrait-grade fidelity",
    surchargeCents: 2500, // +¥25（写实档普遍贵一档）
    outputSize: "1536x1024", // 写实档优先横版构图
    swatch: "#7A5C3A",
    estimatedLatencySec: 35,
  },
];

/**
 * 在某个模板的 styles 列表里按 id 找。
 * 单纯 .find 等价,提为 helper 是为了将来加校验、归一化、缓存好找点。
 */
export function findStyleInList(
  styles: readonly TemplateStyle[],
  id: string
): TemplateStyle | undefined {
  return styles.find((s) => s.id === id);
}
