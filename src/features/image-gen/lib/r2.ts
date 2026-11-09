// Cloudflare R2 / S3 直传工具（公共生图参考图上传）
// 与 Mooncoda 现有 /api/upload/presigned 独立，使用 R2_* 环境变量，免登录场景适用
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET ?? "mooncada-public";
// 例如 https://cdn.example.com 或 https://pub-xxx.r2.dev
const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

let cachedClient: S3Client | null = null;

export function isR2Configured(): boolean {
  return Boolean(accountId && accessKeyId && secretAccessKey);
}

export function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      "R2 未配置：请在环境变量中设置 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY"
    );
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    });
  }
  return cachedClient;
}

export function getPublicUrl(objectKey: string): string {
  if (publicBaseUrl) {
    const base = publicBaseUrl.replace(/\/$/, "");
    return `${base}/${objectKey}`;
  }
  return `${endpoint}/${bucket}/${objectKey}`;
}

export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
  objectKey: string;
  headers: Record<string, string>;
}

export async function presignUpload(opts: {
  objectKey: string;
  contentType: string;
  expiresIn?: number;
  /**
   * 精确的字节数 —— 传了就把它签进签名里。
   *
   * 客户端必须原样带回这个 Content-Length,否则 R2 判定签名不符。
   * 这就是「声明多大就最多能传多大」的强制手段:光校验声明值没用,
   * 客户端可以声明 1KB 然后 PUT 1GB。
   *
   * 浏览器 fetch 传 Blob 时会自动带上正确的 Content-Length,不用手动设。
   */
  contentLength?: number;
}): Promise<PresignResult> {
  const client = getR2Client();
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: opts.objectKey,
    ContentType: opts.contentType,
    ...(opts.contentLength !== undefined
      ? { ContentLength: opts.contentLength }
      : {}),
  });
  const uploadUrl = await getSignedUrl(client, cmd, {
    expiresIn: opts.expiresIn ?? 300,
  });
  return {
    uploadUrl,
    publicUrl: getPublicUrl(opts.objectKey),
    objectKey: opts.objectKey,
    headers: { "Content-Type": opts.contentType },
  };
}

/**
 * 公开访问域名配了没有
 *
 * `getPublicUrl()` 在没配 `R2_PUBLIC_BASE_URL` 时会退化成 S3 API 地址
 * (`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`)—— 那个地址在
 * 浏览器里**打不开**(要签名),拿它当 `<img src>` 就是一个裂图。
 *
 * 所以后台的文件管理页要先问一句这个:配了才能摆缩略图 / 直接预览。
 */
export function hasPublicBase(): boolean {
  return Boolean(publicBaseUrl);
}

/**
 * 签一个**下载**用的临时 URL(GetObject)
 *
 * ## 为什么不用公开链接下载
 *
 * 公开链接要求「这个对象是公开可读的」。桶里的对象**不一定**都是公开的,而且
 * 公开链接一旦发出去就长期有效 —— 工作室把模型文件链接发到微信里,那条链接
 * 就一直能用。签名 URL 有时效(默认 15 分钟),下载完就废。
 *
 * ## 强制下载
 *
 * 给 `filename` 就带上 `response-content-disposition: attachment` —— 浏览器
 * 直接把文件存下来,而不是在标签页里打开(模型 zip 在浏览器里打开就是一堆
 * 乱码)。
 *
 * 这个参数是**签进签名里**的(走 `GetObjectCommand` 的 `ResponseContentDisposition`,
 * 不是事后往 URL 上挂 query)—— 事后挂会让签名对不上。
 *
 * ## 失败语义
 *
 * 对象不存在 → 抛错(调用方决定是 404 还是别的)。
 */
export async function presignDownload(
  objectKey: string,
  opts: { expiresIn?: number; filename?: string } = {}
): Promise<string> {
  const client = getR2Client();
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ...(opts.filename
      ? {
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
        }
      : {}),
  });
  return getSignedUrl(client, cmd, { expiresIn: opts.expiresIn ?? 900 });
}

