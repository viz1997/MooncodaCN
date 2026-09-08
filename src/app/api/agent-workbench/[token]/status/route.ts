/**
 * 代理商 workbench 状态查询（2026-09-07）
 *
 * GET /api/agent-workbench/[token]/status
 *
 * 与 /api/orders/[token]/status 的区别：
 * - 多返回 candidates 完整 URL 列表（前端 SelectStep 渲染候选网格用）
 * - 多返回 productTypeCode / productSize / accessoryCode（ResultStep 展示订单详情用）
 *
 * Auth：必须登录 + session.user.agentId === agent.id + token 匹配 agent.imageGenToken。
 * 不通过直接返回 401/403/404，不暴露订单是否存在。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { requireAgentByToken } from "@/features/agent/lib/auth-agent-token";
import {
  countCandidateGroups,
  countUploadedImages,
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function getHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;

    // 1. auth gate
    let agent;
    try {
      const r = await requireAgentByToken(token, { redirectTo: false });
      agent = r.agent;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "UNAUTHENTICATED";
      const status =
        msg === "AGENT_NOT_FOUND" ? 404 : msg === "FORBIDDEN" ? 403 : 401;
      return NextResponse.json({ success: false, error: msg }, { status });
    }

    // 2. 拉订单（按 token，且必须属于这个 agent）
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: {
        id: true,
        orderNo: true,
        agentId: true,
        status: true,
        errorMessage: true,
        uploadedAt: true,
        generatedAt: true,
        selectedAt: true,
        candidates: true,
        selections: true,
        uploadedImages: true,
        productTypeCode: true,
        productSize: true,
        accessoryCode: true,
        engravingText: true,
        engravingExposed: true,
        updatedAt: true,
      },
    });
    if (!order || order.agentId !== agent.id) {
      return NextResponse.json(
        { success: false, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const candidates = parseCandidates(order.candidates as string | null);
    const uploaded = parseUploadedImages(order.uploadedImages as string | null);
    const selections = parseSelections(order.selections as string | null);

    return NextResponse.json({
      success: true,
      data: {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        errorMessage: order.errorMessage,
        uploadedAt: order.uploadedAt?.toISOString() ?? null,
        generatedAt: order.generatedAt?.toISOString() ?? null,
        selectedAt: order.selectedAt?.toISOString() ?? null,
        candidates,
        candidateGroups: countCandidateGroups(candidates),
        uploadedImageCount: countUploadedImages(uploaded),
        selections,
        productTypeCode: order.productTypeCode,
        productSize: order.productSize,
        accessoryCode: order.accessoryCode,
        engravingText: order.engravingText,
        engravingExposed: order.engravingExposed,
        updatedAt: order.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "查询失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
