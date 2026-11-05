/**
 * 打印服务购物车行 —— **共享契约**(客户端 / 服务端都读这一份)
 *
 * ## 打印服务不是「目录商品」
 *
 * 商城里别的行是「目录商品 + 规格」:产品 id 指向 `mock-catalog` 里的某件
 * 作品,价格由 `calculatePricing()` 按材质 / 尺寸 / 配件算出来。
 *
 * 打印服务是**来料加工**:用户自带 3D 模型,按克重计价,目录里没有对应商品,
 * 也没有「材质 / 尺寸 / 配件」这些维度。所以它走另一套:
 *
 * - 定价 → `computePrintQuote()`(几何 → 克重 → 价,见 `print-quote/lib/quote-server.ts`)
 * - 载体变体 → `resolvePrintServiceCarrier()`(Sellbase 里的「打印服务」载体行)
 * - 工单 → 结算时建 `print_order`,靠 `storefront_order_id` 跟商城订单挂上
 *
 * ## 这个文件为什么是纯的
 *
 * 它被客户端组件(克重工具的「加入购物车」面板)和服务端(购物车 / 结算)同时
 * import。所以**不能**在这里 import 任何服务端模块(`quote-server.ts` 读
 * `process.env`、`db/index.ts` 连库)—— 那会让客户端 bundle 里混进 Node 代码。
 *
 * 服务端的定价在 `print-quote/lib/quote-server.ts` 里,两边通过
 * `printServiceSpecToQuoteInput()` 对齐输入形状。
 */

import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";

import type { CartLineItemMetadata, PrintServiceSpec } from "../types";

/* -------------------------------------------------------------------------- */
/*  哨兵值                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 打印服务行的哨兵 productId
 *
 * 打印服务在 `mock-catalog` 里**没有**对应商品 —— 它的价格取决于用户的模型,
 * 不是目录价。所以 `cart_item.product_id` 存这个固定值,靠
 * `metadata.printSpec` 是不是有值来判定「这一行是打印服务」。
 *
 * 不要拿它去 `findProductById()` —— 查不到是**预期**的。
 */
export const PRINT_SERVICE_PRODUCT_ID = "service_print_3d";

/**
 * handle —— 与 Sellbase 侧的「打印服务」载体商品一致
 *
 * `scripts/sync-sellbase-catalog.ts` 建的载体商品 slug 就是 `print-service`。
 */
export const PRINT_SERVICE_HANDLE = "print-service";

/**
 * 购物车 / 订单行里的商品名(快照)
 *
 * 中文 —— 购物车抽屉整个是中文的(见 `cart-drawer.tsx`),这里跟着走。
 * 英文站点的抽屉另有一层 i18n 兜底(`PrintQuote.cart.title`)。
 */
export const PRINT_SERVICE_TITLE = "定制打印(按克重)";

/* -------------------------------------------------------------------------- */
/*  判定                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 这一行是不是打印服务行
 *
 * 判据是「metadata 里有没有 printSpec」,不是 productId —— 判 productId
 * 的话,老版本代码路径里任何一个拼错都会把打印服务行当成普通商品行去定价,
 * 然后报「未知产品」,用户看到的是一句看不懂的错。
 */
export function isPrintServiceMetadata(
  metadata: CartLineItemMetadata | null | undefined
): boolean {
  return Boolean(metadata?.printSpec);
}

/** 取出行上的打印服务规格 —— 不是打印服务行就返回 null */
export function getPrintServiceSpec(
  metadata: CartLineItemMetadata | null | undefined
): PrintServiceSpec | null {
  return metadata?.printSpec ?? null;
}

/* -------------------------------------------------------------------------- */
/*  构造                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 打印服务行的 metadata
 *
 * 目录商品那套字段(材质 / 尺寸 / AI 风格 / 配件 / 刻字)对打印服务没有意义,
 * 填空串和 0 —— 购物车抽屉靠 `sizeCm > 0` 之类的判断决定要不要渲染它们,
 * 空值天然不渲染。
 *
 * ## 封面图默认是空的
 *
 * 打印服务行**没有封面图** —— 手上有的是模型文件(一个 zip),不是图片。
 * 拿 zip 的 URL 塞进 `<img src>` 只会显示一个裂图。购物车 / 结算页认到
 * `printSpec` 就画一个包裹图标(见 `cart-drawer.tsx`)。
 */
export function buildPrintServiceMetadata(input: {
  spec: PrintServiceSpec;
  /** 封面图 —— 一般不传(打印服务没有封面) */
  thumbnail?: string | null;
}): CartLineItemMetadata {
  return {
    productId: PRINT_SERVICE_PRODUCT_ID,
    productHandle: PRINT_SERVICE_HANDLE,
    productTitle: PRINT_SERVICE_TITLE,
    productThumbnail: input.thumbnail ?? "",
    materialId: "",
    sizeId: "",
    sizeCm: 0,
    aiStyleId: "",
    engravingText: "",
    rushOrder: false,
    accessoryVariantIds: [],
    previewImage: "",
    originalImage: "",
    printSpec: input.spec,
  };
}

/* -------------------------------------------------------------------------- */
/*  规格 hash                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 打印服务行参与「同 spec 合并」的字段
 *
 * ## 为什么模型文件的对象键要进 hash
 *
 * 同一组几何(同样的体积 / 尺寸 / 支撑)但**不同的模型文件**,是两件不同的活 ——
 * 工作室要打的不是同一个东西。所以 `modelObjectKey` 必须进 hash。
 *
 * 不用 `modelUrl`:URL 里含桶域名,域名一改 hash 就全变,存量购物车会分裂成
 * 两行。对象键是稳定的。
 *
 * ## 交期档位也要进 hash
 *
 * 加急和不加急是两份报价(加价 37% / 10%)。合成一行的话,用户看到的「加急」
 * 会被后面合并进来的标准档行覆盖掉。
 */
export function printServiceSpecHashParts(spec: PrintServiceSpec): string[] {
  return [
    spec.volumeCM3.toFixed(6),
    spec.surfaceAreaCM2.toFixed(6),
    spec.dims.map((d) => d.toFixed(6)).join("x"),
    (spec.supportWeightG ?? 0).toFixed(6),
    (spec.selfSupportRatio ?? 0).toFixed(6),
    spec.deliveryTier,
    spec.modelObjectKey,
  ];
}

/* -------------------------------------------------------------------------- */
/*  形状转换                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 购物车里的打印服务规格 → 报价引擎的入参
 *
 * 一一对应,不做任何加工 —— 报价引擎拿到的必须跟用户在克重工具上看到的那组
 * 几何是同一组。
 */
export function printServiceSpecToQuoteInput(
  spec: PrintServiceSpec
): PrintQuoteInput {
  return {
    volumeCM3: spec.volumeCM3,
    surfaceAreaCM2: spec.surfaceAreaCM2,
    dims: spec.dims,
    supportWeightG: spec.supportWeightG,
    selfSupportRatio: spec.selfSupportRatio,
    deliveryTier: spec.deliveryTier,
  };
}
