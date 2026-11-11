/**
 * 磁吸孔的 **MCP 协议层**
 *
 * ## 这条路是什么
 *
 * 工作室 2026-11-11 的原话:**「做出插件,或者 mcp 协议」**。
 *
 * 插件那条路已经做完(可安装的 zip)。这一份是**另一条路** —— 让能驱动
 * MCP 的 AI 客户端(Claude Code / Claude Desktop / 任何 MCP host)在本机
 * 直接切磁吸孔:**不用开网页、不用拖文件**。
 *
 * ## 这一层守住什么
 *
 * 1. **协议合规** —— `initialize` 协商版本 / `tools/list` / `tools/call`;
 *    **通知不回**(回了客户端也不认);**工具不存在回 -32602**。
 * 2. **stdio 传输 = 一行一个 JSON** —— 不是 LSP 那种 `Content-Length` 分帧。
 * 3. **失败要说人话** —— 工具自己炸了也给一份看得懂的内容,不是只回一个
 *    「internal error」。
 * 4. **口径跟网页完全一致** —— 引擎是同一份代码,输出的那几个数是同一个数。
 * 5. **三条硬规矩** —— 不出这台电脑 / 不进工单 / 不悄悄改用户的模型。
 *
 * ## 纯函数,不用起浏览器

 * 协议层与排版层都是**零 import 的纯函数** ⇒ 这里不用起浏览器、不用装
 * Blender、不用联网。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  handleMcpLine,
  handleMcpRequest,
  MCP_ERROR_CODES,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_NAME,
  type MCP_TOOLS,
  type McpToolHandlers,
  mcpText,
  negotiateProtocolVersion,
} from "@/features/magnet/lib/mcp-protocol";
import {
  describeRepair,
  formatAnalyzeReport,
  formatCutReport,
  verdictText,
} from "@/features/magnet/lib/mcp-report";

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 一个能用的工具集 */
function handlers(): McpToolHandlers {
  return {
    magnet_analyze: async () => mcpText("分析结果"),
    magnet_cut: async () => mcpText("切好了"),
  };
}

describe("MCP 协议层", () => {
  it("initialize —— 客户端要的那版我们支持就照它那版回", async () => {
    const res = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      },
      handlers()
    );
    expect(res).not.toBeNull();
    const result = res?.result as {
      protocolVersion: string;
      capabilities: { tools: unknown };
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe(MCP_SERVER_NAME);
  });

  it("initialize —— 客户端要的那版我们不支持 ⇒ 回最新的一版", () => {
    expect(negotiateProtocolVersion("1999-01-01")).toBe(
      MCP_PROTOCOL_VERSIONS[0]
    );
    expect(negotiateProtocolVersion(undefined)).toBe(MCP_PROTOCOL_VERSIONS[0]);
    expect(negotiateProtocolVersion(123)).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  it("通知**不回**(notifications/initialized / cancelled)", async () => {
    expect(
      await handleMcpRequest(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        handlers()
      )
    ).toBeNull();
    expect(
      await handleMcpRequest(
        { jsonrpc: "2.0", method: "notifications/cancelled" },
        handlers()
      )
    ).toBeNull();
  });

  it("ping 回一个空结果", async () => {
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 2, method: "ping" },
      handlers()
    );
    expect(res?.result).toEqual({});
  });

  it("tools/list —— 三个工具,名字跟说明都在", async () => {
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      handlers()
    );
    const result = res?.result as { tools: typeof MCP_TOOLS };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "magnet_analyze",
      "magnet_cut",
      "magnet_cut_blender",
    ]);
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("tools/call —— 调得动就回内容", async () => {
    const res = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "magnet_analyze", arguments: { path: "a.obj" } },
      },
      handlers()
    );
    const result = res?.result as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("分析结果");
  });

  it("tools/call —— 工具不存在回 -32602(协议层错误,不是「工具跑失败」)", async () => {
    const res = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "magnet_nope", arguments: {} },
      },
      handlers()
    );
    expect(res?.error?.code).toBe(MCP_ERROR_CODES.INVALID_PARAMS);
    expect(res?.error?.message).toContain("magnet_nope");
    expect(res?.result).toBeUndefined();
  });

  it("工具自己炸了 —— 也给一份看得懂的内容(标成 isError)", async () => {
    const res = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "magnet_cut", arguments: {} },
      },
      {
        magnet_cut: async () => {
          throw new Error("文件不存在:C:\\models\\a.obj");
        },
      }
    );
    const result = res?.result as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("文件不存在");
  });

  it("不认识的方法回 -32601", async () => {
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 7, method: "nope" },
      handlers()
    );
    expect(res?.error?.code).toBe(MCP_ERROR_CODES.METHOD_NOT_FOUND);
  });

  it("不是 JSON-RPC 2.0 回 -32600", async () => {
    const res = await handleMcpRequest(
      { jsonrpc: "1.0", id: 8, method: "ping" } as never,
      handlers()
    );
    expect(res?.error?.code).toBe(MCP_ERROR_CODES.INVALID_REQUEST);
  });

  it("handleMcpLine —— 一行一个 JSON;解不了就回 parse error", async () => {
    const bad = await handleMcpLine("{ 这不是 JSON", handlers());
    expect(bad).not.toBeNull();
    const parsed = JSON.parse(bad!) as { error: { code: number } };
    expect(parsed.error.code).toBe(MCP_ERROR_CODES.PARSE_ERROR);

    // 空行 ⇒ 什么都不回
    expect(await handleMcpLine("   ", handlers())).toBeNull();
    // 通知 ⇒ 不回
    expect(
      await handleMcpLine(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        handlers()
      )
    ).toBeNull();
  });
});

