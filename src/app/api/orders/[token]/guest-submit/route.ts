/**
 * 公共免登录 - preview 凭证客人「确认下单」（2026-09-13）
 *
 * POST /api/orders/[token]/guest-submit
 *
 * body: `{ selectedCell?: number }` —— 选中的 cell 索引（grid 多 cell 模式）
 *
 * ## 业务定位
 *
 * /image-gen 代理商 demo 流「分享给客户预览」创建的凭证（preview_share 表，
 * status='pending' + spec 已默认填好 + createdBy=代理商 userId），客人扫码
 * 进 /p/[token] 看到预览图后点「确认下单」调本路由。本路由做三件事：
 *
 *   1. **校验 preview_share 状态机**
 *      - status='pending' + expires_at > now → 可提交
 *      - status='confirmed' → 409（防重提，返回 linkedOrderId 让前端跳 SELECTED 视图）
 *      - status='pending' 但 expires_at < now → 410（链接过期）
 *      - 查不到 → 404
 *
 *   2. **扣代理商 credit**（amount = preview_share.creditsCharged）
 *      - createPreviewShareAction 已提前算好 creditsCharged 写入 preview_share，
 *        避免客人确认时重算（template.price / matching rule 改动会造成预览价
 *        / 实际价漂移）。这里直接读 preview_share.creditsCharged。
 *      - 扣积分时按 FIFO 批次消耗（consumeCredits）→ 写 creditsTransaction
 *        服务名 "image-gen-preview-confirm"，与 demo 下单 "image-gen-demo" 区分
 *        对账（demo 是代理商主动下单；preview 是代理商被动接受客人确认）。
 *      - 积分不足 → 402 拒绝，preview_share 状态不变（客人看到代理商积分
 *        不够提示，由代理商自行充值后再次分享链接）。注意是代理商的 userId
 *        积分，不是客人的（客人免登录，连账户都没有）。
 *
 *   3. **新建 promptOrder + 锁定 preview_share**
 *      - NEW INSERT promptOrder(status='SELECTED', selections=[selectedCell],
 *        selectedAt=now, orderNo=新生成 IG-XXXXXX, token=新生成, uploadedImages=
 *        [reference_image_url], candidates=[[demo_preview_url]], 上传时间/生成
 *        时间镜像 preview_share 创建时间)
 *      - UPDATE preview_share.status='confirmed' + linked_order_id=新 promptOrder.id
 *        + confirmed_at=now + confirmed_by_ip=clientIp
 *      - 客人后续访问 /p/{token} → page.tsx 按 preview_share.linked_order_id
 *        跳转到新建 promptOrder 的 SELECTED 视图
 *
 * ## 与 /api/orders/[token]/select 的关系
 *
 * /select 是 ToC 订单的"按批选择"接口，支持 partial select + 增量提交；本路由
 * 是 demo 流 preview 凭证的"一次性确认"接口，只有一条候选、一批、不支持
 * partial。两套 API 互不影响。
 *
 * ## 与 /p/[token] 渲染的关系
 *
 * /p/[token] 入口 page.tsx 先查 preview_share by token → 命中且 status='pending'
 * 渲染 PreviewConfirmStep；status='confirmed' + linked_order_id 跳转 SELECTED
 * 视图。查不到再查 promptOrder 走原有路径。
 *
 * ## 鉴权
 *
 * 不要任何 session / API key —— 客人免登录。token 自身即是"密码"（32 字符
 * 不可猜），下单 / 取消 / 二次访问都靠它。这是公网分享链接的固有模型，参考
 * Google Doc / Dropbox shared link。
 *
 * ## 错误码
 *
 * - 404 凭证不存在（preview_share 查不到）
 * - 410 链接已过期（pending 但 expires_at < now）
 * - 409 已确认（confirmed）—— 返回 linkedOrderId，客户端可显示「已下单」
 * - 400 状态异常 / 校验失败
 * - 402 代理商积分不足
 * - 500 服务端异常
 *
 * ## 防重策略
 *
 * 同一 token 多次 submit：第二次命中 status='confirmed' 分支 → 409 +
 * 返回 linkedOrderId 让前端跳转 SELECTED 视图。client 看到 409 直接渲染
 * 「已下单」过渡 UI（避免双重扣 credit）。
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { previewShare, promptOrder } from "@/db/schema";
import { consumeCredits } from "@/features/credits/core";
import { InsufficientCreditsError } from "@/features/credits/errors";
import { generateOrderToken } from "@/features/gpt-image/lib/generation-service";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

/**
 * 生成订单号 IG-YYYYMMDD-XXXXXX（IG = ImageGen, XXXXXX = nanoid 6 位大写）。
 * 与 submit-image-gen-demo.ts 的私有 generateOrderNo 实现一致 —— 本地复刻一份
 * 避免跨 server action 文件 import 常量（next-safe-action 限制）。
 */
