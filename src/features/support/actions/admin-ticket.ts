"use server";

/**
 * 管理员工单 Actions
 */

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { ticket, ticketMessage } from "@/db/schema";
import { addTicketMessageSchema } from "@/features/support/schemas/ticket";
import { adminAction } from "@/lib/safe-action";

const withAdminTicketAction = (name: string) =>
  adminAction.metadata({ action: `support.adminTicket.${name}` });

/**
 * 获取所有工单列表（管理员）
 */
export const getAllTicketsAction = withAdminTicketAction("getAllTickets")
  .schema(
    z
      .object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        status: z
          .enum(["open", "in_progress", "resolved", "closed"])
          .optional(),
      })
      .optional()
  )
  .action(async ({ parsedInput }) => {
    const { limit = 50, offset = 0, status } = parsedInput ?? {};

    const tickets = await db.query.ticket.findMany({
      where: status ? eq(ticket.status, status) : undefined,
      orderBy: [desc(ticket.updatedAt)],
      limit,
      offset,
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return { tickets };
  });

/**
 * 获取单个工单详情（管理员）
 */
export const getAdminTicketDetailAction = withAdminTicketAction(
  "getTicketDetail"
)
  .schema(z.object({ ticketId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const { ticketId } = parsedInput;

    const ticketDetail = await db.query.ticket.findFirst({
      where: eq(ticket.id, ticketId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    if (!ticketDetail) {
      throw new Error("工单不存在");
    }

    const messages = await db.query.ticketMessage.findMany({
      where: eq(ticketMessage.ticketId, ticketId),
      orderBy: [ticketMessage.createdAt],
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return { ticket: ticketDetail, messages };
  });

/**
 * 更新工单状态（管理员）
 */
export const updateTicketStatusAction = withAdminTicketAction("updateStatus")
  .schema(
    z.object({
      ticketId: z.string().min(1),
      status: z.enum(["open", "in_progress", "resolved", "closed"]),
    })
  )
  .action(async ({ parsedInput }) => {
    const { ticketId, status } = parsedInput;

    const existing = await db.query.ticket.findFirst({
      where: eq(ticket.id, ticketId),
    });

    if (!existing) {
      throw new Error("工单不存在");
    }

    await db
      .update(ticket)
      .set({ status, updatedAt: new Date() })
      .where(eq(ticket.id, ticketId));

    revalidatePath("/admin/tickets");
    revalidatePath(`/admin/tickets/${ticketId}`);

    return { message: "工单状态已更新" };
  });

/**
 * 管理员回复工单
 */
export const adminReplyTicketAction = withAdminTicketAction("reply")
  .schema(addTicketMessageSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { ticketId, content } = parsedInput;

    const existing = await db.query.ticket.findFirst({
      where: eq(ticket.id, ticketId),
    });

    if (!existing) {
      throw new Error("工单不存在");
    }

    if (existing.status === "closed") {
      throw new Error("工单已关闭，无法回复");
    }

    const now = new Date();
    const [message] = await db
      .insert(ticketMessage)
      .values({
        id: crypto.randomUUID(),
        ticketId,
        userId: ctx.userId,
        content,
        isAdminResponse: true,
        createdAt: now,
      })
      .returning();

    await db
      .update(ticket)
      .set({ status: "in_progress", updatedAt: now })
      .where(eq(ticket.id, ticketId));

    revalidatePath("/admin/tickets");
    revalidatePath(`/admin/tickets/${ticketId}`);

    return { message };
  });