/**
 * 列出桶里的对象 —— 后台文件管理页用
 *
 * ## delimiter 是干什么的
 *
 * `Delimiter: "/"` 让 R2 在「这一层」停下:
 *
 * - `CommonPrefixes` = 这一层的**子目录**(以 `/` 结尾的前缀)
 * - `Contents` = 这一层**直接放着**的文件
 *
 * 这正好是文件管理页要的「文件夹 + 文件」两层视图。不用 delimiter 的话
 * 一次会把这个前缀下**所有**子目录的文件全倒出来。
 *
 * ## 翻页
 *
 * 返回 `nextContinuationToken` —— 下一次带着它再调一次就接着往后翻。
 * 这个 token 是**不透明**的,只能原样传回去,别自己拼。
 *
 * 注意:带 delimiter 时,一次返回的条目数(目录 + 文件)合起来算 `MaxKeys`。
 */
export interface R2ObjectSummary {
  /** 对象键(完整路径) */
  key: string;
  /** 字节数 */
  size: number;
  /** 最后修改时间(ISO 字符串) */
  lastModified: string;
  /** ETag(去掉引号) */
  etag: string;
}

/** 一次列目录的结果 */
export interface R2Listing {
  /** 这一层直接放着的文件 */
  objects: R2ObjectSummary[];
  /** 这一层的子目录(以 `/` 结尾的前缀) */
  prefixes: string[];
  /** 下一页的游标;null = 没有下一页 */
  nextContinuationToken: string | null;
  /** 还有没有下一页 */
  isTruncated: boolean;
}

export async function listObjects(
  opts: {
    /** 只看这个前缀下面的 */
    prefix?: string;
    /** 目录分隔符 —— 后台文件管理页传 `"/"` */
    delimiter?: string;
    /** 上一页给的游标 */
    continuationToken?: string;
    /** 一页最多几个条目(目录 + 文件合起来) */
    maxKeys?: number;
  } = {}
): Promise<R2Listing> {
  const client = getR2Client();
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      ...(opts.prefix ? { Prefix: opts.prefix } : {}),
      ...(opts.delimiter ? { Delimiter: opts.delimiter } : {}),
      ...(opts.continuationToken
        ? { ContinuationToken: opts.continuationToken }
        : {}),
      MaxKeys: opts.maxKeys ?? 200,
    })
  );

  return {
    objects: (res.Contents ?? []).map((o) => ({
      key: o.Key ?? "",
      size: o.Size ?? 0,
      lastModified: o.LastModified?.toISOString() ?? "",
      etag: (o.ETag ?? "").replace(/^"|"$/g, ""),
    })),
    prefixes: (res.CommonPrefixes ?? [])
      .map((p) => p.Prefix ?? "")
      .filter(Boolean),
    nextContinuationToken: res.NextContinuationToken ?? null,
    isTruncated: Boolean(res.IsTruncated),
  };
}

/**
 * 删一个对象
 *
 * ## 可能失败 —— 而且失败是**常态**
 *
 * 这个桶的桶策略锁着对象(`ObjectLockedByBucketPolicy`,HTTP 409)—— 2026-11-01
 * 实测过一次。桶策略是在 Cloudflare 后台配的,**代码改不了**。
 *
 * 所以这里**原样把错误抛出去**,让上层去分「桶策略锁着」和「真出错了」:
 * 前者要跟用户说「要去 Cloudflare 后台改桶策略」,后者才是「重试有用」。
 *
 * 用法上唯一的硬规矩:**别拿它做清理脚本** —— 删不掉,还会把真错误盖住。
 */
export async function deleteObject(objectKey: string): Promise<void> {
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
}

