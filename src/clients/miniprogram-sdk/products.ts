/**
 * 小程序 SDK —— 产品能力接口（v1.6.0 新增）
 *
 * 2026-10-18 v1.6.0:面向小程序 / 网页端拉「产品 + 配件 + 视觉风格 + 模板」
 * 一站式元数据。
 *
 * 数据流：
 *   1. 进入生图页 / 配置页前 listProducts() 一次拿全
 *   2. 用户选 productTypeCode → 从 products[i].accessories[] 选配件
 *   3. 用户选 accessory → 如有变体从 variants[] 选具体 code
 *   4. 用户选 templates[i].templateId（同时选 visualStyles[j].id 做 aiStyleId）
 *   5. submitGenerate({ maskId, imageUrls, aiStyleId, size, ... })
 *
 * 与 listTemplates() 的关系：
 *   - listTemplates() 以 maskId 维度组织,适合老 SDK / 工作台
 *   - listProducts() 以 productTypeCode 维度组织,适合小程序新品 UI
 *     （一个产品下面挂多个模板）
 *   - 两者数据源都是 productEffect + promptTemplate + productAccessoryVariant
 *     + 硬编码字典,后续可统一成一个端点
 *
 * 鉴权：与 /api/image-gen/templates 一致（x-api-key > Bearer<key>），
 * dev 模式 EXTERNAL_API_KEY_REQUIRED=0 关；已登录 BA session 也可走
 * requireExternalApiKey 放行分支。
 */

import { sdkRequest } from "./request";
import type { ProductCapability, ProductListResponse } from "./types";

/**
 * 拉所有（或指定 productTypeCode 子集）产品能力数据
 *
 * @param params.productTypeCodes  过滤子集，如 ["R", "M"]；不传返回全部
 * @param params.locale            "zh" | "en"；不传按 Accept-Language 推断
 *
 * 用法：
 *   const { products } = await listProducts();
 *   // products[0] = { productTypeCode: "R", category: "keychain", displayName: {...}, sizes: [...], visualStyles: [...], accessories: [...], templates: [...] }
 *   // products[0].accessories[i].variants = [...] (空数组 = 无变体)
 */
export async function listProducts(params?: {
  productTypeCodes?: string[];
  locale?: "zh" | "en";
}): Promise<ProductListResponse> {
  const query: Record<string, string> = {};
  if (params?.productTypeCodes && params.productTypeCodes.length > 0) {
    query.productTypeCode = params.productTypeCodes.join(",");
  }
  if (params?.locale) {
    query.locale = params.locale;
  }
  return sdkRequest<ProductListResponse>("/api/image-gen/products", {
    method: "GET",
    query,
    timeoutMs: 30_000,
  });
}

/**
 * 拉单个产品的完整能力（便利函数，底层仍调 listProducts）
 *
 * @param code      productTypeCode，如 "R" / "M"
 * @param locale    i18n 切换
 * @returns         ProductCapability | null（产品不存在时返 null）
 */
export async function getProduct(
  code: string,
  locale?: "zh" | "en"
): Promise<ProductCapability | null> {
  const res = await listProducts({
    productTypeCodes: [code],
    ...(locale !== undefined && { locale }),
  });
  return res.products[0] ?? null;
}
