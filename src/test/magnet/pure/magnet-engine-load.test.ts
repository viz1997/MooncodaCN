import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAGNET_WASM_URL,
  resolveWasmUrl,
} from "@/features/magnet/lib/magnet-cutter-handler";
import { MAGNET_ERROR_KEYS } from "@/features/magnet/lib/magnet-error";

/**
 * 切割引擎(wasm)**加载不出来**的守卫(2026-11-11 线上事故)
 *
 * 工作室线上报的原文:
 *
 * ```
 * 切割过程中出了意外 —— 具体原因见下面那行原始信息。
 * Aborted(SyntaxError: Failed to execute 'open' on 'XMLHttpRequest': Invalid URL)
 * ```
 *
 * 那是 Emscripten 胶水的 `abort()` —— **两个独立的原因**叠在一起:
 *
 * 1. **URL 解不出来(报出来的那条)** —— 胶水在 Worker 里读 wasm 走的是
 *    **同步 XHR**(`xhr.open("GET", url, false)`)。我们给的 `locateFile`
 *    返回的是根相对路径 `"/manifold.wasm"`,而 Worker 里相对 URL 是跟
 *    **worker 脚本自己的地址**解的 —— 打包器把 worker 装进 `blob:` URL
 *    之后,blob 的路径是**不透明**的,`new URL("/manifold.wasm", "blob:…")`
 *    直接抛 `Invalid URL`。
 *    ⇒ `locateFile` 必须给**绝对地址**。
 * 2. **那个文件压根取不到(潜伏的那条)** —— `public/` 下的静态文件默认会
 *    走进 `intlMiddleware`,next-intl 的 `localePrefix: "always"` 把
 *    `/manifold.wasm` **307 重定向到 `/zh/manifold.wasm`** —— 那是 404。
 *    实测(线上):`/manifold.wasm` → 307 → `/zh/manifold.wasm` → 404。
 *    ⇒ `src/proxy.ts` 的 matcher 必须把 `wasm` / `py` 排除掉。
 *
 * 两个都修了,引擎才真的能跑起来 —— 只修一个还是拿不到 wasm。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/**
 * 把 proxy 的 matcher 那条正则抠出来
 *
 * 从**源码**里抠(而不是 import `src/proxy.ts`)—— 那个文件会拖进
 * next-intl / better-auth,单测里没必要起那一整套。
 */
function proxyMatcher(): RegExp {
  const src = read("src/proxy.ts");
  // matcher 那个字符串字面量(前后有注释,别指望它紧贴着 `matcher: [`)
  const m = src.match(/"\/\(\(\?![^"]*"/);
  if (!m || !m[0]) throw new Error("src/proxy.ts 里没找到 matcher");
  // ⚠️ **要锚定整条路径** —— Next.js 的 matcher 是拿整条 pathname 去比的
  // (不是「路径里某一段命中就算」)。不锚定的话 `/plugins/index.json`
  // 会在「/index.json」那一段上误命中,测试就白测了。
  return new RegExp(`^${JSON.parse(m[0]) as string}$`);
}

/** 造一个「浏览器里的 self」 —— location 的形状跟真的一样 */
function stubLocation(location: { origin: string; href: string }): void {
  vi.stubGlobal("self", { location });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wasm 地址 —— 必须是绝对地址", () => {
  it("普通页面(主线程)⇒ 绝对地址", () => {
    stubLocation({
      origin: "https://studio.example.com",
      href: "https://studio.example.com/zh/tools/magnet",
    });
    const url = resolveWasmUrl();
    expect(url).toBe("https://studio.example.com/manifold.wasm");
    expect(url.startsWith("/")).toBe(false);
  });

  it("blob: Worker ⇒ 还是绝对地址(不是 blob:)", () => {
    // 打包器把 worker 装进 blob: URL —— blob 的路径是「不透明」的,
    // 相对路径在它底下解不出来(就是线上那条 Invalid URL 的来源)。
    stubLocation({
      origin: "https://studio.example.com",
      href: "blob:https://studio.example.com/2f8a-1c3e-4b90",
    });
    const url = resolveWasmUrl();
    expect(url).toBe("https://studio.example.com/manifold.wasm");
    expect(url.startsWith("blob:")).toBe(false);
  });

  it("普通 Worker(脚本是真 chunk URL)⇒ 绝对地址", () => {
    stubLocation({
      origin: "https://studio.example.com",
      href: "https://studio.example.com/_next/static/chunks/worker.js",
    });
    expect(resolveWasmUrl()).toBe("https://studio.example.com/manifold.wasm");
  });

  it("origin 不透明(opaque)⇒ 不炸,退回根相对路径", () => {
    stubLocation({ origin: "null", href: "blob:null/9f2c" });
    const url = resolveWasmUrl();
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });

  it("Node(单测)⇒ 不炸", () => {
    // 这个环境里没有 `self` —— import.meta.url 是 file: ⇒ 解不出 http 地址
    expect(typeof resolveWasmUrl()).toBe("string");
  });

  it("引擎拿到的不是那个写死的相对路径", () => {
    // 源码里 `locateFile` 必须走 `resolveWasmUrl()`
    const src = read("src/features/magnet/lib/magnet-cutter-handler.ts");
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/)/.test(line))
      .join("\n");
    expect(stripped).toContain("locateFile: () => resolveWasmUrl()");
    expect(stripped).not.toContain("locateFile: () => MAGNET_WASM_URL");
    // 常量本身还在(测试和文档都引用它)
    expect(MAGNET_WASM_URL).toBe("/manifold.wasm");
  });
});

describe("proxy 的 matcher —— 静态文件别被 locale 前缀劫持", () => {
  const matcher = proxyMatcher();

  it("/manifold.wasm 不走 intl(否则被 307 到 /zh/… 然后 404)", () => {
    expect(matcher.test("/manifold.wasm")).toBe(false);
  });

  it("/magnet/blender_bridge.py(插件下载链接)不走 intl", () => {
    expect(matcher.test("/magnet/blender_bridge.py")).toBe(false);
  });

  it("/plugins/index.json 仍然不走 intl(老规矩)", () => {
    expect(matcher.test("/plugins/index.json")).toBe(false);
  });

  it("页面路由照常走 locale 处理", () => {
    expect(matcher.test("/zh/tools/magnet")).toBe(true);
    expect(matcher.test("/en/tools/magnet")).toBe(true);
    expect(matcher.test("/zh/marketing/products")).toBe(true);
  });

  it("API 路由照常走(限流还要靠它)", () => {
    expect(matcher.test("/api/print-orders")).toBe(true);
    expect(matcher.test("/api/auth/sign-in")).toBe(true);
  });
});

describe("引擎加载失败 ⇒ 有专门的 code 和文案", () => {
  it("code → 文案 key 在映射表里", () => {
    expect(MAGNET_ERROR_KEYS.ENGINE_LOAD_FAILED).toBe(
      "errors.codes.engineLoadFailed"
    );
  });

  it("中英文都有这句话", () => {
    for (const locale of ["zh", "en"] as const) {
      const codes = (
        messages(locale) as {
          Magnet: { errors: { codes: Record<string, string> } };
        }
      ).Magnet.errors.codes;
      const text = codes.engineLoadFailed ?? "";
      expect(typeof codes.engineLoadFailed).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("中文那条不带 markdown 粗体", () => {
    const codes = (
      messages("zh") as {
        Magnet: { errors: { codes: Record<string, string> } };
      }
    ).Magnet.errors.codes;
    expect(codes.engineLoadFailed ?? "").not.toContain("**");
  });
});
