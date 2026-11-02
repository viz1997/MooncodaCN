/**
 * 打印工单事件(时间线)的读写
 *
 * ## 为什么事件写入要跟状态变更绑在一个事务里
 *
 * 「状态改了但时间线没写」和「时间线写了但状态没改」都是坏数据:
 * 前者用户看不到过程,后者工作室按时间线干活却对不上当前状态。所以事件
 * 写入**必须**跟状态更新在同一个事务里 —— 这也是本文件唯一的事件写入口。
 *
 * ## 系统句子不落库
 *
 * 库里只存人工写的自由文本(note)。「工作室把工单从待确认改成了已确认」
 * 这种句子由前端按 (actor, from, to) 用 i18n 现场渲染 —— 库里不存需要
 * 翻译的字符串,用户中途切语言,老事件也能正确显示。
 */

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { type PrintOrderEventRow, printOrderEvent } from "@/db/schema";
/**
 * drizzle 事务 executor(运行时接收 db 或 tx)
 *
 * 直接复用 gpt-image 的那个 —— 它就是「drizzle 的 db / 事务」的通用类型,
 * 不是 gpt-image 独有的东西。type-only import,编译后擦除,没有运行时耦合。
 */
import type { DbOrTx } from "@/features/gpt-image/lib/order-history";
import type {
  PrintOrderEventActor,
  PrintOrderEventView,
  PrintOrderStatus,
} from "./quote-types";

/**
 * 追加一条时间线事件 —— **唯一的事件写入点**
 *
 * 必须传 tx:事件和订单状态要在同一个事务里落。
 */
export async function appendPrintOrderEvent(
  tx: DbOrTx,
  input: {
    orderId: string;
    /** 原状态;创建事件为 null */
    fromStatus: PrintOrderStatus | null;
    toStatus: PrintOrderStatus;
    actor: PrintOrderEventActor;
    /** 人工备注;回退时必填 */
    note?: string | null;
  }
): Promise<PrintOrderEventRow> {
  const [row] = await tx
    .insert(printOrderEvent)
    .values({
      id: nanoid(),
      orderId: input.orderId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actor: input.actor,
      note: input.note ?? null,
      createdAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("insert print_order_event 没有返回行");
  }
  return row;
}

/** 读某单的时间线(按时间正序) */
export async function listPrintOrderEvents(
  orderId: string
): Promise<PrintOrderEventRow[]> {
  return db
    .select()
    .from(printOrderEvent)
    .where(eq(printOrderEvent.orderId, orderId))
    .orderBy(asc(printOrderEvent.createdAt));
}

/** DB 行 → 时间线视图(时间转成 ISO 串,前端直接 new Date() 用) */
export function toPrintOrderEventView(
  row: PrintOrderEventRow
): PrintOrderEventView {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actor: row.actor,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
