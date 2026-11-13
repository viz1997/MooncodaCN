"use server";

/**
 * /admin/shipments —— 后台发货台 server actions(2026-11-13)
 *
 * 工作室寄出东西之后,后台要能填「快递公司 + 运单号」,买家要看得见。
 * 这一组 action 是**发货台的唯一写入口**:
 *
 * - `adminListShipmentRowsAction` —— 读发货台(商城订单 + 打印工单摆一张表)
 * - `adminCreateShipmentAction` —— 建发货单(第一次发货 / 加一个包裹)
 * - `adminUpdateShipmentStatusAction` —— 改物流状态(签收 / 异常退回 / 撤销)
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(是订单不在?是这个状态不让改?是表还没建?)。所以这里把**能预见的**
 * 失败都变成一个 code,界面照着 code 给话。
 *
 * ## 「use server」文件只导出 async 函数
 *
 * 类型**不能**在这里 re-export —— Turbopack 会把它注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。类型全在
 * `./types.ts`。
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import {
  notifyPrintOrderStatusChanged,
  toPrintOrderMailInfo,
} from "@/features/print-quote/lib/notifications";
import {
  isShipmentCarrierCode,
  OTHER_CARRIER_CODE,
} from "@/features/shipment/lib/carriers";
import { linkOrderStatusAfterShipment } from "@/features/shipment/lib/order-linkage";
import {
  createShipment,
  getShipmentOrderRef,
  listAdminShipmentRows,
  transitionShipmentStatus,
} from "@/features/shipment/lib/shipment-store";
import { SHIPMENT_STATUSES } from "@/features/shipment/lib/transitions";
import type { ShipmentStatus } from "@/features/shipment/lib/types";
import { adminAction } from "@/lib/safe-action";

import type {
  AdminShipmentListResult,
  AdminShipmentWriteResult,
} from "./types";

const withAdminShipmentAction = (name: string) =>
  adminAction.metadata({ action: `admin.shipment.${name}` });

/** 每次写完都要刷的路径 */
const REVALIDATE_PATH = "/[locale]/admin/shipments";

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读发货台
 *
 * **两张订单表摆一张表** —— 工作室一天几十单,拆成两个页面等于来回切。
 *
 * 表还没建(迁移脚本没跑)时返 `{ok:false, code:"MIGRATION_MISSING"}` —— 界面
 * 显示「先跑 `pnpm migrate:apply-shipment`」,不是 500。
 */
export const adminListShipmentRowsAction = withAdminShipmentAction("list")
  .schema(
    z.object({
      status: z
        .enum([...SHIPMENT_STATUSES, "pending"])
        .nullable()
        .optional(),
    })
  )
  .action(async ({ parsedInput }): Promise<AdminShipmentListResult> => {
    try {
      const rows = await listAdminShipmentRows({
        status: parsedInput.status ?? null,
      });
      return { ok: true, rows };
    } catch (error) {
      console.error("[shipment] 读发货台失败:", error);
      return { ok: false, code: "MIGRATION_MISSING" };
    }
  });

/* -------------------------------------------------------------------------- */
/*  写:建发货单                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 建发货单的入参
 *
 * `shippingCompany` 用 `refine` 而不是 `z.enum` —— 清单在
 * `carriers.ts` 里是**运行时**的常量数组,`z.enum` 要静态字面量。
 */
const createShipmentSchema = z.object({
  /** 商城订单 / 打印工单 */
  orderKind: z.enum(["storefront", "print"]),
  /** 订单 id */
  orderId: z.string().min(1).max(64),
  /** 订单号 —— 跟 `orderId` 一起当 WHERE 条件,两个对不上就是「不存在」 */
  orderNo: z.string().min(1).max(64),
  /** 快递公司代码 */
  shippingCompany: z
    .string()
    .min(1)
    .max(32)
    .refine(isShipmentCarrierCode, "快递公司不在清单里"),
  /** 选了「其它」时自己填的名字 */
  shippingCompanyLabel: z.string().max(50).nullish(),
  /** 运单号(入库前归一化:全角→半角 / 去空白 / 转大写) */
  trackingNumber: z.string().min(4).max(64),
  /** 备注 */
  note: z.string().max(500).nullish(),
});

/**
 * 建发货单(第一次发货 / 加一个包裹)
 *
 * **包裹序号由服务端算** —— 客户端不传 `packageIndex`。两个人同时点「发货」
 * 会算出两个相同的序号,靠事务里的 `FOR UPDATE` 锁订单行 + 唯一索引兜住。
 *
 * 落库成功之后顺手把**订单状态往前推一格**(商城 → `fulfilled`,工单 →
 * `SHIPPED`)。联动是**尽力而为** —— 推不动不影响物流记录本身(那是主记录)。
 */
