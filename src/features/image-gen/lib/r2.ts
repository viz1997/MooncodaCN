// Cloudflare R2 / S3 直传工具（公共生图参考图上传）
// 与 Mooncoda 现有 /api/upload/presigned 独立，使用 R2_* 环境变量，免登录场景适用
import {
  CopyObjectCommand,
  HeadObjectCommand,
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
}): Promise<PresignResult> {
  const client = getR2Client();
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: opts.objectKey,
    ContentType: opts.contentType,
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