export async function objectExists(objectKey: string): Promise<boolean> {
  try {
    const client = getR2Client();
    await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: objectKey })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 服务端直接上传对象到 R2（不走预签名）
 *
 * 用于 fallback 占位图等场景：服务端生成 buffer 后直接 PUT。
 * 返回公开访问 URL。
 *
 * metadata 可选:写入 user-defined metadata(S3/R2 在 HeadObject 时
 * 能读回)。proxyImageInputsToR2 用它标记"该对象已经过 server 端格式
 * 归一化",后续 submit 走 fast-path skip(详见 architecture-mp-server-
 * side-normalize.md §2.2)。
 */
export async function putObject(opts: {
  objectKey: string;
  body: Buffer | Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: opts.objectKey,
      Body: opts.body,
      ContentType: opts.contentType,
      Metadata: opts.metadata,
    })
  );
  return getPublicUrl(opts.objectKey);
}

/**
 * HEAD R2 对象,返回 metadata / content-type。
 *
 * 用于 input-url-proxy 的 fast-path skip:
 * proxyImageInputsToR2 看到 R2 URL 时,先 HeadObject 拿 metadata;
 *   - x-moon-normalized === "true" → 已知合规,直接 skip 后续 fetch+sniff
 *   - 其他 / 失败 → 走 slow path
 *
 * 失败语义:
 *   - 404 NotFound → exists=false,metadata=null
 *   - 其它错误(S3 5xx / 网络)→ 抛出,调用方决定是否 fallback
 */
export interface HeadObjectResult {
  exists: boolean;
  /** user-defined metadata(S3 内部会 lowercase key,这里保持原大小写) */
  metadata: Record<string, string> | null;
  contentType: string | null;
}

export async function headObject(opts: {
  objectKey: string;
}): Promise<HeadObjectResult> {
  const client = getR2Client();
  try {
    const res = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: opts.objectKey })
    );
    // res.Metadata 是 user-defined metadata(key 已被 S3 强制 lowercase)
    const metadata: Record<string, string> = {};
    if (res.Metadata) {
      for (const [k, v] of Object.entries(res.Metadata)) {
        if (typeof v === "string") metadata[k] = v;
      }
    }
    return {
      exists: true,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      contentType: res.ContentType ?? null,
    };
  } catch (e: unknown) {
    if (
      e !== null &&
      typeof e === "object" &&
      "name" in e &&
      (e as { name?: unknown }).name === "NotFound"
    ) {
      return { exists: false, metadata: null, contentType: null };
    }
    throw e;
  }
}

/**
 * In-place 更新 R2 对象的 user-defined metadata(不动 body)。
 *
 * 实现:S3 CopyObject 同源 + MetadataDirective:REPLACE。
 * CopySource 必须 URL-encode objectKey(原 key 含 `/` 没问题但保险起见 encode)。
 * 该命令在 R2 上不会重传 bytes,只是把 metadata 替换,比 PutObject 重传快。
 *
 * 失败语义:调用方 catch 后自行决定 fallback(不影响主流程)。
 */
export async function updateObjectMetadata(opts: {
  objectKey: string;
  metadata: Record<string, string>;
}): Promise<void> {
  const client = getR2Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: opts.objectKey,
      CopySource: `${bucket}/${encodeURIComponent(opts.objectKey)}`,
      Metadata: opts.metadata,
      MetadataDirective: "REPLACE",
    })
  );
}

export const R2_BUCKET = bucket;

/**
 * 允许直传 / 公开访问的 R2 host 列表（用于业务层校验 publicUrl 来源）
 *
 * 包含：
 * - R2_PUBLIC_BASE_URL 派生 host（CDN 或 r2.dev 公共域名）
 * - ${R2_ACCOUNT_ID}.r2.cloudflarestorage.com（S3 API endpoint，可作 fallback 公开域）
 */
export function getR2PublicHosts(): string[] {
  const hosts = new Set<string>();
  if (publicBaseUrl) {
    try {
      hosts.add(new URL(publicBaseUrl).host);
    } catch {
      // 忽略非法 URL
    }
  }
  if (accountId) {
    hosts.add(`${accountId}.r2.cloudflarestorage.com`);
  }
  return Array.from(hosts);
}
