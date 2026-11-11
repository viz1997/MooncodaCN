/**
 * 磁吸孔的 **MCP 协议层**
 *
 * ## 为什么要有这个
 *
 * 工作室 2026-11-11 的原话:**「在 Blender 里 Scripting → 新建文本 → 把插件
 * 粘进去 → Run Script,桥接就起了。做出插件,或者 mcp 协议」**。
 *
 * 插件那条路已经做完了(`public/magnet/mooncoda_magnet_bridge.zip`)。这一份
 * 是**另一条路**:让**能驱动 MCP 的 AI 客户端**(Claude Code / Claude Desktop
 * / 任何 MCP host)直接在本机切磁吸孔 —— **不用开网页、不用拖文件**。
 *
 * ## 两条路的分工
 *
 * | | 浏览器那条 | MCP 这条 |
 * |---|---|---|
 * | 谁在前面 | 人 | AI 客户端 |
 * | 模型从哪来 | 拖进来 / 选文件 | 磁盘上的路径 |
 * | 结果去哪 | 下载 | 写回磁盘上的路径 |
 * | 引擎 | Manifold3D(wasm) | **同一个** Manifold3D(在 Node 里跑) |
 *
 * ⇒ **引擎是同一份代码**(`magnet-cutter-handler.ts` 的 `analyzeModel()` /
 * `cutMagnetPocket()`),不是「另写一套 MCP 版算法」。网页上算出来的数,
 * MCP 这边算出来是同一个数。
 *
 * ## 这一层是**纯函数**
 *
 * 零 import(除了类型)—— 不碰文件系统、不碰 wasm、不碰网络。
 * ⇒ 能进 `unit` project 跑单测(`src/test/magnet/pure/magnet-mcp.test.ts`),
 * 不用起浏览器、不用装 Blender。
 *
 * **真正干活的那一半在 `scripts/magnet-mcp-server.ts`** —— 它负责读文件、
 * 调引擎、写文件,并且把本文件的 `handleMcpRequest()` 接到 stdio 上。
 *
 * ## 传输:stdio 上的「按行 JSON」
 *
 * MCP 的 stdio 传输是**一行一个 JSON-RPC 消息**(不是 LSP 那种
 * `Content-Length` 分帧)⇒ 每行独立解析,不用管消息边界。
 *
 * ⚠️ **stdout 是传输通道** —— 服务器往 stdout 写的东西**只有 JSON-RPC 响应**。
 * 任何日志都得走 stderr(写 stdout 一行日志就把协议搅乱了)。
 */

/** 服务器名字(MCP 客户端里显示的那一条) */
export const MCP_SERVER_NAME = "mooncoda-magnet";

/** 服务器版本 */
export const MCP_SERVER_VERSION = "1.0.0";

/**
 * 支持的 MCP 协议版本(从新到旧)
 *
 * 客户端 `initialize` 时会报它要的版本 —— **它要的那个我们支持就照它那版回**,
 * 不支持就回我们最新的一版(客户端会自己降级)。
 */
export const MCP_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

/** 协议版本类型 */
export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

/** JSON-RPC 2.0 的错误码 */
export const MCP_ERROR_CODES = {
  /** JSON 解析失败 */
  PARSE_ERROR: -32700,
  /** 请求本身不合法(不是 JSON-RPC 2.0 / method 缺失) */
  INVALID_REQUEST: -32600,
  /** 方法不存在 */
  METHOD_NOT_FOUND: -32601,
  /** 参数不合法(工具不存在 / 参数缺失) */
  INVALID_PARAMS: -32602,
  /** 服务器内部出错 */
  INTERNAL_ERROR: -32603,
} as const;

// ---------------------------------------------------------------------------
// JSON-RPC 的形状
// ---------------------------------------------------------------------------

/** 客户端发来的请求 */
export type McpRequest = {
  jsonrpc: "2.0";
  /**
   * 请求 id
   *
   * **没有这个字段就是「通知」** —— 服务器不能回(回了他也不认)。
   */
  id?: string | number | null;
  method: string;
  params?: unknown;
};

