/**
 * 「本地 Blender」那条路 —— 协议 / 错误映射 / 插件那份脚本
 *
 * ## 这条路是什么
 *
 * 工作室的脚本原本只能在工作室本地的 Blender 里跑。浏览器那条路
 * (Manifold3D)现在**会自己修**(补洞 / 剔重复面 / 拆蝴蝶结顶点 / 翻绕序),
 * 大多数破模型都能切了 —— 但**自相交**那种修不了的,Blender 那边的
 * 容错(EXACT → FAST 兜底)还能治。所以网页端让用户**装一个插件**,
 * 切孔在他自己的机器上跑(这条是**兜底**,不是必经之路)。
 *
 * ## 三条硬规矩(这一层守住它们)
 *
 * 1. **模型不出这台电脑** —— 走 `http://127.0.0.1:<端口>`,不是我们的服务器。
 *    没有上传、没有登录、没有 API 路由。
 * 2. **只跟 127.0.0.1 说话** —— 地址写死回环,端口以外的东西一概不接受
 *    (别让它变成一个能往公网发数据的代理)。
 * 3. **每个失败都有稳定的 code** —— 界面按 code 说人话,不是笼统一句
 *    「请稍后重试」。
 *
 * 纯函数 + **注入的 fetch** —— 单测里塞一个假 fetch 就能验协议和错误映射,
 * 不用起浏览器、不用装 Blender、不用联网。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BlenderCutStats,
  BlenderLocalError,
  blenderBaseUrl,
  cutWithLocalBlender,
  type FetchLike,
  MAGNET_BLENDER_ADDON_URL,
  MAGNET_BLENDER_DEFAULT_PORT,
  MAGNET_BLENDER_PORTABLE_URL,
  MAGNET_BLENDER_PROTOCOL_VERSION,
  normalizeBlenderPort,
  parseStatsHeader,
  pingLocalBlender,
} from "@/features/magnet/lib/blender-local";

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件 */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 读一份语言包 */
function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 字符串 → ArrayBuffer(模拟响应体) */
function toBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/** 造一个假响应 */
function fakeResponse(options: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}): {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
} {
  const status = options.status ?? 200;
  const headers = options.headers ?? {};
  const body = options.body ?? "";
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    arrayBuffer: async () => toBuffer(body),
    text: async () => body,
  };
}

describe("本地 Blender —— 端口与地址", () => {
  it("端口非法 ⇒ 退回默认端口(别让用户填错一个数就连到别的地方)", () => {
    expect(normalizeBlenderPort(8765)).toBe(8765);
    expect(normalizeBlenderPort("8765")).toBe(8765);
    expect(normalizeBlenderPort(" 8765 ")).toBe(8765);
    expect(normalizeBlenderPort(1024)).toBe(1024);
    expect(normalizeBlenderPort(65535)).toBe(65535);
    // 越界 / 非法 ⇒ 默认
    expect(normalizeBlenderPort(80)).toBe(MAGNET_BLENDER_DEFAULT_PORT);
    expect(normalizeBlenderPort(70000)).toBe(MAGNET_BLENDER_DEFAULT_PORT);
    expect(normalizeBlenderPort(NaN)).toBe(MAGNET_BLENDER_DEFAULT_PORT);
    expect(normalizeBlenderPort("abc")).toBe(MAGNET_BLENDER_DEFAULT_PORT);
    expect(normalizeBlenderPort("")).toBe(MAGNET_BLENDER_DEFAULT_PORT);
  });

  it("**只跟 127.0.0.1 说话** —— 地址写死回环", () => {
    expect(blenderBaseUrl(8765)).toBe("http://127.0.0.1:8765");
    // 端口非法也照样写死回环
    expect(blenderBaseUrl("nope")).toBe(
      `http://127.0.0.1:${MAGNET_BLENDER_DEFAULT_PORT}`
    );
    // 不许出现别的 host
    expect(blenderBaseUrl(8765)).not.toMatch(/localhost|0\.0\.0\.0|https:/);
  });

  it("默认端口跟插件那份一致", () => {
    const addon = read("public/magnet/blender_bridge.py");
    expect(MAGNET_BLENDER_DEFAULT_PORT).toBe(8765);
    expect(addon).toContain("DEFAULT_PORT = 8765");
  });
});

