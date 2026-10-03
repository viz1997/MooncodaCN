// 公共参考图上传 —— multer multipart 中转 → R2(2026-10-03)
//
// 设计:小程序 wx.uploadFile 强制包 multipart,R2 presign 必须 raw binary +
// 严格 Content-Type,二者互斥(403 SignatureDoesNotMatch)。改为 BFF 用
// multer 收 multipart,转发到 R2 存储。
//
// 客户端契约:见 miniprogram/src/api/custom.ts:uploadImage(2026-10-03)。
// 服务端响应兼容 url / fileURL / fileUrl / fileID / data.* 多种历史字段名。

import { Readable } from "node:stream";
import multer from "multer";
import { type NextRequest, NextResponse } from "next/server";

import {
  getClientIp,
  isR2Configured,
  logImageGen,
  putObject,
} from "@/features/image-gen";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

// multer 依赖 Node.js 运行时(edge 不支持 fs / stream)
export const runtime = "nodejs";
// 5MB 上传 + R2 PUT,Vercel Pro 30s 够;Hobby(10s)大概率不够,提示 server
export const maxDuration = 60;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

// multer 限制 ——5MB 跟客户端 chooseImage sizeType:'compressed' 对齐
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * 把 NextRequest 转成 multer 需要的 Node IncomingMessage 形态。
 *
 * multer(busboy)读 req.headers['content-type'] 找 boundary;然后从
 * req(Readable) 里 pipe 数据。
 *
 * IncomingMessage 必须字段:
 *   - headers:     plain object(小写化头名 multer 才会认)
 *   - method:      'POST'
 *   - url:         请求路径
 *   - httpVersion: '1.1'
 *   - socket/connection: 防 multer 内部访问 remoteAddress 报 undefined
 */
// 用一个最小 internal type —— multer 会自己往 req 上挂 file 字段,
// 运行时 TS 看不到这个 side-effect,这里用 any 兜住。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeRequestWithFile = any;

function toNodeRequest(req: NextRequest): NodeRequestWithFile {
  // Readable.fromWeb 把 Web ReadableStream(NextRequest.body)转 Node Readable
  // NextRequest.body 是 DOM 类型 ReadableStream,node:stream.Readable.fromWeb 期望
  // stream/web.ReadableStream;二者是同名不同模块的 distinct type,nominal check
  // 不通过。这里直接 any 兜住,运行时结构完全兼容。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeStream = Readable.fromWeb(req.body as any);
  // headers 必须 plain object(Next.js Headers.entries() → Record 即可)
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const remoteAddr = getClientIp(req.headers) ?? undefined;
  // 把所有 IncomingMessage 形态字段挂到 stream 上(multer 不会读这些之外的字段,
  // 但 multer 内部可能访问 req.socket.remoteAddress,所以 socket/connection 也补一下)
  Object.assign(nodeStream, {
    headers,
    method: req.method,
    url: req.url,
    httpVersion: "1.1",
    connection: { remoteAddress: remoteAddr },
    socket: { remoteAddress: remoteAddr },
  });
  return nodeStream;
}

