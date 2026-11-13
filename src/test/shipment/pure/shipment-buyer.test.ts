import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 买家侧:两处都看得见物流(2026-11-13)
 *
 * ## 这一层守住什么
 *
 * 工作室在后台填了运单号,**买家总得有个地方看得到** —— 否则「寄出去了」
 * 这件事工作室知道、买家不知道。
 *
 * 两处:
 *
 * 1. **打印工单详情页**(`/account/print-orders/[orderNo]`)—— 加两个分区
 * 2. **商城订单详情页**(`/account/orders/[orderNo]`)—— **新建**(以前只有列表)
 *
 * 顺带把**收货地址快照**也渲染出来 —— 数据今天就在库里,只是买家侧一次都
 * 没显示过。
 *
 * ## 最要紧的一条:轮询的指纹里必须有物流
 *
 * 工作室填单号是**外部写入** —— 买家这边订单状态一个字都没变。轮询回来的
 * 数据跟上一轮**完全一样** ⇒ 不 setState ⇒ 页面停在「还没发货」。漏了物流
 * 这一段,功能看着「做完了」,实际上要用户手动刷新才看得见。
 *
 * 纯文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释区别) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const PRINT_VIEW =
  "src/features/print-quote/components/print-order-detail-view.tsx";
const PRINT_PAGE =
  "src/app/[locale]/(marketing-atelier)/account/print-orders/[orderNo]/page.tsx";
const PRINT_API = "src/app/api/print-orders/[orderNo]/route.ts";
const PRINT_QUOTE_TYPES = "src/features/print-quote/lib/quote-types.ts";
const PRINT_ORDER_STORE = "src/features/print-quote/lib/order-store.ts";
const PRINT_POLLING =
  "src/features/print-quote/hooks/use-print-order-polling.ts";

const MALL_VIEW =
  "src/features/storefront/components/store-order-detail-view.tsx";
const MALL_PAGE =
  "src/app/[locale]/(marketing-atelier)/account/orders/[orderNo]/page.tsx";
const MALL_LIST = "src/features/storefront/components/store-order-list.tsx";
const MALL_API = "src/app/api/store/orders/[orderNo]/route.ts";
const MALL_TYPES = "src/features/storefront/lib/order-detail-types.ts";
const MALL_POLLING = "src/features/storefront/hooks/use-store-order-polling.ts";

const PANEL = "src/features/shipment/components/shipment-panel.tsx";
const FINGERPRINT = "src/features/shipment/lib/fingerprint.ts";

describe("买家侧:打印工单详情页有两个分区", () => {
  it("收货地址 + 物流都渲染了", () => {
    const src = read(PRINT_VIEW);
    expect(src).toContain("<ShippingAddressPanel");
    expect(src).toContain("<ShipmentPanel");
  });

  it("物流组件吃的是轮询回来的那份(不是 props 里的旧快照)", () => {
    const src = read(PRINT_VIEW);
    // 从 usePrintOrderDetailPolling 的返回值里取
    expect(src).toContain("usePrintOrderDetailPolling");
    expect(src).toMatch(/<ShipmentPanel\s+shipments=\{shipments\}/);
    expect(src).toMatch(
      /<ShippingAddressPanel\s+address=\{order\.shippingAddress\}/
    );
  });

  it("页面查了物流传下去", () => {
    const src = read(PRINT_PAGE);
    expect(src).toContain('listShipmentsForOrder("print"');
    expect(src).toContain("shipments={shipments.map(toShipmentView)}");
  });

  it("工单的地址快照在视图模型里(以前从没渲染过)", () => {
    expect(read(PRINT_QUOTE_TYPES)).toContain(
      "shippingAddress: ShippingAddressSnapshot | null;"
    );
    expect(read(PRINT_ORDER_STORE)).toContain(
      "shippingAddress: row.shippingAddress"
    );
  });

  it("工单接口的响应里有 shipments(只涨不破)", () => {
    const src = read(PRINT_API);
    expect(src).toContain("shipments: shipments.map(toShipmentView)");
  });
});

