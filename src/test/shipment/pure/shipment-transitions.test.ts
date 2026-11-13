import { describe, expect, it } from "vitest";

import {
  getShipmentCarrier,
  isShipmentCarrierCode,
  normalizeShippingCompanyLabel,
  normalizeTrackingNumber,
  OTHER_CARRIER_CODE,
  SHIPMENT_CARRIERS,
} from "@/features/shipment/lib/carriers";
import {
  allowedNextShipmentStatuses,
  canShipmentTransition,
  classifyShipmentTransition,
  SHIPMENT_FLOW,
  SHIPMENT_STATUSES,
  shipmentStatusLabelKey,
  shipmentTransitionRequiresNote,
} from "@/features/shipment/lib/transitions";
import type { ShipmentStatus } from "@/features/shipment/lib/types";

/**
 * 物流状态机 + 快递公司清单(2026-11-13)
 *
 * ## 为什么这两块值得单测
 *
 * 状态机有**三处**在用(后台下拉 / 服务端校验 / 买家侧文案),三处各写一份
 * if-else 迟早漂移 —— 后台放开了不该放开的按钮,或者服务端漏判某个非法跳转。
 * 所以规则只定义一次,这里逐条钉住。
 *
 * 运单号归一化是**钱和信任的边界** —— 单号录错,买家查物流查不到;
 * 全角单号不归一化,同一个单在库里裂成两条。
 */

describe("物流状态机:迁移表", () => {
  it("允许的迁移逐条对得上", () => {
    // 表里就这四条 —— 少一条是功能缺失,多一条是越权
    expect(classifyShipmentTransition("shipped", "delivered")).toBe("forward");
    expect(classifyShipmentTransition("shipped", "returned")).toBe("cancel");
    expect(classifyShipmentTransition("delivered", "returned")).toBe("cancel");
    expect(classifyShipmentTransition("returned", "shipped")).toBe("backward");
  });

  it("表里没有的迁移 = 非法(返 null)", () => {
    expect(classifyShipmentTransition("delivered", "shipped")).toBeNull();
    expect(classifyShipmentTransition("returned", "delivered")).toBeNull();
    expect(classifyShipmentTransition("shipped", "shipped")).toBeNull();
    expect(classifyShipmentTransition("delivered", "delivered")).toBeNull();
    expect(classifyShipmentTransition("returned", "returned")).toBeNull();
  });

  it("同状态 = 不动(不刷时间线,也不报错)", () => {
    // 重复点「保存」不该报 INVALID_TRANSITION
    expect(canShipmentTransition("shipped", "shipped")).toBe(false);
    expect(classifyShipmentTransition("shipped", "shipped")).toBeNull();
  });

  it("`canShipmentTransition` 跟 `classifyShipmentTransition` 一致", () => {
    const pairs: Array<[ShipmentStatus, ShipmentStatus]> = [
      ["shipped", "shipped"],
      ["shipped", "delivered"],
      ["shipped", "returned"],
      ["delivered", "delivered"],
      ["delivered", "shipped"],
      ["delivered", "returned"],
      ["returned", "returned"],
      ["returned", "shipped"],
      ["returned", "delivered"],
    ];
    for (const [from, to] of pairs) {
      expect(canShipmentTransition(from, to)).toBe(
        classifyShipmentTransition(from, to) !== null
      );
    }
  });
});

describe("物流状态机:备注要求", () => {
  it("回退和异常**必须写备注**", () => {
    expect(shipmentTransitionRequiresNote("shipped", "returned")).toBe(true);
    expect(shipmentTransitionRequiresNote("delivered", "returned")).toBe(true);
    expect(shipmentTransitionRequiresNote("returned", "shipped")).toBe(true);
  });

  it("往前推(发货 → 签收)不要求备注", () => {
    expect(shipmentTransitionRequiresNote("shipped", "delivered")).toBe(false);
  });

  it("同状态不要求备注(而且它根本不是一次转换)", () => {
    expect(shipmentTransitionRequiresNote("shipped", "shipped")).toBe(false);
  });
});