export const adminCreateShipmentAction = withAdminShipmentAction("create")
  .schema(createShipmentSchema)
  .action(async ({ parsedInput }): Promise<AdminShipmentWriteResult> => {
    // 「其它」必须填公司名 —— 否则买家侧只看到一个没有名字的快递
    //
    // zod 的 `superRefine` 也拦一道,但这里是**权威**判断:界面可能绕过
    // zod 直接调 action。
    const label = parsedInput.shippingCompanyLabel?.trim() ?? "";
    if (
      parsedInput.shippingCompany === OTHER_CARRIER_CODE &&
      label.length === 0
    ) {
      return { ok: false, code: "INVALID_INPUT" };
    }

    const result = await createShipment({
      orderKind: parsedInput.orderKind,
      orderId: parsedInput.orderId,
      orderNo: parsedInput.orderNo,
      shippingCompany: parsedInput.shippingCompany,
      shippingCompanyLabel: label.length > 0 ? label : null,
      trackingNumber: parsedInput.trackingNumber,
      note: parsedInput.note ?? null,
      actor: "admin",
    });

    if (!result.ok) {
      return { ok: false, code: result.code };
    }

    // 联动订单状态 —— 发货这一格把订单往前推
    await linkAndNotify({
      orderKind: parsedInput.orderKind,
      orderId: parsedInput.orderId,
      orderNo: parsedInput.orderNo,
      shipmentStatus: "shipped",
    });

    revalidatePath(REVALIDATE_PATH, "page");
    revalidateBuyerPaths(parsedInput.orderKind);

    return {
      ok: true,
      shipmentId: result.shipment.id,
      packageIndex: result.shipment.packageIndex,
      changed: result.changed,
    };
  });

/* -------------------------------------------------------------------------- */
/*  写:改物流状态                                                             */
/* -------------------------------------------------------------------------- */

/** 改物流状态的入参 */
const updateShipmentStatusSchema = z.object({
  shipmentId: z.string().min(1).max(64),
  /** 目标状态 */
  toStatus: z.enum([...SHIPMENT_STATUSES]),
  /**
   * 备注 —— **回退 / 异常时必填**(服务端强校验)
   *
   * 界面也会拦一道(选了回退目标就展开输入框,不填不让提交),但那只是
   * 便利:这里才是权威。
   */
  note: z.string().max(500).nullish(),
});

/**
 * 改物流状态 —— 签收 / 异常退回 / 撤销误标
 *
 * **合法跳转只问状态机**(`transitions.ts`)—— 后台下拉里给的选项和这里
 * 拒绝的集合是同一份,两处不可能漂。
 */
export const adminUpdateShipmentStatusAction = withAdminShipmentAction(
  "updateStatus"
)
  .schema(updateShipmentStatusSchema)
  .action(async ({ parsedInput }): Promise<AdminShipmentWriteResult> => {
    const result = await transitionShipmentStatus({
      shipmentId: parsedInput.shipmentId,
      toStatus: parsedInput.toStatus,
      note: parsedInput.note ?? null,
      actor: "admin",
    });

    if (!result.ok) {
      return { ok: false, code: result.code };
    }

    // 状态没变(重复点「保存」)—— 不联动、不发邮件,直接回「没改」
    if (!result.changed) {
      return {
        ok: true,
        shipmentId: result.shipment.id,
        packageIndex: result.shipment.packageIndex,
        changed: false,
      };
    }

    // 联动订单状态 —— 查回这个包裹挂在哪个订单上
    const ref = await getShipmentOrderRef(result.shipment.id);
    if (ref) {
      await linkAndNotify({
        orderKind: ref.orderKind,
        orderId: ref.orderId,
        orderNo: ref.orderNo,
        shipmentStatus: result.shipment.status,
      });
    }

    revalidatePath(REVALIDATE_PATH, "page");
    if (ref) {
      revalidateBuyerPaths(ref.orderKind);
    }

    return {
      ok: true,
      shipmentId: result.shipment.id,
      packageIndex: result.shipment.packageIndex,
      changed: true,
    };
  });

/* -------------------------------------------------------------------------- */
/*  内部工具                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 推订单状态 + 给打印工单发邮件
 *
 * ## 邮件只给打印工单发
 *
 * 打印工单有邮件基建(`notifyPrintOrderStatusChanged`),邮件按**订单的
 * 语言**发,不是按后台界面的语言。**商城订单没有邮件基建** —— 一期不新建,
 * 买家刷新页面就看得见。
 *
 * ## 联动失败不报错
 *
 * 物流记录已经落库了,那是主记录;订单的 `status` 是派生信息。推不动就推不动
 * —— 工作室照样能在发货台看到物流、买家照样看得到运单号。
 */
async function linkAndNotify(params: {
  orderKind: "storefront" | "print";
  orderId: string;
  orderNo: string;
  shipmentStatus: ShipmentStatus;
}): Promise<void> {
  const linkage = await linkOrderStatusAfterShipment(params);
  // 抽成局部 const —— 窄化结论要带进 `after()` 那个闭包里
  const printOrder = linkage.printOrder;
  const printToStatus = linkage.printToStatus;
  if (!linkage.linked || !printOrder || !printToStatus) {
    return;
  }
  after(async () => {
    await notifyPrintOrderStatusChanged({
      order: toPrintOrderMailInfo(printOrder),
      toStatus: printToStatus,
      note: null,
    });
  });
}

/**
 * 写完顺手刷买家侧的页面
 *
 * 买家侧详情页是 RSC 首屏 + 客户端轮询;这里刷一下首屏的缓存,轮询那边
 * 自己会跟上。
 */
function revalidateBuyerPaths(orderKind: "storefront" | "print"): void {
  if (orderKind === "print") {
    revalidatePath("/[locale]/account/print-orders", "page");
    return;
  }
  revalidatePath("/[locale]/account/orders", "page");
}