describe("买家侧:商城订单详情页(新建)", () => {
  it("路由存在", () => {
    const src = read(MALL_PAGE);
    expect(src).toContain("StoreOrderDetailView");
  });

  it("动态渲染(物流和金额都是读库算的)", () => {
    expect(read(MALL_PAGE)).toContain('export const dynamic = "force-dynamic"');
  });

  it("归属校验在数据层 —— 404,不是 403", () => {
    const src = stripComments(read(MALL_PAGE));
    expect(src).toContain("notFound()");
    // 403 等于告诉别人「这个订单号存在」,而订单号是可以被枚举的
    // (注释里**提到** 403 是在解释为什么不用它 —— 去掉注释再查)
    expect(src).not.toMatch(/\b403\b/);
    // 查询函数本身带了 user_id
    expect(src).toContain("getUserStorefrontOrderByOrderNo(");
    expect(src).toContain("session.user.id");
  });

  it("未登录跳登录页,callbackUrl 指回这一页", () => {
    const src = read(MALL_PAGE);
    expect(src).toContain("redirect(");
    expect(src).toContain("/sign-in?callbackUrl=");
  });

  it("物流查的是 storefront 这一支", () => {
    const src = read(MALL_PAGE);
    expect(src).toContain('listShipmentsForOrder("storefront"');
    expect(src).toContain("shipments={shipmentRows.map(toShipmentView)}");
  });

  it("列表能点进详情", () => {
    const src = read(MALL_LIST);
    expect(src).toContain(`/account/orders/\${order.orderNo}`);
  });

  it("详情页有收货地址 + 物流两个分区", () => {
    const src = read(MALL_VIEW);
    expect(src).toContain("<ShippingAddressPanel");
    expect(src).toContain("<ShipmentPanel");
  });

  it("地址快照这次真的渲染了", () => {
    expect(read(MALL_TYPES)).toContain("shippingAddress");
    const page = read(MALL_PAGE);
    expect(page).toContain("shippingAddress: order.shippingAddress");
    const view = read(MALL_VIEW);
    expect(view).toMatch(
      /<ShippingAddressPanel\s+address=\{initialOrder\.shippingAddress\}/
    );
  });

  it("金额明细照恒等式呈现,客户端一个加法都不做", () => {
    const src = stripComments(read(MALL_VIEW));
    expect(src).toContain("formatCents(initialOrder.totalCents)");
    expect(src).not.toMatch(/totalCents\s*-/);
    expect(src).not.toMatch(/subtotalCents\s*-/);
  });

  it("接口的响应里有 shipments(只涨不破)", () => {
    const src = read(MALL_API);
    expect(src).toContain("shipments: shipments.map(toShipmentView)");
  });
});

describe("买家侧:两处共用同一份面板", () => {
  it("两个视图 import 的是同一个组件文件", () => {
    const print = read(PRINT_VIEW);
    const mall = read(MALL_VIEW);
    for (const src of [print, mall]) {
      expect(src).toContain(
        'from "@/features/shipment/components/shipment-panel"'
      );
    }
  });

  it("面板自己带 AtelierPanel 外壳(调用方只管摆)", () => {
    const src = read(PANEL);
    expect(src).toContain("export function ShipmentPanel");
    expect(src).toContain("export function ShippingAddressPanel");
    expect(src).toContain("<AtelierPanel>");
  });

  it("地址用 formatAddressLine 拼(别新写一份)", () => {
    const src = read(PANEL);
    expect(src).toContain(
      'import { formatAddressLine } from "@/features/address/types"'
    );
    expect(src).toContain("formatAddressLine(address)");
  });

  it("没有包裹时摆「还没发货」,不是空白", () => {
    const src = read(PANEL);
    expect(src).toContain('t("empty")');
  });
});

describe("买家侧:轮询的指纹里必须有物流(两处都有)", () => {
  it("物流指纹只有一份实现", () => {
    const src = read(FINGERPRINT);
    expect(src).toContain("export function shipmentFingerprint");
    // 状态 + 单号 + 更新时间都要进指纹
    expect(src).toContain("packageIndex");
    expect(src).toContain("status");
    expect(src).toContain("trackingNumber");
    expect(src).toContain("updatedAt");
  });

  it("打印工单的两个指纹都带物流", () => {
    const src = read(PRINT_POLLING);
    // 轮询回来的那一次
    expect(src).toContain("shipmentFingerprint(nextShipments)");
    // RSC 重新渲染带来的初始数据那一次
    expect(src).toContain("shipmentFingerprint(initial.shipments)");
    // 两处都从同一个模块 import
    expect(src).toContain(
      'import { shipmentFingerprint } from "@/features/shipment/lib/fingerprint"'
    );
  });

  it("商城订单的指纹带物流", () => {
    const src = read(MALL_POLLING);
    expect(src).toContain(
      'import { shipmentFingerprint } from "@/features/shipment/lib/fingerprint"'
    );
    expect(src).toContain("shipmentFingerprint(shipments)");
  });

  it("两个 hook 都在 401 的时候停轮询", () => {
    for (const rel of [PRINT_POLLING, MALL_POLLING]) {
      const src = read(rel);
      expect(src).toContain("res.status === 401");
      expect(src).toContain("stoppedRef.current = true");
    }
  });

  it("轮询间隔是 30s 一轮(物流变化频率极低)", () => {
    expect(read(MALL_POLLING)).toContain("DETAIL_INTERVAL_MS = 30_000");
    expect(read(PRINT_POLLING)).toContain("DETAIL_INTERVAL_MS = 30_000");
  });
});
