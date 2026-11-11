/**
 * 「本地 Blender」那条路 —— 驱动**用户自己电脑上**那个 Blender
 *
 * ## 为什么是这条路
 *
 * 工作室的脚本原本只能在工作室本地的 Blender 里跑 —— 客户拿不到这个能力。
 * 浏览器那条路(Manifold3D)现在**会自己修**(补洞 / 剔重复面 / 拆蝴蝶结
 * 顶点 / 翻绕序),大多数破模型都能切了 —— 但**自相交**那种修不了的,
 * Blender 那边的容错(EXACT → FAST 兜底 + 一堆修复 pass)还能治。
 *
 * 所以:**让用户自己装一个插件,切孔在他自己的机器上跑**(这条是**兜底**,
 * 不是必经之路)。
 *
 * ## 三条硬规矩
 *
 * 1. **模型不出这台电脑** —— 走 `http://127.0.0.1:<端口>`,不是我们的服务器。
 *    没有上传、没有登录、没有 API 路由。
 * 2. **只跟 127.0.0.1 说话** —— `blenderBaseUrl()` 写死回环地址,
 *    端口以外的东西一概不接受(别让它变成一个能往公网发数据的代理)。
 * 3. **每个失败都有稳定的 code** —— 界面按 code 查文案(见 `magnet-error.ts`)。
 *
 * ## 混合内容 / 私有网络
 *
 * - **混合内容**:Chrome / Firefox / Safari 都把 `http://127.0.0.1` 当成
 *   「可信来源」(potentially trustworthy),所以 https 页面 fetch 它**不会**
 *   被拦。
 * - **私有网络访问**(Chrome PNA):公网页面访问本机地址属于「私有网络请求」,
 *   插件那边必须回 `Access-Control-Allow-Private-Network: true`
 *   (插件里已经带了)。Safari 早期版本会直接拦 —— 那种情况下界面要能说清楚
 *   「换 Chrome / Edge」。
 *
 * ## 网页**起不了**本机程序 —— 「一键启动」只能是下载一个脚本
 *
 * 浏览器没有「启动本机 exe」的能力(更没有理由给它这个能力)。所以页面
 * **只能连接一个已经在跑的桥接**,不能自己把 Blender 拉起来。
 *
 * ⇒ 「一键启动便携版 Blender」落地成**下载一个启动脚本**:
 * `public/magnet/start_blender.cmd`(Windows)/ `start_blender.sh`(macOS /
 * Linux)。脚本自己找 blender.exe(便携版解压出来的 / 装好的),带上
 * `--python blender_bridge.py` 把桥接拉起来。用户双击一下就行。
 *
 * ## 纯函数优先
 *
 * `fetchImpl` 是**注入**的 —— 单测里塞一个假 fetch 就能验协议和错误映射,
 * 不用起浏览器、不用装 Blender。
 */

import type { MagnetErrorCode } from "./magnet-cutter-protocol";
import type { MagnetHoleParams } from "./magnet-params";

/** 默认端口 —— 插件那边也是这个 */
export const MAGNET_BLENDER_DEFAULT_PORT = 8765;

/** 端口的合法范围 */
export const MAGNET_BLENDER_PORT_MIN = 1024;
export const MAGNET_BLENDER_PORT_MAX = 65535;

/**
 * 用哪条引擎切孔
 *
 * - `browser` —— 浏览器里的 Manifold3D(默认,什么都不用装)
 * - `blender` —— 用户自己电脑上的 Blender(要装插件)
 */
export type MagnetEngine = "browser" | "blender";

/**
 * 端口 → 合法端口
 *
 * 非法值(NaN / 越界)一律退回默认端口 —— **别让用户填错一个端口
 * 就连到一个别的地方去**。
 */
export function normalizeBlenderPort(port: number | string): number {
  const n = Math.trunc(Number(port));
  if (!Number.isFinite(n)) return MAGNET_BLENDER_DEFAULT_PORT;
  if (n < MAGNET_BLENDER_PORT_MIN || n > MAGNET_BLENDER_PORT_MAX) {
    return MAGNET_BLENDER_DEFAULT_PORT;
  }
  return n;
}

/**
 * 本地 Blender 的地址
 *
 * **写死回环地址** —— 不接受别的 host(见文件头「三条硬规矩」第 2 条)。
 */
export function blenderBaseUrl(port: number | string): string {
  return `http://127.0.0.1:${normalizeBlenderPort(port)}`;
}

