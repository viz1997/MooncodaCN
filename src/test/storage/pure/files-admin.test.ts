import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { printOrderScope } from "@/features/print-quote/lib/upload-key";
import {
  buildOwnerIndex,
  resolveFileOwner,
} from "@/features/storage/admin/lib/owner-map";
import {
  buildBreadcrumb,
  fileExt,
  fileKind,
  folderName,
  isImageKey,
  normalizeObjectKey,
  normalizePrefix,
  parentPrefix,
  printOrderScopeFromKey,
  rawUserIdFromKey,
} from "@/features/storage/admin/lib/paths";

/**
 * 后台文件管理 —— `/admin/files`(2026-11-08)
 *
 * 工作室的所有文件都落在 Cloudflare R2 的一个桶里。以前**除了看工单,没有任何
 * 办法看这个桶** —— 后台打印订单页只给一条裸链接,没有下载、没有复制,连
 * `objectKey` 都不露。
 *
 * 这一页是整个桶的浏览器:进目录、复制链接、下载、预览、删除、显示归属。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 列的是 **R2 桶**(`R2_*`),不是头像桶(`STORAGE_*`) | 走错桶 = 页面空着,工作室以为文件没了 |
 * | 前缀 / 对象键在**服务端**校验 | 客户端能传任意路径,键还会进日志、进界面 |
 * | 删除把 `ObjectLockedByBucketPolicy` 映射成 `R2_DELETE_BLOCKED` | 界面上要说的是人话,不是「服务器错误」 |
 * | 归属用的是 `printOrderScope`(同一个 sha256) | 自己另写一份 = 对不上,谁也认不出谁 |
 * | `"use server"` 文件**不 re-export 类型** | Turbopack 会 ReferenceError,整页 500 |
 * | `messages/zh.json` + `messages/en.json` 的 `AdminFiles` 键一样 | 少一个语言 = 那一侧全是 key 名 |
 * | 归属认得三种键形状 | 纯函数,可以直接断言 |
 *
 * 全部是文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前没有这个页」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 递归列出一个对象的所有叶子键路径 */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      out.push(...leafPaths(v, prefix ? `${prefix}.${k}` : k));
    }
    return out;
  }
  return [prefix];
}

const ACTIONS = "src/features/storage/admin/actions.ts";
const ERRORS = "src/features/storage/admin/lib/errors.ts";
const OWNER_MAP = "src/features/storage/admin/lib/owner-map.ts";
const PATHS = "src/features/storage/admin/lib/paths.ts";
const R2 = "src/features/image-gen/lib/r2.ts";
const VIEW = "src/features/storage/admin/components/files-admin-view.tsx";
const PAGE = "src/app/[locale]/(admin)/admin/files/page.tsx";
const NAV = "src/config/nav.ts";
const SIDEBAR = "src/features/admin/components/admin-sidebar.tsx";

describe("后台文件管理 —— 走的是 R2 桶,不是头像桶", () => {
  it("列目录 / 删除 / 签名下载都走 `features/image-gen/lib/r2`", () => {
    const code = stripComments(read(ACTIONS));

    expect(code).toContain('from "@/features/image-gen/lib/r2"');
    expect(code).toContain("listObjects");
    expect(code).toContain("deleteObject");
    expect(code).toContain("presignDownload");
  });

  it("**不碰** `features/storage/providers/s3`(那是头像桶,STORAGE_*)", () => {
    const code = stripComments(read(ACTIONS));

    expect(code).not.toContain("features/storage/providers/s3");
    expect(code).not.toContain("STORAGE_");
  });

  it("桶名来自 `R2_BUCKET`,不是写死的", () => {
    const code = stripComments(read(R2));

    expect(code).toContain("process.env.R2_BUCKET");
  });

  it('列目录用 `Delimiter: "/"` —— 「目录 + 文件」两层视图', () => {
    const code = stripComments(read(ACTIONS));

    // delimiter 是这一页的核心:没有它就会把整个前缀下的文件全倒出来
    expect(code).toContain('delimiter: "/"');
    // CommonPrefixes = 子目录,Contents = 本层文件
    expect(code).toContain("listing.prefixes");
    expect(code).toContain("listing.objects");
  });
});

