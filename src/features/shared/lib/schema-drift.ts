/**
 * 数据库「漂移」的判定 —— 代码要什么 / 库里有什么 / 差哪些(2026-11-19)
 *
 * ## 为什么要有这个
 *
 * 线上真踩过:生产库的 `print_order` 少了 `idempotency_key` 这一列
 * (2026-11-16 那次迁移**没在那个库上跑**)⇒ Drizzle 每次查工单都带那一列
 * ⇒ PG 报 `42703 column "idempotency_key" does not exist` ⇒ 建单接口 500。
 *
 * 工作室按我给的命令跑完迁移之后,**同一个错又报了一遍**。最可能的原因只有
 * 两个:
 *
 * 1. 迁移**没跑**(脚本失败 / 跑错了库)
 * 2. 迁移**跑在另一个库上** —— 本地 `.env` / `.env.local` 里的
 *    `DATABASE_URL` 跟线上部署(Vercel 环境变量)那份**不是一个**
 *
 * ⇒ 光看「跑没跑」不够,**得先看清楚「我连的是哪个库」**。
 * 以前那些迁移脚本跑完只回读一句「✓ idempotency_key 列在」,**从不打印
 * 连的是哪个库** ⇒ 连错库跟跑成功在输出里长得一模一样,直到线上继续报错。
 *
 * 这个模块给体检脚本(`scripts/check-app-schema.ts`)提供两样纯函数:
 *
 * - `diffSchema()` —— 代码要的列 / 库里有的列,**差哪些**
 * - `driftToCommands()` —— 差的东西对应**哪条 `pnpm migrate:…` 命令**
 *
 * 「连的是哪个库」那一半在 `@/features/shared/lib/db-target` —— 那是另一个
 * 关注点(身份,不是漂移),脚本那边直接用它。
 *
 * ## 边界
 *
 * **零 import**(只有 `import type`)⇒ 能进 vitest 的 `unit` project,
 * 不碰数据库、不碰网络、不碰环境变量。
 */

/** 代码要的一张表(表名 + 列名) */
export interface ExpectedTable {
  /** 表名(数据库里的那个名字) */
  table: string;
  /** 列名(数据库里的那个名字) */
  columns: string[];
}

/** 一处漂移 —— 某张表缺了什么 */
export interface SchemaDrift {
  /** 表名 */
  table: string;
  /** 这一张表**整个都没建**(不是缺列) */
  tableMissing: boolean;
  /** 缺哪些列(表整个没建时 = 全部列) */
  missingColumns: string[];
}

/**
 * **表 → 迁移命令**
 *
 * 「这张表整个都没有」⇒ 该跑哪条命令。
 *
 * 只收**手写幂等脚本**建的表 —— 模板自带的那些表(`user` / `session` /
 * `ticket` …)没有对应脚本,缺了要靠 `pnpm db:push`。
 */
export const TABLE_MIGRATION_COMMANDS: Record<string, string> = {
  address: "pnpm migrate:apply-user-address",
  agent: "pnpm tsx scripts/apply-agent-schema.ts",
  agent_credit_transaction: "pnpm migrate:apply-agent-workbench",
  agent_prompt_template: "pnpm migrate:apply-agent-workbench",
  canvas_remote_job: "pnpm tsx scripts/apply-all-missing-migrations.ts",
  cart: "pnpm migrate:apply-storefront-cart",
  cart_item: "pnpm migrate:apply-storefront-cart",
  coupon: "pnpm migrate:apply-coupon",
  coupon_redemption: "pnpm migrate:apply-coupon",
  external_api_key: "pnpm tsx scripts/apply-all-missing-migrations.ts",
  payment_setting: "pnpm migrate:apply-payment-setting",
  preview_share: "pnpm tsx scripts/apply-all-missing-migrations.ts",
  print_material: "pnpm migrate:apply-print-pricing",
  print_order: "pnpm migrate:apply-print-order",
  print_order_event: "pnpm migrate:apply-print-order-event",
  print_pricing_config: "pnpm migrate:apply-print-pricing",
  product: "pnpm migrate:apply-product-catalog",
  product_accessory: "pnpm migrate:apply-catalog-dictionary",
  product_accessory_option: "pnpm migrate:apply-catalog-dictionary",
  product_accessory_variant: "pnpm migrate:apply-catalog-dictionary",
  product_line: "pnpm tsx scripts/apply-all-missing-migrations.ts",
  product_size: "pnpm migrate:apply-catalog-dictionary",
  product_taobao_link: "pnpm migrate:apply-taobao-link",
  product_variant: "pnpm migrate:apply-product-catalog",
  prompt_template_price: "pnpm tsx scripts/apply-all-missing-migrations.ts",
  refund_request: "pnpm migrate:apply-refund",
  refund_request_event: "pnpm migrate:apply-refund",
  shipment: "pnpm migrate:apply-shipment",
  shipment_event: "pnpm migrate:apply-shipment",
  site_setting: "pnpm migrate:apply-site-setting",
  storefront_case: "pnpm migrate:apply-showcase",
  storefront_order: "pnpm migrate:apply-sellbase-payment",
  storefront_order_item: "pnpm migrate:apply-sellbase-payment",
};

