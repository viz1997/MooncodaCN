import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「访客可见计价」—— 不登录也能看到报价(2026-11-07)
 *
 * 工作室的原话:**「现在不登录也允许计价显示,后台需要做一个开关」**
 *
 * ## 这个功能长什么样
 *
 * ```
 * /tools/workbench(公开工具页)
 *   → 量完模型 → 区域内点「报价」→ 弹窗里摆一个**预估报价**
 *   → 访客也能看到(工作室现在就要这个行为)
 *   → 后台 `/admin/print-pricing` 一个开关能随时关掉
 * ```
 *
 * ## 为什么值得测
 *
 * 这条链子上有四个容易出错的点,每一个都能让工作室「看到的东西跟收的钱
 * 对不上」或者「开关形同虚设」:
 *
 * 1. **价必须服务端算** —— 客户端算的价能被改。工具页那个数字是**问服务端
 *    要的**(`POST /api/print-quote`),不是本地算的。
 * 2. **开关真的管得住** —— 未登录 + 开关关着 → 接口回 403,界面摆「登录后
 *    可见报价」。**不许**偷偷回一个 200 然后在前端藏起来(那等于没关)。
 * 3. **已登录的人不受开关管** —— 能下单就能看价。开关只管访客。
 * 4. **支撑没算的时候金额是偏低的** —— 那个数得说清楚「未含支撑费」,
 *    不能摆一个看着精确、其实少算了一笔的钱。
 *
 * 全部是文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前要登录」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 把空白压成单个空格 —— 匹配的是**代码**,不是排版 */
function flat(src: string): string {
  return src.replace(/\s+/g, " ");
}

const ROUTE = "src/app/api/print-quote/route.ts";
const ADMIN_VIEW =
  "src/features/print-quote/admin/components/print-pricing-admin-view.tsx";
const ADMIN_ACTIONS = "src/features/print-quote/admin/pricing-actions.ts";
const MIGRATION = "scripts/apply-print-pricing-schema.ts";
const SETTINGS = "src/features/print-quote/lib/pricing-settings.ts";
const STORE = "src/features/print-quote/lib/pricing-store.ts";
const PREVIEW =
  "src/features/print-quote/components/print-service-quote-preview.tsx";
/**
 * 报价弹窗 —— 2026-11-09
 *
 * 以前预估报价在右栏那张「提交打印订单」卡片里(`print-service-submit-card.tsx`,
 * 2026-11-09 删掉了)。现在整块搬进**报价弹窗** —— 工作室的原话:「报价不放在
 * 右侧了,直接在区域内用一个报价按钮,点击后显示报价弹窗,弹窗里面去下单」。
 */
const QUOTE_DIALOG =
  "src/features/print-quote/components/print-service-quote-dialog.tsx";

describe("访客可见计价 —— 后台那个开关", () => {
  it("后台的计价设置里有一颗开关", () => {
    const code = stripComments(read(ADMIN_VIEW));

    expect(code).toContain('name="allowGuestPricing"');
    expect(code).toContain("<Switch />");
    // 开关旁边得说清楚它管的是谁
    expect(code).toContain("访客可见计价");
  });

  it("开关跟着「当前生效值」一起存进配置行", () => {
    const view = stripComments(read(ADMIN_VIEW));
    const actions = stripComments(read(ADMIN_ACTIONS));

    // 表单初值 / 提交载荷
    expect(view).toContain("allowGuestPricing: settings.allowGuestPricing");
    expect(view).toContain("allowGuestPricing: values.allowGuestPricing");
    // 校验
    expect(actions).toContain("allowGuestPricing: z.boolean()");
    // 写库
    expect(stripComments(read(STORE))).toContain(
      "allowGuestPricing: input.allowGuestPricing"
    );
  });

  it("回退链是「DB 配置行 → 环境变量 → 默认(开)」", () => {
    const code = stripComments(read(SETTINGS));

    expect(code).toContain(
      'allowGuestPricing: process.env.PRINT_ALLOW_GUEST_PRICING !== "false"'
    );
    expect(code).toContain(
      "configRow?.allowGuestPricing ?? fallback.allowGuestPricing"
    );
  });

  it("迁移脚本会补上那一列 —— 少一列,读配置整条报错", () => {
    const code = stripComments(read(MIGRATION));

    // 建表语句里带着
    expect(code).toContain(
      '"allow_guest_pricing" boolean NOT NULL DEFAULT true'
    );
    // 线上那张表是 2026-11-06 建的,少这一列 → 要一句 ALTER 补上
    expect(code).toContain("ADD COLUMN IF NOT EXISTS");
    expect(code).toContain(
      '"allow_guest_pricing" boolean NOT NULL DEFAULT true'
    );
  });
});

