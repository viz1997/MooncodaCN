/**
 * 打印 Shopify Admin GraphQL 的**输入类型字段** —— 诊断「我们发的字段对不对」
 *
 * ## 干什么
 *
 * 用店铺自己的凭据跑一次 GraphQL 内省(introspection),把
 * `DraftOrderInput` / `DraftOrderLineItemInput` / `ShippingLineInput` 这几个
 * 输入类型的**字段名和字段类型**打出来。
 *
 * ## 为什么需要它
 *
 * Shopify 的**同一个输入类型在不同 API 版本上字段不一样**,而且不查文档是
 * 猜不出来的:
 *
 * - `DraftOrderLineItemInput.price` —— 这个字段**不存在**(2026-11-05 线上
 *   踩过:`Field 'price' is not defined by type 'DraftOrderLineItemInput'`)
 * - `ShippingLineInput.price` —— 是 **`Money` 标量**(字符串 `"6.99"`),
 *   不是 `MoneyInput` 对象(传对象报 `invalid money`)
 * - `ShippingLineInput.handle` —— **不存在**(报
 *   `Field 'handle' is not defined by type 'ShippingLineInput'`)
 *
 * 而 `shopify.dev` 的文档页在很多网络环境下**打不开**(本机就被挡了),
 * `WebSearch` 出来的二手信息也可能对不上版本 —— 所以**直接问店铺本人**最
 * 靠谱。
 *
 * ## 跑法
 *
 * ```bash
 * pnpm tsx scripts/dump-shopify-input-schema.ts
 * ```
 *
 * 读 `.env.local` / `.env` 里的 `SHOPIFY_*`(跟线上同一份)。
 *
 * ## 密钥纪律
 *
 * **只打印 schema,不打印任何凭据** —— token / secret 一个字都不会出现在
 * 输出里(这个脚本自己也不去读它们往回打)。
 *
 * 往聊天里贴输出时也只贴 schema 那几行。
 */

import "./lib/load-env";

import { shopifyGraphql } from "@/features/payments/providers/shopify/client";

/** 要查的类型 */
const TYPE_NAMES = [
  "DraftOrderInput",
  "DraftOrderLineItemInput",
  "ShippingLineInput",
  "Money",
  "MoneyInput",
  "MoneyBag",
  "PriceSetInput",
  "PriceInput",
] as const;

/** 内省查询 —— 每个类型一份,别名分开 */
const INTROSPECTION = `
  query MooncodaIntrospect {
${TYPE_NAMES.map(
  (name, index) => `    t${index}: __type(name: "${name}") {
      kind
      name
      description
      inputFields {
        name
        description
        isDeprecated
        deprecationReason
        type { ...TypeRef }
      }
      fields {
        name
        description
        isDeprecated
        deprecationReason
        type { ...TypeRef }
      }
      enumValues { name description }
    }`
).join("\n")}
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType { kind name ofType { kind name } }
  }
`;

interface IntrospectedField {
  name: string;
  description: string | null;
  isDeprecated: boolean;
  deprecationReason: string | null;
  type: { kind: string; name: string | null; ofType: unknown } | null;
}

interface IntrospectedType {
  kind: string;
  name: string | null;
  description: string | null;
  inputFields: IntrospectedField[] | null;
  fields: IntrospectedField[] | null;
}

/** 把类型的引用拼成能看的样子 —— `Money!` / `[DraftOrderLineItemInput!]!` */
function formatTypeRef(type: IntrospectedField["type"]): string {
  if (!type) return "?";
  if (type.kind !== "NON_NULL" && type.kind !== "LIST") {
    return type.name ?? "?";
  }
  const inner = type.ofType as IntrospectedField["type"];
  const innerText = formatTypeRef(inner);
  if (type.kind === "NON_NULL") return `${innerText}!`;
  return `[${innerText}]`;
}

async function main(): Promise<void> {
  const data = await shopifyGraphql<Record<string, IntrospectedType | null>>(
    INTROSPECTION,
    {}
  );

  console.log("=".repeat(72));
  console.log("Shopify Admin GraphQL —— 输入类型字段");
  console.log("=".repeat(72));

  TYPE_NAMES.forEach((name, index) => {
    const type = data[`t${index}`];
    console.log("");
    console.log(`--- ${name} ---`);

    if (!type) {
      console.log("  (这个类型在当前 API 版本上不存在)");
      return;
    }

    console.log(`  kind: ${type.kind}`);

    const fields = type.inputFields ?? type.fields;
    if (!fields || fields.length === 0) {
      console.log("  (没有字段 —— 可能是标量)");
      return;
    }

    for (const field of fields) {
      const deprecated = field.isDeprecated
        ? `  ⚠️ 已弃用${field.deprecationReason ? `: ${field.deprecationReason}` : ""}`
        : "";
      console.log(`  ${field.name}: ${formatTypeRef(field.type)}${deprecated}`);
      if (field.description) {
        // 描述可能很长,压成一行(换行折成空格)
        console.log(`      ${field.description.replace(/\s+/g, " ").trim()}`);
      }
    }
  });

  console.log("");
  console.log("=".repeat(72));
  console.log(
    "提示:Shopify 每个 API 版本只保一年。改了 SHOPIFY_API_VERSION 之后"
  );
  console.log("      记得重跑这个脚本,看看字段有没有变。");
  console.log("=".repeat(72));
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("[dump-shopify-input-schema] 失败:", error);
    process.exit(1);
  });
