import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 打印服务**直接建工单**(2026-11-08)
 *
 * 工作室的原话:**「不要放入购物车,放在这里 account/print-orders」**
 *
 * ## 现在的流程
 *
 * ```
 * /tools/workbench(量克重,公开工具页)
 *   → 点「填写下单信息」→ 表单展开在下面
 *   → 提交 → 服务端重算报价 + 建一张 print_order
 *   → 跳 /account/print-orders/{orderNo} —— 钱在那儿付(微信扫码 / 支付宝跳转)
 * ```
 *
 * 商城购物袋**只装目录商品**(钥匙扣 / 冰箱贴 / 相框 …)。打印服务是**另一
 * 条线**:工单自己建、自己收款。
 *
 * 2026-11-08 之前那一版是「打印服务并进商城购物袋」—— 打印服务行是购物袋里
 * 的一行,钱由商城订单一次收。那一版整个退回去了。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 工具页把单子发给 `/api/print-orders` | 发错了 = 建出一张目录商品行,工作室收不到模型文件 |
 * | 商城购物袋接口**只收目录商品** | 打印服务混进去 = 又变成一张车 |
 * | 服务端按几何**重算**报价 | 客户端带来的价能被改 |
 * | 工单**不挂**商城订单 | 挂着 = 钱由商城订单收,工单自己再开一个入口就收两次钱 |
 * | 收货地址**必填**、归属校验在数据层 | 工作室照着单子寄不出去 / 别人的地址 |
 * | 模型文件归属 + 存在性校验 | 别人的模型、伪造的 URL、指向空对象的链接 |
 * | 工单详情页给**独立工单**回付款入口 | 用户没地方付钱 = 单子下完就死了 |
 *
 * 全部是文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前是购物袋」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const PRINT_ORDER_ROUTE = "src/app/api/print-orders/route.ts";
const CART_LINE_ITEMS_ROUTE =
  "src/app/api/store/carts/[id]/line-items/route.ts";
const WEIGHT_TOOL =
  "src/features/print-quote/components/print-service-weight-tool.tsx";
const SUBMIT_CARD =
  "src/features/print-quote/components/print-service-submit-card.tsx";
const DETAIL_VIEW =
  "src/features/print-quote/components/print-order-detail-view.tsx";
const ORDER_STORE = "src/features/print-quote/lib/order-store.ts";
const PAYMENT_ENTRY = "src/features/print-quote/lib/payment-entry.ts";

describe("打印服务直接建工单 —— 出口只有一个", () => {
  it("工具页把单子发给 `/api/print-orders`", () => {
    const code = stripComments(read(WEIGHT_TOOL));

    expect(code).toContain('fetch("/api/print-orders"');
    expect(code).toContain('method: "POST"');
  });

  it("工具页**不碰**商城购物袋 —— 车里只有目录商品", () => {
    const code = stripComments(read(WEIGHT_TOOL));

    // 不许出现购物袋那两个接口 —— 打印服务不进商城购物袋
    expect(code).not.toContain("/api/store/carts");
    expect(code).not.toContain("line-items");
  });

  it("建完单跳工单详情页 —— 钱在那儿付", () => {
    const code = stripComments(read(WEIGHT_TOOL));

    // 用正则而不是字符串 —— 断言的就是那段模板字面量本身
    expect(code).toMatch(
      /router\.push\(`\/account\/print-orders\/\$\{created\.orderNo\}`\)/
    );
  });

  it("商城购物袋接口**只收目录商品**", () => {
    const code = stripComments(read(CART_LINE_ITEMS_ROUTE));

    expect(code).toContain("catalogLineSchema");
    // 打印服务那套字段一个都不许在这儿
    expect(code).not.toContain("printSpec");
    expect(code).not.toContain("print-service");
    expect(code).not.toContain("PRINT_SERVICE");
    expect(code).not.toContain("modelObjectKey");
  });
});