describe("本地 Blender —— 探活", () => {
  it("插件在 ⇒ 拿得到版本号", async () => {
    const fetchImpl: FetchLike = async () =>
      fakeResponse({
        body: JSON.stringify({
          ok: true,
          protocol: MAGNET_BLENDER_PROTOCOL_VERSION,
          blender: "4.2.1",
          addOn: "Mooncoda Magnet Bridge 1.0.0",
        }),
      });

    const result = await pingLocalBlender({ port: 8765, fetchImpl });
    expect(result.blender).toBe("4.2.1");
    expect(result.protocol).toBe(MAGNET_BLENDER_PROTOCOL_VERSION);
  });

  it("探活也带协议版本头 —— 插件版本对不上要说人话", async () => {
    let seenHeader: string | null = null;
    let seenUrl = "";
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeader = init?.headers?.["x-magnet-protocol"] ?? null;
      return fakeResponse({
        body: JSON.stringify({
          protocol: MAGNET_BLENDER_PROTOCOL_VERSION,
          blender: "4.2.1",
        }),
      });
    };

    await pingLocalBlender({ port: 8765, fetchImpl });
    expect(seenUrl).toBe("http://127.0.0.1:8765/ping");
    expect(seenHeader).toBe(String(MAGNET_BLENDER_PROTOCOL_VERSION));
  });

  it("协议版本对不上 ⇒ BLENDER_BAD_RESPONSE", async () => {
    const fetchImpl: FetchLike = async () =>
      fakeResponse({
        body: JSON.stringify({
          protocol: MAGNET_BLENDER_PROTOCOL_VERSION + 1,
          blender: "4.2.1",
        }),
      });

    await expect(
      pingLocalBlender({ port: 8765, fetchImpl })
    ).rejects.toMatchObject({ code: "BLENDER_BAD_RESPONSE" });
  });

  it("回的不是一个 JSON ⇒ BLENDER_BAD_RESPONSE", async () => {
    const fetchImpl: FetchLike = async () =>
      fakeResponse({ body: "<html>不是插件</html>" });

    await expect(
      pingLocalBlender({ port: 8765, fetchImpl })
    ).rejects.toMatchObject({ code: "BLENDER_BAD_RESPONSE" });
  });

  it("连不上(插件没起)⇒ BLENDER_NOT_RUNNING", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(
      pingLocalBlender({ port: 8765, fetchImpl })
    ).rejects.toMatchObject({ code: "BLENDER_NOT_RUNNING" });
  });

  it("连上了但没回话 ⇒ BLENDER_TIMEOUT(跟「没起」是两回事)", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });

    await expect(
      pingLocalBlender({ port: 8765, fetchImpl, timeoutMs: 20 })
    ).rejects.toMatchObject({ code: "BLENDER_TIMEOUT" });
  });
});

describe("本地 Blender —— 切孔", () => {
  const hole = { holeDiaMm: 20.7, holeDepthMm: 1.3 };

  it("发过去的包 + 头都对 —— 插件靠那两个头知道孔参数和协议版本", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: unknown = null;

    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers ?? {};
      seenBody = init?.body;
      return fakeResponse({
        headers: {
          "content-type": "application/zip",
          "x-magnet-stats": JSON.stringify({
            removedVolumeMm3: 437.5,
            expectedRemovedVolumeMm3: 437.6,
            triangleCount: 1234,
            solver: "EXACT",
            warnings: [],
          }),
        },
        body: "PK-fake-zip",
      });
    };

    const zip = new Blob(["fake"], { type: "application/zip" });
    const result = await cutWithLocalBlender({
      port: 8765,
      zip,
      hole,
      fetchImpl,
    });

    expect(seenUrl).toBe("http://127.0.0.1:8765/cut");
    expect(seenHeaders["content-type"]).toBe("application/zip");
    expect(seenHeaders["x-magnet-protocol"]).toBe(
      String(MAGNET_BLENDER_PROTOCOL_VERSION)
    );
    // 孔参数走头里(ASCII 装得下)—— 插件那边按它摆切刀
    expect(JSON.parse(seenHeaders["x-magnet-params"] ?? "{}")).toEqual({
      holeDiaMm: 20.7,
      holeDepthMm: 1.3,
    });
    expect(seenBody).toBe(zip);
    // 统计从 `x-magnet-stats` 头里回来
    expect(result.stats.removedVolumeMm3).toBe(437.5);
    expect(result.stats.solver).toBe("EXACT");
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("插件那边报错了 ⇒ BLENDER_FAILED,detail 里带着它自己的 code", async () => {
    const fetchImpl: FetchLike = async () =>
      fakeResponse({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          error: "这块面太薄(1.20mm),切 1.30mm 会捅穿",
          code: "FACE_NOT_CUTTABLE",
        }),
      });

    const zip = new Blob(["fake"], { type: "application/zip" });
    await expect(
      cutWithLocalBlender({ port: 8765, zip, hole, fetchImpl })
    ).rejects.toMatchObject({ code: "BLENDER_FAILED" });

    // 真原因得带出来 —— 只摆一句「切失败了」用户没法处理
    try {
      await cutWithLocalBlender({ port: 8765, zip, hole, fetchImpl });
      throw new Error("不该成功");
    } catch (err) {
      expect(err).toBeInstanceOf(BlenderLocalError);
      const detail = (err as BlenderLocalError).detail ?? "";
      expect(detail).toContain("FACE_NOT_CUTTABLE");
      expect((err as BlenderLocalError).message).toContain("太薄");
    }
  });

  it("回的不是 zip ⇒ BLENDER_BAD_RESPONSE(插件版本对不上)", async () => {
    const fetchImpl: FetchLike = async () =>
      fakeResponse({
        headers: { "content-type": "text/html" },
        body: "<html>",
      });

    const zip = new Blob(["fake"], { type: "application/zip" });
    await expect(
      cutWithLocalBlender({ port: 8765, zip, hole, fetchImpl })
    ).rejects.toMatchObject({ code: "BLENDER_BAD_RESPONSE" });
  });

  it("连不上 ⇒ BLENDER_NOT_RUNNING", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };

    const zip = new Blob(["fake"], { type: "application/zip" });
    await expect(
      cutWithLocalBlender({ port: 8765, zip, hole, fetchImpl })
    ).rejects.toMatchObject({ code: "BLENDER_NOT_RUNNING" });
  });
});

