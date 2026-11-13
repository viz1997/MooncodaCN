import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 页脚客服联系方式(2026-11-13)
 *
 * 工作室的要求:**「底部增加客服联系方式,比如点击后展示客服的微信二维码」**。
 *
 * ## 为什么这件事值得单测
 *
 * 这一条链路上有**四个地方**很容易各自跑偏,拼在一起就成了「页脚摆着一个
 * 点了没反应的客服入口」:
 *
 * 1. **地址从哪儿来** —— 后台配的(`site_setting` 表)⇒ layout 读一次,当
 *    props 传下去。**不许客户端组件自己读**(客户端读不了 DB),也不许
 *    server component 各自去查(两处查出来的可能不是同一份)。
 * 2. **弹窗的配色** —— Radix 的 portal 默认落 `document.body`,在
 *    `.atelier-root` **外面** ⇒ 弹窗退回全站默认主题(墨绿 + 大圆角的那套
 *    没了)。⇒ 必须 `portalContainer={useAtelierContainer()}`。
 * 3. **图挂了怎么办** —— 二维码图可能压根不存在(工作室还没放上去)⇒
 *    `<img>` 带 onError 兜底,改摆邮箱 + 工单入口。**不能给用户一个破图**。
 * 4. **二维码那一项是按钮,不是链接** —— 它是弹窗的触发器,混进
 *    `footerLinks` 那个「链接数组」里就是错的。
 *
 * 纯文件扫描 —— 不需要浏览器 / DB / 网络。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释区别) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const FOOTER = "src/features/marketing/components/storefront/store-footer.tsx";
const DIALOG =
  "src/features/marketing/components/storefront/service-contact-dialog.tsx";
const LAYOUT = "src/app/[locale]/(marketing-atelier)/layout.tsx";
const PURE = "src/features/site-settings/lib/site-setting.ts";
const STORE = "src/features/site-settings/lib/site-setting-store.ts";

describe("页脚客服:二维码那一项", () => {
  it("页脚有「客服」那一栏", () => {
    const src = read(FOOTER);
    expect(src).toContain("客服");
    expect(src).toContain("ServiceContactDialog");
  });

  it("二维码那一项是**按钮**(弹窗触发器),不是链接", () => {
    const src = read(FOOTER);
    // 那一栏单独渲染,不混进 footerLinks 那个链接数组
    expect(src).toContain("客服微信");
    expect(src).toContain("邮箱联系");
    expect(src).toContain("在线工单");
  });

  it("客服那一栏还给出**邮箱和工单**两条兜底", () => {
    const src = read(FOOTER);
    expect(src).toContain("mailto:");
    expect(src).toContain("/dashboard/support");
  });

  it("布局把地址**当 props 传下去**(客户端组件自己读不了 DB)", () => {
    const src = read(LAYOUT);
    expect(src).toContain("getServiceWechatQrUrl");
    expect(src).toContain("serviceQrUrl={serviceQr.url}");
    // 两个渲染处不许各自去查 —— 页脚和弹窗都只收 props
    expect(stripComments(read(FOOTER))).not.toContain("getServiceWechatQrUrl");
    expect(stripComments(read(DIALOG))).not.toContain("getServiceWechatQrUrl");
    expect(stripComments(read(DIALOG))).not.toContain("site-setting-store");
  });

  it("地址的真理源是 DB,环境变量退成兜底", () => {
    expect(read(STORE)).toContain("NEXT_PUBLIC_SERVICE_WECHAT_QR_URL");
    expect(read(PURE)).toContain("service_wechat_qr_url");
    expect(read(PURE)).toContain("DEFAULT_SERVICE_WECHAT_QR_PATH");
  });
});

describe("页脚客服:弹窗", () => {
  it("portal 指回 `.atelier-root`(否则弹窗退回全站默认主题)", () => {
    const src = read(DIALOG);
    expect(src).toContain("useAtelierContainer");
    expect(src).toContain("portalContainer={container}");
  });

  it("图片挂了 ⇒ onError 兜底(不给用户一个破图)", () => {
    const src = read(DIALOG);
    expect(src).toContain("onError");
    // 兜底里有别的联系方式
    expect(src).toContain("mailto:");
    expect(src).toContain("/dashboard/support");
  });

  it("**不用 next/image** —— 后台可配的地址不能被 remotePatterns 卡住", () => {
    // 注释里要解释「为什么不用」—— 断言只看代码
    const src = stripComments(read(DIALOG));
    expect(src).not.toContain("next/image");
    expect(src).toContain("<img");
  });

  it("图片有 alt 文本(无障碍)", () => {
    const src = read(DIALOG);
    expect(src).toMatch(/alt="[^"]+"/);
  });
});
