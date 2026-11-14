/**
 * 退款这条线的**流程** —— 结构扫描
 *
 * ## 守住什么
 *
 * | 断言 | 为什么 |
 * |---|---|
 * | **已付款的工单不许直接取消** | 「取消」只改 `status`,从不碰 `payment_status` ⇒ 买家自己取消一个已付款的工单 = 订单看着像退过款了,钱其实没退 |
 * | 「执行退款」调的是 **provider 的 `refund()`** | 工作室的原话:「所以才需要别人已经做好支付管理(付款、退款等),不要自己重新造轮子」⇒ **用平台退款 API**,不自己造一套「记账 + 手工对账」 |
 * | **幂等键 = 退款申请行的 id** | 微信 `out_refund_no` / 支付宝 `out_request_no` 都是它 ⇒ 平台那边同一个号只会退一次。**换个号重试 = 退两次钱** |
 * | 「标记已退款」走 `settleByOrderNo` 的 `mark_refunded` | `settleByOrderNo` 是**全仓唯一**能写 `payment_status` 的地方 |
 * | 退款**只改 `payment_status`,不动 `status`** | 「退款不是订单状态」这条铁律 |
 * | 工单退款后自动取消走 `transitionPrintOrderStatus` | 它是**唯一**合法的工单状态写入口(会写时间线) |
 * | 两个轮询接口都有 `refund` 字段 | 买家看得见退款状态 |
 * | **两个轮询 hook 的指纹都带退款** | 工作室在后台处理退款是**外部写入** ⇒ 指纹不带 ⇒ 买家页面停在「等工作室处理」直到手动刷新 |
 * | 买家两页都有申请退款的入口 | 商城订单 + 打印工单 |
 * | 迁移脚本幂等 + **不播种** | 跑完线上行为一个字节都不变 |
 * | 后台页**不开弹窗** | 工作室的口味 |
 * | `"use server"` 文件**不 re-export 类型** | Turbopack 会把它注册成一个不存在的 action ⇒ 运行时 `ReferenceError` ⇒ **整页 500** |
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

/** 去掉注释 —— 注释里写了什么不算数,代码里写了才算 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ========================================================================== */
/*  1. 已付款的工单不许直接取消(那个漏钱的洞)                                  */
/* ========================================================================== */

describe("退款流程:已付款的工单不许直接取消(洞被堵上)", () => {
  const src = stripComments(
    read("src/features/print-quote/lib/order-store.ts")
  );

  it("数据层有 `REFUND_REQUIRED` 这道闸", () => {
    expect(src).toContain("REFUND_REQUIRED");
  });

  it("闸在 `actor === \"user\"` 那一支里 —— 只挡买家自助取消", () => {
    const userBranch = src.indexOf('input.actor === "user"');
    expect(userBranch).toBeGreaterThan(-1);

    const guard = src.indexOf('current.paymentStatus === "paid"');
    expect(guard).toBeGreaterThan(-1);

    // 闸必须在 user 分支**之后**(分支出现在前面)
    expect(guard).toBeGreaterThan(userBranch);
  });

  it("闸抛的是 `PrintOrderTransitionError`(不是别的)", () => {
    const guard = src.indexOf('current.paymentStatus === "paid"');
    const window = src.slice(guard, guard + 400);
    expect(window).toContain("PrintOrderTransitionError");
    expect(window).toContain("REFUND_REQUIRED");
  });

  it("`REFUND_REQUIRED` 在错误码联合类型里", () => {
    expect(src).toMatch(
      /PrintOrderTransitionErrorCode\s*=[\s\S]*?"REFUND_REQUIRED"/
    );
  });

  it("买家侧的 action 把它透传出去(界面能说人话)", () => {
    const userActions = read("src/features/print-quote/user/actions.ts");
    expect(userActions).toContain("REFUND_REQUIRED");
  });
});

/* ========================================================================== */
/*  2. 「执行退款」调的是平台退款 API                                            */
/* ========================================================================== */