describe("访客可见计价 —— 报价接口", () => {
  it("未登录的人**不再一律 401** —— 开关开着就放行", () => {
    const code = stripComments(read(ROUTE));

    // 以前那行「未登录直接拒」不许还在
    expect(code).not.toContain('"请先登录"');
    // 闸门挪到「未登录 **且** 开关关着」
    expect(code).toContain("if (!user && !settings.allowGuestPricing)");
  });

  it("开关关着 + 未登录 → 403 `GUEST_PRICING_DISABLED`", () => {
    const code = stripComments(read(ROUTE));

    expect(code).toContain('error: "GUEST_PRICING_DISABLED"');
    expect(code).toContain("{ status: 403");
  });

  it("已登录的人不受开关管 —— 能下单就能看价", () => {
    const code = stripComments(read(ROUTE));

    // 闸门是「未登录 **且** 开关关着」,不是「开关关着」
    expect(code).toContain("!user && !settings.allowGuestPricing");
  });

  it("价从服务端算 —— 接口自己读设置,不信客户端带来的总价", () => {
    const code = stripComments(read(ROUTE));

    expect(code).toContain("const settings = await getPrintPricingSettings()");
    expect(code).toContain("computePrintQuote(settings, input)");
  });
});

describe("访客可见计价 —— 工具页那个预估报价", () => {
  it("价是**问服务端要的**,不是本地算的", () => {
    const code = stripComments(read(PREVIEW));

    expect(code).toContain('fetch("/api/print-quote"');
    expect(code).toContain('method: "POST"');
    // 客户端不许自己算价
    expect(code).not.toContain("calculatePrice");
  });

  it("403 → 摆「登录后可见报价」,不是摆一个空白的框", () => {
    const code = stripComments(read(PREVIEW));

    expect(code).toContain("response.status === 403");
    expect(code).toContain('{ kind: "hidden" }');
    expect(code).toContain('t("preview.signInRequired")');
  });

  it("支撑没算的时候明说「未计入」—— 那个价是偏低的", () => {
    const code = stripComments(read(PREVIEW));

    expect(code).toContain(
      "const supportPending = quote.supportWeightG === null"
    );
    expect(code).toContain('t("preview.supportPending")');
  });

  it("几何变了就重新报价 —— 支撑算出来之后金额会跟着变", () => {
    const code = stripComments(read(PREVIEW));

    // 依赖里有几何、**交期档位**和**优惠码** —— 换档位 / 换码都要重新问价
    // (优惠是订单级的,码变了金额就变了)
    expect(code).toContain("}, [input, deliveryTier, couponCode]);");
    expect(code).toContain("QUOTE_DEBOUNCE_MS");
  });

  it("报价弹窗里确实挂着这个预估报价", () => {
    const code = stripComments(read(QUOTE_DIALOG));

    expect(code).toContain("PrintServiceQuotePreview");
    expect(flat(code)).toContain("<PrintServiceQuotePreview input={input}");
  });

  it("访客也能看到那个数 —— 弹窗对没登录的人也摆报价", () => {
    const code = stripComments(read(QUOTE_DIALOG));

    // 报价预览在「有没有登录」那个分支**外面** —— 访客也看得到
    const previewAt = code.indexOf("<PrintServiceQuotePreview");
    const guestBranch = code.indexOf("isLoggedIn ? (");
    expect(previewAt).toBeGreaterThan(-1);
    expect(guestBranch).toBeGreaterThan(-1);
    // 预览在分支之前 ⇒ 访客路径也走得到它
    expect(previewAt).toBeLessThan(guestBranch);
  });
});
