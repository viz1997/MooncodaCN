import { describe, expect, it, vi } from "vitest";

/**
 * 收货地址的入参校验测试。
 *
 * 纯校验:`zod` 的 schema,不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个必须测
 *
 * 地址是**小程序跟后端之间的契约** —— 小程序 POST `/api/store/addresses`
 * 提交的就是这些字段。后端改了校验规则而没人知道,小程序那边就会开始
 * 收到 400,而且是在用户填完一整张表之后才炸。
 *
 * 校验规则散在 `mutations.ts` 里(Web 的 server action 和小程序的 HTTP
 * 路由共用同一份),改一处两边都变 —— 所以规则本身要有测试钉住。
 *
 * ## mock 掉 `@/db`
 *
 * `mutations.ts` 顶层 import 了 `@/db`,而 `src/db/index.ts` 在
 * `DATABASE_URL` 没配的时候会**在 import 时就抛**。这里只需要 schema,
 * 不需要真的数据库,所以把 `@/db` mock 成一个空壳。
 */

vi.mock("@/db", () => ({ db: {} }));

const { createAddressSchema, MAX_ADDRESSES, phoneSchema, updateAddressSchema } =
  await import("@/features/address/mutations");

/** 一份合法的地址 */
const valid = {
  recipientName: "张三",
  phone: "13800138000",
  province: "广东省",
  city: "深圳市",
  district: "南山区",
  detail: "科技园路 1 号 3 栋 502",
};

describe("收货地址校验", () => {
  describe("手机号", () => {
    it("国内手机号通过", () => {
      expect(phoneSchema.safeParse("13800138000").success).toBe(true);
    });

    it("带区号 / 座机的写法也收", () => {
      expect(phoneSchema.safeParse("+86 138 0013 8000").success).toBe(true);
      expect(phoneSchema.safeParse("0755-88886666").success).toBe(true);
    });

    it("空 / 太短 / 夹字母的不通过", () => {
      expect(phoneSchema.safeParse("").success).toBe(false);
      expect(phoneSchema.safeParse("138").success).toBe(false);
      expect(phoneSchema.safeParse("138abc38000").success).toBe(false);
    });
  });

  describe("新建地址", () => {
    it("完整地址通过", () => {
      expect(createAddressSchema.safeParse(valid).success).toBe(true);
    });

    it("district 可以不填(有些地址没有区)", () => {
      const result = createAddressSchema.safeParse({
        ...valid,
        district: undefined,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        // 缺省 district 落成空串,不是 undefined
        expect(result.data.district).toBe("");
      }
    });

    it("必填字段缺一个都不行", () => {
      // district 是唯一的可选字段(有些地址没有区),单独测过了
      const required = Object.keys(valid).filter(
        (key) => key !== "district"
      ) as (keyof typeof valid)[];
      for (const key of required) {
        const result = createAddressSchema.safeParse({
          ...valid,
          [key]: "",
        });
        expect(result.success, `缺 ${key} 应该不通过`).toBe(false);
      }
    });

    it("isDefault 不传也行(第一条地址自动成默认)", () => {
      const result = createAddressSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDefault).toBeUndefined();
      }
    });
  });

  describe("改地址", () => {
    it("要带 addressId", () => {
      expect(
        updateAddressSchema.safeParse({ ...valid, addressId: "addr_1" }).success
      ).toBe(true);
      expect(updateAddressSchema.safeParse(valid).success).toBe(false);
    });
  });

  it("一个人最多存 20 个地址", () => {
    expect(MAX_ADDRESSES).toBe(20);
  });
});
