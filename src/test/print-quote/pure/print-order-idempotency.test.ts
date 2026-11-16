import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import {
  canonicalPrintOrderIntent,
  computePrintOrderIdempotencyKey,
  type PrintOrderIntent,
} from "@/features/print-quote/lib/idempotency";
import { computeModelUploadCacheKey } from "@/features/print-quote/lib/upload-cache";

/**
 * 打印工单建单**幂等**(2026-11-16)
 *
 * ## 要防的是哪一件事
 *
 * 「提交打印订单」这个按钮**没有**服务端幂等 —— 同一份请求发两次,就会建出
 * **两张工单**,两张各有各的付款入口 ⇒ **用户可能付两次钱**。
 *
 * 客户端那道软闸(提交中禁用按钮 + 限流 3 次/分钟)**挡不住**:网络卡了重试 /
 * 手抖双击 / 提交完没看到跳转又点一次。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 键是**内容哈希**(同一意图 ⇒ 同一把键) | 键含 `objectKey` ⇒ 每次上传都变 ⇒ 幂等**直接失效** |
 * | 键里**不含** `channel` / `objectKey` / `locale` | 换通道重下 ⇒ 两张单 ⇒ 付两次 |
 * | `supportWeightG` / `selfSupportRatio` **进键** | 它俩**参与定价** —— 变了就是另一个价 |
 * | 数字按**落库精度**归一 | 浮点差一丁点 ⇒ 键变了 ⇒ 幂等失效 |
 * | 查表放在**通道检查 / 券判定 / 报价计算之前** | 重试不该因为「券过期了」「通道挂了」而失败 |
 * | 幂等命中返 **200** + 复用**存下来的**付款入口 | 微信的 `code_url` **不能重建**(会被拒 `OUT_TRADE_NO_USED`) |
 * | 幂等命中**不发邮件、不重复记用券** | 用户收两封信、券的用量被加两遍 ⇒ 券被超发 |
 * | 唯一索引是**复合**的(`user_id` + 键) | 键是内容哈希 ⇒ 不同用户可能算出同一把 ⇒ 只索引键会顶掉别人的单 |
 * | 客户端**复用上一次的上传结果** | R2 桶**锁着对象** ⇒ 孤儿文件永久留在桶里 |
 *
 * 全部是纯函数 + 文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * 把注释去掉 —— 注释里写着「以前没有幂等」不算违规
 *
 * ⚠️ 仓库里所有「源码扫描」断言都跑在**去掉注释之后**的源码上 —— 文件头
 * 那一大段说明会让人看出假阳性。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const IDEMPOTENCY = "src/features/print-quote/lib/idempotency.ts";
const UPLOAD_CACHE = "src/features/print-quote/lib/upload-cache.ts";
const PRINT_ORDER_ROUTE = "src/app/api/print-orders/route.ts";
const ORDER_STORE = "src/features/print-quote/lib/order-store.ts";
const SCHEMA = "src/db/schema.ts";
const WEIGHT_TOOL =
  "src/features/print-quote/components/print-service-weight-tool.tsx";
const MIGRATION = "scripts/apply-print-order-idempotency-schema.ts";

/* ------------------------------------------------------------------ */
/*  夹具                                                                */
/* ------------------------------------------------------------------ */

/** 一份「下单意图」 */
function makeIntent(
  overrides: Partial<PrintOrderIntent> = {}
): PrintOrderIntent {
  return {
    modelFileName: "cat.zip",
    modelSizeBytes: 1234,
    volumeCM3: 12.3456,
    surfaceAreaCM2: 30.5,
    dims: [40, 30, 20],
    supportWeightG: 8.5,
    selfSupportRatio: 1.2,
    deliveryTier: "standard",
    reliefKind: "figurine",
    contactName: "张三",
    contactPhone: "13800000000",
    note: null,
    addressId: "addr_1",
    couponCode: null,
    ...overrides,
  };
}