describe("后台文件管理 —— 前缀和对象键在服务端校验", () => {
  it("action 里调的是 `normalizePrefix` / `normalizeObjectKey`", () => {
    const code = stripComments(read(ACTIONS));

    expect(code).toContain("normalizePrefix");
    expect(code).toContain("normalizeObjectKey");
    // 客户端传来的路径要能被拒
    expect(code).toContain("INVALID_PREFIX");
    expect(code).toContain("INVALID_KEY");
  });

  it("路径形状的规则写在 `paths.ts` 里 —— 段只允许 `\\w.-`", () => {
    const code = stripComments(read(PATHS));

    expect(code).toContain("SEGMENT_RE");
    // `..` 和反斜杠是两个方向的穿越原料,都要挡
    expect(code).toContain('".."');
    expect(code).toContain('"\\\\"');
  });

  it("纯函数:前缀的形状", () => {
    expect(normalizePrefix("")).toBe("");
    expect(normalizePrefix("/")).toBe("");
    expect(normalizePrefix("print-orders")).toBe("print-orders/");
    expect(normalizePrefix("print-orders/")).toBe("print-orders/");
    expect(normalizePrefix("/print-orders/")).toBe("print-orders/");
    expect(normalizePrefix("a/b/c")).toBe("a/b/c/");
  });

  it("纯函数:路径穿越和怪字符一律拒", () => {
    expect(normalizePrefix("../etc")).toBeNull();
    expect(normalizePrefix("a/../b")).toBeNull();
    expect(normalizePrefix("a..b")).toBeNull();
    expect(normalizePrefix("a\\b")).toBeNull();
    expect(normalizePrefix("a//b")).toBeNull();
    expect(normalizePrefix("a b")).toBeNull();
  });

  it("纯函数:对象键不能以斜杠结尾(那是目录标记)", () => {
    expect(normalizeObjectKey("a/b/c.zip")).toBe("a/b/c.zip");
    expect(normalizeObjectKey("a/b/")).toBeNull();
    expect(normalizeObjectKey("/a/b")).toBeNull();
    expect(normalizeObjectKey("a/../b")).toBeNull();
    expect(normalizeObjectKey("")).toBeNull();
  });

  it("纯函数:面包屑 / 上一级", () => {
    expect(buildBreadcrumb("")).toEqual([]);
    expect(buildBreadcrumb("print-orders/a08b/2026-11-08/")).toEqual([
      { label: "print-orders", prefix: "print-orders/" },
      { label: "a08b", prefix: "print-orders/a08b/" },
      { label: "2026-11-08", prefix: "print-orders/a08b/2026-11-08/" },
    ]);

    expect(parentPrefix("print-orders/a08b/")).toBe("print-orders/");
    expect(parentPrefix("print-orders/")).toBe("");
    expect(parentPrefix("")).toBe("");
    expect(folderName("print-orders/a08b/")).toBe("a08b");
  });
});

describe("后台文件管理 —— 删除失败要说人话", () => {
  it("桶策略锁着对象 → `R2_DELETE_BLOCKED`(重试没用)", () => {
    const code = stripComments(read(ERRORS));

    expect(code).toContain("ObjectLockedByBucketPolicy");
    expect(code).toContain("R2_DELETE_BLOCKED");
    // R2 锁对象的回包是 409 —— 错误码没带出来时靠状态码兜
    expect(code).toContain("409");
  });

  it("404 → `NOT_FOUND`,其它 → `DELETE_FAILED`", () => {
    const code = stripComments(read(ERRORS));

    expect(code).toContain("NOT_FOUND");
    expect(code).toContain("DELETE_FAILED");
    expect(code).toContain("NoSuchKey");
  });

  it("原始报错不外泄 —— 只映射成一个稳定的码", () => {
    const code = stripComments(read(ACTIONS));

    // 原始错进 console,响应体只给码
    expect(code).toContain("console.error");
    expect(code).not.toContain("err.message");
  });
});

describe("后台文件管理 —— 归属是反查出来的", () => {
  it("用的是 `printOrderScope`(同一个 sha256,不能另写一份)", () => {
    const code = stripComments(read(OWNER_MAP));

    expect(code).toContain('from "@/features/print-quote/lib/upload-key"');
    expect(code).toContain("printOrderScope");
  });

  it("认三种键形状:哈希分区 / 裸 userId / 认不出", () => {
    const index = buildOwnerIndex([
      { id: "user-1", name: "张三", email: "zhang@example.com" },
      { id: "user-2", name: "李四", email: "li@example.com" },
    ]);

    // 哈希分区 —— 目录名是 sha256(userId) 前 16 位
    const scope = printOrderScope("user-1");
    expect(scope).toHaveLength(16);
    expect(
      resolveFileOwner(`print-orders/${scope}/2026-11-08/x.zip`, index)
    ).toEqual({ id: "user-1", name: "张三", email: "zhang@example.com" });

    // 裸 userId 的两支
    expect(resolveFileOwner("user-uploads/user-1/photo.png", index)).toEqual({
      id: "user-1",
      name: "张三",
      email: "zhang@example.com",
    });
    expect(resolveFileOwner("canvas/results/user-2/out.mp4", index)).toEqual({
      id: "user-2",
      name: "李四",
      email: "li@example.com",
    });

    // 认不出来的 —— 不猜,摆「—」
    expect(resolveFileOwner("gpt-image/abc/def.png", index)).toBeNull();
    expect(resolveFileOwner("orders/whatever.zip", index)).toBeNull();
    // 别人的分区 —— 对不上就 null
    expect(
      resolveFileOwner(`print-orders/${printOrderScope("user-9")}/x.zip`, index)
    ).toBeNull();
  });

  it("纯函数:从键里认出分区哈希 / 裸 userId", () => {
    // 老键 `print-orders/<日期>/…` 没有分区 —— 认不出归属是对的
    expect(printOrderScopeFromKey("print-orders/2026-11-01/x.zip")).toBeNull();
    expect(printOrderScopeFromKey("print-orders/a08b4fd7fed13968/x.zip")).toBe(
      "a08b4fd7fed13968"
    );
    expect(printOrderScopeFromKey("gpt-image/a/b.png")).toBeNull();

    expect(rawUserIdFromKey("user-uploads/user-1/x.png")).toBe("user-1");
    expect(rawUserIdFromKey("canvas/results/user-2/x.mp4")).toBe("user-2");
    expect(rawUserIdFromKey("print-orders/a08b/x.zip")).toBeNull();
  });
});

