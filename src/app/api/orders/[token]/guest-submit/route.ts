/**
 * 公共免登录 - preview 凭证客人「确认下单」（2026-09-13）
 *
 * POST /api/orders/[token]/guest-submit
 *
 * body: `{ selectedCell?: number }` —— 选中的 cell 索引（grid 多 cell 模式）
 *
 * ## 业务定位
 *
 * /image-gen 代理商 demo 流「分享给客户预览」创建的凭证（isPreviewShare=true
 * + status=CANDIDATES_READY + regenerateLimit=0 + createdBy=代理商 userId），客
 * 人扫码进 /p/[token] 看到预览图后点「确认下单」调本路由。本路由做两件事：
 *
 *   1. **扣代理商 credit**（amount = promptOrder.creditsCharged）
 *      - createPreviewShareAction 已提前算好 creditsCharged 写入 promptOrder，
 *        避免客人确认时重算（template.price / matching rule 改动会造成预览价
 *        / 实际价漂移）。这里直接读 promptOrder.creditsCharged。
 *      - 扣积分时按 FIFO 批次消耗（consumeCredits）→ 写 creditsTransaction
 *        服务名 "image-gen-preview-confirm"，与 demo 下单 "image-gen-demo" 区分
 *        对账（demo 是代理商主动下单；preview 是代理商被动接受客人确认）。
 *      - 积分不足 → 402 拒绝，promptOrder 状态不变（客人看到代理商积分不够
 *        提示，由代理商自行充值后再次分享链接）。注意是代理商的 userId 积分，
 *        不是客人的（客人免登录，连账户都没有）。
 *
 *   2. **状态机 SELECTED**
 *      - status: CANDIDATES_READY → SELECTED（与 gpt-image /select 路由终态
 *        一致）。
 *      - selections: [selectedCell]（batchCount=1，单元素 number[]）。
 *      - selectedAt: now；selectedIndex: selectedCell（兼容旧字段）。
 *
 * ## 与 /api/orders/[token]/select 的关系
 *
 * /select 是 ToC 订单的"按批选择"接口，支持 partial select + 增量提交；本路由
 * 是 demo 流 preview 凭证的"一次性确认"接口，只有一条候选、一批、不支持
 * partial。两套 API 互不影响。
 *
 * ## 与 /p/[token] 渲染的关系
 *
 * /p/[token] 页面读到 promptOrder.isPreviewShare=true + status=CANDIDATES_READY
 * 时显示"预览待确认"UI + 「确认下单」按钮（不再显示 /select 的 partial picker）。
 * 提交成功 → status=SELECTED → 渲染标准 SELECTED ResultStep（与普通订单一致）。
 *
 * ## 鉴权
 *
 * 不要任何 session / API key —— 客人免登录。token 自身即是"密码"（70+ 字符
 * 不可猜），下单 / 取消 / 二次访问都靠它。这是公网分享链接的固有模型，参考
 * Google Doc / Dropbox shared link。
 *
 * ## 错误码
 *
 * - 404 订单不存在
 * - 400 非 preview 订单（isPreviewShare=false）—— 本路由只服务 preview 凭证
 * - 400 终态已 SELECTED 之外的 status（如 PENDING / CANCELLED）—— 业务拒绝
 * - 409 已确认（SELECTED）—— 返回当前 selections，客户端可显示「已确认」
 * - 402 代理商积分不足
 * - 500 服务端异常
 *
 * ## 防重策略
 *
 * 同一 token 多次 submit：第二次命中 status=SELECTED 分支 → 409 + 返回已
 * 锁定的 selections + selectedAt。client 看到 409 直接渲染「已下单」UI（避免
 * 双重扣 credit）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { consumeCredits } from "@/features/credits/core";
import { InsufficientCreditsError } from "@/features/credits/errors";
import { parseSelections } from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      selectedCell?: unknown;
    };

    // 1. 校验 selectedCell（可选，1 candidate 模式强制 0）
    let selectedCell: number;
    if (
      typeof body.selectedCell === "number" &&
      Number.isInteger(body.selectedCell)
    ) {
      if (body.selectedCell < 0 || body.selectedCell > 8) {
        return NextResponse.json(
          { success: false, error: "selectedCell 超出范围（应在 0-8 之间）" },
          { status: 400 }
        );
      }
      selectedCell = body.selectedCell;
    } else if (body.selectedCell === undefined || body.selectedCell === null) {
      // 兼容老客户端：未传 → 默认 0（separate 模式 / 1 candidate 模式强制 0）
      selectedCell = 0;
    } else {
      return NextResponse.json(
        { success: false, error: "selectedCell 必须是 0-8 的整数" },
        { status: 400 }
      );
    }

    // 2. 查订单
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      with: {
        template: {
          columns: {
            id: true,
            name: true,
            candidateCount: true,
            outputMode: true,
            price: true,
          },
        },
      },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    // 3. 必须是 preview 凭证
    if (!order.isPreviewShare) {
      return NextResponse.json(
        {
          success: false,
          error: "此订单不是「分享预览」凭证，请使用 /select 接口选择候选",
        },
        { status: 400 }
      );
    }

    // 4. 防重：SELECTED 终态 → 409 + 返回已有 selections
    if (order.status === "SELECTED") {
      return NextResponse.json(
        {
          success: false,
          error: "此预览凭证已被确认下单，无需重复提交",
          data: {
            status: order.status,
            selections: parseSelections(order.selections as string | null),
            selectedAt: order.selectedAt?.toISOString() ?? null,
            orderNo: order.orderNo,
            alreadyConfirmed: true,
          },
        },
        { status: 409 }
      );
    }

    // 5. 必须是 CANDIDATES_READY —— PENDING/GENERATING/CANCELLED/FAILED 都拒绝
    if (order.status !== "CANDIDATES_READY") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，无法确认下单。${
            order.status === "CANCELLED"
              ? "代理商已取消该预览。"
              : order.status === "FAILED"
                ? "生成失败，请联系代理商重新生成预览。"
                : ""
          }`,
        },
        { status: 400 }
      );
    }

    // 6. 校验 selectedCell 与 template candidateCount 兼容性
    //    preview 流 batchCount=1（uploadedImages=[referenceImageUrl]，1 张原图 +
    //    imagesPerUpload=1）。candidates 是 [[demoPreviewUrl]]，所以 batchCount=1，
    //    candidateCount（内层）=1。如果选了 selectedCell > 0，1 candidate 模式
    //    下越界 → 400 拒绝（强制 0）。
    const templateCandidateCount = order.template.candidateCount ?? 1;
    if (templateCandidateCount <= 1 && selectedCell !== 0) {
      return NextResponse.json(
        {
          success: false,
          error: "该预览只有 1 个候选，selectedCell 必须为 0",
        },
        { status: 400 }
      );
    }
    if (selectedCell >= templateCandidateCount) {
      return NextResponse.json(
        {
          success: false,
          error: `selectedCell ${selectedCell} 超出范围（应在 0-${templateCandidateCount - 1} 之间）`,
        },
        { status: 400 }
      );
    }

    // 7. 校验代理商有 createdBy（preview 凭证必须由代理商创建）
    if (!order.createdBy) {
      return NextResponse.json(
        {
          success: false,
          error: "预览凭证缺失代理商身份，无法扣积分",
        },
        { status: 500 }
      );
    }

    // 8. 算并扣 credit（读 promptOrder.creditsCharged，由 createPreviewShareAction
    //    提前算好；不重算避免预览价 / 实际价漂移）。creditsCharged 为 null（老数据）
    //    或 0 → 跳过扣减直接 SELECTED。
    const creditsToCharge = order.creditsCharged ?? 0;
    if (creditsToCharge > 0) {
      try {
        const specSummary = [
          order.template.name,
          order.productSize ? `${order.productSize}cm` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const description = `${specSummary} = ${creditsToCharge} 积分（预览确认）`;
        await consumeCredits({
          userId: order.createdBy,
          amount: creditsToCharge,
          serviceName: "image-gen-preview-confirm",
          description,
          metadata: {
            orderId: order.id,
            orderNo: order.orderNo,
            templateId: order.template.id,
            templateName: order.template.name,
            isPreviewShare: true,
            trigger: "guest_submit",
          },
        });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return NextResponse.json(
            {
              success: false,
              error: `代理商积分不足（需要 ${err.required}，当前可用 ${err.available}），请联系代理商充值后再分享预览`,
              data: {
                agentHasInsufficientCredits: true,
                required: err.required,
                available: err.available,
              },
            },
            { status: 402 }
          );
        }
        throw err;
      }
    }

    // 9. UPDATE → SELECTED（batchCount=1 单元素 selections）
    const selectionsJson = JSON.stringify([selectedCell]);
    const now = new Date();
    await db
      .update(promptOrder)
      .set({
        status: "SELECTED",
        selections: selectionsJson,
        selectedAt: now,
        selectedIndex: selectedCell,
        updatedAt: now,
      })
      .where(eq(promptOrder.id, order.id));

    return NextResponse.json({
      success: true,
      message:
        creditsToCharge > 0
          ? `已确认下单，扣除代理商 ${creditsToCharge} 积分。`
          : "已确认下单。",
      data: {
        status: "SELECTED" as const,
        orderId: order.id,
        orderNo: order.orderNo,
        selections: [selectedCell],
        selectedAt: now.toISOString(),
        creditsCharged: creditsToCharge,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "提交失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