/** 一份「模型载荷」(只需要上传缓存键要的那几个字段) */
function makePayload(
  overrides: Partial<PricingModelPayload> = {}
): PricingModelPayload {
  const model = {
    name: "cat",
    objFileName: "cat.obj",
    objText: "v 0 0 0\nv 1 0 0\nv 0 1 0\n",
  } as unknown as PricingModelPayload["model"];

  return {
    model,
    scales: [1, 1, 1],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  键怎么算                                                            */
/* ------------------------------------------------------------------ */

describe("建单幂等 —— 键是内容哈希", () => {
  it("同一份意图 ⇒ 同一把键", () => {
    expect(computePrintOrderIdempotencyKey(makeIntent())).toBe(
      computePrintOrderIdempotencyKey(makeIntent())
    );
  });

  it("键是 64 位十六进制(sha256)", () => {
    expect(computePrintOrderIdempotencyKey(makeIntent())).toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  it("摊平结果是**确定的**(键序不靠对象属性的顺序)", () => {
    expect(canonicalPrintOrderIntent(makeIntent())).toBe(
      canonicalPrintOrderIntent(makeIntent())
    );
    // 摊平结果里必须带版本号 —— 改了「哪些字段进键」的规则要 +1
    expect(canonicalPrintOrderIntent(makeIntent())).toContain(
      "print-order-intent-v1"
    );
  });

  it("**换几何就是另一单**", () => {
    const base = computePrintOrderIdempotencyKey(makeIntent());

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ volumeCM3: 12.3457 }))
    ).not.toBe(base);
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ dims: [41, 30, 20] }))
    ).not.toBe(base);
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ surfaceAreaCM2: 30.6 }))
    ).not.toBe(base);
  });

  it("**支撑克重进键** —— 它参与定价", () => {
    const base = computePrintOrderIdempotencyKey(makeIntent());

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ supportWeightG: 8.6 }))
    ).not.toBe(base);
  });

  it("**自支撑比例进键** —— 支撑加价按它分段(它不落库,但改一分价就不同)", () => {
    const base = computePrintOrderIdempotencyKey(makeIntent());

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ selfSupportRatio: 1.3 }))
    ).not.toBe(base);
  });

  it("**换交期档位就是另一个价** ⇒ 换键", () => {
    const base = computePrintOrderIdempotencyKey(makeIntent());

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ deliveryTier: "express" }))
    ).not.toBe(base);
  });

  it("**换优惠码就是另一个应付金额** ⇒ 换键", () => {
    const base = computePrintOrderIdempotencyKey(makeIntent());

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ couponCode: "SAVE10" }))
    ).not.toBe(base);
  });

  it("优惠码**大小写归一** —— 用户输入不区分大小写", () => {
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ couponCode: "save10" }))
    ).toBe(
      computePrintOrderIdempotencyKey(makeIntent({ couponCode: " SAVE10 " }))
    );
  });

  it("**认不出来的交期档位一律标准档** —— 跟 `delivery-tier.ts` 一个口径", () => {
    expect(
      computePrintOrderIdempotencyKey(
        makeIntent({ deliveryTier: "URGENT " as never })
      )
    ).toBe(
      computePrintOrderIdempotencyKey(makeIntent({ deliveryTier: "standard" }))
    );
  });

  it("**联系信息 / 地址**变了就是另一单", () => {
    const base = computePrintOrderIdempotencyKey(makeIntent());

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ addressId: "addr_2" }))
    ).not.toBe(base);
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ contactName: "李四" }))
    ).not.toBe(base);
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ note: "快点做" }))
    ).not.toBe(base);
  });
});

/* ------------------------------------------------------------------ */
/*  键里放什么 / 不放什么                                                */
/* ------------------------------------------------------------------ */