/** 服务器回给客户端的响应 */
export type McpResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

/** 工具跑完的结果 */
export type McpToolResult = {
  /** 内容块 —— 现在只有 `text` 一种,但格式是数组(协议要求) */
  content: { type: "text"; text: string }[];
  /** 跑失败了 —— 内容还在,但标成失败(客户端会把它显示成错误) */
  isError?: boolean;
};

/** 一个工具的处理器 */
export type McpToolHandler = (
  args: Record<string, unknown>
) => Promise<McpToolResult> | McpToolResult;

/** 工具名 → 处理器 */
export type McpToolHandlers = Record<string, McpToolHandler>;

/** 工具清单里的一项 */
export type McpToolDescriptor = {
  name: string;
  description: string;
  /** JSON Schema(必须是 `type: "object"`) */
  inputSchema: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// 工具清单
// ---------------------------------------------------------------------------

/**
 * 孔参数的公共部分
 *
 * **绝对毫米** —— 磁铁是固定尺寸的实体,孔径不跟模型缩放(工作室 2026-11-11
 * 定的口径)。
 */
const HOLE_PROPERTIES = {
  holeDiaMm: {
    type: "number",
    description:
      "磁吸孔直径(mm,绝对毫米,不跟模型缩放)。默认 20.7(实物磁铁的直径)",
  },
  holeDepthMm: {
    type: "number",
    description: "磁吸沉孔深度(mm,绝对毫米)。默认 1.3",
  },
} as const;

/** MCP 工具清单 */
export const MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "magnet_analyze",
    description:
      "分析一个 3D 模型(OBJ 文件):模型尺寸 / 体积、能不能切磁吸孔、智能识别出来的最大平面(背面)、每个候选面的平整度 / 局部厚度 / 净空。只读 —— 不改文件、不切孔。切之前先跑它。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "OBJ 文件的本机路径(绝对路径)",
        },
        ...HOLE_PROPERTIES,
      },
      required: ["path"],
    },
  },
  {
    name: "magnet_cut",
    description:
      "在一个 3D 模型(OBJ 文件)上切一个磁吸沉孔,结果写回磁盘。孔径 / 深度是绝对毫米,不跟模型缩放;默认切在智能识别出来的最大平面上(可以用 target 指定别的平面)。模型不是封闭实体时会临时封上破口再切,切完原样还给你 —— 你的模型上不会多出任何几何。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "输入 OBJ 文件的本机路径(绝对路径)",
        },
        outPath: {
          type: "string",
          description: "输出 OBJ 文件的本机路径(绝对路径)",
        },
        target: {
          type: "string",
          description:
            '切哪个面:"auto"(默认,智能识别出来的最大平面)、"patch:N"(第 N 块候选平面,下标从 0 起,见 magnet_analyze 的输出)、或者六个轴向面之一(posX/negX/posY/negY/posZ/negZ)',
        },
        ...HOLE_PROPERTIES,
      },
      required: ["path", "outPath"],
    },
  },
  {
    name: "magnet_cut_blender",
    description:
      "在用户自己电脑上的 Blender 里切磁吸沉孔(自相交那种 Manifold 布尔算不出来的模型走这条)。需要本机的 Mooncoda Magnet Bridge 插件在跑(装成插件之后一打开 Blender 就自动起)。结果写回磁盘。模型只送到 127.0.0.1,不出这台电脑。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "输入 OBJ 文件的本机路径(绝对路径)",
        },
        outPath: {
          type: "string",
          description: "输出 OBJ 文件的本机路径(绝对路径)",
        },
        port: {
          type: "number",
          description:
            "本地 Blender 桥接的端口。默认 8765(改过端口的话填实际的)",
        },
        ...HOLE_PROPERTIES,
      },
      required: ["path", "outPath"],
    },
  },
];

// ---------------------------------------------------------------------------
// 工具结果的小助手
// ---------------------------------------------------------------------------