/** 插件的版本号 —— 网页端和插件要对得上(对不上 → `BLENDER_BAD_RESPONSE`) */
export const MAGNET_BLENDER_PROTOCOL_VERSION = 1;

/**
 * 便携版 Blender 的官方下载地址
 *
 * 官网上每个版本都给了「Windows 便携版(.zip)」—— 解压就能用,不用装。
 * 页面把用户指到这里。
 */
export const MAGNET_BLENDER_PORTABLE_URL = "https://www.blender.org/download/";

/**
 * 插件包(能直接装进 Blender 的那个 zip)的下载地址
 *
 * 工作室 2026-11-11 的原话:**「在 Blender 里 Scripting → 新建文本 → 把插件
 * 粘进去 → Run Script,桥接就起了。做出插件」** —— 「粘进去跑一下」太别扭,
 * 用户得自己动手。
 *
 * ⇒ 页面给的是**这个 zip**:
 * `Edit → Preferences → Add-ons → Install from Disk… → 选它 → 勾上启用`。
 * 装完**一打开 Blender 桥接就自动起了**(端口在插件偏好里改)。
 *
 * zip 是**构建产物**(`pnpm magnet:addon`),内容就是
 * `public/magnet/blender_bridge.py` 那份实现(原样拷进去)⇒ 插件跟网页那份
 * 永远是一个东西,不会漂。
 */
export const MAGNET_BLENDER_ADDON_ZIP_URL = "/magnet/mooncoda_magnet_bridge.zip";

/**
 * 桥接脚本(`.py`)的下载地址
 *
 * **给「不装插件」那条路用的** —— 一键启动脚本要 `--python blender_bridge.py`,
 * 所以那个 `.py` 得跟启动脚本放在同一个文件夹里。
 *
 * 装成插件的话用不着这个(插件包里已经带了同一份实现)。
 */
export const MAGNET_BLENDER_ADDON_URL = "/magnet/blender_bridge.py";

/**
 * 一键启动脚本(Windows)
 *
 * **网页永远起不了本机程序** —— 所以「一键启动」只能是**下载一个脚本**,
 * 让用户双击它:脚本自己找到 blender.exe,带上 `--python blender_bridge.py`
 * 把桥接拉起来。
 *
 * 以前用户得手工:开 Blender → Scripting → 新建 → 粘脚本 → Run Script。
 * 现在两条路都能走:
 * - **装成插件**(推荐):下载 zip → Preferences → Add-ons → 装上 → 勾上启用
 *   ⇒ 一打开 Blender 桥接就自动起了(见 `MAGNET_BLENDER_ADDON_ZIP_URL`)
 * - **不装任何东西**:下载这个启动脚本 + 那份 `.py`,放同一个文件夹,双击就完事
 */
export const MAGNET_BLENDER_LAUNCHER_URL = "/magnet/start_blender.cmd";

/** 一键启动脚本(macOS / Linux) */
export const MAGNET_BLENDER_LAUNCHER_SH_URL = "/magnet/start_blender.sh";

/** ping 的超时(ms)—— 本机回环,慢一点就说明插件没起 */
export const MAGNET_BLENDER_PING_TIMEOUT_MS = 2500;

/** 切割的超时(ms)—— 大模型在 Blender 里切要好几分钟 */
export const MAGNET_BLENDER_CUT_TIMEOUT_MS = 10 * 60 * 1000;

/** 本地 Blender 那边的错 —— 带稳定的 code,界面按 code 查文案 */
export class BlenderLocalError extends Error {
  readonly code: MagnetErrorCode;
  /** 插件自己说的原因(能显示给人看的那种) */
  readonly detail: string | null;

  constructor(code: MagnetErrorCode, message: string, detail?: string | null) {
    super(message);
    this.name = "BlenderLocalError";
    this.code = code;
    this.detail = detail ?? null;
  }
}

/** ping 的结果 */
export type BlenderPingResult = {
  /** 插件版本 */
  addOn: string;
  /** Blender 版本(比如 "4.2.1") */
  blender: string;
  /** 协议版本 —— 跟网页端对不上就是「插件太旧 / 太新」 */
  protocol: number;
};