describe("MCP 的输出排版 —— 说人话", () => {
  it("判定 → 人话", () => {
    expect(verdictText("ok")).toBe("可以切");
    expect(verdictText("too_thin")).toContain("捅穿");
    expect(verdictText("edge_spill")).toContain("切到边上");
    expect(verdictText("no_hit")).toContain("没有面");
  });

  it("模型状态 —— 好的模型说「一个字节都没改」", () => {
    expect(
      describeRepair({
        changed: false,
        cappedLoops: 0,
        weldedNearDuplicates: 0,
      } as never)
    ).toContain("一个字节都没改");
  });

  it("模型状态 —— 破口是**临时**封上的(切完摘掉)", () => {
    const text = describeRepair({
      changed: false,
      cappedLoops: 2,
      lidFaces: 2,
      weldedNearDuplicates: 0,
    } as never);
    expect(text).toContain("临时封上了");
    expect(text).toContain("不会多出几何");
  });

  it("分析报告 —— 关键的数都在(体积 / 孔参数 / 候选面 / 状态)", () => {
    const text = formatAnalyzeReport(
      {
        faces: [
          {
            faceId: "posZ",
            direction: [0, 0, 1],
            hit: true,
            flatnessDeg: 0,
            point: [0, 0, 0],
            normal: [0, 0, 1],
            thicknessMm: 10,
            clearanceMm: 5,
            verdict: "ok",
          },
        ],
        backFace: {
          areaMm2: 1600,
          meanDeviationDeg: 0,
          thicknessMm: 10,
          clearanceMm: 5,
          normal: [0, 0, 1],
          point: [0, 0, 0],
          verdict: "ok",
        },
        patches: [],
        volume: 64000,
        bboxMin: [0, 0, 0],
        bboxMax: [40, 40, 40],
        repair: null,
      } as never,
      {
        path: "C:/models/a.obj",
        holeDiaMm: 20.7,
        holeDepthMm: 1.3,
      }
    );
    expect(text).toContain("64000.00 mm³");
    expect(text).toContain("Ø20.70mm");
    expect(text).toContain("深 1.30mm");
    expect(text).toContain("可以切");
    expect(text).toContain("posZ");
  });

  it("分析报告 —— 坐标不像毫米时要**提醒**(不悄悄缩放)", () => {
    const text = formatAnalyzeReport(
      {
        faces: [],
        backFace: null,
        patches: [],
        volume: 8,
        bboxMin: [0, 0, 0],
        bboxMax: [2, 2, 2],
        repair: null,
      } as never,
      {
        path: "C:/models/a.obj",
        holeDiaMm: 20.7,
        holeDepthMm: 1.3,
        looksLikeNotMillimeters: true,
        maxEdge: 2,
      }
    );
    expect(text).toContain("⚠️");
    expect(text).toContain("不是毫米");
  });

  it("切割报告 —— 实际去掉多少 vs 理论去掉多少都摆出来", () => {
    const text = formatCutReport(
      {
        positions: new Float32Array(0),
        volumeBefore: 64000,
        volumeAfter: 63563.21,
        removedVolume: 436.79,
        expectedRemovedVolume: 436.79,
        triangleCount: 268,
        uvs: null,
        materialIndex: null,
        materialNames: null,
      },
      {
        outPath: "C:/out/cut.obj",
        holeDiaMm: 20.7,
        holeDepthMm: 1.3,
        targetText: "智能识别出来的最大平面(auto)",
      }
    );
    expect(text).toContain("63563.21");
    expect(text).toContain("436.79");
    expect(text).toContain("268");
  });
});

describe("MCP 服务器那个脚本", () => {
  const script = "scripts/magnet-mcp-server.ts";

  it("在仓库里,package.json 登记了那条命令", () => {
    expect(existsSync(join(ROOT, script))).toBe(true);
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["magnet:mcp"]).toContain("scripts/magnet-mcp-server.ts");
  });

  it("引擎是**同一份代码**(不是另写一套 MCP 版算法)", () => {
    const src = read(script);
    expect(src).toContain("magnet-cutter-handler");
    expect(src).toContain("analyzeModel");
    expect(src).toContain("cutMagnetPocket");
  });

  it("只跟 127.0.0.1 说话(Blender 那条路)", () => {
    const src = read(script);
    expect(src).toContain("http://127.0.0.1:");
    expect(src).not.toContain("http://localhost:");
    expect(src).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  });

  it("stdout 是协议通道 —— 日志一律走 stderr", () => {
    const src = read(script);
    expect(src).toContain("process.stderr.write");
    // stdout 只写 JSON-RPC 响应那一处
    const stdoutWrites = src.match(/process\.stdout\.write/g) ?? [];
    expect(stdoutWrites.length).toBe(1);
  });

  it("不进工单(不碰报价 / 工单 / R2 那条链路)", () => {
    const src = read(script);
    for (const forbidden of [
      "print-order",
      "print_order",
      "api/print-orders",
      "R2_",
      "presign",
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("不悄悄缩放模型 —— 只提醒", () => {
    const src = read(script);
    expect(src).toContain("detectModelUnitScale");
    expect(src).not.toContain("scalePositions");
    expect(src).not.toContain("scalePositionsXYZ");
  });

  it("协议层在 src/ 里(能进 unit project 跑单测)", () => {
    expect(
      existsSync(join(ROOT, "src/features/magnet/lib/mcp-protocol.ts"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "src/features/magnet/lib/mcp-report.ts"))
    ).toBe(true);
  });
});
