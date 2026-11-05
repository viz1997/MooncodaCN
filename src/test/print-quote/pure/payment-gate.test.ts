import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「没付款不许进生产」的状态门槛测试。
 *
 * ## 这道门槛是什么
 *
 * 打印工单是「来料加工」:用户付了钱,工作室才开始切料/打印。没收款就开工,
 * 后面追款的难度会陡增 —— 材料已经花了,单子还躺在「待确认」里。
 *
 * 所以门槛卡在**状态流转**这一层(`transitionPrintOrderStatus()`),而不是
 * 靠后台界面把「生产中」这个选项藏起来:藏选项是 UI 便利,服务端这层
 * 才是授权边界 —— 有人直接调 API 一样能绕过界面。
 *
 * ## 为什么值得测
 *
 * 这个门槛是**唯一**保证「先收钱后开工」的地方。写松了就是白干,写紧了
 * 就是收了钱不让开工(工作室会以为系统坏了)。而且它有明确的边界:
 *
 * - 卡的是**目标状态** `IN_PRODUCTION` —— 落进生产中就得先收到钱;退回去
 *   对齐(`PENDING` / `CONFIRMED`)或者推到发货都不拦,那些时候还没开工
 * - 拦的是**未收款**,不是「不是线上付的」—— 线下转账由工作室手动标记
 *   收款(`payment_channel = "offline"`),那条路是通的
 *
 * ## 依赖
 *
 * `transitionPrintOrderStatus()` 要查 DB、要在事务里改状态。这里把 `@/db`
 * mock 掉,只喂「这一单当前是什么状态」—— 门槛的判断逻辑是纯的,测它不该
 * 需要真的数据库。跑在 unit project 里(`pnpm test:run --project=unit`)。
 */

import {
  PrintOrderTransitionError,
  transitionPrintOrderStatus,
} from "@/features/print-quote/lib/order-store";

/**
 * mock 掉 `@/db`
 *
 * 只实现这条链上用到的三件事:查一行(锁行)、改一行、插一条时间线事件。
 */
const { orderState } = vi.hoisted(() => ({
  orderState: {
    /** 当前这单 —— 测例里改它来表示「工单现在什么状态」 */
    current: null as null | {
      id: string;
      status: string;
      paymentStatus: string;
    },
    /** update().set(...) 的入参 */
    updated: null as null | Record<string, unknown>,
    /** insert().values(...) 的入参 */
    event: null as null | Record<string, unknown>,
  },
}));

vi.mock("@/db", () => {
  const selectBuilder = {
    from: () => selectBuilder,
    where: () => selectBuilder,
    limit: () => selectBuilder,
    // `.for("update")` 是链的最后一环 —— 返回一个 Promise
    for: () => Promise.resolve(orderState.current ? [orderState.current] : []),
  };

  const updateBuilder = {
    set: (values: Record<string, unknown>) => {
      orderState.updated = values;
      return updateBuilder;
    },
    where: () => updateBuilder,
    returning: () =>
      Promise.resolve(
        orderState.current
          ? [{ ...orderState.current, ...(orderState.updated ?? {}) }]
          : []
      ),
  };

  const insertBuilder = {
    values: (values: Record<string, unknown>) => {
      orderState.event = values;
      return insertBuilder;
    },
    returning: () =>
      Promise.resolve([{ id: "evt_test", ...(orderState.event ?? {}) }]),
  };

  const tx = {
    select: () => selectBuilder,
    update: () => updateBuilder,
    insert: () => insertBuilder,
  };

  return {
    db: {
      transaction: async (fn: (t: unknown) => unknown) => fn(tx),
      select: () => selectBuilder,
    },
  };
});

beforeEach(() => {
  orderState.current = {
    id: "po_test",
    status: "PENDING",
    paymentStatus: "unpaid",
  };
  orderState.updated = null;
  orderState.event = null;
});

/** 推进到「生产中」 */
function goToProduction() {
  return transitionPrintOrderStatus({
    orderNo: "PO-TEST-0001",
    to: "IN_PRODUCTION",
    actor: "admin",
    note: null,
    userId: null,
  });
}

