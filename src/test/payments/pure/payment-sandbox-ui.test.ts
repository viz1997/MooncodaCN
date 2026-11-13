import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 支付**沙箱模式的界面提示**
 *
 * 文件扫描 —— 不需要 DB / 网络 / 浏览器。
 *
 * ## 这一层守的是「上线忘了关沙箱开关」
 *
 * 沙箱开关在后台 `/admin/payment-settings` 上,不在环境变量里 ⇒ **部署的
 * 那一刻看不出来**。忘了关 = **真客户的钱付到沙箱里**(钱收不到),而客户
 * 那边看着一切正常。
 *
 * ⇒ 提示必须出现在**用户能看见的地方**:
 *
 * - **每个沙箱通道一枚琥珀色徽章** —— 跟着通道走,一眼看见是哪个
 * - **列表上方一条提示条** —— 只要有**任何一个**通道在沙箱就摆
 *
 * ## 为什么徽章的颜色跟「暂未开放」那个灰的**要区分开**
 *
 * - 灰的「暂未开放」= **还没准备好**(点不了)
 * - 琥珀的「沙箱」= **在收真钱的那条路上**,现在跑的是假的
 *
 * 两件事的严重程度差着量级 —— 颜色混了,工作室会以为「反正还没开放」。
 *
 * ## 为什么徽章摆在「暂未开放」**前面**
 *
 * 徽章那一块是 `flex flex-wrap` —— 两个徽章同时出现时(通道在沙箱但还没配
 * 好凭据),沙箱那个在前面 ⇒ 先看见的是更严重的那个。
 */

const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把 JSON 里某个命名空间的叶子键列出来(点路径) */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("沙箱徽章 + 提示条", () => {
  it("通道清单带 `sandbox` 字段 —— 界面才知道该不该挂徽章", () => {
    const types = read("src/features/payments/lib/types.ts");

    // `PaymentChannelInfo` 上的那个字段
    expect(types).toMatch(
      /interface PaymentChannelInfo[\s\S]*?sandbox:\s*boolean/
    );
  });

  it("注册表把 `sandbox` 填进清单 —— 认不出来一律当「正式」", () => {
    const registry = read("src/features/payments/lib/registry.ts");

    expect(registry).toContain(
      "sandbox: await isChannelInSandbox(channel.channel)"
    );
    // 模式不明的时候**不许**摆沙箱徽章(那个通道本身就是禁用的)
    expect(registry).toContain("if (runtime.modeInvalid) return false;");
  });

  it("沙箱通道在服务端**说话** —— 一个进程一条横幅", () => {
    const registry = read("src/features/payments/lib/registry.ts");

    expect(registry).toContain("warnSandboxChannels(channels)");
    expect(registry).toMatch(/function warnSandboxChannels[\s\S]*?sandbox/);
  });

  it("provider 打**确切端点** —— 排查时一眼看出打到了哪个 URL", () => {
    for (const file of [
      "src/features/payments/providers/wechat/config.ts",
      "src/features/payments/providers/alipay/config.ts",
    ]) {
      const source = read(file);
      expect(source, file).toContain("logEndpointOnce");
      expect(source, file).toMatch(/沙箱(端点|网关)/);
    }
  });
});

describe("选择器 —— 徽章 + 提示条", () => {
  const picker = read(
    "src/features/payments/components/payment-channel-picker.tsx"
  );

  it("通道选项带 `sandbox` —— 缺的老响应按「正式」处理", () => {
    expect(picker).toMatch(/interface PaymentChannelOption[\s\S]*?sandbox\?:/);
    expect(picker).toContain("sandbox: c.sandbox === true");
  });

  it("有沙箱通道就摆提示条 —— 在列表**上方**", () => {
    expect(picker).toContain("channels.some((channel) => channel.sandbox)");
    expect(picker).toContain('tRoot("sandboxNotice")');
  });

  it("沙箱通道挂琥珀色徽章", () => {
    expect(picker).toContain('tRoot("sandboxBadge")');
    // 琥珀色 —— 跟「暂未开放」那个灰的区分开
    // (徽章的 className 写在 `sandboxBadge` **上面**那一行)
    expect(picker).toMatch(/amber-[\s\S]{0,400}?sandboxBadge/);
  });

  it("徽章摆在「暂未开放」**前面** —— 更严重的那个先看见", () => {
    const badgeIndex = picker.indexOf('tRoot("sandboxBadge")');
    const unavailableIndex = picker.indexOf('tRoot("unavailable")');

    expect(badgeIndex).toBeGreaterThan(-1);
    expect(unavailableIndex).toBeGreaterThan(-1);
    expect(badgeIndex).toBeLessThan(unavailableIndex);
  });

  it("徽章用 `flex-wrap` —— 两个徽章同时出现时不挤爆", () => {
    expect(picker).toContain("flex flex-wrap items-center gap-2");
  });
});

describe("i18n —— 沙箱那两条文案", () => {
  it("中英文都有 `sandboxBadge` / `sandboxNotice`", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(zh.Payment.sandboxBadge).toBeTruthy();
    expect(zh.Payment.sandboxNotice).toBeTruthy();
    expect(en.Payment.sandboxBadge).toBeTruthy();
    expect(en.Payment.sandboxNotice).toBeTruthy();
  });

  it("`Payment` 命名空间的中英文键一样 —— 少一个语言 = 那一侧全是 key 名", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(leafPaths(en.Payment).sort()).toEqual(leafPaths(zh.Payment).sort());
  });

  it("提示条文案说清「不会真的扣款」—— 客户不该以为自己付了钱", () => {
    const zh = JSON.parse(read("messages/zh.json"));

    expect(zh.Payment.sandboxNotice).toContain("沙箱");
    expect(zh.Payment.sandboxNotice).toContain("不会真的扣");
  });
});