/**
 * **列 → 迁移命令**
 *
 * 键是 `表名.列名` —— **不按裸列名**,因为同一个列名可能在不同的表上、
 * 由不同的脚本加(比如 `coupon_code` 在 `cart` / `storefront_order` /
 * `print_order` 三张表上都有,但加它的是同一条命令;而 `payment_channel`
 * 在两张订单表上分别由**两条**不同的命令加)。
 */
export const COLUMN_MIGRATION_COMMANDS: Record<string, string> = {
  "cart.coupon_code": "pnpm migrate:apply-coupon",
  "cart.currency_code": "pnpm migrate:apply-storefront-cart",
  "cart.region_id": "pnpm migrate:apply-storefront-cart",
  "cart.user_id": "pnpm migrate:apply-storefront-cart",
  "cart_item.spec_hash": "pnpm migrate:apply-storefront-cart",
  "photo.image_job_id": "pnpm tsx scripts/apply-photo-source-enum.ts",
  "photo.model": "pnpm tsx scripts/apply-photo-source-enum.ts",
  "photo.prompt": "pnpm tsx scripts/apply-photo-source-enum.ts",
  "photo.source": "pnpm tsx scripts/apply-photo-source-enum.ts",
  "preview_share.cancelled_at":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.credits_locked":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.credits_locked_at":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.error_message":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.generated_at":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.generation_task":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.images_per_upload":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.regenerate_limit":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.selected_at":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.selected_batch_count":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.selected_index":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.selections":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.upload_count":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.uploaded_at":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.uploaded_images":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "preview_share.used_regenerate_count":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "print_order.coupon_code": "pnpm migrate:apply-coupon",
  "print_order.coupon_discount_cents": "pnpm migrate:apply-coupon",
  "print_order.delivery_fee_cents":
    "pnpm migrate:apply-print-order-delivery-tier",
  "print_order.delivery_tier": "pnpm migrate:apply-print-order-delivery-tier",
  "print_order.idempotency_key": "pnpm migrate:apply-print-order-idempotency",
  "print_order.locale": "pnpm migrate:apply-print-order-event",
  "print_order.paid_at": "pnpm migrate:apply-sellbase-payment",
  "print_order.payment_channel": "pnpm migrate:apply-sellbase-payment",
  "print_order.payment_qr_code_url": "pnpm migrate:apply-payment-channel",
  "print_order.payment_status": "pnpm migrate:apply-sellbase-payment",
  "print_order.payment_url": "pnpm migrate:apply-sellbase-payment",
  "print_order.provider_order_id": "pnpm migrate:apply-payment-channel",
  "print_order.quantity": "pnpm migrate:apply-print-shipping",
  "print_order.sellbase_order_id": "pnpm migrate:apply-sellbase-payment",
  "print_order.shipping_address": "pnpm migrate:apply-sellbase-payment",
  "print_order.shipping_fee_cents": "pnpm migrate:apply-print-shipping",
  "print_order.shipping_option": "pnpm migrate:apply-print-shipping",
  "print_order.storefront_order_id":
    "pnpm migrate:apply-print-order-storefront-link",
  "print_order.user_id": "pnpm migrate:apply-print-order",
  "print_pricing_config.allow_guest_pricing":
    "pnpm migrate:apply-print-pricing",
  "print_pricing_config.shipping_air_cents":
    "pnpm migrate:apply-print-shipping",
  "print_pricing_config.shipping_cod_cents":
    "pnpm migrate:apply-print-shipping",
  "print_pricing_config.shipping_standard_cents":
    "pnpm migrate:apply-print-shipping",
  "print_pricing_config.support_relief_lift_mm":
    "pnpm migrate:apply-print-pricing",
  "product_accessory_variant.applies_to_sizes_cm":
    "pnpm migrate:apply-catalog-dictionary",
  "product_effect.allowed_accessories":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "product_effect.allowed_capabilities":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "product_effect.allowed_colors":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "product_effect.allowed_sizes":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "product_effect.prompt_template_id":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "product_taobao_link.direct_order": "pnpm migrate:apply-taobao-link",
  "product_taobao_link.sku_map": "pnpm migrate:apply-taobao-link",
  "product_variant.sellbase_variant_id": "pnpm migrate:apply-sellbase-payment",
  "prompt_order.accessory_code": "pnpm tsx scripts/apply-agent-schema.ts",
  "prompt_order.agent_id": "pnpm tsx scripts/apply-agent-schema.ts",
  "prompt_order.credits_breakdown":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_order.credits_charged":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_order.is_preview_share":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_order.leather_color":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_order.leather_exposed":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_order.platform": "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_order.platform_order_no":
    "pnpm tsx scripts/apply-prompt-order-platform-order-no.ts",
  "prompt_order.product_size": "pnpm tsx scripts/apply-agent-schema.ts",
  "prompt_order.product_type_code": "pnpm tsx scripts/apply-agent-schema.ts",
  "prompt_order.pvc_protection":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_order.remarks": "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_template.allowed_accessories":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_template.allowed_sizes":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "prompt_template.output_mode":
    "pnpm tsx scripts/apply-prompt-template-output-mode.ts",
  "storefront_order.coupon_code": "pnpm migrate:apply-coupon",
  "storefront_order.coupon_discount_cents": "pnpm migrate:apply-coupon",
  "storefront_order.external_paid_cents": "pnpm migrate:apply-taobao-link",
  "storefront_order.note": "pnpm migrate:apply-sellbase-payment",
  "storefront_order.paid_at": "pnpm migrate:apply-sellbase-payment",
  "storefront_order.payment_channel": "pnpm migrate:apply-payment-channel",
  "storefront_order.payment_qr_code_url": "pnpm migrate:apply-payment-channel",
  "storefront_order.payment_status": "pnpm migrate:apply-sellbase-payment",
  "storefront_order.payment_url": "pnpm migrate:apply-sellbase-payment",
  "storefront_order.provider_order_id": "pnpm migrate:apply-payment-channel",
  "storefront_order.sellbase_order_id": "pnpm migrate:apply-sellbase-payment",
  "storefront_order.shipping_address": "pnpm migrate:apply-sellbase-payment",
  "storefront_order_item.discounted_unit_price_cents":
    "pnpm migrate:apply-sellbase-payment",
  "user.last_login_at": "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "user.medusa_customer_id": "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "user.phone_number": "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "user.phone_number_verified":
    "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "user.sellbase_customer_id": "pnpm migrate:apply-sellbase-payment",
  "user.wechat_openid": "pnpm tsx scripts/apply-all-missing-migrations.ts",
  "user.wechat_unionid": "pnpm tsx scripts/apply-all-missing-migrations.ts",
};