describe("后台文件管理 —— 「use server」文件不许 re-export 类型", () => {
  it("`actions.ts` 只导出 action,类型在独立的 `types.ts`", () => {
    const code = stripComments(read(ACTIONS));

    // re-export 一个类型 → 运行时引用一个不存在的类型绑定 → ReferenceError
    expect(code).not.toMatch(/export\s+type\s+\{/);
    expect(code).not.toMatch(/export\s*\{[^}]*\btype\b/);
    expect(code).not.toMatch(/export\s+\*\s+from/);
    // 类型只 import 不 re-export
    expect(code).toContain("import type {");
    expect(code).toContain('from "./types"');
  });

  it("类型真的住在 `types.ts` 里", () => {
    const code = read("src/features/storage/admin/types.ts");

    expect(code).toContain("export interface AdminFileObject");
    expect(code).toContain("export interface AdminFileFolder");
    expect(code).toContain("export type AdminFilesErrorCode");
  });
});

describe("后台文件管理 —— 入口和文案", () => {
  it("侧边栏有这一项", () => {
    const nav = stripComments(read(NAV));
    const sidebar = stripComments(read(SIDEBAR));

    expect(nav).toContain('href: "/admin/files"');
    expect(sidebar).toContain('文件管理: t("nav.files")');
  });

  it("路由页只渲染客户端组件", () => {
    const code = stripComments(read(PAGE));

    expect(code).toContain("<FilesAdminView />");
  });

  it("视图有面包屑 / 复制 / 下载 / 删除", () => {
    const code = stripComments(read(VIEW));

    expect(code).toContain("buildBreadcrumb");
    expect(code).toContain("copyLink");
    expect(code).toContain("openFile");
    expect(code).toContain("requestDelete");
    // 落地页默认停在打印模型那一支
    expect(code).toContain('const DEFAULT_PREFIX = "print-orders/"');
  });

  it("中英文的 `AdminFiles` 键一样 —— 少一个语言 = 那一侧全是 key 名", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(zh.AdminFiles).toBeDefined();
    expect(en.AdminFiles).toBeDefined();

    const zhKeys = leafPaths(zh.AdminFiles).sort();
    const enKeys = leafPaths(en.AdminFiles).sort();
    expect(enKeys).toEqual(zhKeys);

    // 侧边栏那一项也得有
    expect(zh.AdminSidebar.nav.files).toBeTruthy();
    expect(en.AdminSidebar.nav.files).toBeTruthy();
  });

  it("错误码在两种语言里都摆得上话", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    for (const code of [
      "R2_NOT_CONFIGURED",
      "INVALID_PREFIX",
      "INVALID_KEY",
      "LIST_FAILED",
      "R2_DELETE_BLOCKED",
      "NOT_FOUND",
      "DELETE_FAILED",
      "DOWNLOAD_FAILED",
    ]) {
      expect(zh.AdminFiles.errors[code]).toBeTruthy();
      expect(en.AdminFiles.errors[code]).toBeTruthy();
    }
  });
});

describe("后台文件管理 —— 文件种类", () => {
  it("扩展名 / 图片判定", () => {
    expect(fileExt("print-orders/a08b/x.ZIP")).toBe("zip");
    expect(fileExt("print-orders/a08b/x")).toBe("");
    expect(isImageKey("gpt-image/a/b.png")).toBe(true);
    expect(isImageKey("print-orders/a08b/x.zip")).toBe(false);
  });

  it("种类映射 —— 界面那一列显示什么", () => {
    expect(fileKind("gpt-image/a/b.png")).toBe("image");
    expect(fileKind("print-orders/a08b/x.obj")).toBe("model");
    expect(fileKind("print-orders/a08b/x.zip")).toBe("archive");
    expect(fileKind("orders/x.pdf")).toBe("document");
    expect(fileKind("orders/x.bin")).toBe("other");
  });
});
