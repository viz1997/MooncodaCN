import { describe, expect, it } from "vitest";
import { supportCacheKey } from "@/features/pricing/lib/support-cache-key";

/**
 * 支撑缓存键(2026-11-10)
 *
 * 支撑**自动**算之后,「手上这份支撑是按哪组参数算出来的」就成了一个
 * 必须说得清的问题 —— 说不清就会出现两种事故:
 *
 * 1. **少收钱** —— 用户改完尺寸直接提交,发上去的是**旧尺寸**的支撑克重,
 *    服务端按 `input.supportWeightG ?? 0` 算 ⇒ 支撑费收少了。
 * 2. **画面跟数字对不上** —— 屏幕上摆着旧姿态的支撑,数字却说是新姿态的。
 *
 * 这把键就是「这组参数」的身份证:**尺寸 + 姿态**。
 *
 * ## 为什么取三位小数
 *
 * 拖旋转控制器时角度是连续的浮点数 —— 每帧差 0.0001° 是常事。要是照搬
 * 进去,拖一下鼠标就能触发几十次「参数变了 ⇒ 重算」,Worker 队列直接满,
 * 数字也一直跳(工作室 2026-11-07 明说要的:拖的时候数字别跳)。
 *
 * 三位小数 = 0.001° 的容差 —— 比任何一次真实拖动的最小步长都小,又比
 * 浮点噪声大得多。
 */

/** 三位小数 —— 跟模块里那份一样(这里单独写一份是为了让测试**独立**) */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

describe("支撑缓存键 —— 尺寸 + 姿态的身份证", () => {
  it("同样的姿态 + 同样的尺寸 ⇒ 同一个键", () => {
    const a = supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1]);
    const b = supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1]);

    expect(a).toBe(b);
  });

  it("改一个尺寸 ⇒ 不同的键(旧尺寸的支撑不许再用)", () => {
    const base = supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1]);

    expect(supportCacheKey({ x: 0, y: 0, z: 0 }, [1.2, 1, 1])).not.toBe(base);
    expect(supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1.2, 1])).not.toBe(base);
    expect(supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1.2])).not.toBe(base);
  });

  it("改一个角度 ⇒ 不同的键", () => {
    const base = supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1]);

    expect(supportCacheKey({ x: 30, y: 0, z: 0 }, [1, 1, 1])).not.toBe(base);
    expect(supportCacheKey({ x: 0, y: 30, z: 0 }, [1, 1, 1])).not.toBe(base);
    expect(supportCacheKey({ x: 0, y: 0, z: 30 }, [1, 1, 1])).not.toBe(base);
  });

  it("浮点抖动(0.0001°)算**同一个**键 —— 拖一下鼠标不该触发几十次重算", () => {
    const a = supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1]);
    const b = supportCacheKey({ x: 0.0001, y: 0, z: 0 }, [1, 1, 1]);

    expect(b).toBe(a);
  });

  it("真正的角度变化(0.01°)算**不同的**键", () => {
    const a = supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1]);
    const b = supportCacheKey({ x: 0.01, y: 0, z: 0 }, [1, 1, 1]);

    expect(b).not.toBe(a);
  });

  it("姿态和尺寸**都**参与了键 —— 不会撞", () => {
    // 姿态变了但尺寸没变 ⇒ 键变
    expect(supportCacheKey({ x: 45, y: 0, z: 0 }, [1, 1, 1])).not.toBe(
      supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1])
    );
    // 尺寸变了但姿态没变 ⇒ 键变
    expect(supportCacheKey({ x: 0, y: 0, z: 0 }, [2, 1, 1])).not.toBe(
      supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1])
    );
  });

  it("键里带着**取整后**的数 —— 同一个键对应同一组参数", () => {
    const key = supportCacheKey({ x: 12.34567, y: 0, z: 0 }, [1.23456, 1, 1]);

    expect(key).toContain(String(round3(12.34567)));
    expect(key).toContain(String(round3(1.23456)));
    // 未取整的原始值不许漏进键里
    expect(key).not.toContain("12.34567");
  });

  it("缺省的尺寸按 1 算 —— 跟 `appliedScales` 的默认一致", () => {
    // 缩放因子列表短了 / 空了 ⇒ 按 1(没缩放)算,跟 `[1,1,1]` 是同一组参数
    expect(supportCacheKey({ x: 0, y: 0, z: 0 }, [])).toBe(
      supportCacheKey({ x: 0, y: 0, z: 0 }, [1, 1, 1])
    );
  });
});
