import { describe, expect, it } from "vitest";

/**
 * 「加入购物袋」失败 —— code 翻译成人话。
 *
 * ## 为什么值得测
 *
 * 2026-11-08 线上踩过一次:生产库的 `cart` 表少了 `kind` 那一列 → 加行
 * 接口 500 → 界面上只摆「加入打印单失败,请稍后重试」。**那句话把真原因
 * 盖住了** —— 排查靠的是翻 R2 看有没有留下对象(上传在加购之前,所以文件
 * 进了桶,加行却炸了)。
 *
 * 从那以后,服务端每次失败都带一个稳定的 `code`,前端按 code 查文案表。
 * 这层映射写错了 = 用户看到的还是那句「请稍后重试」,或者更糟:摆一句
 * **对不上原因**的话(比如「模型文件没找到」,其实是数据库的问题)。
 *
 * ## 守住三件事
 *
 * 1. **code → 文案 key 的映射不认错** —— 每个 code 都得有一句人话
 * 2. **认不出来的 code 退回 `null`** —— 界面退回笼统那句,不崩
 * 3. **服务端两种错误约定都认** —— `error` 字段有人话版(上传地址那个
 *    路由)和码版(加行那个路由)
 *
 * ## 依赖
 *
 * 全是纯函数,不碰 DB、不碰 React —— 跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 */

import {
  PRINT_ORDER_ERROR_KEYS,
  printOrderErrorMessageKey,
} from "@/features/print-quote/lib/print-order-error";
import {
  extractErrorCode,
  extractErrorMessage,
  RequestError,
  toRequestError,
} from "@/features/shared/lib/request-error";

describe("服务端 code 的提取", () => {
  it("优先认 code 字段", () => {
    expect(
      extractErrorCode({ error: "R2 未配置", code: "R2_NOT_CONFIGURED" })
    ).toBe("R2_NOT_CONFIGURED");
  });

  it("error 字段是码形状时也认(加行那个路由的约定)", () => {
    expect(extractErrorCode({ error: "MODEL_NOT_FOUND" })).toBe(
      "MODEL_NOT_FOUND"
    );
  });

  it("error 字段是人话时不认成码", () => {
    // 「R2 未配置」不是码 —— 当成码去查文案表会查不到
    expect(extractErrorCode({ error: "R2 未配置" })).toBeNull();
  });

  it("不是对象 / 没有码 → null", () => {
    expect(extractErrorCode(null)).toBeNull();
    expect(extractErrorCode("boom")).toBeNull();
    expect(extractErrorCode({})).toBeNull();
    expect(extractErrorCode({ code: 42 })).toBeNull();
  });
});

describe("人话的提取", () => {
  it("message 优先", () => {
    expect(
      extractErrorMessage(
        { error: "MODEL_NOT_FOUND", message: "模型没找到" },
        404
      )
    ).toBe("模型没找到");
  });

  it("没有 message 时拿人话版的 error", () => {
    expect(extractErrorMessage({ error: "R2 未配置" }, 503)).toBe("R2 未配置");
  });

  it("error 是码形状时不当人话用 —— 退回 HTTP 状态", () => {
    // 「MODEL_NOT_FOUND」给用户看没意义,「HTTP 404」也没意义,但前者是
    // 机器码,不该出现在界面上
    expect(extractErrorMessage({ error: "MODEL_NOT_FOUND" }, 404)).toBe(
      "HTTP 404"
    );
  });

  it("什么都没有 → HTTP <状态码>", () => {
    expect(extractErrorMessage(null, 500)).toBe("HTTP 500");
    expect(extractErrorMessage({}, 502)).toBe("HTTP 502");
  });
});

describe("toRequestError", () => {
  it("把 body + 状态码变成带 code 的错误", () => {
    const err = toRequestError(
      { error: "MODEL_NOT_FOUND", message: "模型没找到" },
      404
    );
    expect(err).toBeInstanceOf(RequestError);
    expect(err.code).toBe("MODEL_NOT_FOUND");
    expect(err.message).toBe("模型没找到");
    expect(err.status).toBe(404);
  });
});

describe("code → 文案 key 的映射", () => {
  it("认得的 code 给出对应的 key", () => {
    expect(
      printOrderErrorMessageKey(new RequestError("x", 404, "MODEL_NOT_FOUND"))
    ).toBe("printOrder.errors.codes.modelNotFound");
  });

  it("几个关键 code 都得有人话(别忘了任何一个)", () => {
    // 这些是线上真出过的 / 会出的
    for (const code of [
      "AUTH_REQUIRED",
      "R2_NOT_CONFIGURED",
      "MODEL_NOT_FOUND",
      "CART_NOT_FOUND",
      "ADD_LINE_ITEM_FAILED",
    ]) {
      expect(PRINT_ORDER_ERROR_KEYS[code]).toBeTruthy();
    }
  });

  it("「加错车」这个 code 没有了 —— 2026-11-08 起只有一张车", () => {
    // 打印服务并进商城购物袋之后,不存在「放错车」这回事。
    // 这个 code 留在表里的话,界面会摆一句指向已经不存在的打印单页面的话。
    expect(PRINT_ORDER_ERROR_KEYS.CART_KIND_MISMATCH).toBeUndefined();
  });

  it("认不出来的 code → null(界面退回笼统那句)", () => {
    expect(
      printOrderErrorMessageKey(new RequestError("x", 500, "SOMETHING_NEW"))
    ).toBeNull();
  });

  it("没有 code 的错误 → null", () => {
    expect(printOrderErrorMessageKey(new RequestError("boom", 500))).toBeNull();
  });

  it("不是 RequestError → null", () => {
    expect(printOrderErrorMessageKey(new Error("boom"))).toBeNull();
    expect(printOrderErrorMessageKey("boom")).toBeNull();
    expect(printOrderErrorMessageKey(undefined)).toBeNull();
  });
});