/**
 * **跑迁移的顺序**
 *
 * 顺序**有讲究**:有些脚本是 `ALTER TABLE`,被改的那张表得先由另一条脚本
 * 建出来(比如 `apply-print-shipping` 改 `print_pricing_config`,那张表是
 * `apply-print-pricing` 建的)。
 *
 * ⇒ 先建表的,后改列的。
 *
 * 有一处**互相打架**要注意:`apply-all-missing-migrations` 会把
 * `user.medusa_customer_id` 加回来(那是很早以前的名字),而
 * `apply-sellbase-payment` 负责把它**改名**成 `user.sellbase_customer_id`
 * 并删掉旧列 ⇒ **`apply-all-missing` 必须排在 `apply-sellbase-payment`
 * 前面**,否则旧列会被重新加回来(多一列没人用,看着别扭)。
 */
export const MIGRATION_COMMAND_ORDER: string[] = [
  // —— 建表的 ——
  "pnpm migrate:apply-print-order",
  "pnpm migrate:apply-product-catalog",
  "pnpm migrate:apply-print-pricing",
  "pnpm migrate:apply-storefront-cart",
  "pnpm migrate:apply-user-address",
  "pnpm migrate:apply-catalog-dictionary",
  "pnpm migrate:apply-agent-workbench",
  "pnpm tsx scripts/apply-agent-schema.ts",
  "pnpm tsx scripts/apply-all-missing-migrations.ts",
  // —— 改列的 ——
  "pnpm migrate:apply-sellbase-payment",
  "pnpm migrate:apply-coupon",
  "pnpm migrate:apply-payment-channel",
  "pnpm migrate:apply-print-order-delivery-tier",
  "pnpm migrate:apply-print-order-event",
  "pnpm migrate:apply-print-order-storefront-link",
  "pnpm migrate:apply-print-order-idempotency",
  "pnpm migrate:apply-print-shipping",
  "pnpm migrate:apply-shipment",
  "pnpm migrate:apply-taobao-link",
  "pnpm migrate:apply-site-setting",
  "pnpm migrate:apply-payment-setting",
  "pnpm migrate:apply-showcase",
  "pnpm migrate:apply-refund",
  "pnpm tsx scripts/apply-photo-source-enum.ts",
  "pnpm tsx scripts/apply-prompt-order-platform-order-no.ts",
  "pnpm tsx scripts/apply-prompt-template-output-mode.ts",
];

