import {
  ACCESSORIES,
  getAccessory,
  getProductType,
} from "@/features/gpt-image/lib/product-catalog";

/**
 * 2026-09-07：代理商业务三件套字典校验（保留 ToC 全 null 路径）。
 *
 * 校验 (productTypeCode, productSize, accessoryCode) 三个字段是否组合合法：
 * 1. productTypeCode 必须在 PRODUCT_TYPES 里
 * 2. productSize 必须是该型号下合法的尺寸
 * 3. accessoryCode 如果给了，必须是该型号下合法的配件
 * 4. 三件套可以全 null（ToC 订单不强绑定）
 *
 * 2026-09-07 起创建订单（agent / admin）只挑 productTypeCode；尺寸 / 配件
 * 由 createOrder service 端按"该型号首选项"自动填入（"链接创建时定死"）。
 * 本 helper 仍然作为"后端兜底"——防直调 API 写脏值（不合法组合 / 不存在的
 * 型号 / 配件），与前端级联 select 的语义保持一致。
 *
 * 用法：
 * ```ts
 * validateProductSpec(productTypeCode, productSize, accessoryCode);
 * ```
 * 抛出 Error（含中文原因），让上层 action 抛给客户端。
 */
export function validateProductSpec(
  productTypeCode: string | null | undefined,
  productSize: string | null | undefined,
  accessoryCode: string | null | undefined
): void {
  // ToC 订单：三件套全空，OK
  if (!productTypeCode && !productSize && !accessoryCode) {
    return;
  }

  // 选了 size / accessory 但没选 type → 非法
  const type = getProductType(productTypeCode);
  if (!type) {
    throw new Error(
      productTypeCode
        ? `产品型号不存在：${productTypeCode}`
        : "请先选择产品型号"
    );
  }

  // size 必须在 type.sizes 里（如果给了）
  if (productSize && !type.sizes.includes(productSize)) {
    throw new Error(
      `${type.name} 不支持 ${productSize}cm（可选：${type.sizes.join("/")}cm）`
    );
  }

  // accessory 必须在 type.accessories 里（如果给了）
  if (accessoryCode) {
    const acc = getAccessory(accessoryCode);
    if (!acc) {
      throw new Error(`配件不存在：${accessoryCode}`);
    }
    if (!type.accessories.includes(acc.code)) {
      throw new Error(
        `${type.name} 不支持 ${acc.name}（该型号可选配件：${
          type.accessories
            .map((c) => ACCESSORIES.find((x) => x.code === c)?.name ?? c)
            .join("/") || "无"
        }）`
      );
    }
  }
}