describe("建单幂等 —— 键里放什么 / 不放什么", () => {
  it("**不含** `objectKey` / `modelUrl` —— 每次上传都变,放了就幂等失效", () => {
    const source = stripComments(read(IDEMPOTENCY));

    expect(source).not.toContain("objectKey");
    expect(source).not.toContain("modelUrl");
  });

  it("**不含** `channel` —— 换通道重下也是同一单(防「付两次」)", () => {
    const source = stripComments(read(IDEMPOTENCY));

    expect(source).not.toContain("channel");
  });

  it("**不含** `locale` —— 只影响邮件语言,不影响订单本身", () => {
    const source = stripComments(read(IDEMPOTENCY));

    expect(source).not.toContain("locale");
  });

  it("**不含** `objectKey` / `modelUrl` ⇒ 客户端**一个字都不用改**", () => {
    // 客户端那层 POST 的 body 里带 objectKey / modelUrl —— 服务端算键时
    // 故意**不取**它们 ⇒ 客户端不用传幂等键
    const source = stripComments(read(IDEMPOTENCY));

    expect(source).not.toContain("objectKey");
    expect(source).not.toContain("modelUrl");
  });

  it("这一层是**纯函数** —— 不许 import `@/db` / `drizzle-orm`", () => {
    const source = stripComments(read(IDEMPOTENCY));

    expect(source).not.toContain("@/db");
    expect(source).not.toContain("drizzle-orm");
  });
});

/* ------------------------------------------------------------------ */
/*  浮点归一                                                            */
/* ------------------------------------------------------------------ */

describe("建单幂等 —— 数字按落库精度归一", () => {
  it("**落库精度以下**的差异算同一单", () => {
    // 体积落在 `numeric(12,4)` —— 第五位小数落库时会被抹掉
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ volumeCM3: 12.345678 }))
    ).toBe(
      computePrintOrderIdempotencyKey(makeIntent({ volumeCM3: 12.3456789 }))
    );

    // 尺寸落在 `numeric(12,3)`
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ dims: [40.0004, 30, 20] }))
    ).toBe(
      computePrintOrderIdempotencyKey(makeIntent({ dims: [40.00049, 30, 20] }))
    );
  });

  it("**落库精度以上**的差异是另一单(价真的会不同)", () => {
    expect(
      computePrintOrderIdempotencyKey(makeIntent({ volumeCM3: 12.3456 }))
    ).not.toBe(
      computePrintOrderIdempotencyKey(makeIntent({ volumeCM3: 12.3457 }))
    );
  });

  it("**NaN / 无穷大**不当成「跟别的值一样」", () => {
    const base = computePrintOrderIdempotencyKey(makeIntent());

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ volumeCM3: Number.NaN }))
    ).not.toBe(base);
    expect(
      computePrintOrderIdempotencyKey(
        makeIntent({ supportWeightG: Number.POSITIVE_INFINITY })
      )
    ).not.toBe(base);
  });

  it("`null` 和「没值」是**同一件事** —— 支撑没算 vs 没传", () => {
    // 「压根没这个字段」跟「这个字段是 null」在键里必须一样
    //
    // ⚠️ `exactOptionalPropertyTypes` 开着 —— 不能写 `{ supportWeightG: undefined }`
    // (`Partial<T>` 在这个开关下不接受显式的 undefined)⇒ 这里造一个**真的没有
    // 那个键**的对象。
    const missing = { ...makeIntent() } as Partial<PrintOrderIntent>;
    delete missing.supportWeightG;

    expect(
      computePrintOrderIdempotencyKey(makeIntent({ supportWeightG: null }))
    ).toBe(computePrintOrderIdempotencyKey(missing as PrintOrderIntent));
  });
});

/* ------------------------------------------------------------------ */
/*  服务端那条路                                                        */
/* ------------------------------------------------------------------ */