/** 切完之后插件报回来的数 */
export type BlenderCutStats = {
  /** 切之前的体积(mm³) */
  volumeBeforeMm3: number | null;
  /** 切之后的体积(mm³) */
  volumeAfterMm3: number | null;
  /** 实际去掉多少(mm³) */
  removedVolumeMm3: number | null;
  /** 理论上应该去掉多少(mm³) */
  expectedRemovedVolumeMm3: number | null;
  /** 切完的三角形数 */
  triangleCount: number | null;
  /** 切的是哪块面(描述性文字,比如 "最大平面 1234.5mm²") */
  face: string | null;
  /** 用的哪个求解器(EXACT / FAST) */
  solver: string | null;
  /** 插件那边顺带提的提醒(比如「模型不是封闭的,已尽力修复」) */
  warnings: string[];
  /**
   * 临时封上了几处破口
   *
   * **这是「不修用户的模型」那条口径的证据** —— 破口封上只是为了切,
   * 切完就摘掉(`lidStripped` 是摘掉了几张盖面)。
   */
  lidCapped: number | null;
  /** 临时盖面一共几张 */
  lidFaces: number | null;
  /** 切完摘掉了张盖面(用户的模型上不多出几何) */
  lidStripped: number | null;
};

/** 切完的结果 —— zip(OBJ + MTL + 纹理)+ 一堆数 */
export type BlenderCutResult = {
  /** 打包好的 zip */
  blob: Blob;
  /** 插件报回来的数 */
  stats: BlenderCutStats;
};

/** 能注入的 fetch —— 单测里塞假实现 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string> | undefined;
    body?: BodyInit | null | undefined;
    signal?: AbortSignal | undefined;
  }
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export type LocalBlenderOptions = {
  /** 端口 */
  port: number | string;
  /** 注入的 fetch(单测用) */
  fetchImpl?: FetchLike;
  /** 超时(ms) */
  timeoutMs?: number;
};

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch === "function") {
    // cast —— 浏览器 fetch 的签名比这个类型宽
    return fetch as unknown as FetchLike;
  }
  throw new BlenderLocalError(
    "BLENDER_NOT_RUNNING",
    "这个浏览器不支持 fetch —— 换 Chrome / Edge 试试"
  );
}

/** 本地插件那边回来的响应(只留我们要的那几样) */
type LocalResponse = {
  arrayBuffer: ArrayBuffer;
  contentType: string | null;
  headers: { get(name: string): string | null };
};

/**
 * 带超时的 fetch
 *
 * **超时和网络不通要分开放**:
 * - 连不上(连接被拒)⇒ `BLENDER_NOT_RUNNING`(插件没起)
 * - 连上了但没回话 ⇒ `BLENDER_TIMEOUT`(插件卡住了)
 */
