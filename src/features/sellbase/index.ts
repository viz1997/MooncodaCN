/**
 * Sellbase 集成 —— 公开出口
 *
 * 集成形态:**本仓库算价,Sellbase 只做收银台**。
 *
 * - 本仓库是目录和定价的真理源(`product` / `product_variant`)
 * - 建单时每一行都指向一个「载体变体」,真正的价格永远走
 *   `items[].unit_price_amount`
 * - 钱最终由 Sellbase + Stripe 收,状态由 webhook 回写
 *
 * 详见 `architecture-sellbase-integration.md`。
 */

export {
  CarrierNotFoundError,
  PRINT_SERVICE_PRODUCT_CODE,
  PRINT_SERVICE_SKU,
  resolveCarrierVariant,
  resolvePrintServiceCarrier,
  sizeCodeFromSpecSizeId,
} from "./lib/carrier";

export {
  callSellbase,
  getSellbaseAdmin,
  SellbaseApiError,
  toSellbaseApiError,
} from "./lib/client";
export {
  getSellbaseConfig,
  getSellbaseWebhookSecret,
  getSiteUrl,
  isSellbaseConfigured,
  readSellbaseUrl,
  SELLBASE_CURRENCY,
  SELLBASE_FX_RATE,
  SellbaseNotConfiguredError,
} from "./lib/env";
export {
  classifySellbaseEvent,
  extractSellbaseOrderId,
  SELLBASE_SUBSCRIBED_EVENTS,
  type SellbasePaymentAction,
  type SellbaseWebhookPayload,
} from "./lib/events";
export {
  amountsMatchWithinRounding,
  centsToStoreAmount,
  getCurrencyConversion,
  SellbaseCurrencyError,
  storeAmountToCents,
} from "./lib/money";
export {
  buildSellbaseSignatureHeader,
  computeSellbaseSignature,
  parseSellbaseSignatureHeader,
  SELLBASE_SIGNATURE_HEADER,
  SELLBASE_WEBHOOK_TOLERANCE_SECONDS,
  verifySellbaseSignature,
} from "./lib/signature";
