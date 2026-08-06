/**
 * 存储安全验证
 *
 * 统一封装上传/删除请求的安全校验逻辑，供 Server Actions、API 路由和测试复用。
 */

import { ALLOWED_IMAGE_TYPES } from "./types";

/**
 * 验证结果
 */
interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * 校验存储桶是否在白名单内
 */
export function validateBucket(
  bucket: string,
  allowedBuckets: string[]
): boolean {
  return allowedBuckets.includes(bucket);
}

/**
 * 校验文件键名格式
 *
 * 规则：
 * - 不允许空字符串
 * - 不允许以 / 开头或结尾
 * - 不允许连续的 //
 * - 不允许 .. 路径遍历
 * - 只允许字母、数字、下划线、连字符、点、斜杠
 * - 长度不超过 255
 */
export function validateKeyFormat(key: string): boolean {
  if (!key || key.length > 255) return false;
  if (key.startsWith("/") || key.endsWith("/")) return false;
  if (key.includes("//") || key.includes("..")) return false;

  // 只允许合法字符：字母、数字、_、-、.、/
  return /^[a-zA-Z0-9_\-./]+$/.test(key);
}

/**
 * 校验 ContentType 是否在允许的图片类型内
 */
export function validateContentType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(
    contentType as (typeof ALLOWED_IMAGE_TYPES)[number]
  );
}

/**
 * 判断文件键名是否属于指定用户
 *
 * 安全要求：userId 必须作为键名的**首路径段**，而非子串出现。
 */
export function isKeyOwnedByUser(key: string, userId: string): boolean {
  if (!userId || !key) return false;
  const parts = key.split("/");
  if (parts.length < 2) return false;
  if (parts[0] !== userId) return false;
  // 确保最后一段不是空文件名
  const lastPart = parts[parts.length - 1];
  return lastPart !== undefined && lastPart.length > 0;
}

interface ValidateUploadRequestParams {
  key: string;
  bucket: string;
  contentType: string;
  userId: string;
  allowedBuckets: string[];
}

/**
 * 校验上传请求
 *
 * 按顺序检查：bucket 白名单 → 键名格式 → 用户归属 → ContentType
 */
export function validateUploadRequest(
  params: ValidateUploadRequestParams
): ValidationResult {
  const { key, bucket, contentType, userId, allowedBuckets } = params;

  if (!validateBucket(bucket, allowedBuckets)) {
    return { valid: false, error: "不允许访问该存储桶" };
  }

  if (!validateKeyFormat(key)) {
    return { valid: false, error: "文件键名包含非法字符或长度不符" };
  }

  if (!isKeyOwnedByUser(key, userId)) {
    return { valid: false, error: "文件路径必须以用户 ID 作为前缀" };
  }

  if (!validateContentType(contentType)) {
    return {
      valid: false,
      error: `只支持以下文件类型: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
    };
  }

  return { valid: true };
}

interface ValidateDeleteRequestParams {
  key: string;
  bucket: string;
  userId: string;
  allowedBuckets: string[];
}

/**
 * 校验删除请求
 *
 * 按顺序检查：bucket 白名单 → 键名格式 → 用户归属
 */
export function validateDeleteRequest(
  params: ValidateDeleteRequestParams
): ValidationResult {
  const { key, bucket, userId, allowedBuckets } = params;

  if (!validateBucket(bucket, allowedBuckets)) {
    return { valid: false, error: "不允许访问该存储桶" };
  }

  if (!validateKeyFormat(key)) {
    return { valid: false, error: "文件键名包含非法字符或长度不符" };
  }

  if (!isKeyOwnedByUser(key, userId)) {
    return { valid: false, error: "无权操作此文件" };
  }

  return { valid: true };
}