/** 摆一段纯文本 */
export function mcpText(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * 摆一段「跑失败了」的文本
 *
 * **失败也要说人话** —— 内容照样给(客户端能看见到底为什么),
 * 再加 `isError: true` 让客户端把它标成错误。
 */
export function mcpError(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// JSON-RPC 处理
// ---------------------------------------------------------------------------

/** 造一个成功响应 */
function ok(id: string | number | null, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id, result };
}

/** 造一个错误响应 */
function fail(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): McpResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/**
 * 协议版本怎么定
 *
 * 客户端要的那版**我们支持**就照它那版回(客户端最舒服);不支持就回最新的一版
 * (客户端会自己降级)。
 */
export function negotiateProtocolVersion(requested: unknown): string {
  if (
    typeof requested === "string" &&
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return MCP_PROTOCOL_VERSIONS[0];
}

/**
 * 处理一条 JSON-RPC 请求
 *
 * @param request 客户端发来的请求
 * @param handlers 工具名 → 处理器
 * @returns 响应;**通知(没有 id)返回 null** —— 通知不能回
 */
export async function handleMcpRequest(
  request: McpRequest,
  handlers: McpToolHandlers
): Promise<McpResponse | null> {
  const isNotification = request.id === undefined;
  const id = request.id ?? null;

  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    // 通知不合法就不回(回了他也不认)
    if (isNotification) return null;
    return fail(
      id,
      MCP_ERROR_CODES.INVALID_REQUEST,
      "这不是一条合法的 JSON-RPC 2.0 请求"
    );
  }

  switch (request.method) {
    case "initialize": {
      const params = (request.params ?? {}) as { protocolVersion?: unknown };
      if (isNotification) return null;
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
      });
    }

    // 通知 —— 客户端确认握手完了,不用回
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      if (isNotification) return null;
      return ok(id, {});

    case "tools/list":
      if (isNotification) return null;
      return ok(id, { tools: MCP_TOOLS });

    case "resources/list":
      if (isNotification) return null;
      return ok(id, { resources: [] });

    case "prompts/list":
      if (isNotification) return null;
      return ok(id, { prompts: [] });

    case "tools/call": {
      if (isNotification) return null;
      const params = (request.params ?? {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      const name = typeof params.name === "string" ? params.name : "";
      const handler = handlers[name];
      if (!handler) {
        // MCP 规范:工具不存在 → 协议层错误(不是「工具跑失败了」)
        return fail(
          id,
          MCP_ERROR_CODES.INVALID_PARAMS,
          `Unknown tool: ${name || "(没给名字)"}`
        );
      }
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const result = await handler(args);
        return ok(id, result);
      } catch (err) {
        // 工具自己炸了 —— 也给一份能看懂的内容,别只回一个「internal error」
        const message = err instanceof Error ? err.message : String(err);
        return ok(id, {
          content: [{ type: "text", text: `工具跑失败了:${message}` }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return fail(
        id,
        MCP_ERROR_CODES.METHOD_NOT_FOUND,
        `Unknown method: ${request.method}`
      );
  }
}

/**
 * 处理**一行**stdin 里的消息
 *
 * @param line 一行 JSON
 * @param handlers 工具名 → 处理器
 * @returns 要写回 stdout 的那一行(JSON);**没有要回的**(通知)返回 null
 */
export async function handleMcpLine(
  line: string,
  handlers: McpToolHandlers
): Promise<string | null> {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // JSON 都解不了 —— 回一个 parse error(id 用 null)
    return JSON.stringify(
      fail(null, MCP_ERROR_CODES.PARSE_ERROR, "这一行不是合法的 JSON")
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return JSON.stringify(
      fail(null, MCP_ERROR_CODES.INVALID_REQUEST, "请求不是 JSON-RPC 对象")
    );
  }

  const response = await handleMcpRequest(parsed as McpRequest, handlers);
  return response ? JSON.stringify(response) : null;
}
