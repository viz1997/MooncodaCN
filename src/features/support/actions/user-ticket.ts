"use server";

/**
 * 用户端工单 Actions
 */

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { ticket, ticketMessage } from "@/db/schema";
import {
  addTicketMessageSchema,
  createTicketSchema,
} from "@/features/support/schemas/ticket";
import { protectedAction } from "@/lib/safe-action";

const withUserTicketAction = (name: string) =>
  protectedAction.metadata({ action: `support.userTicket.${name}` });

/**
 * 创建工单
 */
export const createTicketAction = withUserTicketAction("create")
  .schema(createTicketSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { subject, category, priority, message } = parsedInput;
    const ticketId = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(ticket).values({
        id: ticketId,
        userId: ctx.userId,
        subject,
        category,
        priority,
        status: "open",
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(ticketMessage).values({
        id: crypto.randomUUID(),
        ticketId,
        userId: ctx.userId,
        content: message,
        isAdminResponse: false,
        createdAt: now,
      });
    });

    revalidatePath("/dashboard/support");
    return { ticketId };
  });

/**
 * 获取当前用户的工单列表
 */
export const getMyTicketsAction = withUserTicketAction("getMyTickets")
  .schema(
    z
      .object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
      .optional()
  )
  .action(async ({ parsedInput, ctx }) => {
    const { limit = 50, offset = 0 } = parsedInput ?? {};

    const tickets = await db.query.ticket.findMany({
      where: eq(ticket.userId, ctx.userId),
      orderBy: [desc(ticket.updatedAt)],
      limit,
      offset,
    });

    return { tickets };
  });

/**
 * 获取当前用户的单个工单详情（含消息）
 */
export const getTicketDetailAction = withUserTicketAction("getTicketDetail")
  .schema(z.object({ ticketId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const { ticketId } = parsedInput;

    const ticketDetail = await db.query.ticket.findFirst({
      where: and(eq(ticket.id, ticketId), eq(ticket.userId, ctx.userId)),
    });

    if (!ticketDetail) {
      throw new Error("工单不存在或无权访问");
    }

    const messages = await db.query.ticketMessage.findMany({
      where: eq(ticketMessage.ticketId, ticketId),
      orderBy: [ticketMessage.createdAt],
    });

    return { ticket: ticketDetail, messages };
  });

/**
 * 用户给工单添加消息
 */
export const addTicketMessageAction = withUserTicketAction("addMessage")
  .schema(addTicketMessageSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { ticketId, content } = parsedInput;

    const existingTicket = await db.query.ticket.findFirst({
      where: and(eq(ticket.id, ticketId), eq(ticket.userId, ctx.userId)),
    });

    if (!existingTicket) {
      throw new Error("工单不存在或无权访问");
    }

    if (existingTicket.status === "closed") {
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
        isAdminResponse: false,
        createdAt: now,
      })
      .returning();

    await db
      .update(ticket)
      .set({ updatedAt: now })
      .where(eq(ticket.id, ticketId));

    revalidatePath(`/dashboard/support/${ticketId}`);
    return { message };
  });