describe("打印服务直接建工单 —— 服务端重算,客户端的价一律不信", () => {
  it("报价是服务端按几何算出来的", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    expect(code).toContain("const settings = await getPrintPricingSettings()");
    expect(code).toContain("computePrintQuote(settings, input.quote)");
  });

  it("请求体里**只有几何**,没有总价", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    // 只看**请求体的 schema** —— 路由里出现 `totalPriceCents` 是正常的
    // (落库 / 发通知那几行要用算出来的总额),但**请求体里不许有它**。
    const schema = code.match(/const orderSchema[\s\S]*?\n\}\);/)?.[0] ?? "";
    expect(schema).toContain("addressId");
    expect(schema).not.toContain("totalPriceCents");
    expect(schema).not.toContain("totalPrice");
  });
});

describe("打印服务直接建工单 —— 工单自己收款", () => {
  it("建单**不挂**商城订单 —— 它是独立工单", () => {
    const route = stripComments(read(PRINT_ORDER_ROUTE));
    const store = stripComments(read(ORDER_STORE));

    // 建工单的时候没传 `storefrontOrderId` → 落库是 null
    expect(route).not.toContain("storefrontOrderId");
    // 默认值是 null(不是某个商城订单)
    expect(store).toContain(
      "storefrontOrderId: input.storefrontOrderId ?? null"
    );
  });

  it("独立工单 → 付款入口**给**", () => {
    const code = stripComments(read(PAYMENT_ENTRY));

    // 规则:没挂商城订单 → 给入口
    expect(code).toContain("if (input.storefrontOrderId)");
    expect(code).toContain('code: "PAY_VIA_STOREFRONT"');
    expect(code).toContain("return { allowed: true };");
  });

  it("工单详情页给**独立工单**回付款按钮", () => {
    const code = stripComments(read(DETAIL_VIEW));

    // 独立工单(没挂商城订单)→ 给付款入口
    expect(code).toContain("<OrderPaymentButton");
    expect(code).toContain("order.paymentUrl");
    expect(code).toContain("order.paymentQrCodeUrl");
  });

  it("跟着商城订单结的账(旧单)→ 指到「我的订单」,不再开一个入口", () => {
    const code = stripComments(read(DETAIL_VIEW));

    expect(code).toContain("order.viaStorefrontOrder");
    expect(code).toContain('href="/account/orders"');
    expect(code).toContain('t("payment.payViaStorefront")');
  });
});

describe("打印服务直接建工单 —— 归属校验在服务端", () => {
  it("收货地址**必填**,而且只收 id", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    // 客户端只给 id
    expect(code).toContain("addressId: z.string().min(1).max(64)");
    // 地址内容由服务端从地址簿取 —— 归属校验在数据层
    expect(code).toContain(
      "const addressView = await getUserAddress(user.id, parsed.data.addressId)"
    );
  });

  it("模型文件:归属校验 + 存在性校验,两个都要", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    // 别人的模型、伪造的 URL
    expect(code).toContain(
      "isOwnModelUrl(input.modelUrl, input.objectKey, user.id)"
    );
    // 链接指向一个不存在的对象 = 一张没法开工的工单
    expect(code).toContain("objectExists(input.objectKey)");
  });

  it("联系邮箱**不采信客户端** —— 取账号邮箱", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    expect(code).toContain("contactEmail: user.email");
  });
});

describe("打印服务直接建工单 —— 那张卡是入口,不是报价条", () => {
  it("按钮是「填写下单信息」,不是「加入购物袋」", () => {
    const code = stripComments(read(SUBMIT_CARD));

    expect(code).toContain('t("order.start")');
    expect(code).toContain('t("order.continueEditing")');
    // 购物袋那套词不许再出现
    expect(code).not.toContain("cart");
  });

  it("没登录给的是「去登录」,不是「加入购物袋」", () => {
    const code = stripComments(read(SUBMIT_CARD));

    expect(code).toContain('t("entry.signInCta")');
    expect(code).toContain("href={signInUrl}");
  });
});