/**
 * 某张表的某一列,对应哪条命令
 *
 * 列级的映射优先(更准);列级没有 ⇒ 看表级(整张表都没建的时候用得上);
 * 都没有 ⇒ `null`(模板自带的表,或者还没写迁移脚本的新列)。
 */
export function migrationCommandFor(
  table: string,
  column?: string
): string | null {
  if (column) {
    const hit = COLUMN_MIGRATION_COMMANDS[`${table}.${column}`];
    if (hit) return hit;
  }
  return TABLE_MIGRATION_COMMANDS[table] ?? null;
}

/**
 * 比一遍:代码要的 vs 库里有的
 *
 * @param expected 代码要的表和列
 * @param actual 库里实际有的(table → 列名集合);**表不存在 ⇒ 那一项整个没有**
 */
export function diffSchema(
  expected: ExpectedTable[],
  actual: Map<string, Set<string>>
): SchemaDrift[] {
  const drift: SchemaDrift[] = [];

  for (const { table, columns } of expected) {
    const present = actual.get(table);
    // 整张表都没有 —— 全部列都算缺
    if (!present) {
      drift.push({
        table,
        tableMissing: true,
        missingColumns: [...columns],
      });
      continue;
    }
    const missing = columns.filter((c) => !present.has(c));
    if (missing.length > 0) {
      drift.push({ table, tableMissing: false, missingColumns: missing });
    }
  }

  return drift;
}

/**
 * 漂移 ⇒ 该跑哪些命令
 *
 * 返回**去重 + 有序**的命令列表(按 `MIGRATION_COMMAND_ORDER`)。
 * 认不出来的(没有对应脚本)⇒ 不出现在列表里 —— 那种要人工看。
 */
export function driftToCommands(drift: SchemaDrift[]): string[] {
  const commands = new Set<string>();

  for (const d of drift) {
    for (const column of d.missingColumns) {
      const cmd = migrationCommandFor(d.table, column);
      if (cmd) commands.add(cmd);
    }
    // 整张表都没有 ⇒ 表级那条
    if (d.tableMissing) {
      const cmd = TABLE_MIGRATION_COMMANDS[d.table];
      if (cmd) commands.add(cmd);
    }
  }

  return [...commands].sort(
    (a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b)
  );
}

/** 命令在顺序表里的位置(不在表里 ⇒ 排最后) */
function orderIndex(command: string): number {
  const i = MIGRATION_COMMAND_ORDER.indexOf(command);
  return i === -1 ? MIGRATION_COMMAND_ORDER.length : i;
}
