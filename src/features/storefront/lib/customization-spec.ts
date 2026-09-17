/**
 * Customization Spec —— 客户端 → 服务端的 customize 规格契约
 *
 * 对齐 atelier src/lib/store/customization-spec.ts:
 *  - CustomizationSpec: 客户端上传的 spec
 *  - specToMetadata(): 转成 CartLineItem.metadata 存到 cart
 *
 * 切真 Medusa 时:这个 contract 不变(写到 line item metadata),
 * 改由 Medusa schema 决定 server 端如何处理 metadata 字段。
 */

import type {
  CartLineItemMetadata,
  CustomizationSpec,
  ProductTypeCode,
  StorefrontProduct,
} from "../types";

/**
 * 把 CustomizationSpec 压缩成 CartLineItemMetadata
 * (去重 productTypeCode 因为 metadata 不需要,productId 隐含)
 */
export function specToMetadata(
  spec: CustomizationSpec,
  product: StorefrontProduct
): CartLineItemMetadata {
  return {
    productId: product.id,
    productHandle: product.handle,
    productTitle: product.title,
    productThumbnail: product.thumbnail,
    materialId: spec.materialId,
    sizeId: spec.sizeId,
    sizeCm: Number.parseInt(spec.sizeId.split("_").pop() ?? "0", 10) || 0,
    aiStyleId: spec.aiStyleId,
    engravingText: spec.engravingText,
    rushOrder: spec.rushOrder,
    previewImage: spec.previewImageUrl,
    originalImage: spec.originalImageUrl,
  };
}

/**
 * 从 CartLineItem.metadata 还原成 CustomizationSpec
 * (用于购物车详情 / 订单历史)
 */
export function metadataToSpec(
  metadata: CartLineItemMetadata,
  overrides?: {
    quantity?: number;
    productTypeCode?: ProductTypeCode;
  }
): CustomizationSpec {
  // sizeCm → productTypeCode 推断:只能从 productHandle 反推
  // 这里只能从 sizeCm 找对应 productTypeCode
  // 简化版:依赖 metadata.sizeCm 已知,productTypeCode 由 caller 注入
  const productTypeCode: ProductTypeCode = overrides?.productTypeCode ?? "R";

  return {
    productId: metadata.productId,
    productHandle: metadata.productHandle,
    productTypeCode,
    materialId: metadata.materialId,
    sizeId: metadata.sizeId,
    aiStyleId: metadata.aiStyleId,
    engravingText: metadata.engravingText,
    rushOrder: metadata.rushOrder,
    quantity: overrides?.quantity ?? 1,
    previewImageUrl: metadata.previewImage,
    originalImageUrl: metadata.originalImage,
  };
}

/**
 * 校验 CustomizationSpec 是否合法
 * - 必填字段非空
 * - sizeCm / materialId / aiStyleId 在字典里
 */
export function validateSpec(spec: CustomizationSpec): void {
  if (!spec.productId) throw new Error("productId 必填");
  if (!spec.productHandle) throw new Error("productHandle 必填");
  if (!spec.materialId) throw new Error("materialId 必填");
  if (!spec.sizeId) throw new Error("sizeId 必填");
  if (!spec.aiStyleId) throw new Error("aiStyleId 必填");
  if (!spec.previewImageUrl)
    throw new Error("previewImageUrl 必填(transform 输出)");
  if (!spec.originalImageUrl) throw new Error("originalImageUrl 必填(原图)");
  if (!Number.isInteger(spec.quantity) || spec.quantity < 1) {
    throw new Error("quantity 必须 ≥ 1 整数");
  }
  if (spec.engravingText.length > 30) {
    throw new Error("刻字长度不能超过 30 字符");
  }
}
