import type { Metadata } from "next";
import { MagnetCutterTool } from "@/features/magnet/components/magnet-cutter-tool";

/**
 * 磁吸孔切割工具 —— `/tools/magnet`
 *
 * ## 这是什么
 *
 * 把模型**最平的那个面**上挖一个**盲孔**(Ø20.7mm / 深 1.3mm),切完下载
 * OBJ 给打印用。
 *
 * 工作室原来给的是一段 Blender Python 脚本,只能在工作室本地跑 ——
 * 客户拿不到这个能力,工作室每单也要手工过一道。这个页面把同一条链路
 * 搬到浏览器里。
 *
 * ## 三条边界
 *
 * - **不进工单** —— 切完只本地下载。下单时仍然传**原始模型**,工作室自己
 *   在 Blender 里切。所以这个工具**一行都不碰**报价 / 工单 / R2 上传 /
 *   支撑克重那条链路。
 * - **模型不上传** —— 解析、焊接、布尔运算全在浏览器里跑(Worker)。
 * - **孔径是固定实物尺寸** —— 磁铁是固定尺寸的实体,孔径**不跟模型缩放**。
 *
 * ## 为什么是**独立页面**,不塞进打印前工作台
 *
 * 工作室 2026-11-10 刚把工作台的视角收回两个(检查 / 克重),挤进第三个
 * 视角会把那条线搅乱。这个工具跟克重/检查**没有共享状态** —— 它不量
 * 克重、不算支撑、不下单 —— 独立一页更干净。
 *
 * ## 为什么在商城路由组
 *
 * `/tools/magnet` 在 `(marketing-atelier)` 下 —— 跟 `/tools/workbench` 同一
 * 组,共用商城的头。工具页自己不卖东西,但商城里能一键跳过去。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "磁吸孔切割工具 — 给 3D 模型挖一个 Ø20.7mm 盲孔"
    : "Magnet Pocket Cutter — Cut a Ø20.7 mm Blind Pocket Into Your 3D Model";

  const description = isZh
    ? "上传 3D 模型,自动挑出最平整的面,挖一个 Ø20.7mm、深 1.3mm 的磁吸沉孔,下载 OBJ 直接拿去打印。布尔运算在浏览器本地跑,模型不上传、不入库 —— 这是个纯前端的工具,不会替你下单。"
    : "Upload a 3D model and cut a Ø20.7 mm × 1.3 mm blind magnet pocket into its flattest face, then download the OBJ for printing. The boolean runs locally in your browser — nothing is uploaded and nothing is stored. This is a standalone tool; it does not place an order for you.";

  return {
    title,
    description,
    keywords: isZh
      ? [
          "磁吸孔",
          "磁铁孔",
          "沉孔切割",
          "3D模型挖孔",
          "OBJ切割",
          "曼ifold",
          "布尔运算",
          "3D打印配件",
        ]
      : [
          "magnet hole",
          "magnet pocket",
          "blind pocket cutter",
          "cut hole in 3d model",
          "obj boolean",
          "manifold",
          "3d print accessory",
        ],
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

export default function MagnetPage() {
  return <MagnetCutterTool />;
}
