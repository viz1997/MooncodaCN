#!/usr/bin/env -S npx tsx

/**
 * 更新 Sellbase 店铺设置(2026-11-05)
 *
 * ## 改什么
 *
 * `PATCH /v1/store`(scope `settings:write`)能改店铺的字段。现在用它改
 * `contact_email` —— **店铺自己的**联系邮箱,不是某个订单里顾客的邮箱。
 *
 * 它出现在:Sellbase 自己发的确认邮件 / 收据、订单详情页、「预约」的组织者
 * 栏位。留 null 的话那些地方就是空的。
 *
 * ## 为什么走 API 而不是直接 UPDATE
 *
 * 店铺行在共享库的 `sellbase.stores` 里,直连 SQL 也能改。走 API 的好处:
 * schema 校验 + 审计日志(`audit_actor_type = 'token'`),跟「在 Sellbase
 * 后台里手改」是同一条路径 —— 两边不会打架。
 *
 * ## 幂等
 *
 * 值一样就**不发** PATCH。跑几遍都是同一个结果。
 *
 * ## 用法
 *
 * ```bash
 * pnpm tsx scripts/update-sellbase-store.ts                          # 只看当前值
 * pnpm tsx scripts/update-sellbase-store.ts --contact-email a@b.com  # 改
 * ```
 *
 * ⚠️ **别把 admin token 贴进聊天** —— 这个脚本只打印店铺字段,不碰 token。
 */

import "./lib/load-env";

import { callSellbase, getSellbaseAdmin } from "@/features/sellbase/lib/client";

/** `--contact-email xxx` → 值 */
function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const client = getSellbaseAdmin();

  const before = await callSellbase(() => client.request("storeGet", {}));
  console.log(
    `[update-sellbase-store] 当前:contact_email = ${before.contact_email ?? "(null)"} · ` +
      `name = ${before.name} · currency = ${before.default_currency}`
  );

  const contactEmail = readFlag("contact-email");
  if (!contactEmail) {
    console.log(
      "[update-sellbase-store] 没给 --contact-email —— 只读模式,不改。"
    );
    return;
  }

  if (!contactEmail.includes("@")) {
    console.error(
      `[update-sellbase-store] "${contactEmail}" 不像个邮箱 —— 不改。`
    );
    process.exit(1);
  }

  if (before.contact_email === contactEmail) {
    console.log("[update-sellbase-store] 已经是这个值了 —— 不发 PATCH。");
    return;
  }

  const updated = await callSellbase(() =>
    client.request("storeUpdate", {
      body: { contact_email: contactEmail },
    })
  );

  // 回读一次 —— 确认真的写进去了,而不是接口说成功就当成功
  const after = await callSellbase(() => client.request("storeGet", {}));
  console.log(
    `[update-sellbase-store] 改完:contact_email = ${after.contact_email ?? "(null)"}`
  );

  if (after.contact_email !== contactEmail) {
    console.error(
      "[update-sellbase-store] 回读的值跟要写的不一样 —— 没生效,查一下。"
    );
    process.exit(1);
  }
  if (updated.contact_email !== contactEmail) {
    console.error(
      "[update-sellbase-store] PATCH 的响应里值就不对 —— 接口那边有问题。"
    );
    process.exit(1);
  }
  console.log("[update-sellbase-store] ✅ 完成");
}

main().catch((error) => {
  console.error("[update-sellbase-store] 失败:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
