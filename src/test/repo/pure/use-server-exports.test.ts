import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「use server」文件的 export 规矩(2026-11-05)
 *
 * ## 背景:一个类型 re-export 把结算页搞成 500
 *
 * `src/features/address/actions.ts`("use server")里有一行:
 *
 * ```ts
 * export type { AddressErrorCode };
 * ```
 *
 * 看着人畜无害 —— 类型嘛,编译期就没了。结果整个 `/checkout` 页面**直接
 * 500**:
 *
 * ```
 * ReferenceError: AddressErrorCode is not defined
 * ```
 *
 * 原因:Turbopack 的 `"use server"` 转换把**所有 export** 都当成 server
 * action 去注册,包括 `export type { X }` 这种带 specifier 的类型 re-export。
 * 编译产物:
 *
 * ```js
 * /* __next_internal_action_entry_do_not_use__ [... "7f876a04...":"AddressErrorCode"] *\/
 * AddressErrorCode,                        // ← 运行时去引用一个类型
 * registerServerReference(AddressErrorCode, "7f876a04...", null);
 * ```
 *
 * 类型在编译期就被擦掉了,运行时根本没有这个绑定 → 引用即抛。而且是
 * **模块求值阶段**就炸 —— server actions loader 整个挂掉,页面 500,
 * 不是一个 action 报错。
 *
 * ## 三种危险写法(都实测过)
 *
 * | 写法 | 后果 |
 * |---|---|
 * | `export type { X }` | 运行时 ReferenceError,页面 500 |
 * | `export { type X }` | 同上(同一个 specifier 形状) |
 * | `export * from "./x"` | 编译期报错("use server" 只能导出 async 函数) |
 *
 * ## 什么是**安全**的
 *
 * - `export type X = ...`(本地的类型别名)—— 被擦的是 re-export 那种带
 *   specifier 的形式,本地别名不进 manifest(实测 `AddressActionResult` /
 *   `AdminUpdateStatusResult` / `CancelPrintOrderErrorCode` 都没被注册)。
 * - `export interface X {}` —— 同上。
 * - `export const someAction = ...` —— 本来就该导出的是这些。
 *
 * ## 规矩
 *
 * **「use server」文件只导出 async 函数。** 类型放 `types.ts` 那种纯类型
 * 模块,客户端组件从那儿 import(类型导入编译期擦掉,不进 bundle)。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());
/** 源码根目录 */
const SRC = join(ROOT, "src");

/** 递归列出 src 下所有 .ts / .tsx */
function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 是不是「use server」文件
 *
 * 判据是**指令的位置**,不是文件里有没有这四个字 —— 注释里提到
 * `"use server"` 的普通模块(比如 mutations.ts)不算。
 */
function hasUseServerDirective(content: string): boolean {
  // 去掉文件开头的注释和空行,再看第一个语句
  const body = content.replace(
    /^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)+/,
    ""
  );
  return /^["']use server["']/.test(body);
}

/** 会把类型也带出「use server」模块的 export 形式 */
const DANGEROUS_EXPORTS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /^[ \t]*export\s+type\s*\{/m,
    why: "export type { X } —— 类型 re-export,会被注册成 server action",
  },
  {
    pattern: /^[ \t]*export\s*\{[^}]*\btype\s+[A-Za-z_$]/m,
    why: "export { type X } —— 值导出语句里混了类型 specifier",
  },
  {
    pattern: /^[ \t]*export\s*\*\s*from/m,
    why: 'export * from —— "use server" 文件只能导出 async 函数',
  },
];

describe("「use server」文件的 export 规矩", () => {
  const sourceFiles = listSourceFiles(SRC);

  it("扫得到源文件(别让遍历器空转)", () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it("没有把类型 re-export 出「use server」模块", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      if (!hasUseServerDirective(content)) continue;

      for (const { pattern, why } of DANGEROUS_EXPORTS) {
        if (pattern.test(content)) {
          offenders.push(`${relative(ROOT, file)} —— ${why}`);
        }
      }
    }

    expect(
      offenders,
      `「use server」文件里带了不该有的 export:\n${offenders.join("\n")}\n` +
        "Turbopack 会把它们注册成 server action,运行时引用一个不存在的类型绑定 " +
        "→ ReferenceError,整个页面 500。类型请放到 types.ts 那种纯类型模块。"
    ).toEqual([]);
  });

  it("检测器认得出「use server」文件(别让遍历器空转)", () => {
    const useServerFiles = sourceFiles.filter((file) =>
      hasUseServerDirective(readFileSync(file, "utf8"))
    );
    // 本仓库有几十个 server action 模块
    expect(useServerFiles.length).toBeGreaterThan(10);

    // 而普通模块(哪怕注释里提到 "use server")不算
    const mutations = join(SRC, "features/address/mutations.ts");
    expect(hasUseServerDirective(readFileSync(mutations, "utf8"))).toBe(false);
  });
});