describe("本地 Blender —— 统计头解析", () => {
  it("解析不了就摆空数组,别炸", () => {
    const empty = parseStatsHeader(null);
    expect(empty.warnings).toEqual([]);
    expect(empty.removedVolumeMm3).toBeNull();

    const broken = parseStatsHeader("{不是 JSON");
    expect(broken.warnings).toEqual([]);
    expect(broken.triangleCount).toBeNull();
  });

  it("好的头照常解析", () => {
    const stats: BlenderCutStats = parseStatsHeader(
      JSON.stringify({
        volumeBeforeMm3: 1000,
        volumeAfterMm3: 562.5,
        removedVolumeMm3: 437.5,
        expectedRemovedVolumeMm3: 437.6,
        triangleCount: 42,
        face: "最大平面 1234.5 mm²",
        solver: "EXACT",
        warnings: ["模型不是封闭的,体积算不准"],
      })
    );
    expect(stats.removedVolumeMm3).toBe(437.5);
    expect(stats.solver).toBe("EXACT");
    expect(stats.warnings).toHaveLength(1);
  });
});

describe("插件那份脚本(public/magnet/blender_bridge.py)", () => {
  const ADDON = "public/magnet/blender_bridge.py";

  it("在仓库里 —— 页面能直接下载它", () => {
    expect(existsSync(join(ROOT, ADDON))).toBe(true);
    expect(MAGNET_BLENDER_ADDON_URL).toBe("/magnet/blender_bridge.py");
  });

  it("**只绑 127.0.0.1** —— 别让它变成能往公网发数据的代理", () => {
    const src = read(ADDON);
    expect(src).toContain('("127.0.0.1", port)');
    // 不许绑 0.0.0.0
    expect(src).not.toContain('"0.0.0.0"');
  });

  it("带私有网络访问的头(Chrome PNA)—— 不带的话公网页面连不上", () => {
    const src = read(ADDON);
    expect(src).toContain("Access-Control-Allow-Private-Network");
    expect(src).toContain("Access-Control-Allow-Origin");
  });

  it("协议版本跟网页端一致", () => {
    const src = read(ADDON);
    expect(src).toContain(
      `PROTOCOL_VERSION = ${MAGNET_BLENDER_PROTOCOL_VERSION}`
    );
  });

  it("布尔运算 EXACT 失败退 FAST —— AI 生成的模型常常要退", () => {
    const src = read(ADDON);
    expect(src).toContain('for solver in ("EXACT", "FAST")');
  });

  it("**不用 bpy.ops** —— 算子要上下文,timer 里调不稳", () => {
    const src = read(ADDON);
    // 只查**真正的调用** —— 文档字符串里提一嘴「不碰 bpy.ops」不算
    expect(src).not.toMatch(/bpy\.ops\.[a-z_]+\s*\(/);
    // 改网格走的是 evaluated 网格(不靠算子)
    expect(src).toContain("preserve_all_data_layers=True");
  });

  it("切刀摆放跟网页端同一套数学(中心 = 点 + 朝内 ×(深/2 − 外伸))", () => {
    const src = read(ADDON);
    expect(src).toContain(
      "center = Vector(point) + inward * (depth / 2.0 - penetration)"
    );
    expect(src).toContain("height = depth + 2 * penetration");
  });

  it("切完做收尾检查(空网格 / 没切进去 / 切到边上)", () => {
    const src = read(ADDON);
    expect(src).toContain("NOTHING_CUT");
    expect(src).toContain("HOLE_SPILLED");
    expect(src).toContain("FACE_NOT_CUTTABLE");
    expect(src).toContain("BOOLEAN_FAILED");
  });
});

describe("页面那一层", () => {
  const TOOL = "src/features/magnet/components/magnet-cutter-tool.tsx";

  it("有引擎开关 —— 用户自己选走哪条路", () => {
    const src = read(TOOL);
    expect(src).toContain("MagnetEngine");
    expect(src).toContain('switchEngine("browser")');
    expect(src).toContain('switchEngine("blender")');
  });

  it("**不碰工单那条链路** —— 两条引擎都不进工单", () => {
    const src = read(TOOL);
    expect(src).not.toMatch(/api\/print-orders|api\/print-quote/);
    expect(src).not.toMatch(/@\/features\/print-quote/);
    expect(src).not.toMatch(/@\/db/);
  });

  it("**不往我们的服务器发模型** —— 只跟 127.0.0.1 说话", () => {
    const src = read(TOOL);
    expect(src).not.toMatch(/fetch\("\/api\/|fetch\(`\/api\//);
    expect(src).toContain("cutWithLocalBlender");
    expect(src).toContain("pingLocalBlender");
  });

  it("指引用户去下便携版 Blender + 插件", () => {
    const src = read(TOOL);
    expect(src).toContain("MAGNET_BLENDER_PORTABLE_URL");
    expect(src).toContain("MAGNET_BLENDER_ADDON_URL");
    // 官方下载页(便携版 .zip 就在那儿)
    expect(MAGNET_BLENDER_PORTABLE_URL).toContain("blender.org");
  });

  it("本地 Blender 那条路**不跑浏览器的分析** —— 浏览器那套修不好的时候它照样能切", () => {
    const src = read(TOOL);
    expect(src).toMatch(/engine === "blender"\) return/);
  });
});

describe("文案", () => {
  it("中英文 key 一致(Magnet 命名空间)", () => {
    const zh = messages("zh").Magnet as Record<string, unknown>;
    const en = messages("en").Magnet as Record<string, unknown>;

    const flatten = (obj: unknown, prefix = ""): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        out[prefix] = obj;
        return out;
      }
      for (const [key, value] of Object.entries(
        obj as Record<string, unknown>
      )) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.assign(out, flatten(value, path));
        } else {
          out[prefix] = value;
        }
      }
      return out;
    };

    const zhFlat = flatten(zh);
    const enFlat = flatten(en);
    expect(Object.keys(enFlat).sort()).toEqual(Object.keys(zhFlat).sort());
  });

  it("本地 Blender 相关的文案两种语言都有", () => {
    const zh = messages("zh").Magnet as Record<string, unknown>;
    const en = messages("en").Magnet as Record<string, unknown>;
    const engineZh = zh.engine as Record<string, unknown>;
    const engineEn = en.engine as Record<string, unknown>;
    for (const key of [
      "title",
      "browser",
      "blender",
      "portLabel",
      "check",
      "online",
      "offline",
      "downloadBlender",
      "addon",
      "faceNote",
    ]) {
      expect(engineZh[key], `zh 缺 engine.${key}`).toBeTruthy();
      expect(engineEn[key], `en 缺 engine.${key}`).toBeTruthy();
    }
    const codesZh = (zh.errors as Record<string, unknown>).codes as Record<
      string,
      unknown
    >;
    const codesEn = (en.errors as Record<string, unknown>).codes as Record<
      string,
      unknown
    >;
    for (const key of [
      "blenderNotRunning",
      "blenderFailed",
      "blenderTimeout",
      "blenderBadResponse",
    ]) {
      expect(codesZh[key], `zh 缺 errors.codes.${key}`).toBeTruthy();
      expect(codesEn[key], `en 缺 errors.codes.${key}`).toBeTruthy();
    }
  });

  it("文案里没有 markdown 粗体(Magnet 命名空间)", () => {
    const raw = read("messages/zh.json");
    const magnetBlock = raw.slice(raw.indexOf('"Magnet": {'));
    expect(magnetBlock).not.toContain("**");
  });
});
