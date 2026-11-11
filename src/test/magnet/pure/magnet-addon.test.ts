/**
 * 磁吸孔桥接的 **Blender 插件包**
 *
 * ## 这条路是什么
 *
 * 工作室 2026-11-11 的原话:**「在 Blender 里 Scripting → 新建文本 → 把插件
 * 粘进去 → Run Script,桥接就起了。做出插件」**。
 *
 * 「粘进去跑一下」太别扭了 —— 用户得自己动手。所以做成**能装的插件**:
 *
 * ```
 * Edit → Preferences → Add-ons → Install from Disk… → 选那个 zip → 勾上启用
 * ```
 *
 * 装完**一打开 Blender 桥接就自动起了**(端口在插件偏好里改)。
 *
 * ## 这一层守住什么
 *
 * 1. **插件包在仓库里**(跟 `public/manifold.wasm` 一个道理)—— 新克隆的机器
 *    没人跑构建脚本的话,页面上的「下载插件」链接会给一个 404。
 * 2. **包里的实现跟源码一个字节都不差** —— 插件跟网页那份**永远是一个东西**,
 *    不会漂(改了源码忘了重新构建 ⇒ 这里红)。
 * 3. **zip 的形状对** —— Blender 装 zip 插件要求:**压缩包里只有一个顶层目录**,
 *    目录名 = 插件模块名。
 * 4. **插件真的能装上** —— `bl_info` / `register` / `unregister` / 偏好设置 /
 *    面板 / 操作器都在。
 * 5. **页面给得到那个 zip** —— 而且 **proxy 的 matcher 放它过**
 *    (`/magnet/*` 不走 intl 中间件,不然会被 locale 前缀劫持成 404)。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  MAGNET_BLENDER_ADDON_URL,
  MAGNET_BLENDER_ADDON_ZIP_URL,
  MAGNET_BLENDER_PROTOCOL_VERSION,
} from "@/features/magnet/lib/blender-local";

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 插件包在仓库里的位置 */
const ADDON_ZIP = join(ROOT, "public", "magnet", "mooncoda_magnet_bridge.zip");

/** 桥接实现(真理源) */
const BRIDGE_PY = join(ROOT, "public", "magnet", "blender_bridge.py");

/** 顶层目录名 = Blender 里的模块名 */
const ADDON_DIR = "mooncoda_magnet_bridge";

/**
 * 把 proxy 的 matcher 那条正则抠出来
 *
 * 从**源码**里抠(而不是 import `src/proxy.ts`)—— 那个文件会拖进
 * next-intl / better-auth,单测里没必要起那一整套。
 *
 * ⚠️ **要锚定整条路径** —— Next.js 的 matcher 拿整条 pathname 去比。
 */
function proxyMatcher(): RegExp {
  const src = readFileSync(join(ROOT, "src", "proxy.ts"), "utf8");
  const m = src.match(/"\/\(\(\?![^"]*"/);
  if (!m || !m[0]) throw new Error("src/proxy.ts 里没找到 matcher");
  return new RegExp(`^${JSON.parse(m[0]) as string}$`);
}

describe("磁吸孔的 Blender 插件包", () => {
  it("插件包在仓库里(产物跟 wasm 一样提交进来)", () => {
    expect(existsSync(ADDON_ZIP)).toBe(true);
    expect(existsSync(BRIDGE_PY)).toBe(true);
  });

  it("zip 里只有一个顶层目录,目录名 = 插件模块名", () => {
    const zip = unzipSync(new Uint8Array(readFileSync(ADDON_ZIP)));
    const names = Object.keys(zip);
    expect(names.length).toBeGreaterThan(0);

    const tops = new Set(
      names.map((name) => name.split("/")[0]).filter((top) => top !== "")
    );
    expect([...tops]).toEqual([ADDON_DIR]);

    expect(names).toContain(`${ADDON_DIR}/__init__.py`);
    expect(names).toContain(`${ADDON_DIR}/bridge.py`);
  });

  it("包里的实现跟源码**一个字节都不差**(不会漂)", () => {
    const zip = unzipSync(new Uint8Array(readFileSync(ADDON_ZIP)));
    const packed = zip[`${ADDON_DIR}/bridge.py`];
    expect(packed).toBeDefined();

    const source = new Uint8Array(readFileSync(BRIDGE_PY));
    expect(Array.from(packed!)).toEqual(Array.from(source));
  });

  it("入口把 bl_info / register / unregister 再导出一次(Blender 就认这三个)", () => {
    const zip = unzipSync(new Uint8Array(readFileSync(ADDON_ZIP)));
    const init = new TextDecoder().decode(zip[`${ADDON_DIR}/__init__.py`]);
    expect(init).toContain("bl_info");
    expect(init).toContain("register");
    expect(init).toContain("unregister");
    // **不许**在入口里再抄一份 bl_info —— 抄了就会跟 bridge.py 里那份漂移
    expect(init).toContain("from .bridge import");
    expect(init).not.toMatch(/bl_info\s*=\s*\{/);
  });

  it("源码确实是个能装的插件(bl_info / register / 偏好设置 / 面板)", () => {
    const src = readFileSync(BRIDGE_PY, "utf8");

    // Blender 认的三个名字
    expect(src).toContain("bl_info");
    expect(src).toContain("def register(");
    expect(src).toContain("def unregister(");

    // 装上之后「一打开 Blender 桥接就自动起」—— 靠偏好设置 + 自动起
    expect(src).toContain("AddonPreferences");
    // 偏好设置的 bl_idname = 插件模块名(Blender 靠它把偏好挂到插件上)
    expect(src).toContain("bl_idname = ADDON_MODULE");

    // 面板 + 操作器(用户能手动开关)
    expect(src).toContain("class MOONCODA_PT_bridge");
    expect(src).toContain("class MOONCODA_OT_start_bridge");
    expect(src).toContain("class MOONCODA_OT_stop_bridge");

    // 协议版本跟网页端要对得上
    expect(src).toContain(
      `PROTOCOL_VERSION = ${MAGNET_BLENDER_PROTOCOL_VERSION}`
    );
  });

  it("插件只绑 127.0.0.1(别让它变成能往公网发数据的代理)", () => {
    const src = readFileSync(BRIDGE_PY, "utf8");
    expect(src).toContain('("127.0.0.1", port)');
    // 不许有 0.0.0.0
    expect(src).not.toContain('("0.0.0.0"');
  });

  it("页面上给得到那个 zip(而且 proxy 放它过 —— 不被 locale 前缀劫持)", () => {
    expect(MAGNET_BLENDER_ADDON_ZIP_URL).toBe(
      "/magnet/mooncoda_magnet_bridge.zip"
    );
    expect(MAGNET_BLENDER_ADDON_URL).toBe("/magnet/blender_bridge.py");

    // matcher 把 `/magnet/*` 排除掉 —— 不然 `/magnet/xxx.zip` 会被 307 到
    // `/zh/magnet/xxx.zip`(404)
    const matcher = proxyMatcher();
    expect(matcher.test("/magnet/mooncoda_magnet_bridge.zip")).toBe(false);
    expect(matcher.test("/magnet/blender_bridge.py")).toBe(false);
    // 页面路由照常走 intl
    expect(matcher.test("/zh/tools/magnet")).toBe(true);
  });

  it("构建脚本在仓库里,package.json 登记了那条命令", () => {
    const script = join(ROOT, "scripts", "build-blender-addon.ts");
    expect(existsSync(script)).toBe(true);

    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["magnet:addon"]).toContain(
      "scripts/build-blender-addon.ts"
    );
  });
});