function generatePromptOrderNo(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 8);
  const rand = nanoid(6).toUpperCase();
  return `IG-${ts}-${rand}`;
}

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

    // 2. 查 preview_share（不是 promptOrder —— 分享链接 ≠ 下单）
    const share = await db.query.previewShare.findFirst({
      where: eq(previewShare.token, token),
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
    if (!share) {
      return NextResponse.json(
        { success: false, error: "分享链接无效或已被删除" },
        { status: 404 }
      );
    }

    // 3. 防重：confirmed 终态 → 409 + 返回 linkedOrderId 让前端跳 SELECTED 视图
    if (share.status === "confirmed") {
      return NextResponse.json(
        {
          success: false,
          error: "此预览凭证已被确认下单，无需重复提交",
          data: {
            status: share.status,
            linkedOrderId: share.linkedOrderId,
            confirmedAt: share.confirmedAt?.toISOString() ?? null,
            alreadyConfirmed: true,
          },
        },
        { status: 409 }
      );
    }

    // 4. 已过期（pending 但 expires_at < now）→ 410 Gone
    if (
      share.status === "expired" ||
      (share.expiresAt && share.expiresAt.getTime() < Date.now())
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "分享链接已过期，请联系代理商重新分享",
          data: {
            status: "expired",
            expiresAt: share.expiresAt?.toISOString() ?? null,
          },
        },
        { status: 410 }
      );
    }

    // 5. 必须是 pending —— 其它 status 拒绝
    if (share.status !== "pending") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${share.status}，无法确认下单`,
        },
        { status: 400 }
      );
    }

    // 6. 校验 selectedCell 与 template candidateCount 兼容性
    //    preview 流 batchCount=1（referenceImageUrl 1 张原图）。candidates 是
    //    [[demoPreviewUrl]]，所以 batchCount=1，candidateCount（内层）=1。
    //    如果选了 selectedCell > 0，1 candidate 模式下越界 → 400 拒绝（强制 0）。
    const templateCandidateCount = share.template.candidateCount ?? 1;
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
    if (!share.createdBy) {
      return NextResponse.json(
        {
          success: false,
          error: "预览凭证缺失代理商身份，无法扣积分",
        },
        { status: 500 }
      );
    }

    // 8. 算并扣 credit（读 preview_share.creditsCharged，由 createPreviewShareAction
    //    提前算好；不重算避免预览价 / 实际价漂移）。creditsCharged 为 0 → 跳过扣减
    //    直接 SELECTED（与老逻辑一致）。
    const creditsToCharge = share.creditsCharged ?? 0;
    if (creditsToCharge > 0) {
      try {
        const specSummary = [
          share.template.name,
          share.productSize ? `${share.productSize}cm` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const description = `${specSummary} = ${creditsToCharge} 积分（预览确认）`;
        await consumeCredits({
          userId: share.createdBy,
          amount: creditsToCharge,
          serviceName: "image-gen-preview-confirm",
          description,
          metadata: {
            previewShareId: share.id,
            previewOrderNo: share.orderNo,
            templateId: share.template.id,
            templateName: share.template.name,
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

    // 9. NEW INSERT promptOrder（status='SELECTED'）—— 分享链接 → 正式订单
    //    镜像 preview_share 全部规格字段；candidates 是 [[demoPreviewUrl]]
    //    （preview 凭证持有 1 张效果图）；uploadedImages 是 [referenceImageUrl]
    //    （demo 阶段用户上传的原图）。
    const now = new Date();
    const selectionsJson = JSON.stringify([selectedCell]);
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;

    const [newOrder] = await db
      .insert(promptOrder)
      .values({
        id: nanoid(),
        orderNo: generatePromptOrderNo(),
        token: generateOrderToken(),
        templateId: share.template.id,
        // preview 阶段代理商已确认规格，直接落 promptOrder
        productTypeCode: share.productTypeCode,
        productSize: share.productSize,
        accessoryCode: share.accessoryCode,
        engravingText: share.engravingText,
        engravingExposed: share.engravingExposed,
        leatherColor: share.leatherColor,
        leatherExposed: share.leatherExposed,
        pvcProtection: share.pvcProtection,
        remarks: share.remarks,
        platform: share.platform,
        platformOrderNo: share.platformOrderNo,
        // status=SELECTED：终态，已确认提交
        status: "SELECTED",
        // preview 流 batchCount=1：uploadedImages=[referenceImageUrl]，
        // candidates=[[demoPreviewUrl]]
        uploadCount: 1,
        imagesPerUpload: 1,
        regenerateLimit: 0, // preview 流不允许再生图
        uploadedImages: JSON.stringify([share.referenceImageUrl]),
        uploadedAt: share.createdAt, // 沿用 preview 凭证创建时间
        generatedAt: share.createdAt,
        candidates: share.candidates, // "[[demoPreviewUrl]]"
        selections: selectionsJson,
        selectedAt: now,
        selectedIndex: selectedCell,
        // 镜像 creditsCharged / creditsBreakdown（已扣到代理商）
        creditsCharged: share.creditsCharged,
        creditsBreakdown: share.creditsBreakdown,
        // preview 凭证创建的订单 → createdBy=代理商（demo 流同源）
        createdBy: share.createdBy,
        // preview 流不绑代理商（代理商业务已砍，保留 set null 历史兼容）
        agentId: null,
        // 关键标志：标识此订单来源是 preview 凭证确认（便于对账 + admin 复盘）。
        // 不再用 promptOrder.isPreviewShare 列 —— 旧列已 drop（0017 migration）。
        // 关系链靠 preview_share.linked_order_id 反向追溯。
      })
      .returning({ id: promptOrder.id, orderNo: promptOrder.orderNo });

    if (!newOrder) {
      throw new Error("新建订单失败");
    }

    // 10. UPDATE preview_share → confirmed + linkedOrderId
    await db
      .update(previewShare)
      .set({
        status: "confirmed",
        linkedOrderId: newOrder.id,
        selectedCell,
        confirmedAt: now,
        confirmedByIp: clientIp,
        updatedAt: now,
      })
      .where(eq(previewShare.id, share.id));

    return NextResponse.json({
      success: true,
      message:
        creditsToCharge > 0
          ? `已确认下单，扣除代理商 ${creditsToCharge} 积分。`
          : "已确认下单。",
      data: {
        status: "confirmed" as const,
        previewOrderNo: share.orderNo,
        orderId: newOrder.id,
        orderNo: newOrder.orderNo,
        token: null as string | null, // 见下方备注 —— 新订单的 token 不暴露，客人继续访问原 /p/{token} 即可跳转
        selections: [selectedCell],
        selectedAt: now.toISOString(),
        creditsCharged: creditsToCharge,
        linkedOrderId: newOrder.id,
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