/** 把 multer 中间件当 Promise 跑 */
function runMiddleware(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (req: any, res: any, cb: (err?: any) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fn(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // ============ IP 限流(沿用 upload 限流配置) ============
  const rl = await checkRateLimit(ip ?? "unknown", "upload");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // ============ R2 配置检查 ============
  if (!isR2Configured()) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload",
      errorCode: "R2_NOT_CONFIGURED",
      errorMessage: "R2 未配置,参考图直传不可用",
      ip,
    });
    return NextResponse.json(
      { success: false, error: "R2 未配置", code: "R2_NOT_CONFIGURED" },
      { status: 503, headers: getRateLimitHeaders(rl) },
    );
  }

  // ============ multer 解析 multipart ============
  // multer 单文件模式:字段名 'file'(与 MP 端 Taro.uploadFile name='file' 对齐)
  const nodeReq = toNodeRequest(req);
  // multer 内部需要 res.end() 可调,我们用空 res
  const fakeRes = {
    statusCode: 200,
    headersSent: false,
    setHeader: () => {},
    getHeader: () => undefined,
    removeHeader: () => {},
    end: () => {},
    write: () => true,
    on: () => fakeRes,
    once: () => fakeRes,
    emit: () => true,
  };

  try {
    await runMiddleware(
      nodeReq,
      fakeRes,
      upload.single("file"),
    );
  } catch (e: unknown) {
    // multer MulterError.code:
    //   LIMIT_FILE_SIZE / LIMIT_PART_COUNT / LIMIT_UNEXPECTED_FILE
    // 其它(NO_FILE / 缺 boundary 等)统一归 BAD_BODY
    const code =
      typeof e === "object" && e && "code" in e
        ? String((e as { code: unknown }).code)
        : "BAD_BODY";
    const errorMap: Record<string, string> = {
      LIMIT_FILE_SIZE: "文件过大,最大 5MB",
      LIMIT_UNEXPECTED_FILE: "字段名不正确(必须为 file)",
    };
    const msg =
      typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "multer parse";
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload",
      errorCode: code,
      errorMessage: msg,
      ip,
    });
    return NextResponse.json(
      {
        success: false,
        error: errorMap[code] ?? "请求体非法",
        code,
      },
      { status: 400, headers: getRateLimitHeaders(rl) },
    );
  }

  const file = (nodeReq as { file?: {
    buffer: Buffer;
    mimetype: string;
    size: number;
    originalname: string;
  } }).file;

  if (!file) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload",
      errorCode: "BAD_BODY",
      errorMessage: "缺 file 字段",
      ip,
    });
    return NextResponse.json(
      { success: false, error: "缺 file 字段", code: "BAD_BODY" },
      { status: 400, headers: getRateLimitHeaders(rl) },
    );
  }

  // ============ 类型白名单 ============
  if (!ALLOWED_MIME.has(file.mimetype)) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload",
      errorCode: "INVALID_TYPE",
      errorMessage: `mimetype=${file.mimetype}`,
      ip,
    });
    return NextResponse.json(
      {
        success: false,
        error: "格式不支持,仅 JPG/PNG/WEBP",
        code: "INVALID_TYPE",
      },
      { status: 400, headers: getRateLimitHeaders(rl) },
    );
  }

  // ============ 上传 R2(走现成 putObject) ============
  // jpeg 后缀用 .jpg(浏览器/web 上传都用 .jpg),其它直接取 subtype
  const sub = file.mimetype.split("/")[1] ?? "bin";
  const ext = sub === "jpeg" ? "jpg" : sub;
  const objectKey =
    `public-uploads/${new Date().toISOString().slice(0, 10)}/` +
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  try {
    const publicUrl = await putObject({
      objectKey,
      body: file.buffer,
      contentType: file.mimetype,
    });
    logImageGen({
      event: "submit",
      outcome: "success",
      source: "public",
      model: "upload",
      hasRefImage: true,
      ip,
    });
    // 响应字段名兼容 MP 端 custom.ts:uploadImage 的多种历史字段名解析
    return NextResponse.json(
      {
        success: true,
        url: publicUrl,
        fileURL: publicUrl,
        fileUrl: publicUrl,
        fileID: objectKey,
        size: file.size,
        mime: file.mimetype,
      },
      { headers: getRateLimitHeaders(rl) },
    );
  } catch (error) {
    console.error("[Upload → R2 Error]", error);
    const msg = error instanceof Error ? error.message : "未知错误";
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload",
      errorCode: "R2_PUT_FAILED",
      errorMessage: msg,
      ip,
    });
    return NextResponse.json(
      {
        success: false,
        error: `上传 R2 失败: ${msg}`,
        code: "R2_PUT_FAILED",
      },
      { status: 500, headers: getRateLimitHeaders(rl) },
    );
  }
}