async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    timeoutMs: number;
  }
): Promise<LocalResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
    const arrayBuffer = await res.arrayBuffer();
    return {
      arrayBuffer,
      contentType: res.headers.get("content-type"),
      headers: res.headers,
    };
  } catch (err) {
    if (timedOut) {
      throw new BlenderLocalError(
        "BLENDER_TIMEOUT",
        "本地 Blender 没在规定时间内回话"
      );
    }
    // fetch 抛 TypeError = 连不上(连接被拒 / 插件没起 / 端口被防火墙拦了)
    throw new BlenderLocalError(
      "BLENDER_NOT_RUNNING",
      "连不上本地 Blender",
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探一下本地 Blender 在不在
 *
 * **探活不是「要不要用本地那条路」的判据** —— 用户没装插件很正常,
 * 界面要能一边探一边说人话,不能因此把「浏览器那条路」也堵上。
 */
export async function pingLocalBlender(
  options: LocalBlenderOptions
): Promise<BlenderPingResult> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const base = blenderBaseUrl(options.port);
  const timeoutMs = options.timeoutMs ?? MAGNET_BLENDER_PING_TIMEOUT_MS;

  const url = `${base}/ping`;
  let res: LocalResponse;
  try {
    res = await fetchWithTimeout(fetchImpl, url, {
      method: "GET",
      headers: { "x-magnet-protocol": String(MAGNET_BLENDER_PROTOCOL_VERSION) },
      timeoutMs,
    });
  } catch (err) {
    if (err instanceof BlenderLocalError) {
      // **保留原来的 code** —— 「连不上」(插件没起)和「没回话」(插件卡住)
      // 是两回事,别压成同一个。
      if (err.code === "BLENDER_TIMEOUT") {
        // 插件起着呢、就是没回话 —— 补一句「别急」
        throw new BlenderLocalError(
          err.code,
          err.message,
          `插件收到了但没回话 —— 大模型可能要切好几分钟,别重复点`
        );
      }
      throw new BlenderLocalError(
        err.code,
        "连不上本地 Blender",
        `插件没起?确认它在跑、端口是 ${normalizeBlenderPort(options.port)}`
      );
    }
    throw err;
  }

  let payload: Partial<BlenderPingResult> = {};
  try {
    const text = new TextDecoder().decode(res.arrayBuffer);
    payload = JSON.parse(text) as Partial<BlenderPingResult>;
  } catch {
    throw new BlenderLocalError(
      "BLENDER_BAD_RESPONSE",
      "本地 Blender 回的不是预期的内容",
      "ping 的响应不是 JSON —— 插件版本可能对不上"
    );
  }

  if (
    typeof payload.protocol === "number" &&
    payload.protocol !== MAGNET_BLENDER_PROTOCOL_VERSION
  ) {
    throw new BlenderLocalError(
      "BLENDER_BAD_RESPONSE",
      "插件版本跟网页端对不上",
      `插件协议 ${payload.protocol} / 网页端要 ${MAGNET_BLENDER_PROTOCOL_VERSION} —— 重新下载插件`
    );
  }

  return {
    addOn: typeof payload.addOn === "string" ? payload.addOn : "unknown",
    blender: typeof payload.blender === "string" ? payload.blender : "unknown",
    protocol:
      typeof payload.protocol === "number"
        ? payload.protocol
        : MAGNET_BLENDER_PROTOCOL_VERSION,
  };
}

/**
 * 让本地 Blender 切孔
 *
 * 发过去的是**已经按打印尺寸缩放好的**几何(浏览器那边缩的)——
 * 「看到的」跟「切的」是同一份,两个引擎对尺寸和朝向的判断才不会打架。
 *
 * @param zip 打包好的模型(OBJ + MTL + 纹理)
 * @param hole 孔参数(绝对毫米)
 */
export async function cutWithLocalBlender(
  options: LocalBlenderOptions & {
    zip: Blob;
    hole: MagnetHoleParams;
  }
): Promise<BlenderCutResult> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const base = blenderBaseUrl(options.port);
  const timeoutMs = options.timeoutMs ?? MAGNET_BLENDER_CUT_TIMEOUT_MS;

  const params = JSON.stringify({
    holeDiaMm: options.hole.holeDiaMm,
    holeDepthMm: options.hole.holeDepthMm,
  });

  const res = await fetchWithTimeout(fetchImpl, `${base}/cut`, {
    method: "POST",
    headers: {
      "content-type": "application/zip",
      "x-magnet-params": params,
      "x-magnet-protocol": String(MAGNET_BLENDER_PROTOCOL_VERSION),
    },
    body: options.zip,
    timeoutMs,
  }).catch((err: unknown) => {
    if (err instanceof BlenderLocalError) throw err;
    throw new BlenderLocalError("BLENDER_FAILED", "本地 Blender 那边出错了");
  });

  // 读状态头 —— 出错时插件回的是 JSON(带它自己的原因)
  const statsHeader = res.headers.get("x-magnet-stats");
  const contentType = res.contentType ?? "";
  const isJson = contentType.includes("application/json");
  const isZip = contentType.includes("zip");

  if (isJson) {
    let payload: { error?: string; code?: string } = {};
    try {
      payload = JSON.parse(new TextDecoder().decode(res.arrayBuffer));
    } catch {
      // 解析不了就当通用失败
    }
    throw new BlenderLocalError(
      "BLENDER_FAILED",
      payload.error || "本地 Blender 那边切失败了",
      payload.code ? `code: ${payload.code}` : null
    );
  }

  if (!isZip) {
    throw new BlenderLocalError(
      "BLENDER_BAD_RESPONSE",
      "本地 Blender 回的不是 zip",
      `content-type: ${contentType || "(空)"} —— 插件版本可能对不上`
    );
  }

  const stats = parseStatsHeader(statsHeader);

  return {
    blob: new Blob([res.arrayBuffer], { type: "application/zip" }),
    stats,
  };
}

/** 解析 `x-magnet-stats` 头 —— 解析不了就摆空数组,别炸 */
export function parseStatsHeader(raw: string | null): BlenderCutStats {
  const empty: BlenderCutStats = {
    volumeBeforeMm3: null,
    volumeAfterMm3: null,
    removedVolumeMm3: null,
    expectedRemovedVolumeMm3: null,
    triangleCount: null,
    face: null,
    solver: null,
    warnings: [],
    lidCapped: null,
    lidFaces: null,
    lidStripped: null,
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<BlenderCutStats>;
    return {
      ...empty,
      ...parsed,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch {
    return empty;
  }
}