describe("退款流程:「执行退款」调 provider 的 refund()", () => {
  const src = stripComments(read("src/features/refund/admin/actions.ts"));

  it("调的是 `provider.refund({…})` —— 不是自己记账", () => {
    expect(src).toContain("provider.refund(");
  });

  it("provider 没实现 refund 时,给的是「走手工那条路」的提示", () => {
    expect(src).toContain('typeof provider.refund !== "function"');
    expect(src).toContain("REFUND_NOT_SUPPORTED");
  });

  it("**幂等键 = 退款申请行的 id** —— 不是新生成的号", () => {
    expect(src).toContain("outRefundNo: refundRow.id");
  });

  it("没有第二处 `outRefundNo` —— 不会有一处用新号重试", () => {
    const matches = src.match(/outRefundNo\s*:/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("请求体带齐了平台要的那几项", () => {
    const idx = src.indexOf("provider.refund(");
    const window = src.slice(idx, idx + 900);
    for (const field of [
      "orderNo",
      "outRefundNo",
      "totalCents",
      "refundCents",
      "reason",
      "currency",
    ]) {
      expect(window).toContain(field);
    }
  });

  it("金额用的是**申请行上的**快照 —— 不拿订单现价重算", () => {
    const idx = src.indexOf("provider.refund(");
    const window = src.slice(idx, idx + 900);
    expect(window).toContain("snapshot.totalCents");
  });

  it("调完不是自己 UPDATE —— 落库走 `landRefundOutcome`", () => {
    expect(src).toContain("landRefundOutcome(");
  });
});

/* ========================================================================== */
/*  3. 「标记已退款」走 settleByOrderNo 的 mark_refunded                       */
/* ========================================================================== */

describe("退款流程:落库走 settleByOrderNo 的 mark_refunded", () => {
  const land = stripComments(read("src/features/refund/lib/land-refund.ts"));

  it("用的是 `settleByOrderNo`", () => {
    expect(land).toContain("settleByOrderNo(");
  });

  it("动作是 `mark_refunded`", () => {
    expect(land).toContain('action: "mark_refunded"');
  });

  /**
   * 抠出 `case "xxx":` 那一段 —— **到下一个 `case` 为止**
   *
   * 不能用固定长度窗口:窗口会串到隔壁那个 `case "mark_cancelled"` 去,
   * 那一条**本来就要**写 `setStatus`(取消订单跟退款是两回事)。
   */
  function caseBlock(src: string, label: string): string {
    const idx = src.indexOf(`case "${label}"`);
    expect(idx).toBeGreaterThan(-1);
    const rest = src.slice(idx);
    const next = rest.indexOf("\n    case ");
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("**退款只改 `payment_status`,不动 `status`**", () => {
    const transitions = stripComments(
      read("src/features/payments/lib/transitions.ts")
    );
    const block = caseBlock(transitions, "mark_refunded");
    expect(block).toContain('setPaymentStatus: "refunded"');
    // 不许出现 setStatus —— 退款不是订单状态
    expect(block).not.toContain("setStatus");
  });

  it("挂在商城订单下面的工单也跟着变 refunded(同一个口径)", () => {
    const transitions = stripComments(
      read("src/features/payments/lib/transitions.ts")
    );
    const idx = transitions.lastIndexOf('case "mark_refunded"');
    expect(idx).toBeGreaterThan(-1);
    const rest = transitions.slice(idx);
    const next = rest.indexOf("\n    case ");
    const block = next === -1 ? rest : rest.slice(0, next);
    expect(block).toContain('setPaymentStatus: "refunded"');
    expect(block).not.toContain("setStatus");
  });

  it("工单退款后自动取消走的是 `transitionPrintOrderStatus`", () => {
    expect(land).toContain("transitionPrintOrderStatus(");
  });

  it("自动取消只针对还停在 PENDING / CONFIRMED 的工单", () => {
    expect(land).toContain("PRINT_ORDER_REFUNDABLE_STATUSES");
  });

  it("自动取消不碰角度外的字段 —— 只改工单状态", () => {
    const idx = land.indexOf("transitionPrintOrderStatus(");
    const window = land.slice(idx, idx + 600);
    expect(window).toContain('to: "CANCELLED"');
  });

  it("`land-refund.ts` **不是** `\"use server\"` —— webhook 腿要 import 它", () => {
    // 注释里写着「为什么这个文件**不是** `"use server"`」⇒ 去掉注释再看
    const raw = stripComments(read("src/features/refund/lib/land-refund.ts"));
    expect(raw).not.toContain('"use server"');
  });
});

/* ========================================================================== */
/*  4. 两个轮询接口 + 两个轮询 hook                                             */
/* ========================================================================== */

describe("退款流程:买家侧看得见退款状态", () => {
  it("`GET /api/store/orders/[orderNo]` 有 `refund` 字段", () => {
    const src = read("src/app/api/store/orders/[orderNo]/route.ts");
    expect(src).toContain("getLatestRefundRequestForOrder");
    expect(src).toMatch(/refund:\s*refundRow\s*\?\s*toRefundView\(refundRow\)\s*:\s*null/);
  });

  it("`GET /api/print-orders/[orderNo]` 有 `refund` 字段", () => {
    const src = read("src/app/api/print-orders/[orderNo]/route.ts");
    expect(src).toContain("getLatestRefundRequestForOrder");
    expect(src).toMatch(/refund:\s*refundRow\s*\?\s*toRefundView\(refundRow\)\s*:\s*null/);
  });

  it("指纹只有一个实现(`refundFingerprint`)", () => {
    const fp = stripComments(read("src/features/refund/lib/fingerprint.ts"));
    expect(fp).toContain("export function refundFingerprint");
    expect(fp).toContain("refund.status");
    expect(fp).toContain("refund.providerRefundStatus");
  });

  it("**商城订单的轮询 hook** 指纹里带退款", () => {
    const src = read("src/features/storefront/hooks/use-store-order-polling.ts");
    expect(src).toContain("refundFingerprint");
    expect(src).toMatch(/refundFingerprint\(/);
  });

  it("**打印工单的轮询 hook** 指纹里带退款(**两处**都要)", () => {
    const src = read(
      "src/features/print-quote/hooks/use-print-order-polling.ts"
    );
    expect(src).toContain("refundFingerprint");
    // 详情轮询 + RSC 初始同步 —— 这两处本来就漂过,都要带
    const matches = src.match(/refundFingerprint\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("两个 hook 都 import 的是**同一份**指纹实现", () => {
    const store = read(
      "src/features/storefront/hooks/use-store-order-polling.ts"
    );
    const print = read(
      "src/features/print-quote/hooks/use-print-order-polling.ts"
    );
    const path = "@/features/refund/lib/fingerprint";
    expect(store).toContain(path);
    expect(print).toContain(path);
  });
});

/* ========================================================================== */
/*  5. 买家两页都有申请退款的入口                                              */
/* ========================================================================== */

describe("退款流程:买家两页都有申请退款的入口", () => {
  it("商城订单详情页有「申请退款」+ 退款状态面板", () => {
    const src = read(
      "src/features/storefront/components/store-order-detail-view.tsx"
    );
    expect(src).toContain("RefundRequestButton");
    expect(src).toContain("RefundStatusPanel");
  });

  it("打印工单详情页有「申请退款」+ 退款状态面板", () => {
    const src = read(
      "src/features/print-quote/components/print-order-detail-view.tsx"
    );
    expect(src).toContain("RefundRequestButton");
    expect(src).toContain("RefundStatusPanel");
  });

  it("两个页面都 import 的是**同一份**组件", () => {
    const store = read(
      "src/features/storefront/components/store-order-detail-view.tsx"
    );
    const print = read(
      "src/features/print-quote/components/print-order-detail-view.tsx"
    );
    expect(store).toContain("@/features/refund/components/refund-request-button");
    expect(print).toContain("@/features/refund/components/refund-request-button");
    expect(store).toContain("@/features/refund/components/refund-status-panel");
    expect(print).toContain("@/features/refund/components/refund-status-panel");
  });

  it("申请 action 是 server action,金额**由服务端算**(客户端不传)", () => {
    const src = stripComments(read("src/features/refund/user/actions.ts"));
    expect(src).toContain("requestRefundAction");
    // 客户端只给订单号 + 原因
    expect(src).toContain("orderKind");
    expect(src).toContain("orderNo");
    expect(src).toContain("reason");
    // 金额来自服务端
    expect(src).toContain("totalCents");
  });

  it("申请 action 跑的是 `evaluateRefundEligibility`(服务端才是授权边界)", () => {
    const src = stripComments(read("src/features/refund/user/actions.ts"));
    expect(src).toContain("evaluateRefundEligibility");
  });
});

/* ========================================================================== */
/*  6. 迁移脚本:幂等 + 不播种                                                  */
/* ========================================================================== */

describe("退款流程:迁移脚本幂等 + 不播种", () => {
  const src = read("scripts/apply-refund-schema.ts");

  it("建表用 `CREATE TABLE IF NOT EXISTS`", () => {
    expect(src).toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("建索引用 `CREATE INDEX IF NOT EXISTS`", () => {
    expect(src).toContain("CREATE INDEX IF NOT EXISTS");
    expect(src).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
  });

  it("**不播种任何一行** —— 跑完线上行为一个字节都不变", () => {
    expect(src).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it("**不改任何订单表** —— 老订单的金额一个都不变", () => {
    expect(src).not.toMatch(/\bUPDATE\s+"?storefront_order/i);
    expect(src).not.toMatch(/\bUPDATE\s+"?print_order/i);
  });

  it("有 `--dry-run`", () => {
    expect(src).toContain("--dry-run");
  });

  it("两个「待处理」不能并存 —— 部分唯一索引", () => {
    expect(src).toContain("refund_request_pending_uq");
    expect(src).toContain("WHERE \"status\" = 'pending'");
  });

  it("不加外键到订单表(两种订单指一张挂不上)", () => {
    expect(src).not.toMatch(/REFERENCES\s+"?storefront_order/i);
    expect(src).not.toMatch(/REFERENCES\s+"?print_order/i);
  });

  it("`package.json` 登记了迁移命令", () => {
    const pkg = read("package.json");
    expect(pkg).toContain("migrate:apply-refund");
  });
});

/* ========================================================================== */
/*  7. 后台页不开弹窗 + use server 不 re-export 类型                             */
/* ========================================================================== */

describe("退款流程:后台页不开弹窗", () => {
  it("列表视图里没有 `<Modal>` / `<Dialog>` / `<Drawer>`", () => {
    const src = stripComments(
      read("src/features/refund/admin/components/refunds-admin-view.tsx")
    );
    expect(src).not.toMatch(/<Modal[\s>]/);
    expect(src).not.toMatch(/<Dialog[\s>]/);
    expect(src).not.toMatch(/<Drawer[\s>]/);
    expect(src).not.toContain("Modal.");
  });

  it("展开面板里也没有 —— 一切就地展开", () => {
    const src = stripComments(
      read("src/features/refund/admin/components/refund-expand-panel.tsx")
    );
    expect(src).not.toMatch(/<Modal[\s>]/);
    expect(src).not.toMatch(/<Dialog[\s>]/);
    expect(src).not.toMatch(/<Drawer[\s>]/);
    expect(src).not.toContain("Modal.");
  });
});

describe("退款流程:「use server」文件不 re-export 类型", () => {
  it("`admin/actions.ts` 没有 `export type {` / `export { type`", () => {
    const src = read("src/features/refund/admin/actions.ts");
    expect(src).not.toMatch(/export\s+type\s*\{/);
    expect(src).not.toMatch(/export\s*\{[^}]*\btype\b/);
  });

  it("`user/actions.ts` 没有 `export type {` / `export { type`", () => {
    const src = read("src/features/refund/user/actions.ts");
    expect(src).not.toMatch(/export\s+type\s*\{/);
    expect(src).not.toMatch(/export\s*\{[^}]*\btype\b/);
  });

  it("类型住在**不是** `\"use server\"` 的文件里", () => {
    // 文件头注释里解释着「为什么类型不住在 `"use server"` 文件里」⇒ 去掉注释再看
    const adminTypes = stripComments(
      read("src/features/refund/admin/types.ts")
    );
    expect(adminTypes).not.toContain('"use server"');
    expect(adminTypes).toContain("AdminRefundErrorCode");

    const userTypes = stripComments(read("src/features/refund/user/types.ts"));
    expect(userTypes).not.toContain('"use server"');
  });
});

/* ========================================================================== */
/*  8. action 不 throw + 写完刷买家侧那一页                                      */
/* ========================================================================== */

describe("退款流程:action 不 throw,失败走 {ok:false, code}", () => {
  const src = stripComments(read("src/features/refund/admin/actions.ts"));

  it("五个 action 都在", () => {
    for (const name of [
      "adminListRefundRequestsAction",
      "adminApproveRefundAction",
      "adminRejectRefundAction",
      "adminMarkRefundedAction",
      "adminExecuteRefundAction",
    ]) {
      expect(src).toContain(name);
    }
  });

  it("用的是 `adminAction`(管理员权限)", () => {
    expect(src).toContain("adminAction");
  });

  it("写完刷后台那一页 + 买家侧两页", () => {
    // 后台那一页的路径**提成了常量**(六个 action 都要刷它 ⇒ 写一遍就够)
    expect(src).toContain('const REVALIDATE_PATH = "/[locale]/admin/refunds"');
    expect(src).toContain("revalidatePath(REVALIDATE_PATH");

    // 买家侧两页:商城订单 + 打印工单
    expect(src).toContain('revalidatePath("/[locale]/account/orders"');
    expect(src).toContain('revalidatePath("/[locale]/account/print-orders"');
  });

  it("买家侧两页是**两个都要刷** —— 不是只刷订单那一页", () => {
    // `revalidateBuyerPaths` 按 orderKind 分流 ⇒ 两张页面各走各的
    expect(src).toContain("function revalidateBuyerPaths");
    const helper = src.slice(
      src.indexOf("function revalidateBuyerPaths"),
      src.indexOf("function revalidateBuyerPaths") + 400
    );
    expect(helper).toContain('"/[locale]/account/print-orders"');
    expect(helper).toContain('"/[locale]/account/orders"');
  });
});