describe("物流状态机:没有终态", () => {
  it("每个状态都还有出边 —— 物流**没有死路**", () => {
    // 跟 print_order.status 不同:那边 COMPLETED / CANCELLED 是死路。
    // 物流这边签收了还能标异常,异常了还能撤销 —— 状态改动的留痕比一键回退重要。
    for (const status of SHIPMENT_STATUSES) {
      expect(allowedNextShipmentStatuses(status).length).toBeGreaterThan(0);
    }
  });

  it("每个状态的出边都是合法迁移", () => {
    for (const status of SHIPMENT_STATUSES) {
      for (const next of allowedNextShipmentStatuses(status)) {
        expect(canShipmentTransition(status, next)).toBe(true);
      }
    }
  });

  it("出边里**不含自己**", () => {
    for (const status of SHIPMENT_STATUSES) {
      expect(allowedNextShipmentStatuses(status)).not.toContain(status);
    }
  });

  it("出边的顺序跟着 SHIPMENT_STATUSES 走(发货 → 签收 → 异常)", () => {
    expect(allowedNextShipmentStatuses("shipped")).toEqual([
      "delivered",
      "returned",
    ]);
    expect(allowedNextShipmentStatuses("delivered")).toEqual(["returned"]);
    expect(allowedNextShipmentStatuses("returned")).toEqual(["shipped"]);
  });
});

describe("物流状态机:状态清单", () => {
  it("主线是 发货 → 签收,`returned` 不在链上", () => {
    expect(SHIPMENT_FLOW).toEqual(["shipped", "delivered"]);
    expect(SHIPMENT_FLOW).not.toContain("returned");
  });

  it("全部状态 = 三个", () => {
    expect(SHIPMENT_STATUSES).toEqual(["shipped", "delivered", "returned"]);
  });

  it("状态文案键**相对 `Shipment` 命名空间**(买家侧和后台共用一份)", () => {
    // 消费方一律 `useTranslations("Shipment")` + `tShipment(key)` ——
    // 绝对路径会让命名空间化的 t 去找 `Shipment.Shipment.status.shipped`。
    expect(shipmentStatusLabelKey("shipped")).toBe("status.shipped");
    expect(shipmentStatusLabelKey("delivered")).toBe("status.delivered");
    expect(shipmentStatusLabelKey("returned")).toBe("status.returned");
  });
});

describe("快递公司清单", () => {
  it("清单里的 code 都认得出来", () => {
    for (const carrier of SHIPMENT_CARRIERS) {
      expect(isShipmentCarrierCode(carrier.code)).toBe(true);
      expect(getShipmentCarrier(carrier.code)?.code).toBe(carrier.code);
    }
  });

  it("清单外的 code 认不出来", () => {
    expect(isShipmentCarrierCode("sfx")).toBe(false);
    expect(isShipmentCarrierCode("")).toBe(false);
    expect(getShipmentCarrier("nope")).toBeNull();
  });

  it("**有「其它」兜底** —— 工作室用清单外的快递时不能被卡住", () => {
    expect(isShipmentCarrierCode(OTHER_CARRIER_CODE)).toBe(true);
  });

  it("code 唯一", () => {
    const codes = SHIPMENT_CARRIERS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("显示名走 i18n(键相对 `Shipment` 命名空间,不写死中文)", () => {
    for (const carrier of SHIPMENT_CARRIERS) {
      expect(carrier.nameKey.startsWith("carriers.")).toBe(true);
      // 绝对路径(`Shipment.carriers.sf`)会让命名空间化的 t 查不到 ——
      // 跟 `MaterialPricing` 的 `products.pet.name` 一个套路。
      expect(carrier.nameKey.startsWith("Shipment.")).toBe(false);
    }
  });
});

describe("运单号归一化", () => {
  it("全角 → 半角", () => {
    // 手机输入法打出来的单号常是全角
    expect(normalizeTrackingNumber("ＳＦ１２３")).toBe("SF123");
  });

  it("去所有空白(快递员报号时中间常有空格)", () => {
    expect(normalizeTrackingNumber("SF 1234 5678")).toBe("SF12345678");
    expect(normalizeTrackingNumber("SF\t1234")).toBe("SF1234");
    expect(normalizeTrackingNumber("SF\n1234")).toBe("SF1234");
  });

  it("转大写", () => {
    expect(normalizeTrackingNumber("sf123456")).toBe("SF123456");
  });

  it("三步一起走", () => {
    expect(normalizeTrackingNumber("  Ｓｆ １２３４  ")).toBe("SF1234");
  });

  it("空串归一成空串(不是 null)", () => {
    expect(normalizeTrackingNumber("")).toBe("");
    expect(normalizeTrackingNumber("   ")).toBe("");
  });

  it("不改动别的字符", () => {
    expect(normalizeTrackingNumber("JD-0001-ABC")).toBe("JD-0001-ABC");
  });
});

describe("「其它」快递的公司名", () => {
  it("去掉首尾空白、中间连续空白压成一个", () => {
    expect(normalizeShippingCompanyLabel("  极   兔  ")).toBe("极 兔");
  });

  it("空了返 null(调用方据此报 INVALID_INPUT)", () => {
    expect(normalizeShippingCompanyLabel("")).toBeNull();
    expect(normalizeShippingCompanyLabel("   ")).toBeNull();
  });
});