describe("建单幂等 —— 服务端认单", () => {
  it("查表放在**通道检查 / 券判定 / 报价计算之前**", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    // ⚠️ 断言跑在**正则**上,不是精确字符串 ——
    // `biome --write` 会把「两个参数的调用」拆成多行,精确字符串断言会当场
    // 被打红(那不是代码坏了,是格式变了)。
    const lookup = code.search(
      /const existing = await findPrintOrderByIdempotencyKey\(\s*user\.id,\s*idempotencyKey\s*\)/
    );
    expect(lookup).toBeGreaterThan(-1);

    // 重试不该因为「R2 现在没配好」「通道临时挂了」「券过期了」而失败
    expect(code.indexOf("isR2Configured()")).toBeGreaterThan(lookup);
    expect(
      code.indexOf("isPaymentChannelEnabled(parsed.data.channel)")
    ).toBeGreaterThan(lookup);
    expect(code.indexOf("evaluateCoupon(")).toBeGreaterThan(lookup);
    expect(
      code.search(/computePrintQuote\(\s*settings,\s*input\.quote\s*\)/)
    ).toBeGreaterThan(lookup);
    expect(code.indexOf("getUserAddress(user.id")).toBeGreaterThan(lookup);
  });

  it("幂等命中返 **200** —— 这一单**已经建好了**", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    expect(code).toContain("respondWithExistingPrintOrder");
    // 命中那条路是 200;首次建单是 201
    expect(code).toContain("{ status: 200, headers: getRateLimitHeaders(rl) }");
    expect(code).toContain("{ status: 201, headers: getRateLimitHeaders(rl) }");
  });

  it("幂等命中**复用存下来的付款入口** —— 微信的码不能重建", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    // 付款入口取**行上的值**,不是新建一个会话
    expect(code).toContain("paymentUrl: row.paymentUrl");
    expect(code).toContain("paymentQrCodeUrl: row.paymentQrCodeUrl");
    expect(code).toContain("paymentChannel: row.paymentChannel");
    // 支付状态用**行上的真值**(首次建单那处是硬编码 unpaid)
    expect(code).toContain("paymentStatus: row.paymentStatus");
  });

  it("幂等命中**不发邮件、不重复记用券**", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    // 那条路直接 return —— 不落进 `after(...)` 也不落进事务
    const hit = code.indexOf("return await respondWithExistingPrintOrder");
    const mail = code.indexOf("notifyPrintOrderCreated(");
    const redeem = code.indexOf("redeemCoupon(");
    expect(hit).toBeGreaterThan(-1);
    expect(mail).toBeGreaterThan(hit);
    expect(redeem).toBeGreaterThan(hit);
  });

  it("唯一索引撞了 ⇒ **先回查**再决定返 200 还是 409", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    expect(code).toContain("isUniqueViolation(error)");
    // 正则(不是精确字符串)—— `biome --write` 会把这个调用拆成多行
    expect(code).toMatch(
      /const raced = await findPrintOrderByIdempotencyKey\(\s*user\.id,\s*idempotencyKey\s*\)/
    );
    expect(code).toContain('error: "ORDER_NO_CONFLICT"');
  });

  it("**幂等键写进工单**", () => {
    const code = stripComments(read(PRINT_ORDER_ROUTE));

    expect(code).toContain("idempotencyKey,");
  });
});

/* ------------------------------------------------------------------ */
/*  数据层                                                              */
/* ------------------------------------------------------------------ */

describe("建单幂等 —— 数据层", () => {
  it("表上有**幂等键**这一列 + 一个**复合**唯一索引", () => {
    const code = stripComments(read(SCHEMA));

    expect(code).toContain('idempotencyKey: text("idempotency_key")');
    // 复合:键是内容哈希,不同用户可能算出同一把 ⇒ 只索引键会顶掉别人的单
    expect(code).toContain(
      'uniqueIndex("print_order_idempotency_key_uniq_idx")'
    );
    expect(code).toContain("t.userId,");
    expect(code).toContain("t.idempotencyKey");
  });

  it("**归属校验在 WHERE 里** —— 键是内容哈希,不同用户可能算出同一把", () => {
    const code = stripComments(read(ORDER_STORE));

    expect(code).toContain("findPrintOrderByIdempotencyKey");
    // 正则(不是精确字符串)—— 格式化会把这两行拆开
    expect(code).toMatch(/eq\(printOrder\.userId,\s*userId\)/);
    expect(code).toMatch(/eq\(printOrder\.idempotencyKey,\s*idempotencyKey\)/);
  });

  it("insert 把**幂等键**写进去", () => {
    const code = stripComments(read(ORDER_STORE));

    expect(code).toContain("idempotencyKey: input.idempotencyKey ?? null");
  });
});