describe("付款门槛 —— 推进到生产中", () => {
  it("没收款 → 拒绝,code = PAYMENT_REQUIRED", async () => {
    await expect(goToProduction()).rejects.toThrow(PrintOrderTransitionError);

    await expect(goToProduction()).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    });
  });

  it("拒绝的文案要说清楚是「没收款」", async () => {
    await expect(goToProduction()).rejects.toThrow(/还没收款/);
    await expect(goToProduction()).rejects.toThrow(/不能开始生产/);
  });

  it("被拒的时候**没有**改状态、也没有写时间线", async () => {
    await expect(goToProduction()).rejects.toThrow();
    expect(orderState.updated).toBeNull();
    expect(orderState.event).toBeNull();
  });

  it("已收款 → 放行,状态真的改了", async () => {
    orderState.current = {
      id: "po_test",
      status: "CONFIRMED",
      paymentStatus: "paid",
    };

    const result = await goToProduction();

    expect(result.order.status).toBe("IN_PRODUCTION");
    expect(orderState.updated).toMatchObject({ status: "IN_PRODUCTION" });
  });

  it("已收款的单放行时也要留时间线", async () => {
    orderState.current = {
      id: "po_test",
      status: "CONFIRMED",
      paymentStatus: "paid",
    };

    await goToProduction();

    expect(orderState.event).toMatchObject({
      orderId: "po_test",
      fromStatus: "CONFIRMED",
      toStatus: "IN_PRODUCTION",
      actor: "admin",
    });
  });
});

describe("付款门槛只卡「生产中」", () => {
  it("推进到「已确认」不拦 —— 还在跟客户对齐,没到花钱的时候", async () => {
    await expect(
      transitionPrintOrderStatus({
        orderNo: "PO-TEST-0001",
        to: "CONFIRMED",
        actor: "admin",
        note: null,
        userId: null,
      })
    ).resolves.toBeTruthy();
  });

  it("推进到「已发货」也不拦", async () => {
    orderState.current = {
      id: "po_test",
      status: "CONFIRMED",
      paymentStatus: "unpaid",
    };

    await expect(
      transitionPrintOrderStatus({
        orderNo: "PO-TEST-0001",
        to: "SHIPPED",
        actor: "admin",
        note: null,
        userId: null,
      })
    ).resolves.toBeTruthy();
  });

  it("往回退到别的档不拦 —— 退回去对齐,没到开工那一步", async () => {
    orderState.current = {
      id: "po_test",
      status: "SHIPPED",
      paymentStatus: "unpaid",
    };

    await expect(
      transitionPrintOrderStatus({
        orderNo: "PO-TEST-0001",
        to: "PENDING",
        actor: "admin",
        note: "客户要求重做",
        userId: null,
      })
    ).resolves.toBeTruthy();
  });

  it("退回「生产中」也拦 —— 未收款的返工同样不能开工", async () => {
    // 门槛卡的是**目标状态**:只要落进 IN_PRODUCTION 就得先收到钱。
    // 往回退到生产中意味着要重新切料重打,那也是开工。
    orderState.current = {
      id: "po_test",
      status: "SHIPPED",
      paymentStatus: "unpaid",
    };

    await expect(
      transitionPrintOrderStatus({
        orderNo: "PO-TEST-0001",
        to: "IN_PRODUCTION",
        actor: "admin",
        note: "客户要求重做",
        userId: null,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });
});

describe("付款门槛跟别的门槛的先后顺序", () => {
  it("线下收款也算「已付」—— 工作室手动标记的那条路是通的", async () => {
    orderState.current = {
      id: "po_test",
      status: "CONFIRMED",
      paymentStatus: "paid",
    };

    await expect(goToProduction()).resolves.toBeTruthy();
  });

  it("退款的单不算已付 → 照样拦", async () => {
    orderState.current = {
      id: "po_test",
      status: "CONFIRMED",
      paymentStatus: "refunded",
    };

    await expect(goToProduction()).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    });
  });

  it("failed 的单不算已付 → 照样拦", async () => {
    orderState.current = {
      id: "po_test",
      status: "CONFIRMED",
      paymentStatus: "failed",
    };

    await expect(goToProduction()).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    });
  });

  it("非法流转先于付款门槛报错 —— 终态不能回到生产中", async () => {
    orderState.current = {
      id: "po_test",
      status: "COMPLETED",
      paymentStatus: "unpaid",
    };

    await expect(goToProduction()).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("用户不能自己推进到生产中 —— 那是 INVALID_TRANSITION,不是 PAYMENT_REQUIRED", async () => {
    // 两个理由都成立时,先撞上状态机那条 —— 报错要指向更根本的那个问题
    await expect(
      transitionPrintOrderStatus({
        orderNo: "PO-TEST-0001",
        to: "IN_PRODUCTION",
        actor: "user",
        note: null,
        userId: "user_1",
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("用户自己取消不受付款门槛影响 —— 取消不需要先付款", async () => {
    await expect(
      transitionPrintOrderStatus({
        orderNo: "PO-TEST-0001",
        to: "CANCELLED",
        actor: "user",
        note: null,
        userId: "user_1",
      })
    ).resolves.toBeTruthy();
  });
});
