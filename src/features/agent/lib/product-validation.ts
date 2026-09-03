import {
  ACCESSORIES,
  getAccessory,
  getProductType,
} from "@/features/gpt-image/lib/product-catalog";

/**
 * 2026-09-03：代理商业务三件套字典校验。
 *
 * 校验 (productTypeCode, productSize, accessoryCode) 三个字段是否组合合法：
 * 1. productTypeCode 必须在 PRODUCT_TYPES 里
 * 2. productSize 必须是该型号下合法的尺寸
 * 3. accessoryCode 如果给了，必须是该型号下合法的配件
 * 4. 三件套可以全 null（ToC 订单不强绑定）；但代理商 portal（agentCreateOrderAction）
 *    在前端 + schema 层都强制必填 productTypeCode/size
 *
 * 与 OrderFormDialog 的前端级联校验保持一致的语义：尺寸/配件 select
 * 切换型号时清空，避免遗留非法组合。本 helper 是"后端兜底"——防直调 API
 * 绕过前端级联写下脏值。
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

/**
 * 2026-09-03：代理商 portal 创建订单专用 —— 三件套必填。
 *
 * 与 validateProductSpec 的差别是"全 null = OK"的允许与否。
 * 代理商自下单时 productTypeCode / productSize 必填；accessoryCode
 * 看具体型号是否需要（R/A 有配件必填，P/RM 无配件留空）。
 */
export function validateAgentProductSpec(opts: {
  productTypeCode: string | null | undefined;
  productSize: string | null | undefined;
  accessoryCode: string | null | undefined;
}): void {
  if (!opts.productTypeCode) {
    throw new Error("请选择产品型号");
  }
  if (!opts.productSize) {
    throw new Error("请选择产品尺寸");
  }

  const type = getProductType(opts.productTypeCode);
  if (!type) {
    throw new Error(`产品型号不存在：${opts.productTypeCode}`);
  }

  // 如果该型号要求配件，accessoryCode 必填
  if (type.accessories.length > 0 && !opts.accessoryCode) {
    const required = type.accessories
      .map((c) => ACCESSORIES.find((x) => x.code === c)?.name ?? c)
      .join("/");
    throw new Error(`${type.name} 必须选择配件（${required}）`);
  }

  validateProductSpec(
    opts.productTypeCode,
    opts.productSize,
    opts.accessoryCode
  );
}
