import type { Metadata } from "next";
import { listUserAddresses } from "@/features/address/queries";
import { PrintServiceWeightTool } from "@/features/print-quote/components/print-service-weight-tool";
import { toClientPrintConfig } from "@/features/print-quote/lib/pricing-settings";
import { getPrintPricingSettings } from "@/features/print-quote/lib/pricing-store";
import { getServerSession } from "@/lib/auth/server";

/**
 * 打印前工作台 —— `/tools/workbench`
 *
 * 移植自 `C:\Users\Admin1\Downloads\wjp-source-code`(PolyJet 耗材填充克重
 * 计算器)。整页的检查 / 克重 / 解析都在浏览器本地跑:
 *  - 模型文件**默认**不上传服务器;
 *  - 计算结果不写数据库(「只算不存」);
 *  - 材料参数(密度 / 支撑几何)由后台 `/admin/print-pricing` 统一配置,
 *    访客改不了 —— 页面只读。
 *
 * ## 2026-11-07:模型检查工具并进来了 —— 一个页面,两个视角
 *
 * 工作室的原话:**「不想分成两个工具页」**。以前模型检查(`/tools/model-check`)
 * 和克重(`/tools/weight`)是**两个页面**,同一个文件要拖两次、解压两次、量两遍,
 * 中间还要跳页。
 *
 * 现在合成一个工作台,模型**只载入一次**,里面用两个视角看同一个模型:
 *
 * ```
 * 检查 —— 打印前自检(反转法向 / 坏边破面 / 壳体封闭性)
 * 克重 —— 耗材克重 / 支撑克重 / 总克重 + 智能摆盘的结果
 * ```
 *
 * (以前还有第三个「摆盘」视角 —— 同日并进克重栏了:摆盘结果跟克重本来
 * 就是一件事,拆两栏要用户自己把两个数对上。智能摆盘那颗按钮还在。)
 *
 * 两栏的数字来自**同一个** `ModelFile`、同一套缩放、同一份后台参数 ——
 * 结构上就不可能对不上。
 *
 * ## 为什么地址叫 `/tools/workbench`
 *
 * 两个视角里没有一个能代表全名:叫 `/tools/weight` 只说了克重,叫
 * `/tools/model-check` 只说了检查。老地址(`/pricing` / `/tools/weight` /
 * `/tools/model-check`)都 308 跳过来 —— 链接不断,权重也转得过去。
 *
 * ## 2026-11-08:工具页是打印服务的入口 —— 直接建工单
 *
 * 工作室的说法:**「不要放入购物车,放在这里 account/print-orders」**。
 *
 * 流程收成两步:
 *
 *   /tools/workbench(量重量的工具,公开)
 *     → 点「填写下单信息」→ 表单展开在下面(收货地址 / 交期 / 支付方式)
 *     → 提交 → 服务端重算报价 + 建一张打印工单
 *     → 跳 `/account/print-orders/{orderNo}` —— 钱在那儿付
 *
 * **打印服务不进商城购物袋** —— 商城购物袋只装目录商品(钥匙扣 / 冰箱贴 …),
 * 打印服务是另一条线:工单自己建、自己收款。
 *
 * 报价台(`/quote`)2026-11-06 整页删掉了 —— 它跟工具页用的是**同一个**克重
 * 计算器,重复了一份「报价 + 交期 + 下单」的下单控件。
 *
 * 打印单(`/print-order`)2026-11-08 也整页删掉了 —— 打印单**不是一个页面**,
 * 是 `/account/print-orders` 那一个列表 + 工单详情页。
 *
 * 两条边界照旧:
 * - **工具页不自己算价** —— 价格是服务端算的,工具页只出几何(体积 / 表面积 /
 *   尺寸 / 支撑克重),交给服务端重算报价。
 *   (2026-11-07 起,右栏那张卡上多了一个**预估报价** —— 那是问
 *   服务端要的,不是本地算的;访客也能看,后台 `/admin/print-pricing` 的
 *   「访客可见计价」开关管着)
 * - **模型不上传** —— 上传是**提交订单**的一部分,不是量重量的副产品
 *
 * ## 登录要在量之前
 *
 * 下单要登录(工单挂在账号名下,模型文件也落到用户自己的 R2 分区)。
 * 登录那一下是**整页跳转**,浏览器里的模型会没 —— 所以卡片上的按钮在没登录
 * 时是「去登录」,文案写的是「先登录再量」,而不是让人量完再被弹去登录。
 *
 * 登录态、地址簿、账号称呼由页面的 RSC 查好传下去。
 *
 * ## 为什么从 `/pricing` 挪出来
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
    ? "3D 打印前工作台 — 模型检查 / 克重"
    : "3D Print Pre-flight Workbench — Check, Weight";

  const description = isZh
    ? "上传 3D 模型,一次载入两个视角:打印前自检(反转法向、坏边破面、壳体封闭性)、耗材与支撑克重(含智能摆盘的最省姿态)—— 全部在浏览器本地算,问题位置在 3D 里直接标色。量完直接提交打印订单,收货地址、交期和金额在工单上确认 —— 量重量的过程模型不上传。"
    : "Upload a 3D model once and view it two ways: pre-flight inspection (inverted normals, broken faces, shell integrity) and resin / support weight (with the leanest print orientation) — all computed locally in your browser, with problems highlighted in 3D. Submit a print order straight from the workbench and confirm the address, delivery and total on the order; nothing is uploaded while measuring.";

  return {
    title,
    description,
    // 检查 + 克重两套关键词都留着 —— 合并之前这是两个页面,各自被收录过
    keywords: isZh
      ? [
          "3D打印克重",
          "耗材克重计算器",
          "光敏树脂",
          "PolyJet",
          "支撑克重",
          "打印摆盘",
          "用量预估",
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
          "3d print weight calculator",
          "resin weight",
          "PolyJet",
          "support weight",
          "print orientation",
          "material usage estimator",
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

export default async function WorkbenchPage({
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
    `/${locale}/tools/workbench`
  )}`;

  // 生效中的打印定价设置 —— 密度 / 支撑几何
  //
  // **访客改不了**(2026-11-06):这些数来自后台 `/admin/print-pricing`
  // (兜底 `PRINT_*` 环境变量)。工具页的**克重**是本地算的,价格一律服务端算 ——
  // 单价 / 后处理 / 阈值 / 交期比例不往浏览器里发,那张卡上的预估价是问
  // 服务端要的(`POST /api/print-quote`)。
  const clientConfig = toClientPrintConfig(await getPrintPricingSettings());

  // 地址簿 —— 下单要选收货地址(2026-11-08)
  //
  // 没登录就空着 —— 表单那一路压根到不了(卡片上是「去登录」)。
  const addresses = session?.user?.id
    ? await listUserAddresses(session.user.id)
    : [];

  return (
    <PrintServiceWeightTool
      isLoggedIn={isLoggedIn}
      signInUrl={signInUrl}
      clientConfig={clientConfig}
      addresses={addresses}
      user={{
        name: session?.user?.name ?? "",
        email: session?.user?.email ?? "",
      }}
    />
  );
}