/* ------------------------------------------------------------------ */
/*  客户端:重试不留孤儿文件                                             */
/* ------------------------------------------------------------------ */

describe("建单幂等 —— 客户端重试不留孤儿 R2 对象", () => {
  it("上传缓存的键 = 「这份 zip 的内容」的指纹", () => {
    const base = computeModelUploadCacheKey(makePayload());

    // 换模型 ⇒ 换键
    expect(
      computeModelUploadCacheKey(
        makePayload({
          model: {
            name: "dog",
            objFileName: "dog.obj",
            objText: "v 0 0 0\nv 1 0 0\nv 0 1 0\n",
          } as unknown as PricingModelPayload["model"],
        })
      )
    ).not.toBe(base);

    // 改尺寸 ⇒ 换键(zip 里的坐标变了)
    expect(
      computeModelUploadCacheKey(makePayload({ scales: [2, 1, 1] }))
    ).not.toBe(base);
    expect(
      computeModelUploadCacheKey(makePayload({ scales: [1, 2, 1] }))
    ).not.toBe(base);
    expect(
      computeModelUploadCacheKey(makePayload({ scales: [1, 1, 2] }))
    ).not.toBe(base);
  });

  it("同一个模型 + 同一组缩放 ⇒ **同一把键**(重试不重传)", () => {
    expect(computeModelUploadCacheKey(makePayload())).toBe(
      computeModelUploadCacheKey(makePayload())
    );
  });

  it("这一层是**纯函数** —— 不许 import `@/db` / `drizzle-orm` / `node:`", () => {
    const source = stripComments(read(UPLOAD_CACHE));

    expect(source).not.toContain("@/db");
    expect(source).not.toContain("drizzle-orm");
    expect(source).not.toContain('from "node:');
  });

  it("工具页**复用**上一次的上传结果", () => {
    const code = stripComments(read(WEIGHT_TOOL));

    expect(code).toContain("computeModelUploadCacheKey");
    expect(code).toContain("uploadCacheRef");
    // 走缓存的那条路
    expect(code).toContain(
      "if (cached && cached.key === key) return cached.result;"
    );
    // 提交时用的是**带缓存**的那个
    expect(code).toContain("await uploadModelFileCached(model)");
  });
});

/* ------------------------------------------------------------------ */
/*  迁移脚本                                                            */
/* ------------------------------------------------------------------ */

describe("建单幂等 —— 迁移脚本", () => {
  it("幂等(加列 / 建索引都是 IF NOT EXISTS)", () => {
    const code = stripComments(read(MIGRATION));

    expect(code).toContain("ADD COLUMN IF NOT EXISTS");
    expect(code).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
  });

  it("**不播种任何一行** —— 跑完线上行为一个字节都不变", () => {
    const code = stripComments(read(MIGRATION));

    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(code).not.toMatch(/\bUPDATE\b/i);
  });

  it("支持 `--dry-run`(只打印 SQL,不连库)", () => {
    const code = stripComments(read(MIGRATION));

    expect(code).toContain("--dry-run");
    expect(code).toContain("DRY_RUN");
  });

  it("索引是**复合**的 —— `user_id` + `idempotency_key`", () => {
    const code = stripComments(read(MIGRATION));

    expect(code).toContain('ON "print_order" ("user_id", "idempotency_key")');
  });
});
